# Log: Pro's global UX (docs/plans/pro-global-ux.md)

Newest first. Each entry gives the phase, what changed, how it was checked, and what's left or known to be off.

---

## 2026-11-23 · Phase 8: the outline, comments on the view, the empty state

**What changed:**
- **The outline** (src/pro/outline.tsx), docked beside the sheet (O, or the rail's list button; open by default on a screen 1440 px or wider):
  - the plot and its roads; the buildings with their letter, a failing-check dot and a comment count; the elements; the features;
  - eye hides a building or feature from the view for this session (the numbers still count it); lock stops it being picked;
  - drag a building, or Alt+↑↓, to reorder (the letters follow), with an undo toast.
- **Comments on the view** (src/pro/comments.ts, commentPins.tsx): Comment in the top bar (C) drops a numbered pin on a building or a spot; a thread beside it with reply, resolve, delete; the list takes the inspector's place while commenting.
  - In the cloud they're the project's comments, with an `anchor` (supabase/migrations/0007_comment_anchors.sql). Until that's run, they save without their pins and say so.
  - A project only in this browser keeps them as notes to self.
  - The Team dialog is now People (members only), from Share › People….
- **No Welcome dialog:** a new project opens on the view with the four ways in (find it, draw it, type its size, import it) and "look round this sample".
- **The help corner** (? after the compass at the end of the view tools): a checklist that ticks itself (set the plot, add a building, look at the numbers, a second option, share it), search, keys, guides.
- **Density:** the compass is in the view tools; the drawing hint sits beside the shelf; focus mode (Shift+\) puts the sheet and outline away.

**How it was checked:**
- Browser at 1440×860, with your project backed up first and restored exactly afterwards: the outline docks and the shelf shifts clear; a comment dropped on Building A anchored to it and its count showed in the outline; the list opened a thread; `?new=blank` showed the empty state; no console errors.
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- Cloud comments are untested (the browser isn't signed in, and 0007 isn't run).
- Not done: review clouds on the drawing set and its cover-sheet list, field dots, a building's comments in its inspector.
- With the sheet, the outline and the empty state all open, the screen is crowded. Users also found the stage modes and the sheets confusing; docs/plans/pro-ia-rethink.md proposes a view-first Pro, and focus mode goes with it.

---

## 2026-11-23 · Phase 7: Sites, above projects

**What changed:**
- **The dashboard has Sites** (src/dash/sites.tsx), between Projects and Design systems. It's kept in this browser for now (src/pro/sites.ts); Supabase later.
  - **Paste plots** from a broker's list or a land bank, one a line: name, frontage, depth, road, DP road, and an asking price per sq ft if known; or name, area, road. Lines it can't read are listed back. **Add a plot** is a form for one; Edit and Delete are on each row's menu.
  - **The firm's default prices** sit above the list: the rules (Pune, Mumbai…; first from your preferred authority), the sale price (blank: the city's), and the target (margin or IRR).
  - **Each plot's quick figures:** area, road, potential (the built-up the FSI ladder allows), saleable carpet and homes from the best scheme, the most the land is worth outright (in all and per sq ft of plot), and the largest joint-development share. They're worked out one plot a tick after the page draws (about a tenth of a second each) and kept with the site until its plot or the prices change.
  - **Ranked** by what the land is worth. An asking price over it is underlined.
  - **A status per site:** Lead, Looking, Offered, Bought, Dropped, with a filter ("Open" hides bought and dropped). CSV of the list.
  - **Open** starts a project on the plot at the Looking stage, in Brief, under the same prices and target, and moves a lead to Looking.
- **Explore's "Screen many plots"** now points to Sites; its runner is gone and the paste reader (src/pro/screen.ts) is shared.
- Dashboard search finds sites by name.
- **tools/dev/test-sites.ts**, in `npm test`, checks that:
  - 20 pasted lines give 19 plots and one line listed back; an asking price is kept;
  - twenty plots are ranked by what the land is worth;
  - no scheme builds past its potential;
  - the best opens as a project with its plot and road, at the Looking stage, with the same area.

