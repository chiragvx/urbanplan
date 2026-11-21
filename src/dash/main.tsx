// The dashboard (/dashboard/): where a signed-in user lands. Their projects (with this browser's one beside them),
// folders, stars and the archive; their design systems; the people they work with; what happened lately; and their
// account: profile, sign-in and security, preferences, notifications, plan and usage, their data. Signed out, it shows
// the project in this browser and what an account adds.
//
// One page, routed by the hash (#/projects, #/settings/profile …) so it needs no server routes. Built from Pro's own
// controls (src/pro/ui.tsx) and tokens, so it reads as the same product.
import { render, type ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import '../theme/tokens.css';
import '../pro/pro.css';
import './dash.css';
import { authReady, BASE, explain, ROLES, session, signOut, startAuth, type Role as UserRole } from '../auth/auth';
import { Btn, Dialog, download, Menu, nf, Seg, Select, Toggle, TooltipLayer } from '../pro/ui';
import { Dither } from '../theme/Dither';
import { PRESETS } from '../pro/design';
import * as Lib from '../pro/designLibrary';
import { clone } from '../pro/design';
import { Builder } from './builder';
import { dropVersions } from '../pro/designVersions';
import { CITIES } from '../pro/project';
import { I } from './icons';
import * as D from './data';
import { summaryOf, type Summary } from './summary';

void startAuth();
D.applyTheme(D.prefs.value.theme);

// ---------------- routing ----------------

type View = 'home' | 'projects' | 'designs' | 'team' | 'activity' | 'settings';
type Tab = 'profile' | 'account' | 'preferences' | 'notifications' | 'plan' | 'data';
const route = () => {
  const [v, t] = location.hash.replace(/^#\/?/, '').split('/');
  const view = (['home', 'projects', 'designs', 'team', 'activity', 'settings'].includes(v) ? v : 'home') as View;
  return { view, tab: (t || 'profile') as Tab };
};
const go = (h: string) => { location.hash = h; };

const NAV: { v: View; label: string; icon: string }[] = [
  { v: 'home', label: 'Home', icon: 'home' },
  { v: 'projects', label: 'Projects', icon: 'folder' },
  { v: 'designs', label: 'Design systems', icon: 'palette' },
  { v: 'team', label: 'Team', icon: 'team' },
  { v: 'activity', label: 'Activity', icon: 'clock' },
  { v: 'settings', label: 'Settings', icon: 'gear' },
];

// ---------------- formatting ----------------

const ago = (iso: string | null | undefined) => {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: s > 86400 * 300 ? 'numeric' : undefined });
};
const area = (m2: number) => (D.prefs.value.area === 'm2' ? `${nf(m2)} m²` : `${nf(m2 * 10.7639)} sq ft`);
const money = (rs: number | null) => {
  if (rs === null) return '—';
  const neg = rs < 0 ? '−' : '', a = Math.abs(rs);
  return D.prefs.value.big === 'crore' ? `${neg}₹${nf(a / 1e7, 2)} cr` : `${neg}₹${nf(a / 1e6, 1)} M`;
};
const bytes = (b: number) => (b > 1e6 ? `${nf(b / 1e6, 1)} MB` : `${nf(Math.max(1, b / 1e3))} kB`);
const initials = (s: string) => s.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

// ---------------- the app ----------------

