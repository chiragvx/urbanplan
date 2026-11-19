// Between the form core's flat rings and the ground's multipolygons (src/doc/ground.ts, Clipper on millimetres).
import { area, flat, type MP, type Pt } from '../../doc/ground';
import { ringArea } from './curve';

export type { MP };

/** a flat ring as a shape */
export function mpOf(r: number[]): MP {
  if (r.length < 6) return [];
  const ring: Pt[] = [];
  for (let i = 0; i < r.length; i += 2) ring.push([r[i], r[i + 1]]);
  return [[ring]];
}
/** several flat rings (outlines anticlockwise, holes clockwise, as `ringsOf` gives them) as a shape */
export function mpOfRings(rings: number[][]): MP {
  const out: MP = [];
  for (const r of rings) {
    if (r.length < 6) continue;
    const ring: Pt[] = [];
    for (let i = 0; i < r.length; i += 2) ring.push([r[i], r[i + 1]]);
    if (ringArea(r) >= 0 || !out.length) out.push([ring]);
    else {
      // a hole goes with the outline it sits in (the last one, as ringsOf orders them)
      out[out.length - 1].push(ring);
    }
  }
  return out;
}
/** a shape's rings, flat: each outline anticlockwise followed by its holes clockwise */
export function ringsOf(m: MP): number[][] {
  const out: number[][] = [];
  for (const p of m) p.forEach((r, i) => {
    const f = flat(r);
    if (f.length < 6) return;
    const a = ringArea(f);
    if ((i === 0) !== (a >= 0)) { const o: number[] = []; for (let k = f.length - 2; k >= 0; k -= 2) o.push(f[k], f[k + 1]); out.push(o); }
    else out.push(f);
  });
  return out;
}
/** a shape's biggest piece, alone */
export function largest(m: MP): MP {
  let best = -1, bi = -1;
  m.forEach((p, i) => { const a = area([p]); if (a > best) { best = a; bi = i; } });
  return bi < 0 ? [] : [m[bi]];
}
/** a shape's biggest piece's outline, flat */
export function outerOf(m: MP): number[] {
  const l = largest(m);
  return l.length ? flat(l[0][0]) : [];
}
