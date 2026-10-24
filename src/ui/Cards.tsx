'use client';
// The home page's cards: wide cards (History, Continue watching, Up next, Plan to watch) with their one circle each, and the
// poster cards of every other row with the circle saying where you are with the title. Undoing something always takes a second
// tap on the same circle: it turns red and goes back by itself after 3 s.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getJ, postJ } from './lib/api';
import { useHome, usePhone } from './lib/home';
import { Icon, mediaMark, PATHS } from './lib/icons';
import { openAddTo } from './lib/lists';
import { useLook } from './lib/look';
import { prefetch } from './lib/title';
import { APP_NAME, cards, staleFor, syncCards, touchKey, type Ref, type Tile, type TilePatch, type Wide } from './lib/media';

const PICON = {
  bookmark: PATHS.bookmark,
  watched: PATHS.watched,   // a double tick, like "seen"
  more: 'M5.5 12h.01M12 12h.01M18.5 12h.01',
  list: 'M4 6.5h11M4 12h11M4 17.5h7M18 14.5v6M15 17.5h6',
  plus: PATHS.plus,
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  star: 'M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z',
  calendar: 'M5 6h14v14H5zM5 10.5h14M9 3.5v4M15 3.5v4',
};
export function PIcon({ name, filled = false }: { name: keyof typeof PICON; filled?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth={name === 'more' ? 3.2 : name === 'watched' ? 2.2 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PICON[name]} /></svg>
  );
}

// the picker buttons: a ringed circle like the menu's, an icon or the service's logo in it, its name under it
export function PkBtn({ label, data, face, on, none, pressed, aria, onClick }: { label: string; data: Record<string, string>; face: string | ReactNode;
  on: boolean; none?: boolean; pressed?: boolean; aria?: string; onClick: () => void }) {
  const attrs = Object.fromEntries(Object.entries(data).map(([k, v]) => [`data-${k}`, v]));
  return (
    <button type="button" className={`pk${on ? ' on' : ''}${none ? ' none' : ''}`} {...attrs} aria-pressed={pressed} aria-label={aria} onClick={onClick}>
      <span className="pk-c">{typeof face === 'string'
        ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={face} /></svg>
        : face}</span>
      <span className="pk-t">{label}</span>
    </button>
  );
}

// a tap arms it for 3 s (red, asking); a second tap within that does it
export function useTwoTap() {
  const [armed, setArmed] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  const disarm = () => { if (t.current) clearTimeout(t.current); t.current = null; setArmed(false); };
  const tap = (fn: () => unknown) => {
    if (t.current) { disarm(); return void fn(); }
    setArmed(true); t.current = setTimeout(() => { t.current = null; setArmed(false); }, 3000);
  };
  return { armed, tap, disarm };
}

// a card opens its title: a click anywhere but its circles, or Enter / Space on the card itself
export function useOpens(ref: Ref | null) {
  const { openTitle } = useHome();
  if (!ref) return {};
  return {
    tabIndex: 0, role: 'button', onPointerEnter: () => prefetch(ref),
    onClick: (e: React.MouseEvent<HTMLElement>) => { if (e.currentTarget.contains(e.target as Node) && !(e.target as Element).closest('button, a')) openTitle(ref); },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openTitle(ref); } },
  };
}

// Rate on the circle itself: drag round it like a clock hand (12 o'clock 0, a full turn 10, in tenths; further out is finer) and
// let go to save; ratings run 1-10, so below 1 the ring empties and letting go there removes the rating. A tap on a rated
// circle asks "Remove?" and a second tap clears it; on the phone a tap opens the big dial (a small ring is hard to drag)
type Rating = { cur: () => number; show: (v: number) => void; reset: () => void; save: (v: number | null) => Promise<unknown>; confirm: (fn: () => unknown) => void;
  dragging: (on: boolean) => void };
