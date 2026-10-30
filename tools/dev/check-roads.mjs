// Road accuracy check: how far the baked network's centre lines are from the raw OSM ways they came from.
// node tools/dev/check-roads.mjs [tile]  → stats + worst spots (JSON in tools/dev/check-roads.json)
import fs from 'node:fs';
import { parseOsmXml } from '../osmxml.mjs';
import { TILES } from '../tile-config.mjs';

const id = process.argv[2] ?? 'kp';
const tile = TILES[id];
const hdr = JSON.parse(fs.readFileSync(`public/tiles/${id}/tile.json`, 'utf8'));
const net = JSON.parse(fs.readFileSync(`public/tiles/${id}/network.json`, 'utf8'));
const osm = parseOsmXml(fs.readFileSync(`data/raw/${id}.osm`, 'utf8'));
const kx = hdr.proj.kx, kz = hdr.proj.kz;
const P = (n) => [(n.lon - tile.lon) * kx, -(n.lat - tile.lat) * kz];
const wayPts = new Map();
for (const w of osm.ways.values()) {
  if (!w.tags?.highway) continue;
  const pts = w.nds.map((i) => osm.nodes.get(i)).filter(Boolean).map(P);
  if (pts.length >= 2) wayPts.set(w.id, pts);
}
const bez = (c, t) => { const u = 1 - t; return [u * u * u * c[0] + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6], u * u * u * c[1] + 3 * u * u * t * c[3] + 3 * u * t * t * c[5] + t * t * t * c[7]]; };
const segDist = (q, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(a[0] + dx * t - q[0], a[1] + dz * t - q[1]); };
const polyDist = (q, pts) => { let d = Infinity; for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, segDist(q, pts[i], pts[i + 1])); return d; };

const byCls = {}, byKind = {};
const worst = [];
let total = 0;
for (const s of net.segments) {
  const ways = (s.wayIds ?? []).map((w) => wayPts.get(w)).filter(Boolean);
  if (!ways.length) continue;
  const L = Math.hypot(s.p[6] - s.p[0], s.p[7] - s.p[1]);
  const n = Math.max(2, Math.ceil(L / 5));
  // skip the ends: junctions are moved / merged on purpose (clusters, roundabouts)
  for (let i = 1; i < n; i++) {
    const q = bez(s.p, i / n);
    // a merged divided road: its centre line should sit midway between the two halves (error = how far off-centre);
    // a single way: plain distance
    // which side of OUR centre line (not the way's own direction: the halves of a divided road run opposite ways)
    const q2 = bez(s.p, Math.min(1, i / n + 0.01)), hx = q2[0] - q[0], hz = q2[1] - q[1];
    const side = (w) => {
      let best = Infinity, c = q;
      for (let k = 0; k + 1 < w.length; k++) { const a = w[k], b = w[k + 1], dx = b[0] - a[0], dz = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / (dx * dx + dz * dz || 1))); const p = [a[0] + dx * t, a[1] + dz * t]; const dd = Math.hypot(p[0] - q[0], p[1] - q[1]); if (dd < best) { best = dd; c = p; } }
      return { d: best, sg: Math.sign(hx * (c[1] - q[1]) - hz * (c[0] - q[0])) };
    };
    const S = ways.map(side).sort((a, b) => a.d - b.d);
    let d = S[0].d;
    const opp = S.find((x) => x.d < 25 && x !== S[0] && x.sg !== S[0].sg);
    const merged = !!opp;
    if (opp) { d = Math.abs(S[0].d - opp.d) / 2; (byKind['  divided: to nearer half'] ??= []).push(S[0].d); (byKind['  divided: gap between halves'] ??= []).push(S[0].d + opp.d); }
    (byKind[merged ? 'divided (off-centre)' : 'single way'] ??= []).push(d);
    (byCls[s.cls] ??= []).push(d);
    total++;
    if (d > 8) worst.push({ d: Math.round(d * 10) / 10, x: Math.round(q[0]), z: Math.round(q[1]), name: s.name ?? '', cls: s.cls, seg: s.id, merged: s.type?.includes('m') && ways.length > 1 });
  }
}
const pct = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * p))]; };
console.log(`${total} samples (every 5 m, junction ends excluded)`);
for (const [c, a] of Object.entries(byCls).sort((x, y) => y[1].length - x[1].length)) {
  console.log(`${c.padEnd(14)} n=${String(a.length).padStart(6)}  median ${pct(a, 0.5).toFixed(2)} m  p90 ${pct(a, 0.9).toFixed(2)} m  p99 ${pct(a, 0.99).toFixed(2)} m  >5 m ${(100 * a.filter((d) => d > 5).length / a.length).toFixed(1)} %`);
}
for (const [c, a] of Object.entries(byKind)) console.log(`${c.padEnd(22)} n=${String(a.length).padStart(6)}  median ${pct(a, 0.5).toFixed(2)} m  p90 ${pct(a, 0.9).toFixed(2)} m  p99 ${pct(a, 0.99).toFixed(2)} m  >5 m ${(100 * a.filter((d) => d > 5).length / a.length).toFixed(1)} %`);
// worst spots, one per 150 m cell
const seen = new Set();
const spots = worst.sort((a, b) => b.d - a.d).filter((w) => { const k = `${Math.round(w.x / 150)},${Math.round(w.z / 150)}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 25);
console.log('worst spots:'); for (const w of spots.slice(0, 15)) console.log(`  ${w.d} m  ${w.cls}  ${w.name}  @ ${w.x},${w.z}`);
fs.writeFileSync('tools/dev/check-roads.json', JSON.stringify({ spots }, null, 1));
