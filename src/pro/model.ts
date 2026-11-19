// The building as data: the whole scheme written out level by level, every flat with its rooms and its windows and
// doors, so other tools (and later the agent) can read what was designed without re-running the generator. The
// generator lays one typical floor per building; here it's repeated on every level it applies to:
// - the stilt (or podium) levels under the flats, with the shops along the front when there are any;
// - the floors of flats, where the flats given over to shops (on the floors the road allows) become shop units;
// - the basements, as parking levels with their bay count.
// Two outputs: our own JSON (`modelJson`), and a minimal IFC4 file (`ifcLite`) with a storey per level and a space
// per room, enough for Revit, ArchiCAD or any IFC viewer to open the rooms (no walls or openings as IFC elements yet).
import type { DesignSystem } from './design';
import type { Evaluated } from './evaluate';
import type { FlatRooms } from './rooms';
import { outline, roadLines } from './project';
import { CITIES } from './project';
import { floorKind, UNIT_LABEL, type FloorUse } from '../doc/site';

export interface ModelRoom { kind: string; name: string; area: number; ring: number[] }
export interface ModelOpening { tag: string; w: number; h: number; sill: number; x: number; z: number }
export interface ModelUnit { id: string; type: string; carpet: number; ring: number[]; rooms: ModelRoom[]; openings: ModelOpening[] }
export interface ModelFloor {
  level: number;
  /** its floor's height above the ground (m), and floor to floor */
  z: number; height: number;
  /** a formed building's floors are each their own use (FloorUse) */
  use: 'stilt' | 'flats' | 'shops' | 'parking' | FloorUse;
  units: ModelUnit[];
  /** a formed building's floor: its slab outline(s) after carves (x,z,…) and its area */
  outline?: number[][]; area?: number;
  /** parking bays on the level */
  bays?: number;
}
export interface ModelBuilding { id: string; name: string; floors: ModelFloor[]; cores: number[][] }
export interface ProModel {
  format: 'urbanplan/pro-model'; version: 1;
  /** plan coordinates in metres: x along the front road, z away from it (the plan's −z taken as north) */
  units: 'm';
  project: { name: string; city: string; code: string };
  plot: { area: number; outline: number[]; net: number[]; footprint: number[]; roads: { width: number; dp: number; line: number[] }[]; fsi: number; permissible: number };
  buildings: ModelBuilding[];
  schedule: { tag: string; label: string; size: string; count: number }[];
  totals: { builtUp: number; flats: number; carpet: number; height: number; parking: { need: number; have: number } };
  design: DesignSystem;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const rr = (ring: number[]) => ring.map(r2);

export function buildModel(e: Evaluated, rooms: FlatRooms[][]): ProModel {
  const { p, r, d, plans, shops, ds } = e;
  const fh = r.rules.floorH, under = d.under;
  const o = outline(p);
  const city = CITIES.find((c) => c.value === p.city);
  const buildings: ModelBuilding[] = d.buildings.map((b, bi) => {
    const name = d.buildings.length > 1 ? `Building ${String.fromCharCode(65 + bi)}` : 'Building';
    const floors: ModelFloor[] = [];
    // basements: parking levels below the ground
    const basements = d.parking.levels.filter((l) => l.kind === 'basement');
    basements.forEach((l, i) => floors.push({ level: -(i + 1), z: -(i + 1) * fh, height: fh, use: 'parking', units: [], bays: l.bays.length }));
    // stilt / podium levels, the shops on the ground
    const strips = shops?.strips.filter((s) => s.b === bi) ?? [];
    for (let k = 0; k < under; k++) {
      const shopUnits: ModelUnit[] = k === 0 ? strips.map((s, si) => ({ id: `${bi}-G-S${si + 1}`, type: 'shop', carpet: r2(s.area * 0.8), ring: rr(s.ring), rooms: [], openings: [] })) : [];
      const stiltBays = d.parking.levels.filter((l) => l.kind === 'stilt' || l.kind === 'podium')[k]?.bays.length;
      floors.push({ level: k, z: k * fh, height: fh, use: shopUnits.length ? 'shops' : 'stilt', units: shopUnits, ...(stiltBays ? { bays: stiltBays } : {}) });
    }
    // a formed building: each floor as its form laid it, at its own height and use (the rooms, windows and doors on
    // its typical floor, which they're worked out for; the other floors' units as outlines)
    const form = e.forms[b.b.id];
    if (b.laid) {
      let z = under * fh;
      b.laid.floors.forEach((lf, f) => {
        const level = under + f, tag = `${bi}-${level}`, typ = f === b.typical, kind = floorKind(lf, b.use);
        const units: ModelUnit[] = lf.units.map((u, ui) => ({
          id: `${tag}-${ui + 1}`, type: u.t === 3 ? kind : (UNIT_LABEL[u.t] ?? 'unit'), carpet: r2(u.carpet), ring: rr(u.ring),
          rooms: typ ? (rooms[bi]?.[ui]?.rooms ?? []).map((x) => ({ kind: x.kind, name: x.name, area: r2(x.area), ring: rr(x.ring) })) : [],
          openings: typ ? plans[bi].openings.filter((x) => x.unit === ui).map((x) => ({ tag: x.tag, w: x.w, h: x.h, sill: x.sill, x: r2(x.x), z: r2(x.z) })) : [],
        }));
        floors.push({ level, z: r2(z), height: r2(lf.h), use: kind === 'residential' ? 'flats' : kind, units, outline: (form?.floors[f]?.rings ?? (lf.ring ? [lf.ring] : [])).map(rr), area: r2(lf.area) });
        z += lf.h;
      });
      return { id: b.b.id, name, floors, cores: b.cores.map(rr) };
    }
    // the floors of flats: the typical floor repeated
    const gone = shops?.removed.get(bi), upper = shops?.upperOf[bi] ?? 0;
    for (let f = 0; f < b.floors; f++) {
      const level = under + f, tag = `${bi}-${level}`;
      const units: ModelUnit[] = b.units.map((u, ui) => {
        const shop = f < upper && !!gone?.has(ui);
        return {
          id: `${tag}-${ui + 1}`, type: shop ? 'shop' : (UNIT_LABEL[u.t] ?? 'unit'), carpet: r2(u.carpet), ring: rr(u.ring),
          rooms: shop ? [] : (rooms[bi]?.[ui]?.rooms ?? []).map((x) => ({ kind: x.kind, name: x.name, area: r2(x.area), ring: rr(x.ring) })),
          openings: shop ? [] : plans[bi].openings.filter((x) => x.unit === ui).map((x) => ({ tag: x.tag, w: x.w, h: x.h, sill: x.sill, x: r2(x.x), z: r2(x.z) })),
        };
      });
      floors.push({ level, z: level * fh, height: fh, use: 'flats', units });
    }
    return { id: b.b.id, name, floors, cores: b.cores.map(rr) };
  });
  return {
    format: 'urbanplan/pro-model', version: 1, units: 'm',
    project: { name: p.name, city: p.city, code: city?.code ?? r.code },
    plot: {
      area: r2(r.area), outline: rr(o.ring), net: rr(r.net), footprint: rr(r.footprint),
      roads: roadLines(o.ring, o.roads).map((l) => ({ width: l.road.today, dp: l.road.dp, line: l.pts.map(r2) })),
      fsi: r.fsi, permissible: r2(r.bua),
    },
    buildings,
    schedule: e.rows.map((x) => ({ tag: x.tag, label: x.label, size: x.size, count: x.count })),
    totals: { builtUp: r2(d.bua), flats: d.flats, carpet: r2(d.carpet), height: r2(d.height), parking: { need: d.parking.need, have: d.parking.have } },
    design: ds,
  };
}

export const modelJson = (m: ProModel): string => JSON.stringify(m, null, 2);

// ---------------- IFC ----------------

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
/** an IFC GlobalId (22 characters of IFC's base-64: 2 bits, then 21 × 6), deterministic from a seed string */
function guid(seed: string): string {
  const h = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let i = 0; i < seed.length; i++) for (let k = 0; k < 4; k++) h[k] = Math.imul(h[k] ^ seed.charCodeAt(i), 16777619 + k * 2);
  for (let k = 0; k < 4; k++) h[k] = Math.imul(h[k] ^ (h[k] >>> 15), 2246822507) >>> 0;
  // 128 bits as bits, read 2 then 6 at a time
  let bits = '';
  for (const v of h) bits += v.toString(2).padStart(32, '0');
  let s = B64[parseInt(bits.slice(0, 2), 2)];
  for (let i = 2; i < 128; i += 6) s += B64[parseInt(bits.slice(i, i + 6), 2)];
  return s;
}
// (ISO 10303-21: past ASCII, each UTF-16 unit as four hex digits between \X2\ and \X0\)
const x2 = (m: string) => `\\X2\\${Array.from({ length: m.length }, (_, i) => m.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')).join('')}\\X0\\`;
const str = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/[^\x20-\x7e]+/g, x2)}'`;
const num = (v: number) => { const t = (Math.round(v * 1000) / 1000).toString(); return t.includes('.') || t.includes('e') ? t : `${t}.`; };