const valAt = (e: React.PointerEvent, el: Element) => {
  const r = el.getBoundingClientRect(), a = Math.atan2(e.clientX - (r.left + r.width / 2), (r.top + r.height / 2) - e.clientY);
  const v = Math.round(((a + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * 100) / 10;
  return v < 1 ? 0 : v;
};
export function useRingRate(o: Rating) {
  const drag = useRef<{ x: number; y: number; v: number | null } | null>(null);
  const phone = usePhone();
  const [dial, setDial] = useState(false);
  const end = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const v = drag.current.v; drag.current = null; o.dragging(false);
    if (e.type === 'pointercancel') return o.reset();
    if (v != null) { if (v !== o.cur() && (v || o.cur())) void o.save(v || null).then(o.reset); else o.reset(); return; }
    if (phone) return setDial(true);
    if (o.cur()) o.confirm(() => o.save(null));
  };
  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => { if (e.button) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, v: null }; },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || (d.v == null && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4)) return;
      let v = valAt(e, e.currentTarget);
      // across 12 o'clock the value stays at the end it came from instead of jumping 10 <-> 0
      if (d.v != null && Math.abs(v - d.v) > 5) v = d.v > 5 ? 10 : 0;
      if (v === d.v) return;
      d.v = v; o.dragging(true); o.show(v);
    },
    onPointerUp: end, onPointerCancel: end,
  };
  // a phone never rates by dragging the small circle (a swipe or a scroll across it rated by mistake): a plain tap opens the big
  // dial (pointer-up waited seconds on iPhones), and a scroll that starts on it just scrolls
  const tap = { onClick: (e: React.MouseEvent) => { e.stopPropagation(); setDial(true); } };
  return { handlers: phone ? tap : handlers, dial: dial ? <RateDial was={o.cur()} show={o.show} reset={o.reset} save={o.save} close={() => setDial(false)} /> : null };
}

