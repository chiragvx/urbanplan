// Document → road mesher. Each section compiles to one cubic piece per anchor gap (+ shape nodes between them);
// each junction to a mesher node. Only what a change touched is recompiled.
import { RoadMesher, type MNode, type MSeg } from '../net/generate';
import { typeFromParts, type RoadType, type V2 } from '../net/model';
import type { Heightfield } from '../geo/heightfield';
import type { CityDoc } from './doc';
import type { Id, JunctionObj, SectionObj } from './types';
import { isMajorClass } from './xsection';
import { samplePath } from './ops';

export interface SectionGeo {
  id: Id;
  /** sampled centre line (x,z pairs), cumulative length, left normals */
  pts: Float32Array; cum: Float32Array; nrm: Float32Array; len: number;
  t: RoadType;
  x0: number; z0: number; x1: number; z1: number;
}

export class Compiler {
  readonly mesher: RoadMesher;
  private secSegs = new Map<Id, string[]>();
  private secShape = new Map<Id, string[]>();
  private secCode = new Map<Id, number>();
  private codeSec: Id[] = [''];
  private pathIds = new Set<Id>();
  private geoCache = new Map<Id, SectionGeo | null>();
  readonly types = new Map<string, RoadType>();

  constructor(readonly doc: CityDoc, readonly hf: Heightfield) {
    this.mesher = new RoadMesher(hf);
  }

  /**
   * A graded section's height profile split per cubic piece: [pieceLength, s0, z0, s1, z1, …] with s along the piece
   * and z in scene metres. Stations are evenly spaced (≤ step apart); the ends meet the junctions on the ground.
   */
  private gradePieces(s: SectionObj, P: ReturnType<Compiler['anchors']>): number[][] | null {
    const G = s.grade;
    if (!G || G.z.length < 2) return null;
    const S = samplePath(P, 24);
    const L = S.len;
    if (L < 1) return null;
    const m = G.z.length;
    const st = G.z.map((_, i) => (L * i) / (m - 1));
    const z = G.z.map((v) => v - this.hf.base);
    const a = P[0], b = P[P.length - 1];
    z[0] = this.hf.sample(a.x, a.z) + a.lift; z[m - 1] = this.hf.sample(b.x, b.z) + b.lift;
    const at = (u: number) => { let i = 1; while (i < m - 1 && st[i] < u) i++; const f = Math.max(0, Math.min(1, (u - st[i - 1]) / (st[i] - st[i - 1] || 1))); return z[i - 1] + (z[i] - z[i - 1]) * f; };
    const out: number[][] = [];
    for (let k = 0; k < P.length - 1; k++) {
      const s0 = S.s[k * 24], s1 = S.s[Math.min(S.s.length - 1, (k + 1) * 24)];
      const piece = [s1 - s0, 0, at(s0)];
      for (let i = 0; i < m; i++) if (st[i] > s0 + 0.01 && st[i] < s1 - 0.01) piece.push(st[i] - s0, z[i]);
      piece.push(s1 - s0, at(s1));
      out.push(piece);
    }
    return out;
  }

  /** Section id for a raster / pick code. */
  sectionOfCode(code: number): Id | undefined { return code > 0 ? this.codeSec[code] : undefined; }

  private code(id: Id) {
    let c = this.secCode.get(id);
    if (c === undefined) { c = this.codeSec.length; this.codeSec.push(id); this.secCode.set(id, c); }
    return c;
  }

  typeOf(s: SectionObj): RoadType {
    const t = typeFromParts(s.parts, { surface: s.surface, major: isMajorClass(s.cls) });
    const have = this.types.get(t.id);
    if (have) return have;
    this.types.set(t.id, t);
    return t;
  }

  /** Control polygon of a section's anchors with the ends snapped to its junctions. */
  anchors(s: SectionObj, A = this.doc.get<'junction'>(s.a), B = this.doc.get<'junction'>(s.b)) {
    const P = s.path.map((p) => ({ ...p }));
    if (A) { P[0].x = A.x; P[0].z = A.z; P[0].lift = A.lift; }
    if (B) { const l = P[P.length - 1]; l.x = B.x; l.z = B.z; l.lift = B.lift; }
    return P;
  }

