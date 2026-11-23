// Reports (docs/plans/pro-ia-rethink.md §2.7): Numbers and Approval as a panel up from the bottom, over the view, on a
// wide screen. The scorecard is the way in (Built-up, Profit and IRR open Numbers; Rules opens Approval; the same
// figure again closes it), and so are N and A. The view stays above it, the pick stays, and Esc closes it back to the
// view. It says how much of the view it covers, so the 3D and its tools keep clear.
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { Btn } from './ui';

export type ReportKind = 'numbers' | 'approve';

export function Report({ which, set, close, cover, fails, children }: {
  which: ReportKind; set: (r: ReportKind) => void; close: () => void;
  /** how much of the view it covers from the bottom (px) */
  cover: (y: number) => void;
  /** failing or to-check rules: a dot on the Approval tab */
  fails: number;
  children: ComponentChildren;
}) {
  const root = useRef<HTMLElement>(null), body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = root.current; if (!el) return;
    const f = () => cover(Math.round(el.getBoundingClientRect().height) + 12);
    f();
    const ro = new ResizeObserver(f); ro.observe(el);
    return () => { ro.disconnect(); cover(0); };
  }, []);
  // (a new tab starts at its top)
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [which]);
  const keys = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && !ev.defaultPrevented && !(ev.target as HTMLElement).closest('[role="listbox"], [aria-expanded="true"]')) { ev.preventDefault(); ev.stopPropagation(); close(); return; }
    // (typing in a field here isn't a shortcut on the view)
    if (ev.key !== 'Escape') ev.stopPropagation();
  };
  const tab = (k: ReportKind, label: string, key: string) => (
    <button type="button" role="tab" aria-selected={which === k} class={which === k ? 'on' : ''} onClick={() => set(k)} data-tip={`${label} (${key})`}>
      {label}{k === 'approve' && fails > 0 && <i class="dot bad" aria-label={`${fails} to look at`} />}
    </button>
  );
  return (
    <section ref={root} class="report" aria-label={which === 'numbers' ? 'Numbers' : 'Approval'} onKeyDown={keys}>
      <header>
        <div class="report-t" role="tablist" aria-label="Reports">{tab('numbers', 'Numbers', 'N')}{tab('approve', 'Approval', 'A')}</div>
        <small class="muted">{which === 'numbers' ? 'Is it worth it: the area statement, the flats, the money, the deal.' : 'Will it pass: the checks, the permission, NOCs, fees, documents, drawings.'}</small>
        <span class="gap" />
        <Btn kind="quiet" icon="x" title="Close (Esc)" onClick={close} />
      </header>
      <div class="report-b panel-b" ref={body}>{children}</div>
    </section>
  );
}
