// Kitsu: a user's public anime library, read by username from Kitsu's API (Kitsu is Listick's anime source; no file needed). Each
// entry becomes a MalEntry on its Kitsu id, so the MyAnimeList import's rules apply (episodes as plays, the score, Plan to Watch)
import { kitsu } from '../sources';
import type { KitsuList } from '../types';
import type { MalEntry } from './files';

type LibAttrs = { status?: string; progress?: number; ratingTwenty?: number | null; startedAt?: string | null; finishedAt?: string | null };
// Kitsu's statuses in MyAnimeList's words, as the MAL import reads them
const STATUS: Record<string, string> = { current: 'Watching', planned: 'Plan to Watch', completed: 'Completed', on_hold: 'On-Hold', dropped: 'Dropped' };
export async function kitsuLibrary(name: string): Promise<MalEntry[]> {
  // a username, @username or the profile's address
  const who = name.trim().replace(/^@/, '').replace(/^https?:\/\/kitsu\.(app|io)\/users\//, '').split('/')[0];
  if (!who) throw new Error('your Kitsu username');
  const find = (f: string) => kitsu<KitsuList>(`/users?filter[${f}]=${encodeURIComponent(who)}`).then((r) => r.data[0], () => undefined);
  const user = (await find('slug')) || (await find('name'));
  if (!user) throw new Error(`there's no Kitsu user "${who}"`);
  const out: MalEntry[] = [];
  for (let offset = 0; offset < 10000; offset += 500) {
    const page = await kitsu<KitsuList>(`/library-entries?filter[userId]=${user.id}&filter[kind]=anime&include=anime&fields[anime]=slug&page[limit]=500&page[offset]=${offset}`);
    for (const e of page.data) {
      const a = e.attributes as LibAttrs, id = Number(e.relationships?.anime?.data?.id);
      if (id) out.push({ mal: 0, kitsu: id, title: '', episodes: 0, watched: a.progress || 0, score: a.ratingTwenty ? a.ratingTwenty / 2 : null,
        status: STATUS[a.status || ''] || '', started: a.startedAt?.slice(0, 10) || null, finished: a.finishedAt?.slice(0, 10) || null });
    }
    if (page.data.length < 500) break;
  }
  return out;
}
