// A plot never runs over what's already there: drawn or moved, its outline is trimmed back to the road edges (the
// carriageway and its footpaths, the junctions' rounded corners) and to its neighbouring plots. The checks only see
// a plot as drawn, so the trim is made on the outline itself. Flyovers and tunnels pass over / under and don't trim.
import type { Editor } from './editor';
import type { Id } from '../doc/types';
import { area, diff, fromFlat, offset, outlines, simplify, stroke, type MP } from '../doc/ground';
import { totalWidth } from '../doc/xsection';

/** a plot's own lanes and paths (a campus's service roads, its footpaths) are inside it, not beside it */
const PRIVATE = new Set(['service', 'track', 'footway', 'path', 'pedestrian', 'cycleway', 'steps', 'bridleway']);

/** The plot's outline less the roads and plots it runs into: the largest piece left, or null when nothing is. */
export function fitPlot(E: Editor, ring: number[], self?: Id): { ring: number[]; trimmed: number } | null {
  const shape = fromFlat(ring);
  if (!shape.length) return null;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); }
  const cut: MP[] = [];
  for (const id of E.hit.query(x0 - 40, z0 - 40, x1 + 40, z1 + 40)) {
    if (id === self) continue;
    const o = E.doc.get(id);
    if (o?.kind === 'section' && !o.elevated && !o.tunnel && o.bridge === 'none' && !PRIVATE.has(o.cls)) { const r = surface(E, id); if (r.length) cut.push(r); }
    else if (o?.kind === 'junction' && E.doc.sectionsAt(id).some((x) => !PRIVATE.has(x.cls) && !x.elevated && !x.tunnel)) { const r = E.C.junctionRing(id); if (r && r.length >= 3) cut.push(fromFlat(r.flat())); }
    else if (o?.kind === 'plot' && o.ring.length >= 6) cut.push(fromFlat(o.ring));
  }
  const before = area(shape);
  // (less any sliver under half a metre wide the cut leaves, where two roads' edges don't quite meet)
  const left = cut.length ? offset(offset(diff(shape, ...cut), -0.25), 0.25) : shape;
  const trimmed = before - area(left);
  if (trimmed < 0.5) return { ring, trimmed: 0 };
  // the largest piece (a road right across it leaves two: the plot is the bigger one)
  let best: number[] | null = null, bestA = 0;
  for (const p of left) { const a = area([p]); if (a > bestA) { bestA = a; best = outlines([p])[0]; } }
  // a junction's rounded corner as a few corners, not dozens (within 25 cm of the curve)
  if (best) { const s = simplify(best, 0.25); if (s.length >= 6) best = s; }
  return best && best.length >= 6 && bestA >= 0.5 ? { ring: best, trimmed } : null;
}

/**
 * A ground road's surface, kerb to kerb and its footpaths: its centre line stroked at its width (at least its total
 * width, as the plot report measures it, so the trimmed plot doesn't read as on the road), round at the ends so
 * there's no gap at a bend where it meets the next piece of road.
 */
function surface(E: Editor, id: Id): MP {
  const g = E.C.geo(id), s = E.doc.get<'section'>(id);
  if (!g || !s || g.pts.length < 4) return [];
  return stroke(Array.from(g.pts), 2 * Math.max(g.t.hwL, g.t.hwR, totalWidth(s.parts) / 2));
}
