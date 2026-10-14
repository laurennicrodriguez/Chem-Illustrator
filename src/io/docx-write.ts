// Saving a document as a Word file (.docx). Paragraphs keep their named styles (Normal,
// Heading 1…, defined in the file's styles part, so changing a style in Word changes the
// document there too) and carry only the formatting that differs from their style. Lists are
// Word lists, tables Word tables, captions SEQ fields and cross-references REF fields to
// bookmarks round the caption's label and number, as Word's own Insert Caption and
// Cross-reference make them. Page numbers are PAGE fields in the footer or header.
// Citations are ADDIN fields (as reference managers write them) whose result is the numbers
// in superscript, which Word shows and leaves alone; the bibliography is ordinary paragraphs
// inside a hidden bookmark. Our own part keeps the references, so they come back here live.

import type { Contents, Justify, ParaStyle, TableData, TextRun } from '../model';
import type { DocStyle } from '../style';
import * as rt from '../richtext';
import { Package, REL, NS, xml, hex6, emu } from './ooxml';
import { fromDataUrl } from '../render/images';
import { fitParas, listMarkers, paraCount, splitParagraphs } from '../text/paragraphs';
import { COMPOUND, OBJECT_CHAR, fieldTexts, pruneObjects, styleOf, runStyleOf, type DocObject, type DocText, type NamedStyle } from '../document/document';
import { bibHang, shownSize } from '../document/doc-layout';
import { bibliography, piecesText } from '../document/references';
import { documentMeasure } from '../text/font-measure';
import { arialWidth } from '../text-metrics';
import { PAD_X, PAD_Y, cellAlign, isCovered, spanOf } from '../table';
import {
  BIB_MARK, CITE_FIELD, DOCX_CT, DOCX_REL, DRAWING_NAME, FORMULA_STYLE, MODEL_NS, PIC_NS, TABLE_NAME, W_NS, WP_NS, twips, type DocxModel,
} from './docx';

export interface DocxDeps {
  /** A drawing's picture for Word: PNG bytes, an SVG Word shows instead when it can, and its own size in points. */
  picture(contents: Contents, style: DocStyle): Promise<{ png: Uint8Array; svg?: string; w: number; h: number } | null>;
  /** A PNG of an SVG picture, for Word versions that can't show SVG (w × h pixels). */
  svgToPng?(svg: string, w: number, h: number): Promise<Uint8Array>;
}

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const SVG_EXT = '{96DAC541-7B7A-43D3-8B79-37D633B846F1}';
const NS_SVG = 'http://schemas.microsoft.com/office/drawing/2016/SVG/main';
const MIME_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/x-emf': 'emf', 'image/x-wmf': 'wmf',
  'image/svg+xml': 'svg', 'image/tiff': 'tiff', 'image/webp': 'png',
};
const EXT_TYPE: Record<string, string> = {
  png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', emf: 'image/x-emf', wmf: 'image/x-wmf', svg: 'image/svg+xml', tiff: 'image/tiff',
};
/** Word's names for its built-in styles (so Word treats ours as its own: the Navigation Pane, Insert Caption…). */
const WORD_NAMES: Record<string, string> = { Normal: 'Normal', Title: 'Title', Heading1: 'heading 1', Heading2: 'heading 2', Heading3: 'heading 3', Caption: 'caption' };
const PRIORITY: Record<string, number> = { Normal: 0, Title: 10, Heading1: 9, Heading2: 9, Heading3: 9, Caption: 35 };
const JC: Record<Justify, string> = { left: 'left', center: 'center', right: 'right', justify: 'both' };

/** Save a document as a Word file. */
export async function writeDocx(t: DocText, deps: DocxDeps, title = ''): Promise<Uint8Array> {
  return new DocxWriter(pruneObjects(t), deps).write(title);
}

class DocxWriter {
  private pkg = new Package();
  private docPr = 1;
  private bookmarkId = 0;
  private shown: Map<number, string>;
  /** Bookmark names of the captions that references point to, by the caption's number field. */
  private bookmarks = new Map<number, string>();
  /** Numbered lists: one Word list each, so each starts at 1. */
  private numberedLists = 0;
  private model: DocxModel;
  private textW: number;

  constructor(private t: DocText, private deps: DocxDeps) {
    this.shown = fieldTexts(t);
    for (const o of Object.values(t.objects)) {
      if (o.kind === 'ref' && t.objects[o.target]?.kind === 'seq') this.bookmarks.set(o.target, `_Ref${100000000 + o.target}`);
    }
    this.model = { app: 'Chem Illustrator', version: 1, drawingStyle: t.drawingStyle, drawings: {}, tables: {} };
    // (kept even when empty while citations are in the text, so they open again as citations)
    if (t.references?.length || Object.values(t.objects).some((o) => o.kind === 'cite' || o.kind === 'bib')) this.model.references = t.references ?? [];
    if (t.citeStyle) this.model.citeStyle = t.citeStyle;
    if (t.citeOptions && Object.keys(t.citeOptions).length) this.model.citeOptions = t.citeOptions;
    this.textW = Math.max(36, t.page.w - t.page.left - t.page.right);
  }

