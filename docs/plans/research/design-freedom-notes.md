# Research notes: any form, any use, any interior

Gathered on 2026-11-23 for [../pro-design-freedom.md](../pro-design-freedom.md).

**How the sources were read.** Pages marked **[read]** were opened and read in full. The rest were read through a search tool's summary of the page, so their figures are second-hand. Check them against the page before putting a figure into the product. **(unverified)** means no source confirmed it; it is general knowledge or a guess.

These sources could not be opened: the NBC 2016 Part 4 scan (nmcnagpur.gov.in), an NBC Part 4 commentary (nhsrcindia.org) and IATA's level-of-service paper. So **every NBC figure below is from secondary sources.** The official BIS text must be read before any of them becomes a check.

---

## N1. Form editing

### Pushing, pulling and booleans

- **SketchUp Push/Pull** pulls a face out into a volume or pushes it in to cut. You can type an exact distance. https://help.sketchup.com/en/sketchup/pushing-and-pulling-shapes-3d
- **SketchUp Solid Tools** offer Outer Shell, Union, Subtract, Trim, Intersect and Split, and only on solid groups or components. https://help.sketchup.com/en/sketchup/modeling-complex-3d-shapes-solid-tools
  - Union can keep the faces inside; Outer Shell keeps only the outside.
  - The order you select things in decides which one cuts.
  - Subtract is in the paid version only.
- **Rhino** boolean union and difference record history when the inputs are kept (DeleteInput=No, new in Rhino 8). https://docs.mcneel.com/rhino/8/help/en-us/commands/booleanunion.htm
  - Moving or deleting an input can break that link (forum report). https://discourse.mcneel.com/t/rhino-8-wip-boolean-behaviour/160241
- **Grasshopper** is a graph of components joined by wires, which recomputes when an input changes. https://www.rhino3d.com/for/grasshopper/
- **Blender's Boolean modifier** has two solvers. https://docs.blender.org/manual/en/4.5/modeling/modifiers/generate/booleans.html
  - Exact handles a mesh that crosses itself, but is slower.
  - Manifold (formerly Fast) is the fastest, but needs closed ("manifold") meshes.
  - Only closed input is guaranteed to give a proper result.
  - That modifiers form a stack, stay non-destructive until "Apply", and keep the cutter object live is general knowledge: the manual's introduction page didn't load **(unverified)**.
- **Spline** (in the browser) offers Union, Subtract and Intersect; the bottom layer is the base. https://docs.spline.design/designing-in-3-d/boolean-operations
- **Plasticity** is direct modelling on the Parasolid kernel, with no history tree and no dimensioned sketches. https://digitalproduction.com/2023/10/04/plasticity-3d-cad-for-artists/

### Architecture tools

- **Revit masses.** An in-place mass suits a one-off form in one project; a conceptual mass family can be reused. https://help.autodesk.com/cloudhelp/2024/ENU/Revit-ArchDesign/files/GUID-61205D04-381D-4E8D-B971-6ED44126FBDB.htm
- **Revit mass floors** cut a mass at each selected level and give each floor's area, perimeter, outside surface and volume. https://help.autodesk.com/cloudhelp/2020/ENU/Revit-Model/files/GUID-F7FF70CE-9288-45B1-8094-825A1FEA1CF7.htm
- **Revit area plans.** The gross building scheme can't be edited, the rentable one can, and you can make your own. https://help.autodesk.com/cloudhelp/2023/ENU/Revit-Model/files/GUID-194A8E37-06C5-426D-964C-D9148A1FEFE3.htm
- **Autodesk Forma.**
  - You draw volumes, add floors in 3D Sketch, then set a function on each floor. https://www.autodesk.com/learn/ondemand/course/conceptual-design-with-autodesk-forma/unit/2ZO1fPUXog95hCzCvIXJ6w
  - A function can be set on an imported model too. https://forums.autodesk.com/t5/forma-forum/assign-functions-to-an-imported-3d-model/m-p/12308881/highlight/true
