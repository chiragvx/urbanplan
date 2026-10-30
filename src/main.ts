// UrbanPlan — map editor: 2D plan editing with an instant 3D view, on top of the baked city.
import { render, h } from 'preact';
import { App } from './app/app';
import { setUI } from './ui/ctx';
import { MapCorners, Dock, Palette, Toasts, ReadOnlyBanner, Attribution, CursorHint } from './ui/chrome';
import { LeftPanel } from './ui/panels';
import { ToolPanel } from './ui/ToolPanel';
import { startTheme } from './ui/theme';
import { Dialogs, Profile } from './ui/dialogs';
import { BuildPalette } from './ui/BuildPalette';
import { Home, cities, cityOf } from './ui/Home';
import { parse } from './doc/format';

const $ = (id: string) => document.getElementById(id)!;
// a city (a region streamed in pieces), a single tile (?tile=kp), or a published map (?map=…, on its own city);
// with none of them, the start menu
const Q = new URLSearchParams(location.search);

/** The city a published map opens on: the one it was made on. */
async function sourceOf(): Promise<{ tile?: string; region?: string }> {
  if (Q.get('tile')) return { tile: Q.get('tile')! };
  if (Q.get('region')) return { region: Q.get('region')! };
  const list = await cities();
  try {
    const r = await fetch(Q.get('map')!);
    const c = r.ok ? cityOf(list, parse(await r.text()).meta.tile) : undefined;
    if (c) return { region: c.id };
  } catch { /* opened below, with its own error */ }
  return { region: list[0]?.id ?? 'pune' };
}

async function boot() {
  const progress = (f: number, msg: string) => { $('load-bar').style.width = `${Math.round(f * 100)}%`; $('load-msg').textContent = msg; };
  const app = new App();
  try {
    const src = await sourceOf();
    if (src.region) {
      const c = (await cities()).find((x) => x.id === src.region);
      if (c) $('load-sub').textContent = `Edit the city in 2D, see it in 3D — ${c.name}`;
    }
    await app.boot(src, progress);
  } catch (e) {
    console.error(e);
    $('load-msg').textContent = `Could not start: ${(e as Error).message}`;
    return;
  }
  setUI({ E: app.E, doc: app.doc, C: app.C, issues: app.issues, app });
  // the info panels (layers, roads, issues, review) on the right; the tool options / inspector bottom left
  render(h(LeftPanel, {}), $('right'));
  render(h(ToolPanel, {}), $('left'));
  render(h(Dock, {}), $('dock'));
  render(h('div', {}, h(MapCorners, {}), h(ReadOnlyBanner, {}), h(Attribution, {}), h(BuildPalette, {}), h(Toasts, {}), h(Profile, {}), h(CursorHint, {})), $('stage-ui'));
  render(h('div', {}, h(Palette, {}), h(Dialogs, {})), $('modals'));
  startTheme();
  // the map changes size with the window and docked panels: keep the renderer + overlay in step
  new ResizeObserver(() => { app.engine.resize(); app.E.resize(); }).observe($('overlay'));
  $('loading').hidden = true;
  app.engine.resize(); app.E.resize();
  if (import.meta.env.DEV) Object.assign(window, { __app: app });
}

if (Q.has('region') || Q.has('tile') || Q.has('map')) boot();
else {
  $('loading').hidden = true;
  $('shell').hidden = true;
  render(h(Home, {}), $('home'));
}
