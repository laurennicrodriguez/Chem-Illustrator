// Data > Outline in Sheet mode: Group and Ungroup (rows or columns), Auto Outline, Clear Outline,
// Show Detail and Hide Detail, the outline's settings, and the Subtotal window.

import { popupMenu } from './sheet-view';
import type { SheetView } from './sheet-view';
import { ToolWindow } from './tool-window';
import type { Sheet } from '../sheet/workbook';
import { Range, MAX_ROWS, MAX_COLS, colName } from '../sheet/refs';
import {
  group, ungroup, clearOutline, autoOutline, outlineGroups, setCollapsed, addSubtotals, removeSubtotals, SUBTOTAL_FUNCTIONS,
  type Axis, type OutlineGroup,
} from '../sheet/outline';

export interface OutlineHost {
  readonly view: SheetView;
  edit(label: string, fn: (s: Sheet) => void, after?: () => Range): void;
  flash(msg: string, ms?: number): void;
  /** The table around the selection: its cells and header row. */
  table(): { data: Range; header: number | null } | null;
}

export class SheetOutline {
  constructor(private host: OutlineHost) {}

  private get view(): SheetView { return this.host.view; }

  /** Whole rows or whole columns picked: that axis; otherwise ask. */
  private axisOf(R: Range): Axis | null {
    if (R.c1 === 0 && R.c2 >= MAX_COLS - 1) return 'row';
    if (R.r1 === 0 && R.r2 >= MAX_ROWS - 1) return 'col';
    return null;
  }

  private span(R: Range, axis: Axis): [number, number] {
    return axis === 'row' ? [R.r1, R.r2] : [R.c1, R.c2];
  }

  groupMenu(x: number, y: number): void {
    popupMenu(x, y, [
      ['Group…', () => this.group(x, y)],
      ['Auto Outline', () => this.autoOutline()],
    ]);
  }

  ungroupMenu(x: number, y: number): void {
    popupMenu(x, y, [
      ['Ungroup…', () => this.ungroup(x, y)],
      ['Clear Outline', () => this.clear()],
    ]);
  }

  /** Group (Shift+Alt+Right): the selected rows or columns a level deeper. */
  group(x?: number, y?: number): void {
    const R = this.view.sel.range;
    const run = (axis: Axis) => {
      const [a, b] = this.span(R, axis);
      let ok = true;
      this.host.edit(`Group ${axis === 'row' ? 'rows' : 'columns'}`, (s) => { ok = group(s, axis, a, b); });
      if (!ok) this.host.flash('An outline goes seven levels deep at most.');
    };
    this.pickAxis(R, 'Group', run, x, y);
  }

  /** Ungroup (Shift+Alt+Left). */
  ungroup(x?: number, y?: number): void {
    const R = this.view.sel.range;
    const run = (axis: Axis) => {
      const [a, b] = this.span(R, axis);
      let any = true;
      this.host.edit(`Ungroup ${axis === 'row' ? 'rows' : 'columns'}`, (s) => { any = ungroup(s, axis, a, b); });
      if (!any) this.host.flash(`The selected ${axis === 'row' ? 'rows aren\'t' : 'columns aren\'t'} in a group.`);
    };
    this.pickAxis(R, 'Ungroup', run, x, y);
  }

  private pickAxis(R: Range, what: string, run: (a: Axis) => void, x?: number, y?: number): void {
    const axis = this.axisOf(R);
    if (axis) { run(axis); return; }
    popupMenu(x ?? innerWidth / 3, y ?? innerHeight / 4, [
      [`${what} rows ${R.r1 + 1}–${R.r2 + 1}`, () => run('row')],
      [`${what} columns ${colName(R.c1)}–${colName(R.c2)}`, () => run('col')],
    ]);
  }

  autoOutline(): void {
    const s = this.view.sheet;
    if (!s) return;
    const R = this.view.sel.range;
    const block = R.r1 === R.r2 && R.c1 === R.c2 ? s.currentRegion(R.r1, R.c1) : (s.clip(R) ?? R);
    let n = 0;
    this.host.edit('Auto Outline', (sh) => { n = autoOutline(sh, block); });
    if (!n) this.host.flash('No totals to outline: Auto Outline groups the rows (or columns) a SUM or SUBTOTAL just after them adds up.');
  }

  clear(): void {
    const s = this.view.sheet;
    if (!s || (!s.rowLevels.size && !s.colLevels.size)) { this.host.flash('The sheet has no outline.'); return; }
    this.host.edit('Clear Outline', (sh) => { clearOutline(sh, 'row'); clearOutline(sh, 'col'); });
  }

