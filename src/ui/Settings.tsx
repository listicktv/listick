'use client';
// The Settings page (/settings): your name and the list of sections, the picked one in a glass panel beside it (on a phone the
// sections are a row of chips above it). Account: username (signs you in), name (the greeting), email and password, each
// changed in place from its pencil circle, and signing out. Appearance: this device's look. Region & services: your country
// and the services you pay for there (smart lists start with them). Connections: Stremio tracks what you
// watch, and so do Jellyfin and Seanime (Plex, Emby and Kodi to come). Import: bring your history from another service's export (Kitsu: by
// username). Your data: all of it as a file, or the account deleted.
// API access: one key per app, and the calendar feed's link. The section is in the address (/settings/import), so a link opens on it. Each change
// goes to Listick and the section redraws from its answer.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from './App';
import { LookRows } from './Appearance';
import { RegionPane } from './Region';
import { getJ, postJ } from './lib/api';
import { say } from './lib/format';
import { Icon, PATHS } from './lib/icons';

type Account = { name: string; firstName: string | null; email: string | null; stremio: string | null; apiKeys?: { id: string; name: string; key: string | null }[];
  jellyfin?: { template: string; last: { at: number; name: string } | null } | null; seanime?: { last: { at: number; name: string } | null } | null };
type Run = { source: string; status: 'queued' | 'running' | 'done' | 'failed'; counts?: Record<string, number>; error?: string | null };
type Imports = { sources: { id: string; name: string; what: string; file: string; user?: boolean }[]; runs: Run[]; onboard?: boolean };

function ACircle({ d, label, cls = '', children, ...rest }: { d?: string | null; label: string; cls?: string; children?: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`acct-c${cls ? ` ${cls}` : ''}`} aria-label={label} {...rest}>{d && <Icon d={d} />}{children}</button>;
}
// a removal asks first, like every remove circle: the first tap turns it red, a second tap within 3 s does it
function TwoTap({ d, label, cls, fn }: { d: string; label: string; cls: string; fn: () => unknown }) {
  const [armed, setArmed] = useState(false), t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  return <ACircle d={d} label={armed ? `${label}? Tap again` : label} cls={`${cls}${armed ? ' armed' : ''}`} onClick={() => {
    if (t.current) { clearTimeout(t.current); t.current = null; setArmed(false); return void fn(); }
    setArmed(true); t.current = setTimeout(() => { t.current = null; setArmed(false); }, 3000);
  }} />;
}
// a file as base64, for the import upload
const fileData = (file: File) => new Promise<string>((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => fail(r.error); r.readAsDataURL(file); });
const IMPORT_STATE = { queued: 'waiting to start', running: 'importing', done: 'done', failed: 'failed' };
function importLine(run: Run) {
  const c = run.counts || {}, n = (k: string, one: string, many: string) => (c[k] ? `${c[k]} ${c[k] === 1 ? one : many}` : null);
  const got = [n('plays', 'play', 'plays'), n('ratings', 'rating', 'ratings'), n('watchlist', 'saved', 'saved'), n('unmatched', 'not found', 'not found')].filter(Boolean).join(', ');
  return run.status === 'failed' ? `failed: ${run.error || 'unknown error'}` : `${IMPORT_STATE[run.status]}${got ? ` · ${got}${run.status === 'running' ? ' so far' : ''}` : ''}`;
}
const text = (t: string, off = false) => <span className={off ? 'acct-off' : 'acct-v-text'}>{t}</span>;

