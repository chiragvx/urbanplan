# Plan: raising the quality of the UrbanPlan Pro 3D renders

**Target:** shaded views, and exported stills, that look better than Autodesk Forma, the APS (Forge) viewer and Revit's Realistic view, while staying a web app that one developer can build.

**The look:** a credible architectural photograph, slightly idealised. This plan does not go after full photorealism. Web viewers fail first on light, glass, contact shadow and aliasing, so those come first.

**Constraint:** every visual value keeps coming from the design system's tokens (`src/pro/design.ts`) and the material library (`src/pro/materials.ts`).

Drafted on 2026-11-21 by a planning agent, after reading `src/pro/scene.ts`, `src/pro/form/mesh.ts` and the related code. Package versions and some claims are from memory and need checking before use.

---

## 0. Why it looks below standard today

1. **Slab buildings get no image-based light.** The `RoomEnvironment` PMREM only reaches `buildForm` → `matOf(..., env)`. `scene.environment` is never set, so every material from `mats()` in `set()` is lit only by the sun and a `HemisphereLight`. Walls look flat, nothing reflects the sky, and the glass is dead.
2. **Glass is set up as metal.** It uses `metalness` 0.55 (slab buildings) and 0.75 (formed buildings). With no environment to reflect, it reads as dark grey plates. There is no Fresnel and nothing visible behind the glass.
3. **There is no ambient occlusion.** Frames, chhajjas, bands and balconies look like they float, and nothing grounds the buildings.
4. **Windows sit on the wall instead of in it.** Frames and panes are placed 0.07 m in front of the wall, and the reveal surround is built to stand out from the wall. A real facade is the opposite: the glass is recessed and the wall has depth.
5. **The tone mapping and sky are wrong for architecture.** ACES at exposure 1.05 shifts hues and darkens the palette colours users pick as swatches. The sky and fog are a flat `#e4e4e2`, and the dark theme turns them almost black.
6. **Shadows are loosely fitted and badly biased.**
   - The shadow box is only refitted when the plot changes, not when the sun moves.
   - `normalBias` is a fixed 0.04, regardless of how big a shadow texel is.
   - Thin parts (0.1 m chhajjas and frames) get acne or detached shadows.
   - `PCFSoftShadowMap` is deprecated in recent three releases.
7. **Every surface is the same plastic.**
   - All materials are plain colours at roughness 0.85.
   - In 3D the materials' finish, pattern and category are ignored.
   - Nothing has texture coordinates.
8. **The trees are weak.** There is one icosahedron crown, and only `Plant.kind <= 1` is drawn. `src/build/plants.ts` already models five species, but Pro doesn't use it.
9. **The ground is flat colour with no markings.** `flatMP` also makes one mesh per triangle group, which wastes draw calls.
10. **Anti-aliasing is canvas MSAA only.** Rails, fins and mullions shimmer, and nothing improves the image while the camera is still.
11. **Night is one uniform glow.** Every pane is lit equally, so the building looks like a lantern rather than occupied.
12. **Materials leak and multiply.**
    - `mats(ds)` builds new materials on every `set()`.
    - `mat()` is called inside loops.
    - `clear()` disposes geometry only, so the materials are never freed.

Items 1 to 5 cause most of the gap and are cheap to fix. Phase 1 fixes them.

---

## 1. Rendering pipeline

**Decision:** keep Pro on `WebGLRenderer`, with pmndrs `postprocessing` and N8AO.

- The city editor (`src/render/engine.ts`) uses WebGPU with TSL. Pro stays on WebGL2 for three reasons:
  - `three-gpu-pathtracer`, which the still renders need, requires WebGL.
  - `wire.ts` and `mesh.ts` keep working unchanged.
  - Phones and older laptops behave more predictably.
- Borrow ideas from `engine.ts`, not its code:
  - AgX tone mapping at night;
  - re-rendering shadows only once the camera settles;
  - fixed dynamic-resolution steps;
  - the `?perf` flag.
- Confirm there is a single `three.core` chunk after the build.

