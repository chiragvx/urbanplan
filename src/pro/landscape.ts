// The planting a design system's landscape asks for, laid out on the plot: trees in a row along the road (an avenue),
// or along every edge (dense), and a hedge along the boundary except across the road side. The 3D draws it and the
// review counts it, so they agree. Trees keep clear of the buildings.
import type { PlotReport } from '../doc/plot';
import { pointIn, roadFrame } from '../doc/site';
import type { Landscape } from './design';

export interface Planting { trees: [number, number][]; hedges: [number, number, number, number][] }

export function plantingOf(r: PlotReport, land: Landscape, quads: number[][]): Planting {
  const out: Planting = { trees: [], hedges: [] };
  const ring = r.net;
  if (!ring || ring.length < 6) return out;
  const F = roadFrame(r);
  let sa = 0;
  for (let i = 0; i < ring.length; i += 2) { const j = (i + 2) % ring.length; sa += ring[i] * ring[j + 1] - ring[j] * ring[i + 1]; }
  const sg = sa > 0 ? 1 : -1;
  const clear = (x: number, z: number) => pointIn(ring, x, z, 0) && !quads.some((q) => pointIn(q, x, z, 3));
  for (let i = 0; i < ring.length; i += 2) {
    const j = (i + 2) % ring.length, L = Math.hypot(ring[j] - ring[i], ring[j + 1] - ring[i + 1]);
    if (L < 2) continue;
    const ux = (ring[j] - ring[i]) / L, uz = (ring[j + 1] - ring[i + 1]) / L, nx = uz * sg, nz = -ux * sg;
    const road = nx * -F.vx + nz * -F.vz > 0.5;
    const every = road ? 8 : 10;
    if (land.trees === 'dense' || (land.trees === 'avenue' && road)) {
      const n = Math.floor((L - 4) / every);
      for (let k = 0; k <= n; k++) {
        const t = (L - n * every) / 2 + k * every, x = ring[i] + ux * t - nx * 2.5, z = ring[i + 1] + uz * t - nz * 2.5;
        if (clear(x, z)) out.trees.push([x, z]);
      }
    }
    if (land.hedge && !road) out.hedges.push([ring[i] - nx * 0.6, ring[i + 1] - nz * 0.6, ring[j] - nx * 0.6, ring[j + 1] - nz * 0.6]);
  }
  return out;
}
