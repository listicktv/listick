'use client';
// Signed out: what Listick does on the left, the sign-in card on the right with the logo half over its top edge (on a phone:
// the head, the card, then the rest). One card, five modes: setup (a fresh instance's owner), login (username or email),
// register (an invite link), forgot (a reset link by email), reset (a new password from that link). The captcha (Cloudflare
// Turnstile) shows where one is set up.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useApp } from './App';
import { getConfig, setToken, type Config, type Me } from './lib/api';
import { mediaMark, PATHS } from './lib/icons';
import { useLook } from './lib/look';

export type Mode = 'setup' | 'login' | 'register' | 'forgot' | 'reset';
export type SignInState = { mode: Mode; arg?: string | null; sub?: string; err?: string; id?: number };
type Field = 'first' | 'name' | 'email' | 'pass' | 'again';
const MODES: Record<Mode, { title: string | ((x?: string | null) => string); sub?: string | ((x?: string | null) => string); go: string; name?: string; pass?: string;
  fields: Field[]; links?: ('forgot' | 'back')[]; captcha?: boolean }> = {
  setup: { title: 'Create your account', sub: 'The first account owns this Listick and invites everyone else.', go: 'Create account', name: 'Username', pass: 'Password', fields: ['name', 'pass', 'again'] },
  login: { title: 'Sign in to your lists', go: 'Sign in', name: 'Username or email', pass: 'Password', fields: ['name', 'pass'], links: ['forgot'], captcha: true },
  register: { title: 'Create your account', sub: (invite) => (invite ? "You've been invited to Listick." : 'Track everything you watch, in one place.'), go: 'Create account', name: 'Username', pass: 'Password', fields: ['first', 'name', 'email', 'pass', 'again'], links: ['back'], captcha: true },
  forgot: { title: 'Forgot password', sub: "We'll email you a reset link.", go: 'Send link', fields: ['email'], links: ['back'], captcha: true },
  reset: { title: 'Choose a new password', go: 'Save and sign in', pass: 'New password', fields: ['pass', 'again'], links: ['back'] },
};

declare global {
  interface Window { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove: (id: string) => void; reset: (id: string) => void; getResponse: (id: string) => string | undefined } }
}
// Turnstile's script, loaded once, the first time a mode with a captcha shows
let tsLoading: Promise<void> | null = null;
const loadTurnstile = () => (window.turnstile ? Promise.resolve() : tsLoading || (tsLoading = new Promise<void>((ok, fail) => {
  const sc = document.createElement('script'); sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; sc.async = true;
  sc.onload = () => ok(); sc.onerror = () => fail(new Error('turnstile')); document.head.append(sc);
})));

// the headline's name, in lower case with a domain's ending in the accent ("listick.tv"); nothing until the config is in
const brand = (name?: string) => {
  const n = (name || '').toLowerCase(), dot = n.lastIndexOf('.');
  return dot > 0 ? <>{n.slice(0, dot)}<span>{n.slice(dot)}</span></> : n;
};

// the intro's poster strip: trending movies, shows and anime (the week's pick), gliding right to left in a loop: the list twice in
// one track that moves by half its width, so the second copy takes the first's place without a jump
function Strip() {
  const [posters, setPosters] = useState<string[]>([]);
  useEffect(() => { fetch('/api/landing').then((r) => r.json()).then((j) => setPosters(j.posters || [])).catch(() => {}); }, []);
  return (
    <div className="signin-strip" id="signin-strip" aria-hidden="true">
      {posters.length > 0 && (
        <div className="strip-track" style={{ '--strip-s': `${posters.length * 4}s` } as CSSProperties}>
          {[...posters, ...posters].map((src, i) => <img key={i} src={src} alt="" decoding="async" />)}
        </div>
      )}
    </div>
  );
}

