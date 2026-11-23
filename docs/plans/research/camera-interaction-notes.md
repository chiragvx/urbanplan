# Camera interaction in 3D design and mapping tools: research notes

Researched 2026-11-23. Each claim carries a source. Tags:
- **[doc]**: stated in official docs, help centre, API reference or source code.
- **[forum]**: a user or community report, not official.
- **[inference]**: my reading or general knowledge, not confirmed by a page fetched for these notes.

Coverage gaps, stated up front:
- **Autodesk Forma:** I found no public Forma navigation page. FormIt, Autodesk's related conceptual modeller, is used as the nearest proxy and flagged as such.
- **Archistar and TestFit site solver:** no camera documentation found.
- **Snaptrude:** only a release note.

---

## 1. Orbit pivot

| Tool | Pivot rule | Source |
|---|---|---|
| FormIt (Forma proxy) | Right-drag orbits "using your cursor point in 3D space" as the pivot. Shift turns the drag into pan. [doc] | https://windows.help.formit.autodesk.com/formit-introduction/navigating-the-scene |
| SketchUp (desktop) | Orbit tool rotates "around the center of the drawing area" [doc]. Users report that in practice the pivot depends on what is under the cursor at the start of the drag; clicking off-geometry can throw the pivot far away [forum]. There is no orbit-around-selection, a long-standing request [forum]. | https://help.sketchup.com/en/sketchup/viewing-model · https://forums.sketchup.com/t/orbit-about-selection-orbit-about-mouse-point/229903 · https://forums.sketchup.com/t/orbit-tool-pivot-point-when-clicking-outside-geometry/58760 |
| SketchUp for Web | Middle button = orbit, middle+left = pan, wheel = zoom. [doc] | https://help.sketchup.com/en/sketchup-web-shortcuts |
| Blender | Default orbit is around the view centre. The "Orbit Around Selection" preference makes the selection centre the pivot: object mode uses the bounding-box centre, edit mode the selected elements, paint modes the last stroke. With nothing selected it keeps the last selection. [doc] "Auto Depth" uses the depth under the mouse for pan, rotate and zoom. [doc] Alt-MMB click sets the point of interest. [doc] Both options are off by default. [inference] | https://docs.blender.org/manual/en/latest/editors/preferences/navigation.html · https://docs.blender.org/manual/en/latest/editors/3dview/navigate/navigation.html |
| Rhino 8 | Default rotation is about the camera target (world axes). Rotating about the object under the cursor is an *Advanced* setting, `RotateViewAroundObjectAtMouseCursor`, off by default. `RotateViewAroundAutoGumball` orbits around the selection. [doc+forum] Users complain that objects "tumble out of view" without it and that it is hard to find. [forum] | https://docs.mcneel.com/rhino/8/help/en-us/options/view.htm · https://discourse.mcneel.com/t/rotate-about-an-item-in-perspective-tumbles-it-out-of-view-v8/200980 · https://discourse.mcneel.com/t/disable-orbit-around-selected-object/218094 |
| Revit / Navisworks SteeringWheels | Objects selected before the wheel opens define the orbit pivot by their extents ("Center Pivot on Selection"). Otherwise the pivot is the one set by the Center tool. [doc] The Center tool shows a pivot *sphere* only when the cursor is over geometry; over empty space it shows a "no" circle. [doc] | https://help.autodesk.com/cloudhelp/2019/ENU/Revit-DocumentPresent/files/GUID-FAD4447D-0EF5-40BC-BA52-88D6A3F3C1BD.htm · https://help.autodesk.com/cloudhelp/2025/ENU/Navisworks/files/GUID-CDDAC9CC-CC76-4EFD-8D35-082182EF057C.htm |
| Revit ViewCube | "Keep scene upright": orbit is constrained so the view stays perpendicular to the ground. Turning it off allows a free 360° tumble. [doc] | https://help.autodesk.com/cloudhelp/2024/ENU/Revit-Customize/files/GUID-514BB275-00F6-424A-AA94-1C5A4DBB9234.htm |
| Autodesk Viewer (web, APS) | Has an explicit pivot. "Set pivot with left mouse button": a click sets a new pivot, "overriding the selected object". This implies the selection is otherwise the pivot. "ViewCube acts on pivot": the ViewCube orbits around the active pivot rather than the view centre. Also offers "Fusion-style orbit" and "Orbit past world poles". [doc] API: `setPivotPoint()`. [doc] | https://help.autodesk.com/cloudhelp/ENU/ADSKVIEWER-Help/files/AutodeskViewerTools/ADSKVIEWER_Help_AutodeskViewerTools_ViewerSettings_html.html · https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Navigation |
| Fusion | Default orbit is Shift+MMB. A click sets a pivot, but "on empty space" it picks a poor point. [doc+forum] | https://www.autodesk.com/products/fusion-360/blog/quick-tip-pan-zoom-orbit-preferences/ · https://forums.autodesk.com/t5/fusion-360-ideastation-archived/orbit-and-set-pivot-point-using-only-mouse-button-combinations/idc-p/4345859 |
| Unity | Alt+LMB orbits "the current pivot point". F (frame) makes the selection the pivot. [doc] | https://docs.unity.com/en-us/engine/current/manual/unity-editor/editor-windows-views-reference/using-the-scene-view/scene-view-navigation |
| Unreal | Alt+LMB orbits a single pivot, typically what was last focused with F. An Editor Preference makes orbit use the selection pivot instead of the screen centre. [doc] | https://dev.epicgames.com/documentation/en-us/unreal-engine/viewport-controls-in-unreal-engine |
| Spline | Alt/Option+drag orbits. S = Focus Object (moves the pivot to it). [doc] | https://docs.spline.design/basics/keyboard-shortcuts |
| Google Earth (web) | Ctrl+drag orbits "around your location", the screen centre. [doc] | https://developers.google.com/maps/documentation/earth/navigate-the-globe |
| Cesium | Default rotate/tilt is about the screen-centre pick on the globe. Middle-drag or Ctrl+left-drag tilts. [doc] | https://cesium.com/learn/cesiumjs/ref-doc/ScreenSpaceCameraController.html |
| three.js OrbitControls | Always orbits `controls.target`, a single fixed point that the app must move itself. Nothing picks a pivot from the cursor. [doc] | https://threejs.org/docs/pages/OrbitControls.html |

