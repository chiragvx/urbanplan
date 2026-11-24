# Plan: any form, any use, any interior

Written on 2026-11-23. Research and a plan only: no code has changed. Line numbers are from the working tree on 2026-11-23 (another session was editing `src/pro/` at the time, so they may drift). The sourced findings behind this plan are in [research/design-freedom-notes.md](research/design-freedom-notes.md), cited below as **N1** to **N6**.

**The ask, from the product owner:** a designer makes any form first, including forms cut and joined with booleans, and assigns it a use afterwards. The use can be anything: an airport terminal, a small shop with ample parking, flats. Interiors (bathrooms, closets and the rest) are designed freely too. The presets stay, but behind a button. "Realistically we enable them to do anything, literally anything."

**The recommendation, in one line.** Split a building into four layers that today are fused: **form** (a solid, made of parts that add, cut and intersect), **floors** (slices of that solid at levels the designer sets), **spaces** (areas drawn on the floors, or generated, each with a use) and **uses** (a data table that says what each use needs: people, parking, exits, money, rules). The numbers and the checks read the spaces, never the form. Flats, BHK mixes and stilt parking become one use and its generators, behind "Start from…", not the shape of the model.

---

## 1. What Pro does today, and where it blocks freedom

### 1.1 How a building is made

There are two kinds of building:

- **A plain building** (`SiteBuilding`, src/doc/site.ts:56): a centre line ("spine") and a depth. The engine fills it with flats both sides of a corridor, cores at fire-travel spacing, stilt parking under it. This is the "Fill the plot" building, and it is housing by construction: its `floors` field is documented as "floors of flats" (site.ts:62).
- **A formed building** (`Form`, src/pro/form/types.ts:111): a plan curve at the ground, key floors that scale, shift and twist the plan up the height, **carves** (a plan ring cut out of every floor between two heights, types.ts:40), an optional shell, one of eight roofs, and **use bands** from the ground up (types.ts:72-97). `lay()` (src/pro/form/lay.ts:45) turns it into floors, each with its outline, a core, columns and units. The 3D, the wireframe, the money and the checks all read those floors, which is a good foundation: a twisted tower is counted honestly.

### 1.2 Where it blocks freedom

