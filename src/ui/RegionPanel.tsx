// Inspector for a DP region (a land-use plot or reserved site traced from the DP sheets): what the plan says —
// land use, reservation and its code, read off a close-up of the sheet — and what the survey found on the ground.
import { useEffect, useRef, useState } from 'preact/hooks';
import { docVersion, readOnly, select } from '../editor/state';
import { ui } from './ctx';
import { Icon, Row, Section, Select, Seg, Toggle } from './components';
import * as ops from '../doc/ops';
import { SURVEY_COLOR, SURVEY_LABEL, type RegionObj, type SurveyStatus } from '../doc/types';
import { CODE_OPTIONS, parseCode } from '../doc/dpcodes';

const STATUSES: SurveyStatus[] = ['unsurveyed', 'matches', 'differs', 'built', 'unclear'];
const SHORT: Record<SurveyStatus, string> = { unsurveyed: 'Not yet', matches: 'Matches', differs: 'Differs', built: 'Built over', unclear: "Can't tell" };

/** Set a survey status on regions (creates their survey objects), stamping who and when. */
export function setSurveyStatus(ids: string[], status: SurveyStatus) { ui.app.setSurvey(ids, status); }

/** The region as it stands: its survey object, or the traced region it would start from. */
export function regionView(id: string): RegionObj | null {
  const o = ui.doc.get<'region'>(id);
  if (o) return o;
  const t = ui.E.dpr.get(id);
  return t ? { kind: 'region', id, ...ui.E.dpr.snapshot(t) } : null;
}

const fmtArea = (a: number) => (a >= 10000 ? `${(a / 10000).toFixed(2)} ha` : `${a.toLocaleString()} m²`);

