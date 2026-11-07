'use client';
// The History page (/history): what you watched in the last 30 days (?all=1: every play), newest first, day by day: each play as History's wide card (the episode or
// Movie, the time, your rating circle), the episodes of one show watched back to back as one card ("S1 E3–E5"). Movies, shows or
// anime; older days come in as you scroll.
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

// a day's plays as cards: one show's episodes watched one after another (newest first, a step apart, same season) join up
function cardsOf(plays: Play[]): Wide[] {
  const out: { p: Play; from: number }[] = [];
  for (const p of plays) {
    const o = out[out.length - 1];
    if (o && o.p.key === p.key && p.season === o.p.season && p.episode >= 0 && p.episode === o.from - 1) { o.from = p.episode; continue; }
    out.push({ p, from: p.episode });
  }
  return out.map(({ p, from }) => ({
    app: APP[p.source] || 'imported', ref: { key: p.key }, title: p.title, poster: p.poster, wide: p.backdrop, at: p.at,
    play: { key: p.key, season: p.season, episode: p.episode, mine: p.mine },
    sub: `${p.type === 'movie' ? 'Movie' : p.season >= 0 ? `${p.type === 'anime' ? '' : `S${p.season} `}E${from < p.episode ? `${from}–${p.episode}` : p.episode}` : ''} · ${p.approx === 1 ? 'date unknown' : hhmm(p.at)}`,
  }));
}

const KINDS = [['all', 'All', PATHS.lists], ['movie', 'Movies', PATHS.movie], ['tv', 'Shows', PATHS.tv], ['anime', 'Anime', PATHS.anime]] as const;
export function HistoryPage() {
  const [plays, setPlays] = useState<Play[] | null>(null), [more, setMore] = useState(false), [err, setErr] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [all] = useState(() => typeof location !== 'undefined' && new URLSearchParams(location.search).get('all') === '1');   // Lists' Watched: every play
  const phone = usePhone(), [filters, setFilters] = useState(false);   // a phone: the kinds behind one Filter circle
  const loading = useRef(false), end = useRef<HTMLDivElement>(null);
  // the newest page (again after a change on a card), then each older one
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    getJ<{ plays: Play[]; more: boolean }>(`/api/history${all ? '?all=1' : ''}`).then((r) => { if (live) { setPlays(r.plays); setMore(r.more); setErr(''); } }, (e: Error) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [n, all]);
  const gen = useRef(0);
  useEffect(() => { gen.current = n; }, [n]);
  const load = useCallback(async (last: Play) => {
    if (loading.current) return;
    loading.current = true;
    const g = gen.current;
    try {
      const r = await getJ<{ plays: Play[]; more: boolean }>(`/api/history?before=${last.at}&id=${last.id}${all ? '&all=1' : ''}`);
      if (g !== gen.current) return;
      setPlays((x) => [...(x || []), ...r.plays]); setMore(r.more);
    } catch (e) { setErr((e as Error).message); } finally { loading.current = false; }
  }, [all]);
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
  return (
    <ShelfWrap reload={() => setN((x) => x + 1)}>
      <div className="stats hist-page">
        <div className="st-head">
          <h1 className="st-title">History</h1>
          {phone ? <div className="pk-set fbtn"><PkBtn label="Filters" data={{}} face="M4 6h16M7 12h10M10 18h4" on={filters} pressed={filters} onClick={() => setFilters(!filters)} /></div>
            : <div className="pk-set" role="group" aria-label="Kind">{KINDS.map(([v, n, f]) =>
              <PkBtn key={v} label={n} data={{}} face={f} on={kind === v} pressed={kind === v} onClick={() => setKind(v)} />)}</div>}
        </div>
        {phone && filters && <div className="fpanel"><div className="pk-set" role="group" aria-label="Kind">{KINDS.map(([v, n, f]) =>
          <PkBtn key={v} label={n} data={{}} face={f} on={kind === v} pressed={kind === v} onClick={() => setKind(v)} />)}</div></div>}
        {err && <p className="st-note">{`Couldn't load your history (${err}).`}</p>}
        {plays && !shown.length && !more && <p className="st-note">Nothing watched here yet.</p>}
        {days.map((d) => (
          <section key={d.name} className="group">
            <div className="group-head"><h2 className="sh hist-day">{d.name}</h2></div>
            <div className="grid wcards hist-grid">{cardsOf(d.plays).map((w, i) => <HistCard key={`${w.play!.key}|${w.at}|${i}`} w={w} />)}</div>
          </section>
        ))}
        <div ref={end} aria-hidden="true" />
      </div>
    </ShelfWrap>
  );
}
