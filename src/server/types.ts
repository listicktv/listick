// Shapes the server code works with: Listick's own rows and answers, and the parts of each outside API it reads (only the
// fields used; every outside field is optional unless the API always sends it).

// ---------- Listick ----------
export type TitleType = 'movie' | 'tv' | 'anime';
// whose data: a user's id, or null for no one (a title looked up while tracking)
export type Uid = string | null;
// a titles row; on its way in, genres are JSON text (see genreJson), stored they come back as an array
export interface Title {
  key: string; type: TitleType; title: string; label: string | null; year: number | null; poster: string | null; backdrop: string | null;
  rating: number | null; rating_src: string | null; overview: string | null; url: string | null; fetched_at: number;
  anime: number | null; episodes: number | null; genres: string[] | string | null;
  runtime?: number | null;   // in a stored row (the runtimes job fills it); not in one just made from TMDB
  anime_genres?: string[] | null;   // likewise, by the anime-genres job
}
// a Kitsu entry before fillFromTmdb: its other names and whether one of them is English
export interface KitsuTitle extends Title { alt?: string[]; english?: boolean }

// Better Auth's user row with Listick's profile, in the old app's shape (USER_SQL)
export interface User {
  id: string; name: string; first_name: string | null; email: string | null; created_at: number; admin: boolean;
  stremio_key: string | null; stremio_user: string | null; tracking_since: number | null;
}

// a title as a card on the page
export interface View {
  key: string; type: TitleType; title: string; label: string | null; year: number | null; poster: string | null; backdrop: string | null;
  rating: number | null; ratingSrc: string | null; url: string | null; watchlist: boolean; watched: number; mine: number | null;
  progress: number | null; lastAt: number | null; next: string | null;
}
export interface Card extends View { note: string | null; date: string | null; what: string | null }
export interface ForYou { suggested: Card[]; coming: Card[] }

// where a Stremio episode sits on TMDB / Kitsu
export interface Place { key: string; se: number; ep: number }
export interface PlacedVideo extends Place { type: TitleType; title: string; label: string | null; poster: string | null; backdrop: string | null }

export interface Omdb {
  imdb: string | null; votes: string | null; rt: string | null; mc: string | null; awards: string | null; rated: string | null;
  pages?: { rt: string | null; mc: string | null };
}
export interface Season { n: number; name: string; episodes: number | null; year: number | null }
export interface Provider { name: string; logo: string | null }
// a title's card (the panel) as kept in detail_cache: TMDB's or Kitsu's details
export interface Detail {
  key: string; type: TitleType; title: string; label: string | null; year: number | null; poster: string | null; backdrop: string | null;
  rating: number | null; ratingSrc: string | null; overview: string | null; url: string | null;
  genres: string[]; runtime: number | null; released: string | null; status: string | null; tagline: string | null;
  seasons: Season[] | null; next: { season?: number; ep?: number; date: string | null } | null;
  people: { label: string; names: string[] } | null;
  cast: { name: string | undefined; role: string | null; photo: string | null }[];
  providers: { stream: Provider[]; free: Provider[]; rent: Provider[]; buy: Provider[] } | null;
  imdb: string | null; tvdb?: number | null; scores?: Omdb | null; collection?: { id: number; name: string } | null;
  certification: string | null; trailer: string | null; writers?: string[]; money?: { budget: number | null; revenue: number | null };
  collectionKeys?: string[]; similarKeys: string[]; anime?: boolean;
  mal?: { score: number | null; rank: number | null; url: string };
  // an anime's Kitsu score beside MyAnimeList's (0-10)
  kitsu?: { score: number | null; url: string };
  // an anime card's version (details.ts ANIME_V): an older one is made again
  v?: number;
  facts: Record<string, string | number | null>;
  episodes?: number | null; format?: string | null; malUrl?: string | null;
}
export interface Episode { ep: number; name: string | null; air: string | null; runtime: number | null; still: string | null; overview: string | null; tvdb?: boolean; se?: number; tep?: number }

import type { AirEp, UpNext } from './upnext';

// ---------- the live source (live.ts): what the worker sees in Stremio ----------
// an episode in Stremio's lists; anime are counted from the first episode (season null)
export interface StremioEp { title?: string; season: number | null; ep: number | null; at?: number; dayOnly?: boolean; poster?: string | null }
export interface StremioCard extends StremioEp { title: string; type: string; poster: string | null; url: string; id: string; at: number }
export interface ContinueCard extends StremioCard {
  video?: string | null; pct: number; resume?: boolean; airedAt?: number; nextAir?: StremioEp | null;
  place?: PlacedVideo | null; ids?: string[];
}
export interface StremioObserve { id: string; type: string; video: string | null; watched: number; duration: number; at: number; full: boolean; seen: string | null }
export interface StremioLive {
  history: StremioCard[]; last: StremioCard | null; continue: ContinueCard[];
  now: StremioEp | null; watched7: number; observe: StremioObserve[];
}
// live_state's value: the sources without their raw observations, and For you
export interface LiveValue { stremio: Omit<StremioLive, 'observe'> | null; forYou: ForYou | null; upNext?: UpNext[]; schedule?: AirEp[] }

