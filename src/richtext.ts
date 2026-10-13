// Styled text for captions and labels: pure functions on runs of text, shared by the drawing
// code, the file readers and writers, and the caption editor. Offsets count characters of the
// plain text, with each line break counting as one.

import type { TextRun } from './model';

export type RunStyle = Omit<TextRun, 'text'>;
export type Toggle = 'bold' | 'italic' | 'underline' | 'sub' | 'sup' | 'formula';

const KEYS = ['bold', 'italic', 'underline', 'sub', 'sup', 'formula', 'size', 'font', 'color'] as const;
/** Subscript, superscript and formula style change where characters sit, so only one applies. */
const POSITION: Toggle[] = ['sub', 'sup', 'formula'];

/** A style with nothing switched off or unset, so two styles compare simply. */
export function cleanStyle(s: RunStyle): RunStyle {
  const o: Record<string, unknown> = {};
  for (const k of KEYS) {
    const v = s[k];
    if (v !== undefined && v !== false && v !== null) o[k] = v;
  }
  return o as RunStyle;
}

export function styleOf(r: TextRun): RunStyle {
  const { text: _, ...s } = r;
  return cleanStyle(s);
}

export function sameStyle(a: RunStyle, b: RunStyle): boolean {
  const x = cleanStyle(a), y = cleanStyle(b);
  for (const k of KEYS) if (x[k] !== y[k]) return false;
  return true;
}

/** Join neighbouring runs that look the same and drop empty ones. */
export function normalizeRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && sameStyle(last, r)) last.text += r.text;
    else out.push({ ...styleOf(r), text: r.text });
  }
  return out;
}

export const plainText = (runs: TextRun[]): string => runs.map((r) => r.text).join('');

/** The part of the runs between two offsets. */
export function sliceRuns(runs: TextRun[], start: number, end: number): TextRun[] {
  const out: TextRun[] = [];
  let at = 0;
  for (const r of runs) {
    const a = Math.max(start, at), b = Math.min(end, at + r.text.length);
    if (b > a) out.push({ ...r, text: r.text.slice(a - at, b - at) });
    at += r.text.length;
  }
  return out;
}

/** Put new runs in place of the text between two offsets. */
export function replaceRange(runs: TextRun[], start: number, end: number, insert: TextRun[]): TextRun[] {
  const n = plainText(runs).length;
  return normalizeRuns([...sliceRuns(runs, 0, start), ...insert, ...sliceRuns(runs, end, n)]);
}

export function insertText(runs: TextRun[], at: number, text: string, style: RunStyle): TextRun[] {
  return replaceRange(runs, at, at, [{ ...style, text }]);
}

export function deleteRange(runs: TextRun[], start: number, end: number): TextRun[] {
  return replaceRange(runs, start, end, []);
}

/** Style of the character at an offset, or null past the end. */
function charStyle(runs: TextRun[], i: number): RunStyle | null {
  let at = 0;
  for (const r of runs) {
    if (i < at + r.text.length) return styleOf(r);
    at += r.text.length;
  }
  return null;
}

/**
 * The style new typing takes: that of the first selected character, or with nothing selected,
 * of the character before the caret (as in a word processor), else the one after it.
 */
export function typingStyle(runs: TextRun[], start: number, end: number, fallback: RunStyle): RunStyle {
  const text = plainText(runs);
  if (end > start) return charStyle(runs, start) ?? fallback;
  if (start > 0 && text[start - 1] !== '\n') return charStyle(runs, start - 1) ?? fallback;
  return charStyle(runs, start) ?? (start > 0 ? charStyle(runs, start - 1) : null) ?? fallback;
}

/** What every character between two offsets has in common (for showing which buttons are on). */
export function commonStyle(runs: TextRun[], start: number, end: number): RunStyle {
  const parts = sliceRuns(runs, start, end).filter((r) => r.text.replace(/\n/g, ''));
  if (!parts.length) return {};
  const o: Record<string, unknown> = { ...styleOf(parts[0]) };
  for (const p of parts.slice(1)) {
    const s = styleOf(p);
    for (const k of KEYS) if (o[k] !== s[k]) delete o[k];
  }
  return o as RunStyle;
}

