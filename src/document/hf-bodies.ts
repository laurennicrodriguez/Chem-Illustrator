// Headers and footers as Word has them: a different first page (a title page's), different odd
// and even pages (the page number on the outside edge of a bound thesis), and headers with
// more than plain text: a logo, a table, formatted text and fields (from Word, or a picture
// added here). Plain headers stay three pieces of text (left, centre, right) and a page number;
// one with pictures or tables is kept as Word's paragraphs (a "body"), laid out and drawn on
// each page and saved back as it was.

import type { ParaStyle, TextRun } from '../model';
import * as rt from '../richtext';
import { fieldText, type FieldObj } from './fields';
import type { DocObject, DocText, HeaderFooter, HfBody, HfKey, HfZones, NumberPlace } from './document';

export const HF_KEYS: HfKey[] = ['header', 'footer', 'firstHeader', 'firstFooter', 'evenHeader', 'evenFooter'];

const EMPTY: [string, string, string] = ['', '', ''];

/** Which header or footer a page shows: the first page's, an even page's, or the usual one. */
export function hfKeyFor(hf: HeaderFooter, kind: 'header' | 'footer', starts: boolean, n: number): HfKey {
  if (hf.firstPage && starts) return kind === 'header' ? 'firstHeader' : 'firstFooter';
  if (hf.oddEven && n % 2 === 0) return kind === 'header' ? 'evenHeader' : 'evenFooter';
  return kind;
}

/** Header or footer, whichever page it is for. */
export const kindOf = (key: HfKey): 'header' | 'footer' => (/footer/i.test(key) ? 'footer' : 'header');

/** The plain text (left, centre, right) of a header or footer. */
export function zonesFor(hf: HeaderFooter, key: HfKey): [string, string, string] {
  const kind = kindOf(key);
  const set: HfZones | undefined = key.startsWith('first') ? hf.first : key.startsWith('even') ? hf.even : undefined;
  if (key === kind) return hf[kind];
  return set?.[kind] ?? EMPTY;
}

/** Where the page number goes on a page with this header or footer: the usual place, or on the other side on even pages. */
export function numbersFor(hf: HeaderFooter, key: HfKey): NumberPlace {
  if (!key.startsWith('even') || hf.numbers === 'none') return hf.numbers;
  return hf.numbers.endsWith('left') ? hf.numbers.replace('left', 'right') as NumberPlace : hf.numbers.endsWith('right') ? hf.numbers.replace('right', 'left') as NumberPlace : hf.numbers;
}

/** Every header and footer of a document: its own and each section's. */
export function allHf(t: Pick<DocText, 'hf'> & Partial<Pick<DocText, 'paras'>>): HeaderFooter[] {
  const out = [t.hf];
  for (const p of t.paras ?? []) if (p?.section?.hf) out.push(p.section.hf);
  return out;
}

/** The objects (pictures, tables, fields) the headers and footers hold. */
export function hfObjectIds(hfs: (HeaderFooter | undefined)[], objects: Record<number, DocObject>): number[] {
  const out: number[] = [];
  const add = (runs: TextRun[]) => {
    for (const r of runs) {
      if (r.obj === undefined) continue;
      out.push(r.obj);
      const o = objects[r.obj];
      if (o?.kind === 'table') for (const row of o.table.rows) for (const c of row) add(c.runs);
    }
  };
  for (const hf of hfs) for (const b of Object.values(hf?.bodies ?? {})) if (b) add(b.runs);
  return out;
}

/** What a field in a header or footer shows on a page: `num` is the page's number, `pages` how many there are. */
export function hfFieldText(o: FieldObj, t: Pick<DocText, 'runs' | 'paras' | 'props'>, num: string, pages: number): string {
  if (o.code === 'page') return num;
  if (o.code === 'numpages') return String(pages);
  return fieldText(o, { runs: t.runs, paras: t.paras, props: t.props }, 0, () => num, pages);
}

/**
 * A plain header or footer as a body: one paragraph with its left, centre and right text at a
 * centre and a right tab stop, and the page number (a PAGE field after `prefix`) in its place.
 */
export function bodyFromZones(zones: [string, string, string], numberAt: number, prefix: string, look: rt.RunStyle, width: number, pageField: () => number): HfBody {
  const runs: TextRun[] = [];
  for (let i = 0; i < 3; i++) {
    if (i > 0) runs.push({ ...look, text: '\t' });
    if (zones[i]) runs.push({ ...look, text: zones[i] });
    if (i === numberAt) {
      const lead = (zones[i] ? ' ' : '') + prefix;
      if (lead) runs.push({ ...look, text: lead });
      runs.push({ ...look, obj: pageField(), text: '￼' });
    }
  }
  const ps: ParaStyle = { spaceBefore: 0, spaceAfter: 0, tabs: [{ pos: width / 2, kind: 'center' }, { pos: width, kind: 'right' }] };
  return { runs: rt.normalizeRuns(runs.length ? runs : [{ ...look, text: '' }]), paras: [ps] };
}

/** Is there anything in a body (text, a picture, a table)? */
export const bodyEmpty = (b: HfBody | undefined): boolean => !b || !b.runs.some((r) => r.obj !== undefined || r.text.trim());

/**
 * A body with a run (a picture) put in at the start of its first line's left, centre or right
 * part (the text after its first or second tab), adding tabs to reach it.
 */
export function insertInZone(body: HfBody, zone: number, run: TextRun): HfBody {
  let runs = body.runs;
  let text = rt.plainText(runs);
  let end = text.indexOf('\n');
  if (end < 0) end = text.length;
  const tabs = [...text.slice(0, end)].filter((c) => c === '\t').length;
  if (tabs < zone) {
    const look = runs.length ? rt.styleOf(runs[runs.length - 1]) : {};
    runs = [...rt.sliceRuns(runs, 0, end), { ...look, text: '\t'.repeat(zone - tabs) }, ...rt.sliceRuns(runs, end, text.length)];
    text = rt.plainText(runs);
  }
  let at = 0;
  for (let k = 0; k < zone; k++) at = text.indexOf('\t', at) + 1;
  return { ...body, runs: rt.normalizeRuns([...rt.sliceRuns(runs, 0, at), run, ...rt.sliceRuns(runs, at, text.length)]) };
}
