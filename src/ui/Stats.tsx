'use client';
// The Stats page (/stats): what you watched in a period, picked by three circles (the last 12 months, this year, all time).
// Totals, then plays by month as stacked layers (by year for all time), your year as dots with your streaks, what you watch as
// three rings, top genres, your ratings and the day of the week as rings, most watched beside a 24-hour clock, and your ratings
// against TMDB's beside the films you watched again. Every mark says its numbers on hover.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { getJ } from './lib/api';
import { Icon, PATHS } from './lib/icons';

type Kind = 'movie' | 'tv' | 'anime';
type Count = { key: string; title: string; poster: string | null; kind: Kind; n: number };
type Pick = { key: string; title: string; mine: number; theirs: number };
type Stats = {
  period: string; from: number; to: number; byYear: boolean; years: number[];
  totals: { plays: number; episodes: number; movies: number; titles: number; days: number; span: number; ratings: number; avg: number | null; hours: number | null };
  kinds: Record<Kind, number>; months: ({ at: string } & Record<Kind, number>)[];
  days: Record<string, number>; streaks: { longest: number; current: number; busiest: { day: string; plays: number } | null };
  genres: ({ name: string } & Record<Kind, number>)[]; top: Count[]; again: Count[];
  ratings: { hist: Record<string, number>; vs: { n: number; avg: number; higher: number; lower: number; more: Pick[]; less: Pick[] } | null };
  weekdays: number[]; hours: number[];
};
const KINDS: [Kind, string, string][] = [['movie', 'Movies', PATHS.movie], ['tv', 'Shows', PATHS.tv], ['anime', 'Anime', PATHS.anime]];
const KIND_ONE: Record<Kind, string> = { movie: 'Movie', tv: 'Show', anime: 'Anime' };
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const fmt = (n: number) => n.toLocaleString('en-GB');
const mon = (ym: string) => new Date(`${ym}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'short' });
const nice = (m: number) => [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000].find((x) => m / x <= 5) || 5000;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// a ringed circle: the face, a ring of --c filled to fill %, anything inside
export function Ring({ size = 48, w = 4, fill = 100, c, on, children, style }: { size?: number; w?: number; fill?: number; c?: string; on?: boolean; children?: ReactNode; style?: CSSProperties }) {
  return <span className={`st-ring${on ? ' on' : ''}`} style={{ '--s': `${size}px`, '--w': `${w}px`, '--fill': `${fill}%`, ...(c ? { '--c': c } : {}), ...style } as CSSProperties}>{children}</span>;
}

export function Stats() {
  const thisYear = new Date().getFullYear();
  const [period, setPeriod] = useState('12m');
  const [got, setGot] = useState<{ period: string; s: Stats } | null>(null);
  const [err, setErr] = useState('');
  const [tip, setTip] = useState<{ x: number; y: number; t: string } | null>(null);
  useEffect(() => {
    let live = true;
    getJ<Stats>(`/api/stats?period=${period}`).then((s) => { if (live) { setGot({ period, s }); setErr(''); } }, (e: Error) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [period]);
  // hover: a tooltip by the pointer
  const hov = (t: string) => ({ onPointerMove: (e: React.PointerEvent) => setTip({ x: e.clientX, y: e.clientY, t }), onPointerLeave: () => setTip(null) });
  const s = got?.s;
  const periods: [string, ReactNode, string][] = [['12m', <b key="b">12m</b>, '12 months'], [String(thisYear), <b key="b">{String(thisYear).slice(2)}</b>, String(thisYear)], ['all', <Icon key="i" d={PATHS.plus} size={18} width={2} />, 'All time']];

  return (
    <div className="stats">
      <div className="st-head">
        <h1 className="st-title">Stats</h1>
        <div className="st-period" role="group" aria-label="Period">
          {periods.map(([id, face, name]) => (
            <button key={id} type="button" className={period === id ? 'on' : ''} aria-pressed={period === id} onClick={() => setPeriod(id)}><Ring on={period === id}>{face}</Ring>{name}</button>
          ))}
        </div>
      </div>
      {err && <p className="st-note">{`Couldn't load your stats (${err}).`}</p>}
      {s && !s.totals.plays && <section className="glass st-card st-empty"><Ring size={56}><Icon d={PATHS.stats} size={22} width={1.9} /></Ring><span>Nothing watched in this period yet.</span></section>}
      {s && !!s.totals.plays && <Body s={s} hov={hov} />}
      {tip && <div className="st-tip" style={{ left: Math.min(tip.x + 12, (typeof window !== 'undefined' ? innerWidth : 9999) - 260), top: tip.y - 40 }}>{tip.t}</div>}
    </div>
  );
}

