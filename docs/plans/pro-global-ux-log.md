# Log: Pro's global UX (docs/plans/pro-global-ux.md)

Newest first. Each entry gives the phase, what changed, how it was checked, and what's left or known to be off.

---

## 2026-11-24 · The ground cutaway and section steady

**Why:** the user said the ground is glitchy in Shaded with Ground and Section on.

**What changed:**
- **Section** (src/pro/scene.ts):
  - Before: the earth's slices are built already cut at the plot's middle, and the section's clipping plane sat exactly on that cut face. A face lying on its own clipping plane is kept or dropped pixel by pixel as the camera moves, so the face flickered, showing the block's insides through it.
  - Now the plane sits 6 cm in front of the face, and the face draws solid.
  - The red frame round the cut and the water's line on it are now drawn just in front of the face. Before, both were clipped away.
- **Ground, see-through:** the soil layers are transparent slabs that used to sort themselves. They swapped order as the camera moved, and their colours flickered. They are now drawn deepest first, in a fixed order.
- **The stage** (src/pro/pro.css):
  - Below 900 px wide, the compass's narrow-screen position (`top: 84px`) also applied inside the bottom toolbar. It pushed the compass out below the stage, so the stage could scroll, shifting the 3D view up and leaving a black band.
  - The compass in the toolbar now resets `top`, and the stage clips rather than scrolls (`overflow: clip`).

**Checked:**
- tsc passes, npm test is all OK and the build is OK.
- In the app, in a separate tab with saving blocked, on the user's project at 1344 × 760 and at the pane's width: Ground and Section at Draft and High.
- The cut face draws solid and steady. Comparing with the plane back on the face showed the old mixed, see-through face.
- No band below the view, and no console errors.

**Left or known to be off:** at Draft, layers with similar browns read close together on the cut face. The lines at each layer's top still separate them.

---

## 2026-11-24 · Kerbs and footpaths follow the road's edge; the view menu laid out as a menu

**Why:** the user showed footpath slabs lying across the road where the drive meets the building's turning head, and asked to fix it. They then showed the view tools menu (⋯) with its items centred and an outline round Snapping.

**What changed:**
- **Kerbs and footpaths** (src/pro/scene.ts, the site kit):
  - Before: 2 m boxes set out from each road's centre line, so at junctions and turning heads they landed on the other road's asphalt, and on curves they broke into separate tiles.
  - Now they are drawn from the road surface as it is laid. The kerb is a 150 mm strip round its edge, with sides. The footpath is the next strip out.
  - Both are cut back from the buildings, the lots, the roundabout islands and the plot's edge, so junctions stay open and curves are continuous.
  - Each is one merged mesh.
  - Poles are no longer placed on another road where roads meet.
- **The view tools menu** (src/pro/pro.css): the toolbar's button style was also styling the menu's items. Menu items in a toolbar group are now reset: left aligned, their own height, no outline on the checked item.

**Checked:**
- tsc passes, npm test is all OK and the build is OK.
- In the app, in a separate tab with saving blocked, on the user's project: the junctions and the turning head round the round tower have continuous kerbs with nothing over the asphalt.
- The menu opens with its rows aligned.
- No console errors.

**Left or known to be off:** where a lot's paving runs right up to a road there is no footpath (the lot takes that strip).

---

## 2026-11-24 · Pools as a site element

**Why:** the user asked for pools as a site element.

**What changed:**
- **A new site element, Swimming pool** (src/doc/site.ts):
  - You drag out its area like a garden or a play area.
  - The drawn area is the pool with its deck: the water is inset 1.5 m (`POOL_DECK`).
  - It is on the Draw tools (src/pro/edit.ts, "Pool") and on the Landscape shelf (src/pro/shelf.tsx).
- **Nothing is laid over it:**
  - Gardens, paths, beds and plants keep clear of it, and a building drawn over it is flagged as overlapping.
  - The optimiser keeps it where it is drawn (src/doc/optimise.ts).
- **It counts as open space:** a pool is allowed in the recreational open space.
  - The ground layout takes pools separately (`pools` in src/doc/ground.ts).
  - Pools are kept clear like a structure but are not taken off the open area.
- **In the scene** (src/pro/scene.ts):
  - a timber deck over the drawn area;
  - a flamed granite coping, 300 wide, standing just above the deck;
  - pool water a hand below the coping's top.
- **In the wireframe** (src/pro/wire.ts): the water's edge is drawn and hatched inside the deck outline.

**Checked:**
- tsc passes.
- npm test is all OK. test-landscape adds a pool case: the pool is kept, nothing is laid over it, the garden round it is, and the open area is the same with and without it.
- The build is OK.
- In the app, in a separate tab with saving blocked: a pool in a garden, shaded at Draft and in wireframe. The deck, coping and water show, and the garden path goes round them. No console errors from the pool. (One error came from a malformed test call with no buildings list, not a user path.)

**Left or known to be off:**
- Site elements have no cost lines, so a pool adds nothing to cost yet.
- The pool's depth and sides aren't modelled: the water is a flat surface with no basin below.
- Its shape follows the drawn area only (no freeform or kidney shapes).

---

## 2026-11-24 · Realism, second part: water, play surfaces, walls in their material, richer building textures

**Why:** the user asked to continue on more materials.

**What changed:**
- **New landscape surfaces** (src/pro/render/landscape/surfaces.ts):
  - still water and pool water: deep to shallow colour, wrapping wind ripples, mirror-smooth;
  - rubber play surface (EPDM granules), blue and red;
  - timber deck with board gaps, grain and screw pairs;
  - flamed granite 600 × 300;
  - cobbles 100 square.

  31 surfaces in all.
- **In the scene:**
  - a site's water features and wells are water;
  - play areas drawn or laid by the plan are red rubber;
  - tree groves are mulch;
  - the compound wall is its design system's library material (it was a flat colour);
  - kerbs and footpaths take their texture from the world, so it no longer stretches along each piece.
  - `boxUV` (src/pro/render/pbr.ts) is now shared and chains after other shader changes; it also places the roughness map.
- **Building materials** (src/pro/render/textures.ts):
  - every library material gets a roughness map: the face as its finish (gloss tiles 0.18, satin 0.45, textured 0.93), joints and pores rough;
  - ashlar stones each take their own shade;
  - marble-look slabs get veins;
  - fair-faced concrete gets form-tie holes, four to a 1200 × 600 panel.

**Checked:** tsc; npm test, all OK (test-landscape covers the new surfaces for range, repeatability and no seam); build OK. In the app, in a separate tab with saving blocked: top, street and close views at Draft and High, with the pond, play area, wall, kerbs and trees; no console errors.

**Left or known to be off:** water is a flat, still surface (no animation, no transparency to a bed below). Pools aren't a site element yet, so 'pool-water' and 'deck' have no user. Building facades have no weathering (rain streaks, splash at the base) yet.

---

## 2026-11-24 · Utilities on the plot: power lines snap to poles, stay joined and move together

**Why:** the user reported that the utilities on the plot (power lines, poles or transformers, wells, the water tank) didn't snap and didn't work. In the app: a power line's nodes snapped only to the plot, the buildable line and the buildings, so a line couldn't be put on a pole. Moving a pole left the line where it was. A click on the middle of a line picked the plot, as a line could only be picked within 16 px of one of its nodes. A node clicked and then Delete removed the whole line, as the handle never took focus.

**What changed:**
- **The utilities as one network** (src/pro/utilityNet.ts, new, pure): a join is where things are, not a stored link. A line node on a pole, a tank or another line's node is joined to it. `netTargets` gives what a utility snaps to: poles', wells' and tanks' middles, the power lines' nodes and lines, the roads' nodes, centre lines and edges, walls, gates, and the areas' corners and edges. `carry` and `hubMoved` take the line nodes on a pole or a tank along when it moves. `joinOnto` and `joined` give a line a node where a pole is put on it, or where another line's end lands on it, so they're joined from then on. `nodeMoved` drags a line's node and takes the other lines' nodes joined there along. The pole it was on stays.
- **Snapping** (src/pro/edit.ts): drawing anything but a building, or moving a feature or a thing on the grounds, now snaps to the things on the plot as well as the plot and the buildings. A thing being moved never snaps to itself or to the line nodes it carries. A tank snaps by its middle, not its 1 m stub's ends. The targets cache is keyed on what's excluded as well as the evaluation.
- **Moving** (src/pro/edit.ts `moved`, used by dragging and the arrow keys): a pole, a well or a tank moved takes the line nodes on it along, and a pole moved onto a line joins it. A whole line moved leaves the poles where they are. A pole put down with the tool joins the line it lands on (`finish`).
- **Picking** (src/pro/edit.ts `featureAt`): point features first, as they sit on the lines; a pole by its 9 m post, not only its foot. Then a line anywhere along it (10 px), then an area.
- **Node handles** (src/pro/objHud.tsx): a dragged node snaps to the things on the plot, and it joins or carries as above. A node pressed takes keyboard focus, so Delete removes that node (a line keeps at least 2) instead of the whole line.

**How it was checked:**
- New tools/dev/test-utilities.ts in `npm test`: 28 checks on the targets, carry, joins, node drags, and `moved()` for a pole, a whole line and a tank. tsc clean, npm test all OK, npm run build OK.
- In the app, in a separate tab with saving blocked, Plan then 3D. A click on a line's middle picks the line. + then Delete adds a node and takes it away; the line stays. A pole dragged 11.5 m takes the line's end along. A line's end dragged off a pole leaves the pole, and dropped 2 px from an off-grid pole (-20.37, 40.13) lands exactly on it. A pole placed with the tool on a line gets a node in the line. In 3D, a click 15 px up the post picks the pole, and dragging it bends the line with it.

**Left or known to be off:**
- Joins go by position (within 5 cm). Two lines drawn through the same spot without a node there are crossing, not joined, until a pole or a node is put there.
- A line's node dragged off a pole detaches it; to move them together, drag the pole.
- The snap word by the pointer ("corner") stays after a drag until the pointer moves again. That's old, and the same for buildings.
- For realism: a power line is still a 0.6 m grey strip on the ground with a clearance band. There are no wires, no poles at its nodes unless placed, and no sag. A pole is a plain 9 m box with no cross-arm, insulators or transformer. A well is a flat disc, and the tank a plain cylinder. A real look would draw poles at the line's nodes (RCC or steel, cross-arms), wires with catenary sag at about 7 to 9 m, a pole-mounted or plinth transformer, a well's parapet, and a tank on its staging. All are small instanced meshes in src/pro/scene.ts (features loop), reusing `hubOf` and the joins to know which nodes have poles.

---

## 2026-11-24 · Realism, first part: a landscape kit (surfaces and trees grown in code)

**Why:** the user asked for realistic textures for roads, earth, trees and the rest of the landscaping, modular by design.

**What changed:**
- **A landscape kit**, src/pro/render/landscape/:
  - noise.ts: tileable value and fractal noise, a tileable Voronoi, and a Field (colour, height, roughness) that recipes paint into.
  - surfaces.ts: a registry, `SURFACES`, one entry per surface. Each entry is the tile it repeats over in metres, its bump, and a paint recipe. There are 24: asphalt (new and worn), sawcut concrete, kerb, grey and red paver blocks, Kota stone, path tiles, grass pavers, lawn, wild grass, bark mulch, earth, dry open ground, fill, silt, black cotton (cracked), stiff and soft clay, sand, gravel, murum, basalt, weathered rock. Recipes that differ only in colour share a maker (soil, cracked, stones, rock, units, grass). `surfaceOfCover` and `surfaceOfRoad` map the ground covers and the site kit's road surfaces onto them.
  - material.ts: a surface becomes a material with a real-colour map, a normal map and a roughness map, cached. A macro pass varies the colour ±15% at 11× the tile, so large areas don't show the repeat. Drawn at 256 px even in Draft, 512 at Standard, 1024 at High.
  - trees.ts: a registry, `SPECIES`: rain tree, round shade tree (neem, karanj), coconut palm, ashoka, shrub. Each is grown in code: tapered, barked limbs branching to a set depth, and a crown of alpha-cut leaf sprays (pinnate, broad, drooping, small, palm fronds) with outward normals. There are 3 variants per species and near and far detail; trees are instanced and cast leaf-shaped shadows.
- **The scene** (src/pro/scene.ts) asks the kit for every ground surface:
  - outside roads are worn asphalt;
  - internal roads take the site kit's surface;
  - parking is pavers (concrete when the drive is pavers);
  - paths are path tiles;
  - the plan's open green is lawn (before, it wasn't drawn), with lawns and beds (mulch) on it;
  - kerbs and footpaths are kerb stone and concrete;
  - the plot takes its ground cover's surface, else pavers;
  - the open ground round the site is dry scrub.
  - The old low-poly trees (src/build/plants.ts) are no longer used by Pro; the old trees are still used by src/scene/world.ts.
