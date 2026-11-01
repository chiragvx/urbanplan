// Site Studio's paperwork: the area statement as the approval drawings carry it, the unit schedule (every flat, by
// building and floor), both as CSV for Excel, and the feasibility report to print or save as PDF: a cover with the
// 3D view, the site and its roads, the rules applied (with their clauses), the FSI worked out, the plans (site,
// typical floors, parking levels) drawn to scale, the buildings, the flats, the parking, the checks, the money with
// its cash flow and how it moves with the sale price and the cost, the other scheme, and what was assumed.
import type { PlotObj } from '../doc/types';
import { CODE_LABEL, CODE_NOTE, USE_NOTE, sideMargin, type PlotReport } from '../doc/plot';
import { buildingQuads, CARPET, circleRing, ELEMENTS, FIRE_H, FIRE_W, RG_FROM, RG_SHARE, roadFrame, solveSite, SQFT, TRAVEL, UNIT_COLOR, UNIT_LABEL, type SiteReport } from '../doc/site';
import { schemes, DEFAULT_DESIGN, ACCESS } from '../doc/optimise';
import { save } from './plotexport';

const n2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
const csv = (rows: (string | number)[][]) => '﻿' + rows.map((r) => r.map((c) => (typeof c === 'number' ? String(c) : /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n');
const slug = (o: PlotObj) => (o.name || 'plot').replace(/[^\w-]+/g, '-').toLowerCase();
const level = (k: string) => ({ stilt: 'Stilt', surface: 'Surface', podium: 'Podium', basement: 'Basement', structure: 'Car park level', lot: 'Parking lot' })[k] ?? k;
const bName = (i: number) => String.fromCharCode(65 + i);

/** The area statement's rows: label, m², note. */
function statement(r: PlotReport, d: SiteReport): [string, string, string][] {
  const P = r.parts, rows: [string, string, string][] = [
    ['Area of plot', n2(r.area), ''],
    ['Less: area under the DP road', n2(r.lost), r.road?.dp ? `${r.road.name}: ${n2(r.road.today)} m today, ${n2(r.road.dp)} m in the DP` : ''],
    ['Net plot area', n2(r.netArea), ''],
    ['Basic FSI (on the net plot)', n2(P.basic), ''],
    ['DP road handed over (FSI credit)', n2(P.credit), ''],
    ['Premium FSI', n2(P.premium), ''],
    ['TDR', n2(P.tdr), ''],
    ['Ancillary / fungible FSI', n2(P.ancillary), ''],
    ['Permissible built-up area', n2(r.bua), `FSI ${n2(r.bua / r.area)} on the gross plot`],
  ];
  d.buildings.forEach((b, i) => rows.push([`Proposed: building ${bName(i)}`, n2(b.plate * b.floors), `${n2(b.plate)} m² × ${b.floors} floors, ${n2(b.height)} m`]));
  rows.push(
    ['Total proposed built-up area', n2(d.bua), `FSI ${n2(d.fsi)}`],
    ['Balance built-up area', n2(d.left), d.left < 0 ? 'over' : ''],
    ['Ground coverage', n2(d.coverage * r.area), `${n2(d.coverage * 100)} %`],
    ['RERA carpet area', n2(d.carpet), `${Math.round(d.carpet * SQFT)} sq ft`],
    ['Recreational open space: required / open ground', `${n2(d.open.need)} / ${n2(d.open.have)}`, ''],
    ['Green: open space and gardens', n2(d.open.green), ''],
    ['Parking: car bays required / provided', `${d.parking.need} / ${d.parking.have}`, `${d.parking.cars} cars, ${d.parking.scooters} two-wheelers (four to a bay)${d.parking.trucks ? `, ${d.parking.trucks} loading bays` : ''}`],
  );
  for (const l of d.parking.levels) rows.push([`  ${level(l.kind)}`, String(l.bays.length), 'bays']);
  return rows;
}

export function areaStatement(o: PlotObj, r: PlotReport, d: SiteReport) {
  const rows: (string | number)[][] = [[`Area statement: ${o.name}`, '', ''], [CODE_LABEL[r.code], `${n2(r.roadW)} m road`, ''], [], ['Item', 'Area (m²)', 'Note'], ...statement(r, d)];
  save(`${slug(o)}-area-statement.csv`, csv(rows), 'text/csv');
}

export function unitSchedule(o: PlotObj, d: SiteReport) {
  const rows: (string | number)[][] = [['Building', 'Floor', 'Unit', 'Type', 'Carpet (m²)', 'Carpet (sq ft)']];
  d.buildings.forEach((b, i) => {
    const B = bName(i);
    for (let f = 1; f <= b.floors; f++) b.units.forEach((u, k) => rows.push([B, d.under + f, `${B}-${d.under + f}${String(k + 1).padStart(2, '0')}`, UNIT_LABEL[u.t], n2(u.carpet), Math.round(u.carpet * SQFT)]));
  });
  save(`${slug(o)}-unit-schedule.csv`, csv(rows), 'text/csv');
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const cr = (v: number) => `${v < 0 ? '−' : ''}₹${(Math.abs(v) / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} Cr`;
const m2 = (v: number) => `${Math.round(v).toLocaleString('en-IN')} m²`;
const pc = (v: number) => `${Math.round(v * 100)} %`;
const num = (v: number) => Math.round(v).toLocaleString('en-IN');

// ---------------- drawings ----------------

/** A plan drawn to scale with the road along the bottom: rings in, an SVG out. */
function planSvg(r: PlotReport, layers: { ring: number[]; fill?: string; stroke?: string; w?: number; dash?: string; op?: number; open?: boolean }[], labels: { x: number; z: number; t: string; dark?: boolean }[], opts: { width?: number; frame?: number[]; pad?: number; maxH?: number } = {}) {
  const F = roadFrame(r), R = F.toL(opts.frame ?? (r.net.length >= 6 ? r.net : r.footprint));
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (let i = 0; i < R.length; i += 2) { u0 = Math.min(u0, R[i]); u1 = Math.max(u1, R[i]); v0 = Math.min(v0, R[i + 1]); v1 = Math.max(v1, R[i + 1]); }
  const pad = opts.pad ?? Math.max(8, (u1 - u0) * 0.06);
  u0 -= pad; u1 += pad; v0 -= pad * 1.6; v1 += pad;
  // (u right, v up the page: the road at the bottom)
  const X = (u: number) => u - u0, Y = (v: number) => v1 - v;
  const pts = (ring: number[]) => { const L = F.toL(ring); const o: string[] = []; for (let i = 0; i < L.length; i += 2) o.push(`${X(L[i]).toFixed(2)},${Y(L[i + 1]).toFixed(2)}`); return o.join(' '); };
  const Wm = u1 - u0, Hm = v1 - v0, k = Wm / 100;
  const body = layers.filter((l) => l.ring.length >= 4).map((l) => `<${l.open ? 'polyline' : 'polygon'} points="${pts(l.ring)}" fill="${l.open ? 'none' : l.fill ?? 'none'}" ${l.op !== undefined ? `fill-opacity="${l.op}"` : ''} stroke="${l.stroke ?? 'none'}" stroke-width="${(l.w ?? 0.6) * k}" ${l.dash ? `stroke-dasharray="${l.dash.split(',').map((x) => +x * k).join(',')}"` : ''} stroke-linejoin="round"/>`).join('');
  const text = labels.map((t) => { const L = F.toL([t.x, t.z]); return `<text x="${X(L[0]).toFixed(1)}" y="${Y(L[1]).toFixed(1)}" font-size="${2.6 * k}" text-anchor="middle" dominant-baseline="middle" fill="${t.dark ? '#fff' : '#1c2333'}" font-weight="600">${esc(t.t)}</text>`; }).join('');
  // scale bar and north
  const bar = [10, 20, 50, 100, 200].find((m) => m > Wm * 0.15) ?? 200;
  // world north is −z: on the page it points (−uz) right and (−vz) up
  const ang = (Math.atan2(-F.uz, -F.vz) * 180) / Math.PI;
  const deco = `<g transform="translate(${2 * k},${Hm - 3 * k})"><rect width="${bar}" height="${0.8 * k}" fill="#1c2333"/><text y="${-1.2 * k}" font-size="${2.4 * k}" fill="#1c2333">${bar} m</text></g>
<g transform="translate(${Wm - 6 * k},${6 * k}) rotate(${ang.toFixed(1)})"><path d="M0,${-4 * k} L${1.6 * k},${2 * k} L0,${1 * k} L${-1.6 * k},${2 * k}Z" fill="#1c2333"/><text y="${-5 * k}" font-size="${2.4 * k}" text-anchor="middle" fill="#1c2333">N</text></g>`;
  return `<svg viewBox="0 0 ${Wm.toFixed(1)} ${Hm.toFixed(1)}" width="${opts.width ?? 100}%" style="max-height:${opts.maxH ?? 560}px" xmlns="http://www.w3.org/2000/svg" style="background:#fbfaf7">${body}${text}${deco}</svg>`;
}

function sitePlan(o: PlotObj, r: PlotReport, d: SiteReport) {
  const G = d.ground, L: Parameters<typeof planSvg>[1] = [];
  L.push({ ring: o.ring, fill: '#ffffff', stroke: '#2f5bff', w: 0.5, dash: '2,1.5' });
  for (const q of r.lostRings) L.push({ ring: q, fill: '#e5484d', op: 0.18, stroke: '#e5484d', w: 0.3 });
  if (d.envelope.length >= 6) L.push({ ring: d.envelope, stroke: '#2f5bff', w: 0.3, dash: '1,1' });
  if (G.rg) L.push({ ring: G.rg, fill: '#86b46a', op: 0.55 });
  for (const g of G.gardens) L.push({ ring: g, fill: '#86b46a', op: 0.55 });
  for (const line of G.drive) for (let i = 0; i + 3 < line.length; i += 2) L.push({ ring: [line[i], line[i + 1], line[i + 2], line[i + 3]], stroke: '#9aa0a8', w: G.driveW, open: true });
  for (const x of G.roads) L.push({ ring: x.pts, stroke: '#9aa0a8', w: x.w, open: true });
  for (const [x, z, rad] of G.circles) L.push({ ring: circleRing({ id: '', spine: [x - rad, z, x + rad, z], depth: rad * 2, floors: 0 }, 28), fill: '#9aa0a8' });
  for (const l of d.parking.levels) if (l.kind === 'surface' || l.kind === 'lot') for (const b of l.bays) L.push({ ring: b, stroke: '#9aa0a8', w: 0.15 });
  for (const e of d.site.elements ?? []) if (e.kind === 'parking') for (const q of buildingQuads(e)) L.push({ ring: q, fill: '#c3c7cf', stroke: '#1c2333', w: 0.35 });
  for (const w of G.wall) L.push({ ring: w, stroke: '#1c2333', w: 0.6, open: true });
  for (const g of G.gates) L.push({ ring: g, stroke: '#e08a00', w: 0.8, open: true });
  for (const b of d.buildings) for (const q of b.quads) L.push({ ring: q, fill: '#1c2333', op: 0.86, stroke: '#1c2333', w: 0.4 });
  const labels = d.buildings.map((b, i) => { const q = b.quads[0]; let x = 0, z = 0; for (let k = 0; k < q.length; k += 2) { x += q[k]; z += q[k + 1]; } return { x: x / (q.length / 2), z: z / (q.length / 2), t: `${bName(i)} · ${b.floors + d.under} fl`, dark: true }; });
  for (const e of d.site.elements ?? []) if (e.kind === 'parking') { const q = buildingQuads(e)[0]; labels.push({ x: (q[0] + q[4]) / 2, z: (q[1] + q[5]) / 2, t: `P · ${e.levels ?? 3}`, dark: false }); }
  return planSvg(r, L, labels);
}

function floorPlan(r: PlotReport, d: SiteReport, i: number) {
  const b = d.buildings[i], L: Parameters<typeof planSvg>[1] = [];
  for (const q of b.quads) L.push({ ring: q, fill: '#ffffff', stroke: '#1c2333', w: 0.5 });
  for (const u of b.units) L.push({ ring: u.ring, fill: UNIT_COLOR[u.t], op: 0.85, stroke: '#ffffff', w: 0.25 });
  for (const c of b.corridors) L.push({ ring: c, fill: '#d9dce3' });
  for (const c of b.cores) L.push({ ring: c, fill: '#6b7280' });
  const labels = b.units.map((u) => { let x = 0, z = 0; for (let k = 0; k < u.ring.length; k += 2) { x += u.ring[k]; z += u.ring[k + 1]; } return { x: x / (u.ring.length / 2), z: z / (u.ring.length / 2), t: `${UNIT_LABEL[u.t]} ${Math.round(u.carpet)}` }; });
  return planSvg(r, L, labels, { frame: b.quads.flat(), pad: 3, maxH: 300 });
}

function parkingPlan(r: PlotReport, d: SiteReport, li: number) {
  const l = d.parking.levels[li], L: Parameters<typeof planSvg>[1] = [];
  L.push({ ring: r.net, fill: '#ffffff', stroke: '#9aa0a8', w: 0.3, dash: '1,1' });
  for (const b of d.buildings) for (const q of b.quads) L.push({ ring: q, stroke: '#1c2333', w: 0.3, dash: '0.8,0.8' });
  for (const bay of l.bays) L.push({ ring: bay, fill: '#2f5bff', op: 0.14, stroke: '#2f5bff', w: 0.15 });
  if (l.ramp) L.push({ ring: l.ramp, fill: '#f5a524', op: 0.8 });
  return planSvg(r, L, [], { maxH: 300 });
}


/** Cumulative cash, month by month: one line, the zero line, a crosshair with the month's figure on hover. */
function cashChart(cum: number[]) {
  const W = 640, H = 200, pl = 56, pr = 12, pt = 12, pb = 26;
  const lo = Math.min(0, ...cum), hi = Math.max(0, ...cum), n = cum.length;
  const x = (i: number) => pl + ((W - pl - pr) * i) / Math.max(1, n - 1), y = (v: number) => pt + ((H - pt - pb) * (hi - v)) / (hi - lo || 1);
  // round steps, none crowding another
  const span = hi - lo || 1, step = [1, 2, 5].map((m) => m * 10 ** Math.floor(Math.log10(span / 4))).find((st) => span / st <= 6) ?? 10 ** Math.ceil(Math.log10(span / 4));
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-6; v += step) ticks.push(v);
  const path = cum.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const xt = Array.from({ length: Math.floor((n - 1) / 6) + 1 }, (_, k) => k * 6);
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" width="100%" data-cum='${JSON.stringify(cum.map((v) => Math.round(v)))}' data-geo='${JSON.stringify({ W, H, pl, pr, pt, pb, lo, hi })}'>
${ticks.map((v) => `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? '#9aa0a8' : '#eef0f3'}" stroke-width="1"/><text x="${pl - 6}" y="${y(v) + 3}" font-size="10" text-anchor="end" fill="#667">${esc(cr(v))}</text>`).join('')}
${xt.map((m) => `<text x="${x(m)}" y="${H - 8}" font-size="10" text-anchor="middle" fill="#667">${m}</text>`).join('')}
<path d="${path}" fill="none" stroke="#2f5bff" stroke-width="2" stroke-linejoin="round"/>
<line class="xh" y1="${pt}" y2="${H - pb}" stroke="#1c2333" stroke-width="1" visibility="hidden"/><circle class="dot" r="4" fill="#2f5bff" stroke="#fff" stroke-width="2" visibility="hidden"/>
<rect x="${pl}" y="${pt}" width="${W - pl - pr}" height="${H - pt - pb}" fill="transparent" class="hit"/></svg><div class="tip" hidden></div><small class="muted">Month</small></div>`;
}

// ---------------- the report ----------------

/** The full feasibility report, opened to print (or save as PDF). `shot`: the 3D view as an image. */
export function printReport(o: PlotObj, r: PlotReport, d: SiteReport, plan: HTMLCanvasElement | null, shot?: string | null) {
  const w = window.open('', '_blank');
  if (!w) return;
  const M = d.money, R = r.rules, use = o.use;
  const res = use === 'residential', unitWord = res ? 'flats' : use === 'industrial' ? 'shed floors' : 'offices';
  const passes = (x: boolean) => `<span class="${x ? 'ok' : 'bad'}">${x ? '✓ Meets' : '! Fails'}</span>`;
  const tallest = Math.max(0, ...d.buildings.map((b) => b.height));
  const side = sideMargin(R, tallest);
  const tiles: [string, string, string][] = [
    ['Built-up area', m2(d.bua), `${pc(d.bua / (r.bua || 1))} of the ${m2(r.bua)} allowed`],
    ['FSI', n2(d.fsi), `of ${n2(r.bua / r.area)} permissible`],
    [res ? 'Flats' : use === 'industrial' ? 'Shed floors' : 'Offices', num(d.flats), `${num(d.carpet * SQFT)} ft² saleable`],
    ['Height', `${n2(d.height)} m`, `${Math.max(0, ...d.buildings.map((b) => b.floors)) + d.under} floors · limit ${n2(R.maxH)} m`],
    ['Parking', `${d.parking.have} / ${d.parking.need}`, 'bays provided / required'],
    ['Profit', cr(M.profit), `${pc(M.margin)} of sales`],
    ['IRR', M.irr === null ? '–' : pc(M.irr), `${cr(M.peak)} peak funding`],
    ['Payback', M.payback === null ? 'never' : `month ${M.payback}`, `${M.costs.months} months to build`],
  ];
  const checks: [string, string, string, boolean][] = [
    ['FSI', `≤ ${m2(r.bua)}`, m2(d.bua), !d.over.fsi],
    ['Height', `≤ ${n2(R.maxH)} m`, `${n2(d.height)} m`, !d.over.height],
    ['Front margin', `${n2(R.front)} m from the road line`, d.over.margins ? 'a building is past it' : 'kept', !d.over.margins],
    ['Side and rear margins', `${n2(side)} m at ${n2(tallest)} m (H/5 above ${R.sideTo} m)`, d.over.margins ? 'a building is past them' : 'kept', !d.over.margins],
    ['Distance between buildings', 'the taller one’s side margin, at least 6 m above 15 m', d.over.overlap ? 'buildings run into each other' : 'kept', !d.over.overlap],
    ['Fire tender access (NBC 2016 Part 4)', `${FIRE_W} m clear round buildings over ${FIRE_H} m`, d.buildings.filter((b) => b.fire.length).length ? `${d.buildings.filter((b) => b.fire.length && b.fireOk).length} of ${d.buildings.filter((b) => b.fire.length).length} clear` : 'no building over 15 m', !d.over.fire],
    ['Escape distance (NBC 2016 Part 4)', `≤ ${TRAVEL} m to a stair`, `cores ≤ ${2 * TRAVEL} m apart`, true],
    ['Recreational open space (UDCPR 3.5.1)', d.open.need ? m2(d.open.need) : `none under ${m2(RG_FROM)}`, m2(d.open.have), !d.over.open],
    ['Parking (UDCPR Table 8-B)', `${d.parking.need} bays`, `${d.parking.have} bays`, d.parking.have >= d.parking.need],
  ];
  const mixRows = res ? [0, 1, 2].map((t) => {
    const units = d.buildings.flatMap((b) => b.units.filter((u) => u.t === t).map((u) => ({ c: u.carpet, n: b.floors })));
    const count = d.count[t], carpet = units.reduce((a, u) => a + u.c * u.n, 0);
    return [UNIT_LABEL[t], num(count), d.flats ? pc(count / d.flats) : '–', count ? m2(carpet / count) : '–', m2(carpet), num(carpet * SQFT)];
  }) : [[res ? '' : use === 'industrial' ? 'Shed floor' : 'Office', num(d.count[3]), '100 %', d.count[3] ? m2(d.carpet / d.count[3]) : '–', m2(d.carpet), num(d.carpet * SQFT)]];
  // the money as the sale price and the building cost move
  const sens = [0.9, 1, 1.1].map((ks) => [0.9, 1, 1.1].map((kb) => {
    const x = solveSite(r, { ...d.site, cost: { ...d.site.cost, sale: M.costs.sale * ks, build: M.costs.build * kb } }, use).money;
    return x;
  }));
  // the other scheme the optimiser offers
  let alt = '';
  try {
    const list = schemes(r, { ...(d.site.design ?? DEFAULT_DESIGN), type: 'auto' }, use, d.under, d.site);
    alt = list.map((s, i) => `<tr><td>${i === 0 ? '<b>Most built-up</b>' : 'Alternative'}: ${s.type === 'tower' ? 'towers' : use === 'industrial' ? 'sheds' : 'slabs'}</td><td class="n">${s.buildings.length}</td><td class="n">${s.floors}</td><td class="n">${m2(s.bua)}</td><td class="n">${n2(s.bua / r.area)}</td><td class="n">${pc(s.bua / (r.bua || 1))}</td></tr>`).join('');
  } catch { /* (a plot the optimiser can't plan) */ }
  const design = d.site.design ?? DEFAULT_DESIGN;
  const access = ACCESS.find((a) => a.value === (design.access ?? 'perimeter'))!;
  const els = (d.site.elements ?? []).filter((e) => !e.auto);
  const summary = `On this ${m2(r.area)} plot${r.road ? ` entered from ${esc(r.road.name)} (${n2(r.road.today)} m today${r.road.dp ? `, ${n2(r.road.dp)} m in the DP` : ''})` : ''}, ${esc(CODE_LABEL[r.code])} allows an FSI of ${n2(r.bua / r.area)}: ${m2(r.bua)} of built-up area${r.limit ? `, of which the ${r.limit === 'height' ? 'height limit' : 'side margins'} hold back some` : ''}. The scheme lays out ${d.buildings.length} building${d.buildings.length === 1 ? '' : 's'} of up to ${Math.max(0, ...d.buildings.map((b) => b.floors)) + d.under} floors (${n2(d.height)} m) with ${num(d.flats)} ${unitWord}, building ${pc(d.bua / (r.bua || 1))} of what is allowed, with ${d.parking.have} parking bays for the ${d.parking.need} required. At the rates assumed it sells for ${cr(M.revenue)} against ${cr(M.cost)} of cost, ${cr(M.profit)} of profit (${pc(M.margin)})${M.irr !== null ? `, an IRR of ${pc(M.irr)} a year` : ''}. ${checks.every((c) => c[3]) ? 'Every check below is met.' : `It fails: ${checks.filter((c) => !c[3]).map((c) => c[0].toLowerCase()).join(', ')}.`}`;

  const cost = [
    ['Land', M.land, `${num(r.area * SQFT)} ft² at ₹${num(M.costs.land)}/ft²`],
    ['Premium FSI', M.premium, `${M.costs.premiumPct} % of ready reckoner (₹${num(M.costs.asr)}/ft²)`],
    ['TDR', M.tdr, `${M.costs.tdrPct} % of ready reckoner`],
    ['Ancillary / fungible FSI', M.ancillary, `${M.costs.ancillaryPct} % of ready reckoner`],
    ['Construction', M.build, `${num(d.bua * SQFT)} ft² at ₹${num(M.costs.build)}/ft²`],
    ['Parking structure', M.parking, `₹${num(M.costs.parking)}/ft² of basement, podium and car park`],
    ['Soft costs', M.soft, `${M.costs.soft} % of construction`],
  ] as [string, number, string][];

  const floorPlans = d.buildings.slice(0, 6).map((b, i) => `<figure><figcaption>Building ${bName(i)}: typical floor · ${m2(b.plate)} · ${b.perFloor.reduce((a, x) => a + x, 0)} ${unitWord} a floor · ${b.cores.length} core${b.cores.length === 1 ? '' : 's'}</figcaption>${floorPlan(r, d, i)}</figure>`).join('');
  const parkPlans = d.parking.levels.map((l, i) => [l, i] as const).filter(([l]) => l.kind !== 'stilt' && l.bays.length).slice(0, 2).map(([l, i]) => `<figure><figcaption>${level(l.kind)}: ${l.bays.length} bays${l.ramp ? ' · ramp in orange' : ''}</figcaption>${parkingPlan(r, d, i)}</figure>`).join('');

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(o.name)}: feasibility report</title><style>
:root{--ink:#1c2333;--muted:#667085;--line:#e4e6eb;--accent:#2f5bff}
*{box-sizing:border-box}body{font:12.5px/1.5 Inter,system-ui,sans-serif;color:var(--ink);margin:0;background:#f4f4f2}
.page{background:#fff;max-width:960px;margin:20px auto;padding:36px 44px;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{font-size:28px;margin:0 0 4px;letter-spacing:-.01em}h2{font-size:17px;margin:0 0 12px;padding-bottom:6px;border-bottom:2px solid var(--ink)}h3{font-size:13px;margin:18px 0 6px}
.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:11px;color:var(--accent);font-weight:700}.sub{color:var(--muted);margin:0 0 16px}
.hero{width:100%;border-radius:6px;display:block;margin:12px 0;border:1px solid var(--line)}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}.tiles div{border:1px solid var(--line);border-radius:6px;padding:9px 11px}
.tiles small{display:block;color:var(--muted);font-size:10.5px;text-transform:uppercase;letter-spacing:.05em}.tiles b{font-size:19px;display:block;margin:1px 0}.tiles em{font-style:normal;color:var(--muted);font-size:11px}
table{width:100%;border-collapse:collapse;margin:4px 0 8px}th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600;border-bottom:1px solid var(--ink);padding:5px 6px}
td{padding:5px 6px;border-bottom:1px solid #eef0f3;vertical-align:top}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}tr.tot td{font-weight:700;border-top:1px solid var(--ink)}
small.note,.muted{color:var(--muted)}.ok{color:#1e7a3c;font-weight:600}.bad{color:#b42318;font-weight:600}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:24px}figure{margin:0 0 14px}figcaption{font-weight:600;margin-bottom:4px;font-size:12px}
svg{display:block;border:1px solid var(--line);border-radius:4px}.chart{position:relative}.chart svg{border:none}.tip{position:absolute;background:var(--ink);color:#fff;padding:4px 8px;border-radius:4px;font-size:11px;pointer-events:none;white-space:nowrap}
.legend span{display:inline-flex;align-items:center;gap:5px;margin-right:12px;font-size:11.5px}.legend i{width:10px;height:10px;border-radius:2px;display:inline-block}
.sens td{text-align:right}.sens td.base{background:#eef2ff;font-weight:700}
footer{color:var(--muted);font-size:10.5px;margin-top:14px}
.print{position:fixed;top:12px;right:16px;background:var(--accent);color:#fff;border:0;border-radius:6px;padding:8px 14px;font:600 13px Inter,system-ui;cursor:pointer}
@media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none;padding:10mm 12mm;page-break-after:always;border-radius:0}.print{display:none}.page:last-child{page-break-after:auto}}
</style></head><body><button class="print" onclick="print()">Print / save as PDF</button>

<section class="page">
<div class="eyebrow">Feasibility report · Site Studio</div>
<h1>${esc(o.name)}</h1>
<p class="sub">${esc(CODE_LABEL[r.code])} · ${esc(use[0].toUpperCase() + use.slice(1))} · ${m2(r.area)} · ${n2(r.roadW)} m road basis${r.road ? ` (${esc(r.road.name)})` : ''} · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
${shot ? `<img class="hero" src="${shot}" alt="The scheme in 3D">` : plan ? `<img class="hero" src="${plan.toDataURL('image/png')}" alt="Site plan">` : ''}
<div class="tiles">${tiles.map(([k, v, e]) => `<div><small>${k}</small><b>${esc(v)}</b><em>${esc(e)}</em></div>`).join('')}</div>
<h3>Summary</h3><p>${summary}</p>
</section>

<section class="page">
<h2>1 · The site and its roads</h2>
<div class="cols"><div><table>
<tr><td>Plot area</td><td class="n">${m2(r.area)}</td></tr>
<tr><td>Under the DP road (handed over)</td><td class="n">${m2(r.lost)}</td></tr>
<tr><td>Net plot</td><td class="n">${m2(r.netArea)}</td></tr>
<tr><td>Road width the FSI goes by</td><td class="n">${n2(r.roadW)} m (${o.basis === 'today' ? 'as built' : r.road?.dp ? 'DP width' : 'as built'})</td></tr>
<tr><td>Regulations</td><td class="n">${esc(CODE_LABEL[r.code])}</td></tr>
<tr><td>Use</td><td class="n">${esc(use)}</td></tr>
</table></div><div>
<table><tr><th>Road</th><th class="n">Today</th><th class="n">DP</th><th>Entry</th><th>What-if</th></tr>
${r.roads.map((x) => `<tr><td>${esc(x.name)}</td><td class="n">${n2(x.today)} m</td><td class="n">${x.dp ? `${n2(x.dp)} m` : '–'}</td><td>${x.entry ? 'entry' : ''}</td><td>${x.edited ? '<span class="bad">widened in the study</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No road found along the plot</td></tr>'}
</table><small class="note">Gates: ${d.ground.gates.length} · internal roads: ${esc(access.label.toLowerCase())}${design.roundabouts ? ', with roundabouts' : ''}.</small></div></div>
<h3>Site plan</h3>
${sitePlan(o, r, d)}
<div class="legend" style="margin-top:6px"><span><i style="background:#1c2333"></i>Buildings</span><span><i style="background:#9aa0a8"></i>Drive, roads, bays</span><span><i style="background:#86b46a"></i>Open space, gardens</span><span><i style="background:#e5484d;opacity:.4"></i>DP road strip</span><span><i style="border:1px dashed #2f5bff"></i>Building envelope</span><span><i style="background:#e08a00"></i>Gates</span></div>
</section>

<section class="page">
<h2>2 · Rules applied</h2>
<table><tr><th>Rule</th><th class="n">Value</th><th>Source</th></tr>
<tr><td>Basic FSI</td><td class="n">${n2(R.basic)}</td><td>${r.code === 'udcpr' ? (o.congested ? 'UDCPR Table 6-A (congested)' : 'UDCPR Table 6-G') : 'DCPR 2034 Table 12'}</td></tr>
<tr><td>Premium FSI (paid)</td><td class="n">${n2(R.premium)}</td><td>by road width</td></tr>
<tr><td>TDR loadable</td><td class="n">${n2(R.tdr)}</td><td>by road width</td></tr>
<tr><td>Ancillary / fungible FSI</td><td class="n">${pc(R.ancillary)}</td><td>${r.code === 'udcpr' ? 'UDCPR 6.3' : 'DCPR 2034 Reg. 31(3)'}</td></tr>
<tr><td>Front margin</td><td class="n">${n2(R.front)} m</td><td>${r.code === 'udcpr' ? 'UDCPR Table 6-D (road width)' : 'placeholder (UDCPR)'}</td></tr>
<tr><td>Side and rear margins</td><td class="n">${n2(R.side)} m to ${R.sideTo} m, then H/5 (≤ 12 m)</td><td>UDCPR 6.4</td></tr>
<tr><td>Floor-to-floor height</td><td class="n">${n2(R.floorH)} m</td><td>assumed</td></tr>
<tr><td>Height limit</td><td class="n">${n2(R.maxH)} m</td><td>assumed (fire / aviation clearances vary)</td></tr>
<tr><td>Fire tender access</td><td class="n">${FIRE_W} m above ${FIRE_H} m</td><td>NBC 2016 Part 4</td></tr>
<tr><td>Travel distance to a stair</td><td class="n">${TRAVEL} m</td><td>NBC 2016 Part 4</td></tr>
<tr><td>Recreational open space</td><td class="n">${pc(RG_SHARE)} from ${m2(RG_FROM)}</td><td>UDCPR 3.5.1</td></tr>
<tr><td>Parking</td><td class="n">${res ? 'by flat size + 5 % visitors' : use === 'industrial' ? '1 car / 300 m², 1 loading bay / 1,000 m²' : '1 car / 100 m² carpet'}</td><td>UDCPR Table 8-B</td></tr>
</table>
<small class="note">${esc(CODE_NOTE[r.code])}${use !== 'residential' ? ' ' + esc(USE_NOTE[use]) : ''}</small>
<h3>Area statement (FSI worked out)</h3>
<table><tr><th>Item</th><th class="n">m²</th><th>Note</th></tr>${statement(r, d).map(([a, b, c]) => `<tr><td>${esc(a)}</td><td class="n">${esc(b)}</td><td class="muted">${esc(c)}</td></tr>`).join('')}</table>
</section>

<section class="page">
<h2>3 · The buildings</h2>
<table><tr><th>Building</th><th class="n">Plate</th><th class="n">Floors</th><th class="n">Height</th><th class="n">${unitWord[0].toUpperCase() + unitWord.slice(1)} / floor</th><th class="n">${unitWord[0].toUpperCase() + unitWord.slice(1)}</th><th class="n">Cores</th><th class="n">Built-up</th><th>Status</th></tr>
${d.buildings.map((b, i) => { const pf = b.perFloor.reduce((a, x) => a + x, 0); return `<tr><td>${bName(i)} · ${b.b.depth} m deep</td><td class="n">${m2(b.plate)}</td><td class="n">${b.floors}${d.under ? ` + ${d.under}` : ''}</td><td class="n">${n2(b.height)} m</td><td class="n">${pf}</td><td class="n">${pf * b.floors}</td><td class="n">${b.cores.length}</td><td class="n">${m2(b.plate * b.floors)}</td><td>${b.clash ? `<span class="bad">${b.clash === 'margins' ? 'past the margins' : 'overlaps'}</span>` : b.fire.length && !b.fireOk ? '<span class="bad">fire access blocked</span>' : '<span class="ok">✓</span>'}</td></tr>`; }).join('')}
<tr class="tot"><td>Total</td><td class="n">${m2(d.buildings.reduce((a, b) => a + b.plate, 0))}</td><td></td><td class="n">${n2(d.height)} m</td><td></td><td class="n">${num(d.flats)}</td><td class="n">${d.buildings.reduce((a, b) => a + b.cores.length, 0)}</td><td class="n">${m2(d.bua)}</td><td></td></tr></table>
${els.length ? `<h3>Placed on the site</h3><table><tr><th>Element</th><th class="n">Size</th><th>Note</th></tr>${els.map((e) => { const m = ELEMENTS.find((x) => x.value === e.kind)!; const len = Math.hypot(e.spine[2] - e.spine[0], e.spine[3] - e.spine[1]); return `<tr><td>${m.label}</td><td class="n">${e.kind === 'roundabout' ? `${n2(e.depth)} m across` : e.kind === 'road' ? `${n2(e.depth)} m wide` : `${Math.round(len)} × ${Math.round(e.depth)} m`}</td><td class="muted">${e.kind === 'parking' ? `${e.levels ?? 3} levels` : ''}</td></tr>`; }).join('')}</table>` : ''}
<h3>Typical floors</h3>
<div class="cols">${floorPlans}</div>
<div class="legend">${(res ? [0, 1, 2] : [3]).map((t) => `<span><i style="background:${UNIT_COLOR[t]}"></i>${UNIT_LABEL[t]}</span>`).join('')}<span><i style="background:#6b7280"></i>Core (lifts, stairs)</span><span><i style="background:#d9dce3"></i>Corridor</span></div>
</section>

<section class="page">
<h2>4 · ${res ? 'Flats' : 'Units'} and parking</h2>
<table><tr><th>Type</th><th class="n">Count</th><th class="n">Share</th><th class="n">Average carpet</th><th class="n">Carpet</th><th class="n">ft²</th></tr>
${mixRows.map((row) => `<tr>${row.map((c, i) => `<td${i ? ' class="n"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}
<tr class="tot"><td>Total</td><td class="n">${num(d.flats)}</td><td class="n">100 %</td><td class="n">${d.flats ? m2(d.carpet / d.flats) : '–'}</td><td class="n">${m2(d.carpet)}</td><td class="n">${num(d.carpet * SQFT)}</td></tr></table>
<small class="note">RERA carpet taken as ${pc(CARPET)} of a ${res ? 'flat' : 'unit'}'s built-up area (walls, ducts, the balcony's share). The schedule of every unit is in the unit schedule CSV.</small>
<h3>Parking: required</h3>
<table><tr><td>Cars${res ? ', by flat size' : ''}, with 5 % for visitors</td><td class="n">${num(d.parking.cars)}</td></tr>
<tr><td>Two-wheelers (four to a car bay)</td><td class="n">${num(d.parking.scooters)} → ${Math.ceil(d.parking.scooters / 4)} bays</td></tr>
${d.parking.trucks ? `<tr><td>Loading bays (each the room of three cars)</td><td class="n">${d.parking.trucks} → ${d.parking.trucks * 3} bays</td></tr>` : ''}
<tr class="tot"><td>Car bays required</td><td class="n">${d.parking.need}</td></tr></table>
<h3>Parking: provided</h3>
<table><tr><th>Level</th><th class="n">Bays</th><th class="n">Area</th></tr>${d.parking.levels.map((l) => `<tr><td>${level(l.kind)}</td><td class="n">${l.bays.length}</td><td class="n">${m2(l.area)}</td></tr>`).join('')}<tr class="tot"><td>Total</td><td class="n">${d.parking.have}</td><td></td></tr></table>
<div class="cols">${parkPlans}</div>
</section>

<section class="page">
<h2>5 · Compliance</h2>
<table><tr><th>Check</th><th>Required</th><th>Provided</th><th>Status</th></tr>
${checks.map(([k, a, b, ok]) => `<tr><td>${esc(k)}</td><td>${esc(a)}</td><td>${esc(b)}</td><td>${passes(ok)}</td></tr>`).join('')}</table>
<h3>Schemes compared</h3>
<table><tr><th>Scheme</th><th class="n">Buildings</th><th class="n">Floors</th><th class="n">Built-up</th><th class="n">FSI</th><th class="n">Of allowed</th></tr>${alt || '<tr><td colspan="6" class="muted">–</td></tr>'}</table>
<small class="note">The optimiser's best layouts on this plot with the same settings (internal roads: ${esc(access.label.toLowerCase())}${design.spacing ? `, ${design.spacing} m extra spacing` : ''}${design.green ? `, ${design.green} % green` : ''}). ${d.site.manual ? 'The scheme in this report was shaped by hand.' : 'The scheme in this report is the most built-up one.'}</small>
</section>

<section class="page">
<h2>6 · Costs and returns</h2>
<div class="cols"><div><table><tr><th>Cost</th><th class="n">₹</th><th>Basis</th></tr>
${cost.map(([k, v, b]) => `<tr><td>${k}</td><td class="n">${cr(v)}</td><td class="muted">${esc(b)}</td></tr>`).join('')}
<tr class="tot"><td>Total cost</td><td class="n">${cr(M.cost)}</td><td></td></tr>
<tr><td>Sales</td><td class="n">${cr(M.revenue)}</td><td class="muted">${num(d.carpet * SQFT)} ft² carpet at ₹${num(M.costs.sale)}/ft²</td></tr>
<tr class="tot"><td>Profit</td><td class="n">${cr(M.profit)}</td><td>${pc(M.margin)} of sales</td></tr></table></div>
<div><table><tr><td>IRR, a year</td><td class="n">${M.irr === null ? '–' : pc(M.irr)}</td></tr>
<tr><td>Peak funding (most cash in at once)</td><td class="n">${cr(M.peak)}</td></tr>
<tr><td>Pays back</td><td class="n">${M.payback === null ? 'never' : `month ${M.payback}`}</td></tr>
<tr><td>Build period</td><td class="n">${M.costs.months} months</td></tr>
<tr><td>Sold before completion</td><td class="n">${M.costs.presold} %</td></tr>
<tr><td>Cost a ft² of carpet</td><td class="n">₹${num(M.cost / (d.carpet * SQFT || 1))}</td></tr></table></div></div>
<h3>Cumulative cash, month by month</h3>
${cashChart(M.cum)}
<h3>Profit as the sale price and the building cost move</h3>
<table class="sens"><tr><th>Sale price ↓ · build cost →</th><th class="n">−10 %</th><th class="n">as assumed</th><th class="n">+10 %</th></tr>
${sens.map((row, i) => `<tr><td style="text-align:left">${['−10 %', 'as assumed', '+10 %'][i]} (₹${num(M.costs.sale * [0.9, 1, 1.1][i])}/ft²)</td>${row.map((x, j) => `<td class="${i === 1 && j === 1 ? 'base' : ''}">${cr(x.profit)}<br><small class="muted">${pc(x.margin)}${x.irr !== null ? ` · IRR ${pc(x.irr)}` : ''}</small></td>`).join('')}</tr>`).join('')}</table>
</section>

<section class="page">
<h2>7 · Assumptions</h2>
<table>
<tr><td>Land</td><td class="n">₹${num(M.costs.land)} a ft² of plot</td></tr>
<tr><td>Ready reckoner (ASR)</td><td class="n">₹${num(M.costs.asr)} a ft²</td></tr>
<tr><td>Premium FSI, TDR, ancillary</td><td class="n">${M.costs.premiumPct} %, ${M.costs.tdrPct} %, ${M.costs.ancillaryPct} % of ASR</td></tr>
<tr><td>Construction</td><td class="n">₹${num(M.costs.build)} a ft² built-up</td></tr>
<tr><td>Parking structure</td><td class="n">₹${num(M.costs.parking)} a ft²</td></tr>
<tr><td>Soft costs</td><td class="n">${M.costs.soft} % of construction</td></tr>
<tr><td>Sale price</td><td class="n">₹${num(M.costs.sale)} a ft² of carpet</td></tr>
<tr><td>Carpet / built-up</td><td class="n">${pc(CARPET)}</td></tr>
<tr><td>Floor-to-floor</td><td class="n">${n2(R.floorH)} m</td></tr>
<tr><td>Car bay</td><td class="n">2.5 × 5 m on 6 m aisles</td></tr>
</table>
<p class="muted">A feasibility study, not an approval drawing. Road widths and DP reserves come from the map and the sanctioned Development Plan sheets as traced; the rules are summarised from UDCPR 2020, DCPR 2034 and NBC 2016 and differ by authority, zone and amendment (TOD zones, special schemes, aviation and fire clearances). Rates are placeholders to set for the project. Check every figure with the architect and the authority before relying on it.</p>
<footer>UrbanPlan Site Studio · ${new Date().toLocaleString('en-IN')}</footer>
</section>

<script>
for (const c of document.querySelectorAll('.chart')) {
  const s = c.querySelector('svg'), tip = c.querySelector('.tip'), xh = s.querySelector('.xh'), dot = s.querySelector('.dot'), hit = s.querySelector('.hit');
  const cum = JSON.parse(s.dataset.cum), g = JSON.parse(s.dataset.geo), n = cum.length;
  const X = (i) => g.pl + ((g.W - g.pl - g.pr) * i) / Math.max(1, n - 1), Y = (v) => g.pt + ((g.H - g.pt - g.pb) * (g.hi - v)) / ((g.hi - g.lo) || 1);
  hit.addEventListener('mousemove', (e) => {
    const r = s.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * g.W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((x - g.pl) / (g.W - g.pl - g.pr)) * (n - 1))));
    for (const el of [xh, dot]) el.setAttribute('visibility', 'visible');
    xh.setAttribute('x1', X(i)); xh.setAttribute('x2', X(i)); dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(cum[i]));
    const v = cum[i] / 1e7;
    tip.hidden = false; tip.textContent = 'Month ' + i + ': ' + (v < 0 ? '−' : '') + '₹' + Math.abs(v).toFixed(1) + ' Cr';
    tip.style.left = (X(i) / g.W) * r.width + 8 + 'px'; tip.style.top = (Y(cum[i]) / g.H) * r.height - 28 + 'px';
  });
  hit.addEventListener('mouseleave', () => { tip.hidden = true; for (const el of [xh, dot]) el.setAttribute('visibility', 'hidden'); });
}
</script>
</body></html>`);
  w.document.close();
}
