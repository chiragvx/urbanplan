// What a scene gets to build and measure with: the document and its edit operations (the same ones the editor and
// `npm run map -- apply` scripts use), plus helpers that read junction arms and crossings off the compiled geometry.
import type { CityDoc } from '../doc/doc';
import type { Compiler } from '../doc/compile';
import type { Heightfield } from '../geo/heightfield';
import { CityApi } from '../doc/api';
import * as ops from '../doc/ops';
import * as xs from '../doc/xsection';
import { VERGE_KINDS, partOffsets, type Part, type PartKind } from '../net/model';
import type { Id, JunctionObj, SectionObj } from '../doc/types';
import type { V2 } from './types';
// (plots, Plot Twist)
import type { PlotObj } from '../doc/types';
import type { Place } from './types';
import { analysePlot, centroid, inset, sideMargin, type PlotCode, type PlotReport, type PlotUse } from '../doc/plot';
import { solveSite, type PlotSite, type SiteReport } from '../doc/site';
import { DEFAULT_DESIGN, siteDefaults, siteFor, type Design } from '../doc/optimise';

export type Dir = 'N' | 'E' | 'S' | 'W';

/** A junction arm: its section, whether the section starts at the junction, and the outward direction. */
export interface Arm { s: SectionObj; out: boolean; ux: number; uz: number; dir: Dir }

/** Where an arm's zebra crosses it: kerb to kerb across the carriageway, and the stretches between refuges. */
export interface Crossing {
  line: [V2, V2]; mid: V2; kerb: number; runs: number[]; longest: number;
  /** most lanes crossed in one go */ lanes: number;
  /** the middle of each refuge on the line */ refuges: V2[];
  ux: number; uz: number;
}

// ---- road stretches (What If): types ----
/** One block of a stretch: a section between two junctions, and whether it runs the way the stretch is read (p → q). */
export interface Block { s: SectionObj; fwd: boolean }
/** A strip of a block's compiled cross-section looking along the stretch: offsets left-positive from the centre line. */
export interface Strip { kind: PartKind; width: number; dir: 1 | -1 | 0; o0: number; o1: number }
/** a parked car's length (m): spaces per parking strip = kerb length / this */
export const BAY = 5.5;

export class Kit {
  readonly city: CityApi;
  readonly ops = ops;
  readonly xs = xs;
  constructor(readonly doc: CityDoc, readonly C: Compiler, readonly hf: Heightfield) { this.city = new CityApi(doc); }

  ground(x: number, z: number) { return this.hf.sampleSurface(x, z); }

  junctionNear(x: number, z: number): JunctionObj {
    let best: JunctionObj | null = null, d = Infinity;
    for (const j of this.doc.all('junction')) { const e = Math.hypot(j.x - x, j.z - z); if (e < d) { d = e; best = j; } }
    if (!best) throw new Error('no junction on the set');
    return best;
  }

  arms(j: Id): Arm[] {
    const J = this.doc.get<'junction'>(j)!;
    return this.doc.sectionsAt(j).map((s) => {
      const out = s.a === j;
      const P = s.path, q = out ? P[1] : P[P.length - 2];
      const l = Math.hypot(q.x - J.x, q.z - J.z) || 1, ux = (q.x - J.x) / l, uz = (q.z - J.z) / l;
      const dir: Dir = Math.abs(ux) > Math.abs(uz) ? (ux > 0 ? 'E' : 'W') : uz > 0 ? 'S' : 'N';
      return { s, out, ux, uz, dir };
    });
  }

  arm(j: Id, dir: Dir): Arm {
    const a = this.arms(j).find((x) => x.dir === dir);
    if (!a) throw new Error(`no ${dir} arm at ${j}`);
    return a;
  }

  /** Parts written left → right looking out from the junction, as the arm's section needs them. */
  orient(arm: Arm, parts: Part[]): Part[] { return arm.out ? parts.map((p) => ({ ...p })) : xs.flip(parts); }

  /** The compiled piece of an arm next to its junction, and how far in from the junction its trim line is. */
  private piece(arm: Arm, j: Id) {
    for (const g of this.C.mesher.geos.values()) {
      if (g.s.owner !== arm.s.id || (g.s.a !== j && g.s.b !== j)) continue;
      const atA = g.s.a === j;
      return { g, atA, trim: atA ? g.trimA : g.len - g.trimB };
    }
    return null;
  }