- **TestFit.**
  - Generators by building type, each with a configurator. https://support.testfit.io/knowledge/getting-started/building-typologies
  - Surface parking fills the site within the setbacks. https://support.testfit.io/knowledge/parking
- **Archistar** reads the planning rules and generates massing that meets them. It has templates for apartments, mixed use and commercial, and an add-on for Forma.
  - https://www.archistar.ai/blog/archistar-3d-generative-design/
  - https://www.autodesk.com/integrations/partner/archistar
- **Hypar.** A programme list (name, count, lock, type) drives the spaces placed in 3D. https://docs.hypar.io/space-planning

### History or direct editing

- **Onshape.** The feature list is the history: a rollback bar shows earlier states, and features can be reordered. https://cad.onshape.com/help/Content/feature_list.htm
- **Fusion** has both modes. https://help.autodesk.com/cloudhelp/ENU/Fusion-Designs/files/ASM-DESIGN-MODELING-MODES.htm
  - Parametric mode has a timeline; Direct mode has none.
  - Going from Direct to Parametric wraps what's there into one "base feature".
  - Going back to Direct deletes the history.
- So the pattern is a history list, plus a way to bake it into plain geometry and edit that directly. Our "Bake" is Fusion's switch to Direct mode.

### Booleans in the browser

- **manifold-3d [read]** is the strongest choice. https://github.com/elalish/manifold
  - Its output is always a closed solid, and it is "robust to edge cases".
  - It is compiled to WebAssembly, runs on one thread, and is fast.
  - OpenSCAD, Blender, Godot, Babylon.js and IFC.js use it.
  - Input that isn't closed returns an error.
  - Cutting a solid by a plane to get a section (the floor at a level) is in its API as `slice` / `CrossSection` **(from memory of the API: confirm before step 11)**.
- **three-bvh-csg [read]** is good for a live preview, not for the final solid. https://github.com/gkjohnson/three-bvh-csg
  - It claims to be more than 100× faster than other three.js CSG.
  - It calls itself experimental.
  - Its input must be watertight, and its output may not be closed. Its README points to Manifold for robustness.
- **OpenCascade.js [read]** is a full CAD kernel in WebAssembly; custom builds can cut its size. Its site shows a 2023 copyright, so whether it is still kept up is unclear. https://ocjs.org/

**For Pro:**
- A building is a list of parts combined by union, subtract and intersect, with a Bake step.
- The first stage uses the plan booleans we already have (Clipper, in src/doc/ground.ts). manifold-3d comes later, for true 3D.
- Push/Pull with typed numbers covers most needs without a constraint solver.

---

## N2. Use given to floors and spaces, not to the form

- **Revit mass floors carry a "Usage" value.** Autodesk's area analysis is a schedule of mass floors grouped by usage, with each usage's share of the floor area. https://help.autodesk.com/cloudhelp/2017/ENU/Revit-Model/files/GUID-C06A512E-B2DB-4CDC-B10C-758D8409F29D.htm
- **Revit rooms and spaces.** Architects split floors into rooms by use or occupancy; services engineers use spaces, grouped into zones, for loads.
  - https://help.autodesk.com/cloudhelp/2014/ENU/Revit/files/GUID-C58613B6-1792-4273-8F92-0309ABBF2CE8.htm
  - https://help.autodesk.com/cloudhelp/2018/ENU/Revit-Model/files/GUID-B876A6F6-4091-40CA-ADCD-AA5D0EFC5EE3.htm
- **Forma's functions.** A function goes on a floor or a whole building: Residential, Commercial, Unspecified, or your own with a colour. It can be changed later. https://www.autodesk.com/learn/ondemand/curated/forma-quick-start-guide/7ELegXUks0m0iKwNbwtnjr
- **Hypar.** A table of programme requirements (a brief) drives the spaces placed in 3D. https://docs.hypar.io/space-planning/how-to-use-spaces
- **IfcSpace** (the open BIM standard) is an area or volume, bounded by walls or only notionally, that serves a function. https://ifcopenshell.github.io/docs/rst_files/class_ifc4_1_1_ifc_space.html
- **IfcZone** is a group of spaces with no geometry of its own; one space can be in several zones. https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcZone.htm
- **OmniClass Table 13, "Spaces by function",** classifies spaces by what they're for, in a hierarchy. https://www.nibs.org/files/pdfs/nbimsv3/NBIMS-US_V3_2.4.4.3_Omniclass_Table_13_Spaces_by_Function.pdf
- **Uniclass's SL table (spaces and locations)** has groups such as SL_20 commercial, SL_25 educational, SL_35 medical, SL_80 transport and SL_90 general. https://uniclass.thenbs.com/taxon/sl

