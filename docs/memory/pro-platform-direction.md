---
name: pro-platform-direction
description: "Decided 2026-11-19: existing editor stays as the free \"simple\" version; a separate TestFit-like full platform under the same brand"
metadata:
  node_type: memory
  type: project
  modified: 2026-11-19T06:21:50.227Z
---

Decided 2026-11-19: the existing 2D plotting editor stays as the free "simple" version. A full version (TestFit-like) is a separate platform with the same brand, at /pro/ (src/pro/). The FSI/DP/guide pages are funnels into the tools. Plan: docs/PLAN.md.

State 2026-11-19 (pushed b140642): every phase in PLAN.md has a first cut (import plots, deal model, rooms, model JSON/IFC, per-building design system, scrutiny/NOCs/fees/drawings/DXF, options, screening, layouts, rule-based brief agent, window.urbanplan API). The UI was redesigned after the user called the old one "awful to use": six steps on a rail, an always-visible result bar over the 3D with change flashes, live number fields, undo, share links. Pushed 9469baf: plot by survey/CTS number (api/plot.js proxies MahaBhunakasha, strips owner data), DCPR 2034 margins/height/rooms/light read from the regulation text, permission types, teams + comments (supabase/migrations/0004_project_team.sql — the user must run it in the Supabase SQL editor; RLS tested on PGlite). Pushed 51b280c: UDCPR room/light/lift/fire-lift/refuge/stair/scrutiny-fee values read from the sanctioned text (UDCPR has NO legal min for habitable rooms/kitchens). Pushed b543192: lobby (corridor-less) floors for short one-core blocks in site.ts (LOBBY_W 4.5 m; 4.0 broke room checks), MFB fire scrutiny fee (circular 155, 2018-19), phone UX fixes. Pushed d61ed16: team invites (api/invite.js via Resend + Supabase generate_link; needs Vercel env keys; 0005_project_invites.sql for joined_at — user must run it). Pushed b36bfc8: PreDCR DXF rebuilt from MCGM's PreDCR help manual (autodcr.mcgm.gov.in/BPAMSCLIENT2/Downloads/MCGM/MCGM_PreDCR_help_manual_AutoDCR.pdf): AC1015 LWPOLYLINE, per-floor _Floor plans, _Section, ref circles. Still open: a real PreDCR Verify/submission, MCGM building-proposal fee schedule. 0004 migration run on live Supabase by the user 2026-11-19 (tables + project_role verified, anon writes refused).

**Why:** pro users (developers, architects) need a real product; the free pages' SEO stays with one brand.
**How to apply:** keep everything going through src/pro/evaluate.ts and the shared engine (src/doc/plot.ts, site.ts) so simple and Pro never disagree; the user cares a lot about UX: check every UI change in a browser at desktop and phone width. Related: [[editor-vision]], [[site-studio-direction]], [[monetization-dp-report]], [[bhunaksha-cadastre]].
