# The plan

UrbanPlan becomes two products under one brand:

- **The simple editor** (`/app/`) stays free. It covers one plot, the rules checked automatically, a scheme, and a shareable link.
- **UrbanPlan Pro** (`/pro/`) is the full platform: plot to scheme to approval drawings to a pre-check, and later an agent.

The free public pages (DP report, FSI calculator, FSI map, guides, place pages) bring people to both. Pro will go behind a paywall in some form later; for now it is free in beta.

Pitch: **the feasibility becomes the submission.** One building model runs from picking a plot, to the most it can build, to the money, to the drawings an architect submits for approval.

## Who it's for

- **Small and mid developers, and their architects**, in Pune and Mumbai first. Today a plot takes days of Excel, AutoCAD and an architect's sketch.
- **Architects at approval time.** Plans must go to AutoDCR (Mumbai, run by SoftTech) or BPMS (the rest of Maharashtra) as PreDCR-format DWGs. Many rejections are drawing-format mistakes.
- **Brokers and land aggregators.** They work on WhatsApp and portals and have no buildability tools. A shareable "this plot can take X sq ft, worth ₹Y" page fits how they work.
- **Mumbai housing societies redeveloping.** Consultants write feasibility reports by hand, and no tool exists for the redevelopment schemes (33(7)(B), 33(9), 33(11)).

## The field (November 2026)

| | Plot from data | Indian rules | Generated layouts | Approval output | Notes |
|---|---|---|---|---|---|
| TestFit | Some | No | Best (with parking) | No | $10k+/year; the reference for the editor |
| Archistar | Yes | No | Hundreds of options | eCheck (Australia) | The reference for the plot-check funnel |
| Snaptrude | No | Partial (byelaw feasibility) | Yes | No | Indian-founded; general design tool, real-time collaboration |
| 1acre.in | Survey numbers, 300 layers | FSI calculators | No | No | **The closest threat**: data plus distribution, no layouts |
| LandLens Build Scope | Yes (Tamil Nadu) | TNCDBR | No | No | Pay per credit |
| SoftTech (AutoDCR, RuleBuddy) | No | Scrutiny | No | **Owns submission** | Inside AutoCAD, at submission time only |

Nobody combines Indian plot data, the rules, generated schemes, money and approval output. That gap is the product.

## What we build, in order

### 1. Plot and an instant answer
- **Pick a plot instead of drawing it:** search a survey or CTS number, or click the Bhunaksha plot boundaries (see the cadastre harvest plan).
- **Open on the most the plot can build:** a scheme and the profit in seconds, not an empty plot.
- **Rules you can trust in a meeting:**
  - DCPR's real margins and height rules (the margins are UDCPR placeholders today), and Mumbai's island-city line instead of a cut at latitude 19.045.
  - Height limits from fire and airport clearance (AAI colour-coded zoning maps), ground coverage checks, transit zones near metro stations (FSI up to 4).
  - The amenity space and 20% affordable-housing rules on big plots, and non-residential parking.
  - DP zone and reservations set the allowed use and flags automatically.
