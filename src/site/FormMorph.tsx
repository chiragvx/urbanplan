// Buildings as wireframes on the website's pages (the drawing is src/site/wire.ts):
// - FormMorph, the landing page's "any building, any shape": one view in which a building turns from one template
//   into the next, by itself.
// - WireSpin, one template turning slowly (a template's own page).
// - WireStill, one template, still (the templates gallery's cards).
// They run only while on screen; with reduced motion nothing moves (the landing's next form simply replaces the last).
import { useEffect, useRef, useState } from 'preact/hooks';
import { draw, ease, emptyGeo, geoOf, mix, WIRE, type Geo } from './wire';

const HOLD = 2600;    // ms a form stays
const MORPH = 1500;   // ms from one form to the next
const TURN = 0.00012; // radians a millisecond

/** The forms the landing page shows, in order. */
export const FORMS: { key: string; title: string; body: string }[] = [
  { key: 'twins', title: 'Sculpted twins', body: 'Two towers that turn as they rise, fins all round.' },
  { key: 'library', title: 'A public library', body: 'Three floors under one free-curved roof.' },
  { key: 'taper', title: 'A tapered tower', body: 'Each floor a little smaller, terraces at every edge.' },
  { key: 'courtyard', title: 'Homes round a court', body: 'A block of flats open to a garden in the middle.' },
  { key: 'wave', title: 'A wave block', body: 'Shops below, homes above, a facade that flows.' },
  { key: 'skygarden', title: 'A sky garden tower', body: 'Gardens carved into the tower, floors stepping in.' },
];

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Redraws on a resize or a change of theme; returns the cleanup. */
function redrawOn(el: HTMLCanvasElement, paint: () => void) {
  const ro = new ResizeObserver(paint); ro.observe(el);
  const mo = new MutationObserver(paint); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  return () => { ro.disconnect(); mo.disconnect(); };
}

/** Runs `frame` every animation frame while the canvas is on screen and the tab is showing. */
function whileShown(el: HTMLCanvasElement, frame: (t: number, dt: number) => void) {
  let raf = 0, shown = false, last = 0;
  const tick = (t: number) => { raf = 0; const dt = Math.min(t - last, 50); last = t; frame(t, dt); if (shown && !document.hidden) raf = requestAnimationFrame(tick); };
  const start = () => { if (!raf && shown && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(tick); } };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };
  const io = new IntersectionObserver(([en]) => { shown = en.isIntersecting; shown ? start() : stop(); });
  io.observe(el);
  const vis = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', vis);
  return () => { stop(); io.disconnect(); document.removeEventListener('visibilitychange', vis); };
}

export function FormMorph() {
  const cv = useRef<HTMLCanvasElement>(null);
  const [i, setI] = useState(0);

  useEffect(() => {
    const el = cv.current!, calm = still();
    const geos = FORMS.map((f) => geoOf(WIRE[f.key])), now = emptyGeo();
    let from: Geo = geos[0], to = 0, t0 = performance.now() - MORPH, held = false, yaw = 0.6;
    mix(from, geos[0], 1, now);
    const paint = () => draw(el, now, yaw);
    const next = () => { from = { y: now.y.slice(), p: now.p.slice() }; to = (to + 1) % FORMS.length; t0 = performance.now(); setI(to); };
    paint();
    const off = redrawOn(el, paint);
    if (calm) {
      const tick = setInterval(() => { next(); mix(from, geos[to], 1, now); paint(); }, MORPH + HOLD);
      return () => { off(); clearInterval(tick); };
    }
    const stop = whileShown(el, (t, dt) => {
      if (!held) yaw += dt * TURN; else t0 += dt; // hovering holds the form (and the turn)
      const e = t - t0;
      mix(from, geos[to], ease(Math.min(e / MORPH, 1)), now);
      paint();
      if (e > MORPH + HOLD) next();
    });
    const box = el.parentElement!, on = () => { held = true; }, out = () => { held = false; };
    box.addEventListener('pointerenter', on); box.addEventListener('pointerleave', out);
    return () => { off(); stop(); box.removeEventListener('pointerenter', on); box.removeEventListener('pointerleave', out); };
  }, []);

  const f = FORMS[i];
  return (
    <div class="morph reveal" role="img" aria-label={`A building drawn in UrbanPlan Pro, turning from one template into the next. Now: ${f.title}, ${f.body}`}>
      <canvas ref={cv} aria-hidden="true" />
      <p class="morph-cap" aria-hidden="true"><b key={f.key}>{f.title}</b><span key={`${f.key}-b`}>{f.body}</span></p>
    </div>
  );
}

/** One template, turning slowly while on screen. */
export function WireSpin({ id, label, class: cls = '' }: { id: string; label: string; class?: string }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = cv.current!, g = geoOf(WIRE[id]);
    let yaw = 0.6;
    const paint = () => draw(el, g, yaw);
    paint();
    const off = redrawOn(el, paint);
    if (still()) return off;
    const stop = whileShown(el, (_t, dt) => { yaw += dt * TURN * 1.5; paint(); });
    return () => { off(); stop(); };
  }, [id]);
  return <div class={`wire ${cls}`} role="img" aria-label={label}><canvas ref={cv} aria-hidden="true" /></div>;
}

/** One template, still. */
export function WireStill({ id, class: cls = '' }: { id: string; class?: string }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = cv.current!, g = geoOf(WIRE[id]);
    const paint = () => draw(el, g, 0.6, [0.8, 0.74]);
    paint();
    return redrawOn(el, paint);
  }, [id]);
  return <div class={`wire ${cls}`} aria-hidden="true"><canvas ref={cv} /></div>;
}