function App() {
  const [r, setR] = useState(route());
  useEffect(() => { const f = () => setR(route()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  const s = session.value;
  const user = s?.user ?? null;
  const [nav, setNav] = useState(false);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const data = useData(user?.id ?? null);
  useEffect(() => { setNav(false); }, [r.view, r.tab]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((x) => !x); }
      else if (!typing && e.key === '?') setHelp(true);
      else if (!typing && e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey) location.assign(D.newUrl());
    };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, []);
  const name = (user?.user_metadata?.full_name as string | undefined) || user?.email || '';
  const avatar = data.profile?.avatar_url ?? null;
  return (
    <div class={`dash${nav ? ' nav-open' : ''}`}>
      <aside class="d-side" aria-label="Dashboard">
        <div class="d-brand"><a class="logo" href={BASE} aria-label="UrbanPlan home"><Dither field="mark" cell={2} class="mark" />UrbanPlan</a><b class="chip">Pro</b></div>
        <a class="btn primary d-new" href={D.newUrl()}><I n="plus" size={16} />New project</a>
        <button type="button" class="d-search" onClick={() => setPalette(true)}><I n="search" size={15} /><span>Search</span><kbd>Ctrl K</kbd></button>
        <nav>
          {NAV.map((n) => (
            <a href={`#/${n.v}`} class={r.view === n.v ? 'on' : ''} aria-current={r.view === n.v ? 'page' : undefined}><I n={n.icon} size={17} />{n.label}
              {n.v === 'projects' && data.rows && <small>{data.rows.filter((x) => !x.archived_at).length + (data.local ? 1 : 0)}</small>}
            </a>
          ))}
        </nav>
        <div class="d-side-foot">
          <button type="button" class="d-link" onClick={() => setHelp(true)}><I n="help" size={16} />Help and shortcuts</button>
          {user ? (
            <div class="d-me">
              <Avatar url={avatar} name={name} />
              <span><b>{name.split('@')[0]}</b><small>{(data.profile?.plan ?? 'free') === 'free' ? 'Free plan' : `${data.profile!.plan} plan`}</small></span>
              <Menu label="Account" icon="more" items={[
                { label: 'Profile', icon: 'user', onSelect: () => go('#/settings/profile') },
                { label: 'Preferences', icon: 'palette', onSelect: () => go('#/settings/preferences') },
                { label: 'Plan and usage', icon: 'shield', onSelect: () => go('#/settings/plan') },
                { label: 'Sign out', icon: 'x', onSelect: () => void signOut().then(() => location.reload()) },
              ]} />
            </div>
          ) : authReady && s === null ? <a class="btn" href={`${BASE}login/?next=${encodeURIComponent(location.pathname)}`}><I n="user" size={16} />Sign in</a> : null}
        </div>
      </aside>
      <div class="d-scrim" onClick={() => setNav(false)} />
      <main class="d-main">
        <header class="d-top">
          <button type="button" class="d-menu" aria-label="Menu" onClick={() => setNav(true)}><I n="menu" /></button>
          <span class="d-top-t">{r.view === 'settings' ? 'Settings' : NAV.find((n) => n.v === r.view)?.label}</span>
          <button type="button" class="d-menu" aria-label="Search" onClick={() => setPalette(true)}><I n="search" /></button>
        </header>
        {s === undefined ? <p class="d-loading"><Dither class="dz" cell={2} />Loading…</p>
          : r.view === 'home' ? <Home data={data} name={name} signedIn={!!user} />
          : r.view === 'projects' ? <Projects data={data} signedIn={!!user} />
          : r.view === 'designs' ? <Designs sub={location.hash.replace(/^#\/?/, '').split('/')[1] ?? ''} />
          : r.view === 'team' ? <Team data={data} signedIn={!!user} />
          : r.view === 'activity' ? <Activity data={data} signedIn={!!user} />
          : <Settings tab={r.tab} data={data} signedIn={!!user} />}
      </main>
      {palette && <Palette data={data} close={() => setPalette(false)} />}
      {help && <Help close={() => setHelp(false)} />}
      <TooltipLayer />
      <Toasts />
    </div>
  );
}

// ---------------- data ----------------

interface Data {
  rows: D.Row[] | null; shared: D.Row[] | null; folders: D.Folder[] | null; foldersOff: boolean;
  profile: D.FullProfile | null; local: ReturnType<typeof D.localProject>; err: string | null;
  reload: () => void;
  /** change a row in place (a star, a rename) without waiting for a reload */
  patch: (id: string, ch: Partial<D.Row>) => void;
}
function useData(uid: string | null): Data {
  const [rows, setRows] = useState<D.Row[] | null>(null);
  const [shared, setShared] = useState<D.Row[] | null>(null);
  const [folders, setFolders] = useState<D.Folder[] | null>(null);
  const [foldersOff, setFoldersOff] = useState(false);
  const [profile, setProfile] = useState<D.FullProfile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const local = useMemo(() => D.localProject(), [n]);
  useEffect(() => {
    if (!uid) { setRows(null); setShared(null); setProfile(null); return; }
    let live = true;
    D.mine().then((x) => live && setRows(x), (e) => live && setErr(explain(e)));
    D.sharedWithMe().then((x) => live && setShared(x), () => live && setShared([]));
    D.folders().then((x) => live && setFolders(x), () => { if (live) { setFolders([]); setFoldersOff(true); } });
    D.profile().then((p) => { if (!live) return; setProfile(p); D.adoptPrefs(p?.prefs); });
    return () => { live = false; };
  }, [uid, n]);
  return {
    rows, shared, folders, foldersOff, profile, local, err,
    reload: () => setN((k) => k + 1),
    patch: (id, ch) => { setRows((l) => l && l.map((r) => (r.id === id ? { ...r, ...ch } : r))); },
  };
}

// ---------------- toasts ----------------

let pushToast: (t: string) => void = () => {};
const toast = (t: string) => pushToast(t);
function Toasts() {
  const [list, setList] = useState<{ id: number; t: string }[]>([]);
  pushToast = (t) => { const id = Date.now() + Math.random(); setList((l) => [...l, { id, t }]); setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), 3600); };
  return <div class="d-toasts" role="status" aria-live="polite">{list.map((x) => <div class="d-toast">{x.t}</div>)}</div>;
}
/** run an action, toast what came of it */
async function act(f: () => Promise<unknown>, ok?: string) {
  try { await f(); if (ok) toast(ok); return true; } catch (e) { toast(e instanceof D.NotReady ? e.message : explain(e)); return false; }
}

// ---------------- pieces ----------------

function Avatar({ url, name, size = 32 }: { url: string | null; name: string; size?: number }) {
  return url ? <img class="d-av" src={url} alt="" width={size} height={size} /> : <span class="d-av" style={`width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px`} aria-hidden="true">{initials(name) || '·'}</span>;
}

/** A project's thumbnail: its plot and the buildings on it, from above, the taller the darker. */
function Thumb({ s }: { s: Summary | null | undefined }) {
  if (!s || s.plot.length < 6) return <div class="d-thumb empty"><I n="site" size={26} /></div>;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < s.plot.length; i += 2) { x0 = Math.min(x0, s.plot[i]); x1 = Math.max(x1, s.plot[i]); z0 = Math.min(z0, s.plot[i + 1]); z1 = Math.max(z1, s.plot[i + 1]); }
  const w = x1 - x0 || 1, h = z1 - z0 || 1, pad = Math.max(w, h) * 0.12;
  const pts = (r: number[]) => r.reduce((a, v, i) => a + (i % 2 ? `,${(-v).toFixed(1)} ` : `${v.toFixed(1)}`), '');
  const hmax = Math.max(1, ...s.blds.map((b) => b.h));
  return (
    <svg class="d-thumb" viewBox={`${x0 - pad} ${-z1 - pad} ${w + 2 * pad} ${h + 2 * pad}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <polygon points={pts(s.plot)} class="t-plot" vector-effect="non-scaling-stroke" />
      {s.blds.map((b) => <polygon points={pts(b.ring)} class="t-b" style={`opacity:${0.35 + 0.65 * (b.h / hmax)}`} vector-effect="non-scaling-stroke" />)}
    </svg>
  );
}

function Empty({ icon, title, children }: { icon: string; title: string; children?: ComponentChildren }) {
  return <div class="d-empty"><I n={icon} size={28} /><b>{title}</b>{children}</div>;
}
function NeedsAccount({ what }: { what: string }) {
  if (!authReady) return <Empty icon="lock" title="Accounts aren’t switched on here"><p>Your project is kept in this browser.</p></Empty>;
  return <Empty icon="user" title={`Sign in for ${what}`}><a class="btn primary" href={`${BASE}login/?next=${encodeURIComponent(location.pathname + location.hash)}`}>Sign in</a><a class="linkbtn" href={`${BASE}signup/`}>Create a free account</a></Empty>;
}

// ---------------- home ----------------

const STARTS: { k: Parameters<typeof D.newUrl>[0]; label: string; icon: string; sub: string }[] = [
  { k: 'blank', label: 'Blank plot', icon: 'plus', sub: 'Size, draw or import' },
  { k: 'survey', label: 'Survey number', icon: 'pin', sub: 'From land records' },
  { k: 'sample', label: 'Sample project', icon: 'tower', sub: 'Look around first' },
  { k: 'import', label: 'Import a file', icon: 'upload', sub: 'KML, DXF, GeoJSON' },
];

function Home({ data, name, signedIn }: { data: Data; name: string; signedIn: boolean }) {
  const hour = new Date().getHours();
  const hi = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = name.split(/[\s@]/)[0];
  const recent = useMemo(() => [...(data.rows ?? []), ...(data.shared ?? [])].filter((r) => !r.archived_at)
    .sort((a, b) => (b.opened_at ?? b.updated_at).localeCompare(a.opened_at ?? a.updated_at)).slice(0, 6), [data.rows, data.shared]);
  const totals = useMemo(() => {
    const all = (data.rows ?? []).filter((r) => !r.archived_at && r.summary);
    return { n: (data.rows ?? []).filter((r) => !r.archived_at).length, homes: all.reduce((s, r) => s + (r.summary!.homes || 0), 0), bua: all.reduce((s, r) => s + (r.summary!.bua || 0), 0), area: all.reduce((s, r) => s + (r.summary!.area || 0), 0) };
  }, [data.rows]);
  return (
    <div class="d-page">
      <header class="d-head"><h1>{signedIn && first ? `${hi}, ${first}` : hi}</h1></header>
      <section class="d-starts" aria-label="Start a project">
        {STARTS.map((s) => <a class="d-start" href={D.newUrl(s.k)}><span class="d-start-i"><I n={s.icon} size={20} /></span><b>{s.label}</b><small>{s.sub}</small></a>)}
      </section>
      {signedIn && totals.n > 0 && (
        <section class="d-kpis" aria-label="Across your projects">
          <div><small>Projects</small><b>{nf(totals.n)}</b></div>
          <div><small>Plot area</small><b>{area(totals.area)}</b></div>
          <div><small>Built-up</small><b>{area(totals.bua)}</b></div>
          <div><small>Homes</small><b>{nf(totals.homes)}</b></div>
        </section>
      )}
      <section class="d-sec">
        <div class="d-sec-h"><h2>Recent</h2>{signedIn && <a class="linkbtn" href="#/projects">All projects</a>}</div>
        <div class="d-cards">
          {data.local && <LocalCard data={data} />}
          {recent.map((r) => <Card r={r} data={data} />)}
          {signedIn && data.rows === null && !data.err && [0, 1, 2].map(() => <div class="d-card skel" />)}
        </div>
        {!signedIn && <NeedsAccount what="projects saved to your account" />}
        {signedIn && data.rows?.length === 0 && !data.local && <Empty icon="folder" title="No projects yet"><a class="btn primary" href={D.newUrl()}>New project</a></Empty>}
      </section>
      {signedIn && <section class="d-sec"><div class="d-sec-h"><h2>Activity</h2><a class="linkbtn" href="#/activity">All activity</a></div><Feed data={data} limit={6} /></section>}
    </div>
  );
}

// ---------------- project cards ----------------

function LocalCard({ data }: { data: Data }) {
  const l = data.local!;
  const s = useMemo(() => summaryOf(l.p), [l]);
  // (the browser's project is usually also the cloud one it last saved to: say so rather than show it twice)
  if (l.cloudId && data.rows?.some((r) => r.id === l.cloudId)) return null;
  return (
    <a class="d-card" href={D.proUrl('?local')}>
      <Thumb s={s} />
      <div class="d-card-b"><b>{l.p.name}</b><small><I n="monitor" size={13} />In this browser · {s.city}</small><Facts s={s} /></div>
    </a>
  );
}

function Facts({ s }: { s: Summary | null | undefined }) {
  if (!s || !s.area) return null;
  return <p class="d-facts">{area(s.area)}{s.homes ? ` · ${nf(s.homes)} homes` : ''}{s.floors ? ` · ${s.floors} fl` : ''}{s.profit !== null && s.homes ? ` · ${money(s.profit)}` : ''}</p>;
}

function actions(r: D.Row, data: Data, ask: (k: 'rename' | 'delete' | 'move', r: D.Row) => void): { label: string; icon: string; onSelect?: () => void; href?: string }[] {
  const own = !r.role;
  const list: { label: string; icon: string; onSelect?: () => void; href?: string }[] = [
    { label: 'Open', icon: 'open', href: D.openUrl(r.id) },
    { label: 'Make a copy', icon: 'copy', onSelect: () => void act(async () => { await D.duplicate(r.id); data.reload(); }, 'Copied into your projects.') },
    { label: 'Download', icon: 'down', onSelect: () => void act(async () => download(`${r.name}.urbanplan-pro.json`, await D.fileText(r.id), 'application/json')) },
  ];
  if (own) list.splice(1, 0,
    { label: r.starred ? 'Unstar' : 'Star', icon: 'star', onSelect: () => { data.patch(r.id, { starred: !r.starred }); void act(() => D.star(r.id, !r.starred)).then((ok) => !ok && data.patch(r.id, { starred: r.starred })); } },
    { label: 'Rename', icon: 'edit', onSelect: () => ask('rename', r) },
    ...(data.foldersOff ? [] : [{ label: 'Move to folder', icon: 'folder', onSelect: () => ask('move', r) }]),
  );
  if (own) list.push(
    { label: r.archived_at ? 'Restore' : 'Archive', icon: 'archive', onSelect: () => void act(async () => { await D.archive(r.id, !r.archived_at); data.reload(); }, r.archived_at ? 'Restored.' : 'Archived.') },
    { label: 'Delete', icon: 'trash', onSelect: () => ask('delete', r) },
  );
  return list;
}

let ask_: (k: 'rename' | 'delete' | 'move', r: D.Row) => void = () => {};
function Card({ r, data }: { r: D.Row; data: Data }) {
  return (
    <div class="d-card">
      <a href={D.openUrl(r.id)} class="d-card-link" aria-label={`Open ${r.name}`} />
      <Thumb s={r.summary} />
      {r.starred && <span class="d-star" title="Starred"><I n="star" size={14} /></span>}
      <div class="d-card-b">
        <b>{r.name}</b>
        <small>{r.role ? <><I n="team" size={13} />{r.role === 'editor' ? 'Can edit' : 'Can view'} · </> : null}{r.summary?.city ?? (CITIES.find((c) => `pro:${c.value}` === r.region)?.label ?? '')}{' · '}{ago(r.updated_at)}</small>
        <Facts s={r.summary} />
      </div>
      <span class="d-card-m"><Menu label={`${r.name}: more`} items={actions(r, data, ask_)} /></span>
    </div>
  );
}

// ---------------- projects ----------------

type Filter = 'all' | 'starred' | 'shared' | 'archived' | `folder:${string}`;
function Projects({ data, signedIn }: { data: Data; signedIn: boolean }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<'recent' | 'name' | 'created' | 'size'>('recent');
  const [view, setView] = useState<'grid' | 'list'>(() => { try { return (localStorage.getItem('urbanplan:dash:view') as 'grid' | 'list') || 'grid'; } catch { return 'grid'; } });
  const setV = (v: 'grid' | 'list') => { setView(v); try { localStorage.setItem('urbanplan:dash:view', v); } catch { /* */ } };
  const [dlg, setDlg] = useState<{ k: 'rename' | 'delete' | 'move'; r: D.Row } | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const fileIn = useRef<HTMLInputElement>(null);
  ask_ = (k, r) => setDlg({ k, r });
  if (!signedIn) return <div class="d-page"><header class="d-head"><h1>Projects</h1></header><div class="d-cards">{data.local && <LocalCard data={data} />}</div><NeedsAccount what="your projects" /></div>;
  const all = filter === 'shared' ? data.shared ?? [] : data.rows ?? [];
  const list = all.filter((r) => {
    if (filter === 'archived') { if (!r.archived_at) return false; } else if (r.archived_at) return false;
    if (filter === 'starred' && !r.starred) return false;
    if (filter.startsWith('folder:') && r.folder !== filter.slice(7)) return false;
    return !q || `${r.name} ${r.summary?.city ?? ''}`.toLowerCase().includes(q.toLowerCase());
  }).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'created' ? b.created_at.localeCompare(a.created_at) : sort === 'size' ? (b.summary?.bua ?? 0) - (a.summary?.bua ?? 0) : b.updated_at.localeCompare(a.updated_at));
  const count = (f: Filter) => (f === 'shared' ? data.shared?.length ?? 0 : (data.rows ?? []).filter((r) => (f === 'archived' ? !!r.archived_at : !r.archived_at && (f === 'all' || (f === 'starred' && r.starred) || (f.startsWith('folder:') && r.folder === f.slice(7))))).length);
  const onFile = async (f: File | undefined) => { if (!f) return; await act(async () => { await D.importFile(await f.text()); data.reload(); }, 'Imported.'); if (fileIn.current) fileIn.current.value = ''; };
  return (
    <div class="d-page wide">
      <header class="d-head">
        <h1>Projects</h1>
        <div class="d-head-a">
          <input ref={fileIn} type="file" accept=".json,application/json" hidden onChange={(e) => void onFile((e.target as HTMLInputElement).files?.[0])} />
          <Btn icon="upload" onClick={() => fileIn.current?.click()}>Import</Btn>
          <a class="btn primary" href={D.newUrl()}><I n="plus" size={16} />New project</a>
        </div>
      </header>
      <div class="d-proj">
        <nav class="d-filters" aria-label="Show">
          {([['all', 'All projects', 'folder'], ['starred', 'Starred', 'star'], ['shared', 'Shared with me', 'team'], ['archived', 'Archive', 'archive']] as [Filter, string, string][]).map(([f, l, i]) => (
            <button type="button" class={filter === f ? 'on' : ''} onClick={() => setFilter(f)}><I n={i} size={16} />{l}<small>{count(f) || ''}</small></button>
          ))}
          {!data.foldersOff && <>
            <div class="d-filters-h"><span>Folders</span><button type="button" class="d-icon-btn" aria-label="New folder" onClick={() => setNewFolder(true)}><I n="plus" size={14} /></button></div>
            {(data.folders ?? []).map((f) => (
              <span class="d-folder"><button type="button" class={filter === `folder:${f.id}` ? 'on' : ''} onClick={() => setFilter(`folder:${f.id}`)}><I n="folder" size={16} />{f.name}<small>{count(`folder:${f.id}`) || ''}</small></button>
                <Menu label={`${f.name}: more`} items={[{ label: 'Delete folder', icon: 'trash', onSelect: () => void act(async () => { await D.removeFolder(f.id); if (filter === `folder:${f.id}`) setFilter('all'); data.reload(); }, 'Folder deleted. Its projects are still in All projects.') }]} />
              </span>
            ))}
          </>}
        </nav>
        <div class="d-proj-b">
          <div class="d-toolbar">
            <label class="d-q"><I n="search" size={15} /><input type="search" placeholder="Search projects" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Search projects" /></label>
            <Select<typeof sort> size="sm" aria-label="Sort" value={sort} onChange={setSort} options={[{ value: 'recent', label: 'Last changed' }, { value: 'created', label: 'Newest' }, { value: 'name', label: 'Name' }, { value: 'size', label: 'Largest' }]} />
            <Seg<'grid' | 'list'> small ariaLabel="View" value={view} set={setV} options={[{ value: 'grid', label: '', icon: 'grid', title: 'Cards' }, { value: 'list', label: '', icon: 'list', title: 'List' }]} />
          </div>
          {data.err && <p class="note bad">{data.err}</p>}
          {data.rows === null && !data.err ? <div class="d-cards">{[0, 1, 2, 3].map(() => <div class="d-card skel" />)}</div>
            : !list.length ? <Empty icon={filter === 'archived' ? 'archive' : filter === 'starred' ? 'star' : 'folder'} title={q ? 'Nothing matches' : filter === 'archived' ? 'Nothing archived' : filter === 'starred' ? 'No starred projects' : filter === 'shared' ? 'Nothing shared with you yet' : 'No projects here'}>
                {filter === 'all' && !q && <a class="btn primary" href={D.newUrl()}>New project</a>}</Empty>
            : view === 'grid' ? <div class="d-cards">{filter === 'all' && !q && data.local && <LocalCard data={data} />}{list.map((r) => <Card r={r} data={data} />)}</div>
            : <table class="d-table">
                <thead><tr><th>Name</th><th class="hide-s">Place</th><th class="num hide-s">Plot</th><th class="num hide-s">Homes</th><th class="num">Changed</th><th /></tr></thead>
                <tbody>{list.map((r) => (
                  <tr>
                    <td><a href={D.openUrl(r.id)} class="d-tname">{r.starred && <I n="star" size={13} />}{r.name}</a>{r.role && <small class="d-chip">{r.role === 'editor' ? 'Can edit' : 'Can view'}</small>}</td>
                    <td class="hide-s">{r.summary?.city ?? ''}</td>
                    <td class="num hide-s">{r.summary?.area ? area(r.summary.area) : ''}</td>
                    <td class="num hide-s">{r.summary?.homes ? nf(r.summary.homes) : ''}</td>
                    <td class="num">{ago(r.updated_at)}</td>
                    <td class="num"><Menu label={`${r.name}: more`} items={actions(r, data, ask_)} /></td>
                  </tr>))}</tbody>
              </table>}
        </div>
      </div>
      {dlg?.k === 'rename' && <RenameDialog r={dlg.r} done={(name) => { data.patch(dlg.r.id, { name }); void act(() => D.rename(dlg.r.id, name), 'Renamed.'); setDlg(null); }} close={() => setDlg(null)} />}
      {dlg?.k === 'delete' && <Dialog title="Delete this project?" close={() => setDlg(null)}>
        <p><b>{dlg.r.name}</b> and all its saved versions will be deleted. This can’t be undone.</p>
        <div class="d-dlg-a"><Btn onClick={() => setDlg(null)}>Cancel</Btn><Btn kind="primary" icon="trash" onClick={() => { const r = dlg.r; setDlg(null); void act(async () => { await D.remove(r.id); data.reload(); }, 'Deleted.'); }}>Delete</Btn></div>
      </Dialog>}
      {dlg?.k === 'move' && <Dialog title="Move to folder" close={() => setDlg(null)}>
        <div class="d-pick">
          <button type="button" class={!dlg.r.folder ? 'on' : ''} onClick={() => { const r = dlg.r; setDlg(null); data.patch(r.id, { folder: null }); void act(() => D.moveTo(r.id, null), 'Moved.'); }}><I n="folder" size={16} />No folder</button>
          {(data.folders ?? []).map((f) => <button type="button" class={dlg.r.folder === f.id ? 'on' : ''} onClick={() => { const r = dlg.r; setDlg(null); data.patch(r.id, { folder: f.id }); void act(() => D.moveTo(r.id, f.id), `Moved to ${f.name}.`); }}><I n="folder" size={16} />{f.name}</button>)}
        </div>
      </Dialog>}
      {newFolder && <NameDialog title="New folder" label="Folder name" done={(name) => { setNewFolder(false); void act(async () => { await D.addFolder(name); data.reload(); }, 'Folder made.'); }} close={() => setNewFolder(false)} />}
    </div>
  );
}

function NameDialog({ title, label, value = '', done, close }: { title: string; label: string; value?: string; done: (v: string) => void; close: () => void }) {
  const [v, setV] = useState(value);
  return (
    <Dialog title={title} close={close}>
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) done(v.trim()); }} class="d-form">
        <label class="f"><span class="f-l">{label}</span><input class="txt" value={v} autoFocus maxLength={80} onInput={(e) => setV((e.target as HTMLInputElement).value)} /></label>
        <div class="d-dlg-a"><Btn onClick={close}>Cancel</Btn><Btn kind="primary" submit disabled={!v.trim()}>Save</Btn></div>
      </form>
    </Dialog>
  );
}
const RenameDialog = ({ r, done, close }: { r: D.Row; done: (v: string) => void; close: () => void }) => <NameDialog title="Rename" label="Name" value={r.name} done={done} close={close} />;

// ---------------- design systems ----------------

/** The design systems: yours (each opens in the builder) and the presets to start one from. The builder is where a
 *  design system is made; Pro's Design step uses them and opens the builder for the detail. */
function Designs({ sub }: { sub: string }) {
  const [mine, setMine] = useState<Lib.SavedDesign[] | null>(null);
  const [ren, setRen] = useState<Lib.SavedDesign | null>(null);
  useEffect(() => { if (!sub) void Lib.list().then(setMine); }, [sub]);
  if (sub) return <Builder id={decodeURIComponent(sub)} back={() => go('designs')} />;
  const start = (from: (typeof PRESETS)[number], name = `My ${from.name}`) => void Lib.save(name, clone(from)).then((s) => go(`designs/${s.id}`));
  const reload = () => void Lib.list().then(setMine);
  const sw = (c: string[]) => <span class="d-sw">{c.map((x) => <i style={`background:${x}`} />)}</span>;
  const libAny = Lib as unknown as { rename?: (id: string, name: string) => Promise<unknown>; remove?: (id: string) => Promise<unknown> };
  return (
    <div class="d-page">
      <header class="d-head"><h1>Design systems</h1><button type="button" class="btn primary" onClick={() => start(PRESETS[0], 'New design system')}>New design system</button></header>
      <section class="d-sec">
        <div class="d-sec-h"><h2>Yours</h2><small class="muted">Open one to build it: facade, composition, palette, climate, signs, landscape, walls, gates and roads</small></div>
        {mine === null ? null : !mine.length ? <Empty icon="palette" title="None yet"><p>Start one from a preset below, or save one from a project’s Design step.</p></Empty> : (
          <div class="d-ds">{mine.map((m) => (
            <div class="d-ds-c">{sw([m.ds.facade.wall, m.ds.facade.accent, m.ds.glazing.glass, m.ds.facade.base])}<a class="d-ds-open" href={`#designs/${encodeURIComponent(m.id)}`}><b>{m.name}</b></a><small>Saved {ago(new Date(m.savedAt).toISOString())}</small>
              <span class="d-card-m"><Menu label={`${m.name}: more`} items={[
                { label: 'Open in the builder', icon: 'edit', onSelect: () => go(`designs/${m.id}`) },
                ...(libAny.rename ? [{ label: 'Rename', icon: 'edit', onSelect: () => setRen(m) }] : []),
                { label: 'Download', icon: 'down', onSelect: () => download(`${m.name}.design.json`, JSON.stringify(m, null, 1), 'application/json') },
                ...(libAny.remove ? [{ label: 'Delete', icon: 'trash', onSelect: () => void act(async () => { await libAny.remove!(m.id); await dropVersions(m.id); reload(); }, 'Deleted.') }] : []),
              ]} /></span>
            </div>))}</div>
        )}
      </section>
      <section class="d-sec">
        <div class="d-sec-h"><h2>Presets</h2></div>
        <div class="d-ds">{PRESETS.map((d) => <div class="d-ds-c">{sw([d.facade.wall, d.facade.accent, d.glazing.glass, d.facade.base])}<b>{d.name}</b><small>{d.blurb}</small><button type="button" class="linkbtn d-ds-start" onClick={() => start(d)}>Start from this</button></div>)}</div>
      </section>
      {ren && <NameDialog title="Rename" label="Name" value={ren.name} close={() => setRen(null)} done={(n) => { setRen(null); void act(async () => { await libAny.rename!(ren.id, n); reload(); }, 'Renamed.'); }} />}
    </div>
  );
}