  /** Cubic control points of each piece (x0,z0,x1,z1,x2,z2,x3,z3). */
  cubics(s: SectionObj): number[][] {
    const P = this.anchors(s);
    const out: number[][] = [];
    for (let k = 0; k < P.length - 1; k++) {
      const a = P[k], b = P[k + 1];
      out.push([a.x, a.z, a.x + a.ox, a.z + a.oz, b.x + b.ix, b.z + b.iz, b.x, b.z]);
    }
    return out;
  }

  private sectionInput(s: SectionObj): { segs: MSeg[]; shapes: MNode[] } | null {
    const A = this.doc.get<'junction'>(s.a), B = this.doc.get<'junction'>(s.b);
    if (!A || !B || s.path.length < 2) return null;
    const P = this.anchors(s, A, B);
    const t = this.typeOf(s);
    const elevated = s.elevated || P.some((p) => p.lift > 0.25);
    // graded (fixed profile, ground cut / filled to it) unless it's a bridge or tunnel
    const grade = !elevated && !P.some((p) => p.lift < -0.25) ? this.gradePieces(s, P) : null;
    const code = this.code(s.id);
    const segs: MSeg[] = [], shapes: MNode[] = [];
    for (let k = 1; k < P.length - 1; k++) shapes.push({ id: `${s.id}^${k}`, x: P[k].x, z: P[k].z, lift: P[k].lift });
    for (let k = 0; k < P.length - 1; k++) {
      const a = P[k], b = P[k + 1];
      if (Math.hypot(b.x - a.x, b.z - a.z) < 0.05) continue;
      segs.push({
        id: `${s.id}~${k}`, a: k === 0 ? s.a : `${s.id}^${k}`, b: k === P.length - 2 ? s.b : `${s.id}^${k + 1}`,
        p: [a.x, a.z, a.x + a.ox, a.z + a.oz, b.x + b.ix, b.z + b.iz, b.x, b.z],
        t, cls: s.cls, bridge: s.bridge, elevated, viaduct: s.viaduct, code, owner: s.id, sunk: Math.min(a.lift, b.lift) < -0.25,
        ...(grade ? { grade: grade[k] } : {}),
      });
    }
    return { segs, shapes };
  }

  private junctionNode(j: JunctionObj): MNode {
    return { id: j.id, x: j.x, z: j.z, lift: j.lift, R: j.R, ringLanes: j.ringLanes, signals: j.signals, rc: j.rc, crossings: j.crossings, phases: j.phases, phase: j.phase, box: j.box, slips: j.slips };
  }

  /** Everything (initial load). */
  full(): Set<string> {
    const nodes: MNode[] = [], segs: MSeg[] = [];
    for (const j of this.doc.all('junction')) nodes.push(this.junctionNode(j));
    for (const s of this.doc.all('section')) {
      const inp = this.sectionInput(s);
      if (!inp) continue;
      nodes.push(...inp.shapes); segs.push(...inp.segs);
      this.secSegs.set(s.id, inp.segs.map((x) => x.id));
      this.secShape.set(s.id, inp.shapes.map((x) => x.id));
    }
    const changed = this.mesher.apply({ nodes, segs });
    for (const l of this.doc.all('line')) if (l.layer === 'paths') { changed.add(this.mesher.setPath(l.id, l.pts, l.size)); this.pathIds.add(l.id); }
    this.geoCache.clear();
    return changed;
  }

