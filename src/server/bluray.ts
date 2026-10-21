// Blu-ray.com's new disc releases, from its New Releases RSS feed (its legal notice allows fetching its feeds automatically,
// not crawling the site): each disc matched to its title on TMDB and kept (meta 'bluray'), newest first, so a smart list can
// reach past the feed's last 40. A 4K disc says so in its name ("… 4K (Blu-ray)")
import { USER_AGENT, tmdb } from './sources';
import { metaGet, metaSet } from './store';
import { fromTmdb, saveTitles } from './titles';
import type { TmdbPage } from './types';

type Disc = { id: string; key: string | null; title: string; year: number | null; date: number; uhd: boolean; url: string };
const FEED = 'https://www.blu-ray.com/rss/newreleasesfeed.xml';
const KEEP = 2000;
const text = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

export const discs = async () => (await metaGet<{ at: number; discs: Disc[] }>('bluray'))?.discs || [];

// the feed's discs not seen before, matched and added in front of the ones kept; how many were new
export async function refreshDiscs() {
  const res = await fetch(FEED, { headers: { 'user-agent': USER_AGENT() }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`blu-ray.com feed: ${res.status}`);
  const xml = await res.text(), kept = await discs(), seen = new Set(kept.map((d) => d.id)), fresh: Disc[] = [];
  for (const item of xml.match(/<item>[\s\S]*?<\/item>/g) || []) {
    const tag = (n: string) => text((item.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`)) || [])[1] || '');
    const url = tag('link'), id = (url.match(/\/(\d+)\/?$/) || [])[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    // "Masters of the Universe 4K (Blu-ray)"; its description: "Studio | 2026 | 140 mins | Rated PG-13 | Oct 20, 2026…"
    const raw = tag('title'), about = tag('description');
    const name = raw.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+4K$/i, '').trim();
    const year = Number((about.match(/\|\s*((?:19|20)\d{2})\s*\|/) || [])[1]) || null;
    const date = Date.parse((about.match(/\b([A-Z][a-z]{2} \d{1,2}, \d{4})/) || [])[1] || '') || Date.now();
    fresh.push({ id, key: await match(name, year), title: name, year, date, uhd: /\b4K\b/.test(raw), url });
  }
  if (fresh.length || !kept.length) await metaSet('bluray', { at: Date.now(), discs: [...fresh, ...kept].slice(0, KEEP) });
  return fresh.length;
}

// a disc on TMDB: a season or series set is its show; anything else the film of that year, then of any year
async function match(name: string, year: number | null) {
  const show = name.match(/^(.*?)(?::\s*|\s+-\s+)(?:Season|Series|The Complete)\b/i);
  const type = show ? 'tv' : 'movie', query = encodeURIComponent(show ? show[1] : name);
  for (const y of type === 'movie' && year ? [`&year=${year}`, ''] : ['']) {
    const hit = (await tmdb<TmdbPage>(`/search/${type}?query=${query}${y}`).catch(() => null))?.results?.[0];
    if (hit) return (await saveTitles([fromTmdb(type)(hit)]))[0]?.key ?? null;
  }
  return null;
}
