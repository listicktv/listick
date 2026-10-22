'use client';
// The title card's Episodes: the season line (season menu, rating, tick, the row's circles), Next up, the season's episodes as a
// row or all of them as cards, and an episode's page. Also the date wheels (Pick date) and the rating circles the card uses.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PIcon, useRingRate, useTwoTap } from './Cards';
import { getJ, postJ } from './lib/api';
import { usePhone } from './lib/home';
import { Icon } from './lib/icons';
import { useTitle, type Episode, type PickArgs, type Play, type Title } from './lib/title';

export const fmtDay = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null);
const today = () => new Date().toISOString().slice(0, 10);
// an episode's air day, at 21:00 (no later than now): when a manual mark on its air date counts
export const airAt = (e: { air: string | null }) => (e.air ? Math.min(Date.now(), new Date(`${e.air}T21:00:00`).getTime()) : null);
// a play a source tracked (Stremio, Jellyfin, imports) has a real time; one marked here has only its day
export const timed = (w: Play | null | undefined) => !!w && !w.approx && w.source !== 'manual';
// an episode's air day in few words: near today as words ("Yesterday", "3 days ago", "In 5 days"), this year as "12 Sep",
// another year "12 Sep 2022"; months short, without the en-GB "Sept"
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function epDay(iso: string | null) {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number), now = new Date();
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (days === 0) return 'Today';
  if (days === -1) return 'Yesterday';
  if (days === 1) return 'Tomorrow';
  if (days < 0 && days >= -6) return `${-days} days ago`;
  if (days > 0 && days <= 14) return `In ${days} days`;
  return `${d} ${MON[m - 1]}${y === now.getFullYear() ? '' : ` ${y}`}`;
}
const airs = (iso: string | null) => `Airs ${(epDay(iso) || '').replace(/^(In|Today|Tomorrow)/, (x) => x.toLowerCase())}`;
const CLOCK = 'M12 4.5a7.5 7.5 0 1 0 0 15a7.5 7.5 0 1 0 0-15zM12 8v4.2l2.6 1.6';

// the poster's circle (glass ring, navy face, an icon) for the card's own controls: the menu, Mark season, each episode
export const Circ = ({ fill, children }: { fill?: number; children: ReactNode }) => (
  <span className="tc-circ" style={fill != null ? ({ '--fill': `${fill}%` } as CSSProperties) : undefined}><span>{children}</span></span>
);

// a season's or an episode's rating circle, rated by dragging round it; a tap on a rated one turns it red with a ✕ and a second
// tap removes the rating. The card is redrawn once a change is saved
function RateCircle({ cls, state, v, current, label, save }: { cls: string; state: string; v: number; current: number; label: string; save: (n: number | null) => Promise<boolean> }) {
  const { reloadTitle } = useTitle();
  const [view, setView] = useState<number | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const ask = useTwoTap();
  const ring = useRingRate({ cur: () => current, show: setView, reset: () => setView(undefined), dragging: setDragging, confirm: ask.tap,
    save: async (n) => { if (await save(n)) await reloadTitle(); } });
  const x = view ?? v, shown = view !== undefined;
  return (
    <>
      <button type="button" className={`${cls}${shown ? (x ? ' on' : '') : state}${ask.armed ? ' confirm' : ''}${dragging ? ' dragging' : ''}`}
        aria-label={shown ? (x ? `Your rating ${x.toFixed(1)}` : current ? 'Release to remove' : 'Drag to rate') : label} {...ring.handlers}>
        <Circ fill={x * 10}>{ask.armed ? <PIcon name="close" /> : x ? <span>{x.toFixed(1)}</span> : <span className="star">★</span>}</Circ>
      </button>
      {ring.dial}
    </>
  );
}

async function rateIt(d: Title, n: number | null, season?: number, episode?: number) {
  const err = await postJ(`/api/rate/${encodeURIComponent(d.key)}`, { rating: n, season, episode });
  if (err) { alert(`Couldn't save: ${err}`); return false; }
  return true;
}

