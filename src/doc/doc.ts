// CityDoc = base objects (from the bake) + a property-level patch (the user's edits).
// Every change goes through a transaction: one undo step, one change event listing every affected object.
import { INHERITED, type Id, type Kind, type Locator, type MapMeta, type Obj, type ObjOf, type PatchEntry, type SectionObj } from './types';

export interface Change {
  /** objects whose effective value changed (including sections affected through their road or junctions) */
  ids: Set<Id>;
  /** objects created or deleted */
  structural: boolean;
  /** 'page': base objects streamed in / out as a region's window moved (not an edit) */
  origin: 'edit' | 'undo' | 'redo' | 'load' | 'page';
  label: string;
}

interface Txn { label: string; before: Map<Id, PatchEntry | undefined>; after?: Map<Id, PatchEntry | undefined>; structural: boolean; time: number; merge?: string }

const clone = <T,>(v: T): T => (v === undefined ? v : structuredClone(v));
const eq = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

export class CityDoc {
  readonly base: Map<Id, Obj>;
  readonly patch = new Map<Id, PatchEntry>();
  meta: MapMeta;
  /** objects of each kind (effective: created included, deleted excluded) */
  private byKind = new Map<Kind, Set<Id>>();
  private roadSecs = new Map<Id, Set<Id>>();
  private juncSecs = new Map<Id, Set<Id>>();
  private layerLines = new Map<Id, Set<Id>>();
  private cache = new Map<Id, Obj | null>();
  private listeners = new Set<(c: Change) => void>();
  private undoStack: Txn[] = [];
  private redoStack: Txn[] = [];
  private txn: Txn | null = null;
  private pendingIds = new Set<Id>();
  /** increments on every change (cheap "dirty" check for the UI) */
  version = 0;
  /** last saved version (for the "unsaved changes" dot) */
  savedVersion = 0;

  constructor(base: Map<Id, Obj>, meta: MapMeta) {
    this.base = base;
    this.meta = meta;
    this.reindex();
  }

  // ---------------- reading ----------------

  get<K extends Kind = Kind>(id: Id): ObjOf<K> | undefined {
    let o = this.cache.get(id);
    if (o === undefined) { o = this.compute(id) ?? null; this.cache.set(id, o); }
    return (o ?? undefined) as ObjOf<K> | undefined;
  }

  private compute(id: Id): Obj | undefined {
    const p = this.patch.get(id);
    if (p?.del) return undefined;
    let o: Obj | undefined = p?.add ?? this.base.get(id);
    if (!o) return undefined;
    if (p?.set) o = { ...o, ...p.set } as Obj;
    if (o.kind === 'section') {
      const rp = this.roadOverrides(o.road);
      if (rp) {
        const own = this.ownKeys(id);
        for (const k of INHERITED) if (k in rp && !own.has(k)) (o as unknown as Record<string, unknown>)[k] = rp[k];
      }
    }
    return o;
  }