**For Pro:**
- Floors are slices of the solid.
- A use is a tag on a floor or on a drawn space. Its code is optional and could be Uniclass SL-like, which also helps the IFC export Pro already has.
- Zones and departments are named groups of spaces.
- The numbers and checks read the tags, so one form can be re-tagged from offices to a school.

---

## N3. Non-residential programmes: rules of thumb

These are starting values for the use table, each to be labelled with its source and whether it is gross or net area.

### Airport terminal

- IATA's Airport Development Reference Manual sizes terminals by **level of service**: an "optimum" range for both space per passenger and waiting time. https://www.iata.org/en/services/consulting/airport-pax-security/level-of-service
- The current m² per passenger figures are behind the manual's paywall **(unverified)**.
- An old 1985 IATA figure gives 1.4 m² per person queueing at check-in at level C. It comes from a secondary table and has since been replaced.
- The FAA's AC 150/5360-13 has a section on gross terminal area estimates; its values were not read. https://www.faa.gov/documentLibrary/media/Advisory_Circular/150_5360_13.PDF
- A gross 14–25 m² per peak-hour passenger is often quoted **(unverified)**.

**For Pro:** size a terminal from peak-hour passengers and a level of service, not from floor area, with the factors editable.

### Retail with surface parking

- A surface lot takes about 29–31 m² per car (310–330 sq ft), aisles included. https://www.webpages.uidaho.edu/niatt_labmanual/chapters/parkinglotdesign/theoryandconcepts/ParkingStallLayoutConsiderations.htm
- A 90° aisle is typically 6.7–8.5 m (22–28 ft). https://codelibrary.amlegal.com/codes/stclairsville/latest/stclairsville_oh/0-0-0-12998
- UDCPR's bay sizes are in N5.

### Offices

- Net to gross is about 76–88 %, from mixed sources.
  - https://www.brigadegroup.com/blog/commercial/floor-plate-efficiency-in-office-spaces
  - https://www.usablebuildings.co.uk/UsableBuildings/Unprotected/OfficeSpaceUseAndOccDensity.pdf
- Density was about 10 ± 2 m² per person in the BCO's past figure; one Queensland government standard caps it at 12.
  - https://cibsejournal.com/?p=22450
  - https://www.forgov.qld.gov.au/property-land-and-infrastructure/manage-government-buildings-and-assets/office-accommodation-management-framework/guideline-3-fitout/3.-office-fitout-guidelines-and-benchmarks
- The core's share of the floor and lift sizing: no source found **(unverified)**.

### School (CBSE)

- A classroom is at least 8 × 6 m (about 500 sq ft), and at least 1 m² per student. https://cbse.gov.in/cbsenew/infra.html

### Hospital

The two ways of measuring differ by about four times, so a figure must say which it is:
- **the whole building's gross area:** about 232 m² (2,500 sq ft) per bed, as a traditional rule of thumb. https://healthcaredesignmagazine.com/?p=32421
- **the ward department alone:** about 46–61 m² (500–660 sq ft) per medical or surgical bed, in Illinois's rules. https://ilga.gov/commission/jcar/admincode/077/07701110ZZ9996bR.html

---

## N4. Interiors: free layout with optional generators

