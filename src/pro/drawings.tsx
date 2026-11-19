// The approval drawing set, drawn from the scheme as A3 landscape sheets (SVG in millimetres, so it prints to scale):
//  1. the site plan: the plot, the roads with their widths, the DP road line, the margins, the buildings, parking
//     and the open space;
//  2. the typical floor plan: flats by type with their carpet, cores, corridors, window and door tags;
//  3. the front elevation and section: stilt and floors with their heights, the total height, the parapet;
//  4. the area statement: plot, deductions, FSI by source, permissible and proposed built-up area, built-up area
//     by floor, carpet by flat type, the parking statement.
// Each sheet has a title block, a scale (the largest standard scale that fits), a scale bar and a north arrow.
// Printed with the browser (SHEET_CSS puts one sheet on each A3 page), it saves as a PDF. For discussion: check
// everything before it goes in for approval.
import { featureOf } from './siteObjects';
import type { ComponentChildren, JSX } from 'preact';
import { SQFT, UNIT_COLOR, UNIT_LABEL } from '../doc/site';
import type { Evaluated } from './evaluate';
import { outline, roadLines } from './project';

const W = 420, H = 297, PAD = 10, TB = 92; // sheet, border, title block width (mm)
const AREA = { x: PAD + 6, y: PAD + 6, w: W - 2 * PAD - TB - 12, h: H - 2 * PAD - 12 };
const SCALES = [50, 100, 200, 250, 500, 1000, 2000];
const f2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
const nf = (v: number) => Math.round(v).toLocaleString('en-IN');
const pts = (q: number[], T: (x: number, z: number) => [number, number]) => { const o: string[] = []; for (let i = 0; i < q.length; i += 2) o.push(T(q[i], q[i + 1]).map((v) => v.toFixed(2)).join(',')); return o.join(' '); };
const mid = (q: number[]): [number, number] => { let x = 0, z = 0; for (let i = 0; i < q.length; i += 2) { x += q[i]; z += q[i + 1]; } return [x / (q.length / 2), z / (q.length / 2)]; };

/** A frame for plan drawings: metres to sheet millimetres at the largest standard scale that fits, centred.
 *  North (the plan's −z… the road is at the bottom) is up: plan z runs up the sheet. */
function planFrame(x0: number, z0: number, x1: number, z1: number, box = AREA) {
  const need = Math.max((x1 - x0) * 1000 / box.w, (z1 - z0) * 1000 / box.h);
  const scale = SCALES.find((s) => s >= need) ?? Math.ceil(need / 1000) * 1000;
  const k = 1000 / scale, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const ox = box.x + box.w / 2, oy = box.y + box.h / 2;
  const T = (x: number, z: number): [number, number] => [ox + (x - cx) * k, oy - (z - cz) * k];
  return { scale, k, T };
}

