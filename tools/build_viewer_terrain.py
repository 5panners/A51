"""Rebuild the height data embedded in viewer/index.html.

Format (must match the viewer script): 480 x 480 points covering 37.75-36.95 N, 116.15-115.25 W,
row 0 = north, heights in decimetres as little-endian uint16, base64, in the line `const HB64="...";`.
If you change the bounds or grid size, change G / N / S / W / E at the top of the viewer script too.

Usage:  python3 tools/build_viewer_terrain.py   (from the repo root)
"""
import base64
import os
import re
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from terrarium import height_grid  # noqa: E402

N, S, W, E = 37.75, 36.95, -116.15, -115.25
G = 480
ZOOM = 11


def main():
    g = height_grid(N, S, W, E, G, G, ZOOM)
    print(f"heights {g.min():.1f} .. {g.max():.1f} m")
    b64 = base64.b64encode(np.clip(np.round(g * 10), 0, 65535).astype("<u2").tobytes()).decode()
    path = os.path.join("viewer", "index.html")
    html = open(path).read()
    html, n = re.subn(r'const HB64="[^"]*";', lambda m: f'const HB64="{b64}";', html, count=1)
    if n != 1:
        raise SystemExit("could not find the HB64 line in viewer/index.html")
    open(path, "w").write(html)
    print(f"updated {path}")


if __name__ == "__main__":
    main()
