// The rendered city, driven by the City Document. Roads update the moment they're edited; the things that react to
// roads (terrain carving, buildings shrunk away from roads, trees, rail snapping) refresh lazily per region —
// on idle or when the 3D view is opened.
import * as THREE from 'three/webgpu';
import { texture, vertexColor, vec3, mix, float, uniform } from 'three/tsl';
import { GeomBuilder, appendInto, rgbHex } from '../build/geom';
import { buildBuildings, resolveConflicts } from '../build/buildings';
import { buildRail } from '../build/rail';
import { buildTerrainPatch, buildTerrainSkirt, buildWater } from '../build/terrain';
import { shiftInto } from '../geo/heightfield';
import { placeTrees, treeGeometry, type TreeInstance } from '../build/vegetation';
import { landuseRect, landuseUV, type Materials } from '../render/materials';
import type { Building, TileData } from '../data/tile';
import type { Heightfield } from '../geo/heightfield';
import { RoadRaster } from '../geo/roadraster';
import { MESH_LAYERS, type MeshLayer, type Packed } from '../net/generate';
import type { Compiler } from '../doc/compile';
import type { CityDoc, Change } from '../doc/doc';
import type { BuildingObj, Id, LineObj } from '../doc/types';
import { LINE_COLOR } from '../doc/base';
import { ChunkSet, type ChunkItem } from './chunks';
import { releaseAfterUpload } from '../render/release';
import { buildAssets3d, carves, stampChannel, type AssetItem } from '../build/assets3d';
import { assetOf, lineShape } from '../assets';
import type { Graphics } from '../render/engine';
import earcut from 'earcut';
import { TerrainHoles } from './holes';

type Region = [number, number, number, number];

/** terrain / tree chunk size (m): a piece of a region is 4 × 4 of them, so chunks survive window moves */
const CHUNK = 512;
interface TChunk { key: string; wx0: number; wz0: number; wx1: number; wz1: number; cx: number; cz: number; radius: number; hi: THREE.Mesh; lo: THREE.Mesh }
interface TreeChunk { list: TreeInstance[]; hi: THREE.InstancedMesh; lo: THREE.InstancedMesh; cx: number; cz: number; x0: number; z0: number }

const pack = (gb: GeomBuilder): Packed | undefined => gb.idx.length
  ? { pos: new Float32Array(gb.pos), nor: new Float32Array(gb.nor), col: new Float32Array(gb.col), uv: new Float32Array(gb.uv), idx: new Uint32Array(gb.idx) }
  : undefined;

/** 0 = light plan map, 1 = dark (the dark UI theme). A uniform, so switching doesn't rebuild any pipeline. */
export const planDark = uniform(0);

/** Unlit plan-view materials (2D): flat colours, no tone mapping surprises — a light and a dark map style. */
function planMaterials(landuse: THREE.Texture) {
  const vc = () => {
    const m = new THREE.MeshBasicNodeMaterial();
    const c = vertexColor().rgb;
    m.colorNode = mix(c, c.mul(0.55).add(0.022), planDark); // dark: roads a step above the ground, kerbs lighter (linear values)
    return m;
  };
  const terrain = new THREE.MeshBasicNodeMaterial();
  const lu = texture(landuse, landuseUV()).rgb;
  terrain.colorNode = mix(mix(lu, vec3(0.93, 0.92, 0.89), float(0.35)), mix(lu, vec3(0.012, 0.014, 0.018), float(0.9)), planDark);
  const asphalt = vc(), paving = vc(), concrete = vc();
  const markings = vc();
  asphalt.polygonOffset = true; asphalt.polygonOffsetFactor = -1; asphalt.polygonOffsetUnits = -1;
  markings.polygonOffset = true; markings.polygonOffsetFactor = -4; markings.polygonOffsetUnits = -4;
  const roofs = new THREE.MeshBasicNodeMaterial();
  roofs.colorNode = mix(mix(vertexColor().rgb, vec3(0.86, 0.83, 0.78), float(0.7)), mix(vertexColor().rgb, vec3(0.042, 0.047, 0.058), float(0.8)), planDark);
  const water = new THREE.MeshBasicNodeMaterial();
  water.colorNode = mix(vec3(0.27, 0.5, 0.64), vec3(0.012, 0.044, 0.084), planDark); // linear: 0x8fbcd4 / 0x1d3b52
  return { terrain, asphalt, paving, markings, concrete, roofs, water };
}

/** Draw distances (m) per look: the simple look leans on a closer haze and drops small detail sooner. */
const DIST: Record<Graphics, { treesHi: number; treesLo: number; buildings?: number; markings: number; paving: number; terrainHi: number }> = {
  simple: { treesHi: 350, treesLo: 2200, buildings: 4500, markings: 450, paving: 1000, terrainHi: 600 },
  high: { treesHi: 700, treesLo: 6000, markings: 900, paving: 1600, terrainHi: 900 },
};