// ---------------- team ----------------

function Team({ data, signedIn }: { data: Data; signedIn: boolean }) {
  const [people, setPeople] = useState<D.Person[] | null>(null);
  const [off, setOff] = useState(false);
  useEffect(() => { if (data.rows) D.people(data.rows).then(setPeople, (e) => { setOff(e instanceof D.NotReady); setPeople([]); }); }, [data.rows]);
  if (!signedIn) return <div class="d-page"><header class="d-head"><h1>Team</h1></header><NeedsAccount what="working with others" /></div>;
  return (
    <div class="d-page">
      <header class="d-head"><h1>Team</h1></header>
      <section class="d-sec">
        <div class="d-sec-h"><h2>People on your projects</h2></div>
        {people === null ? <p class="d-loading"><Dither class="dz" cell={2} />Loading…</p> : off ? <p class="note">Teams aren’t set up on this server yet.</p> : !people.length ? (
          <Empty icon="team" title="Nobody added yet"><p>Open a project and use Share to add people as editors or viewers.</p></Empty>
        ) : (
          <ul class="d-people">{people.map((x) => (
            <li><Avatar url={null} name={x.email} size={34} /><span><b>{x.email}</b><small>{x.projects.map((p) => p.name).join(', ')}</small></span><span class="d-chip">{x.role === 'editor' ? 'Editor' : 'Viewer'}</span>{!x.joined && <span class="d-chip ghost">Invited</span>}</li>
          ))}</ul>
        )}
      </section>
      <section class="d-sec">
        <div class="d-sec-h"><h2>Shared with you</h2></div>
        {!data.shared?.length ? <p class="muted">Projects other people share with you appear here.</p> : <div class="d-cards">{data.shared.map((r) => <Card r={r} data={data} />)}</div>}
      </section>
    </div>
  );
}

