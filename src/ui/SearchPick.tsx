'use client';
// A search picker (the builder's keywords, people and studios): a name typed into the field, TMDB's matches in a menu under it,
// each pick a tag below; a tag that can be left out (keywords, studios) turns struck through on a tap, its × takes it away
import { useEffect, useRef, useState } from 'react';
import { getJ } from './lib/api';
import { Icon, PATHS } from './lib/icons';

export type Picked = { id: number; name: string; out?: boolean };
type Hit = { id: number; name: string; sub: string | null; image: string | null };
export function SearchPick({ kind, label, value, set, canOut }: { kind: 'keyword' | 'person' | 'company'; label: string; value: Picked[]; set: (v: Picked[]) => void; canOut?: boolean }) {
  const [text, setText] = useState(''), [hits, setHits] = useState<Hit[] | null>(null), box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const want = text.trim();
    if (want.length < 2) return;
    let live = true;
    const t = setTimeout(() => { getJ<{ results: Hit[] }>(`/api/lists/search?kind=${kind}&q=${encodeURIComponent(want)}`).then((r) => { if (live) setHits(r.results); }, () => {}); }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [text, kind]);
  useEffect(() => {
    if (!hits) return;
    const out = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setHits(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setHits(null); } };
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc, true); };
  }, [hits]);
  const add = (h: Hit) => { if (!value.some((x) => x.id === h.id)) set([...value, { id: h.id, name: h.name }]); setText(''); setHits(null); };
  return (
    <div className="sp" ref={box}>
      <span className="dd-l" title={label}>{label}</span>
      <div className="dd-f sp-f"><Icon d={PATHS.search} size={17} width={1.9} />
        <input value={text} placeholder="Search" aria-label={`Search ${label}`} onChange={(e) => { setText(e.target.value); if (e.target.value.trim().length < 2) setHits(null); }} /></div>
      {hits && text.trim().length >= 2 && (
        <div className="dd-m" role="listbox">
          {hits.length ? hits.map((h) => (
            <button key={h.id} type="button" role="option" aria-selected={value.some((x) => x.id === h.id)} onClick={() => add(h)}>
              {kind !== 'keyword' && <span className="sp-img">{h.image ? <img src={h.image} alt="" /> : h.name[0]}</span>}{h.name}{h.sub && <small>{h.sub}</small>}
            </button>)) : <p className="sp-none">No match</p>}
        </div>
      )}
      {value.length > 0 && <div className="sp-tags">{value.map((x) => (
        <span key={x.id} className={`b-tag${x.out ? ' no' : ''}`}>
          {canOut ? <button type="button" aria-pressed={!!x.out} title={x.out ? 'Left out' : 'Included'} onClick={() => set(value.map((y) => (y.id === x.id ? { ...y, out: !y.out || undefined } : y)))}>{x.name}</button> : x.name}
          <button type="button" className="b-x" aria-label={`Remove ${x.name}`} onClick={() => set(value.filter((y) => y.id !== x.id))}><Icon d={PATHS.cross} size={12} width={2.2} /></button>
        </span>))}</div>}
    </div>
  );
}