| Block | What it means for a designer | Where |
|---|---|---|
| **One plan per building, extruded up.** A form is one outline swept up the height. There is no "add another volume" | A podium with a tower on it, a bridge between two blocks, an airport's long low hall with a pier off it: each has to be faked as several buildings or can't be made | `Form.plan`, types.ts:111; templates fake groups with `many()` (templates.ts) |
| **Booleans are subtract-only and vertical.** A carve is a plan ring cut straight down through a range of floors | No union, no intersect; no sloped cut, no curved cut in section, no cut by another solid | `Carve`, types.ts:40; `diff` in lay.ts:84 |
| **Floors drive the form, not the other way round.** The solid exists only as a stack of floors, each a fixed height from its use | A double-height lobby, a hangar-like hall with no floors, a mezzanine, a ramp: none can be drawn | `floorsOf`, src/pro/form/slice.ts; `UseBand.floorH` |
| **Use is a band of whole floors.** Uses stack from the ground up, a whole floor each | "Shop at the front, parking behind, on the same floor" can't be said. Mixed use on a plain building is a special case with its own code (src/pro/mixed.ts) that trims flats and adds basements | `UseBand`, types.ts:73; mixed.ts |
| **The list of uses is closed and kept in three places by hand.** 10 building uses, 10 floor uses, 12 plot uses, mapped by a hand-kept table | Adding "airport terminal" means editing three enums and four tables, and every `switch` that reads them | `BuildingUse` types.ts:72, `FloorUse` site.ts:79, `PlotUse` plot.ts:21, `FLOOR_USE` site.ts:103, `KIND_OF_PLOT` site.ts:122, `PARK_PER` site.ts:746, `DENSITY` skeleton.ts:17 |
| **Units are flats or "something else".** A unit's type is 0, 1 or 2 (1, 2, 3 BHK) or 3 ("Office" for everything not a home) | A shop, a hotel room cluster, a classroom and a gate lounge are all "type 3". The inventory, the area statement and parking only know flats | `UnitType` site.ts:13, `UNIT_LABEL` site.ts:14, `targets()` units.ts:23, `inventory()` floor.ts:35 |
| **The flat mix and sizes are in the form's context.** Every formed building is laid out with a BHK mix even if it holds no homes | A form's layout depends on a housing setting | `FormContext.mix/sizes`, types.ts:184; `layMemo` key lay.ts:269 |
| **Cores are sized by a fixed people-per-m² per use.** | An airport (huge floor, few lifts, many stairs) or a hospital (bed lifts) gets an office-shaped core | `coreNeed` skeleton.ts:34, `DENSITY` skeleton.ts:17 |
| **Parking is per flat, per 100 m², with stilts on by default.** | A shop with ample surface parking, a school's bus bays, a terminal's kerb and drop-off: none is a first-class rule | `parkUnit` site.ts:589, `DEFAULT_SITE.stilt` site.ts:395 |
| **Interiors exist only for flats, by one template.** Rooms are fitted into each flat of the typical floor: a daylit band, a wet band, a foyer | No drawing your own rooms; nine room kinds; no fixtures (WC, basin, shower, wardrobe); no rooms in a non-residential building | `RoomKind` src/pro/rooms.ts:16, `ROOM_MIN` rooms.ts:35 |
| **Checks are written for housing.** A "Flats & rooms" group; stair widths from the residential table; lifts by height | A school's or assembly hall's exit widths, a hospital's bed lifts, an airport's occupant load: not checked, and not marked "not checked" | `CheckGroup` src/pro/scrutiny.ts:12, `stairFor` scrutiny.ts:30 |
| **Money is sale per sq ft of carpet.** Other uses ride along (offices leased at a yield, a hotel's operating profit, public buildings cost only) | Fine as a start; but a terminal's or a school's numbers are costs and capacities, not sales | `Costs`, `UseRates` site.ts:17-36 |

### 1.3 The framing: Pro assumes housing for sale

Before any of the model changes, Pro *talks* as if every project were flats for sale. Housing first is a fair default for developers. But many users design for themselves or for a client (a house, a shop, an office, a clinic), and for them almost every screen says the wrong thing:

| Where | What it assumes |
|---|---|
| The scorecard (src/pro/main.tsx, `ResultBar`) | a "Homes" figure, then Profit, Land worth and IRR. Only a scheme of public buildings swaps these for Cost and Build per m² |
| The project panel (src/pro/sitePanels.tsx) | Flat mix, Flat sizes and Shops at the front (priced against the flats) for every project; Layout's parking choice reads "the ground floor as parking, flats above" |
| The building's inspector | the flat mix on every building that has homes, which by default is every building |
| A new project (`EmptyState`, src/pro/start.tsx) and `DEFAULT_PROJECT` (src/pro/project.ts) | never asks what it's for. The project is always `use: 'residential'`, hard-coded in `plotReport` and `generate` (project.ts), so the FSI, margins, parking and fill are housing's |
| Money (site.ts `Costs`) | flats sold per sq ft of carpet, with the land bought to sell them |
| The dashboard (src/dash/summary.ts, src/dash/main.tsx) | a card's facts and the totals count "Homes"; the money shown is profit |
| The landing page (src/site/Landing.tsx) | mostly neutral already; "its own flat mix" and "cores, flats" in two lines |
| The checklist (src/pro/start.tsx `taskList`) | neutral. It never asks what the project is for |

**Who it should serve as well:** someone designing their own house, shop, office or clinic, an architect designing for a client, and developers of offices, shops or mixed schemes, not only those selling flats. For a project that isn't sold:
- profit and IRR mean nothing;
- the land is often already owned;
- the questions are what it will cost, whether it fits the rules, and whether it holds what the client needs.

What already helps: the use bands, `FLOOR_USE`'s per-use parking, earnings and cost factors, `useInfo`'s "No use yet" (plot.ts:80, the last row), the surface lot and parking building as site elements (site.ts:133), and the per-floor `LaidFloor.kind`. The engine already counts a formed building floor by floor, each floor by its own use. The plan builds on that rather than replacing it.

---

## 2. The target model: form → floors → spaces → use → numbers and rules

```
 FORM            FLOORS               SPACES                 USE (a row in a table)       NUMBERS AND RULES
 parts that      levels the           areas on a floor,      what it needs: people per    area by use, people,
 add, cut,   →   designer sets;   →   drawn or generated, →  m², parking rule, exits,  →  parking, exits, lifts,
 intersect       each floor is the    each with a use        fire class, floor height,    money, checks that
 (a solid)       solid sliced there   (or "none yet")        money, room kinds, checks    pick spaces by use
```

This is the order the established tools use (N2):
- Revit makes **mass floors** by slicing a mass at levels, and puts **rooms** and **spaces** (with their own use and occupancy) on the floors.
- IFC models a space (`IfcSpace`) separately from the building's elements, and groups spaces into zones (`IfcZone`).
- Forma sets a **function** on a floor or a building, and it can be changed later.
- Hypar drives spaces from a **programme** table.
- OmniClass Table 13 and Uniclass's SL table classify spaces by function, independent of the form.

**Inheritance keeps it simple.** A use can be set on the building, on a range of floors, or on a space. A space with no use of its own takes its floor's, and a floor takes its building's. So the easy case stays one click: draw a box and set "Homes" on it, and every floor's spaces are homes. The hard case is possible: one floor can hold shops at the front, a parking area behind and a bin store in the corner.

**The project says what it's for, at the start.** Two questions, both changeable later in the project panel:
- **What it is:** homes, homes over shops, offices, shops, a school, a clinic or hospital, something else, or not decided yet. This is the project's default use, which its buildings and spaces inherit.
- **Who it's for:**
  - **to sell**, as today;
  - **for a client**;
  - **for my own use**.

Everything shown follows these answers, not a mode:
- **Figures follow the use.** The scorecard shows a "Homes" figure only when there are homes. Otherwise it shows the project's units (offices, shops), or the buildings and floors.
- **Housing controls follow the homes.** The flat mix, flat sizes and shops priced against the flats appear only when the project has homes.
- **Money follows who it's for.** To sell: profit, land worth, IRR. For a client or your own use: what it costs, and the cost per m² (the land kept apart, since it's usually owned already). Rent and a yield come with the money-by-use step (step 6).
- **The rules follow the use.** The FSI, margins, parking and fill are worked out for the chosen use. The engine already takes a plot use (`solveSite(r, site, use)`); Pro has only ever passed `'residential'`.
- **The dashboard and the landing page say the same.** A card says what the project is ("Clinic · for a client") and shows cost rather than profit when nothing is sold.

An old project, with neither answer, is homes to sell, so nothing changes for it.

