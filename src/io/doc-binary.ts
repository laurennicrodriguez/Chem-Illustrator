// Old Word documents (.doc, Word 97 to 2003), opened in Document mode as Microsoft publishes the
// format ([MS-DOC]): the text from the piece table, its character formatting (fonts, sizes,
// bold, italic, underline, strikethrough, sub- and superscripts, colours) and paragraph
// formatting (alignment, indents, spacing, headings by their built-in styles, lists, page
// breaks), tables, links and footnotes. Pictures and drawn shapes are left out (said so), and
// fields show the text Word last showed. Saving writes .docx.

import * as rt from '../richtext';
import type { Justify, ParaStyle, TableCell, TableData, TextRun } from '../model';
import type { DocObject, DocText } from '../document/document';
import { cfbStreams, isCfb } from './cfb';
import { DocBuilder, fromCp1252, headingId } from './doc-build';

/** Is this an old Word document (a compound file with a WordDocument stream)? */
export function isDoc(bytes: Uint8Array): boolean {
  if (!isCfb(bytes)) return false;
  try {
    return cfbStreams(bytes).has('WordDocument');
  } catch {
    return false;
  }
}

/** Word's 16 standard colours (ico), by index. */
const ICO = [undefined, '#000000', '#0000ff', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#ffff00', '#ffffff', '#000080', '#008080', '#008000', '#800080', '#800000', '#808000', '#808080', '#c0c0c0'];

interface Chp { bold?: boolean; italic?: boolean; strike?: boolean; underline?: boolean; smallCaps?: boolean; allCaps?: boolean; hidden?: boolean; size?: number; sub?: boolean; sup?: boolean; color?: string; font?: number; highlight?: string; deleted?: boolean; special?: boolean }
interface Pap { istd?: number; align?: Justify; spaceBefore?: number; spaceAfter?: number; indent?: number; firstLine?: number; indentRight?: number; line?: number; linePt?: number; lineRule?: 'exact' | 'atLeast'; inTable?: boolean; rowEnd?: boolean; pageBreak?: boolean; outline?: number; list?: boolean; level?: number; cols?: number[] }

/** A sprm's operand size (its spra, the top 3 bits, says; a variable one gives its own). */
function sprmSize(sprm: number, b: Uint8Array, at: number): number {
  switch (sprm >> 13) {
    case 0: case 1: return 1;
    case 2: case 4: case 5: return 2;
    case 3: return 4;
    case 7: return 3;
    default:
      // sprmTDefTable and sprmTDefTable10 give their size in two bytes (one more than the rest)
      if (sprm === 0xd608 || sprm === 0xd606) return 2 + (b[at] | (b[at + 1] << 8)) - 1;
      // sprmPChgTabs: a size of 255 means it is worked out from its parts
      if (sprm === 0xc615 && b[at] === 255) { const del = b[at + 1]; const add = b[at + 2 + del * 4]; return 1 + 1 + del * 4 + 1 + add * 3; }
      return 1 + b[at];
  }
}

/** Each sprm in a list of them (a grpprl): its code and where its operand starts. */
function* sprms(b: Uint8Array, from: number, to: number): Generator<[number, number]> {
  let at = from;
  while (at + 2 <= to) {
    const sprm = b[at] | (b[at + 1] << 8);
    at += 2;
    const n = sprmSize(sprm, b, at);
    if (at + n > to + 1) return;
    yield [sprm, at];
    at += n;
  }
}

const toggle = (v: number): boolean | undefined => (v === 0 ? false : v === 1 || v === 0x81 ? true : undefined);

function readChp(b: Uint8Array, from: number, to: number): Chp {
  const c: Chp = {};
  const i16 = (at: number) => ((b[at] | (b[at + 1] << 8)) << 16) >> 16;
  for (const [s, at] of sprms(b, from, to)) {
    switch (s) {
      case 0x0835: c.bold = toggle(b[at]); break;
      case 0x0836: c.italic = toggle(b[at]); break;
      case 0x0837: case 0x2a53: c.strike = toggle(b[at]); break;
      case 0x083a: c.smallCaps = toggle(b[at]); break;
      case 0x083b: c.allCaps = toggle(b[at]); break;
      case 0x083c: c.hidden = toggle(b[at]); break;
      case 0x0800: c.deleted = !!b[at]; break;
      case 0x0855: c.special = !!b[at]; break;
      case 0x2a3e: c.underline = b[at] !== 0; break;
      case 0x4a43: c.size = (b[at] | (b[at + 1] << 8)) / 2; break;
      case 0x2a48: c.sup = b[at] === 1; c.sub = b[at] === 2; break;
      case 0x2a42: c.color = ICO[b[at]]; break;
      case 0x6870: c.color = b[at + 3] === 0xff ? undefined : `#${[b[at], b[at + 1], b[at + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`; break;
      case 0x4a4f: c.font = i16(at); break;
      case 0x2a0c: c.highlight = ICO[b[at]]; break;
    }
  }
  return c;
}

function readPap(b: Uint8Array, from: number, to: number): Pap {
  const p: Pap = {};
  const u16 = (at: number) => b[at] | (b[at + 1] << 8);
  const i16 = (at: number) => (u16(at) << 16) >> 16;
  const tw = (v: number) => v / 20;
  if (to - from >= 2) p.istd = u16(from);
  for (const [s, at] of sprms(b, from + 2, to)) {
    switch (s) {
      case 0x2403: case 0x2461: p.align = ([undefined, 'center', 'right', 'justify'] as (Justify | undefined)[])[b[at]] ?? undefined; break;
      case 0xa413: p.spaceBefore = tw(u16(at)); break;
      case 0xa414: p.spaceAfter = tw(u16(at)); break;
      case 0x840f: case 0x845e: p.indent = tw(i16(at)); break;
      case 0x8411: case 0x8460: p.firstLine = tw(i16(at)); break;
      case 0x840e: case 0x845d: p.indentRight = tw(i16(at)); break;
      case 0x6412: {
        const dya = i16(at), mult = i16(at + 2);
        if (mult) p.line = Math.round((dya / 240) * 100) / 100;
        else { p.linePt = Math.abs(dya) / 20; p.lineRule = dya < 0 ? 'exact' : 'atLeast'; }
        break;
      }
      case 0x2416: p.inTable = !!b[at]; break;
      case 0x2417: p.rowEnd = !!b[at]; break;
      case 0x244b: p.inTable = p.inTable || !!b[at]; break;
      case 0x244c: p.rowEnd = p.rowEnd || !!b[at]; break;
      case 0x2407: p.pageBreak = !!b[at]; break;
      case 0x2640: p.outline = b[at]; break;
      case 0x460b: p.list = u16(at) > 0; break;
      case 0x260a: p.level = b[at]; break;
      case 0xd608: {
        // the table's cell edges (twips), with this row's end
        const n = b[at + 2];
        const xs: number[] = [];
        for (let k = 0; k <= n; k++) xs.push(i16(at + 3 + 2 * k));
        p.cols = xs.slice(1).map((x, k) => Math.max(12, tw(x - xs[k])));
        break;
      }
    }
  }
  return p;
}

/** Runs of a property over ranges of file offsets (fc), from an FKP-based bin table. */
interface FcRun<T> { from: number; to: number; v: T }

function lookup<T>(runs: FcRun<T>[], fc: number): T | undefined {
  let lo = 0, hi = runs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = runs[mid];
    if (fc < r.from) hi = mid - 1;
    else if (fc >= r.to) lo = mid + 1;
    else return r.v;
  }
  return undefined;
}

