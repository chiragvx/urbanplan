// The build palette (Cities: Skylines' bottom panel): categories, their tabs, and a strip of asset tiles drawn from
// each asset. Click a tile to start building it; hover for its cross-section, limits and source.
import { useState } from 'preact/hooks';
import { buildAsset, buildCat, buildOpen, buildTab, readOnly, settings, tool } from '../editor/state';
import { CATEGORIES, assetsIn, deleteCustom, getAsset, sizeLabel, tabsOf, type AssetDef } from '../assets';
import { sectionDiagram, thumb } from '../assets/thumb';
import { ui } from './ctx';

const DRAW_TOOLS = ['pen', 'route', 'place', 'area'];

export function paletteVisible() { return buildOpen.value || DRAW_TOOLS.includes(tool.value); }

export function currentTab(): string {
  const cat = buildCat.value, tabs = tabsOf(cat);
  const t = buildTab.value[cat];
  return t && tabs.includes(t) ? t : tabs[0] ?? '';
}

export function BuildPalette() {
  void settings.value.customAssets; // re-render when assets are saved
  const [hover, setHover] = useState<{ a: AssetDef; x: number } | null>(null);
  if (!paletteVisible() || readOnly.value) return null;
  const cat = buildCat.value, tabs = tabsOf(cat), tab = currentTab();
  const list = assetsIn(cat, tab);
  const close = () => { buildOpen.value = false; if (DRAW_TOOLS.includes(tool.value)) ui.E.setTool('select'); };
  return (
    <div class="buildbar" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div class="bb-tabs">
        <b class="bb-title">{CATEGORIES.find((c) => c.id === cat)?.label}</b>
        {tabs.map((t) => <button key={t} class={t === tab ? 'on' : ''} onClick={() => { buildTab.value = { ...buildTab.value, [cat]: t }; }}>{t}</button>)}
        <span class="spacer" />
        <button class="bb-close" title="Close (Esc)" onClick={close}>×</button>
      </div>
      <div class="bb-tiles" onMouseLeave={() => setHover(null)}>
        {list.map((a) => (
          <button key={a.id} class={`bb-tile ${buildAsset.value === a.id && DRAW_TOOLS.includes(tool.value) ? 'on' : ''}`}
            onClick={() => ui.E.useAsset(a.id)}
            onMouseEnter={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(), p = (e.currentTarget as HTMLElement).closest('.buildbar')!.getBoundingClientRect(); setHover({ a, x: r.left - p.left + r.width / 2 }); }}>
            <img src={thumb(a)} width={112} height={72} alt="" draggable={false} />
            <span class="bb-name">{a.name}</span>
            <span class="bb-size">{sizeLabel(a)}</span>
          </button>
        ))}
        {!list.length && <p class="muted pad">Nothing here yet. Select a road and use “Save as asset” in the inspector to add your own.</p>}
      </div>
      {hover && <Card a={hover.a} x={hover.x} />}
    </div>
  );
}

function Card(p: { a: AssetDef; x: number }) {
  const a = p.a, d = sectionDiagram(a);
  const total = d ? d.parts.reduce((s, q) => s + q.w, 0) : 0;
  const lift = a.lift ?? 0;
  return (
    <div class="bb-card" style={{ left: `${Math.max(150, p.x)}px` }}>
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
  const cat = buildCat.value;
  if (tabs) {
    const t = tabsOf(cat), i = t.indexOf(currentTab());
    buildTab.value = { ...buildTab.value, [cat]: t[(i + d + t.length) % t.length] };
    buildOpen.value = true;
    return;
  }
  const list = assetsIn(cat, currentTab());
  if (!list.length) return;
  const i = list.findIndex((a) => a.id === buildAsset.value);
  const next = list[(i + d + list.length) % list.length];
  ui.E.useAsset(next.id);
}

/** Open the palette on the category / tab of the asset being built. */
export function revealAsset(id: string) {
  const a = getAsset(id);
  if (!a) return;
  buildCat.value = a.category;
  buildTab.value = { ...buildTab.value, [a.category]: a.tab };
}
