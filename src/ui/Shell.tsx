'use client';
// The frame around every screen: the side rail (tablet and desktop), the top bar (date, search, clock, weather), the phone's
// bottom bar.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef } from 'react';
import { useApp } from './App';
import { Icon, PATHS, mediaMark } from './lib/icons';
import { useLook } from './lib/look';
import type { TitleType } from './lib/media';
import { useTitleNav } from './lib/title';
import { Greeting, Weather } from './Now';

function Logo({ ring }: { ring?: number }) {
  const { accent } = useLook();
  return <img className="media-logo" src={mediaMark(accent, ring)} alt="" />;
}

// the account button: your initial, or a person while signed out; armed for sign-out it turns red with a sign-out icon. The
// side menu's (named) has your name beside it and only signs out: Settings above it opens your settings
function AcctButton({ className, named }: { className: string; named?: boolean }) {
  const { me, armed, tapAcct, armOut } = useApp();
  const ref = useRef<HTMLButtonElement>(null);
  const label = armed ? 'Sign out? Tap again' : named ? 'Sign out' : me ? `Account: ${me.name}` : 'Sign in';
  return (
    <button ref={ref} type="button" className={`${className} acct-btn${me ? ' in' : ''}${armed ? ' armed' : ''}`} data-open-acct="" aria-label={label}
      title={me && !armed ? `Signed in as ${me.name}` : undefined} onClick={(e) => { e.stopPropagation(); if (named) armOut(); else tapAcct(); }}>
      <Icon className="person" d={PATHS.person} size={20} width={1.9} />
      <span className="avatar">{armed ? <Icon d={PATHS.signOut} /> : me ? me.name[0].toUpperCase() : ''}</span>
      {named && <span className="rail-t">{armed ? 'Sign out?' : me ? me.name : 'Sign in'}</span>}
    </button>
  );
}
function GearButton({ className }: { className: string }) {
  const { openLook } = useApp();
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button ref={ref} type="button" className={className} data-open-look="" aria-label="Appearance" title="Appearance" onClick={(e) => { e.stopPropagation(); openLook(ref.current); }}>
      <Icon d={PATHS.palette} size={20} width={1.9} />
    </button>
  );
}
// the side menu's Settings: the Settings page (account, appearance, connections, imports, your data, API access)
function SettingsButton() {
  const on = usePathname().startsWith('/settings');
  return (
    <Link href="/settings" className={`rail-tab${on ? ' active' : ''}`} aria-current={on ? 'page' : undefined}>
      <span className="rail-i"><Icon d={PATHS.gear} size={20} width={1.9} /></span><span className="rail-t">Settings</span>
    </Link>
  );
}

// phone: Settings beside the search button, in the accent while open
function PhoneSettings() {
  const on = usePathname().startsWith('/settings');
  return (
    <Link href="/settings" className={`glass iconbtn${on ? ' on' : ''}`} aria-label="Settings" aria-current={on ? 'page' : undefined}>
      <Icon d={PATHS.gear} size={20} width={1.9} />
    </Link>
  );
}

// the pages, in the side menu and the phone's bottom bar: Home is yours, the other three browse their kind
export const PAGES: { href: string; name: string; icon: string; kind: TitleType | null }[] = [
  { href: '/', name: 'Home', icon: PATHS.home, kind: null }, { href: '/movies', name: 'Movies', icon: PATHS.movie, kind: 'movie' },
  { href: '/tv', name: 'Shows', icon: PATHS.tv, kind: 'tv' }, { href: '/anime', name: 'Anime', icon: PATHS.anime, kind: 'anime' },
];
const LISTS = { href: '/lists', name: 'Lists', icon: PATHS.lists }, STATS = { href: '/stats', name: 'Stats', icon: PATHS.stats };
const CAL = { href: '/calendar', name: 'Calendar', icon: PATHS.cal };

const BACK = 'M15 5l-7 7 7 7';

