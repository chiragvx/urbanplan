// The build palette (Cities: Skylines' bottom panel): categories, their tabs, and a strip of asset tiles drawn from
// each asset. Click a tile to start building it (the palette folds into the drawing strip); hover for its
// cross-section, limits and source.
import { useEffect, useState } from 'preact/hooks';
import { buildAsset, buildCat, buildOpen, buildTab, readOnly, settings, tool } from '../editor/state';
import { CATEGORIES, assetsIn, deleteCustom, getAsset, sizeLabel, tabsOf, uiCategory, type AssetDef, type Category } from '../assets';
import { sectionDiagram, thumb } from '../assets/thumb';
import { ui } from './ctx';
import { DrawStrip } from './DrawStrip';
import { RoadPicker } from './RoadPicker';

const DRAW_TOOLS = ['pen', 'route', 'place', 'area'];

/** Building: the palette open, or a draw tool in use (the palette folded into the drawing strip). */
export function paletteVisible() { return buildOpen.value || DRAW_TOOLS.includes(tool.value); }
/** The bar category on show (rail's under transit, drainage's under water). */
const shownCat = (): Category => uiCategory(buildCat.value);

const RECENT = 'Recent';

/** What was built lately in a category (newest first). */
function recentIn(cat: string): AssetDef[] {
  return (settings.value.recentAssets ?? []).map((id) => getAsset(id)).filter((a): a is AssetDef => !!a && uiCategory(a.category) === cat);
}

/** A category's tabs: Recent first once something in it has been built. */
function tabsWithRecent(cat: Parameters<typeof tabsOf>[0]): string[] {
  return recentIn(cat).length ? [RECENT, ...tabsOf(cat)] : tabsOf(cat);
}

export function currentTab(): string {
  const cat = shownCat(), tabs = tabsWithRecent(cat);
  const t = buildTab.value[cat];
  return t && tabs.includes(t) ? t : tabs[0] ?? '';
}

export function BuildPalette() {
  void settings.value.customAssets; // re-render when assets are saved
  const [hover, setHover] = useState<{ a: AssetDef; x: number } | null>(null);
  // while drawing the palette is folded into the strip; it opens above it from the strip's type or the bar
  const drawing = DRAW_TOOLS.includes(tool.value), show = buildOpen.value && !readOnly.value;
  useEffect(() => { if (!show) setHover(null); }, [show]);
  if (!show) return <DrawStrip />;
  const cat = shownCat(), tabs = tabsWithRecent(cat), tab = currentTab();
  const list = tab === RECENT ? recentIn(cat) : assetsIn(cat, tab);
  const close = () => { buildOpen.value = false; };
  const pick = (a: AssetDef) => { setHover(null); ui.E.useAsset(a.id); buildOpen.value = false; };
  return (
    <>
    <div class={`buildbar ${drawing ? 'over-strip' : ''}`} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} onMouseLeave={() => setHover(null)}>
      <div class="bb-tabs">
        <b class="bb-title">{CATEGORIES.find((c) => c.id === cat)?.label}</b>
        {cat !== 'roads' && tabs.map((t) => <button key={t} class={t === tab ? 'on' : ''} onClick={() => { buildTab.value = { ...buildTab.value, [cat]: t }; }}>{t}</button>)}
        <span class="spacer" />
        <button class="bb-close" aria-label="Close" title={drawing ? 'Fold away' : 'Close (Esc)'} onClick={close}>×</button>
      </div>
      {/* roads: a width plus features (the road picker) in place of tabs and tiles */}
      {cat === 'roads' ? <RoadPicker mode="build" /> : <div class="bb-tiles" onMouseLeave={(e) => { if (!(e.relatedTarget as Element | null)?.closest?.('.bb-card')) setHover(null); }}>
        {list.map((a) => (
          <button key={a.id} class={`bb-tile ${buildAsset.value === a.id && DRAW_TOOLS.includes(tool.value) ? 'on' : ''}`}
            onClick={() => pick(a)}
            onMouseEnter={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(), p = (e.currentTarget as HTMLElement).closest('.buildbar')!.getBoundingClientRect(); setHover({ a, x: r.left - p.left + r.width / 2 }); }}>
            <img src={thumb(a)} width={112} height={72} alt="" draggable={false} />
            <span class="bb-name">{a.name}</span>
            <span class="bb-size">{sizeLabel(a)}</span>
          </button>
        ))}
        {!list.length && <p class="muted pad">Nothing here yet. Select a road and use “Save as asset” in the inspector to add your own.</p>}
      </div>}
      {hover && <Card a={hover.a} x={hover.x} onLeave={() => setHover(null)} />}
    </div>
    <DrawStrip />
    </>
  );
}

