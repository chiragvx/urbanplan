// UrbanPlan — map editor: 2D plan editing with an instant 3D view, on top of the baked city.
import { render, h } from 'preact';
import { App } from './app/app';
import { setUI } from './ui/ctx';
import { TopBar, Dock, Palette, Toasts, ReadOnlyBanner, Attribution } from './ui/chrome';
import { LeftPanel } from './ui/panels';
import { InspectorCard } from './ui/Inspector';
import { startTheme } from './ui/theme';
import { Dialogs, Profile } from './ui/dialogs';
import { RoadToolbar } from './ui/RoadToolbar';
import { BuildPalette } from './ui/BuildPalette';
import { TerrainToolbar } from './ui/TerrainToolbar';
import { MultiToolbar } from './ui/MultiToolbar';

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
  render(h(InspectorCard, {}), $('right'));
  render(h(Dock, {}), $('dock'));
  render(h('div', {}, h(ReadOnlyBanner, {}), h(RoadToolbar, {}), h(TerrainToolbar, {}), h(MultiToolbar, {}), h(Attribution, {}), h(BuildPalette, {}), h(Toasts, {}), h(Profile, {})), $('stage-ui'));
  render(h('div', {}, h(Palette, {}), h(Dialogs, {})), $('modals'));
  startTheme();
  // the map changes size with the window and docked panels: keep the renderer + overlay in step
  new ResizeObserver(() => { app.engine.resize(); app.E.resize(); }).observe($('overlay'));
  $('loading').hidden = true;
  app.engine.resize(); app.E.resize();
  if (import.meta.env.DEV) Object.assign(window, { __app: app });
}

boot();