function Frame({ e, title, no, scale, children }: { e: Evaluated; title: string; no: number; scale: string; children: ComponentChildren }) {
  const tx = W - PAD - TB, d = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const rows: [string, string][] = [['Project', e.p.name], ['Sheet', `${no} of 4 · ${title}`], ['Scale', scale], ['Rules', e.r.code === 'udcpr' ? 'UDCPR 2020' : 'DCPR 2034'], ['Date', d]];
  return (
    <section class="sheet">
      <svg viewBox={`0 0 ${W} ${H}`} width={`${W}mm`} height={`${H}mm`} xmlns="http://www.w3.org/2000/svg" font-family="Helvetica, Arial, sans-serif">
        <defs>
          <pattern id="hatch-open" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="2" stroke="#3a8f5a" stroke-width="0.25" /></pattern>
          <pattern id="hatch-dp" width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="1.6" stroke="#d33" stroke-width="0.25" /></pattern>
        </defs>
        <rect x="0" y="0" width={W} height={H} fill="#fff" />
        <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} fill="none" stroke="#111" stroke-width="0.5" />
        {children}
        {/* the title block */}
        <line x1={tx} y1={PAD} x2={tx} y2={H - PAD} stroke="#111" stroke-width="0.35" />
        <text x={tx + 6} y={PAD + 12} font-size="7" font-weight="700">UrbanPlan</text>
        <text x={tx + 6} y={PAD + 19} font-size="3.2" fill="#555">Pro · approval drawings</text>
        {rows.map(([k, v], i) => (
          <g>
            <line x1={tx} y1={PAD + 30 + i * 14} x2={W - PAD} y2={PAD + 30 + i * 14} stroke="#111" stroke-width="0.2" />
            <text x={tx + 4} y={PAD + 35 + i * 14} font-size="2.6" fill="#666">{k.toUpperCase()}</text>
            <text x={tx + 4} y={PAD + 41 + i * 14} font-size="3.6" font-weight="600">{v.length > 34 ? `${v.slice(0, 33)}…` : v}</text>
          </g>
        ))}
        <line x1={tx} y1={PAD + 30 + rows.length * 14} x2={W - PAD} y2={PAD + 30 + rows.length * 14} stroke="#111" stroke-width="0.2" />
        <text x={tx + 4} y={H - PAD - 40} font-size="2.6" fill="#666">ARCHITECT</text>
        <line x1={tx + 4} y1={H - PAD - 24} x2={W - PAD - 4} y2={H - PAD - 24} stroke="#999" stroke-width="0.2" />
        <text x={tx + 4} y={H - PAD - 20} font-size="2.4" fill="#666">Signature, licence no. and seal</text>
        <text x={tx + 4} y={H - PAD - 9} font-size="2.3" fill="#a33">Prepared with UrbanPlan for discussion.</text>
        <text x={tx + 4} y={H - PAD - 5} font-size="2.3" fill="#a33">Check everything before submission.</text>
      </svg>
    </section>
  );
}

function North({ x, y }: { x: number; y: number }) {
  return <g><path d={`M${x} ${y - 7}L${x + 3} ${y + 3}L${x} ${y + 1}L${x - 3} ${y + 3}Z`} fill="#111" /><text x={x} y={y - 9} font-size="3.5" font-weight="700" text-anchor="middle">N</text></g>;
}
function ScaleBar({ x, y, k, scale }: { x: number; y: number; k: number; scale: number }) {
  // a bar of a round number of metres, about 40 mm long
  const m = [1, 2, 5, 10, 20, 50, 100].find((v) => v * k >= 30) ?? 100;
  return (
    <g font-size="2.4">
      {[0, 1, 2, 3, 4].map((i) => <rect x={x + (i * m * k) / 5} y={y} width={(m * k) / 5} height="1.6" fill={i % 2 ? '#fff' : '#111'} stroke="#111" stroke-width="0.2" />)}
      <text x={x} y={y + 5}>0</text>
      <text x={x + m * k} y={y + 5} text-anchor="middle">{m} m</text>
      <text x={x} y={y - 2}>Scale 1:{scale}</text>
    </g>
  );
}
/** a dimension line between two sheet points, with its value */
function Dim({ a, b, label, off = 0 }: { a: [number, number]; b: [number, number]; label: string; off?: number }) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / L * off, ny = (b[0] - a[0]) / L * off;
  const A = [a[0] + nx, a[1] + ny], B = [b[0] + nx, b[1] + ny], ang = (Math.atan2(B[1] - A[1], B[0] - A[0]) * 180) / Math.PI;
  const up = ang > 90 || ang < -90 ? ang + 180 : ang;
  return (
    <g stroke="#1b4fd8" stroke-width="0.2" fill="#1b4fd8">
      <line x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} />
      <circle cx={A[0]} cy={A[1]} r="0.5" /><circle cx={B[0]} cy={B[1]} r="0.5" />
      <text x={(A[0] + B[0]) / 2} y={(A[1] + B[1]) / 2 - 1} font-size="2.4" stroke="none" text-anchor="middle" transform={`rotate(${up} ${(A[0] + B[0]) / 2} ${(A[1] + B[1]) / 2})`}>{label}</text>
    </g>
  );
}

