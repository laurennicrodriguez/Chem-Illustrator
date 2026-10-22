// Insert > Cover Page, Blank Page and Quick Parts, as in Word. A cover page is a first page of its
// own: the document's title, subtitle, author, institution and date (fields, so they follow the
// document's properties), set in one of a few looks, with a page break after it and no page number
// on it. A Quick Part is a piece of text saved to use again in any document (an affiliation, a
// standard experimental paragraph, a lab's address), kept with the person's settings.

import type { ParaStyle, TextRun } from '../model';
import * as rt from '../richtext';
import { fitParas, paraCount, splitParagraphs } from '../text/paragraphs';
import type { FieldCode } from './fields';
import type { DocObject, DocText } from './document';

/** The bookmark on a cover page's first paragraph, so it can be found and taken out again. */
export const COVER_MARK = '_Cover';

/** A saved piece of text (Insert > Quick Parts > Save Selection to Quick Part Gallery). */
export interface QuickPart {
  name: string;
  runs: TextRun[];
  paras: ParaStyle[];
}

/** Quick Parts read from the settings, keeping only what makes sense. */
export function parseQuickParts(v: unknown): QuickPart[] {
  if (!Array.isArray(v)) return [];
  const out: QuickPart[] = [];
  for (const x of v) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    if (typeof o.name !== 'string' || !o.name.trim() || !Array.isArray(o.runs)) continue;
    const runs = (o.runs as unknown[]).filter((r): r is TextRun => !!r && typeof r === 'object' && typeof (r as TextRun).text === 'string').map((r) => {
      // figures and fields don't travel between documents: just their text
      const { obj: _o, rev: _r, cmt: _c, ...rest } = r as TextRun;
      return rest;
    });
    const paras = Array.isArray(o.paras) ? (o.paras as unknown[]).filter((p): p is ParaStyle => !!p && typeof p === 'object') : [];
    out.push({ name: o.name.trim().slice(0, 80), runs, paras });
  }
  return out.slice(0, 200);
}

/**
 * The selected text as a Quick Part: its words and look, and the look of each of its paragraphs
 * (figures and fields left out, as they belong to the document they are in).
 */
export function partFromSelection(t: DocText, start: number, end: number, name: string): QuickPart | null {
  if (end <= start) return null;
  const text = rt.plainText(t.runs);
  const runs = rt.sliceRuns(t.runs, start, end).filter((r) => r.obj === undefined).map((r) => {
    const { rev: _r, cmt: _c, link: _l, ...rest } = r;
    return rest;
  });
  if (!runs.some((r) => r.text.trim())) return null;
  const paras = fitParas(t.paras, paraCount(text));
  let first = 0;
  for (let i = 0; i < start; i++) if (text[i] === '\n') first++;
  const n = paraCount(rt.plainText(runs));
  const ps = paras.slice(first, first + n).map((p) => {
    const { pageBreak: _a, colBreak: _b, section: _s, marks: _m, ...rest } = p;
    return rest;
  });
  return { name: name.trim() || 'Quick Part', runs: rt.normalizeRuns(runs), paras: ps };
}

// ---------------------------------------------------------------- cover pages

/** One paragraph of a cover page: its pieces (text, or a field) and its settings. */
export interface CoverPara { pieces: (string | { field: FieldCode; format?: string })[]; look: rt.RunStyle; ps: ParaStyle }

export interface CoverDesign { id: string; name: string; help: string; paras: (accent: string) => CoverPara[] }

const centred: ParaStyle = { align: 'center' };

