'use client';
// The Lists page (/lists): Plan to watch, Watched and Rated, then your lists, each a card opening its own
// page (/lists/<id>: its header, actions and titles, see ListPage); then presets to start a smart list. New list and Edit open a
// sheet for a manual list's name; Smart list, a preset or a smart list's Edit open the builder over the page: its option groups
// on the left, the open group's settings in the middle, a live preview on the right.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { PkBtn } from './Cards';
import { getJ, postJ } from './lib/api';
import { say, titles } from './lib/format';
import { Icon, PATHS } from './lib/icons';
import { listsBus, listsChanged } from './lib/lists';
import { Builder, Chips, ICON, KIND, label, Sw, TVDB_CATS, type Draft, type Filters, type Media } from './ListBuilder';
import { ShelfGrid, ShelfWrap, type Item } from './Shelf';
import { Group } from './Rail';
import { Sheet } from './Sheet';

type Card = { id: string; name: string; description: string | null; kind: 'manual' | 'smart'; media: Media | null; filters: Filters | null;
  shared: boolean; owner: string | null; count: number; refreshedAt: number | null; posters: string[]; backdrop: string | null; changedAt: number; onHome: boolean };
type Built = { plan: { n: number; movie: number; tv: number; posters: string[]; backdrop: string | null }; watched: { n: number; plays: number; posters: string[]; backdrop: string | null };
  rated: { n: number; avg: number | null; posters: string[]; backdrop: string | null } };
type Page = { lists: Card[]; following: Card[]; shared: Card[]; builtin: Built; genres: Record<Media, string[]> };
type Open = Omit<Card, 'kind'> & { kind: Card['kind'] | 'builtin'; items: Item[]; mine?: boolean; following?: boolean };
type Naming = { id?: string; name: string; description: string; row?: boolean; from: HTMLElement | null };

// each kind's colour in the app (anime movies are anime, movies and shows together are movies)
const TINT: Record<Media, string> = { movie: 'movie', tv: 'tv', anime: 'anime', animefilm: 'anime', both: 'movie' };
const ago = (t: number | null) => { if (!t) return 'not fetched yet'; const m = Math.round((Date.now() - t) / 60000);
  return m < 60 ? `refreshed ${Math.max(1, m)} min ago` : m < 48 * 60 ? `refreshed ${Math.round(m / 60)} h ago` : `refreshed ${Math.round(m / 1440)} days ago`; };
