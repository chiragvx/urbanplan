// Scripting API: the same edits the editor makes, for code. Available as `city` in the browser console and to
// scripts run with `npm run map -- apply <map> <script.mjs>`.
//
//   city.roads({ name: /North Main/ }).width(24)
//   city.sections((s) => s.cls === 'residential' && city.width(s) < 6).set({ verified: false })
//   city.tx('Widen lanes', () => { ... })            // one undo step
import type { CityDoc } from './doc';
import type { Id, JunctionObj, LineObj, ObjOf, RoadObj, SectionObj } from './types';
import * as xs from './xsection';
import * as ops from './ops';
import type { Part } from '../net/model';

type Query<T> = ((o: T) => boolean) | Partial<Record<keyof T | 'width' | 'lanes', unknown>> | undefined;

function matches<T extends object>(o: T, q: Query<T>, extra: (o: T, k: string) => unknown): boolean {
  if (!q) return true;
  if (typeof q === 'function') return q(o);
  for (const [k, v] of Object.entries(q)) {
    const have = k in o ? (o as Record<string, unknown>)[k] : extra(o, k);
    if (v instanceof RegExp) { if (!v.test(String(have ?? ''))) return false; }
    else if (typeof v === 'function') { if (!(v as (x: unknown) => boolean)(have)) return false; }
    else if (have !== v) return false;
  }
  return true;
}

export class Collection<T extends { id: Id }> {
  constructor(protected api: CityApi, readonly list: T[]) {}
  get length() { return this.list.length; }
  get ids() { return this.list.map((o) => o.id); }
  get first() { return this.list[0]; }
  each(f: (o: T, i: number) => void) { this.list.forEach(f); return this; }
  map<U>(f: (o: T) => U) { return this.list.map(f); }
  filter(f: (o: T) => boolean) { return new (this.constructor as new (a: CityApi, l: T[]) => this)(this.api, this.list.filter(f)); }
  /** Set raw properties on every object (one undo step). */
  set(props: Record<string, unknown>) { this.api.tx(`Set ${Object.keys(props).join(', ')}`, () => { for (const o of this.list) this.api.doc.update(o.id, props); }); return this; }
  /** Select these in the editor (when running in the editor). */
  select() { this.api.hooks.select?.(this.ids); return this; }
  toString() { return `${this.constructor.name}(${this.length})`; }
}

/** Cross-section edits shared by roads and sections. */
class Ways<T extends RoadObj | SectionObj> extends Collection<T> {
  protected parts(o: T): Part[] {
    if (o.kind === 'section') return o.parts;
    const secs = this.api.doc.sectionsOf(o.id);
    return o.parts ?? secs[0]?.parts ?? xs.template(o.cls);
  }
  protected edit(label: string, f: (p: Part[], o: T) => Part[]) {
    this.api.tx(label, () => { for (const o of this.list) this.api.doc.set(o.id, 'parts', f(this.parts(o), o)); });
    return this;
  }
  /** Total width (m): verges keep their size, lanes scale. */
  width(w: number) { return this.edit(`Width ${w} m`, (p) => xs.setTotalWidth(p, w)); }
  widen(by: number) { return this.edit(`Widen ${by} m`, (p) => xs.setTotalWidth(p, xs.totalWidth(p) + by)); }
  lanes(forward: number, backward = forward) { return this.edit('Lanes', (p) => xs.setLanes(p, forward, backward)); }
  footpaths(w: number, side: 'both' | 'L' | 'R' = 'both') { return this.edit('Footpaths', (p) => (side === 'both' ? xs.setFootpath(xs.setFootpath(p, 'L', w), 'R', w) : xs.setFootpath(p, side, w))); }
  median(w: number) { return this.edit('Median', (p) => xs.setMedian(p, w)); }
  oneway(on = true) { return this.edit('One-way', (p) => xs.makeOneway(p, on)); }
  crossSection(parts: Part[]) { return this.edit('Cross-section', () => parts.map((p) => ({ ...p }))); }
  /** Use each section's Development Plan reserve where measured. */
  dpWidth() { return this.edit('DP width', (p, o) => (o.kind === 'section' && o.reserve ? xs.setTotalWidth(p, o.reserve) : p)); }
  cls(c: string) { return this.set({ cls: c }); }
  name(n: string) { return this.set({ name: n }); }
}

