// The rendered city, driven by the City Document. Roads update the moment they're edited; the things that react to
// roads (terrain carving, buildings shrunk away from roads, trees, rail snapping) refresh lazily per region —
// on idle or when the 3D view is opened.
import * as THREE from 'three/webgpu';
import { texture, uv, vertexColor, vec3, mix, float } from 'three/tsl';
import { GeomBuilder, appendInto, rgbHex } from '../build/geom';
import { buildBuildings, resolveConflicts } from '../build/buildings';
import { buildRail } from '../build/rail';
import { buildTerrainChunks, buildTerrainPatch, buildTerrainSkirt, buildWater, type TerrainChunk } from '../build/terrain';
import { placeTrees, treeGeometry, type TreeInstance } from '../build/vegetation';
import type { Materials } from '../render/materials';
import type { Building, TileData } from '../data/tile';
import type { Heightfield } from '../geo/heightfield';
import { RoadRaster } from '../geo/roadraster';
import { MESH_LAYERS, type MeshLayer, type Packed } from '../net/generate';
import type { Compiler } from '../doc/compile';
import type { CityDoc, Change } from '../doc/doc';
import type { BuildingObj, Id, LineObj } from '../doc/types';
import { LINE_COLOR } from '../doc/base';
import { ChunkSet, type ChunkItem } from './chunks';
import earcut from 'earcut';

type Region = [number, number, number, number];

const pack = (gb: GeomBuilder): Packed | undefined => gb.idx.length
  ? { pos: new Float32Array(gb.pos), nor: new Float32Array(gb.nor), col: new Float32Array(gb.col), uv: new Float32Array(gb.uv), idx: new Uint32Array(gb.idx) }
  : undefined;

/** Unlit plan-view materials (2D): flat colours, no tone mapping surprises. */
function planMaterials(landuse: THREE.Texture) {
  const vc = () => { const m = new THREE.MeshBasicNodeMaterial(); m.colorNode = vertexColor().rgb; return m; };
  const terrain = new THREE.MeshBasicNodeMaterial();
  terrain.colorNode = mix(texture(landuse, uv()).rgb, vec3(0.93, 0.92, 0.89), float(0.35));
  const asphalt = vc(), paving = vc(), concrete = vc();
  const markings = vc();
  asphalt.polygonOffset = true; asphalt.polygonOffsetFactor = -1; asphalt.polygonOffsetUnits = -1;
  markings.polygonOffset = true; markings.polygonOffsetFactor = -4; markings.polygonOffsetUnits = -4;
  const roofs = new THREE.MeshBasicNodeMaterial();
  roofs.colorNode = mix(vertexColor().rgb, vec3(0.86, 0.83, 0.78), float(0.7));
  const water = new THREE.MeshBasicNodeMaterial({ color: 0x8fbcd4 });
  return { terrain, asphalt, paving, markings, concrete, roofs, water };
}

export class World {
  readonly scene: THREE.Scene;
  readonly root = new THREE.Group();
  roads!: ChunkSet<MeshLayer>;
  paths!: ChunkSet<MeshLayer>;
  buildings!: ChunkSet<'roofs'>;
  terrain: (TerrainChunk & { hi: THREE.Mesh; lo: THREE.Mesh })[] = [];
  skirt!: THREE.Mesh;
  water!: THREE.Mesh;
  rail = new THREE.Group();
  metro = new THREE.Group();
  trees = new THREE.Group();
  utilities = new THREE.Group();
  /** pond water surfaces (terraforming) */
  ponds = new THREE.Group();
  private utilityLayers = new Map<Id, THREE.Mesh>();
  private treeChunks: { list: TreeInstance[]; hi: THREE.InstancedMesh; lo: THREE.InstancedMesh; cx: number; cz: number; x0: number; z0: number }[] = [];
  readonly raster: RoadRaster;
  readonly targets: Float32Array;
  private bItems = new Map<Id, ChunkItem>();
  private lastExtent = new Map<string, { x0: number; z0: number; x1: number; z1: number }>();
  private dirty: Region[] = [];
  private railDirty = false;
  private utilDirty = new Set<Id>();
  plan = false;
  xray = false;
  private planM: ReturnType<typeof planMaterials>;
  /** set when something visible changed (plan view renders on demand) */
  needsRender = true;

