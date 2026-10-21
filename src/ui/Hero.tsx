'use client';
// The Movies, TV and Anime pages' carousel: that kind's trending titles, one at a time on its wide image across the page's
// whole width and up under the search. Each shows what the title card does at its head, bigger: name, the line of facts and age
// rating, the scores (yours first if you rated it: a film, or a show's or anime's latest season) and the trailer after them (as on the card;
// it plays in the carousel), and the story. It moves on every 6 s, except while the pointer is on the words, a trailer plays,
// or motion is reduced. The titles' posters (dots on a phone) pick one, the current one with a bar
// running out its 6 s; on a phone a swipe moves on or back
import { useEffect, useMemo, useRef, useState } from 'react';
import { getJ } from './lib/api';
import { cards, type Tile, type TilePatch, type TitleType } from './lib/media';
import { titleUrl, type Title } from './lib/title';
import { useOpens } from './Cards';
import { Cert, Scores, YtLogo, metaOf } from './Title';

type Item = Tile & { backdrop: string | null; overview: string | null; genres: string[]; rating: number | null };
const NAME: Record<TitleType, string> = { movie: 'Movies', tv: 'Shows', anime: 'Anime' };
// TMDB's wide images come at 780 px; the carousel is the page's width
const wide = (u: string | null) => u?.replace('/t/p/w780/', '/t/p/w1280/') || undefined;
// a phone's tall carousel shows the poster instead, which fits it (TMDB's at 780 px)
const tall = (u: string | null) => u?.replace(/\/t\/p\/w\d+\//, '/t/p/w780/') || undefined;
// each title's card, asked once per page visit (the scores, age rating and trailer the carousel shows)
const cardsGot = new Map<string, Promise<Title | null>>();
// your rating as the row shows it: a film's; a show's (anime ones too) only for its latest season; a Kitsu anime entry is one
// season, so that season's, or else the entry's own
const yours = (d: Title) => {
  if (d.type === 'movie') return d.you?.rating || null;
  const last = Math.max(0, ...(d.seasons || []).map((x) => x.n));
  return (last && d.you?.seasonRatings?.[last]) || (d.type === 'anime' && d.you?.rating) || null;
};
const cardOf = (key: string) => {
  if (!cardsGot.has(key)) cardsGot.set(key, getJ<Title>(titleUrl(key)).catch(() => null));
  return cardsGot.get(key)!;
};

export function Hero({ kind }: { kind: TitleType }) {
  const [got, setGot] = useState<{ kind: TitleType; items: Item[] } | null>(null);
  const [at, setAt] = useState(0), [held, setHeld] = useState(false), [trailer, setTrailer] = useState<string | null>(null);
  const [full, setFull] = useState<Record<string, Title>>({});
  // a swipe across the carousel (a phone): where it started, to tell left from right, and from scrolling the page
  const swipe = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    let live = true;
    cardsGot.clear();
    getJ<{ items: Item[] }>(`/api/hero/${kind}`).then((r) => { if (live) { setGot({ kind, items: r.items }); setAt(0); setTrailer(null); } }).catch(() => {});
    return () => { live = false; };
  }, [kind]);
  // Plan to watch, Watched and your rating changed here or on a poster show on both
  useEffect(() => {
    const on = (e: Event) => {
      const { key, patch } = (e as CustomEvent<{ key: string; patch: TilePatch }>).detail;
      setGot((g) => (g && g.items.some((x) => x.key === key) ? { ...g, items: g.items.map((x) => (x.key === key ? { ...x, ...patch } : x)) } : g));
    };
    cards.addEventListener('sync', on);
    return () => cards.removeEventListener('sync', on);
  }, []);
  const items = useMemo(() => (got?.kind === kind ? got.items : []), [got, kind]);
  const t = items.length ? items[at % items.length] : null;
  // this title's card and the next one's, so the scores are there when it comes round
  useEffect(() => {
    if (!t) return;
    let live = true;
    for (const x of [t, items[(at + 1) % items.length]]) void cardOf(x.key).then((d) => { if (live && d) setFull((f) => (f[x.key] ? f : { ...f, [x.key]: d })); });
    return () => { live = false; };
  }, [t, at, items]);
  // the poster's bar is drawn only while it moves, so it starts again with the 6 s (a new slide, the pointer leaving)
  const moving = !held && !trailer && items.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    if (!moving) return;
    const id = setTimeout(() => setAt((n) => (n + 1) % items.length), 6000);
    return () => clearTimeout(id);
  }, [at, moving, items.length]);

  const opens = useOpens(t ? { key: t.key } : null);

  // until the titles come in, the empty shade holds the carousel's place
  if (!t) return <section className="hero" aria-hidden="true"><div className="hero-shade" /></section>;
  const d = full[t.key];
  return (
    <section className="hero" aria-roledescription="carousel" aria-label={`Trending ${NAME[kind].toLowerCase()}`}
      onTouchStart={(e) => { swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
      onTouchEnd={(e) => {
        const s = swipe.current; swipe.current = null; if (!s) return;
        const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) { setTrailer(null); setAt((n) => (n + (dx < 0 ? 1 : -1) + items.length) % items.length); }
      }}>
      {items.map((x, n) => (
        <picture key={x.key}>
          {x.poster && <source media="(max-width: 599px)" srcSet={tall(x.poster)} />}
          <img className={`hero-bg${n === at ? ' on' : ''}`} src={wide(x.backdrop)} alt="" decoding="async" loading={n ? 'lazy' : 'eager'} />
        </picture>
      ))}
      <div className="hero-shade opens" onClick={opens.onClick} onPointerEnter={opens.onPointerEnter} />
      <div className="hero-body" onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}>
        <span className="hero-kick">Trending {NAME[kind]} · #{at + 1}</span>
        <h2 className="hero-title opens" {...opens}>{t.title}{t.label ? ` · ${t.label}` : ''}</h2>
        <div className="tc-meta hero-meta">{d ? metaOf(d) : [t.year, ...t.genres].filter(Boolean).join(' · ')}{d && <Cert d={d} />}</div>
        {d && (
          <Scores d={d} mine={yours(d)}>
            {d.trailer && <button type="button" className="tc-ytico" aria-label="Play the trailer" onClick={() => setTrailer((d.trailer!.match(/[?&]v=([\w-]{6,})/) || [])[1] || null)}>
              <YtLogo /><b className="tc-link">Trailer</b>
            </button>}
          </Scores>
        )}
        {t.overview && <p className="hero-story">{t.overview}</p>}
      </div>
      <div className="hero-picks">
        {items.map((x, n) => (
          <button key={x.key} type="button" className={`hero-pick${n === at ? ' on' : ''}`} aria-label={`${n + 1}: ${x.title}`} aria-current={n === at}
            onClick={() => { setTrailer(null); setAt(n); }}>
            <img src={x.poster || undefined} alt="" loading="lazy" decoding="async" />
            {n === at && moving && <span className="hero-time"><span /></span>}
          </button>
        ))}
      </div>
      {/* the trailer over the picture (youtube-nocookie, the origin as Referer: see the title card's player) */}
      {trailer && (
        <div className="hero-player">
          <iframe src={`https://www.youtube-nocookie.com/embed/${trailer}?autoplay=1&rel=0&modestbranding=1`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen title="Trailer" referrerPolicy="strict-origin-when-cross-origin" />
          <button type="button" className="hero-x" aria-label="Close the trailer" onClick={() => setTrailer(null)}>×</button>
        </div>
      )}
    </section>
  );
}
