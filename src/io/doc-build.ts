// Building a document from another word processor's file (RTF, OpenDocument, old Word .doc):
// text added piece by piece in its look, paragraphs ended with their formatting, and objects
// (tables, pictures, notes) put in the text, then the whole made into a document.

import * as rt from '../richtext';
import type { ParaStyle, TextRun } from '../model';
import { OBJECT_CHAR, newDocument, styleOf, usedObjects, type DocObject, type DocText, type NamedStyle } from '../document/document';

/** Style ids for headings by level, and the title (as Word's and ours are). */
export const headingId = (level: number): string => `Heading${Math.max(1, Math.min(9, Math.round(level)))}`;

/** A style id from another program's style name ("heading 2", "Heading_20_2", "Title"), when it is one of ours. */
export function styleIdOf(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const n = name.replace(/_20_/g, ' ').trim().toLowerCase();
  const h = /^heading\s*(\d)$/.exec(n);
  if (h) return headingId(Number(h[1]));
  if (n === 'title') return 'Title';
  if (n === 'caption') return 'Caption';
  return undefined;
}

export class DocBuilder {
  readonly doc: DocText = newDocument();
  private runs: TextRun[] = [];
  private paras: ParaStyle[] = [];
  readonly objects: Record<number, DocObject> = {};
  private nextId = 1;
  /** Text in the paragraph being read so far (nothing yet: an empty paragraph). */
  private open = false;
  /** Something before the next paragraph (a page break read before its text). */
  pendingBreak = false;

  /** The look a style gives its text, so runs carry their own font and size as ours do. */
  styleLook(ps: ParaStyle): rt.RunStyle {
    const s: NamedStyle = styleOf(this.doc, ps);
    return rt.cleanStyle({ font: s.font, size: s.size, bold: s.bold || undefined, italic: s.italic || undefined, color: s.color });
  }

  text(text: string, look: rt.RunStyle): void {
    if (!text) return;
    const parts = text.split('\n');
    parts.forEach((p, i) => {
      if (i > 0) this.endPara({});
      if (p) { this.runs.push({ ...look, text: p }); this.open = true; }
    });
  }

  /** An object in the text at this place; its id. */
  object(o: DocObject, look: rt.RunStyle = {}): number {
    const id = this.nextId++;
    this.objects[id] = o;
    this.runs.push({ ...look, obj: id, text: OBJECT_CHAR });
    this.open = true;
    return id;
  }

  /** An object kept by id but not in the text yet (a note's text holds its own objects). */
  reserve(o: DocObject): number {
    const id = this.nextId++;
    this.objects[id] = o;
    return id;
  }

  /** End the paragraph being read, with its formatting. */
  endPara(ps: ParaStyle): void {
    const p = { ...ps };
    if (this.pendingBreak) { p.pageBreak = true; this.pendingBreak = false; }
    this.paras.push(p);
    // (the line break takes the look of the text before it, not its link)
    this.runs.push({ ...(this.runs.length ? rt.styleOf(this.runs[this.runs.length - 1]) : {}), obj: undefined, link: undefined, text: '\n' });
    this.open = false;
  }

  /** A table as a paragraph of its own. */
  table(o: Extract<DocObject, { kind: 'table' }>, ps: ParaStyle = {}): void {
    if (this.open) this.endPara({});
    this.object(o);
    this.endPara(ps);
  }

  get hasText(): boolean {
    return this.open;
  }

  /** The document read: its last paragraph ended, the empty one after it taken off. */
  finish(extra: Partial<DocText> = {}): DocText {
    if (this.open || !this.paras.length) this.endPara({});
    let runs = rt.normalizeRuns(this.runs.map((r) => rt.cleanStyle(r) as TextRun).map((r, i) => ({ ...r, text: this.runs[i].text })));
    // the last line break ends the last paragraph (the text has one fewer breaks than paragraphs)
    const text = rt.plainText(runs);
    if (text.endsWith('\n')) runs = rt.replaceRange(runs, text.length - 1, text.length, []);
    const t: DocText = { ...this.doc, ...extra, runs, paras: this.paras.map((p) => cleanParaStyle(p)), objects: this.objects };
    const used = usedObjects({ runs: t.runs, objects: t.objects, hf: t.hf, paras: t.paras });
    const objects: Record<number, DocObject> = {};
    for (const id of used) if (t.objects[id]) objects[id] = t.objects[id];
    return { ...t, objects };
  }
}

function cleanParaStyle(p: ParaStyle): ParaStyle {
  const out: ParaStyle = {};
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== false && !(k === 'style' && v === 'Normal')) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** Text in the Windows code page Word and RTF use for 8-bit characters (cp1252). */
const CP1252: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž',
  0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};
export const fromCp1252 = (b: number): string => CP1252[b] ?? String.fromCharCode(b);
const TO_CP1252 = new Map(Object.entries(CP1252).map(([k, v]) => [v, Number(k)]));
/** A character's cp1252 byte, or null when it has none (it is then written as Unicode). */
export function toCp1252(ch: string): number | null {
  const c = ch.charCodeAt(0);
  if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) return c;
  return TO_CP1252.get(ch) ?? null;
}