**How the pivot is shown:**
- Navisworks and Revit show a pivot sphere when the pivot is set (Center tool) [doc].
- Other tools show nothing documented. In practice Fusion and the Autodesk Viewer draw a small pivot marker while orbiting [inference].

## 2. Zoom

**Toward cursor vs centre:**
- **SketchUp:** wheel zooms around the cursor. Dragging the Zoom tool zooms about the screen centre. [doc] https://help.sketchup.com/en/sketchup/viewing-model
- **FormIt:** the wheel zooms toward the 3D point under the cursor and "will slow down the zoom as you approach a surface". Ctrl gives constant-rate zoom "not affected by proximity". [doc] https://windows.help.formit.autodesk.com/formit-introduction/navigating-the-scene
- **Blender:** "Zoom to Mouse Position" is off by default [inference]. When on, the mouse "becomes the focus point" instead of the window centre. [doc]
- **Autodesk Viewer:** "Zoom toward pivot" setting. When off, zoom centres on the cursor. API `zoomTowardsPivot` defaults to false, so cursor zoom is the default. [doc] (links above)
- **ArcGIS Scene Viewer:** double-click and double-tap zoom in at the pointer. [doc] https://doc.esri.com/en/arcgis-online/latest/get-started/navigate-scene.html
- **Google Earth (Pro/desktop):** double-click left zooms toward the cursor, double-click right zooms out. [doc] https://developers.google.com/maps/documentation/earth/use-keyboard-shortcuts
- **three.js:**
  - OrbitControls `zoomToCursor` defaults to false; the default dollies toward `target`. [doc]
  - yomotsu/camera-controls `dollyToCursor` defaults to false. [doc] https://github.com/yomotsu/camera-controls

**Limits and not passing through things:**
- **three.js OrbitControls:** `minDistance` 0, `maxDistance` Infinity, `minPolarAngle` 0, `maxPolarAngle` π. So by default you can orbit under the ground and dolly into the target. [doc]
- **camera-controls:**
  - `minDistance` is ε and `maxDistance` Infinity.
  - `infinityDolly` pushes the target forward instead of stopping at minDistance.
  - `colliderMeshes` stops the camera passing through meshes ("may decrease performance").
  - `setBoundary(box3)` confines the target.
  - [doc] https://github.com/yomotsu/camera-controls
- **Cesium:**
  - `minimumZoomDistance` 1.0 m and `maximumZoomDistance` ∞.
  - `enableCollisionDetection` true keeps the camera above terrain.
  - Inertia: spin 0.9, translate 0.9, zoom 0.8.
  - `zoomFactor` 5.0.
  - [doc] https://cesium.com/learn/cesiumjs/ref-doc/ScreenSpaceCameraController.html
