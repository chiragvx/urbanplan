// UrbanPlan — map editor: 2D plan editing with an instant 3D view, on top of the baked city.
import { render, h } from 'preact';
import { App } from './app/app';
import { setUI } from './ui/ctx';
import { TopBar, StatusBar, Palette, Toasts, ReadOnlyBanner } from './ui/chrome';
import { LeftPanel } from './ui/panels';
import { Inspector } from './ui/Inspector';
import { Dialogs, Profile } from './ui/dialogs';
import { RoadToolbar } from './ui/RoadToolbar';

const $ = (id: string) => document.getElementById(id)!;
const TILE = new URLSearchParams(location.search).get('tile') ?? 'kp';

async function boot() {
  const progress = (f: number, msg: string) => { $('load-bar').style.width = `${Math.round(f * 100)}%`; $('load-msg').textContent = msg; };
  const app = new App();
  try {
    await app.boot(TILE, progress);
  } catch (e) {
    console.error(e);
    $('load-msg').textContent = `Could not start: ${(e as Error).message}`;
    return;
  }
  setUI({ E: app.E, doc: app.doc, C: app.C, issues: app.issues, app });
  render(h(TopBar, {}), $('topbar'));
  render(h(LeftPanel, {}), $('left'));
  render(h(Inspector, {}), $('right'));
  render(h(StatusBar, {}), $('status'));
  render(h('div', {}, h(ReadOnlyBanner, {}), h(RoadToolbar, {}), h(Toasts, {}), h(Profile, {})), $('stage-ui'));
  render(h('div', {}, h(Palette, {}), h(Dialogs, {})), $('modals'));
  // the stage changes size with the panels: keep the renderer + overlay in step
  new ResizeObserver(() => { app.engine.resize(); app.E.resize(); }).observe($('stage'));
  $('loading').hidden = true;
  app.engine.resize(); app.E.resize();
  if (import.meta.env.DEV) Object.assign(window, { __app: app });
}

boot();
