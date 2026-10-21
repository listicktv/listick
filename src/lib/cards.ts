// One card per title: the newest wins. Cards with ids (Continue watching: Kitsu -> IMDb, from Listick) match by id, as names
// differ and repeat; the others by name. Shared by the page's rows and the server's count of what's waiting.
type Card = { ids?: string[]; title: string; at: number };
const titleKey = (t: string) => t.toLowerCase().replace(/\(\d{4}\)|season \d+|\bs\d+\b|[^a-z0-9]/g, '');
const sameTitle = (a: Card, b: Card) => (a.ids?.length && b.ids?.length ? a.ids.some((id) => b.ids!.includes(id)) : titleKey(a.title) === titleKey(b.title));
export function oneCardPerTitle<T extends Card>(list: T[]): T[] {
  const best: T[] = [];
  for (const x of list) {
    const i = best.findIndex((y) => sameTitle(x, y)), cur = best[i];
    if (!cur) { best.push(x); continue; }
    const ids = cur.ids || x.ids ? [...new Set([...(cur.ids || []), ...(x.ids || [])])] : undefined;   // a later card may match either
    best[i] = { ...(x.at > cur.at ? x : cur), ids };
  }
  return best.sort((a, b) => b.at - a.at);
}
