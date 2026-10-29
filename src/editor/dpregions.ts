// DP regions: land-use plots and public-purpose reservations extracted from the registered Development Plan sheets
// (tools/dp/regions.py → tiles/<tile>/dp/regions.json). A reference layer for surveying: drawn in the plan, hover
// to read a region. Polygons come from scanned paper maps registered to ~2–3 m — a survey aid, not legal boundaries.
import { inRing } from './hit';
import type { RegionObj } from '../doc/types';

export interface DPRegion {
  id: string; cls: string; area: number;
  /** outline x,z,… in tile metres */ ring: number[];
  holes?: number[][];
  /** bounded by a red verge: a site reserved for a public purpose */ reserved: boolean;
  /** 0–1: colour fit, solidity and size of the patch on the sheet */ conf: number;
  sheet: string;
  /** where the site's circled code (e.g. "SW 9") is drawn on the sheet */ marker?: [number, number];
  box?: [number, number, number, number];
}
export interface DPRegionFile {
  res: number; sheets: string[]; source: string; note: string;
  classes: Record<string, { label: string; color: string }>;
  regions: DPRegion[];
}

const CELL = 100;

export class DPRegions {
  data: DPRegionFile | null = null;
  private state: 'idle' | 'loading' | 'ready' | 'missing' = 'idle';
  private grid = new Map<number, DPRegion[]>();
  private byId = new Map<string, DPRegion>();
  /** DP sheet image blocks (tiles.py) for close-up crops */
  sheetIndex: { res: number; tiles: { file: string; x0: number; z0: number; size: number }[] } | null = null;
  private images = new Map<string, HTMLImageElement>();
  onLoad: () => void = () => {};

  constructor(public base = '') {}

  get ready() { return this.state === 'ready'; }
  get missing() { return this.state === 'missing'; }

  /** Fetch on first use. */
  load() {
    if (this.state !== 'idle') return;
    this.state = 'loading';
    fetch(`${this.base}dp/regions.json`).then((r) => (r.ok ? r.json() : null)).then((j: DPRegionFile | null) => {
      if (!j) { this.state = 'missing'; this.onLoad(); return; }
      for (const r of j.regions) {
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let i = 0; i < r.ring.length; i += 2) { x0 = Math.min(x0, r.ring[i]); x1 = Math.max(x1, r.ring[i]); z0 = Math.min(z0, r.ring[i + 1]); z1 = Math.max(z1, r.ring[i + 1]); }
        r.box = [x0, z0, x1, z1];
        this.byId.set(r.id, r);
        for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let k = Math.floor(z0 / CELL); k <= Math.floor(z1 / CELL); k++) {
          const key = i * 100003 + k;
          (this.grid.get(key) ?? this.grid.set(key, []).get(key)!).push(r);
        }
      }
      this.data = j;
      this.state = 'ready';
      this.onLoad();
      fetch(`${this.base}dp/index.json`).then((r) => (r.ok ? r.json() : null)).then((ix) => { this.sheetIndex = ix; this.onLoad(); }).catch(() => {});
    }).catch(() => { this.state = 'missing'; this.onLoad(); });
  }

  /** Regions whose boxes touch a rectangle. */
  inRect(x0: number, z0: number, x1: number, z1: number): DPRegion[] {
    const out = new Set<DPRegion>();
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let k = Math.floor(z0 / CELL); k <= Math.floor(z1 / CELL); k++)
      for (const r of this.grid.get(i * 100003 + k) ?? []) if (r.box![0] <= x1 && r.box![2] >= x0 && r.box![1] <= z1 && r.box![3] >= z0) out.add(r);
    return [...out];
  }

  /** The region under a point (smallest first, so a reservation inside a zone wins). */
  at(x: number, z: number): DPRegion | null {
    let best: DPRegion | null = null;
    for (const r of this.grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL)) ?? []) {
      const b = r.box!;
      if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
      if (!inRing(r.ring, x, z) || r.holes?.some((h) => inRing(h, x, z))) continue;
      if (!best || r.area < best.area) best = r;
    }
    return best;
  }

  get(id: string): DPRegion | undefined { return this.byId.get(id); }

  /** The traced region as the start of a survey region object. */
  snapshot(r: DPRegion): Omit<RegionObj, 'kind' | 'id'> {
    return {
      src: r.id, cls: r.cls, reserved: r.reserved, ring: [...r.ring], ...(r.holes ? { holes: r.holes.map((h) => [...h]) } : {}),
      area: r.area, sheet: r.sheet, ...(r.marker ? { marker: [...r.marker] as [number, number] } : {}), conf: r.conf, status: 'unsurveyed',
    };
  }

  /** A loaded sheet image block (null until it has loaded; `onLoad` fires when it has). */
  image(file: string): HTMLImageElement | null {
    let im = this.images.get(file);
    if (im) this.images.delete(file); // most recent last
    else {
      im = new Image();
      im.onload = () => this.onLoad();
      im.src = `${this.base}dp/${file}`;
    }
    this.images.set(file, im);
    // keep a few decoded blocks (each is a 1000 px sheet image)
    while (this.images.size > 8) { const [k, old] = this.images.entries().next().value!; old.src = ''; this.images.delete(k); }
    return im.complete && im.naturalWidth ? im : null;
  }

  classLabel(cls: string) { return this.data?.classes[cls]?.label ?? cls; }
  classColor(cls: string) { return this.data?.classes[cls]?.color ?? '#999999'; }

  label(r: DPRegion) { return this.data?.classes[r.cls]?.label ?? r.cls; }
  color(r: DPRegion) { return this.data?.classes[r.cls]?.color ?? '#999999'; }
}
