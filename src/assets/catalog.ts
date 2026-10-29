// The asset catalogue: core assets from national / state standards, plus city packs (Pune's Urban Street Design
// Guidelines templates, Mumbai's street hierarchy). Numbers carry their source; `approx` marks values read off a
// drawing or typical practice rather than a clause.
import type { Part } from '../net/model';
import { DP_WIDTHS, setTotalWidth } from '../doc/xsection';
import type { AssetDef, LayerDef, Profile, Repeat, Rule } from './model';
import { LINE_COLOR } from '../doc/base';

// ---------------- cross-section shorthand ----------------
// Tokens left → right: S footpath, T tree pit / furniture / buffer, C cycle track, K parking, M median, H shoulder,
// L<w>x<n> carriageway of n lanes, U<w> a pair of central bus lanes, B<w> one bus lane, V<w> one service lane,
// R<w>x<n> a separate two-way roadway (service road). Lanes left of the centre (a median or bus lanes) run +1, right −1.

export function xs(spec: string, oneway = false): Part[] {
  type Tok = { k: string; w: number; n: number };
  const toks: Tok[] = spec.trim().split(/\s+/).map((t) => {
    const m = /^([A-Z])([\d.]+)(?:x(\d+))?$/.exec(t);
    if (!m) throw new Error(`bad cross-section token ${t}`);
    return { k: m[1], w: Number(m[2]), n: m[3] ? Number(m[3]) : 1 };
  });
  const total = toks.reduce((s, t) => s + t.w, 0);
  // the centre: a median or bus pair nearest the middle
  let centre = -1, best = Infinity, x = 0;
  toks.forEach((t, i) => { if (t.k === 'M' || t.k === 'U') { const c = x + t.w / 2, d = Math.abs(c - total / 2); if (d < best) { best = d; centre = i; } } x += t.w; });
  const lanes = toks.filter((t) => t.k === 'L').reduce((s, t) => s + t.n, 0);
  const out: Part[] = [];
  x = 0;
  toks.forEach((t, i) => {
    const side = (cx: number): 1 | -1 => (centre >= 0 ? (i < centre ? 1 : -1) : cx < total / 2 ? 1 : -1);
    switch (t.k) {
      case 'S': out.push({ kind: 'sidewalk', width: t.w, dir: 0 }); break;
      case 'T': out.push({ kind: 'planter', width: t.w, dir: 0 }); break;
      case 'C': out.push({ kind: 'cycle', width: t.w, dir: 0 }); break;
      case 'K': out.push({ kind: 'parking', width: t.w, dir: 0 }); break;
      case 'M': out.push({ kind: 'median', width: t.w, dir: 0 }); break;
      case 'H': out.push({ kind: 'shoulder', width: t.w, dir: 0 }); break;
      case 'U': out.push({ kind: 'bus', width: t.w / 2, dir: 1 }, { kind: 'bus', width: t.w / 2, dir: -1 }); break;
      case 'B': out.push({ kind: 'bus', width: t.w, dir: oneway ? 1 : side(x + t.w / 2) }); break;
      case 'V': out.push({ kind: 'lane', width: t.w, dir: oneway ? 1 : side(x + t.w / 2) }); break;
      case 'R': for (let k = 0; k < t.n; k++) out.push({ kind: 'lane', width: t.w / t.n, dir: k < t.n / 2 ? 1 : -1 }); break;
      case 'L': {
        const w = t.w / t.n;
        for (let k = 0; k < t.n; k++) {
          const cx = x + w * (k + 0.5);
          const dir: 1 | -1 | 0 = oneway ? 1 : lanes === 1 ? 0 : centre >= 0 ? side(cx) : cx < total / 2 ? 1 : -1;
          out.push({ kind: 'lane', width: Math.round(w * 1000) / 1000, dir });
        }
        break;
      }
    }
    x += t.w;
  });
  return out;
}

const street = (cls: string, spec: string, oneway = false): Profile => ({ type: 'street', cls, parts: xs(spec, oneway) });

// ---------------- layers the route / place / area assets draw into ----------------

const L = (id: string, name: string, kind: LayerDef['kind'], group: LayerDef['group'], color?: string): LayerDef => ({ id, name, kind, group, color: color ?? LINE_COLOR[kind] });
export const LAYERS = {
  rail: L('rail', 'Railway', 'rail', 'surface'),
  metro: L('metro', 'Metro', 'metro', 'elevated'),
  transit: L('a-transit', 'Bus & BRT stops, depots', 'transit', 'surface'),
  canals: L('a-canals', 'Canals', 'canal', 'surface'),
  nallas: L('a-nallas', 'Nallas & streams', 'nalla', 'surface'),
  flood: L('a-flood', 'Flood lines (blue / red)', 'zone', 'surface', '#3b82f6'),
  storm: L('a-storm', 'Storm drains', 'storm', 'underground'),
  sewer: L('a-sewer', 'Sewers', 'sewer', 'underground'),
  water: L('a-water', 'Water mains', 'water', 'underground'),
  gas: L('a-gas', 'Gas mains', 'gas', 'underground'),
  telecom: L('a-telecom', 'Telecom ducts', 'telecom', 'underground'),
  duct: L('a-duct', 'Utility ducts', 'other', 'underground'),
  powerOH: L('a-power-oh', 'Power lines (overhead)', 'hv', 'elevated'),
  powerUG: L('a-power-ug', 'Power cables (underground)', 'power', 'underground'),
  sites: L('a-sites', 'Sites & structures', 'site', 'surface'),
  paths: L('paths', 'Footpaths & trails', 'path', 'surface'),
};

// ---------------- sources ----------------

const SRC = {
  irc86: 'IRC:86-2018 Geometric Design Standards for Urban Roads and Streets',
  udcpr: 'UDCPR 2020 (Maharashtra)',
  usdg: 'Pune Urban Street Design Guidelines (PMC, 2016)',
  sdgMum: 'Street Design Guidelines for Greater Mumbai (MCGM, 2014)',
  sp90: 'IRC:SP:90-2010 Grade separated structures',
  irc124: 'IRC:124-2017 BRT design guidelines',
  mss: 'Ministry of Railways, Metro Manual of Specifications & Standards (2014)',
  sod: 'Indian Railways Schedule of Dimensions, BG (2004, revised 2022)',
  is10430: 'IS 10430:2000 Criteria for design of lined canals',
  cpheeoSw: 'CPHEEO Manual on Storm Water Drainage Systems (2019)',
  cpheeoSew: 'CPHEEO Manual on Sewerage (2013)',
  cpheeoWs: 'CPHEEO Manual on Water Supply',
  mop: 'Ministry of Power RoW guidelines (2015)',
};