export class World {
  readonly scene: THREE.Scene;
  readonly root = new THREE.Group();
  roads!: ChunkSet<MeshLayer>;
  paths!: ChunkSet<MeshLayer>;
  buildings!: ChunkSet<'roofs'>;
  /** terrain in 512 m chunks keyed by their world position (they outlive a region's window moves) */
  terrain: TChunk[] = [];
  skirt!: THREE.Mesh;
  water!: THREE.Mesh;
  rail = new THREE.Group();
  metro = new THREE.Group();
  trees = new THREE.Group();
  utilities = new THREE.Group();
  /** pond water surfaces (terraforming) */
  ponds = new THREE.Group();
  private utilityLayers = new Map<Id, THREE.Mesh>();
  /** catalogue assets that aren't streets / tracks / pipes (canals, power lines, structures, areas), per layer */
  readonly assets = new THREE.Group();
  private assetLayers = new Map<Id, THREE.Group>();
  private assetsDirty = false;
  private assetMat: THREE.MeshLambertNodeMaterial;
  /** last extent of lines that cut the terrain (so an edit refreshes where they were) */
  private lineExtent = new Map<Id, Region>();
  /** trees in 512 m chunks keyed by their world position */
  private treeChunks = new Map<string, TreeChunk>();
  raster: RoadRaster;
  targets: Float32Array;
  /** building footprints' extents; their meshes are generated when their chunk is (not kept in memory) */
  private bItems = new Map<Id, ChunkItem>();
  /** buildings dropped because a road runs through them (not drawn, not pickable) */
  private bDropped = new Set<Id>();
  graphics: Graphics = 'simple';
  private lastExtent = new Map<string, { x0: number; z0: number; x1: number; z1: number }>();
  private dirty: Region[] = [];
  private railDirty = false;
  private utilDirty = new Set<Id>();
  plan = false;
  xray = false;
  private planM: ReturnType<typeof planMaterials>;
  /** set when something visible changed (plan view renders on demand) */
  needsRender = true;
  /** open cuts (underpass trenches): the terrain isn't drawn inside them */
  readonly holes: TerrainHoles;
  /** where the heightfield's grid was when `targets` was laid out (a region's window moves it) */
  private gx0 = 0; private gz0 = 0;

  /** a region's window (pieces stream in around the camera) rather than a whole tile */
  readonly region: boolean;

  constructor(
    scene: THREE.Scene, public tile: TileData, readonly hf: Heightfield, readonly doc: CityDoc,
    readonly C: Compiler, readonly M: Materials, readonly landuse: THREE.Texture,
  ) {
    this.scene = scene;
    this.region = tile.ox !== undefined;
    this.raster = new RoadRaster(tile.half, tile.ox, tile.oz);
    this.targets = new Float32Array(hf.n * hf.n).fill(NaN);
    this.gx0 = hf.x0; this.gz0 = hf.z0;
    this.planM = planMaterials(landuse);
    this.holes = new TerrainHoles(tile.half, tile.ox, tile.oz);
    M.terrain.maskNode = this.holes.keep;
    this.planM.terrain.maskNode = this.holes.keep;
    this.assetMat = new THREE.MeshLambertNodeMaterial();
    this.assetMat.colorNode = vertexColor().rgb;
    scene.add(this.root);
    this.root.add(this.rail, this.metro, this.trees, this.utilities, this.ponds, this.assets);
  }

  /** Initial build of everything (after compiler.full()). */
  build(progress: (f: number, msg: string) => void = () => {}) {
    const { hf, M, C } = this;
    const items = (k: string) => C.mesher.items.get(k);
    const roadMats = { asphalt: M.asphalt, paving: M.paving, markings: M.markings, concrete: M.concrete } as Record<MeshLayer, THREE.Material>;
    // big chunks: fewer draw calls (an edit re-packs a chunk's items, which is a plain copy)
    this.roads = new ChunkSet(MESH_LAYERS, { ...roadMats }, items, 800, { markings: { receive: false, maxDist: 900 }, paving: { maxDist: 1600 }, concrete: { cast: true } });
    this.paths = new ChunkSet(MESH_LAYERS, { ...roadMats }, items, 800, { paving: { maxDist: 1300 } });
    const keys = [...C.mesher.items.keys()];
    this.roads.touch(keys.filter((k) => k[0] !== 'p'));
    this.paths.touch(keys.filter((k) => k[0] === 'p'));
    this.roads.flush(); this.paths.flush();
    this.root.add(this.roads.group, this.paths.group);
    for (const [k, it] of C.mesher.items) this.lastExtent.set(k, { x0: it.x0, z0: it.z0, x1: it.x1, z1: it.z1 });

    progress(0.6, 'Fitting the ground to the roads…');
    C.mesher.stampTargets(this.targets);
    this.stampChannels();
    hf.conform(this.targets);
    this.holes.update(this.gridRect(), [...C.mesher.items.values()].flatMap((it) => it.stamps));
    C.mesher.stampRaster(this.raster);
    this.ensureTerrain(this.gridRect());
    this.skirt = new THREE.Mesh(buildTerrainSkirt(hf), M.skirt);
    this.water = new THREE.Mesh(buildWater(this.tile, hf), M.water);
    this.water.receiveShadow = true;
    this.root.add(this.skirt, this.water);

    progress(0.75, `Raising ${this.doc.ids('building').size.toLocaleString()} buildings…`);
    this.buildings = new ChunkSet(['roofs'], { roofs: M.roofs }, (k) => this.bItems.get(k), 400, { roofs: { cast: true } });
    for (const b of this.doc.all('building')) this.buildBuilding(b);
    this.buildings.touch(this.bItems.keys());
    this.buildings.flush();
    this.root.add(this.buildings.group);

    progress(0.85, 'Laying railway and metro…');
    this.buildRail();
    this.buildAssets();
    progress(0.9, 'Planting trees…');
    this.buildTrees();
  }

  /** The world square the terrain grid covers. */
  gridRect(): Region { const h = this.hf; return [h.x0, h.z0, h.x0 + 2 * h.half, h.z0 + 2 * h.half]; }

