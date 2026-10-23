// PivotTables and PivotCharts, as Excel makes them: Insert > PivotTable asks for the records and
// where the report goes, then the PivotTable Fields window (fields ticked or dragged to Filters,
// Columns, Rows and Values) builds the report as each change is made. The PivotTable tab and the
// right-click menu on a report refresh it, change how its numbers are summed or shown, show the
// records behind a number, chart it, and take it away.

import type { SheetView } from './sheet-view';
import { popupMenu } from './sheet-view';
import { ToolWindow, absText } from './tool-window';
import { ask } from './ask';
import type { Sheet, Workbook } from '../sheet/workbook';
import { valueInput } from '../sheet/workbook';
import { rangeName } from '../sheet/refs';
import { readRef, newChartId, type Chart } from '../sheet/chart';
import type { Value } from '../sheet/values';
import {
  type PivotTable, type PivotFn, type ShowAs, type PivotLayout, type PivotValueField, type PivotSource,
  PIVOT_FN_LABELS, SHOW_AS_LABELS, newPivotId, newPivotName, valueCaption, fieldItems, detailRecords, pivotChartSeries,
} from '../sheet/pivot';
import { readSource, reportOf, reportRange, placeProblem, wouldCover, writePivot, removePivot, pivotAt, sourceText, sourceRange } from '../sheet/pivot-sheet';

export interface PivotUiHost {
  readonly view: SheetView;
  flash(msg: string, ms?: number): void;
}

type Area = 'filters' | 'cols' | 'rows' | 'values';
const AREA_NAMES: Record<Area, string> = { filters: 'Filters', cols: 'Columns', rows: 'Rows', values: 'Values' };
const LAYOUT_NAMES: Record<PivotLayout, string> = { compact: 'Compact Form', outline: 'Outline Form', tabular: 'Tabular Form' };

export class SheetPivots {
  /** The PivotTable the Fields window is open on: its sheet and id. */
  private fieldsOf: { sheet: Sheet; id: number } | null = null;
  private fieldsWin: ToolWindow | null = null;

  constructor(private host: PivotUiHost) {}

  private get view(): SheetView {
    return this.host.view;
  }

  private get wb(): Workbook {
    return this.host.view.wb!;
  }

  /** The PivotTable under the active cell. */
  here(): PivotTable | undefined {
    const s = this.view.sheet;
    return s ? pivotAt(s, this.view.sel.active.r, this.view.sel.active.c) : undefined;
  }

  /** The active cell moved: the Fields window follows it onto another PivotTable. */
  selectionChanged(): void {
    const pt = this.here();
    if (pt && this.fieldsWin && ToolWindow.open === this.fieldsWin && pt.id !== this.fieldsOf?.id) this.fieldsWindow();
  }

  // ---------------------------------------------------------------- changing a PivotTable

  /** The PivotTable as kept now (undo may have changed it). */
  private current(): { sheet: Sheet; pt: PivotTable } | null {
    const f = this.fieldsOf;
    if (!f) return null;
    const pt = f.sheet.pivots.find((p) => p.id === f.id);
    return pt && this.wb.sheets.includes(f.sheet) ? { sheet: f.sheet, pt } : null;
  }

  /**
   * Write a PivotTable again with a change made to it, as one undoable step. Asks before the
   * report grows over cells in use, and refuses when it would run into another PivotTable.
   */
  private async apply(s: Sheet, pt: PivotTable, label: string, quiet = false): Promise<boolean> {
    const rep = reportOf(this.wb, s, pt);
    if (typeof rep === 'string') { this.host.flash(rep, 6000); return false; }
    const R = reportRange(pt, rep);
    const problem = placeProblem(s, pt, R);
    if (problem) { this.host.flash(problem, 6000); return false; }
    if (wouldCover(s, pt, R) && !quiet) {
      const ok = await ask('Replace the cells?', [], { ok: 'Replace', note: `The PivotTable report would cover cells that have something in them (${rangeName(R)}). Replace what is there?` });
      if (!ok) return false;
    }
    this.view.commitEdit();
    this.wb.edit(label, () => writePivot(s, pt), this.view.place());
    this.view.refresh();
    if (this.fieldsWin && ToolWindow.open === this.fieldsWin && this.fieldsOf?.id === pt.id) this.renderFields();
    return true;
  }

  private change(label: string, fn: (pt: PivotTable) => PivotTable): void {
    const c = this.current();
    if (c) void this.apply(c.sheet, fn(c.pt), label);
  }

