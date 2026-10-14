// Number Compounds: a bold number under each structure, in the order a reader meets them,
// following the arrows of a scheme (starting materials before products), else left to right
// and top to bottom. Structures drawn as reagents over an arrow get none.

import type { Doc } from '../model';
import type { Vec } from '../geom';
import type { Measure } from '../editor/arrange';
import { itemFinder, reactionSteps, schemeItems, type Item } from './reaction';
import { labelsOf } from './scheme-layout';
import { readingOrder } from './scheme-arrange';
import { plainText } from '../richtext';

/** How compound IDs count: 1, 2, 3; 1a, 1b, 1c; a, b, c; A, B, C; i, ii, iii; I, II, III. */
export type IdStyle = 'numbers' | 'letters' | 'lower' | 'upper' | 'roman' | 'ROMAN';

export interface NumberOptions {
  /** The first number (for a, b, c and i, ii, iii: 1 is a or i). */
  start: number;
  /** How they count (1, 2, 3 unless given). */
  style?: IdStyle;
  /** Letters after one number (1a, 1b, 1c…): the same as style 'letters'. */
  letters?: boolean;
  /** Text before and after each ID, such as "S" and "" for S1, S2. */
  prefix?: string;
  suffix?: string;
  /** Leave structures that have a number already as they are (else they are numbered again). */
  keep?: boolean;
  /** Number reagents drawn above or below arrows too. */
  reagents?: boolean;
  /**
   * The same structure gets the same ID: a key for a structure (its canonical SMILES), given
   * its atoms. Structures with the same key share an ID; without it each gets its own.
   */
  keyOf?: (atoms: number[]) => string | undefined;
}

/** a, b, … z, aa, ab, … for 1, 2, … 26, 27, 28. */
export function letterId(n: number): string {
  let out = '';
  for (let k = Math.max(1, Math.floor(n)); k > 0; k = Math.floor((k - 1) / 26)) out = String.fromCharCode(97 + ((k - 1) % 26)) + out;
  return out;
}

/** Roman numerals in lower case: 1 is i, 4 is iv, 14 is xiv. */
export function romanId(n: number): string {
  let k = Math.max(1, Math.floor(n)), out = '';
  for (const [v, r] of [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']] as [number, string][]) {
    while (k >= v) { out += r; k -= v; }
  }
  return out;
}

/** The value of a roman numeral (either case), or null. */
export function fromRoman(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!/^[ivxlcdm]+$/.test(t)) return null;
  const val: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const v = val[t[i]], next = val[t[i + 1]] ?? 0;
    n += v < next ? -v : v;
  }
  return romanId(n) === t ? n : null;
}

/** The k-th ID (k from 0) counting from `start` in a style. */
export function idText(style: IdStyle, start: number, k: number, prefix = '', suffix = ''): string {
  const n = start + k;
  const core = style === 'letters' ? `${start}${letterId(k + 1)}`
    : style === 'lower' ? letterId(n)
    : style === 'upper' ? letterId(n).toUpperCase()
    : style === 'roman' ? romanId(n)
    : style === 'ROMAN' ? romanId(n).toUpperCase()
    : String(n);
  return prefix + core + suffix;
}

/** Where to start, read from what was typed: 3, c or iii (as fits the style). */
export function parseIdStart(text: string, style: IdStyle): number | null {
  const t = text.trim();
  if (/^\d+$/.test(t)) return Number(t);
  if (style === 'roman' || style === 'ROMAN') return fromRoman(t);
  if ((style === 'lower' || style === 'upper') && /^[a-z]+$/i.test(t)) {
    let n = 0;
    for (const ch of t.toLowerCase()) n = n * 26 + (ch.charCodeAt(0) - 96);
    return n;
  }
  return null;
}

export interface NumberPlan {
  /** For each structure, in order: its number, and the caption that already holds one (to change), or where a new one goes (its top centre). */
  labels: { item: Item; text: string; caption?: number; at: Vec }[];
}

