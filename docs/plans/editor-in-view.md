# Plan: the main view is the editor

Researched on 2026-11-21 by a side agent. No code has been changed. Line numbers are as of commit 90eeefc.

**The goal.** You place, shape and set everything in the 3D/2D view (`<main class="stage">`, src/pro/main.tsx:383-428). The side panel stops being the place where things get edited. It becomes a sheet you open over the view for long forms: money, approval, explore, the specification, systems.

**Where things stand.** The base is good:
- `CanvasEdit` (src/pro/edit.ts) already does picking, moving, screen-space snapping with guides, drawing (point, line, area, rectangle), plot corner drags, and point editing on a formed plan.
- Everything goes through `up`, so it can be undone.

What's missing is everything after "it's picked". Floors, depth, length, turning, duplicating, the shape, the uses, the mix, element and feature properties, the plot's roads and north are all set in the panel (sitePanels.tsx:231-266, shapePanel.tsx:192-231, sitePanels.tsx:114-176). The view also has no selection object, no handle model, no screen-space UI tied to world points, and no typed number entry.

---

## 1. Every editing feature today

**Legend:** **P** = side panel (step › section) · **T** = view toolbar · **C** = canvas gesture · **K** = keyboard

### The plot and the site

| What it edits | Where it lives now | Implemented in |
|---|---|---|
| Planning authority (rules) | P Site › Rules | sitePanels.tsx:110-112 |
| Plot as a rectangle (frontage × depth) | P Site › Plot › Size | sitePanels.tsx:118 |
| Plot drawn as a polygon | P Site › Plot › Draw picks the `plot` tool, then **C** click corners, Enter or close on the first corner | sitePanels.tsx:115-119; edit.ts `finish` 610 |
| Plot corner drag | **C** only on the Site step, select tool | edit.ts:401-411 (`kind:'corner'`), move 483-490; corners drawn 659 |
| Plot by survey/CTS number | P Site › Plot › Survey no. | steps.tsx `FindPlot` 57-98 |
| Plot imported (GeoJSON, KML, pasted corners) | P Site › Plot › Import | steps.tsx `ImportBox` 100-116 |
| Road on each edge (width today, DP width) | P Site › Roads: two selects per edge | sitePanels.tsx:124-140 (`setEdge` 78-82) |
| Levels (plot over road, slope, falls toward), terrain read | P Site › Levels and north | sitePanels.tsx:142-157, `readGround` 89-101 |
| North | P Site › Levels and north, a number. The compass (main.tsx:387) only shows it, and clicking it switches to the plan | sitePanels.tsx:155 |
| Site features: tree, structure, power line, water, well, pole, no-build | P Site › On the site (tool grid), then **C** draw | sitePanels.tsx:160-161; siteObjects.ts:25-33; edit.ts finish 611-615 |
| Feature pick and move | **C** on the Site step; P list 162-165 | edit.ts:412-413, `moved` 704-706 |
| Feature radius, clearance, note, remove | P Site › On the site › picked card | sitePanels.tsx:166-175 |
| Feature vertices | **None**: a feature can only be moved whole | — |
| Height cap, transit-oriented zone | P Site › Constraints | sitePanels.tsx:195-199 |

### The scheme fill

| What it edits | Where it lives now | Implemented in |
|---|---|---|
| How much, building type, most floors, most buildings, Fill again | P Scheme › Fill the plot | sitePanels.tsx:269-281 |
| Green, play area, roads inside, spacing, parking type, basements | P Scheme › Living | sitePanels.tsx:283-291 |
| Project flat mix | P Scheme › Flat mix | sitePanels.tsx:293-297 |
| Shops at the front (floors, depth, price) | P Scheme › Shops | sitePanels.tsx:319-328 |
| Export the model (JSON, IFC) | P Scheme › Export | sitePanels.tsx:339-344 |

### Buildings

| What it edits | Where it lives now | Implemented in |
|---|---|---|
| Place a template | P Scheme › Add a building (Gallery), then **C** click (ghost shown) | gallery.tsx:26-51; edit.ts `placeTemplate` 138-164, ghost 534-537, finish 623-633 |
| Place a basic shape (slab, tower, L, U, court, drawn) | P Gallery › Basic, then **C** | edit.ts:36-43, `shapeAt` 67-77, finish 616-622 |
| Pick | **C** click; P Scheme › Buildings list 306-317; script `urbanplan.pick` | edit.ts:437-438; main.tsx:314 |
| Move | **C** drag (corner/edge/grid snap, Alt frees it); **K** arrows nudge a grid step (Shift ×10) | edit.ts `startMove` 453-478, move 506-529, key 588-600, `moved` 704-710 |
| Remove | **K** Delete/Backspace; P picked card trash | edit.ts:576-586; sitePanels.tsx:235 |
| Duplicate | P picked card + | sitePanels.tsx:235; edit.ts `duplicated` 726-734 |
| Turn | P picked card: −15°, +15°, 90° | sitePanels.tsx `Turns` 51-57; edit.ts `turned` 720-724 |
| Stretch (length) | P picked card › Length (straight buildings only) | sitePanels.tsx:243; edit.ts `stretched` 736-743 |
| Depth | P picked card › Depth (straight only) | sitePanels.tsx:240 |
| Floors | P picked card › Floors (straight); P Shape › Floors stepper (formed) | sitePanels.tsx:239; shapePanel.tsx:202-205 (`setFloors` 79-90) |
| Name | P picked card › Name | sitePanels.tsx:237 |
| "Shape it" (straight to box form) | P picked card | shapePanel.tsx `shapeIt` 184-190, 196 |
| Shape preset (straight, taper, twist, steps, wave, lean) | P Shape | shapePanel.tsx:206, `PRESETS` 24-31 |
| Top size, twist, roundness, lean | P Shape, four sliders | shapePanel.tsx:207-212 (`scaled` 35-50, `rounded` 56-72) |
| Uses stack (bands bottom to top: use, floors, add, remove) | P Shape › Uses | shapePanel.tsx `UsesStack` 138-164 |
| Roof, skin | P Shape | shapePanel.tsx:214-218 |
| Plan points of a formed building | **C** drag a point, click the + at an edge midpoint, Delete removes the last dragged point; also P Shape › By hand › `PlanEditor` (SVG) | edit.ts:416-436, 492-505, 579-584, draw 660-672; silhouette.tsx:227-279 |
| Key floors (width, lean), slot carve, fins, ease | P Shape › By hand › `SilhouetteEditor` (SVG), buttons | silhouette.tsx:153-220; shapePanel.tsx:219-228 |
| Its own flat mix | P picked card toggle and three numbers | sitePanels.tsx:248-249 |
| Design system for one building | P picked card select | sitePanels.tsx:250 |
| Systems (stairs, lifts, MEP) | P picked card › Systems | sitePanels.tsx:251-252; systemsPanel.tsx |
| Flat plans (read-only) | P picked card › Flat plans | sitePanels.tsx:253-255 |

