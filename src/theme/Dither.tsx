// A canvas with the brand's animated dither (./ditherEngine.ts): the mark, or a loading/working state.
import { useEffect, useRef } from 'preact/hooks';
import { dither, type Field, type FIELDS } from './ditherEngine';

export function Dither({ field = 'noise', cell = 3, inverse = false, class: cls, style }: { field?: Field | keyof typeof FIELDS; cell?: number; inverse?: boolean; class?: string; style?: string }) {
  const r = useRef<HTMLCanvasElement>(null);
  useEffect(() => dither(r.current!, { field, cell, inverse }), [field, cell, inverse]);
  return <canvas ref={r} class={cls} style={style} aria-hidden="true" />;
}