function SitePlan({ e }: { e: Evaluated }) {
  const { p, r, d } = e, { ring, roads } = outline(p);
  const lines = roadLines(ring, roads);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); }
  const padM = Math.max(8, ...lines.map((l) => Math.max(l.road.today, l.road.dp) + 3));
  const { scale, k, T } = planFrame(x0 - padM, z0 - padM, x1 + padM, z1 + padM);
  // roads trimmed to the drawing: 300 m past each end in the data, keep about the plot's reach
  const reach = Math.max(x1 - x0, z1 - z0) / 2 + padM;
  const [pcx, pcz] = mid(ring);
  const roadEls = lines.map((l) => {
    const [ax, az, bx, bz] = l.pts, L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
    // the point on the centre line nearest the plot's middle, then ±reach along it
    const t = (pcx - ax) * ux + (pcz - az) * uz, cx = ax + ux * t, cz = az + uz * t;
    const a = [cx - ux * reach, cz - uz * reach], b = [cx + ux * reach, cz + uz * reach];
    const half = (w: number) => [-uz * w / 2, ux * w / 2];
    const [nx, nz] = half(l.road.today), [dx, dz] = half(l.road.dp);
    const strip = [a[0] + nx, a[1] + nz, b[0] + nx, b[1] + nz, b[0] - nx, b[1] - nz, a[0] - nx, a[1] - nz];
    const [tx, ty] = T(cx, cz), ang = (Math.atan2(-uz, ux) * 180) / Math.PI, up = ang > 90 || ang < -90 ? ang + 180 : ang;
    return (
      <g>
        <polygon points={pts(strip, T)} fill="#e9e9e6" stroke="#777" stroke-width="0.25" />
        {l.road.dp > l.road.today && [1, -1].map((s) => <line x1={T(a[0] + dx * s, a[1] + dz * s)[0]} y1={T(a[0] + dx * s, a[1] + dz * s)[1]} x2={T(b[0] + dx * s, b[1] + dz * s)[0]} y2={T(b[0] + dx * s, b[1] + dz * s)[1]} stroke="#d33" stroke-width="0.3" stroke-dasharray="3 1.5" />)}
        <text x={tx} y={ty + 1} font-size="2.8" text-anchor="middle" transform={`rotate(${up} ${tx} ${ty})`}>{`${f2(l.road.today)} M WIDE ROAD${l.road.dp > l.road.today ? ` (${f2(l.road.dp)} M IN THE DP)` : ''}`}</text>
      </g>
    );
  });
  const surface = d.parking.levels.filter((l) => l.kind === 'surface' || l.kind === 'lot');
  const stilt = d.parking.levels.find((l) => l.kind === 'stilt');
  // the margins: from the front edge in to the margin line, and from a side edge
  const fp = r.footprint;
  return (
    <Frame e={e} title="Site plan" no={1} scale={`1:${scale}`}>
      <g>
        {roadEls}
        <polygon points={pts(ring, T)} fill="#fbfaf6" stroke="#111" stroke-width="0.6" />
        {r.lostRings.map((lr) => <polygon points={pts(lr, T)} fill="url(#hatch-dp)" stroke="#d33" stroke-width="0.3" />)}
        {d.ground.gardens.map((g) => <polygon points={pts(g, T)} fill="url(#hatch-open)" stroke="#3a8f5a" stroke-width="0.2" />)}
        {/* what is on the site already: trees kept, structures, lines, ground kept clear */}
        {(p.features ?? []).map((f) => {
          const sh = featureOf(f.kind).shape;
          if (sh === 'point') { const [x, y] = T(f.pts[0], f.pts[1]), rr = (f.r ?? 1) * (T(f.pts[0] + 1, f.pts[1])[0] - x); return <g><circle cx={x} cy={y} r={Math.max(0.6, rr)} fill="none" stroke={f.kind === 'tree' ? '#3a8f5a' : '#555'} stroke-width="0.25" /><circle cx={x} cy={y} r="0.3" fill="#111" /></g>; }
          if (sh === 'line') return <polyline points={pts(f.pts, T)} fill="none" stroke="#555" stroke-width="0.35" stroke-dasharray="3 1 0.6 1" />;
          return <polygon points={pts(f.pts, T)} fill={f.kind === 'nobuild' ? 'url(#hatch-dp)' : '#eee'} stroke="#555" stroke-width="0.3" stroke-dasharray={f.kind === 'nobuild' ? '1.5 1' : undefined} />;
        })}
        {fp.length >= 6 && <polygon points={pts(fp, T)} fill="none" stroke="#1b4fd8" stroke-width="0.3" stroke-dasharray="2 1" />}
        {surface.flatMap((l) => l.bays).map((b) => <polygon points={pts(b, T)} fill="none" stroke="#999" stroke-width="0.15" />)}
        {d.buildings.map((b, i) => b.quads.map((q) => <polygon points={pts(q, T)} fill="#d9d4c8" stroke="#111" stroke-width="0.5" />).concat([
          (() => { const [x, z] = mid(b.quads[0]); const [sx, sy] = T(x, z); return <g><text x={sx} y={sy} font-size="4" font-weight="700" text-anchor="middle">{`BUILDING ${String.fromCharCode(65 + i)}`}</text><text x={sx} y={sy + 4.5} font-size="2.6" text-anchor="middle">{`${d.under ? 'STILT + ' : ''}${b.floors} FLOORS · ${f2(b.height)} M`}</text></g>; })(),
        ]))}
        {/* the front and side margins, dimensioned from the margin line out to the plot's edge */}
        {fp.length >= 6 && (() => {
          const out: JSX.Element[] = [];
          // the margin line's lowest z edge (the front), and its smallest x edge (a side)
          let fz = Infinity, fx = 0, sx = Infinity, sz = 0;
          for (let i = 0; i < fp.length; i += 2) { if (fp[i + 1] < fz) { fz = fp[i + 1]; fx = fp[i]; } if (fp[i] < sx) { sx = fp[i]; sz = fp[i + 1]; } }
          const netZ = Math.min(...(r.net.length >= 6 ? r.net : ring).filter((_, i) => i % 2 === 1));
          out.push(<Dim a={T(fx + 2, netZ)} b={T(fx + 2, fz)} label={`${f2(fz - netZ)} M`} />);
          const plotX = Math.min(...ring.filter((_, i) => i % 2 === 0));
          out.push(<Dim a={T(plotX, sz + 2)} b={T(sx, sz + 2)} label={`${f2(sx - plotX)} M`} />);
          return out;
        })()}
      </g>
      <g font-size="2.6">
        <rect x={AREA.x} y={AREA.y} width="74" height="34" fill="#fff" stroke="#111" stroke-width="0.25" />
        <text x={AREA.x + 3} y={AREA.y + 5} font-weight="700">LEGEND</text>
        <rect x={AREA.x + 3} y={AREA.y + 8} width="6" height="3" fill="#d9d4c8" stroke="#111" stroke-width="0.3" /><text x={AREA.x + 12} y={AREA.y + 10.5}>Proposed building</text>
        <line x1={AREA.x + 3} y1={AREA.y + 15} x2={AREA.x + 9} y2={AREA.y + 15} stroke="#1b4fd8" stroke-width="0.3" stroke-dasharray="2 1" /><text x={AREA.x + 12} y={AREA.y + 16}>Margin line</text>
        <rect x={AREA.x + 3} y={AREA.y + 19} width="6" height="3" fill="url(#hatch-dp)" stroke="#d33" stroke-width="0.3" /><text x={AREA.x + 12} y={AREA.y + 21.5}>Road widening (DP)</text>
        <rect x={AREA.x + 3} y={AREA.y + 25} width="6" height="3" fill="url(#hatch-open)" stroke="#3a8f5a" stroke-width="0.3" /><text x={AREA.x + 12} y={AREA.y + 27.5}>Open space</text>
        <text x={AREA.x + 3} y={AREA.y + 32}>{`Parking: ${d.parking.have} bays (${d.parking.need} needed)${stilt ? `, ${stilt.bays.length} under the stilt` : ''}`}</text>
      </g>
      <North x={AREA.x + AREA.w - 8} y={AREA.y + 12} />
      <ScaleBar x={AREA.x} y={AREA.y + AREA.h - 6} k={k} scale={scale} />
    </Frame>
  );
}

