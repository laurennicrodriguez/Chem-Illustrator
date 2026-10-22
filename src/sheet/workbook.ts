// A workbook of sheets, as in Excel: cells hold numbers, text, formulas or a drawn structure,
// with formatting, column widths, row heights, merged cells, a filter and frozen header rows.
// A column can be a property column (MW, formula, cLogP…): every row of the table works out
// its own value from that row's structure, unless a value has been typed over it.
//
// Every change goes through a transaction (Workbook.edit) and is recorded, so the workbook has
// one undo history across its sheets. After each change every formula is worked out again in
// the order they depend on each other; a formula that depends on itself shows #CIRC!.

import type { Contents } from '../model';
import type { DocStyle } from '../style';
import { ACS_1996 } from '../style';
import { Chart, mapChartRefs } from './chart';
import { Dashboard, mapDashboardRefs } from './dashboard';
import { type RefToken, Node, parseFormula, shiftFormula, shiftTree, adjustFormula, renameSheetInFormula, formulaRefs, SheetChange, normalizeFormula, FormulaSyntaxError, moveRefs } from './formula';
import { evaluate, EvalHost, VOLATILE_FUNCTIONS } from './evaluate';
import { CellError, ERR, Value, readTyped, compareValues, isError } from './values';
import { MolProps } from './properties';
import { formatValue } from './numfmt';
import { MAX_COLS, MAX_ROWS, Range, colOf, keyOf, normRange, rowOf, inRange, rangesOverlap } from './refs';
import { CondFormat, CellLook, workOutLooks } from './conditional';
import { TableDef, tableCellLook } from './table-styles';
import { CellNote, copyNote } from './notes';
import { Validation, ValidationHost, validationAt } from './validation';
import type { SheetObject } from './sheet-objects';
import { PageSetup, shiftSetup } from './page-setup';

export type BorderStyle = 'thin' | 'medium' | 'thick' | 'double' | 'dashed' | 'dotted';
export interface Border { style: BorderStyle; color?: string }
export type Side = 'top' | 'right' | 'bottom' | 'left';

export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Text colour, "#rrggbb". */
  color?: string;
  /** Fill colour, "#rrggbb". */
  fill?: string;
  font?: string;
  /** Font size in points. */
  size?: number;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  wrap?: boolean;
  /** An Excel number format ("0.00", "0%", "0.00E+00"). */
  numFmt?: string;
  borders?: Partial<Record<Side, Border>>;
  /** Shown as chemistry: the numbers of CH2Cl2 or C9H8O4 lowered, charges raised. */
  chem?: boolean;
}

/** A drawing in a cell. Never changed once made: a new drawing gets a new id, so pictures and properties can be kept by id. */
export interface Structure {
  id: number;
  contents: Contents;
}

export interface Cell {
  /** What was typed: a number or text as typed, or a formula starting with =. */
  input?: string;
  /** A structure drawn in the cell. */
  structure?: Structure;
  style?: CellStyle;
  /** Where the cell links to (Insert > Link): a web page, a DOI, a file or a place (#Sheet1!A1); see links.ts. */
  link?: string;
}

/** A property column: every row from `firstRow` down to the end of the table works out this formula. */
export interface ColumnDef {
  /** The formula for `firstRow` (e.g. =MW(B2)); each row below gets it moved down. */
  formula: string;
  /** The first row of data (the row under the header). */
  firstRow: number;
  /** Number format and chemistry look of the column's cells, unless a cell has its own. */
  style?: CellStyle;
}

export type CompareOp = '<' | '<=' | '>' | '>=' | '=' | '<>';

export type Condition =
  /** Only rows whose cell shows one of these texts ('' for empty cells). */
  | { kind: 'values'; allowed: string[] }
  /** Rows whose value passes a test (MW < 500), or two tests joined with and/or. */
  | { kind: 'compare'; op: CompareOp; value: number | string; join?: 'and' | 'or'; op2?: CompareOp; value2?: number | string }
  /** Rows whose cell text contains this (ignoring capitals). */
  | { kind: 'contains'; text: string }
  /** Rows whose structure contains this drawn part. */
  | { kind: 'substructure'; query: Contents; smiles?: string };

export interface Filter {
  /** The table filtered: its first row holds the headers. */
  range: Range;
  /** A condition for some columns (by column number). */
  conditions: Record<number, Condition>;
}

export interface SortKey { col: number; descending?: boolean }

/** What the sheet needs from the chemistry engine. Answers that aren't ready are #BUSY!; `ready` is called when they are. */
export interface ChemHost {
  structure(s: Structure): MolProps | CellError;
  smiles(text: string): MolProps | CellError;
  /** Does the structure contain the query? Null while being worked out. */
  substructure?(s: Structure, query: Contents): boolean | null;
}

/** A block of cells taken by Copy, to paste elsewhere. */
export interface CellBlock {
  rows: number;
  cols: number;
  cells: (Cell | undefined)[][];
  /** Where it was copied from (formulas move by the distance to where they're pasted); null for text from other programs. */
  origin: { row: number; col: number } | null;
  /** What the formulas showed when copied, as typed text (for Paste Values). */
  shown?: (string | undefined)[][];
  /** Notes and comments on the cells (pasted with everything else, as in Excel). */
  notes?: (CellNote | undefined)[][];
}

/** A worked-out value as text that types back in as the same value. */
export function valueInput(v: Value | CellError): string {
  if (v instanceof CellError) return v.code;
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  // text that would be read as a number or a formula is kept as text
  const t = readTyped(v);
  return t.formula || typeof t.value !== 'string' || t.value !== v ? "'" + v : v;
}

let nextStructureId = 1;
/** A new structure from a drawing. */
export function makeStructure(contents: Contents): Structure {
  return { id: nextStructureId++, contents };
}

/** A cell with nothing in it and no formatting. */
const isBlankCell = (c: Cell | undefined): boolean => !c || (!c.input && !c.structure && !c.link && !hasStyle(c.style));
const hasStyle = (s: CellStyle | undefined): boolean => !!s && Object.values(s).some((v) => v !== undefined);

const sameStyle = (a: CellStyle | undefined, b: CellStyle | undefined): boolean =>
  a === b || (!hasStyle(a) && !hasStyle(b)) || JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

/** Two cells holding the same thing, formatted the same way. */
function sameCell(a: Cell | undefined, b: Cell | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (a.input || undefined) === (b.input || undefined) && a.structure === b.structure && a.link === b.link && sameStyle(a.style, b.style);
}

/** Two styles merged, the second's settings winning. */
export function mergeStyle(a: CellStyle | undefined, b: CellStyle | undefined): CellStyle | undefined {
  if (!a) return b;
  if (!b) return a;
  const out: CellStyle = { ...a };
  for (const [k, v] of Object.entries(b)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  if (a.borders || b.borders) out.borders = { ...a.borders, ...b.borders };
  return out;
}

/** A style with some settings changed (undefined removes a setting). */
function patchStyleWith(s: CellStyle | undefined, patch: Partial<CellStyle>): CellStyle | undefined {
  const out: CellStyle = { ...s };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'borders' && v) out.borders = { ...out.borders, ...(v as CellStyle['borders']) };
    else (out as Record<string, unknown>)[k] = v;
  }
  for (const k of Object.keys(out) as (keyof CellStyle)[]) if (out[k] === undefined) delete out[k];
  if (out.borders) {
    for (const k of Object.keys(out.borders) as Side[]) if (!out.borders[k]) delete out.borders[k];
    if (!Object.keys(out.borders).length) delete out.borders;
  }
  return Object.keys(out).length ? out : undefined;
}

// ---------------------------------------------------------------- history

type MapField = 'cells' | 'colWidths' | 'rowHeights' | 'colDefs' | 'colStyles' | 'hiddenRows' | 'hiddenCols' | 'notes';
type ValueField = 'merges' | 'filter' | 'frozen' | 'name' | 'condFormats' | 'tables' | 'charts' | 'dashboard' | 'validations' | 'objects' | 'pageSetup';

interface Change {
  sheet: Sheet | null; // null: the workbook's list of sheets
  field: MapField | ValueField | 'sheets';
  key: number;
  before: unknown;
  after: unknown;
}

/** Where the selection was, so undo and redo can show what changed. */
export interface Place { sheet: Sheet; sel: Range }

interface Entry {
  label: string;
  changes: Change[];
  before?: Place;
  after?: Place;
}

let nextSheetUid = 1;

/** Selections up to this many cells keep formatting in their empty cells too. */
const SMALL_BLOCK = 10000;

export class Sheet {
  readonly uid = nextSheetUid++;
  cells = new Map<number, Cell>();
  /** Column widths and row heights set by hand, in pixels at 100% zoom. */
  colWidths = new Map<number, number>();
  rowHeights = new Map<number, number>();
  /** Formatting for whole columns (new cells in them start with it). */
  colStyles = new Map<number, CellStyle>();
  /** Property columns. */
  colDefs = new Map<number, ColumnDef>();
  hiddenRows = new Map<number, true>();
  hiddenCols = new Map<number, true>();
  merges: Range[] = [];
  filter: Filter | null = null;
  /** Rows and columns that stay put while scrolling. */
  frozen = { rows: 0, cols: 0 };
  /** Conditional formatting rules, the first in the list winning. */
  condFormats: CondFormat[] = [];
  /** Blocks formatted as tables (Excel's Format as Table). */
  tables: TableDef[] = [];
  /** Charts floating over the cells. */
  charts: Chart[] = [];
  /** A dashboard sheet's tiles (null: an ordinary sheet of cells). */
  dashboard: Dashboard | null = null;
  /** Notes and comments, by cell. */
  notes = new Map<number, CellNote>();
  /** Data validation rules (what may be typed in some cells, and drop-down lists). */
  validations: Validation[] = [];
  /** Pictures, shapes and text boxes floating over the cells (drawn above the charts, the last on top). */
  objects: SheetObject[] = [];
  /** How the sheet prints (null: Excel's defaults). */
  pageSetup: PageSetup | null = null;
  private looks: { gen: number; rules: CondFormat[]; map: Map<number, CellLook> } | null = null;
  /** Goes up each time the values are worked out again (all of them, or only those an edit changed). */
  valuesGen = 0;

