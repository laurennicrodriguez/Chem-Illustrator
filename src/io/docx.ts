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

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
export const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
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
};

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
}

/** The field instruction of a citation: Word shows the numbers written as its result and leaves them alone. */
export const CITE_FIELD = 'ADDIN CHEMILLUSTRATOR_CITE';
/** Bookmarks round a bibliography's paragraphs (hidden in Word: they start with _). */
export const BIB_MARK = '_ChemBib';

/** Points to twentieths of a point (twips), Word's measure for page and paragraph settings. */
export const twips = (pt: number): number => Math.round(pt * 20);

export { writeDocx, type DocxDeps } from './docx-write';
export { readDocx, type DocxReadDeps } from './docx-read';