function FloorPlan({ e }: { e: Evaluated }) {
  const { d, plans, shops } = e;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const b of d.buildings) for (const q of b.quads) for (let i = 0; i < q.length; i += 2) { x0 = Math.min(x0, q[i]); x1 = Math.max(x1, q[i]); z0 = Math.min(z0, q[i + 1]); z1 = Math.max(z1, q[i + 1]); }
  if (!d.buildings.length) { x0 = z0 = 0; x1 = z1 = 10; }
  const { scale, k, T } = planFrame(x0 - 4, z0 - 4, x1 + 4, z1 + 4);
  const fs = Math.min(2.6, Math.max(1.2, 0.9 * k));
  return (
    <Frame e={e} title="Typical floor plan" no={2} scale={`1:${scale}`}>
      <g>
        {d.buildings.map((b, bi) => (
          <g>
            {b.quads.map((q) => <polygon points={pts(q, T)} fill="#fff" stroke="#111" stroke-width="0.6" />)}
            {b.corridors.map((c) => <polygon points={pts(c, T)} fill="#f1efe9" stroke="#777" stroke-width="0.2" />)}
            {b.units.map((u, ui) => {
              const [x, z] = mid(u.ring), [sx, sy] = T(x, z), shop = shops?.removed.get(bi)?.has(ui);
              return <g>
                <polygon points={pts(u.ring, T)} fill={UNIT_COLOR[u.t]} fill-opacity="0.22" stroke="#111" stroke-width="0.35" />
                <text x={sx} y={sy} font-size={fs * 1.1} font-weight="700" text-anchor="middle">{UNIT_LABEL[u.t]}{shop ? ' *' : ''}</text>
                <text x={sx} y={sy + fs * 1.3} font-size={fs * 0.9} text-anchor="middle">{`${f2(u.carpet)} m²`}</text>
              </g>;
            })}
            {b.cores.map((c) => { const [x, z] = mid(c), [sx, sy] = T(x, z); return <g><polygon points={pts(c, T)} fill="#bbb" stroke="#111" stroke-width="0.4" /><text x={sx} y={sy + 0.8} font-size={fs * 0.8} text-anchor="middle">STAIR + LIFT</text></g>; })}
            {plans[bi]?.openings.map((o) => {
              const a = T(o.x - o.ux * o.w / 2, o.z - o.uz * o.w / 2), c = T(o.x + o.ux * o.w / 2, o.z + o.uz * o.w / 2), t = T(o.x + o.nx * 0.9, o.z + o.nz * 0.9);
              return <g><line x1={a[0]} y1={a[1]} x2={c[0]} y2={c[1]} stroke={o.tag.startsWith('D') || o.tag === 'SD' ? '#8a5a3b' : '#1b4fd8'} stroke-width="0.9" />
                {k >= 3 && <text x={t[0]} y={t[1] + 0.6} font-size={fs * 0.7} text-anchor="middle" fill="#333">{o.tag}</text>}</g>;
            })}
          </g>
        ))}
      </g>
      <g font-size="2.6">
        <text x={AREA.x} y={AREA.y + 4} font-weight="700">TYPICAL FLOOR</text>
        <text x={AREA.x} y={AREA.y + 8}>{d.buildings.map((b, i) => `${String.fromCharCode(65 + i)}: ${b.floors} floors`).join(' · ')}</text>
        {shops && shops.removedFlats > 0 && <text x={AREA.x} y={AREA.y + 12}>* shops instead on the lower floors</text>}
        <text x={AREA.x} y={AREA.y + 16} fill="#1b4fd8">Windows (blue), doors (brown); tags as the schedule</text>
      </g>
      <North x={AREA.x + AREA.w - 8} y={AREA.y + 12} />
      <ScaleBar x={AREA.x} y={AREA.y + AREA.h - 6} k={k} scale={scale} />
    </Frame>
  );
}

