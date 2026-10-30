# UrbanPlan

Edit a real city like a Figma file, see it in 3D like Cities: Skylines. A personal map editor for making more
accurate city maps — roads, junctions, utilities, metro — that you can publish and others can copy and edit.
Illustrative concept, not engineering advice. Cities: **Pune and Pimpri-Chinchwad** (PMC + PCMC) and **Mumbai**
(MCGM, Colaba to Dahisar and Mulund; not Navi Mumbai), each streamed in 2 km pieces; the original Koregaon Park ·
Kalyani Nagar tile still opens with `?tile=kp`.

The site opens on a **start menu**: the cities (with their land-cover map and size), *Continue* your last map, your
maps saved in this browser (open or delete), published maps, and *Open a file…*. Each opens the editor on its city
(`?region=pune`, `?region=mumbai`); a published link (`?map=…`) opens on the city it was made on. The map menu's
*Main menu* comes back here.

## Run

```bash
npm install
npm run dev     # http://localhost:5173 (Chrome/Edge; three.js WebGPU with WebGL2 fallback)
npm test        # headless document + cross-section tests
```

## The editor

- **Layout** (Cities: Skylines style): the map edge to edge, and the **bottom bar**: the map (its menu — new, open,
  save, export, publish — and name, with a tally of new road and edits), undo / redo, the **build categories** in the
  middle (each opens its catalogue above the bar; *Recent* holds what you built last), the tools (select, edit points,
  split, road tools, bulldozer), search, 2D / 3D and Publish; a status strip under it. **Info views** (DP sheets, DP
  regions, terrain, accuracy, satellite, OSM lines, X-ray) are the square buttons at the top left — one at a time,
  Shift-click to stack them; theme, help and settings at the top right. **Layers, Roads, Issues, Review** open from the
  icon rail on the right. Bottom left, above the bar, the **tool panel** holds the options of the tool in use as
  labelled rows (mode, elevation, step, ground, snapping…), or the **inspector** of what's selected — one scrolling
  list whose groups fold (and stay as you left them). The next step of the tool in use follows the cursor. Settings →
  Panels: *Docked* puts both panels beside the map instead. **Light / dark** theme (top right, or Settings → Theme;
  follows the system by default) — the 2D map has a dark style too. On a phone the panels become bottom sheets.
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
- **Terrain** (<kbd>T</kbd>), Cities: Skylines' landscaping: brushes *raise / lower* (right-drag or Alt lowers), *level*
  (right-click picks the height; **Balanced** levels to the average so cut = fill), *soften*, *restore*; shapes *slope*
  (drag top → bottom), *pad* (flat platform, 1:2 sides), *embankment / cutting* along a line, *pond* (with water). Keys
  <kbd>1</kbd>–<kbd>8</kbd>, <kbd>[</kbd> <kbd>]</kbd> brush size, <kbd>Shift</kbd>+<kbd>[</kbd> <kbd>]</kbd> strength. Each stroke or shape is an *earthwork* object
  (saved, undoable, editable in the inspector with its own cut / fill); they apply in order on the original terrain
  (Copernicus GLO-30 on an 8 m grid) to make the designed ground. **Terrain view** (<kbd>Shift T</kbd>): heights, hill shade and
  contours, or cut & fill; in 3D, height ×1–5 (buildings and trees hidden). Checks: steep roads, water pooling.
