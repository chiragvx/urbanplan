// Tile definitions. A tile is a square of real city, centred on lat/lon.
// Size is configurable — grow it as long as the engine stays smooth.
export const TILES = {
  kp: { id: 'kp', name: 'Koregaon Park · Kalyani Nagar', city: 'Pune', lat: 18.543, lon: 73.898, sizeKm: 5 },
  baner: { id: 'baner', name: 'Baner · Aundh · Balewadi', city: 'Pune', lat: 18.562, lon: 73.785, sizeKm: 4 },
};

export function tileBBox(t) {
  const half = (t.sizeKm * 1000) / 2;
  const dLat = half / 110540;
  const dLon = half / (111320 * Math.cos((t.lat * Math.PI) / 180));
  return { s: t.lat - dLat, w: t.lon - dLon, n: t.lat + dLat, e: t.lon + dLon, half };
}
