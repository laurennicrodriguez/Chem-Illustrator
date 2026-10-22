// Sheet mode: the grid with Excel's ribbon, formula bar and keys, plus chemistry. A structure
// can be drawn or pasted into any cell; property columns work out formula, MW, HRMS m/z and the
// rest from the structures beside them; tables sort and filter by any column, by a property or
// by a part of a structure drawn as a query. The panel on the right shows what the selected
// cell holds and how its value was worked out.

import { paletteRows } from './palette-ui';
import { SheetView, popupMenu, selectionName } from './sheet-view';
import { Workbook, Sheet, Structure, CellStyle, CellBlock, Cell, Condition, CompareOp, makeStructure, growToMerges } from '../sheet/workbook';
import { Range, MAX_ROWS, MAX_COLS, colName, colIndex, cellName, parseRange, parseCellRef, keyOf, rowOf, colOf, inRange } from '../sheet/refs';
import { showsChem, chemPieces } from '../sheet/cell-text';
import { fillReagentTable } from '../sheet/reagents';
import { shiftFormula } from '../sheet/formula';
import { PROPERTIES, MolProps, propertyValue } from '../sheet/properties';
import { FORMATS, changeDecimals, describeFormat } from '../sheet/numfmt';
import { UNITS, unitFormat } from '../sheet/units';
import { isError, CellError, Value } from '../sheet/values';
import { FUNCTION_NAMES } from '../sheet/evaluate';
import { ISOTOPE_FUNCTIONS, listedPeaks, readsAsFormula, type IsotopeSource } from '../sheet/isotopes';
import { isotopeTable, ISOTOPE_CHARTS, type IsotopeChartKind } from '../sheet/isotope-table';
import { COMMON_ADDUCTS } from '../chem/hrms';
import { parseDelimited, toDelimited } from '../sheet/csv';
import { SheetChem } from '../sheet/sheet-chem';
import { isBlankDrawing } from '../sheet/structure-doc';
import { StructurePictures } from './structure-pictures';
import { askProperties, PropertyChoice } from './property-dialog';
import { ask } from './ask';
import { SheetFormatting } from './sheet-format-ui';
import { SheetCharts } from './sheet-chart-ui';
import { DASH_CHART_KINDS } from './dashboard-ui';
import { SheetNotes } from './sheet-notes-ui';
import { SheetValidation } from './sheet-validation-ui';
import { askLink, followLink, type LinkPlace } from './links-ui';
import { LINK_COLOUR, cellLink, cellOfLink, describeLink } from '../links';
import { describeValidation, KIND_NAMES } from '../sheet/validation';
import type { ChartKind } from '../sheet/chart';
import { DashboardUi } from './dashboard-ui';
import { printSheet, previewPages, PrintedSheet } from './sheet-print';
import { SheetObjects } from './sheet-objects-ui';
import { SheetPage } from './sheet-page-ui';
import { TILE_NAMES } from '../sheet/dashboard';
import type { TableDef } from '../sheet/table-styles';
import type { Contents } from '../model';
import type { DocStyle } from '../style';
import type { Tab } from '../workspace';

/** What a paste found on the clipboard, as far as a sheet cares. */
export interface ClipboardCells {
  /** Cells copied in this app (as JSON). */
  own?: string;
  /** A drawing (from ChemDraw or a drawing here). */
  drawing?: Contents;
  /** Plain text (tab-separated from Excel). */
  text?: string;
  picture?: boolean;
}

export interface SheetModeHost {
  flash(msg: string, ms?: number): void;
  /** Open the drawing tools on a structure (null to draw a new one). `done` gets the drawing, or null when cancelled. */
  editStructure(contents: Contents | null, title: string, done: (c: Contents | null) => void): void;
  /** A key the sheet doesn't use itself (menu commands, hotkeys). True when it did something. */
  key(e: KeyboardEvent): boolean;
  /** The workbook changed (for the unsaved mark on the tab). */
  changed(): void;
  /** A name or SMILES as a drawing in this style. */
  toStructure(text: string, style: DocStyle): Promise<{ contents: Contents; notes: string[] } | { error: string }>;
  /** Put cells on the clipboard: our own copy, tab-separated text and an HTML table. */
  writeCells(own: string, text: string, html: string): Promise<void>;
  /** Put one structure on the clipboard as a drawing (for ChemDraw, Word and PowerPoint). */
  copyStructure(contents: Contents, style: DocStyle): Promise<string>;
  /** Read the clipboard for a paste (from the paste event in a browser). */
  readCells(e: ClipboardEvent | null): Promise<ClipboardCells>;
  /** Ask for the name put on notes and comments (true when one was given). */
  askName(): Promise<boolean>;
  /** Ask for a picture file (Insert > Pictures). */
  pickPicture?(): Promise<{ bytes: Uint8Array; mime: string; name: string } | null>;
  /** File > Print, for the Print button in Print Preview. */
  print?(): void;
}

const OWN_KIND = 'chem-illustrator-cells';

/** Standard text and fill colours (Office's theme row and standard colours, close enough for science). */
const COLOURS = ['#000000', '#7f7f7f', '#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0',
  '#ffffff', '#d9d9d9', '#f2dcdb', '#fde9d9', '#fff2cc', '#ffffcc', '#ebf1de', '#e2efda', '#ddebf7', '#dce6f1', '#d9e1f2', '#e4dfec'];

export class SheetMode {
  readonly view: SheetView;
  readonly chem: SheetChem;
  readonly pictures: StructurePictures;
  tab: Tab | null = null;
  private nameBox: HTMLInputElement;
  private bar: HTMLTextAreaElement;
  private panel: HTMLElement;
  private panelTitle: HTMLElement;
  private ribbon: HTMLElement;
  private panelQueued = false;
  /** Conditional formatting and tables. */
  readonly formatting: SheetFormatting;
  /** Charts on the sheets. */
  readonly charts: SheetCharts;
  /** Dashboard sheets: adding tiles, their menus and settings. */
  readonly dashUi: DashboardUi;
  /** Notes and comments on cells. */
  readonly notes: SheetNotes;
  /** Data validation: the window, drop-downs and alerts. */
  readonly validation: SheetValidation;
  /** Pictures, shapes and text boxes over the cells. */
  readonly objects: SheetObjects;
  /** The Page Layout tab: page setup, print area, breaks, headers and footers. */
  readonly page: SheetPage;
  /** The chart the panel and Chart tab showed last (the tab opens when a chart is first picked). */
  private chartShown: number | null = null;
  /** The dashboard sheet the ribbon was last set up for. */
  private dashShown: Sheet | null = null;
  /** The last cells copied here: pasting the same text back uses these (formulas, structures and formats kept). */
  private clip: { text: string; block: CellBlock; sheet: Sheet; range: Range; cut: boolean } | null = null;

  constructor(private host: SheetModeHost, chem: SheetChem) {
    this.chem = chem;
    this.pictures = new StructurePictures(() => this.book?.drawingStyle ?? ({} as DocStyle));
    const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
    this.nameBox = $('#sh-name');
    this.bar = $('#sh-formula');
    this.panel = $('#cell-body');
    this.panelTitle = $('#cell-name');
    this.ribbon = $('#sheet-ribbon');
    this.view = new SheetView($('#sheet-host'), {
      structureBox: (s) => this.pictures.box(s),
      structureBitmap: (s, scale) => this.pictures.bitmap(s, Math.abs(scale), scale < 0),
      editStructure: (r, c) => this.drawStructure(r, c),
      key: (e) => this.host.key(e),
      changed: () => this.selectionChanged(),
      contextMenu: (x, y, where) => (where === 'chart' ? this.charts.contextMenu(x, y) : where === 'tile' ? this.dashUi.contextMenu(x, y) : where === 'object' ? this.objects.contextMenu(x, y) : this.contextMenu(x, y, where)),
      editObject: (id) => {
        const o = this.view.sheet?.objects.find((x) => x.id === id);
        if (o?.kind === 'picture' || o?.shape === 'line' || o?.shape === 'arrow') void this.objects.format(o);
        else this.objects.editText(id);
      },
      typeInObject: (id, key) => { const o = this.view.sheet?.objects.find((x) => x.id === id); return !!o && this.objects.typeInto(o, key); },
      editChart: () => { this.showRibbonTab('chart'); this.renderPanel(); this.charts.focusPanel(); },
      openTile: (t) => {
        if (t.kind === 'chart') { this.dashUi.bindChart(t.id); this.showRibbonTab('chart'); }
        this.renderPanel();
        this.dashUi.focusPanel();
      },
      filterMenu: (col, at) => this.filterMenu(col, at),
      flash: (m, ms) => this.host.flash(m, ms),
      typing: (text) => this.typing(text),
      hoverNote: (cell, box) => this.notes.hover(cell, box),
      drawn: () => this.notes.layout(),
      dropDown: (r, c, at) => this.validation.dropDown(r, c, at),
      invalid: (rule, text) => this.validation.alert(rule, text),
      typed: (r, c, text) => void this.typedStructure(r, c, text),
    });
    chem.onAnswers = () => {
      const wb = this.book;
      if (!wb) return;
      wb.recalc();
      this.view.refresh();
      this.schedulePanel();
    };
    this.formatting = new SheetFormatting({
      view: this.view,
      edit: (label, fn) => this.edit(label, fn),
      flash: (m, ms) => this.host.flash(m, ms),
    });
    this.charts = new SheetCharts({
      view: this.view,
      edit: (label, fn) => this.edit(label, fn),
      flash: (m, ms) => this.host.flash(m, ms),
    });
    this.notes = new SheetNotes({
      view: this.view,
      edit: (label, fn) => this.edit(label, fn),
      flash: (m, ms) => this.host.flash(m, ms),
      askName: () => this.host.askName(),
    });
    this.validation = new SheetValidation({
      view: this.view,
      edit: (label, fn) => this.edit(label, fn),
      flash: (m, ms) => this.host.flash(m, ms),
    });
    this.objects = new SheetObjects({
      view: this.view,
      edit: (label, fn) => this.edit(label, fn),
      flash: (m, ms) => this.host.flash(m, ms),
      pickPicture: () => this.host.pickPicture?.() ?? Promise.resolve(null),
    });
    this.page = new SheetPage({
      view: this.view,
      edit: (label, fn) => this.edit(label, fn),
      flash: (m, ms) => this.host.flash(m, ms),
    });
    this.dashUi = new DashboardUi({ view: this.view, charts: this.charts, flash: (m, ms) => this.host.flash(m, ms) });
    this.wireFormulaBar();
    this.wireRibbon();
  }

  get book(): Workbook | null {
    return this.tab?.book ?? null;
  }

  // ---------------------------------------------------------------- showing a tab

  /** A sheet tab came to the front (or null: another kind of tab). */
  show(tab: Tab | null): void {
    if (this.tab && this.tab !== tab) this.leave();
    this.tab = tab;
    const wb = tab?.book ?? null;
    if (wb) {
      wb.chem = this.chem;
      wb.onChange = () => {
        this.view.refresh();
        this.host.changed();
        this.schedulePanel();
      };
      wb.recalc();
    }
    this.view.show(wb, (tab?.sheetState as ReturnType<SheetView['state']>) ?? null);
    if (wb) {
      this.selectionChanged();
      requestAnimationFrame(() => this.view.focus());
    }
  }

  /** The workbook's drawing style changed: draw its structures again. */
  styleChanged(): void {
    this.pictures.clear();
    this.view.refresh();
  }

  /** Before another tab shows: finish typing and keep the selection and scroll. */
  leave(): void {
    const t = this.tab;
    if (!t?.book) return;
    this.view.commitEdit();
    t.sheetState = this.view.state();
    t.book.onChange = () => {};
  }

  focus(): void {
    this.view.focus();
  }

  // ---------------------------------------------------------------- formula bar and name box

