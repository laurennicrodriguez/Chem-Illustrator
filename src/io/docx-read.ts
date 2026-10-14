// Opening Word files (.docx) as documents, from the published Office Open XML standard
// (ECMA-376 part 1, WordprocessingML).
//
// Files saved here come back as they were: each structure from the drawing kept with its
// picture, each table as made here (unless its text was changed in Word). Files from Word come
// in with their text and its formatting (worked out through the named styles, as Word does),
// lists, tables, pictures, captions and cross-references, page setup, header, footer and page
// numbers; ChemDraw objects in them become structures that can be edited here. What has no
// place here yet is noted in warnings (shown to the person, never refused).

import type { Contents, Justify, ParaStyle, TableCell, TableData, TextRun } from '../model';
import { ACS_1996, type DocStyle } from '../style';
import * as rt from '../richtext';
import { PackageReader, REL, kid, kids, rAttr, fromEmu } from './ooxml';
import { dataUrl, imageSize, pictureMime } from '../render/images';
import { cleanPara } from '../text/paragraphs';
import { SINGLE, type Measure } from '../text/layout';
import { arialWidth } from '../text-metrics';
import { documentMeasure } from '../text/font-measure';
import {
  OBJECT_CHAR, defaultHeaderFooter, defaultPage, defaultStyles,
  type DocObject, type DocText, type HeaderFooter, type NamedStyle, type NumberPlace, type PageSetup,
} from '../document/document';
import { shownSize } from '../document/doc-layout';
import { layoutTable } from '../table';
import { cfbStreams, isCfb } from './cfb';
import { isCdx } from './cdx';
import { DOCX_REL, DRAWING_NAME, FORMULA_STYLE, MODEL_NS, TABLE_NAME, W_NS, type DocxModel } from './docx';
import { listIndent, tableText } from './docx-write';

export interface DocxReadDeps {
  /** A ChemDraw drawing (CDX data) as a drawing in the document's style; null when it can't be read. */
  chemdraw?(cdx: Uint8Array, style: DocStyle): Contents | null;
  /** A drawing's own size in points (so it keeps the size it had in Word). */
  drawingSize?(contents: Contents, style: DocStyle): { w: number; h: number } | null;
  /** A table as a drawing, laid out with the fonts on screen (else with published font widths). */
  tableDrawing?(t: TableData, style: DocStyle): Contents;
}

