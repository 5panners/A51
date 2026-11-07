# A51

A browser helicopter sim over the real terrain around Groom Lake (Area 51), Lincoln County, Nevada, plus a 3D terrain viewer of the same area.

| Folder | What it is |
| --- | --- |
| `sim/` | **Groom Lake Flight.** Fly the Little Bird over 82 × 82 km of real elevation, from Rachel to Tikaboo Peak. |
| `viewer/` | **Groom Lake Terrain.** An orbitable 3D model of the same region with hover elevation readout, sun and height controls. Self-contained single file. |
| `tools/` | Scripts that download the elevation data and rebuild both terrain files, and a headless smoke test for the sim. |

## Play online

- Sim: https://5panners.github.io/a51/
- Terrain viewer: https://5panners.github.io/a51/viewer/

`.github/workflows/pages.yml` redeploys both on every push to `main` that touches `sim/` or `viewer/`. One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Run it locally

Both pages are static files. The sim fetches its data files, so serve the folder rather than opening the file directly:

```bash
python3 -m http.server 8000 --directory sim
```

Then open http://localhost:8000. The pages load three.js from jsDelivr (sim: 0.170.0) and cdnjs / jsDelivr (viewer: r128), so they need internet access.

The viewer works the same way (`--directory viewer`), or just open `viewer/index.html`.

## Sim controls

| Key | Action |
| --- | --- |
| Click | Grab the mouse to fly (Esc releases) |
| E | Start / stop the engine (4 s spool) |
| W / S | Collective up / down; release to hover |
| Mouse | Pitch and roll (push forward = nose down) |
| A / D | Yaw (tail rotor) |
| Arrows | Look around |
| Wheel · V | Zoom · recentre camera |
| C · O | Cockpit · inspect camera |
| R | Reset to the chosen start |
| H | Hide the menu |
| M | Rotor sound on / off |
| Gamepad | Left stick collective / yaw, right stick cyclic |

On touch screens two on-screen sticks appear. Start points: the threshold of runway 32 or the west-ramp helipads (on the ground), or airborne at 150 m over the facility, Tikaboo Peak, Rachel or Bald Mountain. Handling presets: Assisted, Arcade, Hardcore.

## How the sim works

- **World frame:** an 81.92 km square centred on 37.35° N, 115.70° W. `x` = east, `z` = south, `y` = metres above sea level.
- **Terrain data:** `sim/terrain.b64.txt` holds a 2049 × 2049 height grid (40 m spacing), quantised to 0.25 m, delta-encoded per row, gzipped and base64'd (4.8 MB). The page unpacks it with `DecompressionStream`.
- **Rendering:** a quadtree picks terrain tiles by distance (1.28 km tiles up close, coarser farther out). Every tile is the same 33 × 33 grid, displaced on the GPU from a float height texture, and all of them draw in one instanced call. Skirts hide cracks between detail levels.
- **Shading:** normals, a lakebed mask and mountain shadows are baked once at load. Ground colour comes from height and slope, not satellite imagery. Close-up detail noise, distance and height haze, ACES tone mapping and a logarithmic depth buffer handle the 0.1 m – 180 km depth range.
- **Near the camera:** instanced scrub, junipers and Joshua trees within ~650 m, a blob shadow cast along the sun, and rotor dust in ground effect.
- **Airfield:** `sim/groom-features.json` holds the runways, lakebed strips, stopways, taxiways, aprons, helipads and 310 building footprints from OpenStreetMap (via Overture Maps), already in the sim's metre frame. Paved surfaces are draped strips sampled every 12 m. One shader paints the markings (runway 14/32 numbers, threshold bars, aiming points, touchdown-zone rubber, centrelines, taxiway lines, stopway chevrons) and lifts the surfaces slightly with distance so coarse far terrain never covers them. Buildings are extruded footprints in one merged mesh. You can land on roofs; flying into a wall is a crash.
- **Helicopter:** `littlebird.glb.b64.txt` (the model) and `littlebird-flight.js` (the flight model) come unchanged from the *Little Bird Test Flight* project. The physics samples the same height grid the GPU draws, using the same triangle split, so the skids touch the visible ground.

Not modelled: roads, satellite imagery, or air density with altitude (the flight model has none). Overture has no widths, so the main runway uses its published 150 ft, taxiways 18 m and lakebed strips 12 m. Buildings without a height tag get 16 m (hangars) or 4–9 m by type.

## Rebuild the terrain

```bash
pip install -r requirements.txt
python3 tools/build_sim_terrain.py      # writes sim/terrain.b64.txt (~121 z12 tiles)
python3 tools/build_viewer_terrain.py   # rewrites the HB64 line in viewer/index.html
python3 tools/build_features.py         # writes sim/groom-features.json from Overture Maps
```

`build_features.py` reads only the GeoParquet row groups that overlap the airfield, over plain HTTPS range requests (`tools/overture.py`), so it downloads a few MB rather than the multi-GB release files. Change `RELEASE` in `tools/overture.py` to pull a newer Overture release.

Run them from the repo root. Downloaded tiles are cached in `tiles/` (git-ignored), and the output is byte-for-byte reproducible. To change the area or resolution, edit the constants at the top of each script and the matching constants in the page (`S`, `GN`, `CLAT`, `CLON`, `BASE` in `sim/index.html`; `G`, `W`, `E`, `N`, `S` in the viewer).

## Smoke test

```bash
npm i -D playwright && npx playwright install chromium
node tools/smoke_test.js                         # three.js from the CDN
node tools/smoke_test.js --three path/to/three   # offline, with a local three@0.170.0 package
```

It starts the engine, climbs, flies forward, checks the helicopter is airborne and fast without crashing, and saves screenshots to `smoke-out/`.

## Data and credits

- **Elevation:** [Mapzen Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) on AWS Open Data, Terrarium encoding. In the US the source is mainly USGS 3DEP (public domain); see the [attribution notes](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) for the full source list.
- **Airfield and buildings:** © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, [ODbL](https://opendatacommons.org/licenses/odbl/); some building footprints from Microsoft ML Buildings (CDLA-Permissive-2.0); both via [Overture Maps](https://overturemaps.org) release 2026-10-21.0. `sim/groom-features.json` is a derived database under the ODbL.
- **Place coordinates** (Groom Lake facility, Bald Mountain, Tikaboo Peak, Rachel, Papoose Lake) are approximate. Peak heights in the grid are within about 25 m of published figures.
- **Libraries:** [three.js](https://threejs.org) (MIT), loaded from CDNs. Fonts: Saira Condensed and IBM Plex Mono via Google Fonts.
