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