/** The cover pages offered: plain shapes made of paragraph spacing, rules and shading, so Word keeps them exactly. */
export const COVER_PAGES: CoverDesign[] = [
  {
    id: 'plain', name: 'Plain', help: 'The title in the middle of the page, the author and date under it',
    paras: () => [
      { pieces: [{ field: 'title' }], look: { size: 28, bold: true }, ps: { ...centred, spaceBefore: 220, spaceAfter: 12 } },
      { pieces: [{ field: 'subject' }], look: { size: 16 }, ps: { ...centred, spaceAfter: 120 } },
      { pieces: [{ field: 'author' }], look: { size: 13 }, ps: { ...centred, spaceAfter: 4 } },
      { pieces: [{ field: 'company' }], look: { size: 12 }, ps: { ...centred, spaceAfter: 4 } },
      { pieces: [{ field: 'date', format: 'MMMM d, yyyy' }], look: { size: 12 }, ps: { ...centred } },
    ],
  },
  {
    id: 'banded', name: 'Banded', help: 'The title in white on a band of the accent colour',
    paras: (accent) => [
      { pieces: [''], look: { size: 12 }, ps: { spaceBefore: 160, shade: accent } },
      { pieces: [{ field: 'title' }], look: { size: 30, bold: true, color: '#ffffff' }, ps: { indent: 18, shade: accent, spaceAfter: 0 } },
      { pieces: [{ field: 'subject' }], look: { size: 15, color: '#ffffff' }, ps: { indent: 18, shade: accent, spaceAfter: 0 } },
      { pieces: [''], look: { size: 12 }, ps: { shade: accent, spaceAfter: 200 } },
      { pieces: [{ field: 'author' }], look: { size: 13, bold: true }, ps: { indent: 18, spaceAfter: 2 } },
      { pieces: [{ field: 'company' }], look: { size: 12 }, ps: { indent: 18, spaceAfter: 2 } },
      { pieces: [{ field: 'date', format: 'MMMM d, yyyy' }], look: { size: 12 }, ps: { indent: 18 } },
    ],
  },
  {
    id: 'ruled', name: 'Ruled', help: 'The title between two heavy rules, to the left',
    paras: (accent) => {
      const rule = { style: 'single' as const, w: 3, color: accent };
      return [
        { pieces: [{ field: 'title' }], look: { size: 28, bold: true }, ps: { spaceBefore: 180, border: { top: rule }, spaceAfter: 6 } },
        { pieces: [{ field: 'subject' }], look: { size: 15, italic: true }, ps: { border: { bottom: rule }, spaceAfter: 160 } },
        { pieces: [{ field: 'author' }], look: { size: 13 }, ps: { spaceAfter: 2 } },
        { pieces: [{ field: 'company' }], look: { size: 12 }, ps: { spaceAfter: 2 } },
        { pieces: [{ field: 'date', format: 'd MMMM yyyy' }], look: { size: 12 }, ps: {} },
      ];
    },
  },
  {
    id: 'report', name: 'Lab Report', help: 'A report\'s front page: what, who, where and when, down a line in the margin',
    paras: (accent) => {
      const bar = { style: 'single' as const, w: 4.5, color: accent };
      const row = (label: string, field: FieldCode, format?: string): CoverPara => ({ pieces: [`${label}\t`, format ? { field, format } : { field }], look: { size: 12 }, ps: { border: { left: bar }, indent: 10, spaceAfter: 6, tabs: [{ pos: 110, kind: 'left' }] } });
      return [
        { pieces: ['Report'], look: { size: 14, color: accent, bold: true }, ps: { spaceBefore: 120, border: { left: bar }, indent: 10, spaceAfter: 2 } },
        { pieces: [{ field: 'title' }], look: { size: 26, bold: true }, ps: { border: { left: bar }, indent: 10, spaceAfter: 30 } },
        row('Subject', 'subject'), row('Author', 'author'), row('Group', 'company'), row('Date', 'date', 'MMMM d, yyyy'),
      ];
    },
  },
  {
    id: 'si', name: 'Supporting Information', help: 'A journal\'s Supporting Information front page: the heading, the paper\'s title, its authors and institution',
    paras: () => [
      { pieces: ['Supporting Information'], look: { size: 18, bold: true }, ps: { ...centred, spaceBefore: 60, spaceAfter: 18 } },
      { pieces: [{ field: 'title' }], look: { size: 14, bold: true }, ps: { ...centred, spaceAfter: 12 } },
      { pieces: [{ field: 'author' }], look: { size: 12 }, ps: { ...centred, spaceAfter: 6 } },
      { pieces: [{ field: 'company' }], look: { size: 11, italic: true }, ps: { ...centred, spaceAfter: 24 } },
    ],
  },
];

/**
 * A cover page put in front of the document: its paragraphs (each piece a run, each field an object
 * made by `field`), then the document's first paragraph starting a new page. A cover page already
 * there is replaced. The first page shows no page number (as a title page doesn't).
 */
export function insertCover(t: DocText, design: CoverDesign, accent: string, base: rt.RunStyle, field: (code: FieldCode, format?: string) => { id: number; o: DocObject }): DocText {
  let doc = removeCover(t);
  const objects = { ...doc.objects };
  const runs: TextRun[] = [];
  const paras: ParaStyle[] = [];
  design.paras(accent).forEach((cp, i) => {
    const look = rt.cleanStyle({ ...base, ...cp.look });
    if (i > 0) runs.push({ ...look, text: '\n' });
    for (const piece of cp.pieces) {
      if (typeof piece === 'string') { if (piece) runs.push({ ...look, text: piece }); continue; }
      const f = field(piece.field, piece.format);
      objects[f.id] = f.o;
      runs.push({ ...look, obj: f.id, text: '￼' });
    }
    paras.push({ ...cp.ps, ...(i === 0 ? { marks: [COVER_MARK] } : {}) });
  });
  const n = paraCount(rt.plainText(doc.runs));
  const old = fitParas(doc.paras, n);
  const first = old[0] ?? {};
  // the document's own first paragraph starts on the page after the cover
  const rest = [{ ...first, pageBreak: true }, ...old.slice(1)];
  const lastLook = runs.length ? rt.styleOf(runs[runs.length - 1]) : base;
  doc = {
    ...doc,
    objects,
    runs: rt.normalizeRuns([...runs, { ...lastLook, text: '\n' }, ...doc.runs]),
    paras: [...paras, ...rest],
    hf: { ...doc.hf, onFirst: false },
  };
  return doc;
}

/** The paragraphs a cover page takes up (from the first, up to the paragraph starting the page after it), or null when there is none. */
export function coverParas(t: DocText): { first: number; end: number } | null {
  const n = paraCount(rt.plainText(t.runs));
  const paras = fitParas(t.paras, n);
  if (!paras[0]?.marks?.includes(COVER_MARK)) return null;
  for (let i = 1; i < n; i++) if (paras[i].pageBreak || paras[i].section) return { first: 0, end: i };
  return { first: 0, end: n };
}

/** The document without its cover page (its first page then shows its number again). */
export function removeCover(t: DocText): DocText {
  const c = coverParas(t);
  if (!c) return t;
  const n = paraCount(rt.plainText(t.runs));
  const paras = fitParas(t.paras, n);
  const parts = splitParagraphs(t.runs);
  const runs: TextRun[] = [];
  const keep = parts.slice(c.end);
  keep.forEach((rs, i) => {
    if (i > 0) { const prev = keep[i - 1]; runs.push({ ...(prev.length ? rt.styleOf(prev[prev.length - 1]) : {}), text: '\n' }); }
    runs.push(...rs);
  });
  const rest = paras.slice(c.end);
  if (rest[0]) { const { pageBreak: _p, ...r0 } = rest[0]; rest[0] = r0; }
  return { ...t, runs: rt.normalizeRuns(runs), paras: rest.length ? rest : [{}], hf: { ...t.hf, onFirst: true } };
}
