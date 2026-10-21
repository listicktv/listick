// The page's line icons (one path each, drawn in the text colour) and Listick's logo in the chosen accent.
export const PATHS = {
  home: 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10',
  lists: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  stats: 'M5 20v-8M12 20V5M19 20v-11M3 20h18',
  play: 'M8 5l11 7-11 7z',
  movie: 'M3 5h18v14H3zM7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4',
  tv: 'M3 7h18v12H3zM8 3l4 4l4-4',
  anime: 'M3 6.5h18M5 4c4.5 1.3 9.5 1.3 14 0M7 6.5V20M17 6.5V20M6 10.5h12',   // a torii gate
  palette: 'M12 3a9 9 0 1 0 0 18c1 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.1-4-7.5-9-7.5zM7.5 11.5h.01M9.5 7.5h.01M14.5 7.5h.01M17 11h.01',
  gear: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  person: 'M12 12a4 4 0 1 0 0-8a4 4 0 1 0 0 8zM4.5 20c.9-3.5 3.9-5.5 7.5-5.5s6.6 2 7.5 5.5',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM20 20l-3.5-3.5',
  signOut: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10',
  pen: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  tick: 'M5 12.5l4.5 4.5L19 7',
  watched: 'M2.5 12.5l4.5 4.5 9.5-10.5M12 16.5l1 1 9.5-10.5',   // a double tick, as the posters' Mark watched
  plus: 'M12 5v14M5 12h14',
  cross: 'M6 6l12 12M18 6L6 18',
  people: 'M9 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM2 21c0-4 3-7 7-7s7 3 7 7M16 3.5a4 4 0 0 1 0 7.5M22 21c0-3-1.7-5.5-4-6.5',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  globe: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  star: 'M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.8l-5.1 2.7 1-5.7-4.1-4 5.7-.8z',
  cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  bookmark: 'M6.5 3.5h11v17l-5.5-3.8-5.5 3.8z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  customAccent: 'M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16v4z',
} as const;

// a line icon: 18 px with a 2 px stroke unless told otherwise
export function Icon({ d, size = 18, width = 2, className }: { d: string; size?: number; width?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
  );
}

// Listick's logo (a navy disc, the play, a ring around the disc stopping at the tick badge, and the
// badge) on its own, no tile; play, ring and badge in the accent colour
const ACCENT_OK = /^#[0-9a-fA-F]{6}$/;
// ring: the ring's width in the mark's units (5.2 by default; the side menu's is thicker, like its circles' rings)
export function mediaMark(accent: string | undefined, ring = 5.2) {
  const a = ACCENT_OK.test(accent || '') ? accent : '#f5a524';
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.3 0 66.6 66.6"><defs><mask id="m"><rect x="-1" y="-1" width="70" height="70" fill="#fff"/><circle cx="54.63" cy="54.83" r="14.6" fill="#000"/></mask></defs><g mask="url(#m)"><circle cx="32" cy="32.2" r="${32 - ring / 2}" fill="none" stroke="${a}" stroke-width="${ring}"/><circle cx="32" cy="32.2" r="${32 - ring}" fill="#121726"/><path d="M26.7 21.7L46 32.1L26.7 42.5Z" fill="${a}" stroke="${a}" stroke-width="1.2" stroke-linejoin="round"/></g><circle cx="54.63" cy="54.83" r="11.5" fill="${a}"/><circle cx="54.63" cy="54.83" r="9.47" fill="#121726"/><path transform="translate(54.63 54.83) scale(0.97) translate(-49.3 -49.2)" d="M42.7 49.4l2.8 2.9l5.4-6.1M49.5 51.3l1 1l5.4-6.1" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`)}`;
}