/** Word's text font and size when a file gives none. */
const WORD_FONT = 'Times New Roman';
const WORD_SIZE = 10;
/** The standard styles, by the names Word gives them (in every language). */
const BUILT_IN: Record<string, string> = { normal: 'Normal', title: 'Title', 'heading 1': 'Heading1', 'heading 2': 'Heading2', 'heading 3': 'Heading3', caption: 'Caption' };
const OUTLINE: Record<string, number> = { Heading1: 1, Heading2: 2, Heading3: 3 };
const JUSTIFY: Record<string, Justify> = { left: 'left', start: 'left', center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' };
const EXT_MIME: Record<string, string> = { wmf: 'image/x-wmf', emf: 'image/x-emf', tif: 'image/tiff', tiff: 'image/tiff' };

const WARN = {
  links: 'Links were kept as plain text.',
  notes: 'Footnotes and endnotes were left out.',
  comments: 'Comments were left out.',
  tracked: 'Tracked changes were accepted.',
  equations: 'Equations were kept as plain text.',
  shapes: 'Charts, SmartArt, shapes and text boxes were left out.',
  floating: 'Pictures that floated beside the text are now in line with it.',
  sections: 'This file has several sections: the last one\'s page size, margins, header and footer are used for the whole document.',
  vmerge: 'Table cells merged down a column were split (merging across a row is kept).',
  nested: 'A table inside a table cell was kept as text.',
  cellObjects: 'Pictures and structures inside table cells were left out.',
  wmf: 'Some pictures are in the older Windows Metafile (WMF) format, which can\'t be shown here yet. They are kept, and saved back to Word unchanged.',
  crop: 'Cropped pictures show uncropped.',
  numbering: 'Some numbered lists use numbering that shows here as 1., a., i.',
  looks: 'Strikethrough, highlighting and small capitals were left out.',
  toc: 'The table of contents was kept as plain text.',
  citations: 'Citations from a reference manager were kept as plain text.',
  pageText: 'Text after the page number in the header or footer was left out.',
  ole: 'Embedded objects other than ChemDraw drawings came in as pictures.',
  restart: 'Caption numbers that were set to start again were numbered straight through.',
  hfPictures: 'Pictures and tables in the header and footer were left out.',
};

type Pos = 'base' | 'sub' | 'sup';
/** Text formatting as a file gives it (only what it gives). `color` null is "automatic". */
interface RProps { font?: string; size?: number; bold?: boolean; italic?: boolean; underline?: boolean; color?: string | null; pos?: Pos; hidden?: boolean; formula?: boolean }
/** Paragraph formatting as a file gives it, in points. */
interface PProps {
  align?: Justify; before?: number; after?: number; line?: { v: number; rule: string };
  left?: number; first?: number; keepNext?: boolean; pageBreak?: boolean; outline?: number;
  numId?: string; ilvl?: number; contextual?: boolean;
}
interface WStyle { id: string; type: string; name: string; basedOn?: string; next?: string; isDefault: boolean; p: PProps; r: RProps; el: Element }
interface Level { fmt: string; text: string; p: PProps }
interface Piece { runs: TextRun[]; pageBreak: boolean; soft: boolean }
interface Ctx { base: RProps; pieces: Piece[]; cell: boolean }
interface Field { instr: string; phase: 'instr' | 'result'; swallow: boolean; text: string; props: RProps; done: boolean; ref?: { id: number; mark: string; text: string } }
interface OutPara { ps: ParaStyle; runs: TextRun[]; mark: rt.RunStyle; style: string; contextual: boolean; table?: boolean }

/** Open a Word file. Throws only when the file is not a Word file at all. */
export async function readDocx(bytes: Uint8Array, deps: DocxReadDeps = {}): Promise<{ doc: DocText; warnings: string[] }> {
  return new DocxReader(bytes, deps).read();
}

/** An on/off attribute that is there and on. */
const yes = (v: string | null): boolean => v !== null && /^(1|true|on)$/i.test(v);
const merge = <T extends object>(...xs: (T | undefined)[]): T => Object.assign({}, ...xs.filter(Boolean)) as T;
const round = (v: number, k = 100) => Math.round(v * k) / k;

class DocxReader {
  private pkg: PackageReader;
  private W = W_NS;
  private main = 'word/document.xml';
  private warnings = new Set<string>();
  private theme = { major: '', minor: '' };
  private wstyles = new Map<string, WStyle>();
  private defaultPara = 'Normal';
  private docDefaults: { p: PProps; r: RProps } = { p: {}, r: {} };
  /** Word's style ids to ours (Word's default paragraph style is our Normal, and so on). */
  private idMap = new Map<string, string>();
  private used = new Set<string>();
  private abstracts = new Map<string, Level[]>();
  private nums = new Map<string, string>();
  private model: DocxModel | null = null;
  private objects: Record<number, DocObject> = {};
  private nextId = 1;
  private out: OutPara[] = [];
  private drawingStyle: DocStyle = { ...ACS_1996 };
  private page: PageSetup = defaultPage();
  private textW = 468;
  private fields: Field[] = [];
  private openMarks = new Map<string, string>();
  private markSeq = new Map<string, number>();
  private refs: { id: number; mark: string; text: string }[] = [];
  /** The next paragraph starts a new page (after a section break). */
  private breakNext = false;
  /** A table's notes, written after it as a paragraph, to leave out when the table comes from our own part. */
  private pendingNotes: string | null = null;
  private measure: Measure = documentMeasure((t, size, _f, style) => arialWidth(t, size, /bold/.test(style)));

  constructor(bytes: Uint8Array, private deps: DocxReadDeps) {
    this.pkg = new PackageReader(bytes);
  }

  read(): { doc: DocText; warnings: string[] } {
    const pkg = this.pkg;
    this.main = pkg.relOfType('', REL.officeDocument) ?? 'word/document.xml';
    const doc = pkg.xml(this.main);
    const root = doc?.documentElement;
    const body = root && kid(root, 'body');
    if (!root || !body) throw new Error('This is not a Word document');
    this.W = root.namespaceURI ?? W_NS;
    this.readTheme();
    this.readStyles();
    this.readNumbering();
    this.readModel();
    const sects = Array.from(root.getElementsByTagNameNS(this.W, 'sectPr'));
    const last = kids(body, 'sectPr')[0] ?? sects[sects.length - 1] ?? null;
    if (sects.length > 1) this.warn('sections');
    this.readPage(last);
    this.blocks(kids(body));
    this.resolveRefs();
    const hf = this.readHeaderFooter(last);
    return { doc: this.assemble(hf), warnings: [...this.warnings] };
  }

  private warn(k: keyof typeof WARN): void {
    this.warnings.add(WARN[k]);
  }

  // ---------------------------------------------------------------- attributes

  private a(el: Element | null | undefined, name = 'val'): string | null {
    if (!el) return null;
    return el.getAttributeNS(this.W, name) ?? el.getAttribute('w:' + name);
  }

  /** A switch (bold, keep with next): on unless it says 0, false or off. */
  private on(el: Element | null | undefined): boolean {
    const v = this.a(el);
    return v === null || !/^(0|false|off|none)$/i.test(v);
  }

  /** A measure in twentieths of a point, in points. */
  private tw(el: Element | null | undefined, name: string): number | undefined {
    const v = this.a(el, name);
    if (v === null) return undefined;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n / 20 : undefined;
  }

  // ---------------------------------------------------------------- theme, styles, lists, our part

  private readTheme(): void {
    const path = this.pkg.relOfType(this.main, DOCX_REL.theme);
    const th = path ? this.pkg.xml(path) : null;
    if (!th) return;
    const fs = th.getElementsByTagNameNS('*', 'fontScheme')[0];
    this.theme.major = kid(kid(fs, 'majorFont'), 'latin')?.getAttribute('typeface') ?? '';
    this.theme.minor = kid(kid(fs, 'minorFont'), 'latin')?.getAttribute('typeface') ?? '';
  }

  private readRPr(el: Element | null, direct = true): RProps {
    const out: RProps = {};
    for (const c of kids(el)) {
      switch (c.localName) {
        case 'rFonts': {
          const th = this.a(c, 'asciiTheme') ?? this.a(c, 'hAnsiTheme');
          const f = th ? (/^major/.test(th) ? this.theme.major : this.theme.minor) : null;
          const font = f || this.a(c, 'ascii') || this.a(c, 'hAnsi');
          if (font) out.font = font;
          break;
        }
        case 'b': out.bold = this.on(c); break;
        case 'i': out.italic = this.on(c); break;
        case 'u': out.underline = this.a(c) !== 'none'; break;
        case 'sz': { const v = parseFloat(this.a(c) ?? ''); if (v > 0) out.size = v / 2; break; }
        case 'color': {
          const v = this.a(c) ?? 'auto';
          out.color = /^[0-9a-f]{6}$/i.test(v) ? `#${v.toLowerCase()}` : null;
          break;
        }
        case 'vertAlign': { const v = this.a(c); out.pos = v === 'subscript' ? 'sub' : v === 'superscript' ? 'sup' : 'base'; break; }
        case 'vanish': out.hidden = this.on(c); break;
        case 'rStyle': Object.assign(out, this.charStyle(this.a(c) ?? '')); break;
        case 'strike': case 'dstrike': case 'smallCaps': case 'caps': case 'highlight':
          if (direct && this.on(c) && this.a(c) !== 'none') this.warn('looks');
          break;
      }
    }
    return out;
  }

  private readPPr(el: Element | null): PProps {
    const out: PProps = {};
    for (const c of kids(el)) {
      switch (c.localName) {
        case 'jc': { const j = JUSTIFY[this.a(c) ?? '']; if (j) out.align = j; break; }
        case 'spacing': {
          const b = this.tw(c, 'before'), af = this.tw(c, 'after'), line = this.a(c, 'line');
          // "automatic" spacing (from web pages) is 14 pt
          if (yes(this.a(c, 'beforeAutospacing'))) out.before = 14;
          else if (b !== undefined) out.before = b;
          if (yes(this.a(c, 'afterAutospacing'))) out.after = 14;
          else if (af !== undefined) out.after = af;
          if (line !== null && Number.isFinite(parseFloat(line))) out.line = { v: parseFloat(line), rule: this.a(c, 'lineRule') ?? 'auto' };
          break;
        }
        case 'ind': {
          const left = this.tw(c, 'left') ?? this.tw(c, 'start');
          if (left !== undefined) out.left = left;
          const hang = this.tw(c, 'hanging'), first = this.tw(c, 'firstLine');
          if (hang !== undefined) out.first = -hang;
          else if (first !== undefined) out.first = first;
          break;
        }
        case 'keepNext': out.keepNext = this.on(c); break;
        case 'pageBreakBefore': out.pageBreak = this.on(c); break;
        case 'outlineLvl': { const v = Number(this.a(c)); if (v >= 0 && v < 9) out.outline = v + 1; break; }
        case 'contextualSpacing': out.contextual = this.on(c); break;
        case 'numPr': {
          const id = this.a(kid(c, 'numId'));
          if (id !== null) out.numId = id;
          const lvl = this.a(kid(c, 'ilvl'));
          if (lvl !== null) out.ilvl = Number(lvl) || 0;
          break;
        }
      }
    }
    return out;
  }

  private readStyles(): void {
    const path = this.pkg.relOfType(this.main, DOCX_REL.styles);
    const st = path ? this.pkg.xml(path) : null;
    const root = st?.documentElement;
    if (!root) return;
    const dd = kid(root, 'docDefaults');
    this.docDefaults = { r: this.readRPrPlain(kid(dd, 'rPrDefault', 'rPr')), p: this.readPPr(kid(dd, 'pPrDefault', 'pPr')) };
    for (const s of kids(root, 'style')) {
      const id = this.a(s, 'styleId') ?? '';
      const type = this.a(s, 'type') ?? 'paragraph';
      const name = this.a(kid(s, 'name')) ?? id;
      const ws: WStyle = {
        id, type, name, basedOn: this.a(kid(s, 'basedOn')) ?? undefined, next: this.a(kid(s, 'next')) ?? undefined,
        isDefault: yes(this.a(s, 'default')), p: {}, r: {}, el: s,
      };
      this.wstyles.set(`${type}:${id}`, ws);
      if (type === 'paragraph' && ws.isDefault) this.defaultPara = id;
    }
    // what each style gives, its own settings over those of the style it is based on
    for (const ws of this.wstyles.values()) {
      ws.p = this.readPPr(kid(ws.el, 'pPr'));
      ws.r = this.readRPrPlain(kid(ws.el, 'rPr'));
    }
    // Word's style ids to ours
    const taken = new Set<string>();
    for (const ws of this.wstyles.values()) {
      if (ws.type !== 'paragraph') continue;
      const ours = ws.id === this.defaultPara ? 'Normal' : BUILT_IN[ws.name.toLowerCase()];
      if (ours && ours !== 'Normal' && taken.has(ours)) continue;
      if (ours) { this.idMap.set(ws.id, ours); taken.add(ours); }
    }
    for (const ws of this.wstyles.values()) {
      if (ws.type !== 'paragraph' || this.idMap.has(ws.id)) continue;
      let id = ws.id || 'Style';
      while (taken.has(id) || Object.prototype.hasOwnProperty.call(BUILT_IN_IDS, id)) id += '_';
      this.idMap.set(ws.id, id);
      taken.add(id);
    }
  }

  /** Text formatting without character styles (for the styles themselves). */
  private readRPrPlain(el: Element | null): RProps {
    if (!el) return {};
    const clone = el.cloneNode(true) as Element;
    for (const c of kids(clone, 'rStyle')) clone.removeChild(c);
    return this.readRPr(clone, false);
  }

  /** A style's settings with those of the styles it is based on. */
  private chain(type: string, id: string | undefined): { p: PProps; r: RProps } {
    const list: WStyle[] = [];
    const seen = new Set<string>();
    for (let s = id ? this.wstyles.get(`${type}:${id}`) : undefined; s && !seen.has(s.id); s = s.basedOn ? this.wstyles.get(`${type}:${s.basedOn}`) : undefined) {
      seen.add(s.id);
      list.unshift(s);
    }
    return { p: merge<PProps>(...list.map((s) => s.p)), r: merge<RProps>(...list.map((s) => s.r)) };
  }

  private charCache = new Map<string, RProps>();
  /** What a character style gives; a formula style marks chemical formulas. */
  private charStyle(id: string): RProps {
    let r = this.charCache.get(id);
    if (r) return r;
    this.charCache.set(id, {});
    const ws = this.wstyles.get(`character:${id}`);
    r = { ...this.chain('character', id).r };
    if (id === FORMULA_STYLE || ws?.name === 'Chemical Formula') r.formula = true;
    this.charCache.set(id, r);
    return r;
  }

  private readNumbering(): void {
    const path = this.pkg.relOfType(this.main, DOCX_REL.numbering);
    const nb = path ? this.pkg.xml(path) : null;
    const root = nb?.documentElement;
    if (!root) return;
    const links = new Map<string, string>();
    for (const an of kids(root, 'abstractNum')) {
      const id = this.a(an, 'abstractNumId') ?? '';
      const levels: Level[] = [];
      for (const l of kids(an, 'lvl')) {
        const i = Number(this.a(l, 'ilvl') ?? levels.length);
        levels[i] = { fmt: this.a(kid(l, 'numFmt')) ?? 'decimal', text: this.a(kid(l, 'lvlText')) ?? '', p: this.readPPr(kid(l, 'pPr')) };
      }
      this.abstracts.set(id, levels);
      const link = this.a(kid(an, 'numStyleLink'));
      if (link) links.set(id, link);
    }
    for (const n of kids(root, 'num')) this.nums.set(this.a(n, 'numId') ?? '', this.a(kid(n, 'abstractNumId')) ?? '');
    // a list that takes its levels from a numbering style
    for (const [id, link] of links) {
      const numId = this.chain('numbering', link).p.numId;
      const target = numId ? this.abstracts.get(this.nums.get(numId) ?? '') : undefined;
      if (target?.length) this.abstracts.set(id, target);
    }
  }

  private readModel(): void {
    for (const name of this.pkg.names()) {
      if (!/^customXml\/item\d+\.xml$/i.test(name)) continue;
      try {
        const d = this.pkg.xml(name)?.documentElement;
        if (!d || d.namespaceURI !== MODEL_NS) continue;
        const m = JSON.parse(d.textContent ?? '') as DocxModel;
        if (m?.app !== 'Chem Illustrator') continue;
        this.model = m;
        if (m.drawingStyle) this.drawingStyle = { ...ACS_1996, ...m.drawingStyle };
        return;
      } catch {
        // someone else's part, or ours damaged: the file is read as Word shows it
      }
    }
  }

  // ---------------------------------------------------------------- page

  private readPage(sect: Element | null): void {
    const sz = kid(sect, 'pgSz'), mar = kid(sect, 'pgMar');
    const d = defaultPage();
    const get = (el: Element | null, n: string, dflt: number) => Math.abs(this.tw(el, n) ?? dflt);
    this.page = {
      w: get(sz, 'w', d.w), h: get(sz, 'h', d.h),
      top: get(mar, 'top', d.top), bottom: get(mar, 'bottom', d.bottom), left: get(mar, 'left', d.left), right: get(mar, 'right', d.right),
      header: get(mar, 'header', d.header), footer: get(mar, 'footer', d.footer),
    };
    if (this.page.w < 72 || this.page.h < 72) this.page = d;
    this.textW = Math.max(36, this.page.w - this.page.left - this.page.right);
  }

  // ---------------------------------------------------------------- the text

  /** Block content: paragraphs, tables and the containers round them. */
  private blocks(els: Element[]): void {
    for (const el of els) {
      switch (el.localName) {
        case 'p': this.paragraph(el); break;
        case 'tbl': this.table(el); break;
        case 'sdt': this.blocks(kids(kid(el, 'sdtContent'))); break;
        case 'customXml': case 'ins': case 'moveTo': case 'smartTag': this.blocks(kids(el)); break;
        case 'AlternateContent': this.blocks(kids(this.alternate(el))); break;
        case 'bookmarkStart': this.markStart(el); break;
        case 'bookmarkEnd': this.markEnd(el); break;
      }
    }
  }

  /** The part of a choice of contents (mc:AlternateContent) to read: the plain one meant for older programs. */
  private alternate(el: Element): Element | null {
    return kid(el, 'Fallback') ?? kid(el, 'Choice');
  }

  /** A paragraph's own and its style's formatting. */
  private paraProps(pPr: Element | null): { style: string; p: PProps; direct: PProps; base: RProps; mark: RProps } {
    const sid = this.a(kid(pPr, 'pStyle')) ?? this.defaultPara;
    const style = this.wstyles.has(`paragraph:${sid}`) ? sid : this.defaultPara;
    const ch = this.chain('paragraph', style);
    const direct = this.readPPr(pPr);
    const p = merge<PProps>(this.docDefaults.p, ch.p, direct);
    const base = merge<RProps>(this.docDefaults.r, ch.r);
    const mark = merge<RProps>(base, this.readRPr(kid(pPr, 'rPr')));
    return { style, p, direct, base, mark };
  }

  private paragraph(el: Element): void {
    const pPr = kid(el, 'pPr');
    const { style, p: own, direct, base, mark } = this.paraProps(pPr);
    // a section ends with this paragraph: the next one starts a new page unless the section break says otherwise
    const sect = kid(pPr, 'sectPr');
    const ctx: Ctx = { base, pieces: [{ runs: [], pageBreak: false, soft: false }], cell: false };
    this.inline(kids(el), ctx);
    const sectionBreak = () => { if (sect) this.breakNext = !/^continuous$/i.test(this.a(kid(sect, 'type')) ?? 'nextPage'); };
    const text = ctx.pieces.map((pc) => rt.plainText(pc.runs)).join('\n');
    // a table's notes written after it (by this program): the table has them already
    if (this.pendingNotes !== null) {
      const notes = this.pendingNotes;
      this.pendingNotes = null;
      if (text === notes) { sectionBreak(); return; }
    }
    this.used.add(style);
    const ours = this.idMap.get(style) ?? 'Normal';
    const size = mark.size ?? WORD_SIZE;
    // the numbering's indents come between the style's and the paragraph's own
    const numId = own.numId;
    const levels = numId && numId !== '0' ? this.abstracts.get(this.nums.get(numId) ?? '') : undefined;
    const ilvl = Math.max(0, Math.min(8, own.ilvl ?? 0));
    const level = levels?.[ilvl];
    const p = level ? merge<PProps>(this.docDefaults.p, this.chain('paragraph', style).p, level.p, direct) : own;
    let list: 'bullet' | 'number' | undefined;
    if (level && level.fmt !== 'none') {
      list = level.fmt === 'bullet' ? 'bullet' : 'number';
      if (list === 'number' && (level.fmt !== ['decimal', 'lowerLetter', 'lowerRoman'][ilvl % 3] || !new RegExp(`^%${ilvl + 1}\\.$`).test(level.text))) this.warn('numbering');
    }
    const firstSize = ctx.pieces[0].runs.find((r) => r.obj === undefined)?.size ?? size;
    let indent = Math.max(0, p.left ?? 0);
    if (list) indent = Math.max(0, indent - listIndent({ list, level: ilvl }, firstSize).left);
    const brk = this.takeBreak();
    const ps: ParaStyle = {
      style: ours === 'Normal' ? undefined : ours,
      align: p.align && p.align !== 'left' ? p.align : undefined,
      spaceBefore: round(p.before ?? 0), spaceAfter: round(p.after ?? 0), line: this.lineOf(p, size),
      indent: round(indent), firstLine: list ? undefined : round(p.first ?? 0), keepNext: p.keepNext,
      pageBreak: p.pageBreak || brk, list, level: list ? ilvl : undefined,
    };
    const markStyle = this.runStyle(mark);
    ctx.pieces.forEach((pc, i) => {
      let q: ParaStyle = { ...ps };
      if (i > 0) {
        q.pageBreak = pc.pageBreak || undefined;
        if (pc.soft) {
          // a line break inside a paragraph: the next line as a paragraph of its own, with no space between
          if (list) q.cont = true;
          q.spaceBefore = 0;
          q.firstLine = undefined;
          const prev = this.out[this.out.length - 1];
          if (prev) prev.ps = cleanPara({ ...prev.ps, spaceAfter: 0 });
        }
      } else if (pc.pageBreak) q.pageBreak = true;
      q = cleanPara(q);
      this.out.push({ ps: q, runs: pc.runs, mark: markStyle, style: ours, contextual: !!p.contextual });
    });
    sectionBreak();
  }

  private takeBreak(): boolean | undefined {
    const b = this.breakNext;
    this.breakNext = false;
    return b || undefined;
  }

  /** Line spacing as a multiple of single (Word's "exactly" and "at least" turned into the nearest multiple). */
  private lineOf(p: PProps, size: number): number | undefined {
    if (!p.line) return undefined;
    let m: number;
    if (p.line.rule === 'auto') m = p.line.v / 240;
    else {
      m = p.line.v / 20 / (SINGLE * size);
      if (p.line.rule === 'atLeast') m = Math.max(1, m);
    }
    m = round(Math.max(0.5, Math.min(5, m)));
    return m === 1 ? undefined : m;
  }

  /** The formatting of a run of text as this program keeps it (always with its font and size). */
  private runStyle(r: RProps): rt.RunStyle {
    const formula = !!r.formula;
    return rt.cleanStyle({
      font: r.font ?? WORD_FONT, size: r.size ?? WORD_SIZE, bold: r.bold, italic: r.italic, underline: r.underline,
      color: r.color ?? undefined, formula: formula || undefined,
      sub: (!formula && r.pos === 'sub') || undefined, sup: (!formula && r.pos === 'sup') || undefined,
    });
  }

  private piece(ctx: Ctx): Piece {
    return ctx.pieces[ctx.pieces.length - 1];
  }

  /** Inside a field's instruction, or the result of a caption number or reference (which are worked out here). */
  private swallowing(skipTop = false): boolean {
    const n = this.fields.length - (skipTop ? 1 : 0);
    for (let i = 0; i < n; i++) if (this.fields[i].phase === 'instr' || this.fields[i].swallow) return true;
    return false;
  }

  private emitText(ctx: Ctx, text: string, r: RProps): void {
    if (!text || r.hidden) return;
    const top = this.fields[this.fields.length - 1];
    if (top?.ref && top.phase === 'result') top.text += text;
    if (this.swallowing()) return;
    let props = r;
    if (r.font && /^symbol$/i.test(r.font)) {
      // text in the Symbol font: the Greek letters and signs it shows
      const plain = text.replace(/[\uF000-\uF0FF]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xf000));
      text = rt.fromSymbolFont(plain);
      props = { ...r, font: ctx.base.font };
    }
    this.piece(ctx).runs.push({ ...this.runStyle(props), text });
  }

  private emitObject(ctx: Ctx, o: DocObject, r: RProps): number | null {
    if (ctx.cell) { if (o.kind !== 'seq' && o.kind !== 'ref') this.warn('cellObjects'); return null; }
    const id = this.nextId++;
    this.objects[id] = o;
    const { formula: _f, sub: _s, sup: _u, ...style } = this.runStyle(r);
    this.piece(ctx).runs.push({ ...style, obj: id, text: OBJECT_CHAR });
    return id;
  }

  private pageBreak(ctx: Ctx): void {
    if (ctx.cell) return;
    const pc = this.piece(ctx);
    if (!pc.runs.length && !pc.soft) pc.pageBreak = true;
    else ctx.pieces.push({ runs: [], pageBreak: true, soft: false });
  }

  private lineBreak(ctx: Ctx): void {
    if (ctx.cell) { this.piece(ctx).runs.push({ ...this.runStyle(ctx.base), text: '\n' }); return; }
    ctx.pieces.push({ runs: [], pageBreak: false, soft: true });
  }

  /** What sits in a paragraph: runs and the things round them. */
  private inline(els: Element[], ctx: Ctx): void {
    for (const el of els) {
      switch (el.localName) {
        case 'r': this.run(el, ctx); break;
        case 'hyperlink': this.warn('links'); this.inline(kids(el), ctx); break;
        case 'fldSimple': this.simpleField(el, ctx); break;
        case 'smartTag': case 'customXml': case 'dir': case 'bdo': this.inline(kids(el), ctx); break;
        case 'sdt': this.inline(kids(kid(el, 'sdtContent')), ctx); break;
        case 'ins': case 'moveTo': this.warn('tracked'); this.inline(kids(el), ctx); break;
        case 'del': case 'moveFrom': this.warn('tracked'); break;
        case 'bookmarkStart': this.markStart(el); break;
        case 'bookmarkEnd': this.markEnd(el); break;
        case 'commentRangeStart': this.warn('comments'); break;
        case 'oMath': case 'oMathPara': this.math(el, ctx); break;
        case 'AlternateContent': this.inline(kids(this.alternate(el)), ctx); break;
      }
    }
  }

  private math(el: Element, ctx: Ctx): void {
    this.warn('equations');
    const t = Array.from(el.getElementsByTagNameNS('*', 't')).map((x) => x.textContent ?? '').join('');
    this.emitText(ctx, t, ctx.base);
  }

  private run(el: Element, ctx: Ctx): void {
    const r = merge<RProps>(ctx.base, this.readRPr(kid(el, 'rPr')));
    for (const c of kids(el)) {
      switch (c.localName) {
        case 't': this.emitText(ctx, c.textContent ?? '', r); break;
        case 'tab': case 'ptab': this.emitText(ctx, '\t', r); break;
        case 'noBreakHyphen': this.emitText(ctx, '‑', r); break;
        case 'br': {
          if (this.swallowing()) break;
          const type = this.a(c, 'type');
          if (type === 'page') this.pageBreak(ctx);
          else if (type !== 'column') this.lineBreak(ctx);
          break;
        }
        case 'cr': if (!this.swallowing()) this.lineBreak(ctx); break;
        case 'sym': {
          const code = parseInt(this.a(c, 'char') ?? '', 16);
          if (!Number.isFinite(code)) break;
          const font = this.a(c, 'font') ?? '';
          const ch = String.fromCharCode(code >= 0xf000 ? code - 0xf000 : code);
          this.emitText(ctx, /^symbol$/i.test(font) ? rt.fromSymbolFont(ch) : ch, { ...r, font: ctx.base.font });
          break;
        }
        case 'fldChar': this.fieldChar(c, r, ctx); break;
        case 'instrText': { const top = this.fields[this.fields.length - 1]; if (top?.phase === 'instr') top.instr += c.textContent ?? ''; break; }
        case 'drawing': if (!this.swallowing()) this.drawing(c, r, ctx); break;
        case 'pict': if (!this.swallowing()) this.vml(c, r, ctx, null); break;
        case 'object': if (!this.swallowing()) this.vml(c, r, ctx, c); break;
        case 'footnoteReference': case 'endnoteReference': this.warn('notes'); break;
        case 'commentReference': this.warn('comments'); break;
        case 'AlternateContent': {
          const alt = this.alternate(c);
          // a run's choice holds run content (a picture, a shape)
          const wrap = c.ownerDocument.createElementNS(this.W, 'w:r');
          for (const k of kids(alt)) wrap.appendChild(k.cloneNode(true));
          const rPr = kid(el, 'rPr');
          if (rPr) wrap.insertBefore(rPr.cloneNode(true), wrap.firstChild);
          this.run(wrap, ctx);
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------- fields and bookmarks

  private fieldChar(c: Element, r: RProps, ctx: Ctx): void {
    const type = this.a(c, 'fldCharType');
    if (type === 'begin') this.fields.push({ instr: '', phase: 'instr', swallow: false, text: '', props: r, done: false });
    else if (type === 'separate') {
      const f = this.fields[this.fields.length - 1];
      if (!f) return;
      f.phase = 'result';
      this.startField(f, ctx);
    } else if (type === 'end') {
      const f = this.fields.pop();
      if (!f) return;
      if (f.phase === 'instr') { f.phase = 'result'; this.startField(f, ctx); }
      if (f.ref) f.ref.text = f.text;
    }
  }

  private simpleField(el: Element, ctx: Ctx): void {
    const firstRun = kid(el, 'r');
    const props = merge<RProps>(ctx.base, this.readRPr(kid(firstRun, 'rPr')));
    const f: Field = { instr: this.a(el, 'instr') ?? '', phase: 'result', swallow: false, text: '', props, done: false };
    this.fields.push(f);
    this.startField(f, ctx);
    this.inline(kids(el), ctx);
    this.fields.pop();
    if (f.ref) f.ref.text = f.text;
  }

  /** A field's instruction is known: caption numbers and references become ours; other fields keep the text Word showed. */
  private startField(f: Field, ctx: Ctx): void {
    if (f.done) return;
    f.done = true;
    if (this.swallowing(true)) return;
    const ins = f.instr.trim();
    const seq = /^SEQ\s+(?:"([^"]+)"|(\S+))(.*)$/i.exec(ins);
    if (seq && !/\\h\b/i.test(seq[3])) {
      if (/\\[rs]\s*\d/i.test(seq[3])) this.warn('restart');
      if (ctx.cell) return;
      const id = this.emitObject(ctx, { kind: 'seq', name: seq[1] ?? seq[2] }, f.props);
      if (id === null) return;
      for (const name of this.openMarks.values()) if (!this.markSeq.has(name)) this.markSeq.set(name, id);
      f.swallow = true;
      return;
    }
    const ref = /^REF\s+(\S+)/i.exec(ins);
    if (ref && !ctx.cell) {
      const id = this.emitObject(ctx, { kind: 'ref', target: -1 }, f.props);
      if (id === null) return;
      f.ref = { id, mark: ref[1], text: '' };
      this.refs.push(f.ref);
      f.swallow = true;
      return;
    }
    if (/^TOC\b/i.test(ins)) this.warn('toc');
    else if (/^ADDIN\s+(EN\.CITE|ZOTERO|CSL|Mendeley|RW)/i.test(ins)) this.warn('citations');
  }

  private markStart(el: Element): void {
    const name = this.a(el, 'name');
    if (name && name !== '_GoBack') this.openMarks.set(this.a(el, 'id') ?? name, name);
  }

  private markEnd(el: Element): void {
    this.openMarks.delete(this.a(el, 'id') ?? '');
  }

  /** References point to the caption number inside their bookmark; one pointing elsewhere keeps the text Word showed. */
  private resolveRefs(): void {
    const plain = new Map<number, string>();
    for (const ref of this.refs) {
      const target = this.markSeq.get(ref.mark);
      if (target !== undefined) this.objects[ref.id] = { kind: 'ref', target };
      else { plain.set(ref.id, ref.text); delete this.objects[ref.id]; }
    }
    if (!plain.size) return;
    for (const p of this.out) {
      p.runs = p.runs.map((r) => {
        if (r.obj === undefined || !plain.has(r.obj)) return r;
        const { obj: _o, ...style } = r;
        return { ...style, text: plain.get(r.obj) ?? '' };
      });
    }
  }

  // ---------------------------------------------------------------- pictures and structures

  private drawing(el: Element, r: RProps, ctx: Ctx): void {
    const box = kid(el, 'inline') ?? kid(el, 'anchor');
    if (!box) return;
    if (box.localName === 'anchor') this.warn('floating');
    const ext = kid(box, 'extent');
    const shown = { w: fromEmu(ext?.getAttribute('cx')), h: fromEmu(ext?.getAttribute('cy')) };
    const name = kid(box, 'docPr')?.getAttribute('name') ?? '';
    const data = kid(box, 'graphic', 'graphicData');
    const pic = kid(data, 'pic');
    if (!pic) { this.warn('shapes'); return; }
    // one of our structures: its drawing from our part
    const ours = new RegExp(`^${DRAWING_NAME} (\\d+)$`).exec(name);
    const m = ours ? this.model?.drawings?.[Number(ours[1])] : undefined;
    if (m?.contents) {
      const natural = shownSize({ w: m.w, h: m.h }, 1, this.textW);
      const scale = Math.abs(natural.w - shown.w) < 0.75 || m.w <= 0 ? undefined : round(shown.w / m.w, 1e4);
      this.emitObject(ctx, { kind: 'drawing', contents: structuredClone(m.contents), scale }, r);
      return;
    }
    const blip = kid(pic, 'blipFill', 'blip');
    if (kid(kid(pic, 'blipFill'), 'srcRect')?.attributes.length) this.warn('crop');
    const svg = blip ? Array.from(blip.getElementsByTagNameNS('*', 'svgBlip'))[0] : undefined;
    const target = this.relTarget(rAttr(svg, 'embed')) ?? this.relTarget(rAttr(blip, 'embed'));
    this.picture(target, shown, r, ctx);
  }

  private relTarget(id: string | null): string | null {
    if (!id) return null;
    const rel = this.pkg.rels(this.main).get(id);
    return rel && !rel.external ? rel.target : null;
  }

  private picture(path: string | null, shown: { w: number; h: number }, r: RProps, ctx: Ctx): void {
    const bytes = path ? this.pkg.bytes(path) : null;
    if (!bytes || shown.w <= 0 || shown.h <= 0) return;
    const ext = (path ?? '').split('.').pop()?.toLowerCase() ?? '';
    const mime = EXT_MIME[ext] ?? pictureMime(path ?? '', bytes);
    if (!mime) return;
    if (mime === 'image/x-wmf') this.warn('wmf');
    const px = imageSize(bytes, mime) ?? undefined;
    this.emitObject(ctx, { kind: 'picture', src: dataUrl(bytes, mime), w: round(shown.w), h: round(shown.h), px }, r);
  }

  /** Older (VML) pictures, and embedded objects with their picture: ChemDraw's become structures. */
  private vml(el: Element, r: RProps, ctx: Ctx, object: Element | null): void {
    const shape = Array.from(el.getElementsByTagNameNS('*', 'shape'))[0];
    const img = shape ? Array.from(shape.getElementsByTagNameNS('*', 'imagedata'))[0] : undefined;
    const shown = vmlSize(shape?.getAttribute('style') ?? '');
    if (object) {
      const ole = Array.from(object.getElementsByTagNameNS('*', 'OLEObject'))[0];
      const prog = ole?.getAttribute('ProgID') ?? '';
      if (/^ChemDraw/i.test(prog) && this.chemdraw(ole, shown, r, ctx)) return;
      if (ole && !/^ChemDraw/i.test(prog)) this.warn('ole');
    }
    if (!img) {
      if (shape || Array.from(el.getElementsByTagNameNS('*', 'textbox')).length) this.warn('shapes');
      return;
    }
    this.picture(this.relTarget(rAttr(img, 'id')), shown, r, ctx);
  }

  private chemdraw(ole: Element, shown: { w: number; h: number }, r: RProps, ctx: Ctx): boolean {
    if (!this.deps.chemdraw) return false;
    const path = this.relTarget(rAttr(ole, 'id'));
    const bin = path ? this.pkg.bytes(path) : null;
    if (!bin) return false;
    let cdx: Uint8Array | null = null;
    try {
      if (isCdx(bin)) cdx = bin;
      else if (isCfb(bin)) {
        const streams = cfbStreams(bin);
        cdx = [...streams.values()].find(isCdx) ?? streams.get('CONTENTS') ?? null;
      }
    } catch {
      return false;
    }
    if (!cdx) return false;
    let contents: Contents | null = null;
    try {
      contents = this.deps.chemdraw(cdx, this.drawingStyle);
    } catch {
      contents = null;
    }
    if (!contents) return false;
    const own = this.deps.drawingSize?.(contents, this.drawingStyle);
    let scale: number | undefined;
    if (own && own.w > 0 && shown.w > 0) {
      const natural = shownSize(own, 1, this.textW);
      if (Math.abs(natural.w - shown.w) > 0.01 * shown.w) scale = round(shown.w / own.w, 1e4);
    }
    return this.emitObject(ctx, { kind: 'drawing', contents, scale }, r) !== null || ctx.cell;
  }

  // ---------------------------------------------------------------- tables

  private table(tbl: Element): void {
    this.pendingNotes = null;
    const tblPr = kid(tbl, 'tblPr');
    const rows = kids(tbl, 'tr');
    let cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => this.tw(g, 'w') ?? 0);
    // the cells, each with how many grid columns it spans
    type Cell = { cell: TableCell; span: number; vmerge: boolean; borders: Element | null };
    const grid: Cell[][] = [];
    let head = 0, counting = true;
    for (const tr of rows) {
      const trPr = kid(tr, 'trPr');
      if (counting && kid(trPr, 'tblHeader') && this.on(kid(trPr, 'tblHeader'))) head++;
      else counting = false;
      const row: Cell[] = [];
      const before = Number(this.a(kid(trPr, 'gridBefore')) ?? 0);
      for (let i = 0; i < before; i++) row.push({ cell: { runs: [] }, span: 1, vmerge: false, borders: null });
      for (const tc of this.cellsOf(tr)) {
        const tcPr = kid(tc, 'tcPr');
        const span = Math.max(1, Number(this.a(kid(tcPr, 'gridSpan')) ?? 1));
        const vm = kid(tcPr, 'vMerge');
        const vmerge = !!vm && this.a(vm) !== 'restart';
        if (vmerge) this.warn('vmerge');
        row.push({ cell: vmerge ? { runs: [] } : this.cellText(tc), span, vmerge, borders: kid(tcPr, 'tcBorders') });
      }
      grid.push(row);
    }
    const width = Math.max(1, ...grid.map((row) => row.reduce((n, c) => n + c.span, 0)));
    if (cols.length < width) {
      // no grid given: the first row's cell widths
      const first = rows[0] ? this.cellsOf(rows[0]).map((tc) => this.tw(kid(kid(tc, 'tcPr'), 'tcW'), 'w') ?? 72) : [];
      cols = Array.from({ length: width }, (_, i) => cols[i] ?? first[i] ?? 72);
    }
    cols = cols.map((w) => round(Math.max(6, w)));
    const table: TableData = { cols, rows: [], head: 0, lines: 'none' };
    for (const row of grid) {
      const out: TableCell[] = [];
      for (const c of row) {
        if (out.length >= cols.length) break;
        out.push(c.span > 1 ? { ...c.cell, span: Math.min(c.span, cols.length - out.length) } : c.cell);
        for (let k = 1; k < c.span && out.length < cols.length; k++) out.push({ runs: [] });
      }
      while (out.length < cols.length) out.push({ runs: [] });
      table.rows.push(out);
    }
    // lines: the table's borders (its style's, then its own), and the cells'
    const style = this.a(kid(tblPr, 'tblStyle'));
    const styleBorders = style ? this.styleTableBorders(style) : new Map<string, boolean>();
    const own = this.borders(kid(tblPr, 'tblBorders'));
    const b = new Map([...styleBorders, ...own]);
    const cellSides = { v: false, h: false };
    let underRow = -1;
    grid.forEach((row, ri) => row.forEach((c) => {
      const cb = this.borders(c.borders);
      if (cb.get('left') || cb.get('right') || cb.get('start') || cb.get('end')) cellSides.v = true;
      if (cb.get('top') || cb.get('bottom')) cellSides.h = true;
      if (cb.get('bottom') && ri < grid.length - 1 && underRow < 0) underRow = ri;
    }));
    table.lines = b.get('insideV') || cellSides.v ? 'grid' : b.get('top') || b.get('bottom') || b.get('insideH') || cellSides.h ? 'acs' : 'none';
    table.head = head || (underRow >= 0 && underRow < 3 ? underRow + 1 : grid.length > 1 ? 1 : 0);
    // text size: the size most of the text has
    const sizes = new Map<number, number>();
    for (const row of table.rows) for (const c of row) for (const r of c.runs) sizes.set(r.size ?? WORD_SIZE, (sizes.get(r.size ?? WORD_SIZE) ?? 0) + r.text.length);
    const size = [...sizes.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? this.drawingStyle.captionSize;
    table.size = size;
    const font = this.drawingStyle.captionFont;
    for (const row of table.rows) {
      for (const c of row) {
        c.runs = c.runs.map((r) => {
          const out = { ...r };
          if (out.size === size) delete out.size;
          if (font && out.font === font) delete out.font;
          return out;
        });
      }
    }
    // each column lines up the way most of its cells do
    table.align = cols.map((_, ci) => {
      const count = new Map<Justify, number>();
      for (const row of table.rows) { const a = row[ci]?.align; if (a && row[ci].runs.length) count.set(a, (count.get(a) ?? 0) + 1); }
      return [...count.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'left';
    });
    table.rows.forEach((row) => row.forEach((c, ci) => { if (c.align === table.align![ci]) delete c.align; }));

    // our own table: as it was made here, while its text is the same
    const cap = new RegExp(`^${TABLE_NAME} (\\d+)$`).exec(this.a(kid(tblPr, 'tblCaption')) ?? '');
    const mine = cap ? this.model?.tables?.[Number(cap[1])] : undefined;
    let final = table;
    if (mine?.table && mine.text === tableText(table)) {
      final = structuredClone(mine.table);
      // its title was written just before it as a paragraph, and its notes just after
      const title = final.title?.length ? rt.plainText(final.title) : null;
      const prev = this.out[this.out.length - 1];
      if (title !== null && prev && !prev.table && rt.plainText(prev.runs) === title) this.out.pop();
      this.pendingNotes = final.notes?.length ? rt.plainText(final.notes) : null;
    }
    const jc = JUSTIFY[this.a(kid(tblPr, 'jc')) ?? 'left'] ?? 'left';
    const contents = this.deps.tableDrawing?.(final, this.drawingStyle) ?? this.tableDrawing(final);
    const normal = merge<RProps>(this.docDefaults.r, this.chain('paragraph', this.defaultPara).r);
    const ctx: Ctx = { base: normal, pieces: [{ runs: [], pageBreak: false, soft: false }], cell: false };
    this.emitObject(ctx, { kind: 'drawing', contents }, normal);
    const np = merge<PProps>(this.docDefaults.p, this.chain('paragraph', this.defaultPara).p);
    this.used.add(this.defaultPara);
    this.out.push({
      ps: cleanPara({ align: jc === 'left' ? undefined : jc, spaceBefore: np.before, spaceAfter: np.after, pageBreak: this.takeBreak() }),
      runs: ctx.pieces[0].runs, mark: this.runStyle(normal), style: 'Normal', contextual: false, table: true,
    });
  }

  private tableDrawing(t: TableData): Contents {
    const lay = layoutTable(t, this.drawingStyle.captionSize, this.measure);
    return { atoms: [], bonds: [], captions: [], arrows: [], shapes: [{ id: 1, kind: 'table', x1: 0, y1: 0, x2: lay.width, y2: lay.height, table: t }] };
  }

  /** A row's cells (some sit inside content controls). */
  private cellsOf(tr: Element): Element[] {
    const out: Element[] = [];
    for (const c of kids(tr)) {
      if (c.localName === 'tc') out.push(c);
      else if (c.localName === 'sdt') out.push(...kids(kid(c, 'sdtContent'), 'tc'));
      else if (c.localName === 'customXml') out.push(...kids(c, 'tc'));
    }
    return out;
  }

  /** A cell's text: its paragraphs one after another (text only). */
  private cellText(tc: Element): TableCell {
    const runs: TextRun[] = [];
    const paras: ParaStyle[] = [];
    let align: Justify | undefined;
    const walk = (els: Element[]) => {
      for (const el of els) {
        if (el.localName === 'p') {
          const { p, base } = this.paraProps(kid(el, 'pPr'));
          const ctx: Ctx = { base, pieces: [{ runs: [], pageBreak: false, soft: false }], cell: true };
          this.inline(kids(el), ctx);
          if (paras.length) runs.push({ ...this.runStyle(base), text: '\n' });
          runs.push(...ctx.pieces[0].runs);
          const a = p.align ?? 'left';
          if (!paras.length) align = a;
          paras.push(cleanPara({ align: a === align ? undefined : a }));
        } else if (el.localName === 'tbl') {
          this.warn('nested');
          for (const tr of kids(el, 'tr')) walk(this.cellsOf(tr).flatMap((c) => kids(c)));
        } else if (el.localName === 'sdt') walk(kids(kid(el, 'sdtContent')));
      }
    };
    walk(kids(tc));
    const norm = rt.normalizeRuns(runs);
    const cell: TableCell = { runs: norm };
    if (paras.some((p) => p.align)) cell.paras = paras;
    if (align) cell.align = align;
    return cell;
  }

  /** Which sides of a table or cell have a line. */
  private borders(el: Element | null): Map<string, boolean> {
    const out = new Map<string, boolean>();
    for (const c of kids(el)) {
      const v = this.a(c) ?? 'nil';
      out.set(c.localName, !/^(nil|none)$/i.test(v));
    }
    return out;
  }

  private styleTableBorders(id: string): Map<string, boolean> {
    const list: WStyle[] = [];
    const seen = new Set<string>();
    for (let s = this.wstyles.get(`table:${id}`); s && !seen.has(s.id); s = s.basedOn ? this.wstyles.get(`table:${s.basedOn}`) : undefined) {
      seen.add(s.id);
      list.unshift(s);
    }
    const out = new Map<string, boolean>();
    for (const s of list) for (const [k, v] of this.borders(kid(kid(s.el, 'tblPr'), 'tblBorders'))) out.set(k, v);
    return out;
  }

  // ---------------------------------------------------------------- header and footer

  private readHeaderFooter(sect: Element | null): HeaderFooter {
    const hf = defaultHeaderFooter();
    hf.numbers = 'none';
    const start = Number(this.a(kid(sect, 'pgNumType'), 'start'));
    if (Number.isFinite(start) && start > 0) hf.start = Math.round(start);
    const titlePg = kid(sect, 'titlePg') !== null && this.on(kid(sect, 'titlePg'));
    const refOf = (kind: 'header' | 'footer', type: string) => {
      const ref = kids(sect, `${kind}Reference`).find((e) => (this.a(e, 'type') ?? 'default') === type);
      return this.relTarget(rAttr(ref, 'id'));
    };
    let numberedFirst = false;
    for (const kind of ['header', 'footer'] as const) {
      const part = this.hfPart(refOf(kind, 'default'));
      hf[kind] = part.zones;
      if (part.page) {
        hf.numbers = `${kind}-${['left', 'center', 'right'][part.page.zone]}` as NumberPlace;
        hf.prefix = part.page.prefix;
      }
      if (titlePg && this.hfPart(refOf(kind, 'first')).page) numberedFirst = true;
    }
    if (titlePg && hf.numbers !== 'none' && !numberedFirst) hf.onFirst = false;
    return hf;
  }

  /** A header or footer: its text at the left, centre and right, and where its page number is. */
  private hfPart(path: string | null): { zones: [string, string, string]; page: { zone: number; prefix: string } | null } {
    const zones: [string, string, string] = ['', '', ''];
    const root = path ? this.pkg.xml(path)?.documentElement : null;
    if (!root) return { zones, page: null };
    let page: { zone: number; prefix: string } | null = null;
    let after = '';
    for (const p of Array.from(root.getElementsByTagNameNS(this.W, 'p'))) {
      const { p: props } = this.paraProps(kid(p, 'pPr'));
      let zone = props.align === 'center' ? 1 : props.align === 'right' ? 2 : 0;
      const texts: [string, string, string] = ['', '', ''];
      const fields: { instr: string; result: boolean }[] = [];
      const add = (s: string) => {
        if (fields.some((f) => !f.result || /^PAGE\b/i.test(f.instr.trim()))) return;
        if (page && page.zone === zone) after += s;
        else texts[zone] += s;
      };
      const pageHere = () => {
        if (page) return;
        const m = /(\S*)$/.exec(texts[zone]);
        page = { zone, prefix: m ? m[1] : '' };
        texts[zone] = texts[zone].slice(0, texts[zone].length - page.prefix.length);
      };
      const visit = (el: Element) => {
        for (const c of kids(el)) {
          switch (c.localName) {
            case 'pPr': case 'rPr': break;
            case 't': add(c.textContent ?? ''); break;
            case 'tab': zone = Math.min(2, zone + 1); break;
            case 'ptab': { const al = c.getAttributeNS(this.W, 'alignment') ?? c.getAttribute('w:alignment'); zone = al === 'center' ? 1 : al === 'right' ? 2 : 0; break; }
            case 'fldSimple': {
              const instr = this.a(c, 'instr') ?? '';
              if (/^\s*PAGE\b/i.test(instr)) pageHere();
              else visit(c);
              break;
            }
            case 'fldChar': {
              const t = this.a(c, 'fldCharType');
              if (t === 'begin') fields.push({ instr: '', result: false });
              else if (t === 'separate' && fields.length) {
                const f = fields[fields.length - 1];
                f.result = true;
                if (/^PAGE\b/i.test(f.instr.trim())) pageHere();
              } else if (t === 'end') {
                const f = fields.pop();
                if (f && !f.result && /^PAGE\b/i.test(f.instr.trim())) pageHere();
              }
              break;
            }
            case 'instrText': { const f = fields[fields.length - 1]; if (f && !f.result) f.instr += c.textContent ?? ''; break; }
            case 'drawing': case 'pict': case 'object': this.warn('hfPictures'); break;
            default: visit(c);
          }
        }
      };
      visit(p);
      texts.forEach((t, i) => { const s = t.trim(); if (s) zones[i] = zones[i] ? `${zones[i]} ${s}` : s; });
    }
    if (root.getElementsByTagNameNS(this.W, 'tbl').length) this.warn('hfPictures');
    if (after.trim()) this.warn('pageText');
    return { zones, page };
  }

  // ---------------------------------------------------------------- the document

  private named(wordId: string, ours: string): NamedStyle {
    const ws = this.wstyles.get(`paragraph:${wordId}`);
    const ch = this.chain('paragraph', wordId);
    const p = merge<PProps>(this.docDefaults.p, ch.p);
    const r = merge<RProps>(this.docDefaults.r, ch.r);
    const size = r.size ?? WORD_SIZE;
    const dflt = defaultStyles()[ours];
    const next = ws?.next ? this.idMap.get(ws.next) : undefined;
    return {
      id: ours,
      name: dflt?.name ?? ws?.name ?? ours,
      font: r.font ?? WORD_FONT, size, bold: !!r.bold, italic: !!r.italic, color: r.color ?? undefined,
      align: p.align ?? 'left', spaceBefore: round(p.before ?? 0), spaceAfter: round(p.after ?? 0), line: this.lineOf(p, size) ?? 1,
      indent: round(Math.max(0, p.left ?? 0)), firstLine: round(p.first ?? 0), keepNext: !!p.keepNext,
      next: next && next !== ours ? next : ours === 'Normal' ? undefined : dflt?.next,
      outline: OUTLINE[ours] ?? (p.outline && p.outline <= 3 && ours !== 'Normal' ? p.outline : undefined),
    };
  }

  private assemble(hf: HeaderFooter): DocText {
    // the empty paragraphs Word needs between tables and after a table at the end
    const out = this.out.filter((p, i, all) => {
      if (p.runs.length || p.table) return true;
      const prev = all[i - 1], next = all[i + 1];
      return !(prev?.table && (!next || next.table));
    });
    // Word's "don't add space between paragraphs of the same style"
    for (let i = 0; i + 1 < out.length; i++) {
      const a = out[i], b = out[i + 1];
      if (a.style !== b.style) continue;
      if (a.contextual) a.ps = cleanPara({ ...a.ps, spaceAfter: 0 });
      if (b.contextual) b.ps = cleanPara({ ...b.ps, spaceBefore: 0 });
    }
    // the standard styles (the file's, or ours where it has none) and the others the text uses
    const styles = defaultStyles();
    for (const [wordId, ours] of this.idMap) if (BUILT_IN_IDS[ours] || this.used.has(wordId)) styles[ours] = this.named(wordId, ours);
    if (!out.length) out.push({ ps: {}, runs: [], mark: this.runStyle(merge<RProps>(this.docDefaults.r, this.chain('paragraph', this.defaultPara).r)), style: 'Normal', contextual: false });
    const runs: TextRun[] = [];
    out.forEach((p, i) => {
      if (i > 0) runs.push({ ...out[i - 1].mark, text: '\n' });
      runs.push(...p.runs);
    });
    const used = new Set(runs.filter((r) => r.obj !== undefined).map((r) => r.obj!));
    const objects: Record<number, DocObject> = {};
    for (const [k, v] of Object.entries(this.objects)) if (used.has(Number(k))) objects[Number(k)] = v;
    return {
      runs: rt.normalizeRuns(runs),
      paras: out.map((p) => cleanPara(p.ps)),
      justify: 'left',
      styles,
      page: this.page,
      hf,
      objects,
      drawingStyle: this.drawingStyle,
    };
  }
}

const BUILT_IN_IDS: Record<string, true> = { Normal: true, Title: true, Heading1: true, Heading2: true, Heading3: true, Caption: true };

/** A VML shape's size from its style ("width:120pt;height:36.5pt"), in points. */
function vmlSize(style: string): { w: number; h: number } {
  const get = (k: string): number => {
    const m = new RegExp(`(?:^|;)\\s*${k}\\s*:\\s*([\\d.]+)\\s*(pt|in|cm|mm|px|pc)?`, 'i').exec(style);
    if (!m) return 0;
    const v = parseFloat(m[1]);
    const unit = (m[2] ?? 'px').toLowerCase();
    return v * ({ pt: 1, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, px: 0.75, pc: 12 } as Record<string, number>)[unit];
  };
  return { w: get('width'), h: get('height') };
}
