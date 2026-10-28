'use client';
// smart list builder + filter chips
import { useEffect, useState, type ReactNode } from 'react';
import { PkBtn } from './Cards';
import { Drop } from './Drop';
import { getJ, postJ } from './lib/api';
import { say } from './lib/format';
import { Icon, PATHS } from './lib/icons';
import { guessCountry, type Country, type Prefs, type RegionInfo } from './lib/region';
import { ServiceGrid } from './Region';
import { SearchPick, type Picked } from './SearchPick';
import { Slider } from './Slider';

export type Media = 'movie' | 'tv' | 'anime' | 'animefilm' | 'both';
export type Filters = {
  sort?: 'popular' | 'rating' | 'newest' | 'oldest' | 'az' | 'box' | 'votes' | 'shuffle' | 'release' | 'releaseOld'; max?: number; refresh?: 'daily' | 'weekly' | 'never'; row?: boolean;
  home?: ('uhd' | 'bluray' | 'digital' | 'streaming')[]; homeWithin?: number; homeCinema?: boolean;
  genres?: string[]; without?: string[]; match?: 'any' | 'all';
  when?: 'any' | '30d' | '6m' | 'year' | 'next3' | 'years'; yearFrom?: number; yearTo?: number; decades?: number[];
  runtimeFrom?: number; runtimeTo?: number; released?: 'out' | 'coming' | 'both'; cert?: string; out?: ('cinema' | 'digital' | 'disc' | 'tv')[]; status?: number[]; type?: number[];
  scoreFrom?: number; scoreTo?: number; votes?: number; votesTo?: number; region?: string; reach?: 'released' | 'streaming' | 'anywhere'; services?: (number | string)[]; my?: boolean;
  how?: 'flatrate' | 'free' | 'rent'; tvdbGenre?: number;
  language?: string; country?: string; languages?: string[]; countries?: string[];
  mood?: string; keywords?: Picked[]; cast?: Picked[]; castMatch?: 'any' | 'all'; crew?: Picked[]; companies?: Picked[]; networks?: number[];
  hideWatched?: boolean; hidePlan?: boolean; onlyRated?: boolean; myFrom?: number; myTo?: number; watched?: 'year' | 'old' | 'started';
  // other sources' floors (checked title by title, scores.ts), all or any of them, and a source with no score: out or kept
  ext?: Partial<Record<Src, number>>; meet?: 'all' | 'any'; missing?: 'out' | 'keep';
};
export type Src = 'imdb' | 'rt' | 'mc' | 'mal' | 'kitsu';
export type Draft = { id?: string; name: string; description: string; media: Media; filters: Filters; shared?: boolean };

export const KIND: Record<Media, [string, string]> = { movie: ['Movies', PATHS.movie], tv: ['Shows', PATHS.tv], anime: ['Anime series', PATHS.anime],
  animefilm: ['Anime movies', PATHS.anime], both: ['Movies & shows', 'M2 6h11v10H2zM11 9h11v10H11z'] };