  /** Terrain chunks for every 512 m square over a rectangle (geometry built from the current heightfield). */
  private ensureTerrain(r: Region, build = true) {
    const g = this.gridRect(), C = CHUNK;
    const x0 = Math.max(r[0], g[0]), z0 = Math.max(r[1], g[1]), x1 = Math.min(r[2], g[2]), z1 = Math.min(r[3], g[3]);
    const have = new Set(this.terrain.map((c) => c.key));
    const mat = this.plan ? this.planM.terrain : this.M.terrain;
    for (let cz = Math.floor(z0 / C); cz * C < z1; cz++) for (let cx = Math.floor(x0 / C); cx * C < x1; cx++) {
      const key = `${cx},${cz}`;
      if (have.has(key)) continue;
      const wx0 = Math.max(cx * C, g[0]), wz0 = Math.max(cz * C, g[1]), wx1 = Math.min((cx + 1) * C, g[2]), wz1 = Math.min((cz + 1) * C, g[3]);
      if (wx1 - wx0 < this.hf.cell || wz1 - wz0 < this.hf.cell) continue;
      const hi = new THREE.Mesh(new THREE.BufferGeometry(), mat), lo = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      for (const m of [hi, lo]) { m.receiveShadow = true; m.matrixAutoUpdate = false; m.frustumCulled = false; this.root.add(m); }
      const c: TChunk = { key, wx0, wz0, wx1, wz1, cx: (wx0 + wx1) / 2, cz: (wz0 + wz1) / 2, radius: Math.hypot(wx1 - wx0, wz1 - wz0) / 2 + 50, hi, lo };
      this.terrain.push(c);
      if (build) this.rebuildChunk(c);
    }
  }

  /** A chunk's grid range on the current heightfield. */
  private chunkRange(c: TChunk) {
    const h = this.hf, n = h.n - 1;
    return { i0: Math.max(0, Math.round((c.wx0 - h.x0) / h.cell)), j0: Math.max(0, Math.round((c.wz0 - h.z0) / h.cell)), i1: Math.min(n, Math.round((c.wx1 - h.x0) / h.cell)), j1: Math.min(n, Math.round((c.wz1 - h.z0) / h.cell)) };
  }

  private rebuildChunk(c: TChunk) {
    const g = this.chunkRange(c);
    c.hi.geometry.dispose(); c.lo.geometry.dispose();
    c.hi.geometry = buildTerrainPatch(this.hf, g.i0, g.j0, g.i1, g.j1, 1);
    c.lo.geometry = buildTerrainPatch(this.hf, g.i0, g.j0, g.i1, g.j1, 4);
    c.hi.frustumCulled = c.lo.frustumCulled = true;
    releaseAfterUpload(c.hi.geometry); releaseAfterUpload(c.lo.geometry);
  }

  /** Drop terrain and tree chunks outside a rectangle (a region's window moved off them). */
  private dropOutside(r: Region) {
    const out = (x0: number, z0: number, x1: number, z1: number) => x1 <= r[0] || x0 >= r[2] || z1 <= r[1] || z0 >= r[3];
    this.terrain = this.terrain.filter((c) => {
      if (!out(c.wx0, c.wz0, c.wx1, c.wz1)) return true;
      this.root.remove(c.hi, c.lo); c.hi.geometry.dispose(); c.lo.geometry.dispose();
      return false;
    });
    for (const [k, c] of this.treeChunks) if (out(c.x0, c.z0, c.x0 + CHUNK, c.z0 + CHUNK)) { this.trees.remove(c.hi, c.lo); c.hi.dispose(); c.lo.dispose(); this.treeChunks.delete(k); }
  }

  /**
   * A region's window moved: the heightfield is already on the new centre (the overlap carried over). The grids
   * that follow it shift too (road cut targets, road footprint, cut-outs), and terrain / trees off the new window go.
   * The pieces that arrived are then `settle`d one by one, and `endMove` finishes the window-wide things.
   */
  beginMove(tile: TileData) {
    const { hf } = this;
    const targets = new Float32Array(hf.n * hf.n).fill(NaN);
    shiftInto(this.targets, this.gx0, this.gz0, targets, hf.x0, hf.z0, hf.n, hf.cell);
    this.targets = targets;
    this.gx0 = hf.x0; this.gz0 = hf.z0;
    this.tile = tile;
    this.raster = this.raster.movedTo(tile.ox ?? 0, tile.oz ?? 0);
    this.holes.moveTo(tile.ox ?? 0, tile.oz ?? 0);
    this.dropOutside(this.gridRect());
    this.terrainRev++;
  }

  /** One piece of a region arrived (its roads are compiled): cut the ground under them, its terrain, trees and buildings. */
  settle(rect: Region) {
    const M = 48, r: Region = [rect[0] - M, rect[1] - M, rect[2] + M, rect[3] + M];
    this.raster.clear(r);
    this.C.mesher.stampRaster(this.raster, r);
    this.ensureTerrain(rect, false);
    this.syncTerrain(r);
    this.plantTrees(rect);
    const ids: Id[] = [];
    for (const [id, it] of this.bItems) if (it.x1 >= rect[0] && it.x0 <= rect[2] && it.z1 >= rect[1] && it.z0 <= rect[3]) ids.push(id);
    this.buildings.touch(ids);
    this.buildings.flush();
    this.needsRender = true;
  }

  /** A region's window move is done: water, rail and ponds over the new window. */
  endMove() {
    this.water.geometry.dispose();
    this.water.geometry = buildWater(this.tile, this.hf);
    this.railDirty = false;
    this.buildRail();
    this.buildPonds();
    this.applyLayers();
    this.needsRender = true;
  }

  // ---------------- buildings ----------------

  private asBuilding(b: BuildingObj): Building {
    const src = this.tile.buildings[b.src];
    return { outer: new Float32Array(b.outer), holes: b.holes.map((h) => new Float32Array(h)), h: b.h, minH: b.minH, kind: b.bk ?? src?.kind ?? 0, roof: b.roof ?? src?.roof ?? 0, name: b.name, id: b.src >= 0 ? b.src : 100000 + (hashId(b.id) % 100000) };
  }

