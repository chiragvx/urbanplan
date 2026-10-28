// Time-of-day lighting for Pune (~18.5°N): sun rises east, arcs slightly south, sets west.
import type { FrameLighting } from './renderer';
import type { Vec3 } from './math';

const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function lightingAt(minutes: number, time: number): FrameLighting {
  const h = minutes / 60;
  const th = (Math.PI * (h - 6)) / 12; // 0 at 6:00, π at 18:00
  const elev = Math.sin(th);
  let sun: Vec3 = [Math.cos(th), Math.max(elev, -0.2) * 0.95, 0.38];
  const l = Math.hypot(...sun);
  sun = [sun[0] / l, sun[1] / l, sun[2] / l];

  const day = smooth(-0.05, 0.25, elev);      // 0 night → 1 day
  const golden = smooth(0.45, 0.05, elev) * day; // warm near horizon

  const daySun: Vec3 = [2.7, 2.55, 2.3];
  const goldSun: Vec3 = [2.5, 1.55, 0.85];
  const moon: Vec3 = [0.22, 0.27, 0.42];
  let sunColor = mix3(daySun, goldSun, golden);
  sunColor = mix3(moon, sunColor, day);

  const daySky: Vec3 = [0.5, 0.62, 0.8];
  const goldSky: Vec3 = [0.55, 0.48, 0.5];
  const nightSky: Vec3 = [0.035, 0.05, 0.09];
  const sky = mix3(nightSky, mix3(daySky, goldSky, golden), day);

  const dayFog: Vec3 = [0.62, 0.69, 0.78];
  const goldFog: Vec3 = [0.78, 0.6, 0.48];
  const nightFog: Vec3 = [0.025, 0.035, 0.06];
  const fog = mix3(nightFog, mix3(dayFog, goldFog, golden), day);

  const ground = mix3([0.02, 0.02, 0.025], [0.32, 0.28, 0.21], day);
  const sunDir: Vec3 = day > 0.02 ? sun : [-0.35, 0.85, 0.4];
  const sl = Math.hypot(...sunDir);

  return {
    sunDir: [sunDir[0] / sl, sunDir[1] / sl, sunDir[2] / sl],
    sunColor,
    skyColor: sky,
    groundColor: ground,
    fogColor: fog,
    fogDensity: 1 / 4200,
    night: 1 - day,
    time,
  };
}

/** Rough Pune traffic demand by hour (0..1). */
export function demandAt(minutes: number): number {
  const h = minutes / 60;
  const g = (c: number, w: number) => Math.exp(-((h - c) * (h - c)) / (2 * w * w));
  return Math.min(1, 0.12 + 0.85 * g(9.5, 1.6) + 0.55 * g(13.5, 2.5) + 0.95 * g(19, 1.8));
}
