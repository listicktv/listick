'use client';
// The title panel: opens from any card, as big as a page on wider screens. The card: header (art, facts, your status and rating, actions), then Overview,
// Episodes (series), Cast, Similar (and a movie's Collection) in the menu under the poster. Your marks go to Listick and the
// card redraws from its answer.
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref as RRef } from 'react';
import { createPortal } from 'react-dom';
import { PIcon, TrendCard, usePosterDial } from './Cards';
import { Circ, EpisodesPane, PickDay, airAt, fmtDay, timed } from './Episodes';
import { getJ, postJ } from './lib/api';
import { DASH, ago } from './lib/format';
import { useHome, usePhone } from './lib/home';
import { Icon, PATHS } from './lib/icons';
import { TYPE_NAME, type Ref, type Tile } from './lib/media';
import { TitleCtx, loadTitle, titleUrl, useTitle, type PickArgs, type Title, type TitleState } from './lib/title';
import { Group } from './Rail';

export type TitlePanelApi = { open: (ref: Ref) => void };
type Body = { t?: Title; err?: string; loading?: boolean; top?: number; fade?: boolean };

// The card opens (.in: the backdrop fades, the card grows in, on a phone it slides up) once its content is there, or with
// "Loading…" after 250 ms, so it doesn't open small and then jump to its full size. An open card is a step in the browser's
// history, so Back closes it instead of leaving the page: closing goes back one step, and the popstate does the closing. It
// plays the opening backwards (.out), then hides the card. The scrim's hidden and in/out are set here directly.
export function TitlePanel({ ref }: { ref: RRef<TitlePanelApi> }) {
  const { reload } = useHome();
  const tp = useRef<HTMLDivElement>(null), panel = useRef<HTMLElement>(null), body = useRef<HTMLDivElement>(null);
  const x = useRef<HTMLButtonElement>(null), thumb = useRef<HTMLSpanElement>(null);
  const seq = useRef(0), from = useRef<Element | null>(null), closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), swap = useRef(false);
  const [content, setContent] = useState<Body>({});
  const [view, setView] = useState(0);   // each opening is a fresh card (its tab, season, …); a redraw keeps them
  const [trailer, setTrailer] = useState<string | null>(null);
  const [pick, setPick] = useState<(PickArgs & { n: number }) | null>(null);
  const trailerOn = useRef(false);
  useEffect(() => { trailerOn.current = !!trailer; }, [trailer]);

  const shut = () => { const s = tp.current!; return s.hidden || s.classList.contains('out'); };
  const closeTrailer = () => { if (!trailerOn.current) return false; trailerOn.current = false; setTrailer(null); return true; };
  const closeTitle = useCallback((fromPop = false) => {
    const s = tp.current!;
    if (s.hidden || s.classList.contains('out')) return;
    if (!fromPop && history.state?.tp) { history.back(); return; }
    closeTrailer();
    seq.current++; s.classList.remove('in'); s.classList.add('out'); document.body.classList.remove('tp-open'); (from.current as HTMLElement | null)?.focus?.();
    closing.current = setTimeout(() => { s.hidden = true; s.classList.remove('out', 'swiped'); Object.assign(panel.current!.style, { transform: '', transition: '' }); }, 240);
  }, []);

  const open = useCallback(async (r: Ref) => {
    const s = tp.current!, n = ++seq.current;
    if (s.hidden) from.current = document.activeElement;
    const data = loadTitle(r).then((t) => ({ t }), (e: Error) => ({ err: `Couldn't load this title (${e.message}).` }));
    const quick = await Promise.race([data, new Promise<null>((ok) => setTimeout(() => ok(null), 250))]);
    if (n !== seq.current) return;
    clearTimeout(closing.current);
    setView(n); setContent({ ...(quick || { loading: true }), top: 0 });
    if (s.hidden || s.classList.contains('out')) {
      s.classList.remove('out', 'in', 'swiped'); s.hidden = false; void s.offsetWidth; s.classList.add('in');
      if (!history.state?.tp) history.pushState({ tp: 1 }, '');
    }
    document.body.classList.add('tp-open');
    x.current?.focus();
    if (quick) return;
    const got = await data;
    if (n !== seq.current) return;
    swap.current = true; setContent({ ...got, top: 0, fade: true });
  }, []);
  useImperativeHandle(ref, () => ({ open: (r) => void open(r) }), [open]);

  const key = content.t?.key;
  const reloadTitle = useCallback(async () => {
    const d = key ? await getJ<Title>(titleUrl(key)).catch(() => null) : null;
    if (d) setContent({ t: d, top: body.current?.scrollTop ?? 0 });
    reload(800);
  }, [key, reload]);
  const backRef = useRef<(() => boolean) | null>(null);
  const ctx = useMemo<TitleState>(() => ({ reloadTitle, backRef, pickDay: (a) => setPick((p) => ({ ...a, n: (p?.n || 0) + 1 })), playTrailer: (url) => {
    const id = (url.match(/[?&]v=([\w-]{6,})/) || [])[1];
    if (!id) { window.open(url, '_blank', 'noopener'); return; }
    setTrailer(id);
  } }), [reloadTitle]);

  // the title card's scroll handle, over the content (see .tp-thumb); placed on scroll and while the pointer is over the card
  const placeThumb = () => {
    const b = body.current, th = thumb.current; if (!b || !th) return;
    const track = b.clientHeight - 52 - 28, on = b.scrollHeight > b.clientHeight + 1;
    th.classList.toggle('on', on);
    if (!on) return;
    const h = Math.max(48, (track * b.clientHeight) / b.scrollHeight);
    th.style.height = `${h}px`;
    th.style.top = `${b.offsetTop + 52 + ((track - h) * b.scrollTop) / (b.scrollHeight - b.clientHeight)}px`;
  };
  useLayoutEffect(() => {
    const b = body.current!;
    if (content.top != null) b.scrollTop = content.top;
    if (content.fade) b.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
    placeThumb();
  }, [content]);


  useEffect(() => {
    const p = panel.current!;
    // the card sits in the middle of the screen, so when a part grows (Episodes, then its rows once loaded) it would jump up to
    // re-centre: it glides there instead. offsetTop is the layout position, unmoved by a glide still running
    let last: number | null = null;
    const ro = new ResizeObserver(() => {
      if (!p.offsetParent) { last = null; return; }   // closed: the next card opens without a glide
      const top = p.offsetTop;
      if (swap.current) { swap.current = false; last = top; return; }   // "Loading…" became the card: it fades in where it lands
      if (last != null && Math.abs(top - last) > 1) p.animate([{ transform: `translateY(${last - top}px)` }, { transform: 'none' }], { duration: 220, easing: 'ease-out' });
      last = top;
    });
    ro.observe(p);
    if (history.state?.tp) history.replaceState(null, '');   // reloaded with a card open: it isn't any more
    const pop = () => {
      if (shut()) return;
      if (closeTrailer() || backRef.current?.()) history.pushState({ tp: 1 }, '');   // Back stops the trailer (or leaves an episode) first
      else closeTitle(true);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !shut()) { if (!closeTrailer() && !backRef.current?.()) closeTitle(); } };
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
      ro.disconnect(); window.removeEventListener('popstate', pop); document.removeEventListener('keydown', esc);
      p.removeEventListener('touchstart', ts); p.removeEventListener('touchmove', tm); p.removeEventListener('touchend', te);
    };
  }, [closeTitle]);

  return createPortal(
    <TitleCtx.Provider value={ctx}>
      <div ref={tp} className="tp-scrim" id="tp" hidden onClick={(e) => { if (e.target === e.currentTarget) closeTitle(); }}>
        <aside ref={panel} className={`tpanel glass${trailer ? ' playing' : ''}`} role="dialog" aria-modal="true" aria-label="Title details">
          <button ref={x} type="button" className="tp-x" id="tp-x" aria-label="Close" onClick={() => { if (!closeTrailer()) closeTitle(); }}>×</button>
          <div ref={body} className="tp-body" id="tp-body" onScroll={placeThumb} onPointerMove={placeThumb}>
            {content.t ? <TitleView key={view} d={content.t} /> : content.err ? <div className="tp-note">{content.err}</div> : content.loading ? <div className="tp-note">Loading…</div> : null}
          </div>
          <span ref={thumb} className="tp-thumb" />
          {/* the trailer covers the whole title card (youtube-nocookie: no tracking cookies until you press play); the card's own ×
              stays on top and closes the trailer first. YouTube refuses embeds that send no Referer (error 153), so the frame
              shares just the origin */}
          {trailer && (
            <div className="tc-player">
              <iframe src={`https://www.youtube-nocookie.com/embed/${trailer}?autoplay=1&rel=0&modestbranding=1`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen title="Trailer" referrerPolicy="strict-origin-when-cross-origin" />
            </div>
          )}
        </aside>
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

// a title's line of text (type, year · runtime · seasons or episodes · status · up to 3 genres); the age rating is boxed after it
export function metaOf(d: Title) {
  const nSeasons = d.seasons?.filter((s) => s.n > 0).length;
  const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min}m`);
  return [d.type === 'movie' ? null : d.anime ? 'Anime' : TYPE_NAME[d.type], d.year, d.runtime ? (d.type === 'movie' ? hm(d.runtime) : `${d.runtime}min / ep`) : null,
    d.type === 'tv' && nSeasons ? `${nSeasons} season${nSeasons === 1 ? '' : 's'}` : d.type !== 'movie' && d.episodes ? `${d.episodes} eps` : null,
    d.type !== 'movie' && d.status ? String(d.status).replace(/^./, (c) => c.toUpperCase()) : null, ...shortGenres(d.genres).slice(0, 3)].filter(Boolean).join(' · ');
}
export const Cert = ({ d }: { d: Title }) => d.certification ? (
  <span className="tc-cert" style={CERT_RING[d.certification] ? ({ '--cert': CERT_RING[d.certification] } as CSSProperties) : undefined}>{d.certification}</span>
) : null;

// every score with its source's logo, then Letterboxd and what's given after a thin line (the trailer); the title card and the
// Movies, TV and Anime carousel
// mine: your rating, first in the row (the carousel's; the card shows yours on its poster)
export function Scores({ d, mine, children }: { d: Title; mine?: number | null; children?: ReactNode }) {
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
      {!!mine && (
        <span className="tc-score tc-mine" style={{ '--fill': `${mine * 10}%` } as CSSProperties} aria-label={`Your rating ${mine.toFixed(1)}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={PATHS.star} fill="currentColor" /></svg><b>{mine.toFixed(1)}</b>
        </span>
      )}
      {scores}
      {/* a thin line parts the scores from the links (Letterboxd, the trailer); with no score, no line */}
      {(scores.length > 0 || !!mine) && (lb || children) && <span className="tc-sep" />}
      {lb && <a className="tc-score tc-lb" href={`https://letterboxd.com/tmdb/${d.key.split(':')[2]}/`} target="_blank" rel="noopener" aria-label="Letterboxd"><img src="/icons/letterboxd-dots.svg" alt="" /><b className="tc-link">Reviews</b></a>}
      {children}
    </div>
  );
}

