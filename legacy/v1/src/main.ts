// Pune Remix — boot, game loop and UI wiring.
import { Renderer } from './engine/renderer';
import { MeshBuilder, GpuMesh, InstanceGroup } from './engine/mesh';
import { CityCamera, CameraControls } from './engine/camera';
import { lightingAt, demandAt } from './engine/sky';
import { hex, clamp } from './engine/math';
import { loadTile, type Road, CLASS_LABEL, corridorHalf, carriageway } from './world/tile';
import { buildGround, buildBuildings, buildRoads, ribbon } from './world/meshgen';
import * as A from './world/assets';
import { placeStaticTrees, placeStreetTrees, placeBusStops, placeStreetLights } from './world/scenery';
import { RoadIndex } from './world/spatial';
import { Traffic } from './sim/traffic';
import { Pedestrians } from './sim/pedestrians';
import { ScoreModel, type Scores } from './game/scores';
import { Editor, TOOLS, type ToolId } from './game/editor';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

async function boot() {
  const canvas = $<HTMLCanvasElement>('gpu');
  const renderer = new Renderer(canvas);
  try {
    await renderer.init();
  } catch (e) {
    $('loading').hidden = true;
    $('nogpu').hidden = false;
    $('nogpu-msg').textContent = (e as Error).message;
    return;
  }

  const progress = (f: number, msg: string) => {
    $('load-bar').style.width = `${Math.round(f * 100)}%`;
    $('load-msg').textContent = msg;
  };
  const tile = await loadTile('baner', progress);
  const device = renderer.device;
  const upload = (mb: MeshBuilder, label: string) => { const m = new GpuMesh(device, label); m.upload(mb); return m; };

  progress(0.4, 'Laying out land and water…'); await nextFrame();
  const groundMB = new MeshBuilder(1 << 14, 1 << 15);
  buildGround(tile, groundMB);
  const groundMesh = upload(groundMB, 'ground');

  progress(0.55, `Raising ${tile.buildings.length.toLocaleString()} buildings…`); await nextFrame();
  const bMB = new MeshBuilder(1 << 18, 1 << 19);
  buildBuildings(tile, bMB);
  const buildingMesh = upload(bMB, 'buildings');

  progress(0.7, `Paving ${tile.roads.length.toLocaleString()} road segments…`); await nextFrame();
  const roadMB = new MeshBuilder(1 << 18, 1 << 19);
  buildRoads(tile, roadMB);
  const roadMesh = upload(roadMB, 'roads');
  const hlMB = new MeshBuilder();
  const hlMesh = new GpuMesh(device, 'highlight');

  progress(0.8, 'Planting trees…'); await nextFrame();
  const G = (mb: MeshBuilder, label: string, cap: number, shadow = true) => new InstanceGroup(device, upload(mb, label), cap, shadow);
  // Moving things don't cast shadows → the shadow map can be cached between frames.
  const bikes = G(A.bikeMesh(), 'bike', 2048, false);
  const cars = G(A.carMesh(), 'car', 2048, false);
  const autos = G(A.autoMesh(), 'auto', 1024, false);
  const buses = G(A.busMesh(), 'bus', 256, false);
  const peds = G(A.personMesh(), 'person', 2048, false);
  const treeMesh = upload(A.treeMesh(), 'tree');
  const staticTrees = new InstanceGroup(device, treeMesh, 16384);
  const streetTrees = new InstanceGroup(device, treeMesh, 8192);
  const stops = G(A.busStopMesh(), 'busstop', 256);
  const lights = G(A.streetLightMesh(), 'light', 2048);

  const treePts = placeStaticTrees(tile, staticTrees);
  placeStreetTrees(tile, streetTrees);
  placeStreetLights(tile, lights);
  const index = new RoadIndex(tile);
  const nearDrive = (x: number, z: number) => index.nearest(x, z, { maxExtra: 30, driveOnly: true });
  placeBusStops(tile, stops, nearDrive);

  renderer.statics = [buildingMesh, roadMesh, groundMesh]; // front-most first → early depth rejection
  renderer.overlays = [hlMesh];
  renderer.instances = [staticTrees, streetTrees, lights, stops, bikes, cars, autos, buses, peds];

  progress(0.9, 'Starting traffic…'); await nextFrame();
  const traffic = new Traffic(tile);
  const walkers = new Pedestrians(tile);
  const scoreModel = new ScoreModel(tile, treePts);
  const editor = new Editor(tile);

  // ---------- Camera ----------
  const cam = new CityCamera();
  cam.bounds = tile.half;
  const baner = tile.roads.filter((r) => /^Baner Road$/i.test(r.alt) || /^Baner Road$/i.test(r.name));
  const focusRoads = baner.length ? baner : tile.roads.filter((r) => r.clsIndex <= 2);
  if (focusRoads.length) {
    const mid = focusRoads[Math.floor(focusRoads.length / 2)];
    const m = Math.floor(mid.pts.length / 4) * 2;
    cam.target = [mid.pts[m], 0, mid.pts[m + 1]];
  }
  cam.dist = 2600; cam.pitch = 1.2; cam.yaw = 0.5;
  cam.snap();
  cam.dist = 520; cam.pitch = 0.62; cam.yaw = 0.35; // fly-in
  const controls = new CameraControls(canvas, cam);

  // ---------- State ----------
  let minutes = 8 * 60 + 30;
  let speed = 1;
  let compare = false;
  let roadsDirty = false, stopsDirty = false, lastRebuild = 0;
  let hovered: Road | null = null;
  let selected: Road | null = null;
  let scores: Scores = scoreModel.compute(0.7, 0.5);
  let baseline: Scores | null = { ...scores };
  let baselineSettled = false;
  let wantShot = false;

  // ---------- Highlight overlay ----------
  const HL_HOVER = hex(0xffd166, 5), HL_SEL = hex(0xff8a3d, 5);
  function rebuildHighlight() {
    hlMB.clear();
    const draw = (roads: Road[], color: number) => {
      for (const r of roads) {
        const h = corridorHalf(r) + 0.4;
        ribbon(hlMB, r.pts, h, h + 0.9, 0.34, color);
        ribbon(hlMB, r.pts, -h - 0.9, -h, 0.34, color);
      }
    };
    if (hovered && hovered !== selected) draw(editor.tool === 'inspect' ? [hovered] : editor.street(hovered), HL_HOVER);
    if (selected) draw(editor.wholeStreet ? editor.street(selected) : [selected], HL_SEL);
    hlMesh.upload(hlMB);
  }

  function rebuildWorld() {
    buildRoads(tile, roadMB, compare);
    roadMesh.upload(roadMB);
    placeStreetTrees(tile, streetTrees, compare);
    placeStreetLights(tile, lights);
    renderer.shadowDirty = true;
    traffic.rebuildGraph();
    walkers.rebuild();
    rebuildHighlight();
    if (selected) showInspector(selected);
  }

  editor.onChange = (kind) => { if (kind === 'roads') roadsDirty = true; else stopsDirty = true; };
  editor.onToast = toast;

  // ---------- UI: toolbar ----------
  const toolbar = $('toolbar');
  for (const t of TOOLS) {
    const b = document.createElement('button');
    b.className = 'tool';
    b.dataset.tool = t.id;
    b.title = `${t.label} (${t.key})`;
    b.innerHTML = `<span class="ic">${t.icon}</span><span class="tl">${t.label}</span>`;
    b.onclick = () => setTool(t.id);
    toolbar.appendChild(b);
  }
  function setTool(id: ToolId) {
    editor.tool = id;
    controls.leftDragPans = id === 'inspect';
    for (const el of toolbar.querySelectorAll<HTMLElement>('.tool')) el.classList.toggle('on', el.dataset.tool === id);
    const def = TOOLS.find((t) => t.id === id)!;
    $('hint').textContent = def.hint + (id === 'inspect' ? '' : '  ·  Drag across roads to paint. Shift-drag or middle-drag pans.');
    const opts = $('options');
    opts.innerHTML = '';
    for (const o of def.options) {
      const b = document.createElement('button');
      b.textContent = o.label;
      b.classList.toggle('on', editor.option[id] === o.id);
      b.onclick = () => { editor.option[id] = o.id; setTool(id); };
      opts.appendChild(b);
    }
    canvas.style.cursor = id === 'inspect' ? 'grab' : 'crosshair';
  }
  setTool('inspect');

  // ---------- UI: report card ----------
  const ROWS: [keyof Scores, string, string][] = [
    ['walk', '🚶', 'Walkability'], ['shade', '🌳', 'Shade & green'], ['safety', '⚠️', 'Road safety'],
    ['transit', '🚌', 'Transit access'], ['flow', '🚗', 'Traffic flow'],
  ];
  const rowsEl = $('score-rows');
  rowsEl.innerHTML = ROWS.map(([k, ic, lbl]) => `
    <div class="row" data-k="${k}"><span>${ic}</span>
      <div><div class="lbl"><span>${lbl}</span><span class="delta" data-d="${k}"></span></div><div class="meter"><div class="fill" data-f="${k}"></div></div></div>
      <span class="val" data-v="${k}">0</span></div>`).join('');
  const scoreColor = (x: number) => `hsl(${Math.round(clamp(x, 0, 1) * 130)}, 70%, 52%)`;
  function renderScores() {
    for (const [k] of ROWS) {
      const v = scores[k] as number;
      (rowsEl.querySelector(`[data-f="${k}"]`) as HTMLElement).style.width = `${Math.round(v * 100)}%`;
      (rowsEl.querySelector(`[data-f="${k}"]`) as HTMLElement).style.background = scoreColor(v);
      (rowsEl.querySelector(`[data-v="${k}"]`) as HTMLElement).textContent = String(Math.round(v * 100));
      const dEl = rowsEl.querySelector(`[data-d="${k}"]`) as HTMLElement;
      if (baseline) {
        const d = Math.round((v - (baseline[k] as number)) * 100);
        dEl.textContent = d === 0 ? '' : d > 0 ? `▲ ${d}` : `▼ ${-d}`;
        dEl.className = 'delta ' + (d > 0 ? 'up' : 'down');
      }
    }
    const g = $('grade');
    g.textContent = scores.grade;
    g.style.color = scoreColor(scores.overall);
    $('st-veh').textContent = traffic.stats.active.toLocaleString();
    $('st-kmh').textContent = traffic.stats.avgKmh.toFixed(0);
    $('st-bus').textContent = traffic.stats.busKmh.toFixed(0);
    $('st-ped').textContent = `${Math.round(walkers.stats.onRoadPct * 100)}%`;
  }

  // ---------- UI: inspector ----------
  function showInspector(r: Road) {
    const p = r.props;
    const street = editor.wholeStreet ? editor.street(r) : [r];
    const len = street.reduce((s, x) => s + x.len, 0);
    $('inspector').hidden = false;
    $('ins-name').textContent = (r.name || `Unnamed ${CLASS_LABEL[r.cls].toLowerCase()}`) + (r.alt && r.alt !== r.name ? ` (${r.alt})` : '');
    $('ins-class').textContent = `${CLASS_LABEL[r.cls]} · ${len >= 1000 ? (len / 1000).toFixed(2) + ' km' : Math.round(len) + ' m'}${r.oneway ? ' · one-way' : ''}${street.length > 1 ? ` · ${street.length} blocks` : ''}`;
    const yes = (b: boolean) => (b ? '✅ Yes' : '— None');
    const cells: [string, string][] = r.drive ? [
      ['Lanes', `${p.lanes}`], ['Road width', `${carriageway(r).toFixed(1)} m`],
      ['Footpath', p.footpath ? `${p.footpath} m` : '❌ None'], ['Street trees', yes(p.trees)],
      ['Bus lane', yes(p.busLane)], ['Cycle track', yes(p.cycle)],
      ['Median', yes(p.median)], ['Crossings', yes(p.crossings)],
      ['Walk score', `${Math.round(scoreModel.roadWalk(r) * 100)}`], ['Safety', `${Math.round(scoreModel.roadSafety(r) * 100)}`],
    ] : [['Type', CLASS_LABEL[r.cls]], ['Width', `${carriageway(r).toFixed(1)} m`]];
    $('ins-grid').innerHTML = cells.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('');
    const q = $('ins-quick');
    q.innerHTML = '';
    if (!r.drive) return;
    const btn = (label: string, fn: () => void) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; q.appendChild(b); };
    btn('✨ Remix this street', () => remixPreset(r));
    btn('↺ Restore original', () => editor.edit(editor.street(r), (s) => { s.props = { ...s.original }; }));
  }
  $('ins-close').onclick = () => { selected = null; $('inspector').hidden = true; rebuildHighlight(); };

  /** One-click "complete street" based on Indian street-design guidance (indicative). */
  function remixPreset(r: Road) {
    editor.edit(editor.street(r), (s) => {
      const p = s.props;
      const big = s.clsIndex <= 3;
      p.footpath = big ? 3 : s.clsIndex === 4 ? 2.5 : 1.8;
      p.trees = true;
      p.crossings = s.clsIndex <= 5;
      if (big && p.lanes >= 4 && !s.oneway) { p.median = true; p.busLane = true; p.cycle = true; }
      else if (big) p.cycle = true;
    });
    toast('✨ Complete street: wide footpaths, shade trees, safe crossings' + (r.clsIndex <= 3 ? ', bus lane & cycle track' : ''));
  }

  // ---------- Input → tools ----------
  const W = () => canvas.clientWidth, H = () => canvas.clientHeight;
  const pick = (x: number, y: number, extra = 6) => {
    const g = cam.groundAt(x, y, W(), H());
    return g ? { g, hit: index.nearest(g[0], g[2], { maxExtra: extra }) } : null;
  };
  controls.onClick = (x, y) => {
    const p = pick(x, y);
    selected = p?.hit?.road ?? null;
    if (selected) showInspector(selected); else $('inspector').hidden = true;
    rebuildHighlight();
  };
  const paintAt = (x: number, y: number) => {
    const p = pick(x, y, 5);
    if (!p?.hit) return;
    if (editor.apply(p.hit.road)) selected = p.hit.road;
  };
  controls.onPaintStart = (x, y) => {
    if (editor.tool === 'busstop') {
      const p = pick(x, y, 30);
      if (p) editor.busStopAt(p.g[0], p.g[2], p.hit && p.hit.road.drive ? p.hit : nearDrive(p.g[0], p.g[2]));
      return;
    }
    editor.beginStroke();
    paintAt(x, y);
  };
  controls.onPaint = (x, y) => { if (editor.tool !== 'busstop') paintAt(x, y); };
  controls.onPaintEnd = () => editor.endStroke();
  const tooltip = $('tooltip');
  controls.onHover = (x, y) => {
    const p = pick(x, y);
    const r = p?.hit?.road ?? null;
    if (r !== hovered) { hovered = r; rebuildHighlight(); }
    if (r) {
      tooltip.hidden = false;
      tooltip.style.left = `${x}px`; tooltip.style.top = `${y}px`;
      tooltip.innerHTML = `<b>${r.name || 'Unnamed road'}${r.alt && r.alt !== r.name ? ` · ${r.alt}` : ''}</b><small>${CLASS_LABEL[r.cls]}${r.drive ? ` · ${r.props.lanes} lanes · footpath ${r.props.footpath ? r.props.footpath + ' m' : 'none'}` : ''}</small>`;
    } else tooltip.hidden = true;
  };
  canvas.addEventListener('pointerleave', () => { tooltip.hidden = true; });

  // ---------- Top bar ----------
  $('tile-name').textContent = `${tile.name} · ${tile.city} · ${Math.round(tile.half * 2 / 1000)}×${Math.round(tile.half * 2 / 1000)} km`;
  // Search by official name or local name ("Baner Road" = Gopal Hari Deshmukh Marg in OSM)
  const nameLen = new Map<string, number>();
  for (const r of tile.roads) {
    if (!r.drive) continue;
    for (const n of [r.name, r.alt]) if (n && !/^[A-Z]{1,3}\d+$/.test(n) || /^NH/.test(n)) nameLen.set(n, (nameLen.get(n) ?? 0) + r.len);
  }
  $('road-names').innerHTML = [...nameLen].filter(([, l]) => l > 120).sort((a, b) => b[1] - a[1]).map(([n]) => `<option value="${n.replace(/"/g, '&quot;')}">`).join('');
  const search = $<HTMLInputElement>('search');
  const jump = () => {
    const q = search.value.trim().toLowerCase();
    if (!q) return;
    const exact = tile.roads.filter((r) => r.name.toLowerCase() === q || r.alt.toLowerCase() === q);
    let found = exact;
    if (!found.length) {
      // best partial match = the matching name with the most road length (prefers main roads)
      let best = '', bestLen = 0;
      for (const [n, l] of nameLen) if (n.toLowerCase().includes(q) && l > bestLen) { best = n; bestLen = l; }
      found = best ? tile.roads.filter((r) => r.name === best || r.alt === best) : [];
    }
    if (!found.length) { toast(`No road called “${search.value}” in this tile`); return; }
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const r of found) for (let i = 0; i < r.pts.length; i += 2) { x0 = Math.min(x0, r.pts[i]); x1 = Math.max(x1, r.pts[i]); z0 = Math.min(z0, r.pts[i + 1]); z1 = Math.max(z1, r.pts[i + 1]); }
    cam.target = [(x0 + x1) / 2, 0, (z0 + z1) / 2];
    cam.dist = clamp(Math.max(x1 - x0, z1 - z0) * 1.3, 120, 2600);
    cam.pitch = 0.75;
    selected = found.reduce((a, b) => (b.clsIndex < a.clsIndex ? b : a));
    showInspector(selected);
    rebuildHighlight();
    search.blur();
  };
  search.addEventListener('change', jump);
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') jump(); e.stopPropagation(); });

  const tod = $<HTMLInputElement>('tod');
  tod.oninput = () => { minutes = parseInt(tod.value, 10); };
  const setSpeed = (s: number) => {
    speed = s;
    for (const b of $('speeds').querySelectorAll<HTMLElement>('button')) b.classList.toggle('on', Number(b.dataset.speed) === s);
  };
  for (const b of $('speeds').querySelectorAll<HTMLElement>('button')) b.onclick = () => setSpeed(Number(b.dataset.speed));
  $<HTMLInputElement>('density').oninput = (e) => { traffic.density = parseFloat((e.target as HTMLInputElement).value); };

  // ---------- Actions ----------
  $<HTMLInputElement>('whole').onchange = (e) => { editor.wholeStreet = (e.target as HTMLInputElement).checked; rebuildHighlight(); if (selected) showInspector(selected); };
  $('undo').onclick = () => editor.undo();
  $('redo').onclick = () => editor.redo();
  $('reset').onclick = () => { editor.resetAll(); toast('Back to today’s Baner'); };
  $('shot').onclick = () => { wantShot = true; };
  const setCompare = (on: boolean) => {
    if (compare === on) return;
    compare = on;
    $('compare-badge').hidden = !on;
    $('compare').classList.toggle('on', on);
    buildRoads(tile, roadMB, compare); roadMesh.upload(roadMB);
    placeStreetTrees(tile, streetTrees, compare);
    renderer.shadowDirty = true;
  };
  const cmp = $('compare');
  cmp.addEventListener('pointerdown', () => setCompare(true));
  window.addEventListener('pointerup', () => setCompare(false));

  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? editor.redo() : editor.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); editor.redo(); return; }
    const t = TOOLS.find((x) => x.key === e.key);
    if (t) setTool(t.id);
    if (e.key === ' ') { e.preventDefault(); setSpeed(speed === 0 ? 1 : 0); }
    if (e.key.toLowerCase() === 'c' && !e.repeat) setCompare(true);
    if (e.key.toLowerCase() === 'p') wantShot = true;
    if (e.key === 'Escape') { setTool('inspect'); selected = null; $('inspector').hidden = true; rebuildHighlight(); }
  });
  window.addEventListener('keyup', (e) => { if (e.key.toLowerCase() === 'c') setCompare(false); });

  let toastTimer = 0;
  function toast(msg: string) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (t.hidden = true), 2600);
  }

  progress(1, 'Welcome to Baner'); await nextFrame();
  $('loading').hidden = true;
  $('hud').hidden = false;

  // ---------- Loop ----------
  let last = performance.now();
  let uiTimer = 0, fpsAcc = 0, fpsN = 0;
  const perf = { sim: 0, inst: 0, render: 0 };
  (window as any).__perf = perf;
  // Debug handle (dev only) for benchmarking from the console
  if (import.meta.env.DEV) (window as any).__game = { renderer, cam, traffic, walkers, tile, editor, lightingAt, get minutes() { return minutes; } };
  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    renderer.resize();
    cam.aspect = renderer.width / renderer.height;
    controls.update(dt);
    cam.update(dt);

    if ((roadsDirty || stopsDirty) && now - lastRebuild > 70) {
      if (roadsDirty) rebuildWorld();
      if (stopsDirty) placeBusStops(tile, stops, nearDrive);
      roadsDirty = stopsDirty = false;
      lastRebuild = now;
      scores = scoreModel.compute(traffic.stats.flow, walkers.stats.onRoadPct);
      renderScores();
    }

    const simDt = dt * speed;
    minutes = (minutes + simDt) % 1440;
    traffic.demand = demandAt(minutes);
    const t0 = performance.now();
    traffic.step(simDt);
    walkers.walkability = scores.walk;
    walkers.step(simDt);
    const t1 = performance.now();
    traffic.writeInstances([bikes, cars, autos, buses]);
    walkers.writeInstances(peds);
    const t2 = performance.now();

    const L = lightingAt(minutes, now / 1000);
    renderer.render(cam.viewProj, cam.eye, cam.currentTarget, clamp(cam.currentDist * 1.25, 120, 2600), L);
    const t3 = performance.now();
    perf.sim += ((t1 - t0) - perf.sim) * 0.1;
    perf.inst += ((t2 - t1) - perf.inst) * 0.1;
    perf.render += ((t3 - t2) - perf.render) * 0.1;

    if (wantShot) {
      wantShot = false;
      canvas.toBlob((b) => {
        if (!b) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = `pune-remix-${tile.id}-${Date.now()}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast('📸 Screenshot saved');
      });
    }

    uiTimer += dt; fpsAcc += dt; fpsN++;
    if (uiTimer > 0.4) {
      uiTimer = 0;
      scores = scoreModel.compute(traffic.stats.flow, walkers.stats.onRoadPct);
      // Baseline = today's Baner. Flow/safety need the sim to settle; if the player already edited, keep the static parts.
      if (!baselineSettled && traffic.time > 12) {
        baseline = editor.changedCount === 0 ? { ...scores } : { ...baseline!, flow: scores.flow };
        baselineSettled = true;
      }
      renderScores();
      const hh = Math.floor(minutes / 60), mm = Math.floor(minutes % 60);
      $('clock').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      if (document.activeElement !== tod) tod.value = String(Math.floor(minutes));
      const fps = fpsN / fpsAcc;
      // Dynamic resolution: keep it smooth on integrated GPUs, sharpen when there's headroom
      if (fps < 50 && renderer.renderScale > 0.55) renderer.renderScale = Math.max(0.55, renderer.renderScale - 0.1);
      else if (fps > 58 && renderer.renderScale < 1) renderer.renderScale = Math.min(1, renderer.renderScale + 0.05);
      $('fps').textContent = `${Math.round(fps)} fps · ${Math.round(renderer.renderScale * 100)}% res · ${editor.changedCount} blocks remixed`;
      fpsAcc = 0; fpsN = 0;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot().catch((e) => {
  console.error(e);
  $('load-msg').textContent = 'Error: ' + (e as Error).message;
});