  /** Worked out by Workbook.recalc: the value of every cell in use. */
  values = new Map<number, Value>();
  /** The formula each formula cell works out (its own, or its property column's). */
  formulas = new Map<number, string>();
  /** The last row and column in use (−1 when the sheet is empty). */
  lastRow = -1;
  lastCol = -1;
  /** The last row with data outside property columns: property columns reach down to here. */
  lastDataRow = -1;

  constructor(public wb: Workbook, public name: string) {}

  // ---------------------------------------------------------------- reading

  cell(row: number, col: number): Cell | undefined {
    return this.cells.get(keyOf(row, col));
  }

  value(row: number, col: number): Value {
    return this.values.get(keyOf(row, col)) ?? null;
  }

  /** The property column a cell is in, when it works out the column's formula (nothing typed over it). */
  defAt(row: number, col: number): ColumnDef | null {
    const def = this.colDefs.get(col);
    if (!def || row < def.firstRow || row > this.lastDataRow) return null;
    const c = this.cell(row, col);
    return c?.input || c?.structure ? null : def;
  }

  /** What the cell works out: its own input, or its property column's formula moved to its row. */
  effectiveInput(row: number, col: number): string | undefined {
    const c = this.cell(row, col);
    if (c?.input) return c.input;
    const def = this.defAt(row, col);
    return def ? shiftFormula(def.formula, row - def.firstRow, 0) : undefined;
  }

  /** True when a value has been typed over a property column's own formula. */
  isOverride(row: number, col: number): boolean {
    const def = this.colDefs.get(col);
    if (!def || row < def.firstRow) return false;
    const c = this.cell(row, col);
    if (!c?.input) return false;
    return normalizeFormula(c.input) !== normalizeFormula(shiftFormula(def.formula, row - def.firstRow, 0));
  }

  /** The formatting that applies to a cell: its column's, then its property column's, then its own. */
  styleAt(row: number, col: number): CellStyle | undefined {
    const def = this.colDefs.get(col);
    const defStyle = def && row >= def.firstRow ? def.style : undefined;
    return mergeStyle(mergeStyle(this.colStyles.get(col), defStyle), this.cell(row, col)?.style);
  }

  /** What conditional formatting does to a cell (worked out once per change of values or rules). */
  condLook(row: number, col: number): CellLook | undefined {
    if (!this.condFormats.length) return undefined;
    if (!this.looks || this.looks.gen !== this.valuesGen || this.looks.rules !== this.condFormats) {
      const host = {
        value: (r: number, c: number) => this.value(r, c),
        formulaAt: (f: string, home: { row: number; col: number }, r: number, c: number) => this.wb.formulaAt(this, f, home, r, c),
      };
      this.looks = { gen: this.valuesGen, rules: this.condFormats, map: workOutLooks(this.condFormats, host, Math.max(this.lastRow, this.lastDataRow), this.lastCol) };
    }
    return this.looks.map.get(keyOf(row, col));
  }

  /** The note or comment on a cell. */
  noteAt(row: number, col: number): CellNote | undefined {
    return this.notes.get(keyOf(row, col));
  }

  /** The data validation rule on a cell. */
  validationAt(row: number, col: number): Validation | undefined {
    return this.validations.length ? validationAt(this.validations, row, col) : undefined;
  }

  /** The table a cell is in, if any. */
  tableAt(row: number, col: number): TableDef | undefined {
    return this.tables.find((t) => inRange(t.range, row, col));
  }

  /**
   * The formatting a cell shows: its table's look, then its own formatting, then conditional
   * formatting on top. (Saving uses styleAt: tables and rules are saved as themselves.)
   */
  shownStyleAt(row: number, col: number): CellStyle | undefined {
    let st = this.styleAt(row, col);
    const t = this.tables.length ? this.tableAt(row, col) : undefined;
    if (t) {
      const look = tableCellLook(t, row, col, (r) => this.hiddenRows.has(r));
      if (look) st = mergeStyle(look as CellStyle, st);
    }
    const cf = this.condLook(row, col);
    if (cf && (cf.fill || cf.color || cf.bold || cf.italic || cf.underline)) {
      st = mergeStyle(st, { fill: cf.fill, color: cf.color, bold: cf.bold, italic: cf.italic, underline: cf.underline });
    }
    return st;
  }

  /** The text a cell shows (numbers in its format). */
  shownText(row: number, col: number): string {
    return formatValue(this.value(row, col), this.styleAt(row, col)?.numFmt).text;
  }

  /** The merged block a cell belongs to, if any. */
  mergeAt(row: number, col: number): Range | null {
    for (const m of this.merges) if (inRange(m, row, col)) return m;
    return null;
  }

  /** Every cell in use within a range (keys), without visiting empty space. */
  keysIn(r: Range): number[] {
    const out: number[] = [];
    const span = (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1);
    if (span <= this.cells.size * 2) {
      for (let row = r.r1; row <= r.r2; row++) for (let col = r.c1; col <= r.c2; col++) if (this.cells.has(keyOf(row, col))) out.push(keyOf(row, col));
    } else {
      for (const k of this.cells.keys()) if (inRange(r, rowOf(k), colOf(k))) out.push(k);
    }
    return out;
  }

  /** The range in use, as a block (null when empty). */
  usedRange(): Range | null {
    return this.lastRow < 0 ? null : { r1: 0, c1: 0, r2: this.lastRow, c2: this.lastCol };
  }

  /**
   * The table around a cell, as Excel's Ctrl+A and Filter find it: the block of filled cells
   * reaching it, bounded by empty rows and columns.
   */
  currentRegion(row: number, col: number): Range {
    let r: Range = { r1: row, c1: col, r2: row, c2: col };
    const filled = (rr: number, cc: number) => rr >= 0 && cc >= 0 && (this.values.has(keyOf(rr, cc)) || !!this.cell(rr, cc)?.structure);
    for (let grew = true; grew; ) {
      grew = false;
      const tryGrow = (side: Side) => {
        const n = { ...r };
        if (side === 'top') n.r1--; else if (side === 'bottom') n.r2++; else if (side === 'left') n.c1--; else n.c2++;
        if (n.r1 < 0 || n.c1 < 0) return;
        const line: [number, number][] = [];
        if (side === 'top' || side === 'bottom') {
          const rr = side === 'top' ? n.r1 : n.r2;
          for (let cc = n.c1 - 1; cc <= n.c2 + 1; cc++) line.push([rr, cc]);
        } else {
          const cc = side === 'left' ? n.c1 : n.c2;
          for (let rr = n.r1 - 1; rr <= n.r2 + 1; rr++) line.push([rr, cc]);
        }
        if (line.some(([a, b]) => filled(a, b))) {
          r = n;
          grew = true;
        }
      };
      (['top', 'bottom', 'left', 'right'] as Side[]).forEach(tryGrow);
    }
    return r;
  }

  // ---------------------------------------------------------------- changing (recorded for undo)

  private put<K, V>(field: MapField, map: Map<K, V>, key: K, value: V | undefined): void {
    const before = map.get(key);
    if (before === value) return;
    if (value === undefined) map.delete(key);
    else map.set(key, value);
    this.wb.record({ sheet: this, field, key: key as unknown as number, before, after: value });
  }

  private assign<F extends ValueField>(field: F, value: Sheet[F]): void {
    const before = this[field];
    if (before === value) return;
    (this as Record<string, unknown>)[field] = value;
    this.wb.record({ sheet: this, field, key: 0, before, after: value });
  }

  /** Replace a cell (undefined or an empty cell removes it). */
  setCell(row: number, col: number, cell: Cell | undefined): void {
    const next = isBlankCell(cell) ? undefined : cell;
    if (sameCell(this.cell(row, col), next)) return;
    this.put('cells', this.cells, keyOf(row, col), next);
    // the used area grows straight away (recalc works it out exactly), so later steps of the same edit reach this cell
    if (next) { this.lastRow = Math.max(this.lastRow, row); this.lastCol = Math.max(this.lastCol, col); }
  }

  /** Type into a cell. The text replaces anything in it (a structure too); formatting stays, and a format suggested by the typing is added. */
  setInput(row: number, col: number, input: string): void {
    const old = this.cell(row, col);
    let style = old ? old.style : this.colStyles.get(col);
    const text = input.startsWith('=') ? normalizeFormula(input) : input;
    const typed = readTyped(text);
    if (typed.format && !this.styleAt(row, col)?.numFmt) style = patchStyleWith(style, { numFmt: typed.format });
    this.setCell(row, col, { input: text || undefined, style, link: old?.link });
  }

  /** Link a cell somewhere (undefined takes its link off); its text and formatting stay. */
  setLink(row: number, col: number, link: string | undefined): void {
    const old = this.cell(row, col);
    this.setCell(row, col, { ...old, style: old ? old.style : this.colStyles.get(col), link });
  }