- **Mapbox GL:** `minPitch` 0 and `maxPitch` 85 (pitch is capped short of horizontal). [doc] https://docs.mapbox.com/mapbox-gl-js/api/map/
- **Rhino:** "Auto adjust camera target" (on) moves the rotation target back into the scene if pan or zoom pushes it too far away. This is a fix for the "zoom stalls, orbit about nowhere" problem. [doc] https://docs.mcneel.com/rhino/8/help/en-us/options/view.htm
- **Distance-proportional zoom stalls near the target:**
  - Blender users report zoom "stops at certain level". Maintainers closed it as expected behaviour and pointed to Auto Depth + Zoom to Mouse. [forum] https://developer.blender.org/T93273
  - Unreal scales zoom and pan speed with the distance to the selection ("distance-scaled camera speed"). [doc] https://dev.epicgames.com/documentation/en-us/unreal-engine/viewport-controls-in-unreal-engine
- **Speckle viewer:** a user reports that double-click sets the orbit centre, but wheel zoom then does not zoom toward it. The pivot and zoom targets are inconsistent. [forum] https://speckle.community/t/navigation-in-3d-viewer-target/13009

## 3. Pan

| Tool | Pan binding | Plane |
|---|---|---|
| SketchUp | MMB+LMB, or Shift with Orbit, or H tool [doc] | Screen plane [inference] |
| FormIt | MMB drag, Shift+right-drag, or two-finger drag on touch [doc] | n/a |
| Blender | Shift+MMB; Ctrl+numpad steps; Shift/Ctrl+wheel pans vertically/horizontally [doc] | Screen plane; Auto Depth makes the pan rate match the depth under the cursor [doc] |
| Unity | MMB, or Q tool + drag; Alt+Ctrl+LMB on a trackpad; Shift speeds up [doc] | n/a |
| Spline | Space+drag; two-finger drag on a trackpad [doc] | n/a |
| Mapbox / Google Earth / ArcGIS / Cesium (maps) | Left-drag pans (grab the ground). Mapbox rotates with right-drag or Ctrl+drag [doc] | Ground plane. Cesium `translateEventTypes` = LEFT_DRAG [doc] |
| ArcGIS Scene Viewer | With "Rotate" active, left rotates and right pans; with "Pan" active, left pans. Arrow keys pan. B+right-drag pans at fixed altitude [doc] | Ground |
| three.js OrbitControls | Right-drag pans (LEFT=rotate, MIDDLE=dolly, RIGHT=pan). `screenSpacePanning` defaults to **true**; false pans on the plane orthogonal to camera-up, i.e. ground-parallel. `keyPanSpeed` 7 px [doc] | Screen by default |
| camera-controls | left=ROTATE, right=TRUCK, middle=DOLLY; wheel=DOLLY (perspective) or ZOOM (ortho) [doc] | n/a |
| Rhino | Shift+RMB pans; Ctrl+Shift+RMB rotates; "Always pan parallel views" option [doc] | n/a |

Sources:
- https://help.sketchup.com/en/sketchup/viewing-model
- https://docs.blender.org/manual/en/latest/editors/3dview/navigate/navigation.html
- https://docs.unity.com/en-us/engine/current/manual/unity-editor/editor-windows-views-reference/using-the-scene-view/scene-view-navigation
- https://docs.spline.design/basics/keyboard-shortcuts
- https://docs.mapbox.com/mapbox-gl-js/api/map/
- https://doc.esri.com/en/arcgis-online/latest/get-started/navigate-scene.html
- https://threejs.org/docs/pages/OrbitControls.html

**Trackpad conventions:**
- **Spline:** two-finger drag = pan, pinch = zoom, Alt+tap-drag = orbit. [doc]
- **Unity (Mac):** two-finger drag = zoom; three-finger swipe snaps to axis views when enabled. [doc]
- **Map libraries:** use the wheel/pinch for zoom and drag for pan [doc]. On a trackpad, two-finger scroll typically arrives as wheel events, so it zooms unless the app separates pinch (wheel+ctrlKey) from scroll [inference].
- **Mapbox `cooperativeGestures`:** zoom needs Ctrl/⌘+scroll, touch pan needs two fingers, touch pitch needs three. This avoids hijacking page scroll. [doc]
- **Google Maps `gestureHandling`:** "cooperative", "greedy", "none" or "auto" (default). [doc] https://developers.google.com/maps/documentation/javascript/reference/map

## 4. Automatic camera moves

