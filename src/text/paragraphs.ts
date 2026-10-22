// Paragraphs of a styled text. The text itself is a list of runs (see richtext.ts), with a line
// break between paragraphs; each paragraph's own formatting (list, level, alignment, spacing) is
// kept in a list beside it, one entry per paragraph. These functions keep the two in step as
// the text is edited, and work out the bullets and numbers of lists.

import type { ParaStyle, TextRun } from '../model';

const KEYS = ['list', 'level', 'cont', 'align', 'spaceBefore', 'spaceAfter', 'indent', 'style', 'pageBreak', 'colBreak', 'firstLine', 'line', 'keepNext', 'indentRight', 'linePt', 'lineRule', 'section', 'noLineNumbers', 'noHyphen', 'marks', 'tabs', 'scheme', 'bullet', 'border', 'shade'] as const;

/** A paragraph style with nothing unset or zero, so two styles compare simply. */
export function cleanPara(p: ParaStyle | undefined): ParaStyle {
  const o: Record<string, unknown> = {};
  if (!p) return o;
  for (const k of KEYS) {
    const v = p[k];
    if (v === undefined || v === null || v === false || v === 0 || v === '') continue;
    if (Array.isArray(v) && !v.length) continue;
    o[k] = v;
  }
  // a level or a continuation means nothing outside a list
  if (!o.list) { delete o.level; delete o.cont; delete o.scheme; delete o.bullet; }
  else if (o.list === 'bullet') delete o.scheme;
  else delete o.bullet;
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
    delete p.section;
    // and so does a bookmark
    delete p.marks;
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

/** How a level's numbers are written, by Word's names. */
export type NumFormat = 'decimal' | 'lowerLetter' | 'upperLetter' | 'lowerRoman' | 'upperRoman';

/** One level of a multilevel list: how its number is written, and its label, with %1, %2… standing for the numbers of levels 1, 2… (Word's lvlText). */
export interface SchemeLevel { fmt: NumFormat; text: string }

/** A multilevel list scheme (Home > Multilevel List): nine levels, as Word's list library has them. */
export interface ListScheme { id: string; name: string; levels: SchemeLevel[] }

const nine = (f: (i: number) => SchemeLevel): SchemeLevel[] => Array.from({ length: 9 }, (_, i) => f(i));
const CYCLE: NumFormat[] = ['decimal', 'lowerLetter', 'lowerRoman'];

/**
 * The multilevel lists offered. The first (1. a. i.) is the one a numbered list has unless
 * another is chosen; the rest are those of Word's list library that papers and reports use.
 */
export const LIST_SCHEMES: ListScheme[] = [
  { id: '', name: '1. a. i.', levels: nine((i) => ({ fmt: CYCLE[i % 3], text: `%${i + 1}.` })) },
  { id: 'outline', name: '1. 1.1. 1.1.1.', levels: nine((i) => ({ fmt: 'decimal', text: Array.from({ length: i + 1 }, (_, k) => `%${k + 1}`).join('.') + '.' })) },
  { id: 'legal', name: '1 1.1 1.1.1', levels: nine((i) => ({ fmt: 'decimal', text: Array.from({ length: i + 1 }, (_, k) => `%${k + 1}`).join('.') })) },
  { id: 'roman', name: 'I. A. 1. a. i.', levels: nine((i) => ({ fmt: (['upperRoman', 'upperLetter', 'decimal', 'lowerLetter', 'lowerRoman'] as NumFormat[])[i % 5], text: `%${i + 1}.` })) },
  { id: 'paren', name: '1) a) i)', levels: nine((i) => ({ fmt: CYCLE[i % 3], text: `%${i + 1})` })) },
  { id: 'brackets', name: '(1) (a) (i)', levels: nine((i) => ({ fmt: CYCLE[i % 3], text: `(%${i + 1})` })) },
  { id: 'steps', name: 'Step 1. a. i.', levels: nine((i) => (i === 0 ? { fmt: 'decimal', text: 'Step %1.' } : { fmt: CYCLE[i % 3], text: `%${i + 1}.` })) },
];

export function schemeOf(id: string | undefined): ListScheme {
  return LIST_SCHEMES.find((s) => s.id === (id ?? '')) ?? LIST_SCHEMES[0];
}

/**
 * The bullet library (Home > Bullets ▾): the bullets offered for a level, as in Word's. Every
 * one is a character of the text's own font or a common symbol font, so files show them too.
 */
export const BULLET_LIBRARY = ['•', '○', '■', '◆', '➢', '✓', '–', '★'];

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

/** A number written in a format: 3, c, C, iii, III. */
export function formatNumber(n: number, fmt: NumFormat): string {
  switch (fmt) {
    case 'lowerLetter': return letters(n);
    case 'upperLetter': return letters(n).toUpperCase();
    case 'lowerRoman': return roman(n);
    case 'upperRoman': return roman(n).toUpperCase();
    default: return String(n);
  }
}

/** A level's label from the counts of its level and the levels above it (counts[0] is level 1's). */
export function schemeLabel(scheme: ListScheme, level: number, counts: number[]): string {
  return scheme.levels[level].text.replace(/%(\d)/g, (_, d: string) => {
    const k = Number(d) - 1;
    return formatNumber(Math.max(1, counts[k] ?? 1), scheme.levels[k]?.fmt ?? 'decimal');
  });
}

/** How the n-th item (from 1) of a numbered list at a level is numbered: 1. then a. then i. */
export function numberLabel(n: number, level: number): string {
  const counts: number[] = [];
  counts[level] = n;
  return schemeLabel(LIST_SCHEMES[0], level % 9, counts);
}

/** Each paragraph's bullet or number (null for none), and whether a numbered list starts again there (at its top level). */
export interface ListInfo { marker: string | null; start: boolean }

/**
 * The bullet or number shown in front of each paragraph, and where numbered lists start.
 * Numbers count up through a list and start again after a paragraph that is not in it; a
 * deeper level starts again under each item of the level above, and a level of another kind
 * (or another scheme) starts again too.
 */
export function listInfo(paras: ParaStyle[]): ListInfo[] {
  const counts: number[] = [];
  const kinds: (string | undefined)[] = [];
  return paras.map((p) => {
    if (!p.list) { counts.length = 0; kinds.length = 0; return { marker: null, start: false }; }
    const level = Math.max(0, Math.min(8, p.level ?? 0));
    if (p.cont) return { marker: null, start: false };
    const kind = p.list === 'number' ? `n${p.scheme ?? ''}` : 'b';
    if (kinds[level] !== kind) counts[level] = 0;
    kinds[level] = kind;
    counts[level] = (counts[level] ?? 0) + 1;
    counts.length = level + 1;
    kinds.length = level + 1;
    if (p.list === 'bullet') return { marker: p.bullet || BULLETS[level % BULLETS.length], start: false };
    return { marker: schemeLabel(schemeOf(p.scheme), level, counts), start: level === 0 && counts[0] === 1 };
  });
}

/** The bullet or number shown in front of each paragraph (null for none). */
export function listMarkers(paras: ParaStyle[]): (string | null)[] {
  return listInfo(paras).map((x) => x.marker);
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
