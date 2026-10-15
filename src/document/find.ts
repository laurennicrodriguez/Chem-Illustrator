// Find and replace in a document's text. Finding works on the letters alone (CH2Cl2 is found
// however its 2s are formatted, and CH₂Cl₂ typed with subscript characters finds it too); a
// replacement can also change how the text looks, such as making every CH2Cl2 a formula.

import type { TextRun } from '../model';
import * as rt from '../richtext';
import { OBJECT_CHAR } from './document';
import { parseRev, trackedReplace, type Revisable } from './revisions';

export interface FindOptions {
  /** Capitals and small letters must match. */
  matchCase?: boolean;
  /** Only whole words (or formulas): "Me" doesn't find the "me" in "method". */
  wholeWord?: boolean;
}

/** How replaced text looks. `plain` first takes off bold, italic, underline, subscript, superscript and formula. */
export interface ReplaceLook {
  plain?: boolean;
  formula?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  sub?: boolean;
  sup?: boolean;
}

const SUBS = '₀₁₂₃₄₅₆₇₈₉', SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** What is looked for, with subscript and superscript characters as the plain ones the text keeps. */
export function plainQuery(q: string): string {
  return q.replace(/[₀-₉⁰¹²³⁴-⁹⁺⁻₊₋]/g, (c) => {
    const i = SUBS.indexOf(c), j = SUPS.indexOf(c);
    if (i >= 0) return String(i);
    if (j >= 0) return String(j);
    return c === '⁺' || c === '₊' ? '+' : '-';
  });
}

const wordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);

/** Every place the words are found, in order (never across a paragraph's end, a figure or a field). */
export function findAll(text: string, query: string, opts: FindOptions = {}): [number, number][] {
  const q = plainQuery(query);
  if (!q) return [];
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), opts.matchCase ? 'gu' : 'giu');
  const out: [number, number][] = [];
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const a = m.index, b = a + m[0].length;
    re.lastIndex = a + 1;
    if (m[0].includes('\n') || m[0].includes(OBJECT_CHAR)) continue;
    if (opts.wholeWord && (wordChar(text[a - 1]) || wordChar(text[b]))) continue;
    if (out.length && a < out[out.length - 1][1]) continue;
    out.push([a, b]);
  }
  return out;
}

/** The change a look makes to a run's formatting (null: none). */
export function lookPatch(look: ReplaceLook): Partial<rt.RunStyle> | null {
  const p: Partial<rt.RunStyle> = {};
  if (look.plain) Object.assign(p, { bold: undefined, italic: undefined, underline: undefined, sub: undefined, sup: undefined, formula: undefined });
  if (look.bold) p.bold = true;
  if (look.italic) p.italic = true;
  if (look.underline) p.underline = true;
  // formula, subscript and superscript each set where characters sit, so the last one chosen wins
  if (look.formula) Object.assign(p, { formula: true, sub: undefined, sup: undefined });
  if (look.sub) Object.assign(p, { sub: true, sup: undefined, formula: undefined });
  if (look.sup) Object.assign(p, { sup: true, sub: undefined, formula: undefined });
  return Object.keys(p).length ? p : null;
}

/**
 * Put the replacement in place of each found range (from the last, so earlier offsets hold).
 * The new text takes the formatting of the first found character, then the look. With no
 * replacement text but a look, the found text stays and only its look changes; with neither,
 * the found text goes.
 */
export function replaceRanges(runs: TextRun[], hits: [number, number][], replacement: string, look: ReplaceLook = {}, fallback: rt.RunStyle = {}): TextRun[] {
  const patch = lookPatch(look);
  const keep = !replacement && patch !== null;
  let out = runs;
  for (const [a, b] of [...hits].sort((x, y) => y[0] - x[0])) {
    if (keep) { out = rt.applyStyle(out, a, b, patch!); continue; }
    const style = rt.typingStyle(out, a, b, fallback);
    out = rt.replaceRange(out, a, b, replacement ? [{ ...style, text: replacement }] : []);
    if (patch && replacement) out = rt.applyStyle(out, a, a + replacement.length, patch);
  }
  return out;
}

/**
 * Replace the found places while changes are tracked: each one is marked deleted, with the
 * replacement after it marked inserted. Returns the text and where the caret goes after the
 * last place replaced (the first in the text).
 */
export function trackedReplaceRanges<T extends Revisable>(t: T, hits: [number, number][], replacement: string, look: ReplaceLook, fallback: rt.RunStyle, who: { author: string; date: string }): { t: T; caret: number } {
  const patch = lookPatch(look);
  let caret = 0;
  for (const [a, b] of [...hits].sort((x, y) => y[0] - x[0])) {
    const style = rt.typingStyle(t.runs, a, b, fallback);
    const got = trackedReplace(t, a, b, replacement ? [{ ...style, text: replacement }] : [], undefined, who);
    t = got.t;
    caret = got.caret;
    if (patch && replacement) t = { ...t, runs: rt.applyStyle(t.runs, got.caret - replacement.length, got.caret, patch) };
  }
  return { t, caret };
}

/** Leave out places in text deleted while tracking changes (still there, struck through, but gone from what the text says). */
export function withoutDeleted(runs: TextRun[], hits: [number, number][]): [number, number][] {
  const del: [number, number][] = [];
  let at = 0;
  for (const r of runs) {
    if (parseRev(r.rev)?.kind === 'del') del.push([at, at + r.text.length]);
    at += r.text.length;
  }
  if (!del.length) return hits;
  return hits.filter(([a, b]) => !del.some(([x, y]) => a < y && b > x));
}

/** Where a found range ends up after the ranges before it were replaced (for keeping the selection on the next one). */
export function shiftAfter(hits: [number, number][], replacement: string, keep: boolean, at: number): number {
  if (keep) return at;
  let d = 0;
  for (const [a, b] of hits) if (b <= at) d += replacement.length - (b - a);
  return at + d;
}
