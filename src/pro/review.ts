// The design review: the design system checked against the scheme as built, the way a design review panel or a
// developer's brand audit reads a facade. Each line passes or not, with what was found; the score is how many pass.
// Groups: composition, palette, climate and light, the street (entrance, signs, lighting), landscape, and the heritage
// precinct's own rules when there is one. Thresholds are rules of thumb from design codes and guidelines (cited
// inline), for discussion, not a statutory check.
import { roadFrame } from '../doc/site';
import { bearingOf, chhajjaOn, climateOf, compositionOf, landscapeOf, lightingOf, paletteOf, signageOf, zonesOf, ZONED_FROM } from './design';
import type { Evaluated } from './evaluate';
import { dsOfBuilding } from './evaluate';
import { precinctOf } from './heritage';
import { plantingOf } from './landscape';
import { facadeBays } from './openings';
import { PALETTE_SLOTS, PALETTE_TOLERANCE, sharesOf } from './palette';

export interface ReviewLine { group: string; label: string; ok: boolean; detail: string }
export interface Review { lines: ReviewLine[]; pass: number; total: number }

/** UDCPR asks trees on the plot (as assumed here: one for every 80 m² of plot area) */
const PLOT_PER_TREE = 80;
/** above this share of glass a facade gains more heat than shading can easily take back (a rule of thumb for hot
 *  climates; Amaravati's draft guidelines cap it at 30 %) */
const GLASS_MAX = 0.4;
/** a chhajja at least this deep shades a window on a south or west face at Indian latitudes for most of the day */
const SHADE_MIN = 0.45;

const pc = (v: number) => `${Math.round(v * 100)}%`;

