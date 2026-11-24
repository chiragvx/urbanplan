// The gallery: forms to drop on a plot and then shape. Each is drawn at a size that reads well (a tower about 30 m
// across, a slab 15 m deep) and scaled to the room it's given, keeping its proportions, within limits that keep it
// sensible: a tower never thinner than a core and flats round it, a public toilet never smaller than a toilet.
// Plans are local metres about the origin, local +x along `dir`. The skin is the design system's to say (its
// language), so no template sets one, bar the public toilet's screen, which is what makes it a toilet block; a
// roof's shape is the form's own (a villa's gable, a library's barrel), so templates keep theirs, flat for plain
// towers and blocks. Corners follow the language too, unless a template needs them sharp (a gable villa).
// A template that makes several buildings gives each after the first an `offset`: local metres from the origin,
// x along `dir` and z across it (left of it).
import type { Carve, Curve, Form, FormTemplate, KeyFloor, Pt, Roof, UseBand } from './types';

type Made = ReturnType<FormTemplate['make']>;

// ---------------- plans ----------------

const rect = (w: number, d: number): Curve => ({ pts: [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] });
const rectAt = (x0: number, z0: number, x1: number, z1: number): Curve => ({ pts: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] });
/** a rectangle with its corners rounded to r (drawn as corners, so it stays exactly this shape) */
function rrect(w: number, d: number, r: number): Curve {
  r = Math.min(r, w / 2 - 0.01, d / 2 - 0.01);
  const pts: Pt[] = [], cs: Pt[] = [[w / 2 - r, -d / 2 + r], [w / 2 - r, d / 2 - r], [-w / 2 + r, d / 2 - r], [-w / 2 + r, -d / 2 + r]];
  cs.forEach((c, k) => { for (let j = 0; j <= 4; j++) { const a = ((k - 1) * Math.PI) / 2 + (j / 4) * (Math.PI / 2); pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); } });
  return { pts };
}
/** an ellipse through n smooth points */
const ellipse = (w: number, d: number, n = 10): Curve => ({
  pts: Array.from({ length: n }, (_, k) => [Math.cos((k / n) * Math.PI * 2) * (w / 2), Math.sin((k / n) * Math.PI * 2) * (d / 2)] as Pt),
  sharp: Array(n).fill(false),
});
/** a closed curve through smooth points */
const smooth = (pts: Pt[]): Curve => ({ pts, sharp: pts.map(() => false) });

const flat = (parapet = 1.2): Roof => ({ kind: 'flat', pitch: 0, overhang: 0, dir: 0, parapet });
const homes = (floors: number): UseBand[] => [{ use: 'residential', floors }];

function form(f: Partial<Form> & Pick<Form, 'plan' | 'uses'>, template: string): Form {
  return { template, keys: [], ease: 'smooth', carves: [], roof: flat(), ...f };
}
const floorsIn = (f: Form) => f.uses.reduce((s, u) => s + u.floors, 0);

// ---------------- sizing ----------------

/** A form scaled by k in plan (its keys' shifts, its carves and their paths too; its shell's stand-off is a
 *  detail of the skin and stays as it is). */
function scaled(f: Form, k: number): Form {
  if (Math.abs(k - 1) < 1e-6) return f;
  const c = (x: Curve): Curve => ({ ...x, pts: x.pts.map(([a, b]) => [a * k, b * k] as Pt) });
  return {
    ...f,
    plan: c(f.plan),
    keys: f.keys.map((q): KeyFloor => ({ ...q, dx: q.dx * k, dz: q.dz * k, plan: q.plan ? c(q.plan) : undefined })),
    carves: f.carves.map((q): Carve => ({ ...q, ring: c(q.ring), path: q.path?.map((p) => ({ ...p, dx: p.dx * k, dz: p.dz * k })) })),
  };
}
/** The scale that fits a group w × d (local metres) into the room, kept between lo and hi. */
const fit = (w: number, d: number, room: { w: number; d: number } | undefined, lo: number, hi: number) =>
  room && room.w > 0 && room.d > 0 ? Math.max(lo, Math.min(hi, room.w / w, room.d / d)) : 1;

