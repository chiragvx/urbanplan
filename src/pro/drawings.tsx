// The building permission set, drawn from the scheme as A3 landscape sheets (SVG in millimetres, so it prints to
// scale), and saved as one PDF:
//  1. the cover: the project, the key figures, the sheet index, what the scrutiny found, general notes;
//  2. the site plan: the plot with every edge dimensioned, the roads with their widths, the DP road line, the
//     margins (required against provided, each dimensioned), the buildings, the compound wall, gates and internal
//     roads, parking and the open space;
//  3. the typical floor plan: flats with their rooms (name and area), partitions, cores, corridors, window and door
//     tags, and overall dimensions;
//  4. the front elevation;
//  5. the area statement: plot, deductions, FSI by source, permissible and proposed built-up area, coverage, open
//     space, height, carpet by flat type, the parking statement;
//  6. the schedules: flats, doors and windows, light and ventilation by flat, room sizes against the minimums;
//  7. the scrutiny report: every rule with what it requires, what is proposed, its clause and the result;
//  8. the permission: its stages, the NOCs, the fees and charges, the documents to file;
//  then a sheet of plans per formed building (every distinct floor).
// Each sheet has a title block; drawings have a scale (the largest standard scale that fits), a scale bar and a
// north arrow. For discussion: an architect checks everything before it goes in for approval.
import { compositionOf, zonesOf, ZONED_FROM, type Tone } from './design';
import { featureOf } from './siteObjects';
import type { ComponentChildren, JSX } from 'preact';
import { render } from 'preact';
import { floorKind, SQFT, UNIT_COLOR, UNIT_LABEL, type FloorUse } from '../doc/site';
import { sideMargin } from '../doc/plot';
import { USE_LABEL } from './deal';
import { areaStatement } from './areaStatement';
import type { Evaluated } from './evaluate';
import { CITIES, outline, roadLines } from './project';
import type { Check, CheckStatus } from './scrutiny';
import type { FlatRooms } from './rooms';
import { documents, fees, nocs, PERMISSION_LABEL, permissionOf, stages } from './approvals';
import { buildingCores, type CoreDetail } from './coreDetail';
import type { Opening } from './openings';

const W = 420, H = 297, PAD = 10, TB = 92; // sheet, border, title block width (mm)
const AREA = { x: PAD + 6, y: PAD + 6, w: W - 2 * PAD - TB - 12, h: H - 2 * PAD - 12 };
const SCALES = [50, 100, 200, 250, 500, 1000, 2000];
const f2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
const nf = (v: number) => Math.round(v).toLocaleString('en-IN');
const m2 = (v: number) => `${f2(v)} m²`;
const rs = (v: number) => (v >= 1e7 ? `Rs ${(v / 1e7).toFixed(2)} crore` : v >= 1e5 ? `Rs ${(v / 1e5).toFixed(2)} lakh` : `Rs ${nf(v)}`);
const letter = (i: number) => String.fromCharCode(65 + i);
const pts = (q: number[], T: (x: number, z: number) => [number, number]) => { const o: string[] = []; for (let i = 0; i < q.length; i += 2) o.push(T(q[i], q[i + 1]).map((v) => v.toFixed(2)).join(',')); return o.join(' '); };
const mid = (q: number[]): [number, number] => { let x = 0, z = 0; for (let i = 0; i < q.length; i += 2) { x += q[i]; z += q[i + 1]; } return [x / (q.length / 2), z / (q.length / 2)]; };
const polyArea = (q: number[]) => { let a = 0; for (let j = 0; j < q.length; j += 2) { const k = (j + 2) % q.length; a += q[j] * q[k + 1] - q[k] * q[j + 1]; } return Math.abs(a / 2); };

/** what the sheets are drawn from: the scheme, its scrutiny and the rooms of each flat of the typical floor */
export interface SetInput { e: Evaluated; checks: Check[]; rooms: FlatRooms[][] }

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

const cityLabel = (e: Evaluated) => CITIES.find((c) => c.value === e.p.city)?.label ?? e.p.city;
const rulesName = (e: Evaluated) => (e.r.code === 'udcpr' ? 'UDCPR 2020' : 'DCPR 2034');

function Frame({ e, title, no, total, scale, children }: { e: Evaluated; title: string; no: number; total: number; scale: string; children: ComponentChildren }) {
  const tx = W - PAD - TB, d = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const rows: [string, string][] = [
    ['Project', e.p.name],
    ['Applying for', PERMISSION_LABEL[permissionOf(e, e.p.approval?.kind)]],
    ['Place', e.p.at ? `${cityLabel(e)} · ${e.p.at[0].toFixed(5)}, ${e.p.at[1].toFixed(5)}` : cityLabel(e)],
    ['Sheet', `${no} of ${total} · ${title}`],
    ['Drawing no.', `UP-${String(no).padStart(2, '0')}`],
    ['Scale', scale],
    ['Rules', rulesName(e)],
    ['Date', d],
  ];
  const rh = 12.5;
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
        <text x={tx + 6} y={PAD + 19} font-size="3.2" fill="#555">Building permission drawings</text>
        {rows.map(([k, v], i) => (
          <g>
            <line x1={tx} y1={PAD + 26 + i * rh} x2={W - PAD} y2={PAD + 26 + i * rh} stroke="#111" stroke-width="0.2" />
            <text x={tx + 4} y={PAD + 30.5 + i * rh} font-size="2.4" fill="#666">{k.toUpperCase()}</text>
            <text x={tx + 4} y={PAD + 36 + i * rh} font-size="3.3" font-weight="700">{v.length > 40 ? `${v.slice(0, 39)}…` : v}</text>
          </g>
        ))}
        <line x1={tx} y1={PAD + 26 + rows.length * rh} x2={W - PAD} y2={PAD + 26 + rows.length * rh} stroke="#111" stroke-width="0.2" />
        <text x={tx + 4} y={H - PAD - 74} font-size="2.4" fill="#666">OWNER / APPLICANT</text>
        <line x1={tx + 4} y1={H - PAD - 58} x2={W - PAD - 4} y2={H - PAD - 58} stroke="#999" stroke-width="0.2" />
        <text x={tx + 4} y={H - PAD - 54} font-size="2.2" fill="#666">Name and signature</text>
        <line x1={tx} y1={H - PAD - 48} x2={W - PAD} y2={H - PAD - 48} stroke="#111" stroke-width="0.2" />
        <text x={tx + 4} y={H - PAD - 42} font-size="2.4" fill="#666">ARCHITECT</text>
        <line x1={tx + 4} y1={H - PAD - 24} x2={W - PAD - 4} y2={H - PAD - 24} stroke="#999" stroke-width="0.2" />
        <text x={tx + 4} y={H - PAD - 20} font-size="2.2" fill="#666">Signature, licence no. and seal</text>
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
/** a dimension line between two sheet points, with its value (offset `off` mm to its left) */
function Dim({ a, b, label, off = 0, color = '#1b4fd8' }: { a: [number, number]; b: [number, number]; label: string; off?: number; color?: string }) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / L * off, ny = (b[0] - a[0]) / L * off;
  const A = [a[0] + nx, a[1] + ny], B = [b[0] + nx, b[1] + ny], ang = (Math.atan2(B[1] - A[1], B[0] - A[0]) * 180) / Math.PI;
  const up = ang > 90 || ang < -90 ? ang + 180 : ang;
  return (
    <g stroke={color} stroke-width="0.2" fill={color}>
      {off !== 0 && <><line x1={a[0]} y1={a[1]} x2={A[0]} y2={A[1]} stroke-width="0.12" /><line x1={b[0]} y1={b[1]} x2={B[0]} y2={B[1]} stroke-width="0.12" /></>}
      <line x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} />
      <circle cx={A[0]} cy={A[1]} r="0.45" /><circle cx={B[0]} cy={B[1]} r="0.45" />
      <text x={(A[0] + B[0]) / 2} y={(A[1] + B[1]) / 2 - 0.9} font-size="2.3" stroke="none" text-anchor="middle" transform={`rotate(${up} ${(A[0] + B[0]) / 2} ${(A[1] + B[1]) / 2})`}>{label}</text>
    </g>
  );
}
/** each edge of a ring dimensioned outside it (sheet coordinates), skipping the short ones */
function EdgeDims({ ring, T, off = 5, min = 1.5, color }: { ring: number[]; T: (x: number, z: number) => [number, number]; off?: number; min?: number; color?: string }) {
  const n = ring.length / 2, c = T(...mid(ring));
  const out: JSX.Element[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, len = Math.hypot(ring[2 * j] - ring[2 * i], ring[2 * j + 1] - ring[2 * i + 1]);
    if (len < min) continue;
    const a = T(ring[2 * i], ring[2 * i + 1]), b = T(ring[2 * j], ring[2 * j + 1]);
    // Dim offsets to the left of a→b; flip the edge when its left is the inside
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
    const outward = nx * ((a[0] + b[0]) / 2 - c[0]) + ny * ((a[1] + b[1]) / 2 - c[1]) > 0;
    out.push(outward ? <Dim a={a} b={b} label={`${f2(len)} M`} off={off} color={color} /> : <Dim a={b} b={a} label={`${f2(len)} M`} off={off} color={color} />);
  }
  return <g>{out}</g>;
}

// ---------------- cores, openings and room sizes, as an approval plan shows them ----------------

/** a ring read as a rectangle: its length and its depth (m), along its longest edge */
function dims(q: number[]): [number, number] {
  const n = q.length / 2;
  let best = -1, ux = 1, uz = 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n, dx = q[2 * j] - q[2 * i], dz = q[2 * j + 1] - q[2 * i + 1], L = Math.hypot(dx, dz); if (L > best) { best = L; ux = dx / L; uz = dz / L; } }
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
  for (let i = 0; i < n; i++) { const s = q[2 * i] * ux + q[2 * i + 1] * uz, t = -q[2 * i] * uz + q[2 * i + 1] * ux; s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
  const a = s1 - s0, b = t1 - t0;
  return a >= b ? [a, b] : [b, a];
}

/** A core as built: walls, each stair's flights, treads, landings and the way up, lift shafts with their cars, the
 *  lobby and ducts. `k` is sheet mm per metre (detail drops away when it would be a smudge). */
