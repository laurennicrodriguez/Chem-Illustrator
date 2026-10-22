// A document's sections, as in Word: a section break before a paragraph starts a new section,
// on a new page (Next Page, or the next even or odd page) or on the same page (Continuous).
// Each section has its own paper, margins and columns, its own header and footer (or the one
// before's: Link to Previous), its own page numbering (carried on, or started again, in 1, 2, 3
// or i, ii, iii) and its own line numbers. The first section's settings are the document's own
// (its page, header and footer); each later one's are kept on the paragraph that starts it, so
// they move with the text as it is edited.

import type { ParaStyle } from '../model';
import * as rt from '../richtext';
import { fitParas, paraCount } from '../text/paragraphs';
import { noteLabel, type BreakKind, type DocText, type HeaderFooter, type LineNumbers, type PageNumFormat, type PageSetup, type SectionBreak } from './document';

/** A section as laid out: its paragraphs and its settings, with those it takes from the section before filled in. */
export interface Section {
  index: number;
  /** Its first paragraph, and the one after its last. */
  first: number;
  end: number;
  /** How it starts (the first section: on the first page). */
  kind: BreakKind;
  page: PageSetup;
  hf: HeaderFooter;
  /** Its header and footer are the section before's (Word's Link to Previous). */
  linked: boolean;
  /** Its first page's number when numbering starts again here (always for the first section). */
  restart?: number;
  format: PageNumFormat;
  lines?: LineNumbers;
}

/** The names of the section breaks, as Word's Layout > Breaks lists them. */
export const BREAK_NAMES: Record<BreakKind, string> = { nextPage: 'Next Page', continuous: 'Continuous', evenPage: 'Even Page', oddPage: 'Odd Page' };

/** The document's sections, in order (always at least one). */
export function sectionsOf(t: Pick<DocText, 'runs' | 'paras' | 'page' | 'hf'> & Partial<Pick<DocText, 'numFormat' | 'lineNumbers'>>): Section[] {
  const n = paraCount(rt.plainText(t.runs));
  const out: Section[] = [{
    index: 0, first: 0, end: n, kind: 'nextPage', page: t.page, hf: t.hf, linked: false,
    restart: t.hf.start ?? 1, format: t.numFormat ?? 'decimal', lines: t.lineNumbers,
  }];
  for (let p = 1; p < n; p++) {
    const s = t.paras[p]?.section;
    if (!s) continue;
    const prev = out[out.length - 1];
    prev.end = p;
    out.push({
      index: out.length, first: p, end: n, kind: s.kind, page: s.page ?? prev.page, hf: s.hf ?? prev.hf, linked: !s.hf,
      restart: s.restart, format: s.format ?? 'decimal', lines: s.lines,
    });
  }
  return out;
}

/** The section a paragraph is in. */
export function sectionAt(secs: Section[], para: number): Section {
  let at = secs[0];
  for (const s of secs) if (s.first <= para) at = s;
  return at;
}

/** Which section each paragraph is in (by index). */
export function sectionOfParas(secs: Section[]): number[] {
  const out: number[] = [];
  for (const s of secs) for (let p = s.first; p < s.end; p++) out[p] = s.index;
  return out;
}

/** What can be changed about a section (`restart: undefined` makes its numbers carry on from the section before). */
export type SectionPatch = Partial<Pick<Section, 'kind' | 'page' | 'hf' | 'linked' | 'restart' | 'format' | 'lines'>>;

/** The section break that gives a section (after the first) these settings. */
function breakOf(s: Section): SectionBreak {
  const out: SectionBreak = { kind: s.kind, page: s.page };
  if (!s.linked) out.hf = s.hf;
  if (s.restart !== undefined) out.restart = s.restart;
  if (s.format !== 'decimal') out.format = s.format;
  if (s.lines) out.lines = s.lines;
  return out;
}

/** A section changed. The first section's settings are the document's own page, header and footer. */
export function changeSection(t: DocText, index: number, patch: SectionPatch): DocText {
  const secs = sectionsOf(t);
  const s = secs[index];
  if (!s) return t;
  const next: Section = { ...s, ...patch };
  // a header or footer typed into while linked is the section's own from then on
  if (patch.hf && !('linked' in patch)) next.linked = false;
  if (index === 0) {
    const out: DocText = { ...t, page: next.page, hf: next.restart !== undefined ? { ...next.hf, start: next.restart } : next.hf };
    if (next.format !== 'decimal') out.numFormat = next.format; else delete out.numFormat;
    if (next.lines) out.lineNumbers = next.lines; else delete out.lineNumbers;
    return out;
  }
  const paras = fitParas(t.paras, paraCount(rt.plainText(t.runs)));
  paras[s.first] = { ...paras[s.first], section: breakOf(next) };
  return { ...t, paras };
}

/** Every section changed the same way (Page Setup's Apply to: Whole document). */
export function changeAllSections(t: DocText, patch: (s: Section) => SectionPatch): DocText {
  let out = t;
  for (const s of sectionsOf(t)) out = changeSection(out, s.index, patch(sectionsOf(out)[s.index]));
  return out;
}

/**
 * The section break a new section starts with, after the section `s`: the same page setup,
 * page number format and line numbers (as Word copies them), its header and footer linked to
 * the one before, its numbers carrying on.
 */
export function newBreak(s: Section, kind: BreakKind): SectionBreak {
  const out: SectionBreak = { kind, page: s.page };
  if (s.format !== 'decimal') out.format = s.format;
  if (s.lines) out.lines = s.lines;
  return out;
}

/** A page's number written in a format: 4, iv, IV, d, D. */
export function pageNumText(n: number, fmt: PageNumFormat): string {
  if (fmt === 'decimal' || n < 1) return String(n);
  return noteLabel(n, fmt);
}

/** The page sizes of two setups match (so a Continuous break can stay on the same page). */
export function samePaper(a: PageSetup, b: PageSetup): boolean {
  return Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
}

/** A paragraph style with its section break taken off. */
export function withoutSection(ps: ParaStyle): ParaStyle {
  const { section: _s, ...rest } = ps;
  return rest;
}
