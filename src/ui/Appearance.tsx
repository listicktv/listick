'use client';
// Appearance (the palette by the search, and a section of Settings): the accent and the background colour, each six
// swatches or a custom hue. Listick is dark only. Each change applies at once and is kept on this device.
import { useState, type CSSProperties } from 'react';
import { useApp } from './App';
import { Icon, PATHS } from './lib/icons';
import { ACCENTS, PLAIN, bgHex, hueHex } from './lib/colors';
import { setLook, useLook } from './lib/look';
import { Sheet } from './Sheet';

export function Appearance() {
  const { look: sheet, closeLook } = useApp();
  return <Sheet id="look" title="APPEARANCE" open={!!sheet} from={sheet?.from ?? null} onClose={closeLook}>{sheet && <LookRows />}</Sheet>;
}

export function LookRows() {
  const look = useLook();
  const [hueOpen, setHueOpen] = useState(false), [bgOpen, setBgOpen] = useState(false);
  const isCustom = !ACCENTS.some(([, c]) => c === look.accent);

  return (
    <>
      <div className="look-row"><span className="look-k">Accent</span>
        <div className="swatches" id="swatches">
          {ACCENTS.map(([n, c]) => (
            <button key={n} type="button" className="swatch" aria-label={n} aria-pressed={look.accent === c} style={{ background: c, '--sw': c } as CSSProperties} onClick={() => setLook({ accent: c })} />
          ))}
          <button type="button" className="swatch custom" aria-label="Custom accent colour" aria-pressed={isCustom} aria-expanded={hueOpen}
            style={{ '--sw': look.accent, ...(isCustom ? { background: look.accent } : {}) } as CSSProperties}
            onClick={() => { const next = !hueOpen; setHueOpen(next); if (next && !isCustom) setLook({ accent: hueHex(look.hue ?? 200) }); }}>
            <Icon d={PATHS.customAccent} />
          </button>
        </div>
      </div>
      <label className="look-row hue-row" id="hue-row" hidden={!hueOpen}><span className="look-k">Custom colour</span>
        <input type="range" id="hue" min="0" max="359" step="1" aria-label="Custom accent hue" value={look.hue ?? 200}
          onChange={(e) => setLook({ accent: hueHex(Number(e.target.value)), hue: Number(e.target.value) })} />
      </label>
      <div className="look-row"><span className="look-k">Background</span>
        <div className="swatches" id="bg-colors">
          {PLAIN.map(([n, c]) => (
            <button key={n} type="button" className="swatch" aria-label={`${n} background`} aria-pressed={look.bg === n}
              style={{ background: c, '--sw': 'var(--accent)' } as CSSProperties} onClick={() => setLook({ bg: n })} />
          ))}
          <button type="button" className="swatch custom" aria-label="Custom background colour" aria-pressed={look.bg === 'custom'} aria-expanded={bgOpen}
            style={{ '--sw': 'var(--accent)', ...(look.bg === 'custom' ? { background: bgHex(look.bgHue ?? 230) } : {}) } as CSSProperties}
            onClick={() => { const next = !bgOpen; setBgOpen(next); if (next && look.bg !== 'custom') setLook({ bg: 'custom', bgHue: look.bgHue ?? 230 }); }}>
            <Icon d={PATHS.customAccent} />
          </button>
        </div>
      </div>
      <label className="look-row hue-row bg-hue" hidden={!bgOpen}><span className="look-k">Custom background</span>
        <input type="range" min="0" max="359" step="1" aria-label="Custom background hue" value={look.bgHue ?? 230}
          onChange={(e) => setLook({ bg: 'custom', bgHue: Number(e.target.value) })} />
      </label>
    </>
  );
}