// the phone's rating dial: one big ring in the middle of the screen that works like the small ones (drag round: 12
// o'clock 0, a full turn 10, 0.1 steps; let go to save). A tap outside closes it unchanged; a rated one also gets a remove
// circle (red on the first tap, removed on the second). The small circle follows as you drag
function RateDial({ was, show, reset, save, close }: { was: number; show: (v: number) => void; reset: () => void; save: (v: number | null) => Promise<unknown>; close: () => void }) {
  const [v, setV] = useState(was);
  const drag = useRef<{ v: number | null } | null>(null);
  const rm = useTwoTap();
  const shut = () => { reset(); close(); };
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); reset(); close(); } };
    document.addEventListener('keydown', esc, true);
    return () => document.removeEventListener('keydown', esc, true);
  }, [reset, close]);
  const end = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const x = drag.current.v; drag.current = null;
    if (e.type === 'pointercancel' || x == null) { setV(was); reset(); return; }
    if (x === was || (!x && !was)) { shut(); return; }
    close(); void save(x || null).then(reset);
  };
  const hint = v ? (v === was ? 'your rating' : 'let go to save') : was ? 'let go to remove' : 'drag round to rate';
  return createPortal(
    <div className="rdial-scrim" onClick={(e) => { if (e.target === e.currentTarget) shut(); }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="rdial">
        <div className="rdial-ring" style={{ '--fill': `${v * 10}%` } as React.CSSProperties}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { v: null }; }}
          onPointerMove={(e) => {
            const d = drag.current; if (!d) return;
            let x = valAt(e, e.currentTarget);
            if (d.v != null && Math.abs(x - d.v) > 5) x = d.v > 5 ? 10 : 0;   // across 12 o'clock it stays at its end
            if (x === d.v) return;
            d.v = x; setV(x); show(x);
          }} onPointerUp={end} onPointerCancel={end}>
          <div className="rdial-face"><span className="rdial-n">{v ? v.toFixed(1) : '–'}</span><span className="rdial-h">{hint}</span></div>
        </div>
        <div className="rdial-btns">
          <button type="button" className="acct-c" aria-label="Close" onClick={shut}><Icon d="M6 6l12 12M18 6L6 18" /></button>
          {!!was && (
            <button type="button" className={`acct-c rm${rm.armed ? ' armed' : ''}`} aria-label={rm.armed ? 'Remove your rating? Tap again' : 'Remove your rating'}
              onClick={() => rm.tap(() => { close(); void save(null).then(reset); })}><Icon d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// History, Up next and Plan to watch: a small 16:9 card, the title and episode on a dark fade over the image, progress along
// its bottom edge. Clicking opens the title panel. History cards carry Listick's logo (in the picked accent); the others leave it out
export function WideCard({ w, logo = true, cls = '', children }: { w: Wide; logo?: boolean; cls?: string; children?: ReactNode }) {
  const { accent } = useLook();
  const opens = useOpens(w.ref);
  const [tall, setTall] = useState(!w.wide);
  return (
    <div className={`wcard${w.ref ? ' opens' : ''}${tall ? ' tall' : ''}${w.pct && w.pct > 0 ? ' has-prog' : ''}${children ? ' has-dial' : ''}${cls}`}
      aria-label={`${w.title} · ${w.sub} · ${APP_NAME[w.app]}`} {...opens}>
      <img className="bg" alt="" loading="lazy" decoding="async" src={(tall ? w.poster : w.wide) || undefined} onError={() => { if (!tall) setTall(true); }} />
      <span className="shade" />
      {/* compact on the card: "2d", "20h", "35%" ("S1 E10 · 10h ago"); its aria-label keeps the full text */}
      <span className="txt"><span className="t">{w.title}</span>
        <span className="s">{logo && <img className="media-logo" src={mediaMark(accent)} alt="" />}{w.sub.replace(/(\d) (d|h|min|s|%)(?!\w)/g, '$1$2')}</span></span>
      {!!w.pct && w.pct > 0 && <span className="wprog"><span style={{ width: `${w.pct}%` }} /></span>}
      {w.watching ? <span className="wnew playing">WATCHING</span> : w.rewatch ? <span className="wnew">REWATCH</span> : w.isNew && <span className="wnew">NEW</span>}
      {children}
    </div>
  );
}

// a Continue watching card: one circle (⋯, on hover) like Plan to watch's. A tap brings its two actions: ✕ removes the card
// (nothing recorded), the watched mark beside it marks it watched (a play goes into History). Either way the card stays away until
// Stremio has newer progress for it; after 3 s they fold back into ⋯
export function ResumeCard({ w }: { w: Wide }) {
  const { reload } = useHome();
  const ask = useTwoTap();
  const [leaving, setLeaving] = useState(false), [gone, setGone] = useState(false);
  const cw = w.cw!;
  const leave = async (watched: boolean) => {
    ask.disarm(); setLeaving(true);
    const fail = (m: string) => { setLeaving(false); alert(`Couldn't save: ${m}`); };
    if (watched) {
      let key = cw.key;
      if (!key && cw.movie) key = (await getJ<{ key?: string }>(`/api/resolve?${new URLSearchParams({ imdb: cw.id })}`).catch(() => ({ key: undefined }))).key;
      if (!key) return fail('title not found');
      touchKey(key);
      const err = await postJ(`/api/mark/${encodeURIComponent(key)}`, cw.movie ? { season: -1, episodes: [-1], watched: true } : { season: cw.se, episodes: [cw.ep], watched: true });
      if (err) return fail(err);
      syncCards(key, { watched: 1 });
    }
    const err = await postJ('/api/hide-continue', { id: cw.id, video: cw.video, at: cw.at });
    if (err) return fail(err);
    setGone(true); reload(800);
  };
  if (gone) return null;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();   // Enter / Space act on the circle
  return (
    <WideCard w={w} logo={false} cls={`${ask.armed ? ' asking' : ''}${leaving ? ' leaving' : ''}`}>
      <button type="button" className="pdial second" aria-label="Mark watched" onKeyDown={stop}
        onClick={(e) => { e.stopPropagation(); if (ask.armed) void leave(true); }}><span className="face"><PIcon name="watched" /></span></button>
      <button type="button" className={`pdial${ask.armed ? ' confirm' : ' acts'}`} aria-label={ask.armed ? 'Remove from Continue watching' : 'Actions'} onKeyDown={stop}
        onClick={(e) => { e.stopPropagation(); ask.tap(() => leave(false)); }}><span className="face"><PIcon name={ask.armed ? 'close' : 'more'} /></span></button>
    </WideCard>
  );
}

// a Plan to watch card: one plain circle with the bookmark, like the posters'. A tap turns it red (✕) to ask; a second within
// 3 s takes the title off the list
export function PlanCard({ w }: { w: Wide }) {
  const { reload } = useHome();
  const ask = useTwoTap();
  const [leaving, setLeaving] = useState(false), [gone, setGone] = useState(false);
  const key = w.ref && 'key' in w.ref ? w.ref.key : null;
  if (!key) return <WideCard w={w} logo={false} />;
  if (gone) return null;
  const remove = async () => {
    setLeaving(true); touchKey(key);
    const err = await postJ(`/api/watchlist/remove/${encodeURIComponent(key)}`);
    touchKey(key);
    if (err) { setLeaving(false); return alert(`Plan to watch: ${err}`); }
    syncCards(key, { watchlist: false });
    setGone(true); reload(800);
  };
  return (
    <WideCard w={w} logo={false} cls={leaving ? ' leaving' : ''}>
      <button type="button" className={`pdial${ask.armed ? ' confirm' : ''}`} aria-label={ask.armed ? 'Remove from Plan to watch?' : 'Remove from Plan to watch'}
        onKeyDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); ask.tap(remove); }}>
        <span className="face">{ask.armed ? <PIcon name="close" /> : <PIcon name="bookmark" filled />}</span>
      </button>
    </WideCard>
  );
}

