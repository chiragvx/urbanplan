// Cross-section helper checks: npx esbuild tools/dev/test-xs.ts --bundle --platform=node --outfile=tools/dev/test-xs.mjs && node tools/dev/test-xs.mjs
import * as xs from '../../src/doc/xsection';
let ok = true;
const check = (c: boolean, m: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) ok = false; };
const lanes = (p: ReturnType<typeof xs.template>) => p.filter((q) => q.kind === 'lane');
const res = xs.template('residential'); // 1.2 + 3 + 3 + 1.2 = 8.4
let w = xs.setTotalWidth(res, 18);
check(Math.abs(xs.totalWidth(w) - 18) < 0.02, `residential → 18 m: ${xs.describe(w)}`);
check(lanes(w).every((l) => l.width >= 2.75 && l.width <= 4.2) && lanes(w).length === 4, `lanes realistic: ${lanes(w).map((l) => l.width)}`);
check(xs.laneCount(w).f === 2 && xs.laneCount(w).b === 2, 'stays two-way, balanced');
w = xs.setTotalWidth(xs.template('primary'), 12);
check(Math.abs(xs.totalWidth(w) - 12) < 0.02, `primary → 12 m: ${xs.describe(w)}`);
const ow = xs.makeOneway(xs.template('tertiary'), true);
w = xs.setTotalWidth(ow, 14);
check(xs.isOneway(w) && Math.abs(xs.totalWidth(w) - 14) < 0.02, `one-way → 14 m: ${xs.describe(w)}`);
w = xs.setTotalWidth(xs.template('service'), 7);
check(Math.abs(xs.totalWidth(w) - 7) < 0.02 && xs.laneCount(w).all === 2, `service lane → 7 m becomes two-way: ${xs.describe(w)}`);
w = xs.setTotalWidth(xs.template('secondary'), 6);
check(Math.abs(xs.totalWidth(w) - 6) < 0.05, `secondary squeezed to 6 m: ${xs.describe(w)} ${JSON.stringify(w.map((p) => p.width))}`);
const small = xs.setTotalWidth(res, 9.3);
check(lanes(small).length === 2, `small change keeps lane count: ${xs.describe(small)}`);
// ---- road model: width + features <-> cross-section ----
import * as rm from '../../src/assets/roadmodel';
const near = (a: number, b: number) => Math.abs(a - b) < 0.02;
let m = rm.match(18, { footpath: true, cycle: true }, 'pune');
check(m.variants.map((v) => v.code).join() === '18A,18B' && m.exact && m.label === '18A', `pune 18 m + footpaths + cycle → variants ${m.variants.map((v) => v.code)} (${m.label})`);
m = rm.match(18, { footpath: true, cycle: true }, 'pune', '18B');
check(m.template.code === '18B' && m.exact && m.tier === 'collector', `variant 18B picked, tier ${m.tier}`);
m = rm.match(19.5, { footpath: true, cycle: true }, 'pune');
check(near(xs.totalWidth(m.parts), 19.5) && !m.exact && m.label.startsWith('based on'), `pune 19.5 m stretched: ${m.label} ${xs.describe(m.parts)}`);
for (const w of [3, 6, 10.3, 24, 45, 200]) for (const std of ['irc', 'pune', 'mumbai'] as const) {
  const q = rm.match(w, { footpath: true }, std);
  if (!(q.parts.length && near(xs.totalWidth(q.parts), w))) check(false, `${std} ${w} m never empty and exact width: ${xs.totalWidth(q.parts)}`);
}
check(true, 'every width / standard gives a cross-section of that width');
m = rm.match(9, { footpath: true, median: true }, 'pune');
const f9 = rm.featuresOf(m.parts);
check(f9.median && f9.footpath && near(xs.totalWidth(m.parts), 9), `median at 9 m applied anyway: ${xs.describe(m.parts)}`);
check(m.flags.some((f) => f.feature === 'median' && f.need === 18), `…and flagged: ${m.flags.map((f) => f.text).join('; ')}`);
for (const f of rm.FEATURE_IDS) {
  const base = { footpath: true, [f]: true };
  const q = rm.match(30, base, 'irc');
  const got = rm.featuresOf(q.parts);
  check(rm.FEATURE_IDS.every((g) => got[g] === !!(base as Record<string, boolean>)[g]), `irc 30 m footpath+${f}: features read back ${JSON.stringify(got)}`);
  const off = rm.match(30, { footpath: true }, 'irc');
  check(!rm.featuresOf(off.parts)[f] || f === 'footpath', `irc 30 m without ${f}`);
}
let r = rm.read(rm.match(18, { footpath: true, cycle: true }, 'pune', '18B').parts, 'pune');
check(!r.custom && r.label === '18B' && near(r.width, 18) && r.features.cycle && r.tier === 'collector', `read 18B → ${r.width} m ${r.tier} ${r.label}`);
const imported = xs.setTotalWidth(xs.template('residential'), 10.3);
r = rm.read(imported, 'pune', 'residential');
check(r.custom && near(r.width, 10.3) && r.tier === 'local' && r.features.footpath, `imported 10.3 m → custom ${r.tier}`);
const mum = rm.allTemplates().find((t) => t.id === 'mumbai.major80')!;
r = rm.read(mum.parts, 'mumbai');
check(!r.custom && r.features.median && r.features.cycle && !r.features.service, `mumbai 80 ft read: ${r.label} ${JSON.stringify(r.features)}`);
const s36 = rm.allTemplates().find((t) => t.id === 'pune.36B')!;
check(s36.features.service && s36.features.median && s36.features.parking, `36B has service lanes: ${JSON.stringify(s36.features)}`);
const brt = rm.allTemplates().find((t) => t.id === 'pune.30 BRT')!;
check(brt.features.brt && !brt.features.service, `30 BRT: bus lanes, no service lanes`);
const id = rm.encode('pune', 19.5, { footpath: true, cycle: true });
const d = rm.decode(id)!;
check(d.std === 'pune' && d.width === 19.5 && d.features.cycle && !d.features.median && near(xs.totalWidth(rm.assetFor(id)!.profile.type === 'street' ? (rm.assetFor(id)!.profile as { parts: typeof imported }).parts : []), 19.5), `asset id round trip ${id}`);
check(rm.pickId('pune', 18, { footpath: true, cycle: true }, '18B') === 'pune.18B', 'exact pick stores the template id');
const ow1 = rm.match(12, { footpath: true, oneway: true }, 'irc');
check(xs.isOneway(ow1.parts) && near(xs.totalWidth(ow1.parts), 12), `one-way 12 m: ${xs.describe(ow1.parts)}`);
check(rm.rulerStops('mumbai')[3].label === '40 ft' && rm.rulerStops('pune').length === 12, 'ruler stops');
// every feature combination at every width in every standard: exact width, features read back, no negative parts
let fuzzBad = 0, fuzzN = 0;
for (let mask = 0; mask < 128; mask++) for (const fw of [4, 7.5, 12, 18, 24, 30, 45, 60, 90]) for (const std of ['irc', 'pune', 'mumbai'] as const) {
  const F = Object.fromEntries(rm.FEATURE_IDS.map((f, i) => [f, !!(mask & (1 << i))])) as rm.Features;
  const q = rm.match(fw, F, std), got = rm.featuresOf(q.parts);
  fuzzN++;
  if (!(near(xs.totalWidth(q.parts), fw) && rm.FEATURE_IDS.every((f) => got[f] === F[f]) && q.parts.every((p) => p.width > 0))) {
    if (!fuzzBad) console.log(`  first failure: ${std} ${fw} m ${JSON.stringify(F)} → ${JSON.stringify(got)}`);
    fuzzBad++;
  }
}
check(fuzzBad === 0, `feature combinations read back: ${fuzzBad} failures of ${fuzzN}`);
console.log(ok ? 'ALL OK' : 'FAILURES'); process.exit(ok ? 0 : 1);