const year = new Date().getFullYear();
// the presets: a smart list's first settings
const PRESETS: [string, string, Partial<Draft> & { media: Media; filters: Filters }][] = [
  // all time's best: by score, with votes enough that a few 10s can't top it (fewer people rate shows and anime on TMDB)
  ['Top 250 movies', PATHS.star, { name: 'Top 250 movies', media: 'movie', filters: { sort: 'rating', votes: 5000, max: 250, refresh: 'weekly' } }],
  ['Latest releases', 'M4 6h16v10H4zM8 20h8M12 16v4', { name: 'Latest releases', media: 'movie', filters: { home: ['digital', 'uhd', 'bluray'], homeCinema: true, max: 60, refresh: 'daily' } }],
  ['Top 250 shows', PATHS.tv, { name: 'Top 250 shows', media: 'tv', filters: { sort: 'rating', votes: 1000, max: 250, refresh: 'weekly' } }],
  ['Top 250 anime', PATHS.anime, { name: 'Top 250 anime', media: 'anime', filters: { sort: 'rating', votes: 300, max: 250, refresh: 'weekly' } }],
  ['Horror', 'M6 20V10a6 6 0 0 1 12 0v10l-2-2-2 2-2-2-2 2-2-2zM10 11h.01M14 11h.01', { name: 'Horror', media: 'movie', filters: { genres: ['Horror'], scoreFrom: 6, votes: 100 } }],
  ['Sci-fi', 'M12 2c3 2 5 6 5 10l-2 4H9l-2-4c0-4 2-8 5-10zM9 16l-2 4M15 16l2 4M12 9h.01', { name: 'Sci-fi', media: 'movie', filters: { genres: ['Sci-Fi'], scoreFrom: 6.5, votes: 200 } }],
  ['New movies', 'M3 8a2 2 0 0 0 0 4v4h18v-4a2 2 0 0 1 0-4V4H3zM13 4v16', { name: 'New movies', media: 'movie', filters: { yearFrom: year, released: 'out', votes: 20 } }],
  ['Anime this year', PATHS.anime, { name: 'Anime this year', media: 'anime', filters: { yearFrom: year, votes: 10 } }],
  ['Binge-worthy TV', 'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-6 1 1 2 2 3 2 0-2-1-4 0-6z', { name: 'Binge-worthy TV', media: 'tv', filters: { scoreFrom: 8, votes: 1000 } }],
  ['Korean TV', PATHS.heart, { name: 'Korean TV', media: 'tv', filters: { language: 'ko', votes: 50 } }],
  ['Coming soon', PATHS.cal, { name: 'Coming soon', media: 'movie', filters: { released: 'coming' } }],
  ['Food shows', 'M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-2 6 0 8v10', { name: 'Food shows', media: 'tv', filters: { tvdbGenre: 9 } }],
  ['Travel shows', 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18', { name: 'Travel shows', media: 'tv', filters: { tvdbGenre: 25 } }],
  ['Game shows', 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 21h6M10 17h4', { name: 'Game shows', media: 'tv', filters: { tvdbGenre: 8 } }],
  ['Home makeover', 'M4 11l8-7 8 7M6 10v10h12V10M10 20v-5h4v5', { name: 'Home makeover', media: 'tv', filters: { tvdbGenre: 7 } }],
];

export function Lists() {
  const router = useRouter();
  const [page, setPage] = useState<Page | null>(null), [err, setErr] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null), [naming, setNaming] = useState<Naming | null>(null);
  const [tvdb, setTvdb] = useState(false);
  // list order
  const [sort, setSortNow] = useState<'recent' | 'az' | 'most'>(() => { try { const v = localStorage.getItem('lists-sort'); return v === 'az' || v === 'most' ? v : 'recent'; } catch { return 'recent'; } });
  const setSort = (v: 'recent' | 'az' | 'most') => { setSortNow(v); try { localStorage.setItem('lists-sort', v); } catch { /* private window */ } };
  const sorted = (ls: Card[]) => [...ls].sort((a, c) => (sort === 'az' ? a.name.localeCompare(c.name) : sort === 'most' ? c.count - a.count : c.changedAt - a.changedAt));
  useEffect(() => { let live = true; getJ<{ sources: { tvdb?: boolean } }>('/api/config').then((c) => { if (live) setTvdb(!!c.sources.tvdb); }, () => {}); return () => { live = false; }; }, []);
  const load = useCallback(() => getJ<Page>('/api/lists').then((p) => { setPage(p); setErr(''); }, (e: Error) => setErr(e.message)), []);
  useEffect(() => { let live = true; getJ<Page>('/api/lists').then((p) => { if (live) setPage(p); }, (e: Error) => { if (live) setErr(e.message); }); return () => { live = false; }; }, []);
  // a change from Add to list (anywhere) shows here
  useEffect(() => { const on = () => void load(); listsBus.addEventListener('changed', on); return () => listsBus.removeEventListener('changed', on); }, [load]);

  if (err) return <p className="st-note">{`Couldn't load your lists (${err}).`}</p>;
  if (!page) return null;
  const b = page.builtin;
  return (
    <>
      <div className="lists">
        <div className="l-head"><h1 className="st-title">Lists</h1>
          <div className="pk-set l-acts">
            <PkBtn label="New list" data={{}} face={PATHS.lists} on={false} onClick={() => setNaming({ name: '', description: '', from: null })} />
            <PkBtn label="Smart list" data={{}} face={ICON.smart} on onClick={() => setDraft({ name: '', description: '', media: 'movie', filters: {} })} />
          </div>
        </div>
        {/* built-in lists */}
        <div className="l-band">
          <MineCard href="/lists/plan" name="Plan to watch" b={b.plan} ring={`conic-gradient(var(--st-movie) 0 ${b.plan.n ? (b.plan.movie / b.plan.n) * 100 : 0}%, var(--st-tv) 0 100%)`}
            face={<Icon d={PATHS.bookmark} size={30} width={1.9} />}
            sub={<><span><b>{b.plan.n}</b> {b.plan.n === 1 ? 'title' : 'titles'}</span><span className="l-dot" style={{ '--c': 'var(--st-movie)' } as React.CSSProperties}>{b.plan.movie} films</span><span className="l-dot" style={{ '--c': 'var(--st-tv)' } as React.CSSProperties}>{b.plan.tv} shows</span></>} />
          <MineCard href="/history?all=1" name="Watched" b={b.watched} ring="conic-gradient(var(--accent) 0 100%)" face={<Icon d={PATHS.watched} size={30} width={2.1} />}
            sub={<><span><b>{b.watched.n}</b> {b.watched.n === 1 ? 'title' : 'titles'}</span>{!!b.watched.plays && <span>{b.watched.plays} plays this month</span>}</>} />
          <MineCard href="/lists/rated" name="Rated" b={b.rated} ring={`conic-gradient(var(--accent) 0 ${(b.rated.avg || 0) * 10}%, var(--l-ring) 0)`} face={<b className="mono">{b.rated.avg ?? '–'}</b>}
            sub={<><span><b>{b.rated.n}</b> {b.rated.n === 1 ? 'title' : 'titles'}</span>{b.rated.avg != null && <span>average {b.rated.avg}</span>}</>} />
        </div>

        <section className="l-sec">
          <div className="l-sh"><h2 className="l-shn">Your lists<span className="mono">{page.lists.length}</span></h2>
            {page.lists.length > 1 && <div className="l-sorts" role="group" aria-label="Order">
              {([['recent', 'Recently changed'], ['az', 'A–Z'], ['most', 'Most titles']] as const).map(([v, n]) =>
                <button key={v} type="button" className={sort === v ? 'on' : ''} aria-pressed={sort === v} onClick={() => setSort(v)}>{n}</button>)}
            </div>}
          </div>
          <div className="l-cards">
            {sorted(page.lists).map((l) => <ListCard key={l.id} l={l} />)}
            <button type="button" className="l-new" onClick={() => setNaming({ name: '', description: '', from: null })}><span><span className="c"><Icon d={PATHS.plus} size={20} width={1.9} /></span>New list</span></button>
          </div>
        </section>
        {([['Following', page.following], ['Shared on this Listick', page.shared]] as [string, Card[]][]).map(([head, ls]) => ls.length > 0 && (
          <section key={head} className="l-sec">
            <div className="l-sh"><h2 className="l-shn">{head}<span className="mono">{ls.length}</span></h2></div>
            <div className="l-cards">{ls.map((l) => <ListCard key={l.id} l={l} />)}</div>
          </section>
        ))}

        <section className="l-sec">
          <Group id="l-presets" title="Start a smart list" cls="group l-pgroup" railClass="rail l-presets" items={PRESETS.filter(([, , d]) => !d.filters.tvdbGenre || tvdb)} keyOf={([n]) => n}
            card={([n, f, d]) => <button type="button" className="l-preset" onClick={() => setDraft({ description: '', name: '', ...d })}><span className="c"><Icon d={f} size={20} width={1.9} /></span>{n}</button>} />
        </section>
      </div>
      <Sheet id="lname" title="NEW EMPTY LIST" open={!!naming} from={naming?.from ?? null} onClose={() => setNaming(null)}>
        {naming && <NameForm v={naming} done={async (id) => { setNaming(null); if (id) router.push(`/lists/${id}`); }} />}
      </Sheet>
      {draft && <Builder draft={draft} page={page} close={() => setDraft(null)} saved={async (id) => { setDraft(null); router.push(`/lists/${id}`); }} />}
    </>
  );
}

// one list as its own page (/lists/<id>): a list of yours with its header and actions, or Plan to watch, Watched or Rated
const FIRST: Record<string, string> = { plan: 'Added', watched: 'Recent', rated: 'Yours' };
export function ListPage({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<Open | null>(null), [err, setErr] = useState(''), [meta, setMeta] = useState<Page | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null), [naming, setNaming] = useState<Naming | null>(null), [armed, setArmed] = useState(false);
  const load = useCallback(() => getJ<Open>(`/api/lists/${id}`).then((o) => { setOpen(o); setErr(''); }, (e: Error) => setErr(e.message)), [id]);
  useEffect(() => { let live = true; openOf(id).then((o) => { if (live) setOpen(o); }, (e: Error) => { if (live) setErr(e.message); }); return () => { live = false; }; }, [id]);
  useEffect(() => { const on = () => void load(); listsBus.addEventListener('changed', on); return () => listsBus.removeEventListener('changed', on); }, [load]);
  const reload = useCallback(() => void load(), [load]);
  const act = async (path: string, b: object = {}) => { const e = await postJ(path, b); if (e) alert(say(e)); else await load(); return !e; };
  const edit = async (o: Open) => {
    if (o.kind !== 'smart') return setNaming({ id: o.id, name: o.name, description: o.description || '', row: !!o.filters?.row, from: null });
    const m = meta || await getJ<Page>('/api/lists'); setMeta(m);
    setDraft({ id: o.id, name: o.name, description: o.description || '', media: o.media!, filters: o.filters || {}, shared: o.shared });
  };

  if (err) return <p className="st-note">{`Couldn't load this list (${err}).`}</p>;
  if (!open) return null;
  const builtin = open.kind === 'builtin';
  return (
    <ShelfWrap reload={reload}>
      <div className="shelf">
        {builtin ? null : (
          <section className="l-lh">
            <div className="l-lhb">
              <div className="l-lname"><h1 className="st-title l-lht">{open.name}</h1>
                {/* on a phone its actions are one menu by the name (the circles on wider screens): yours (Edit, Refresh, On Home, Shared,
                    Delete), or someone else's (Follow, Copy) */}
                <ListMenu items={!open.mine ? [
                  { label: open.following ? 'Following' : 'Follow', icon: open.following ? PATHS.tick : PATHS.plus, on: !!open.following,
                    run: () => void act(`/api/lists/${open.id}/follow`, { on: !open.following }).then(() => listsChanged()) },
                  { label: 'Copy', icon: PATHS.copy, run: () => { const got: { id?: string } = {};
                    void postJ(`/api/lists/${open.id}/copy`, {}, got).then((e) => (e ? alert(say(e)) : router.push(`/lists/${got.id}`))); } },
                ] : [
                  { label: 'Edit', icon: PATHS.pen, run: () => void edit(open) },
                  ...(open.kind === 'smart' ? [{ label: 'Refresh', icon: ICON.refresh, run: () => void act(`/api/lists/${open.id}/refresh`) }] : []),
                  { label: 'On Home', icon: PATHS.home, on: !!open.filters?.row, run: () => void act(`/api/lists/${open.id}/edit`, { row: !open.filters?.row }).then(() => listsChanged()) },
                  { label: 'Shared', icon: ICON.share, on: open.shared, run: () => void act(`/api/lists/${open.id}/edit`, { shared: !open.shared }) },
                  { label: 'Delete', icon: PATHS.trash, rm: true, run: () => void postJ(`/api/lists/${open.id}/delete`).then((e) => (e ? alert(say(e)) : router.push('/lists'))) },
                ]} /></div>
              <div className="l-cm"><Badge l={open} /><span>{titles(open.count)}</span>{open.kind === 'smart' && <span>· {ago(open.refreshedAt)}</span>}{!open.mine && open.owner && <span>· by {open.owner}</span>}</div>
              {open.description && <p className="l-desc">{open.description}</p>}
              {open.media === 'tv' && open.filters?.tvdbGenre && <p className="l-desc">{`${label(TVDB_CATS, open.filters.tvdbGenre)} shows from `}<a href="https://thetvdb.com" target="_blank" rel="noopener noreferrer">TheTVDB.com</a></p>}
              {open.kind === 'smart' && open.filters && <Chips media={open.media!} f={open.filters} />}
            </div>
            {/* someone else's shared list: follow it onto your Lists page, or copy it to make it yours */}
            {!open.mine ? <div className="pk-set l-hacts">
              <PkBtn label={open.following ? 'Following' : 'Follow'} data={{}} face={open.following ? PATHS.tick : PATHS.plus} on={!!open.following} pressed={!!open.following}
                onClick={() => void act(`/api/lists/${open.id}/follow`, { on: !open.following }).then(() => listsChanged())} />
              <PkBtn label="Copy" data={{}} face={PATHS.copy} on={false} onClick={() => { const got: { id?: string } = {};
                void postJ(`/api/lists/${open.id}/copy`, {}, got).then((e) => (e ? alert(say(e)) : router.push(`/lists/${got.id}`))); }} />
            </div> : <div className="pk-set l-hacts">
              <PkBtn label="Edit" data={{}} face={PATHS.pen} on={false} onClick={() => void edit(open)} />
              {open.kind === 'smart' && <PkBtn label="Refresh" data={{}} face={ICON.refresh} on={false} onClick={() => void act(`/api/lists/${open.id}/refresh`)} />}
              <PkBtn label="On Home" data={{}} face={PATHS.home} on={!!open.filters?.row} pressed={!!open.filters?.row}
                onClick={() => void act(`/api/lists/${open.id}/edit`, { row: !open.filters?.row }).then(() => listsChanged())} />
              <PkBtn label={armed ? 'Delete?' : 'Delete'} data={{}} face={PATHS.trash} on={armed} none onClick={() => {
                if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3000); return; }
                void postJ(`/api/lists/${open.id}/delete`).then((e) => (e ? alert(say(e)) : router.push('/lists')));
              }} />
              <PkBtn label="Shared" data={{}} face={ICON.share} on={open.shared} pressed={open.shared} onClick={() => void act(`/api/lists/${open.id}/edit`, { shared: !open.shared })} />
            </div>}
          </section>
        )}
        <ShelfGrid title={builtin ? open.name : undefined} items={open.items} first={FIRST[open.id] || (open.kind === 'smart' ? 'Popular' : 'Added')}
          empty={open.kind === 'smart' ? 'Nothing matches these filters: try a wider year, score or genre.' : 'Add titles from any poster’s circle, here or on any page.'} />
      </div>
      <Sheet id="lname" title="EDIT LIST" open={!!naming} from={naming?.from ?? null} onClose={() => setNaming(null)}>
        {naming && <NameForm v={naming} done={async () => { setNaming(null); await load(); listsChanged(); }} />}
      </Sheet>
      {draft && meta && <Builder draft={draft} page={meta} close={() => setDraft(null)} saved={async () => { setDraft(null); await load(); }} />}
    </ShelfWrap>
  );
}

