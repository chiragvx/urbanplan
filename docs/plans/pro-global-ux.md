# Plan: a new global UX for Pro

Researched on 2026-11-22. No code has been changed. Line numbers are as of commit c6ae7fd.

**The goal.** Pro gets one clear shell. The view is where the scheme is made (the editor-in-view plan did that). Around the view there are four steady places, each with one job:
- what the project is and which option you're on (the top bar);
- what's in it (the outline, left);
- what the picked thing is (the inspector, right);
- what it's worth and whether it passes (the scorecard).

Underneath, the structure moves from the generator's steps to the three jobs people come with: **buy, design, apply** (§A). That means:
- a **Sites** pipeline above projects;
- a **Brief** with the FSI ladder and the most the land is worth;
- **the area statement** as the table everything shares;
- **options** that are first-class.

The six-step wizard becomes four places on one model: Brief, Design, Numbers, Approval. **Options** become first-class, so Explore stops overwriting your scheme. **Ctrl+K** reaches every setting by name. Every output (drawings, report, images, files, links) sits under **Share and export**.

---

## 1. Where things stand

### 1.1 The shell today (src/pro/main.tsx:416-560)

| Region | What it holds | Where |
|---|---|---|
| Top bar | logo (to the dashboard), Pro chip, project name, save state, undo/redo, Share, Team, Projects, Sign in, More (New, simple editor, shortcuts) | main.tsx:417-433 |
| Rail (left) | six steps: Site, Design, Scheme, Money, Approval, Explore; a show/hide-sheet button | main.tsx:435-452 |
| Sheet | the step's body, as a drawer or pinned beside the view (`/`); Back / Next in its footer | main.tsx:465-479, sheet.tsx |
| Results bar (top of the view) | Built-up, Homes, Profit, IRR, Rules; each one deltas on change and opens its step | main.tsx:575-622 |
| Shelf (left of the view) | select, buildings, grounds, the site, the plot, measure | shelf.tsx |
| HUDs (in the view) | the plot bar, an element or feature bar, the building's form handles and bar; Inspect opens the Scheme sheet | plotHud.tsx, objHud.tsx, formHud.tsx, hud.tsx |
| View tools (bottom) | 3D/Plan, Wireframe/Shaded, the X-ray floor, fit / street / top / X-ray / snap, Sun, quality, Render an image | main.tsx:509-548 |
| Compass | north dial; a click shows the plan | main.tsx:491-507 |
| Dialogs | Projects, Team (people and comments), Share, Keys, Welcome, the drawing set | main.tsx:557-566, 640-760 |

### 1.2 What the six steps really are

The rail says "steps" and the footer says "Next: Approval", so it reads as a wizard. But only Site comes before Scheme. The rest are different kinds of thing:

| Step | What it really is | How big | Notes |
|---|---|---|---|
| Site | **input**: rules, plot, roads, levels, features, constraints | sitePanels.tsx 6 sections | Half of it is now in the view (plot bar, road chips, north dial). |
| Design | **input, a library pick**: the design system (language, palette, facade, windows, roof, specification…) | designStep.tsx, 793 lines, 16 sections | The same builder lives in the dashboard (memory: design-system-builder). |
| Scheme | **the model**: fill, living, mix, shops, parking, the building list, the picked building's card, export | sitePanels.tsx | Since phases 1-4, shaping happens in the view. The sheet keeps By hand, Systems, Flat plans and the list. |
| Money | **output, with a few inputs** (prices, land, the deal, costs) | steps.tsx | The results bar already shows its four headline numbers. |
| Approval | **output and a deliverable**: scrutiny, permission, drawings and report, NOCs, fees, documents | steps.tsx | It's also where the drawing set is opened. |
| Explore | **a generator**: brief, options, screening plots, plotted layout | steps.tsx:338-400 | "Use" **overwrites** the scheme, and only the toast's Undo brings it back (steps.tsx:356, 372). |

### 1.3 Problems, in order of cost to the user

1. **There is no inspector.** What the picked thing is gets split across:
   - the HUD bar;
   - its popovers (Shape, Roof, Skin, Mix, Style);
   - the Scheme sheet's card, reached by Inspect.
   
   Project-level settings (parking type, green share, shops) sit in the same sheet as the picked building's card. "Where do I change X?" has no one answer.
2. **Options can't be kept.** Explore and the brief produce good alternatives. Taking one destroys what you had, so there is no "A vs B" and no comparing side by side. This is the core loop of a feasibility tool, and every competitor makes it first-class (see §3).
3. **A wizard where there isn't one.** Back/Next and numbered steps (`1-6`) suggest an order that people don't follow. They jump between Scheme and Money all the time, and the results bar already lets them.
4. **Outputs are scattered.** They live in five places:
   - Scheme › Export (JSON, IFC);
   - Approval › Drawings and report;
   - the Render-an-image menu in the view tools;
   - the Share dialog (link, image, PDF);
   - the drawing-set overlay.
5. **Nothing can be found by name.** There are about 50 sections across the steps and no search. The dashboard has Ctrl+K (src/dash/main.tsx:98) but Pro doesn't.
6. **Too many floating clusters at laptop width.** The results bar, shelf, view tools, compass, HUD, drawhint and toasts float over the view, and the rail and sheet sit beside it. With the sheet pinned on a laptop, the view gives up a large share of its width before anything floats over it (not measured yet).
7. **Comments aren't attached to anything.** They live in the Team dialog, tagged with a step name. Pins in the view were left over from the editor plan.
8. **Projects is two places.** There's the Projects dialog in Pro and the dashboard. New, open and delete each exist in both.

What's already good, and stays:
- the results bar's always-on answer, with deltas;
- editing in the view, with typed numbers;
- the sheet's drawer and pin behaviour;
- F6 regions;
- the phone viewer.

---

## A. The information architecture: is the structure right for how people work?