  /** Put a drawing in a cell (null takes it out). */
  setStructure(row: number, col: number, contents: Contents | null): void {
    const old = this.cell(row, col);
    const empty = !contents || !contents.atoms.length && !contents.captions.length && !contents.arrows.length && !contents.shapes.length;
    this.setCell(row, col, { style: old ? old.style : this.colStyles.get(col), structure: empty ? undefined : makeStructure(contents!), link: old?.link });
  }

  /** Change some formatting of every cell in a range (whole columns change the column's formatting too). */
  patchStyle(r: Range, patch: Partial<CellStyle>): void {
    const whole = r.r1 === 0 && r.r2 >= MAX_ROWS - 1;
    if (whole) for (let c = r.c1; c <= Math.min(r.c2, MAX_COLS - 1); c++) this.put('colStyles', this.colStyles, c, patchStyleWith(this.colStyles.get(c), patch));
    // a block of cells keeps its formatting even where they are empty, so a number typed in later
    // shows in it (a temperature column formatted before it is filled in); for whole rows and
    // columns only the cells in use change, and empty ones only for what shows without content
    const small = !whole && (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1) <= SMALL_BLOCK;
    const used = small ? r : this.clip(r);
    if (!used) return;
    for (let row = used.r1; row <= used.r2; row++) {
      for (let col = used.c1; col <= used.c2; col++) {
        const c = this.cell(row, col);
        if (!c && !small && !('fill' in patch || 'borders' in patch) && !this.defAt(row, col)) continue;
        this.setCell(row, col, { ...c, style: patchStyleWith(c?.style, patch) });
      }
    }
  }

  /** Borders round and inside a range, as Excel's border button sets them. */
  setBorders(r: Range, how: 'all' | 'outside' | 'none' | 'bottom' | 'top' | 'thick-bottom' | 'top-bottom', style: BorderStyle = 'thin'): void {
    const b: Border = { style };
    for (let row = r.r1; row <= Math.min(r.r2, Math.max(this.lastRow, r.r1)); row++) {
      for (let col = r.c1; col <= Math.min(r.c2, Math.max(this.lastCol, r.c1)); col++) {
        const sides: Partial<Record<Side, Border | undefined>> = {};
        if (how === 'none') Object.assign(sides, { top: undefined, right: undefined, bottom: undefined, left: undefined });
        else if (how === 'all') Object.assign(sides, { top: b, right: b, bottom: b, left: b });
        else {
          if ((how === 'outside' || how === 'top' || how === 'top-bottom') && row === r.r1) sides.top = b;
          if ((how === 'outside' || how === 'bottom' || how === 'top-bottom') && row === r.r2) sides.bottom = b;
          if (how === 'thick-bottom' && row === r.r2) sides.bottom = { style: 'medium' };
          if (how === 'outside' && col === r.c1) sides.left = b;
          if (how === 'outside' && col === r.c2) sides.right = b;
        }
        if (!Object.keys(sides).length) continue;
        const c = this.cell(row, col);
        const borders = { ...c?.style?.borders, ...sides } as Partial<Record<Side, Border>>;
        this.setCell(row, col, { ...c, style: patchStyleWith({ ...c?.style, borders: undefined }, { borders }) });
      }
    }
  }

  setColWidth(col: number, px: number | undefined): void {
    this.put('colWidths', this.colWidths, col, px === undefined ? undefined : Math.max(0, Math.round(px)));
  }

  setRowHeight(row: number, px: number | undefined): void {
    this.put('rowHeights', this.rowHeights, row, px === undefined ? undefined : Math.max(0, Math.round(px)));
  }

  setColDef(col: number, def: ColumnDef | undefined): void {
    this.put('colDefs', this.colDefs, col, def ? { ...def, formula: normalizeFormula(def.formula) } : undefined);
  }

  setColStyle(col: number, style: CellStyle | undefined): void {
    this.put('colStyles', this.colStyles, col, style);
  }

  setRowHidden(row: number, hidden: boolean): void {
    this.put('hiddenRows', this.hiddenRows, row, hidden ? true : undefined);
  }

  setColHidden(col: number, hidden: boolean): void {
    this.put('hiddenCols', this.hiddenCols, col, hidden ? true : undefined);
  }

  setMerges(list: Range[]): void {
    this.assign('merges', list);
  }

  /** Merge a block into one cell (keeping the top-left cell's content, as Excel does). Blocks it overlaps are unmerged first. */
  merge(r: Range): void {
    if (r.r1 === r.r2 && r.c1 === r.c2) return;
    for (const k of this.keysIn(r)) {
      if (rowOf(k) === r.r1 && colOf(k) === r.c1) continue;
      const c = this.cells.get(k)!;
      if (c.input || c.structure) this.setCell(rowOf(k), colOf(k), { style: c.style });
    }
    this.setMerges([...this.merges.filter((m) => !rangesOverlap(m, r)), { ...r }]);
  }

  unmerge(r: Range): void {
    const keep = this.merges.filter((m) => !rangesOverlap(m, r));
    if (keep.length !== this.merges.length) this.setMerges(keep);
  }

  setCondFormats(list: CondFormat[]): void {
    this.assign('condFormats', list);
  }

  setTables(list: TableDef[]): void {
    this.assign('tables', list);
  }

  setCharts(list: Chart[]): void {
    this.assign('charts', list);
  }

  setDashboard(d: Dashboard | null): void {
    this.assign('dashboard', d);
  }

  setObjects(list: SheetObject[]): void {
    this.assign('objects', list);
  }

  setPageSetup(ps: PageSetup | null): void {
    this.assign('pageSetup', ps);
  }

  /** Put a note or comment on a cell (undefined takes it off). */
  setNote(row: number, col: number, note: CellNote | undefined): void {
    this.put('notes', this.notes, keyOf(row, col), note);
  }

  setValidations(list: Validation[]): void {
    this.assign('validations', list);
  }

  setFrozen(rows: number, cols: number): void {
    this.assign('frozen', { rows: Math.max(0, rows), cols: Math.max(0, cols) });
  }

  rename(name: string): void {
    const old = this.name;
    if (old === name) return;
    this.assign('name', name);
    // formulas that name the sheet follow it
    this.wb.rewriteAllFormulas((f) => renameSheetInFormula(f, old, name));
  }

  /**
   * Empty cells: their contents, their formatting, both (with their notes, as Excel's Clear All),
   * or only their notes and comments. Nothing outside the cells in use is visited.
   */
  clear(r: Range, what: 'contents' | 'formats' | 'all' | 'notes' = 'contents'): void {
    if (what === 'all' || what === 'notes') for (const k of [...this.notes.keys()]) if (inRange(r, rowOf(k), colOf(k))) this.put('notes', this.notes, k, undefined);
    if (what === 'notes') return;
    if (what !== 'contents' && r.r1 === 0 && r.r2 >= MAX_ROWS - 1) for (let c = r.c1; c <= Math.min(r.c2, this.lastCol); c++) this.setColStyle(c, undefined);
    for (const k of this.keysIn(r)) {
      const c = this.cells.get(k)!;
      if (what === 'all') this.setCell(rowOf(k), colOf(k), undefined);
      else if (what === 'contents') this.setCell(rowOf(k), colOf(k), { style: c.style });
      else this.setCell(rowOf(k), colOf(k), { input: c.input, structure: c.structure, link: c.link });
    }
    // clearing a property column's header and cells together takes the property column away
    if (what !== 'formats') {
      for (const [col, d] of [...this.colDefs]) if (col >= r.c1 && col <= r.c2 && r.r1 <= d.firstRow - 1 && r.r2 >= this.lastDataRow) this.setColDef(col, undefined);
    }
  }

  /** Put a block of copied cells at a place, moving formulas by the distance (Excel's paste). */
  paste(at: { row: number; col: number }, block: CellBlock, what: 'all' | 'values' | 'formats' = 'all'): Range {
    const target: Range = { r1: at.row, c1: at.col, r2: at.row + block.rows - 1, c2: at.col + block.cols - 1 };
    for (let i = 0; i < block.rows; i++) {
      for (let j = 0; j < block.cols; j++) {
        const src = block.cells[i]?.[j];
        const row = at.row + i, col = at.col + j;
        if (row >= MAX_ROWS || col >= MAX_COLS) continue;
        const old = this.cell(row, col);
        if (what === 'formats') { this.setCell(row, col, { ...old, style: src?.style }); continue; }
        let input = src?.input;
        // Paste Values puts in what the formulas showed (worked out when copied)
        if (what === 'values' && input?.startsWith('=') && block.shown?.[i]?.[j] !== undefined) input = block.shown[i][j];
        else if (input?.startsWith('=') && block.origin) input = shiftFormula(input, row - (block.origin.row + i), col - (block.origin.col + j));
        const style = what === 'values' ? old?.style : src?.style;
        this.setCell(row, col, { input, structure: src?.structure, style, link: what === 'values' ? old?.link : src?.link });
        const note = block.notes?.[i]?.[j];
        if (what === 'all' && note) this.setNote(row, col, copyNote(note));
      }
    }
    return target;
  }

  /**
   * Cut and Paste on this sheet: the block goes to its new place as it is (its formulas aren't
   * moved by the distance, as a copy's are), and formulas anywhere that pointed at its cells point
   * at them in their new place, as in Excel.
   */
  move(from: Range, at: { row: number; col: number }, what: 'all' | 'values' | 'formats' = 'all'): Range {
    const dr = at.row - from.r1, dc = at.col - from.c1;
    const block = this.copy(from);
    this.clear(from, 'all');
    const follow = (f: string, home: string) => moveRefs(f, home, this.name, from, dr, dc);
    block.cells = block.cells.map((line) => line.map((c) => (c?.input?.startsWith('=') ? { ...c, input: follow(c.input, this.name) } : c)));
    this.wb.rewriteAllFormulas(follow);
    return this.paste(at, { ...block, origin: null }, what);
  }