function CoreDraw({ cd, T, k, fs }: { cd: CoreDetail; T: (x: number, z: number) => [number, number]; k: number; fs: number }) {
  const thin = Math.max(0.1, 0.02 * k), wall = Math.max(0.35, 0.2 * k), lbl = Math.min(2.2, Math.max(1, fs * 0.62));
  const line = (q: number[], w = thin, c = '#111') => { const a = T(q[0], q[1]), b = T(q[2], q[3]); return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={c} stroke-width={w} />; };
  return (
    <g>
      <polygon points={pts(cd.core, T)} fill="#fff" stroke="#111" stroke-width={wall} />
      {cd.lobby && (() => { const [sx, sy] = T(...mid(cd.lobby)); return <g><polygon points={pts(cd.lobby, T)} fill="#f4f2ec" stroke="none" />{k >= 2.5 && <text x={sx} y={sy + lbl * 0.35} font-size={lbl * 0.85} text-anchor="middle" fill="#555">{cd.lobbyLabel}</text>}</g>; })()}
      {cd.spare && (() => { const [sx, sy] = T(...mid(cd.spare)); return <g><polygon points={pts(cd.spare, T)} fill="#f4f2ec" stroke="#999" stroke-width={thin} />{k >= 2.5 && <text x={sx} y={sy + lbl * 0.35} font-size={lbl * 0.85} text-anchor="middle" fill="#555">COMMON LOBBY</text>}</g>; })()}
      {cd.stairs.map((st) => {
        const [sx, sy] = T(...mid(st.landings[0]));
        const p = st.path, n = p.length / 2, a = T(p[2 * n - 4], p[2 * n - 3]), b = T(p[2 * n - 2], p[2 * n - 1]);
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), ah = Math.max(0.8, 0.25 * k);
        return <g>
          <polygon points={pts(st.box, T)} fill="#fff" stroke="#111" stroke-width={wall * 0.8} />
          {st.flights.map((f) => <polygon points={pts(f, T)} fill="none" stroke="#111" stroke-width={thin * 1.5} />)}
          {k >= 2 && st.treads.map((t) => line(t))}
          {line(st.well, thin * 2)}
          {k >= 1.5 && <g>
            <polyline points={pts(p, T)} fill="none" stroke="#1b4fd8" stroke-width={thin * 1.4} />
            <path d={`M${b[0]} ${b[1]}L${b[0] - ah * Math.cos(ang - 0.45)} ${b[1] - ah * Math.sin(ang - 0.45)}L${b[0] - ah * Math.cos(ang + 0.45)} ${b[1] - ah * Math.sin(ang + 0.45)}Z`} fill="#1b4fd8" />
            {(() => { const s = T(p[0], p[1]); return <text x={s[0]} y={s[1] + lbl * 0.35} font-size={lbl * 0.8} text-anchor="middle" fill="#1b4fd8" font-weight="700">UP</text>; })()}
          </g>}
          {k >= 2.5 && <g><text x={sx} y={sy - lbl * 0.1} font-size={lbl} text-anchor="middle" font-weight="700">{st.label}</text><text x={sx} y={sy + lbl * 1.05} font-size={lbl * 0.75} text-anchor="middle">{`${f2(st.width)} M WIDE · ${st.risers} R`}</text></g>}
        </g>;
      })}
      {cd.lifts.map((l) => {
        const [sx, sy] = T(...mid(l.shaft)), c = l.car;
        return <g>
          <polygon points={pts(l.shaft, T)} fill="#fff" stroke="#111" stroke-width={wall * 0.8} />
          <polygon points={pts(c, T)} fill="none" stroke="#111" stroke-width={thin} />
          {line([c[0], c[1], c[4], c[5]])}{line([c[2], c[3], c[6], c[7]])}
          {k >= 2.5 && <g><rect x={sx - l.label.length * lbl * 0.3 - 0.4} y={sy - lbl * 0.85} width={l.label.length * lbl * 0.6 + 0.8} height={lbl * 1.15} fill="#fff" /><text x={sx} y={sy} font-size={lbl * 0.85} text-anchor="middle" font-weight="700" fill={l.fire ? '#c62828' : '#111'}>{l.label}</text><text x={sx} y={sy + lbl * 0.95} font-size={lbl * 0.65} text-anchor="middle">{l.size}</text></g>}
        </g>;
      })}
      {cd.ducts.map((q) => { const [sx, sy] = T(...mid(q)); return <g><polygon points={pts(q, T)} fill="none" stroke="#111" stroke-width={thin * 1.5} />{line([q[0], q[1], q[4], q[5]])}{line([q[2], q[3], q[6], q[7]])}{k >= 3 && <text x={sx} y={sy - 0.6} font-size={lbl * 0.7} text-anchor="middle">DUCT</text>}</g>; })}
    </g>
  );
}

/** an opening as a plan shows it: a window's three lines in the wall, a sliding door's two leaves, a hinged door's
 *  leaf and swing (into the flat) */
function OpeningDraw({ o, T, k, fs }: { o: Opening; T: (x: number, z: number) => [number, number]; k: number; fs: number }) {
  const a = T(o.x - o.ux * o.w / 2, o.z - o.uz * o.w / 2), b = T(o.x + o.ux * o.w / 2, o.z + o.uz * o.w / 2);
  const off = (m: number, p: [number, number]): [number, number] => { const q = T(o.x + o.nx * m, o.z + o.nz * m), c = T(o.x, o.z); return [p[0] + q[0] - c[0], p[1] + q[1] - c[1]]; };
  const thin = Math.max(0.1, 0.02 * k), cut = Math.max(0.6, 0.23 * k) + 0.15;
  const tag = T(o.x + o.nx * 0.9, o.z + o.nz * 0.9);
  const door = o.tag.startsWith('D'), slide = o.tag === 'SD';
  const L = (p: [number, number], q: [number, number], c = '#111', w = thin) => <line x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={c} stroke-width={w} />;
  let sym: JSX.Element;
  if (door) {
    // the leaf from the hinge (one end), opened into the flat (against the outward normal), and its arc to the other end
    const leaf = T(o.x - o.ux * o.w / 2 - o.nx * o.w, o.z - o.uz * o.w / 2 - o.nz * o.w);
    const p = [leaf[0] - a[0], leaf[1] - a[1]], q = [b[0] - a[0], b[1] - a[1]], r = Math.hypot(p[0], p[1]);
    const sweep = p[0] * q[1] - p[1] * q[0] > 0 ? 1 : 0;
    sym = <g>{L(a, leaf, '#8a5a3b', thin * 2)}<path d={`M${leaf[0]} ${leaf[1]}A${r} ${r} 0 0 ${sweep} ${b[0]} ${b[1]}`} fill="none" stroke="#8a5a3b" stroke-width={thin} /></g>;
  } else if (slide) {
    const m = (p: [number, number], q: [number, number], t: number): [number, number] => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    sym = <g>{L(off(0.05, a), off(0.05, m(a, b, 0.55)), '#8a5a3b', thin * 2)}{L(off(-0.05, m(a, b, 0.45)), off(-0.05, b), '#8a5a3b', thin * 2)}</g>;
  } else {
    sym = <g>{L(off(0.08, a), off(0.08, b), '#1b4fd8')}{L(a, b, '#1b4fd8')}{L(off(-0.08, a), off(-0.08, b), '#1b4fd8')}</g>;
  }
  return <g>{L(a, b, '#fff', cut)}{sym}{k >= 3 && <text x={tag[0]} y={tag[1] + 0.6} font-size={fs * 0.7} text-anchor="middle" fill="#333">{o.tag}</text>}</g>;
}

// ---------------- tables: blocks of rows flowed into columns and onto as many sheets as they need ----------------

type Cell = string | { t: string; c?: string; b?: boolean };
interface Col { h: string; w: number; end?: boolean }
interface Block { title: string; sub?: string; cols: Col[]; rows: Cell[][]; /** start it in a new column */ brk?: boolean }
const FS = 2.3, LH = 3.0, CHAR = 0.53; // text size, line height (mm), a character's average width in ems
const txt = (c: Cell) => (typeof c === 'string' ? c : c.t);

function wrap(s: string, w: number, size = FS): string[] {
  const max = Math.max(3, Math.floor(w / (size * CHAR)));
  const out: string[] = [];
  let line = '';
  for (let word of String(s).split(/\s+/)) {
    if (!word) continue;
    while (word.length > max) { if (line) { out.push(line); line = ''; } out.push(word.slice(0, max)); word = word.slice(max); }
    if (!line) line = word; else if (line.length + 1 + word.length <= max) line += ` ${word}`; else { out.push(line); line = word; }
  }
  if (line || !out.length) out.push(line);
  return out;
}

type Item =
  | { kind: 'title'; text: string; sub?: string; h: number }
  | { kind: 'head'; cols: Col[]; h: number }
  | { kind: 'row'; cols: Col[]; lines: string[][]; cells: Cell[]; h: number };
interface Placed { item: Item; x: number; y: number; w: number }

function rowItem(cols: Col[], cells: Cell[], w: number): Item {
  const lines = cols.map((c, i) => wrap(txt(cells[i] ?? ''), c.w * w - 2.4));
  return { kind: 'row', cols, cells, lines, h: Math.max(...lines.map((l) => l.length)) * LH + 1.8 };
}

/** lay blocks into `ncol` columns, from `top` (mm under the drawing area's top), onto pages */
function flow(blocks: Block[], ncol: number, top = 12, box = AREA): Placed[][] {
  const gap = 10, w = (box.w - gap * (ncol - 1)) / ncol, bottom = box.y + box.h;
  const pages: Placed[][] = [[]];
  let col = 0, y = box.y + top;
  const next = () => { col++; y = box.y + top; if (col >= ncol) { col = 0; pages.push([]); } };
  const put = (item: Item) => { pages[pages.length - 1].push({ item, x: box.x + col * (w + gap), y, w }); y += item.h; };
  for (const b of blocks) {
    const title: Item = { kind: 'title', text: b.title, sub: b.sub, h: b.sub ? 10 : 7 };
    const head: Item = { kind: 'head', cols: b.cols, h: 5 };
    const rows = b.rows.map((r) => rowItem(b.cols, r, w));
    if ((b.brk && y > box.y + top) || y + title.h + head.h + (rows[0]?.h ?? 0) > bottom) next();
    put(title); put(head);
    for (const r of rows) {
      if (y + r.h > bottom) { next(); put({ kind: 'title', text: `${b.title} (continued)`, h: 7 }); put(head); }
      put(r);
    }
    y += 5;
  }
  return pages.filter((p) => p.length);
}

function Placed({ p }: { p: Placed }) {
  const { item, x, y, w } = p;
  if (item.kind === 'title') return <g><text x={x} y={y + 4.2} font-size="3.2" font-weight="700">{item.text.toUpperCase()}</text>{item.sub && <text x={x} y={y + 8} font-size="2.2" fill="#666">{item.sub}</text>}</g>;
  let cx = x;
  if (item.kind === 'head') return <g><rect x={x} y={y} width={w} height={item.h} fill="#f0eee8" />{item.cols.map((c) => { const at = cx; cx += c.w * w; return <text x={c.end ? at + c.w * w - 1.2 : at + 1.2} y={y + 3.4} font-size="2.2" font-weight="700" text-anchor={c.end ? 'end' : 'start'}>{c.h.toUpperCase()}</text>; })}</g>;
  return (
    <g>
      <line x1={x} y1={y + item.h} x2={x + w} y2={y + item.h} stroke="#ddd" stroke-width="0.2" />
      {item.cols.map((c, i) => {
        const at = cx; cx += c.w * w;
        const cell = item.cells[i], color = typeof cell === 'object' ? cell.c : undefined, bold = typeof cell === 'object' && cell.b;
        return <g>{item.lines[i].map((l, li) => <text x={c.end ? at + c.w * w - 1.2 : at + 1.2} y={y + 3 + li * LH} font-size={FS} fill={color ?? '#111'} font-weight={bold ? '700' : undefined} text-anchor={c.end ? 'end' : 'start'}>{l}</text>)}</g>;
      })}
    </g>
  );
}