// ---------------- core: roads ----------------

const road = (id: string, tab: string, name: string, profile: Profile, source: string, extra: Partial<AssetDef> = {}): AssetDef =>
  ({ id, category: 'roads', tab, name, drawer: 'network', profile, source, pack: 'core', ...extra });

const ROADS: AssetDef[] = [
  road('road.lane45', 'Small', 'Lane 4.5 m (old core)', street('living_street', 'L4.5x1'), `${SRC.udcpr} §3.3.5 — congested areas`, { use: 'Lanes in gaothans and peths; plots set back to 2.25 m from the centre line' }),
  road('road.access6', 'Small', 'Access way 6 m', street('service', 'L6x2'), `${SRC.udcpr} §3.2.2 — up to 75 m long`),
  road('road.living6', 'Small', 'Shared street 6 m', street('living_street', 'T0.5 L5x1 T0.5'), `${SRC.irc86} — local street, traffic calmed`),
  road('road.gh75', 'Small', 'Group housing road 7.5 m', street('residential', 'S1 L5.5x2 S1'), `${SRC.udcpr} Table 3C — up to 150 m`),
  road('road.access9', 'Small', 'Access / layout road 9 m', street('residential', 'S1.5 L6x2 S1.5'), `${SRC.udcpr} Table 3A — up to 150 m; §3.2.2 access up to 150 m`),
  road('road.layout12', 'Small', 'Layout road 12 m', street('residential', 'S2 T1 L6x2 T1 S2'), `${SRC.udcpr} Table 3A — 150–300 m`),
  road('road.layout15', 'Small', 'Layout road 15 m', street('unclassified', 'S2.5 T1.5 L7x2 T1.5 S2.5'), `${SRC.udcpr} Table 3A — over 300 m`),
  road('road.col15', 'Medium', 'Collector 15 m', street('tertiary', 'S3 T1 L7x2 T1 S3'), `${SRC.irc86} Table 4.1 — collector 15–30 m, 40 km/h`),
  road('road.col18', 'Medium', 'Collector 18 m, cycle tracks', street('tertiary', 'S2.5 C2 T1 L7x2 T1 C2 S2.5'), `${SRC.irc86} — collector; segregated cycle tracks ≥ 2 m (Table 5.3)`),
  road('road.col24', 'Medium', 'Collector 24 m, 4-lane divided', street('secondary', 'S2.5 T1.25 L7x2 M2.5 L7x2 T1.25 S2.5'), `${SRC.irc86} — 3.5 m lanes, median ≥ 1.2 m`),
  road('road.sub30', 'Large', 'Sub-arterial 30 m', street('secondary', 'S3 C2 T1.5 L7x2 M3 L7x2 T1.5 C2 S3'), `${SRC.irc86} Table 4.1 — sub-arterial 30–45 m, 60 km/h`),
  road('road.art36', 'Large', 'Arterial 36 m, 6-lane', street('primary', 'S3 C2 T1.5 L10.5x3 M2 L10.5x3 T1.5 C2 S3'), `${SRC.irc86} — arterial, 3.5 m lanes`),
  road('road.art45', 'Large', 'Arterial 45 m, service lanes', street('primary', 'S2.5 C2 V3.5 T1.5 L10.5x3 M5 L10.5x3 T1.5 V3.5 C2 S2.5'), `${SRC.irc86} Table 4.1 — arterial 45–60 m`),
  road('road.art60', 'Large', 'Arterial 60 m', street('trunk', 'S3 C2.5 R7x2 T3 L10.5x3 M8 L10.5x3 T3 R7x2 C2.5 S3'), `${SRC.irc86} Table 4.1 — arterial up to 60 m`),
  road('road.vr15', 'Highways', 'Village road 15 m', street('unclassified', 'T3.5 H1 L6x2 H1 T3.5'), `${SRC.udcpr} §3.3.8 — village road 15 m`),
  road('road.odr18', 'Highways', 'Other district road 18 m', street('tertiary', 'T4 H1.5 L7x2 H1.5 T4'), `${SRC.udcpr} §3.3.8 — ODR 18 m`),
  road('road.mdr24', 'Highways', 'Major district road 24 m', street('secondary', 'T7 H1.5 L7x2 H1.5 T7'), `${SRC.udcpr} §3.3.8 — MDR 24 m`),
  road('road.sh45', 'Highways', 'State highway 45 m', street('trunk', 'S1.5 R7.5x2 T2.5 H1.5 L7x2 M5 L7x2 H1.5 T2.5 R7.5x2 S1.5'), `${SRC.udcpr} §3.3.8 — SH 45 m incl. 9 m service roads`),
  road('road.nh60', 'Highways', 'National highway 60 m', street('trunk', 'S2 R7x2 T3 H2.5 L10.5x3 M10 L10.5x3 H2.5 T3 R7x2 S2'), `${SRC.udcpr} §3.3.8 — NH 60 m incl. 12 m service roads`),
  road('road.expr', 'Highways', 'Urban expressway, 8-lane', street('trunk', 'H2.5 L14x4 M6 L14x4 H2.5'), `${SRC.irc86} — urban expressway 45–75 m, 80 km/h, access controlled`),
  road('road.flyover', 'Bridges & tunnels', 'Flyover, 2 + 2 lanes', street('secondary', 'H0.6 L7x2 M1 L7x2 H0.6'), `${SRC.sp90} — 5.5 m clear below in urban areas, ramps ≤ 3.5 %`, { lift: 6.5, rules: [{ kind: 'clearance', v: 5.5, note: 'Vertical clearance 5.5 m over urban roads (IRC:SP:90 §6.21.4)' }] }),
  road('road.flyover1', 'Bridges & tunnels', 'Flyover, 1 + 1 lane', street('tertiary', 'H0.6 L7x2 H0.6'), `${SRC.sp90} — loops and ramps at least 2 lanes`, { lift: 6.5 }),
  road('road.rob', 'Bridges & tunnels', 'Road over rail bridge', street('secondary', 'S1.5 L7.5x2 S1.5'), `${SRC.sp90} §6.22.1 — at least 6.25 m above rail level`, { lift: 7.5 }),
  road('road.underpass', 'Bridges & tunnels', 'Underpass', street('secondary', 'H0.5 L7x2 H0.5'), `${SRC.sp90} — 5.5 m headroom; footways 2.25 m`, { lift: -8 }),
  road('road.subway', 'Bridges & tunnels', 'Pedestrian subway', street('living_street', 'S4'), `${SRC.sp90} §6.20.2 — 2.25 m headroom for footways and cycle tracks`, { lift: -4 }),
];

