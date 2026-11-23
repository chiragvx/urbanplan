# Rethink: Pro's information architecture, view first

Written on 2026-11-23, after phases 1–7 of docs/plans/pro-global-ux.md were built, with phase 8 (outline, comment pins, empty state, focus mode) still being built. This is research and a plan only: no code has changed. Line numbers are from the working tree on 2026-11-23, which includes phase 8's uncommitted edits to main.tsx.

**The feedback, from the product owner:**
1. Users don't understand the stage modes (Looking, Designing, Applying).
2. The left side offers too many choices: the rail of four places, each with a long sheet of folding sections, plus the tool shelf.
3. Users forget the 3D view exists. The view, where you pick, draw and move buildings, should be the main way in.

**The recommendation, in one line.** The view becomes the workspace. The right-hand inspector becomes the one place for settings: the picked thing, or the project when nothing is picked. Numbers and Approval become reports you open from the scorecard and close to get back to the view. The rail and its four sheets go. The stage leaves Pro's top bar and becomes a status on the dashboard.

---

## 1. Diagnosis

### 1.1 "I don't understand Looking / Designing / Applying"

| Cause | Where |
|---|---|
| **The stage is shown as a mode but works like a shortcut.** Picking a stage moves you to a place and changes the scorecard's figures. Both are things the rail and the scorecard already do, so the stage adds a second, hidden way to do the same thing. It's a 1:1 copy of three places: Looking → Brief, Designing → Design, Applying → Approval. | `placeOf`, main.tsx:76; `setStage`, main.tsx:509 |
| **The scorecard changes meaning under you.** At the same plot, Looking shows Potential / Saleable / Land worth / Profit / Rules, Designing shows Built-up / Homes / Profit / IRR / Rules, and Applying shows Built-up / Homes / Rules / Fees / Documents. A user who changed the stage once, or opened a site from Sites (which sets Looking), sees "different numbers" with nothing to say why. | `ResultBar`, main.tsx:782-858 |
| **The stage menu is two menus in one.** The button next to the project's name is labelled with the stage ("Designing ▾"), but it also holds the recent projects, All projects and New project. People open it to switch projects and are offered a stage; or they read "Designing" as a save state or a role. | `ProjectMenu`, main.tsx:902-914; stage labels in project.ts:134-135 |
| **The words are statuses, not places.** "Looking" and "Applying" describe where a project is in the firm's pipeline, which is what Sites (lead, looking, offered, bought) and the dashboard card are for. Inside one project the architect does all three at once: looks at the ladder, moves a tower, checks a setback. | §A.4 of the global plan says the stage "never hides anything"; that's exactly why it reads as doing nothing |
| **It's the third set of modes on screen.** Place (rail), stage (top bar) and option (top bar) are all switchable, and each changes what the screen shows. Forma and Snaptrude have one row of modes, and each one changes the **tools** (Forma: Site design / Compare / Board). Ours change nothing you act with. |  |

### 1.2 "Too many choices on the left"

What sits left of the view, or on its left edge, on a 1280 px laptop:

| Region | Count |
|---|---|
| Rail | 4 places, plus outline and sheet toggles (main.tsx:606-624) |
| Sheet | about 31 sections across the four places. Brief has 10 in three parts: Rules, the ladder, Constraints; Fill the plot, Flat mix, Flat sizes; Brief, Options, Screen many plots (now only a pointer to Sites), Plotted layout. Design has 7, Numbers 8, Approval 6 (places.tsx, sitePanels.tsx, steps.tsx) |
| Outline | phase 8: a second list on the left (main.tsx:652) |
| Shelf | 6 unlabelled icons, 3 with flyouts (shelf.tsx:43-50) |

Why it confuses:
- **The sheet is open on arrival.** `panel` starts `true` (main.tsx:124), so the first thing anyone sees is a long form over the left of the view. That reads as "this is a form-filling app with a picture".
- **The same thing lives in two or three places.** A user who finds one copy doesn't know if it's the one that counts.
  - The plot: Design › Plot, the plot inspector, and the plot bar.
  - The buildings: Design › Buildings, the outline, and the view.
  - Things on the site: Design › On the site, the shelf, and the outline.
  - Flat mix: Brief, and each building's inspector.
  - Checks: Approval › Scrutiny, the pins, and the building's "Its checks".