function Elevation({ e }: { e: Evaluated }) {
  const { d, r, ds, shops } = e;
  const fh = r.rules.floorH, under = d.under;
  // each building's front face: its x extent, side by side with a gap where they'd overlap
  const spans = d.buildings.map((b) => { let a = Infinity, c = -Infinity; for (const q of b.quads) for (let i = 0; i < q.length; i += 2) { a = Math.min(a, q[i]); c = Math.max(c, q[i]); } return [a, c]; });
  let cursor = 0;
  const placed = spans.map(([a, c]) => { const w = c - a, x = cursor; cursor += w + 8; return { x, w }; });
  const totalW = Math.max(10, cursor - 8), totalH = Math.max(...d.buildings.map((b) => (under + b.floors) * fh + 4), 10);
  const need = Math.max((totalW + 20) * 1000 / AREA.w, (totalH + 12) * 1000 / AREA.h);
  const scale = SCALES.find((s) => s >= need) ?? 2000, k = 1000 / scale;
  const gx = AREA.x + (AREA.w - totalW * k) / 2, gy = AREA.y + AREA.h - 18;
  const X = (m: number) => gx + m * k, Y = (m: number) => gy - m * k;
  return (
    <Frame e={e} title="Elevation" no={3} scale={`1:${scale}`}>
      <line x1={AREA.x} y1={gy} x2={AREA.x + AREA.w} y2={gy} stroke="#111" stroke-width="0.6" />
      <text x={AREA.x} y={gy + 4} font-size="2.4">GROUND LEVEL ±0.00</text>
      {d.buildings.map((b, bi) => {
        const { x, w } = placed[bi], top = (under + b.floors) * fh;
        const shopFloors = shops && shops.strips.some((s) => s.b === bi) ? 1 + shops.upperOf[bi] : 0;
        return (
          <g>
            {/* stilt: columns */}
            {under > 0 && Array.from({ length: Math.max(2, Math.round(w / 6) + 1) }, (_, i) => <rect x={X(x + (w * i) / Math.max(1, Math.round(w / 6))) - 0.6} y={Y(under * fh)} width="1.2" height={under * fh * k} fill={shopFloors ? '#9cc3e6' : '#888'} />)}
            {shopFloors > 0 && <rect x={X(x)} y={Y(under * fh)} width={w * k} height={under * fh * k} fill="#cfe3f3" stroke="#111" stroke-width="0.3" />}
            {Array.from({ length: b.floors }, (_, f) => {
              const y = (under + f) * fh, shop = f < (shopFloors ? shopFloors - 1 : 0);
              return <g>
                <rect x={X(x)} y={Y(y + fh)} width={w * k} height={fh * k} fill={shop ? '#cfe3f3' : ds.facade.wall} stroke="#111" stroke-width="0.3" />
                <text x={X(x) - 1.5} y={Y(y + fh / 2) + 0.8} font-size="1.9" text-anchor="end">{`${f + 1}F +${f2(y)}`}</text>
              </g>;
            })}
            {/* parapet and the lift room */}
            <rect x={X(x)} y={Y(top + 1)} width={w * k} height={1 * k} fill="none" stroke="#111" stroke-width="0.3" />
            <rect x={X(x + w / 2 - 2.5)} y={Y(top + 3)} width={5 * k} height={3 * k} fill="#ccc" stroke="#111" stroke-width="0.3" />
            <Dim a={[X(x + w) + 6, Y(0)]} b={[X(x + w) + 6, Y(top)]} label={`${f2(top)} M`} />
            <text x={X(x + w / 2)} y={gy + 8} font-size="3" font-weight="700" text-anchor="middle">{`BUILDING ${String.fromCharCode(65 + bi)}`}</text>
            <text x={X(x + w / 2)} y={gy + 12} font-size="2.3" text-anchor="middle">{`${under ? 'Stilt' : 'Ground'} + ${b.floors} · floor to floor ${f2(fh)} m`}</text>
          </g>
        );
      })}
      <text x={AREA.x} y={AREA.y + 4} font-size="2.6" font-weight="700">FRONT ELEVATION (SCHEMATIC)</text>
      <text x={AREA.x} y={AREA.y + 8} font-size="2.4">{`Height limit here ${f2(r.rules.maxH)} m. Heights to the terrace; parapet 1.0 m, lift room 3.0 m over.`}</text>
      <ScaleBar x={AREA.x + AREA.w - 50} y={AREA.y + 6} k={k} scale={scale} />
    </Frame>
  );
}

