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
import { Package, REL, NS, xml, hex6, emu, MediaFiles, structureAltText } from './ooxml';
import { facesToEmbed, newGuid, obfuscate, type FontSource } from './font-embed';
import { fromDataUrl } from '../render/images';
import { fitParas, listMarkers, paraCount, splitParagraphs } from '../text/paragraphs';
import { BOX_PAD, COL_GAP, COMPOUND, FLOAT_GAP, columnsOf, OBJECT_CHAR, SHADOWS, fieldTexts, floatOf, lookExtent, lookOf, pruneObjects, styleOf, runStyleOf, type DocObject, type DocText, type FigureLook, type NamedStyle, type PageSetup } from '../document/document';
import { ACS_LINE, CELL_PAD, GRID_LINE, bibHang, docCellAlign, shownSize } from '../document/doc-layout';
import { bibliography, piecesText } from '../document/references';
import { TOC_INDENT, tocEntries } from '../document/toc';
import { parseRev } from '../document/revisions';
import { cmtIds, initials, placedComments, type CommentThread } from '../document/comments';
import { toOmml } from '../document/math';
import { documentMeasure } from '../text/font-measure';
import { arialWidth } from '../text-metrics';
import { PAD_X, PAD_Y, cellAlign, isCovered, spanOf } from '../table';
import {
  BIB_MARK, CITE_FIELD, DOCX_CT, W14_NS, W15_NS, DOCX_REL, DRAWING_NAME, FORMULA_STYLE, MODEL_NS, MC_NS, M_NS, PIC_NS, TABLE_NAME, W_NS, WORD_HIGHLIGHTS, WP_NS, WPS_NS, twips, type DocxModel,
} from './docx';

export interface DocxDeps {
  /** A drawing's picture for Word: PNG bytes, an SVG Word shows instead when it can, and its own size in points. */
  picture(contents: Contents, style: DocStyle): Promise<{ png: Uint8Array; svg?: string; w: number; h: number } | null>;
  /** A PNG of an SVG picture, for Word versions that can't show SVG (w × h pixels). */
  svgToPng?(svg: string, w: number, h: number): Promise<Uint8Array>;
  /** A drawing's structures as SMILES, for the picture's alt text (null when there are none, or no chemistry engine). */
  smiles?(contents: Contents, style: DocStyle): Promise<string | null>;
  /** The free fonts that come with the app, to put inside the file when the document uses them. */
  fonts?: FontSource;
  /** Each paragraph's page number as laid out here, for the contents (without it Word works them out when the file opens). */
  pages?(t: DocText): string[] | undefined;
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
  return new DocxWriter(pruneObjects(t), deps, deps.pages?.(t)).write(title);
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
  private fullW: number;
  /** The comments to write (those on some text), with the Word ids of each one's replies. */
  private cmts = new Map<number, { c: CommentThread; replies: number[] }>();
  /** How much of each comment's text is still to be written (its range closes when none is left). */
  private cmtLeft = new Map<number, number>();
  private cmtOpen = new Set<number>();

  constructor(private t: DocText, private deps: DocxDeps, private pages?: string[]) {
    this.shown = fieldTexts(t);
    for (const o of Object.values(t.objects)) {
      if (o.kind === 'ref' && t.objects[o.target]?.kind === 'seq') this.bookmarks.set(o.target, `_Ref${100000000 + o.target}`);
    }
    this.model = { app: 'Chem Illustrator', version: 1, drawingStyle: t.drawingStyle, drawings: {}, tables: {} };
    // (kept even when empty while citations are in the text, so they open again as citations)
    if (t.references?.length || Object.values(t.objects).some((o) => o.kind === 'cite' || o.kind === 'bib')) this.model.references = t.references ?? [];
    if (t.citeStyle) this.model.citeStyle = t.citeStyle;
    if (t.citeOptions && Object.keys(t.citeOptions).length) this.model.citeOptions = t.citeOptions;
    this.fullW = Math.max(36, t.page.w - t.page.left - t.page.right);
    // figures are made to fit a column's width
    this.textW = columnsOf(t.page, this.fullW).w;
    // comments: replies are comments of their own in Word, numbered after the others
    const placed = placedComments(t.runs, t.comments);
    let next = Math.max(-1, ...placed.map((p) => p.id)) + 1;
    for (const p of placed) this.cmts.set(p.id, { c: p.c, replies: (p.c.replies ?? []).map(() => next++) });
    for (const r of t.runs) {
      const n = r.text.replace(/\n/g, '').length;
      for (const id of cmtIds(r.cmt)) if (this.cmts.has(id)) this.cmtLeft.set(id, (this.cmtLeft.get(id) ?? 0) + n);
    }
  }

