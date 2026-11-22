# Log: Pro's global UX (docs/plans/pro-global-ux.md)

Newest first. Each entry gives the phase, what changed, how it was checked, and what's left or known to be off.

---

## 2026-11-22 · Phase 2: find anything, one Share

**What changed:**
- **Search (Ctrl+K, or the Search button)** (src/pro/search.tsx). It reaches:
  - every step, and the view commands;
  - undo and redo;
  - the stage;
  - each building (it picks and frames it) and the plot;
  - every Share item;
  - every setting.
- **Settings in search** come from a hand-kept list, src/pro/findable.ts: 45 sections and 49 fields. Choosing one opens its step, unfolds the section, then scrolls to the field, focuses it and flashes it.
- **tools/dev/test-findable.ts** is in `npm test`. It fails if a section is missing from the list, or if the list names a section or field that isn't there. It caught the Design › Roof section on its first run.
- **Share ▾ is the one place for outputs:** a link, people and comments (Team's button is gone from the top bar), an image or a path-traced image, the drawing set, drawings as a PDF, the area statement, model JSON and IFC.
  - The Render-an-image menu in the view tools is gone.
  - Scheme › Export the model is gone.
- **One job chip** by the save state. It shows rendering or path tracing with progress and Cancel, and "Making the PDF…". It replaces the floating `still-prog`.
- **The project menu** sits beside the name. It holds:
  - the project's stage (Looking, Designing, Applying), stored as `ProProject.stage`, Designing by default;
  - five recent projects, yours and shared with you, when signed in;
  - All your projects (the dashboard);
  - New project.
  
  The Projects dialog, and its delete, are gone: deleting is on the dashboard.
- **The account menu** replaces More: the email, the dashboard, search, shortcuts, the simple editor, sign out.
- **`Menu`** (ui.tsx) can now have a label, headings, ticked items, a second line, disabled items, and an `onOpen`.

**How it was checked:**
- Browser at 1280×800:
  - "parking" in search landed on Scheme › Living › Parking, focused and flashed;
  - the Share menu;
  - a path trace started from Share showed in the chip and cancelled from it;
  - the stage menu.
- Phone (375 px): the top bar and the share sheet are unchanged.
- No new console errors.
- `npm test` ALL OK, including the new search test; `npm run build` OK.

**Left or known:**
- The stage does nothing yet beyond being set and shown. Phase 4 makes it choose where you land and the scorecard's figures.
- The dashboard card doesn't show the stage yet.
- Not checked: the recent-projects list and sign-out (accounts are off locally).
- Approval › Drawings and report keeps its own PDF button and busy state, outside the job chip.

---

## 2026-11-22 · Phase 1: the numbers everyone shares

**What changed:**
- **The FSI ladder** (`ProProject.load`, src/pro/ladder.ts).
  - Basic FSI, then premium, TDR and ancillary, each taken or left. A part left out is gone from the permissible area and the money.
  - `plotReport(p, floorH, all)` applies it, after the TOD and height-cap limits.
  - `Evaluated.full` keeps what every part would give.
  - In the Site step, the ladder replaces Allowed. "How much" became "How much of it to build".
- **What each part adds to profit** is worked out with one evaluation per part, a part at a time, 450 ms after the project settles. It's hidden for buildings placed by hand, which the ladder doesn't change.
- **What the land is worth** (`landWorth` in deal.ts) is solved by bisection on `applyDeal`. It gives the most to pay outright, and the largest joint-development revenue share, for a target margin or IRR (`ProProject.target`, 20% margin by default). It shows in Money, and on the scorecard as "Land worth" while no land price is put in.
- **The area statement** (src/pro/areaStatement.ts) is one list of rows.
  - Pro shows it live, from Built-up on the scorecard or the button under the ladder. Building lines frame their building.
  - The drawing set's sheet prints the same rows.

**How it was checked:**
- Node, on the sample:
  - leaving out premium, TDR or everything paid moves the permissible area to 6,189, 4,909 and 2,068 m², from 7,789;
  - at the solved land price, the margin is exactly the target (0.0500).
- Browser: the ladder, the gains (+₹6.92 cr premium, +₹5.64 cr TDR), the Money section (₹4.12 cr, or 7.8%), the area statement window, and the drawing-set sheet.
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- Buildings that aren't formed get one area-statement line per building, not per floor.
- In the money model, built-up area beyond the parts taken is still charged as TDR. A hand-placed scheme that goes over shows a cost, not just a failed check.