// DP road widths → the IRC cross-section of that size, stretched to the exact width
function dpRoads(): AssetDef[] {
  const base = (w: number) => ROADS.find((a) => a.id === (w <= 6 ? 'road.living6' : w <= 9 ? 'road.access9' : w <= 12 ? 'road.layout12' : w <= 15 ? 'road.col15' : w <= 18 ? 'road.col18' : w <= 24 ? 'road.col24' : w <= 30 ? 'road.sub30' : w <= 36 ? 'road.art36' : w <= 45 ? 'road.art45' : 'road.art60'))!;
  return DP_WIDTHS.map((w) => {
    const b = base(w), p = b.profile as Extract<Profile, { type: 'street' }>;
    return road(`road.dp${w}`, 'DP widths', `DP road ${w} m`, { type: 'street', cls: p.cls, parts: setTotalWidth(p.parts, w) }, `Development Plan road width; cross-section after ${b.name}`, { use: 'Matches a road reserve on the Development Plan' });
  });
}

// ---------------- core: transit ----------------

const track = (gauge: number, tracks: number, tc: number, formation: number, structure: 'grade' | 'viaduct' | 'tunnel', metro = false): Profile => ({ type: 'track', gauge, tracks, tc, formation, structure, metro });
const metroRules: Rule[] = [{ kind: 'minRadius', r: 120, hard: true, note: 'Metro main line: curve radius ≥ 120 m (MSS 2014)' }];

const TRANSIT: AssetDef[] = [
  { id: 'transit.brt30', category: 'transit', tab: 'BRT & bus', name: 'BRT street 30 m', drawer: 'network', profile: street('busway', 'S2 C2 T1 L6x2 T0.5 U7 T0.5 L6x2 T1 C2 S2'), source: `${SRC.irc124} §5.5 — 3.5 m BRT lanes, ≥ 0.5 m dividers; corridor 8 m between stations`, pack: 'core' },
  { id: 'transit.brt45', category: 'transit', tab: 'BRT & bus', name: 'BRT street 45 m', drawer: 'network', profile: street('busway', 'S4.5 C2 T1.5 L10.5x3 T0.5 U7 T0.5 L10.5x3 T1.5 C2 S4.5'), source: `${SRC.irc124} — central BRT with 3-lane carriageways`, pack: 'core', approx: true },
  { id: 'transit.brtStation', category: 'transit', tab: 'BRT & bus', name: 'BRT median station', drawer: 'place', layer: LAYERS.transit, profile: { type: 'point', w: 4, l: 40, h: 3.2, shape: 'station' }, source: `${SRC.irc124} §5.5 — 3.5 m clear inside, 4 m outside; BRT width 12 m at stations (16 m with passing lanes); stations every 300–800 m`, pack: 'core', rules: [{ kind: 'onStreet', minWidth: 30, note: 'BRT on roads 30 m and wider (Pune USDG)' }] },
  { id: 'transit.busStop', category: 'transit', tab: 'BRT & bus', name: 'Bus stop (kerbside)', drawer: 'place', layer: LAYERS.transit, profile: { type: 'point', w: 2, l: 10, h: 2.8, shape: 'stop' }, source: `${SRC.usdg} — bus stops in the furniture zone`, pack: 'core', approx: true },
  { id: 'transit.busDepot', category: 'transit', tab: 'BRT & bus', name: 'Bus depot', drawer: 'area', layer: LAYERS.sites, profile: { type: 'area', fill: '#8a8f98', h: 0.2 }, source: 'Area', pack: 'core' },
  { id: 'transit.metroElev', category: 'transit', tab: 'Metro', name: 'Elevated metro, twin track', drawer: 'route', layer: LAYERS.metro, profile: track(1.435, 2, 4.1, 8.5, 'viaduct', true), lift: 12, rules: metroRules, along: [{ every: 30, item: 'pier', note: 'spans 24–38 m' }], source: `${SRC.mss} — 1435 mm gauge, R ≥ 120 m (1000 m at stations), grades ≤ 4 % (flat at stations); deck ≈ 8.5 m (Pune segments)`, pack: 'core' },
  { id: 'transit.metroGrade', category: 'transit', tab: 'Metro', name: 'At-grade metro, twin track', drawer: 'route', layer: LAYERS.metro, profile: track(1.435, 2, 4.1, 10, 'grade', true), rules: metroRules, source: `${SRC.mss} — kinematic envelopes 352 mm apart at grade`, pack: 'core', approx: true },
  { id: 'transit.metroUG', category: 'transit', tab: 'Metro', name: 'Underground metro, twin tunnels', drawer: 'route', layer: LAYERS.metro, profile: track(1.435, 2, 14, 20, 'tunnel', true), lift: -16, rules: metroRules, source: `${SRC.mss} — twin bored tunnels`, pack: 'core', approx: true },
  { id: 'transit.metroStation', category: 'transit', tab: 'Metro', name: 'Elevated metro station', drawer: 'place', layer: LAYERS.metro, profile: { type: 'point', w: 22, l: 140, h: 9, elev: 9, shape: 'station' }, rules: [{ kind: 'ring', dist: 500, note: 'TOD influence zone 500 m (Pune TOD policy; UDCPR §14.2)' }], source: `${SRC.mss} — stations on curves ≥ 1000 m, flat track; TOD zone 500 m`, pack: 'core', approx: true },
  { id: 'transit.metroStationUG', category: 'transit', tab: 'Metro', name: 'Underground metro station', drawer: 'place', layer: LAYERS.metro, profile: { type: 'point', w: 25, l: 200, h: 1.5, shape: 'box' }, rules: [{ kind: 'ring', dist: 500, note: 'TOD influence zone 500 m' }], source: `${SRC.mss}`, pack: 'core', approx: true },
  { id: 'transit.metroDepot', category: 'transit', tab: 'Metro', name: 'Metro depot', drawer: 'area', layer: LAYERS.sites, profile: { type: 'area', fill: '#b06a9a', h: 0.2 }, source: 'Area', pack: 'core' },
];