  /** The zebra on an arm (2.1 m out from the junction's trim line, where the stripes' middle is). */
  crossing(j: Id, dir: Dir): Crossing {
    const arm = this.arm(j, dir), pc = this.piece(arm, j);
    if (!pc) throw new Error(`arm ${dir} not compiled`);
    const { g, atA } = pc;
    const s = atA ? pc.trim + 2.1 : pc.trim - 2.1;
    // sample the piece's centre line at s
    let i = 1;
    while (i < g.cum.length - 1 && g.cum[i] < s) i++;
    const f = (s - g.cum[i - 1]) / ((g.cum[i] - g.cum[i - 1]) || 1);
    const x = g.pts[(i - 1) * 2] + (g.pts[i * 2] - g.pts[(i - 1) * 2]) * f, z = g.pts[(i - 1) * 2 + 1] + (g.pts[i * 2 + 1] - g.pts[(i - 1) * 2 + 1]) * f;
    const nx = g.nrm[i * 2], nz = g.nrm[i * 2 + 1];
    const t = g.t;
    const line: [V2, V2] = [[x + nx * t.cwL, z + nz * t.cwL], [x - nx * t.cwR, z - nz * t.cwR]];
    // stretches of carriageway between refuges (medians and planters wide enough to stand on)
    const P = t.parts;
    let a = 0, b = P.length - 1;
    while (a <= b && VERGE_KINDS.includes(P[a].kind)) a++;
    while (b >= a && VERGE_KINDS.includes(P[b].kind)) b--;
    const runs: number[] = [], refuges: V2[] = [];
    let run = 0, lanes = 0, most = 0, o = t.cwL;
    const at = (off: number): V2 => [x + nx * off, z + nz * off];
    for (let k = a; k <= b; k++) {
      const p = P[k];
      if ((p.kind === 'median' || p.kind === 'planter') && p.width >= 1.2) { if (run) runs.push(run); run = 0; most = Math.max(most, lanes); lanes = 0; refuges.push(at(o - p.width / 2)); }
      else if (p.kind !== 'median' && p.kind !== 'planter') { run += p.width; if (p.kind === 'lane' || p.kind === 'bus') lanes++; }
      o -= p.width;
    }
    if (run) runs.push(run);
    most = Math.max(most, lanes);
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return { line, mid: [x, z], kerb: r1(t.cwL + t.cwR), runs: runs.map(r1), longest: r1(Math.max(0, ...runs)), lanes: most, refuges, ux: arm.ux, uz: arm.uz };
  }

  /**
   * The kerb corner radius, measured off the compiled junction outline: its corners are arcs round the back of the
   * footpath, so the commonest radius along the outline (circumradius of each three points) less the footpath is the
   * kerb's. Rounded to 0.5 m.
   */
  cornerRadius(j: Id): number {
    const R = this.C.junctionRing(j);
    if (!R || R.length < 6) return 0;
    const radii: number[] = [];
    for (let i = 0; i < R.length; i++) {
      const a = R[(i + R.length - 1) % R.length], b = R[i], c = R[(i + 1) % R.length];
      const A = Math.hypot(b[0] - c[0], b[1] - c[1]), B = Math.hypot(a[0] - c[0], a[1] - c[1]), C = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
      if (cross > 1e-6) radii.push((A * B * C) / (2 * cross));
    }
    // the commonest radius (0.5 m bins): the corner arcs, not the odd vertex where an arm meets them
    const bins = new Map<number, number>();
    for (const r of radii) { const k = Math.round(r * 2) / 2; bins.set(k, (bins.get(k) ?? 0) + 1); }
    const arc = [...bins].sort((p, q) => q[1] - p[1])[0][0];
    const walk = Math.min(...this.arms(j).map((a) => { const P = this.C.typeOf(a.s).parts; return VERGE_KINDS.includes(P[0].kind) ? P[0].width : 0; }));
    return Math.round((arc - walk) * 2) / 2;
  }