type Hov = (t: string) => { onPointerMove: (e: React.PointerEvent) => void; onPointerLeave: () => void };
function Body({ s, hov }: { s: Stats; hov: Hov }) {
  const t = s.totals, total = s.kinds.movie + s.kinds.tv + s.kinds.anime;
  const rmax = Math.max(1, ...Object.values(s.ratings.hist)), wmax = Math.max(1, ...s.weekdays);
  return (
    <>
      <section className="glass st-totals" aria-label="Totals">
        <Tot icon={PATHS.play} v={fmt(t.plays)} k="Plays" sub={`${fmt(t.days)} days with a play`} />
        <Tot icon={PATHS.tv} v={fmt(t.episodes)} k="Episodes" sub={`${fmt(s.kinds.tv)} shows · ${fmt(s.kinds.anime)} anime`} />
        <Tot icon={PATHS.movie} v={fmt(t.movies)} k="Movies" sub={t.hours != null ? `${fmt(t.hours)} hours watched in all` : t.movies ? `about one every ${fmt(Math.max(1, Math.round(t.span / t.movies)))} days` : 'none yet'} />
        <Tot icon={PATHS.lists} v={fmt(t.titles)} k="Titles" sub="shows, anime, movies" />
        <div className="st-tot"><Ring size={52} w={5} fill={(t.avg || 0) * 10} c="var(--accent)" style={{ color: 'var(--accent)' }}><b>{t.avg ?? '–'}</b></Ring>
          <div><b className="acc">{fmt(t.ratings)}</b><span>Ratings, your average</span><small>out of 10</small></div></div>
      </section>

      <div className="st-grid">
        <section className="glass st-card c12">
          <div className="st-ch"><h2>{s.byYear ? 'Plays by year' : 'Plays by month'}</h2><Legend /></div>
          <Months s={s} hov={hov} />
        </section>

        <section className="glass st-card c8">
          <div className="st-ch"><h2>Your year</h2><div className="st-heat-key">Fewer {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`h${l}`} />)} More</div></div>
          <Heat s={s} hov={hov} />
          <div className="st-streaks">
            <div className="st-streak"><Ring size={54} c="var(--accent)" style={{ color: 'var(--accent)' }}><b>{s.streaks.longest}</b></Ring><span>Longest streak<br /><small>days in a row</small></span></div>
            <div className="st-streak"><Ring size={54} c="var(--accent)" fill={pct(s.streaks.current, s.streaks.longest)}><b>{s.streaks.current}</b></Ring><span>Current streak<br /><small>of your best {s.streaks.longest}</small></span></div>
            {s.streaks.busiest && <div className="st-streak"><Ring size={54}><Icon d={PATHS.cal} size={22} width={1.9} /></Ring>
              <span><b>{fmt(s.streaks.busiest.plays)} plays</b><br /><small>busiest day, {new Date(`${s.streaks.busiest.day}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: s.byYear ? 'numeric' : undefined })}</small></span></div>}
          </div>
        </section>

        <section className="glass st-card c4 center">
          <div className="st-ch"><h2>What you watch</h2></div>
          <div className="st-kinds">
            {KINDS.map(([k, name, icon]) => (
              <div key={k} {...hov(`${name} · ${fmt(s.kinds[k])} plays`)}><Ring size={84} w={6} c={`var(--st-${k})`} fill={pct(s.kinds[k], total)}><Icon d={icon} size={26} width={1.9} /></Ring>
                <b>{pct(s.kinds[k], total)}%</b><span>{fmt(s.kinds[k])} {k === 'movie' ? 'movies' : `episodes of ${k === 'tv' ? 'shows' : 'anime'}`}</span></div>
            ))}
          </div>
        </section>

        <section className="glass st-card c5">
          <div className="st-ch"><h2>Top genres</h2><Legend /></div>
          <Genres s={s} hov={hov} />
        </section>
        <div className="st-stack c7">
          <section className="glass st-card">
            <div className="st-ch"><h2>Your ratings</h2>{t.avg != null && <span className="st-legend">avg <b className="acc mono">{t.avg}</b></span>}</div>
            {t.ratings ? (
              <div className="st-circles">
                {[4, 5, 6, 7, 8, 9, 10].filter((r) => s.ratings.hist[r] || (r >= 5 && r <= 9)).map((r) => { const n = s.ratings.hist[r] || 0, top = n === rmax;
                  return <div key={r} {...hov(`Rated ${r} · ${n} titles`)}><Ring size={54} w={5} c="var(--accent)" fill={pct(n, rmax)} style={top ? { color: 'var(--accent)' } : undefined}><b>{r}</b></Ring><b>{fmt(n)}</b><span>titles</span></div>; })}
              </div>
            ) : <p className="st-note">No ratings in this period.</p>}
          </section>
          <section className="glass st-card">
            <div className="st-ch"><h2>By day of the week</h2></div>
            <div className="st-circles wd">
              {s.weekdays.map((n, i) => <div key={i} {...hov(`${WD[i]} · ${fmt(n)} plays`)}><Ring size={64} w={6} c="var(--accent)" fill={pct(n, wmax)} style={n === wmax ? { color: 'var(--accent)' } : undefined}><b>{WD[i]}</b></Ring><b>{fmt(n)}</b><span>plays</span></div>)}
            </div>
          </section>
        </div>

        <section className="glass st-card c7">
          <div className="st-ch"><h2>Most watched</h2></div>
          <List items={s.top} unit="episodes" />
        </section>
        <section className="glass st-card c5 center">
          <div className="st-ch"><h2>By hour</h2></div>
          <Clock hours={s.hours} hov={hov} />
        </section>

        <section className="glass st-card c7">
          <div className="st-ch"><h2>You vs everyone</h2>{s.ratings.vs && <span className="st-legend">your rating against TMDB&apos;s, {fmt(s.ratings.vs.n)} titles</span>}</div>
          {s.ratings.vs ? <Vs vs={s.ratings.vs} /> : <p className="st-note">No ratings in this period.</p>}
        </section>
        <section className="glass st-card c5">
          <div className="st-ch"><h2>Watched again</h2></div>
          {s.again.length ? <List items={s.again} unit="times" /> : <p className="st-note">No film watched twice in this period.</p>}
        </section>
      </div>
    </>
  );
}

function Tot({ icon, v, k, sub }: { icon: string; v: string; k: string; sub: string }) {
  return <div className="st-tot"><Ring size={52}><Icon d={icon} size={22} width={1.9} /></Ring><div><b>{v}</b><span>{k}</span><small>{sub}</small></div></div>;
}
const Legend = () => <div className="st-legend">{KINDS.map(([k, name]) => <span key={k}><i style={{ background: `var(--st-${k})` }} />{name}</span>)}</div>;

// plays by month (or year): smooth stacked layers, movies at the base, a ringed dot on each total
function Months({ s, hov }: { s: Stats; hov: Hov }) {
  const [at, setAt] = useState<number | null>(null);
  // a phone draws it narrower, so its marks and labels stay readable
  const [narrow, setNarrow] = useState(false);
  useEffect(() => { const m = matchMedia('(max-width: 800px)'), on = () => setNarrow(m.matches); on(); m.addEventListener('change', on); return () => m.removeEventListener('change', on); }, []);
  const W = narrow ? 520 : 1180, H = narrow ? 280 : 250, L = 40, R = 24, B = 26, T = 22, ms = s.months;
  const tots = ms.map((m) => m.movie + m.tv + m.anime), max = Math.max(1, ...tots), step = nice(max), top = Math.ceil(max / step) * step;
  const y = (v: number) => H - B - (v / top) * (H - B - T), x = (i: number) => (ms.length > 1 ? L + 14 + (i / (ms.length - 1)) * (W - L - R - 28) : (L + W) / 2);
  const curve = (pts: number[][]) => pts.map((p, i) => { if (!i) return `M${p[0]},${p[1]}`; const p0 = pts[i - 2] || pts[i - 1], p1 = pts[i - 1], p3 = pts[i + 1] || p;
    return `C${p1[0] + (p[0] - p0[0]) / 6},${Math.min(y(0), p1[1] + (p[1] - p0[1]) / 6)} ${p[0] - (p3[0] - p1[0]) / 6},${Math.min(y(0), p[1] - (p3[1] - p1[1]) / 6)} ${p[0]},${p[1]}`; }).join(' ');
  const cum = [['movie'], ['movie', 'tv'], ['movie', 'tv', 'anime']].map((ks) => ms.map((m) => ks.reduce((a, k) => a + m[k as Kind], 0)));
  const slot = ms.length > 1 ? (W - L - R - 28) / (ms.length - 1) : W - L - R;
  const ticks = []; for (let v = 0; v <= top; v += step) ticks.push(v);
  return (
    <svg className="st-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={s.byYear ? 'Plays per year, by kind' : 'Plays per month, by kind'}>
      <defs>{KINDS.map(([k]) => <linearGradient key={k} id={`st-g-${k}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={`var(--st-${k})`} stopOpacity="0.95" /><stop offset="1" stopColor={`var(--st-${k})`} stopOpacity="0.55" /></linearGradient>)}</defs>
      {ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="st-grid-l" strokeDasharray={v ? '2 6' : undefined} /><text x={L - 8} y={y(v) + 4} textAnchor="end" className="st-axis">{v}</text></g>)}
      {KINDS.map(([k], j) => {
        const upper = cum[j].map((v, i) => [x(i), y(v)]), lower = (j ? cum[j - 1] : ms.map(() => 0)).map((v, i) => [x(i), y(v)]).reverse();
        return <g key={k}><path d={`${curve(upper)} L${lower.map((p) => p.join(',')).join(' L')} Z`} fill={`url(#st-g-${k})`} /><path d={curve(upper)} fill="none" className="st-gap" /></g>;
      })}
      {at != null && <line x1={x(at)} x2={x(at)} y1={T - 6} y2={H - B} className="st-guide" />}
      {ms.map((m, i) => {
        const last = i === ms.length - 1 && !s.byYear, label = s.byYear ? m.at : mon(m.at), every = ms.length > (narrow ? 7 : 16) ? Math.ceil(ms.length / (narrow ? 6 : 12)) : 1;
        return (
          <g key={m.at}>
            <circle cx={x(i)} cy={y(tots[i])} r={last ? 8 : 6} className={last ? 'st-dot now' : 'st-dot'} />
            {(ms.length <= (narrow ? 7 : 16) || tots[i] === max || i === ms.length - 1) && <text x={x(i)} y={y(tots[i]) - 13} textAnchor="middle" className="st-vlab">{fmt(tots[i])}</text>}
            {i % every === 0 && <text x={x(i)} y={H - 6} textAnchor="middle" className="st-axis">{label}</text>}
            <rect x={x(i) - slot / 2} y={T - 10} width={slot} height={H - B - T + 10} className="st-hit" onPointerEnter={() => setAt(i)}
              {...(() => { const h = hov(`${s.byYear ? m.at : `${mon(m.at)} ${m.at.slice(0, 4)}`} · ${fmt(tots[i])} plays · ${m.movie} movies · ${m.tv} shows · ${m.anime} anime`); return { ...h, onPointerLeave: () => { setAt(null); h.onPointerLeave(); } }; })()} />
          </g>
        );
      })}
    </svg>
  );
}