const year = new Date().getFullYear();
export const ICON = { smart: 'M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  share: 'M18 8a3 3 0 1 0 0-6a3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6a3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4' };

// a smart list's settings under its name: each its group's icon (the kind's own) and words, a left-out one red with a minus,
// the order last in the accent
const ORDER_ICON = 'M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4', MINUS = 'M6 12h12';
export function Chips({ media, f }: { media: Media; f: Filters }) {
  const chips = describe(media, f, { lang: langName, land: landName });
  return (
    <div className="l-fchips">
      {chips.map(([g, t, , no], i) => <span key={i} className={no ? 'no' : undefined}><Icon d={no ? MINUS : i === 0 ? KIND[media][1] : GROUP_ICON[g]} size={13} width={2} />{t}</span>)}
      <span className="ord"><Icon d={ORDER_ICON} size={13} width={2} />{ORDER_NAME[f.sort || 'popular']}</span>
    </div>
  );
}

// the smart list builder, a sheet over the page: the name as its title, a strip of what's set (each with its ×), then the
// groups on the left (each with how many of its settings are on), the open group's settings (dropdowns, the kind circles, the
// genre chips, the country's services, switches) and a live preview (the titles the list will hold). A list has its own
// country, starting with yours
const GROUPS = [['basics', 'Basics', 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6'], ['genres', 'Genres', 'M5 4v16M9 4v16M13 5l4 15M19 4v16'], ['release', 'Release', PATHS.cal],
  ['scores', 'Scores', PATHS.star], ['streaming', 'Streaming', 'M3 8a2 2 0 0 0 0 4v4h18v-4a2 2 0 0 1 0-4V4H3zM13 4v16'], ['language', 'Language', PATHS.globe],
  ['people', 'People & studios', PATHS.people], ['library', 'Your library', PATHS.tick], ['sharing', 'Sharing', ICON.share]] as const;
type Group = (typeof GROUPS)[number][0];
const GROUP_ICON = Object.fromEntries(GROUPS.map(([k, , ic]) => [k, ic])) as Record<Group, string>;
// the last Latest releases circle off takes its settings and its own orders with it
const homePatch = (f: Filters, home: NonNullable<Filters['home']>): Partial<Filters> => (home.length ? { home }
  : { home: undefined, homeWithin: undefined, homeCinema: undefined, ...(f.sort === 'release' || f.sort === 'releaseOld' ? { sort: undefined } : {}) });
const names = (type: 'language' | 'region') => { try { return new Intl.DisplayNames(['en'], { type }); } catch { return null; } };
const LANG = names('language'), LAND = names('region');
const langName = (l: string) => LANG?.of(l) || l, landName = (c: string) => LAND?.of(c) || c;
const ORDER_NAME: Record<NonNullable<Filters['sort']>, string> = { popular: 'Popular first', rating: 'Top rated first', newest: 'Newest first', oldest: 'Oldest first',
  az: 'A–Z', box: 'Box office first', votes: 'Most voted first', shuffle: 'Shuffled', release: 'Newest release first', releaseOld: 'Oldest release first' };
type Desc = [Group, string, Partial<Filters> | null, boolean?];
// what a smart list has set, in the builder's groups: each with what clearing it sets (null: it can't be cleared) and whether it
// leaves something out; the builder's strip and the list page's chips. svc: a service's name (without it, services are counted)
function describe(media: Media, f: Filters, n: { svc?: (id: number | string) => string; lang: (l: string) => string; land: (c: string) => string }): Desc[] {
  const films = media === 'movie' || media === 'animefilm' || media === 'both', shows = media === 'tv' || media === 'anime' || media === 'both';
  const when = f.when || (f.yearFrom || f.yearTo ? 'years' : 'any'), picked = (f.services || []).filter((x): x is number => typeof x === 'number');
  const langs = f.languages?.length ? f.languages : f.language ? [f.language] : [], lands = f.countries?.length ? f.countries : f.country ? [f.country] : [];
  const D = (g: Group, t: string, patch: Partial<Filters> | null, no?: boolean): Desc => [g, t, patch, no];
  const ext = (k: Src): Partial<Filters> => { const e = { ...f.ext, [k]: undefined }; return { ext: Object.values(e).some(Boolean) ? e : undefined }; };
  return [
    D('basics', KIND[media][0], null),
    ...(f.myFrom || f.myTo || f.watched ? [D('basics', 'From your library', null)] : []),
    ...(f.reach && f.reach !== 'anywhere' ? [D('basics', f.reach === 'streaming' ? 'On its services' : films ? 'Released there' : 'Made there', { reach: undefined })] : []),
    ...(f.row ? [D('basics', 'On Home', { row: undefined })] : []),
    ...(f.home || []).map((x) => D('basics', `Latest: ${label(HOME.map(([v, nm]) => [v, nm] as [string, string]), x)}`, homePatch(f, f.home!.filter((y) => y !== x)))),
    ...(f.home?.length ? [D('basics', `Last ${label(WITHIN, f.homeWithin || 90)}`, f.homeWithin ? { homeWithin: undefined } : null)] : []),
    ...(f.home?.length && f.homeCinema ? [D('basics', 'From cinemas', { homeCinema: undefined })] : []),
    ...(f.mood ? [D('genres', label(MOODS.map(([v, nm]) => [v, nm] as [string, string]), f.mood), { mood: undefined })] : []),
    ...(media === 'tv' && f.tvdbGenre ? [D('genres', `${label(TVDB_CATS, f.tvdbGenre)} · TheTVDB`, { tvdbGenre: undefined })] : []),
    ...(f.genres || []).map((g) => D('genres', g, { genres: f.genres!.filter((x) => x !== g) })),
    ...(f.without || []).map((g) => D('genres', g, { without: f.without!.filter((x) => x !== g) }, true)),
    ...(f.match === 'all' && (f.genres || []).length > 1 ? [D('genres', 'All genres', { match: undefined })] : []),
    ...(f.keywords || []).map((k) => D('genres', k.name, { keywords: f.keywords!.filter((x) => x.id !== k.id) }, k.out)),
    ...(when === 'years' && (f.yearFrom || f.yearTo) ? [D('release', `${f.yearFrom || '…'}–${f.yearTo || '…'}`, { when: undefined, yearFrom: undefined, yearTo: undefined })] : []),
    ...(when !== 'any' && when !== 'years' ? [D('release', label(WHEN, when), { when: undefined })] : []),
    ...(f.decades || []).map((x) => D('release', label(DECADES, x), { decades: f.decades!.filter((y) => y !== x) })),
    ...(films ? (f.out || []).map((x) => D('release', label(OUT, x), { out: f.out!.filter((y) => y !== x) })) : []),
    ...(shows ? (f.status || []).map((x) => D('release', label(STATUS, x), { status: f.status!.filter((y) => y !== x) })) : []),
    ...(shows ? (f.type || []).map((x) => D('release', label(TV_TYPE, x), { type: f.type!.filter((y) => y !== x) })) : []),
    ...(f.released && f.released !== 'both' ? [D('release', f.released === 'out' ? 'Out now' : 'Coming', { released: undefined })] : []),
    ...(f.runtimeFrom || f.runtimeTo ? [D('release', range(f.runtimeFrom, f.runtimeTo, ' min'), { runtimeFrom: undefined, runtimeTo: undefined })] : []),
    ...(films && f.cert ? [D('release', `Up to ${f.cert}`, { cert: undefined })] : []),
    ...(f.scoreFrom || f.scoreTo ? [D('scores', `TMDB ${range(f.scoreFrom, f.scoreTo)}`, { scoreFrom: undefined, scoreTo: undefined })] : []),
    ...(f.votes || f.votesTo ? [D('scores', `${f.votes && f.votesTo ? `${votesText(f.votes)}–${votesText(f.votesTo)}` : f.votes ? `${votesText(f.votes)}+` : `up to ${votesText(f.votesTo!)}`} votes`,
      { votes: undefined, votesTo: undefined })] : []),
    ...SOURCES.filter(([k]) => f.ext?.[k]).map(([k, nm, , unit]) => D('scores', `${nm} ${f.ext![k]}${unit}+`, ext(k))),
    ...(f.my ? [D('streaming', 'My services', { my: undefined })] : n.svc ? picked.map((id) => D('streaming', n.svc!(id), { services: picked.filter((x) => x !== id) }))
      : picked.length ? [D('streaming', `${picked.length} service${picked.length > 1 ? 's' : ''}`, null)] : []),
    ...(f.how && f.how !== 'flatrate' ? [D('streaming', f.how === 'free' ? 'Free' : 'Rent or buy', { how: undefined })] : []),
    ...(shows ? (f.networks || []).map((x) => D('streaming', label(NETWORKS, x), { networks: f.networks!.filter((y) => y !== x) })) : []),
    ...langs.map((l) => D('language', n.lang(l), { language: undefined, languages: langs.filter((x) => x !== l) })),
    ...lands.map((c) => D('language', `Made in ${n.land(c)}`, { country: undefined, countries: lands.filter((x) => x !== c) })),
    ...(films ? (f.cast || []).map((k) => D('people', k.name, { cast: f.cast!.filter((x) => x.id !== k.id) })) : []),
    ...(films ? (f.crew || []).map((k) => D('people', k.name, { crew: f.crew!.filter((x) => x.id !== k.id) })) : []),
    ...(f.companies || []).map((k) => D('people', k.name, { companies: f.companies!.filter((x) => x.id !== k.id) }, k.out)),
    ...(f.hideWatched ? [D('library', 'Hide watched', { hideWatched: undefined })] : []),
    ...(f.hidePlan ? [D('library', 'Hide Plan to watch', { hidePlan: undefined })] : []),
    ...(f.onlyRated ? [D('library', 'Only rated', { onlyRated: undefined })] : []),
    ...(f.myFrom || f.myTo ? [D('library', `My rating ${range(f.myFrom, f.myTo)}`, { myFrom: undefined, myTo: undefined })] : []),
    ...(f.watched ? [D('library', label(WATCHED, f.watched), { watched: undefined })] : []),
  ];
}
export const Sw = ({ on, set, label }: { on: boolean; set: (x: boolean) => void; label: string }) => (
  <button type="button" className={`l-sw${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => set(!on)} />);
const SwitchRow = ({ label, on, set }: { label: string; on: boolean; set: (x: boolean) => void }) => <div className="b-line"><span>{label}</span><Sw on={on} set={set} label={label} /></div>;
const YEARS: [number, string][] = Array.from({ length: year + 3 - 1900 }, (_, i) => year + 2 - i).map((y) => [y, String(y)]);
const WHEN: [NonNullable<Filters['when']>, string][] = [['any', 'Any time'], ['30d', 'Last 30 days'], ['6m', 'Last 6 months'], ['year', 'This year'], ['next3', 'Next 3 months'], ['years', 'Pick years']];
// Latest releases: out lately on digital (TMDB), of those streaming now (on the Streaming group's services, else any), or on a
// 4K disc or a Blu-ray (blu-ray.com); movies and anime movies only, each a circle under Basics' Kind
const DISC = 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4z';
const HOME: ['uhd' | 'bluray' | 'digital' | 'streaming', string, string | ReactNode][] = [['digital', 'Digital', 'M12 4v11M7 10l5 5 5-5M5 20h14'],
  ['streaming', 'Streaming', 'M4 6h16v10H4zM8 20h8M12 16v4M10 8.5v5l4-2.5z'], ['uhd', '4K disc', <b key="4k" className="pk-4k">4K</b>], ['bluray', 'Blu-ray', DISC]];
const HOME_ORDER: [NonNullable<Filters['sort']>, string][] = [['release', 'Newest release'], ['releaseOld', 'Oldest release'], ['rating', 'Rating'], ['az', 'A–Z'],
  ['newest', 'Newest film'], ['oldest', 'Oldest film'], ['shuffle', 'Shuffle']];
const WITHIN: [number, string][] = [[30, '30 days'], [90, '3 months'], [180, '6 months'], [365, 'Year']];
const DECADES: [number, string][] = [[1950, '50s'], [1960, '60s'], [1970, '70s'], [1980, '80s'], [1990, '90s'], [2000, '2000s'], [2010, '2010s'], [2020, '2020s']];
const OUT: [NonNullable<Filters['out']>[number], string][] = [['cinema', 'In cinemas'], ['digital', 'On digital'], ['disc', 'On disc'], ['tv', 'On TV']];
const STATUS: [number, string][] = [[0, 'Returning'], [1, 'Planned'], [2, 'In production'], [3, 'Ended'], [4, 'Cancelled'], [5, 'Pilot']];
export const TVDB_CATS: [number, string][] = [[8, 'Game show'], [9, 'Food'], [25, 'Travel'], [7, 'Home and garden'], [23, 'Talk show'], [21, 'Sport'], [3, 'Reality'],
  [13, 'Documentary'], [1, 'Soap'], [36, 'Awards show'], [33, 'History'], [35, 'Martial arts'], [30, 'Podcast']];
const TV_TYPE: [number, string][] = [[4, 'Scripted'], [2, 'Miniseries'], [0, 'Documentary'], [3, 'Reality'], [5, 'Talk show'], [1, 'News'], [6, 'Video']];
const MINUTES: [number, string][] = [[0, 'Any'], [20, '20 min'], [30, '30 min'], [45, '45 min'], [60, '1 h'], [90, '1 h 30'], [120, '2 h'], [150, '2 h 30'], [180, '3 h'],
  [210, '3 h 30'], [240, '4 h'], [300, '5 h']];
// moods: genres (and keywords) filled in for you, to adjust afterwards (TMDB keyword ids)
const MOODS: [string, string, Partial<Filters>][] = [
  ['feel', 'Feel-good', { genres: ['Comedy', 'Family', 'Romance', 'Music'], without: ['Horror', 'War', 'Thriller', 'Crime'] }],
  ['dark', 'Dark', { genres: ['Thriller', 'Crime', 'Horror', 'Mystery'], without: ['Comedy', 'Family', 'Animation'] }],
  ['mind', 'Mind-bending', { genres: ['Sci-Fi', 'Mystery', 'Thriller'], keywords: [{ id: 326438, name: 'twist ending' }, { id: 12565, name: 'psychological thriller' }] }],
  ['cosy', 'Cosy', { genres: ['Family', 'Animation', 'Comedy', 'Romance'], without: ['Horror', 'Thriller', 'War', 'Crime'] }],
  ['edge', 'Edge of your seat', { genres: ['Thriller', 'Action'], without: ['Comedy', 'Family', 'Animation'] }],
  ['tears', 'Tear-jerker', { genres: ['Drama'], keywords: [{ id: 156924, name: 'tearjerker' }] }],
  ['laugh', 'Laugh out loud', { genres: ['Comedy'], without: ['Drama', 'Horror', 'Documentary'] }],
  ['epic', 'Epic', { genres: ['Adventure', 'Fantasy', 'History', 'War'], votes: 1000 }]];
// TV networks for Made by (TMDB has no network search, so its ids and names are listed here)
const NETWORKS: [number, string][] = [[213, 'Netflix'], [49, 'HBO'], [3186, 'HBO Max'], [2552, 'Apple TV'], [1024, 'Prime Video'], [2739, 'Disney+'], [453, 'Hulu'],
  [4330, 'Paramount+'], [3353, 'Peacock'], [1112, 'Crunchyroll'], [174, 'AMC'], [88, 'FX'], [67, 'Showtime'], [318, 'STARZ'], [6, 'NBC'], [16, 'CBS'], [2, 'ABC'],
  [19, 'FOX'], [71, 'The CW'], [77, 'Syfy'], [34, 'Lifetime'], [56, 'Cartoon Network'], [13, 'Nickelodeon'], [54, 'Disney Channel'], [64, 'Discovery'],
  [4353, 'discovery+'], [43, 'National Geographic'], [4, 'BBC One'], [332, 'BBC Two'], [26, 'Channel 4'], [9, 'ITV1'], [614, 'TOKYO MX'], [1, 'Fuji TV'],
  [160, 'TBS (Japan)'], [98, 'TV Tokyo'], [156, 'SBS'], [97, 'MBC'], [866, 'tvN'], [3732, 'WeTV']];
// the sliders' steps: every tenth for a 0-10 score, every point for a percentage or Metacritic's 0-100 (the first, 0, is Any)
const steps = (to: number, by: number) => Array.from({ length: Math.round(to / by) + 1 }, (_, i) => Math.round(i * by * 10) / 10);
const TENTHS = steps(10, 0.1), POINTS = steps(100, 1);
// each source's floor steps, its unit, and which key the instance needs for it
const SOURCES: [Src, string, number[], string, 'omdb' | 'mal' | null][] = [
  ['imdb', 'IMDb', TENTHS, '', 'omdb'], ['rt', 'Rotten Tomatoes', POINTS, '%', 'omdb'], ['mc', 'Metacritic', POINTS, '', 'omdb'],
  ['mal', 'MyAnimeList', TENTHS, '', 'mal'], ['kitsu', 'Kitsu', POINTS, '%', null]];
// the Scores group's quick picks: the score and vote sliders (and other sources' floors) set at once, to adjust afterwards.
// The last two need their source's key and suit one kind each: critics (Rotten Tomatoes, Metacritic) rarely review anime,
// and MyAnimeList's fans rate only anime, so a list shows one of them, six picks either way
const PICKS: [string, string, Partial<Filters>, 'omdb' | 'mal' | null][] = [
  ['Hidden gems', 'M6 3h12l3 6-9 12L3 9zM3 9h18M9 3l3 6 3-6M12 9v12', { scoreFrom: 7.5, votes: 50, votesTo: 1000 }, null],
  ['So bad it’s good', 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM8 15c2-2 6-2 8 0M9 9h.01M15 9h.01', { scoreTo: 5, votes: 500 }, null],
  ['Crowd pleasers', PATHS.people, { scoreFrom: 7, votes: 10000 }, null],
  ['Masterpieces', 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 21h6M10 17h4', { scoreFrom: 8.3, votes: 2500 }, null],
  ['Cult classics', PATHS.moon, { scoreFrom: 7, scoreTo: 8.5, votes: 500, votesTo: 5000 }, null],
  ['Critics’ darlings', 'M5 7h5v5H7a3 3 0 0 0 3 3M14 7h5v5h-3a3 3 0 0 0 3 3', { ext: { rt: 90, mc: 80 } }, 'omdb'],
  ['Fan favourites', PATHS.heart, { votes: 100, ext: { mal: 8.5 } }, 'mal']];
const SCORED: (keyof Filters)[] = ['scoreFrom', 'scoreTo', 'votes', 'votesTo', 'ext'];
// the TMDB score slider in tenths (Any at both ends: no floor, no ceiling); votes on rounder steps
const SCORE_STEPS = TENTHS;
const tenth = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const VOTE_STEPS = [0, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
const votesText = (v: number) => (v >= 1000 ? `${v / 1000}k` : String(v));
const WATCHED: [NonNullable<Filters['watched']>, string][] = [['year', 'Watched this year'], ['old', 'Watched over a year ago'], ['started', 'Started, not finished']];
const MY: [number, string][] = [[0, 'Any'], ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((x): [number, string] => [x, String(x)])];
export const label = <T,>(opts: [T, string][], v: T) => opts.find((o) => o[0] === v)?.[1] || String(v);
const range = (a: number | undefined, b: number | undefined, unit = '') => (a && b ? `${a}–${b}${unit}` : a ? `${a}+${unit}` : `up to ${b}${unit}`);

export function Builder({ draft, page, close, saved }: { draft: Draft; page: { genres: Record<Media, string[]> }; close: () => void; saved: (id: string) => Promise<void> }) {
  const [d, setD] = useState(draft), [g, setG] = useState<Group>('basics'), [busy, setBusy] = useState(false), [e, setE] = useState('');
  const [prev, setPrev] = useState<{ total: number; count: number; pending: number; pool: number; posters: { key: string; title: string; poster: string | null }[] } | null>(null), [loading, setLoading] = useState(false);
  const [prefs, setPrefs] = useState<Prefs | null>(null), [got, setGot] = useState<{ cc: string; r: RegionInfo } | null>(null);
  const [seeing, setSeeing] = useState(false);
  const [keys, setKeys] = useState<{ mal: boolean; omdb: boolean; tvdb?: boolean } | null>(null), [opts, setOpts] = useState<{ languages: Country[]; countries: Country[] } | null>(null);
  useEffect(() => { let live = true; getJ<{ languages: Country[]; countries: Country[] }>('/api/lists/options').then((o) => { if (live) setOpts(o); }, () => {}); return () => { live = false; }; }, []);
  useEffect(() => { let live = true; getJ<{ sources: { mal: boolean; omdb: boolean; tvdb?: boolean } }>('/api/config').then((c) => { if (live) setKeys(c.sources); }, () => {}); return () => { live = false; }; }, []);
  const f = d.filters, setF = (x: Partial<Filters>) => setD((y) => ({ ...y, filters: { ...y.filters, ...x } }));
  const yours = prefs ? prefs.country || guessCountry() : null, region = f.region || yours;
  // your country and the countries; a new list (or one from before lists had countries) starts with yours
  useEffect(() => { let live = true; getJ<Prefs>('/api/region').then((p) => { if (!live) return; setPrefs(p); setD((y) => (y.filters.region ? y : { ...y, filters: { ...y.filters, region: p.country || guessCountry() } })); }, () => {}); return () => { live = false; }; }, []);
  useEffect(() => { if (!region) return; let live = true; getJ<RegionInfo>(`/api/region/${region}`).then((r) => { if (live) setGot({ cc: region, r }); }, () => {}); return () => { live = false; }; }, [region]);
  const reg = got?.cc === region ? got.r : null;
  const key = JSON.stringify([d.media, f]);
  useEffect(() => {
    if (!f.region) return;
    let live = true;
    const t = setTimeout(async () => {
      setLoading(true);
      const got = {} as NonNullable<typeof prev>, err = await postJ('/api/lists/preview', { media: d.media, filters: f }, got as unknown as Record<string, unknown>);
      if (live) { setPrev(err ? null : got); setLoading(false); }
    }, 500);
    return () => { live = false; clearTimeout(t); };
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const esc = (x: KeyboardEvent) => { if (x.key === 'Escape') close(); }; document.addEventListener('keydown', esc); return () => document.removeEventListener('keydown', esc); }, [close]);
  const save = async () => {
    const name = d.name.trim();
    if (!name) return setE('Give the list a name');
    setBusy(true);
    const got: { id?: string } = {}, body = { name, description: d.description, media: d.media, filters: f, shared: !!d.shared };
    const err = d.id ? await postJ(`/api/lists/${d.id}/edit`, body) : await postJ('/api/lists/new', { ...body, kind: 'smart' }, got);
    setBusy(false);
    if (err) return setE(say(err) || '');
    await saved(d.id || got.id!);
  };

  const films = d.media === 'movie' || d.media === 'animefilm' || d.media === 'both', shows = d.media === 'tv' || d.media === 'anime' || d.media === 'both', cname = (c?: string) => prefs?.countries.find((x) => x.id === c)?.name || c || '';
  const svcName = (id: number | string) => reg?.services.find((s) => s.id === id)?.name || String(id);
  const picked = (f.services || []).filter((x): x is number => typeof x === 'number');
  const mineHere = !!prefs && region === yours && prefs.services.length > 0;
  const when = f.when || (f.yearFrom || f.yearTo ? 'years' : 'any');
  const setExt = (k: Src, v: number | undefined) => { const ext = { ...f.ext, [k]: v || undefined }; setF({ ext: Object.values(ext).some(Boolean) ? ext : undefined }); };
  const floors = SOURCES.filter(([k]) => f.ext?.[k]).length;
  // how many go in (scores picking: how many have passed so far, of the candidates checked)
  const said = loading ? 'Looking…' : !prev ? 'No preview' : floors > 0 ? `${prev.count} of ${prev.pool} pass` : `${prev.count} ${prev.count === 1 ? 'title' : 'titles'}`;
  const langs = f.languages?.length ? f.languages : f.language ? [f.language] : [], lands = f.countries?.length ? f.countries : f.country ? [f.country] : [];
  // cast and crew are films' (TMDB's show search ignores them); a mood fills genres and keywords
  const people = d.media === 'movie' || d.media === 'animefilm' || d.media === 'both';
  const mood = (v: string) => { const m = MOODS.find((x) => x[0] === v); setF(m ? { genres: [], without: [], keywords: [], match: 'any', ...m[2], mood: v } : { mood: undefined }); };
  // what's set, as the strip's tags (each with what its × clears) and each group's count
  type Tag = [Group, string, (() => void) | null, boolean?];
  const T = (grp: Group, t: string, clear: (() => void) | null, no?: boolean): Tag => [grp, t, clear, no];
  const tags: Tag[] = [
    T('basics', KIND[d.media][0], null), T('basics', cname(region || undefined), null),
    ...describe(d.media, f, { svc: reg ? svcName : undefined, lang: (l) => opts?.languages.find((x) => x.id === l)?.name || langName(l),
      land: (c) => opts?.countries.find((x) => x.id === c)?.name || landName(c) }).slice(1).map(([g, t, patch, no]) => T(g, t, patch ? () => setF(patch) : null, no)),
    ...(d.shared ? [T('sharing', 'Shared', () => setD({ ...d, shared: false }))] : []),
  ];
  const count = (k: Group) => tags.filter((t) => t[0] === k && t[2]).length;
  const anime = d.media === 'anime' || d.media === 'animefilm';
  // a new kind starts its genres over (anime series and movies share theirs); Latest releases are movies' and anime movies' only
  const setKind = (m: Media) => setD({ ...d, media: m, filters: { ...f, ...(anime && (m === 'anime' || m === 'animefilm') ? {} : { genres: [], without: [] }), cert: undefined,
    sort: f.sort === 'box' && m === 'tv' ? undefined : f.sort,
    ...(m !== 'movie' && m !== 'animefilm' ? { home: undefined, homeWithin: undefined, homeCinema: undefined, ...(f.sort === 'release' || f.sort === 'releaseOld' ? { sort: undefined } : {}) } : {}) } });
  const setHome = (home: NonNullable<Filters['home']>) => setF(homePatch(f, home));
  // Movies' Latest releases: any circle on makes the list the latest digital / streaming / 4K / Blu-ray releases instead of TMDB's search
  const latest = <>
    <div className="b-sec"><span className="dd-l">Out at home lately</span><div className="pk-set">{HOME.map(([v, n, face]) => {
      const on = !!f.home?.includes(v);
      return <PkBtn key={v} label={n} data={{}} face={face} on={on} pressed={on} onClick={() => setHome(on ? f.home!.filter((y) => y !== v) : [...(f.home || []), v])} />; })}</div></div>
    {!!f.home?.length && <div className="b-dds">
      <Drop label="Released in the last" opts={WITHIN} value={f.homeWithin || 90} set={(d) => setF({ homeWithin: d === 90 ? undefined : d })} />
      <Drop label="Order" opts={HOME_ORDER} value={f.sort && HOME_ORDER.some(([v]) => v === f.sort) ? f.sort : 'release'} set={(sort) => setF({ sort: sort === 'release' ? undefined : sort })} />
    </div>}
    {!!f.home?.length && <div className="b-lines"><SwitchRow label="Only films from cinemas" on={!!f.homeCinema} set={(on) => setF({ homeCinema: on || undefined })} /></div>}
    </>;

  const pane: Record<Group, ReactNode> = {
    basics: <>
      {/* Anime is one circle; its Shows | Movies circles under it pick series or films */}
      <div className="b-sec"><span className="dd-l">Kind</span><div className="pk-set">{(['movie', 'tv', 'anime', 'both'] as Media[]).map((m) => {
        const on = m === 'anime' ? anime : d.media === m;
        return <PkBtn key={m} label={m === 'anime' ? 'Anime' : KIND[m][0]} data={{}} face={KIND[m][1]} on={on} pressed={on} onClick={() => { if (!on) setKind(m); }} />; })}</div></div>
      {anime && <div className="b-sec"><span className="dd-l">Anime</span><div className="pk-set">{([['anime', 'Shows', PATHS.tv], ['animefilm', 'Movies', PATHS.movie]] as const).map(([m, n, face]) =>
        <PkBtn key={m} label={n} data={{}} face={face} on={d.media === m} pressed={d.media === m} onClick={() => setKind(m)} />)}</div></div>}
      {(d.media === 'movie' || d.media === 'animefilm') && latest}
      <div className="b-dds">
        {!f.home?.length && <Drop label="Order" opts={[['popular', 'Popular'], ['rating', 'Rating'], ['newest', 'Newest'], ['oldest', 'Oldest'], ['az', 'A–Z'], ...(films ? [['box', 'Box office'] as ['box', string]] : []),
          ['votes', 'Most voted'], ['shuffle', 'Shuffle']]} value={f.sort || 'popular'} set={(sort) => setF({ sort })} />}
        <Drop label="How many" opts={[[20, '20'], [40, '40'], [60, '60'], [100, '100'], [200, '200'], [250, '250'], [500, '500']]} value={f.max || 60} set={(max) => setF({ max })} />
        <Drop label="Refresh" opts={[['daily', 'Daily'], ['weekly', 'Weekly'], ['never', 'Never']]} value={f.refresh || 'daily'} set={(refresh) => setF({ refresh })} />
        {prefs && <Drop label="Country" search opts={prefs.countries.map((c) => [c.id, c.name])} value={region || ''}
          set={(c) => setF({ region: c, cert: undefined, my: c === yours ? f.my : undefined, services: [] })} />}
        <Drop label="Titles from" opts={[['anywhere', 'Anywhere'], ['released', films ? 'Released there' : 'Made there'], ['streaming', 'On its services']]} value={f.reach || 'anywhere'}
          set={(reach) => setF({ reach: reach === 'anywhere' ? undefined : reach })} />
      </div>
      <div className="b-lines">
        <SwitchRow label="Show on Home" on={!!f.row} set={(row) => setF({ row: row || undefined })} />
      </div>
    </>,
    genres: <>
      <div className="b-dds">
        <Drop label="Mood" opts={[['', 'None'], ...MOODS.map(([v, n]): [string, string] => [v, n])]} value={f.mood || ''} set={mood} />
        <Drop label="Genres" multi search opts={page.genres[d.media].map((n): [string, string] => [n, n])} value={f.genres || []}
          set={(genres) => setF({ genres, without: (f.without || []).filter((x) => !genres.includes(x)) })} />
        <Drop label="Leave out" multi search opts={page.genres[d.media].map((n): [string, string] => [n, n])} value={f.without || []} empty="None"
          set={(without) => setF({ without, genres: (f.genres || []).filter((x) => !without.includes(x)) })} />
        {d.media === 'tv' && keys?.tvdb && <Drop label="TV category (TheTVDB)" opts={[[0, 'None'], ...TVDB_CATS]} value={f.tvdbGenre || 0} set={(c) => setF({ tvdbGenre: c || undefined })} />}
        <Drop label="Match genres" opts={[['any', 'Any of them'], ['all', 'All of them']]} value={f.match || 'any'} set={(match) => setF({ match })} />
      </div>
      <div className="b-half"><SearchPick kind="keyword" label="Keywords" canOut value={f.keywords || []} set={(keywords) => setF({ keywords: keywords.length ? keywords : undefined })} /></div>
    </>,
    release: <div className="b-dds">
      <Drop label="When" opts={WHEN} value={when} set={(w) => setF({ when: w === 'any' ? undefined : w, ...(w !== 'years' ? { yearFrom: undefined, yearTo: undefined } : {}) })} />
      {when === 'years' && <Drop label="From" search opts={[[0, 'Any'], ...YEARS]} value={f.yearFrom || 0} set={(y) => setF({ yearFrom: y || undefined })} />}
      {when === 'years' && <Drop label="To" search opts={[[0, 'Any'], ...YEARS]} value={f.yearTo || 0} set={(y) => setF({ yearTo: y || undefined })} />}
      <Drop label="Decades" multi opts={DECADES} value={f.decades || []} set={(decades) => setF({ decades: decades.length ? decades : undefined })} />
      <Drop label="Out" opts={[['both', 'Out or coming'], ['out', 'Out now'], ['coming', 'Coming']]} value={f.released || 'both'} set={(released) => setF({ released })} />
      {films && <Drop label="How it came out" multi opts={OUT} value={f.out || []} set={(out) => setF({ out: out.length ? out : undefined })} />}
      {shows && <Drop label="Status" multi opts={STATUS} value={f.status || []} set={(status) => setF({ status: status.length ? status : undefined })} />}
      {shows && <Drop label="Type" multi opts={TV_TYPE} value={f.type || []} set={(type) => setF({ type: type.length ? type : undefined })} />}
      <Drop label={films && !shows ? 'Runtime from' : 'Length from'} opts={MINUTES} value={f.runtimeFrom || 0} set={(m) => setF({ runtimeFrom: m || undefined })} />
      <Drop label={films && !shows ? 'Runtime to' : 'Length to'} opts={MINUTES} value={f.runtimeTo || 0} set={(m) => setF({ runtimeTo: m || undefined })} />
      {films && reg && reg.certs.length > 0 && <Drop label="Age rating" opts={[['', 'Any'], ...reg.certs.map((c): [string, string] => [c, `Up to ${c}`])]}
        value={f.cert || ''} set={(cert) => setF({ cert: cert || undefined })} />}
    </div>,
    scores: <>
      <div className="pk-set b-quick">{PICKS.filter(([, , , need]) => !need || (keys?.[need] && (need === 'mal') === (d.media === 'anime' || d.media === 'animefilm'))).map(([n, icon, set]) => {
        const on = SCORED.every((k) => JSON.stringify(set[k] ?? null) === JSON.stringify(f[k] ?? null));
        return <PkBtn key={n} label={n} data={{}} face={icon} on={on} pressed={on}
          onClick={() => setF(Object.fromEntries(SCORED.map((k) => [k, on ? undefined : set[k]])) as Partial<Filters>)} />; })}
      </div>
      <div className="b-sliders">
        <Slider range label="TMDB score" steps={SCORE_STEPS} show={tenth} value={[f.scoreFrom, f.scoreTo]} set={([scoreFrom, scoreTo]) => setF({ scoreFrom, scoreTo })} />
        <Slider range label="Votes" steps={VOTE_STEPS} show={votesText} value={[f.votes, f.votesTo]} set={([votes, votesTo]) => setF({ votes, votesTo })} />
        {keys && SOURCES.filter(([, , , , need]) => !need || keys[need]).map(([k, n, st, unit]) =>
          <Slider key={k} label={n} steps={st} show={(v) => `${unit ? v : tenth(v)}${unit}`} value={f.ext?.[k]} set={(v) => setExt(k, v)} />)}
      </div>
      {floors > 0 && <div className="b-dds">
        <Drop label="Titles must meet" opts={[['all', 'All set scores'], ['any', 'Any set score']]} value={f.meet || 'all'} set={(meet) => setF({ meet: meet === 'all' ? undefined : meet })} />
        <Drop label="No score from a source" opts={[['out', 'Leave the title out'], ['keep', 'Keep it']]} value={f.missing || 'out'} set={(missing) => setF({ missing: missing === 'out' ? undefined : missing })} />
      </div>}
    </>,
    streaming: <>
      <div className="b-sec">
        <div className="b-h"><span className="dd-l">{`On · ${cname(region || undefined)}`}</span>
          {mineHere && <button type="button" className={`l-chip${f.my ? ' on' : ''}`} aria-pressed={!!f.my} onClick={() => setF({ my: !f.my || undefined })}>{`My services · ${prefs!.services.length}`}</button>}</div>
        {f.my ? null : reg ? <ServiceGrid services={reg.services} on={(id) => picked.includes(id)} toggle={(id) => setF({ services: picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id] })} />
          : <p className="acct-note">Loading the services…</p>}
      </div>
      <div className="b-dds"><Drop label="How" opts={[['flatrate', 'Subscription'], ['free', 'Free'], ['rent', 'Rent or buy']]} value={f.how || 'flatrate'} set={(how) => setF({ how })} />
        {shows && <Drop label="Made by" multi search opts={NETWORKS} value={f.networks || []} set={(networks) => setF({ networks: networks.length ? networks : undefined })} />}</div>
    </>,
    language: <div className="b-dds">
      {d.media !== 'anime' && d.media !== 'animefilm' && opts && <Drop label="Original language" multi search opts={opts.languages.map((l): [string, string] => [l.id, l.name])} value={langs}
        set={(v) => setF({ language: undefined, languages: v.length ? v : undefined })} />}
      {opts && <Drop label="Made in" multi search opts={opts.countries.map((c): [string, string] => [c.id, c.name])} value={lands} set={(v) => setF({ country: undefined, countries: v.length ? v : undefined })} />}
    </div>,
    people: <>
      {people && <div className="b-half"><SearchPick kind="person" label={d.media === 'both' ? 'Cast (films)' : 'Cast'} value={f.cast || []} set={(cast) => setF({ cast: cast.length ? cast : undefined })} /></div>}
      {people && (f.cast || []).length > 1 && <div className="b-half"><Drop label="Cast match" opts={[['any', 'Any of them'], ['all', 'All of them']]} value={f.castMatch || 'any'} set={(castMatch) => setF({ castMatch: castMatch === 'any' ? undefined : castMatch })} /></div>}
      {people && <div className="b-half"><SearchPick kind="person" label={d.media === 'both' ? 'Director, writer (films)' : 'Director and writer'} value={f.crew || []} set={(crew) => setF({ crew: crew.length ? crew : undefined })} /></div>}
      <div className="b-half"><SearchPick kind="company" label="Studios" canOut value={f.companies || []} set={(companies) => setF({ companies: companies.length ? companies : undefined })} /></div>
    </>,
    library: <>
      <div className="b-lines">
        <SwitchRow label="Hide what I’ve watched" on={!!f.hideWatched} set={(hideWatched) => setF({ hideWatched })} />
        <SwitchRow label="Hide what’s on Plan to watch" on={!!f.hidePlan} set={(hidePlan) => setF({ hidePlan })} />
        <SwitchRow label="Only what I’ve rated" on={!!f.onlyRated} set={(onlyRated) => setF({ onlyRated })} />
      </div>
      <div className="b-dds">
        <Drop label="My rating from" opts={MY} value={f.myFrom || 0} set={(x) => setF({ myFrom: x || undefined })} />
        <Drop label="My rating to" opts={MY} value={f.myTo || 0} set={(x) => setF({ myTo: x || undefined })} />
        <Drop label="Watched" opts={[['', 'Any'], ...WATCHED]} value={f.watched || ''} set={(w) => setF({ watched: w || undefined })} />
      </div>
    </>,
    sharing: <div className="b-lines">
      <SwitchRow label="Share with everyone on this Listick" on={!!d.shared} set={(shared) => setD({ ...d, shared })} />
    </div>,
  };
  return (
    <div className="look-scrim l-ov" onClick={(x) => { if (x.target === x.currentTarget) close(); }}>
      <div className="glass l-sheet" role="dialog" aria-modal="true" aria-labelledby="b-name">
        <div className="b-head">
          <div className="b-title"><label className="dd-l" htmlFor="b-name">{d.id ? 'Smart list' : 'New smart list'}</label>
            <input id="b-name" className="b-name" maxLength={60} value={d.name} placeholder="Name it" onChange={(x) => setD({ ...d, name: x.target.value })} />
            <input className="b-about" maxLength={200} value={d.description} placeholder="Add a line about it" aria-label="About" onChange={(x) => setD({ ...d, description: x.target.value })} /></div>
          <div className="pk-set"><PkBtn label="Cancel" data={{}} face={PATHS.cross} on={false} onClick={close} />
            <PkBtn label={busy ? 'Saving…' : d.id ? 'Save' : 'Make list'} data={{}} face={PATHS.tick} on onClick={() => { if (!busy) void save(); }} /></div>
        </div>
        <div className="b-tags">{tags.map(([grp, t, clear, no], i) => (
          <span key={i} className={`b-tag${no ? ' no' : ''}`}>{clear ? <button type="button" onClick={() => setG(grp)}>{t}</button> : t}
            {clear && <button type="button" className="b-x" aria-label={`Remove ${t}`} onClick={clear}><Icon d={PATHS.cross} size={12} width={2.2} /></button>}</span>))}</div>
        {e && <p className="acct-err b-err">{e}</p>}
        <div className="b-body">
          <nav className="b-nav" aria-label="List options">{GROUPS.map(([k, n, ic]) => (
            <button key={k} type="button" className={`b-tab${g === k ? ' on' : ''}`} aria-current={g === k} onClick={() => setG(k)}>
              <span className="pk-c"><Icon d={ic} size={18} width={1.9} /></span><span className="b-tn">{n}</span>{count(k) > 0 && <span className="b-n">{count(k)}</span>}</button>))}</nav>
          <div className="b-pane">{pane[g]}</div>
          {/* on a phone the preview is a bar at the foot, all of it the button that opens the posters over the settings: the first
              three stacked as on the list cards, the count, a chevron; the scores' progress a line along its top */}
          <aside className={`b-prev${seeing ? ' open' : ''}`}>
            <div className="b-ph"><span className="dd-l">Preview</span><span className={`b-pn${loading ? ' busy' : ''}`}>{said}</span></div>
            <button type="button" className="b-see" aria-expanded={seeing} aria-label={`${said}: ${seeing ? 'hide' : 'see'} the titles`} onClick={() => setSeeing(!seeing)}>
              <span className="l-stack">{prev?.posters.slice(0, 3).map((t) => t.poster && <img key={t.key} src={t.poster} alt="" />)}</span>
              <span className={`b-sn${loading ? ' busy' : ''}`}>{said}</span><Icon d="M6 15l6-6 6 6" size={20} width={1.9} />
            </button>
            {prev && floors > 0 && prev.pool > 0 && <div className="b-check"><span>scores checked</span><span>{`${prev.pool - prev.pending} / ${prev.pool}`}</span>
              <i style={{ width: `${prev.pool ? Math.round(((prev.pool - prev.pending) / prev.pool) * 100) : 0}%` }} /></div>}
            <div className="l-pgrid">{prev?.posters.map((t) => <img key={t.key} src={t.poster || undefined} alt={t.title} title={t.title} loading="lazy" />)}</div>
          </aside>
        </div>
      </div>
    </div>
  );
}