**New `src/pro/render/pipeline.ts`:**
- An `EffectComposer` with a half-float frame buffer, so light values above 1 survive into the bloom.
- Passes: `RenderPass` → `N8AOPostPass` → `EffectPass` (SMAA, bloom at night, tone mapping).
- `renderer.toneMapping = NoToneMapping`, since the effect pass does the tone mapping.
- Wireframe and plan views skip the pipeline.
- `frame()` calls `pipeline.render`.

**Renderer settings:**
- `antialias: false` (the composer does it), `powerPreference: 'high-performance'`, no `preserveDrawingBuffer`, no stencil.
- sRGB output. Colour textures in sRGB; normal, ORM and alpha maps in linear.
- Tone mapping: Khronos PBR Neutral by day, which keeps swatch colours true; AgX at night.
- Exposure: 1.0 by day, rising to 1.5 at night.
- Clamp albedo to 0.03–0.85 linear in the material library, so whites don't clip in the sun. The swatch keeps its token colour.
- Camera near plane `max(0.2, distance × 0.002)`, updated as the camera moves.

**New `src/pro/render/sky.ts`:**
- A Preetham sky driven by the same sun direction as `setSun()`: turbidity 6.5, rayleigh 1.6, mie 0.006 / 0.82.
- The environment map is generated from that sky plus a ground disc, at 256 px with `PMREMGenerator.fromScene`, and assigned to `scene.environment`. It regenerates when the sun moves more than 1°, at most every 150 ms.
- The `HemisphereLight` goes in shaded mode.
- Light balance:
  - Sun at 3.0, scaled by elevation; its colour goes from about 5800 K overhead to 2600 K near the horizon.
  - Environment intensity 1.0 by day, 0.04 at night with a blue tint.
  - About 4:1 between a sunlit and a shaded white wall.
- Backgrounds:
  - "Sky", the default in shaded mode, no longer following the UI theme.
  - "Studio", a neutral gradient for reports.
  - The wireframe keeps the paper colour.
- Fog becomes `FogExp2` (about 0.0012) in the horizon's colour.

**New `src/pro/render/shadows.ts`:**
- No cascaded shadows: a plot is 30–300 m, and one fitted 4096 map gives 2–5 cm texels.
- `fitShadow` runs on every `setSun` and `set`:
  - fits the shadow box to the scene's bounds in the light's view;
  - snaps it to whole texels so it doesn't swim.
- Bias from the texel size: `normalBias = 1.2 × texel`, `bias = −0.0001`.
- Map size 2048 on the standard tier, 4096 on high and for stills.
- `PCFShadowMap` with radius 2–3. Not VSM, which leaks through thin slabs. Not PCSS, which is too costly live.
- `shadowMap.autoUpdate = false`: the map re-renders only on `set`, `setSun` and accumulation frames, not while orbiting.
- Glows, lamps, rails and panes never cast shadows.

**Ambient occlusion:** N8AO.
- Radius 1.2 m, distance falloff 0.5, intensity 2.5, half resolution on the standard tier.
- Medium quality while the camera moves; High or Ultra at rest.

**Anti-aliasing:**
- SMAA while the camera moves.
- At rest on the high tier, and always for stills: up to 32 frames jittered with a Halton sequence and blended together, with the sun jittered inside a 1° cone for real soft shadows.
- No TAA.
- The draft tier keeps canvas MSAA with no composer.

**Bloom:** mipmap blur, threshold 1.0, intensity 0.6, radius 0.6, only at night. Only lamps, signs and lit windows bloom.

**New `src/pro/render/still.ts`:** `renderStill({ width, height, samples, quality: 'raster' | 'path' }): Promise<Blob>` replaces `snapshot()`.
- **Raster still:** an offscreen composer at 2400×1600 up to 3840×2160, 64 accumulated frames, N8AO Ultra.
- **Path-traced still** (Phase 5): `three-gpu-pathtracer`, loaded only when asked for.
  - Glass is swapped for real transmission (IOR 1.52), glows become real light sources, and the sky becomes an equirect environment.
  - 256–512 samples at about 2 MP, denoised, with progress and cancel.

---

## 2. Materials