  async write(title: string): Promise<Uint8Array> {
    const pkg = this.pkg;
    for (const [ext, type] of Object.entries(EXT_TYPE)) pkg.defaultType(ext, type);
    const main = 'word/document.xml';
    const body = await this.body(main);
    const sect = this.section(main);
    pkg.add(main, `${HEAD}<w:document xmlns:w="${W_NS}" xmlns:r="${NS.r}" xmlns:wp="${WP_NS}" xmlns:a="${NS.a}" xmlns:pic="${PIC_NS}"><w:body>${body}${sect}</w:body></w:document>`, DOCX_CT.document);
    pkg.relate(main, DOCX_REL.styles, 'styles.xml');
    pkg.add('word/styles.xml', this.styles(), DOCX_CT.styles);
    pkg.relate(main, DOCX_REL.numbering, 'numbering.xml');
    pkg.add('word/numbering.xml', this.numbering(), DOCX_CT.numbering);
    pkg.relate(main, DOCX_REL.settings, 'settings.xml');
    pkg.add('word/settings.xml', `${HEAD}<w:settings xmlns:w="${W_NS}"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/>` +
      `${this.t.hf.onFirst ? '' : ''}<w:characterSpacingControl w:val="doNotCompress"/>` +
      `<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`, DOCX_CT.settings);
    // our own part: each structure's drawing, and each table as made here
    pkg.relate(main, DOCX_REL.customXml, '../customXml/item1.xml');
    pkg.add('customXml/item1.xml', `${HEAD}<chemIllustrator xmlns="${MODEL_NS}" version="1">${xml(JSON.stringify(this.model))}</chemIllustrator>`);
    pkg.relate('customXml/item1.xml', DOCX_REL.customXmlProps, 'itemProps1.xml');
    pkg.add('customXml/itemProps1.xml', `${HEAD}<ds:datastoreItem ds:itemID="{3B7E2C41-8F0A-4D6B-A9C2-5E1D7F3A2B90}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="${MODEL_NS}"/></ds:schemaRefs></ds:datastoreItem>`, DOCX_CT.itemProps);
    pkg.relate('', REL.officeDocument, main);
    pkg.relate('', REL.coreProps, 'docProps/core.xml');
    pkg.relate('', REL.extendedProps, 'docProps/app.xml');
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    pkg.add('docProps/core.xml', `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `${title ? `<dc:title>${xml(title)}</dc:title>` : ''}<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`, DOCX_CT.core);
    pkg.add('docProps/app.xml', `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Chem Illustrator</Application></Properties>`, DOCX_CT.app);
    return pkg.build();
  }

  // ---------------------------------------------------------------- the text

  private async body(main: string): Promise<string> {
    const t = this.t;
    const n = paraCount(rt.plainText(t.runs));
    const paras = fitParas(t.paras, n);
    const runsOf = splitParagraphs(t.runs);
    const markers = listMarkers(paras);
    const out: string[] = [];
    let lastWasTable = false;
    let listNum = 0;
    for (let p = 0; p < n; p++) {
      const runs = runsOf[p] ?? [];
      const ps = paras[p];
      // a paragraph holding just a table: Word's own table
      const only = runs.length === 1 && runs[0].obj !== undefined && runs[0].text === OBJECT_CHAR ? t.objects[runs[0].obj] : undefined;
      const table = only?.kind === 'drawing' ? soleTable(only.contents) : null;
      if (table) {
        if (lastWasTable) out.push('<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>');
        out.push(this.table(runs[0].obj!, table, ps.align ?? styleOf(t, ps).align));
        lastWasTable = true;
        continue;
      }
      // numbered lists: a new Word list where our numbers start again
      if (ps.list === 'number' && !ps.cont && markers[p] === '1.' && (ps.level ?? 0) === 0) listNum = ++this.numberedLists + 1;
      // a bibliography: its entries as paragraphs of their own, with any text round it in paragraphs before and after
      const isBib = (r: TextRun) => r.obj !== undefined && t.objects[r.obj]?.kind === 'bib';
      if (runs.some(isBib)) {
        let part: TextRun[] = [];
        for (const r of runs) {
          if (!isBib(r)) { part.push(r); continue; }
          if (part.some((x) => x.text)) out.push(await this.paragraph(main, ps, part, listNum));
          part = [];
          out.push(this.bibliography(r.obj!, ps));
        }
        if (part.some((x) => x.text)) out.push(await this.paragraph(main, ps, part, listNum));
      } else out.push(await this.paragraph(main, ps, runs, listNum));
      lastWasTable = false;
    }
    // Word ends the text with a paragraph
    if (lastWasTable || !out.length) out.push('<w:p/>');
    return out.join('');
  }

  private async paragraph(main: string, ps: ParaStyle, runs: TextRun[], listNum: number): Promise<string> {
    const t = this.t;
    const st = styleOf(t, ps);
    const pPr: string[] = [];
    if (st.id !== 'Normal') pPr.push(`<w:pStyle w:val="${xml(st.id)}"/>`);
    if (!!ps.keepNext !== st.keepNext) pPr.push(ps.keepNext ? '<w:keepNext/>' : '<w:keepNext w:val="0"/>');
    if (ps.pageBreak) pPr.push('<w:pageBreakBefore/>');
    const em = runs.find((r) => r.obj === undefined)?.size ?? st.size;
    if (ps.list && !ps.cont) {
      const id = ps.list === 'bullet' ? 1 : Math.max(2, listNum);
      pPr.push(`<w:numPr><w:ilvl w:val="${Math.max(0, Math.min(8, ps.level ?? 0))}"/><w:numId w:val="${id}"/></w:numPr>`);
    }
    const sp: string[] = [];
    const before = ps.spaceBefore ?? 0, after = ps.spaceAfter ?? 0, line = ps.line ?? 1;
    if (before !== st.spaceBefore) sp.push(`w:before="${twips(before)}"`);
    if (after !== st.spaceAfter) sp.push(`w:after="${twips(after)}"`);
    if (line !== st.line) sp.push(`w:line="${Math.round(240 * line)}" w:lineRule="auto"`);
    if (sp.length) pPr.push(`<w:spacing ${sp.join(' ')}/>`);
    // indents: list items hang their bullet or number, as laid out here
    const indent = ps.indent ?? 0;
    if (ps.list) {
      const { left, hang } = listIndent(ps, em);
      pPr.push(`<w:ind w:left="${twips(left)}" ${ps.cont ? 'w:firstLine="0"' : `w:hanging="${twips(hang)}"`}/>`);
    } else {
      const first = ps.firstLine ?? 0;
      if (indent !== st.indent || first !== st.firstLine) pPr.push(`<w:ind w:left="${twips(indent)}" ${first < 0 ? `w:hanging="${twips(-first)}"` : `w:firstLine="${twips(first)}"`}/>`);
    }
    const align = ps.align ?? 'left';
    if (align !== st.align) pPr.push(`<w:jc w:val="${JC[align]}"/>`);

    // a caption that references point to: a bookmark round its label and number; a compound
    // number's bookmark is round just the number
    const isCompound = (id: number) => { const o = this.t.objects[id]; return o?.kind === 'seq' && o.name === COMPOUND; };
    const seqs = runs.filter((r) => r.obj !== undefined && this.bookmarks.has(r.obj) && !isCompound(r.obj)).map((r) => r.obj!);
    const out: string[] = [];
    let open: { id: number; seq: number } | null = null;
    if (seqs.length) {
      open = { id: this.bookmarkId++, seq: seqs[0] };
      out.push(`<w:bookmarkStart w:id="${open.id}" w:name="${this.bookmarks.get(seqs[0])}"/>`);
    }
    for (const r of runs) {
      if (r.obj === undefined) { out.push(this.textRuns(r, st)); continue; }
      const mark = this.bookmarks.has(r.obj) && isCompound(r.obj) ? this.bookmarkId++ : null;
      if (mark !== null) out.push(`<w:bookmarkStart w:id="${mark}" w:name="${this.bookmarks.get(r.obj)}"/>`);
      out.push(await this.objectRun(main, r, st));
      if (mark !== null) out.push(`<w:bookmarkEnd w:id="${mark}"/>`);
      if (open && r.obj === open.seq) { out.push(`<w:bookmarkEnd w:id="${open.id}"/>`); open = null; }
    }
    return `<w:p>${pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''}${out.join('')}</w:p>`;
  }

  /**
   * A bibliography as Word paragraphs: each entry's number hanging out before a tab, its text
   * in italics and bold as the style prints it, all inside a hidden bookmark so it is found
   * again when the file is opened here.
   */
  private bibliography(id: number, ps: ParaStyle): string {
    const t = this.t;
    const st = styleOf(t, undefined);
    const entries = bibliography(t);
    const measure = documentMeasure((s, size, _f, style) => arialWidth(s, size, /bold/.test(style)));
    const hang = bibHang(entries.map((e) => e.label), st.size, st.font, measure);
    const base = runStyleOf(st);
    const mark = this.bookmarkId++;
    const name = `${BIB_MARK}${id}`;
    const pPr = `<w:pPr><w:spacing w:before="0" w:after="0"/><w:ind w:left="${twips(hang)}" w:hanging="${twips(hang)}"/><w:jc w:val="left"/></w:pPr>`;
    const paras = entries.map((e) => run(runProps({ ...base, text: '' }, st, {}), `${e.label}\t`) +
      e.pieces.map((p) => run(runProps({ ...base, italic: p.italic, bold: p.bold, text: p.text }, st, {}), p.text)).join(''));
    if (!paras.length) paras.push('');
    paras[0] = `<w:bookmarkStart w:id="${mark}" w:name="${name}"/>${paras[0]}`;
    paras[paras.length - 1] += `<w:bookmarkEnd w:id="${mark}"/>`;
    this.model.bibliographies ??= {};
    this.model.bibliographies[id] = { text: entries.map((e) => `${e.label}\t${piecesText(e.pieces)}`).join('\n'), ps };
    return paras.map((x) => `<w:p>${entries.length ? pPr : '<w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>'}${x}</w:p>`).join('');
  }

  /** Runs of text, a formula's parts each with its own position. */
  private textRuns(r: TextRun, st: NamedStyle): string {
    if (!r.text) return '';
    if (r.formula && !r.sub && !r.sup) {
      return rt.formulaParts(r.text).map((part) => run(runProps(r, st, { formula: true, pos: part.pos }), part.text)).join('');
    }
    return run(runProps(r, st, {}), r.text);
  }

  private async objectRun(main: string, r: TextRun, st: NamedStyle): Promise<string> {
    const id = r.obj!;
    const o = this.t.objects[id];
    if (!o) return '';
    const rPr = runProps(r, st, {});
    const shown = this.shown.get(id) ?? '';
    if (o.kind === 'seq') {
      const name = /\s/.test(o.name) ? `"${o.name}"` : o.name;
      return field(rPr, ` SEQ ${xml(name)} \\* ARABIC \\* CHARFORMAT `, shown);
    }
    if (o.kind === 'ref') {
      const bm = this.bookmarks.get(o.target);
      return bm ? field(rPr, ` REF ${bm} \\h \\* CHARFORMAT `, shown) : run(rPr, shown);
    }
    // a citation: its numbers, which Word shows as they are (an ADDIN field is never worked out again by Word)
    if (o.kind === 'cite') return field(rPr, ` ${CITE_FIELD} ${o.refs.map(xml).join(' ')} `, shown);
    if (o.kind === 'bib') return '';
    return this.picture(main, id, o, rPr);
  }

  // ---------------------------------------------------------------- figures and pictures

  private async picture(main: string, id: number, o: DocObject, rPr: string): Promise<string> {
    const t = this.t;
    let blip: string, svgId: string | null = null, size: { w: number; h: number }, name: string;
    if (o.kind === 'drawing') {
      const pic = await this.deps.picture(o.contents, t.drawingStyle);
      if (!pic) return '';
      this.model.drawings[id] = { contents: o.contents, w: pic.w, h: pic.h };
      blip = this.media(main, pic.png, 'png');
      if (pic.svg) svgId = this.media(main, new TextEncoder().encode(pic.svg), 'svg');
      size = shownSize({ w: pic.w, h: pic.h }, o.scale ?? 1, this.textW);
      name = `${DRAWING_NAME} ${id}`;
    } else if (o.kind === 'picture') {
      let mime: string, bytes: Uint8Array;
      try {
        ({ mime, bytes } = fromDataUrl(o.src));
      } catch {
        return '';
      }
      const ext = MIME_EXT[mime];
      if (!ext) return '';
      size = shownSize({ w: o.w, h: o.h }, o.scale ?? 1, this.textW);
      if (ext === 'svg') {
        // Word shows the SVG; older versions the PNG beside it
        if (!this.deps.svgToPng) return '';
        const k = 300 / 72;
        const png = await this.deps.svgToPng(new TextDecoder().decode(bytes), Math.max(1, Math.round(size.w * k)), Math.max(1, Math.round(size.h * k)));
        blip = this.media(main, png, 'png');
        svgId = this.media(main, bytes, 'svg');
      } else blip = this.media(main, bytes, ext);
      name = `Picture ${id}`;
    } else return '';
    const cx = emu(size.w), cy = emu(size.h);
    const n = this.docPr++;
    const ext = svgId ? `<a:extLst><a:ext uri="${SVG_EXT}"><asvg:svgBlip xmlns:asvg="${NS_SVG}" r:embed="${svgId}"/></a:ext></a:extLst>` : '';
    const descr = o.kind === 'drawing' ? ' descr="Chemical structure or scheme"' : '';
    return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
      `<wp:docPr id="${n}" name="${xml(name)}"${descr}/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
      `<a:graphic><a:graphicData uri="${PIC_NS}"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${xml(name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${blip}">${ext}</a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }

  private mediaCount = 0;
  private media(from: string, bytes: Uint8Array, ext: string): string {
    const name = `media/image${++this.mediaCount}.${ext}`;
    this.pkg.add(`word/${name}`, bytes);
    return this.pkg.relate(from, DOCX_REL.image, name);
  }

  // ---------------------------------------------------------------- tables

  /** A table as Word's own: its columns, heading rows, ACS rules (or a grid), text and alignment. */
  private table(id: number, tab: TableData, align: Justify): string {
    const style = this.t.drawingStyle;
    const size = tab.size ?? style.captionSize;
    const font = style.captionFont || 'Arial';
    this.model.tables[id] = { table: tab, text: tableText(tab) };
    const lw = Math.max(2, Math.min(96, Math.round(style.lineWidth * 8)));
    const line = `w:val="single" w:sz="${lw}" w:space="0" w:color="000000"`;
    const none = 'w:val="nil"';
    const borders = tab.lines === 'grid'
      ? `<w:top ${line}/><w:left ${line}/><w:bottom ${line}/><w:right ${line}/><w:insideH ${line}/><w:insideV ${line}/>`
      : tab.lines === 'acs' ? `<w:top ${line}/><w:left ${none}/><w:bottom ${line}/><w:right ${none}/><w:insideH ${none}/><w:insideV ${none}/>`
        : `<w:top ${none}/><w:left ${none}/><w:bottom ${none}/><w:right ${none}/><w:insideH ${none}/><w:insideV ${none}/>`;
    const width = tab.cols.reduce((a, b) => a + b, 0);
    const padX = twips(PAD_X * size), padY = twips(PAD_Y * size);
    const tblPr = `<w:tblPr><w:tblW w:w="${twips(width)}" w:type="dxa"/><w:jc w:val="${align === 'right' ? 'right' : align === 'left' ? 'left' : 'center'}"/>` +
      `<w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/>` +
      `<w:tblCellMar><w:top w:w="${padY}" w:type="dxa"/><w:left w:w="${padX}" w:type="dxa"/><w:bottom w:w="${padY}" w:type="dxa"/><w:right w:w="${padX}" w:type="dxa"/></w:tblCellMar>` +
      `<w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/>` +
      `<w:tblCaption w:val="${TABLE_NAME} ${id}"/></w:tblPr>`;
    const grid = `<w:tblGrid>${tab.cols.map((w) => `<w:gridCol w:w="${twips(w)}"/>`).join('')}</w:tblGrid>`;
    const cellPara = (runs: TextRun[], paras: ParaStyle[] | undefined, jc: Justify, k = 1): string => {
      const n = paraCount(rt.plainText(runs));
      const ps = fitParas(paras, n);
      return splitParagraphs(runs).map((rs, i) => {
        const ppr = `<w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="0" w:firstLine="0"/><w:jc w:val="${JC[ps[i]?.align ?? jc]}"/></w:pPr>`;
        return `<w:p>${ppr}${rs.map((r) => tableRun(r, font, size * k)).join('')}</w:p>`;
      }).join('') || `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>`;
    };
    const rows: string[] = [];
    tab.rows.forEach((row, r) => {
      const cells: string[] = [];
      const lastHead = tab.head > 0 && r === tab.head - 1;
      for (let c = 0; c < tab.cols.length; c++) {
        if (isCovered(tab, r, c)) continue;
        const span = spanOf(tab, r, c);
        const w = tab.cols.slice(c, c + span).reduce((a, b) => a + b, 0);
        const cell = row[c] ?? { runs: [] };
        const tcBorders = tab.lines === 'acs' && lastHead && r < tab.rows.length - 1 ? `<w:tcBorders><w:bottom ${line}/></w:tcBorders>` : '';
        cells.push(`<w:tc><w:tcPr><w:tcW w:w="${twips(w)}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${tcBorders}</w:tcPr>` +
          `${cellPara(cell.runs, cell.paras, cellAlign(tab, r, c))}</w:tc>`);
      }
      rows.push(`<w:tr>${r < tab.head ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells.join('')}</w:tr>`);
    });
    const titlePara = tab.title?.length ? cellPara(tab.title, undefined, 'left') : '';
    const notesPara = tab.notes?.length ? cellPara(tab.notes, undefined, 'left', 0.8) : '';
    return `${titlePara}<w:tbl>${tblPr}${grid}${rows.join('')}</w:tbl>${notesPara}`;
  }

  // ---------------------------------------------------------------- page, header and footer

  private section(main: string): string {
    const t = this.t;
    const pg = t.page;
    const hf = t.hf;
    const refs: string[] = [];
    const add = (kind: 'header' | 'footer', type: 'default' | 'first', numbered: boolean) => {
      const xmlText = this.headerFooter(kind, numbered);
      if (!xmlText) return;
      const name = `${kind}${type === 'first' ? '2' : '1'}.xml`;
      this.pkg.add(`word/${name}`, xmlText, kind === 'header' ? DOCX_CT.header : DOCX_CT.footer);
      const rid = this.pkg.relate(main, kind === 'header' ? DOCX_REL.header : DOCX_REL.footer, name);
      refs.push(`<w:${kind}Reference w:type="${type}" r:id="${rid}"/>`);
    };
    add('header', 'default', true);
    add('footer', 'default', true);
    // a first page without its number (the header and footer text stay)
    const titlePg = hf.numbers !== 'none' && !hf.onFirst;
    if (titlePg) { add('header', 'first', false); add('footer', 'first', false); }
    // header references come before footer references
    refs.sort((a, b) => Number(b.startsWith('<w:header')) - Number(a.startsWith('<w:header')));
    const land = pg.w > pg.h;
    return `<w:sectPr>${refs.join('')}<w:pgSz w:w="${twips(pg.w)}" w:h="${twips(pg.h)}"${land ? ' w:orient="landscape"' : ''}/>` +
      `<w:pgMar w:top="${twips(pg.top)}" w:right="${twips(pg.right)}" w:bottom="${twips(pg.bottom)}" w:left="${twips(pg.left)}" w:header="${twips(pg.header)}" w:footer="${twips(pg.footer)}" w:gutter="0"/>` +
      `<w:pgNumType w:start="${Math.round(hf.start)}"/><w:cols w:space="720"/>${titlePg ? '<w:titlePg/>' : ''}<w:docGrid w:linePitch="360"/></w:sectPr>`;
  }

  /** A header or footer part: its left, centre and right text on one line (with tab stops), and the page number. Null when empty. */
  private headerFooter(kind: 'header' | 'footer', numbered: boolean): string | null {
    const t = this.t;
    const hf = t.hf;
    const zones = hf[kind];
    const place = hf.numbers === 'none' || !numbered ? null : hf.numbers;
    const at = place && place.startsWith(kind) ? ['left', 'center', 'right'].indexOf(place.split('-')[1]) : -1;
    if (!zones.some((z) => z) && at < 0) return null;
    const normal = styleOf(t, undefined);
    const size = Math.min(10, normal.size);
    const rPr = `<w:rFonts w:ascii="${xml(normal.font)}" w:hAnsi="${xml(normal.font)}" w:cs="${xml(normal.font)}"/><w:sz w:val="${half(size)}"/><w:szCs w:val="${half(size)}"/>`;
    const parts: string[] = [];
    for (let i = 0; i < 3; i++) {
      if (i > 0) parts.push(`<w:r><w:rPr>${rPr}</w:rPr><w:tab/></w:r>`);
      const text = zones[i] ?? '';
      if (text) parts.push(run(rPr, text));
      if (i === at) {
        const lead = (text ? ' ' : '') + hf.prefix;
        if (lead) parts.push(run(rPr, lead));
        parts.push(field(rPr, ' PAGE \\* CHARFORMAT ', String(hf.start)));
      }
    }
    // drop the tabs after the last zone with something in it
    while (parts.length && parts[parts.length - 1].includes('<w:tab/>')) parts.pop();
    const pPr = `<w:pPr><w:tabs><w:tab w:val="center" w:pos="${twips(this.textW / 2)}"/><w:tab w:val="right" w:pos="${twips(this.textW)}"/></w:tabs>` +
      `<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="0" w:firstLine="0"/><w:jc w:val="left"/></w:pPr>`;
    return `${HEAD}<w:${kind === 'header' ? 'hdr' : 'ftr'} xmlns:w="${W_NS}" xmlns:r="${NS.r}"><w:p>${pPr}${parts.join('')}</w:p></w:${kind === 'header' ? 'hdr' : 'ftr'}>`;
  }

  // ---------------------------------------------------------------- styles and lists

  private styles(): string {
    const t = this.t;
    const normal = styleOf(t, undefined);
    const out: string[] = [HEAD, `<w:styles xmlns:w="${W_NS}">`];
    out.push(`<w:docDefaults><w:rPrDefault><w:rPr>${fontsXml(normal.font)}<w:sz w:val="${half(normal.size)}"/><w:szCs w:val="${half(normal.size)}"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>` +
      `<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`);
    const ids = Object.keys(t.styles);
    for (const id of ['Normal', ...ids.filter((k) => k !== 'Normal')]) {
      const s = t.styles[id];
      if (s) out.push(styleXml(s, ids));
    }
    out.push(`<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>`);
    // formulas look like any other text in Word: the style only marks them, so they stay formulas when opened here
    out.push(`<w:style w:type="character" w:customStyle="1" w:styleId="${FORMULA_STYLE}"><w:name w:val="Chemical Formula"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="1"/></w:style>`);
    out.push(`<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>` +
      `<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>`);
    out.push(`<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>`);
    out.push('</w:styles>');
    return out.join('');
  }

  /** Bullets and numbers at nine levels; each numbered list its own Word list, so each starts at 1. */
  private numbering(): string {
    const normal = styleOf(this.t, undefined);
    const em = normal.size;
    const lvls = (bullet: boolean) => Array.from({ length: 9 }, (_, i) => {
      const { left, hang } = listIndent({ list: bullet ? 'bullet' : 'number', level: i }, em);
      const fmt = bullet ? 'bullet' : ['decimal', 'lowerLetter', 'lowerRoman'][i % 3];
      const text = bullet ? ['•', '–', '•', '–', '»'][i % 5] : `%${i + 1}.`;
      return `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/>` +
        `<w:pPr><w:ind w:left="${twips(left)}" w:hanging="${twips(hang)}"/></w:pPr><w:rPr>${fontsXml(normal.font)}<w:b w:val="0"/><w:i w:val="0"/></w:rPr></w:lvl>`;
    }).join('');
    const out = [HEAD, `<w:numbering xmlns:w="${W_NS}">`,
      `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(true)}</w:abstractNum>`,
      `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(false)}</w:abstractNum>`,
      `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`];
    for (let k = 0; k <= this.numberedLists; k++) {
      out.push(`<w:num w:numId="${k + 2}"><w:abstractNumId w:val="1"/>${Array.from({ length: 9 }, (_, i) => `<w:lvlOverride w:ilvl="${i}"><w:startOverride w:val="1"/></w:lvlOverride>`).join('')}</w:num>`);
    }
    out.push('</w:numbering>');
    return out.join('');
  }
}

