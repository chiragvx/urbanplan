# Plan: building alignment in the 3D, and internal roads that follow the buildings

Researched on 2026-11-21 by a side agent, after the user reported "pillars phasing out of the building bounds" and "the roads (internal) not adhering to a building size change (remember the procedural requirement)". No code has been changed yet. Line numbers are as of commit 6c885ce.

**One root cause behind both problems:**
- The scene draws perimeter elements block by block from `b.quads`, never from the building's real outline.
- The site's roads come from the plot, or are frozen in the saved scheme. They are never derived from the current buildings.

---

## Problem 1: vertical elements and perimeter members outside the footprint

**How slab geometry works today.**
- `buildingQuads` (src/doc/site.ts:489-494) makes one quad per spine segment. Neighbouring wings share a full mitred edge.
- Exceptions:
  - at sharp turns the mitre clamp (site.ts:468) breaks this, giving partly shared edges, gaps or overlaps;
  - a collinear middle node gives two quads whose outer faces are collinear, which puts a false "corner" in the middle of a facade.
- `facadeBays` (src/pro/openings.ts:41-56):
  - Its outward normal is correct for both ring windings.
  - But `inner` is decided from one midpoint, so a partly shared edge is wholly drawn or wholly dropped: either a see-through hole, or a facade inside the other block.
- Formed buildings draw their own meshes and aren't affected.

**Issues, by impact:**
1. **Roof parapets and copings run on every quad edge, internal mitre edges included** (scene.ts:1026-1031).
   - This makes a 1 m wall across the roof at every L, U or court joint.
   - The `L + 0.1` / `L + 0.16` overruns poke 5–8 cm out of outer corners.
2. **Floor bands also run on raw quad edges** (scene.ts:950-955). Each `L + 0.24` band sticks 12 cm out of every external corner of a bent building, and into courtyards at reflex corners.
3. **Stilt and podium columns** (scene.ts:829-833):
   - they always face world X, so they're rotated against the wall on any building that isn't axis-aligned;
   - they're centred on the edge, so half of each column sits outside the slab;
   - they double up on internal mitre edges;
   - corner columns are emitted once per edge.
4. **"Corners" that aren't corners.** These all treat each quad face's ends as corners, so a straight facade made of two collinear quads gets a pier, corner glass and a broken rhythm halfway along:
   - accent corner piers (879-882) and glazed corners (855, 883, 959-964);
   - the end bays kept clear in `slotsOn` (openings.ts:72);
   - bay piers, whose rhythm restarts per block (871-877);
   - grazing lights (935).
5. **Partly shared edges** leave gaps or hidden facades. Openings use their own unit-edge test (openings.ts:146-147), so they can float where `cutFace` left no wall.
6. **Crown members:**
   - Cornice (1034): reaches 0.6 m out but extends only 0.5 m past each end, so it leaves a notch at convex corners and pushes 0.5 m into the next wing at reflex corners. String courses (867-868) have the same problem, smaller.
   - Pergola (1035-1049) runs per quad, so a bent building gets overlapping pergolas. Its posts can hit the parapet at acute vertices, or leave a non-convex quad.
7. **Attachments that hang past a face end:**
   - window fins (1006-1009) at `o.w/2 + 0.25`, never checked against the face span;
   - reveals (`w + 0.36`) and chhajjas (`w + 0.6`);
   - cantilever balconies (`w + 0.9`), which cut into the neighbouring wing at reflex corners.
8. **Entrance portal and canopy** (901-907):
   - they stand 2.4–3 m off a face chosen per quad, which may not be the building's real front;
   - nothing checks them against the drive or the fire band.
9. **Shops:**
   - Shop fronts (675-687) are taken from per-quad strips, so faces between strips get glazing inside the building.
   - Their pilasters sit up to 0.25 m out, and are drawn on the upper floors too, over the cut facade.