// the period's last 53 weeks as dots, weeks as columns from Monday; five steps by the quartiles of the active days
function Heat({ s, hov }: { s: Stats; hov: Hov }) {
  const cells = useMemo(() => {
    const end = new Date(s.to), start = new Date(end); start.setDate(start.getDate() - 364); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const vals = Object.values(s.days).sort((a, b) => a - b), q = (p: number) => vals[Math.floor(p * (vals.length - 1))] || 0, cuts = [q(0.25), q(0.5), q(0.75)];
    const out: { w: number; r: number; d: Date; v: number; l: number; m?: string }[] = [];
    let lastM = -1;
    for (let d = new Date(start), i = 0; d <= end; d.setDate(d.getDate() + 1), i++) {
      const v = s.days[ymd(d)] || 0, r = (d.getDay() + 6) % 7, c = { w: Math.floor(i / 7), r, d: new Date(d), v, l: !v ? 0 : v <= cuts[0] ? 1 : v <= cuts[1] ? 2 : v <= cuts[2] ? 3 : 4 } as (typeof out)[number];
      if (r === 0 && d.getMonth() !== lastM) { lastM = d.getMonth(); c.m = d.toLocaleDateString('en-GB', { month: 'short' }); }
      out.push(c);
    }
    return out;
  }, [s]);
  const cell = 11, gap = 3, L = 28, T = 16, weeks = (cells.at(-1)?.w || 0) + 1;
  // scrolled to the latest weeks where it doesn't fit (a phone)
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (box.current) box.current.scrollLeft = box.current.scrollWidth; }, [cells]);
  return (
    <div className="st-heat" ref={box}>
      <svg className="st-svg" viewBox={`0 0 ${L + weeks * (cell + gap)} ${T + 7 * (cell + gap)}`} role="img" aria-label="Plays per day">
        {['Mon', '', 'Wed', '', 'Fri', '', ''].map((d, i) => d && <text key={i} x={0} y={T + i * (cell + gap) + 9} className="st-axis">{d}</text>)}
        {cells.map((c) => (
          <g key={c.d.getTime()}>
            {c.m && <text x={L + c.w * (cell + gap)} y={10} className="st-axis">{c.m}</text>}
            <circle cx={L + c.w * (cell + gap) + cell / 2} cy={T + c.r * (cell + gap) + cell / 2} r={cell / 2} className={`h${c.l}`}
              {...hov(`${c.d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · ${c.v ? `${c.v} play${c.v > 1 ? 's' : ''}` : 'nothing'}`)} />
          </g>
        ))}
      </svg>
    </div>
  );
}

