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
import { Sheet } from './Sheet';

type Card = { id: string; name: string; description: string | null; kind: 'manual' | 'smart'; media: Media | null; filters: Filters | null;
  shared: boolean; owner: string | null; count: number; refreshedAt: number | null; posters: string[] };
type Built = { plan: { n: number; movie: number; tv: number; posters: string[] }; watched: { n: number; posters: string[] }; rated: { n: number; avg: number | null; posters: string[] } };
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
        {/* every list the same card (design A): four posters across its top, the name and a line; the built-in three first */}
        <div className="l-strips">
          <StripCard href="/lists/plan" name="Plan to watch" sub={`${b.plan.n} · ${b.plan.movie} movies · ${b.plan.tv} shows`} posters={b.plan.posters}
            mark={<Icon d={PATHS.bookmark} size={13} width={2} />} />
          <StripCard href="/lists/watched" name="Watched" sub={`${titles(b.watched.n)} · your History`} posters={b.watched.posters} mark={<Icon d={PATHS.watched} size={13} width={2.3} />} />
          <StripCard href="/lists/rated" name="Rated" sub={`${titles(b.rated.n)}${b.rated.avg ? ` · avg ${b.rated.avg}` : ''}`} posters={b.rated.posters}
            mark={<b className="l-rate">{b.rated.avg ?? '–'}</b>} />
          {page.lists.map((l) => <ListCard key={l.id} l={l} />)}
        </div>
        {([['FOLLOWING', page.following], ['SHARED ON THIS LISTICK', page.shared]] as [string, Card[]][]).map(([head, ls]) => ls.length > 0 && (
          <section key={head} className="l-sec">
            <div className="group-head"><h2 className="sh">{head}</h2></div>
            <div className="l-strips">{ls.map((l) => <ListCard key={l.id} l={l} />)}</div>
          </section>
        ))}

        <div className="gen-rows l-presets"><div className="group-head pick-head"><h2 className="sh">START A SMART LIST</h2><div className="pick-tools"><div className="pk-set">
          {PRESETS.filter(([, , d]) => !d.filters.tvdbGenre || tvdb).map(([n, f, d]) => <PkBtn key={n} label={n} data={{}} face={f} on={false} onClick={() => setDraft({ description: '', name: '', ...d })} />)}
        </div></div></div></div>
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

// a list asked for as a finger (or the pointer) comes down on its card, so it's often there by the time its page opens;
// kept a few seconds only, so a card pressed and left doesn't open stale later
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
function StripCard({ href, name, sub, posters, mark, shared }: {
  href: string; name: string; sub: string; posters: string[]; mark: ReactNode; shared?: boolean }) {
  const p = posters.slice(0, 4);
  return (
    <Link href={href} className="glass l-strip" onPointerDown={() => warmList(href.slice('/lists/'.length))}>
      <span className="l-sp">{[0, 1, 2, 3].map((i) => (p[i] ? <img key={i} src={p[i]} alt="" loading="lazy" /> : <span key={i} />))}
        <span className="l-pd"><span>{mark}</span></span></span>
      <span className="l-sb">
        <span className="l-st2">
          <span className="l-sn"><b>{name}</b></span>
          <span className="l-ss">{sub}</span>
        </span>
        {shared && <span className="l-st sh" title="Shared"><Icon d={ICON.share} size={13} width={2} /></span>}
      </span>
    </Link>
  );
}
function ListCard({ l }: { l: Card }) {
  const sub = [titles(l.count), l.owner ? `by ${l.owner}` : l.kind === 'smart' ? ago(l.refreshedAt) : null].filter(Boolean).join(' · ');
  return <StripCard href={`/lists/${l.id}`} name={l.name} sub={sub} posters={l.posters} mark={<Icon d={l.kind === 'smart' ? ICON.smart : PATHS.lists} size={13} width={2} />} shared={!l.owner && l.shared} />;
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