  constructor(
    scene: THREE.Scene, readonly tile: TileData, readonly hf: Heightfield, readonly doc: CityDoc,
    readonly C: Compiler, readonly M: Materials, landuse: THREE.Texture,
  ) {
    this.scene = scene;
    this.raster = new RoadRaster(tile.half);
    this.targets = new Float32Array(hf.n * hf.n).fill(NaN);
    this.planM = planMaterials(landuse);
    scene.add(this.root);
    this.root.add(this.rail, this.metro, this.trees, this.utilities, this.ponds);
  }

  /** Initial build of everything (after compiler.full()). */
  build(progress: (f: number, msg: string) => void = () => {}) {
    const { hf, M, C } = this;
    const items = (k: string) => C.mesher.items.get(k);
    const roadMats = { asphalt: M.asphalt, paving: M.paving, markings: M.markings, concrete: M.concrete } as Record<MeshLayer, THREE.Material>;
    this.roads = new ChunkSet(MESH_LAYERS, { ...roadMats }, items, 400, { markings: { receive: false, maxDist: 900 }, paving: { maxDist: 1600 }, concrete: { cast: true } });
    this.paths = new ChunkSet(MESH_LAYERS, { ...roadMats }, items, 400, { paving: { maxDist: 1300 } });
    const keys = [...C.mesher.items.keys()];
    this.roads.touch(keys.filter((k) => k[0] !== 'p'));
    this.paths.touch(keys.filter((k) => k[0] === 'p'));
    this.roads.flush(); this.paths.flush();
    this.root.add(this.roads.group, this.paths.group);
    for (const [k, it] of C.mesher.items) this.lastExtent.set(k, { x0: it.x0, z0: it.z0, x1: it.x1, z1: it.z1 });

    progress(0.6, 'Fitting the ground to the roads…');
    C.mesher.stampTargets(this.targets);
    hf.conform(this.targets);
    C.mesher.stampRaster(this.raster);
    this.terrain = buildTerrainChunks(hf).map((c) => {
      const hi = new THREE.Mesh(c.high, M.terrain), lo = new THREE.Mesh(c.low, M.terrain);
      for (const m of [hi, lo]) { m.receiveShadow = true; m.matrixAutoUpdate = false; this.root.add(m); }
      return { ...c, hi, lo };
    });
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
    progress(0.9, 'Planting trees…');
    this.buildTrees();
  }

  // ---------------- buildings ----------------

  private asBuilding(b: BuildingObj): Building {
    const src = this.tile.buildings[b.src];
    return { outer: new Float32Array(b.outer), holes: b.holes.map((h) => new Float32Array(h)), h: b.h, minH: b.minH, kind: src?.kind ?? 0, roof: src?.roof ?? 0, name: b.name, id: b.src >= 0 ? b.src : 100000 + (hashId(b.id) % 100000) };
  }