  /** Area (m²) of a junction's paved box (the compiled outline). */
  junctionArea(j: Id): number {
    const R = this.C.junctionRing(j);
    if (!R) return 0;
    let A = 0;
    for (let i = 0, k = R.length - 1; i < R.length; k = i++) A += R[k][0] * R[i][1] - R[i][0] * R[k][1];
    return Math.abs(A / 2);
  }

  /** A circle of points on the ground. */
  circle(c: V2, r: number, n = 48): V2[] { return Array.from({ length: n }, (_, i) => [c[0] + Math.cos((i / n) * Math.PI * 2) * r, c[1] + Math.sin((i / n) * Math.PI * 2) * r] as V2); }

  /** Points every `step` metres along a section's centre line, offset `off` metres to its left (negative: right), skipping `skip` metres at each end. */
  along(s: Id, off: number, step: number, skip = 0): V2[] {
    const g = this.C.geo(s);
    if (!g) return [];
    const out: V2[] = [];
    for (let d = skip; d <= g.len - skip; d += step) {
      let i = 1;
      while (i < g.cum.length - 1 && g.cum[i] < d) i++;
      const f = (d - g.cum[i - 1]) / ((g.cum[i] - g.cum[i - 1]) || 1);
      const x = g.pts[(i - 1) * 2] + (g.pts[i * 2] - g.pts[(i - 1) * 2]) * f, z = g.pts[(i - 1) * 2 + 1] + (g.pts[i * 2 + 1] - g.pts[(i - 1) * 2 + 1]) * f;
      out.push([x + g.nrm[i * 2] * off, z + g.nrm[i * 2 + 1] * off]);
    }
    return out;
  }

  // ---- road stretches (What If) ----
  // A stretch is a straight run of road read from p to q, made of blocks (sections between junctions). Parts are
  // written left → right looking from p to q; widths, lengths and counts come off the compiled geometry.

