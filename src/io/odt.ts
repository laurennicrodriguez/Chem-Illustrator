// OpenDocument text (.odt: LibreOffice Writer, Google Docs' and Word's exports), opened and saved
// in Document mode as the OpenDocument 1.3 standard (OASIS) lays it out: content.xml's text,
// with its paragraph and text styles (fonts, sizes, bold and italic, underline, strikethrough,
// sub- and superscripts, colours; alignment, indents, spacing, page breaks), headings, lists,
// tables, pictures, footnotes and endnotes, links, and the page's size and margins from
// styles.xml. What ODT can't hold of ours (live fields, citations) is saved as the text it shows.

import { unzipSync, strFromU8, strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import * as rt from '../richtext';
import type { Contents, Justify, ParaStyle, TableCell, TableData, TextRun } from '../model';
import type { DocStyle } from '../style';
import { fieldTexts, styleOf, type DocObject, type DocText } from '../document/document';
import { fitParas, paraCount, splitParagraphs } from '../text/paragraphs';
import { kid, kids } from './ooxml';
import { DocBuilder, headingId, styleIdOf } from './doc-build';

const NS = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
  svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  meta: 'urn:oasis:names:tc:opendocument:xmlns:meta:1.0',
  manifest: 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0',
};
const MIME = 'application/vnd.oasis.opendocument.text';

/** Is this an OpenDocument text? (Its first file, `mimetype`, says so, uncompressed.) */
export function isOdt(bytes: Uint8Array): boolean {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  const head = String.fromCharCode(...bytes.subarray(30, 120));
  return head.startsWith(`mimetype${MIME}`) && !head.startsWith(`mimetype${MIME}-`);
}

/** A length ("2.5cm", "0.5in", "12pt", "10mm") in points. */
export function points(v: string | null | undefined): number | null {
  const m = /^(-?[\d.]+)(cm|mm|in|pt|pc|px)$/.exec((v ?? '').trim());
  if (!m) return null;
  const per = { cm: 72 / 2.54, mm: 72 / 25.4, in: 72, pt: 1, pc: 12, px: 0.75 }[m[2] as 'cm']!;
  return Math.round(Number(m[1]) * per * 100) / 100;
}

// ---------------------------------------------------------------- reading

interface TextProps { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; sub?: boolean; sup?: boolean; size?: number; font?: string; color?: string; highlight?: string; smallCaps?: boolean; allCaps?: boolean }
interface ParaProps { align?: Justify; spaceBefore?: number; spaceAfter?: number; indent?: number; firstLine?: number; indentRight?: number; line?: number; linePt?: number; lineRule?: 'exact' | 'atLeast'; pageBreak?: boolean; keepNext?: boolean }
interface OdStyle { family: string; parent?: string; display?: string; text: TextProps; para: ParaProps; listStyle?: string }

const attr = (el: Element | null | undefined, ns: keyof typeof NS, name: string): string | null => el?.getAttributeNS(NS[ns], name) ?? null;