**On selection, the camera does not move by default:**
- **Figma:** zoom-to-selection is a command (Shift+2), not automatic. A long-running community request for auto-zoom on select was answered only with an opt-in preference, "Keyboard zooms into selection" (no staff reply). [forum] https://forum.figma.com/suggest-a-feature-11/zoom-to-selection-automatically-upon-selection-23259
- **Autodesk Viewer:** selecting can open the properties panel ("Open properties on select" setting). Its documented settings include no camera move on select. [doc] (Viewer settings link above)
- **Unity:** selecting does nothing to the camera. F frames, Shift+F locks the view to a moving selection. [doc]
- **Unreal:** F focuses the selection. [doc]
- **Spline:** S = Focus Object, Shift+S = Orient to Object. [doc]

**Explicit "frame" commands:**

| Tool | Frame selection | Frame all |
|---|---|---|
| Blender | Numpad . (View Selected) | Home (View All) |
| Unity | F | n/a |
| Unreal | F | n/a |
| SketchUp | Zoom Selection (context menu) | Shift+Z (Zoom Extents) |
| FormIt | Z then S | ZA / ZE |
| Navisworks | PgDn | PgUp |
| Figma | Shift+2 | Shift+1 |
| Spline | S (Focus Object) | Alt+R (reset view) |

Sources:
- Blender: https://docs.blender.org/manual/en/latest/editors/3dview/navigate/navigation.html
- SketchUp: https://help.sketchup.com/en/sketchup/viewing-model
- FormIt: https://windows.help.formit.autodesk.com/appendix/keyboard-shortcuts
- Navisworks: https://help.autodesk.com/cloudhelp/2022/ENU/Navisworks/files/GUID-E5041421-ADEA-4FB8-88FF-D59860A8E826.htm
- Unity: https://docs.unity.com/en-us/engine/current/manual/unity-editor/editor-windows-views-reference/using-the-scene-view/scene-view-navigation
- Unreal: https://dev.epicgames.com/documentation/en-us/unreal-engine/viewport-controls-in-unreal-engine
- Spline: https://docs.spline.design/basics/keyboard-shortcuts

**Zoom Extents keeps the angle:** SketchUp's Zoom Extents does not orbit the camera. It changes distance and centre but keeps the viewing angle. [book, Packt, via search; inference that this is typical]

**Double-click:**
- SketchUp: double-click with orbit/MMB recentres the view on the clicked point. [doc] https://help.sketchup.com/en/sketchup/viewing-model
- ArcGIS and Google Earth: double-click zooms in toward the pointer. [doc]
- Mapbox: `doubleClickZoom` is on by default. [doc]
- Speckle: double-click sets the orbit centre. [forum]

**On view change, Revit "Fit-to-view on view change" (default on):**
- If an element is selected when you click the ViewCube, the view rotates *and* zooms to fit that element. [doc] https://help.autodesk.com/cloudhelp/2024/ENU/Revit-Customize/files/GUID-514BB275-00F6-424A-AA94-1C5A4DBB9234.htm
- The selection therefore influences framing only on an explicit view-change action, never on the click that selects.
- The Revit.ini key `ViewCubeFitToView` defaults to 1. [doc]
- A Revit Ideas post claims hotkeys apply it even when unchecked. [forum] https://forums.autodesk.com/t5/revit-ideas/view-cube-shortcut-keys/idi-p/13421823

**On opening a model:**
- TestFit's 3D opens "in a 3D overhead view". [doc, possibly stale] https://intercom.help/plans-pro/en/articles/2652398-navigating-3d (I could not confirm this help centre is TestFit's.)
- Other tools generally frame the model extents on open. [inference]

**Why tools avoid moving on a single click** [inference, consistent with the documented behaviours above]:
- The click is often the start of a drag or a multi-select.
- The user is looking at the object they clicked, so it is already in view.
- An unrequested move destroys the user's chosen viewpoint, which is what Figma users ask to keep optional.
- Moving large scenes is a vestibular trigger (see §5, MDN).

## 5. Transitions

