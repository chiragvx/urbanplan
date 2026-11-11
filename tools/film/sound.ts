// The soundtrack of an episode, synthesised from the scene itself: every cue lands on a caption, a mark, a step, the
// wipe, the split or the end card, so a new episode gets its own score without anyone editing audio. All of it is made
// here (no samples, no stock music), so there's nothing to license. Seeded, so the same scene always sounds the same.
//
//   "Today" (0 → wipe):   traffic, a honk on the hook, a minor drone and a ticking pulse under the captions
//   the wipe:             a whoosh, then a riser into the downbeat
//   "What if" (→ end):    D major at 120 bpm (D A Bm G), a plucked arpeggio, a blip up the scale per step, birds for trees
//   the split / the end:  a whoosh, a ding per number card, then the tonic, a bell and a fade
//   the voice-over:       the scene's `vo` lines, spoken by Kokoro (tools/film/tts.py), the bed ducked under them
//
//   node tools/dev/film-sound.mjs wi-01      → film/out/wi-01.wav (48 kHz stereo; film.mjs muxes it in)
//   … wi-01 --no-vo                          music and effects only
//   … wi-01 --voice=bf_emma                  another narrator than the scene's
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SCENES } from '../../src/film/scenes';
import type { Scene } from '../../src/film/types';

const SR = 48000;

function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

class Bus {
  L: Float32Array; R: Float32Array;
  constructor(n: number) { this.L = new Float32Array(n); this.R = new Float32Array(n); }
  /** add a mono voice at t seconds, panned -1 … 1 (equal power) */
  add(t: number, v: Float32Array, gain = 1, pan = 0) {
    const i0 = Math.round(t * SR), a = ((pan + 1) * Math.PI) / 4, gl = Math.cos(a) * gain * Math.SQRT2, gr = Math.sin(a) * gain * Math.SQRT2;
    for (let i = 0; i < v.length; i++) { const j = i0 + i; if (j < 0) continue; if (j >= this.L.length) break; this.L[j] += v[i] * gl; this.R[j] += v[i] * gr; }
  }
  mix(b: Bus, gain = 1) { for (let i = 0; i < this.L.length; i++) { this.L[i] += b.L[i] * gain; this.R[i] += b.R[i] * gain; } }
}

// ---- building blocks -------------------------------------------------------------------------------------------------

const buf = (s: number) => new Float32Array(Math.max(1, Math.round(s * SR)));
/** attack / hold / exponential release envelope, in place */
function env(v: Float32Array, a: number, rel: number) {
  const na = a * SR, tau = rel * SR;
  for (let i = 0; i < v.length; i++) v[i] *= (i < na ? i / na : Math.exp(-(i - na) / tau)) * Math.min(1, (v.length - i) / 240);
  return v;
}
/** a fade in and out, linear */
function fade(v: Float32Array, fin: number, fout: number) {
  const a = fin * SR, b = fout * SR;
  for (let i = 0; i < v.length; i++) v[i] *= Math.min(1, i / a, (v.length - i) / b);
  return v;
}
/** one-pole low pass, cutoff from a function of the sample index (constant if a number) */
function lp(v: Float32Array, fc: number | ((i: number) => number)) {
  let y = 0;
  for (let i = 0; i < v.length; i++) { const f = typeof fc === 'number' ? fc : fc(i); const k = 1 - Math.exp((-2 * Math.PI * f) / SR); y += k * (v[i] - y); v[i] = y; }
  return v;
}
function hp(v: Float32Array, fc: number) { const l = lp(Float32Array.from(v), fc); for (let i = 0; i < v.length; i++) v[i] -= l[i]; return v; }
/** state-variable band pass, centre from a function of the sample index */
function bp(v: Float32Array, fc: (i: number) => number, q = 4) {
  let low = 0, band = 0;
  for (let i = 0; i < v.length; i++) { const f = 2 * Math.sin((Math.PI * Math.min(fc(i), SR / 6)) / SR); const high = v[i] - low - band / q; band += f * high; low += f * band; v[i] = band; }
  return v;
}
function noise(s: number, r: () => number) { const v = buf(s); for (let i = 0; i < v.length; i++) v[i] = r() * 2 - 1; return v; }
function brown(s: number, r: () => number) { const v = buf(s); let y = 0; for (let i = 0; i < v.length; i++) { y = (y + (r() * 2 - 1) * 0.02) * 0.998; v[i] = y * 8; } return v; }

