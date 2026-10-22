// Excel workbooks (.xlsx), following the published Office Open XML standard (ECMA-376, part 1,
// SpreadsheetML). Excel gets everything it can show for itself: values, its own formulas, number
// formats, fonts, fills, borders, alignment, merged cells, column widths and row heights, frozen
// header rows, the filter, notes and comments, and data validation. Structures go in as pictures
// over their cells, with the SMILES in the cell (in the formula bar, for formulas and copying; the
// cell's format hides it, since Excel sizes columns a little differently on each screen and would
// show it at the picture's edge);
// property columns and formulas that use chemistry (MW, HRMS…) go in as their values,
// since Excel can't work those out.
//
// What only this program understands (the drawings, property columns, chemistry formulas,
// substructure filters) is kept in a part of the file Excel keeps but doesn't show (a "custom XML
// part"). On opening, each piece of it is used only where the cell still holds what was saved:
// a structure whose SMILES was changed in Excel, or a calculated value typed over there, stays
// as Excel left it.

import { Package, PackageReader, xml, xmlAttr, hex6, REL, kids, kid, rAttr } from './ooxml';
import { officeTarget, linkFromTarget } from '../links';
import { Workbook, Sheet, Structure, CellStyle, ColumnDef, Filter, Condition, CompareOp, Border, BorderStyle, Side, makeStructure } from '../sheet/workbook';
import { keyOf, rowOf, colOf, colName, cellName, parseRange, quoteSheet, Range, MAX_COLS, rangesOverlap, rangeName, inRange } from '../sheet/refs';
import { normalizeFormula, shiftFormula } from '../sheet/formula';
import { fileFormula, legacyFormula, needsDynamic, readFileFormula } from '../sheet/array-formulas';
import { DefinedName, isBuiltInName } from '../sheet/names';
import { FUNCTION_NAMES } from '../sheet/evaluate';
import { readTyped, isError, CellError, Value, EXCEL_ERRORS } from '../sheet/values';
import { PROPERTIES } from '../sheet/properties';
import { ISOTOPE_FUNCTIONS } from '../sheet/isotopes';
import { chemPieces, showsChem } from '../sheet/cell-text';
import { DEFAULT_COL_W, DEFAULT_ROW_H, MAX_AUTO_ROW, structureHeight } from '../sheet/layout';
import type { Contents } from '../model';
import type { DocStyle } from '../style';
import { applyTint } from '../colours';
import { chartXml, chartAnchorXml, readChartXml, CT_CHART, REL_CHART, C_NS, CX_NS, CT_CHARTEX, REL_CHARTEX } from './xlsx-chart';
import { Chart, chartData, seenChartId, newChartId, sameChartData, isChartEx } from '../sheet/chart';
import { dashboardStandIn } from './xlsx-dashboard';
import { Dashboard, seenTileId } from '../sheet/dashboard';
import { condFormatsXml, dxfXml, tableXml, readDxfs, readCondFormats, readTable, sameRules } from './xlsx-format';
import type { CondFormat, CfLook } from '../sheet/conditional';
import { seenCondFormatId } from '../sheet/conditional';
import { TableDef, tableColumnNames, seenTableId } from '../sheet/table-styles';
import { pageSetupXml, printNames, readPageSetup, objectAnchorXml, readObjects, ReadAnchor } from './xlsx-print';
import { dataUrlBytes, bytesDataUrl, seenObjectId } from '../sheet/sheet-objects';
import { dataTableXml, readDataTable, pivotParts, readPivot, samePivot, PIVOT_CT, PIVOT_REL } from './xlsx-pivot';
import { type DataTable, seenDataTableId } from '../sheet/what-if';
import { type PivotTable, seenPivotId } from '../sheet/pivot';
import { Persons, notesParts, readNotes, shownNotes, validationsXml, readValidations, NOTES_CT, NOTES_REL } from './xlsx-notes';
import { textRotation, readTextRotation, sheetViewAttrs, readSheetViewOpts, outlinePrXml, outlineLevelAttrs, outlineAttrs, sparklinesExt, readSparklines, customWorkbookViewsXml, customSheetViewsXml, readCustomViews, themeXml, readWorkbookTheme } from './xlsx-view';
import { CELL_STYLES, cellStyleNamed, cellStylePatch, cellStyleBorders } from '../sheet/cell-styles';
import type { WorkbookTheme } from '../sheet/themes';
import { themeOf } from '../sheet/themes';
import type { CustomView } from '../sheet/views';
import { seenSparkId } from '../sheet/sparklines';
export { applyTint };

/** Pictures of structures for Excel (the app draws them; tests use stand-ins). */
export interface XlsxPictures {
  /** A structure's size in points, as drawn in cells. */
  box(s: Structure, style: DocStyle): { w: number; h: number };
  /**
   * A picture covering a cell `w` × `h` pixels (at 100%): the cell's fill, with the structure
   * shrunk to fit and placed by the cell's alignment, as the grid shows it. PNG bytes.
   */
  picture(s: Structure, style: DocStyle, cell: { w: number; h: number; fill?: string; align?: CellStyle['align']; valign?: CellStyle['valign'] }): Promise<Uint8Array | null>;
  /** Heights of rows that grow to fit wrapped text, in pixels (the grid measures the text). */
  rowHeights?(s: Sheet): Map<number, number>;
}

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const DML = 'http://schemas.openxmlformats.org/drawingml/2006/main';
/** Our own part's namespace. */
const MODEL_NS = 'urn:chem-illustrator:workbook';

const CT = {
  workbook: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  sheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
  styles: 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml',
  strings: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml',
  drawing: 'application/vnd.openxmlformats-officedocument.drawing+xml',
  table: 'application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
  app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
  itemProps: 'application/vnd.openxmlformats-officedocument.customXmlProperties+xml',
  metadata: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
};

const RELS = {
  worksheet: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet',
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  sharedStrings: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings',
  drawing: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing',
  table: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/table',
  theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
  customXml: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml',
  customXmlProps: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps',
  metadata: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata',
};

/**
 * The cell metadata that marks a formula as a dynamic array formula (cm="1" on its cell), as
 * Excel writes it: without it Excel works a formula out the old way, one value per cell.
 */
const DYNAMIC_ARRAY_METADATA = `<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray">` +
  `<metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes>` +
  `<futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata>` +
  `<cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>`;

/** Pixels to Office's drawing units (EMU): 9525 to the pixel at 96 to the inch. */
const PX = 9525;

/**
 * Column widths: Excel counts in widths of a digit of Calibri 11 (7 pixels), with 5 pixels of
 * padding, and rounds as ECMA-376 part 1, 18.3.1.13 says (64 pixels is 9.140625).
 */
const widthFromPx = (px: number) => {
  const chars = Math.trunc((Math.max(0, px - 5) / 7) * 100 + 0.5) / 100;
  return Math.trunc(((chars * 7 + 5) / 7) * 256) / 256;
};
const pxFromWidth = (w: number) => Math.trunc(((256 * w + Math.trunc(128 / 7)) / 256) * 7);
/** Row heights: points in the file, pixels here. */
const ptFromPx = (px: number) => Math.round(px * 0.75 * 100) / 100;
const pxFromPt = (pt: number) => Math.round((pt * 4) / 3);

/** A number format that shows nothing (empty sections for numbers, negatives, zero and text). */
const HIDDEN = ';;;';

/** Excel's built-in number formats (ECMA-376 part 1, 18.8.30), by id. */
const BUILTIN_FORMATS: Record<number, string> = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??',
  14: 'm/d/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss',
  22: 'm/d/yyyy h:mm', 37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)',
  45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@',
};

const CHEM_FUNCTION = new RegExp(`\\b(${[...Object.keys(PROPERTIES), ...Object.keys(ISOTOPE_FUNCTIONS)].join('|')})\\s*\\(`, 'i');
// Functions newer than Excel 2007 are written in the file with a prefix (_xlfn.), which Excel
// needs to know them; reading a file takes the prefix off, so saving puts it back.
const XLFN = new Set(['AGGREGATE', 'BETA.DIST', 'BETA.INV', 'BINOM.DIST', 'BINOM.INV', 'CEILING.MATH', 'CHISQ.DIST', 'CHISQ.DIST.RT',
  'CHISQ.INV', 'CHISQ.INV.RT', 'CHISQ.TEST', 'CONCAT', 'CONFIDENCE.NORM', 'CONFIDENCE.T', 'COVARIANCE.P', 'COVARIANCE.S', 'DAYS',
  'ERF.PRECISE', 'ERFC.PRECISE', 'EXPON.DIST', 'F.DIST', 'F.DIST.RT', 'F.INV', 'F.INV.RT', 'F.TEST', 'FLOOR.MATH', 'FORECAST.LINEAR', 'GAMMA', 'GAMMA.DIST',
  'GAMMA.INV', 'GAMMALN.PRECISE', 'GAUSS', 'IFNA', 'IFS', 'ISOWEEKNUM', 'LET', 'LOGNORM.DIST', 'LOGNORM.INV', 'MAXIFS', 'MINIFS',
  'MODE.MULT', 'MODE.SNGL', 'NORM.DIST', 'NORM.INV', 'NORM.S.DIST', 'NORM.S.INV', 'PERCENTILE.EXC', 'PERCENTILE.INC',
  'PERCENTRANK.EXC', 'PERCENTRANK.INC', 'POISSON.DIST', 'QUARTILE.EXC', 'QUARTILE.INC', 'RANK.AVG', 'RANK.EQ', 'SEQUENCE',
  'STDEV.P', 'STDEV.S', 'SWITCH', 'T.DIST', 'T.DIST.2T', 'T.DIST.RT', 'T.INV', 'T.INV.2T', 'T.TEST', 'TEXTJOIN', 'TEXTSPLIT', 'UNIQUE',
  'VAR.P', 'VAR.S', 'WEIBULL.DIST', 'XLOOKUP', 'XMATCH', 'XOR', 'Z.TEST', 'NETWORKDAYS.INTL', 'WORKDAY.INTL', 'LAMBDA', 'MAP', 'REDUCE',
  'SCAN', 'BYROW', 'BYCOL', 'MAKEARRAY', 'ISOMITTED', 'VSTACK', 'HSTACK', 'TAKE', 'DROP', 'CHOOSEROWS', 'CHOOSECOLS', 'TOCOL', 'TOROW',
  'RANDARRAY', 'EXPAND', 'WRAPROWS', 'WRAPCOLS']);
const XLWS = new Set(['FILTER', 'SORT', 'SORTBY']);

/** A formula (without its =) with Excel's prefixes on the newer functions, leaving text in quotes alone. */
export function excelFunctionNames(f: string): string {
  return f.split(/("(?:[^"]|"")*")/).map((part, i) => (i % 2 ? part : part.replace(/(^|[^A-Za-z0-9_.])([A-Za-z][A-Za-z0-9.]*)(?=\()/g, (m, before: string, name: string) => {
    const up = name.toUpperCase();
    return XLWS.has(up) ? `${before}_xlfn._xlws.${name}` : XLFN.has(up) ? `${before}_xlfn.${name}` : m;
  }))).join('');
}

const KNOWN = new Set(FUNCTION_NAMES);