**New `src/pro/render/pbr.ts`:** one cached material library replacing `mats()` and `matOf()`.
- `surface(id, slot, tint?)`, keyed by material id, tint and tier.
- The colour stays the token. Textures add only detail: luminance variation (averaging 1), normal, roughness and AO.

Finish table:

| finish / category | roughness | metalness | extra |
|---|---|---|---|
| matt (paint, plaster) | 0.9 | 0 | normal 0.3 |
| textured (sand paint, stone, brick) | 0.95 | 0 | normal 1.0, AO |
| satin | 0.55 | 0 (paint) / 0.9 (metal) | |
| gloss (tile, ACP) | 0.25 | 0 / 0.85 for ACP | ACP: physical material, clearcoat 0.6 |
| metal | from the finish | 1.0 | |
| wood | 0.7 | 0 | grain normal |

- Standard materials everywhere, except physical materials for ACP and glass.
- The library owns its materials, which fixes the leak.
- `Look` gains material ids for the wall, accent, base, roof and rail. The `env` parameter is dropped.

**New `src/pro/render/textures.ts`:** procedural textures drawn on a canvas, at real module sizes.

| pattern | module |
|---|---|
| brick | 230 × 75 mm, 10 mm joints |
| tile | 600, 800 or 1200 mm; ACP 1200 × 2400; glass 1500 × 3000 |
| plank | 150 mm |
| stripe, louvre | 100 mm |
| stone | 600 × 300 mm ashlar |

- Each pattern produces luminance, normal and ORM maps at 512 or 1024 px.
- `Material` gains an optional `module?: [w, h]`.

**Scanned textures:** CC0 sets from ambientCG for plaster, concrete, sandstone, asphalt, grass, ground, paving and bark.
- 1K versions converted to KTX2, stored in `public/assets/render/tex/`, loaded lazily with `KTX2Loader`.
- Budget: under 4 MB on the standard tier, under 10 MB on high.
- Licensing: CC0 only (ambientCG, Poly Haven, Kenney, Quaternius), each listed in `LICENSES.md`.

**Texture coordinates:** real metre UVs, not triplanar mapping.
- `prism()`: u along the perimeter, v up the height.
- `flat()`, `Buf.face()` and `annulus()`: u, v = x, z.
- Instanced boxes: a `boxUV` shader patch in `src/pro/render/chunks.ts` projects each face in world space, so a pattern continues across neighbouring boxes.

**New `src/pro/render/glass.ts`:**
- Live glass is a physical dielectric: metalness 0, roughness 0.04, IOR 1.52. No live transmission.
- Reflective coated glass gets a specular colour from its token.
- Spandrel glass is opaque, roughness 0.15.
- Glass balcony rails: opacity 0.18, `depthWrite` off.

---

## 3. Geometry detail

**New `src/pro/render/facade.ts`:** `facadeWall` builds each outer face floor by floor as a wall with rectangular holes cut for the openings, plus reveal quads going in by the recess depth.
- Recess depth by wall material: brick or stone 0.12 m, paint or plaster 0.10, ACP 0.04, glass 0. A new optional `glazing.setback` token overrides it.
- `comp.reveal` keeps its meaning: a surround standing out from the wall, in the accent material.
- The zone prisms are replaced by these faces; faces hidden against another block are skipped.
- Cost: about 30 triangles per opening.

**Windows by kind:**
- Frame and pane sit inside the recess.
- Every window has four 60 mm frame members and a projecting sill.
- By kind:
  - sliding: two overlapping sashes;
  - casement: a mullion every 0.6 m;
  - fixed: no mullion;
  - louvre: 6–8 blades.
- Taller windows get a transom.
- Balcony doors are split into panels, and the lobby gets real glass doors.
- About 8 instances per window.

**Other detail:**
- Copings on parapets.
- Curtain walls get spandrel bands and a transom, the single biggest gain for formed towers.
- Balconies:
  - a soffit under the slab, with a drip;
  - MS rails with posts every 1.2 m and balusters every 0.1 m;
  - glass rails with posts every 1.5 m;
  - solid upstands with a coping.
