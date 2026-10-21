// Countries as TMDB knows them (those with streaming data), each one's streaming services and movie age ratings, kept a week;
// and each user's country, the services they pay for and the language they want titles in (Settings › Region & services)
import { q } from './db';
import { tmdb } from './sources';
import { metaGet, metaSet } from './store';
import { forgetLang } from './names';
import { HOUR } from './util';

type Country = { id: string; name: string };
type Service = { id: number; name: string; logo: string | null };
const WEEK = 7 * 24 * HOUR;
async function kept<T>(k: string, make: () => Promise<T>) {
  const c = await metaGet<{ at: number; v: T }>(k);
  if (c && Date.now() - c.at < WEEK) return c.v;
  const v = await make();
  await metaSet(k, { at: Date.now(), v });
  return v;
}

// applied after the week's cache, so a renamed country shows at once
const SHORT: Record<string, string> = { US: 'United States' };
const short = (c: Country): Country => (SHORT[c.id] ? { ...c, name: SHORT[c.id] } : c);
export const countries = async () => (await kept('tmdb-regions', async () =>
  (await tmdb<{ results: { iso_3166_1: string; english_name: string }[] }>('/watch/providers/regions')).results
    .map((r) => ({ id: r.iso_3166_1, name: r.english_name })).sort((a, b) => a.name.localeCompare(b.name)))).map(short);
// the builder's full lists: every language (original language) and every country (made in), by English name
export const options = async () => {
  const o = await kept('tmdb-options', async () => {
  const name = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const langs = (await tmdb<{ iso_639_1: string; english_name: string }[]>('/configuration/languages')).filter((l) => l.iso_639_1 !== 'xx').map((l) => ({ id: l.iso_639_1, name: l.english_name })).sort(name);
  const lands = (await tmdb<{ iso_3166_1: string; english_name: string }[]>('/configuration/countries')).map((c) => ({ id: c.iso_3166_1, name: c.english_name })).sort(name);
  return { languages: langs, countries: lands };
  });
  return { ...o, countries: o.countries.map(short) };
};
export const isCountry = async (cc: unknown): Promise<boolean> => typeof cc === 'string' && (await countries()).some((c) => c.id === cc);

// a country's services (movies' and shows' together, in TMDB's order for that country) and its movie age ratings, mildest
// first (TMDB's show search has no age-rating filter)
export const regionOf = (cc: string) => kept(`tmdb-region:${cc}`, async () => {
  type P = { provider_id: number; provider_name: string; logo_path: string | null; display_priorities?: Record<string, number> };
  const [m, t] = await Promise.all((['movie', 'tv'] as const).map((k) => tmdb<{ results: P[] }>(`/watch/providers/${k}?watch_region=${cc}`)));
  const by = new Map<number, P>();
  for (const p of [...m.results, ...t.results]) if (!by.has(p.provider_id)) by.set(p.provider_id, p);
  const services: Service[] = [...by.values()].sort((a, b) => (a.display_priorities?.[cc] ?? 999) - (b.display_priorities?.[cc] ?? 999))
    .map((p) => ({ id: p.provider_id, name: p.provider_name, logo: p.logo_path ? `https://image.tmdb.org/t/p/w92${p.logo_path}` : null }));
  const certs = (await tmdb<{ certifications: Record<string, { certification: string; order: number }[]> }>('/certification/movie/list')).certifications[cc] || [];
  return { services, certs: certs.sort((a, b) => a.order - b.order).map((c) => c.certification) };
});

export async function prefsOf(uid: string) {
  const r = await q.one<{ country: string | null; services: number[] | null; lang: string | null }>('select country, services, lang from profiles where user_id = ?', uid);
  return { country: r?.country ?? null, services: r?.services ?? [], lang: r?.lang ?? null };
}
// a country (one TMDB knows) and the services, either or both; a new country drops services it doesn't have
// lang: titles in a TMDB language ('' or 'en': as stored, English)
export async function setPrefs(uid: string, b: { country?: unknown; services?: unknown; lang?: unknown }) {
  const cur = await prefsOf(uid);
  if (b.country !== undefined && !(await isCountry(b.country))) return { error: 'a country' };
  const lang = b.lang === undefined ? cur.lang : b.lang === '' || b.lang === 'en' ? null : b.lang;
  if (lang && !(await options()).languages.some((l) => l.id === lang)) return { error: 'a language' };
  const country = (b.country as string | undefined) ?? cur.country;
  let services = b.services === undefined ? cur.services : b.services;
  if (!Array.isArray(services) || services.length > 200 || !services.every((x) => Number.isInteger(x))) return { error: 'services' };
  if (country) { const have = new Set((await regionOf(country)).services.map((s) => s.id)); services = services.filter((x) => have.has(x)); }
  await q.run(`insert into profiles (user_id, country, services, lang) values (?, ?, ?::jsonb, ?)
    on conflict (user_id) do update set country = excluded.country, services = excluded.services, lang = excluded.lang`, uid, country, JSON.stringify(services), lang);
  forgetLang(uid);
  return { country, services, lang };
}
