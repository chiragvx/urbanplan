---
name: platform-dashboard
description: /dashboard/ platform home (src/dash) shipped 2026-11-20; needs supabase 0006_platform.sql run by the user; free-form buildings in progress
metadata:
  node_type: memory
  type: project
  modified: 2026-11-20T03:40:39.417Z
---

The platform dashboard lives at /dashboard/ (src/dash, entry dashboard/index.html, added to vite ENTRIES). It covers projects, folders, stars and an archive, design systems, team, activity, and settings (profile, security, preferences, notifications, plan, data). Ctrl K opens search. Pushed in 9f8a78e.

**Why:** the user asked for "a proper platform", on the side of the free-form building work.

**How to apply:**
- The user runs Supabase themselves. 0006_platform.sql was run on 2026-11-20, so the dashboard's tables, avatars bucket and delete_my_account exist. The next migration is 0007.
- Pro handles `?new=blank|sample|survey|import` (and `&city=pune|mumbai`); Pro's logo goes to /dashboard/ (done 2026-11-20).
- Website (ff72da1, 2026-11-20): the city editor /app/ is deliberately UNLINKED (noindex, not in the sitemap) until the user says otherwise. Site CTAs use `proStart()`/`PRO`/`DASH` from src/site/ui.tsx, and loading states use `<Loading/>` (the dither).

Free-form buildings: the contract is in src/pro/form/types.ts. A building's form is anchored by its spine; see [[pro-flow-restructure]] and [[editor-vision]].
