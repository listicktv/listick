// Talking to Listick's /api: the session (a cookie, plus a header token every write carries), reads and writes. A 401 anywhere
// means signed out, announced on `signedOut` so the page can show the sign-in card.
export type Me = { id: string; name: string; firstName: string | null; admin: boolean };

let token = '';
export const signedOut = new EventTarget();
const announceSignedOut = () => signedOut.dispatchEvent(new Event('signedout'));

// who you are: { me } (and the write token) when signed in, else { me: null } and whether this instance has no account yet
export async function session(): Promise<{ me: Me | null; setup?: boolean }> {
  const r = await fetch('/api/session', { method: 'POST', credentials: 'same-origin' }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  if (r?.ok) { token = j.csrf; return { me: j.user }; }
  return { me: null, setup: !!j.setup };
}
export const setToken = (t: string) => { token = t; };
export const clearToken = () => { token = ''; };
async function getToken() {
  if (!token) await session();
  return token;
}

// a read: its JSON, or an error (signed out announced)
export async function getJ<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (r.status === 401) { announceSignedOut(); throw new Error('signed out'); }
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error || String(r.status));
  return b as T;
}

// a write: null when it worked, else the error to show; a stale token is fetched again once; reply gets the answer's fields
export async function postJ(url: string, body: unknown = {}, reply?: Record<string, unknown>): Promise<string | null> {
  try {
    const send = async () => fetch(url, { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-listick-token': await getToken() }, body: JSON.stringify(body) });
    let r = await send();
    if (r.status === 403) { token = ''; r = await send(); }
    if (r.status === 401) { announceSignedOut(); return 'Signed out: sign in again'; }
    const b = await r.json().catch(() => ({}));
    if (reply) Object.assign(reply, b);
    return r.ok ? null : (b.error || b.result || `HTTP ${r.status}`);
  } catch (e) { return e instanceof Error ? e.message : String(e); }
}

// the sign-in card's settings: this instance's name, the captcha's site key, whether email works
export type Config = { name: string; captcha: string | null; mail: boolean; weather: boolean };
let config: Promise<Config> | null = null;
export const getConfig = () => config || (config = fetch('/api/config').then((r) => r.json()).catch(() => ({ name: 'Listick', captcha: null, mail: false, weather: false })));