export function SignIn() {
  const app = useApp();
  const { accent } = useLook();
  const s = app.signIn!, m = MODES[s.mode];
  const [v, setV] = useState<Record<Field, string>>({ first: '', name: '', email: '', pass: '', again: '' });
  const [err, setErr] = useState(s.err || '');
  const [sub, setSub] = useState<string | null>(null);   // set once a link is on its way (the form's rows then hide)
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const captchaBox = useRef<HTMLDivElement>(null), widget = useRef<string | null>(null);
  const first = useRef<HTMLInputElement | null>(null);

  // each sign-in state is a fresh card (App keys it): focus on its first field, its captcha drawn
  useEffect(() => {
    first.current?.focus();
    let live = true;
    void getConfig().then(async (c) => {
      if (!live) return;
      setConfig(c);
      if (widget.current && window.turnstile) { window.turnstile.remove(widget.current); widget.current = null; }
      if (!m.captcha || !c.captcha || !captchaBox.current) return;
      await loadTurnstile().catch(() => null);
      if (!live || !captchaBox.current) return;
      if (!window.turnstile) { captchaBox.current.textContent = "The captcha couldn't load."; return; }
      widget.current = window.turnstile.render(captchaBox.current, { sitekey: c.captcha, theme: 'dark', size: 'flexible' });
    });
    return () => { live = false; };
  }, [m.captcha]);

  const captchaToken = () => (widget.current && window.turnstile ? window.turnstile.getResponse(widget.current) || '' : '');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (m.fields.includes('again') && v.pass !== v.again) { setErr('The two passwords differ.'); return; }
    const body = { setup: { name: v.name.trim(), password: v.pass }, login: { name: v.name.trim(), password: v.pass, captcha: captchaToken() },
      register: { invite: s.arg, first: v.first.trim(), name: v.name.trim(), email: v.email.trim(), password: v.pass, captcha: captchaToken() },
      forgot: { email: v.email.trim(), captcha: captchaToken() }, reset: { token: s.arg, password: v.pass } }[s.mode];
    setBusy(true); setErr('');
    const r = await fetch(`/api/${s.mode}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    const j: { error?: string; csrf?: string; user?: Me } = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r?.ok) {
      setErr(j.error ? `${j.error[0].toUpperCase()}${j.error.slice(1)}.` : "Couldn't reach Listick.");
      if (m.captcha && widget.current && window.turnstile) window.turnstile.reset(widget.current);   // a token is good once
      return;
    }
    // a reset link, or a new account's confirmation link, is on its way: the card says where to look
    if (s.mode === 'forgot') {
      setSub('Check your email for the link.');
      return;
    }
    setToken(j.csrf!);
    setV((x) => ({ ...x, pass: '', again: '' }));
    app.signedIn(j.user!);
  };

  const title = typeof m.title === 'function' ? m.title(s.arg) : m.title;
  const intro = sub ?? s.sub ?? (typeof m.sub === 'function' ? m.sub(s.arg) : m.sub);
  const sent = sub != null;
  const row = (f: Field, label: string, attrs: React.InputHTMLAttributes<HTMLInputElement>) => (
    <label className="signin-field" id={`signin-${f}-row`} hidden={sent || !m.fields.includes(f)}>
      <span id={f === 'name' ? 'signin-name-k' : f === 'pass' ? 'signin-pass-k' : undefined}>{label}</span>
      <input className="field" id={`signin-${f}`} {...attrs} required={!sent && m.fields.includes(f)} value={v[f]}
        ref={m.fields[0] === f ? first : undefined} onChange={(e) => setV((x) => ({ ...x, [f]: e.target.value }))} />
    </label>
  );
  return (
    <div className="signin-scrim" id="signin">
      <div className="signin-intro">
        <h1 className="signin-h">Everything you watch, <br />in one place. <br /><span className="signin-domain">{brand(config?.name)}</span></h1>
        <ul className="signin-feats">
          <li><span className="sf-c on"><svg viewBox="0 0 24 24" aria-hidden="true"><path d={PATHS.watched} /></svg></span><div><b>Your history</b><span>Every movie and episode you&apos;ve watched.</span></div></li>
          <li><span className="sf-c sf-rate" aria-hidden="true"><span><svg viewBox="0 0 24 24"><path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.3l6-.7z" /></svg></span></span><div><b>Your ratings</b><span>Rate anything you&apos;ve seen.</span></div></li>
          <li><span className="sf-c"><svg viewBox="0 0 24 24" aria-hidden="true"><path d={PATHS.cal} /></svg></span><div><b>What&apos;s next</b><span>New episodes and what&apos;s airing soon.</span></div></li>
        </ul>
        <Strip />
      </div>
      <form className="glass signin" id="signin-form" autoComplete="on" onSubmit={submit}>
        <span className="signin-crown" aria-hidden="true"><img className="media-logo" src={mediaMark(accent)} alt="" /></span>
        <h2 className="signin-title" id="signin-title">{title}</h2>
        <p className="signin-sub" id="signin-sub" hidden={!intro}>{intro}</p>
        {row('first', 'Name', { autoComplete: 'given-name' })}
        {row('name', m.name || 'Username or email', { name: 'username', autoComplete: s.mode === 'register' ? 'off' : 'username' })}
        {row('email', 'Email', { name: 'email', type: 'email', autoComplete: 'email' })}
        {row('pass', m.pass || 'Password', { name: 'password', type: 'password', autoComplete: s.mode === 'login' ? 'current-password' : 'new-password', minLength: s.mode === 'login' ? 0 : 8 })}
        {row('again', 'Again', { type: 'password', autoComplete: 'new-password' })}
        <div className="signin-captcha" id="signin-captcha" ref={captchaBox} hidden={sent || !m.captcha || !config?.captcha} />
        <p className="signin-err" id="signin-err" role="alert">{err}</p>
        <button type="submit" className="abtn primary" id="signin-go" disabled={busy} hidden={sent}>{m.go}</button>
        <div className="signin-links">
          <button type="button" className="signin-link" id="signin-forgot" hidden={!m.links?.includes('forgot')} onClick={() => app.showSignIn({ mode: 'forgot' })}>Forgot password?</button>
          <button type="button" className="signin-link" id="signin-back" hidden={!m.links?.includes('back')} onClick={() => { history.replaceState(null, '', location.pathname); app.showSignIn({ mode: 'login' }); }}>Back to sign in</button>
        </div>
        <p className="signin-legal"><a href="/about.html">About</a></p>
      </form>
    </div>
  );
}
