// Word files (.docx): what saving and opening share. A Word file is a zip of XML parts
// (Office Open XML, ECMA-376 part 1, the WordprocessingML chapters). Text, styles, lists,
// tables, captions and cross-references are written as Word's own, so Word can edit them;
// structures go in as pictures (sharp: SVG with a PNG for older Word), and our own part
// (customXml) keeps each structure's drawing, so it can be edited here again even after the
// file has been changed in Word.

import type { Contents, ParaStyle, TableData } from '../model';
import type { DocStyle } from '../style';
import type { CiteStyle, Reference } from '../document/references';
import type { CiteFormat } from '../document/cite-styles';
import type { ChartBox } from '../sheet/chart-box';

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
export const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
/** Word 2010's shapes (text boxes), and the markup that lets older programs skip them. */
export const WPS_NS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
/** Word 2010's groups of shapes. */
export const WPG_NS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
export const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
/** Office Math: Word's equations. */
export const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
export const MODEL_NS = 'urn:chem-illustrator:document';

export const DOCX_CT = {
  document: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  styles: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
  numbering: 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
  settings: 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
  header: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  footer: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
  app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
  itemProps: 'application/vnd.openxmlformats-officedocument.customXmlProperties+xml',
  fontTable: 'application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml',
  font: 'application/vnd.openxmlformats-officedocument.obfuscatedFont',
  comments: 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml',
  commentsExtended: 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml',
};

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
export const DOCX_REL = {
  styles: R + 'styles',
  numbering: R + 'numbering',
  settings: R + 'settings',
  header: R + 'header',
  footer: R + 'footer',
  image: R + 'image',
  theme: R + 'theme',
  oleObject: R + 'oleObject',
  customXml: R + 'customXml',
  customXmlProps: R + 'customXmlProps',
  fontTable: R + 'fontTable',
  font: R + 'font',
  comments: R + 'comments',
  /** Word 2013's part saying which comments are replies, and which are resolved. */
  commentsExtended: 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended',
  /** Word 365's parts giving each comment a lasting id, and that id its time in UTC. */
  commentsIds: 'http://schemas.microsoft.com/office/2016/09/relationships/commentsIds',
  commentsExtensible: 'http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible',
};

/** Word 2010's and 2013's additions (paragraph ids, and the comments' replies and Resolved marks). */
export const W14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';
export const W15_NS = 'http://schemas.microsoft.com/office/word/2012/wordml';
export const W16CID_NS = 'http://schemas.microsoft.com/office/word/2016/wordml/cid';
export const W16CEX_NS = 'http://schemas.microsoft.com/office/word/2018/wordml/cex';

/**
 * Word's w:date is the writer's local clock time, though it ends in Z (the real UTC time, when
 * there is one, is in commentsExtensible.xml). These convert between that and an ISO date.
 */
export function toWordDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}Z`;
}
export function fromWordDate(s: string): string {
  const d = new Date(s.replace(/Z$/i, ''));
  return isNaN(d.getTime()) ? s : d.toISOString();
}

/** Names Word's pictures of our drawings carry (kept by Word), so each can be found again. */
export const DRAWING_NAME = 'Chem Illustrator drawing';
/** Alternative text Word's tables of ours carry. */
export const TABLE_NAME = 'Chem Illustrator table';
/** The character style that marks chemical formulas (CH₂Cl₂), so they stay formulas here. */
export const FORMULA_STYLE = 'ChemFormula';

/** What our own part holds: what Word can't. */
export interface DocxModel {
  app: 'Chem Illustrator';
  version: 1;
  drawingStyle: DocStyle;
  /** Each drawing by its id: what it is, and its picture's own size (for its scale). */
  drawings: Record<number, { contents: Contents; w: number; h: number }>;
  /** Each table by its id, with its text (used when the text is the same in the file). */
  tables: Record<number, { table: TableData; text: string }>;
  /** The document's references and citation style (citations are ADDIN fields naming them). */
  references?: Reference[];
  citeStyle?: CiteStyle;
  citeOptions?: Partial<CiteFormat>;
  /** Each bibliography by its id: the text written (to tell whether Word changed it) and its paragraph's settings. */
  bibliographies?: Record<number, { text: string; ps: ParaStyle }>;
  /** Each chart by its id, as made here (used when Word's copy charts the same numbers). */
  charts?: Record<number, ChartBox>;
}

/** The name of a chart's frame in Word ("Chart 4", 4 its id in our part). */
export const CHART_NAME = 'Chart';

/** The field instruction of a citation: Word shows the numbers written as its result and leaves them alone. */
export const CITE_FIELD = 'ADDIN CHEMILLUSTRATOR_CITE';
/** Bookmarks round a bibliography's paragraphs (hidden in Word: they start with _). */
export const BIB_MARK = '_ChemBib';

/** Points to twentieths of a point (twips), Word's measure for page and paragraph settings. */
export const twips = (pt: number): number => Math.round(pt * 20);

export { writeDocx, type DocxDeps } from './docx-write';
export { readDocx, type DocxReadDeps } from './docx-read';

/** Word's highlighter colours (w:highlight) and the colours they show. */
export const WORD_HIGHLIGHTS: Record<string, string> = {
  yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000',
  darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000',
  darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000', white: '#ffffff',
};
