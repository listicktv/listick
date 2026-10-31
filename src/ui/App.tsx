'use client';
// Listick's page as React. This root holds who's signed in, whether Appearance's sheet is open, the sign-in card and the
// page (Home, a kind's page, Lists, Stats or Settings), and starts things off:
// an emailed or invite link opens its own form, otherwise the session decides (sign in, or the page).
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { Home } from './Home';
import { clearToken, getConfig, postJ, session, signedOut, type Me } from './lib/api';
import { Footer, PAGES, PhoneTabs, Rail, TopBar } from './Shell';
import type { SignInState } from './SignIn';

const Lists = dynamic(() => import('./Lists').then((m) => m.Lists));
const ListPage = dynamic(() => import('./Lists').then((m) => m.ListPage));
const RowPage = dynamic(() => import('./Shelf').then((m) => m.RowPage));
const Stats = dynamic(() => import('./Stats').then((m) => m.Stats));
const Calendar = dynamic(() => import('./Calendar').then((m) => m.Calendar));
const Settings = dynamic(() => import('./Settings').then((m) => m.Settings));
const SignIn = dynamic(() => import('./SignIn').then((m) => m.SignIn));
const AddToList = dynamic(() => import('./AddToList').then((m) => m.AddToList));
const Appearance = dynamic(() => import('./Appearance').then((m) => m.Appearance));

type Sheet = { from: HTMLElement | null } | null;
type AppState = {
  me: Me | null;
  signIn: SignInState | null; showSignIn: (s?: SignInState) => void; signedIn: (me: Me) => void;
  look: Sheet; openLook: (from: HTMLElement | null) => void; closeLook: () => void;
  // the Settings page, on a section (its id: account, import…)
  openSettings: (section?: string) => void;
  // the account button's second tap arms sign-out for 3 s (it turns red with a sign-out icon); a tap then signs out
  armed: boolean; tapAcct: () => void; signOut: () => Promise<void>;
  // the side menu's name: a tap arms sign-out for 3 s, a tap then signs out
  armOut: () => void;
  // Listick isn't answering: the page keeps its last data and says so under the top bar
  setOffline: (on: boolean) => void;
  updateMe: (change: Partial<Me>) => void;
  // a new account is offered its imports: Settings opens on them with a welcome and Start fresh
  welcome: boolean; setWelcome: (on: boolean) => void;
  // the top bar's search: the titles it finds show above the page
  q: string; setQ: (q: string) => void;
};
const Ctx = createContext<AppState | null>(null);
export const useApp = () => useContext(Ctx)!;

