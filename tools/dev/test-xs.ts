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
console.log(ok ? 'ALL OK' : 'FAILURES'); process.exit(ok ? 0 : 1);