### Site elements

`ElementKind` has ten kinds (site.ts:131). Only six of them have a tool (edit.ts:44-51). **Roundabout, gate, wall and tank have no way to be placed in Pro.**

| What it edits | Where it lives now | Implemented in |
|---|---|---|
| Place a garden, play area, trees, lot, parking tower (area: drag or click corners) or road (line) | P Scheme › Add to the grounds, then **C** | sitePanels.tsx:302-304; edit.ts finish 634-639 |
| Pick, move, remove | **C** drag; **K** Delete | edit.ts:439-440 (`elementAt` 685-693) |
| Road width, parking levels | P picked element card | sitePanels.tsx:258-264 |
| Ring vertices, road nodes | **None** | — |

### Design, view and history

| What it edits | Where it lives now | Implemented in |
|---|---|---|
| Design system: start from, facade materials, balconies, review | P Design (the builder opens in a new tab) | designStep.tsx:738-779 |
| X-ray floor | **T** layers button and a −/+ floor group; **K** X, [ and ] | main.tsx:397-401, 406, 287-289 |
| Sun (on, month, hour) | **T** sun group | main.tsx:409-416, `applySun` 230-236 |
| Camera (fit, street, top, 3D/plan) | **T**; **K** F, S, T, P; compass click goes to the plan | main.tsx:389-392, 403-405, 290-294; scene.ts `look` 445-453, `setPlan` 302-316 |
| Render mode, quality, image render | **T** | main.tsx:393-396, 417-423 |
| Snapping | **T** magnet; **K** Alt held suspends it | main.tsx:407; edit.ts:375-384 |
| Undo/redo | header buttons; **K** Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y | main.tsx:67-79, 281-282, 339-340 |
| Window/door readout | hover tooltip (shaded mode only) | main.tsx:384, 427; scene.ts `pick` 615-625 |

**Couplings and gaps that shape the plan:**
- **Handles depend on the step, not on what's selected.**
  - Plot corners only work on the Site step (edit.ts:401).
  - Formed-plan points only work off the Site step (edit.ts:445).
  - Picking a building on the Site step does nothing.
- **The picked state is a single `Picked`** (edit.ts:34). There is no multi-select and no sub-selection, except a private `selPt` (edit.ts:250).
- **Escape never deselects** (edit.ts:572; main.tsx:284).
- **Undo groups by time.** Changes within 700 ms of each other are one undo step (main.tsx:72). A drag that pauses splits into several steps, and a quick edit right after a drag merges into it.
- **Every pointer move during a drag runs the whole pipeline:**
  - `up` → `JSON.stringify(p)` → `evaluate` → `fitRooms` → `scrutiny` → `applyDeal` (main.tsx:108-111);
  - then `view.set` throws away and rebuilds the scene (scene.ts:629-633).
  - The window hover raycast (main.tsx:384) also runs on every move, during drags too.
- **The overlay is plain lines and points.** It is untyped, untagged and has no labels. It is rebuilt on every `draw()` (scene.ts:350-361; edit.ts:645-674).

---

## 2. The in-view interaction for each feature

### 2.1 The parts of the view

1. **Tool shelf.** A vertical strip on the left edge of the stage:
   - Select (V), Building ▸, Grounds ▸, Site ▸, Plot, Measure (M), Comment (later).
   - Each ▸ opens a flyout over the view: the template gallery reused from gallery.tsx, the element tools, the feature tools.
   - The bottom toolbar (main.tsx:388-424) stays for view tools only: camera, render, X-ray, sun, snapping.
2. **Selection bar.** A floating toolbar anchored to the selection's screen bounding box:
   - It sits above the box, flips below when it would hit the result bar (`.results`, pro.css:296), and is clamped to the stage.
   - It holds the few properties people change most, as steppers, chips and pop-overs, plus an **Inspect** button that opens the sheet at that object.
3. **Handles and gizmos.** Drawn for the current selection: move, end, side, height, rotate, vertex and midpoint handles. Each one is a real focusable element (§4.3).
4. **Dimension labels.** Live lengths on the selection's edges, depth across, height at the top, and the distance to the nearest margin line. **Click one to type a value into it.**
5. **Measurements box (VCB).** While drawing or dragging, typing a number opens a small field at the cursor. Enter commits the value. This is SketchUp's pattern (§3).
6. **Hover readouts.** These reuse `.tip` (pro.css:332):
   - the size, floors and use of a building;
   - an edge's road;
   - while dragging, a delta such as "+3.5 m along the road, 2.1 m to the side margin".
7. **The sheet.** A drawer over the right of the view on desktop, or a bottom sheet on a phone. It holds the long forms. The view and the selection stay put underneath (§2.4).

### 2.2 Feature by feature

