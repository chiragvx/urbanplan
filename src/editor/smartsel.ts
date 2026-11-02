// Smart selection (Figma's "select matching", the iD editor's multi-select): everything like the selection (same
// type and width), the whole street by name across its junctions, the shortest route between two clicks, and
// everything in view; plus what a box select picks up.
import type { Editor } from './editor';
import type { Id, Kind, SectionObj } from '../doc/types';
import { totalWidth } from '../doc/xsection';
import { assetOf } from '../assets';
import { read } from '../assets/roadmodel';
import { mapStandard } from '../ui/RoadPicker';
import { boxKinds, select, selection, status, toast, type Sel } from './state';

/** The longest section of a road (its "type" for comparisons). */
export function leadOf(E: Editor, road: Id): SectionObj | undefined {
  let best: SectionObj | undefined, bl = -1;
  for (const s of E.doc.sectionsOf(road)) { const l = E.C.geo(s.id)?.len ?? 0; if (l > bl) { bl = l; best = s; } }
  return best;
}

/** A road / section's template (as the map's standard reads its cross-section) and width, as one key. */
const keyMemo = new Map<string, string>();
export function roadKey(s: SectionObj): string {
  const w = Math.round(totalWidth(s.parts) * 2) / 2;
  const k = mapStandard() + JSON.stringify(s.parts);
  let t = keyMemo.get(k);
  if (t === undefined) {
    try { const r = read(s.parts, mapStandard(), s.cls); t = r.template?.id ?? `custom:${s.asset ?? s.cls}`; } catch { t = s.asset ?? s.cls; }
    if (keyMemo.size > 5000) keyMemo.clear();
    keyMemo.set(k, t);
  }
  return `${t}|${w}`;
}

/** What "the same" means for each kind. */
function keyOf(E: Editor, sel: Sel): string | null {
  const o = E.doc.get(sel.id);
  if (!o) return null;
  switch (o.kind) {
    case 'road': { const s = leadOf(E, o.id); return s ? 'road:' + roadKey(s) : null; }
    case 'section': return 'road:' + roadKey(o);
    case 'junction': return `junction:${E.doc.sectionsAt(o.id).length}|${o.signals}|${!!o.R}`;
    case 'line': return `line:${assetOf(o)?.id ?? o.layer}`;
    case 'plot': return `plot:${o.use}`;
    case 'building': return null;
    default: return `${o.kind}:`;
  }
}

/** Select similar (Shift+S): every road with the same template and width, every asset of the same type… */
export function selectSimilar(E: Editor) {
  const keys = new Set(selection.value.map((s) => keyOf(E, s)).filter(Boolean) as string[]);
  if (!keys.size) { toast('Select a road, junction, asset or plot first', 'info'); return; }
  const out: Sel[] = [];
  const want = (k: string) => keys.has(k);
  if ([...keys].some((k) => k.startsWith('road:'))) {
    for (const id of E.doc.ids('road')) {
      const s = leadOf(E, id);
      if (s && E.canPick('section', undefined, s.id) && want('road:' + roadKey(s))) out.push({ kind: 'road', id });
    }
  }
  for (const kind of ['junction', 'line', 'plot'] as Kind[]) {
    if (![...keys].some((k) => k.startsWith(kind + ':'))) continue;
    for (const id of E.doc.ids(kind)) { const k = keyOf(E, { kind, id }); if (k && want(k)) out.push({ kind, id }); }
  }
  select(out);
  status.value = `${out.length.toLocaleString('en-IN')} similar selected`;
}

/** Sections the selection covers (roads expand). */
function seedSections(E: Editor): SectionObj[] {
  return E.selectedSections();
}

/** Whole street (Shift+W): the street the selection is on, by name, across junctions. */
export function wholeStreet(E: Editor) {
  const seeds = seedSections(E);
  if (!seeds.length) { toast('Select a road first', 'info'); return; }
  const names = new Set(seeds.map((s) => s.name).filter(Boolean));
  const roadsOf = new Set(seeds.map((s) => s.road));
  const ok = (s: SectionObj) => (s.name ? names.has(s.name) : roadsOf.has(s.road));
  const seen = new Set<Id>(seeds.map((s) => s.id));
  const queue = [...seeds];
  while (queue.length) {
    const s = queue.pop()!;
    for (const j of [s.a, s.b]) for (const n of E.doc.sectionsAt(j)) {
      if (seen.has(n.id) || !ok(n) || !E.canPick('section', undefined, n.id)) continue;
      seen.add(n.id); queue.push(n);
    }
  }
  const roads = new Set<Id>();
  for (const id of seen) { const s = E.doc.get<'section'>(id); if (s) roads.add(s.road); }
  select([...roads].map((id) => ({ kind: 'road' as const, id })));
  status.value = `${names.size ? [...names].join(', ') : 'The street'}: ${roads.size} road${roads.size === 1 ? '' : 's'}`;
}

// ---------------- along a route ----------------