function AreaStatement({ e }: { e: Evaluated }) {
  const { r, d, shops } = e, P = r.parts;
  const rows: [string, string, string?][] = [];
  const h = (s: string) => rows.push([s, '', 'h']);
  const row = (a: string, b: number | string) => rows.push([a, typeof b === 'number' ? `${f2(b)} m²` : b]);
  h('PLOT');
  row('Plot area (as per the record)', r.area);
  row('Less: road widening (DP)', r.lost);
  row('Net plot area', r.netArea);
  h('PERMISSIBLE BUILT-UP AREA');
  row(`Basic FSI ${f2(r.rules.basic)} on the net plot`, P.basic);
  row(`Premium FSI ${f2(r.rules.premium)}`, P.premium);
  row(`TDR ${f2(r.rules.tdr)}`, P.tdr);
  if (P.credit > 0) row('FSI of the road widening handed over', P.credit);
  row(`${r.code === 'udcpr' ? 'Ancillary' : 'Fungible'} FSI ${Math.round(r.rules.ancillary * 100)}%`, P.ancillary);
  row('Total permissible', r.bua);
  h('PROPOSED BUILT-UP AREA');
  if (shops) row('Ground floor shops', shops.ground);
  d.buildings.forEach((b, i) => { const plate = b.quads.reduce((s, q) => { let a = 0; for (let j = 0; j < q.length; j += 2) { const k = (j + 2) % q.length; a += q[j] * q[k + 1] - q[k] * q[j + 1]; } return s + Math.abs(a / 2); }, 0); row(`Building ${String.fromCharCode(65 + i)}: ${b.floors} floors × ${f2(plate)} m²`, plate * b.floors); });
  row('Total proposed', d.bua);
  row('FSI used', f2(d.fsi));
  rows.push(['Balance', `${f2(d.left)} m²`]);
  h('CARPET (RERA)');
  [0, 1, 2].forEach((t) => { if (d.count[t]) rows.push([`${UNIT_LABEL[t]}`, `${d.count[t]} flats`]); });
  if (shops) rows.push(['Shops', `${shops.count} · ${f2(shops.carpet)} m²`]);
  row('Total carpet (flats)', d.carpet);
  rows.push(['', `${nf(d.carpet * SQFT)} sq ft`]);
  h('PARKING');
  rows.push(['Car bays required', `${d.parking.need}`]);
  d.parking.levels.filter((l) => l.bays.length).forEach((l, i) => rows.push([`${l.kind[0].toUpperCase()}${l.kind.slice(1)}${l.kind === 'basement' ? ` ${i}` : ''}`, `${l.bays.length} bays`]));
  rows.push(['Car bays provided', `${d.parking.have}`]);
  // two columns of rows
  const per = Math.ceil(rows.length / 2), colW = AREA.w / 2 - 6, lh = 6.2;
  return (
    <Frame e={e} title="Area statement" no={4} scale="NTS">
      <text x={AREA.x} y={AREA.y + 4} font-size="4" font-weight="700">AREA STATEMENT</text>
      {rows.map(([a, b, kind], i) => {
        const c = Math.floor(i / per), j = i % per, x = AREA.x + c * (colW + 12), y = AREA.y + 14 + j * lh;
        return kind === 'h'
          ? <g><rect x={x} y={y - 4.2} width={colW} height={5.6} fill="#f0eee8" /><text x={x + 2} y={y} font-size="2.8" font-weight="700">{a}</text></g>
          : <g><line x1={x} y1={y + 1.6} x2={x + colW} y2={y + 1.6} stroke="#ddd" stroke-width="0.2" /><text x={x + 2} y={y} font-size="2.8">{a}</text><text x={x + colW - 2} y={y} font-size="2.8" text-anchor="end" font-weight="600">{b}</text></g>;
      })}
    </Frame>
  );
}

export function Sheets({ e }: { e: Evaluated }): JSX.Element {
  return (
    <div class="sheets">
      <SitePlan e={e} />
      <FloorPlan e={e} />
      <Elevation e={e} />
      <AreaStatement e={e} />
    </div>
  );
}

/** The sheets on screen (scaled to fit, one under another) and in print (one A3 landscape page each, nothing else). */
export const SHEET_CSS = `
.sheets { display: grid; gap: 16px; }
.sheet { background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.18); border-radius: 4px; overflow: hidden; }
.sheet svg { display: block; width: 100%; height: auto; }
@media print {
  @page { size: A3 landscape; margin: 0; }
  body * { visibility: hidden; }
  .sheets, .sheets * { visibility: visible; }
  .sheets { position: absolute; left: 0; top: 0; gap: 0; display: block; }
  .sheet { box-shadow: none; border-radius: 0; page-break-after: always; break-after: page; width: 420mm; height: 297mm; }
  .sheet svg { width: 420mm; height: 297mm; }
}
`;
