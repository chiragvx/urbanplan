// Road remix tools, whole-street selection and undo/redo.
import { type Tile, type Road, type RoadProps, sampleRoad, corridorHalf } from '../world/tile';

export type ToolId = 'inspect' | 'footpath' | 'trees' | 'bus' | 'cycle' | 'crossing' | 'lanes' | 'median' | 'busstop';

export interface ToolDef {
  id: ToolId;
  icon: string;
  label: string;
  key: string;
  hint: string;
  options: { id: string; label: string }[];
}

export const TOOLS: ToolDef[] = [
  { id: 'inspect', icon: '🔍', label: 'Inspect', key: '1', hint: 'Click a road to see its report. Drag to pan.', options: [] },
  { id: 'footpath', icon: '🚶', label: 'Footpaths', key: '2', hint: 'Paint roads to give them proper footpaths.', options: [
    { id: '1.8', label: '1.8 m' }, { id: '2.5', label: '2.5 m' }, { id: '3.5', label: '3.5 m' }, { id: '0', label: 'Remove' }] },
  { id: 'trees', icon: '🌳', label: 'Street trees', key: '3', hint: 'Paint to plant shade trees along the road.', options: [
    { id: 'add', label: 'Plant' }, { id: 'remove', label: 'Remove' }] },
  { id: 'bus', icon: '🚌', label: 'Bus lane', key: '4', hint: 'Reserve the kerb lane for PMPML buses (needs 2+ lanes).', options: [
    { id: 'add', label: 'Add' }, { id: 'remove', label: 'Remove' }] },
  { id: 'cycle', icon: '🚲', label: 'Cycle track', key: '5', hint: 'Protected cycle tracks on both sides.', options: [
    { id: 'add', label: 'Add' }, { id: 'remove', label: 'Remove' }] },
  { id: 'crossing', icon: '🦓', label: 'Crossings', key: '6', hint: 'Zebra crossings where the road meets junctions.', options: [
    { id: 'add', label: 'Add' }, { id: 'remove', label: 'Remove' }] },
  { id: 'lanes', icon: '🛣️', label: 'Lanes', key: '7', hint: 'Add or remove traffic lanes. Wider ≠ always faster.', options: [
    { id: '+1', label: '+1 lane' }, { id: '-1', label: '−1 lane' }] },
  { id: 'median', icon: '🚧', label: 'Median', key: '8', hint: 'A raised median makes crossing safer on wide roads.', options: [
    { id: 'add', label: 'Add' }, { id: 'remove', label: 'Remove' }] },
  { id: 'busstop', icon: '🚏', label: 'Bus stop', key: '9', hint: 'Click beside a road to place a bus stop.', options: [
    { id: 'add', label: 'Place' }, { id: 'remove', label: 'Remove' }] },
];

type UndoEntry = { roads: { id: number; before: RoadProps; after: RoadProps }[]; stops?: { before: Tile['busStops']; after: Tile['busStops'] } };

export class Editor {
  tool: ToolId = 'inspect';
  option: Record<ToolId, string> = {
    inspect: '', footpath: '2.5', trees: 'add', bus: 'add', cycle: 'add', crossing: 'add', lanes: '+1', median: 'add', busstop: 'add',
  };
  wholeStreet = true;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private stroke: Map<number, RoadProps> | null = null;
  private strokeTouched = new Set<number>();
  onChange: (kind: 'roads' | 'stops') => void = () => {};
  onToast: (msg: string) => void = () => {};

  constructor(private tile: Tile) {}

  /** Roads that belong to the same street: same name, or same class chained through simple nodes. */
  street(r: Road): Road[] {
    if (!this.wholeStreet) return [r];
    const T = this.tile;
    if (r.name) {
      // connected roads with the same name (avoids picking far-away namesakes)
      const out: Road[] = [];
      const seen = new Set<number>([r.id]);
      const q = [r];
      while (q.length) {
        const c = q.pop()!;
        out.push(c);
        for (const n of [c.a, c.b]) for (const id of T.nodeRoads[n]) {
          const o = T.roads[id];
          if (!seen.has(id) && o.name === r.name && o.drive === r.drive) { seen.add(id); q.push(o); }
        }
      }
      return out;
    }
    const out: Road[] = [];
    const seen = new Set<number>([r.id]);
    const q = [r];
    while (q.length && out.length < 60) {
      const c = q.pop()!;
      out.push(c);
      for (const n of [c.a, c.b]) {
        const ids = T.nodeRoads[n].filter((id) => T.roads[id].drive === r.drive);
        if (ids.length !== 2) continue;
        for (const id of ids) {
          const o = T.roads[id];
          if (!seen.has(id) && o.clsIndex === r.clsIndex && !o.name) { seen.add(id); q.push(o); }
        }
      }
    }
    return out;
  }

  beginStroke() { this.stroke = new Map(); this.strokeTouched.clear(); }