- **The Indian deal model:** joint development (landowner's share of revenue or area), redevelopment (rehab vs sale area and corpus), GST, stamp duty, and TDR at market rates.

### 2. Building model v2: data, made by code
- **The building is data:** building, then floors, then cores, units, rooms, walls, doors and windows, each with a semantic type (stair, lift, balcony, parking bay…).
- **Generators are code:** typology functions turn any footprint plus the rules into the model, e.g. "Pune 2BHK double-loaded slab" or "Mumbai rehab tower". A firm's house style can live in code.
- **One shared set of edits:** the mouse, the scripting API (`src/doc/api.ts`, `src/doc/ops.ts`) and later the agent make the same edits, so they can't disagree.
- **Flat templates:** the 1, 2 and 3 BHK plans developers reuse, fitted and stretched into the plate. Rooms are checked against the room-level rules: room sizes, light and ventilation (openings at least 1/10 of floor area), stair and corridor widths, travel distance, lifts and a fire lift, refuge floors.

### 3. The design system (started: see below)
A project-level choice of the builder's look and make, which every building follows:
- **Facade:** materials and colours, floor bands, fins.
- **Glazing:** glass and frames.
- **Window and door catalog:** the D / W / V schedule (D1 entrance, D2 room, D3 toilet, SD balcony; W1, W2, V1).
- **Balconies:** cantilever, recessed, French or none, with depth and railing.
- **Floor to floor height.**
- **The specification sold:** flooring, kitchen, bathrooms, doors, window system, facade finish, lifts, amenities, each with a cost.

Control runs in layers, broadest first: project style, building, floor, flat type, a single window. Overrides are explicit and survive the generator re-running. One record drives the 3D, plans and elevations, the schedule, the rules checks, and the cost.

### 4. Approval suite (Maharashtra first)
1. **Project setup:** permission type, then the documents, forms and NOCs it needs (fire over 15 m, AAI height clearance, environment over 20,000 m², trees…).
2. **Drawings:** location plan, site plan, floor plans, parking floors, terrace plan, sections, elevations and area tables, with title blocks and scales, as a PDF set.
3. **PreDCR export:**
   - Closed LWPOLYLINEs on PreDCR's named layers (`_Plot`, `_PropWork`, parking, reservations…), each with a name label inside it.
   - Buildings and their proposed-work outline share a name, plus a direction marker.
   - All of it written from the semantic model, which architects do by hand today.
4. **Our own scrutiny report:** every rule as pass or fail, required vs proposed, with its clause, plus a structural check of the file itself ("PreDCR lint").
5. **Forms and fees:** the Appendix forms filled in, and scrutiny fee, premium and development charges estimated.
6. **The architect signs and submits.** We never submit on anyone's behalf.

Before building this:
- Confirm from the official PreDCR manual (maha.autodcr.com) whether AutoDCR accepts a DWG/DXF written outside SoftTech's PreDCR add-on.
- Settle DXF vs DWG.
- Validate against 5–10 real sanctioned submissions and their scrutiny reports.
- Our "pass" is advisory: the pitch is catching rejections early.

### 5. More options, more plots, sharing
- **Many options ranked by profit.**
- **Plotted layouts:** dividing converted farmland into plots, with internal roads, 10% open space and amenity plots.
- **Many-plot screening:** paste 20 survey numbers, get a table of maximum built-up area and profit.
- **A share page** for brokers and landowners that works in WhatsApp.
- **Sun and shadow studies.**
- **Teams and comments.**

### 6. Agent
An agent that drives the API and the generators ("3 schemes, most 2BHKs, under 70 m, with a podium"). It checks its own work with our scrutiny report and keeps going until the scheme passes. It runs sandboxed (a web worker that can only call the API).

## What we build, what we connect to, what we skip

| | Build | Connect to | Skip |
|---|---|---|---|
| What the authority checks (FSI, margins, rooms, fire exits, parking) | ✓ | | |
| Approval drawings, area statements, forms | ✓ | | |
| Money: cost, revenue, IRR, a rough bill of quantities | ✓ | | |
| Sun and shadow, daylight, ventilation, fire egress | ✓ | | |
| Structural design | Column grid and sanity checks | ETABS / STAAD export | Full analysis (a structural engineer signs it) |
| Plumbing, electrical, HVAC | Shafts and space allowances | Revit / IFC export | Detailed design |
| Construction drawings, full BIM | | Revit / IFC export | ✓ |

The rule of thumb: we own whatever the authority checks and whatever the developer decides on. Anything a licensed specialist signs, we feed rather than replace.

## Paywall shape (not decided)
- **Free:** pick a plot, the maximum built-up area, one scheme, a view-only report.
- **Pro:** saved projects, every scheme, the money, PDF and PreDCR DXF exports, the design system.
- **Firm:** many-plot screening, branded reports, teams.
- **Approval pack:** per project or per firm.

## Where Pro is now (`/pro/`, beta)

Every phase has a first cut in `src/pro/`; each one gets deeper from here. All of it runs on one evaluation of the project (`evaluate.ts`), which uses the editor's own engine (`analysePlot`, `optimise`, `solveSite`), so the panels, the options, the brief, the screening and the API can't disagree with each other or with Site Studio.

**The workspace** (`main.tsx`, `steps.tsx`, `ui.tsx`, `pro.css`):
- Six steps on a rail: Site, Scheme, Design, Money, Approval, Explore. Each step has one panel; the less-used parts fold away.
- A result bar over the 3D, always in view: built-up against what's allowed, homes, profit, IRR and the rules. After each change it flashes how much the change moved each figure.
- Numbers update as they're typed, with − / + steppers and arrow keys.
- Undo and redo; keyboard shortcuts (`?` lists them).
- View tools: exterior or an X-ray floor; camera for the whole site, the street or from above; a sun study for any month and hour.
- A first-visit card that starts from three numbers.
- A share link that carries the whole project and opens read-only.
- Projects in the account, shared with a team by email (editors save, viewers read), with comments tagged by step (`team.ts`, `supabase/migrations/0004_project_team.sql`).
- On a phone, the 3D stays at the top and the steps sit in a bar along the bottom.

**1. Plot and an instant answer**
- `PlotEditor.tsx`: a rectangle, or an outline drawn corner by corner with a road on any edge.
- `importPlot.ts`: GeoJSON or KML, or pasted latitude / longitude or metres (UTM). Only the outline is read.
- Find a plot by its survey or CTS number (district, taluka, village, number): `api/plot.js` asks MahaBhunakasha for the outline and passes back nothing about the owners.
- DCPR 2034 read from the regulation: front set-backs (Table 18: 3 m in the island city, 4.5 m elsewhere), side and rear margins (Reg. 41(2) Table A: H/5, H/4 on plots over 1,000 m², at most 12 / 16 / 20 m), the height limit (Reg. 43: three times the road plus the front space), room sizes (Table 14) and light (Reg. 40: windows 1/6 of the habitable floor).
- `project.ts`: the site's own limits (a height cap from airport, fire or heritage rules; a transit zone's FSI), on top of UDCPR or DCPR. Concave plots get a true inset.
- `deal.ts`: the Indian deal model. Outright purchase, a JDA on revenue share or area share (with a refundable deposit), or a society's redevelopment (rehab carpet, corpus, rent). GST and stamp duty included. Everything runs in one monthly cash flow, so the IRR and the peak cash are real.