  /** Inheritable values set on a road by the user (patch on a base road; the object itself for a created road). */
  private roadOverrides(road: Id): Record<string, unknown> | undefined {
    const e = this.patch.get(road);
    if (!e) return undefined;
    if (e.add) {
      const a = e.add as unknown as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of INHERITED) if (k !== 'name' && k !== 'cls' && a[k] !== undefined) out[k] = a[k];
      for (const k of (a.own as string[] | undefined) ?? []) out[k] = a[k];
      return Object.keys(out).length ? out : undefined;
    }
    return e.set;
  }

  /** Inheritable keys a section sets itself (so road-level edits don't override them). */
  private ownKeys(id: Id): Set<string> {
    const e = this.patch.get(id);
    const out = new Set<string>(Object.keys(e?.set ?? {}));
    for (const k of ((e?.add as unknown as Record<string, unknown>)?.own as string[] | undefined) ?? []) out.add(k);
    return out;
  }

  /** Base value (before any edit) — for "reset" and for showing what changed. */
  baseOf<K extends Kind = Kind>(id: Id): ObjOf<K> | undefined { return this.base.get(id) as ObjOf<K> | undefined; }

  /** Is this property edited on the object itself? ('road' = inherited from a road-level edit) */
  editState(id: Id, key: string): 'base' | 'own' | 'road' | 'new' {
    const p = this.patch.get(id);
    if (p?.set && key in p.set) return 'own';
    const o = this.get(id);
    if (o?.kind === 'section' && (INHERITED as string[]).includes(key) && !this.ownKeys(id).has(key) && key in (this.roadOverrides(o.road) ?? {})) return 'road';
    if (p?.add) return ((p.add as unknown as Record<string, unknown>).own as string[] | undefined)?.includes(key) ? 'own' : 'new';
    return 'base';
  }

  ids(kind: Kind): Set<Id> { return this.byKind.get(kind) ?? new Set(); }
  all<K extends Kind>(kind: K): ObjOf<K>[] { return [...this.ids(kind)].map((id) => this.get<K>(id)!).filter(Boolean); }
  sectionsOf(road: Id): SectionObj[] { return [...(this.roadSecs.get(road) ?? [])].map((id) => this.get<'section'>(id)!).filter(Boolean); }
  sectionsAt(junction: Id): SectionObj[] { return [...(this.juncSecs.get(junction) ?? [])].map((id) => this.get<'section'>(id)!).filter(Boolean); }
  linesOf(layer: Id) { return [...(this.layerLines.get(layer) ?? [])].map((id) => this.get<'line'>(id)!).filter(Boolean); }
  get editCount() { return this.patch.size; }

  // ---------------- indexes ----------------

  private reindex() {
    this.byKind.clear(); this.roadSecs.clear(); this.juncSecs.clear(); this.layerLines.clear(); this.cache.clear();
    const ids = new Set<Id>([...this.base.keys(), ...this.patch.keys()]);
    for (const id of ids) this.index(id);
  }

  private index(id: Id) {
    const o = this.get(id);
    if (!o) return;
    (this.byKind.get(o.kind) ?? this.byKind.set(o.kind, new Set()).get(o.kind)!).add(id);
    if (o.kind === 'section') {
      (this.roadSecs.get(o.road) ?? this.roadSecs.set(o.road, new Set()).get(o.road)!).add(id);
      for (const j of [o.a, o.b]) (this.juncSecs.get(j) ?? this.juncSecs.set(j, new Set()).get(j)!).add(id);
    }
    if (o.kind === 'line') (this.layerLines.get(o.layer) ?? this.layerLines.set(o.layer, new Set()).get(o.layer)!).add(id);
  }

  private unindex(id: Id) {
    const o = this.get(id);
    if (!o) return;
    this.byKind.get(o.kind)?.delete(id);
    if (o.kind === 'section') { this.roadSecs.get(o.road)?.delete(id); this.juncSecs.get(o.a)?.delete(id); this.juncSecs.get(o.b)?.delete(id); }
    if (o.kind === 'line') this.layerLines.get(o.layer)?.delete(id);
  }

  // ---------------- writing ----------------

  /** Run `fn` as one undoable step. Nested calls join the outer step. `merge`: consecutive steps with the same key collapse (drags, scrubbing). */
  transact<T>(label: string, fn: () => T, merge?: string): T {
    if (this.txn) return fn();
    this.txn = { label, before: new Map(), structural: false, time: performance.now(), merge };
    let r: T;
    try { r = fn(); } catch (e) { this.rollback(); throw e; }
    const t = this.txn;
    this.txn = null;
    if (!t.before.size) return r;
    t.after = new Map([...t.before.keys()].map((id) => [id, clone(this.patch.get(id))]));
    const last = this.undoStack[this.undoStack.length - 1];
    if (merge && last?.merge === merge && t.time - last.time < 1500 && [...t.before.keys()].every((id) => last.before.has(id))) {
      last.after = t.after; last.time = t.time; last.structural ||= t.structural;
    } else {
      this.undoStack.push(t);
      if (this.undoStack.length > 500) this.undoStack.shift();
    }
    this.redoStack.length = 0;
    this.flush('edit', label, t.structural);
    return r;
  }

  private rollback() {
    const t = this.txn!;
    this.txn = null;
    for (const [id, e] of t.before) this.writeEntry(id, e);
    this.pendingIds.clear();
  }

  private touch(id: Id) {
    if (!this.txn) throw new Error('CityDoc: edits must run inside transact()');
    if (!this.txn.before.has(id)) this.txn.before.set(id, clone(this.patch.get(id)));
  }

  /** Replace an object's patch entry, keeping indexes + caches right and collecting affected ids. */
  private writeEntry(id: Id, e: PatchEntry | undefined) {
    const prev = this.get(id);
    this.unindex(id);
    // dependents of the old state
    this.collect(id, prev);
    if (e && (e.set || e.add || e.del)) this.patch.set(id, e); else this.patch.delete(id);
    this.cache.delete(id);
    if (prev?.kind === 'road' || this.base.get(id)?.kind === 'road' || e?.add?.kind === 'road') for (const s of this.roadSecs.get(id) ?? []) this.cache.delete(s);
    this.index(id);
    this.collect(id, this.get(id));
  }

  private collect(id: Id, o: Obj | undefined) {
    this.pendingIds.add(id);
    if (!o) return;
    if (o.kind === 'road') for (const s of this.roadSecs.get(id) ?? []) { this.pendingIds.add(s); this.cache.delete(s); }
    if (o.kind === 'junction') for (const s of this.juncSecs.get(id) ?? []) this.pendingIds.add(s);
    if (o.kind === 'section') { this.pendingIds.add(o.a); this.pendingIds.add(o.b); this.pendingIds.add(o.road); }
  }

  private flush(origin: Change['origin'], label: string, structural: boolean) {
    const ids = new Set(this.pendingIds);
    this.pendingIds.clear();
    this.version++;
    if (origin !== 'page') this.meta.updated = new Date().toISOString();
    for (const l of this.listeners) l({ ids, structural, origin, label });
  }

  /** Set one property. Setting a base object's property back to its base value removes the override. */
  set(id: Id, key: string, value: unknown) {
    const cur = this.patch.get(id);
    const base = this.base.get(id);
    if (!cur?.add && !base) throw new Error(`CityDoc.set: no object ${id}`);
    this.touch(id);
    const e: PatchEntry = clone(cur) ?? {};
    if (e.add) {
      const a = e.add as unknown as Record<string, unknown>;
      a[key] = clone(value);
      // a user-set inheritable value on a created section / road is its own (wins over / passes down road values)
      if ((a.kind === 'section' || a.kind === 'road') && (INHERITED as string[]).includes(key) && !((a.own as string[] | undefined) ?? []).includes(key)) a.own = [...((a.own as string[]) ?? []), key];
    }
    else {
      e.set ??= {};
      if (base && eq((base as unknown as Record<string, unknown>)[key], value) && !(base.kind === 'road' && (INHERITED as string[]).includes(key))) delete e.set[key];
      else e.set[key] = clone(value);
      if (!Object.keys(e.set).length) delete e.set;
      if (e.set) e.loc ??= this.locate(id);
      else if (!e.del) delete e.loc;
    }
    this.writeEntry(id, e);
  }

  update(id: Id, props: Record<string, unknown>) { for (const [k, v] of Object.entries(props)) this.set(id, k, v); }

  /** Remove a property override (back to the road's / base value). */
  reset(id: Id, key?: string) {
    const cur = this.patch.get(id);
    if (cur?.add) {
      const own = ((cur.add as unknown as Record<string, unknown>).own as string[] | undefined) ?? [];
      if (!own.length) return;
      this.touch(id);
      const e = clone(cur);
      (e.add as unknown as Record<string, unknown>).own = key ? own.filter((k) => k !== key) : [];
      this.writeEntry(id, e);
      return;
    }
    if (!cur?.set) return;
    this.touch(id);
    const e = clone(cur);
    if (key) delete e.set![key]; else delete e.set;
    if (e.set && !Object.keys(e.set).length) delete e.set;
    if (!e.set && !e.del && !e.add) { this.writeEntry(id, undefined); return; }
    this.writeEntry(id, e);
  }

  create(o: Obj) {
    if (this.get(o.id)) throw new Error(`CityDoc.create: ${o.id} exists`);
    this.touch(o.id);
    this.txn!.structural = true;
    if (this.base.has(o.id)) this.writeEntry(o.id, { set: { ...o } as Record<string, unknown> }); // un-delete
    else this.writeEntry(o.id, { add: clone(o) });
  }

  remove(id: Id) {
    if (!this.get(id)) return;
    this.touch(id);
    this.txn!.structural = true;
    if (this.base.has(id)) this.writeEntry(id, { del: true, loc: this.patch.get(id)?.loc ?? this.locate(id) });
    else this.writeEntry(id, undefined);
  }

  /** Where a base object is, so its edits can be re-attached after a re-import changes ids. */
  locate(id: Id): Locator | undefined {
    const o = this.base.get(id);
    if (!o) return undefined;
    switch (o.kind) {
      case 'section': {
        const P = o.path, m = P[Math.floor(P.length / 2)];
        let len = 0;
        for (let i = 1; i < P.length; i++) len += Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z);
        const mid = P.length % 2 ? m : { x: (P[P.length / 2 - 1].x + m.x) / 2, z: (P[P.length / 2 - 1].z + m.z) / 2 };
        return { kind: 'section', x: Math.round(mid.x * 10) / 10, z: Math.round(mid.z * 10) / 10, name: o.name || undefined, wayIds: o.wayIds, len: Math.round(len) };
      }
      case 'junction': return { kind: 'junction', x: o.x, z: o.z };
      case 'line': return { kind: 'line', x: o.pts[0], z: o.pts[1], len: o.pts.length / 2 };
      case 'building': return { kind: 'building', x: o.outer[0], z: o.outer[1], name: o.name || undefined };
      case 'road': return { kind: 'road', x: 0, z: 0, name: o.name || undefined };
      default: return undefined;
    }
  }

  // ---------------- paging (regions) ----------------

  /**
   * Base objects streamed in and out as a region's window moves. Not an edit: no undo step, not "unsaved". Edits
   * stay in the patch while their object is out of the window and apply again when it comes back.
   */
  page(add: Obj[], remove: Iterable<Id>) {
    if (this.txn) throw new Error('CityDoc.page: inside a transaction');
    for (const id of remove) {
      if (!this.base.has(id)) continue;
      this.collect(id, this.get(id));
      this.unindex(id);
      this.base.delete(id);
      this.cache.delete(id);
    }
    for (const o of add) {
      if (this.base.has(o.id)) continue;
      this.base.set(o.id, o);
      this.cache.delete(o.id);
      if (o.kind === 'road') for (const s of this.roadSecs.get(o.id) ?? []) this.cache.delete(s);
      this.index(o.id);
      this.collect(o.id, this.get(o.id));
    }
    if (!this.pendingIds.size) return;
    const saved = this.version === this.savedVersion;
    this.flush('page', 'Load area', true);
    if (saved) this.savedVersion = this.version;
  }

  // ---------------- history ----------------

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get undoLabel() { return this.undoStack[this.undoStack.length - 1]?.label; }
  get redoLabel() { return this.redoStack[this.redoStack.length - 1]?.label; }

  undo() {
    const t = this.undoStack.pop();
    if (!t) return;
    for (const [id, e] of t.before) this.writeEntry(id, clone(e));
    this.redoStack.push(t);
    this.flush('undo', t.label, t.structural);
  }

  redo() {
    const t = this.redoStack.pop();
    if (!t) return;
    for (const [id, e] of t.after!) this.writeEntry(id, clone(e));
    this.undoStack.push(t);
    this.flush('redo', t.label, t.structural);
  }

  /** Replace the whole patch (opening a map file). Clears history. */
  load(patch: Map<Id, PatchEntry>, meta: MapMeta) {
    const ids = new Set<Id>([...this.patch.keys(), ...patch.keys()]);
    for (const id of ids) this.collect(id, this.get(id));
    this.patch.clear();
    for (const [id, e] of patch) this.patch.set(id, e);
    this.meta = meta;
    this.undoStack.length = 0; this.redoStack.length = 0;
    this.reindex();
    for (const id of ids) this.collect(id, this.get(id));
    this.flush('load', 'Open map', true);
    this.savedVersion = this.version;
  }

  on(fn: (c: Change) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}
