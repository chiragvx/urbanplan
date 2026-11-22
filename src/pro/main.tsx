// UrbanPlan Pro (/pro/): the full planning workspace, beside the simple editor (/app/).
//
// The layout follows how a developer works a plot, and keeps the answer in view the whole time:
// - a rail of six steps on the left (site, design system, scheme, money, approval, explore), each with its own sheet
//   over the view (./sheet.tsx): a drawer on a wide screen (pinned, it docks beside the view), a sheet up from the
//   bottom on a phone;
// - the map (3D or the plan from above, a compass always in its corner) is where the plot, what's on it and the
//   buildings are drawn, picked and moved (./edit.ts); the panel holds the numbers;
// - the 3D in the middle, with the result bar over it (built-up, homes, profit, IRR, the rules), which flashes what
//   each change did to it, so cause and effect are never a scroll away;
// - view tools along the bottom of the 3D (exterior or an X-ray floor, the camera, the sun);
// - on a phone the steps move to a bar along the bottom, and the 3D fills the rest.
// Every change can be undone (Ctrl+Z). The project is kept in this browser and, signed in, in the account a few
// seconds behind (./cloud.ts); a share link carries the whole project in the URL and opens read-only.
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import '../theme/tokens.css';
import './pro.css';
import { buildingCores } from './coreDetail';
import { TIERS, type Tier } from './render/quality';
import * as designLibrary from './designLibrary';
import { presetOf } from './design';
import { DEFAULT_PROJECT, outline, roadLines, type ProProject } from './project';
import { deletePro, listPro, listSharedPro, openPro, savePro, toText, type CloudRef } from './cloud';
import { addComment, addMember, comments as listComments, deleteComment, EMAIL, joinProject, members as listMembers, NotSetUp, projectLink, removeMember, resolveComment, sendInvite, type Comment, type Member } from './team';
import { authReady, explain, peekSession, session, startAuth } from '../auth/auth';
import type { Project } from '../app/cloud';
import { evaluate, dsOfBuilding } from './evaluate';
import { ProView, type CameraView, type Picked, type RenderMode } from './scene';
import { Dither } from '../theme/Dither';
import { UNIT_COLOR, UNIT_LABEL } from '../doc/site';
import { fitRooms } from './rooms';
import { ROOM_COLOR } from './rooms';
import { scrutiny, scrutinySummary } from './scrutiny';
import { applyDeal, DEFAULT_DEAL } from './deal';
import { CITY_LATLON, indiaTime, sunDirection } from './sun';
import { encodeShare, decodeShare } from './share';
import { exploreOptions } from './options';
import { parseBrief, runBrief } from './brief';
import { Sheets, SHEET_CSS } from './drawings';
import { ApproveStep, ExploreStep, MoneyStep, PdfButton, STEPS, type Step, type StepProps } from './steps';
import { SchemeStep, SiteStep2 } from './sitePanels';
import { DesignSystemStep } from './designStep';
import { groundAt } from './terrain';
import { CanvasEdit, duplicated, own, placeTemplate, SELECT, turned, type Picked as EditPicked, type Tool } from './edit';
import { Hud, type Tx } from './hud';
import { ObjectHud } from './objHud';
import { Shelf } from './shelf';
import { PlotHud } from './plotHud';
import { FormHud } from './formHud';
import { Sheet, usePhone, type Detent } from './sheet';
import { withFloors } from './shapePanel';
import { pole } from './form/curve';
import { Btn, cr, Dialog, Icon, Menu, nf, Num, pct, Range, Seg, Select, sqft, TooltipLayer } from './ui';

const KEY = 'urbanplan:pro:project', REF = 'urbanplan:pro:cloud', SEEN = 'urbanplan:pro:seen';
const store = {
  get<T>(k: string, d: T): T { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not kept */ } },
};
const loadP = (): ProProject => { const p = store.get<ProProject | null>(KEY, null); return p?.v === 1 ? { ...DEFAULT_PROJECT, ...p } : DEFAULT_PROJECT; };
const BASE = import.meta.env.BASE_URL;
/** the address as the page was opened (the start code rewrites it to ?local) */
const BOOT = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
const hhmm = (d = new Date()) => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
const ago = (iso: string) => `${new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${hhmm(new Date(iso))}`;
const hm = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || !!t.closest('[role="combobox"]'));

