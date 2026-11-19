// One building's systems: cores, electricals, plumbing, fire, HVAC. Each setting shows what it works out to on its own
// ("Auto"); change it and a small "Auto" button puts it back. The cost sits at the top; what fails a rule sits in the
// group it belongs to, with an icon and a word (never colour alone). The figures are concept-stage estimates (./systems.ts).
import { useMemo } from 'preact/hooks';
import type { BuildingReport } from '../doc/site';
import { Icon, Lines, Note, Num, Row, Section, Seg, Select, Toggle, cr, nf, type Children } from './ui';
import { SYSTEMS_GROUPS, TX_RATINGS, systemsOf, type Code, type SystemsCheck, type SystemsGroup, type SystemsResult, type SystemsSettings } from './systems';
import './systemsPanel.css';

type G = keyof SystemsSettings;
type Bag = Record<string, unknown>;

export function SystemsPanel({ b, settings, set, under, floorH, code, name, basements, bays }: {
  b: BuildingReport; settings: SystemsSettings | undefined; set: (s: SystemsSettings) => void;
  under: number; floorH: number; code: Code; name: string;
  /** basement levels and car bays on the site, when known (basement ventilation, sprinklers, EV points) */
  basements?: number; bays?: number;
}) {
  const s = settings ?? {};
  const r = useMemo(() => systemsOf(b, { under, floorH, code, settings: s, basements, bays }), [b, settings, under, floorH, code, basements, bays]);
  const A = r.auto;

  const get = (g: G, k: string): unknown => (s[g] as Bag | undefined)?.[k];
  const put = (g: G, k: string, v: unknown) => {
    const grp: Bag = { ...((s[g] as Bag | undefined) ?? {}) };
    if (v === undefined) delete grp[k]; else grp[k] = k === 'liftCap' ? Number(v) : v;
    const next: Bag = { ...s };
    if (Object.keys(grp).length) next[g] = grp; else delete next[g];
    set(next as SystemsSettings);
  };
  /** one entry of a per-flat-type figure (flatKW, persons) */
  const putFlat = (g: G, k: string, t: number, v: number | undefined) => {
    const cur: Bag = { ...((get(g, k) as Bag | undefined) ?? {}) };
    if (v === undefined) delete cur[t]; else cur[t] = v;
    put(g, k, Object.keys(cur).length ? cur : undefined);
  };

  // ---- controls that know "auto"
  const tag = (over: boolean, reset: () => void, autoText: string) => over
    ? <button type="button" class="sys-tag reset" onClick={reset} data-tip={`Back to auto: ${autoText}`} aria-label={`Back to auto (${autoText})`}><Icon n="undo" size={12} />Auto</button>
    : <span class="sys-tag" title="Worked out for this building">Auto</span>;

  const N = ({ g, k, label, auto, unit, step = 1, min = 0, max = 99999, d = 0 }: { g: G; k: string; label: string; auto: number; unit?: string; step?: number; min?: number; max?: number; d?: number }) => {
    const v = get(g, k) as number | undefined;
    return <div class="sys-c">{tag(v !== undefined, () => put(g, k, undefined), `${nf(auto, d)}${unit ? ` ${unit}` : ''}`)}<Num label={label} value={v ?? Number(auto.toFixed(d))} set={(x) => put(g, k, x)} unit={unit} step={step} min={min} max={max} /></div>;
  };
  const NFlat = ({ g, k, t, label, auto, unit, step = 0.5 }: { g: G; k: string; t: 0 | 1 | 2; label: string; auto: number; unit?: string; step?: number }) => {
    const v = (get(g, k) as Bag | undefined)?.[t] as number | undefined;
    return <div class="sys-c">{tag(v !== undefined, () => putFlat(g, k, t, undefined), nf(auto, 1))}<Num label={label} value={v ?? auto} set={(x) => putFlat(g, k, t, x)} unit={unit} step={step} min={0} max={100} /></div>;
  };
  const T = ({ g, k, label, auto, hint }: { g: G; k: string; label: string; auto: boolean; hint?: string }) => {
    const v = get(g, k) as boolean | undefined;
    return <div class="sys-c sys-row"><Toggle label={label} value={v ?? auto} set={(x) => put(g, k, x)} hint={hint} />{tag(v !== undefined, () => put(g, k, undefined), auto ? 'on' : 'off')}</div>;
  };
  const S = <V extends string>({ g, k, label, auto, options }: { g: G; k: string; label: string; auto: V; options: { value: V; label: string; title?: string }[] }) => {
    const raw = get(g, k), v = raw === undefined ? undefined : (String(raw) as V);
    return <div class="sys-c">{tag(v !== undefined, () => put(g, k, undefined), options.find((o) => o.value === auto)?.label ?? auto)}<Seg label={label} value={v ?? auto} set={(x) => put(g, k, x)} options={options} /></div>;
  };

  const types = ([0, 1, 2] as const).filter((t) => b.perFloor[t] > 0);
  const shownTypes = types.length ? types : ([0, 1, 2] as const);
  const BHK = ['1 BHK', '2 BHK', '3 BHK'];

  const bad = r.checks.filter((c) => c.status === 'fail'), look = r.checks.filter((c) => c.status === 'warn');
  const lift = A.liftCap;
  const tx = get('electrical', 'transformer') as number | undefined;

  const body: Record<SystemsGroup, Children> = {
    Cores: <>
      <Row>{N({ g: 'cores', k: 'stairs', label: 'Stairs', auto: A.stairs, min: 1, max: 12 })}{N({ g: 'cores', k: 'stairW', label: 'Stair width', auto: A.stairW, unit: 'm', step: 0.05, min: 0.9, max: 3, d: 2 })}</Row>
      {S({ g: 'cores', k: 'stairType', label: 'Stair', auto: A.stairType, options: [{ value: 'dog-leg', label: 'Dog-leg', title: 'Two flights a floor, one stair to an enclosure' }, { value: 'scissor', label: 'Scissor', title: 'Two stairs crossing in one enclosure' }] })}
      <Row>{N({ g: 'cores', k: 'lifts', label: 'Lifts', auto: A.lifts, max: 24 })}{N({ g: 'cores', k: 'liftSpeed', label: 'Speed', auto: A.liftSpeed, unit: 'm/s', step: 0.5, min: 0.5, max: 8, d: 1 })}</Row>
      {S({ g: 'cores', k: 'liftCap', label: 'Persons a lift', auto: String(lift) as '6' | '8' | '10' | '13', options: (['6', '8', '10', '13'] as const).map((x) => ({ value: x, label: x })) })}
      {T({ g: 'cores', k: 'fireLift', label: 'Fire lift', auto: A.fireLift, hint: 'One of the lifts' })}
      {T({ g: 'cores', k: 'serviceLift', label: 'Service lift', auto: A.serviceLift, hint: 'A stretcher car, 13 persons' })}
      {T({ g: 'cores', k: 'lobby', label: 'Lift lobby', auto: A.lobby, hint: 'Enclosed, smoke-free' })}
      {T({ g: 'cores', k: 'chute', label: 'Garbage chute', auto: A.chute })}
      {N({ g: 'cores', k: 'refuges', label: 'Refuge floors', auto: A.refuges, max: 20 })}
    </>,
    Electrical: <>
      <Row n={shownTypes.length === 3 ? 3 : 2}>{shownTypes.map((t) => NFlat({ g: 'electrical', k: 'flatKW', t: t, label: BHK[t], auto: A.flatKW[t], unit: 'kW' }))}</Row>
      <Row>{N({ g: 'electrical', k: 'commonKW', label: 'Common load', auto: A.commonKW, unit: 'kW', step: 5 })}{N({ g: 'electrical', k: 'diversity', label: 'Diversity', auto: A.diversity, step: 0.05, min: 0.2, max: 1, d: 2 })}</Row>
      <div class="sys-c">{tag(tx !== undefined, () => put('electrical', 'transformer', undefined), `${nf(A.transformer)} kVA`)}
        <Select label="Transformer" value={tx ?? A.transformer} onChange={(v) => put('electrical', 'transformer', v)} options={[...new Set([...TX_RATINGS, A.transformer])].sort((x, y) => x - y).map((v) => ({ value: v, label: `${nf(v)} kVA` }))} />
      </div>
      {S({ g: 'electrical', k: 'dg', label: 'DG backup', auto: A.dg, options: [{ value: 'none', label: 'None' }, { value: 'common', label: 'Common', title: 'Lifts, pumps and common areas' }, { value: 'full', label: 'Full', title: 'The whole load' }] })}
      <Row>{N({ g: 'electrical', k: 'solar', label: 'Rooftop solar', auto: A.solar, unit: 'kWp', step: 5 })}{evNum()}</Row>
    </>,
    Plumbing: <>
      {N({ g: 'plumbing', k: 'lpcd', label: 'Water a person', auto: A.lpcd, unit: 'L/day', step: 5, min: 45, max: 300 })}
      <Row n={shownTypes.length === 3 ? 3 : 2}>{shownTypes.map((t) => NFlat({ g: 'plumbing', k: 'persons', t: t, label: `Persons, ${BHK[t]}`, auto: A.persons[t] }))}</Row>
      <Row>{N({ g: 'plumbing', k: 'ugt', label: 'Underground', auto: A.ugt, unit: 'kL', step: 5 })}{N({ g: 'plumbing', k: 'oht', label: 'Overhead', auto: A.oht, unit: 'kL', step: 5 })}</Row>
      {N({ g: 'plumbing', k: 'stp', label: 'STP', auto: A.stp, unit: 'KLD', step: 5 })}
      {S({ g: 'plumbing', k: 'rwh', label: 'Rainwater harvesting', auto: A.rwh, options: [{ value: 'none', label: 'None' }, { value: 'pit', label: 'Recharge pits' }, { value: 'tank', label: 'Tank' }] })}
    </>,
    Fire: <>
      {S({ g: 'fire', k: 'riser', label: 'Riser', auto: A.riser, options: [{ value: 'none', label: 'None' }, { value: 'downcomer', label: 'Downcomer' }, { value: 'wet', label: 'Wet riser' }] })}
      {S({ g: 'fire', k: 'sprinklers', label: 'Sprinklers', auto: A.sprinklers, options: [{ value: 'none', label: 'None' }, { value: 'basement', label: 'Basements' }, { value: 'all', label: 'Throughout' }] })}
      {N({ g: 'fire', k: 'tank', label: 'Fire tank', auto: A.tank, unit: 'kL', step: 25 })}
      {T({ g: 'fire', k: 'alarm', label: 'Detection and alarm', auto: A.alarm })}
      {T({ g: 'fire', k: 'hydrant', label: 'Yard hydrants', auto: A.hydrant })}
      {T({ g: 'fire', k: 'pumpRoom', label: 'Pump room', auto: A.pumpRoom })}
    </>,
    HVAC: <>
      {S({ g: 'hvac', k: 'system', label: 'Air conditioning', auto: A.hvac, options: [{ value: 'none', label: 'Points only', title: 'Buyers fit their own' }, { value: 'split', label: 'Split' }, { value: 'vrv', label: 'VRV' }] })}
      {T({ g: 'hvac', k: 'basementVent', label: 'Basement ventilation', auto: A.basementVent, hint: 'Jet fans and smoke extraction' })}
      {T({ g: 'hvac', k: 'pressurise', label: 'Stair pressurisation', auto: A.pressurise })}
    </>,
  };

  /** EV points as a % of the bays (stored as a share) */
  function evNum() {
    const v = get('electrical', 'ev') as number | undefined;
    return <div class="sys-c">{tag(v !== undefined, () => put('electrical', 'ev', undefined), `${nf(A.ev * 100)}%`)}<Num label="EV charging" value={Math.round((v ?? A.ev) * 100)} set={(x) => put('electrical', 'ev', x / 100)} unit="% bays" step={5} max={100} /></div>;
  }

  return (
    <div class="sys">
      <div class="sys-top">
        <div class="sys-cost">
          <span>Systems · {name}</span>
          <b>{cr(r.cost)}</b>
          <small>₹{nf(r.costPerSqft)} / sq ft of built-up · estimate, as assumed</small>
        </div>
        <p class={`sys-sum${bad.length ? ' bad' : ''}`} role="status">
          {bad.length ? <><Icon n="x" size={14} stroke={2.25} /><b>{bad.length} failure{bad.length > 1 ? 's' : ''}</b></> : <><Icon n="check" size={14} stroke={2.25} />No failures</>}
          {look.length > 0 && <><Icon n="warn" size={14} />{look.length} to check</>}
        </p>
      </div>
      {SYSTEMS_GROUPS.map((g, i) => <Group key={g} g={g} r={r} open={i === 0}>{body[g]}</Group>)}
      <Section title="Plant rooms" fold open={false} aside={<span class="sec-meta">{nf(r.spaces.reduce((t, x) => t + x.area, 0))} m²</span>}>
        <Lines rows={r.spaces.map((x) => [x.label, `${nf(x.area)} m²`])} />
        <Note>Plant (substation, DG, tanks, STP, pump room) sized as if this building stood alone; on a site with more buildings it is shared.</Note>
      </Section>
    </div>
  );
}

