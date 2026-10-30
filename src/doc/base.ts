// Base document from baked data: the compiled road network (nodes + Bézier pieces) is regrouped into the objects
// people think in — junctions, sections (junction → junction, one cross-section) and roads (named / continuous streets).
import type { Network, NetSegment } from '../net/model';
import type { TileData } from '../data/tile';
import type { Anchor, BuildingObj, Id, JunctionObj, LayerObj, LineKind, LineObj, Obj, RoadObj, SectionObj } from './types';
import { hash, uniquify } from './ids';

export interface UtilitiesFile {
  version: 1;
  layers: { id: string; name: string; kind: LineKind; source?: string; url?: string; license?: string; retrieved?: string;
    lines: { id: string; pts: number[]; props?: Record<string, unknown> }[] }[];
}

const r1 = (v: number) => Math.round(v);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Depth (m below ground) by utility type when the data doesn't say. Typical Indian urban practice. */
export const DEFAULT_DEPTH: Record<LineKind, number> = { sewer: 2.5, storm: 1.5, water: 1.2, power: 1.0, gas: 1.0, telecom: 0.8, metro: -9, rail: 0, path: 0, other: 1, canal: 0, nalla: 0, hv: 0, transit: 0, site: 0, zone: 0 };
export const DEFAULT_SIZE: Record<LineKind, number> = { sewer: 0.45, storm: 0.9, water: 0.3, power: 0.15, gas: 0.15, telecom: 0.1, metro: 9, rail: 3, path: 1.8, other: 0.3, canal: 8, nalla: 12, hv: 27, transit: 4, site: 10, zone: 0 };
/** Satellite imagery sources. `{token}` is filled from this browser's settings, never stored with a map. */
export const IMAGERY: Record<string, { name: string; url: string; credit: string; terms: string; token?: string; maxZ: number }> = {
  esri: { name: 'Esri World Imagery', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', credit: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community', terms: 'Esri terms of use: viewing with attribution; production / commercial use needs an ArcGIS account', maxZ: 19 },
  mapbox: { name: 'Mapbox Satellite', url: 'https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token={token}', credit: '© Mapbox © Maxar', terms: 'Mapbox terms (free tier with your access token)', token: 'mapbox', maxZ: 20 },
};

export const LINE_COLOR: Record<LineKind, string> = {
  sewer: '#3fa34d', storm: '#7a5cd6', water: '#2f80ed', power: '#e5484d', gas: '#f5c518', telecom: '#f2994a', metro: '#d2479b', rail: '#9aa0a6', path: '#c9b98f', other: '#9e9e9e',
  canal: '#2b8fc7', nalla: '#4aa3a0', hv: '#d9822b', transit: '#c2410c', site: '#6b7280', zone: '#3b82f6',
};
export const LINE_LABEL: Record<LineKind, string> = {
  sewer: 'Sewer', storm: 'Stormwater', water: 'Water supply', power: 'Power', gas: 'Gas', telecom: 'Telecom', metro: 'Metro', rail: 'Railway', path: 'Footpaths & trails', other: 'Other utility',
  canal: 'Canals', nalla: 'Nallas & streams', hv: 'Power lines (overhead)', transit: 'Bus & BRT', site: 'Sites & structures', zone: 'Zones',
};