- **Placed trees have a species** (`SiteFeature.species`; a Species picker beside Canopy in the inspector).
- **Path-traced stills** keep the leaves' and bark's maps and alpha (the bake keeps uv and rounds colours, so leaves don't split into a mesh per shade).

**Checked:** tsc; npm test, 13 suites all OK, with the new tools/dev/test-landscape.ts. It checks each surface for colours in range, repeatable painting and no seam at the wrap, and each species, variant and detail for finite geometry, normalised to a canopy of 1. Build OK. In the app, in a separate tab with saving blocked, at Draft and Standard: no visible tiling on the open ground; the paver drive, lawn and kerbs read; all five species side by side; no console errors.

**Left or known to be off:** footpaths and kerbs are instanced boxes, so their texture stretches along a piece. The surfaces are procedural, not photo-scanned (the scanned-set loader in render/textures.ts still covers the building materials only). Water (ponds, pools) has no surface yet. The ground map still lays plants that aren't drawn.

---

## 2026-11-24 · Trees only where the user puts them; the Ground panel fits its width

**Why:** the user found the trees laid out automatically "nonsensical" and asked for them to go unless added. The plot inspector's Ground section ran wider than the panel and scrolled sideways.

**What changed:**
- **Trees** (src/pro/scene.ts, src/pro/wire.ts): the 3D view and the wireframe draw only trees placed as site features (Site's Tree). Gone: the trees the ground map scatters in the garden, along the wall and on parking islands; the design system's avenue or dense rows; the trees every 9 m along internal roads. The garden's low shrubs in the beds and the design system's hedge stay. The ground map still lays its plants (other code reads them); they're just not drawn as trees.
- **Review** (src/pro/review.ts): "A tree for every N m² of plot" now counts the trees the user placed, so it agrees with what's drawn. Most schemes will show it unmet until trees are placed.
- **Ground panel** (src/pro/groundPanel.tsx, pro.css): the quick fields are Top layer full width, then Rock at and Water at side by side. The log's table is now a list of layers, each a name row (swatch, kind, remove) over Thick and Bears. The log column is 60 px wide. The inspector's body has a `minmax(0, 1fr)` column, so nothing in it can push it wider.

**Checked:** tsc, npm test (all 12 OK). In the app, in a separate tab with saving blocked: the inspector body's scroll width equals its width; a generated slab scheme shows no trees, then the two placed trees, no console errors.

---

## 2026-11-24 · The plot's ground: geology, foundations, basements, 3D cut-away (docs/plans/plot-ground.md, all 7 steps)

**Why:** the user asked for a geology layer on the plot: a surface cover, levels across the plot, and the layers of earth down to rock, with each building's basements and foundations decided from what the user says is in the ground. Mid-way they asked for 3D cut-aways, a sweep across elevations, plots and buildings, and a report.

**What changed:**
- **The ground** (src/pro/ground.ts, new): 11 soil kinds with presumptive bearing, unit weight, how they dig, whether they stand, swell or liquefy; a surface cover; layers, water table, boreholes (blended by inverse distance) and spot heights; six presets (Pune typical, Pune rock, Mumbai suburbs, Mumbai island, sandy, clay); a borehole log pasted as text is read (`parseLog`).
- **Foundations and the dig** (src/pro/foundation.ts, new): per building, footings, footings on rock, raft, piles or piled raft, or under-reamed piles in black cotton, with the reason; the dig by layer, shoring type, dewatering, tanking, uplift anchors; cut and fill for the levels; flags (water, shoring, liquefaction, basements on a slope, more basements than the ground makes worth it). The money takes only the net over an ordinary site (stiff clay, murum, then rock), so a project with no ground keeps its figures exactly.
- **Basements:** the engine digs no more basements than the ground makes worth it (`basementCap` into `PlotSite.maxBasements`, src/doc/site.ts). A count the user asks for is kept and flagged.
- **Where it shows:** Plot inspector's Ground section (presets, cover, quick fields, a draggable log, layers table, boreholes, spot heights, what it makes of the scheme); a Foundation section on each building; the deal's "Ground works, over an ordinary site" line; Scrutiny rows; Approvals documents (soil report; excavation and shoring design past 6 m); the Section sheet draws strata, water and foundations; a new "Ground and foundations" sheet. DXF is unchanged on purpose (PreDCR format).
- **3D cut-away** (src/pro/scene.ts): toolbar Ground (key g) and Section. Ground shows the layers under the plot; Section cuts the block through the middle: textured solid layers, the basements' hole, water, rafts, piles on the cut face, boreholes. New soil textures (sand, cracked, gravel, rock).

**How it was checked:**
- `npx tsc` clean, `npm test` all OK (new tools/dev/test-ground.ts: model, log parsing, boreholes, a 150-case matrix, hand cases), `npm run build` OK.
- tools/dev/sweep-ground.ts (not in npm test, ~3.5 min): 4 cities × 9 grounds × 4 elevations × 4 plots × 3 builds, rotated to 576 cases. All OK. It found the ordinary baseline was stiff clay to 60 m, which put towers on friction piles and gave a net of −₹18 cr; fixed to clay, murum, rock. Net now −0.2% to 13.7% of cost.
- In the app, in a separate tab with saving blocked: Mumbai suburbs 22-floor tower with 2 basements, and Pune typical on a 6% slope with slabs; the cut-away, section, foundations and panel render, no console errors.

**Left or known to be off:** rates and bearing figures are presumptive and labelled "as assumed"; the elevation changes cut and fill but barely the net (about 0.3 points); the basement cap seldom bites on the presets (most cases keep 2); spot heights don't yet tilt the 3D ground surface; no settlement check.

---

## 2026-11-24 · Design offers only base primitives (docs/plans/pro-design-freedom.md §3.6)

**Why:** the user asked for only base primitives in the Design tab.

**What changed:** the Design tab's Shapes are Box, Round and Wedge (src/pro/masses.ts `MASS_SHAPES`). L, U and Courtyard are gone from it; they're made by the booleans from primitives, each piece a part to move or change. The same list feeds the Parts panel's new-part buttons, so it offers the same three plus the drawn Rectangle, Polygon and Circle. The "ready parts" row (podium, wing, notch, slot, trim) is gone from Parts too. Those shapes and part kinds stay in the code for projects and templates already made with them (`shapePlan`, `newPart`).

**Checked:** tsc, npm test (all OK), build. In the app, in a separate tab with saving blocked: Design lists Box, Round, Wedge and the three drawn footprints; Parts on a picked building lists the same, and there's no ready-parts row.

---

## 2026-11-24 · Booleans hardened: cut faces, a stress test, many parts (docs/plans/pro-design-freedom.md §3.6)

**Why:** the user found the shaded 3D broken after a boolean. They asked for the key use to be tested until it can't break, with radically different shapes and many cuts and booleans.

**What was wrong:** a cut part made by Design or Combine had its face set to Open, which draws no wall on the cut's edges (meant for a sky garden under floors). A round cut through every floor, or a Combine Cut from a lower building, left the floors bare, slabs and no facade.

**What changed:**
- **A third cut face, Facade** (`face: 'skin'`, src/pro/form/types.ts): the cut's edges are the floor's own outline and take the building's skin. It is the default for cuts made in Design, from Parts' shapes, drawn, or by Combine (src/pro/parts.ts). Parts' face switch is now Facade · Glazed · Open.
- **Open means open only under a floor** (src/pro/form/lay.ts): where nothing above roofs a cut, its open faces take the skin. A sky garden two floors high stays open on both; a notch out of the top floors, or a full-height cut, doesn't. Projects saved with an open full-height cut draw right without being changed.
- **Many parts** (src/pro/formHud.tsx): with more than 4 parts, the view shows the handles and chip of one part only, the one pointed at in the Parts list, else the newest. All the outlines stay. The Parts list says so.
- **Circles and smooth parts** get no edge push/pull handles; they bunched up on a 12-point circle.

**How it was checked:**
- `npx tsc` clean, `npm test` passes (now with test-booleans), `npm run build` OK. The `evaluate()` snapshot is unchanged.
- tools/dev/test-design.ts, 9 new checks: a full-height cut leaves no open face; a glazed one stays glazed; a two-floor sky garden stays open on both floors and the floors it misses have no cut; a notch at the top takes the skin; a Design cut is faced with the facade, and stays so under floors above; add, intersect and exclude leave every floor whole.
- **tools/dev/test-booleans.ts** (new, seeded):
  - 10 base shapes: box, round, L, U, wedge, a 7-point star, a comb, a 90 × 9 m bar, a zigzag, an 80 × 36 m ellipse;
  - each base with 12 cuts, 16 of all four booleans, 40 of all four, and 25 adds and cuts, three times over: 120 layouts;
  - each part a random shape, size, turn, place (some off the half-metre grid), floor range and face, a few switched off;
  - all 1,201 floors match an oracle that applies the same booleans in order, worst error 0.0 m²;
  - every layout is built as the shaded view builds it, whole and X-rayed, across eight skin patterns: no throw, no NaN;
  - about 9 s.
- **In the app:**
  - the user's Building A (11 floors, tapered, a round cut through all of it) now shows its facade on the cut;
  - the same part switched to Add, Intersect, Exclude and a glazed Cut, each drawn whole;
  - Wireframe and X-ray drawn;
  - Combine Cut from a 6-floor building drawn with facade under the floors above;
  - Parts' Round as Cut, Intersect and Exclude, each undone with Ctrl+Z;
  - a Circle… drawn into the building;
  - a 14-floor star with 30 mixed parts drawn with no console errors, its handles one part at a time, following the Parts list.
  - Each test was taken back out; the project is as it was.

**Known (both fixed the same day, below):**
- The first Circle… drag in the app added nothing, and the second did.
- With many parts, all the outlines still show. They read as a tangle on 30 parts.

**Follow-up, the same day: the two known items fixed.**
- **A drawn shape that added nothing** (src/pro/edit.ts). A drag thinner than 1 m on a side quietly became the first corner of a click-the-corners outline. A footprint under 3 m was dropped and the tool ended, saying nothing. Now:
  - a thin drag says "Too thin to be an area: drag at least 1 m each way, or click its corners";
  - a footprint under 3 m says "Too small to be a footprint", whether it's a new building or drawn into one;
  - either way the tool stays armed for another go.
  Also, a drag's far corner snapped onto the line its first corner is on (seen in the app: "4.1 × 0.0 m on the edge") no longer folds the box flat: that side keeps the pointer's position.
- **Outlines with many parts** (src/pro/formHud.tsx): with more than 4 parts, only the part in focus gets its full outline (bottom ring, top ring and corner lines). The rest get one ring at their top floor.
- **Checked:**
  - `npx tsc`, `npm test` and `npm run build` pass.
  - In a second tab with storage writes blocked, so the user's project, open in the first tab, wasn't touched: the 30-part star read calmly in Shaded, with one ring per part and the focused one in full.
  - Thin and small drags each gave their message, added nothing and kept the tool. A normal drag after them added the part.

---

## 2026-11-24 · CAD booleans: add, cut, intersect, exclude; Combine; parts as shapes (docs/plans/pro-design-freedom.md §3.6)

**Why:** the user placed a Box and a Round that overlapped and asked how a designer cuts the cylinder out of the box without being confused. There was no way to: every Design shape made a new building, Parts offered only set pieces, and the overlap was only flagged as a fault. They asked for all the common CAD booleans and operations.

**What changed:**
- **Exclude** (xor) joins Add, Cut and Keep (now shown as Intersect) as what a part does (`PartOp` 'xor'; src/pro/form/lay.ts takes the overlap out of the floor and adds the rest of the part).
- **Combine** (src/pro/combineUi.tsx, `combine` in src/pro/parts.ts):
  - a shaped building overlapping another shaped one gets **Combine** on its bar, and a line at the top of the inspector: "Overlaps Building B: make them one", with Add, Cut, Intersect and Exclude;
  - the other comes across as a part in the picked one's frame and the other building goes;
  - floors: Add and Exclude make it as tall as the taller (an exclude adds the other alone above), Intersect as low as the lower;
  - the toast says what didn't come across (a taper or twist, its own parts or spaces), and Ctrl+Z undoes it.
- **Design into a building:** with a shaped building picked, the Design flyout says "Picked: Building A. What you make next is New · Add · Cut · Intersect · Exclude". With a boolean chosen, a shape lands as a part where it's clicked (its outline under the pointer first), or a footprint is drawn as one. The templates and the Courtyard are for new buildings only.
- **Parts' Add:** a boolean, then Box, Round, L, U, Wedge (at the middle, sized to the plan; an add beside it), or Rectangle…, Polygon…, Circle… (arms Design's drawing tool into the building). The set pieces (podium, wing, notch, slot, trim) stay below.
- **Each part, in the Parts list:** turn 15°, turn 90°, mirror left for right, mirror front for back (each a copy across the form's middle), copy. Parts are named for what they do and their shape ("Cut · Round", "Add · Building B").
- **On the view:**
  - each part is outlined at its lowest and highest floor with its corners up, solid for add and intersect and dashed for cut and exclude;
  - a chip over it names it in its boolean's colour (green, red, violet, amber);
  - a round handle at its middle moves it (0.5 m steps, Alt 0.1 m, arrow keys too).

**How it was checked:**
- `npx tsc` clean, `npm test` passes, `npm run build` OK. The `evaluate()` snapshot is unchanged.
- tools/dev/test-design.ts, 17 new checks:
  - each boolean's area for a 24 m round on a 30 × 20 box: Cut 184, Add 636, Intersect 416, Exclude 220 m²;
  - a Parts-list part at the middle, sized, named and on all floors;
  - a circle drawn on a building, in its frame;
  - move, turn, mirror and copy;
  - Combine: Cut keeps 7 floors and loses the overlap, Add goes to 8, Intersect keeps the overlap, Exclude adds the round alone above, and a twist is reported as not carried.
- **In the browser,** on the user's Box (A) and Round (B):
  - A's inspector read "Overlaps Building B: make them one" with the four booleans, and its bar showed Combine;
  - Cut turned B into a part of A: the plate went from 595 to 346 m², the overlap fault cleared (5 fails to 1), and the cut showed dashed with its chip;
  - the chip read "Cut · Cut · Building B", fixed to "Cut · Building B";
  - Design with A picked showed the switch, and Cut offered Box, Round, L, U, Wedge, Rectangle, Polygon and Circle; the flyout was too narrow for the switch, widened to 330 px.
  - The user was working in the same tab during the check, so the clicking stopped there. Their storage wasn't restored over their edits: the Cut done in the check is in their project (Ctrl+Z, or the Parts list, takes it out).

**Left or known:**
- A part can't yet be picked by clicking it on the view; its handles and the Parts list do that.
- Parts are prisms: a tapered or twisted building combined loses its taper as a part (said in the toast).
- Exclude doesn't record its inner faces as cut faces (no glazing drawn there).

---

## 2026-11-24 · Design: the form first, then its floors (docs/plans/pro-design-freedom.md §3.6)

**Why:** the user said form design is the most important thing in Pro. The shelf's Building tab should be **Design**: basic shapes and CAD tools to design the form, then tools to make floors out of it. Until now a building from the shelf was a plain engine slab, which had no form to sculpt until "Shape it", and only a straight one could be shaped.

**What changed:**
- **The shelf:** Building is now **Design**, with a cube icon. The flyout says: make the form, then make its floors.
- **Shapes** (src/pro/masses.ts, one click, long side to the road): Box, Round, L, U, Courtyard (the court a part cut through it), Wedge. Each shows its outline under the pointer before the click.
- **Draw a footprint:**
  - Rectangle: drag it out, or click its corners, or type width and depth;
  - Polygon: click its corners;
  - Circle: drag out its box; a long box gives an ellipse.
  - A footprint is taken in the road's frame, about its middle.
- **What lands:** each one lands as a **form**, ready to sculpt (rings, key floors, plan points, parts):
  - in the project's use, so offices on an office project and none on a project with no use yet;
  - about as tall as it is wide, then kept to the height limit and the floor area left (`placeMass` in src/pro/edit.ts, as templates are);
  - on a plot still filled for you, the first mass takes the filled buildings' place.
- **Start from…** the templates stays below. The engine's plain shapes (slab, tower, L, U, courtyard, a line of wings) are no longer offered; buildings already made with them still work and can still be shaped.
- **The Floors section** in the inspector, right after Parts:
  - Height (m), Floor to floor (m, or By use) and Floors: the height and the floor height cut the form into floors;
  - what each range is for, bottom up, with "Floors on top" and "A ground floor" (shops);
  - heights and double-height spaces by range, which was the Levels section.
  - A floor-to-floor height for every floor is kept as a level range from floor 1 to 999, first in the list, so ranges set apart win over it.
- The checklist's "Put a building on the plot" arms the Box.

**How it was checked:**
- `npx tsc` clean, `npm test` passes, `npm run build` OK.
- tools/dev/test-design.ts (in `npm test`), 22 checks:
  - each drawn footprint's area (a 30 × 20 rectangle, a 24 m circle, a polygon L either way round, one along a turned road), and that one under 3 m is refused;
  - each shape's area, and the court as a cut part;
  - the starting floors;
  - the use following the project, and the height limit kept;
  - the floor-to-floor height, a range set apart over it, By use, and the floors a height makes.
- The `evaluate()` snapshot is unchanged.
- **In the browser,** on the local commercial project:
  - the shelf reads Select, Design, Draw, Plot, Measure, Outline, and the flyout shows Shapes, Draw a footprint and Start from…;
  - a dragged circle landed as a 24 m round office mass of 12 floors, picked, with its rings;
  - Floor to floor 4 m re-cut it to 11 floors, 44 m;
  - A ground floor made floor 1 shops;
  - the Courtyard's outline followed the pointer;
  - the project was restored afterwards.

**Left or known:**
- §3.6's next list: dimensions typed on the view, offsets and fillets, parts drawn with the same tools, height dragged in metres, several masses joined.
- The Courtyard's preview shows its outside only, not the court.
- A drawn mass can land past the margins: it's flagged, not moved.

---

## 2026-11-24 · Start from…: a plain building first, templates behind a button (docs/plans/pro-design-freedom.md, step 8)

**Why:**
- The Building flyout opened on 19 housing-flavoured templates, with the plain shapes folded away under "Basic". The plan's main path is the other way round: draw a mass, shape it, then say what it's for.
- A Twisted tower dropped on an office project came in as flats.

**What changed:**
- **The flyout** (src/pro/gallery.tsx): the plain shapes come first, in the project's use. **Start from…** (with the count) opens the templates, and stays open or shut for the browser session; picking a template keeps it open. A note says a template lands as parts and uses that can all be changed.
- **Uses** (src/pro/edit.ts `placeTemplate`): a tower or sculpted template's floors of homes take the project's use (offices, shops, none…). Homes and public templates, and mixed projects, keep the template's.
- **Parts** (src/pro/form/templates.ts):
  - template parts have names: Podium, Sky garden, Glass slot, Court;
  - Office on shops is a plain tower plate with a Podium part added on floors 1–2, so either can be changed on its own;
  - the side-view thumbnails draw added parts, so the podium still shows.
- **Where it came from:** the inspector's line under the name ends "from the Sky garden template".

**How it was checked:**
- `npx tsc` clean, `npm test` passes (5 new checks in tools/dev/test-parts.ts: the podium part, its area, named parts, uses following the project, a public template keeping its own), `npm run build` OK.
- **Snapshot:** only the sample made from Office on shops moves. Its tower plate is 292.53 m² a floor, not 292.79, now that it's drawn rather than scaled from key floors; saved projects keep their stored forms.
- **In the browser:** the flyout shows the six plain shapes, then "Start from… 19 templates", which opens the groups. The Office on shops thumbnail is 48 m wide at the base and about 32 m above.

**Left or known:**
- The shape presets (taper, twist, steps, wave, lean) stay in the Shape section, not Parts' Add menu: they set the whole form's key floors, and parts have none of their own yet.
- Row houses still need a generator of their own. Templates set bands of floors, not spaces.

---

## 2026-11-24 · Edit this floor: a floor's units by hand (docs/plans/pro-design-freedom.md §4.3)

**Why:** a floor's units came only from the planner. A designer could steer them (use, flat sizes, spaces) but not say where a wall goes, which is the first thing asked of a floor plan.

**What changed:**
- **On a formed building's X-ray floor**, a bar under the floor says how it's laid out and offers **Edit this floor**. That copies the floor's units onto the run of floors that share them (`Form.floorPlans`), and nothing changes until something is edited.
- **Each unit has a chip** with its type and the area it counts. Pick one and:
  - drag its corners (snapping to other corners and 10 cm; Alt: free; a corner another unit shares moves for both);
  - push its walls (10 cm steps);
  - set its type (By size, 1, 2 or 3 BHK) and its use (as the floor, or offices, shops and the rest);
  - Split, Merge (then pick the unit next to it), Remove.
- Handles show only at real corners (a turn over 25°, or a corner another unit shares) and on walls 1.5 m or longer, so a curved edge doesn't pile them up.
- **The plan's floors:** all the floors alike, Only floor N, or And the floors above; Lay out again gives them back.
- **The engine** (src/pro/form/lay.ts):
  - hand units are cut to the floor and kept clear of the cores;
  - where two overlap, the first keeps the overlap;
  - each laid unit names the hand unit it comes from (`Unit.hand`);
  - floors above a hand-planned floor keep the units of the last floor laid out, rather than being planned afresh.
- New files: src/pro/floorEdit.ts (the edits, pure), src/pro/floorHud.tsx (the bar, chips and handles), tools/dev/test-handplan.ts (17 checks, in `npm test`).

**How it was checked:**
- `npx tsc` clean, `npm test` passes, `npm run build` OK.
- The `evaluate()` snapshot on the sample projects is byte-identical.
- **In the browser,** on a 10-floor box tower (60 homes):
  - Edit this floor gave 6 units on floors 1–10;
  - Split gave 70 homes, and Merge gave 60 back;
  - a type set to 3 BHK stuck;
  - in Plan view a shared wall dragged moved both flats;
  - Only floor 5 left the other floors at 6 units each (it had re-planned them to 7 before the fix);
  - Lay out again cleared the plan;
  - the local project was restored afterwards.

**Left or known:**
- No drawing a new unit yet, and no moving cores or corridors.
- At a distance in 3D the handles of a small unit sit close together: Plan view, or zooming in, is better for it.
- A unit with no outside wall, or a sliver, isn't flagged.

---

## 2026-11-23 · Site folded into Draw, in tabs by category

**Why:** drawing on the plot was split across two shelf buttons, Draw and Site, by whether a thing is new or already there. A power line, a pole, a well or a drain is a utility either way, and someone looking for one shouldn't have to guess which button holds it.

**What changed:**
- The shelf's Site button is gone. Draw holds everything drawn on the plot, in five tabs:
  - **Access:** road, roundabout, gate, wall;
  - **Parking:** car lot, parking tower;
  - **Landscape:** garden, play area, trees;
  - **Utilities:** water tank, power line, pole or transformer, well, drain or water;
  - **Existing:** an existing tree, an existing structure, a no-build zone.
- Each tab has its own hint. Draw opens on the tab of the tool in hand, or the last tab opened (kept for the browser session). Draw is highlighted while any of its tools is in hand.
- Nothing about the things themselves changed: an existing power line is still a site feature with its clearance, and a water tank is still an element.

**How it was checked:**
- `npx tsc` clean, `npm run build` OK.
- **In the browser:**
  - the shelf reads Select, Building, Draw, Plot, Measure, Outline;
  - the five tabs fit on one row of a 350 px flyout;
  - picking Power line from Utilities closes the flyout and lights Draw.

**Left or known:** the outline still lists drawn elements and site features in separate groups.

---

## 2026-11-23 · Checks as rows, the rest: lifts, refuge floors, light, rooms and the DP zone (docs/plans/pro-design-freedom.md, step 7)

**Why:** after the first part, light and ventilation and room sizes were still checked once for the whole project, so a failing building couldn't be told from a passing one. Lifts and refuge floors came from the building systems' own lines. Nothing checked whether the plot's zone allows its uses (the plan's §7.3).

**What changed:**
- **More checks as rows** (src/pro/checkRows.ts), building by building:
  - **lifts:** one over 15 m, two over 24 m, and one for a public use above the ground floor (groups other than A; NBC Part 3 and the Harmonised Guidelines 2021, as assumed). It is measured against the lifts as set or worked out;
  - **refuge floors:** over 24 m, the floor above 24 m, above 39 m, then every 15 m;
  - **light and ventilation:** for flats, each building's own count;
  - **room sizes:** for flats, each building's rooms against their minimums, naming the kinds that fall short and the worst one. "Rooms not laid out" warns when there are none.

  The systems' own lift and refuge lines give way to these in the scrutiny; the systems panel keeps them.
- **What the DP zone allows** (src/doc/zones.ts):
  - The project panel's Rules section has a **DP zone** setting: R1, R2, commercial, industrial, public and semi-public, green.
  - Each use's plot use is checked against it: allowed, with conditions (a warning), or not allowed (a fail, never a block).
  - With no zone set, the scrutiny gives an info line saying so.
  - The table is UDCPR 2020 Chapter 4 as summarised, marked "as assumed".
- Each building's core (stairs, their width, lifts, refuge floors) comes out of the systems as `core` (src/pro/systems.ts), for the rows to read.
- Any check whose key ends in a building's index now links to that building (`checkBuilding`, src/pro/viewer.tsx).

**How it was checked:**
- **Figures:** the `evaluate()` snapshot on the nine sample projects is identical apart from the checks list. Each building's light count adds up to the old project-wide line on every sample (for example, the Mumbai sample: 84 of 178 flats). The new lines are the per-building "rooms not laid out" warnings and the "zone not said" note.
- **Tests** in tools/dev/test-parts.ts:
  - a 48 m tower gets two lifts and two refuge floors, both passing;
  - the systems' lift and refuge lines give way to the rows;
  - homes fail in an industrial zone and pass in R2;
  - offices warn in R1;
  - no zone gives the info line and no row;
  - light and rooms come per building, and rooms warn when none are laid out.
- `npx tsc` clean, `npm test` ALL OK (8 suites), `npm run build` OK.
- **In the browser** (a separate preview server on port 5174; its localStorage backed up and restored):
  - setting the sample plot's DP zone to Industrial turned the rules chip to "1 fail";
  - Approval showed "Uses the zone allows: homes: not allowed", with "Applies to: every use";
  - lifts, refuge floors, light and room sizes showed as rows and passed (150 rooms).

**Left or known:**
- NBC's tables (exits, travel, stair widths) and UDCPR Chapter 4's permissible uses are summaries, marked "as assumed"; they need reading clause by clause.
- Travel is still a straight line to a core's middle, not a walk along corridors.
- The zone's conditions (road widths, sizes, trades) aren't checked, only flagged as conditions.

---

## 2026-11-23 · Checks as rows, by each use's NBC group (docs/plans/pro-design-freedom.md, step 7, first part)

**Why:** the scrutiny checked every building as if it held flats. A building of offices, a hall or a clinic got the flats' stair widths and a travel-distance line that always said "cores spaced for it". Uses we have no figures for looked as clean as housing.

**What changed:**
- **Exits by occupancy group** (src/doc/egress.ts): each use's NBC 2016 Part 4 group, the people a 0.5 m unit of stair width takes, the longest travel to a stair and the narrowest stair. Groups A, B, D, E and F are worked through; the rest are marked not covered.
- **Checks as rows** (src/pro/checkRows.ts). Each row has:
  - what it applies to (groups, uses, buildings over a height);
  - what it measures;
  - its limit;
  - its clause.
  
  The rows run over each building's uses, floor by floor, with each space counted by its own use. The first four rows are:
  - **fire tender access**, moved from code;
  - **travel to a stair:** the farthest corner of any floor from the nearest core, in a straight line, against the limit for each group present. Over the limit fails. Over 80 % warns, since the walk along a corridor is longer. A one-floor building and houses with their own stairs pass;
  - **stair width for the busiest floor's people**, each use by its own group. Offices take 50 people a unit, homes 25;
  - **the narrowest stair:** flats by UDCPR Table 9G, other uses by NBC, hotels 1.5 m.
- **The stairs are sized the same way** (src/pro/systems.ts): their width covers each use's people by its group and the strictest use's narrowest stair. The systems' own stair-width checks give way to the rows in the scrutiny.
- **"Not checked" is a status.** A use in a group not worked through (a clinic is C), or floors with no use yet, gets a line saying so, with a note to ask the fire consultant. It is never a pass. The Approval step lists these first under "Not checked for its use", the score shows "n not checked", and the PDF cover counts them and lists them first under "Needs attention".
- A check from a row shows "Applies to" in its detail.

**How it was checked:**
- **Figures:** the `evaluate()` snapshot on the nine sample projects is identical, apart from the checks list.
  - In the checks, the long slabs now warn on travel (29.7 m in a straight line against 30 m), and so does one building in the other-uses sample.
  - Everything else passes.
- **Tests** in tools/dev/test-parts.ts:
  - groups by use;
  - homes get the four rows and nothing unchecked;
  - the systems' stair checks give way to the rows;
  - a clinic space is not checked, and the summary counts it;
  - floors with no use yet are not checked;
  - offices' busiest floor in units at 50 people a unit;
  - the farthest-corner distance.
- `npx tsc` clean, `npm test` ALL OK (8 suites), `npm run build` OK.
- **In the browser** (localStorage backed up and restored): a box tower with a clinic on two floors showed "13 pass, 3 fail, 1 not checked", with the clinic's line first and "Applies to: group C (institutional)".

**Left or known:**
- The NBC figures are a summary of Tables 21 and 22 and 4.4.2.4.3, marked "as assumed"; they need reading against the text.
- Travel is a straight line to a core's middle, not a walk along corridors.
- Light and ventilation, room sizes, lifts and refuge floors are still code, not rows.
- The zone's allowed uses (§7.3) are not checked yet.
- The scorecard by main use (step 6) is still to do.

---

## 2026-11-23 · Draw, curves on drawn lines and areas, roads that join the road outside

**Why:** the shelf called its drawing tools "Grounds", which said where, not what. An internal road stopped at the compound wall, short of the road it was meant to reach, and drawn lines could only have corners.

**What changed:**
- **Draw.** The shelf's Grounds is now Draw (a pen): its flyout, tooltips and the outline's "Drawn" list. The flyout says how to curve a line and how a road joins the road outside.
- **Curves, as a vector drawing app does them** (src/doc/curves.ts), on roads, walls and areas:
  - Alt-drag a point to pull out its handles; double-click it to make it smooth, or a corner again;
  - drag a handle to bend the curve, and the other side turns to stay opposite; Alt breaks them apart for a sharp turn;
  - Smooth and Corners in the bar do every point at once;
  - adding a point between two, deleting one and moving the whole thing keep the handles.
  - An element keeps its `nodes` and `bez`; its `spine` or `ring` is the curve sampled about every metre, so the ground, the engine and the 3D need know nothing of curves.
- **Roads join the road outside.**
  - A road run out across a road side ends on it (`trimAtFront`), with a gate there.
  - From each road end on a road side, a join runs straight out across the DP widening to the road as it is, as wide as the road, flared at the kerb into a bell mouth (`joinOf`, `Ground.joins`; radius up to 4.5 m). The optimiser's roads get them too.
  - The 3D draws the joins in the road's surface.
- `urbanplan.pick` (the console hook) takes any pick, so a drawn element can be picked from the console.

**How it was checked:**
- **Figures:** the `evaluate()` snapshot on the nine sample projects is identical to step 6's.
- **Tests** in tools/dev/test-parts.ts: a smooth point samples a curve and keeps its ends; a moved handle turns the other one, or doesn't with Alt; a curved road keeps its nodes and goes back to plain points; a road run out across a road side is cut on it, but not across a side with no road; the join crosses a 3 m widening and flares to 13 m for a 6 m road.
- `npx tsc` clean, `npm test` ALL OK (8 suites), `npm run build` OK.
- **In the browser** (localStorage backed up and restored): a road drawn out past the plot was cut at the edge with a gate; both roads ran with bell mouths across the widening into the road outside; Smooth gave a curved road with its handles on the view.

**Left or known:**
- Drawing a line doesn't yet make a smooth point on click-and-drag, as a pen tool does; curves come after drawing.
- Kerbs and footpaths stop at the plot's edge; the join is bare road.
- Building spines, spaces and parts' outlines are still straight-sided; the plan notes they should use the same model.

---

## 2026-11-23 · Numbers and parking by use (docs/plans/pro-design-freedom.md, step 6)

**Why:** with spaces (step 5), a floor can hold more than one use, but the build cost still went by the floor's use. Nothing said how many people a scheme holds, and "ample parking" couldn't be asked for.

**What changed:**
- **Build cost by each space's use.** A floor holding spaces of other uses shares its area between them by carpet, and each share is built at its own use's rate. `shared()` in src/doc/site.ts does the split.
- **People.** Each use line now carries the people it holds: its area divided by the use's occupant load (NBC 2016 Part 4, the use table's `load`). The report has a total (`d.people`); a plain building counts by its plot use.
- **A parking target.** The project panel's Living section has "Parking wanted", as a % of the code's figure (100–400 %).
  - The engine reports the bays wanted (`parking.want`), and the automatic basement count now sizes for the target.
  - A new check, "Parking wanted", passes or warns. It never fails, since the code itself is met.
