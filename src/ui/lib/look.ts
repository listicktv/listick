// The page's look, kept in this device's storage ('dash.look'): the accent and the
// background colour (six dark ones, or a custom hue), applied to <html> as CSS variables that style.css reads. Listick is
// dark only, without a wallpaper: older saved themes, wallpapers, blur, density and photos are dropped when read.
import { useSyncExternalStore } from 'react';
import { PLAIN, bgHex } from './colors';
import { mediaMark } from './icons';
import { store } from './store';

// bg: a PLAIN name or 'custom' (bgHue); hue: the custom accent's
type Look = { accent: string; hue?: number; bg: string; bgHue?: number };
const bgOf = (l: Look) => (l.bg === 'custom' ? bgHex(l.bgHue ?? 230) : (PLAIN.find((x) => x[0] === l.bg) || PLAIN[0])[1]);

const DEFAULT: Look = { accent: '#f5a524', bg: 'Navy' };
let look: Look = DEFAULT;
const listeners = new Set<() => void>();
let started = false;
function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const saved = store.get<Partial<Look> & { wall?: string; plain?: string }>('dash.look') || {};
  look = { ...DEFAULT, ...(saved.accent ? { accent: saved.accent } : {}), ...(saved.hue != null ? { hue: saved.hue } : {}),
    ...(saved.bg ? { bg: saved.bg, bgHue: saved.bgHue } : saved.wall === 'none' && saved.plain ? { bg: saved.plain } : {}) };
  try { localStorage.removeItem('dash.wallimg'); } catch {}
  apply();
}
function apply() {
  const d = document.documentElement;
  const bg = bgOf(look);
  d.style.setProperty('--accent', look.accent);
  d.style.setProperty('--page-bg', bg);
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = bg;
  // the tab icon takes the accent too
  document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]').forEach((l) => { l.href = mediaMark(look.accent); });
}
export function setLook(change: Partial<Look>) {
  look = { ...look, ...change };
  store.set('dash.look', look);
  apply();
  listeners.forEach((f) => f());
}
const subscribe = (f: () => void) => { start(); listeners.add(f); return () => listeners.delete(f); };
// the look, re-rendering on a change (the server renders the default; the before-paint script has already applied the saved one)
export const useLook = () => useSyncExternalStore(subscribe, () => { start(); return look; }, () => DEFAULT);
