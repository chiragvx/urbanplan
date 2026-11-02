// Paint a road type onto existing roads (U) — Cities: Skylines' upgrade tool. The type is the street picked in the
// road picker / build palette, or one sampled off the map with Alt (an eyedropper). Dragging along roads takes them
// section by section, highlighted as you go with a running count; the stroke stops where the street changes name
// unless Shift is held. Releasing sends the stroke to the preview bar (Apply writes it as one undo step). Only the cross-section, class and catalogue
// type change: heights, bridges and tunnels stay as they are.
import type { Editor } from './editor';
import type { Id } from '../doc/types';
import type { Part } from '../net/model';
import { getAsset } from '../assets';
import { totalWidth } from '../doc/xsection';
import { buildAsset, readOnly, status, toast } from './state';
import { CLASS_LABEL } from '../doc/types';
import { change } from './bulk';

export interface PaintType { parts: Part[]; cls: string; asset?: string; name: string }

export class PaintTool {
  /** a type sampled off the map (Alt), while the picked street stays the one it was sampled over */
  private sampled: { type: PaintType; over: string } | null = null;
  stroke: { ids: Id[]; set: Set<Id>; name: string | null; len: number; skipped: number } | null = null;
  /** the section under the cursor */
  hoverId: Id | null = null;
  cursor: [number, number] | null = null;

  constructor(readonly E: Editor) {}

  /** What the brush paints: the sampled type, or the street picked in the road picker / palette. */
  get type(): PaintType | null {
    if (this.sampled && this.sampled.over === buildAsset.value) return this.sampled.type;
    const a = getAsset(buildAsset.value);
    if (a?.profile.type === 'street') return { parts: a.profile.parts, cls: a.profile.cls, asset: a.id, name: a.name };
    return null;
  }

  label(t = this.type) { return t ? `${t.name} · ${+totalWidth(t.parts).toFixed(1)} m${CLASS_LABEL[t.cls] && !t.name.includes(CLASS_LABEL[t.cls]) ? ` ${CLASS_LABEL[t.cls]}` : ''}` : ''; }

  hint(): string {
    const t = this.type;
    return t ? `Paint ${this.label(t)}: drag along roads · Alt-drag takes a road's type · Shift carries on past a name change`
      : 'Paint a road type: pick a street in the road picker, or Alt-click a road to take its type';
  }

  hover(w: [number, number]) {
    this.cursor = w;
    const p = this.E.pickAt(w[0], w[1]);
    this.hoverId = p?.kind === 'section' ? p.id : null;
  }

  down(w: [number, number], alt: boolean, shift: boolean) {
    this.hover(w);
    if (alt) { this.sample(); return; }
    if (readOnly.value) { toast('This map is read-only — use “Edit a copy” to make changes', 'warn'); return; }
    if (!this.type) { toast('Pick a street type first (road picker), or Alt-click a road to take its type', 'info'); return; }
    this.stroke = { ids: [], set: new Set(), name: null, len: 0, skipped: 0 };
    this.take(shift);
  }

  /** Drag: Alt keeps sampling, otherwise the road under the cursor joins the stroke. */
  move(w: [number, number], alt: boolean, shift: boolean) {
    this.hover(w);
    if (alt && !this.stroke) { this.sample(); return; }
    if (this.stroke) this.take(shift);
  }

  private sample() {
    const s = this.hoverId ? this.E.doc.get<'section'>(this.hoverId) : undefined;
    if (!s) return;
    const a = getAsset(s.asset);
    const name = a?.profile.type === 'street' && JSON.stringify(a.profile.parts) === JSON.stringify(s.parts) ? a.name : `Like ${s.name || CLASS_LABEL[s.cls] || 'that road'}`;
    this.sampled = { type: { parts: s.parts.map((p) => ({ ...p })), cls: s.cls, asset: s.asset, name }, over: buildAsset.value };
    status.value = `Painting ${this.label()} — drag along roads`;
  }

  private take(shift: boolean) {
    const S = this.stroke, id = this.hoverId;
    if (!S || !id || S.set.has(id)) return;
    const s = this.E.doc.get<'section'>(id);
    if (!s) return;
    if (S.name === null) S.name = s.name;
    else if (!shift && s.name !== S.name) { S.skipped++; return; }
    S.set.add(id); S.ids.push(id);
    S.len += this.E.C.geo(id)?.len ?? 0;
    this.E.overlayDirty = true;
  }

  /** Release: the stroke is written, one undo step. */
  up() {
    const S = this.stroke, t = this.type;
    this.stroke = null;
    this.E.overlayDirty = true;
    if (!S || !S.ids.length || !t) return;
    // through the preview bar (summary + ghost; Apply = one undo step); a single section is written straight away
    const ids = [...S.ids], parts = t.parts.map((p) => ({ ...p }));
    change(this.E, `Paint ${t.name}`, () => { for (const id of ids) if (this.E.doc.get(id)) this.E.doc.update(id, { parts: parts.map((p) => ({ ...p })), cls: t.cls, asset: t.asset }); }, ids);
    const n = ids.length;
    if (S.skipped) toast(`${t.name} on ${n} section${n === 1 ? '' : 's'} — stopped at a name change (Shift carries on)`, 'info');
  }

  cancel() { this.stroke = null; this.hoverId = null; this.E.overlayDirty = true; }
}