**Mapbox GL JS:**
- `easeTo` defaults: `duration: 500` ms, `easing: defaultEasing` = `bezier(0.25, 0.1, 0.25, 1)` (CSS "ease"). [doc: source] https://raw.githubusercontent.com/mapbox/mapbox-gl-js/main/src/ui/camera.ts · https://raw.githubusercontent.com/mapbox/mapbox-gl-js/main/src/util/util.ts
- `flyTo` defaults: `curve` 1.42 ("the average value selected by participants in the user study", van Wijk 2003) and `speed` 1.2.
- `flyTo` duration when unset is `1000 * S / V`, i.e. derived from path length.
- `maxDuration` has no default. If the computed duration exceeds it, duration becomes 0 (jump). [doc] https://docs.mapbox.com/mapbox-gl-js/api/map/
- **Interruption:** the handler manager calls `map._stop()` as soon as any gesture handler becomes active ("stop any ongoing camera animations (easeTo, flyTo)"), so a user grab always wins. After a drag ends, inertia is applied with an `easeTo`. [doc: source] https://raw.githubusercontent.com/mapbox/mapbox-gl-js/main/src/ui/handler_manager.ts
- **Reduced motion:**
  - `respectPrefersReducedMotion` defaults to true.
  - With the OS setting on, `flyTo` becomes `jumpTo` and `easeTo` gets duration 0, unless `essential: true`.
  - [doc] https://docs.mapbox.com/mapbox-gl-js/api/map/
- **MapLibre:** the same `essential` semantics. [doc] https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/AnimationOptions/

**Blender:** `smooth_view` defaults to **200 ms**, range 0 to 1000, 0 = no animation. It applies to view changes (numpad views, frame selected). [doc] https://docs.blender.org/api/current/bpy.types.PreferencesView.html

**Revit:** "Use animated transition when switching views" defaults to on (`ViewCubeUseAnimatedTransition` = 1). [doc] (link above)

**SketchUp:** "Enable Scene Transitions" defaults to on, with the length set in a Seconds box. I did not find the default value. Tutorials recommend turning it off while modelling for speed. [doc+tutorial] https://help.sketchup.com/en/sketchup/animating-scenes

**Cesium `flyTo`:**
- If `duration` is omitted it is "calculated based on the distance".
- `easingFunction` is configurable (examples use QUADRATIC_IN_OUT).
- `maximumHeight` sets the arc peak.
- [doc] https://cesium.com/learn/cesiumjs-learn/cesiumjs-camera/

**ArcGIS JS `goTo()`:**
- Options: `animate`, `speedFactor`, `duration`, `maxDuration`, `easing` (presets or a function; "linear" gives constant speed).
- A sample notes durations over 8000 ms need `maxDuration` raised, which implies an 8 s default cap. [doc sample; cap default = inference]
- Since 4.30, `goTo` respects reduced motion and ignores the timing options when animation is disabled. [doc] https://developers.arcgis.com/javascript/latest/sample-code/scene-goto/

**Google Maps:**
- JS `moveCamera` is instant.
- `panTo` animates only if the change is smaller than the map's width and height; otherwise it jumps.
- `fitBounds` animation follows "an internal heuristic". [doc] https://developers.google.com/maps/documentation/javascript/reference/map
- 3D (`Map3DElement`): `flyCameraTo({endCamera, durationMillis})`, `flyCameraAround`, `stopCameraAnimation()` (the guide stops on click), and a `gmp-animationend` event. [doc] https://developers.google.com/maps/documentation/javascript/3d/animate-camera

**APS Viewer:**
- `fitBounds(immediate, …)`: when `immediate` is false the camera animates.
- `setView()` "jumps … without camera path animation".
- [doc] https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Navigation

**three.js:**
- OrbitControls has no tweening, only `enableDamping` (default false, `dampingFactor` 0.05). [doc]
- camera-controls:
  - `smoothTime` 0.25 s, `draggingSmoothTime` 0.125 s.
  - `setLookAt/moveTo/fitToBox(..., enableTransition)` toggles animation.
  - `restThreshold` 0.0025.
  - Its README does not state how user input interrupts a transition. [doc] https://github.com/yomotsu/camera-controls

**Reduced motion:** MDN says scaling or panning large objects "can be vestibular motion triggers". The `prefers-reduced-motion: reduce` media query signals the user preference. [doc] https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion

**Typical range:**
- 200 ms (Blender) to 500 ms (Mapbox easeTo) for local moves.
- `flyTo`/`goTo` durations scale with distance and are capped (ArcGIS sample: 8 s).
- Mapbox's padding example uses 1000 ms to match a CSS sidebar transition.

## 6. UI that covers the canvas

**Mapbox `padding` (CameraOptions):**
- "Dimensions in pixels applied on each side of the viewport for shifting the vanishing point". The centre and the perspective vanishing point move into the unobscured area.
- Passing padding to `jumpTo/easeTo/flyTo` also sets the *global* map padding as a side effect, unless `retainPadding: false` (default true).
- `fitBounds` fits to the inset ("If a padding is set on the map, the bounds are fit to the inset").
- `setPadding()` equals `jumpTo({padding})`, i.e. instant.
- [doc] https://docs.mapbox.com/mapbox-gl-js/api/properties/ · https://docs.mapbox.com/mapbox-gl-js/api/map/