function Genres({ s, hov }: { s: Stats; hov: Hov }) {
  const max = Math.max(1, ...s.genres.map((g) => g.movie + g.tv + g.anime));
  return (
    <div className="st-bars">
      {s.genres.map((g) => { const tot = g.movie + g.tv + g.anime;
        return (
          <div key={g.name} className="st-bar" {...hov(`${g.name} · ${g.movie} movies · ${g.tv} shows · ${g.anime} anime`)}>
            <span className="n">{g.name}</span>
            <div className="t" style={{ width: `${(tot / max) * 100}%` }}>{KINDS.filter(([k]) => g[k]).map(([k]) => <div key={k} style={{ flex: g[k], background: `var(--st-${k})` }} />)}</div>
            <b>{fmt(tot)}</b>
          </div>
        ); })}
    </div>
  );
}

function List({ items, unit }: { items: Count[]; unit: string }) {
  return (
    <div className="st-list">
      {items.map((x, i) => (
        <div key={x.key} className="st-row">
          <Ring size={30} w={3}><b>{i + 1}</b></Ring>
          <span className="st-ps">{x.poster && <img src={x.poster} alt="" loading="lazy" />}<i style={{ background: `var(--st-${x.kind})` }} /></span>
          <span className="st-nm"><b>{x.title}</b><span>{KIND_ONE[x.kind]}</span></span>
          <span className="st-ct">{fmt(x.n)}<small>{unit}</small></span>
        </div>
      ))}
    </div>
  );
}

