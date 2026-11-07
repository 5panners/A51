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

On touch screens two on-screen sticks appear. Start points: the Groom Lake pad (on the ground), or airborne at 150 m over the facility, Tikaboo Peak, Rachel or Bald Mountain. Handling presets: Assisted, Arcade, Hardcore.

## How the sim works

- **World frame:** an 81.92 km square centred on 37.35° N, 115.70° W. `x` = east, `z` = south, `y` = metres above sea level.
- **Terrain data:** `sim/terrain.b64.txt` holds a 2049 × 2049 height grid (40 m spacing), quantised to 0.25 m, delta-encoded per row, gzipped and base64'd (4.8 MB). The page unpacks it with `DecompressionStream`.
- **Rendering:** a quadtree picks terrain tiles by distance (1.28 km tiles up close, coarser farther out). Every tile is the same 33 × 33 grid, displaced on the GPU from a float height texture, and all of them draw in one instanced call. Skirts hide cracks between detail levels.
- **Shading:** normals, a lakebed mask and mountain shadows are baked once at load. Ground colour comes from height and slope, not satellite imagery. Close-up detail noise, distance and height haze, ACES tone mapping and a logarithmic depth buffer handle the 0.1 m – 180 km depth range.
- **Near the camera:** instanced scrub, junipers and Joshua trees within ~650 m, a blob shadow cast along the sun, and rotor dust in ground effect.
- **Helicopter:** `littlebird.glb.b64.txt` (the model) and `littlebird-flight.js` (the flight model) come unchanged from the *Little Bird Test Flight* project. The physics samples the same height grid the GPU draws, using the same triangle split, so the skids touch the visible ground.

Not modelled: buildings, runways, roads, imagery, or air density with altitude (the flight model has none).

## Rebuild the terrain

```bash
pip install -r requirements.txt
python3 tools/build_sim_terrain.py      # writes sim/terrain.b64.txt (~121 z12 tiles)
python3 tools/build_viewer_terrain.py   # rewrites the HB64 line in viewer/index.html
```

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
- **Place coordinates** (Groom Lake facility, Bald Mountain, Tikaboo Peak, Rachel, Papoose Lake) are approximate. Peak heights in the grid are within about 25 m of published figures.
- **Libraries:** [three.js](https://threejs.org) (MIT), loaded from CDNs. Fonts: Saira Condensed and IBM Plex Mono via Google Fonts.