/** Does a formula from Excel use something this program can't work out (a newer function it lacks, or a table reference)? */
function usesUnknownFunction(text: string): boolean {
  if (/\[/.test(text.replace(/"(?:[^"]|"")*"/g, ''))) return true;
  for (const m of text.matchAll(/_xlfn\.(?:_xlws\.)?([A-Za-z0-9.]+)\(/g)) if (!KNOWN.has(m[1].toUpperCase())) return true;
  return false;
}

/** Does a formula use a chemistry function (which Excel can't work out)? */
export function usesChemistry(formula: string): boolean {
  return CHEM_FUNCTION.test(formula.replace(/"(?:[^"]|"")*"/g, '""'));
}

// ---------------------------------------------------------------- what only this program reads

/** What a cell held when saved, to tell on opening whether Excel changed it. */
type Wrote = number | string | boolean | null;

interface ModelCell {
  r: number;
  c: number;
  /** The value saved in the cell. */
  wrote: Wrote;
  /**
   * Formatting Excel can't hold, or was given differently: chemistry text, and for a structure
   * its own number format (its SMILES is written with a format that hides it).
   */
  fix?: { chem?: boolean; numFmt?: string | null };
  structure?: Contents;
  /** A formula using chemistry, saved as its value. */
  formula?: string;
  /** The last row and column of the array it spilled (its other cells were saved as values). */
  spill?: [number, number];
  /** Worked out by its property column. */
  computed?: true;
}

interface ModelSheet {
  name: string;
  cells: ModelCell[];
  defs: { col: number; def: ColumnDef }[];
  /** Columns formatted as chemistry. */
  chemCols: number[];
  filter: Filter | null;
  /** Rows grown to fit (Excel is given them as set heights), with their heights in pixels: they keep fitting here. */
  autoRows?: [number, number][];
  /** Conditional formatting and tables as this program holds them (Excel's own copy can't say everything). */
  condFormats?: CondFormat[];
  tables?: TableDef[];
  charts?: Chart[];
  /** A dashboard sheet: Excel was given a stand-in (charts and cells), this is the dashboard itself. */
  dashboard?: Dashboard;
  /** Data tables and PivotTables as this program holds them (with their ids, which charts point at). */
  dataTables?: DataTable[];
  pivots?: PivotTable[];
}

interface Model {
  app: 'Chem Illustrator';
  version: 1;
  drawingStyle: DocStyle;
  sheets: ModelSheet[];
  /** Custom views as this program holds them (Excel's copy can't say which rows each hides, or its print settings). */
  customViews?: CustomView[];
}

// ---------------------------------------------------------------- writing: styles

class Styles {
  /** The body font of the workbook's theme: cells with no font of their own. */
  private minor: string;
  private fonts: string[];
  /** Named cell styles (Good, Heading 1…): the base formats cells point at, by name. */
  private named = new Map<string, number>();
  private namedXfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>'];

  constructor(private theme: WorkbookTheme | null = null) {
    this.minor = themeOf(theme).minor;
    this.fonts = [`<font><sz val="11"/><color theme="1"/><name val="${xml(this.minor)}"/><family val="2"/><scheme val="minor"/></font>`];
  }

  private fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  private borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  private formats = new Map<string, number>();
  private xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private byKey = new Map<string, number>([['{}', 0]]);
  private dxfs: string[] = [];

  /** The number of a highlight look (conditional formatting). */
  dxf(l: CfLook): number {
    return this.index(this.dxfs, dxfXml(l));
  }

  private index(list: string[], item: string): number {
    const i = list.indexOf(item);
    if (i >= 0) return i;
    list.push(item);
    return list.length - 1;
  }

  private numFmt(code: string | undefined): number {
    if (!code || /^general$/i.test(code)) return 0;
    for (const [id, c] of Object.entries(BUILTIN_FORMATS)) if (c === code && Number(id) < 14 || (c === code && Number(id) === 49)) return Number(id);
    let id = this.formats.get(code);
    if (id === undefined) { id = 164 + this.formats.size; this.formats.set(code, id); }
    return id;
  }

  /** The style index for a cell's formatting. */
  xf(st: CellStyle | undefined): number {
    const s = st ?? {};
    const key = JSON.stringify([s.bold, s.italic, s.underline, s.color, s.fill, s.font, s.size, s.align, s.valign, s.wrap, s.numFmt, s.borders, s.indent, s.rotate, s.cellStyle]);
    const got = this.byKey.get(key);
    if (got !== undefined) return got;
    const { font, fill, border } = this.parts(s);
    const fmt = this.numFmt(s.numFmt);
    // an indent needs the text aligned to a side (left when it isn't set)
    const horizontal = s.align ?? (s.indent ? 'left' : undefined);
    const align = horizontal || s.valign || s.wrap || s.rotate
      ? `<alignment${horizontal ? ` horizontal="${horizontal}"` : ''}${s.valign && s.valign !== 'bottom' ? ` vertical="${s.valign === 'middle' ? 'center' : 'top'}"` : ''}${s.rotate ? ` textRotation="${textRotation(s.rotate)}"` : ''}${s.wrap ? ' wrapText="1"' : ''}${s.indent && horizontal !== 'center' ? ` indent="${s.indent}"` : ''}/>`
      : '';
    const xfId = s.cellStyle ? this.namedStyle(s.cellStyle) : 0;
    const x = `<xf numFmtId="${fmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="${xfId}"` +
      `${fmt ? ' applyNumberFormat="1"' : ''}${font ? ' applyFont="1"' : ''}${fill ? ' applyFill="1"' : ''}${border ? ' applyBorder="1"' : ''}` +
      `${align ? ` applyAlignment="1">${align}</xf>` : '/>'}`;
    this.xfs.push(x);
    const i = this.xfs.length - 1;
    this.byKey.set(key, i);
    return i;
  }

  /** The font, fill and border numbers for a look. */
  private parts(s: CellStyle): { font: number; fill: number; border: number } {
    const font = s.bold || s.italic || s.underline || s.color || s.font || s.size
      ? this.index(this.fonts, `<font>${s.bold ? '<b/>' : ''}${s.italic ? '<i/>' : ''}${s.underline ? '<u/>' : ''}<sz val="${s.size ?? 11}"/>` +
        `${s.color ? `<color rgb="FF${hex6(s.color)}"/>` : '<color theme="1"/>'}<name val="${xml(s.font ?? this.minor)}"/><family val="2"/>${s.font ? '' : '<scheme val="minor"/>'}</font>`)
      : 0;
    const fill = s.fill ? this.index(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${hex6(s.fill)}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const side = (name: Side) => {
      const b = s.borders?.[name];
      return b ? `<${name} style="${borderName(b.style)}"><color rgb="FF${hex6(b.color ?? '#000000')}"/></${name}>` : `<${name}/>`;
    };
    const border = s.borders && Object.keys(s.borders).length
      ? this.index(this.borders, `<border>${side('left')}${side('right')}${side('top')}${side('bottom')}<diagonal/></border>`)
      : 0;
    return { font, fill, border };
  }

  /** The base format of a named cell style (Excel's cellStyleXfs), added the first time it is used. */
  private namedStyle(name: string): number {
    const def = cellStyleNamed(name);
    if (!def) return 0;
    let i = this.named.get(def.name);
    if (i !== undefined) return i;
    const look = { ...cellStylePatch(def.name, this.theme), borders: cellStyleBorders(def.name, this.theme) } as CellStyle;
    const { font, fill, border } = this.parts(look);
    const fmt = this.numFmt(look.numFmt);
    this.namedXfs.push(`<xf numFmtId="${fmt}" fontId="${font}" fillId="${fill}" borderId="${border}"${def.group === 'Number Format' ? ' applyFont="0" applyFill="0" applyBorder="0" applyAlignment="0" applyProtection="0"' : ' applyAlignment="0" applyProtection="0"'}/>`);
    i = this.namedXfs.length - 1;
    this.named.set(def.name, i);
    return i;
  }

  toXml(): string {
    const fmts = [...this.formats].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${xml(code)}"/>`).join('');
    return `${HEAD}<styleSheet xmlns="${MAIN}">` +
      (this.formats.size ? `<numFmts count="${this.formats.size}">${fmts}</numFmts>` : '') +
      `<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join('')}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join('')}</borders>` +
      `<cellStyleXfs count="${this.namedXfs.length}">${this.namedXfs.join('')}</cellStyleXfs>` +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>` +
      `<cellStyles count="${this.named.size + 1}"><cellStyle name="Normal" xfId="0" builtinId="0"/>${[...this.named].map(([n, i]) => `<cellStyle name="${xmlAttr(n)}" xfId="${i}" builtinId="${cellStyleNamed(n)!.builtinId}"/>`).join('')}</cellStyles>` +
      `<dxfs count="${this.dxfs.length}">${this.dxfs.join('')}</dxfs><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;
  }
}

function borderName(b: BorderStyle): string {
  return b === 'dashed' ? 'dashed' : b === 'dotted' ? 'dotted' : b;
}

/** Shared strings: each text once; chemistry text (C9H8O4) with its numbers lowered. */
class Strings {
  private list: string[] = [];
  private byKey = new Map<string, number>();
  count = 0;

  index(text: string, chem: boolean): number {
    this.count++;
    const pieces = chem ? chemPieces(text) : null;
    const rich = !!pieces && pieces.some((p) => p.pos !== 'base' || p.italic);
    const key = (rich ? '1' : '0') + text;
    const got = this.byKey.get(key);
    if (got !== undefined) return got;
    const t = (s: string) => `<t${/^\s|\s$|\n/.test(s) ? ' xml:space="preserve"' : ''}>${xml(excelEscape(s))}</t>`;
    this.list.push(rich
      ? `<si>${pieces!.map((p) => `<r>${p.pos !== 'base' || p.italic ? `<rPr>${p.italic ? '<i/>' : ''}${p.pos !== 'base' ? `<vertAlign val="${p.pos === 'sub' ? 'subscript' : 'superscript'}"/>` : ''}</rPr>` : ''}${t(p.text)}</r>`).join('')}</si>`
      : `<si>${t(text)}</si>`);
    this.byKey.set(key, this.list.length - 1);
    return this.list.length - 1;
  }

  toXml(): string {
    return `${HEAD}<sst xmlns="${MAIN}" count="${this.count}" uniqueCount="${this.list.length}">${this.list.join('')}</sst>`;
  }
}

// ---------------------------------------------------------------- writing

/** Rows and columns as pixel positions, for placing pictures. */
class Axis {
  private starts: number[] = [0];
  constructor(private size: (i: number) => number) {}
  start(i: number): number {
    while (this.starts.length <= i) this.starts.push(this.starts[this.starts.length - 1] + this.size(this.starts.length - 1));
    return this.starts[i];
  }
  /** The row or column a position falls in (hidden ones skipped), and how far into it. */
  at(px: number, from: number): { i: number; off: number } {
    let i = from;
    while (this.start(i + 1) <= px) i++;
    return { i, off: px - this.start(i) };
  }
}

/** Save a workbook as an Excel file. */
export async function writeXlsx(book: Workbook, deps: XlsxPictures): Promise<Uint8Array> {
  const pkg = new Package();
  const styles = new Styles(book.theme);
  const strings = new Strings();
  const model: Model = { app: 'Chem Illustrator', version: 1, drawingStyle: book.drawingStyle, sheets: [], ...(book.customViews.length ? { customViews: book.customViews } : {}) };
  const sheetEntries: string[] = [];
  const filterNames: string[] = [];
  const printTitleNames: string[] = [];
  let imageNo = 0, drawingNo = 0, tableNo = 0, chartNo = 0, notesNo = 0, pivotNo = 0;
  const pivotCaches: string[] = [];
  let anyDynamic = false;
  const persons = new Persons();
  pkg.defaultType('png', 'image/png');

  for (let si = 0; si < book.sheets.length; si++) {
    const own = book.sheets[si];
    // a dashboard goes to Excel as a stand-in sheet of charts and cells
    const standIn = own.dashboard ? dashboardStandIn(book, own) : null;
    const s = standIn?.sheet ?? own;
    const path = `xl/worksheets/sheet${si + 1}.xml`;
    const ms: ModelSheet = { name: s.name, cells: [], defs: [...s.colDefs].map(([col, def]) => ({ col, def })), chemCols: [], filter: s.filter };
    if (s.condFormats.length) ms.condFormats = s.condFormats;
    if (s.tables.length) ms.tables = s.tables;
    if (s.charts.length && !own.dashboard) ms.charts = s.charts;
    if (own.dashboard) ms.dashboard = own.dashboard;
    if (s.dataTables.length) ms.dataTables = s.dataTables;
    if (s.pivots.length && !own.dashboard) ms.pivots = s.pivots;
    // a data table's TABLE() formula sits on its first result cell
    const dataTableAt = new Map(s.dataTables.map((t) => [keyOf(t.ref.r1, t.ref.c1), t]));
    // a table's header cells hold its column names, as Excel needs them (filled in and all different)
    const headerName = new Map<number, string>();
    const tableNames = new Map<TableDef, string[]>();
    for (const t of s.tables) {
      const heads: string[] = [];
      for (let c = t.range.c1; c <= t.range.c2; c++) heads.push(s.shownText(t.range.r1, c));
      const names = tableColumnNames(heads);
      tableNames.set(t, names);
      names.forEach((n, i) => headerName.set(keyOf(t.range.r1, t.range.c1 + i), n));
    }
    for (const [c, st] of s.colStyles) if (st.chem) ms.chemCols.push(c);

    // sizes: set by hand, else grown to fit structures (and wrapped text, measured by the grid)
    const colW = (c: number) => (s.hiddenCols.has(c) ? 0 : s.colWidths.get(c) ?? DEFAULT_COL_W);
    const auto = new Map<number, number>(deps.rowHeights?.(s) ?? []);
    for (const [k, c] of s.cells) {
      if (!c.structure) continue;
      const r = rowOf(k);
      const h = Math.min(MAX_AUTO_ROW, Math.ceil(structureHeight(deps.box(c.structure, book.drawingStyle), s.colWidths.get(colOf(k)) ?? DEFAULT_COL_W)));
      if (h > DEFAULT_ROW_H) auto.set(r, Math.max(auto.get(r) ?? 0, h));
    }
    const rowH = (r: number) => (s.hiddenRows.has(r) ? 0 : s.rowHeights.get(r) ?? auto.get(r) ?? DEFAULT_ROW_H);
    ms.autoRows = [...auto].filter(([r]) => !s.rowHeights.has(r));
    const cols = new Axis(colW), rows = new Axis(rowH);

    // every cell in use: typed, formatted, or worked out by a property column
    const keys = new Set<number>([...s.cells.keys(), ...s.values.keys(), ...headerName.keys()]);
    const byRow = new Map<number, number[]>();
    for (const k of keys) {
      const r = rowOf(k);
      const list = byRow.get(r);
      if (list) list.push(k); else byRow.set(r, [k]);
    }
    for (const r of [...s.rowHeights.keys(), ...auto.keys(), ...s.hiddenRows.keys(), ...s.rowLevels.keys(), ...[...s.rowLevels.keys()].map((r) => (s.outline?.summaryAbove ? r - 1 : r + 1)).filter((r) => r >= 0)]) if (!byRow.has(r)) byRow.set(r, []);

    const anchors: string[] = [];
    const pictures: { png: Uint8Array; key: string; name: string }[] = [];
    const pictureFor = new Map<string, string>();
    const drawingPath = `xl/drawings/drawing${drawingNo + 1}.xml`;
    const rowXml: string[] = [];
    for (const r of [...byRow.keys()].sort((a, b) => a - b)) {
      const cells: string[] = [];
      for (const k of byRow.get(r)!.sort((a, b) => a - b)) {
        const c = colOf(k);
        const cell = s.cell(r, c);
        const header = headerName.get(k);
        const v = header ?? s.values.get(k) ?? null;
        const style = s.styleAt(r, c);
        const ref = cellName(r, c);
        const own = cell?.style;
        const chem = showsChem(style?.chem, v);
        let formula: string | null = null;
        /** The block a dynamic array formula fills (its own cell when it doesn't spill). */
        let arrayRef: string | null = null;
        let wrote: Wrote = null;
        // what only this program reads, kept for the cell
        let entry: ModelCell | null = null;
        // (unset is written as false or null: the file can't hold "undefined")
        const fix = cell?.structure ? { chem: !!own?.chem, numFmt: own?.numFmt ?? null } : own?.chem ? { chem: true } : undefined;
        const input = s.effectiveInput(r, c);
        if (cell?.structure) entry = { r, c, wrote: null, fix, structure: cell.structure.contents };
        else if (s.defAt(r, c)) entry = { r, c, wrote: null, fix, computed: true };
        else if (input?.startsWith('=') && usesChemistry(input)) {
          const sp = s.spills.get(k);
          entry = { r, c, wrote: null, fix, formula: input, ...(sp ? { spill: [sp.r2, sp.c2] as [number, number] } : {}) };
        } else if (input?.startsWith('=') && header === undefined) {
          const sp = s.spills.get(k);
          const dynamic = !!sp || s.spillWanted.has(k) || needsDynamic(input);
          formula = excelFunctionNames(fileFormula(input, dynamic));
          if (dynamic) { arrayRef = sp ? rangeName(sp) : ref; anyDynamic = true; }
        }
        if (!entry && fix) entry = { r, c, wrote: null, fix };
        if (entry) ms.cells.push(entry);
        // a structure's SMILES is in its cell, hidden under the picture (the format ;;; shows nothing)
        const xf = styles.xf(cell?.structure ? { ...style, numFmt: HIDDEN } : style);
        const sAttr0 = xf ? ` s="${xf}"` : '';
        const dt = dataTableAt.get(k);
        const f = dt ? dataTableXml(dt) : formula === null ? '' : arrayRef ? `<f t="array" ref="${arrayRef}">${xml(formula)}</f>` : `<f>${xml(formula)}</f>`;
        // a dynamic array formula's cell points at the metadata that says so
        const sAttr = arrayRef ? `${sAttr0} cm="1"` : sAttr0;
        let body = '';
        if (v === null || v === '') {
          body = f ? `<c r="${ref}"${sAttr}>${f}</c>` : sAttr ? `<c r="${ref}"${sAttr}/>` : '';
        } else if (typeof v === 'number') {
          wrote = v;
          body = `<c r="${ref}"${sAttr}>${f}<v>${Number.isFinite(v) ? String(v) : 0}</v></c>`;
        } else if (typeof v === 'boolean') {
          wrote = v;
          body = `<c r="${ref}"${sAttr} t="b">${f}<v>${v ? 1 : 0}</v></c>`;
        } else if (isError(v)) {
          const code = (v as CellError).code;
          wrote = code;
          body = `<c r="${ref}"${sAttr} t="e">${f}<v>${EXCEL_ERRORS.includes(code) ? code : '#VALUE!'}</v></c>`;
        } else {
          wrote = v as string;
          body = f
            ? `<c r="${ref}"${sAttr} t="str">${f}<v>${xml(v as string)}</v></c>`
            : `<c r="${ref}"${sAttr} t="s"><v>${strings.index(v as string, chem)}</v></c>`;
        }
        if (entry) entry.wrote = wrote;
        if (body) cells.push(body);

        // the structure's picture, over the cell (or merged block)
        if (cell?.structure) {
          const m = s.mergeAt(r, c);
          const r2 = m?.r2 ?? r, c2 = m?.c2 ?? c;
          const x = cols.start(c), y = rows.start(r);
          const w = cols.start(c2 + 1) - x, h = rows.start(r2 + 1) - y;
          if (w > 2 && h > 2) {
            const box = { w: w - 2, h: h - 2, fill: style?.fill, align: style?.align, valign: style?.valign };
            const key = `${cell.structure.id}|${JSON.stringify(box)}`;
            let target = pictureFor.get(key);
            if (!target) {
              const png = await deps.picture(cell.structure, book.drawingStyle, box);
              if (png) {
                imageNo++;
                target = `../media/image${imageNo}.png`;
                pictures.push({ png, key, name: `xl/media/image${imageNo}.png` });
                pictureFor.set(key, target);
              }
            }
            if (target) {
              const id = pkg.relate(drawingPath, REL.image, target);
              const from = { col: c, colOff: 1, row: r, rowOff: 1 };
              const end = cols.at(x + w - 1, c);
              const endR = rows.at(y + h - 1, r);
              const n = anchors.length + 2;
              const smiles = typeof v === 'string' ? v : '';
              anchors.push(
                `<xdr:twoCellAnchor editAs="oneCell">` +
                `<xdr:from><xdr:col>${from.col}</xdr:col><xdr:colOff>${from.colOff * PX}</xdr:colOff><xdr:row>${from.row}</xdr:row><xdr:rowOff>${from.rowOff * PX}</xdr:rowOff></xdr:from>` +
                `<xdr:to><xdr:col>${end.i}</xdr:col><xdr:colOff>${Math.round(end.off * PX)}</xdr:colOff><xdr:row>${endR.i}</xdr:row><xdr:rowOff>${Math.round(endR.off * PX)}</xdr:rowOff></xdr:to>` +
                `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${n}" name="Structure ${ref}" descr="${xml(smiles)}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
                `<xdr:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
                `<xdr:spPr><a:xfrm><a:off x="${(x + 1) * PX}" y="${(y + 1) * PX}"/><a:ext cx="${(w - 2) * PX}" cy="${(h - 2) * PX}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>` +
                `<xdr:clientData/></xdr:twoCellAnchor>`,
              );
            }
          }
        }
      }
      const custom = s.rowHeights.get(r) ?? auto.get(r);
      const attrs = `${custom !== undefined ? ` ht="${ptFromPx(custom)}" customHeight="1"` : ''}${s.hiddenRows.has(r) ? ' hidden="1"' : ''}${outlineAttrs(s.rowLevels, s.hiddenRows, r, !!s.outline?.summaryAbove)}`;
      if (cells.length || attrs) rowXml.push(`<row r="${r + 1}"${attrs}>${cells.join('')}</row>`);
    }

    // columns: widths, hidden, and whole-column formatting
    const colKeys = [...new Set([...s.colWidths.keys(), ...s.hiddenCols.keys(), ...s.colStyles.keys(), ...s.colLevels.keys()])].sort((a, b) => a - b);
    const colXml = colKeys.map((c) => {
      const w = s.colWidths.get(c);
      const st = s.colStyles.get(c);
      const xf = st ? styles.xf(st) : 0;
      return `<col min="${c + 1}" max="${c + 1}" width="${widthFromPx(w ?? DEFAULT_COL_W)}"${w !== undefined ? ' customWidth="1"' : ''}${s.hiddenCols.has(c) ? ' hidden="1"' : ''}${xf ? ` style="${xf}"` : ''}${outlineAttrs(s.colLevels, s.hiddenCols, c, !!s.outline?.summaryLeft)}/>`;
    });

    const used = s.lastRow >= 0 ? `A1:${cellName(Math.max(s.lastRow, 0), Math.max(s.lastCol, 0))}` : 'A1';
    const fr = s.frozen.rows, fc = s.frozen.cols;
    // a split window (not frozen): Excel gives where the bars are in twentieths of a point (a pixel is 15)
    const sp = !fr && !fc ? s.split : null;
    const paneName = (r: number, c: number) => (r && c ? 'bottomRight' : r ? 'bottomLeft' : 'topRight');
    const pane = fr || fc
      ? `<pane${fc ? ` xSplit="${fc}"` : ''}${fr ? ` ySplit="${fr}"` : ''} topLeftCell="${cellName(fr, fc)}" activePane="${paneName(fr, fc)}" state="frozen"/>` +
        `<selection pane="${paneName(fr, fc)}" activeCell="${cellName(fr, fc)}" sqref="${cellName(fr, fc)}"/>`
      : sp
        ? `<pane${sp.cols ? ` xSplit="${Math.round(cols.start(sp.cols) * 15)}"` : ''}${sp.rows ? ` ySplit="${Math.round(rows.start(sp.rows) * 15)}"` : ''} topLeftCell="${cellName(sp.rows, sp.cols)}" activePane="${paneName(sp.rows, sp.cols)}"/>` +
          `<selection pane="${paneName(sp.rows, sp.cols)}" activeCell="${cellName(sp.rows, sp.cols)}" sqref="${cellName(sp.rows, sp.cols)}"/>`
        : '';
    let filterXml = '';
    // a filter on a table goes in the table's part (Excel allows no sheet filter over a table)
    const filterTable = s.filter ? s.tables.find((t) => rangesOverlap(t.range, s.filter!.range)) : undefined;
    if (s.filter && !filterTable) {
      const R = { ...s.filter.range, r2: Math.max(s.filter.range.r2, s.lastDataRow) };
      const ref = `${cellName(R.r1, R.c1)}:${cellName(R.r2, R.c2)}`;
      const colsXml = Object.entries(s.filter.conditions).map(([col, cond]) => filterColumnXml(Number(col) - R.c1, cond)).filter(Boolean).join('');
      filterXml = `<autoFilter ref="${ref}">${colsXml}</autoFilter>`;
      filterNames.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${si}" hidden="1">${xml(quoteSheet(s.name))}!${absRef(R)}</definedName>`);
    }
    const cfXml = condFormatsXml(s.condFormats, (l) => styles.dxf(l));
    const tableIds: string[] = [];
    for (const t of s.tables) {
      tableNo++;
      const R = t.range;
      const dataEnd = t.totals ? R.r2 - 1 : R.r2;
      let af = '';
      if (t === filterTable) {
        const colsXml = Object.entries(s.filter!.conditions).filter(([col]) => Number(col) >= R.c1 && Number(col) <= R.c2)
          .map(([col, cond]) => filterColumnXml(Number(col) - R.c1, cond)).filter(Boolean).join('');
        af = `<autoFilter ref="${cellName(R.r1, R.c1)}:${cellName(dataEnd, R.c2)}">${colsXml}</autoFilter>`;
      }
      const totals = t.totals
        ? Array.from({ length: R.c2 - R.c1 + 1 }, (_, i) => {
          const input = s.effectiveInput(R.r2, R.c1 + i);
          if (!input) return null;
          return input.startsWith('=') ? (usesChemistry(input) ? null : { formula: input }) : s.shownText(R.r2, R.c1 + i);
        })
        : null;
      const tpath = `xl/tables/table${tableNo}.xml`;
      pkg.add(tpath, HEAD + tableXml(t, tableNo, tableNames.get(t)!, totals, af), CT.table);
      tableIds.push(pkg.relate(path, RELS.table, `../tables/table${tableNo}.xml`));
    }
    // PivotTables: a cache (the records) and a pivot table part for each, refreshed when Excel opens them
    for (const pt of standIn ? [] : s.pivots) {
      const parts = pivotParts(book, s, pt, pivotNo + 1);
      if (!parts) continue;
      pivotNo++;
      const cachePath = `xl/pivotCache/pivotCacheDefinition${pivotNo}.xml`, tablePath = `xl/pivotTables/pivotTable${pivotNo}.xml`;
      const recordsRid = pkg.relate(cachePath, PIVOT_REL.records, `pivotCacheRecords${pivotNo}.xml`);
      pkg.add(cachePath, HEAD + parts.cache(recordsRid), PIVOT_CT.cache);
      pkg.add(`xl/pivotCache/pivotCacheRecords${pivotNo}.xml`, HEAD + parts.records, PIVOT_CT.records);
      pkg.add(tablePath, HEAD + parts.table, PIVOT_CT.table);
      pkg.relate(tablePath, PIVOT_REL.cache, `../pivotCache/pivotCacheDefinition${pivotNo}.xml`);
      pkg.relate(path, PIVOT_REL.table, `../pivotTables/pivotTable${pivotNo}.xml`);
      pivotCaches.push(`<pivotCache cacheId="${pivotNo}" r:id="${pkg.relate('xl/workbook.xml', PIVOT_REL.cache, `pivotCache/pivotCacheDefinition${pivotNo}.xml`)}"/>`);
    }
    const tableParts = tableIds.length ? `<tableParts count="${tableIds.length}">${tableIds.map((id) => `<tablePart r:id="${id}"/>`).join('')}</tableParts>` : '';
    const merges = s.merges.length ? `<mergeCells count="${s.merges.length}">${s.merges.map((m) => `<mergeCell ref="${cellName(m.r1, m.c1)}:${cellName(m.r2, m.c2)}"/>`).join('')}</mergeCells>` : '';
    // charts: Excel's own chart parts, anchored at their corner cell
    for (const ch of s.charts) {
      chartNo++;
      // histograms and box charts go in Excel 2016's newer chart part
      const ex = isChartEx(ch.kind);
      const cname = `${ex ? 'chartEx' : 'chart'}${chartNo}.xml`;
      pkg.add(`xl/charts/${cname}`, HEAD + chartXml(ch, standIn?.data.get(ch.id) ?? chartData(book, s, ch)), ex ? CT_CHARTEX : CT_CHART);
      const rid = pkg.relate(drawingPath, ex ? REL_CHARTEX : REL_CHART, `../charts/${cname}`);
      const x = cols.start(ch.at.col) + ch.at.dx, y = rows.start(ch.at.row) + ch.at.dy;
      const end = cols.at(x + ch.w, ch.at.col), endR = rows.at(y + ch.h, ch.at.row);
      anchors.push(chartAnchorXml(ch, { col: end.i, colOff: end.off, row: endR.i, rowOff: endR.off }, anchors.length + 2, rid));
    }
    // pictures, shapes and text boxes, above the charts
    for (const o of standIn ? [] : s.objects) {
      let pic: string | undefined;
      if (o.kind === 'picture') {
        const img = o.src ? dataUrlBytes(o.src) : null;
        if (!img) continue;
        imageNo++;
        const media = `xl/media/image${imageNo}.${img.ext}`;
        pkg.defaultType(img.ext, img.mime);
        pictures.push({ png: img.bytes, key: `object ${o.id}`, name: media });
        pic = pkg.relate(drawingPath, REL.image, `../media/image${imageNo}.${img.ext}`);
      }
      const x = cols.start(o.at.col) + o.at.dx, y = rows.start(o.at.row) + o.at.dy;
      const end = cols.at(x + o.w, o.at.col), endR = rows.at(y + o.h, o.at.row);
      anchors.push(objectAnchorXml(o, { col: end.i, colOff: end.off, row: endR.i, rowOff: endR.off }, anchors.length + 2, { x, y }, pic));
    }
    let drawingXml = '';
    const sheetRels = path;
    if (anchors.length) {
      drawingNo++;
      for (const p of pictures) pkg.add(p.name, p.png);
      pkg.add(drawingPath, `${HEAD}<xdr:wsDr xmlns:xdr="${XDR}" xmlns:a="${DML}" xmlns:r="${RNS}">${anchors.join('')}</xdr:wsDr>`, CT.drawing);
      const rid = pkg.relate(sheetRels, RELS.drawing, `../drawings/drawing${drawingNo}.xml`);
      drawingXml = `<drawing r:id="${rid}"/>`;
    }
    // notes and comments (a dashboard's stand-in has none)
    const notes = standIn ? null : notesParts(s, si + 1, persons);
    if (notes) {
      notesNo++;
      pkg.add(`xl/comments${notesNo}.xml`, HEAD + notes.comments, NOTES_CT.comments);
      pkg.relate(sheetRels, NOTES_REL.comments, `../comments${notesNo}.xml`);
      if (notes.threaded) {
        pkg.add(`xl/threadedComments/threadedComment${notesNo}.xml`, HEAD + notes.threaded, NOTES_CT.threaded);
        pkg.relate(sheetRels, NOTES_REL.threaded, `../threadedComments/threadedComment${notesNo}.xml`);
      }
      pkg.defaultType('vml', NOTES_CT.vml);
      pkg.add(`xl/drawings/vmlDrawing${notesNo}.vml`, notes.vml);
      const vid = pkg.relate(sheetRels, NOTES_REL.vml, `../drawings/vmlDrawing${notesNo}.vml`);
      drawingXml += `<legacyDrawing r:id="${vid}"/>`;
    }
    const dvXml = standIn ? '' : validationsXml(s.validations, excelFunctionNames);
    // links (Insert > Link): a place in the workbook as Excel's location, anything else through a relationship
    const linkXml: string[] = [];
    for (const [k, c] of s.cells) {
      if (!c.link) continue;
      const ref = cellName(rowOf(k), colOf(k));
      if (c.link.startsWith('#')) linkXml.push(`<hyperlink ref="${ref}" location="${xmlAttr(c.link.slice(1))}" display="${xmlAttr(s.shownText(rowOf(k), colOf(k)))}"/>`);
      else linkXml.push(`<hyperlink ref="${ref}" r:id="${pkg.relate(path, REL.hyperlink, officeTarget(c.link), true)}"/>`);
    }
    const hyperlinks = linkXml.length ? `<hyperlinks>${linkXml.join('')}</hyperlinks>` : '';
    // printing: page setup, and the print area and titles as the workbook's names
    const page = pageSetupXml(own.pageSetup);
    printTitleNames.push(...printNames(own.pageSetup, s.name, si));
    const outlinePr = outlinePrXml(s);
    const sheetPr = s.filter && !filterTable || page.fitToPage || outlinePr
      ? `<sheetPr${s.filter && !filterTable ? ' filterMode="1"' : ''}>${outlinePr}${page.fitToPage ? '<pageSetUpPr fitToPage="1"/>' : ''}</sheetPr>`
      : '';
    const sparkExt = standIn ? '' : sparklinesExt(s.sparklines, s.name);
    pkg.add(path,
      `${HEAD}<worksheet xmlns="${MAIN}" xmlns:r="${RNS}">` +
      `${sheetPr}<dimension ref="${used}"/>` +
      `<sheetViews><sheetView${sheetViewAttrs(own.viewOpts)}${si === book.active ? ' tabSelected="1"' : ''} workbookViewId="0">${pane}</sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="15"${outlineLevelAttrs(s)}/>` +
      (colXml.length ? `<cols>${colXml.join('')}</cols>` : '') +
      `<sheetData>${rowXml.join('')}</sheetData>${filterXml}${standIn ? '' : customSheetViewsXml(book, own)}${merges}${cfXml}${dvXml}${hyperlinks}` +
      `${page.printOptions}${page.pageMargins}${page.pageSetup}${page.headerFooter}${page.breaks}${drawingXml}${tableParts}${sparkExt ? `<extLst>${sparkExt}</extLst>` : ''}</worksheet>`,
      CT.sheet);
    const rid = pkg.relate('xl/workbook.xml', RELS.worksheet, `worksheets/sheet${si + 1}.xml`);
    sheetEntries.push(`<sheet name="${xml(s.name)}" sheetId="${si + 1}" r:id="${rid}"/>`);
    model.sheets.push(ms);
  }

  pkg.relate('xl/workbook.xml', RELS.styles, 'styles.xml');
  pkg.add('xl/styles.xml', styles.toXml(), CT.styles);
  // the theme, when it isn't Excel's own default
  if (book.theme) {
    pkg.relate('xl/workbook.xml', RELS.theme, 'theme/theme1.xml');
    pkg.add('xl/theme/theme1.xml', themeXml(book.theme), CT.theme);
  }
  pkg.relate('xl/workbook.xml', RELS.sharedStrings, 'sharedStrings.xml');
  pkg.add('xl/sharedStrings.xml', strings.toXml(), CT.strings);
  if (persons.size) {
    pkg.relate('xl/workbook.xml', NOTES_REL.persons, 'persons/person.xml');
    pkg.add('xl/persons/person.xml', HEAD + persons.toXml(), NOTES_CT.persons);
  }

  // our own part: what Excel can't hold
  pkg.relate('xl/workbook.xml', RELS.customXml, '../customXml/item1.xml');
  pkg.add('customXml/item1.xml', `${HEAD}<chemIllustrator xmlns="${MODEL_NS}" version="1">${xml(JSON.stringify(model))}</chemIllustrator>`);
  pkg.relate('customXml/item1.xml', RELS.customXmlProps, 'itemProps1.xml');
  pkg.add('customXml/itemProps1.xml', `${HEAD}<ds:datastoreItem ds:itemID="{6D1F3A52-6C1B-4D5E-9A57-3C0B1E0C1A01}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="${MODEL_NS}"/></ds:schemaRefs></ds:datastoreItem>`, CT.itemProps);

  if (anyDynamic) {
    pkg.relate('xl/workbook.xml', RELS.metadata, 'metadata.xml');
    pkg.add('xl/metadata.xml', HEAD + DYNAMIC_ARRAY_METADATA, CT.metadata);
  }

  // defined names (Name Manager): a sheet's own carry its place in the list of sheets
  const nameXml = book.liveNames().map((n) => {
    const local = n.sheet ? ` localSheetId="${book.sheets.indexOf(n.sheet)}"` : '';
    const f = n.formula.startsWith('=') ? n.formula : '=' + n.formula;
    return `<definedName name="${xmlAttr(n.name)}"${local}${n.comment ? ` comment="${xmlAttr(n.comment)}"` : ''}${n.hidden ? ' hidden="1"' : ''}>${xml(excelFunctionNames(fileFormula(f, true)))}</definedName>`;
  });
  const allNames = [...filterNames, ...printTitleNames, ...nameXml];
  pkg.add('xl/workbook.xml',
    `${HEAD}<workbook xmlns="${MAIN}" xmlns:r="${RNS}"><workbookPr/>` +
    `<bookViews><workbookView activeTab="${book.active}"/></bookViews>` +
    `<sheets>${sheetEntries.join('')}</sheets>` +
    (allNames.length ? `<definedNames>${allNames.join('')}</definedNames>` : '') +
    // formulas are worked out again when Excel opens the file
    `<calcPr calcId="191029" fullCalcOnLoad="1"/>` + customWorkbookViewsXml(book) +
    (pivotCaches.length ? `<pivotCaches>${pivotCaches.join('')}</pivotCaches>` : '') + '</workbook>',
    CT.workbook);
  pkg.relate('', REL.officeDocument, 'xl/workbook.xml');
  pkg.relate('', REL.coreProps, 'docProps/core.xml');
  pkg.relate('', REL.extendedProps, 'docProps/app.xml');
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  pkg.add('docProps/core.xml', `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`, CT.core);
  pkg.add('docProps/app.xml', `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Chem Illustrator</Application></Properties>`, CT.app);
  return pkg.build();
}

const absRef = (R: Range) => `$${colName(R.c1)}$${R.r1 + 1}:$${colName(R.c2)}$${R.r2 + 1}`;

const OPS: Record<CompareOp, string> = { '<': 'lessThan', '<=': 'lessThanOrEqual', '>': 'greaterThan', '>=': 'greaterThanOrEqual', '=': 'equal', '<>': 'notEqual' };

/** A filter condition as Excel writes it (a substructure can't be: the rows it hid stay hidden). */
function filterColumnXml(colId: number, cond: Condition): string {
  const val = (v: number | string) => xml(String(v));
  switch (cond.kind) {
    case 'values': {
      const blank = cond.allowed.includes('');
      return `<filterColumn colId="${colId}"><filters${blank ? ' blank="1"' : ''}>${cond.allowed.filter((a) => a !== '').map((a) => `<filter val="${xml(a)}"/>`).join('')}</filters></filterColumn>`;
    }
    case 'compare': {
      const one = (op: CompareOp, v: number | string) => `<customFilter${op === '=' ? '' : ` operator="${OPS[op]}"`} val="${val(v)}"/>`;
      const two = cond.join && cond.op2 && cond.value2 !== undefined ? one(cond.op2, cond.value2) : '';
      return `<filterColumn colId="${colId}"><customFilters${cond.join === 'and' && two ? ' and="1"' : ''}>${one(cond.op, cond.value)}${two}</customFilters></filterColumn>`;
    }
    case 'contains':
      return `<filterColumn colId="${colId}"><customFilters><customFilter val="*${val(cond.text)}*"/></customFilters></filterColumn>`;
    default:
      return '';
  }
}

// ---------------------------------------------------------------- reading

/** Colours of Office's standard theme, for files that don't carry their own. */
const OFFICE_THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72'];
/** The first colours of Excel's old numbered palette. */
const INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'];

/** A colour element (rgb, theme with tint, or palette number) as "#rrggbb"; undefined for "automatic". */
function readColour(el: Element | null, theme: string[]): string | undefined {
  if (!el || isOn(el.getAttribute('auto'))) return undefined;
  let hex: string | undefined;
  const rgb = el.getAttribute('rgb');
  if (rgb) hex = rgb.slice(-6);
  else if (el.hasAttribute('theme')) hex = theme[Number(el.getAttribute('theme'))];
  else if (el.hasAttribute('indexed')) hex = INDEXED[Number(el.getAttribute('indexed'))];
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return undefined;
  const tint = Number(el.getAttribute('tint') ?? 0);
  return '#' + (tint ? applyTint(hex, tint) : hex).toLowerCase();
}

const BORDER_STYLES: Record<string, BorderStyle> = {
  thin: 'thin', hair: 'thin', medium: 'medium', thick: 'thick', double: 'double', dashed: 'dashed', mediumDashed: 'dashed',
  dashDot: 'dashed', mediumDashDot: 'dashed', dashDotDot: 'dotted', mediumDashDotDot: 'dashed', slantDashDot: 'dashed', dotted: 'dotted',
};

/** The cell formats of a file (cellXfs), as cell styles. */
function readStyles(doc: Document | null, theme: string[]): (CellStyle | undefined)[] {
  if (!doc) return [];
  const root = doc.documentElement;
  const formats = new Map<number, string>(Object.entries(BUILTIN_FORMATS).map(([k, v]) => [Number(k), v]));
  for (const f of kids(kid(root, 'numFmts'), 'numFmt')) formats.set(Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? 'General');
  const fontEls = kids(kid(root, 'fonts'), 'font');
  const val = (el: Element, name: string) => kid(el, name)?.getAttribute('val');
  const on = (el: Element, name: string) => { const k = kid(el, name); return !!k && k.getAttribute('val') !== '0' && k.getAttribute('val') !== 'false' && k.getAttribute('val') !== 'none'; };
  const base = fontEls[0];
  const baseName = base ? val(base, 'name') ?? 'Calibri' : 'Calibri';
  const baseSize = base ? Number(val(base, 'sz') ?? 11) : 11;
  const fonts: CellStyle[] = fontEls.map((f) => {
    const st: CellStyle = {};
    if (on(f, 'b')) st.bold = true;
    if (on(f, 'i')) st.italic = true;
    if (on(f, 'u')) st.underline = true;
    const sz = Number(val(f, 'sz') ?? baseSize);
    if (sz !== baseSize || baseSize !== 11) st.size = sz === 11 ? undefined : sz;
    const color = readColour(kid(f, 'color'), theme);
    if (color && color !== '#000000') st.color = color;
    const name = val(f, 'name');
    // the theme's body font is no font of the cell's own
    if (name && name !== baseName && name !== 'Calibri' && val(f, 'scheme') !== 'minor') st.font = name;
    return st;
  });
  const fills: (string | undefined)[] = kids(kid(root, 'fills'), 'fill').map((f) => {
    const p = kid(f, 'patternFill');
    const type = p?.getAttribute('patternType');
    if (!p || !type || type === 'none') return undefined;
    return readColour(kid(p, 'fgColor'), theme) ?? (type === 'solid' ? undefined : readColour(kid(p, 'bgColor'), theme));
  });
  const borders: CellStyle['borders'][] = kids(kid(root, 'borders'), 'border').map((b) => {
    const out: Partial<Record<Side, Border>> = {};
    for (const side of ['left', 'right', 'top', 'bottom'] as Side[]) {
      const el = kid(b, side);
      const style = el?.getAttribute('style');
      if (el && style && style !== 'none') out[side] = { style: BORDER_STYLES[style] ?? 'thin', ...(readColour(kid(el, 'color'), theme) && readColour(kid(el, 'color'), theme) !== '#000000' ? { color: readColour(kid(el, 'color'), theme) } : {}) };
    }
    return Object.keys(out).length ? out : undefined;
  });
  // the named cell styles Excel built in (Good, Heading 1…), by their base format's number
  const named = new Map<number, string>();
  for (const cs of kids(kid(root, 'cellStyles'), 'cellStyle')) {
    const def = cellStyleNamed(cs.getAttribute('name') ?? '') ?? CELL_STYLES.find((d) => cs.getAttribute('builtinId') !== null && d.builtinId === Number(cs.getAttribute('builtinId')));
    if (def && def.name !== 'Normal') named.set(Number(cs.getAttribute('xfId') ?? -1), def.name);
  }
  return kids(kid(root, 'cellXfs'), 'xf').map((x) => {
    const st: CellStyle = { ...fonts[Number(x.getAttribute('fontId') ?? 0)] };
    const styleName = named.get(Number(x.getAttribute('xfId') ?? 0));
    if (styleName) st.cellStyle = styleName;
    const fill = fills[Number(x.getAttribute('fillId') ?? 0)];
    if (fill) st.fill = fill;
    const border = borders[Number(x.getAttribute('borderId') ?? 0)];
    if (border) st.borders = border;
    const fmt = formats.get(Number(x.getAttribute('numFmtId') ?? 0));
    if (fmt && !/^general$/i.test(fmt)) st.numFmt = fmt;
    const a = kid(x, 'alignment');
    if (a) {
      const h = a.getAttribute('horizontal');
      if (h === 'left' || h === 'right') st.align = h;
      else if (h === 'center' || h === 'centerContinuous' || h === 'distributed') st.align = 'center';
      const v = a.getAttribute('vertical');
      if (v === 'top') st.valign = 'top';
      else if (v === 'center' || v === 'justify' || v === 'distributed') st.valign = 'middle';
      if (isOn(a.getAttribute('wrapText'))) st.wrap = true;
      const ind = Number(a.getAttribute('indent') ?? 0);
      if (ind > 0) st.indent = ind;
      const rot = readTextRotation(a.getAttribute('textRotation'));
      if (rot) st.rotate = rot;
    }
    return Object.keys(st).some((k) => (st as Record<string, unknown>)[k] !== undefined) ? st : undefined;
  });
}

/** The theme's colours, in the order cell formats number them (light 1, dark 1, light 2, dark 2, accents…). */
function readTheme(doc: Document | null): string[] {
  if (!doc) return OFFICE_THEME;
  const scheme = doc.getElementsByTagNameNS(DML, 'clrScheme')[0];
  if (!scheme) return OFFICE_THEME;
  const colour = (name: string) => {
    const el = kid(scheme, name);
    const c = el?.firstElementChild;
    return c?.getAttribute('lastClr') ?? c?.getAttribute('val') ?? undefined;
  };
  const order = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
  return order.map((n, i) => colour(n) ?? OFFICE_THEME[i]);
}

/**
 * Excel writes characters XML can't hold as _xHHHH_ (a carriage return is _x000D_), and a typed
 * "_x" that would read as one as _x005F_x: undone on reading, and done on writing.
 */
const excelUnescape = (s: string) => s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
export const excelEscape = (s: string) => s.replace(/_(?=x[0-9A-Fa-f]{4}_)/g, '_x005F_').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, (c) => `_x${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`);

/** A shared string's text, and whether some of it is lowered or raised (chemistry). */
function stringItem(si: Element): { text: string; chem: boolean } {
  const t = kid(si, 't');
  if (t) return { text: excelUnescape(t.textContent ?? ''), chem: false };
  let text = '', chem = false;
  for (const r of kids(si, 'r')) {
    text += excelUnescape(kid(r, 't')?.textContent ?? '');
    const va = kid(r, 'rPr', 'vertAlign')?.getAttribute('val');
    if (va === 'subscript' || va === 'superscript') chem = true;
  }
  return { text, chem };
}

/** A cell typed as it shows: text that would read as a number is kept as text. */
function textInput(text: string): string {
  if (text === '') return '';
  const t = readTyped(text);
  return t.value === text && !t.formula && !text.startsWith("'") ? text : `'${text}`;
}

/** A yes/no attribute: Excel writes 1 and 0, other programs true and false. */
const isOn = (v: string | null | undefined) => v === '1' || v === 'true';

const sameWrote = (a: Wrote, b: Wrote) =>
  typeof a === 'number' && typeof b === 'number' ? a === b || Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b)) : a === b;

/** Open an Excel file. */
export async function readXlsx(bytes: Uint8Array, _deps?: Partial<XlsxPictures>): Promise<{ book: Workbook; warnings: string[] }> {
  let pkg: PackageReader;
  try {
    pkg = new PackageReader(bytes);
  } catch {
    throw new Error('This is not an Excel workbook (or it is damaged).');
  }
  const wbPath = pkg.relOfType('', REL.officeDocument) ?? 'xl/workbook.xml';
  const wbDoc = pkg.xml(wbPath);
  if (!wbDoc || wbDoc.documentElement.localName !== 'workbook') throw new Error('This is not an Excel workbook (.xlsx). Old .xls files need saving as .xlsx in Excel first.');
  const root = wbDoc.documentElement;
  const rels = pkg.rels(wbPath);
  const warnings: string[] = [];
  const notKept = new Set<string>();
  if (isOn(kid(root, 'workbookPr')?.getAttribute('date1904'))) warnings.push('This workbook counts dates from 1904 (an old Mac setting): dates may show four years early.');

  const relTarget = (type: string) => [...rels.values()].find((r) => r.type === type)?.target ?? null;
  const themeDoc = relTarget(RELS.theme) ? pkg.xml(relTarget(RELS.theme)!) : null;
  const theme = readTheme(themeDoc);
  const workbookTheme = readWorkbookTheme(themeDoc);
  const stylesDoc = relTarget(RELS.styles) ? pkg.xml(relTarget(RELS.styles)!) : null;
  const xfs = readStyles(stylesDoc, theme);
  const colourOf = (el: Element | null) => readColour(el, theme);
  const dxfs = readDxfs(stylesDoc, colourOf);
  const personsPath = relTarget(NOTES_REL.persons);
  const personsDoc = personsPath ? pkg.xml(personsPath) : null;
  const ssPath = relTarget(RELS.sharedStrings);
  const shared = ssPath ? kids(pkg.xml(ssPath)?.documentElement, 'si').map(stringItem) : [];

  const sheetEls = kids(kid(root, 'sheets'), 'sheet');
  if (!sheetEls.length) throw new Error('This workbook has no sheets.');
  const names = sheetEls.map((s, i) => s.getAttribute('name') || `Sheet${i + 1}`);
  const book = new Workbook(names);
  const activeTab = Number(kid(root, 'bookViews', 'workbookView')?.getAttribute('activeTab') ?? 0);
  if (sheetEls.some((s) => s.getAttribute('state') === 'hidden' || s.getAttribute('state') === 'veryHidden')) notKept.add('hidden sheets (shown here)');
  const definedNames = kids(kid(root, 'definedNames'), 'definedName');

  // our own part, if this file was saved here (found by name: programs that keep it don't all keep its link)
  let model: Model | null = null;
  const custom = pkg.names().filter((n) => /^customXml\/item\d*\.xml$/i.test(n)).map((n) => {
    try { return pkg.xml(n); } catch { return null; }
  }).find((d) => d?.documentElement.namespaceURI === MODEL_NS);
  if (custom) {
    try {
      const m = JSON.parse(custom.documentElement.textContent ?? '');
      if (m?.app === 'Chem Illustrator' && m.version === 1) model = m as Model;
    } catch {
      model = null;
    }
  }
  if (model?.drawingStyle) book.drawingStyle = { ...book.drawingStyle, ...model.drawingStyle };

  const filters: { s: Sheet; f: Filter }[] = [];
  const sheetDocs: { name: string; ws: Element | null }[] = [];
  let unknownFormulas = 0;
  let foreignPictures = 0;
  const restored = { structures: 0, changed: 0 };
  book.build(() => {
    sheetEls.forEach((el, si) => {
      const s = book.sheets[si];
      const path = rels.get(rAttr(el, 'id') ?? '')?.target;
      const doc = path ? pkg.xml(path) : null;
      sheetDocs.push({ name: s.name, ws: doc?.documentElement ?? null });
      if (!doc) return;
      const ws = doc.documentElement;
      const raw = new Map<number, Wrote>();
      const sheetView = kid(ws, 'sheetViews', 'sheetView');
      const viewOpts = readSheetViewOpts(sheetView);
      if (viewOpts) s.setViewOpts(viewOpts);
      const outlinePr = kid(ws, 'sheetPr', 'outlinePr');
      if (outlinePr) s.setOutline({ ...(outlinePr.getAttribute('summaryBelow') === '0' ? { summaryAbove: true } : {}), ...(outlinePr.getAttribute('summaryRight') === '0' ? { summaryLeft: true } : {}) });

      // columns
      const fmtPr = kid(ws, 'sheetFormatPr');
      let defW = fmtPr?.getAttribute('defaultColWidth') ? pxFromWidth(Number(fmtPr.getAttribute('defaultColWidth')))
        // a base width in digits, with padding and gridline, rounded up to 8 pixels (18.3.1.81)
        : fmtPr?.getAttribute('baseColWidth') ? Math.ceil((Number(fmtPr.getAttribute('baseColWidth')) * 7 + 5) / 8) * 8 : DEFAULT_COL_W;
      // other programs' standard widths, a few pixels either way, are the standard width here
      if (Math.abs(defW - DEFAULT_COL_W) <= 3) defW = DEFAULT_COL_W;
      const widthSet = new Set<number>();
      for (const col of kids(kid(ws, 'cols'), 'col')) {
        const min = Number(col.getAttribute('min')) - 1, max = Math.min(Number(col.getAttribute('max')) - 1, MAX_COLS - 1);
        const w = col.getAttribute('width');
        const hidden = isOn(col.getAttribute('hidden'));
        const st = col.getAttribute('style') ? xfs[Number(col.getAttribute('style'))] : undefined;
        // a format for every column to the end of the sheet only matters where there are cells
        const last = max - min > 1000 ? min : max;
        for (let c = min; c <= last; c++) {
          if (w !== null) {
            const px = pxFromWidth(Number(w));
            if (px !== DEFAULT_COL_W) s.setColWidth(c, px);
            widthSet.add(c);
          }
          if (hidden) s.setColHidden(c, true);
          if (st) s.setColStyle(c, st);
          const lv = Number(col.getAttribute('outlineLevel') ?? 0);
          if (lv > 0) s.setColLevel(c, lv);
        }
      }

      // cells
      const sharedF = new Map<string, { r: number; c: number; text: string }>();
      // blocks filled by array formulas: their other cells hold only what the array put there
      const arrays: { R: Range; r: number; c: number }[] = [];
      const dataTables: DataTable[] = [];
      let rowNo = -1;
      let maxCol = -1;
      for (const row of kids(kid(ws, 'sheetData'), 'row')) {
        rowNo = row.hasAttribute('r') ? Number(row.getAttribute('r')) - 1 : rowNo + 1;
        const r = rowNo;
        if (isOn(row.getAttribute('customHeight')) && row.hasAttribute('ht')) s.setRowHeight(r, pxFromPt(Number(row.getAttribute('ht'))));
        if (isOn(row.getAttribute('hidden'))) s.setRowHidden(r, true);
        const lv = Number(row.getAttribute('outlineLevel') ?? 0);
        if (lv > 0) s.setRowLevel(r, lv);
        const rowStyle = isOn(row.getAttribute('customFormat')) && row.getAttribute('s') ? xfs[Number(row.getAttribute('s'))] : undefined;
        let colNo = -1;
        for (const c of kids(row, 'c')) {
          const at = c.getAttribute('r') ? parseRange(c.getAttribute('r')!) : null;
          colNo = at ? at.c1 : colNo + 1;
          const col = colNo;
          maxCol = Math.max(maxCol, col);
          const style = c.hasAttribute('s') ? xfs[Number(c.getAttribute('s'))] : rowStyle;
          const t = c.getAttribute('t') ?? 'n';
          const v = kid(c, 'v')?.textContent ?? null;
          const f = kid(c, 'f');
          let input: string | undefined;
          let chem = false;
          let value: Wrote = null;
          if (t === 's' && v !== null) {
            const item = shared[Number(v)];
            value = item?.text ?? '';
            chem = !!item?.chem;
          } else if (t === 'inlineStr') {
            const is = kid(c, 'is');
            const item = is ? stringItem(is) : { text: '', chem: false };
            value = item.text;
            chem = item.chem;
          } else if (t === 'str' || t === 'e') value = v ?? '';
          else if (t === 'b') value = isOn(v);
          else if (t === 'd' && v) value = Date.parse(v) / 86400000 + 25569;
          else if (v !== null && v !== '') value = Number(v);
          raw.set(keyOf(r, col), value);
          // a data table: its results are worked out again here (its formula is on the first of them)
          const dt = f ? readDataTable(f) : null;
          if (dt) {
            dataTables.push(dt);
            arrays.push({ R: dt.ref, r: -1, c: -1 });
            if (style) s.setCell(r, col, { style });
            continue;
          }
          if (f) {
            let text = f.textContent ?? '';
            const si = f.getAttribute('si');
            if (f.getAttribute('t') === 'shared' && si !== null) {
              if (text) sharedF.set(si, { r, c: col, text });
              else {
                const m = sharedF.get(si);
                text = m ? shiftFormula('=' + m.text, r - m.r, col - m.c).slice(1) : '';
              }
            }
            if (text) {
              if (usesUnknownFunction(text)) unknownFormulas++;
              const isArray = f.getAttribute('t') === 'array';
              // a formula from before arrays spilled keeps working out one value (Excel shows it with @)
              input = normalizeFormula(isArray ? readFileFormula(text) : legacyFormula(readFileFormula(text)));
              const R = isArray ? parseRange(f.getAttribute('ref') ?? '') : null;
              if (R && (R.r2 > R.r1 || R.c2 > R.c1)) arrays.push({ R, r, c: col });
            }
          } else if (arrays.some((a) => inRange(a.R, r, col) && !(a.r === r && a.c === col))) {
            // spilled there: the formula fills it again
            if (style) s.setCell(r, col, { style });
            continue;
          }
          if (input === undefined) {
            if (typeof value === 'number') input = Number.isFinite(value) ? String(value) : undefined;
            else if (typeof value === 'boolean') input = value ? 'TRUE' : 'FALSE';
            else if (typeof value === 'string') input = t === 'e' ? value : textInput(value);
          }
          const st = chem ? { ...style, chem: true } : style;
          if (input || st) s.setCell(r, col, { input: input || undefined, style: st });
        }
      }
      if (defW !== DEFAULT_COL_W) for (let c = 0; c <= maxCol; c++) if (!widthSet.has(c)) s.setColWidth(c, defW);

      // merged cells, frozen panes, the filter
      const merges: Range[] = [];
      for (const m of kids(kid(ws, 'mergeCells'), 'mergeCell')) {
        const R = parseRange(m.getAttribute('ref') ?? '');
        if (R && (R.r2 > R.r1 || R.c2 > R.c1)) merges.push(R);
      }
      if (merges.length) s.setMerges(merges);
      const pane = kid(ws, 'sheetViews', 'sheetView', 'pane');
      if (pane && /frozen/i.test(pane.getAttribute('state') ?? '')) s.setFrozen(Number(pane.getAttribute('ySplit') ?? 0), Number(pane.getAttribute('xSplit') ?? 0));
      else if (pane) {
        // a split window: its bars in twentieths of a point, put at the nearest row and column edges
        const nearest = (twips: number, size: (i: number) => number) => {
          const px = twips / 15;
          let i = 0, at = 0;
          while (i < 5000 && at + size(i) / 2 < px) at += size(i++);
          return i;
        };
        const rowsUp = nearest(Number(pane.getAttribute('ySplit') ?? 0), (r) => (s.hiddenRows.has(r) ? 0 : s.rowHeights.get(r) ?? DEFAULT_ROW_H));
        const colsLeft = nearest(Number(pane.getAttribute('xSplit') ?? 0), (c) => (s.hiddenCols.has(c) ? 0 : s.colWidths.get(c) ?? DEFAULT_COL_W));
        if (rowsUp || colsLeft) s.setSplit({ rows: rowsUp, cols: colsLeft });
      }
      const af = kid(ws, 'autoFilter');
      const afRange = af ? parseRange(af.getAttribute('ref') ?? '') : null;
      if (af && afRange) {
        const conditions: Record<number, Condition> = {};
        for (const fc of kids(af, 'filterColumn')) {
          const cond = readFilterColumn(fc);
          if (cond) conditions[afRange.c1 + Number(fc.getAttribute('colId') ?? 0)] = cond;
          else notKept.add('some filter settings');
        }
        filters.push({ s, f: { range: afRange, conditions } });
      }

      // what Excel can't show for itself, where the cells still hold what was saved
      const ms = model?.sheets.find((x) => x.name === s.name) ?? (model?.sheets.length === book.sheets.length ? model.sheets[si] : undefined);
      if (ms) {
        for (const [r, px] of ms.autoRows ?? []) if (s.rowHeights.get(r) === px) s.setRowHeight(r, undefined);
        for (const { col, def } of ms.defs) s.setColDef(col, def);
        for (const col of ms.chemCols) s.setColStyle(col, { ...s.colStyles.get(col), chem: true });
        for (const m of ms.cells) {
          const same = sameWrote(raw.get(keyOf(m.r, m.c)) ?? null, m.wrote);
          if (!same) { if (m.structure || m.computed || m.formula) restored.changed++; continue; }
          const cur = s.cell(m.r, m.c);
          // Excel's formatting, with what it couldn't hold put back
          const style = m.fix ? tidy({ ...cur?.style, ...m.fix } as Record<string, unknown>) : cur?.style;
          if (m.structure) {
            s.setCell(m.r, m.c, { structure: makeStructure(m.structure), style });
            restored.structures++;
          } else if (m.computed) s.setCell(m.r, m.c, { style });
          else if (m.formula) {
            s.setCell(m.r, m.c, { input: m.formula, style });
            // the array it spilled was saved as values: the formula fills those cells again
            if (m.spill) for (let r = m.r; r <= m.spill[0]; r++) for (let c = m.c; c <= m.spill[1]; c++) {
              const x = s.cell(r, c);
              if ((r !== m.r || c !== m.c) && x?.input && !x.input.startsWith('=')) s.setCell(r, c, { style: x.style });
            }
          }
          else s.setCell(m.r, m.c, { input: cur?.input, style });
        }
        if (ms.filter && afRange && sameRange(ms.filter.range, afRange)) {
          const i = filters.findIndex((x) => x.s === s);
          if (i >= 0) filters[i].f = ms.filter;
        }
      }

      // conditional formatting: our own copy where it matches what Excel kept (it can say more)
      const cf = readCondFormats(ws, dxfs, colourOf);
      let rules = cf.rules;
      if (ms?.condFormats && sameRules(rules, ms.condFormats)) rules = ms.condFormats.map((x) => { seenCondFormatId(x.id); return x; });
      if (rules.length) s.setCondFormats(rules);
      if (cf.skipped) notKept.add('some conditional formatting rules');
      // tables
      const tables: TableDef[] = [];
      for (const r of pkg.rels(path!).values()) {
        if (r.type !== RELS.table) continue;
        const td = pkg.xml(r.target);
        const got = td ? readTable(td, tables.length + 1) : null;
        if (!got) continue;
        const mine = ms?.tables?.find((t) => t.name === got.table.name && sameRange(t.range, got.table.range) && t.range.r2 === got.table.range.r2);
        if (mine) seenTableId(mine.id);
        tables.push(mine ? { ...got.table, id: mine.id, ...(mine.custom ? { custom: mine.custom } : {}), ...(got.table.style === 'none' && mine.style !== 'none' ? { style: mine.style } : {}) } : got.table);
        const afr = got.autoFilter ? parseRange(got.autoFilter.getAttribute('ref') ?? '') : null;
        if (got.autoFilter && afr && !filters.some((f) => f.s === s)) {
          const conditions: Record<number, Condition> = {};
          for (const fc of kids(got.autoFilter, 'filterColumn')) {
            const cond = readFilterColumn(fc);
            if (cond) conditions[afr.c1 + Number(fc.getAttribute('colId') ?? 0)] = cond;
          }
          const keep = ms?.filter && sameRange(ms.filter.range, afr) ? ms.filter : { range: afr, conditions };
          filters.push({ s, f: keep });
        }
      }
      if (tables.length) s.setTables(tables);
      // data tables and PivotTables: our own copy where it says the same as Excel's
      if (dataTables.length) {
        s.setDataTables(dataTables.map((t) => {
          const mine = ms?.dataTables?.find((x) => sameRange(x.ref, t.ref) && x.ref.r2 === t.ref.r2);
          if (mine) seenDataTableId(mine.id);
          return mine ?? t;
        }));
      }
      const pivots: PivotTable[] = [];
      for (const r of pkg.rels(path!).values()) {
        if (r.type !== PIVOT_REL.table) continue;
        const td = pkg.xml(r.target);
        const cacheTarget = [...pkg.rels(r.target).values()].find((x) => x.type === PIVOT_REL.cache)?.target;
        const got = td ? readPivot(td, cacheTarget ? pkg.xml(cacheTarget) : null, s.name) : null;
        if (!got) { notKept.add('some PivotTables (their cells are kept)'); continue; }
        const mine = ms?.pivots?.find((p) => p.name === got.name);
        if (mine && samePivot(mine, got)) { seenPivotId(mine.id); pivots.push({ ...mine, last: mine.last ?? got.last }); } else pivots.push(got);
      }
      if (pivots.length) s.setPivots(pivots);

      // pictures and charts that aren't structures saved here
      const drawingPath = [...pkg.rels(path!).values()].find((r) => r.type === RELS.drawing)?.target;
      const dr = drawingPath ? pkg.xml(drawingPath) : null;
      if (dr) {
        const colPx = (c: number) => (s.hiddenCols.has(c) ? 0 : s.colWidths.get(c) ?? DEFAULT_COL_W);
        const rowPx = (r: number) => (s.hiddenRows.has(r) ? 0 : s.rowHeights.get(r) ?? DEFAULT_ROW_H);
        // pictures, shapes and text boxes (not our structures' pictures, which are their cells)
        const drawRels = pkg.rels(drawingPath!);
        const got = readObjects(dr, (rid) => {
          const t = drawRels.get(rid)?.target;
          const bytes = t ? pkg.bytes(t) : null;
          return bytes ? bytesDataUrl(bytes, t!) : null;
        }, (a) => anchorPlace(a, colPx, rowPx), theme, (name) => !!ms && name.startsWith('Structure '));
        foreignPictures += got.skipped;
        if (got.objects.length) { for (const o of got.objects) seenObjectId(o.id); s.setObjects(got.objects); }
        // charts: Excel's, or ours (our own copy where the data it charts is unchanged)
        const charts: Chart[] = [];
        for (const gf of Array.from(dr.getElementsByTagNameNS(XDR, 'graphicFrame'))) {
          let anchor = gf.parentElement;
          while (anchor && !/Anchor$/.test(anchor.localName)) anchor = anchor.parentElement;
          const cref = gf.getElementsByTagNameNS(C_NS, 'chart')[0] ?? gf.getElementsByTagNameNS(CX_NS, 'chart')[0];
          const target = cref ? pkg.rels(drawingPath!).get(rAttr(cref, 'id') ?? '')?.target : undefined;
          const cdoc = target ? pkg.xml(target) : null;
          const from = kid(anchor, 'from'), to = kid(anchor, 'to');
          if (!cdoc || !from) { foreignPictures++; continue; }
          const pos = (el: Element | null) => ({ col: Number(kid(el, 'col')?.textContent ?? 0), colOff: Number(kid(el, 'colOff')?.textContent ?? 0) / 9525, row: Number(kid(el, 'row')?.textContent ?? 0), rowOff: Number(kid(el, 'rowOff')?.textContent ?? 0) / 9525 });
          const a = pos(from);
          let w = 480, h = 290;
          if (to) {
            const b = pos(to);
            w = b.colOff - a.colOff; for (let c = a.col; c < b.col; c++) w += colPx(c);
            h = b.rowOff - a.rowOff; for (let r = a.row; r < b.row; r++) h += rowPx(r);
          } else {
            const ext = kid(anchor, 'ext');
            if (ext) { w = Number(ext.getAttribute('cx') ?? 0) / 9525; h = Number(ext.getAttribute('cy') ?? 0) / 9525; }
          }
          const at = { row: a.row, col: a.col, dx: Math.round(a.colOff), dy: Math.round(a.rowOff) };
          const name = kid(gf, 'nvGraphicFramePr', 'cNvPr')?.getAttribute('name') ?? '';
          const mine = ms?.charts?.find((c) => name === `Chart ${c.id}`);
          const got = readChartXml(cdoc, at, w, h, mine?.id ?? newChartId());
          if (!got) { foreignPictures++; continue; }
          if (mine && sameChartData(mine, got.chart)) { seenChartId(mine.id); charts.push({ ...mine, at }); continue; }
          if (got.partial) notKept.add('parts of combined charts');
          charts.push(got.chart);
        }
        if (charts.length) s.setCharts(charts);
      }
      // a dashboard: the stand-in Excel was given goes, and the dashboard comes back
      if (ms?.dashboard) {
        if (s.lastRow >= 0) s.clear({ r1: 0, c1: 0, r2: Math.max(0, s.lastRow), c2: Math.max(0, s.lastCol) }, 'all');
        s.setCharts([]);
        for (const t of ms.dashboard.tiles) { seenTileId(t.id); if (t.kind === 'chart') seenTileId(t.chart.id); }
        s.setDashboard(ms.dashboard);
      }
      // notes and comments, and data validation
      const sheetRelList = [...pkg.rels(path!).values()];
      const relOf = (type: string) => sheetRelList.find((r) => r.type === type)?.target;
      const commentsPath = relOf(NOTES_REL.comments), vmlPath = relOf(NOTES_REL.vml), threadedPath = relOf(NOTES_REL.threaded);
      if (commentsPath || threadedPath) {
        const notes = readNotes(commentsPath ? pkg.xml(commentsPath) : null, shownNotes(vmlPath ? pkg.text(vmlPath) : null), threadedPath ? pkg.xml(threadedPath) : null, personsDoc);
        for (const [k, n] of notes) s.setNote(rowOf(k), colOf(k), n);
      }
      const dv = readValidations(ws);
      if (dv.length) s.setValidations(dv);
      const sparks = readSparklines(ws, s.name, colourOf);
      if (sparks.length) { for (const g of sparks) seenSparkId(g.id); s.setSparklines(sparks); }
      const ps = readPageSetup(ws, definedNames, s.name, si);
      if (ps) s.setPageSetup(ps);
      // links: Excel's own (a cell range takes its link on each of its cells)
      const linkRels = pkg.rels(path!);
      for (const h of kids(kid(ws, 'hyperlinks'), 'hyperlink')) {
        const R = parseRange(h.getAttribute('ref') ?? '');
        const rel = linkRels.get(rAttr(h, 'id') ?? '');
        const loc = h.getAttribute('location');
        const link = rel?.external ? linkFromTarget(rel.target) + (loc ? `#${loc}` : '') : loc ? `#${loc}` : null;
        if (!R || !link) continue;
        for (let r = R.r1; r <= Math.min(R.r2, R.r1 + 999); r++) for (let c = R.c1; c <= Math.min(R.c2, R.c1 + 99); c++) s.setLink(r, c, link);
      }
    });
    // defined names (Excel's own, for print areas and filters, are its business)
    const names: DefinedName[] = [];
    for (const d of kids(kid(root, 'definedNames'), 'definedName')) {
      const name = d.getAttribute('name') ?? '';
      const text = d.textContent ?? '';
      if (!name || isBuiltInName(name) || !text) continue;
      const local = d.getAttribute('localSheetId');
      const sheet = local !== null ? book.sheets[Number(local)] : undefined;
      if (local !== null && !sheet) continue;
      if (usesUnknownFunction(text)) unknownFormulas++;
      names.push({
        name, formula: normalizeFormula(readFileFormula(text)),
        ...(sheet ? { sheet } : {}),
        ...(d.getAttribute('comment') ? { comment: d.getAttribute('comment')! } : {}),
        ...(isOn(d.getAttribute('hidden')) ? { hidden: true } : {}),
      });
    }
    if (names.length) book.setNames(names);
    if (workbookTheme) book.setTheme(workbookTheme);
    // custom views: our own copy where Excel's list still names the same ones
    const views = readCustomViews(root, sheetDocs);
    const mine = model?.customViews;
    if (mine && mine.length === views.length && mine.every((v, i) => v.guid.toUpperCase() === views[i].guid.toUpperCase() && v.name === views[i].name)) book.setCustomViews(mine);
    else if (views.length) book.setCustomViews(views);
  });
  // a filter goes back as it was: the rows it hid are hidden already
  if (filters.length) book.build(() => { for (const { s, f } of filters) s.restoreFilter(f); });
  book.active = Math.min(Math.max(0, activeTab), book.sheets.length - 1);

  if (foreignPictures) notKept.add(`${foreignPictures} picture${foreignPictures > 1 ? 's' : ''} or chart${foreignPictures > 1 ? 's' : ''}`);
  if (unknownFormulas) warnings.push(`${unknownFormulas} formula${unknownFormulas > 1 ? 's use' : ' uses'} newer Excel functions this program can't work out yet.`);
  if (restored.changed) warnings.push(`${restored.changed} structure or calculated cell${restored.changed > 1 ? 's were' : ' was'} changed in another program: ${restored.changed > 1 ? 'they show' : 'it shows'} what that program saved.`);
  if (notKept.size) warnings.push(`Not shown here, and left out if you save over this file: ${[...notKept].join(', ')}.`);
  return { book, warnings };
}

/** Where a drawing's anchor puts its object: the top-left corner in cells and the size in pixels. */
function anchorPlace(anchor: Element, colPx: (c: number) => number, rowPx: (r: number) => number): ReadAnchor | null {
  const pos = (el: Element | null) => ({ col: Number(kid(el, 'col')?.textContent ?? 0), colOff: Number(kid(el, 'colOff')?.textContent ?? 0) / PX, row: Number(kid(el, 'row')?.textContent ?? 0), rowOff: Number(kid(el, 'rowOff')?.textContent ?? 0) / PX });
  const ext = kid(anchor, 'ext');
  const extSize = ext ? { w: Number(ext.getAttribute('cx') ?? 0) / PX, h: Number(ext.getAttribute('cy') ?? 0) / PX } : null;
  if (anchor.localName === 'absoluteAnchor') {
    const p = kid(anchor, 'pos');
    if (!p || !extSize) return null;
    // a place on the sheet in pixels, as a cell and an offset into it
    const find = (px: number, size: (i: number) => number) => {
      let i = 0, at = 0;
      while (i < 20000 && at + size(i) <= px) { at += size(i); i++; }
      return { i, off: px - at };
    };
    const c = find(Number(p.getAttribute('x') ?? 0) / PX, colPx), r = find(Number(p.getAttribute('y') ?? 0) / PX, rowPx);
    return { from: { col: c.i, colOff: c.off, row: r.i, rowOff: r.off }, ...extSize, placement: 'absolute' };
  }
  const from = kid(anchor, 'from');
  if (!from) return null;
  const a = pos(from);
  let w: number, h: number;
  const to = kid(anchor, 'to');
  if (anchor.localName === 'twoCellAnchor' && to) {
    const b = pos(to);
    w = b.colOff - a.colOff; for (let c = a.col; c < b.col; c++) w += colPx(c);
    h = b.rowOff - a.rowOff; for (let r = a.row; r < b.row; r++) h += rowPx(r);
  } else if (extSize) ({ w, h } = extSize);
  else return null;
  const editAs = anchor.getAttribute('editAs');
  const placement = anchor.localName === 'oneCellAnchor' ? 'oneCell' : editAs === 'oneCell' || editAs === 'absolute' ? editAs : 'twoCell';
  return { from: a, w, h, placement };
}

/** A style without its unset parts (undefined when nothing is set). */
function tidy(st: Record<string, unknown>): CellStyle | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(st)) if (v !== undefined && v !== null && v !== false) out[k] = v;
  return Object.keys(out).length ? (out as CellStyle) : undefined;
}