  /** The cells of a range, for Copy (property columns give their formulas). */
  copy(r: Range): CellBlock {
    const cells: (Cell | undefined)[][] = [];
    const shown: (string | undefined)[][] = [];
    const notes: (CellNote | undefined)[][] = [];
    let formulas = false;
    for (let row = r.r1; row <= r.r2; row++) {
      if (this.notes.size) notes.push(Array.from({ length: r.c2 - r.c1 + 1 }, (_, j) => this.noteAt(row, r.c1 + j)));
      const line: (Cell | undefined)[] = [];
      const seen: (string | undefined)[] = [];
      for (let col = r.c1; col <= r.c2; col++) {
        const c = this.cell(row, col);
        const input = this.effectiveInput(row, col);
        const style = this.styleAt(row, col);
        line.push(input || c?.structure || style || c?.link ? { input, structure: c?.structure, style, ...(c?.link ? { link: c.link } : {}) } : undefined);
        if (input?.startsWith('=')) { formulas = true; seen.push(valueInput(this.value(row, col))); } else seen.push(undefined);
      }
      cells.push(line);
      shown.push(seen);
    }
    const noted = notes.some((line) => line.some(Boolean));
    return { rows: r.r2 - r.r1 + 1, cols: r.c2 - r.c1 + 1, cells, origin: { row: r.r1, col: r.c1 }, ...(formulas ? { shown } : {}), ...(noted ? { notes } : {}) };
  }

  /** The used part of a range (null when it holds nothing). */
  clip(r: Range): Range | null {
    const r2 = Math.min(r.r2, Math.max(this.lastRow, this.lastDataRow)), c2 = Math.min(r.c2, this.lastCol);
    if (r2 < r.r1 || c2 < r.c1) return null;
    return { r1: r.r1, c1: r.c1, r2, c2 };
  }

  // ---------------------------------------------------------------- fill

  /**
   * Fill from a block into a larger one that extends it down, up, right or left (Ctrl+D,
   * Ctrl+R, and dragging the fill handle). Formulas move as they would when copied. With
   * `series`, numbers continue their steps (1, 2 → 3, 4) and text ending in a number or a
   * compound letter counts on (S1 → S2, 2a → 2b); otherwise cells are copied.
   */
  fill(src: Range, dst: Range, series = false): void {
    const down = dst.r1 === src.r1 && dst.r2 > src.r2;
    const up = dst.r2 === src.r2 && dst.r1 < src.r1;
    const vertical = down || up || (dst.c1 === src.c1 && dst.c2 === src.c2);
    const srcLen = vertical ? src.r2 - src.r1 + 1 : src.c2 - src.c1 + 1;
    const lines = vertical ? src.c2 - src.c1 + 1 : src.r2 - src.r1 + 1;
    for (let l = 0; l < lines; l++) {
      // the source cells of this column (or row), in order
      const at = (i: number): [number, number] => (vertical ? [src.r1 + i, src.c1 + l] : [src.r1 + l, src.c1 + i]);
      const srcCells = Array.from({ length: srcLen }, (_, i) => {
        const [r, c] = at(i);
        return { r, c, cell: this.cell(r, c), input: this.effectiveInput(r, c) };
      });
      const nums = srcCells.map((s) => (s.input && !s.input.startsWith('=') ? readTyped(s.input).value : null));
      const numeric = series && nums.every((v) => typeof v === 'number');
      const step = numeric && nums.length > 1 ? ((nums[nums.length - 1] as number) - (nums[0] as number)) / (nums.length - 1) : 1;
      const textStep = series && !numeric && srcLen > 1 ? textSeriesStep(srcCells.map((s) => s.input)) : null;
      const targets: [number, number][] = [];
      if (vertical) {
        for (let r = dst.r1; r <= dst.r2; r++) if (r < src.r1 || r > src.r2) targets.push([r, src.c1 + l]);
      } else {
        for (let c = dst.c1; c <= dst.c2; c++) if (c < src.c1 || c > src.c2) targets.push([src.r1 + l, c]);
      }
      for (const [r, c] of targets) {
        const pos = vertical ? r - src.r1 : c - src.c1; // may be negative when filling up or left
        const idx = ((pos % srcLen) + srcLen) % srcLen;
        const s = srcCells[idx];
        let input = s.input;
        if (input?.startsWith('=')) input = shiftFormula(input, r - s.r, c - s.c);
        else if (numeric) {
          const v = (nums[0] as number) + step * pos;
          input = String(Number(v.toPrecision(15)));
        } else if (series && input) {
          // S1, S2 → S3, S4 (the cells go on as one series); otherwise each cell counts on by itself (a1, b7 → a2, b8)
          input = textStep !== null ? countOn(srcCells[0].input!, textStep * pos) : countOn(input, Math.floor(pos / srcLen));
        }
        const keepsDef = !s.cell?.input && this.defAt(r, c) && input === this.effectiveInput(r, c);
        this.setCell(r, c, { input: keepsDef ? undefined : input, structure: s.cell?.structure, style: s.cell?.style, link: s.cell?.link });
      }
    }
  }

  // ---------------------------------------------------------------- inserting and deleting rows and columns

  insertRows(at: number, count = 1): void { this.shiftAxis('row', at, count); }
  deleteRows(at: number, count = 1): void { this.shiftAxis('row', at, -count); }
  insertCols(at: number, count = 1): void { this.shiftAxis('col', at, count); }
  deleteCols(at: number, count = 1): void { this.shiftAxis('col', at, -count); }

  private shiftAxis(axis: 'row' | 'col', at: number, count: number): void {
    const ch: SheetChange = { sheet: this.name, axis, at, count };
    const pos = (k: number) => (axis === 'row' ? rowOf(k) : colOf(k));
    const moved = (k: number): number | null => {
      const p = pos(k);
      if (p < at) return k;
      if (count < 0 && p < at - count) return null;
      return axis === 'row' ? keyOf(rowOf(k) + count, colOf(k)) : keyOf(rowOf(k), colOf(k) + count);
    };
    // the cells: taken out, then put back in their new places (formulas everywhere are fixed below)
    const old = [...this.cells];
    for (const [k] of old) if (moved(k) !== k) this.put('cells', this.cells, k, undefined);
    for (const [k, c] of old) {
      const nk = moved(k);
      if (nk !== null && nk !== k && (axis === 'row' ? rowOf(nk) : colOf(nk)) < (axis === 'row' ? MAX_ROWS : MAX_COLS)) this.put('cells', this.cells, nk, c);
    }
    // notes go with their cells (and with them when they are deleted)
    if (this.notes.size) {
      const oldNotes = [...this.notes];
      for (const [k] of oldNotes) if (moved(k) !== k) this.put('notes', this.notes, k, undefined);
      for (const [k, n] of oldNotes) {
        const nk = moved(k);
        if (nk !== null && nk !== k && (axis === 'row' ? rowOf(nk) : colOf(nk)) < (axis === 'row' ? MAX_ROWS : MAX_COLS)) this.put('notes', this.notes, nk, n);
      }
    }
    const shiftMap = <V>(field: MapField, map: Map<number, V>, onAxis: boolean) => {
      if (!onAxis) return;
      const entries = [...map];
      for (const [i] of entries) if (i >= at) this.put(field, map, i, undefined);
      for (const [i, v] of entries) {
        if (i < at) continue;
        if (count < 0 && i < at - count) continue;
        this.put(field, map, i + count, v);
      }
    };
    shiftMap('rowHeights', this.rowHeights, axis === 'row');
    shiftMap('hiddenRows', this.hiddenRows, axis === 'row');
    shiftMap('colWidths', this.colWidths, axis === 'col');
    shiftMap('hiddenCols', this.hiddenCols, axis === 'col');
    shiftMap('colStyles', this.colStyles, axis === 'col');
    shiftMap('colDefs', this.colDefs, axis === 'col');
    // blocks: merged cells and the filter
    const moveRange = (r: Range): Range | null => {
      const lo = axis === 'row' ? r.r1 : r.c1, hi = axis === 'row' ? r.r2 : r.c2;
      let nlo = lo, nhi = hi;
      if (count > 0) {
        if (lo >= at) { nlo += count; nhi += count; } else if (hi >= at) nhi += count;
      } else {
        const n = -count, end = at + n - 1;
        if (lo > end) { nlo -= n; nhi -= n; }
        else if (hi >= at) {
          nlo = lo < at ? lo : at;
          nhi = hi > end ? hi - n : at - 1;
          if (nhi < nlo) return null;
        }
      }
      return axis === 'row' ? { ...r, r1: nlo, r2: nhi } : { ...r, c1: nlo, c2: nhi };
    };
    const merges = this.merges.map(moveRange).filter((r): r is Range => !!r && !(r.r1 === r.r2 && r.c1 === r.c2));
    if (JSON.stringify(merges) !== JSON.stringify(this.merges)) this.setMerges(merges);
    // conditional formatting and tables move and stretch with their cells
    if (this.condFormats.length) {
      const cfs = this.condFormats.map((cf) => ({ ...cf, ranges: cf.ranges.map(moveRange).filter((r): r is Range => !!r) })).filter((cf) => cf.ranges.length);
      if (JSON.stringify(cfs) !== JSON.stringify(this.condFormats)) this.setCondFormats(cfs);
    }
    if (this.tables.length) {
      const ts = this.tables.map((t) => ({ ...t, range: moveRange(t.range)! })).filter((t) => t.range);
      if (JSON.stringify(ts) !== JSON.stringify(this.tables)) this.setTables(ts);
    }
    if (this.validations.length) {
      const vs = this.validations.map((v) => ({ ...v, ranges: v.ranges.map(moveRange).filter((r): r is Range => !!r) })).filter((v) => v.ranges.length);
      if (JSON.stringify(vs) !== JSON.stringify(this.validations)) this.setValidations(vs);
    }
    // charts sit where their corner cell goes (at the edge of a deleted block when it goes)
    if (this.charts.length) {
      const cs = this.charts.map((c) => {
        const i = axis === 'row' ? c.at.row : c.at.col;
        const n = i < at ? i : count > 0 ? i + count : i >= at - count ? i + count : at;
        return n === i ? c : { ...c, at: axis === 'row' ? { ...c.at, row: n } : { ...c.at, col: n } };
      });
      if (cs.some((c, i) => c !== this.charts[i])) this.setCharts(cs);
    }
    if (this.objects.length) {
      const os = this.objects.map((o) => {
        if (o.placement === 'absolute') return o;
        const i = axis === 'row' ? o.at.row : o.at.col;
        const n = i < at ? i : count > 0 ? i + count : i >= at - count ? i + count : at;
        return n === i ? o : { ...o, at: axis === 'row' ? { ...o.at, row: n } : { ...o.at, col: n } };
      });
      if (os.some((o, i) => o !== this.objects[i])) this.setObjects(os);
    }
    if (this.pageSetup) {
      const ps = shiftSetup(this.pageSetup, axis, at, count);
      if (JSON.stringify(ps) !== JSON.stringify(this.pageSetup)) this.setPageSetup(Object.keys(ps).length ? ps : null);
    }
    if (this.filter) {
      const range = moveRange(this.filter.range);
      if (!range) this.assign('filter', null);
      else {
        const conditions: Record<number, Condition> = {};
        for (const [c, cond] of Object.entries(this.filter.conditions)) {
          const col = Number(c);
          if (axis === 'row' || col < at) conditions[col] = cond;
          else if (count > 0) conditions[col + count] = cond;
          else if (col >= at - count) conditions[col + count] = cond;
        }
        this.assign('filter', { range, conditions });
      }
    }
    // property columns start lower when rows go in above them
    if (axis === 'row') {
      for (const [col, d] of [...this.colDefs]) {
        let firstRow = d.firstRow, base = d.formula;
        if (count < 0 && firstRow >= at && firstRow < at - count) {
          // its first row is deleted: the first row left below it takes over, with that row's formula
          base = shiftFormula(d.formula, at - count - firstRow, 0);
          firstRow = at;
        } else if (firstRow >= at) firstRow += count;
        const formula = adjustFormula(base, this.name, ch);
        if (firstRow !== d.firstRow || formula !== d.formula) this.setColDef(col, { ...d, firstRow, formula });
      }
    }
    this.wb.adjustAllFormulas(ch);
  }

