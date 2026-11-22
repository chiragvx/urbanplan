# Phones are for looking and sharing

**Goal:** on a phone, UrbanPlan is a viewer. People open their projects (and the ones shared with them), look round them in 3D, read the numbers, and share them. Nothing on a phone creates, changes, moves or deletes anything. Editing happens on a computer (or a tablet).

**Why:** editing on a phone is cramped and error-prone, and keeping every editor working at 375 px costs effort on each feature (the phase 5 bottom sheet, drawing tools lowering it, touch handles). A viewer is easy to get right and is what people actually do on a phone: show a client, check a figure, send a link.

---

## 1. What counts as a phone

**One test, in one place:** a new `src/device.ts` exports `isPhone()` and a `usePhone()` hook (moved from src/pro/sheet.tsx).

```
phone = (pointer: coarse) and the screen's shorter side < 600 CSS px
```

- It uses `screen.width` / `screen.height`, not the window, so rotating the phone keeps it a phone. A narrow desktop window stays an editor.
- Tablets (shorter side 600 or more: iPad, most Android tablets) keep the editor as it is.
- **Override:** `?edit=1` turns the check off for that tab (kept in sessionStorage), for support and for testing. It isn't linked anywhere.
- The CSS `max-width: 900px` rules stay for layout only. They no longer decide what someone may do.

## 2. Pro (/pro/) on a phone: the viewer

### One flag for "can change it"
- Today read-only is two flags (`readOnly` from a share link, `viewer` from the cloud role), and only `readOnly` guards `up()`, `tx.begin` and the keys.
- **Replace them with `const locked = readOnly || viewer || phone`**, checked in:
  - `up()`
  - `tx.begin`
  - `replace()`
  - undo and redo
  - every key that changes something (Ctrl+D, R, +/−, M, Ctrl+Z/Y)
  - the project name field
  - autosave
  - the HUDs
  - the Shelf
  - the compass dial
  - the sheet's fieldset
- **This also fixes an existing gap:** a cloud viewer can currently still change the project with `up()` and the keyboard. It isn't saved, but the screen shows it.

### Picking still works, editing doesn't
- Today CanvasEdit's `readOnly()` blocks every pointerdown (src/pro/edit.ts:474), so read-only can't even select a building.
- **Split it into `canPick()` and `canEdit()`.** On a phone a tap selects a building, but no handle, drag, draw or delete runs.
- A selected building shows an **info card, not the edit bar:**
  - its name, floors, height and built-up area;
  - its homes by type (the flat mix) and its uses by floor;
  - its rule checks, pass or fail;
  - "X-ray it" (jumps the floor slider to it).

### What the screen holds
- **Top bar:** the logo (to the dashboard), the project name (text, not a field), **Share**, and a menu (Projects, Sign in/out).
  - Gone from the top bar: Undo/Redo, Team management and "Make it my copy". A share link on a phone is just viewed; "Make it my copy" appears on a computer.
- **The 3D**, full screen, with:
  - **kept:** orbit/pinch, 3D/Plan, wireframe/shaded, X-ray with its floor slider, the sun with month and time, and the camera buttons (whole site, street, from above);
  - **dropped:** snapping and the tool shelf.
- **The results bar**, as it is. Tapping a figure opens its sheet.
- **The steps bar becomes four read-only sheets:**
  - **Overview:** the plot (area, road, authority), what's built (buildings, floors, homes, built-up vs allowed), and the design system's name and swatches.
  - **Money:** profit, margin, IRR, peak cash, sales and costs, read-only.
  - **Rules:** the scrutiny list with Show, and the permission path.
  - **Share** (§4).
  - The six editing step bodies (Site, Design, Scheme, Explore) aren't loaded on a phone at all. That also keeps the phone bundle smaller, because those step bodies are dynamically imported.
- **Gone on a phone:**
  - the Welcome dialog (it makes a new project);
  - New project in the menu;
  - the link to /app/;
  - the brief and options;
  - "Render an image" (path-traced is too heavy on a phone; the raster image moves into Share);
  - the keyboard map.
- **The bottom sheet:** keep the phase 5 sheet with its three heights. Drop the "a drawing tool lowers it to a peek" logic, since there are no tools.