  // ---------------------------------------------------------------- Insert PivotTable

  /** Insert > PivotTable: the records, and where the report goes. With chart, a PivotChart too. */
  insertWindow(chart = false): void {
    const s = this.view.sheet;
    if (!s || s.dashboard) return;
    const pt = this.here();
    if (pt && chart) { this.insertChart(s, pt); return; }
    const { r, c } = this.view.sel.active;
    const R = this.view.sel.range;
    const table = s.tableAt(r, c);
    const block = R.r1 !== R.r2 || R.c1 !== R.c2 ? (s.clip(R) ?? R) : s.currentRegion(r, c);
    const w = new ToolWindow(chart ? 'Create PivotChart' : 'Create PivotTable');
    w.home = s.name;
    w.note('Choose the data that you want to analyze');
    const src = w.ref('Table/Range:', table ? table.name : s.value(block.r1, block.c1) === null && block.r1 === block.r2 ? '' : absText(block, null));
    const g = w.group(`Choose where you want the ${chart ? 'PivotChart' : 'PivotTable'} to be placed`);
    const where = w.radios('pivot-where', [['new', 'New Worksheet'], ['here', 'Existing Worksheet']], 'new', g);
    const loc = w.ref('Location:', '', g);
    loc.addEventListener('input', () => { where.inputs[1].checked = true; });
    loc.addEventListener('focus', () => { where.inputs[1].checked = true; });
    w.actions('OK', async () => {
      const home = this.wb.sheetNamed(w.home ?? '') ?? s;
      const text = src.value.trim();
      if (!text) return 'Give the table or range of records.';
      const at = sourceRange(this.wb, text, home);
      if (typeof at === 'string') return 'The reference is not valid: give a block of cells with a header row, or a table\'s name.';
      const source = /^[A-Za-z_\\][\w.]*$/.test(text) && !readRef(this.wb, text, home) ? text : sourceText(at.sheet, at.range);
      const used = this.wb.sheets.flatMap((x) => x.pivots.map((p) => p.name));
      const fresh: PivotTable = {
        id: newPivotId(), name: newPivotName(used), source, at: { row: 2, col: 0 },
        rows: [], cols: [], values: [], filters: [], hidden: {}, layout: 'compact', subtotals: true, grandRows: true, grandCols: true,
      };
      const recs = readSource(this.wb, fresh, home);
      if (typeof recs === 'string') return recs;
      let sheet: Sheet;
      if (where.get() === 'here') {
        const l = readRef(this.wb, loc.value, home);
        if (!l) return 'Give the cell where the report starts.';
        sheet = l.sheet;
        fresh.at = { row: l.range.r1, col: l.range.c1 };
        const rep = reportOf(this.wb, sheet, fresh);
        if (typeof rep === 'string') return rep;
        const problem = placeProblem(sheet, fresh, reportRange(fresh, rep));
        if (problem) return problem;
        if (wouldCover(sheet, fresh, reportRange(fresh, rep))) return 'The PivotTable would go over cells that have something in them: pick an empty place.';
        this.view.commitEdit();
        this.wb.edit('Insert PivotTable', () => { writePivot(sheet, fresh); if (chart) this.addChart(sheet, fresh); }, this.view.place());
      } else {
        this.view.commitEdit();
        // Excel puts the new sheet before the one with the records
        this.wb.edit('Insert PivotTable', () => {
          sheet = this.wb.addSheet(this.wb.newSheetName(), this.wb.sheets.indexOf(home));
          writePivot(sheet, fresh);
          if (chart) this.addChart(sheet, fresh);
        }, this.view.place());
      }
      this.view.goSheet(this.wb.sheets.indexOf(sheet!));
      this.view.select({ r1: fresh.at.row, c1: fresh.at.col, r2: fresh.at.row, c2: fresh.at.col });
      this.view.refresh();
      setTimeout(() => this.fieldsWindow(sheet, fresh.id));
      return null;
    });
    w.show();
  }

  // ---------------------------------------------------------------- PivotCharts