type St = { season: number | null; allEps: boolean; home: number };
export function EpisodesPane({ d, st, set, cls }: { d: Title; st: St; set: (s: Partial<St>) => void; cls: string }) {
  const { reloadTitle, pickDay, backRef } = useTitle();
  const seasons = d.seasons!, by = d.you?.bySeason || {};
  // start where you are: the latest season you have watched in, else the first
  const watchedIn = seasons.filter((s) => s.n > 0 && by[s.n]).map((s) => s.n);
  const season = st.season != null && seasons.some((s) => s.n === st.season) ? st.season
    : watchedIn.length ? Math.max(...watchedIn) : (seasons.find((s) => s.n > 0) || seasons[0]).n;
  const cur = seasons.find((x) => x.n === season)!;
  const seasonName = (x: typeof cur) => (x.n ? `Season ${x.n}` : 'Specials'), done = (x: typeof cur) => by[x.n] || 0;

  const [res, setRes] = useState<{ d: Title; season: number; list?: Episode[]; err?: string } | null>(null);
  useEffect(() => {
    let live = true;
    getJ<{ episodes: Episode[] }>(`/api/title/${encodeURIComponent(d.key)}/season/${season}`)
      .then((r) => live && setRes({ d, season, list: r.episodes }), (e: Error) => live && setRes({ d, season, err: e.message }));
    return () => { live = false; };
  }, [d, season]);
  const got = res && res.d === d && res.season === season ? res : null, episodes = got?.list;
  // an episode's page, open over the list (only within its season); Back and Escape leave it first
  const [opened, setOpened] = useState<{ season: number; ep: number; home: number } | null>(null);
  const viewing = opened?.season === season && opened.home === st.home && episodes?.some((e) => e.ep === opened.ep) ? opened.ep : null;
  const shown = cls.includes(' on');
  useEffect(() => {
    if (!shown) return;
    if (viewing != null) backRef.current = () => { setOpened(null); return true; };
    else if (st.allEps) backRef.current = () => { set({ allEps: false }); return true; };
    else return;
    return () => { backRef.current = null; };
  }, [shown, viewing, st.allEps, backRef, set]);
  const [dir, setDir] = useState('');
  const openEp = (ep: number | null) => {
    setDir(ep != null && viewing != null && ep !== viewing ? (ep > viewing ? 'R' : 'L') : '');
    setOpened(ep == null ? null : { season, ep, home: st.home });
  };

  // at: when you watched them; times: each one's own (their air dates); unknown: the date isn't known (at only stands in)
  const markEpisodes = async (eps: number[], watched: boolean, at?: number | null, times?: (number | null)[]) => {
    const err = await postJ(`/api/mark/${encodeURIComponent(d.key)}`, { season, episodes: eps, watched, ...(at ? { at } : {}), ...(times ? { times } : {}) });
    if (err) { alert(`Couldn't save: ${err}`); return false; }
    await reloadTitle();
  };

  const markAsk = useTwoTap();
  const markRef = useRef<HTMLButtonElement>(null);
  // the season's tick (its ring the season's progress), a tap: fill the gaps (aired episodes left between watched ones: plays a
  // tracker missed, each on the day of the watched one before it, ~25 min apart; a second tap confirms), mark the aired ones
  // left (asks when: each on its air date, or a day you pick), or, all watched, take them off (a second tap confirms)
  let markClick: () => void = () => {}, markLabel: string | undefined, markFill = 0;
  if (episodes) {
    const aired = episodes.filter((e) => !e.air || e.air <= today()), left = aired.filter((e) => !e.watched), seen = episodes.filter((e) => e.watched);
    markFill = episodes.length ? (seen.length / episodes.length) * 100 : 0;
    const lastSeen = episodes.map((e) => !!e.watched).lastIndexOf(true), gaps: { ep: number; at: number }[] = [];
    let before: number | null = null, k = 0;
    episodes.forEach((e, i) => {
      if (e.watched) { before = e.watched.at; k = 0; return; }
      if (before && i < lastSeen && (!e.air || e.air <= today())) gaps.push({ ep: e.ep, at: before + ++k * 25 * 60000 });
    });
    const ask = (anchor: HTMLElement | null) => anchor && pickDay({ anchor, air: null, airDay: true, airLabel: 'Air dates',
      save: (at) => (at === true ? markEpisodes(left.map((e) => e.ep), true, null, left.map(airAt)) : markEpisodes(left.map((e) => e.ep), true, at)) });
    if (gaps.length) {
      markLabel = `Fill ${gaps.length} gap${gaps.length === 1 ? '' : 's'}; click twice`;
      markClick = () => markAsk.tap(() => markEpisodes(gaps.map((g) => g.ep), true, null, gaps.map((g) => Math.min(Date.now(), g.at))));
    } else if (left.length) {
      markLabel = `Mark ${left.length} aired episode${left.length === 1 ? '' : 's'} watched`;
      markClick = () => ask(markRef.current);
    } else {
      markLabel = 'Season watched; click twice to unmark';
      markClick = () => markAsk.tap(() => markEpisodes(aired.map((e) => e.ep), false));
    }
  }

  const sr = d.you?.seasonRatings?.[cur.n], avg = d.you?.seasonAvg?.[cur.n];
  const [railRef, strip] = useStrip(episodes);
  if (viewing != null && episodes) return (
    <div className={`tc-eps ${cls}`}><EpisodeView key={viewing} d={d} episodes={episodes} at={viewing} season={season} where={seasonName(cur)} markEpisodes={markEpisodes} open={openEp} dir={dir} /></div>
  );
  return (
    <div className={`tc-eps ${cls}${st.allEps ? ' all' : ''}`}>
      <div className="tc-shead">
        <SeasonPick seasons={seasons} cur={cur} label={seasonName} done={done} pick={(n) => set({ season: n, allEps: false })} />
        <div className="tc-sacts">
          {(d.type !== 'anime' || seasons.length > 1) && (
            <RateCircle key={`s${cur.n}`} cls="tc-erate season" state={sr ? ' on' : avg ? ' avg' : ''} v={sr || avg || 0} current={sr || 0}
              label={sr ? `Your rating of ${seasonName(cur)}` : avg ? 'Episode average · drag to rate' : 'Drag to rate'} save={(n) => rateIt(d, n, cur.n, -1)} />
          )}
          <button ref={markRef} type="button" className={`tc-cbtn${markAsk.armed ? ' confirm' : ''}`} aria-label={markLabel} title={markLabel} disabled={!!got?.err} onClick={markClick}>
            <Circ fill={markFill}>{markAsk.armed ? <PIcon name="close" /> : <PIcon name="watched" />}</Circ>
          </button>
          {episodes?.length ? <>
            <span className={`rsep${st.allEps ? '' : ' tc-rowctl'}`} aria-hidden="true" />
            <button type="button" className={`rbtn${st.allEps ? ' on' : ' tc-rowctl'}`} aria-label={st.allEps ? 'Back to Next up' : 'All episodes'} aria-pressed={st.allEps}
              onClick={() => set({ allEps: !st.allEps })}><Icon d="M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z" size={15} /></button>
            {!st.allEps && !strip.nav.includes('h') && <>
              <button type="button" className={`rbtn rarrow tc-rowctl${strip.nav.includes('L') ? ' lit' : ''}`} aria-label="Previous" disabled={strip.nav.includes('p')} onClick={() => strip.go(-1)}><Icon d="M15 6l-6 6 6 6" size={16} width={2.2} /></button>
              <button type="button" className={`rbtn rarrow tc-rowctl${strip.nav.includes('R') ? ' lit' : ''}`} aria-label="Next" disabled={strip.nav.includes('n')} onClick={() => strip.go(1)}><Icon d="M9 6l6 6-6 6" size={16} width={2.2} /></button>
            </>}
          </> : null}
        </div>
      </div>
      {!got ? <p className="tc-note">Loading episodes…</p>
        : got.err ? <p className="tc-note">{`Couldn't load episodes (${got.err}).`}</p>
        : !episodes!.length ? <p className="tc-note">No episode list for this season yet.</p>
        : st.allEps ? <>
          <div className="tc-eplist"><EpisodeRows d={d} episodes={episodes!} season={season} markEpisodes={markEpisodes} open={openEp} /></div>
        </>
        : <div className={`tc-split${episodes!.some((e) => !e.watched) ? '' : ' solo'}`}>
          <NextUp d={d} episodes={episodes!} season={season} markEpisodes={markEpisodes} open={openEp} />
          <div className="tc-srh">
            <span>{`${episodes!.length} episodes`}</span>
            <div className="rail-nav">
              <button type="button" className="rbtn" aria-label="All episodes" onClick={() => set({ allEps: true })}><Icon d="M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z" size={15} /></button>
              {!strip.nav.includes('h') && <>
                <span className="rsep" aria-hidden="true" />
                <button type="button" className={`rbtn rarrow${strip.nav.includes('L') ? ' lit' : ''}`} aria-label="Previous" disabled={strip.nav.includes('p')} onClick={() => strip.go(-1)}><Icon d="M15 6l-6 6 6 6" size={16} width={2.2} /></button>
                <button type="button" className={`rbtn rarrow${strip.nav.includes('R') ? ' lit' : ''}`} aria-label="Next" disabled={strip.nav.includes('n')} onClick={() => strip.go(1)}><Icon d="M9 6l6 6-6 6" size={16} width={2.2} /></button>
              </>}
            </div>
          </div>
          <EpisodeStrip d={d} episodes={episodes!} season={season} markEpisodes={markEpisodes} open={openEp} strip={strip} rail={railRef} />
        </div>}
    </div>
  );
}