type Input = React.InputHTMLAttributes<HTMLInputElement>;
// the pencil turns the value into its field(s) under the row and itself into a tick: the tick or Enter saves, Escape leaves it
// danger (Delete account): a trash circle to open it and a red one to confirm, like the other remove circles
function Edit({ label, value, inputs, open, setOpen, save, danger }: { label: string; value: ReactNode; inputs: Input[]; open: boolean; setOpen: (on: boolean) => void;
  save: (v: string[]) => Promise<string | null>; danger?: boolean }) {
  const [vals, setVals] = useState(() => inputs.map((x) => String(x.defaultValue ?? '')));
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  if (!open) return <div className="look-row"><span className="look-k">{label}</span><div className="acct-v">{value}<ACircle d={danger ? PATHS.trash : PATHS.pen} label={danger ? label : `Change ${label}`} cls={danger ? 'rm' : undefined} onClick={() => setOpen(true)} /></div></div>;
  const go = async (e?: React.SyntheticEvent) => {
    e?.preventDefault(); setBusy(true);
    const m = await save(vals);
    setBusy(false);
    if (m) { setErr(say(m) || ''); return; }
    setOpen(false);
  };
  return (
    <>
      <div className="look-row"><span className="look-k">{label}</span><div className="acct-v"><ACircle d={PATHS.tick} label={danger ? `${label}: for good` : `Save ${label}`} cls={danger ? 'rm armed' : 'on'} disabled={busy} onClick={go} /></div></div>
      <form className="acct-form" onSubmit={go} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } }}>
        <div className="acct-line">
          {inputs.map((x, i) => <input key={i} className="field" {...x} defaultValue={undefined} autoFocus={i === 0} value={vals[i]} onChange={(e) => setVals((v) => v.map((y, j) => (j === i ? e.target.value : y)))} />)}
        </div>
        <p className="acct-err">{err}</p>
        <button type="submit" hidden />
      </form>
    </>
  );
}

type Loaded = { a: Account | null; im: Imports | null; err: string | null };
async function loadAccount(): Promise<Loaded> {
  try {
    const a = await getJ<Account>('/api/account');
    return { a, im: await getJ<Imports>('/api/import').catch(() => null), err: null };   // the rest of the panel works without the imports
  } catch (e) { return { a: null, im: null, err: (e as Error).message }; }
}
// the server's own pages (a service's sign-in, the export, the account deleted) load in place of this one
const go = (url: string) => window.location.assign(url);


