// Opening Word files (.docx) as documents, from the published Office Open XML standard
// (ECMA-376 part 1, WordprocessingML).
//
// Files saved here come back as they were: each structure from the drawing kept with its
// picture, each table as made here (unless its text was changed in Word). Files from Word come
// in with their text and its formatting (worked out through the named styles, as Word does),
// lists, tables, pictures, captions and cross-references, page setup, header, footer and page
// numbers; ChemDraw objects in them become structures that can be edited here. What has no
// place here yet is noted in warnings (shown to the person, never refused). Citations and the
// bibliography saved here come back live (the references are in our own part), and so do
// Zotero's, Mendeley's and EndNote's (their items read into the references: live-cites.ts).
// Footnotes and endnotes come in as notes
// typed into here, and a table of figures (a TOC field for captions) as one worked out here.

import type { AuthorityMark, CellBorders, Contents, IndexMark, Justify, ParaBorders, ParaStyle, PictureFx, TabStop, TableCell, TableData, TextRun } from '../model';
import { parseIndex, parseTa, parseToa, parseXe } from '../document/index-toa';
import { ALG_SIDS, type ProtectKind, type Protection } from '../document/protect';
import { tidyFx } from '../render/picture-fx';
import { readPictureFx } from './picture-xml';
import { DEFAULT_MARGINS, builtInStyle, type TableStyleDef } from '../document/table-styles';
import { keepDirectBorders, readBorder, readBorders, readLook as readTableLook, readMargins, readTableStyle, sameStyle, styleIsRich } from './docx-table-styles';
import { cleanBorders } from '../document/para-borders';
import { ACS_1996, type DocStyle } from '../style';
import * as rt from '../richtext';
import { PackageReader, REL, kid, kids, rAttr, fromEmu } from './ooxml';
import { dataUrl, imageSize, pictureMime } from '../render/images';
import { drawingInEmf } from '../render/emf';
import { BULLETS, BULLET_LIBRARY, LIST_SCHEMES, cleanPara } from '../text/paragraphs';
import { SINGLE, type Measure } from '../text/layout';
import { arialWidth } from '../text-metrics';
import { documentMeasure } from '../text/font-measure';
import {
  OBJECT_CHAR, defaultCharStyles, defaultHeaderFooter, defaultPage, defaultStyles,
  COL_GAP, FLOAT_GAP, columnsOf, lookExtent, usedObjects,
  type BreakKind, type CharStyle, type DocObject, type DocText, type Embedded, type PageBorder, type Watermark, type FigureLook, type Float, type HeaderFooter, type LineNumbers, type NamedStyle, type NoteFormat, type NoteFormats, type NumberPlace, type PageNumFormat, type PageSetup, type SectionBreak,
} from '../document/document';
import { parseFieldInstr, type DocProps } from '../document/fields';
import { shownSize } from '../document/doc-layout';
import { coveringCell, layoutTable } from '../table';
import { cfbStreams, isCfb } from './cfb';
import { readEmbedded } from './ole-object';
import { isCdx } from './cdx';
import { cmtIds, cmtString, type CommentNote, type CommentThread } from '../document/comments';
import { BIB_MARK, CHART_NAME, CITE_FIELD, WORD_HIGHLIGHTS, DOCX_REL, W14_NS, W15_NS, W16CID_NS, W16CEX_NS, fromWordDate, DRAWING_NAME, FORMULA_STYLE, MODEL_NS, TABLE_NAME, W_NS, type DocxModel } from './docx';
import { cleanRef, type Reference } from '../document/references';
import { bibFieldApp, placeRef, readCiteField, readMendeleyTag, styleFromCsl, zoteroStyleOf, MANAGERS, type CiteLive, type CiteManager, type ManagerCite } from '../document/live-cites';
import { retypedDiagram } from '../design/diagrams';
import { revText } from '../document/revisions';
import { linkFromTarget } from '../links';
import { mathText, ommlToTex } from '../document/math';
import { CITE_PRESETS, cleanOptions } from '../document/cite-styles';
import { listIndent, tableText } from './docx-write';
import { readChart } from './office-chart';
import { freshBox, sameBoxData, sizedBox } from '../sheet/chart-box';
import { chartBoxPng } from '../render/chart-box-paint';
import { contentsAlt } from '../accessibility';

export interface DocxReadDeps {
  /** A ChemDraw drawing (CDX data) as a drawing in the document's style; null when it can't be read. */
  chemdraw?(cdx: Uint8Array, style: DocStyle): Contents | null;
  /** A drawing saved as CDXML (from inside a picture copied out of Chem Illustrator) in the document's style. */
  cdxml?(text: string, style: DocStyle): Contents | null;
  /** A drawing's own size in points (so it keeps the size it had in Word). */
  drawingSize?(contents: Contents, style: DocStyle): { w: number; h: number } | null;
  /** A table as a drawing, laid out with the fonts on screen (else with published font widths). */
  tableDrawing?(t: TableData, style: DocStyle): Contents;
}

