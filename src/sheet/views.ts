// The View tab's settings kept with each sheet (Normal, Page Layout or Page Break Preview; gridlines
// and headings shown or hidden) and Custom Views: named snapshots of how the workbook was being
// looked at (which sheet, the zoom, hidden rows and columns, the filter, print settings), to go
// back to in one step. Saved to Excel as its own sheet views and custom views.

import type { Sheet, Workbook, Filter } from './workbook';
import type { PageSetup } from './page-setup';

export type SheetLayoutView = 'normal' | 'pageLayout' | 'pageBreakPreview';

export interface SheetViewOpts {
  /** Unset: Normal. */
  layout?: 'pageLayout' | 'pageBreakPreview';
  /** False: gridlines hidden. */
  gridlines?: false;
  /** False: row numbers and column letters hidden. */
  headings?: false;
  /** False: the outline's buttons hidden (the outline stays). */
  outlineSymbols?: false;
  /** False: zeros show as empty cells. */
  zeros?: false;
  /** The zoom kept with the sheet (percent; unset 100). */
  zoom?: number;
}

/** A sheet as a custom view keeps it. */
export interface CustomSheetView {
  /** The sheet, by name. */
  sheet: string;
  hiddenRows: number[];
  hiddenCols: number[];
  view: SheetViewOpts | null;
  filter?: Filter | null;
  pageSetup?: PageSetup | null;
  /** The active cell (row, column). */
  active?: [number, number];
}

export interface CustomView {
  name: string;
  /** Excel's id for it ({8-4-4-4-12}). */
  guid: string;
  /** The sheet showing. */
  activeSheet: string;
  /** Print settings kept (and put back) with the view. */
  printSettings: boolean;
  /** Hidden rows, columns and filter settings kept. */
  hiddenAndFilters: boolean;
  sheets: CustomSheetView[];
}

/** A new id in Excel's form. */
export function newGuid(): string {
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join('');
  return `{${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}}`;
}

/** How the workbook is being looked at now, as a custom view. */
export function captureView(wb: Workbook, name: string, opts: { printSettings: boolean; hiddenAndFilters: boolean; active?: (s: Sheet) => [number, number] | undefined }, guid = newGuid()): CustomView {
  return {
    name, guid, activeSheet: wb.sheet.name, printSettings: opts.printSettings, hiddenAndFilters: opts.hiddenAndFilters,
    sheets: wb.sheets.filter((s) => !s.dashboard).map((s) => ({
      sheet: s.name,
      hiddenRows: opts.hiddenAndFilters ? [...s.hiddenRows.keys()].sort((a, b) => a - b) : [],
      hiddenCols: opts.hiddenAndFilters ? [...s.hiddenCols.keys()].sort((a, b) => a - b) : [],
      view: s.viewOpts ? { ...s.viewOpts } : null,
      ...(opts.hiddenAndFilters ? { filter: s.filter ? JSON.parse(JSON.stringify(s.filter)) as Filter : null } : {}),
      ...(opts.printSettings ? { pageSetup: s.pageSetup ? JSON.parse(JSON.stringify(s.pageSetup)) as PageSetup : null } : {}),
      ...(opts.active?.(s) ? { active: opts.active(s) } : {}),
    })),
  };
}

/** Put a custom view back (inside an edit). Returns the sheet to show, and the active cell of each sheet. */
export function applyView(wb: Workbook, v: CustomView): { sheet: Sheet | undefined; active: Map<Sheet, [number, number]> } {
  const active = new Map<Sheet, [number, number]>();
  for (const sv of v.sheets) {
    const s = wb.sheetNamed(sv.sheet);
    if (!s) continue;
    s.setViewOpts(sv.view ? { ...sv.view } : null);
    if (v.hiddenAndFilters) {
      if (sv.filter !== undefined) s.restoreFilter(sv.filter ? JSON.parse(JSON.stringify(sv.filter)) as Filter : null);
      const rows = new Set(sv.hiddenRows), cols = new Set(sv.hiddenCols);
      for (const r of [...s.hiddenRows.keys()]) if (!rows.has(r)) s.setRowHidden(r, false);
      for (const r of rows) s.setRowHidden(r, true);
      for (const c of [...s.hiddenCols.keys()]) if (!cols.has(c)) s.setColHidden(c, false);
      for (const c of cols) s.setColHidden(c, true);
    }
    if (v.printSettings && sv.pageSetup !== undefined) s.setPageSetup(sv.pageSetup ? JSON.parse(JSON.stringify(sv.pageSetup)) as PageSetup : null);
    if (sv.active) active.set(s, sv.active);
  }
  return { sheet: wb.sheetNamed(v.activeSheet), active };
}

/** Custom views after a sheet is renamed (they name their sheets). */
export function renameInViews(list: CustomView[], from: string, to: string): CustomView[] {
  const low = from.toLowerCase();
  return list.map((v) => ({
    ...v,
    activeSheet: v.activeSheet.toLowerCase() === low ? to : v.activeSheet,
    sheets: v.sheets.map((s) => (s.sheet.toLowerCase() === low ? { ...s, sheet: to } : s)),
  }));
}
