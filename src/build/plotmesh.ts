// Site Studio's realistic model: the scheme as it would be built, styled like the city's own buildings.
//
// Flats get floor slabs, window bays with piers, balconies on the long faces and an open stilt on columns; low-rise
// ones read as houses (warm render, sunshades). Offices are curtain wall with mullions and a canopy at the street.
// Sheds are clad steel on a concrete dado with a clerestory, roller shutters and a pitched roof. On a slope each
// building stands on a plinth at its highest ground with the base walling down to the lowest; the paving, drive,
// lawn, bays and compound wall follow the ground; trees line the margins and fill the open space.
//
// Pure geometry: a solved site and a ground height in, vertex-coloured builders (solid and glass) and trees out.
import earcut from 'earcut';
import { GeomBuilder, rgbHex } from './geom';
import { PALETTES } from './buildings';
import { buildingQuads, driveQuads, type BuildingReport, type SiteReport } from '../doc/site';
import type { PlotReport, PlotUse } from '../doc/plot';

type RGB = [number, number, number];
export interface PlotTree { x: number; z: number; y: number; s: number; h: number; rot: number; tint: number }
export interface PlotModel { solid: GeomBuilder; glass: GeomBuilder; trees: PlotTree[] }

const C = {
  plinth: rgbHex(0xb8b1a4), paving: rgbHex(0xd9d3c7), asphalt: rgbHex(0x50555d), paint: rgbHex(0xf2f0ea),
  lawn: rgbHex(0x7ea85c), bay: rgbHex(0x676c74), wall: rgbHex(0xe8e2d6), coping: rgbHex(0xc7bfb0), post: rgbHex(0x7b8089),
  slab: rgbHex(0xf4f1ea), roof: rgbHex(0xc9c4ba), tank: rgbHex(0x2b2e33), solar: rgbHex(0x2c3a55), column: rgbHex(0xd6d0c4),
  ceiling: rgbHex(0xe9e5dc), glassFlat: rgbHex(0x56697a), glassOffice: rgbHex(0x5f7d93), spandrel: rgbHex(0x37414b),
  mullion: rgbHex(0x2a3038), dado: rgbHex(0xa9a59c), clad: rgbHex(0xd7dbde), rib: rgbHex(0xc3c8cc), shutter: rgbHex(0x6f757c),
  metalRoof: rgbHex(0x9eabb5), dock: rgbHex(0x9a958b), fire: rgbHex(0xe5484d),
};