function Group({ g, r, open, children }: { g: SystemsGroup; r: SystemsResult; open: boolean; children: Children }) {
  const checks = r.checks.filter((c) => c.group === g && (c.status === 'fail' || c.status === 'warn'));
  const fails = checks.filter((c) => c.status === 'fail').length;
  const lines = r.lines.filter((l) => l.group === g);
  return (
    <Section title={g} fold open={open} aside={
      <span class="sys-aside">
        <span class="sec-meta">{cr(r.costBy[g])}</span>
        {fails > 0 && <span class="sys-flag" aria-label={`${fails} failure${fails > 1 ? 's' : ''}`}><Icon n="x" size={11} stroke={2.75} />{fails}</span>}
      </span>
    }>
      {checks.map((c) => <CheckNote c={c} />)}
      {children}
      <Lines rows={lines.map((l) => [<>{l.label}{l.note && <small>{l.note}</small>}</>, <>{l.value}{l.site && <span class="sys-site" title="Site plant: shared by the site's buildings"> · site</span>}</>])} />
    </Section>
  );
}

function CheckNote({ c }: { c: SystemsCheck }) {
  const fail = c.status === 'fail';
  return (
    <Note tone={fail ? 'bad' : 'warn'}>
      <span class="sys-chk">
        <Icon n={fail ? 'x' : 'warn'} size={14} stroke={2.25} />
        <span><b>{fail ? 'Fails' : 'Check'}: {c.rule}.</b> Needs {c.required}; proposed {c.proposed}. <small>{c.clause}</small></span>
      </span>
    </Note>
  );
}
