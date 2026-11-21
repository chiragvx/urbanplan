// Quality tiers: what the shaded view spends, chosen for the GPU and kept honest by the frame time.
//   draft    phones and basic integrated GPUs: straight to the canvas with MSAA, no AO, 2048 shadows, plain glass.
//   standard most laptops: the pipeline (AO, SMAA, night bloom), 2048 fitted shadows, 512 px textures, entourage.
//   high     discrete GPUs and Apple silicon: full-resolution AO, 4096 shadows, 1024 px textures, room interiors behind
//            the glass, and a supersampled image when the camera rests.
//   still    on demand only: an image rendered offscreen at its own size, everything on.
// The first guess reads the GPU's name; then if the frames run long for two seconds the view steps down a tier (never up
// by itself). The choice is kept in this browser; the Quality menu can set it.

export type Tier = 'draft' | 'standard' | 'high' | 'still';
export const TIERS: { value: Exclude<Tier, 'still'>; label: string }[] = [
  { value: 'draft', label: 'Draft' }, { value: 'standard', label: 'Standard' }, { value: 'high', label: 'High' },
];
export interface TierSpec { pipeline: boolean; shadow: number; dpr: number; tex: number; interiors: boolean; entourage: boolean; budgetMs: number }
export const SPEC: Record<Tier, TierSpec> = {
  draft: { pipeline: false, shadow: 2048, dpr: 1.25, tex: 0, interiors: false, entourage: false, budgetMs: 33 },
  standard: { pipeline: true, shadow: 2048, dpr: 1.5, tex: 512, interiors: true, entourage: true, budgetMs: 20 },
  high: { pipeline: true, shadow: 4096, dpr: 2, tex: 1024, interiors: true, entourage: true, budgetMs: 24 },
  still: { pipeline: true, shadow: 4096, dpr: 1, tex: 1024, interiors: true, entourage: true, budgetMs: 1e9 },
};

const KEY = 'urbanplan:pro:quality';
export function savedTier(): Exclude<Tier, 'still'> | null {
  try { const v = localStorage.getItem(KEY); return v === 'draft' || v === 'standard' || v === 'high' ? v : null; } catch { return null; }
}
export function saveTier(t: Exclude<Tier, 'still'>) { try { localStorage.setItem(KEY, t); } catch { /* */ } }

/** a first guess from the GPU's name, touch and memory */
export function guessTier(gl: WebGLRenderingContext | WebGL2RenderingContext): Exclude<Tier, 'still'> {
  let name = '';
  try { const ext = gl.getExtension('WEBGL_debug_renderer_info'); name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase(); } catch { /* */ }
  const touch = typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 1;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  if (/adreno|mali|powervr|swiftshader|llvmpipe/.test(name) || (touch && /apple gpu/.test(name)) || mem <= 2) return 'draft';
  if (/intel.*(hd|uhd)/.test(name) && !/iris/.test(name)) return 'draft';
  if (/nvidia|geforce|rtx|quadro|radeon rx|radeon pro|apple m\d/.test(name)) return 'high';
  return 'standard';
}

/** Watches frame times; calls `down` when the p90 runs over the tier's budget for 2 s straight. */
export class FrameWatch {
  private t: number[] = []; private over = 0; private last = 0;
  constructor(private budget: () => number, private down: () => void) {}
  tick(now: number) {
    if (this.last) {
      const dt = now - this.last;
      if (dt < 250) {
        this.t.push(dt); if (this.t.length > 60) this.t.shift();
        if (this.t.length >= 30) {
          const p90 = [...this.t].sort((a, b) => a - b)[Math.floor(this.t.length * 0.9)];
          this.over = p90 > this.budget() ? this.over + dt : 0;
          if (this.over > 2000) { this.over = 0; this.t = []; this.down(); }
        }
      }
    }
    this.last = now;
  }
  rest() { this.last = 0; }
}
