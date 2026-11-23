// Curves on a drawn line or area, the way a vector drawing app does them: each node can carry two handles (in and
// out, offsets from the node), and the stretch between two nodes is a cubic Bézier through the out handle of the
// first and the in handle of the second. A node with no handles is a corner. What's drawn is kept as its nodes and
// handles (`SiteElement.nodes`, `bez`); the line or ring everything else reads (`spine`, `ring`) is the curve sampled
// every metre or so, so the engine, the ground and the 3D need know nothing of curves.

export type Handles = [number, number, number, number] | null;

/** the curve through flat nodes (x, z, …) with per-node handles [inX, inZ, outX, outZ] (offsets), sampled about
 *  every `step` metres; `closed` joins the last node to the first */
export function sampleBez(nodes: number[], bez: Handles[] | undefined, closed: boolean, step = 1): number[] {
  const n = nodes.length / 2;
  if (n < 2 || !bez?.some(Boolean)) return nodes.slice();
  const out: number[] = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    const ax = nodes[i * 2], az = nodes[i * 2 + 1], dx = nodes[j * 2], dz = nodes[j * 2 + 1];
    const ha = bez[i], hd = bez[j];
    const bx = ax + (ha ? ha[2] : 0), bz = az + (ha ? ha[3] : 0), cx = dx + (hd ? hd[0] : 0), cz = dz + (hd ? hd[1] : 0);
    out.push(ax, az);
    if (!ha && !hd) continue;
    // (the control polygon's length bounds the curve's: enough samples for about `step` metres each)
    const L = Math.hypot(bx - ax, bz - az) + Math.hypot(cx - bx, cz - bz) + Math.hypot(dx - cx, dz - cz);
    const m = Math.max(2, Math.min(64, Math.ceil(L / step)));
    for (let k = 1; k < m; k++) {
      const t = k / m, u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
      out.push(r3(w0 * ax + w1 * bx + w2 * cx + w3 * dx), r3(w0 * az + w1 * bz + w2 * cz + w3 * dz));
    }
  }
  if (!closed) out.push(nodes[(n - 1) * 2], nodes[(n - 1) * 2 + 1]);
  return out;
}
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** handles for node i that make it smooth, as a drawing app's "smooth" does: along the line through its neighbours,
 *  each a third of the way to its own neighbour (an open line's end node gets one handle, towards its neighbour) */
export function smoothHandles(nodes: number[], i: number, closed: boolean): Handles {
  const n = nodes.length / 2;
  if (n < 2) return null;
  const P = (k: number): [number, number] => [nodes[k * 2], nodes[k * 2 + 1]];
  const hasPrev = closed || i > 0, hasNext = closed || i < n - 1;
  const c = P(i), a = hasPrev ? P((i - 1 + n) % n) : c, b = hasNext ? P((i + 1) % n) : c;
  let tx = b[0] - a[0], tz = b[1] - a[1];
  const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
  const la = Math.hypot(c[0] - a[0], c[1] - a[1]) / 3, lb = Math.hypot(b[0] - c[0], b[1] - c[1]) / 3;
  const r = (v: number) => Math.round(v * 100) / 100;
  return [r(-tx * la), r(-tz * la), r(tx * lb), r(tz * lb)];
}

/** the handle `which` (0 in, 1 out) of node i moved to offset (x, z); the other one turns to stay opposite (keeping its
 *  length), unless `broken` (a cusp: Alt, as in a drawing app) */
export function moveHandle(h: Handles, which: 0 | 1, x: number, z: number, broken: boolean): Handles {
  const cur = h ?? [0, 0, 0, 0];
  const r = (v: number) => Math.round(v * 100) / 100;
  const o: [number, number, number, number] = [...cur];
  o[which * 2] = r(x); o[which * 2 + 1] = r(z);
  if (!broken) {
    const k = 1 - which, L = Math.hypot(cur[k * 2], cur[k * 2 + 1]) || Math.hypot(x, z), d = Math.hypot(x, z) || 1;
    o[k * 2] = r((-x / d) * L); o[k * 2 + 1] = r((-z / d) * L);
  }
  return o;
}