/** Change the style of the text between two offsets. A value of undefined or false removes it. */
export function applyStyle(runs: TextRun[], start: number, end: number, patch: Partial<RunStyle>): TextRun[] {
  if (end <= start) return normalizeRuns(runs.map((r) => ({ ...r })));
  const n = plainText(runs).length;
  const mid = sliceRuns(runs, start, end).map((r) => ({ ...cleanStyle({ ...styleOf(r), ...patch }), text: r.text }));
  return normalizeRuns([...sliceRuns(runs, 0, start), ...mid, ...sliceRuns(runs, end, n)]);
}

/** The change a button makes: off if every character already has it, otherwise on. */
export function togglePatch(current: RunStyle, key: Toggle, base: RunStyle = {}): Partial<RunStyle> {
  const on = !current[key];
  // turning a subscript or superscript off goes back to formula style if that is the default
  if (!on) return key !== 'formula' && POSITION.includes(key) && base.formula ? { [key]: undefined, formula: true } : { [key]: undefined };
  const patch: Partial<RunStyle> = { [key]: true };
  if (POSITION.includes(key)) for (const k of POSITION) if (k !== key) patch[k] = undefined;
  return patch;
}

export function toggleStyle(runs: TextRun[], start: number, end: number, key: Toggle, base: RunStyle = {}): TextRun[] {
  return applyStyle(runs, start, end, togglePatch(commonStyle(runs, start, end), key, base));
}

/** A style from ChemDraw's face bits. */
export function styleFromFace(face: number): RunStyle {
  const s: RunStyle = {};
  if (face & 1) s.bold = true;
  if (face & 2) s.italic = true;
  if (face & 4) s.underline = true;
  if ((face & 96) === 96) s.formula = true;
  else if (face & 32) s.sub = true;
  else if (face & 64) s.sup = true;
  return s;
}

export function faceFromStyle(r: RunStyle): number {
  return (r.bold ? 1 : 0) | (r.italic ? 2 : 0) | (r.underline ? 4 : 0) | (r.formula ? 96 : r.sub ? 32 : r.sup ? 64 : 0);
}

// ------------------------------------------------------------------ formula style

export type Part = { text: string; pos: 'base' | 'sub' | 'sup' };

/**
 * How formula style shows a piece of text: numbers straight after a letter or a closing bracket
 * are subscripts (CH3, Pd(PPh3)4), and a + or − ending a word there is a superscript charge
 * (NH4+, PhSO3−, Cl−). After a square bracket the number goes up with the charge
 * ([Fe(CN)6]3−). An ion's charge with a number, as in Fe3+, is shown Fe₃⁺; superscript the 3
 * by hand for Fe³⁺.
 */
export function formulaParts(text: string): Part[] {
  const out: Part[] = [];
  const push = (t: string, pos: Part['pos']) => {
    const last = out[out.length - 1];
    if (last && last.pos === pos) last.text += t;
    else out.push({ text: t, pos });
  };
  const wordEnd = /^[+\-−](?=$|[\s,;:)\]])/;
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const prev = i > 0 ? text[i - 1] : '';
    if (prev === ']') {
      const charge = /^\d*[+\-−](?=$|[\s,;:)\]])/.exec(rest);
      if (charge) { push(charge[0], 'sup'); i += charge[0].length; continue; }
    }
    if (/[A-Za-z)\]]/.test(prev)) {
      const count = /^\d+/.exec(rest);
      if (count) { push(count[0], 'sub'); i += count[0].length; continue; }
    }
    // a charge after a letter, a bracket or a subscript number
    if ((/[A-Za-z)\]]/.test(prev) || out[out.length - 1]?.pos === 'sub') && wordEnd.test(rest)) {
      push(rest[0], 'sup');
      i += 1;
      continue;
    }
    const plain = /^(\d+|[^\d])/.exec(rest)!;
    push(plain[0], 'base');
    i += plain[0].length;
  }
  return out;
}

