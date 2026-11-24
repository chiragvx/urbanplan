// The landscape's surfaces, each a recipe: the tile it repeats over (metres, as laid), how rough and how bumpy it is,
// and how to paint it into a Field (./noise.ts): its colour as it really is, its height (for the normal map) and its
// roughness. Roads, parking, paving, kerbs, lawn, beds and the plot's bare ground, as Indian sites have them: bitumen
// with its aggregate showing, sawcut concrete, cement paver blocks, Kota stone, murum, black cotton, basalt.
//
// Modular by design: a surface is one entry in SURFACES. Add one there and every user of the module can name it
// (./material.ts makes it a material; the scene asks for surfaces by id). Recipes that differ only in colour share a
// maker (soil, cracked, rock) and take a palette. Pure: no DOM.
import { clamp01, fbm, Field, mix, rgb, rng, scale, seedOf, valueNoise, voronoi, type RGB } from './noise';

export interface Surface {
  label: string;
  /** the tile, metres along u and v (the geometry's uv are metres) */
  size: number;
  /** how strongly the height reads in the normal map */
  bump: number;
  paint(F: Field, R: () => number): void;
}

const pick = <T>(a: T[], R: () => number) => a[Math.floor(R() * a.length) % a.length];

// ---------------------------------------------------------------- makers

/** bitumen: a dark binder with its stone aggregate speckled through, worn lighter in the wheel paths, patched */
function asphalt(base: string, stone: string): Surface['paint'] {
  return (F, R) => {
    const b = rgb(base), lite = rgb(stone), dark = scale(b, 0.62), wear = fbm(3, 3, 11), mot = fbm(12, 3, 12), grit = valueNoise(F.n >> 1, 13);
    F.each((u, v, i) => {
      const w = wear(u, v), m = mot(u, v), g = grit(u, v), r = R();
      let c = scale(b, 0.88 + 0.22 * m);
      c = mix(c, scale(lite, 0.8), clamp01((w - 0.55) * 1.2) * 0.35); // (worn: the aggregate shows)
      if (r < 0.09) c = mix(c, lite, 0.35 + 0.5 * R()); else if (r < 0.16) c = mix(c, dark, 0.7);
      F.set(i, c);
      F.h[i] = 0.45 + 0.3 * g + (r < 0.09 ? 0.2 : 0) - (r >= 0.09 && r < 0.16 ? 0.15 : 0);
      F.r[i] = 0.95 - 0.12 * clamp01(0.4 - m); // (binder-rich patches a little smoother)
    });
  };
}

/** cast concrete, sawcut into bays at the tile's edges: mottled, pored, a light broom finish */
function concrete(base: string, joint: number, broom = true): Surface['paint'] {
  return (F, R) => {
    const b = rgb(base), mot = fbm(3, 4, 21), fine = valueNoise(F.n >> 2, 22), n = F.n;
    F.each((u, v, i) => {
      const m = mot(u, v), f = fine(u, v), r = R();
      let c = scale(b, 0.9 + 0.16 * m + 0.05 * (f - 0.5));
      let h = 0.6 + 0.08 * f + (broom ? 0.06 * Math.sin(v * n * 0.9 + 3 * mot(u * 0.5, v)) : 0);
      if (r < 0.012) { c = scale(c, 0.7); h -= 0.25; } // (pores)
      const e = Math.min(u, 1 - u, v, 1 - v);
      if (joint > 0 && e < joint) { c = scale(c, 0.55); h = 0.1; }
      F.set(i, c); F.h[i] = h; F.r[i] = 0.88 - 0.06 * m;
    });
  };
}

/** units laid in running bond (pavers, tiles, slabs): w × d each (tile units), a joint, a bevel; each unit its own
 *  shade from the palette and a grain across it */
