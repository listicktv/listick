'use client';
// The History page (/history): what you watched in the last 30 days (?all=1: every play), newest first, day by day: each play as History's wide card (the episode or
// Movie, the time, your rating circle). Movies, shows or anime; older days come in as you scroll.
import { useCallback, useEffect, useRef, useState } from 'react';
import { HistCard, PkBtn } from './Cards';
import { getJ } from './lib/api';
import { hhmm } from './lib/format';
import { usePhone } from './lib/home';
import { PATHS } from './lib/icons';
import type { TitleType, Wide } from './lib/media';
import { ShelfWrap } from './Shelf';

type Play = { id: number; key: string; season: number; episode: number; at: number; approx: number; source: string; title: string; label: string | null; type: TitleType; anime: boolean;
  poster: string | null; backdrop: string | null; mine: number | null };
type Kind = 'all' | 'movie' | 'tv' | 'anime';
const APP: Record<string, string> = { stremio: 'stremio', anilist: 'anilist', jellyfin: 'jellyfin', seanime: 'seanime', manual: 'manual', trakt: 'stremio', mdblist: 'stremio' };
const kindOf = (p: Play): Kind => (p.type === 'movie' ? 'movie' : p.anime || p.type === 'anime' ? 'anime' : 'tv');
const dayName = (t: number) => {
  const d = new Date(t), today = new Date(new Date().toDateString()).getTime(), days = Math.round((new Date(d.toDateString()).getTime() - today) / 86400000);
  return days === 0 ? 'Today' : days === -1 ? 'Yesterday'
    : `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })}`;
};

// the rail's day name and date
const whenOf = (t: number) => {
  const d = new Date(t), n = dayName(t);
  return { name: n === 'Today' || n === 'Yesterday' ? n : d.toLocaleDateString('en-GB', { weekday: 'long' }),
    date: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) }) };
};

// a day's plays as posters; a back-to-back run is one card
type Shown = { w: Wide; ep: string; time: string };
function cardsOf(plays: Play[]): Shown[] {
  const out: Shown[] = [];
  for (let i = 0; i < plays.length; i++) {
    const p = plays[i];
    let from = p.episode, j = i;
    while (p.type !== 'movie' && p.season >= 0) {
      const n = plays[j + 1];
      if (!n || n.key !== p.key || n.season !== p.season || n.episode !== from - 1 || plays[j].at - n.at > 3 * 3600000) break;
      from = n.episode; j++;
    }
    const ep = p.type === 'movie' ? 'Movie' : p.season >= 0 ? `${p.type === 'anime' ? '' : `S${p.season} `}E${from < p.episode ? `${from}–${p.episode}` : p.episode}` : '';
    const time = p.approx === 1 ? 'date unknown' : hhmm(p.at);
    out.push({ ep, time, w: { app: APP[p.source] || 'imported', ref: { key: p.key }, title: p.title, poster: p.poster, wide: null, at: p.at,
      play: { key: p.key, season: p.season, episode: p.episode, mine: p.mine, grouped: from < p.episode }, sub: `${ep} · ${time}` } });
    i = j;
  }
  return out;
}