/** a single block drawn at a place (it must fit) */
function TableAt({ block, x, y, w }: { block: Block; x: number; y: number; w: number }) {
  const page = flow([block], 1, 0, { x, y, w, h: 1000 })[0] ?? [];
  return <g><rect x={x - 2} y={y - 2} width={w + 4} height={tableH(block, w) + 2} fill="#fff" stroke="#111" stroke-width="0.25" />{page.map((p) => <Placed p={p} />)}</g>;
}
const tableH = (b: Block, w: number) => (b.sub ? 10 : 7) + 5 + b.rows.reduce((s, r) => s + rowItem(b.cols, r, w).h, 0);

// ---------------- what the sheets say ----------------

const STATUS: Record<CheckStatus, { t: string; c: string }> = { pass: { t: 'PASS', c: '#2a7a3e' }, fail: { t: 'FAIL', c: '#c62828' }, warn: { t: 'CHECK', c: '#b26a00' }, info: { t: 'NOTE', c: '#555' } };

/** the plot's edges after the DP road widening: each one's length, whether it faces a road, the margin it needs and
 *  the nearest a building comes to it (with where, to dimension it) */
interface EdgeMargin { i: number; road: boolean; len: number; need: number; have: number | null; from: [number, number] | null; to: [number, number] | null; b: number }
function edgeMargins(e: Evaluated): EdgeMargin[] {
  const { r, d } = e, R = r.rules;
  const net = r.net.length >= 6 ? r.net : outline(e.p).ring, n = net.length / 2;
  const shapes = d.buildings.map((b) => (b.laid ? [b.laid.outline] : b.quads));
  const out: EdgeMargin[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ax = net[2 * i], az = net[2 * i + 1], bx = net[2 * j], bz = net[2 * j + 1];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    let best = Infinity, from: [number, number] | null = null, to: [number, number] | null = null, bi = -1;
    shapes.forEach((qs, k) => qs.forEach((q) => {
      for (let v = 0; v < q.length; v += 2) {
        const t = Math.max(0, Math.min(1, ((q[v] - ax) * dx + (q[v + 1] - az) * dz) / (len * len)));
        const fx = ax + dx * t, fz = az + dz * t, dist = Math.hypot(q[v] - fx, q[v + 1] - fz);
        if (dist < best) { best = dist; from = [fx, fz]; to = [q[v], q[v + 1]]; bi = k; }
      }
    }));
    const road = !!r.edges[i];
    const need = road ? R.front : sideMargin(R, bi >= 0 ? d.buildings[bi].height : d.height);
    out.push({ i, road, len, need, have: Number.isFinite(best) ? best : null, from, to, b: bi });
  }
  return out;
}

function keyFigures(e: Evaluated): Block {
  const { r, d, shops } = e, R = r.rules;
  const flats = [0, 1, 2].filter((t) => d.count[t]).map((t) => `${d.count[t]} × ${UNIT_LABEL[t]}`).join(', ');
  const rows: Cell[][] = [
    ['Plot area (as per the record)', m2(r.area)],
    ...(r.lost > 0.01 ? [['Less: road widening (DP)', m2(r.lost)], ['Net plot area', m2(r.netArea)]] : []),
    ['Road for the rules', `${f2(r.roadW)} m`],
    ['Permissible built-up area', m2(r.bua)],
    [{ t: 'Proposed built-up area', b: true }, { t: m2(d.bua), b: true, c: d.bua > r.bua + 1 ? '#c62828' : undefined }],
    ['FSI used', f2(d.fsi)],
    ['Ground coverage', `${m2(d.coverage * r.area)} · ${Math.round(d.coverage * 100)}%`],
    ['Buildings', d.buildings.length ? d.buildings.map((b, i) => `${letter(i)}: ${d.under ? 'S+' : 'G+'}${b.floors}`).join(', ') : 'none'],
    ['Height', { t: `${f2(d.height)} m (limit ${f2(R.maxH)} m)`, c: d.over.height ? '#c62828' : undefined }],
    ['Flats', `${d.flats}${flats ? ` (${flats})` : ''}`],
    ...(shops ? [['Shops', `${shops.count} · ${m2(shops.carpet)} carpet`]] : []),
    ...(d.count[3] ? [['Other units', `${d.count[3]}`]] : []),
    ['Carpet (RERA)', `${m2(d.carpet)} · ${nf(d.carpet * SQFT)} sq ft`],
    ['Parking', { t: `${d.parking.have} of ${d.parking.need} car bays`, c: d.parking.have < d.parking.need ? '#c62828' : undefined }],
    ['Recreational open space', { t: `${m2(d.open.have)} (needs ${m2(d.open.need)})`, c: d.over.open ? '#c62828' : undefined }],
  ];
  return { title: 'Key figures', cols: [{ h: 'Item', w: 0.52 }, { h: 'Value', w: 0.48, end: true }], rows };
}

function Cover({ e, checks, titles, no, total }: { e: Evaluated; checks: Check[]; titles: string[]; no: number; total: number }) {
  const s = { pass: 0, fail: 0, warn: 0, info: 0 };
  for (const c of checks) s[c.status]++;
  const issues = checks.filter((c) => c.status === 'fail' || c.status === 'warn');
  const kind = permissionOf(e, e.p.approval?.kind);
  const blocks: Block[] = [
    keyFigures(e),
    { title: 'Sheets', brk: true, cols: [{ h: 'No.', w: 0.16 }, { h: 'Drawing', w: 0.84 }], rows: titles.map((t, i) => [`UP-${String(i + 1).padStart(2, '0')}`, t]) },
    {
      title: 'Scrutiny', sub: 'Advisory: the authority’s own scrutiny has the last word.',
      cols: [{ h: 'Result', w: 0.7 }, { h: 'Rules', w: 0.3, end: true }],
      rows: [[{ t: 'Pass', c: STATUS.pass.c }, `${s.pass}`], [{ t: 'Fail', c: STATUS.fail.c }, `${s.fail}`], [{ t: 'To check', c: STATUS.warn.c }, `${s.warn}`], [{ t: 'Notes (a step it triggers)', c: STATUS.info.c }, `${s.info}`]],
    },
    ...(issues.length ? [{
      title: 'Needs attention', cols: [{ h: '', w: 0.17 }, { h: 'Rule', w: 0.38 }, { h: 'Proposed', w: 0.45 }],
      rows: issues.slice(0, 14).map((c): Cell[] => [STATUS[c.status], c.rule, c.proposed]).concat(issues.length > 14 ? [['', `and ${issues.length - 14} more: see the scrutiny report`, '']] : []),
    } satisfies Block] : []),
    {
      title: 'General notes', brk: true, cols: [{ h: '', w: 0.07 }, { h: 'Note', w: 0.93 }],
      rows: [
        'All dimensions are in metres and areas in square metres, unless noted.',
        `Rules: ${CITIES.find((c) => c.value === e.p.city)?.note ?? rulesName(e)}.`,
        'Margins are measured from the plot boundary after the DP road widening, to the nearest face of each building.',
        'Built-up areas are as modelled; carpet areas as RERA 2016 s.2(k). Parking floors and the stilt are free of FSI.',
        'Fees and charges are rough figures to plan cash with, not a demand note.',
        'Prepared for discussion. The architect checks, signs and submits; the authority’s scrutiny prevails.',
      ].map((t, i) => [`${i + 1}`, t]),
    },
  ];
  const page = flow(blocks, 3, 34)[0] ?? [];
  return (
    <Frame e={e} title="Cover and key figures" no={no} total={total} scale="NTS">
      <text x={AREA.x} y={AREA.y + 9} font-size="8" font-weight="700">{e.p.name.length > 48 ? `${e.p.name.slice(0, 47)}…` : e.p.name}</text>
      <text x={AREA.x} y={AREA.y + 17} font-size="4">Building permission: drawings, area statement and scrutiny</text>
      <text x={AREA.x} y={AREA.y + 23.5} font-size="3" fill="#444">{`${PERMISSION_LABEL[kind]} · ${cityLabel(e)} · ${rulesName(e)}${e.p.at ? ` · ${e.p.at[0].toFixed(5)}° N, ${e.p.at[1].toFixed(5)}° E` : ''}`}</text>
      <line x1={AREA.x} y1={AREA.y + 28} x2={AREA.x + AREA.w} y2={AREA.y + 28} stroke="#111" stroke-width="0.3" />
      {page.map((p) => <Placed p={p} />)}
    </Frame>
  );
}