function Card(p: { a: AssetDef; x: number; onLeave: () => void }) {
  const a = p.a, d = sectionDiagram(a);
  const total = d ? d.parts.reduce((s, q) => s + q.w, 0) : 0;
  const lift = a.lift ?? 0;
  return (
    <div class="bb-card" style={{ left: `${Math.max(150, p.x)}px` }} onMouseLeave={p.onLeave}>
      <div class="bb-card-head"><b>{a.name}</b><span>{sizeLabel(a)}</span></div>
      {a.use && <p class="muted small">{a.use}</p>}
      {d && (
        <div class="bb-xs">
          {d.parts.map((q, i) => <div key={i} style={{ flex: q.w, background: q.color }} title={`${q.label} ${q.w} m`}><span>{q.w >= total / 14 ? q.w : ''}</span></div>)}
        </div>
      )}
      <ul class="bb-facts">
        {lift > 0.25 && <li>{lift} m up{a.profile.type === 'street' ? ' (deck)' : ''}</li>}
        {lift < -0.25 && <li>{-lift} m below ground</li>}
        {a.profile.type === 'channel' && <li>bed {a.profile.bed} m · depth {a.profile.depth} m · side slopes {a.profile.slope}:1 · freeboard {a.profile.freeboard} m{a.profile.banks[0] ? ` · banks ${a.profile.banks[0]} / ${a.profile.banks[1]} m` : ''}</li>}
        {a.profile.type === 'track' && <li>gauge {a.profile.gauge * 1000} mm · {a.profile.tracks} track{a.profile.tracks > 1 ? `s, centres ${a.profile.tc} m` : ''} · formation {a.profile.formation} m</li>}
        {a.profile.type === 'corridor' && <li>right of way {a.profile.width} m · {a.profile.poles ? 'poles' : 'towers'} every ~{a.profile.span} m</li>}
        {(a.rules ?? []).map((r, i) => <li key={i} class={r.kind === 'minRadius' && r.hard ? 'hard' : ''}>{r.note}</li>)}
        {(a.along ?? []).map((r, i) => <li key={`a${i}`}>{r.item}s every {r.every} m{r.note ? ` (${r.note})` : ''}</li>)}
      </ul>
      <p class="bb-src">{a.source}{a.approx ? ' · some values typical / read off drawings' : ''}</p>
      {a.custom && <button class="link small" onClick={() => { deleteCustom(a.id); if (buildAsset.value === a.id) buildAsset.value = ''; }}>Delete this saved asset</button>}
    </div>
  );
}

/** Step through the tiles of the current tab (',' and '.'), or the tabs (Shift). */
export function stepTile(d: 1 | -1, tabs = false) {
  const cat = shownCat();
  if (tabs) {
    const t = tabsWithRecent(cat), i = t.indexOf(currentTab());
    buildTab.value = { ...buildTab.value, [cat]: t[(i + d + t.length) % t.length] };
    buildOpen.value = true;
    return;
  }
  const tab = currentTab();
  const list = tab === RECENT ? recentIn(cat) : assetsIn(cat, tab);
  if (!list.length) return;
  const i = list.findIndex((a) => a.id === buildAsset.value);
  const next = list[(i + d + list.length) % list.length];
  // stepping through Recent keeps its order
  ui.E.useAsset(next.id, tab !== RECENT);
}

/** Open the palette on the category / tab of the asset being built. */
export function revealAsset(id: string) {
  const a = getAsset(id);
  if (!a) return;
  const cat = uiCategory(a.category);
  buildCat.value = cat;
  if (currentTab() !== RECENT) buildTab.value = { ...buildTab.value, [cat]: a.tab };
}