/** Word's text font and size when a file gives none. */
const WORD_FONT = 'Times New Roman';
const WORD_SIZE = 10;
/** The standard styles, by the names Word gives them (in every language). */
const BUILT_IN: Record<string, string> = { normal: 'Normal', title: 'Title', caption: 'Caption', ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`heading ${n}`, `Heading${n}`])) };
const OUTLINE: Record<string, number> = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`Heading${n}`, n]));
/** Word's character styles that are part of how something works (not a look to keep as a style here; our formula style neither). */
const WORD_INNER_CHAR = new Set(['DefaultParagraphFont', 'FootnoteReference', 'EndnoteReference', 'Hyperlink', 'FollowedHyperlink', 'CommentReference', 'PageNumber', 'LineNumber', 'PlaceholderText']);
const TAB_KINDS: Record<string, TabStop['kind']> = { left: 'left', start: 'left', center: 'center', right: 'right', end: 'right', decimal: 'decimal' };
const TAB_LEADERS: Record<string, TabStop['leader']> = { dot: 'dot', middleDot: 'dot', hyphen: 'hyphen', underscore: 'underscore', heavy: 'underscore' };
/** Word's bullets written in symbol fonts (Symbol, Wingdings, Courier New's o), as the characters they show. */
const SYMBOL_BULLETS: Record<string, string> = { '\uf0b7': '•', '\uf0a7': '■', '\uf0d8': '➢', '\uf0fc': '✓', '\uf076': '◆', '\uf0a8': '◆', '\uf06f': '○', o: '○', '\uf0ab': '★', '\uf02d': '–' };
/** VML's named colours a watermark may use. */
const VML_COLOURS: Record<string, string> = { silver: '#c0c0c0', gray: '#808080', grey: '#808080', black: '#000000', white: '#ffffff', red: '#ff0000', blue: '#0000ff', green: '#008000', yellow: '#ffff00', navy: '#000080', maroon: '#800000', teal: '#008080', purple: '#800080', olive: '#808000', lime: '#00ff00', aqua: '#00ffff', fuchsia: '#ff00ff' };
const JUSTIFY: Record<string, Justify> = { left: 'left', start: 'left', center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' };
const EXT_MIME: Record<string, string> = { wmf: 'image/x-wmf', emf: 'image/x-emf', tif: 'image/tiff', tiff: 'image/tiff' };

const WARN = {
  links: 'Links were kept as plain text.',
  cellMarks: 'Index entries and marked citations inside table cells were left out.',
  notes: 'Footnotes and endnotes inside table cells were left out.',
  equations: 'Equations in table cells were kept as plain text.',
  shapes: 'SmartArt and drawn shapes were left out.',
  chartParts: 'Some charts mix chart types (a line over columns, a second axis): they show as one type.',
  vmerge: 'Table cells merged down a column were split (merging across a row is kept).',
  nested: 'A table inside a table cell was kept as text.',
  cellObjects: 'Pictures and structures inside table cells were left out.',
  cellBoxes: 'Text boxes inside table cells were left out.',
  wmf: 'Some pictures are in the older Windows Metafile (WMF) format, which can\'t be shown here yet. They are kept, and saved back to Word unchanged.',
  pictureFx: 'Some picture effects (artistic effects, saturation, colour temperature) were left off.',
  numbering: 'Some numbered lists use numbering that shows here as 1., a., i.',
  citations: 'Citations from a reference manager were kept as plain text.',
  pageText: 'Text after the page number in the header or footer was left out.',
  ole: 'Linked objects (and embedded ones that could not be read) came in as pictures.',
  restart: 'Caption numbers that were set to start again were numbered straight through.',
  hfPictures: 'Pictures and tables in the header and footer were left out.',
  pictureWatermark: 'A picture watermark was left out (text watermarks are kept).',
};

type Pos = 'base' | 'sub' | 'sup';
/** Text formatting as a file gives it (only what it gives). `color` null is "automatic". */
interface RProps { font?: string; size?: number; bold?: boolean; italic?: boolean; underline?: boolean; color?: string | null; highlight?: string | null; pos?: Pos; hidden?: boolean; formula?: boolean; strike?: boolean; smallCaps?: boolean; allCaps?: boolean; cstyle?: string }
/** Paragraph formatting as a file gives it, in points. */
interface PProps {
  align?: Justify; before?: number; after?: number; line?: { v: number; rule: string };
  left?: number; right?: number; first?: number; keepNext?: boolean; pageBreak?: boolean; outline?: number; noLineNumbers?: boolean; noHyphen?: boolean;
  numId?: string; ilvl?: number; contextual?: boolean;
  /** Paragraph borders (w:pBdr) and shading (w:shd's fill). */
  border?: ParaBorders; shade?: string | null;
  /** Tab stops set (and cleared: kind null) here, added to those of the style it is based on. */
  tabs?: { pos: number; kind: TabStop['kind'] | null; leader?: TabStop['leader'] }[];
}

/** Paragraph settings one over another (later ones win), their tab stops added up. */
function mergeP(...ps: (PProps | undefined)[]): PProps {
  const out = merge<PProps>(...ps);
  const tabs = ps.flatMap((p) => p?.tabs ?? []);
  if (tabs.length) out.tabs = tabs; else delete out.tabs;
  return out;
}

/** The tab stops a paragraph ends up with: each set in turn, a cleared one taken away. */
function finalTabs(p: PProps): TabStop[] | undefined {
  const out: TabStop[] = [];
  for (const t of p.tabs ?? []) {
    const at = out.findIndex((x) => Math.abs(x.pos - t.pos) < 0.5);
    if (at >= 0) out.splice(at, 1);
    if (t.kind) out.push(t.leader ? { pos: t.pos, kind: t.kind, leader: t.leader } : { pos: t.pos, kind: t.kind });
  }
  out.sort((a, b) => a.pos - b.pos);
  return out.length ? out : undefined;
}
interface WStyle { id: string; type: string; name: string; basedOn?: string; next?: string; isDefault: boolean; p: PProps; r: RProps; el: Element }
interface Level { fmt: string; text: string; p: PProps }
interface Piece { runs: TextRun[]; pageBreak: boolean; soft: boolean; colBreak?: boolean; /** Index entries and marked citations in it (XE and TA fields). */ xe?: IndexMark[]; ta?: AuthorityMark[] }
interface Ctx { base: RProps; pieces: Piece[]; cell: boolean }
interface Field { instr: string; phase: 'instr' | 'result'; swallow: boolean; /** The field's own data (w:fldData, base64): EndNote's citations. */ data?: string; text: string; props: RProps; done: boolean; ref?: { id: number; mark: string; text: string; above?: boolean; page?: boolean }; toc?: boolean; /** A form field's settings (w:ffData), and the form field made of it. */ ff?: Element; form?: number; /** A HYPERLINK field: the link open before it, put back at its end. */ before?: { link: string | undefined } }
interface OutPara { ps: ParaStyle; runs: TextRun[]; mark: rt.RunStyle; style: string; contextual: boolean; table?: boolean; bib?: string; markRev?: string }

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
  /** The tracked change the text being read is in (w:ins or w:del), as stored on runs. */
  private rev: string | undefined;
  /** Word's comments whose range the text being read is in, and those met so far. */
  private cmtOpen = new Set<number>();
  private cmtMet = new Set<number>();
  /** The paragraph being read holds a display equation (Word's equation paragraph): centred here. */
  private displayMath = false;
  private openMarks = new Map<string, string>();
  /** Every bookmark's name (lower case), for fields that refer to them. */
  private allMarks = new Set<string>();
  private markSeq = new Map<string, number>();
  private refs: { id: number; mark: string; text: string; above?: boolean; page?: boolean }[] = [];
  /** The section the next paragraph starts (after a section break). */
  private breakNext: SectionBreak | null = null;
  /** The file's section properties in order (the last is the body's own, for the last section). */
  private sects: Element[] = [];
  /** The header and footer of the section read last (a section without its own links to it). */
  private lastHf: HeaderFooter = defaultHeaderFooter();
  /** The bibliography bookmark open, and the one met in the paragraph being read. */
  private bibOpen: string | null = null;
  private bibMet: string | null = null;
  /** A table's notes, written after it as a paragraph, to leave out when the table comes from our own part. */
  private pendingNotes: string | null = null;
  private measure: Measure = documentMeasure((t, size, _f, style) => arialWidth(t, size, /bold/.test(style)));
  /** How the footnotes and endnotes are numbered, where not Word's own way. */
  private noteFormats: NoteFormats = {};
  /** The link the text being read is in (a w:hyperlink or a HYPERLINK field). */
  private link: string | undefined;
  /** The part whose relationships links are looked up in (the document, or the notes being read). */
  private part = '';
  /** Bookmarks met since the last paragraph was read: they go on the next one. */
  private pendingMarks: string[] = [];
  /** The references: those in our part, then those read from Zotero's, Mendeley's and EndNote's citations. */
  private liveRefs: Reference[] = [];
  /** The reference manager whose citations or bibliography the file has (the first met). */
  private manager: CiteManager | undefined;
  /** The notes in footnotes.xml and endnotes.xml, by Word's id (read when first needed). */
  private noteEls: Partial<Record<'foot' | 'end', Map<string, Element>>> = {};

  constructor(bytes: Uint8Array, private deps: DocxReadDeps) {
    this.pkg = new PackageReader(bytes);
  }

  read(): { doc: DocText; warnings: string[] } {
    const pkg = this.pkg;
    this.main = pkg.relOfType('', REL.officeDocument) ?? 'word/document.xml';
    this.part = this.main;
    const doc = pkg.xml(this.main);
    const root = doc?.documentElement;
    const body = root && kid(root, 'body');
    if (!root || !body) throw new Error('This is not a Word document');
    this.W = root.namespaceURI ?? W_NS;
    this.readTheme();
    this.readStyles();
    this.readNumbering();
    this.readModel();
    // the sections: each paragraph's section properties end a section, the body's the last
    // (not those kept in a tracked change's record of what they were)
    const sects = Array.from(root.getElementsByTagNameNS(this.W, 'sectPr')).filter((e) => e.parentElement?.localName !== 'sectPrChange');
    const last = kids(body, 'sectPr')[0] ?? null;
    this.sects = [...sects.filter((e) => e !== last), ...(last ? [last] : [])];
    const first = this.sects[0] ?? null;
    this.readPage(first);
    const hf = this.readHeaderFooter(first).hf;
    this.lastHf = hf;
    this.blocks(kids(body));
    this.resolveRefs();
    this.joinBibliographies();
    const out = this.assemble(hf, first);
    this.readPageLook(out, root, first);
    keepUsedMarks(out);
    const props = this.readProps();
    if (props) out.props = props;
    return { doc: out, warnings: [...this.warnings] };
  }

  /** The document's properties: title, subject, author and keywords (docProps/core.xml), and company (docProps/app.xml). */
  private readProps(): DocProps | null {
    const out: DocProps = {};
    const text = (root: Element | null | undefined, name: string) => {
      const el = root ? Array.from(root.getElementsByTagNameNS('*', name))[0] : undefined;
      const v = el?.textContent?.trim();
      return v || undefined;
    };
    const corePath = this.pkg.relOfType('', REL.coreProps);
    const core = corePath ? this.pkg.xml(corePath)?.documentElement : null;
    const appPath = this.pkg.relOfType('', REL.extendedProps);
    const app = appPath ? this.pkg.xml(appPath)?.documentElement : null;
    const got: [keyof DocProps, string | undefined][] = [
      ['title', text(core, 'title')], ['subject', text(core, 'subject')], ['author', text(core, 'creator')],
      ['keywords', text(core, 'keywords')], ['created', text(core, 'created')], ['saved', text(core, 'modified')], ['company', text(app, 'Company')],
    ];
    for (const [k, v] of got) if (v) out[k] = v;
    return Object.keys(out).length ? out : null;
  }

  /** Word was set to track changes in this document (settings.xml's w:trackRevisions). */
  private trackOn(): boolean {
    const path = this.pkg.relOfType(this.main, DOCX_REL.settings);
    const st = path ? this.pkg.xml(path) : null;
    const el = st?.getElementsByTagNameNS('*', 'trackRevisions')[0];
    return !!el && this.on(el);
  }

  /** Word's hyphenation settings (settings.xml), or null when it has none. */
  private hyphenRead(): DocText['hyphen'] | null {
    const path = this.pkg.relOfType(this.main, DOCX_REL.settings);
    const st = path ? this.pkg.xml(path) : null;
    if (!st) return null;
    const el = (n: string) => st.getElementsByTagNameNS('*', n)[0];
    const val = (n: string) => { const v = Number(el(n)?.getAttributeNS(this.W, 'val') ?? el(n)?.getAttribute('w:val') ?? undefined); return Number.isFinite(v) ? v : undefined; };
    const auto = !!el('autoHyphenation') && this.on(el('autoHyphenation'));
    const limit = val('consecutiveHyphenLimit');
    const zone = val('hyphenationZone');
    const caps = el('doNotHyphenateCaps') ? !this.on(el('doNotHyphenateCaps')) : undefined;
    if (!auto && !limit && zone === undefined && caps === undefined) return null;
    return { auto, ...(limit ? { limit } : {}), ...(zone !== undefined ? { zone: zone / 20 } : {}), ...(caps === false ? { caps } : {}) };
  }

  /** Restrict Editing (settings.xml's w:documentProtection, when enforced), with the password's hash as Word keeps it. */
  private protection(): Protection | null {
    const path = this.pkg.relOfType(this.main, DOCX_REL.settings);
    const el = path ? this.pkg.xml(path)?.getElementsByTagNameNS('*', 'documentProtection')[0] : null;
    if (!el) return null;
    const edit = this.a(el, 'edit');
    const enforced = this.a(el, 'enforcement');
    if (!enforced || !['1', 'true', 'on'].includes(enforced) || !edit || !(['readOnly', 'comments', 'trackedChanges', 'forms'] as string[]).includes(edit)) return null;
    const p: Protection = { edit: edit as ProtectKind };
    // Word 2010's attribute names, or those of the standard's second edition
    const hash = this.a(el, 'hash') ?? this.a(el, 'hashValue');
    const salt = this.a(el, 'salt') ?? this.a(el, 'saltValue');
    if (hash && salt) {
      const sid = Number(this.a(el, 'cryptAlgorithmSid'));
      const named = this.a(el, 'algorithmName');
      const alg = named ?? Object.keys(ALG_SIDS).find((k) => ALG_SIDS[k] === sid) ?? 'SHA-1';
      Object.assign(p, { hash, salt, alg, spin: Number(this.a(el, 'cryptSpinCount') ?? this.a(el, 'spinCount')) || 100000 });
    }
    return p;
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
        case 'rStyle': {
          const id = this.a(c) ?? '';
          Object.assign(out, this.charStyle(id));
          // a character style of the person's (or Word's Emphasis, Strong…) is kept as one
          if (direct && this.keptCharStyle(id)) { out.cstyle = id; this.usedChar.add(id); }
          break;
        }
        case 'highlight': { const v = this.a(c) ?? 'none'; out.highlight = WORD_HIGHLIGHTS[v] ?? null; break; }
        case 'shd': {
          // shading behind the text: kept as a highlight unless a real highlight is set too
          const v = this.a(c, 'fill') ?? 'auto';
          if (out.highlight === undefined || out.highlight === null) out.highlight = /^[0-9a-f]{6}$/i.test(v) && this.a(c) !== 'nil' ? `#${v.toLowerCase()}` : null;
          break;
        }
        case 'strike': case 'dstrike': out.strike = this.on(c); break;
        case 'smallCaps': out.smallCaps = this.on(c); break;
        case 'caps': out.allCaps = this.on(c); break;
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
          const right = this.tw(c, 'right') ?? this.tw(c, 'end');
          if (right !== undefined) out.right = right;
          const hang = this.tw(c, 'hanging'), first = this.tw(c, 'firstLine');
          if (hang !== undefined) out.first = -hang;
          else if (first !== undefined) out.first = first;
          break;
        }
        case 'keepNext': out.keepNext = this.on(c); break;
        case 'pageBreakBefore': out.pageBreak = this.on(c); break;
        case 'suppressLineNumbers': out.noLineNumbers = this.on(c); break;
        case 'suppressAutoHyphens': out.noHyphen = this.on(c); break;
        case 'outlineLvl': { const v = Number(this.a(c)); if (v >= 0 && v < 9) out.outline = v + 1; break; }
        case 'contextualSpacing': out.contextual = this.on(c); break;
        case 'pBdr': {
          const b: ParaBorders = {};
          for (const side of kids(c)) {
            const name = side.localName === 'start' ? 'left' : side.localName === 'end' ? 'right' : side.localName;
            if (!['top', 'bottom', 'left', 'right', 'between'].includes(name)) continue;
            const line = readBorder(side, (e, n) => this.a(e, n));
            if (line) b[name as keyof ParaBorders] = line;
          }
          out.border = b;
          break;
        }
        case 'shd': {
          const fill = this.a(c, 'fill');
          out.shade = fill && /^[0-9a-f]{6}$/i.test(fill) ? `#${fill.toLowerCase()}` : null;
          break;
        }
        case 'tabs': {
          const tabs: NonNullable<PProps['tabs']> = [];
          for (const t of kids(c, 'tab')) {
            const pos = this.tw(t, 'pos');
            const v = this.a(t) ?? 'left';
            if (pos === undefined) continue;
            if (v === 'clear') { tabs.push({ pos, kind: null }); continue; }
            const kind = TAB_KINDS[v];
            if (!kind || pos <= 0) continue;
            const leader = TAB_LEADERS[this.a(t, 'leader') ?? ''];
            tabs.push(leader ? { pos: round(pos), kind, leader } : { pos: round(pos), kind });
          }
          if (tabs.length) out.tabs = tabs;
          break;
        }
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
    return { p: mergeP(...list.map((s) => s.p)), r: merge<RProps>(...list.map((s) => s.r)) };
  }

  /** Character styles kept as styles here, met in the text. */
  private usedChar = new Set<string>();

  /** A character style to keep as one (not Word's working ones, nor those linked to a paragraph style). */
  private keptCharStyle(id: string): boolean {
    const ws = this.wstyles.get(`character:${id}`);
    return !!ws && !WORD_INNER_CHAR.has(id) && id !== FORMULA_STYLE && ws.name !== 'Chemical Formula' && !kid(ws.el, 'link');
  }

  /** The character styles met, as styles here: what each sets. */
  private charStylesRead(): Record<string, CharStyle> | undefined {
    if (!this.usedChar.size) return undefined;
    const own = defaultCharStyles();
    const out: Record<string, CharStyle> = {};
    for (const id of this.usedChar) {
      const ws = this.wstyles.get(`character:${id}`);
      const r = this.chain('character', id).r;
      const cs: CharStyle = { id, name: own[id]?.name ?? ws?.name ?? id };
      if (!own[id]) cs.custom = true;
      if (r.font) cs.font = r.font;
      if (r.size) cs.size = r.size;
      if (r.bold !== undefined) cs.bold = r.bold;
      if (r.italic !== undefined) cs.italic = r.italic;
      if (r.underline) cs.underline = true;
      if (r.color) cs.color = r.color;
      if (r.smallCaps) cs.smallCaps = true;
      if (r.allCaps) cs.allCaps = true;
      if (r.strike) cs.strike = true;
      out[id] = cs;
    }
    return out;
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
        if (Array.isArray(m.references)) this.liveRefs = m.references.map((r) => cleanRef(r));
        if (m.drawingStyle) this.drawingStyle = { ...ACS_1996, ...m.drawingStyle };
        return;
      } catch {
        // someone else's part, or ours damaged: the file is read as Word shows it
      }
    }
  }

  // ---------------------------------------------------------------- page

  /** A section's paper, margins and columns. */
  private pageOf(sect: Element | null): PageSetup {
    const sz = kid(sect, 'pgSz'), mar = kid(sect, 'pgMar');
    const d = defaultPage();
    const get = (el: Element | null, n: string, dflt: number) => Math.abs(this.tw(el, n) ?? dflt);
    let page: PageSetup = {
      w: get(sz, 'w', d.w), h: get(sz, 'h', d.h),
      top: get(mar, 'top', d.top), bottom: get(mar, 'bottom', d.bottom), left: get(mar, 'left', d.left), right: get(mar, 'right', d.right),
      header: get(mar, 'header', d.header), footer: get(mar, 'footer', d.footer),
    };
    if (page.w < 72 || page.h < 72) page = d;
    // columns (Word's equal columns; columns of their own widths are read as equal ones)
    const cols = kid(sect, 'cols');
    const n = Number(this.a(cols, 'num') ?? 1);
    if (n > 1 && n <= 4) {
      page.cols = Math.round(n);
      const gap = this.tw(cols, 'space');
      if (gap !== undefined && Math.abs(gap - COL_GAP) > 0.5) page.colGap = gap;
    }
    return page;
  }

  /** How a section starts: Word's section type (Next Page when not said). */
  private kindOf(sect: Element | null): BreakKind {
    const v = this.a(kid(sect, 'type')) ?? 'nextPage';
    return v === 'continuous' ? 'continuous' : v === 'evenPage' ? 'evenPage' : v === 'oddPage' ? 'oddPage' : 'nextPage';
  }

  /** A section's page number format (1, 2, 3 for those not kept here, such as 1-1 or Chinese numbers). */
  private numFormatOf(sect: Element | null): PageNumFormat {
    const v = this.a(kid(sect, 'pgNumType'), 'fmt');
    return v === 'lowerRoman' || v === 'upperRoman' || v === 'lowerLetter' || v === 'upperLetter' ? v : 'decimal';
  }

  /** A section's line numbers: Word counts its start from 0 (start="4" is numbered from 5). */
  private lineNumbersOf(sect: Element | null): LineNumbers | undefined {
    const el = kid(sect, 'lnNumType');
    const by = Number(this.a(el, 'countBy') ?? 0);
    if (!el || !(by >= 1)) return undefined;
    const start = Number(this.a(el, 'start') ?? 0);
    const r = this.a(el, 'restart');
    const out: LineNumbers = { start: Number.isFinite(start) ? Math.max(0, Math.round(start)) + 1 : 1, countBy: Math.round(by), restart: r === 'continuous' ? 'continuous' : r === 'newSection' ? 'section' : 'page' };
    const d = this.tw(el, 'distance');
    if (d !== undefined && d > 0) out.distance = round(d);
    return out;
  }

  /** The section after a paragraph's section properties: how it starts and its own settings. */
  private sectionAfter(sect: Element): SectionBreak | null {
    const at = this.sects.indexOf(sect);
    const next = at >= 0 ? this.sects[at + 1] : undefined;
    if (!next) return null;
    const out: SectionBreak = { kind: this.kindOf(next), page: this.pageOf(next) };
    const { hf, linked } = this.readHeaderFooter(next, this.lastHf);
    if (!linked) out.hf = hf;
    this.lastHf = hf;
    const start = Number(this.a(kid(next, 'pgNumType'), 'start'));
    if (this.a(kid(next, 'pgNumType'), 'start') !== null && Number.isFinite(start)) out.restart = Math.round(start);
    const fmt = this.numFormatOf(next);
    if (fmt !== 'decimal') out.format = fmt;
    const lines = this.lineNumbersOf(next);
    if (lines) out.lines = lines;
    return out;
  }

  private readPage(sect: Element | null): void {
    this.page = this.pageOf(sect);
    this.textW = columnsOf(this.page, Math.max(36, this.page.w - this.page.left - this.page.right)).w;
    // the notes' numbering: the section's, else the document's (settings.xml)
    const sp = this.pkg.relOfType(this.main, DOCX_REL.settings);
    const settings = sp ? this.pkg.xml(sp)?.documentElement ?? null : null;
    const FORMATS = ['decimal', 'lowerRoman', 'upperRoman', 'lowerLetter', 'upperLetter', 'chicago'];
    for (const [tag, key, def] of [['footnotePr', 'foot', 'decimal'], ['endnotePr', 'end', 'lowerRoman']] as const) {
      const v = this.a(kid(kid(sect, tag), 'numFmt')) ?? this.a(kid(kid(settings, tag), 'numFmt'));
      if (v && v !== def && FORMATS.includes(v)) this.noteFormats[key] = v as NoteFormat;
    }
  }

  /** A footnote (or endnote) of the file by Word's id. */
  private noteEl(end: boolean, id: string | null): Element | null {
    const k = end ? 'end' : 'foot';
    let m = this.noteEls[k];
    if (!m) {
      m = new Map();
      const path = this.pkg.relOfType(this.main, end ? DOCX_REL.endnotes : DOCX_REL.footnotes);
      const root = path ? this.pkg.xml(path)?.documentElement : null;
      for (const n of root ? kids(root, end ? 'endnote' : 'footnote') : []) {
        const t = this.a(n, 'type');
        if (!t || t === 'normal') m.set(this.a(n, 'id') ?? '', n);
      }
      this.noteEls[k] = m;
    }
    return id === null ? null : m.get(id) ?? null;
  }

  /**
   * A footnote's or endnote's number in the text: a note here, with the note's text (read as a
   * text box's is, its paragraphs in their own look), less Word's number mark and the space after it.
   */
  private noteRef(el: Element, r: RProps, ctx: Ctx, end: boolean): void {
    if (this.swallowing()) return;
    if (ctx.cell) { this.warn('notes'); return; }
    const note = this.noteEl(end, this.a(el, 'id'));
    if (!note) return;
    // the note is read apart from the paragraph it is in (its own fields and comments)
    const fields = this.fields, cmt = this.cmtOpen, math = this.displayMath, part = this.part, link = this.link;
    this.fields = [];
    this.cmtOpen = new Set();
    this.part = this.pkg.relOfType(this.main, end ? DOCX_REL.endnotes : DOCX_REL.footnotes) ?? part;
    this.link = undefined;
    const got = this.boxText(note);
    this.fields = fields;
    this.cmtOpen = cmt;
    this.displayMath = math;
    this.part = part;
    this.link = link;
    // text only (citations, captions and pictures in notes keep no place here)
    const runs = got.runs.filter((x) => x.obj === undefined).map(({ cmt: _c, ...x }) => x);
    while (runs.length && /^[ \t]/.test(runs[0].text)) {
      const text = runs[0].text.replace(/^[ \t]+/, '');
      if (text) { runs[0] = { ...runs[0], text }; break; }
      if (runs.length === 1) { runs[0] = { ...runs[0], text: '' }; break; }
      runs.shift();
    }
    this.emitObject(ctx, { kind: 'note', ...(end ? { end: true } : {}), runs: rt.normalizeRuns(runs), paras: got.paras }, { ...r, pos: 'sup' }, true);
  }

  // ---------------------------------------------------------------- the text

  /** Block content: paragraphs, tables and the containers round them. */
  private blocks(els: Element[]): void {
    for (const el of els) {
      switch (el.localName) {
        case 'p': this.paragraph(el); break;
        case 'tbl': this.table(el); break;
        case 'sdt':
          if (this.sdtTag(el) === 'MENDELEY_BIBLIOGRAPHY') { this.managedBibliography(); break; }
          this.blocks(kids(kid(el, 'sdtContent')));
          break;
        case 'customXml': case 'ins': case 'moveTo': case 'smartTag': this.blocks(kids(el)); break;
        case 'AlternateContent': this.blocks(kids(this.alternate(el))); break;
        case 'bookmarkStart': this.markStart(el); break;
        case 'bookmarkEnd': this.markEnd(el); break;
      }
    }
  }

  /** Mendeley Cite's bibliography (a content control of paragraphs): ours, worked out here, in a paragraph of its own. */
  private managedBibliography(): void {
    this.manager ??= 'mendeley-cite';
    const id = this.nextId++;
    this.objects[id] = { kind: 'bib' };
    const base = merge<RProps>(this.docDefaults.r, this.chain('paragraph', this.defaultPara).r);
    const ps = cleanPara({ section: this.takeBreak() });
    this.out.push({ ps, runs: [{ ...this.runStyle(base), obj: id, text: OBJECT_CHAR }], mark: this.runStyle(base), style: 'Normal', contextual: false });
  }

  /** The part of a choice of contents (mc:AlternateContent) to read: the plain one meant for older programs. */
  private alternate(el: Element): Element | null {
    // Word 2010's text boxes (wps) are read from the choice itself; their fallback is an older shape
    const choice = kid(el, 'Choice');
    if (choice && /(^|\s)wps(\s|$)/.test(choice.getAttribute('Requires') ?? '') && choice.getElementsByTagNameNS('*', 'txbx').length) return choice;
    // one of our diagrams as a group of shapes (Word puts an older shape in place of our picture when it saves)
    if (choice && /(^|\s)wpg(\s|$)/.test(choice.getAttribute('Requires') ?? '') && Array.from(choice.getElementsByTagNameNS('*', 'docPr')).some((d) => new RegExp(`^${DRAWING_NAME} \\d+$`).test(d.getAttribute('name') ?? ''))) return choice;
    // Word 2016's newer charts (histograms, box charts): their fallback is only a picture
    if (choice && /(^|\s)cx\d*(\s|$)/.test(choice.getAttribute('Requires') ?? '') && Array.from(choice.getElementsByTagNameNS('*', 'graphicData')).some((g) => /chartex/.test(g.getAttribute('uri') ?? ''))) return choice;
    return kid(el, 'Fallback') ?? choice;
  }

  /**
   * Where a floating drawing (wp:anchor) is: its place from the margin, page or paragraph, and
   * how text wraps round it. Null for places that can't be kept (then it goes in the line).
   * `look` is its frame and shadow, which our place includes and Word's leaves out.
   */
  private floatOf(anchor: Element, look: FigureLook | null | undefined, w: number): Float | null {
    const [l, t] = lookExtent(look ?? undefined);
    const H = kid(anchor, 'positionH'), V = kid(anchor, 'positionV');
    const hFrom = H?.getAttribute('relativeFrom') ?? 'column';
    const vFrom = V?.getAttribute('relativeFrom') ?? 'paragraph';
    const off = (el: Element | null) => { const o = kid(el, 'posOffset'); return o ? fromEmu(o.textContent ?? '0') : null; };
    const pg = this.page;
    let x = off(H);
    if (x === null) {
      // aligned rather than placed: left, centre or right of the margins (or the page)
      const a = kid(H, 'align')?.textContent ?? 'left';
      const room = hFrom === 'page' ? pg.w : this.textW;
      x = a === 'center' ? (room - w) / 2 : a === 'right' || a === 'outside' ? room - w : 0;
    }
    let y = off(V) ?? 0;
    const xFrom = hFrom === 'page' ? 'page' as const : undefined;
    // from the left of the margin (columns and characters are near enough to it)
    if (hFrom === 'leftMargin' || hFrom === 'insideMargin') x -= pg.left;
    if (hFrom === 'rightMargin' || hFrom === 'outsideMargin') x += pg.w - pg.right - pg.left;
    let yFrom: Float['yFrom'] = vFrom === 'page' ? 'page' : vFrom === 'margin' || vFrom === 'topMargin' ? 'margin' : undefined;
    if (vFrom === 'bottomMargin') { yFrom = 'page'; y += pg.h - pg.bottom; }
    const kind = kids(anchor).map((k) => k.localName).find((n) => n.startsWith('wrap')) ?? 'wrapNone';
    const wrap = kind === 'wrapTopAndBottom' ? 'topBottom' as const
      : kind === 'wrapNone' ? (yes(anchor.getAttribute('behindDoc')) ? 'behind' as const : 'front' as const)
      : 'square' as const;
    const dist = Math.max(fromEmu(anchor.getAttribute('distL') ?? '0'), fromEmu(anchor.getAttribute('distR') ?? '0'), fromEmu(anchor.getAttribute('distT') ?? '0'));
    const fl: Float = { wrap, x: round(x - l), y: round(y - t) };
    if (xFrom) fl.xFrom = xFrom;
    if (yFrom) fl.yFrom = yFrom;
    if (Math.abs(dist - FLOAT_GAP) > 0.5) fl.gap = round(dist);
    return fl;
  }

  /** A text box's paragraphs, read as the document's are. */
  private boxText(content: Element): { runs: TextRun[]; paras: ParaStyle[] } {
    const out = this.out, brk = this.breakNext;
    this.out = [];
    this.blocks(kids(content));
    const got = this.out;
    this.out = out;
    this.breakNext = brk;
    const runs: TextRun[] = [];
    got.forEach((p, i) => {
      if (i > 0) runs.push({ ...got[i - 1].mark, text: '\n' });
      runs.push(...p.runs);
    });
    if (!runs.length) runs.push({ ...(got[0]?.mark ?? {}), text: '' });
    return { runs: rt.normalizeRuns(runs), paras: got.map((p) => { const q = cleanPara(p.ps); delete q.style; delete q.pageBreak; delete q.section; return q; }) };
  }

  /** A paragraph's own and its style's formatting. */
  private paraProps(pPr: Element | null): { style: string; p: PProps; direct: PProps; base: RProps; mark: RProps } {
    const sid = this.a(kid(pPr, 'pStyle')) ?? this.defaultPara;
    const style = this.wstyles.has(`paragraph:${sid}`) ? sid : this.defaultPara;
    const ch = this.chain('paragraph', style);
    const direct = this.readPPr(pPr);
    const p = mergeP(this.docDefaults.p, ch.p, direct);
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
    const bibBefore = this.bibOpen;
    this.bibMet = null;
    const inToc = this.fields.some((f) => f.toc);
    this.displayMath = false;
    this.inline(kids(el), ctx);
    // the contents' own lines (and the paragraph its field ends in): left out
    const sectionBreak = () => { if (sect) this.breakNext = this.sectionAfter(sect); };
    if (inToc && ctx.pieces.every((pc) => !pc.runs.length)) { sectionBreak(); return; }
    const bib = bibBefore ?? this.bibMet ?? undefined;
    const text = ctx.pieces.map((pc) => rt.plainText(pc.runs)).join('\n');
    // the empty paragraph Word needs after a table to hold a section break: the break is kept, the paragraph isn't
    if (sect && !text && this.out[this.out.length - 1]?.table && ctx.pieces.length === 1) { this.breakNext = null; sectionBreak(); return; }
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
    const p = level ? mergeP(this.docDefaults.p, this.chain('paragraph', style).p, level.p, direct) : own;
    let list: 'bullet' | 'number' | undefined;
    let scheme: string | undefined, bullet: string | undefined;
    if (level && levels && level.fmt !== 'none') {
      list = level.fmt === 'bullet' ? 'bullet' : 'number';
      if (list === 'number') {
        const sc = schemeFor(levels, ilvl);
        if (sc === null) this.warn('numbering');
        else if (sc) scheme = sc;
      } else {
        const b = SYMBOL_BULLETS[level.text] ?? level.text;
        if (b !== BULLETS[ilvl % BULLETS.length] && BULLET_LIBRARY.includes(b)) bullet = b;
      }
    }
    const firstSize = ctx.pieces[0].runs.find((r) => r.obj === undefined)?.size ?? size;
    let indent = Math.max(0, p.left ?? 0);
    if (list) indent = Math.max(0, indent - listIndent({ list, level: ilvl }, firstSize).left);
    const brk = this.takeBreak();
    const ps: ParaStyle = {
      style: ours === 'Normal' ? undefined : ours,
      align: p.align && p.align !== 'left' ? p.align : this.displayMath && !p.align ? 'center' : undefined,
      spaceBefore: round(p.before ?? 0), spaceAfter: round(p.after ?? 0),
      // spacing in points stays in points for the paragraph (its style takes the nearest multiple)
      ...(p.line && p.line.rule !== 'auto' ? { linePt: round(p.line.v / 20), lineRule: p.line.rule === 'exact' ? 'exact' as const : 'atLeast' as const } : { line: this.lineOf(p, size) }),
      indent: round(indent), indentRight: p.right ? round(Math.max(0, p.right)) : undefined, firstLine: list ? undefined : round(p.first ?? 0), keepNext: p.keepNext,
      pageBreak: p.pageBreak, section: brk, list, level: list ? ilvl : undefined, noLineNumbers: p.noLineNumbers, noHyphen: p.noHyphen || undefined,
      tabs: finalTabs(p), scheme, bullet,
      border: cleanBorders(p.border), shade: p.shade && p.shade !== '#ffffff' ? p.shade : undefined,
    };
    const markStyle = this.runStyle({ ...mark, cstyle: undefined });
    const mrEl = kid(kid(pPr, 'rPr'), 'ins') ?? kid(kid(pPr, 'rPr'), 'del');
    const markRevOf = mrEl ? revText({ kind: mrEl.localName === 'ins' ? 'ins' : 'del', author: this.a(mrEl, 'author') ?? '', date: this.a(mrEl, 'date') ?? '' }) : undefined;
    ctx.pieces.forEach((pc, i) => {
      let q: ParaStyle = { ...ps };
      if (i > 0) {
        q.pageBreak = pc.pageBreak || undefined;
        q.colBreak = pc.colBreak || undefined;
        if (pc.soft) {
          // a line break inside a paragraph: the next line as a paragraph of its own, with no space between
          if (list) q.cont = true;
          q.spaceBefore = 0;
          q.firstLine = undefined;
          const prev = this.out[this.out.length - 1];
          if (prev) prev.ps = cleanPara({ ...prev.ps, spaceAfter: 0 });
        }
      } else {
        if (pc.pageBreak) q.pageBreak = true;
        if (pc.colBreak) q.colBreak = true;
        if (this.pendingMarks.length) { q.marks = this.pendingMarks; this.pendingMarks = []; }
      }
      if (pc.xe) q.xe = pc.xe;
      if (pc.ta) q.ta = pc.ta;
      q = cleanPara(q);
      // the paragraph mark inserted or deleted while Word tracked changes (on the last piece: the real mark)
      const mr = i === ctx.pieces.length - 1 ? markRevOf : undefined;
      this.out.push({ ps: q, runs: pc.runs, mark: markStyle, style: ours, contextual: !!p.contextual, bib, ...(mr ? { markRev: mr } : {}) });
    });
    sectionBreak();
  }

  private takeBreak(): SectionBreak | undefined {
    const b = this.breakNext;
    this.breakNext = null;
    return b ?? undefined;
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
      strike: r.strike, smallCaps: r.smallCaps, allCaps: r.allCaps, cstyle: r.cstyle,
      color: r.color ?? undefined, highlight: r.highlight ?? undefined, formula: formula || undefined,
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
    if ((top?.ref || top?.form !== undefined) && top.phase === 'result') top.text += text;
    if (this.swallowing()) return;
    let props = r;
    if (r.font && /^symbol$/i.test(r.font)) {
      // text in the Symbol font: the Greek letters and signs it shows
      const plain = text.replace(/[\uF000-\uF0FF]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xf000));
      text = rt.fromSymbolFont(plain);
      props = { ...r, font: ctx.base.font };
    }
    this.piece(ctx).runs.push({ ...this.runStyle(props), ...(this.rev ? { rev: this.rev } : {}), ...this.cmtMark(ctx), ...(this.link ? { link: this.link } : {}), text });
  }

  /** Where a Word link goes: a web page or file (through the part's relationships), or a bookmark here. */
  private hyperlinkOf(el: Element): string | undefined {
    const anchor = this.a(el, 'anchor');
    const id = rAttr(el, 'id');
    const rel = id ? this.pkg.rels(this.part).get(id) : undefined;
    if (rel) return linkFromTarget(rel.target) + (anchor ? `#${anchor}` : '');
    return anchor ? `#${anchor}` : undefined;
  }

  // ---------------------------------------------------------------- comments

  private cmtMark(ctx: Ctx): { cmt?: string } {
    if (ctx.cell || !this.cmtOpen.size) return {};
    return { cmt: cmtString(this.cmtOpen) };
  }

  private cmtRange(el: Element): void {
    const id = Number(this.a(el, 'id'));
    if (!Number.isInteger(id) || id < 0) return;
    if (el.localName === 'commentRangeStart') { this.cmtOpen.add(id); this.cmtMet.add(id); } else this.cmtOpen.delete(id);
  }

  /** A comment's mark in the text: one with no range of its own goes on the character before it. */
  private cmtPoint(el: Element, ctx: Ctx): void {
    const id = Number(this.a(el, 'id'));
    if (!Number.isInteger(id) || id < 0 || this.cmtMet.has(id) || ctx.cell) return;
    this.cmtMet.add(id);
    const runs = this.piece(ctx).runs;
    const last = runs[runs.length - 1];
    if (!last?.text) return;
    const keep = last.text.slice(0, -1);
    const one = { ...last, text: last.text.slice(-1), cmt: cmtString([...cmtIds(last.cmt), id]) };
    runs.splice(runs.length - 1, 1, ...(keep ? [{ ...last, text: keep }, one] : [one]));
  }

  /**
   * Word's comments (comments.xml), with Word 2013's replies and Resolved marks
   * (commentsExtended.xml). Replies become their comment's replies here.
   */
  private readComments(): { comments: Record<number, CommentThread>; replies: Set<number> } | null {
    const path = this.pkg.relOfType(this.main, DOCX_REL.comments);
    const root = path ? this.pkg.xml(path)?.documentElement : null;
    if (!root) return null;
    const notes = new Map<number, CommentNote & { para: string }>();
    for (const c of kids(root, 'comment')) {
      const id = Number(this.a(c, 'id'));
      if (!Number.isInteger(id) || id < 0) continue;
      const paras = [...c.getElementsByTagNameNS(this.W, 'p')];
      const text = paras.map((p) => [...p.getElementsByTagNameNS(this.W, '*')]
        .map((e) => (e.localName === 't' ? e.textContent ?? '' : e.localName === 'tab' ? '\t' : e.localName === 'br' ? '\n' : '')).join('')).join('\n');
      const last = paras[paras.length - 1];
      notes.set(id, { author: this.a(c, 'author') ?? '', date: fromWordDate(this.a(c, 'date') ?? ''), text, para: last?.getAttributeNS(W14_NS, 'paraId') ?? '' });
    }
    // Word 365 keeps each comment's time in UTC too, by a lasting id found from its paragraph id
    const part = (rel: string) => { const at = this.pkg.relOfType(this.main, rel); return at ? this.pkg.xml(at)?.documentElement ?? null : null; };
    const durable = new Map<string, string>(), utc = new Map<string, string>();
    for (const e of [...(part(DOCX_REL.commentsIds)?.getElementsByTagNameNS(W16CID_NS, 'commentId') ?? [])]) durable.set(e.getAttributeNS(W16CID_NS, 'paraId') ?? '', e.getAttributeNS(W16CID_NS, 'durableId') ?? '');
    for (const e of [...(part(DOCX_REL.commentsExtensible)?.getElementsByTagNameNS(W16CEX_NS, 'commentExtensible') ?? [])]) utc.set(e.getAttributeNS(W16CEX_NS, 'durableId') ?? '', e.getAttributeNS(W16CEX_NS, 'dateUtc') ?? '');
    for (const n of notes.values()) {
      const at = new Date(utc.get(durable.get(n.para) ?? '') ?? '');
      if (!isNaN(at.getTime())) n.date = at.toISOString();
    }
    // which comment each reply answers, and which are resolved
    const parent = new Map<string, string>(), done = new Set<string>();
    const exPath = this.pkg.relOfType(this.main, DOCX_REL.commentsExtended);
    const ex = exPath ? this.pkg.xml(exPath)?.documentElement : null;
    for (const e of ex ? [...ex.getElementsByTagNameNS(W15_NS, 'commentEx')] : []) {
      const pid = e.getAttributeNS(W15_NS, 'paraId') ?? '';
      const up = e.getAttributeNS(W15_NS, 'paraIdParent');
      if (up) parent.set(pid, up);
      if (/^(1|true)$/i.test(e.getAttributeNS(W15_NS, 'done') ?? '')) done.add(pid);
    }
    const byPara = new Map<string, number>();
    for (const [id, n] of notes) if (n.para) byPara.set(n.para, id);
    const comments: Record<number, CommentThread> = {};
    const replies = new Set<number>();
    for (const [id, n] of notes) {
      if (n.para && parent.has(n.para) && byPara.has(parent.get(n.para)!)) { replies.add(id); continue; }
      comments[id] = { author: n.author, date: n.date, text: n.text, ...(done.has(n.para) ? { done: true } : {}) };
    }
    for (const id of [...notes.keys()].sort((a, b) => a - b)) {
      if (!replies.has(id)) continue;
      const n = notes.get(id)!;
      // (a reply to a reply belongs to the comment at the top)
      let top = byPara.get(parent.get(n.para)!)!;
      for (let k = 0; replies.has(top) && k < 50; k++) top = byPara.get(parent.get(notes.get(top)!.para)!)!;
      const c = comments[top];
      if (c) (c.replies ??= []).push({ author: n.author, date: n.date, text: n.text });
    }
    return { comments, replies };
  }

  private emitObject(ctx: Ctx, o: DocObject, r: RProps, keepPos = false): number | null {
    if (ctx.cell) { if (o.kind !== 'seq' && o.kind !== 'ref') this.warn('cellObjects'); return null; }
    const id = this.nextId++;
    this.objects[id] = o;
    const { formula: _f, sub, sup, ...style } = this.runStyle(r);
    // a citation keeps its superscript; caption numbers and references take the text's position
    this.piece(ctx).runs.push({ ...style, ...(keepPos ? rt.cleanStyle({ sub, sup }) : {}), ...(this.rev ? { rev: this.rev } : {}), ...this.cmtMark(ctx), ...(this.link ? { link: this.link } : {}), obj: id, text: OBJECT_CHAR });
    return id;
  }

  private pageBreak(ctx: Ctx, column = false): void {
    if (ctx.cell) return;
    const pc = this.piece(ctx);
    if (!pc.runs.length && !pc.soft) { if (column) pc.colBreak = true; else pc.pageBreak = true; }
    else ctx.pieces.push({ runs: [], pageBreak: !column, soft: false, colBreak: column || undefined });
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
        case 'hyperlink': {
          const before = this.link;
          this.link = this.hyperlinkOf(el) ?? before;
          this.inline(kids(el), ctx);
          this.link = before;
          break;
        }
        case 'fldSimple': this.simpleField(el, ctx); break;
        case 'smartTag': case 'customXml': case 'dir': case 'bdo': this.inline(kids(el), ctx); break;
        case 'sdt': {
          // a Mendeley Cite citation: its content control's tag holds the citation
          const m = !ctx.cell && !this.swallowing() ? readMendeleyTag(this.sdtTag(el)) : null;
          if (m && this.managedCite(m, ctx, merge<RProps>(ctx.base, this.readRPr(kid(kid(el, 'sdtContent'), 'r', 'rPr'))))) break;
          this.inline(kids(kid(el, 'sdtContent')), ctx);
          break;
        }
        // tracked changes: the text keeps its mark, to be accepted or rejected here or in Word
        case 'ins': case 'moveTo': case 'del': case 'moveFrom': {
          const before = this.rev;
          const kind = el.localName === 'ins' || el.localName === 'moveTo' ? 'ins' : 'del';
          this.rev = revText({ kind, author: this.a(el, 'author') ?? '', date: this.a(el, 'date') ?? '' });
          this.inline(kids(el), ctx);
          this.rev = before;
          break;
        }
        case 'bookmarkStart': this.markStart(el); break;
        case 'bookmarkEnd': this.markEnd(el); break;
        case 'commentRangeStart': case 'commentRangeEnd': this.cmtRange(el); break;
        case 'oMath': case 'oMathPara': this.math(el, ctx); break;
        case 'AlternateContent': this.inline(kids(this.alternate(el)), ctx); break;
      }
    }
  }

  /** A Word equation: kept as an equation (its LaTeX), or as its text in a table cell. */
  private math(el: Element, ctx: Ctx): void {
    if (this.swallowing()) return;
    const tex = ommlToTex(el);
    if (!tex) return;
    if (ctx.cell) { this.warn('equations'); this.emitText(ctx, mathText(tex), ctx.base); return; }
    if (el.localName === 'oMathPara') this.displayMath = true;
    this.emitObject(ctx, { kind: 'math', tex }, ctx.base);
  }

  private run(el: Element, ctx: Ctx): void {
    const r = merge<RProps>(ctx.base, this.readRPr(kid(el, 'rPr')));
    for (const c of kids(el)) {
      switch (c.localName) {
        case 't': case 'delText': this.emitText(ctx, c.textContent ?? '', r); break;
        case 'tab': case 'ptab': this.emitText(ctx, '\t', r); break;
        case 'noBreakHyphen': this.emitText(ctx, '‑', r); break;
        case 'br': {
          if (this.swallowing()) break;
          const type = this.a(c, 'type');
          if (type === 'page') this.pageBreak(ctx);
          else if (type === 'column') this.pageBreak(ctx, true);
          else this.lineBreak(ctx);
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
        case 'instrText': case 'delInstrText': { const top = this.fields[this.fields.length - 1]; if (top?.phase === 'instr') top.instr += c.textContent ?? ''; break; }
        case 'drawing': if (!this.swallowing()) this.drawing(c, r, ctx); break;
        case 'pict': if (!this.swallowing()) this.vml(c, r, ctx, null); break;
        case 'object': if (!this.swallowing()) this.vml(c, r, ctx, c); break;
        case 'footnoteReference': case 'endnoteReference': this.noteRef(c, r, ctx, c.localName === 'endnoteReference'); break;
        case 'commentReference': this.cmtPoint(c, ctx); break;
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
    if (type === 'begin') {
      const data = kid(c, 'fldData')?.textContent?.trim();
      const ff = kid(c, 'ffData');
      this.fields.push({ instr: '', phase: 'instr', swallow: false, text: '', props: r, done: false, ...(data ? { data } : {}), ...(ff ? { ff } : {}) });
    }
    else if (type === 'separate') {
      const f = this.fields[this.fields.length - 1];
      if (!f) return;
      f.phase = 'result';
      this.startField(f, ctx);
    } else if (type === 'end') {
      const f = this.fields.pop();
      if (!f) return;
      if (f.phase === 'instr') { f.phase = 'result'; this.startField(f, ctx); }
      // a field inside another's instruction (EndNote's EN.CITE.DATA): its data is the outer field's
      const outer = this.fields[this.fields.length - 1];
      if (f.data && outer?.phase === 'instr' && !outer.data) outer.data = f.data;
      if (f.ref) f.ref.text = f.text;
      if (f.form !== undefined) this.formEnded(f);
      if (f.before) this.link = f.before.link;
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
    if (f.before) this.link = f.before.link;
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
    // an index entry or a citation marked for a table of authorities: kept on its paragraph
    const xe = /^XE\b/i.test(ins) ? parseXe(ins) : null;
    if (xe || /^TA\b/i.test(ins)) {
      const ta = xe ? null : parseTa(ins);
      if (ctx.cell) { if (xe || ta) this.warn('cellMarks'); return; }
      const pc = this.piece(ctx);
      if (xe) (pc.xe ??= []).push(xe);
      if (ta) (pc.ta ??= []).push(ta);
      return;
    }
    // an index or a table of authorities: ours again, its lines (Word's last update) left out, as they are worked out here
    const index = parseIndex(ins), toa = index ? null : parseToa(ins);
    if ((index || toa) && !ctx.cell) {
      const id = this.emitObject(ctx, index ? { kind: 'index', ...index } : { kind: 'toa', ...toa! }, f.props);
      if (id !== null) { f.swallow = true; f.toc = true; }
      return;
    }
    // a form field (a text box, check box or drop-down): its entry is its result
    const form = /^FORM(TEXT|CHECKBOX|DROPDOWN)\b/i.exec(ins);
    if (form && !ctx.cell) {
      const ff = f.ff;
      const type = form[1].toUpperCase() === 'TEXT' ? 'text' : form[1].toUpperCase() === 'CHECKBOX' ? 'check' : 'drop';
      const name = this.a(kid(ff, 'name')) ?? undefined;
      const help = this.a(kid(ff, 'helpText')) ?? this.a(kid(ff, 'statusText')) ?? undefined;
      const o: DocObject = { kind: 'form', type, ...(name ? { name } : {}), ...(help ? { help } : {}) };
      if (type === 'check') {
        const cb = kid(ff, 'checkBox');
        const checked = kid(cb, 'checked') ?? kid(cb, 'default');
        if (checked && this.on(checked)) o.checked = true;
      } else if (type === 'drop') {
        const dd = kid(ff, 'ddList');
        const items = kids(dd, 'listEntry').map((x) => this.a(x) ?? '').filter(Boolean);
        const at = Number(this.a(kid(dd, 'result')) ?? this.a(kid(dd, 'default')) ?? 0) || 0;
        o.items = items;
        if (items[at]) o.value = items[at];
      }
      const id = this.emitObject(ctx, o, f.props);
      if (id !== null) { f.swallow = true; if (type === 'text') f.form = id; }
      return;
    }
    const ref = /^(PAGE)?REF\s+(\S+)/i.exec(ins);
    if (ref && !ctx.cell) {
      const id = this.emitObject(ctx, { kind: 'ref', target: -1 }, f.props);
      if (id === null) return;
      f.ref = { id, mark: ref[2], text: '', ...(ref[1] ? { page: true } : /\\p\b/i.test(ins) && !/\\[nrw]\b/i.test(ins) ? { above: true } : {}) };
      this.refs.push(f.ref);
      f.swallow = true;
      return;
    }
    // the date, a document property, the file's name, a page number, a bookmark's page: fields of ours
    const fo = /^(PAGE)?REF\b/i.test(ins) ? null : parseFieldInstr(ins);
    if (fo && !ctx.cell) {
      if (this.emitObject(ctx, fo, f.props) !== null) f.swallow = true;
      return;
    }
    // a citation from Zotero, Mendeley or EndNote: its items become the document's references
    const managed = /^ADDIN\s/i.test(ins) ? readCiteField(ins, f.data) : null;
    if (managed && !ctx.cell) {
      if (this.managedCite(managed, ctx, f.props)) f.swallow = true;
      return;
    }
    // a reference manager's bibliography: ours, worked out here, in its place
    const bibApp = bibFieldApp(ins);
    if (bibApp && !ctx.cell) {
      this.manager ??= bibApp;
      const id = this.emitObject(ctx, { kind: 'bib' }, f.props);
      if (id !== null) { f.swallow = true; f.toc = true; }
      return;
    }
    // a citation saved here: live again, citing the references in our part
    const cite = new RegExp(`^${CITE_FIELD}\\b(.*)$`).exec(ins);
    if (cite && this.model?.references && !ctx.cell) {
      const refs = cite[1].trim().split(/\s+/).filter(Boolean);
      const id = this.emitObject(ctx, { kind: 'cite', refs }, f.props, true);
      if (id !== null) f.swallow = true;
      return;
    }
    // a table of contents: ours again, its lines (Word's last update) left out, as they are worked out here
    const toc = /^TOC\b(.*)$/i.exec(ins);
    // a table of figures: the captions of one label (\c "Figure"), or those in the Caption style
    const fig = toc ? /\\c\s+"?([^"\\]+?)"?\s*(\\|$)/i.exec(toc[1]) ?? (/\\t\s+"?caption\b/i.test(toc[1]) ? ['', ''] : null) : null;
    if (toc && fig && !ctx.cell) {
      const id = this.emitObject(ctx, { kind: 'tof', name: fig[1].trim() }, f.props);
      if (id !== null) { f.swallow = true; f.toc = true; }
      return;
    }
    if (toc && !ctx.cell) {
      const depth = /\\o\s*"?\s*\d+\s*-\s*(\d+)/i.exec(toc[1]);
      const id = this.emitObject(ctx, { kind: 'toc', levels: Math.max(1, Math.min(3, depth ? Number(depth[1]) : 3)) }, f.props);
      if (id !== null) { f.swallow = true; f.toc = true; }
      return;
    }
    // an older Word's link: HYPERLINK "address" (or \l "bookmark"); the text it shows is the link's
    const hl = /^HYPERLINK\b(.*)$/i.exec(ins);
    if (hl) {
      const url = /^\s*"([^"]*)"/.exec(hl[1])?.[1] ?? /^\s*([^\s\\"]+)/.exec(hl[1])?.[1];
      const anchor = /\\l\s+"([^"]*)"/i.exec(hl[1])?.[1];
      const link = url ? linkFromTarget(url) + (anchor ? `#${anchor}` : '') : anchor ? `#${anchor}` : undefined;
      if (link) { f.before = { link: this.link }; this.link = link; }
      return;
    }
    if (/^ADDIN\s+(EN\.CITE|ZOTERO|CSL|Mendeley|RW)/i.test(ins) && !/^ADDIN\s+EN\.CITE\.DATA/i.test(ins)) this.warn('citations');
  }

  /** A text form field's end: what it showed is its entry (Word's five spaces for none). */
  private formEnded(f: Field): void {
    const o = this.objects[f.form!];
    if (o?.kind !== 'form') return;
    const v = f.text.replace(/^[\u2002\u00a0 ]+$/, '');
    if (v) o.value = v;
  }

  /** A reference manager's citation as ours, its items put in the document's references. True when it was put in. */
  private managedCite(c: ManagerCite, ctx: Ctx, props: RProps): boolean {
    if (!c.items.length) return false;
    this.manager ??= c.app;
    const refs: string[] = [];
    const items: Record<string, Record<string, unknown>> = {};
    for (const it of c.items) {
      const id = placeRef(this.liveRefs, it.ref);
      refs.push(id);
      if (Object.keys(it.extra).length) items[id] = it.extra;
    }
    const live: CiteLive = { app: c.app, ...(c.id ? { id: c.id } : {}), ...(Object.keys(items).length ? { items } : {}) };
    return this.emitObject(ctx, { kind: 'cite', refs, live }, props, true) !== null;
  }

  /** Zotero's document preferences: the ZOTERO_PREF_1, _2… custom document properties joined, or null. */
  private zoteroPrefs(): string | null {
    const path = this.pkg.relOfType('', REL.customProps);
    const root = path ? this.pkg.xml(path)?.documentElement : null;
    if (!root) return null;
    const parts: [number, string][] = [];
    for (const p of Array.from(root.children)) {
      const n = /^ZOTERO_PREF_(\d+)$/.exec(p.getAttribute('name') ?? '');
      if (n) parts.push([Number(n[1]), p.textContent ?? '']);
    }
    return parts.length ? parts.sort((a, b) => a[0] - b[0]).map((x) => x[1]).join('') : null;
  }

  /** A content control's tag (w:sdtPr/w:tag), or ''. */
  private sdtTag(el: Element): string {
    return this.a(kid(kid(el, 'sdtPr'), 'tag'), 'val') ?? '';
  }

  private markStart(el: Element): void {
    const name = this.a(el, 'name');
    if (name && name !== '_GoBack') this.openMarks.set(this.a(el, 'id') ?? name, name);
    if (name) this.allMarks.add(name.toLowerCase());
    // a bookmark links can go to: kept on its paragraph (hidden ones only if a link uses them: see keepUsedMarks)
    if (name && name !== '_GoBack' && !name.startsWith(BIB_MARK) && !this.pendingMarks.includes(name)) this.pendingMarks.push(name);
    if (name?.startsWith(BIB_MARK)) this.bibOpen = this.bibMet = name;
  }

  private markEnd(el: Element): void {
    const id = this.a(el, 'id') ?? '';
    if (this.openMarks.get(id)?.startsWith(BIB_MARK)) this.bibOpen = null;
    this.openMarks.delete(id);
  }

  /**
   * A bibliography saved here comes back as one: its paragraphs (inside its bookmark) become
   * the bibliography again, unless their text was changed in Word (then they stay as typed).
   */
  private joinBibliographies(): void {
    const saved = this.model?.bibliographies;
    if (!saved) return;
    const out: OutPara[] = [];
    for (let i = 0; i < this.out.length;) {
      const p = this.out[i];
      if (!p.bib) { out.push(p); i++; continue; }
      let j = i;
      while (j < this.out.length && this.out[j].bib === p.bib) j++;
      const group = this.out.slice(i, j);
      const mine = saved[Number(p.bib.slice(BIB_MARK.length))];
      const text = group.map((g) => rt.plainText(g.runs)).join('\n');
      if (mine && text === mine.text) {
        const id = this.nextId++;
        this.objects[id] = { kind: 'bib' };
        out.push({ ...p, ps: cleanPara(mine.ps ?? {}), runs: [{ ...p.mark, obj: id, text: OBJECT_CHAR }], style: mine.ps?.style ?? 'Normal', bib: undefined });
      } else out.push(...group);
      i = j;
    }
    this.out = out;
  }

  /** References point to the caption number inside their bookmark; one pointing elsewhere keeps the text Word showed. */
  private resolveRefs(): void {
    const plain = new Map<number, string>();
    // the text of the paragraph each bookmark is on (a REF field here shows a whole paragraph's)
    const markText = new Map<string, string>();
    for (const p of this.out) for (const m of p.ps.marks ?? []) if (!markText.has(m.toLowerCase())) markText.set(m.toLowerCase(), p.runs.filter((r) => r.obj === undefined).map((r) => r.text).join('').trim());
    for (const ref of this.refs) {
      const target = this.markSeq.get(ref.mark);
      const marked = this.allMarks.has(ref.mark.toLowerCase());
      if (target !== undefined && !ref.above && !ref.page) this.objects[ref.id] = { kind: 'ref', target };
      // a bookmark's page, or "above" or "below" it: a field showing it
      else if (marked && (ref.page || ref.above)) this.objects[ref.id] = { kind: 'field', code: ref.page ? 'pageref' : 'abovebelow', target: ref.mark };
      // a bookmark's text, when it is its whole paragraph (else Word's text, as a bookmark here is a paragraph)
      else if (marked && markText.get(ref.mark.toLowerCase()) === ref.text.trim() && ref.text.trim()) this.objects[ref.id] = { kind: 'field', code: 'ref', target: ref.mark };
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
    const ext = kid(box, 'extent');
    const shown = { w: fromEmu(ext?.getAttribute('cx')), h: fromEmu(ext?.getAttribute('cy')) };
    const name = kid(box, 'docPr')?.getAttribute('name') ?? '';
    // alt text: a structure's own, not the description by SMILES written when it has none
    const descr = kid(box, 'docPr')?.getAttribute('descr')?.trim() ?? '';
    const alt = descr && !/^Chemical structure( \(SMILES\): | or scheme$)/.test(descr) ? { alt: descr } : {};
    const data = kid(box, 'graphic', 'graphicData');
    const pic = kid(data, 'pic');
    const wsp = kid(data, 'wsp');
    const content = kid(wsp, 'txbx', 'txbxContent');
    if (wsp && content) {
      // a text box: its text, fill, line and place
      const spPr = kid(wsp, 'spPr');
      const look = readLook(spPr);
      const fillClr = kid(spPr, 'solidFill', 'srgbClr')?.getAttribute('val');
      const fill = fillClr && /^[0-9a-f]{6}$/i.test(fillClr) ? `#${fillClr.toLowerCase()}` : kid(spPr, 'noFill') ? undefined : kid(spPr, 'solidFill') ? '#ffffff' : undefined;
      const float = (box.localName === 'anchor' ? this.floatOf(box, look, shown.w) : null) ?? { wrap: 'topBottom' as const, x: 0, y: 0 };
      const { runs, paras } = this.boxText(content);
      const o: DocObject = { kind: 'textbox', runs, w: round(shown.w), float, ...(paras.some((q) => Object.keys(q).length) ? { paras } : {}), ...(fill ? { fill } : {}), ...(look ? { look } : {}) };
      this.emitObject(ctx, o, r);
      return;
    }
    const chartEl = kid(data, 'chart');
    if (!pic && chartEl) {
      // a chart: Word's own (its numbers come from what Word cached), or ours when it charts the same numbers
      const path = this.relTarget(rAttr(chartEl, 'id'));
      const got = path ? readChart(this.pkg, path, shown.w, shown.h) : null;
      if (!got) { this.warn('shapes'); return; }
      const mine = new RegExp(`^${CHART_NAME} (\\d+)$`).exec(name);
      const kept = mine ? this.model?.charts?.[Number(mine[1])] : undefined;
      const chosen = sizedBox(kept && sameBoxData(kept, got.box) ? freshBox(kept) : got.box, shown.w, shown.h);
      if (chosen === got.box && got.partial) this.warn('chartParts');
      const float = box.localName === 'anchor' ? this.floatOf(box, null, shown.w) : null;
      this.emitObject(ctx, { kind: 'picture', src: chartBoxPng(chosen, shown.w, shown.h), w: round(shown.w), h: round(shown.h), px: { w: chosen.chart.w, h: chosen.chart.h }, chart: chosen, ...(float ? { float } : {}), ...alt }, r);
      return;
    }
    const group = kid(data, 'wgp');
    if (!pic && !group) { this.warn('shapes'); return; }
    const float = box.localName === 'anchor' ? this.floatOf(box, pic ? readLook(kid(pic, 'spPr')) : null, shown.w) : null;
    // one of our structures (or diagrams): its drawing from our part
    const ours = new RegExp(`^${DRAWING_NAME} (\\d+)$`).exec(name);
    const m = ours ? this.model?.drawings?.[Number(ours[1])] : undefined;
    const look = pic ? readLook(kid(pic, 'spPr')) : null;
    if (m?.contents) {
      const natural = shownSize({ w: m.w, h: m.h }, 1, this.textW);
      const scale = Math.abs(natural.w - shown.w) < 0.75 || m.w <= 0 ? undefined : round(shown.w / m.w, 1e4);
      // a diagram's shapes may have been typed into in Word: their words go back into its text
      const contents = group ? retypedDiagram(structuredClone(m.contents), groupTexts(group)) : structuredClone(m.contents);
      this.emitObject(ctx, { kind: 'drawing', contents, scale, ...(look ? { look } : {}), ...(float ? { float } : {}), ...(contentsAlt(contents) ? {} : alt) }, r);
      return;
    }
    if (!pic) { this.warn('shapes'); return; }
    const blip = kid(pic, 'blipFill', 'blip');
    const svg = blip ? Array.from(blip.getElementsByTagNameNS('*', 'svgBlip'))[0] : undefined;
    let target = this.relTarget(rAttr(svg, 'embed')) ?? this.relTarget(rAttr(blip, 'embed'));
    // Picture Format: Word's effects, and the original when sharpening or Remove Background is worked into the blip
    const got = readPictureFx(blip, kid(pic, 'spPr'));
    if (got.dropped) this.warn('pictureFx');
    const fx = got.fx;
    const layer = got.layer && !svg ? this.relTarget(got.layer) : null;
    if (fx && layer && this.pkg.bytes(layer)) target = layer;
    else if (fx) { delete fx.sharpen; delete fx.bg; }
    const mine = /^Picture (\d+)$/.exec(name);
    const tol = mine ? this.model?.pictureTol?.[Number(mine[1])] : undefined;
    if (fx?.bg && typeof tol === 'number' && tol > 0 && tol <= 1) fx.bg.tol = tol;
    const sr = kid(kid(pic, 'blipFill'), 'srcRect');
    const f = (k: string) => Math.max(0, Number(sr?.getAttribute(k) ?? 0) / 100000 || 0);
    const crop = sr ? { l: f('l'), t: f('t'), r: f('r'), b: f('b') } : null;
    const more = { ...(crop && (crop.l || crop.t || crop.r || crop.b) && crop.l + crop.r < 0.99 && crop.t + crop.b < 0.99 ? { crop } : {}), ...(tidyFx(fx) ? { fx: tidyFx(fx) } : {}), ...alt };
    this.picture(target, shown, r, ctx, look, float, more);
  }

  private relTarget(id: string | null): string | null {
    if (!id) return null;
    const rel = this.pkg.rels(this.main).get(id);
    return rel && !rel.external ? rel.target : null;
  }

  private picture(path: string | null, shown: { w: number; h: number }, r: RProps, ctx: Ctx, look?: FigureLook | null, float?: Float | null, more: { crop?: { l: number; t: number; r: number; b: number }; fx?: PictureFx; embed?: Embedded; alt?: string } = {}): void {
    const bytes = path ? this.pkg.bytes(path) : null;
    if (!bytes || shown.w <= 0 || shown.h <= 0) return;
    const ext = (path ?? '').split('.').pop()?.toLowerCase() ?? '';
    const mime = EXT_MIME[ext] ?? pictureMime(path ?? '', bytes);
    if (!mime) return;
    if (mime === 'image/x-wmf') this.warn('wmf');
    // a picture pasted into Word from Chem Illustrator: the drawing rides inside it
    const inside = mime === 'image/x-emf' && !more.embed ? drawingInEmf(bytes) : null;
    if (inside && this.drawingAt(this.deps.cdxml?.(inside, this.drawingStyle) ?? null, shown, r, ctx, look, float)) return;
    const px = imageSize(bytes, mime) ?? undefined;
    this.emitObject(ctx, { kind: 'picture', src: dataUrl(bytes, mime), w: round(shown.w), h: round(shown.h), px, ...more, ...(look ? { look } : {}), ...(float ? { float } : {}) }, r);
  }

  /** Older (VML) pictures, and embedded objects with their picture: ChemDraw's become structures. */
  private vml(el: Element, r: RProps, ctx: Ctx, object: Element | null): void {
    const shape = Array.from(el.getElementsByTagNameNS('*', 'shape'))[0];
    const img = shape ? Array.from(shape.getElementsByTagNameNS('*', 'imagedata'))[0] : undefined;
    const shown = vmlSize(shape?.getAttribute('style') ?? '');
    let embed: Embedded | null = null;
    if (object) {
      const ole = Array.from(object.getElementsByTagNameNS('*', 'OLEObject'))[0];
      const prog = ole?.getAttribute('ProgID') ?? '';
      if (/^ChemDraw/i.test(prog) && this.chemdraw(ole, shown, r, ctx)) return;
      // anything else is kept whole with its picture, and goes back into the Word file as it came
      embed = ole && img ? this.embedded(ole, prog) : null;
      if (ole && !embed) this.warn('ole');
    }
    if (!img) {
      if (shape || Array.from(el.getElementsByTagNameNS('*', 'textbox')).length) this.warn('shapes');
      return;
    }
    this.picture(this.relTarget(rAttr(img, 'id')), shown, r, ctx, null, null, embed ? { embed } : {});
  }

  /** An embedded (not linked) object's part, kept as it is. */
  private embedded(ole: Element, prog: string): Embedded | null {
    if ((ole.getAttribute('Type') ?? 'Embed') !== 'Embed') return null;
    const id = rAttr(ole, 'id');
    const rel = id ? this.pkg.rels(this.main).get(id) : undefined;
    if (!rel || rel.external) return null;
    const bytes = this.pkg.bytes(rel.target);
    if (!bytes?.length) return null;
    return readEmbedded(prog, bytes, rel.target, rel.type, ole.getAttribute('DrawAspect') === 'Icon');
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
    return this.drawingAt(contents, shown, r, ctx);
  }

  /** A drawing in place of a picture, kept at the size the picture had. False when there is none. */
  private drawingAt(contents: Contents | null, shown: { w: number; h: number }, r: RProps, ctx: Ctx, look?: FigureLook | null, float?: Float | null): boolean {
    if (!contents) return false;
    const own = this.deps.drawingSize?.(contents, this.drawingStyle);
    let scale: number | undefined;
    if (own && own.w > 0 && shown.w > 0) {
      const natural = shownSize(own, 1, this.textW);
      if (Math.abs(natural.w - shown.w) > 0.01 * shown.w) scale = round(shown.w / own.w, 1e4);
    }
    return this.emitObject(ctx, { kind: 'drawing', contents, scale, ...(look ? { look } : {}), ...(float ? { float } : {}) }, r) !== null || ctx.cell;
  }

  // ---------------------------------------------------------------- tables

  private table(tbl: Element): void {
    this.pendingNotes = null;
    const tblPr = kid(tbl, 'tblPr');
    // a table from Word (or one typed into here) is a table in the text; an ACS table drawn here
    // comes back as its drawing, and a table inside a cell as a drawn table
    const cap0 = new RegExp(`^${TABLE_NAME} (\\d+)$`).exec(this.a(kid(tblPr, 'tblCaption')) ?? '');
    if (!(cap0 && this.model?.tables?.[Number(cap0[1])])) { this.textTable(tbl); return; }
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
    const np = mergeP(this.docDefaults.p, this.chain('paragraph', this.defaultPara).p);
    this.used.add(this.defaultPara);
    this.out.push({
      ps: cleanPara({ align: jc === 'left' ? undefined : jc, spaceBefore: np.before, spaceAfter: np.after, section: this.takeBreak() }),
      runs: ctx.pieces[0].runs, mark: this.runStyle(normal), style: 'Normal', contextual: false, table: true,
    });
  }

  /** Inside a table cell being read (a table in it becomes a drawn table). */
  private inCell = false;
  /** Word table styles the tables use that aren't built in here (or that Word changed), by id. */
  private tableStyles: Record<string, TableStyleDef> = {};

  /**
   * A Word table style the text's tables can be drawn in: one of ours by its id (unless the
   * file's differs), the file's own kept with the document, or null for a style that only
   * draws lines round cells (the table's lines then stand for it, as before).
   */
  private tableStyleOf(id: string): string | null {
    const chain: Element[] = [];
    const seen = new Set<string>();
    let name = id;
    for (let st = this.wstyles.get(`table:${id}`); st && !seen.has(st.id); st = st.basedOn ? this.wstyles.get(`table:${st.basedOn}`) : undefined) {
      seen.add(st.id);
      if (st.id === id) name = st.name || id;
      chain.unshift(st.el);
    }
    const ours = builtInStyle(id);
    if (!chain.length) return ours && styleIsRich(ours) ? id : null;
    const def = readTableStyle(id, name, chain, this.a.bind(this), this.on.bind(this));
    if (!styleIsRich(def)) return null;
    if (!(ours && sameStyle(ours, def))) this.tableStyles[id] = def;
    return id;
  }

  /** A Word table as a table in the text: its cells read as text is (structures and pictures kept). */
  private textTable(tbl: Element): void {
    const tblPr = kid(tbl, 'tblPr');
    const rows = kids(tbl, 'tr');
    let cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => this.tw(g, 'w') ?? 0);
    type Cell = { cell: TableCell; span: number; borders: Element | null; vm: 'restart' | 'continue' | null };
    const grid: Cell[][] = [];
    let head = 0, counting = true;
    const was = this.inCell;
    this.inCell = true;
    try {
      for (const tr of rows) {
        const trPr = kid(tr, 'trPr');
        if (counting && kid(trPr, 'tblHeader') && this.on(kid(trPr, 'tblHeader'))) head++;
        else counting = false;
        const row: Cell[] = [];
        const before = Number(this.a(kid(trPr, 'gridBefore')) ?? 0);
        for (let i = 0; i < before; i++) row.push({ cell: { runs: [] }, span: 1, borders: null, vm: null });
        for (const tc of this.cellsOf(tr)) {
          const tcPr = kid(tc, 'tcPr');
          const span = Math.max(1, Number(this.a(kid(tcPr, 'gridSpan')) ?? 1));
          // merged down a column: the first cell starts it, the ones under it carry it on
          const vmEl = kid(tcPr, 'vMerge');
          const vm = !vmEl ? null : this.a(vmEl) === 'restart' ? 'restart' : 'continue';
          const cell: TableCell = vm === 'continue' ? { runs: [] } : this.textCell(tc);
          const fill = this.a(kid(tcPr, 'shd'), 'fill');
          if (fill && /^[0-9a-f]{6}$/i.test(fill) && fill.toLowerCase() !== 'ffffff') cell.fill = `#${fill.toLowerCase()}`;
          const va = this.a(kid(tcPr, 'vAlign'));
          if (va === 'center' || va === 'bottom') cell.valign = va;
          const mar = readMargins(kid(tcPr, 'tcMar'), this.a.bind(this));
          if (vm !== 'continue' && Object.keys(mar).length) cell.pad = mar;
          row.push({ cell, span, borders: kid(tcPr, 'tcBorders'), vm });
        }
        grid.push(row);
      }
    } finally { this.inCell = was; }
    const width = Math.max(1, ...grid.map((row) => row.reduce((n, c) => n + c.span, 0)));
    if (cols.length < width) {
      const first = rows[0] ? this.cellsOf(rows[0]).map((tc) => this.tw(kid(kid(tc, 'tcPr'), 'tcW'), 'w') ?? 72) : [];
      cols = Array.from({ length: width }, (_, i) => cols[i] ?? first[i] ?? 72);
    }
    cols = cols.map((w) => round(Math.max(6, w)));
    const table: TableData = { cols, rows: [], head: 0, lines: 'none' };
    // the cell each grid column's merge down started at (while it carries on)
    const open = new Map<number, TableCell>();
    // each cell's own lines, where it sits in the table (a merged cell's from each of its rows)
    const own: (CellBorders | undefined)[][] = [];
    for (const row of grid) {
      const out: TableCell[] = [];
      const lines: (CellBorders | undefined)[] = [];
      own.push(lines);
      for (const c of row) {
        if (out.length >= cols.length) break;
        const at = out.length;
        if (c.borders) {
          const bs = readBorders(c.borders, this.a.bind(this));
          const cb: CellBorders = { ...(bs.top ? { top: bs.top } : {}), ...(bs.bottom ? { bottom: bs.bottom } : {}), ...(bs.left ? { left: bs.left } : {}), ...(bs.right ? { right: bs.right } : {}) };
          if (Object.keys(cb).length) lines[at] = cb;
        }
        const top = c.vm === 'continue' ? open.get(at) : undefined;
        if (top) top.rowSpan = (top.rowSpan ?? 1) + 1;
        else for (let k = 0; k < c.span; k++) open.delete(at + k);
        const cell = top ? { runs: [] } : c.span > 1 ? { ...c.cell, span: Math.min(c.span, cols.length - at) } : c.cell;
        out.push(cell);
        if (c.vm === 'restart') open.set(at, cell);
        for (let k = 1; k < c.span && out.length < cols.length; k++) out.push({ runs: [] });
      }
      // a column the row has no cell in ends any merge in it
      for (const k of [...open.keys()]) if (k >= out.length) open.delete(k);
      while (out.length < cols.length) out.push({ runs: [] });
      table.rows.push(out);
    }
    const style = this.a(kid(tblPr, 'tblStyle'));
    const b = new Map([...(style ? this.styleTableBorders(style) : new Map<string, boolean>()), ...this.borders(kid(tblPr, 'tblBorders'))]);
    let cellV = false, cellH = false, underRow = -1;
    grid.forEach((row, ri) => row.forEach((c) => {
      const cb = this.borders(c.borders);
      if (cb.get('left') || cb.get('right') || cb.get('start') || cb.get('end')) cellV = true;
      if (cb.get('top') || cb.get('bottom')) cellH = true;
      if (cb.get('bottom') && ri < grid.length - 1 && underRow < 0) underRow = ri;
    }));
    // the table's own lines say which (the cells' lines only when it has none; they are kept as the cells' own below)
    if (b.size) cellV = cellH = false;
    table.lines = b.get('insideV') || cellV ? 'grid' : b.get('top') || b.get('bottom') || b.get('insideH') || cellH ? 'acs' : 'none';
    table.head = head || (table.lines === 'acs' && underRow >= 0 && underRow < 3 ? underRow + 1 : 0);
    // each column lines up the way most of its cells do
    table.align = cols.map((_, ci) => {
      const count = new Map<Justify, number>();
      for (const row of table.rows) { const a = row[ci]?.align; if (a && row[ci].runs.length) count.set(a, (count.get(a) ?? 0) + 1); }
      return [...count.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'left';
    });
    table.rows.forEach((row) => row.forEach((c, ci) => { if (c.align === table.align![ci] || (!c.runs.length && c.align)) delete c.align; }));
    // a Word table style that shades or picks out parts: drawn in it here too
    const styleId = style ? this.tableStyleOf(style) : null;
    if (styleId) {
      table.style = styleId;
      const look = readTableLook(kid(tblPr, 'tblLook'), this.a.bind(this));
      if (look) table.look = look;
      if ((look?.header ?? true) && !table.head) table.head = 1;
    }
    // the cell margins, when not the standard ones
    const mar = readMargins(kid(tblPr, 'tblCellMar'), this.a.bind(this));
    if (Object.keys(mar).length) {
      const pad = { ...DEFAULT_MARGINS, ...mar };
      if (Object.entries(pad).some(([k, v]) => Math.abs(v - DEFAULT_MARGINS[k as keyof typeof DEFAULT_MARGINS]) > 0.01)) table.pad = pad;
    }
    // a cell merged down: its bottom line is the last row's
    for (let r = 0; r < table.rows.length; r++) {
      for (let c = 0; c < cols.length; c++) {
        const o = coveringCell(table, r, c);
        if (o.r === r || o.c !== c) continue;
        const b = own[r]?.[c]?.bottom;
        if (b) own[o.r][c] = { ...own[o.r][c], bottom: b };
        if (own[r]) own[r][c] = undefined;
      }
    }
    // lines Word draws that the style (or the lines chosen) here doesn't: kept as the cells' own
    const direct = styleId ? {} : readBorders(kid(tblPr, 'tblBorders'), this.a.bind(this));
    Object.assign(table, keepDirectBorders(table, direct, own, this.tableStyles));
    const jc = JUSTIFY[this.a(kid(tblPr, 'jc')) ?? 'left'] ?? 'left';
    const normal = merge<RProps>(this.docDefaults.r, this.chain('paragraph', this.defaultPara).r);
    const ctx: Ctx = { base: normal, pieces: [{ runs: [], pageBreak: false, soft: false }], cell: false };
    this.emitObject(ctx, { kind: 'table', table }, normal);
    this.used.add(this.defaultPara);
    this.out.push({
      ps: cleanPara({ align: jc === 'left' ? undefined : jc, spaceBefore: 0, spaceAfter: 0, section: this.takeBreak() }),
      runs: ctx.pieces[0].runs, mark: this.runStyle(normal), style: 'Normal', contextual: false, table: true,
    });
  }

  /**
   * A cell of a table in the text: its paragraphs read as the text's are. Structures and
   * pictures stay (in their line); text boxes and the like inside a cell are left out.
   */
  private textCell(tc: Element): TableCell {
    const { runs, paras } = this.boxText(tc);
    const kept = runs.filter((r) => {
      const o = r.obj !== undefined ? this.objects[r.obj] : undefined;
      if (!o) return true;
      if (o.kind === 'textbox' || o.kind === 'bib') { this.warn('cellBoxes'); return false; }
      if ((o.kind === 'drawing' || o.kind === 'picture') && o.float) { const { float: _, ...rest } = o; this.objects[r.obj!] = rest as DocObject; }
      return true;
    });
    let clean = rt.normalizeRuns(kept.length ? kept : runs.filter((r) => r.obj === undefined)).filter((r) => r.text);
    // the empty paragraph Word ends a cell with after a table in it (written again on saving)
    const end = clean[clean.length - 1], before = clean[clean.length - 2];
    if (end && before && end.text === '\n' && before.obj !== undefined && this.objects[before.obj]?.kind === 'table') {
      clean = clean.slice(0, -1);
      paras.pop();
    }
    const cell: TableCell = { runs: clean };
    // the first paragraph's alignment is the cell's; others keep their own when it differs
    const align = paras[0]?.align ?? 'left';
    const ps = paras.map((p) => { const q = { ...p }; if ((q.align ?? 'left') === align) delete q.align; else q.align ??= 'left'; return q; });
    if (ps.some((p) => Object.keys(p).length)) cell.paras = ps;
    if (align !== 'left') cell.align = align;
    return cell;
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

  /**
   * A section's header and footer. A later section (`prev` the one before's) with no header or
   * footer of its own takes the one before's (Word's Link to Previous: `linked`); one with only
   * a header of its own takes the footer before, and the other way round.
   */
  private readHeaderFooter(sect: Element | null, prev?: HeaderFooter): { hf: HeaderFooter; linked: boolean } {
    const hf = defaultHeaderFooter();
    hf.numbers = 'none';
    const start = Number(this.a(kid(sect, 'pgNumType'), 'start'));
    if (Number.isFinite(start) && start > 0) hf.start = Math.round(start);
    const titlePg = kid(sect, 'titlePg') !== null && this.on(kid(sect, 'titlePg'));
    const refEl = (kind: 'header' | 'footer', type: string) => kids(sect, `${kind}Reference`).find((e) => (this.a(e, 'type') ?? 'default') === type);
    const refOf = (kind: 'header' | 'footer', type: string) => this.relTarget(rAttr(refEl(kind, type), 'id'));
    const own = (kind: 'header' | 'footer') => !!refEl(kind, 'default');
    if (prev && !own('header') && !own('footer')) return { hf: { ...prev, onFirst: prev.onFirst || !titlePg }, linked: true };
    let numberedFirst = false;
    for (const kind of ['header', 'footer'] as const) {
      if (prev && !own(kind)) {
        hf[kind] = prev[kind];
        if (prev.numbers.startsWith(kind)) { hf.numbers = prev.numbers; hf.prefix = prev.prefix; }
        continue;
      }
      const part = this.hfPart(refOf(kind, 'default'));
      hf[kind] = part.zones;
      if (part.page) {
        hf.numbers = `${kind}-${['left', 'center', 'right'][part.page.zone]}` as NumberPlace;
        hf.prefix = part.page.prefix;
      }
      if (titlePg && this.hfPart(refOf(kind, 'first')).page) numberedFirst = true;
    }
    if (titlePg && hf.numbers !== 'none' && !numberedFirst) hf.onFirst = false;
    return { hf, linked: false };
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
            case 'pict': {
              // Word's watermarks: a text one is read with the page's look, a picture one is lost
              const id = Array.from(c.getElementsByTagNameNS('*', 'shape')).map((e) => e.getAttribute('id') ?? '').join(' ');
              if (/PowerPlusWaterMarkObject/.test(id)) break;
              this.warn(/WordPictureWatermark/.test(id) ? 'pictureWatermark' : 'hfPictures');
              break;
            }
            case 'drawing': case 'object': this.warn('hfPictures'); break;
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
    const p = mergeP(this.docDefaults.p, ch.p);
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
      outline: OUTLINE[ours] ?? (p.outline && p.outline <= 9 && ours !== 'Normal' ? p.outline : undefined),
    };
  }

  /** Design > Page Background: the page colour, the first section's page border and its header's text watermark. */
  private readPageLook(t: DocText, root: Element, sect: Element | null): void {
    const bg = colourOf(this.a(kid(root, 'background'), 'color'));
    if (bg && bg !== '#ffffff') t.pageColor = bg;
    const pb = kid(sect, 'pgBorders');
    const side = pb && (kid(pb, 'top') ?? kid(pb, 'left') ?? kid(pb, 'bottom') ?? kid(pb, 'right'));
    const val = this.a(side);
    if (side && val && val !== 'none' && val !== 'nil') {
      const style: PageBorder['style'] = /^thi(ck|n)Thi/.test(val) || val === 'thick' ? 'thick' : val === 'double' || val === 'triple' ? 'double' : /dot/i.test(val) && !/dash/i.test(val) ? 'dotted' : /dash/i.test(val) ? 'dashed' : 'single';
      t.pageBorder = {
        style,
        width: Math.max(0.25, Number(this.a(side, 'sz') ?? 4) / 8),
        color: colourOf(this.a(side, 'color')) ?? '#000000',
        from: this.a(pb, 'offsetFrom') === 'page' ? 'page' : 'text',
        space: Math.max(0, Number(this.a(side, 'space') ?? 0) || 0),
      };
    }
    const head = this.relTarget(rAttr(kids(sect, 'headerReference').find((e) => (this.a(e, 'type') ?? 'default') === 'default'), 'id'));
    const hroot = head ? this.pkg.xml(head)?.documentElement : null;
    const shape = hroot ? Array.from(hroot.getElementsByTagNameNS('*', 'shape')).find((e) => /^PowerPlusWaterMarkObject/.test(e.getAttribute('id') ?? '')) : undefined;
    const tp = shape && Array.from(shape.getElementsByTagNameNS('*', 'textpath'))[0];
    const text = tp?.getAttribute('string');
    if (shape && tp && text) {
      const style = shape.getAttribute('style') ?? '';
      const font = /font-family:\s*"?([^";]+)"?/.exec(tp.getAttribute('style') ?? '')?.[1]?.trim();
      const fill = (shape.getAttribute('fillcolor') ?? 'silver').trim().toLowerCase();
      const color = colourOf(fill.replace(/^#/, '')) ?? VML_COLOURS[fill.split(/\s/)[0]] ?? '#c0c0c0';
      const op = Array.from(shape.getElementsByTagNameNS('*', 'fill'))[0]?.getAttribute('opacity');
      const wm: Watermark = { text, font: font || 'Calibri', color, layout: /rotation:\s*-?\d/.test(style) && !/rotation:\s*0\b/.test(style) ? 'diagonal' : 'horizontal', faded: !!op && parseFloat(op.replace(/f$/, '')) < (op.endsWith('f') ? 65536 : 1) };
      t.watermark = wm;
    }
  }

  private assemble(hf: HeaderFooter, sect: Element | null): DocText {
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
      if (i > 0) runs.push({ ...out[i - 1].mark, ...(out[i - 1].markRev ? { rev: out[i - 1].markRev } : {}), text: '\n' });
      runs.push(...p.runs);
    });
    // (with the structures in tables' cells)
    const used = usedObjects({ runs, objects: this.objects });
    const objects: Record<number, DocObject> = {};
    for (const [k, v] of Object.entries(this.objects)) if (used.has(Number(k))) objects[Number(k)] = v;
    const m = this.model;
    // Zotero's document preferences (its style), kept to save back
    const zoteroPrefs = this.zoteroPrefs();
    const zoteroStyle = zoteroPrefs ? styleFromCsl(zoteroStyleOf(zoteroPrefs) ?? '') : null;
    const manager = this.manager ?? (m?.citeManager && m.citeManager in MANAGERS ? m.citeManager : undefined) ?? (zoteroPrefs ? 'zotero' : undefined);
    // comments: the replies' ranges are their comment's; comments with no text go
    const cm = this.readComments();
    let comments: Record<number, CommentThread> | undefined;
    if (cm) {
      for (let i = 0; i < runs.length; i++) {
        if (!runs[i].cmt) continue;
        const { cmt: _, ...rest } = runs[i];
        const ids = cmtIds(runs[i].cmt).filter((id) => cm.comments[id]);
        runs[i] = ids.length ? { ...rest, cmt: cmtString(ids) } : rest;
      }
      const on = new Set(runs.flatMap((r) => cmtIds(r.cmt)));
      comments = {};
      for (const [id, c] of Object.entries(cm.comments)) if (on.has(Number(id))) comments[Number(id)] = c;
      if (!Object.keys(comments).length) comments = undefined;
    } else for (let i = 0; i < runs.length; i++) if (runs[i].cmt) { const { cmt: _, ...rest } = runs[i]; runs[i] = rest; }
    return {
      runs: rt.normalizeRuns(runs),
      ...(comments ? { comments } : {}),
      paras: out.map((p) => cleanPara(p.ps)),
      justify: 'left',
      styles,
      page: this.page,
      hf,
      objects,
      drawingStyle: this.drawingStyle,
      ...(this.trackOn() ? { track: true } : {}),
      ...(this.hyphenRead() ? { hyphen: this.hyphenRead()! } : {}),
      ...(this.protection() ? { protect: this.protection()! } : {}),
      ...(this.charStylesRead() ? { charStyles: this.charStylesRead() } : {}),
      ...(this.numFormatOf(sect) !== 'decimal' ? { numFormat: this.numFormatOf(sect) } : {}),
      ...(this.lineNumbersOf(sect) ? { lineNumbers: this.lineNumbersOf(sect) } : {}),
      ...(Object.keys(this.noteFormats).length ? { notes: this.noteFormats } : {}),
      ...(Object.keys(this.tableStyles).length ? { tableStyles: this.tableStyles } : {}),
      ...(this.liveRefs.length || Array.isArray(m?.references) ? { references: this.liveRefs } : {}),
      ...(typeof m?.citeStyle === 'string' && m.citeStyle in CITE_PRESETS ? { citeStyle: m.citeStyle } : zoteroStyle ? { citeStyle: zoteroStyle } : {}),
      ...(manager ? { citeManager: manager } : {}),
      ...(zoteroPrefs ? { zoteroPrefs } : {}),
      ...(m?.citeOptions && Object.keys(cleanOptions(m.citeOptions)).length ? { citeOptions: cleanOptions(m.citeOptions) } : {}),
    };
  }
}