// by hour: a 24-hour clock, a rounded bar out from the ring for each hour (midnight at the top), the busiest in the middle
function Clock({ hours, hov }: { hours: number[]; hov: Hov }) {
  const cx = 160, cy = 160, r0 = 58, r1 = 128, m = Math.max(1, ...hours), peak = hours.indexOf(m);
  return (
    <svg className="st-svg st-clock" viewBox="-10 -10 340 340" role="img" aria-label="Plays per hour of the day, as a clock">
      <circle cx={cx} cy={cy} r={r0 - 8} className="st-face" />
      {[0.5, 1].map((f) => <circle key={f} cx={cx} cy={cy} r={r0 + (r1 - r0) * f} className="st-ringl" />)}
      {hours.map((v, h) => {
        const a = (h / 24) * 2 * Math.PI - Math.PI / 2, len = (v / m) * (r1 - r0), x0 = cx + Math.cos(a) * r0, y0 = cy + Math.sin(a) * r0;
        const x1 = cx + Math.cos(a) * (r0 + len), y1 = cy + Math.sin(a) * (r0 + len), hx = cx + Math.cos(a) * (r1 + 2), hy = cy + Math.sin(a) * (r1 + 2);
        return (
          <g key={h}>
            {v ? <line x1={x0} y1={y0} x2={x1} y2={y1} className={h === peak ? 'st-hr peak' : 'st-hr'} /> : <circle cx={x0} cy={y0} r={2} className="st-hr0" />}
            {h % 6 === 0 && <text x={cx + Math.cos(a) * (r1 + 20)} y={cy + Math.sin(a) * (r1 + 20) + 4} textAnchor="middle" className="st-axis">{String(h).padStart(2, '0')}</text>}
            <circle cx={(x0 + hx) / 2} cy={(y0 + hy) / 2} r={15} className="st-hit" {...hov(`${String(h).padStart(2, '0')}:00 · ${fmt(v)} plays`)} />
          </g>
        );
      })}
      <text x={cx} y={cy + 2} textAnchor="middle" className="st-clock-t">{String(peak).padStart(2, '0')}:00</text>
      <text x={cx} y={cy + 18} textAnchor="middle" className="st-axis">busiest</text>
    </svg>
  );
}

function Vs({ vs }: { vs: NonNullable<Stats['ratings']['vs']> }) {
  const same = vs.n - vs.higher - vs.lower, sign = vs.avg > 0 ? '+' : vs.avg < 0 ? '−' : '±';
  const rows = (list: Pick[]) => list.map((r) => <p key={r.key}><span>{r.title}</span><b>{r.mine} <small>vs {r.theirs}</small></b></p>);
  return (
    <>
      <div className="st-vs">
        <div className="st-vs-big"><Ring size={84} w={6} c="var(--accent)" fill={50 + vs.avg * 10} style={{ color: 'var(--accent)' }}><b>{sign}{Math.abs(vs.avg).toFixed(1)}</b></Ring><span>on average</span></div>
        <div className="st-vs-split"><div><b className="hi">{fmt(vs.higher)}</b><span>you rated higher</span></div><div><b>{fmt(same)}</b><span>about the same</span></div><div><b className="lo">{fmt(vs.lower)}</b><span>you rated lower</span></div></div>
      </div>
      <div className="st-vs-lists">
        <div><h3>Liked more than most</h3>{rows(vs.more)}</div>
        <div><h3>Liked less than most</h3>{rows(vs.less)}</div>
      </div>
    </>
  );
}
