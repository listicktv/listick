// The look's colours, without React, so the layout's before-paint script can use them too.
// accents: all light enough for the dark text that sits on the accent (today's date, tags, play buttons); 6 + custom = one row
export const ACCENTS: [string, string][] = [['Amber', '#f5a524'], ['Rose', '#fb7185'], ['Violet', '#c4b5fd'], ['Sky', '#8fd3ff'], ['Teal', '#5eead4'], ['Green', '#34d399']];
export const PLAIN: [string, string][] = [['Navy', '#0b1020'], ['Slate', '#151b27'], ['Ocean', '#0a1b26'], ['Graphite', '#121317'], ['Indigo', '#10132e'],
  ['Teal', '#08201f']];
// a hue at a fixed saturation and lightness, as #rrggbb: custom accents stay light (readable under dark text), custom
// backgrounds stay dark (the light text reads on them). Self-contained: the layout inlines its source
export function hslHex(h: number, s: number, l: number) {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, '0');
  return `#${f(0)}${f(8)}${f(4)}`;
}
const ACCENT_SL = [0.85, 0.72] as const;
export const BG_SL = [0.45, 0.1] as const;
export const hueHex = (h: number) => hslHex(h, ...ACCENT_SL);
export const bgHex = (h: number) => hslHex(h, ...BG_SL);