// ---------------- core: rail ----------------

const railRules: Rule[] = [
  { kind: 'buffer', dist: 30, sev: 'info', note: 'Building within 30 m of railway land needs a railway NOC (UDCPR §3.1.4)' },
  { kind: 'clearance', v: 6.25, note: 'Roads over the line need 6.25 m clear above rail level (IRC:SP:90 §6.22.1)' },
];
const RAIL: AssetDef[] = [
  { id: 'rail.single', category: 'rail', tab: 'Broad gauge', name: 'Single line', drawer: 'route', layer: LAYERS.rail, profile: track(1.676, 1, 0, 6.85, 'grade'), rules: railRules, source: `${SRC.sod} — gauge 1676 mm, formation 6.85 m in embankment (6.25 m in cutting); OHE 5.5 m`, pack: 'core' },
  { id: 'rail.double', category: 'rail', tab: 'Broad gauge', name: 'Double line', drawer: 'route', layer: LAYERS.rail, profile: track(1.676, 2, 5.3, 12.15, 'grade'), rules: railRules, source: `${SRC.sod} — formation 12.15 m in embankment, track centres 5.3 m (new works)`, pack: 'core' },
  { id: 'rail.quad', category: 'rail', tab: 'Broad gauge', name: 'Quadruple line (suburban)', drawer: 'route', layer: LAYERS.rail, profile: track(1.676, 4, 5.3, 22.75, 'grade'), rules: railRules, source: `${SRC.sod} — track centres 5.3 m`, pack: 'core', approx: true },
  { id: 'rail.viaduct', category: 'rail', tab: 'Broad gauge', name: 'Rail viaduct, double', drawer: 'route', layer: LAYERS.rail, profile: track(1.676, 2, 5.3, 12, 'viaduct'), lift: 8, rules: railRules, along: [{ every: 30, item: 'pier' }], source: SRC.sod, pack: 'core', approx: true },
  { id: 'rail.yard', category: 'rail', tab: 'Stations & yards', name: 'Station yard, 3 lines', drawer: 'route', layer: LAYERS.rail, profile: track(1.676, 3, 5.3, 17.45, 'grade'), rules: railRules, source: `${SRC.sod} ch. II — yard track centres 5.3 m, gradient 1 in 1200`, pack: 'core' },
  { id: 'rail.platform', category: 'rail', tab: 'Stations & yards', name: 'Passenger platform, 24 coaches', drawer: 'place', layer: LAYERS.rail, profile: { type: 'point', w: 10, l: 650, h: 0.84, shape: 'platform' }, source: `${SRC.sod} — 760–840 mm above rail, edge 1.67–1.68 m from track centre`, pack: 'core', approx: true },
  { id: 'rail.platform12', category: 'rail', tab: 'Stations & yards', name: 'Passenger platform, 12 coaches (suburban)', drawer: 'place', layer: LAYERS.rail, profile: { type: 'point', w: 8, l: 270, h: 0.84, shape: 'platform' }, source: SRC.sod, pack: 'core', approx: true },
  { id: 'rail.station', category: 'rail', tab: 'Stations & yards', name: 'Station building', drawer: 'place', layer: LAYERS.rail, profile: { type: 'point', w: 20, l: 60, h: 9, shape: 'box' }, source: 'Typical', pack: 'core', approx: true },
  { id: 'rail.goods', category: 'rail', tab: 'Stations & yards', name: 'Goods yard', drawer: 'area', layer: LAYERS.sites, profile: { type: 'area', fill: '#8c7b6a', h: 0.3 }, source: 'Area', pack: 'core' },
];

// ---------------- core: water ----------------

const channel = (bed: number, depth: number, slope: number, freeboard: number, banks: [number, number], lined: boolean, road: boolean): Profile => ({ type: 'channel', bed, depth, slope, freeboard, banks, lined, road });
const canalRule: Rule = { kind: 'buffer', dist: 6, sev: 'warn', note: 'No building within 6 m of a canal or nalla (UDCPR §3.1.1 ii)' };
const canal = (id: string, name: string, q: string, p: Profile, extra = ''): AssetDef => ({ id, category: 'water', tab: 'Canals', name, use: `Discharge ${q}`, drawer: 'route', layer: LAYERS.canals, profile: p, props: { q }, rules: [canalRule], source: `${SRC.is10430} — freeboard and bank widths for ${q}${extra}; bed and depth typical`, pack: 'core', approx: true });
const WATER: AssetDef[] = [
  canal('water.canal.field', 'Field channel', '< 0.15 m³/s', channel(0.3, 0.3, 1, 0.15, [1, 1], true, false)),
  canal('water.canal.minor', 'Minor', '0.15–1.5 m³/s', channel(0.6, 0.6, 1.5, 0.3, [4, 1.5], true, true), '; service road on one bank'),
  canal('water.canal.dist', 'Distributary', '1.5–3 m³/s', channel(1.2, 0.9, 1.5, 0.5, [4, 2], true, true)),
  canal('water.canal.branch', 'Branch canal', '3–10 m³/s', channel(2.5, 1.4, 1.5, 0.6, [4.5, 2.5], true, true), '; 4 m bank + dowel'),
  canal('water.canal.main', 'Main canal', '10–30 m³/s', channel(5, 2.2, 1.5, 0.75, [5.5, 4], true, true), '; 5 m bank + dowel, berms 3–5 m in deep cuts'),
  canal('water.canal.mainL', 'Main canal, large', '> 30 m³/s', channel(10, 3, 1.5, 0.75, [6.5, 5], true, true), '; 6 m bank + dowel'),
  { id: 'water.nalla', category: 'water', tab: 'Rivers & nallas', name: 'Nalla (natural)', drawer: 'route', layer: LAYERS.nallas, profile: channel(4, 2, 2, 0.3, [0, 0], false, false), rules: [{ kind: 'buffer', dist: 6, sev: 'warn', note: 'No building within 6 m of a nalla (UDCPR §3.1.1 ii); DP layouts leave 9 m' }], source: `${SRC.udcpr} §3.1.1 — minor water course`, pack: 'core', approx: true },
  { id: 'water.nallaTrained', category: 'water', tab: 'Rivers & nallas', name: 'Nalla (trained, lined)', drawer: 'route', layer: LAYERS.nallas, profile: channel(6, 2.5, 0.5, 0.3, [3, 3], true, false), rules: [{ kind: 'buffer', dist: 6, sev: 'warn', note: 'Margins measured from the edge of the trained nalla (UDCPR §3.1.1)' }], source: `${SRC.udcpr} §3.1.1 — canalised to the authority's section`, pack: 'core', approx: true },
  { id: 'water.blue', category: 'water', tab: 'Rivers & nallas', name: 'Blue line zone (25-year flood)', drawer: 'area', layer: LAYERS.flood, profile: { type: 'area', fill: '#3b82f6', hatch: true }, rules: [{ kind: 'inside', sev: 'error', note: 'No construction between the river and the blue flood line (UDCPR §3.1.3)' }], source: `${SRC.udcpr} §3.1.3 — prohibitive zone`, pack: 'core' },
  { id: 'water.red', category: 'water', tab: 'Rivers & nallas', name: 'Red line zone (100-year flood)', drawer: 'area', layer: LAYERS.flood, profile: { type: 'area', fill: '#e5484d', hatch: true }, rules: [{ kind: 'inside', sev: 'warn', note: 'Restrictive zone: plinth 0.45 m above the red flood line (UDCPR §3.1.3)' }], source: `${SRC.udcpr} §3.1.3 — restrictive zone`, pack: 'core' },
  { id: 'water.pond', category: 'water', tab: 'Rivers & nallas', name: 'Pond / tank', drawer: 'area', profile: { type: 'area', fill: '#8fbcd4' }, source: 'Terrain tool: digs a pond that holds water', pack: 'core', props: { action: 'terrainPond' } },
];

