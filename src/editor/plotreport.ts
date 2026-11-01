// Site Studio's paperwork: the area statement as the approval drawings carry it, the unit schedule (every flat, by
// building and floor), both as CSV for Excel, and a one-page report to print or save as PDF.
import type { PlotObj } from '../doc/types';
import { CODE_LABEL, type PlotReport } from '../doc/plot';
import { SQFT, UNIT_LABEL, type SiteReport } from '../doc/site';
import { save } from './plotexport';

const n2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
const csv = (rows: (string | number)[][]) => '﻿' + rows.map((r) => r.map((c) => (typeof c === 'number' ? String(c) : /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n');
const slug = (o: PlotObj) => (o.name || 'plot').replace(/[^\w-]+/g, '-').toLowerCase();
const level = (k: string) => ({ stilt: 'Stilt', surface: 'Surface', podium: 'Podium', basement: 'Basement' })[k] ?? k;

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
  d.buildings.forEach((b, i) => rows.push([`Proposed: building ${String.fromCharCode(65 + i)}`, n2(b.plate * b.floors), `${n2(b.plate)} m² × ${b.floors} floors, ${n2(b.height)} m`]));
  rows.push(
    ['Total proposed built-up area', n2(d.bua), `FSI ${n2(d.fsi)}`],
    ['Balance built-up area', n2(d.left), d.left < 0 ? 'over' : ''],
    ['Ground coverage', n2(d.coverage * r.area), `${n2(d.coverage * 100)} %`],
    ['RERA carpet area', n2(d.carpet), `${Math.round(d.carpet * SQFT)} sq ft`],
    ['Recreational open space: required / open ground', `${n2(d.open.need)} / ${n2(d.open.have)}`, ''],
    ['Parking: car bays required / provided', `${d.parking.need} / ${d.parking.have}`, `${d.parking.cars} cars, ${d.parking.scooters} two-wheelers (four to a bay)`],
  );
  for (const l of d.parking.levels) rows.push([`  ${level(l.kind)}`, String(l.bays.length), 'bays']);
  return rows;
}

export function areaStatement(o: PlotObj, r: PlotReport, d: SiteReport) {
  const rows: (string | number)[][] = [[`Area statement: ${o.name}`, '', ''], [CODE_LABEL[r.code], `${n2(r.roadW)} m road`, ''], [], ['Item', 'Area (m²)', 'Note'], ...statement(r, d)];
  save(`${slug(o)}-area-statement.csv`, csv(rows), 'text/csv');
}

export function unitSchedule(o: PlotObj, d: SiteReport) {
  const rows: (string | number)[][] = [['Building', 'Floor', 'Flat', 'Type', 'Carpet (m²)', 'Carpet (sq ft)']];
  d.buildings.forEach((b, i) => {
    const B = String.fromCharCode(65 + i);
    for (let f = 1; f <= b.floors; f++) b.units.forEach((u, k) => rows.push([B, d.under + f, `${B}-${d.under + f}${String(k + 1).padStart(2, '0')}`, UNIT_LABEL[u.t], n2(u.carpet), Math.round(u.carpet * SQFT)]));
  });
  save(`${slug(o)}-unit-schedule.csv`, csv(rows), 'text/csv');
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const cr = (v: number) => `₹${(v / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 1 })} Cr`;

/** A page with the plan, the numbers and the checks, opened to print (or save as PDF). */
export function printReport(o: PlotObj, r: PlotReport, d: SiteReport, plan: HTMLCanvasElement | null) {
  const w = window.open('', '_blank');
  if (!w) return;
  const M = d.money;
  const checks: [string, boolean][] = [['Margins', !d.over.margins], ['Spacing', !d.over.overlap], ['FSI', !d.over.fsi], ['Height', !d.over.height], ['Parking', d.parking.have >= d.parking.need], ['Fire access', !d.over.fire], ['Open space', !d.over.open]];
  const tiles: [string, string][] = [['Flats', String(d.flats)], ['FSI', `${n2(d.fsi)} of ${n2(r.bua / r.area)}`], ['Height', `${n2(d.height)} m`], ['Carpet', `${Math.round(d.carpet * SQFT).toLocaleString('en-IN')} ft²`], ['Profit', cr(M.profit)], ['IRR', M.irr === null ? '–' : `${Math.round(M.irr * 100)} %`]];
  const mix = d.count.map((c, t) => (c ? `${c} × ${UNIT_LABEL[t]}` : '')).filter(Boolean).join(' · ');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(o.name)}: site report</title><style>
body{font:13px/1.45 Inter,system-ui,sans-serif;color:#1c2333;margin:32px;max-width:900px}
h1{font-size:22px;margin:0}p.sub{color:#667;margin:2px 0 18px}
.tiles{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:16px}.tiles div{border:1px solid #e3e5ea;border-radius:8px;padding:8px 10px}
.tiles small{display:block;color:#667;font-size:11px;text-transform:uppercase;letter-spacing:.04em}.tiles b{font-size:17px}
img{width:100%;border:1px solid #e3e5ea;border-radius:8px}.cols{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:16px}
table{width:100%;border-collapse:collapse}td{padding:3px 0;border-bottom:1px solid #eef0f3}td:nth-child(2){text-align:right;font-variant-numeric:tabular-nums}
.chk span{display:inline-block;margin:0 6px 6px 0;padding:2px 8px;border-radius:10px;font-size:12px}.ok{background:#e6f4ea;color:#1e7a3c}.bad{background:#fde8e8;color:#b42318}
footer{margin-top:20px;color:#889;font-size:11px}@media print{body{margin:12mm}}
</style></head><body>
<h1>${esc(o.name)}</h1><p class="sub">${esc(CODE_LABEL[r.code])} · ${n2(r.area)} m² · ${n2(r.roadW)} m road${r.road ? ` (${esc(r.road.name)})` : ''} · ${d.buildings.length} building${d.buildings.length === 1 ? '' : 's'} · ${mix}</p>
<div class="tiles">${tiles.map(([k, v]) => `<div><small>${k}</small><b>${esc(v)}</b></div>`).join('')}</div>
<div class="chk">${checks.map(([k, ok]) => `<span class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '!'} ${k}</span>`).join('')}</div>
${plan ? `<img src="${plan.toDataURL('image/png')}" alt="Site plan">` : ''}
<div class="cols"><div><h3>Area statement (m²)</h3><table>${statement(r, d).map(([a, b, c]) => `<tr><td>${esc(a)}${c ? `<br><small style="color:#889">${esc(c)}</small>` : ''}</td><td>${esc(b)}</td></tr>`).join('')}</table></div>
<div><h3>Costs and returns</h3><table>
<tr><td>Sales</td><td>${cr(M.revenue)}</td></tr><tr><td>Land</td><td>−${cr(M.land)}</td></tr><tr><td>Premium, TDR, ancillary FSI</td><td>−${cr(M.premium + M.tdr + M.ancillary)}</td></tr>
<tr><td>Construction and parking</td><td>−${cr(M.build + M.parking)}</td></tr><tr><td>Soft costs</td><td>−${cr(M.soft)}</td></tr><tr><td><b>Profit</b> (${Math.round(M.margin * 100)} % of sales)</td><td><b>${cr(M.profit)}</b></td></tr>
<tr><td>IRR, a year</td><td>${M.irr === null ? '–' : `${Math.round(M.irr * 100)} %`}</td></tr><tr><td>Most money in at once</td><td>${cr(M.peak)}</td></tr><tr><td>Pays back</td><td>${M.payback === null ? 'never' : `month ${M.payback}`}</td></tr>
</table></div></div>
<footer>UrbanPlan Site Studio · ${new Date().toLocaleDateString('en-IN')} · a feasibility study, not an approval drawing: check the figures against the sanctioned DP and the current regulations.</footer>
<script>window.onload=()=>setTimeout(()=>print(),200)</script></body></html>`);
  w.document.close();
}
