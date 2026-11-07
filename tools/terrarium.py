"""Shared helpers: download Terrarium elevation tiles and resample them onto a lat/lon grid.

Tiles come from the Mapzen Terrain Tiles dataset on AWS Open Data
(https://registry.opendata.aws/terrain-tiles/). Each PNG pixel encodes
height in metres as R*256 + G + B/256 - 32768.
"""
import math
import os
import time
import urllib.request

import numpy as np
from PIL import Image

TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def tile_x(lon, z):
    return (lon + 180.0) / 360.0 * 2 ** z


def tile_y(lat, z):
    r = math.radians(lat)
    return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2 ** z


def fetch_tile(z, x, y, cache):
    os.makedirs(cache, exist_ok=True)
    path = os.path.join(cache, f"{z}_{x}_{y}.png")
    if not os.path.exists(path):
        for attempt in range(4):
            try:
                urllib.request.urlretrieve(TILE_URL.format(z=z, x=x, y=y), path)
                break
            except Exception as err:  # network hiccup: back off and retry
                if attempt == 3:
                    raise
                print(f"retry {z}/{x}/{y}: {err}")
                time.sleep(2 ** (attempt + 1))
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    return rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768


def height_grid(north, south, west, east, rows, cols, z, cache="tiles"):
    """Bilinearly resample tiles at zoom z onto a rows x cols grid; row 0 = north, col 0 = west."""
    x0, x1 = int(tile_x(west, z)), int(tile_x(east, z))
    y0, y1 = int(tile_y(north, z)), int(tile_y(south, z))
    mosaic = np.zeros(((y1 - y0 + 2) * 256, (x1 - x0 + 2) * 256), dtype=np.float32)
    for x in range(x0, x1 + 2):
        for y in range(y0, y1 + 2):
            mosaic[(y - y0) * 256:(y - y0 + 1) * 256, (x - x0) * 256:(x - x0 + 1) * 256] = fetch_tile(z, x, y, cache)
    lats = north + (south - north) * np.arange(rows) / (rows - 1)
    lons = west + (east - west) * np.arange(cols) / (cols - 1)
    py = np.array([(tile_y(v, z) - y0) * 256 for v in lats])
    px = np.array([(tile_x(v, z) - x0) * 256 for v in lons])
    iy, ix = np.floor(py).astype(int), np.floor(px).astype(int)
    ay, ax = (py - iy)[:, None], (px - ix)[None, :]
    return (mosaic[iy][:, ix] * (1 - ay) * (1 - ax) + mosaic[iy + 1][:, ix] * ay * (1 - ax)
            + mosaic[iy][:, ix + 1] * (1 - ay) * ax + mosaic[iy + 1][:, ix + 1] * ay * ax)
