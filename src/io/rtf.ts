// Rich Text Format (.rtf), as Microsoft published it (RTF 1.9.1): opened and saved in Document
// mode. Text with its fonts, sizes, bold and italic, underline, strikethrough, sub- and
// superscripts and colours; paragraphs with their alignment, indents, spacing and headings;
// page breaks, tabs, tables, pictures (PNG and JPEG), footnotes and the page's size and margins.
// What RTF can't hold of ours (live fields, citations, comments) is saved as the text it shows.

import * as rt from '../richtext';
import type { Justify, ParaStyle, TableCell, TableData, TextRun } from '../model';
import { fieldTexts, styleOf, type DocObject, type DocText } from '../document/document';
import { fitParas, paraCount, splitParagraphs } from '../text/paragraphs';
import { DocBuilder, fromCp1252, headingId, styleIdOf, toCp1252 } from './doc-build';
import type { Contents } from '../model';
import type { DocStyle } from '../style';

const TWIP = 20;
const twip = (pt: number) => Math.round(pt * TWIP);

// ---------------------------------------------------------------- reading

interface CharState {
  bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; sub?: boolean; sup?: boolean;
  font?: number; size?: number; color?: number; highlight?: number; smallCaps?: boolean; allCaps?: boolean; hidden?: boolean;
  /** \ucN: how many characters after a \uN stand in for it. */
  uc: number;
  /** What the group's text goes to. */
  dest: 'text' | 'skip' | 'fonttbl' | 'colortbl' | 'stylesheet' | 'pict' | 'footnote' | 'fldinst' | 'fldrslt';
}

interface ParaState {
  align?: Justify; spaceBefore?: number; spaceAfter?: number; indent?: number; firstLine?: number; indentRight?: number;
  line?: number; linePt?: number; lineRule?: 'exact' | 'atLeast'; style?: number; outline?: number; intbl?: boolean; keepNext?: boolean; list?: 'bullet' | 'number'; pageBreak?: boolean;
}

/** Destinations whose text isn't the document's. */
const SKIP = new Set(['info', 'header', 'footer', 'headerl', 'headerr', 'headerf', 'footerl', 'footerr', 'footerf', 'xmlnstbl', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'mmathPr', 'pgdsctbl', 'revtbl', 'filetbl', 'object', 'shp', 'shpinst', 'nonshppict', 'bkmkstart', 'bkmkend', 'annotation', 'atnid', 'atnauthor', 'pntext', 'pntxta', 'pntxtb', 'listtext', 'wgrffmtfilter', 'docvar', 'userprops', 'fchars', 'lchars', 'falt', 'panose', 'template', 'operator']);

const SYMBOLS: Record<string, string> = {
  emdash: '—', endash: '–', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', emspace: '\u2003', enspace: '\u2002', qmspace: '\u2005', '~': '\u00a0', '-': '', _: '‑', zwj: '\u200d', zwnj: '\u200c',
};