// ---------------------------------------------------------------- pieces

/** A table drawing's table, when the drawing is just one table. */
export function soleTable(c: Contents): TableData | null {
  if (c.atoms.length || c.bonds.length || c.captions.length || c.arrows.length || c.shapes.length !== 1) return null;
  const s = c.shapes[0];
  return s.kind === 'table' && s.table ? s.table : null;
}

/** A table's text, cell by cell (to tell whether Word changed it). */
export function tableText(t: TableData): string {
  return t.rows.map((row) => row.map((c) => rt.plainText(c.runs)).join('\t')).join('\n');
}

/** Where a list item's text starts, and how far its bullet or number hangs out, as laid out here. */
export function listIndent(ps: ParaStyle, em: number): { left: number; hang: number } {
  const level = Math.max(0, Math.min(8, ps.level ?? 0));
  const markLeft = (ps.indent ?? 0) + level * 1.6 * em;
  const hang = (ps.list === 'number' ? 1.6 : 1.1) * em;
  return { left: markLeft + hang, hang };
}

const half = (pt: number): number => Math.max(2, Math.round(pt * 2));

function fontsXml(font: string): string {
  const f = xml(font);
  return `<w:rFonts w:ascii="${f}" w:eastAsia="${f}" w:hAnsi="${f}" w:cs="${f}"/>`;
}

