// The landscape kit (src/pro/render/landscape): every surface paints at a small size with colours, heights and
// roughness in range, the same each time, and repeats without a seam; every tree species grows each variant at both
// details with real geometry, normalised to a canopy of 1, and places as instanced meshes.
import { paintSurface, SURFACE_IDS, SURFACES, surfaceOfCover, surfaceOfRoad, SPECIES, VARIANTS, growTree, treeMeshes } from '../../src/pro/render/landscape';
import { COVERS } from '../../src/pro/ground';
import * as THREE from 'three';
import { VEHICLE_KINDS, vehicleParts, vehicleMeshes, peopleMeshes, kindAt } from '../../src/pro/render/vehicles';
import { evaluate } from '../../src/pro/evaluate';
import { DEFAULT_PROJECT, type ProProject } from '../../src/pro/project';
import { area, fromFlat, inter } from '../../src/doc/ground';
import { pointIn } from '../../src/doc/site';

let bad = 0;
const ok = (c: boolean, s: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${s}`); if (!c) bad++; };

for (const id of SURFACE_IDS) {
  const n = 64, F = paintSurface(id, n), G = paintSurface(id, n);
  const inRange = Array.from(F.col).every((x) => Number.isFinite(x) && x >= 0 && x <= 1.2) && Array.from(F.h).every(Number.isFinite) && Array.from(F.r).every((x) => x >= 0 && x <= 1);
  const same = F.col.every((x, i) => x === G.col[i]) && F.h.every((x, i) => x === G.h[i]);
  // (no seam: the jump across the wrap no bigger than the larger jumps inside)
  const lum = (i: number) => F.col[i * 3] + F.col[i * 3 + 1] + F.col[i * 3 + 2];
  let inside = 0, across = 0;
  for (let y = 0; y < n; y++) { across += Math.abs(lum(y * n + n - 1) - lum(y * n)); inside += Math.abs(lum(y * n + n / 2 - 1) - lum(y * n + n / 2)); }
  let mean = 0; for (let i = 0; i < n * n; i++) mean += lum(i) / 3; mean /= n * n;
  ok(inRange && same && across < inside * 2.5 + 2 && mean > 0.08 && mean < 0.95, `${id} (${SURFACES[id].label}): in range, repeatable, seamless (wrap ${across.toFixed(1)} vs ${inside.toFixed(1)}), mean ${mean.toFixed(2)}`);
}
ok(COVERS.every((c) => SURFACE_IDS.includes(surfaceOfCover(c.value))), 'every ground cover has a surface');
ok(['asphalt', 'pavers', 'concrete', 'grass-pavers'].every((s) => SURFACE_IDS.includes(surfaceOfRoad(s))), 'every site road surface has a surface');

for (let k = 0; k < SPECIES.length; k++) for (let v = 0; v < VARIANTS; v++) for (const detail of [true, false]) {
  const G = growTree(k, v, detail), P = G.leaves.attributes.position.array as Float32Array, W = G.wood.attributes.position.array as Float32Array;
  let reach = 0, top = 0; for (let i = 0; i < P.length; i += 3) { reach = Math.max(reach, Math.hypot(P[i], P[i + 2])); top = Math.max(top, P[i + 1]); }
  const fin = [...P, ...W].every(Number.isFinite);
  ok(fin && P.length > 0 && W.length > 0 && Math.abs(reach - 1) < 1e-4 && top > 0.3, `${SPECIES[k].label} variant ${v + 1}${detail ? '' : ' (far)'}: ${G.leaves.index!.count / 3} leaf triangles, ${G.wood.index!.count / 3} wood, height ${top.toFixed(2)} × the canopy`);
}
const ms = treeMeshes([{ x: 0, z: 0, r: 4, kind: 0 }, { x: 10, z: 3, r: 3, kind: 1 }, { x: 20, z: 3, r: 2, kind: 2 }, { x: 30, z: 3, r: 1.2, kind: 3 }, { x: 40, z: 3, r: 0.6, kind: 4 }, { x: 50, z: 3, r: 3, kind: 9 }], true);
ok(ms.length >= 10 && ms.every((m) => m.count >= 1), `six trees placed as ${ms.length} instanced meshes (an unknown kind falls back to a species)`);

// a pool drawn in the open ground: kept as drawn, nothing of the garden laid over it, counted as open space
{
  const ring = [-10, 40, 5, 40, 5, 49, -10, 49];
  const p: ProProject = { ...DEFAULT_PROJECT, width: 60, depth: 80, scheme: { buildings: [], elements: [{ id: 'pool1', kind: 'pool', spine: [], depth: 0, floors: 0, ring }, { id: 'g1', kind: 'garden', spine: [], depth: 0, floors: 0, ring: [-28, 30, 28, 30, 28, 75, -28, 75] }] } } as ProProject;
  const e = evaluate(p), G = e.d.ground.map, P = fromFlat(ring);
  const over = area(inter(P, G.lawn)) + area(inter(P, G.path)) + area(inter(P, G.bed)), planted = G.plants.filter((t) => pointIn(ring, t.x, t.z, 0)).length;
  ok((e.d.site.elements ?? []).some((x) => x.kind === 'pool'), 'a drawn pool is kept');
  ok(over < 0.5 && planted === 0 && area(G.lawn) > 50, `nothing laid over the pool (${over.toFixed(2)} m² of lawn, path or bed, ${planted} plants), the garden round it is (${Math.round(area(G.lawn))} m² of lawn)`);
  const without = evaluate({ ...p, scheme: { buildings: [], elements: p.scheme!.elements.filter((x) => x.kind !== 'pool') } }).d.ground.map.openArea;
  ok(Math.abs(G.openArea - without) < 1, `the pool counts as open space (${Math.round(G.openArea)} m² open with it, ${Math.round(without)} without)`);
}

// vehicles and people (src/pro/render/vehicles.ts): every kind built, finite, standing on the ground at its real size
{
  const SIZE: Record<string, [number, number]> = { hatchback: [3.8, 1.5], sedan: [4.45, 1.5], suv: [4.45, 1.8], van: [4.3, 1.95], auto: [2.65, 1.75], motorcycle: [2.0, 1.1], scooter: [1.8, 1.1], truck: [6.0, 2.5] };
  for (const k of VEHICLE_KINDS) {
    const parts = vehicleParts(k), box = new THREE.Box3();
    for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox!); }
    const fin = parts.every((p) => Array.from(p.geometry.attributes.position.array as Float32Array).every(Number.isFinite));
    const L = box.max.z - box.min.z, H = box.max.y, [L0, H0] = SIZE[k];
    ok(fin && parts.some((p) => p.role === 'paint') && parts.some((p) => p.role === 'trim') && Math.abs(box.min.y) < 0.02 && Math.abs(L - L0) < 0.35 && Math.abs(H - H0) < 0.25, `${k}: ${parts.length} parts, ${L.toFixed(2)} m long, ${H.toFixed(2)} m high, on the ground`);
  }
  const ms = vehicleMeshes('sedan', [[0, 0, 0], [3, 0, 1]]), pm = peopleMeshes([[0, 0], [1, 1]]);
  ok(ms.length >= 5 && ms.every((m) => m.count === 2) && pm.length === 4, `two sedans as ${ms.length} instanced parts, two people as ${pm.length}`);
  ok(['hatchback', 'sedan', 'suv', 'van'].includes(kindAt(1, 2, false)) && VEHICLE_KINDS.includes(kindAt(3, 4, true)), 'a parking bay holds a car, a road any kind');
}

// a parking lot laid to the rules: bays 2.5 × 5 on 6 m aisles, a way in from the road, no bay on a road or outside the lot
{
  const ring = [-25, 20, 25, 20, 25, 60, -25, 60];
  const p: ProProject = { ...DEFAULT_PROJECT, width: 60, depth: 80, scheme: { buildings: [], elements: [{ id: 'lot1', kind: 'lot', spine: [], depth: 0, floors: 0, ring }, { id: 'r1', kind: 'road', spine: [-28, 66, 28, 66], depth: 6, floors: 0 }] } } as ProProject;
  const G = evaluate(p).d.ground.map, L = fromFlat(ring);
  const onRoad = G.bays.filter((q) => area(inter(fromFlat(q), G.road)) > 0.05).length, outside = G.bays.filter((q) => area(inter(fromFlat(q), L)) < 12.4).length;
  const sized = G.bays.every((q) => Math.abs(Math.hypot(q[2] - q[0], q[3] - q[1]) - 2.5) < 0.01 && Math.abs(Math.hypot(q[4] - q[2], q[5] - q[3]) - 5) < 0.01);
  ok(G.bays.length > 20 && sized && onRoad === 0 && outside === 0, `a 50 × 40 m lot: ${G.bays.length} bays of 2.5 × 5 m, ${onRoad} on a road, ${outside} outside the lot`);
  ok(G.road.length > 0 && G.entries.length >= 1 && G.entries.every((e) => Math.hypot(e[2] - e[0], e[3] - e[1]) < 30), `a way in from the road beside it (${G.entries.length}, ${G.entries.map((e) => Math.hypot(e[2] - e[0], e[3] - e[1]).toFixed(1) + ' m').join(', ')})`);
  ok(area(G.lotIsland) > 20, `a planted margin and islands (${Math.round(area(G.lotIsland))} m²)`);
}

console.log(bad ? `${bad} FAILED` : 'ALL OK');
if (bad) process.exitCode = 1;