- **Roads and terrain**: roads, flyovers and tunnels follow the (terraformed) ground by default. **Graded** roads
  (<kbd>G</kbd> on a selection, Shift+<kbd>G</kbd> back; or the **Graded** chip in the road tool for new roads) get a fixed
  profile with stations every ≤ 96 m (12 cells of 8 m, Cities: Skylines' segment length), eased to ≤ 8 %; the ground is
  cut and filled to them at 1:2. Drag the stations in the height profile (<kbd>Shift P</kbd>); **Regrade** re-takes them.
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

### Satellite and checking against OpenStreetMap

- **Satellite** (info views, or Layers › Satellite): Esri World Imagery (no key; viewing with attribution — production
  use needs an ArcGIS account), Mapbox Satellite (your token, kept in this browser, never saved with a map) or any
  XYZ URL. *Over the map* (opacity) or *As the ground* (2D: it replaces the terrain and water, roads and buildings
  on top); roads *solid* or *ghost* (see-through, to check alignment); **Nudge** the imagery by ½ m steps (saved with
  the map). Credits show bottom right.
- **OSM lines** (View): the raw OpenStreetMap road centre lines over the map in yellow, and every place where a
  road here sits more than 6 m off them listed in Issues (divided roads measured from the midline of their halves).
  `node tools/dev/check-roads.mjs` gives the same measure for the whole network.

### Road tools (<kbd>J</kbd>, Network Multitool style)

One tool with 14 modes (keys 1–9, 0, Shift+1–4; or the options bar): each previews what it will do and says why it
can't. `=` / `−` change the radius / offset (Shift ×10, Alt ×0.1), `Z` the next shape / other side, Enter applies,
Esc or right-click steps back.

| Mode | What it does |
|---|---|
| Add / remove junction | split a road at a point (Alt: whole metres from its start) / remove a junction between two roads |
| Merge junctions | merge one junction into another (≤ 8 roads, ≤ 60 m apart, not already joined) |
| Split junction | pick some of a junction's roads and move them to a new junction (Shift keeps its height) |
| Intersect | a junction where two roads cross (refuses roads that don't cross or cross too near an end) |
| Lock / Invert | lock sections against edits and the bulldozer (a padlock shows) / reverse direction (Shift: whole road) |
| Arrange on line | junctions in order onto one straight line (through first → last, or along the first road) |
| Arrange on circle | junctions onto a fitted circle — drag the centre, ring or a junction; spacing as placed / even / even between crossings / crossings even; the roads between become arcs |
| Even slope | one gradient from the first junction to the last; junctions between are raised / lowered and the roads graded |
| Loop | straight – curve – straight between two roads (the 90° turn or the 270° loop) |
| Connection | curve – straight – curve between two roads, two radii, every turn combination |
| Parallel | a copy of a road alongside (offset, side, height), joining junctions already at its ends |
| Curve between ends | a smooth curve joining the ends of two roads |

Loops, connections and curves are built as the road tool's current type (picked in the options bar).

**Flyover in the median** (Shift+5): click where it starts and ends on a road; it's built along the road's centre
line (2 / 4 / one-way lanes, deck height), ramps at the set grade. Any road under a flyover makes room in its median
— a gap the ramp's width where it is low (its walls stand there), a pier median where the deck is high — and where
a ramp lands in a road that carries on, the ramp merges into it (no junction).

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

### Build palette (standard infrastructure)

Like Cities: Skylines' asset panel: **O** (or a category in the bottom toolbar) opens it; each tile is an asset drawn from its own
cross-section, with a hover card giving its dimensions, limits and the standard it comes from. Click a tile to build.

| Category | What's in it | From |
|---|---|---|
| Roads | access / layout roads (6–15 m), collectors, sub-arterials, arterials, highways (SH 45 m, NH 60 m, expressway), flyovers, ROB, underpass; **Pune USDG** templates 6A–45; **Mumbai SDG** hierarchy; every DP width | IRC:86-2018, UDCPR 2020 §3.2–3.3, PMC USDG 2016, MCGM SDG 2014, IRC:SP:90 |
| Public transport | BRT streets and median stations, bus stops, depots; elevated / at-grade / underground metro, stations (500 m TOD ring), depots; Pune BRT templates | IRC:124-2017, MoR metro MSS 2014 |
| Rail | BG single / double / quadruple lines, viaduct, yards, platforms, stations, goods yards | Indian Railways Schedule of Dimensions |
| Water | canals by discharge class (field channel → main canal), nallas (natural / trained), blue and red flood-line zones, ponds | IS 10430:2000, UDCPR §3.1.1 / §3.1.3 |
| Drainage | open drains, storm pipes Ø 600–1200, box drains, sewers Ø 150–1500 (manholes placed by diameter), STPs | CPHEEO manuals |
| Utilities | water mains Ø 100–1200 (hydrants every 150 m), service reservoirs, gas, telecom and common utility ducts | CPHEEO, PNGRB, MoRTH |
| Power | LT, 11 / 33 kV poles, 66–765 kV towers in their right-of-way corridors, underground cables, transformers, substations | MoP RoW 2015, UDCPR §3.1.2 / §3.6 |
| Paths & places | footpaths, cycle tracks, trails, parks, playgrounds, parking lots, plazas | IRC:86, UDCPR Table 8A |

- **Streets** go to the road tool (all its modes, heights, snapping); the section remembers its asset, and the
  inspector can switch it to another of the same family or **Save as asset** (your own tab, kept in this browser).
- **Routes** (rail, metro, canals, pipes, power lines, paths) use the same modes, carry on from the last stretch, snap
  to their layer's lines; pipes and cables slip into a road's footpath (Alt: the centre line). Hard limits refuse a
  stretch (a metro curve under 120 m, a kink); `,` / `.` step through the tiles, `Shift+,` / `Shift+.` the tabs.
- **Structures** snap onto their line (stations, platforms) or road (BRT stations, bus stops); `[` `]` rotate.
  **Areas**: click the corners, Enter to finish.
- **Checks** (Issues): curves under the limit, buildings inside buffers (6 m canals / nallas, power corridors, 30 m
  railway NOC), buildings in flood zones, roads over rail without 6.25 m clearance and level crossings, BRT stations
  on streets under 30 m, ramps you drew steeper than 3.5 %, and buildings within 15 m of the river.
- In 3D: canals wider than a terrain cell cut into the ground with lining, banks and water; towers and conductors;
  stations, platforms, tanks and substations as simple blocks. Values that are typical or read off drawings rather
  than a clause are marked on the hover card.

### Graphics and performance

- **3D looks** (Settings → 3D graphics): *Simple* (default: flat sky, shadows re-rendered once the camera settles, FXAA
  only, 1× pixels, closer haze with small detail dropped in the distance) or *High* (physical sky with clouds, ambient
  occlusion, live shadows, up to 1.5× pixels).
- The 3D view only draws when something changes (camera, edits, layers); an idle view costs nothing. Dynamic
  resolution steps between 100 / 85 / 70 % of the look's pixel ratio.
- Only one view's render targets exist at a time. Reference imagery (DP sheets, XYZ tiles) is decoded at the size
  the zoom needs, kept within ~96 MB and released when 3D opens. Chunk geometry's JS copies are freed once uploaded.
- If the GPU drops the page (driver reset, out of graphics memory), the map is saved and the page reloads into the same
  view.
- **Ctrl+Shift+P**: performance panel (frame rate while drawing, CPU time, draw calls, triangles, GPU objects, imagery
  and JS memory). Add `?perf` to the URL for GPU timings.

### The whole city (regions)

The map is a **region**: a whole city baked once and cut into 2 km **pieces**. Around the point you're looking at, a
window of 3 × 3 pieces (6 km) is live — editable, full detail in 2D and 3D. Everything else is the **far view**: the
city as 32 m terrain wearing a land-cover image, with its roads as simple ribbons (out to the haze in 3D; the whole
map when the 2D view is wider than 4.5 km, where detail would be sub-pixel anyway).

- When you move more than ~400 m past the centre piece, the window follows: the pieces that left go, the grids under
  the terrain shift (what overlaps carries over), and each arriving piece is paged in and settled on a frame of its
  own (≈ 0.3–0.5 s each in dense areas), so the view stays live. Neighbouring pieces are fetched ahead.
- Edits are kept whatever is in the window: an edited road out of the window keeps its edit and shows it again when
  its piece comes back. Paging isn't an edit (no undo step, not "unsaved").
- A map remembers where it was: it opens with its area in the window. Maps made on the Koregaon Park tile are moved
  into the city frame and re-attached to the city's roads when opened.
- Budgets (measured on a desktop GPU): boot ≈ 8 s, JS heap 0.6–1.1 GB, a window move 2–3 s spread over frames
  (longest step ≈ 0.4 s). The whole city on disk: 82 MB (pieces gzipped).

## Data pipeline (offline)

### A region (the whole city)

```bash
# OSM: Overpass in 4 km cells (node tools/fetch-region.mjs pune) — or, when Overpass is too busy, cut the cells out of
# Geofabrik's western India extract (needs pyosmium: pip install osmium):
curl -L -o data/raw/region/western-zone.osm.pbf https://download.geofabrik.de/asia/india/western-zone-latest.osm.pbf
node tools/fetch-region.mjs pune --plan
python tools/region-extract.py data/raw/region/western-zone.osm.pbf pune
npm run bake:region -- pune    # ≈ 1.5 min: terrain (Copernicus GLO-30 N18E073 + N18E074), the road network imported
                               # once for the whole city, cut into 306 pieces + the far view → public/regions/pune
# Mumbai: the same with `mumbai` (DEM tiles N18E072 + N19E072, from copernicus-dem-30m.s3.amazonaws.com); ≈ 1 min,
# 264 pieces, 34 MB
```

The region is set in `tools/region-config.mjs` (bbox, frame origin, piece size, where the editor first opens, a
blurb for the start menu); each bake also adds the city to `public/regions/index.json`, the start menu's list. A
**coastal** city gets the sea from the DEM: Copernicus sets open water to exactly 0 m, so those pixels (softened to
an 8 m shoreline, patches of ~1 ha and up, never under buildings or ground-level roads) join the water mask — the
ground is carved under them — and become water polygons per piece. `dp: true` applies the PMC DP road widths (Pune
only). Its frame is the DP pipeline's city
frame, so the city-wide DP data needs no conversion; tiles a region takes over (`legacy`) bring their DP sheets and
utility networks along, moved into the city frame.

### A single tile

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

How a DP road's cross-section is chosen at bake time: the road keeps **one** layout along its length — its typical
width (length-weighted median of the pieces) and median — and narrows only where buildings pinch most of a piece at
least 40 m long, or a parallel road (a service lane inside the DP corridor) leaves less room. Where it narrows, the
footpaths go first, then the median, then lane width, so the lane count stays the same. Lanes come from the
carriageway width at 3.0 / 3.25 / 3.5 m (IRC:86) when OSM's lane tags don't fit it, and leftover space under 0.6 m
goes to the footpath instead of a shoulder. Road geometry and ids don't depend on this, so maps edited on earlier
bakes still line up.

Sheets live in `data/raw/dp/` (downloaded from PMC's public file store). Sector II–VI sheets are 1:10,000
(≈0.84 m/px at 300 dpi). Cantonment areas are not part of the PMC plan and keep estimated widths.

**DP underlay for the editor**: `python tools/dp/tiles.py [sheet ...] [--res 0.5]` resamples every registered sheet
(default: all with a `.reg.json`) through its registration into 500 m × 500 m RGBA WebP blocks at 0.5 m/px under
`public/tiles/kp/dp/` (`index.json` lists each block's `x0`/`z0` in tile metres; legend and uncovered areas are
transparent; overlaps take the sheet farther from its frame edge). ≈45 s, ≈13 MB for S2-06 + S2-07.

**Whole-city DP (Pune)** — `cities/pune/city.json` catalogues the plans and their sources (PMC's sanctioned DP for the
old limits: 21 scanned sheets; the merged-villages draft; PMRDA's regional plan; PCMC) and defines a city frame. The
sheets are registered once to the city, and any tile takes its part of the plan from there:

```bash
node tools/dp/cityref.mjs pune                                  # OSM roads + water for the city (reference)
DP_CITY=pune python tools/dp/align.py S2-01 …                    # coarse fit per sheet (1:10,000: free scale search)
DP_CITY=pune python tools/dp/align.py --scale=0.1685 --seed=0,0,4000 S1-01 …   # 1:2,000 old city: seeded window
DP_CITY=pune python tools/dp/register.py S2-01 …                 # block-wise local registration (≈2–4 m RMS)
DP_CITY=pune python tools/dp/qa.py                               # per sheet: OSM roads on the sheet's corridors vs shifted
DP_CITY=pune python tools/dp/trace.py                            # line-based tracing → plots per sheet
DP_CITY=pune python tools/dp/plan.py --tiles kp                  # merge → plan.json / plan.geojson, export tile regions
```

The tracer (`trace.py`) follows how a sheet is drawn rather than colour blobs: black plot lines, red verges, blue
modification lines and every change of fill cut the sheet into faces; each line pixel goes to its nearest face, so
neighbouring polygons share their edges exactly (no gaps, no overlaps); faces take the land use most of their pixels
show; neighbouring faces of one land use merge into a parcel, except reserved sites (enclosed by a red verge), which keep
their own outline. Sector I's 1:2,000 sheets shade every building grey over the plot colour, so they're classified by
hue family. Polygons are simplified as one coverage (edges stay shared). Overlaps between sheets: the more detailed
sheet wins, then the one the plot sits deepest in. For Pune: 21 sheets → ≈7,900 parcels (≈600 reserved) over the old
limits. Cantonments aren't in the PMC plan. Codes / road widths printed on the sheets aren't read yet (OCR next).

**DP regions** (no vector DP is public, so they're traced from the sheets): `python tools/dp/regions.py [sheet ...]`
mosaics the registered sheets at 1 m, calibrates the legend's land-use colours on the sheets, classifies pixels
(CIELAB), bridges thin plot / building lines within a land use (never across a red verge), and traces each patch into
a polygon in tile metres → `public/tiles/kp/dp/regions.json`. A red verge around a patch, or a circled code (found as
red circles) on it, marks a site reserved for a public purpose; pale blue is water or C-1 commercial, decided by OSM
water. Each region has a confidence (colour fit, solidity, size). ≈30 s, 2,640 regions / 135 reserved for S2-06 + S2-07.
In the editor, **DP regions** (<kbd>Shift D</kbd>) shows them; hover one to read it. Survey aid, not legal boundaries.

**Surveying DP regions**: Review → **DP regions** walks the reserved sites (or every region) in a walking order. Click a
region (or <kbd>N</kbd> next) and the inspector shows the DP sheet close-up at the site's code to read it (`PG 61` → play
ground no. 61, from the legend), the land use, and the survey: *matches the plan* (<kbd>Y</kbd>), *differs*, *built over /
encroached*, *can't tell*, with notes and photo links. The first edit makes a `region` object (a snapshot of the traced
shape, same id) in the map, so surveys save, publish, fork and export (GeoJSON `dp_region` features) like roads.
The **fill tool** (<kbd>W</kbd>) traces any plot on the DP sheet underlay into a survey region with one click (flood fill by
colour in the browser, stopping at plot lines and red verges) — for plots the automatic tracing merged or missed.
**Checks** against the plan (Issues): *buildings in the DP road reserve* (where the DP widens a road past today's width)
and *buildings on a reserved open space* (gardens, playgrounds, parks — skipped once surveyed as matching the plan).

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

- **Transitions**: where two roads meet within 25° of straight there's no junction surface — the joint is mitred, and
  if the cross-sections differ each part (lanes, median, footpaths, matched by kind) tapers to the joint at 1 : 10;
  an extra lane or a new median grows from nothing.
- **Heights**: ground roads are level across their width and follow the terrain along it (smoothed ±12 m); a junction
  is one plane (tilted at most 5 %) and its arms meet it exactly. The terrain is cut / filled to the roads with 1 : 2
  side slopes.
- **Junction markings** (IRC:35): solid stop lines at signals, give-way lines and triangles on minor arms, lane
  arrows from the arms' directions, solid lane lines over the last 30 m, zebras broken at medians, rounded median
  noses, right-turn guide lines through big signalised junctions, optional yellow keep-clear box.
- **Traffic signals**: poles on the kerb at each approach (mast arms over multi-lane ones), pedestrian signals at the
  zebras, lit for the phase picked in the junction's **Signals** tab (phases group the most opposite arms); symbols
  in 2D.
- **Slip lanes**: the junction's **Slip lanes** tab adds a free-left lane round any corner between neighbouring arms —
  tapers off and onto the arms, a raised island, a footpath outside, a give-way line where it rejoins. It follows the
  arms across their pieces; corners too tight or arms too short say so.

## Layout

```
src/doc/      City Document: types, base (bake → sections / junctions / roads / layers), CityDoc (patch, inheritance,
              undo), compile (→ road mesher), ops (split / join / bend / pen …), xsection, format, issues, api, export
src/editor/   editor controller + tools, plan view, hit index, overlay, commands (menus / palette / shortcuts)
src/scene/    World (road chunks per edit, lazy terrain / buildings / trees / rail / pipes), reference imagery
src/ui/       Preact panels: map corners, bottom bar, tool panel, layers / roads / issues / review, inspector, cross-section, dialogs, theme
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
