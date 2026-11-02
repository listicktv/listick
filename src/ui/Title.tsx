'use client';
// Title panel: small view and full page
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref as RRef } from 'react';
import { createPortal } from 'react-dom';
import { TrendCard, usePosterDial } from './Cards';
import { Circ, EpisodesPane, PickDay, airAt, fmtDay, timed } from './Episodes';
import { getJ, postJ } from './lib/api';
import { DASH, ago } from './lib/format';
import { useHome, usePhone } from './lib/home';
import { Icon } from './lib/icons';
import { TYPE_NAME, type Ref, type Tile } from './lib/media';
import { Group } from './Rail';
import { TopBar } from './Shell';
import { ShelfGrid } from './Shelf';
import { TitleCtx, loadTitle, setTitleNav, titleUrl, useTitle, type PersonRef, type PickArgs, type Title, type TitleState } from './lib/title';

export type TitlePanelApi = { open: (ref: Ref) => void };
type Body = { t?: Title; err?: string; loading?: boolean; top?: number; fade?: boolean };

// The card opens (.in: the backdrop fades, the card grows in) once its content is there, or with "Loading…" after 250 ms
// (on a phone a title opens on its full page, the Loading card sliding up meanwhile). An open card is a step in the browser's
// history, so Back closes it instead of leaving the page: closing goes back one step, and the popstate does the closing. It
// plays the opening backwards (.out), then hides the card. The scrim's hidden and in/out are set here directly.
export function TitlePanel({ ref }: { ref: RRef<TitlePanelApi> }) {
  const { reload } = useHome();
  const tp = useRef<HTMLDivElement>(null), panel = useRef<HTMLElement>(null), body = useRef<HTMLDivElement>(null);
  const x = useRef<HTMLButtonElement>(null);
  const seq = useRef(0), from = useRef<Element | null>(null), closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [content, setContent] = useState<Body>({});
  const [view, setView] = useState(0);   // each opening is a fresh card (its tab, season, …); a redraw keeps them
  const [trailer, setTrailer] = useState<string | null>(null);
  const [pick, setPick] = useState<(PickArgs & { n: number }) | null>(null);
  const [full, setFull] = useState(false);
  // small view over a full page
  const [under, setUnder] = useState<{ t: Title; view: number } | null>(null);
  const trail = useRef<{ t: Title; view: number; top: number }[]>([]);
  const [person, setPerson] = useState<(PersonRef & { n: number }) | null>(null);
  const personOn = useRef(false);
  useEffect(() => { personOn.current = !!person; }, [person]);
  const now = useRef({ full, t: content.t, view, under });
  useEffect(() => { now.current = { full, t: content.t, view, under }; });
  const fullEl = useRef<HTMLDivElement>(null);
  const trailerOn = useRef(false);
  useEffect(() => { trailerOn.current = !!trailer; }, [trailer]);

  const shut = () => { const s = tp.current!; return s.hidden || s.classList.contains('out'); };
  const closeTrailer = () => { if (!trailerOn.current) return false; trailerOn.current = false; setTrailer(null); return true; };
  const closeTitle = useCallback((fromPop = false) => {
    const s = tp.current!;
    if (s.hidden || s.classList.contains('out')) return;
    if (!fromPop && history.state?.tp) { history.back(); return; }
    closeTrailer();
    seq.current++; s.classList.remove('in'); s.classList.add('out'); document.body.classList.remove('tp-open'); setTitleNav(null);
    const at = document.activeElement;
    if (!at || at === document.body || s.contains(at)) (from.current as HTMLElement | null)?.focus?.();
    closing.current = setTimeout(() => { s.hidden = true; s.classList.remove('out', 'swiped'); setFull(false); setUnder(null); trail.current = []; if (panel.current) Object.assign(panel.current.style, { transform: '', transition: '' }); }, 240);
  }, []);

  const open = useCallback(async (r: Ref) => {
    const s = tp.current!, n = ++seq.current;
    if (s.hidden) { from.current = document.activeElement; trail.current = []; }
    const data = loadTitle(r).then((t) => ({ t }), (e: Error) => ({ err: `Couldn't load this title (${e.message}).` }));
    const quick = await Promise.race([data, new Promise<null>((ok) => setTimeout(() => ok(null), 250))]);
    if (n !== seq.current) return;
    clearTimeout(closing.current);
    setPerson(null);
    const was = now.current;
    // phone: straight to the full page
    const phone = matchMedia('(max-width: 800px)').matches;
    if (was.full && was.t && !s.hidden && !s.classList.contains('out')) {
      if (phone) trail.current.push({ t: was.t, view: was.view, top: fullEl.current?.scrollTop || 0 });
      else setUnder({ t: was.t, view: was.view });
    }
    setView(n); setFull(phone); setContent({ ...(quick || { loading: true }), top: 0 });
    if (s.hidden || s.classList.contains('out')) {
      s.classList.remove('out', 'in', 'swiped'); s.hidden = false; void s.offsetWidth; s.classList.add('in');
      if (!history.state?.tp) history.pushState({ tp: 1 }, '');
    }
    document.body.classList.add('tp-open');
    x.current?.focus();
    if (quick) return;
    const got = await data;
    if (n !== seq.current) return;
    setContent({ ...got, top: 0, fade: true });
  }, []);
  useImperativeHandle(ref, () => ({ open: (r) => void open(r) }), [open]);
  const close = useCallback(() => closeTitle(), [closeTitle]);
  // closed at once, its history entry and trail dropped (a page link or a search goes on from here)
  const leave = useCallback(() => { trail.current = []; if (history.state?.tp) history.replaceState(null, ''); closeTitle(true); }, [closeTitle]);

  const key = content.t?.key;
  const reloadTitle = useCallback(async () => {
    const d = key ? await getJ<Title>(titleUrl(key)).catch(() => null) : null;
    if (d) setContent({ t: d, top: body.current?.scrollTop ?? 0 });
    reload(800);
  }, [key, reload]);
  const backRef = useRef<(() => boolean) | null>(null);
  const closePerson = () => { if (!personOn.current) return false; personOn.current = false; setPerson(null); return true; };
  const backToUnder = () => {
    const u = now.current.under; if (!u || now.current.full) return false;
    seq.current++; setUnder(null); setView(u.view); setContent({ t: u.t }); setFull(true);
    return true;
  };
  const backDownTrail = () => {
    if (!now.current.full || !trail.current.length) return false;
    const b = trail.current.pop()!;
    seq.current++; setView(b.view); setContent({ t: b.t, top: b.top });
    return true;
  };
  const expand = () => {
    const u = now.current.under;
    if (u) trail.current.push({ ...u, top: fullEl.current?.scrollTop || 0 });
    setUnder(null); setFull(true);
  };
  const ctx = useMemo<TitleState>(() => ({ reloadTitle, backRef, openPerson: (p) => setPerson((x) => ({ ...p, n: (x?.n || 0) + 1 })),
    pickDay: (a) => setPick((p) => ({ ...a, n: (p?.n || 0) + 1 })), playTrailer: (url) => {
    const id = (url.match(/[?&]v=([\w-]{6,})/) || [])[1];
    if (!id) { window.open(url, '_blank', 'noopener'); return; }
    setTrailer(id);
  } }), [reloadTitle]);

  useLayoutEffect(() => {
    const b = body.current!;
    if (content.top != null) b.scrollTop = content.top;
    const want = content.top || 0, until = Date.now() + 1500;
    const again = () => { if (body.current !== b || b.scrollTop >= want - 2 || Date.now() > until) return; b.scrollTop = want; requestAnimationFrame(again); };
    if (b.scrollTop < want - 2) requestAnimationFrame(again);
    if (content.fade) b.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
  }, [content]);


  useEffect(() => { if (history.state?.tp) history.replaceState(null, ''); }, []);
  useEffect(() => {
    const p = panel.current!;
    const pop = () => {
      if (shut()) return;
      if (closeTrailer() || closePerson() || backToUnder() || backRef.current?.() || backDownTrail()) history.pushState({ tp: 1 }, '');
      else closeTitle(true);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !shut()) { if (!closeTrailer() && !closePerson() && !backToUnder() && !backRef.current?.() && !backDownTrail()) closeTitle(); } };
    window.addEventListener('popstate', pop); document.addEventListener('keydown', esc);
    // iOS gives a web app on the home screen no back swipe, so there the card has its own: from the left edge it follows the
    // finger and, let go past a third of the screen (or flicked), slides away and closes; otherwise it slides back
    let sw: { x: number; y: number; at: number; dx: number; on: boolean } | null = null;
    const ts = (e: TouchEvent) => { const t = e.touches[0]; sw = e.touches.length === 1 && t.clientX < 24 ? { x: t.clientX, y: t.clientY, at: Date.now(), dx: 0, on: false } : null; };
    const tm = (e: TouchEvent) => {
      if (!sw) return;
      const t = e.touches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y;
      if (!sw.on) { if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) { sw = null; return; } if (dx < 8) return; sw.on = true; }
      e.preventDefault(); sw.dx = Math.max(0, dx); p.style.transition = 'none'; p.style.transform = `translateX(${sw.dx}px)`;
    };
    const te = () => {
      if (!sw?.on) { sw = null; return; }
      const fast = sw.dx / (Date.now() - sw.at) > 0.5, go = sw.dx > innerWidth / 3 || (fast && sw.dx > 40);
      p.style.transition = 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)';
      p.style.transform = go ? 'translateX(100%)' : '';
      if (go) { tp.current!.classList.add('swiped'); closeTrailer(); closeTitle(); }
      sw = null;
    };
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone;
    if (standalone) { p.addEventListener('touchstart', ts, { passive: true }); p.addEventListener('touchmove', tm, { passive: false }); p.addEventListener('touchend', te); }
    return () => {
      window.removeEventListener('popstate', pop); document.removeEventListener('keydown', esc);
      p.removeEventListener('touchstart', ts); p.removeEventListener('touchmove', tm); p.removeEventListener('touchend', te);
    };
  }, [closeTitle, full, under]);

  const player = trailer && (
    // trailer
    <div className="tc-player">
      <iframe src={`https://www.youtube-nocookie.com/embed/${trailer}?autoplay=1&rel=0&modestbranding=1`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen title="Trailer" referrerPolicy="strict-origin-when-cross-origin" />
      <button type="button" className="hero-x" aria-label="Close the trailer" onClick={closeTrailer}>×</button>
    </div>
  );
  const base = full && content.t ? { t: content.t, view } : under;
  const peek = !full && (
    <aside ref={panel} className={`tpanel tpeek${trailer ? ' playing' : ''}`} role="dialog" aria-modal="true" aria-label="Title details">
      <div ref={body} className="tp-body" id="tp-body">
        {content.t ? <TitlePeek key={view} d={content.t} expand={expand} expandRef={x} />
          : content.err ? <div className="tp-note">{content.err}</div> : content.loading ? <div className="tp-note">Loading…</div> : null}
      </div>
      {player}
    </aside>
  );
  return createPortal(
    <TitleCtx.Provider value={ctx}>
      <div ref={tp} className={`tp-scrim${base ? ' full' : ''}`} id="tp" hidden onClick={(e) => { if (e.target === e.currentTarget) closeTitle(); }}>
        {base && (
          <div key={base.view} ref={(el) => { fullEl.current = el; if (full) { panel.current = el; body.current = el; } }} className="tfull" role="dialog" aria-modal="true" aria-label={base.t.title}>
            <TitleFull key={base.view} d={base.t} close={close} leave={leave} scroller={fullEl} player={full ? player : null} />
          </div>
        )}
        {(!full || !content.t) && (under ? <div className="tp-over" onClick={(e) => { if (e.target === e.currentTarget) closeTitle(); }}>{peek}</div> : peek)}
        {person && <div className="tp-over" onClick={(e) => { if (e.target === e.currentTarget) closeTitle(); }}><PersonView key={person.n} p={person} /></div>}
      </div>
      {pick && <PickDay key={pick.n} a={pick} close={() => setPick(null)} />}
    </TitleCtx.Provider>,
    document.body,
  );
}

