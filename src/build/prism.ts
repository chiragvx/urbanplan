// Rings pulled up between two heights as flat-shaded triangles (each face its own vertices), with a colour per
// vertex: the plot sandbox's buildings in 3D and in its exports.
import earcut from 'earcut';

export interface Box { ring: number[]; y0: number; y1: number; color: [number, number, number] }

/** A CSS colour as linear RGB (what vertex colours in three.js and glTF are). */
export const hex = (c: string): [number, number, number] => {
  const n = parseInt(c.slice(1), 16), lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)];
};

const cross = (R: number[], a: number, b: number, c: number) => (R[b * 2] - R[a * 2]) * (R[c * 2 + 1] - R[a * 2 + 1]) - (R[b * 2 + 1] - R[a * 2 + 1]) * (R[c * 2] - R[a * 2]);

/** Roofs and walls facing out (x, y up, z), with the floor faces too when `floors`. */
export function prismTris(boxes: Box[], floors: boolean): { pos: number[]; col: number[] } {
  const pos: number[] = [], col: number[] = [];
  const tri = (a: number[], b: number[], c: number[], k: [number, number, number]) => { pos.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) col.push(...k); };
  for (const { ring: R, y0, y1, color } of boxes) {
    if (R.length < 6) continue;
    const n = R.length / 2, cap = earcut(R);
    const P = (i: number, y: number) => [R[i * 2], y, R[i * 2 + 1]];
    for (let k = 0; k < cap.length; k += 3) {
      // up-facing: clockwise in x, z
      const [p, q, r] = cross(R, cap[k], cap[k + 1], cap[k + 2]) > 0 ? [cap[k], cap[k + 2], cap[k + 1]] : [cap[k], cap[k + 1], cap[k + 2]];
      tri(P(p, y1), P(q, y1), P(r, y1), color);
      if (floors) tri(P(p, y0), P(r, y0), P(q, y0), color);
    }
    // walls face out: which way round the ring goes
    let a = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += R[i * 2] * R[j * 2 + 1] - R[j * 2] * R[i * 2 + 1]; }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [s, t] = a > 0 ? [j, i] : [i, j];
      tri(P(s, y0), P(t, y0), P(t, y1), color);
      tri(P(s, y0), P(t, y1), P(s, y1), color);
    }
  }
  return { pos, col };
}