function TitleView({ d }: { d: Title }) {
  const phone = usePhone();
  const { reloadTitle, playTrailer } = useTitle();
  const meta = metaOf(d);

  // the trailer: the YouTube logo in a circle ending the ratings row (plays in the card); on the phone it joins the action row
  const trailer = (short: boolean) => d.trailer && (
    <button type="button" className="tc-ytico" aria-label="Play the trailer" onClick={() => playTrailer(d.trailer!)}>
      <YtLogo />{short ? <span className="tc-al">Trailer</span> : <b className="tc-link">Trailer</b>}
    </button>
  );

  // the big poster carries the same circle as the row cards; its open circle is Add to list. A
  // change there redraws the card once the pointer leaves the poster
  const regular = (d.seasons || []).filter((s) => s.n > 0), total = regular.reduce((n, s) => n + (s.episodes || 0), 0);
  const progress = total ? Math.min(1, regular.reduce((n, s) => n + (d.you?.bySeason?.[s.n] || 0), 0) / total) : null;
  const tile = useMemo<Tile>(() => ({ key: d.key, type: d.type, title: d.title, poster: d.poster, watchlist: d.watchlist,
    watched: (d.type === 'movie' ? d.you?.plays : d.you?.episodes) || 0, mine: d.you?.rating || null, progress, lastAt: d.you?.last || null, next: d.upNext || null }), [d, progress]);
  const dirty = useRef(false);
  const closed = useCallback(() => { if (dirty.current) { dirty.current = false; void reloadTitle(); } }, [reloadTitle]);
  const dial = usePosterDial(tile, { cls: 'tc-postwrap', changed: () => { dirty.current = true; }, closed });
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(idle.current), []);

  // phone: the poster's circle and its options become a row of labelled circles under the scores: how much of a show
  // you've watched, your rating (dragged round, as on the poster), Plan to watch, Watched (films: it shows the film watched
  // itself, so no second circle for it) and the trailer
  const seenN = d.type === 'movie' ? 0 : d.you?.episodes;
  const row = phone && (
    // the poster's circle reloads the card when the pointer leaves it; here that waits until the row has been left alone
    <div className="tc-actrow" onPointerUp={() => { clearTimeout(idle.current); idle.current = setTimeout(closed, 3500); }}>
      {!!seenN && (
        <div className="tc-act">
          <span className="tc-acirc" style={{ '--fill': `${(progress ?? 1) * 100}%` } as CSSProperties}><span><PIcon name="watched" /></span></span>
          <span className="tc-al">{total ? `${d.you!.episodes}/${total}` : `${d.you!.episodes} eps`}</span>
        </div>
      )}
      {dial.rate('Rating')}{dial.plan('Plan')}{dial.seen?.('Watched')}{trailer(true)}
    </div>
  );
  // on a phone the backdrop, poster, title, scores and your circles fill the first screen; a swipe brings the story and the
  // rest (style.css); elsewhere tc-first lays out as if it weren't there
  return (
    <>
      <div className="tc-first">
      <div className="tc-hero" style={d.backdrop ? { backgroundImage: `url("${d.backdrop}")` } : undefined}>
        <div className="tc-head">
          <div {...dial.host}>
            <img className="tc-poster" alt="" src={d.poster || undefined} />
            <div className="tdial-shade" />
            <div className="tdial-menu">{!phone && <>{dial.plan()}{dial.seen?.()}{dial.rate()}</>}</div>
            {dial.dial}{dial.ringDial}
          </div>
          <div className="tc-h">
            <h2 className="tc-title">{d.title + (d.label ? ` · ${d.label}` : '')}</h2>
            <div className="tc-meta">{meta}<Cert d={d} /></div>
            <Scores d={d}>{!phone && trailer(false)}</Scores>
          </div>
        </div>
      </div>
      {row}
      <span className="tc-down" aria-hidden="true"><Icon d="M6 9l6 6 6-6" size={22} width={2} /></span>
      </div>
      <div className="tc-rest">
      <div className="tc-acts tc-beside">
        {d.tagline && <p className="tc-tagline">{d.tagline}</p>}
        {d.overview && <Overview text={d.overview} />}
      </div>
      <CardBody d={d} />
      </div>
    </>
  );
}
// a long overview stops at five lines; More shows the rest
function Overview({ text }: { text: string }) {
  const ov = useRef<HTMLParagraphElement>(null);
  const [clamp, setClamp] = useState(true), [long, setLong] = useState(false);
  useEffect(() => { const f = requestAnimationFrame(() => { const p = ov.current; if (p) setLong(p.scrollHeight > p.clientHeight + 2); }); return () => cancelAnimationFrame(f); }, [text]);
  return (
    <>
      <p ref={ov} className={`tc-overview${clamp ? ' clamp' : ''}`}>{text}</p>
      <button type="button" className="tc-more tc-ovmore" hidden={!long} onClick={() => setClamp(!clamp)}>{clamp ? 'More' : 'Less'}</button>
    </>
  );
}