/** The numbers to give the structures among `atoms` (all of them when empty). */
export function planNumbers(doc: Doc, m: Measure, atoms: Set<number>, opts: NumberOptions): NumberPlan {
  const bond = doc.style.bondLength;
  const items = schemeItems(doc, m);
  const find = itemFinder(items);
  const steps = reactionSteps(doc, items);
  // reagents drawn as structures over arrows
  const reagents = new Set<Item>();
  if (!opts.reagents) for (const { roles } of steps) for (const ref of [...roles.above, ...roles.below]) { const it = find(ref); if (it?.atoms.length) reagents.add(it); }
  let structures = items.filter((it) => it.atoms.length && !reagents.has(it));
  if (atoms.size) structures = structures.filter((it) => it.atoms.some((a) => atoms.has(a)));

  // order: reading order, but a product never before its starting materials
  const reading = readingOrder(structures, bond);
  const rank = new Map(reading.map((it, i) => [it, i]));
  const before = new Map<Item, Set<Item>>(reading.map((it) => [it, new Set<Item>()]));
  for (const { roles } of steps) {
    const rs = roles.reactants.map(find).filter((x): x is Item => !!x && rank.has(x));
    const ps = roles.products.map(find).filter((x): x is Item => !!x && rank.has(x));
    for (const p of ps) for (const r of rs) if (r !== p) before.get(p)!.add(r);
  }
  const order: Item[] = [];
  const done = new Set<Item>();
  while (order.length < reading.length) {
    const ready = reading.filter((it) => !done.has(it) && [...before.get(it)!].every((r) => done.has(r)));
    // a loop (a catalytic cycle): carry on from the first not yet numbered
    const next = ready[0] ?? reading.find((it) => !done.has(it))!;
    order.push(next);
    done.add(next);
  }

  const labels = labelsOf(items, new Set(), doc, bond);
  const out: NumberPlan['labels'] = [];
  const style: IdStyle = opts.style ?? (opts.letters ? 'letters' : 'numbers');
  const key = (it: Item) => opts.keyOf?.(it.atoms);
  // the same structure, the same ID: kept labels come first, so a copy elsewhere takes its ID
  const given = new Map<string, string>();
  const taken = new Set<string>();
  if (opts.keep) {
    for (const it of order) {
      const had = labels.get(it)?.[0];
      if (!had) continue;
      const text = plainText(doc.captions.get(had.caption!)!.runs).trim();
      taken.add(text);
      const k = key(it);
      if (k && !given.has(k)) given.set(k, text);
    }
  }
  let next = 0;
  const fresh = () => {
    let t: string;
    do t = idText(style, opts.start, next++, opts.prefix, opts.suffix); while (taken.has(t));
    return t;
  };
  for (const it of order) {
    const had = labels.get(it)?.[0];
    if (opts.keep && had) continue;
    const k = key(it);
    let text = k ? given.get(k) : undefined;
    if (text === undefined) { text = fresh(); if (k) given.set(k, text); }
    out.push({ item: it, text, caption: had?.caption, at: { x: (it.box.x1 + it.box.x2) / 2, y: it.box.y2 + 0.3 * bond } });
  }
  return { labels: out };
}

/**
 * Labels that clash: the same ID under structures that are not the same compound. Takes each
 * label's caption, text and the key of its structure (canonical SMILES; none when it couldn't be read), and
 * gives the captions to warn about with the text to show.
 */
export function labelClashes(labels: { caption: number; text: string; key?: string }[]): Map<number, string> {
  const byText = new Map<string, { caption: number; key?: string }[]>();
  for (const l of labels) {
    const t = l.text.trim();
    if (!t) continue;
    byText.set(t, [...(byText.get(t) ?? []), l]);
  }
  const out = new Map<number, string>();
  for (const [t, ls] of byText) {
    // (a structure that couldn't be read has no key, and is left out rather than guessed at)
    const known = ls.filter((l) => l.key);
    const keys = new Set(known.map((l) => l.key));
    if (keys.size < 2) continue;
    for (const l of known) out.set(l.caption, `The label “${t}” is used for ${keys.size} different structures.`);
  }
  return out;
}

/** The number in a compound label (2 in "2", "2a" or "(±)-2"), if it has one. */
export function labelNumber(text: string): number | null {
  const m = /(\d+)[a-z]?\s*$/.exec(text.trim());
  return m ? Number(m[1]) : null;
}

/** The next free compound number in a drawing: one more than the largest already under a structure. */
export function nextNumber(doc: Doc, m: Measure): number {
  const items = schemeItems(doc, m);
  let max = 0;
  for (const caps of labelsOf(items, new Set(), doc, doc.style.bondLength).values()) {
    for (const c of caps) { const k = labelNumber(plainText(doc.captions.get(c.caption!)!.runs)); if (k !== null) max = Math.max(max, k); }
  }
  return max + 1;
}