export function review(e: Evaluated): Review {
  const { ds, d, r } = e, lines: ReviewLine[] = [];
  const add = (group: string, label: string, ok: boolean, detail: string) => lines.push({ group, label, ok, detail });
  const comp = compositionOf(ds), shares = e.facade.total > 0 ? sharesOf(e.facade) : null;
  const slabs = d.buildings.map((b, i) => ({ b, i, ds: dsOfBuilding(e.p, i, ds, b.b.id) })).filter((x) => !x.b.laid && x.b.quads.length);

  // composition
  const tall = d.buildings.filter((b) => b.floors >= ZONED_FROM);
  const zoned = tall.filter((b) => { const z = zonesOf(compositionOf(dsOfBuilding(e.p, d.buildings.indexOf(b), ds, b.b.id)), b.floors); return z.base > 0 || z.top > 0; });
  add('Composition', 'A base, a middle and a top', !tall.length || zoned.length === tall.length, tall.length ? `${zoned.length} of ${tall.length} buildings of ${ZONED_FROM}+ storeys` : 'No building tall enough to need it');
  add('Composition', 'Windows on a bay rhythm', comp.rhythm !== 'free', comp.rhythm === 'free' ? 'Spread flat by flat' : `${comp.rhythm === 'paired' ? 'Paired' : 'Even'} bays of about ${comp.bay.toFixed(1)} m`);
  add('Composition', 'An entrance that reads', comp.entrance !== 'none', comp.entrance === 'none' ? 'No canopy or portal' : comp.entrance === 'canopy' ? 'A canopy' : 'A portal');

  // palette
  if (shares) {
    const t = paletteOf(ds), on = PALETTE_SLOTS.filter((s) => Math.abs(shares[s.key] - t[s.key]) <= PALETTE_TOLERANCE).length;
    add('Palette', 'Palette on its targets', on === PALETTE_SLOTS.length, `${on} of ${PALETTE_SLOTS.length} within ${Math.round(PALETTE_TOLERANCE * 100)} points`);
    add('Palette', `Glass no more than ${pc(GLASS_MAX)} of the facade`, shares.glass <= GLASS_MAX, `${pc(shares.glass)} now`);
  } else add('Palette', 'Palette measured', false, 'No slab building to measure');

  // climate and light
  const cl = climateOf(ds);
  let hot = 0, shaded = 0;
  for (const { i, ds: bds } of slabs) for (const o of e.plans[i].openings) {
    if (!o.outside || o.tag === 'D1') continue;
    const br = ((bearingOf(o.nx, o.nz, e.p.north ?? 0) % 360) + 360) % 360;
    if (br < 135 || br > 315) continue; // south-east round to north-west: the faces the sun beats on
    hot++;
    const c = climateOf(bds), bal = o.tag === 'SD' && (bds.balcony.kind === 'cantilever' || bds.balcony.kind === 'recessed') && bds.balcony.depth >= SHADE_MIN;
    if (bal || chhajjaOn(c, br) >= SHADE_MIN || (bds.facade.fins && (o.tag === 'W1' || o.tag === 'SD')) || compositionOf(bds).reveal >= SHADE_MIN) shaded++;
  }
  add('Climate', 'Windows to the south and west shaded', !hot || shaded / hot >= 0.8, hot ? `${shaded} of ${hot} on the typical floors, by a chhajja, balcony, fin or reveal of ${SHADE_MIN} m+` : 'None face the sun');
  const fails = e.checks.filter((c) => !c.light || !c.air);
  add('Climate', 'Every flat meets the light and air rule', !fails.length, fails.length ? `${fails.length} flat type(s) short${cl.jaali !== 'none' ? ' (jaalis let through half)' : ''}` : `${e.checks.length} flat type(s) pass`);

  // the street: signs and lights
  const sg = signageOf(ds), F = roadFrame(r);
  let face = 0;
  for (const { b, ds: bds } of slabs) {
    const f = facadeBays(b.quads, compositionOf(bds).bay).filter((x) => !x.inner && x.nx * -F.vx + x.nz * -F.vz > 0.5);
    face += f.reduce((s, x) => s + x.L, 0) * (b.floors * r.rules.floorH + d.under * r.rules.floorH);
  }
  const named = sg.kind === 'none' ? 0 : slabs.length * (sg.kind === 'blade' ? 0.9 * sg.h * 4 : sg.h * Math.min(sg.h * 8, 30));
  const shop = e.shops ? e.shops.strips.reduce((s, st) => s + shopFrontage(st.ring, F) * 0.6, 0) : 0;
  const signShare = face > 0 ? (named + shop) / face : 0;
  add('Street', `Signs no more than ${pc(sg.cap)} of the front`, signShare <= sg.cap + 1e-6, face > 0 ? `${(signShare * 100).toFixed(1)}% of the road-facing faces${shop ? ', with the shop fascias' : ''}` : 'No road-facing face');
  const li = lightingOf(ds);
  add('Street', 'Warm light, kept off the sky', li.facade === 'none' || (li.kelvin <= 3000 && li.shielded), li.facade === 'none' ? 'No facade lighting' : `${li.kelvin} K, ${li.shielded ? 'shielded' : 'not shielded'}`);

  // landscape
  const land = landscapeOf(ds), area = r.netArea || 0;
  const garden = d.ground.map.plants.filter((t) => t.kind <= 1).length, extra = plantingOf(r, land, d.buildings.flatMap((b) => b.quads)).trees.length;
  const need = Math.ceil(area / PLOT_PER_TREE);
  add('Landscape', `A tree for every ${PLOT_PER_TREE} m² of plot`, garden + extra >= need, `${garden + extra} planted, ${need} asked (one per ${PLOT_PER_TREE} m², as assumed)`);

  // the precinct
  const pr = precinctOf(ds.precinct);
  if (pr) for (const rule of pr.rules) add(pr.name, rule.label, rule.ok({ ds, shares }), rule.detail({ ds, shares }));

  const pass = lines.filter((l) => l.ok).length;
  return { lines, pass, total: lines.length };
}

/** the length of a shop strip's edges that face the road */
function shopFrontage(ring: number[], F: ReturnType<typeof roadFrame>): number {
  let sa = 0, L = 0;
  for (let i = 0; i < ring.length; i += 2) { const j = (i + 2) % ring.length; sa += ring[i] * ring[j + 1] - ring[j] * ring[i + 1]; }
  const sg = sa > 0 ? 1 : -1;
  for (let i = 0; i < ring.length; i += 2) {
    const j = (i + 2) % ring.length, l = Math.hypot(ring[j] - ring[i], ring[j + 1] - ring[i + 1]);
    if (l < 1) continue;
    const ux = (ring[j] - ring[i]) / l, uz = (ring[j + 1] - ring[i + 1]) / l;
    if (uz * sg * -F.vx + -ux * sg * -F.vz > 0.5) L += l;
  }
  return L;
}