/** A run's formatting where it differs from its paragraph's style. */
function runProps(r: TextRun, st: NamedStyle, x: { formula?: boolean; pos?: 'base' | 'sub' | 'sup' }): string {
  const out: string[] = [];
  if (x.formula) out.push(`<w:rStyle w:val="${FORMULA_STYLE}"/>`);
  const font = r.font ?? st.font;
  if (font !== st.font) out.push(fontsXml(font));
  if (!!r.bold !== st.bold) out.push(r.bold ? '<w:b/><w:bCs/>' : '<w:b w:val="0"/><w:bCs w:val="0"/>');
  if (!!r.italic !== st.italic) out.push(r.italic ? '<w:i/><w:iCs/>' : '<w:i w:val="0"/><w:iCs w:val="0"/>');
  const color = r.color ?? st.color;
  if ((color ?? '') !== (st.color ?? '')) out.push(`<w:color w:val="${color ? hex6(color) : 'auto'}"/>`);
  const size = r.size ?? st.size;
  if (size !== st.size) out.push(`<w:sz w:val="${half(size)}"/><w:szCs w:val="${half(size)}"/>`);
  if (r.underline) out.push('<w:u w:val="single"/>');
  const pos = x.pos ?? (r.sub ? 'sub' : r.sup ? 'sup' : 'base');
  if (pos !== 'base') out.push(`<w:vertAlign w:val="${pos === 'sub' ? 'subscript' : 'superscript'}"/>`);
  return out.join('');
}

