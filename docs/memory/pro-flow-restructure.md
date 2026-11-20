---
name: pro-flow-restructure
description: Pro is being restructured (Nov 2026) into Site → Design system → Scheme → Money/Approval with drawing on the main 3D/plan view; landing page waits for it
metadata:
  node_type: memory
  type: project
  modified: 2026-11-19T17:24:13.141Z
---

Pro's new flow, as the user asked for it on 2026-11-19:
1. **Site.** Draw on the main 3D view or a top-down plan view; remove the small plot editor in the side panel.
   - Fill in the plot, levels, obstructions, no-build zones, and roads at the local standard widths.
   - A north compass is always on screen. Every feature is shown in wireframe first.
2. **Design system.** Style, colours, facade, flooring. Saved, and can be edited.
   - Generic materials for now, kept in a data shape that real products (tiles, paint, facades) can slot into later.
3. **Scheme.** Buildings the user owns, in any shape, with a scheme for each building.
   - Nothing is capped: the rules flag problems, never block.
   - Building settings: cores, stairs, lifts, ducts, MEP.
4. **Then** Money, Approval and Explore.

"Fill the plot" stays, but with controls: how much to build, what to fill it with, and quality-of-life choices (gardens, internal roads, trees and planting, amenities).

**Why:** the user wants a tool for the user to play with freely, not one fixed answer from the generator.

**How to apply:**
- Build in this order: compass and plan view → drawing tools on the main view and a v2 project file → site objects → rules, money and approval working on any set of buildings → building objects → design system → building settings.
- Shipped in 5628b39 and 20c7200 (2026-11-19), landing page updated to the new order too. Panels keep secondary sections folded; picking an item shows only its card.
- Terrain slope (src/pro/terrain.ts, p.at) and NBC Table 7 fire bands landed in a7e7b3b (2026-11-19). Terrain: baked regions (Pune, Mumbai) automatically; elsewhere an opt-in "Use open elevation data" button (Open-Meteo, sends the location only when pressed).

Related: [[ux-direction]], [[pro-platform-direction]], [[site-studio-direction]].