function hash01(n: number) {
  let h = (n * 2654435761) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const hashStr = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

export function buildPlotModel(r: PlotReport, d: SiteReport, use: PlotUse, ground: (x: number, z: number) => number): PlotModel {
  const solid = new GeomBuilder(), glass = new GeomBuilder(), trees: PlotTree[] = [];
  const fh = r.rules.floorH;

  // ---------------- the ground ----------------
  const net = r.net.length >= 6 ? r.net : r.footprint;
  drapeFine(solid, net, (x, z) => ground(x, z) + 0.08, C.paving);
  const G = d.ground;
  if (G.rg) drapeFine(solid, G.rg, (x, z) => ground(x, z) + 0.3, C.lawn);
  for (const g of G.gardens) drapeFine(solid, g, (x, z) => ground(x, z) + 0.32, C.lawn);
  for (const q of driveQuads(G)) drapeFine(solid, q, (x, z) => ground(x, z) + 0.3, C.asphalt);
  // the drive's centre line, dashed
  for (const L of G.drive) for (let i = 0; i + 3 < L.length; i += 2) {
    const ax = L[i], az = L[i + 1], bx = L[i + 2], bz = L[i + 3], len = Math.hypot(bx - ax, bz - az);
    const tx = (bx - ax) / len, tz = (bz - az) / len;
    for (let s = 1.5; s + 3 < len; s += 7) drapeFine(solid, strip(ax + tx * s, az + tz * s, ax + tx * (s + 3), az + tz * (s + 3), 0.08), (x, z) => ground(x, z) + 0.42, C.paint);
  }
  // roundabouts: a planted island in the middle
  for (const [x, z, rad] of G.circles) if (rad > 5) drapeFine(solid, circleAt(x, z, rad - 6.5), (px, pz) => ground(px, pz) + 0.55, C.lawn, 2);
  const surf = d.parking.levels.filter((l) => l.kind === 'surface' || l.kind === 'lot').flatMap((l) => l.bays);
  // car parks: open decks on columns, a parapet round each, the stair core at a corner
  for (const e of d.site.elements ?? []) {
    if (e.kind !== 'parking') continue;
    const n = Math.max(1, e.levels ?? 3), lh = 3.0;
    for (const q of buildingQuads(e)) {
      let gMax = -Infinity;
      for (let i = 0; i < q.length; i += 2) gMax = Math.max(gMax, ground(q[i], q[i + 1]));
      const base = gMax + 0.2;
      for (const [a, c] of edges(q)) {
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]), k = Math.max(1, Math.round(len / 8));
        for (let s2 = 0; s2 <= k; s2++) { const p = lerp(a, c, s2 / k); solid.box(p[0], p[1], base, base + n * lh, 0.6, 0.6, Math.atan2(c[1] - a[1], c[0] - a[0]), C.column); }
      }
      for (let f = 0; f <= n; f++) {
        const y = base + f * lh;
        for (const [a, c] of edges(q)) { faceOut(solid, q, a, c, y - 0.3, y + (f ? 1.0 : 0), f ? C.slab : C.plinth, 0.05); faceIn(solid, q, a, c, y, y + (f ? 1.0 : 0.01), C.coping, 0.15); }
        cap(solid, q, y, true, f === n ? C.asphalt : C.bay);
        if (f) cap(solid, q, y - 0.3, false, C.ceiling);
      }
      const [a, b] = edges(q)[0];
      const p = lerp(a, b, 0.06), [nx, nz] = outward(q, a, b);
      solid.box(p[0] - nx * 3, p[1] - nz * 3, base, base + n * lh + 3, 5, 5, Math.atan2(b[1] - a[1], b[0] - a[0]), C.wall);
    }
  }
  for (const q of surf) {
    drapeFine(solid, q, (x, z) => ground(x, z) + 0.3, C.paint);
    drapeFine(solid, insetQuad(q, 0.1), (x, z) => ground(x, z) + 0.4, C.bay);
  }
  // the compound wall: following the ground in short lengths, with piers
  for (const w of G.wall) for (let i = 0; i + 3 < w.length; i += 2) {
    const ax = w[i], az = w[i + 1], bx = w[i + 2], bz = w[i + 3], len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const k = Math.max(1, Math.ceil(len / 3));
    for (let s = 0; s < k; s++) {
      const x0 = ax + ((bx - ax) * s) / k, z0 = az + ((bz - az) * s) / k, x1 = ax + ((bx - ax) * (s + 1)) / k, z1 = az + ((bz - az) * (s + 1)) / k;
      const g0 = ground(x0, z0), g1 = ground(x1, z1);
      wallSlab(solid, x0, z0, x1, z1, g0 - 0.4, g1 - 0.4, g0 + 1.8, g1 + 1.8, 0.2, C.wall, C.coping);
      solid.box(x0, z0, g0 - 0.4, g0 + 2.0, 0.36, 0.36, Math.atan2(z1 - z0, x1 - x0), C.coping);
    }
    solid.box(bx, bz, ground(bx, bz) - 0.4, ground(bx, bz) + 2.0, 0.36, 0.36, Math.atan2(bz - az, bx - ax), C.coping);
  }
  for (const g of G.gates) for (const [x, z] of [[g[0], g[1]], [g[2], g[3]]]) {
    const y = ground(x, z);
    solid.box(x, z, y - 0.4, y + 2.4, 0.6, 0.6, Math.atan2(g[3] - g[1], g[2] - g[0]), C.post);
  }
  // a blocked fire tender's way stays marked
  for (const b of d.buildings) if (!b.fireOk) for (const q of b.fire) drapeFine(solid, q, (x, z) => ground(x, z) + 0.45, C.fire);

  // ---------------- the buildings ----------------
  const podium = d.site.podium;
  let podBase = Infinity;
  for (const b of d.buildings) {
    const style = use === 'industrial' ? 'industrial' : use === 'commercial' ? 'glass' : b.height <= 12 ? 'house' : 'apartment';
    const pal = PALETTES[style === 'glass' ? 'apartment' : style];
    const tint = rgbHex(pal[Math.floor(hash01(hashStr(b.b.id) + 7) * pal.length)]);
    let gMin = Infinity, gMax = -Infinity;
    for (const q of b.quads) for (const [x, z] of samples(q)) { const g = ground(x, z); gMin = Math.min(gMin, g); gMax = Math.max(gMax, g); }
    const base = gMax + 0.45, top = base + b.height;
    podBase = Math.min(podBase, base);
    // the plinth: from the lowest ground (the base walls down a slope) to the floor, a little proud of the walls
    for (const q of b.quads) {
      const P = outset(q, 0.5);
      for (const [a, c] of edges(P)) faceOut(solid, P, a, c, gMin - 0.6, base, C.plinth);
      cap(solid, P, base, true, C.plinth);
    }
    const ext = exterior(b);
    if (use === 'industrial') { shed(solid, glass, b, ext, base, fh, tint); continue; }
    const stilt = d.site.stilt;
    const f0 = base + (stilt ? fh : 0) + podium * fh; // the first floor of flats / offices
    // the stilt: columns round the edge and through the middle, the cores, the soffit
    if (stilt) {
      for (const q of b.quads) {
        const P = insetQuad(q, 0.4);
        for (const [a, c] of edges(P)) {
          const len = Math.hypot(c[0] - a[0], c[1] - a[1]), k = Math.max(1, Math.round(len / 6));
          for (let s = 0; s < k; s++) solid.box(a[0] + ((c[0] - a[0]) * s) / k, a[1] + ((c[1] - a[1]) * s) / k, base, base + fh, 0.6, 0.6, Math.atan2(c[1] - a[1], c[0] - a[0]), C.column);
        }
        cap(solid, q, base + fh - 0.02, false, C.ceiling);
      }
    }
    // floors
    const nF = b.floors, house = style === 'house';
    for (const [a, c, P] of ext) {
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 0.3) continue;
      if (style === 'glass') { curtain(solid, glass, P, a, c, f0, nF, fh, !stilt && !podium); continue; }
      const bays = Math.max(1, Math.round(len / (house ? 3.6 : 3.2))), bw = len / bays;
      const balconies = !house && len > 14;
      for (let f = 0; f < nF; f++) {
        const y = f0 + f * fh;
        // the floor slab, proud of the face
        faceOut(solid, P, a, c, y - 0.05, y + 0.25, C.slab, 0.08);
        faceOut(solid, P, a, c, y + 0.25, y + 0.95, tint);
        faceOut(solid, P, a, c, y + fh - 0.5, y + fh - 0.05, tint);
        for (let k = 0; k < bays; k++) {
          const s0 = k * bw, s1 = s0 + bw, pier = house ? 0.9 : 0.55;
          const p0 = lerp(a, c, s0 / len), p1 = lerp(a, c, (s0 + pier / 2) / len), p2 = lerp(a, c, (s1 - pier / 2) / len), p3 = lerp(a, c, s1 / len);
          faceOut(solid, P, p0, p1, y + 0.95, y + fh - 0.5, tint);
          faceOut(solid, P, p2, p3, y + 0.95, y + fh - 0.5, tint);
          faceOut(glass, P, p1, p2, y + 0.95, y + fh - 0.5, C.glassFlat, -0.12);
          if (house) faceBox(solid, P, p1, p2, y + fh - 0.5, y + fh - 0.38, 0.6, C.slab); // the chhajja over the window
          if (balconies && k % 3 === 1) {
            // a balcony: slab, a solid front, its sides
            faceBox(solid, P, p0, p3, y - 0.05, y + 0.18, 1.4, C.slab);
            faceBox(solid, P, p0, p3, y + 0.18, y + 1.05, 1.4, tint, 1.28);
          }
        }
      }
      // the parapet
      faceOut(solid, P, a, c, f0 + nF * fh - 0.05, f0 + nF * fh + 1.0, tint);
    }
    const roofY = f0 + nF * fh;
    for (const q of b.quads) {
      cap(solid, q, roofY, true, C.roof);
      // parapet's inner face and coping
      for (const [a, c] of edges(q)) faceIn(solid, q, a, c, roofY, roofY + 1.0, C.coping, 0.2);
    }
    // stair and lift rooms over the cores, water tanks on them; solar on a flats roof
    for (const c of b.cores) {
      const P = outset(c, 0.2);
      for (const [a, e] of edges(P)) faceOut(solid, P, a, e, (stilt ? base : f0), roofY + 3.2, style === 'glass' ? C.spandrel : tint);
      cap(solid, P, roofY + 3.2, true, C.roof);
      const [cx, cz] = centroid(c);
      const yaw = Math.atan2(c[3] - c[1], c[2] - c[0]);
      solid.box(cx, cz, roofY + 3.2, roofY + 4.6, 2.4, 1.6, yaw, C.tank);
    }
    if (style === 'apartment' || style === 'house') {
      for (const q of b.quads) {
        const [cx, cz] = centroid(q), yaw = Math.atan2(q[3] - q[1], q[2] - q[0]);
        const L = Math.hypot(q[2] - q[0], q[3] - q[1]), D = Math.hypot(q[4] - q[2], q[5] - q[3]);
        const rows = Math.max(1, Math.floor((D - 4) / 3)), cols = Math.max(1, Math.floor((L - 8) / 2.2));
        if (D < 8 || L < 12) continue;
        const ux = Math.cos(yaw), uz = Math.sin(yaw), vx = -uz, vz = ux;
        for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
          // keep clear of the cores
          const ox = (j - (cols - 1) / 2) * 2.2, oz = (i - (rows - 1) / 2) * 3;
          const x = cx + ux * ox + vx * oz, z = cz + uz * ox + vz * oz;
          if (b.cores.some((c) => inPoly(x, z, outset(c, 1.2)))) continue;
          solid.box(x, z, roofY + 0.5, roofY + 0.6, 2.0, 1.1, yaw, C.solar);
        }
      }
    }
  }
  // podium levels: the envelope, louvred
  if (podium > 0 && d.envelope.length >= 6 && podBase < Infinity) {
    const P = d.envelope, y0 = podBase + (d.site.stilt ? fh : 0);
    for (const [a, c] of edges(P)) for (let k = 0; k < podium; k++) {
      faceOut(solid, P, a, c, y0 + k * fh, y0 + k * fh + 0.9, C.slab);
      faceOut(glass, P, a, c, y0 + k * fh + 0.9, y0 + (k + 1) * fh, C.spandrel, -0.2);
    }
    cap(solid, P, y0 + podium * fh, true, C.roof);
  }

  // ---------------- trees ----------------
  const keep: number[][] = [...d.buildings.flatMap((b) => b.quads.map((q) => outset(q, 2.5))), ...driveQuads(G).map((q) => outset(q, 1)), ...surf.map((q) => outset(q, 0.8)), ...d.buildings.flatMap((b) => b.fire), ...(d.site.elements ?? []).filter((e) => e.kind === 'parking').flatMap((e) => buildingQuads(e).map((q) => outset(q, 2)))];
  const near = (x: number, z: number) => G.gates.some((g) => Math.hypot(x - (g[0] + g[2]) / 2, z - (g[1] + g[3]) / 2) < 6);
  const free = (x: number, z: number) => inPoly(x, z, net) && !keep.some((q) => inPoly(x, z, q)) && !near(x, z) && trees.every((t) => Math.hypot(t.x - x, t.z - z) > 5);
  const [ncx, ncz] = centroid(net);
  let seed = hashStr(d.site.buildings.map((b) => b.id).join()) + 1;
  const rand = () => hash01(seed++);
  const put = (x: number, z: number, big = 1) => {
    const s = (3.4 + rand() * 2.4) * big;
    trees.push({ x, z, y: ground(x, z) - 0.2, s, h: s * (1.1 + rand() * 0.4), rot: rand() * 6.283, tint: rand() });
  };
  // along the wall, just inside
  for (const w of G.wall) for (let i = 0; i + 3 < w.length; i += 2) {
    const ax = w[i], az = w[i + 1], bx = w[i + 2], bz = w[i + 3], len = Math.hypot(bx - ax, bz - az);
    if (len < 3) continue;
    let nx = -(bz - az) / len, nz = (bx - ax) / len;
    if (nx * (ncx - ax) + nz * (ncz - az) < 0) { nx = -nx; nz = -nz; }
    for (let s = 3; s < len - 2; s += 7) {
      const x = ax + ((bx - ax) * s) / len + nx * 2.2, z = az + ((bz - az) * s) / len + nz * 2.2;
      if (free(x, z)) put(x, z);
    }
  }
  // the gardens and the roundabouts' islands, planted
  for (const g of G.gardens) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < g.length; i += 2) { x0 = Math.min(x0, g[i]); x1 = Math.max(x1, g[i]); z0 = Math.min(z0, g[i + 1]); z1 = Math.max(z1, g[i + 1]); }
    for (let x = x0 + 3; x < x1 - 1; x += 7) for (let z = z0 + 3; z < z1 - 1; z += 7) {
      const jx = x + (rand() - 0.5) * 3, jz = z + (rand() - 0.5) * 3;
      if (inPoly(jx, jz, g) && rand() < 0.55 && free(jx, jz)) put(jx, jz);
    }
  }
  for (const [x, z, rad] of G.circles) if (rad > 6) put(x, z, 1.2);
  // the open space, planted
  if (G.rg) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < G.rg.length; i += 2) { x0 = Math.min(x0, G.rg[i]); x1 = Math.max(x1, G.rg[i]); z0 = Math.min(z0, G.rg[i + 1]); z1 = Math.max(z1, G.rg[i + 1]); }
    for (let x = x0 + 4; x < x1 - 2; x += 9) for (let z = z0 + 4; z < z1 - 2; z += 9) {
      const jx = x + (rand() - 0.5) * 4, jz = z + (rand() - 0.5) * 4;
      if (inPoly(jx, jz, G.rg) && rand() < 0.6 && free(jx, jz)) put(jx, jz, 1.15);
    }
  }
  return { solid, glass, trees };
}