  /** Register a building (its extent); the mesh is made when its chunk is built. */
  private buildBuilding(b: BuildingObj | undefined, id?: Id) {
    const key = b?.id ?? id!;
    if (!b) { this.bItems.delete(key); this.bDropped.delete(key); return; }
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < b.outer.length; i += 2) { x0 = Math.min(x0, b.outer[i]); x1 = Math.max(x1, b.outer[i]); z0 = Math.min(z0, b.outer[i + 1]); z1 = Math.max(z1, b.outer[i + 1]); }
    const self = this;
    this.bItems.set(key, { get layers() { return { roofs: self.buildingMesh(key) }; }, x0, z0, x1, z1 });
  }

  /** A building's mesh (shrunk away from roads, or dropped when a road runs through it). */
  private buildingMesh(id: Id): Packed | undefined {
    const b = this.doc.get<'building'>(id);
    if (!b) return undefined;
    const res = resolveConflicts([this.asBuilding(b)], this.raster);
    if (!res.kept.length) { this.bDropped.add(id); return undefined; }
    this.bDropped.delete(id);
    const m = buildBuildings(res.kept, this.hf);
    const gb = new GeomBuilder();
    appendInto(gb, m.roofs);
    for (const w of Object.values(m.walls)) appendInto(gb, w);
    return pack(gb);
  }

  // ---------------- rail / metro ----------------

  private railsFromDoc(layer: 'rail' | 'metro'): TileData['rails'] {
    const lines = this.doc.linesOf(layer).filter((l) => lineShape(l) === 'route' && l.pts.length >= 4);
    // a region: city-wide lines, cut to the window (the heightfield only covers that)
    const parts: [LineObj, number[]][] = this.region ? lines.flatMap((l) => clipPolyline(l.pts, this.gridRect(), 2).map((p) => [l, p] as [LineObj, number[]])) : lines.map((l) => [l, l.pts]);
    return parts.filter(([, pts]) => pts.length >= 4).map(([l, pts]) => {
      const a = assetOf(l), p = a?.profile.type === 'track' ? a.profile : undefined;
      return {
        pts: new Float32Array(pts),
        bridge: l.props.bridge === 1 || l.depth < -0.5, tunnel: l.depth > 3 || p?.structure === 'tunnel', layer: l.depth < -0.5 ? Math.max(1, Math.round(-l.depth / 7.5)) : 0,
        service: l.props.service === 1, metro: layer === 'metro',
        ...(p ? { tracks: p.tracks, tc: p.tc, gauge: p.gauge, formation: p.formation, deck: l.depth < -0.5 ? -l.depth : undefined } : {}),
      };
    });
  }

  private buildRail() {
    const M = this.M;
    for (const [group, layer] of [[this.rail, 'rail'], [this.metro, 'metro']] as const) {
      for (const c of [...group.children]) { group.remove(c); (c as THREE.Mesh).geometry.dispose(); }
      const t = { ...this.tile, rails: this.railsFromDoc(layer) };
      const viaduct = layer === 'metro' ? [...this.C.mesher.geos.values()].filter((g) => g.s.viaduct).map((g) => ({ pts: g.pts, oneway: g.t.oneway })) : [];
      const r = buildRail(t, this.hf, viaduct);
      for (const [gb, mat, cast] of [[r.ballast, M.paving, false], [r.structure, M.concrete, true], [r.steel, M.steel, false]] as const) {
        if (!gb.vertexCount) continue;
        const m = new THREE.Mesh(gb.build(), mat);
        m.castShadow = cast && this.graphics === 'high'; m.receiveShadow = true; m.matrixAutoUpdate = false;
        m.userData.cast = cast;
        group.add(m);
      }
    }
  }

  // ---------------- trees ----------------

  private buildTrees() { this.plantTrees(this.gridRect()); }

  /** Trees over a rectangle (replacing the chunks there): mapped trees, parks and woods, street trees, open ground. */
  private plantTrees(r: Region) {
    const T = this.tile, inR = (x0: number, z0: number, x1: number, z1: number) => x1 >= r[0] && x0 <= r[2] && z1 >= r[1] && z0 <= r[3];
    const boxOf = (p: Float32Array) => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); } return [x0, z0, x1, z1] as const; };
    const keep = <X extends { outer: Float32Array }>(list: X[]) => list.filter((p) => inR(...boxOf(p.outer)));
    const tr: number[] = [];
    for (let i = 0; i < T.trees.length; i += 2) if (inR(T.trees[i], T.trees[i + 1], T.trees[i], T.trees[i + 1])) tr.push(T.trees[i], T.trees[i + 1]);
    // the rectangle as a tile of its own (placeTrees fills its square)
    const sub: TileData = { ...T, half: Math.max(r[2] - r[0], r[3] - r[1]) / 2, ox: (r[0] + r[2]) / 2, oz: (r[1] + r[3]) / 2, buildings: keep(T.buildings), areas: keep(T.areas), waters: keep(T.waters), trees: new Float32Array(tr) };
    const streets = [...this.C.mesher.geos.values()].filter((g) => { const b = boxOf(g.pts); return inR(b[0], b[1], b[2], b[3]); }).map((g) => ({ pts: g.pts, hw: Math.max(g.t.hwL, g.t.hwR), cls: g.s.cls }));
    const trees = placeTrees(sub, this.hf, streets, this.raster);
    const buckets = new Map<string, TreeInstance[]>();
    for (const t of trees) {
      if (t.x < r[0] || t.x >= r[2] || t.z < r[1] || t.z >= r[3]) continue;
      const k = `${Math.floor(t.x / CHUNK)},${Math.floor(t.z / CHUNK)}`;
      (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(t);
    }
    // chunks wholly inside the rectangle are replaced; ones it only grazes get its trees added
    const hiG = treeGeometry('high'), loG = treeGeometry('low');
    for (const [k, list] of buckets) {
      const old = this.treeChunks.get(k);
      const [cx, cz] = k.split(',').map(Number);
      const whole = cx * CHUNK >= r[0] && (cx + 1) * CHUNK <= r[2] && cz * CHUNK >= r[1] && (cz + 1) * CHUNK <= r[3];
      const all = old && !whole ? [...old.list.filter((t) => t.x < r[0] || t.x >= r[2] || t.z < r[1] || t.z >= r[3]), ...list] : list;
      if (old) { this.trees.remove(old.hi, old.lo); old.hi.dispose(); old.lo.dispose(); }
      const hi = new THREE.InstancedMesh(hiG, this.M.trees, all.length), lo = new THREE.InstancedMesh(loG, this.M.trees, all.length);
      for (const m of [hi, lo]) { m.castShadow = this.graphics === 'high'; m.receiveShadow = true; this.trees.add(m); }
      const c: TreeChunk = { list: all, hi, lo, cx: (cx + 0.5) * CHUNK, cz: (cz + 0.5) * CHUNK, x0: cx * CHUNK, z0: cz * CHUNK };
      this.placeTreeInstances(c);
      this.treeChunks.set(k, c);
    }
  }

  private placeTreeInstances(c: TreeChunk) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const GREENS = [0x4f7a32, 0x5d8a3a, 0x46702c, 0x6b9443, 0x3f6828, 0x789d48, 0x587f30, 0x6e8c3a];
    c.list.forEach((t, i) => {
      const blocked = this.raster.onRoad(t.x, t.z);
      q.setFromAxisAngle(up, t.rot);
      s.set(blocked ? 0 : t.s, blocked ? 0 : t.h, blocked ? 0 : t.s);
      p.set(t.x, this.hf.sampleSurface(t.x, t.z) - 0.2, t.z);
      m.compose(p, q, s);
      c.hi.setMatrixAt(i, m); c.lo.setMatrixAt(i, m);
      col.setHex(GREENS[Math.floor(t.tint * GREENS.length)]);
      c.hi.setColorAt(i, col); c.lo.setColorAt(i, col);
    });
    for (const im of [c.hi, c.lo]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); }
  }

  // ---------------- utilities (3D pipes) ----------------

  private buildUtilityLayer(layer: Id) {
    const old = this.utilityLayers.get(layer);
    if (old) { this.utilities.remove(old); old.geometry.dispose(); this.utilityLayers.delete(layer); }
    const L = this.doc.get<'layer'>(layer);
    if (!L) return;
    const gb = new GeomBuilder();
    const rgb = rgbHex(new THREE.Color(L.color ?? LINE_COLOR[L.lineKind ?? 'other']).getHex());
    const T = (x: number, z: number) => this.hf.sampleSurface(x, z);
    for (const l of this.doc.linesOf(layer)) {
      const a = assetOf(l);
      if (lineShape(l) !== 'route' || (a && a.profile.type !== 'conduit')) continue;
      const r = Math.max(0.12, l.size / 2), p = l.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
        const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        const nx = (dz / len) * r, nz = (-dx / len) * r;
        const ya = T(ax, az) - l.depth, yb = T(bx, bz) - l.depth;
        // a square duct: top, bottom and two sides
        gb.wall(ax + nx, az + nz, bx + nx, bz + nz, ya - r, yb - r, ya + r, yb + r, rgb);
        gb.wall(bx - nx, bz - nz, ax - nx, az - nz, yb - r, ya - r, yb + r, ya + r, rgb);
        const k = gb.v(ax + nx, ya + r, az + nz, 0, 1, 0, ...rgb);
        gb.v(bx + nx, yb + r, bz + nz, 0, 1, 0, ...rgb); gb.v(bx - nx, yb + r, bz - nz, 0, 1, 0, ...rgb); gb.v(ax - nx, ya + r, az - nz, 0, 1, 0, ...rgb);
        gb.tri(k, k + 2, k + 1); gb.tri(k, k + 3, k + 2);
      }
    }
    if (!gb.vertexCount) return;
    const mat = new THREE.MeshLambertNodeMaterial();
    mat.colorNode = vertexColor().rgb;
    const mesh = new THREE.Mesh(gb.build(), mat);
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 2;
    this.utilityLayers.set(layer, mesh);
    this.utilities.add(mesh);
  }

  // ---------------- edits ----------------

  /** Mesh items rebuilt by the compiler for a document change. */
  onChange(c: Change, itemKeys: Set<string>) {
    const region: Region = [Infinity, Infinity, -Infinity, -Infinity];
    const grow = (it: { x0: number; z0: number; x1: number; z1: number } | undefined) => {
      if (!it) return;
      region[0] = Math.min(region[0], it.x0); region[1] = Math.min(region[1], it.z0);
      region[2] = Math.max(region[2], it.x1); region[3] = Math.max(region[3], it.z1);
    };
    // old extents of rebuilt road items (chunk sets still hold them) + new extents
    for (const k of itemKeys) grow(this.lastExtent.get(k));
    for (const k of itemKeys) { const it = this.C.mesher.items.get(k); grow(it); if (it) this.lastExtent.set(k, { x0: it.x0, z0: it.z0, x1: it.x1, z1: it.z1 }); else this.lastExtent.delete(k); }
    this.roads.touch([...itemKeys].filter((k) => k[0] !== 'p'));
    this.paths.touch([...itemKeys].filter((k) => k[0] === 'p'));
    this.roads.flush(); this.paths.flush();
    const bTouched: Id[] = [];
    for (const id of c.ids) {
      const o = this.doc.get(id);
      const kind = o?.kind ?? (this.bItems.has(id) ? 'building' : undefined);
      if (kind === 'building') { grow(this.bItems.get(id)); this.buildBuilding(o as BuildingObj | undefined, id); grow(this.bItems.get(id)); bTouched.push(id); }
      else if (o?.kind === 'line' || (!o && c.structural)) {
        const layer = o?.kind === 'line' ? o.layer : undefined;
        if (o?.kind === 'line' ? !!assetOf(o) : true) this.assetsDirty = true;
        // canals wide enough to cut the terrain: refresh where the line was and where it is
        const was = this.lineExtent.get(id);
        if (was) { grow({ x0: was[0], z0: was[1], x1: was[2], z1: was[3] }); this.lineExtent.delete(id); }
        if (o?.kind === 'line') { const a = assetOf(o); if (a && carves(a)) { const e = lineBox(o.pts, o.size / 2 + 12); this.lineExtent.set(id, e); grow({ x0: e[0], z0: e[1], x1: e[2], z1: e[3] }); } }
        if (layer === 'rail' || layer === 'metro') this.railDirty = true;
        else if (layer && layer !== 'paths') this.utilDirty.add(layer);
        else if (!o) { this.railDirty = true; for (const l of this.utilityLayers.keys()) this.utilDirty.add(l); }
      } else if (o?.kind === 'section' && o.viaduct) this.railDirty = true;
    }
    // paging (a region's window moving): arriving buildings are made when their piece settles; nothing to re-sync
    const page = c.origin === 'page';
    if (bTouched.length) { this.buildings.touch(page ? bTouched.filter((id) => !this.bItems.has(id)) : bTouched); this.buildings.flush(); }
    if (region[0] < Infinity && !page) this.dirty.push([region[0] - 20, region[1] - 20, region[2] + 20, region[3] + 20]);
    this.needsRender = true;
  }
  /**
   * Terrain only, for a region: road cut / fill on the designed ground, then the terrain patches (fast enough to run
   * while a terraforming brush is dragged). Returns the grid range it touched.
   */
  /** bumps whenever the rendered terrain surface changes */
  terrainRev = 0;

  syncTerrain(r: Region) {
    this.terrainRev++;
    const { hf, C } = this;
    const g = hf.gridRange(r[0], r[1], r[2], r[3]);
    const pad = 3;
    // road targets are read up to `radius` cells around a vertex: stamp a little wider than we conform
    const s0 = Math.max(0, g.i0 - pad * 2), t0 = Math.max(0, g.j0 - pad * 2), s1 = Math.min(hf.n - 1, g.i1 + pad * 2), t1 = Math.min(hf.n - 1, g.j1 + pad * 2);
    for (let j = t0; j <= t1; j++) this.targets.fill(NaN, j * hf.n + s0, j * hf.n + s1 + 1);
    const box: Region = [hf.x0 + s0 * hf.cell - 0.01, hf.z0 + t0 * hf.cell - 0.01, hf.x0 + s1 * hf.cell + 0.01, hf.z0 + t1 * hf.cell + 0.01];
    C.mesher.stampTargets(this.targets, box);
    this.stampChannels(box);
    this.holes.update(box, C.mesher.itemsIn(...box).flatMap((it) => it.stamps));
    hf.conformRegion(this.targets, Math.max(0, g.i0 - pad), Math.max(0, g.j0 - pad), Math.min(hf.n - 1, g.i1 + pad), Math.min(hf.n - 1, g.j1 + pad));
    for (const t of this.terrain) {
      const c = this.chunkRange(t);
      if (c.i1 < g.i0 - pad || c.i0 > g.i1 + pad || c.j1 < g.j0 - pad || c.j0 > g.j1 + pad) continue;
      this.rebuildChunk(t);
    }
    this.needsRender = true;
    return g;
  }

  /** Queue a region for the full sync (buildings, trees, road footprint) the next time 3D needs it. */
  markDirty(r: Region) { this.dirty.push(r); }

  /** Pond water surfaces from the pond earthworks. */
  buildPonds() {
    for (const c of [...this.ponds.children]) { this.ponds.remove(c); (c as THREE.Mesh).geometry.dispose(); }
    for (const o of this.doc.all('earthwork')) {
      if (o.op !== 'pond' || o.pts.length < 6 || o.height === undefined) continue;
      const tris = earcut(o.pts);
      const y = o.height - this.hf.base;
      const pos = new Float32Array((o.pts.length / 2) * 3);
      for (let i = 0; i < o.pts.length / 2; i++) { pos[i * 3] = o.pts[i * 2]; pos[i * 3 + 1] = y; pos[i * 3 + 2] = o.pts[i * 2 + 1]; }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(pos.length).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.length).fill(1), 3));
      // earcut winds by input order; make the triangles face up
      const idx: number[] = [];
      for (let k = 0; k < tris.length; k += 3) {
        const [a, b, c] = [tris[k], tris[k + 1], tris[k + 2]];
        const cross = (o.pts[b * 2] - o.pts[a * 2]) * (o.pts[c * 2 + 1] - o.pts[a * 2 + 1]) - (o.pts[b * 2 + 1] - o.pts[a * 2 + 1]) * (o.pts[c * 2] - o.pts[a * 2]);
        if (cross > 0) idx.push(a, c, b); else idx.push(a, b, c);
      }
      geo.setIndex(idx);
      const m = new THREE.Mesh(geo, this.plan ? this.planM.water : this.M.water);
      m.receiveShadow = true;
      this.ponds.add(m);
    }
    this.needsRender = true;
  }

  /** Vertical exaggeration of everything (terrain view in 3D: Pune's relief is gentle). */
  setExaggeration(k: number) { this.exag = k; this.root.scale.y = k; this.root.updateMatrixWorld(true); this.applyLayers(); }
  /** vertical exaggeration (buildings and trees are hidden while it's on: stretched they'd hide the ground) */
  private exag = 1;

  get stale() { return this.dirty.length > 0 || this.railDirty || this.utilDirty.size > 0 || this.assetsDirty; }

  // ---------------- catalogue assets ----------------

  /** Lower the terrain targets under canals / nallas wide enough to cut in. */
  private stampChannels(region?: Region) {
    for (const l of this.doc.all('line')) {
      const a = assetOf(l);
      if (!a || !carves(a) || a.profile.type !== 'channel' || lineShape(l) !== 'route') continue;
      if (!this.lineExtent.has(l.id)) this.lineExtent.set(l.id, lineBox(l.pts, l.size / 2 + 12));
      if (region) { const e = this.lineExtent.get(l.id)!; if (e[2] < region[0] || e[0] > region[2] || e[3] < region[1] || e[1] > region[3]) continue; }
      stampChannel(this.hf, this.targets, l.pts, a.profile, region);
    }
  }

  /** Canals, power lines, structures and areas, one group per layer. */
  private buildAssets() {
    this.assetsDirty = false;
    for (const g of this.assetLayers.values()) {
      for (const c of [...g.children]) { g.remove(c); (c as THREE.Mesh).geometry.dispose(); }
      this.assets.remove(g);
    }
    this.assetLayers.clear();
    const byLayer = new Map<Id, AssetItem[]>();
    for (const l of this.doc.all('line')) {
      const a = assetOf(l);
      if (!a) continue;
      const shape = lineShape(l), t = a.profile.type;
      // tracks are the rail builder's, pipes the utility builder's, paths the road mesher's
      if (shape === 'route' && (t === 'track' || t === 'conduit' || t === 'path' || t === 'street')) continue;
      const color = this.doc.get<'layer'>(l.layer)?.color ?? '#888';
      (byLayer.get(l.layer) ?? byLayer.set(l.layer, []).get(l.layer)!).push({ id: l.id, pts: l.pts, a, lift: -l.depth, rot: Number(l.props.rot ?? 0), shape, color });
    }
    for (const [layer, items] of byLayer) {
      const { solid, water } = buildAssets3d(items, this.hf);
      const g = new THREE.Group();
      if (solid.vertexCount) { const m = new THREE.Mesh(solid.build(), this.assetMat); m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; g.add(m); }
      if (water.vertexCount) { const m = new THREE.Mesh(water.build(), this.M.water); m.receiveShadow = true; m.matrixAutoUpdate = false; g.add(m); }
      this.assetLayers.set(layer, g);
      this.assets.add(g);
    }
    this.applyLayers();
  }

  /** Bring terrain, buildings, trees, rail and pipes up to date with the roads. */
  sync() {
    if (!this.dirty.length && !this.railDirty && !this.utilDirty.size) return;
    const regions = mergeRegions(this.dirty);
    this.dirty = [];
    const { hf, C } = this;
    for (const r of regions) {
      this.syncTerrain(r);
      // road footprint
      this.raster.clear(r);
      C.mesher.stampRaster(this.raster, r);
      // buildings around (their chunks regenerate against the new road footprint)
      const ids: Id[] = [];
      for (const b of this.doc.all('building')) {
        if (!this.bItems.has(b.id)) this.buildBuilding(b);
        const it = this.bItems.get(b.id)!;
        if (it.x1 < r[0] - 10 || it.x0 > r[2] + 10 || it.z1 < r[1] - 10 || it.z0 > r[3] + 10) continue;
        ids.push(b.id);
      }
      this.buildings.touch(ids);
      for (const c of this.treeChunks.values()) if (c.x0 < r[2] && c.x0 + CHUNK > r[0] && c.z0 < r[3] && c.z0 + CHUNK > r[1]) this.placeTreeInstances(c);
    }
    this.buildings.flush();
    if (this.railDirty) { this.railDirty = false; this.buildRail(); }
    if (this.assetsDirty) this.buildAssets();
    for (const l of this.utilDirty) if (this.utilityLayers.has(l) || this.doc.get<'layer'>(l)?.visible) this.buildUtilityLayer(l);
    this.utilDirty.clear();
    this.needsRender = true;
  }

  // ---------------- views ----------------

  /** Plan (2D) vs 3D materials. */
  setPlan(on: boolean) {
    this.plan = on;
    const P = this.planM, M = this.M;
    const roadM = on ? { asphalt: P.asphalt, paving: P.paving, markings: P.markings, concrete: P.concrete } : { asphalt: M.asphalt, paving: M.paving, markings: M.markings, concrete: M.concrete };
    for (const set of [this.roads, this.paths]) for (const L of MESH_LAYERS) set.setMaterial(L, roadM[L]);
    this.buildings.setMaterial('roofs', on ? P.roofs : M.roofs);
    for (const t of this.terrain) { t.hi.material = on ? P.terrain : M.terrain; t.lo.material = on ? P.terrain : M.terrain; }
    this.water.material = on ? P.water : M.water;
    for (const c of this.ponds.children) (c as THREE.Mesh).material = on ? P.water : M.water;
    if (on) { this.roads.showAll(); this.paths.showAll(); this.buildings.showAll(); for (const t of this.terrain) { t.hi.visible = true; t.lo.visible = false; } }
    this.applyLayers();
    this.needsRender = true;
  }

  /** detail shown (a region's 2D view zoomed out shows only the far view) */
  private detail = true;
  setDetail(on: boolean) { if (on === this.detail) return; this.detail = on; this.applyLayers(); }

  private ghost = false;
  /** Roads and buildings see-through over imagery (2D), to check how they line up. */
  setGhost(on: boolean) {
    if (on === this.ghost) return;
    this.ghost = on;
    const P = this.planM;
    for (const m of [P.asphalt, P.paving, P.markings, P.concrete, P.roofs] as THREE.Material[]) {
      m.transparent = on; m.opacity = on ? (m === P.roofs ? 0.25 : 0.45) : 1; m.depthWrite = !on; m.needsUpdate = true;
    }
    this.needsRender = true;
  }

  /** X-ray: see-through ground and city so underground layers show (3D). */
  setXray(on: boolean) {
    this.xray = on;
    const M = this.M;
    for (const m of [M.terrain, M.asphalt, M.paving, M.markings, M.roofs, M.skirt, M.water] as THREE.Material[]) {
      m.transparent = on; m.opacity = on ? (m === M.roofs ? 0.15 : 0.3) : 1; m.depthWrite = !on; m.needsUpdate = true;
    }
    this.applyLayers();
  }

  applyLayers() {
    const vis = (id: string) => this.doc.get<'layer'>(id)?.visible ?? true;
    // satellite imagery as the ground (2D): it takes the place of the terrain and water; roads can go see-through
    const imgs = this.plan ? this.doc.all('layer').filter((l) => l.type === 'xyz' && l.visible && l.url) : [];
    const ground = imgs.some((l) => l.mode === 'ground');
    for (const t of this.terrain) { t.hi.visible = vis('terrain') && !ground && (this.plan || t.hi.visible || !t.lo.visible); if (!vis('terrain') || ground) { t.hi.visible = t.lo.visible = false; } }
    this.skirt.visible = vis('terrain') && !this.plan && !this.region; // a region's window sits in the far-view terrain
    this.water.visible = vis('water') && !ground;
    for (const c of this.ponds.children) c.visible = !ground;
    this.setGhost(imgs.some((l) => l.roads === 'ghost'));
    this.roads.group.visible = vis('roads');
    this.paths.group.visible = vis('paths');
    this.buildings.group.visible = vis('buildings') && this.exag === 1;
    this.trees.visible = vis('trees') && !this.plan && this.exag === 1;
    this.rail.visible = vis('rail') && !this.plan;
    this.metro.visible = vis('metro') && !this.plan;
    for (const [layer, g] of this.assetLayers) g.visible = vis(layer) && !this.plan;
    // underground pipes: 3D only (2D draws them as vector lines)
    for (const L of this.doc.all('layer')) {
      if (L.group !== 'underground' || L.type !== 'lines') continue;
      if (L.visible && !this.plan && !this.utilityLayers.has(L.id)) this.buildUtilityLayer(L.id);
      const m = this.utilityLayers.get(L.id);
      if (m) m.visible = L.visible && !this.plan;
    }
    if (!this.detail) {
      for (const t of this.terrain) t.hi.visible = t.lo.visible = false;
      for (const o of [this.water, this.skirt, this.ponds, this.roads.group, this.paths.group, this.buildings.group, this.trees, this.rail, this.metro, this.assets, this.utilities]) o.visible = false;
    }
    this.needsRender = true;
  }

  /** The 3D look: draw distances and which things cast shadows. */
  setGraphics(g: Graphics) {
    this.graphics = g;
    const D = DIST[g], high = g === 'high';
    this.roads.opts.markings!.maxDist = D.markings;
    this.roads.opts.paving!.maxDist = D.paving;
    this.paths.opts.paving!.maxDist = D.paving * 0.8;
    this.buildings.opts.roofs!.maxDist = D.buildings;
    // shadows: buildings always; trees, flyover concrete and rail structures in the high look only
    this.roads.opts.concrete!.cast = high;
    this.roads.setShadows(true);
    for (const c of this.treeChunks.values()) { c.hi.castShadow = high; c.lo.castShadow = high; }
    for (const grp of [this.rail, this.metro]) for (const m of grp.children) m.castShadow = high && !!m.userData.cast;
    this.needsRender = true;
  }

  /** LOD / distance culling for the 3D view (when the camera moves). */
  frame(cam: THREE.Vector3, focus: THREE.Vector3) {
    if (this.plan) return;
    const D = DIST[this.graphics];
    const camH = Math.max(0, cam.y - focus.y);
    this.roads.cull(cam.x, cam.z, camH * 0.5);
    this.paths.cull(cam.x, cam.z, camH * 0.5);
    this.buildings.cull(cam.x, cam.z, camH);
    if (this.doc.get<'layer'>('terrain')?.visible !== false) for (const c of this.terrain) {
      const near = Math.hypot(c.cx - cam.x, c.cz - cam.z) - c.radius < D.terrainHi + camH * 0.5;
      c.hi.visible = near; c.lo.visible = !near;
    }
    for (const c of this.treeChunks.values()) {
      const d = Math.hypot(c.cx - cam.x, c.cz - cam.z);
      c.hi.visible = d < D.treesHi; c.lo.visible = d >= D.treesHi && d < D.treesLo + camH;
    }
  }

  /** Building at a point (for picking). */
  buildingAt(x: number, z: number): Id | undefined {
    for (const [id, it] of this.bItems) {
      if (x < it.x0 || x > it.x1 || z < it.z0 || z > it.z1 || this.bDropped.has(id)) continue;
      const b = this.doc.get<'building'>(id);
      if (b && inRing(x, z, b.outer)) return id;
    }
    return undefined;
  }
}