  /** A PivotChart of a report, beside it (inside an edit). */
  private addChart(s: Sheet, pt: PivotTable): Chart | null {
    const kept = s.pivots.find((p) => p.id === pt.id) ?? pt;
    const rep = reportOf(this.wb, s, kept);
    const series = typeof rep === 'string' ? [] : pivotChartSeries(rep, kept.at, s.name, kept);
    const R = kept.last ?? { r1: kept.at.row, c1: kept.at.col, r2: kept.at.row, c2: kept.at.col + 2 };
    const chart: Chart = {
      id: newChartId(), kind: 'column', title: kept.values.length === 1 ? valueCaption(kept.values[0]) : '', series,
      x: { grid: false }, y: { grid: true }, legend: 'right', pivot: kept.id,
      at: { row: R.r1, col: R.c2 + 2, dx: 0, dy: 0 }, w: 460, h: 280,
    };
    s.setCharts([...s.charts, chart]);
    return chart;
  }

  private insertChart(s: Sheet, pt: PivotTable): void {
    this.view.commitEdit();
    this.wb.edit('Insert PivotChart', () => this.addChart(s, pt), this.view.place());
    this.view.refresh();
    this.host.flash('The PivotChart follows the PivotTable: change the fields, or refresh, and it changes too.');
  }

  /** PivotChart on the PivotTable tab. */
  pivotChart(): void {
    const s = this.view.sheet, pt = this.here();
    if (!s) return;
    if (pt) this.insertChart(s, pt);
    else this.insertWindow(true);
  }

  // ---------------------------------------------------------------- refreshing

  /** Refresh the PivotTable under the active cell (from its source as it is now). */
  refresh(): void {
    const s = this.view.sheet, pt = this.here();
    if (!s || !pt) { this.host.flash('Click in a PivotTable to refresh it.'); return; }
    void this.apply(s, pt, 'Refresh PivotTable');
  }

  /** Refresh All: every PivotTable in the workbook, as one step. With `quiet`, what happened is returned rather than shown. */
  refreshAll(quiet = false): { count: number; problems: string[] } {
    const wb = this.view.wb;
    if (!wb) return { count: 0, problems: [] };
    const all = wb.sheets.flatMap((s) => s.pivots.map((pt) => ({ s, pt })));
    if (!all.length) {
      if (!quiet) this.host.flash('There are no PivotTables or queries in this workbook to refresh (data tables recalculate by themselves).');
      return { count: 0, problems: [] };
    }
    const problems: string[] = [];
    this.view.commitEdit();
    wb.edit('Refresh All', () => {
      for (const { s, pt } of all) {
        const rep = reportOf(wb, s, pt);
        if (typeof rep === 'string') { problems.push(`${pt.name}: ${rep}`); continue; }
        const p = placeProblem(s, pt, reportRange(pt, rep));
        if (p) { problems.push(`${pt.name}: ${p}`); continue; }
        writePivot(s, pt);
      }
    }, this.view.place());
    this.view.refresh();
    if (!quiet) this.host.flash(problems.length ? problems.join(' ') : `Refreshed ${all.length} PivotTable${all.length > 1 ? 's' : ''}.`, problems.length ? 8000 : 2500);
    return { count: all.length, problems };
  }

  // ---------------------------------------------------------------- the Fields window

  /** The PivotTable Fields window, on the PivotTable under the active cell (or one named). */
  fieldsWindow(sheet?: Sheet, id?: number): void {
    const s = sheet ?? this.view.sheet;
    const pt = id !== undefined ? s?.pivots.find((p) => p.id === id) : this.here();
    if (!s || !pt) { this.host.flash('Click in a PivotTable to show its fields.'); return; }
    this.fieldsOf = { sheet: s, id: pt.id };
    const w = new ToolWindow('PivotTable Fields', 'pivot-fields');
    w.home = s.name;
    this.fieldsWin = w;
    w.onClose = () => { if (this.fieldsWin === w) this.fieldsWin = null; };
    w.button('Close', () => w.close(), 'primary');
    this.renderFields();
    w.show();
  }