  private wireFormulaBar(): void {
    const bar = this.bar;
    bar.addEventListener('focus', () => {
      const s = this.view.sheet;
      if (!s) return;
      const { r, c } = this.view.sel.active;
      if (s.cell(r, c)?.structure) { bar.blur(); this.host.flash('This cell holds a structure: double-click it to change the drawing.'); return; }
      this.view.beginFromBar();
    });
    bar.addEventListener('input', () => { this.view.setTyping(bar.value); this.fitBar(); });
    bar.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && e.altKey) {
        e.preventDefault();
        const p = bar.selectionStart ?? bar.value.length;
        bar.value = bar.value.slice(0, p) + '\n' + bar.value.slice(bar.selectionEnd ?? p);
        bar.setSelectionRange(p + 1, p + 1);
        this.view.setTyping(bar.value);
        this.fitBar();
        return;
      }
      if (e.key === 'Enter') { e.preventDefault(); this.view.commitEdit(e.ctrlKey ? 0 : e.shiftKey ? -1 : 1, 0, e.ctrlKey || e.metaKey); return; }
      if (e.key === 'Tab') { e.preventDefault(); this.view.commitEdit(0, e.shiftKey ? -1 : 1); return; }
      if (e.key === 'Escape') { e.preventDefault(); this.view.cancelEdit(); this.showActive(); this.view.focus(); }
    });
    const nb = this.nameBox;
    nb.addEventListener('focus', () => nb.select());
    nb.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.showActive(); this.view.focus(); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      this.goTo(nb.value.trim());
    });
    document.querySelector('#sh-fx')!.addEventListener('click', (e) => this.functionMenu(e as MouseEvent));
  }

  /** The name box: go to a cell, a block or a sheet ("B5", "A1:C9", "Sheet2!A1", "Sheet2"). */
  private goTo(text: string): void {
    const wb = this.book;
    if (!wb || !text) return;
    const m = /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(text);
    let sheetName = m ? (m[1] ?? m[2]).replace(/''/g, "'") : null;
    let ref = m ? m[3] : text;
    if (!m && wb.sheetNamed(text)) { sheetName = text; ref = 'A1'; }
    if (sheetName !== null) {
      const i = wb.sheets.findIndex((s) => s.name.toLowerCase() === sheetName!.toLowerCase());
      if (i < 0) { this.host.flash(`There is no sheet called "${sheetName}".`); return; }
      this.view.goSheet(i);
    }
    const r = parseRange(ref.toUpperCase());
    if (!r) { this.host.flash(`"${text}" isn't a cell or a block of cells (for example B5 or A1:C9).`); this.showActive(); return; }
    this.view.select(r, { r: r.r1, c: r.c1 });
    this.view.focus();
  }

  private fitBar(): void {
    const bar = this.bar;
    bar.style.height = 'auto';
    bar.style.height = `${Math.min(bar.scrollHeight, 96)}px`;
  }

  /** Typing in the cell changed (null: it ended). */
  private typing(text: string | null): void {
    if (text === null) { this.showActive(); return; }
    if (document.activeElement !== this.bar) {
      this.bar.value = text;
      this.fitBar();
    }
  }

  /** The name box and formula bar show the active cell. */
  private showActive(): void {
    const s = this.view.sheet;
    if (!s) { this.nameBox.value = ''; this.bar.value = ''; return; }
    const sel = this.view.sel;
    this.nameBox.value = sel.range.r1 === sel.range.r2 && sel.range.c1 === sel.range.c2 ? cellName(sel.active.r, sel.active.c) : selectionName(sel.range);
    const { r, c } = sel.active;
    const cell = s.cell(r, c);
    if (cell?.structure) {
      const v = s.values.get(keyOf(r, c));
      this.bar.value = typeof v === 'string' && v ? v : '';
      this.bar.placeholder = 'A drawn structure (its SMILES shows here)';
      this.bar.readOnly = true;
    } else {
      this.bar.value = s.effectiveInput(r, c) ?? '';
      this.bar.placeholder = '';
      this.bar.readOnly = false;
    }
    this.fitBar();
  }

  /** fx: a list of the functions, chemistry first; picking one starts it in the cell. */
  private functionMenu(e: MouseEvent): void {
    const chemNames = Object.keys(PROPERTIES);
    const isoNames = Object.keys(ISOTOPE_FUNCTIONS);
    const rest = FUNCTION_NAMES.filter((n) => !chemNames.includes(n) && !isoNames.includes(n));
    const put = (name: string) => {
      const s = this.view.sheet;
      if (!s) return;
      if (this.view.editing) {
        const inp = this.view.input;
        const p = inp.selectionStart ?? inp.value.length;
        inp.value = inp.value.slice(0, p) + `${name}(` + inp.value.slice(p);
        this.view.setTyping(inp.value);
        inp.focus();
        inp.setSelectionRange(p + name.length + 1, p + name.length + 1);
      } else this.view.editCell(`=${name}(`);
    };
    const items: ([string, () => void] | null)[] = [
      ...chemNames.map((n) => [`${n} — ${PROPERTIES[n].label}`, () => put(n)] as [string, () => void]),
      ...isoNames.map((n) => [`${n} — ${ISOTOPE_FUNCTIONS[n].label}`, () => put(n)] as [string, () => void]),
      null,
      ...rest.map((n) => [n, () => put(n)] as [string, () => void]),
    ];
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const m = popupMenu(b.left, b.bottom + 2, items);
    m.classList.add('fx-menu');
  }

  // ---------------------------------------------------------------- the ribbon

  private wireRibbon(): void {
    const rb = this.ribbon;
    rb.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-sh]');
      if (!btn) return;
      this.ribbonCommand(btn.dataset.sh!, btn);
    });
    // units for reaction conditions, before "Other…"
    const numfmt = rb.querySelector<HTMLSelectElement>('#sh-numfmt')!;
    const units = document.createElement('optgroup');
    units.label = 'Units';
    for (const u of UNITS) units.append(new Option(`${u.name} (${u.unit})`, unitFormat(u)));
    numfmt.insertBefore(units, numfmt.querySelector('option[value=custom]'));
    numfmt.addEventListener('change', (e) => {
      const sel = e.target as HTMLSelectElement;
      const v = sel.value;
      if (v === 'custom') { this.focusFormat(); return; }
      this.style('Number format', { numFmt: v === 'General' ? undefined : v });
      sel.blur();
      this.view.focus();
    });
    rb.querySelector<HTMLSelectElement>('#sh-size')!.addEventListener('change', (e) => {
      const sel = e.target as HTMLSelectElement;
      const n = Number(sel.value);
      this.style('Font size', { size: n === 11 ? undefined : n });
      sel.blur();
      this.view.focus();
    });
    // the ribbon's buttons keep the grid's focus, so keys go on working
    rb.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) e.preventDefault();
    });
    // ribbon tabs
    for (const b of rb.querySelectorAll<HTMLButtonElement>('[data-sh-tab]')) b.addEventListener('click', () => this.showRibbonTab(b.dataset.shTab!));
    // Table Design
    const table = () => this.tableHere();
    for (const box of rb.querySelectorAll<HTMLInputElement>('[data-table-opt]')) {
      box.addEventListener('change', () => {
        const t = table();
        if (!t) return;
        const opt = box.dataset.tableOpt as keyof TableDef;
        if (opt === 'totals') this.formatting.toggleTotals(t);
        else if (opt === 'header' && !box.checked) { box.checked = true; this.host.flash('A table keeps its header row here (Excel needs one to save it as a table). Use Convert to Range for plain cells.'); }
        else this.formatting.setTable(t, { [opt]: box.checked || undefined } as Partial<TableDef>, 'Table options');
        this.view.focus();
      });
    }
    const name = rb.querySelector<HTMLInputElement>('#sh-table-name')!;
    name.addEventListener('change', () => {
      const t = table();
      const v = name.value.trim().replace(/\s+/g, '_');
      if (!t || !v) return;
      if (!/^[A-Za-z_\\][A-Za-z0-9_.]*$/.test(v)) { this.host.flash('A table name starts with a letter and has no spaces (Excel\'s rule).'); name.value = t.name; return; }
      this.formatting.setTable(t, { name: v }, 'Rename table');
    });
    for (const [id, key] of [['#sh-table-header', 'header'], ['#sh-table-band', 'band']] as const) {
      rb.querySelector<HTMLInputElement>(id)!.addEventListener('change', (e) => {
        const t = table();
        if (!t) return;
        this.formatting.setTable(t, { custom: { ...t.custom, [key]: (e.target as HTMLInputElement).value } }, 'Table colours');
      });
    }
  }

  /** Show one of the ribbon's tabs. */
  private showRibbonTab(name: string): void {
    for (const x of this.ribbon.querySelectorAll<HTMLButtonElement>('[data-sh-tab]')) x.setAttribute('aria-selected', String(x.dataset.shTab === name));
    for (const p of this.ribbon.querySelectorAll<HTMLElement>('[data-sh-panel]')) p.hidden = p.dataset.shPanel !== name;
  }

  /** The table the active cell is in. */
  private tableHere(): TableDef | undefined {
    const s = this.view.sheet;
    return s?.tableAt(this.view.sel.active.r, this.view.sel.active.c);
  }

  private ribbonCommand(name: string, btn: HTMLElement): void {
    const b = btn.getBoundingClientRect();
    switch (name) {
      case 'text-colour': this.colourMenu(b.left, b.bottom + 2, 'color'); return;
      case 'fill-colour': this.colourMenu(b.left, b.bottom + 2, 'fill'); return;
      case 'borders': this.bordersMenu(b.left, b.bottom + 2); return;
      case 'insert': this.insertMenu(b.left, b.bottom + 2); return;
      case 'delete': this.deleteMenu(b.left, b.bottom + 2); return;
      case 'conditional-formatting': this.formatting.conditionalMenu(b.left, b.bottom + 2); return;
      case 'format-as-table': this.formatting.tableMenu(b.left, b.bottom + 2); return;
      case 'chart-type': this.charts.typeMenu(b.left, b.bottom + 2); return;
      case 'insert-shapes': this.objects.shapesMenu(b.left, b.bottom + 2); return;
      case 'page-margins': this.page.marginsMenu(b.left, b.bottom + 2); return;
      case 'page-orientation': this.page.orientationMenu(b.left, b.bottom + 2); return;
      case 'page-size': this.page.sizeMenu(b.left, b.bottom + 2); return;
      case 'print-area': this.page.printAreaMenu(b.left, b.bottom + 2); return;
      case 'page-breaks': this.page.breaksMenu(b.left, b.bottom + 2); return;
      case 'fit-wide': this.page.fitMenu(b.left, b.bottom + 2, 'wide'); return;
      case 'fit-tall': this.page.fitMenu(b.left, b.bottom + 2, 'tall'); return;
      case 'chart-fit': this.charts.fitMenu(b.left, b.bottom + 2); return;
      case 'chart-legend': this.charts.legendMenu(b.left, b.bottom + 2); return;
      case 'chart-palette': this.charts.paletteMenu(b.left, b.bottom + 2); return;
      case 'chart-errors': this.charts.errorsMenu(b.left, b.bottom + 2); return;
      case 'table-style': {
        const t = this.tableHere();
        if (t) this.formatting.tableMenu(b.left, b.bottom + 2, (style) => this.formatting.setTable(t, { style }, 'Table style'));
        return;
      }
    }
    this.run(name);
  }

  /** Sheet commands (from the ribbon, the menus and keys). False when the name isn't one. */
  run(name: string): boolean {
    const v = this.view;
    if (!this.book || !v.sheet) return false;
    const a = v.sheet.styleAt(v.sel.active.r, v.sel.active.c) ?? {};
    switch (name) {
      case 'cell-bold': this.style('Bold', { bold: !a.bold || undefined }); break;
      case 'cell-italic': this.style('Italic', { italic: !a.italic || undefined }); break;
      case 'cell-underline': this.style('Underline', { underline: !a.underline || undefined }); break;
      case 'align-left': case 'align-center': case 'align-right': {
        const al = name.slice(6) as 'left' | 'center' | 'right';
        this.style('Align', { align: a.align === al ? undefined : al });
        break;
      }
      case 'valign-top': case 'valign-middle': case 'valign-bottom': {
        const al = name.slice(7) as 'top' | 'middle' | 'bottom';
        this.style('Align', { valign: al === 'bottom' ? undefined : al });
        break;
      }
      case 'wrap': this.style('Wrap text', { wrap: !a.wrap || undefined }); break;
      // on (as text is anyway, where it has formulas) or off for these cells
      case 'format-chem': this.style('Formula style', { chem: this.chemShown() ? false : true }); break;
      case 'merge-cells': this.mergeCells(); break;
      case 'format-general': this.style('Number format', { numFmt: undefined }); break;
      case 'format-number': this.style('Number format', { numFmt: FORMATS.number }); break;
      case 'format-percent': this.style('Number format', { numFmt: FORMATS.percent }); break;
      case 'format-scientific': this.style('Number format', { numFmt: FORMATS.scientific }); break;
      case 'decimals-more': case 'decimals-less': this.decimals(name === 'decimals-more' ? 1 : -1); break;
      case 'format-cells': this.focusFormat(); break;
      case 'fill-down': this.fillDown(); break;
      case 'fill-right': this.fillRight(); break;
      case 'autosum': this.autoSum(); break;
      case 'find': v.openFind(); break;
      case 'insert-cells': this.insertCells(); break;
      case 'delete-cells': this.deleteCells(); break;
      case 'hide-rows': this.hide('row', true); break;
      case 'unhide-rows': this.hide('row', false); break;
      case 'hide-cols': this.hide('col', true); break;
      case 'unhide-cols': this.hide('col', false); break;
      case 'insert-sheet': v.addSheet(); break;
      case 'sort-up': case 'sort-down': void this.sort(name === 'sort-down'); break;
      case 'filter': this.toggleFilter(); break;
      case 'filter-structure': this.filterByStructure(v.sel.active.c); break;
      case 'freeze-header': this.freezeHeader(); break;
      case 'property-column': void this.propertyColumns(); break;
      case 'isotope-pattern': void this.isotopePattern(); break;
      case 'reagent-table': this.reagentTable(); break;
      case 'structure-from-name': void this.structureFromName(); break;
      case 'draw-structure': this.drawStructure(v.sel.active.r, v.sel.active.c); break;
      case 'reset-calculated': this.resetCalculated(); break;
      case 'manage-rules': this.formatting.manage(); break;
      case 'new-rule': void this.formatting.ruleDialog(null); break;
      case 'insert-table': if (v.sheet.dashboard) void this.dashUi.addTile('table'); else void this.formatting.formatAsTable(this.tableHere()?.style ?? 'TableStyleMedium2'); break;
      case 'table-convert': { const t = this.tableHere(); if (t) this.formatting.convertToRange(t); break; }
      case 'table-colours-reset': { const t = this.tableHere(); if (t) this.formatting.setTable(t, { custom: undefined }, 'Table colours'); break; }
      case 'chart-scatter': case 'chart-line': case 'chart-column': case 'chart-bar': case 'chart-area': case 'chart-pie':
      case 'chart-combo': case 'chart-histogram': case 'chart-box': case 'chart-bubble': case 'chart-radar':
        if (v.sheet.dashboard) {
          if (DASH_CHART_KINDS.includes(name.slice(6) as ChartKind)) void this.dashUi.addTile('chart', name.slice(6) as ChartKind);
          else this.host.flash('Dashboard tiles take scatter, line, column, bar, area and pie charts: make this one on a sheet.', 5000);
        } else this.charts.insert(name.slice(6) as ChartKind);
        break;
      case 'dash-add-chart': void this.dashUi.addTile('chart'); break;
      case 'dash-add-kpi': void this.dashUi.addTile('kpi'); break;
      case 'dash-add-table': void this.dashUi.addTile('table'); break;
      case 'dash-add-slicer': void this.dashUi.addTile('slicer'); break;
      case 'dash-add-gallery': void this.dashUi.addTile('gallery'); break;
      case 'dash-add-text': void this.dashUi.addTile('text'); break;
      case 'dash-clear-filters': this.dashUi.clearFilters(); break;
      case 'dash-settings': v.dash.pick(null); this.renderPanel(); this.dashUi.focusPanel(); break;
      case 'insert-dashboard': v.addDashboard(); break;
      case 'chart-add-series': void this.charts.addSeries(); break;
      case 'chart-edit': this.charts.focusPanel(); break;
      case 'chart-titles': void this.charts.titles(); break;
      case 'chart-axes': void this.charts.axes(); break;
      case 'chart-labels': this.charts.toggleLabels(); break;
      case 'chart-copy': void this.charts.copyPicture(); break;
      case 'chart-save': void this.charts.savePicture(); break;
      case 'chart-delete': this.charts.deleteChart(); break;
      case 'copy': if (this.charts.chart) void this.charts.copyPicture(); else if (v.selectedObject) this.host.flash('Use Duplicate on the right-click menu to copy a picture or shape.'); else void this.copy(); break;
      case 'cut': void this.copy(true); break;
      case 'paste': void this.paste(null); break;
      case 'clear-contents': v.clearSelection(); break;
      case 'clear-all': this.edit('Clear', (s) => s.clear(v.sel.range, 'all')); break;
      case 'clear-formats': this.edit('Clear formats', (s) => s.clear(v.sel.range, 'formats')); break;
      case 'new-note': void this.notes.newNote(); break;
      case 'new-comment': void this.notes.newComment(); break;
      case 'edit-note': this.notes.edit(); break;
      case 'delete-note': case 'delete-comment': this.notes.remove(); break;
      case 'insert-link': void this.editLink(); break;
      case 'remove-link': this.removeLinks(); break;
      case 'open-link': { const l = v.linkOf(v.sel.active.r, v.sel.active.c); if (l) void followLink(l); else this.host.flash('The cell has no link.'); break; }
      case 'show-note': this.notes.toggleShown(); break;
      case 'show-all-notes': this.notes.toggleShowAll(); this.showRibbonState(); break;
      case 'convert-notes': this.notes.convertNotes(); break;
      case 'prev-comment': case 'next-comment': this.notes.step(name === 'next-comment'); break;
      case 'data-validation': this.validation.dialog(); break;
      case 'circle-invalid': this.validation.toggleCircles(); this.showRibbonState(); break;
      case 'pick-from-list': v.openDropDown(); break;
      case 'insert-picture-sheet': void this.objects.insertPicture(); break;
      case 'insert-text-box': this.objects.insertTextBox(); break;
      case 'format-object': void this.objects.format(); break;
      case 'print-titles': void this.page.printTitles(); break;
      case 'page-setup': void this.page.pageSetupWindow(); break;
      case 'header-footer': void this.page.headerFooter(); break;
      case 'page-scale': void this.page.scaleWindow(); break;
      case 'print-gridlines': this.page.toggle('gridlines'); break;
      case 'print-headings': this.page.toggle('headings'); break;
      case 'show-page-breaks': v.showPageBreaks = !v.showPageBreaks; v.refresh(); this.showRibbonState(); break;
      case 'insert-page-break': this.page.insertBreak(); break;
      case 'set-print-area': this.page.setPrintArea(false); break;
      case 'clear-print-area': this.page.set('Clear print area', { printArea: undefined }); break;
      case 'print-preview': this.printPreview(); break;
      default: return false;
    }
    return true;
  }

  /** Change the look of the selected cells. */
  private style(label: string, patch: Partial<CellStyle>): void {
    const v = this.view;
    this.edit(label, (s) => s.patchStyle(growToMerges(s, v.sel.range), patch));
  }

  // ---------------------------------------------------------------- links

  /** Insert > Link (Ctrl+K): link the selected cells to a web page, DOI, file, e-mail address or cell. */
  private async editLink(): Promise<void> {
    const v = this.view, wb = this.book, s = v.sheet;
    if (!wb || !s) return;
    v.commitEdit();
    const { r, c } = v.sel.active;
    const cell = s.cell(r, c);
    const formula = !!cell?.input?.startsWith('=');
    const shown = formula ? null : s.shownText(r, c);
    const places: LinkPlace[] = wb.sheets.filter((x) => !x.dashboard).map((x) => ({ link: `#${x.name}`, label: x.name }));
    const old = cell?.link ? cellOfLink(cell.link) : null;
    const got = await askLink({
      text: shown, link: cell?.link && old ? `#${old.sheet ?? s.name}` : cell?.link, places, placeTitle: 'Cell in this workbook',
      placeTyped: { label: 'Cell', value: old?.cell ?? 'A1', make: (sheet, ref) => { const at = ref.trim().replace(/\$/g, '').toUpperCase(); return parseCellRef(at) ? cellLink(sheet.slice(1), at) : null; } },
    });
    v.focus();
    if (!got || this.view.sheet !== s) return;
    if ('remove' in got) { this.removeLinks(); return; }
    const range = growToMerges(s, v.sel.range);
    this.edit(cell?.link ? 'Edit Link' : 'Insert Link', (sh) => {
      for (let row = range.r1; row <= Math.min(range.r2, range.r1 + 999); row++) {
        for (let col = range.c1; col <= Math.min(range.c2, range.c1 + 99); col++) {
          sh.setLink(row, col, got.link);
          // the text shown: what was typed in the window (the active cell), or the address in an empty cell
          if (row === r && col === c && got.text !== undefined && got.text !== shown) sh.setInput(row, col, got.text || describeLink(got.link));
          else if (!sh.cell(row, col)?.input && !sh.cell(row, col)?.structure) sh.setInput(row, col, describeLink(got.link));
        }
      }
      // Excel's Hyperlink look: blue and underlined
      sh.patchStyle(range, { color: LINK_COLOUR, underline: true });
    });
  }

  /** Remove Link (Excel's Clear Hyperlinks): the selected cells keep their text, without the blue and the underline. */
  private removeLinks(): void {
    const v = this.view, s = v.sheet;
    if (!s) return;
    const range = growToMerges(s, v.sel.range);
    const keys = s.keysIn(range).filter((k) => s.cells.get(k)?.link);
    if (!keys.length) { this.host.flash('No links in the selected cells.'); return; }
    this.edit('Remove Link', (sh) => {
      for (const k of keys) {
        const c = sh.cells.get(k)!;
        const st = c.style && c.style.color?.toLowerCase() === LINK_COLOUR ? { ...c.style, color: undefined, underline: undefined } : c.style;
        sh.setCell(rowOf(k), colOf(k), { ...c, link: undefined, style: st });
      }
    });
  }

  /** Go to a cell a link points to (#Sheet1!B4); false when there is no such sheet or cell. */
  goToPlace(link: string): boolean {
    const wb = this.book, v = this.view;
    const at = cellOfLink(link);
    if (!wb || !at) return false;
    const i = at.sheet === null ? wb.active : wb.sheets.findIndex((x) => x.name.toLowerCase() === at.sheet!.toLowerCase());
    const ref = parseCellRef(at.cell);
    if (i < 0 || !ref) return false;
    v.goSheet(i);
    v.selectCell(ref.row, ref.col);
    v.focus();
    return true;
  }

  /** One undoable change to the sheet showing, remembering the selection for undo. */
  private edit(label: string, fn: (s: Sheet) => void, after?: () => Range): void {
    const wb = this.book;
    const s = this.view.sheet;
    if (!wb || !s) return;
    this.view.commitEdit();
    wb.edit(label, () => fn(s), this.view.place(), after ? () => ({ sheet: s, sel: after() }) : undefined);
    this.view.refresh();
    this.schedulePanel();
  }

  private decimals(delta: 1 | -1): void {
    const v = this.view;
    const s = v.sheet!;
    const { r, c } = v.sel.active;
    const code = changeDecimals(s.styleAt(r, c)?.numFmt, delta, s.shownText(r, c));
    this.style(delta > 0 ? 'More decimal places' : 'Fewer decimal places', { numFmt: code === 'General' ? undefined : code });
  }

  private mergeCells(): void {
    const v = this.view;
    const s = v.sheet!;
    const R = v.sel.range;
    const m = s.mergeAt(v.sel.active.r, v.sel.active.c);
    if (m && R.r1 >= m.r1 && R.r2 <= m.r2 && R.c1 >= m.c1 && R.c2 <= m.c2) {
      this.edit('Unmerge', (sh) => sh.unmerge(m));
      return;
    }
    if (R.r1 === R.r2 && R.c1 === R.c2) { this.host.flash('Select two or more cells to merge.'); return; }
    if (R.r2 - R.r1 > 5000 || R.c2 - R.c1 > 500) { this.host.flash('That is too large a block to merge.'); return; }
    const filled = s.keysIn(R).filter((k) => s.cells.get(k)?.input || s.cells.get(k)?.structure);
    if (filled.length > 1) this.host.flash('Merging keeps only the top-left value, as in Excel (Undo brings the others back).', 6000);
    this.edit('Merge and centre', (sh) => {
      for (const k of filled) if (k !== keyOf(R.r1, R.c1)) sh.setCell(rowOf(k), colOf(k), { style: sh.cell(rowOf(k), colOf(k))?.style });
      sh.merge(R);
      sh.patchStyle({ r1: R.r1, c1: R.c1, r2: R.r1, c2: R.c1 }, { align: 'center' });
    });
  }

  private colourMenu(x: number, y: number, which: 'color' | 'fill'): void {
    document.querySelector('.popup-menu')?.remove();
    const m = document.createElement('div');
    m.className = 'menu popup-menu colour-menu';
    m.setAttribute('role', 'menu');
    const grid = document.createElement('div');
    grid.className = 'colour-grid';
    const pick = (c: string | undefined) => {
      m.remove();
      this.style(which === 'fill' ? 'Fill colour' : 'Text colour', which === 'fill' ? { fill: c } : { color: c });
      this.view.focus();
    };
    for (const c of COLOURS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = c;
      b.title = c;
      b.setAttribute('aria-label', c);
      b.addEventListener('click', () => pick(c));
      grid.append(b);
    }
    const none = document.createElement('button');
    none.type = 'button';
    none.textContent = which === 'fill' ? 'No fill' : 'Automatic (black)';
    none.addEventListener('click', () => pick(undefined));
    const more = document.createElement('label');
    more.className = 'colour-more';
    const input = document.createElement('input');
    input.type = 'color';
    input.dataset.systemPicker = '';
    input.addEventListener('change', () => pick(input.value));
    more.append('More colours ', input);
    m.append(grid, paletteRows(undefined, pick, () => m.remove()), none, more);
    document.body.append(m);
    m.style.left = `${Math.min(x, innerWidth - m.offsetWidth - 4)}px`;
    m.style.top = `${y}px`;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof PointerEvent && m.contains(e.target as Node)) return;
      m.remove();
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', close, true);
    };
    setTimeout(() => { document.addEventListener('pointerdown', close, true); document.addEventListener('keydown', close, true); });
  }

  private bordersMenu(x: number, y: number): void {
    const v = this.view;
    const set = (how: Parameters<Sheet['setBorders']>[1], label: string) => () => this.edit(label, (s) => s.setBorders(growToMerges(s, v.sel.range), how));
    popupMenu(x, y, [
      ['Bottom border', set('bottom', 'Bottom border')],
      ['Top border', set('top', 'Top border')],
      ['Top and bottom border', set('top-bottom', 'Top and bottom border')],
      ['Thick bottom border', set('thick-bottom', 'Thick bottom border')],
      ['Outside borders', set('outside', 'Outside borders')],
      ['All borders', set('all', 'All borders')],
      null,
      ['No border', set('none', 'No border')],
    ]);
  }

  private insertMenu(x: number, y: number): void {
    popupMenu(x, y, [
      ['Insert rows above', () => this.insertCells('row')],
      ['Insert columns to the left', () => this.insertCells('col')],
      ['Insert a worksheet', () => this.view.addSheet()],
    ]);
  }

  private deleteMenu(x: number, y: number): void {
    popupMenu(x, y, [
      ['Delete rows', () => this.deleteCells('row')],
      ['Delete columns', () => this.deleteCells('col')],
      ['Delete this worksheet', () => this.view.deleteSheet()],
    ]);
  }

  private wholeRows(R: Range): boolean { return R.c1 === 0 && R.c2 >= MAX_COLS - 1; }
  private wholeCols(R: Range): boolean { return R.r1 === 0 && R.r2 >= MAX_ROWS - 1; }

  private insertCells(kind?: 'row' | 'col'): void {
    const v = this.view;
    const R = v.sel.range;
    kind ??= this.wholeRows(R) ? 'row' : this.wholeCols(R) ? 'col' : undefined;
    if (!kind) { const b = this.ribbon.querySelector('[data-sh=insert]')!.getBoundingClientRect(); this.insertMenu(b.left, b.bottom + 2); return; }
    const n = kind === 'row' ? Math.min(R.r2, R.r1 + 999) - R.r1 + 1 : Math.min(R.c2, R.c1 + 199) - R.c1 + 1;
    this.edit(kind === 'row' ? 'Insert rows' : 'Insert columns', (s) => (kind === 'row' ? s.insertRows(R.r1, n) : s.insertCols(R.c1, n)));
  }

  private deleteCells(kind?: 'row' | 'col'): void {
    const v = this.view;
    const R = v.sel.range;
    kind ??= this.wholeRows(R) ? 'row' : this.wholeCols(R) ? 'col' : undefined;
    if (!kind) { const b = this.ribbon.querySelector('[data-sh=delete]')!.getBoundingClientRect(); this.deleteMenu(b.left, b.bottom + 2); return; }
    const s = v.sheet!;
    const n = kind === 'row' ? Math.min(R.r2, Math.max(R.r1, s.lastRow)) - R.r1 + 1 : Math.min(R.c2, Math.max(R.c1, s.lastCol)) - R.c1 + 1;
    this.edit(kind === 'row' ? 'Delete rows' : 'Delete columns', (sh) => (kind === 'row' ? sh.deleteRows(R.r1, n) : sh.deleteCols(R.c1, n)));
  }

  private hide(kind: 'row' | 'col', hide: boolean): void {
    const v = this.view;
    const s = v.sheet!;
    const R = v.sel.range;
    this.edit(hide ? (kind === 'row' ? 'Hide rows' : 'Hide columns') : (kind === 'row' ? 'Show rows' : 'Show columns'), (sh) => {
      if (kind === 'row') {
        const end = Math.min(R.r2, Math.max(s.lastRow, R.r1) + 1);
        if (hide) for (let r = R.r1; r <= end; r++) sh.setRowHidden(r, true);
        else for (const r of [...sh.hiddenRows.keys()]) if (r >= R.r1 && r <= R.r2) sh.setRowHidden(r, false);
      } else {
        const end = Math.min(R.c2, Math.max(s.lastCol, R.c1) + 1);
        if (hide) for (let c = R.c1; c <= end; c++) sh.setColHidden(c, true);
        else for (const c of [...sh.hiddenCols.keys()]) if (c >= R.c1 && c <= R.c2) sh.setColHidden(c, false);
      }
    });
  }

  /** Ctrl+D: the top row of the selection copied down it (or the cell above, with one row selected). */
  private fillDown(): void {
    const v = this.view;
    const s = v.sheet!;
    const R = s.clip(v.sel.range) ?? v.sel.range;
    if (R.r1 === R.r2) {
      if (R.r1 === 0) return;
      this.edit('Fill down', (sh) => sh.fill({ ...R, r1: R.r1 - 1, r2: R.r1 - 1 }, { ...R, r1: R.r1 - 1 }));
    } else this.edit('Fill down', (sh) => sh.fill({ ...R, r2: R.r1 }, R));
  }

  private fillRight(): void {
    const v = this.view;
    const s = v.sheet!;
    const R = s.clip(v.sel.range) ?? v.sel.range;
    if (R.c1 === R.c2) {
      if (R.c1 === 0) return;
      this.edit('Fill right', (sh) => sh.fill({ ...R, c1: R.c1 - 1, c2: R.c1 - 1 }, { ...R, c1: R.c1 - 1 }));
    } else this.edit('Fill right', (sh) => sh.fill({ ...R, c2: R.c1 }, R));
  }

  /** Alt+=: SUM of the numbers above the cell (or to its left), ready to check and press Enter. */
  private autoSum(): void {
    const v = this.view;
    const s = v.sheet!;
    const { r, c } = v.sel.active;
    const num = (rr: number, cc: number) => typeof s.values.get(keyOf(rr, cc)) === 'number';
    let top = r;
    while (top > 0 && num(top - 1, c)) top--;
    if (top < r) { v.editCell(`=SUM(${cellName(top, c)}:${cellName(r - 1, c)})`); return; }
    let left = c;
    while (left > 0 && num(r, left - 1)) left--;
    if (left < c) { v.editCell(`=SUM(${cellName(r, left)}:${cellName(r, c - 1)})`); return; }
    v.editCell('=SUM(');
  }

  /** Ctrl+1: the number format box in the panel. */
  private focusFormat(): void {
    this.renderPanel();
    const box = this.panel.querySelector<HTMLInputElement>('.cp-format');
    box?.focus();
    box?.select();
  }

  // ---------------------------------------------------------------- tables: sort, filter, freeze

  /** Does a table start with a row of headers (text over numbers or structures)? */
  private hasHeader(s: Sheet, R: Range): boolean {
    if (s.filter && s.filter.range.r1 === R.r1) return true;
    if (R.r2 === R.r1) return false;
    let text = 0, other = 0;
    for (let c = R.c1; c <= R.c2; c++) {
      const v = s.values.get(keyOf(R.r1, c));
      if (s.cell(R.r1, c)?.structure) return false;
      if (typeof v === 'string' && v) text++;
      else if (v !== undefined && v !== null) other++;
    }
    if (!text || other) return false;
    // the row below holds something other than text somewhere, or this row is bold
    for (let c = R.c1; c <= R.c2; c++) {
      const v = s.values.get(keyOf(R.r1 + 1, c));
      if (s.cell(R.r1 + 1, c)?.structure || (v !== undefined && v !== null && typeof v !== 'string')) return true;
    }
    return !!s.styleAt(R.r1, R.c1)?.bold || s.colDefs.size > 0;
  }

  /** The table around the active cell: its rows of data (without headers) and columns. */
  private tableAt(): { data: Range; header: number | null } | null {
    const v = this.view;
    const s = v.sheet!;
    const { r, c } = v.sel.active;
    const R = v.sel.range;
    if (s.filter && inRange({ ...s.filter.range, r2: Math.max(s.filter.range.r2, s.lastDataRow) }, r, c)) {
      const rows = s.filterRows()!;
      return { data: { r1: rows.r1, c1: s.filter.range.c1, r2: rows.r2, c2: s.filter.range.c2 }, header: s.filter.range.r1 };
    }
    const region = R.r1 !== R.r2 || R.c1 !== R.c2 ? (s.clip(R) ?? R) : s.currentRegion(r, c);
    if (region.r1 === region.r2 && region.c1 === region.c2 && !s.values.has(keyOf(r, c))) return null;
    const head = this.hasHeader(s, region);
    return { data: { ...region, r1: head ? region.r1 + 1 : region.r1 }, header: head ? region.r1 : null };
  }

  private async sort(descending: boolean): Promise<void> {
    const v = this.view;
    const s = v.sheet!;
    const t = this.tableAt();
    if (!t || t.data.r2 <= t.data.r1) { this.host.flash('Click in a table (or select the rows) to sort it.'); return; }
    const col = Math.min(Math.max(v.sel.active.c, t.data.c1), t.data.c2);
    // structures sort by their weight, which may still be being worked out
    if (this.columnHasStructures(s, col, t.data)) { this.book!.recalc(); await this.chem.settled(); }
    this.edit(descending ? 'Sort largest to smallest' : 'Sort smallest to largest', (sh) => sh.sort(t.data, [{ col, descending }]));
    const what = s.cell(t.data.r1, col)?.structure ? ' (structures by molecular weight)' : '';
    this.host.flash(`Sorted ${t.data.r2 - t.data.r1 + 1} rows by column ${colName(col)}${what}.`);
  }

  private columnHasStructures(s: Sheet, col: number, R: Range): boolean {
    for (let r = R.r1; r <= Math.min(R.r2, s.lastRow); r++) if (s.cell(r, col)?.structure) return true;
    return false;
  }

  private toggleFilter(): void {
    const v = this.view;
    const s = v.sheet!;
    if (s.filter) { this.edit('Filter off', (sh) => sh.setFilter(null)); this.host.flash('Filter off: every row shows.'); return; }
    const { r, c } = v.sel.active;
    const R = v.sel.range;
    let region = R.r1 !== R.r2 || R.c1 !== R.c2 ? (s.clip(R) ?? R) : s.currentRegion(r, c);
    if (region.r1 === region.r2 && !s.values.has(keyOf(r, c))) { this.host.flash('Click in a table to filter it.'); return; }
    // a table without a header row gets its filter buttons on the first row anyway (as in Excel)
    region = { ...region };
    this.edit('Filter', (sh) => sh.setFilter({ range: region, conditions: {} }));
    this.host.flash('Filter on: use the buttons in the header row to choose which rows show.');
  }

  /** Make sure there is a filter covering a column (turning one on for the table there). */
  private ensureFilter(col: number): boolean {
    const v = this.view;
    const s = v.sheet!;
    if (s.filter && col >= s.filter.range.c1 && col <= s.filter.range.c2) return true;
    const region = s.currentRegion(v.sel.active.r, col);
    if (region.r1 === region.r2 && !s.values.has(keyOf(v.sel.active.r, col))) { this.host.flash('Click in a table to filter it.'); return false; }
    this.edit('Filter', (sh) => sh.setFilter({ range: region, conditions: {} }));
    return true;
  }

  /** Apply a condition once its answers are in (properties and substructure matches come from the engine). */
  private async setCondition(col: number, cond: Condition | null): Promise<void> {
    const s = this.view.sheet!;
    if (!s.filter) return;
    if (cond) {
      this.book!.recalc();
      const rows = s.filterRows()!;
      for (let r = rows.r1; r <= rows.r2; r++) s.passes(r, col, cond);
      if (this.chem.busy) this.host.flash('Working out which rows match…', 2000);
      await this.chem.settled();
      this.book!.recalc();
    }
    if (this.view.sheet !== s) return;
    this.edit(cond ? 'Filter' : 'Clear filter', (sh) => sh.setCondition(col, cond));
    const rows = s.filterRows();
    if (rows && cond) {
      let shown = 0;
      for (let r = rows.r1; r <= rows.r2; r++) if (!s.hiddenRows.has(r)) shown++;
      this.host.flash(`${shown} of ${rows.r2 - rows.r1 + 1} rows show.`);
    }
  }

  private filterByStructure(col: number): void {
    const s = this.view.sheet!;
    if (!this.ensureFilter(col)) return;
    const rows = s.filterRows()!;
    if (!this.columnHasStructures(s, col, { r1: rows.r1, c1: col, r2: rows.r2, c2: col })) {
      this.host.flash(`Column ${colName(col)} has no structures to search. Click in the column of structures first.`, 6000);
      return;
    }
    const old = s.filter!.conditions[col];
    this.host.editStructure(old?.kind === 'substructure' ? old.query : null, `Draw the part to look for in column ${colName(col)}`, (c) => {
      if (!c) return;
      if (!c.atoms.length) { void this.setCondition(col, null); return; }
      void this.setCondition(col, { kind: 'substructure', query: c });
    });
  }

  private freezeHeader(): void {
    const v = this.view;
    const s = v.sheet!;
    if (s.frozen.rows) { this.edit('Unfreeze', (sh) => sh.setFrozen(0, sh.frozen.cols)); return; }
    const t = this.tableAt();
    const rows = t?.header !== null && t?.header !== undefined ? t.header + 1 : Math.max(1, v.sel.active.r);
    this.edit('Freeze header row', (sh) => sh.setFrozen(rows, sh.frozen.cols));
    this.host.flash(`Rows 1–${rows} stay in view as you scroll.`);
  }

  // ---------------------------------------------------------------- the filter button on a header

  private filterMenu(col: number, at: { x: number; y: number }): void {
    const s = this.view.sheet!;
    const f = s.filter;
    if (!f) return;
    document.querySelector('.popup-menu')?.remove();
    const m = document.createElement('div');
    m.className = 'menu popup-menu filter-menu';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-label', `Filter column ${colName(col)}`);
    const rows = s.filterRows()!;
    const cond = f.conditions[col];
    const btn = (label: string, fn: () => void, cls = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener('click', () => { m.remove(); fn(); });
      return b;
    };
    m.append(
      btn('Sort smallest to largest', () => { this.view.selectCell(rows.r1, col); void this.sort(false); }),
      btn('Sort largest to smallest', () => { this.view.selectCell(rows.r1, col); void this.sort(true); }),
      document.createElement('hr'),
    );
    const structures = this.columnHasStructures(s, col, { r1: rows.r1, c1: col, r2: rows.r2, c2: col });
    if (structures) {
      m.append(btn(cond?.kind === 'substructure' ? 'Change the part searched for…' : 'Rows whose structure contains…', () => this.filterByStructure(col)));
    }
    // a test on the value: MW < 500
    const test = document.createElement('div');
    test.className = 'fm-test';
    const op = document.createElement('select');
    for (const [v, l] of [['<', 'less than'], ['<=', 'at most'], ['>', 'more than'], ['>=', 'at least'], ['=', 'equal to'], ['<>', 'not equal to'], ['contains', 'containing']] as const) op.add(new Option(l, v));
    const val = document.createElement('input');
    val.type = 'text';
    val.size = 8;
    val.setAttribute('aria-label', 'Value');
    if (cond?.kind === 'compare') { op.value = cond.op; val.value = String(cond.value); }
    if (cond?.kind === 'contains') { op.value = 'contains'; val.value = cond.text; }
    const go = document.createElement('button');
    go.type = 'button';
    go.textContent = 'Show';
    const apply = () => {
      const text = val.value.trim();
      if (!text) return;
      m.remove();
      if (op.value === 'contains') { void this.setCondition(col, { kind: 'contains', text }); return; }
      const n = Number(text);
      void this.setCondition(col, { kind: 'compare', op: op.value as CompareOp, value: text !== '' && Number.isFinite(n) ? n : text });
    };
    go.addEventListener('click', apply);
    val.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); apply(); } });
    const lab = document.createElement('span');
    lab.textContent = 'Rows with values';
    test.append(lab, op, val, go);
    m.append(test);
    // the values in the column, to tick
    if (!structures) {
      const seen = new Map<string, number>();
      for (let r = rows.r1; r <= rows.r2 && seen.size < 1000; r++) {
        const t = s.shownText(r, col);
        seen.set(t, (seen.get(t) ?? 0) + 1);
      }
      const list = document.createElement('div');
      list.className = 'fm-values';
      const allowed = cond?.kind === 'values' ? new Set(cond.allowed) : null;
      const boxes: HTMLInputElement[] = [];
      const sorted = [...seen.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, undefined, { numeric: true })));
      const all = document.createElement('label');
      const allBox = document.createElement('input');
      allBox.type = 'checkbox';
      allBox.checked = !allowed;
      all.append(allBox, ' (Select all)');
      allBox.addEventListener('change', () => boxes.forEach((b) => { b.checked = allBox.checked; }));
      list.append(all);
      for (const t of sorted) {
        const l = document.createElement('label');
        const b = document.createElement('input');
        b.type = 'checkbox';
        b.value = t;
        b.checked = !allowed || allowed.has(t);
        boxes.push(b);
        l.append(b, ` ${t === '' ? '(Blanks)' : t}`);
        list.append(l);
      }
      const ok = btn('OK', () => {
        const picked = boxes.filter((b) => b.checked).map((b) => b.value);
        void this.setCondition(col, picked.length === boxes.length ? null : { kind: 'values', allowed: picked });
      }, 'primary');
      m.append(list, ok);
    }
    if (cond) m.append(document.createElement('hr'), btn(`Clear the filter from column ${colName(col)}`, () => void this.setCondition(col, null)));
    m.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.append(m);
    m.style.left = `${Math.max(4, Math.min(at.x, innerWidth - m.offsetWidth - 4))}px`;
    m.style.top = `${Math.max(4, Math.min(at.y, innerHeight - m.offsetHeight - 4))}px`;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof PointerEvent && m.contains(e.target as Node)) return;
      m.remove();
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', close, true);
    };
    setTimeout(() => { document.addEventListener('pointerdown', close, true); document.addEventListener('keydown', close, true); });
    val.focus();
  }

  // ---------------------------------------------------------------- chemistry

  /** Open the drawing tools on a cell's structure (or a new one). */
  drawStructure(r: number, c: number): void {
    const v = this.view;
    const s = v.sheet;
    const wb = this.book;
    if (!s || !wb) return;
    v.commitEdit();
    const m = s.mergeAt(r, c);
    if (m) { r = m.r1; c = m.c1; }
    const cell = s.cell(r, c);
    if (!cell?.structure && (cell?.input || s.colDefs.has(c))) {
      this.host.flash(`${cellName(r, c)} holds ${s.colDefs.has(c) ? 'a calculated value' : 'text or a number'}: press Delete first to draw a structure there.`, 6000);
      return;
    }
    this.host.editStructure(cell?.structure?.contents ?? null, `Structure in ${cellName(r, c)}${wb.sheets.length > 1 ? ` (${s.name})` : ''}`, (contents) => {
      if (!contents || this.book !== wb) return;
      wb.edit(cell?.structure ? 'Change structure' : 'Draw structure', () => s.setStructure(r, c, isBlankDrawing(contents) ? null : contents), { sheet: s, sel: { r1: r, c1: c, r2: r, c2: c } });
      v.selectCell(r, c);
      v.focus();
    });
  }

  /**
   * Structure from Name or SMILES: with text cells selected, each name (or SMILES) is drawn in a
   * new column to the right; otherwise a box asks for one, drawn in the active cell.
   */
  private async structureFromName(): Promise<void> {
    const v = this.view;
    const s = v.sheet!;
    const wb = this.book!;
    const style = wb.drawingStyle;
    const R = s.clip(v.sel.range) ?? v.sel.range;
    const texts: { r: number; c: number; text: string }[] = [];
    if (R.c1 === R.c2) {
      for (let r = R.r1; r <= Math.min(R.r2, s.lastRow); r++) {
        const val = s.values.get(keyOf(r, R.c1));
        if (typeof val === 'string' && val.trim() && !s.cell(r, R.c1)?.structure) texts.push({ r, c: R.c1, text: val.trim() });
      }
    }
    if (texts.length) {
      // a header (a word over names) is left alone when the column has several names
      this.host.flash(`Reading ${texts.length} name${texts.length > 1 ? 's' : ''}…`, 30000);
      const got: { r: number; contents: Contents }[] = [];
      const missed: string[] = [];
      for (const t of texts) {
        const res = await this.host.toStructure(t.text, style);
        if ('error' in res) missed.push(t.text);
        else got.push({ r: t.r, contents: res.contents });
      }
      if (!got.length) { this.host.flash(`None of these could be read as names or SMILES: ${missed.slice(0, 4).join(', ')}${missed.length > 4 ? '…' : ''}`, 9000); return; }
      const col = R.c1 + 1;
      this.edit('Structures from names', (sh) => {
        sh.insertCols(col, 1);
        for (const g of got) sh.setStructure(g.r, col, g.contents);
        sh.setColWidth(col, 150);
        const head = R.r1 > 0 && !texts.some((t) => t.r === R.r1 - 1) ? R.r1 - 1 : -1;
        const above = head >= 0 ? sh.values.get(keyOf(head, R.c1)) : undefined;
        if (head >= 0 && typeof above === 'string' && !sh.cell(head, col)) sh.setInput(head, col, 'Structure');
      });
      this.host.flash(`Drew ${got.length} structure${got.length > 1 ? 's' : ''} in column ${colName(col)}.${missed.length ? ` Not read: ${missed.slice(0, 4).join(', ')}${missed.length > 4 ? '…' : ''}` : ''}`, missed.length ? 9000 : 4000);
      return;
    }
    const { r, c } = v.sel.active;
    const ans = await ask('Structure from name or SMILES', [{ name: 'text', label: 'Name or SMILES', value: '' }], {
      ok: 'Draw', note: `Draws the structure in ${cellName(r, c)}. Names are read on this computer (OPSIN): systematic names and many common ones such as caffeine.`,
    });
    const text = ans?.text.trim();
    if (!text) return;
    const res = await this.host.toStructure(text, style);
    if ('error' in res) { this.host.flash(res.error, 9000); return; }
    this.edit('Structure from name', (sh) => sh.setStructure(r, c, res.contents));
    if (res.notes.length) this.host.flash('Note from the name reader: ' + res.notes.join(' '), 9000);
  }

  /**
   * A SMILES or name typed into a column headed "Structure" (a reagent table's) is drawn there,
   * in place of the text. Text that can't be read stays as it was typed.
   */
  private async typedStructure(r: number, c: number, text: string): Promise<void> {
    const s = this.view.sheet, wb = this.book;
    if (!s || !wb || r === 0 || /\s/.test(text) && !/[a-z]{3}/i.test(text)) return;
    const head = s.values.get(keyOf(0, c));
    if (typeof head !== 'string' || !/^structures?$/i.test(head.trim())) return;
    const res = await this.host.toStructure(text, wb.drawingStyle);
    // still the same text in the same cell (nothing typed over it meanwhile)
    if ('error' in res || this.book !== wb || s.values.get(keyOf(r, c)) !== text || s.cell(r, c)?.structure) return;
    // not through edit(): that would end typing begun in the next cell meanwhile
    wb.edit('Structure from typing', () => s.setStructure(r, c, res.contents), this.view.place());
    this.view.refresh();
    this.host.changed();
  }

  /** Edit > Paste SMILES: a SMILES string, molfile or name drawn as a structure in the active cell. */
  async structureFromText(text: string): Promise<void> {
    const v = this.view;
    const s = v.sheet;
    const wb = this.book;
    if (!s || !wb) return;
    v.commitEdit();
    const m = s.mergeAt(v.sel.active.r, v.sel.active.c);
    const r = m?.r1 ?? v.sel.active.r, c = m?.c1 ?? v.sel.active.c;
    if (s.colDefs.has(c) && r >= s.colDefs.get(c)!.firstRow) { this.host.flash('This column works out a property: put structures in the column of structures.'); return; }
    const res = await this.host.toStructure(text, wb.drawingStyle);
    if ('error' in res) { this.host.flash(res.error, 9000); return; }
    if (this.book !== wb) return;
    this.edit('Paste structure', (sh) => sh.setStructure(r, c, res.contents));
    if (res.notes.length) this.host.flash('Note from the name reader: ' + res.notes.join(' '), 9000);
  }

  /** The structure in the active cell, if it holds one. */
  activeStructure(): Contents | null {
    const s = this.view.sheet;
    if (!s) return null;
    const { r, c } = this.view.sel.active;
    const m = s.mergeAt(r, c);
    return s.cell(m?.r1 ?? r, m?.c1 ?? c)?.structure?.contents ?? null;
  }

  /**
   * Insert > Isotope Pattern…: a table of an ion's isotope peaks (calculated, with columns for the
   * peaks found and their error in ppm) and a chart of them as a mass spectrum.
   */
  private async isotopePattern(): Promise<void> {
    const v = this.view;
    const s = v.sheet;
    if (!s) return;
    const { r, c } = v.sel.active;
    const here = s.cell(r, c)?.structure || (typeof s.value(r, c) === 'string' && s.value(r, c) !== '') ? cellName(r, c) : '';
    const got = await ask('Isotope pattern', [
      { name: 'source', label: 'Compound', value: here, placeholder: 'B2, or a formula such as C10H12N2O' },
      { name: 'ion', label: 'Ion', value: '[M+H]+', suggestions: COMMON_ADDUCTS },
      { name: 'min', label: 'List peaks down to', value: '0.5', type: 'number', unit: '% of the tallest' },
      { name: 'found', label: 'Columns for the peaks found, with the error in ppm', value: 'true', type: 'checkbox' },
      { name: 'chart', label: 'Chart', value: 'mirror', options: ISOTOPE_CHARTS },
    ], { ok: 'Insert', note: 'The compound is a cell with a structure, SMILES or formula, or a formula typed here. The table works itself out (ISOMZ and ISOABUND), so it follows the structure, and the ion can be changed in its cell. Type the peaks you measured into the Found columns.' });
    if (!got) return;
    const text = got.source.trim();
    if (!text) { this.host.flash('Give the compound: a cell such as B2, or a formula such as C10H12N2O.', 6000); return; }
    const cellRef = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(text);
    let source: string, compound: string, iso: IsotopeSource | null = null;
    if (cellRef) {
      const ref = `$${cellRef[1].toUpperCase()}$${cellRef[2]}`;
      const rr = Number(cellRef[2]) - 1, cc = colIndex(cellRef[1].toUpperCase());
      const val = s.value(rr, cc);
      source = ref;
      if (typeof val === 'string' && readsAsFormula(val)) { compound = `=${ref}`; iso = { formula: val }; }
      else {
        compound = `=FORMULA(${ref})`;
        // the structure's formula, to know how many peaks to list
        const cell = s.cell(rr, cc);
        const ask1 = () => (cell?.structure ? this.chem.structure(cell.structure) : typeof val === 'string' && val ? this.chem.smiles(val) : null);
        let m = ask1();
        if (m && isError(m) && m.code === '#BUSY!') { await this.chem.settled(); m = ask1(); }
        if (!m || isError(m)) { this.host.flash(`${text} has no structure, SMILES or formula the isotope pattern can read.`, 6000); return; }
        iso = { mol: m };
      }
    } else if (readsAsFormula(text)) {
      source = `"${text.replace(/"/g, '')}"`;
      compound = text;
      iso = { formula: text };
    } else {
      this.host.flash(`"${text}" is not a cell or a formula. Write a cell such as B2, or a formula such as C10H12N2O (each element once).`, 8000);
      return;
    }
    const ion = got.ion.trim() || '[M+H]+';
    const min = Number(got.min);
    const peaks = listedPeaks(iso, ion, Number.isFinite(min) && min >= 0 ? min : 0.5);
    if (isError(peaks)) { this.host.flash(peaks.detail || 'The isotope pattern could not be worked out.', 8000); return; }
    // to the right of the table the active cell is in, where the cells are empty
    const region = s.currentRegion(r, c);
    const found = got.found === 'true';
    const width = 3 + (found ? 3 : 0) + (found && got.chart === 'mirror' ? 1 : 0), height = 4 + peaks.length;
    let col = region.c2 + 2;
    const free = (c0: number) => {
      for (let rr = region.r1; rr < region.r1 + height; rr++) for (let cc = c0; cc < c0 + width; cc++) if (s.cell(rr, cc)?.input || s.cell(rr, cc)?.structure) return false;
      return true;
    };
    while (!free(col) && col < MAX_COLS - width) col++;
    const t = isotopeTable({ sheet: s.name, at: { row: region.r1, col }, source, compound, ion, peaks, found, chart: got.chart as IsotopeChartKind });
    const chart = t.chart ? v.clearOfCharts(t.chart) : null;
    this.edit('Insert isotope pattern', (sh) => {
      for (const x of t.cells) {
        if (x.input) sh.setInput(x.row, x.col, x.input);
        if (x.style) sh.patchStyle({ r1: x.row, c1: x.col, r2: x.row, c2: x.col }, x.style);
      }
      for (const [cc, w] of t.widths) sh.setColWidth(cc, w);
      if (chart) sh.setCharts([...sh.charts, chart]);
    }, () => ({ r1: region.r1, c1: col, r2: region.r1 + t.rows - 1, c2: col + t.cols - 1 }));
    if (chart) v.pickChart(chart.id);
    this.host.flash(found ? 'Type the m/z and heights you measured into the Found columns; the chart and the ppm errors follow.' : 'The ion can be changed in its cell; the peaks follow.', 8000);
  }

  /** Columns holding structures or SMILES in the table around the active cell (for the property window). */
  private structureColumns(s: Sheet, R: Range): { col: number; label: string }[] {
    const out: { col: number; label: string }[] = [];
    for (let c = R.c1; c <= R.c2; c++) {
      let structures = 0, smiles = 0;
      for (let r = R.r1; r <= Math.min(R.r2, R.r1 + 200); r++) {
        if (s.cell(r, c)?.structure) structures++;
        else {
          const v = s.values.get(keyOf(r, c));
          if (typeof v === 'string' && /^[A-Za-z0-9@+\-[\]()=#$%/\\.:*~]+$/.test(v) && /[a-z]|[A-Z].*[A-Z0-9(=]/.test(v) && v.length > 1) smiles++;
        }
      }
      if (structures || smiles > 1) {
        const head = s.values.get(keyOf(R.r1, c));
        out.push({ col: c, label: `Column ${colName(c)}${typeof head === 'string' && head ? ` (${head})` : ''}${structures ? '' : ' — SMILES'}` });
      }
    }
    return out;
  }

  /** Chemistry > Insert Property Column…: pick properties to work out from a column of structures. */
  private async propertyColumns(choice?: { col: number; props: PropertyChoice[] }): Promise<void> {
    const v = this.view;
    const s = v.sheet!;
    const { r, c } = v.sel.active;
    const region = s.currentRegion(r, c);
    if (!choice) {
      const cols = this.structureColumns(s, region);
      if (!cols.length) {
        this.host.flash('Click in a table with a column of structures (or SMILES) first. To start one, draw a structure in a cell (Chemistry > Structure).', 8000);
        return;
      }
      const got = await askProperties({ columns: cols, col: cols.some((x) => x.col === c) ? c : cols[0].col });
      if (!got) return;
      choice = got;
    }
    this.insertPropertyColumns(s, choice.col, choice.props, region);
  }

  private insertPropertyColumns(s: Sheet, col: number, props: PropertyChoice[], region: Range): void {
    // the first row of data: the first structure (or SMILES) in the column; the row above it is the header
    let first = -1;
    for (let r = region.r1; r <= region.r2; r++) {
      const v = s.values.get(keyOf(r, col));
      if (s.cell(r, col)?.structure || (typeof v === 'string' && r > region.r1)) { first = r; break; }
      if (typeof v === 'string' && v && r === region.r1 && !this.hasHeader(s, region) && region.r2 === region.r1) { first = r; break; }
    }
    if (first < 0) first = region.r1 + (this.hasHeader(s, region) ? 1 : 0);
    const header = first > 0 ? first - 1 : -1;
    const at = region.c2 + 1;
    const ref = cellName(first, col);
    const headStyle = header >= 0 ? s.styleAt(header, col) : undefined;
    this.edit(props.length > 1 ? 'Insert property columns' : 'Insert property column', (sh) => {
      sh.insertCols(at, props.length);
      props.forEach((p, i) => {
        const def = PROPERTIES[p.name];
        const target = at + i;
        const extra = p.name === 'HRMS' && p.adduct && p.adduct !== '[M+H]+' ? `,"${p.adduct}"`
          : p.name === 'DUPLICATE' ? `,$${colName(col)}:$${colName(col)}` : '';
        const style: CellStyle = {};
        if (def.format !== 'General') style.numFmt = def.format;
        if (def.chem) style.chem = true;
        sh.setColDef(target, { formula: `=${p.name}(${ref}${extra})`, firstRow: first, style: Object.keys(style).length ? style : undefined });
        if (header >= 0 && !sh.cell(header, target)?.input) {
          sh.setInput(header, target, p.name === 'HRMS' ? `${p.adduct ?? '[M+H]+'} m/z` : def.label);
          if (headStyle) sh.patchStyle({ r1: header, c1: target, r2: header, c2: target }, { bold: headStyle.bold, fill: headStyle.fill, align: headStyle.align, borders: headStyle.borders });
        }
        sh.setColWidth(target, p.name === 'SMILES' ? 220 : p.name === 'INCHIKEY' ? 200 : p.name === 'FORMULA' || p.name === 'DUPLICATE' ? 96 : 80);
      });
    });
    this.host.flash(`Added ${props.map((p) => PROPERTIES[p.name].label).join(', ')}. Type over any value to replace it; Reset to Calculated puts it back.`, 6000);
  }

  /**
   * A new sheet laid out as a reagent table: each reagent's structure gives its MW, and its
   * equivalents give its amount from the limiting reagent's (row 2), as mass and, with a density
   * or concentration, volume. Every worked-out value can be typed over.
   */
  private reagentTable(): void {
    const wb = this.book;
    const v = this.view;
    if (!wb) return;
    v.commitEdit();
    const names = new Set(wb.sheets.map((x) => x.name.toLowerCase()));
    let name = 'Reagents';
    for (let i = 2; names.has(name.toLowerCase()); i++) name = `Reagents ${i}`;
    const s = wb.edit('Reagent table', () => {
      const sh = wb.addSheet(name, wb.active + 1);
      fillReagentTable(sh);
      return sh;
    }, v.place());
    v.goSheet(wb.sheets.indexOf(s));
    this.host.flash('Reagent table: type the limiting reagent\'s mmol in E2, then each reagent\'s structure (draw it, or type SMILES) and equiv. MW, mmol, mass and volume work themselves out; type over any of them to replace it.', 10000);
  }

  /** Is the active cell shown as chemistry (by its look, or because its text has a formula)? */
  private chemShown(): boolean {
    const s = this.view.sheet;
    if (!s) return false;
    const { r, c } = this.view.sel.active;
    return showsChem(s.styleAt(r, c)?.chem, s.values.get(keyOf(r, c)));
  }

  /** Put back the calculated values where they were typed over. */
  private resetCalculated(): void {
    const v = this.view;
    const s = v.sheet!;
    const R = v.sel.range;
    const keys = s.keysIn(R).filter((k) => s.isOverride(rowOf(k), colOf(k)));
    if (!keys.length) { this.host.flash('None of the selected cells has a value typed over a calculated one.'); return; }
    this.edit('Reset to calculated', (sh) => {
      for (const k of keys) sh.setCell(rowOf(k), colOf(k), { style: sh.cell(rowOf(k), colOf(k))?.style });
    });
    this.host.flash(`Reset ${keys.length} cell${keys.length > 1 ? 's' : ''} to the calculated value.`);
  }

  // ---------------------------------------------------------------- clipboard

  /** Copy (or cut) the selected cells. A single structure goes as a drawing, for ChemDraw and Word. */
  async copy(cut = false): Promise<void> {
    const v = this.view;
    const s = v.sheet;
    const wb = this.book;
    if (!s || !wb) return;
    v.commitEdit();
    const sel = growToMerges(s, v.sel.range);
    const R = s.clip(sel) ?? { r1: sel.r1, c1: sel.c1, r2: sel.r1, c2: sel.c1 };
    if (!cut && R.r1 === R.r2 && R.c1 === R.c2 && s.cell(R.r1, R.c1)?.structure) {
      const st = s.cell(R.r1, R.c1)!.structure!;
      try {
        this.host.flash(await this.host.copyStructure(st.contents, wb.drawingStyle));
      } catch (e) {
        this.host.flash('Could not copy: ' + String(e));
      }
      this.clip = null;
      v.copied = { sheet: s, range: R };
      v.refresh();
      return;
    }
    if ((R.r2 - R.r1 + 1) * (R.c2 - R.c1 + 1) > 2e6) { this.host.flash('That is too many cells to copy at once.'); return; }
    const block = s.copy(R);
    const rows: string[][] = [];
    for (let r = R.r1; r <= R.r2; r++) {
      const line: string[] = [];
      for (let c = R.c1; c <= R.c2; c++) line.push(s.hiddenRows.has(r) ? '' : this.cellText(s, r, c));
      rows.push(line);
    }
    const text = toDelimited(rows, '\t').replace(/\r\n$/, '') + '\r\n';
    const own = JSON.stringify({ kind: OWN_KIND, version: 1, block });
    this.clip = { text, block, sheet: s, range: R, cut };
    v.copied = { sheet: s, range: R };
    v.refresh();
    try {
      await this.host.writeCells(own, text, this.htmlTable(s, R));
      const n = (R.r2 - R.r1 + 1) * (R.c2 - R.c1 + 1);
      this.host.flash(`${cut ? 'Cut' : 'Copied'} ${n === 1 ? cellName(R.r1, R.c1) : `${rangeSize(R)} cells`}${cut ? ': paste to move them' : ''}. Excel gets the values, and SMILES for structures.`);
    } catch (e) {
      this.host.flash('Could not use the clipboard: ' + String(e));
    }
  }

  /** A cell as text for other programs: what it shows (structures as SMILES). */
  private cellText(s: Sheet, r: number, c: number): string {
    const v = s.values.get(keyOf(r, c));
    if (s.cell(r, c)?.structure) return typeof v === 'string' ? v : '';
    if (v === undefined || v === null) return '';
    if (isError(v)) return (v as CellError).code;
    return s.shownText(r, c);
  }

  /** The cells as an HTML table, so Word and Excel keep bold, colours and alignment. */
  private htmlTable(s: Sheet, R: Range, pictures = false): string {
    const lines: string[] = ['<table border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse">'];
    for (let r = R.r1; r <= R.r2; r++) {
      if (s.hiddenRows.has(r)) continue;
      const tds: string[] = [];
      for (let c = R.c1; c <= R.c2; c++) {
        if (s.hiddenCols.has(c)) continue;
        const m = s.mergeAt(r, c);
        if (m && (m.r1 !== r || m.c1 !== c)) continue;
        const span = m ? `${m.c2 > m.c1 ? ` colspan="${m.c2 - m.c1 + 1}"` : ''}${m.r2 > m.r1 ? ` rowspan="${m.r2 - m.r1 + 1}"` : ''}` : '';
        const cell = this.cellHtml(s, r, c, pictures);
        tds.push(`<td${span}${cell.attrs}>${cell.body}</td>`);
      }
      lines.push(`<tr>${tds.join('')}</tr>`);
    }
    lines.push('</table>');
    return lines.join('');
  }

  /** One cell for an HTML table: its look as the <td>'s attributes, and what it shows (a structure as a picture, for printing). */
  private cellHtml(s: Sheet, r: number, c: number, pictures: boolean, fit?: { w: number; h: number }): { attrs: string; body: string } {
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const picture = (): string | null => {
      const st = pictures ? s.cell(r, c)?.structure : undefined;
      if (!st) return null;
      const b = this.pictures.box(st), bmp = this.pictures.bitmap(st, 4, true);
      if (!bmp) return null;
      // printed pages: shrunk to fit the cell, as the grid shows it (points to pixels: 4/3)
      const k = fit ? Math.min(1, (fit.w - 4) / (b.w * 4 / 3), (fit.h - 4) / (b.h * 4 / 3)) : 1;
      return `<img src="${bmp.toDataURL('image/png')}" style="width:${b.w * k}pt;height:${b.h * k}pt" alt="">`;
    };
    const st = s.styleAt(r, c);
    const css: string[] = [];
    if (st?.bold) css.push('font-weight:700');
    if (st?.italic) css.push('font-style:italic');
    if (st?.underline) css.push('text-decoration:underline');
    if (st?.color) css.push(`color:${st.color}`);
    if (st?.fill) css.push(`background:${st.fill}`);
    if (st?.align) css.push(`text-align:${st.align}`);
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const b = st?.borders?.[side];
      if (b) css.push(`border-${side}:${b.style === 'thick' ? '2.25pt' : b.style === 'medium' ? '1.5pt' : '.5pt'} ${b.style === 'double' ? 'double' : b.style === 'dashed' ? 'dashed' : b.style === 'dotted' ? 'dotted' : 'solid'} ${b.color ?? '#000'}`);
    }
    const v = s.values.get(keyOf(r, c));
    const num = typeof v === 'number';
    // numbers sit on the right unless set otherwise, as on screen
    if (num && !st?.align) css.push('text-align:right');
    if (fit) {
      if (st?.valign === 'top' || st?.valign === 'middle') css.push(`vertical-align:${st.valign}`);
      if (st?.wrap) css.push('white-space:pre-wrap'); else css.push('white-space:pre;overflow:hidden');
      if (st?.size) css.push(`font-size:${st.size}pt`);
      if (st?.font) css.push(`font-family:'${st.font}', Calibri, Carlito, Arial, sans-serif`);
    }
    // Excel reads a number with x:num and keeps its full value
    const text = this.cellText(s, r, c);
    // printed pages: formulas with their numbers lowered and charges raised, as on screen
    const chem = fit && typeof v === 'string' && showsChem(st?.chem, v)
      ? chemPieces(text).map((p) => { const t = esc(p.text); const x = p.pos === 'sub' ? `<sub>${t}</sub>` : p.pos === 'sup' ? `<sup>${t}</sup>` : t; return p.italic ? `<i>${x}</i>` : x; }).join('')
      : null;
    return { attrs: `${num ? ` x:num="${v}"` : ''}${css.length ? ` style="${css.join(';')}"` : ''}`, body: picture() ?? chem ?? esc(text).replace(/\n/g, '<br>') };
  }

  /** Page Layout > Print Preview: the pages as they will print. */
  printPreview(): void {
    const name = this.tab?.name ?? 'Sheet';
    const got = this.printedSheet({ selection: false, ignoreArea: false, file: name });
    if (!got) { this.host.flash('There is nothing in this sheet to print.'); return; }
    previewPages(got, `${this.view.sheet!.name}`, () => this.host.print?.());
  }

  /** File > Print and Print Preview: the sheet's pages, as its page setup lays them out. */
  printedSheet(opts: { selection: boolean; ignoreArea: boolean; file: string }): PrintedSheet | null {
    const v = this.view, s = v.sheet, wb = this.book;
    if (!s || !wb) return null;
    v.commitEdit();
    const sel = opts.selection ? s.clip(growToMerges(s, v.sel.range)) : null;
    if (opts.selection && !sel) return null;
    return printSheet(wb, s, {
      rowHeight: (r) => v.rowHeight(r),
      cellHtml: (sh, r, c) => {
        const m = sh.mergeAt(r, c);
        const w = m ? Array.from({ length: m.c2 - m.c1 + 1 }, (_, i) => v.colWidth(m.c1 + i)).reduce((a, b) => a + b, 0) : v.colWidth(c);
        const h = m ? Array.from({ length: m.r2 - m.r1 + 1 }, (_, i) => v.rowHeight(m.r1 + i)).reduce((a, b) => a + b, 0) : v.rowHeight(r);
        return this.cellHtml(sh, r, c, true, { w, h });
      },
    }, { selection: sel ?? undefined, ignoreArea: opts.ignoreArea, file: opts.file });
  }

  /** Split view's Insert: a drawing into the selected cell, as pasting one would. */
  putStructure(contents: Contents): void {
    const v = this.view;
    const s = v.sheet;
    if (!s || !this.book) return;
    v.commitEdit();
    if (isBlankDrawing(contents)) { this.host.flash('There is nothing to put in the cell.'); return; }
    const m = s.mergeAt(v.sel.active.r, v.sel.active.c);
    const r = m?.r1 ?? v.sel.active.r, c = m?.c1 ?? v.sel.active.c;
    if (s.colDefs.has(c) && r >= s.colDefs.get(c)!.firstRow) { this.host.flash('This column works out a property: put structures in the column of structures.'); return; }
    this.edit('Insert structure', (sh) => sh.setStructure(r, c, contents));
    this.host.flash(`Put the structure in ${cellName(r, c)}. Double-click it to change it.`);
    this.view.focus();
  }

  /** Paste at the selection: cells copied here, a drawing (into the active cell), or text from Excel and elsewhere. */
  async paste(e: ClipboardEvent | null, what: 'all' | 'values' | 'formats' = 'all'): Promise<void> {
    const v = this.view;
    const s = v.sheet;
    const wb = this.book;
    if (!s || !wb) return;
    v.commitEdit();
    let got: ClipboardCells;
    try {
      got = await this.host.readCells(e);
    } catch (err) {
      this.host.flash('Could not read the clipboard: ' + String(err));
      return;
    }
    const { r, c } = v.sel.active;
    let block: CellBlock | null = null;
    let fromClip = false;
    if (this.clip && got.text !== undefined && normalizeEol(got.text) === normalizeEol(this.clip.text)) {
      block = this.clip.block;
      fromClip = true;
    } else if (got.own) {
      try {
        const o = JSON.parse(got.own);
        if (o?.kind === OWN_KIND) block = reviveBlock(o.block);
      } catch {
        block = null;
      }
    }
    if (!block && got.drawing) {
      if (isBlankDrawing(got.drawing)) { this.host.flash('There is nothing to paste.'); return; }
      const m = s.mergeAt(r, c);
      const rr = m?.r1 ?? r, cc = m?.c1 ?? c;
      if (s.colDefs.has(cc) && rr >= s.colDefs.get(cc)!.firstRow) { this.host.flash('This column works out a property: paste structures into the column of structures.'); return; }
      this.edit('Paste structure', (sh) => sh.setStructure(rr, cc, got.drawing!));
      this.host.flash(`Pasted the structure into ${cellName(rr, cc)}. Double-click it to change it.`);
      return;
    }
    if (!block && got.text !== undefined && got.text !== '') {
      const rows = parseDelimited(got.text, got.text.includes('\t') ? '\t' : 'auto');
      const width = Math.max(...rows.map((x) => x.length));
      block = { rows: rows.length, cols: width, cells: rows.map((x) => x.map((t) => (t === '' ? undefined : { input: t } as Cell))), origin: null };
    }
    if (!block) { this.host.flash(got.picture ? 'Pictures can\'t go in a cell yet: paste structures, or text from Excel.' : 'There is nothing to paste.'); return; }
    // a block pasted on a larger selection that holds it a whole number of times is repeated (as in Excel)
    const R = v.sel.range;
    const selRows = R.r2 - R.r1 + 1, selCols = R.c2 - R.c1 + 1;
    const timesR = selRows % block.rows === 0 && selRows < MAX_ROWS ? selRows / block.rows : 1;
    const timesC = selCols % block.cols === 0 && selCols < MAX_COLS ? selCols / block.cols : 1;
    const top = timesR > 1 || timesC > 1 ? R.r1 : r, left = timesR > 1 || timesC > 1 ? R.c1 : c;
    const target: Range = { r1: top, c1: left, r2: top + block.rows * timesR - 1, c2: left + block.cols * timesC - 1 };
    const cut = fromClip && this.clip!.cut && this.clip!.sheet === s ? this.clip!.range : null;
    const b = block;
    this.edit(cut ? 'Move' : 'Paste', (sh) => {
      if (cut) {
        // moving: the old place is emptied first (where it doesn't overlap the new one)
        sh.move(cut, { row: top, col: left }, what);
        return;
      }
      for (let i = 0; i < timesR; i++) for (let j = 0; j < timesC; j++) sh.paste({ row: top + i * b.rows, col: left + j * b.cols }, b, what);
    }, () => target);
    if (cut) { this.clip = null; v.copied = null; }
    v.select(target, { r: top, c: left }, { r: top, c: left });
  }

  /** Copy as SMILES: the structures in the selection, one per line. */
  async copySmiles(): Promise<string | null> {
    const v = this.view;
    const s = v.sheet;
    if (!s) return null;
    const R = s.clip(v.sel.range);
    if (!R) return null;
    const out: string[] = [];
    let busy = false;
    for (const k of s.keysIn(R)) {
      const st = s.cells.get(k)?.structure;
      if (!st) continue;
      const p = this.chem.structure(st);
      if (isError(p)) { busy ||= (p as CellError).code === '#BUSY!'; continue; }
      out.push((p as MolProps).smiles);
    }
    if (busy) {
      await this.chem.settled();
      return this.copySmiles();
    }
    return out.length ? out.join('\n') : null;
  }

  // ---------------------------------------------------------------- undo

  /** The name of the step Undo (or Redo) would take back: null with none, '' when it has no name. */
  history(redo = false): string | null {
    const wb = this.book;
    if (!wb || !(redo ? wb.canRedo() : wb.canUndo())) return null;
    return redo ? wb.redoLabel : wb.undoLabel;
  }

  undo(): void {
    const wb = this.book;
    if (!wb) return;
    this.view.cancelEdit();
    const p = wb.undo();
    if (!p) { this.host.flash('Nothing to undo.'); return; }
    this.showPlace(p);
  }

  redo(): void {
    const wb = this.book;
    if (!wb) return;
    this.view.cancelEdit();
    const p = wb.redo();
    if (!p) { this.host.flash('Nothing to redo.'); return; }
    this.showPlace(p);
  }

  private showPlace(p: { sheet: Sheet; sel: Range }): void {
    const wb = this.book!;
    const i = wb.sheets.indexOf(p.sheet);
    if (i >= 0 && i !== wb.active) this.view.goSheet(i);
    this.view.refresh();
    if (i >= 0) this.view.select(p.sel, { r: p.sel.r1, c: p.sel.c1 });
  }

  selectAll(): void {
    this.view.selectAll();
  }

  // ---------------------------------------------------------------- right-click menu

  private contextMenu(x: number, y: number, where: 'cell' | 'row' | 'col'): void {
    const v = this.view;
    const s = v.sheet!;
    const R = v.sel.range;
    const overrides = s.keysIn(R).some((k) => s.isOverride(rowOf(k), colOf(k)));
    const structure = !!s.cell(v.sel.active.r, v.sel.active.c)?.structure;
    const items: ([string, () => void, boolean?] | null)[] = [
      ['Cut', () => void this.copy(true)],
      ['Copy', () => void this.copy()],
      ['Paste', () => void this.paste(null)],
      ['Paste Values', () => void this.paste(null, 'values')],
      null,
    ];
    if (where === 'row') {
      items.push(['Insert rows above', () => this.insertCells('row')], ['Delete rows', () => this.deleteCells('row')],
        ['Hide rows', () => this.hide('row', true)], ['Show hidden rows', () => this.hide('row', false)],
        ['Row height…', () => void this.askSize('row')], ['Fit height to contents', () => { for (let r = R.r1; r <= Math.min(R.r2, s.lastRow + 1); r++) v.autoFit('row', r); }]);
    } else if (where === 'col') {
      items.push(['Insert columns to the left', () => this.insertCells('col')], ['Delete columns', () => this.deleteCells('col')],
        ['Hide columns', () => this.hide('col', true)], ['Show hidden columns', () => this.hide('col', false)],
        ['Column width…', () => void this.askSize('col')], ['Fit width to contents', () => { for (let c = R.c1; c <= Math.min(R.c2, s.lastCol + 1); c++) v.autoFit('col', c); }]);
      if (s.colDefs.has(R.c1)) items.push(['Change the column\'s formula…', () => void this.editColumnFormula(R.c1)], ['Stop calculating this column (keep the values)', () => this.freezeColumn(R.c1)]);
    } else {
      items.push(['Insert…', () => this.insertCells()], ['Delete…', () => this.deleteCells()], ['Clear contents', () => v.clearSelection()]);
      // notes and comments, as Excel's right-click menu has them
      const note = s.noteAt(v.sel.active.r, v.sel.active.c);
      items.push(null);
      if (!note) items.push(['New Comment', () => void this.notes.newComment()], ['New Note', () => void this.notes.newNote()]);
      else if (note.kind === 'comment') items.push(['Show Comment', () => this.notes.edit()], ['Delete Comment', () => this.notes.remove()]);
      else items.push(['Edit Note', () => this.notes.edit()], ['Delete Note', () => this.notes.remove()], [note.shown ? 'Hide Note' : 'Show Note', () => this.notes.toggleShown()]);
      items.push(['Pick From Drop-down List…', () => v.openDropDown()]);
      // links, as Excel's right-click menu has them
      const link = v.linkOf(v.sel.active.r, v.sel.active.c);
      items.push(null);
      if (link) items.push(['Edit Link…', () => void this.run('insert-link')], ['Open Link', () => void followLink(link)], ['Copy Link', () => void navigator.clipboard?.writeText(link).catch(() => {})], ['Remove Link', () => this.run('remove-link')]);
      else items.push(['Link…', () => void this.run('insert-link')]);
    }
    items.push(null,
      ['Sort smallest to largest', () => void this.sort(false)],
      ['Sort largest to smallest', () => void this.sort(true)],
      [s.filter ? 'Filter off' : 'Filter', () => this.toggleFilter()],
      null,
      [structure ? 'Change structure…' : 'Draw structure…', () => this.drawStructure(v.sel.active.r, v.sel.active.c)],
      ['Structure from name or SMILES…', () => void this.structureFromName()],
      ['Insert property columns…', () => void this.propertyColumns()],
      ['Isotope pattern…', () => void this.isotopePattern()],
      ['Reset to calculated', () => this.resetCalculated(), overrides],
      null,
      ['Conditional Formatting ▸', () => this.formatting.conditionalMenu(x, y)],
      ['Data Validation…', () => this.validation.dialog()],
    );
    const table = this.tableHere();
    if (table) {
      items.push(
        ['Table Style ▸', () => this.formatting.tableMenu(x, y, (style) => this.formatting.setTable(table, { style }, 'Table style'))],
        [table.totals ? 'Remove the totals row' : 'Add a totals row', () => this.formatting.toggleTotals(table)],
        ['Convert table to range', () => this.formatting.convertToRange(table)],
      );
    } else items.push(['Format as Table ▸', () => this.formatting.tableMenu(x, y)]);
    popupMenu(x, y, items);
  }

  private async askSize(kind: 'row' | 'col'): Promise<void> {
    const v = this.view;
    const R = v.sel.range;
    const cur = kind === 'row' ? v.rowHeight(R.r1) : v.colWidth(R.c1);
    const ans = await ask(kind === 'row' ? 'Row height' : 'Column width', [{ name: 'px', label: kind === 'row' ? 'Height' : 'Width', value: String(Math.round(cur)), type: 'number', unit: 'pixels' }]);
    const n = Number(ans?.px);
    if (!ans || !Number.isFinite(n) || n < 0) return;
    const s = v.sheet!;
    this.edit(kind === 'row' ? 'Row height' : 'Column width', (sh) => {
      if (kind === 'row') for (let r = R.r1; r <= Math.min(R.r2, s.lastRow + 1); r++) sh.setRowHeight(r, Math.min(2000, n));
      else for (let c = R.c1; c <= Math.min(R.c2, s.lastCol + 1); c++) sh.setColWidth(c, Math.min(2000, n));
    });
    v.focus();
  }

  /** Change the formula a property column works out (the override for a whole column). */
  private async editColumnFormula(col: number): Promise<void> {
    const s = this.view.sheet!;
    const d = s.colDefs.get(col);
    if (!d) return;
    const ans = await ask(`Formula for column ${colName(col)}`, [{ name: 'f', label: `Row ${d.firstRow + 1}`, value: d.formula }], {
      note: 'Each row below gets the same formula, moved down a row at a time. Cells typed over keep their own values.',
    });
    const f = ans?.f.trim();
    if (!f) return;
    const formula = f.startsWith('=') ? f : `=${f}`;
    const problem = this.book!.formulaProblem(formula);
    if (problem) { this.host.flash(`That formula can't be read: ${problem}`, 8000); return; }
    this.edit('Column formula', (sh) => sh.setColDef(col, { ...d, formula }));
  }

  /** A property column becomes plain values (as they show now). */
  private freezeColumn(col: number): void {
    const s = this.view.sheet!;
    const d = s.colDefs.get(col);
    if (!d) return;
    this.edit('Keep values', (sh) => {
      for (let r = d.firstRow; r <= s.lastDataRow; r++) {
        const val = sh.values.get(keyOf(r, col));
        const cell = sh.cell(r, col);
        if (sh.isOverride(r, col)) continue;
        const input = val === undefined || val === null || isError(val) ? undefined : plainText(val);
        sh.setCell(r, col, { ...cell, input: input && typeof val === 'string' && /^[=+\-@]/.test(input) ? `'${input}` : input });
      }
      sh.setColDef(col, undefined);
    });
  }

  // ---------------------------------------------------------------- the side panel and ribbon state

  private selectionChanged(): void {
    this.showActive();
    this.schedulePanel();
  }

  private schedulePanel(): void {
    if (this.panelQueued) return;
    this.panelQueued = true;
    requestAnimationFrame(() => {
      this.panelQueued = false;
      this.renderPanel();
      this.showRibbonState();
    });
  }

  /** On a dashboard sheet the ribbon shows the Dashboard tab (and Chart while a chart tile is picked)
   *  instead of the cell tabs, and the formula bar hides. True when the sheet is a dashboard. */
  private dashRibbon(s: Sheet): boolean {
    const tab = (n: string) => this.ribbon.querySelector<HTMLButtonElement>(`[data-sh-tab=${n}]`)!;
    const selected = this.ribbon.querySelector<HTMLButtonElement>('[data-sh-tab][aria-selected=true]')?.dataset.shTab;
    const on = !!s.dashboard;
    document.querySelector<HTMLElement>('#formula-bar')!.hidden = on;
    tab('home').hidden = on;
    tab('dashboard').hidden = !on;
    if (!on) {
      if (selected === 'dashboard') this.showRibbonTab('home');
      this.dashShown = null;
      return false;
    }
    tab('table').hidden = true;
    const t = this.view.dash.pickedTile;
    const chart = t?.kind === 'chart';
    tab('chart').hidden = !chart;
    if (this.dashShown !== s || selected === 'home' || selected === 'table' || (selected === 'chart' && !chart)) this.showRibbonTab('dashboard');
    if (chart && this.chartShown !== t.id) this.showRibbonTab('chart');
    this.chartShown = chart ? t.id : null;
    this.dashShown = s;
    return true;
  }

  /** The ribbon shows the active cell's look (Bold pressed, its number format…). */
  private showRibbonState(): void {
    const s = this.view.sheet;
    if (!s) return;
    if (this.dashRibbon(s)) return;
    const { r, c } = this.view.sel.active;
    const st = s.styleAt(r, c) ?? {};
    const press = (name: string, on: boolean) => this.ribbon.querySelector(`[data-sh="${name}"]`)?.setAttribute('aria-pressed', String(on));
    press('cell-bold', !!st.bold);
    press('cell-italic', !!st.italic);
    press('cell-underline', !!st.underline);
    press('align-left', st.align === 'left');
    press('align-center', st.align === 'center');
    press('align-right', st.align === 'right');
    press('wrap', !!st.wrap);
    press('format-chem', this.chemShown());
    press('filter', !!s.filter);
    press('freeze-header', s.frozen.rows > 0);
    press('merge-cells', !!s.mergeAt(r, c));
    press('show-all-notes', this.notes.showAll);
    press('circle-invalid', this.view.circleInvalid);
    press('show-page-breaks', this.view.showPageBreaks);
    press('print-gridlines', !!s.pageSetup?.gridlines);
    press('print-headings', !!s.pageSetup?.headings);
    const note = s.noteAt(r, c);
    press('show-note', !!note?.shown);
    for (const [name, on] of [['edit-note', note?.kind === 'note'], ['show-note', note?.kind === 'note'], ['delete-note', !!note]] as const) {
      const b = this.ribbon.querySelector<HTMLButtonElement>(`[data-sh="${name}"]`);
      if (b) b.disabled = !on;
    }
    for (const m of document.querySelectorAll('[role="menuitemcheckbox"][data-cmd="show-all-notes"]')) m.setAttribute('aria-checked', String(this.notes.showAll));
    for (const m of document.querySelectorAll('[role="menuitemcheckbox"][data-cmd="circle-invalid"]')) m.setAttribute('aria-checked', String(this.view.circleInvalid));
    for (const m of document.querySelectorAll('[role="menuitemcheckbox"][data-cmd="show-page-breaks"]')) m.setAttribute('aria-checked', String(this.view.showPageBreaks));
    const fmt = this.ribbon.querySelector<HTMLSelectElement>('#sh-numfmt')!;
    const code = st.numFmt ?? 'General';
    let opt = [...fmt.options].find((o) => o.value === code);
    if (!opt) {
      opt = [...fmt.options].find((o) => o.value === 'custom')!;
      opt.text = describeFormat(code);
    } else fmt.querySelector<HTMLOptionElement>('option[value=custom]')!.text = 'Other…';
    fmt.value = opt.value;
    const size = this.ribbon.querySelector<HTMLSelectElement>('#sh-size')!;
    const want = String(st.size ?? 11);
    if (![...size.options].some((o) => o.value === want)) size.add(new Option(want, want));
    size.value = want;
    const sw = (sel: string, colour: string | undefined, fallback: string) => {
      const el = this.ribbon.querySelector<HTMLElement>(sel);
      if (el) el.style.background = colour ?? fallback;
    };
    sw('[data-sh=text-colour] .sw', st.color, '#000000');
    sw('[data-sh=fill-colour] .sw', st.fill, 'transparent');
    // the Chart tab shows while a chart is picked, and comes to the front when one is first picked
    const chart = this.view.selectedChart;
    const ctab = this.ribbon.querySelector<HTMLButtonElement>('[data-sh-tab=chart]')!;
    if (!chart && ctab.getAttribute('aria-selected') === 'true') this.showRibbonTab('insert');
    ctab.hidden = !chart;
    if (chart && chart.id !== this.chartShown) this.showRibbonTab('chart');
    this.chartShown = chart?.id ?? null;
    // Table Design shows while the active cell is in a table
    const t = chart ? undefined : s.tableAt(r, c);
    const tab = this.ribbon.querySelector<HTMLButtonElement>('[data-sh-tab=table]')!;
    if (!t && tab.getAttribute('aria-selected') === 'true') this.showRibbonTab('home');
    tab.hidden = !t;
    if (t) {
      for (const box of this.ribbon.querySelectorAll<HTMLInputElement>('[data-table-opt]')) box.checked = !!t[box.dataset.tableOpt as keyof TableDef];
      const name = this.ribbon.querySelector<HTMLInputElement>('#sh-table-name')!;
      if (document.activeElement !== name) name.value = t.name;
      this.ribbon.querySelector<HTMLInputElement>('#sh-table-header')!.value = t.custom?.header ?? '#4472c4';
      this.ribbon.querySelector<HTMLInputElement>('#sh-table-band')!.value = t.custom?.band ?? '#d9e1f2';
    }
  }

  /** The panel on the right: what the active cell holds, how its value is worked out, and its format. */
  renderPanel(): void {
    const s = this.view.sheet;
    const wb = this.book;
    const p = this.panel;
    if (!s || !wb) { p.replaceChildren(); return; }
    if (s.dashboard) {
      const t = this.view.dash.pickedTile;
      if (t?.kind !== 'chart') this.dashUi.bindChart(null);
      // keep the panel while one of its boxes is being typed in
      const key = JSON.stringify([t?.id ?? null, s.dashboard]);
      if (p.contains(document.activeElement) && p.dataset.dash === key) return;
      delete p.dataset.chart;
      p.dataset.dash = key;
      this.panelTitle.textContent = t ? `Dashboard: ${TILE_NAMES[t.kind]}` : 'Dashboard';
      p.replaceChildren(...this.dashUi.panel());
      return;
    }
    delete p.dataset.dash;
    this.dashUi.bindChart(null);
    const chart = this.view.selectedChart;
    if (chart) {
      // keep the panel while one of its boxes is being typed in
      if (p.contains(document.activeElement) && p.dataset.chart === String(chart.id) && p.dataset.chartKey === JSON.stringify(chart)) return;
      this.panelTitle.textContent = 'Chart';
      p.dataset.chart = String(chart.id);
      p.dataset.chartKey = JSON.stringify(chart);
      p.replaceChildren(...this.charts.panel(chart));
      return;
    }
    delete p.dataset.chart;
    const obj = this.view.selectedObject;
    if (obj) {
      const key = JSON.stringify({ ...obj, src: undefined });
      if (p.dataset.object === key) return;
      p.dataset.object = key;
      this.panelTitle.textContent = obj.kind === 'picture' ? 'Picture' : obj.kind === 'text' ? 'Text Box' : 'Shape';
      p.replaceChildren(...this.objects.panel(obj));
      return;
    }
    delete p.dataset.object;
    const { r, c } = this.view.sel.active;
    this.panelTitle.textContent = cellName(r, c);
    const cell = s.cell(r, c);
    const k = keyOf(r, c);
    const v = s.values.get(k);
    const def = s.defAt(r, c);
    const parts: HTMLElement[] = [];
    const para = (text: string, cls = '') => Object.assign(document.createElement('p'), { textContent: text, className: cls });
    const button = (label: string, fn: () => void, title = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (title) b.title = title;
      b.addEventListener('click', fn);
      return b;
    };
    const rowOfButtons = (...bs: HTMLElement[]) => { const d = document.createElement('div'); d.className = 'cp-buttons'; d.append(...bs); return d; };
    if (cell?.structure) {
      parts.push(para('A drawn structure.'), rowOfButtons(
        button('Change…', () => this.drawStructure(r, c), 'Open the drawing tools on it (or double-click the cell)'),
        button('Add property columns…', () => void this.propertyColumns(), 'Columns of formula, MW, HRMS m/z… worked out for every structure in this column'),
      ));
      parts.push(this.structureTable(cell.structure, c));
    } else if (def) {
      const own = s.isOverride(r, c);
      const shifted = s.effectiveInput(r, c);
      if (own) {
        parts.push(para(`Typed over the calculated value. The column works out ${defFormula(s, r, c)}.`, 'cp-note'), rowOfButtons(button('Reset to calculated', () => this.resetCalculated())));
      } else {
        parts.push(para(`Worked out by the column: ${shifted}`), para('Type in the cell to put your own value instead.', 'muted'));
      }
      parts.push(rowOfButtons(button('Change the column\'s formula…', () => void this.editColumnFormula(c))));
    } else if (cell?.input?.startsWith('=')) {
      parts.push(para('A formula:'), Object.assign(document.createElement('code'), { textContent: cell.input, className: 'cp-formula' }));
    } else if (cell?.input) {
      parts.push(para(typeof v === 'number' ? 'A number.' : typeof v === 'boolean' ? 'TRUE or FALSE.' : 'Text.'));
    } else {
      parts.push(para('Empty. Type, paste, or draw a structure here (Chemistry > Structure).', 'muted'));
    }
    if (isError(v)) {
      const f = s.formulas.get(k);
      const problem = f ? wb.formulaProblem(f) : null;
      const e = v as CellError;
      parts.push(para(`${e.code === '#BUSY!' ? 'Being worked out…' : `${e.code}: ${problem ?? e.detail}`}`, e.code === '#BUSY!' ? 'muted' : 'cp-error'));
    } else if (v !== undefined && v !== null && (cell?.input?.startsWith('=') || def)) {
      parts.push(para(`Value: ${plainText(v)}`, 'cp-value'));
    }
    // a note or comment, and a data validation rule: a line each, only where there is one
    const note = s.noteAt(r, c);
    if (note) {
      const replies = note.replies?.length ? ` (${note.replies.length} ${note.replies.length === 1 ? 'reply' : 'replies'})` : '';
      const line = para(`${note.kind === 'comment' ? 'Comment' : 'Note'}${note.author ? ` by ${note.author}` : ''}${replies}${note.done ? ', resolved' : ''}: ${note.text}`, 'cp-note-line');
      parts.push(line, rowOfButtons(button(note.kind === 'comment' ? 'Open' : 'Edit', () => this.notes.edit(), 'Show its card beside the cell'), button('Delete', () => this.notes.remove())));
    }
    const rule = s.validationAt(r, c);
    if (rule) {
      parts.push(para(`${KIND_NAMES[rule.kind]} rule: takes ${describeValidation(rule)}.`, 'muted small'), rowOfButtons(button('Data Validation…', () => this.validation.dialog())));
    }
    // the number format: always editable here (Ctrl+1)
    const st = s.styleAt(r, c);
    const fmtRow = document.createElement('label');
    fmtRow.className = 'cp-row';
    const fmt = document.createElement('input');
    fmt.className = 'cp-format';
    fmt.value = st?.numFmt ?? 'General';
    fmt.spellcheck = false;
    fmt.title = 'An Excel number format: 0.00, 0.0%, 0.00E+00, #,##0, or a number with a unit such as 0.0" mg/mL" (General for none)';
    fmt.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        const code = fmt.value.trim();
        this.style('Number format', { numFmt: !code || /^general$/i.test(code) ? undefined : code });
        this.view.focus();
      } else if (e.key === 'Escape') { e.preventDefault(); this.view.focus(); }
    });
    fmtRow.append(Object.assign(document.createElement('span'), { textContent: 'Format' }), fmt);
    parts.push(fmtRow, para(describeFormat(st?.numFmt), 'muted small'));
    p.replaceChildren(...parts);
  }

  /** A structure's properties, each with a button to add it as a column. */
  private structureTable(st: Structure, col: number): HTMLElement {
    const box = document.createElement('div');
    const got = this.chem.structure(st);
    if (isError(got)) {
      box.append(Object.assign(document.createElement('p'), { textContent: (got as CellError).code === '#BUSY!' ? 'Working out its properties…' : (got as CellError).detail, className: 'muted' }));
      return box;
    }
    const m = got as MolProps;
    const table = document.createElement('table');
    table.className = 'cp-props';
    const add = (name: string, value: string, adduct?: string) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = name === 'HRMS' ? `${adduct} m/z` : PROPERTIES[name].label;
      const td = document.createElement('td');
      td.textContent = value;
      const act = document.createElement('td');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cp-add';
      b.textContent = '+';
      b.title = `Add a column of ${th.textContent} for every structure in column ${colName(col)}`;
      b.setAttribute('aria-label', b.title);
      b.addEventListener('click', () => void this.propertyColumns({ col, props: [{ name, adduct }] }));
      act.append(b);
      tr.append(th, td, act);
      table.append(tr);
    };
    const num = (x: number, d: number) => x.toFixed(d);
    add('FORMULA', m.formula);
    add('MW', num(m.mw, 2));
    add('EXACTMASS', num(m.exact, 4));
    for (const a of ['[M+H]+', '[M+Na]+']) add('HRMS', num(propertyValue('HRMS', m, [a]) as number, 4), a);
    add('CLOGP', num(m.clogp, 2));
    add('TPSA', num(m.tpsa, 1));
    add('HBD', String(m.hbd));
    add('HBA', String(m.hba));
    add('ROTB', String(m.rotb));
    add('SMILES', m.smiles);
    add('INCHIKEY', m.inchikey);
    box.append(table);
    return box;
  }
}

/** The formula a property column gives a row (for the panel). */
function defFormula(s: Sheet, r: number, c: number): string {
  const d = s.colDefs.get(c)!;
  return shiftFormula(d.formula, r - d.firstRow, 0);
}

/** A value as plain text (numbers in full). */
function plainText(v: Value): string {
  return typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v === null ? '' : String(v);
}

function rangeSize(R: Range): string {
  return `${R.r2 - R.r1 + 1} × ${R.c2 - R.c1 + 1}`;
}

const normalizeEol = (t: string) => t.replace(/\r\n/g, '\n').replace(/\n+$/, '');

/** Cells read back from our own clipboard copy (structures get ids of their own). */
function reviveBlock(b: CellBlock): CellBlock {
  return {
    ...b,
    cells: b.cells.map((row) => row.map((c) => (c ? { ...c, structure: c.structure ? makeStructure(c.structure.contents) : undefined } : undefined))),
  };
}

