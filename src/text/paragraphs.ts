// Paragraphs of a styled text. The text itself is a list of runs (see richtext.ts), with a line
// break between paragraphs; each paragraph's own formatting (list, level, alignment, spacing) is
// kept in a list beside it, one entry per paragraph. These functions keep the two in step as
// the text is edited, and work out the bullets and numbers of lists.

import type { ParaStyle, TextRun } from '../model';

const KEYS = ['list', 'level', 'cont', 'align', 'spaceBefore', 'spaceAfter', 'indent', 'style', 'pageBreak', 'colBreak', 'firstLine', 'line', 'keepNext', 'indentRight', 'linePt', 'lineRule'] as const;

/** A paragraph style with nothing unset or zero, so two styles compare simply. */
export function cleanPara(p: ParaStyle | undefined): ParaStyle {
  const o: Record<string, unknown> = {};
  if (!p) return o;
  for (const k of KEYS) {
    const v = p[k];
    if (v === undefined || v === null || v === false || v === 0) continue;
    o[k] = v;
  }
  // a level or a continuation means nothing outside a list
  if (!o.list) { delete o.level; delete o.cont; }
  return o as ParaStyle;
}

export const samePara = (a: ParaStyle | undefined, b: ParaStyle | undefined): boolean =>
  JSON.stringify(cleanPara(a)) === JSON.stringify(cleanPara(b));

/** Number of paragraphs in a text (one more than its line breaks). */
export function paraCount(text: string): number {
  let n = 1;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

/** One style per paragraph: missing ones filled in as plain, extra ones dropped. */
export function fitParas(paras: ParaStyle[] | undefined, n: number): ParaStyle[] {
  const out: ParaStyle[] = [];
  for (let i = 0; i < n; i++) out.push(cleanPara(paras?.[i]));
  return out;
}

/** The paragraph styles to store: none at all when every paragraph is plain. */
export function storedParas(paras: ParaStyle[]): ParaStyle[] | undefined {
  const clean = paras.map(cleanPara);
  return clean.some((p) => Object.keys(p).length) ? clean : undefined;
}

/** Which paragraph a place in the text is in. */
export function paraAt(text: string, offset: number): number {
  let n = 0;
  for (let i = text.indexOf('\n'); i >= 0 && i < offset; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

/** Where a paragraph starts and ends in the text (the end is before its line break). */
export function paraRange(text: string, index: number): { start: number; end: number } {
  let start = 0;
  for (let k = 0; k < index; k++) {
    const nl = text.indexOf('\n', start);
    if (nl < 0) return { start: text.length, end: text.length };
    start = nl + 1;
  }
  const nl = text.indexOf('\n', start);
  return { start, end: nl < 0 ? text.length : nl };
}

/** The paragraphs that the text between two places touches (first and last index). */
export function parasBetween(text: string, start: number, end: number): [number, number] {
  return [paraAt(text, start), paraAt(text, end)];
}

/**
 * The paragraph styles after the text between `start` and `end` is replaced by `inserted`.
 * Paragraphs joined by the change keep the style of the first one; new paragraphs (each line
 * break typed or pasted) carry on the style of the one they were split from, as Enter does in
 * a list, unless `insertedParas` gives styles of their own (text pasted with its formatting).
 */
export function editParas(paras: ParaStyle[], text: string, start: number, end: number, inserted: string, insertedParas?: ParaStyle[]): ParaStyle[] {
  const all = fitParas(paras, paraCount(text));
  const a = paraAt(text, start), b = paraAt(text, end);
  const breaks = paraCount(inserted) - 1;
  const base = all[a];
  const carry = (): ParaStyle => {
    const p = { ...base };
    delete p.cont;
    // a page break stays with the first part of a paragraph split in two
    delete p.pageBreak;
    delete p.colBreak;
    return cleanPara(p);
  };
  const mid: ParaStyle[] = [base];
  for (let k = 1; k <= breaks; k++) mid.push(insertedParas?.[k] ? cleanPara(insertedParas[k]) : carry());
  // pasted paragraphs replace the style of the one pasted into when they start it
  if (insertedParas?.[0] && breaks > 0 && start === paraRange(text, a).start) mid[0] = cleanPara(insertedParas[0]);
  return [...all.slice(0, a), ...mid, ...all.slice(b + 1)];
}

/** Change the style of the paragraphs from `first` to `last`. */
export function patchParas(paras: ParaStyle[], first: number, last: number, patch: Partial<ParaStyle>): ParaStyle[] {
  return paras.map((p, i) => (i < first || i > last ? p : cleanPara({ ...p, ...patch })));
}

// ------------------------------------------------------------------ list markers

/** Bullets for each level, as PowerPoint and Word use them. All can be saved for ChemDraw. */
export const BULLETS = ['•', '–', '•', '–', '»'];

const roman = (n: number): string => {
  const parts: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = '';
  for (const [v, r] of parts) while (n >= v) { s += r; n -= v; }
  return s;
};
const letters = (n: number): string => {
  let s = '';
  while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
};

/** How the n-th item (from 1) of a numbered list at a level is numbered: 1. then a. then i. */
export function numberLabel(n: number, level: number): string {
  const k = level % 3;
  return `${k === 0 ? String(n) : k === 1 ? letters(n) : roman(n)}.`;
}

/**
 * The bullet or number shown in front of each paragraph (null for none). Numbers count up
 * through a list and start again after a paragraph that is not in it; a deeper level starts
 * again under each item of the level above.
 */
export function listMarkers(paras: ParaStyle[]): (string | null)[] {
  const counts: number[] = [];
  const kinds: (string | undefined)[] = [];
  return paras.map((p) => {
    if (!p.list) { counts.length = 0; kinds.length = 0; return null; }
    const level = Math.max(0, Math.min(8, p.level ?? 0));
    if (p.cont) return null;
    // a different kind of list at this level starts counting again
    if (kinds[level] !== p.list) counts[level] = 0;
    kinds[level] = p.list;
    counts[level] = (counts[level] ?? 0) + 1;
    counts.length = level + 1;
    kinds.length = level + 1;
    return p.list === 'bullet' ? BULLETS[level % BULLETS.length] : numberLabel(counts[level], level);
  });
}

// ------------------------------------------------------------------ text helpers

/** Split runs at line breaks into the runs of each paragraph (empty paragraphs give []). */
export function splitParagraphs(runs: TextRun[]): TextRun[][] {
  const out: TextRun[][] = [[]];
  for (const r of runs) {
    r.text.split('\n').forEach((t, i) => {
      if (i > 0) out.push([]);
      if (t) out[out.length - 1].push({ ...r, text: t });
    });
  }
  return out;
}
