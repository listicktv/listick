'use client';
// Airing, beside History and Up next: a calendar (Week or Month) of what airs from the shows and anime you played lately (from
// the History: upnext.ts), and under it the selected day's episodes and the rest of that week, day by day. Above it: See all
// and the week or month before and after.
import Link from 'next/link';
import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react';
import { PkBtn } from './Cards';
import { DASH, dayWord, epLabel, hhmm } from './lib/format';
import { Icon } from './lib/icons';
import { usePhone } from './lib/home';
import type { AirEp, Summary } from './lib/media';

export type Ep = { src: 'anime' | 'series'; title: string; season?: number | null; ep: number | null; epTo?: number; at: number; dayOnly?: boolean;
  watched?: boolean; poster?: string | null; cover?: string | null };

// episodes by day; a season out on one day is one entry, "S2 E1–8"
export function airDays(schedule: AirEp[] = []) {
  const byDay: Record<string, Ep[]> = {};
  for (const v of schedule) (byDay[new Date(v.at).toDateString()] ??= []).push({ ...v, src: v.anime ? 'anime' : 'series' });
  for (const [k, eps] of Object.entries(byDay)) {
    const out: Ep[] = [];
    for (const e of [...eps].sort((x, y) => (x.ep ?? 0) - (y.ep ?? 0))) {
      const same = out.find((o) => o.src === e.src && o.title === e.title && o.season === e.season && o.ep != null && e.ep != null);
      if (same) { same.epTo = Math.max(same.epTo || same.ep!, e.ep!); same.watched = same.watched && e.watched; } else out.push({ ...e });
    }
    byDay[k] = out;
  }
  return byDay;
}

