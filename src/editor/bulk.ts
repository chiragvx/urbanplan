// Bulk edits preview first: a change that reaches 2+ objects is tried out (run inside a transaction that is rolled
// back, so nothing is written and nothing redraws), summarised ("12 roads → 12 m · +1.6 km of lane · 7 buildings
// inside the road"), drawn as a ghost with its rule flags in amber, and written only on Apply — as ONE undo step.
// Apply always works: flags never block. Further steps while a preview is open ( ] ] ] ) stack onto it.
import { signal } from '@preact/signals';
import type { Editor } from './editor';
import type { Id, Obj, SectionObj } from '../doc/types';
import * as xs from '../doc/xsection';
import { anchorsOf, samplePath } from '../doc/ops';
import { readOnly, selection, toast } from './state';

/** A preview ghost: a ring (or line) in world metres, how to draw it. */
export interface Ghost { pts: number[]; closed: boolean; tone: 'new' | 'gone' | 'flag' }

export interface Plan {
  label: string;
  run: () => void;
  /** objects the change reaches (roads count once) */
  n: number;
  /** summary pieces: "12 roads → 12 m", "+1.6 km of lane", … */
  summary: string[];
  /** rule departures (amber): "4 wider than the DP" */
  flags: string[];
  ghosts: Ghost[];
  /** what to zoom to for "Show" */
  box: [number, number, number, number] | null;
}

export const pending = signal<Plan | null>(null);

const DRY = { dry: true };
let applying = false;
let hooked: Editor | null = null;

/** Ids worth comparing before / after: the selection, roads' sections, sections' roads and end junctions. */
function candidates(E: Editor, extra: Iterable<Id> = []): Set<Id> {
  const out = new Set<Id>();
  const addSec = (s: SectionObj) => { out.add(s.id); out.add(s.road); out.add(s.a); out.add(s.b); };
  for (const id of [...selection.value.map((s) => s.id), ...extra]) {
    const o = E.doc.get(id);
    if (!o) continue;
    out.add(id);
    if (o.kind === 'road') for (const s of E.doc.sectionsOf(id)) addSec(s);
    if (o.kind === 'section') addSec(o);
    if (o.kind === 'junction') for (const s of E.doc.sectionsAt(id)) out.add(s.id);
  }
  return out;
}

