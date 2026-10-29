// Exports: GeoJSON (WGS84, for QGIS / OSM folks) and a compiled network.json (for the offline pipeline + tools).
import type { CityDoc } from './doc';
import type { Compiler } from './compile';
import type { Network, NetNode, NetSegment, PathLine } from '../net/model';
import { describe, laneCount, totalWidth, isOneway } from './xsection';

export interface Proj { lat0: number; lon0: number; kx: number; kz: number }

export function toGeoJSON(doc: CityDoc, C: Compiler, P: Proj, opts: { buildings?: boolean; lines?: boolean } = {}) {
  const ll = (x: number, z: number) => [Math.round((P.lon0 + x / P.kx) * 1e7) / 1e7, Math.round((P.lat0 - z / P.kz) * 1e7) / 1e7];
  const features: unknown[] = [];
  for (const s of doc.all('section')) {
    const g = C.geo(s.id);
    if (!g) continue;
    const coords: number[][] = [];
    for (let i = 0; i < g.pts.length; i += 2) coords.push(ll(g.pts[i], g.pts[i + 1]));
    const road = doc.get<'road'>(s.road);
    const n = laneCount(s.parts);
    features.push({
      type: 'Feature', id: s.id, geometry: { type: 'LineString', coordinates: coords },
      properties: {
        kind: 'section', road: s.road, road_name: road?.name ?? s.name, name: s.name, class: s.cls, width_m: totalWidth(s.parts),
        lanes: n.all, lanes_forward: n.f, lanes_backward: n.b, oneway: isOneway(s.parts), summary: describe(s.parts),
        cross_section: JSON.stringify(s.parts), dp_reserve_m: s.reserve ?? null, bridge: s.bridge, elevated: s.elevated,
        verified: !!s.verified, edited: doc.patch.has(s.id) || doc.patch.has(s.road), osm_way_ids: s.wayIds.join(';'), width_source: s.widthSrc ?? null,
      },
    });
  }
  for (const j of doc.all('junction')) {
    if (doc.sectionsAt(j.id).length < 3 && !j.R && !j.signals) continue;
    features.push({ type: 'Feature', id: j.id, geometry: { type: 'Point', coordinates: ll(j.x, j.z) }, properties: { kind: 'junction', signals: j.signals, roundabout_radius_m: j.R ?? null, arms: doc.sectionsAt(j.id).length } });
  }
  if (opts.lines !== false) for (const l of doc.all('line')) {
    const L = doc.get<'layer'>(l.layer);
    if (!L?.visible && !doc.patch.has(l.id)) continue;
    const coords: number[][] = [];
    for (let i = 0; i < l.pts.length; i += 2) coords.push(ll(l.pts[i], l.pts[i + 1]));
    features.push({ type: 'Feature', id: l.id, geometry: { type: 'LineString', coordinates: coords }, properties: { kind: L?.lineKind ?? 'other', layer: L?.name ?? l.layer, depth_m: l.depth, size_m: l.size, name: l.name, ...l.props } });
  }
  // surveyed DP regions (what the plan says + what's there)
  for (const r of doc.all('region')) {
    const ring = (pts: number[]) => { const c: number[][] = []; for (let i = 0; i < pts.length; i += 2) c.push(ll(pts[i], pts[i + 1])); c.push(c[0]); return c; };
    features.push({
      type: 'Feature', id: r.id, geometry: { type: 'Polygon', coordinates: [ring(r.ring), ...(r.holes ?? []).map(ring)] },
      properties: {
        kind: 'dp_region', dp_land_use: r.cls, reserved: r.reserved, code: r.code ?? null, area_m2: r.area, dp_sheet: r.sheet ?? null,
        survey: r.status, note: r.note ?? null, links: (r.links ?? []).join(' '), surveyed_by: r.surveyedBy ?? null, surveyed_at: r.surveyedAt ?? null,
      },
    });
  }
  if (opts.buildings) for (const b of doc.all('building')) {
    const ring: number[][] = [];
    for (let i = 0; i < b.outer.length; i += 2) ring.push(ll(b.outer[i], b.outer[i + 1]));
    ring.push(ring[0]);
    features.push({ type: 'Feature', id: b.id, geometry: { type: 'Polygon', coordinates: [ring] }, properties: { kind: 'building', height_m: b.h, name: b.name } });
  }
  return { type: 'FeatureCollection', name: doc.meta.name, features };
}

/** The edited map as a baked network (same schema as public/tiles/<id>/network.json). */
export function toNetwork(doc: CityDoc, C: Compiler, half: number): Network {
  const m = C.mesher;
  const idx = new Map<string, number>();
  const nodes: NetNode[] = [];
  for (const n of m.nodes.values()) {
    idx.set(n.id, nodes.length);
    nodes.push({ id: nodes.length, x: round(n.x), z: round(n.z), lift: round(n.lift), R: n.R, ringLanes: n.ringLanes, signals: n.signals || undefined });
  }
  const types: Network['types'] = {};
  const segments: NetSegment[] = [];
  for (const s of m.segs.values()) {
    const sec = s.owner ? doc.get<'section'>(s.owner) : undefined;
    types[s.t.id] = s.t;
    segments.push({
      id: segments.length, a: idx.get(s.a)!, b: idx.get(s.b)!, p: s.p.map(round), type: s.t.id, name: sec?.name ?? '', cls: s.cls,
      bridge: s.bridge, deck: sec?.deck ?? 0, wayIds: sec?.wayIds ?? [],
      ...(sec?.reserve ? { reserve: sec.reserve } : {}), ...(s.viaduct ? { viaduct: true } : {}), ...(s.elevated ? { elevated: true } : {}),
    });
  }
  const paths: PathLine[] = doc.linesOf('paths').map((l) => ({ pts: l.pts, width: l.size, kind: String(l.props.kind ?? 'footway') }));
  return { half, nodes, segments, types, paths };
}

const round = (v: number) => Math.round(v * 100) / 100;
