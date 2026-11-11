# Film mode

Short vertical videos ("What If" episodes) rendered by the editor itself, frame by frame, on a synthetic set. The
renders are deterministic: a fixed clock, a seeded `Math.random` and no frame loop, so the same scene always gives the
same frames.

## Rendering

```
npm run film:set                       # (re)build the film set: public/tiles/film/{tile.json,tile.bin,network.json}
npm run film -- wi-01                  # render every frame, then film/out/wi-01.mp4 plus -1x1 and -16x9 cuts
npm run film -- wi-01 --every=30       # one frame a second, as a contact sheet film/out/wi-01-sheet.png (no video)
npm run film -- wi-01 --frames=0-30,600
npm run film -- wi-01 --assemble       # the frames are already there: video only
npm run film -- wi-01 --sound          # just the soundtrack: film/out/wi-01.wav
npm run film -- wi-01 --assemble --voice=bf_emma   # another narrator: re-voice + re-mux, ~1 min, frames kept
```

Options: `--port=5294` (uses a dev server already on that port, or starts and stops its own), `--ss=1.5` (render
scale; 1.5 gives 1620 × 2880 downsampled to 1080 × 1920), `--no-cuts`, `--chrome=<path>` (otherwise `CHROME` or the
usual install paths). Needs ffmpeg on the PATH and a Chrome with WebGPU.

The runner opens your installed Chrome with a throwaway profile on `/app/?film=wi-01&capture`. The page renders each
frame and POSTs it as a PNG to the dev server (`tools/film/vite-film.ts`, `/__film/*`), which writes
`film/out/<scene>/000123.png` and then `done.json` with the measured numbers. ffmpeg then encodes 1080 × 1920 at
30 fps (H.264, yuv420p, crf 18, faststart). The square and landscape cuts place the vertical film over a blurred copy of
itself, so nothing is cropped. `film/out/` is gitignored.

To preview in a browser, open `/app/?film=wi-01` (no capture). It renders the frames on screen as fast as it can,
without saving anything. Add `&frames=300` to stop on a single frame.

## Pieces

- `set.ts`: the film set. A 2 km square valley with a grid of arterials, collectors and local streets, filled blocks,
  parks and a wooded rim. "Market Road" (N–S) and "Station Road" (E–W) cross at the origin, and the four corners are
  left open for the camera.
- `src/film/`: the player. `boot.ts` handles URL params, the stage and the fonts; `player.ts` the clock, camera,
  playback and capture; `draw.ts` the 2D overlays inside the safe area (8% sides, clear of the top bar and the bottom
  15%); `kit.ts` what scenes build and measure with; `brand.ts` the name, URL and colours.
- `scenes/<id>.ts`: one episode each, registered in `src/film/scenes.ts`.
- `sound.ts`: the soundtrack, synthesised from the scene's timings (no samples, nothing to license, seeded). Traffic,
  a honk on the hook and a minor drone under "today"; a whoosh and riser on the wipe; D major at 120 bpm under the fix,
  a blip up the scale per step, birds for `trees`; a ding per split card; the tonic and a bell on the end card. The
  video gets it as AAC levelled to -14 LUFS. `--no-sound` makes a silent video, to post with platform audio instead.
- Voice-over: the scene's `vo` lines (templated like captions), spoken by Kokoro, an open (Apache-2.0) neural TTS that
  runs offline through `tools/film/tts.py`. A line longer than its `max` is said up to 1.25× faster. The bed ducks
  about 10 dB under the voice, and the log prints how far the voice sits over it. Pick the narrator with `voice`
  (default `af_heart`). One-time setup, in `film/tts/` (gitignored):

  ```
  python -m venv film/tts/.venv && film/tts/.venv/Scripts/python -m pip install kokoro-onnx soundfile
  curl -L -o film/tts/kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
  curl -L -o film/tts/voices-v1.0.bin https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
  ```

  Without it the film still gets music and effects. `--no-vo` (with `--sound` or a full run) leaves the voice out.

## Scene format (`src/film/types.ts`)

A scene is data plus three functions, all run against the real document (`CityDoc`) and compiler:

- `before(k)`: edits that turn the set into the "today" state (one transaction).
- `steps`: the fix, in order. Each step has a `t` (seconds), a `label` (a tag shown while it builds, optionally with a
  `place`), and `run(k, u)`, the edits for progress `u`. With `n` > 1 the step is tweened into `n` ticks over `dur`
  seconds (corners tightening, for example). `trees` names a place whose trees grow in.
- `measure(k)`: returns `{ values, places }` and is run on both the before and the after state. Values are numbers
  read off the compiled geometry, never typed in. Places are named points, lines and rings that the marks and captions
  pin to.
- `keys`: camera keys `{ t, at, dist, yaw, pitch, fov?, ease? }`, where `at` is a point or a place name. The player
  lifts the camera where terrain or buildings would block the view and smooths the lift over about 1 s.
- `captions`, `marks` (`circle`, `dim`, `tag`), `wipe`, `split` (before/after with `stats`) and `end` (the end card).
- Text templates: `{before.longest}`, `{after.rc:0}` (decimals after the colon).

At load the player applies `before`, measures, applies every step and measures again, then undoes back to the start.
During playback it moves between those states with undo and redo, so each frame shows exactly what the edits produce.

Adding an episode: copy `scenes/wi-01.ts`, change the ops, places and keys, register it in `src/film/scenes.ts`, then
run `npm run film -- <id> --every=30` and look at the sheet before the full render.

## Plot in 60: capturing DOM UI frames

Plot in 60 needs real editor UI (panels, cursor, menus), so the 2D-overlay approach used here does not cover it. The
simplest free and deterministic route:

**Recommendation: raw Chrome DevTools Protocol from Node, driving the installed Chrome, with an injected virtual clock
and `Page.captureScreenshot` per frame.**

- Launch Chrome as `film.mjs` already does, plus `--remote-debugging-port=0` (read the port from
  `DevToolsActivePort` in the profile). Talk to it over Node's built-in `WebSocket` (Node 22+), which needs no
  dependencies. `puppeteer-core` (no bundled browser) is an equally good option if a nicer API is worth one dev
  dependency. Use `puppeteer.connect` or `launch({ executablePath })`, never `puppeteer`, which downloads Chromium.
- Clock: add a `?film` hook that replaces `requestAnimationFrame`, `performance.now`, `Date.now` and
  `setTimeout`/`setInterval` with a manual clock, plus CSS animations through `document.getAnimations()` and
  `currentTime`. Advance it by 1/30 s per frame from Node with `Runtime.evaluate`, then wait two rAFs before
  capturing. This is more reliable than `Emulation.setVirtualTimePolicy`, which stalls on WebGPU and network work.
- Input: script the clicks and drags with `Input.dispatchMouseEvent` / `dispatchKeyEvent` at known frame numbers,
  and draw the cursor as a DOM overlay so it appears in the capture.
- Capture: `Page.captureScreenshot({ format: 'png', fromSurface: true })` per frame at a fixed
  `Emulation.setDeviceMetricsOverride` (1080 × 1920, deviceScaleFactor 1). It captures the composited page, including
  the WebGPU canvas, so the readback workaround here is not needed.
- Avoid `Page.startScreencast`: it delivers frames when the compositor feels like it, drops and repeats frames, and is
  JPEG only. Fine for previews, not for deterministic output.

Expect about 5–10 frames a second, so a 60 s video takes a few minutes. Not prototyped yet.