  /** The blocks along a straight run from p to q: sections whose two junctions both lie on it, in order from p. */
  stretch(p: V2, q: V2): Block[] {
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]), ux = (q[0] - p[0]) / L, uz = (q[1] - p[1]) / L;
    const on = (id: Id) => { const J = this.doc.get<'junction'>(id)!, dx = J.x - p[0], dz = J.z - p[1], s = dx * ux + dz * uz; return Math.abs(dx * uz - dz * ux) < 2 && s > -2 && s < L + 2 ? s : null; };
    const out: { b: Block; s: number }[] = [];
    for (const s of this.doc.all('section')) {
      const a = on(s.a), b = on(s.b);
      if (a !== null && b !== null) out.push({ b: { s, fwd: b > a }, s: Math.min(a, b) });
    }
    if (!out.length) throw new Error(`no blocks from ${p} to ${q}`);
    return out.sort((x, y) => x.s - y.s).map((x) => x.b);
  }

  /** Give every block of a stretch this cross-section (left → right looking along the stretch). */
  setStretch(B: Block[], parts: Part[]) { for (const b of B) this.doc.set(b.s.id, 'parts', b.fwd ? parts.map((x) => ({ ...x })) : xs.flip(parts)); }

  /** A block's strips as compiled, left → right looking along the stretch. */
  strips(b: Block): Strip[] {
    const t = this.C.geo(b.s.id)?.t ?? this.C.typeOf(this.doc.get<'section'>(b.s.id)!);
    const O = partOffsets(t), S = t.parts.map((p, i) => ({ kind: p.kind, width: p.width, dir: p.dir, o0: O[i][0], o1: O[i][1] }));
    return b.fwd ? S : S.reverse().map((x) => ({ ...x, dir: (-x.dir || 0) as Strip['dir'], o0: -x.o1, o1: -x.o0 }));
  }

  /** Widths (m) of a block's strips of one kind, left → right. */
  widths(b: Block, kind: PartKind): number[] { return this.strips(b).filter((x) => x.kind === kind).map((x) => Math.round(x.width * 100) / 100); }

  /** The kerb-side run of a block: along its compiled centre line from one junction's trim line to the other's. */
  private span(b: Block) {
    const g = this.C.geo(b.s.id);
    if (!g) throw new Error(`block ${b.s.id} not compiled`);
    let tA = 0, tB = 0;
    for (const m of this.C.mesher.geos.values()) {
      if (m.s.owner !== b.s.id) continue;
      if (m.s.a === b.s.a) tA = m.trimA;
      if (m.s.b === b.s.b) tB = m.trimB;
    }
    return { g, s0: tA, s1: g.len - tB };
  }

  /** Kerb length of a block (m): junction trim line to trim line. */
  blockLength(b: Block): number { const { s0, s1 } = this.span(b); return Math.round((s1 - s0) * 10) / 10; }

  /** Parking spaces on a block: each parking strip holds its kerb length / BAY cars. */
  spaces(b: Block): number { return this.widths(b, 'parking').length * Math.floor(this.blockLength(b) / BAY); }

  /** A point a fraction f along a block's kerb run (0 at the end nearer p), `off` metres left of the centre line. */
  at(b: Block, f: number, off = 0): V2 {
    const { g, s0, s1 } = this.span(b);
    const d = b.fwd ? s0 + (s1 - s0) * f : s1 - (s1 - s0) * f;
    let i = 1;
    while (i < g.cum.length - 1 && g.cum[i] < d) i++;
    const u = (d - g.cum[i - 1]) / ((g.cum[i] - g.cum[i - 1]) || 1), k = b.fwd ? off : -off;
    const x = g.pts[(i - 1) * 2] + (g.pts[i * 2] - g.pts[(i - 1) * 2]) * u, z = g.pts[(i - 1) * 2 + 1] + (g.pts[i * 2 + 1] - g.pts[(i - 1) * 2 + 1]) * u;
    return [x + g.nrm[i * 2] * k, z + g.nrm[i * 2 + 1] * k];
  }

  /** Across a strip (index into strips()) at fraction f: outer edge to inner edge, for a dimension mark. */
  across(b: Block, i: number, f: number): [V2, V2] { const x = this.strips(b)[i]; return [this.at(b, f, x.o0), this.at(b, f, x.o1)]; }

  /** The middle of a strip at fraction f (tags, camera targets). */
  mid(b: Block, i: number, f: number): V2 { const x = this.strips(b)[i]; return this.at(b, f, (x.o0 + x.o1) / 2); }

  /** A strip's outline from fraction f0 to f1 along the block (a ring mark that picks the strip out). */
  outline(b: Block, i: number, f0 = 0.03, f1 = 0.97): V2[] {
    const x = this.strips(b)[i], n = 12, side = (o: number) => Array.from({ length: n + 1 }, (_, k) => this.at(b, f0 + ((f1 - f0) * k) / n, o));
    return [...side(x.o0 - 0.15), ...side(x.o1 + 0.15).reverse()];
  }

  /** Points every `step` m down the middle of a strip, `skip` m clear of each junction (trees in a planter). */
  down(b: Block, i: number, step: number, skip = 0): V2[] {
    const L = this.blockLength(b), n = Math.floor((L - 2 * skip) / step), out: V2[] = [];
    if (n < 0) return out;
    const x = this.strips(b)[i], m = (x.o0 + x.o1) / 2, pad = (L - n * step) / 2;
    for (let k = 0; k <= n; k++) out.push(this.at(b, (pad + k * step) / L, m));
    return out;
  }

  // ---- plots (Plot Twist) ----
  // One plot per scene, vacant to begin with. Its numbers are Site Studio's own: the rules for the road it fronts
  // (doc/plot), the scheme the optimiser finds (doc/optimise) and that scheme solved (doc/site). The 3D is the
  // studio's realistic model (build/plotmesh), cut down to the floors that are up so far.

  /** the scene's plot, the rules it's under (Pune's UDCPR, or Mumbai's DCPR 2034) and the scheme asked for */
  plotId: Id | null = null;
  plotCode: PlotCode = 'udcpr';
  plotDesign: Design = { ...DEFAULT_DESIGN };
  private planned: { key: string; r: PlotReport; site: PlotSite; d: SiteReport } | null = null;

  /** A road cross-section `w` m wide, footpaths included: lanes of about 3.5 m each way, a median from 24 m. */
  crossSection(w: number): Part[] {
    const walk = w >= 24 ? 3 : w >= 15 ? 2 : 1.5, med = w >= 24 ? 3 : 0, rest = w - 2 * walk - med;
    const n = Math.max(1, Math.round(rest / 7)), lw = rest / (2 * n);
    const half = (dir: 1 | -1): Part[] => Array.from({ length: n }, () => ({ kind: 'lane', width: lw, dir }));
    const S: Part = { kind: 'sidewalk', width: walk, dir: 0 };
    return [S, ...half(1), ...(med ? [{ kind: 'median', width: med, dir: 0 } as Part] : []), ...half(-1), { ...S }];
  }

  /** Make the plot (in `before`): its outline (x, z, …), what it's for, the rules and the scheme. It starts vacant. */
  plot(ring: number[], o: { use?: PlotUse; code?: PlotCode; design?: Partial<Design>; name?: string } = {}): Id {
    const id = 'plot-film';
    this.doc.create({ kind: 'plot', id, name: o.name ?? 'Plot', ring, use: o.use ?? 'residential' });
    this.plotId = id; this.plotCode = o.code ?? 'udcpr'; this.plotDesign = { ...DEFAULT_DESIGN, ...o.design };
    return id;
  }

  private plotObj(): PlotObj {
    const o = this.plotId ? this.doc.get<'plot'>(this.plotId) : undefined;
    if (!o) throw new Error('no plot: make one with k.plot() in before');
    return o;
  }

  /** The plot against the map as it is now. */
  plotReport(): PlotReport {
    const near = (x0: number, z0: number, x1: number, z1: number) => [...this.doc.ids('section')].filter((id) => { const g = this.C.geo(id); return !!g && g.x1 >= x0 && g.x0 <= x1 && g.z1 >= z0 && g.z0 <= z1; });
    return analysePlot(this.doc, this.C, near, this.plotObj(), this.plotCode);
  }

  /** The scheme for the plot as the map is now: its report, the optimised site and that site solved (worked out once
   *  per road width and rules, not per floor). */
  plotPlan() {
    const o = this.plotObj(), r = this.plotReport();
    const key = JSON.stringify([o.ring, o.use, r.roadW, r.rules, this.plotCode, this.plotDesign]);
    if (this.planned?.key !== key) {
      const site = siteFor({ ...siteDefaults(o.use), design: this.plotDesign }, r, o.use);
      this.planned = { key, r, site, d: solveSite(r, site, o.use) };
    }
    return this.planned;
  }

  /** Put the scheme up to n floors (0: the stilt and the site works alone; null: the plot vacant again). The plot
   *  keeps the solved site and, as a film note, how many of its floors are up: undo and redo step through them. */
  plotFloors(n: number | null) {
    const id = this.plotObj().id;
    if (n === null) { this.doc.set(id, 'site', undefined); return; }
    const { site } = this.plotPlan();
    this.doc.set(id, 'site', { ...site, manual: true, notes: { ...site.notes, film: String(n) } });
  }

  /** how many floors are up (null: vacant) */
  plotUp(): number | null { const f = this.plotObj().site?.notes?.film; return f === undefined ? null : Number(f); }

  /** For the 3D: the plot, its report and the solved site cut down to the floors that are up. Null while it's
   *  vacant; undefined when the scene has no plot. */
  plotModel(): { o: PlotObj; r: PlotReport; d: SiteReport } | null | undefined {
    if (!this.plotId) return undefined;
    const n = this.plotUp();
    if (n === null) return null;
    const { r, d } = this.plotPlan(), fh = r.rules.floorH;
    const buildings = d.buildings.map((b) => {
      const floors = Math.min(n, b.floors), h = (floors + d.under) * fh;
      // (a tower on its way up keeps its apartment look: plotmesh dresses anything up to 12 m as a house)
      return { ...b, floors, height: b.height > 12 ? Math.max(h, 12.01) : h, overHeight: h > r.rules.maxH + 1e-6 };
    });
    return { o: this.plotObj(), r, d: { ...d, buildings } };
  }

  /** The plot's numbers: the plot, the rules (`fsiX`, `ancX`: the floor space without and with the ancillary share, in
   *  plots), the solved scheme (`floors` and `height` are the scheme's, whatever is up), and what's up now (`up` floors,
   *  `upH` metres). */
  plotValues(): Record<string, number> {
    const { r, d } = this.plotPlan(), R = r.rules, up = this.plotUp();
    const floors = Math.max(0, ...d.buildings.map((b) => b.floors));
    return {
      area: r.area, road: r.roadW, fsi: r.fsi, basic: R.basic, premium: R.premium, tdr: R.tdr, anc: R.ancillary * 100,
      times: r.bua / (r.area || 1), fsiX: (r.bua - r.parts.ancillary) / (r.area || 1), ancX: r.parts.ancillary / (r.area || 1), bua: r.bua, front: R.front, side0: R.side, side: sideMargin(R, d.height), maxH: R.maxH,
      buildings: d.buildings.length, floors, height: d.height, flats: d.flats, cars: d.parking.cars, bays: d.parking.have,
      basements: d.site.basements, stilt: d.site.stilt ? 1 : 0, coverage: d.coverage * 100, used: d.bua, left: d.left,
      up: up ?? 0, upH: up === null ? 0 : (Math.min(up, floors) + d.under) * R.floorH,
    };
  }

  /** The plot's places: its outline (`plot`), the middle of its front, the road across (kerb line to kerb line), the
   *  setback low down (`setbackLow`) and at the scheme's height (`setback`), the margins as dimension lines (`frontDim`,
   *  `sideDim`, `sideDim2`) and the building's middle. */
  plotPlaces(): Record<string, Place> {
    const { r, d } = this.plotPlan(), R = r.rules, net = r.net, n = net.length / 2;
    const ring = (f: number[]): V2[] => Array.from({ length: f.length / 2 }, (_, i) => [f[i * 2], f[i * 2 + 1]] as V2);
    // an edge of the (counter-clockwise) net plot: its middle, its direction and its inward normal
    const edge = (k: number) => {
      const i = k * 2, j = ((k + 1) % n) * 2, ex = net[j] - net[i], ez = net[j + 1] - net[i + 1], L = Math.hypot(ex, ez) || 1;
      return { m: [(net[i] + net[j]) / 2, (net[i + 1] + net[j + 1]) / 2] as V2, ux: ex / L, uz: ez / L, nx: -ez / L, nz: ex / L };
    };
    const into = (e: ReturnType<typeof edge>, s: number): [V2, V2] => [e.m, [e.m[0] + e.nx * s, e.m[1] + e.nz * s]];
    const F = edge(Math.max(0, r.edges.indexOf(true)));
    // the sides: edges across the front (the rear runs along it)
    const sides = Array.from({ length: n }, (_, k) => k).filter((k) => !r.edges[k] && Math.abs(edge(k).ux * F.ux + edge(k).uz * F.uz) < 0.5).map(edge);
    const side = sideMargin(R, d.height);
    // the road: out from the front's middle, its centre line as far as it is
    let road: [V2, V2] = [F.m, F.m];
    const g = r.road ? this.C.geo(r.road.id) : undefined;
    if (g) {
      let dc = Infinity;
      for (let i = 0; i + 3 < g.pts.length; i += 2) {
        const ax = g.pts[i], az = g.pts[i + 1], dx = g.pts[i + 2] - ax, dz = g.pts[i + 3] - az, L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((F.m[0] - ax) * dx + (F.m[1] - az) * dz) / L2));
        dc = Math.min(dc, Math.hypot(F.m[0] - ax - dx * t, F.m[1] - az - dz * t));
      }
      const at = (s: number): V2 => [F.m[0] - F.nx * s, F.m[1] - F.nz * s];
      road = [at(dc - r.roadW / 2), at(dc + r.roadW / 2)];
    }
    const q = d.buildings.flatMap((b) => b.quads).flat();
    const places: Record<string, Place> = {
      plot: { ring: ring(net), p: centroid(net) }, front: { p: F.m }, road: { line: road },
      setbackLow: { ring: ring(inset(net, r.edges, R.front, R.side)) }, setback: { ring: ring(inset(net, r.edges, R.front, side)) },
      frontDim: { line: into(F, R.front) },
      building: { p: q.length ? centroid(q) : centroid(net) },
    };
    sides.forEach((e, i) => { places[i ? `sideDim${i + 1}` : 'sideDim'] = { line: into(e, side) }; });
    return places;
  }
}