/** Open an RTF file as a document. */
export function readRtf(bytes: Uint8Array): { doc: DocText; warnings: string[] } {
  let src = '';
  for (let i = 0; i < bytes.length; i++) src += String.fromCharCode(bytes[i]);
  if (!/^\s*\{\\rtf/.test(src)) throw new Error('Not an RTF file');
  return new RtfReader(src).read();
}

/** Is this an RTF file? */
export const isRtf = (b: Uint8Array): boolean => b.length > 5 && String.fromCharCode(...b.slice(0, 5)) === '{\\rtf';

class RtfReader {
  private i = 0;
  private b = new DocBuilder();
  private warnings = new Set<string>();
  private fonts = new Map<number, string>();
  private colors: (string | undefined)[] = [];
  private styles = new Map<number, string>();
  private st: CharState = { uc: 1, dest: 'text' };
  private stack: CharState[] = [];
  private ps: ParaState = {};
  private defaultFont = 0;
  private page: Partial<DocText['page']> = {};
  // the destination being collected
  private fontNum = 0;
  private name = '';
  private rgb: [number, number, number] | null = null;
  private styleNum = 0;
  private pict: { hex: string; type?: string; w?: number; h?: number; goalW?: number; goalH?: number; scaleX?: number; scaleY?: number } | null = null;
  /** A footnote being read: its runs, kept apart from the text. */
  private note: { runs: TextRun[]; depth: number; end: boolean; ps: ParaState } | null = null;
  private field: { inst: string; depth: number } | null = null;
  // a table being read: rows of cells, and the cells' right edges
  private row: TableCell[] = [];
  private rows: TableCell[][] = [];
  private cellx: number[] = [];
  private tableCols: number[] = [];
  private cell: { runs: TextRun[]; paras: ParaStyle[] } = { runs: [], paras: [] };

  constructor(private src: string) {}

  read(): { doc: DocText; warnings: string[] } {
    const s = this.src;
    while (this.i < s.length) {
      const c = s[this.i];
      if (c === '{') { this.stack.push({ ...this.st }); this.i++; this.groupOpened(); }
      else if (c === '}') { this.groupClosing(); this.st = this.stack.pop() ?? this.st; this.i++; }
      else if (c === '\\') this.control();
      else if (c === '\r' || c === '\n') this.i++;
      else {
        let j = this.i;
        while (j < s.length && !'{}\\\r\n'.includes(s[j])) j++;
        this.chars(s.slice(this.i, j));
        this.i = j;
      }
    }
    this.flushTable();
    const page = { ...this.b.doc.page, ...this.page };
    return { doc: this.b.finish({ page }), warnings: [...this.warnings] };
  }

  private groupOpened(): void {
    // \*\dest: an optional destination we don't read
    if (this.src.startsWith('\\*', this.i)) {
      const m = /^\\\*\\([a-zA-Z]+)/.exec(this.src.slice(this.i, this.i + 40));
      const word = m?.[1] ?? '';
      if (word === 'fldinst') return;
      if (word === 'shppict' || word === 'blipuid') { if (word === 'blipuid') this.st.dest = 'skip'; return; }
      this.st.dest = 'skip';
    }
  }

  private groupClosing(): void {
    const d = this.st.dest;
    const parent = this.stack[this.stack.length - 1]?.dest;
    if (d === 'fonttbl' && parent === 'fonttbl' && this.name) this.endFont();
    if (d === 'colortbl') return;
    if (d === 'stylesheet' && parent === 'stylesheet' && this.name) { this.styles.set(this.styleNum, this.name.replace(/;\s*$/, '').trim()); this.name = ''; }
    if (d === 'pict' && parent !== 'pict') this.endPicture();
    if (this.note && this.stack.length === this.note.depth) this.endNote();
    if (this.field && this.stack.length === this.field.depth) this.field = null;
  }

  private endFont(): void {
    this.fonts.set(this.fontNum, this.name.replace(/;\s*$/, '').trim());
    this.name = '';
  }

  private control(): void {
    const s = this.src;
    this.i++;
    const c = s[this.i];
    if (c === undefined) return;
    if (!/[a-zA-Z]/.test(c)) {
      this.i++;
      if (c === '\'') {
        const hex = s.slice(this.i, this.i + 2);
        this.i += 2;
        this.chars(fromCp1252(parseInt(hex, 16)));
      } else if (c === '\\' || c === '{' || c === '}') this.chars(c);
      else if (c === '\n' || c === '\r') this.par();
      else if (SYMBOLS[c] !== undefined) this.chars(SYMBOLS[c]);
      else if (c === '*') { /* handled with the group */ }
      return;
    }
    let j = this.i;
    while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
    const word = s.slice(this.i, j);
    let k = j;
    if (s[k] === '-' || /\d/.test(s[k] ?? '')) { k++; while (k < s.length && /\d/.test(s[k])) k++; }
    const num = k > j ? Number(s.slice(j, k)) : null;
    if (s[k] === ' ') k++;
    this.i = k;
    this.word(word, num);
  }

  private chars(t: string): void {
    const d = this.st.dest;
    if (d === 'skip') return;
    if (d === 'fonttbl' || d === 'stylesheet') { this.name += t; if (d === 'fonttbl' && t.includes(';') && this.stack[this.stack.length - 1]?.dest !== 'fonttbl') this.endFont(); return; }
    if (d === 'colortbl') {
      for (const ch of t) if (ch === ';') { this.colors.push(this.rgb ? `#${this.rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}` : undefined); this.rgb = null; }
      return;
    }
    if (d === 'pict') { if (this.pict) this.pict.hex += t.replace(/[^0-9a-fA-F]/g, ''); return; }
    if (d === 'fldinst') { if (this.field) this.field.inst += t; return; }
    if (this.st.hidden) return;
    const look = this.look();
    if (this.note) { this.note.runs.push({ ...look, text: t }); return; }
    if (this.ps.intbl) { this.cell.runs.push({ ...look, text: t }); return; }
    this.flushTable();
    this.b.text(t, look);
  }

  private look(): rt.RunStyle {
    const s = this.st;
    const font = this.fonts.get(s.font ?? this.defaultFont);
    return rt.cleanStyle({
      bold: s.bold, italic: s.italic, underline: s.underline, strike: s.strike, sub: s.sub, sup: s.sup, smallCaps: s.smallCaps, allCaps: s.allCaps,
      font: font || 'Times New Roman', size: s.size ?? 12, color: s.color ? this.colors[s.color] : undefined, highlight: s.highlight ? this.colors[s.highlight] : undefined,
    });
  }

  private paraStyle(): ParaStyle {
    const p = this.ps;
    const named = p.style !== undefined ? styleIdOf(this.styles.get(p.style)) : undefined;
    const style = named ?? (p.outline !== undefined && p.outline < 9 ? headingId(p.outline + 1) : undefined);
    return {
      ...(style ? { style } : {}), align: p.align, spaceBefore: p.spaceBefore, spaceAfter: p.spaceAfter, indent: p.indent, firstLine: p.firstLine, indentRight: p.indentRight,
      line: p.line, linePt: p.linePt, lineRule: p.lineRule, keepNext: p.keepNext, list: p.list, pageBreak: p.pageBreak,
    };
  }

  private par(): void {
    if (this.st.dest !== 'text') return;
    if (this.note) { this.note.runs.push({ ...this.look(), text: '\n' }); return; }
    if (this.ps.intbl) { this.cell.runs.push({ ...this.look(), text: '\n' }); this.cell.paras.push(this.paraStyle()); return; }
    this.flushTable();
    this.b.endPara(this.paraStyle());
  }

  private word(w: string, n: number | null): void {
    const st = this.st;
    const on = n !== 0;
    // inside what isn't read, only what moves through the file counts (and an old-style list's kind)
    if (st.dest === 'skip') {
      if (w === 'bin') this.i += n ?? 0;
      else if (w === 'u') this.skipFallback(st.uc);
      else if (w === 'pnlvlblt') this.ps.list = 'bullet';
      else if (w === 'pnlvlbody' || w === 'pndec') this.ps.list ??= 'number';
      return;
    }
    switch (w) {
      case 'fonttbl': st.dest = 'fonttbl'; return;
      case 'colortbl': st.dest = 'colortbl'; return;
      case 'stylesheet': st.dest = 'stylesheet'; return;
      case 'pict': st.dest = 'pict'; this.pict = { hex: '' }; return;
      case 'fldinst': st.dest = 'fldinst'; this.field = { inst: '', depth: this.stack.length - 1 }; return;
      case 'fldrslt': st.dest = 'text'; return;
      case 'footnote': {
        // the note's text, kept apart; its mark (\chftn) is already in the text
        this.note = { runs: [], depth: this.stack.length, end: false, ps: { ...this.ps } };
        st.dest = 'text';
        return;
      }
      case 'deff': this.defaultFont = n ?? 0; return;
      case 'f':
        if (st.dest === 'fonttbl') { if (this.name) this.endFont(); this.fontNum = n ?? 0; } else st.font = n ?? 0;
        return;
      case 'red': if (st.dest === 'colortbl') (this.rgb ??= [0, 0, 0])[0] = n ?? 0; return;
      case 'green': if (st.dest === 'colortbl') (this.rgb ??= [0, 0, 0])[1] = n ?? 0; return;
      case 'blue': if (st.dest === 'colortbl') (this.rgb ??= [0, 0, 0])[2] = n ?? 0; return;
      case 's': if (st.dest === 'stylesheet') this.styleNum = n ?? 0; else this.ps.style = n ?? 0; return;
      case 'outlinelevel': this.ps.outline = n ?? 0; return;
      case 'b': st.bold = on || undefined; return;
      case 'i': st.italic = on || undefined; return;
      case 'ul': st.underline = on || undefined; return;
      case 'uld': case 'uldb': case 'ulw': case 'ulth': case 'uldash': st.underline = true; return;
      case 'ulnone': st.underline = undefined; return;
      case 'strike': case 'striked': st.strike = on || undefined; return;
      case 'sub': st.sub = true; st.sup = undefined; return;
      case 'super': st.sup = true; st.sub = undefined; return;
      case 'nosupersub': st.sub = st.sup = undefined; return;
      case 'scaps': st.smallCaps = on || undefined; return;
      case 'caps': st.allCaps = on || undefined; return;
      case 'v': st.hidden = on || undefined; return;
      case 'fs': st.size = (n ?? 24) / 2; return;
      case 'cf': st.color = n ?? 0; return;
      case 'highlight': case 'cb': case 'chcbpat': st.highlight = n || undefined; return;
      case 'plain': Object.assign(st, { bold: undefined, italic: undefined, underline: undefined, strike: undefined, sub: undefined, sup: undefined, font: undefined, size: undefined, color: undefined, highlight: undefined, smallCaps: undefined, allCaps: undefined, hidden: undefined }); return;
      case 'uc': st.uc = n ?? 1; return;
      case 'u': {
        const code = (n ?? 0) < 0 ? (n ?? 0) + 65536 : n ?? 0;
        this.chars(String.fromCharCode(code));
        this.skipFallback(st.uc);
        return;
      }
      case 'par': this.par(); return;
      case 'line': this.chars('\n'); return;
      case 'tab': this.chars('\t'); return;
      case 'page': if (st.dest === 'text') { if (this.b.hasText) this.par(); this.b.pendingBreak = true; } return;
      case 'pard': this.ps = { intbl: undefined }; return;
      case 'ql': this.ps.align = undefined; return;
      case 'qc': this.ps.align = 'center'; return;
      case 'qr': this.ps.align = 'right'; return;
      case 'qj': this.ps.align = 'justify'; return;
      case 'sb': this.ps.spaceBefore = (n ?? 0) / TWIP; return;
      case 'sa': this.ps.spaceAfter = (n ?? 0) / TWIP; return;
      case 'li': this.ps.indent = (n ?? 0) / TWIP || undefined; return;
      case 'ri': this.ps.indentRight = (n ?? 0) / TWIP || undefined; return;
      case 'fi': this.ps.firstLine = (n ?? 0) / TWIP || undefined; return;
      case 'keepn': this.ps.keepNext = true; return;
      case 'pagebb': this.ps.pageBreak = true; return;
      case 'sl': {
        const v = n ?? 0;
        if (v === 0) { this.ps.line = undefined; this.ps.linePt = undefined; this.ps.lineRule = undefined; return; }
        // a multiple of single (with \slmult1), or points, exact when negative
        this.ps.linePt = Math.abs(v) / TWIP;
        this.ps.lineRule = v < 0 ? 'exact' : 'atLeast';
        return;
      }
      case 'slmult':
        if (n === 1 && this.ps.linePt) { this.ps.line = Math.round((this.ps.linePt * TWIP / 240) * 100) / 100; this.ps.linePt = undefined; this.ps.lineRule = undefined; }
        return;
      case 'pnlvlblt': this.ps.list = 'bullet'; return;
      case 'pnlvlbody': case 'pndec': this.ps.list ??= 'number'; return;
      case 'intbl': this.ps.intbl = true; return;
      case 'trowd': this.cellx = []; return;
      case 'cellx': this.cellx.push((n ?? 0) / TWIP); return;
      case 'cell': this.endCell(); return;
      case 'row': this.endRow(); return;
      case 'paperw': this.page.w = (n ?? 12240) / TWIP; return;
      case 'paperh': this.page.h = (n ?? 15840) / TWIP; return;
      case 'margl': this.page.left = (n ?? 1440) / TWIP; return;
      case 'margr': this.page.right = (n ?? 1440) / TWIP; return;
      case 'margt': this.page.top = (n ?? 1440) / TWIP; return;
      case 'margb': this.page.bottom = (n ?? 1440) / TWIP; return;
      case 'pngblip': if (this.pict) this.pict.type = 'image/png'; return;
      case 'jpegblip': if (this.pict) this.pict.type = 'image/jpeg'; return;
      case 'emfblip': case 'wmetafile': case 'macpict': case 'dibitmap': case 'wbitmap': if (this.pict) this.pict.type = 'other'; return;
      case 'picw': if (this.pict) this.pict.w = n ?? 0; return;
      case 'pich': if (this.pict) this.pict.h = n ?? 0; return;
      case 'picwgoal': if (this.pict) this.pict.goalW = (n ?? 0) / TWIP; return;
      case 'pichgoal': if (this.pict) this.pict.goalH = (n ?? 0) / TWIP; return;
      case 'picscalex': if (this.pict) this.pict.scaleX = (n ?? 100) / 100; return;
      case 'picscaley': if (this.pict) this.pict.scaleY = (n ?? 100) / 100; return;
      case 'bin': this.i += n ?? 0; return;
      default:
        if (SKIP.has(w)) { st.dest = 'skip'; return; }
        if (SYMBOLS[w] !== undefined) this.chars(SYMBOLS[w]);
    }
  }

  /** Skip the characters after a \uN that stand in for it in programs without Unicode. */
  private skipFallback(n: number): void {
    const s = this.src;
    while (n > 0 && this.i < s.length) {
      const c = s[this.i];
      if (c === '{' || c === '}') return;
      if (c === '\\') {
        if (s[this.i + 1] === '\'') { this.i += 4; n--; continue; }
        // another control word counts as one character
        const m = /^\\[a-zA-Z]+-?\d* ?/.exec(s.slice(this.i, this.i + 32));
        this.i += m ? m[0].length : 2;
        n--;
        continue;
      }
      if (c !== '\r' && c !== '\n') n--;
      this.i++;
    }
  }

  private endPicture(): void {
    const p = this.pict;
    this.pict = null;
    if (!p) return;
    if (p.type !== 'image/png' && p.type !== 'image/jpeg') { this.warnings.add('Pictures in RTF\'s older picture formats (metafiles, bitmaps) were left out.'); return; }
    const bytes = new Uint8Array(p.hex.length >> 1);
    for (let k = 0; k < bytes.length; k++) bytes[k] = parseInt(p.hex.substr(k * 2, 2), 16);
    let bin = '';
    for (let k = 0; k < bytes.length; k++) bin += String.fromCharCode(bytes[k]);
    const src = `data:${p.type};base64,${btoa(bin)}`;
    const w = (p.goalW ?? (p.w ?? 100) * 0.75) * (p.scaleX ?? 1), h = (p.goalH ?? (p.h ?? 100) * 0.75) * (p.scaleY ?? 1);
    const o: DocObject = { kind: 'picture', src, w: Math.round(w * 100) / 100, h: Math.round(h * 100) / 100, ...(p.w && p.h ? { px: { w: p.w, h: p.h } } : {}) };
    const look = this.look();
    if (this.ps.intbl) { this.cell.runs.push({ ...look, obj: this.b.reserve(o), text: '￼' }); return; }
    if (this.note) { this.note.runs.push({ ...look, obj: this.b.reserve(o), text: '￼' }); return; }
    this.flushTable();
    this.b.object(o, look);
  }

  private endNote(): void {
    const n = this.note!;
    this.note = null;
    // the text's paragraph goes on as it was before the note
    this.ps = n.ps;
    // the note's own mark at its start is shown by the note, not typed in it
    let runs = rt.normalizeRuns(n.runs);
    let text = rt.plainText(runs);
    const lead = /^\s*/.exec(text)?.[0].length ?? 0;
    runs = rt.sliceRuns(runs, lead, text.length);
    text = rt.plainText(runs);
    if (text.endsWith('\n')) runs = rt.sliceRuns(runs, 0, text.length - 1);
    const o: DocObject = { kind: 'note', runs: runs.length ? runs : [{ ...this.look(), text: '' }], paras: fitParas([], paraCount(rt.plainText(runs))) };
    const look = this.look();
    if (this.ps.intbl) this.cell.runs.push({ ...look, sup: undefined, obj: this.b.reserve(o), text: '￼' });
    else this.b.object(o, { ...look, sup: undefined });
  }

  private endCell(): void {
    this.row.push(finishCell(this.cell, this.paraStyle()));
    this.cell = { runs: [], paras: [] };
  }

  private endRow(): void {
    if (this.cell.runs.length) this.endCell();
    const xs = this.cellx.length ? this.cellx : this.row.map((_, i) => (i + 1) * 100);
    const cols = xs.map((x, i) => Math.max(12, x - (i ? xs[i - 1] : 0)));
    if (cols.length > this.tableCols.length) this.tableCols = cols;
    this.rows.push(this.row);
    this.row = [];
    this.ps.intbl = undefined;
  }

  private flushTable(): void {
    if (!this.rows.length) return;
    const n = Math.max(...this.rows.map((r) => r.length), this.tableCols.length);
    const cols = Array.from({ length: n }, (_, i) => this.tableCols[i] ?? 72);
    const rows = this.rows.map((r) => Array.from({ length: n }, (_, i) => r[i] ?? { runs: [{ text: '' }] }));
    const table: TableData = { cols, rows, head: 0, lines: 'grid' };
    this.rows = [];
    this.tableCols = [];
    this.b.table({ kind: 'table', table });
  }
}

function finishCell(c: { runs: TextRun[]; paras: ParaStyle[] }, last: ParaStyle): TableCell {
  let runs = rt.normalizeRuns(c.runs);
  const text = rt.plainText(runs);
  if (text.endsWith('\n')) runs = rt.sliceRuns(runs, 0, text.length - 1);
  const paras = [...c.paras.slice(0, paraCount(rt.plainText(runs)) - 1), last].map(({ style: _s, ...p }) => p);
  return { runs: runs.length ? runs : [{ text: '' }], ...(paras.some((p) => Object.values(p).some((v) => v !== undefined)) ? { paras } : {}) };
}

// ---------------------------------------------------------------- writing

export interface RtfDeps {
  /** A drawing's picture: PNG bytes and its size in points. */
  picture?(contents: Contents, style: DocStyle): Promise<{ png: Uint8Array; w: number; h: number } | null>;
}

/** Text for RTF: its special characters escaped, characters past ASCII as cp1252 or \uN. */
export function rtfText(t: string): string {
  let out = '';
  for (const ch of t) {
    if (ch === '\\' || ch === '{' || ch === '}') out += `\\${ch}`;
    else if (ch === '\t') out += '\\tab ';
    else if (ch === '\u00a0') out += '\\~';
    else {
      const c = ch.codePointAt(0)!;
      if (c < 0x80) out += ch;
      else {
        const b = toCp1252(ch);
        if (b !== null) out += `\\'${b.toString(16).padStart(2, '0')}`;
        else if (c > 0xffff) for (const u of [0xd800 + ((c - 0x10000) >> 10), 0xdc00 + ((c - 0x10000) & 0x3ff)]) out += `\\u${u - (u > 32767 ? 65536 : 0)}?`;
        else out += `\\u${c > 32767 ? c - 65536 : c}?`;
      }
    }
  }
  return out;
}

/** The document as RTF. */
export async function writeRtf(t: DocText, deps: RtfDeps = {}): Promise<Uint8Array> {
  const w = new RtfWriter(t, deps);
  const body = await w.body();
  const s = `{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1\n${w.fontTable()}\n${w.colorTable()}\n${w.styleSheet()}\n{\\*\\generator Chem Illustrator;}\n` +
    `\\paperw${twip(t.page.w)}\\paperh${twip(t.page.h)}\\margl${twip(t.page.left)}\\margr${twip(t.page.right)}\\margt${twip(t.page.top)}\\margb${twip(t.page.bottom)}\n${body}}`;
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

class RtfWriter {
  private fonts: string[] = [];
  private colors: string[] = [];
  private fields: Map<number, string>;

  constructor(private t: DocText, private deps: RtfDeps) {
    this.fields = fieldTexts(t);
    this.font(styleOf(t, {}).font);
  }

  private font(f: string): number {
    let i = this.fonts.indexOf(f);
    if (i < 0) { i = this.fonts.length; this.fonts.push(f); }
    return i;
  }

  private color(c: string): number {
    const hex = c.toLowerCase();
    let i = this.colors.indexOf(hex);
    if (i < 0) { i = this.colors.length; this.colors.push(hex); }
    return i + 1;
  }

  fontTable(): string {
    const kind = (f: string) => (/mono|courier/i.test(f) ? 'fmodern' : /serif|times|georgia|garamond|baskerville|merriweather|cambria|palatino/i.test(f) && !/sans/i.test(f) ? 'froman' : /symbol/i.test(f) ? 'ftech' : 'fswiss');
    return `{\\fonttbl${this.fonts.map((f, i) => `{\\f${i}\\${kind(f)}\\fcharset${/symbol/i.test(f) ? 2 : 0} ${rtfText(f)};}`).join('')}}`;
  }

  colorTable(): string {
    return `{\\colortbl;${this.colors.map((c) => `\\red${parseInt(c.slice(1, 3), 16)}\\green${parseInt(c.slice(3, 5), 16)}\\blue${parseInt(c.slice(5, 7), 16)};`).join('')}}`;
  }

  /** The heading styles (so Word and others know them as headings). */
  styleSheet(): string {
    const out = ['{\\s0 Normal;}'];
    for (let n = 1; n <= 9; n++) if (this.t.styles[headingId(n)]) out.push(`{\\s${n}\\outlinelevel${n - 1} heading ${n};}`);
    if (this.t.styles.Title) out.push('{\\s15 Title;}');
    return `{\\stylesheet${out.join('')}}`;
  }

  private styleNum(ps: ParaStyle): number {
    const h = /^Heading(\d)$/.exec(ps.style ?? '');
    return h ? Number(h[1]) : ps.style === 'Title' ? 15 : 0;
  }

  private paraProps(ps: ParaStyle, inTable = false): string {
    const st = styleOf(this.t, ps);
    const align = ps.align ?? st.align;
    const out = [`\\pard\\plain${inTable ? '\\intbl' : ''}`];
    const sn = this.styleNum(ps);
    if (sn) out.push(`\\s${sn}${sn <= 9 ? `\\outlinelevel${sn - 1}` : ''}`);
    out.push(align === 'center' ? '\\qc' : align === 'right' ? '\\qr' : align === 'justify' ? '\\qj' : '\\ql');
    const sb = ps.spaceBefore ?? st.spaceBefore, sa = ps.spaceAfter ?? st.spaceAfter;
    if (sb) out.push(`\\sb${twip(sb)}`);
    if (sa) out.push(`\\sa${twip(sa)}`);
    const li = ps.indent ?? st.indent, fi = ps.firstLine ?? st.firstLine;
    if (li) out.push(`\\li${twip(li)}`);
    if (fi) out.push(`\\fi${twip(fi)}`);
    if (ps.indentRight) out.push(`\\ri${twip(ps.indentRight)}`);
    if (ps.linePt && ps.linePt > 0) out.push(`\\sl${ps.lineRule === 'exact' ? -twip(ps.linePt) : twip(ps.linePt)}\\slmult0`);
    else {
      const line = ps.line ?? st.line;
      if (line && line !== 1) out.push(`\\sl${Math.round(240 * line)}\\slmult1`);
    }
    if (ps.keepNext ?? st.keepNext) out.push('\\keepn');
    if (ps.pageBreak) out.push('\\pagebb');
    return out.join('') + ' ';
  }

  private runProps(r: TextRun): string {
    const out: string[] = [];
    if (r.font) out.push(`\\f${this.font(r.font)}`);
    if (r.size) out.push(`\\fs${Math.round(r.size * 2)}`);
    if (r.bold) out.push('\\b');
    if (r.italic) out.push('\\i');
    if (r.underline) out.push('\\ul');
    if (r.strike) out.push('\\strike');
    if (r.sub) out.push('\\sub');
    if (r.sup) out.push('\\super');
    if (r.smallCaps) out.push('\\scaps');
    if (r.allCaps) out.push('\\caps');
    if (r.color) out.push(`\\cf${this.color(r.color)}`);
    if (r.highlight) out.push(`\\chcbpat${this.color(r.highlight)}`);
    return out.join('');
  }

  /** A run's text (a formula's digits as subscripts), inside a group with its look. */
  private run(r: TextRun): string {
    if (!r.text) return '';
    if (r.formula && !r.sub && !r.sup) return rt.formulaParts(r.text).map((p) => this.run({ ...r, formula: undefined, sub: p.pos === 'sub' || undefined, sup: p.pos === 'sup' || undefined, text: p.text })).join('');
    const props = this.runProps(r);
    return `{${props}${props ? ' ' : ''}${rtfText(r.text)}}`;
  }

  private async object(r: TextRun): Promise<string> {
    const id = r.obj!;
    const o = this.t.objects[id];
    if (!o) return '';
    const shown = this.fields.get(id);
    if (shown !== undefined && o.kind !== 'note') return this.run({ ...r, obj: undefined, text: shown });
    if (o.kind === 'note') {
      const inner = splitParagraphs(o.runs).map((rs) => rs.map((x) => (x.obj === undefined ? this.run(x) : '')).join('')).join('\\par ');
      return `{${this.runProps({ ...r, sup: true, obj: undefined, text: '' })}\\chftn}{\\footnote${o.end ? '\\ftnalt' : ''}\\pard\\plain{\\super\\chftn} ${inner}}`;
    }
    if (o.kind === 'picture') return this.picture(o.src, o.w * (o.scale ?? 1), o.h * (o.scale ?? 1), o.px);
    if (o.kind === 'drawing' && this.deps.picture) {
      const pic = await this.deps.picture(o.contents, this.t.drawingStyle);
      if (pic) return this.pictureBytes(pic.png, 'png', pic.w * (o.scale ?? 1), pic.h * (o.scale ?? 1));
    }
    if (o.kind === 'math') return this.run({ ...r, obj: undefined, text: o.tex });
    return '';
  }

  private picture(src: string, w: number, h: number, px?: { w: number; h: number }): string {
    const m = /^data:image\/(png|jpeg|jpg);base64,(.*)$/i.exec(src);
    if (!m) return '';
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return this.pictureBytes(bytes, m[1].toLowerCase() === 'png' ? 'png' : 'jpeg', w, h, px);
  }

  private pictureBytes(bytes: Uint8Array, kind: 'png' | 'jpeg', w: number, h: number, px?: { w: number; h: number }): string {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) { hex += bytes[i].toString(16).padStart(2, '0'); if (i % 64 === 63) hex += '\n'; }
    const pw = px?.w ?? Math.round(w / 0.75), ph = px?.h ?? Math.round(h / 0.75);
    return `{\\pict\\${kind}blip\\picw${pw}\\pich${ph}\\picwgoal${twip(w)}\\pichgoal${twip(h)}\n${hex}}`;
  }

  private async runs(rs: TextRun[]): Promise<string> {
    let out = '';
    for (const r of rs) out += r.obj !== undefined ? await this.object(r) : this.run(r);
    return out;
  }

  private async table(tb: TableData): Promise<string> {
    let out = '';
    for (const row of tb.rows) {
      let x = 0;
      out += '\\trowd\\trgaph108';
      tb.cols.forEach((w) => { x += w; out += `\\clbrdrt\\brdrs\\clbrdrl\\brdrs\\clbrdrb\\brdrs\\clbrdrr\\brdrs\\cellx${twip(x)}`; });
      out += '\n';
      for (const c of row) {
        const paras = splitParagraphs(c.runs);
        const ps = fitParas(c.paras, paras.length);
        for (let i = 0; i < paras.length; i++) out += this.paraProps(ps[i], true) + (await this.runs(paras[i])) + (i < paras.length - 1 ? '\\par ' : '');
        out += '\\cell ';
      }
      out += '\\row\n';
    }
    return out + '\\pard\\plain ';
  }

  async body(): Promise<string> {
    const t = this.t;
    const runsOf = splitParagraphs(t.runs);
    const paras = fitParas(t.paras, paraCount(rt.plainText(t.runs)));
    let out = '';
    let num = 0;
    for (let p = 0; p < paras.length; p++) {
      const rs = runsOf[p] ?? [];
      const ps = paras[p];
      // a table is a paragraph of its own
      const only = rs.filter((r) => r.text);
      const tb = only.length === 1 && only[0].obj !== undefined ? t.objects[only[0].obj] : undefined;
      if (tb?.kind === 'table') { out += await this.table(tb.table); continue; }
      let lead = '';
      if (ps.list) {
        num = ps.list === 'number' ? num + 1 : 0;
        lead = `{\\*\\pn${ps.list === 'bullet' ? '\\pnlvlblt' : '\\pnlvlbody\\pndec'}}{\\listtext ${ps.list === 'bullet' ? rtfText(ps.bullet ?? '•') : `${num}.`}\\tab}`;
      } else num = 0;
      const props = this.paraProps(ps.list ? { ...ps, indent: ps.indent ?? 18 * ((ps.level ?? 0) + 1), firstLine: ps.firstLine ?? -18 } : ps);
      out += `${props}${lead}${await this.runs(rs)}\\par\n`;
    }
    return out;
  }
}