/** Run `fn` and roll it back: what each candidate looks like after it (undefined = deleted). */
function dryRun(E: Editor, fn: () => void, ids: Set<Id>): Map<Id, Obj | undefined> {
  const after = new Map<Id, Obj | undefined>();
  try {
    E.doc.transact('Preview', () => {
      fn();
      for (const id of ids) after.set(id, E.doc.get(id));
      throw DRY;
    });
  } catch (e) { if (e !== DRY) throw e; }
  return after;
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
const km = (m: number) => (Math.abs(m) >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const plural = (n: number, w: string) => `${n.toLocaleString('en-IN')} ${w}${n === 1 ? '' : w.endsWith('h') ? 'es' : 's'}`;

/** Centre line + normals of a section (compiled geometry, or sampled from its path when that changed). */
function centre(E: Editor, s: SectionObj, pathChanged: boolean): { pts: number[]; nrm: number[]; len: number } | null {
  const g = E.C.geo(s.id);
  if (g && !pathChanged) return { pts: [...g.pts], nrm: [...g.nrm], len: g.len };
  const S = samplePath(anchorsOf(E.doc, s), 8);
  const pts: number[] = [], nrm: number[] = [];
  S.pts.forEach((p, i) => {
    const a = S.pts[Math.max(0, i - 1)], b = S.pts[Math.min(S.pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    pts.push(p[0], p[1]); nrm.push(dz / L, -dx / L);
  });
  return { pts, nrm, len: S.len };
}

function ring(c: { pts: number[]; nrm: number[] }, hwL: number, hwR: number): number[] {
  const n = c.pts.length / 2, step = Math.max(1, Math.floor(n / 120));
  const L: number[] = [], R: number[] = [];
  for (let i = 0; i < n; i += step) push(i);
  if ((n - 1) % step) push(n - 1);
  function push(i: number) {
    const x = c.pts[i * 2], z = c.pts[i * 2 + 1], nx = c.nrm[i * 2], nz = c.nrm[i * 2 + 1];
    L.push(x + nx * hwL, z + nz * hwL); R.push(x - nx * hwR, z - nz * hwR);
  }
  const out = [...L];
  for (let i = R.length - 2; i >= 0; i -= 2) out.push(R[i], R[i + 1]);
  return out;
}

function lineDist(pts: number[], x: number, z: number) {
  let best = Infinity;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const px = pts[k], pz = pts[k + 1], dx = pts[k + 2] - px, dz = pts[k + 3] - pz;
    const t = Math.max(0, Math.min(1, ((x - px) * dx + (z - pz) * dz) / (dx * dx + dz * dz || 1e-9)));
    best = Math.min(best, Math.hypot(x - px - dx * t, z - pz - dz * t));
  }
  return best;
}

/** Try `run` and describe it. */
function describe(E: Editor, label: string, run: () => void, extra: Id[]): Plan {
  const ids = candidates(E, extra);
  const before = new Map<Id, Obj | undefined>([...ids].map((id) => [id, E.doc.get(id)]));
  const after = dryRun(E, run, ids);
  const ghosts: Ghost[] = [], summary: string[] = [], flags: string[] = [];
  const roads = new Set<Id>(), gone = new Map<string, number>(), juncs = new Set<Id>(), otherChanged = new Map<string, number>();
  const widths = new Set<number>();
  let laneM = 0, wider = 0, narrowLanes = 0, secs = 0;
  const inside = new Set<Id>();
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const grow = (p: number[]) => { for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); } };
  for (const [id, b] of before) {
    if (!b) continue;
    const a = after.get(id);
    if (!a) {
      // a whole road counts once; a section only when its road stays
      const k = b.kind === 'section' ? 'road section' : b.kind === 'line' ? 'asset' : b.kind;
      if (b.kind !== 'section' || (before.has(b.road) ? after.get(b.road) : E.doc.get(b.road))) gone.set(k, (gone.get(k) ?? 0) + 1);
      if (b.kind === 'section') {
        const c = centre(E, b, false);
        if (c) { const e = xs.edges(b.parts); const r = ring(c, e.hwL, e.hwR); ghosts.push({ pts: r, closed: true, tone: 'gone' }); grow(r); }
        juncs.add(b.a); juncs.add(b.b);
      }
      if (b.kind === 'line') { ghosts.push({ pts: b.pts, closed: b.props.shape === 'area', tone: 'gone' }); grow(b.pts); }
      if (b.kind === 'plot') { ghosts.push({ pts: b.ring, closed: true, tone: 'gone' }); grow(b.ring); }
      continue;
    }
    if (same(a, b)) continue;
    if (a.kind === 'section' && b.kind === 'section') {
      secs++;
      roads.add(a.road);
      const pathChanged = !same(a.path, b.path);
      const w0 = xs.totalWidth(b.parts), w1 = xs.totalWidth(a.parts);
      widths.add(w1);
      const c = centre(E, a, pathChanged);
      if (!c) continue;
      laneM += c.len * (xs.laneCount(a.parts).all - xs.laneCount(b.parts).all);
      const e = xs.edges(a.parts);
      const r = ring(c, e.hwL, e.hwR);
      ghosts.push({ pts: r, closed: true, tone: 'new' });
      grow(r);
      if (Math.abs(w1 - w0) > 0.01 || pathChanged || !same(a.parts, b.parts)) { juncs.add(a.a); juncs.add(a.b); }
      if (a.reserve && w1 > a.reserve + 1.5) wider++;
      if (a.parts.some((p) => p.kind === 'lane' && p.width < 2.6)) narrowLanes++;
      // buildings the wider road now reaches (that it didn't before)
      if (w1 > w0 + 0.01 || pathChanged) {
        const half = Math.max(e.hwL, e.hwR), e0 = xs.edges(b.parts), half0 = Math.max(e0.hwL, e0.hwR);
        let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
        for (let i = 0; i < c.pts.length; i += 2) { bx0 = Math.min(bx0, c.pts[i]); bx1 = Math.max(bx1, c.pts[i]); bz0 = Math.min(bz0, c.pts[i + 1]); bz1 = Math.max(bz1, c.pts[i + 1]); }
        const g0 = E.C.geo(id);
        for (const oid of E.hit.query(bx0 - half, bz0 - half, bx1 + half, bz1 + half)) {
          if (inside.has(oid)) continue;
          const o = E.doc.get(oid);
          if (o?.kind !== 'building') continue;
          let now = false, was = false;
          for (let k = 0; k < o.outer.length && !now; k += 2) now = lineDist(c.pts, o.outer[k], o.outer[k + 1]) < half - 0.3;
          if (!now) continue;
          if (g0) for (let k = 0; k < o.outer.length && !was; k += 2) was = lineDist([...g0.pts], o.outer[k], o.outer[k + 1]) < half0 - 0.3;
          if (!was) { inside.add(oid); ghosts.push({ pts: o.outer, closed: true, tone: 'flag' }); }
        }
      }
      continue;
    }
    if (a.kind === 'road') continue; // counted through its sections
    if (a.kind === 'junction') { juncs.add(id); otherChanged.set('junction', (otherChanged.get('junction') ?? 0) + 1); continue; }
    const k = a.kind === 'line' ? 'asset' : a.kind;
    otherChanged.set(k, (otherChanged.get(k) ?? 0) + 1);
    if (a.kind === 'line') { ghosts.push({ pts: a.pts, closed: a.props.shape === 'area', tone: 'new' }); grow(a.pts); }
    if (a.kind === 'plot') { ghosts.push({ pts: a.ring, closed: true, tone: 'new' }); grow(a.ring); }
  }
  // junctions at the ends of changed roads are rebuilt (their outline in the ghost)
  for (const j of juncs) { const o = E.doc.get(j); if (o?.kind === 'junction') { const r = E.C.junctionRing(j); if (r) ghosts.push({ pts: r.flat(), closed: true, tone: 'new' }); } }
  if (roads.size) {
    const W = [...widths].sort((a, b) => a - b);
    const to = W.length === 1 ? ` → ${+W[0].toFixed(1)} m` : W.length ? ` · ${+W[0].toFixed(1)}–${+W[W.length - 1].toFixed(1)} m` : '';
    summary.push(`${plural(roads.size, 'road')}${to}`);
    if (Math.abs(laneM) >= 1) summary.push(`${laneM > 0 ? '+' : '−'}${km(Math.abs(laneM))} of lane`);
  }
  for (const [k, n] of gone) summary.push(`${plural(n, k)} removed`);
  for (const [k, n] of otherChanged) if (k !== 'junction') summary.push(`${plural(n, k)} changed`);
  if (inside.size) flags.push(`${plural(inside.size, 'building')} inside the road`);
  if (wider) flags.push(`${wider} wider than the DP`);
  if (narrowLanes) flags.push(`${plural(narrowLanes, 'section')} with lanes under 2.6 m`);
  if (juncs.size) summary.push(`${plural(juncs.size, 'junction')} ${otherChanged.get('junction') && !roads.size ? 'changed' : 'rebuilt'}`);
  if (!summary.length) summary.push('No change');
  let n = roads.size;
  for (const v of gone.values()) n += v;
  for (const [k, v] of otherChanged) n += k === 'junction' && roads.size ? 0 : v;
  void secs;
  return { label, run, n, summary, flags, ghosts, box: x0 === Infinity ? null : [x0, z0, x1, z1] };
}

/**
 * Make a change through the preview: when it reaches 2+ objects (or a preview is already open, which it stacks onto)
 * it waits in the preview bar; otherwise it is written straight away. `run` must capture what it changes (not read the
 * selection later), since it runs again on Apply. `extra`: ids it touches beyond the selection.
 */
export function change(E: Editor, label: string, run: () => void, extra: Id[] = []): void {
  if (readOnly.value) { toast('This map is read-only — use “Edit a copy” to make changes', 'warn'); return; }
  hook(E);
  const prev = pending.value;
  const all = prev ? () => { prev.run(); run(); } : run;
  const name = prev && prev.label !== label ? (prev.label.includes(label) ? prev.label : `${prev.label} + ${label}`) : label;
  let plan: Plan;
  try { plan = describe(E, name, all, extra); } catch (e) { console.error(e); toast(`${label} failed: ${(e as Error).message}`, 'error'); return; }
  if (!prev && plan.n < 2) { E.edit(label, run); return; }
  pending.value = plan;
  E.overlayDirty = true;
  ensureBar();
}

/** Read the map as the open preview would leave it (rolled back after): so a step taken during a preview stacks. */
export function peek<T>(E: Editor, read: () => T): T {
  const p = pending.value;
  if (!p) return read();
  let out!: T;
  try { E.doc.transact('Preview', () => { p.run(); out = read(); throw DRY; }); } catch (e) { if (e !== DRY) throw e; }
  return out;
}

/** Write the previewed change: one undo step. */
export function apply(E: Editor) {
  const p = pending.value;
  if (!p) return;
  pending.value = null;
  applying = true;
  try { E.edit(p.label, p.run); } finally { applying = false; }
  E.overlayDirty = true;
  toast(`${p.label} · ${p.summary[0]}`, 'ok', { label: 'Undo', run: () => E.doc.undo() });
}

export function cancel(E: Editor) {
  if (!pending.value) return;
  pending.value = null;
  E.overlayDirty = true;
}

/** Keep the summary true when the map changes under an open preview (an undo, another edit). */
function hook(E: Editor) {
  if (hooked === E) return;
  hooked = E;
  E.doc.on((c) => {
    const p = pending.value;
    if (!p || applying || c.origin === 'page') return;
    try { pending.value = describe(E, p.label, p.run, []); } catch { pending.value = null; }
    E.overlayDirty = true;
  });
}

let barMounted = false;
function ensureBar() {
  if (barMounted) return;
  barMounted = true;
  void import('../ui/PreviewBar').then((m) => m.mountPreviewBar());
}
