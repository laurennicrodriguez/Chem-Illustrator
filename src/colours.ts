// The drawing's colour palette and fill tints.

import type { Doc } from './model';

/** Colours offered in every drawing, before the ones it already uses. */
export const STANDARD_COLOURS = [
  '#000000', '#e3001b', '#f28c28', '#f5c400', '#2e8b57',
  '#00a3a3', '#1f5fbf', '#7a3fb0', '#d81b8c', '#808080',
];

/** How many colours the palette shows at most. */
export const PALETTE_SIZE = 20;

const norm = (c: string) => c.trim().toLowerCase();

/** Every colour used in the drawing, in the order first met. */
export function usedColours(doc: Doc): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (c: string | undefined) => {
    if (!c || !/^#[0-9a-f]{6}$/i.test(c.trim())) return;
    const k = norm(c);
    if (!seen.has(k)) { seen.add(k); out.push(k); }
  };
  for (const a of doc.atoms.values()) add(a.color);
  for (const b of doc.bonds.values()) add(b.color);
  for (const r of doc.arrows.values()) add(r.color);
  for (const s of doc.shapes.values()) { add(s.color); add(s.fillColor); }
  for (const c of doc.captions.values()) for (const r of c.runs) add(r.color);
  return out;
}

/** The palette: the standard colours, then the drawing's own, up to twenty in all. */
export function documentColours(doc: Doc): string[] {
  const out = [...STANDARD_COLOURS];
  for (const c of usedColours(doc)) {
    if (out.length >= PALETTE_SIZE) break;
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** A colour mixed with white: `amount` 0 leaves it, 1 makes it white. */
export function tint(colour: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(colour.trim());
  if (!m) return colour;
  const v = parseInt(m[1], 16);
  const ch = (shift: number) => Math.round(((v >> shift) & 255) + (255 - ((v >> shift) & 255)) * amount);
  return '#' + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('');
}

/** How light a faded fill is (the colour mixed with this much white). */
export const FADE = 0.7;

/** Lighten (tint > 0) or darken a colour as Excel does, by its lightness (ECMA-376 part 1, 18.8.19). */
export function applyTint(hex: string, tint: number): string {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let out: number[];
  if (s === 0) out = [l, l, l];
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    out = [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
  }
  return out.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