// ---------------- the special cases ----------------

/** Offices: curtain wall in floor-high panels, spandrels at the slabs, mullions the full height, a canopy at grade. */
function curtain(solid: GeomBuilder, glass: GeomBuilder, P: number[], a: number[], c: number[], f0: number, nF: number, fh: number, shop: boolean) {
  const len = Math.hypot(c[0] - a[0], c[1] - a[1]), top = f0 + nF * fh;
  faceOut(glass, P, a, c, f0, top + 1.5, C.glassOffice);
  for (let f = 0; f <= nF; f++) faceOut(solid, P, a, c, f0 + f * fh - 0.35, f0 + f * fh + 0.35, C.spandrel, 0.05);
  const k = Math.max(1, Math.round(len / 1.5));
  for (let s = 0; s <= k; s++) faceBox(solid, P, lerp(a, c, s / k - 0.04 / len), lerp(a, c, s / k + 0.04 / len), f0, top + 1.5, 0.18, C.mullion);
  if (shop) faceBox(solid, P, a, c, f0 + 4.0, f0 + 4.25, 2.4, C.mullion);
}

/** A shed: concrete dado, ribbed cladding, a clerestory under the eaves, roller shutters and docks, a pitched roof. */
function shed(solid: GeomBuilder, glass: GeomBuilder, b: BuildingReport, ext: [number[], number[], number[]][], base: number, fh: number, tint: RGB) {
  const eave = base + b.height;
  const clad = mix(C.clad, tint, 0.35);
  for (const [a, c, P] of ext) {
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < 0.3) continue;
    faceOut(solid, P, a, c, base, base + 1.4, C.dado);
    faceOut(solid, P, a, c, base + 1.4, eave, clad);
    // ribs
    for (let s = 1; s < len; s += 1.2) faceOut(solid, P, lerp(a, c, s / len), lerp(a, c, (s + 0.12) / len), base + 1.4, eave, C.rib, 0.04);
    for (let f = 0; f < b.floors; f++) faceOut(glass, P, a, c, base + (f + 1) * fh - 2.1, base + (f + 1) * fh - 1.1, C.glassFlat, 0.06);
    // the long sides: roller shutters with a dock and a canopy
    if (len > 20) {
      const n = Math.floor(len / 16);
      for (let k = 0; k < n; k++) {
        const m = (len * (k + 0.5)) / n, s0 = (m - 2.4) / len, s1 = (m + 2.4) / len;
        faceOut(solid, P, lerp(a, c, s0), lerp(a, c, s1), base + 0.05, base + 5.2, C.shutter, 0.07);
        faceBox(solid, P, lerp(a, c, s0 - 0.6 / len), lerp(a, c, s1 + 0.6 / len), base - 0.45, base, 3.5, C.dock);
        faceBox(solid, P, lerp(a, c, s0 - 0.8 / len), lerp(a, c, s1 + 0.8 / len), base + 5.6, base + 5.75, 2.2, C.mullion);
      }
    }
  }
  // pitched roofs, one per wing, the ridge along it, gables at the ends
  for (const q of b.quads) {
    const A = [q[0], q[1]], B = [q[2], q[3]], Cc = [q[4], q[5]], D = [q[6], q[7]];
    const width = Math.hypot(D[0] - A[0], D[1] - A[1]), rise = Math.min(4, width * 0.1), ridge = eave + rise;
    const mA = lerp(A, D, 0.5), mB = lerp(B, Cc, 0.5), o = 0.6;
    const ext2 = (p: number[], from: number[]) => { const dx = p[0] - from[0], dz = p[1] - from[1], L = Math.hypot(dx, dz) || 1; return [p[0] + (dx / L) * o, p[1] + (dz / L) * o]; };
    const eA = ext2(A, mA), eB = ext2(B, mB), eC = ext2(Cc, mB), eD = ext2(D, mA);
    slope(solid, eA, eB, mB, mA, eave - 0.06, ridge, C.metalRoof);
    slope(solid, eC, eD, mA, mB, eave - 0.06, ridge, C.metalRoof);
    // gables
    for (const [p, r2, m] of [[A, D, mA], [B, Cc, mB]] as const) tri(solid, p, r2, m, eave, ridge, clad);
  }
}

