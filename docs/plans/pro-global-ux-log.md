# Log: Pro's global UX (docs/plans/pro-global-ux.md)

Newest first. Each entry gives the phase, what changed, how it was checked, and what's left or known to be off.

---

## 2026-11-23 · Generate removed

**Why:** tried on the sample project, Generate wasn't useful.
- Its cards ranked and priced options by profit before the land deal, but the top bar shows profit after it: the brief's best card said ₹4.91 cr and IRR 7.6%, and the option it made showed ₹4.13 cr and 6.2%.
- Its search varied only slabs or towers, a height cap, the flat mix and shops on the ground. That's 72 tries, but only 9 different building layouts. "Make 3 options" gave the same two 4-floor slabs three times, with a different flat mix each time.
- Its cards were text only, and their labels described the settings, not the result ("at most 6 floors" made 4 + 4 floors).

**What changed:**
- **Gone:**
  - the toolbar's Generate button and its popover;
  - the G key and the "Generate options" search action;
  - the project panel's "Generate…" button;
  - the written brief and the "Make 1 / Make 3 options" search;
  - the plotted layout (the land divided into plots for sale), which sat in the same popover;
  - the scripting API's `options` and `brief`.
- **Deleted:** src/pro/generate.tsx, options.ts, brief.ts, layout.ts, and their CSS.
- **Kept, moved:** the project panel's "Generated from" section is now **Layout**. It holds the building type, most floors, most buildings and how much of the FSI to build, which only Generate could set before. They change the open option directly, as the flat mix and sizes do. Once the layout is yours (moved by hand), they're replaced by a note.
- **The checklist's "Make a second option"** now duplicates the open option.
- **The chip over the view is gone** ("Generated from the brief · Brief", and "Your layout · Regenerate"). Laying a hand-moved layout out again from the settings is now two buttons in the Layout section: **As a new option** and **Here**.
- **The home page's Explore step** is now "Options" (several schemes kept as options, compared side by side). Its screenshot, `pro-explore.webp`, still shows the old Explore and should be retaken.
- **Fix:** the "A building is outside the view" note no longer fires when a project opens, only on a switch between its options. Its check now reads the camera's latest position.

**How it was checked:**
- Browser, sample project, with your storage backed up and restored exactly:
  - no Generate on the toolbar;
  - G does nothing;
  - the Layout section shows the four controls;
  - opening the project shows no false note.
- Changing a Layout control in the browser wasn't tried: you were using the pane.
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- Options from the brief or from Explore in saved projects keep their names and contents; only the way to make new ones is gone.
- Trying several layouts now means duplicating the option and changing its Layout settings by hand.

---

## 2026-11-23 · The camera on interactions (docs/plans/pro-camera.md, all four steps)

**What changed:**
- **Panels hold the picture still.** Opening or closing the inspector, the outline, a report or the project's panel no longer shifts the view. A panel now only changes where the next framing aims: the middle of the uncovered part. One exception: if a pick ends up wholly under a panel, it eases out by the smallest move (280 ms).
- **One camera mover** (scene.ts `fly`) behind every command: Whole site, street, above, Show, F, double-click, Plan.
  - Moves take 280 to 600 ms depending on distance and ease out, going the shortest way round.
  - Any press or wheel on the view stops a move where it is.
  - With reduced motion, a move is a jump.
  - Opening a project or a new plot still frames the whole site at once.
