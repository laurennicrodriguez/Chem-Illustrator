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

export interface NumberOptions {
  /** The first number. */
  start: number;
  /** Letters after one number (1a, 1b, 1c…) instead of 1, 2, 3. */
  letters?: boolean;
  /** Leave structures that have a number already as they are (else they are numbered again). */
  keep?: boolean;
  /** Number reagents drawn above or below arrows too. */
  reagents?: boolean;
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
  let n = opts.start, letter = 0;
  for (const it of order) {
    const had = labels.get(it)?.[0];
    if (opts.keep && had) continue;
    const text = opts.letters ? `${opts.start}${String.fromCharCode(97 + (letter++ % 26))}` : String(n++);
    out.push({ item: it, text, caption: had?.caption, at: { x: (it.box.x1 + it.box.x2) / 2, y: it.box.y2 + 0.3 * bond } });
  }
  return { labels: out };
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