// ---------------- activity ----------------

const KIND: Record<string, [string, string]> = {
  created: ['plus', 'made'], saved: ['check', 'saved'], renamed: ['edit', 'renamed'], shared: ['team', 'shared'], joined: ['user', 'joined'],
  commented: ['chat', 'commented on'], version: ['clock', 'kept a version of'], exported: ['down', 'exported'], deleted: ['trash', 'deleted'],
};
function Feed({ data, limit = 40 }: { data: Data; limit?: number }) {
  const [ev, setEv] = useState<D.Event_[] | null>(null);
  const rows = useMemo(() => [...(data.rows ?? []), ...(data.shared ?? [])], [data.rows, data.shared]);
  useEffect(() => { if (data.rows) D.activity(rows, limit).then(setEv, () => setEv([])); }, [rows]);
  if (ev === null) return <p class="d-loading"><Dither class="dz" cell={2} />Loading…</p>;
  if (!ev.length) return <p class="muted">Nothing yet. Saves, shares and comments on your projects show here.</p>;
  const nameOf = (id: string | null) => rows.find((r) => r.id === id)?.name ?? 'a project';
  return (
    <ol class="d-feed">{ev.map((e) => {
      const [icon, verb] = KIND[e.kind] ?? ['info', e.kind];
      return (
        <li><span class="d-feed-i"><I n={icon} size={15} /></span>
          <span><b>{e.who}</b> {verb} {e.project ? <a href={D.openUrl(e.project)}>{nameOf(e.project)}</a> : null}{e.kind === 'commented' && e.detail ? <q>{e.detail}</q> : e.kind === 'shared' && e.detail ? <> with {e.detail}</> : null}</span>
          <time dateTime={e.at}>{ago(e.at)}</time></li>
      );
    })}</ol>
  );
}
function Activity({ data, signedIn }: { data: Data; signedIn: boolean }) {
  return <div class="d-page"><header class="d-head"><h1>Activity</h1></header>{signedIn ? <Feed data={data} /> : <NeedsAccount what="activity on your projects" />}</div>;
}

