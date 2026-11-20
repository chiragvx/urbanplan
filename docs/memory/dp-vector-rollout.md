---
name: dp-vector-rollout
description: "In-progress city-wide DP vectorizer run (tools/dp/vector.py) — state as of 2026-11-12, what to run next, push to main when it passes"
metadata:
  node_type: memory
  type: project
  modified: 2026-11-12T12:47:00.814Z
---

Replacing the crumbly traced DP zones with a vectorizer (strokes → skeleton → polygonize → colour each face → dissolve, OSM roads cut). User liked it ("vector is so much better"), asked to apply city-wide and **auto push to main when done** (2026-11-12).

State on 2026-11-12 (before a PC restart):
- Uncommitted: `tools/dp/vector.py` (new), `tools/dp/plan.py` (calls vector.run; flags `--no-vector`, `--workers`, `--reuse`).
- `data/raw/cities/pune/plan.trace.json` exists; `plan.json` is still the trace version; `plan.vector.json` (cache) not yet made. Backups: plan.v0.json, dp/trace.v0/.
- Last full run was killed by Claude Code for low system memory (6 workers, 15.4 GB RAM) at tile 450/1001 — not a code bug. An earlier run finished all tiles in ~25 min (2 tiles fell back to trace) but crashed at export; that bug is fixed.

**2026-11-12 later: city-wide run ON HOLD.** User wants vectorization "extremely accurate, flaunt-worthy" before mass production. Found: S2 sheet registration residuals median 1.95 m, p90 4.6 m, max 9.5 m (S1: 0.64 / 1.55 / 2.3 m) - geometry ceiling is registration, not the vectorizer. Truth set (160 points) only scores colour, not boundaries. Proposed plan: gold tiles (polygon truth) + boundary/IoU metrics -> local registration warp to OSM roads -> fix failure modes -> confidence-flagged review -> gate -> public accuracy page.

**How to apply (once the quality bar passes):** when the user says go, run `DP_CITY=pune PYTHONIOENCODING=utf-8 python tools/dp/plan.py --workers 3` in background (~45 min; `--reuse` skips vectorizing if plan.vector.json exists). Then `truth.py eval` (trace baseline 97.5%, n=160), `npm run bake:dpreport`, `npm run build`, `npm run check:site`, `npm test`. If all pass and not clearly worse: commit vector.py, plan.py, regenerated public/dpr + tiles regions.json + data, push main. If anything fails, stop and report. Known leftovers to mention: nala blue read as commercial, red-line fringes, higher vertex counts.

Methods comparison artifact: https://claude.ai/artifact/Atcc6LsE1LyanLZjgQTkbB. Related: [[editor-vision]], [[monetization-dp-report]].