// a number and its unit ("6.1 GB", "7 d") and a count pair ("19 / 19") with only a hair of space between them: the unit or slash
// goes in a span with a small margin (a thin-space character would be full width in the monospace font)
const UNIT = /(\d) (%|[KMGT]B|kWh|[MG]bit\/s|[MG]bit|tok\/s|ms|min|h|d|s|W|°C)(?!\w)|(\d) \/ (?=\d)/g;
function Tight({ text }: { text: string }) {
  const out: ReactNode[] = []; let last = 0;
  for (const m of text.matchAll(UNIT)) {
    out.push(text.slice(last, m.index) + (m[1] ?? m[3]));
    out.push(m[2] ? <span key={m.index} className="u">{m[2]}</span> : <span key={m.index} className="sl">/</span>);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

const RATING_SRC: Record<string, string> = { tmdb: 'TMDB', mal: 'MyAnimeList', kitsu: 'Kitsu' };
// TMDB's long genre names in the usual short form; TV's combined ones ("Action & Adventure") split into their parts
const GENRE_SHORT: Record<string, string> = { 'Science Fiction': 'Sci-Fi', 'Sci-Fi & Fantasy': 'Sci-Fi & Fantasy', Documentary: 'Doc' };
function shortGenres(list: string[] | undefined) {
  const out: string[] = [];
  for (const g of list || []) for (const part of (GENRE_SHORT[g] || g).split(' & ')) { const x = GENRE_SHORT[part] || part; if (!out.includes(x)) out.push(x); }
  return out;
}
// age ratings in the UK's BBFC colours (the US ones have none), each US / TV / MAL rating by the age it stands for
const CERT_RING: Record<string, string> = Object.fromEntries([
  ['#3DBE6E', 'G U TV-Y TV-G'], ['#F2C230', 'PG TV-Y7 TV-Y7-FV TV-PG'], ['#F28C28', 'PG-13 12 12A TV-14'],
  ['#E85A9B', 'R 15 R-17+'], ['#E5383B', 'NC-17 18 TV-MA R+'], ['#4C8DF6', 'R18 Rx'],
].flatMap(([c, l]) => l.split(' ').map((r) => [r, c])));
const SCORE_RING: Record<string, string> = { 'imdb.svg': '#F5C518', 'rotten-tomatoes.svg': '#FA320A', 'tmdb.svg': '#01B4E4', 'myanimelist.svg': '#6C8FE0', 'kitsu.svg': '#F75239' };   // MAL's own blue is lightened: it vanishes on the navy card
// the YouTube logo (its red rounded play button) for the Trailer button
export const YtLogo = () => (
  <svg width="22" height="16" viewBox="0 0 28 20" aria-hidden="true">
    <path d="M27.4 3.1A3.5 3.5 0 0 0 25 .6C22.8 0 14 0 14 0S5.2 0 3 .6A3.5 3.5 0 0 0 .6 3.1C0 5.3 0 10 0 10s0 4.7.6 6.9A3.5 3.5 0 0 0 3 19.4c2.2.6 11 .6 11 .6s8.8 0 11-.6a3.5 3.5 0 0 0 2.4-2.5c.6-2.2.6-6.9.6-6.9s0-4.7-.6-6.9z" fill="#FF0000" />
    <path d="M11.2 14.3l7.3-4.3-7.3-4.3z" fill="#fff" />
  </svg>
);

// meta line
export function metaOf(d: Title, noType = false) {
  const nSeasons = d.seasons?.filter((s) => s.n > 0).length;
  const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min}m`);
  return [d.type === 'movie' || noType ? null : d.anime ? 'Anime' : TYPE_NAME[d.type], d.year, d.runtime ? (d.type === 'movie' ? hm(d.runtime) : `${d.runtime}min / ep`) : null,
    d.type === 'tv' && nSeasons ? `${nSeasons} season${nSeasons === 1 ? '' : 's'}` : d.type !== 'movie' && d.episodes ? `${d.episodes} eps` : null,
    d.type !== 'movie' && d.status ? String(d.status).replace(/^./, (c) => c.toUpperCase()) : null, ...shortGenres(d.genres).slice(0, 3)].filter(Boolean).join(' · ');
}
export const Cert = ({ d }: { d: Title }) => d.certification ? (
  <span className="tc-cert" style={CERT_RING[d.certification] ? ({ '--cert': CERT_RING[d.certification] } as CSSProperties) : undefined}>{d.certification}</span>
) : null;

// scores
export function Scores({ d, children }: { d: Title; children?: ReactNode }) {
  // IMDb, Rotten Tomatoes, Metacritic (OMDb), TMDB or MyAnimeList (yours is the poster's
  // circle). Each opens the title on that site (Rotten Tomatoes / Metacritic pages come from Wikidata; without one, and for
  // MAL, the site's search)
  const sc = d.scores, q = encodeURIComponent(d.title), scores: ReactNode[] = [];
  const score = (icon: string, name: string, value: string | null | undefined, href: string | null | undefined, extra?: string | null) => {
    if (!value) return;
    // how full the phone's score ring is: a percentage as it is, a score out of 100 or out of 10; the ring in the source's own
    // colour (accent stays yours); Metacritic's own colour goes by the score
    const n = parseFloat(value), pct = /%/.test(value) ? n : n > 10 ? n : n * 10;
    scores.push(
      <a key={name} className="tc-score" href={href || undefined} target="_blank" rel="noopener" aria-label={`${name} ${value}${extra ? ` · ${extra}` : ''}`}
        style={{ '--fill': `${Math.max(0, Math.min(100, pct || 0))}%`, '--ring': icon === 'metacritic.svg' ? (n >= 61 ? '#00CE7A' : n >= 40 ? '#FFBD3F' : '#FF6B73') : SCORE_RING[icon] || 'var(--accent)' } as CSSProperties}>
        <img src={`/icons/${icon}`} alt={name} /><b>{value}</b>
      </a>,
    );
  };
  score('imdb.svg', 'IMDb', sc?.imdb, `https://www.imdb.com/title/${d.imdb}/`, [sc?.votes ? `${sc.votes} votes` : null, sc?.awards].filter(Boolean).join(' · '));
  score('rotten-tomatoes.svg', 'Rotten Tomatoes', sc?.rt, sc?.pages?.rt || `https://www.rottentomatoes.com/search?search=${q}`);
  score('metacritic.svg', 'Metacritic', sc?.mc, sc?.pages?.mc || `https://www.metacritic.com/search/${q}/`);
  // Kitsu gives an approval percentage (kept out of 10 beside the others, for sorting): shown as Kitsu shows it
  const pctOf = (x: number) => `${Math.round(x * 10)}%`;
  if (d.rating) score(d.ratingSrc === 'mal' ? 'myanimelist.svg' : d.ratingSrc === 'kitsu' ? 'kitsu.svg' : 'tmdb.svg', RATING_SRC[d.ratingSrc || ''] || 'Rating',
    d.ratingSrc === 'kitsu' ? pctOf(d.rating) : d.rating.toFixed(1),
    d.ratingSrc === 'mal' ? d.malUrl || `https://myanimelist.net/anime.php?q=${q}` : d.url);
  // an anime show from TMDB also carries MyAnimeList's score
  if (d.mal?.score) score('myanimelist.svg', 'MyAnimeList', d.mal.score.toFixed(1), d.mal.url, d.mal.rank ? `#${d.mal.rank.toLocaleString('en-GB')} on MyAnimeList` : null);
  // and Kitsu's beside it (unless Kitsu's is already the main one, without MAL_CLIENT_ID)
  if (d.kitsu?.score && d.ratingSrc !== 'kitsu') score('kitsu.svg', 'Kitsu', pctOf(d.kitsu.score), d.kitsu.url);
  // Letterboxd (films only): no score without their API, so just its logo; letterboxd.com/tmdb/<id>/ redirects to the film
  const lb = d.type === 'movie' && /^tmdb:movie:\d+$/.test(d.key);
  return (
    <div className="tc-chips">
      {scores}
      {/* a thin line parts the scores from the links (Letterboxd, the trailer); with no score, no line */}
      {scores.length > 0 && (lb || children) && <span className="tc-sep" />}
      {lb && <a className="tc-score tc-lb" href={`https://letterboxd.com/tmdb/${d.key.split(':')[2]}/`} target="_blank" rel="noopener" aria-label="Letterboxd"><img src="/icons/letterboxd-dots.svg" alt="" /><b className="tc-link">Reviews</b></a>}
      {children}
    </div>
  );
}

const trend = (t: Tile) => <TrendCard t={t} />;
const KIND: Record<string, string> = { movie: 'Film', tv: 'Show', anime: 'Anime' };
const wide = (u: string | null) => u?.replace('/t/p/w780/', '/t/p/w1280/') || undefined;

// status circle
export function StatusDial({ d }: { d: Title }) {
  const { reloadTitle } = useTitle();
  const regular = (d.seasons || []).filter((s) => s.n > 0), total = regular.reduce((n, s) => n + (s.episodes || 0), 0);
  const progress = total ? Math.min(1, regular.reduce((n, s) => n + (d.you?.bySeason?.[s.n] || 0), 0) / total) : null;
  const tile = useMemo<Tile>(() => ({ key: d.key, type: d.type, title: d.title, poster: d.poster, watchlist: d.watchlist,
    watched: (d.type === 'movie' ? d.you?.plays : d.you?.episodes) || 0, mine: d.you?.rating || null, progress, lastAt: d.you?.last || null, next: d.upNext || null }), [d, progress]);
  const dirty = useRef(false);
  const closed = useCallback(() => { if (dirty.current) { dirty.current = false; void reloadTitle(); } }, [reloadTitle]);
  // phone: poster with its circle
  const phone = usePhone();
  const dial = usePosterDial(tile, { cls: phone ? 'tposter' : 'tc-sdial', changed: () => { dirty.current = true; }, closed });
  const t = dial.t, done = t.type === 'movie' || (t.progress ?? 1) >= 1;
  const word = t.mine ? 'Rated' : t.watched ? (done ? 'Watched' : 'Watching') : t.watchlist ? 'Planned' : 'Add';
  if (phone) return (
    <div className="hero-post">
      <div {...dial.host}>
        {d.poster && <img src={d.poster} alt="" />}
        <div className="tdial-shade" />
        <div className="tdial-menu">{dial.plan()}{dial.seen?.()}{dial.rate()}</div>
        {dial.dial}{dial.ringDial}
      </div>
    </div>
  );
  return (
    <div {...dial.host}>
      {dial.dial}<span className={`tc-al${t.mine || t.watched || t.watchlist ? ' on' : ''}`}>{word}</span><span className="tc-al alt">List</span>
      <div className="tdial-menu">{dial.plan(t.watchlist ? 'Planned' : 'Plan')}{dial.seen?.(t.watched ? 'Watched' : 'Watch')}{dial.rate(t.mine ? 'Rated' : 'Rate')}</div>
      {dial.ringDial}
    </div>
  );
}

// carousel words
function Head({ d, h }: { d: Title; h: 'h2' | 'h3' }) {
  const { playTrailer } = useTitle();
  const phone = usePhone();
  const H = h;
  return (
    <>
      {phone && <StatusDial d={d} />}
      <span className="hero-kick">{d.anime && d.type !== 'anime' ? 'Anime' : KIND[d.type]}</span>
      <H className="hero-title">{d.title + (d.label ? ` · ${d.label}` : '')}</H>
      {d.watching && <span className="tc-now">{['Watching now', d.watching.se >= 0 ? (d.type === 'anime' ? `E${d.watching.ep}` : `S${d.watching.se} E${d.watching.ep}`) : null,
        d.watching.pct != null ? `${d.watching.pct} %` : null].filter(Boolean).join(' · ')}</span>}
      <div className="tc-meta hero-meta">{metaOf(d, true)}<Cert d={d} /></div>
      <Scores d={d}>
        {d.trailer && <button type="button" className="tc-ytico" aria-label="Play the trailer" onClick={() => playTrailer(d.trailer!)}><YtLogo /><b className="tc-link">Trailer</b></button>}
        {!phone && <><span className="tc-sep" /><StatusDial d={d} /></>}
      </Scores>
    </>
  );
}

// small view
function TitlePeek({ d, expand, expandRef }: { d: Title; expand: () => void; expandRef: RRef<HTMLButtonElement> }) {
  return (
    <>
      <div className="tpk-art" onClick={(e) => { if (!(e.target as Element).closest('button, a, .dialhost')) expand(); }}>
        {(d.backdrop || d.poster) && <img className="hero-bg on" src={wide(d.backdrop || d.poster)} alt="" />}
        <div className="hero-shade" />
        <div className="tpk-head"><Head d={d} h="h2" /></div>
      </div>
      <button ref={expandRef} type="button" className="tc-cbtn tpk-grow" aria-label="Open the full page" onClick={expand}><Circ><Icon d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" /></Circ></button>
      {d.overview && <div className="tpk-body"><p className="hero-story">{d.overview}</p></div>}
    </>
  );
}

// full page
function TitleFull({ d, close, leave, scroller, player }: { d: Title; close: () => void; leave: () => void; scroller: React.RefObject<HTMLDivElement | null>; player: ReactNode }) {
  const [nextSlot, setNextSlot] = useState<HTMLDivElement | null>(null);
  // Similar grid
  const [grid, setGrid] = useState(false);
  const { backRef } = useTitle();
  const phone = usePhone();
  useEffect(() => {
    if (!grid) return;
    scroller.current?.scrollTo({ top: 0 });
    backRef.current = () => { setGrid(false); return true; };
    return () => { backRef.current = null; };
  }, [grid, backRef, scroller]);
  const [eps, setEps] = useState({ season: null as number | null, allEps: true, home: 0 });
  useEffect(() => { setTitleNav({ back: () => (grid ? setGrid(false) : close()), leave }); }, [grid, close]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setTitleNav(null), []);
  const row = <T,>(id: string, title: string, items: T[], keyOf: (x: T) => string, card: (x: T) => ReactNode, onAll?: () => void) => (
    <div key={id} className="tf-sec">
      <Group id={`tf-${id}`} title={title} cls="group" railClass="rail ptrack" items={items} keyOf={keyOf} card={card} onAll={onAll} />
    </div>
  );
  const top = <div className="tf-top"><TopBar inTitle={() => { backRef.current = null; leave(); }} /></div>;
  if (grid) return (
    <div className="tf-body tf-grid-page">
      {top}
      <ShelfGrid title={`Similar to ${d.title}`} items={d.similar} first="Similar" empty="Nothing similar yet." />
    </div>
  );
  return (
    <>
      {top}
      <section className="hero tf-hero">
        {(d.backdrop || d.poster) && <img className="hero-bg on" src={wide(d.backdrop || d.poster)} alt="" />}
        <div className="hero-shade" />
        <div className="hero-body"><Head d={d} h="h2" />{d.overview && <p className="hero-story">{d.overview}</p>}</div>
        {d.type !== 'movie' && !phone && <div className="tf-next" ref={setNextSlot} />}
        {player}
      </section>
      <div className="tf-body">
        {d.type !== 'movie' && phone && <div className="tf-next" ref={setNextSlot} />}
        <section className="tf-sec tf-ov">
          {d.overview && <Story key={d.key} d={d} />}
          <Details d={d} cls="tf-details" />
        </section>
        {d.type !== 'movie' && !!d.seasons?.length && (
          <section className="tf-sec tf-eps">
            <EpisodesPane d={d} st={eps} set={(s) => setEps((x) => ({ ...x, ...s }))} cls="tf-epspane on" rows nextSlot={nextSlot} />
          </section>
        )}
        {!!d.cast?.length && row('cast', 'Cast', d.cast, (x) => `${x.name}|${x.role}`, (x) => <CastCard x={x} opens={d.key.startsWith('tmdb:')} />)}
        {!!d.similar?.length && row('similar', 'Similar', d.similar, (t) => t.key, trend, () => setGrid(true))}
        {!!d.collectionItems?.length && row('collection', 'Collection', d.collectionItems, (t) => t.key, trend)}
      </div>
    </>
  );
}

// cast card
function CastCard({ x, opens }: { x: Title['cast'][number]; opens: boolean }) {
  const { openPerson } = useTitle();
  const go = () => openPerson({ id: x.id, name: x.name });
  return (
    <div className="tcard tcast" aria-label={`${x.name}${x.role ? ` · ${x.role}` : ''}`}>
      <div className={`tposter${opens ? ' opens' : ''}`} {...(opens ? { role: 'button', tabIndex: 0, onClick: go, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } } } : {})}>
        {x.photo && <img src={x.photo} alt="" loading="lazy" />}
      </div>
      <div className="names"><span className="name">{x.name}</span><span className="host">{x.role || ''}</span></div>
    </div>
  );
}

