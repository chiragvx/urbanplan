// A region: a whole city (or metro) baked once and served as 2 km pieces that stream in around the camera.
// Frame: the city frame of the DP pipeline (tools/dp) — metres from (lat0, lon0), x east, z south, equirectangular with
// kx = 111320·cos(lat0), kz = 110540. Piece (i, j) covers x ∈ [i·P, (i+1)·P), z ∈ [j·P, (j+1)·P).
export const REGIONS = {
  pune: {
    id: 'pune', name: 'Pune · Pimpri-Chinchwad', city: 'Pune', state: 'Maharashtra',
    about: 'PMC with the merged villages, and PCMC. DP sheets and road reserves for old PMC.',
    lat0: 18.52, lon0: 73.86,
    // PMC (incl. the 23 villages merged in 2021) + PCMC, with a margin
    bbox: { s: 18.42, w: 73.70, n: 18.72, e: 74.02 },
    piece: 2048, cell: 8,
    // the tile edited until now (saved maps made on it are moved into this frame when opened)
    legacy: { kp: { lat: 18.543, lon: 73.898 } },
    // the PMC DP road widths (data/raw/dp/widths.json) apply here
    dp: true,
  },
  mumbai: {
    id: 'mumbai', name: 'Mumbai', city: 'Mumbai', state: 'Maharashtra',
    about: 'MCGM: the island city and the western and eastern suburbs, Colaba to Dahisar and Mulund.',
    lat0: 19.08, lon0: 72.88,
    // MCGM: the island city and the suburbs, Colaba to Dahisar and Mulund (not Navi Mumbai, across the creek)
    bbox: { s: 18.885, w: 72.77, n: 19.275, e: 72.99 },
    piece: 2048, cell: 8,
    // the Arabian Sea, the harbour and the creeks: open water from the DEM (Copernicus masks the sea to 0 m)
    coastal: true,
    // where the editor opens: Bandra-Kurla Complex
    start: { lat: 19.064, lon: 72.866 },
  },
};

export const KZ = 110540;
export const kxOf = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

export function regionFrame(R) {
  const kx = kxOf(R.lat0), kz = KZ;
  const proj = (lat, lon) => [(lon - R.lon0) * kx, -(lat - R.lat0) * kz];
  const unproj = (x, z) => ({ lat: R.lat0 - z / kz, lon: R.lon0 + x / kx });
  const [x0, z1] = proj(R.bbox.s, R.bbox.w), [x1, z0] = proj(R.bbox.n, R.bbox.e);
  const P = R.piece;
  const i0 = Math.floor(x0 / P), i1 = Math.ceil(x1 / P) - 1, j0 = Math.floor(z0 / P), j1 = Math.ceil(z1 / P) - 1;
  return { kx, kz, proj, unproj, x0: i0 * P, z0: j0 * P, x1: (i1 + 1) * P, z1: (j1 + 1) * P, i0, i1, j0, j1, P };
}
