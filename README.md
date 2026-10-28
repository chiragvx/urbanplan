# Pune Remix

Cities: Skylines–style redesigner for real Pune, in the browser. Illustrative concept, not engineering advice.
Current tile: **Koregaon Park · Kalyani Nagar**, 5×5 km.

## Run

```bash
npm install
npm run dev     # http://localhost:5173 (Chrome/Edge; three.js WebGPU with WebGL2 fallback)
```

## Data pipeline (offline)

```bash
node tools/fetch-osm-api.mjs kp      # OSM XML via the OSM API (Overpass fallback: tools/fetch-osm-xml.mjs)
node tools/bake2.mjs kp              # terrain (Copernicus GLO-30), buildings, land use, water, rail, roads.osm
npm run bake:network -- kp           # network compiler → network.json (nodes + Bézier segments + road types)
```

### Road widths from Pune's Development Plan (free, optional)

PMC publishes the sanctioned DP (old limits) as scanned sheets. We register them onto the tile and measure
every road's reserve width from the drawing (no OCR / paid AI):

```bash
node tools/dev/export-ref.mjs                          # (after bake:network) roads + river reference for alignment
python tools/dp/align.py S2-06                         # coarse fit: river + road corridors (scale/rotation/position)
python tools/dp/align.py --scale=0.841 S2-07           # neighbouring sheets share the series scale
python tools/dp/register.py S2-06 S2-07                # block-wise local registration (≈2–3 m RMS)
python tools/dp/measure.py S2-06 S2-07                 # perpendicular profiles → data/raw/dp/widths.json
npm run bake:network -- kp                             # roads sized from DP reserves (capped by today's free space)
python tools/dp/overlay.py S2-06 out.png 150 x0,z0,x1,z1   # visual check of any area
```

Sheets live in `data/raw/dp/` (downloaded from PMC's public file store). Sector II–VI sheets are 1:10,000
(≈0.84 m/px at 300 dpi). Cantonment areas are not part of the PMC plan and keep estimated widths.

The elevation tile lives at `data/raw/dem/cop30_N18_E073.tif` (Copernicus GLO-30 on AWS open data).

## How roads are made (Cities: Skylines style)

OSM is treated as a survey, not as geometry. `src/net/importer.ts` compiles it into a clean network:
1. raw graph from drivable ways, clipped to the tile
2. **dual carriageways merged**: paired one-way halves (opposite direction, on the right — left-hand traffic) → one divided road
3. **roundabouts**: small rings → a single roundabout node
4. **junction clusters collapsed**: nodes joined by very short links → one junction
5. chains joined, **road types** assigned (lanes, median, footpaths — Indian defaults + OSM tags)
6. **G1 cubic Bézier fitting** (Schneider) with shape nodes between pieces
7. bridges classified (overpass vs river/nala) with graded ramps

`src/net/generate.ts` then builds everything procedurally: cross-sections swept along Béziers, junctions trimmed so
curved kerb corners fit, raised footpath corners, roundabout rings with filleted entries, markings, stop lines and
zebras, decks and pillars. Terrain is carved under ground-level roads; buildings are shrunk away from roads.

## Layout

```
tools/        bake pipeline (Node)        src/geo/     streets, curves, elevation, terrain, road raster
src/net/      network model, importer, procedural generator
src/build/    meshes (buildings, terrain, rail, trees)   src/render/  three.js engine, materials, camera
legacy/v1/    first prototype (custom WebGPU engine, Baner)
```

Data © OpenStreetMap contributors (ODbL) · Copernicus DEM GLO-30 © DLR/Airbus (EU/ESA).
