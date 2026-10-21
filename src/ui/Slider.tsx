'use client';
// A slider over a list of steps: one handle (at least) or two (from, to). The first step is "Any" for from, the last "Any" for
// to (no limit there), each as undefined; the value shows beside the name. Two range inputs lie on one track, each handle its own
import type { ReactNode } from 'react';

type One = { range?: false; value: number | undefined; set: (v: number | undefined) => void };
type Two = { range: true; value: [number | undefined, number | undefined]; set: (v: [number | undefined, number | undefined]) => void };
export function Slider(p: { label: ReactNode; steps: number[]; show: (v: number) => string } & (One | Two)) {
  const last = p.steps.length - 1;
  // a value's step (the nearest at or below it), and back
  const at = (v: number | undefined, dflt: number) => (v === undefined ? dflt : Math.max(0, p.steps.findLastIndex((s) => s <= v)));
  const lo = at(p.range ? p.value[0] : p.value, 0), hi = p.range ? at(p.value[1], last) : last;
  const val = (i: number, end: 'lo' | 'hi') => ((end === 'lo' && i === 0) || (end === 'hi' && i === last) ? undefined : p.steps[i]);
  const text = p.range
    ? (lo === 0 && hi === last ? 'Any' : lo === 0 ? `up to ${p.show(p.steps[hi])}` : hi === last ? `${p.show(p.steps[lo])}+` : `${p.show(p.steps[lo])} – ${p.show(p.steps[hi])}`)
    : (lo === 0 ? 'Any' : `${p.show(p.steps[lo])}+`);
  const pct = (i: number) => `${(i / last) * 100}%`;
  return (
    <div className="sl">
      <div className="sl-h"><span className="dd-l">{p.label}</span><span className={`sl-v${text === 'Any' ? ' dim' : ''}`}>{text}</span></div>
      <div className="sl-track">
        <span className="sl-fill" style={{ left: p.range ? pct(lo) : pct(lo), right: p.range ? `calc(100% - ${pct(hi)})` : '0' }} data-none={!p.range && lo === 0 ? '' : undefined} />
        <input type="range" min={0} max={last} step={1} value={lo} aria-label={p.range ? `${typeof p.label === 'string' ? p.label : ''} from` : String(p.label)}
          onChange={(e) => { const i = Number(e.target.value); if (p.range) p.set([val(Math.min(i, hi), 'lo'), val(hi, 'hi')]); else p.set(val(i, 'lo')); }} />
        {p.range && <input type="range" min={0} max={last} step={1} value={hi} aria-label={`${typeof p.label === 'string' ? p.label : ''} to`}
          onChange={(e) => { const i = Number(e.target.value); p.set([val(lo, 'lo'), val(Math.max(i, lo), 'hi')]); }} />}
      </div>
    </div>
  );
}