**"No use yet" is a real state.** A mass with no use is counted for its built-up area, its height, its margins and its shadow, and for nothing else. The numbers that need a use say "set a use to see this", not zero. `useInfo('none')` already does this for plots (plot.ts:93); the plan extends it to buildings and spaces.

---

## 3. Form: parts, booleans and editing

### 3.1 What the research says (N1)

- **Two ways to edit, and the good tools offer both.**
  - *Non-destructive (history):* Blender's modifier stack, Rhino's history, Grasshopper's graph, Onshape and SolidWorks's feature trees. Each step stays editable, and the result is rebuilt on change.
  - *Direct:* SketchUp's Push/Pull, Plasticity, Fusion's direct mode. You grab a face and move it.

  Designers like direct editing for speed. Developers of a scheme need history so "make the podium 2 m taller" still works after the tower was cut.
- **Booleans are three operations everywhere:** union, subtract, intersect (SketchUp's Solid Tools, Rhino, Blender's Boolean modifier, Spline). Blender keeps the cutter object as a live, hidden part; "Apply" bakes it.
- **In a browser, robust 3D booleans are now practical:** manifold-3d (WebAssembly) is fast and always gives a closed solid. three-bvh-csg is lighter but less robust. OpenCascade.js is a full CAD kernel, but large.

### 3.2 The model

Today's `Form` becomes **one kind of part**, and a building becomes a short, ordered **list of parts**:

| Part | What it is | Today |
|---|---|---|
| **Prism** | a plan curve between two heights, with key floors (taper, twist, lean). Today's whole form | `Form` |
| **Box, cylinder, wedge** | quick primitives with dimensions | none |
| **Sweep** | a section along a path (a curved pier, a canopy) | none |
| **Roof** | today's eight roof kinds, or any part used as a roof | `Roof` |
| **Shell** | a skin standing off the floors | `Shell` |

Each part has an **operation**: *add* (union), *cut* (subtract) or *keep only where it overlaps* (intersect). It can also be switched off, renamed, reordered or locked. Today's carves become *cut* prisms, so old projects load unchanged (`carves[]` maps one to one).

The building's solid is the parts combined in order. Its floors are that solid **sliced at its levels**, which is what `lay()` already consumes as rings (§3.4).

### 3.3 Two stages, so the first ships without a new geometry kernel

1. **Plan booleans (2.5D), on what exists.** Every part is a prism (a plan ring between two heights, with key floors). Per floor, the floor's shape is the union of the *add* prisms that span that floor, minus the *cut* ones, intersected with any *keep* ones. Clipper already does these in plan (`union`, `diff`, `inter` in src/doc/ground.ts, used by lay.ts). This alone gives:
   - a podium and a tower;
   - a bridge (an *add* prism from floor 10 to 12 between two masses);
   - an L-shaped or U-shaped building of different heights;
   - an airport hall with a pier;
   - a cut-out at any floors.

   No new library.
2. **True 3D solids (later).** For sloped cuts, a sphere, a sweep, an imported mesh or a roof that is any solid: combine parts with manifold-3d. It always returns a closed solid, and Blender and OpenSCAD use it (N1). Slice the result at each level to get the floor rings; manifold's API has a plane cut that returns the section, but that is to confirm before this step (N1). three-bvh-csg could give a faster live preview while dragging. The 3D shows the true solid; the floors (and so the numbers) come from the slices. This is Revit's mass-floor idea (N2).

### 3.4 Floors become levels the designer sets

- A building has **levels**: a height for each, set by range ("floors 1–20 at 3.0 m"). The use's floor height is a default, not a rule. Today's `UseBand.floorH` becomes a level setting.
- A level can be marked **"no floor here"**. That gives a double-height lobby, an airport hall's 18 m clear volume, a hangar or an atrium. The space below is then counted once, by its footprint, and its height is kept for the checks (volume, stair runs).
- A **mezzanine** is a floor over part of a space: a space with its own level.
- Ramps and sloped floors wait for stage 2.

### 3.5 Editing: direct first, history kept

- **On the view:** pick a part and drag its faces. Push/Pull in plan moves the ring's edge; dragging the top changes its height (today's handles in hud.tsx do this for a whole building). A part's handles are the same handles.
- **In the inspector:** a **Parts** list, like Blender's modifier stack or a feature tree, with each part's operation, its heights, an eye to switch it off, and drag to reorder.
- **Constraints, lightly.** A part's numbers can be typed, and a part can be **snapped** to another (its top to another's floor, its face flush). A full constraint solver is out of scope: TestFit and Forma do without one (N1).
- **Bake** turns a parts list into one plain prism per floor, for anyone who wants to push faces without history.

### 3.6 Design: the form first, then its floors (the main requirement)

**Said by the user on 2026-11-24:** form design is the most important thing in Pro. The shelf's Building tab is **Design**, and it is for designing the form: basic shapes and CAD tools to make the mass, then tools to make floors out of it. Everything about adding and shaping buildings answers to this.

- **Make the mass** (src/pro/masses.ts). Everything lands as a form to sculpt at once, never a plain slab that needs "Shape it":
  - **shapes**, one click, the long side along the front road: Box, Round, L, U, Courtyard (its court a cut part), Wedge;
  - **footprints drawn**, CAD-like: Rectangle (dragged, or its corners clicked; width and depth can be typed), Polygon (corners clicked), Circle (dragged out over its box: an ellipse when the box is long);
  - **Start from…** the templates, below.
  - A mass starts in the project's use, about as tall as it is wide, then kept to the height limit and the floor area left, as a template is.
