"""Minimal Overture Maps reader: fetch only the GeoParquet row groups that overlap a bounding box.

Overture publishes its releases on AWS Open Data (s3://overturemaps-us-west-2/release/...). Each file's
row groups carry bbox column statistics, so a small area needs only the file footers plus a few row
groups, fetched with HTTP range requests. Plain HTTPS: no AWS credentials or DuckDB extensions.
"""
import io
import re
import sys
from concurrent.futures import ThreadPoolExecutor

import pyarrow.parquet as pq
import requests

BUCKET = "https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/"
RELEASE = "2026-10-21.0"
_session = requests.Session()


class RangeFile(io.RawIOBase):
    """Read-only, seekable file over HTTP range requests."""

    def __init__(self, url):
        self.url, self.pos = url, 0
        self.size = int(_session.head(url, timeout=60).headers["Content-Length"])

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset
        return self.pos

    def readinto(self, buf):
        n = min(len(buf), self.size - self.pos)
        if n <= 0:
            return 0
        data = _session.get(self.url, headers={"Range": f"bytes={self.pos}-{self.pos + n - 1}"}, timeout=300).content
        buf[:len(data)] = data
        self.pos += len(data)
        return len(data)


def list_files(theme, typ, release=RELEASE):
    xml = _session.get(f"{BUCKET}?list-type=2&prefix=release/{release}/theme={theme}/type={typ}/", timeout=60).text
    return re.findall(r"<Key>([^<]+\.parquet)</Key>", xml)


def query(theme, typ, west, south, east, north, columns, release=RELEASE):
    """Rows of theme/type (e.g. 'base', 'infrastructure') whose bbox overlaps the box, as dicts."""

    def overlaps(b):
        return b["xmin"] < east and b["xmax"] > west and b["ymin"] < north and b["ymax"] > south

    def one(key):
        f = pq.ParquetFile(io.BufferedReader(RangeFile(BUCKET + key), buffer_size=1 << 20))
        md = f.metadata
        paths = [md.schema.column(i).path for i in range(md.num_columns)]
        col = {k: paths.index("bbox." + k) for k in ("xmin", "xmax", "ymin", "ymax")}
        groups = []
        for g in range(md.num_row_groups):
            st = {k: md.row_group(g).column(i).statistics for k, i in col.items()}
            if st["xmin"].min < east and st["xmax"].max > west and st["ymin"].min < north and st["ymax"].max > south:
                groups.append(g)
        if not groups:
            return []
        return [r for r in f.read_row_groups(groups, columns=columns).to_pylist() if overlaps(r["bbox"])]

    keys = list_files(theme, typ, release)
    rows = []
    with ThreadPoolExecutor(4) as pool:
        for key, found in zip(keys, pool.map(one, keys)):
            if found:
                print(f"  {key.rsplit('/', 1)[-1][:10]}: {len(found)} rows", file=sys.stderr)
            rows += found
    return rows
