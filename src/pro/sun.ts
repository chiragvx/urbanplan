// The sun for a sun and shadow study: where it is in the sky at a place and time (NOAA's general solar position
// equations: a fractional-year series for the declination and the equation of time, good to a fraction of a degree,
// plenty for shadows). A Pro plot has no true north (it's drawn with its road along x), so the scene's convention is
// that the plan's −z is north: x east, y up, z south. Turning the plot to its real bearing is for when plots come
// from map data.

/** latitude, longitude (degrees) a project's rules point to */
export const CITY_LATLON: Record<string, [number, number]> = {
  pune: [18.52, 73.86],
  'pune-congested': [18.515, 73.855],
  'mumbai-island': [18.94, 72.83],
  'mumbai-suburbs': [19.12, 72.88],
};

const RAD = Math.PI / 180;

/** The sun's azimuth (radians, clockwise from north) and elevation (radians above the horizon) at lat, lon (degrees)
 *  at the instant `date`. */
export function sunPosition(lat: number, lon: number, date: Date): { azimuth: number; elevation: number } {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const doy = Math.floor((date.getTime() - start) / 86400000) + 1;
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const leap = new Date(Date.UTC(date.getUTCFullYear(), 1, 29)).getUTCMonth() === 1;
  const g = ((2 * Math.PI) / (leap ? 366 : 365)) * (doy - 1 + (hour - 12) / 24);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  // true solar time (minutes) and the hour angle
  const tst = hour * 60 + eqtime + 4 * lon;
  const ha = (tst / 4 - 180) * RAD, phi = lat * RAD;
  const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const elevation = Math.asin(Math.max(-1, Math.min(1, cosZ)));
  // (from the south, positive westward; turned to clockwise from north)
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) + Math.PI;
  return { azimuth: (az + 2 * Math.PI) % (2 * Math.PI), elevation };
}

/** A unit vector from the ground towards the sun, in scene coordinates (x east, y up, z south: plan −z is north). */
export function sunDirection(lat: number, lon: number, date: Date): [number, number, number] {
  const { azimuth: a, elevation: e } = sunPosition(lat, lon, date);
  return [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)];
}

/** An instant in Indian Standard Time (UTC + 5:30): month 1–12, hours as a decimal (14.5 = 2:30 pm). */
export function indiaTime(year: number, month: number, day: number, hours: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) + (hours - 5.5) * 3600000);
}

/** The sun's path over a day, every `step` hours from sunrise to sunset (elevation above 0), in IST. */
export function sunPath(lat: number, lon: number, year: number, month: number, day: number, step = 0.5): { hour: number; azimuth: number; elevation: number }[] {
  const out: { hour: number; azimuth: number; elevation: number }[] = [];
  for (let h = 5; h <= 20; h += step) {
    const s = sunPosition(lat, lon, indiaTime(year, month, day, h));
    if (s.elevation > 0) out.push({ hour: h, ...s });
  }
  return out;
}