  /** The innermost group at the active cell (or whose button is there), rows first. */
  private groupHere(open: boolean): { axis: Axis; g: OutlineGroup } | null {
    const s = this.view.sheet;
    if (!s) return null;
    const { r, c } = this.view.sel.active;
    for (const axis of ['row', 'col'] as Axis[]) {
      const at = axis === 'row' ? r : c;
      const gs = outlineGroups(s, axis);
      // the button's row first (where Excel's +/− is), then the deepest group around the cell
      const byButton = gs.filter((g) => g.button === at && g.collapsed === open).sort((a, b) => a.level - b.level)[0];
      if (byButton) return { axis, g: byButton };
      const around = gs.filter((g) => at >= g.from && at <= g.to && g.collapsed === open).sort((a, b) => b.level - a.level)[0];
      if (around) return { axis, g: around };
    }
    return null;
  }

  detail(show: boolean): void {
    const got = this.groupHere(show);
    if (!got) { this.host.flash(show ? 'No folded group here: pick its summary row (the one with +).' : 'No open group here.'); return; }
    this.host.edit(show ? 'Show Detail' : 'Hide Detail', (s) => setCollapsed(s, got.axis, got.g, !show));
  }

  settings(): void {
    const s = this.view.sheet;
    if (!s) return;
    const w = new ToolWindow('Outline settings');
    w.note('Where the summary rows and columns (the totals) are, beside their details.');
    const below = w.check('Summary rows below detail', !s.outline?.summaryAbove);
    const right = w.check('Summary columns to right of detail', !s.outline?.summaryLeft);
    const symbols = w.check('Show outline symbols', s.viewOpts?.outlineSymbols !== false);
    w.actions('OK', () => {
      this.host.edit('Outline settings', (sh) => {
        const o = { summaryAbove: below.checked ? undefined : true, summaryLeft: right.checked ? undefined : true };
        sh.setOutline(o.summaryAbove || o.summaryLeft ? o : null);
        const v = { ...sh.viewOpts, outlineSymbols: symbols.checked ? undefined : false as const };
        sh.setViewOpts(v);
      });
    });
    w.show();
  }

  /** Data > Subtotal. */
  subtotal(): void {
    const s = this.view.sheet;
    const t = this.host.table();
    if (!s || !t) { this.host.flash('Click in a table of data first (with a header row).'); return; }
    const R: Range = { ...t.data, r1: t.header ?? t.data.r1 };
    if (R.r2 <= R.r1) { this.host.flash('Subtotal needs a header row and rows of data under it.'); return; }
    const cols: [string, string][] = [];
    for (let c = R.c1; c <= R.c2; c++) cols.push([String(c), s.shownText(R.r1, c) || `Column ${colName(c)}`]);
    const w = new ToolWindow('Subtotal');
    const by = w.select('At each change in', cols, cols[0][0]);
    const fn = w.select('Use function', SUBTOTAL_FUNCTIONS.map(([n, k]) => [String(k), n] as [string, string]), '9');
    const box = w.group('Add subtotal to');
    // the last column that holds numbers is ticked, as in Excel
    let lastNum = -1;
    for (let c = R.c1; c <= R.c2; c++) if (typeof s.value(R.r1 + 1, c) === 'number') lastNum = c;
    const ticks = cols.map(([c, name]) => [Number(c), w.check(name, Number(c) === lastNum, box)] as const);
    const replace = w.check('Replace current subtotals', true);
    const breaks = w.check('Page break between groups', false);
    const below = w.check('Summary below data', !s.outline?.summaryAbove);
    w.actions('OK', () => {
      const picked = ticks.filter(([, b]) => b.checked).map(([c]) => c);
      if (!picked.length) return 'Tick at least one column to add a subtotal to.';
      let out: Range | string = R;
      this.host.edit('Subtotal', (sh) => {
        out = addSubtotals(sh, R, { by: Number(by.value), fn: Number(fn.value), cols: picked, replace: replace.checked, pageBreaks: breaks.checked, above: !below.checked });
      }, () => (typeof out === 'string' ? R : out));
      if (typeof out === 'string') return out;
      this.view.select(out);
    }, [['Remove All', () => {
      let out = R;
      this.host.edit('Remove subtotals', (sh) => { out = removeSubtotals(sh, R); }, () => out);
      w.close();
    }]]);
    w.show();
  }
}