function App() {
  // ---------- the project, with undo ----------
  const [p, setP] = useState<ProProject>(loadP);
  const past = useRef<ProProject[]>([]), future = useRef<ProProject[]>([]), lastPush = useRef(0);
  const [readOnly, setReadOnly] = useState(false);
  // (a drag on the view is one undo step: begun on pointerdown, its changes live, committed on release)
  const txOpen = useRef(false);
  const [busy, setBusy] = useState(false);
  const tx: Tx & { once(o: Partial<ProProject>): void } = {
    begin: () => { if (txOpen.current || readOnly) return; past.current = [...past.current.slice(-80), pRef.current]; future.current = []; txOpen.current = true; setBusy(true); },
    live: (o) => up(o),
    commit: () => { txOpen.current = false; lastPush.current = 0; setBusy(false); },
    /** a change of its own (a key, a button): one undo step */
    once: (o) => { tx.begin(); up(o); tx.commit(); },
    cancel: () => { if (!txOpen.current) return; txOpen.current = false; const x = past.current.pop(); if (x) { store.set(KEY, x); setP(x); } setBusy(false); },
  };
  const up = (o: Partial<ProProject>) => {
    if (readOnly) return;
    setP((x) => {
      // (a burst of changes, typing a number, is one undo step)
      const now = Date.now();
      if (!txOpen.current && now - lastPush.current > 700) { past.current = [...past.current.slice(-80), x]; future.current = []; }
      lastPush.current = now;
      const n = { ...x, ...o }; store.set(KEY, n); return n;
    });
  };
  const replace = (n: ProProject) => { past.current = [...past.current.slice(-80), p]; future.current = []; store.set(KEY, n); setP(n); };
  const undo = () => { const x = past.current.pop(); if (!x) return; future.current.push(p); store.set(KEY, x); setP(x); };
  const redo = () => { const x = future.current.pop(); if (!x) return; past.current.push(p); store.set(KEY, x); setP(x); };

  const [step, setStep] = useState<Step>(() => store.get<Step>('urbanplan:pro:step', 'site'));
  // the step's sheet: open or not, pinned beside the view (a wide screen), its height (a phone)
  const [panel, setPanel] = useState(true);
  const phone = usePhone();
  const [pinned, setPinnedS] = useState<boolean>(() => store.get<boolean>('urbanplan:pro:pin', false));
  const setPinned = (on: boolean) => { setPinnedS(on); store.set('urbanplan:pro:pin', on); };
  const [detent, setDetent] = useState<Detent>('half');
  /** what the sheet covers of the view (px from the left, from the bottom): the 3D and its tools keep clear of it */
  const [cov, setCov] = useState<[number, number]>([0, 0]);
  const cover = (x: number, y: number) => { setCov((c) => (c[0] === x && c[1] === y ? c : [x, y])); view.current?.setCover(x, y); };
  const openSheet = () => { setPanel(true); if (phone && detent === 'peek') setDetent('half'); };
  const go = (s: Step) => { setStep(s); openSheet(); store.set('urbanplan:pro:step', s); setToolS(SELECT); edit.current?.setTool(SELECT); setPicked(null); };
  // ---------- the map's tool and what's picked on it ----------
  const [tool, setToolS] = useState<Tool>(SELECT), [picked, setPicked] = useState<EditPicked>(null), [hint, setHint] = useState<string | null>(null);
  const edit = useRef<CanvasEdit | null>(null);
  // (on a phone a drawing tool lowers the sheet to a peek, so the map is there to draw on)
  const setTool = (t: Tool) => { setToolS(t); edit.current?.setTool(t); if (t.k !== 'select' && matchMedia('(max-width: 900px)').matches) setDetent('peek'); };
  // snapping on by default (Alt held suspends it), remembered in this browser
  const [snap, setSnapS] = useState<boolean>(() => store.get<boolean>('urbanplan:pro:snap', true));
  const setSnap = (on: boolean) => { setSnapS(on); store.set('urbanplan:pro:snap', on); if (edit.current) edit.current.snapOn = on; };
  const [plan, setPlanS] = useState(false);
  const setPlan = (on: boolean) => { setPlanS(on); view.current?.setPlan(on); };
  const needle = useRef<HTMLSpanElement>(null);
  // (north may be turned on the compass though the plot's place set it)
  const [northFree, setNorthFree] = useState(false);
  /** the compass dragged to turn north: where it began */
  const dial = useRef<{ a0: number; n0: number; moved: boolean; x: number; y: number } | null>(null);
  // (the readout by the pointer while drawing: written straight to the DOM, as it changes with every move)
  const readout = useRef<HTMLDivElement>(null);
  const [toastMsg, setToastMsg] = useState<{ s: string; undo?: boolean } | null>(null);
  const toastT = useRef<number>();
  /** a line at the bottom for a few seconds; with `undo`, an Undo on it (for a change made away from the view) */
  const toast = (s: string, o?: { undo?: boolean }) => { setToastMsg({ s, undo: o?.undo }); clearTimeout(toastT.current); toastT.current = window.setTimeout(() => setToastMsg(null), o?.undo ? 7000 : 4200); };
  const [dialog, setDialog] = useState<null | 'projects' | 'share' | 'drawings' | 'keys' | 'welcome' | 'team'>(() => (store.get(SEEN, false) || location.hash.startsWith('#s=') || new URLSearchParams(location.search).has('p') ? null : 'welcome'));

  // ---------- a shared link: /pro/#s=<the project> opens read-only ----------
  useEffect(() => {
    const m = location.hash.match(/^#s=(.+)$/);
    if (!m) return;
    decodeShare(m[1]).then((x) => { setP(x); setReadOnly(true); setDialog(null); }, () => toast('That share link is damaged.'));
  }, []);
  const keepCopy = () => { store.set(KEY, p); setReadOnly(false); history.replaceState(null, '', '?local'); toast('This scheme is now your own copy.'); };

  // ---------- everything worked out from it ----------
  // (every change makes a new project, so its identity is the key)
  const e = useMemo(() => evaluate(p), [p]);
  // (the rooms, the rules and the money wait while a drag is on: worked out when it's let go)
  const settled = useRef(e); if (!busy || settled.current.d.buildings.length !== e.d.buildings.length) settled.current = e;
  const eS = settled.current;
  const rooms = useMemo(() => eS.d.buildings.map((b, i) => fitRooms(b, eS.plans[i], eS.r.code)), [eS]);
  const checks = useMemo(() => scrutiny(eS, rooms), [eS, rooms]);
  const deal = useMemo(() => applyDeal(eS, eS.p.deal ?? DEFAULT_DEAL), [eS]);
  const sum = scrutinySummary(checks);

  // ---------- the account ----------
  const [ref, setRefState] = useState<CloudRef>(() => store.get<CloudRef>(REF, null));
  const setRef = (r: CloudRef) => { store.set(REF, r); setRefState(r); };
  const [cloud, setCloud] = useState<{ s: 'local' | 'saving' | 'saved' | 'error'; msg?: string }>({ s: 'local' });
  const user = session.value?.user ?? null;
  const lastSaved = useRef(toText(p));
  useEffect(() => { peekSession(); void startAuth(); }, []);
  const openId = async (id: string) => {
    try {
      setCloud({ s: 'saving', msg: 'Opening…' });
      const o = await openPro(id);
      lastSaved.current = toText(o.p);
      replace(o.p); setRef(o.ref); setDialog(null);
      if (o.ref?.role && o.ref.role !== 'owner') void joinProject(id);
      history.replaceState(null, '', `?p=${id}`);
      setCloud({ s: 'saved', msg: `Opened ${hhmm()}` });
    } catch (err) { setCloud({ s: 'error', msg: explain(err) }); }
  };
  // (a start asked for from the dashboard: a blank plot sized in the welcome, the sample, or a plot found by its
  // survey number or imported, on the Site step with that way open; under the authority the user prefers)
  useEffect(() => {
    const start = new URLSearchParams(location.search).get('new');
    if (start === null) return;
    let city = DEFAULT_PROJECT.city;
    try { const a = (JSON.parse(localStorage.getItem('urbanplan:prefs') ?? '{}') as { authority?: ProProject['city'] }).authority; if (a) city = a; } catch { /* */ }
    // (a city page's link names its city: Pune's rules, or Mumbai suburbs')
    const asked = new URLSearchParams(location.search).get('city');
    if (asked === 'pune') city = 'pune'; else if (asked === 'mumbai') city = 'mumbai-suburbs';
    // (a template from the website: on the sample plot, in the middle of what may be built, ready to shape)
    if (start.startsWith('template:')) {
      const n: ProProject = { ...DEFAULT_PROJECT, city }, e0 = evaluate(n), [x, z] = pole([e0.r.footprint]);
      const bs = placeTemplate(start.slice(9), [x, z], e0);
      fresh(bs.length ? { ...n, scheme: { ...own(n, e0), buildings: bs } } : n);
      go('build');
      return;
    }
    // (a design system from the builder: the sample in it, on its Design step)
    const dsId = new URLSearchParams(location.search).get('ds');
    if (dsId) {
      void designLibrary.get(dsId).then((s) => { fresh({ ...DEFAULT_PROJECT, city, ...(s ? { custom: s.ds, style: presetOf(s.ds.id).id } : {}) }); go('design'); });
      return;
    }
    fresh({ ...DEFAULT_PROJECT, city });
    if (start === 'blank') setDialog('welcome');
    if (start === 'survey' || start === 'import') { try { sessionStorage.setItem('urbanplan:pro:way', start); } catch { /* */ } go('site'); }
    if (start === 'sample') go('build');
  }, []);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('p');
    if (user && id && id !== ref?.id) void openId(id);
  }, [user?.id]);
  const viewer = ref?.role === 'viewer';
  const roRef = useRef(false); roRef.current = readOnly || viewer;
  const fresh = (n: ProProject = { ...DEFAULT_PROJECT }) => { replace(n); setRef(null); lastSaved.current = ''; setDialog(null); history.replaceState(null, '', '?local'); };
  useEffect(() => {
    if (!user || readOnly || viewer) { setCloud({ s: 'local' }); return; }
    const text = toText(p);
    if (text === lastSaved.current) return;
    const t = setTimeout(async () => {
      setCloud({ s: 'saving' });
      try {
        const r = await savePro(p, ref);
        lastSaved.current = text;
        setRef({ id: r.id, rev: r.revision, owner: r.owner, role: r.copied ? 'owner' : ref?.role });
        history.replaceState(null, '', `?p=${r.id}`);
        setCloud({ s: 'saved', msg: r.copied ? 'Newer work was in the cloud: saved this as a copy' : `Saved ${hhmm()}` });
      } catch (err) { setCloud({ s: 'error', msg: explain(err) }); }
    }, 2500);
    return () => clearTimeout(t);
  }, [JSON.stringify(p), user?.id]);

  // ---------- the 3D ----------
  const canvas = useRef<HTMLCanvasElement>(null), view = useRef<ProView | null>(null);
  const [xray, setXray] = useState<number | null>(null);
  const [hover, setHover] = useState<Picked | null>(null);
  const [sun, setSun] = useState<{ on: boolean; month: number; hour: number }>({ on: false, month: 12, hour: 15 });
  // wireframe by default; shaded is one button away (and the sun needs it)
  const [mode, setModeState] = useState<RenderMode>(() => store.get<RenderMode>('urbanplan:pro:render', 'wire'));
  const setMode = (m: RenderMode) => { setModeState(m); store.set('urbanplan:pro:render', m); };
  useEffect(() => { view.current?.setMode(mode); }, [mode]);
  useEffect(() => {
    const v = new ProView(canvas.current!);
    view.current = v;
    v.mode = store.get<RenderMode>('urbanplan:pro:render', 'wire');
    (window as unknown as { proView?: ProView }).proView = v; // (for the console)
    const ro = new ResizeObserver(() => v.resize());
    ro.observe(canvas.current!.parentElement!);
    v.onPlan = (on) => setPlanS(on);
    v.onNorth = (deg) => { if (needle.current) needle.current.style.transform = `rotate(${deg}deg)`; };
    const ce = new CanvasEdit(canvas.current!, {
      view: () => view.current, p: () => pRef.current, e: () => eRef.current, up: (o) => up(o), step: () => stepRef.current,
      picked: () => pickedRef.current, pick: (x) => setPicked(x), done: () => { setToolS(SELECT); ce.setTool(SELECT); }, hint: setHint, readOnly: () => roRef.current,
      readout: (o) => { const el = readout.current; if (!el) return; if (!o) { el.hidden = true; return; } el.hidden = false; el.classList.toggle('typed', !!o.typed); el.style.transform = `translate(${Math.round(o.x + 16)}px,${Math.round(o.y + 18)}px)`; el.firstElementChild!.textContent = o.text; el.lastElementChild!.textContent = o.sub ?? ''; },
    });
    ce.snapOn = store.get<boolean>('urbanplan:pro:snap', true);
    edit.current = ce;
    (window as unknown as { proEdit?: CanvasEdit }).proEdit = ce; // (for the console)
    const theme = () => v.setTheme(document.documentElement.dataset.theme === 'dark');
    theme();
    const mo = new MutationObserver(theme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { ro.disconnect(); mo.disconnect(); ce.dispose(); v.dispose(); };
  }, []);
  const maxFloor = Math.max(1, ...e.d.buildings.map((b) => b.floors));
  const xr = xray === null ? null : Math.min(xray, maxFloor);
  useEffect(() => {
    setHover(null);
    const o = outline(p);
    view.current?.set({
      r: e.r, d: e.d, plans: e.plans, ds: e.ds, xray: xr, shops: e.shops,
      roads: roadLines(o.ring, o.roads).map((l) => ({ pts: l.pts, today: l.road.today })),
      dsOf: (i) => dsOfBuilding(p, i, e.ds, e.d.buildings[i]?.b.id), rooms, roomColor: ROOM_COLOR,
      features: p.features, levels: p.levels, north: p.north, sel: picked?.k === 'building' ? picked.id : null, forms: e.forms, at: p.at ?? null, city: p.city, cores: xr !== null ? e.d.buildings.map((_, i) => buildingCores(e, i)) : undefined,
    });
    edit.current?.draw();
    applySun();
  }, [e, xr, rooms, picked]);
  useEffect(() => { edit.current?.draw(); }, [step]);
  const applySun = () => {
    const [lat, lon] = CITY_LATLON[p.city] ?? [18.52, 73.86];
    // (the sun's direction turned into the plot's frame, where north is turned by p.north)
    const s = sun.on ? sunDirection(lat, lon, indiaTime(2026, sun.month, 21, sun.hour)) : null, n = ((p.north ?? 0) * Math.PI) / 180;
    view.current?.setSun(s ? [s[0] * Math.cos(n) - s[2] * Math.sin(n), s[1], s[0] * Math.sin(n) + s[2] * Math.cos(n)] : null);
  };
  useEffect(applySun, [sun, p.city, p.north]);
  const cam = (k: CameraView) => view.current?.look(k);
  // (the 3D's quality tier, and rendering an image of the view: ./render)
  const [tier, setTierS] = useState<Exclude<Tier, 'still'>>('standard');
  useEffect(() => { const v = view.current; if (v) { setTierS(v.tier); v.onTier = (t) => { setTierS(t); toast(`The 3D stepped down to ${t} quality to keep it smooth.`); }; } }, []);
  // (?shots=<tier>: the reference shots for tools/render/shots.mjs: each view rendered as a still and sent to the dev
  // server, then the frame-time benchmark)
  useEffect(() => {
    const set = BOOT.get('shots');
    if (!set || !/^(draft|standard|high)$/.test(set)) return;
    const t = window.setTimeout(async () => {
      const v = view.current; if (!v) return;
      v.setMode('shaded'); v.setTier(set as Exclude<Tier, 'still'>, false);
      const suns: [string, [number, number, number] | null][] = [['day', null], ['low', [-0.7, 0.2, 0.68]], ['night', [0.3, -0.4, 0.45]]];
      const t0 = performance.now();
      for (const [sn, dir] of suns) for (const c of ['fit', 'street', 'top'] as CameraView[]) {
        v.look(c); v.setSun(dir);
        await new Promise((ok) => setTimeout(ok, 600));
        const blob = await v.renderStill({ width: 1600, height: 1000, quality: 'raster' });
        await fetch(`/__render/shot?set=${set}&name=${c}-${sn}`, { method: 'POST', body: blob });
      }
      v.look('fit'); v.setSun(null);
      const bench = await v.bench(300);
      await fetch(`/__render/done?set=${set}`, { method: 'POST', body: JSON.stringify({ seconds: Math.round((performance.now() - t0) / 1000), tier: set, bench }) });
    }, 3000);
    return () => clearTimeout(t);
  }, []);
  const [still, setStill] = useState<{ kind: 'raster' | 'path'; f: number; stop: AbortController } | null>(null);
  const renderImage = async (kind: 'raster' | 'path') => {
    const v = view.current; if (!v || still) return;
    const stop = new AbortController();
    setStill({ kind, f: 0, stop });
    try {
      const W = kind === 'path' ? 1600 : 2400, H = Math.round(W / Math.max(0.5, (canvas.current?.clientWidth || 16) / (canvas.current?.clientHeight || 9)));
      const blob = await v.renderStill({ width: W, height: H, quality: kind, samples: 160, signal: stop.signal, onProgress: (f) => setStill((x) => (x ? { ...x, f } : x)) });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${(p.name || 'urbanplan').replace(/[^\w -]+/g, '')} ${kind === 'path' ? 'path-traced' : 'render'}.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('Image saved.');
    } catch (e) { if ((e as Error).name !== 'AbortError') toast(`Couldn’t render the image: ${(e as Error).message}`); }
    finally { setStill(null); }
  };

  // ---------- keys ----------
  useEffect(() => {
    const on = (ev: KeyboardEvent) => {
      // F6 (Shift+F6 back): the top bar, the steps, the sheet, the view
      if (ev.key === 'F6') {
        ev.preventDefault();
        const rs = ['.top', '.rail', '.sheet', '.stage .results'].map((q) => document.querySelector<HTMLElement>(q)).filter((x): x is HTMLElement => !!x);
        const i = rs.findIndex((r) => r.contains(document.activeElement)), n = rs[((i < 0 ? (ev.shiftKey ? 0 : -1) : i) + (ev.shiftKey ? -1 : 1) + rs.length) % rs.length];
        (n.querySelector<HTMLElement>('h2[tabindex], button:not([disabled]), input, [tabindex="0"]') ?? n).focus();
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { if (typing(ev.target)) return; ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'd' && picked?.k === 'building' && !readOnly && !typing(ev.target)) { ev.preventDefault(); const s = own(p, e), src = s.buildings.find((b) => b.id === picked.id); if (!src) return; const c = duplicated(src); tx.once({ scheme: { ...s, buildings: [...s.buildings, c] } }); setPicked({ k: 'building', id: c.id }); return; }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') { if (typing(ev.target)) return; ev.preventDefault(); redo(); return; }
      if (ev.ctrlKey || ev.metaKey || ev.altKey || typing(ev.target)) return;
      if (ev.key === 'Escape') { if (dialog) setDialog(null); else if (picked && tool.k === 'select') setPicked(null); else if (panel && !pinned) setPanel(false); return; }
      // (the picked building: R turns it, + and − its floors, Ctrl+D below)
      const pb = picked?.k === 'building' && !readOnly ? picked : null;
      if (pb && (ev.key === 'r' || ev.key === 'R')) { const s = own(p, e); tx.once({ scheme: { ...s, buildings: s.buildings.map((b) => (b.id === pb.id ? turned(b, ev.shiftKey ? -15 : 15) : b)) } }); return; }
      if (pb && (ev.key === '+' || ev.key === '=' || ev.key === '-')) { const s = own(p, e), br = e.d.buildings.find((x) => x.b.id === pb.id); if (!br) return; tx.once({ scheme: { ...s, buildings: s.buildings.map((b) => (b.id === pb.id ? withFloors(b, Math.max(1, br.floors + (ev.key === '-' ? -1 : 1))) : b)) } }); return; }
      const i = '123456'.indexOf(ev.key);
      if (i >= 0) { go(STEPS[i].key); return; }
      if (ev.key === 'x') setXray((v) => (v === null ? Math.max(1, Math.round(maxFloor / 2)) : null));
      if (ev.key === ']' ) setXray((v) => (v === null ? null : Math.min(maxFloor, v + 1)));
      if (ev.key === '[') setXray((v) => (v === null ? null : Math.max(1, v - 1)));
      if (ev.key === 'f') cam('fit');
      if (ev.key === 't') cam('top');
      if (ev.key === 'p') setPlan(!plan);
      if (ev.key === 'v') setTool(SELECT);
      if (ev.key === 'm' && !readOnly) setTool(tool.k === 'measure' ? SELECT : { k: 'measure' });
      if (ev.key === 's') cam('street');
      if (ev.key === '\\') setPanel((v) => !v);
      if (ev.key === '/') { ev.preventDefault(); setPinned(!pinned); setPanel(true); }
      if (ev.key === '?') setDialog('keys');
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  });

  // ---------- the scripting API: what a script, or an agent, drives (the same functions the panels use) ----------
  const pRef = useRef(p); pRef.current = p;
  const eRef = useRef(e); eRef.current = e;
  const stepRef = useRef<string>(step); stepRef.current = step;
  const pickedRef = useRef<EditPicked>(picked); pickedRef.current = picked;
  useEffect(() => {
    (window as unknown as { urbanplan?: unknown }).urbanplan = {
      /** the project as data */
      get: () => structuredClone(pRef.current),
      /** change it (as a panel would: undoable) */
      set: (o: Partial<ProProject>) => up(o),
      /** pick a building by its id, or nothing */
      pick: (id: string | null) => setPicked(id ? { k: 'building', id } : null),
      /** everything worked out from a project (this one unless given) */
      evaluate: (q?: ProProject) => evaluate(q ?? pRef.current),
      scrutiny: (q?: ProProject) => { const x = evaluate(q ?? pRef.current); return scrutiny(x, x.d.buildings.map((b, i) => fitRooms(b, x.plans[i], x.r.code))); },
      options: (q?: ProProject) => exploreOptions(q ?? pRef.current),
      brief: (text: string) => runBrief(pRef.current, parseBrief(text).brief),
      deal: (q?: ProProject) => { const x = evaluate(q ?? pRef.current); return applyDeal(x, x.p.deal ?? DEFAULT_DEAL); },
      /** the ground round a place, off the city's terrain */
      ground: (lat: number, lon: number, r?: number) => groundAt(lat, lon, r),
    };
  }, []);

  /** pick a building and bring it into the middle of the view (a check's Show); on a phone the sheet lowers to a peek */
  const showBuilding = (id: string) => {
    const br = e.d.buildings.find((b) => b.b.id === id); if (!br) return;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const q of br.quads) for (let i = 0; i + 1 < q.length; i += 2) { x0 = Math.min(x0, q[i]); x1 = Math.max(x1, q[i]); z0 = Math.min(z0, q[i + 1]); z1 = Math.max(z1, q[i + 1]); }
    setToolS(SELECT); edit.current?.setTool(SELECT);
    setPicked({ k: 'building', id });
    if (phone) setDetent('peek');
    if (Number.isFinite(x0)) view.current?.focus((x0 + x1) / 2, (z0 + z1) / 2, Math.max(x1 - x0, z1 - z0), br.height);
  };
  /** the plot's editor is on: picked, or on the Site step with nothing else picked */
  const plotOn = picked?.k === 'plot' || (step === 'site' && !picked);
  const cur = STEPS.find((s) => s.key === step)!;
  const props: StepProps = { p, e, up, rooms, checks, deal, go, openDrawings: () => setDialog('drawings'), toast, tool, setTool, picked, pick: setPicked, show: showBuilding };
  const Body = { site: SiteStep2, build: SchemeStep, design: DesignSystemStep, money: MoneyStep, approve: ApproveStep, explore: ExploreStep }[step];

  return (
    <div class={`pro${panel && pinned && !phone ? ' docked' : ''}${readOnly ? ' ro' : ''}`} style={`--cover:${cov[0]}px;--cover-b:${cov[1]}px`}>
      <header class="top">
        <a class="logo" href={`${BASE}dashboard/`} aria-label="Your dashboard"><Dither field="mark" cell={2} class="mark" />UrbanPlan</a>
        <b class="chip">Pro</b>
        <label class="pname"><input value={p.name} aria-label="Project name" readOnly={readOnly} onChange={(ev) => up({ name: (ev.target as HTMLInputElement).value.trim() || 'Untitled project' })} /><Icon n="edit" size={14} /></label>
        <SaveState cloud={cloud} user={!!user} readOnly={readOnly} />
        <span class="gap" />
        {!readOnly && <span class="hist">
          <Btn kind="quiet" icon="undo" title="Undo (Ctrl+Z)" onClick={undo} disabled={!past.current.length} />
          <Btn kind="quiet" icon="redo" title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!future.current.length} />
        </span>}
        {readOnly
          ? <Btn kind="primary" icon="check" onClick={keepCopy}>Make it my copy</Btn>
          : <Btn icon="share" onClick={() => setDialog('share')}>Share</Btn>}
        {authReady && user && ref && !readOnly && <Btn icon="team" title="People on this project, and comments" onClick={() => setDialog(dialog === 'team' ? null : 'team')}>Team</Btn>}
        {authReady && user && <Btn icon="folder" onClick={() => setDialog(dialog === 'projects' ? null : 'projects')}>Projects</Btn>}
        {authReady && session.value === null && <Btn icon="user" href={`${BASE}login/?next=${encodeURIComponent(location.pathname + location.search)}`} title="Keep your projects in your account">Sign in</Btn>}
        <More openKeys={() => setDialog('keys')} newProject={() => fresh()} />
      </header>

      <nav class="rail" aria-label="Steps">
        {STEPS.map((s, i) => (
          <button type="button" class="step" aria-current={step === s.key ? 'step' : undefined} aria-expanded={step === s.key ? panel : undefined} onClick={() => { if (step !== s.key) go(s.key); else if (panel) setPanel(false); else openSheet(); }} data-tip={`${s.title} (${i + 1})`} data-tip-side="right">
            <Icon n={s.icon} size={20} />
            <span>{s.label}</span>
            {s.key === 'approve' && sum.fail + sum.warn > 0 && <i class={`dot ${sum.fail ? 'bad' : 'warn'}`} />}
          </button>
        ))}
        <span class="gap" />
        <button type="button" class="step small" onClick={() => setPanel(!panel)} aria-label="Show or hide the sheet" aria-expanded={panel} data-tip="Show or hide the sheet (\) · pin it beside the view (/)" data-tip-side="right"><Icon n="panel" size={18} /></button>
      </nav>

      <Sheet title={cur.title} open={panel} pinned={pinned} setPinned={setPinned} close={() => setPanel(false)} phone={phone} detent={detent} setDetent={setDetent} cover={cover}
        footer={!(step === 'build' && picked?.k === 'building') && <footer class="panel-f">
          {STEPS.findIndex((s) => s.key === step) > 0 && <Btn kind="quiet" onClick={() => go(STEPS[STEPS.findIndex((s) => s.key === step) - 1].key)}>Back</Btn>}
          <span class="gap" />
          {STEPS.findIndex((s) => s.key === step) < STEPS.length - 1 && <Btn kind="primary" onClick={() => go(STEPS[STEPS.findIndex((s) => s.key === step) + 1].key)}>Next: {STEPS[STEPS.findIndex((s) => s.key === step) + 1].label}<Icon n="chevron" size={15} /></Btn>}
        </footer>}>
        <div class="panel-b" key={step}>
          {authReady && session.value === null && new URLSearchParams(location.search).has('p') && <p class="note">A project shared with you. <a href={`${BASE}login/?next=${encodeURIComponent(location.pathname + location.search)}`}>Sign in</a> with the email it was shared to and it opens here.</p>}
          {viewer && !readOnly && <p class="note">Shared with you to view and comment. <button type="button" class="linkbtn" onClick={() => setDialog('team')}>Comments</button></p>}
          {readOnly && <p class="note">A shared scheme, view only. <button type="button" class="linkbtn" onClick={keepCopy}>Make it your own copy</button> to change it.</p>}
          <fieldset disabled={readOnly || viewer}><Body {...props} /></fieldset>
        </div>
      </Sheet>

      <main class="stage">
        <canvas ref={canvas} onPointerMove={(ev) => setHover(view.current?.pick(ev.clientX, ev.clientY) ?? null)} onPointerLeave={() => setHover(null)} />
        <ResultBar e={e} deal={deal} sum={sum} go={go} />
        {!readOnly && !viewer && <Shelf tool={tool} setTool={setTool} />}
        <div class="readout" ref={readout} hidden aria-live="polite"><b /><span /></div>
        {tool.k === 'select' && plotOn && <PlotHud view={view.current} edit={edit.current} p={p} e={e} picked={picked} pick={setPicked} tx={tx} snap={snap} live={mode === 'wire' && xr === null} readOnly={readOnly || viewer} toast={toast} setTool={setTool}
          openWay={(w) => { try { sessionStorage.setItem('urbanplan:pro:way', w); } catch { /* */ } setStep('site'); store.set('urbanplan:pro:step', 'site'); openSheet(); dispatchEvent(new CustomEvent('urbanplan:way', { detail: w })); }} northFree={northFree} setNorthFree={setNorthFree} />}
        {tool.k === 'select' && (picked?.k === 'element' || picked?.k === 'feature') && <ObjectHud view={view.current} edit={edit.current} p={p} e={e} picked={picked} pick={setPicked} tx={tx} snap={snap} readOnly={readOnly || viewer} toast={toast} />}
        {tool.k === 'select' && picked?.k === 'building' && <FormHud view={view.current} edit={edit.current} p={p} e={e} picked={picked} tx={tx} live={mode === 'wire' && xr === null} readOnly={readOnly || viewer} xray={xr} setXray={setXray} toast={toast} />}
        {tool.k === 'select' && picked?.k === 'building' && <Hud view={view.current} p={p} e={e} picked={picked} pick={setPicked} up={up} tx={tx} snap={snap} live={mode === 'wire' && xr === null} readOnly={readOnly || viewer} toast={toast}
          inspect={() => { setStep('build'); store.set('urbanplan:pro:step', 'build'); openSheet(); }} />}
        {hint && <div class="drawhint" role="status"><span>{hint}</span><button type="button" class="linkbtn" onClick={() => setTool(SELECT)}>Done</button></div>}
        {(() => {
          // the compass: a click shows the plan from above; with the plot picked it's a dial: drag it (or the arrow keys)
          // to turn north, in 5° steps (unless the plot's place set it and it's locked)
          const turnable = plotOn && !readOnly && !viewer && (!p.at || northFree);
          const angleAt = (ev: PointerEvent) => { const r = (ev.currentTarget as HTMLElement).getBoundingClientRect(); return (Math.atan2(ev.clientX - (r.left + r.width / 2), -(ev.clientY - (r.top + r.height / 2))) * 180) / Math.PI; };
          const setNorth = (v: number) => ((Math.round(v / 5) * 5) % 360 + 360) % 360;
          return <button type="button" class={`compass${turnable ? ' dial' : ''}`} aria-label={turnable ? `North: ${p.north ?? 0}° (drag it, or the arrow keys, to turn it; click for the plan)` : 'North (the map from above)'}
            data-tip={turnable ? `North ${p.north ?? 0}° · drag to turn it · click: the plan` : plotOn && p.at && !northFree ? 'North · set from the plot’s location' : 'North · the plan from above'}
            onPointerDown={(ev) => { if (!turnable || ev.button !== 0) return; (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId); dial.current = { a0: angleAt(ev), n0: p.north ?? 0, moved: false, x: ev.clientX, y: ev.clientY }; }}
            onPointerMove={(ev) => { const d = dial.current; if (!d) return; if (!d.moved && Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 4) return; if (!d.moved) { d.moved = true; tx.begin(); } up({ north: setNorth(d.n0 + angleAt(ev) - d.a0) }); }}
            onPointerUp={() => { const d = dial.current; if (d?.moved) tx.commit(); else dial.current = null; }}
            onClick={() => { if (dial.current?.moved) { dial.current = null; return; } setPlan(true); }}
            onKeyDown={(ev) => { if (!turnable) return; const dir = ev.key === 'ArrowRight' || ev.key === 'ArrowUp' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowDown' ? -1 : 0; if (!dir) return; ev.preventDefault(); ev.stopPropagation(); tx.once({ north: setNorth((p.north ?? 0) + dir * (ev.shiftKey ? 45 : 5)) }); }}>
            <span ref={needle} class="needle"><Icon n="north" size={22} /><b>N</b></span>
          </button>;
        })()}
        <div class="tools">
          <Seg<'3d' | 'plan'> class="tgroup" value={plan ? 'plan' : '3d'} set={(v) => setPlan(v === 'plan')} options={[
            { value: '3d', label: '3D', icon: 'cube', title: 'Orbit round it' },
            { value: 'plan', label: 'Plan', icon: 'plan', title: 'From straight above, to scale (P)' },
          ]} ariaLabel="Camera" />
          <Seg<RenderMode> class="tgroup" value={mode} set={setMode} options={[
            { value: 'wire', label: 'Wireframe', icon: 'wire', checked: mode === 'wire' && xr === null, disabled: xr !== null, title: xr !== null ? 'X-ray is always shaded' : 'Wireframe: low-poly lines' },
            { value: 'shaded', label: 'Shaded', icon: 'shade', checked: mode === 'shaded' || xr !== null, title: 'Shaded: materials, windows, sun' },
          ]} ariaLabel="Drawn as" />
          {xr !== null && <div class="tgroup floor">
            <button type="button" onClick={() => setXray(Math.max(1, xr - 1))} aria-label="Floor down" data-tip="Floor down ([)"><Icon n="minus" size={14} /></button>
            <b>Floor {xr}<small> of {maxFloor}</small></b>
            <button type="button" onClick={() => setXray(Math.min(maxFloor, xr + 1))} aria-label="Floor up" data-tip="Floor up (])"><Icon n="plus" size={14} /></button>
          </div>}
          <div class="tgroup">
            <button type="button" aria-label="Whole site" aria-keyshortcuts="F" data-tip="Whole site (F)" onClick={() => cam('fit')}><Icon n="fit" size={16} /></button>
            <button type="button" aria-label="From the street" aria-keyshortcuts="S" data-tip="From the street (S)" onClick={() => cam('street')}><Icon n="street" size={16} /></button>
            <button type="button" aria-label="From above" aria-keyshortcuts="T" data-tip="From above (T)" onClick={() => cam('top')}><Icon n="top" size={16} /></button>
            <button type="button" aria-label="X-ray, a floor at a time" data-tip="X-ray: a floor at a time" aria-pressed={xr !== null} onClick={() => setXray(xr === null ? Math.max(1, Math.round(maxFloor / 2)) : null)}><Icon n="layers" size={16} /></button>
            <button type="button" aria-label="Snapping" data-tip={snap ? 'Snapping on (hold Alt to move freely)' : 'Snapping off'} aria-pressed={snap} onClick={() => setSnap(!snap)}><Icon n="magnet" size={16} /></button>
          </div>
          <div class={`tgroup sun${sun.on ? ' on' : ''}`}>
            <button type="button" aria-label="Sun" data-tip="Sun and shadows on a date and time" aria-pressed={sun.on} onClick={() => { if (!sun.on && mode === 'wire') setMode('shaded'); setSun({ ...sun, on: !sun.on }); }}><Icon n="sun" size={16} />{sun.on ? '' : 'Sun'}</button>
            {sun.on && <>
              <Select<number> size="sm" quiet aria-label="Month" value={sun.month} onChange={(v) => setSun({ ...sun, month: v })} options={MONTHS.map((m, i) => ({ value: i + 1, label: `21 ${m}` }))} />
              <Range min={6} max={22} step={0.25} value={sun.hour} label="Time of day" valueText={hm(sun.hour)} onInput={(v) => setSun({ ...sun, hour: v })} />
              <b class="time" aria-hidden="true">{hm(sun.hour)}</b>
            </>}
          </div>
          <div class="tgroup">
            {(mode === 'shaded' || xr !== null) && <Select<Exclude<Tier, 'still'>> size="sm" quiet aria-label="Quality" value={tier} onChange={(t) => { setTierS(t); view.current?.setTier(t); }} options={TIERS} />}
            <Menu label="Render an image" icon="camera" items={[
              { label: 'Image (a few seconds)', icon: 'down', onSelect: () => void renderImage('raster') },
              { label: 'Path-traced image (about a minute)', icon: 'spark', onSelect: () => void renderImage('path') },
            ]} />
          </div>
        </div>
        {xr !== null && <div class="legend floating">{[0, 1, 2].map((t) => <span><i style={`background:${UNIT_COLOR[t]}`} />{UNIT_LABEL[t]}</span>)}{(['living', 'bed', 'kitchen', 'toilet'] as const).map((k) => <span><i style={`background:${ROOM_COLOR[k]}`} />{k === 'bed' ? 'bedroom' : k}</span>)}</div>}
        {still && <div class="still-prog" role="status"><span>{still.kind === 'path' ? 'Path tracing' : 'Rendering'} · {Math.round(still.f * 100)}%</span><i style={`width:${Math.round(still.f * 100)}%`} />{still.kind === 'path' && <button type="button" class="linkbtn" onClick={() => still.stop.abort()}>Cancel</button>}</div>}
        {hover && <div class="tip" style={`left:${hover.x + 14}px;top:${hover.y + 14}px`}><b>{hover.label}</b><span>{hover.size}</span><span>Floor {hover.floor}</span></div>}
      </main>

      {toastMsg && <div class="toast" role="status">{toastMsg.s}{toastMsg.undo && <button type="button" class="linkbtn" onClick={() => { undo(); setToastMsg(null); }}>Undo</button>}</div>}
      <TooltipLayer />
      {dialog === 'projects' && user && <Projects current={ref?.id ?? null} open={(id) => void openId(id)} fresh={() => fresh()} close={() => setDialog(null)} />}
      {dialog === 'team' && user && ref && <Team pid={ref.id} role={ref.role ?? 'owner'} step={step} go={(s) => { go(s); }} close={() => setDialog(null)} />}
      {dialog === 'share' && <ShareDialog p={p} close={() => setDialog(null)} toast={toast} />}
      {dialog === 'keys' && <Keys close={() => setDialog(null)} />}
      {dialog === 'welcome' && <Welcome close={(n) => { store.set(SEEN, true); setDialog(null); if (n) { fresh(n); go('site'); } }} />}
      {dialog === 'drawings' && (
        <div class="sheets-wrap" role="dialog" aria-label="Drawing set">
          <style>{SHEET_CSS}</style>
          <div class="sheets-bar"><b>Drawing set · {p.name}</b><span class="gap" /><PdfButton p={p} e={e} checks={checks} rooms={rooms} toast={toast} /><Btn icon="print" onClick={() => print()}>Print</Btn><Btn icon="x" onClick={() => setDialog(null)}>Close</Btn></div>
          <Sheets e={e} checks={checks} rooms={rooms} />
        </div>
      )}
    </div>
  );
}

/** The answer, always in view: what the plot builds, sells and makes, and whether it passes. Each figure flashes
 *  by how much the last change moved it. */
function ResultBar({ e, deal, sum, go }: { e: ReturnType<typeof evaluate>; deal: ReturnType<typeof applyDeal>; sum: ReturnType<typeof scrutinySummary>; go: (s: Step) => void }) {
  const { r, d, shops } = e;
  const k = { bua: d.bua, flats: d.flats + (shops?.count ?? 0), profit: deal.profit, irr: deal.irr ?? 0 };
  const prev = useRef(k), [delta, setDelta] = useState<Partial<Record<keyof typeof k, number>>>({});
  useEffect(() => {
    const dd: Partial<Record<keyof typeof k, number>> = {};
    (Object.keys(k) as (keyof typeof k)[]).forEach((x) => { const v = k[x] - prev.current[x]; if (Math.abs(v) > 1e-6 * Math.max(1, Math.abs(k[x]))) dd[x] = v; });
    prev.current = k;
    if (!Object.keys(dd).length) return;
    setDelta(dd);
    const t = setTimeout(() => setDelta({}), 2600);
    return () => clearTimeout(t);
  }, [k.bua, k.flats, k.profit, k.irr]);
  const used = r.bua > 0 ? d.bua / r.bua : 0;
  // (a scheme of public buildings only earns nothing: what it costs stands in for profit and return)
  const publicOnly = d.buildings.length > 0 && (d.money as { earns?: boolean }).earns === false;
  const D = (x: keyof typeof k, fmt: (v: number) => string) => delta[x] !== undefined && <i class={`delta ${delta[x]! > 0 ? 'up' : 'down'}`}>{delta[x]! > 0 ? '+' : '−'}{fmt(Math.abs(delta[x]!))}</i>;
  return (
    <div class="results" role="region" aria-label="Result">
      <button type="button" class="kpi" onClick={() => go('build')}>
        <span>Built-up</span><b>{sqft(d.bua)}{D('bua', (v) => `${nf(v * 10.7639)}`)}</b>
        <small><i class="meter"><i style={`width:${Math.min(100, used * 100)}%`} /></i>{nf(used * 100)}% of {nf(r.bua * 10.7639 / 1000)}k allowed</small>
      </button>
      <button type="button" class="kpi" onClick={() => go('build')}>
        {publicOnly ? <span>Buildings</span> : <span>Homes</span>}
        {publicOnly ? <b>{d.buildings.length}</b> : <b>{d.flats}{shops ? <em> + {shops.count} shops</em> : null}{D('flats', (v) => nf(v))}</b>}
        <small>{d.buildings.length} bldg · {d.buildings.map((b) => b.floors).join('+') || 0} floors · {nf(d.height)} m</small>
      </button>
      {publicOnly ? <>
      <button type="button" class="kpi" onClick={() => go('money')}>
        <span>Cost</span><b>{cr(d.money.cost)}</b>
        <small>public: nothing sold</small>
      </button>
      <button type="button" class="kpi" onClick={() => go('money')}>
        <span>Build per m²</span><b>{d.bua > 0 ? `₹${nf((d.money.build + d.money.parking + d.money.soft) / d.bua)}` : '—'}</b>
        <small>built-up, land aside</small>
      </button>
      </> : <>
      <button type="button" class="kpi" onClick={() => go('money')}>
        <span>Profit</span><b class={deal.profit < 0 ? 'bad' : ''}>{cr(deal.profit)}{D('profit', (v) => `${nf(v / 1e7, 2)} cr`)}</b>
        <small>{e.p.sale || e.p.land ? `${pct(deal.margin)} margin · ${cr(deal.revenue)} sales` : `${pct(deal.margin)} · starting prices`}</small>
      </button>
      <button type="button" class="kpi" onClick={() => go('money')}>
        <span>IRR</span><b class={deal.irr !== null && deal.irr < 0 ? 'bad' : ''}>{pct(deal.irr)}{D('irr', (v) => `${nf(v * 100, 1)} pt`)}</b>
        <small>peak cash {cr(deal.peak)}</small>
      </button>
      </>}
      <button type="button" class={`kpi rules ${sum.fail ? 'bad' : sum.warn ? 'warn' : 'ok'}`} onClick={() => go('approve')}>
        <span>Rules</span>
        <b><Icon n={sum.fail ? 'x' : sum.warn ? 'warn' : 'check'} size={16} />{sum.fail ? `${sum.fail} fail` : sum.warn ? `${sum.warn} to check` : 'All clear'}</b>
        <small>{sum.pass} pass{sum.fail && sum.warn ? ` · ${sum.warn} to check` : ''}</small>
      </button>
    </div>
  );
}

function SaveState({ cloud, user, readOnly }: { cloud: { s: string; msg?: string }; user: boolean; readOnly: boolean }) {
  if (readOnly) return <span class="save ro"><Icon n="link" size={13} />Shared view</span>;
  if (!user) return <span class="save" title="Kept in this browser. Sign in to keep it in your account.">Saved in this browser</span>;
  const t = cloud.s === 'saving' ? (cloud.msg ?? 'Saving…') : cloud.s === 'saved' ? (cloud.msg ?? 'Saved') : cloud.s === 'error' ? 'Not saved' : 'Saved';
  return <span class={`save ${cloud.s}`} title={cloud.msg} role="status">{cloud.s === 'saving' ? <Dither class="dz" cell={2} /> : <i />}{t}</span>;
}

function More({ openKeys, newProject }: { openKeys: () => void; newProject: () => void }) {
  return <Menu label="More" items={[
    { label: 'New project', icon: 'plus', onSelect: newProject },
    { label: 'The simple editor', icon: 'site', href: `${BASE}app/` },
    { label: 'Keyboard shortcuts', icon: 'key', onSelect: openKeys },
  ]} />;
}

/** The account's Pro projects: open one, start a new one, delete (two clicks). */
function Projects({ current, open, fresh, close }: { current: string | null; open: (id: string) => void; fresh: () => void; close: () => void }) {
  const [list, setList] = useState<Project[] | null>(null), [shared, setShared] = useState<Project[]>([]);
  const [err, setErr] = useState(''), [sure, setSure] = useState('');
  const reload = () => { void listSharedPro().then(setShared); return listPro().then(setList, (x) => setErr(explain(x))); };
  useEffect(() => { void reload(); }, []);
  const del = async (id: string) => {
    if (sure !== id) { setSure(id); return; }
    try { await deletePro(id); setSure(''); void reload(); } catch (x) { setErr(explain(x)); }
  };
  return (
    <Dialog title="Your projects" close={close} side>
      <Btn kind="primary" icon="plus" onClick={fresh}>New project</Btn>
      {err && <p class="note bad">{err}</p>}
      {!list && !err && <p class="note">Loading…</p>}
      {list && !list.length && <p class="note">None yet: this one saves to your account as you work.</p>}
      {list && list.length > 0 && <ul class="plist">{list.map((x) => (
        <li class={x.id === current ? 'on' : ''}>
          <button type="button" class="pitem" onClick={() => open(x.id)}><b>{x.name}</b><span>{x.region.replace('pro:', '').replace('-', ' ')} · {ago(x.updated_at)}</span></button>
          <Btn kind="quiet" onClick={() => void del(x.id)}>{sure === x.id ? 'Delete?' : 'Delete'}</Btn>
        </li>
      ))}</ul>}
      {shared.length > 0 && <>
        <h3 class="mh">Shared with you</h3>
        <ul class="plist">{shared.map((x) => (
          <li class={x.id === current ? 'on' : ''}>
            <button type="button" class="pitem" onClick={() => open(x.id)}><b>{x.name}</b><span>{x.region.replace('pro:', '').replace('-', ' ')} · {ago(x.updated_at)}</span></button>
          </li>
        ))}</ul>
      </>}
    </Dialog>
  );
}

const STEP_NAME: Record<string, string> = Object.fromEntries(STEPS.map((s) => [s.key, s.label]));

/** The people on the project (the owner adds and removes them) and its comments, each tagged with its step. */
function Team({ pid, role, step, go, close }: { pid: string; role: 'owner' | 'editor' | 'viewer'; step: Step; go: (s: Step) => void; close: () => void }) {
  const [people, setPeople] = useState<Member[] | null>(null), [notes, setNotes] = useState<Comment[] | null>(null);
  const [err, setErr] = useState(''), [off, setOff] = useState('');
  const [email, setEmail] = useState(''), [as, setAs] = useState<Member['role']>('editor');
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [showDone, setShowDone] = useState(false);
  const [sent, setSent] = useState('');
  const me = session.value?.user.id, link = projectLink(pid);
  const copyLink = async () => { try { await navigator.clipboard.writeText(link); setSent('Link copied. Send it to them: it opens the project once they sign in with the email you added.'); } catch { setSent(`Copy this link and send it: ${link}`); } };
  const invite = (who: string) => run(async () => { const r = await sendInvite(pid, who); setSent(r === 'sent' ? `Invite emailed to ${who}.` : `Added. Email invites aren’t set up on this site yet, so send them the link: it opens the project once they sign in as ${who}.`); });
  const fail = (x: unknown) => { if (x instanceof NotSetUp) setOff(x.message); else setErr(explain(x)); };
  const reload = () => Promise.all([listMembers(pid).then(setPeople), listComments(pid).then(setNotes)]).catch(fail);
  useEffect(() => { void reload(); const t = setInterval(() => void listComments(pid).then(setNotes).catch(() => {}), 20000); return () => clearInterval(t); }, [pid]);
  const run = async (f: () => Promise<unknown>) => { setBusy(true); setErr(''); try { await f(); await reload(); } catch (x) { fail(x); } finally { setBusy(false); } };
  const open = (notes ?? []).filter((c) => !c.resolved), done = (notes ?? []).filter((c) => c.resolved);
  const Item = ({ c }: { c: Comment }) => (
    <li class={`cmt${c.resolved ? ' done' : ''}`}>
      <div class="cmt-h"><b>{c.author === me ? 'You' : c.author_name || 'Someone'}</b><span>{ago(c.created_at)}</span>
        {c.step && STEP_NAME[c.step] && <button type="button" class="chip-step" onClick={() => go(c.step as Step)}>{STEP_NAME[c.step]}</button>}</div>
      <p>{c.body}</p>
      <div class="cmt-a">
        {(c.author === me || role !== 'viewer') && <button type="button" class="linkbtn" disabled={busy} onClick={() => void run(() => resolveComment(c.id, !c.resolved))}>{c.resolved ? 'Reopen' : 'Resolve'}</button>}
        {(c.author === me || role === 'owner') && <button type="button" class="linkbtn" disabled={busy} onClick={() => void run(() => deleteComment(c.id))}>Delete</button>}
      </div>
    </li>
  );
  if (off) return <Dialog title="Team" close={close} side><p class="note">{off} The site's owner turns them on by running <code>supabase/migrations/0004_project_team.sql</code> once in Supabase.</p></Dialog>;
  return (
    <Dialog title="Team" close={close} side>
      {err && <p class="note bad">{err}</p>}
      <h3 class="mh">People</h3>
      <ul class="people">
        <li><Icon n="user" size={15} /><span>{role === 'owner' ? 'You' : 'The owner'}</span><em>owner</em></li>
        {people?.map((m) => (
          <li><Icon n="user" size={15} /><span>{m.email}<small class={m.joined_at ? 'ok' : ''}>{m.joined_at ? 'joined' : m.invited_at ? `invited ${ago(m.invited_at)}` : 'not joined yet'}</small></span><em>{m.role === 'viewer' ? 'can view' : 'can edit'}</em>
            {role === 'owner' && !m.joined_at && <button type="button" class="linkbtn" disabled={busy} onClick={() => void invite(m.email)}>{m.invited_at ? 'Resend' : 'Email invite'}</button>}
            {role === 'owner' && <Btn kind="quiet" icon="x" title={`Remove ${m.email}`} disabled={busy} onClick={() => void run(() => removeMember(pid, m.email))} />}</li>
        ))}
      </ul>
      {role === 'owner' && <form class="invite" onSubmit={(ev) => { ev.preventDefault(); if (EMAIL.test(email.trim())) void run(async () => { const who = email.trim().toLowerCase(); await addMember(pid, who, as); setEmail(''); const r = await sendInvite(pid, who).catch(() => 'off' as const); setSent(r === 'sent' ? `Added, and an invite emailed to ${who}.` : `Added ${who}. Send them the project link: it opens once they sign in with that email.`); }); }}>
        <input type="email" class="txt" placeholder="Their email" value={email} onInput={(ev) => setEmail((ev.target as HTMLInputElement).value)} aria-label="Email to add" />
        <Select<Member['role']> aria-label="Their role" value={as} onChange={setAs} options={[{ value: 'editor', label: 'Can edit' }, { value: 'viewer', label: 'Can view and comment' }]} />
        <Btn kind="primary" submit disabled={busy || !EMAIL.test(email.trim())}>Add</Btn>
      </form>}
      {sent && <p class="note ok" role="status">{sent}</p>}
      {role !== 'viewer' && <div class="plink"><input class="txt" readOnly value={link} aria-label="Link to this project" onFocus={(ev) => (ev.target as HTMLInputElement).select()} /><Btn icon="link" onClick={() => void copyLink()}>Copy link</Btn></div>}
      {role === 'owner' && <p class="note">The link only works for people you’ve added, signed in with that email. New to UrbanPlan? They make an account with it.</p>}

      <h3 class="mh">Comments{open.length ? ` (${open.length})` : ''}</h3>
      <form class="cmt-new" onSubmit={(ev) => { ev.preventDefault(); if (text.trim()) void run(async () => { await addComment(pid, text, step); setText(''); }); }}>
        <textarea class="txt" rows={3} maxLength={2000} placeholder={`A comment on ${STEP_NAME[step]}…`} value={text} onInput={(ev) => setText((ev.target as HTMLTextAreaElement).value)}
          onKeyDown={(ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && text.trim()) { ev.preventDefault(); void run(async () => { await addComment(pid, text, step); setText(''); }); } }} />
        <Btn kind="primary" submit disabled={busy || !text.trim()}>Comment</Btn>
      </form>
      {!notes && !err && <p class="note">Loading…</p>}
      {notes && !open.length && <p class="note">No open comments.</p>}
      <ul class="cmts">{[...open].reverse().map((c) => <Item c={c} />)}</ul>
      {done.length > 0 && <button type="button" class="linkbtn" onClick={() => setShowDone(!showDone)}>{showDone ? 'Hide' : 'Show'} {done.length} resolved</button>}
      {showDone && <ul class="cmts">{[...done].reverse().map((c) => <Item c={c} />)}</ul>}
    </Dialog>
  );
}

function ShareDialog({ p, close, toast }: { p: ProProject; close: () => void; toast: (s: string) => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => { encodeShare(p).then((s) => setUrl(`${location.origin}${location.pathname}#s=${s}`)); }, []);
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast('Link copied.'); close(); } catch { toast('Select the link and copy it.'); } };
  return (
    <Dialog title="Share this scheme" close={close}>
      <p class="note">Anyone with the link sees the scheme, its 3D and its figures, read-only. They can make their own copy. The whole project is in the link: nothing is uploaded.</p>
      <input class="share-url" readOnly value={url} onFocus={(ev) => (ev.target as HTMLInputElement).select()} />
      <div class="row r2"><Btn kind="primary" icon="link" onClick={copy} disabled={!url}>Copy link</Btn><Btn href={`https://wa.me/?text=${encodeURIComponent(`${p.name} on UrbanPlan: ${url}`)}`} icon="share">WhatsApp</Btn></div>
    </Dialog>
  );
}