- 25 mm chamfers on building corners and parapets; chamfered instance boxes on the high tier and for stills.
- Chhajjas taper from 100 mm to 75 mm, with a drip groove.

**Level of detail:** today only formed buildings' instanced parts have levels. The new rules apply the same way to slab and formed buildings, in one sorted list:

| On-screen size | What's drawn |
|---|---|
| Over 260 px | Everything |
| 70–260 px | No balusters, sills or surrounds; one frame member per window |
| Under 70 px | Walls and panes only, on a simple mass version |

- **Draw calls:** merge ground meshes per material and merge prisms per building. Target: under 400 draw calls and 1.5M triangles on the benchmark scene.
- **Rebuild time:** keep `set()` under 150 ms, moving the facade work to a worker if needed.

---

## 4. Context and entourage

**New `src/pro/render/entourage.ts`:**
- Reuse the five species from `plants.ts`, one instanced mesh per species per level of detail, with colour, scale and rotation varied per tree.
- Draw every plant kind.
- No alpha-card or photoreal trees.

**Ground, roads and markings:**
- A 600 m ground disc with grass and soil textures that fades into the fog.
- Asphalt tinted by the site kit's surface.
- Markings: centre dashes (3 m on, 4.5 m off), edge lines, stop lines and zebras at gates, parking-bay lines.

**People and cars:** low-poly CC0 models (Kenney cars, Quaternius people), compressed with meshopt and loaded lazily.
- Cars park in the bays and along the roads; people stand near the entrance, on footpaths and on balconies.
- Under 250k triangles, behind an "Entourage" toggle that is on for stills.

**New `src/pro/render/context.ts`:** neighbouring buildings within 250 m from the city's baked OSM tiles, as a light grey mass that casts shadows.
- **Open question:** how a Pro plot is located on the map. Confirm this before building the context layer.

---

## 5. Interior and night

- **Lit rooms:** each pane gets a lit value from a hash of building, floor and opening.
  - Occupancy depends on the hour: about 55% lit at 20:00, 35% at 23:00, 10% at 03:00.
  - Each room gets its own warmth (2700–4000 K) and intensity (0.6–1.4).
  - Formed buildings hash by bay along their glass strips.
- **Interior mapping** (high tier and stills): a ray-box room behind each window (bay-wide, a floor high, 4.5 m deep), sampling a procedural atlas of 8 room variants.
  - Fresnel blends it with the sky reflection, so you see in when looking straight on and get mirrors at grazing angles.
  - The standard tier gets a darkening gradient instead.
- **Lamps:** emissive intensity up to about 6, through the bloom.
  - The wall-wash glows become additive gradient quads.
  - Light pools on the ground under poles.
  - No real point lights.

---

## 6. Performance and quality tiers

**New `src/pro/render/quality.ts`:**

| tier | who | pipeline | shadows | AO | textures | extras | DPR cap |
|---|---|---|---|---|---|---|---|
| draft | phones, Intel UHD | direct, MSAA, Neutral | 2048, on settle | none | none | far trees | 1.25 |
| standard | Iris Xe, Radeon 680M, GTX 1650 | composer, N8AO half, SMAA, bloom at night | 2048 fitted | half, Medium while moving | 512 + KTX2 | depth-tint glass, entourage | 1.5 |
| high | RTX laptops, Apple M | composer, N8AO full | 4096 | High at rest | 1024 | interior mapping, chamfers, idle accumulation | 2 |
| still | on demand | offscreen, 64 frames or path tracer | 4096, sun jitter | Ultra | 1024 | everything | export size |

**Frame budgets:**

| Hardware | Tier | Target |
|---|---|---|
| Mid-range laptop, 1080p | standard | 60 fps, GPU ≤ 10 ms, CPU ≤ 4 ms |
| Phone | draft | 30 fps minimum, GPU ≤ 25 ms |
| RTX 3060 laptop | high | GPU ≤ 14 ms |

Stills: a raster still in under 6 s, a path-traced still in under 90 s.

**Choosing the tier:**
- An initial guess from the GPU's name (`WEBGL_debug_renderer_info`), touch support and device memory.
- A runtime check of frame time that drops to a lower tier if the budget is missed, and never steps up automatically.
- The choice is remembered in `urbanplan:pro:quality`, with a "Quality" select next to the wire/shaded toggle.