function units(w: number, d: number, jointW: number, palette: string[], jointCol: string, grain: number, bevel: number, rough: number): Surface['paint'] {
  return (F, R) => {
    const P = palette.map(rgb), J = rgb(jointCol), gr = fbm(8, 3, 31), rows = Math.round(1 / d), cols = Math.round(1 / w);
    const shade = Array.from({ length: rows * (cols + 1) }, () => ({ c: pick(P, R), k: 0.9 + 0.18 * R() }));
    F.each((u, v, i) => {
      const row = Math.min(rows - 1, Math.floor(v * rows)), off = row % 2 ? w / 2 : 0, uu = (u + off) % 1, col = Math.floor(uu * cols);
      const eu = Math.min(uu * cols - col, col + 1 - uu * cols) * w, ev = Math.min(v * rows - row, row + 1 - v * rows) * d, e = Math.min(eu, ev);
      const s = shade[row * (cols + 1) + col];
      if (e < jointW) { F.set(i, scale(J, 0.85 + 0.2 * R())); F.h[i] = 0.05; F.r[i] = 0.98; return; }
      const g = gr(u, v);
      F.set(i, scale(s.c, s.k * (1 - grain / 2 + grain * g)));
      F.h[i] = 0.55 + 0.4 * Math.min(1, (e - jointW) / bevel) + 0.05 * g;
      F.r[i] = rough;
    });
  };
}

/** bare earth: a palette mottled at two scales, clods (Voronoi cells, domed), stones, a few dry stalks */
function soil(p: { base: string; damp: string; dry: string; stone: string; clods: number; stones: number; stalks: number; stalk?: string }): Surface['paint'] {
  return (F, R) => {
    const B = rgb(p.base), D = rgb(p.damp), Y = rgb(p.dry), S = rgb(p.stone), big = fbm(2, 4, 41), mid = fbm(8, 3, 42), cl = voronoi(p.clods, 43), fine = valueNoise(F.n >> 1, 44);
    F.each((u, v, i) => {
      const a = big(u, v), m = mid(u, v), c = cl(u, v), f = fine(u, v);
      let col = a < 0.45 ? mix(D, B, clamp01(a / 0.45)) : mix(B, Y, clamp01((a - 0.45) / 0.55));
      col = scale(col, 0.88 + 0.2 * m + 0.08 * (f - 0.5));
      const dome = clamp01(c.edge * 18);
      F.set(i, scale(col, 0.85 + 0.15 * dome));
      F.h[i] = 0.3 + 0.45 * dome + 0.15 * f + 0.1 * m;
      F.r[i] = 0.96;
    });
    for (let k = 0; k < p.stones; k++) {
      const u = R(), v = R(), r = 0.002 + R() * 0.006, c = scale(S, 0.8 + 0.4 * R());
      F.stamp(u, v, r, (i, d) => { F.set(i, scale(c, 1 - 0.3 * d)); F.h[i] = Math.max(F.h[i], 0.75 + 0.25 * Math.sqrt(1 - d * d)); F.r[i] = 0.8; }, 0.6 + R() * 0.6, R() * Math.PI);
    }
    const st = rgb(p.stalk ?? '#b9a873');
    for (let k = 0; k < p.stalks; k++) strand(F, R() , R(), R() * Math.PI * 2, 0.006 + R() * 0.012, scale(st, 0.8 + 0.3 * R()), scale(st, 1.1), 0.7);
  };
}

/** a strand (a grass blade, a stalk) from (u, v) along angle a for len (tile units): dark at the root, light at the tip */
function strand(F: Field, u: number, v: number, a: number, len: number, root: RGB, tip: RGB, h0: number) {
  const steps = Math.max(2, Math.round(len * F.n)), du = Math.cos(a) / F.n, dv = Math.sin(a) / F.n;
  for (let k = 0; k <= steps; k++) { const t = k / steps, i = F.at(u + du * k, v + dv * k); F.set(i, mix(root, tip, t)); F.h[i] = Math.max(F.h[i], h0 + (1 - h0) * t); F.r[i] = 0.9; }
}

/** grass: a ground of thatch and soil under thousands of blades, the blades' greens varying in drifts, dry patches */
function grass(p: { greens: string[]; dry: string; soil: string; density: number; dryness: number }): Surface['paint'] {
  return (F, R) => {
    const G = p.greens.map(rgb), Y = rgb(p.dry), S = rgb(p.soil), drift = fbm(3, 3, 51), dry = fbm(2, 3, 52);
    F.each((u, v, i) => { const d = drift(u, v); F.set(i, mix(scale(S, 0.8), scale(G[0], 0.55), d)); F.h[i] = 0.15 + 0.1 * d; F.r[i] = 0.95; });
    const blades = Math.round(F.n * F.n * p.density);
    for (let k = 0; k < blades; k++) {
      const u = R(), v = R(), d = drift(u, v), y = clamp01((dry(u, v) - (1 - p.dryness)) * 3);
      const g = mix(G[Math.min(G.length - 1, Math.floor(d * G.length))], Y, y * (0.6 + 0.4 * R()));
      const len = 0.007 + R() * 0.012; // (blades 10 to 30 mm on a 1.5 m tile)
      strand(F, u, v, R() * Math.PI * 2, len, scale(g, 0.55), scale(g, 1.08 + 0.15 * R()), 0.3);
    }
  };
}