export function App({ children }: { children?: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [signIn, setSignIn] = useState<SignInState | null>(null);
  const [look, setLookSheet] = useState<Sheet>(null);
  const [armed, setArmed] = useState(false);
  const [offline, setOffline] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [q, setQ] = useState('');
  const armedT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const path = usePathname(), kind = PAGES.find((p) => p.href === path)?.kind ?? null, router = useRouter();

  const disarm = useCallback(() => { if (armedT.current) clearTimeout(armedT.current); armedT.current = null; setArmed(false); }, []);
  const cards = useRef(0);   // each sign-in shown is a new card (its key), so it starts with empty fields
  const showSignIn = useCallback((s: SignInState = { mode: 'login' }) => { setSignIn({ ...s, id: ++cards.current }); setLookSheet(null); }, []);
  const openSettings = useCallback((section?: string) => { setLookSheet(null); router.push(`/settings${section ? `/${section}` : ''}`); }, [router]);
  // a new account is offered its imports: Home's Get started leads there, and Import greets it with Start fresh
  const offerImports = useCallback(async () => {
    const im = await fetch('/api/import', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (im?.onboard) setWelcome(true);
  }, []);
  const signedIn = useCallback((u: Me) => {
    setMe(u); setSignIn(null);
    history.replaceState(null, '', location.pathname);   // an invite or reset link is used up
    void offerImports();
  }, [offerImports]);
  const signOut = useCallback(async () => {
    disarm(); await postJ('/api/logout'); clearToken(); setMe(null); showSignIn();
  }, [disarm, showSignIn]);
  // the account button: Settings (signed out: the sign-in); armed by the side menu's name, a tap signs out
  const tapAcct = useCallback(() => {
    if (!me) return showSignIn();
    if (armedT.current) { void signOut(); return; }
    openSettings();
  }, [me, showSignIn, signOut, openSettings]);
  const armOut = useCallback(() => {
    if (armedT.current) { void signOut(); return; }
    setLookSheet(null); setArmed(true); armedT.current = setTimeout(disarm, 3000);
  }, [signOut, disarm]);

  // a 401 anywhere: the sign-in card
  useEffect(() => {
    const out = () => { clearToken(); setMe(null); showSignIn(); };
    signedOut.addEventListener('signedout', out);
    return () => signedOut.removeEventListener('signedout', out);
  }, [showSignIn]);
  // the tab's title is this instance's name (APP_NAME), a setting read at runtime; set again after each move, which resets it
  useEffect(() => { void getConfig().then((c) => { document.title = c.name; }); }, [path]);
  // the page behind the card is hidden while it shows (style.css: body.signed-out)
  useEffect(() => { document.body.classList.toggle('signed-out', !!signIn); }, [signIn]);
  useEffect(() => {
    void linkMode(showSignIn).then(async (link) => {
      if (link) return;
      const s = await session();
      if (!s.me) { showSignIn({ mode: s.setup ? 'setup' : 'login' }); return; }
      setMe(s.me); void offerImports();
    });
  }, [showSignIn, offerImports]);
  // Esc puts a sheet away (unless something in it used the key: an edit in Account leaves the edit); / goes to the search.
  // React's own handlers sit on the document too, so theirs can't stop this one: they mark the key used instead
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') setLookSheet(null);
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName || '')) { e.preventDefault(); document.getElementById('q')?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);

  const state: AppState = { me, signIn, showSignIn, signedIn, look, openLook: (from) => setLookSheet({ from }),
    closeLook: () => setLookSheet(null), openSettings,
    armed, tapAcct, armOut, signOut, setOffline, updateMe: (change) => setMe((m) => (m ? { ...m, ...change } : m)), welcome, setWelcome, q, setQ };
  // the footer after a fixed gap, whatever comes last before it (often a section that's hidden)
  const view = (body: ReactNode) => <section className="view" id="view-media">{body}{children}<div className="foot-gap" aria-hidden="true" /><Footer /></section>;
  return (
    <Ctx.Provider value={state}>
      <Rail />
      <div className="wall">
        {/* browse: Movies, TV or Anime, whose carousel runs up under the search (style.css) */}
        <div className={`page${kind ? ' browse' : ''}`}>
          <TopBar />
          <div className="offline" id="offline" role="status" hidden={!offline}><span className="dot bad" /><span>Listick isn&apos;t answering; showing the last data.</span></div>
          {me ? (path === '/lists' ? view(<Lists />) : path.startsWith('/lists/') ? view(<ListPage key={path} id={decodeURIComponent(path.slice(7))} />)
            : path.startsWith('/row/') ? view(<RowPage key={path} id={decodeURIComponent(path.slice(5))} />) : path === '/stats' ? view(<Stats />) : path === '/calendar' ? view(<Calendar />) : path.startsWith('/settings') ? view(<Settings />) : <Home view={view} kind={kind} />) : view(null)}
        </div>
      </div>
      <PhoneTabs />
      <Appearance />
      {me && <AddToList />}
      {signIn && <SignIn key={signIn.id} />}
    </Ctx.Provider>
  );
}

// a link opened from an email or an invite: ?reset=… / ?invite=… / ?forgot; back from a confirmation link (?verified, signed in,
// or with ?error= when it was used or ran out); and after deleting your account (?deleted). True when it opened a form
async function linkMode(show: (s: SignInState) => void) {
  const q = new URLSearchParams(location.search);
  if (q.has('verified')) {
    history.replaceState(null, '', location.pathname);
    if (!q.get('error')) return false;
    show({ mode: 'login', err: "This confirmation link is used or has run out: sign in and we'll send a new one." });
    return true;
  }
  if (q.has('deleted')) {
    history.replaceState(null, '', location.pathname);
    show({ mode: 'login', sub: 'Your account and everything in it are deleted.' });
    return true;
  }
  if (q.get('reset')) { show({ mode: 'reset', arg: q.get('reset') }); return true; }
  const invite = q.get('invite');
  if (invite) {
    const ok = await fetch(`/api/invite?token=${encodeURIComponent(invite)}`).then((r) => r.ok).catch(() => false);
    show(ok ? { mode: 'register', arg: invite } : { mode: 'login', err: 'This invite link is used or has run out: ask for a new one.' });
    return true;
  }
  if (q.has('forgot')) { show({ mode: 'forgot' }); return true; }
  return false;
}