export function buildBase(net: Network, tile: TileData, utilities?: UtilitiesFile | null): Map<Id, Obj> {
  const out = new Map<Id, Obj>();
  const put = (o: Obj) => out.set(o.id, o);
  const segs = net.segments;
  const at = new Map<number, NetSegment[]>();
  for (const s of segs) for (const n of [s.a, s.b]) (at.get(n) ?? at.set(n, []).get(n)!).push(s);
  const same = (p: NetSegment, q: NetSegment) => p.type === q.type && p.name === q.name && p.cls === q.cls && p.bridge === q.bridge
    && !!p.elevated === !!q.elevated && !!p.viaduct === !!q.viaduct && (p.reserve ?? 0) === (q.reserve ?? 0);
  const shape = new Set<number>();
  for (const n of net.nodes) {
    const S = at.get(n.id) ?? [];
    if (S.length !== 2 || n.R || n.signals || S[0] === S[1]) continue;
    const [p, q] = S;
    const flows = (p.b === n.id && q.a === n.id) || (q.b === n.id && p.a === n.id);
    if (flows && same(p, q)) shape.add(n.id);
  }

  // ---- chains of pieces → sections ----
  const visited = new Set<number>();
  const chains: NetSegment[][] = [];
  const walk = (s: NetSegment, from: number) => {
    const chain = [s];
    visited.add(s.id);
    if (s.a === from) {
      let cur = s.b;
      while (shape.has(cur)) {
        const nx = at.get(cur)!.find((q) => q !== chain[chain.length - 1] && q.a === cur);
        if (!nx || visited.has(nx.id)) break;
        chain.push(nx); visited.add(nx.id); cur = nx.b;
      }
    } else {
      let cur = s.a;
      while (shape.has(cur)) {
        const pv = at.get(cur)!.find((q) => q !== chain[0] && q.b === cur);
        if (!pv || visited.has(pv.id)) break;
        chain.unshift(pv); visited.add(pv.id); cur = pv.a;
      }
    }
    chains.push(chain);
  };
  for (const n of net.nodes) {
    if (shape.has(n.id)) continue;
    for (const s of at.get(n.id) ?? []) if (!visited.has(s.id)) walk(s, n.id);
  }
  for (const s of segs) if (!visited.has(s.id)) { shape.delete(s.a); walk(s, s.a); } // closed loops of shape points

  // ---- junctions ----
  const jid = new Map<number, Id>();
  const taken = new Set<string>();
  const junctionOf = (n: number): Id => {
    let id = jid.get(n);
    if (id) return id;
    const node = net.nodes[n];
    id = uniquify('j' + hash(`${r1(node.x)},${r1(node.z)}`), taken);
    jid.set(n, id);
    const j: JunctionObj = { kind: 'junction', id, x: r2(node.x), z: r2(node.z), lift: r2(node.lift), signals: !!node.signals };
    if (node.R) { j.R = r2(node.R); j.ringLanes = node.ringLanes ?? 1; }
    put(j);
    return id;
  };

  const sections: SectionObj[] = [];
  for (const chain of chains) {
    const f = chain[0], l = chain[chain.length - 1];
    const a = junctionOf(f.a), b = junctionOf(l.b);
    const path: Anchor[] = [];
    chain.forEach((s, k) => {
      const n = net.nodes[s.a], p = s.p;
      const prev = chain[k - 1];
      path.push({ x: r2(p[0]), z: r2(p[1]), ix: prev ? r2(prev.p[4] - prev.p[6]) : 0, iz: prev ? r2(prev.p[5] - prev.p[7]) : 0, ox: r2(p[2] - p[0]), oz: r2(p[3] - p[1]), lift: r2(n.lift) });
    });
    const lp = l.p;
    path.push({ x: r2(lp[6]), z: r2(lp[7]), ix: r2(lp[4] - lp[6]), iz: r2(lp[5] - lp[7]), ox: 0, oz: 0, lift: r2(net.nodes[l.b].lift) });
    const wayIds = [...new Set(chain.flatMap((s) => s.wayIds))].sort((x, y) => x - y);
    const ends = [`${r1(path[0].x)},${r1(path[0].z)}`, `${r1(path[path.length - 1].x)},${r1(path[path.length - 1].z)}`].sort().join('|');
    const t = net.types[f.type];
    const sec: SectionObj = {
      kind: 'section', id: uniquify('s' + hash(wayIds.join(',') + '|' + ends), taken), a, b, path,
      parts: t.parts.map((p) => ({ ...p, width: r2(p.width) })), cls: f.cls, name: f.name, road: '', surface: t.surface,
      bridge: f.bridge, deck: f.deck, elevated: !!f.elevated, viaduct: !!f.viaduct, wayIds,
      widthSrc: f.reserve ? 'dp' : 'osm',
    };
    if (f.reserve) sec.reserve = f.reserve;
    sections.push(sec);
  }

  // ---- roads: named streets, and continuous unnamed strokes ----
  const parent = new Map<Id, Id>();
  const find = (x: Id): Id => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r; };
  const union = (x: Id, y: Id) => { const a = find(x), b = find(y); if (a !== b) parent.set(a, b); };
  for (const s of sections) parent.set(s.id, s.id);
  const byJ = new Map<Id, { s: SectionObj; ux: number; uz: number }[]>();
  for (const s of sections) {
    const P = s.path, n = P.length;
    const dir = (x: number, z: number) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
    const [ax, az] = dir(P[0].ox || P[1].x - P[0].x, P[0].oz || P[1].z - P[0].z);
    const [bx, bz] = dir(P[n - 1].ix || P[n - 2].x - P[n - 1].x, P[n - 1].iz || P[n - 2].z - P[n - 1].z);
    (byJ.get(s.a) ?? byJ.set(s.a, []).get(s.a)!).push({ s, ux: ax, uz: az });
    (byJ.get(s.b) ?? byJ.set(s.b, []).get(s.b)!).push({ s, ux: bx, uz: bz });
  }
  for (const arms of byJ.values()) {
    const named = new Map<string, SectionObj[]>();
    for (const e of arms) if (e.s.name) (named.get(e.s.name) ?? named.set(e.s.name, []).get(e.s.name)!).push(e.s);
    for (const list of named.values()) for (let i = 1; i < list.length; i++) union(list[0].id, list[i].id);
    // unnamed: pair the straightest continuations of the same class
    const un = arms.filter((e) => !e.s.name);
    const pairs: [number, number, number][] = [];
    for (let i = 0; i < un.length; i++) for (let j = i + 1; j < un.length; j++) {
      if (un[i].s === un[j].s || un[i].s.cls !== un[j].s.cls) continue;
      const d = un[i].ux * un[j].ux + un[i].uz * un[j].uz;
      if (d < -0.8) pairs.push([d, i, j]);
    }
    pairs.sort((p, q) => p[0] - q[0]);
    const used = new Set<number>();
    for (const [, i, j] of pairs) { if (used.has(i) || used.has(j)) continue; used.add(i); used.add(j); union(un[i].s.id, un[j].s.id); }
  }
  const groups = new Map<Id, SectionObj[]>();
  for (const s of sections) (groups.get(find(s.id)) ?? groups.set(find(s.id), []).get(find(s.id))!).push(s);
  for (const list of groups.values()) {
    const first = list.map((s) => s.id).sort()[0];
    const name = list[0].name;
    const lenOf = (s: SectionObj) => { let L = 0; for (let i = 1; i < s.path.length; i++) L += Math.hypot(s.path[i].x - s.path[i - 1].x, s.path[i].z - s.path[i - 1].z); return L; };
    const byCls = new Map<string, number>();
    for (const s of list) byCls.set(s.cls, (byCls.get(s.cls) ?? 0) + lenOf(s));
    const cls = [...byCls].sort((p, q) => q[1] - p[1])[0][0];
    const road: RoadObj = { kind: 'road', id: uniquify('r' + hash(name + '|' + first), taken), name, cls };
    put(road);
    for (const s of list) { s.road = road.id; put(s); }
  }

  // ---- buildings ----
  tile.buildings.forEach((b, i) => {
    const o: BuildingObj = { kind: 'building', id: 'b' + i, outer: Array.from(b.outer, r2), holes: b.holes.map((h) => Array.from(h, r2)), h: r2(b.h), minH: r2(b.minH), name: b.name, src: i };
    put(o);
  });

  // ---- lines: footpaths, rail, metro, utilities ----
  net.paths.forEach((p, i) => {
    put({ kind: 'line', id: 'pa' + i, layer: 'paths', pts: p.pts.map(r2), depth: 0, size: p.width, name: '', props: { kind: p.kind } } as LineObj);
  });
  tile.rails.forEach((r, i) => {
    const metro = r.metro;
    const above = r.bridge || r.layer > 0;
    put({
      kind: 'line', id: 'rl' + i, layer: metro ? 'metro' : 'rail', pts: Array.from(r.pts, r2),
      depth: r.tunnel ? 14 : above ? -(metro ? 9 : 6.5) : 0, size: metro ? 9 : 3, name: '',
      props: { bridge: r.bridge ? 1 : 0, tunnel: r.tunnel ? 1 : 0, service: r.service ? 1 : 0 },
    } as LineObj);
  });

  // ---- layers ----
  let order = 0;
  const layer = (o: Omit<LayerObj, 'kind' | 'order' | 'locked' | 'opacity'> & Partial<LayerObj>) => put({ kind: 'layer', locked: false, opacity: 1, order: order++, ...o } as LayerObj);
  layer({ id: 'dp', name: 'Development Plan sheets', group: 'reference', type: 'dp', visible: false, opacity: 0.75, source: 'Pune Municipal Corporation — sanctioned DP', url: 'tiles/' + tile.id + '/dp/index.json' });
  layer({ id: 'osm', name: 'OpenStreetMap tiles', group: 'reference', type: 'xyz', visible: false, opacity: 0.6, url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', source: '© OpenStreetMap contributors', license: 'ODbL' });
  layer({ id: 'imagery', name: 'Custom imagery (XYZ)', group: 'reference', type: 'xyz', visible: false, opacity: 0.8, url: '' });
  layer({ id: 'satellite', name: 'Satellite', group: 'reference', type: 'xyz', visible: false, opacity: 1, preset: 'esri', mode: 'ground', roads: 'solid', url: IMAGERY.esri.url, source: IMAGERY.esri.credit, license: IMAGERY.esri.terms });
  layer({ id: 'terrain', name: 'Terrain & land use', group: 'surface', type: 'terrain', visible: true });
  layer({ id: 'water', name: 'Rivers & water', group: 'surface', type: 'water', visible: true });
  layer({ id: 'roads', name: 'Roads & junctions', group: 'surface', type: 'roads', visible: true });
  layer({ id: 'paths', name: LINE_LABEL.path, group: 'surface', type: 'lines', lineKind: 'path', visible: true, color: LINE_COLOR.path });
  layer({ id: 'buildings', name: 'Buildings', group: 'surface', type: 'buildings', visible: true });
  layer({ id: 'trees', name: 'Trees', group: 'surface', type: 'trees', visible: true });
  layer({ id: 'rail', name: LINE_LABEL.rail, group: 'surface', type: 'lines', lineKind: 'rail', visible: true, color: LINE_COLOR.rail });
  layer({ id: 'metro', name: LINE_LABEL.metro, group: 'elevated', type: 'lines', lineKind: 'metro', visible: true, color: LINE_COLOR.metro });
  for (const L of utilities?.layers ?? []) {
    layer({ id: 'u-' + L.id, name: L.name || LINE_LABEL[L.kind], group: 'underground', type: 'lines', lineKind: L.kind, visible: false, color: LINE_COLOR[L.kind] ?? LINE_COLOR.other, source: L.source, url: L.url, license: L.license });
    for (const ln of L.lines) {
      const p = ln.props ?? {};
      const props: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(p)) if (k !== 'raw' && (typeof v === 'string' || typeof v === 'number')) props[k] = v;
      put({
        kind: 'line', id: 'u' + hash(L.id + ':' + ln.id), layer: 'u-' + L.id, pts: ln.pts.map(r2),
        depth: typeof p.depth_m === 'number' ? p.depth_m : DEFAULT_DEPTH[L.kind] ?? 1,
        size: typeof p.diameter_mm === 'number' ? p.diameter_mm / 1000 : DEFAULT_SIZE[L.kind] ?? 0.3,
        name: typeof p.name === 'string' ? p.name : '', props,
      } as LineObj);
    }
  }
  return out;
}

/** Fingerprint of a base: changes whenever the importer produces a different network. */
export function baseFingerprint(base: Map<Id, Obj>): string {
  const ids = [...base.keys()].filter((k) => k[0] === 's' || k[0] === 'j').sort();
  return hash(ids.join(','));
}