- **Sculpt it**, as before: the rings on the view (width, lean, twist), key floors, the plan's points, parts that add, cut or keep.
- **Make its floors** (the inspector's **Floors** section, right after Parts):
  - the form's height and a floor-to-floor height cut it into floors: change the height and the floors follow; change the floor height and the height stays;
  - what each range of floors is for, bottom up, with "Floors on top" and "A ground floor";
  - heights and double-height voids by range, as Levels did.
- **CAD booleans and part operations** (built 2026-11-24):
  - **the four booleans** on every part: Add (union), Cut (subtract), Intersect (keep), Exclude (xor: the overlap out, the rest of it added);
  - **Combine:** a shaped building that overlaps another gets "Combine" on its bar, and a line in the inspector: "Overlaps Building B: Add · Cut · Intersect · Exclude". The other comes into it as a part, from its own frame, with floors set by the boolean (an add or an exclude as tall as the taller, an intersect as low as the lower), and goes; what a part can't carry (a twist, its own parts) is said;
  - **Design into the picked building:** with a shaped building picked, Design's switch (New · Add · Cut · Intersect · Exclude) makes the next shape or footprint one of its parts, where it's clicked or drawn;
  - **Parts' Add:** choose the boolean, then any shape (at the middle, sized to the plan) or a footprint drawn on the view (Rectangle…, Polygon…, Circle…);
  - **each part:** moved (its middle handle on the view, or the arrow keys), turned 15° or 90°, mirrored across the form's middle (left for right, front for back) as a copy, copied;
  - **on the view:** each part outlined at its lowest and highest floor with its corners up, solid where it adds or intersects and dashed where it cuts or excludes, and a chip with its name in the boolean's colour (add green, cut red, intersect violet, exclude amber).
- **Next, to make this a real CAD:**
  - a footprint's corners and edges dimensioned and typed on the view;
  - offsets and fillets on a plan;
  - the mass's height dragged in metres, with the floors re-cut as it goes;
  - floor plates cut from the form shown as you set the floor height;
  - a part picked on the view by clicking it (today: its handles, and the Parts list);
  - parts with key floors of their own (a tapered cut), and booleans of solids that aren't prisms (§3.3's second stage).

---

## 4. Spaces and use

### 4.1 Spaces on floors

- A **space** is a polygon on a floor, or across several floors for a double-height one. It has:
  - a name;
  - a use;
  - an optional department or group (for an airport: "Check-in", "Security", "Airside lounge");
  - an optional count (seats, beds, gates, counters);
  - an optional "generated by" tag.
