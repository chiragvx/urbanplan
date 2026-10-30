// Streams a region's pieces around the camera. The window (3 × 3 pieces of 2 km) follows the point you're looking at:
// when it leaves the centre piece (with a margin, so hovering on an edge doesn't flip back and forth), the missing
// pieces are fetched, then in one step the terrain grid moves, the document trades the objects of the pieces that
// left for those that arrived (roads compile incrementally), and the world re-cuts the ground and rebuilds what's
// grid-based. Neighbouring pieces are prefetched, so a move usually waits on nothing but the build.
import type { CityDoc } from '../doc/doc';
import type { Compiler } from '../doc/compile';
import type { Heightfield } from '../geo/heightfield';
import type { World } from '../scene/world';
import type { TerrainCompiler } from '../doc/terrain';
import type { Id, Obj, SectionObj } from '../doc/types';
import { buildingObj } from '../doc/base';
import { clampCentre, fetchPiece, parsePiece, windowPieces, windowTile, WINDOW_RADIUS, type Piece, type RawPiece, type RegionManifest } from '../data/region';
import type { TileData } from '../data/tile';

type Region = [number, number, number, number];

/** how far (m) the focus may stray past the centre piece before the window follows */
const HYSTERESIS = 384;
/** pieces kept downloaded (the window, the ring around it, and recent ones) — parsed only while in the window */
const CACHE = 30;

export class RegionStream {
  /** parsed pieces: the window's */
  private cache = new Map<string, Piece>();
  /** downloaded pieces (most recent last) */
  private raw = new Map<string, Promise<RawPiece>>();
  private used: string[] = [];
  /** ids of base objects that came from pieces (paged in / out); roads, rail and layers are city-wide */
  private paged = new Set<Id>();
  ci = 0; cj = 0;
  private moving = false;
  /** last move: what it took */
  stats = { ms: 0, added: 0, removed: 0, pieces: 0, steps: {} as Record<string, number> };
  onMoved: (tile: TileData) => void = () => {};

  doc!: CityDoc;
  C!: Compiler;
  hf!: Heightfield;
  private world: () => World | undefined = () => undefined;
  private terrain: () => TerrainCompiler | undefined = () => undefined;

  constructor(readonly M: RegionManifest, readonly base: string) {}

  /** The document, compiler and heightfield the window feeds (made from the first window). */
  attach(doc: CityDoc, C: Compiler, hf: Heightfield, world: () => World | undefined, terrain: () => TerrainCompiler | undefined) {
    this.doc = doc; this.C = C; this.hf = hf; this.world = world; this.terrain = terrain;
  }

  /** The piece a point is in. */
  pieceOf(x: number, z: number): [number, number] { return [Math.floor(x / this.M.piece), Math.floor(z / this.M.piece)]; }
  key(i: number, j: number) { return `${i}_${j}`; }
  get resident(): Set<string> { return new Set(windowPieces(this.M, this.ci, this.cj).map(([i, j]) => this.key(i, j))); }
  /** The world square the window covers. */
  get rect(): Region { const P = this.M.piece, r = WINDOW_RADIUS; return [(this.ci - r) * P, (this.cj - r) * P, (this.ci + r + 1) * P, (this.cj + r + 1) * P]; }

  /** A piece downloaded (from the cache, or fetched now). */
  private download(i: number, j: number): Promise<RawPiece> {
    const k = this.key(i, j);
    let p = this.raw.get(k);
    if (!p) { p = fetchPiece(this.base, i, j); this.raw.set(k, p); p.catch(() => this.raw.delete(k)); }
    this.touch(k);
    return p;
  }

  /** A piece parsed (it's about to be in the window). */
  async piece(i: number, j: number): Promise<Piece> {
    const k = this.key(i, j);
    const have = this.cache.get(k);
    if (have) { this.touch(k); return have; }
    const p = parsePiece(await this.download(i, j), i, j);
    this.cache.set(k, p);
    return p;
  }

  private touch(k: string) { this.used = this.used.filter((x) => x !== k); this.used.push(k); }
  private evict() {
    const keep = this.resident;
    for (const k of [...this.cache.keys()]) if (!keep.has(k)) this.cache.delete(k);
    while (this.raw.size > CACHE) {
      const k = this.used.find((x) => !keep.has(x) && this.raw.has(x));
      if (!k) break;
      this.raw.delete(k); this.used = this.used.filter((x) => x !== k);
    }
  }

  /** First window (boot): its pieces, as tile data, plus the base objects they bring. */
  async open(x: number, z: number): Promise<{ tile: TileData; objs: Obj[] }> {
    [this.ci, this.cj] = clampCentre(this.M, ...this.pieceOf(x, z));
    const list = windowPieces(this.M, this.ci, this.cj);
    await Promise.all(list.map(([i, j]) => this.piece(i, j)));
    const objs = this.objsOf(list);
    for (const o of objs) this.paged.add(o.id);
    this.prefetch();
    return { tile: windowTile(this.M, this.ci, this.cj, this.cache), objs };
  }

