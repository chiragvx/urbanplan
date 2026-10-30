// OSM feature rules shared by the tile bake (bake2.mjs) and the region bake (bake-region.ts): building kinds and
// heights, land-cover classes, polygons (closed ways + multipolygons).
import { assembleMultipolygon } from './osmxml.mjs';

export function rand01(n) { let h = (n * 2654435761) >>> 0; h ^= h >>> 16; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0; h ^= h >>> 16; return (h >>> 0) / 4294967296; }
export const ringArea = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
export const centroid = (r) => { let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } return [x / r.length, z / r.length]; };

/** Polygons of an OSM document: { id, tags, outer: [[x,z]…], holes: [[[x,z]…]] } for closed ways and multipolygons. */
export function* osmPolygons(osm, proj, filter) {
  const ringPts = (ids) => {
    const out = [];
    for (const id of ids) { const n = osm.nodes.get(id); if (!n) return null; out.push(proj(n)); }
    if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
    return out;
  };
  const usedAsMember = new Set();
  for (const r of osm.relations.values()) {
    if (r.tags.type !== 'multipolygon' || !filter(r.tags)) continue;
    const { outer, inner } = assembleMultipolygon(r, osm.ways);
    for (const m of r.members) if (m.type === 'way') usedAsMember.add(m.ref);
    const holes = inner.map(ringPts).filter((h) => h && h.length >= 3);
    for (const o of outer) {
      const ring = ringPts(o);
      if (ring && ring.length >= 3) yield { id: r.id, tags: r.tags, outer: ring, holes };
    }
  }
  for (const w of osm.ways.values()) {
    if (w.nds.length < 4 || w.nds[0] !== w.nds[w.nds.length - 1]) continue;
    if (!filter(w.tags)) continue;
    if (usedAsMember.has(w.id) && !w.tags.building && !w.tags.landuse && !w.tags.natural) continue;
    const ring = ringPts(w.nds);
    if (ring && ring.length >= 3) yield { id: w.id, tags: w.tags, outer: ring, holes: [] };
  }
}

// kinds: 0 apartments/residential, 1 commercial/office, 2 industrial, 3 civic/edu/hospital, 4 religious, 5 house, 6 shed/informal, 7 hotel, 8 station/transport
export function buildingKind(t, area) {
  const b = t.building;
  if (['apartments', 'residential', 'dormitory'].includes(b)) return 0;
  if (['hotel'].includes(b) || t.tourism === 'hotel') return 7;
  if (['commercial', 'retail', 'office', 'supermarket', 'mall', 'kiosk'].includes(b) || t.shop || t.office) return 1;
  if (['industrial', 'warehouse', 'factory', 'service', 'garage', 'garages', 'storage_tank', 'hangar'].includes(b)) return 2;
  if (['school', 'college', 'university', 'hospital', 'public', 'civic', 'government', 'stadium', 'sports_hall'].includes(b)) return 3;
  if (['temple', 'church', 'mosque', 'religious', 'shrine', 'chapel', 'cathedral', 'synagogue', 'gurudwara'].includes(b) || t.amenity === 'place_of_worship') return 4;
  if (['train_station', 'transportation'].includes(b)) return 8;
  if (['house', 'detached', 'bungalow', 'semidetached_house', 'terrace'].includes(b)) return 5;
  if (['shed', 'hut', 'roof', 'construction', 'cabin', 'container', 'carport'].includes(b)) return 6;
  if (area < 50) return 6;
  if (area < 220) return 5;
  return area > 3000 ? 1 : 0;
}

export function buildingHeight(id, t, kind, area) {
  const r = rand01(id);
  const num = (v) => { const f = parseFloat(String(v).replace(',', '.')); return Number.isFinite(f) && f > 0 ? f : 0; };
  let h = num(t.height) || (num(t['building:levels']) ? num(t['building:levels']) * 3.2 + 1 : 0);
  if (!h) {
    // Pune inference: bungalows & low-rise lanes, mid-rise societies, a few towers
    const floors =
      kind === 6 ? 1 : kind === 4 ? 1 + Math.floor(r * 2) : kind === 5 ? 1 + Math.floor(r * 3) : kind === 2 ? 1 + Math.floor(r * 2)
        : kind === 8 ? 2 : kind === 3 ? 2 + Math.floor(r * 4) : kind === 7 ? 4 + Math.floor(r * 8)
          : area < 400 ? 3 + Math.floor(r * 3) : area < 1500 ? 4 + Math.floor(r * 6) : kind === 1 ? 4 + Math.floor(r * 8) : 7 + Math.floor(r * 10);
    h = floors * 3.2 + 1;
  }
  const minH = num(t.min_height) || (num(t['building:min_level']) ? num(t['building:min_level']) * 3.2 : 0);
  return { h: Math.min(h, 160), minH, levels: Math.max(1, Math.round(h / 3.2)) };
}

export const roofShape = (t) => ({ flat: 0, gabled: 1, hipped: 2, pyramidal: 3, dome: 4, skillion: 5 }[t['roof:shape']] ?? 0);
export const isBuilding = (t) => (t.building && t.building !== 'no' && t.building !== 'roof') || (t['building:part'] && t['building:part'] !== 'no');

// 0 residential, 1 commercial, 2 industrial, 3 park/grass, 4 forest/wood, 5 water (handled separately), 6 farmland,
// 7 institution, 8 parking, 9 construction/bare, 10 pitch, 11 sand/riverbank, 12 cemetery, 13 railway, 14 scrub
export function areaKind(t) {
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin' || t.water) return 5;
  if (t.natural === 'wood' || t.landuse === 'forest') return 4;
  if (t.natural === 'scrub' || t.natural === 'heath' || t.natural === 'wetland') return 14;
  if (t.natural === 'sand' || t.natural === 'beach' || t.natural === 'shingle') return 11;
  if (t.leisure === 'pitch' || t.leisure === 'stadium' || t.leisure === 'track' || t.leisure === 'golf_course') return 10;
  if (t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'playground' || t.leisure === 'nature_reserve' || t.landuse === 'grass' ||
    t.landuse === 'recreation_ground' || t.natural === 'grassland' || t.landuse === 'village_green' || t.landuse === 'meadow') return 3;
  if (t.landuse === 'cemetery' || t.amenity === 'grave_yard') return 12;
  if (t.landuse === 'farmland' || t.landuse === 'orchard' || t.landuse === 'plant_nursery') return 6;
  if (t.amenity === 'parking' || t.parking) return 8;
  if (t.landuse === 'railway') return 13;
  if (t.amenity || t.landuse === 'education' || t.landuse === 'institutional' || t.landuse === 'military' || t.landuse === 'religious') return 7;
  if (t.landuse === 'commercial' || t.landuse === 'retail') return 1;
  if (t.landuse === 'industrial') return 2;
  if (t.landuse === 'construction' || t.landuse === 'brownfield' || t.landuse === 'greenfield' || t.natural === 'bare_rock') return 9;
  if (t.landuse === 'residential') return 0;
  return -1;
}

export const RAIL_KINDS = ['rail', 'light_rail', 'subway', 'narrow_gauge'];
export const WATERWAY_WIDTH = (t) => (t.waterway === 'river' ? 0 /* river is a polygon */ : t.waterway === 'canal' ? 8 : t.waterway === 'stream' ? 4 : 2);