**Plot outline (corners)**
- In view:
  - Click the plot's boundary, or the open ground of the plot, to select the plot. This works in any step.
  - Corner handles drag with today's snapping. Midpoint "+" handles insert a corner. Delete removes a corner while at least three remain.
  - Edge labels show length; type into one to set it (the far corner moves along the edge).
  - On a `rect` plot, edge handles drag frontage and depth directly.
- Selection bar: area, **Find by survey no.**, **Import** (both open the sheet), **Redraw**.

**Roads on edges**
- In view: each edge gets a chip at its midpoint, outside the plot, e.g. "12 m road · DP 18".
  - Click it for a popover with today's width and the DP width (the same lists as sitePanels.tsx:131-134) and the carriageway/footpath readout from `roadParts`.
  - An edge with no road shows a faint "+ road" chip.
- This replaces the Roads section. The edge-facing text ("North-east") moves into the chip's tooltip.

**North**
- In view, the compass becomes a dial:
  - when the plot is selected (or on Alt-drag), drag the needle to turn north, in 5° steps;
  - focused, arrow keys turn it 5° (Shift 45°);
  - a plain click still switches to the plan.
- When `p.at` is set, the dial shows "set from the location", with an Unlock action.

**Levels and slope**
- In view: a slope arrow on the plot ("falls 4% to the SE"). Drag its head to set direction (in 45° steps) and steepness.
- The plot-over-road number lives in the plot's popover.
- "Read the terrain" goes in the plot selection bar.

**Site features**
- In view: placed from the Site ▸ flyout.
  - Picked, a point feature shows a **radius ring handle** (canopy, well) and a dashed **clearance ring handle**. Drag either to set it.
  - Line and area features get vertex and midpoint handles (generalise edit.ts:416-436).
  - A no-build zone's note is a field in the selection bar.
- This replaces the On the site section, its list and the picked card.

**Buildings: place**
- In view: the Building ▸ flyout holds the template thumbnails (`Thumb`) and the basic shapes. The ghost follows the cursor (already done).
- Add **Tab to cycle the snap target** and **typed offsets** ("6" Enter puts it 6 m from the snapped edge).
- After placing, the building is selected and the selection bar opens (today `finish` already picks it, edit.ts:621, 631).

**Buildings: move**
- In view: drag the body (as today), plus an explicit **move handle** at the base centre for touch and keyboard.
- While dragging, type a distance and Enter to move exactly that far along the drag direction.
- Ctrl-drag duplicates (SketchUp/Figma). After a Ctrl-drag duplicate, typing "x4" Enter makes an array of four.

**Buildings: stretch (length)**
- In view: **end handles** on the spine's first and last node move one end (a new `stretchedEnd`; today's `stretched` scales about the middle, edit.ts:736). Alt stretches symmetrically.
- The length label is editable.
- Formed buildings use their plan points, as today.

**Buildings: depth**
- In view: **side handles** at the midpoints of the long faces. Dragging changes `depth` symmetrically about the spine (6–80 m, half-metre steps).
- The depth label is editable.

**Buildings: turn**
- In view: a **rotate handle** just outside one corner. Hover shows a protractor arc centred on `middleOf(b)`.
  - It snaps to 15° steps measured from the road frame (consistent with snapSet rule 3, edit.ts:340-347). Alt turns freely.
  - Type an angle and Enter.
- The bar keeps ±15° and 90° buttons, which are also the keyboard path.

**Buildings: duplicate and remove**
- In view: in the selection bar, plus Ctrl+D, Delete and Ctrl-drag.