  private renderFields(): void {
    const w = this.fieldsWin, c = this.current();
    if (!w) return;
    w.body.replaceChildren();
    if (!c) { w.note('The PivotTable has gone.'); return; }
    const { sheet, pt } = c;
    const src = readSource(this.wb, pt, sheet);
    w.note(`${pt.name} · records from ${pt.source.replace(/^=/, '')}`);
    if (typeof src === 'string') { w.note(src, 'tool-error'); return; }
    const used = new Set([...pt.rows, ...pt.cols, ...pt.filters, ...pt.values.map((v) => v.field)]);
    // the fields: ticking one puts numbers in Values and anything else in Rows, as Excel does
    w.note('Choose fields to add to report (or drag them to an area below):');
    const list = document.createElement('div');
    list.className = 'pivot-field-list';
    for (const f of src.fields) {
      const row = document.createElement('label');
      row.className = 'ask-check pivot-field';
      row.draggable = true;
      row.addEventListener('dragstart', (e) => { e.dataTransfer?.setData('text/x-pivot-field', JSON.stringify({ field: f })); });
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = used.has(f);
      box.addEventListener('change', () => {
        if (box.checked) this.change(`Add ${f}`, (p) => (numeric(src, f) ? { ...p, values: [...p.values, { field: f, fn: 'sum' }] } : { ...p, rows: [...p.rows, f] }));
        else this.change(`Remove ${f}`, (p) => withoutField(p, f));
      });
      const name = document.createElement('span');
      name.textContent = f;
      row.append(box, name);
      if (pt.hidden[f]?.length) row.append(Object.assign(document.createElement('span'), { className: 'muted', textContent: ' (filtered)' }));
      list.append(row);
    }
    w.body.append(list);
    // the four areas
    const areas = document.createElement('div');
    areas.className = 'pivot-areas';
    for (const area of ['filters', 'cols', 'rows', 'values'] as Area[]) areas.append(this.areaBox(area, pt, src));
    w.body.append(areas);
    // layout
    const g = w.group('Layout');
    const layout = w.select('Report layout', (Object.keys(LAYOUT_NAMES) as PivotLayout[]).map((k) => [k, LAYOUT_NAMES[k]]), pt.layout, g);
    layout.addEventListener('change', () => this.change('Report layout', (p) => ({ ...p, layout: layout.value as PivotLayout })));
    const sub = w.check('Subtotals', pt.subtotals, g);
    sub.addEventListener('change', () => this.change('Subtotals', (p) => ({ ...p, subtotals: sub.checked })));
    const gr = w.check('Grand totals for rows (a Grand Total row at the bottom)', pt.grandRows, g);
    gr.addEventListener('change', () => this.change('Grand totals', (p) => ({ ...p, grandRows: gr.checked })));
    const gc = w.check('Grand totals for columns (a Grand Total column at the right)', pt.grandCols, g);
    gc.addEventListener('change', () => this.change('Grand totals', (p) => ({ ...p, grandCols: gc.checked })));
    if (pt.values.length > 1) {
      const vr = w.check('Σ Values down the rows (not across the columns)', !!pt.valuesOnRows, g);
      vr.addEventListener('change', () => this.change('Σ Values', (p) => ({ ...p, valuesOnRows: vr.checked || undefined })));
    }
    const empty = w.text('For empty cells show', pt.emptyText ?? '', g);
    empty.addEventListener('change', () => this.change('Empty cells', (p) => ({ ...p, emptyText: empty.value === '' ? undefined : empty.value })));
    const name = w.text('PivotTable name', pt.name, g);
    name.addEventListener('change', () => {
      const v = name.value.trim();
      if (!v) { name.value = pt.name; return; }
      if (this.wb.sheets.some((x) => x.pivots.some((p) => p.id !== pt.id && p.name.toLowerCase() === v.toLowerCase()))) { this.host.flash('A PivotTable with this name already exists.'); name.value = pt.name; return; }
      this.change('PivotTable name', (p) => ({ ...p, name: v }));
    });
  }