**Official Mapbox sidebar example:**
- When a 300 px sidebar toggles, call `easeTo({padding: {left: 300}, duration: 1000})`. The 1000 ms matches the sidebar's CSS transition.
- The camera shifts *with* the panel, so the subject stays centred in the visible area. [doc] https://docs.mapbox.com/mapbox-gl-js/example/offset-vanishing-point-with-padding/
- MapLibre has the same example. https://maplibre.org/maplibre-gl-js/docs/examples/offset-vanishing-point-with-padding/

**Google Maps:**
- JS: `fitBounds(bounds, padding)` fits "in the part of the map that remains after padding is removed". `panToBounds` likewise. The JS CameraOptions has *no* persistent padding. [doc] https://developers.google.com/maps/documentation/javascript/reference/map
- Android: `GoogleMap.setPadding` exists so that "important map elements are not obscured by UI elements when the camera is moved programmatically". Camera updates use the padded region, and controls are repositioned. [doc] https://developers.google.com/maps/documentation/android-sdk/configure-map
- Padding applies to *programmatic* moves. Whether the current centre shifts when padding changes is not stated for Google. [doc gap]

**ArcGIS SceneView** has a `padding` property that makes centre, extent and `goTo` work off a subsection of the view. [inference from prior knowledge of the API; the reference page did not render when fetched]

**camera-controls** `fitToBox(box, transition, {paddingTop, paddingRight, paddingBottom, paddingLeft, cover})`: all paddings default to 0. [doc] https://github.com/yomotsu/camera-controls

**Two observed policies:**
- **Shift when the panel opens:** Mapbox example, maps with persistent padding.
- **Shift only on the next framing command:** fitBounds/panToBounds padding, Google JS, camera-controls fitToBox.
- Desktop CAD tools (Revit, SketchUp, Blender) dock panels beside the viewport, so the canvas shrinks rather than being overlaid and no padding concept is needed. [inference]

## 7. View switching (3D, plan/top, saved views)

**Revit ViewCube:**
- 26 snap orientations (faces, edges, corners). "Snap to closest view" on drag.
- Animated transition, default on.
- Fit-to-view on view change, default on.
- "Keep scene upright".
- Home view.
- Lock to Selection in the context menu.
- [doc] https://help.autodesk.com/cloudhelp/2024/ENU/Revit-Customize/files/GUID-514BB275-00F6-424A-AA94-1C5A4DBB9234.htm
- Revit's "Change the Orientation" topic: https://help.autodesk.com/cloudhelp/2023/ENU/Revit-DocumentPresent/files/GUID-FAD4447D-0EF5-40BC-BA52-88D6A3F3C1BD.htm

**Blender:**
- "Auto Perspective" switches to orthographic when aligning to an axis view and back to perspective when orbiting. [doc] https://docs.blender.org/manual/en/latest/editors/preferences/navigation.html
- Dragging MMB then holding Alt snaps to axes and diagonals. [doc]
- Keys (not fetched; standard Blender keymap) [inference]: Numpad 7 top, 1 front, 3 right, 5 ortho/persp toggle.
- Transitions use smooth_view (200 ms).

**SketchUp:**
- Camera menu standard views (Top, Front, Iso, …).
- Parallel Projection vs Perspective as a separate toggle, with Two-Point Perspective as a third mode.
- Camera > Previous/Next view history.
- Scenes (saved views) animate between each other when Scene Transitions is on.
- [doc] https://help.sketchup.com/en/sketchup/viewing-model

**Rhino:** Named views restore the CPlane, projection and clipping planes (each on by default). "Default 35mm camera lens length" applies when switching from parallel to perspective. [doc] https://docs.mcneel.com/rhino/8/help/en-us/options/view.htm

**Spline:** M toggles perspective/orthographic, Alt+R resets the view. [doc]

**ArcGIS Scene Viewer:** P = top-down ("perpendicular to the ground"), N = north up, plus a Home ("Initial view") button. [doc] https://doc.esri.com/en/arcgis-online/latest/get-started/navigate-scene.html

**Google Earth:**
- Web: a 2D/3D button and a compass to reset north. [doc] https://developers.google.com/maps/documentation/earth/navigate-the-globe
- Pro: `u` resets tilt to top-down, `n` resets to north, `r` resets the view. [doc] https://support.google.com/earth/answer/148115