// Below the header: a menu in the poster's column (the poster's circle with an icon, then name and count) with the open part
// beside it, so the card stays about one screen tall. Shows: Overview · Episodes · Cast · Similar; movies: Overview · Cast ·
// Similar · Collection
const TC_ICON: Record<string, string> = {
  overview: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17zM12 11v5.5M12 7.8h.01',
  episodes: 'M3.5 5.5h17v13h-17zM10 9.3l5 2.7-5 2.7z',
  cast: 'M9 11a3.5 3.5 0 1 0 0-7a3.5 3.5 0 1 0 0 7zM2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.3a3.3 3.3 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.4 3.5 5.2',
  similar: 'M8.5 8h11v12.5h-11zM5 4.5h11M5 4.5v12.5',
  collection: 'M3.5 9.5h17v11h-17zM5.5 6.5h13M7.5 3.5h9',
};
const trend = (t: Tile) => <TrendCard t={t} />;
function CardBody({ d }: { d: Title }) {
  const [tab, setTab] = useState('overview');
  const [eps, setEps] = useState({ season: null as number | null, allEps: false, fromStart: false });
  const y = d.you || {}, total = (d.facts?.episodes as number | null) || d.episodes || null;
  const tabs: [string, string, string][] = [['overview', 'Overview', ''],
    ...(d.type !== 'movie' && d.seasons?.length ? [['episodes', 'Episodes', total ? `${y.episodes || 0}/${total}` : String(y.episodes || '')] as [string, string, string]] : []),
    ...(d.cast?.length ? [['cast', 'Cast', String(d.cast.length)] as [string, string, string]] : []),
    ...(d.similar?.length ? [['similar', 'Similar', String(d.similar.length)] as [string, string, string]] : []),
    ...(d.collectionItems?.length ? [['collection', 'Collection', String(d.collectionItems.length)] as [string, string, string]] : [])];
  const on = tabs.some(([id]) => id === tab) ? tab : 'overview';
  // every part but Episodes stays laid out (hidden) in the same place, so the card keeps the tallest one's height and switching
  // doesn't jump; Overview stretches to it. Episodes, longer by nature, is added only while open
  const layer = (id: string) => `tc-layer${on === id ? ' on' : ''}`;
  return (
    <div className="tc-body">
      <div className="tc-nav" role="tablist" aria-orientation="vertical">
        {tabs.map(([id, label, count]) => (
          <button key={id} type="button" className={`tc-navb${on === id ? ' on' : ''}`} data-t={id} role="tab" aria-selected={on === id} onClick={() => setTab(id)}>
            <Circ><Icon d={TC_ICON[id]} /></Circ><span className="l">{label}</span><span className="c">{count}</span>
          </button>
        ))}
      </div>
      <div className="tc-pane">
        {tabs.map(([id]) => (id === 'overview' ? <Details key={id} d={d} cls={layer(id)} />
          : id === 'cast' ? <Group key={id} id="tc-cast" title={null} cls={`group tc-sec ${layer(id)}`} railClass="rail ptrack tc-rail" items={d.cast} keyOf={(x) => `${x.name}|${x.role}`} card={CastCard} />
          : id === 'similar' ? <Group key={id} id="tc-similar" title={null} cls={`group tc-sec ${layer(id)}`} railClass="rail ptrack tc-rail" items={d.similar} keyOf={(t) => t.key} card={trend} />
          : id === 'collection' ? <Group key={id} id="tc-coll" title={null} cls={`group tc-sec ${layer(id)}`} railClass="rail ptrack tc-rail" items={d.collectionItems} keyOf={(t) => t.key} card={trend} />
          : null))}
        {on === 'episodes' && <EpisodesPane d={d} st={eps} set={(s) => setEps((x) => ({ ...x, ...s }))} />}
      </div>
    </div>
  );
}