// actor card
type Person = { id: number; name: string; dept: string; birthday: string | null; deathday: string | null; place: string | null; bio: string | null; photo: string | null;
  knownFor: Tile[]; acting: Tile[]; crew: { label: string; items: Tile[] } | null };
function PersonView({ p }: { p: PersonRef }) {
  const [got, setGot] = useState<{ v?: Person; err?: string } | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    let live = true;
    getJ<Person>(p.id ? `/api/person/${p.id}` : `/api/person?name=${encodeURIComponent(p.name || '')}`)
      .then((v) => live && setGot({ v }), (e: Error) => live && setGot({ err: e.message }));
    return () => { live = false; };
  }, [p.id, p.name]);
  const v = got?.v;
  const age = (from: string, to?: string | null) => { const a = new Date(from), b = to ? new Date(to) : new Date(); return b.getFullYear() - a.getFullYear() - (b < new Date(b.getFullYear(), a.getMonth(), a.getDate()) ? 1 : 0); };
  const facts = v && [v.birthday ? (v.deathday ? `${fmtDay(v.birthday)} – ${fmtDay(v.deathday)} (${age(v.birthday, v.deathday)})` : `Born ${fmtDay(v.birthday)} (${age(v.birthday)})`) : null, v.place].filter(Boolean).join(' · ');
  const row = (id: string, title: string, items: Tile[]) => !!items.length && <Group key={id} id={`pp-${id}`} title={title} cls="group" railClass="rail ptrack" items={items} keyOf={(t) => t.key} card={trend} />;
  return (
    <aside className="tpanel tpeek tpp" role="dialog" aria-modal="true" aria-label={v?.name || p.name || 'Person'}>
      <div className="tp-body">
        {!got ? <div className="tp-note">Loading…</div> : got.err || !v ? <div className="tp-note">{`Couldn't load ${p.name || 'this person'} (${got.err || 'not found'}).`}</div> : <>
          <div className="tpp-head">
            <div className="tpp-photo">{v.photo && <img src={v.photo} alt="" />}</div>
            <div className="tpp-h">
              <span className="hero-kick">{v.dept}</span>
              <h2 className="hero-title">{v.name}</h2>
              {facts && <div className="tc-meta hero-meta">{facts}</div>}
              {v.bio && <><p className={`tpp-bio${more ? '' : ' clamp'}`}>{v.bio}</p>{v.bio.length > 420 && <button type="button" className="tc-more" onClick={() => setMore(!more)}>{more ? 'Less' : 'More'}</button>}</>}
            </div>
          </div>
          <div className="tpp-rows">
            {row('known', 'Known for', v.knownFor)}
            {row('acting', 'Acted in', v.acting)}
            {v.crew && row('crew', v.crew.label, v.crew.items)}
          </div>
        </>}
      </div>
    </aside>
  );
}