**TestFit 3D:** T/L/B keys jump to top/left/back views. [doc, provenance uncertain] (link in §4)

**Unity:** Orientation overlay arms snap the view. Orbit is not available in 2D (ortho) mode. [doc]

**Ortho↔perspective animation:** none of the fetched docs describe an animated *projection* morph. Tools animate orientation and treat the projection swap as a switch (Blender Auto Perspective, SketchUp toggle). [inference from absence]

## 8. Camera while dragging an object

- I found no 3D design tool that documents auto-panning a 3D viewport while dragging an object near the edge [doc gap].
- 2D/diagram and plant-design tools do document it:
  - AVEVA E3D: the 3D view pans when the pointer reaches an edge; it stops unless the pointer keeps moving. https://docs.aveva.com/bundle/e3d-design/page/995457.html
  - Altair WinProp: an optional "Auto Scroll" setting. https://help.altair.com/winprop/topics/winprop/user_guide/wallman_tuman/tuman_usage/auto_scroll_winprop.htm
  - Unreal users complain that the Blueprint editor's autopan "scrolls WAY too fast". [forum] https://forums.unrealengine.com/t/suggestion-explose-ini-option-for-blueprint-mat-editors-workspace-auto-panning/5349
- Rhino "Wrap cursor at viewport borders" (on) wraps the cursor during pan and rotate *navigation*, not object drags. [doc]
- Revit's Pan tool lets you keep panning by wrapping at the screen edge. [doc] https://help.autodesk.com/cloudhelp/2018/ENU/Revit-DocumentPresent/files/GUID-BBB89BAA-C566-46C0-B366-9BA4C2CFE8C9.htm
- The common pattern is that the camera stays fixed during an object drag, and navigation input is disabled or ignored for that pointer [inference]:
  - Unity's View tool (Q) is a separate mode from the transform tools [doc].
  - Mapbox: `jumpTo` during a drag uses `keepGesture: 'ifPointerDown'` so as not to kill the user's gesture [doc: source].
- **Unity Shift+F (Lock View to Selected):** the inverse, where the camera follows a moving selection. This is opt-in. [doc]

## 9. Touch and phone

**One finger = pan in map tools, rotate in object viewers:**
- Pan on one finger:
  - Google Earth (pan on one finger, double-tap-and-slide for one-finger zoom) [doc]
  - ArcGIS (one-finger pan, double-tap zoom) [doc]
  - Mapbox (dragPan) [doc]
- Rotate on one finger:
  - three.js OrbitControls (ONE=ROTATE, TWO=DOLLY_PAN) [doc]
  - camera-controls (one=TOUCH_ROTATE) [doc]
  - FormIt (swipe = orbit) [doc]

**Two fingers:**
- Pinch zooms everywhere.
- Twist rotates (Google Earth, ArcGIS, Mapbox `touchZoomRotate`).
- Two-finger vertical drag tilts (Google Earth, ArcGIS, Mapbox `touchPitch`).
- Two-finger drag pans in FormIt and OrbitControls DOLLY_PAN.

**In-page maps:** Mapbox cooperativeGestures and Google `gestureHandling: "cooperative"` need two fingers to pan, so one finger scrolls the page. [doc]

**ArcGIS:** touch ignores the Pan/Rotate tool setting. [doc]

Sources:
- https://developers.google.com/maps/documentation/earth/navigate-the-globe
- https://doc.esri.com/en/arcgis-online/latest/get-started/navigate-scene.html
- https://docs.mapbox.com/mapbox-gl-js/api/map/
- https://threejs.org/docs/pages/OrbitControls.html
- https://windows.help.formit.autodesk.com/formit-introduction/navigating-the-scene

## 10. Anti-patterns and complaints

- **Orbit about the wrong point, model swings off-screen:**
  - Rhino 8 users. [forum] https://discourse.mcneel.com/t/rotate-about-an-item-in-perspective-tumbles-it-out-of-view-v8/200980
  - SketchUp users after clicking empty space ("camera far to the side where you can no longer see your work"). [forum] https://forums.sketchup.com/t/orbit-tool-pivot-point-when-clicking-outside-geometry/58760
  - Fusion: an empty-space click picks a meaningless pivot. [forum]
