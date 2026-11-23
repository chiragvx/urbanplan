// The dashboard's Sites (docs/plans/pro-global-ux.md Phase 7): every plot looked at, ranked by what its land is worth
// under the firm's default prices, each with a status in the buying pipeline. Paste plots or add one; open the ones
// worth designing as projects at the Looking stage. Kept in this browser for now (src/pro/sites.ts).
//
// The figures take about a seventh of a second a plot, so they're worked out one plot at a time after the page
// draws, and kept with each site until its plot or the prices change.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Btn, cr, Dialog, download, Menu, nf, Num, pct, Seg, Select } from '../pro/ui';
import { CITIES, STAGE_LABEL, STAGES, type ProCity, type Stage } from '../pro/project';
import { SQFT } from '../doc/site';
import * as S from '../pro/sites';
import { I } from './icons';
import { proUrl } from './data';

type Show = 'open' | 'all' | S.SiteStatus;
/** the project opened from a site: where it is, and setting its stage (from the dashboard's projects) */
export type SiteProject = { href: string; stage: Stage; set: (s: Stage) => void };
const SAMPLE = 'Name, frontage, depth, road, DP road, asking ₹/sq ft\nBaner corner, 40, 55, 18, 24, 9500\nWakad, 30, 45, 12, 18\nKothrud lane, 22, 30, 9, 12, 14000';