/** a dried clay: plates parted by cracks; damp clays nearly closed */
function cracked(base: string, crack: string, plates: number, open: number): Surface['paint'] {
  return (F, R) => {
    const B = rgb(base), C = rgb(crack), vo = voronoi(plates, 61), mot = fbm(4, 3, 62), fine = valueNoise(F.n >> 1, 63);
    const tone = Array.from({ length: plates + 64 }, () => 0.9 + 0.18 * R());
    F.each((u, v, i) => {
      const c = vo(u, v), m = mot(u, v), f = fine(u, v);
      if (c.edge < open) { F.set(i, scale(C, 0.8 + 0.3 * f)); F.h[i] = 0.05 + 0.2 * (c.edge / open); F.r[i] = 1; return; }
      const curl = clamp01((c.edge - open) * 30);
      F.set(i, scale(B, tone[c.id] * (0.88 + 0.2 * m + 0.06 * (f - 0.5)) * (0.9 + 0.1 * curl)));
      F.h[i] = 0.55 + 0.3 * curl + 0.1 * f; F.r[i] = 0.92;
    });
  };
}

/** loose stones packed together (gravel, the stones in murum): domed, each its own shade, over a finer ground */
function stones(p: { ground: string; palette: string[]; count: number; r0: number; r1: number }): Surface['paint'] {
  return (F, R) => {
    const G = rgb(p.ground), P = p.palette.map(rgb), fine = valueNoise(F.n >> 1, 71);
    F.each((u, v, i) => { const f = fine(u, v); F.set(i, scale(G, 0.75 + 0.3 * f)); F.h[i] = 0.2 + 0.15 * f; F.r[i] = 0.95; });
    for (let k = 0; k < p.count; k++) {
      const u = R(), v = R(), r = p.r0 + R() * (p.r1 - p.r0), c = scale(pick(P, R), 0.85 + 0.3 * R()), top = 0.7 + 0.3 * R();
      F.stamp(u, v, r, (i, d) => { const z = Math.sqrt(1 - d * d), h = 0.3 + (top - 0.3) * z; if (h < F.h[i]) return; F.h[i] = h; F.set(i, scale(c, 0.7 + 0.35 * z)); F.r[i] = 0.75; }, 0.6 + R() * 0.5, R() * Math.PI);
    }
  };
}

/** rock: broad swells, joints, lichen */
function rock(base: string, lichen: string, joints: number): Surface['paint'] {
  return (F, R) => {
    const B = rgb(base), L = rgb(lichen), sw = fbm(2, 5, 81), lc = fbm(6, 3, 82), vo = voronoi(joints, 83, 0.9);
    F.each((u, v, i) => {
      const s = sw(u, v), l = lc(u, v), c = vo(u, v);
      let col = scale(B, 0.75 + 0.45 * s);
      if (l > 0.68) col = mix(col, L, clamp01((l - 0.68) * 5) * 0.7);
      const j = c.edge < 0.004;
      F.set(i, j ? scale(col, 0.45) : col); F.h[i] = j ? 0.05 : 0.25 + 0.7 * s; F.r[i] = 0.85;
    });
  };
}

