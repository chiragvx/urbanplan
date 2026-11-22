// The inspector: a panel on the view's right that follows what's picked. A building has its size, floors, shape,
// roof, skin, mix, design system, its checks, its systems and flat plans; the plot its authority, size, edges and
// their roads, and levels; a thing on the site its few numbers. The step's sheet keeps the project's settings; the
// view's bars stay for the quick changes. Desktop only: a phone keeps its read-only building card.
import type { ComponentChildren } from 'preact';
import type { Evaluated } from './evaluate';
import { CITIES, outline, type ProBuilding, type ProProject } from './project';
import { duplicated, ELEMENT_TOOLS, own, removed, spineLength, stretched, turned, type Picked } from './edit';
import { ELEMENTS, UNIT_LABEL, type SiteElement } from '../doc/site';
import { featureOf, INTERNAL_WIDTHS, DEFAULT_LEVELS, PLINTH_MIN, roadWidths, type Levels, type SiteFeature } from './siteObjects';
import { cap, DIRS, edgeFacing, withEdgeRoad } from './plotOps';
import { ShapePanel, shapeIt, withFloors } from './shapePanel';
import { MixBody, RoofBody, ShapeBody, SkinBody, StyleBody } from './formHud';
import { SystemsPanel } from './systemsPanel';
import { mergeSettings, splitSettings } from './systems';
import { FlatPlan } from './steps';
import type { FlatRooms } from './rooms';
import type { Check } from './scrutiny';
import { checkBuilding, STATUS_ICON } from './viewer';
import { USE_LABEL } from './deal';
import { Btn, Icon, Lines, Note, nf, Num, Section, Select, sqft } from './ui';

interface Props {
  p: ProProject; e: Evaluated; up: (o: Partial<ProProject>) => void;
  rooms: FlatRooms[][]; checks: Check[];
  picked: NonNullable<Picked>; pick: (x: Picked) => void;
  toast: (s: string) => void; xray: (floor: number) => void;
  /** hide the panel (the pick stays) */
  hide: () => void;
  readOnly: boolean;
}

const m = (v: number) => `${nf(v, 1)} m`;

function Frame({ title, meta, actions, hide, children }: { title: ComponentChildren; meta?: ComponentChildren; actions?: ComponentChildren; hide: () => void; children: ComponentChildren }) {
  return (
    <aside class="insp" aria-label="Inspector" onKeyDown={(ev) => { if (ev.key !== 'Escape') ev.stopPropagation(); }}>
      <header>
        <div class="insp-t">{title}{meta && <small>{meta}</small>}</div>
        <span class="insp-a">{actions}<Btn kind="quiet" icon="x" title="Hide the inspector (the pick stays)" onClick={hide} /></span>
      </header>
      <div class="insp-b">{children}</div>
    </aside>
  );
}

export function Inspector(props: Props) {
  const { picked } = props;
  if (picked.k === 'building') return <BuildingInspector {...props} id={picked.id} />;
  if (picked.k === 'plot') return <PlotInspector {...props} />;
  return <ObjectInspector {...props} />;
}