_Added on 2026-11-22. It changes the lenses in §2.1 and the phases in §5. Where this section and §2 disagree, this section wins._

### A.1 What Pro is organised around today

Pro's structure follows **its own pipeline**: Site → Design → Scheme → Money → Approval → Explore. That is the order `evaluate()` computes in:
- rules from the plot;
- a scheme generated under them;
- money from the scheme;
- checks on the scheme.

That order suits the code. A person doesn't think in it. They come with **a question**, and the question depends on the job they're doing. Our own site names the three jobs: "before you **buy**, **design** or **apply**" (src/site/Pricing.tsx:23).

### A.2 Who uses it, and the question each one asks

**Decided (§A.8):** the land team, the architect and the decision-maker are one developer's team. The architect edits, and the others view, compare and decide. This section draws on how Indian residential development generally works (UDCPR and DCPR practice). It is **not yet checked with real users**; §A.6 lists what to ask them.

| Who | Job | The question they come with | What they hand on | How often |
|---|---|---|---|---|
| **Land / business development** (developer's team, a broker, a land owner) | **Buy** | "What can this land give, and what can I pay for it?" Potential (basic + premium + TDR + ancillary), saleable, revenue, cost, **the most the land is worth**, outright or a joint-development share. | A one-page feasibility for the investment committee; an offer | Dozens of plots a month; ten minutes each; most are dropped |
| **Architect** (in-house or hired) | **Design** | "What's the best scheme?" How many towers, the typical floor, the mix, parking, the look. Constantly weighed against the numbers. | A chosen option; the area statement; drawings and renders for the client | A few projects; weeks each; many options each |
| **Liaison / approval consultant** | **Apply** | "Will it pass, and what do I file?" Every check, **the area statement**, the NOCs, the fees, the drawing set. | A submission set | One option per project, gone over line by line |
| **Developer / owner** (the decision-maker) | all three | "Which option, and is it worth it?" | A decision | Opens what others share, often on a phone (now the view-only viewer) |
| _(later)_ Sales | Sell | Inventory by tower and type, renders, prices | A brochure; an inventory sheet | After approval |

### A.3 Where the structure fights those jobs

1. **Buying is buried, and only happens one plot at a time.** The buyer's whole job is many plots, fast, then shortlist. In Pro:
   - "Screen many plots" is a paste box inside one project's Explore step (steps.tsx:389-403);
   - its results aren't saved and can't become projects;
   - a project is one plot, so there's no list of sites with a status (lead, looking, offered, bought, dropped) anywhere.
   
   The buyer's headline question, **the most the land is worth** (a residual land value), isn't answered at all. The money model takes the land price as an input (`p.land`) and gives profit; it never runs the other way. Nothing in src/pro computes a residual.
2. **The biggest decision is a slider.** In Indian feasibility, how much FSI to load is the main lever. You can stop at basic, add paid premium, buy TDR, or take ancillary. Each has its own cost (a share of the ready reckoner rate: src/doc/site.ts:20-23) and its own return. Pro computes the parts (src/doc/plot.ts:155-218) and costs them (deal.ts:77). But the user only sees "How much: N% of what's allowed" (sitePanels.tsx:147), which loads all of them in a fixed order. A buyer or architect can't ask "is TDR worth buying here?"
3. **The area statement has no home.** It's the one document all three jobs revolve around:
   - the buyer's potential;
   - the architect's check;
   - the liaison's filing.
   
   Its pieces sit in four places:
   - Site › Allowed (the permissible parts, sitePanels.tsx:74-84);
   - the results bar (built-up);
   - Money (carpet, by use);
   - the drawing set's sheet (drawings.tsx:358-390).
   
   Nowhere can you see one live table of permissible vs proposed, by building and floor, with carpet and parking.
4. **The brief comes last.** The target mix, flat sizes, height and typology should drive generation and judge every option. Right now the free-text brief is in Explore, the last step, and the structured parts (mix, typology, most floors) are spread through Scheme.
5. **The model stops at the building.** An architect works building → **typical floor** (core plus flats) → flat, then stacks floors. Pro forms the floor plate itself; it's visible in X-ray and Flat plans, but you can't pick it or set it as one thing. Flat sizes (carpet per type) are fixed by the generator, so "make the 2BHK 650 sq ft carpet" can't be said anywhere. There's also no **inventory**: a table of flats by building and type, with carpet, saleable area and price. That's what Money is built on, and what Sales needs.
6. **Different kinds of thing are filed together as steps.**
   - Explore mixes a portfolio tool (screening), a generator (brief, options) and a different product type (the plotted layout, a subdivision for sale, which is a kind of scheme).
   - Design is a firm-wide library, filed as a project step.
   - Approval mixes checking with delivering.

### A.4 The proposed structure

**The nouns**, top to bottom:

```
Firm ─┬─ Sites (the pipeline: every plot looked at, with a status and a quick figure)
      │     └─ promoted to ─┐
      ├─ Projects ◄─────────┘
      │     ├─ The site      plot, roads, levels, features, rules → what's permissible   (shared by all options)
      │     ├─ The brief     what's wanted: typology, mix, flat sizes, height, FSI loading, budget (shared, or set per option)
      │     ├─ Options       A, B, C… each a scheme:
      │     │     └─ Buildings → Typical floors → Flats
      │     ├─ The deal      land price or share, prices, costs, timing                    (shared)
      │     └─ Submission    permission kind, NOCs, documents, the drawing set             (for the chosen option)
      └─ Library             design systems, flat types, site kits (the dashboard)
```

**What the project's rail holds.** It's built from the jobs, not the pipeline. There are four places, and **Compare** sits beside them as a mode in the top bar, not on the rail:

| Place | The question | Holds | The scorecard shows |
|---|---|---|---|
| **Brief** | What's given, what do I want? | **The site gives:** the plot facts, the rules, and the permissible table (basic, premium, TDR, ancillary, with the cost of each). **You want:** typology, mix, flat sizes, height, **the FSI ladder** (§A.5), how much to build. **Make options from this:** today's brief text and Explore. | potential, saleable, **the most the land is worth** |
| **Design** | What's the scheme? | the 3D/plan editor, the outline, the inspector (§2.2-2.3); the plot edited in the view; Look | built-up of permissible, homes, height, failing checks |
| **Numbers** | Is it worth it? | **the area statement** (first tab), the inventory, the money (revenue, cost, profit, IRR, cash), the deal | profit, margin, IRR, peak cash |
| **Approval** | Will it pass, and what do I file? | the checks (on the view), the area statement again (the filing version), the permission, NOCs, fees, documents, the drawing set | checks, fees, documents ready |

How these places behave:
- **Every place works on the same option and the same selection.** Picking Building B in Design and switching to Numbers shows B's lines; in Approval, B's checks.
- **The project has a stage**: Looking, Designing, Applying. It's set in the project switcher and shown on the dashboard card. It chooses:
  - the place you land in;
  - the scorecard's figures;
  - what Share offers first: the feasibility one-pager, the presentation, or the submission set.
  
  It never hides anything.
- **Compare** (top bar) puts two to four options side by side on any place's figures: Brief's potential, Design's view, Numbers' area statement and money, Approval's checks.

**Above the project, the dashboard gets Sites:**
- a table you can paste into or add to from the map;
- quick figures for each plot (potential, saleable, the most the land is worth, under the firm's default prices);
- a status per plot;
- "Open as a project" for the ones worth designing.

This takes "Screen many plots" out of Explore. It also gives the buying job a home where it can be fast.

### A.5 The pieces this needs, beyond the shell

| Piece | What it is | Why it matters | Size |
|---|---|---|---|
| **The FSI ladder** | Basic → + premium → + TDR → + ancillary, each a step you take or leave. Each shows the area it adds, its cost (₹/sq ft and total) and what it adds to profit. It replaces the "How much" slider; "how much of the loaded total to build" stays as a second, smaller setting. | It's the main lever, made visible and comparable between options. | Medium: the parts and costs exist (plot.ts, deal.ts). The generator needs to take a cap made of the chosen parts instead of a share. |
| **The most the land is worth** | Solve the land price for a target margin or IRR: the inverse of `applyDeal`, by bisection. Under joint development, the largest share to the owner. | The buyer's first question. | Small |
| **The area statement view** | One live table: permissible (by part) vs proposed (by building and floor), carpet (RERA), saleable, parking required vs given, with a check mark on each line. The drawing set's sheet is printed from it. | It's the one table all three jobs share. | Medium: the figures exist in `evaluate` and drawings.tsx. |
| **The inventory** | Flats by building and type: count, carpet, saleable, price, value. Editable sizes per type. | Money's base; flat sizes become a design input; Sales later. | Medium (the table, Phase 4); large (editable sizes reaching the generator, Phase 6) |
| **Typical floor as an object** | Pick a floor band in the outline or X-ray; the inspector shows flats per floor, their types and sizes, and the core. | How architects actually design. | Large: Phase 6. |
| **Sites pipeline** | A dashboard table with status; promote to a project. | The buying job, at its real volume. | Medium (local first; Supabase later, like design systems) |
| **The plotted layout** | A scheme kind (`typology: 'plotted'`) rather than a tool in Explore. | It's a different product, not an option generator. | Small (move); medium (make it a full option) |

### A.6 What to check with real users before building

These are assumptions. Five short interviews (two in-house architects, two developers or land heads, one liaison consultant) or a look at the analytics would settle them:
- Do buyers really screen in bulk, and from what? A broker's WhatsApp, a 7/12 extract, a CTS number?
- Is "the most the land is worth" the figure they want, or an offer for a target IRR, or a joint-development share?
- Do architects want to set flat sizes and the typical floor in Pro, or is massing enough before they move to CAD?
- Does the liaison person file from our area statement, or only use it to cross-check their own?
- Who opens a shared link, and on what device?

### A.7 Verdict

The shell plan in §2 fixes how Pro is **laid out**:
- one inspector;
- saved options;
- search;
- one Share.

It doesn't fix what Pro is **about**. Today Pro is about the generator's steps. It should be about the three jobs, with four nouns made first-class, all missing or scattered today:
- **the site pipeline**;
- **the brief with its FSI ladder**;
- **the area statement**;
- **options**.

Of the two, the IA change matters more. It also makes the shell work simpler: Brief / Design / Numbers / Approval maps onto the existing code more cleanly than Model / Money / Rules / Options did.

### A.8 Decided: one team, the architect builds and the rest decide

_Decided with the user on 2026-11-22._

Most developers have an **in-house architect**. So Pro serves one team, not separate audiences:

| Role on a project | Who | What they do in Pro |
|---|---|---|
| **Can edit** | the in-house architect, and often the approval consultant | Everything. That includes **the quick look at a plot**: when a broker sends one, the architect runs the ten-minute check (Sites, the FSI ladder, the most the land is worth), then grows the same project into a full scheme. |
| **Can view and comment** | the developer, the land team, partners | Open the finished work, look at the options, **compare them and pick one**, and comment. On a computer or a phone. |

What follows from this:
- **There is no separate "buyer" product, and no third role.** Seeing the finished work is the viewer side: shared links, roles on the project, the phone viewer, and Compare made for a decision.
- **Looking at land stays in Pro, with the architect.** It needs a fast, rough mode: Sites, and a project at the Looking stage that becomes Designing without starting over. The developer sees the ranked Sites list and the figures.
- **The architect's own work moves up.** The typical floor and flat sizes come right after Options (§5, Phase 6), not "later".
- **Compare and the scorecard are for the decision.** They show plain side-by-side figures and a "pick this one" action (it marks the chosen option, which Approval then files). They're readable on a phone, and the phone viewer gets Compare.
- **Home buyers are out of scope here.** Selling to them (a brochure, renders, inventory) is the later live board shared by link, not part of Pro's structure.

---

## 2. The new shell

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◧ Tower plot, Baner ▾ │ Option B ▾ │ ● Saved   ⟲ ⟳   [Ctrl+K Search]   ◐◑ Comment  Share ▾ │  top bar
├────┬──────────────┬───────────────────────────────────────────┬──────────────┤
│Model│ OUTLINE      │  Built-up 1.2L · Homes 76 · Profit ₹8.7cr · IRR 14% · Rules 6✗  │ INSPECTOR     │
│Money│ ▸ Plot       │                                           │ (what's picked │
│Rules│ ▸ Roads      │                (the view)                  │  or, if nothing,│
│Opts │ ▾ Buildings  │                                           │  the project)  │
│     │   A Tower    │  shelf                         compass    │               │
│     │   B Slab     │                                           │               │
│     │ ▸ Site items │          view tools                       │               │
└────┴──────────────┴───────────────────────────────────────────┴──────────────┘
```

### 2.1 Lenses, not steps

The rail keeps its place and its icons, but holds **four lenses** on the same model. A lens changes three things:
- what the inspector shows when nothing is picked;
- what the view draws over the model;
- what the scorecard expands into.

None of them has Back or Next.

**Revised by §A.4:** the places are **Brief / Design / Numbers / Approval**, and Compare is a top-bar mode. The first table below is what replaced the first draft's Model / Money / Rules / Options.

| Place | Inspector with nothing picked | Drawn over the view | Replaces |
|---|---|---|---|
| **Brief** | the site gives (plot facts, rules, the permissible table); you want (typology, mix, flat sizes, height, the FSI ladder); make options | the permissible envelope (setbacks and height as a ghost volume) | Site › Rules, Allowed, Constraints; Scheme › Fill, Flat mix; Explore › Brief, Options |
| **Design** (default while Designing) | living, shops, parking, **Look** (the design system); with something picked, that thing (§2.2) | handles, guides | Site › Plot, Roads, Levels, On the site; Design; Scheme |
| **Numbers** | the area statement, the inventory, the money, the deal | each building tinted by profit per m², labels with revenue | Money |
| **Approval** | checks grouped by building, the permission, NOCs, fees, documents, the drawing set | each failing check pinned where it fails (setback lines, heights, fire access), Show frames it | Approval |

First draft, superseded:

| Lens | Inspector with nothing picked | Drawn over the view | Replaces |
|---|---|---|---|
| **Model** (default) | the project: rules and authority, the fill, living, mix, shops, parking, **Look** (the design system) | handles, guides | Site, Design, Scheme |
| **Money** | prices, land, the deal, costs, the statement, cash by month | each building tinted by profit per m², labels with revenue | Money |
| **Rules** | scrutiny grouped by building, the permission, NOCs, fees, documents | each failing check pinned where it fails (setback lines, heights, fire access), Show frames it | Approval (except its drawings) |
| **Options** | the options list and compare (§2.4), the brief, screening plots, the plotted layout | the picked option, or two side by side | Explore |

Screening moves to the dashboard's Sites (§A.4). The plotted layout becomes a scheme kind (§A.5).

The keys become: `1-4` for the places. `\` still shows and hides the side panels, and `/` still pins them.

Design moves into **Design › Look**:
- the inspector shows the preset, a few headline tokens, and the per-building override;
- "Open the builder" opens the full builder (designStep.tsx) as a large sheet, the same component the dashboard uses.

That keeps one builder and stops Look being a "step" you have to walk past.

### 2.2 The inspector (right)

One panel, fixed width (320 px). It's a drawer by default and pinned with `/`, using today's `Sheet`, moved to the right. What it shows follows the selection:

| Picked | Inspector |
|---|---|
| nothing | the lens's project settings (above) |
| a building | Name, Size (floors, length, depth, turn: the same typed fields as the HUD), Form (preset, the four sliders, By hand), Uses, Mix, Look (its own design system), Systems, Flat plans, the building's checks |
| the plot | size, corners (a table of x/z), roads by edge, levels, north, authority |
| a site element or feature | its own fields (today's objHud popover content) |
| several (Shift-click, see the editor plan's §4.1) | what they share, with mixed values shown as "—"; Align, Distribute, Remove |

**The HUD bar** in the view keeps only what you do with your hands: height, move, turn, duplicate and remove, plus the popover shortcuts. Its "Inspect" becomes "open the inspector".

**Fields** keep the `ui.tsx` primitives (`Num`, `Seg`, `Select`, `Section`). Sections fold, and what's folded is remembered per lens.

### 2.3 The outline (left, collapsible)

A tree of what's in the project:
- the plot;
- its roads;
- buildings, lettered as in `buildingName`;
- grounds and site elements;
- site features.

It works like a layers list:
- a click picks;
- a double-click frames;
- an eye hides it in the view;
- a lock stops picking;
- drag reorders buildings, which changes their letters;
- a warning dot shows on any item with a failing check.

It replaces the Scheme › Buildings list (sitePanels.tsx:306-317) and Site › On the site's list (162-165). It's collapsed by default below 1440 px wide.

### 2.4 Options, first-class

**The data.** `ProProject` gets `options?: { id, name, patch, scheme?, made: 'by hand' | 'brief' | 'explore', at }[]` and `option?: string`.
- An option holds what differs from the project's shared inputs: the plot, rules and prices stay shared, and the scheme, fill, mix, shops and look vary.
- It's stored in the same project JSON, so there's no new table (the cloud save in cloud.ts is unchanged).
- Undo history is per option.

**The top bar's option switcher** (`Option B ▾`) offers:
- Duplicate this option;
- Rename;
- Delete;
- Compare.

**Explore and the brief** add their results as new options ("Brief: best", "Explore 3"), never over the current one. "Use" becomes "Add as an option", and "Switch to it" is one click.

**Compare** shows two to four options in a table: Built-up, Homes, Profit, IRR, peak cash, height, failing checks and departures. Each column has a small render (`renderStill` at 400 px, cached by option and scheme hash). The best value in each row is marked. With two picked, the view splits in two with one shared camera (two `ProView`s, or one renderer with two scissor viewports; see §5, risks).

**Choosing.** Compare ends in **"Choose this option"**. The chosen option is marked in the switcher and on the dashboard card, and Approval files it. Viewers can't edit, but they can compare, comment and propose a choice; the owner confirms it. The phone viewer gets a compare view: two options, figures stacked.

**Narrowing many options.** When Explore makes more than about eight options, Brief › make options shows a **chart above the list**: profit against height, or parallel axes over profit, IRR, homes, height and failing checks. Dragging a range on an axis filters the list. Then pick up to four for Compare. This is TestFit's generative filter, cut down.

**Sharing and the phone viewer** share the current option. A shared link can carry `&o=` for one option.

### 2.5 The scorecard

The results bar keeps its five figures and deltas. Two changes:
- On click it opens a **drop-down breakdown** under itself (by building, by use, the deal). The lens changes only if you click "Open in Money".
- When options exist, a small **"vs A"** toggle shows each figure's difference from a pinned base option.

The Rules figure becomes a button with a count, and opens Approval.

### 2.6 The top bar

The new top bar, left to right:
- **Project switcher.** The name opens a menu: rename, recent projects (five), All projects (the dashboard), New project. This replaces the Projects dialog, so there's one projects list: the dashboard's.
- **Option switcher** (§2.4).
- **Save state**, then **undo and redo**.
- **Search** (Ctrl+K).
- **Presence**: avatars of people on the project now, when there are cloud accounts. A later phase; it needs a realtime channel.
- **Comment**: a mode where a click in the view drops a pin (§2.8).
- **Share ▾**: the one place for outputs (§2.7).
- **Account menu**: sign in or out, preferences (units sq ft / m², the quality default), Keyboard shortcuts, The simple editor. It replaces More.

**Team** goes into Share › People.

### 2.7 Share and export, one menu

| Item | Today |
|---|---|
| Link: people on the project / anyone with it | Share dialog (shareSheet.tsx) |
| People and roles | Team dialog |
| Image of the view (quick / path-traced) | Render-an-image menu (main.tsx:541-544) |
| Drawing set (open, PDF, print) | Approval › Drawings |
| Feasibility report PDF | Approval / Share |
| Model files: JSON, IFC, DXF | Scheme › Export, drawings |

Long jobs (path tracing, the PDF) show in one **jobs chip** by the save state. It has progress and cancel, and you can keep working while it runs. It replaces `still-prog`.

### 2.8 Comments where they belong

A comment has an anchor: a world point and the picked object's id, or a field's path (for example `inspector:building:3:mix`), plus the option it was made on.
- In the view, pins show with a count. Clicking one opens its thread in a popover.
- In the inspector, a field with comments shows a small dot.
- Open pins on the drawn buildings carry into the drawing set as numbered review clouds, with a list on the cover sheet. Arcol's comments don't carry into its sheets.
- The Comments list (moved out of Team) sits at the bottom of the inspector with nothing picked, filtered to open threads.
- The schema needs `anchor jsonb` on comments: one new migration, `0007`, after `0006_platform.sql`.

### 2.9 Search (Ctrl+K)

A palette over:
- **actions**: every keyboard shortcut, New option, Compare, Render, Export…;
- **objects**: "Building C", "the north road";
- **fields**: "parking type", "green share", "sale price".

Fields are found through a registry. Each `Section` and field registers its label, lens and path, and choosing one opens the inspector there, unfolds the section, focuses the field and flashes it.

It reuses the dashboard's `Palette` look (src/dash/main.tsx:150). The registry can be static: a hand-kept list in `src/pro/findable.ts`, checked by a test that every `Section` title is listed.

### 2.10 Starting a project

The Welcome dialog (main.tsx:741-760) goes. A new project opens with an empty plot outline and an **empty state in the view** offering four ways in:
- **Find on the map**: the survey number, or a place;
- **Draw it**;
- **Type its size**: today's three numbers, in-line;
- **Import**: GeoJSON, KML or corners.

These are the same actions as plotHud's `openWay`. Nothing pops up. A **help corner** (a `?` at the view tools' end) holds a short task checklist, which ticks itself as you go:
- set the plot;
- add a building;
- look at Money;
- make a second option;
- share.

It also holds the shortcuts and the guides (as Forma's Tasks does).

### 2.11 Width and density

| Width | Layout |
|---|---|
| ≥ 1440 | rail, outline, view, pinned inspector |
| 1100–1439 | rail, view, inspector as a drawer (outline in a popover from the rail) |
| 768–1099 (tablets) | today's narrow layout; inspector as a bottom sheet with detents |
| phones | unchanged: the view-only viewer (docs/plans/mobile-view-only.md). Its four sheets map onto the lenses: Overview = Brief and Design read-only, Money = Numbers, Rules = Approval, Share. |

**Floating clusters in the view** go down from seven to four:
- the scorecard (top);
- the shelf (left);
- the view tools (bottom), with the compass folded into the view tools' end;
- the HUD (on the object).

The drawhint joins the bottom tools as a state of the shelf.

**Focus mode** (Shift+\) hides the outline and the inspector, and keeps the scorecard, the shelf and the view tools. While it's on, picking something opens the inspector as a drawer, which closes again when you let go. This is Figma's Minimize UI.

---

## 3. References: how others do it

Researched from docs, release notes and reviews (Nov 2026).

**Gaps in the sources:**
- TestFit's help centre now needs a login, so its details come from search snippets.
- Nothing reliable was found on Archistar's or Hypar's panel layout.
- Onshape and Plasticity were not checked.

| Product | Shell | Options and compare | Metrics | Comments, search |
|---|---|---|---|---|
| **TestFit** | Navigation tree (left), properties that follow the selection, canvas, a data panel with tabs (Tabulations, Development, Schemes, Errors) | **Schemes** save a design with its financials, and a Schemes tab compares them. Generative mode filters solutions on a **parallel-coordinates graph**. | in the data panel | Its new UI "cut 60% of clicks" and launched behind a toggle. G2 reviewers split between "clunky, needs training" and "easy". |
| **Autodesk Forma** | Top-bar modes **Site Design / Compare / Board**. Left: Navigator (proposals on shared **bases**), Library. Right: analysis and properties on selection. View tools at the bottom right. | A **proposal** is a variant over a shared base (the context). **Compare** shows up to 6 side by side with synced scenes. | Area metrics in the right panel | **Quick access (Q)**: search actions and shortcuts. The help corner has a Tasks onboarding checklist. |
| **Archistar** | Generate many designs from the rules, then drag-and-drop edits | Not verified | Compliance checks and mix live; a feasibility calculator | In-app tours |
| **Giraffe v6** | **Dockable panels** of tabbed "apps" (Map, Layers, Properties, Analytics, Cash Flow). Saved layouts per project, with presets (Design, Map, Flow, Presentation). | Not verified | GFA, revenue and returns live as you draw | Viewers can't rearrange panels |
| **Snaptrude 3.0** | Top-bar modes **Program / Design / BIM / Present**. Views (left); Sustainability and **Comments** (right); nav and 2D/3D (bottom). | — | An Areas dashboard button | A **command bar**; comments jump to their place. **Present** builds sheets with live views. |
| **Arcol** | A toolbar whose **middle part follows the selection**; a metrics panel (right: GFA, FAR, units, parking, cost) | — | Always on, right | Shift+C comment bubbles on the canvas, a sidebar list, resolved ones hidden. Comments don't carry from boards to sheets. Live **Boards** shared to free viewers. |
| **Rayon V2** | **Fixed zones on purpose**: lists left, properties right, tools at the bottom | — | V3 adds a table panel | A command line; full shortcut coverage |
| **Figma UI3** | Layers left, properties right grouped by task, a floating bottom toolbar. Shift+\ shows properties only when something is picked; Ctrl+\ hides all UI. | — | — | **Actions (Ctrl+K)** over every command and setting. Users complained about the bottom toolbar covering the work, and about small, pale controls. |
| **Shapr3D** | Select first; the tools follow the selection. Spaces: Modeling / Visualization / 2D Drawings. | — | — | Shortcuts shown beside tool names |

**What this confirms in the plan:**
- **An inspector that follows the selection** and shows the project when nothing is picked: TestFit, Forma, Rayon, Arcol, Figma (§2.2).
- **Three to five modes over one model**, not separate apps: Forma, Snaptrude, Shapr3D (§2.1).
- **Options as variants over a shared base**, saved with their money: Forma's base vs proposal, TestFit's Schemes. For us, the base is the plot, rules and prices, and the proposal is the scheme (§2.4).
- **Compare as synced split views plus a metrics table**: Forma, TestFit (§2.4).
- **A command palette** that also shows shortcuts: Forma Q, Snaptrude, Rayon, Figma (§2.9).
- **Comment pins with a list beside them**, resolved ones hidden (§2.8).
- **Fixed zones, not dockable panels.** Rayon chose that on purpose. Giraffe's free layouts make "where is X" different for each person, which works against what we're fixing.

**What it adds** (folded into the plan below):
- **Filter options by outcome.** When Explore makes dozens of options, a parallel-coordinates chart (TestFit) or a scatter of profit against height, with brushing, narrows them to a few before Compare. → §2.4, Phase 4.
- **Focus mode.** Shift+\ hides the outline and inspector, and keeps the scorecard and the view tools (Figma, Giraffe). → §2.11.
- **A help corner with a task checklist** (Forma's Tasks) instead of a tour that pops up. → §2.10.
- **Comment pins carry into the drawing set** as review clouds, numbered. This avoids Arcol's gap. → §2.8.
- **A live board** (Arcol Boards, Snaptrude Present): a page of chosen views and figures that updates with the model, shared by link. It's a natural next step for the phone viewer and Share. → Phase 6.

**Anti-patterns to avoid:**
- Floating toolbars that cover the work, and small, pale controls (the Figma UI3 feedback).
- Properties panels where actions are buried and the grouping is unclear: keep the inspector's sections short and named by task.
- Stages that don't connect (Hypar admits theirs don't): every lens must act on the same model and the same selection.
- UIs that only work after training (the TestFit reviews): every gesture also gets a visible button, and the palette reaches everything.

---

## 4. Where each thing moves

| Today | New home |
|---|---|
| Site › Rules | Brief › the site gives; the plot bar’s authority chip |
| Site › Plot, Roads, Levels and north | the plot's inspector (plot picked); plot bar |
| Site › On the site | shelf (tools), outline (list), feature inspector |
| Site › Allowed, Constraints | Brief › the permissible table and the FSI ladder |
| Design (all 16 sections) | Design › Look (summary) and the builder sheet; the library on the dashboard |
| Scheme › Fill the plot, Flat mix | Brief › you want (the ladder replaces "How much") |
| Scheme › Living, Shops, Parking | Design inspector, nothing picked |
| Scheme › Buildings list | outline |
| Scheme › picked building card, Systems, Flat plans | building inspector |
| Scheme › Export the model | Share and export |
| Money (all) | Numbers, after the area statement and the inventory |
| Approval › Scrutiny, Permission, NOCs, Fees, Documents | Approval |
| Approval › Drawings and report | Approval, and Share and export |
| Explore › Brief, Options | Brief › make options; the option switcher and Compare |
| Explore › Screen many plots | the dashboard’s Sites |
| Explore › Plotted layout | a scheme kind (typology) |
| Projects dialog | project switcher plus the dashboard |
| Team dialog | Share › People; comments to pins and the inspector |
| More | account menu |
| Welcome | empty state in the view |
| Render an image, still-prog | Share and export; jobs chip |

---

## 5. Phases, biggest difference first

Each phase ships on its own and leaves Pro working. The order puts the **IA's missing nouns** first (§A): they change what Pro answers. The shell follows: it changes how Pro is laid out.

### Phase 1: The numbers everyone shares

- **The area statement view**: one live table of permissible (by part) vs proposed (by building and floor), carpet, saleable, and parking needed vs given. For now it opens from the scorecard, and the drawing set's sheet is printed from it.
- **The FSI ladder**: basic, premium, TDR, ancillary, each taken or left, with its area, cost and what it adds to profit. It replaces the "How much" slider. The generator takes a cap made of the chosen parts (sitePanels.tsx:147, src/doc/plot.ts:155-218, deal.ts:77).
- **The most the land is worth**: the land price solved for a target margin or IRR (the inverse of `applyDeal`), and the largest owner's share under joint development. It's shown on the scorecard when the deal's land price is empty.
- **Done when:** "is TDR worth buying here?" and "what can I pay for this land?" are each answered in one look; the area statement in Pro and on the drawing set match line for line.
- **Status (2026-11-22): built.**
  - **The ladder** lives in `ProProject.load`, src/pro/ladder.ts and `plotReport(p, floorH, all)`. It replaces Site › Allowed. "How much" is now "How much of it to build".
  - **What each part adds** is worked out a part at a time once the project settles. It's shown only for a scheme that Fill the plot lays out, not for buildings placed by hand.
  - **What the land is worth** comes from `landWorth` in deal.ts. It appears in Money, and as a Land worth figure on the scorecard while no land price is put in.
  - **The area statement** (src/pro/areaStatement.ts) opens from Built-up, and the drawing set's sheet prints the same rows.
  - **Not done yet:**
    - per-floor lines for buildings that aren't formed;
    - the stage-dependent scorecard (Phase 4).

### Phase 2: Find anything, one Share

- Ctrl+K palette: actions and objects first, then the field registry (`src/pro/findable.ts`, `src/pro/palette.tsx`).
- Share ▾ menu takes in Render an image, Export the model, the drawing set and People. There's one jobs chip.
- The account menu replaces More.
- The project switcher replaces the Projects dialog, and shows the project's stage (Looking, Designing, Applying).
- **Done when:** every output is under Share; "parking" in Ctrl+K lands on the field; the Projects dialog and More are gone.
- **Status (2026-11-22): built.** See docs/plans/pro-global-ux-log.md.

### Phase 3: The inspector

- The `Sheet` moves to the right and becomes the inspector, following the selection.
- The step bodies are split into project sections and object sections:
  - sitePanels.tsx's picked card becomes `inspector/building.tsx`;
  - its plot sections become `inspector/plot.tsx`;
  - objHud's popover fields become `inspector/object.tsx`.
- The HUD's Inspect opens the inspector.
- **Done when:** with a building picked, every one of its settings is in the inspector, and nothing project-wide is there.
- **Status (2026-11-22): built, in one file.** The step's sheet stays on the left, and the inspector is a second panel on the view's right (src/pro/inspector.tsx). Building, plot and object sections are its three parts, not three files. See docs/plans/pro-global-ux-log.md.

### Phase 4: Brief, Design, Numbers, Approval

- The rail becomes the four places (§A.4). Back and Next are removed. The keys become `1-4`.
- Brief takes in the site's rules, the ladder, the mix and typology, and the brief text with Explore.
- Design takes the plot, the site and Look (with the builder sheet).
- Numbers opens on the area statement, then the inventory (read-only at first), then the money.
- The overlays in the view:
  - the permissible envelope in Brief;
  - the profit tint in Numbers;
  - check pins in Approval (`checkBuilding`, viewer.tsx).
- The project's stage picks where you land and the scorecard's figures.
- The old `urbanplan:pro:step` values and `step=` links map to the new places, with a one-time note.
- **Done when:** the six steps are gone; picking Building B and moving between places keeps B in focus everywhere.
- **Status (2026-11-22): built, with two overlays left.**
  - The four places are in src/pro/places.tsx.
  - The Site and Scheme sections are split between Brief and Design by a `part`, and Explore sits under Brief.
  - Look opens the design system in a sheet.
  - The area statement heads Numbers.
  - Approval pins its checks on the view.
  - The stage picks where you land and the scorecard's figures.
  - **Not done yet:**
    - the permissible envelope in Brief;
    - the profit tint in Numbers;
    - the inventory in Numbers.
  - See docs/plans/pro-global-ux-log.md.

### Phase 5: Options and Compare

- The `options` data and the switcher are added. Explore and the brief add options. Undo is per option.
- Compare is a top-bar mode: the figures from any place side by side, thumbnails, then the split view. The filter chart appears when there are many options.
- The scorecard gets "vs A". A shared link takes `&o=`.
- **Done when:** a brief adds three options, two are compared side by side, and nothing you had is lost.
- **Status (2026-11-23): built, without the pictures.**
  - Options are in src/pro/variants.ts. src/pro/options.ts stays Explore's engine.
  - The switcher sits in the top bar.
  - The brief and Explore add options instead of replacing the current one.
  - Compare is a table, with Choose.
  - The scorecard has a "vs" toggle, and shared links take `&o=`.
  - **Not done yet:**
    - thumbnails in Compare;
    - the split view;
    - the filter chart for many options;
    - undo kept separately for each option;
    - the chosen option on the dashboard card.
  - See docs/plans/pro-global-ux-log.md.

### Phase 6: The architect's floor: the typical floor and flat sizes

- **Flat types with sizes**: carpet per type (1, 2, 3 BHK…), set in Brief › you want (the project's default) and per building in the inspector. The generator lays flats out to those sizes, and the inventory (Numbers) becomes editable.
- **The typical floor as an object**: pick a floor band in the outline or the X-ray. The inspector shows flats per floor, their types and sizes, the core (stairs, lifts) and the floor's efficiency (carpet ÷ built-up). Change them, and every floor in the band follows.
- **Done when:** "2BHK at 650 sq ft carpet, 6 flats a floor" can be set on Building A, and the area statement, inventory and money follow it.
- **Status (2026-11-23): built, without picking a floor band.**
  - Flat sizes are in Brief › Flat sizes (the project's) and in the inspector, "Its own flat sizes" (a building's). The layout cuts flats near them.
  - The inspector's Typical floor shows flats a floor by type, carpet each against the size asked, cores, the floor's area and carpet, efficiency, and how many floors are like it.
  - A straight building can be fitted to a number of flats a floor ("Fit its length").
  - Numbers › Inventory lists every flat by building and type, with its value at the sale price.
  - **Not done yet:**
    - picking a floor band in the outline or the X-ray;
    - flats a floor on a formed (hand-shaped) building: its plan sets them;
    - editing sizes in the inventory itself (it links to Brief).
  - See docs/plans/pro-global-ux-log.md.

### Phase 7: Sites, above projects

- The dashboard gets **Sites**:
  - paste, or add from the map;
  - quick figures under the firm's default prices (potential, saleable, the most the land is worth);
  - a status per site;
  - "Open as a project", which starts at the Looking stage.
- Viewers see the ranked list.
- It's local first, with Supabase later, as with design systems. "Screen many plots" leaves Explore.
- **Done when:** twenty pasted plots are ranked by what the land is worth, and the best opens as a project with its plot and road set.
- **Status (2026-11-23): built, without the map.**
  - The dashboard has **Sites** (src/dash/sites.tsx, src/pro/sites.ts): paste plots or add one; each gets its potential, saleable carpet, homes, the most the land is worth outright (in all and per sq ft of plot) and the largest joint-development share, under the firm's default prices (rules, sale price, target margin or IRR).
  - Ranked by what the land is worth; a status per site (lead, looking, offered, bought, dropped) with a filter; an asking price is underlined when it's over what the land is worth; CSV.
  - "Open" starts a project on the plot, at the Looking stage, in Brief, and moves a lead to Looking.
  - Explore's "Screen many plots" now points to Sites.
  - **Not done yet:**
    - adding a plot from the map;
    - viewers seeing the list (it's kept in this browser: Supabase later, like design systems);
    - plots other than a rectangle on one road (corner plots, drawn outlines).
  - See docs/plans/pro-global-ux-log.md.

### Phase 8: The outline, comments in place, the empty state

- Outline panel: hide, lock, reorder, warning dots.
- Comment anchors (migration 0007), pins in the view and on the drawing set, and field dots. The Team dialog is removed.
- The empty state in the view replaces Welcome; the help corner's checklist.
- Density: the compass goes into the view tools, the drawhint into the shelf, and focus mode is added.
- **Done when:** a comment dropped on Building B shows on B for a teammate; a new project starts without a dialog.

### Later: the plotted layout, presence, a live board

- The plotted layout as a full scheme kind.
- Realtime presence (a Supabase Realtime channel per project).
- A **live board** shared by link: chosen views, figures and the chosen option on one page. It's what a phone opens first, and later the sales brochure for home buyers.

---

## 6. Risks and open questions

- **Split-view compare and render cost.** Two shaded views halve the frame rate.
  - Start with the compare table and thumbnails, and add the split view only behind the Wireframe mode, or at the "low" tier.
  - Measure against docs/plans/render-benchmark.md.
- **Options and undo.** Today `past` and `future` hold whole projects (main.tsx). Per-option stacks are simplest, but they mean switching options keeps each stack. Cap at 50 steps each.
- **Shared inputs vs option inputs.** Is the land price per option (a different deal) or shared? Proposal: the deal and prices are shared, and only the scheme side varies. **Decision for you.**
- **Design in the dashboard vs Design › Look.** Keep the one builder component. In Pro it edits the project's copy, and in the dashboard the library entry (as today).
- **Place names.** Brief / Design / Numbers / Approval (§A.4) replace the first draft's Model / Money / Rules / Options, and "Approval" is kept for the Indian approval audience.
- **Learned habits.** Keys `1-6` and the step names are in muscle memory and in shared links (`step=`). Map the old values, and show a one-time note: "Steps are now lenses: Site, Design and Scheme are all in Model."
- **Accessibility.** The F6 regions become: top bar, rail, outline, view, inspector. Every new popover gets focus in and back, like `Sheet`.

- **Who Pro is for.** Decided (§A.8): one developer team. The architect edits, including the quick look at a plot; the developer and the land team view, compare and choose.
- **The brief: shared or per option?** Proposal: the site and the deal are shared. The brief has a shared default, and an option may override it (so "A: all TDR" vs "B: basic only" can be compared).
- **The FSI ladder vs the generator.** Today the generator fills to a share of the whole permissible area. A ladder needs it to fill to a cap made of chosen parts, and to say which parts the drawn scheme used. Test against today's figures before switching.

## Critical files

- src/pro/main.tsx: the shell, keys, dialogs, results bar
- src/pro/sheet.tsx: becomes the inspector's container
- src/pro/steps.tsx, sitePanels.tsx, shapePanel.tsx, designStep.tsx: split into lens and inspector sections
- src/pro/hud.tsx, objHud.tsx, plotHud.tsx, formHud.tsx: the in-view bars, slimmed
- src/pro/project.ts: `options`, `option`
- src/pro/shareSheet.tsx: grows into Share and export
- src/pro/scene.ts: split view, overlays per lens
- src/pro/viewer.tsx: the phone viewer, mapped to lenses
- src/dash/main.tsx: `Palette`, the projects list the switcher links to
- supabase/migrations: `0007` comment anchors