**Benchmark:** `tools/render/fixtures/bench.json`:
- 10 towers of 30 floors in mixed design systems;
- 4 formed towers of 60 floors;
- the full site kit, 300 plants, entourage and context.

It opens with `/pro/?bench&perf` and reports p50/p95 frame times, draw calls, triangles, memory and rebuild time. The overlay lives in `src/pro/render/perf.ts`.

---

## 7. Phasing

The biggest visible jump comes first: light, AO, glass and tone mapping improve every screenshot without touching geometry.

| Phase | Time | What it delivers | Main risk |
|---|---|---|---|
| 1. Light and lens | about 2 weeks | <ul><li>Sky and environment light on every material</li><li>Neutral by day, AgX at night</li><li>Fitted shadows, N8AO, SMAA, night bloom</li><li>Dielectric glass, merged ground</li><li>First material library (fixes the leak)</li><li>A "Render image" still</li><li>The `?perf` overlay and the benchmark scene</li></ul> | pmndrs `postprocessing` may not support three 0.186. Fallback: three's own composer with GTAO, SMAA and UnrealBloom passes. |
| 2. Real materials | 2–3 weeks | <ul><li>Full material library, procedural and KTX2 textures, box UVs</li><li>Road markings</li><li>Quality tiers with automatic detection</li><li>The KTX2 asset pipeline and `LICENSES.md`</li></ul> | Texture scale on rotated buildings |
| 3. Architectural geometry | about 3 weeks | <ul><li>Recessed windows with reveals</li><li>Mullions and transoms by kind, sills, copings</li><li>Proper balconies, curtain-wall spandrels</li><li>Level of detail for slab buildings</li><li>Chamfers</li></ul> | Rebuild time, X-ray and window picking |
| 4. Night, interiors, entourage, context | about 2.5 weeks | <ul><li>Lit rooms, interior mapping, better lamps</li><li>Five tree species, people and cars</li><li>Neighbouring buildings</li></ul> | Interior mapping maths on instanced panes |
| 5. Stills that beat Revit | about 2 weeks | <ul><li>Path-traced stills in under 90 s</li><li>Raster still v2</li><li>Progress and cancel UI</li><li>Stills in the drawings and report</li></ul> | Memory on large schemes, WebGL context loss |

**Total: about 11–12 weeks for one developer.**
- After Phases 1 and 2 (about 5 weeks), the live view should be ahead of the APS viewer and level with or better than Forma.
- Phases 3 and 5 are where it passes Revit's Realistic view.

**Packages:** versions to verify, including peer ranges against three 0.186.

| package | version | use | approx. size (min+gz) | loaded |
|---|---|---|---|---|
| `postprocessing` | ^6.37 | composer, SMAA, bloom, tone mapping | 45–70 KB | Pro, shaded mode |
| `n8ao` | ^1.10 | ambient occlusion | 12–15 KB | with the composer |
| `three-gpu-pathtracer` | ^0.0.23 | path-traced stills | ~50 KB | lazily |
| `three-mesh-bvh` | ^0.9 | the path tracer's BVH | ~40 KB | lazily |
| three addons | 0.186 | Sky, KTX2Loader (with basis wasm, about 200 KB, lazy), GLTFLoader with meshopt, BufferGeometryUtils | ~35 KB JS | lazily where possible |
| dev: `pixelmatch`, `pngjs` | ^7 | visual diffs | — | tools |
| dev: `@gltf-transform/cli` | ^4 | KTX2 and meshopt asset pipeline | — | tools |

Budget: no more than 150 KB gz added to the first load.

---

## 8. Verification

- **Reference shots:** `tools/render/shots.mjs` with `vite-render.ts`, following the pattern of `tools/film`.
  - The page renders deterministically from `?bench=…&shot=…&sun=…&tier=…&capture`.
  - The matrix: 3 fixtures × 6 cameras × 3 lights × the tiers.