  // ---------------------------------------------------------------- sorting and filtering

  /**
   * Sort the rows of a block by some columns (the first key first). Empty cells go last either
   * way, as in Excel. Structures sort by molecular weight. Formulas move with their rows.
   */
  sort(r: Range, keys: SortKey[]): void {
    const rows: number[] = [];
    for (let row = r.r1; row <= r.r2; row++) rows.push(row);
    const keyValue = (row: number, col: number): Value => {
      const c = this.cell(row, col);
      if (c?.structure) {
        const p = this.wb.chem?.structure(c.structure);
        return p && !isError(p) ? p.mw : null;
      }
      return this.value(row, col);
    };
    const keyed = rows.map((row) => ({ row, k: keys.map((key) => keyValue(row, key.col)) }));
    keyed.sort((a, b) => {
      for (let i = 0; i < keys.length; i++) {
        const x = a.k[i], y = b.k[i];
        const ex = x === null || x === '', ey = y === null || y === '';
        if (ex || ey) { if (ex !== ey) return ex ? 1 : -1; continue; }
        const errx = isError(x), erry = isError(y);
        if (errx || erry) { if (errx !== erry) return errx ? 1 : -1; continue; }
        const c = compareValues(x, y);
        if (c) return keys[i].descending ? -c : c;
      }
      return a.row - b.row;
    });
    if (keyed.every((x, i) => x.row === rows[i])) return;
    const blocks = keyed.map(({ row }) => {
      const line: (Cell | undefined)[] = [];
      const notes: (CellNote | undefined)[] = [];
      for (let col = r.c1; col <= r.c2; col++) { line.push(this.cell(row, col)); notes.push(this.noteAt(row, col)); }
      return { row, line, notes };
    });
    // rows hidden by a filter (or by hand) stay hidden as they move
    const hidden = keyed.map(({ row }) => this.hiddenRows.has(row));
    blocks.forEach(({ row: from, line, notes }, i) => {
      const to = r.r1 + i;
      if (hidden[i] !== this.hiddenRows.has(to)) this.setRowHidden(to, hidden[i]);
      line.forEach((c, j) => {
        const col = r.c1 + j;
        const input = c?.input?.startsWith('=') ? shiftFormula(c.input, to - from, 0) : c?.input;
        this.setCell(to, col, c ? { ...c, input } : undefined);
        // notes move with their rows, as in Excel
        this.setNote(to, col, notes[j]);
      });
    });
  }

  /** Turn the filter on for a table (its first row holding the headers), or off with null. */
  setFilter(f: Filter | null): void {
    this.assign('filter', f ? { range: { ...f.range }, conditions: { ...f.conditions } } : null);
    this.applyFilter();
  }

  /** Put back a filter as a file saved it: the rows it hid are hidden already, so nothing is filtered again. */
  restoreFilter(f: Filter | null): void {
    this.assign('filter', f);
  }

  /** Change one column's condition (null takes it away) and filter again. */
  setCondition(col: number, cond: Condition | null): void {
    if (!this.filter) return;
    const conditions = { ...this.filter.conditions };
    if (cond) conditions[col] = cond;
    else delete conditions[col];
    this.assign('filter', { range: this.filter.range, conditions });
    this.applyFilter();
  }

  /** The rows of the filtered table below its headers (reaching down to the last row of data). */
  filterRows(): { r1: number; r2: number } | null {
    const f = this.filter;
    if (!f) return null;
    return { r1: f.range.r1 + 1, r2: Math.max(f.range.r2, this.lastDataRow) };
  }

  /** Hide the rows that fail the filter's conditions and show the rest (as Excel, once, not as cells change). */
  applyFilter(): void {
    const rows = this.filterRows();
    const old = [...this.hiddenRows.keys()];
    if (!rows) {
      for (const r of old) this.setRowHidden(r, false);
      return;
    }
    for (const r of old) if (r < rows.r1 || r > rows.r2) this.setRowHidden(r, false);
    const conds = Object.entries(this.filter!.conditions).map(([c, cond]) => [Number(c), cond] as const);
    for (let row = rows.r1; row <= rows.r2; row++) {
      const pass = conds.every(([col, cond]) => this.passes(row, col, cond) !== false);
      this.setRowHidden(row, !pass);
    }
  }

  /** Does a cell pass a condition? Null when it can't be told yet (a substructure still being matched). */
  passes(row: number, col: number, cond: Condition): boolean | null {
    const v = this.value(row, col);
    switch (cond.kind) {
      case 'values': return cond.allowed.includes(this.shownText(row, col));
      case 'contains': return this.shownText(row, col).toLowerCase().includes(cond.text.toLowerCase());
      case 'compare': {
        const one = (op: CompareOp, want: number | string): boolean => {
          if (v === null || isError(v)) return op === '<>' && v === null ? want !== '' : false;
          if (typeof want === 'number' && typeof v !== 'number') return op === '<>';
          const c = compareValues(v, want);
          switch (op) {
            case '<': return c < 0;
            case '<=': return c <= 0;
            case '>': return c > 0;
            case '>=': return c >= 0;
            case '=': return c === 0;
            default: return c !== 0;
          }
        };
        const a = one(cond.op, cond.value);
        if (!cond.join || cond.op2 === undefined || cond.value2 === undefined) return a;
        const b = one(cond.op2, cond.value2);
        return cond.join === 'and' ? a && b : a || b;
      }
      case 'substructure': {
        const s = this.cell(row, col)?.structure;
        if (!s) return false;
        return this.wb.chem?.substructure?.(s, cond.query) ?? null;
      }
    }
  }
}

// ---------------------------------------------------------------- the workbook

/** Columns per sheet in the index of which formulas read which cells. */
const READER_COLS = 1 << 15;

/** Changes that leave every value as it was. */
const NO_VALUES = new Set<string>(['colWidths', 'rowHeights', 'colStyles', 'hiddenRows', 'hiddenCols', 'merges', 'filter', 'frozen', 'condFormats', 'tables', 'charts', 'dashboard', 'notes', 'validations', 'objects', 'pageSetup']);

const isFormulaText = (t: string | undefined): boolean => !!t && t.startsWith('=') && t.length > 1;

/** A formula using INDIRECT or OFFSET, whose cells can't be known from its text. */
const VOLATILE = new RegExp(`\\b(?:${VOLATILE_FUNCTIONS.join('|')})\\s*\\(`, 'i');
/** How many times formulas using INDIRECT or OFFSET are worked out again, to catch up with the cells they turned out to read. */
const VOLATILE_PASSES = 4;

