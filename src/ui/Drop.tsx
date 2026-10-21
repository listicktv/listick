'use client';
// A dropdown: the setting's name, its value in a field, the options in a menu under it (ticks; one that takes several stays
// open as you pick); a long one (countries, years) has a search at its top. The name keeps to one line (all of it on hover),
// so the fields in a row line up. Closes on a click outside or Escape, which it
// keeps from closing the sheet it's in
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, PATHS } from './lib/icons';

type Opt<T> = [T, string];
type One<T> = { multi?: false; value: T; set: (v: T) => void };
type Many<T> = { multi: true; value: T[]; set: (v: T[]) => void };
// bare: no name over the field (in a bar of other controls), only for screen readers
export function Drop<T extends string | number>(p: { label: ReactNode; opts: Opt<T>[]; search?: boolean; empty?: string; bare?: boolean } & (One<T> | Many<T>)) {
  const [open, setOpen] = useState(false), [q, setQ] = useState(''), box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc, true); };
  }, [open]);
  const on = (v: T) => (p.multi ? p.value.includes(v) : p.value === v);
  const shown = p.opts.filter(([v]) => on(v)).map(([, n]) => n);
  const pick = (v: T) => {
    if (p.multi) p.set(on(v) ? p.value.filter((x) => x !== v) : [...p.value, v]);
    else { p.set(v); setOpen(false); }
  };
  const list = q ? p.opts.filter(([, n]) => n.toLowerCase().includes(q.toLowerCase())) : p.opts;
  return (
    <div className={`dd${p.bare ? ' bare' : ''}`} ref={box}>
      {!p.bare && <span className="dd-l" title={typeof p.label === 'string' ? p.label : undefined}>{p.label}</span>}
      <button type="button" className={`dd-f${open ? ' open' : ''}`} aria-haspopup="listbox" aria-expanded={open} aria-label={p.bare && typeof p.label === 'string' ? p.label : undefined}
        onClick={() => { setOpen(!open); setQ(''); }}>
        <span className={`dd-v${shown.length ? '' : ' dim'}`}>{shown.length ? shown.join(', ') : p.empty || 'Any'}</span>
        <Icon d="M6 9l6 6 6-6" size={17} width={1.9} />
      </button>
      {open && (
        <div className="dd-m" role="listbox" aria-multiselectable={!!p.multi}>
          {p.search && (
            <label className="dd-q"><Icon d={PATHS.search} size={16} width={1.9} />
              <input autoFocus placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /></label>
          )}
          {list.map(([v, n]) => (
            <button key={String(v)} type="button" role="option" aria-selected={on(v)} className={on(v) ? 'on' : undefined} onClick={() => pick(v)}>
              <span className="dd-ck">{on(v) && <Icon d={PATHS.tick} size={15} width={2.2} />}</span>{n}
            </button>
          ))}
          {q && !list.length && <p className="dd-none">No matches</p>}
        </div>
      )}
    </div>
  );
}