// ================================================================ a building
function BuildingInspector({ p, e, up, rooms, checks, pick, toast, xray, hide, readOnly, id }: Props & { id: string }) {
  const { d, r } = e;
  const bi = d.buildings.findIndex((b) => b.b.id === id), br = d.buildings[bi];
  if (!br) return null;
  const ownB = (p.scheme?.buildings.find((b) => b.id === id) ?? { ...br.b, floors: br.floors }) as ProBuilding;
  const setB = (fn: (b: ProBuilding) => ProBuilding) => { const s = own(p, e); up({ scheme: { ...s, buildings: s.buildings.map((b) => (b.id === id ? fn(b) : b)) } }); };
  const name = ownB.name ?? `Building ${String.fromCharCode(65 + bi)}`;
  const bp = { p, b: ownB, setB, once: up };
  const residential = !ownB.form || ownB.form.uses.some((u) => u.use === 'residential');
  const straight = !ownB.form && !ownB.closed && ownB.spine.length === 4;
  const homes = [0, 1, 2].map((t) => br.perFloor[t] * br.floors);
  const bua = br.laid ? br.laid.floors.reduce((s, f) => s + f.area, 0) : br.plate * br.floors;
  const runs: { use: string; from: number; to: number }[] = [];
  br.laid?.floors.forEach((f, k) => { const u = f.kind ?? 'residential', last = runs[runs.length - 1]; if (last && last.use === u) last.to = k + 1; else runs.push({ use: u, from: k + 1, to: k + 1 }); });
  const mine = checks.filter((c) => checkBuilding(c.key) === bi && c.status !== 'pass' && c.status !== 'info');
  const deps = d.departures.filter((x) => x.ids.includes(id));
  const flats = (rooms[bi] ?? []).filter((fr, k, a) => fr.t < 3 && fr.rooms.length && a.findIndex((y) => y.t === fr.t) === k);
  const dup = () => { const s = own(p, e), src = s.buildings.find((b) => b.id === id); if (!src) return; const c = duplicated(src); up({ scheme: { ...s, buildings: [...s.buildings, c] } }); pick({ k: 'building', id: c.id }); toast(`Duplicated ${name}.`); };
  const del = () => { up(removed(p, e, { k: 'building', id })); pick(null); toast(`Removed ${name} · Ctrl+Z to undo`); };
  return (
    <Frame hide={hide}
      title={readOnly ? <b>{name}</b> : <input class="insp-name" value={name} aria-label="Name" onChange={(ev) => setB((b) => ({ ...b, name: (ev.target as HTMLInputElement).value.trim() || undefined }))} />}
      meta={<>{br.floors} floors · {m(br.height)} · {nf(br.plate)} m² plate</>}
      actions={!readOnly && <><Btn kind="quiet" icon="copy" title="Duplicate (Ctrl+D)" onClick={dup} /><Btn kind="quiet" icon="trash" title="Remove (Delete)" onClick={del} /></>}>
      {deps.map((x) => <Note tone="bad">{x.text}</Note>)}
      <Lines rows={[
        ['Built-up', sqft(bua)],
        ['Homes', `${homes.reduce((a, b) => a + b, 0)}${homes.some(Boolean) ? ` (${homes.map((n, t) => (n ? `${n} ${UNIT_LABEL[t]}` : '')).filter(Boolean).join(', ')})` : ''}`],
      ]} />
      <fieldset disabled={readOnly}>
        <Section title="Size">
          <div class="insp-row">
            <Num label="Floors" value={br.floors} set={(v) => setB((b) => withFloors(b, Math.max(1, Math.min(300, v))))} min={1} max={300} />
            {straight && <Num label="Length" value={Math.round(spineLength(ownB) * 10) / 10} set={(v) => setB((b) => stretched(b, Math.max(4, v)))} min={4} max={600} step={0.5} unit="m" />}
            {straight && <Num label="Depth" value={ownB.depth} set={(v) => setB((b) => ({ ...b, depth: Math.max(6, Math.min(80, v)) }))} min={6} max={80} step={0.5} unit="m" />}
          </div>
          <div class="insp-btns">
            <span>Turn</span>
            <button type="button" class="btn quiet" onClick={() => setB((b) => turned(b, -15))}>−15°</button>
            <button type="button" class="btn quiet" onClick={() => setB((b) => turned(b, 15))}>+15°</button>
            <button type="button" class="btn quiet" onClick={() => setB((b) => turned(b, 90))}>90°</button>
          </div>
        </Section>
        {ownB.form
          ? <>
            <Section title="Shape"><ShapeBody {...bp} /></Section>
            <ShapePanel b={ownB} floors={br.floors} set={setB} />
            <Section title="Roof"><RoofBody {...bp} /></Section>
            <Section title="Skin"><SkinBody {...bp} /></Section>
          </>
          : straight && <Section title="Shape" sub="Give it a form to sculpt: rings for its width, lean and twist, key floors, a slot."><Btn icon="wand" onClick={() => setB((b) => shapeIt(b, br.floors))}>Shape it</Btn></Section>}
        {residential && <Section title="Flat mix"><MixBody {...bp} /></Section>}
        <Section title="Design system" fold open={!!ownB.style}><StyleBody {...bp} /></Section>
      </fieldset>
      {runs.length > 1 && <Section title="Floors by use">
        <ul class="vruns">{runs.slice().reverse().map((u) => <li><button type="button" class="linkbtn" onClick={() => xray(u.from)}>{USE_LABEL[u.use as keyof typeof USE_LABEL] ?? u.use}</button><span>{u.from === u.to ? `floor ${u.from}` : `floors ${u.from}–${u.to}`}</span></li>)}</ul>
      </Section>}
      <Section title="Its checks" aside={<span class="sec-meta">{mine.length ? `${mine.length} to look at` : 'all clear'}</span>}>
        {mine.length ? mine.map((c) => <p class={`vchk ${c.status}`}><Icon n={STATUS_ICON[c.status]} size={14} /><span><b>{c.rule}</b> {c.proposed}</span></p>)
          : <p class="hint-line"><Icon n="check" size={14} />Nothing flagged for {name}.</p>}
        <Btn kind="quiet" icon="layers" onClick={() => xray(Math.max(1, Math.round(br.floors / 2)))}>X-ray it</Btn>
      </Section>
      <fieldset disabled={readOnly}>
        <Section title="Systems" fold open={false} sub="Stairs, lifts, ducts, plumbing, power and fire: sized for it, each one yours to set."><SystemsPanel b={br} settings={mergeSettings(p.systems?.byBuilding?.[id], p.systems?.site)} under={d.under} floorH={r.rules.floorH} code={r.code} name={name} basements={d.site.basements} bays={d.parking.have}
          set={(x) => { const { building, plant } = splitSettings(x); up({ systems: { site: plant, byBuilding: { ...(p.systems?.byBuilding ?? {}), [id]: building } } }); }} /></Section>
      </fieldset>
      {flats.length > 0 && <Section title="Flat plans" fold open={false} sub="Rooms fitted into each flat of a typical floor, checked against the minimum room sizes.">
        <div class="flats">{flats.map((fr) => <FlatPlan t={fr.t} fr={fr} />)}</div>
      </Section>}
    </Frame>
  );
}

