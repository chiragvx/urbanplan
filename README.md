# UrbanPlan

Edit a real city like a Figma file, see it in 3D like Cities: Skylines. A personal map editor for making more
accurate city maps — roads, junctions, utilities, metro — that you can publish and others can copy and edit.
Illustrative concept, not engineering advice. Current data: Pune, **Koregaon Park · Kalyani Nagar** tile, 5×5 km.

## Run

```bash
npm install
npm run dev     # http://localhost:5173 (Chrome/Edge; three.js WebGPU with WebGL2 fallback)
npm test        # headless document + cross-section tests
```

## The editor

- **2D plan** (default) and **3D** with <kbd>Tab</kbd> — the same generated city, a camera flight apart. Every tool works in
  both: in 3D, click / drag roads, junctions, handles and points as in 2D; drag empty ground to pan, right-drag (or
  Alt-drag) to orbit, the wheel to zoom, <kbd>W A S D Q E R F</kbd> to fly.
- **Select** (<kbd>V</kbd>): click a road → the whole road; double-click → one section (junction to junction); <kbd>Esc</kbd> steps out.
  Drag a road to bend it, a junction to move it (drop it on another junction / road to connect), the □ handles to
  change width (<kbd>Alt</kbd> = one side; snaps to DP standard widths). Shift-drag moves the selection.
- **Road vs section edits**: a road-level change reaches every section of the road; a section's own change wins
  (blue dot = set here, purple = inherited from the road). Inspector → cross-section strip (Streetmix-style):
  drag part edges, click a part for kind / width / direction, presets per road class.
- **Road tool** (<kbd>P</kbd>), Cities: Skylines style — modes <kbd>1</kbd> Straight, <kbd>2</kbd> Simple curve, <kbd>3</kbd> Complex
  curve, <kbd>4</kbd> Continuous (arcs carrying on from the last stretch), <kbd>5</kbd> Freeform (Bézier pen), <kbd>6</kbd> Replace
  (click a road to give it the chosen class). Each stretch is built on click and the tool carries on; right-click steps
  back. Crossings at the same level become junctions automatically; the preview marks each one (green = junction,
  purple = passes over, red = too little headroom). A live readout shows length, bearing, turn, radius, height and grade.
- **Bridges / flyovers**: <kbd>PgUp</kbd> / <kbd>PgDn</kbd> set the height the road tool draws at (step 10 / 5 / 2.5 / 1.25 / 0.5 m,
  <kbd>Alt PgUp</kbd>). With roads selected, <kbd>Shift PgUp</kbd> makes them a flyover (6.5 m deck, ramps at the set grade,
  default 5 %; junctions underneath stay on the ground and are passed over), <kbd>PgUp</kbd> / <kbd>PgDn</kbd> step the deck and
  <kbd>Home</kbd> brings it back down, reconnecting the junctions below. The inspector's **Level** section does the same.
- **Underground roads / tunnels**: below zero the road tool draws underground (<kbd>PgDn</kbd> past ground, or the Tunnel
  chip). <kbd>Shift PgDn</kbd> turns selected roads into an underpass / tunnel (8 m down, ramps at the set grade). Shallower
  than 6.5 m is an open cut (the ground is dug out, retaining walls); deeper is a covered tunnel box under untouched
  ground — buildings and trees above stay — with portals where the cut goes under. Roads meet underground at the same
  level (underground junctions); 2D shows tunnels dashed green, <kbd>X</kbd> x-ray shows them in 3D. Issues checks headroom.
- **Snapping** (<kbd>S</kbd> toggles, hold <kbd>Ctrl</kbd> to skip once, <kbd>Shift</kbd> = 15° steps): junctions and roads at your
  level, 90° / 45° to the road you start from or the last stretch, guide lines from nearby road ends (and where two
  meet), lengths rounded to 1 / 5 / 8 / 10 m.
- **Edit points** (<kbd>A</kbd>): Bézier anchors + handles; double-click a road to add a point; <kbd>PgUp</kbd> / <kbd>PgDn</kbd> raise
  the selected point. **Bulldozer** (<kbd>B</kbd>): click to remove a section, Shift for the whole road, drag to sweep.
  **Split / join** (<kbd>K</kbd>). **Lines** (<kbd>L</kbd>) for utilities / rail. **Measure** (<kbd>M</kbd>): distances, and road /
  building-to-building widths on hover. <kbd>U</kbd> focuses the selection.
- **Layers**: reference (georeferenced DP sheets <kbd>D</kbd>, OSM / your own XYZ imagery), surface, elevated (metro),
  underground (PMC sewer, stormwater, nallas — <kbd>X</kbd> x-ray in 3D). Each can be hidden, locked, faded.