### Ways into Pro that create something
- `/pro/?new=…`, `?ds=…` and `template:…` on a phone don't create anything. They open the dashboard with a note: "New projects are started on a computer. We'll keep your projects here to view and share."
- `/pro/?local` with no saved project shows the sample, read-only, with that same note.

## 3. The dashboard on a phone

**It keeps:**
- **Home:** recent projects, as cards.
- **Projects:** mine, shared with me and this browser's local one; search; folders as filters (read-only).
- **Each card:** **Open** (Pro, viewer) and **Share**.

**It hides:**
- New project and the start tiles;
- Rename, Move to folder, Star, Archive, Delete, Make a copy and Download;
- folder create/delete;
- the Design systems tab and builder (or a read-only list with swatches, and no "New design system");
- team management.
- A line at the top explains: "On a phone you can open and share your projects. Create and edit them on a computer."

**Card Share** opens the Share sheet (§4) without opening the project first:
- the team link needs only the id;
- the public `#s=` link loads the project with `openPro(id)`, then `encodeShare`.

## 4. Share, made for a phone

One Share sheet, used by Pro and the dashboard:
- **Native share first:** `navigator.share({ title, text, url })` when it exists. The phone's own sheet covers WhatsApp, Mail, Messages, Slack and so on.
- **Fallbacks:** Copy link, and WhatsApp (`wa.me`), as now.
- **Which link:**
  - **"Anyone with the link"**: the `#s=` link (opens read-only). This is the default for a local project or a share link.
  - **"People on the project"**: the `?p=` project link. This is the default for a cloud project the person owns or edits.
- **An image of the view:** the raster render at phone size (about 1600 px), shared as a file through `navigator.share({ files })` where `canShare` allows it, otherwise downloaded.
- **The drawing set PDF:** kept as "Share the drawings (PDF)". It's generated on the phone, so it may be slow on big schemes; it shows progress and can be cancelled.
- **Inviting someone by email: not on a phone.** That's managing the team. "Invite people from a computer" sits next to the project link.

## 5. The simple editor (/app/) on a phone

- **`?map=<url>`:** opens in its existing view mode (`readOnly` signal). "Edit a copy" (`file.fork`) is hidden on a phone.
- **No map given:** a short screen: "The map editor works on a computer," with links to the dashboard and to the gallery of published maps (view mode).
- **Its own Copy link** is replaced by the same native share call.

## 6. The website