/** soft sine-ish tone: the fundamental and a little of the 2nd and 3rd */
function tone(f: number, s: number, bright = 0.3, detune = 0) {
  const v = buf(s);
  for (let i = 0; i < v.length; i++) { const t = i / SR, p = 2 * Math.PI * f * (1 + detune) * t; v[i] = Math.sin(p) + bright * 0.5 * Math.sin(2 * p) + bright * 0.25 * Math.sin(3 * p); }
  return v;
}
/** Karplus–Strong pluck */
function pluck(f: number, s: number, r: () => number, damp = 0.996) {
  const v = buf(s), n = Math.round(SR / f), d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = r() * 2 - 1;
  let p = 0;
  for (let i = 0; i < v.length; i++) { const a = d[p], b = d[(p + 1) % n]; v[i] = a; d[p] = ((a + b) / 2) * damp; p = (p + 1) % n; }
  return lp(v, 4200);
}
/** a warm pad: three detuned tones per note, slow in and out */
function pad(notes: number[], s: number) {
  const v = buf(s);
  for (const m of notes) for (const d of [-0.004, 0, 0.005]) { const t = tone(hz(m), s, 0.45, d); for (let i = 0; i < v.length; i++) v[i] += t[i] / (notes.length * 3); }
  return fade(lp(v, 1800), 0.6, 0.9);
}
function kick(gain = 1) {
  const v = buf(0.45); let ph = 0;
  for (let i = 0; i < v.length; i++) { const t = i / SR; ph += (2 * Math.PI * (48 + 90 * Math.exp(-t * 30))) / SR; v[i] = Math.sin(ph) * Math.exp(-t * 7) * gain; }
  return v;
}
function shaker(r: () => number) { return env(hp(noise(0.07, r), 5000), 0.004, 0.025); }
/** a UI blip: a quick bright tone with a downward flick */
function blip(f: number) {
  const v = buf(0.35); let ph = 0;
  for (let i = 0; i < v.length; i++) { const t = i / SR; ph += (2 * Math.PI * f * (1 + 0.06 * Math.exp(-t * 60))) / SR; v[i] = (Math.sin(ph) + 0.3 * Math.sin(2 * ph)) * Math.exp(-t * 14) * Math.min(1, t * 2000); }
  return v;
}
function click(r: () => number) { return env(bp(noise(0.03, r), () => 2600, 3), 0.001, 0.006); }
/** FM bell */
function bell(f: number, s = 2.5) {
  const v = buf(s);
  for (let i = 0; i < v.length; i++) { const t = i / SR, I = 3 * Math.exp(-t * 3); v[i] = Math.sin(2 * Math.PI * f * t + I * Math.sin(2 * Math.PI * f * 3.5 * t)) * Math.exp(-t * 1.8) * Math.min(1, t * 1500); }
  return v;
}
/** noise through a band pass that sweeps up (rise) or up and down (a whoosh) */
function whoosh(s: number, r: () => number, f0 = 300, f1 = 4000, rise = false) {
  const n = Math.round(s * SR), v = bp(noise(s, r), (i) => { const u = i / n; return f0 * (f1 / f0) ** (rise ? u * u : Math.sin(Math.PI * u)); }, 2.5);
  for (let i = 0; i < n; i++) { const u = i / n; v[i] *= rise ? u ** 2.2 : Math.sin(Math.PI * u) ** 1.5; }
  return v;
}
/** a two-tone city horn, slightly sour, a couple of short honks */
function horn(f: number, honks: number[], r: () => number) {
  const s = Math.max(...honks.map((h, i) => (i % 2 ? 0 : h + honks[i + 1]))) + 0.1, v = buf(s);
  for (let k = 0; k < honks.length; k += 2) {
    const i0 = Math.round(honks[k] * SR), len = Math.round(honks[k + 1] * SR);
    for (let i = 0; i < len && i0 + i < v.length; i++) {
      const t = i / SR, w = (x: number) => (Math.sin(x) > 0 ? 1 : -1) * 0.5 + Math.sin(x) * 0.5;
      v[i0 + i] = (w(2 * Math.PI * f * t) + 0.8 * w(2 * Math.PI * f * 1.26 * t)) * Math.min(1, t * 300, (len - i) / 300);
    }
  }
  return lp(hp(v, 300), 2600);
}
/** a car going by: band-passed noise, louder and brighter as it passes, panned across */
function car(s: number, r: () => number) {
  const n = Math.round(s * SR), v = noise(s, r);
  lp(v, (i) => 300 + 1500 * Math.exp(-(((i / n - 0.5) * 5) ** 2)));
  for (let i = 0; i < n; i++) v[i] *= Math.exp(-(((i / n - 0.5) * 4) ** 2));
  return v;
}
/** a bird: a few fast falling chirps */
function bird(r: () => number) {
  const v = buf(0.6); let t0 = 0;
  for (let c = 0; c < 2 + Math.floor(r() * 3); c++) {
    const f0 = 3200 + r() * 1800, len = 0.05 + r() * 0.05, i0 = Math.round(t0 * SR); let ph = 0;
    for (let i = 0; i < len * SR && i0 + i < v.length; i++) { const u = i / (len * SR); ph += (2 * Math.PI * f0 * (1 - 0.35 * u)) / SR; v[i0 + i] += Math.sin(ph) * Math.sin(Math.PI * u); }
    t0 += len + 0.03 + r() * 0.05;
  }
  return v;
}