- **Visual regression:** golden images compared with `pixelmatch` (threshold 0.1). A test fails if more than 0.5% of pixels differ.
  - Goldens come from one reference machine, since GPUs differ.
  - Updating goldens is a deliberate commit with the before and after images.
- **Colour fidelity:** under Studio light, each material rendered head-on must come within ΔE2000 6 of its token colour, so the swatch always matches the 3D.
- **Competitor benchmark** (kept private): the same massing modelled in Forma, the APS viewer and Revit Realistic, shot from the same cameras.
  - Each is scored 1–5 on contact shadow and AO, glass by day, materials at 20 m, aliasing while moving, night, scale and entourage, sky, and colour fidelity.
  - Gates:
    - after Phase 2, at least as good as Forma on every row;
    - after Phase 5, ahead of Revit Realistic on glass, night and stills.
- **Performance:** the `?bench&perf` run saves its numbers to `render-out/`. Each phase's budgets are checked on the reference laptop and on a mid-range Android phone. Counters must not grow after 20 rebuilds.

## Critical files

- `src/pro/scene.ts`: the constructor, `frame`, `setSun`, `setTheme`, `snapshot`, `lod`; in `set`: `mats`, `prism`, `flat`, the openings loop and `Boxes`.
- `src/pro/form/mesh.ts`: `matOf`, the UVs in `Buf.face` and `annulus`, `Look`, the curtain branch of `buildForm`, and `roofOn`.
- `src/pro/materials.ts` and `src/pro/design.ts`: `module?`, `glazing.setback?`.
- `src/build/plants.ts`: the tree species.
- `src/render/engine.ts`: the reference for AgX, shadows on settle, dynamic resolution and `?perf`.
- New modules in `src/pro/render/`: `pipeline`, `sky`, `shadows`, `pbr`, `textures`, `chunks`, `facade`, `glass`, `entourage`, `context`, `quality`, `still`, `perf`.
- New tools in `tools/render/`: `shots.mjs`, `vite-render.ts`, `textures.mjs`.

---

## Status (2026-11-21): built

| Phase | Done |
|---|---|
| 1 Light and lens | <ul><li>`src/pro/render/pipeline.ts`, `sky.ts`, `shadows.ts`, `perf.ts`: GTAO, SMAA, night bloom, Neutral by day and AgX at night</li><li>Fitted, texel-snapped shadows re-rendered only on change</li><li>Dielectric glass, merged ground, a "Render image" still, a `?perf` overlay and `proView.bench()`</li><li>three's own passes: no pmndrs or n8ao dependency</li><li>The Preetham sky is the backdrop only; the environment map comes from a measured gradient dome with a sun disc</li></ul> |
| 2 Real materials | <ul><li>`pbr.ts`: a cached library, so materials no longer leak</li><li>`textures.ts`: procedural maps at real module sizes</li><li>Scanned CC0 sets: `npm run render:textures` downloads them from ambientCG, converts normal and roughness maps to KTX2 when `toktx` is installed, and writes a manifest and `LICENSES.md`. `loadScans` uses them as detail maps, so token colours hold, and falls back to the procedural maps.</li><li>World-projected UVs for instanced boxes; metre UVs everywhere else</li><li>`quality.ts`: tiers, a GPU guess, automatic step-down, and a Quality picker</li><li>Road markings, clipped to the road surface</li></ul> |
| 3 Architectural geometry | <ul><li>`geo.ts` `cutFace`: openings cut with reveals</li><li>Frames by window type; sills; railings by type; copings; drips; curtain-wall spandrels and transoms</li><li>Level of detail for straight buildings</li><li>Scale-aware chamfered members on the High tier: `CHAMFER_BOX` and `BEVEL`, 25 mm at any size</li><li>Everything round a building's edge is placed from its real outline (`outline.ts`: blocks unioned, courtyards kept, collinear runs merged, convex and reflex corners)</li><li>Corner members trim or extend at corners (`endExt`)</li><li>Attachments are clipped to their face; balconies that would hit another wing are dropped</li><li>One pergola per building</li></ul> |
| 4 Night, interiors, entourage, context | <ul><li>`glass.ts`: interior mapping, lit rooms, Fresnel</li><li>`entourage.ts`: five tree species, cars, people</li><li>`context.ts`: the neighbouring buildings within 250 m from the city's baked OSM region, drawn whenever the plot is on the map (`ProProject.at`, set by import or survey lookup)</li></ul> |
| 5 Stills | <ul><li>`renderStill` raster: about 0.5 s at 1200×800</li><li>`renderStill` path-traced: lazily loaded `three-gpu-pathtracer`, with instanced trees, cars and people baked into a plain mesh per colour so they appear</li><li>Progress and cancel</li></ul> |
| Verification | <ul><li>`npm run render:shots`: reference stills and the benchmark, compared with pixelmatch against `tools/render/ref/{standard,high}`</li><li>Competitor protocol and kit in `docs/plans/render-benchmark.md`</li></ul> |

