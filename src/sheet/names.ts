// Defined names, as Excel's Name Manager keeps them: a name for a block of cells (Yields for
// Sheet1!$C$2:$C$40), a constant (R for 0.082057) or a formula, usable in any formula in place
// of what it names. A name holding a LAMBDA is a function of the workbook's own (=Moles(B2)).
// A name belongs to the whole workbook or to one sheet; a sheet's own name wins on that sheet.

import type { Sheet } from './workbook';
import { tokenize } from './formula';

export interface DefinedName {
  name: string;
  /** What it stands for, as a formula: =Sheet1!$C$2:$C$40, =0.082057, =LAMBDA(n, m, n*m). */
  formula: string;
  /** The sheet it belongs to; undefined for the whole workbook. */
  sheet?: Sheet;
  comment?: string;
  /** Hidden from the Name Manager (as add-ins make them), and kept. */
  hidden?: boolean;
}

/**
 * Why a name can't be used (null when it can): Excel's rules are a letter or _ first, then
 * letters, digits, _ and points, at most 255 characters, and nothing that reads as a cell
 * (A1, XFD99, R1C1, R or C).
 */
export function nameProblem(name: string): string | null {
  if (!name) return 'Give the name.';
  if (name.length > 255) return 'A name can be at most 255 characters long.';
  if (/\s/.test(name)) return 'A name can\'t have spaces in it: use _ instead (Yield_A).';
  if (!/^[A-Za-z_]/.test(name)) return 'A name starts with a letter or _.';
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)) return 'A name holds only letters, digits, _ and points.';
  if (/^(R|C|RC|R\d*C\d*|R\d+|C\d+)$/i.test(name)) return `"${name}" reads as a cell (R1C1 style), so it can't be a name.`;
  if (/^(TRUE|FALSE)$/i.test(name)) return `"${name}" can't be a name.`;
  let toks;
  try { toks = tokenize(name); } catch { return `"${name}" can't be a name.`; }
  if (toks.length !== 1 || toks[0].t !== 'name') return `"${name}" reads as a cell, so it can't be a name.`;
  return null;
}

/** Names that belong to Excel itself (print areas, filters), kept out of the Name Manager. */
export const isBuiltInName = (name: string): boolean => /^_xlnm\./i.test(name);

/** Does a list hold a name, in this scope (names are matched whatever their case)? */
export function findName(list: readonly DefinedName[], name: string, sheet: Sheet | undefined): DefinedName | undefined {
  const low = name.toLowerCase();
  return list.find((n) => n.name.toLowerCase() === low && n.sheet === sheet);
}

/** The name a formula on `home` means: the sheet's own, else the workbook's. */
export function resolveName(list: readonly DefinedName[], name: string, home: Sheet | undefined): DefinedName | undefined {
  return (home && findName(list, name, home)) || findName(list, name, undefined);
}
