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

The first cut of the platform, in `src/pro/`:
- **`project.ts`:** a plot as a rectangle (front road today and in the DP, an optional corner road) or a drawn outline with a road, or none, on any edge, under UDCPR or DCPR. It runs on the editor's own engine (`analysePlot`, `optimise`, `solveSite`), so Pro and Site Studio give the same numbers. Concave plots (an L, a T) get their margins from a true inset (`inset` in `src/doc/plot.ts`); convex plots are worked out exactly as before.
- **`PlotEditor.tsx`:** the outline drawn in plan.
  - Drag a corner in half-metre steps, or add one with the + on any edge; select a corner to delete it.
  - Type an edge's exact length, and put a road on any edge (width today and in the DP).
  - Or paste the corners as x, y in metres.
- **`cloud.ts`:** signed in, the project saves to the account a few seconds after each change, with versions, through the editor's own project storage. Pro projects sit in the same table, marked `region` `pro:<city>`, so no database change was needed. The Projects menu opens, starts and deletes them, and `/pro/?p=<id>` links straight to one.
- **`mixed.ts`:** shops along the front road under the flats: the ground floor, G + 1 or G + 2, at a depth set from the front. The ground-floor shops count in the FSI, so floors of flats come off the top; above the ground, flats in the strip become shops. The shops' parking is added, and basements too if needed. Shops sell at their own rate, 1.8× the flats' until a price is put in, in the same cash flow. The road-width tiers for shop floors are flagged, never enforced, and still need checking against UDCPR's mixed-use clauses: 9 m allows the ground floor, 18 m two floors, 24 m three, 30 m all.
- **`design.ts`:** the design system. Five presets (Pune Contemporary, Mumbai Glass Tower, Warm Earth, Value Housing, Signature Luxury), with every token editable. The spec adds to construction cost; each preset's price premium sets the sale price until one is typed in.
- **`openings.ts`:** windows and doors placed from the catalog on each flat's outside walls (living, bedrooms, kitchen, toilet ventilators), entrance doors on the corridor. Produces the door and window schedule and a light and ventilation check per flat.
- **`scene.ts`:** three.js 3D with instanced windows, doors, balconies, bands and fins in the design system's materials. An X-ray floor shows a level as a plan cut at 1.5 m (flats by type, walls, entrance doors). Pointing at a window or door shows its tag and size.

Not yet:
- picking a plot from data (survey or CTS number, Bhunaksha)
- rooms inside flats
- more mixed use: offices over shops, a podium of shops, a separate commercial block
- drawings and exports

## Open questions
- What exactly to charge for, and when.
- Can AutoDCR take an outside DXF/DWG?
- Which architect firms will lend real submissions to validate against?
- Pune and Mumbai only, or all of Maharashtra under UDCPR from the start? The rules engine already covers the rest of the state; only the DP data is Pune's.
