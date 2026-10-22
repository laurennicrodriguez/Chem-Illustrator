// The View tab's Workbook Views and Show groups in Sheet mode: Normal, Page Break Preview and Page
// Layout; gridlines, headings and the formula bar shown or hidden; and Custom Views.

import type { SheetView } from './sheet-view';
import { ToolWindow } from './tool-window';
import type { Sheet } from '../sheet/workbook';
import { captureView, applyView, type SheetViewOpts } from '../sheet/views';

/** Whether the formula bar shows (a setting kept between sessions, as in Excel). */
export const formulaBarPrefs: { shown: boolean; changed?: () => void } = { shown: true };

export interface ViewsHost {
  readonly view: SheetView;
  edit(label: string, fn: (s: Sheet) => void): void;
  flash(msg: string, ms?: number): void;
  /** The formula bar was shown or hidden. */
  formulaBar(): void;
}

export class SheetViews {
  constructor(private host: ViewsHost) {}

  private get view(): SheetView { return this.host.view; }

  /** Change the sheet's view settings (kept with the sheet, and undoable as Excel saves them). */
  private set(label: string, patch: Partial<SheetViewOpts>): void {
    this.host.edit(label, (s) => {
      const o: SheetViewOpts = { ...s.viewOpts, ...patch };
      for (const k of Object.keys(o) as (keyof SheetViewOpts)[]) if (o[k] === undefined) delete o[k];
      s.setViewOpts(Object.keys(o).length ? o : null);
    });
    this.view.focus();
  }

  layout(which: 'normal' | 'pageLayout' | 'pageBreakPreview'): void {
    const s = this.view.sheet;
    if (!s || s.dashboard) return;
    const cur = s.viewOpts?.layout ?? 'normal';
    if (cur === which) return;
    this.set(which === 'normal' ? 'Normal view' : which === 'pageLayout' ? 'Page Layout view' : 'Page Break Preview', { layout: which === 'normal' ? undefined : which });
    if (which === 'pageLayout' && (s.frozen.rows || s.frozen.cols)) this.host.flash('Frozen panes don\'t show in Page Layout view; they come back in Normal view.');
  }

  toggle(what: 'gridlines' | 'headings'): void {
    const s = this.view.sheet;
    if (!s) return;
    const shown = s.viewOpts?.[what] !== false;
    this.set(what === 'gridlines' ? (shown ? 'Hide gridlines' : 'Show gridlines') : (shown ? 'Hide headings' : 'Show headings'), { [what]: shown ? false : undefined });
  }

  toggleFormulaBar(): void {
    formulaBarPrefs.shown = !formulaBarPrefs.shown;
    formulaBarPrefs.changed?.();
    this.host.formulaBar();
  }

  /** View > Custom Views: the saved views, to show, add or delete. */
  customViews(): void {
    const wb = this.view.wb, s = this.view.sheet;
    if (!wb || !s) return;
    const w = new ToolWindow('Custom Views', 'custom-views');
    const list = document.createElement('select');
    list.size = 8;
    list.className = 'cv-list';
    list.setAttribute('aria-label', 'Views');
    const fill = () => {
      list.replaceChildren(...wb.customViews.map((v, i) => new Option(v.name, String(i))));
      if (wb.customViews.length) list.selectedIndex = 0;
      show.disabled = del.disabled = !wb.customViews.length;
    };
    w.body.append(list);
    w.note('A view keeps which sheet shows, the view (Normal, Page Layout or Page Break Preview), and, if you ask, hidden rows and columns, the filter and print settings.');
    const show = w.button('Show', () => {
      const v = wb.customViews[list.selectedIndex];
      if (!v) return;
      let to: Sheet | undefined;
      let active = new Map<Sheet, [number, number]>();
      this.host.edit(`Show view: ${v.name}`, () => { ({ sheet: to, active } = applyView(wb, v)); });
      w.close();
      if (to) this.view.goSheet(wb.sheets.indexOf(to));
      const a = active.get(this.view.sheet!);
      if (a) this.view.selectCell(a[0], a[1]);
      this.view.refresh();
      this.view.focus();
    }, 'primary');
    list.addEventListener('dblclick', () => show.click());
    w.button('Add…', () => { w.close(); this.addView(); });
    const del = w.button('Delete', () => {
      const v = wb.customViews[list.selectedIndex];
      if (!v || !confirm(`Delete the view "${v.name}"?`)) return;
      this.host.edit('Delete view', () => wb.setCustomViews(wb.customViews.filter((x) => x !== v)));
      fill();
    });
    w.button('Close', () => w.close());
    fill();
    w.show();
    list.focus();
  }

  private addView(): void {
    const wb = this.view.wb;
    if (!wb) return;
    const w = new ToolWindow('Add View');
    const name = w.text('Name', '');
    const g = w.group('Include in view');
    const print = w.check('Print settings', true, g);
    const hidden = w.check('Hidden rows, columns and filter settings', true, g);
    w.actions('OK', () => {
      const n = name.value.trim();
      if (!n) return 'Give the view a name.';
      const was = wb.customViews.find((v) => v.name.toLowerCase() === n.toLowerCase());
      if (was && !confirm(`A view named "${was.name}" exists. Replace it?`)) return false;
      const active = this.view.sheet!;
      const v = captureView(wb, n, {
        printSettings: print.checked, hiddenAndFilters: hidden.checked,
        // the active cell of the sheet showing (others keep theirs)
        active: (s) => (s === active ? [this.view.sel.active.r, this.view.sel.active.c] : undefined),
      }, was?.guid);
      this.host.edit('Add view', () => wb.setCustomViews(was ? wb.customViews.map((x) => (x === was ? v : x)) : [...wb.customViews, v]));
      this.host.flash(`Saved the view "${n}". View > Custom Views shows it again.`);
    });
    w.show();
  }
}