/** A polyline (flat x, z pairs) cut to a rectangle shrunk by `inset`: the runs inside it. */
function clipPolyline(p: number[], r: Region, inset = 0): number[][] {
  const x0 = r[0] + inset, z0 = r[1] + inset, x1 = r[2] - inset, z1 = r[3] - inset;
  const inside = (x: number, z: number) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
  const out: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < p.length; i += 2) {
    if (inside(p[i], p[i + 1])) cur.push(p[i], p[i + 1]);
    else { if (cur.length >= 4) out.push(cur); cur = []; }
  }
  if (cur.length >= 4) out.push(cur);
  return out;
}

function inRing(x: number, z: number, r: number[]) {
  let c = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2], zi = r[i * 2 + 1], xj = r[j * 2], zj = r[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function lineBox(p: number[], pad: number): Region {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
}

function hashId(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

/** Merge overlapping rectangles. */
function mergeRegions(rs: Region[]): Region[] {
  const out: Region[] = [];
  for (const r of rs) {
    let cur: Region = [...r];
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < out.length; i++) {
        const o = out[i];
        if (o[0] <= cur[2] && o[2] >= cur[0] && o[1] <= cur[3] && o[3] >= cur[1]) {
          cur = [Math.min(o[0], cur[0]), Math.min(o[1], cur[1]), Math.max(o[2], cur[2]), Math.max(o[3], cur[3])];
          out.splice(i, 1); merged = true; break;
        }
      }
    }
    out.push(cur);
  }
  return out;
}