/** A template of one building: its natural size, how far it may shrink and grow, and the form. */
function one(id: string, name: string, group: FormTemplate['group'], blurb: string, w: number, d: number, lo: number, hi: number, make: () => Form): FormTemplate {
  return {
    id, name, group, blurb,
    make: (_o, _dir, room) => { const f = scaled(make(), fit(w, d, room, lo, hi)); return [{ form: f, floors: floorsIn(f), name }]; },
  };
}
/** A template of several: each part's form and offset at natural size, scaled together. */
function many(id: string, name: string, group: FormTemplate['group'], blurb: string, w: number, d: number, lo: number, hi: number, make: () => { form: Form; name: string; offset?: Pt }[]): FormTemplate {
  return {
    id, name, group, blurb,
    make: (_o, _dir, room) => {
      const k = fit(w, d, room, lo, hi);
      return make().map((p): Made[number] => {
        const f = scaled(p.form, k);
        return { form: f, floors: floorsIn(f), name: p.name, offset: p.offset ? [p.offset[0] * k, p.offset[1] * k] : undefined };
      });
    },
  };
}

// ---------------- towers ----------------

const box = one('box', 'Box tower', 'tower', 'A plain tower of flats.', 30, 22, 0.55, 1.4, () =>
  form({ plan: rect(30, 22), uses: homes(30) }, 'box'));

const taper = one('taper', 'Tapered tower', 'tower', 'Slimmer as it rises.', 32, 32, 0.5, 1.3, () =>
  form({ plan: rect(32, 32), keys: [{ t: 1, sx: 0.62, sz: 0.62, dx: 0, dz: 0, rot: 0 }], ease: 'linear', uses: homes(40) }, 'taper'));

const twist = one('twist', 'Twisted tower', 'tower', 'Each floor turned a little more.', 30, 30, 0.55, 1.3, () =>
  form({ plan: rrect(30, 30, 5), keys: [{ t: 1, sx: 1, sz: 1, dx: 0, dz: 0, rot: 90 }], ease: 'linear', uses: homes(48) }, 'twist'));

const stepped = one('stepped', 'Stepped tower', 'tower', 'Wedding-cake setbacks with terraces.', 36, 36, 0.5, 1.3, () =>
  form({
    plan: rect(36, 36),
    keys: [
      { t: 0.4, sx: 1, sz: 1, dx: 0, dz: 0, rot: 0 }, { t: 0.41, sx: 0.78, sz: 0.78, dx: 0, dz: 0, rot: 0 },
      { t: 0.72, sx: 0.78, sz: 0.78, dx: 0, dz: 0, rot: 0 }, { t: 0.73, sx: 0.56, sz: 0.56, dx: 0, dz: 0, rot: 0 },
    ],
    ease: 'linear', uses: [{ use: 'office', floors: 10 }, { use: 'residential', floors: 32 }],
  }, 'stepped'));

const roundT = one('round', 'Round tower', 'tower', 'A cylinder ringed with balconies.', 30, 30, 0.55, 1.3, () =>
  form({ plan: ellipse(30, 30, 12), uses: homes(36) }, 'round'));

const officePodium = one('office', 'Office on shops', 'tower', 'Offices over a two-floor shopping podium.', 48, 36, 0.6, 1.3, () => {
  const pod = 2, tower = 28, n = pod + tower;
  // (the tower's plate, and the podium a part added on the floors of shops: change either on its own)
  const w = 48 * 0.66, d = 36 * 0.72;
  return form({
    plan: rectAt(4 - w / 2, 2 - d / 2, 4 + w / 2, 2 + d / 2),
    carves: [{ id: 'podium', name: 'Podium', op: 'add', ring: rect(48, 36), from: 0, to: (pod - 1) / (n - 1), lo: 1, hi: pod, face: 'glass' }],
    uses: [{ use: 'retail', floors: pod }, { use: 'office', floors: tower }]
  }, 'office');
});