// ================================================================ the plot
function PlotInspector({ p, e, up, hide, readOnly }: Props) {
  const city = CITIES.find((c) => c.value === p.city)!;
  const o = outline(p), ring = o.ring, n = ring.length / 2, north = p.north ?? 0;
  const widths = roadWidths(e.r.code);
  const L: Levels = { ...DEFAULT_LEVELS, ...(p.levels ?? {}) };
  const setLv = (x: Partial<Levels>) => up({ levels: { ...L, ...x, terrain: false } });
  return (
    <Frame hide={hide} title={<b>Plot</b>} meta={<>{nf(e.r.area)} m² · {sqft(e.r.area)}</>}>
      <fieldset disabled={readOnly}>
        <Section title="Authority">
          <Select label="Planning authority" hint={city.note} value={p.city} onChange={(v) => up({ city: v })} options={CITIES.map((c) => ({ value: c.value, label: c.label }))} />
        </Section>
        {p.shape !== 'poly' && <Section title="Size">
          <div class="insp-row"><Num label="Frontage" value={p.width} set={(v) => up({ width: v, shape: 'rect' })} min={10} max={600} unit="m" /><Num label="Depth" value={p.depth} set={(v) => up({ depth: v, shape: 'rect' })} min={10} max={600} unit="m" /></div>
        </Section>}
        <Section title="Edges and roads" sub="Each edge's road today, and its width in the development plan. Drag the corners on the view.">
          <table class="insp-edges">
            <thead><tr><th>Edge</th><th>Length</th><th>Road</th><th>DP</th></tr></thead>
            <tbody>{Array.from({ length: n }, (_, k) => {
              const i = 2 * k, j = 2 * ((k + 1) % n), len = Math.hypot(ring[j] - ring[i], ring[j + 1] - ring[i + 1]), rd = o.roads[k];
              return <tr>
                <td>{cap(edgeFacing(ring, k, north))}</td>
                <td>{m(len)}</td>
                <td><Select<number> size="sm" aria-label={`Road on the ${edgeFacing(ring, k, north)} edge`} value={rd?.today ?? 0} onChange={(v) => up(withEdgeRoad(p, k, v ? { today: v, dp: Math.max(rd?.dp ?? 0, 0) } : null))}
                  options={[{ value: 0, label: 'None' }, ...widths.map((w) => ({ value: w, label: `${w} m` }))]} /></td>
                <td>{rd ? <Select<number> size="sm" aria-label={`Development-plan width on the ${edgeFacing(ring, k, north)} edge`} value={rd.dp > rd.today ? rd.dp : 0} onChange={(v) => up(withEdgeRoad(p, k, { today: rd.today, dp: v }))}
                  options={[{ value: 0, label: 'Same' }, ...widths.filter((w) => w > rd.today).map((w) => ({ value: w, label: `${w} m` }))]} /> : '–'}</td>
              </tr>;
            })}</tbody>
          </table>
          {!o.roads.some(Boolean) && <Note tone="warn">No edge has a road: give one a road.</Note>}
        </Section>
        <Section title="Levels">
          <div class="insp-row">
            <Num label="Over the road" value={L.plot} set={(v) => setLv({ plot: v })} min={-10} max={30} step={0.1} unit="m" />
            <Num label="Slope" value={L.slope} set={(v) => setLv({ slope: v })} min={0} max={60} step={0.5} unit="%" />
          </div>
          {L.slope > 0 && <Select<number> label="Falls toward" value={L.dir} onChange={(v) => setLv({ dir: v })} options={DIRS.map((x, i) => ({ value: i * 45, label: cap(x) }))} />}
          {L.plot < PLINTH_MIN && <Note tone="warn">The plinth must stand at least {PLINTH_MIN} m over the road.</Note>}
        </Section>
        <Section title="North">
          <Num label="North (degrees)" value={north} set={(v) => up({ north: ((Math.round(v) % 360) + 360) % 360 })} min={0} max={359} step={5} unit="°" hint={p.at ? 'Set from the plot’s place on the map' : 'Or drag the compass'} />
        </Section>
      </fieldset>
    </Frame>
  );
}