/** A table cell's run: its font and size always given (tables are set in the drawing's font). */
function tableRun(r: TextRun, font: string, size: number): string {
  const parts: string[] = [fontsXml(r.font ?? font)];
  if (r.bold) parts.push('<w:b/><w:bCs/>');
  if (r.italic) parts.push('<w:i/><w:iCs/>');
  if (r.color) parts.push(`<w:color w:val="${hex6(r.color)}"/>`);
  const s = r.size ?? size;
  parts.push(`<w:sz w:val="${half(s)}"/><w:szCs w:val="${half(s)}"/>`);
  if (r.underline) parts.push('<w:u w:val="single"/>');
  if (r.formula && !r.sub && !r.sup) {
    return rt.formulaParts(r.text).map((p) => run(`<w:rStyle w:val="${FORMULA_STYLE}"/>${parts.join('')}${p.pos !== 'base' ? `<w:vertAlign w:val="${p.pos === 'sub' ? 'subscript' : 'superscript'}"/>` : ''}`, p.text)).join('');
  }
  if (r.sub || r.sup) parts.push(`<w:vertAlign w:val="${r.sub ? 'subscript' : 'superscript'}"/>`);
  return run(parts.join(''), r.text);
}

/**
 * A field (caption number, reference or page number) in Word's long form, its code in the same
 * font as its result: when Word updates it (F9, or printing) the result keeps that formatting
 * (CHARFORMAT), so a bold caption number stays bold and a reference doesn't take on the caption's bold.
 */