  endStroke() {
    if (!this.stroke) return;
    const roads: UndoEntry['roads'] = [];
    for (const [id, before] of this.stroke) {
      const after = { ...this.tile.roads[id].props };
      if (JSON.stringify(before) !== JSON.stringify(after)) roads.push({ id, before, after });
    }
    if (roads.length) { this.undoStack.push({ roads }); this.redoStack.length = 0; }
    this.stroke = null;
  }

  /** Apply the current tool to a road (and its street). Returns true if something changed. */
  apply(r: Road): boolean {
    if (this.tool === 'inspect' || this.tool === 'busstop') return false;
    if (this.strokeTouched.has(r.id)) return false;
    const targets = this.street(r);
    let changed = false;
    for (const t of targets) {
      this.strokeTouched.add(t.id);
      if (!t.drive) continue;
      const before = { ...t.props };
      if (this.applyOne(t)) {
        if (this.stroke && !this.stroke.has(t.id)) this.stroke.set(t.id, before);
        changed = true;
      }
    }
    if (changed) this.onChange('roads');
    return changed;
  }

  private applyOne(r: Road): boolean {
    const p = r.props;
    const o = this.option[this.tool];
    const add = o === 'add';
    const before = JSON.stringify(p);
    switch (this.tool) {
      case 'footpath': p.footpath = parseFloat(o); break;
      case 'trees': p.trees = add; break;
      case 'bus':
        if (add && p.lanes < (r.oneway ? 2 : 4) && r.clsIndex <= 5) { this.onToast('Bus lane needs at least 2 lanes per direction — add lanes first'); return false; }
        p.busLane = add; break;
      case 'cycle': p.cycle = add; break;
      case 'crossing': p.crossings = add; break;
      case 'median': if (add && (r.oneway || p.lanes < 2)) return false; p.median = add; break;
      case 'lanes': {
        const step = r.oneway ? 1 : 2;
        const next = p.lanes + (o === '+1' ? step : -step);
        if (next < 1 || next > 10) return false;
        p.lanes = next;
        if (p.lanes < 4 && p.busLane && !r.oneway) p.busLane = false;
        if (p.lanes < 2) p.median = false;
        break;
      }
    }
    return JSON.stringify(p) !== before;
  }

  /** Run a custom edit over roads as one undoable step. */
  edit(roads: Road[], fn: (r: Road) => void) {
    this.beginStroke();
    for (const r of roads) {
      if (!r.drive) continue;
      this.stroke!.set(r.id, { ...r.props });
      fn(r);
    }
    this.endStroke();
    this.onChange('roads');
  }

  /** Bus stop placement / removal at a world point. */
  busStopAt(x: number, z: number, near: { road: Road; s: number; d: number } | null) {
    const stops = this.tile.busStops;
    const before = stops.map((s) => ({ ...s }));
    if (this.option.busstop === 'remove') {
      let best = -1, bd = 25;
      stops.forEach((s, i) => { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = i; } });
      if (best < 0) { this.onToast('No bus stop here'); return; }
      stops.splice(best, 1);
    } else {
      if (!near || !near.road.drive) { this.onToast('Place bus stops beside a road'); return; }
      const q = sampleRoad(near.road, near.s, { seg: 0 });
      const lx = q.dz, lz = -q.dx;
      const side = (x - q.x) * lx + (z - q.z) * lz >= 0 ? 1 : -1;
      const off = corridorHalf(near.road) + 1.6;
      stops.push({ x: q.x + lx * off * side, z: q.z + lz * off * side, name: 'New stop', user: true });
    }
    this.undoStack.push({ roads: [], stops: { before, after: stops.map((s) => ({ ...s })) } });
    this.redoStack.length = 0;
    this.onChange('stops');
  }

  undo() { this.swap(this.undoStack, this.redoStack, true); }
  redo() { this.swap(this.redoStack, this.undoStack, false); }

  private swap(from: UndoEntry[], to: UndoEntry[], isUndo: boolean) {
    const e = from.pop();
    if (!e) return;
    for (const r of e.roads) this.tile.roads[r.id].props = { ...(isUndo ? r.before : r.after) };
    if (e.stops) {
      this.tile.busStops.length = 0;
      this.tile.busStops.push(...(isUndo ? e.stops.before : e.stops.after).map((s) => ({ ...s })));
      this.onChange('stops');
    }
    to.push(e);
    if (e.roads.length) this.onChange('roads');
  }

  resetAll() {
    const roads: UndoEntry['roads'] = [];
    for (const r of this.tile.roads) {
      if (JSON.stringify(r.props) !== JSON.stringify(r.original)) roads.push({ id: r.id, before: { ...r.props }, after: { ...r.original } });
      r.props = { ...r.original };
    }
    if (roads.length) { this.undoStack.push({ roads }); this.onChange('roads'); }
  }

  get changedCount() {
    let n = 0;
    for (const r of this.tile.roads) if (JSON.stringify(r.props) !== JSON.stringify(r.original)) n++;
    return n;
  }
}