/** The formulas of a workbook and the order they are worked out in, as the last full recalculation found them. */
interface Graph {
  sheets: Sheet[];
  nodes: { s: Sheet; key: number; text: string }[];
  /** For each formula, the formulas that read it. */
  dependents: number[][];
  /** For each sheet and column (sheet × READER_COLS + column): first row, last row and formula of each reference into it. */
  readers: Map<number, number[]>;
  /** Formulas in a loop, or reading one: they stay #CIRC! until the formulas change. */
  loop: boolean[];
  /** The formulas in the order they were worked out (each after those it reads). */
  order: number[];
  /** Formulas using INDIRECT or OFFSET. */
  volatile: number[];
  bounds: { lastRow: number; lastCol: number; lastData: number }[];
}

export class Workbook {
  sheets: Sheet[] = [];
  /** The sheet showing. */
  active = 0;
  /** How structures in cells are drawn: bond length, line widths, label size. */
  drawingStyle: DocStyle = { ...ACS_1996 };
  chem: ChemHost | null = null;
  /** Counts changes (edits, undos and redos), so the file knows when it has unsaved changes. */
  edits = 0;
  /** Called after every change, undo and redo. */
  onChange: () => void = () => {};

  private tx: { entry: Entry; byKey: Map<string, Change> } | null = null;
  private undoList: Entry[] = [];
  private redoList: Entry[] = [];
  private parsed = new Map<string, Node | CellError>();
  /** The references in each formula's text (for the order formulas are worked out in). */
  private refsByText = new Map<string, RefToken[]>();
  /** A property column's formula as written in each of its rows. */
  private shifted = new Map<string, string>();
  /** What the last full recalculation found, so an edit to plain values works out only what reads them. */
  private graph: Graph | null = null;
  private literals = new WeakMap<Cell, Value>();

  constructor(sheetNames: string[] = ['Sheet1']) {
    for (const n of sheetNames) this.sheets.push(new Sheet(this, n));
    this.recalc();
  }

  get sheet(): Sheet {
    return this.sheets[this.active];
  }

  sheetNamed(name: string): Sheet | undefined {
    const low = name.toLowerCase();
    return this.sheets.find((s) => s.name.toLowerCase() === low);
  }

  /** "Sheet2", "Sheet3"… not yet used. */
  newSheetName(): string {
    for (let n = this.sheets.length + 1; ; n++) if (!this.sheetNamed(`Sheet${n}`)) return `Sheet${n}`;
  }

  // ---------------------------------------------------------------- transactions and history

  /** Make changes as one undoable step. `place` is where the selection was (and is after), for undo to show. */
  edit<T>(label: string, fn: () => T, before?: Place, after?: () => Place | undefined): T {
    if (this.tx) return fn();
    this.tx = { entry: { label, changes: [], before }, byKey: new Map() };
    let result: T;
    try {
      result = fn();
    } finally {
      const { entry } = this.tx!;
      this.tx = null;
      entry.changes = entry.changes.filter((c) => c.before !== c.after);
      if (entry.changes.length) {
        entry.after = after?.() ?? before;
        this.undoList.push(entry);
        if (this.undoList.length > 500) this.undoList.shift();
        this.redoList.length = 0;
        this.edits++;
        this.recalcAfter(entry.changes);
        this.onChange();
      }
    }
    return result!;
  }

  /** Build without recording (opening a file): afterwards there is nothing to undo and nothing unsaved. */
  build(fn: () => void): void {
    this.edit('Open', fn);
    this.undoList.length = 0;
    this.redoList.length = 0;
    this.edits = 0;
  }

  /** Record one change (called by the sheets). Changes outside a transaction are a step of their own. */
  record(c: Change): void {
    if (!this.tx) {
      this.edit('Edit', () => this.record(c));
      return;
    }
    const id = `${c.sheet?.uid ?? 0}|${c.field}|${c.key}`;
    const had = this.tx.byKey.get(id);
    if (had) had.after = c.after;
    else {
      this.tx.byKey.set(id, c);
      this.tx.entry.changes.push(c);
    }
  }

  canUndo(): boolean { return this.undoList.length > 0; }
  canRedo(): boolean { return this.redoList.length > 0; }
  get undoLabel(): string { return this.undoList[this.undoList.length - 1]?.label ?? ''; }
  get redoLabel(): string { return this.redoList[this.redoList.length - 1]?.label ?? ''; }

  /** Undo the last step. Returns where it happened (to show it), or null. */
  undo(): Place | null {
    const e = this.undoList.pop();
    if (!e) return null;
    for (let i = e.changes.length - 1; i >= 0; i--) this.applyChange(e.changes[i], 'before');
    this.redoList.push(e);
    this.edits++;
    this.recalcAfter(e.changes, 'before');
    this.onChange();
    return e.before ?? e.after ?? null;
  }

  redo(): Place | null {
    const e = this.redoList.pop();
    if (!e) return null;
    for (const c of e.changes) this.applyChange(c, 'after');
    this.undoList.push(e);
    this.edits++;
    this.recalcAfter(e.changes);
    this.onChange();
    return e.after ?? e.before ?? null;
  }

  private applyChange(c: Change, which: 'before' | 'after'): void {
    const v = c[which];
    if (c.field === 'sheets') {
      this.sheets = (v as Sheet[]).slice();
      this.active = Math.min(this.active, this.sheets.length - 1);
      return;
    }
    const s = c.sheet!;
    if (c.field === 'merges' || c.field === 'filter' || c.field === 'frozen' || c.field === 'name' || c.field === 'condFormats' || c.field === 'tables' || c.field === 'charts' || c.field === 'dashboard' || c.field === 'validations' || c.field === 'objects' || c.field === 'pageSetup') {
      (s as unknown as Record<string, unknown>)[c.field] = v;
      return;
    }
    const map = s[c.field] as Map<number, unknown>;
    if (v === undefined) map.delete(c.key);
    else map.set(c.key, v);
  }

  /** Change the list of sheets (add, delete, move), as one recorded change. */
  setSheets(list: Sheet[]): void {
    const before = this.sheets;
    this.sheets = list.slice();
    this.record({ sheet: null, field: 'sheets', key: 0, before, after: this.sheets });
  }

  addSheet(name = this.newSheetName(), at = this.sheets.length): Sheet {
    const s = new Sheet(this, name);
    this.setSheets([...this.sheets.slice(0, at), s, ...this.sheets.slice(at)]);
    return s;
  }

  /** Delete a sheet. Formulas that used it show #REF!. The last sheet can't go. */
  removeSheet(s: Sheet): boolean {
    if (this.sheets.length < 2) return false;
    this.setSheets(this.sheets.filter((x) => x !== s));
    this.active = Math.min(this.active, this.sheets.length - 1);
    return true;
  }

  /** Keep every formula in the workbook pointing at the same cells after rows or columns move. */
  adjustAllFormulas(ch: SheetChange): void {
    // (the changed sheet's property columns are done with its rows)
    this.rewriteAllFormulas((f, home) => adjustFormula(f, home, ch), (s) => s.name === ch.sheet && ch.axis === 'row');
  }

  /**
   * Pass every formula in the workbook (cells, property columns, conditional formatting rules,
   * charts, dashboards) through `fn`.
   */
  rewriteAllFormulas(fn: (formula: string, home: string) => string, skipColDefs?: (s: Sheet) => boolean): void {
    for (const s of this.sheets) {
      for (const [k, c] of [...s.cells]) {
        if (!c.input?.startsWith('=')) continue;
        const f = fn(c.input, s.name);
        if (f !== c.input) s.setCell(rowOf(k), colOf(k), { ...c, input: f });
      }
      if (s.condFormats.some((cf) => cf.rule.kind === 'formula')) {
        const cfs = s.condFormats.map((cf) => {
          if (cf.rule.kind !== 'formula') return cf;
          const was = cf.rule.formula, eq = was.startsWith('=');
          const f = fn(eq ? was : '=' + was, s.name);
          const formula = eq ? f : f.slice(1);
          return formula === was ? cf : { ...cf, rule: { ...cf.rule, formula } };
        });
        if (cfs.some((cf, i) => cf !== s.condFormats[i])) s.setCondFormats(cfs);
      }
      if (!skipColDefs?.(s)) for (const [col, d] of [...s.colDefs]) {
        const f = fn(d.formula, s.name);
        if (f !== d.formula) s.setColDef(col, { ...d, formula: f });
      }
      if (s.charts.length) {
        const cs = s.charts.map((c) => mapChartRefs(c, (f) => fn(f, s.name)));
        if (JSON.stringify(cs) !== JSON.stringify(s.charts)) s.setCharts(cs);
      }
      if (s.dashboard) {
        const d = mapDashboardRefs(s.dashboard, (f) => fn(f, s.name));
        if (JSON.stringify(d) !== JSON.stringify(s.dashboard)) s.setDashboard(d);
      }
      // data validation limits and lists that are formulas or references
      if (s.validations.some((v) => v.value1?.startsWith('=') || v.value2?.startsWith('='))) {
        const f = (t: string | undefined) => (t?.startsWith('=') && t.length > 1 ? fn(t, s.name) : t);
        const vs = s.validations.map((v) => {
          const value1 = f(v.value1), value2 = f(v.value2);
          return value1 === v.value1 && value2 === v.value2 ? v : { ...v, value1, value2 };
        });
        if (vs.some((v, i) => v !== s.validations[i])) s.setValidations(vs);
      }
    }
  }