/**
 * Look-ahead peak limiter: the gain is already down when a peak arrives (no clipped edges, no distortion), and comes
 * back over `rel` seconds. Channels are linked. The gain is the lowest needed within ±look, box-averaged over the
 * same span, so it ramps in smoothly and is never above what any sample needs.
 */
function limit(ch: Float32Array[], ceil: number, rel = 0.08, look = 0.005) {
  const n = ch[0].length, la = Math.max(1, Math.round(look * SR)), need = new Float32Array(n), m = new Float32Array(n);
  for (let i = 0; i < n; i++) { let p = 0; for (const c of ch) p = Math.max(p, Math.abs(c[i])); need[i] = p > ceil ? ceil / p : 1; }
  for (let i = 0; i < n; i++) { let v = 1; for (let j = Math.max(0, i - la); j <= Math.min(n - 1, i + la); j++) if (need[j] < v) v = need[j]; m[i] = v; }
  const k = 1 - Math.exp(-1 / (rel * SR));
  let sum = 0, y = 1;
  for (let j = 0; j < Math.min(n, la + 1); j++) sum += m[j];
  for (let i = 0; i < n; i++) {
    const g = sum / (Math.min(n - 1, i + la) - Math.max(0, i - la) + 1);
    y = Math.min(g, y + (1 - y) * k);
    for (const c of ch) c[i] *= y;
    if (i + la + 1 < n) sum += m[i + la + 1];
    if (i - la >= 0) sum -= m[i - la];
  }
}

/** Integrated loudness (ITU-R BS.1770: K-weighted, 400 ms blocks, gated at -70 LUFS and 10 LU under the mean). */
function lufs(b: Bus) {
  const kw = (x: Float32Array) => {
    const y = new Float32Array(x.length);
    const run = (src: Float32Array, dst: Float32Array, b0: number, b1: number, b2: number, a1: number, a2: number) => {
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < src.length; i++) { const v = b0 * src[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = src[i]; y2 = y1; y1 = v; dst[i] = v; }
    };
    run(x, y, 1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585);
    run(y, y, 1, -2, 1, -1.99004745483398, 0.99007225036621);
    return y;
  };
  const L = kw(b.L), R = kw(b.R), blk = Math.round(0.4 * SR), hop = blk / 4, z: number[] = [];
  for (let i = 0; i + blk <= L.length; i += hop) { let e = 0; for (let j = i; j < i + blk; j++) e += L[j] * L[j] + R[j] * R[j]; z.push(e / blk); }
  const ld = (e: number) => -0.691 + 10 * Math.log10(e);
  let g = z.filter((e) => ld(e) > -70);
  const rel = ld(g.reduce((a, e) => a + e, 0) / g.length) - 10;
  g = g.filter((e) => ld(e) > rel);
  return ld(g.reduce((a, e) => a + e, 0) / g.length);
}