// a History card: one rating circle for what you watched there (the episode, or the movie), like the posters': drag round it to
// rate; on a rated one a tap turns it red (✕) and a second within 3 s removes the rating
export function HistCard({ w }: { w: Wide }) {
  const { reload } = useHome();
  const p = w.play;
  const [mine, setMine] = useState(p?.mine || 0);
  const [given, setGiven] = useState(p?.mine);
  if (p?.mine !== given) { setGiven(p?.mine); setMine(p?.mine || 0); }   // rated since, here or elsewhere
  const [view, setView] = useState<number | null>(null);   // while dragging
  const [dragging, setDragging] = useState(false);
  const ask = useTwoTap();
  const reset = () => { ask.disarm(); setView(null); };
  const save = async (n: number | null) => {
    ask.disarm(); touchKey(p!.key);
    const err = await postJ(`/api/rate/${encodeURIComponent(p!.key)}`, { rating: n, season: p!.season, episode: p!.episode });
    if (err) { reset(); return alert(`Couldn't save: ${err}`); }
    setMine(n || 0); reset(); reload(800);
  };
  const ring = useRingRate({ cur: () => mine, show: (v) => { ask.disarm(); setView(v); }, reset, save, confirm: ask.tap, dragging: setDragging });
  if (!p) return <WideCard w={w} />;
  const v = view ?? mine;
  return (
    <WideCard w={w} cls={dragging ? ' dragging' : ''}>
      <button type="button" className={`pdial rate${v ? ' rated' : ''}${ask.armed ? ' confirm' : ''}`} style={{ '--fill': `${v * 10}%` } as React.CSSProperties}
        aria-label={v ? `Your rating ${v.toFixed(1)}` : 'Rate'} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} {...ring.handlers}>
        <span className="face">{ask.armed ? <PIcon name="close" /> : v ? v.toFixed(1) : <PIcon name="star" />}</span>
      </button>
      {ring.dial}
    </WideCard>
  );
}

// A poster card, the same everywhere titles are shown:
//   top-left   a Coming-soon date when there is one (the sites' scores are in the title panel)
//   bottom-right  one circle saying where you are with the title (PosterArt)
//   the poster itself opens the title panel; on touch screens the panel holds the actions
export function TrendCard({ t, dismiss }: { t: Tile; dismiss?: (key: string) => void }) {
  const opens = useOpens({ key: t.key });
  const now = !!useHome().watching?.has(t.key);
  return (
    <div className="tcard" aria-label={`${t.title}${t.label ? ` · ${t.label}` : ''}${t.year ? ` (${t.year})` : ''}${t.why ? ` · ${t.why}` : ''}`}>
      <PosterArt t={t} dismiss={t.dismiss && dismiss ? () => dismiss(t.key) : null}>
        <img alt="" loading="lazy" decoding="async" src={t.poster || undefined} className="opens" {...opens} />
        {now ? <span className="trate playing">WATCHING</span> : t.tag && <span className="trate">{t.tag}</span>}
      </PosterArt>
      <div className="names"><span className="name">{t.title}</span><span className="host mono">{t.note || [t.year, t.label].filter(Boolean).join(' · ')}</span></div>
    </div>
  );
}