  /** Recompile what a document change touched. Returns changed mesh item keys. */
  update(ids: Iterable<Id>): Set<string> {
    const nodes: MNode[] = [], segs: MSeg[] = [], removeSegs: string[] = [], removeNodes: string[] = [];
    const extra = new Set<string>();
    const secs = new Set<Id>(), juncs = new Set<Id>();
    for (const id of ids) {
      this.geoCache.delete(id);
      const o = this.doc.get(id);
      const kindGuess = o?.kind ?? (this.secSegs.has(id) ? 'section' : this.mesher.nodes.has(id) ? 'junction' : this.pathIds.has(id) ? 'line' : undefined);
      if (kindGuess === 'section') secs.add(id);
      else if (kindGuess === 'junction') { juncs.add(id); for (const s of this.doc.sectionsAt(id)) secs.add(s.id); }
      else if (kindGuess === 'line') {
        if (o?.kind === 'line' && o.layer === 'paths') { extra.add(this.mesher.setPath(id, o.pts, o.size)); this.pathIds.add(id); }
        else if (this.pathIds.has(id)) { extra.add(this.mesher.setPath(id, null)); this.pathIds.delete(id); }
      }
    }
    for (const id of juncs) {
      const j = this.doc.get<'junction'>(id);
      if (j) nodes.push(this.junctionNode(j)); else removeNodes.push(id);
    }
    for (const id of secs) {
      this.geoCache.delete(id);
      const s = this.doc.get<'section'>(id);
      const oldSegs = this.secSegs.get(id) ?? [], oldShapes = this.secShape.get(id) ?? [];
      const inp = s ? this.sectionInput(s) : null;
      const newSegs = new Set(inp?.segs.map((x) => x.id) ?? []), newShapes = new Set(inp?.shapes.map((x) => x.id) ?? []);
      for (const x of oldSegs) if (!newSegs.has(x)) removeSegs.push(x);
      for (const x of oldShapes) if (!newShapes.has(x)) removeNodes.push(x);
      if (inp) {
        nodes.push(...inp.shapes); segs.push(...inp.segs);
        this.secSegs.set(id, [...newSegs]); this.secShape.set(id, [...newShapes]);
        // ends must exist as nodes
        for (const jid of [s!.a, s!.b]) if (!this.mesher.nodes.has(jid) && !juncs.has(jid)) { const j = this.doc.get<'junction'>(jid); if (j) nodes.push(this.junctionNode(j)); }
      } else { this.secSegs.delete(id); this.secShape.delete(id); }
    }
    // junctions removed after their sections
    const changed = this.mesher.apply({ nodes, segs, removeSegs, removeNodes: [] });
    if (removeNodes.length) for (const k of this.mesher.apply({ removeNodes })) changed.add(k);
    for (const k of extra) changed.add(k);
    return changed;
  }

  /** Sampled geometry of a section (from the mesher's pieces), for drawing outlines and hit tests. */
  geo(id: Id): SectionGeo | undefined {
    const c = this.geoCache.get(id);
    if (c !== undefined) return c ?? undefined;
    const segIds = this.secSegs.get(id);
    const s = this.doc.get<'section'>(id);
    if (!segIds?.length || !s) { this.geoCache.set(id, null); return undefined; }
    const pts: number[] = [], nrm: number[] = [], cum: number[] = [];
    let acc = 0;
    for (const sid of segIds) {
      const g = this.mesher.geos.get(sid);
      if (!g) continue;
      const n = g.pts.length / 2;
      for (let i = pts.length ? 1 : 0; i < n; i++) {
        pts.push(g.pts[i * 2], g.pts[i * 2 + 1]); nrm.push(g.nrm[i * 2], g.nrm[i * 2 + 1]); cum.push(acc + g.cum[i]);
      }
      acc += g.len;
    }
    const t = this.typeOf(s);
    const hw = Math.max(t.hwL, t.hwR);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); z0 = Math.min(z0, pts[i + 1]); z1 = Math.max(z1, pts[i + 1]); }
    const geo: SectionGeo = { id, pts: new Float32Array(pts), nrm: new Float32Array(nrm), cum: new Float32Array(cum), len: acc, t, x0: x0 - hw, z0: z0 - hw, x1: x1 + hw, z1: z1 + hw };
    this.geoCache.set(id, geo);
    return geo;
  }

  /** Junction surface outline (if the junction has one). */
  junctionRing(id: Id): V2[] | undefined { return this.mesher.junctions.get(id)?.ring; }
}
