'use client';
// A titled slide row: ‹ › by the row's title, shown only when the row holds more than fits; trackpad and swipe scroll too.
// A page row shows its first titles; the rest of the row (up to ~100, kept for the catalogs) comes in batches of the same size
// as you reach its end with › or by scrolling, fetched once from Listick when first needed.
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { getJ } from './lib/api';
import { Icon } from './lib/icons';
import type { Tile } from './lib/media';

// how many cards a slide row shows at once: posters 9 / 6 / 5 / 3, wide cards 5 / 4 / 3 / 2 (desktop / tablet / large phone or
// small tablet / phone, as in the CSS)
const inView = (wide: boolean) => { const w = innerWidth; return w >= 1181 ? (wide ? 5 : 9) : w >= 801 ? (wide ? 4 : 6) : w >= 600 ? (wide ? 3 : 5) : (wide ? 2 : 3); };
// a second's head start, so the visible posters get the bandwidth first, then when the browser is idle
const idle = (fn: () => void) => setTimeout(() => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1500 }) : fn()), 1000);

type More = { id: string; total: number; batch: number } | null;
// cls: the section's class (default group, or group trend-group); a null title leaves the head with the ‹ › alone; href: the
// grid circle beside the arrows opens the row as a page of its own (/row/<id>, a list)
type Props<T> = { id: string; title: ReactNode; href?: string; titleId?: string; note?: ReactNode; hidden?: boolean; trend?: boolean; cls?: string; railClass: string;
  items: T[]; keyOf: (x: T) => string; card: (x: T) => ReactNode; more?: More;
  // a row moved to other titles (a picker switch) goes back to its start
  start?: string; empty?: ReactNode };

