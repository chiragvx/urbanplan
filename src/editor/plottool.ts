// Plot sandbox tool: click the corners of a plot (they snap to building corners and other plots), Enter or
// double-click to finish. The plot is a map object; its report (DP loss, FSI, envelope) is worked out from the map
// and kept until the map changes.
import type { Editor } from './editor';
import { newId } from '../doc/ids';
import type { Id, PlotObj } from '../doc/types';
import { analysePlot, centroid, polyArea, type PlotCode, type PlotReport } from '../doc/plot';
import { solveSite, type PlotSite, type SiteReport } from '../doc/site';
import { siteFor } from '../doc/optimise';
import { readOnly, select, status, toast } from './state';

export class PlotTool {
  pts: number[] = [];
  cursor: [number, number] | null = null;
  /** the corner the cursor snaps to */
  snap: [number, number] | null = null;
  private reports = new Map<Id, PlotReport>();
  private layouts = new Map<Id, SiteReport>();
  private bases = new Map<Id, { r: PlotReport; d: SiteReport }>();

  constructor(readonly E: Editor) {}

  hint() {
    return this.pts.length ? `${this.pts.length / 2} corner${this.pts.length > 2 ? 's' : ''} · Enter or double-click to finish · Backspace removes the last · Esc cancels` : 'Click the corners of your plot · it snaps to building corners';
  }

  /** A building or plot corner near a point (within the pick tolerance). */
  private snapAt(w: [number, number]): [number, number] | null {
    const tol = this.E.tol;
    let best: [number, number] | null = null, bd = tol;
    for (const id of this.E.hit.query(w[0] - tol, w[1] - tol, w[0] + tol, w[1] + tol)) {
      const o = this.E.doc.get(id);
      const r = o?.kind === 'building' ? o.outer : o?.kind === 'plot' ? o.ring : null;
      if (!r) continue;
      for (let i = 0; i < r.length; i += 2) {
        const d = Math.hypot(r[i] - w[0], r[i + 1] - w[1]);
        if (d < bd) { bd = d; best = [r[i], r[i + 1]]; }
      }
    }
    // closing the ring on its first corner
    if (this.pts.length >= 6 && Math.hypot(this.pts[0] - w[0], this.pts[1] - w[1]) < tol) return [this.pts[0], this.pts[1]];
    return best;
  }

  hover(w: [number, number]) {
    this.cursor = w;
    this.snap = this.snapAt(w);
  }

  click(w: [number, number]) {
    if (readOnly.value) { toast('This map is read-only', 'warn'); return; }
    const p = this.snapAt(w) ?? w;
    if (this.pts.length >= 6 && p[0] === this.pts[0] && p[1] === this.pts[1]) { this.finish(); return; }
    this.pts.push(Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100);
    status.value = this.hint();
  }

  back() {
    this.pts.splice(-2, 2);
    status.value = this.hint();
  }

  finish() {
    const P = this.pts;
    this.pts = [];
    status.value = this.hint();
    if (P.length < 6 || polyArea(P) < 10) { if (P.length) toast('A plot needs at least three corners and 10 m²', 'warn'); return; }
    const n = this.E.doc.ids('plot').size + 1;
    const o: PlotObj = { kind: 'plot', id: newId('plot'), name: `Plot ${n}`, ring: P, use: 'residential' };
    this.E.edit('Draw a plot', () => this.E.doc.create(o));
    if (this.E.doc.get(o.id)) { this.E.setTool('select'); select([{ kind: 'plot', id: o.id }]); }
  }

  cancel() { this.pts = []; this.snap = null; }

  /** The plot's report against the map as it is now. */
  report(id: Id): PlotReport | null {
    const hit = this.reports.get(id);
    if (hit) return hit;
    const o = this.E.doc.get<'plot'>(id);
    if (!o || o.ring.length < 6) return null;
    const r = analysePlot(this.E.doc, this.E.C, (x0, z0, x1, z1) => this.E.hit.query(x0, z0, x1, z1), o, this.code(o));
    this.reports.set(id, r);
    return r;
  }

  /** The buildings on a plot, solved: flats, parking, money. */
  layout(id: Id): SiteReport | null {
    const hit = this.layouts.get(id);
    if (hit) return hit;
    const o = this.E.doc.get<'plot'>(id), r = this.report(id);
    if (!o || !r) return null;
    const d = solveSite(r, siteFor(o.site, r, o.use), o.use);
    this.layouts.set(id, d);
    return d;
  }

  /** The plot against the map as it is, without its what-if road widths: what the what-ifs are measured against.
   *  Null when it has none. */
  baseline(id: Id): { r: PlotReport; d: SiteReport } | null {
    const o = this.E.doc.get<'plot'>(id);
    if (!o?.roadEdits || o.ring.length < 6) return null;
    const hit = this.bases.get(id);
    if (hit) return hit;
    const p = { ...o, roadEdits: undefined };
    const r = analysePlot(this.E.doc, this.E.C, (x0, z0, x1, z1) => this.E.hit.query(x0, z0, x1, z1), p, this.code(o));
    const b = { r, d: solveSite(r, siteFor(o.site, r, o.use), o.use) };
    this.bases.set(id, b);
    return b;
  }

  /** Another site on the same plot (a saved option), not cached. */
  layoutOf(id: Id, site: PlotSite): SiteReport | null {
    const o = this.E.doc.get<'plot'>(id), r = this.report(id);
    return o && r ? solveSite(r, site, o.use) : null;
  }

  /** The site on a plot as it stands (the default one until it's edited). */
  site(id: Id): PlotSite | null {
    const o = this.E.doc.get<'plot'>(id), r = this.report(id);
    return o && r ? siteFor(o.site, r, o.use) : null;
  }

  /** The regulations a plot falls under: Mumbai's DCPR 2034 (island city south of Mahim and Sion creeks, else the
   *  suburbs), UDCPR everywhere else in Maharashtra. */
  code(o: PlotObj): PlotCode {
    const app = this.E.app;
    if (app.region?.id !== 'mumbai') return 'udcpr';
    const [x, z] = centroid(o.ring);
    return app.toLatLon(x, z)[0] < 19.045 ? 'dcpr-island' : 'dcpr-suburbs';
  }

  /** The map changed: reports are worked out again when next asked for. */
  invalidate() { this.reports.clear(); this.layouts.clear(); this.bases.clear(); }
}