// ---------------- helpers ----------------

/** The building's outside faces: every quad edge but the joints shared with the next wing. */
function exterior(b: BuildingReport): [number[], number[], number[]][] {
  const out: [number[], number[], number[]][] = [];
  b.quads.forEach((q, i) => {
    for (const [a, c] of edges(q)) {
      const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
      const shared = b.quads.some((o, j) => j !== i && edges(o).some(([p, s]) => distSeg(mx, mz, p, s) < 0.05));
      if (!shared) out.push([a, c, q]);
    }
  });
  return out;
}

function edges(q: number[]): [number[], number[]][] {
  const n = q.length / 2, out: [number[], number[]][] = [];
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; out.push([[q[i * 2], q[i * 2 + 1]], [q[j * 2], q[j * 2 + 1]]]); }
  return out;
}
function centroid(q: number[]) { let x = 0, z = 0; const n = q.length / 2; for (let i = 0; i < q.length; i += 2) { x += q[i]; z += q[i + 1]; } return [x / n, z / n]; }
const lerp = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function distSeg(x: number, z: number, a: number[], b: number[]) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
}
function inPoly(x: number, z: number, r: number[]) {
  let c = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2], zi = r[i * 2 + 1], xj = r[j * 2], zj = r[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
/** the corners and edge midpoints (and centre) of a ring: where the ground is read under a building */
function samples(q: number[]) {
  const out: number[][] = [centroid(q)];
  for (const [a, c] of edges(q)) out.push(a, lerp(a, c, 0.5));
  return out;
}
/** a convex ring moved out (or in, negative) by k */
function outset(q: number[], k: number): number[] {
  const n = q.length / 2, out: number[] = [];
  const cw = signed(q) > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n, s = (i + 1) % n;
    const n1 = norm(q[p * 2], q[p * 2 + 1], q[i * 2], q[i * 2 + 1], cw), n2 = norm(q[i * 2], q[i * 2 + 1], q[s * 2], q[s * 2 + 1], cw);
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1];
    const dot = mx * n1[0] + mz * n1[1] || 1;
    mx /= dot; mz /= dot;
    out.push(q[i * 2] + mx * k, q[i * 2 + 1] + mz * k);
  }
  return out;
}
const insetQuad = (q: number[], k: number) => outset(q, -k);
function signed(q: number[]) { let a = 0; const n = q.length / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += q[i * 2] * q[j * 2 + 1] - q[j * 2] * q[i * 2 + 1]; } return a / 2; }
/** the unit normal of a→b pointing out of a ring of this winding */
function norm(ax: number, az: number, bx: number, bz: number, cw: number) {
  const L = Math.hypot(bx - ax, bz - az) || 1;
  return [((bz - az) / L) * -cw, ((bx - ax) / L) * cw];
}
function outward(P: number[], a: number[], c: number[]) {
  const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
  let nx = (c[1] - a[1]) / L, nz = -(c[0] - a[0]) / L;
  const [cx, cz] = centroid(P), mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
  if (nx * (mx - cx) + nz * (mz - cz) < 0) { nx = -nx; nz = -nz; }
  return [nx, nz];
}