export function Group<T>({ id, title, href, titleId, note, hidden, trend, cls, railClass, items, keyOf, card, more = null, start, empty }: Props<T>) {
  const r = useRef<HTMLDivElement>(null);
  // a row is "the same" while its titles are; a changed one starts over: the cards that fit now (only their images load), the
  // rest when the browser is idle, and batches fetched again
  const sig = JSON.stringify(items.map(keyOf));
  const [flushed, setFlushed] = useState('');
  const [extra, setExtra] = useState<{ sig: string; items: Tile[]; total: number | null }>({ sig: '', items: [], total: null });
  const all = useRef<{ sig: string; items: Tile[] } | null>(null), loading = useRef(false);
  const ext = extra.sig === sig ? extra : { sig, items: [], total: null };
  const wide = railClass.includes('wcards');
  const shown = flushed === sig ? items : items.slice(0, inView(wide));
  useEffect(() => {
    if (items.length <= inView(wide)) return;
    const t = idle(() => setFlushed(sig));
    return () => clearTimeout(t);
  }, [sig]);   // eslint-disable-line react-hooks/exhaustive-deps

  const count = items.length + ext.items.length, total = ext.total ?? more?.total ?? count;
  const moreLeft = !!more && count < total;
  const loadMore = async () => {
    setFlushed(sig);   // the row's own cards first, if they haven't come in yet
    if (!more || !moreLeft || loading.current) return;
    loading.current = true;
    try {
      if (all.current?.sig !== sig) all.current = { sig, items: (await getJ<{ items: Tile[] }>(`/api/row/${encodeURIComponent(more.id)}`)).items };
      const have = new Set([...items.map(keyOf), ...ext.items.map((t) => t.key)]);
      const next = all.current.items.filter((t) => !have.has(t.key)).slice(0, more.batch || 20);
      setExtra({ sig, items: [...ext.items, ...next], total: next.length ? ext.total : count });
    } catch { /* the next scroll tries again */ } finally { loading.current = false; }
  };

  // the ‹ › state: hidden unless the row overflows, each end disabled at its end (› stays on while there's more to fetch)
  const [nav, setNav] = useState('h');
  const upd = useCallback(() => {
    const x = r.current; if (!x) return;
    const h = !x.classList.contains('rail') || x.scrollWidth <= x.clientWidth + 4;
    const p = x.scrollLeft < 4, nx = x.scrollLeft + x.clientWidth >= x.scrollWidth - 4 && !moreLeft;
    setNav(`${h ? 'h' : ''}${p ? 'p' : ''}${nx ? 'n' : ''}`);
  }, [moreLeft]);
  useEffect(() => { const f = requestAnimationFrame(upd); return () => cancelAnimationFrame(f); });
  useEffect(() => { window.addEventListener('resize', upd); return () => window.removeEventListener('resize', upd); }, [upd]);
  useEffect(() => { if (r.current) r.current.scrollLeft = 0; }, [start]);

  // at most once a frame (a swipe fires scroll far more often; reading the row's size each time made iPhones stutter): the ‹ ›
  // state, and within a screen of the end the next batch (only rows that have more)
  const tick = useRef(0);
  const onScroll = () => {
    if (tick.current) return;
    tick.current = requestAnimationFrame(() => {
      tick.current = 0; upd();
      const x = r.current;
      if (x && moreLeft && x.scrollLeft + 2 * x.clientWidth >= x.scrollWidth) void loadMore();
    });
  };
  // a trackpad or mouse moves a row half as far as the browser would (at full speed it raced past the cards); snapping is off while it
  // scrolls (.wheeling) and snaps the row to a card edge 150 ms after the last step. Up/down scrolling stays the page's
  useEffect(() => {
    const x = r.current; if (!x) return;
    let wait: ReturnType<typeof setTimeout> | undefined, dir = 0;
    const wheel = (e: WheelEvent) => {
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      if (!dx || (!e.shiftKey && Math.abs(dx) < Math.abs(e.deltaY))) return;
      e.preventDefault();
      x.classList.add('wheeling'); dir = Math.sign(dx);
      x.scrollLeft += dx * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? x.clientWidth : 1) * 0.5;
      clearTimeout(wait);
      wait = setTimeout(() => {
        // turning snapping back on doesn't move the row, so it glides to a card edge itself: the nearest one, leaning a third
        // of a card the way it was scrolled, so a short swipe still moves on instead of springing back
        const kids = [...x.children] as HTMLElement[];
        const x0 = kids[0]?.offsetLeft || 0, step = kids[1] ? kids[1].offsetLeft - x0 : 0;
        const aim = x.scrollLeft + dir * step / 3;
        const to = kids.map((c) => c.offsetLeft - x0).reduce((a, b) => (Math.abs(b - aim) < Math.abs(a - aim) ? b : a), 0);
        x.classList.remove('wheeling'); x.scrollTo({ left: to, behavior: 'smooth' });
      }, 150);
    };
    x.addEventListener('wheel', wheel, { passive: false });
    return () => { x.removeEventListener('wheel', wheel); clearTimeout(wait); };
  }, []);

  const go = async (d: number) => {
    const x = r.current; if (!x) return;
    if (d > 0 && x.scrollLeft + x.clientWidth >= x.scrollWidth - 4) await loadMore();
    x.scrollBy({ left: d * (x.clientWidth + (parseFloat(getComputedStyle(x).columnGap) || 0)), behavior: 'smooth' });
  };
  return (
    <section className={cls || (trend ? 'group trend-group' : 'group')} id={cls ? undefined : `${id}-group`} hidden={hidden}>
      <div className="group-head">
        {title === null ? <span /> : <h2 className="sh" id={titleId}>{title}</h2>}{note}
        <div className="rail-nav" hidden={!href && nav.includes('h')}>
          {href && <Link href={href} className="rbtn" aria-label="See all"><Icon d="M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z" size={15} /></Link>}
          {href && !nav.includes('h') && <span className="rsep" aria-hidden="true" />}
          {!nav.includes('h') && <>
            <button type="button" className="rbtn" aria-label="Previous" disabled={nav.includes('p')} onClick={() => void go(-1)}><Icon d="M15 6l-6 6 6 6" size={16} width={2.2} /></button>
            <button type="button" className="rbtn" aria-label="Next" disabled={nav.includes('n')} onClick={() => void go(1)}><Icon d="M9 6l6 6-6 6" size={16} width={2.2} /></button>
          </>}
        </div>
      </div>
      <div ref={r} className={railClass} id={id} onScroll={onScroll}>
        {empty ?? uniqueKeys([...shown, ...(ext.items as T[])], keyOf).map(({ x, k }) => <Fragment key={k}>{card(x)}</Fragment>)}
      </div>
    </section>
  );
}
// cards with the same key (a title twice in a list) get a running number, so each keeps its own state
function uniqueKeys<T>(list: T[], key: (x: T) => string) {
  const seen = new Map<string, number>();
  return list.map((x) => { const k = key(x), n = seen.get(k) || 0; seen.set(k, n + 1); return { x, k: n ? `${k}#${n}` : k }; });
}