/** bark mulch in a bed: chips of brown at every angle, a few leaves */
function mulch(F: Field, R: () => number) {
  const P = ['#4a3324', '#5d4130', '#6e4f37', '#3a281c', '#7d5c3f'].map(rgb), fine = valueNoise(F.n >> 2, 91);
  F.each((u, v, i) => { F.set(i, scale(P[3], 0.7 + 0.3 * fine(u, v))); F.h[i] = 0.2; F.r[i] = 0.95; });
  for (let k = 0; k < F.n * F.n / 60; k++) {
    const c = scale(pick(P, R), 0.85 + 0.3 * R()), top = 0.5 + 0.5 * R();
    F.stamp(R(), R(), 0.004 + R() * 0.008, (i, d) => { if (top < F.h[i]) return; F.h[i] = top - 0.1 * d; F.set(i, scale(c, 1 - 0.25 * d)); F.r[i] = 0.9; }, 2 + R() * 2, R() * Math.PI);
  }
}

/** concrete grass pavers: a grid of webs, each opening grassed */
function grassPavers(F: Field, R: () => number) {
  // (200 mm cells, a square opening 120 mm across in each)
  const C = rgb('#a7a399'), G = ['#5f7d3a', '#6f8c43', '#7f9a50'].map(rgb), mot = fbm(4, 3, 95), cells = 6;
  F.each((u, v, i) => {
    const fu = (u * cells) % 1, fv = (v * cells) % 1, web = Math.abs(fu - 0.5) > 0.3 || Math.abs(fv - 0.5) > 0.3;
    if (web) { F.set(i, scale(C, 0.85 + 0.2 * mot(u, v))); F.h[i] = 0.85; F.r[i] = 0.9; }
    else { F.set(i, scale(pick(G, R), 0.6 + 0.5 * R())); F.h[i] = 0.3 + 0.3 * R(); F.r[i] = 0.95; }
  });
}

/** sand: wind ripples and grains */
function sand(base: string): Surface['paint'] {
  return (F, R) => {
    const B = rgb(base), mot = fbm(3, 3, 101), wob = fbm(2, 2, 102);
    F.each((u, v, i) => {
      const rip = 0.5 + 0.5 * Math.sin((u * 28 + wob(u, v) * 4) * Math.PI * 2), m = mot(u, v), r = R();
      F.set(i, scale(B, 0.88 + 0.12 * m + 0.05 * rip + (r < 0.05 ? -0.15 : r > 0.97 ? 0.1 : 0)));
      F.h[i] = 0.4 + 0.25 * rip + 0.1 * r; F.r[i] = 0.97;
    });
  };
}

/** still water: a deep colour lightening toward the shallows, its surface a few wind ripples (whole waves across the
 *  tile, so it wraps), mirror-smooth */
function water(deep: string, shallow: string): Surface['paint'] {
  return (F) => {
    const D = rgb(deep), S = rgb(shallow), depth = fbm(2, 3, 111), n = fbm(6, 3, 112), T = Math.PI * 2;
    F.each((u, v, i) => {
      const w = 0.5 + 0.18 * Math.sin(T * (3 * u + 2 * v) + 4 * n(u, v)) + 0.12 * Math.sin(T * (-5 * u + 7 * v)) + 0.08 * Math.sin(T * (11 * u + 4 * v) + 2 * n(v, u));
      F.set(i, mix(D, S, clamp01(depth(u, v) * 0.8))); F.h[i] = w; F.r[i] = 0.05;
    });
  };
}

/** a poured rubber play surface: coloured EPDM granules, a few colours speckled through the main one */
function rubber(main: string, flecks: string[]): Surface['paint'] {
  return (F, R) => {
    const M = rgb(main), P = flecks.map(rgb), g = valueNoise(F.n >> 1, 121);
    F.each((u, v, i) => { const r = R(); F.set(i, r < 0.12 ? pick(P, R) : scale(M, 0.88 + 0.2 * g(u, v))); F.h[i] = 0.4 + 0.4 * R(); F.r[i] = 0.92; });
  };
}

/** a timber deck: 140 mm boards with 6 mm gaps, the grain along them, each board its own tone, a screw pair at each joist */
function deck(base: string): Surface['paint'] {
  return (F, R) => {
    const B = rgb(base), boards = 8, tone = Array.from({ length: boards }, () => 0.85 + 0.25 * R()), grain = valueNoise(64, 131), T = Math.PI * 2;
    F.each((u, v, i) => {
      const b = Math.floor(v * boards), fv = v * boards - b, gap = fv < 0.04;
      // (whole waves along the tile and a wrapping noise, so it repeats without a seam)
      const gr = grain(u, v) * 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(T * (18 * u + 0.6 * grain(v, u)) + b * 1.7));
      const screw = (Math.abs(((u * 2) % 1) - 0.5) < 0.006) && (Math.abs(fv - 0.25) < 0.04 || Math.abs(fv - 0.8) < 0.04);
      F.set(i, gap ? scale(B, 0.25) : scale(B, tone[b] * (0.85 + 0.25 * gr) * (screw ? 0.5 : 1)));
      F.h[i] = gap ? 0.05 : 0.7 + 0.1 * gr; F.r[i] = gap ? 1 : 0.7;
    });
  };
}