class DocReader {
  private wd: Uint8Array;
  private tbl: Uint8Array;
  private warnings = new Set<string>();
  private b = new DocBuilder();
  private fonts: string[] = [];
  /** Each style's built-in identifier (sti: 1 to 9 the headings), by its index. */
  private sti: number[] = [];

  constructor(streams: Map<string, Uint8Array>) {
    this.wd = streams.get('WordDocument')!;
    const flags = this.u16(this.wd, 0x0a);
    if (this.u16(this.wd, 0) !== 0xa5ec) throw new Error('This is not a Word document.');
    if (flags & 0x0100) throw new Error('This document is protected with a password. Open it in Word, take the password off, and save it again.');
    const tbl = streams.get(flags & 0x0200 ? '1Table' : '0Table');
    if (!tbl) throw new Error('This Word document is damaged (it has no table stream).');
    this.tbl = tbl;
  }

  private u16(b: Uint8Array, at: number): number { return at + 2 <= b.length ? b[at] | (b[at + 1] << 8) : 0; }
  private u32(b: Uint8Array, at: number): number { return at + 4 <= b.length ? (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0 : 0; }

  read(): { doc: DocText; warnings: string[] } {
    const wd = this.wd;
    const csw = this.u16(wd, 32);
    const lw = 34 + csw * 2 + 2;
    const cslw = this.u16(wd, lw - 2);
    const ccpText = this.u32(wd, lw + 12), ccpFtn = this.u32(wd, lw + 16);
    const fcl = lw + cslw * 4 + 2;
    const fcLcb = (k: number) => ({ fc: this.u32(wd, fcl + 8 * k), lcb: this.u32(wd, fcl + 8 * k + 4) });
    this.readFonts(fcLcb(15));
    this.readStyles(fcLcb(1));
    const chars = this.pieces(fcLcb(33), ccpText + ccpFtn);
    const chp = this.bins(fcLcb(12), (b, from, to) => readChp(b, from, to), 'chp');
    const pap = this.bins(fcLcb(13), (b, from, to) => readPap(b, from, to), 'pap');
    const notes = this.footnotes(fcLcb(2), fcLcb(3), ccpText, ccpFtn, chars, chp);
    this.text(chars.slice(0, ccpText), chp, pap, notes);
    return { doc: this.b.finish(), warnings: [...this.warnings] };
  }

  private readFonts({ fc, lcb }: { fc: number; lcb: number }): void {
    const t = this.tbl;
    if (!lcb) return;
    let at = fc;
    let count = this.u16(t, at);
    at += 2;
    if (count === 0xffff) { count = this.u16(t, at); at += 2; }
    at += 2; // cbExtra
    for (let i = 0; i < count && at < fc + lcb; i++) {
      const cb = t[at];
      const start = at + 1 + 39;
      let name = '';
      for (let k = start; k + 1 < at + 1 + cb; k += 2) {
        const c = this.u16(t, k);
        if (!c) break;
        name += String.fromCharCode(c);
      }
      this.fonts.push(name);
      at += 1 + cb;
    }
  }

  private readStyles({ fc, lcb }: { fc: number; lcb: number }): void {
    const t = this.tbl;
    if (!lcb) return;
    const cbStshi = this.u16(t, fc);
    const cstd = this.u16(t, fc + 2);
    let at = fc + 2 + cbStshi;
    for (let i = 0; i < cstd && at < fc + lcb; i++) {
      const cb = this.u16(t, at);
      at += 2;
      this.sti.push(cb ? this.u16(t, at) & 0x0fff : 0x0ffe);
      at += cb;
    }
  }

  /** Each character of the text (cp 0 to `n`) with its offset in the WordDocument stream. */
  private pieces({ fc, lcb }: { fc: number; lcb: number }, n: number): { ch: string; fc: number }[] {
    const t = this.tbl, wd = this.wd;
    let at = fc;
    const end = fc + lcb;
    while (at < end && t[at] === 0x01) at += 3 + this.u16(t, at + 1);
    if (t[at] !== 0x02) throw new Error('This Word document is damaged (its text could not be found).');
    const size = this.u32(t, at + 1);
    at += 5;
    const count = (size - 4) / 12;
    const out: { ch: string; fc: number }[] = [];
    for (let i = 0; i < count && out.length < n; i++) {
      const cp0 = this.u32(t, at + 4 * i), cp1 = this.u32(t, at + 4 * (i + 1));
      const raw = this.u32(t, at + 4 * (count + 1) + 8 * i + 2);
      const packed = (raw & 0x40000000) !== 0;
      const start = packed ? (raw & ~0x40000000) / 2 : raw;
      for (let k = 0; k < cp1 - cp0 && out.length < n; k++) {
        const f = packed ? start + k : start + 2 * k;
        const ch = packed ? fromCp1252(wd[f]) : String.fromCharCode(this.u16(wd, f));
        out.push({ ch, fc: f });
      }
    }
    return out;
  }

  /** A bin table (PlcBteChpx or PlcBtePapx) read through its FKP pages. */
  private bins<T>({ fc, lcb }: { fc: number; lcb: number }, parse: (b: Uint8Array, from: number, to: number) => T, kind: 'chp' | 'pap'): FcRun<T>[] {
    const t = this.tbl, wd = this.wd;
    const n = (lcb - 4) / 8;
    const out: FcRun<T>[] = [];
    for (let i = 0; i < n; i++) {
      const pn = this.u32(t, fc + 4 * (n + 1) + 4 * i) & 0x3fffff;
      const page = pn * 512;
      if (page + 512 > wd.length) continue;
      const crun = wd[page + 511];
      for (let k = 0; k < crun; k++) {
        const from = this.u32(wd, page + 4 * k), to = this.u32(wd, page + 4 * (k + 1));
        let v: T;
        if (kind === 'chp') {
          const off = wd[page + 4 * (crun + 1) + k] * 2;
          v = off ? parse(wd, page + off + 1, page + off + 1 + wd[page + off]) : parse(wd, 0, 0);
        } else {
          const off = wd[page + 4 * (crun + 1) + 13 * k] * 2;
          if (!off) { v = parse(wd, 0, 0); } else {
            const cb = wd[page + off];
            const [s, len] = cb ? [page + off + 1, 2 * cb - 1] : [page + off + 2, 2 * wd[page + off + 1]];
            v = parse(wd, s, s + len);
          }
        }
        out.push({ from, to, v });
      }
    }
    return out.sort((a, b) => a.from - b.from);
  }

  /** The footnotes' text (each a note object), by the place of its mark in the text. */
  private footnotes(ref: { fc: number; lcb: number }, txt: { fc: number; lcb: number }, ccpText: number, ccpFtn: number, chars: { ch: string; fc: number }[], chp: FcRun<Chp>[]): Map<number, DocObject> {
    const out = new Map<number, DocObject>();
    if (!ref.lcb || !txt.lcb || !ccpFtn) return out;
    const t = this.tbl;
    const n = (ref.lcb - 4) / 6;
    for (let i = 0; i < n; i++) {
      const at = this.u32(t, ref.fc + 4 * i);
      const a = ccpText + this.u32(t, txt.fc + 4 * i), b = ccpText + this.u32(t, txt.fc + 4 * (i + 1));
      const runs: TextRun[] = [];
      for (let cp = a; cp < b && cp < chars.length; cp++) {
        const { ch, fc } = chars[cp];
        const c = lookup(chp, fc) ?? {};
        if (ch === '\x02' || c.deleted || c.hidden) continue;
        runs.push({ ...this.look(c), text: ch === '\r' ? '\n' : ch === '\x0b' ? ' ' : ch === '\x07' ? '\t' : ch });
      }
      let r = rt.normalizeRuns(runs);
      const text = rt.plainText(r);
      const trimmed = text.replace(/^\s+/, '').replace(/\n+$/, '');
      const lead = text.length - text.replace(/^\s+/, '').length;
      r = rt.sliceRuns(r, lead, lead + trimmed.length);
      out.set(at, { kind: 'note', runs: r.length ? r : [{ text: '' }] });
    }
    return out;
  }

  private look(c: Chp): rt.RunStyle {
    return rt.cleanStyle({
      bold: c.bold || undefined, italic: c.italic || undefined, underline: c.underline || undefined, strike: c.strike || undefined, smallCaps: c.smallCaps || undefined, allCaps: c.allCaps || undefined,
      sub: c.sub || undefined, sup: c.sup || undefined, size: c.size ?? 10, font: (c.font !== undefined ? this.fonts[c.font] : undefined) || this.fonts[0] || 'Times New Roman', color: c.color && c.color !== '#000000' ? c.color : undefined, highlight: c.highlight,
    });
  }

  private paraStyle(p: Pap): ParaStyle {
    const sti = p.istd !== undefined ? this.sti[p.istd] : undefined;
    const style = sti !== undefined && sti >= 1 && sti <= 9 ? headingId(sti) : sti === 62 ? 'Title' : sti === 34 ? 'Caption' : p.outline !== undefined && p.outline < 9 ? headingId(p.outline + 1) : undefined;
    return {
      ...(style ? { style } : {}), align: p.align, spaceBefore: p.spaceBefore, spaceAfter: p.spaceAfter,
      indent: p.list ? undefined : p.indent || undefined, firstLine: p.list ? undefined : p.firstLine || undefined, indentRight: p.indentRight || undefined,
      line: p.line, linePt: p.linePt, lineRule: p.lineRule, pageBreak: p.pageBreak,
      ...(p.list ? { list: 'bullet' as const, ...(p.level ? { level: p.level } : {}) } : {}),
    };
  }

  private text(chars: { ch: string; fc: number }[], chp: FcRun<Chp>[], pap: FcRun<Pap>[], notes: Map<number, DocObject>): void {
    // fields: their codes are left out, what they show kept (a link's text links)
    const fields: { inCode: boolean; code: string; link?: string }[] = [];
    let row: TableCell[] = [];
    let rows: TableCell[][] = [];
    let cols: number[] = [];
    let cell: TextRun[] = [];
    let pictures = 0;
    const flushTable = () => {
      if (!rows.length) return;
      const n = Math.max(cols.length, ...rows.map((r) => r.length));
      const widths = Array.from({ length: n }, (_, i) => cols[i] ?? 72);
      const table: TableData = { cols: widths, rows: rows.map((r) => Array.from({ length: n }, (_, i) => r[i] ?? { runs: [{ text: '' }] })), head: 0, lines: 'grid' };
      this.b.table({ kind: 'table', table });
      rows = [];
      cols = [];
    };
    const endCell = () => {
      let runs = rt.normalizeRuns(cell);
      const text = rt.plainText(runs);
      if (text.endsWith('\n')) runs = rt.sliceRuns(runs, 0, text.length - 1);
      row.push({ runs: runs.length ? runs : [{ text: '' }] });
      cell = [];
    };
    for (let cp = 0; cp < chars.length; cp++) {
      const { ch, fc } = chars[cp];
      const c = lookup(chp, fc) ?? {};
      const code = ch.charCodeAt(0);
      if (code === 0x13) { fields.push({ inCode: true, code: '' }); continue; }
      if (code === 0x14 && fields.length) {
        const f = fields[fields.length - 1];
        f.inCode = false;
        const m = /^\s*HYPERLINK\s+(?:\\l\s+)?"([^"]+)"/i.exec(f.code);
        if (m) f.link = m[1];
        continue;
      }
      if (code === 0x15 && fields.length) { fields.pop(); continue; }
      const field = fields[fields.length - 1];
      if (field?.inCode) { field.code += ch; continue; }
      if (c.deleted) { this.warnings.add('Tracked deletions were left out (the text is as it will read).'); continue; }
      if (c.hidden && code !== 0x0d && code !== 0x07) continue;
      const link = [...fields].reverse().find((f) => f.link)?.link;
      const look = { ...this.look(c), ...(link ? { link } : {}) };
      const p = code === 0x0d || code === 0x07 ? lookup(pap, fc) ?? {} : null;
      if (code === 0x07 && p) {
        // a cell's end, or (in a row's own paragraph) the row's
        if (p.rowEnd) {
          if (cell.length) endCell();
          if (p.cols && p.cols.length > cols.length) cols = p.cols;
          rows.push(row);
          row = [];
        } else endCell();
        continue;
      }
      if (code === 0x0d && p) {
        if (p.inTable) { cell.push({ ...look, text: '\n' }); continue; }
        flushTable();
        this.b.endPara(this.paraStyle(p));
        continue;
      }
      let text = ch;
      if (c.special || code < 0x20) {
        if (code === 0x02 && notes.has(cp)) {
          const note = notes.get(cp)!;
          if (cell.length || row.length || lookup(pap, fc)?.inTable) cell.push({ ...look, sup: undefined, obj: this.b.reserve(note), text: '￼' });
          else { flushTable(); this.b.object(note, { ...look, sup: undefined }); }
          continue;
        }
        if (code === 0x01 || code === 0x08) { pictures++; continue; }
        if (code === 0x09) text = '\t';
        else if (code === 0x0b) text = ' ';
        else if (code === 0x0c) { if (this.b.hasText) this.b.endPara(this.paraStyle(lookup(pap, fc) ?? {})); this.b.pendingBreak = true; continue; }
        else if (code === 0x1e) text = '‑';
        else if (code === 0x1f) continue;
        else if (code < 0x20) continue;
      }
      if (lookup(pap, fc)?.inTable || cell.length) {
        // (the paragraph a character is in says whether it is in a table, from its paragraph mark)
        cell.push({ ...look, text });
        continue;
      }
      flushTable();
      this.b.text(text, look);
    }
    if (cell.length) endCell();
    if (row.length) rows.push(row);
    flushTable();
    if (pictures) this.warnings.add(`${pictures} picture${pictures === 1 ? ' and shape was' : 's and shapes were'} left out: open the file in Word and save it as .docx to keep them.`);
  }
}

/** Open an old Word document (.doc) as a document. */
export function readDoc(bytes: Uint8Array): { doc: DocText; warnings: string[] } {
  if (!isCfb(bytes)) throw new Error('This is not a Word 97-2003 document.');
  const streams = cfbStreams(bytes);
  if (!streams.has('WordDocument')) throw new Error('This is not a Word 97-2003 document.');
  return new DocReader(streams).read();
}