  /** One area of the Fields window: its fields in order, each with a menu, taking dropped fields. */
  private areaBox(area: Area, pt: PivotTable, src: PivotSource): HTMLElement {
    const box = document.createElement('fieldset');
    box.className = 'tw-group pivot-area';
    const legend = document.createElement('legend');
    legend.textContent = area === 'cols' ? 'Columns' : AREA_NAMES[area];
    box.append(legend);
    const names = area === 'values' ? pt.values.map(valueCaption) : pt[area];
    const drop = (e: DragEvent, at: number) => {
      const raw = e.dataTransfer?.getData('text/x-pivot-field');
      if (!raw) return;
      e.preventDefault();
      e.stopPropagation();
      const d = JSON.parse(raw) as { field: string; from?: Area; index?: number };
      this.change(`Move ${d.field}`, (p) => moveField(p, d.field, d.from, d.index, area, at, src));
    };
    box.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('text/x-pivot-field')) e.preventDefault(); });
    box.addEventListener('drop', (e) => drop(e, names.length));
    if (!names.length) {
      const hint = document.createElement('p');
      hint.className = 'muted pivot-empty';
      hint.textContent = 'Drag fields here';
      box.append(hint);
    }
    names.forEach((label, i) => {
      const field = area === 'values' ? pt.values[i].field : label;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'pivot-chip';
      chip.draggable = true;
      chip.textContent = `${label}${area !== 'values' && pt.hidden[field]?.length ? ' ⏷' : ''} ▾`;
      chip.title = area === 'values' ? 'Click: Value Field Settings, move or remove' : 'Click: filter and sort its items, move or remove';
      chip.addEventListener('dragstart', (e) => { e.dataTransfer?.setData('text/x-pivot-field', JSON.stringify({ field, from: area, index: i })); });
      chip.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('text/x-pivot-field')) e.preventDefault(); });
      chip.addEventListener('drop', (e) => drop(e, i));
      chip.addEventListener('click', () => {
        const b = chip.getBoundingClientRect();
        this.chipMenu(b.left, b.bottom + 2, area, i, field, src, names.length);
      });
      box.append(chip);
    });
    return box;
  }

  /** A field's menu in an area: move it, filter or sort its items, its value settings, remove it. */
  private chipMenu(x: number, y: number, area: Area, i: number, field: string, src: PivotSource, count: number): void {
    const move = (to: Area, at?: number) => () => this.change(`Move ${field}`, (p) => moveField(p, field, area, i, to, at ?? Number.MAX_SAFE_INTEGER, src));
    const items: ([string, () => void, boolean?] | null)[] = [
      ['Move Up', move(area, i - 1), i > 0],
      ['Move Down', move(area, i + 2), i < count - 1],
      ['Move to Beginning', move(area, 0), i > 0],
      ['Move to End', move(area), i < count - 1],
      null,
    ];
    for (const to of ['filters', 'rows', 'cols', 'values'] as Area[]) {
      if (to !== area) items.push([`Move to ${to === 'filters' ? 'Report Filter' : to === 'rows' ? 'Row Labels' : to === 'cols' ? 'Column Labels' : 'Values'}`, move(to)]);
    }
    items.push(null);
    if (area === 'values') items.push(['Value Field Settings…', () => void this.valueSettings(i)]);
    else {
      items.push(['Filter Items…', () => void this.filterItems(field, src)]);
      items.push(['Sort A to Z', () => this.change(`Sort ${field}`, (p) => ({ ...p, descending: (p.descending ?? []).filter((f) => f !== field) }))]);
      items.push(['Sort Z to A', () => this.change(`Sort ${field}`, (p) => ({ ...p, descending: [...(p.descending ?? []).filter((f) => f !== field), field] }))]);
    }
    items.push(['Remove Field', () => this.change(`Remove ${field}`, (p) => (area === 'values' ? { ...p, values: p.values.filter((_, k) => k !== i) } : { ...p, [area]: p[area].filter((f) => f !== field) }))]);
    popupMenu(x, y, items);
  }

  /** Tick the items of a field that the report counts (Excel's filter drop-down). */
  private async filterItems(field: string, src: PivotSource): Promise<void> {
    const c = this.current();
    if (!c) return;
    const items = fieldItems(src, field);
    const hid = new Set(c.pt.hidden[field] ?? []);
    if (items.length > 200) { this.host.flash(`${field} has ${items.length} different items: too many to list. Filter the source instead.`); return; }
    const got = await ask(`Filter: ${field}`, items.map((it, k) => ({ name: `i${k}`, label: it.text, value: String(!hid.has(it.text)), type: 'checkbox' as const })), { ok: 'OK', note: 'Untick the items to leave out of the report.' });
    if (!got) return;
    const hidden = items.filter((_, k) => got[`i${k}`] !== 'true').map((it) => it.text);
    if (hidden.length === items.length) { this.host.flash('Keep at least one item ticked.'); return; }
    this.change(`Filter ${field}`, (p) => {
      const h = { ...p.hidden };
      if (hidden.length) h[field] = hidden;
      else delete h[field];
      return { ...p, hidden: h };
    });
  }

  /** Value Field Settings: how a value field sums its records, how it shows them, its name and number format. */
  async valueSettings(i: number): Promise<void> {
    const c = this.current();
    const vf = c?.pt.values[i];
    if (!c || !vf) return;
    const got = await ask('Value Field Settings', [
      { name: 'name', label: 'Custom Name', value: valueCaption(vf) },
      { name: 'fn', label: 'Summarize value field by', value: vf.fn, options: (Object.keys(PIVOT_FN_LABELS) as PivotFn[]).map((k) => ({ value: k, label: PIVOT_FN_LABELS[k] })) },
      { name: 'show', label: 'Show values as', value: vf.showAs ?? 'normal', options: (Object.keys(SHOW_AS_LABELS) as ShowAs[]).map((k) => ({ value: k, label: SHOW_AS_LABELS[k] })) },
      { name: 'fmt', label: 'Number Format', value: vf.numFmt ?? '', placeholder: 'General', suggestions: ['0', '0.0', '0.00', '#,##0', '0%', '0.0%', '0.00E+00'] },
    ], { note: `Source Name: ${vf.field}` });
    if (!got) return;
    const fn = got.fn as PivotFn;
    const auto = valueCaption({ ...vf, name: undefined });
    const next: PivotValueField = { field: vf.field, fn, ...(got.show !== 'normal' ? { showAs: got.show as ShowAs } : {}), ...(got.fmt.trim() ? { numFmt: got.fmt.trim() } : {}) };
    // a caption left as it was follows the new summary ("Sum of" becomes "Average of")
    const name = got.name.trim();
    if (name && name !== auto && name !== valueCaption({ ...next })) next.name = name;
    if (c.sheet.pivots.find((p) => p.id === c.pt.id)?.values.some((v, k) => k !== i && valueCaption(v) === valueCaption(next))) { this.host.flash('That name is already used by another value field.'); return; }
    this.change('Value Field Settings', (p) => ({ ...p, values: p.values.map((v, k) => (k === i ? next : v)) }));
  }

  // ---------------------------------------------------------------- the PivotTable tab and the right-click menu

  /** Point the Fields window (and changes) at the PivotTable under the active cell. */
  private focusHere(): { sheet: Sheet; pt: PivotTable } | null {
    const s = this.view.sheet, pt = this.here();
    if (!s || !pt) return null;
    this.fieldsOf = { sheet: s, id: pt.id };
    return { sheet: s, pt };
  }

  /** Report Layout, Subtotals and Grand Totals menus (the PivotTable tab). */
  layoutMenu(x: number, y: number): void {
    if (!this.focusHere()) return;
    popupMenu(x, y, (Object.keys(LAYOUT_NAMES) as PivotLayout[]).map((k) => [`Show in ${LAYOUT_NAMES[k]}`, () => this.change('Report layout', (p) => ({ ...p, layout: k }))]));
  }

  subtotalsMenu(x: number, y: number): void {
    if (!this.focusHere()) return;
    popupMenu(x, y, [
      ['Do Not Show Subtotals', () => this.change('Subtotals', (p) => ({ ...p, subtotals: false }))],
      ['Show All Subtotals', () => this.change('Subtotals', (p) => ({ ...p, subtotals: true }))],
    ]);
  }

  grandMenu(x: number, y: number): void {
    if (!this.focusHere()) return;
    const set = (r: boolean, c: boolean) => () => this.change('Grand totals', (p) => ({ ...p, grandRows: r, grandCols: c }));
    popupMenu(x, y, [
      ['Off for Rows and Columns', set(false, false)],
      ['On for Rows and Columns', set(true, true)],
      ['On for Rows Only', set(false, true)],
      ['On for Columns Only', set(true, false)],
    ]);
  }

  /** Change Data Source: the records the PivotTable reads. */
  changeSource(): void {
    const c = this.focusHere();
    if (!c) return;
    const w = new ToolWindow('Change PivotTable Data Source');
    w.home = c.sheet.name;
    const src = w.ref('Table/Range:', c.pt.source.replace(/^=/, ''));
    w.actions('OK', () => {
      const text = src.value.trim();
      const at = sourceRange(this.wb, text, c.sheet);
      if (typeof at === 'string') return at;
      const source = readRef(this.wb, text, c.sheet) ? sourceText(at.sheet, at.range) : text;
      const next = { ...c.pt, source };
      const recs = readSource(this.wb, next, c.sheet);
      if (typeof recs === 'string') return recs;
      // fields that went away leave the report
      for (const f of [...next.rows, ...next.cols, ...next.filters, ...next.values.map((v) => v.field)]) if (!recs.fields.includes(f)) Object.assign(next, withoutField(next, f));
      void this.apply(c.sheet, next, 'Change Data Source');
      return null;
    });
    w.show();
  }

  /** Clear All: the PivotTable and its report go (its PivotCharts become ordinary charts). */
  clear(): void {
    const c = this.focusHere();
    if (!c) return;
    this.view.commitEdit();
    this.wb.edit('Clear PivotTable', () => removePivot(c.sheet, c.pt), this.view.place());
    if (this.fieldsWin && this.fieldsOf?.id === c.pt.id) this.fieldsWin.close();
    this.view.refresh();
  }

  /** Select the whole report. */
  selectReport(): void {
    const pt = this.here();
    if (pt?.last) this.view.select(pt.last);
  }

  /** Where a cell sits in its report: which body line and column, and the report. */
  private bodyCell(): { sheet: Sheet; pt: PivotTable; i: number; j: number } | null {
    const c = this.focusHere();
    if (!c) return null;
    const rep = reportOf(this.wb, c.sheet, c.pt);
    if (typeof rep === 'string') return null;
    const i = this.view.sel.active.r - c.pt.at.row - rep.body.row, j = this.view.sel.active.c - c.pt.at.col - rep.body.col;
    if (i < 0 || j < 0 || i >= rep.body.rows || j >= rep.body.cols) return null;
    return { ...c, i, j };
  }

  /** The value field a number in the body belongs to. */
  private valueIndexHere(): number | null {
    const b = this.bodyCell();
    if (!b) return null;
    const rep = reportOf(this.wb, b.sheet, b.pt);
    if (typeof rep === 'string' || !b.pt.values.length) return null;
    return rep.rowLines[b.i]?.value ?? rep.colLines[b.j]?.value ?? 0;
  }

  /** Show Details: the records behind a number, on a new sheet (Excel's double-click on a value). */
  showDetails(): void {
    const b = this.bodyCell();
    if (!b) { this.host.flash('Click a number in the PivotTable to see the records behind it.'); return; }
    const src = readSource(this.wb, b.pt, b.sheet);
    const rep = reportOf(this.wb, b.sheet, b.pt);
    if (typeof src === 'string' || typeof rep === 'string') return;
    const rows = detailRecords(b.pt, src, rep, b.i, b.j);
    if (!rows) return;
    this.view.commitEdit();
    let sheet: Sheet;
    this.wb.edit('Show Details', () => {
      sheet = this.wb.addSheet(this.wb.newSheetName(), this.wb.sheets.indexOf(b.sheet));
      rows.forEach((row, r) => row.forEach((v: Value, c) => {
        const input = v === null ? undefined : valueInput(v);
        if (input || r === 0) sheet.setCell(r, c, { input: input || undefined, style: r === 0 ? { bold: true, fill: '#dde6f4' } : undefined });
      }));
    }, this.view.place());
    this.view.goSheet(this.wb.sheets.indexOf(sheet!));
    this.view.select({ r1: 0, c1: 0, r2: rows.length - 1, c2: rows[0].length - 1 });
    this.view.refresh();
  }

  /** Items for a cell's right-click menu when it is in a PivotTable (null when it isn't). */
  contextItems(x: number, y: number): ([string, () => void, boolean?] | null)[] | null {
    const c = this.focusHere();
    if (!c) return null;
    const vi = this.valueIndexHere();
    const items: ([string, () => void, boolean?] | null)[] = [
      ['Refresh', () => this.refresh()],
      ['Sort ▸', () => this.sortMenu(x, y)],
    ];
    if (vi !== null) {
      items.push(
        ['Summarize Values By ▸', () => popupMenu(x, y, (Object.keys(PIVOT_FN_LABELS) as PivotFn[]).map((k) => [PIVOT_FN_LABELS[k], () => this.change('Summarize Values By', (p) => ({ ...p, values: p.values.map((v, n) => (n === vi ? { ...v, fn: k, name: undefined } : v)) }))]))],
        ['Show Values As ▸', () => popupMenu(x, y, (Object.keys(SHOW_AS_LABELS) as ShowAs[]).map((k) => [SHOW_AS_LABELS[k], () => this.change('Show Values As', (p) => ({ ...p, values: p.values.map((v, n) => (n === vi ? { ...v, showAs: k === 'normal' ? undefined : k } : v)) }))]))],
        ['Show Details', () => this.showDetails()],
        ['Value Field Settings…', () => void this.valueSettings(vi)],
      );
    }
    items.push(
      ['PivotTable Options ▸', () => popupMenu(x, y, [
        ...(Object.keys(LAYOUT_NAMES) as PivotLayout[]).map((k): [string, () => void] => [`Show in ${LAYOUT_NAMES[k]}`, () => this.change('Report layout', (p) => ({ ...p, layout: k }))]),
        null,
        [c.pt.subtotals ? 'Do Not Show Subtotals' : 'Show All Subtotals', () => this.change('Subtotals', (p) => ({ ...p, subtotals: !p.subtotals }))],
        [c.pt.grandRows && c.pt.grandCols ? 'Grand Totals Off' : 'Grand Totals On', () => this.change('Grand totals', (p) => { const on = !(p.grandRows && p.grandCols); return { ...p, grandRows: on, grandCols: on }; })],
      ])],
      ['Show Field List', () => this.fieldsWindow()],
      ['Change Data Source…', () => this.changeSource()],
      ['PivotChart', () => this.pivotChart()],
      ['Select Entire PivotTable', () => this.selectReport()],
      ['Clear PivotTable', () => this.clear()],
    );
    return items;
  }

  /** Sort the field whose labels the active cell is among (else the first row field). */
  private sortMenu(x: number, y: number): void {
    const c = this.current();
    if (!c) return;
    const field = this.labelFieldHere(c.sheet, c.pt) ?? c.pt.rows[0] ?? c.pt.cols[0];
    if (!field) { this.host.flash('Add a row or column field to sort.'); return; }
    popupMenu(x, y, [
      [`Sort ${field} A to Z`, () => this.change(`Sort ${field}`, (p) => ({ ...p, descending: (p.descending ?? []).filter((f) => f !== field) }))],
      [`Sort ${field} Z to A`, () => this.change(`Sort ${field}`, (p) => ({ ...p, descending: [...(p.descending ?? []).filter((f) => f !== field), field] }))],
    ]);
  }

  /** The row or column field of the label under the active cell. */
  private labelFieldHere(s: Sheet, pt: PivotTable): string | undefined {
    const rep = reportOf(this.wb, s, pt);
    if (typeof rep === 'string') return undefined;
    const r = this.view.sel.active.r - pt.at.row, col = this.view.sel.active.c - pt.at.col;
    if (col < rep.body.col && r >= rep.body.row) {
      const line = rep.rowLines[r - rep.body.row];
      if (!line) return undefined;
      return pt.layout === 'compact' ? pt.rows[Math.max(0, line.path.length - 1)] : pt.rows[col];
    }
    if (r < rep.body.row && col >= rep.body.col && pt.cols.length) {
      const lvl = r - rep.filterRows - (rep.headRows - Math.max(1, pt.cols.length + (pt.values.length > 1 && !pt.valuesOnRows ? 1 : 0)));
      return pt.cols[Math.max(0, Math.min(pt.cols.length - 1, lvl))];
    }
    return undefined;
  }
}

