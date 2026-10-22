// What of a sheet prints and how it is cut into pages: the print area, or everything in use
// (cells, and the charts and objects floating over them), cut by the sheet's page setup.

import type { Sheet } from './workbook';
import type { Range } from './refs';
import { paginate, Pagination, PaperName, SheetSizes } from './page-setup';
import { DEFAULT_COL_W, DEFAULT_ROW_H } from './layout';

/** Column widths and row heights in pixels at 100%, hidden ones 0 (`autoRow`: rows grown to fit their structures). */
export function sheetSizes(s: Sheet, autoRow?: (r: number) => number | undefined): SheetSizes {
  return {
    colW: (c) => (s.hiddenCols.has(c) ? 0 : s.colWidths.get(c) ?? DEFAULT_COL_W),
    rowH: (r) => (s.hiddenRows.has(r) ? 0 : s.rowHeights.get(r) ?? autoRow?.(r) ?? DEFAULT_ROW_H),
  };
}

/** The cell an x (or y) position in pixels falls in. */
function indexAt(px: number, size: (i: number) => number): number {
  let i = 0, at = 0;
  while (i < 100000 && at + size(i) <= px) { at += size(i); i++; }
  return i;
}

/** Everything in use: the cells, stretched to take in the charts and objects. Null for an empty sheet. */
export function printedRange(s: Sheet, sizes: SheetSizes): Range | null {
  let R: Range | null = s.usedRange();
  const floats = [...s.charts, ...s.objects];
  for (const f of floats) {
    let x = f.at.dx, y = f.at.dy;
    for (let c = 0; c < f.at.col; c++) x += sizes.colW(c);
    for (let r = 0; r < f.at.row; r++) y += sizes.rowH(r);
    const c2 = indexAt(x + f.w - 1, sizes.colW), r2 = indexAt(y + f.h - 1, sizes.rowH);
    R = R ? { r1: 0, c1: 0, r2: Math.max(R.r2, r2), c2: Math.max(R.c2, c2) } : { r1: 0, c1: 0, r2, c2 };
  }
  return R;
}

/** The sheet's pages as it would print. */
export function sheetPages(s: Sheet, sizes: SheetSizes, paper: PaperName = 'letter'): Pagination {
  return paginate(s.pageSetup, sizes, printedRange(s, sizes), paper);
}
