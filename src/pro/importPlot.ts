// A plot from data instead of drawn: a GeoJSON or KML file (from a survey, Google Earth, a GIS, a cadastre such as
// Bhunaksha), or pasted coordinates, as latitude / longitude or as metres (UTM eastings / northings, or a local
// survey). Turned into the project's outline in metres around its middle, north up (plan z = −north), with the
// longest edge as the front road until another is picked. Owner names and the like in the file are never kept:
// only the outline is read.

export interface Imported { ring: number[]; source: string; area: number; latlon: [number, number] | null }

const M_PER_DEG_LAT = 110_574;
const mPerDegLon = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** Points (lon, lat or x, y) to a ring in metres around its middle, z = −north. */
function toRing(pts: [number, number][], geographic: boolean): { ring: number[]; latlon: [number, number] | null } {
  // (a closed ring repeats its first point: drop it)
  if (pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts = pts.slice(0, -1);
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const kx = geographic ? mPerDegLon(cy) : 1, ky = geographic ? M_PER_DEG_LAT : 1;
  const ring = pts.flatMap(([x, y]) => [Math.round((x - cx) * kx * 100) / 100, Math.round(-(y - cy) * ky * 100) / 100]);
  return { ring, latlon: geographic ? [cy, cx] : null };
}
const areaOf = (r: number[]) => { let a = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return Math.abs(a / 2); };

/** The biggest polygon's outer ring in a GeoJSON object. */
function fromGeoJson(g: unknown): [number, number][] | null {
  const rings: [number, number][][] = [];
  const walk = (o: any) => {
    if (!o || typeof o !== 'object') return;
    if (o.type === 'FeatureCollection') o.features?.forEach(walk);
    else if (o.type === 'Feature') walk(o.geometry);
    else if (o.type === 'GeometryCollection') o.geometries?.forEach(walk);
    else if (o.type === 'Polygon') rings.push(o.coordinates?.[0]);
    else if (o.type === 'MultiPolygon') o.coordinates?.forEach((p: any) => rings.push(p[0]));
  };
  walk(g);
  const ok = rings.filter((r) => Array.isArray(r) && r.length >= 3).map((r) => r.map((p) => [+p[0], +p[1]] as [number, number]));
  if (!ok.length) return null;
  const sz = (r: [number, number][]) => areaOf(r.flat());
  return ok.sort((a, b) => sz(b) - sz(a))[0];
}

/** KML: the first <coordinates> block of a polygon (lon,lat[,alt] tuples). */
function fromKml(text: string): [number, number][] | null {
  const m = text.match(/<Polygon[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i) ?? text.match(/<coordinates>([\s\S]*?)<\/coordinates>/i);
  if (!m) return null;
  const pts = m[1].trim().split(/\s+/).map((t) => t.split(',').map(Number)).filter((p) => p.length >= 2 && p.every(Number.isFinite)).map((p) => [p[0], p[1]] as [number, number]);
  return pts.length >= 3 ? pts : null;
}

/** Read a file's text or pasted text. Pasted lines are "a, b" pairs: lat / lon if they look like degrees (the first
 *  a latitude: India's run 6–37° N, 68–98° E), else metres x (east), y (north). */
export function importPlot(text: string, name = 'pasted'): Imported {
  const t = text.trim();
  let pts: [number, number][] | null = null, geo = true, source = name;
  if (t.startsWith('{')) { pts = fromGeoJson(JSON.parse(t)); source = `${name} (GeoJSON)`; }
  else if (/<kml|<coordinates>/i.test(t)) { pts = fromKml(t); source = `${name} (KML)`; }
  else {
    const rows = t.split(/\n|;/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[\s,\t]+/).map(Number)).filter((p) => p.length >= 2 && p.every(Number.isFinite));
    if (rows.length < 3) throw new Error('Give at least three corners, one "a, b" pair a line.');
    const deg = rows.every(([a, b]) => Math.abs(a) <= 90 && Math.abs(b) <= 180 && (Math.abs(a) > 1 || Math.abs(b) > 1) && !(Math.abs(a) > 60 && Math.abs(b) > 60 && rows.some(([x]) => x % 1 === 0 && Math.abs(x) > 90)));
    // degrees when every pair sits in a plausible lat/lon box and the spread is tiny (a plot spans thousandths of a degree)
    const spread = Math.max(...rows.map((r) => r[0])) - Math.min(...rows.map((r) => r[0]));
    geo = deg && spread < 0.1;
    pts = geo ? rows.map(([lat, lon]) => [lon, lat]) : rows.map(([x, y]) => [x, y]);
    source = geo ? 'pasted latitude / longitude' : 'pasted metres';
  }
  if (!pts || pts.length < 3) throw new Error('No polygon found in that.');
  const { ring, latlon } = toRing(pts, geo);
  const area = areaOf(ring);
  if (area < 20) throw new Error(`That outline is only ${area.toFixed(1)} m²: check the coordinates' order and units.`);
  if (area > 2_000_000) throw new Error('That outline is over 200 hectares: check the units (degrees vs metres).');
  return { ring, source, area, latlon };
}

/** The longest edge: the front road's first guess. */
export function longestEdge(ring: number[]): number {
  let best = 0, L = -1;
  for (let k = 0; k < ring.length / 2; k++) { const i = 2 * k, j = (i + 2) % ring.length, l = Math.hypot(ring[j] - ring[i], ring[j + 1] - ring[i + 1]); if (l > L) { L = l; best = k; } }
  return best;
}