type Period = 'month' | 'year' | 'all';
const PERIODS = [['month', 'Month', PATHS.cal], ['year', 'Year', 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h2M12 14h2M16 14h2M8 17h2'],
  ['all', 'All', 'M7 9a3 3 0 1 0 0 6c2 0 3-1.5 5-3s3-3 5-3a3 3 0 1 1 0 6c-2 0-3-1.5-5-3S9 9 7 9z']] as const;
const KINDS = [['all', 'All', PATHS.lists], ['movie', 'Movies', PATHS.movie], ['tv', 'Shows', PATHS.tv], ['anime', 'Anime', PATHS.anime]] as const;
export function HistoryPage() {
  const [plays, setPlays] = useState<Play[] | null>(null), [more, setMore] = useState(false), [err, setErr] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  // period (Lists' Watched opens on all)
  const [period, setPeriod] = useState<Period>(() => (typeof location !== 'undefined' && new URLSearchParams(location.search).get('all') === '1' ? 'all' : 'month'));
  const pick = (p: Period) => { if (p !== period) { setPeriod(p); setPlays(null); setMore(false); } };
  const phone = usePhone(), [filters, setFilters] = useState(false);   // a phone: the kinds behind one Filter circle
  const loading = useRef(false), end = useRef<HTMLDivElement>(null);
  // the newest page (again after a change on a card), then each older one
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    getJ<{ plays: Play[]; more: boolean }>(`/api/history?period=${period}`).then((r) => { if (live) { setPlays(r.plays); setMore(r.more); setErr(''); } }, (e: Error) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [n, period]);
  const gen = useRef(0);
  useEffect(() => { gen.current += 1; }, [n, period]);
  const load = useCallback(async (last: Play) => {
    if (loading.current) return;
    loading.current = true;
    const g = gen.current;
    try {
      const r = await getJ<{ plays: Play[]; more: boolean }>(`/api/history?before=${last.at}&id=${last.id}&period=${period}`);
      if (g !== gen.current) return;
      setPlays((x) => [...(x || []), ...r.plays]); setMore(r.more);
    } catch (e) { setErr((e as Error).message); } finally { loading.current = false; }
  }, [period]);
  // the next page when the end of the page comes near
  useEffect(() => {
    const el = end.current; if (!el || !more || !plays?.length) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) void load(plays[plays.length - 1]); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [more, plays, load]);

  const shown = (plays || []).filter((p) => kind === 'all' || kindOf(p) === kind);
  const days: { name: string; plays: Play[] }[] = [];
  for (const p of shown) {
    const name = dayName(p.at), d = days[days.length - 1];
    if (d?.name === name) d.plays.push(p); else days.push({ name, plays: [p] });
  }
  const periods = <div className="pk-set" role="group" aria-label="Period">{PERIODS.map(([v, l, f]) =>
    <PkBtn key={v} label={l} data={{}} face={f} on={period === v} pressed={period === v} onClick={() => pick(v)} />)}</div>;
  const kinds = <div className="pk-set" role="group" aria-label="Kind">{KINDS.map(([v, l, f]) =>
    <PkBtn key={v} label={l} data={{}} face={f} on={kind === v} pressed={kind === v} onClick={() => setKind(v)} />)}</div>;
  return (
    <ShelfWrap reload={() => setN((x) => x + 1)}>
      <div className="stats hist-page">
        <div className="st-head">
          <h1 className="st-title">History</h1>
          {phone ? <div className="pk-set fbtn"><PkBtn label="Filters" data={{}} face="M4 6h16M7 12h10M10 18h4" on={filters} pressed={filters} onClick={() => setFilters(!filters)} /></div>
            : <div className="pick-tools">{periods}<span className="pk-sep" />{kinds}</div>}
        </div>
        {phone && filters && <div className="fpanel">{periods}{kinds}</div>}
        {err && <p className="st-note">{`Couldn't load your history (${err}).`}</p>}
        {plays && !shown.length && !more && <p className="st-note">Nothing watched here yet.</p>}
        <div className="hist-rail">
          {days.map((d, i) => { const w = whenOf(d.plays[0].at); return (
            <section key={d.name} className="hist-row">
              <div className={`hist-when${i === 0 && w.name === 'Today' ? ' now' : ''}`}>
                <h2 className="hist-day">{w.name}</h2><span className="mono">{w.date}</span><span>{d.plays.length === 1 ? '1 play' : `${d.plays.length} plays`}</span>
              </div>
              <div className="hist-grid">{cardsOf(d.plays).map((c, j) => (
                <div key={`${c.w.play!.key}|${c.w.at}|${j}`} className="hplay"><HistCard w={c.w} /><div className="hcap"><span>{c.ep}</span><span className="mono">{c.time}</span></div></div>
              ))}</div>
            </section>
          ); })}
        </div>
        <div ref={end} aria-hidden="true" />
      </div>
    </ShelfWrap>
  );
}