  private buildBuilding(b: BuildingObj | undefined, id?: Id) {
    const key = b?.id ?? id!;
    if (!b) { this.bItems.delete(key); return; }
    const res = resolveConflicts([this.asBuilding(b)], this.raster);
    if (!res.kept.length) { this.bItems.delete(key); return; }
    const m = buildBuildings(res.kept, this.hf);
    const gb = new GeomBuilder();
    appendInto(gb, m.roofs);
    for (const w of Object.values(m.walls)) appendInto(gb, w);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < b.outer.length; i += 2) { x0 = Math.min(x0, b.outer[i]); x1 = Math.max(x1, b.outer[i]); z0 = Math.min(z0, b.outer[i + 1]); z1 = Math.max(z1, b.outer[i + 1]); }
    this.bItems.set(key, { layers: { roofs: pack(gb) }, x0, z0, x1, z1 });
  }

  // ---------------- rail / metro ----------------

  private railsFromDoc(layer: 'rail' | 'metro'): TileData['rails'] {
    return this.doc.linesOf(layer).map((l: LineObj) => ({
      pts: new Float32Array(l.pts),
      bridge: l.props.bridge === 1 || l.depth < -0.5, tunnel: l.depth > 3, layer: l.depth < -0.5 ? Math.max(1, Math.round(-l.depth / 7.5)) : 0,
      service: l.props.service === 1, metro: layer === 'metro',
    }));
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
        m.castShadow = cast; m.receiveShadow = true; m.matrixAutoUpdate = false;
        group.add(m);
      }
    }
  }

  // ---------------- trees ----------------

  private buildTrees() {
    const streets = [...this.C.mesher.geos.values()].map((g) => ({ pts: g.pts, hw: Math.max(g.t.hwL, g.t.hwR), cls: g.s.cls }));
    const trees = placeTrees(this.tile, this.hf, streets, this.raster);
    const CH = 500, half = this.tile.half, nc = Math.ceil((half * 2) / CH);
    const buckets: TreeInstance[][] = Array.from({ length: nc * nc }, () => []);
    for (const t of trees) {
      const i = Math.min(nc - 1, Math.max(0, Math.floor((t.x + half) / CH))), j = Math.min(nc - 1, Math.max(0, Math.floor((t.z + half) / CH)));
      buckets[j * nc + i].push(t);
    }
    const hiG = treeGeometry('high'), loG = treeGeometry('low');
    buckets.forEach((list, k) => {
      if (!list.length) return;
      const i = k % nc, j = Math.floor(k / nc);
      const hi = new THREE.InstancedMesh(hiG, this.M.trees, list.length), lo = new THREE.InstancedMesh(loG, this.M.trees, list.length);
      for (const m of [hi, lo]) { m.castShadow = true; m.receiveShadow = true; this.trees.add(m); }
      const c = { list, hi, lo, cx: -half + (i + 0.5) * CH, cz: -half + (j + 0.5) * CH, x0: -half + i * CH, z0: -half + j * CH };
      this.placeTreeInstances(c);
      this.treeChunks.push(c);
    });
  }

  private placeTreeInstances(c: (typeof this.treeChunks)[number]) {
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
        if (layer === 'rail' || layer === 'metro') this.railDirty = true;
        else if (layer && layer !== 'paths') this.utilDirty.add(layer);
        else if (!o) { this.railDirty = true; for (const l of this.utilityLayers.keys()) this.utilDirty.add(l); }
      } else if (o?.kind === 'section' && o.viaduct) this.railDirty = true;
    }
    if (bTouched.length) { this.buildings.touch(bTouched); this.buildings.flush(); }
    if (region[0] < Infinity) this.dirty.push([region[0] - 20, region[1] - 20, region[2] + 20, region[3] + 20]);
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
    C.mesher.stampTargets(this.targets, [-hf.half + s0 * hf.cell - 0.01, -hf.half + t0 * hf.cell - 0.01, -hf.half + s1 * hf.cell + 0.01, -hf.half + t1 * hf.cell + 0.01]);
    hf.conformRegion(this.targets, Math.max(0, g.i0 - pad), Math.max(0, g.j0 - pad), Math.min(hf.n - 1, g.i1 + pad), Math.min(hf.n - 1, g.j1 + pad));
    for (const t of this.terrain) {
      if (t.i1 < g.i0 - pad || t.i0 > g.i1 + pad || t.j1 < g.j0 - pad || t.j0 > g.j1 + pad) continue;
      t.hi.geometry.dispose(); t.lo.geometry.dispose();
      t.hi.geometry = t.high = buildTerrainPatch(hf, t.i0, t.j0, t.i1, t.j1, 1);
      t.lo.geometry = t.low = buildTerrainPatch(hf, t.i0, t.j0, t.i1, t.j1, 4);
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

  get stale() { return this.dirty.length > 0 || this.railDirty || this.utilDirty.size > 0; }

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
      // buildings around
      const ids: Id[] = [];
      for (const b of this.doc.all('building')) {
        const it = this.bItems.get(b.id);
        let x0 = it?.x0, z0 = it?.z0, x1 = it?.x1, z1 = it?.z1;
        if (!it) { x0 = b.outer[0]; z0 = b.outer[1]; x1 = x0; z1 = z0; for (let i = 0; i < b.outer.length; i += 2) { x0 = Math.min(x0, b.outer[i]); x1 = Math.max(x1!, b.outer[i]); z0 = Math.min(z0!, b.outer[i + 1]); z1 = Math.max(z1!, b.outer[i + 1]); } }
        if (x1! < r[0] - 10 || x0! > r[2] + 10 || z1! < r[1] - 10 || z0! > r[3] + 10) continue;
        this.buildBuilding(b); ids.push(b.id);
      }
      this.buildings.touch(ids);
      for (const c of this.treeChunks) if (c.x0 < r[2] && c.x0 + 500 > r[0] && c.z0 < r[3] && c.z0 + 500 > r[1]) this.placeTreeInstances(c);
    }
    this.buildings.flush();
    if (this.railDirty) { this.railDirty = false; this.buildRail(); }
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
    if (on) { this.roads.showAll(); this.paths.showAll(); for (const t of this.terrain) { t.hi.visible = true; t.lo.visible = false; } }
    this.applyLayers();
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
    for (const t of this.terrain) { t.hi.visible = vis('terrain') && (this.plan || t.hi.visible || !t.lo.visible); if (!vis('terrain')) { t.hi.visible = t.lo.visible = false; } }
    this.skirt.visible = vis('terrain') && !this.plan;
    this.water.visible = vis('water');
    this.roads.group.visible = vis('roads');
    this.paths.group.visible = vis('paths');
    this.buildings.group.visible = vis('buildings') && this.exag === 1;
    this.trees.visible = vis('trees') && !this.plan && this.exag === 1;
    this.rail.visible = vis('rail') && !this.plan;
    this.metro.visible = vis('metro') && !this.plan;
    // underground pipes: 3D only (2D draws them as vector lines)
    for (const L of this.doc.all('layer')) {
      if (L.group !== 'underground' || L.type !== 'lines') continue;
      if (L.visible && !this.plan && !this.utilityLayers.has(L.id)) this.buildUtilityLayer(L.id);
      const m = this.utilityLayers.get(L.id);
      if (m) m.visible = L.visible && !this.plan;
    }
    this.needsRender = true;
  }

  /** Per-frame LOD / distance culling for the 3D view. */
  frame(cam: THREE.Vector3, focus: THREE.Vector3) {
    if (this.plan) return;
    const camH = Math.max(0, cam.y - focus.y);
    this.roads.cull(cam.x, cam.z, camH * 0.5);
    this.paths.cull(cam.x, cam.z, camH * 0.5);
    if (this.doc.get<'layer'>('terrain')?.visible !== false) for (const c of this.terrain) {
      const near = Math.hypot(c.cx - cam.x, c.cz - cam.z) - c.radius < 900 + camH * 0.6;
      c.hi.visible = near; c.lo.visible = !near;
    }
    for (const c of this.treeChunks) {
      const d = Math.hypot(c.cx - cam.x, c.cz - cam.z);
      c.hi.visible = d < 700; c.lo.visible = d >= 700 && d < 6000;
    }
  }

  /** Building at a point (for picking). */
  buildingAt(x: number, z: number): Id | undefined {
    for (const [id, it] of this.bItems) {
      if (x < it.x0 || x > it.x1 || z < it.z0 || z > it.z1) continue;
      const b = this.doc.get<'building'>(id);
      if (b && inRing(x, z, b.outer)) return id;
    }
    return undefined;
  }
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
