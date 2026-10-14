// Text widths from published font measurements, for documents. Times New Roman, Arial and
// Courier New (and the fonts made to match them: Liberation, Tinos, Arimo, Cousine, and Times,
// Helvetica and Courier in PDF files) are measured from tables rather than from the fonts on
// this computer, so a document breaks its lines in the same places on every computer, in the
// PDF it exports, and in Word. Other fonts are measured on screen.

import { UNITS_PER_EM, WIDTH_TABLES } from './font-widths';
import type { Measure } from './layout';

export type FontKind = 'serif' | 'sans' | 'mono';

const SERIF = /^(times new roman|times|liberation serif|tinos|nimbus roman( no9 l)?|tex gyre termes)$/i;
const SANS = /^(arial|helvetica|liberation sans|arimo|nimbus sans( l)?|tex gyre heros)$/i;
const MONO = /^(courier new|courier|liberation mono|cousine|nimbus mono( l| ps)?)$/i;

/** The first font in a CSS font list ("'Times New Roman', Arial, sans-serif" → Times New Roman). */
export function firstFamily(family: string): string {
  return family.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
}

/** Which measured font a family is (null for one measured on screen). */
export function fontKind(family: string): FontKind | null {
  const f = firstFamily(family);
  if (SERIF.test(f)) return 'serif';
  if (SANS.test(f)) return 'sans';
  if (MONO.test(f)) return 'mono';
  return null;
}

const tables = new Map<string, Map<number, number>>();

function table(key: string): Map<number, number> {
  let t = tables.get(key);
  if (t) return t;
  t = new Map();
  for (const part of (WIDTH_TABLES[key] ?? '').split(';')) {
    if (!part) continue;
    const [start, list] = part.split(':');
    let c = parseInt(start, 16);
    for (const w of list.split(',')) t.set(c++, Number(w));
  }
  tables.set(key, t);
  return t;
}

/** Width of one character in font units (UNITS_PER_EM to the text size), or null when the font has no measurement for it. */
export function charUnits(ch: string, kind: FontKind, bold: boolean, italic: boolean): number | null {
  const t = table(kind + (bold ? 'b' : '') + (italic ? 'i' : ''));
  const c = ch.codePointAt(0)!;
  const w = t.get(c);
  if (w !== undefined) return w;
  // an accented letter not in the table is as wide as the plain letter
  const base = ch.normalize('NFD').codePointAt(0)!;
  return base !== c ? t.get(base) ?? null : null;
}

/** Width of text in a measured font, or null when some character isn't measured. */
export function publishedWidth(text: string, size: number, kind: FontKind, bold: boolean, italic: boolean): number | null {
  let units = 0;
  for (const ch of text) {
    const w = charUnits(ch, kind, bold, italic);
    if (w === null) return null;
    units += w;
  }
  return (units / UNITS_PER_EM) * size;
}

/**
 * A way of measuring text for documents: published widths where there are some, otherwise
 * `fallback` (the fonts on screen). Characters without a measurement are measured with
 * `fallback` one by one, so the rest of the text keeps its published widths.
 */
export function documentMeasure(fallback: Measure): Measure {
  return (text, size, family, style) => {
    const kind = fontKind(family);
    if (!kind) return fallback(text, size, family, style);
    const bold = /bold/.test(style), italic = /italic/.test(style);
    const w = publishedWidth(text, size, kind, bold, italic);
    if (w !== null) return w;
    let total = 0;
    for (const ch of text) {
      const u = charUnits(ch, kind, bold, italic);
      total += u !== null ? (u / UNITS_PER_EM) * size : fallback(ch, size, family, style);
    }
    return total;
  };
}