// tablet and desktop: the side menu: the logo, the pages capsule (and Back while a title is open), Settings and your account
export function Rail() {
  const path = usePathname(), nav = useTitleNav();
  return (
    <nav className="glass siderail" id="rail" aria-label="Listick pages">
      <Link className="rail-logo" href="/" aria-label="Listick home"><Logo ring={6.5} /></Link>
      <div className="rail-pages">
        {PAGES.map((p) => (
          <Link key={p.href} href={p.href} className={`rail-tab${!nav && path === p.href ? ' active' : ''}`} aria-current={!nav && path === p.href ? 'page' : undefined} onClick={nav?.leave}>
            <span className="rail-i"><Icon d={p.icon} size={20} width={1.9} /></span><span className="rail-t">{p.name}</span>
          </Link>
        ))}
        <span className="rail-sep" />
        {[LISTS, CAL, STATS].map((p) => (
          <Link key={p.href} href={p.href} className={`rail-tab${!nav && path.startsWith(p.href) ? ' active' : ''}`} aria-current={!nav && path.startsWith(p.href) ? 'page' : undefined} onClick={nav?.leave}>
            <span className="rail-i"><Icon d={p.icon} size={20} width={1.9} /></span><span className="rail-t">{p.name}</span>
          </Link>
        ))}
        {nav && <><span className="rail-sep" />
          <button type="button" className="rail-tab" onClick={nav.back}><span className="rail-i"><Icon d={BACK} size={20} width={1.9} /></span><span className="rail-t">Back</span></button></>}
      </div>
      <div className="rail-foot">
        <SettingsButton />
        <AcctButton className="rail-tab" named />
      </div>
    </nav>
  );
}

// inTitle: the copy over a title's page
export function TopBar({ inTitle }: { inTitle?: () => void }) {
  const { setQ } = useApp(), path = usePathname(), home = path === '/' && !inTitle;
  const toPage = (v: string) => {
    inTitle!();
    const q = document.getElementById('q') as HTMLInputElement | null;
    if (q) { q.value = v; q.focus(); }
  };
  return (
    <header className="top">
      <div className="top-row">
        {home && <Greeting part="date" />}
        <Link className="brand" href="/" aria-label="Listick home"><Logo /></Link>
        <div className="top-tools">
          <form className="glass search" id={inTitle ? undefined : 'search'} role="search" onSubmit={(e) => e.preventDefault()}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input type="search" id={inTitle ? undefined : 'q'} placeholder="Search movies, shows and anime" aria-label="Search movies, shows and anime" autoComplete="off"
              onChange={(e) => { if (inTitle && e.target.value.trim()) toPage(e.target.value); setQ(e.target.value); }} onBlur={(e) => { if (!e.target.value.trim()) document.body.classList.remove('searching'); }} />
            <kbd>/</kbd>
          </form>
          <GearButton className="glass look-btn" />
        </div>
        <div className="top-btns">
          {/* phone: the search button opens the search line; left empty, it folds away again */}
          <button type="button" className="glass iconbtn" id={inTitle ? undefined : 'p-search'} aria-label="Search"
            onClick={() => { if (inTitle) inTitle(); document.body.classList.add('searching'); window.scrollTo(0, 0); document.getElementById('q')?.focus(); }}><Icon d={PATHS.search} size={20} width={1.9} /></button>
          <PhoneSettings />
          <AcctButton className="glass iconbtn" />
        </div>
      </div>
      {/* the date, greeting, clock and weather are Home's; Movies, TV and Anime open on their carousel instead */}
      {home && (
        <div className="title-row">
          <div className="hello"><Greeting part="title" /></div>
          <div className="now"><Greeting part="clock" /><Weather /></div>
        </div>
      )}
    </header>
  );
}

// phone: bottom bar
export function PhoneTabs() {
  const path = usePathname(), nav = useTitleNav();
  const on = (href: string) => !nav && (href === '/' ? path === '/' : path.startsWith(href));
  return (
    <nav className="pbar" aria-label="Listick pages">
      {[...PAGES, LISTS, STATS].map((t) => (
        <Link key={t.href} href={t.href} className={`pbar-t${on(t.href) ? ' on' : ''}`} aria-current={on(t.href) ? 'page' : undefined} onClick={nav?.leave}>
          <Icon d={t.icon} size={22} width={1.9} /><span>{t.name}</span>
        </Link>
      ))}
    </nav>
  );
}