function field(rPr: string, instr: string, result: string): string {
  const pr = rPr ? `<w:rPr>${rPr}</w:rPr>` : '';
  return `<w:r>${pr}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${pr}<w:instrText xml:space="preserve">${instr}</w:instrText></w:r>` +
    `<w:r>${pr}<w:fldChar w:fldCharType="separate"/></w:r>${run(rPr, result)}<w:r>${pr}<w:fldChar w:fldCharType="end"/></w:r>`;
}

/** A run of text (tabs as Word's tabs). */
function run(rPr: string, text: string): string {
  if (!text) return '';
  const body = text.split('\t').map((s, i) => (i > 0 ? '<w:tab/>' : '') + (s ? `<w:t xml:space="preserve">${xml(s)}</w:t>` : '')).join('');
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${body}</w:r>`;
}

/** A named style, with all its settings written out. */
function styleXml(s: NamedStyle, ids: string[]): string {
  const id = s.id;
  const name = WORD_NAMES[id] ?? s.name;
  const head = id === 'Normal'
    ? `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/>`
    : `<w:style w:type="paragraph"${WORD_NAMES[id] ? '' : ' w:customStyle="1"'} w:styleId="${xml(id)}"><w:name w:val="${xml(name)}"/><w:basedOn w:val="Normal"/>` +
      `${s.next && ids.includes(s.next) ? `<w:next w:val="${xml(s.next)}"/>` : ''}<w:uiPriority w:val="${PRIORITY[id] ?? 29}"/><w:qFormat/>`;
  const pPr: string[] = [];
  pPr.push(s.keepNext ? '<w:keepNext/>' : '<w:keepNext w:val="0"/>');
  pPr.push('<w:widowControl/>');
  pPr.push(`<w:spacing w:before="${twips(s.spaceBefore)}" w:after="${twips(s.spaceAfter)}" w:line="${Math.round(240 * s.line)}" w:lineRule="auto"/>`);
  pPr.push(`<w:ind w:left="${twips(s.indent)}" ${s.firstLine < 0 ? `w:hanging="${twips(-s.firstLine)}"` : `w:firstLine="${twips(s.firstLine)}"`}/>`);
  pPr.push(`<w:jc w:val="${JC[s.align]}"/>`);
  if (s.outline) pPr.push(`<w:outlineLvl w:val="${s.outline - 1}"/>`);
  const rPr = `${fontsXml(s.font)}${s.bold ? '<w:b/><w:bCs/>' : '<w:b w:val="0"/><w:bCs w:val="0"/>'}${s.italic ? '<w:i/><w:iCs/>' : '<w:i w:val="0"/><w:iCs w:val="0"/>'}` +
    `<w:color w:val="${s.color ? hex6(s.color) : 'auto'}"/><w:sz w:val="${half(s.size)}"/><w:szCs w:val="${half(s.size)}"/>`;
  return `${head}<w:pPr>${pPr.join('')}</w:pPr><w:rPr>${rPr}</w:rPr></w:style>`;
}