function Keys({ close }: { close: () => void }) {
  const rows: [string, string][] = [['1 – 6', 'Go to a step'], ['\\', 'Show or hide the sheet'], ['/', 'Pin the sheet beside the view, or float it'], ['F6 · Shift+F6', 'Move between the top bar, the steps, the sheet and the view'], ['R · Shift+R', 'Turn the picked building 15°'], ['+ −', 'A floor more or less on the picked building'], ['Ctrl+D', 'Duplicate the picked building'], ['M', 'Measure'], ['X', 'X-ray floor on or off'], ['[  ]', 'Floor down / up'], ['F · S · T', 'Camera: whole site, street, from above'], ['P', 'The plan from above, or back to 3D'], ['V', 'Back to picking'], ['Enter · Esc · Backspace', 'Drawing: finish, cancel, take back a point'], ['Shift', 'Drawing: keep a line square to the road'], ['Alt', 'Hold while dragging: no snapping'], ['← → ↑ ↓', 'Nudge what’s picked a grid step (Shift: ×10)'], ['Delete', 'Remove what’s picked'], ['Ctrl+Z · Ctrl+Shift+Z', 'Undo · redo'], ['↑ ↓ in a number', 'Step it (Shift: ×10)'], ['Esc', 'Close this; let go of what’s picked; close the sheet']];
  return <Dialog title="Keyboard shortcuts" close={close}><dl class="lines keys">{rows.map(([a, b]) => <div><dt><kbd>{a}</kbd></dt><dd>{b}</dd></div>)}</dl></Dialog>;
}