/** a crescent: a band `depth` deep on an arc of radius R through `sweep` degrees, centred on the origin */
function crescent(R: number, depth: number, sweep: number): Curve {
  const pts: Pt[] = [], sharp: boolean[] = [], k = 5, a0 = Math.PI / 2 - (sweep * Math.PI) / 360, a1 = Math.PI / 2 + (sweep * Math.PI) / 360;
  for (let j = 0; j <= k; j++) { const a = a0 + ((a1 - a0) * j) / k; pts.push([Math.cos(a) * (R + depth / 2), Math.sin(a) * (R + depth / 2) - R]); sharp.push(j === 0 || j === k); }
  for (let j = k; j >= 0; j--) { const a = a0 + ((a1 - a0) * j) / k; pts.push([Math.cos(a) * (R - depth / 2), Math.sin(a) * (R - depth / 2) - R]); sharp.push(j === 0 || j === k); }
  // (centred on its box)
  let z0 = Infinity, z1 = -Infinity;
  for (const p of pts) { z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  return { pts: pts.map(([x, z]) => [x, z - (z0 + z1) / 2] as Pt), sharp };
}
const hotel = one('hotel', 'Hotel', 'tower', 'A curved slab of rooms over a lobby.', 62, 24, 0.55, 1.3, () =>
  form({ plan: crescent(45, 17, 80), uses: [{ use: 'retail', floors: 1 }, { use: 'hotel', floors: 16 }] }, 'hotel'));

// ---------------- sculpted ----------------

/** an S-curved slab: a centre line on a sine, `depth` deep, round at the ends */
function wave(len: number, depth: number, amp: number): Curve {
  const pts: Pt[] = [], k = 6, h = depth / 2, f = (x: number) => amp * Math.sin((Math.PI * x) / (len / 2));
  for (let j = 0; j <= k; j++) { const x = -len / 2 + (len * j) / k; pts.push([x, f(x) - h]); }
  pts.push([len / 2 + h * 0.8, 0]);
  for (let j = k; j >= 0; j--) { const x = -len / 2 + (len * j) / k; pts.push([x, f(x) + h]); }
  pts.push([-len / 2 - h * 0.8, 0]);
  return smooth(pts);
}
const waveBlock = one('wave', 'Wave block', 'sculpted', 'A rippling block with deep fins.', 72, 28, 0.5, 1.3, () =>
  form({
    plan: wave(60, 16, 5), uses: [{ use: 'retail', floors: 1 }, { use: 'residential', floors: 11 }]
  }, 'wave'));

const monolith = many('monolith', 'Monolith', 'sculpted', 'A white tower split by a zig-zag glass slot.', 58, 34, 0.6, 1.25, () => {
  const zig = [0, 0.18, 0.36, 0.54, 0.72, 0.9, 1].map((t, i) => ({ t, dx: i % 2 ? 3.2 : -3.2, dz: 0 }));
  const slot = (z0: number, z1: number, id: string): Carve => ({ id, name: 'Glass slot', ring: rectAt(-1.5, z0, 1.5, z1), from: 0.04, to: 1, path: zig, face: 'glass' });
  const tower = form({
    plan: rect(26, 26), round: 0.12, uses: homes(44),
    carves: [slot(-14, -5.5, 'front'), slot(5.5, 14, 'back')],
    roof: { kind: 'tilted', pitch: 6, overhang: 0, dir: 0 }
  }, 'monolith');
  // the low wing sliding out of the base, its upper floor cantilevered further
  const wing = form({
    plan: rect(22, 12), round: 0, uses: [{ use: 'retail', floors: 1 }, { use: 'office', floors: 1 }],
    keys: [{ t: 1, sx: 1, sz: 1, dx: 5, dz: 0, rot: 0 }], ease: 'linear', roof: flat(0.6)
  }, 'monolith');
  return [{ form: tower, name: 'Tower' }, { form: wing, name: 'Podium wing', offset: [24, -7] }];
});

const twins = many('twins', 'Sculpted twins', 'sculpted', 'Two S-curved towers in fluted fin shells.', 80, 34, 0.55, 1.25, () => {
  const make = (s: number): Form => form({
    plan: ellipse(30, 25, 10),
    keys: [
      { t: 0, sx: 0.92, sz: 0.92, dx: 0, dz: 0, rot: 0 },
      { t: 0.3, sx: 1.1, sz: 1.08, dx: 2.5 * s, dz: 0, rot: 0 },
      { t: 0.65, sx: 0.94, sz: 0.95, dx: -2 * s, dz: 0, rot: 0 },
      { t: 1, sx: 1.02, sz: 1, dx: 1 * s, dz: 0, rot: 0 },
    ],
    ease: 'smooth', uses: homes(46),
    shell: { offset: 1.6, over: 8, under: 6 }
  }, 'twins');
  return [{ form: make(1), name: 'Twin A' }, { form: make(-1), name: 'Twin B', offset: [44, 0] }];
});

const lean = one('lean', 'Leaning tower', 'sculpted', 'A tower leaning out over its base.', 34, 20, 0.55, 1.3, () =>
  form({ plan: rrect(26, 20, 3), keys: [{ t: 1, sx: 1, sz: 1, dx: 8, dz: 0, rot: 0 }], ease: 'linear', uses: homes(30) }, 'lean'));

const skyGarden = one('skygarden', 'Sky garden tower', 'sculpted', 'Open-air gardens carved out of its corners.', 30, 30, 0.55, 1.3, () =>
  form({
    plan: rect(30, 30), uses: homes(40),
    carves: [
      { id: 'garden-1', name: 'Sky garden', ring: rectAt(7, 7, 16, 16), from: 0.42, to: 0.5, face: 'open' },
      { id: 'garden-2', name: 'Sky garden, higher', ring: rectAt(-16, -16, -7, -7), from: 0.74, to: 0.82, face: 'open' },
    ],
  }, 'skygarden'));

// ---------------- homes ----------------

const courtyard = one('courtyard', 'Courtyard homes', 'homes', 'A block of flats round a green court.', 50, 40, 0.65, 1.4, () =>
  form({
    plan: rrect(50, 40, 3), uses: homes(9),
    carves: [{ id: 'court', name: 'Court', ring: rrect(26, 16, 2), from: 0, to: 1, face: 'open' }],
  }, 'courtyard'));

const twinSlab = many('twinslab', 'Twin slabs', 'homes', 'Two long slabs of flats, a garden between.', 56, 47, 0.5, 1.3, () => {
  const slab = form({ plan: rect(56, 15), round: 0, uses: homes(14) }, 'twinslab');
  return [{ form: slab, name: 'Slab A' }, { form: { ...slab }, name: 'Slab B', offset: [0, 32] }];
});

const villa = one('villa', 'Villa', 'homes', 'A two-storey house under a gable roof.', 16, 12, 0.75, 1.4, () =>
  form({
    plan: { pts: [[-8, -6], [8, -6], [8, 2], [3, 2], [3, 6], [-8, 6]] }, round: 0, houses: 1, uses: homes(2),
    roof: { kind: 'gable', pitch: 28, overhang: 0.7, dir: 90 }
  }, 'villa'));

const rows = one('rows', 'Row houses', 'homes', 'Five narrow homes in a terrace.', 32.5, 11, 0.7, 1.4, () =>
  form({
    plan: rect(32.5, 11), round: 0, houses: 5, uses: homes(3),
    roof: { kind: 'hip', pitch: 28, overhang: 0.5, dir: 90 }
  }, 'rows'));

// ---------------- public ----------------

const library = one('library', 'Library', 'public', 'Three airy reading floors under a barrel roof.', 46, 30, 0.6, 1.4, () =>
  form({
    plan: smooth([[-22, 0], [-15, -12], [0, -14], [15, -11], [22, 0], [13, 13], [0, 10], [-13, 13]]),
    keys: [{ t: 1, sx: 1.06, sz: 1.08, dx: 0, dz: 0, rot: 0 }], ease: 'linear',
    uses: [{ use: 'library', floors: 3 }],
    roof: { kind: 'barrel', pitch: 0.12, overhang: 1.2, dir: 90 }
  }, 'library'));

const toilet = one('toilet', 'Public toilet', 'public', 'A small screened block with a mono roof.', 7, 4, 0.86, 1.4, () =>
  form({
    plan: rect(7, 4), round: 0, uses: [{ use: 'toilet', floors: 1 }],
    roof: { kind: 'mono', pitch: 8, overhang: 0.6, dir: 90 },
    skin: { pattern: 'screen' },
  }, 'toilet'));

const hall = one('hall', 'Community hall', 'public', 'One tall hall under a hipped roof.', 26, 17, 0.6, 1.4, () =>
  form({
    plan: rrect(26, 17, 1), uses: [{ use: 'community', floors: 1, floorH: 6 }],
    roof: { kind: 'hip', pitch: 22, overhang: 1.2, dir: 90 }
  }, 'hall'));

export const TEMPLATES: FormTemplate[] = [
  box, taper, twist, stepped, roundT, officePodium, hotel,
  courtyard, twinSlab, villa, rows,
  library, toilet, hall,
  waveBlock, monolith, twins, lean, skyGarden,
];