// ------------------------------------------------------------------ the Symbol font

// ChemDraw writes Greek letters and some signs in the Symbol font, which puts them in place of
// ordinary letters (a for α, ® for →). This is the published Adobe Symbol encoding.
const SYMBOL_UPPER = 'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ';
const SYMBOL_LOWER = 'αβχδεφγηιϕκλμνοπθρστυϖωξψζ';
const SYMBOL_HIGH: Record<number, string> = {
  0xa1: 'ϒ', 0xa2: '′', 0xa3: '≤', 0xa4: '⁄', 0xa5: '∞', 0xa6: 'ƒ', 0xa7: '♣', 0xa8: '♦', 0xa9: '♥', 0xaa: '♠',
  0xab: '↔', 0xac: '←', 0xad: '↑', 0xae: '→', 0xaf: '↓', 0xb0: '°', 0xb1: '±', 0xb2: '″', 0xb3: '≥', 0xb4: '×',
  0xb5: '∝', 0xb6: '∂', 0xb7: '•', 0xb8: '÷', 0xb9: '≠', 0xba: '≡', 0xbb: '≈', 0xbc: '…', 0xc0: 'ℵ', 0xc4: '⊗',
  0xc5: '⊕', 0xc6: '∅', 0xc7: '∩', 0xc8: '∪', 0xce: '∈', 0xcf: '∉', 0xd0: '∠', 0xd1: '∇', 0xd5: '∏', 0xd6: '√',
  0xd7: '⋅', 0xd8: '¬', 0xdb: '⇔', 0xdc: '⇐', 0xdd: '⇑', 0xde: '⇒', 0xdf: '⇓', 0xe0: '◊', 0xe5: '∑', 0xf2: '∫',
  0x22: '∀', 0x24: '∃', 0x27: '∋', 0x2a: '∗', 0x2d: '−', 0x40: '≅', 0x5c: '∴', 0x5e: '⊥', 0x7e: '∼',
};
const FROM_SYMBOL = new Map<string, string>();
const TO_SYMBOL = new Map<string, string>();
for (let i = 0; i < 26; i++) {
  FROM_SYMBOL.set(String.fromCharCode(65 + i), SYMBOL_UPPER[i]);
  FROM_SYMBOL.set(String.fromCharCode(97 + i), SYMBOL_LOWER[i]);
}
for (const [k, v] of Object.entries(SYMBOL_HIGH)) FROM_SYMBOL.set(String.fromCharCode(Number(k)), v);
for (const [k, v] of FROM_SYMBOL) if (!TO_SYMBOL.has(v)) TO_SYMBOL.set(v, k);

export const isSymbolFont = (font: string | undefined): boolean => !!font && /^symbol$/i.test(font.trim());

/** Text written in the Symbol font, as the characters it shows. */
export function fromSymbolFont(text: string): string {
  let out = '';
  for (const ch of text) out += FROM_SYMBOL.get(ch) ?? ch;
  return out;
}

// Characters ChemDraw stores in an ordinary font: Latin-1 plus the extra Windows characters
// (curly quotes, dashes, bullet, dagger and so on).
const WIN_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const plainFontChar = (ch: string) => ch.charCodeAt(0) < 0x100 || WIN_EXTRA.has(ch);

/** Can this character be saved for ChemDraw (directly, or through the Symbol font)? */
export const savableChar = (ch: string): boolean => plainFontChar(ch) || TO_SYMBOL.has(ch);

/**
 * Split text for saving: characters an ordinary font can't hold but the Symbol font can
 * (Greek letters, arrows, ≤ and so on) come out as Symbol-font pieces.
 */
export function toSymbolPieces(text: string): { text: string; symbol: boolean }[] {
  const out: { text: string; symbol: boolean }[] = [];
  for (const ch of text) {
    const sym = !plainFontChar(ch) && TO_SYMBOL.has(ch);
    const t = sym ? TO_SYMBOL.get(ch)! : ch;
    const last = out[out.length - 1];
    if (last && last.symbol === sym) last.text += t;
    else out.push({ text: t, symbol: sym });
  }
  return out;
}
