# Log: Pro's global UX (docs/plans/pro-global-ux.md)

Newest first. Each entry gives the phase, what changed, how it was checked, and what's left or known to be off.

---

## 2026-11-22 · Phase 3: the inspector

**What changed:**
- **The inspector** (src/pro/inspector.tsx) is a panel on the view's right that follows what's picked. It shows on wide screens only; a phone keeps its read-only building card.
  - **A building:**
    - its name, which can be typed over;
    - duplicate and remove;
    - the departures it needs, built-up area and homes;
    - Size: floors, and length and depth for a straight building, plus turn buttons;
    - Shape, By hand (silhouette and plan), Roof and Skin for a formed building, or Shape it for a straight one;
    - Flat mix and Design system;
    - Floors by use, which X-rays a floor;
    - its checks;
    - Systems and Flat plans.
  - **The plot:**
    - the planning authority;
    - frontage and depth, while it's a rectangle;
    - a table of its edges, each with its length, the road today and the road's width in the development plan;
    - levels: over the road, the slope, and which way it falls;
    - north.
  - **A thing on the site:** its width, levels, or how far across, by kind. A tree, well or no-build zone gets its radius, how much is kept clear, and a note. Each can be removed.
- **Hiding it:** its × hides the panel and keeps the pick. The building bar's Inspect, or a new pick, brings it back.
- **The view keeps clear of it.** `ProView.setCover(x, y, r)` takes a right edge. The view's middle, the tools and the compass shift left by the panel's width, and the floating bars stay left of it.
- **The building's floating bar is slimmer** while the inspector is open: Shape, Roof, Skin, Mix, Style and Inspect are in the panel. Their popover bodies are now shared components in formHud.tsx: `ShapeBody`, `RoofBody`, `SkinBody`, `MixBody`, `StyleBody`.
- **The Scheme step is project-wide only.** The picked-building card, with its back link, is gone. Its Systems and Flat plans live in the inspector, and the Next and Back footer always shows.

**How it was checked:**
- Browser at 1280×800:
  - picking Building A from the list opened the inspector with every section. The bar slimmed, and the floating bar stayed clear of the panel;
  - × hid the panel, and the bar's Inspect came back;
  - Esc deselected;
  - clicking the plot opened the plot inspector with the edges table.
- No new console errors. The ones there were from hot reloads mid-edit.
- `npm test` ALL OK. The search test now covers 43 sections, with nothing left out. `npm run build` OK.

**Left or known:**
- Not checked in the browser: editing values in the inspector, and the inspector for roads, parking, gates and features.
- At 1280 px the building's floating bar can touch the tool shelf, because the room between the shelf and the inspector is narrow.
- The plot is in the inspector only when it is picked on the view. On the Site step with nothing picked, the plot's bar shows and the inspector doesn't.
- The step sheet still floats or pins on the left; phase 4 reworks the rail and steps.

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