// story
function Story({ d }: { d: Title }) {
  const p = useRef<HTMLParagraphElement>(null), [full, setFull] = useState(false), [cut, setCut] = useState(false);
  useLayoutEffect(() => { const x = p.current; setCut(!!x && x.scrollHeight > x.clientHeight + 1); }, []);
  return (
    <div className="tf-story">
      {d.tagline && <p className="tc-tagline">{d.tagline}</p>}
      <p ref={p} className={`tc-overview${full ? ' full' : ''}`}>{d.overview}</p>
      {cut && !full && <button type="button" className="tf-more" onClick={() => setFull(true)}>See more</button>}
    </div>
  );
}
// Details as compact cells, three to a row: the type's own six, where it's from, your history
function Details({ d, cls }: { d: Title; cls: string }) {
  const { reloadTitle, pickDay } = useTitle();
  const phone = usePhone();
  const editRef = useRef<HTMLButtonElement>(null);
  const cell = (k: string, v: ReactNode, full?: string | null, c?: string) => phone && !v ? null : (
    <div key={k} className="meter" aria-label={full && full !== v ? `${k} ${full}` : undefined}>
      <span className="meter-k">{k}</span><span className={`meter-v${c ? ` ${c}` : ''}`}>{!v ? DASH : typeof v === 'string' ? <Tight text={v} /> : v}</span>
    </div>
  );
  const money = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : `$${Math.round(n / 1e6)}M`);
  const names = (list: string[] | undefined) => (list?.length ? [`${list[0]}${list.length > 1 ? ` +${list.length - 1}` : ''}`, list.join(', ')] : [null, null]);
  const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const f = d.facts || {}, str = (k: string) => (f[k] == null ? undefined : String(f[k]));
  const [stu, stuAll] = names(str('studio')?.split(', '));
  const name = (type: 'language' | 'region', codes: string | undefined) => {
    try { const n = new Intl.DisplayNames(['en'], { type }); return codes?.split(', ').map((c) => n.of(type === 'language' ? c.toLowerCase() : c)).join(', ') || null; } catch { return codes || null; }
  };
  const cells: ReactNode[] = [];
  if (d.type === 'movie') {
    const m = d.money || { budget: null, revenue: null }, [dir, dirAll] = names(d.people?.names), [wri, wriAll] = names(d.writers);
    cells.push(cell('Released', d.released ? fmtDay(d.released) : null), cell('Budget', m.budget ? money(m.budget) : null), cell('Box office', m.revenue ? money(m.revenue) : null),
      cell('Director', dir, dirAll, 'txt'), cell((d.writers?.length || 0) > 1 ? 'Writers' : 'Writer', wri, wriAll, 'txt'), cell('Studio', stu, stuAll, 'txt'));
  } else {
    const n = d.seasons?.filter((x) => x.n > 0).length, eps = (f.episodes as number | null) || d.episodes;
    const next = d.next?.date ? cell('Next episode', `${d.next.season != null ? `S${d.next.season} E${d.next.ep} · ` : ''}${day(d.next.date)}`, null, 'txt acc')
      : cell(/ended|canceled|finished/i.test(d.status || '') ? 'Ended' : 'Last aired', fmtDay(str('lastAired')), null, 'txt');
    // phone: aired line
    const y0 = d.released?.slice(0, 4), y1 = str('lastAired')?.slice(0, 4), soon = !!d.released && new Date(d.released) > new Date();
    const dates = phone ? [cell('Aired', !y0 ? null : soon ? `Starts ${fmtDay(d.released)}` : /ended|canceled|finished/i.test(d.status || '') ? `${y0}${y1 && y1 !== y0 ? ` – ${y1}` : ''} · Ended` : `Since ${y0}`, null, 'txt'),
      d.next?.date ? next : null] : [cell('First aired', fmtDay(d.released), null, 'txt'), next];
    const count = cell('Episodes', eps ? `${eps}${d.type === 'tv' && n ? ` · ${n} season${n === 1 ? '' : 's'}` : ''}` : null, null, 'txt');
    // anime facts
    if (d.type === 'anime') {
      const [by, byAll] = names(d.people?.names), [net, netAll] = names(str('network')?.split(', ')), rank = (f.rank as number | null) || d.mal?.rank;
      const lang = name('language', str('language'));
      cells.push(...[...dates, count, cell('Studio', stu, stuAll, 'txt'),
        by && cell('Created by', by, byAll, 'txt'), net && cell('Network', net, netAll, 'txt'), str('season') && cell('Season', str('season'), null, 'txt'),
        d.format && cell('Format', String(d.format).replace(/^./, (c) => c.toUpperCase()), null, 'txt'), str('source') && cell('Source', str('source'), null, 'txt'),
        lang && cell('Language', lang, null, 'txt'), rank && cell('MAL rank', `#${Number(rank).toLocaleString('en-GB')}`, null, 'txt')].filter(Boolean).slice(0, 9));
    } else {
      const [by, byAll] = names(d.people?.names), [net, netAll] = names(str('network')?.split(', '));
      cells.push(...dates, count, cell('Created by', by, byAll, 'txt'), cell('Network', net, netAll, 'txt'), cell('Studio', stu, stuAll, 'txt'));
    }
  }
  const aw = d.scores?.awards, y = d.you || {};
  const when = (t: number | null | undefined) => (t ? fmtDay(new Date(t).toISOString()) : null);
  const award = aw ? aw.split('. ')[0].replace(/\.$/, '') : null;
  if (d.type !== 'anime') cells.push(...(phone ? [cell('From', [name('region', str('country')), name('language', str('language'))].filter(Boolean).join(' · '), null, 'txt')]
    : [cell('Country', name('region', str('country')), null, 'txt'), cell('Language', name('language', str('language')), null, 'txt'), cell('Awards', award, aw, 'txt')]));
  // phone: your history line
  let you: ReactNode[] = [];
  if (d.type === 'movie') {
    // the latest watch's date can be changed here (a date-unknown one, from marking or rating it, too)
    const last = y.moviePlays?.[0];
    const retime = async (at: number) => {
      if (at === last!.at) return;
      const err = await postJ(`/api/retime/${encodeURIComponent(d.key)}`, { season: -1, episode: -1, from: last!.at, at });
      if (err) return alert(`Couldn't save: ${err}`);
      await reloadTitle();
    };
    const lw = last ? (
      <button ref={editRef} type="button" className={`tc-editdate${last.approx === 1 ? ' add' : ''}`} aria-label={last.approx === 1 ? 'Watched, date unknown · add when' : 'Change the date'}
        onClick={() => pickDay({ anchor: editRef.current!, air: last.approx === 1 ? null : last.at, save: (t) => retime(t as number), keepTime: timed(last),
          airDay: airAt({ air: d.released }), airLabel: 'Release date' })}>{last.approx === 1 ? 'Add date' : when(last.at)}</button>
    ) : null;
    if (phone) you = [y.plays ? `${y.plays}× watched` : null, y.first ? `first ${when(y.first)}` : null, lw && <span key="l">{last!.approx === 1 ? '' : 'last '}{lw}</span>];
    else cells.push(cell('Watched', y.plays ? `${y.plays}×` : null, null, 'txt'), cell('First watched', when(y.first), null, 'txt'), cell('Last watched', lw, null, 'txt'));
  } else if (phone) you = [y.episodes ? `${y.episodes} ep${y.episodes === 1 ? '' : 's'}` : null, y.first ? `started ${when(y.first)}` : null, y.last ? `last ${ago(y.last)} ago` : null];
  else cells.push(cell('Watched', y.episodes ? `${y.episodes} ep${y.episodes === 1 ? '' : 's'}` : null, y.plays ? `${y.plays} plays` : null, 'txt'),
    cell('Started', when(y.first), null, 'txt'), cell('Last watched', y.last ? `${when(y.last)} · ${ago(y.last)} ago` : null, null, 'txt'));
  if (phone) {
    const yl = you.filter(Boolean);
    return (
      <div className="tf-facts">
        {cells.some(Boolean) && <div className="tf-flist">{cells}</div>}
        {award && <p className="tf-award" title={aw!}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" /></svg>{award}</p>}
        {!!yl.length && <p className="tf-you"><b>You</b><span>{yl.flatMap((x, i) => (i ? [' · ', x] : [x]))}</span></p>}
      </div>
    );
  }
  return <div className={`glass dpanel dcells tc-details ${cls}`}>{cells}</div>;
}