// ---------------- core: drainage & sewers ----------------

const manholes = (dia: number): Repeat[] => [{ every: dia <= 0.6 ? 30 : dia <= 1.2 ? 60 : 100, item: 'manhole', note: '≤ 30 m up to Ø 600, 60 m up to Ø 1200, 100 m beyond' }];
const pipe = (id: string, tab: string, cat: 'drainage' | 'utilities', layer: LayerDef, name: string, dia: number, depth: number, source: string, along?: Repeat[], box?: [number, number]): AssetDef =>
  ({ id, category: cat, tab, name, drawer: 'route', layer, profile: { type: 'conduit', dia, box }, lift: -depth, along, source, pack: 'core' });
const DRAINAGE: AssetDef[] = [
  { id: 'drain.open06', category: 'drainage', tab: 'Storm water', name: 'Roadside drain 0.6 m (open)', drawer: 'route', layer: LAYERS.storm, profile: channel(0.6, 0.6, 0, 0.3, [0, 0], true, false), source: `${SRC.cpheeoSw} — open drains ≥ 0.3 m freeboard, ≥ 0.6 m/s`, pack: 'core', approx: true },
  { id: 'drain.open15', category: 'drainage', tab: 'Storm water', name: 'Open drain 1.5 m', drawer: 'route', layer: LAYERS.storm, profile: channel(1.5, 1.2, 0, 0.3, [0, 0], true, false), source: SRC.cpheeoSw, pack: 'core', approx: true },
  pipe('drain.p600', 'Storm water', 'drainage', LAYERS.storm, 'Storm pipe Ø 600', 0.6, 1.5, SRC.cpheeoSw, manholes(0.6)),
  pipe('drain.p900', 'Storm water', 'drainage', LAYERS.storm, 'Storm pipe Ø 900', 0.9, 1.8, SRC.cpheeoSw, manholes(0.9)),
  pipe('drain.p1200', 'Storm water', 'drainage', LAYERS.storm, 'Storm pipe Ø 1200', 1.2, 2.2, SRC.cpheeoSw, manholes(1.2)),
  pipe('drain.box15', 'Storm water', 'drainage', LAYERS.storm, 'Box drain 1.5 × 1.5', 1.5, 2.0, SRC.cpheeoSw, manholes(1.5), [1.5, 1.5]),
  pipe('sewer.150', 'Sewers', 'drainage', LAYERS.sewer, 'Sewer Ø 150 (lateral)', 0.15, 1.2, `${SRC.cpheeoSew} — smallest public sewer 150 mm`, manholes(0.15)),
  pipe('sewer.300', 'Sewers', 'drainage', LAYERS.sewer, 'Sewer Ø 300', 0.3, 1.8, SRC.cpheeoSew, manholes(0.3)),
  pipe('sewer.600', 'Sewers', 'drainage', LAYERS.sewer, 'Sewer Ø 600', 0.6, 2.5, SRC.cpheeoSew, manholes(0.6)),
  pipe('sewer.900', 'Sewers', 'drainage', LAYERS.sewer, 'Trunk sewer Ø 900', 0.9, 3.5, SRC.cpheeoSew, manholes(0.9)),
  pipe('sewer.1500', 'Sewers', 'drainage', LAYERS.sewer, 'Trunk sewer Ø 1500', 1.5, 5, SRC.cpheeoSew, manholes(1.5)),
  { id: 'sewer.stp', category: 'drainage', tab: 'Sewers', name: 'Sewage treatment plant', drawer: 'area', layer: LAYERS.sites, profile: { type: 'area', fill: '#5f8f6a', h: 0.5 }, source: 'Area', pack: 'core' },
];

// ---------------- core: water supply & utilities ----------------

