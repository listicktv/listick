'use client';
// Settings › Region & services: your country (smart lists start with it), the language you want titles in (where TMDB has
// them), and the services you pay for in your country, as its logos in TMDB's order for it (its first 24, then all). Each
// change goes to Listick at once. ServiceGrid is the builder's too
import { useEffect, useState } from 'react';
import { Drop } from './Drop';
import { getJ, postJ } from './lib/api';
import { say } from './lib/format';
import { guessCountry, type Country, type Prefs, type RegionInfo, type Service } from './lib/region';

export function ServiceGrid({ services, on, toggle }: { services: Service[]; on: (id: number) => boolean; toggle: (id: number) => void }) {
  const [all, setAll] = useState(false), shown = all ? services : services.slice(0, 24);
  return (
    <>
      <div className="svc-grid">
        {shown.map((s) => (
          <button key={s.id} type="button" className={`svc${on(s.id) ? ' on' : ''}`} aria-pressed={on(s.id)} onClick={() => toggle(s.id)}>
            <span className="svc-c">{s.logo ? <img src={s.logo} alt="" /> : <b>{s.name[0]}</b>}</span><span className="svc-n">{s.name}</span>
          </button>
        ))}
      </div>
      {services.length > 24 && <button type="button" className="svc-all" onClick={() => setAll(!all)}>{all ? 'Fewer' : `All ${services.length}`}</button>}
    </>
  );
}

export function RegionPane() {
  const [p, setP] = useState<Prefs | null>(null), [got, setGot] = useState<{ cc: string; r: RegionInfo } | null>(null), [err, setErr] = useState('');
  const [langs, setLangs] = useState<Country[] | null>(null);
  useEffect(() => { let live = true; getJ<{ languages: Country[] }>('/api/lists/options').then((o) => { if (live) setLangs(o.languages); }, () => {}); return () => { live = false; }; }, []);
  const country = p ? p.country || guessCountry() : null;
  useEffect(() => { let live = true; getJ<Prefs>('/api/region').then((x) => { if (live) setP(x); }, (e: Error) => { if (live) setErr(e.message); }); return () => { live = false; }; }, []);
  useEffect(() => { if (!country) return; let live = true; getJ<RegionInfo>(`/api/region/${country}`).then((r) => { if (live) setGot({ cc: country, r }); }, () => {}); return () => { live = false; }; }, [country]);
  const save = async (b: { country: string; services?: number[]; lang?: string }) => {
    const ans: Partial<Prefs> = {}, e = await postJ('/api/region', b, ans as Record<string, unknown>);
    if (e) setErr(say(e) || e); else { setErr(''); setP((x) => x && { ...x, country: ans.country ?? x.country, services: ans.services ?? x.services, lang: ans.lang !== undefined ? ans.lang : x.lang }); }
  };
  if (!p || !country) return err ? <p className="acct-note">{`Couldn't load your region (${err}).`}</p> : null;
  // the services shown are the picked country's only, so none of the last one's show while the new ones come
  const name = p.countries.find((c) => c.id === country)?.name || country, mine = new Set(p.services), r = got?.cc === country ? got.r : null;
  return (
    <div className="reg">
      <div className="reg-dds">
        <Drop label="Country" search opts={p.countries.map((c) => [c.id, c.name])} value={country} set={(c) => void save({ country: c })} />
        {langs && <Drop label="Titles in" search opts={[['', 'English'], ...langs.filter((l) => l.id !== 'en').map((l): [string, string] => [l.id, l.name])]} value={p.lang || ''}
          set={(lang) => void save({ country, lang })} />}
      </div>
      <div className="reg-sec">
        <div className="reg-h"><span className="dd-l">{`My services · ${name}`}</span><span className="reg-n">{p.services.length}</span></div>
        {r ? <ServiceGrid services={r.services} on={(id) => mine.has(id)} toggle={(id) => void save({ country, services: mine.has(id) ? p.services.filter((x) => x !== id) : [...p.services, id] })} />
          : <p className="acct-note">Loading {name}&apos;s services…</p>}
      </div>
      {err && <p className="acct-err">{err}</p>}
    </div>
  );
}