**Fix plan, in order:**
1. **One outline per building.** A shared helper, e.g. `buildingOutline(quads)` in `src/pro/render/outline.ts` or next to `ringOf` in site.ts.
   - Build it from the Clipper union of the quads (`union`, `fromFlat`, `offset`, `diff` in src/doc/ground.ts).
   - Keep the holes, so courtyards survive (`outlines()` keeps only `p[0]`).
   - Simplify it (`simplify`, ground.ts:470) to merge collinear edges.
   - Return edges with: start point, along direction, outward normal, length, and whether each end is a convex or reflex corner (with its turn angle).
2. **Rebuild `facadeBays` on those edges**, with `startConvex` and `endConvex`; `inner` is no longer needed.
   - Everything downstream follows: `cutFace`, `slotsOn`/`planFloor`, string courses, piers, corners, lighting, entrance and sign.
   - `slotsOn`'s face matching still holds, because unit walls lie on subsets of outline edges.
3. **Parapets, copings, floor bands and columns from the outline edges, not `b.quads`:**
   - parapets and copings inset by half their thickness;
   - columns oriented along the face, inset by half their size, one per outline vertex at the corners, and internal ones on a grid inside the outline.
4. **One end-trim rule** (`endExt(edge, end, reach)`) for every horizontal member that wraps a corner:
   - extend by its reach at convex ends: `p` at 90°, `p·tan(θ/2)` otherwise (so the cornice gets 0.6, not 0.5);
   - trim by the neighbour's reach at reflex ends.
5. **Pergola:** one per building, laid out on the outline inset by 0.8 m, with posts at its vertices and slats clipped to it.
6. **Attachments clipped to the face span and the outline:**
   - fins, reveals and chhajjas clamped to `[0.05, L - 0.05]`, and dropped when they shrink below 0.1 m;
   - balconies tested against the building grown by 0.05 m, then shortened or dropped.
7. **Entrance from the outline:**
   - checked against roads, the fire band and other buildings, falling back to a flush canopy if blocked;
   - exported from a shared `entranceOf(b, F)`, so the derived roads use the same point.
8. **Shops:** merge each building's strips before taking shop fronts, and inset the pilasters.
9. **Clean-up:** `facadeBays` is computed twice in `set()` (scene.ts:827, 846). Compute it once.

---

## Problem 2: internal roads don't follow building changes

**Root causes, by impact:**
1. **Roads freeze once the user owns the scheme.**
   - `ownScheme` (src/pro/project.ts:293) copies the optimiser's roads with `auto` cleared, so they look hand-drawn.
   - `generate` then takes the manual branch (project.ts:232-240), so `optimise` and `accessRoads` never run again.
   - The edits (`moved`, `stretched`, `turned`, `duplicated` in edit.ts:704-742) only rewrite a building's spine or form.
2. **The optimiser derives roads from the plot, not the buildings.**
   - `accessRoads` (optimise.ts:402-476) places spines at fractions of the plot's bounding box, then packs buildings around them.
   - The default `access: 'perimeter'` makes no roads at all.
3. **The fire-tender drive hugs the plot boundary.**
   - `groundOf` (site.ts:1013-1033) offsets the net plot ring and switches the drive on site-wide by height, regardless of where the buildings are.
   - The real per-building fire band (`fireBand`, site.ts:1095-1106) follows the building, but it's only a check. So the drive that's drawn and the fire way that's checked are two different things.
4. **Roads are never cut back from buildings.**
   - `layGround` (ground.ts:396) builds roads without subtracting buildings, so a road a resized building now covers is still laid under it.
   - Markings are drawn over buildings, while kerbs, footpaths and poles vanish piecemeal (`free()` tests).
5. **Gates follow road ends** (site.ts:1043-1050), and those ends are frozen.

**Procedural design. The rule: derived roads are never stored; every `generate`/`solveSite` derives them afresh from the current buildings, hand-drawn elements and design settings. Only hand-drawn elements persist.**
1. **Keep the distinction.**
   - Keep `auto` in `ownScheme`, or better, don't save derived roads at all and keep a `design.access` override.
   - Filter out `auto` roads in `generate`'s manual branch.
   - Old projects with frozen roads need a one-time migration or a "Re-derive roads" action.