export class Roads extends Ways<RoadObj> {
  get sections() { return new Sections(this.api, this.list.flatMap((r) => this.api.doc.sectionsOf(r.id))); }
  delete() { this.api.tx('Delete roads', () => { for (const r of this.list) ops.deleteRoad(this.api.doc, r.id); }); }
}

export class Sections extends Ways<SectionObj> {
  verify(on = true) { return this.set({ verified: on }); }
  straighten() { this.api.tx('Straighten', () => { for (const s of this.list) ops.straighten(this.api.doc, s.id); }); return this; }
  smooth(tol = 1.5) { this.api.tx('Smooth', () => { for (const s of this.list) ops.smoothSection(this.api.doc, s.id, tol); }); return this; }
  reverse() { this.api.tx('Reverse', () => { for (const s of this.list) ops.reverseSection(this.api.doc, s.id); }); return this; }
  delete() { this.api.tx('Delete sections', () => ops.deleteSections(this.api.doc, this.ids)); }
  get roads() { return new Roads(this.api, [...new Set(this.list.map((s) => s.road))].map((id) => this.api.doc.get<'road'>(id)!).filter(Boolean)); }
}

export class Junctions extends Collection<JunctionObj> {
  signals(on = true) { return this.set({ signals: on }); }
  roundabout(R = 14, lanes = 1) { return this.set({ R, ringLanes: lanes }); }
  noRoundabout() { return this.set({ R: undefined, ringLanes: undefined }); }
  cornerRadius(rc: number) { return this.set({ rc }); }
}

export class Lines extends Collection<LineObj> {
  depth(m: number) { return this.set({ depth: m }); }
  size(m: number) { return this.set({ size: m }); }
}

export interface ApiHooks { select?: (ids: Id[]) => void; zoom?: (ids: Id[]) => void }

export class CityApi {
  /** cross-section helpers (pure functions over parts) */
  readonly xs = xs;
  /** low-level edit operations (run inside city.tx) */
  readonly ops = ops;
  constructor(readonly doc: CityDoc, readonly hooks: ApiHooks = {}) {}

  private extra = (o: object, k: string) => {
    const s = o as SectionObj;
    if (k === 'width') return s.kind === 'section' ? xs.totalWidth(s.parts) : undefined;
    if (k === 'lanes') return s.kind === 'section' ? xs.laneCount(s.parts).all : undefined;
    return undefined;
  };

  roads(q?: Query<RoadObj>) { return new Roads(this, this.doc.all('road').filter((o) => matches(o, q, this.extra))); }
  sections(q?: Query<SectionObj>) { return new Sections(this, this.doc.all('section').filter((o) => matches(o, q, this.extra))); }
  junctions(q?: Query<JunctionObj>) { return new Junctions(this, this.doc.all('junction').filter((o) => matches(o, q, this.extra))); }
  lines(layer?: Id, q?: Query<LineObj>) { return new Lines(this, (layer ? this.doc.linesOf(layer) : this.doc.all('line')).filter((o) => matches(o, q, this.extra))); }
  layers() { return this.doc.all('layer'); }
  get<K extends ObjOf<'section'>['kind'] | 'road' | 'junction' | 'line' | 'building' | 'layer'>(id: Id) { return this.doc.get<K>(id); }
  /** Total width of a section (m). */
  width(s: SectionObj) { return xs.totalWidth(s.parts); }
  /** Group edits into one undo step. */
  tx<T>(label: string, f: () => T): T { return this.doc.transact(label, f); }
  undo() { this.doc.undo(); }
  redo() { this.doc.redo(); }
  /** Draw a new road through points [[x, z], …] (metres from the tile centre). */
  road(points: [number, number][], cls = 'residential', name = '') {
    return this.tx('Draw road', () => ops.createRoad(this.doc, points.map(([x, z]) => ({ x, z })), cls, name));
  }
  /** How many objects have edits. */
  get edits() { return this.doc.editCount; }
  help() {
    return [
      'city.roads({ name: /Koregaon/ }).width(18)        — every matching road, one undo step',
      'city.sections({ cls: "residential" }).footpaths(1.5)',
      'city.sections((s) => city.width(s) < 6).select()   — select them in the editor',
      'city.junctions({ signals: true }).cornerRadius(10)',
      'city.roads({ name: "Nagar Road" }).sections.verify()',
      'city.road([[0, 0], [120, 40]], "tertiary", "New Link Road")',
      'city.tx("Many changes", () => { … })              — group into one undo step',
      'city.xs.template("primary") / city.xs.describe(parts)',
    ].join('\n');
  }
}