export function Sites({ phone, area, toast, authority, linked }: { phone: boolean; area: (m2: number) => string; toast: (t: string) => void; authority: ProCity; linked?: (site: string) => SiteProject | null }) {
  const [sites, setSitesRaw] = useState<S.Site[]>(() => S.listSites());
  const [pr, setPrRaw] = useState<S.SitePrices>(() => { const x = S.sitePrices(); try { return localStorage.getItem('urbanplan:sites:prices') ? x : { ...x, city: authority }; } catch { return x; } });
  const [show, setShow] = useState<Show>('open');
  const [dlg, setDlg] = useState<null | 'paste' | 'add' | { k: 'edit' | 'delete'; s: S.Site }>(null);
  const setSites = (f: (l: S.Site[]) => S.Site[]) => setSitesRaw((l) => { const n = f(l); S.saveSites(n); return n; });
  const setPr = (x: S.SitePrices) => { setPrRaw(x); S.saveSitePrices(x); };
  const change = (id: string, ch: Partial<S.Site>) => setSites((l) => l.map((s) => (s.id === id ? { ...s, ...ch } : s)));

  // work out the figures still missing, one plot a tick, so the page stays alive
  const todo = sites.filter((s) => !S.kept(s, pr));
  useEffect(() => {
    const s = todo[0];
    if (!s) return;
    const t = setTimeout(() => {
      let f: S.SiteFigures | null = null;
      try { f = S.figures(s, pr); } catch { /* a plot the engine can't fill: left without figures */ }
      setSites((l) => l.map((x) => (x.id === s.id ? { ...x, fig: { k: S.figKey(s, pr), f: f ?? EMPTY } } : x)));
    }, 0);
    return () => clearTimeout(t);
  }, [todo[0] ? todo[0].id + S.figKey(todo[0], pr) : '']);

  const rows = useMemo(() => {
    const withF = sites.filter((s) => show === 'all' || (show === 'open' ? s.status !== 'dropped' && s.status !== 'bought' : s.status === show)).map((s) => ({ s, f: S.kept(s, pr) }));
    const done = S.ranked(withF.filter((x): x is { s: S.Site; f: S.SiteFigures } => !!x.f));
    return [...done, ...withF.filter((x) => !x.f)];
  }, [sites, pr, show]);
  const count = (v: Show) => sites.filter((s) => (v === 'all' ? true : v === 'open' ? s.status !== 'dropped' && s.status !== 'bought' : s.status === v)).length;

  /** its project when there is one; else a new one at the Looking stage */
  const open = (s: S.Site, fresh = false) => {
    const lk = fresh ? null : linked?.(s.id);
    change(s.id, { opened: new Date().toISOString(), ...(s.status === 'lead' ? { status: 'looking' as const } : {}) });
    location.assign(lk ? lk.href : proUrl(`?new=${encodeURIComponent(`site:${s.id}`)}`));
  };
  const csv = () => {
    const q = (x: string) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
    const head = 'Rank,Plot,Status,Frontage (m),Depth (m),Road (m),DP road (m),Area (sq ft),Potential (sq ft),Saleable carpet (sq ft),Homes,Worth outright (₹ cr),Worth (₹/sq ft of plot),Joint development share (%),Asking (₹/sq ft)';
    const body = rows.map((x, i) => [i + 1, q(x.s.name), x.s.status, x.s.width, x.s.depth, x.s.road, x.s.dp,
      ...(x.f ? [Math.round(x.f.area * SQFT), Math.round(x.f.potential * SQFT), Math.round(x.f.saleable * SQFT), x.f.homes, x.f.worth === null ? '' : (x.f.worth / 1e7).toFixed(2), x.f.worthRate === null ? '' : Math.round(x.f.worthRate), x.f.share === null ? '' : x.f.share.toFixed(1)] : ['', '', '', '', '', '', '']),
      x.s.asking ?? ''].join(','));
    download('sites.csv', [head, ...body].join('\n'), 'text/csv');
  };

  const T = pr.target;
  return (
    <div class="d-page wide">
      <header class="d-head">
        <h1>Sites</h1>
        {!phone && <div class="d-head-a">
          {sites.length > 0 && <Btn icon="down" onClick={csv}>CSV</Btn>}
          <Btn icon="plus" onClick={() => setDlg('add')}>Add a plot</Btn>
          <Btn kind="primary" icon="upload" onClick={() => setDlg('paste')}>Paste plots</Btn>
        </div>}
      </header>
      <p class="d-sub muted">Every plot you’re looking at, ranked by the most its land is worth under your default prices. Open the ones worth designing as projects.</p>

      <section class="d-prices" aria-label="Default prices">
        <Select<ProCity> label="Rules" value={pr.city} onChange={(city) => setPr({ ...pr, city })} options={CITIES.map((c) => ({ value: c.value, label: c.label }))} disabled={phone} />
        <Num label="Sale price" value={pr.sale} set={(sale) => setPr({ ...pr, sale })} max={200000} step={100} unit="₹/sq ft" zero="The city’s" />
        <span class="d-target">
          <Seg<'margin' | 'irr'> small ariaLabel="Target by" value={T.by} set={(by) => setPr({ ...pr, target: { by, v: by === T.by ? T.v : by === 'irr' ? 0.18 : 0.2 } })} options={[{ value: 'margin', label: 'Margin' }, { value: 'irr', label: 'IRR' }]} />
          <Num label={T.by === 'margin' ? 'Target margin' : 'Target IRR'} value={Math.round(T.v * 100)} set={(v) => setPr({ ...pr, target: { by: T.by, v: v / 100 } })} min={1} max={80} unit="%" />
        </span>
      </section>

      {sites.length === 0 ? (
        <div class="d-empty"><I n="pin" size={28} /><b>No sites yet</b>
          <p>Paste plots from a broker’s list or a land bank, one a line: name, frontage, depth, road, DP road, and what’s asked per sq ft if you know it.</p>
          {!phone && <Btn kind="primary" icon="upload" onClick={() => setDlg('paste')}>Paste plots</Btn>}
        </div>
      ) : <>
        <div class="d-sites-bar">
          <Seg<Show> small ariaLabel="Show" value={show} set={setShow} options={[
            { value: 'open', label: `Open ${count('open') || ''}`.trim(), title: 'All but bought and dropped' },
            ...S.STATUSES.map((x) => ({ value: x.value as Show, label: `${x.label} ${count(x.value) || ''}`.trim() })),
            { value: 'all', label: 'All' },
          ]} />
          {todo.length > 0 && <span class="muted small" role="status">Working out {sites.length - todo.length + 1} of {sites.length}…</span>}
        </div>
        <div class="tscroll">
          <table class="d-table d-sites">
            <thead><tr>
              <th class="num">#</th><th>Plot</th><th class="num hide-s">Area</th><th class="num hide-s">Road</th>
              <th class="num hide-s" data-tip="The built-up the FSI ladder allows, with every part taken">Potential</th>
              <th class="num hide-s" data-tip="RERA carpet the best scheme sells">Saleable</th>
              <th class="num" data-tip={`The most to pay outright and still make ${nf(T.v * 100)}% ${T.by === 'irr' ? 'IRR' : 'margin'}`}>Worth</th>
              <th class="num hide-s" data-tip="The largest share of revenue a landowner can be given in a joint development">JD share</th>
              <th>Status</th><th />
            </tr></thead>
            <tbody>{rows.map((x, i) => {
              const lk = linked?.(x.s.id), f = x.f, s = x.s, over = f && s.asking && f.worthRate !== null ? s.asking > f.worthRate : false;
              return (
                <tr class={s.status === 'dropped' ? 'off' : ''}>
                  <td class="num muted">{f ? i + 1 : ''}</td>
                  <td><b>{s.name}</b><small class="d-sline">{nf(s.width, 1)} × {nf(s.depth, 1)} m{s.note ? ` · ${s.note}` : ''}{s.opened && !lk ? ' · opened' : ''}</small>
                    {lk && <span class="d-sstage">Project{phone ? `: ${STAGE_LABEL[lk.stage]}` : <Select<Stage> size="sm" quiet aria-label={`${s.name}'s project: stage`} value={lk.stage} onChange={lk.set} options={STAGES.map((v) => ({ value: v, label: STAGE_LABEL[v] }))} />}</span>}</td>
                  <td class="num hide-s">{f ? area(f.area) : ''}</td>
                  <td class="num hide-s">{s.road} m{s.dp > s.road ? ` → ${s.dp}` : ''}</td>
                  <td class="num hide-s">{f ? area(f.potential) : ''}</td>
                  <td class="num hide-s">{f ? <>{area(f.saleable)}<small class="d-sline">{nf(f.homes)} homes</small></> : ''}</td>
                  <td class="num">{!f ? <span class="muted">…</span> : f.worth === null ? <span class="bad">Not at any price</span>
                    : <><b>{cr(f.worth)}</b><small class={`d-sline${over ? ' bad' : ''}`}>₹{nf(f.worthRate ?? 0)}/sq ft{s.asking ? ` · asks ₹${nf(s.asking)}` : ''}</small></>}</td>
                  <td class="num hide-s">{f ? (f.share === null ? '—' : pct(f.share / 100)) : ''}</td>
                  <td>{phone ? S.STATUSES.find((y) => y.value === s.status)?.label
                    : <Select<S.SiteStatus> size="sm" aria-label={`${s.name}: status`} value={s.status} onChange={(status) => change(s.id, { status })} options={S.STATUSES} />}</td>
                  <td class="num">{!phone && <span class="d-sact">
                    <Btn kind="quiet" icon="open" title={lk ? 'Open its project' : 'Start a project on this plot, at the Looking stage'} onClick={() => open(s)}>Open</Btn>
                    <Menu label={`${s.name}: more`} items={[
                      ...(lk ? [{ label: 'Open its project', icon: 'open', onSelect: () => open(s) }, { label: 'Start another project', icon: 'plus', onSelect: () => open(s, true) }] : [{ label: 'Open as a project', icon: 'open', onSelect: () => open(s) }]),
                      { label: 'Edit', icon: 'edit', onSelect: () => setDlg({ k: 'edit', s }) },
                      { label: 'Delete', icon: 'trash', onSelect: () => setDlg({ k: 'delete', s }) },
                    ]} />
                  </span>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <p class="hint-line">Each plot is a rectangle on its road, filled with the best scheme under these rules and prices, on the default deal. Underlined: asking more per sq ft than the land is worth. Kept in this browser for now.</p>
      </>}

      {dlg === 'paste' && <PasteDialog close={() => setDlg(null)} add={(xs, errors) => {
        setSites((l) => [...l, ...xs]); setDlg(null);
        toast(`${xs.length} plot${xs.length === 1 ? '' : 's'} added${errors ? `; ${errors} line${errors === 1 ? '' : 's'} couldn’t be read` : ''}.`);
      }} />}
      {dlg === 'add' && <SiteDialog title="Add a plot" close={() => setDlg(null)} done={(x) => { setSites((l) => [...l, S.newSite(x)]); setDlg(null); }} />}
      {dlg && typeof dlg === 'object' && dlg.k === 'edit' && <SiteDialog title="Edit the plot" s={dlg.s} close={() => setDlg(null)} done={(x) => { change(dlg.s.id, x); setDlg(null); }} />}
      {dlg && typeof dlg === 'object' && dlg.k === 'delete' && <Dialog title="Delete this site?" close={() => setDlg(null)}>
        <p><b>{dlg.s.name}</b> comes off the list. A project opened from it stays.</p>
        <div class="d-dlg-a"><Btn onClick={() => setDlg(null)}>Cancel</Btn><Btn kind="primary" icon="trash" onClick={() => { const id = dlg.s.id; setDlg(null); setSites((l) => l.filter((s) => s.id !== id)); toast('Deleted.'); }}>Delete</Btn></div>
      </Dialog>}
    </div>
  );
}

const EMPTY: S.SiteFigures = { area: 0, potential: 0, bua: 0, saleable: 0, homes: 0, revenue: 0, profit: 0, margin: 0, worth: null, worthRate: null, share: null };

function PasteDialog({ close, add }: { close: () => void; add: (xs: S.Site[], errors: number) => void }) {
  const [text, setText] = useState(SAMPLE);
  const res = useMemo(() => S.pasteSites(text), [text]);
  return (
    <Dialog title="Paste plots" close={close} wide>
      <p class="muted small">One a line, from a sheet or a message: <b>name, frontage, depth, road, DP road</b> (metres), and what’s asked per sq ft if you know it; or <b>name, area (m²), road</b>. Commas, tabs or semicolons. A header row is skipped.</p>
      <textarea class="d-paste" rows={10} value={text} aria-label="Plots, one a line" onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
      {res.errors.map((x) => <p class="note warn">{x}</p>)}
      <div class="d-dlg-a"><Btn onClick={close}>Cancel</Btn><Btn kind="primary" disabled={!res.sites.length} onClick={() => add(res.sites, res.errors.length)}>{res.sites.length ? `Add ${res.sites.length} plot${res.sites.length === 1 ? '' : 's'}` : 'Add'}</Btn></div>
    </Dialog>
  );
}

function SiteDialog({ title, s, close, done }: { title: string; s?: S.Site; close: () => void; done: (x: Omit<S.Site, 'id' | 'added' | 'status'>) => void }) {
  const [x, setX] = useState({ name: s?.name ?? '', width: s?.width ?? 30, depth: s?.depth ?? 40, road: s?.road ?? 12, dp: s?.dp ?? 18, asking: s?.asking ?? 0, note: s?.note ?? '' });
  const up = (ch: Partial<typeof x>) => setX({ ...x, ...ch });
  return (
    <Dialog title={title} close={close}>
      <form class="d-form" onSubmit={(e) => { e.preventDefault(); if (x.name.trim()) done({ name: x.name.trim(), width: x.width, depth: x.depth, road: x.road, dp: x.dp, ...(x.asking ? { asking: x.asking } : { asking: undefined }), ...(x.note.trim() ? { note: x.note.trim() } : { note: undefined }) }); }}>
        <label class="f"><span class="f-l">Name</span><input class="txt" value={x.name} autoFocus maxLength={80} onInput={(e) => up({ name: (e.target as HTMLInputElement).value })} /></label>
        <div class="row r2"><Num label="Frontage" value={x.width} set={(width) => up({ width })} min={4} max={1000} unit="m" /><Num label="Depth" value={x.depth} set={(depth) => up({ depth })} min={4} max={1000} unit="m" /></div>
        <div class="row r2"><Num label="Road today" value={x.road} set={(road) => up({ road })} min={3} max={90} unit="m" /><Num label="DP road" value={x.dp} set={(dp) => up({ dp })} max={90} unit="m" zero="None wider" /></div>
        <Num label="Asking" value={x.asking} set={(asking) => up({ asking })} max={500000} step={100} unit="₹/sq ft" zero="Not known" />
        <label class="f"><span class="f-l">Note</span><input class="txt" value={x.note} maxLength={120} placeholder="Broker, title, anything" onInput={(e) => up({ note: (e.target as HTMLInputElement).value })} /></label>
        <div class="d-dlg-a"><Btn onClick={close}>Cancel</Btn><Btn kind="primary" submit disabled={!x.name.trim()}>Save</Btn></div>
      </form>
    </Dialog>
  );
}