  // ---------------------------------------------------------------- working out values

  private parse(text: string): Node | CellError {
    let n = this.parsed.get(text);
    if (!n) {
      try {
        n = parseFormula(text);
      } catch (e) {
        n = new CellError('#NAME?', e instanceof FormulaSyntaxError ? e.message : String(e));
      }
      // big enough for every formula of a large workbook, so a recalculation never reads them all again
      if (this.parsed.size > 500000) this.parsed.clear();
      this.parsed.set(text, n);
    }
    return n;
  }

  /** The error from reading a formula (shown in the side panel), or null when it reads. */
  formulaProblem(text: string): string | null {
    const n = this.parse(text);
    return n instanceof CellError ? n.detail : null;
  }

  private literal(c: Cell): Value {
    let v = this.literals.get(c);
    if (v === undefined) {
      v = c.input ? readTyped(c.input).value : null;
      this.literals.set(c, v);
    }
    return v;
  }

  /** The value of a structure cell when a formula reads it: its SMILES. */
  private structureValue(s: Structure): Value {
    const p = this.chem?.structure(s);
    if (!p) return '';
    return isError(p) ? p : p.smiles;
  }

  /** Work out every cell of every sheet. */
  recalc(): void {
    this.identityCache.clear();
    this.graph = null;
    const sheetIndex = new Map(this.sheets.map((s, i) => [s, i] as const));
    // 1. what each cell holds; formulas (own and property columns) found
    const nodes: { s: Sheet; key: number; text: string }[] = [];
    const byId = new Map<number, number>(); // global id → index in nodes
    const gid = (si: number, key: number) => si * 2 ** 35 + key;
    for (const s of this.sheets) {
      const si = sheetIndex.get(s)!;
      s.values = new Map();
      s.valuesGen++;
      s.formulas = new Map();
      let lastRow = -1, lastCol = -1, lastData = -1;
      for (const [k, c] of s.cells) {
        const r = rowOf(k), col = colOf(k);
        // a property column's own formulas don't make the table longer; anything else does
        const def = s.colDefs.get(col);
        if (c.structure || (c.input && (!def || r < def.firstRow || s.isOverride(r, col)))) lastData = Math.max(lastData, r);
        lastRow = Math.max(lastRow, r);
        lastCol = Math.max(lastCol, col);
      }
      s.lastDataRow = lastData;
      for (const col of s.colDefs.keys()) lastCol = Math.max(lastCol, col);
      s.lastRow = Math.max(lastRow, lastData);
      s.lastCol = lastCol;
      for (const [k, c] of s.cells) {
        if (c.structure) s.values.set(k, this.structureValue(c.structure));
        else if (c.input?.startsWith('=') && c.input.length > 1) {
          s.formulas.set(k, c.input);
          byId.set(gid(si, k), nodes.length);
          nodes.push({ s, key: k, text: c.input });
        } else if (c.input) s.values.set(k, this.literal(c));
      }
      for (const [col, d] of s.colDefs) {
        for (let r = d.firstRow; r <= lastData; r++) {
          const k = keyOf(r, col);
          const c = s.cells.get(k);
          if (c?.input || c?.structure) continue;
          const sk = `${r - d.firstRow}|${d.formula}`;
          let text = this.shifted.get(sk);
          if (text === undefined) {
            text = shiftFormula(d.formula, r - d.firstRow, 0);
            if (this.shifted.size > 500000) this.shifted.clear();
            this.shifted.set(sk, text);
          }
          s.formulas.set(k, text);
          byId.set(gid(si, k), nodes.length);
          nodes.push({ s, key: k, text });
        }
      }
    }
    // 2. the order to work them out in: each formula after the formulas it reads
    const formulaRowsByCol = new Map<Sheet, Map<number, number[]>>();
    for (const n of nodes) {
      let m = formulaRowsByCol.get(n.s);
      if (!m) formulaRowsByCol.set(n.s, (m = new Map()));
      const col = colOf(n.key);
      let list = m.get(col);
      if (!list) m.set(col, (list = []));
      list.push(rowOf(n.key));
    }
    for (const m of formulaRowsByCol.values()) for (const list of m.values()) list.sort((a, b) => a - b);
    const dependents: number[][] = nodes.map(() => []);
    const indeg = new Array<number>(nodes.length).fill(0);
    // which formulas read each column: [first row, last row, formula] for each reference
    const readers = new Map<number, number[]>();
    nodes.forEach((n, i) => {
      const seen = new Set<number>();
      let refs = this.refsByText.get(n.text);
      if (!refs) {
        refs = formulaRefs(n.text);
        if (this.refsByText.size > 500000) this.refsByText.clear();
        this.refsByText.set(n.text, refs);
      }
      for (const ref of refs) {
        if (ref.broken) continue;
        const s = ref.sheet !== undefined ? this.sheetNamed(ref.sheet) : n.s;
        if (!s) continue;
        const si = sheetIndex.get(s)!;
        const b = ref.b ?? ref.a;
        const r1 = Math.min(ref.a.row, b.row), r2 = Math.max(ref.a.row, b.row);
        const c1 = Math.min(ref.a.col, b.col), c2 = Math.max(ref.a.col, b.col);
        for (let col = c1; col <= Math.min(c2, s.lastCol); col++) {
          const k = si * READER_COLS + col;
          let list = readers.get(k);
          if (!list) readers.set(k, (list = []));
          list.push(r1, r2, i);
        }
        const cols = formulaRowsByCol.get(s);
        if (!cols) continue;
        for (const [col, rows] of cols) {
          if (col < c1 || col > c2) continue;
          // the formula rows of this column inside the block
          let lo = 0, hi = rows.length;
          while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid] < r1) lo = mid + 1; else hi = mid; }
          for (let j = lo; j < rows.length && rows[j] <= r2; j++) {
            const dep = byId.get(gid(si, keyOf(rows[j], col)));
            if (dep === undefined || seen.has(dep)) continue;
            seen.add(dep);
            dependents[dep].push(i);
            indeg[i]++;
          }
        }
      }
    });
    // 3. work them out in that order; those left over are in a loop
    const queue: number[] = [];
    indeg.forEach((d, i) => { if (!d) queue.push(i); });
    const done = new Array<boolean>(nodes.length).fill(false);
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi];
      this.evaluateNode(nodes[i]);
      done[i] = true;
      for (const j of dependents[i]) if (--indeg[j] === 0) queue.push(j);
    }
    if (queue.length < nodes.length) {
      for (let i = 0; i < nodes.length; i++) if (!done[i]) nodes[i].s.values.set(nodes[i].key, ERR.circ());
    }
    const volatile: number[] = [];
    nodes.forEach((n, i) => { if (done[i] && VOLATILE.test(n.text)) volatile.push(i); });
    this.graph = {
      sheets: [...this.sheets], nodes, dependents, readers, loop: done.map((x) => !x), order: queue, volatile,
      bounds: this.sheets.map((s) => ({ lastRow: s.lastRow, lastCol: s.lastCol, lastData: s.lastDataRow })),
    };
    this.settleVolatile(this.graph);
  }

  /**
   * INDIRECT and OFFSET read cells their formula's text doesn't name, so they may have been
   * worked out before those cells were. Work them out again, with the formulas that read them, in
   * the same order, until nothing changes.
   */
  private settleVolatile(g: Graph): void {
    if (!g.volatile.length) return;
    const pos = new Map<number, number>();
    g.order.forEach((i, k) => pos.set(i, k));
    const todo = new Set<number>();
    const stack = [...g.volatile];
    while (stack.length) {
      const i = stack.pop()!;
      if (todo.has(i) || g.loop[i]) continue;
      todo.add(i);
      for (const j of g.dependents[i]) if (!todo.has(j)) stack.push(j);
    }
    const list = [...todo].sort((a, b) => pos.get(a)! - pos.get(b)!);
    for (let pass = 0; pass < VOLATILE_PASSES; pass++) {
      let changed = false;
      for (const i of list) {
        const n = g.nodes[i];
        const before = n.s.values.get(n.key);
        this.evaluateNode(n);
        const after = n.s.values.get(n.key);
        if (!(before === after || (isError(before) && isError(after) && before.code === after.code))) changed = true;
      }
      if (!changed) break;
    }
    for (const i of list) g.nodes[i].s.valuesGen++;
  }

  /**
   * Work out the values again after a change. When the change only typed or cleared plain
   * values (no formulas, structures or property columns) inside the area in use, only the
   * formulas that read them, and those that read those, are worked out again; anything else
   * works out the whole workbook, as recalc does.
   */
  private recalcAfter(changes: Change[], now: 'before' | 'after' = 'after'): void {
    if (!this.recalcChanged(changes, now)) this.recalc();
  }

  /** `now`: which side of each change is in place (undo puts back 'before'). */
  private recalcChanged(changes: Change[], now: 'before' | 'after'): boolean {
    const g = this.graph;
    if (!g || g.sheets.length !== this.sheets.length || g.sheets.some((s, i) => s !== this.sheets[i])) return false;
    const typed: { s: Sheet; si: number; key: number; cell: Cell | undefined }[] = [];
    for (const c of changes) {
      if (c.field !== 'cells') {
        // formatting, sizes, hidden rows, rules and charts change no value
        if (c.sheet && NO_VALUES.has(c.field)) continue;
        return false;
      }
      const before = c[now === 'after' ? 'before' : 'after'] as Cell | undefined, after = c[now] as Cell | undefined;
      if (before?.input === after?.input && before?.structure === after?.structure) continue;
      if (before?.structure || after?.structure || isFormulaText(before?.input) || isFormulaText(after?.input)) return false;
      const s = c.sheet!, si = this.sheets.indexOf(s);
      if (si < 0) return false;
      const r = rowOf(c.key), col = colOf(c.key), b = g.bounds[si];
      // a value typed into a property column takes the place of its formula
      const def = s.colDefs.get(col);
      if (def && r >= def.firstRow) return false;
      // the area in use (how far property columns and whole-column references reach) must stay as it was
      if (after?.input ? r > b.lastRow || col > b.lastCol || r > b.lastData : r >= b.lastRow || col >= b.lastCol || r >= b.lastData) return false;
      typed.push({ s, si, key: c.key, cell: after });
    }
    if (!typed.length) return true;
    // the formulas that read the changed cells
    const start = new Set<number>();
    for (const t of typed) {
      const list = g.readers.get(t.si * READER_COLS + colOf(t.key));
      if (!list) continue;
      const r = rowOf(t.key);
      for (let j = 0; j < list.length; j += 3) if (list[j] <= r && r <= list[j + 1]) start.add(list[j + 2]);
    }
    // formulas using INDIRECT or OFFSET might read any cell
    for (const i of g.volatile) start.add(i);
    // and those that read those, and so on
    const todo = new Set<number>();
    const stack = [...start];
    while (stack.length) {
      const i = stack.pop()!;
      if (todo.has(i) || g.loop[i]) continue;
      todo.add(i);
      for (const j of g.dependents[i]) if (!todo.has(j)) stack.push(j);
    }
    if (todo.size > g.nodes.length / 2) return false;
    this.identityCache.clear();
    for (const t of typed) {
      if (t.cell?.input) t.s.values.set(t.key, this.literal(t.cell));
      else t.s.values.delete(t.key);
    }
    // in order: each formula after those it reads (a loop stays an error, as in a full recalculation)
    const indeg = new Map<number, number>();
    for (const i of todo) indeg.set(i, 0);
    for (const i of todo) for (const j of g.dependents[i]) if (todo.has(j)) indeg.set(j, indeg.get(j)! + 1);
    const queue = [...todo].filter((i) => !indeg.get(i));
    let worked = 0;
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi];
      this.evaluateNode(g.nodes[i]);
      worked++;
      for (const j of g.dependents[i]) if (todo.has(j)) { const d = indeg.get(j)! - 1; indeg.set(j, d); if (!d) queue.push(j); }
    }
    if (worked < todo.size) for (const i of todo) if (indeg.get(i)) g.nodes[i].s.values.set(g.nodes[i].key, ERR.circ());
    for (const s of new Set(typed.map((t) => t.s))) s.valuesGen++;
    for (const i of todo) g.nodes[i].s.valuesGen++;
    this.settleVolatile(g);
    return true;
  }

  /** A formula written for cell `home`, worked out as if moved to (row, col) of a sheet (conditional formatting's formula rules). */
  formulaAt(s: Sheet, formula: string, home: { row: number; col: number }, row: number, col: number): Value {
    // read once, then moved as a tree for each cell
    const tree = this.parse(formula.startsWith('=') ? formula : '=' + formula);
    try {
      return tree instanceof CellError ? tree : evaluate(shiftTree(tree, row - home.row, col - home.col), this.hostFor(s));
    } catch (e) {
      return ERR.value(`This formula could not be worked out (${(e as Error).message})`);
    }
  }

  /** What data validation needs to work out its limits and lists on a sheet. */
  validationHost(s: Sheet): ValidationHost {
    return {
      formulaAt: (f, home, row, col) => this.formulaAt(s, f, home, row, col),
      sheetNamed: (name) => this.sheetNamed(name),
    };
  }

  private evaluateNode(n: { s: Sheet; key: number; text: string }): void {
    const tree = this.parse(n.text);
    let v: Value | CellError;
    try {
      v = tree instanceof CellError ? tree : evaluate(tree, this.hostFor(n.s));
    } catch (e) {
      // one formula that fails outright shows an error in its cell rather than stopping every other
      v = ERR.value(`This formula could not be worked out (${(e as Error).message})`);
    }
    n.s.values.set(n.key, v === null ? 0 : v);
  }

  private hosts = new WeakMap<Sheet, EvalHost>();
  /** Which molecule each cell of a block holds, kept while the sheets are worked out (DUPLICATE asks once per row). */
  private identityCache = new Map<string, (string | CellError | null)[][]>();

  private hostFor(home: Sheet): EvalHost {
    let h = this.hosts.get(home);
    if (h) return h;
    const sheetOf = (name: string | undefined) => (name === undefined ? home : this.sheetNamed(name));
    h = {
      value: (sheet, row, col) => sheetOf(sheet)?.values.get(keyOf(row, col)) ?? null,
      block: (sheet, r) => {
        const s = sheetOf(sheet);
        if (!s) return [[ERR.ref()]];
        const r2 = Math.min(r.r2, s.lastRow), c2 = Math.min(r.c2, s.lastCol);
        const out: Value[][] = [];
        for (let row = r.r1; row <= r2; row++) {
          const line: Value[] = [];
          for (let col = r.c1; col <= c2; col++) line.push(s.values.get(keyOf(row, col)) ?? null);
          out.push(line);
        }
        return out.length ? out : [[null]];
      },
      hasSheet: (name) => !!this.sheetNamed(name),
      molecule: (src) => {
        if (!this.chem) return ERR.busy();
        if ('smiles' in src) return src.smiles.trim() ? this.chem.smiles(src.smiles.trim()) : null;
        const s = sheetOf(src.sheet);
        if (!s) return ERR.ref();
        const c = s.cell(src.row, src.col);
        if (c?.structure) return this.chem.structure(c.structure);
        const v = s.values.get(keyOf(src.row, src.col)) ?? null;
        if (v === null || v === '') return null;
        if (isError(v)) return v;
        if (typeof v !== 'string') return ERR.value('A number where a structure or SMILES was wanted');
        return this.chem.smiles(v.trim());
      },
      identities: (sheet, r) => {
        const s = sheetOf(sheet);
        if (!s) return [[ERR.ref()]];
        const r2 = Math.min(r.r2, s.lastRow), c2 = Math.min(r.c2, s.lastCol);
        const key = `${s.name}|${r.r1}|${r.c1}|${r2}|${c2}`;
        const got = this.identityCache.get(key);
        if (got) return got;
        const out: (string | CellError | null)[][] = [];
        for (let row = r.r1; row <= r2; row++) {
          const line: (string | CellError | null)[] = [];
          for (let col = r.c1; col <= c2; col++) {
            // a structure, or text that reads as SMILES (a heading doesn't, and counts as none)
            const m = h!.molecule({ sheet: s.name, row, col });
            line.push(m === null ? null : isError(m) ? (m.code === '#BUSY!' ? m : null) : m.inchikey || m.smiles);
          }
          out.push(line);
        }
        this.identityCache.set(key, out);
        return out;
      },
    };
    this.hosts.set(home, h);
    return h;
  }
}