/** Schroeder reverb: four combs into two all-passes, a little different left and right */
function reverb(b: Bus, mix = 0.25) {
  const run = (x: Float32Array, spread: number) => {
    const out = new Float32Array(x.length);
    for (const [d, g] of [[1557, 0.84], [1617, 0.83], [1491, 0.85], [1422, 0.86]]) {
      const n = Math.round((d + spread) * (SR / 44100)), line = new Float32Array(n); let p = 0, f = 0;
      for (let i = 0; i < x.length; i++) { const y = line[p]; f = y * 0.6 + f * 0.4; line[p] = x[i] + f * g; p = (p + 1) % n; out[i] += y / 4; }
    }
    for (const d of [225, 556]) {
      const n = Math.round((d + spread / 4) * (SR / 44100)), line = new Float32Array(n); let p = 0;
      for (let i = 0; i < out.length; i++) { const y = line[p], v = out[i]; line[p] = v + y * 0.5; out[i] = y - v * 0.5; p = (p + 1) % n; }
    }
    return out;
  };
  const wl = run(b.L, 0), wr = run(b.R, 23);
  for (let i = 0; i < b.L.length; i++) { b.L[i] += wl[i] * mix; b.R[i] += wr[i] * mix; }
}

// ---- the score -------------------------------------------------------------------------------------------------------

