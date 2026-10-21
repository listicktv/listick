'use client';
// The top bar's live parts: the date top left, "Good evening, <first name>" under it, the clock, and (where the instance turns
// it on, LISTICK_WEATHER=on) the weather at this device's location (asked once, kept a week; Open-Meteo every 20 minutes).
import { useEffect, useState } from 'react';
import { useApp } from './App';
import { getConfig } from './lib/api';
import { store } from './lib/store';
import { PATHS } from './lib/icons';

// re-renders every `ms` (the clock each second, the greeting each minute); nothing on the server, so no mismatch on hydration
function useNow(ms: number) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0), t = setInterval(tick, ms);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [ms]);
  return now;
}

export function Greeting({ part }: { part: 'date' | 'title' | 'clock' }) {
  const { me } = useApp();
  const now = useNow(part === 'clock' ? 1000 : 60000);
  if (part === 'clock') return <span className="clock" id="clock">{now ? now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '--:--'}</span>;
  if (part === 'date') return (
    <div className="dateline">
      <span className="d-long" id="dateline">{now ? now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : ' '}</span>
      <span className="d-short" id="dateline-short">{now ? now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '').toUpperCase().replace(/^(\w+) /, '$1 · ') : ''}</span>
    </div>
  );
  const h = now?.getHours() ?? 12, who = me ? me.firstName || me.name[0].toUpperCase() + me.name.slice(1) : '';
  return <h1 id="title">{now ? `${h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}${who ? `, ${who}` : ''}` : 'Hello'}</h1>;
}

const WMO: Record<number, string> = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog', 51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle',
  56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm' };
const CLOUD_UP = 'M7 15h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 15z';
const WICON: Record<string, string> = {
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: PATHS.moon,
  partly: 'M8 3v1.5M3.5 8H5M4.8 4.8l1 1M11.2 4.8l-1 1M5.6 10.4A3 3 0 1 1 10.7 7.4M9 20h8a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.4A2.8 2.8 0 0 0 9 20z',
  cloud: 'M7 19h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 19z',
  fog: 'M4 8h16M3 12h18M5 16h14M8 20h8',
  rain: `${CLOUD_UP}M8 18l-1 3M12 18l-1 3M16 18l-1 3`,
  snow: `${CLOUD_UP}M8 18v3M6.6 19.5h2.8M16 18v3M14.6 19.5h2.8M12 19v2`,
  thunder: `${CLOUD_UP}M12.5 15l-2 3.5h3l-2 3.5`,
};
function weatherIcon(code: number | null | undefined, day: boolean | undefined) {
  if (code == null) return null;
  if (code <= 1) return day === false ? 'moon' : 'sun';
  if (code === 2) return day === false ? 'cloud' : 'partly';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'rain';
}
type Pos = { lat: number; lon: number; at: number; city: string };
type Wx = { temp: number; text: string; code: number; day: boolean; city: string; at: number };
function position(): Promise<Pos | null> {
  const cached = store.get<Pos>('media.pos');
  if (cached && Date.now() - cached.at < 7 * 86400000) return Promise.resolve(cached);
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(async (p) => {
      const pos: Pos = { lat: +p.coords.latitude.toFixed(2), lon: +p.coords.longitude.toFixed(2), at: Date.now(), city: '' };
      try {
        const g = await (await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${pos.lat}&longitude=${pos.lon}&localityLanguage=en`)).json();
        pos.city = g.city || g.locality || '';
      } catch { /* no town name: the temperature alone */ }
      store.set('media.pos', pos); resolve(pos);
    }, () => resolve(null), { timeout: 10000, maximumAge: 3600000 });
  });
}
async function weather(): Promise<Wx | null> {
  const w = store.get<Wx>('media.wx');
  if (w && Date.now() - w.at < 20 * 60000) return w;
  const pos = await position(); if (!pos) return null;
  try {
    const d = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${pos.lat}&longitude=${pos.lon}&current=temperature_2m,weather_code,is_day&timezone=auto`)).json();
    const fresh: Wx = { temp: d.current.temperature_2m, text: WMO[d.current.weather_code] ?? '', code: d.current.weather_code, day: d.current.is_day !== 0, city: pos.city, at: Date.now() };
    store.set('media.wx', fresh);
    return fresh;
  } catch { return null; }
}

export function Weather() {
  const { me } = useApp();
  const [w, setW] = useState<Wx | null>(null);
  useEffect(() => {
    if (!me) return;
    let live = true;
    let t: ReturnType<typeof setInterval> | undefined;
    const go = () => weather().then((x) => { if (live && x) setW(x); });
    void getConfig().then((c) => { if (!live || !c.weather) return; void go(); t = setInterval(go, 20 * 60000); });
    return () => { live = false; clearInterval(t); };
  }, [me]);
  const icon = w ? weatherIcon(w.code, w.day) : null;
  return (
    <div className="weather" id="weather" hidden={!w}>
      <span className="w-icon" id="w-icon" hidden={!icon}>
        {icon && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={WICON[icon]} /></svg>}
      </span>
      <span className="w-txt"><span className="w-temp" id="w-temp">{w ? `${Math.round(w.temp)} °C` : ''}</span><span className="w-city" id="w-city">{w?.city || ''}</span></span>
    </div>
  );
}