- **SketchUp:** furniture and fixtures are components, from a library or 3D Warehouse. https://help.sketchup.com/en/sketchup/inserting-components
- **Archicad zones.** A zone has a category (name, code, colour, stamp), and wall settings decide how a wall affects a zone's area. Areas update with "Update Zones". https://help.graphisoft.com/AC/21/INT/AC21Help/03_1_Elements_Virtual_Building/03_1_Elements_Virtual_Building-120.htm
- **Planner 5D:** draw the room, add doors and windows, drag things in from a catalogue, check in 2D or 3D. Templates are optional. https://planner5d.com/use/room-planner-tool
- **RoomSketcher:** a free editor for drawing and furnishing rooms. https://www.roomsketcher.com/
- Floorplanner was not checked **(unverified)**.
- **Generators.**
  - **Finch3D** generates floor plates from a graph of spaces and their functions. https://architosh.com/2024/09/finch3d-advances-ai-based-floor-plan-generator/
  - **Maket** turns a written brief into an editable plan. https://intercom.help/maket-ai/en/articles/13611392-generating-a-floor-plan
  - **Hypar** used to generate furniture layouts from a space's outline and type (its 1.0 "SpaceType" functions). https://github.com/hypar-io/HyparSpace
- **Indian minimum room sizes** (NBC 2016 Part 3, secondary source; local bye-laws differ, and UDCPR has its own, already in src/pro/rooms.ts). https://www.studiomatrx.org/guides/bathroom-building-regulations-india
  - Bathroom: 1.8 m², at least 1.2 m wide.
  - A separate WC: 1.1 m², at least 0.9 m wide.
  - Kitchen: 5.0 m², at least 1.8 m wide.
  - Habitable room: 9.5 m², at least 2.4 m wide.
- **An accessible WC** (US ADA): about 1.52 × 1.42 m of clear floor (60 × 56 in), the WC's centre 405–455 mm (16–18 in) from the side wall. https://www.access-board.gov/ada/guides/chapter-6-toilet-rooms/ India's own accessibility rules (the Harmonised Guidelines, and NBC Part 3) should be read for the Indian figure **(unverified)**.
- **Not sourced:**
  - a walk-in closet's minimum width (1.2 m is a common rule of thumb) **(unverified)**;
  - fixture counts per occupancy (NBC Part 9, plumbing) **(unverified: to read)**.

**For Pro:** rooms as spaces; fixtures as catalogue objects with clearances, placed freely; "Lay out this bathroom / closet / kitchen / flat" as optional generators whose result is ordinary, editable rooms and fixtures.

---

## N5. Rules across uses in India

### NBC 2016 occupancy groups

- A BIS training document lists the groups as:
  - A residential, B educational, C institutional, D assembly, E business;
  - F mercantile, G industrial, H storage, J hazardous.

  https://www.services.bis.gov.in/php/BIS_2.0/trainings/dashboardnew/uploads/pwd_b_fire_and_life_safety.docx
- A secondary site **[read]** lists A–I instead, with hazardous at H and storage at I, and different subdivisions. https://infralens.in/knowledge/nbc-2016-occupancy-classification
- Subdivisions (such as A-6, D-7, E-5) are **(unverified)**.
- **Read the BIS text before fixing these labels in the product.** Groups A–F agree across sources.

### NBC 2016 Part 4: people, travel and exits

From a secondary source **[read]**: https://infralens.in/knowledge/nbc-2016-travel-distance-exit-width

- **Occupant load, m² per person:**
  - offices 10;
  - homes 12.5;
  - classrooms 2;
  - assembly 0.6 with fixed seats, 0.5 standing.
- **Travel distance:**
  - most groups 22.5 m, or 30 m with sprinklers;
  - business 30 m, or 45 m with sprinklers.
- **Exit capacity per metre of width:** 50 people on stairs, 75 through doors.
- Other sources disagree on mercantile and assembly loads and on table numbers. https://sparrowrms.in/sparrow-rms/portfolio/nbc-2016-vs-nbcs-2026-fire-safety-changes/
- A 2026 edition (NBCS 2026) may change these **(unverified)**.

### UDCPR 2020 parking

Table 8-B, with multipliers in Table 8-C. From a secondary source **[read]**: https://fsiatlas.com/Pages/Knowledge-Base/parking-norms-as-per-udcpr.html