- **Drawing spaces.** The designer splits a floor with a line, draws a rectangle or polygon, or picks "the rest of the floor". Snapping goes to the floor edge, the core and other spaces.
- **Generated spaces.** Today's unit planner (`planUnits`, units.ts:234) becomes one **generator**: "Fill this space with flats (mix, sizes)". Others: "shops along the front, 4.5 m each", "offices of 100–150 m²", "hotel rooms off a corridor". Generated spaces carry their generator's tag. Edit one by hand and it becomes yours, as a filled layout does once you edit a building (laying it out again is then a choice, in the project panel's Layout section).
- **The core and circulation are spaces too,** of uses "core" and "circulation". A designer can move them, and the checks still find them.
- **Units become spaces.** A flat is a space of use "Home", with BHK as an attribute. A shop is a space of use "Shop". `UnitType` 0–3 goes, and `UNIT_LABEL`'s "Office" stops standing for everything else.

### 4.2 The use table: data, not code

One table, `src/doc/uses.ts`, replaces `BuildingUse`, `FloorUse`, `FLOOR_USE`, `KIND_OF_PLOT`, `PARK_PER`, `USE_INFO` and `DENSITY`. Each row:

| Field | Example (Shop) | Example (Airport terminal) |
|---|---|---|
| label, icon, colour | Shop | Airport terminal |
| NBC 2016 occupancy group (N5) | F (mercantile) | D (assembly), with E and F parts |
| plot-use class (for what the DP zone allows) | commercial | public / transport |
| people: m² per person (NBC occupant load) | from NBC Part 4's table (secondary sources disagree on mercantile: read the BIS text, N5) | by the space's sub-use; see §6 |
| floor height, default | 4.5 m | 6–18 m, by area |
| parking rule | a car per so many m² of carpet, from the code's table (N5) | by peak-hour passengers; see §6 |
| how it earns | sale or lease | operated, valued on cost |
| build cost factor | 1.0 | about 2.5 (placeholder) |
| room kinds and their minimum sizes | shop floor, store, toilet | check-in hall, security, gate lounge, baggage hall, toilets |
| checks that apply | exits, travel, parking, fire | exits, travel, fire, accessibility |

- **Sub-uses** let a big building be honest without a long top-level list. "Airport terminal" has children (check-in hall, security, gate lounge, baggage reclaim, retail, offices, plant), each with its own people and parking factors.
- **Your own uses.** A designer can copy any use, rename it and change its numbers. It's saved with the project or the firm's library, like a design system (src/pro/designLibrary.ts). This is how "literally anything" is met without us modelling every building type. A custom use whose numbers came from no code is marked "your own figures", the way `generic` uses are marked today (plot.ts:79).
- **The engine stays pure.** The table lives in `src/doc/`, so the simple version and Pro read the same thing (the memory note on Pro's platform direction: everything goes through the shared engine).

### 4.3 Edit this floor: units by hand

Spaces steer a floor (its use, its fill), but the designer can't yet say "this wall goes here". A floor seen in X-ray can be **taken by hand**:
- **It starts as it was laid out.** "Edit this floor" copies the floor's units, in the building's own frame, onto the run of floors that share them (`Form.floorPlans`, src/pro/form/types.ts `FloorPlanEdit`). Until something is changed, the figures are the same.
- **The edits** (src/pro/floorEdit.ts, pure): a corner dragged, snapping to other corners and a 10 cm grid, takes every unit that shares it along (a party wall moves for both flats); a wall pushed out or in; a unit split across its length; two that touch merged; one taken away; its use and type set, or left to the floor's use and its size.
- **The engine keeps it honest** (src/pro/form/lay.ts): each unit is cut to the floor as it stands now and kept clear of the cores; where two overlap, the first keeps the overlap, so no area counts twice. A unit's use counts it for money, parking and people like a space's.
- **Its floors:** the whole run, "only this floor", or "and the floors above"; the floors around a plan keep their own units. "Lay out again" gives the floors back to the planner.
- **Still to do:** drawing a new unit, cores and corridors moved by hand (with step 5's cores as spaces), rooms in units (§5), and checks on a hand-drawn unit's shape (a flat with no outside wall, a sliver).

---

## 5. Interiors: rooms, fixtures, generators

### 5.1 What the research says (N4)

Every serious tool separates three things:
- **the room**, an area bounded by walls, with a name and a type (Revit's rooms, Archicad's zones);
- **the things in it**, objects from a catalogue, each with its own clearance (Revit families, SketchUp components, Planner 5D's catalogue);
- **the generator**, which proposes rooms and furniture and then hands the result over to be edited (Finch3D, Maket, Hypar's layout functions).

Planner 5D, Floorplanner and RoomSketcher show that free drawing works for non-specialists when walls snap, rooms close themselves, and the area updates live.

### 5.2 The model

- **Rooms are spaces inside a space:** the same polygon type, one level down. A flat (a space of use "Home") holds rooms (living, bedroom, toilet, closet). An airport's toilet block holds cubicles.
- **Walls come from room edges.** Drawing a room draws its walls, and two rooms sharing an edge share a wall. The partitions list that `rooms.ts` already makes (`FlatRooms.walls`) is the same idea.
- **Fixtures are catalogue objects:** WC, basin, shower, bath, urinal, kitchen counter, sink, hob, wardrobe, walk-in rack, bed, desk, check-in counter, and so on. Each has:
  - a footprint and a **clearance zone** (the space in front of it that must stay free);
  - which wall it wants;
  - whether it needs a drain or a duct.

  Fixtures snap to walls. Two clearance zones may overlap (as in a real bathroom), but a fixture may not sit in another's clearance.
- **Room kinds come from the use table,** so "toilet" for a home and "toilet block" for a terminal can differ. `RoomKind`'s closed list (rooms.ts:16) goes.
- **Generators, behind a button on the room or the space:**
  - "Lay out this flat": today's fitter in rooms.ts, unchanged.
  - "Fit a bathroom": WC, basin and shower by the room's shape and the wet wall.
  - "Fit a closet": rods and shelves along the longest wall, a walk-in if it is wide enough (about 1.2 m is a common rule of thumb, not sourced: N4).
  - "Fit a kitchen": straight, L or parallel by the room's width.
  - "Toilet block for N people": cubicles and basins by the use's fixture count (NBC Part 9 gives counts per occupancy; still to be read, N4).

  The output is ordinary rooms and fixtures, which the designer can edit.
- **Checks on interiors** read the use table:
  - a room's minimum area and width (rooms.ts already has UDCPR's and DCPR's, `ROOM_MIN_UDCPR`, rooms.ts:149);
  - clearances clear;
  - a wet room on a wet wall or a duct;
  - a habitable room with a window (openings.ts already checks light and air).
- **Scope.** Interiors are drawn on a **typical floor** and repeated, as today, with "make this floor different" for the exceptions. That keeps a 40-floor tower's model small.

---

## 6. Non-residential uses and parking

Each needs the same five things from the use table: **area**, **people**, **parking**, **cores and exits**, and **services**. Figures here are planning rules of thumb, with sources and caveats in N3 and N5. They are starting values for the use table, not checks to pass.

| Use | Area driver | People (for exits and lifts) | Parking | Cores and exits | Services |
|---|---|---|---|---|---|
| **Airport terminal** | peak-hour passengers × m² each at the chosen level of service (IATA ADRM; its figures are paywalled, so ours start as editable placeholders). The planner works from peak-hour passengers, not floor area | per space: check-in queue, security, gate lounge (seated and standing), baggage reclaim | per peak-hour passengers, plus kerb length for drop-off, taxis and buses; usually a multi-level car park | many stairs, few lifts, travelators; NBC group D (assembly) exit widths | baggage handling, very large plant, high floor heights |
| **Shop with ample parking** | sales floor + store + toilet | NBC mercantile load (N5) | UDCPR's mercantile ratio, 2 cars and 6 scooters per 100 m² of carpet in a non-congested area (secondary source, N5), **on the surface** (a lot: about 29–31 m² per car with aisles, N3) | one stair for a small shop; exits by load | loading bay for a big store |
| **Offices** | net lettable area ÷ efficiency (typically 76–88 %, N3) | about 10 m² per person (NBC business, N5) | UDCPR: 3 cars and 11 scooters per 200 m² of carpet for offices and IT (secondary source, N5); Pro uses 1 per 100 m² today | lifts by population and waiting time; two stairs above 15 m | AC plant, about 5–8 % of the area |
| **School** | classrooms (CBSE: at least 8 × 6 m, 1 m² a student, N3) + halls, labs, play | classrooms 2 m² a person (NBC, N5), halls denser | low for cars; bus and drop-off bays | wide stairs (NBC educational) | toilets per student |
| **Hospital** | beds × m² per bed, saying which basis: about 232 m² a bed for the whole building, 46–61 m² for a ward department alone (N3) | patients, staff, visitors | per 10 beds plus an ambulance bay (UDCPR, from a blog summary only, N5) | bed lifts; horizontal evacuation; NBC group C (institutional) | medical gases, very high services share |

**Parking becomes a rule per use, on the site.** Today's parking (site.ts:584-606) works out cars needed from flats and m², then places them on stilts, podiums and basements by default. The plan:
- **Need** is the sum of each space's use rule: per m², per unit, per seat, per bed, per passenger. Car, two-wheeler, bus, truck and drop-off kerb are separate counts.
- **Supply** is wherever the designer puts bays:
  - a surface lot (it exists: `ElementKind 'lot'`);
  - a parking building (it exists: `'parking'`);
  - stilts, a podium or basements.

  Stilts stop being on by default for non-residential projects (`DEFAULT_SITE.stilt`, site.ts:395).
- "Ample parking" is a target. The designer sets "at least 1.5× what the code asks", and the scorecard shows parking need, supply and the target.

---

## 7. How the numbers and rules generalise

### 7.1 Numbers come from spaces, grouped by use

- **The area statement** is a table of spaces by use and by floor: built-up, carpet, and FSI-counted or not. Whether a use counts in FSI comes from its row: parking and services usually don't.
- **People** is the sum over spaces of area ÷ the use's m² per person, or a count where one is given (seats, beds).
- **Cores:**
  - lifts come from people and height, as today (`coreNeed`, skeleton.ts:34), but with each use's own factors;
  - stairs come from exit width (people × width per person, by occupancy group) and travel distance.
  
  The designer can place cores by hand, and the check says whether they're enough.
- **Money** by how each use earns:
  - **sale:** carpet × rate;
  - **lease:** carpet × rent ÷ yield;
  - **operated:** income ÷ yield;
  - **public:** cost only.

  `FLOOR_USE.earns` already has these four (site.ts:103); they move to the use table and apply per space. The flat inventory (`inventory`, floor.ts:35) becomes "inventory by use" (flats by BHK is the Home use's own breakdown).
- **The scorecard follows the project's uses.** A housing scheme keeps "Homes". A terminal shows peak-hour passengers served. A shop shows parking against target. The figure is chosen by the main use, not by a mode (pro-ia-rethink.md §2.8 dropped modes for good reason).

### 7.2 Checks pick what they apply to

Every check becomes a row with four parts, which is how generic code checkers work (Solibri's rule templates, Singapore's CORENET X model checker; N5):
1. **applies to:** a selector by occupancy group, use, space kind, building height or plot use (for example "group D spaces", "buildings over 15 m", "rooms of kind toilet");
2. **measures:** an area, a width, a count, a distance or a ratio;
3. **limit:** a number, a table lookup or a formula;
4. **clause:** the code and section, with "as assumed" where we haven't read the text.

Today's scrutiny (scrutiny.ts) is a sequence of `add({...})` calls with conditions written in code. Most of them map straight onto rows; the rest (FSI, margins, the ladder) stay as code, since they are about the plot, not about uses.

**Three statuses matter more than before:** pass, fail and **not checked for this use**. A terminal checked only against housing rules would look falsely clean. A check whose use has no figures says "not checked: no figures for Airport terminal in UDCPR", and the Approval report lists those first.

### 7.3 What the code allows on the plot

The DP zone allows some uses and not others. Each use row carries its plot-use class. The plot's zone says which classes are allowed (today `PlotUse` is chosen by the user: plot.ts:21). A space whose use the zone doesn't allow gets a fail, never a block. "Flag, never block" is already the form code's rule (types.ts:17).

---

## 8. Presets behind a button

What is a preset today, and where it goes:

| Preset | Today | After |
|---|---|---|
| Template gallery (19 forms: towers, villa, row houses, library, toilet, hall…) | src/pro/form/templates.ts, gallery.tsx | "Start from…" on the Building tool; each template becomes parts, spaces and uses, all editable |
| Shape presets (straight, taper, twist, steps, wave, lean) | shapePanel.tsx `SHAPES` | in the Parts list's "Add" menu, as ways to set a prism's key floors |
| Fill the plot (slabs, towers, the most built-up) | optimise.ts; the project panel's Layout section, whose two buttons lay it out again (Generate and its toolbar button were removed on 2026-11-23) | stays in Layout, described as "a housing layout", and shown for projects with homes. Other uses get their own generators over time ("lay out a surface lot", "shops along the road") |
| Flat mix and sizes | project and building settings | the Home use's generator settings: shown on a space of homes, not on every building |
| Stilts, podium, basements | site defaults | "Parking" generators; on by default only for housing projects |
| Room fitter | rooms.ts | "Lay out this flat" on a space of homes |

**The main path is: draw, then shape, then say what it's for.**
- The Building tool places a plain mass with the project's default use. For a housing project that is "Homes", so nothing changes for today's users. For a new project with no use, it is "No use yet".
- **"Start from…"** sits next to it and opens the gallery.
- Blender's Add menu, Figma's templates and SketchUp's 3D Warehouse all work like this: the blank canvas is the default, and the library is one click away (N6).

**Progressive disclosure, not hiding.** A preset's result must be fully editable and say where it came from ("from the Sky garden template"), and "make it mine" is never a trap: editing it keeps it, and laying it out again is always a choice you make, never a silent overwrite.

---

## 9. Shippable steps

Ordered so each step is useful alone, and the risky ones come after the cheap ones have proved the model. Framing (F) comes first: it is mostly copy and what's shown, it is cheap, and it changes who the product is for before any of the model changes. Sizes: **S** is days, **M** is one to two weeks, **L** is more.

| # | Step | Size | What ships | Main risk |
|---|---|---|---|---|
| F | **Framing: the project says what it's for** | S | `ProProject.use` and `ProProject.purpose`. The empty state asks both; the project panel changes them. The scorecard, the project panel, the dashboard's summary and cards, and the landing copy follow them (§1.3, §2). The project's use reaches the plot report and the fill | Changing the use changes the FSI, margins and fill for that project, which is correct but visible. Old projects default to homes to sell |
| 1 | **One use table** | S–M | `src/doc/uses.ts` replaces the seven hand-kept lists (§4.2). No UI change; the numbers are identical for today's uses. Add an NBC group and an occupant load to each row. Then, as a separate change, correct the parking ratios from UDCPR's official Table 8-B: the office ratio already looks low (N5) | A silent change in figures. Mitigate by snapshotting `evaluate()` on the sample projects before and after |
| 2 | **"No use yet" and use set last** | S | A new building can have no use. The use picker is on the building, and on a range of floors (today's bands). Numbers that need a use say so | Housing-first users see more choices. Default the use from the project, so they don't |
| 3 | **Parts: plan booleans** | M | A building's form becomes a list of prisms with add, cut and keep; carves migrate to cut parts; the Parts list in the inspector; drag a part's faces on the view | `lay()` runs on every edit: unions per floor cost more. Reuse its "same as the floor below" shortcut (lay.ts:64) and memo per part |
| 4 | **Levels you set, and voids** | S–M | Floor heights by range, independent of use; "no floor here" for double-height spaces | Rules measure height to the top floor or to the roof's middle (site.ts `Laid.roof`). Keep that, and test it with tall voids |
| 5 | **Spaces on floors** | M–L | Draw, split and name spaces on a floor; assign uses per space; the unit planner becomes "fill with flats / shops / offices"; mixed use on one floor; mixed.ts's strip becomes a generator | The biggest change to the engine's data: units become spaces. Do it behind the Laid floor type (`LaidFloor.units`), so site.ts reads spaces as units first |
| 6 | **Numbers and parking by use** | M | Area statement by use; people; parking need by each use's rule, with a target; stilts not default outside housing; money per space by how it earns | Figures for non-residential uses are thin in UDCPR. Every placeholder must say so (N5) |
| 7 | **Checks as rows** | M | Scrutiny rewritten as selector, measure, limit and clause rows; NBC occupancy groups; exit width and travel by group; "not checked for this use" status | Re-reading the codes for every use is slow. Start with groups A, B, D, E and F, and mark the rest not checked |
| 8 | **"Start from…" and presets as parts** | S | The gallery behind one button; templates produce parts and spaces; shape presets in Parts' Add menu | Templates that set `houses` (row houses) need a generator of their own |
| 9 | **Interiors: rooms and fixtures** | L | Draw rooms inside spaces; a fixture catalogue with clearances; generators for flat, bathroom, closet and kitchen; checks on sizes and clearances; on a typical floor, repeated | UI weight. Interiors open in plan view on one floor (a focused "edit this floor" state), never as more panels on the main view |
| 10 | **Use packs** | M each | Airport terminal (peak-hour sizing, sub-uses, kerb), retail with surface parking, offices, school, hospital: each a use, its sub-uses, a generator or two and its brief figures | Credibility. Each pack's figures need an expert read before it's offered to clients |
| 11 | **True 3D solids** | L | manifold-3d: primitives, sloped and curved cuts, sweeps, imported meshes; floors by slicing | Bundle size (WebAssembly), performance on phones (mobile is view-only per docs/plans/mobile-view-only.md, which helps), and robustness of slicing thin parts |
| 12 | **Programme (brief) vs design** | M | A target area per use or department (an airport's brief, a hospital's schedule), with designed against target in the Numbers report There is no brief in the product now (Generate's written brief was removed on 2026-11-23), so this one is designed fresh. Keep it a table of areas, not a second generator |

**Status:**
- **Step F, framing (2026-11-23): built.** The project's use and who it's for are asked at the start and set in the project panel. The scorecard, panels, dashboard and landing copy follow them. Rent is left to step 6. See docs/plans/pro-global-ux-log.md.
- **Step 1, one use table (2026-11-23): built.** src/doc/uses.ts; the `evaluate()` snapshot on nine sample projects is byte-identical. The parking ratio fix from the official Table 8-B is still to do.
- **Step 2, no use yet and the use set last (2026-11-23): built.** "No use yet" is a use; a plain building has its own use; Shape it keeps the use. Per-space use waits for step 5.
- **Step 3, parts with plan booleans (2026-11-23): built.** Add, cut and keep prisms, in order, on the floors they span; old carves are cut parts, unchanged. The Parts list is in the inspector and on the bar, and parts' edges can be dragged on the view. The `evaluate()` snapshot is byte-identical. Heights are still a share of the floors until step 4.
- **Step 4, levels and voids (2026-11-23): built.** Floor heights by range whatever the use; "no floor" voids that keep their height and walls but have no slab or area; parts keep to their floors (`lo`, `hi`). The `evaluate()` snapshot is byte-identical.
- **Step 5, spaces on floors (2026-11-23): first part built.** Spaces with their own use, floors and fill (laid out or one unit); units carry their use, and parking and money count them by it; the Spaces section and edge handles. Still to do: drawing and splitting polygons in plan, the core and corridors as spaces, units as spaces, mixed.ts's strip as a generator.
- **Step 6, numbers and parking by use (2026-11-23): built, but for the scorecard.** Build cost and people by each space's use; a parking target as a % of the code's, with the bays wanted, basements sized for it and a check; the area statement's By use block. The scorecard picking its figure by the main use is still to do.
- **Draw and curves (2026-11-23, asked for between steps 6 and 7): built.** The shelf's Grounds is now Draw. Lines and areas take vector-app curves (src/doc/curves.ts: nodes and handles kept, the line or ring the curve sampled, so the engine is unchanged), and a road ends at a road side where it's run out across one, with a join across the widening flared into the road outside. What's next uses the same model: step 5's drawn and split spaces, and parts' outlines, should keep `nodes` and `bez` and sample them, so a curved space or part costs nothing new below the editor.
- **Step 7, checks as rows (2026-11-23): built.** src/pro/checkRows.ts: rows with what they apply to (NBC group, use, height), what they measure, the limit and the clause, run over each building's uses: fire tender access, travel to a stair, stair width for a floor's people, the narrowest stair, lifts, refuge floors, light and ventilation, room sizes, and the uses the DP zone allows (src/doc/zones.ts; the zone is set in the project panel). Exits by group (src/doc/egress.ts, groups A, B, D, E, F) also size the stairs; a use in another group, or no use yet, is "not checked", listed first in Approval and on the PDF's cover. Still left: NBC's tables and UDCPR Chapter 4 read clause by clause in place of the summaries, and travel measured along corridors rather than in a straight line.
- **Edit this floor (2026-11-24, asked for after step 7): first part built.** §4.3: an X-rayed floor's units taken by hand, moved by corner and wall, split, merged, removed, their use and type set, on a run of floors or one; cut to the floor and clear of the cores, overlaps counted once. The `evaluate()` snapshot is byte-identical. Still to do: new units drawn, cores and corridors by hand, rooms.
- **Step 8, "Start from…" (2026-11-24): built, but for the shape presets.**
  - The Building flyout leads with a plain building (slab, tower, L, U, courtyard, drawn) in the project's use; "Start from…" opens the 19 templates (open or shut, kept for the browser session).
  - A tower or sculpted template takes the project's use (offices on an office project, none on one with no use yet); homes and public templates keep their own.
  - Template parts are named (Podium, Sky garden, Glass slot, Court). Office on shops' podium is now a part added on floors 1–2 under a plain tower plate, rather than key floors.
  - The inspector says which template a building came from.
  - The `evaluate()` snapshot moves on one sample only, the one built from Office on shops: its tower plate is 0.1% smaller per floor, as it's now drawn rather than scaled. Saved projects keep their stored forms.
  - **Not done, on purpose:** the shape presets stay in the Shape section rather than Parts' Add menu. They set the whole form's key floors, and a part has no key floors of its own; they move when parts get them.
  - Still to do: row houses (`houses`) as a generator; templates that lay down spaces as well as bands.
- **Design, first part (2026-11-24, §3.6, the user's main requirement):** the shelf's Building is Design. Its shapes and its footprint tools (rectangle, polygon, circle) land as forms in the project's use, and the inspector's Floors section makes the floors from the form: height, floor-to-floor height, what each range is for, heights and voids. The `evaluate()` snapshot is unchanged. Next: §3.6's list.
- **CAD booleans (2026-11-24, §3.6):** Add, Cut, Intersect and Exclude on every part; Combine for buildings that overlap; Design into the picked building; parts from any shape or drawn footprint; parts moved, turned, mirrored and copied; parts outlined on the view in their boolean's colour. The `evaluate()` snapshot is unchanged.

**The first three steps (1–3) deliver most of what was asked in form:** any shape that can be described as joined and cut prisms, and a use given afterwards. Steps 5–7 make the use honest. Step 9 is interiors. Steps 10–12 extend reach.

## 10. Risks across the plan

- **Saved projects.** `Form` is saved in projects and design versions (localStorage, and Supabase later: see the memory note on design systems). Each step needs a loader that upgrades old forms (`carves` to cut parts, `uses` to level-range uses, units to spaces) and a version number on the form.
- **The simple version shares the engine.** site.ts is used by the free editor. Uses, spaces and parking must go through the same code, not around it (the memory note on Pro's platform direction).
- **Less on screen.** The IA rethink just removed panels. Parts, spaces and interiors must live in the inspector and in a focused plan view of one floor, not in new panels. The default path (draw a box, set Homes) must stay two clicks.
- **Honesty of checks.** More uses with thin rules means more "not checked". That is better than a false pass, but it has to be visible, in the Approval report and on the scorecard's Rules figure.
- **Performance.** Booleans per floor, spaces per floor and interiors on many floors. Keep the "same as the floor below" sharing, interiors on a typical floor, and the memo (lay.ts:263).
- **Scope.** "Literally anything" is met by **your own uses, your own parts and your own fixtures**, not by us modelling every building type. The packs in step 10 are a few good examples, not a promise of all of them.
