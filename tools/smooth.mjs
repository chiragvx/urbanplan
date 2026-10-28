// Turns OSM polylines into smooth, flowing curves before osm2streets sees them.
//
//  - Every bend that isn't a junction is replaced by a curve (quadratic Bézier between tangent points,
//    G1-continuous) sized by a design radius per road class. Tangent lengths are clamped so neighbouring
//    curves meet but never overlap, so dense OSM curves become one continuous sweep.
//  - Where one way simply continues into the next (2 way-ends, nothing else), the corner is smoothed across
//    both ways: the shared node moves onto the curve.
//  - Roundabouts are fitted to a true circle and densely re-sampled.
//
// Works in local metres; caller supplies proj/unproj. New nodes get synthetic ids.

const CURVE_STEP_DEG = 2.5;
const CURVE_MAX_CHORD = 2.5;

export function designRadius(tags) {
  const h = (tags.highway ?? '').replace('_link', '');
  const link = (tags.highway ?? '').endsWith('_link');
  if (tags.railway) return tags.railway === 'subway' || tags.railway === 'light_rail' ? 160 : 300;
  const r = { motorway: 220, trunk: 160, primary: 110, secondary: 75, tertiary: 50, unclassified: 30, residential: 22,
    living_street: 14, service: 12, track: 14, busway: 80, cycleway: 10, footway: 6, path: 6, pedestrian: 8, steps: 0 }[h] ?? 18;
  return link ? Math.max(40, r * 0.6) : r;
}

let nextNodeId = 8_000_000_000_000;