function SitePlan({ e, no, total }: { e: Evaluated; no: number; total: number }) {
  const { p, r, d } = e, { ring, roads } = outline(p);
  const lines = roadLines(ring, roads);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); }
  const padM = Math.max(10, ...lines.map((l) => Math.max(l.road.today, l.road.dp) + 3));
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
  const fp = r.footprint, G = d.ground;
  const margins = edgeMargins(e);
  const mt: Block = {
    title: 'Margins', sub: 'From the plot boundary (after road widening) to the nearest building',
    cols: [{ h: 'Edge', w: 0.16 }, { h: 'Faces', w: 0.2 }, { h: 'Required', w: 0.2, end: true }, { h: 'Provided', w: 0.22, end: true }, { h: '', w: 0.22, end: true }],
    rows: margins.filter((m) => m.have !== null).map((m): Cell[] => {
      const ok = (m.have ?? 0) + 0.01 >= m.need;
      return [`${m.i + 1}${m.b >= 0 && d.buildings.length > 1 ? ` (${letter(m.b)})` : ''}`, m.road ? 'Road (front)' : 'Side / rear', `${f2(m.need)} m`, `${f2(m.have ?? 0)} m`, ok ? STATUS.pass : STATUS.fail];
    }),
  };
  const st: Block = {
    title: 'Site', cols: [{ h: 'Item', w: 0.6 }, { h: 'Area', w: 0.4, end: true }],
    rows: [
      ['Plot area', m2(r.area)], ...(r.lost > 0.01 ? [['Road widening (DP)', m2(r.lost)], ['Net plot area', m2(r.netArea)]] : []),
      ['Ground coverage', `${m2(d.coverage * r.area)} (${Math.round(d.coverage * 100)}%)`],
      ['Open space: required', m2(d.open.need)], ['Open space: provided', m2(d.open.have)],
    ],
  };
  const tw = 96, mtH = tableH(mt, tw), stH = tableH(st, tw);
  const net = r.net.length >= 6 ? r.net : ring;
  return (
    <Frame e={e} title="Site plan" no={no} total={total} scale={`1:${scale}`}>
      <g>
        {roadEls}
        <polygon points={pts(ring, T)} fill="#fbfaf6" stroke="#111" stroke-width="0.6" />
        {r.lostRings.map((lr) => <polygon points={pts(lr, T)} fill="url(#hatch-dp)" stroke="#d33" stroke-width="0.3" />)}
        {d.ground.gardens.map((g) => <polygon points={pts(g, T)} fill="url(#hatch-open)" stroke="#3a8f5a" stroke-width="0.2" />)}
        {/* internal roads and the drive: the carriageway, then its edges */}
        {[...G.roads.map((x) => ({ q: x.pts, w: x.w })), ...G.drive.map((q) => ({ q, w: G.driveW }))].filter((x) => x.q.length >= 4).map((x) => <g>
          <polyline points={pts(x.q, T)} fill="none" stroke="#9a978f" stroke-width={x.w * k + 0.3} stroke-linejoin="round" />
          <polyline points={pts(x.q, T)} fill="none" stroke="#f1efe9" stroke-width={x.w * k} stroke-linejoin="round" />
        </g>)}
        {G.circles.map(([x, z, rr]) => { const [sx, sy] = T(x, z); return <circle cx={sx} cy={sy} r={rr * k} fill="#f1efe9" stroke="#9a978f" stroke-width="0.2" />; })}
        {/* what is on the site already: trees kept, structures, lines, ground kept clear */}
        {(p.features ?? []).map((f) => {
          const sh = featureOf(f.kind).shape;
          if (sh === 'point') { const [x, y] = T(f.pts[0], f.pts[1]), rr = (f.r ?? 1) * (T(f.pts[0] + 1, f.pts[1])[0] - x); return <g><circle cx={x} cy={y} r={Math.max(0.6, rr)} fill="none" stroke={f.kind === 'tree' ? '#3a8f5a' : '#555'} stroke-width="0.25" /><circle cx={x} cy={y} r="0.3" fill="#111" /></g>; }
          if (sh === 'line') return <polyline points={pts(f.pts, T)} fill="none" stroke="#555" stroke-width="0.35" stroke-dasharray="3 1 0.6 1" />;
          return <polygon points={pts(f.pts, T)} fill={f.kind === 'nobuild' ? 'url(#hatch-dp)' : '#eee'} stroke="#555" stroke-width="0.3" stroke-dasharray={f.kind === 'nobuild' ? '1.5 1' : undefined} />;
        })}
        {fp.length >= 6 && <polygon points={pts(fp, T)} fill="none" stroke="#1b4fd8" stroke-width="0.3" stroke-dasharray="2 1" />}
        {surface.flatMap((l) => l.bays).map((b) => <polygon points={pts(b, T)} fill="none" stroke="#999" stroke-width="0.15" />)}
        {/* the compound wall and its gates */}
        {G.wall.filter((q) => q.length >= 4).map((q) => <polyline points={pts(q, T)} fill="none" stroke="#111" stroke-width="0.7" />)}
        {G.gates.map((g) => { const a = T(g[0], g[1]), b = T(g[2], g[3]); return <g><line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#fff" stroke-width="1.2" /><line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#111" stroke-width="0.15" stroke-dasharray="0.8 0.8" /><text x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2 - 1.6} font-size="1.9" text-anchor="middle">GATE</text></g>; })}
        {d.buildings.map((b, i) => (b.laid ? [b.laid.outline] : b.quads).map((q) => <polygon points={pts(q, T)} fill="#d9d4c8" stroke="#111" stroke-width="0.5" />).concat([
          (() => { const [x, z] = mid(b.laid ? b.laid.outline : b.quads[0]); const [sx, sy] = T(x, z); return <g><text x={sx} y={sy} font-size="4" font-weight="700" text-anchor="middle">{`BUILDING ${letter(i)}`}</text><text x={sx} y={sy + 4.5} font-size="2.6" text-anchor="middle">{`${d.under ? 'STILT + ' : ''}${b.floors} FLOORS · ${f2(b.height)} M`}</text></g>; })(),
        ]))}
        {/* the plot's edges, each dimensioned outside it, and numbered as the margins table */}
        <EdgeDims ring={ring} T={T} off={4} color="#111" />
        {margins.map((m) => { const n2 = net.length / 2, j = (m.i + 1) % n2, [sx, sy] = T((net[2 * m.i] + net[2 * j]) / 2, (net[2 * m.i + 1] + net[2 * j + 1]) / 2); return <g><circle cx={sx} cy={sy} r="1.9" fill="#fff" stroke="#111" stroke-width="0.25" /><text x={sx} y={sy + 0.85} font-size="2.2" font-weight="700" text-anchor="middle">{m.i + 1}</text></g>; })}
        {/* the margin provided on each edge: from the edge to the nearest building */}
        {margins.filter((m) => m.from && m.to && (m.have ?? 99) < 60 && (m.have ?? 0) > 0.05).map((m) => <Dim a={T(...m.from!)} b={T(...m.to!)} label={`${f2(m.have!)} M`} color={(m.have ?? 0) + 0.01 >= m.need ? '#1b4fd8' : '#c62828'} />)}
      </g>
      <g font-size="2.6">
        <rect x={AREA.x} y={AREA.y} width="78" height="46" fill="#fff" stroke="#111" stroke-width="0.25" />
        <text x={AREA.x + 3} y={AREA.y + 5} font-weight="700">LEGEND</text>
        <rect x={AREA.x + 3} y={AREA.y + 8} width="6" height="3" fill="#d9d4c8" stroke="#111" stroke-width="0.3" /><text x={AREA.x + 12} y={AREA.y + 10.5}>Proposed building</text>
        <line x1={AREA.x + 3} y1={AREA.y + 15} x2={AREA.x + 9} y2={AREA.y + 15} stroke="#1b4fd8" stroke-width="0.3" stroke-dasharray="2 1" /><text x={AREA.x + 12} y={AREA.y + 16}>Margin line (buildable edge)</text>
        <rect x={AREA.x + 3} y={AREA.y + 19} width="6" height="3" fill="url(#hatch-dp)" stroke="#d33" stroke-width="0.3" /><text x={AREA.x + 12} y={AREA.y + 21.5}>Road widening (DP)</text>
        <rect x={AREA.x + 3} y={AREA.y + 25} width="6" height="3" fill="url(#hatch-open)" stroke="#3a8f5a" stroke-width="0.3" /><text x={AREA.x + 12} y={AREA.y + 27.5}>Open space</text>
        <line x1={AREA.x + 3} y1={AREA.y + 32} x2={AREA.x + 9} y2={AREA.y + 32} stroke="#111" stroke-width="0.7" /><text x={AREA.x + 12} y={AREA.y + 33}>Compound wall</text>
        <rect x={AREA.x + 3} y={AREA.y + 36} width="6" height="3" fill="#f1efe9" stroke="#9a978f" stroke-width="0.3" /><text x={AREA.x + 12} y={AREA.y + 38.5}>Internal road</text>
        <text x={AREA.x + 3} y={AREA.y + 44}>{`Parking: ${d.parking.have} bays (${d.parking.need} needed)${stilt ? `, ${stilt.bays.length} under the stilt` : ''}`}</text>
      </g>
      {/* the tables top right, clear of the road (the front is drawn at the bottom) */}
      <TableAt block={st} x={AREA.x + AREA.w - tw - 2} y={AREA.y + 2} w={tw} />
      <TableAt block={mt} x={AREA.x + AREA.w - tw - 2} y={AREA.y + stH + 8} w={tw} />
      <North x={AREA.x + 88} y={AREA.y + 12} />
      <ScaleBar x={AREA.x} y={AREA.y + AREA.h - 6} k={k} scale={scale} />
    </Frame>
  );
}

function FloorPlan({ e, rooms, no, total }: { e: Evaluated; rooms: FlatRooms[][]; no: number; total: number }) {
  const { d, plans, shops } = e;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const b of d.buildings) for (const q of b.quads) for (let i = 0; i < q.length; i += 2) { x0 = Math.min(x0, q[i]); x1 = Math.max(x1, q[i]); z0 = Math.min(z0, q[i + 1]); z1 = Math.max(z1, q[i + 1]); }
  if (!d.buildings.length) { x0 = z0 = 0; x1 = z1 = 10; }
  const { scale, k, T } = planFrame(x0 - 6, z0 - 6, x1 + 6, z1 + 6);
  const fs = Math.min(2.6, Math.max(1.2, 0.9 * k)), roomsShown = k >= 3.9;
  return (
    <Frame e={e} title="Typical floor plan" no={no} total={total} scale={`1:${scale}`}>
      <g>
        {d.buildings.map((b, bi) => {
          const outer = b.laid ? floorRings(e, bi, b.typical ?? 0) : b.quads;
          return (
            <g>
              {/* walls at their thickness: 230 mm outside and round the flats, 115 mm partitions */}
              {outer.map((q) => <polygon points={pts(q, T)} fill="#fff" stroke="#111" stroke-width={Math.max(0.6, 0.23 * k)} stroke-linejoin="miter" />)}
              {b.corridors.map((c) => <polygon points={pts(c, T)} fill="#f1efe9" stroke="#777" stroke-width="0.2" />)}
              {b.units.map((u, ui) => {
                const shop = shops?.removed.get(bi)?.has(ui), fr = rooms[bi]?.find((x) => x.unit === ui);
                const withRooms = roomsShown && fr && fr.rooms.length > 0;
                // with rooms, the flat's label sits over its biggest room (inside the flat whatever its shape)
                const main = withRooms ? fr!.rooms.filter((x) => x.kind === 'living' || x.kind === 'bed') : [];
                const big = withRooms ? (main.length ? main : fr!.rooms).reduce((a, x) => (x.area > a.area ? x : a)) : null;
                const [cx, cy] = T(...mid(big ? big.ring : u.ring));
                return <g>
                  <polygon points={pts(u.ring, T)} fill={UNIT_COLOR[u.t]} fill-opacity="0.16" stroke="#111" stroke-width={Math.max(0.35, 0.2 * k)} />
                  {withRooms && fr!.rooms.map((rm) => {
                    const [sx, sy] = T(...mid(rm.ring));
                    // the name as fits the room: whole, its first word, or left off (the area stays)
                    let rx0 = Infinity, rx1 = -Infinity;
                    for (let i = 0; i < rm.ring.length; i += 2) { const [u] = T(rm.ring[i], rm.ring[i + 1]); rx0 = Math.min(rx0, u); rx1 = Math.max(rx1, u); }
                    const room = (rx1 - rx0) - 1, sz = fs * 0.62, fits = (s: string) => s.length * sz * 0.6 <= room;
                    const full = rm.name.toUpperCase(), first = full.split(/\s+/)[0];
                    const name = fits(full) ? full : fits(first) ? first : '';
                    // its size as a plan states it (length × width) when it fits, its area under
                    const [rl, rw] = dims(rm.ring), size = `${f2(rl)} × ${f2(rw)}`, sizeFits = size.length * fs * 0.5 * 0.6 <= room;
                    const c = rm.ok ? '#222' : '#c62828';
                    return <g>
                      <polygon points={pts(rm.ring, T)} fill="none" stroke="#666" stroke-width="0.12" />
                      {name && <text x={sx} y={sy - (sizeFits ? fs * 0.3 : 0)} font-size={sz} text-anchor="middle" fill={c}>{name}</text>}
                      {sizeFits && <text x={sx} y={sy + fs * 0.42} font-size={fs * 0.5} text-anchor="middle" fill={c}>{size}</text>}
                      <text x={sx} y={sy + (name ? fs * (sizeFits ? 1.05 : 0.75) : 0.6)} font-size={fs * 0.48} text-anchor="middle" fill={rm.ok ? '#666' : '#c62828'}>{`${f2(rm.area)} m²`}</text>
                    </g>;
                  })}
                  {withRooms && fr!.walls.map((w) => { const a = T(w[0], w[1]), c = T(w[2], w[3]); return <line x1={a[0]} y1={a[1]} x2={c[0]} y2={c[1]} stroke="#111" stroke-width={Math.max(0.25, 0.115 * k)} />; })}
                  {withRooms
                    ? (() => { const s = `${UNIT_LABEL[u.t]}${shop ? ' *' : ''} · ${f2(u.carpet)} m²`, sz = fs * 0.78, w = s.length * sz * 0.58 + 1.4, top = cy - fs * 0.75 - sz * 1.6; return <g><rect x={cx - w / 2} y={top} width={w} height={sz * 1.35} fill="#fff" stroke="#111" stroke-width="0.12" /><text x={cx} y={top + sz * 1.02} font-size={sz} font-weight="700" text-anchor="middle">{s}</text></g>; })()
                    : <g><text x={cx} y={cy} font-size={fs * 1.1} font-weight="700" text-anchor="middle">{UNIT_LABEL[u.t]}{shop ? ' *' : ''}</text><text x={cx} y={cy + fs * 1.3} font-size={fs * 0.9} text-anchor="middle">{`${f2(u.carpet)} m²`}</text></g>}
                </g>;
              })}
              {buildingCores(e, bi).map((cd) => <CoreDraw cd={cd} T={T} k={k} fs={fs} />)}
              {plans[bi]?.openings.map((o) => <OpeningDraw o={o} T={T} k={k} fs={fs} />)}
              {/* overall dimensions: along the bottom and up the right */}
              {(() => {
                let a = Infinity, c = -Infinity, lo = Infinity, hi = -Infinity;
                for (const q of outer) for (let i = 0; i < q.length; i += 2) { a = Math.min(a, q[i]); c = Math.max(c, q[i]); lo = Math.min(lo, q[i + 1]); hi = Math.max(hi, q[i + 1]); }
                if (!Number.isFinite(a)) return null;
                // the section line A–A: across the building through its first core, looking up the sheet
                const cz = b.cores[0] ? mid(b.cores[0])[1] : (lo + hi) / 2;
                const sa = T(a - 3, cz), sb = T(c + 3, cz);
                return <g>
                  <Dim a={T(a, lo)} b={T(c, lo)} label={`${f2(c - a)} M`} off={7} color="#111" />
                  <Dim a={T(c, hi)} b={T(c, lo)} label={`${f2(hi - lo)} M`} off={-7} color="#111" />
                  {bi === 0 && <g stroke="#c62828" fill="#c62828">
                    <line x1={sa[0]} y1={sa[1]} x2={sb[0]} y2={sb[1]} stroke-width="0.3" stroke-dasharray="6 1.5 1 1.5" />
                    {[sa, sb].map((p) => <g><path d={`M${p[0] - 1.6} ${p[1]}L${p[0] + 1.6} ${p[1]}L${p[0]} ${p[1] - 3}Z`} stroke="none" /><text x={p[0]} y={p[1] + 3.6} font-size="2.8" font-weight="700" text-anchor="middle" stroke="none">A</text></g>)}
                  </g>}
                </g>;
              })()}
            </g>
          );
        })}
      </g>
      <g font-size="2.6">
        <text x={AREA.x} y={AREA.y + 4} font-weight="700">TYPICAL FLOOR</text>
        <text x={AREA.x} y={AREA.y + 8}>{d.buildings.map((b, i) => `${letter(i)}: ${b.laid ? `${b.repeats ?? 1} of ${b.floors} floors (the rest on its floor plans)` : `${b.floors} floors`}`).join(' · ')}</text>
        {shops && shops.removedFlats > 0 && <text x={AREA.x} y={AREA.y + 12}>* shops instead on the lower floors</text>}
        <text x={AREA.x} y={AREA.y + 16} fill="#1b4fd8">Windows (blue), doors with their swing (brown); tags as the door and window schedule</text>
        {roomsShown && <text x={AREA.x} y={AREA.y + 20} fill="#555">Rooms: length × width (m) and carpet area; in red, a room under its minimum size</text>}
        <text x={AREA.x} y={AREA.y + 24} fill="#555">Walls 230 mm outside and between flats, 115 mm inside. Stairs: R = risers a floor, 175 mm; treads 250 mm.</text>
      </g>
      <North x={AREA.x + AREA.w - 8} y={AREA.y + 12} />
      <ScaleBar x={AREA.x} y={AREA.y + AREA.h - 6} k={k} scale={scale} />
    </Frame>
  );
}

function Elevation({ e, no, total }: { e: Evaluated; no: number; total: number }) {
  const { d, r, ds, shops } = e;
  const fh = r.rules.floorH, under = d.under;
  // each building's front face: its x extent, side by side with a gap where they'd overlap
  const spans = d.buildings.map((b) => { let a = Infinity, c = -Infinity; for (const q of b.quads) for (let i = 0; i < q.length; i += 2) { a = Math.min(a, q[i]); c = Math.max(c, q[i]); } return [a, c]; });
  let cursor = 0;
  const placed = spans.map(([a, c]) => { const w = c - a, x = cursor; cursor += w + 8; return { x, w }; });
  const totalW = Math.max(10, cursor - 8), totalH = Math.max(...d.buildings.map((b) => (b.laid ? b.height : (under + b.floors) * fh) + 4), 10);
  const need = Math.max((totalW + 20) * 1000 / AREA.w, (totalH + 12) * 1000 / AREA.h);
  const scale = SCALES.find((s) => s >= need) ?? 2000, k = 1000 / scale;
  const gx = AREA.x + (AREA.w - totalW * k) / 2, gy = AREA.y + AREA.h - 18;
  const X = (m: number) => gx + m * k, Y = (m: number) => gy - m * k;
  return (
    <Frame e={e} title="Elevation" no={no} total={total} scale={`1:${scale}`}>
      <line x1={AREA.x} y1={gy} x2={AREA.x + AREA.w} y2={gy} stroke="#111" stroke-width="0.6" />
      <text x={AREA.x} y={gy + 4} font-size="2.4">GROUND LEVEL ±0.00</text>
      {r.rules.maxH > 0 && Y(r.rules.maxH) > AREA.y + 14 && <g><line x1={AREA.x} y1={Y(r.rules.maxH)} x2={AREA.x + AREA.w} y2={Y(r.rules.maxH)} stroke="#c62828" stroke-width="0.25" stroke-dasharray="3 1.5" /><text x={AREA.x + AREA.w} y={Y(r.rules.maxH) - 1} font-size="2.2" fill="#c62828" text-anchor="end">{`HEIGHT LIMIT +${f2(r.rules.maxH)}`}</text></g>}
      {d.buildings.map((b, bi) => {
        const { x, w } = placed[bi], top = (under + b.floors) * fh;
        if (b.laid) {
          // a formed building: each floor at its own height, as wide as its own outline (a taper or a lean shows)
          const x0 = spans[bi][0];
          let y = under * fh;
          return <g>
            {b.laid.floors.map((f, fi) => {
              let a = Infinity, c = -Infinity;
              for (const q of floorRings(e, bi, fi)) for (let i = 0; i < q.length; i += 2) { a = Math.min(a, q[i]); c = Math.max(c, q[i]); }
              const y0 = y; y += f.h;
              return <g>
                <rect x={X(x + a - x0)} y={Y(y0 + f.h)} width={Math.max(0, c - a) * k} height={f.h * k} fill={floorKind(f, b.use) === 'residential' ? ds.facade.wall : '#cfe3f3'} stroke="#111" stroke-width="0.3" />
                <text x={X(x) - 1.5} y={Y(y0 + f.h / 2) + 0.8} font-size="1.9" text-anchor="end">{`${fi + 1}F +${f2(y0)}`}</text>
              </g>;
            })}
            <Dim a={[X(x + w) + 6, Y(0)]} b={[X(x + w) + 6, Y(b.height)]} label={`${f2(b.height)} M`} />
            <text x={X(x + w / 2)} y={gy + 8} font-size="3" font-weight="700" text-anchor="middle">{`BUILDING ${letter(bi)}`}</text>
            <text x={X(x + w / 2)} y={gy + 12} font-size="2.3" text-anchor="middle">{`${under ? 'Stilt + ' : ''}${b.floors} floors${b.laid.roof ? ', height to the middle of the roof' : ''}`}</text>
          </g>;
        }
        const shopFloors = shops && shops.strips.some((s) => s.b === bi) ? 1 + shops.upperOf[bi] : 0;
        // the composition's zones, each in its tone, a string course between
        const C = compositionOf(ds), Z = zonesOf(C, b.floors), col = (t: Tone) => ds.facade[t];
        const fillOf = (f: number) => (f < Z.base ? col(C.base.tone) : f >= b.floors - Z.top ? col(C.top.tone) : ds.facade.wall);
        const course = [Z.base ? under + Z.base : 0, Z.top ? under + b.floors - Z.top : 0].filter((v) => v > 0);
        return (
          <g>
            {/* stilt: columns */}
            {under > 0 && Array.from({ length: Math.max(2, Math.round(w / 6) + 1) }, (_, i) => <rect x={X(x + (w * i) / Math.max(1, Math.round(w / 6))) - 0.6} y={Y(under * fh)} width="1.2" height={under * fh * k} fill={shopFloors ? '#9cc3e6' : '#888'} />)}
            {shopFloors > 0 && <rect x={X(x)} y={Y(under * fh)} width={w * k} height={under * fh * k} fill="#cfe3f3" stroke="#111" stroke-width="0.3" />}
            {Array.from({ length: b.floors }, (_, f) => {
              const y = (under + f) * fh, shop = f < (shopFloors ? shopFloors - 1 : 0);
              return <g>
                <rect x={X(x)} y={Y(y + fh)} width={w * k} height={fh * k} fill={shop ? '#cfe3f3' : fillOf(f)} stroke="#111" stroke-width="0.3" />
                <text x={X(x) - 1.5} y={Y(y + fh / 2) + 0.8} font-size="1.9" text-anchor="end">{`${f + 1}F +${f2(y)}`}</text>
              </g>;
            })}
            {course.map((fl) => <line x1={X(x) - 0.4} y1={Y(fl * fh)} x2={X(x + w) + 0.4} y2={Y(fl * fh)} stroke="#111" stroke-width="0.9" />)}
            {b.floors >= ZONED_FROM && C.top.crown === 'cornice' && <rect x={X(x) - 0.5} y={Y(top + 1.2)} width={w * k + 1} height={0.5 * k} fill="#111" />}
            {/* parapet and the lift room */}
            <rect x={X(x)} y={Y(top + 1)} width={w * k} height={1 * k} fill="none" stroke="#111" stroke-width="0.3" />
            <rect x={X(x + w / 2 - 2.5)} y={Y(top + 3)} width={5 * k} height={3 * k} fill="#ccc" stroke="#111" stroke-width="0.3" />
            <Dim a={[X(x + w) + 6, Y(0)]} b={[X(x + w) + 6, Y(top)]} label={`${f2(top)} M`} />
            <text x={X(x + w / 2)} y={gy + 8} font-size="3" font-weight="700" text-anchor="middle">{`BUILDING ${letter(bi)}`}</text>
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

/** the parking levels with a plan of their own (the stilt, podium decks, basements), alike basements together */
type Lvl = Evaluated['d']['parking']['levels'][number];
function parkingGroups(e: Evaluated): { title: string; lv: Lvl; n: number }[] {
  const out: { title: string; lv: Lvl; n: number; a: number; z: number }[] = [];
  let bn = 0, pn = 0;
  for (const lv of e.d.parking.levels) {
    if (!lv.bays.length || !(lv.kind === 'stilt' || lv.kind === 'podium' || lv.kind === 'basement')) continue;
    const no = lv.kind === 'basement' ? ++bn : lv.kind === 'podium' ? ++pn : 0;
    const last = out[out.length - 1];
    if (last && last.lv.kind === lv.kind && last.lv.bays.length === lv.bays.length && lv.kind !== 'stilt') { last.z = no; last.n++; continue; }
    out.push({ title: '', lv, n: 1, a: no, z: no });
  }
  for (const g of out) {
    const name = g.lv.kind === 'stilt' ? 'Stilt' : g.lv.kind === 'podium' ? 'Podium' : 'Basement';
    g.title = g.lv.kind === 'stilt' ? 'Stilt (parking) plan' : g.a === g.z ? `${name} ${g.a} plan` : `${name}s ${g.a}–${g.z} plan (each)`;
  }
  return out;
}

/** A parking level: its bays numbered, the ramp, the columns, exit stairs and the cores coming down. */
function ParkingPlan({ e, title, lv, n, no, total }: { e: Evaluated; title: string; lv: Lvl; n: number; no: number; total: number }) {
  const { d, r } = e, { ring } = outline(e.p);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const grow = (q: number[]) => { for (let i = 0; i < q.length; i += 2) { x0 = Math.min(x0, q[i]); x1 = Math.max(x1, q[i]); z0 = Math.min(z0, q[i + 1]); z1 = Math.max(z1, q[i + 1]); } };
  grow(ring);
  const { scale, k, T } = planFrame(x0 - 4, z0 - 4, x1 + 4, z1 + 4);
  const fs = Math.min(2.6, Math.max(1.2, 0.9 * k));
  const below = lv.kind === 'basement';
  const [bl, bw] = lv.bays.length ? dims(lv.bays[0]) : [5, 2.5];
  return (
    <Frame e={e} title={title} no={no} total={total} scale={`1:${scale}`}>
      <g>
        <polygon points={pts(ring, T)} fill={below ? '#f6f5f1' : '#fbfaf6'} stroke="#111" stroke-width={below ? 0.25 : 0.5} stroke-dasharray={below ? '3 1.5' : undefined} />
        {/* the buildings above: their outline (dashed below ground) */}
        {d.buildings.map((b) => (b.laid ? [b.laid.outline] : b.quads).map((q) => <polygon points={pts(q, T)} fill={below ? 'none' : '#fff'} stroke="#111" stroke-width={below ? 0.25 : 0.6} stroke-dasharray={below ? '2 1' : undefined} />))}
        {lv.bays.map((q, i) => { const [sx, sy] = T(...mid(q)); return <g><polygon points={pts(q, T)} fill="#fff" stroke="#555" stroke-width="0.18" />{k >= 1.8 && <text x={sx} y={sy + fs * 0.25} font-size={fs * 0.6} text-anchor="middle" fill="#333">{i + 1}</text>}</g>; })}
        {lv.ramp && lv.ramp.length >= 6 && (() => { const [sx, sy] = T(...mid(lv.ramp)); return <g><polygon points={pts(lv.ramp, T)} fill="url(#hatch-open)" stroke="#111" stroke-width="0.35" /><rect x={sx - 12} y={sy - 2.8} width="24" height="4.4" fill="#fff" /><text x={sx} y={sy + 0.4} font-size="2.4" font-weight="700" text-anchor="middle">RAMP 1:8 UP</text></g>; })()}
        {(lv.columns ?? []).map((q) => <polygon points={pts(q, T)} fill="#111" />)}
        {(lv.stairs ?? []).map((q) => { const [sx, sy] = T(...mid(q)); return <g><polygon points={pts(q, T)} fill="#fff" stroke="#111" stroke-width="0.45" /><text x={sx} y={sy + 0.6} font-size={fs * 0.62} text-anchor="middle" font-weight="700">EXIT STAIR</text></g>; })}
        {d.buildings.map((_, bi) => buildingCores(e, bi).map((cd) => <CoreDraw cd={cd} T={T} k={k} fs={fs} />))}
        {r.lostRings.map((lr) => <polygon points={pts(lr, T)} fill="url(#hatch-dp)" stroke="#d33" stroke-width="0.25" />)}
      </g>
      <g font-size="2.6">
        <text x={AREA.x} y={AREA.y + 4} font-weight="700">{title.toUpperCase()}</text>
        <text x={AREA.x} y={AREA.y + 8}>{`${lv.bays.length} car bays${n > 1 ? ` on each of ${n} levels (${lv.bays.length * n} in all)` : ''} · bays ${f2(bl)} × ${f2(bw)} m · ${m2(lv.area)} of parking`}</text>
        <text x={AREA.x} y={AREA.y + 12}>{`Parking for the whole scheme: ${d.parking.have} provided, ${d.parking.need} required`}</text>
        <text x={AREA.x} y={AREA.y + 16} fill="#555">{below ? 'Below ground: the plot and the buildings above dashed. Free of FSI.' : 'Open on the sides, columns as the floors above. Free of FSI.'}</text>
      </g>
      <North x={AREA.x + AREA.w - 8} y={AREA.y + 12} />
      <ScaleBar x={AREA.x} y={AREA.y + AREA.h - 6} k={k} scale={scale} />
    </Frame>
  );
}

/** Section A–A: across each building through its first core: the basements, the stilt, every floor's slab and
 *  level, the walls, the stair flights rising floor to floor, the lift shaft with its pit and machine room, the
 *  parapet; the heights dimensioned. */
function Section({ e, no, total }: { e: Evaluated; no: number; total: number }) {
  const { d, r } = e, fh0 = r.rules.floorH, under = d.under;
  const nB = d.parking.levels.filter((l) => l.kind === 'basement').length, BH = 3.3, SLAB = 0.15, PIT = 1.5, MR = 3.0, PARA = 1.0;
  const spans = d.buildings.map((b) => { let a = Infinity, c = -Infinity; for (const q of b.quads) for (let i = 0; i < q.length; i += 2) { a = Math.min(a, q[i]); c = Math.max(c, q[i]); } return [a, c]; });
  let cursor = 0;
  const placed = spans.map(([a, c]) => { const x = cursor; cursor += c - a + 10; return { x, w: c - a }; });
  const levelsOf = (bi: number) => { const b = d.buildings[bi]; const hs = b.laid ? b.laid.floors.map((f) => f.h) : Array(b.floors).fill(fh0); return hs; };
  const topOf = (bi: number) => under * fh0 + levelsOf(bi).reduce((s, h) => s + h, 0);
  const totalW = Math.max(10, cursor - 10), up = Math.max(10, ...d.buildings.map((_, bi) => topOf(bi) + MR + 1)), down = nB * BH + PIT + 1;
  const need = Math.max((totalW + 30) * 1000 / AREA.w, (up + down + 14) * 1000 / AREA.h);
  const scale = SCALES.find((s) => s >= need) ?? 2000, k = 1000 / scale;
  const gx = AREA.x + (AREA.w - totalW * k) / 2, gy = AREA.y + 14 + up * k;
  const X = (m: number) => gx + m * k, Y = (m: number) => gy - m * k;
  return (
    <Frame e={e} title="Section A–A" no={no} total={total} scale={`1:${scale}`}>
      <line x1={AREA.x} y1={gy} x2={AREA.x + AREA.w} y2={gy} stroke="#111" stroke-width="0.6" />
      <text x={AREA.x} y={gy - 1} font-size="2.4">GROUND LEVEL ±0.00</text>
      {d.buildings.map((b, bi) => {
        const { x, w } = placed[bi], x0 = spans[bi][0];
        const hs = levelsOf(bi), top = topOf(bi), bottom = -nB * BH;
        const cd = buildingCores(e, bi)[0];
        // the stair and the lift across the cut, by their x
        const xr = (q: number[] | undefined) => { if (!q) return null; let a = Infinity, c = -Infinity; for (let i = 0; i < q.length; i += 2) { a = Math.min(a, q[i]); c = Math.max(c, q[i]); } return [a - x0 + x, c - x0 + x] as [number, number]; };
        const st = xr(cd?.stairs[0]?.box), lf = xr(cd?.lifts[0]?.shaft);
        const levels: { y: number; h: number; name: string }[] = [];
        for (let i = nB; i >= 1; i--) levels.push({ y: -i * BH, h: BH, name: `BASEMENT ${i}` });
        for (let i = 0; i < under; i++) levels.push({ y: i * fh0, h: fh0, name: i === 0 ? 'STILT' : `PODIUM ${i}` });
        let yy = under * fh0;
        hs.forEach((h, i) => { levels.push({ y: yy, h, name: `${i + 1}F` }); yy += h; });
        return <g>
          {/* walls: the outer two, full height */}
          <rect x={X(x)} y={Y(top)} width={0.3 * k + 0.2} height={(top - bottom) * k} fill="#111" />
          <rect x={X(x + w) - 0.3 * k - 0.2} y={Y(top)} width={0.3 * k + 0.2} height={(top - bottom) * k} fill="#111" />
          {/* slabs, and each level's finished floor */}
          {[...levels.map((l) => l.y), top].map((y) => <rect x={X(x)} y={Y(y)} width={w * k} height={Math.max(0.35, SLAB * k)} fill="#111" />)}
          {nB > 0 && <rect x={X(x) - 1} y={Y(bottom)} width={w * k + 2} height={Math.max(0.5, 0.3 * k)} fill="#111" />}
          {levels.map((l) => <text x={X(x) - 1.5} y={Y(l.y) - 0.6} font-size="1.9" text-anchor="end">{`${l.name} ${l.y >= 0 ? '+' : ''}${f2(l.y)}`}</text>)}
          {/* the stair: flights rising half a floor each, to the landing and back */}
          {st && levels.map((l) => {
            const a = X(st[0] + 0.3), c = X(st[1] - 0.3), mid1 = Y(l.y + l.h / 2), y0 = Y(l.y), y1 = Y(l.y + l.h);
            return <g stroke="#111" stroke-width="0.3" fill="none">
              <polyline points={`${a},${y0} ${c - (c - a) * 0.3},${mid1} ${c},${mid1}`} />
              <polyline points={`${c - (c - a) * 0.3},${mid1} ${a + (c - a) * 0.0},${y1}`} stroke-dasharray="1 0.8" />
            </g>;
          })}
          {st && <text x={(X(st[0]) + X(st[1])) / 2} y={Y(top) - 1.2} font-size="2" text-anchor="middle" font-weight="700">STAIR</text>}
          {/* the lift: the shaft from its pit to the machine room */}
          {lf && <g>
            <rect x={X(lf[0])} y={Y(top + MR)} width={(lf[1] - lf[0]) * k} height={(top + MR - (bottom - PIT)) * k} fill="none" stroke="#111" stroke-width="0.35" />
            <rect x={X(lf[0])} y={Y(top + MR)} width={(lf[1] - lf[0]) * k} height={MR * k} fill="#e6e3dc" stroke="#111" stroke-width="0.35" />
            <text x={X(lf[1]) + 1} y={Y(top + MR / 2) + 0.7} font-size="1.8">{`LIFT MACHINE ROOM ${f2(MR)}`}</text>
            <rect x={X(lf[0])} y={Y(bottom)} width={(lf[1] - lf[0]) * k} height={PIT * k} fill="url(#hatch-dp)" stroke="#111" stroke-width="0.3" />
            <text x={X(lf[1]) + 1} y={Y(bottom - PIT / 2) + 0.7} font-size="1.8">{`LIFT PIT ${f2(PIT)}`}</text>
            <text x={(X(lf[0]) + X(lf[1])) / 2} y={Y(top / 2)} font-size="2" text-anchor="middle" font-weight="700" transform={`rotate(-90 ${(X(lf[0]) + X(lf[1])) / 2} ${Y(top / 2)})`}>LIFT SHAFT</text>
          </g>}
          {/* the parapet */}
          <rect x={X(x)} y={Y(top + PARA)} width={0.25 * k + 0.2} height={PARA * k} fill="#111" />
          <rect x={X(x + w) - 0.25 * k - 0.2} y={Y(top + PARA)} width={0.25 * k + 0.2} height={PARA * k} fill="#111" />
          {/* heights */}
          <Dim a={[X(x + w) + 8, Y(0)]} b={[X(x + w) + 8, Y(top)]} label={`${f2(top)} M`} />
          {nB > 0 && <Dim a={[X(x + w) + 8, Y(bottom)]} b={[X(x + w) + 8, Y(0)]} label={`${f2(-bottom)} M`} />}
          {levels.filter((l) => l.y >= 0).slice(0, 1).map((l) => <Dim a={[X(x + w) + 3, Y(l.y)]} b={[X(x + w) + 3, Y(l.y + l.h)]} label={`${f2(l.h)}`} />)}
          <text x={X(x + w / 2)} y={Y(bottom - PIT) + 6} font-size="3" font-weight="700" text-anchor="middle">{`BUILDING ${letter(bi)}`}</text>
        </g>;
      })}
      <text x={AREA.x} y={AREA.y + 4} font-size="2.6" font-weight="700">SECTION A–A (THROUGH THE STAIR AND LIFT)</text>
      <text x={AREA.x} y={AREA.y + 8} font-size="2.3">{`Slabs ${SLAB * 1000} mm; floor to floor ${f2(fh0)} m${nB ? `, basements ${f2(BH)} m` : ''}; parapet ${f2(PARA)} m; lift pit ${f2(PIT)} m and machine room ${f2(MR)} m (as assumed). Section line on the floor plan.`}</text>
      <ScaleBar x={AREA.x + AREA.w - 50} y={AREA.y + 6} k={k} scale={scale} />
    </Frame>
  );
}

function AreaStatement({ e, no, total }: { e: Evaluated; no: number; total: number }) {
  // (the rows Pro shows live: one source, so the sheet and the screen can't disagree)
  const rows: [string, string, string?][] = areaStatement(e, (x, bi) => formedGroups(x, bi)).map((x) => (x.k === 'h' ? [x.label.toUpperCase(), '', 'h'] : [x.label, x.value]));
  // two columns of rows
  let per = Math.ceil(rows.length / 2);
  if (rows[per - 1]?.[2] === 'h') per--; // a heading never ends a column
  const colW = AREA.w / 2 - 6, lh = Math.min(6.2, (AREA.h - 18) / per);
  return (
    <Frame e={e} title="Area statement" no={no} total={total} scale="NTS">
      <text x={AREA.x} y={AREA.y + 4} font-size="4" font-weight="700">AREA STATEMENT</text>
      {rows.map(([a, b, kind], i) => {
        const c = Math.floor(i / per), j = i % per, x = AREA.x + c * (colW + 12), y = AREA.y + 14 + j * lh;
        return kind === 'h'
          ? <g><rect x={x} y={y - 4.2} width={colW} height={5.6} fill="#f0eee8" /><text x={x + 2} y={y} font-size="2.8" font-weight="700">{a}</text></g>
          : <g><line x1={x} y1={y + 1.6} x2={x + colW} y2={y + 1.6} stroke="#ddd" stroke-width="0.2" /><text x={x + 2} y={y} font-size="2.8">{a}</text><text x={x + colW - 2} y={y} font-size="2.8" text-anchor="end" font-weight="700">{b}</text></g>;
      })}
    </Frame>
  );
}

/** the flats, doors and windows, light and ventilation, and room sizes, as tables */
function scheduleBlocks(e: Evaluated, rooms: FlatRooms[][]): Block[] {
  const { d, shops } = e;
  // flats by building, type and size
  const flatRows: Cell[][] = [];
  let totalN = 0, totalC = 0;
  d.buildings.forEach((b, bi) => {
    const tally = new Map<string, { label: string; carpet: number; n: number }>();
    const add = (label: string, carpet: number, n: number) => { if (n <= 0) return; const key = `${label}|${f2(carpet)}`; const t = tally.get(key) ?? { label, carpet, n: 0 }; t.n += n; tally.set(key, t); };
    if (b.laid) for (const f of b.laid.floors) { const kind = floorKind(f, b.use); for (const u of f.units) add(u.t === 3 ? USE_LABEL[kind] : UNIT_LABEL[u.t], u.carpet, 1); }
    else b.units.forEach((u, ui) => add(UNIT_LABEL[u.t], u.carpet, b.floors - (shops?.removed.get(bi)?.has(ui) ? shops.upperOf[bi] : 0)));
    for (const t of [...tally.values()].sort((a, c) => a.label.localeCompare(c.label) || a.carpet - c.carpet)) {
      flatRows.push([letter(bi), t.label, f2(t.carpet), `${t.n}`, f2(t.carpet * t.n)]);
      totalN += t.n; totalC += t.carpet * t.n;
    }
  });
  if (shops) { flatRows.push(['', 'Shops', f2(shops.carpet / Math.max(1, shops.count)), `${shops.count}`, f2(shops.carpet)]); totalN += shops.count; totalC += shops.carpet; }
  flatRows.push([{ t: 'Total', b: true }, '', '', { t: `${totalN}`, b: true }, { t: f2(totalC), b: true }]);

  // light and ventilation: identical flats together
  const lv = new Map<string, { c: (typeof e.checks)[number]; n: number }>();
  for (const c of e.checks) { const key = [c.t, f2(c.carpet), f2(c.glazed), f2(c.open), c.light, c.air].join('|'); const x = lv.get(key) ?? { c, n: 0 }; x.n += c.floors; lv.set(key, x); }
  const yes = (ok: boolean): Cell => (ok ? { t: 'Yes', c: STATUS.pass.c } : { t: 'No', c: STATUS.fail.c });

  // room sizes: the first flat of each type
  const seen = new Set<number>(), roomRows: Cell[][] = [];
  rooms.forEach((bl) => bl.forEach((fr) => {
    if (seen.has(fr.t) || !fr.rooms.length) return;
    seen.add(fr.t);
    fr.rooms.forEach((rm, i) => roomRows.push([i ? '' : { t: UNIT_LABEL[fr.t], b: true }, rm.name, f2(rm.area), f2(rm.width), [rm.minArea > 0 ? `${f2(rm.minArea)} m²` : '', rm.minWidth > 0 ? `${f2(rm.minWidth)} m wide` : ''].filter(Boolean).join(', ') || '—', rm.ok ? STATUS.pass : STATUS.fail]));
  }));

  return [
    { title: 'Flat schedule', sub: 'Every flat and unit, by building, type and carpet (m², RERA)', cols: [{ h: 'Bldg', w: 0.1 }, { h: 'Type', w: 0.3 }, { h: 'Carpet each', w: 0.2, end: true }, { h: 'Number', w: 0.16, end: true }, { h: 'Carpet total', w: 0.24, end: true }], rows: flatRows },
    { title: 'Door and window schedule', sub: 'Tags as on the floor plans', cols: [{ h: 'Tag', w: 0.09 }, { h: 'Type', w: 0.25 }, { h: 'Size', w: 0.16 }, { h: 'Sill', w: 0.11 }, { h: 'No.', w: 0.1, end: true }, { h: 'Where', w: 0.29 }], rows: e.rows.map((x) => [{ t: x.tag, b: true }, x.label, x.size, x.sill, `${x.count}`, x.where]) },
    ...(lv.size ? [{ title: 'Light and ventilation', sub: `Windows ${e.r.code === 'udcpr' ? '1/10' : '1/6'} of the habitable floor, half of it opening (as assumed)`, cols: [{ h: 'Flat', w: 0.17 }, { h: 'Carpet', w: 0.15, end: true }, { h: 'Glazed', w: 0.15, end: true }, { h: 'Opening', w: 0.15, end: true }, { h: 'Light', w: 0.12, end: true }, { h: 'Air', w: 0.12, end: true }, { h: 'Flats', w: 0.14, end: true }], rows: [...lv.values()].map(({ c, n }): Cell[] => [UNIT_LABEL[c.t], f2(c.carpet), f2(c.glazed), f2(c.open), yes(c.light), yes(c.air), `${n}`]) } satisfies Block] : []),
    ...(roomRows.length ? [{ title: 'Room sizes', sub: `Against the minimums of ${rulesName(e)} (m², m)`, cols: [{ h: 'Flat', w: 0.14 }, { h: 'Room', w: 0.2 }, { h: 'Area', w: 0.12, end: true }, { h: 'Width', w: 0.12, end: true }, { h: 'Minimum', w: 0.3 }, { h: '', w: 0.12, end: true }], rows: roomRows } satisfies Block] : []),
  ];
}

function scrutinyBlocks(e: Evaluated, checks: Check[]): Block[] {
  const groups = [...new Set(checks.map((c) => c.group))];
  return groups.map((g) => ({
    title: g,
    cols: [{ h: 'Result', w: 0.07 }, { h: 'Rule', w: 0.17 }, { h: 'Required', w: 0.25 }, { h: 'Proposed', w: 0.27 }, { h: 'Clause', w: 0.24 }],
    rows: checks.filter((c) => c.group === g).map((c): Cell[] => [STATUS[c.status], { t: c.rule, b: true }, c.required, c.note ? `${c.proposed}. ${c.note}` : c.proposed, c.clause]),
  }));
}

function permissionBlocks(e: Evaluated): Block[] {
  const ex = e.p.approval ?? {}, kind = permissionOf(e, ex.kind), fs = fees(e);
  return [
    { title: 'Permission', sub: `${PERMISSION_LABEL[kind]}: what the authority issues, in order`, cols: [{ h: '', w: 0.07 }, { h: 'Stage', w: 0.36 }, { h: 'What it is', w: 0.57 }], rows: stages(e, kind).map((s, i) => [`${i + 1}`, { t: s.title, b: true }, s.note]) },
    { title: 'NOCs and clearances', cols: [{ h: 'Needed', w: 0.12 }, { h: 'NOC', w: 0.3 }, { h: 'From', w: 0.26 }, { h: 'Why', w: 0.32 }], rows: [...nocs(e, ex)].sort((a, b) => +b.needed - +a.needed).map((n) => [n.needed ? { t: 'Yes', b: true } : { t: '—', c: '#888' }, { t: n.title, b: n.needed }, n.authority, n.why]) },
    { title: 'Fees and charges', sub: 'Rough figures to plan cash with, not a demand note', cols: [{ h: 'Item', w: 0.28 }, { h: 'Basis', w: 0.48 }, { h: 'Amount', w: 0.24, end: true }], rows: [...fs.map((f): Cell[] => [f.label, f.basis, rs(f.amount)]), [{ t: 'Total', b: true }, '', { t: rs(fs.reduce((s, f) => s + f.amount, 0)), b: true }]] },
    { title: 'Documents to file', cols: [{ h: 'From', w: 0.17 }, { h: 'Document', w: 0.36 }, { h: 'Note', w: 0.47 }], rows: documents(e, kind).map((x) => [x.from === 'us' ? 'UrbanPlan' : x.from[0].toUpperCase() + x.from.slice(1), { t: x.title, b: true }, x.note]) },
  ];
}

function TableSheet({ e, title, heading, page, no, total }: { e: Evaluated; title: string; heading: string; page: Placed[]; no: number; total: number }) {
  return (
    <Frame e={e} title={title} no={no} total={total} scale="NTS">
      <text x={AREA.x} y={AREA.y + 5} font-size="4" font-weight="700">{heading.toUpperCase()}</text>
      {page.map((p) => <Placed p={p} />)}
    </Frame>
  );
}

// ---------------- formed buildings: a plan per distinct floor ----------------

/** a formed building's floor as built (its rings after carves), from the form's layout, else its slab outline */
function floorRings(e: Evaluated, bi: number, fi: number): number[][] {
  const b = e.d.buildings[bi], f = e.forms[b.b.id]?.floors[fi];
  return f?.rings.length ? f.rings : [b.laid?.floors[fi]?.ring ?? b.laid?.outline ?? []];
}
/** "LEVELS 3–12", "LEVEL 2" (the ground is level 0; the stilt and podium count) */
const levelsName = (a: number, z: number) => (a === z ? `LEVEL ${a}` : `LEVELS ${a}–${z}`);
interface FloorGroup { a: number; z: number; fi: number; kind: FloorUse; area: number }
/** a formed building's floors in runs of identical ones (the same use, units and outline share one plan) */
function formedGroups(e: Evaluated, bi: number): FloorGroup[] {
  const b = e.d.buildings[bi], L = b.laid;
  if (!L) return [];
  const sig = (i: number) => `${floorKind(L.floors[i], b.use)}|${L.floors[i].units.length}|${floorRings(e, bi, i).map((q) => q.map((v) => Math.round(v * 10)).join()).join('/')}`;
  const out: FloorGroup[] = [];
  for (let i = 1, s0 = 0; i <= L.floors.length; i++) if (i === L.floors.length || sig(i) !== sig(s0)) { out.push({ a: e.d.under + s0, z: e.d.under + i - 1, fi: s0, kind: floorKind(L.floors[s0], b.use), area: L.floors[s0].area }); s0 = i; }
  return out;
}
/** a sheet per formed building, at most four plans to a sheet (so they stay at a workable scale) */
function formedSheets(e: Evaluated): { bi: number; groups: FloorGroup[] }[] {
  const out: { bi: number; groups: FloorGroup[] }[] = [];
  e.d.buildings.forEach((_, bi) => { const g = formedGroups(e, bi); for (let i = 0; i < g.length; i += 4) out.push({ bi, groups: g.slice(i, i + 4) }); });
  return out;
}

/** Every distinct floor of a formed building, side by side at one scale. */
function FormedPlans({ e, bi, groups, no, total }: { e: Evaluated; bi: number; groups: FloorGroup[]; no: number; total: number }) {
  const b = e.d.buildings[bi], L = b.laid!;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < L.outline.length; i += 2) { x0 = Math.min(x0, L.outline[i]); x1 = Math.max(x1, L.outline[i]); z0 = Math.min(z0, L.outline[i + 1]); z1 = Math.max(z1, L.outline[i + 1]); }
  const cols = groups.length <= 1 ? 1 : groups.length <= 4 ? 2 : groups.length <= 9 ? 3 : 4, rowsN = Math.ceil(groups.length / cols);
  const cw = AREA.w / cols, ch = (AREA.h - 8) / rowsN;
  const fr = planFrame(x0 - 2, z0 - 2, x1 + 2, z1 + 2, { x: 0, y: 0, w: cw - 6, h: ch - 10 });
  const fs = Math.min(2.2, Math.max(1, 0.8 * fr.k));
  return (
    <Frame e={e} title={`Floor plans, building ${letter(bi)}`} no={no} total={total} scale={`1:${fr.scale}`}>
      {groups.map((g, gi) => {
        const ox = AREA.x + (gi % cols) * cw + 3, oy = AREA.y + 8 + Math.floor(gi / cols) * ch;
        const T = (x: number, z: number): [number, number] => { const [u, v] = fr.T(x, z); return [u + ox, v + oy]; };
        const f = L.floors[g.fi];
        return <g>
          {floorRings(e, bi, g.fi).map((q) => <polygon points={pts(q, T)} fill="#fff" stroke="#111" stroke-width="0.5" />)}
          {f.units.map((u) => { const [sx, sy] = T(...mid(u.ring)); return <g>
            <polygon points={pts(u.ring, T)} fill={UNIT_COLOR[u.t]} fill-opacity="0.22" stroke="#111" stroke-width="0.25" />
            {fr.k >= 1 && <text x={sx} y={sy} font-size={fs} text-anchor="middle">{u.t === 3 ? `${f2(u.carpet)} m²` : UNIT_LABEL[u.t]}</text>}
          </g>; })}
          {g.kind === 'parking' ? b.cores.map((c) => <polygon points={pts(c, T)} fill="#bbb" stroke="#111" stroke-width="0.3" />) : buildingCores(e, bi).map((cd) => <CoreDraw cd={cd} T={T} k={fr.k} fs={fs} />)}
          <text x={ox} y={oy + ch - 6} font-size="2.6" font-weight="700">{`${levelsName(g.a, g.z)} · ${USE_LABEL[g.kind].toUpperCase()}`}</text>
          <text x={ox} y={oy + ch - 2.8} font-size="2.2">{`${f2(f.area)} m² a floor · ${f.units.length} unit${f.units.length === 1 ? '' : 's'} · ${f2(f.h)} m floor to floor`}</text>
        </g>;
      })}
      <text x={AREA.x} y={AREA.y + 4} font-size="2.6" font-weight="700">{`BUILDING ${letter(bi)}: EVERY DISTINCT FLOOR (LEVEL 0 THE GROUND)`}</text>
      <North x={AREA.x + AREA.w - 8} y={AREA.y + 12} />
      <ScaleBar x={AREA.x + AREA.w - 70} y={AREA.y + 4} k={fr.k} scale={fr.scale} />
    </Frame>
  );
}

// ---------------- the set ----------------

interface SheetDef { title: string; draw: (no: number, total: number, titles: string[]) => JSX.Element }

/** every sheet of the set, in order (the cover lists them all) */
export function sheetDefs({ e, checks, rooms }: SetInput): SheetDef[] {
  const list: SheetDef[] = [
    { title: 'Cover and key figures', draw: (no, total, titles) => <Cover e={e} checks={checks} titles={titles} no={no} total={total} /> },
    { title: 'Site plan', draw: (no, total) => <SitePlan e={e} no={no} total={total} /> },
    { title: 'Typical floor plan', draw: (no, total) => <FloorPlan e={e} rooms={rooms} no={no} total={total} /> },
  ];
  formedSheets(e).forEach((x) => list.push({ title: `Floor plans, building ${letter(x.bi)}`, draw: (no, total) => <FormedPlans e={e} bi={x.bi} groups={x.groups} no={no} total={total} /> }));
  parkingGroups(e).forEach((g) => list.push({ title: g.title, draw: (no, total) => <ParkingPlan e={e} title={g.title} lv={g.lv} n={g.n} no={no} total={total} /> }));
  list.push(
    { title: 'Elevation', draw: (no, total) => <Elevation e={e} no={no} total={total} /> },
    ...(e.d.buildings.length ? [{ title: 'Section A–A', draw: (no: number, total: number) => <Section e={e} no={no} total={total} /> }] : []),
    { title: 'Area statement', draw: (no, total) => <AreaStatement e={e} no={no} total={total} /> },
  );
  const tables = (title: string, heading: string, pages: Placed[][]) => pages.forEach((page, i) => list.push({ title: pages.length > 1 ? `${title} (${i + 1} of ${pages.length})` : title, draw: (no, total) => <TableSheet e={e} title={title} heading={i ? `${heading} (continued)` : heading} page={page} no={no} total={total} /> }));
  tables('Schedules', 'Schedules', flow(scheduleBlocks(e, rooms), 2));
  tables('Scrutiny report', 'Scrutiny report: every rule checked (advisory)', flow(scrutinyBlocks(e, checks), 1));
  tables('Permission, NOCs and fees', 'Permission, NOCs, fees and documents', flow(permissionBlocks(e), 2));
  return list;
}

export function Sheets(input: SetInput): JSX.Element {
  const defs = sheetDefs(input), titles = defs.map((d) => d.title);
  return <div class="sheets">{defs.map((d, i) => d.draw(i + 1, defs.length, titles))}</div>;
}

// ---------------- the PDF ----------------

/** the standard PDF fonts carry Latin-1 only: the few other characters the sheets use, in plain letters */
const PLAIN: Record<string, string> = { '₹': 'Rs ', '–': '-', '—': '-', '…': '...', '’': "'", '‘': "'", '“': '"', '”': '"', '≥': '>=', '≤': '<=', '→': '->', '−': '-', '✓': 'Y', ' ': ' ', ' ': ' ' };
const plain = (s: string) => s.replace(/[^\u0000-ÿ]/g, (c) => PLAIN[c] ?? '?');

/** the sheets in `root` as one A3 landscape PDF, vector throughout, saved as `file` */
export async function savePdf(root: HTMLElement, file: string): Promise<void> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3', compress: true });
  const svgs = [...root.querySelectorAll<SVGSVGElement>('.sheet svg')];
  const hold = document.createElement('div');
  hold.style.cssText = 'position:fixed;left:-20000px;top:0;width:420mm;height:297mm;overflow:hidden;';
  document.body.appendChild(hold);
  try {
    for (let i = 0; i < svgs.length; i++) {
      if (i) doc.addPage('a3', 'landscape');
      const clone = svgs[i].cloneNode(true) as SVGSVGElement;
      clone.querySelectorAll('text').forEach((t) => { t.textContent = plain(t.textContent ?? ''); });
      hold.replaceChildren(clone);
      await svg2pdf(clone, doc, { x: 0, y: 0, width: W, height: H });
    }
    doc.setProperties({ title: file, creator: 'UrbanPlan', subject: 'Building permission drawings (for discussion)' });
    doc.save(`${file}.pdf`);
  } finally {
    hold.remove();
  }
}

/** draw the set off screen and save it as a PDF, without opening the preview */
export async function downloadSet(input: SetInput, file: string): Promise<void> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1200px;';
  document.body.appendChild(host);
  try {
    render(<Sheets {...input} />, host);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await savePdf(host, file);
  } finally {
    render(null, host);
    host.remove();
  }
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