**How it was checked:**
- Browser at 1280×800, with your project and the dashboard's storage backed up first and restored exactly afterwards:
  - twenty pasted plots worked out in about 2 s and ranked (NIBM first at ₹16.60 cr, ₹4,723/sq ft);
  - Open took NIBM into Pro at Looking, in Brief, and the scorecard matched the row exactly (potential 1,36,584 sq ft, saleable 82,749 sq ft, worth ₹16.60 cr); the site moved to Looking;
  - at phone width the page scrolled sideways (the header buttons and the status filter); fixed: they wrap and scroll in place.
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- No adding from the map yet.
- The list is in this browser only, so viewers and teammates don't see it.
- Every site is a rectangle on one road: no corner plots or drawn outlines.
- Opening a site replaces the project in this browser, as New project does.
- The figures use the default deal; a site's own deal or land price isn't modelled beyond its asking price.

---

## 2026-11-23 · Phase 6: the architect's floor

**What changed:**
- **Flat sizes are a design input.**
  - `sizes` (carpet m² for 1, 2, 3 BHK) is on the project and on each building, and kept per option.
  - Brief › Flat sizes sets the project's, in sq ft, with "The starting sizes" to reset them.
  - The inspector's "Its own flat sizes" sets a building's.
  - The layout (both plain and formed buildings) cuts flats near the sizes asked. Flats come whole, so they land about 15% under to 40% over.
- **The typical floor** (src/pro/floor.ts, in the inspector): flats a floor by type, carpet each against the size asked, cores, the floor's area and carpet, its efficiency, and how many floors are like it.
- **Fit its length:** for a straight building, "Flats a floor" and a button that finds the shortest length holding at least that many. The toast says when the count it gets differs (counts jump, for example 4 to 8).
- **Numbers › Inventory** (folded): every flat by building and type, count, carpet each, and value at the sale price, with a total. A building's name picks it; "Change them" opens Brief › Flat sizes.
- Search finds Flat sizes and Inventory.
- **tools/dev/test-floor.ts**, in `npm test`, checks that:
  - bigger 2 BHK sizes give bigger flats;
  - the inventory counts every flat and all their carpet;
  - the fit holds at least the target, and a metre shorter holds fewer;
  - fewer flats a floor gives a shorter building.

**How it was checked:**
- Browser at 1280×800, on your project, backed up first and restored exactly afterwards:
  - Building A (your tower) with its own sizes, 2 BHK at 650 sq ft: the typical floor showed 2 BHKs at 601 sq ft (asked 650), and the inventory followed (58 flats, ₹52.33 cr);
  - "Change them" opened Brief › Flat sizes;
  - the size fields were too narrow at 29 px; they now stack one per row.
- No console errors. `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- Picking a floor band in the outline or X-ray isn't built.
- "6 flats a floor" can be set only on a straight building; a formed building's plan sets its count.
- An exact flat count isn't always possible: the fit gives the shortest length with at least that many.
- The inventory is read-only, and its "Sizes asked" line shows the project's sizes even where a building has its own.

---

## 2026-11-23 · Phase 5: options and Compare

**What changed:**
- **Options** (src/pro/variants.ts) are other schemes on the same plot.
  - Each option has its own scheme, fill, type, floor cap, mix, shops, look, systems and FSI ladder.
  - The plot, rules, prices and deal are shared.
  - The project's own fields are always the option that's open, so the rest of Pro is unchanged. The list keeps each option's copy, and switching saves the open one first.
  - Options are stored in the project's JSON: `options`, `option`, `chosen`. There's no new table.
- **The option menu** sits by the stage menu in the top bar. From it you can:
  - open another option;
  - duplicate, rename, choose or delete the one open (never the last);
  - open Compare.
  
  Search has the same actions.
- **The brief and Explore add options and no longer overwrite the open one.**
  - "Use" became "Add" (+), and "Use the best" became "Add the best as an option".
  - Each new option is filled afresh, opened, and named after the result, for example "Brief: Slabs, at most 6 floors…".
  - The first option added turns what you had into Option A.
- **Compare** shows two to four options side by side: Built-up, Homes, Profit, Margin, IRR, Peak cash, Height, Failing checks and Departures.
  - The best value in each row is underlined.
  - Each column has "Open it" and "Choose".
- **The scorecard's "vs" toggle** appears once there are two options. It shows each figure's difference from a base option: the chosen one, or else the first other option.
- **Shared links:** `#s=…&o=<id>` opens that option.
- **tools/dev/test-variants.ts**, in `npm test`, checks that:
  - switching keeps each option's own fields;
  - shared inputs stay shared;
  - duplicate, rename and delete work, and the last option can't be deleted;
  - a field a brief clears (the hand-placed scheme) stays cleared.

