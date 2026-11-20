---
name: ux-direction
description: "User's UX decisions (2026-11-02): rules flag never block, auto bridge/tunnel per segment, open-ended plots, icons over text buttons"
metadata:
  node_type: memory
  type: project
  modified: 2026-11-02T16:06:24.088Z
---

Decided by the user on 2026-11-02 while reviewing the "Simpler Building in UrbanPlan" wireframe artifact
(https://claude.ai/artifact/Wqmw8GaowByE1LJ3MNP47s):
- **Rules flag, never block.** No hard numeric limits, clamps or disabled-by-rule controls (a 300-floor tower is fine).
  Departures show subtly: amber on the object/icon and a line in the report.
- **Height is automatic per segment** like Cities: Skylines: a road drawn 100 m → 120 m through a valley and hill
  becomes ground / bridge / cutting / tunnel by stretch, from the terrain and crossings; segments can be pinned.
- **Plots are generic and start empty.** Any use (garden, car park, government office…), not only residential /
  commercial / industrial; the user places a building and plays; generative "Fill for me" is optional; checks appear
  as detail is added. Must work on tiny plots (1,000 sq ft).
- **Icons and small illustrations over text buttons**: the user finds text-button panels boring and cluttered;
  names go in hover cards.
- Liked: road = width + features with the map's standard (Pune USDG / Mumbai SDG / IRC) deriving the cross-section
  and class; bulk edits with mixed values, smart select and preview.

**Why:** the user wants a sandbox, not a compliance gate, and an app that feels visual.
**How to apply:** never add validation that refuses input; design new controls icon-first. Overrides the earlier
"generated scheme first" in [[site-studio-direction]]. Related: [[editor-vision]]
