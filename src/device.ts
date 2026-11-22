// What kind of device this is, for what may be done on it: a phone is for looking and sharing, not editing
// (docs/plans/mobile-view-only.md). Layout is still the CSS's business (its max-width rules); this decides what's allowed.
//
// A phone: a coarse pointer (a finger) and a screen whose shorter side is under 600 CSS px. The screen, not the
// window, so turning the phone keeps it a phone and a narrow desktop window stays an editor; tablets edit.
// ?edit=1 lifts it for the tab (support, testing): kept in sessionStorage, linked from nowhere.
import { useEffect, useState } from 'preact/hooks';

const OVERRIDE = 'urbanplan:edit-anyway';

function overridden(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('edit');
    if (q === '1') sessionStorage.setItem(OVERRIDE, '1');
    if (q === '0') sessionStorage.removeItem(OVERRIDE);
    return sessionStorage.getItem(OVERRIDE) === '1';
  } catch { return false; }
}

/** a phone (and not lifted with ?edit=1): view and share only */
export function isPhone(): boolean {
  if (typeof matchMedia === 'undefined' || typeof screen === 'undefined') return false;
  if (overridden()) return false;
  return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
}

/** isPhone(), kept up to date (a device emulated in dev tools, a pointer plugged in) */
export function usePhone(): boolean {
  const [on, setOn] = useState(isPhone);
  useEffect(() => {
    const m = matchMedia('(pointer: coarse)'), f = () => setOn(isPhone());
    m.addEventListener('change', f); addEventListener('resize', f);
    return () => { m.removeEventListener('change', f); removeEventListener('resize', f); };
  }, []);
  return on;
}