/** First visit: start from a plot in three numbers, or look round the sample. */
function Welcome({ close }: { close: (p?: ProProject) => void }) {
  const [w, setW] = useState(40), [dpt, setD] = useState(50), [road, setRoad] = useState(12), [city, setCity] = useState<ProProject['city']>('pune');
  return (
    <Dialog title="Size up a plot in a minute" close={() => close()} wide>
      <p class="note">The plot and its road: the most the rules allow, in 3D, with the money.</p>
      <div class="row r2">
        <Select<ProProject['city']> label="Planning authority" value={city} onChange={setCity} options={[{ value: 'pune', label: 'Pune (UDCPR)' }, { value: 'pune-congested', label: 'Pune old city' }, { value: 'mumbai-suburbs', label: 'Mumbai suburbs' }, { value: 'mumbai-island', label: 'Mumbai island city' }]} />
        <Num label="Road in front" value={road} set={setRoad} min={3} max={80} unit="m" />
      </div>
      <div class="row r2"><Num label="Frontage" value={w} set={setW} min={10} max={400} unit="m" /><Num label="Depth" value={dpt} set={setD} min={10} max={400} unit="m" /></div>
      <div class="row r2">
        <Btn kind="primary" onClick={() => close({ ...DEFAULT_PROJECT, city, width: w, depth: dpt, road, dpRoad: road, name: `${w} × ${dpt} m plot` })}>Work it out</Btn>
        <Btn onClick={() => close()}>Open the sample</Btn>
      </div>
    </Dialog>
  );
}

render(<App />, document.getElementById('pro')!);