  async write(title: string): Promise<Uint8Array> {
    const pkg = this.pkg;
    for (const [ext, type] of Object.entries(EXT_TYPE)) pkg.defaultType(ext, type);
    const main = 'word/document.xml';
    const body = await this.body(main);
    const sect = this.section(main);
    pkg.add(main, `${HEAD}<w:document xmlns:w="${W_NS}" xmlns:r="${NS.r}" xmlns:wp="${WP_NS}" xmlns:a="${NS.a}" xmlns:pic="${PIC_NS}" xmlns:wps="${WPS_NS}" xmlns:mc="${MC_NS}" xmlns:m="${M_NS}"><w:body>${body}${sect}</w:body></w:document>`, DOCX_CT.document);
    pkg.relate(main, DOCX_REL.styles, 'styles.xml');
    pkg.add('word/styles.xml', this.styles(), DOCX_CT.styles);
    if (this.cmts.size) this.commentParts(main);
    pkg.relate(main, DOCX_REL.numbering, 'numbering.xml');
    pkg.add('word/numbering.xml', this.numbering(), DOCX_CT.numbering);
    pkg.relate(main, DOCX_REL.settings, 'settings.xml');
    const settings = (embed: boolean) => `${HEAD}<w:settings xmlns:w="${W_NS}"><w:zoom w:percent="100"/>${embed ? '<w:embedTrueTypeFonts/><w:saveSubsetFonts/>' : ''}${this.t.track ? '<w:trackRevisions/>' : ''}<w:defaultTabStop w:val="720"/>` +
      `<w:characterSpacingControl w:val="doNotCompress"/>` +
      `<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
    pkg.add('word/settings.xml', settings(false), DOCX_CT.settings);
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
    // the free fonts the document uses go inside it, so it looks the same where they aren't installed
    const embed = await facesToEmbed(pkg.xmlTexts(), this.deps.fonts);
    if (embed.length) {
      const FT = 'word/fontTable.xml';
      pkg.relate(main, DOCX_REL.fontTable, 'fontTable.xml');
      let n = 0;
      const fonts = embed.map(({ family, faces }) => {
        const parts = faces.map((f) => {
          const key = newGuid();
          const name = `fonts/font${++n}.odttf`;
          pkg.add(`word/${name}`, obfuscate(f.data, key), DOCX_CT.font);
          const id = pkg.relate(FT, DOCX_REL.font, name);
          const tag = f.bold ? (f.italic ? 'embedBoldItalic' : 'embedBold') : f.italic ? 'embedItalic' : 'embedRegular';
          return { tag, xml: `<w:${tag} r:id="${id}" w:fontKey="${key}"/>` };
        });
        const order = ['embedRegular', 'embedBold', 'embedItalic', 'embedBoldItalic'];
        parts.sort((a, b) => order.indexOf(a.tag) - order.indexOf(b.tag));
        return `<w:font w:name="${xml(family)}"><w:charset w:val="00"/><w:family w:val="auto"/><w:pitch w:val="variable"/>${parts.map((p) => p.xml).join('')}</w:font>`;
      });
      pkg.add(FT, `${HEAD}<w:fonts xmlns:w="${W_NS}" xmlns:r="${NS.r}">${fonts.join('')}</w:fonts>`, DOCX_CT.fontTable);
      pkg.add('word/settings.xml', settings(true), DOCX_CT.settings);
    }
    return pkg.build();
  }

  // ---------------------------------------------------------------- the text

  private async body(main: string): Promise<string> {
    const t = this.t;
    const n = paraCount(rt.plainText(t.runs));
    const paras = fitParas(t.paras, n);
    const runsOf = splitParagraphs(t.runs);
    const markers = listMarkers(paras);
    // tracked changes on the paragraph marks (a line break typed or deleted while tracking)
    const markRev: (string | undefined)[] = [];
    for (const r of t.runs) for (const ch of r.text) if (ch === '\n') markRev.push(r.rev);
    this.markRev = markRev;
    const out: string[] = [];
    let lastWasTable = false;
    let listNum = 0;
    for (let p = 0; p < n; p++) {
      const runs = runsOf[p] ?? [];
      const ps = paras[p];
      // a paragraph holding just a table: Word's own table
      const only = runs.length === 1 && runs[0].obj !== undefined && runs[0].text === OBJECT_CHAR ? t.objects[runs[0].obj] : undefined;
      if (only?.kind === 'table') {
        if (lastWasTable) out.push('<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>');
        out.push(await this.docTable(main, only.table, ps.align ?? styleOf(t, ps).align));
        lastWasTable = true;
        continue;
      }
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
      const isBib = (r: TextRun) => r.obj !== undefined && (t.objects[r.obj]?.kind === 'bib' || t.objects[r.obj]?.kind === 'toc');
      if (runs.some(isBib)) {
        let part: TextRun[] = [];
        for (const r of runs) {
          if (!isBib(r)) { part.push(r); continue; }
          if (part.some((x) => x.text)) out.push(await this.paragraph(main, ps, part, listNum));
          part = [];
          const o = t.objects[r.obj!];
          out.push(o?.kind === 'toc' ? this.contents(o.levels, ps) : this.bibliography(r.obj!, ps));
        }
        if (part.some((x) => x.text)) out.push(await this.paragraph(main, ps, part, listNum));
      } else out.push(await this.paragraph(main, ps, runs, listNum, p));
      lastWasTable = false;
    }
    // comments still open (on a table, say) close in a paragraph of their own
    const left = [...this.cmtOpen].map((id) => this.cmtEnd(id)).join('');
    if (left) { out.push(`<w:p>${left}</w:p>`); lastWasTable = false; }
    // Word ends the text with a paragraph
    if (lastWasTable || !out.length) out.push('<w:p/>');
    return out.join('');
  }

  /** Each paragraph mark's tracked change, if any. */
  private markRev: (string | undefined)[] = [];
  // tracked changes count apart from the bookmarks (Word wants each id used once)
  private revId = 10001;

  /** A tracked change's attributes for Word. */
  private revAttrs(rev: string): string {
    const v = parseRev(rev)!;
    return `w:id="${this.revId++}" w:author="${xml(v.author || 'Author')}"${v.date ? ` w:date="${xml(v.date)}"` : ''}`;
  }

  /** A run's Word XML inside its tracked change (deleted text is Word's w:delText). */
  private tracked(rev: string | undefined, body: string): string {
    const v = parseRev(rev);
    if (!v || !body) return body;
    if (v.kind === 'ins') return `<w:ins ${this.revAttrs(rev!)}>${body}</w:ins>`;
    const del = body.replace(/<w:t( [^>]*)?>/g, '<w:delText$1>').replace(/<\/w:t>/g, '</w:delText>')
      .replace(/<w:instrText( [^>]*)?>/g, '<w:delInstrText$1>').replace(/<\/w:instrText>/g, '</w:delInstrText>');
    return `<w:del ${this.revAttrs(rev!)}>${del}</w:del>`;
  }

  // ---------------------------------------------------------------- comments

  /** Where comments begin at a run: Word's comment range starts (the replies' with their comment's). */
  private cmtBefore(r: TextRun): string {
    let out = '';
    for (const id of cmtIds(r.cmt)) {
      const w = this.cmts.get(id);
      if (!w || this.cmtOpen.has(id) || !this.cmtLeft.get(id)) continue;
      this.cmtOpen.add(id);
      for (const x of [id, ...w.replies]) out += `<w:commentRangeStart w:id="${x}"/>`;
    }
    return out;
  }

  /** After a run: the ends of the comments whose last text it was, each with its mark in the text. */
  private cmtAfter(r: TextRun): string {
    let out = '';
    const n = r.text.replace(/\n/g, '').length;
    for (const id of cmtIds(r.cmt)) {
      if (!this.cmts.has(id)) continue;
      const left = (this.cmtLeft.get(id) ?? 0) - n;
      this.cmtLeft.set(id, left);
      if (left <= 0 && this.cmtOpen.has(id)) out += this.cmtEnd(id);
    }
    return out;
  }

  private cmtEnd(id: number): string {
    this.cmtOpen.delete(id);
    return [id, ...this.cmts.get(id)!.replies].map((x) => `<w:commentRangeEnd w:id="${x}"/><w:r><w:commentReference w:id="${x}"/></w:r>`).join('');
  }

  /**
   * Word's comments part, and Word 2013's part linking replies to their comment and marking the
   * resolved ones (by the id of each comment's last paragraph).
   */
  private commentParts(main: string): void {
    let para = 0x10000000;
    const notes: string[] = [], ex: string[] = [];
    const note = (id: number, c: { author: string; date: string; text: string }, parent: string | null, done: boolean): string => {
      const lines = c.text.split('\n');
      const ids = lines.map(() => (para++).toString(16).toUpperCase());
      const ps = lines.map((line, i) => `<w:p w14:paraId="${ids[i]}" w14:textId="77777777">${i === 0 ? '<w:r><w:annotationRef/></w:r>' : ''}${run('', line)}</w:p>`);
      const last = ids[ids.length - 1];
      const date = c.date ? ` w:date="${xml(c.date.replace(/\.\d+Z$/, 'Z'))}"` : '';
      notes.push(`<w:comment w:id="${id}" w:author="${xml(c.author || 'Author')}"${date} w:initials="${xml(initials(c.author) || 'A')}">${ps.join('')}</w:comment>`);
      ex.push(`<w15:commentEx w15:paraId="${last}"${parent ? ` w15:paraIdParent="${parent}"` : ''} w15:done="${done ? 1 : 0}"/>`);
      return last;
    };
    for (const [id, { c, replies }] of this.cmts) {
      const top = note(id, c, null, !!c.done);
      (c.replies ?? []).forEach((r, i) => note(replies[i], r, top, !!c.done));
    }
    this.pkg.relate(main, DOCX_REL.comments, 'comments.xml');
    this.pkg.add('word/comments.xml', `${HEAD}<w:comments xmlns:w="${W_NS}" xmlns:w14="${W14_NS}">${notes.join('')}</w:comments>`, DOCX_CT.comments);
    this.pkg.relate(main, DOCX_REL.commentsExtended, 'commentsExtended.xml');
    this.pkg.add('word/commentsExtended.xml', `${HEAD}<w15:commentsEx xmlns:w15="${W15_NS}" xmlns:mc="${MC_NS}">${ex.join('')}</w15:commentsEx>`, DOCX_CT.commentsExtended);
  }

  private async paragraph(main: string, ps: ParaStyle, runs: TextRun[], listNum: number, index = -1): Promise<string> {
    const t = this.t;
    const st = styleOf(t, ps);
    const pPr: string[] = [];
    if (st.id !== 'Normal') pPr.push(`<w:pStyle w:val="${xml(st.id)}"/>`);
    if (!!ps.keepNext !== st.keepNext) pPr.push(ps.keepNext ? '<w:keepNext/>' : '<w:keepNext w:val="0"/>');
    if (ps.pageBreak) pPr.push('<w:pageBreakBefore/>');
    // Word has no "start a new column" for a paragraph: a column break begins it
    const colBreak = ps.colBreak ? '<w:r><w:br w:type="column"/></w:r>' : '';
    const em = runs.find((r) => r.obj === undefined)?.size ?? st.size;
    if (ps.list && !ps.cont) {
      const id = ps.list === 'bullet' ? 1 : Math.max(2, listNum);
      pPr.push(`<w:numPr><w:ilvl w:val="${Math.max(0, Math.min(8, ps.level ?? 0))}"/><w:numId w:val="${id}"/></w:numPr>`);
    }
    const sp: string[] = [];
    const before = ps.spaceBefore ?? 0, after = ps.spaceAfter ?? 0, line = ps.line ?? 1;
    if (before !== st.spaceBefore) sp.push(`w:before="${twips(before)}"`);
    if (after !== st.spaceAfter) sp.push(`w:after="${twips(after)}"`);
    if (ps.linePt && ps.linePt > 0) sp.push(`w:line="${twips(ps.linePt)}" w:lineRule="${ps.lineRule === 'exact' ? 'exact' : 'atLeast'}"`);
    else if (line !== st.line) sp.push(`w:line="${Math.round(240 * line)}" w:lineRule="auto"`);
    if (sp.length) pPr.push(`<w:spacing ${sp.join(' ')}/>`);
    // indents: list items hang their bullet or number, as laid out here
    const indent = ps.indent ?? 0;
    const right = ps.indentRight ? ` w:right="${twips(ps.indentRight)}"` : '';
    if (ps.list) {
      const { left, hang } = listIndent(ps, em);
      pPr.push(`<w:ind w:left="${twips(left)}"${right} ${ps.cont ? 'w:firstLine="0"' : `w:hanging="${twips(hang)}"`}/>`);
    } else {
      const first = ps.firstLine ?? 0;
      if (indent !== st.indent || first !== st.firstLine || right) pPr.push(`<w:ind w:left="${twips(indent)}"${right} ${first < 0 ? `w:hanging="${twips(-first)}"` : `w:firstLine="${twips(first)}"`}/>`);
    }
    const align = ps.align ?? 'left';
    if (align !== st.align) pPr.push(`<w:jc w:val="${JC[align]}"/>`);
    // the paragraph mark itself inserted or deleted while tracking
    const mr = parseRev(index >= 0 ? this.markRev[index] : undefined);
    if (mr) pPr.push(`<w:rPr><w:${mr.kind} ${this.revAttrs(this.markRev[index]!)}/></w:rPr>`);

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
    // an equation on its own in its paragraph is a display equation (Word's equation paragraph)
    const shownRuns = runs.filter((r) => r.obj !== undefined || r.text.trim());
    const display = shownRuns.length === 1 && shownRuns[0].obj !== undefined && this.t.objects[shownRuns[0].obj]?.kind === 'math';
    for (const r of runs) {
      out.push(this.cmtBefore(r));
      if (r.obj === undefined) { out.push(this.tracked(r.rev, this.textRuns(r, st)), this.cmtAfter(r)); continue; }
      const o = this.t.objects[r.obj];
      if (o?.kind === 'math') {
        const m = `<m:oMath>${toOmml(o.tex)}</m:oMath>`;
        out.push(display ? `<m:oMathPara>${m}</m:oMathPara>` : m, this.cmtAfter(r));
        continue;
      }
      const mark = this.bookmarks.has(r.obj) && isCompound(r.obj) ? this.bookmarkId++ : null;
      if (mark !== null) out.push(`<w:bookmarkStart w:id="${mark}" w:name="${this.bookmarks.get(r.obj)}"/>`);
      out.push(this.tracked(r.rev, await this.objectRun(main, r, st)));
      if (mark !== null) out.push(`<w:bookmarkEnd w:id="${mark}"/>`);
      if (open && r.obj === open.seq) { out.push(`<w:bookmarkEnd w:id="${open.id}"/>`); open = null; }
      out.push(this.cmtAfter(r));
    }
    return `<w:p>${pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''}${colBreak}${out.join('')}</w:p>`;
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

  /**
   * A table of contents as Word's own TOC field: Word shows the headings and page numbers as
   * written here, and works them out again with Update Field. Without page numbers from the
   * layout here, the field is marked for Word to update when the file is opened.
   */
  private contents(levels: number, ps: ParaStyle): string {
    const t = this.t;
    const entries = tocEntries(t, levels);
    const pages = this.pages;
    const st = styleOf(t, undefined);
    const textW = Math.max(36, t.page.w - t.page.left - t.page.right);
    const dirty = pages ? '' : ' w:dirty="true"';
    const begin = `<w:r><w:fldChar w:fldCharType="begin"${dirty}/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-${levels}" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
    const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const line = ps.line && ps.line !== 1 ? ` w:line="${Math.round(240 * ps.line)}" w:lineRule="auto"` : '';
    const paras = entries.map((e, i) => {
      const pPr = `<w:pPr><w:pStyle w:val="TOC${e.level}"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${twips(textW)}"/></w:tabs>` +
        `<w:spacing w:before="${e.level === 1 && i > 0 ? twips(0.25 * st.size) : 0}" w:after="0"${line}/><w:ind w:left="${twips((e.level - 1) * TOC_INDENT)}"/></w:pPr>`;
      return `<w:p>${pPr}${i === 0 ? begin : ''}${run('', e.text)}${run('', `\t${pages?.[e.para] ?? ''}`)}${i === entries.length - 1 ? end : ''}</w:p>`;
    });
    // no headings yet: the field with nothing in it, for Word to fill in
    if (!paras.length) paras.push(`<w:p>${begin}${end}</w:p>`);
    return paras.join('');
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
    if (o.kind === 'bib' || o.kind === 'toc' || o.kind === 'math') return '';
    if (o.kind === 'textbox') return this.textBox(main, id, o, rPr);
    return this.picture(main, id, o, rPr);
  }