export function Airing({ S }: { S: Summary | null }) {
  const phone = usePhone();
  // the phone opens on Week (Month makes the panel tall there)
  const [view, setView] = useState<'week' | 'month'>(() => (matchMedia('(max-width: 800px)').matches ? 'week' : 'month'));
  const [sel, setSel] = useState<string | null>(null);
  const [off, setOff] = useState(0);
  const [all, setAll] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(false);
  const edge = () => { const l = list.current; if (l) setAtEnd(l.scrollTop + l.clientHeight >= l.scrollHeight - 4); };
  useEffect(() => { const f = requestAnimationFrame(edge); return () => cancelAnimationFrame(f); });

  const now = new Date(), today = now.toDateString();
  const picks = (
    <div className="pk-set" id="air-pick" role="group" aria-label="Airing view">
      <PkBtn label="Week" data={{ air: 'week' }} on={view === 'week'} face="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h2M12 14h2M16 14h2" onClick={() => { setView('week'); setOff(0); setSel(null); }} />
      <PkBtn label="Month" data={{ air: 'month' }} on={view === 'month'} face="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M7.5 13.5h.01M12 13.5h.01M16.5 13.5h.01M7.5 17h.01M12 17h.01" onClick={() => { setView('month'); setOff(0); setSel(null); }} />
    </div>
  );
  // the week or month shown
  const mon0 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const first = new Date(now.getFullYear(), now.getMonth(), 1), last = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  const at = view === 'week' ? new Date(mon0.getFullYear(), mon0.getMonth(), mon0.getDate() + off * 7) : new Date(now.getFullYear(), now.getMonth() + off, 1);
  const end = view === 'week' ? new Date(at.getFullYear(), at.getMonth(), at.getDate() + 6) : new Date(at.getFullYear(), at.getMonth() + 1, 0);
  const canBack = off > 0 || (view === 'week' && at > first), canNext = view === 'week' ? end < last : off < 1;
  const move = (by: number) => {
    const o = off + by, a = view === 'week' ? new Date(mon0.getFullYear(), mon0.getMonth(), mon0.getDate() + o * 7) : new Date(now.getFullYear(), now.getMonth() + o, 1);
    setOff(o); setSel(o ? new Date(Math.max(a.getTime(), first.getTime())).toDateString() : null);
  };
  const panel = (sub: string, cal: React.ReactNode, body: React.ReactNode) => (
    <>
      {/* level with History's title row */}
      <div className="group-head cal-gh">
        <h2 className="sh" aria-hidden="true">&nbsp;</h2>
        <div className="rail-nav">
          <Link href="/calendar" className="rbtn" aria-label="See all"><Icon d="M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z" size={15} /></Link>
          <span className="rsep" aria-hidden="true" />
          <button type="button" className="rbtn rarrow" aria-label={view === 'week' ? 'Week before' : 'Month before'} disabled={!canBack} onClick={() => move(-1)}><Icon d="M15 6l-6 6 6 6" size={16} width={2.2} /></button>
          <button type="button" className="rbtn rarrow" aria-label={view === 'week' ? 'Week after' : 'Month after'} disabled={!canNext} onClick={() => move(1)}><Icon d="M9 6l6 6-6 6" size={16} width={2.2} /></button>
        </div>
      </div>
      <div className="glass panel air-panel">
        <div className="air-top"><div className="air-title"><h2 className="sh">Airing</h2><span className="air-when" id="air-sub">{sub}</span></div>{picks}</div>
        <div id="air-cal">{cal}</div><div className="divider" />
        <div className="act-box"><div ref={list} className={`act-scroll${atEnd ? ' at-end' : ''}`} id="air-list" onScroll={edge}>{body}</div></div>
      </div>
    </>
  );
  if (!S) return panel('', null, null);

  const byDay = airDays(S.schedule);

  // month: each day a circle whose accent ring fills by what airs (a quarter per episode, up to four); week: seven
  // ringed circles with dots under them. Today is filled in the accent either way
  let days: Date[], lead = 0;
  if (view === 'month') {
    lead = (at.getDay() + 6) % 7;
    days = Array.from({ length: end.getDate() }, (_, i) => new Date(at.getFullYear(), at.getMonth(), i + 1));
  } else days = Array.from({ length: 7 }, (_, i) => new Date(at.getFullYear(), at.getMonth(), at.getDate() + i));
  const selKey = sel || today;
  const cal = (
    <div className={`acal ${view}`}>
      {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((w, i) => <span key={w} className={`wd${!off && i === (now.getDay() + 6) % 7 ? ' now' : ''}`}>{w}</span>)}
      {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
      {days.map((d) => {
        const key = d.toDateString(), n = (byDay[key] || []).length;
        return (
          <button key={key} type="button" className={`aday${key === today ? ' today' : d < new Date(today) ? ' past' : ''}${key === selKey ? ' sel' : ''}${n ? ' has' : ''}`}
            style={{ '--fill': `${Math.min(n, 4) * 25}%` } as CSSProperties} aria-label={`${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}, ${n} episode${n === 1 ? '' : 's'}`}
            onClick={() => setSel(key)}>
            <span className="n">{d.getDate()}</span><span className="dots">{Array.from({ length: Math.min(n, 4) }, (_, i) => <span key={i} />)}</span>
          </button>
        );
      })}
    </div>
  );
  const dm = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const sub = view === 'month' ? at.toLocaleDateString('en-GB', { month: 'long' }) : !off ? 'This week' : off === 1 ? 'Next week' : `${dm(at)} – ${dm(end)}`;

  // the selected day (today unless a day was tapped), then the rest of that week, day by day; empty days are skipped
  const start = new Date(selKey);
  const dayEps = (d: Date) => (byDay[d.toDateString()] || []).sort((a, b) => (Number(!!a.dayOnly) - Number(!!b.dayOnly)) || a.at - b.at);
  // day titles only ("TODAY", "FRI 16")
  const dayHead = (d: Date) => {
    const w = dayWord(d.getTime());
    return <h3 className="sh air-day">{w === 'today' || w === 'tomorrow' ? w.toUpperCase() : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }).toUpperCase()}</h3>;
  };
  // rows like the cards: the poster in a ringed circle, the title over the episode (a dot: anime or series), the
  // time on the right; a watched one is dimmed with a tick
  const rows = (eps: Ep[]) => (
    <div className="air-rows">
      {eps.map((e, i) => (
        <div key={i} className={`air-row${e.watched ? ' done' : ''}`} aria-label={`${e.title} · ${epLabel(e)}${e.watched ? ' · watched' : ''}`}>
          <span className="air-c"><img alt="" loading="lazy" src={e.poster || e.cover || undefined} hidden={!(e.poster || e.cover)} /></span>
          <span className="air-tx"><b>{e.title}</b><span className="air-sub"><i className={`air-src ${e.src}`} />{epLabel(e)}</span></span>
          <span className="air-t">{e.watched ? '✓' : e.dayOnly ? DASH : hhmm(e.at)}</span>
        </div>
      ))}
    </div>
  );
  // two weeks: the agenda fills the panel beside History and Up next and scrolls inside it. On the phone (where it isn't
  // beside anything) one week, the next 5 episodes of it, then "All N episodes"
  const cap = phone && !all ? 5 : Infinity;
  let shown = 0, total = 0;
  const body: React.ReactNode[] = [];
  for (let i = 0; i < (phone ? 7 : 14); i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const eps = dayEps(d); total += eps.length;
    if (!i && !eps.length) { body.push(<Fragment key={i}>{dayHead(d)}<div className="lbl air-none">Nothing airing.</div></Fragment>); continue; }
    const take = eps.slice(0, Math.max(0, cap - shown)); shown += take.length;
    if (take.length) body.push(<Fragment key={i}>{dayHead(d)}{rows(take)}</Fragment>);
  }
  if (phone && total > 5) body.push(
    <button key="more" type="button" className="tc-more" onClick={() => setAll(!all)}>
      <span>{all ? 'Fewer episodes' : `All ${total} episodes`}</span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={all ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} /></svg>
    </button>,
  );
  return panel(sub, cal, body);
}
