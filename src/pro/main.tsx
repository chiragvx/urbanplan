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
// - on a phone the steps move to a bar along the bottom, and the 3D fills the rest; and a phone only looks and shares:
//   nothing changes on it (../device.ts, docs/plans/mobile-view-only.md).
// Every change can be undone (Ctrl+Z). The project is kept in this browser and, signed in, in the account a few
// seconds behind (./cloud.ts); a share link carries the whole project in the URL and opens read-only.
import { projectOf, siteById, sitePrices } from './sites';
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import '../theme/tokens.css';
import './pro.css';
import { buildingCores } from './coreDetail';
import { TIERS, type Tier } from './render/quality';
import * as designLibrary from './designLibrary';
import { presetOf } from './design';
import { CITIES, DEFAULT_PROJECT, outline, roadLines, targetOf, type ProProject } from './project';
import { listPro, listSharedPro, openPro, savePro, toText, type CloudRef } from './cloud';
import { addMember, anchorsOff, EMAIL, joinProject, members as listMembers, NotSetUp, projectLink, removeMember, sendInvite, type Member } from './team';
import { clearLocalNotes, cloudNotes, countsByThing, localNotes, mine as mineNote, threads, useNotes, type Note } from './comments';
import { CommentLayer, CommentList } from './commentPins';
import { Outline } from './outline';
import { EmptyState, HelpCorner, tick, ticked, type Task } from './start';
import { authReady, explain, peekSession, session, signOut, startAuth } from '../auth/auth';
import type { Project } from '../app/cloud';
import { evaluate, dsOfBuilding } from './evaluate';
import { ProView, type CameraView, type Picked, type RenderMode } from './scene';
import { Dither } from '../theme/Dither';
import { UNIT_COLOR, UNIT_LABEL } from '../doc/site';
import { fitRooms } from './rooms';
import { ROOM_COLOR } from './rooms';
import { scrutiny, scrutinySummary } from './scrutiny';
import { applyDeal, DEFAULT_DEAL, landWorth } from './deal';
import { AreaStatementBody } from './numbersUi';
import { CITY_LATLON, indiaTime, sunDirection } from './sun';
import { encodeShare, decodeShare } from './share';
import { downloadSet, Sheets, SHEET_CSS } from './drawings';
import { buildModel, ifcLite, modelJson } from './model';
import { FINDABLE } from './findable';
import { documents, fees, permissionOf } from './approvals';
import { findIn, Search, type Cmd } from './search';
import { ApproveStep, isStep, OLD_STEP, PdfButton, slug, STEPS, type Step, type StepProps } from './steps';
import { NumbersPlace, ProjectBody } from './places';
import { Report, type ReportKind } from './report';
import { DesignSystemStep } from './designStep';
import { groundAt } from './terrain';
import { CanvasEdit, duplicated, own, placeTemplate, SELECT, turned, type Picked as EditPicked, type Tool } from './edit';
import { Hud, type Tx } from './hud';
import { ObjectHud } from './objHud';
import { Shelf } from './shelf';
import { PlotHud } from './plotHud';
import { FormHud } from './formHud';
import { Sheet, useNarrow, type Detent } from './sheet';
import { isPhone, usePhone } from '../device';
import { Frame as InspFrame, Inspector } from './inspector';
import { Compare } from './compare';
import { added as addedOption, asOption, currentOption, duplicated as duplicatedOption, optionName, optionsOf, removedOption, renamed, switchTo } from './variants';
import { CheckPins } from './checkPins';
import { BuildingInfo, buildingName, MoneyView, Overview, RulesView, VIEW_OF, VIEW_STEPS, type ViewStep } from './viewer';
import { ShareBody } from './shareSheet';
import { withFloors } from './shapePanel';
import { pole } from './form/curve';
import { Btn, cr, Dialog, download, Icon, Menu, nf, Num, pct, Range, Seg, Select, sqft, TooltipLayer, type MenuItem } from './ui';

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
    begin: () => { if (txOpen.current || roRef.current) return; past.current = [...past.current.slice(-80), pRef.current]; future.current = []; txOpen.current = true; setBusy(true); },
    live: (o) => up(o),
    commit: () => { txOpen.current = false; lastPush.current = 0; setBusy(false); tick('moved'); },
    /** a change of its own (a key, a button): one undo step */
    once: (o) => { tx.begin(); up(o); tx.commit(); },
    cancel: () => { if (!txOpen.current) return; txOpen.current = false; const x = past.current.pop(); if (x) { store.set(KEY, x); setP(x); } setBusy(false); },
  };
  const up = (o: Partial<ProProject>) => {
    if (roRef.current) return;
    setP((x) => {
      // (a burst of changes, typing a number, is one undo step)
      const now = Date.now();
      if (!txOpen.current && now - lastPush.current > 700) { past.current = [...past.current.slice(-80), x]; future.current = []; }
      lastPush.current = now;
      const n = { ...x, ...o }; store.set(KEY, n); return n;
    });
  };
  /** when the project was last swapped whole (opened, undone, redone): not an edit that makes a layout yours */
  const swappedAt = useRef(0);
  const replace = (n: ProProject) => { swappedAt.current = Date.now(); past.current = [...past.current.slice(-80), p]; future.current = []; store.set(KEY, n); setP(n); };
  const undo = () => { if (roRef.current) return; swappedAt.current = Date.now(); const x = past.current.pop(); if (!x) return; future.current.push(p); store.set(KEY, x); setP(x); };
  const redo = () => { if (roRef.current) return; swappedAt.current = Date.now(); const x = future.current.pop(); if (!x) return; past.current.push(p); store.set(KEY, x); setP(x); };

  // (the place: Brief, Design, Numbers or Approval, kept for when the sheet opens; the six steps before map to the
  // places that took them in. A project opens on the view, never on a sheet: docs/plans/pro-ia-rethink.md)
  const [step, setStep] = useState<Step>(() => { const s = store.get<string>('urbanplan:pro:step', ''); return isStep(s) ? s : OLD_STEP[s] ?? 'design'; });
  const oldStep = useRef(!!OLD_STEP[store.get<string>('urbanplan:pro:step', '')] && !isStep(store.get<string>('urbanplan:pro:step', '')));
  // the step's sheet: open or not, pinned beside the view (a wide screen), its height (a phone)
  const [panel, setPanel] = useState(() => isPhone());
  /** Numbers or Approval as a report over the view (a wide screen; a narrow one keeps their sheets) */
  const [report, setReport] = useState<ReportKind | null>(null);
  /** what the report covers of the view from the bottom (px) */
  const [repH, setRepH] = useState(0);
  /** a narrow screen (the sheet's layout), and a phone (nothing changes on it) */
  const narrow = useNarrow(), phone = usePhone();
  const narrowRef = useRef(narrow); narrowRef.current = narrow;
  const setProjOpenRef = useRef<(v: boolean) => void>(() => {});
  const frameRef = useRef<(w: EditPicked) => void>(() => {});
  const [pinned, setPinnedS] = useState<boolean>(() => store.get<boolean>('urbanplan:pro:pin', false));
  const setPinned = (on: boolean) => { setPinnedS(on); store.set('urbanplan:pro:pin', on); };
  const [detent, setDetent] = useState<Detent>('half');
  /** what the sheet covers of the view (px from the left, from the bottom): the 3D and its tools keep clear of it */
  const [cov, setCov] = useState<[number, number]>([0, 0]);
  const cover = (x: number, y: number) => { setCov((c) => (c[0] === x && c[1] === y ? c : [x, y])); };
  const openSheet = () => { setPanel(true); if (narrow && detent === 'peek') setDetent('half'); };
  // (a phone has its own four sheets: an editing step's link lands on the one that shows it)
  const [vstep, setVstepS] = useState<ViewStep>(() => store.get<ViewStep>('urbanplan:pro:vstep', 'overview'));
  const setVstep = (v: ViewStep) => { setVstepS(v); store.set('urbanplan:pro:vstep', v); };
  const goView = (v: ViewStep) => { setVstep(v); setPicked(null); openSheet(); };
  /** go to a place: the pick stays, so a building picked in Design is the one in focus in Numbers and Approval */
  /** a place to come back to, without opening its sheet: a project or a site lands in the view */
  const land = (s: Step) => { const k: Step = s === 'brief' ? 'design' : s; setStep(k); store.set('urbanplan:pro:step', k); };
  /** a place: the project (Brief and Design before) is the inspector with nothing picked, on a screen wide enough;
   *  Numbers and Approval are sheets */
  const go = (s0: Step) => { const s: Step = s0 === 'brief' ? 'design' : s0; if (isPhone()) { goView(VIEW_OF[s] ?? 'overview'); return; } setStep(s); store.set('urbanplan:pro:step', s); setToolS(SELECT); edit.current?.setTool(SELECT);
    if (s === 'design' && !narrowRef.current) { setPicked(null); setProjOpenRef.current(true); setPanel(false); return; }
    if ((s === 'numbers' || s === 'approve') && !narrowRef.current) { setReport(s); setPanel(false); return; }
    openSheet(); };
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
  const [toastMsg, setToastMsg] = useState<{ s: string; undo?: boolean; act?: { label: string; run: () => void } } | null>(null);
  const toastT = useRef<number>();
  /** a line at the bottom for a few seconds; with `undo`, an Undo on it (for a change made away from the view) */
  const toast = (s: string, o?: { undo?: boolean; act?: { label: string; run: () => void } }) => { setToastMsg({ s, undo: o?.undo, act: o?.act }); clearTimeout(toastT.current); toastT.current = window.setTimeout(() => setToastMsg(null), o?.undo ? 7000 : 4200); };
  const [search, setSearch] = useState(false);
  const [dialog, setDialog] = useState<null | 'share' | 'drawings' | 'keys' | 'people' | 'area' | 'look' | 'compare'>(null);
  // (a first visit with nothing kept here: the empty state on the view, not a dialog)
  useEffect(() => {
    if (!store.get(SEEN, false) && !isPhone() && !location.hash.startsWith('#s=') && !BOOT.has('p') && !BOOT.has('new') && localStorage.getItem(KEY) === null) setP({ ...DEFAULT_PROJECT, blank: true });
    store.set(SEEN, true);
  }, []);

  // ---------- a shared link: /pro/#s=<the project> opens read-only ----------
  useEffect(() => {
    const m = location.hash.match(/^#s=([^&]+)(?:&o=([\w-]+))?$/);
    if (!m) return;
    // (&o= opens one of its options)
    decodeShare(m[1]).then((x) => { setP(m[2] && optionsOf(x).some((o) => o.id === m[2]) ? { ...x, ...switchTo(x, m[2]) } : x); setReadOnly(true); setDialog(null); }, () => toast('That share link is damaged.'));
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
      replace(o.p); setRef(o.ref); setDialog(null); setPicked(null); setPanel(false); land('design'); fitSoon();
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
    if (isPhone()) { location.replace(`${BASE}dashboard/`); return; }
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
      land('design');
      return;
    }
    // (a site from the dashboard's Sites: its plot and road under the firm's prices, at the Looking stage, on the view)
    if (start.startsWith('site:')) {
      const site = siteById(start.slice(5));
      if (site) { fresh(projectOf(site, sitePrices())); land('brief'); fitSoon(); return; }
    }
    // (a design system from the builder: the sample in it, on its Design step)
    const dsId = new URLSearchParams(location.search).get('ds');
    if (dsId) {
      void designLibrary.get(dsId).then((s) => { fresh({ ...DEFAULT_PROJECT, city, ...(s ? { custom: s.ds, style: presetOf(s.ds.id).id } : {}) }); land('design'); setDialog('look'); });
      return;
    }
    fresh({ ...DEFAULT_PROJECT, city, ...(start === 'blank' ? { blank: true } : {}) });
    if (start === 'survey' || start === 'import') { try { sessionStorage.setItem('urbanplan:pro:way', start); } catch { /* */ } go('design'); }
    if (start === 'sample') go('design');
  }, []);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('p');
    if (user && id && id !== ref?.id) void openId(id);
  }, [user?.id]);
  const viewer = ref?.role === 'viewer';
  /** nothing may change: a share link, a viewer on the team, or a phone */
  const locked = readOnly || viewer || phone;
  const roRef = useRef(false); roRef.current = locked;
  const fresh = (n: ProProject = { ...DEFAULT_PROJECT, blank: true }) => { clearLocalNotes(); replace(n); setRef(null); lastSaved.current = ''; setDialog(null); history.replaceState(null, '', '?local'); };
  useEffect(() => {
    if (!user || locked) { setCloud({ s: 'local' }); return; }
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

  // ---------- the outline, focus mode, comments ----------
  /** the outline beside the sheet: open by default on a wide screen, remembered */
  const [olOpen, setOlOpenS] = useState<boolean>(() => store.get<boolean>('urbanplan:pro:outline2', false));
  const setOlOpen = (v: boolean) => { setOlOpenS(v); store.set('urbanplan:pro:outline2', v); };
  /** focus mode (Shift+\): the sheet and the outline away; the view, its tools and the scorecard kept */
  const [focus, setFocusS] = useState(false);
  const setFocus = (on: boolean) => { setFocusS(on); setPanel(!on); };
  // (hidden in the view, and not picked there: this session's view of the project, not saved in it)
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [lockedIds, setLockedIds] = useState<Set<string>>(() => new Set());
  const toggleOl = (which: 'hidden' | 'locked', id: string) => {
    const set = which === 'hidden' ? setHidden : setLockedIds;
    set((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    if (picked && 'id' in picked && picked.id === id) setPicked(null);
  };
  useEffect(() => { if (edit.current) edit.current.locked = lockedIds; }, [lockedIds]);
  // comments: the project's people, in the cloud; notes to self for a project only in this browser
  const noteStore = useMemo(() => (phone || readOnly ? null : ref && user ? cloudNotes(ref.id) : !ref ? localNotes() : null), [ref?.id, user?.id, readOnly, phone]);
  const N = useNotes(noteStore);
  const [cmode, setCmodeS] = useState(false);
  const setCmode = (on: boolean) => { setCmodeS(on); if (on) { setToolS(SELECT); edit.current?.setTool(SELECT); } };
  const [openNote, setOpenNote] = useState<Note['id'] | null>(null);
  const [showDone, setShowDone] = useState(false);
  const noteThreads = useMemo(() => threads(N.notes ?? []), [N.notes]);
  const openNotes = noteThreads.filter((t) => !t.root.resolved).length;
  const canResolve = !ref || ref.role !== 'viewer';

  // ---------- first-run guidance (docs/plans/pro-ia-rethink.md §2.6) ----------
  /** the first pick of a building ever: a one-line hint on what to drag, gone for good once used or dismissed */
  const [firstPick, setFirstPick] = useState(false);
  useEffect(() => {
    if (picked?.k !== 'building') return;
    if (!ticked('picked')) tick('picked');
    if (!ticked('pickhint') && !locked && !phone) setFirstPick(true);
  }, [picked?.k === 'building' ? picked.id : '']);
  // (the hint goes once a building has been changed in the view, or nothing's picked)
  useEffect(() => { if (firstPick && (ticked('moved') || picked?.k !== 'building')) { if (ticked('moved')) tick('pickhint'); setFirstPick(false); } }, [p.scheme, picked]);
  /** a checklist task, done for you as far as it can be: the tool armed, the report opened */
  const doTask = (t: Task) => {
    if (t === 'plot') { setPicked({ k: 'plot' }); toast('The plot is picked: drag its corners, or set its size and roads in the inspector.'); return; }
    if (t === 'building') { setTool({ k: 'building', shape: 'tower' } as Tool); toast('Click on the plot where the tower goes.'); return; }
    if (t === 'moved') { const b = e.d.buildings[0]; if (b) { showBuilding(b.b.id); toast('Drag the arrow on its top for floors, or its middle to move it.'); } else { setTool({ k: 'building', shape: 'tower' } as Tool); toast('Put a building on the plot first: click where it goes.'); } return; }
    if (t === 'numbers') { go('numbers'); return; }
    if (t === 'option') { optionActs.duplicate(); return; }
    setDialog('share');
  };

  // ---------- generated or yours (docs/plans/pro-ia-rethink.md §2.5) ----------
  // (no scheme: the generator lays it out from the brief, and brief changes move it. A scheme: the buildings are the
  // user's, and the generator's settings wait for a regenerate)
  const ownLayout = !!p.scheme;
  /** the brief's layout again, as a new option beside this one (nothing of this one lost) */
  const regenAsOption = () => { const q = pRef.current, c = addedOption(q, { scheme: undefined }, 'brief'), name = c.options?.find((o) => o.id === c.option)?.name ?? 'a new option'; up(c); setPicked(null); toast(`Laid out again from the settings, as ${name}. Your layout stays in the option menu.`, { undo: true }); };
  /** the brief's layout again, here (the hand edits go: one undo brings them back) */
  const regenRef = useRef(regenAsOption); regenRef.current = regenAsOption;
  const ownWas = useRef({ own: ownLayout, opt: p.option });
  useEffect(() => {
    const was = ownWas.current; ownWas.current = { own: ownLayout, opt: p.option };
    if (was.own || !ownLayout || was.opt !== p.option || Date.now() - swappedAt.current < 800 || locked) return;
    toast('This layout is now yours: the Layout settings won’t move it.', { undo: true, act: { label: 'Lay it out again as a new option', run: () => regenRef.current() } });
  }, [ownLayout, p.option]);

  // ---------- the 3D ----------
  const canvas = useRef<HTMLCanvasElement>(null), view = useRef<ProView | null>(null);
  const [xray, setXray] = useState<number | null>(null);
  const [hover, setHover] = useState<Picked | null>(null);
  /** the building under the pointer (select tool): the cursor says it can be picked, and a tag names it until the first pick */
  const [hb, setHb] = useState<{ id: string; x: number; y: number } | null>(null);
  const hbFrame = useRef(0);
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
      view: () => view.current, p: () => pRef.current, e: () => eRef.current, up: (o) => up(o), step: () => (pickedRef.current?.k === 'plot' ? 'site' : stepRef.current),
      picked: () => pickedRef.current, pick: (x) => setPicked(x), done: () => { setToolS(SELECT); ce.setTool(SELECT); }, hint: setHint, readOnly: () => roRef.current, frame: (w) => frameRef.current(w),
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
    // (what the outline hides isn't drawn, so it can't be picked either; the numbers still count it)
    const idx = e.d.buildings.map((_, i) => i).filter((i) => !hidden.has(e.d.buildings[i].b.id)), all = idx.length === e.d.buildings.length;
    view.current?.set({
      r: e.r, d: all ? e.d : { ...e.d, buildings: idx.map((i) => e.d.buildings[i]) }, plans: all ? e.plans : idx.map((i) => e.plans[i]), ds: e.ds, xray: xr, shops: e.shops,
      roads: roadLines(o.ring, o.roads).map((l) => ({ pts: l.pts, today: l.road.today })),
      dsOf: (i) => dsOfBuilding(p, idx[i], e.ds, e.d.buildings[idx[i]]?.b.id), rooms: all ? rooms : idx.map((i) => rooms[i]), roomColor: ROOM_COLOR,
      features: hidden.size ? p.features?.filter((f) => !hidden.has(f.id)) : p.features, levels: p.levels, north: p.north, sel: picked?.k === 'building' ? picked.id : null, forms: e.forms, at: p.at ?? null, city: p.city, cores: xr !== null ? idx.map((i) => buildingCores(e, i)) : undefined,
    });
    edit.current?.draw();
    applySun();
  }, [e, xr, rooms, picked, hidden]);
  useEffect(() => { edit.current?.draw(); }, [step]);
  const applySun = () => {
    const [lat, lon] = CITY_LATLON[p.city] ?? [18.52, 73.86];
    // (the sun's direction turned into the plot's frame, where north is turned by p.north)
    const s = sun.on ? sunDirection(lat, lon, indiaTime(2026, sun.month, 21, sun.hour)) : null, n = ((p.north ?? 0) * Math.PI) / 180;
    view.current?.setSun(s ? [s[0] * Math.cos(n) - s[2] * Math.sin(n), s[1], s[0] * Math.sin(n) + s[2] * Math.cos(n)] : null);
  };
  useEffect(applySun, [sun, p.city, p.north]);
  const cam = (k: CameraView, jump = false) => view.current?.look(k, jump);
  /** frame the whole site once a new plot is drawn or a project opens (at once: nothing to travel from) */
  const fitSoon = () => setTimeout(() => cam('fit', true), 60);
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
        v.look(c, true); v.setSun(dir);
        await new Promise((ok) => setTimeout(ok, 600));
        const blob = await v.renderStill({ width: 1600, height: 1000, quality: 'raster' });
        await fetch(`/__render/shot?set=${set}&name=${c}-${sn}`, { method: 'POST', body: blob });
      }
      v.look('fit', true); v.setSun(null);
      const bench = await v.bench(300);
      await fetch(`/__render/done?set=${set}`, { method: 'POST', body: JSON.stringify({ seconds: Math.round((performance.now() - t0) / 1000), tier: set, bench }) });
    }, 3000);
    return () => clearTimeout(t);
  }, []);
  /** an image of the view at about 1600 px across, to share */
  const shareImage = () => { const v = view.current, c = canvas.current; if (!v || !c) return Promise.reject(new Error('the view isn’t ready')); return v.renderStill({ width: 1600, height: Math.round(1600 / Math.max(0.5, (c.clientWidth || 16) / (c.clientHeight || 9))), quality: 'raster' }); };
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
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); setSearch((v) => !v); return; }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { if (typing(ev.target)) return; ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'd' && picked?.k === 'building' && !locked && !typing(ev.target)) { ev.preventDefault(); const s = own(p, e), src = s.buildings.find((b) => b.id === picked.id); if (!src) return; const c = duplicated(src); tx.once({ scheme: { ...s, buildings: [...s.buildings, c] } }); setPicked({ k: 'building', id: c.id }); return; }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') { if (typing(ev.target)) return; ev.preventDefault(); redo(); return; }
      if (ev.ctrlKey || ev.metaKey || ev.altKey || typing(ev.target)) return;
      if (ev.key === 'Escape') { if (dialog) setDialog(null); else if (cmode) setCmode(false); else if (report && !narrow) setReport(null); else if (picked && tool.k === 'select') setPicked(null); else if (panel && !pinned) setPanel(false); return; }
      // (the picked building: R turns it, + and − its floors, Ctrl+D below)
      const pb = picked?.k === 'building' && !locked ? picked : null;
      if (pb && (ev.key === 'r' || ev.key === 'R')) { const s = own(p, e); tx.once({ scheme: { ...s, buildings: s.buildings.map((b) => (b.id === pb.id ? turned(b, ev.shiftKey ? -15 : 15) : b)) } }); return; }
      if (pb && (ev.key === '+' || ev.key === '=' || ev.key === '-')) { const s = own(p, e), br = e.d.buildings.find((x) => x.b.id === pb.id); if (!br) return; tx.once({ scheme: { ...s, buildings: s.buildings.map((b) => (b.id === pb.id ? withFloors(b, Math.max(1, br.floors + (ev.key === '-' ? -1 : 1))) : b)) } }); return; }
      const i = '1234'.indexOf(ev.key);
      if (!narrow && (ev.key === 'n' || ev.key === 'a')) { const k: ReportKind = ev.key === 'n' ? 'numbers' : 'approve'; if (report === k) setReport(null); else go(k); return; }
      if (!narrow && ev.key === '1') { if (inspOn && !picked) setProjOpen(false); else go('design'); return; }
      if (i >= 0 && STEPS[i]) { go(STEPS[i].key); return; }
      if (ev.key === 'x') setXray((v) => (v === null ? Math.max(1, Math.round(maxFloor / 2)) : null));
      if (ev.key === ']' ) setXray((v) => (v === null ? null : Math.min(maxFloor, v + 1)));
      if (ev.key === '[') setXray((v) => (v === null ? null : Math.max(1, v - 1)));
      if (ev.key === 'f') frameIt(picked);
      if (ev.key === 't') cam('top');
      if (ev.key === 'p') setPlan(!plan);
      if (ev.key === 'v') setTool(SELECT);
      if (ev.key === 'm' && !locked) setTool(tool.k === 'measure' ? SELECT : { k: 'measure' });
      if (ev.key === 's') cam('street');
      if (ev.key === '|' || (ev.key === '\\' && ev.shiftKey)) { setFocus(!focus); toast(focus ? 'Focus mode off.' : 'Focus mode: the sheet and the outline are away. Shift+\\ brings them back.'); return; }
      if (ev.key === '\\') setPanel((v) => !v);
      if (ev.key === 'o' && !phone) setOlOpen(!olOpen);
      if (ev.key === 'c' && noteStore) setCmode(!cmode);
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
      deal: (q?: ProProject) => { const x = evaluate(q ?? pRef.current); return applyDeal(x, x.p.deal ?? DEFAULT_DEAL); },
      /** the ground round a place, off the city's terrain */
      ground: (lat: number, lon: number, r?: number) => groundAt(lat, lon, r),
    };
  }, []);

  // ---------- outputs: one place (Share), the long ones as a job by the save state ----------
  const [pdf, setPdf] = useState(false);
  const makePdf = async () => {
    if (pdf) return;
    setPdf(true);
    try { await downloadSet({ e: eS, checks, rooms }, `${slug(p.name)}-drawings`); toast('Drawings saved as a PDF.'); }
    catch (err) { console.error(err); toast('Couldn’t make the PDF. Open the drawing set and print it instead.'); }
    finally { setPdf(false); }
  };
  const saveModel = (kind: 'json' | 'ifc') => {
    if (kind === 'json') { download(`${slug(p.name)}.model.json`, modelJson(buildModel(eS, rooms)), 'application/json'); toast('Model saved as JSON.'); }
    else { download(`${slug(p.name)}.ifc`, ifcLite(eS, rooms), 'application/x-step'); toast('IFC saved: open it in Revit, ArchiCAD or BIMvision.'); }
  };
  const team = authReady && !!user && !!ref && !readOnly && !phone;
  const shareItems: MenuItem[] = [
    { heading: 'Send' },
    { label: 'A link to it…', icon: 'link', sub: 'People on the project, or anyone with the link', onSelect: () => setDialog('share') },
    ...(team ? [{ label: 'People…', icon: 'team', sub: 'Who can edit it, who can view and comment', onSelect: () => setDialog('people') }] : []),
    { heading: 'Images' },
    { label: 'Image of the view', icon: 'camera', sub: 'A few seconds', disabled: !!still, onSelect: () => void renderImage('raster') },
    { label: 'Path-traced image', icon: 'spark', sub: 'About a minute', disabled: !!still, onSelect: () => void renderImage('path') },
    { heading: 'Drawings' },
    { label: 'Drawing set', icon: 'print', sub: 'Open it, print it', onSelect: () => setDialog('drawings') },
    { label: 'Drawings as a PDF', icon: 'down', sub: 'A3 sheets', disabled: pdf, onSelect: () => void makePdf() },
    { label: 'Area statement', icon: 'book', onSelect: () => setDialog('area') },
    { heading: 'Model files' },
    { label: 'Model as JSON', icon: 'down', sub: 'For scripts', onSelect: () => saveModel('json') },
    { label: 'IFC (spaces)', icon: 'down', sub: 'For Revit, ArchiCAD and other BIM tools', onSelect: () => saveModel('ifc') },
  ];
  // ---------- options: switch, duplicate, rename, delete, compare, choose ----------
  // (the scorecard's "vs": each figure against a base option, the chosen one, else the first other one)
  const [vsOn, setVsOn] = useState(false);
  const vsBase = optionsOf(p).length > 1 ? (optionsOf(p).find((o) => o.id === p.chosen && o.id !== p.option) ?? optionsOf(p).find((o) => o.id !== p.option) ?? null) : null;
  const vsFig = useMemo(() => {
    if (!vsOn || !vsBase) return null;
    const x = evaluate(asOption(p, vsBase.id)), dl = applyDeal(x, x.p.deal ?? DEFAULT_DEAL);
    return { name: vsBase.name, bua: x.d.bua, flats: x.d.flats, profit: dl.profit, irr: dl.irr ?? 0 };
  }, [vsOn, vsBase?.id, p]);
  const openOption = (id: string) => { if (id === p.option) return; up(switchTo(p, id)); setPicked(null); toast(`Opened ${optionsOf(p).find((o) => o.id === id)?.name ?? 'the option'}.`); };
  const optionActs = {
    open: openOption,
    duplicate: () => { const c = duplicatedOption(p); up(c); setPicked(null); toast(`Made ${optionsOf({ ...p, ...c }).find((o) => o.id === c.option)?.name}, a copy, and opened it.`); },
    rename: () => { const o = currentOption(p); const n = prompt('Name this option', o?.name ?? 'Option A'); if (n) up(renamed(p, o?.id ?? null, n)); },
    remove: () => { const o = currentOption(p); if (!o) return; const c = removedOption(p, o.id); if (!c) return; up(c); setPicked(null); toast(`Deleted ${o.name} · Ctrl+Z to undo`); },
    compare: () => setDialog('compare'),
    choose: (id: string) => { up({ chosen: id }); toast(`${optionsOf(p).find((o) => o.id === id)?.name} is the one chosen to take forward.`); },
  };
  /** everything search reaches: actions, the buildings, every setting */
  const commands = (): { all: Cmd[]; first: Cmd[] } => {
    const A = (label: string, icon: string, run: () => void, o: Partial<Cmd> = {}): Cmd => ({ label, icon, kind: 'Action', run, ...o });
    const steps = STEPS.map((x, i) => A(`Go to ${x.title}`, x.icon, () => go(x.key), { keys: String(i + 1), words: `${x.label} step ${x.sub}` }));
    const buildings = e.d.buildings.map((b, i): Cmd => ({ label: buildingName(p, e, i), icon: 'building', kind: 'Building', sub: `${b.floors} floors · ${nf(b.height)} m`, words: 'building tower block', run: () => showBuilding(b.b.id) }));
    const view: Cmd[] = [
      A(plan ? 'See it in 3D' : 'See the plan from above', plan ? 'cube' : 'plan', () => setPlan(!plan), { kind: 'View', keys: 'P', words: 'plan 3d camera' }),
      A('Frame what’s picked', 'fit', () => frameIt(picked), { kind: 'View', keys: 'F', sub: 'Nothing picked: the whole site', words: 'frame zoom focus selection camera fit' }),
      A('Whole site', 'fit', () => cam('fit'), { kind: 'View', words: 'fit zoom camera' }),
      A('From the street', 'street', () => cam('street'), { kind: 'View', keys: 'S', words: 'camera eye level' }),
      A('From above', 'top', () => cam('top'), { kind: 'View', keys: 'T', words: 'camera top' }),
      A(xr === null ? 'X-ray a floor' : 'Stop the X-ray', 'layers', () => setXray(xr === null ? Math.max(1, Math.round(maxFloor / 2)) : null), { kind: 'View', keys: 'X', words: 'floor plan section inside' }),
      A(mode === 'wire' ? 'Shaded view' : 'Wireframe view', mode === 'wire' ? 'shade' : 'wire', () => setMode(mode === 'wire' ? 'shaded' : 'wire'), { kind: 'View', words: 'render materials wireframe shaded' }),
      A(sun.on ? 'Sun off' : 'Sun and shadows', 'sun', () => { if (!sun.on && mode === 'wire') setMode('shaded'); setSun({ ...sun, on: !sun.on }); }, { kind: 'View', words: 'shadow daylight time' }),
      A(panel ? 'Hide the sheet' : 'Show the sheet', 'panel', () => setPanel(!panel), { kind: 'View', keys: '\\' }),
      A(pinned ? 'Float the sheet' : 'Pin the sheet beside the view', 'panel', () => { setPinned(!pinned); setPanel(true); }, { kind: 'View', keys: '/' }),
    ];
    const share: Cmd[] = shareItems.flatMap((x) => ('label' in x && !x.disabled ? [{ label: x.label.replace('…', ''), icon: x.icon ?? 'share', kind: 'Share' as const, sub: x.sub, words: 'share export download send', run: x.onSelect ?? (() => {}) }] : []));
    const project: Cmd[] = [
      ...(!locked ? [A('Undo', 'undo', undo, { keys: 'Ctrl Z' }), A('Redo', 'redo', redo, { keys: 'Ctrl Shift Z' })] : []),
      ...(!locked ? [A('Rename the project', 'edit', () => (document.querySelector('.pname input') as HTMLInputElement | null)?.select(), { kind: 'Project', words: 'name title' })] : []),
      ...(!phone ? [A('New project', 'plus', () => fresh(), { kind: 'Project', words: 'start blank' })] : []),
      ...(!locked && !phone ? [A('Duplicate this option', 'copy', optionActs.duplicate, { kind: 'Project', words: 'option variant alternative copy scheme' })] : []),
      ...(optionsOf(p).length > 1 ? [A('Compare options', 'layers', optionActs.compare, { kind: 'Project', words: 'compare options side by side' }), ...optionsOf(p).filter((o) => o.id !== p.option).map((o) => A(`Open ${o.name}`, 'layers', () => optionActs.open(o.id), { kind: 'Project', words: 'option switch' }))] : []),
      A('Your dashboard', 'folder', () => location.assign(`${BASE}dashboard/`), { kind: 'Project', words: 'projects all list home' }),
      A('Keyboard shortcuts', 'key', () => setDialog('keys'), { keys: '?' }),
      ...(!phone ? [A('The simple editor', 'site', () => location.assign(`${BASE}app/`), { words: 'map editor city' })] : []),
    ];
    const settings: Cmd[] = phone ? [] : FINDABLE.map((f) => {
      const look = f.step === 'look', st = STEPS.find((x) => x.key === (look || f.step === 'brief' ? 'design' : f.step))!, where = look ? `${st.label} › Look` : st.label;
      return { label: f.label, icon: f.field ? 'edit' : st.icon, kind: 'Setting', sub: f.field ? `${where} › ${f.sec}` : where, words: f.words, run: () => { go(st.key); if (look) setDialog('look'); findIn(f.sec, f.field); } };
    });
    const all = [...steps, ...buildings, A('The plot', 'site', () => { go('design'); setPicked({ k: 'plot' }); }, { kind: 'Building', words: 'plot site land boundary corners' }), ...view, ...share, ...project, ...settings];
    const first = [...buildings.slice(0, 3), ...share.filter((x) => /link|Area statement|Drawing set$/.test(x.label)), ...steps];
    return { all, first };
  };

  /** pick a building and bring it into the middle of the view (a check's Show); on a phone the sheet lowers to a peek */
  const showBuilding = (id: string) => {
    const br = e.d.buildings.find((b) => b.b.id === id); if (!br) return;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const q of br.quads) for (let i = 0; i + 1 < q.length; i += 2) { x0 = Math.min(x0, q[i]); x1 = Math.max(x1, q[i]); z0 = Math.min(z0, q[i + 1]); z1 = Math.max(z1, q[i + 1]); }
    setToolS(SELECT); edit.current?.setTool(SELECT);
    setPicked({ k: 'building', id });
    if (narrow) setDetent('peek');
    if (Number.isFinite(x0)) view.current?.focus((x0 + x1) / 2, (z0 + z1) / 2, Math.max(x1 - x0, z1 - z0), br.height);
  };
  useEffect(() => { if (phone && picked?.k === 'building') { setPanel(true); setDetent('peek'); } }, [phone, picked?.k === 'building' ? picked.id : null]);
  /** the plot's editor is on: picked, or on the Site step with nothing else picked */
  const plotOn = picked?.k === 'plot';
  // (once, for someone who knew the six steps)
  useEffect(() => { if (oldStep.current) { toast('Brief and Design are now one: the project, on the view’s right whenever nothing is picked. Numbers and Approval are where they were.'); store.set('urbanplan:pro:step', step); } }, []);
  // the inspector on the view's right: what's picked, on a wide screen; hidden by its ×, back with Inspect or a new pick
  const [insp, setInsp] = useState(true);
  const pickKey = picked ? `${picked.k}:${'id' in picked ? picked.id : ''}` : '';
  useEffect(() => { if (pickKey) setInsp(true); }, [pickKey]);
  /** the project's panel (nothing picked): closed until asked for, then remembered */
  const [projOpen, setProjOpenS] = useState<boolean>(() => store.get<boolean>('urbanplan:pro:project-open', false));
  const setProjOpen = (v: boolean) => { setProjOpenS(v); store.set('urbanplan:pro:project-open', v); };
  setProjOpenRef.current = setProjOpen;
  const inspOn = !narrow && !phone && tool.k === 'select' && !cmode && (picked ? insp : projOpen && !p.blank);
  const listOn = cmode && !!noteStore && !narrow;
  const covR = inspOn || listOn ? 344 : 0;
  /** the outline: docked right of the sheet, and the view keeps clear of it */
  const olOn = olOpen && !focus && !phone && !narrow;
  const olW = olOn ? 248 : 0;
  const repOn = report && !narrow && !phone ? repH : 0;
  useEffect(() => {
    const v = view.current; if (!v) return;
    v.setCover(cov[0] + olW, cov[1] + repOn, covR);
    const q = boxOf(picked); if (q) v.reveal(q.x0, q.z0, q.x1, q.z1, q.h);
  }, [covR, olW, cov[0], cov[1], repOn]);
  // (an option opened or made that leaves buildings out of the view says so, and doesn't fly there)
  const optSeen = useRef(p.option);
  useEffect(() => {
    const was = optSeen.current;
    if (was === p.option) return;
    optSeen.current = p.option;
    // (only a switch between this project's options: not a project opening)
    if (!was || !optionsOf(p).some((o) => o.id === was)) return;
    const v = view.current; if (!v) return;
    const n = v.outside(e.d.buildings.map((b) => boxOf({ k: 'building', id: b.b.id })).filter((q): q is Box => !!q));
    if (!n) return;
    const note = `${n === 1 ? 'A building is' : `${n} buildings are`} outside the view.`, fit = { label: 'Whole site', run: () => cam('fit') };
    setToastMsg((m) => (m ? { ...m, s: `${m.s} ${note}`, act: m.act ?? fit } : { s: note, act: fit }));
    clearTimeout(toastT.current); toastT.current = window.setTimeout(() => setToastMsg(null), 6000);
  }, [p.option]);
  useEffect(() => { if (step === 'numbers') tick('numbers'); }, [step]);
  const openWay = (w: 'survey' | 'import') => { try { sessionStorage.setItem('urbanplan:pro:way', w); } catch { /* */ } go('design'); setTimeout(() => { dispatchEvent(new CustomEvent('urbanplan:way', { detail: w })); findIn('Plot'); }, 40); };
  /** what's picked as a box on the ground and a height, to frame it (null: the plot or nothing) */
  const boxOf = (w: EditPicked): Box | null => {
    let pts: number[] = [], h = 6;
    if (w?.k === 'building') { const br = e.d.buildings.find((b) => b.b.id === w.id); if (!br) return null; pts = br.quads.flat(); h = br.height; }
    else if (w?.k === 'element') { const x = (e.d.site.elements ?? []).find((q) => q.id === w.id) as { ring?: number[]; quads?: number[][] } | undefined; pts = x?.ring ?? x?.quads?.flat() ?? []; }
    else if (w?.k === 'feature') pts = (p.features?.find((f) => f.id === w.id) as { pts?: number[] } | undefined)?.pts ?? [];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i + 1 < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); z0 = Math.min(z0, pts[i + 1]); z1 = Math.max(z1, pts[i + 1]); }
    return Number.isFinite(x0) ? { x0, z0, x1, z1, h } : null;
  };
  /** F, a double-click: frame what's picked (or this), else the whole site */
  const frameIt = (w: EditPicked) => { const q = boxOf(w); if (q) view.current?.focus((q.x0 + q.x1) / 2, (q.z0 + q.z1) / 2, Math.max(8, q.x1 - q.x0, q.z1 - q.z0), q.h); else cam('fit'); };
  frameRef.current = frameIt;
  const frameRing = (ring: number[]) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (let i = 0; i + 1 < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); } if (Number.isFinite(x0)) view.current?.focus((x0 + x1) / 2, (z0 + z1) / 2, Math.max(8, x1 - x0, z1 - z0), 6); };
  const reorder = locked ? null : (from: number, to: number) => { const s = own(p, e), id = e.d.buildings[from]?.b.id, bs = [...s.buildings], i = bs.findIndex((b) => b.id === id), j = bs.findIndex((b) => b.id === e.d.buildings[to]?.b.id); if (i < 0 || j < 0) return; const [b] = bs.splice(i, 1); bs.splice(j, 0, b); tx.once({ scheme: { ...s, buildings: bs } }); toast('Moved: the letters follow the new order.', { undo: true }); };
  const openThread = (id: Note['id']) => { const t = noteThreads.find((x) => x.root.id === id); setOpenNote(id); const a = t?.root.anchor; if (a?.obj?.k === 'building' && a.obj.id && e.d.buildings.some((b) => b.b.id === a.obj!.id)) { const br = e.d.buildings.find((b) => b.b.id === a.obj!.id)!; let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const q of br.quads) for (let k = 0; k + 1 < q.length; k += 2) { x0 = Math.min(x0, q[k]); x1 = Math.max(x1, q[k]); z0 = Math.min(z0, q[k + 1]); z1 = Math.max(z1, q[k + 1]); } if (Number.isFinite(x0)) view.current?.focus((x0 + x1) / 2, (z0 + z1) / 2, Math.max(x1 - x0, z1 - z0), br.height); } else if (a?.at) view.current?.focus(a.at[0], a.at[2], 30, 6); };
  const cur = STEPS.find((s) => s.key === step)!;
  const props: StepProps = { p, e, up, rooms, checks, deal, go, openDrawings: () => setDialog('drawings'), openStatement: () => setDialog('area'), openLook: () => setDialog('look'), toast, tool, setTool, picked, pick: setPicked, show: showBuilding };
  const Body = { brief: ProjectBody, design: ProjectBody, numbers: NumbersPlace, approve: ApproveStep }[step];

  return (
    <div class={`pro${panel && pinned && !narrow ? ' docked' : ''}${locked ? ' ro' : ''}${!narrow && !phone ? ' norail' : ''}`} style={`--cover:${cov[0] + olW}px;--cover-s:${cov[0]}px;--cover-b:${cov[1] + repOn}px;--cover-r:${covR}px`}>
      <header class="top">
        <a class="logo" href={`${BASE}dashboard/`} aria-label="Your dashboard"><Dither field="mark" cell={2} class="mark" />UrbanPlan</a>
        <b class="chip">Pro</b>
        <label class="pname"><input value={p.name} aria-label="Project name" readOnly={locked} onChange={(ev) => up({ name: (ev.target as HTMLInputElement).value.trim() || 'Untitled project' })} /><Icon n="edit" size={14} /></label>
        <ProjectMenu user={!!user} current={ref?.id ?? null} open={(id) => void openId(id)} fresh={phone ? undefined : () => fresh()} />
        {!phone && <OptionMenu p={p} acts={locked ? null : optionActs} />}
        <SaveState cloud={cloud} user={!!user} readOnly={readOnly} />
        {(still || pdf) && <span class="job" role="status">{still ? <>{still.kind === 'path' ? 'Path tracing' : 'Rendering'} {Math.round(still.f * 100)}%<i class="bar"><i style={`width:${Math.round(still.f * 100)}%`} /></i>{still.kind === 'path' && <button type="button" class="linkbtn" onClick={() => still.stop.abort()}>Cancel</button>}</> : <>Making the PDF…<Dither class="dz" cell={2} /></>}</span>}
        <span class="gap" />
        {!phone && !narrow && <Btn kind={inspOn && !picked ? 'primary' : 'quiet'} icon="building" title="The project’s settings: the site, what you’re building, the look (1)" onClick={() => { if (inspOn && !picked) setProjOpen(false); else go('design'); }}>Project</Btn>}
        {!phone && <button type="button" class="btn quiet find" onClick={() => setSearch(true)} aria-keyshortcuts="Control+K"><Icon n="cursor" size={15} /><span>Search</span><kbd>Ctrl K</kbd></button>}
        {!locked && <span class="hist">
          <Btn kind="quiet" icon="undo" title="Undo (Ctrl+Z)" onClick={undo} disabled={!past.current.length} />
          <Btn kind="quiet" icon="redo" title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!future.current.length} />
        </span>}
        {noteStore && !phone && <span class={`cbtn${cmode ? ' on' : ''}`}><Btn kind={cmode ? 'primary' : 'quiet'} icon="chat" title={cmode ? 'Stop commenting (Esc)' : 'Comment on the view (C)'} onClick={() => setCmode(!cmode)}>{openNotes ? `Comment · ${openNotes}` : 'Comment'}</Btn></span>}
        {readOnly && !phone
          ? <Btn kind="primary" icon="check" onClick={keepCopy}>Make it my copy</Btn>
          : phone ? <Btn icon="share" onClick={() => goView('share')}>Share</Btn> : <Menu text label="Share" icon="share" items={shareItems} onOpen={() => tick('share')} />}
        {authReady && session.value === null && <Btn icon="user" href={`${BASE}login/?next=${encodeURIComponent(location.pathname + location.search)}`} title="Keep your projects in your account">Sign in</Btn>}
        <Account email={user?.email ?? null} phone={phone} search={() => setSearch(true)} keys={() => setDialog('keys')} />
      </header>

      {(narrow || phone) && <nav class="rail" aria-label="Steps">
        {phone && VIEW_STEPS.map((s) => (
          <button type="button" class="step" aria-current={vstep === s.key && !(picked?.k === 'building') ? 'step' : undefined} aria-expanded={vstep === s.key ? panel : undefined} onClick={() => { if (vstep !== s.key || picked) goView(s.key); else if (panel) setPanel(false); else openSheet(); }}>
            <Icon n={s.icon} size={20} />
            <span>{s.label}</span>
            {s.key === 'rules' && sum.fail + sum.warn > 0 && <i class={`dot ${sum.fail ? 'bad' : 'warn'}`} />}
          </button>
        ))}
        {!phone && STEPS.map((s, i) => (
          <button type="button" class="step" aria-current={(s.key === 'design' && !narrow ? inspOn && !picked : step === s.key && panel) ? 'step' : undefined} aria-expanded={s.key === 'design' && !narrow ? inspOn && !picked : step === s.key ? panel : undefined} onClick={() => { if (s.key === 'design' && !narrow) { if (inspOn && !picked) setProjOpen(false); else go('design'); } else if (step !== s.key) go(s.key); else if (panel) setPanel(false); else openSheet(); }} data-tip={`${s.title} (${i + 1})`} data-tip-side="right">
            <Icon n={s.icon} size={20} />
            <span>{s.label}</span>
            {s.key === 'approve' && sum.fail + sum.warn > 0 && <i class={`dot ${sum.fail ? 'bad' : 'warn'}`} />}
          </button>
        ))}
        <span class="gap" />
        {!phone && !narrow && <button type="button" class="step small" onClick={() => setOlOpen(!olOpen)} aria-label="Show or hide the outline" aria-pressed={olOn} data-tip="The outline: what's in the project (O)" data-tip-side="right"><Icon n="list" size={18} /></button>}
        <button type="button" class="step small" onClick={() => setPanel(!panel)} aria-label="Show or hide the sheet" aria-expanded={panel} data-tip="Show or hide the sheet (\) · pin it beside the view (/)" data-tip-side="right"><Icon n="panel" size={18} /></button>
      </nav>}

      {phone && <Sheet title={picked?.k === 'building' ? buildingName(p, e, e.d.buildings.findIndex((b) => b.b.id === picked.id)) : VIEW_STEPS.find((v) => v.key === vstep)!.title} open={panel} pinned={false} setPinned={() => {}} close={() => { setPanel(false); setPicked(null); }} phone={narrow} detent={detent} setDetent={setDetent} cover={cover}>
        <div class="panel-b" key={picked?.k === 'building' ? picked.id : vstep}>
          {picked?.k === 'building'
            ? <BuildingInfo p={p} e={e} id={picked.id} checks={checks} xray={(f) => { setXray(f); setDetent('peek'); }} />
            : vstep === 'overview' ? <><p class="note">On a phone you can look round your projects and share them. Change them on a computer.</p><Overview p={p} e={e} /></>
            : vstep === 'money' ? <MoneyView e={e} deal={deal} />
            : vstep === 'rules' ? <RulesView e={e} checks={checks} show={showBuilding} />
            : <ShareBody name={p.name} load={() => Promise.resolve(p)} id={readOnly ? null : ref?.id} team={!!ref && ref.role !== 'viewer'} image={shareImage} phone toast={toast}>
                <PdfButton p={p} e={e} checks={checks} rooms={rooms} toast={toast} big />
              </ShareBody>}
        </div>
      </Sheet>}
      {!phone && <Sheet title={cur.title} open={panel && (step !== 'design' || narrow)} pinned={pinned} setPinned={setPinned} close={() => setPanel(false)} phone={narrow} detent={detent} setDetent={setDetent} cover={cover}
        >
        <div class="panel-b" key={step}>
          {authReady && session.value === null && new URLSearchParams(location.search).has('p') && <p class="note">A project shared with you. <a href={`${BASE}login/?next=${encodeURIComponent(location.pathname + location.search)}`}>Sign in</a> with the email it was shared to and it opens here.</p>}
          {viewer && !readOnly && <p class="note">Shared with you to view and comment. <button type="button" class="linkbtn" onClick={() => setCmode(true)}>Comment</button></p>}
          {readOnly && !phone && <p class="note">A shared scheme, view only. <button type="button" class="linkbtn" onClick={keepCopy}>Make it your own copy</button> to change it.</p>}
          <fieldset disabled={locked}><Body {...props} /></fieldset>
        </div>
      </Sheet>}

      <main class="stage">
        <canvas ref={canvas} onPointerMove={(ev) => {
          setHover(view.current?.pick(ev.clientX, ev.clientY) ?? null);
          if (tool.k !== 'select' || cmode || ev.buttons) return;
          const cx = ev.clientX, cy = ev.clientY, el = ev.currentTarget as HTMLCanvasElement;
          cancelAnimationFrame(hbFrame.current);
          hbFrame.current = requestAnimationFrame(() => {
            const id = view.current?.buildingHit(cx, cy)?.id ?? null, r = el.getBoundingClientRect(), mine = picked?.k === 'building' && picked.id === id;
            el.style.cursor = id ? (mine && !locked ? 'move' : 'pointer') : '';
            setHb(id && !mine ? { id, x: cx - r.left, y: cy - r.top } : null);
          });
        }} onPointerLeave={() => { setHover(null); setHb(null); cancelAnimationFrame(hbFrame.current); }} />
        <ResultBar e={e} deal={deal} sum={sum} go={(s) => { if (!narrow && (s === 'numbers' || s === 'approve') && report === s) setReport(null); else go(s); }} statement={() => { if (narrow) { setDialog('area'); return; } if (report === 'numbers') { setReport(null); return; } go('numbers'); findIn('Area statement'); }} vs={vsBase ? { on: vsOn, set: setVsOn, name: vsBase.name, fig: vsFig } : null} />
        {!locked && <Shelf tool={tool} setTool={setTool} outline={!narrow && !phone ? { on: olOn, toggle: () => setOlOpen(!olOpen) } : undefined} hint={hint ? <div class="drawhint" role="status"><span>{hint}</span><button type="button" class="linkbtn" onClick={() => setTool(SELECT)}>Done</button></div> : null} />}
        {olOn && <Outline p={p} e={e} checks={checks} picked={picked} pick={(x) => { setToolS(SELECT); edit.current?.setTool(SELECT); setPicked(x); }} show={showBuilding} frame={frameRing} hidden={hidden} locked={lockedIds} toggle={toggleOl} reorder={reorder} notes={countsByThing(noteThreads)} close={() => setOlOpen(false)} />}
        {p.blank && !locked && tool.k === 'select' && !cmode && <EmptyState p={p} ways={{
          find: () => { up({ blank: undefined }); openWay('survey'); },
          draw: () => { up({ blank: undefined }); setTool({ k: 'plot' }); },
          importIt: () => { up({ blank: undefined }); openWay('import'); },
          size: (x) => { up({ ...x, shape: 'rect', corner: false, blank: undefined }); fitSoon(); toast(`The plot: ${x.width} × ${x.depth} m on a ${x.road} m road. Add a building from the toolbar, or pick the plot to change it.`); },
          skip: () => up({ blank: undefined }),
        }} />}
        <div class="readout" ref={readout} hidden aria-live="polite"><b /><span /></div>
        {tool.k === 'select' && plotOn && <PlotHud view={view.current} edit={edit.current} p={p} e={e} picked={picked} pick={setPicked} tx={tx} snap={snap} live={mode === 'wire' && xr === null} readOnly={locked} toast={toast} setTool={setTool}
          openWay={openWay} northFree={northFree} setNorthFree={setNorthFree} />}
        {tool.k === 'select' && (picked?.k === 'element' || picked?.k === 'feature') && <ObjectHud view={view.current} edit={edit.current} p={p} e={e} picked={picked} pick={setPicked} tx={tx} snap={snap} readOnly={locked} toast={toast} />}
        {tool.k === 'select' && picked?.k === 'building' && <FormHud view={view.current} edit={edit.current} p={p} e={e} picked={picked} tx={tx} live={mode === 'wire' && xr === null} readOnly={locked} xray={xr} setXray={setXray} toast={toast} />}
        {tool.k === 'select' && picked?.k === 'building' && <Hud view={view.current} p={p} e={e} picked={picked} pick={setPicked} up={up} tx={tx} snap={snap} live={mode === 'wire' && xr === null} readOnly={locked} toast={toast}
          inspect={() => setInsp(true)} inspecting={inspOn} />}
        {listOn && <CommentList notes={N.notes} err={N.err} where={noteStore!.where} open={(t) => openThread(t.root.id)} close={() => setCmode(false)} showDone={showDone} setShowDone={setShowDone} offNote={anchorsOff ? 'Comments are being saved without their pins: the site’s owner turns pins on by running supabase/migrations/0007_comment_anchors.sql once.' : undefined} />}
        {noteStore && N.notes && xr === null && <CommentLayer view={view.current} e={e} notes={N.notes} mode={cmode} setMode={setCmode} openId={openNote} setOpenId={setOpenNote} option={p.option}
          add={(body, anchor) => void N.run(() => noteStore.add(body, step, anchor))} resolve={(n, v) => void N.run(() => noteStore.resolve(n.id, v))} remove={(n) => void N.run(() => noteStore.remove(n.id))}
          canResolve={canResolve} canDelete={(n) => mineNote(n) || ref?.role === 'owner' || !ref} />}
        {inspOn && !picked && <InspFrame hide={() => setProjOpen(false)} title={<b>{p.name}</b>} meta={<>{nf(e.r.area)} m² · {CITIES.find((c) => c.value === p.city)?.label ?? p.city}</>}>
          <fieldset disabled={locked}><ProjectBody {...props} /></fieldset>
        </InspFrame>}
        {inspOn && picked && <Inspector p={p} e={e} up={up} rooms={rooms} checks={checks} picked={picked} pick={setPicked} toast={toast} xray={setXray} hide={() => setInsp(false)} readOnly={locked} />}
        {(report === 'approve' || (narrow && panel && step === 'approve')) && !phone && tool.k === 'select' && xr === null && <CheckPins view={view.current} e={e} checks={checks} show={showBuilding} />}
        {report && !narrow && !phone && <Report which={report} set={setReport} close={() => setReport(null)} cover={setRepH} fails={sum.fail + sum.warn}>
          <fieldset disabled={locked}>{report === 'numbers' ? <NumbersPlace {...props} /> : <ApproveStep {...props} />}</fieldset>
        </Report>}
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
            <button type="button" aria-label="Whole site" data-tip="Whole site (F with nothing picked)" onClick={() => cam('fit')}><Icon n="fit" size={16} /></button>
            {/* (the rest behind one click: they're used now and then, not all the time) */}
            <Menu label="More view tools" class="tmore" items={[
              { heading: 'Look from' },
              { label: 'The street', icon: 'street', sub: 'S', onSelect: () => cam('street') },
              { label: 'Above', icon: 'top', sub: 'T', onSelect: () => cam('top') },
              { heading: 'Show' },
              { label: 'X-ray, a floor at a time', checked: xr !== null, sub: 'X', onSelect: () => setXray(xr === null ? Math.max(1, Math.round(maxFloor / 2)) : null) },
              ...(!locked ? [{ label: 'Snapping', checked: snap, sub: snap ? 'Hold Alt to move freely' : 'Off', onSelect: () => setSnap(!snap) }] : []),
            ]} />
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
          </div>
          {(() => {
            // the compass: a click shows the plan from above; with the plot picked it's a dial: drag it (or the arrow keys)
            // to turn north, in 5° steps (unless the plot's place set it and it's locked)
            const turnable = plotOn && !locked && (!p.at || northFree);
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
          {!phone && <HelpCorner p={p} keys={() => setDialog('keys')} search={() => setSearch(true)} act={doTask} />}
        </div>
        {xr !== null && <div class="legend floating">{[0, 1, 2].map((t) => <span><i style={`background:${UNIT_COLOR[t]}`} />{UNIT_LABEL[t]}</span>)}{(['living', 'bed', 'kitchen', 'toilet'] as const).map((k) => <span><i style={`background:${ROOM_COLOR[k]}`} />{k === 'bed' ? 'bedroom' : k}</span>)}</div>}
        {hb && !hover && !ticked('picked') && (() => { const i = e.d.buildings.findIndex((b) => b.b.id === hb.id); return i >= 0 && <div class="tip htag" style={`left:${hb.x + 14}px;top:${hb.y + 14}px`}><b>{buildingName(p, e, i)}</b><span>Click to pick it, then drag</span></div>; })()}
        {firstPick && <div class="pickhint" role="status"><Icon n="cursor" size={15} /><span>Drag the arrow on top for floors, the middle to move it, the side handles for its size. Or type in the inspector.</span><button type="button" class="linkbtn" onClick={() => { tick('pickhint'); setFirstPick(false); }}>Got it</button></div>}
        {hover && <div class="tip" style={`left:${hover.x + 14}px;top:${hover.y + 14}px`}><b>{hover.label}</b><span>{hover.size}</span><span>Floor {hover.floor}</span></div>}
      </main>

      {toastMsg && <div class="toast" role="status">{toastMsg.s}{toastMsg.undo && <button type="button" class="linkbtn" onClick={() => { undo(); setToastMsg(null); }}>Undo</button>}{toastMsg.act && <button type="button" class="linkbtn" onClick={() => { toastMsg.act!.run(); setToastMsg(null); }}>{toastMsg.act.label}</button>}</div>}
      <TooltipLayer />
      {search && (() => { const c = commands(); return <Search cmds={c.all} first={c.first} close={() => setSearch(false)} />; })()}
      {dialog === 'people' && user && ref && <People pid={ref.id} role={ref.role ?? 'owner'} close={() => setDialog(null)} />}
      {dialog === 'share' && <Dialog title="Share this scheme" close={() => setDialog(null)}><ShareBody name={p.name} load={() => Promise.resolve(p)} id={readOnly ? null : ref?.id} team={!!ref && ref.role !== 'viewer'} image={shareImage} toast={toast} done={() => setDialog(null)} /></Dialog>}
      {dialog === 'keys' && <Keys close={() => setDialog(null)} />}
      {dialog === 'compare' && <Compare p={p} close={() => setDialog(null)} go={optionActs.open} choose={locked ? undefined : optionActs.choose} />}
      {dialog === 'look' && <Dialog title={`Look · ${e.ds.name}`} close={() => setDialog(null)} wide><fieldset class="look-b" disabled={locked}><DesignSystemStep {...props} /></fieldset></Dialog>}
      {dialog === 'area' && <Dialog title="Area statement" close={() => setDialog(null)} wide><AreaStatementBody e={e} show={(bi) => { const id = e.d.buildings[bi]?.b.id; if (id) { setDialog(null); showBuilding(id); } }} print={phone ? undefined : () => setDialog('drawings')} /></Dialog>}
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
type VsFig = { name: string; bua: number; flats: number; profit: number; irr: number };
function ResultBar({ e, deal, sum, go, statement, vs }: { e: ReturnType<typeof evaluate>; deal: ReturnType<typeof applyDeal>; sum: ReturnType<typeof scrutinySummary>; go: (s: Step) => void; statement: () => void; vs: null | { on: boolean; set: (on: boolean) => void; name: string; fig: VsFig | null } }) {
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
  // (with "vs" on, a figure's second line is its difference from the base option)
  const V = (x: keyof VsFig & keyof typeof k, fmt: (v: number) => string, el: preact.ComponentChildren) => {
    const f = vs?.on ? vs.fig : null; if (!f) return el;
    const dv = k[x] - f[x];
    return <small class="vs">{Math.abs(dv) < 1e-6 ? 'same as' : `${dv > 0 ? '+' : '−'}${fmt(Math.abs(dv))} vs`} {f.name}</small>;
  };
  const vsBtn = vs && <button type="button" class="kpi vs-t" aria-pressed={vs.on} onClick={() => vs.set(!vs.on)} title={`Each figure against ${vs.name}`}><span>vs</span><b>{vs.name}</b><small>{vs.on ? 'showing' : 'off'}</small></button>;
  const rules = (
    <button type="button" class={`kpi rules ${sum.fail ? 'bad' : sum.warn ? 'warn' : 'ok'}`} onClick={() => go('approve')}>
      <span>Rules</span>
      <b><Icon n={sum.fail ? 'x' : sum.warn ? 'warn' : 'check'} size={16} />{sum.fail ? `${sum.fail} fail` : sum.warn ? `${sum.warn} to check` : 'All clear'}</b>
      <small>{sum.pass} pass{sum.fail && sum.warn ? ` · ${sum.warn} to check` : ''}</small>
    </button>
  );
  // (one set of figures whatever the project's stage: the stage is the dashboard's, not Pro's)
  return (
    <div class="results" role="region" aria-label="Result">
      <button type="button" class="kpi" onClick={statement} title="The area statement">
        <span>Built-up</span><b>{sqft(d.bua)}{D('bua', (v) => `${nf(v * 10.7639)}`)}</b>
        {V('bua', (v) => `${nf(v * 10.7639)} sq ft`, <small><i class="meter"><i style={`width:${Math.min(100, used * 100)}%`} /></i>{nf(used * 100)}% of {nf(r.bua * 10.7639 / 1000)}k allowed</small>)}
      </button>
      <button type="button" class="kpi" onClick={() => go('design')}>
        {publicOnly ? <span>Buildings</span> : <span>Homes</span>}
        {publicOnly ? <b>{d.buildings.length}</b> : <b>{d.flats}{shops ? <em> + {shops.count} shops</em> : null}{D('flats', (v) => nf(v))}</b>}
        {V('flats', (v) => `${nf(v)} homes`, <small>{d.buildings.length} bldg · {d.buildings.map((b) => b.floors).join('+') || 0} floors · {nf(d.height)} m</small>)}
      </button>
      {publicOnly ? <>
      <button type="button" class="kpi" onClick={() => go('numbers')}>
        <span>Cost</span><b>{cr(d.money.cost)}</b>
        <small>public: nothing sold</small>
      </button>
      <button type="button" class="kpi" onClick={() => go('numbers')}>
        <span>Build per m²</span><b>{d.bua > 0 ? `₹${nf((d.money.build + d.money.parking + d.money.soft) / d.bua)}` : '—'}</b>
        <small>built-up, land aside</small>
      </button>
      </> : <>
      <button type="button" class="kpi" onClick={() => go('numbers')}>
        <span>Profit</span><b class={deal.profit < 0 ? 'bad' : ''}>{cr(deal.profit)}{D('profit', (v) => `${nf(v / 1e7, 2)} cr`)}</b>
        {V('profit', (v) => cr(v), <small>{e.p.sale || e.p.land ? `${pct(deal.margin)} margin · ${cr(deal.revenue)} sales` : `${pct(deal.margin)} · starting prices`}</small>)}
      </button>
      {!e.p.land && <LandKpi e={e} go={go} />}
      <button type="button" class="kpi" onClick={() => go('numbers')}>
        <span>IRR</span><b class={deal.irr !== null && deal.irr < 0 ? 'bad' : ''}>{pct(deal.irr)}{D('irr', (v) => `${nf(v * 100, 1)} pt`)}</b>
        {V('irr', (v) => `${nf(v * 100, 1)} pt`, <small>peak cash {cr(deal.peak)}</small>)}
      </button>
      </>}
      {rules}
      {vsBtn}
    </div>
  );
}

/** Generated or yours, always on the view: who lays the buildings out, and the way back to the brief's layout. */
/** While the land's price isn't put in, what the land is worth for the target: the buyer's first question. */
function LandKpi({ e, go }: { e: ReturnType<typeof evaluate>; go: (s: Step) => void }) {
  const T = targetOf(e.p), deal = e.p.deal ?? DEFAULT_DEAL;
  const w = useMemo(() => landWorth(e, deal, T), [e, JSON.stringify(deal), T.by, T.v]);
  return (
    <button type="button" class="kpi" onClick={() => go('numbers')} title="The most the land is worth for your target (Money)">
      <span>Land worth</span>
      <b class={w.outright === null ? 'bad' : ''}>{w.outright === null ? 'Nothing' : `≤ ${cr(w.outright)}`}</b>
      <small>for {pct(T.v, 0)} {T.by === 'irr' ? 'IRR' : 'margin'}{w.outright !== null && e.r.area > 0 ? ` · ₹${nf(w.outright / (e.r.area * 10.7639))}/sq ft` : ''}</small>
    </button>
  );
}

function SaveState({ cloud, user, readOnly }: { cloud: { s: string; msg?: string }; user: boolean; readOnly: boolean }) {
  if (readOnly) return <span class="save ro"><Icon n="link" size={13} />Shared view</span>;
  if (!user) return <span class="save" title="Kept in this browser. Sign in to keep it in your account." role="status"><i />Saved</span>;
  const t = cloud.s === 'saving' ? (cloud.msg ?? 'Saving…') : cloud.s === 'saved' ? (cloud.msg ?? 'Saved') : cloud.s === 'error' ? 'Not saved' : 'Saved';
  return <span class={`save ${cloud.s}`} title={cloud.msg} role="status">{cloud.s === 'saving' ? <Dither class="dz" cell={2} /> : <i />}{t}</span>;
}

/** The option open, and the others: open one, duplicate this one, rename or delete it, compare them, choose one. */
function OptionMenu({ p, acts }: { p: ProProject; acts: null | { open: (id: string) => void; duplicate: () => void; rename: () => void; remove: () => void; compare: () => void; choose: (id: string) => void } }) {
  const os = optionsOf(p), cur = p.option;
  const items: MenuItem[] = [
    { heading: 'Options' },
    ...(os.length ? os.map((o) => ({ label: o.name, sub: `${o.made}${o.id === p.chosen ? ' · chosen' : ''}`, checked: o.id === cur, disabled: !acts, onSelect: () => acts?.open(o.id) })) : [{ label: 'Option A', sub: 'the only one', checked: true, onSelect: () => {} }]),
    ...(acts ? [
      { heading: 'This option' } as MenuItem,
      { label: 'Duplicate it', icon: 'copy', sub: 'a new option to change', onSelect: acts.duplicate },
      { label: 'Rename it…', icon: 'edit', onSelect: acts.rename, disabled: !os.length },
      ...(cur ? [{ label: cur === p.chosen ? 'Chosen to take forward' : 'Choose it', icon: 'check', disabled: cur === p.chosen, onSelect: () => acts.choose(cur) }] : []),
      { label: 'Delete it', icon: 'trash', onSelect: acts.remove, disabled: os.length < 2 },
    ] : []),
    { label: 'Compare options…', icon: 'layers', onSelect: () => acts?.compare(), disabled: os.length < 2 || !acts },
  ];
  return <Menu text label={optionName(p)} icon="chevron" class="left pmenu omenu" items={items} />;
}

/** The projects round this one: recent ones (yours and shared with you), all of them on the dashboard, a new one.
 *  Loads the list as it opens. (The stage is set on the dashboard and in Sites.) */
function ProjectMenu({ user, current, open, fresh }: { user: boolean; current: string | null; open: (id: string) => void; fresh?: () => void }) {
  const [list, setList] = useState<Project[] | null>(null);
  const load = () => { if (!user) return; void Promise.all([listPro(), listSharedPro()]).then(([a, b]) => setList([...a, ...b].sort((x, y) => y.updated_at.localeCompare(x.updated_at))), () => setList([])); };
  const recent = (list ?? []).filter((x) => x.id !== current).slice(0, 5);
  const items: MenuItem[] = [
    ...(user ? [{ heading: 'Recent' } as MenuItem, ...(list === null ? [{ label: 'Loading…', disabled: true }] : recent.length ? recent.map((x) => ({ label: x.name, icon: 'folder', sub: ago(x.updated_at), onSelect: () => open(x.id) })) : [{ label: 'None yet', disabled: true }])] : []),
    { heading: 'Projects' },
    { label: 'All your projects', icon: 'folder', href: `${BASE}dashboard/` },
    ...(fresh ? [{ label: 'New project', icon: 'plus', onSelect: fresh }] : []),
  ];
  return <Menu label="Projects" icon="folder" class="left pmenu" items={items} onOpen={load} />;
}

/** The account: search, the shortcuts, the dashboard, the simple editor, signing out. */
function Account({ email, phone, search, keys }: { email: string | null; phone: boolean; search: () => void; keys: () => void }) {
  return <Menu label="Account" icon="user" items={[
    ...(email ? [{ heading: email } as MenuItem] : []),
    { label: 'Your dashboard', icon: 'folder', href: `${BASE}dashboard/` },
    ...(phone ? [] : [
      { label: 'Search', icon: 'cursor', sub: 'Ctrl K', onSelect: search },
      { label: 'Keyboard shortcuts', icon: 'key', sub: '?', onSelect: keys },
      { label: 'The simple editor', icon: 'site', href: `${BASE}app/` },
    ]),
    ...(email ? [{ label: 'Sign out', icon: 'x', onSelect: () => void signOut().then(() => location.reload()) }] : []),
  ]} />;
}

/** The people on the project: the owner adds and removes them; the link; invites. (Its comments are on the view.) */
function People({ pid, role, close }: { pid: string; role: 'owner' | 'editor' | 'viewer'; close: () => void }) {
  const [people, setPeople] = useState<Member[] | null>(null);
  const [err, setErr] = useState(''), [off, setOff] = useState('');
  const [email, setEmail] = useState(''), [as, setAs] = useState<Member['role']>('editor');
  const [busy, setBusy] = useState(false), [sent, setSent] = useState('');
  const link = projectLink(pid);
  const copyLink = async () => { try { await navigator.clipboard.writeText(link); setSent('Link copied. Send it to them: it opens the project once they sign in with the email you added.'); } catch { setSent(`Copy this link and send it: ${link}`); } };
  const invite = (who: string) => run(async () => { const r = await sendInvite(pid, who); setSent(r === 'sent' ? `Invite emailed to ${who}.` : `Added. Email invites aren’t set up on this site yet, so send them the link: it opens the project once they sign in as ${who}.`); });
  const fail = (x: unknown) => { if (x instanceof NotSetUp) setOff(x.message); else setErr(explain(x)); };
  const reload = () => listMembers(pid).then(setPeople).catch(fail);
  useEffect(() => { void reload(); }, [pid]);
  const run = async (f: () => Promise<unknown>) => { setBusy(true); setErr(''); try { await f(); await reload(); } catch (x) { fail(x); } finally { setBusy(false); } };
  if (off) return <Dialog title="People" close={close} side><p class="note">{off} The site's owner turns them on by running <code>supabase/migrations/0004_project_team.sql</code> once in Supabase.</p></Dialog>;
  return (
    <Dialog title="People" close={close} side>
      {err && <p class="note bad">{err}</p>}
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
      <p class="note">Comments are on the view now: Comment in the top bar (C) drops one on a building or a spot.</p>
    </Dialog>
  );
}

type Box = { x0: number; z0: number; x1: number; z1: number; h: number };

function Keys({ close }: { close: () => void }) {
  const rows: [string, string][] = [['Ctrl K', 'Search: actions, buildings, settings'], ['1 · N · A', 'The project’s settings · the Numbers report · the Approval report'], ['\\', 'Show or hide the sheet'], ['/', 'Pin the sheet beside the view, or float it'], ['F6 · Shift+F6', 'Move between the top bar, the steps, the sheet and the view'], ['R · Shift+R', 'Turn the picked building 15°'], ['+ −', 'A floor more or less on the picked building'], ['Ctrl+D', 'Duplicate the picked building'], ['M', 'Measure'], ['X', 'X-ray floor on or off'], ['[  ]', 'Floor down / up'], ['F', 'Frame what’s picked (nothing picked: the whole site)'], ['S · T', 'Camera: street, from above'], ['Drag · Right-drag · Wheel', 'Orbit about the point under the pointer · pan across the ground · zoom toward the pointer'], ['Double-click', 'Frame a building (on open ground: the whole site)'], ['P', 'The plan from above, or back to 3D'], ['V', 'Back to picking'], ['Enter · Esc · Backspace', 'Drawing: finish, cancel, take back a point'], ['Shift', 'Drawing: keep a line square to the road'], ['Alt', 'Hold while dragging: no snapping'], ['← → ↑ ↓', 'Nudge what’s picked a grid step (Shift: ×10)'], ['Delete', 'Remove what’s picked'], ['Ctrl+Z · Ctrl+Shift+Z', 'Undo · redo'], ['↑ ↓ in a number', 'Step it (Shift: ×10)'], ['Esc', 'Close this; let go of what’s picked; close the sheet']];
  return <Dialog title="Keyboard shortcuts" close={close}><dl class="lines keys">{rows.map(([a, b]) => <div><dt><kbd>{a}</kbd></dt><dd>{b}</dd></div>)}</dl></Dialog>;
}

render(<App />, document.getElementById('pro')!);
