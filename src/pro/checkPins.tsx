// Approval's overlay: a pin over each building with checks that fail or need a look, pinned to its top in the view.
// A click picks and frames the building, and its inspector lists the checks.
import { useEffect, useRef } from 'preact/hooks';
import type { ProView } from './scene';
import type { Evaluated } from './evaluate';
import type { Check } from './scrutiny';
import { checkBuilding } from './viewer';
import { Icon } from './ui';

export function CheckPins({ view, e, checks, show }: { view: ProView | null; e: Evaluated; checks: Check[]; show: (id: string) => void }) {
  const els = useRef(new Map<number, HTMLElement>());
  // each building's failing and to-check counts, and the point over its top
  const pins = e.d.buildings.map((br, i) => {
    const mine = checks.filter((c) => checkBuilding(c.key) === i);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const q of br.quads) for (let k = 0; k + 1 < q.length; k += 2) { x0 = Math.min(x0, q[k]); x1 = Math.max(x1, q[k]); z0 = Math.min(z0, q[k + 1]); z1 = Math.max(z1, q[k + 1]); }
    return { i, id: br.b.id, fail: mine.filter((c) => c.status === 'fail').length, warn: mine.filter((c) => c.status === 'warn').length, at: [(x0 + x1) / 2, br.height + 2, (z0 + z1) / 2] as [number, number, number], ok: Number.isFinite(x0) };
  }).filter((x) => x.ok && x.fail + x.warn > 0);
  useEffect(() => {
    if (!view) return;
    // (kept below the result bar: a tall building seen close has its top above it)
    const place = () => {
      const res = document.querySelector<HTMLElement>('.stage .results'), top = res ? res.offsetTop + res.offsetHeight + 8 : 8;
      for (const p of pins) { const el = els.current.get(p.i); if (!el) continue; const [sx, sy] = view.toScreen(...p.at); el.style.transform = `translate(${Math.round(sx)}px,${Math.round(Math.max(top + el.offsetHeight, sy))}px) translate(-50%,-100%)`; }
    };
    place(); view.frameHooks.add(place);
    return () => { view.frameHooks.delete(place); };
  });
  return (
    <div class="cpins" aria-label="Checks on the view">
      {pins.map((p) => (
        <button type="button" class={`cpin ${p.fail ? 'bad' : 'warn'}`} ref={(el) => { if (el) els.current.set(p.i, el); else els.current.delete(p.i); }} onClick={() => show(p.id)}
          aria-label={`Building ${String.fromCharCode(65 + p.i)}: ${p.fail} failing, ${p.warn} to check`} data-tip="Its checks, in the inspector">
          <Icon n={p.fail ? 'x' : 'warn'} size={13} />{p.fail ? `${p.fail} fail` : `${p.warn} to check`}
        </button>
      ))}
    </div>
  );
}