// ---------- TMDB ----------
export interface TmdbItem {
  id: number; title?: string; name?: string; release_date?: string; first_air_date?: string; poster_path?: string | null;
  backdrop_path?: string | null; vote_average?: number; overview?: string; original_language?: string; genre_ids?: number[];
  genres?: { id: number; name: string }[]; seasons?: TmdbSeason[]; media_type?: string; origin_country?: string[];
}
export interface TmdbSeason { season_number: number; episode_count: number; name?: string; air_date?: string | null }
export interface TmdbEpisodeRef { season_number: number; episode_number: number; air_date?: string | null; runtime?: number | null }
interface TmdbProvider { provider_id: number; provider_name: string; logo_path?: string | null }
export interface TmdbProviders { flatrate?: TmdbProvider[]; free?: TmdbProvider[]; ads?: TmdbProvider[]; rent?: TmdbProvider[]; buy?: TmdbProvider[] }
export interface TmdbVideo { site: string; type: string; key: string; official: boolean; iso_639_1?: string }
export interface TmdbDetails extends TmdbItem {
  'watch/providers'?: { results?: Record<string, TmdbProviders> };
  credits?: { crew?: { job: string; name: string }[]; cast?: { name: string; character?: string; profile_path?: string | null }[] };
  runtime?: number; episode_run_time?: number[]; status?: string; tagline?: string;
  next_episode_to_air?: TmdbEpisodeRef | null; last_episode_to_air?: TmdbEpisodeRef | null; created_by?: { name: string }[];
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | null }; imdb_id?: string | null;
  belongs_to_collection?: { id: number; name: string } | null; networks?: { name: string }[]; production_companies?: { name: string }[];
  origin_country?: string[]; production_countries?: { iso_3166_1: string }[]; last_air_date?: string | null; number_of_episodes?: number | null;
  videos?: { results?: TmdbVideo[] }; recommendations?: { results?: TmdbItem[] };
  content_ratings?: { results?: { iso_3166_1: string; rating: string }[] };
  release_dates?: { results?: TmdbReleaseDates[] }; budget?: number; revenue?: number;
}
export interface TmdbReleaseDates { iso_3166_1: string; release_dates: { certification: string }[] }
export interface TmdbPage { results: TmdbItem[] }
export interface TmdbFind {
  movie_results?: TmdbItem[]; tv_results?: TmdbItem[];
  tv_episode_results?: { show_id: number; season_number: number; episode_number: number }[];
}
export interface TmdbSeasonDetails {
  episodes?: { episode_number: number; name?: string; air_date?: string | null; runtime?: number | null; still_path?: string | null; overview?: string }[];
}
export interface TmdbCollection { parts?: TmdbItem[] }
export interface TmdbWatchProviders { results?: Record<string, TmdbProviders> }

// ---------- Kitsu (JSON:API): one loose resource shape for anime, episodes, mappings, categories, producers, characters ----------
interface KitsuImage { medium?: string; large?: string; original?: string }
export interface KitsuAttrs {
  titles?: { en?: string; en_jp?: string; en_us?: string }; canonicalTitle?: string; startDate?: string | null; endDate?: string | null;
  posterImage?: KitsuImage | null; coverImage?: KitsuImage | null; averageRating?: string | null; synopsis?: string | null; slug?: string;
  episodeCount?: number | null; episodeLength?: number | null; status?: string; subtype?: string; nextRelease?: string | null;
  youtubeVideoId?: string | null;
  // episodes
  number?: number | null; airdate?: string | null; length?: number | null; thumbnail?: KitsuImage | null;
  // mappings, categories, producers, productions, characters
  externalSite?: string; externalId?: string; title?: string; name?: string; role?: string;
  canonicalName?: string; names?: { en?: string }; image?: KitsuImage | null;
}
export interface KitsuResource { id: string; type: string; attributes: KitsuAttrs; relationships?: Record<string, { data?: { id: string } | null }> }
export interface KitsuList { data: KitsuResource[]; included?: KitsuResource[]; meta?: { count?: number } }
export interface KitsuOne { data: KitsuResource; included?: KitsuResource[] }

// ---------- MyAnimeList ----------
export interface MalNode {
  id: number; title: string; alternative_titles?: { en?: string }; main_picture?: { large?: string; medium?: string }; mean?: number;
  start_season?: { year: number; season: string }; genres?: { name: string }[]; media_type?: string; num_list_users?: number;
  start_date?: string; rating?: string;
}
export interface MalList { data: { node: MalNode }[] }
export interface MalAnime extends Partial<MalNode> {
  rank?: number; source?: string; studios?: { name: string }[]; recommendations?: { node: MalNode }[];
}

// ---------- Fribb's anime-lists ----------
export interface FribbEntry {
  kitsu_id?: number; anilist_id?: number; mal_id?: number; type?: string; imdb_id?: string | string[];
  themoviedb_id?: { tv?: number; movie?: number | number[] }; season?: { tmdb?: number; tvdb?: number }; episode_offset?: { tmdb?: number };
}
// where a Kitsu entry sits on TMDB: a film, a season from an episode offset, or a whole show counted from its first episode
export type TmdbAt = { type: 'movie' | 'tv'; id: number; season?: number; offset?: number; abs?: boolean };

// ---------- Stremio ----------
export interface CinemetaVideo { id: string; season: number; episode?: number; number?: number; released?: string; tvdb_id?: number }