/** A minimal IFC4 file: project, site, building per building, a storey per level, a space per room (or per shop),
 *  each an extruded outline. Plan x, z become IFC X, −Y (north up), height Z. */
export function ifcLite(e: Evaluated, rooms: FlatRooms[][]): string {
  const m = buildModel(e, rooms);
  const L: string[] = [];
  let id = 0;
  const add = (s: string) => { id++; L.push(`#${id}=${s};`); return `#${id}`; };
  const pt3 = (x: number, y: number, z: number) => add(`IFCCARTESIANPOINT((${num(x)},${num(y)},${num(z)}))`);
  const origin = pt3(0, 0, 0);
  const zDir = add('IFCDIRECTION((0.,0.,1.))'), xDir = add('IFCDIRECTION((1.,0.,0.))');
  const axisAt = (p: string) => add(`IFCAXIS2PLACEMENT3D(${p},${zDir},${xDir})`);
  const world = axisAt(origin);
  const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${world},$)`);
  const len = add('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)'), ar = add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)'), vol = add('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)');
  const units = add(`IFCUNITASSIGNMENT((${len},${ar},${vol}))`);
  const project = add(`IFCPROJECT('${guid('project' + m.project.name)}',$,${str(m.project.name)},${str('UrbanPlan Pro scheme')},$,$,$,(${ctx}),${units})`);
  const place = (rel: string | null, z = 0) => add(`IFCLOCALPLACEMENT(${rel ?? '$'},${axisAt(z ? pt3(0, 0, z) : origin)})`);
  const sitePl = place(null);
  const site = add(`IFCSITE('${guid('site')}',$,'Site',$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  add(`IFCRELAGGREGATES('${guid('rel-project')}',$,$,$,${project},(${site}))`);
  const blds: string[] = [];
  m.buildings.forEach((b, bi) => {
    const bPl = place(sitePl);
    const bld = add(`IFCBUILDING('${guid('b' + bi)}',$,${str(b.name)},$,$,${bPl},$,$,.ELEMENT.,$,$,$)`);
    blds.push(bld);
    const storeys: string[] = [];
    for (const f of b.floors) {
      const sPl = place(bPl, f.z);
      const st = add(`IFCBUILDINGSTOREY('${guid(`s${bi}.${f.level}`)}',$,${str(f.level < 0 ? `Basement ${-f.level}` : f.level === 0 ? 'Ground' : `Level ${f.level}`)},${str(f.use)},$,${sPl},$,$,.ELEMENT.,${num(f.z)})`);
      storeys.push(st);
      const spaces: string[] = [];
      for (const u of f.units) {
        const parts = u.rooms.length ? u.rooms.map((x) => ({ name: `${u.id} ${x.name}`, ring: x.ring, long: `${u.type} · ${x.kind}` })) : [{ name: u.id, ring: u.ring, long: u.type }];
        for (const sp of parts) {
          if (sp.ring.length < 6) continue;
          const pts: string[] = [];
          for (let i = 0; i < sp.ring.length; i += 2) pts.push(add(`IFCCARTESIANPOINT((${num(sp.ring[i])},${num(-sp.ring[i + 1])}))`));
          const poly = add(`IFCPOLYLINE((${[...pts, pts[0]].join(',')}))`);
          const prof = add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${poly})`);
          const solid = add(`IFCEXTRUDEDAREASOLID(${prof},${axisAt(origin)},${zDir},${num(Math.max(0.1, f.height - 0.15))})`);
          const rep = add(`IFCSHAPEREPRESENTATION(${ctx},'Body','SweptSolid',(${solid}))`);
          const shape = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
          spaces.push(add(`IFCSPACE('${guid(`sp${bi}.${f.level}.${sp.name}`)}',$,${str(sp.name)},$,$,${place(sPl)},${shape},${str(sp.long)},.ELEMENT.,.INTERNAL.,$)`));
        }
      }
      if (spaces.length) add(`IFCRELAGGREGATES('${guid(`rel-s${bi}.${f.level}`)}',$,$,$,${st},(${spaces.join(',')}))`);
    }
    if (storeys.length) add(`IFCRELAGGREGATES('${guid(`rel-b${bi}`)}',$,$,$,${bld},(${storeys.join(',')}))`);
  });
  if (blds.length) add(`IFCRELAGGREGATES('${guid('rel-site')}',$,$,$,${site},(${blds.join(',')}))`);
  const now = new Date().toISOString().slice(0, 19);
  return [
    'ISO-10303-21;', 'HEADER;', "FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');",
    `FILE_NAME(${str(m.project.name + '.ifc')},'${now}',(''),(''),'UrbanPlan Pro','UrbanPlan Pro','');`,
    "FILE_SCHEMA(('IFC4'));", 'ENDSEC;', 'DATA;', ...L, 'ENDSEC;', 'END-ISO-10303-21;', '',
  ].join('\n');
}
