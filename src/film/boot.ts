// Film mode (dev only): /app/?film=<scene>[&capture][&frames=0-90,300][&every=15][&ss=1.5]
// Boots the editor on the scene's set with no UI, sizes the 3D view to 1080 × 1920 (scaled down to fit the window)
// and plays the scene; with &capture every frame goes to film/out/<scene>/ (see tools/film/README.md).
import { App } from '../app/app';
import { Player } from './player';
import { SCENES } from './scenes';
import { FONT, INK } from './brand';
import * as D from './draw';

/** Same numbers every run: Math.random drives a few cosmetic things (ground texture speckle, new ids). */
function seedRandom(seed: number) {
  let a = seed >>> 0;
  Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** "0-90,300" → [0 … 90, 300]; with `every`, every n-th frame of the whole film */
function frameList(spec: string | null, every: number, count: number): number[] | null {
  if (every > 1) return Array.from({ length: Math.ceil(count / every) }, (_, i) => i * every);
  if (!spec) return null;
  const out: number[] = [];
  for (const p of spec.split(',')) {
    const [a, b] = p.split('-').map(Number);
    if (Number.isFinite(a)) for (let f = a; f <= (Number.isFinite(b) ? b : a); f++) out.push(f);
  }
  return out;
}

export async function bootFilm(Q: URLSearchParams) {
  const id = Q.get('film') ?? '';
  const $ = (s: string) => document.getElementById(s)!;
  const fail = (m: string) => { $('load-msg').textContent = m; if (Q.has('capture')) void fetch(`/__film/done?scene=${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ error: m }) }); };
  const load = SCENES[id];
  if (!load) { fail(`No film scene “${id}” (src/film/scenes.ts lists them)`); return; }
  const scene = (await load()).default;
  seedRandom(1);
  if (scene.size) D.setFrame(scene.size[0], scene.size[1]);
  const { W, H } = D;
  // the stage: exactly 1080 × 1920 CSS pixels, scaled to fit the window
  document.body.style.cssText = `margin:0;background:${INK};overflow:hidden`;
  $('home').hidden = true;
  const stage = $('stage'), shell = $('shell');
  shell.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0`;
  stage.style.cssText = `position:absolute;inset:0;width:${W}px;height:${H}px`;
  for (const k of ['stage-ui', 'left', 'right', 'dock', 'studio']) $(k).hidden = true;
  $('overlay').style.visibility = 'hidden';
  const fit = () => { const k = Math.min(innerWidth / W, innerHeight / H); shell.style.transform = `translate(${(innerWidth - W * k) / 2}px,0) scale(${k})`; };
  fit(); addEventListener('resize', fit);

  const app = new App();
  try {
    await app.boot({ tile: scene.tile }, (f, m) => { $('load-bar').style.width = `${Math.round(f * 100)}%`; $('load-msg').textContent = m; }, { film: true });
  } catch (e) { console.error(e); fail(`Could not start: ${(e as Error).message}`); return; }
  await document.fonts.load(`700 80px ${FONT}`);
  await document.fonts.load(`600 50px ${FONT}`);
  await document.fonts.load(`500 40px ${FONT}`);

  // the 3D view: the high look, at the render scale, at the scene's hour
  const ss = Number(Q.get('ss')) || 1.5;
  const E = app.engine;
  app.E.setMode('3d');
  E.setGraphics('high'); app.world.setGraphics('high');
  E.maxScale = ss; E.quality.scale = ss;
  E.resize();
  E.setTimeOfDay((scene.hour ?? 9.5) * 60);

  const capture = Q.has('capture');
  const player = new Player(app, scene, { capture, frames: frameList(Q.get('frames'), Number(Q.get('every')) || 0, Math.round(scene.duration * (scene.fps ?? 30))), ss });
  player.cv.style.cssText = `position:absolute;inset:0;width:${W}px;height:${H}px;z-index:5`;
  stage.appendChild(player.cv);
  $('loading').hidden = true;
  Object.assign(window, { __app: app, __film: player });
  const started = performance.now();
  try {
    if (capture) await fetch(`/__film/start?scene=${scene.id}`, { method: 'POST' });
    await player.prepare();
    console.info('[film] measured', JSON.stringify({ before: player.M.before.values, after: player.M.after.values }));
    await player.run();
    if (capture) {
      await fetch(`/__film/done?scene=${scene.id}`, {
        method: 'POST',
        body: JSON.stringify({ scene: scene.id, title: scene.title, fps: player.fps, frames: player.count, size: [W, H], values: { before: player.M.before.values, after: player.M.after.values }, seconds: Math.round((performance.now() - started) / 1000), gpuErrors: player.gpuErrors, backend: (E.renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2' }),
      });
    }
  } catch (e) { console.error(e); fail(`Film failed: ${(e as Error).message}`); }
}