**2. Building model v2**
- `rooms.ts`: flat templates fitted into every flat (living room, bedrooms, kitchen, toilets, foyer), each room checked against the minimum sizes. They show in the X-ray and as plans in Design.
- `model.ts`: the building as data, from building to floors to flats to rooms and openings. Exported as JSON, or as IFC4 spaces for Revit and other BIM tools.
- The scripting API, `window.urbanplan`: `get`, `set`, `evaluate`, `scrutiny`, `options`, `brief`, `deal`.

**3. Design system**
- `design.ts`: five presets with every token editable. Each building can take its own preset (the layer under the project's).
- `openings.ts`: windows and doors from the catalog, the schedule, and the light and ventilation check.
- `scene.ts`: the 3D, in each building's own materials.
- `mixed.ts`: shops along the front road.

**4. Approval suite**
- `scrutiny.ts`: our own scrutiny, pass / fail / to check, each with its clause. It covers FSI, height, margins, fire tender access, lifts, refuge areas, stairs, parking, open and amenity space, inclusive housing, light and ventilation, room sizes, shop floors and environment clearance.
- `approvals.ts`: the permission applied for (a new building, a redevelopment, revised plans, additions) and its stages (IOD or building permission, CC, plinth checking, OC), the NOCs the scheme needs, the documents to file, and rough fees and charges.
- `drawings.tsx`: the drawing set as A3 sheets (site plan, typical floor, elevation, area statement), printed to PDF.
- `dxf.ts`: a PreDCR-style DXF (R12, closed polylines on named layers).

**5. More options, more plots, sharing**
- `options.ts`: options ranked by profit.
- `screen.ts`: many plots screened from a pasted table, with a CSV out.
- `layout.ts`: plotted layouts (internal roads, open and amenity space).
- `share.ts`: share links.
- `sun.ts`: sun and shadow.

**6. Agent**
- `brief.ts`: a written brief turned into constraints. It searches the generator, checks each scheme against the rules and keeps the best that passes, showing its steps. It is rule-based for now; a language model can drive the same functions through the API.

**Read from the regulations:** UDCPR 2020 room sizes (9.2–9.4: rooms and kitchens are the owner's choice; bath 1.0 × 1.2 m, WC 0.9 × 0.9 m, bath and WC 1.5 m²), light (9.20.1: 1/10 of the habitable floor), lifts (9.27.1), fire lift from 15 m (9.29.8), refuge areas (9.29.6), stair widths (Table 9G) and the scrutiny fee (2.2.12); DCPR 2034 as above.

**Checked:** the DXF opens in ezdxf (R12, no audit errors, every polyline closed); the IFC passes IfcOpenShell's IFC4 schema validation and its spaces build as geometry; the team and comment rules were run against the migrations on Postgres (29 cases: who sees, saves, comments, resolves, and who can't).

**Still to do, or to do properly:**
- run `0004_project_team.sql` on the live Supabase project (teams and comments show "not switched on" until then); invite emails;
- PreDCR layer names checked against SoftTech's manual, and a real submission tested;
- MCGM's building-proposal fee schedule (the Mumbai Fire Brigade's scrutiny fee is from circular 155, 2018-19 rates; UDCPR's scrutiny fee is read from 2.2.12; development-charge and fire-infrastructure rates are the Government's and stay rough);
- the floor plans: short one-core blocks are now also planned round a lobby (no corridor, full-depth flats open on three sides, at most two a side, none under 4.5 m wide), kept when it comes clearly nearer the asked mix; a 30x40 Pune plot now gets 3 BHKs instead of only 1 BHKs, but the mix is still not matched exactly on small plots.

## Open questions
- What exactly to charge for, and when.
- Can AutoDCR take an outside DXF/DWG?
- Which architect firms will lend real submissions to validate against?
- Pune and Mumbai only, or all of Maharashtra under UDCPR from the start? The rules engine already covers the rest of the state; only the DP data is Pune's.
