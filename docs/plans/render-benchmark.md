# Render benchmark against Autodesk: protocol and kit

This is the comparison the render plan calls for: UrbanPlan Pro against Autodesk Forma, the APS (Forge) viewer and Revit's Realistic view, on the same massing, cameras and light. Our side is automated. The Autodesk side needs those products and accounts, which this repository can't run. Someone with access does that part, using the kit below.

## 1. The same massing in every tool

- **Scheme:** the Pro sample scheme. Open `/pro/?new=sample`.
- **Export:**
  - Approval step → model → **IFC**, which `ifcLite` writes in src/pro/model.ts;
  - or the model JSON, for Forma's importer.
- **Import:** into Forma, the APS viewer (upload the IFC to a bucket and translate it to SVF2) and Revit (Insert → Link IFC).
- **Materials:** keep each tool's defaults, then apply the closest equivalents of the design system's finishes: off-white render, charcoal bands, grey base, clear glass. Record which ones were used.

## 2. Cameras and light

Six views, the same everywhere. Positions are relative to the plot's middle (x east, z south, y up, metres); H is the building's height.

| name | camera | target | field of view |
|---|---|---|---|
| fit | (−1.2R, 0.38H + 1.05R, −1.75R), with R = max(plot size, 0.95H) | (0, 0.38H, 0) | 40° |
| street | (−0.35s, 1.7, −0.9s − 12), with s = plot size | (0, min(0.45H, 40), 0) | 40° |
| top | (0, max(2.2s, 1.6H), 0) | (0, 0, 0) | 40° |
| corner | 3/4 close-up of the nearest outside corner, 25 m off, 12 m up | the corner at 0.6H | 40° |
| balcony | 8 m off the main face, at floor 4 | a balcony | 40° |
| entrance | 12 m off the entrance, 1.7 m up | the entrance | 50° |

Three lights for Pune (18.52 N, 73.86 E): **21 Mar 10:00**, **21 Dec 16:00** and **21 Dec 20:30** (night).

## 3. Our side, automated

- `npm run render:shots -- --tier=high` captures fit, street and top in each light into `render-out/shots/high/`, with the frame-time benchmark.
- **Render image → Path-traced image** in Pro's 3D toolbar gives the path-traced stills.
- The reference sets kept for regressions are `tools/render/ref/standard` and `tools/render/ref/high`.

## 4. Scoring

Score each view 1 to 5 on each row, and average the views. Two people score independently; where they differ by more than 1, they discuss.

| row | what to look at |
|---|---|
| Contact shadow and AO | buildings grounded; frames, reveals and chhajjas read as depth |
| Glass by day | sky reflection by Fresnel, a sense of the room behind, not black or mirror-flat |
| Materials at 20 m | brick courses, joints, render grain at the right scale and the token colour |
| Aliasing while moving | rails, fins and mullions without shimmer when orbiting |
| Night | lit rooms varied and plausible, lamps that glow without washing the frame |
| Scale and entourage | trees, people and cars that give scale without clutter |
| Sky and horizon | a sky that matches the sun, aerial perspective, no hard ground edge |
| Colour fidelity | the design system's swatches match the render (ΔE2000 under 6 in Studio light) |
| Frame time | p50 and p95 on the same laptop, standard tier |

## 5. Gates: dropped

The plan's two gates (after the materials phase, at least level with Forma on every row; after the stills phase, ahead of Revit Realistic on glass, night and stills) were **dropped by the user's decision on 2026-11-21**. Running the comparison needs Autodesk products and accounts, which the build environment doesn't have. The render plan's completion doesn't depend on it.

The comparison stays available as an optional check. Whoever runs it records the date, the machine, each tool's version, the scores and links to the images in `docs/plans/render-benchmark-results.md`.

## 6. Status

- **Optional, not run.** No scores exist for the Autodesk tools, and none have been made up.
- **Our side is ready.** The latest references and benchmark were captured on 2026-11-21 on Intel UHD 630, with the scanned textures and CC0 models:

  | Tier | p50 | p95 | Draw calls | Triangles |
  |---|---|---|---|---|
  | Standard | 1.7 ms | 13.7 ms | 90 | 246k |
  | High | 1.4 ms | 20 ms | 90 | 519k |