/** The next name in a series: "S1" → "S2", "2a" → "2b", "Entry 9" → "Entry 10", n steps on. Other text is copied. */
/** The count at the end of a text (S12 → 12, 2b → 1), and what comes before it. */
function textCount(text: string): { head: string; n: number } | null {
  const num = /^(.*?)(\d+)$/.exec(text);
  if (num) return { head: num[1] + '#', n: Number(num[2]) };
  const letter = /^(.*\d)([a-z])$/i.exec(text);
  if (letter) return { head: letter[1] + (letter[2] === letter[2].toLowerCase() ? 'a' : 'A'), n: letter[2].toLowerCase().charCodeAt(0) - 97 };
  return null;
}

/** The step of texts that count on evenly with the same start (S1, S2, S3 → 1; 2a, 2c → 2), or null. */
export function textSeriesStep(inputs: (string | undefined)[]): number | null {
  const counts = inputs.map((t) => (t ? textCount(t) : null));
  if (counts.some((c) => !c || c.head !== counts[0]!.head)) return null;
  const step = counts[1]!.n - counts[0]!.n;
  return counts.every((c, i) => c!.n === counts[0]!.n + step * i) ? step : null;
}

export function countOn(text: string, steps: number): string {
  if (!steps) return text;
  const num = /^(.*?)(\d+)$/.exec(text);
  if (num) {
    const n = Number(num[2]) + steps;
    if (n < 0) return text;
    return num[1] + String(n).padStart(num[2].length, '0');
  }
  // a compound number with a letter: 2a, 2b … 2z
  const letter = /^(.*\d)([a-z])$/i.exec(text);
  if (letter) {
    const base = letter[2] === letter[2].toLowerCase() ? 97 : 65;
    const i = letter[2].charCodeAt(0) - base + steps;
    if (i < 0 || i > 25) return text;
    return letter[1] + String.fromCharCode(base + i);
  }
  return text;
}

/** The selection grown to take in whole merged blocks it touches. */
export function growToMerges(sheet: Sheet, r: Range): Range {
  let out = normRange(r);
  for (let changed = true; changed; ) {
    changed = false;
    for (const m of sheet.merges) {
      if (rangesOverlap(m, out) && !(m.r1 >= out.r1 && m.r2 <= out.r2 && m.c1 >= out.c1 && m.c2 <= out.c2)) {
        out = { r1: Math.min(out.r1, m.r1), c1: Math.min(out.c1, m.c1), r2: Math.max(out.r2, m.r2), c2: Math.max(out.c2, m.c2) };
        changed = true;
      }
    }
  }
  return out;
}