const BUILT_IN_IDS: Record<string, true> = { Normal: true, Title: true, Caption: true, ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`Heading${n}`, true as const])) };

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

/** A picture's line and shadow (Word's Picture Format) as a frame and one of our two shadows. */
export function readLook(spPr: Element | null): FigureLook | null {
  if (!spPr) return null;
  const look: FigureLook = {};
  const ln = kid(spPr, 'ln');
  if (ln && !kid(ln, 'noFill')) {
    const w = fromEmu(ln.getAttribute('w') ?? '9525');
    const clr = kid(ln, 'solidFill', 'srgbClr')?.getAttribute('val');
    if (kid(ln, 'solidFill') && w > 0) {
      look.frame = Math.round(w * 100) / 100;
      if (clr && /^[0-9a-f]{6}$/i.test(clr) && clr.toLowerCase() !== '000000') look.frameColor = `#${clr.toLowerCase()}`;
    }
  }
  const sh = kid(spPr, 'effectLst', 'outerShdw');
  if (sh) look.shadow = fromEmu(sh.getAttribute('blurRad') ?? '0') >= 1.5 ? 'soft' : 'hard';
  return look.frame || look.shadow ? look : null;
}

/** The words in each named shape of a Word group (its paragraphs joined by line breaks), by name. */
function groupTexts(group: Element): Map<string, string> {
  const out = new Map<string, string>();
  for (const sp of Array.from(group.getElementsByTagNameNS('*', 'wsp'))) {
    const name = kid(sp, 'cNvPr')?.getAttribute('name');
    const content = kid(sp, 'txbx', 'txbxContent');
    if (!name || !content) continue;
    const paras = kids(content, 'p').map((p) => Array.from(p.getElementsByTagNameNS('*', 't')).map((t) => t.textContent ?? '').join('').replace(/^•\s*/, ''));
    out.set(name, paras.join('\n'));
  }
  return out;
}