  private objsOf(list: [number, number][]): Obj[] {
    const out = new Map<Id, Obj>();
    for (const [i, j] of list) {
      const p = this.cache.get(this.key(i, j));
      if (!p) continue;
      for (const o of p.objs) out.set(o.id, o);
      for (const b of p.buildings) { const id = 'b' + b.osm; if (!out.has(id)) out.set(id, buildingObj(b, id, b.osm)); }
    }
    return [...out.values()];
  }

  /** Neighbours of the window, fetched in the background. */
  private prefetch() {
    const r = WINDOW_RADIUS + 1;
    for (let j = this.cj - r; j <= this.cj + r; j++) for (let i = this.ci - r; i <= this.ci + r; i++) {
      if (i < this.M.grid.i0 || i > this.M.grid.i1 || j < this.M.grid.j0 || j > this.M.grid.j1) continue;
      void this.download(i, j).catch(() => {});
    }
  }

  /** Should the window move for this focus point? Returns the new centre piece, or null. */
  wants(x: number, z: number): [number, number] | null {
    const P = this.M.piece;
    const x0 = this.ci * P - HYSTERESIS, x1 = (this.ci + 1) * P + HYSTERESIS, z0 = this.cj * P - HYSTERESIS, z1 = (this.cj + 1) * P + HYSTERESIS;
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return null;
    const [ci, cj] = clampCentre(this.M, ...this.pieceOf(x, z));
    return ci === this.ci && cj === this.cj ? null : [ci, cj];
  }

  get busy() { return this.moving; }

  /**
   * Move the window so its centre piece is (ci, cj), spread over frames so the view stays live: the pieces that
   * left go, the grids shift, then each arriving piece is paged in and settled on a frame of its own.
   */
  async moveTo(ci: number, cj: number): Promise<boolean> {
    if (this.moving) return false;
    this.moving = true;
    try {
      const list = windowPieces(this.M, ci, cj);
      await Promise.all(list.map(([i, j]) => this.piece(i, j)));
      const t0 = performance.now();
      const steps: Record<string, number> = {};
      let tl = t0, busy = 0;
      const lap = (k: string) => { const t = performance.now(); steps[k] = (steps[k] ?? 0) + Math.round(t - tl); busy = Math.max(busy, t - tl); tl = t; };
      const yieldFrame = async () => { await nextFrame(); tl = performance.now(); };
      const oldRect = this.rect;
      const before = this.resident;
      this.ci = ci; this.cj = cj;
      const tile = windowTile(this.M, ci, cj, this.cache);
      const W = this.world();
      // 1. the pieces that left: their objects out
      const keep = new Set(this.objsOf(list).map((o) => o.id));
      const remove = [...this.paged].filter((id) => !keep.has(id));
      for (const id of remove) this.paged.delete(id);
      this.doc.page([], remove);
      lap('leave');
      await yieldFrame();
      // 2. the ground and the grids that follow it move (the overlap carries over)
      this.hf.reset(tile.ox!, tile.oz!, tile.terrain.heights);
      this.terrain()?.full();
      W?.beginMove(tile);
      this.onMoved(tile);
      // roads reaching past the old window's edge were built on clamped ground: build them again
      const inner: Region = [oldRect[0] + 40, oldRect[1] + 40, oldRect[2] - 40, oldRect[3] - 40];
      const edge = this.doc.all('section').filter((s) => crosses(s, inner)).map((s) => s.id);
      if (edge.length) { const items = this.C.update(edge); W?.onChange({ ids: new Set(edge), structural: false, origin: 'page', label: '' }, items); }
      lap('shift');
      await yieldFrame();
      // 3. each arriving piece: its objects in (roads compile), then the ground cut and its terrain, trees, buildings
      const fresh = list.filter(([i, j]) => !before.has(this.key(i, j)));
      let added = 0;
      for (const [i, j] of fresh) {
        const add = this.objsOf([[i, j]]).filter((o) => !this.paged.has(o.id));
        for (const o of add) this.paged.add(o.id);
        added += add.length;
        this.doc.page(add, []);
        lap('page');
        await yieldFrame();
        W?.settle([i * this.M.piece, j * this.M.piece, (i + 1) * this.M.piece, (j + 1) * this.M.piece]);
        lap('settle');
        await yieldFrame();
      }
      W?.endMove();
      lap('end');
      this.stats = { ms: Math.round(performance.now() - t0), added, removed: remove.length, pieces: fresh.length, steps: { ...steps, longest: Math.round(busy) } };
      this.prefetch();
      this.evict();
      return true;
    } finally {
      this.moving = false;
    }
  }
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** Does a section's control polygon cross the rectangle's edge (part inside, part outside)? */
function crosses(s: SectionObj, r: Region): boolean {
  let inside = false, outside = false;
  for (const a of s.path) {
    if (a.x >= r[0] && a.x <= r[2] && a.z >= r[1] && a.z <= r[3]) inside = true; else outside = true;
    if (inside && outside) return true;
  }
  return false;
}