- **Pivot behaviour changing unexpectedly between versions:** "Orbit tool used to rotate around where I clicked, now it rotates around the centre of the screen". [forum] https://forums.sketchup.com/t/orbit-tool-used-to-rotate-around-where-i-clicked-now-it-rotates-around-the-centre-of-the-screen/182085
- **Best behaviour hidden in advanced settings:** Rhino's cursor-orbit lives in Advanced settings. [forum]
- **Zoom stalls near the target** (distance-proportional dolly toward a fixed target): Blender T93273 [forum]. Rhino addresses it with "Auto adjust camera target" [doc]; FormIt with Ctrl constant-rate zoom [doc].
- **Depth-picking cost:** Blender Auto Depth lags on some GPUs because it reads the depth buffer. [forum] https://developer.blender.org/T68206
- **Inconsistent targets:** the double-click pivot is not used by wheel zoom (Speckle). [forum]
- **Unwanted zoom on view change:** Revit users ask to stop the ViewCube fit-to-view applying via hotkeys. [forum]
- **Auto-pan too fast** (Unreal node editors). [forum]
- **Wanting a camera move that is not the default:** Figma users want auto-zoom to selection but got only a hidden opt-in preference. Evidence that auto-moving on select is contested, and that tools default to *not* moving. [forum]
- **Long flights:** Mapbox `maxDuration` and ArcGIS `maxDuration` exist so that long animated flights degrade to jumps. [doc]

---

## Patterns most tools share

1. **Selecting never moves the camera.** Framing is a separate command: F (Unity, Unreal), Numpad . (Blender), Shift+2 (Figma), Zoom Selection (SketchUp, FormIt), S (Spline).
2. **"Frame all" or "home" is one key or button:** Home, Shift+Z, ZE, Shift+1, the ViewCube house, ArcGIS Initial view.
3. **Wheel zoom goes toward the cursor**, either by default (SketchUp, FormIt, Autodesk Viewer, map tools) or as a popular option (Blender, Rhino, three.js `zoomToCursor`).
4. **Orbit keeps the horizon level** (turntable or "Keep scene upright"). Free tumble is opt-in.
5. **Programmatic moves animate briefly**, 200 to 500 ms for local moves. Long flights scale with distance and are capped.
6. **Any user input cancels a running animation** (Mapbox source, Google 3D `stopCameraAnimation` on click).
7. **prefers-reduced-motion** turns animated moves into jumps in the modern web map SDKs (Mapbox default on, ArcGIS since 4.30).
8. **Map tools frame into the visible region** using pixel padding on fit/fly calls (Mapbox, Google, camera-controls).
9. **On touch:** pinch zooms, two-finger twist rotates, two-finger vertical drag tilts.
10. **Top/plan is a snap view**, usually orthographic, reached by a key or a ViewCube face. Orientation animates; the projection switch is instant.

## Where tools disagree

1. **Orbit pivot:**
   - Screen centre or camera target: SketchUp docs, Google Earth, Rhino default, OrbitControls.
   - Point under the cursor: FormIt, Rhino advanced, Blender Auto Depth.
   - Selection: Blender option, Revit wheels, Autodesk Viewer, Unreal option.
   - Explicitly set pivot: Navisworks Center, Autodesk Viewer click-to-set, Blender Alt-MMB.
2. **What a single drag does:**
   - Pan in map tools (Mapbox, Earth, ArcGIS, Cesium).
   - Orbit in object viewers (OrbitControls, camera-controls, FormIt touch).
   - Desktop CAD uses the middle or right button and leaves left for selection.
3. **Pan plane:** screen-space (OrbitControls default) vs ground-plane (map tools, OrbitControls with `screenSpacePanning=false`).
4. **Zoom rate near objects:**
   - Proximity-slowed: FormIt, Blender.
   - Constant: FormIt with Ctrl.
   - Distance-scaled to the selection: Unreal.
5. **Padding:** shift the camera when a panel opens (Mapbox example) vs apply padding only at the next fit (Google JS, fitBounds-style APIs).
6. **Does the selection affect view-change commands?** Revit's ViewCube zooms to the selection on a view change (default on). Most others keep the current framing when switching orientation.
7. **Transitions in authoring tools:** animated by default in Revit, Blender and SketchUp scenes. Users and tutorials often turn them off for speed (SketchUp tutorial, Blender `smooth_view` = 0).
8. **Double-click:**
   - Zoom in: ArcGIS, Earth, Mapbox.
   - Recentre: SketchUp.
   - Set pivot: Speckle.
   - Nothing documented: Unity, Blender.
9. **Auto-pan at the canvas edge during a drag:** documented in some 2D and plant tools (AVEVA, WinProp). Not documented in mainstream 3D massing or CAD tools.
