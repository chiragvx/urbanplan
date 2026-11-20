---
name: site-studio-direction
description: "User's decisions for Site Studio (plot sandbox): max built-up capacity, realistic site, road what-ifs applied on close"
metadata:
  node_type: memory
  type: project
  modified: 2026-11-01T16:37:32.601Z
---

Site Studio must show the **maximum building capacity** of a plot as a realistic project (compound wall, gates, access + internal roads, buildings, parking, open space), auto-optimised; the user changes settings, not geometry. Decided 2026-11-01:
- Road width edits made in the studio are what-ifs on the plot; they're written to the main city map **only when the studio closes**.
- Objective: most built-up area (FSI use) within the rules; profit secondary.
- Typology: mostly mid-sized slabs; Mumbai (DCPR) forces towers — plan for both.
- Show the impact of a road change (FSI, BUA, floors, flats, profit before → after).

**Why:** the earlier "Generate" placed small fixed-size buildings that didn't read as real projects.
**How to apply:** build in order: roads + impact strip → max-capacity solver + site elements → extra rules/settings. Related: [[editor-vision]]
