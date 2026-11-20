// UTM (WGS84, northern hemisphere) to longitude/latitude, by Krüger's series (sub-millimetre inside a zone).
// MahaBhunakasha gives Maharashtra's plots in zone 43N (EPSG:32643, central meridian 75°E).

const a = 6378137, f = 1 / 298.257223563;
const n = f / (2 - f), n2 = n * n, n3 = n2 * n, n4 = n3 * n;
const A = (a / (1 + n)) * (1 + n2 / 4 + n4 / 64);
const beta = [
  n / 2 - (2 / 3) * n2 + (37 / 96) * n3 - (1 / 360) * n4,
  (1 / 48) * n2 + (1 / 15) * n3 - (437 / 1440) * n4,
  (17 / 480) * n3 - (37 / 840) * n4,
  (4397 / 161280) * n4,
];
const delta = [
  2 * n - (2 / 3) * n2 - 2 * n3,
  (7 / 3) * n2 - (8 / 5) * n3,
  (56 / 15) * n3,
];
const k0 = 0.9996, E0 = 500000, D = Math.PI / 180;

/** [easting, northing] in metres → [lon, lat] in degrees */
export function utmToLonLat(x, y, zone = 43) {
  const xi = y / (k0 * A), eta = (x - E0) / (k0 * A);
  let xi1 = xi, eta1 = eta;
  for (let j = 1; j <= 4; j++) {
    xi1 -= beta[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    eta1 -= beta[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
  let phi = chi;
  for (let j = 1; j <= 3; j++) phi += delta[j - 1] * Math.sin(2 * j * chi);
  const lon0 = (zone * 6 - 183) * D;
  const lon = lon0 + Math.atan2(Math.sinh(eta1), Math.cos(xi1));
  return [lon / D, phi / D];
}