export function score(S: Scene, voice: { t: number; a: Float32Array }[] = [], measured: Record<string, number> = {}) {
  const r = rng(0x5eed ^ S.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const n = Math.round(S.duration * SR);
  const music = new Bus(n), fx = new Bus(n), amb = new Bus(n);
  // (a plot scene has no wipe: its `beat` is the drop)
  const wipe0 = S.wipe?.t0 ?? (S.beat !== undefined ? S.beat - 2 : 9), drop = S.wipe?.t1 ?? S.beat ?? wipe0 + 2, end = S.end.t0, T = S.duration;
  // the music stops dead on the sting (the catchphrase), else at the end card
  const stop = Math.min(end, S.sting ?? end);

  // Today: traffic, swelling and easing, cars past now and then; it thins out once the fix starts
  const bed = lp(hp(brown(T, r), 110), 700);
  for (let i = 0; i < n; i++) { const t = i / SR; bed[i] *= (0.75 + 0.25 * Math.sin(t * 0.9)) * (t < wipe0 ? 1 : t < drop ? 1 - 0.6 * (t - wipe0) / (drop - wipe0) : 0.4) * (t > end ? Math.max(0, 1 - (t - end) / 1.2) : 1); }
  amb.add(0, bed, 0.09, -0.2); amb.add(0.013, bed, 0.09, 0.2);
  for (let t = 0.4; t < end - 1; t += 1.2 + r() * 1.8) amb.add(t, hp(car(1.6 + r(), r), 120), t < drop ? 0.2 : 0.06, r() * 1.6 - 0.8);
  // the hook: a honk on frame one, a couple more while the problem is laid out
  fx.add(0.02, horn(415, [0, 0.16, 0.24, 0.32], r), 0.32, 0.35);
  fx.add(4.6, horn(370, [0, 0.4], r), 0.16, -0.6);
  fx.add(7.4, horn(440, [0, 0.12, 0.2, 0.12], r), 0.14, 0.7);

  // a minor drone and a tick under the problem
  music.add(0, fade(pad([38, 45, 50, 53], wipe0 + 0.8), 1.2, 1.2), 0.5);
  for (let t = 0.5; t < wipe0; t += 0.5) music.add(t, env(bp(noise(0.05, r), () => 1500, 6), 0.001, 0.012), 0.45, (t * 2) % 2 ? 0.3 : -0.3);
  for (let t = 1; t < wipe0; t += 1) music.add(t, kick(0.6), 0.35);

  // captions and marks: a click as each one appears; a measuring pair for a dimension; a low thud for a ring
  for (const c of S.captions) fx.add(c.t0, click(r), 0.5);
  for (const m of S.marks) {
    if (m.kind === 'circle') fx.add(m.t0, kick(0.8), 0.45);
    else if (m.kind === 'dim') { fx.add(m.t0, blip(hz(81)), 0.12, 0.3); fx.add(m.t0 + 0.09, blip(hz(86)), 0.12, -0.3); }
    else fx.add(m.t0, blip(hz(79)), 0.14);
  }

  // the wipe: a whoosh across, a riser into the downbeat, then an impact
  if (S.wipe || S.beat !== undefined) {
    if (S.wipe) fx.add(wipe0, whoosh(0.9, r, 250, 5000), 0.6);
    fx.add(wipe0 + 0.2, whoosh(drop - wipe0 - 0.2, r, 400, 7000, true), 0.35);
    music.add(wipe0 + 0.3, fade(pad([62, 66, 69, 74], drop - wipe0 - 0.2), 0.8, 0.05), 0.18);
    fx.add(drop, kick(1.2), 0.7); fx.add(drop, env(lp(noise(1.2, r), 900), 0.002, 0.25), 0.25);
  }

  // What if: D major, 120 bpm, a chord every two bars from the downbeat to the end card
  const beat = 0.5, chords = [[50, 54, 57], [45, 52, 57], [47, 50, 54], [43, 50, 55]]; // D A Bm G
  for (let c = 0, t = drop; t < stop - 0.01; c++, t += 8 * beat) {
    const ch = chords[c % 4], len = Math.min(8 * beat, stop - t);
    music.add(t, pad(ch.map((m) => m + 12), len + 0.6), 0.3);
    music.add(t, env(tone(hz(ch[0] - 12), len, 0.2), 0.02, len * 0.6), 0.32);
    // plucked arpeggio in eighths: root, fifth, octave, third, …
    const arp = [ch[0] + 24, ch[2] + 24, ch[0] + 36, ch[1] + 24, ch[2] + 24, ch[1] + 36, ch[2] + 24, ch[1] + 24];
    for (let k = 0; k < 16 && t + k * beat / 2 < stop; k++) music.add(t + (k * beat) / 2, pluck(hz(arp[k % 8]), 0.6, r), 0.16, k % 2 ? 0.35 : -0.35);
  }
  for (let t = drop, k = 0; t < stop - 0.01; t += beat / 2, k++) {
    if (k % 2 === 0) music.add(t, kick(0.9), 0.4);
    music.add(t, shaker(r), k % 2 ? 0.16 : 0.08, 0.25);
    if (k % 4 === 2) music.add(t, env(bp(noise(0.18, r), () => 1800, 1.2), 0.002, 0.05), 0.2); // a clap on 2 and 4
  }

  // each step of the fix: a blip, one step further up the scale (a tweened step ticks up as it builds)
  const scale = [74, 76, 78, 81, 83, 86, 88];
  S.steps.forEach((s, i) => {
    const m = scale[Math.min(i, scale.length - 1)];
    // (a count-up ticks as many times as the model counts: its ticks climb an octave however many there are)
    const n = s.count ? Math.max(1, Math.round(measured[s.count] ?? 1)) : s.n ?? 1, up = (k: number) => (n > 8 ? Math.round((12 * k) / (n - 1)) : k);
    if (n > 1) for (let k = 0; k < n; k++) fx.add(s.t + (k * (s.dur ?? 1)) / (s.count ? n - 1 : n), blip(hz(m + up(k))), 0.1, -0.4 + (0.8 * k) / (n - 1));
    else fx.add(s.t, blip(hz(m)), 0.2);
    if (s.trees) for (let t = s.t; t < s.t + (s.dur ?? 1.5) + 1.8; t += 0.25 + r() * 0.45) fx.add(t, bird(r), 0.06, r() * 1.4 - 0.7);
  });

  // the split: a whoosh as the divider sweeps, a ding per number card (as draw.ts brings them in)
  if (S.split) {
    fx.add(S.split.t0 - 0.15, whoosh(0.7, r, 400, 6000), 0.35);
    S.split.stats.forEach((_, i) => fx.add(S.split!.t0 + 0.7 + i * 0.35, bell(hz(86 + [0, 4, 7][i % 3]), 1.2), 0.08));
  }
  // number cards (a plot's reveal): a ding each, as draw.ts brings them in
  S.cards?.stats.forEach((_, i) => fx.add(S.cards!.t0 + 0.7 + i * 0.35, bell(hz(86 + [0, 4, 7][i % 3]), 1.2), 0.08));
  // the sting: the beat cuts out on a low hit and a bell
  if (S.sting !== undefined) { fx.add(S.sting, kick(1.1), 0.5); fx.add(S.sting + 0.04, bell(hz(81), 2.2), 0.14); }

  // the end card: the ink comes in on a whoosh, the tonic rings, the mark pops with a bell, and it all fades
  fx.add(end - 0.2, whoosh(0.6, r, 300, 3000), 0.3);
  music.add(end, pad([62, 66, 69, 74, 78], T - end), 0.4);
  music.add(end, env(tone(hz(38), T - end, 0.2), 0.02, 1.5), 0.35);
  music.add(end, kick(1), 0.5);
  fx.add(end + 0.3, bell(hz(86)), 0.18, -0.2); fx.add(end + 0.75, bell(hz(93)), 0.12, 0.2);

  reverb(music, 0.22); reverb(fx, 0.3);
  const out = new Bus(n);
  // the voice: each line levelled to the same loudness, dead centre; the bed ducks about 10 dB under it (in 80 ms, out over 400 ms)
  const vo = new Bus(n), duck = new Float32Array(n);
  for (const { t, a } of voice) {
    // levelled by loudness, then its peaks held to 9 dB over that (plosives and stressed syllables jump 15–18 dB)
    const v = lp(hp(Float32Array.from(a), 90), 11000);
    let e = 0; for (const x of v) e += x * x;
    const rms = Math.sqrt(e / v.length || 1);
    limit([v], rms * 10 ** (9 / 20), 0.05, 0.003);
    vo.add(t, v, 0.28 / rms);
    for (let i = Math.round((t - 0.08) * SR), j = Math.round((t + a.length / SR) * SR); i < j; i++) if (i >= 0 && i < n) duck[i] = 1;
  }
  let d = 0;
  for (let i = 0; i < n; i++) { d += (duck[i] - d) * (duck[i] > d ? 1 / (0.08 * SR) : 1 / (0.4 * SR)); duck[i] = d; }
  for (let i = 0; i < n; i++) {
    const gm = 1 - 0.68 * duck[i], gf = 1 - 0.45 * duck[i];
    out.L[i] = amb.L[i] * 0.9 * gm + music.L[i] * gm + fx.L[i] * gf + vo.L[i];
    out.R[i] = amb.R[i] * 0.9 * gm + music.R[i] * gm + fx.R[i] * gf + vo.R[i];
  }
  if (voice.length) {
    // how far the voice sits over the bed while it speaks (8–12 dB reads clearly on a phone speaker)
    let ev = 0, eb = 0;
    for (let i = 0; i < n; i++) if (duck[i] > 0.9) { ev += vo.L[i] ** 2; eb += (out.L[i] - vo.L[i]) ** 2; }
    console.log(`voice over the bed: ${(10 * Math.log10(ev / (eb || 1))).toFixed(1)} dB`);
  }
  // master: set to -14 LUFS (where Reels, Shorts and YouTube play at) as a plain gain, then a clean look-ahead limit
  // at -2 dBFS (headroom for the AAC encode) for the peaks that pushes over (no clipping, no saturation), and a 1.5 s fade at the very end
  for (let i = 0; i < n; i++) { const f = Math.min(1, (n - i) / (1.5 * SR), i / 240); out.L[i] *= f; out.R[i] *= f; }
  for (let pass = 0; pass < 2; pass++) {
    const g = 10 ** ((-14 - lufs(out)) / 20);
    for (let i = 0; i < n; i++) { out.L[i] *= g; out.R[i] *= g; }
    limit([out.L, out.R], 10 ** (-2 / 20));
  }
  console.log(`master: ${lufs(out).toFixed(1)} LUFS`);
  return out;
}

function wav(b: Bus) {
  const n = b.L.length, d = Buffer.alloc(44 + n * 4);
  d.write('RIFF', 0); d.writeUInt32LE(36 + n * 4, 4); d.write('WAVE', 8); d.write('fmt ', 12); d.writeUInt32LE(16, 16);
  d.writeUInt16LE(1, 20); d.writeUInt16LE(2, 22); d.writeUInt32LE(SR, 24); d.writeUInt32LE(SR * 4, 28); d.writeUInt16LE(4, 32); d.writeUInt16LE(16, 34);
  d.write('data', 36); d.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { d.writeInt16LE(Math.round(Math.max(-1, Math.min(1, b.L[i])) * 32767), 44 + i * 4); d.writeInt16LE(Math.round(Math.max(-1, Math.min(1, b.R[i])) * 32767), 46 + i * 4); }
  return d;
}

const id = process.argv[2];
if (!id || !SCENES[id]) { console.error(`film-sound: no scene "${id}" (${Object.keys(SCENES).join(', ')})`); process.exit(1); }
const S = (await SCENES[id]()).default;
const file = path.resolve('film', 'out', `${id}.wav`);
fs.mkdirSync(path.dirname(file), { recursive: true });
// the BEFORE state's measured numbers (a count-up step ticks by one): film/out/<id>/done.json, once rendered
const before = (() => { try { return (JSON.parse(fs.readFileSync(path.resolve('film', 'out', id, 'done.json'), 'utf8')) as { values: { before: Record<string, number> } }).values.before; } catch { return {}; } })();
fs.writeFileSync(file, wav(score(S, process.argv.includes('--no-vo') ? [] : speak(S), before)));

/** The scene's voice-over lines as audio at 48 kHz, through Kokoro (film/tts/: see tools/film/README.md). */
function speak(S: Scene): { t: number; a: Float32Array }[] {
  if (!S.vo?.length) return [];
  const py = path.resolve('film', 'tts', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!fs.existsSync(py)) { console.warn('film-sound: no film/tts/.venv, so no voice-over (see tools/film/README.md)'); return []; }
  // the measured numbers, as the captions show them
  const done = JSON.parse(fs.readFileSync(path.resolve('film', 'out', S.id, 'done.json'), 'utf8')) as { values: Record<string, Record<string, number>> };
  const fill = (s: string) => s.replace(/\{(before|after)\.(\w+)(?::(\d))?\}/g, (_, w: string, k: string, dp?: string) => {
    const v = done.values[w]?.[k];
    if (v === undefined) throw new Error(`vo: no measured ${w}.${k}`);
    return dp !== undefined ? v.toFixed(Number(dp)) : String(Math.round(v * 10) / 10);
  });
  const dir = path.resolve('film', 'out', S.id, 'vo'), spec = path.join(dir, 'lines.json');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(spec, JSON.stringify({ voice: process.argv.find((a) => a.startsWith('--voice='))?.slice(8) ?? S.voice ?? 'bf_emma', lines: S.vo.map((l) => ({ text: fill(l.text), max: l.max })) }));
  const r = spawnSync(py, ['tools/film/tts.py', spec, dir], { stdio: ['ignore', 'inherit', 'pipe'] });
  if (r.status !== 0) throw new Error(`tts failed: ${String(r.stderr).slice(-400)}`);
  return S.vo.map((l, i) => ({ t: l.t, a: readWav(path.join(dir, `vo-${String(i).padStart(2, '0')}.wav`)) }));
}

/** a 16-bit mono WAV, resampled to 48 kHz (linear: speech is band-limited well under that) */
function readWav(file: string) {
  const b = fs.readFileSync(file);
  let p = 12, rate = 24000, data: Buffer | null = null;
  while (p < b.length - 8) { const id = b.toString('ascii', p, p + 4), len = b.readUInt32LE(p + 4); if (id === 'fmt ') rate = b.readUInt32LE(p + 12); if (id === 'data') data = b.subarray(p + 8, p + 8 + len); p += 8 + len + (len & 1); }
  if (!data) throw new Error(`${file}: no audio`);
  const m = data.length / 2, k = rate / SR, v = new Float32Array(Math.floor(m / k));
  for (let i = 0; i < v.length; i++) { const x = i * k, j = Math.floor(x), f = x - j; v[i] = ((1 - f) * data.readInt16LE(j * 2) + f * data.readInt16LE(Math.min(m - 1, j + 1) * 2)) / 32768; }
  return v;
}
console.log(`→ ${file}`);