| Use | Per | Cars (non-congested / congested) | Scooters |
|---|---|---|---|
| Mercantile | 100 m² carpet | 2 / 1 | 6 |
| Offices and IT | 200 m² carpet | 3 | 11 |
| Business | 100 m² carpet, plus 20 % for visitors | 2 / 1 | 12 |
| Industrial | 300 m² | 3 / 2 | 9 |
| Hospital (from a blog only) | 10 beds | 3, plus an ambulance / 2 | 10 / 12 |
| Homes | by flat size, plus 5 % for visitors | | |

- **Bay sizes:**
  - car 2.5 × 5 m;
  - compact car 2.3 × 4.5 m;
  - scooter 1 × 2 m;
  - ambulance or bus 3.75 × 7.5 m.
- Assembly and school ratios, and which uses each zone permits, were not found **(unverified)**.
- **The official text to check against:** https://www.mmrda.maharashtra.gov.in/sites/default/files/2023-10/UDCPR_compressed_2.pdf

**What this means for Pro's code today:**
- Pro uses a car per 100 m² for offices (`FLOOR_USE`, src/doc/site.ts:103; `PARK_PER`, site.ts:746).
- The secondary source gives 3 cars per 200 m² for offices and IT, and 2 cars per 100 m² for business in a non-congested area. That is more than Pro asks for.
- Step 1 of the plan should settle this from the official text.

### How code checkers stay generic

- **Solibri.** A rule has a "components to check" filter and a "requirements" table, and a failure becomes an issue with a severity. "Gatekeeper" rules pass a filtered set on to other rules. https://help.solibri.com/hc/en-us/articles/1500004738562-230-Property-Rule-Template-with-Component-Filters
- **CORENET X (Singapore).**
  - IFC-SG builds on IFC4's reference view. https://www1.bca.gov.sg/regulatory-info/building-control/corenet-x/resources/ifc
  - Its model checker checks a rule only when the data it needs is in the model. https://info.corenet.gov.sg/overview/corenet-x-submission-portal/model-checker
- **Archistar eCheck (now "AI PreCheck")** pre-screens permit drawings for zoning in Vancouver, Surrey and Burnaby; the ICC resells it.
  - https://surrey.ca/news-events/news/city-expedite-permitting-through-automated-compliance-tool-echeck
  - https://www.iccsafe.org/about/periodicals-and-newsroom/international-code-council-collaborates-with-archistar-to-modernize-permitting-and-accelerate-housing-development
- UpCodes was not checked **(unverified)**.

**For Pro:** a rule is data with four parts:
1. what it applies to: a use, an occupancy group, a height or a zone;
2. what it measures;
3. the limit;
4. the clause.

When the data a rule needs is missing, it says "not checked" rather than passing (the CORENET X way).

---

## N6. Presets behind a button

- **Forma.**
  - Site Automation (formerly Explore) generates options from building types and settings you choose. https://blogs.autodesk.com/forma/2025/04/24/how-to-use-generative-design-ai-and-3d-modeling-for-improved-site-planning/
  - The Building Layout Explorer, still experimental, makes floor plan options from your massing. https://adsknews.autodesk.com/en/news/building-layout-explorer-in-autodesk-forma/
- **TestFit's** building-type configurators are presets (N1).
- **Figma Community.** Duplicating a file makes an independent copy, and later changes to the original don't reach it. https://help.figma.com/hc/en-us/articles/360038510873
- **Blender's Asset Browser.** You drag an asset into the scene and then edit it like anything else. https://docs.blender.org/manual/en/4.4/editors/asset_browser.html
- **Blender's Add menu** is the general-knowledge example of primitives a click away; its manual page wasn't found **(unverified)**.
- **Nielsen Norman Group on progressive disclosure [read].** https://www.nngroup.com/articles/progressive-disclosure/
  - Show the few most important options first.
  - Put the advanced ones one clear step away.
  - Keep to two levels.

**For Pro:**
- The blank mass is the default.
- "Start from…" and Generate are one click away.
- What a preset makes is ordinary, editable parts, spaces and uses. It remembers where it came from as a label only, with no live link back, like a Figma duplicate.