// ---------------- settings ----------------

const TABS: { t: Tab; label: string; icon: string; account?: boolean }[] = [
  { t: 'profile', label: 'Profile', icon: 'user', account: true },
  { t: 'account', label: 'Sign-in and security', icon: 'lock', account: true },
  { t: 'preferences', label: 'Preferences', icon: 'sliders' },
  { t: 'notifications', label: 'Notifications', icon: 'bell', account: true },
  { t: 'plan', label: 'Plan and usage', icon: 'card', account: true },
  { t: 'data', label: 'Your data', icon: 'database' },
];
function Settings({ tab, data, signedIn }: { tab: Tab; data: Data; signedIn: boolean }) {
  const cur = TABS.find((x) => x.t === tab) ?? TABS[0];
  return (
    <div class="d-page wide">
      <header class="d-head"><h1>Settings</h1></header>
      <div class="d-set">
        <nav class="d-filters" aria-label="Settings">{TABS.map((x) => <a href={`#/settings/${x.t}`} class={x.t === cur.t ? 'on' : ''} aria-current={x.t === cur.t ? 'page' : undefined}><I n={x.icon} size={16} />{x.label}</a>)}</nav>
        <div class="d-set-b">
          <h2 class="d-set-t">{cur.label}</h2>
          {cur.account && !signedIn ? <NeedsAccount what={cur.label.toLowerCase()} />
            : cur.t === 'profile' ? <ProfileTab data={data} />
            : cur.t === 'account' ? <AccountTab data={data} />
            : cur.t === 'preferences' ? <PrefsTab />
            : cur.t === 'notifications' ? <NotifyTab data={data} />
            : cur.t === 'plan' ? <PlanTab data={data} />
            : <DataTab data={data} signedIn={signedIn} />}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: ComponentChildren; hint?: string }) {
  return <label class="f"><span class="f-l">{label}</span>{children}{hint && <span class="f-h">{hint}</span>}</label>;
}
const txt = (v: string, set: (s: string) => void, extra: Record<string, unknown> = {}) => <input class="txt" value={v} onInput={(e) => set((e.target as HTMLInputElement).value)} {...extra} />;