  /**
   * A drawing's frame in the text: in the line (wp:inline), or placed on the page with the text
   * wrapping round it (wp:anchor), its place measured from the margin, page or paragraph.
   */
  private placed(o: DocObject, cx: number, cy: number, inner: string): string {
    const [el, et, er, eb] = lookExtent(lookOf(o)).map(emu);
    const ext = `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="${el}" t="${et}" r="${er}" b="${eb}"/>`;
    const fl = floatOf(o);
    if (!fl) return `<wp:inline distT="0" distB="0" distL="0" distR="0">${ext}${inner}</wp:inline>`;
    const gap = emu(fl.gap ?? FLOAT_GAP);
    const [l, t] = lookExtent(lookOf(o));
    const h = fl.xFrom === 'page' ? 'page' : 'margin';
    const v = fl.yFrom === 'page' ? 'page' : fl.yFrom === 'margin' ? 'margin' : 'paragraph';
    const wrap = fl.wrap === 'square' ? '<wp:wrapSquare wrapText="largest"/>' : fl.wrap === 'topBottom' ? '<wp:wrapTopAndBottom/>' : '<wp:wrapNone/>';
    return `<wp:anchor distT="${gap}" distB="${gap}" distL="${gap}" distR="${gap}" simplePos="0" relativeHeight="${251659264 + this.docPr * 1024}" behindDoc="${fl.wrap === 'behind' ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="1">` +
      `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="${h}"><wp:posOffset>${emu(fl.x + l)}</wp:posOffset></wp:positionH>` +
      `<wp:positionV relativeFrom="${v}"><wp:posOffset>${emu(fl.y + t)}</wp:posOffset></wp:positionV>${ext}${wrap}${inner}</wp:anchor>`;
  }