2. **A new `deriveAccess(r, B, handEls, design)` in `src/doc/access.ts`**, called in `solveSite` once the buildings are known (site.ts:515-562), with its output passed into `groundOf`.
   - **(a) Clearances:** each building's union outline (formed buildings: `L.outline`).
   - **(b) Fire-tender way**, per building over 15 m, not site-wide:
     - The lane's centreline is the outline offset by `FIRE_GAP + FIRE_W/2`. `FIRE_GAP` is the clear distance from the face to the lane's near edge, about 1.5–3 m; `FIRE_W` = 6 m.
     - Clip it to the plot shrunk by half the lane width and to the other buildings' clearances, so nearby towers merge into one loop.
     - The lane ends become gates.
     - It replaces the plot-hugging drive, which stays only as an explicit "perimeter drive" option. `fireBand`/`fireOk` then test this same lane.
   - **(c) Entrance spurs:**
     - From `entranceOf(b)`, pushed out by `FIRE_GAP`, a two-leg orthogonal road in the road frame runs to the nearest lane, road or gate, at `design.roadW ?? 7`.
     - It's accepted only if it doesn't overlap another building's clearance; otherwise try the other order, otherwise leave just the walk.
   - **(d) Spine and grid modes:** `accessRoads` lays roads in the largest free corridors between the buildings' clearances, not at bounding-box fractions.
   - **(e) Gates:** fed by the derived road and lane ends, so they move with the buildings. Hand-placed gates still win.
3. **Hand-drawn roads stay as drawn but always clear the buildings.**
   - `layGround` subtracts the buildings grown by a clearance of about 1.5–3 m.
   - A road cut by a building is flagged as a departure ("road blocked by building").
   - Kerbs, footpaths, poles, trees and markings follow the clipped road edges instead of centreline offsets.
4. **Editing derived roads.**
   - Recommended: derived roads can't be dragged. Selecting one shows its settings (lane gap, which sides, spur on or off), stored on the building (`ProBuilding.access`) so they move with it.
   - Alternative: dragging a derived road detaches it into a hand-drawn road, with a hint that it no longer follows the building.
5. **Constants beside `FIRE_W` and `FIRE_H`:**
   - `FIRE_GAP`;
   - the lane's maximum distance from the face (the UDCPR/NBC clause is **not verified**);
   - `ROAD_CLEAR`, the clearance for ordinary roads;
   - a minimum turning radius at lane corners (round joins).

**Functions to change:**
- `ownScheme` (project.ts:290-295) and `generate`'s manual branch (project.ts:232-240)
- `solveSite` (site.ts:499-602), which calls the new `deriveAccess`
- `groundOf` (site.ts:992-1076): replace the drive, feed the gates from derived lines
- `fireBand` and `fireOk` (site.ts:559-560, 1095)
- `accessRoads` (optimise.ts:402)
- `layGround` road clipping (ground.ts:396)
- the scene's site kit and markings (scene.ts:751-782)
- `moved` (edit.ts:704), for detaching

---

## Related misalignments

- **Drive position:** site.ts:990 says the drive runs "3 m in from the wall", but its edge actually sits on the wall line, so wall-side kerbs and footpaths fail `free()`.
- **Gate setback:** with a setback, the gate leaves sit across the road's start, because the road doesn't start at the setback line.
- **Gate cabin:** it's checked only with `free()`, not against the road or wall, so it can land on the drive.
- **Pedestrian gate:** it isn't checked against the plot corner or a neighbouring gate.
- **Wall piers:** placed per run, so they double up at run ends and gates.
- **Road trees:** they can land in the fire hardstanding, because `free()` doesn't test `map.fire`.
- **Walks:** walks to the roads start at quad mid-edges, so on bent buildings they can start at an internal edge. Use the outline and `entranceOf` instead.
- **Courtyards:** courtyard holes are lost wherever `outlines()` is used. The new outline helper must keep them.