const hydrants: Repeat[] = [{ every: 150, item: 'hydrant', note: '150–200 m in residential areas, 100 m in commercial (CPHEEO)' }];
const UTILITIES: AssetDef[] = [
  pipe('water.m100', 'Water supply', 'utilities', LAYERS.water, 'Distribution main Ø 100', 0.1, 1.0, `${SRC.cpheeoWs} — ≥ 100 mm to feed hydrants, 17 m residual head`, hydrants),
  pipe('water.m150', 'Water supply', 'utilities', LAYERS.water, 'Distribution main Ø 150', 0.15, 1.0, SRC.cpheeoWs, hydrants),
  pipe('water.m300', 'Water supply', 'utilities', LAYERS.water, 'Distribution main Ø 300', 0.3, 1.2, SRC.cpheeoWs, hydrants),
  pipe('water.m600', 'Water supply', 'utilities', LAYERS.water, 'Trunk main Ø 600', 0.6, 1.5, SRC.cpheeoWs),
  pipe('water.m1200', 'Water supply', 'utilities', LAYERS.water, 'Raw water main Ø 1200', 1.2, 2.0, SRC.cpheeoWs),
  { id: 'water.esr', category: 'utilities', tab: 'Water supply', name: 'Elevated service reservoir', drawer: 'place', layer: LAYERS.sites, profile: { type: 'point', w: 16, l: 16, h: 22, shape: 'tank' }, source: 'Typical', pack: 'core', approx: true },
  { id: 'water.wtp', category: 'utilities', tab: 'Water supply', name: 'Water treatment plant', drawer: 'area', layer: LAYERS.sites, profile: { type: 'area', fill: '#4c8fc9', h: 0.4 }, source: 'Area', pack: 'core' },
  pipe('gas.110', 'Gas & telecom', 'utilities', LAYERS.gas, 'Gas main (MDPE 110)', 0.11, 1.0, 'PNGRB technical standards — ≥ 1 m cover', [{ every: 50, item: 'marker' }]),
  pipe('gas.250', 'Gas & telecom', 'utilities', LAYERS.gas, 'Gas main (steel 250)', 0.25, 1.2, 'PNGRB technical standards', [{ every: 50, item: 'marker' }]),
  pipe('tele.duct', 'Gas & telecom', 'utilities', LAYERS.telecom, 'Telecom duct', 0.1, 0.8, 'MoRTH utility circulars — ≥ 0.6 m cover'),
  pipe('util.duct', 'Gas & telecom', 'utilities', LAYERS.duct, 'Utility duct (common trench)', 1.2, 1.2, `MoRTH utility ducts; ${SRC.usdg} — utilities in the footpath / MUZ, never under the carriageway`, [{ every: 100, item: 'manhole' }], [1.2, 1.5]),
];

// ---------------- core: power ----------------

const ht = (kv: number, width: number, span: number, h: number): AssetDef => ({
  id: `power.${kv}`, category: 'power', tab: 'Overhead lines', name: `${kv} kV overhead line`, drawer: 'route', layer: LAYERS.powerOH,
  profile: { type: 'corridor', width, kv, span, towerH: h }, along: [{ every: span, item: 'tower', note: 'typical span' }],
  rules: [{ kind: 'buffer', dist: 0, sev: 'error', note: `No building inside the ${width} m right-of-way corridor (MoP 2015)` }],
  source: `${SRC.mop} — corridor ${width} m; span and tower height typical`, pack: 'core', approx: true,
});
const POWER: AssetDef[] = [
  { id: 'power.lt', category: 'power', tab: 'Overhead lines', name: 'LT line (415 V)', drawer: 'route', layer: LAYERS.powerOH, profile: { type: 'corridor', width: 2.4, kv: 0.4, span: 40, towerH: 8, poles: true }, along: [{ every: 40, item: 'pole' }], rules: [{ kind: 'buffer', dist: 0, sev: 'warn', note: 'Buildings ≥ 1.2 m from LT lines (UDCPR §3.1.2)' }], source: `${SRC.udcpr} §3.1.2 — 2.5 m vertical, 1.2 m horizontal`, pack: 'core', approx: true },
  { id: 'power.11', category: 'power', tab: 'Overhead lines', name: '11 kV line', drawer: 'route', layer: LAYERS.powerOH, profile: { type: 'corridor', width: 4, kv: 11, span: 60, towerH: 10, poles: true }, along: [{ every: 60, item: 'pole' }], rules: [{ kind: 'buffer', dist: 0, sev: 'warn', note: 'Buildings ≥ 2 m from lines up to 33 kV (UDCPR §3.1.2)' }], source: `${SRC.udcpr} §3.1.2 — 3.7 m vertical, 2 m horizontal`, pack: 'core', approx: true },
  { id: 'power.33', category: 'power', tab: 'Overhead lines', name: '33 kV line', drawer: 'route', layer: LAYERS.powerOH, profile: { type: 'corridor', width: 6, kv: 33, span: 100, towerH: 13, poles: true }, along: [{ every: 100, item: 'pole' }], rules: [{ kind: 'buffer', dist: 0, sev: 'warn', note: 'Buildings ≥ 2 m from lines up to 33 kV (UDCPR §3.1.2)' }], source: `${SRC.udcpr} §3.1.2`, pack: 'core', approx: true },
  ht(66, 18, 250, 25), ht(110, 22, 280, 28), ht(132, 27, 300, 32), ht(220, 35, 350, 40), ht(400, 46, 400, 50), ht(765, 64, 450, 60),
  pipe('power.ug11', 'Cables & substations', 'utilities', LAYERS.powerUG, '11 kV underground cable', 0.15, 1.0, 'Typical cable trench ≥ 1 m'),
  pipe('power.ug33', 'Cables & substations', 'utilities', LAYERS.powerUG, '33 kV underground cable', 0.2, 1.2, 'Typical cable trench'),
  { id: 'power.dt', category: 'power', tab: 'Cables & substations', name: 'Transformer 5 × 5 m', drawer: 'place', layer: LAYERS.sites, profile: { type: 'point', w: 5, l: 5, h: 3, shape: 'box' }, source: `${SRC.udcpr} §3.6 — plots over 2000 m², ≥ 3 m from the building`, pack: 'core' },
  { id: 'power.ss33', category: 'power', tab: 'Cables & substations', name: '33/11 kV substation', drawer: 'place', layer: LAYERS.sites, profile: { type: 'point', w: 40, l: 40, h: 6, shape: 'yard' }, source: 'Typical', pack: 'core', approx: true },
  { id: 'power.ss132', category: 'power', tab: 'Cables & substations', name: '132 kV substation', drawer: 'area', layer: LAYERS.sites, profile: { type: 'area', fill: '#c8a34a', h: 0.3 }, source: 'Area', pack: 'core' },
];
// underground power cables are listed under Power too
for (const a of POWER) if (a.id.startsWith('power.ug')) a.category = 'power';