**Buildings: floors**
- In view: a **height handle** (a vertical arrow at the roof's centre).
  - Drag up or down. It snaps to whole floors (`e.ds.floorH`, or each band's own height for forms).
  - Readout: "14 floors · 44.8 m · up to 18 within the margins" (`br.maxFloors`).
  - A dashed ghost plane at the height limit (`r.rules.maxH`) appears while dragging.
- The bar has a − n + floors stepper (the `Stepper` from shapePanel.tsx:126). That stepper is the floors control in the plan view, where the height handle is hidden.

**Buildings: form**
- Preset: an icon popover in the bar (reuse `IconPick`).
- Top size, twist and lean become handles at the top floor's outline in 3D:
  - two scale dots on the top ring;
  - a twist arc at the top;
  - a lean diamond at the top centre (the 3D counterpart of the SilhouetteEditor handles, silhouette.tsx:211-216).
- "Round the plan" stays a slider in the bar popover.
- Key floors: rings at each key's height, each with the same handles. Click the building's side with Alt to add a key; double-click a ring to remove it.
- "Shape it" becomes a primary button in the bar for a straight building.

**Buildings: uses**
- In view: a **stack strip** anchored beside the selected building's side. It is a vertical bar whose bands are proportional to their floors.
  - Drag the boundary between two bands to move floors from one use to the other.
  - Click a band's icon to change its use (the `USE_INFO` menu).
  - A "+" at the top adds a band; an × on hover removes one.
- With X-ray on, the strip's floor ticks line up with the building's floors.

**Buildings: mix**
- In view: a bar popover holds the mix bar (`.mixbar`, sitePanels.tsx:294). Its two dividers are draggable, in 5% steps, with "Its own mix" as a toggle.
- The project-wide mix opens the same control from the Fill popover.

**Buildings: name, design system**
- In view: the name is editable inline in the selection bar's title. The design system is a select in the bar's "…" menu.

**Systems, flat plans**
- **Stay out of the view.** Inspect opens the sheet at that building.

**Site elements**
- In view: placed from the Grounds ▸ flyout. Add the four missing kinds: roundabout, gate and tank as points, the wall as a line (site.ts:147-151).
- Area elements get vertex and midpoint handles.
- A road gets node handles plus a **width handle** on each side of its centre line that snaps to `INTERNAL_WIDTHS`.
- A parking tower gets a height handle snapped to its levels.
- The bar shows the width chip or the levels stepper.

**Scheme fill**
- In view: when there's no scheme of the user's own, an empty-state chip on the plot reads "Filled for you · Change". The shelf also has a **Fill** button.
  - Both open a popover over the view: how much (slider), building type, most floors, most buildings, Fill again.
- Living, parking, shops and basements live in the sheet's "Fill settings".
- **The first hand edit takes the fill over** (`own`, edit.ts:697). The view should say so once, in a toast with Undo: "These buildings are yours now".

**X-ray floors**
- In view: a **floor scrubber**, a vertical slider along the right edge of the stage, with floor ticks and the current floor highlighted. It replaces the −/+ group.
- With a building selected, the scrubber's ticks are its own floors.
- [ and ] keep working.

**Sun**
- Already in view. Add: drag horizontally on the time label to scrub the hour, and arrow keys while it's focused.
- A sun-path arc overlay in the plan is a later nice-to-have.

**Camera**
- Already in view. Add:
  - **F with a selection frames the selection** (Figma's Shift+2); with nothing selected it frames the whole site.
  - Double-click on empty ground orbits about that point (OrbitControls target).
  - A plain double-click with a tool active still finishes the drawing.

### 2.3 How the plan and the 3D share the tools

- **One handle registry, one snapping engine.** Snapping already works in screen space through `toScreen` (edit.ts:311-373), so it behaves the same in both cameras.
- **Each handle declares the views it works in:**
  - height, key-floor and lean handles exist only in 3D;
  - in the plan, the bar's steppers stand in for them;
  - rotate and depth handles are larger and always shown in the plan, which is the precise view.
- **Drawing tools (plot, road, wall, area) suggest the plan** when the camera's pitch is below about 35° or the ray grazes the ground: a hint chip, "Draw in the plan (P)". They never switch views on their own.
- **The dimension labels and the VCB are view-independent.** They are DOM elements over the canvas.

### 2.4 What stays out of the view, and how it's reached

**Stays in the sheet:**
- Money (prices, rents, the deal, the statement), Approval (scrutiny list, permission, NOCs, fees, documents, the PDF/DXF), Explore (brief, options, screening, plotted layout).
- The design-system specification and the builder link, Systems, Flat plans.
- Rules, Allowed and Constraints, Survey lookup and Import, Fill settings, Shops, the parking statement, Export.

**How it's reached without leaving the view:**
- **The sheet** is a resizable drawer over the right of the stage on desktop (about 380 px, the view stays live and interactive to its left), or a bottom sheet with peek, half and full heights on a phone.
- **The steps rail stays.** A step opens its sheet instead of the fixed `aside.panel`. `/` toggles the sheet.
- **The result bar's KPIs** open the matching sheet: Profit/IRR → Money, Rules → Approval (main.tsx:469-501 already route there through `go`).
- **A failing check can point at its object.** Approval rows get "Show", which selects the building and frames it, using the `departures` ids (sitePanels.tsx:230).

---

## 3. References: how others handle this

- **SketchUp.**
  - *Measurements box (VCB):* after any click-drag action you just type a value ("36" Enter, "30,20" for a rectangle, "x5" or "/5" after a copy for arrays), with no field to focus first. This is the single most valuable pattern here.
  - *Inference engine:* it snaps to endpoints, midpoints and edges, plus "on axis", parallel and perpendicular, all colour-coded with a tooltip naming the inference, and you can hold Shift to lock one. Ours is similar (snapSet) but doesn't say *what* it snapped to; add the word ("on the margin", "in line with B's corner").
  - *Push/Pull:* drag a face straight along its normal. That maps to our height and depth handles.
  - *Move:* Ctrl copies.
  - *Rotate:* a protractor placed on a plane, snapping to 15°.
  - *Tools are modal:* Space returns to Select. Our V and Esc match.
- **Figma (and canvas tools in general).**
  - *Selection:* a selection box with corner and edge handles; rotation by hovering just outside a corner; Shift constrains, Alt works from the centre.
  - *Contextual properties:* a properties panel that changes with the selection. Its layout is incidental; the point is that selection drives what you see.
  - *Measuring and guides:* Alt-hover shows red distance lines to neighbours; smart guides appear during drags.
  - *Editing levels:* double-click or Enter goes into vector edit, Esc comes back out a level.
  - *Selecting:* Tab selects the next sibling; arrows nudge (Shift ×10); Shift+1 or 2 zooms to everything or the selection.
  - *Canvas hints:* the W×H label under the selection, and editable values in place.
  - Adopt these: the Enter/Esc levels (building → its plan points / key floors), Tab cycling, Alt distances, the selection-size label.
- **Autodesk Forma.**
  - Buildings are selected on the 3D canvas with direct handles: drag the top to change height in floor steps, push or pull edges of the footprint, drag to move. A properties/inspector panel appears for the selection.
  - Analyses (sun, daylight, wind, noise) are toggled from a toolbar and painted on the scene.
  - Area and metric figures are always visible and update live.
  - Taking from it: height-by-floor drag with a live result bar is exactly our ResultBar's job. Keep the inspector *contextual and short*.
- **TestFit.**
  - The core loop is dragging a building, or a handle on its bar, while parking, units and yield regenerate live. It's mostly a 2D plan with 3D one toggle away.
  - Settings sit in a side panel as sliders, but manipulation is direct and the yield table never leaves the screen.
  - Lesson for us: **regeneration during the drag has to be fast or deferred.** TestFit feels good because the feedback is immediate (§4.6).
- **Giraffe.**
  - Map-first. Drawing tools in a toolbar; features carry "usages" that drive colour and extrusion.
  - Vertex editing on the map in the mapbox-gl-draw style: vertex handles plus midpoint "ghost" vertices to insert. Edge length labels.
  - A properties panel on the right for the selected feature; dashboards of totals.
  - We already copy the midpoint "+" for forms; generalise it to plots, elements and features.
- **Archistar.**
  - Mostly generative: pick a site, run options, compare in a gallery, with editing mainly through parameters in a panel and light massing manipulation.
  - It shows where the **Explore** step belongs: a comparison sheet, not the canvas. Applying an option should animate the change in the view and keep Undo one keystroke away.
- **Also worth stealing.**
  - Rhino's gumball and Fusion 360's manipulator: arrows and rings on the object, each with a value box that opens on click. This is the model for our height, depth and rotate handles combined with the VCB.

---

## 4. Architecture

### 4.1 A selection model (new: src/pro/selection.ts)

```ts
type Target =
  | { k: 'building'; id: string } | { k: 'element'; id: string } | { k: 'feature'; id: string }
  | { k: 'plot' };
type Sub =
  | { k: 'vertex'; i: number } | { k: 'edge'; i: number }        // plot / ring / spine / plan point
  | { k: 'key'; i: number } | { k: 'band'; i: number };          // form key floor, uses band
interface Selection { items: Target[]; sub?: Sub; }              // sub only when items.length === 1
```

- It replaces `Picked` (edit.ts:34) and `selPt` (edit.ts:250).
- `main.tsx` holds it in place of `picked` (main.tsx:85). Keep `pick()` for the script API (main.tsx:314) as a wrapper.
- **What it does:**
  - Shift-click adds to the selection; a marquee in the plan (later) selects several.
  - Esc steps out one level (sub → item → nothing).
  - Enter or double-click goes in a level.
  - Multi-select allows move, delete, duplicate and floors±.
- **Remove the step coupling** (edit.ts:401, 445, 659). Which handles show depends only on the selection and the tool.

### 4.2 The handle (gizmo) layer (new: src/pro/handles.ts)

```ts
interface Handle {
  id: string;                         // stable: 'b:<id>:height', 'plot:v:3' …
  at: () => [number, number, number]; // world anchor, re-read each frame
  kind: 'move'|'vertex'|'mid'|'end'|'side'|'height'|'rotate'|'radius'|'width'|'key'|'lean'|'twist';
  views: ('3d'|'plan')[];
  label: string;                      // aria-label
  value?: () => { now: number; min: number; max: number; step: number; unit: string; text: string };
  begin(): void; drag(ev: DragEv): Partial<ProProject> | null; end(): void;
  nudge?(dir: -1|1, big: boolean): Partial<ProProject>;
  type?(v: number): Partial<ProProject>;  // the VCB / label edit
}
export function handlesFor(sel: Selection, p, e, tool, plan: boolean): Handle[];
```

- **What moves out of CanvasEdit into handle factories:**
  - the hard-coded checks in `down` (corner 401-411, plan points 417-436);
  - the corner drag and plan-point drag branches of `move` (483-505).
- **What CanvasEdit keeps:** tools, drawing, body-drag move, snapping, and the keyboard paths that aren't tied to a handle.
- **Handle drags get the same snapping:** `snapSet` becomes a public method, used for vertex and end handles. Height, angle and width snap to their own steps.
- **Hit priority:** focused handle > handles of the selection > building body > element > feature > plot. The ordering is in one place and testable.

### 4.3 Screen-space UI anchored to world points (new: src/pro/hud.tsx)

- **A `<div class="hud">` sits over the canvas** inside `.stage`. It holds:
  - the handles as `<button>`s;
  - the dimension labels;
  - the selection bar, the VCB, the stack strip and the floor scrubber.
- **ProView gets `onFrame?: () => void`,** called at the end of `frame()`'s rAF (scene.ts:362-377) and after `resize()`. It works like `onNorth`, which already updates the compass imperatively (main.tsx:202).
- **The HUD reprojects every anchor with `toScreen`** and writes `style.transform` directly through refs. **There is no Preact re-render per frame;** Preact renders only when the selection or project changes.
- **Off-screen and occluded anchors:**
  - an anchor behind the camera or outside the stage is hidden;
  - for occlusion, raycast only the selection's anchors against `wire.masses` (scene.ts:339-343) **when the camera rests**, and fade the occluded ones. This keeps it cheap.
- **Bar placement:** above the selection's screen bounding box, below `.results` (12 px + its height); it flips below the box and is clamped to the stage. It is hidden while dragging, so it doesn't jitter, and comes back on release.
- **Why DOM, not three.js sprites, for handles:**
  - crisp at any DPR;
  - CSS-themeable for light and dark;
  - real focus and ARIA;
  - native cursors;
  - pointer capture per handle.
- **The three.js overlay stays** for world-space geometry that needs perspective: drafts, guides, ghosts, outlines, height-limit planes.

### 4.4 The overlay system

- **Extend `Overlay`** (scene.ts:66) from four untyped arrays to tagged layers:

```ts
interface Overlay { layers: { key: 'draft'|'guide'|'ghost'|'sel'|'limit'|'clear'; lines?: number[]; dashed?: number[]; points?: number[]; hot?: number[]; fill?: number[] /* triangles */; }[] }
```

- **Rebuild only the layers that changed.** Today every `draw()` disposes and recreates all of it (scene.ts:351-352). Keep a `Map<key, Object3D>` and update the BufferAttributes in place where the length matches.
- **New layers:**
  - `limit`: a translucent quad at `maxH` over the buildable line while height-dragging;
  - `clear`: feature clearances while one is picked;
  - `sel`: the selection's outline. The wireframe already thickens the picked building (wire.ts:150); shaded mode needs it too.
- **Snap guides get words.** `snapSet` returns `{ d, guide, hot, why }`, where `why` is 'corner', 'edge', 'margin', 'in line with B', '15° to the road' or 'grid 1 m'. The HUD shows `why` next to the hot point.

### 4.5 Undo

- **Replace the time-based grouping** (main.tsx:72) with explicit transactions:

```ts
const tx = { open: false };
const begin = () => { if (!tx.open) { past.current = [...past.current.slice(-80), pRef.current]; future.current = []; tx.open = true; } };
const commit = (label?: string) => { tx.open = false; label && toast(`${label} · Undo`); };
up(o, { live: true }) // inside a transaction: no push
```

- **Who uses it:**
  - every handle and drag calls `begin()` on pointerdown and `commit()` on pointerup;
  - typed values, steppers and chips are a single step each;
  - typing in a panel number keeps the 700 ms grouping as a fallback.
- **Labelled steps** ("Moved Building A", "Building B: 14 floors") power an "Undo: …" tooltip on the header button (main.tsx:339).
- **Cancel:** Esc during a drag restores `base` and drops the step. The `base` is already kept in the `Drag` state (edit.ts:212-213).

### 4.6 Performance (the main technical risk)

Today every drag step re-runs evaluate, rooms, scrutiny, the deal and a full scene rebuild (main.tsx:108-111, 217-228; scene.ts:629-633). Fix it in three layers:

1. **Preview, then commit.**
   - During a move or height drag, CanvasEdit doesn't call `up` on every pointermove. It sets a **preview transform** on the dragged building's objects: a translation, rotation or y-scale on its group, plus its `wire.masses` mesh.
   - A new `ProView.preview(id, { dx, dz, rot, sy } | null)` does this. The formed buildings are already kept by id (`formed` map, scene.ts:183).
   - The project is updated through `up` at most every 120 ms (trailing), and once on release.
   - Snapping keeps working, because it only reads `targets()`, which are cached per `e` (edit.ts:283-302).
2. **Split the memo.**
   - `evaluate` stays synchronous (the result bar needs it).
   - `rooms`, `scrutiny` and `deal` run **after** the drag commits, or on idle (`requestIdleCallback`) while a transaction is open. The result bar shows a "…" state on Rules.
3. **Cheaper hashing.** Replace `useMemo(..., [JSON.stringify(p)])` (main.tsx:108) with identity: `up` always returns a new object, so `[p]` suffices. That saves a full stringify on every change.

**Also:**
- Suppress the window hover raycast (main.tsx:384) while a drag or tool is active.
- **Budget:** 16 ms per pointermove on the "standard" tier with a 6-building scheme. Measure with `?perf` (scene.ts:251).

### 4.7 Accessibility (a keyboard path for every gesture)

- **The stage is a focus region:** `role="application"`, `aria-roledescription="site editor"`, with a polite live region announcing the selection and each committed change ("Building A: 14 floors, 44.8 m, 3 rules to check").
- **Selecting:**
  - Tab and Shift+Tab, with the stage focused, cycle the objects (buildings, then elements, features, plot);
  - Enter goes into an object's handles, and Tab then cycles handles;
  - Esc steps out.
  - This is Figma's model. `[` and `]` stay for X-ray.
- **Handles are `role="slider"`** where they have a value (height, depth, length, rotate, width, radius), with `aria-valuenow`/`aria-valuetext`:
  - arrows step (Shift ×10), Home and End go to min and max;
  - Enter opens the VCB on that handle.
  - Vertex handles take arrows to move by a grid step, as the object nudge does (edit.ts:588-600).
- **Shortcuts:**

  | Key | Does |
  |---|---|
  | V | select |
  | M | measure |
  | R | rotate the selection 15° (Shift: −15°) |
  | Ctrl+D | duplicate |
  | + / − or PageUp / PageDown | floors (avoids the [ ] clash) |
  | Delete | remove |
  | F | frame the selection |
  | Ctrl+A | select all buildings |

  Check them against main.tsx:285-296 and the CanvasEdit key handler: S, T, P, X and F are taken, and Backspace deletes when not drawing (edit.ts:576). Restrict deletion to Delete only, so a stray Backspace can't remove a building.
- **The selection bar is a `role="toolbar"`** with roving tabindex. F6 moves focus between the shelf, the stage, the bar and the sheet.
- **Under `prefers-reduced-motion`,** the bar doesn't animate and the camera frames without tweening (wire.ts:52 already respects it).
- **Every popover is a real dialog/menu** (the `Menu` and `Select` from ui.tsx), so the CanvasEdit key guard (edit.ts:571) keeps working.

### 4.8 Touch and phones

- **Pointer events are already used and `touch-action: none` is set** (pro.css:292). Keep these rules:
  - one finger on an object drags it, one finger on empty space orbits, two fingers pan and zoom (OrbitControls);
  - **a long press (450 ms)** selects without moving and opens the bar. This avoids accidental drags when a user meant to orbit.
- **Hit targets:** under `@media (pointer: coarse)`, handles are 44 px (shown 14 px with an invisible 44 px hit area). `SNAP_PX` scales with `devicePixelRatio` and is coarse-aware (edit.ts:54).
- **Drawing with no hover:**
  - each tap adds a point;
  - a magnifier loupe, offset above the finger, shows the snap target while the finger is down, and lifting commits;
  - the drawhint's Done (main.tsx:386) stays as the finish action.
- **Typed values:** tapping a dimension label opens an `inputMode="decimal"` field docked above the keyboard, not at the cursor.
- **Phone layout:**
  - the selection bar docks as a horizontal scroller just above the bottom tools;
  - the sheet is a bottom sheet with detents, replacing "panel under the 3D" (pro.css:363-392);
  - the stage takes the full height minus the rail;
  - the shelf collapses to a single "+" button opening a grid sheet;
  - the floor scrubber becomes horizontal.

---

## 5. A phased plan, biggest difference first

### Phase 1: Buildings are edited where they stand

The core loop of placing and shaping buildings stops needing the panel.

**Deliverables:**
- `selection.ts`, holding one item for now plus `sub`. Esc deselects. Step coupling removed from `pickedForm` (edit.ts:445).
- **The HUD layer** with `ProView.onFrame` and anchors.
- **The selection bar for a building:**
  - name inline, floors stepper, ±15°/90° turn, duplicate, delete, Shape it, design-system select, Inspect;
  - when the building is formed: a preset popover and a mix popover.
- **Handles:**
  - height (floors, with the max-floors and limit-plane readout);
  - side (depth) and end (length), for straight buildings;
  - rotate, snapping to 15° from the road;
  - move (for touch and keyboard).
  - Formed buildings keep the plan points and get height and rotate.
- **Dimension labels** (length, depth, height) that can be edited in place.
- **Undo transactions** (§4.5). **Drag preview and the deferred memo** (§4.6).
- Keyboard: Tab cycles objects, handle sliders, R, Ctrl+D, + and −, F frames the selection.

**Files:**
- new: src/pro/selection.ts, src/pro/handles.ts, src/pro/hud.tsx (+ CSS in pro.css)
- src/pro/edit.ts: refactor `down`/`move`, export `snapSet`, add `stretchedEnd` and `deepened`
- src/pro/scene.ts: `onFrame`, `preview`
- src/pro/main.tsx: the selection state, `begin`/`commit`, mounting the HUD, splitting the memo

**Risks:**
- Drag-preview divergence: the preview transform has to match what `evaluate` then lays out. A formed building's layout can change as it moves, e.g. against the margins.
- Bar jitter and placement against `.results`.
- Clashes with the global keys.
- Handles hidden behind other buildings in 3D.

**Remove from the side panel:**
- In the picked-building card (sitePanels.tsx:235-247): Floors, Depth, Length, Turns (both places), duplicate and remove, Name, "Shape it".
- The card keeps: departures (Notes), own mix, design system (until Phase 4), Systems, Flat plans.

**Status (2026-11-21): built, in src/pro/hud.tsx.**
- Done:
  - the selection bar: name, floors stepper, turns, Shape it, duplicate, remove, Inspect, deselect;
  - handles for height, both ends, side, turn and move, each a focusable slider with arrow keys;
  - editable length, depth and height labels;
  - undo transactions (a drag, a key or a button is one step; Escape cancels a drag);
  - the memo keyed by identity, with rooms, rules and money deferred while a drag is open;
  - R, + and −, Ctrl+D and Esc;
  - the panel card trimmed.
- Done differently: there is no per-building preview transform. In shaded or X-ray view a drag moves an outline ghost, the handles and the labels, and the scheme is worked out on release. Measured: a plain shaded frame already stalls 250–330 ms on the high tier in the app's pane, so a drag now costs no more than orbiting. Wireframe updates live, every 120 ms.
- Not done yet:
  - selection.ts and handles.ts as separate modules (the logic lives in hud.tsx);
  - Tab cycling objects; F framing the selection;
  - fading occluded handles;
  - the limit plane while dragging height;
  - labelled "Undo: …" tooltips.

### Phase 2: Tools on the view; elements and features edited in place

**Deliverables:**
- **The tool shelf** on the stage's left edge:
  - Select; Building ▸ (the Gallery moved into a flyout, with thumbnails); Grounds ▸; Site ▸; Plot; Measure.
  - Add the missing element tools: roundabout, gate (snapping to the plot edge), wall, tank (site.ts:147-151 vs edit.ts:44-51).
- **The VCB:**
  - typed length, angle or offset while drawing ("30,20" for a rectangle, a segment's length, the angle after a comma);
  - typed distance while moving; "x n" arrays after a Ctrl-drag copy.
- **Snap guides say what they snapped to** (`why`).
- **Vertex and midpoint handles** for element rings, road nodes, and feature lines and areas. Radius and clearance rings for point features. A width handle for internal roads; a levels height-handle for the parking tower.
- **Selection bars** for elements (width chip, levels) and features (radius, clearance, note).
- **Measure tool:** point to point, and point to the nearest margin line.

**Files:**
- new: src/pro/shelf.tsx, src/pro/vcb.tsx
- src/pro/gallery.tsx: reused in the flyout
- src/pro/edit.ts: tools, `finish` for the new kinds, typed-value hooks
- src/pro/handles.ts: element and feature factories
- src/doc/site.ts: confirm the gate, wall, tank and roundabout geometry that `elementRings` expects

**Risks:**
- Typing in the VCB versus global shortcuts. Once a number has been typed, the VCB has to own the keys until Enter or Esc.
- Touch drawing without hover (the loupe).
- New element kinds that the site engine (`d.site`) doesn't lay out well yet.

**Remove from the side panel:**
- Scheme › Add a building (sitePanels.tsx:299-301), Scheme › Add to the grounds (302-304), the picked element card (258-264).
- Site › On the site: the tools, the list and the picked card (160-176).
- The Buildings list (306-317) becomes a compact "Objects" list in the sheet. It's useful for screen readers and as an outline view.

**Status (2026-11-22): built, in src/pro/shelf.tsx, src/pro/objHud.tsx and src/pro/edit.ts.**
- Done:
  - the tool shelf (Select, Building ▸, Grounds ▸, Site ▸, Plot, Measure);
  - roundabout, gate (on the nearest plot edge), wall and tank as tools;
  - the measurements box: a typed length toward the pointer, "length, angle" from the road, "width, depth" for a rectangle;
  - the readout by the pointer: the length being drawn and what it snapped to (corner, on the edge, along or square to the road, n° to the road, in line with a corner, the grid);
  - the measure tool (point to point, and to the margin);
  - vertex and midpoint handles for areas, roads, walls and line or area features, with Delete on a focused point;
  - a gate's ends; radius and clearance ring handles for point features;
  - selection bars: road width chips, parking levels, roundabout or tank size, gate width, a feature's radius, clearance and note;
  - features picked on any step;
  - the panel's add sections, element card and feature tools and card removed (the feature list stays).
- Not done yet:
  - typed distance while moving;
  - "x n" arrays after a Ctrl-drag copy;
  - a width handle on a road and a levels height handle (chips and a stepper instead);
  - the touch loupe.

### Phase 3: The plot in view

**Deliverables:**
- **The plot is selectable in any step:** corners, midpoint insert, remove a corner, edge lengths editable in place. A `rect` plot gets frontage and depth edge handles.
- **Road chips on each edge,** with the today/DP popover and the carriageway readout. "+ road" on edges without one. A warning chip when there's no road at all (the logic at sitePanels.tsx:139).
- **The compass as a north dial.** The slope arrow handle.
- **The plot bar:** area, Find by survey no., Import (both in the sheet), Read the terrain, Redraw, Authority (a select showing the code name).
- **Empty start:** a "Draw your plot" call to action in the view, with Size (two numbers in a popover) as the alternative to drawing.

**Files:**
- src/pro/handles.ts: plot factory
- src/pro/hud.tsx: edge chips, compass dial (moved from main.tsx:387)
- src/pro/sitePanels.tsx: `setEdge`, `edgeFacing` and `readGround` moved into a shared src/pro/plotOps.ts
- src/pro/edit.ts: the corner drag becomes a handle

**Risks:**
- Selecting the plot versus orbiting on empty ground. Selecting it needs a click on its boundary or a deliberate click inside it, never a drag.
- A rect plot turning into a poly on the first edit. The existing behaviour is fine, but it should be visible to the user.
- North set from `p.at` being overridden by accident.

**Remove from the side panel:**
- Site › Plot (Size/Draw/Survey/Import segment, sitePanels.tsx:114-122): Survey and Import become sheet entries opened from the plot bar.
- Site › Roads (124-140).
- North and levels from "Levels and north" (142-157). The terrain notes go to the plot bar's popover.
- What's left in the Site sheet: Rules, Allowed, Constraints.

### Phase 4: Forms, uses, mix and X-ray in view

**Deliverables:**
- **3D key-floor rings** with scale dots, a lean diamond and a twist arc at the top. Alt-click on the side adds a key; double-click a ring to remove it.
- **The uses stack strip** beside the building: drag band boundaries, click to change a band's use, add and remove bands.
- **The mix bar popover** with draggable dividers (per building and project-wide).
- **Roof and skin pickers** as bar popovers. Slot carve as a bar action, with its from/to as handles on the facade.
- **The X-ray floor scrubber,** following the selected building. Clicking a band in the stack strip jumps X-ray to it.

**Files:**
- src/pro/handles.ts: form factories, with the maths shared with src/pro/silhouette.tsx (`keysOf`, `keyAt`, `withKeys` and the side/mid drag logic at silhouette.tsx:170-189 extracted into src/pro/form/keys.ts)
- new: src/pro/stackStrip.tsx
- src/pro/shapePanel.tsx: shrinks to the precise fallback
- src/pro/main.tsx: the scrubber replaces main.tsx:397-401

**Risks:**
- 3D handles at height are hard to grab at oblique angles. Fall back to the elevation editor in the sheet.
- Formed layouts re-laying on every key drag, which is costly. Use the preview path: draw the ring outline as an overlay and commit on release.
- The 3D handles and the SVG editors must stay in agreement. Extracting the shared module above keeps one source of truth.

**Remove from the side panel:**
- ShapePanel's floors, presets, sliders, uses, roof and skin (shapePanel.tsx:202-218).
- Own mix (sitePanels.tsx:248-249), design system (250).
- What the inspector sheet keeps for a building: "By hand" (SilhouetteEditor and PlanEditor, as the precise and accessible fallback), Systems, Flat plans.

### Phase 5: The panel becomes a sheet over the view

**Deliverables:**
- **The fixed `aside.panel` grid area goes** (main.tsx:363-381; pro.css:66-73). A step in the rail opens a **sheet**: a desktop drawer over the stage, or a phone bottom sheet with detents.
- **The sheets:** Money, Approval, Explore, Design (start from, facade, spec, review, builder link), Site rules (rules, allowed, constraints, survey/import), Fill settings (living, parking, shops, basements, flat mix), Objects (an outline list), Export.
- **Inspect** opens the building sheet (Systems, Flat plans, By hand).
- **Result-bar KPIs and Approval rows open sheets and select objects** ("Show" on a failing check selects and frames its building, through `departures` ids).
- **Applying an option** from Explore animates the change in the view and toasts with Undo.
- **Comment pins in the view** (team.ts comments get an optional world point). Pick the pin tool, click, write.
- **Clean-up:** an a11y audit (F6 regions, live-region wording, focus return when a sheet closes), the keyboard map dialog updated (main.tsx:633-636), and a touch pass on a real phone.

**Files:**
- src/pro/main.tsx: layout, the sheet, the rail behaviour
- new: src/pro/sheet.tsx
- src/pro/pro.css
- src/pro/steps.tsx: `STEPS` gets the sheet titles
- src/pro/sitePanels.tsx: split into sheet bodies
- src/pro/team.ts: the comment anchor

**Risks:**
- Users who are used to the panel will be disoriented. Keep `/` as "pin the sheet open", so desktop users can dock it beside the view.
- The sheet covering the selection: the camera pans so the selection stays visible beside the sheet.
- Phone keyboard and sheet height interplay.

**Remove from the side panel:** the panel itself as a permanent column. Every remaining section lives in a sheet.

---

**Opinionated summary:**
- Phase 1 alone (the selection bar, height/side/end/rotate handles, undo transactions and the drag preview) removes most panel trips for the people who use Pro.
- **Do the performance work (§4.6) in Phase 1, not later.** Direct manipulation that lags is worse than a form.
- Put typed numbers everywhere a handle exists (labels and the VCB), so precision never needs the panel.
- Keep every long, many-field form in a sheet over the view, not on the canvas.

### Critical Files for Implementation
- src/pro/edit.ts
- src/pro/scene.ts
- src/pro/main.tsx
- src/pro/sitePanels.tsx
- src/pro/shapePanel.tsx (with src/pro/silhouette.tsx for the shared key-floor maths)