**How it was checked:**
- The test caught one bug. A brief's option kept the hand-placed tower because the change went through a JSON copy, which drops `undefined`. It's fixed, and the test now covers it.
- Browser at 1280×800, on your project, backed up first and restored exactly afterwards:
  - "Plan it" made three options, each filled afresh;
  - Compare showed all four, with the best marked;
  - Choose set the chosen option;
  - "vs" showed the differences;
  - switching back to Option A brought its hand-placed tower back (1,20,153 sq ft).
- No console errors. `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- Compare has no thumbnails or split view yet, and there's no filter chart for many options.
- Undo is shared across options: undoing just after a switch can step back over it.
- The dashboard card doesn't show the chosen option.
- Approval files whichever option is open, not necessarily the chosen one.
- Brief option names are long; the top bar clips them at 220 px.

---

## 2026-11-22 · Phase 4: Brief, Design, Numbers, Approval

**What changed:**
- **The rail has four places in place of six steps** (src/pro/places.tsx). The keys are 1–4, and Back and Next are gone.
  - **Brief** has three parts:
    - *The site gives:* the rules, the FSI ladder and the constraints;
    - *You want:* Fill the plot and the flat mix;
    - *Make options from it:* the written brief, options, screening many plots and the plotted layout. These were under Explore.
  - **Design:**
    - the plot (on the map, by survey number, or imported);
    - what's on the site, living, the buildings, shops and parking;
    - **Look**: the design system's name and elevation, with "Open the design system". That opens the old Design step as a large sheet.
  - **Numbers:** the area statement first (a building line picks and frames it), then the money.
  - **Approval:** as before. The view pins a "✕ 3 fail" chip over each building with checks to look at, and a click picks and frames the building.
- **The pick stays when you change place.** Building A picked in Design is still picked, with its inspector, in Numbers and Approval.
- **The plot's editor shows only when the plot is picked** (click open ground inside it). Before, it also showed whenever the Site step was open.
- **The stage chooses where you land and what the scorecard shows.**
  - **Looking** opens on Brief. The scorecard shows Potential (the permissible built-up and the FSI taken), Saleable (carpet), Land worth, Profit and Rules.
  - **Designing** opens on Design. The scorecard is as before.
  - **Applying** opens on Approval. The scorecard shows Built-up, Homes, Rules, Fees and Documents; Fees and Documents unfold their sections.
  - Setting the stage moves you to its place, and opening a project lands on its stage's place.
- **Old step values carry over.** A stored step from the six steps maps to the place that took it in, and a note says so once. The dashboard's starts (sample, template, survey or import, a design system) land on Design; a design system also opens Look.
- **Search** has the new places. Its settings were re-filed, and the builder's sections open the Look sheet (shown as "Design › Look › …"). "Look" and "Area statement" were added, so the test covers 45 sections.

**How it was checked:**
- Browser at 1280×800:
  - the stored "site" step opened on Brief, with the note;
  - Design's sections and Look's sheet;
  - Numbers opens on the area statement;
  - Looking and Applying each landed on their place with their own scorecard, and the stage was set back to Designing;
  - Building A stayed picked from Design to Approval;
  - the check pin shows over A.
- No new console errors.
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- Not built yet:
  - the permissible envelope (a ghost volume) in Brief;
  - the profit tint in Numbers;
  - the inventory in Numbers.
- The scorecard follows the stage, not the place.
- Screening many plots is still under Brief until the dashboard's Sites (phase 7).
- In Approval, at the sheet's width, some scrutiny rows overlap their text ("Commercial floors by road width"). This was there before phase 4.
- The phone view isn't changed. Its links from the places map to Overview, Money and Rules.

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