export function smoothNetwork(ways, nodes, proj, unproj, { onlyIf = () => true } = {}) {
  const P = new Map(); // node id → [x,z] (working positions)
  const pos = (id) => { let p = P.get(id); if (!p) { const n = nodes.get(id); p = proj(n); P.set(id, p); } return p; };
  const target = ways.filter((w) => onlyIf(w.tags) && w.nds.length >= 2 && w.nds.every((id) => nodes.has(id)));

  // ---- node usage ----
  const refs = new Map(); // id → [{w, i}]
  for (const w of ways) w.nds.forEach((id, i) => { (refs.get(id) ?? refs.set(id, []).get(id)).push({ w, i }); });
  const isEnd = (r) => r.i === 0 || r.i === r.w.nds.length - 1;
  const smoothable = (id) => { const r = refs.get(id) ?? []; return r.length === 1 && !isEnd(r[0]); };
  const continuation = (id) => {
    const r = refs.get(id) ?? [];
    return r.length === 2 && r[0].w !== r[1].w && isEnd(r[0]) && isEnd(r[1]) && onlyIf(r[0].w.tags) && onlyIf(r[1].w.tags)
      && (r[0].w.tags.highway ?? '').replace('_link', '') === (r[1].w.tags.highway ?? '').replace('_link', '');
  };

  // ---- roundabouts → circles ----
  const roundabout = (w) => ['roundabout', 'circular'].includes(w.tags.junction);
  const done = new Set();
  const rbWays = target.filter(roundabout);
  const seen = new Set();
  for (const w of rbWays) {
    if (seen.has(w)) continue;
    // connected group of roundabout ways
    const group = [], stack = [w];
    seen.add(w);
    while (stack.length) {
      const c = stack.pop();
      group.push(c);
      for (const id of [c.nds[0], c.nds[c.nds.length - 1]]) for (const r of refs.get(id) ?? []) if (roundabout(r.w) && !seen.has(r.w) && onlyIf(r.w.tags)) { seen.add(r.w); stack.push(r.w); }
    }
    const ids = [...new Set(group.flatMap((g) => g.nds))];
    if (ids.length < 3) continue;
    let cx = 0, cz = 0;
    for (const id of ids) { const p = pos(id); cx += p[0]; cz += p[1]; }
    cx /= ids.length; cz /= ids.length;
    let R = 0;
    for (const id of ids) { const p = pos(id); R += Math.hypot(p[0] - cx, p[1] - cz); }
    R /= ids.length;
    if (R < 4 || R > 150) continue;
    for (const id of ids) { const p = pos(id); const a = Math.atan2(p[1] - cz, p[0] - cx); P.set(id, [cx + Math.cos(a) * R, cz + Math.sin(a) * R]); }
    for (const g of group) {
      const out = [g.nds[0]];
      for (let i = 1; i < g.nds.length; i++) {
        const a = pos(g.nds[i - 1]), b = pos(g.nds[i]);
        let a0 = Math.atan2(a[1] - cz, a[0] - cx), a1 = Math.atan2(b[1] - cz, b[0] - cx);
        let d = a1 - a0;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        const steps = Math.max(1, Math.ceil(Math.abs(d * R) / CURVE_MAX_CHORD));
        for (let s = 1; s < steps; s++) {
          const t = a0 + (d * s) / steps;
          const id = nextNodeId++;
          P.set(id, [cx + Math.cos(t) * R, cz + Math.sin(t) * R]);
          out.push(id);
        }
        out.push(g.nds[i]);
      }
      g.nds = out;
      done.add(g);
    }
  }

  // ---- curve helpers ----
  const unit = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1e-9; return [dx / L, dz / L, L]; };
  /** Bézier corner at V between neighbours A and B. Returns points from tangent-on-AV to tangent-on-VB (exclusive of V). */
  function corner(A, V, B, R, allowA, allowB) {
    const [ux, uz, la] = unit(A, V), [vx, vz, lb] = unit(V, B);
    const cos = Math.max(-1, Math.min(1, ux * vx + uz * vz));
    const theta = Math.acos(cos); // turn angle
    if (theta < 0.004 || theta > Math.PI * 0.97) return null;
    const d = Math.min(R * Math.tan(theta / 2), la * allowA, lb * allowB);
    if (d < 0.3) return null;
    const T1 = [V[0] - ux * d, V[1] - uz * d], T2 = [V[0] + vx * d, V[1] + vz * d];
    const arc = d * theta; // approx length
    const n = Math.max(2, Math.ceil(Math.max((theta * 180) / Math.PI / CURVE_STEP_DEG, arc / CURVE_MAX_CHORD)));
    const pts = [];
    for (let s = 0; s <= n; s++) {
      const t = s / n, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
      pts.push([a * T1[0] + b * V[0] + c * T2[0], a * T1[1] + b * V[1] + c * T2[1]]);
    }
    return pts;
  }
  const newNode = (p) => { const id = nextNodeId++; P.set(id, p); return id; };

  // ---- continuations across two ways ----
  const prefix = new Map(), suffix = new Map(); // way → node ids to insert after first / before last
  const contSeen = new Set();
  for (const w of target) {
    if (done.has(w)) continue;
    for (const end of [0, w.nds.length - 1]) {
      const id = w.nds[end];
      if (contSeen.has(id) || !continuation(id)) continue;
      contSeen.add(id);
      const [r0, r1] = refs.get(id);
      if (done.has(r0.w) || done.has(r1.w)) continue;
      const nb = (r) => r.w.nds[r.i === 0 ? 1 : r.i - 1];
      const A = pos(nb(r0)), V = pos(id), B = pos(nb(r1));
      const R = Math.min(designRadius(r0.w.tags), designRadius(r1.w.tags));
      const pts = corner(A, V, B, R, smoothable(nb(r0)) ? 0.5 : 0.85, smoothable(nb(r1)) ? 0.5 : 0.85);
      if (!pts) continue;
      const mid = Math.floor(pts.length / 2);
      P.set(id, pts[mid]); // the shared node moves onto the curve
      const side0 = pts.slice(0, mid).map(newNode);           // from A's tangent toward mid
      const side1 = pts.slice(mid + 1).map(newNode);          // from mid toward B's tangent
      // r0's points ordered along r0 toward the node: side0. r1's points from the node outward: side1.
      if (r0.i === 0) prefix.set(r0.w, [...(prefix.get(r0.w) ?? []), ...side0.slice().reverse()]);
      else suffix.set(r0.w, [...side0, ...(suffix.get(r0.w) ?? [])]);
      if (r1.i === 0) prefix.set(r1.w, [...(prefix.get(r1.w) ?? []), ...side1]);
      else suffix.set(r1.w, [...side1.slice().reverse(), ...(suffix.get(r1.w) ?? [])]);
    }
  }

  // ---- interior bends ----
  let corners = 0;
  for (const w of target) {
    if (done.has(w)) continue;
    const R = designRadius(w.tags);
    const orig = w.nds.map((id) => pos(id).slice());
    const out = [w.nds[0], ...(prefix.get(w) ?? [])];
    for (let i = 1; i < w.nds.length - 1; i++) {
      const id = w.nds[i];
      if (!smoothable(id) || R <= 0) { out.push(id); continue; }
      const allowA = smoothable(w.nds[i - 1]) || continuation(w.nds[i - 1]) ? 0.5 : 0.85;
      const allowB = smoothable(w.nds[i + 1]) || continuation(w.nds[i + 1]) ? 0.5 : 0.85;
      const pts = corner(orig[i - 1], orig[i], orig[i + 1], R, allowA, allowB);
      if (!pts) { out.push(id); continue; }
      corners++;
      // reuse the original node id for the curve's middle point (keeps tags like traffic_signals nearby)
      const mid = Math.floor(pts.length / 2);
      pts.forEach((p, k) => { if (k === mid) { P.set(id, p); out.push(id); } else out.push(newNode(p)); });
    }
    out.push(...(suffix.get(w) ?? []), w.nds[w.nds.length - 1]);
    // drop consecutive duplicates
    w.nds = out.filter((id, k) => k === 0 || id !== out[k - 1]);
  }

  // ---- write back ----
  for (const [id, p] of P) {
    const ll = unproj(p);
    const n = nodes.get(id);
    if (n) { n.lat = ll.lat; n.lon = ll.lon; } else nodes.set(id, { id, lat: ll.lat, lon: ll.lon, tags: {} });
  }
  return { corners, roundabouts: rbWays.length, continuations: contSeen.size };
}
