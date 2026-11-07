"""Build sim/terrain.b64.txt: the flight sim's height grid.

Format (must match loadTerrain() in sim/index.html):
  2049 x 2049 points, 40 m apart, an 81.92 km square centred on 37.35 N, 115.70 W, row 0 = north.
  Heights quantised to 0.25 m above 900 m, stored as int16 deltas along each row,
  gzip-compressed, then base64 (the artifact host serves it as text).

If you change the size, centre or BASE here, change S / GN / CLAT / CLON / BASE in sim/index.html too.

Usage:  python3 tools/build_sim_terrain.py   (from the repo root; tiles are cached in ./tiles)
"""
import base64
import gzip
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from terrarium import height_grid  # noqa: E402

CLAT, CLON = 37.35, -115.70
SIZE_M = 81920.0
GN = 2049
BASE = 900.0
ZOOM = 12  # about 30 m per source pixel at this latitude


def main():
    dlat = SIZE_M / 111320.0
    dlon = SIZE_M / (111320.0 * math.cos(math.radians(CLAT)))
    north, south = CLAT + dlat / 2, CLAT - dlat / 2
    west, east = CLON - dlon / 2, CLON + dlon / 2
    print(f"bbox N {north:.4f} S {south:.4f} W {west:.4f} E {east:.4f}")
    g = height_grid(north, south, west, east, GN, GN, ZOOM)
    print(f"heights {g.min():.1f} .. {g.max():.1f} m")
    q = np.round((g - BASE) * 4).astype(np.int32)
    if q.min() < 0 or q.max() > 32767:
        raise SystemExit("heights fall outside the int16 range; adjust BASE")
    d = q.copy()
    d[:, 1:] = q[:, 1:] - q[:, :-1]
    packed = gzip.compress(d.astype("<i2").tobytes(), 9, mtime=0)  # mtime=0: reproducible output
    out = os.path.join("sim", "terrain.b64.txt")
    with open(out, "w") as f:
        f.write(base64.b64encode(packed).decode())
    print(f"wrote {out}: {len(packed):,} bytes gzip, {os.path.getsize(out):,} bytes base64")


if __name__ == "__main__":
    main()