const sameRange = (a: Range, b: Range) => a.r1 === b.r1 && a.c1 === b.c1 && a.c2 === b.c2;

const OP_BACK: Record<string, CompareOp> = { lessThan: '<', lessThanOrEqual: '<=', greaterThan: '>', greaterThanOrEqual: '>=', equal: '=', notEqual: '<>' };

/** A filter column as a condition (null for kinds not read yet: top 10, colours, dates). */
function readFilterColumn(fc: Element): Condition | null {
  const filters = kid(fc, 'filters');
  if (filters) {
    const allowed = kids(filters, 'filter').map((f) => f.getAttribute('val') ?? '');
    if (isOn(filters.getAttribute('blank'))) allowed.push('');
    return kids(filters, 'dateGroupItem').length ? null : { kind: 'values', allowed };
  }
  const custom = kid(fc, 'customFilters');
  if (custom) {
    const list = kids(custom, 'customFilter');
    const one = (el: Element): { op: CompareOp; value: number | string; contains?: string } => {
      const op = OP_BACK[el.getAttribute('operator') ?? 'equal'] ?? '=';
      const raw = el.getAttribute('val') ?? '';
      const m = /^\*(.*)\*$/.exec(raw);
      if (m && op === '=' && !/[*?]/.test(m[1])) return { op, value: raw, contains: m[1] };
      const n = Number(raw);
      return { op, value: raw !== '' && Number.isFinite(n) ? n : raw };
    };
    if (!list.length) return null;
    const a = one(list[0]);
    if (list.length === 1 && a.contains !== undefined) return { kind: 'contains', text: a.contains };
    if (list.length === 1) return { kind: 'compare', op: a.op, value: a.value };
    const b = one(list[1]);
    return { kind: 'compare', op: a.op, value: a.value, join: isOn(custom.getAttribute('and')) ? 'and' : 'or', op2: b.op, value2: b.value };
  }
  return null;
}

/** For tests and the cell panel: the value a cell was saved with. */
export function wroteOf(v: Value): Wrote {
  if (v === null || typeof v !== 'object') return v;
  return (v as CellError).code;
}