/** Does a field hold numbers (so ticking it sums it)? */
function numeric(src: PivotSource, field: string): boolean {
  const i = src.fields.indexOf(field);
  let nums = 0, other = 0;
  for (const r of src.records) {
    const v = r[i];
    if (typeof v === 'number') nums++;
    else if (v !== null && v !== '') other++;
  }
  return nums > 0 && other === 0;
}

/** A PivotTable without a field anywhere (its filter kept for when it comes back). */
function withoutField(p: PivotTable, f: string): PivotTable {
  return { ...p, rows: p.rows.filter((x) => x !== f), cols: p.cols.filter((x) => x !== f), filters: p.filters.filter((x) => x !== f), values: p.values.filter((v) => v.field !== f) };
}

/**
 * Move a field to an area at a place (from another area, or from the field list). A field is in
 * one of Rows, Columns and Filters at a time; Values may hold a field more than once.
 */
export function moveField(p: PivotTable, field: string, from: Area | undefined, index: number | undefined, to: Area, at: number, src: PivotSource): PivotTable {
  const next: PivotTable = { ...p, rows: [...p.rows], cols: [...p.cols], filters: [...p.filters], values: [...p.values] };
  let moving: PivotValueField | null = null;
  if (from === 'values' && index !== undefined) [moving] = next.values.splice(index, 1);
  else if (from === 'values') next.values = next.values.filter((v) => v.field !== field);
  else if (from) next[from] = next[from].filter((x) => x !== field);
  if (from === to && index !== undefined && index < at) at--;
  if (to === 'values') {
    const v: PivotValueField = moving ?? { field, fn: numeric(src, field) ? 'sum' : 'count' };
    next.values.splice(Math.max(0, Math.min(at, next.values.length)), 0, v);
  } else {
    for (const a of ['rows', 'cols', 'filters'] as const) next[a] = next[a].filter((x) => x !== field);
    next[to].splice(Math.max(0, Math.min(at, next[to].length)), 0, field);
  }
  return next;
}