type Season = NonNullable<Title['seasons']>[number];
// the season title and its menu
function SeasonPick({ seasons, cur, label, done, pick }: { seasons: Season[]; cur: Season; label: (x: Season) => string; done: (x: Season) => number; pick: (n: number) => void }) {
  const [open, setOpen] = useState(false);
  const [room, setRoom] = useState(300);
  const box = useRef<HTMLDivElement>(null);
  const toggle = () => {
    const b = box.current;
    if (!open && b) {
      const end = b.closest('.tp-body')?.getBoundingClientRect().bottom ?? innerHeight;
      setRoom(Math.max(140, Math.min(300, end - b.getBoundingClientRect().bottom - 16)));
    }
    setOpen(!open);
  };
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [open]);
  const count = (x: Season) => (x.episodes ? `${done(x)}/${x.episodes}` : '');
  return (
    <div className="tc-spick" ref={box} onKeyDown={(e) => { if (open && e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}>
      <button type="button" className={`tc-spill${open ? ' open' : ''}`} aria-haspopup="listbox" aria-expanded={open} disabled={seasons.length < 2} onClick={toggle}>
        <b>{label(cur)}</b><span className="tc-scount">{count(cur)}</span>
        {seasons.length > 1 && <Icon d="M6 9l6 6 6-6" size={14} />}
      </button>
      {open && (
        <div className="tc-smenu" role="listbox" style={{ maxHeight: room }}>
          {seasons.map((x) => (
            <button key={x.n} type="button" role="option" aria-selected={x.n === cur.n} className={x.n === cur.n ? 'on' : ''} onClick={() => { setOpen(false); pick(x.n); }}>
              <span className="l">{label(x)}</span><span className="tc-scount">{count(x)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Next up: the next aired episode you haven't watched, else the next to air
function NextUp({ d, episodes, season, markEpisodes, open }: { d: Title; episodes: Episode[]; season: number; markEpisodes: Mark; open: Open }) {
  const e = episodes.find((x) => !x.watched && (!x.air || x.air <= today())) || episodes.find((x) => !x.watched);
  return e ? <NextCard key={e.ep} d={d} e={e} episodes={episodes} season={season} markEpisodes={markEpisodes} open={open} /> : null;
}
function NextCard({ d, e, episodes, season, markEpisodes, open }: { d: Title; e: Episode; episodes: Episode[]; season: number; markEpisodes: Mark; open: Open }) {
  const ep = useEpisode(d, e, episodes, season, markEpisodes);
  const mkRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="tc-next">
      <div className="tc-nstill">
        <button type="button" className="tc-nopen" aria-label={e.name || `Episode ${e.ep}`} onClick={() => open(e.ep)}>
          {(e.still || d.backdrop) && <img src={e.still || d.backdrop!} alt="" className={e.still ? undefined : 'fb'} />}
        </button>
        <span className="tc-nexttag">{ep.upcoming ? airs(e.air) : 'Next up'}</span>
        <div className="tc-markwrap">
          <button ref={mkRef} type="button" className={`tc-mark${ep.ask.armed ? ' confirm' : ''}`} aria-label={ep.tickLabel} title={ep.tickLabel} disabled={ep.upcoming}
            onClick={() => ep.tick(mkRef.current)}>
            <Circ><TickIcon armed={ep.ask.armed} upcoming={ep.upcoming} /></Circ>
          </button>
        </div>
      </div>
      <div className="tc-ntx">
        <div className="tc-nhead">
          <button type="button" className="tc-nname" onClick={() => open(e.ep)}>{e.name || `Episode ${e.ep}`}</button>
          <span className="tc-nmeta">{[`E${e.ep}`, ep.upcoming ? null : epDay(e.air), e.runtime ? `${e.runtime}m` : null].filter(Boolean).join(' · ')}</span>
        </div>
        {e.overview && <p className="tc-nov">{e.overview}</p>}
      </div>
    </div>
  );
}

// the season's episodes as a row, starting at Next up
function useStrip(episodes: Episode[] | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  const [nav, setNav] = useState('h');
  const last = useRef({ left: 0, dir: '' });
  const upd = () => {
    const x = ref.current; if (!x) return setNav('h');
    const max = x.scrollWidth - x.clientWidth, l = last.current;
    if (x.scrollLeft !== l.left) { l.dir = x.scrollLeft > l.left ? 'R' : 'L'; l.left = x.scrollLeft; }
    setNav(max <= 2 ? 'h' : `${x.scrollLeft <= 2 ? 'p' : ''}${x.scrollLeft >= max - 2 ? 'n' : ''}${l.dir}`);
  };
  useLayoutEffect(() => {
    const x = ref.current, on = x?.querySelector<HTMLElement>('.next');
    if (x) {
      x.scrollLeft = on ? on.offsetLeft : 0;
      x.scrollTop = on ? Math.max(0, on.offsetTop - on.offsetHeight - 10) : 0;
    }
    upd();
  }, [episodes]);
  useEffect(() => { addEventListener('resize', upd); return () => removeEventListener('resize', upd); }, []);
  const go = (dir: number) => { const x = ref.current; x?.scrollBy({ left: dir * x.clientWidth, behavior: 'smooth' }); };
  return [ref, { nav, upd, go }] as const;
}
type Strip = ReturnType<typeof useStrip>[1];
function EpisodeStrip({ d, episodes, season, markEpisodes, open, strip, rail }: { d: Title; episodes: Episode[]; season: number; markEpisodes: Mark; open: Open; strip: Strip; rail: React.RefObject<HTMLDivElement | null> }) {
  const next = episodes.find((x) => !x.watched && (!x.air || x.air <= today()));
  useLayoutEffect(() => { strip.upd(); });
  return (
    <div ref={rail} className="tc-srail" onScroll={strip.upd}>
      {episodes.map((e) => <StripTile key={e.ep} d={d} e={e} episodes={episodes} season={season} markEpisodes={markEpisodes} open={open} next={e === next} />)}
    </div>
  );
}
// an episode in the row: its still (the story on hover) and tick, then its number and name
function StripTile({ d, e, episodes, season, markEpisodes, open, next }: { d: Title; e: Episode; episodes: Episode[]; season: number; markEpisodes: Mark; open: Open; next: boolean }) {
  const ep = useEpisode(d, e, episodes, season, markEpisodes);
  const mkRef = useRef<HTMLButtonElement>(null);
  const name = e.name || `Episode ${e.ep}`;
  return (
    <div className={`tc-se${e.watched ? ' seen' : ''}${next ? ' next' : ''}`}>
      <div className="tc-ses">
        <button type="button" className="tc-sopen" aria-label={name} onClick={() => open(e.ep)}>
          {(e.still || d.backdrop) && <img src={e.still || d.backdrop!} alt="" loading="lazy" className={e.still ? undefined : 'fb'} />}
          {e.overview && <span className="tc-sov"><b>{[ep.upcoming ? airs(e.air) : epDay(e.air), e.runtime ? `${e.runtime}m` : null].filter(Boolean).join(' · ')}</b><span>{e.overview}</span></span>}
        </button>
        {ep.upcoming ? <span className="tc-sair">{epDay(e.air)}</span> : (
          <div className="tc-markwrap">
            <button ref={mkRef} type="button" className={`tc-mark${e.watched ? ' on' : ''}${ep.ask.armed ? ' confirm' : ''}`} aria-label={ep.tickLabel} title={ep.tickLabel}
              onClick={() => ep.tick(mkRef.current)}>
              <Circ><TickIcon armed={ep.ask.armed} upcoming={false} /></Circ>
            </button>
          </div>
        )}
      </div>
      <button type="button" className="tc-sen" onClick={() => open(e.ep)}><b>{`E${e.ep}`}</b>{name}</button>
    </div>
  );
}

type Mark = (eps: number[], watched: boolean, at?: number | null, times?: (number | null)[]) => Promise<unknown>;
type Open = (ep: number | null) => void;
function EpisodeRows({ d, episodes, season, markEpisodes, open }: { d: Title; episodes: Episode[]; season: number; markEpisodes: Mark; open: Open }) {
  const next = episodes.find((e) => !e.watched && (!e.air || e.air <= today()));
  return <>{episodes.map((e) => <EpisodeRow key={e.ep} d={d} e={e} episodes={episodes} next={e === next} season={season} markEpisodes={markEpisodes} open={open} />)}</>;
}

// an episode's marking, for its row and its page: the tick marks it watched (asking when, from the day of the watched one
// before it, and offering to take the unwatched aired ones before it along) or, watched, takes it off on a second tap; redate
// changes when you watched it
function useEpisode(d: Title, e: Episode, episodes: Episode[], season: number, markEpisodes: Mark) {
  const { reloadTitle, pickDay } = useTitle();
  const ask = useTwoTap();
  const upcoming = !!e.air && e.air > today();
  const runTo = () => {
    const i = episodes.indexOf(e); let j = i;
    while (j > 0 && !episodes[j - 1].watched && (!episodes[j - 1].air || episodes[j - 1].air! <= today())) j--;
    return episodes.slice(j, i + 1);
  };
  // the wheels start on the day of the watched episode just before (the run's first one when the chip is there), else the air date
  const markOne = (anchor: HTMLElement | null) => {
    if (!anchor) return;
    const run = runTo(), prev = episodes[episodes.indexOf(run[0]) - 1];
    pickDay({ anchor, air: prev?.watched?.at || airAt(e), airDay: airAt(e), airLabel: 'Air date', run: run.length > 1 ? { label: `E${run[0].ep}–E${e.ep}` } : null,
      save: (t, all, fromAir) => {
        if (!all) return markEpisodes([e.ep], true, t as number);
        return fromAir ? markEpisodes(run.map((x) => x.ep), true, null, run.map(airAt)) : markEpisodes(run.map((x) => x.ep), true, t as number);
      } });
  };
  const retime = async (t: number) => {
    if (t === e.watched!.at) return false;
    const err = await postJ(`/api/retime/${encodeURIComponent(d.key)}`, { season, episode: e.ep, from: e.watched!.at, at: t });
    if (err) { alert(`Couldn't save: ${err}`); return false; }
    await reloadTitle();
  };
  const tick = (anchor: HTMLElement | null) => (e.watched ? ask.tap(() => markEpisodes([e.ep], false)) : markOne(anchor));
  const redate = (anchor: HTMLElement | null) => {
    const w = e.watched;
    if (!anchor || !w) return;
    if (!w.at) return markOne(anchor);
    pickDay({ anchor, air: w.at, keepTime: timed(w), airDay: airAt(e), save: (t) => retime(t as number) });
  };
  const tickLabel = ask.armed ? ((e.watched?.plays || 0) > 1 ? 'Remove one play?' : 'Remove?') : e.watched ? 'Watched; click twice to unmark' : upcoming ? airs(e.air) : 'Mark watched';
  return { ask, upcoming, tick, redate, tickLabel };
}
const TickIcon = ({ armed, upcoming }: { armed: boolean; upcoming: boolean }) => (armed ? <PIcon name="close" /> : upcoming ? <Icon d={CLOCK} /> : <PIcon name="watched" />);

// a row: the still (Next up on it), E and the name, the story's first lines, the tick; a tap anywhere but the tick opens the
// episode's page (its air date, length, your rating and when you watched it are there)
function EpisodeRow({ d, e, episodes, next, season, markEpisodes, open }: { d: Title; e: Episode; episodes: Episode[]; next: boolean; season: number; markEpisodes: Mark; open: Open }) {
  const ep = useEpisode(d, e, episodes, season, markEpisodes);
  const mkRef = useRef<HTMLButtonElement>(null);
  const phone = usePhone(), w = e.watched;
  const tick = (
    <div className="tc-markwrap">
      <button ref={mkRef} type="button" className={`tc-mark${w ? ' on' : ''}${ep.ask.armed ? ' confirm' : ''}`} aria-label={ep.tickLabel} title={ep.tickLabel} disabled={ep.upcoming}
        onClick={(x) => { x.stopPropagation(); ep.tick(mkRef.current); }}>
        <Circ><TickIcon armed={ep.ask.armed} upcoming={ep.upcoming} /></Circ>
      </button>
    </div>
  );
  return (
    <div className={`tc-ep${w ? ' seen' : ''}${ep.upcoming ? ' soon' : ''}${next ? ' next' : ''}`} onClick={() => open(e.ep)}>
      <div className="tc-still">
        {(e.still || d.backdrop) && <img src={e.still || d.backdrop!} alt="" loading="lazy" className={e.still ? undefined : 'fb'} />}
        {next && <span className="tc-nexttag">Next up</span>}
        {!phone && tick}
      </div>
      <div className="tc-eptx">
        <button type="button" className="tc-eptop tc-epopen" onClick={(x) => { x.stopPropagation(); open(e.ep); }}>
          <span className="n">{`E${e.ep}`}</span><span className="t">{e.name || `Episode ${e.ep}`}</span>
        </button>
        {e.overview && <p className="tc-epov">{e.overview}</p>}
      </div>
      {phone && tick}
    </div>
  );
}

// an episode's page, in the window over the list: Back, where it is (Season 2 · E3), the previous and next ones (on a phone a
// sideways swipe too); the name with its air date and length, your rating and the tick on the same line (each named beside it,
// the watched date opens the date wheels); then the still beside the story in full. A phone stacks it, the still first
function EpisodeView({ d, episodes, at, season, where, markEpisodes, open, dir }: { d: Title; episodes: Episode[]; at: number; season: number; where: string; markEpisodes: Mark; open: Open; dir: string }) {
  const i = episodes.findIndex((x) => x.ep === at), e = episodes[i], prev = episodes[i - 1], nextOne = episodes[i + 1];
  const ep = useEpisode(d, e, episodes, season, markEpisodes);
  const mkRef = useRef<HTMLButtonElement>(null), dateRef = useRef<HTMLButtonElement>(null), box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollIntoView({ block: 'nearest' }); }, []);
  // a phone's swipe: left for the next one, right for the one before; not from the screen's left edge (the window's own close
  // swipe) nor on the rating circle (dragged round)
  const sw = useRef<{ x: number; y: number } | null>(null);
  const touchStart = (t: React.TouchEvent) => {
    const p = t.touches[0];
    sw.current = t.touches.length === 1 && p.clientX > 24 && !(t.target as Element).closest('.tc-erate') ? { x: p.clientX, y: p.clientY } : null;
  };
  const touchEnd = (t: React.TouchEvent) => {
    const s0 = sw.current; sw.current = null;
    if (!s0) return;
    const p = t.changedTouches[0], dx = p.clientX - s0.x, dy = p.clientY - s0.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0 && nextOne) open(nextOne.ep);
    else if (dx > 0 && prev) open(prev.ep);
  };
  const w = e.watched, when = w?.at ? new Date(w.at) : null;
  const seenTxt = !w ? (ep.upcoming ? airs(e.air) : 'Mark watched') : w.approx === 1 || !when ? 'Watched · add the date'
    : `Watched ${when.getDate()} ${MON[when.getMonth()]}${when.getFullYear() === new Date().getFullYear() ? '' : ` ${when.getFullYear()}`}${(w.plays || 0) > 1 ? ` · ${w.plays}×` : ''}`;
  return (
    <div className="tc-epview" ref={box} onTouchStart={touchStart} onTouchEnd={touchEnd}>
      <div className="tc-evtop">
        <button type="button" className="tc-evnav" aria-label="Back to the episodes" onClick={() => open(null)}><Circ><Icon d="M15 5l-7 7 7 7" /></Circ></button>
        <span className="tc-evwhere">{`${where} · E${e.ep}`}</span>
        <div className="tc-evacts">
          {!ep.upcoming && (
            <div className="tc-evact">
              <RateCircle cls="tc-erate" state={e.mine ? ' on' : ''} v={e.mine || 0} current={e.mine || 0} label={e.mine ? `Your rating ${e.mine.toFixed(1)}` : 'Drag to rate'}
                save={(n) => rateIt(d, n, season, e.ep)} />
            </div>
          )}
          <div className="tc-evact">
            <button ref={mkRef} type="button" className={`tc-mark${w ? ' on' : ''}${ep.ask.armed ? ' confirm' : ''}`} aria-label={ep.tickLabel} title={ep.tickLabel} disabled={ep.upcoming}
              onClick={() => ep.tick(mkRef.current)}><Circ><TickIcon armed={ep.ask.armed} upcoming={ep.upcoming} /></Circ></button>
          </div>
        </div>
        <span className="rsep" aria-hidden="true" />
        <button type="button" className={`tc-evnav${dir === 'L' ? ' lit' : ''}`} aria-label="Previous episode" disabled={!prev} onClick={() => prev && open(prev.ep)}><Circ><Icon d="M15 5l-7 7 7 7" /></Circ></button>
        <button type="button" className={`tc-evnav${dir === 'R' ? ' lit' : ''}`} aria-label="Next episode" disabled={!nextOne} onClick={() => nextOne && open(nextOne.ep)}><Circ><Icon d="M9 5l7 7-7 7" /></Circ></button>
      </div>
      <div className="tc-evbody">
        <div className="tc-evstill">{(e.still || d.backdrop) && <img src={e.still || d.backdrop!} alt="" className={e.still ? undefined : 'fb'} />}</div>
        <div className="tc-evtext">
          <div className="tc-evtitle">
            <h3 className="tc-evname">{e.name || `Episode ${e.ep}`}</h3>
            <div className="tc-evmeta">{[ep.upcoming ? airs(e.air) : epDay(e.air), e.runtime ? `${e.runtime}m` : null].filter(Boolean).join(' · ')}</div>
            {ep.ask.armed ? <span className="tc-evl bad">{ep.tickLabel}</span>
              : w ? <button ref={dateRef} type="button" className="tc-evl tc-evdate" onClick={() => ep.redate(dateRef.current)}>{seenTxt}</button> : null}
          </div>
          {e.overview && <p className="tc-evov">{e.overview}</p>}
        </div>
      </div>
    </div>
  );
}
// Pick date: day · month · year wheels (like iOS) under the words, starting on the air date (else today), and the watched
// circle to save: a past day at 21:00, like the air date; today as now. keepTime (changing a tracked play's date) keeps its
// time of day instead (no later than now). A day after today rolls back to today. Esc or a click elsewhere closes it unsaved.
// airDay: a calendar circle above the save one that saves at once on the air / release date (true: each episode on its own air
// date, for marking a season's rest). run: { label } adds a chip under it ("E3–E9") that takes the unwatched episodes before
// this one along; save(time, rangeOn, fromCalendar)
type Sel = { d: number; m: number; y: number };
function settle(s: Sel, now: Date): Sel {
  let { d, m } = s;
  if (new Date(s.y, m, 1) > now) m = now.getMonth();
  d = Math.min(d, new Date(s.y, m + 1, 0).getDate());
  if (new Date(s.y, m, d) > now) d = now.getDate();
  return { d, m, y: s.y };
}
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
export function PickDay({ a, close }: { a: PickArgs; close: () => void }) {
  const { anchor, air, save, keepTime = false, airDay = null, airLabel = 'Air date', run = null } = a;
  const [now] = useState(() => new Date()), [start] = useState(() => new Date(air || Date.now()));
  const [sel, setSel] = useState(() => settle({ d: start.getDate(), m: start.getMonth(), y: start.getFullYear() }, now));
  const [rangeOn, setRangeOn] = useState(false);
  const box = useRef<HTMLDivElement>(null), first = useRef(true);
  const pick = (k: keyof Sel, v: number) => setSel((s) => settle({ ...s, [k]: v }, now));
  // placed under the words, inside the window; the first wheel takes the keys; a click elsewhere or Esc closes it
  useLayoutEffect(() => {
    const b = box.current!, r = anchor.getBoundingClientRect(), wrap = anchor.closest('.tc-markwrap');
    wrap?.classList.add('picking');
    b.style.top = `${Math.max(8, Math.min(r.bottom + 6, window.innerHeight - b.offsetHeight - 8))}px`;
    b.style.left = `${Math.max(8, Math.min(r.right - b.offsetWidth, window.innerWidth - b.offsetWidth - 8))}px`;
    b.querySelector<HTMLElement>('.wheel')?.focus({ preventScroll: true });
    const away = (ev: PointerEvent) => { if (!b.contains(ev.target as Node)) close(); };
    const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };
    const t = setTimeout(() => { document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', esc, true); });
    return () => { clearTimeout(t); wrap?.classList.remove('picking'); document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc, true); };
  }, [anchor, close]);
  useEffect(() => { first.current = false; }, []);
  const ok = (ev: React.MouseEvent) => {
    ev.stopPropagation(); close();
    const isToday = sel.y === now.getFullYear() && sel.m === now.getMonth() && sel.d === now.getDate();
    void save(keepTime ? Math.min(Date.now(), new Date(sel.y, sel.m, sel.d, start.getHours(), start.getMinutes()).getTime()) : isToday ? Date.now() : new Date(sel.y, sel.m, sel.d, 21).getTime(), rangeOn, false);
  };
  return createPortal(
    <div ref={box} className={`menu whenpop${run ? ' has-range' : ''}`} role="dialog" aria-label="Pick the date">
      <div className="wheels">
        <Wheel label="Day" values={range(1, new Date(sel.y, sel.m + 1, 0).getDate())} text={String} value={sel.d} pick={(v) => pick('d', v)} first={first} />
        <Wheel label="Month" values={range(0, 11)} text={(m) => new Date(2000, m, 1).toLocaleDateString('en-GB', { month: 'short' })} value={sel.m} pick={(v) => pick('m', v)} first={first} />
        <Wheel label="Year" values={range(now.getFullYear() - 40, now.getFullYear())} text={String} value={sel.y} pick={(v) => pick('y', v)} first={first} />
      </div>
      <div className="wbtns">
        {airDay != null && (
          <button type="button" className="tc-cbtn wok" onClick={(ev) => { ev.stopPropagation(); close(); void save(airDay, rangeOn, true); }}
            aria-label={airDay === true ? `Save the ${airLabel.toLowerCase()}` : `Save the ${airLabel.toLowerCase()}, ${fmtDay(new Date(airDay).toISOString())}`}>
            <Circ><PIcon name="calendar" /></Circ>
          </button>
        )}
        <button type="button" className="tc-cbtn wok" aria-label="Save this date" onClick={ok}><Circ><PIcon name="watched" /></Circ></button>
      </div>
      {run && (
        <button type="button" className={`wrange${rangeOn ? ' on' : ''}`} aria-pressed={rangeOn} aria-label={`Mark ${run.label} together (the unwatched ones in a row up to here)`}
          onClick={(ev) => { ev.stopPropagation(); setRangeOn(!rangeOn); }}>{run.label}</button>
      )}
    </div>,
    document.body,
  );
}
// a three-row column of snapping rows; the middle one is the chosen one
const ROW = 22;
function Wheel({ label, values, text, value, pick, first }: { label: string; values: number[]; text: (v: number) => string; value: number; pick: (v: number) => void; first: React.RefObject<boolean> }) {
  const w = useRef<HTMLDivElement>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLayoutEffect(() => {
    w.current?.scrollTo({ top: Math.max(0, values.indexOf(value)) * ROW, behavior: first.current ? 'instant' : 'smooth' });
  }, [value, values.length, first]);   // eslint-disable-line react-hooks/exhaustive-deps
  const step = (n: number) => { const i = values.indexOf(value) + n; if (i >= 0 && i < values.length) pick(values[i]); };
  // a mouse wheel's notch (~100 px, or a line in Firefox) would fling past several 22 px rows and snap somewhere else: one
  // notch is one row, like the arrow keys. A touchpad's small deltas keep the native smooth scroll
  const stepRef = useRef(step);
  useLayoutEffect(() => { stepRef.current = step; });
  useEffect(() => {
    const el = w.current!;
    const wheel = (ev: WheelEvent) => { if (ev.deltaMode === 0 && Math.abs(ev.deltaY) < 50) return; ev.preventDefault(); stepRef.current(Math.sign(ev.deltaY)); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  return (
    <div ref={w} className="wheel" tabIndex={0} aria-label={label}
      onScroll={() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => { const el = w.current; if (!el) return; const v = values[Math.min(values.length - 1, Math.max(0, Math.round(el.scrollTop / ROW)))]; if (v !== value) pick(v); }, 120);
      }}
      onKeyDown={(ev) => { const s = ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowUp' ? -1 : 0; if (!s) return; ev.preventDefault(); step(s); }}>
      {values.map((v, i) => <div key={v} className="wrow" onClick={() => w.current?.scrollTo({ top: i * ROW, behavior: 'smooth' })}>{text(v)}</div>)}
    </div>
  );
}
