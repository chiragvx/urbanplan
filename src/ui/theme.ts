// UI theme (system / light / dark) and panel layout (floating / docked): applied to <html> as data attributes the
// stylesheet keys off, and to the 2D plan map (its unlit materials and background) and the drawing overlay.
import { effect, signal } from '@preact/signals';
import { saveSettings, settings } from '../editor/state';
import { setInk } from '../editor/ink';
import { planDark } from '../scene/world';
import { ui } from './ctx';

const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const systemDark = signal(!!media?.matches);
media?.addEventListener('change', (e) => { systemDark.value = e.matches; });

/** The theme in effect: the setting, or the system's when it follows the system. */
export const dark = signal(false);

/** Call once the app is up: keeps <html>, the plan map and the overlay in step with the settings. */
export function startTheme() {
  effect(() => {
    const s = settings.value;
    const d = s.theme === 'dark' || (s.theme === 'system' && systemDark.value);
    dark.value = d;
    const root = document.documentElement;
    root.dataset.theme = d ? 'dark' : 'light';
    root.dataset.panels = s.panels;
    setInk(d);
    planDark.value = d ? 1 : 0;
    ui.app.engine.setPlanDark(d);
    ui.app.world.needsRender = true;
    ui.E.overlayDirty = true;
  });
}

/** Top-bar switch: flip to the other theme (an explicit choice, no longer following the system). */
export function toggleTheme() { saveSettings({ theme: dark.value ? 'light' : 'dark' }); }