- **Accuracy** view colours roads by where their width comes from (DP sheet / OSM / edited / verified);
  **Review** walks the roads most likely to be wrong (<kbd>N</kbd> next, <kbd>Y</kbd> looks right); **Issues** finds overlaps,
  roads crossing without a junction (level-aware: bridges are checked for headroom), near-miss dead ends, narrow lanes,
  tight curves, widths beyond the DP reserve.
- <kbd>Ctrl K</kbd> command palette (commands, road names, `lat, lon` / `x, z`), <kbd>?</kbd> all shortcuts. Everything undoes.

### Maps: save, publish, copy

A map is **only your edits** (`.urbanplan.json`): one line per edited object, so `git diff` reads like "this road's
cross-section changed". Edits sit on top of the baked base map and are re-attached by locator (OSM ways + position)
when the base is re-imported; anything that no longer matches is kept and listed under Issues.

- Autosaves in the browser. **Save** (<kbd>Ctrl S</kbd>) writes `maps/<name>.urbanplan.json` in this repo when running `npm run dev`
  (elsewhere: a file on disk / download).
- **Publish** copies the map into `public/maps/` and its gallery; `npm run build` → upload `dist/` to any static host.
  `?map=<url>` opens any hosted map read-only with **Edit a copy** (a fork that remembers where it came from).
- Export **GeoJSON** (WGS84, for QGIS / JOSM) or the edited **network.json** for the offline tools.
- The base data is © OpenStreetMap contributors (ODbL): a published map built on it is shared under the ODbL too.

### Edit with code

`city` in the browser console and `npm run map -- apply <map> <script.mjs>` share one API (and the editor's undo):

```js
city.roads({ name: /North Main/ }).width(24)               // whole road, lanes re-flowed to 2.75–3.75 m
city.sections({ cls: 'residential' }).filter((s) => city.width(s) < 5).footpaths(1)
city.junctions({ signals: true }).cornerRadius(10)
city.road([[0, 0], [120, 40]], 'tertiary', 'New Link Road') // metres from the tile centre
city.help()
```

```bash
npm run map -- new maps/my.urbanplan.json "My map" "Me"
npm run map -- apply maps/my.urbanplan.json scripts/widen.mjs    # export default (city) => { … }
npm run map -- check maps/my.urbanplan.json                       # exit code 2 if there are errors
npm run map -- geojson maps/my.urbanplan.json out.geojson
npm run map -- network maps/my.urbanplan.json out/network.json
npm run map -- publish maps/my.urbanplan.json
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

**DP underlay for the editor**: `python tools/dp/tiles.py [sheet ...] [--res 0.5]` resamples every registered sheet
(default: all with a `.reg.json`) through its registration into 500 m × 500 m RGBA WebP blocks at 0.5 m/px under
`public/tiles/kp/dp/` (`index.json` lists each block's `x0`/`z0` in tile metres; legend and uncovered areas are
transparent; overlaps take the sheet farther from its frame edge). ≈45 s, ≈13 MB for S2-06 + S2-07.

### Underground utilities (free, optional)

`npm run import:utilities -- kp` downloads PMC's public-domain sewer and stormwater datasets from OpenCity
(`pune-sewage-network`, `pune-stormwater-drains`; resource URLs resolved via the CKAN API, cached with a
`.meta.json` under `data/raw/utilities/`), clips them to the tile and writes `public/tiles/kp/utilities.json`
(layers `sewer`, `sewer-swd` = sewer pipes only in the SWD file, `storm`, `nalla`; lines in tile metres with
`diameter_mm` ← `pipeline_d`, `material` ← `material_o`/`descriptio`, `depth_m` ← mean(ground − invert)).
`--offline` reuses the cache, `--no-raw` drops the raw attributes (16 MB → 2 MB for kp), and
`--file x.kmz|x.kml|x.geojson --layer id [--kind water] [--source .. --url .. --license ..]` adds a layer from a local file.

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
src/doc/      City Document: types, base (bake → sections / junctions / roads / layers), CityDoc (patch, inheritance,
              undo), compile (→ road mesher), ops (split / join / bend / pen …), xsection, format, issues, api, export
src/editor/   editor controller + tools, plan view, hit index, overlay, commands (menus / palette / shortcuts)
src/scene/    World (road chunks per edit, lazy terrain / buildings / trees / rail / pipes), reference imagery
src/ui/       Preact panels: top bar, layers / roads / issues / review, inspector, cross-section, dialogs
src/app/      boot, files (autosave, repo, publish, fork), review queue, frame loop
tools/map-cli.ts  maps from the command line
```

```
tools/        bake pipeline (Node)        src/geo/     streets, curves, elevation, terrain, road raster
src/net/      network model, importer, procedural generator
src/build/    meshes (buildings, terrain, rail, trees)   src/render/  three.js engine, materials, camera
legacy/v1/    first prototype (custom WebGPU engine, Baner)
```

Data © OpenStreetMap contributors (ODbL) · Copernicus DEM GLO-30 © DLR/Airbus (EU/ESA).