// ---------------- core: paths & places ----------------

const LANDSCAPE: AssetDef[] = [
  { id: 'path.foot', category: 'landscape', tab: 'Paths', name: 'Footpath 2 m', drawer: 'route', layer: LAYERS.paths, profile: { type: 'path', width: 2 }, source: `${SRC.irc86} — clear walking zone ≥ 1.8 m (2.5 m commercial)`, pack: 'core' },
  { id: 'path.cycle2', category: 'landscape', tab: 'Paths', name: 'Cycle track 2 m (one-way)', drawer: 'route', layer: LAYERS.paths, profile: { type: 'path', width: 2 }, source: `${SRC.irc86} Table 5.3 — ≥ 2 m one-way`, pack: 'core' },
  { id: 'path.cycle3', category: 'landscape', tab: 'Paths', name: 'Cycle track 3 m (two-way)', drawer: 'route', layer: LAYERS.paths, profile: { type: 'path', width: 3 }, source: `${SRC.irc86} Table 5.3 — ≥ 3 m two-way`, pack: 'core' },
  { id: 'path.trail', category: 'landscape', tab: 'Paths', name: 'Trail 1.5 m', drawer: 'route', layer: LAYERS.paths, profile: { type: 'path', width: 1.5 }, source: 'Typical', pack: 'core' },
  { id: 'place.park', category: 'landscape', tab: 'Places', name: 'Park / garden', drawer: 'area', layer: LAYERS.sites, profile: { type: 'area', fill: '#7fb069' }, source: 'Area', pack: 'core' },
  { id: 'place.playground', category: 'landscape', tab: 'Places', name: 'Playground', drawer: 'area', layer: LAYERS.sites, profile: { type: 'area', fill: '#a3c46b' }, source: 'Area', pack: 'core' },
  { id: 'place.parking', category: 'landscape', tab: 'Places', name: 'Parking lot', drawer: 'area', layer: LAYERS.sites, profile: { type: 'area', fill: '#9aa0a6', hatch: true }, source: `${SRC.udcpr} Table 8A — cars 2.5 × 5 m, two-wheelers 1 × 2 m, buses 3.75 × 7.5 m; aisles ≥ 3 m`, pack: 'core' },
  { id: 'place.plaza', category: 'landscape', tab: 'Places', name: 'Plaza', drawer: 'area', layer: LAYERS.sites, profile: { type: 'area', fill: '#d8cbb3' }, source: 'Area', pack: 'core' },
];

// ---------------- city packs ----------------

const pune = (code: string, spec: string, cls: string, use: string, oneway = false): AssetDef => ({
  id: `pune.${code}`, category: code.includes('BRT') ? 'transit' : 'roads', tab: code.includes('BRT') ? 'Pune BRT' : 'Pune USDG', name: `${code} · ${use}`, use,
  drawer: 'network', profile: street(cls, spec, oneway), source: `${SRC.usdg} — template ${code} (ROW ${spec.split(/\s+/).reduce((s, t) => s + Number(/[\d.]+/.exec(t)![0]), 0)} m)`, pack: 'pune',
});
const PUNE: AssetDef[] = [
  pune('6A', 'L3x1 T1 S2', 'living_street', 'by-lanes, alleys'),
  pune('6B', 'L4x1 K2', 'living_street', 'one-way by-lanes with parking'),
  pune('7.5A', 'H1 L3.5x1 T0.8 S2.2', 'living_street', 'by-lanes, no parking'),
  pune('7.5B', 'T0.5 L5x1 K2', 'residential', 'by-lanes with parking'),
  pune('9A', 'T0.5 L4.5x1 K2 S2', 'residential', 'peths and gaothan streets'),
  pune('9B', 'S2.2 T0.8 L3x1 T0.8 S2.2', 'residential', 'busy commercial lanes (one-way)', true),
  pune('12A', 'S2 T1 L6x2 T1 S2', 'unclassified', 'through traffic, residential'),
  pune('12B', 'S2.75 K2 L4.5x1 S2.75', 'residential', 'by-lanes, traffic calmed'),
  pune('12C', 'S2 T1 L6x2 S1.5 T1.5', 'unclassified', 'through traffic, traffic calmed'),
  pune('12D', 'S2 T0.75 K2 L4.5x1 T0.75 S2', 'residential', 'peth streets, P1-P2 parking'),
  pune('12E', 'S1.5 T1 C2.5 T0.5 L4x1 T0.75 S1.75', 'residential', 'two-wheeler streets'),
  pune('15A', 'S2 T1 C2 T0.5 L6.5x2 S3', 'tertiary', 'schools and colleges'),
  pune('15B', 'S2.25 K2 L6.5x2 S4.25', 'tertiary', 'through traffic, residential'),
  pune('15C', 'S2 T1 C2 T0.5 L5.5x2 S4', 'tertiary', 'one-way, high footfall (Bajirao Rd)', true),
  pune('18A', 'S2.5 T1 C3 T0.5 L6.5x2 S2 S2.5', 'tertiary', 'schools, through traffic'),
  pune('18B', 'S2.25 T1 C2 T0.5 L6.5x2 S1.5 C2 S2.25', 'tertiary', 'schools and colleges'),
  pune('18C', 'S2.75 T1 K2 L6.5x2 S2 S3.75', 'tertiary', 'through traffic with parking'),
  pune('18D', 'S2 T1 L5.5x2 M1 L5.5x2 S3', 'secondary', 'through traffic, no parking'),
  pune('21A', 'S3.5 T1.5 C2.5 T0.5 L6.5x2 S2 S4.5', 'secondary', 'mixed use, heavy footfall'),
  pune('21B', 'S2.75 C2 T0.5 K2 L6.5x2 S1.5 T1 C2 S2.75', 'secondary', 'schools, parking'),
  pune('21C', 'S2.75 K2 L5.25x2 M1 L5.25x2 S4.75', 'secondary', 'through traffic, parking'),
  pune('21D', 'S2 T1 C2 T0.5 L4.5x2 M1 L4.5x2 S1.5 C2 S2', 'secondary', 'mobility corridors'),
  pune('24A', 'S2.5 T1 C2 T0.5 L5.5x2 M1 L5.5x2 S1.5 C2 S2.5', 'secondary', 'mobility corridors'),
  pune('24B', 'S3.5 K2 L6x2 M1 L6x2 S2 S3.5', 'secondary', 'through traffic, parking'),
  pune('24C', 'S4.25 C2 T0.5 K2 L6.5x2 S2 T0.5 C2 S4.25', 'secondary', 'schools, parking'),
  pune('27', 'S3 C2 K2 L5.5x2 M1 L5.5x2 S2.5 C2 S3.5', 'primary', 'schools, through traffic'),
  pune('30A', 'S4 C2 T0.5 K2 L6x2 M1 L6x2 S2.5 C2 S4', 'primary', 'heavy through traffic'),
  pune('30B', 'S3 K2 L6x2 M1 L6x2 S3.5 C3 T2 S3.5', 'primary', 'through traffic, vending'),
  pune('36A', 'S3.5 T2 C2.5 T1.5 K2 L6x2 M1 L6x2 S3 C2.5 T2 S4', 'primary', 'through traffic'),
  pune('36B', 'V2.5 K2 S3 T1.5 C2 T0.5 L6x2 M1 L6x2 S4 C2 S2.5 T0.5 V2.5', 'primary', 'service lanes'),
  pune('42A', 'S2 K2 V3 T0.5 T2.5 T1.5 C2.5 T0.5 L6x2 M1 L6x2 S3.5 C2.5 T3 T0.5 V3 S2', 'primary', 'through traffic, service lanes'),
  pune('42B', 'S2 K2 V3 T1.5 C3 T0.5 L8.5x3 M1 L8.5x3 S3.5 C3 T0.5 V3 S2', 'trunk', '3-lane carriageways, service lanes'),
  pune('45', 'S4.5 K2 V3 T1.5 C2 T0.5 L8.5x3 M1 L8.5x3 S3.5 C2 T0.5 V3 S4.5', 'trunk', 'through traffic, service lanes'),
  pune('18 BRT', 'S3 K2 L5x2 T0.5 B3.5 T0.5 T1 S2.5', 'busway', 'one-way corridors with a BRT lane', true),
  pune('24 BRT', 'S2 K2 L6x2 T0.5 U7 T0.5 C3 T1 S2', 'busway', 'mobility corridors'),
  pune('30 BRT', 'S3 K2 L6x2 T0.5 U7 T0.5 L6x2 T2 S3', 'busway', 'mobility corridors'),
  pune('36 BRT', 'S2 T1.5 C2 T0.5 K2 L6x2 T0.5 U7 T0.5 L6x2 S4 C2 S2', 'busway', 'mobility corridors'),
  pune('42 BRT', 'S2.3 K2 V2.7 T1.5 C2 T0.5 L6x2 T0.5 U7 T0.5 L6x2 S3.5 C2 T0.5 V2.7 S2.3', 'busway', 'mobility corridors, service lanes'),
  pune('45 BRT', 'S2.5 K2 V3 T1.5 C2 T0.5 L7x2 T0.5 U7 T0.5 L7x2 S3.5 C2 T0.5 V3 S2.5', 'busway', 'mobility corridors, service lanes'),
  pune('60 BRT', 'S3.5 T2 K2 V3 S3 T1.5 C2 T0.5 L8.5x3 T0.5 U7 T0.5 L8.5x3 T0.5 C2 T1.5 S3 V3 K2 T2 S3.5', 'busway', 'major mobility corridors'),
];