/** A vertical face on a→c of ring P, facing out of it, `off` proud of the edge. */
function faceOut(gb: GeomBuilder, P: number[], a: number[], c: number[], y0: number, y1: number, rgb: RGB, off = 0) {
  const [nx, nz] = outward(P, a, c);
  quadV(gb, a[0] + nx * off, a[1] + nz * off, c[0] + nx * off, c[1] + nz * off, y0, y0, y1, y1, nx, nz, rgb);
}
/** The same face seen from inside (a parapet's back), `off` in from the edge, with its top. */
function faceIn(gb: GeomBuilder, P: number[], a: number[], c: number[], y0: number, y1: number, rgb: RGB, off: number) {
  const [nx, nz] = outward(P, a, c);
  quadV(gb, a[0] - nx * off, a[1] - nz * off, c[0] - nx * off, c[1] - nz * off, y0, y0, y1, y1, -nx, -nz, rgb);
  const i = gb.v(a[0], y1, a[1], 0, 1, 0, ...rgb);
  gb.v(c[0], y1, c[1], 0, 1, 0, ...rgb);
  gb.v(c[0] - nx * off, y1, c[1] - nz * off, 0, 1, 0, ...rgb);
  gb.v(a[0] - nx * off, y1, a[1] - nz * off, 0, 1, 0, ...rgb);
  upTris(gb, i, [a, c, [c[0] - nx * off, c[1] - nz * off], [a[0] - nx * off, a[1] - nz * off]]);
}
/** A box standing out `depth` from a→c (balconies, canopies, docks, mullions), starting `off` out. */
function faceBox(gb: GeomBuilder, P: number[], a: number[], c: number[], y0: number, y1: number, depth: number, rgb: RGB, off = 0) {
  const [nx, nz] = outward(P, a, c);
  const A = [a[0] + nx * off, a[1] + nz * off], Cc = [c[0] + nx * off, c[1] + nz * off];
  const k = (off + depth) / 2 - off, mx = (A[0] + Cc[0]) / 2 + nx * k, mz = (A[1] + Cc[1]) / 2 + nz * k;
  const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
  gb.box(mx, mz, y0, y1, len, depth - off, Math.atan2(c[1] - a[1], c[0] - a[0]), rgb);
}
function quadV(gb: GeomBuilder, ax: number, az: number, bx: number, bz: number, ya0: number, yb0: number, ya1: number, yb1: number, nx: number, nz: number, rgb: RGB) {
  const i = gb.v(ax, ya0, az, nx, 0, nz, ...rgb);
  gb.v(bx, yb0, bz, nx, 0, nz, ...rgb);
  gb.v(bx, yb1, bz, nx, 0, nz, ...rgb);
  gb.v(ax, ya1, az, nx, 0, nz, ...rgb);
  // facing the normal
  const left = (bz - az) * nx - (bx - ax) * nz > 0;
  if (left) { gb.tri(i, i + 2, i + 1); gb.tri(i, i + 3, i + 2); } else { gb.tri(i, i + 1, i + 2); gb.tri(i, i + 2, i + 3); }
}
/** two triangles of a quad (four points, in order) wound to face up */
function upTris(gb: GeomBuilder, i: number, p: number[][], down = false) {
  const cross = (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]) - (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]);
  if ((cross > 0) !== down) { gb.tri(i, i + 1, i + 2); gb.tri(i, i + 2, i + 3); } else { gb.tri(i, i + 2, i + 1); gb.tri(i, i + 3, i + 2); }
}
/** a flat cap over (or under) a convex ring */
function cap(gb: GeomBuilder, q: number[], y: number, up: boolean, rgb: RGB) {
  const n = q.length / 2, i0 = gb.vertexCount;
  for (let i = 0; i < n; i++) gb.v(q[i * 2], y, q[i * 2 + 1], 0, up ? 1 : -1, 0, ...rgb);
  const tris = earcut(q);
  for (let k = 0; k < tris.length; k += 3) {
    const a = tris[k], b = tris[k + 1], c = tris[k + 2];
    const cross = (q[b * 2 + 1] - q[a * 2 + 1]) * (q[c * 2] - q[a * 2]) - (q[b * 2] - q[a * 2]) * (q[c * 2 + 1] - q[a * 2 + 1]);
    if ((cross > 0) === up) gb.tri(i0 + a, i0 + b, i0 + c); else gb.tri(i0 + a, i0 + c, i0 + b);
  }
}
/** a wall of some thickness along a→b, following the ground (bottoms ya0/yb0, tops ya1/yb1), with its coping */
function wallSlab(gb: GeomBuilder, ax: number, az: number, bx: number, bz: number, ya0: number, yb0: number, ya1: number, yb1: number, t: number, rgb: RGB, top: RGB) {
  const L = Math.hypot(bx - ax, bz - az) || 1, nx = ((bz - az) / L) * (t / 2), nz = (-(bx - ax) / L) * (t / 2);
  quadV(gb, ax + nx, az + nz, bx + nx, bz + nz, ya0, yb0, ya1, yb1, nx / (t / 2), nz / (t / 2), rgb);
  quadV(gb, ax - nx, az - nz, bx - nx, bz - nz, ya0, yb0, ya1, yb1, -nx / (t / 2), -nz / (t / 2), rgb);
  const i = gb.v(ax + nx, ya1, az + nz, 0, 1, 0, ...top);
  gb.v(bx + nx, yb1, bz + nz, 0, 1, 0, ...top);
  gb.v(bx - nx, yb1, bz - nz, 0, 1, 0, ...top);
  gb.v(ax - nx, ya1, az - nz, 0, 1, 0, ...top);
  upTris(gb, i, [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]]);
}
/** a roof plane from the eave line (a, b) up to the ridge (c, d) */
function slope(gb: GeomBuilder, a: number[], b: number[], c: number[], d: number[], y0: number, y1: number, rgb: RGB) {
  const ux = b[0] - a[0], uz = b[1] - a[1], vx = d[0] - a[0], vy = y1 - y0, vz = d[1] - a[1];
  // normal = u × v, flipped to point up
  let nx = uz * vy, ny = ux * vz - uz * vx, nz = -ux * vy;
  if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
  const L = Math.hypot(nx, ny, nz) || 1;
  const i = gb.v(a[0], y0, a[1], nx / L, ny / L, nz / L, ...rgb);
  gb.v(b[0], y0, b[1], nx / L, ny / L, nz / L, ...rgb);
  gb.v(c[0], y1, c[1], nx / L, ny / L, nz / L, ...rgb);
  gb.v(d[0], y1, d[1], nx / L, ny / L, nz / L, ...rgb);
  // both sides (thin metal sheet)
  gb.tri(i, i + 1, i + 2); gb.tri(i, i + 2, i + 3); gb.tri(i, i + 2, i + 1); gb.tri(i, i + 3, i + 2);
}
/** a gable: the triangle between the eave corners and the ridge */
function tri(gb: GeomBuilder, a: number[], b: number[], m: number[], y0: number, y1: number, rgb: RGB) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = (b[1] - a[1]) / L, nz = -(b[0] - a[0]) / L;
  const i = gb.v(a[0], y0, a[1], nx, 0, nz, ...rgb);
  gb.v(b[0], y0, b[1], nx, 0, nz, ...rgb);
  gb.v(m[0], y1, m[1], nx, 0, nz, ...rgb);
  gb.tri(i, i + 1, i + 2); gb.tri(i, i + 2, i + 1);
}
const circleAt = (x: number, z: number, rad: number) => { const out: number[] = []; for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; out.push(x + Math.cos(a) * rad, z + Math.sin(a) * rad); } return out; };
/** a thin strip a→b, w wide */
function strip(ax: number, az: number, bx: number, bz: number, w: number) {
  const L = Math.hypot(bx - ax, bz - az) || 1, nx = (-(bz - az) / L) * (w / 2), nz = ((bx - ax) / L) * (w / 2);
  return [ax + nx, az + nz, bx + nx, bz + nz, bx - nx, bz - nz, ax - nx, az - nz];
}
/** A polygon laid on the ground: ear-clipped, then split until no edge is longer than `step`, so it follows the
 *  ground's every rise. */
