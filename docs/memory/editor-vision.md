---
name: editor-vision
description: "UrbanPlan (formerly Pune Remix) map editor (built 2026-10-29) — personal 2D Figma-like editor + 3D, publish/fork model, decisions behind it"
metadata:
  node_type: memory
  type: project
  modified: 2026-10-29T04:27:26.460Z
---

Built 2026-10-29 (commits 84d294f, 73ebcf8, 74f07d8). The user wanted the "easiest editor" for a more accurate Pune
map: full scope, no phases. Decisions the user made:
- personal editor; people publish, and others download/open and edit their own copy (no accounts or server)
- edits live as a property-level patch over the baked base (`.punemap.json`), re-attached by locator on re-import

The architecture is in README "The editor" and "Layout" (src/doc, src/editor, src/scene, src/ui, src/app,
tools/map-cli.ts). Gotchas that cost time:
- @preact/signals makes components pure: every panel must read `docVersion.value` itself, or it won't refresh.
- Headless Chrome renders on a software GPU, so view animations take hundreds of ms; driver scripts must wait for
  `__app.E.view.anim` to clear before computing screen coordinates.
- The user's own dev server runs on :5173. Test on another port and don't kill theirs.

2026-10-29 (commit e2f0db3): the user asked for Cities: Skylines-matching road drawing, shortcuts and snapping because
making bridges was too hard. Built a CS-style road tool (src/editor/roadtool.ts) with PgUp/PgDn heights, auto
junctions at same-level crossings, and Shift+PgUp flyovers with ramps (ops.elevate/toGround). Follow CS conventions
for new tools. Tunnels and underpasses (negative heights) are still planned, not built.

**Why:** hand edits plus the review queue and DP underlay are the fastest route to accuracy where OSM and DP inference are wrong.
**How to apply:** keep importer/generator changes compatible with section/junction ids and incremental RoadMesher
updates; run `npm test` after doc changes. Follow-ups are in [[dp-road-plan]] (DP inference, overlap fixes).
