'use client';
// The Airing page (/calendar): a month with the picked day's drawer under its week; on the phone, a timeline from today.
import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { airDays, type Ep } from './Airing';
import { getJ } from './lib/api';
import { DASH, epLabel, hhmm } from './lib/format';
import { usePhone } from './lib/home';
import { Icon, PATHS } from './lib/icons';
import type { AirEp } from './lib/media';
import { Ring } from './Stats';

type Planned = { key: string; name: string; what: string; poster: string | null; movie: boolean; at: number };
type Item = Ep & { what?: string };
type Kind = 'all' | 'series' | 'anime';
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY = 86400000;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// the drawer's track, lined up under the picked date
function place(row: HTMLElement | null, pg: HTMLElement | null) {
  const track = row?.firstElementChild as HTMLElement | null, cur = track?.querySelector<HTMLElement>('.cal-g.cur'), cell = pg?.querySelector('.cal-day.sel');
  if (!row || !track || !cur) return;
  row.classList.remove('wrap');
  if (!cell || row.classList.contains('alone') || innerWidth <= 800 || cur.offsetWidth > row.clientWidth) {
    track.style.transform = ''; row.classList.remove('cut-l', 'cut-r', 'edge-l', 'edge-r');
    if (cell && innerWidth > 800 && cur.offsetWidth > row.clientWidth) row.classList.add('wrap');
    return;
  }
  const r = row.getBoundingClientRect(), at = Math.max(0, Math.min(cell.getBoundingClientRect().left - r.left, r.width - cur.offsetWidth)), x = Math.round(at - (cur.getBoundingClientRect().left - track.getBoundingClientRect().left));
  track.style.transform = `translateX(${x}px)`;
  const edgeL = at === 0, edgeR = at + cur.offsetWidth >= r.width - 0.5;
  row.classList.toggle('cut-l', !edgeL && x < 0);
  row.classList.toggle('cut-r', !edgeR && x + track.scrollWidth > r.width);
  row.classList.toggle('edge-l', edgeL);
  row.classList.toggle('edge-r', edgeR);
}