function ProfileTab({ data }: { data: Data }) {
  const u = session.value!.user, p = data.profile;
  const [f, setF] = useState({ full_name: '', organisation: '', role: '' as UserRole | '', title: '', phone: '', city: '', country: '' });
  const [busy, setBusy] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  useEffect(() => { setF({ full_name: p?.full_name ?? (u.user_metadata?.full_name as string) ?? '', organisation: p?.organisation ?? '', role: p?.role ?? '', title: p?.title ?? '', phone: p?.phone ?? '', city: p?.city ?? '', country: p?.country ?? '' }); setAvatar(p?.avatar_url ?? null); }, [p]);
  const up = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const pic = useRef<HTMLInputElement>(null);
  const ext = !!p?.extended;
  const save = async (e: Event) => {
    e.preventDefault(); setBusy(true);
    await act(() => D.saveProfileFields({ full_name: f.full_name.trim() || null, organisation: f.organisation.trim() || null, role: (f.role || null) as UserRole | null, ...(ext ? { title: f.title.trim() || null, phone: f.phone.trim() || null, city: f.city.trim() || null, country: f.country.trim() || null } : {}) }), 'Profile saved.');
    setBusy(false); data.reload();
  };
  return (
    <form class="d-form" onSubmit={save}>
      <div class="d-avrow">
        <Avatar url={avatar} name={f.full_name || u.email || ''} size={64} />
        <input ref={pic} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const file = (e.target as HTMLInputElement).files?.[0]; if (file) void act(async () => setAvatar(await D.uploadAvatar(file)), 'Picture updated.'); }} />
        <Btn icon="upload" onClick={() => pic.current?.click()}>Change picture</Btn>
        {avatar && <Btn kind="quiet" onClick={() => void act(async () => { await D.saveProfileFields({ avatar_url: null }); setAvatar(null); }, 'Picture removed.')}>Remove</Btn>}
      </div>
      <div class="row r2"><Field label="Name">{txt(f.full_name, up('full_name'), { autoComplete: 'name', maxLength: 80 })}</Field><Field label="Job title">{txt(f.title, up('title'), { maxLength: 80, disabled: !ext, placeholder: ext ? 'Architect, Head of Design…' : '' })}</Field></div>
      <div class="row r2"><Field label="Organisation">{txt(f.organisation, up('organisation'), { autoComplete: 'organization', maxLength: 80 })}</Field>
        <Field label="What describes you best"><Select<string> value={f.role} onChange={(v) => up('role')(v)} options={[{ value: '', label: 'Not set' }, ...ROLES.map(([v, l]) => ({ value: v, label: l }))]} /></Field></div>
      <div class="row r2"><Field label="City">{txt(f.city, up('city'), { autoComplete: 'address-level2', maxLength: 80, disabled: !ext })}</Field><Field label="Country">{txt(f.country, up('country'), { autoComplete: 'country-name', maxLength: 80, disabled: !ext })}</Field></div>
      <Field label="Phone" hint="Only for your account; never shown to others.">{txt(f.phone, up('phone'), { autoComplete: 'tel', inputMode: 'tel', maxLength: 32, disabled: !ext })}</Field>
      {!ext && <p class="note">Job title, place, phone and a picture come with the next server update.</p>}
      <div><Btn kind="primary" submit disabled={busy}>{busy ? 'Saving…' : 'Save'}</Btn></div>
    </form>
  );
}