/** Shortest path (by length) between two junctions over the road network: its sections, or null. */
export function routeBetween(E: Editor, from: Id, to: Id): Id[] | null {
  if (from === to) return [];
  const dist = new Map<Id, number>([[from, 0]]), via = new Map<Id, { sec: Id; prev: Id }>();
  const done = new Set<Id>();
  // a small binary heap keyed by distance
  const heap: [number, Id][] = [[0, from]];
  const push = (d: number, j: Id) => { heap.push([d, j]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, j] = pop();
    if (done.has(j)) continue;
    done.add(j);
    if (j === to) break;
    for (const s of E.doc.sectionsAt(j)) {
      if (!E.canPick('section', undefined, s.id)) continue;
      const n = s.a === j ? s.b : s.a;
      const nd = d + (E.C.geo(s.id)?.len ?? 1);
      if (nd < (dist.get(n) ?? Infinity)) { dist.set(n, nd); via.set(n, { sec: s.id, prev: j }); push(nd, n); }
    }
  }
  if (!via.has(to)) return null;
  const out: Id[] = [];
  for (let j = to; j !== from;) { const v = via.get(j)!; out.push(v.sec); j = v.prev; }
  return out.reverse();
}

/** The route pick in progress (Shift+R): its first junction once clicked. */
export const routePick: { on: boolean; a: Id | null } = { on: false, a: null };

/** Along a route (Shift+R): two selected junctions route at once; otherwise the next two clicks on the map. */
export function startRoute(E: Editor) {
  const js = selection.value.filter((s) => s.kind === 'junction').map((s) => s.id);
  if (js.length === 2) { finishRoute(E, js[0], js[1]); return; }
  routePick.on = true; routePick.a = null;
  status.value = 'Route: click where it starts (a road or junction) · Esc to stop';
  E.overlayDirty = true;
}

export function cancelRoute() { routePick.on = false; routePick.a = null; }

/** A click while picking a route: true when it was used. */
export function routeClick(E: Editor, w: [number, number]): boolean {
  if (!routePick.on) return false;
  const p = E.pickAt(w[0], w[1]);
  let j: Id | null = null;
  if (p?.kind === 'junction') j = p.id;
  else if (p?.kind === 'section') {
    const s = E.doc.get<'section'>(p.id)!, A = E.doc.get<'junction'>(s.a), B = E.doc.get<'junction'>(s.b);
    if (A && B) j = Math.hypot(A.x - w[0], A.z - w[1]) <= Math.hypot(B.x - w[0], B.z - w[1]) ? A.id : B.id;
  }
  if (!j) { status.value = 'Route: click on a road or a junction · Esc to stop'; return true; }
  if (!routePick.a) { routePick.a = j; select([{ kind: 'junction', id: j }]); status.value = 'Route: now click where it ends'; return true; }
  const a = routePick.a;
  cancelRoute();
  finishRoute(E, a, j);
  return true;
}

function finishRoute(E: Editor, a: Id, b: Id) {
  const secs = routeBetween(E, a, b);
  if (!secs) { toast('No connected route between those two points', 'warn'); status.value = ''; return; }
  select(secs.map((id) => ({ kind: 'section' as const, id })));
  let len = 0;
  for (const id of secs) len += E.C.geo(id)?.len ?? 0;
  status.value = `Route: ${secs.length} section${secs.length === 1 ? '' : 's'} · ${len >= 1000 ? `${(len / 1000).toFixed(2)} km` : `${Math.round(len)} m`}`;
}

// ---------------- box select / everything in view ----------------

/** What a box (or the view) catches, by the box-select toggles. `deep`: road sections rather than whole roads. */
export function inBox(E: Editor, r: [number, number, number, number], deep = false): Sel[] {
  const k = boxKinds.value;
  const kinds: Kind[] = ['section', 'junction', 'line', 'plot'];
  const ids = E.hit.inRect(...r, kinds, E.canPick);
  const out = new Map<Id, Sel>();
  for (const id of ids) {
    const o = E.doc.get(id)!;
    if (o.kind === 'section' && k.roads) { const s: Sel = deep ? { kind: 'section', id } : { kind: 'road', id: o.road }; out.set(s.id, s); }
    else if (o.kind === 'line' && k.assets) out.set(id, { kind: 'line', id });
    else if (o.kind === 'plot' && k.plots) out.set(id, { kind: 'plot', id });
    else if (o.kind === 'junction' && k.junctions) out.set(id, { kind: 'junction', id });
  }
  // junctions when nothing else was caught
  if (!out.size) for (const id of ids) if (E.doc.get(id)?.kind === 'junction') out.set(id, { kind: 'junction', id });
  return [...out.values()];
}

/** Everything in view (Ctrl+A), by the box-select toggles. */
export function everythingInView(E: Editor) {
  const out = inBox(E, E.view.rect);
  select(out);
  status.value = `${out.length.toLocaleString('en-IN')} in view selected`;
}
