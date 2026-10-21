// Titles in a user's language (Settings › Region & services › Titles in): each TMDB title's name, poster and overview in that
// language, asked of TMDB once and kept in title_names for 60 days. A card shown before its name is here keeps the stored
// (English) one, and the missing names are fetched in the background, a few at a time, so the next look has them
import { q } from './db';
import { TMDB_IMG, tmdb } from './sources';
import { HOUR } from './util';

type Name = { title: string | null; poster: string | null; overview: string | null };
const FRESH = 60 * 24 * HOUR;
// each user's language, for a minute (every card list asks)
const langs = new Map<string, { lang: string | null; at: number }>();
export async function langOf(uid: string | null) {
  if (!uid) return null;
  const c = langs.get(uid);
  if (c && Date.now() - c.at < 60000) return c.lang;
  const lang = (await q.one<{ lang: string | null }>('select lang from profiles where user_id = ?', uid))?.lang || null;
  langs.set(uid, { lang, at: Date.now() });
  return lang;
}
export const forgetLang = (uid: string) => langs.delete(uid);

const pending = new Set<string>();   // `${lang}|${key}` being fetched in this process
// TMDB's translation into that language and a poster made for it, each only where TMDB has one (asked plainly, it falls back
// to the original language's title: a Tamil film's in Tamil)
async function fetchName(key: string, lang: string) {
  const [, type, id] = key.split(':');
  type T = { iso_639_1: string; data: { title?: string; name?: string; overview?: string } };
  const d = await tmdb<{ translations?: { translations: T[] }; images?: { posters: { file_path: string }[] } }>(
    `/${type}/${id}?language=${lang}&append_to_response=translations,images&include_image_language=${lang}`);
  const t = d.translations?.translations.find((x) => x.iso_639_1 === lang)?.data;
  await q.run(`insert into title_names (key, lang, title, poster, overview, fetched_at) values (?, ?, ?, ?, ?, ?)
    on conflict (key, lang) do update set title = excluded.title, poster = excluded.poster, overview = excluded.overview, fetched_at = excluded.fetched_at`,
    key, lang, t?.title || t?.name || null, d.images?.posters[0]?.file_path || null, t?.overview || null, Date.now());
}
function fill(keys: string[], lang: string) {
  const todo = keys.filter((k) => !pending.has(`${lang}|${k}`)).slice(0, 200);
  if (!todo.length) return;
  for (const k of todo) pending.add(`${lang}|${k}`);
  void (async () => {
    for (let i = 0; i < todo.length; i += 4)
      await Promise.all(todo.slice(i, i + 4).map((k) => fetchName(k, lang).catch((e) => console.error(`names ${k}: ${e}`)).finally(() => pending.delete(`${lang}|${k}`))));
  })();
}
// the names known for keys in a language (TMDB titles only); the missing or old ones are fetched in the background
export async function namesOf(keys: string[], lang: string | null): Promise<Map<string, Name>> {
  const out = new Map<string, Name>(), want = [...new Set(keys.filter((k) => /^tmdb:(movie|tv):\d+$/.test(k)))];
  if (!lang || !want.length) return out;
  const stale: string[] = [];
  for (const r of await q.all<Name & { key: string; fetched_at: number }>('select key, title, poster, overview, fetched_at from title_names where lang = ? and key = any(?)', lang, want)) {
    out.set(r.key, r);
    if (Date.now() - r.fetched_at > FRESH) stale.push(r.key);
  }
  fill([...want.filter((k) => !out.has(k)), ...stale], lang);
  return out;
}
export const posterAt = (path: string | null, size: 'w342' | 'w780') => (path ? `${TMDB_IMG}${size}${path}` : null);