// only one poster's actions are open at a time on touch
let closeOpen: (() => void) | null = null;
// a poster's actions opened by a tap: the one open before closes
const takeOpen = (close: () => void) => { closeOpen?.(); closeOpen = close; };
const norm = (k: string, v: unknown) => (k === 'watchlist' ? !!v : v || 0);
// The circle on a poster: your rating as an accent ring filled to it, else the watched mark (watched), a bookmark (Plan to watch)
// or +, all plain white. Hovering the poster (tapping the circle on touch) opens Plan to watch · Watched (movies) · Rate above it
// and turns the circle into ⋯ (More). dismiss: the open circle is ✕ Not interested (else Add to list); changed follows a saved
// change (default: refresh the page); closed runs when the pointer leaves (or a tap outside closes it)
// cls: the host's own class (a row poster's tposter, the title card's tc-postwrap)
type DialOpts = { dismiss?: (() => void) | null; changed?: () => void; closed?: () => void; cls?: string };
function PosterArt({ t, children, ...o }: DialOpts & { t: Tile; children: ReactNode }) {
  const p = usePosterDial(t, o);
  return (
    <div {...p.host}>
      {children}
      <div className="tdial-shade" />
      <div className="tdial-menu">{p.plan()}{p.seen?.()}{p.rate()}</div>
      {p.dial}{p.ringDial}
    </div>
  );
}
// the poster's circle and its options as parts, for a host that places the options elsewhere (the title card on a phone); an
// option given a short name carries it under its circle
export function usePosterDial(given: Tile, { dismiss, changed, closed, cls = 'tposter' }: DialOpts) {
  const { reload } = useHome();
  const after = () => (changed ? changed() : reload(800));
  // your changes (and other cards' of this title) over the last data; a refresh replaces them unless it was asked before them
  const [local, setLocal] = useState<TilePatch>({});
  const [base, setBase] = useState(given);
  if (given !== base) { setBase(given); if (!staleFor(given.key)) setLocal({}); }
  const t = { ...given, ...local };
  useEffect(() => {
    const on = (e: Event) => {
      const { key, patch } = (e as CustomEvent<{ key: string; patch: TilePatch }>).detail;
      if (key === given.key) setLocal((m) => (Object.entries(patch).some(([k, v]) => norm(k, { ...given, ...m }[k as keyof TilePatch]) !== norm(k, v)) ? { ...m, ...patch } : m));
    };
    cards.addEventListener('sync', on);
    return () => cards.removeEventListener('sync', on);
  }, [given]);
  const apply = (patch: TilePatch) => syncCards(t.key, patch);

  const art = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [dragging, setDragging] = useState(false);
  const [rateView, setRateView] = useState<number | null | undefined>(undefined);   // the Rate circle while dragging
  const dis = useTwoTap(), seen = useTwoTap(), rm = useTwoTap();
  // a tap outside an open poster (touch) puts its actions away
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (!art.current?.contains(e.target as Node)) { setOpen(false); closed?.(); } };
    document.addEventListener('click', out);
    return () => document.removeEventListener('click', out);
  }, [open, closed]);

  async function toggleWatchlist() {
    const on = !t.watchlist;
    touchKey(t.key); apply({ watchlist: on });
    const err = await postJ(`/api/watchlist/${on ? 'add' : 'remove'}/${encodeURIComponent(t.key)}`);
    touchKey(t.key);
    if (err) { apply({ watchlist: !on }); return alert(`Plan to watch: ${err}`); }
    after();
  }
  // a poster marks it watched with the date unknown (never "now"); the title card's Overview sets the date
  async function setWatched(on: boolean, at?: string) {
    touchKey(t.key);
    const got: { left?: number } = {};
    const err = await postJ(`/api/mark/${encodeURIComponent(t.key)}`, { season: -1, episodes: [-1], watched: on, ...(at ? { at } : {}) }, got);
    touchKey(t.key);
    if (err) return alert(`Couldn't save: ${err}`);
    apply({ watched: on || got.left ? 1 : 0 }); after();   // removing takes the latest play only; earlier ones keep it watched
  }
  async function rate(n: number | null) {
    touchKey(t.key);
    const err = await postJ(`/api/rate/${encodeURIComponent(t.key)}`, { rating: n });
    touchKey(t.key);
    if (err) return alert(`Couldn't save: ${err}`);
    apply({ mine: n }); after();
  }
  const ring = useRingRate({ cur: () => t.mine || 0, show: setRateView, reset: () => setRateView(undefined), save: rate, confirm: rm.tap, dragging: setDragging });

  const icon = t.mine ? null : t.watched ? 'watched' : t.watchlist ? 'bookmark' : 'plus';
  // your rating fills the accent ring to it; the watched mark fills it as far as you've watched (a movie: all of it, a show:
  // its share of episodes); the bookmark and + keep the plain white look
  const seenPart = !t.mine && t.watched ? (t.type === 'movie' ? 1 : t.progress) : null;
  // the one hover text left in the app: what the circle can't say, a show's next episode ("Next S1 E5"), else the day you last
  // watched it ("11 Oct 26")
  const last = t.lastAt ? new Date(t.lastAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : null;
  const tip = (t.mine || t.watched) && (t.type !== 'movie' && t.next ? `Next ${t.next}` : last);
  const says = tip ? (tip === last ? `Watched ${last}` : tip) : t.mine ? `Your rating ${t.mine.toFixed(1)} / 10` : icon === 'watched' ? 'Watched'
    : icon === 'bookmark' ? 'On Plan to watch' : 'Actions';
  const rv = rateView === undefined ? t.mine || 0 : rateView || 0;
  const rateLabel = rateView === undefined ? (t.mine ? `Your rating ${t.mine.toFixed(1)}` : 'Drag to rate') : rateView ? `Your rating ${rateView.toFixed(1)}` : t.mine ? 'Release to remove' : 'Rate';

  const opt = (name: 'bookmark' | 'watched' | 'star', label: string, on: boolean, armed: boolean, rating: number, onClick: () => void, short?: string, extra = {}) => (
    <button key={name} type="button" className={`topt${on ? ' on' : ''}${rating ? ' rated' : ''}${armed ? ' confirm' : ''}`} aria-label={label}
      style={{ '--fill': `${rating * 10}%` } as React.CSSProperties} onClick={(e) => { e.stopPropagation(); onClick(); }} {...extra}>
      <span className="lbl">{armed ? 'Remove?' : label}</span>
      <span className="dot">{rating ? rating.toFixed(1) : <PIcon name={name} filled={on && (name === 'bookmark' || name === 'star')} />}</span>
      {short && <span className="tc-al">{short}</span>}
    </button>
  );
  return {
    host: { ref: art, className: `${cls} dialhost${open ? ' open' : ''}${dragging ? ' dragging' : ''}`, onMouseLeave: () => closed?.() },
    plan: (short?: string) => opt('bookmark', 'Plan to watch', !!t.watchlist, false, 0, () => void toggleWatchlist(), short),
    seen: t.type === 'movie' ? (short?: string) => opt('watched', 'Watched', !!t.watched, seen.armed, 0,
      () => (t.watched ? seen.tap(() => setWatched(false)) : void setWatched(true, 'unknown')), short) : null,
    rate: (short?: string) => opt('star', rateLabel, !!rv, rm.armed, rv, () => {}, short, ring.handlers),
    ringDial: ring.dial,
    dial: (
      <button type="button" className={`tdial${t.mine ? ' rated' : seenPart != null ? ' seen' : ''}${dismiss ? ' rm' : ''}${dis.armed ? ' confirm' : ''}`}
        style={{ '--fill': `${t.mine ? t.mine * 10 : (seenPart || 0) * 100}%` } as React.CSSProperties} title={tip || undefined}
        aria-label={dismiss ? `${says} · Not interested` : `${says} · Add to list`}
        onClick={(e) => {
          e.stopPropagation();
          if (matchMedia('(hover: none)').matches && !open) { takeOpen(() => setOpen(false)); setOpen(true); return; }
          if (dismiss) dis.tap(dismiss);
          else openAddTo({ key: t.key, title: t.title, from: e.currentTarget });
        }}>
        <span className="face">{t.mine ? t.mine.toFixed(1) : <PIcon name={icon!} filled={icon === 'bookmark'} />}</span>
        <span className="alt"><PIcon name={dismiss ? 'close' : 'list'} /></span>
        {dismiss && <span className="lbl" hidden>{dis.armed ? 'Not interested?' : ''}</span>}
      </button>
    ),
  };
}
