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

const $ = (id: string) => document.getElementById(id)!;
// the whole city (a region streamed in pieces) unless a single tile is asked for (?tile=kp)
const Q = new URLSearchParams(location.search);
const SRC = Q.get('tile') ? { tile: Q.get('tile')! } : { region: Q.get('region') ?? 'pune' };

async function boot() {
  const progress = (f: number, msg: string) => { $('load-bar').style.width = `${Math.round(f * 100)}%`; $('load-msg').textContent = msg; };
  const app = new App();
  try {
    await app.boot(SRC, progress);
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

boot();
