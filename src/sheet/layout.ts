// Sizes in the grid, in pixels at 100% zoom (96 to the inch, as Excel counts them), and where a
// structure sits in its cell. Shared by the grid on screen and by Excel files, so a structure
// fills the same space in both.

export const DEFAULT_COL_W = 64;
export const DEFAULT_ROW_H = 20;
/** Pixels per point for structures in cells at 100% zoom. */
export const STRUCTURE_SCALE = 1;
/** Space between a structure and its cell's edges. */
export const STRUCTURE_PAD = 4;
/** Rows never grow taller than this to fit a structure (a taller row can still be set by hand). */
export const MAX_AUTO_ROW = 260;

/** The height a row needs for a structure (its size in points) in a column `colW` pixels wide. */
export function structureHeight(box: { w: number; h: number }, colW: number): number {
  const k = Math.min(1, (colW - 2 * STRUCTURE_PAD) / Math.max(1, box.w * STRUCTURE_SCALE));
  return box.h * STRUCTURE_SCALE * k + 2 * STRUCTURE_PAD;
}

/**
 * Where a structure (its size in points) is drawn in a cell: shrunk to fit if it must, never
 * enlarged, placed by the cell's alignment (centred both ways unless set). `k` is pixels per point.
 */
export function structurePlace(
  box: { w: number; h: number },
  cell: { x: number; y: number; w: number; h: number },
  align?: 'left' | 'center' | 'right',
  valign?: 'top' | 'middle' | 'bottom',
  zoom = 1,
): { x: number; y: number; w: number; h: number; k: number } {
  const pad = STRUCTURE_PAD * zoom;
  const natW = box.w * STRUCTURE_SCALE * zoom, natH = box.h * STRUCTURE_SCALE * zoom;
  const fit = Math.max(0, Math.min(1, (cell.w - 2 * pad) / Math.max(1, natW), (cell.h - 2 * pad) / Math.max(1, natH)));
  const w = natW * fit, h = natH * fit;
  const x = align === 'left' ? cell.x + pad : align === 'right' ? cell.x + cell.w - pad - w : cell.x + (cell.w - w) / 2;
  const y = valign === 'top' ? cell.y + pad : valign === 'bottom' ? cell.y + cell.h - pad - h : cell.y + (cell.h - h) / 2;
  return { x, y, w, h, k: STRUCTURE_SCALE * zoom * fit };
}