  /** A text box: Word's text box shape, with its paragraphs inside it (Word fits its height to them). */
  private async textBox(main: string, id: number, o: Extract<DocObject, { kind: 'textbox' }>, rPr: string): Promise<string> {
    const n = paraCount(rt.plainText(o.runs));
    const paras = fitParas(o.paras, n);
    const runsOf = splitParagraphs(o.runs);
    const ps: string[] = [];
    for (let p = 0; p < n; p++) ps.push(await this.paragraph(main, paras[p], runsOf[p] ?? [], 0));
    const N = styleOf(this.t, {});
    const lines = o.runs.reduce((a, r) => a + (r.text.match(/\n/g)?.length ?? 0), 1);
    const h = Math.max(o.h ?? 0, lines * N.size * 1.25 + 2 * BOX_PAD.y);
    const cx = emu(o.w), cy = emu(h);
    const k = this.docPr++;
    const look = lookOf(o);
    const fill = o.fill ? `<a:solidFill><a:srgbClr val="${hex6(o.fill)}"/></a:solidFill>` : '<a:noFill/>';
    // the look's own white fill (under a shadow) gives way to the box's fill
    const lookRest = lookXml(look).replace(/^<a:solidFill>.*?<\/a:solidFill>/, '');
    const line = look?.frame ? '' : '<a:ln><a:noFill/></a:ln>';
    const shape = `<wp:docPr id="${k}" name="Text Box ${id}"/><wp:cNvGraphicFramePr/>` +
      `<a:graphic><a:graphicData uri="${WPS_NS}"><wps:wsp><wps:cNvSpPr txBox="1"/>` +
      `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}${line}${lookRest}</wps:spPr>` +
      `<wps:txbx><w:txbxContent>${ps.join('') || '<w:p/>'}</w:txbxContent></wps:txbx>` +
      `<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="${emu(BOX_PAD.x)}" tIns="${emu(BOX_PAD.y)}" rIns="${emu(BOX_PAD.x)}" bIns="${emu(BOX_PAD.y)}" anchor="t" anchorCtr="0"><a:spAutoFit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic>`;
    return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>${this.placed(o, cx, cy, shape)}</w:drawing></mc:Choice><mc:Fallback/></mc:AlternateContent></w:r>`;
  }

  // ---------------------------------------------------------------- figures and pictures

  private async picture(main: string, id: number, o: DocObject, rPr: string): Promise<string> {
    const t = this.t;
    let blip: string, svgId: string | null = null, size: { w: number; h: number }, name: string, smiles: string | null = null;
    if (o.kind === 'drawing') {
      const pic = await this.deps.picture(o.contents, t.drawingStyle);
      if (!pic) return '';
      this.model.drawings[id] = { contents: o.contents, w: pic.w, h: pic.h };
      blip = this.media(main, pic.png, 'png');
      if (pic.svg) svgId = this.media(main, new TextEncoder().encode(pic.svg), 'svg');
      size = shownSize({ w: pic.w, h: pic.h }, o.scale ?? 1, this.textW);
      name = `${DRAWING_NAME} ${id}`;
      smiles = await this.deps.smiles?.(o.contents, t.drawingStyle).catch(() => null) ?? null;
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
    const descr = o.kind === 'drawing' ? ` descr="${xml(structureAltText(smiles))}"` : '';
    const look = lookOf(o);
    return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:drawing>` + this.placed(o, cx, cy,
      `<wp:docPr id="${n}" name="${xml(name)}"${descr}/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
      `<a:graphic><a:graphicData uri="${PIC_NS}"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${xml(name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${blip}">${ext}</a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${lookXml(look)}</pic:spPr></pic:pic></a:graphicData></a:graphic>`) + '</w:drawing></w:r>';
  }

  private mediaCount = 0;
  private mediaFiles = new MediaFiles();
  private media(from: string, bytes: Uint8Array, ext: string): string {
    let name = this.mediaFiles.find(bytes, ext);
    if (!name) {
      name = `media/image${++this.mediaCount}.${ext}`;
      this.pkg.add(`word/${name}`, bytes);
      this.mediaFiles.note(bytes, ext, name);
    }
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

  /**
   * A table typed into in the text, as a Word table: its cells' paragraphs written as the
   * text's are (structures and pictures in them too), its lines, shading and cell alignment.
   */
  private async docTable(main: string, tab: TableData, align: Justify): Promise<string> {
    const grid = `w:val="single" w:sz="${Math.round(GRID_LINE * 8)}" w:space="0" w:color="000000"`;
    const rule = `w:val="single" w:sz="${Math.round(ACS_LINE * 8)}" w:space="0" w:color="000000"`;
    const none = 'w:val="nil"';
    const borders = tab.lines === 'grid'
      ? `<w:top ${grid}/><w:left ${grid}/><w:bottom ${grid}/><w:right ${grid}/><w:insideH ${grid}/><w:insideV ${grid}/>`
      : tab.lines === 'acs' ? `<w:top ${rule}/><w:left ${none}/><w:bottom ${rule}/><w:right ${none}/><w:insideH ${none}/><w:insideV ${none}/>`
        : `<w:top ${none}/><w:left ${none}/><w:bottom ${none}/><w:right ${none}/><w:insideH ${none}/><w:insideV ${none}/>`;
    const width = tab.cols.reduce((a, b) => a + b, 0);
    const padX = twips(CELL_PAD.x), padY = twips(CELL_PAD.y);
    const tblPr = `<w:tblPr><w:tblW w:w="${twips(width)}" w:type="dxa"/><w:jc w:val="${align === 'right' ? 'right' : align === 'center' ? 'center' : 'left'}"/>` +
      `<w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/>` +
      `<w:tblCellMar><w:top w:w="${padY}" w:type="dxa"/><w:left w:w="${padX}" w:type="dxa"/><w:bottom w:w="${padY}" w:type="dxa"/><w:right w:w="${padX}" w:type="dxa"/></w:tblCellMar>` +
      `<w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr>`;
    const gridXml = `<w:tblGrid>${tab.cols.map((w) => `<w:gridCol w:w="${twips(w)}"/>`).join('')}</w:tblGrid>`;
    const rows: string[] = [];
    for (let r = 0; r < tab.rows.length; r++) {
      const row = tab.rows[r];
      const cells: string[] = [];
      const lastHead = tab.head > 0 && r === tab.head - 1 && r < tab.rows.length - 1;
      for (let c = 0; c < tab.cols.length; c++) {
        if (isCovered(tab, r, c)) continue;
        const span = spanOf(tab, r, c);
        const w = tab.cols.slice(c, c + span).reduce((a, b) => a + b, 0);
        const cell = row[c] ?? { runs: [] };
        const tcPr = [`<w:tcW w:w="${twips(w)}" w:type="dxa"/>`];
        if (span > 1) tcPr.push(`<w:gridSpan w:val="${span}"/>`);
        if (tab.lines === 'acs' && lastHead) tcPr.push(`<w:tcBorders><w:bottom ${grid}/></w:tcBorders>`);
        if (cell.fill) tcPr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hex6(cell.fill)}"/>`);
        if (cell.valign) tcPr.push(`<w:vAlign w:val="${cell.valign}"/>`);
        // the cell's paragraphs, set as the text is, lined up as the cell is
        const n = paraCount(rt.plainText(cell.runs));
        const ps = fitParas(cell.paras, n);
        const ca = docCellAlign(tab, r, c);
        const parts = splitParagraphs(cell.runs);
        const paras: string[] = [];
        for (let i = 0; i < n; i++) paras.push(await this.paragraph(main, { ...ps[i], align: ps[i]?.align ?? ca }, parts[i] ?? [], 0));
        cells.push(`<w:tc><w:tcPr>${tcPr.join('')}</w:tcPr>${paras.join('') || '<w:p/>'}</w:tc>`);
      }
      rows.push(`<w:tr>${r < tab.head ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells.join('')}</w:tr>`);
    }
    return `<w:tbl>${tblPr}${gridXml}${rows.join('')}</w:tbl>`;
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
      `<w:pgNumType w:start="${Math.round(hf.start)}"/>${colsXml(pg)}${titlePg ? '<w:titlePg/>' : ''}<w:docGrid w:linePitch="360"/></w:sectPr>`;
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
    const pPr = `<w:pPr><w:tabs><w:tab w:val="center" w:pos="${twips(this.fullW / 2)}"/><w:tab w:val="right" w:pos="${twips(this.fullW)}"/></w:tabs>` +
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
    // the contents' lines (Word's own "toc 1" to "toc 3", which Update Field uses)
    if (Object.values(t.objects).some((o) => o.kind === 'toc')) {
      for (let n = 1; n <= 3; n++) out.push(`<w:style w:type="paragraph" w:styleId="TOC${n}"><w:name w:val="toc ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0"/><w:ind w:left="${twips((n - 1) * TOC_INDENT)}"/><w:jc w:val="left"/></w:pPr></w:style>`);
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

/** The page's columns, as Word's section sets them. */
export function colsXml(pg: PageSetup): string {
  const n = Math.max(1, Math.min(4, Math.round(pg.cols ?? 1)));
  return n > 1 ? `<w:cols w:num="${n}" w:space="${twips(pg.colGap ?? COL_GAP)}"/>` : '<w:cols w:space="720"/>';
}

/** A figure's frame and shadow as a picture's shape properties (fill, line, effects, in that order). */
export function lookXml(look: FigureLook | undefined): string {
  if (!look) return '';
  let out = '';
  // a shadow is a box's, so the figure sits on white
  if (look.shadow) out += '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>';
  if (look.frame) out += `<a:ln w="${emu(look.frame)}"><a:solidFill><a:srgbClr val="${hex6(look.frameColor ?? '#000000')}"/></a:solidFill></a:ln>`;
  if (look.shadow) {
    const sh = SHADOWS[look.shadow];
    // down and to the right: 45° is 2,700,000 in sixty-thousandths of a degree
    out += `<a:effectLst><a:outerShdw blurRad="${emu(sh.blur)}" dist="${emu(sh.off * Math.SQRT2)}" dir="2700000" algn="tl" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="${Math.round(sh.alpha * 100000)}"/></a:srgbClr></a:outerShdw></a:effectLst>`;
  }
  return out;
}

/** Word's name for a highlighter colour, when it is one of Word's (others are written as shading). */
export function highlightName(color: string): string | null {
  const c = '#' + hex6(color).toLowerCase();
  for (const [name, v] of Object.entries(WORD_HIGHLIGHTS)) if (v === c) return name;
  return null;
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
  const hl = r.highlight ? highlightName(r.highlight) : null;
  if (hl) out.push(`<w:highlight w:val="${hl}"/>`);
  if (r.underline) out.push('<w:u w:val="single"/>');
  // any other colour behind the text goes as shading
  if (r.highlight && !hl) out.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hex6(r.highlight)}"/>`);
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

