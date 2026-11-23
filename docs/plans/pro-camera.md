# Pro: the camera on interactions

**Status (2026-11-23): built, all four steps, with (b): OrbitControls extended (zoom to the cursor, limits and ground pan are its own options; the pivot is ours). See docs/plans/pro-global-ux-log.md.** Not yet tried with people (§6). It draws on two sources:
- what the camera does today (src/pro/scene.ts, src/pro/main.tsx);
- research on how comparable tools move it: Forma/FormIt, SketchUp, Revit, Navisworks, Blender, Unity, Unreal, Figma, Spline, Google Earth and Maps, Mapbox, Cesium and ArcGIS. The sourced notes are in docs/plans/research/camera-interaction-notes.md.

**The recommendation, in one line.** The camera moves only when you move it or ask it to move. When it does, it gets there in a quarter to half a second and stops the moment you touch the view. Orbit and zoom work around what's under the pointer, not a hidden centre. Opening a panel never slides the view out from under you.

---

## 1. What the camera does today

| Interaction | What happens | Where | Verdict |
|---|---|---|---|
| **Pick a building** (click) | Nothing on its own. But the pick opens the inspector, which moves the view (next row). | edit.ts `down`/`upE` | Right, apart from the panel shift. |
| **A panel opens or closes**: inspector (344 px), outline (248 px), report (up to 460 px), sheet | `setCover` sets a view offset at once, so the whole picture jumps sideways or up by half the panel. The building you just clicked slides from under the pointer. | scene.ts:300 `setCover` / `applyCover` | **The worst one.** It happens on every pick and on every N/A/O/1. |
| **Drag in the view** (left) | Orbits around `controls.target`, which is whatever the last look or focus set. | OrbitControls defaults | The pivot is invisible and often not what you're looking at. After a pan it can sit in the air. |
| **Right-drag** | Pans in the screen plane, so the target drifts up and down off the ground. | `screenSpacePanning = true` | Map tools and Forma grab the ground instead. |
| **Wheel** | Dollies toward the target, not the pointer. With no minimum distance, it slows to a crawl near the target and can go through a building. | `zoomToCursor` off; no `minDistance`/`maxDistance` | Every tool surveyed zooms toward the cursor, by default or as a popular option. |
| **Whole site / street / above** (F, S, T, toolbar, More) | Jumps at once. | scene.ts `look` | Fine, but abrupt. Tools animate these for 200 to 500 ms. |
| **Plan ↔ 3D** (P, toolbar) | Plan: jumps to the ortho top. Back to 3D: `look('fit')`, so **the 3D view you had is lost**. | scene.ts `setPlan` | It should come back to where you were. |
| **Show a building** (search, a check, the area statement, the checklist, the outline's Show) | Animates 380 ms, ease-out cubic, and respects reduced motion. Keeps the viewing direction; distance is about 1.7 × the building's size. | scene.ts `focus` | Good, but grabbing the view mid-move fights it (the animation keeps writing the camera). |
| **Outline double-click** (plot, element, feature) | The same `focus` on its ring. | main.tsx `frameRing` | Good. |
| **Open a project / site / template** | `fitSoon` → whole site, at once. | main.tsx | Right. |
| **Switch an option, Generate, undo** | No move. | n/a | Right, and should stay so. |
| **Drag a building near the edge** | No auto-pan. | n/a | Right. No mainstream 3D tool documents one. |
| **Phone** | One finger orbits; two fingers pinch and pan. | OrbitControls touch | Fine for a view-only phone. |

## 2. What the research says (the parts that decide things)

1. **Selecting never moves the camera.** Framing is a command: F (Unity, Unreal), Numpad . (Blender), Shift+2 (Figma), Zoom Selection (SketchUp, FormIt). Figma users asked for auto-zoom on select for years and got only a hidden opt-in.
2. **User input always wins.** Mapbox stops any running `easeTo`/`flyTo` on a gesture. Google's 3D Maps stops on click.
3. **Programmatic moves are short.** Blender's `smooth_view` is 200 ms. Mapbox `easeTo` is 500 ms with CSS "ease". Long flights scale with distance and are capped (`maxDuration`). Reduced motion turns them into jumps (Mapbox, ArcGIS).
4. **Wheel zoom goes toward the cursor.** Zooming at a fixed target stalls near it, which is a standing Blender and Rhino complaint.
5. **The top complaint is orbiting about the wrong point**, so the model swings off-screen. Tools that orbit about the point under the cursor (FormIt; Rhino and Blender options) or show their pivot (Navisworks' sphere) avoid it.
6. **Panels:** map tools frame into the visible area with padding. When a panel slides in, Mapbox eases the padding in step with the panel, or applies it only at the next framing (Google). Nobody jumps the picture.
7. **Plan is a snap view.** The orientation may animate; the projection switches at once.

## 3. The rules for Pro

1. **Nothing moves the camera but you and your commands.** A pick, an edit, an option switch, Generate, undo, a panel and a report never move it. The commands are Whole site, street, above, Plan/3D, Frame (new, below), Show from search or a check or the area statement, and a project opening.
2. **A panel changes where the middle is, not what you see.** When a panel opens, what's on screen stays put; only later framing aims at the visible middle. One exception: if the picked thing ends up entirely under the panel, it eases out from under it.
3. **Every move a command makes is animated, short and interruptible.**
   - **Duration:** 280 ms for a nudge, up to 600 ms for a long trip (scaled by distance, capped).
   - **Easing:** ease-out.
   - **Interruption:** any pointer-down, wheel or key on the view stops the move where it is.
   - **Reduced motion:** the move is a jump.
4. **Orbit and zoom work around what you point at.**
   - **Wheel:** zooms toward the pointer.
   - **Drag:** orbits about the point under the pointer when it starts on a building or the ground; on the sky, about the current middle. A small dot marks the pivot while you orbit.
   - **Right-drag:** pans across the ground, so the camera height stays put.
5. **The camera can't get lost.**
   - **Nearest:** about 3 m from what's under the pointer.
   - **Farthest:** about 12 × the site.
   - **Lowest:** never below the ground (as today).
   - **Getting back:** "Whole site" is always one key away.

## 4. The interactions, one by one

| Interaction | New behaviour |
|---|---|
| Click to pick | No camera move (as today). The inspector opens with no shift of the picture (rule 2). |
| Drag on what's picked | Moves it (as of step 7); the camera stays. |
| Drag on anything else | Orbits about the point under the pointer, with the pivot dot. |
| Right-drag, or Shift+drag | Pans across the ground. |
| Wheel / trackpad pinch | Zooms toward the pointer, slowing within a few metres of a surface and stopping there. |
| **F** | **Frame what's picked**; with nothing picked, the whole site (the Unity/Unreal convention). The toolbar's "Whole site" stays whole site. |
| **Double-click a building** | Frames it (and picks it). Double-click on open ground frames the whole site. While drawing, double-click still finishes the shape. |
| S / T, More → street, above | Animate there (400 to 600 ms). |
| P (Plan) | Animates the camera to straight down (300 ms), then switches to the plan at once. Back to 3D returns to **the 3D view you left**, animated. Fit only if you've never been in 3D this session. |
| Show from search, a check, the area statement or the checklist | As today (keeps the viewing direction), now interruptible and aimed at the visible middle. |
| Outline double-click | As today, the same improvements. |
| Open a project | Whole site, at once (no animation on load). |
| Options, Generate, undo/redo, the fill changing | No move. A new option that puts buildings off-screen says so in its toast ("2 buildings are outside the view · Whole site"). It doesn't fly there. |
| Panel open/close (inspector, outline, report, sheet) | Rule 2: the picture holds still. If the pick is now hidden, it eases out by the smallest move (280 ms). |
| Dragging near the view's edge | No auto-pan (unchanged). |
| Phone (view-only) | One finger orbits, two fingers pinch, pan and twist (as today). **Double-tap** frames what's tapped. |

## 5. How to build it

**The one real decision: the controls.** OrbitControls can't orbit about an arbitrary point without the view jumping, because changing the target re-aims the camera. Two ways to fix that:
- **(a) Adopt yomotsu/camera-controls** (MIT, about 30 kB). It has built-in transitions and `setOrbitPoint` (move the pivot without moving the view), plus `dollyToCursor`, `fitToBox` with paddings, boundaries and collision. It replaces OrbitControls in scene.ts; edit.ts's `controls.enabled` toggles map across directly.
- **(b) Extend OrbitControls by hand.** On pointer-down, move the target to the hit point and shift the camera by the same vector so nothing moves on screen. Then add our own tween, zoom limits and ground pan.

**Recommended: (a).** It's a maintained library, and it covers rules 3 to 5 with options rather than code we'd own.

**Steps, each shippable on its own:**
1. **Panels hold the picture still (medium).**
   - When the cover changes, move the camera so the old picture stays where it was on screen while the view offset changes (the cover still centres later framing).
   - If the pick is now fully covered, ease it out by the smallest move.
   - This is the biggest felt fix, and it doesn't depend on the controls decision.
2. **One camera mover (small).**
   - A `fly(to, opts)` in scene.ts that `look`, `focus`, `setPlan` and framing all go through.
   - Distance-scaled duration (280 to 600 ms), ease-out, stopped by any input on the view, a jump with reduced motion.
   - Plan ↔ 3D remembers the 3D camera.
3. **The controls (medium).**
   - Swap to camera-controls (or extend, per the decision).
   - Zoom toward the pointer; orbit about the point under the pointer, with the pivot dot; pan across the ground; near and far limits.
4. **Framing commands (small).**
   - F frames the pick, else the site.
   - Double-click a building frames it; double-click open ground frames the site.
   - Double-tap on a phone.
   - The off-screen note on a new option.
   - Update the shortcuts list and the help corner.

## 6. How we'll know it's right

**Hands-on checks** (in the browser, as each step lands):
- **Picking:** pick a building with the inspector closed. Its pixels don't move when the inspector opens (within 2 px).
- **Reports:** press N, then A, then Esc. The picture doesn't move.
- **Orbit pivot:** orbit from a point on a tower's roof. The roof point stays under the pointer while the scene turns around it.
- **Zoom:** wheel toward a window. It gets nearer the window, slows, and stops about 3 m short. It never goes inside.
- **Interrupting:** press S, then drag in the middle of the move. The move stops where it is and the drag orbits from there.
- **Plan and back:** set a 3D view, press P, then P again. You're back in the same 3D view.
- **Reduced motion:** turn it on. Every command jumps.

**With people** (the rethink's 15-minute session): after 5 minutes of free orbiting and moving, ask "Did the view ever move when you didn't expect it?" **Pass:** 4 of 5 say no, and nobody loses the model (needing Whole site to recover counts as losing it).

## 7. Left out on purpose

- **No auto-zoom or auto-centre on pick:** no surveyed tool does it, and Figma's users only got it as an opt-in.
- **No edge auto-pan while dragging** (not a 3D-tool convention), and no free tumble (the horizon stays level).
- **Saved views, a view history (Back) and a ViewCube:** possible later. The research found them common in CAD, but Pro's three named views and Frame cover the need for now.
