"""Build sim/groom-features.json: runways, taxiways, aprons, helipads and buildings at Groom Lake.

Source: Overture Maps (base/infrastructure and buildings themes). The airfield geometry is
OpenStreetMap data, traced by mappers from aerial imagery; some building footprints come from
Microsoft ML Buildings. Coordinates are converted to the sim's local frame (metres; x = east,
z = south, origin 37.35 N 115.70 W) so the page needs no projection code. Overture has no widths,
so runway and taxiway widths below are defaults (the main runway is 150 ft per published data).

Usage:  pip install -r requirements.txt && python3 tools/build_features.py   (from the repo root)
"""
import json
import math
import os
import sys

from shapely import wkb
from shapely.geometry import LineString, Polygon

sys.path.insert(0, os.path.dirname(__file__))
from overture import RELEASE, query  # noqa: E402

CLAT, CLON = 37.35, -115.70                     # must match sim/index.html
MLAT, MLON = 111320.0, 111320.0 * math.cos(math.radians(CLAT))
BOX = (-115.88, 37.18, -115.72, 37.34)          # west, south, east, north
LAKEBED = (-115.825, 37.250, -115.770, 37.300)  # lines wholly inside this are painted lakebed strips
MAIN_RUNWAY_W = 45.7                            # 150 ft
TAXIWAY_W = 18.0
BUILDING_H = {"hangar": 16.0, "bunker": 4.0, "warehouse": 9.0, "industrial": 8.0}


def xz(lon, lat):
    return [round((lon - CLON) * MLON, 1), round(-(lat - CLAT) * MLAT, 1)]


def line_pts(g):
    return [xz(x, y) for x, y in g.coords]


def ring_pts(g):
    ring = list(g.exterior.coords)[:-1]
    if Polygon(ring).exterior.is_ccw:  # store clockwise in lon/lat = counter-clockwise in x/z (z is south)
        ring.reverse()
    return [xz(x, y) for x, y in ring]


def inside(g, box):
    w, s, e, n = box
    x0, y0, x1, y1 = g.bounds
    return x0 >= w and x1 <= e and y0 >= s and y1 <= n


def metres(g):
    return LineString([xz(x, y) for x, y in g.coords]).length


def main():
    print("infrastructure…")
    infra = query("base", "infrastructure", *BOX, ["id", "bbox", "class", "names", "geometry"])
    print("buildings…")
    blds = query("buildings", "building", *BOX, ["id", "bbox", "class", "height", "num_floors", "geometry"])

    out = {"source": f"Overture Maps {RELEASE} (OpenStreetMap contributors, ODbL; Microsoft ML Buildings, CDLA-Permissive-2.0)",
           "frame": {"clat": CLAT, "clon": CLON}, "runways": [], "taxiways": [], "aprons": [], "helipads": [], "buildings": []}
    for r in infra:
        g, c = wkb.loads(r["geometry"]), r["class"]
        if c in ("runway", "stopway") and g.geom_type == "LineString":
            if g.length == 0:
                continue
            if c == "runway" and inside(g, LAKEBED):
                kind, w = "lakebed", 12.0
            elif c == "stopway" or metres(g) > 2500:
                kind, w = ("stopway" if c == "stopway" else "paved"), MAIN_RUNWAY_W
            else:
                kind, w = "dirt", 25.0
            out["runways"].append({"kind": kind, "w": w, "pts": line_pts(g)})
        elif c == "taxiway" and g.geom_type == "LineString":
            out["taxiways"].append({"w": TAXIWAY_W, "pts": line_pts(g)})
        elif c in ("apron", "helipad") and g.geom_type == "Polygon":
            out["aprons" if c == "apron" else "helipads"].append(ring_pts(g))
    for r in blds:
        g = wkb.loads(r["geometry"])
        polys = list(g.geoms) if g.geom_type == "MultiPolygon" else [g]
        h = r["height"] or (r["num_floors"] * 3.5 if r["num_floors"] else BUILDING_H.get(r["class"], 6.0))
        for p in polys:
            out["buildings"].append({"c": r["class"] or "", "h": round(float(h), 1), "r": ring_pts(p)})

    # the main runway's designators, painted at the end where a landing starts: landing heading ~140
    # (toward the SE) starts at the NW end, so the NW end reads "14" and the SE end "32".
    # ends[i] is the number painted at pts[0] / pts[-1].
    for rw in out["runways"]:
        if rw["kind"] == "paved":
            (x0, z0), (x1, z1) = rw["pts"][0], rw["pts"][-1]
            hdg01 = (math.degrees(math.atan2(x1 - x0, -(z1 - z0))) + 360) % 360  # true bearing first -> last point
            rw["hdg"] = round(hdg01, 1)
            rw["ends"] = ["14", "32"] if 90 < hdg01 < 270 else ["32", "14"]

    with open(os.path.join("sim", "groom-features.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    n = {k: len(v) for k, v in out.items() if isinstance(v, list)}
    print("wrote sim/groom-features.json", n, f"{os.path.getsize('sim/groom-features.json'):,} bytes")


if __name__ == "__main__":
    main()