function AccountTab({ data }: { data: Data }) {
  const u = session.value!.user;
  const [email, setEmail] = useState(u.email ?? '');
  const [pw, setPw] = useState(''), [pw2, setPw2] = useState('');
  const [del, setDel] = useState(false), [confirm, setConfirm] = useState('');
  const google = (u.app_metadata?.providers as string[] | undefined)?.includes('google');
  return (
    <div class="d-stack">
      <section class="d-card-s">
        <h3>Email</h3>
        <form class="d-inline" onSubmit={(e) => { e.preventDefault(); void act(() => D.changeEmail(email), 'Check both inboxes: we sent a link to confirm the change.'); }}>
          <input class="txt" type="email" value={email} autoComplete="email" onInput={(e) => setEmail((e.target as HTMLInputElement).value)} aria-label="Email" />
          <Btn submit disabled={!email.trim() || email.trim() === u.email}>Change</Btn>
        </form>
      </section>
      <section class="d-card-s">
        <h3>Password</h3>
        {google && <p class="muted small">You sign in with Google. A password lets you sign in with your email too.</p>}
        <form class="d-form" onSubmit={(e) => { e.preventDefault(); if (pw !== pw2) { toast('The two passwords differ.'); return; } void act(() => D.changePassword(pw), 'Password changed.').then((ok) => { if (ok) { setPw(''); setPw2(''); } }); }}>
          <div class="row r2">
            <Field label="New password"><input class="txt" type="password" autoComplete="new-password" value={pw} minLength={8} onInput={(e) => setPw((e.target as HTMLInputElement).value)} /></Field>
            <Field label="Again"><input class="txt" type="password" autoComplete="new-password" value={pw2} onInput={(e) => setPw2((e.target as HTMLInputElement).value)} /></Field>
          </div>
          <div><Btn submit disabled={pw.length < 8}>Set password</Btn></div>
        </form>
      </section>
      <section class="d-card-s">
        <h3>Sessions</h3>
        <dl class="d-kv"><dt>Signed in as</dt><dd>{u.email}</dd><dt>Since</dt><dd>{new Date(u.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</dd><dt>Last sign-in</dt><dd>{ago(u.last_sign_in_at)}</dd></dl>
        <div class="d-inline"><Btn icon="x" onClick={() => void signOut().then(() => location.assign(BASE))}>Sign out</Btn><Btn kind="quiet" onClick={() => void act(D.signOutEverywhere).then(() => location.assign(BASE))}>Sign out everywhere</Btn></div>
      </section>
      <section class="d-card-s danger">
        <h3>Delete your account</h3>
        <p class="small">Your projects ({data.rows?.length ?? 0}), their versions and your profile are deleted for good. Projects shared with you stay with their owners.</p>
        {!del ? <div><Btn icon="trash" onClick={() => setDel(true)}>Delete account…</Btn></div> : (
          <form class="d-form" onSubmit={(e) => { e.preventDefault(); void act(D.deleteAccount, 'Your account is deleted.').then((ok) => ok && location.assign(BASE)); }}>
            <Field label={`Type DELETE to confirm`}><input class="txt" value={confirm} onInput={(e) => setConfirm((e.target as HTMLInputElement).value)} autoComplete="off" /></Field>
            <div class="d-inline"><Btn onClick={() => { setDel(false); setConfirm(''); }}>Cancel</Btn><Btn kind="primary" submit disabled={confirm !== 'DELETE'}>Delete everything</Btn></div>
          </form>
        )}
      </section>
    </div>
  );
}

function PrefsTab() {
  const p = D.prefs.value;
  const set = (ch: Partial<D.Prefs>) => void act(() => D.setPrefs(ch));
  return (
    <div class="d-stack">
      <section class="d-card-s">
        <h3>Appearance</h3>
        <Seg<D.Prefs['theme']> value={p.theme} set={(v) => set({ theme: v })} ariaLabel="Theme" options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        <Toggle label="Less motion" value={p.reduceMotion} set={(v) => set({ reduceMotion: v })} />
      </section>
      <section class="d-card-s">
        <h3>Units</h3>
        <div class="row r2">
          <Field label="Area"><Seg<D.Prefs['area']> value={p.area} set={(v) => set({ area: v })} options={[{ value: 'sqft', label: 'sq ft' }, { value: 'm2', label: 'm²' }]} /></Field>
          <Field label="Large amounts"><Seg<D.Prefs['big']> value={p.big} set={(v) => set({ big: v })} options={[{ value: 'crore', label: 'Crore' }, { value: 'million', label: 'Million' }]} /></Field>
        </div>
      </section>
      <section class="d-card-s">
        <h3>New projects</h3>
        <div class="row r2">
          <Field label="Planning authority"><Select<string> value={p.authority} onChange={(v) => set({ authority: v })} options={CITIES.map((c) => ({ value: c.value, label: c.label }))} /></Field>
          <Field label="Open projects on"><Select<D.Prefs['start']> value={p.start} onChange={(v) => set({ start: v })} options={[{ value: 'last', label: 'The step I left' }, { value: 'site', label: 'Site' }]} /></Field>
        </div>
      </section>
    </div>
  );
}

function NotifyTab({ data }: { data: Data }) {
  const ext = !!data.profile?.extended;
  const [n, setN] = useState<D.Notify>({ ...D.DEFAULT_NOTIFY, ...(data.profile?.notify ?? {}) });
  useEffect(() => { setN({ ...D.DEFAULT_NOTIFY, ...(data.profile?.notify ?? {}) }); }, [data.profile]);
  const set = (ch: Partial<D.Notify>) => { const x = { ...n, ...ch }; setN(x); void act(() => D.setNotify(x)); };
  return (
    <section class="d-card-s">
      <h3>Email me when</h3>
      {!ext && <p class="note">Email notifications come with the next server update.</p>}
      <Toggle label="Someone comments on my project" value={n.comments} set={(v) => set({ comments: v })} />
      <Toggle label="I’m added to a project" value={n.invites} set={(v) => set({ invites: v })} />
      <Toggle label="A weekly summary of my projects" value={n.digest === 'weekly'} set={(v) => set({ digest: v ? 'weekly' : 'off' })} />
      <Toggle label="News about UrbanPlan" value={n.product} set={(v) => set({ product: v })} />
    </section>
  );
}

const PLANS: { id: string; name: string; price: string; points: string[] }[] = [
  { id: 'free', name: 'Free', price: '₹0', points: ['Unlimited projects in your browser', 'Projects in your account', 'Drawings and DXF'] },
  { id: 'pro', name: 'Pro', price: 'Soon', points: ['Everything in Free', 'Options explorer at full depth', 'Branded reports'] },
  { id: 'firm', name: 'Firm', price: 'Soon', points: ['Everything in Pro', 'Shared design systems', 'Seats and roles for a team'] },
];
function PlanTab({ data }: { data: Data }) {
  const [u, setU] = useState<D.Usage | null>(null);
  useEffect(() => { if (data.rows) D.usage(data.rows).then(setU, () => setU(null)); }, [data.rows]);
  const plan = data.profile?.plan ?? 'free';
  const LIMIT = 500e6;
  return (
    <div class="d-stack">
      <section class="d-card-s">
        <h3>Usage</h3>
        {u ? <>
          <dl class="d-kv"><dt>Projects</dt><dd>{nf(u.projects)}</dd>{u.exact && <><dt>Saved versions</dt><dd>{nf(u.versions)}</dd></>}<dt>Storage</dt><dd>{bytes(u.bytes)} of {bytes(LIMIT)}</dd></dl>
          <div class="d-bar" role="meter" aria-valuemin={0} aria-valuemax={LIMIT} aria-valuenow={u.bytes} aria-label="Storage used"><i style={`width:${Math.min(100, (u.bytes / LIMIT) * 100).toFixed(1)}%`} /></div>
        </> : <p class="d-loading"><Dither class="dz" cell={2} />Loading…</p>}
      </section>
      <div class="d-plans">{PLANS.map((x) => (
        <section class={`d-plan${x.id === plan ? ' on' : ''}`}>
          <h3>{x.name}{x.id === plan && <span class="d-chip">Your plan</span>}</h3>
          <b class="d-price">{x.price}</b>
          <ul>{x.points.map((t) => <li><I n="check" size={14} />{t}</li>)}</ul>
          {x.id !== plan && <a class="btn" href={`${BASE}pricing/`}>{x.price === 'Soon' ? 'Tell me when' : 'Choose'}</a>}
        </section>))}</div>
      <p class="muted small">Everything is free during the beta. Billing and invoices will appear here.</p>
    </div>
  );
}

function DataTab({ data, signedIn }: { data: Data; signedIn: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const local = data.local;
  return (
    <div class="d-stack">
      {signedIn && <section class="d-card-s">
        <h3>Download everything</h3>
        <p class="small">Your profile, preferences and every project, as one file.</p>
        <div><Btn icon="down" disabled={!!busy || !data.rows} onClick={() => { setBusy('0'); void act(async () => { const t = await D.exportAll(data.rows ?? [], (i, n) => setBusy(`${i} of ${n}`)); download(`urbanplan-account-${new Date().toISOString().slice(0, 10)}.json`, t, 'application/json'); }).finally(() => setBusy(null)); }}>{busy ? `Preparing ${busy}…` : 'Download'}</Btn></div>
      </section>}
      <section class="d-card-s">
        <h3>This browser</h3>
        <p class="small">{local ? <>One project is kept here: <b>{local.p.name}</b>.</> : 'No project is kept in this browser.'}</p>
        {local && <div class="d-inline"><Btn icon="down" onClick={() => download(`${local.p.name}.urbanplan-pro.json`, JSON.stringify({ format: 'urbanplan/pro', ...local.p }, null, 1), 'application/json')}>Download it</Btn></div>}
      </section>
      <section class="d-card-s">
        <h3>Privacy</h3>
        <p class="small">We keep your email, profile and projects. Owner names from land records are never stored. <a href={`${BASE}privacy/`}>Privacy notice</a></p>
      </section>
    </div>
  );
}

// ---------------- search and help ----------------

function Palette({ data, close }: { data: Data; close: () => void }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const items = useMemo(() => {
    const acts: { label: string; icon: string; sub?: string; run: () => void }[] = [
      { label: 'New project', icon: 'plus', run: () => location.assign(D.newUrl()) },
      { label: 'Start from a survey number', icon: 'pin', run: () => location.assign(D.newUrl('survey')) },
      { label: 'Open the sample', icon: 'tower', run: () => location.assign(D.newUrl('sample')) },
      ...NAV.map((n) => ({ label: `Go to ${n.label}`, icon: n.icon, run: () => go(`#/${n.v}`) })),
      ...TABS.map((t) => ({ label: `Settings: ${t.label}`, icon: t.icon, run: () => go(`#/settings/${t.t}`) })),
      { label: 'Switch theme', icon: 'moon', run: () => void D.setPrefs({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }) },
    ];
    const projects = [...(data.rows ?? []), ...(data.shared ?? [])].map((r) => ({ label: r.name, icon: 'folder', sub: r.summary?.city ?? ago(r.updated_at), run: () => location.assign(D.openUrl(r.id)) }));
    const all = [...projects, ...acts];
    const k = q.trim().toLowerCase();
    return (k ? all.filter((x) => x.label.toLowerCase().includes(k)) : [...projects.slice(0, 5), ...acts]).slice(0, 12);
  }, [q, data.rows, data.shared]);
  useEffect(() => setI(0), [q]);
  const key = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
    else if (e.key === 'Enter' && items[i]) { e.preventDefault(); close(); items[i].run(); }
    else if (e.key === 'Escape') close();
  };
  return (
    <div class="modal-bg d-pal-bg" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div class="d-pal" role="dialog" aria-modal="true" aria-label="Search">
        <label class="d-q big"><I n="search" size={17} /><input autoFocus placeholder="Search projects and actions" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} onKeyDown={key} role="combobox" aria-expanded="true" aria-controls="d-pal-l" aria-activedescendant={`d-pal-${i}`} /></label>
        <ul id="d-pal-l" role="listbox">{items.map((x, k) => (
          <li id={`d-pal-${k}`} role="option" aria-selected={k === i} class={k === i ? 'on' : ''} onMouseEnter={() => setI(k)} onClick={() => { close(); x.run(); }}><I n={x.icon} size={16} /><span>{x.label}</span>{x.sub && <small>{x.sub}</small>}</li>
        ))}{!items.length && <li class="muted">Nothing matches.</li>}</ul>
      </div>
    </div>
  );
}

function Help({ close }: { close: () => void }) {
  const K: [string, string][] = [['Ctrl K', 'Search projects and actions'], ['N', 'New project'], ['?', 'This help']];
  return (
    <Dialog title="Help" close={close}>
      <div class="d-stack">
        <dl class="d-keys">{K.map(([k, t]) => <><dt><kbd>{k}</kbd></dt><dd>{t}</dd></>)}</dl>
        <div class="d-inline"><a class="btn" href={`${BASE}guides/`}><I n="help" size={16} />Guides</a><a class="btn" href={`${BASE}pricing/`}><I n="card" size={16} />Plans</a></div>
        <p class="muted small">In a project, press ? for its own shortcuts.</p>
      </div>
    </Dialog>
  );
}

render(<App />, document.getElementById('dash')!);