**Verified on 2026-11-21:**
- **Scanned textures.** `npm run render:textures` fetched all 10 ambientCG CC0 sets (plaster, concrete, brick, stone, asphalt, grass, ground, pavers, wood, tile). It shrank them to 512 px (1.7 MB in all, inside the 4 MB budget) and they're committed in `public/assets/render/tex/` with `LICENSES.md`. In the app every surface map comes from the scans: plaster grain on render, brick courses on Brick Vernacular.
  - Normal maps are KTX2: UASTC with mipmaps, made by Basis Universal compiled to wasm (the `ktx2-encoder` npm package), or by `toktx` when it's installed. They load through `KTX2Loader`, with the transcoder in `public/basis`. Colour maps stay JPEG because they're made into detail maps on a canvas.
  - The sets total 3.3 MB, inside the 4 MB budget.
- **CC0 models.** `npm run render:models` fetches all of Kenney's CC0 models (1.5 MB, `public/assets/render/models/<kit>/`, each kit with its own colour atlas, plus `LICENSES.md`):
  - cars (sedan, SUV, hatchback, taxi, delivery van) from his Car Kit, via its OpenGameArt mirror;
  - a motorcycle and three trucks from his Racing starter kit;
  - a character from his 3D Platformer kit.
  
  In the scene, cars are a weighted mix of those (few taxis and vans), about a third of parking slots become a pair of motorcycles and one in ten a truck, and people are the character. The code-made cars and people remain only as a fallback.
- **Neighbours** load at Bandra and Fort (Mumbai) and Kothrud (Pune): 2,253, 1,751 and 3,435 triangles of massing.
- **Chamfers** show on window surrounds, bands and parapets on the High tier.
- **Path-traced stills** show green trees, coloured cars and people.
- **Reference sets** were re-captured with the scans for both tiers.

**Gates dropped:**
- The competitor-comparison gates (Phase 2: level with Forma; Phase 5: ahead of Revit Realistic on glass, night and stills) were **dropped by the user's decision on 2026-11-21**: running them needs Autodesk products and accounts.
- The comparison remains an optional check. Its protocol, cameras, scoring sheet and our captured side are in `docs/plans/render-benchmark.md`.
- No Autodesk scores exist or were made up.

**Measured on the sample, Intel UHD 630:**

| Tier | p50 | p95 | Draw calls | Triangles |
|---|---|---|---|---|
| Standard | 1.3 ms | 14.2 ms | 90 | 192k |
| High | 1.5 ms | 19.6 ms | 90 | 465k |

A rebuild takes about 8 ms, with no growth in geometries, textures or materials over 20 rebuilds.

**Alignment and access** (`docs/plans/alignment-and-access.md`):
- Problem 1 is built as above.
- Problem 2, part built:
  - The fire tender's lane is derived from the buildings on every change, at `FIRE_GAP` 1.5 m (as assumed) from the faces. It ends at gates or gets a spur to a road side, and the fire check tests the same lane. A test checks the lane follows the buildings when they move.
  - The optimiser leaves room for that gap.
  - Roads are cut back from buildings by 1.2 m.
  - The optimiser's roads stay marked as derived.
  - The old plot-edge drive is the 'plot-edge' access option.
  - Still to do: entrance spurs to every building, and spine and grid roads laid in the gaps between buildings.