export function RegionPanel(p: { id: string }) {
  void docVersion.value; // signals make components pure: re-render on every document change
  const D = ui.E.dpr;
  const r = regionView(p.id);
  const ro = readOnly.value;
  const [link, setLink] = useState('');
  if (!r) return <div class="insp"><p class="muted">This DP region isn't in the current tracing.</p></div>;
  const t = D.get(p.id);
  const own = !!ui.doc.get(p.id);
  const set = (patch: Partial<RegionObj>, merge?: string) => ui.E.edit('Survey region', () => ops.editRegion(ui.doc, p.id, patch, t ? D.snapshot(t) : undefined), merge);
  const code = parseCode(r.code);
  const classes = D.data ? Object.entries(D.data.classes).map(([k, v]) => ({ value: k, label: v.label })) : [{ value: r.cls, label: r.cls }];
  return (
    <div class="insp">
      <div class="insp-kind"><Icon.layers /> {r.reserved ? 'Reserved site' : 'DP region'}</div>
      <h3 class="region-title"><i class="swatch" style={{ background: D.classColor(r.cls) }} />{r.reserved && r.code ? `${r.code}${code?.purpose ? ` — ${code.purpose}` : ''}` : D.classLabel(r.cls)}</h3>
      <p class="muted">{fmtArea(r.area)}{r.sheet ? ` · DP sheet ${r.sheet}` : ''}{r.conf !== undefined ? ` · traced with ${Math.round(r.conf * 100)} % confidence` : ''}</p>
      <SheetCrop region={r} />
      <Section title="What the plan says">
        <Row label="Land use"><Select value={r.cls} options={classes} disabled={ro} onChange={(v) => set({ cls: v })} /></Row>
        <Toggle label="Reserved for a public purpose (red verge)" checked={r.reserved} disabled={ro} onChange={(v) => set({ reserved: v })} />
        {r.reserved && (
          <>
            <Row label="Code" hint="As printed in the circle on the sheet, e.g. PG 61">
              <input class="text" list="dp-codes" value={r.code ?? ''} placeholder={r.marker ? 'Read it off the sheet above' : 'e.g. PG 61'} disabled={ro}
                onChange={(e) => set({ code: (e.currentTarget as HTMLInputElement).value.trim().toUpperCase() || undefined })} />
            </Row>
            <datalist id="dp-codes">{CODE_OPTIONS.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</datalist>
            {code && <p class="muted small">{code.purpose ? `${code.purpose}${code.no ? `, site no. ${code.no}` : ''}` : `“${code.code}” isn't in the sheet legend — check the spelling`}</p>}
          </>
        )}
      </Section>
      <Section title="What's there today">
        <div class="survey-status">
          {STATUSES.map((s) => (
            <button key={s} class={`chip ${r.status === s ? 'on' : ''}`} disabled={ro} style={r.status === s && s !== 'unsurveyed' ? { borderColor: SURVEY_COLOR[s], color: SURVEY_COLOR[s] } : undefined}
              title={SURVEY_LABEL[s]} onClick={() => setSurveyStatus([p.id], s)}>{SHORT[s]}</button>
          ))}
        </div>
        <textarea class="note-input" placeholder="What's on the ground (e.g. garden half built over by a parking lot; school built; open plot)…" value={r.note ?? ''} disabled={ro}
          onChange={(e) => set({ note: (e.currentTarget as HTMLTextAreaElement).value || undefined })} />
        <div class="links">
          {(r.links ?? []).map((u, i) => (
            <div key={i} class="link-row">
              <a href={u} target="_blank" rel="noreferrer">{u.replace(/^https?:\/\//, '').slice(0, 42)}</a>
              {!ro && <button class="icon-btn" title="Remove" onClick={() => set({ links: (r.links ?? []).filter((_, k) => k !== i) })}><Icon.close /></button>}
            </div>
          ))}
          {!ro && (
            <form class="row-inline" onSubmit={(e) => { e.preventDefault(); const u = link.trim(); if (/^https?:\/\//.test(u)) { set({ links: [...(r.links ?? []), u] }); setLink(''); } }}>
              <input class="text" placeholder="Photo or document link (https://…)" value={link} onInput={(e) => setLink((e.currentTarget as HTMLInputElement).value)} />
              <button type="submit" disabled={!/^https?:\/\//.test(link.trim())}>Add</button>
            </form>
          )}
        </div>
        {r.status !== 'unsurveyed' && <p class="muted small">{SURVEY_LABEL[r.status]}{r.surveyedBy ? ` · ${r.surveyedBy}` : ''}{r.surveyedAt ? ` · ${r.surveyedAt}` : ''}</p>}
      </Section>
      <div class="btns">
        <button onClick={() => { select([{ kind: 'region', id: p.id }]); ui.E.zoomToSelection(); }}>Zoom to it</button>
        {own && r.src && <button disabled={ro} title="Forget the survey and edits; back to the traced region" onClick={() => ui.E.edit('Reset region', () => ui.doc.remove(p.id))}>Reset to the tracing</button>}
        {own && !r.src && <button class="danger" disabled={ro} onClick={() => { ui.E.edit('Delete region', () => ui.doc.remove(p.id)); select([]); }}><Icon.trash size={14} /> Delete region</button>}
      </div>
      <p class="muted small">{r.src ? 'Traced automatically from the scanned DP sheet' : 'Traced from the DP sheet with the fill tool'} (registered to about 2–3 m): a survey aid, not a legal plot boundary.</p>
    </div>
  );
}

/** Close-up of the registered DP sheet around the region's code (or the region), with its outline. */
function SheetCrop(p: { region: RegionObj }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const D = ui.E.dpr;
  const r = p.region;
  useEffect(() => {
    let tries = 0, timer = 0;
    const draw = () => {
      const cv = ref.current, ix = D.sheetIndex;
      if (!cv || !ix) { if (tries++ < 30) timer = window.setTimeout(draw, 300); return; }
      const W = cv.width, H = cv.height;
      // view box: the code circle close up, else the whole region (at least 80 m across)
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < r.ring.length; i += 2) { x0 = Math.min(x0, r.ring[i]); x1 = Math.max(x1, r.ring[i]); z0 = Math.min(z0, r.ring[i + 1]); z1 = Math.max(z1, r.ring[i + 1]); }
      let cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, span = Math.max(80, (x1 - x0) * 1.15, ((z1 - z0) * 1.15 * W) / H);
      if (r.marker) { cx = r.marker[0]; cz = r.marker[1]; span = 75; }
      const k = W / span, bx0 = cx - span / 2, bz0 = cz - (H / k) / 2;
      const ctx = cv.getContext('2d')!;
      ctx.fillStyle = '#f4f3ef'; ctx.fillRect(0, 0, W, H);
      let missing = false;
      for (const t of ix.tiles) {
        if (t.x0 > bx0 + span || t.x0 + t.size < bx0 || t.z0 > bz0 + H / k || t.z0 + t.size < bz0) continue;
        const im = D.image(t.file);
        if (!im) { missing = true; continue; }
        ctx.drawImage(im, (t.x0 - bx0) * k, (t.z0 - bz0) * k, t.size * k, t.size * k);
      }
      const P = (x: number, z: number): [number, number] => [(x - bx0) * k, (z - bz0) * k];
      ctx.beginPath();
      for (let i = 0; i < r.ring.length; i += 2) { const q = P(r.ring[i], r.ring[i + 1]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }
      ctx.closePath(); ctx.strokeStyle = '#2f7cf6'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
      if (r.marker) { const m = P(r.marker[0], r.marker[1]); ctx.strokeStyle = 'rgba(214,40,40,0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(m[0], m[1], 24 * k, 0, Math.PI * 2); ctx.stroke(); }
      if (missing && tries++ < 30) timer = window.setTimeout(draw, 300);
    };
    draw();
    return () => clearTimeout(timer);
  }, [r.id, r.ring.length, r.marker?.[0], D.sheetIndex]);
  return (
    <figure class="sheet-crop">
      <canvas ref={ref} width={600} height={400} />
      <figcaption class="muted small">{r.marker ? 'The DP sheet at the site’s code — read the letters and number in the circle.' : 'The DP sheet around this region.'}</figcaption>
    </figure>
  );
}