export function Calendar() {
  const [schedule, setSchedule] = useState<AirEp[] | null>(null);
  const [planned, setPlanned] = useState<Planned[]>([]);
  const [err, setErr] = useState('');
  const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [sel, setSel] = useState(today);
  const [kind, setKind] = useState<Kind>('all');
  const [unwatched, setUnwatched] = useState(false);
  const [plan, setPlan] = useState(true);
  const phone = usePhone(), [filters, setFilters] = useState(false);
  useEffect(() => {
    getJ<{ schedule: AirEp[] }>('/api/airing').then((r) => setSchedule(r.schedule), (e: Error) => setErr(e.message));
    getJ<{ planned: Planned[] }>('/api/airing?plan=1').then((r) => setPlanned(r.planned), () => {});
  }, []);

  const first = new Date(today.getFullYear(), today.getMonth(), 1), last = new Date(today.getFullYear(), today.getMonth() + 2, 0);
  const month = new Date(sel.getFullYear(), sel.getMonth(), 1), next = month > first;
  const go = (d: Date) => setSel(d < first ? first : d > last ? last : d);
  // a step in the drawer keeps it in place on screen
  const drawerEl = useRef<HTMLDivElement>(null), page = useRef<HTMLDivElement>(null), held = useRef<number | null>(null);
  const step = (d: Date) => { held.current = drawerEl.current?.getBoundingClientRect().top ?? null; go(d); };
  useLayoutEffect(() => {
    const el = drawerEl.current, pg = page.current;
    if (held.current == null && pg) pg.style.paddingBottom = '';
    if (held.current != null && el && pg) {
      const by = el.getBoundingClientRect().top - held.current, room = document.documentElement.scrollHeight - innerHeight - scrollY;
      if (by > room) pg.style.paddingBottom = `${(parseFloat(pg.style.paddingBottom) || 0) + by - room}px`;
      window.scrollBy(0, by);
    }
    held.current = null;
  }, [sel]);
  const rowEl = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => place(rowEl.current, page.current));
  useEffect(() => {
    const on = () => place(rowEl.current, page.current);
    addEventListener('resize', on);
    void document.fonts.ready.then(on);
    return () => removeEventListener('resize', on);
  }, []);

  const byDay = airDays(schedule || []);
  // Plan to watch dates (UTC days)
  for (const p of plan ? planned : []) {
    const u = new Date(p.at);
    (byDay[new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()).toDateString()] ??= []).push({ src: 'series', title: p.name, ep: null, at: p.at, dayOnly: true, poster: p.poster, what: p.what } as Item);
  }
  const epsOf = (d: Date): Item[] => (byDay[d.toDateString()] || [])
    .filter((e: Item) => (e.what ? kind === 'all' : kind === 'all' || e.src === kind) && !(unwatched && e.watched))
    .sort((a: Item, b: Item) => (Number(!b.what) - Number(!a.what)) || (Number(!!a.dayOnly) - Number(!!b.dayOnly)) || a.at - b.at);

  const n = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(), lead = (month.getDay() + 6) % 7;
  const cells: (Date | null)[] = [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  const same = (a: Date, b: Date) => a.getTime() === b.getTime();

  // the drawer's days
  const mid = epsOf(sel), alone = mid.length >= 7, left: Date[] = [], right: Date[] = [];
  if (!alone)
    for (const [side, dir] of [[left, -1], [right, 1]] as const) {
      let cards = 0;
      for (let k = 1; cards < 8; k++) {
        const d = addDays(sel, dir * k);
        if (d < first || d > last) break;
        if (dir < 0) side.unshift(d); else side.push(d);
        cards += Math.max(epsOf(d).length, 1);
      }
    }
  const word = (d: Date) => {
    const diff = Math.round((d.getTime() - today.getTime()) / DAY);
    return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : d.toLocaleDateString('en-GB', { weekday: 'short' });
  };
  const group = (d: Date, main = false) => {
    const eps = main ? mid : epsOf(d);
    return (
      <div key={d.toDateString()} className={`cal-g${main ? ' cur' : ''}${same(d, today) ? ' today' : ''}`}>
        <button type="button" className="cal-gd" onClick={() => step(d)} aria-label={d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}>
          <span className="cal-gn" style={{ '--fill': `${Math.min(eps.length, 4) * 25}%` } as CSSProperties}>{d.getDate()}</span><span className="cal-gw">{word(d)}</span>
        </button>
        <div className="cal-cards">
          {eps.map((e, i) => (
            <div key={i} className={`cal-card${e.watched ? ' done' : ''}${e.what ? ' plan' : ''}`} aria-label={`${e.title} · ${e.what || epLabel(e)}${e.watched ? ' · watched' : ''}`}>
              <span className="cal-p">{e.poster && <img alt="" loading="lazy" src={e.poster} />}<span className="cal-t">{e.watched ? '✓' : e.dayOnly ? DASH : hhmm(e.at)}</span></span>
              <b>{e.title}</b>
              <span className="air-sub">{!e.what && <i className={`air-src ${e.src}`} />}{e.what || epLabel(e)}</span>
            </div>
          ))}
          {!eps.length && <span className="cal-empty">Nothing airing</span>}
        </div>
      </div>
    );
  };
  const col = (sel.getDay() + 6) % 7;
  const drawer = (
    <div ref={drawerEl} className="cal-drawer" role="region" aria-label={`${sel.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}, with the days around it`}
      style={{ '--col': col } as CSSProperties}>
      <button type="button" className="rbtn" aria-label="Previous day" disabled={same(sel, first)} onClick={() => step(addDays(sel, -1))}><Icon d="M15 6l-6 6 6 6" size={16} width={2.2} /></button>
      <div ref={rowEl} className={`cal-row${alone ? ' alone' : ''}`}>
        <div className="cal-track">{left.map((d) => group(d))}{group(sel, true)}{right.map((d) => group(d))}</div>
      </div>
      <button type="button" className="rbtn" aria-label="Next day" disabled={same(sel, last)} onClick={() => step(addDays(sel, 1))}><Icon d="M9 6l6 6-6 6" size={16} width={2.2} /></button>
    </div>
  );

  // the phone's timeline
  const ymd = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const timeline: ReactNode[] = [], rowOf: Record<string, string> = {};
  for (let d = today; d <= last;) {
    if (d.getDate() === 1 && !same(d, today)) timeline.push(<h2 key={`m${ymd(d)}`} className="sh cal-tl-month">{d.toLocaleDateString('en-GB', { month: 'long' })}</h2>);
    const eps = epsOf(d), id = `tl-${ymd(d)}`;
    let end = d;
    if (!eps.length) while (addDays(end, 1) <= last && addDays(end, 1).getDate() !== 1 && !epsOf(addDays(end, 1)).length) end = addDays(end, 1);
    for (let x = d; x <= end; x = addDays(x, 1)) rowOf[ymd(x)] = id;
    const after = addDays(end, 1);
    timeline.push(
      <div key={id} id={id} className={`cal-tl-day${eps.length ? '' : ' none'}${same(d, today) ? ' today' : ''}`}>
        <div className="cal-tl-d">
          <span className="cal-tl-w">{same(d, today) ? 'Today' : d.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
          <span className="cal-tl-n" style={{ '--fill': `${Math.min(eps.length, 4) * 25}%` } as CSSProperties}>{d.getDate()}</span>
        </div>
        <div className="cal-tl-eps">
          {eps.map((e, i) => (
            <div key={i} className={`cal-tl-ep${e.watched ? ' done' : ''}${e.what ? ' plan' : ''}`} aria-label={`${e.title} · ${e.what || epLabel(e)}${e.watched ? ' · watched' : ''}`}>
              <span className="cal-tl-p">{e.poster && <img alt="" loading="lazy" src={e.poster} />}</span>
              <span className="cal-tl-tx"><b>{e.title}</b><span className="air-sub">{!e.what && <i className={`air-src ${e.src}`} />}{e.what || epLabel(e)}{e.watched ? ' · ✓' : e.dayOnly ? '' : ` · ${hhmm(e.at)}`}</span></span>
            </div>
          ))}
          {!eps.length && <span className="cal-tl-none">{end > d && after <= last && after.getDate() !== 1 ? `Nothing airing until ${after.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}` : 'Nothing airing'}</span>}
        </div>
      </div>,
    );
    d = after;
  }
  const bars: Date[] = [];
  for (let d = today; d <= last; d = addDays(d, 1)) bars.push(d);

  const pick = (label: string, on: boolean, onClick: () => void, face: React.ReactNode, disabled = false) => (
    <button type="button" className={on ? 'on' : ''} aria-pressed={on} disabled={disabled} onClick={onClick}><Ring on={on}>{face}</Ring>{label}</button>
  );
  const icon = (d: string) => <Icon d={d} size={18} width={1.9} />;
  return (
    <div className="stats" ref={page}>
      <div className="st-head">
        <h1 className="st-title">Airing</h1>
        {phone && <div className="st-period cal-filter">{pick('Filters', filters, () => setFilters(!filters), icon('M4 6h16M7 12h10M10 18h4'))}</div>}
        {(!phone || filters) && <div className="cal-tools">
          {!phone && <div className="st-period" role="group" aria-label="Month">
            {pick('Earlier', false, () => setSel(today), icon('M15 6l-6 6 6 6'), !next)}
            {pick(month.toLocaleDateString('en-GB', { month: 'long' }), true, () => setSel(next ? today : addDays(last, 1 - last.getDate())), <b>{month.toLocaleDateString('en-GB', { month: 'short' })}</b>)}
            {pick('Later', false, () => go(addDays(last, 1 - last.getDate())), icon('M9 6l6 6-6 6'), next)}
            {pick('Today', same(sel, today), () => setSel(today), icon('M12 8v4l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z'))}
          </div>}
          <div className="st-period" role="group" aria-label="What">
            {pick('All', kind === 'all', () => setKind('all'), icon('M4 6h16M4 12h16M4 18h16'))}
            {pick('Shows', kind === 'series', () => setKind('series'), icon(PATHS.tv))}
            {pick('Anime', kind === 'anime', () => setKind('anime'), icon(PATHS.anime))}
          </div>
          <div className="st-period" role="group" aria-label="Show">
            {pick('Unwatched', unwatched, () => setUnwatched(!unwatched), icon(PATHS.tick))}
            {pick('Plan to watch', plan, () => setPlan(!plan), icon(PATHS.bookmark))}
          </div>
          <div className="st-period">
            <Link href="/settings/api"><Ring>{icon(`${PATHS.cal}M12 13v5M9.5 15.5h5`)}</Ring>Subscribe</Link>
          </div>
        </div>}
      </div>
      {err && <p className="st-note">{`Couldn't load the calendar (${err}).`}</p>}
      {phone ? schedule && (
        <>
          <div className="cal-strip" role="group" aria-label="Days">
            {bars.map((d) => {
              const k = epsOf(d).length;
              return (
                <button key={ymd(d)} type="button" className={`cal-sd${same(d, today) ? ' today' : ''}`} aria-label={d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' })}
                  onClick={() => document.getElementById(rowOf[ymd(d)])?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                  <span className="cal-sw">{d.toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2)}</span>
                  <span className="cal-sn" style={{ '--fill': `${Math.min(k, 4) * 25}%` } as CSSProperties}>{d.getDate()}</span>
                </button>
              );
            })}
          </div>
          <div className="cal-tl">{timeline}</div>
        </>
      ) : <section className="glass st-card cal" aria-label={month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}>
        <div className="cal-week">{WD.map((w, i) => <span key={w} className={`cal-wd${!next && i === (now.getDay() + 6) % 7 ? ' now' : ''}`}>{w}</span>)}</div>
        {weeks.map((wk, w) => (
          <div key={w}>
            <div className="cal-week">
              {wk.map((d, i) => {
                if (!d) return <span key={i} className="cal-blank" />;
                const eps = epsOf(d), on = same(d, sel);
                return (
                  <button key={i} type="button" className={`cal-day${same(d, today) ? ' today' : d < today ? ' past' : ''}${on ? ' sel' : ''}`} aria-expanded={on}
                    aria-label={`${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}, ${eps.length} episode${eps.length === 1 ? '' : 's'}`} onClick={() => setSel(d)}>
                    <span className="cal-n" style={{ '--fill': `${Math.min(eps.length, 4) * 25}%` } as CSSProperties}>{d.getDate()}</span>
                    {eps.slice(0, 3).map((e, k) => (
                      <span key={k} className={`air-row${e.watched ? ' done' : ''}${e.what ? ' plan' : ''}`}>
                        <span className="air-c"><img alt="" loading="lazy" src={e.poster || e.cover || undefined} hidden={!(e.poster || e.cover)} /></span>
                        <span className="air-tx"><b>{e.title}</b><span className="air-sub">{!e.what && <i className={`air-src ${e.src}`} />}{e.what || epLabel(e)}</span></span>
                      </span>
                    ))}
                    {eps.length > 3 && <span className="cal-more">+{eps.length - 3} more</span>}
                  </button>
                );
              })}
            </div>
            {schedule && wk.some((d) => d && same(d, sel)) && drawer}
          </div>
        ))}
      </section>}
    </div>
  );
}
