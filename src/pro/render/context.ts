// The neighbours: buildings within 250 m of a plot placed on the map (a plot imported or found by its survey number
// carries where it is: ProProject.at, latitude and longitude of its middle), from the city's baked OpenStreetMap
// region (public/regions/<city>/: pieces of 2,048 m), moved into the plot's frame (x east, z south, turned by
// p.north) and extruded to their heights as one plain, light grey mass that casts and takes shadows. Buildings on the
// plot itself are left out: the scheme replaces them.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadManifest, loadPiece, type RegionManifest } from '../../data/region';
import { prism } from './geo';

const manifests = new Map<string, Promise<RegionManifest>>();
const pieces = new Map<string, ReturnType<typeof loadPiece>>();

/** the city's region for a Pro authority */
export const regionOf = (city: string) => (city.startsWith('mumbai') ? 'mumbai' : 'pune');

export interface Neighbour { ring: number[]; h: number }

/** the buildings round a plot at `at` [lat, lon], in its frame (turned by `north` degrees), within `R` m;
 *  `onPlot(x, z)` says which to leave out */
export async function neighbours(base: string, city: string, at: [number, number], north: number, onPlot: (x: number, z: number) => boolean, R = 250): Promise<Neighbour[]> {
  const id = regionOf(city), root = `${base}regions/${id}/`;
  let mp = manifests.get(id);
  if (!mp) { mp = loadManifest(root); manifests.set(id, mp); }
  const M = await mp;
  const X = (at[1] - M.frame.lon0) * M.frame.kx, Z = -(at[0] - M.frame.lat0) * M.frame.kz;
  const have = new Set(M.pieces.map(([i, j]) => `${i}_${j}`));
  const out: Neighbour[] = [];
  const n = (north * Math.PI) / 180, c = Math.cos(n), s = Math.sin(n);
  for (let i = Math.floor((X - R) / M.piece); i <= Math.floor((X + R) / M.piece); i++) for (let j = Math.floor((Z - R) / M.piece); j <= Math.floor((Z + R) / M.piece); j++) {
    const k = `${id}:${i}_${j}`;
    if (!have.has(`${i}_${j}`)) continue;
    let pp = pieces.get(k);
    if (!pp) { pp = loadPiece(root, i, j); pieces.set(k, pp); }
    let P; try { P = await pp; } catch { continue; }
    for (const b of P.buildings) {
      const o = b.outer;
      if (o.length < 6) continue;
      let cx = 0, cz = 0;
      for (let q = 0; q < o.length; q += 2) { cx += o[q]; cz += o[q + 1]; }
      cx = cx / (o.length / 2) - X; cz = cz / (o.length / 2) - Z;
      if (Math.hypot(cx, cz) > R) continue;
      // (into the plot's frame: about its middle, turned as the sun is turned into it)
      const ring: number[] = [];
      for (let q = 0; q < o.length; q += 2) { const dx = o[q] - X, dz = o[q + 1] - Z; ring.push(dx * c - dz * s, dx * s + dz * c); }
      const mx = cx * c - cz * s, mz = cx * s + cz * c;
      if (onPlot(mx, mz)) continue;
      out.push({ ring, h: Math.max(3, b.h || 9) });
    }
  }
  return out;
}

/** the neighbours as one mesh */
export function neighbourMesh(list: Neighbour[], mat: THREE.Material): THREE.Mesh | null {
  const gs: THREE.BufferGeometry[] = [];
  for (const nb of list) { try { gs.push(prism(nb.ring, 0, nb.h)); } catch { /* a bad ring */ } }
  if (!gs.length) return null;
  const g = mergeGeometries(gs);
  gs.forEach((x) => x.dispose());
  if (!g) return null;
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