- **The split between Brief and Design is by the code's history, not by the user's question.** Sections were divided by a `part` flag (sitePanels.tsx:25, 85). So Fill the plot (how many buildings, how tall) is in Brief, while Buildings, Parking and Living are in Design. An architect looking for "make it 3 towers" has to guess.
- **Explore's leftovers sit inside Brief.** Screen many plots (a pointer to Sites), the plotted layout (a different product), and options from a written brief sit under "Make options from it", the third part of a long sheet.
- **Two panels hold settings.** The sheet (left) and the inspector (right) both hold settings, by a rule users never see: project-wide on the left, picked thing on the right. With the sheet pinned and the inspector open, the view loses both panels' width on a laptop (not measured; the phase 3 log notes the building bar touching the shelf at 1280 px).
- **The shelf gives no words.** The six tools are icons with tooltips. "Add a building" is a tower icon with a small triangle: easy to miss next to a sheet full of labelled controls.

### 1.3 "They forget the 3D editor"

This is mostly a result of 1.1 and 1.2, plus three things of its own:
- **The generator does the work from the sheet.** With `scheme` unset, Fill the plot lays the buildings out from sliders and numbers (sitePanels.tsx:99-110). A user can get a full scheme, with money and checks, without touching the view once. The view looks like an output.
- **Touching the view silently switches who owns the layout.** The first drag makes the scheme "shaped by hand". After that, Fill's settings stop applying, and Living says "these apply when you fill again" (sitePanels.tsx:100-101, 119). Users who tried the view once and saw their sheet settings "stop working" learn to stay in the sheet.
- **Nothing in the view says it can be touched until you pick.** The handles (height, move, turn, length, depth: hud.tsx:282-287) and the plot's corner and road chips appear only after a pick. Hover gives a tooltip, not a cursor or an outline that says "grab me".
- **Every way in leads out of the view.**
  - The new empty state's "Type its size" sends you to Brief (main.tsx:657).
  - Opening a site from Sites lands in Brief (main.tsx:231).
  - Looking lands in Brief, Applying in Approval.
  - Most scorecard figures change the place (main.tsx:775-855), which reopens the sheet over the view. Built-up and Saleable open the area statement in a dialog.
  
  Only "Draw it" keeps you in the view.
- **The checklist doesn't ask for it.** The help corner's tasks are: set the plot, add a building, look at the numbers, second option, share (start.tsx:62-68). Nothing asks you to move or reshape something in 3D, which is the step that makes the view click.

---

## 2. The revised IA

### 2.1 The principle