// ---------------------------------------------------------------- the surfaces

export const SURFACES = {
  asphalt: { label: 'Asphalt', size: 2, bump: 3, paint: asphalt('#4b4d52', '#9a958c') },
  'asphalt-worn': { label: 'Asphalt, worn', size: 2, bump: 3, paint: asphalt('#5c5d60', '#a8a399') },
  concrete: { label: 'Concrete, sawcut bays', size: 3, bump: 1.5, paint: concrete('#b4b0a7', 0.002) },
  kerb: { label: 'Kerb stone', size: 1, bump: 1.2, paint: concrete('#c9c6bf', 0, false) },
  pavers: { label: 'Paver blocks, grey', size: 1.2, bump: 4, paint: units(0.2 / 1.2, 0.1 / 1.2, 0.0035 / 1.2, ['#8f8c87', '#9a968f', '#7f7c78', '#a6a29a'], '#b9ab8c', 0.2, 0.008 / 1.2, 0.9) },
  'pavers-red': { label: 'Paver blocks, red and grey', size: 1.2, bump: 4, paint: units(0.2 / 1.2, 0.1 / 1.2, 0.0035 / 1.2, ['#9a5b48', '#8d5242', '#a8705c', '#8f8c87'], '#b9ab8c', 0.2, 0.008 / 1.2, 0.9) },
  'kota-stone': { label: 'Kota stone, 600 square', size: 1.2, bump: 2, paint: units(0.5, 0.5, 0.004 / 1.2, ['#7e8f86', '#8a9a8d', '#6f8279', '#93a092'], '#6d6a62', 0.35, 0.002, 0.55) },
  'tiles-path': { label: 'Path tiles, 300 square', size: 1.2, bump: 3, paint: units(0.25, 0.25, 0.004 / 1.2, ['#c8c1b3', '#bdb5a6', '#cfc8ba'], '#8f877a', 0.15, 0.004, 0.85) },
  'grass-pavers': { label: 'Grass pavers', size: 1.2, bump: 4, paint: grassPavers },
  lawn: { label: 'Lawn', size: 1.5, bump: 2.5, paint: grass({ greens: ['#4f6e2e', '#5e7d35', '#6c8a3c', '#7c9744'], dry: '#a59a5c', soil: '#5a4630', density: 0.35, dryness: 0.25 }) },
  meadow: { label: 'Wild grass', size: 2, bump: 3, paint: grass({ greens: ['#5d6f35', '#6d7d3c', '#7f8b48'], dry: '#b3a066', soil: '#6b553a', density: 0.25, dryness: 0.55 }) },
  mulch: { label: 'Bark mulch', size: 1, bump: 4, paint: mulch },
  earth: { label: 'Earth', size: 3, bump: 3, paint: soil({ base: '#8a6c4e', damp: '#6a5039', dry: '#a88c68', stone: '#9b948a', clods: 400, stones: 220, stalks: 60 }) },
  field: { label: 'Open ground, dry scrub', size: 14, bump: 2, paint: soil({ base: '#a38e6b', damp: '#97815f', dry: '#b3a07a', stone: '#aaa294', clods: 2500, stones: 1500, stalks: 5000, stalk: '#a99c6c' }) },
  fill: { label: 'Fill, mixed', size: 3, bump: 3.5, paint: soil({ base: '#8f8676', damp: '#746b5d', dry: '#a59d8d', stone: '#b5aea2', clods: 300, stones: 900, stalks: 10 }) },
  silt: { label: 'Silt', size: 3, bump: 1.5, paint: soil({ base: '#9b8d78', damp: '#7f725f', dry: '#b0a48f', stone: '#a49c90', clods: 700, stones: 40, stalks: 20 }) },
  'black-cotton': { label: 'Black cotton soil', size: 3, bump: 4, paint: cracked('#45403a', '#1f1c19', 70, 0.0035) },
  clay: { label: 'Stiff clay', size: 3, bump: 2.5, paint: cracked('#86674a', '#4f3c2c', 40, 0.0015) },
  'clay-wet': { label: 'Soft clay, damp', size: 3, bump: 1.2, paint: cracked('#6f7a78', '#4d5554', 30, 0.0006) },
  sand: { label: 'Sand', size: 2, bump: 2, paint: sand('#d4bf94') },
  gravel: { label: 'Gravel', size: 1, bump: 4, paint: stones({ ground: '#6f6b64', palette: ['#8e8a83', '#a6a197', '#76726b', '#b5ad9e', '#6a6660'], count: 1800, r0: 0.008, r1: 0.02 }) },
  murum: { label: 'Murum', size: 2, bump: 3.5, paint: stones({ ground: '#97603f', palette: ['#a86a45', '#8a5136', '#b47b52', '#6e3f2a', '#9a8b7a'], count: 1400, r0: 0.003, r1: 0.012 }) },
  water: { label: 'Water', size: 8, bump: 0.6, paint: water('#1f4a52', '#3f7d80') },
  'pool-water': { label: 'Pool water', size: 6, bump: 0.5, paint: water('#2a8fa8', '#58bcc9') },
  rubber: { label: 'Rubber play surface', size: 1, bump: 1.5, paint: rubber('#2f6e8f', ['#d9c04a', '#c64a3b', '#e9e5da', '#4b8f4a']) },
  'rubber-red': { label: 'Rubber play surface, red', size: 1, bump: 1.5, paint: rubber('#a6453a', ['#d9c04a', '#2f6e8f', '#e9e5da']) },
  deck: { label: 'Timber deck', size: 1.12, bump: 3, paint: deck('#8a5b3a') },
  granite: { label: 'Flamed granite, 600 × 300', size: 1.2, bump: 2, paint: units(0.5, 0.25, 0.003 / 1.2, ['#7d7a78', '#868381', '#76736f', '#8c8986'], '#55524e', 0.45, 0.002, 0.8) },
  cobbles: { label: 'Cobbles, 100 square', size: 1, bump: 5, paint: units(0.1, 0.1, 0.006, ['#6f6c68', '#7c7873', '#66625d', '#857f76', '#5d5a55'], '#7a7060', 0.3, 0.02, 0.85) },
  rock: { label: 'Basalt', size: 4, bump: 4, paint: rock('#4b4c50', '#9d9a7c', 30) },
  'rock-weathered': { label: 'Weathered rock', size: 4, bump: 4, paint: rock('#7c6650', '#b0a27a', 40) },
} satisfies Record<string, Surface>;