// ================================================================ a thing on the site
function ObjectInspector({ p, e, up, picked, pick, toast, hide, readOnly }: Props) {
  const f: SiteFeature | undefined = picked.k === 'feature' ? (p.features ?? []).find((x) => x.id === picked.id) : undefined;
  const elD = picked.k === 'element' ? (e.d.site.elements ?? []).find((x) => x.id === picked.id) : undefined;
  const el: SiteElement | undefined = elD ? ((p.scheme?.elements.find((x) => x.id === elD.id) ?? elD) as SiteElement) : undefined;
  if (!f && !el) return null;
  const F = f ? featureOf(f.kind) : null;
  const name = el ? (ELEMENT_TOOLS.find((x) => x.kind === el.kind)?.label ?? ELEMENTS.find((x) => x.value === el.kind)?.label ?? 'On the grounds') : F!.label;
  const setEl = (fn: (x: SiteElement) => SiteElement) => { const s = own(p, e); up({ scheme: { ...s, elements: s.elements.map((x) => (x.id === el!.id ? fn(x) : x)) } }); };
  const setF = (o: Partial<SiteFeature>) => up({ features: (p.features ?? []).map((x) => (x.id === f!.id ? { ...x, ...o } : x)) });
  const del = () => { up(removed(p, e, picked)); pick(null); toast(`Removed the ${name.toLowerCase()} · Ctrl+Z to undo`); };
  return (
    <Frame hide={hide} title={<b>{name}</b>} actions={!readOnly && <Btn kind="quiet" icon="trash" title="Remove (Delete)" onClick={del} />}>
      <fieldset disabled={readOnly}>
        <p class="hint-line"><Icon n="edit" size={14} />Drag its points on the view.</p>
        {el?.kind === 'road' && <Select<number> label="Width" value={el.depth} onChange={(v) => setEl((x) => ({ ...x, depth: v }))} options={INTERNAL_WIDTHS.map((w) => ({ value: w, label: `${w} m` }))} />}
        {el?.kind === 'parking' && <Num label="Levels" value={el.levels ?? 3} set={(v) => setEl((x) => ({ ...x, levels: Math.max(1, Math.min(12, v)) }))} min={1} max={12} />}
        {(el?.kind === 'roundabout' || el?.kind === 'tank') && <Num label="Across" value={el.depth} set={(v) => setEl((x) => ({ ...x, depth: Math.max(2, Math.min(60, v)) }))} min={2} max={60} step={0.5} unit="m" />}
        {f && <>
          {F!.shape === 'point' && <Num label={f.kind === 'tree' ? 'Canopy' : 'Radius'} value={f.r ?? F!.r} set={(v) => setF({ r: Math.max(0.2, Math.min(30, v)) })} min={0.2} max={30} step={0.5} unit="m" />}
          <Num label="Kept clear" value={f.clear ?? F!.clear} set={(v) => setF({ clear: Math.max(0, Math.min(60, v)) })} min={0} max={60} step={0.5} unit="m" />
          <label class="f"><span class="f-l">What it is</span><input class="txt" value={f.note ?? ''} placeholder={f.kind === 'nobuild' ? 'Why: an easement…' : 'A note'} onChange={(ev) => setF({ note: (ev.target as HTMLInputElement).value || undefined })} /></label>
        </>}
      </fieldset>
    </Frame>
  );
}
