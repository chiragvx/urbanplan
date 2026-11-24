# Plan: the plot's ground, and what it makes of basements and foundations

Written on 2026-11-24. **Status: built, all 7 steps, on 2026-11-24** (see docs/plans/pro-global-ux-log.md). Originally a plan only. Line numbers are from the working tree on 2026-11-24.

**The ask, from the product owner:** an empty plot is not "no ground". It has a surface of its own, with a texture that says what it is. The user sets the plot (its size, outline and access), then says what it's made of. For example: sand, with bedrock about 15 m down. That geology layer comes with two more things: the levels across the plot itself, and how deep each kind of earth goes under it. Buildings then make their basements and foundations from what the user says is in the ground. "This would change the game."

**The recommendation, in one line.** Give the plot a **ground**: its surface (levels across it, and what it's covered with) and its **strata** (layers of named earth, each with a thickness, down to bedrock, plus where the water stands). Add one pure engine, **foundation.ts**. For each building it reads the building's load and the ground under it, and decides:
- the foundation (footings, raft or piles, and how deep);
- how many basements the ground lets you dig sensibly;
- how they are dug: the excavation by layer, the shoring, the dewatering.

What it decides lands in the money, the programme, the checks, the 3D view (a cut-away of the ground) and the drawings (a section through the strata). It is a feasibility estimate, and says so. It never stands in for a soil investigation or a structural design.

---

## 1. What Pro has today

| What | Where | What it gives |
|---|---|---|
| **Plot levels** | `Levels` in src/pro/siteObjects.ts:62; set in the Plot inspector, src/pro/inspector.tsx:227 | One figure for the plot's height over the road, and a **plane**: a slope (%) and the way it falls. `levelAt()` gives the height at any point. Read off the city's terrain where the plot has a real place (src/pro/terrain.ts). |
| **The ground in 3D** | src/pro/scene.ts:237 | A flat disc with one earthy texture, the same for every plot, at y = 0. The plot and the buildings sit on it level. A slope is not modelled in 3D. |
| **Basements** | `PlotSite.basements` (src/doc/site.ts:216); `basementsToFit()` (site.ts:824); `park()` (src/doc/optimise.ts:292); `Fill.basements` (src/pro/project.ts:53) | As many basements as the parking needs, up to 4, unless the user sets the count. Every basement costs the same parking rate per sq ft, whatever it's dug through. |
| **Foundations** | none | Not modelled. Their cost hides inside the build rate (₹/sq ft of built-up area, `defaultCosts`, site.ts:250). |
| **Basements in the systems** | src/pro/systems.ts:570-631 | Ventilation, sprinklers and lift stops counted per basement. |
| **Sections** | src/pro/drawings.tsx (~l. 700), src/pro/dxf.ts:307 | A ground line, with basements drawn dashed under it. Nothing below that line. |

So three things are missing:
- What the plot is made of.
- The levels across it, beyond a plane.
- The fact that a basement in sand under the water table is a very different job, and a very different cost, from one in rock.

## 2. The model

### 2.1 Kinds of earth: a small library, in one table

`src/pro/ground/soils.ts`: one row per kind, the same pattern as the materials library. Every figure is a **starting assumption** that the user can override on a layer. Each must be checked against its source before release (§8).

| Kind | Shows as | Presumptive safe bearing (kN/m², order of) | Digs as | Stands vertical when cut? | Notes |
|---|---|---|---|---|---|
| Fill / made ground | rubble-grey | 0 (not founded on) | soil | no | Always gone through. Mumbai's reclaimed land. |
| Black cotton soil | near-black, cracked | 50–100 | soil | no | **Expansive**: found below the active zone (about 3.5 m), or on under-reamed piles. Pune's top layer. |
| Soft clay | blue-grey | 50 | soil | no | Mumbai's marine clay. Settles; piles go through it. |
| Stiff clay | brown | 150–250 | soil | short cuts only | |
| Silt | buff | 100 | soil | no | |
| Loose sand | pale yellow | 100 | soil | no | **May liquefy** when saturated in seismic zone III and up. |
| Dense sand / gravel | ochre | 300–450 | soil | no | |
| Murum (weathered basalt) | red-brown | 250–450 | soft rock, ripped | yes, braced | Pune's middle layer. |
| Soft / weathered rock | grey-brown | 450–900 | breaker | yes | |
| Hard rock (basalt) | dark grey | 1,500–3,000+ | controlled blasting or splitting | yes | The Deccan trap. |

For each kind the table also holds:
- a unit weight;
- a colour and texture for the 3D view and the drawings;
- an excavation rate (₹/m³, by city, as for the build rate);
- whether it is expansive, whether it can liquefy, and how permeable it is (for dewatering).

### 2.2 The ground of a plot

A new field on `ProProject`, beside `levels` (src/pro/project.ts:108):

```ts
interface PlotGround {
  /** what the surface is: the texture of the empty plot (and of what's left open round the buildings) */
  cover: SoilKind | 'grass' | 'paved' | 'scrub';
  /** the layers from the surface down; the last runs to any depth (the bedrock, or "not found") */
  layers: { kind: SoilKind; thick: number; sbc?: number; spt?: number }[];
  /** the groundwater: its depth below the surface at its highest (the monsoon), m; null where none was found */
  water: number | null;
  /** boreholes, when there are several: each a log of its own at a point, the ground between them interpolated */
  holes?: { id: string; at: [number, number]; layers: PlotGround['layers']; water: number | null }[];
  /** spot heights across the plot (x, z, m over the road), when its levels are more than one plane */
  spots?: [number, number, number][];
  /** the seismic zone (IS 1893), from the city; for liquefaction */
  zone?: 'II' | 'III' | 'IV' | 'V';
  /** where it came from: a preset for the area, the user's own figures, or a soil investigation report */
  src: 'preset' | 'user' | 'report';
}
```

`levels` stays as it is: the plane, the plot's height over the road, and the terrain read-off. `spots`, when given, sit on top of it, so a plot with no survey still has a plane.

**Presets, so the user never starts from nothing.** Each city gets a typical profile. The user picks a preset, or says it in their own words through quick fields: "Top: sand. Bedrock at about 15 m. Water at 4 m."

| Preset | Layers (as assumed) | Water |
|---|---|---|
| Pune, typical | black cotton 1.5 m · murum 3 m · weathered basalt 2 m · hard basalt | none found |
| Pune, rock near surface | murum 1 m · hard basalt | none found |
| Mumbai suburbs | fill 2 m · soft marine clay 6 m · weathered rock 3 m · basalt | 2 m |
| Mumbai island city, reclaimed | fill 3 m · soft clay 8 m · sand 3 m · weathered rock · basalt | 1.5 m |
| Sandy | loose sand 3 m · dense sand 12 m · rock | 6 m |
| Clay | stiff clay 10 m · weathered rock | 5 m |

## 3. The engine: src/pro/foundation.ts

A pure function, tested on its own like `lay()` and the checks:

```ts
foundationOf(building: { footprint: MP; floors; height; basements; use; frame }, ground: PlotGround, levels: Levels, city)
  → { kind, depth, piles?: { n, dia, length, socket }, raftT?, basements: BasementPlan, why: string[], flags: Flag[] }
```

### 3.1 The load

A first figure, no structural model:
- **Weight over the footprint:** dead load plus live load per floor, about 12–15 kN/m² for RCC housing and more for offices (an assumption to check). Multiply by the floors above ground, add the basements, and divide by the footprint. That gives a pressure, q.
- **Basement relief:** digging out a basement takes off the weight of the earth removed (its unit weight × its depth). A deep basement partly floats its building. This is real, and it's why basements help on weak ground.
- **Column loads for footings:** the floor area each column carries × the floors × the load.

### 3.2 The foundation, in order of preference (cheapest that works)

1. **Rock within about 1.5 m of the founding level** (the basement floor, or 1.5 m down with no basement): **footings on rock**, dug down to it.
2. **Isolated or combined footings:** when the layer at the founding level bears q with the footings covering under about half the footprint. On expansive soil (black cotton), only once below the active zone. Otherwise go deeper, or to step 4.
3. **A raft:** when footings would cover more than about half the footprint and the layer bears q over the whole of it. The usual answer for a tall building on good soil, or one with a basement (the raft is the basement floor). Thickness from the floors, as a rule of thumb.
4. **Piles:** when no layer within reach bears it. The piles go down through the weak layers to the first one that bears, socketed into rock where rock is within reach (IS 2911). The engine estimates their number from the load and a pile's capacity by its diameter and its layer. Under-reamed piles for low buildings on black cotton.
5. **Piled raft:** a tall building on medium ground (the raft carries part, the piles the rest).

The engine always writes `why`, for example: "Hard basalt is 6.5 m down. The second basement's floor is at 7 m, so the raft sits on rock." Its flags cover:
- **Liquefaction:** loose saturated sand in zone III and up.
- **Uplift:** a basement below the water table, where the building's weight must beat the water's push, or tension piles are needed.
- **Expansive soil.**
- **A deep dig beside a boundary or a neighbour.**

### 3.3 Basements from the ground

This is where it "changes the game": the ground, not just the parking, decides how many basements and what they cost.

- **What each one is dug through:** the volume of each layer between the levels (the footprint plus a working margin), priced at that layer's rate. One basement in murum and the next in hard rock cost very differently. Rock is slow too, so it adds months to the programme.
- **Holding the sides up (shoring):** chosen from the layers along the cut and the water:
  - rock: a vertical cut with rock bolts and shotcrete;
  - stiff dry soil: soldier piles and lagging;
  - sand or clay above the water: contiguous piles;
  - below the water: secant piles;
  - deep and soft, or Mumbai's reclaimed land: a diaphragm wall.
  Each is priced per m² of the cut's face (perimeter × depth in that layer). A cut along a boundary with a neighbour always needs it. A cut set back far enough can be battered (sloped) instead, which is cheaper but takes more of the plot during construction.
- **Water:** a basement floor below the water table means dewatering for the months the dig is open, waterproofing by tanking, and an uplift check. Permeable sand makes dewatering expensive; clay makes it cheap.
- **How many, automatically:** today `basementsToFit()` adds basements until the parking fits. With a ground, each extra basement has a **cost per bay**: its dig, shoring, water and structure, divided by the bays it holds. That cost is compared with the other ways to park, a podium level or stilts (src/doc/optimise.ts `park()`). Then:
  - the engine stops at the depth where the next basement costs more per bay than a podium bay;
  - it stops at a depth the ground rules out (a dig into deep soft clay under high water, beyond what the plot's size can shore);
  - and it says which of these stopped it.
  The user's own count (`Fill.basements`) still overrides, with the cost and the flags shown.
- **The other way round:** with rock near the surface, it can be worth taking the rock out anyway, because a raft on rock needs no piles. The cost per bay shows this, rather than a rule.

### 3.4 What it changes downstream

- **Money:** three new lines in the cost build-up (`solveSite`, src/doc/site.ts:694):
  - Excavation, by layer;
  - Shoring and dewatering;
  - Foundations.

  The build rate loses the share that today stands in for an ordinary foundation (an assumed % to set), so nothing is counted twice. With no ground set, the lines are the old figures and nothing changes. **The sample projects' figures stay the same until a ground is set.**
- **Programme:** excavation months by volume and kind; the start of the superstructure moves.
- **Checks** (src/pro/checkRows.ts, the same row shape):
  - the foundation's bearing;
  - water and uplift;
  - liquefaction;
  - expansive soil;
  - basement depth against the ground;
  - "a soil investigation is needed" (IS 1892: boreholes by the plot's size and the building's height), with the clause and "as assumed".
- **Approvals:** the structural stability certificate (src/pro/approvals.ts:89) and the soil investigation report listed as documents.
- **Systems:** basement ventilation and sprinklers already follow the count, so they follow the new one.

## 4. The plot's surface and levels

1. **The empty plot shows its ground.** Inside the boundary, the 3D ground takes the cover's texture: sand, black cotton (cracked), murum (red), rocky outcrop, scrub or grass. The neutral disc stays outside the boundary. The texture comes from the same material detail maker the facades use (`detailOf`, scene.ts:241), with a soil category.
2. **Levels across the plot.** Spot heights are clicked on the plot in a "Levels" tool, each with a typed height, the way the CAD tools take typed lengths. A contour survey can come later. With no spots, the plane is used.
3. **A terrain mesh for the plot.** The spots and the plane are triangulated into a surface, the plot's ground drawn as that surface, and the boundary and roads sit on it.
4. **Buildings on sloping ground.** For each building:
   - its plinth is set from the highest ground under its footprint, plus the minimum plinth (`PLINTH_MIN`);
   - on the low side, a basement comes partly out of the ground. The engine counts it as a basement where most of its height is below ground and flags the rest, since the rules treat it differently (to confirm per code).
5. **Cut and fill.** The volume to level the plot to the plinths and the roads is priced with the excavation, and shown.

## 5. In the app

- **Plot step, a new "Ground" section** beside Levels in the plot inspector (src/pro/inspector.tsx:227):
  - **What it's covered with:** tiles with a swatch.
  - **What's under it:** a preset for the city, or "My own". The "My own" fields: top layer, bedrock at about N m, water at about N m.
  - **The layers as a borehole log:** a column drawn to scale. Drag a boundary to change a thickness, click a layer to change its kind, add or remove layers, override a bearing figure. A blue line marks the water.
  - **Several boreholes:** added on the plot by clicking. The log edits the one picked.
  - **From a report:** paste a borehole table (depth, description, SPT N). The descriptions are mapped to kinds, and the user confirms them.
- **A "Ground" view in 3D** (beside Shaded, Wireframe and X-ray):
  - the plot lifted out as a block, cut on two faces, with the strata as coloured, textured slabs;
  - the water as a translucent plane;
  - the basements as boxes dug into it, and the piles, raft or footings drawn to depth;
  - the boreholes as thin columns.
  The building above stays shaded. This is the view that sells it.
- **Each building's inspector:** a "Foundation" row with the kind and the depth, the `why` and the flags, and the basements with their cost per bay.
- **Drawings:**
  - the section sheet draws the strata below the ground line, the water, the foundation and the piles;
  - a foundation plan sheet, with the piles or raft outline and the shoring line;
  - the DXF on its own layers (`_Strata`, `_Water`, `_Foundation`).
- **The PDF and the area statement:** a "Ground and foundations" page, with the assumptions, the log, what was chosen and why, the costs and the flags. It says plainly that this is a feasibility estimate, to be confirmed by a soil investigation and a structural engineer.

## 6. Steps, each one shippable

| Step | What | Done when |
|---|---|---|
| **1. The ground** | `PlotGround`, the soils table, the city presets, the Plot step's Ground section (cover, presets, quick fields, the log editor). The empty plot shows its cover's texture. | A user can say "sand, bedrock at 15 m, water at 4 m" and see it. Saved, undoable, in options. Tests: presets and quick fields give the right layers; layers always sum. |
| **2. The engine** | src/pro/foundation.ts: load, the foundation choice, piles, the basement dig by layer, shoring, water, the flags and the `why`. | A test matrix: each preset × 2, 4, 12, 30, 60 floors × 0 to 4 basements gives the expected kind, with no NaN. Hand-checked cases written down (e.g. 12 floors on Pune typical → raft on murum; 30 floors in Mumbai → piles socketed into basalt). |
| **3. Into the numbers** | Basements chosen by cost per bay against podium and stilts; the money lines; the programme; the check rows; the approvals' documents. | With no ground set, every sample project's figures are unchanged. With one set, the figures move as hand-worked. |
| **4. The Ground view** | The 3D cut-away block, the basements and foundations in it, the inspector's Foundation row. | Seen in the app on each preset. Shaded, X-ray and Wireframe are still right. |
| **5. Drawings and report** | The section's strata, the foundation plan, the DXF layers, the PDF page. | Opened in a DXF viewer; the PDF page reads cleanly. |
| **6. Levels across the plot** | Spot heights, the terrain mesh, plinths and basements on a slope, cut and fill. | A sloping plot puts the buildings' plinths right, and the cut and fill matches a hand figure. |
| **7. Boreholes and reports** | Several holes interpolated; pasting a borehole table. | Two holes with rock at different depths give a sloping rock line, and the piles follow it. |

Steps 1–3 deliver the value: basements and foundations made from the ground, and the money that follows. Step 4 makes it visible. Steps 6 and 7 deepen it.

## 7. What it must not do

- **Pretend to design.** Every figure is labelled as assumed. The inspector and the PDF always say "feasibility; confirm with a soil investigation (IS 1892) and a structural engineer".
- **Change a project that has no ground set.** No ground means today's behaviour, figure for figure (as the booleans work kept the samples identical).
- **Hide a choice.** Every automatic decision (the foundation, the number of basements, the shoring) shows its `why`, and the user can override it, the override shown with its consequences.

## 8. To check before release

- **The presumptive bearing values per kind:** against NBC 2016 Part 6 Section 2 and IS 6403 / IS 1904. The figures in §2.1 are orders of magnitude, not quotes.
- **Pile capacities** by diameter and layer (IS 2911), and rock socket lengths.
- **The excavation, shoring, dewatering and pile rates** for Pune and Mumbai (2026). Placeholders until replaced, like the build rates.
- **How UDCPR and DCPR count a basement that is partly out of the ground on a sloping plot**, and the setback a basement must keep from the boundary.
- **The share of today's build rate** that stands for an ordinary foundation, so nothing is counted twice.
- **The typical profiles** per city, preferably from published geotechnical studies for Pune and Mumbai.

A research pass, like the one behind design freedom (docs/plans/research/), would settle these with sources. It can run alongside step 1, which needs none of them.

## 9. Decisions for the product owner

1. **How sure to sound.** Recommended: "feasibility estimate", always labelled.
2. **Whether the engine picks the number of basements automatically from cost per bay** (recommended), or only flags when the user's count is a poor fit.
3. **The order:** steps 1–3 first (the numbers), then the view. Or the Ground view earlier, for demos.