/**
 * Bookmarks kept on paragraphs: those named by people, and Word's hidden ones (_Toc…, _Ref…)
 * only where a link here goes to them, so a document's every heading doesn't carry Word's own.
 */
function keepUsedMarks(t: DocText): void {
  if (!t.paras.some((p) => p?.marks)) return;
  const used = new Set<string>();
  const note = (runs: TextRun[]) => { for (const r of runs) if (r.link?.startsWith('#')) used.add(r.link.slice(1).toLowerCase()); };
  note(t.runs);
  for (const o of Object.values(t.objects)) {
    if (o.kind === 'field' && o.target) used.add(o.target.toLowerCase());
    if (o.kind === 'note' || o.kind === 'textbox') note(o.runs);
    if (o.kind === 'table') for (const row of o.table.rows) for (const c of row) note(c.runs);
  }
  t.paras = t.paras.map((p) => {
    if (!p?.marks) return p;
    const marks = p.marks.filter((m) => !m.startsWith('_') || used.has(m.toLowerCase()));
    const { marks: _m, ...rest } = p;
    return marks.length ? { ...rest, marks } : rest;
  });
}

/** A Word colour ("FF0000", "auto") as ours (null for automatic or none). */
function colourOf(v: string | null | undefined): string | null {
  return v && /^[0-9a-f]{6}$/i.test(v) ? `#${v.toLowerCase()}` : null;
}

/**
 * The multilevel scheme a numbered list's levels are (its id), '' for the usual 1. a. i., or
 * null when none here writes its numbers the way the file does. Levels the file leaves out
 * don't count; the level the paragraph is at must match.
 */
function schemeFor(levels: Level[], ilvl: number): string | null {
  const same = (l: Level | undefined, i: number, s: (typeof LIST_SCHEMES)[number]) => !!l && l.fmt === s.levels[i].fmt && l.text === s.levels[i].text;
  const fits = LIST_SCHEMES.filter((s) => same(levels[ilvl], ilvl, s));
  if (!fits.length) return null;
  return (fits.find((s) => levels.every((l, i) => !l || l.fmt === 'bullet' || l.fmt === 'none' || i > 8 || same(l, i, s))) ?? fits[0]).id;
}