function textProps(el: Element | null, fonts: Map<string, string>): TextProps {
  if (!el) return {};
  const fo = (n: string) => attr(el, 'fo', n), st = (n: string) => attr(el, 'style', n);
  const out: TextProps = {};
  const w = fo('font-weight');
  if (w) out.bold = w === 'bold' || Number(w) >= 600;
  const s = fo('font-style');
  if (s) out.italic = s === 'italic' || s === 'oblique';
  const u = st('text-underline-style');
  if (u) out.underline = u !== 'none';
  const lt = st('text-line-through-style');
  if (lt) out.strike = lt !== 'none';
  const pos = st('text-position');
  if (pos) {
    const first = pos.split(/\s+/)[0];
    out.sup = first === 'super' || (parseFloat(first) > 0);
    out.sub = first === 'sub' || (parseFloat(first) < 0);
  }
  const size = points(fo('font-size'));
  if (size) out.size = size;
  const name = st('font-name');
  const fam = (name && fonts.get(name)) ?? name ?? fo('font-family');
  if (fam) out.font = fam.replace(/^['"]|['"]$/g, '');
  const c = fo('color');
  if (c && /^#[0-9a-f]{6}$/i.test(c)) out.color = c.toLowerCase();
  const bg = fo('background-color');
  if (bg && /^#[0-9a-f]{6}$/i.test(bg)) out.highlight = bg.toLowerCase();
  const v = fo('font-variant');
  if (v) out.smallCaps = v === 'small-caps';
  const tt = fo('text-transform');
  if (tt) out.allCaps = tt === 'uppercase';
  return out;
}

function paraProps(el: Element | null): ParaProps {
  if (!el) return {};
  const fo = (n: string) => attr(el, 'fo', n);
  const out: ParaProps = {};
  const a = fo('text-align');
  if (a) out.align = a === 'center' ? 'center' : a === 'end' || a === 'right' ? 'right' : a === 'justify' ? 'justify' : 'left';
  const mt = points(fo('margin-top')), mb = points(fo('margin-bottom')), ml = points(fo('margin-left')), mr = points(fo('margin-right')), ti = points(fo('text-indent'));
  if (mt !== null) out.spaceBefore = mt;
  if (mb !== null) out.spaceAfter = mb;
  if (ml !== null) out.indent = ml;
  if (mr !== null) out.indentRight = mr;
  if (ti !== null) out.firstLine = ti;
  const lh = fo('line-height');
  // (100% is single spacing, as Word's single)
  if (lh?.endsWith('%')) out.line = Math.round(parseFloat(lh)) / 100;
  else if (points(lh)) { out.linePt = points(lh)!; out.lineRule = 'exact'; }
  const al = points(attr(el, 'style', 'line-height-at-least'));
  if (al) { out.linePt = al; out.lineRule = 'atLeast'; }
  if (fo('break-before') === 'page') out.pageBreak = true;
  if (fo('keep-with-next') === 'always') out.keepNext = true;
  return out;
}

class OdtReader {
  private b = new DocBuilder();
  private styles = new Map<string, OdStyle>();
  private fonts = new Map<string, string>();
  /** List styles: whether each is numbered (by its first level). */
  private listKinds = new Map<string, 'bullet' | 'number'>();
  private warnings = new Set<string>();
  private page: Partial<DocText['page']> = {};

  constructor(private files: Record<string, Uint8Array>) {}

  read(): { doc: DocText; warnings: string[] } {
    const parse = (name: string) => (this.files[name] ? new DOMParser().parseFromString(strFromU8(this.files[name]), 'application/xml') : null);
    const content = parse('content.xml');
    const body = content?.getElementsByTagNameNS(NS.office, 'text')[0];
    if (!content || !body) throw new Error('This is not an OpenDocument text document.');
    const stylesDoc = parse('styles.xml');
    for (const d of [stylesDoc, content]) if (d) this.readStyles(d);
    if (stylesDoc) this.readPage(stylesDoc);
    this.blocks(kids(body), { list: null });
    const page = { ...this.b.doc.page, ...this.page };
    return { doc: this.b.finish({ page }), warnings: [...this.warnings] };
  }

  private readStyles(d: Document): void {
    for (const f of Array.from(d.getElementsByTagNameNS(NS.style, 'font-face'))) {
      const n = attr(f, 'style', 'name'), fam = attr(f, 'svg', 'font-family');
      if (n && fam) this.fonts.set(n, fam.replace(/^['"]|['"]$/g, ''));
    }
    for (const s of Array.from(d.getElementsByTagNameNS(NS.style, 'style'))) {
      const name = attr(s, 'style', 'name');
      if (!name) continue;
      this.styles.set(name, {
        family: attr(s, 'style', 'family') ?? 'paragraph', parent: attr(s, 'style', 'parent-style-name') ?? undefined, display: attr(s, 'style', 'display-name') ?? undefined,
        text: textProps(kid(s, 'text-properties'), this.fonts), para: paraProps(kid(s, 'paragraph-properties')), listStyle: attr(s, 'style', 'list-style-name') ?? undefined,
      });
    }
    for (const l of Array.from(d.getElementsByTagNameNS(NS.text, 'list-style'))) {
      const name = attr(l, 'style', 'name');
      const first = kids(l).find((k) => /^list-level-style-/.test(k.localName));
      if (name && first) this.listKinds.set(name, first.localName === 'list-level-style-number' ? 'number' : 'bullet');
    }
  }

  private readPage(d: Document): void {
    const pl = d.getElementsByTagNameNS(NS.style, 'page-layout-properties')[0];
    if (!pl) return;
    const fo = (n: string) => points(attr(pl, 'fo', n));
    const w = fo('page-width'), h = fo('page-height');
    if (w) this.page.w = w;
    if (h) this.page.h = h;
    const ml = fo('margin-left'), mr = fo('margin-right'), mt = fo('margin-top'), mb = fo('margin-bottom');
    if (ml !== null) this.page.left = ml;
    if (mr !== null) this.page.right = mr;
    if (mt !== null) this.page.top = mt;
    if (mb !== null) this.page.bottom = mb;
  }

  /** A style's look with what it inherits (its parents', nearest last). */
  private resolved(name: string | null | undefined): { text: TextProps; para: ParaProps; heading?: string; list?: string } {
    const chain: OdStyle[] = [];
    let cur = name ? this.styles.get(name) : undefined;
    for (let n = 0; cur && n < 20; n++) { chain.unshift(cur); cur = cur.parent ? this.styles.get(cur.parent) : undefined; }
    const out = { text: {} as TextProps, para: {} as ParaProps, heading: undefined as string | undefined, list: undefined as string | undefined };
    for (const s of chain) {
      Object.assign(out.text, s.text);
      Object.assign(out.para, s.para);
      out.heading = styleIdOf(s.display) ?? styleIdOf(nameOf(s, this.styles)) ?? out.heading;
      if (s.listStyle) out.list = s.listStyle;
    }
    return out;
  }

  private blocks(els: Element[], ctx: { list: { kind: 'bullet' | 'number'; level: number } | null }, into?: { runs: TextRun[]; paras: ParaStyle[] }): void {
    for (const el of els) {
      switch (el.localName) {
        case 'p': case 'h': this.paragraph(el, ctx, into); break;
        case 'list': {
          const style = attr(el, 'text', 'style-name');
          const kind: 'bullet' | 'number' = (style ? this.listKinds.get(style) : undefined) ?? ctx.list?.kind ?? 'bullet';
          const level = ctx.list ? ctx.list.level + 1 : 0;
          for (const item of kids(el)) if (item.localName === 'list-item' || item.localName === 'list-header') this.blocks(kids(item), { list: { kind, level } }, into);
          break;
        }
        case 'table': if (!into) this.table(el); else this.warnings.add('Tables inside table cells were left out.'); break;
        case 'section': case 'index-body': case 'table-of-content': case 'alphabetical-index': case 'illustration-index': case 'bibliography': this.blocks(kids(el).filter((k) => k.localName !== 'index-title-template' && !/-source$/.test(k.localName)), ctx, into); break;
        case 'index-title': this.blocks(kids(el), ctx, into); break;
        case 'soft-page-break': case 'sequence-decls': case 'variable-decls': case 'user-field-decls': case 'tracked-changes': case 'forms': break;
        default: break;
      }
    }
  }

  private paragraph(el: Element, ctx: { list: { kind: 'bullet' | 'number'; level: number } | null }, into?: { runs: TextRun[]; paras: ParaStyle[] }): void {
    const look = this.resolved(attr(el, 'text', 'style-name'));
    const level = el.localName === 'h' ? Number(attr(el, 'text', 'outline-level') ?? '1') : 0;
    const style = level ? headingId(level) : look.heading;
    const p = look.para;
    const ps: ParaStyle = {
      ...(style ? { style } : {}), align: p.align === 'left' ? undefined : p.align, spaceBefore: p.spaceBefore, spaceAfter: p.spaceAfter, indent: p.indent || undefined, firstLine: p.firstLine || undefined,
      indentRight: p.indentRight || undefined, line: p.line, linePt: p.linePt, lineRule: p.lineRule, pageBreak: p.pageBreak, keepNext: p.keepNext,
      ...(ctx.list ? { list: ctx.list.kind, ...(ctx.list.level ? { level: ctx.list.level } : {}), indent: undefined, firstLine: undefined } : {}),
    };
    const base = { ...this.b.styleLook(ps), ...cleanText(look.text) };
    const runs: TextRun[] = [];
    this.inline(el, base, runs, undefined, !!into);
    if (into) {
      if (into.runs.length) into.runs.push({ ...base, text: '\n' });
      into.runs.push(...runs);
      const { style: _s, ...cellPs } = ps;
      into.paras.push(cellPs);
      return;
    }
    for (const r of runs) {
      if (r.obj !== undefined) this.b.object(this.pending.get(r.obj)!, rt.styleOf(r));
      else this.b.text(r.text, rt.styleOf(r));
    }
    this.pending.clear();
    this.b.endPara(ps);
  }

  /** Objects met in a paragraph's text (put in when the paragraph is), by a number of their own. */
  private pending = new Map<number, DocObject>();
  private pendingId = 1;

  private holdObject(o: DocObject, into: TextRun[], look: rt.RunStyle, cell: boolean): void {
    if (cell) { into.push({ ...look, obj: this.b.reserve(o), text: '￼' }); return; }
    const id = this.pendingId++;
    this.pending.set(id, o);
    into.push({ ...look, obj: id, text: '￼' });
  }

  private inline(el: Element, look: rt.RunStyle, out: TextRun[], link: string | undefined, cell = false): void {
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        const t = (n.textContent ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ');
        if (t) out.push({ ...look, ...(link ? { link } : {}), text: t });
        continue;
      }
      if (n.nodeType !== 1) continue;
      const c = n as Element;
      switch (c.localName) {
        case 'span': this.inline(c, { ...look, ...cleanText(this.resolved(attr(c, 'text', 'style-name')).text) }, out, link, cell); break;
        case 'a': this.inline(c, look, out, attr(c, 'xlink', 'href') ?? undefined, cell); break;
        case 's': out.push({ ...look, ...(link ? { link } : {}), text: ' '.repeat(Math.max(1, Number(attr(c, 'text', 'c') ?? '1'))) }); break;
        case 'tab': out.push({ ...look, ...(link ? { link } : {}), text: '\t' }); break;
        case 'line-break': out.push({ ...look, ...(link ? { link } : {}), text: ' ' }); break;
        case 'note': {
          const body = kid(c, 'note-body');
          const inner = { runs: [] as TextRun[], paras: [] as ParaStyle[] };
          if (body) this.blocks(kids(body), { list: null }, inner);
          const note: DocObject = { kind: 'note', ...(attr(c, 'text', 'note-class') === 'endnote' ? { end: true } : {}), runs: inner.runs.length ? rt.normalizeRuns(inner.runs) : [{ ...look, text: '' }], paras: inner.paras };
          this.holdObject(note, out, look, cell);
          break;
        }
        case 'frame': {
          const img = kid(c, 'image');
          const href = attr(img, 'xlink', 'href');
          const bytes = href ? this.files[href.replace(/^\.\//, '')] : undefined;
          const w = points(attr(c, 'svg', 'width')), h = points(attr(c, 'svg', 'height'));
          const mime = href ? pictureMime(href, bytes) : null;
          if (!img || !bytes || !w || !h || !mime) { if (img) this.warnings.add('Some pictures could not be read and were left out.'); else if (kid(c, 'text-box')) this.warnings.add('Text boxes were left out.'); break; }
          const alt = kid(c, 'desc')?.textContent?.trim() || kid(c, 'title')?.textContent?.trim();
          this.holdObject({ kind: 'picture', src: `data:${mime};base64,${base64(bytes)}`, w, h, ...(alt ? { alt } : {}) }, out, look, cell);
          break;
        }
        case 'bookmark': case 'bookmark-start': case 'bookmark-end': case 'reference-mark': case 'reference-mark-start': case 'reference-mark-end': case 'soft-page-break': case 'annotation': case 'annotation-end': case 'change-start': case 'change-end': case 'change': break;
        default:
          // fields (page numbers, dates, references) and anything else: the text they show
          this.inline(c, look, out, link, cell);
      }
    }
  }

  private table(el: Element): void {
    const cols: number[] = [];
    const colEls: Element[] = [];
    const collect = (e: Element) => { for (const k of kids(e)) { if (k.localName === 'table-column') colEls.push(k); else if (/^table-(header-)?columns$|^table-column-group$/.test(k.localName)) collect(k); } };
    collect(el);
    for (const c of colEls) {
      const w = points(this.styleWidth(attr(c, 'table', 'style-name')));
      const rep = Math.min(64, Number(attr(c, 'table', 'number-columns-repeated') ?? '1'));
      for (let i = 0; i < rep; i++) cols.push(w ?? 72);
    }
    const rows: TableCell[][] = [];
    let head = 0;
    const rowEls: { el: Element; head: boolean }[] = [];
    const collectRows = (e: Element, h: boolean) => { for (const k of kids(e)) { if (k.localName === 'table-row') rowEls.push({ el: k, head: h }); else if (k.localName === 'table-header-rows') collectRows(k, true); else if (k.localName === 'table-rows' || k.localName === 'table-row-group') collectRows(k, h); } };
    collectRows(el, false);
    for (const r of rowEls) {
      const row: TableCell[] = [];
      for (const c of kids(r.el)) {
        if (c.localName === 'covered-table-cell') { row.push({ runs: [{ text: '' }] }); continue; }
        if (c.localName !== 'table-cell') continue;
        const inner = { runs: [] as TextRun[], paras: [] as ParaStyle[] };
        this.blocks(kids(c), { list: null }, inner);
        const span = Number(attr(c, 'table', 'number-columns-spanned') ?? '1');
        const down = Number(attr(c, 'table', 'number-rows-spanned') ?? '1');
        row.push({ runs: inner.runs.length ? rt.normalizeRuns(inner.runs) : [{ text: '' }], ...(inner.paras.some((p) => Object.values(p).some((v) => v !== undefined)) ? { paras: inner.paras } : {}), ...(span > 1 ? { span } : {}), ...(down > 1 ? { rowSpan: down } : {}) });
      }
      if (r.head) head++;
      rows.push(row);
    }
    const n = Math.max(cols.length, ...rows.map((r) => r.length));
    while (cols.length < n) cols.push(72);
    const table: TableData = { cols, rows: rows.map((r) => Array.from({ length: n }, (_, i) => r[i] ?? { runs: [{ text: '' }] })), head, lines: 'grid' };
    this.b.table({ kind: 'table', table });
  }

  private styleWidth(name: string | null): string | null {
    if (!name) return null;
    for (const d of ['content.xml', 'styles.xml']) {
      const text = this.files[d] ? strFromU8(this.files[d]) : '';
      const m = new RegExp(`<style:style[^>]*style:name="${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>\\s*<style:table-column-properties[^>]*style:column-width="([^"]+)"`).exec(text);
      if (m) return m[1];
    }
    return null;
  }
}

function nameOf(s: OdStyle, all: Map<string, OdStyle>): string | undefined {
  for (const [k, v] of all) if (v === s) return k;
  return undefined;
}

/** What a style sets (a switch set off as unset, so it overrides the paragraph style's), leaving out what it doesn't set. */
function cleanText(t: TextProps): rt.RunStyle {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(t)) out[k] = v === false ? undefined : v;
  return out as rt.RunStyle;
}

function base64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

function pictureMime(name: string, b?: Uint8Array): string | null {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'png' || (b && b[0] === 0x89 && b[1] === 0x50)) return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg' || (b && b[0] === 0xff && b[1] === 0xd8)) return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'svg') return 'image/svg+xml';
  return null;
}

/** Open an OpenDocument text as a document. */
export function readOdt(bytes: Uint8Array): { doc: DocText; warnings: string[] } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('This is not an OpenDocument text (or it is damaged).');
  }
  if (files['META-INF/manifest.xml'] && /encryption-data/.test(strFromU8(files['META-INF/manifest.xml']))) {
    throw new Error('This document is protected with a password. Open it in LibreOffice, take the password off, and save it again.');
  }
  return new OdtReader(files).read();
}

// ---------------------------------------------------------------- writing

export interface OdtDeps {
  /** A drawing's picture: PNG bytes and its size in points. */
  picture?(contents: Contents, style: DocStyle): Promise<{ png: Uint8Array; w: number; h: number } | null>;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pt = (v: number) => `${Math.round(v * 100) / 100}pt`;

/** Text as ODF writes it: runs of spaces as text:s, tabs as text:tab. */
function odText(t: string): string {
  return esc(t).replace(/\t/g, '<text:tab/>').replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`).replace(/^ /, '<text:s/>');
}

class OdtWriter {
  private autoText = new Map<string, string>();
  private autoPara = new Map<string, string>();
  private fonts = new Set<string>();
  private pictures: Record<string, Uint8Array> = {};
  private fields: Map<number, string>;
  private frame = 0;

  constructor(private t: DocText, private deps: OdtDeps) {
    this.fields = fieldTexts(t);
  }

  private textStyle(r: TextRun): string | null {
    const p: string[] = [];
    if (r.font) { this.fonts.add(r.font); p.push(`style:font-name="${esc(r.font)}"`); }
    if (r.size) p.push(`fo:font-size="${pt(r.size)}"`);
    if (r.bold) p.push('fo:font-weight="bold"');
    if (r.italic) p.push('fo:font-style="italic"');
    if (r.underline) p.push('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"');
    if (r.strike) p.push('style:text-line-through-style="solid"');
    if (r.sub) p.push('style:text-position="sub 58%"');
    if (r.sup) p.push('style:text-position="super 58%"');
    if (r.color) p.push(`fo:color="${r.color}"`);
    if (r.highlight) p.push(`fo:background-color="${r.highlight}"`);
    if (r.smallCaps) p.push('fo:font-variant="small-caps"');
    if (r.allCaps) p.push('fo:text-transform="uppercase"');
    if (!p.length) return null;
    const key = p.join(' ');
    let name = this.autoText.get(key);
    if (!name) { name = `T${this.autoText.size + 1}`; this.autoText.set(key, name); }
    return name;
  }

  private paraStyle(ps: ParaStyle, parent: string): string {
    const st = styleOf(this.t, ps);
    const p: string[] = [];
    const align = ps.align ?? st.align;
    p.push(`fo:text-align="${align === 'center' ? 'center' : align === 'right' ? 'end' : align === 'justify' ? 'justify' : 'start'}"`);
    p.push(`fo:margin-top="${pt(ps.spaceBefore ?? st.spaceBefore)}" fo:margin-bottom="${pt(ps.spaceAfter ?? st.spaceAfter)}"`);
    const li = ps.indent ?? st.indent, fi = ps.firstLine ?? st.firstLine;
    if (li || fi || ps.indentRight) p.push(`fo:margin-left="${pt(li)}" fo:margin-right="${pt(ps.indentRight ?? 0)}" fo:text-indent="${pt(fi)}"`);
    if (ps.linePt && ps.linePt > 0) p.push(ps.lineRule === 'exact' ? `fo:line-height="${pt(ps.linePt)}"` : `style:line-height-at-least="${pt(ps.linePt)}"`);
    else p.push(`fo:line-height="${Math.round((ps.line ?? st.line) * 100)}%"`);
    if (ps.pageBreak) p.push('fo:break-before="page"');
    if (ps.keepNext ?? st.keepNext) p.push('fo:keep-with-next="always"');
    const key = `${parent}|${p.join(' ')}`;
    let name = this.autoPara.get(key);
    if (!name) { name = `P${this.autoPara.size + 1}`; this.autoPara.set(key, name); }
    return name;
  }

  private async runs(rs: TextRun[]): Promise<string> {
    let out = '';
    for (const r of rs) {
      if (r.obj !== undefined) { out += await this.object(r); continue; }
      if (!r.text) continue;
      if (r.formula && !r.sub && !r.sup) { for (const part of rt.formulaParts(r.text)) out += this.span({ ...r, formula: undefined, sub: part.pos === 'sub' || undefined, sup: part.pos === 'sup' || undefined, text: part.text }); continue; }
      out += this.span(r);
    }
    return out;
  }

  private span(r: TextRun): string {
    const name = this.textStyle(r);
    const body = odText(r.text);
    const inner = name ? `<text:span text:style-name="${name}">${body}</text:span>` : body;
    return r.link ? `<text:a xlink:type="simple" xlink:href="${esc(r.link)}">${inner}</text:a>` : inner;
  }

  private async object(r: TextRun): Promise<string> {
    const o = this.t.objects[r.obj!];
    if (!o) return '';
    const shown = this.fields.get(r.obj!);
    if (shown !== undefined && o.kind !== 'note') return this.span({ ...r, obj: undefined, text: shown });
    if (o.kind === 'note') {
      const paras = splitParagraphs(o.runs);
      let body = '';
      for (const p of paras) body += `<text:p text:style-name="${o.end ? 'Endnote' : 'Footnote'}">${await this.runs(p)}</text:p>`;
      return `<text:note text:id="ftn${r.obj}" text:note-class="${o.end ? 'endnote' : 'footnote'}"><text:note-citation/><text:note-body>${body}</text:note-body></text:note>`;
    }
    if (o.kind === 'picture') {
      const m = /^data:image\/(png|jpeg|jpg|gif|svg\+xml);base64,(.*)$/i.exec(o.src);
      if (!m) return '';
      const bin = atob(m[2]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return this.image(bytes, m[1].toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg'), o.w * (o.scale ?? 1), o.h * (o.scale ?? 1), o.alt);
    }
    if (o.kind === 'drawing' && this.deps.picture) {
      const pic = await this.deps.picture(o.contents, this.t.drawingStyle);
      if (pic) return this.image(pic.png, 'png', pic.w * (o.scale ?? 1), pic.h * (o.scale ?? 1), o.alt);
    }
    if (o.kind === 'math') return this.span({ ...r, obj: undefined, text: o.tex });
    return '';
  }

  private image(bytes: Uint8Array, ext: string, w: number, h: number, alt?: string): string {
    const n = ++this.frame;
    const path = `Pictures/image${n}.${ext}`;
    this.pictures[path] = bytes;
    return `<draw:frame draw:name="Image${n}" text:anchor-type="as-char" svg:width="${pt(w)}" svg:height="${pt(h)}" draw:z-index="${n}"><draw:image xlink:href="${path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>${alt ? `<svg:desc>${esc(alt)}</svg:desc>` : ''}</draw:frame>`;
  }

  private async table(tb: TableData, n: number): Promise<string> {
    let out = `<table:table table:name="Table${n}">`;
    tb.cols.forEach((w, i) => { out += `<table:table-column table:style-name="Tc${n}_${i}"/>`; this.colWidths.push([`Tc${n}_${i}`, w]); });
    const head = Math.min(tb.head ?? 0, tb.rows.length);
    for (let r = 0; r < tb.rows.length; r++) {
      if (r === 0 && head) out += '<table:table-header-rows>';
      out += '<table:table-row>';
      for (const c of tb.rows[r]) {
        const paras = splitParagraphs(c.runs);
        const ps = fitParas(c.paras, paras.length);
        let inner = '';
        for (let i = 0; i < paras.length; i++) inner += `<text:p text:style-name="${this.paraStyle(ps[i], 'Table_20_Contents')}">${await this.runs(paras[i])}</text:p>`;
        out += `<table:table-cell table:style-name="Cell" office:value-type="string"${c.span && c.span > 1 ? ` table:number-columns-spanned="${c.span}"` : ''}${c.rowSpan && c.rowSpan > 1 ? ` table:number-rows-spanned="${c.rowSpan}"` : ''}>${inner}</table:table-cell>`;
      }
      out += '</table:table-row>';
      if (r === head - 1) out += '</table:table-header-rows>';
    }
    return out + '</table:table>';
  }

  private colWidths: [string, number][] = [];

  async body(): Promise<string> {
    const t = this.t;
    const runsOf = splitParagraphs(t.runs);
    const paras = fitParas(t.paras, paraCount(rt.plainText(t.runs)));
    let out = '';
    let list: 'bullet' | 'number' | null = null;
    let tables = 0;
    const closeList = () => { if (list) { out += '</text:list>'; list = null; } };
    for (let p = 0; p < paras.length; p++) {
      const rs = runsOf[p] ?? [];
      const ps = paras[p];
      const only = rs.filter((r) => r.text);
      const tb = only.length === 1 && only[0].obj !== undefined ? t.objects[only[0].obj] : undefined;
      if (tb?.kind === 'table') { closeList(); out += await this.table(tb.table, ++tables); continue; }
      if ((ps.list ?? null) !== list) {
        closeList();
        if (ps.list) { out += `<text:list text:style-name="${ps.list === 'number' ? 'Numbering' : 'Bullets'}">`; list = ps.list; }
      }
      const h = /^Heading(\d)$/.exec(ps.style ?? '');
      const parent = h ? `Heading_20_${h[1]}` : ps.style === 'Title' ? 'Title' : ps.style === 'Caption' ? 'Caption' : 'Standard';
      const name = this.paraStyle(ps, parent);
      const inner = await this.runs(rs);
      const el = h ? `<text:h text:style-name="${name}" text:outline-level="${h[1]}">${inner}</text:h>` : `<text:p text:style-name="${name}">${inner}</text:p>`;
      out += ps.list ? `<text:list-item>${el}</text:list-item>` : el;
    }
    closeList();
    return out;
  }

  autoStyles(): string {
    let out = '';
    for (const [key, name] of this.autoPara) {
      const [parent, props] = [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)];
      out += `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${parent}"><style:paragraph-properties ${props}/></style:style>`;
    }
    for (const [props, name] of this.autoText) out += `<style:style style:name="${name}" style:family="text"><style:text-properties ${props}/></style:style>`;
    for (const [name, w] of this.colWidths) out += `<style:style style:name="${name}" style:family="table-column"><style:table-column-properties style:column-width="${pt(w)}"/></style:style>`;
    out += '<style:style style:name="Cell" style:family="table-cell"><style:table-cell-properties fo:padding="2pt" fo:border="0.5pt solid #000000"/></style:style>';
    return out;
  }

  fontFaces(): string {
    return [...this.fonts].map((f) => `<style:font-face style:name="${esc(f)}" svg:font-family="${esc(/\s/.test(f) ? `'${f}'` : f)}"/>`).join('');
  }

  /** styles.xml: the named styles (Normal as Standard, the headings, title and caption), lists and the page. */
  stylesXml(): string {
    const t = this.t;
    const text = (s: ReturnType<typeof styleOf>) => {
      this.fonts.add(s.font);
      return `<style:text-properties style:font-name="${esc(s.font)}" fo:font-size="${pt(s.size)}"${s.bold ? ' fo:font-weight="bold"' : ''}${s.italic ? ' fo:font-style="italic"' : ''}${s.color ? ` fo:color="${s.color}"` : ''}/>`;
    };
    const named = (name: string, display: string, s: ReturnType<typeof styleOf>, extra = '') =>
      `<style:style style:name="${name}" style:display-name="${esc(display)}" style:family="paragraph" style:parent-style-name="Standard"${extra}>${text(s)}</style:style>`;
    let st = `<style:style style:name="Standard" style:family="paragraph" style:class="text">${text(styleOf(t, {}))}</style:style>`;
    for (let n = 1; n <= 9; n++) {
      const s = t.styles[headingId(n)];
      if (s) st += named(`Heading_20_${n}`, `Heading ${n}`, s, ` style:default-outline-level="${n}" style:class="text"`);
    }
    if (t.styles.Title) st += named('Title', 'Title', t.styles.Title, ' style:class="chapter"');
    if (t.styles.Caption) st += named('Caption', 'Caption', t.styles.Caption, ' style:class="extra"');
    st += '<style:style style:name="Table_20_Contents" style:display-name="Table Contents" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"/>';
    st += '<style:style style:name="Footnote" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:text-properties fo:font-size="10pt"/></style:style>';
    st += '<style:style style:name="Endnote" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:text-properties fo:font-size="10pt"/></style:style>';
    const bullets = Array.from({ length: 9 }, (_, i) => `<text:list-level-style-bullet text:level="${i + 1}" text:bullet-char="${['•', '◦', '▪'][i % 3]}"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${pt(18 * (i + 1))}" fo:text-indent="-18pt" fo:margin-left="${pt(18 * (i + 1))}"/></style:list-level-properties></text:list-level-style-bullet>`).join('');
    const numbers = Array.from({ length: 9 }, (_, i) => `<text:list-level-style-number text:level="${i + 1}" style:num-suffix="." style:num-format="${['1', 'a', 'i'][i % 3]}"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${pt(18 * (i + 1))}" fo:text-indent="-18pt" fo:margin-left="${pt(18 * (i + 1))}"/></style:list-level-properties></text:list-level-style-number>`).join('');
    st += `<text:list-style style:name="Bullets">${bullets}</text:list-style><text:list-style style:name="Numbering">${numbers}</text:list-style>`;
    const pg = t.page;
    const layout = `<style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="${pt(pg.w)}" fo:page-height="${pt(pg.h)}" style:print-orientation="${pg.w > pg.h ? 'landscape' : 'portrait'}" fo:margin-top="${pt(pg.top)}" fo:margin-bottom="${pt(pg.bottom)}" fo:margin-left="${pt(pg.left)}" fo:margin-right="${pt(pg.right)}"/></style:page-layout>`;
    return `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${nsDecl()} office:version="1.3"><office:font-face-decls>${this.fontFaces()}</office:font-face-decls><office:styles>${st}</office:styles><office:automatic-styles>${layout}</office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles></office:document-styles>`;
  }

  get files(): Record<string, Uint8Array> {
    return this.pictures;
  }
}

function nsDecl(): string {
  return ['office', 'style', 'text', 'table', 'draw', 'fo', 'xlink', 'svg', 'meta'].map((k) => `xmlns:${k}="${NS[k as keyof typeof NS]}"`).join(' ');
}

/** The document as an OpenDocument text. */
export async function writeOdt(t: DocText, deps: OdtDeps = {}): Promise<Uint8Array> {
  const w = new OdtWriter(t, deps);
  const body = await w.body();
  const styles = w.stylesXml();
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${nsDecl()} office:version="1.3"><office:font-face-decls>${w.fontFaces()}</office:font-face-decls><office:automatic-styles>${w.autoStyles()}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  const pics = w.files;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="${NS.manifest}" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${MIME}"/>` +
    ['content.xml', 'styles.xml', 'meta.xml'].map((p) => `<manifest:file-entry manifest:full-path="${p}" manifest:media-type="text/xml"/>`).join('') +
    Object.keys(pics).map((p) => `<manifest:file-entry manifest:full-path="${p}" manifest:media-type="image/${p.endsWith('.png') ? 'png' : p.endsWith('.svg') ? 'svg+xml' : p.endsWith('.gif') ? 'gif' : 'jpeg'}"/>`).join('') + '</manifest:manifest>';
  const meta = `<?xml version="1.0" encoding="UTF-8"?><office:document-meta xmlns:office="${NS.office}" xmlns:meta="${NS.meta}" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.3"><office:meta><meta:generator>Chem Illustrator</meta:generator>${t.props?.title ? `<dc:title>${esc(t.props.title)}</dc:title>` : ''}</office:meta></office:document-meta>`;
  // the mimetype first and uncompressed, as the standard asks
  return zipFiles([
    ['mimetype', strToU8(MIME), false],
    ['META-INF/manifest.xml', strToU8(manifest), true],
    ['content.xml', strToU8(content), true],
    ['styles.xml', strToU8(styles), true],
    ['meta.xml', strToU8(meta), true],
    ...Object.entries(pics).map(([k, v]): [string, Uint8Array, boolean] => [k, v, false]),
  ]);
}

/** A zip of files in this order, each compressed or stored as it is. */
export function zipFiles(files: [string, Uint8Array, boolean][]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const zip = new Zip((err, data) => { if (err) throw err; chunks.push(data); });
  for (const [name, data, squeeze] of files) {
    const f = squeeze ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
    zip.add(f);
    f.push(data, true);
  }
  zip.end();
  const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
