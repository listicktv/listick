'use client';
// Add to list (a poster's list circle): your manual lists, each with a tick circle that adds or takes the title out, then New
// list, which makes a list with the title in it
import { useEffect, useState } from 'react';
import { getJ, postJ } from './lib/api';
import { say } from './lib/format';
import { Icon, PATHS } from './lib/icons';
import { listsBus, listsChanged, type AddTo } from './lib/lists';
import { Sheet } from './Sheet';

type Row = { id: string; name: string; count: number; on: boolean };
export function AddToList() {
  const [at, setAt] = useState<AddTo | null>(null);
  const [m, setM] = useState<{ lists: Row[] } | null>(null);
  const [name, setName] = useState<string | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    const on = (e: Event) => { const a = (e as CustomEvent<AddTo>).detail; setAt(a); setM(null); setName(null); void getJ<{ lists: Row[] }>(`/api/lists/membership?key=${encodeURIComponent(a.key)}`).then(setM, () => setM({ lists: [] })); };
    listsBus.addEventListener('open', on);
    return () => listsBus.removeEventListener('open', on);
  }, []);
  const close = () => setAt(null);
  const toggle = async (l: Row) => {
    if (!at || !m) return;
    const on = !l.on, set = (v: boolean) => setM((x) => x && { ...x, lists: x.lists.map((y) => (y.id === l.id ? { ...y, on: v, count: y.count + (v ? 1 : -1) } : y)) });
    set(on);
    const err = await postJ(`/api/lists/${l.id}/item`, { key: at.key, on });
    if (err) { set(!on); alert(say(err)); } else listsChanged();
  };
  const create = async () => {
    if (!at || !name?.trim()) return;
    setBusy(true);
    const got: { id?: string } = {}, err = await postJ('/api/lists/new', { name, kind: 'manual', add: at.key }, got);
    setBusy(false);
    if (err) return alert(say(err));
    setName(null); listsChanged();
    setM(await getJ<{ lists: Row[] }>(`/api/lists/membership?key=${encodeURIComponent(at.key)}`));
  };
  const tick = (on: boolean) => <span className={`acct-c${on ? ' on' : ''}`}>{on && <Icon d={PATHS.tick} />}</span>;
  return (
    <Sheet id="atl" title="ADD TO LIST" open={!!at} from={at?.from ?? null} onClose={close}>
      {at && (
        <div className="atl">
          <p className="atl-t">{at.title}</p>
          {!m ? <p className="acct-note">Loading your lists…</p> : (
            <>
              {m.lists.map((l) => (
                <button key={l.id} type="button" className="look-row atl-row" onClick={() => void toggle(l)}>
                  <span className="look-k">{l.name}</span><span className="acct-v"><span className="acct-v-text">{l.count}</span>{tick(l.on)}</span>
                </button>
              ))}
              {name === null ? (
                <button type="button" className="look-row atl-row atl-new" onClick={() => setName('')}><span className="look-k">New list</span><span className="acct-v"><span className="acct-c on"><Icon d={PATHS.plus} /></span></span></button>
              ) : (
                <form className="acct-form atl-form" onSubmit={(e) => { e.preventDefault(); void create(); }}>
                  <div className="acct-line"><input className="field" autoFocus placeholder="List name" aria-label="List name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
                    <button type="submit" className="acct-c on" aria-label="Make the list and add this title" disabled={busy || !name.trim()}><Icon d={PATHS.tick} /></button></div>
                </form>
              )}
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