// a list asked for as a finger (or the pointer) comes down on its card;
// kept a few seconds only
const warm = new Map<string, { at: number; p: Promise<Open> }>();
const warmList = (id: string) => {
  if (Date.now() - (warm.get(id)?.at ?? 0) < 5000) return;
  const p = getJ<Open>(`/api/lists/${id}`); p.catch(() => {}); warm.set(id, { at: Date.now(), p });
};
const openOf = (id: string) => { const w = warm.get(id); warm.delete(id); return w && Date.now() - w.at < 5000 ? w.p : getJ<Open>(`/api/lists/${id}`); };
// a list as its card: four posters across its top, its mark in their corner as a poster's circle (a built-in list's own,
// else smart or plain as the New list / Smart list buttons); under them the name, one line (how many, when it was made again,
// whose it is) and the Shared ring
// a list's actions as a menu under a chevron by its name, in the dropdowns' style: each an icon and a word, a switched-on one
// ticked in the accent; a removing one (Delete) red and asking once more before it acts
type MenuItem = { label: string; icon: string; on?: boolean; rm?: boolean; run: () => void };
function ListMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false), [ask, setAsk] = useState(false), box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc, true); setAsk(false); };
  }, [open]);
  return (
    <div className="dd bare l-menu" ref={box}>
      <button type="button" className={`dd-f${open ? ' open' : ''}`} aria-haspopup="menu" aria-expanded={open} aria-label="List actions" onClick={() => setOpen(!open)}>
        <Icon d="M6 9l6 6 6-6" size={20} width={2} />
      </button>
      {open && (
        <div className="dd-m" role="menu">
          {items.map((x) => (
            <button key={x.label} type="button" role="menuitem" className={`${x.on ? 'on' : ''}${x.rm ? ' rm' : ''}${x.rm && ask ? ' ask' : ''}`}
              onClick={() => { if (x.rm && !ask) { setAsk(true); return; } setOpen(false); x.run(); }}>
              <span className="dd-ck"><Icon d={x.icon} size={16} width={2} /></span>{x.rm && ask ? `${x.label}? Tap again` : x.label}
              {x.on && <Icon className="l-mon" d={PATHS.tick} size={15} width={2.2} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
// built-in list card
function MineCard({ href, name, b, ring, face, sub }: { href: string; name: string; b: { posters: string[]; backdrop: string | null }; ring: string; face: ReactNode; sub: ReactNode }) {
  return (
    <Link href={href} className="l-mine" onPointerDown={() => { if (href.startsWith('/lists/')) warmList(href.slice('/lists/'.length)); }}>
      {(b.backdrop || b.posters[0]) && <img className="l-bd" src={b.backdrop || b.posters[0]} alt="" loading="lazy" />}
      <span className="l-ring" style={{ '--g': ring } as React.CSSProperties}>{face}</span>
      <span className="l-tx"><b className="l-mn">{name}</b><span className="l-msub">{sub}</span></span>
      <span className="l-mp">{b.posters.slice(0, 3).map((p, i) => <img key={i} src={p} alt="" loading="lazy" />)}</span>
    </Link>
  );
}
const WHEN = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${Math.max(1, m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
// list card
function ListCard({ l }: { l: Card }) {
  const sub = [titles(l.count), l.owner ? `by ${l.owner}` : `${l.kind === 'smart' ? 'refreshed' : 'changed'} ${WHEN(l.changedAt)}`].join(' · ');
  return (
    <Link href={`/lists/${l.id}`} className="l-card" onPointerDown={() => warmList(l.id)}>
      <span className="l-cover">
        {(l.backdrop || l.posters[0]) && <img className="l-bd" src={l.backdrop || l.posters[0]} alt="" loading="lazy" />}
        <span className="l-mini">{l.posters.slice(0, 3).map((p, i) => <img key={i} src={p} alt="" loading="lazy" />)}</span>
        <span className="l-cn"><b>{l.name}</b><span>{sub}</span></span>
      </span>
      <span className="l-facts">
        <span className="l-fact" style={l.media ? ({ '--k': `var(--st-${TINT[l.media]})` } as React.CSSProperties) : undefined}>
          <span className="c"><Icon d={l.kind === 'smart' ? ICON.smart : PATHS.lists} size={13} width={2} /></span><span>{l.kind === 'smart' ? 'Smart' : 'Manual'}{l.media && <i>{` · ${KIND[l.media][0]}`}</i>}</span>
        </span>
        {l.onHome && <span className="l-fact on"><span className="c"><Icon d={PATHS.home} size={13} width={2} /></span>On Home</span>}
        {!l.owner && l.shared && <span className="l-fact"><span className="c"><Icon d={ICON.share} size={13} width={2} /></span>Shared</span>}
      </span>
    </Link>
  );
}
const Badge = ({ l }: { l: Pick<Card, 'media'> & { kind: Open['kind'] } }) => (<>
  <span className={`l-badge${l.kind === 'smart' ? ' smart' : ''}`}>{l.kind === 'smart' ? 'SMART' : 'MANUAL'}</span>
  {l.media && <i className="l-kdot" style={{ background: `var(--st-${TINT[l.media]})` }} title={KIND[l.media][0]} />}
</>);
function NameForm({ v, done }: { v: { id?: string; name: string; description: string; row?: boolean }; done: (id?: string) => Promise<void> }) {
  const [name, setName] = useState(v.name), [desc, setDesc] = useState(v.description), [row, setRow] = useState(!!v.row), [e, setE] = useState('');
  return (
    <form className="l-nameform" onSubmit={async (ev) => {
      ev.preventDefault();
      const got: { id?: string } = {}, err = v.id ? await postJ(`/api/lists/${v.id}/edit`, { name, description: desc, row }) : await postJ('/api/lists/new', { name, description: desc, kind: 'manual', row }, got);
      if (err) setE(say(err) || ''); else await done(got.id);
    }}>
      <div className="look-row"><span className="look-k">Name</span><input className="field" autoFocus maxLength={60} value={name} onChange={(x) => setName(x.target.value)} aria-label="Name" /></div>
      <div className="look-row"><span className="look-k">About</span><input className="field" maxLength={200} value={desc} onChange={(x) => setDesc(x.target.value)} aria-label="About" placeholder="optional" /></div>
      {/* a row on Home, above For you */}
      <div className="look-row"><span className="look-k">Show on Home</span><Sw on={row} set={setRow} label="Show on Home" /></div>
      <p className="acct-err">{e}</p>
      <div className="l-formacts"><button type="submit" className="abtn primary" disabled={!name.trim()}>{v.id ? 'Save' : 'Make list'}</button></div>
    </form>
  );
}