export type SurfaceId = keyof typeof SURFACES;
export const SURFACE_IDS = Object.keys(SURFACES) as SurfaceId[];

/** paint a surface at n × n: the Field, filled (deterministic: the same id and n, the same pixels) */
export function paintSurface(id: SurfaceId, n: number): Field {
  const s: Surface = SURFACES[id], F = new Field(n, 0.9);
  s.paint(F, rng(seedOf(id)));
  return F;
}

/** the surface for what the plot's ground is covered with (src/pro/ground.ts COVERS) */
export function surfaceOfCover(cover: string): SurfaceId {
  const M: Record<string, SurfaceId> = {
    fill: 'fill', 'black-cotton': 'black-cotton', 'soft-clay': 'clay-wet', 'stiff-clay': 'clay', silt: 'silt', 'loose-sand': 'sand', 'dense-sand': 'sand',
    gravel: 'gravel', murum: 'murum', 'soft-rock': 'rock-weathered', 'hard-rock': 'rock', grass: 'meadow', scrub: 'field', paved: 'concrete',
  };
  return M[cover] ?? 'earth';
}

/** the surface for a site kit's internal road (src/pro/design.ts SiteKit road.surface) */
export function surfaceOfRoad(s: string): SurfaceId {
  return s === 'pavers' ? 'pavers' : s === 'concrete' ? 'concrete' : s === 'grass-pavers' ? 'grass-pavers' : 'asphalt';
}
