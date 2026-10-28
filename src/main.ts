// Pune Remix v2 — boot sequence + frame loop.
import * as THREE from 'three/webgpu';
import { type GeomBuilder, splitChunks, appendInto } from './build/geom';
import { Engine } from './render/engine';
import { CityControls } from './render/controls';
import { createMaterials } from './render/materials';
import { loadTile } from './data/tile';
import { Heightfield } from './geo/heightfield';
import { generateNetwork } from './net/generate';
import type { Network } from './net/model';
import { buildTerrainChunks, buildTerrainSkirt, buildLanduseTexture, buildWater } from './build/terrain';
import { buildBuildings, resolveConflicts, FACADE_STYLES } from './build/buildings';
import { buildRail } from './build/rail';
import { placeTrees, buildTreeMeshes } from './build/vegetation';

const $ = (id: string) => document.getElementById(id)!;
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const TILE = new URLSearchParams(location.search).get('tile') ?? 'kp';

async function boot() {
  const progress = (f: number, msg: string) => { $('load-bar').style.width = `${Math.round(f * 100)}%`; $('load-msg').textContent = msg; };
  const timings: string[] = [];
  const timed = async <T,>(label: string, f: () => T | Promise<T>): Promise<T> => {
    const t0 = performance.now();
    console.info(`[PuneRemix] ▶ ${label}`);
    const v = await f();
    timings.push(`${label} ${Math.round(performance.now() - t0)}ms`);
    console.info(`[PuneRemix] ✓ ${label} ${Math.round(performance.now() - t0)}ms`);
    return v;
  };

  const engine = new Engine($('gl') as HTMLCanvasElement);
  try { await engine.init(); } catch (e) {
    $('load-msg').textContent = 'Could not start the 3D engine: ' + (e as Error).message;
    return;
  }

  const tile = await timed('load', () => loadTile(TILE, progress));
  progress(0.12, 'Shaping the terrain from Copernicus elevation data…'); await frame();
  const hf = new Heightfield(tile.terrain.n, tile.terrain.cell, tile.terrain.heights);

  progress(0.2, 'Loading the road network…'); await frame();
  const network: Network = await timed('network', () => fetch(`${import.meta.env.BASE_URL}tiles/${TILE}/network.json`).then((r) => r.json()));

  progress(0.35, `Generating ${network.segments.length.toLocaleString()} road segments and junctions…`); await frame();
  const roads = await timed('roads', () => generateNetwork(network, hf));
  const raster = roads.raster;
  console.info('[PuneRemix] network:', JSON.stringify(roads.stats));

  progress(0.62, 'Fitting the ground to the roads…'); await frame();
  await timed('conform', () => hf.conform(roads.targets));

  progress(0.68, 'Painting land use…'); await frame();
  const landuse = buildLanduseTexture(tile);
  const M = createMaterials(landuse);
  const S = engine.scene;
  // Static geometry is split into 400 m chunks: frustum culling + per-layer draw distance
  const layers: { mesh: THREE.Mesh; cx: number; cz: number; r: number; maxDist: number }[] = [];
  const addChunked = (gb: GeomBuilder, mat: THREE.Material, opts: { cast?: boolean; receive?: boolean; maxDist?: number } = {}) => {
    if (!gb.vertexCount) return;
    for (const c of splitChunks(gb, 800)) {
      const m = new THREE.Mesh(c.geo, mat);
      m.castShadow = !!opts.cast;
      m.receiveShadow = opts.receive ?? true;
      m.matrixAutoUpdate = false;
      S.add(m);
      layers.push({ mesh: m, cx: c.cx, cz: c.cz, r: c.radius, maxDist: opts.maxDist ?? Infinity });
    }
  };
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, cast = false, receive = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    S.add(m);
    return m;
  };
  // terrain: chunked, 8 m grid near / 32 m far
  const terrainChunks = buildTerrainChunks(hf).map((c) => {
    const hi = new THREE.Mesh(c.high, M.terrain), lo = new THREE.Mesh(c.low, M.terrain);
    for (const m of [hi, lo]) { m.receiveShadow = true; m.matrixAutoUpdate = false; S.add(m); }
    return { ...c, hi, lo };
  });
  add(buildTerrainSkirt(hf), M.skirt, false, false);
  add(buildWater(tile, hf), M.water, false, true);
  addChunked(roads.asphalt, M.asphalt);
  addChunked(roads.paving, M.paving, { maxDist: 1500 });
  addChunked(roads.markings, M.markings, { receive: false, maxDist: 900 });
  addChunked(roads.concrete, M.concrete, { cast: true });

  progress(0.76, `Raising ${tile.buildings.length.toLocaleString()} buildings…`); await frame();
  const resolved = await timed('conflicts', () => resolveConflicts(tile.buildings, raster));
  console.info(`[PuneRemix] buildings: ${resolved.kept.length} kept, ${resolved.shrunk} shrunk away from roads, ${resolved.dropped} dropped (on a road)`);
  tile.buildings = resolved.kept;
  const bm = await timed('buildings', () => buildBuildings(tile.buildings, hf));
  // one layer for all buildings: plain vertex colours, walls + roofs merged
  for (const s of FACADE_STYLES) appendInto(bm.roofs, bm.walls[s]);
  addChunked(bm.roofs, M.roofs, { cast: true });

  progress(0.84, 'Laying railway and metro…'); await frame();
  const rail = await timed('rail', () => buildRail(tile, hf, roads.geos.filter((g) => g.s.viaduct).map((g) => ({ pts: g.pts, oneway: g.t.oneway }))));
  addChunked(rail.ballast, M.paving);
  addChunked(rail.structure, M.concrete, { cast: true });
  addChunked(rail.steel, M.steel, { receive: false, maxDist: 1200 });

  progress(0.9, 'Planting trees…'); await frame();
  const trees = await timed('trees', () => placeTrees(tile, hf, roads.geos.map((g) => ({ pts: g.pts, hw: Math.max(g.t.hwL, g.t.hwR), cls: g.s.cls })), raster));
  const treeChunks = buildTreeMeshes(trees, tile.half, M.trees);
  for (const c of treeChunks) { S.add(c.high); S.add(c.low); }

  // ---------- Camera ----------
  const controls = new CityControls(engine.canvas, engine.camera, (x, z) => hf.sampleSurface(x, z));
  controls.bounds = tile.half;
  controls.target.set(-350, 0, 150);
  controls.dist = 5200; controls.pitch = 1.25; controls.yaw = 0.4;
  controls.snap();
  controls.dist = 1500; controls.pitch = 0.62; controls.yaw = 0.55;

  // ---------- HUD ----------
  $('tile-name').textContent = `${tile.name} · ${tile.city} · ${tile.half * 2 / 1000}×${tile.half * 2 / 1000} km`;
  $('attrib').textContent = tile.attribution;
  $('stats').textContent = `${network.segments.length.toLocaleString()} road segments · ${roads.stats.junctions.toLocaleString()} junctions · ${roads.stats.roundabouts} roundabouts · ${tile.buildings.length.toLocaleString()} buildings · ${trees.length.toLocaleString()} trees`;
  console.info('[PuneRemix] build timings:', timings.join(' · '), '');
  let minutes = 9 * 60 + 30;
  let timeSpeed = 0;
  const tod = $('tod') as HTMLInputElement;
  tod.oninput = () => { minutes = Number(tod.value); };
  ($('play') as HTMLButtonElement).onclick = () => { timeSpeed = timeSpeed ? 0 : 1; $('play').textContent = timeSpeed ? '⏸' : '▶'; };
  const toggle = (id: string, key: 'ao' | 'bloom' | 'shadows') => {
    const el = $(id) as HTMLInputElement;
    el.checked = engine.quality[key];
    el.onchange = () => {
      autoQuality = false; // the player chose; stop overriding
      engine.quality[key] = el.checked;
      if (key === 'shadows') { engine.renderer.shadowMap.enabled = el.checked; engine.sun.castShadow = el.checked; }
      else engine.buildPipeline();
    };
  };
  toggle('q-ao', 'ao'); toggle('q-bloom', 'bloom'); toggle('q-shadows', 'shadows');

  // Click → what's here
  const info = $('info');
  controls.onClick = (cx, cy) => {
    const p = controls.pick(cx, cy);
    if (!p) { info.hidden = true; return; }
    const code = raster.at(p.x, p.z);
    const seg = code > 0 ? network.segments[code - 1] : null;
    const node = code < 0 ? network.nodes[-code - 1] : null;
    const bld = tile.buildings.find((b) => inRing(p.x, p.z, b.outer));
    info.hidden = false;
    const ty = seg ? network.types[seg.type] : null;
    info.innerHTML = seg && ty
      ? `<b>${seg.name || 'Unnamed ' + seg.cls}</b><small>${seg.cls} · ${ty.oneway ? ty.lanesF + ' lanes one-way' : ty.lanesF + '+' + ty.lanesB + ' lanes'}${ty.parts.some((x) => x.kind === 'median') ? ' · divided' : ''}${ty.hwL > ty.cwL ? ' · footpaths' : ''} · ${seg.reserve ? `DP reserve ${seg.reserve} m` : 'width estimated'} · ${seg.bridge !== 'none' ? seg.bridge + ' bridge' : seg.elevated ? 'ramp' : 'at grade'} · ${(hf.base + p.y).toFixed(0)} m asl</small>`
      : node ? `<b>${node.R ? 'Roundabout' : 'Junction'}</b><small>${node.signals ? 'signalised · ' : ''}${(hf.base + p.y).toFixed(0)} m asl</small>`
      : bld ? `<b>${bld.name || 'Building'}</b><small>${Math.round(bld.h)} m tall · ~${Math.max(1, Math.round(bld.h / 3.2))} floors</small>`
        : `<small>${(hf.base + p.y).toFixed(1)} m above sea level</small>`;
  };

  $('loading').hidden = true;
  $('hud').hidden = false;

  // ---------- Loop ----------
  let last = performance.now(), acc = 0, n = 0, cpuMs = 0;
  let autoQuality = true;
  let warmup = 3; // seconds to ignore while shaders compile
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    controls.update(dt);
    minutes = (minutes + dt * timeSpeed * 20) % 1440;
    const night = engine.setTimeOfDay(minutes);
    M.night.value = night;
    const focus = controls.focus;
    engine.updateShadows(focus, Math.min(2600, Math.max(160, controls.currentDist * 1.1)));
    const cam = engine.camera.position;
    // distance culling (frustum culling is automatic per chunk)
    const camH = Math.max(0, cam.y - focus.y);
    for (const L of layers) {
      if (L.maxDist === Infinity) continue;
      L.mesh.visible = Math.hypot(L.cx - cam.x, L.cz - cam.z) - L.r < L.maxDist + camH * 0.5;
    }
    for (const c of terrainChunks) {
      const near = Math.hypot(c.cx - cam.x, c.cz - cam.z) - c.radius < 900 + camH * 0.6;
      c.hi.visible = near; c.lo.visible = !near;
    }
    for (const c of treeChunks) {
      const d = Math.hypot(c.center.x - cam.x, c.center.z - cam.z);
      c.high.visible = d < 700;
      c.low.visible = d >= 700 && d < 6000;
    }
    const tc = performance.now();
    engine.render();
    cpuMs += performance.now() - tc;
    acc += dt; n++;
    if (acc > 1) {
      const fps = n / acc;
      engine.sampleGpuTime();
      // dynamic resolution + auto quality: hold ~60 fps, sharpen when there's headroom
      const q = engine.quality;
      if (warmup > 0) warmup--;
      else if (fps < 52 && q.scale > 0.6) { q.scale = Math.max(0.6, q.scale - 0.1); engine.resize(); }
      else if (fps < 45 && q.scale <= 0.6 && q.ao && autoQuality) { q.ao = false; engine.buildPipeline(); ($('q-ao') as HTMLInputElement).checked = false; }
      else if (fps > 58 && q.scale < engine.maxScale && (engine.gpuMs === 0 || engine.gpuMs < 11)) { q.scale = Math.min(engine.maxScale, q.scale + 0.05); engine.resize(); }
      $('fps').textContent = `${Math.round(fps)} fps · ${Math.round(q.scale * 100)}% res${engine.gpuMs ? ` · GPU ${engine.gpuMs.toFixed(1)} ms` : ''} · CPU ${(cpuMs / n).toFixed(1)} ms`;
      cpuMs = 0;
      const hh = Math.floor(minutes / 60), mm = Math.floor(minutes % 60);
      $('clock').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      if (document.activeElement !== tod) tod.value = String(Math.floor(minutes));
      acc = 0; n = 0;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  if (import.meta.env.DEV) Object.assign(window, { __app: { engine, controls, network, hf, tile, roads, M } });
}

function inRing(x: number, z: number, r: Float32Array) {
  let c = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2], zi = r[i * 2 + 1], xj = r[j * 2], zj = r[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

boot().catch((e) => { console.error(e); $('load-msg').textContent = 'Error: ' + (e as Error).message; });
