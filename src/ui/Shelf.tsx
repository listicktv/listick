'use client';
// A row or a list as a page of its own (a row's title or a list's card opens it): its titles as big posters, in the row's own
// order or by rating, year or name, narrowed to movies or shows when it mixes them (anime films with movies, as on Home) and to
// a genre (a dropdown) when the row knows its titles' genres. /row/<id> is a row of Movies, TV, Anime, a streaming service or For you
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PkBtn, TrendCard } from './Cards';
import { Drop } from './Drop';
import { getJ, postJ } from './lib/api';
import { HomeCtx, type HomeState } from './lib/home';
import { PATHS } from './lib/icons';
import { comingTag, type Tile } from './lib/media';
import { TitlePanel, type TitlePanelApi } from './Title';
import { titles } from './lib/format';

export type Item = Tile & { rating?: number | null; genres?: string[] };
type Sort = 'list' | 'rating' | 'newest' | 'az';
type Kind = 'all' | 'movie' | 'tv';
const ICON = { trend: 'M3 17l6-6 4 4 8-8M14 7h7v7', star: PATHS.star,
  cal: PATHS.cal, abc: 'M4 17l3-10 3 10M5 14h4M14 7h4a2.5 2.5 0 0 1 0 5h-4zM14 12h4.5a2.5 2.5 0 0 1 0 5H14z' };
const kindOf = (t: Tile): Kind => (t.type === 'movie' ? 'movie' : 'tv');

// the page's card clicks open the title panel, and a change on a card (rated, planned) loads the page again
export function ShelfWrap({ reload, children }: { reload: () => void; children: ReactNode }) {
  const panel = useRef<TitlePanelApi>(null);
  const home = useMemo<HomeState>(() => ({ reload: (ms = 0) => { setTimeout(reload, ms); }, openTitle: (r) => panel.current?.open(r) }), [reload]);
  return <HomeCtx.Provider value={home}>{children}<TitlePanel ref={panel} /></HomeCtx.Provider>;
}

// title: the page's name, on the line of the controls (a list of yours has its own header instead); the count a circle among
// them (a line under the name on a phone). first: the name of the row's own order (Popular, Added, Recent…); a link from Home's Plan to watch rows picks the
// kind (?kind=)
export function ShelfGrid({ title, items, first, genres = [], empty, dismiss }: { title?: string; items: Item[]; first: string; genres?: string[]; empty: ReactNode; dismiss?: (key: string) => void }) {
  const [sort, setSort] = useState<Sort>('list'), [genre, setGenre] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>(() => { const k = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('kind'); return k === 'movie' || k === 'tv' ? k : 'all'; });
  const mixed = items.some((t) => kindOf(t) === 'movie') && items.some((t) => kindOf(t) === 'tv');
  const shown = useMemo(() => {
    const l = items.filter((t) => (!mixed || kind === 'all' || kindOf(t) === kind) && (!genre || t.genres?.includes(genre)));
    if (sort === 'rating') l.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    if (sort === 'newest') l.sort((a, b) => (b.year || 0) - (a.year || 0));
    if (sort === 'az') l.sort((a, b) => a.title.localeCompare(b.title));
    return l;
  }, [items, mixed, kind, genre, sort]);
  return (
    <div className="gen-rows shelf-g">
      <div className="group-head pick-head shelf-head">{title ? <h1 className="st-title shelf-t">{title}</h1> : <span />}
        <div className="pick-tools">
        {/* the row's genres as one dropdown (they were a wall of chips) */}
        {genres.length > 1 && <div className="shelf-dd"><Drop bare label="Genre" search opts={[['', 'All genres'], ...genres.map((g): [string, string] => [g, g])]}
          value={genre || ''} set={(g) => setGenre(g || null)} /></div>}
        {mixed && <>
          <div className="pk-set shelf-kinds" role="group" aria-label="Kind">
            {([['all', 'All', PATHS.lists], ['movie', 'Movies', PATHS.movie], ['tv', 'Shows', PATHS.tv]] as const).map(([v, n, f]) =>
              <PkBtn key={v} label={n} data={{}} face={f} on={kind === v} pressed={kind === v} onClick={() => setKind(v)} />)}
          </div>
          <span className="pk-sep" /><span className="shelf-br" />
        </>}
        <div className="pk-set" role="group" aria-label="Order">
          {([['list', first, ICON.trend], ['rating', 'Rating', ICON.star], ['newest', 'Newest', ICON.cal], ['az', 'A–Z', ICON.abc]] as const).map(([v, n, f]) =>
            <PkBtn key={v} label={n} data={{}} face={f} on={sort === v} pressed={sort === v} onClick={() => setSort(v)} />)}
        </div>
        <span className="pk-sep" />
        <div className="pk shelf-n" role="status" aria-label={titles(shown.length)}><span className="pk-c"><b>{shown.length}</b></span><span className="pk-t">{shown.length === 1 ? 'Title' : 'Titles'}</span></div>
      </div></div>
      {shown.length ? <div className="l-grid shelf-grid ptrack">{shown.map((t) => <TrendCard key={t.key} t={t} dismiss={dismiss} />)}</div> : <p className="st-note">{empty}</p>}
    </div>
  );
}

type RowData = { title: string; items: Item[]; genres: string[] };
export function RowPage({ id }: { id: string }) {
  const [r, setR] = useState<RowData | null>(null), [err, setErr] = useState('');
  const [n, setN] = useState(0), reload = () => setN((x) => x + 1);
  useEffect(() => {
    let live = true;
    getJ<RowData>(`/api/row/${encodeURIComponent(id)}`).then((x) => {
      if (!live) return;
      // Coming soon puts its date on the poster and what's coming under it, as on Home; Suggested keeps its reason for screen readers
      const items = id === 'foryou-coming' ? x.items.map((t) => ({ ...t, note: t.what, tag: comingTag(t.date) }))
        : id === 'foryou-suggested' ? x.items.map((t) => ({ ...t, note: null, why: t.note, dismiss: true })) : x.items;
      setR({ ...x, items }); setErr('');
    }, (e: Error) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [id, n]);
  const dismiss = async (key: string) => {
    setR((x) => x && { ...x, items: x.items.filter((t) => t.key !== key) });
    const e = await postJ('/api/dismiss', { key });
    if (e) { alert(`Couldn't dismiss: ${e}`); reload(); }
  };
  if (err) return <p className="st-note">{`Couldn't load this row (${err}).`}</p>;
  if (!r) return null;
  return (
    <ShelfWrap reload={reload}>
      <div className="shelf">
        <ShelfGrid title={r.title} items={r.items} first={id === 'foryou-coming' ? 'Soonest' : id === 'foryou-suggested' ? 'For you' : 'Popular'} genres={r.genres}
          dismiss={id === 'foryou-suggested' ? (k) => void dismiss(k) : undefined} empty="Nothing in this row right now." />
      </div>
    </ShelfWrap>
  );
}