function drapeFine(gb: GeomBuilder, ring: number[], h: (x: number, z: number) => number, rgb: RGB, step = 4) {
  if (ring.length < 6) return;
  const tris = earcut(ring);
  const emit = (p: number[][]) => {
    const i = gb.vertexCount;
    for (const [x, z] of p) gb.v(x, h(x, z), z, 0, 1, 0, ...rgb);
    const cross = (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]) - (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]);
    if (cross > 0) gb.tri(i, i + 1, i + 2); else gb.tri(i, i + 2, i + 1);
  };
  const split = (a: number[], b: number[], c: number[], depth: number) => {
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    if (depth > 8 || Math.max(ab, bc, ca) <= step) { emit([a, b, c]); return; }
    const m1 = lerp(a, b, 0.5), m2 = lerp(b, c, 0.5), m3 = lerp(c, a, 0.5);
    split(a, m1, m3, depth + 1); split(m1, b, m2, depth + 1); split(m3, m2, c, depth + 1); split(m1, m2, m3, depth + 1);
  };
  for (let k = 0; k < tris.length; k += 3) split([ring[tris[k] * 2], ring[tris[k] * 2 + 1]], [ring[tris[k + 1] * 2], ring[tris[k + 1] * 2 + 1]], [ring[tris[k + 2] * 2], ring[tris[k + 2] * 2 + 1]], 0);
}