const mumbai = (id: string, name: string, cls: string, spec: string, use: string): AssetDef => ({
  id: `mumbai.${id}`, category: 'roads', tab: 'Mumbai SDG', name, use, drawer: 'network', profile: street(cls, spec),
  source: `${SRC.sdgMum} — hierarchy width; lanes 2.7–3.0 m (3.5 m on arterials)`, pack: 'mumbai', approx: true,
});
const MUMBAI: AssetDef[] = [
  mumbai('local40', 'Local street 40 ft (12.2 m)', 'residential', 'S2.1 T1 L6x2 T1 S2.1', 'local access'),
  mumbai('minor60', 'Minor collector 60 ft (18.3 m)', 'tertiary', 'S3 T0.15 L12x4 T0.15 S3', 'collects from local streets'),
  mumbai('major80', 'Major collector 80 ft (24.4 m)', 'secondary', 'S3 C2 L6.2x2 M2 L6.2x2 C2 S3', 'neighbourhood spines'),
  mumbai('sub100', 'Sub-arterial 100 ft (30.5 m)', 'secondary', 'S3.5 C2 L9x3 M1.5 L9x3 C2 S3.5', 'ward to ward, bus routes; 30 km/h in places'),
  mumbai('art120', 'Arterial 120 ft (36.6 m)', 'primary', 'S3.5 C2 T1.5 L10.5x3 M1.6 L10.5x3 T1.5 C2 S3.5', 'city arterials'),
  mumbai('art150', 'Arterial 150 ft (45.7 m)', 'trunk', 'S5.55 C2 T1.6 L10.5x3 M6.4 L10.5x3 T1.6 C2 S5.55', 'expressways (WEH, EEH)'),
];

/** Every built-in asset (custom ones come from Settings, see index.ts). */
export const BUILTIN: AssetDef[] = [...ROADS, ...dpRoads(), ...TRANSIT, ...RAIL, ...WATER, ...DRAINAGE, ...UTILITIES, ...POWER, ...LANDSCAPE, ...PUNE, ...MUMBAI];

/** Tab order within a category (packs after core tabs). */
export const TAB_ORDER: Record<string, string[]> = {
  roads: ['Small', 'Medium', 'Large', 'Highways', 'Bridges & tunnels', 'Pune USDG', 'Mumbai SDG', 'DP widths', 'My assets'],
  transit: ['BRT & bus', 'Pune BRT', 'Metro'],
  rail: ['Broad gauge', 'Stations & yards'],
  water: ['Canals', 'Rivers & nallas'],
  drainage: ['Storm water', 'Sewers'],
  utilities: ['Water supply', 'Gas & telecom'],
  power: ['Overhead lines', 'Cables & substations'],
  landscape: ['Paths', 'Places'],
};