// the sections, in the list's order: id (the address's last part), name and icon
const SECTIONS = [
  { id: 'account', name: 'Account', icon: PATHS.person },
  { id: 'appearance', name: 'Appearance', icon: PATHS.palette },
  { id: 'region', name: 'Region & services', icon: PATHS.globe },
  { id: 'connections', name: 'Connections', icon: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' },
  { id: 'import', name: 'Import', icon: 'M12 20V9M8 13l4-4 4 4M5 4h14' },
  { id: 'data', name: 'Your data', icon: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6' },
  { id: 'api', name: 'API access', icon: 'M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14' },
  { id: 'users', name: 'Users', icon: PATHS.people },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];
// the connections still to come: name and logo
const SOON: [string, string][] = [['Plex', 'plex.svg'], ['Emby', 'emby.svg'], ['Kodi', 'kodi.svg']];
const sectionOf = (id: string | undefined, admin: boolean): SectionId => (SECTIONS.find((x) => x.id === id && (x.id !== 'users' || admin))?.id ?? 'account');

export function Settings() {
  const { me, welcome } = useApp();
  // the section from the address (/settings/<id>); plain /settings opens on Account, or on Import for a new account's welcome
  const part = usePathname().split('/')[2], sec = sectionOf(part || (welcome ? 'import' : undefined), !!me?.admin);
  const s = SECTIONS.find((x) => x.id === sec)!;
  return (
    // on a phone: /settings is the list of sections, /settings/<id> the section alone with a way back (a wider screen shows both)
    <div className={`settings${part ? ' in-section' : ' at-list'}`}>
      <h1 className="set-title">Settings</h1>
      {/* you, then the sections */}
      <div className="set-side">
        {me && <div className="set-me"><span className="set-av">{me.name[0].toUpperCase()}</span><span><b>{me.firstName || me.name}</b><span className="set-user">@{me.name}</span></span></div>}
      <nav className="set-nav" aria-label="Settings sections">
        {SECTIONS.filter((x) => x.id !== 'users' || me?.admin).map((x) => (
          <Link key={x.id} href={`/settings/${x.id}`} replace scroll={false} className={`set-tab${x.id === sec ? ' on' : ''}`} aria-current={x.id === sec ? 'page' : undefined}>
            <span className="set-i"><Icon d={x.icon} size={20} width={1.9} /></span><span>{x.name}</span><span className="set-go" aria-hidden="true">›</span>
          </Link>
        ))}
      </nav>
      </div>
      <section className="glass set-panel" aria-labelledby="set-panel-title">
        <Link href="/settings" className="set-back">‹ Settings</Link>
        <h2 className="set-ptitle" id="set-panel-title">{s.name}</h2>
        <div className="set-rows">{sec === 'appearance' ? <div className="set-look"><LookRows /></div> : sec === 'region' ? <RegionPane /> : sec === 'users' ? <UsersPane /> : <AccountPane key={sec} section={sec} />}</div>
      </section>
    </div>
  );
}

function AccountPane({ section }: { section: Exclude<SectionId, 'appearance' | 'region' | 'users'> }) {
  const { updateMe, welcome, setWelcome, signOut } = useApp();
  const [a, setA] = useState<Account | null>(null), [im, setIm] = useState<Imports | null>(null), [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const show = useCallback((r: Loaded) => { if (r.err) setErr(r.err); else { setA(r.a); setIm(r.im); setErr(null); } }, []);
  const refresh = useCallback(() => loadAccount().then(show), [show]);
  useEffect(() => { let live = true; void loadAccount().then((r) => { if (live) show(r); }); return () => { live = false; }; }, [show]);
  // a run in progress: the counts refresh while the section is open
  const running = !!im?.runs.some((x) => x.status === 'queued' || x.status === 'running');
  useEffect(() => { if (!running) return; const t = setTimeout(refresh, 4000); return () => clearTimeout(t); }, [running, im, refresh]);

  if (err) return <p className="acct-note">{`Couldn't load your account (${err}).`}</p>;
  if (!a) return null;
  const done = async (p: Promise<string | null>) => { const m = await p; if (m) alert(say(m)); await refresh(); };
  const editor = (id: string, label: string, value: ReactNode, inputs: Input[], save: (v: string[]) => Promise<string | null>) => (
    <Edit key={`${id}${edit === id ? '-on' : ''}`} label={label} value={value} inputs={inputs} open={edit === id} danger={id === 'delete'}
      setOpen={(on) => { setEdit(on ? id : null); if (!on) void refresh(); }} save={save} />
  );
  const names = Object.fromEntries((im?.sources || []).map((x) => [x.id, x.name]));

  if (section === 'account') return (
    <>
      {editor('user', 'Username', text(a.name), [{ defaultValue: a.name, autoComplete: 'username', 'aria-label': 'Username' }],
        async ([name]) => { const m = await postJ('/api/account/username', { name: name.trim() }); if (!m) updateMe({ name: name.trim() }); return m; })}
      {editor('pass', 'Password', <span className="acct-v-text mono">••••••••</span>,
        [{ type: 'password', placeholder: 'Current', autoComplete: 'current-password', 'aria-label': 'Current password' }, { type: 'password', placeholder: 'New (8+)', autoComplete: 'new-password', 'aria-label': 'New password' }],
        ([current, next]) => postJ('/api/account/password', { current, next }))}
      {editor('name', 'Name', a.firstName ? text(a.firstName) : text('not set', true), [{ defaultValue: a.firstName || '', autoComplete: 'given-name', 'aria-label': 'Name' }],
        async ([first]) => { const m = await postJ('/api/account/first', { first }); if (!m) updateMe({ firstName: first.trim() }); return m; })}
      {editor('email', 'Email', a.email ? text(a.email) : text('not set', true),
        [{ type: 'email', defaultValue: a.email || '', autoComplete: 'email', 'aria-label': 'Email' }, { type: 'password', placeholder: 'Your password', autoComplete: 'current-password', 'aria-label': 'Your password' }],
        ([email, password]) => postJ('/api/account/email', { email, password }))}
      <div className="look-row"><span className="look-k">Sign out</span>
        <div className="acct-v">{text('on this device')}<TwoTap d={PATHS.signOut} label="Sign out" cls="rm" fn={signOut} /></div>
      </div>
    </>
  );
  if (section === 'connections') {
    // Stremio: connected (its account, and Disconnect), or its sign-in
    const on = !!a.stremio;
    return (
      <>
        <div className="acct-detail">
          <span className={`acct-c logo${on ? ' on' : ''}`} aria-hidden="true"><img src="/icons/stremio.svg" alt="" /></span>
          <div className="acct-detail-t"><b>Stremio</b><span className={`acct-state${on ? ' on' : ''}`}>{a.stremio || 'not connected'}</span></div>
          {on && <TwoTap d={PATHS.cross} label="Disconnect Stremio" cls="rm" fn={() => done(postJ('/api/account/stremio', { disconnect: true }))} />}
        </div>
        {!on && <StremioForm done={refresh} />}
        <JellyfinRow a={a} done={done} />
        <SeanimeRow a={a} done={done} />
        {/* the players to come, each as its own connection later */}
        <h3 className="set-sub">Coming soon</h3>
        {SOON.map(([name, logo]) => (
          <div key={name} className="acct-detail soon">
            <span className="acct-c logo" aria-hidden="true"><img src={`/icons/${logo}`} alt="" /></span>
            <div className="acct-detail-t"><b>{name}</b></div>
            <span className="set-soon">Soon</span>
          </div>
        ))}
      </>
    );
  }
  if (section === 'import') return !im ? <p className="acct-note">Imports aren&apos;t available right now.</p> : (
    <>
      {welcome && (
        <div className="acct-detail">
          <div className="acct-detail-t"><b>Welcome to Listick</b><span className="acct-what">Bring what you watched from another service below, or start fresh.</span></div>
          <ACircle d={PATHS.tick} label="Start fresh" cls="on" onClick={async () => { await postJ('/api/import/fresh', {}); setWelcome(false); await refresh(); }} />
        </div>
      )}
      {im.sources.map((x) => (
        <div key={x.id} className="look-row set-import"><span className="look-k">{x.name}</span>
          <div className="acct-v">
            {text(x.what)}
            {x.user ? <ByName done={async (m) => { if (m) alert(say(m)); setWelcome(false); await refresh(); }} />
              : <Upload id={x.id} name={x.name} accept={x.file} done={async (m) => { if (m) alert(say(m)); setWelcome(false); await refresh(); }} />}
          </div>
        </div>
      ))}
      {im.runs.length > 0 && <h3 className="set-sub">Recent imports</h3>}
      {im.runs.slice(0, 5).map((run, i) => <div key={i} className="look-row"><span className="look-k">{names[run.source] || run.source}</span><div className="acct-v">{importLine(run)}</div></div>)}
    </>
  );
  if (section === 'data') return (
    <>
      <div className="look-row"><span className="look-k">Export</span>
        <div className="acct-v"><span className="acct-v-text">History, ratings, lists</span><ACircle d="M12 4v11M8 11l4 4 4-4M5 20h14" label="Download all your data (JSON)" onClick={() => go('/api/account/export')} /></div>
      </div>
      {editor('delete', 'Delete account', text('everything, for good', true), [{ type: 'password', placeholder: 'Your password', autoComplete: 'current-password', 'aria-label': 'Your password to delete your account' }],
        async ([password]) => { const m = await postJ('/api/account/delete', { password }); if (!m) go('/?deleted=1'); return m; })}
    </>
  );
  // API access: one key per app (a key opens only its app's scopes, docs/api.md) and the calendar feed's link (added to a
  // calendar app from here); made when you ask, copied from here, replaced with two taps (the old one stops working)
  return (
    <>
      {(a.apiKeys || []).map((k) => {
        const make = () => done(postJ(`/api/account/apikey/${k.id}`, {}));
        const feed = k.id === 'calendar' && k.key ? `${location.origin}/api/v1/calendar/${k.key}.ics` : null;
        return (
          <div key={k.id} className="look-row"><span className="look-k">{k.name}</span>
            <div className="acct-v">
              {!k.key ? <ACircle d={PATHS.plus} label={`Make a ${k.id === 'calendar' ? 'link' : 'key'} for the ${k.name}`} cls="on" onClick={make} />
                : feed ? <>
                  <ACircle d={PATHS.cal} label="Add to Apple or Outlook Calendar" onClick={() => { location.href = feed.replace(/^https?:/, 'webcal:'); }} />
                  <ACircle label="Add to Google Calendar" onClick={() => window.open(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feed.replace(/^https?:/, 'webcal:'))}`, '_blank', 'noopener')}><b className="acct-g">G</b></ACircle>
                  <CopyKey name={k.name} value={feed} what="link" />
                  <TwoTap d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" label={`Replace the ${k.name} link`} cls="rm" fn={make} />
                </>
                : <><CopyKey name={k.name} value={k.key} /><TwoTap d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" label={`Replace the ${k.name} key`} cls="rm" fn={make} /></>}
            </div>
          </div>
        );
      })}
    </>
  );
}

// Jellyfin: a key in a webhook address, the steps to set up its Webhook plugin, and the last play it sent
function JellyfinRow({ a, done }: { a: Account; done: (p: Promise<string | null>) => Promise<void> }) {
  const key = a.apiKeys?.find((k) => k.id === 'jellyfin')?.key, hook = key ? `${location.origin}/api/v1/jellyfin/${key}` : null, last = a.jellyfin?.last;
  const make = () => done(postJ('/api/account/apikey/jellyfin', {}));
  return (
    <>
      <div className="acct-detail">
        <span className={`acct-c logo${last ? ' on' : ''}`} aria-hidden="true"><img src="/icons/jellyfin.svg" alt="" /></span>
        <div className="acct-detail-t"><b>Jellyfin</b>
          <span className={`acct-state${last ? ' on' : ''}`}>{!hook ? 'not connected' : last
            ? `${last.name} · ${new Date(last.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'waiting for the first play'}</span></div>
        {!hook ? <ACircle d={PATHS.plus} label="Connect Jellyfin" cls="on" onClick={make} />
          : <TwoTap d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" label="Replace the Jellyfin address" cls="rm" fn={make} />}
      </div>
      {hook && a.jellyfin && (
        <ol className="jf-steps">
          <li><span>In Jellyfin: Dashboard › Plugins › Catalog, install <b>Webhook</b>, then restart Jellyfin.</span></li>
          <li><span>Plugins › Webhook › <b>Add Generic Destination</b>, with this as its Webhook URL</span><CopyKey name="Jellyfin" value={hook} what="address" /></li>
          <li><span>Notification types <b>Playback Start</b>, <b>Playback Progress</b>, <b>Playback Stop</b> and <b>User Data Saved</b>; item types <b>Movies</b> and <b>Episodes</b>; your user in the user filter.</span></li>
          <li><span>This as its Template (leave <b>Send All Properties</b> off), then Save</span><CopyKey name="Jellyfin" value={a.jellyfin.template} what="template" /></li>
        </ol>
      )}
    </>
  );
}

// Seanime plugin setup
const SEANIME_PLUGIN = 'https://raw.githubusercontent.com/listicktv/listick-seanime/main/manifest.json';
function SeanimeRow({ a, done }: { a: Account; done: (p: Promise<string | null>) => Promise<void> }) {
  const key = a.apiKeys?.find((k) => k.id === 'seanime')?.key, last = a.seanime?.last;
  const make = () => done(postJ('/api/account/apikey/seanime', {}));
  return (
    <>
      <div className="acct-detail">
        <span className={`acct-c logo${last ? ' on' : ''}`} aria-hidden="true"><img src="/icons/seanime.svg" alt="" /></span>
        <div className="acct-detail-t"><b>Seanime</b>
          <span className={`acct-state${last ? ' on' : ''}`}>{!key ? 'not connected' : last
            ? `${last.name} · ${new Date(last.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'waiting for the first play'}</span></div>
        {!key ? <ACircle d={PATHS.plus} label="Connect Seanime" cls="on" onClick={make} />
          : <TwoTap d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" label="Replace the Seanime key" cls="rm" fn={make} />}
      </div>
      {key && (
        <ol className="jf-steps">
          <li><span>In Seanime: Extensions › <b>Add extension</b>, with this manifest URL</span><CopyKey name="Seanime" value={SEANIME_PLUGIN} what="address" /></li>
          <li><span>In the Listick plugin&apos;s settings, this as <b>Listick address</b></span><CopyKey name="Seanime" value={location.origin} what="address" /></li>
          <li><span>and this as <b>API key</b></span><CopyKey name="Seanime" value={key} /></li>
        </ol>
      )}
    </>
  );
}

// Stremio's own sign-in: only the session key it gives back is kept
function StremioForm({ done }: { done: () => Promise<void> }) {
  const [email, setEmail] = useState(''), [pass, setPass] = useState(''), [err, setErr] = useState('');
  return (
    <form className="acct-form" onSubmit={async (e) => { e.preventDefault(); const m = await postJ('/api/account/stremio', { email, password: pass }); if (m) setErr(say(m) || ''); else await done(); }}>
      <div className="acct-line">
        <input className="field" id="stremio-email" type="email" placeholder="Stremio email" autoComplete="off" aria-label="Stremio email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="field" type="password" placeholder="Stremio password" autoComplete="off" aria-label="Stremio password" value={pass} onChange={(e) => setPass(e.target.value)} />
        <ACircle d={PATHS.tick} label="Connect" cls="on" type="submit" />
      </div>
      <p className="acct-err">{err}</p>
    </form>
  );
}
function Upload({ id, name, accept, done }: { id: string; name: string; accept: string; done: (m: string | null) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null), [busy, setBusy] = useState(false);
  return (
    <>
      <ACircle d="M12 20V9M8 13l4-4 4 4M5 4h14" label={`Upload your ${name} export`} cls="on" disabled={busy} onClick={() => input.current?.click()} />
      <input ref={input} type="file" accept={accept} hidden onChange={async () => {
        const f = input.current?.files?.[0]; if (!f) return;
        setBusy(true);
        const m = await postJ(`/api/import/file/${id}`, { data: await fileData(f) });
        setBusy(false); await done(m);
      }} />
    </>
  );
}
// an import by username (Kitsu): the name and the go circle
function ByName({ done }: { done: (m: string | null) => Promise<void> }) {
  const [user, setUser] = useState(''), [busy, setBusy] = useState(false);
  return (
    <form className="set-byname" onSubmit={async (e) => { e.preventDefault(); if (!user.trim()) return; setBusy(true); const m = await postJ('/api/import/kitsu', { user }); setBusy(false); await done(m); }}>
      <input className="field" placeholder="Kitsu username" aria-label="Kitsu username" autoComplete="off" value={user} onChange={(e) => setUser(e.target.value)} />
      <ACircle d="M12 20V9M8 13l4-4 4 4M5 4h14" label="Import your Kitsu library" cls="on" type="submit" disabled={busy || !user.trim()} />
    </form>
  );
}
// copied from here: the circle ticks for 2 s
function CopyKey({ name, value, what = 'key' }: { name: string; value: string; what?: string }) {
  const [copied, setCopied] = useState(false);
  return <ACircle d={copied ? PATHS.tick : PATHS.copy} label={`Copy the ${name} ${what}`} cls={copied ? 'on' : ''} onClick={async () => {
    try { await navigator.clipboard.writeText(value); } catch { return alert("Couldn't copy: this browser blocks the clipboard here."); }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }} />;
}

// Users (admins): invite links (one sign-up each, within 7 days; a link shows once, when made, to copy and send; one not used
// yet can be taken back), and everyone's account: a new password for someone, or the account removed (never the owner or
// yours), and an account made directly
type UserRow = { id: string; name: string; email: string | null; admin: boolean; created: number; plays: number; owner: boolean; you: boolean };
type InviteRow = { id: string; created: number; expires: number; by: string | null; usedBy: string | null; usedAt: number | null; open: boolean };
const day = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(new Date(t).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
const KEY = 'M15 7a4 4 0 1 0-3.9 5L4 19v2h3l1-1v-2h2v-2h2l1.1-1.1A4 4 0 0 0 15 7zM16 7h.01';
function UsersPane() {
  const [users, setUsers] = useState<UserRow[] | null>(null), [invites, setInvites] = useState<InviteRow[]>([]), [err, setErr] = useState('');
  const [link, setLink] = useState<{ link: string; expires: number } | null>(null), [pw, setPw] = useState<string | null>(null), [adding, setAdding] = useState(false);
  const load = useCallback(async () => {
    try { const [u, i] = await Promise.all([getJ<{ users: UserRow[] }>('/api/users'), getJ<{ invites: InviteRow[] }>('/api/invites')]); setUsers(u.users); setInvites(i.invites); setErr(''); }
    catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => {
    let live = true;
    void Promise.all([getJ<{ users: UserRow[] }>('/api/users'), getJ<{ invites: InviteRow[] }>('/api/invites')])
      .then(([u, i]) => { if (live) { setUsers(u.users); setInvites(i.invites); } }, (e: Error) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, []);
  const act = async (path: string, b: object = {}) => { const m = await postJ(path, b); if (m) alert(say(m)); await load(); return m; };
  const invite = async () => { const got: { link?: string; expires?: number } = {}, m = await postJ('/api/invites', {}, got); if (m) return alert(say(m)); setLink({ link: got.link!, expires: got.expires! }); await load(); };
  if (err) return <p className="acct-note">{`Couldn't load the users (${err}).`}</p>;
  if (!users) return null;
  const open = invites.filter((x) => x.open), used = invites.filter((x) => x.usedAt).slice(0, 5);
  return (
    <>
      <div className="look-row"><span className="look-k">Invite link</span>
        <div className="acct-v">{text('one sign-up, 7 days')}<ACircle d={PATHS.plus} label="Make an invite link" cls="on" onClick={() => void invite()} /></div></div>
      {link && <div className="look-row set-link"><span className="acct-v-text mono">{link.link}</span>
        <div className="acct-v">{text(`until ${day(link.expires)}`)}<CopyKey name="invite" what="link" value={link.link} /></div></div>}
      {open.map((x) => (
        <div key={x.id} className="look-row"><span className="look-k">{`Made ${day(x.created)}`}</span>
          <div className="acct-v">{text(`open until ${day(x.expires)}`)}<TwoTap d={PATHS.cross} label="Take back this invite" cls="rm" fn={() => act(`/api/invites/${x.id}/revoke`)} /></div></div>
      ))}
      {used.map((x) => (
        <div key={x.id} className="look-row set-acct"><span className="look-k">{`Made ${day(x.created)}`}</span><div className="acct-v">{text(`used by ${x.usedBy || 'a removed account'} · ${day(x.usedAt!)}`, true)}</div></div>
      ))}
      <h3 className="set-sub">Accounts</h3>
      {users.map((u) => (
        <div key={u.id}>
          <div className="look-row set-acct"><span className="look-k">{u.name}{u.owner ? ' · owner' : u.admin ? ' · admin' : ''}{u.you ? ' (you)' : ''}</span>
            <div className="acct-v">{text(`${u.email || 'no email'} · since ${day(u.created)} · ${u.plays} plays`)}
              {!u.you && <ACircle d={pw === u.id ? PATHS.cross : KEY} label={pw === u.id ? 'Keep the password' : `A new password for ${u.name}`} onClick={() => setPw(pw === u.id ? null : u.id)} />}
              {!u.owner && !u.you && <TwoTap d={PATHS.trash} label={`Remove ${u.name} and everything of theirs`} cls="rm" fn={() => act(`/api/users/${u.id}/delete`)} />}
            </div></div>
          {pw === u.id && <form className="acct-form" onSubmit={async (e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get('pw'); if (!(await act(`/api/users/${u.id}/password`, { password: v }))) setPw(null); }}>
            <div className="acct-line"><input className="field" name="pw" type="password" autoFocus placeholder="New password (8+)" autoComplete="new-password" aria-label={`New password for ${u.name}`} />
              <ACircle d={PATHS.tick} label="Set the password" cls="on" type="submit" /></div></form>}
        </div>
      ))}
      <Edit label="Add an account" value={text('name, email, password')} open={adding} setOpen={setAdding}
        inputs={[{ placeholder: 'Username', autoComplete: 'off', 'aria-label': 'Username' }, { type: 'email', placeholder: 'Email', autoComplete: 'off', 'aria-label': 'Email' },
          { type: 'password', placeholder: 'Password (8+)', autoComplete: 'new-password', 'aria-label': 'Password' }]}
        save={async ([name, email, password]) => { const m = await postJ('/api/users', { name: name.trim(), email: email.trim(), password }); if (!m) await load(); return m; }} />
    </>
  );
}