There is **one workspace** (the view) and **one settings panel** (the inspector). **Reports** open over the view and close back to it. Forma, TestFit and Arcol all work this way: the canvas is the screen, properties follow the selection, and metrics stay in view (global plan §3). We already built the inspector (phase 3) and the scorecard. This rethink makes them carry the load the rail and sheets carry today.

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ◧ Tower plot, Baner ▾ │ Option B ▾ │ ● Saved ⟲ ⟳ │ [Search Ctrl K] │ Comment │ Share ▾ │ ☺ │
├────────────┬───────────────────────────────────────────────────────────┬─────────────┤
│ ↖ Select   │  Built-up 1.2L ▮▮▮ 92% · Homes 76 · Profit ₹8.7cr · IRR 14% · Rules 6✗ │ INSPECTOR   │
│ ▣ Building │                                                           │ nothing     │
│ ❀ Grounds  │                                                           │ picked:     │
│ ⚑ Site     │                     (the view, 3D)                         │ THE PROJECT │
│ ✎ Plot     │                                                           │ picked:     │
│ ⟷ Measure  │                                                           │ THAT THING  │
│ ✦ Generate │                                                           │             │
│ ─────────  │                                                           │             │
│ ≡ Outline  │            3D/Plan · Shaded · fit · street · sun · ?      │             │
└────────────┴───────────────────────────────────────────────────────────┴─────────────┘
```

### 2.2 At first open

- **The view at full width, with the plot framed.** The sheet is gone, not just closed. The inspector shows the project, folded to its header below 1440 px.
- **New project:** phase 8's empty state, kept, with one change: all four ways in stay in the view. "Type its size" draws the rectangle and frames it; it doesn't go to Brief.
- **Once the plot exists, an on-view prompt by the plot asks for the next step,** with two buttons:
  - **Place a building**: arms the Building tool, with the default tower;
  - **Generate a layout**: one go of the generator, using the project's brief.
  
  Either way, the result lands **picked**, with its handles showing (see 2.6).
- **Opening an existing project** lands in the view on whatever was picked last, or on nothing. It never opens on a sheet. Opening a site from Sites lands in the view with the plot framed and the inspector on "The site".

### 2.3 The left side: one toolbar, labelled

The left edge holds one column, the **toolbar**: Select, Building, Grounds, Site, Plot, Measure, then **Generate**, then **Outline**.
- **Labels under the icons,** at 64 px wide. The tools are the main way in, so they get words. Arcol and TestFit both label their main tools.
- **Generate** takes in what Explore and "Make options from it" do today. It opens a popover beside the toolbar with:
  - the written brief;
  - the type, most floors and most buildings (today's Fill the plot);
  - "how much of the FSI to build";
  - **Make 1 / Make 3 options**.
  
  Results are always **new options** (phase 5's behaviour), never a hidden live layout (see 2.5).
- **Outline** (phase 8) opens as a list to the right of the toolbar. It's the only list of what's in the project. Design › Buildings, Design › On the site and the Approval list all go.
- **Nothing else sits on the left.** No rail, and no sheet.

That's 8 labelled choices where there are 4 places, about 31 sections and 6 unlabelled icons today.

### 2.4 The right side: the inspector holds every setting

| Picked | Inspector sections (folded unless noted) |
|---|---|
| **Nothing: the project** | **The site** (authority, plot size and roads summary, constraints; "Edit the plot" picks it) · **What you're building** (the FSI ladder, open; flat mix; flat sizes) · **Living, parking, shops** · **Look** (the design system, with "Open the design system") · **Deal and prices** (land price, sale price, target) · Comments (phase 8) |
| The plot | as built in phase 3: authority, size, edges and roads, levels, north |
| A building | as built: size, shape, mix, design system, typical floor, its checks, systems, flat plans |
| A site thing | as built |

So the project has five sections in one place, and each of today's sheet sections lands in exactly one home. "Where do I change X?" has one answer: pick X, or pick nothing for the project. Ctrl+K stays the fast path (phase 2's field registry only needs new paths).

### 2.5 Generated or yours: one visible state

Keep the generator, but make it explicit:
- **A generated layout says so.** A chip on the view reads "Generated from the brief · Regenerate". Brief changes move it live, as today.
- **The first drag or edit of a building asks nothing, but says what happened.** A toast reads: "This layout is now yours: brief changes won't move it. Undo · Regenerate as a new option". The chip then reads "Your layout".
- **Settings that no longer apply are greyed in the inspector, with that reason.** They aren't left to silently do nothing.

This fixes the "the settings stopped working" trap (§1.3). It keeps the live generator that Looking-style work and the ladder's "what each part adds" need (log, phase 1).

### 2.6 Leading a first-time user into the view

- **Hover says "grab me".** A building under the cursor gets an outline and the move cursor; the plot's edges get a hover line.
- **The first pick of the project shows a one-line hint on the HUD:** "Drag the top for floors · drag the middle to move · type a number to set it". It's dismissed for good on first use.
- **The help corner's checklist** (start.tsx:62) becomes: Set the plot → Put a building on it → **Change its height or move it in 3D** → Look at the numbers → Make a second option → Share. Each task can be clicked to do it, which arms the tool or opens the report.
- **No tour, no dialog.** Forma's Tasks checklist is the model (global plan §2.10). It's already half built in phase 8.

### 2.7 Numbers and Approval: reports, not places

- **The scorecard is the way in.** Built-up opens the area statement, Profit and IRR open the money, and Rules opens the checks. Each opens a **report**: a wide panel up from the bottom over the view, with tabs.
  - **Numbers** has: Area statement · Inventory · Money · Deal.
  - **Approval** has: Checks · Permission · NOCs · Fees · Documents · Drawings.
- **The report follows the pick, as the places do now.** Pick Building B in the view, and the area statement highlights B's lines. A line in the report picks and frames its building (built in phase 4).
- **Esc, or the scorecard figure again, closes it back to the view.** The Approval report turns on the check pins in the view (phase 4's `CheckPins`) and leaves them on while it's open.
- **Keys:** N for Numbers and A for Approval, in place of 1–4. Old `step=` links map: brief and design → the view with the project inspector; numbers → the Numbers report; approve → the Approval report.

### 2.8 The stage: leaves Pro, stays on the dashboard

- **It goes from Pro's top bar.** The project menu keeps only rename, recent projects, All projects and New project.
- **`ProProject.stage` stays as data** (Looking, Designing, Applying), shown and set on the dashboard card and in Sites next to its pipeline status. It's a filter for the firm's list, which is what those words are good at.
- **The scorecard has one set of figures,** today's Designing set: Built-up (with its "% of allowed" meter, which carries what Potential showed), Homes, Profit, Land worth while no land price is put in (already built), IRR, Rules. Fees and documents sit in the Approval report.
- **Share's menu order** (which the plan wanted the stage to choose) follows what was last opened: the feasibility PDF first if Numbers was, the drawing set first if Approval was. Or it stays fixed. Either is fine; neither needs a mode.

Snaptrude's Program / Design / BIM / Present modes are the counter-example. They're worth having only because each changes the tools. If Pro ever gets a mode that changes the tools (say, a submission mode with drawing tools), that's when to bring back a mode switch.

---

## 3. Keep, drop, change: by built phase

| Phase | Keep | Drop | Change |
|---|---|---|---|
| 1 · Numbers everyone shares | the ladder, land worth, the area statement and its rows | — | the ladder moves to the project inspector's "What you're building"; the area statement goes into the Numbers report |
| 2 · Search, one Share | Ctrl+K, Share ▾, job chip, account menu, `findable.ts` and its test | stage items in search; stage in `ProjectMenu` | registry paths point at inspector sections and report tabs |
| 3 · Inspector | all of it | — | it becomes the only settings panel; nothing picked = the project (2.4); pinned open at ≥1440 px |
| 4 · Four places | the pick kept across reports; check pins; old-step mapping | **the rail, the four sheets, `places.tsx`'s split by `part`, stage landing (`placeOf`), the stage-dependent scorecard** | Brief's and Design's sections go to the project inspector and Generate; Numbers and Approval become reports |
| 5 · Options, Compare | options, the option menu, Compare, Choose, "vs", `&o=` | — | Generate is the one way to make options (Explore and the brief's "Add" fold into it) |
| 6 · The architect's floor | flat sizes, typical floor, Fit its length, inventory | — | flat sizes go into the project inspector; inventory into the Numbers report |
| 7 · Sites | all of it | — | Open lands in the view (not Brief); the stage is shown and set here and on the card |
| 8 · In progress | outline, comment pins, empty state, help corner | focus mode: with no sheet it's barely needed (Ctrl+\ to hide the toolbar and inspector is enough) | empty state's "Type its size" stays in the view; checklist gains "change it in 3D"; the outline is the only list |

**Explore's leftovers:**
- Screen many plots → gone from Pro (Sites has it).
- Plotted layout → a type in Generate.

---

## 4. Order of work

Smallest and most telling first, so the first two can be shown to users within days.

1. **View first (small).**
   - The sheet starts closed. Opening a project or a site lands in the view.
   - "Type its size" stays in the view.
   - The toolbar gets labels.
   - The stage leaves the top bar; the scorecard shows one set of figures.
   
   That's enough to run checks 1 and 3 below.
   - **Status (2026-11-23): built.** See docs/plans/pro-global-ux-log.md.
2. **The generated-or-yours chip and toast (small).** §2.5, without moving any sections yet.
   - **Status (2026-11-23): built.** See docs/plans/pro-global-ux-log.md.
3. **The project inspector (medium).** Move Brief's and Design's sections into the nothing-picked inspector; remove the duplicates (Design › Plot, Buildings, On the site). Search's registry follows.
   - **Status (2026-11-23): built, without Deal and prices (step 5).** See docs/plans/pro-global-ux-log.md.
4. **Generate (medium).** The popover on the toolbar takes in Fill the plot, the brief and Explore; results are options.
   - **Status (2026-11-23): built, with a pass for less on screen** (panels start closed, details behind hover or More). See docs/plans/pro-global-ux-log.md.
5. **Reports (medium).** Numbers and Approval as bottom panels from the scorecard; remove the rail and `places.tsx`; N and A keys; map old links.
   - **Status (2026-11-23): built; the rail goes on a wide screen (kept on narrow and phone), places.tsx stays as the bodies.** See docs/plans/pro-global-ux-log.md.
6. **First-run guidance (small).** Hover affordance, the HUD hint, the new checklist.
7. **The stage on the dashboard (small).** Show and set it on the card and in Sites.

Phase 8's outline and comment pins carry on as planned. Its focus mode can wait until after step 5.

---

## 5. Checks with users

Run the first two on today's build (a baseline), then again after step 1, and the rest after step 5. Five people: two in-house architects, two developers or land heads, one liaison consultant (the panel the global plan's §A.6 proposed).

1. **First touch.** "Here's a new plot. Put two towers on it, the taller one 20 floors."
   - Watch where the first click goes: view or panel.
   - **Pass:** 4 of 5 act in the view within 30 seconds, and nobody opens a settings panel to add a building.
2. **Where do I change it?** A first-click test: "Change the parking to a podium", "make 2 BHKs 650 sq ft carpet", "set the land price".
   - **Pass:** the first click lands in the right panel for at least 80% of tasks (pick nothing → inspector, or Ctrl+K), against today's baseline.
3. **The stage, gone.** After a 15-minute session, ask: "Did you miss anything about where this project is: looking, designing, applying?" Then show the dashboard card with the stage, and ask what it means.
   - **Pass:** nobody asks for it inside Pro, and 4 of 5 read the card's stage correctly.
4. **Generated or yours.** Generate a layout, drag one building, then change the flat mix. Ask: "What do you expect to happen to the buildings?"
   - **Pass:** 4 of 5 predict it right, and nobody says the settings "stopped working".
5. **The answer without leaving the view.** "Is this scheme worth doing, and will it pass?"
   - **Pass:** answered from the scorecard and reports with no more than two opens, and the user is back in the view, without help, within a minute.