- **Plan and back.** P turns the camera to straight down, north up (300 ms), then switches to the plan at the same scale. P again returns to the 3D view you left.
- **The controls.**
  - **Drag:** orbits about the point under the pointer (a building's surface or the ground; on the sky, the middle). A dot marks that point while you drag.
  - **Right-drag or Shift+drag:** pans across the ground, so the camera's height stays put.
  - **Wheel:** zooms toward the pointer, slowing near the surface under it and stopping 3 m short.
  - **Far limit:** 12 × the site (or the tallest building).
  - **Phone:** one finger orbits about what's touched; pinch and two-finger pan are as before.
- **Framing.**
  - **F:** frames what's picked (a building, a site element or a feature); with nothing picked, the whole site. The toolbar's Whole site stays the whole site.
  - **Double-click:** on a building, frames it; on open ground, frames the whole site. Drawing still finishes on a double-click.
  - **Double-tap (phone):** does the same.
  - Framing now fits the box's bounding sphere, so a tall tower fits whole.
  - The shortcuts list says all this.
- **Options don't fly.** Opening or making an option that leaves buildings out of the view adds "A building is outside the view" to its toast, with Whole site.

**The decision (pro-camera.md §5):** I went with (b), extending OrbitControls, not (a), the camera-controls library. On a closer look, OrbitControls already has zoom to the cursor, distance limits and ground panning built in. Only the pivot needed our code: about 40 lines that turn the camera and its target together round the pointed-at point. So there's no new dependency, and edit.ts's `controls.enabled` hand-off is unchanged.

**How it was checked:**
- Browser at 1440×860 with the sample project, your storage backed up and restored exactly.
- **Panels:** a fixed point's screen position didn't change through 1, N, Esc and O, nor when a pick opened the inspector (the camera stayed bit for bit).
- **Orbit:** a drag from a ground point kept that point within 2 px of where it was pressed while the view turned; the dot hid on release.
- **Zoom:** ten wheel bursts at the tower's face stopped 3.09 m from it, with the same point still under the pointer.
- **F:** the move took about 600 ms, eased out, and framed the picked tower whole in the uncovered part.
- **Interrupting:** a press during S's move stopped it where it was.
- **Plan:** P then P returned to the identical 3D view.
- **Reduced motion** (stubbed for the test): S jumped at once.
- **Double-click:** on open ground, it framed the whole site.
- **Reveal:** a tower picked at the right edge, wholly under where the inspector opens, eased out to just left of it.
- **Pan:** a right-drag kept the camera's height exactly.
- **Off-screen note:** with the camera turned away, opening Option A said "Opened Option A. A building is outside the view."
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- The plan's 15-minute user test ("did the view ever move when you didn't expect it?") hasn't been run.
- The phone's double-tap and one-finger orbit about the touched point weren't tried on a real phone.
- The figures bar across the top of the view isn't counted as covering it, so framing can sit a little high.
- Orbiting has no inertia (OrbitControls' drift after letting go), on purpose: the view stops where you let go. Pans and zooms still glide a little.

---

## 2026-11-23 · Rethink step 7: the stage on the dashboard, and a drag that turns the view

**What changed (the drag, after "clicking a building makes it easy to move, but it's horrible while panning or orbiting"):**
- **Only what's picked moves under a drag** (src/pro/edit.ts). A press on a building, a site element or a feature that isn't picked waits: let go in place and it's picked; drag and the view orbits or pans as it would on open ground. Before, any press on a building picked it and started moving it, so turning the camera over a tower shoved it.
- Picked, it moves as before (the cursor says so: a pointer over the others, a move cursor over the picked one). The handles on the picked building are unchanged.

**What changed (the stage, rethink §2.8):**
- **The card shows the stage and sets it** (Looking, Designing, Applying): a small menu under the figures, on your projects and those shared with you to edit; the word alone on a phone or a view-only share. The browser's own project too. It's saved into the project's file, and the card's summary carries it.
- **Projects filters by stage** ("Any stage" beside Sort), and the list view has a Stage column.
- **Sites knows the project opened from a plot** (the project keeps the site it came from): its row says "Project: Looking ▾", settable there; Open opens that project instead of starting another, and "Start another project" is in its menu.

**How it was checked:**
- Browser at 1440×860, with your storage backed up and restored exactly: a drag across an unpicked tower turned the camera and left the tower where it was, unpicked; a click picked it; a drag then moved it and the camera stayed. On the dashboard the browser's card showed Designing; setting Applying saved it, toasted, and didn't open the project. In Sites, a plot whose project came from it showed "Project Applying" with "Open its project"; another plot kept "Start a project…".
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- Setting the stage on a cloud card opens and saves the file, so it counts as a change ("Changed just now") and as an open.
- Projects opened from Sites before today don't know their site, so Sites can't show their stage.
- The stage filter shows only when signed in (the signed-out page has just the browser's card).
- On a building that fills the screen, orbiting needs a drag that starts on it while it isn't picked, or the right button to pan.

---

## 2026-11-23 · Rethink step 6: first-run guidance, and the outline beside the tools

**What changed (first-run guidance):**
- **Hover says a building can be picked.** With the select tool, the cursor turns to a pointer over a building (a move cursor over the one picked). Until you've picked one for the first time, a tag beside the pointer names it and says "Click to pick it, then drag".
- **The first pick gets a one-line hint** above the view tools: drag the arrow on top for floors, the middle to move it, the side handles for its size, or type in the inspector. It goes with "Got it", once a building has been changed in the view, or when nothing's picked, and doesn't come back.
- **The checklist** (help corner) is Set the plot, Put a building on it, **Change its height or move it in 3D** (new: ticked by a drag in the view), Look at the numbers, Make a second option, Share it. **Clicking a task does it** as far as it can: picks the plot, arms the tower tool, picks a building and frames it, opens the Numbers report, opens Generate, opens Share.

**What changed (the outline):**
- The outline docks beside the toolbar instead of pushing it sideways, starts below the top bar, and is only as tall as what's in it (it scrolls past the report's top). The figures move over with it.

**How it was checked:**
- Browser at 1440×860, with your storage backed up and restored exactly: hovering a building showed the tag "Building A / Click to pick it, then drag"; picking it showed the hint above the view tools; the checklist listed the six tasks and "Look at the numbers" opened the Numbers report and ticked itself.
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- The hover is the cursor and the tag; the building doesn't light up in 3D.
- The plot's edges get no hover line.
- The tag shows only until the first pick; after that, the cursor alone says it.

---

## 2026-11-23 · Rethink step 5: reports, and no rail

**What changed:**
- **Numbers and Approval are a report** (src/pro/report.tsx) that rises from the bottom over the view, between the toolbar and the inspector, with Numbers | Approval tabs. The view, its tools and the pick stay above it; its sections sit in columns.
  - **Ways in:** the scorecard (Built-up opens the area statement, Homes the project, Profit, IRR and Land worth Numbers, Rules Approval; the same figure again closes it), N and A, search, and any link that went to those places.
  - **Esc closes it** back to the view. With Approval open, the check pins show on the view.
- **No rail on a wide screen.** The project's settings are **Project** in the top bar (or 1); the outline is **Outline** at the toolbar's end (or O). A narrow screen and a phone keep their rail and sheets.
- The outline button gets the list icon it never had.
- Shortcuts list: 1 · N · A.

**How it was checked:**
- Browser at 1440×860, with your storage backed up and restored exactly: no rail; N opened Numbers (area statement, inventory, what the land is worth in three columns); Rules switched it to Approval (scrutiny, permission, drawings, NOCs, fees, documents); Esc closed it. At first the report covered the toolbar's Generate and Outline, and its sections ran full width: fixed.
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- Deal and prices stay in the Numbers report rather than the project's panel.
- The report is a fixed height (46% of the window, at most 460 px); it can't be dragged taller.
- The approval sections are folds in columns, not one tab each as the rethink sketched.
- `places.tsx` stays (Numbers' body and the project's), so the rethink's "remove places.tsx" is only half done.

---

## 2026-11-23 · Rethink step 4: Generate, and less on screen

**What changed (Generate):**
- **Generate on the toolbar** (src/pro/generate.tsx; G, or search "Generate options"), a popover beside the tools:
  - **Describe it:** the written brief, Plan it, and its best and closest schemes, each with Make;
  - **Or set it:** building type, most floors, most buildings, how much of the FSI to build; **Make 1 option** uses them, **Make 3 options** tries every type, height and mix and makes the three that earn most (in rank order, the best opened), with the rest it found folded under;
  - **Plotted layout:** the subdivision preview, folded.
- Whatever it makes is a new option; the one open stays in the option menu.
- The project's panel loses Fill the plot and "Make options from it": a short "Generated from" section says who lays the buildings out and opens Generate. "Screen many plots" is gone from Pro (Sites has it).

**What changed (less on screen, after "the UI is crowded"):**
- The outline and the project's panel start closed: Pro opens on the view, the tools, the figures and the chip. The rail's Project and the outline button (O) open them, and they stay as you leave them.
- The figures show their numbers only; each one's line of detail shows on hover or focus.
- The building's bar hides while its inspector is open (the inspector has all of it); the handles stay on the building.
- The view tools are 3D/Plan, the drawing, Whole site and More (from the street, from above, x-ray, snapping); Sun and help stay.
- "Saved in this browser" is "Saved", with the where in its tip; the name's pencil shows on hover.

**How it was checked:**
- Browser at 1440×860, with your storage backed up and restored exactly: G opened Generate; Make 3 options made three options and opened the best with the toast and "vs Option A"; the menu listed them; at first the chip and the open Generate button drew wrong (a class clash and dark-on-dark), fixed. The calm screen, a pick (no bar, inspector, handles) and More (opens upward) looked right.
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- Make 1 option takes about a second with no working sign.
- The figures' detail lines are hover-only, so a touch screen at desktop width won't see them.

---

## 2026-11-23 · Rethink step 3: the project in the inspector

**What changed:**
- **With nothing picked, the inspector is the project** (src/pro/places.tsx `ProjectBody`): its name, area and authority on top, then
  - **The site:** Rules, Plot (with Edit the plot, survey number, import), Constraints;
  - **What you're building:** What the plot permits (the FSI ladder), Fill the plot, Living, Flat mix, Flat sizes, Shops at the front, Parking;
  - **Look:** the design system, with Open the design system;
  - **Make options from it:** the written brief and Explore, until Generate takes them in (step 4).
- **Brief and Design are one rail entry, Project** (key 1; Numbers 2, Approval 3). It shows or hides the project's panel; the old `step=brief` and `step=design` land on it, with a one-time note.
- **The duplicates are gone:** Design › Buildings and On the site (the outline lists them; picking one opens its inspector). Esc lets go of a pick and brings the project back.
- Search, the chip's Brief link, Inventory's "Change them" and the empty state's find and import all open the project's panel at the right section (`findIn` now looks in the inspector too).
- On a narrow screen the project is a sheet, as the places were.
- Three numbers a row stack in the inspector, where they didn't fit.

**How it was checked:**
- Browser with your storage backed up and restored exactly:
  - at 1440×860 the project showed on the right; Ctrl+K › Flat sizes opened it there, unfolded;
  - picking Building A showed its inspector, and Esc brought the project back;
  - at 820 px wide, 1 opened "The project" as a sheet.
- `npm test` ALL OK (search reaches all 45 sections); `npm run build` OK.

**Left or known:**
- Deal and prices are still in Numbers; they join the project when Numbers becomes a report (step 5).
- The project's panel is open at every desktop width; folding it to its header below 1440 px isn't done.
- The written brief and Explore sit at the panel's end until Generate (step 4).

---

## 2026-11-23 · Rethink step 2: generated or yours

**What changed:**
- **A chip on the view, right of the tools,** says who lays the buildings out:
  - "Generated from the brief" (with a link to Brief) while brief changes move the layout;
  - "Your layout" once a building has been placed, moved or changed by hand, with Regenerate ▾: **as a new option** (this layout stays as it is) or **here** (the hand edits go; Undo brings them back).
- **The moment it turns, a toast says so:** "This layout is now yours: brief changes won't move it." with Undo and "Regenerate as a new option". Opening a project, undo, redo and switching options don't count as turning it.
- Brief's Fill the plot and Living say why their settings wait while the layout is yours.

**How it was checked:**
- Browser at 1440×860, with your storage backed up and restored exactly: the sample showed "Generated from the brief"; a floor added on Building A turned the chip to "Your layout" with the toast; "Regenerate as a new option" made Option B, generated, with "vs Option A"; switching back to A showed no toast; Regenerate › here brought the brief's layout back with Undo.
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- A drag in the view wasn't tried in the browser (the pane's scaling missed the handle); it goes through the same scheme change as the floor button.
- The settings still sit in Brief's sheet; they move to the project inspector in step 3.

---

## 2026-11-23 · Rethink step 1: view first (docs/plans/pro-ia-rethink.md)

**What changed:**
- **Pro opens on the view.** The sheet starts closed; opening a project, a site from Sites or a template lands in the view with the plot framed. The rail still opens the four places' sheets until step 5.
- **"Type its size" stays in the view:** it sets the plot, frames it and says what to do next, instead of going to Brief.
- **The tools are labelled:** Select, Building, Grounds, Site, Plot, Measure under their icons.
- **The stage leaves Pro.** The project menu is now Projects (recent, all, new); stage items are gone from search; the scorecard has one set of figures (built-up with its % of allowed, homes, profit, land worth while no land price is put in, IRR, rules). `stage` stays on the project as data for the dashboard and Sites.

**How it was checked:**
- Browser at 1440×860, with your storage backed up and restored exactly: the view opens full width with the outline and the labelled tools; Projects has no stage; `?new=blank` › Type its size › Work it out framed a 40 × 50 m plot with the toast, no sheet; no new console errors.
- `npm test` ALL OK; `npm run build` OK.

**Left or known:**
- The stage isn't yet shown or set on the dashboard card (step 7).
- The rail still says Brief is the current place while its sheet is closed.

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