- **The area statement** adds:
  - "Car bays wanted (your target)";
  - a **By use** block: built-up, carpet, units and people for each use, when the scheme has more than homes;
  - the people total.
- **Already true, so no change:** stilts are off by default for projects that aren't housing (`siteDefaults`, src/doc/optimise.ts). Money per space by how its use earns came with step 5.

**How it was checked:**
- **Figures:** the `evaluate()` snapshot on the nine sample projects is identical apart from the new `people` field (for example, the formed homes hold 2,441 people).
- **Tests** in tools/dev/test-parts.ts:
  - people by use;
  - a hotel space raises the build cost from ₹19.70 cr to ₹22.70 cr;
  - a 150 % target wants 69 bays for the code's 46.
- `npx tsc` clean, `npm test` ALL OK (8 suites), `npm run build` OK.
- Not tried in the browser: the work moved on to the Draw tool.

**Left or known:**
- The scorecard doesn't yet pick its figure by the main use (passengers for a terminal, parking against target for a shop). It still shows homes, or the money for other uses.
- Occupant loads are the use table's figures; some are secondary-source placeholders (see the plan's N5).
- The UDCPR Table 8-B parking ratio fix (step 1's follow-up) is still to do.

---

## 2026-11-23 · Spaces on floors, first part (docs/plans/pro-design-freedom.md, step 5)

**Why:** a floor had one use. Shops along the front of a floor of homes, a hall beside offices, or a terminal's departments couldn't be said.

**What changed:**
- **Spaces** (`Form.spaces`, src/pro/form/types.ts). A space is a plan ring on a range of floors, with:
  - a name and a use of its own;
  - a fill: laid out by its use's generator (flats by the mix, shops along the frontage, offices, rooms), or kept as one unit (a hall, a big shop, a lobby);
  - an eye to switch it off.

  What of a floor no space covers keeps its band's use. Spaces earlier in the list win where they overlap. A space moves with the floor's taper, lean and twist.
- **The layout** (lay.ts) cuts each space to the floor and lays out its units by its own use, then the rest of the floor by the band's. A floor like the one below with the same spaces shares its units, as before. Each floor lists its spaces with their world rings and areas (`FormFloor.spaces`).
- **The engine counts each unit by its own use.** A unit can carry a use (`Unit.kind`, src/doc/site.ts):
  - parking goes by the unit's use: shops by the shop rule, a hall by its own;
  - money and the "by use" lines group a floor's units by use, and share the floor's area between them by carpet;
  - a building counts as having homes if any space on it is homes.
- **The Spaces section** in the inspector (folded until a building has spaces). Each space has:
  - an eye and an editable name;
  - its use, from the use table;
  - its floors, from and to;
  - arrows to reorder, and remove;
  - Laid out or One unit.

  Quick adds: Shops along the front (floor 1, 8 m deep), A corner (offices, floors 1–2), The whole floor (offices, floors 1–3), A hall (one unit, floor 1).
- **On the view:** a space's edges have blue square handles halfway up its floors. Drag one to push or pull that edge, or use the arrow keys.

**How it was checked:**
- **Figures:** the `evaluate()` snapshot on the nine sample projects is byte-identical to before.
- **Tests** added to tools/dev/test-parts.ts:
  - shops along the front of a floor of homes: floor 1 holds both, floor 2 homes only;
  - the space is cut to the floor (180 m²);
  - a hall kept as one unit;
  - the money lists the shops by their own use;
  - parking changes with the space's use (shops 46, a hall in their place 47).
- **Browser**, on an 8-floor box of homes, with your storage backed up and restored exactly:
  - "Shops along the front" gave 6 shop units and 2 flats on the ground floor;
  - the inspector showed "Other units 6";
  - four blue handles appeared;
  - dragging one moved that edge out 2.5 m.
- `npx tsc` clean, `npm test` ALL OK (8 suites), `npm run build` OK.

**Left or known (the rest of step 5):**
- **Spaces are rectangles you adjust.** Drawing a polygon on a floor in plan, splitting a floor with a line, and snapping to the core and to other spaces are still to do.
- **The core and corridors aren't spaces yet,** and units are still the engine's units, carrying a use, not spaces of their own (plan §4.1's "units become spaces").
- **mixed.ts's shop strip** on plain buildings is not yet a space generator.
- **Build cost** still goes by the floor's use, not the space's; that belongs to step 6.
- **Spaces aren't drawn on the view** apart from their handles; X-ray shows the units they make.

---

## 2026-11-23 · Levels you set, and voids (docs/plans/pro-design-freedom.md, step 4)

**Why:** a floor's height came only from its use. A lobby, a hall or an atrium needs a taller floor or a space two floors high. And a part's floors were a share of the building's height, so a podium on floors 1–3 moved when floors were added.

**What changed:**
- **Levels by range** (`Form.levels`, src/pro/form/types.ts). A range of floors (1 is the ground floor) can have:
  - a floor-to-floor height of its own, whatever its use;
  - **no floor**: a void. The floor keeps its height and its walls, but has no slab, no area and no units, so the floor below rises through it. The ground floor always has a floor.
- **The Levels section** in the inspector (folded unless the building has levels). Each range has:
  - its floors, from and to;
  - Floors or No floor;
  - a height (blank means the use's own);
  - remove.

  Two quick adds: "A height" and "A double-height ground floor" (floor 2 left out).
- **Parts keep to their floors.** A part now stores its first and last floor (`lo`, `hi`) as well as its share of the height, and the floors win. Every part made or edited since this step has them. Older parts keep their shares, so old projects lay out exactly as before.
  - The Parts list, the handles up the face and the plan sketch all read and write floors.
- **In 3D:** a void floor has no slab or slab edge, and the floor below has no lid under it. The wireframe draws no slab line there.
- **Numbers:**
  - a void floor counts no built-up and no units;
  - it is never flagged as "nothing is left of the floor";
  - the building's height and floor count include it, so the height rules see the true height.

**How it was checked:**
- **Figures:** the `evaluate()` snapshot on the nine sample projects is byte-identical to before.
- **Tests** added to tools/dev/test-parts.ts:
  - a 6 m ground floor;
  - a void with no area or units, the same height and floor count, and no "empty" flag;
  - the ground floor can't be a void;
  - a podium kept to floors 1–3 stays there on 20 floors, while an older one by share grows.
- **Browser**, on a 12-floor box with a 4.5 m ground floor, floor 2 left out and a podium on floors 1–3, with your storage backed up and restored exactly:
  - areas 928, 0, 928, then 381;
  - units 9, 0, 9;
  - the Levels section showed both ranges;
  - its "Floors" button put floor 2 back (928 m²).
- `npx tsc` clean, `npm test` ALL OK (8 suites), `npm run build` OK.

**Left or known:**
- The use strip and the plan sketch still place floors by each use's own floor height, not the design system's. The view's handles can sit a little off on tall buildings, as before.
- A void's windows are still drawn floor by floor; a double-height glazed wall would read better.
- Voids are whole floors. A void over part of a floor (an atrium in the middle) is a space, which comes with step 5.

---

## 2026-11-23 · Parts: plan booleans (docs/plans/pro-design-freedom.md, step 3)

**Why:** a designer should be able to make any form by joining and cutting masses: a podium and a tower, two towers and a bridge, an L or U of different heights, a hall with a pier. Before this, a form could only be cut (slots and courts).

**What changed:**
- **A form's carves are now its parts.** Each part is a prism: a plan ring between two floors. It can:
  - **add** to the floors it spans (union): a podium, a wing, a bridge;
  - **cut** out of them (subtract): a slot, a notch, a void;
  - **keep** only what lies inside it (intersect): trims the form to a footprint.
- **Parts act in order** on the plan drawn (with its key floors). A cut placed after a podium cuts the podium too; placed before it, it doesn't. A part can be switched off and renamed.
- **Old projects load unchanged.** A part with no op is a cut, so every older carve is a cut part and no data is converted. The form still stores them as `carves` (src/pro/form/types.ts).
- **The Parts list** is in the inspector (a new Parts section) and on the building's bar (a Parts popover). For each part it shows:
  - an eye to switch it off;
  - its name, editable;
  - Add, Cut or Keep;
  - its floors, from and to;
  - arrows to move it earlier or later in the list, and remove;
  - for a cut, glazed or open.

  Its Add buttons are: a podium, a wing, a cut, a slot, a trim (an oval keep). The Shape section's "A slot" and "The cuts" buttons moved here.
- **On the view:**
  - each part's plan edges have a handle halfway up it: drag one to push or pull that edge (0.5 m steps, Alt for 10 cm), or use the arrow keys;
  - the up-the-face handles set its first and last floor and now say which floor;
  - added parts' handles are green and keeps' purple; switched-off parts have no handles.
- **The plan sketch** shows adds in green and keeps in purple.
- **The layout** (src/pro/form/lay.ts):
  - a run of cuts is still subtracted in one go, as before;
  - an add is unioned and a keep intersected, per floor;
  - the "same as the floor below" shortcut and the memo still apply;
  - a floor with several masses gives edge columns round each, and the building's outline includes them all.
- **New:** src/pro/parts.ts (names, floors ↔ heights, new parts, edge push), tools/dev/test-parts.ts (in `npm test`).

**How it was checked:**
- **Figures:** the `evaluate()` snapshot on the nine sample projects is byte-identical to before.
- **New test** (tools/dev/test-parts.ts):
  - a podium on floors 1–3;
  - a cut with no op;
  - the order of a cut and an add;
  - a keep;
  - a part switched off;
  - two towers with a bridge on floors 8–9;
  - each new part.
- **Browser**, on a 12-floor box with a podium and a notch, with your storage backed up and restored exactly:
  - the floors were 928 m² for 3 floors, then 381, then 318;
  - the Parts list showed the right floors;
  - "A wing" added a part;
  - the eye switched the podium off;
  - Ctrl+Z brought it back;
  - dragging the podium's edge handle pushed that edge out 4 m, and the money updated.
- `npx tsc` clean, `npm test` ALL OK (8 suites), `npm run build` OK.

**Left or known:**
- Part heights are stored as a share of the building's floors, as carves were. A part spanning floors 1–3 spans a different number of floors if the building's floor count changes. Levels the designer sets (plan §3.4, step 4) will fix this.
- One Ctrl+Z undid both the wing and the eye clicked a second apart. The inspector groups quick edits to one building; that behaviour is older than this step.
- With many parts, the edge handles crowd the view. Showing them only for a part picked in the list would help.
- A roof sits on the top floor's largest mass only.
- Sloped cuts, spheres and sweeps wait for true 3D solids (plan §3.3, stage 2).

---

## 2026-11-23 · No use yet, and the use set last (docs/plans/pro-design-freedom.md, step 2)

**Why:** designers want to make the form first and say what it's for afterwards. Shaping a building turned it into homes whatever the project was.

**What changed:**
- **"No use yet" is a use.** It's a row in the use table (src/doc/uses.ts) and the last entry in the use strip's "Add floors for…" list. A no-use building or band is counted for:
  - its built-up area, height and margins;
  - its cores;
  - its cost to build.

  It gets no units, parking, sales or occupancy class.
  - A plain building of no use is planned with its plate, cores and corridor, but no units (src/doc/site.ts).
  - A formed band of no use gets no units (src/pro/form/units.ts).
  - Its floors take the design system's floor height, as homes do, so giving it a use later doesn't make it taller. A 3.3 m default had pushed the sample tower 4.5 m past its margins.
  - The building systems size it as a shell (src/pro/systems.ts).
- **A plain building's own use.** The inspector has a "What it's for" section with "As the project (…)", each use, and No use yet. A building with no use shows "Use: No use yet" and a note saying what waits for a use. Its lines show Homes only with homes, and other units apart.
- **Shape it keeps the use.** A box form's band takes the building's use, or the project's: offices in an office project, a clinic in a hospital project, no use in an undecided one. Before, it was always homes (`shapeIt`, `boxForm`).
- **The scorecard with nothing used yet.** When every building has no use, it shows Buildings, then Cost ("no use yet · land aside") and Build per m², instead of Homes 0, a loss and no IRR.
- **One less hand-kept list.** The building systems' NBC classes and m² a person now come from the use table (it holds the same values, from systems.ts's NBC 2016 Table 3 reading). The systems keep their own water, power, cooling and lift-traffic figures.

**How it was checked:**
- **The `evaluate()` snapshot** on the nine sample projects is byte-identical to before the framing step, including the systems' cost.
- **In Node:**
  - **Shape it** in a homes, offices, hospital, own-use and undecided project gives bands of homes, offices, clinic, offices and no use. The undecided one has no units, no parking need, and the same 48 m height as homes.
  - **The sample tower,** plain or shaped, homes or no use: no failing checks.
- **`npx tsc --noEmit -p .`, all eight tests and `npm run build`** pass.
- **Browser,** on the sample project (this session's server, port 5175; storage backed up and restored exactly, no viewport size set):
  - Use → No use yet: the scorecard became Buildings 1 · Cost · Build per m², and the inspector showed the note.
  - Shape it gave one band, "No use yet: 15 floors".
  - Rules: all clear.
  - Switching the project to Offices kept the building's own no-use band.
  - No console errors.

**Left or known:**
- **The use is set per building or per band of floors, not per space:** spaces are step 5.
- **The Building tool's new buildings are plain,** so they already take the project's use. Templates keep their own uses, since they're presets.
- **The simple editor shares the engine.** A plain building of plot use "none" there now gets no units either, as that use's own note already promised ("units, parking and money wait for a use").

---

## 2026-11-23 · One use table (docs/plans/pro-design-freedom.md, step 1)

**Why:** what differs by use was kept in seven lists, in step by hand, across the engine, the form and the UI. Adding a use meant editing all of them.

**What changed:**
- **New: src/doc/uses.ts.** One row per floor use, holding:
  - its name, the name on the area statement's lines, icon and colour;
  - its floor height and how the editor says it earns;
  - the plot use it counts as, its parking, how it earns and its cost factor;
  - people per m² for the lifts;
  - whether a floor of it is one public room.
- **Two new fields on each row, not used in any figure yet:** its NBC 2016 occupancy group, and its occupant load for exits. Both are from secondary sources, for steps 6 and 7.
- **The old lists are now read off the table:**
  - `FloorUse`, `FLOOR_USE`, `KIND_OF_PLOT` and `PARK_PER` (src/doc/site.ts);
  - `BuildingUse` and `USE_INFO` (src/pro/form/types.ts);
  - `DENSITY` and the public-room sets (src/pro/form/skeleton.ts and units.ts);
  - `USE_LABEL` (src/pro/deal.ts);
  - `USE_COLOR` (src/pro/formHud.tsx);
  - `USES` (src/pro/shapePanel.tsx).

  Every name they exported is kept, so nothing else changed.

**How it was checked:**
- **Figures:** the `evaluate()` snapshot on the same nine sample projects is byte-identical to before the framing step. It covers built-up, units, parking, money, systems, every check's text, and each formed floor's use, area and units.
- **`npx tsc --noEmit -p .`, all eight tests and `npm run build`** pass.
- **Browser, on the Office on shops template:**
  - the use strip reads "Offices: 16 floors" and "Shops: 2 floors";
  - the "Add floors for…" list has all ten uses in their old order and colours;
  - the area statement lines read "levels 3–18 offices" and "Shops 40 units".

  No console errors. Storage was backed up and restored exactly.

**Left or known:**
- The plot uses (`USES` in src/doc/plot.ts, for the zone and the simple editor) are a separate list, on purpose: they are what the land is zoned for, not what a floor is used for. Each table row says which plot use it counts as.
- UDCPR's office parking ratio looks higher than the table's 1 per 100 m² (research note N5). Correcting it changes figures, so it is a separate change, after reading the official Table 8-B.

---

## 2026-11-23 · Framing: the project says what it's for (docs/plans/pro-design-freedom.md, step F)

**Why:** Pro talked as if every project were flats for sale. Many users design for themselves or a client: a house, a shop, an office, a clinic.

**What changed:**
- **Two new project fields, `use` and `purpose`** (src/pro/project.ts). An old project has neither, and reads as homes to sell, so nothing changes for it.
  - **The use:** Homes, Homes over shops, Offices, Shops, Clinic or hospital, School, Public building, Something else, Not decided yet.
  - **Who it's for:** To sell, For a client, For my own use.
- **Asked at the start.** The empty state opens on "What are you designing?", with two rows of choices above the four ways to set the plot.
- **Changed later in the project panel**, in a new first section, "What it's for". Search finds it. The panel's subtitle shows the answer ("Offices · for a client").
- **The rules and the fill follow the use.** `plotReport` and `generate` take the project's use instead of a hard-coded `'residential'`. That covers the FSI, margins, parking, the fill and stilts by default. "Homes over shops" is homes with a floor of shops at the front, which it sets.
- **The scorecard follows both answers.**
  - It shows Homes only where there are homes. Otherwise it shows Offices, Shops or Units, or Buildings for "not decided yet".
  - When the project isn't sold, Profit, Land worth and IRR give way to Cost (the land aside) and Build per m².
- **The project panel and inspector:** Flat mix, Flat sizes and Shops at the front show only with homes, and the building's flat mix only on a building with homes. Stilt parking reads "the building above", not "flats above".
- **The checklist** starts with "Say what it's for".
- **The dashboard:**
  - a card leads with what the project is ("Clinic or hospital · for a client") and shows its other units, and "to build" cost rather than profit when it isn't sold;
  - the Homes total is hidden when there are none.
- **The home page:** the lede names homes, a shop, an office or a clinic, to sell, for a client or for your own use. "Its own flat mix" is now "its own uses", and "flats" is now "units".

**How it was checked:**
- **Figures:** `evaluate()` was snapshotted on nine sample projects before and after: the default, towers, slabs, Mumbai, shops at the front, a mix, and formed homes, other uses and sculpted forms. The JSON is byte-identical.
- **Every use × to sell and for a client** was evaluated with its summary. Nothing throws, and the offices, shops and public uses fill with units, not flats.
- **`npx tsc --noEmit -p .`, `npm test` (ALL OK in all eight) and `npm run build`** all pass.
- **In the browser** at `/pro/?new=blank`, on this session's own dev server (port 5175, since 5173 was the other session's). Storage was backed up to sessionStorage and restored exactly.
  - The empty state shows the choices.
  - Offices and For a client gave Built-up · Offices 60 · Cost · Build per m² · Rules.
  - The project panel showed "What it's for", with no Flat mix, Flat sizes or Shops.
  - Back to Homes and To sell gave Homes · Profit · Land worth · IRR, and the three sections came back.
  - The checklist ticks "Say what it's for".
  - No console errors.
  - No viewport size was set.

**Left or known:**
- **Engine:** the engine's money for a plain building of a public use (school, hospital) still counts its units as sold. The scorecard hides that by showing Cost, but the Numbers report's Money tab still shows revenue. Money by use is step 6 of the plan.
- **Rent:** "For rent" isn't offered yet: rent and a yield come with step 6.
- **New buildings:** a new building drawn by hand is still homes whatever the project's use. That's step 2.

---

## 2026-11-23 · Generate removed

**Why:** tried on the sample project, Generate wasn't useful.
- Its cards ranked and priced options by profit before the land deal, but the top bar shows profit after it: the brief's best card said ₹4.91 cr and IRR 7.6%, and the option it made showed ₹4.13 cr and 6.2%.
- Its search varied only slabs or towers, a height cap, the flat mix and shops on the ground. That's 72 tries, but only 9 different building layouts. "Make 3 options" gave the same two 4-floor slabs three times, with a different flat mix each time.
- Its cards were text only, and their labels described the settings, not the result ("at most 6 floors" made 4 + 4 floors).

**What changed:**
- **Gone:**
  - the toolbar's Generate button and its popover;
  - the G key and the "Generate options" search action;
  - the project panel's "Generate…" button;
  - the written brief and the "Make 1 / Make 3 options" search;
  - the plotted layout (the land divided into plots for sale), which sat in the same popover;
  - the scripting API's `options` and `brief`.
- **Deleted:** src/pro/generate.tsx, options.ts, brief.ts, layout.ts, and their CSS.
- **Kept, moved:** the project panel's "Generated from" section is now **Layout**. It holds the building type, most floors, most buildings and how much of the FSI to build, which only Generate could set before. They change the open option directly, as the flat mix and sizes do. Once the layout is yours (moved by hand), they're replaced by a note.
- **The checklist's "Make a second option"** now duplicates the open option.
- **The chip over the view is gone** ("Generated from the brief · Brief", and "Your layout · Regenerate"). Laying a hand-moved layout out again from the settings is now two buttons in the Layout section: **As a new option** and **Here**.
- **The home page's Explore step** is now "Options" (several schemes kept as options, compared side by side). Its screenshot, `pro-explore.webp`, still shows the old Explore and should be retaken.
- **Fix:** the "A building is outside the view" note no longer fires when a project opens, only on a switch between its options. Its check now reads the camera's latest position.

**How it was checked:**
- Browser, sample project, with your storage backed up and restored exactly:
  - no Generate on the toolbar;
  - G does nothing;
  - the Layout section shows the four controls;
  - opening the project shows no false note.
- Changing a Layout control in the browser wasn't tried: you were using the pane.
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- Options from the brief or from Explore in saved projects keep their names and contents; only the way to make new ones is gone.
- Trying several layouts now means duplicating the option and changing its Layout settings by hand.

---

## 2026-11-23 · The camera on interactions (docs/plans/pro-camera.md, all four steps)

**What changed:**
- **Panels hold the picture still.** Opening or closing the inspector, the outline, a report or the project's panel no longer shifts the view. A panel now only changes where the next framing aims: the middle of the uncovered part. One exception: if a pick ends up wholly under a panel, it eases out by the smallest move (280 ms).
- **One camera mover** (scene.ts `fly`) behind every command: Whole site, street, above, Show, F, double-click, Plan.
  - Moves take 280 to 600 ms depending on distance and ease out, going the shortest way round.
  - Any press or wheel on the view stops a move where it is.
  - With reduced motion, a move is a jump.
  - Opening a project or a new plot still frames the whole site at once.
- **Plan and back.** P turns the camera to straight down, north up (300 ms), then switches to the plan at the same scale. P again returns to the 3D view you left.
- **The controls.**
  - **Drag:** orbits about the point under the pointer (a building's surface or the ground; on the sky, the middle). A dot marks that point while you drag.
  - **Right-drag or Shift+drag:** pans across the ground, so the camera's height stays put.
  - **Wheel:** zooms toward the pointer, slowing near the surface under it and stopping 3 m short.
  - **Far limit:** 12 × the site (or the tallest building).
  - **Phone:** one finger orbits about what's touched; pinch and two-finger pan are as before.
- **Framing.**
  - **F:** frames what's picked (a building, a site element or a feature); with nothing picked, the whole site. The toolbar's Whole site stays the whole site.
  - **Double-click:** on a building, frames it; on open ground, frames the whole site. Drawing still finishes on a double-click.
  - **Double-tap (phone):** does the same.
  - Framing now fits the box's bounding sphere, so a tall tower fits whole.
  - The shortcuts list says all this.
- **Options don't fly.** Opening or making an option that leaves buildings out of the view adds "A building is outside the view" to its toast, with Whole site.

**The decision (pro-camera.md §5):** I went with (b), extending OrbitControls, not (a), the camera-controls library. On a closer look, OrbitControls already has zoom to the cursor, distance limits and ground panning built in. Only the pivot needed our code: about 40 lines that turn the camera and its target together round the pointed-at point. So there's no new dependency, and edit.ts's `controls.enabled` hand-off is unchanged.

**How it was checked:**
- Browser at 1440×860 with the sample project, your storage backed up and restored exactly.
- **Panels:** a fixed point's screen position didn't change through 1, N, Esc and O, nor when a pick opened the inspector (the camera stayed bit for bit).
- **Orbit:** a drag from a ground point kept that point within 2 px of where it was pressed while the view turned; the dot hid on release.
- **Zoom:** ten wheel bursts at the tower's face stopped 3.09 m from it, with the same point still under the pointer.
- **F:** the move took about 600 ms, eased out, and framed the picked tower whole in the uncovered part.
- **Interrupting:** a press during S's move stopped it where it was.
- **Plan:** P then P returned to the identical 3D view.
- **Reduced motion** (stubbed for the test): S jumped at once.
- **Double-click:** on open ground, it framed the whole site.
- **Reveal:** a tower picked at the right edge, wholly under where the inspector opens, eased out to just left of it.
- **Pan:** a right-drag kept the camera's height exactly.
- **Off-screen note:** with the camera turned away, opening Option A said "Opened Option A. A building is outside the view."
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- The plan's 15-minute user test ("did the view ever move when you didn't expect it?") hasn't been run.
- The phone's double-tap and one-finger orbit about the touched point weren't tried on a real phone.
- The figures bar across the top of the view isn't counted as covering it, so framing can sit a little high.
- Orbiting has no inertia (OrbitControls' drift after letting go), on purpose: the view stops where you let go. Pans and zooms still glide a little.

---

## 2026-11-23 · Rethink step 7: the stage on the dashboard, and a drag that turns the view

**What changed (the drag, after "clicking a building makes it easy to move, but it's horrible while panning or orbiting"):**
- **Only what's picked moves under a drag** (src/pro/edit.ts). A press on a building, a site element or a feature that isn't picked waits: let go in place and it's picked; drag and the view orbits or pans as it would on open ground. Before, any press on a building picked it and started moving it, so turning the camera over a tower shoved it.
- Picked, it moves as before (the cursor says so: a pointer over the others, a move cursor over the picked one). The handles on the picked building are unchanged.

**What changed (the stage, rethink §2.8):**
- **The card shows the stage and sets it** (Looking, Designing, Applying): a small menu under the figures, on your projects and those shared with you to edit; the word alone on a phone or a view-only share. The browser's own project too. It's saved into the project's file, and the card's summary carries it.
- **Projects filters by stage** ("Any stage" beside Sort), and the list view has a Stage column.
- **Sites knows the project opened from a plot** (the project keeps the site it came from): its row says "Project: Looking ▾", settable there; Open opens that project instead of starting another, and "Start another project" is in its menu.

**How it was checked:**
- Browser at 1440×860, with your storage backed up and restored exactly: a drag across an unpicked tower turned the camera and left the tower where it was, unpicked; a click picked it; a drag then moved it and the camera stayed. On the dashboard the browser's card showed Designing; setting Applying saved it, toasted, and didn't open the project. In Sites, a plot whose project came from it showed "Project Applying" with "Open its project"; another plot kept "Start a project…".
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- Setting the stage on a cloud card opens and saves the file, so it counts as a change ("Changed just now") and as an open.
- Projects opened from Sites before today don't know their site, so Sites can't show their stage.
- The stage filter shows only when signed in (the signed-out page has just the browser's card).
- On a building that fills the screen, orbiting needs a drag that starts on it while it isn't picked, or the right button to pan.

---

## 2026-11-23 · Rethink step 6: first-run guidance, and the outline beside the tools

**What changed (first-run guidance):**
- **Hover says a building can be picked.** With the select tool, the cursor turns to a pointer over a building (a move cursor over the one picked). Until you've picked one for the first time, a tag beside the pointer names it and says "Click to pick it, then drag".
- **The first pick gets a one-line hint** above the view tools: drag the arrow on top for floors, the middle to move it, the side handles for its size, or type in the inspector. It goes with "Got it", once a building has been changed in the view, or when nothing's picked, and doesn't come back.
- **The checklist** (help corner) is Set the plot, Put a building on it, **Change its height or move it in 3D** (new: ticked by a drag in the view), Look at the numbers, Make a second option, Share it. **Clicking a task does it** as far as it can: picks the plot, arms the tower tool, picks a building and frames it, opens the Numbers report, opens Generate, opens Share.

**What changed (the outline):**
- The outline docks beside the toolbar instead of pushing it sideways, starts below the top bar, and is only as tall as what's in it (it scrolls past the report's top). The figures move over with it.

**How it was checked:**
- Browser at 1440×860, with your storage backed up and restored exactly: hovering a building showed the tag "Building A / Click to pick it, then drag"; picking it showed the hint above the view tools; the checklist listed the six tasks and "Look at the numbers" opened the Numbers report and ticked itself.
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- The hover is the cursor and the tag; the building doesn't light up in 3D.
- The plot's edges get no hover line.
- The tag shows only until the first pick; after that, the cursor alone says it.

---

## 2026-11-23 · Rethink step 5: reports, and no rail

**What changed:**
- **Numbers and Approval are a report** (src/pro/report.tsx) that rises from the bottom over the view, between the toolbar and the inspector, with Numbers | Approval tabs. The view, its tools and the pick stay above it; its sections sit in columns.
  - **Ways in:** the scorecard (Built-up opens the area statement, Homes the project, Profit, IRR and Land worth Numbers, Rules Approval; the same figure again closes it), N and A, search, and any link that went to those places.
  - **Esc closes it** back to the view. With Approval open, the check pins show on the view.
- **No rail on a wide screen.** The project's settings are **Project** in the top bar (or 1); the outline is **Outline** at the toolbar's end (or O). A narrow screen and a phone keep their rail and sheets.
- The outline button gets the list icon it never had.
- Shortcuts list: 1 · N · A.

**How it was checked:**
- Browser at 1440×860, with your storage backed up and restored exactly: no rail; N opened Numbers (area statement, inventory, what the land is worth in three columns); Rules switched it to Approval (scrutiny, permission, drawings, NOCs, fees, documents); Esc closed it. At first the report covered the toolbar's Generate and Outline, and its sections ran full width: fixed.
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- Deal and prices stay in the Numbers report rather than the project's panel.
- The report is a fixed height (46% of the window, at most 460 px); it can't be dragged taller.
- The approval sections are folds in columns, not one tab each as the rethink sketched.
- `places.tsx` stays (Numbers' body and the project's), so the rethink's "remove places.tsx" is only half done.

---

## 2026-11-23 · Rethink step 4: Generate, and less on screen

**What changed (Generate):**
- **Generate on the toolbar** (src/pro/generate.tsx; G, or search "Generate options"), a popover beside the tools:
  - **Describe it:** the written brief, Plan it, and its best and closest schemes, each with Make;
  - **Or set it:** building type, most floors, most buildings, how much of the FSI to build; **Make 1 option** uses them, **Make 3 options** tries every type, height and mix and makes the three that earn most (in rank order, the best opened), with the rest it found folded under;
  - **Plotted layout:** the subdivision preview, folded.
- Whatever it makes is a new option; the one open stays in the option menu.
- The project's panel loses Fill the plot and "Make options from it": a short "Generated from" section says who lays the buildings out and opens Generate. "Screen many plots" is gone from Pro (Sites has it).

**What changed (less on screen, after "the UI is crowded"):**
- The outline and the project's panel start closed: Pro opens on the view, the tools, the figures and the chip. The rail's Project and the outline button (O) open them, and they stay as you leave them.
- The figures show their numbers only; each one's line of detail shows on hover or focus.
- The building's bar hides while its inspector is open (the inspector has all of it); the handles stay on the building.
- The view tools are 3D/Plan, the drawing, Whole site and More (from the street, from above, x-ray, snapping); Sun and help stay.
- "Saved in this browser" is "Saved", with the where in its tip; the name's pencil shows on hover.

**How it was checked:**
- Browser at 1440×860, with your storage backed up and restored exactly: G opened Generate; Make 3 options made three options and opened the best with the toast and "vs Option A"; the menu listed them; at first the chip and the open Generate button drew wrong (a class clash and dark-on-dark), fixed. The calm screen, a pick (no bar, inspector, handles) and More (opens upward) looked right.
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- Make 1 option takes about a second with no working sign.
- The figures' detail lines are hover-only, so a touch screen at desktop width won't see them.

---

## 2026-11-23 · Rethink step 3: the project in the inspector

**What changed:**
- **With nothing picked, the inspector is the project** (src/pro/places.tsx `ProjectBody`): its name, area and authority on top, then
  - **The site:** Rules, Plot (with Edit the plot, survey number, import), Constraints;
  - **What you're building:** What the plot permits (the FSI ladder), Fill the plot, Living, Flat mix, Flat sizes, Shops at the front, Parking;
  - **Look:** the design system, with Open the design system;
  - **Make options from it:** the written brief and Explore, until Generate takes them in (step 4).
- **Brief and Design are one rail entry, Project** (key 1; Numbers 2, Approval 3). It shows or hides the project's panel; the old `step=brief` and `step=design` land on it, with a one-time note.
- **The duplicates are gone:** Design › Buildings and On the site (the outline lists them; picking one opens its inspector). Esc lets go of a pick and brings the project back.
- Search, the chip's Brief link, Inventory's "Change them" and the empty state's find and import all open the project's panel at the right section (`findIn` now looks in the inspector too).
- On a narrow screen the project is a sheet, as the places were.
- Three numbers a row stack in the inspector, where they didn't fit.

**How it was checked:**
- Browser with your storage backed up and restored exactly:
  - at 1440×860 the project showed on the right; Ctrl+K › Flat sizes opened it there, unfolded;
  - picking Building A showed its inspector, and Esc brought the project back;
  - at 820 px wide, 1 opened "The project" as a sheet.
- `npm test` ALL OK (search reaches all 45 sections); `npm run build` OK.

**Left or known:**
- Deal and prices are still in Numbers; they join the project when Numbers becomes a report (step 5).
- The project's panel is open at every desktop width; folding it to its header below 1440 px isn't done.
- The written brief and Explore sit at the panel's end until Generate (step 4).

---

## 2026-11-23 · Rethink step 2: generated or yours

**What changed:**
- **A chip on the view, right of the tools,** says who lays the buildings out:
  - "Generated from the brief" (with a link to Brief) while brief changes move the layout;
  - "Your layout" once a building has been placed, moved or changed by hand, with Regenerate ▾: **as a new option** (this layout stays as it is) or **here** (the hand edits go; Undo brings them back).
- **The moment it turns, a toast says so:** "This layout is now yours: brief changes won't move it." with Undo and "Regenerate as a new option". Opening a project, undo, redo and switching options don't count as turning it.
- Brief's Fill the plot and Living say why their settings wait while the layout is yours.

**How it was checked:**
- Browser at 1440×860, with your storage backed up and restored exactly: the sample showed "Generated from the brief"; a floor added on Building A turned the chip to "Your layout" with the toast; "Regenerate as a new option" made Option B, generated, with "vs Option A"; switching back to A showed no toast; Regenerate › here brought the brief's layout back with Undo.
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- A drag in the view wasn't tried in the browser (the pane's scaling missed the handle); it goes through the same scheme change as the floor button.
- The settings still sit in Brief's sheet; they move to the project inspector in step 3.

---

## 2026-11-23 · Rethink step 1: view first (docs/plans/pro-ia-rethink.md)

**What changed:**
- **Pro opens on the view.** The sheet starts closed; opening a project, a site from Sites or a template lands in the view with the plot framed. The rail still opens the four places' sheets until step 5.
- **"Type its size" stays in the view:** it sets the plot, frames it and says what to do next, instead of going to Brief.
- **The tools are labelled:** Select, Building, Grounds, Site, Plot, Measure under their icons.
- **The stage leaves Pro.** The project menu is now Projects (recent, all, new); stage items are gone from search; the scorecard has one set of figures (built-up with its % of allowed, homes, profit, land worth while no land price is put in, IRR, rules). `stage` stays on the project as data for the dashboard and Sites.

**How it was checked:**
- Browser at 1440×860, with your storage backed up and restored exactly: the view opens full width with the outline and the labelled tools; Projects has no stage; `?new=blank` › Type its size › Work it out framed a 40 × 50 m plot with the toast, no sheet; no new console errors.
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- The stage isn't yet shown or set on the dashboard card (step 7).
- The rail still says Brief is the current place while its sheet is closed.

---

## 2026-11-23 · Phase 8: the outline, comments on the view, the empty state

**What changed:**
- **The outline** (src/pro/outline.tsx), docked beside the sheet (O, or the rail's list button; open by default on a screen 1440 px or wider):
  - the plot and its roads; the buildings with their letter, a failing-check dot and a comment count; the elements; the features;
  - eye hides a building or feature from the view for this session (the numbers still count it); lock stops it being picked;
  - drag a building, or Alt+↑↓, to reorder (the letters follow), with an undo toast.
- **Comments on the view** (src/pro/comments.ts, commentPins.tsx): Comment in the top bar (C) drops a numbered pin on a building or a spot; a thread beside it with reply, resolve, delete; the list takes the inspector's place while commenting.
  - In the cloud they're the project's comments, with an `anchor` (supabase/migrations/0007_comment_anchors.sql). Until that's run, they save without their pins and say so.
  - A project only in this browser keeps them as notes to self.
  - The Team dialog is now People (members only), from Share › People….
- **No Welcome dialog:** a new project opens on the view with the four ways in (find it, draw it, type its size, import it) and "look round this sample".
- **The help corner** (? after the compass at the end of the view tools): a checklist that ticks itself (set the plot, add a building, look at the numbers, a second option, share it), search, keys, guides.
- **Density:** the compass is in the view tools; the drawing hint sits beside the shelf; focus mode (Shift+\) puts the sheet and outline away.

**How it was checked:**
- Browser at 1440×860, with your project backed up first and restored exactly afterwards: the outline docks and the shelf shifts clear; a comment dropped on Building A anchored to it and its count showed in the outline; the list opened a thread; `?new=blank` showed the empty state; no console errors.
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- Cloud comments are untested (the browser isn't signed in, and 0007 isn't run).
- Not done: review clouds on the drawing set and its cover-sheet list, field dots, a building's comments in its inspector.
- With the sheet, the outline and the empty state all open, the screen is crowded. Users also found the stage modes and the sheets confusing; docs/plans/pro-ia-rethink.md proposes a view-first Pro, and focus mode goes with it.

---

## 2026-11-23 · Phase 7: Sites, above projects

**What changed:**
- **The dashboard has Sites** (src/dash/sites.tsx), between Projects and Design systems. It's kept in this browser for now (src/pro/sites.ts); Supabase later.
  - **Paste plots** from a broker's list or a land bank, one a line: name, frontage, depth, road, DP road, and an asking price per sq ft if known; or name, area, road. Lines it can't read are listed back. **Add a plot** is a form for one; Edit and Delete are on each row's menu.
  - **The firm's default prices** sit above the list: the rules (Pune, Mumbai…; first from your preferred authority), the sale price (blank: the city's), and the target (margin or IRR).
  - **Each plot's quick figures:** area, road, potential (the built-up the FSI ladder allows), saleable carpet and homes from the best scheme, the most the land is worth outright (in all and per sq ft of plot), and the largest joint-development share. They're worked out one plot a tick after the page draws (about a tenth of a second each) and kept with the site until its plot or the prices change.
  - **Ranked** by what the land is worth. An asking price over it is underlined.
  - **A status per site:** Lead, Looking, Offered, Bought, Dropped, with a filter ("Open" hides bought and dropped). CSV of the list.
  - **Open** starts a project on the plot at the Looking stage, in Brief, under the same prices and target, and moves a lead to Looking.
- **Explore's "Screen many plots"** now points to Sites; its runner is gone and the paste reader (src/pro/screen.ts) is shared.
- Dashboard search finds sites by name.
- **tools/dev/test-sites.ts**, in `npm test`, checks that:
  - 20 pasted lines give 19 plots and one line listed back; an asking price is kept;
  - twenty plots are ranked by what the land is worth;
  - no scheme builds past its potential;
  - the best opens as a project with its plot and road, at the Looking stage, with the same area.

**How it was checked:**
- Browser at 1280×800, with your project and the dashboard's storage backed up first and restored exactly afterwards:
  - twenty pasted plots worked out in about 2 s and ranked (NIBM first at ₹16.60 cr, ₹4,723/sq ft);
  - Open took NIBM into Pro at Looking, in Brief, and the scorecard matched the row exactly (potential 1,36,584 sq ft, saleable 82,749 sq ft, worth ₹16.60 cr); the site moved to Looking;
  - at phone width the page scrolled sideways (the header buttons and the status filter); fixed: they wrap and scroll in place.
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- No adding from the map yet.
- The list is in this browser only, so viewers and teammates don't see it.
- Every site is a rectangle on one road: no corner plots or drawn outlines.
- Opening a site replaces the project in this browser, as New project does.
- The figures use the default deal; a site's own deal or land price isn't modelled beyond its asking price.

---

## 2026-11-23 · Phase 6: the architect's floor

**What changed:**
- **Flat sizes are a design input.**
  - `sizes` (carpet m² for 1, 2, 3 BHK) is on the project and on each building, and kept per option.
  - Brief › Flat sizes sets the project's, in sq ft, with "The starting sizes" to reset them.
  - The inspector's "Its own flat sizes" sets a building's.
  - The layout (both plain and formed buildings) cuts flats near the sizes asked. Flats come whole, so they land about 15% under to 40% over.
- **The typical floor** (src/pro/floor.ts, in the inspector): flats a floor by type, carpet each against the size asked, cores, the floor's area and carpet, its efficiency, and how many floors are like it.
- **Fit its length:** for a straight building, "Flats a floor" and a button that finds the shortest length holding at least that many. The toast says when the count it gets differs (counts jump, for example 4 to 8).
- **Numbers › Inventory** (folded): every flat by building and type, count, carpet each, and value at the sale price, with a total. A building's name picks it; "Change them" opens Brief › Flat sizes.
- Search finds Flat sizes and Inventory.
- **tools/dev/test-floor.ts**, in `npm test`, checks that:
  - bigger 2 BHK sizes give bigger flats;
  - the inventory counts every flat and all their carpet;
  - the fit holds at least the target, and a metre shorter holds fewer;
  - fewer flats a floor gives a shorter building.

**How it was checked:**
- Browser at 1280×800, on your project, backed up first and restored exactly afterwards:
  - Building A (your tower) with its own sizes, 2 BHK at 650 sq ft: the typical floor showed 2 BHKs at 601 sq ft (asked 650), and the inventory followed (58 flats, ₹52.33 cr);
  - "Change them" opened Brief › Flat sizes;
  - the size fields were too narrow at 29 px; they now stack one per row.
- No console errors. `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- Picking a floor band in the outline or X-ray isn't built.
- "6 flats a floor" can be set only on a straight building; a formed building's plan sets its count.
- An exact flat count isn't always possible: the fit gives the shortest length with at least that many.
- The inventory is read-only, and its "Sizes asked" line shows the project's sizes even where a building has its own.

---

## 2026-11-23 · Phase 5: options and Compare

**What changed:**
- **Options** (src/pro/variants.ts) are other schemes on the same plot.
  - Each option has its own scheme, fill, type, floor cap, mix, shops, look, systems and FSI ladder.
  - The plot, rules, prices and deal are shared.
  - The project's own fields are always the option that's open, so the rest of Pro is unchanged. The list keeps each option's copy, and switching saves the open one first.
  - Options are stored in the project's JSON: `options`, `option`, `chosen`. There's no new table.
- **The option menu** sits by the stage menu in the top bar. From it you can:
  - open another option;
  - duplicate, rename, choose or delete the one open (never the last);
  - open Compare.
  
  Search has the same actions.
- **The brief and Explore add options and no longer overwrite the open one.**
  - "Use" became "Add" (+), and "Use the best" became "Add the best as an option".
  - Each new option is filled afresh, opened, and named after the result, for example "Brief: Slabs, at most 6 floors…".
  - The first option added turns what you had into Option A.
- **Compare** shows two to four options side by side: Built-up, Homes, Profit, Margin, IRR, Peak cash, Height, Failing checks and Departures.
  - The best value in each row is underlined.
  - Each column has "Open it" and "Choose".
- **The scorecard's "vs" toggle** appears once there are two options. It shows each figure's difference from a base option: the chosen one, or else the first other option.
- **Shared links:** `#s=…&o=<id>` opens that option.
- **tools/dev/test-variants.ts**, in `npm test`, checks that:
  - switching keeps each option's own fields;
  - shared inputs stay shared;
  - duplicate, rename and delete work, and the last option can't be deleted;
  - a field a brief clears (the hand-placed scheme) stays cleared.

**How it was checked:**
- The test caught one bug. A brief's option kept the hand-placed tower because the change went through a JSON copy, which drops `undefined`. It's fixed, and the test now covers it.
- Browser at 1280×800, on your project, backed up first and restored exactly afterwards:
  - "Plan it" made three options, each filled afresh;
  - Compare showed all four, with the best marked;
  - Choose set the chosen option;
  - "vs" showed the differences;
  - switching back to Option A brought its hand-placed tower back (1,20,153 sq ft).
- No console errors. `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- Compare has no thumbnails or split view yet, and there's no filter chart for many options.
- Undo is shared across options: undoing just after a switch can step back over it.
- The dashboard card doesn't show the chosen option.
- Approval files whichever option is open, not necessarily the chosen one.
- Brief option names are long; the top bar clips them at 220 px.

---

## 2026-11-22 · Phase 4: Brief, Design, Numbers, Approval

**What changed:**
- **The rail has four places in place of six steps** (src/pro/places.tsx). The keys are 1–4, and Back and Next are gone.
  - **Brief** has three parts:
    - *The site gives:* the rules, the FSI ladder and the constraints;
    - *You want:* Fill the plot and the flat mix;
    - *Make options from it:* the written brief, options, screening many plots and the plotted layout. These were under Explore.
  - **Design:**
    - the plot (on the map, by survey number, or imported);
    - what's on the site, living, the buildings, shops and parking;
    - **Look**: the design system's name and elevation, with "Open the design system". That opens the old Design step as a large sheet.
  - **Numbers:** the area statement first (a building line picks and frames it), then the money.
  - **Approval:** as before. The view pins a "✕ 3 fail" chip over each building with checks to look at, and a click picks and frames the building.
- **The pick stays when you change place.** Building A picked in Design is still picked, with its inspector, in Numbers and Approval.
- **The plot's editor shows only when the plot is picked** (click open ground inside it). Before, it also showed whenever the Site step was open.
- **The stage chooses where you land and what the scorecard shows.**
  - **Looking** opens on Brief. The scorecard shows Potential (the permissible built-up and the FSI taken), Saleable (carpet), Land worth, Profit and Rules.
  - **Designing** opens on Design. The scorecard is as before.
  - **Applying** opens on Approval. The scorecard shows Built-up, Homes, Rules, Fees and Documents; Fees and Documents unfold their sections.
  - Setting the stage moves you to its place, and opening a project lands on its stage's place.
- **Old step values carry over.** A stored step from the six steps maps to the place that took it in, and a note says so once. The dashboard's starts (sample, template, survey or import, a design system) land on Design; a design system also opens Look.
- **Search** has the new places. Its settings were re-filed, and the builder's sections open the Look sheet (shown as "Design › Look › …"). "Look" and "Area statement" were added, so the test covers 45 sections.

**How it was checked:**
- Browser at 1280×800:
  - the stored "site" step opened on Brief, with the note;
  - Design's sections and Look's sheet;
  - Numbers opens on the area statement;
  - Looking and Applying each landed on their place with their own scorecard, and the stage was set back to Designing;
  - Building A stayed picked from Design to Approval;
  - the check pin shows over A.
- No new console errors.
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- Not built yet:
  - the permissible envelope (a ghost volume) in Brief;
  - the profit tint in Numbers;
  - the inventory in Numbers.
- The scorecard follows the stage, not the place.
- Screening many plots is still under Brief until the dashboard's Sites (phase 7).
- In Approval, at the sheet's width, some scrutiny rows overlap their text ("Commercial floors by road width"). This was there before phase 4.
- The phone view isn't changed. Its links from the places map to Overview, Money and Rules.

---

## 2026-11-22 · Phase 3: the inspector

**What changed:**
- **The inspector** (src/pro/inspector.tsx) is a panel on the view's right that follows what's picked. It shows on wide screens only; a phone keeps its read-only building card.
  - **A building:**
    - its name, which can be typed over;
    - duplicate and remove;
    - the departures it needs, built-up area and homes;
    - Size: floors, and length and depth for a straight building, plus turn buttons;
    - Shape, By hand (silhouette and plan), Roof and Skin for a formed building, or Shape it for a straight one;
    - Flat mix and Design system;
    - Floors by use, which X-rays a floor;
    - its checks;
    - Systems and Flat plans.
  - **The plot:**
    - the planning authority;
    - frontage and depth, while it's a rectangle;
    - a table of its edges, each with its length, the road today and the road's width in the development plan;
    - levels: over the road, the slope, and which way it falls;
    - north.
  - **A thing on the site:** its width, levels, or how far across, by kind. A tree, well or no-build zone gets its radius, how much is kept clear, and a note. Each can be removed.
- **Hiding it:** its × hides the panel and keeps the pick. The building bar's Inspect, or a new pick, brings it back.
- **The view keeps clear of it.** `ProView.setCover(x, y, r)` takes a right edge. The view's middle, the tools and the compass shift left by the panel's width, and the floating bars stay left of it.
- **The building's floating bar is slimmer** while the inspector is open: Shape, Roof, Skin, Mix, Style and Inspect are in the panel. Their popover bodies are now shared components in formHud.tsx: `ShapeBody`, `RoofBody`, `SkinBody`, `MixBody`, `StyleBody`.
- **The Scheme step is project-wide only.** The picked-building card, with its back link, is gone. Its Systems and Flat plans live in the inspector, and the Next and Back footer always shows.

**How it was checked:**
- Browser at 1280×800:
  - picking Building A from the list opened the inspector with every section. The bar slimmed, and the floating bar stayed clear of the panel;
  - × hid the panel, and the bar's Inspect came back;
  - Esc deselected;
  - clicking the plot opened the plot inspector with the edges table.
- No new console errors. The ones there were from hot reloads mid-edit.
- `npm test` ALL OK. The search test now covers 43 sections, with nothing left out. `npm run build` OK.

**Left or known:**
- Not checked in the browser: editing values in the inspector, and the inspector for roads, parking, gates and features.
- At 1280 px the building's floating bar can touch the tool shelf, because the room between the shelf and the inspector is narrow.
- The plot is in the inspector only when it is picked on the view. On the Site step with nothing picked, the plot's bar shows and the inspector doesn't.
- The step sheet still floats or pins on the left; phase 4 reworks the rail and steps.

---

## 2026-11-22 · Phase 2: find anything, one Share

**What changed:**
- **Search (Ctrl+K, or the Search button)** (src/pro/search.tsx). It reaches:
  - every step, and the view commands;
  - undo and redo;
  - the stage;
  - each building (it picks and frames it) and the plot;
  - every Share item;
  - every setting.
- **Settings in search** come from a hand-kept list, src/pro/findable.ts: 45 sections and 49 fields. Choosing one opens its step, unfolds the section, then scrolls to the field, focuses it and flashes it.
- **tools/dev/test-findable.ts** is in `npm test`. It fails if a section is missing from the list, or if the list names a section or field that isn't there. It caught the Design › Roof section on its first run.
- **Share ▾ is the one place for outputs:** a link, people and comments (Team's button is gone from the top bar), an image or a path-traced image, the drawing set, drawings as a PDF, the area statement, model JSON and IFC.
  - The Render-an-image menu in the view tools is gone.
  - Scheme › Export the model is gone.
- **One job chip** by the save state. It shows rendering or path tracing with progress and Cancel, and "Making the PDF…". It replaces the floating `still-prog`.
- **The project menu** sits beside the name. It holds:
  - the project's stage (Looking, Designing, Applying), stored as `ProProject.stage`, Designing by default;
  - five recent projects, yours and shared with you, when signed in;
  - All your projects (the dashboard);
  - New project.
  
  The Projects dialog, and its delete, are gone: deleting is on the dashboard.
- **The account menu** replaces More: the email, the dashboard, search, shortcuts, the simple editor, sign out.
- **`Menu`** (ui.tsx) can now have a label, headings, ticked items, a second line, disabled items, and an `onOpen`.

**How it was checked:**
- Browser at 1280×800:
  - "parking" in search landed on Scheme › Living › Parking, focused and flashed;
  - the Share menu;
  - a path trace started from Share showed in the chip and cancelled from it;
  - the stage menu.
- Phone (375 px): the top bar and the share sheet are unchanged.
- No new console errors.
- `npm test` ALL OK, including the new search test; `npm run build` OK.

**Left or known:**
- The stage does nothing yet beyond being set and shown. Phase 4 makes it choose where you land and the scorecard's figures.
- The dashboard card doesn't show the stage yet.
- Not checked: the recent-projects list and sign-out (accounts are off locally).
- Approval › Drawings and report keeps its own PDF button and busy state, outside the job chip.

---

## 2026-11-22 · Phase 1: the numbers everyone shares

**What changed:**
- **The FSI ladder** (`ProProject.load`, src/pro/ladder.ts).
  - Basic FSI, then premium, TDR and ancillary, each taken or left. A part left out is gone from the permissible area and the money.
  - `plotReport(p, floorH, all)` applies it, after the TOD and height-cap limits.
  - `Evaluated.full` keeps what every part would give.
  - In the Site step, the ladder replaces Allowed. "How much" became "How much of it to build".
- **What each part adds to profit** is worked out with one evaluation per part, a part at a time, 450 ms after the project settles. It's hidden for buildings placed by hand, which the ladder doesn't change.
- **What the land is worth** (`landWorth` in deal.ts) is solved by bisection on `applyDeal`. It gives the most to pay outright, and the largest joint-development revenue share, for a target margin or IRR (`ProProject.target`, 20% margin by default). It shows in Money, and on the scorecard as "Land worth" while no land price is put in.
- **The area statement** (src/pro/areaStatement.ts) is one list of rows.
  - Pro shows it live, from Built-up on the scorecard or the button under the ladder. Building lines frame their building.
  - The drawing set's sheet prints the same rows.

**How it was checked:**
- Node, on the sample:
  - leaving out premium, TDR or everything paid moves the permissible area to 6,189, 4,909 and 2,068 m², from 7,789;
  - at the solved land price, the margin is exactly the target (0.0500).
- Browser: the ladder, the gains (+₹6.92 cr premium, +₹5.64 cr TDR), the Money section (₹4.12 cr, or 7.8%), the area statement window, and the drawing-set sheet.
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- Buildings that aren't formed get one area-statement line per building, not per floor.
- In the money model, built-up area beyond the parts taken is still charged as TDR. A hand-placed scheme that goes over shows a cost, not just a failed check.