// a cast member as a poster-shaped card: photo, name, character
function CastCard(x: Title['cast'][number]) {
  return (
    <div className="tcard tcast" aria-label={`${x.name}${x.role ? ` · ${x.role}` : ''}`}>
      <div className="tposter">{x.photo && <img src={x.photo} alt="" loading="lazy" />}</div>
      <div className="names"><span className="name">{x.name}</span><span className="host">{x.role || ''}</span></div>
    </div>
  );
}

// Details as compact cells, three to a row: the type's own six, where it's from, your history
function Details({ d, cls }: { d: Title; cls: string }) {
  const { reloadTitle, pickDay } = useTitle();
  const editRef = useRef<HTMLButtonElement>(null);
  // when a "+N" is shown, the full list is for screen readers
  const cell = (k: string, v: ReactNode, full?: string | null, c?: string) => (
    <div key={k} className="meter" aria-label={full && full !== v ? `${k} ${full}` : undefined}>
      <span className="meter-k">{k}</span><span className={`meter-v${c ? ` ${c}` : ''}`}>{!v ? DASH : typeof v === 'string' ? <Tight text={v} /> : v}</span>
    </div>
  );
  const money = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : `$${Math.round(n / 1e6)}M`);
  const names = (list: string[] | undefined) => (list?.length ? [`${list[0]}${list.length > 1 ? ` +${list.length - 1}` : ''}`, list.join(', ')] : [null, null]);
  const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const f = d.facts || {}, str = (k: string) => (f[k] == null ? undefined : String(f[k]));
  const [stu, stuAll] = names(str('studio')?.split(', '));
  const cells: ReactNode[] = [];
  if (d.type === 'movie') {
    const m = d.money || { budget: null, revenue: null }, [dir, dirAll] = names(d.people?.names), [wri, wriAll] = names(d.writers);
    cells.push(cell('Released', d.released ? fmtDay(d.released) : null), cell('Budget', m.budget ? money(m.budget) : null), cell('Box office', m.revenue ? money(m.revenue) : null),
      cell('Director', dir, dirAll, 'txt'), cell((d.writers?.length || 0) > 1 ? 'Writers' : 'Writer', wri, wriAll, 'txt'), cell('Studio', stu, stuAll, 'txt'));
  } else {
    const n = d.seasons?.filter((x) => x.n > 0).length, eps = (f.episodes as number | null) || d.episodes;
    const next = d.next?.date ? cell('Next episode', `${d.next.season != null ? `S${d.next.season} E${d.next.ep} · ` : ''}${day(d.next.date)}`, null, 'txt acc')
      : cell(/ended|canceled|finished/i.test(d.status || '') ? 'Ended' : 'Last aired', fmtDay(str('lastAired')), null, 'txt');
    const count = cell('Episodes', eps ? `${eps}${d.type === 'tv' && n ? ` · ${n} season${n === 1 ? '' : 's'}` : ''}` : null, null, 'txt');
    if (d.type === 'anime') cells.push(cell('First aired', fmtDay(d.released), null, 'txt'), next, count, cell('Season', str('season'), null, 'txt'),
      cell('Format', d.format ? String(d.format).replace(/^./, (c) => c.toUpperCase()) : null, null, 'txt'), cell('Studio', stu, stuAll, 'txt'));
    else {
      const [by, byAll] = names(d.people?.names), [net, netAll] = names(str('network')?.split(', '));
      cells.push(cell('First aired', fmtDay(d.released), null, 'txt'), next, count, cell('Created by', by, byAll, 'txt'), cell('Network', net, netAll, 'txt'), cell('Studio', stu, stuAll, 'txt'));
    }
  }
  // where it's from (country and language by name, the awards' first line), then your history with it
  const name = (type: 'language' | 'region', codes: string | undefined) => {
    try { const n = new Intl.DisplayNames(['en'], { type }); return codes?.split(', ').map((c) => n.of(type === 'language' ? c.toLowerCase() : c)).join(', ') || null; } catch { return codes || null; }
  };
  const aw = d.scores?.awards, y = d.you || {};
  const when = (t: number | null | undefined) => (t ? fmtDay(new Date(t).toISOString()) : null);
  // anime: what it was adapted from, and its MyAnimeList rank, instead of country (always Japan) and awards
  if (d.type === 'anime') cells.push(cell('Source', str('source'), null, 'txt'), cell('Language', name('language', str('language')), null, 'txt'),
    cell('MAL rank', f.rank ? `#${Number(f.rank).toLocaleString('en-GB')}` : null, null, 'txt'));
  else cells.push(cell('Country', name('region', str('country')), null, 'txt'), cell('Language', name('language', str('language')), null, 'txt'),
    cell('Awards', aw ? aw.split('. ')[0].replace(/\.$/, '') : null, aw, 'txt'));
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
    cells.push(cell('Watched', y.plays ? `${y.plays}×` : null, null, 'txt'), cell('First watched', when(y.first), null, 'txt'), cell('Last watched', lw, null, 'txt'));
  } else cells.push(cell('Watched', y.episodes ? `${y.episodes} ep${y.episodes === 1 ? '' : 's'}` : null, y.plays ? `${y.plays} plays` : null, 'txt'),
    cell('Started', when(y.first), null, 'txt'), cell('Last watched', y.last ? `${when(y.last)} · ${ago(y.last)} ago` : null, null, 'txt'));
  return <div className={`glass dpanel dcells tc-details ${cls}`}>{cells}</div>;
}
