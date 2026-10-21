'use client';
// A sheet (Appearance, Account): a popover beside the button that opened it on tablet and desktop, a bottom sheet on the phone.
// From the side rail it sits beside the rail with its foot level with the button (and stays there as it grows); from the top
// bar or a poster, just under the button (above it when there's no room below).
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

const phone = () => matchMedia('(max-width: 800px)').matches;
function place(p: HTMLElement, from: HTMLElement | null) {
  p.style.left = '';
  if (from?.closest('.siderail') && !phone()) {
    const r = from.getBoundingClientRect(), rail = from.closest('.siderail')!.getBoundingClientRect();
    p.style.right = ''; p.style.left = `${rail.right + 12}px`; p.style.top = `${Math.max(16, r.bottom - p.offsetHeight)}px`;
  } else if (from && !phone()) {
    // a poster low on the screen: above it instead
    const r = from.getBoundingClientRect(), below = r.bottom + 8 + p.offsetHeight <= window.innerHeight - 16;
    p.style.top = `${below ? r.bottom + 8 : Math.max(16, r.top - 8 - p.offsetHeight)}px`; p.style.right = `${Math.max(16, window.innerWidth - r.right)}px`;
  } else { p.style.top = ''; p.style.right = ''; }
}

export function Sheet({ id, title, open, from, onClose, onBackdrop, children }: { id: string; title: string; open: boolean; from: HTMLElement | null;
  onClose: () => void; onBackdrop?: (e: React.MouseEvent) => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null), close = useRef<HTMLButtonElement>(null);
  // placed on every render and whenever its size changes (rows open, the Account pane's data comes in), focus on the × when it opens
  useLayoutEffect(() => { if (open && panel.current) place(panel.current, from); });
  useEffect(() => {
    const p = panel.current; if (!open || !p) return;
    const ro = new ResizeObserver(() => place(p, from));
    ro.observe(p);
    return () => ro.disconnect();
  }, [open, from]);
  useLayoutEffect(() => { if (open) close.current?.focus(); }, [open]);
  return (
    <div className="look-scrim" id={`${id}-scrim`} hidden={!open} onClick={(e) => { if (e.target === e.currentTarget) (onBackdrop || onClose)(e); }}>
      <div ref={panel} className="glass look" id={id} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <div className="grabber" />
        <div className="look-head">
          <h2 className="sh" id={`${id}-title`}>{title}</h2>
          <button ref={close} type="button" className="look-x" id={`${id}-close`} aria-label="Close" onClick={onClose}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