- CTAs that start a project ("Try it", template pages' "Use this template", "Size up a plot") point a phone to the dashboard (sign up / sign in) instead of `/pro/?new=…`.
- The CTA reads "Open your projects" or "Sign up", with one line saying editing is on a computer.
- The DP report viewer (`pune/dp-map/`) is already a viewer and stays.

---

## Phases

1. **The phone test and the one lock.**
   - `src/device.ts`.
   - `locked` in Pro covering `up` / `tx` / keys / name / autosave / HUDs / shelf / dial (this fixes the cloud-viewer gap on every device).
   - CanvasEdit split into `canPick` / `canEdit`.
   - Pro's creating ways in sent to the dashboard on a phone.
   - Small. Safe to ship alone: a phone already can't edit after it.
   - **Status (2026-11-22): built.**
     - src/device.ts: `isPhone()` / `usePhone()`, with the `?edit=1` / `?edit=0` override.
     - The sheet's own narrow-screen hook is renamed `useNarrow`, since it is about layout only.
     - In Pro, `locked` guards up, tx, undo/redo, the keys, the name, autosave, the HUDs, the Shelf, the dial and the fieldset.
     - CanvasEdit's read-only mode now picks on a tap: a building, else an element, else a feature, else nothing.
     - On a phone:
       - `?new` (and the template and design-system starts under it) goes to the dashboard;
       - no Welcome dialog;
       - More holds only "Your dashboard";
       - the Projects dialog has no New or Delete;
       - Team and "Make it my copy" are hidden;
       - a note in the sheet explains it.
     - Done differently: the note in the sheet stands in for the dashboard note until phase 4.
     - Not yet: anything shown for a picked building (phase 2's info card).
2. **The Pro viewer.**
   - The four read-only sheets (Overview, Money, Rules, Share).
   - The building info card on a tap.
   - The trimmed top bar and menus.
   - The step bodies dynamically imported, so a phone never loads them.
   - **Status (2026-11-22): built, in src/pro/viewer.tsx and main.tsx.**
     - A phone's steps bar is Overview, Money, Rules and Share.
     - Overview: the plot, what's built, the flat-mix bar and the design system's swatches.
     - Money: result, by use, in and out, the landowner.
     - Rules: the scrutiny with Issues/Everything and Show.
     - A tapped building's card in the sheet: floors, built-up, homes by type, floors by use (each opens X-ray there), its flagged rules, and X-ray it.
     - The result bar's figures land on the matching sheet.
     - The Render menu and snapping are hidden; the image is in Share.
     - Not done: the step bodies aren't dynamically imported yet (a phone still downloads them, it just never shows them).
3. **Share.** The shared Share sheet with `navigator.share`, link choice, the image file and the PDF, used from Pro first.
   - **Status: built, in src/pro/shareSheet.tsx.**
     - It replaces the old Share dialog on a computer too.
     - The device's share sheet where there is one, else Copy link and WhatsApp.
     - People on the project (the ?p= link, for an owner or editor) or anyone with the link (#s=).
     - "Share an image of the view": a 1600 px render, shared as a file where the device can, else saved.
     - The PDF on a phone is the drawing set's download, not a shared file.
4. **The dashboard on a phone.** Cards with Open and Share only, the hidden actions, the Designs tab, the explaining line.
   - **Status: built, in src/dash/main.tsx.**
     - Home, Projects, Activity and Settings only. #/designs and #/team land on Home.
     - No New project, start tiles, Import, the N key, the palette's New, folder create/delete or the Archive filter.
     - Each card's menu has Open and Share; this browser's project has them too.
     - Card Share is also added on a computer.
     - A cloud card's anyone-link loads the project first. That isn't tested here (no accounts on localhost).
5. **/app/ and the website.** /app/'s phone screen and view mode; the site's CTAs.
   - **Status: built.**
     - /app/ on a phone without ?map shows "The map editor works on a computer" with links to the dashboard and home.
     - With ?map it opens view-only, even a map that's the person's own.
     - New map and Edit a copy are refused; the map's Copy link uses the device's share sheet.
     - On the website, a phone tapping a link that starts a project goes to the dashboard.
     - Done differently: the CTAs' wording is unchanged.
6. **Clean-up and a real phone.**
   - Remove phone-only editing code that no longer runs: drawing tools lowering the sheet, coarse-pointer handle sizes in the HUDs, `.hstrip` touch tweaks.
   - Test on a real Android phone and an iPhone: share sheet, pinch, rotation, the PDF on a big scheme, safe areas.
   - **Status: nothing removed.**
     - The narrow-screen editing code (drawing tools lowering the sheet, coarse-pointer handle sizes) still runs on tablets in portrait, which edit.
     - Not done: the real-phone pass. Everything was checked at 375 px in a desktop browser emulating a phone, where `navigator.share` isn't offered.

## Files

| Area | Files |
|---|---|
| Phone test | new `src/device.ts`; `src/pro/sheet.tsx` (usePhone moves out) |
| Pro lock and viewer | `src/pro/main.tsx`, `src/pro/edit.ts` (canPick / canEdit), new `src/pro/viewer.tsx` (Overview, Money, Rules, the info card), `src/pro/steps.tsx` (Money/Rules reused read-only), `src/pro/pro.css` |
| Share | new `src/pro/shareSheet.tsx` (from ShareDialog in main.tsx), `src/pro/share.ts` |
| Dashboard | `src/dash/main.tsx`, `src/dash/data.ts`, `src/dash/dash.css` |
| /app/ | `src/app/app.ts`, `src/editor/commands.ts` (hide `file.fork` on a phone) |
| Website | `src/site/routes.ts` and the CTA components |

## Risks and decisions

- **A phone user with only a local project** (made earlier on the phone, under the old behaviour) can still see and share it. It isn't lost.
- **Signed-out phone users** see the sample and their local project. Cloud projects need sign-in, as now.
- **Someone who needs one quick fix on a phone** (a typo in the name) can't make it. This is accepted: the point is one clear rule. `?edit=1` exists for support.
- **Big tablets in portrait** (shorter side 600 or more) still edit. Small Android tablets under 600 count as phones.
- **The PDF and image on low-end phones** may be slow or run out of memory. Show progress, allow cancel, and cap the image size.
- **Not in scope:** comments on a phone (they could come later as "view and comment", since commenting is a kind of sharing), and an installable app (PWA).
