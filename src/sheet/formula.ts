// Formulas as Excel writes them: =A1*2, =SUM(B2:B10), =IF(C2>500,"big","small"), =Sheet2!A1.
// Here they are split into pieces (tokens), read into a tree, and rewritten when cells move:
// copying a formula shifts its relative references, inserting or deleting rows and columns
// moves every reference that points past them, and renaming a sheet renames references to it.

import { CellRef, MAX_COLS, MAX_ROWS, colIndex, colName, formatCellRef, parseCellRef, quoteSheet } from './refs';

/** A reference as written: one cell, a block of cells, or whole columns (A:C). */
export interface RefToken {
  sheet?: string;
  kind: 'cell' | 'range' | 'cols';
  a: CellRef;
  /** The other corner (ranges and whole columns). */
  b?: CellRef;
  /** Set when a rewrite left this reference pointing at cells that are gone. */
  broken?: boolean;
}

export type Token =
  | { t: 'num'; v: number; s: string }
  | { t: 'str'; v: string; s: string }
  | { t: 'bool'; v: boolean; s: string }
  | { t: 'err'; v: string; s: string }
  | { t: 'ref'; v: RefToken; s: string }
  | { t: 'fn'; v: string; s: string }
  | { t: 'name'; v: string; s: string }
  | { t: 'op'; v: string; s: string }
  | { t: 'ws'; s: string }
  | { t: '('; s: string }
  | { t: ')'; s: string }
  | { t: ','; s: string };

export class FormulaSyntaxError extends Error {}

const ERRORS = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#CIRC!', '#BUSY!'];

/** Split a formula (without its leading =) into tokens. Throws FormulaSyntaxError on text it can't read. */
export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const rest = () => src.slice(i);
  while (i < src.length) {
    const ch = src[i];
    let m: RegExpExecArray | null;
    if (/\s/.test(ch)) {
      m = /^\s+/.exec(rest())!;
      out.push({ t: 'ws', s: m[0] });
      i += m[0].length;
      continue;
    }
    if (ch === '"') {
      let j = i + 1, v = '';
      for (;;) {
        if (j >= src.length) throw new FormulaSyntaxError('A text in quotes is not closed: add the closing "');
        if (src[j] === '"') {
          if (src[j + 1] === '"') { v += '"'; j += 2; continue; }
          break;
        }
        v += src[j++];
      }
      out.push({ t: 'str', v, s: src.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (ch === '#') {
      const e = ERRORS.find((x) => src.slice(i, i + x.length).toUpperCase() === x);
      if (!e) throw new FormulaSyntaxError(`"${rest().slice(0, 8)}" is not an error value Excel knows`);
      out.push({ t: 'err', v: e, s: src.slice(i, i + e.length) });
      i += e.length;
      continue;
    }
    const ref = readRef(src, i);
    if (ref) {
      out.push({ t: 'ref', v: ref.ref, s: src.slice(i, ref.end) });
      i = ref.end;
      continue;
    }
    if ((m = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest()))) {
      out.push({ t: 'num', v: Number(m[0]), s: m[0] });
      i += m[0].length;
      continue;
    }
    if ((m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest()))) {
      const word = m[0];
      const after = src.slice(i + word.length);
      if (/^\s*\(/.test(after)) out.push({ t: 'fn', v: word.toUpperCase(), s: word });
      else if (/^(TRUE|FALSE)$/i.test(word)) out.push({ t: 'bool', v: word.toUpperCase() === 'TRUE', s: word });
      else out.push({ t: 'name', v: word, s: word });
      i += word.length;
      continue;
    }
    if ((m = /^(<>|<=|>=|[-+*/^&=<>%])/.exec(rest()))) {
      out.push({ t: 'op', v: m[0], s: m[0] });
      i += m[0].length;
      continue;
    }
    if (ch === '(' || ch === ')' || ch === ',') {
      out.push({ t: ch, s: ch } as Token);
      i++;
      continue;
    }
    // Excel in some countries separates arguments with ;
    if (ch === ';') {
      out.push({ t: ',', s: ';' });
      i++;
      continue;
    }
    throw new FormulaSyntaxError(`"${ch}" can't be used here`);
  }
  return out;
}

/** A reference starting at position i: [sheet!]A1, A1:B2, A:C. */
function readRef(src: string, i: number): { ref: RefToken; end: number } | null {
  let j = i;
  let sheet: string | undefined;
  // a sheet name: 'quoted name'! or plain!
  if (src[j] === "'") {
    let k = j + 1, name = '';
    while (k < src.length) {
      if (src[k] === "'") {
        if (src[k + 1] === "'") { name += "'"; k += 2; continue; }
        break;
      }
      name += src[k++];
    }
    if (src[k] !== "'" || src[k + 1] !== '!') return null;
    sheet = name;
    j = k + 2;
  } else {
    const m = /^([A-Za-z_][A-Za-z0-9_.]*)!/.exec(src.slice(j));
    if (m) { sheet = m[1]; j += m[0].length; }
  }
  const s = src.slice(j);
  // the character after a reference can't continue a name or open a function call
  const ends = (k: number) => !/^[A-Za-z0-9_.(!]/.test(src.slice(j + k));
  let m = /^(\$?[A-Za-z]{1,3}\$?\d{1,7}):(\$?[A-Za-z]{1,3}\$?\d{1,7})/.exec(s);
  if (m && ends(m[0].length)) {
    const a = parseCellRef(m[1]), b = parseCellRef(m[2]);
    if (a && b) return { ref: { sheet, kind: 'range', a, b }, end: j + m[0].length };
  }
  m = /^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})/.exec(s);
  if (m && ends(m[0].length)) {
    const c1 = colIndex(m[2]), c2 = colIndex(m[4]);
    if (c1 >= 0 && c2 >= 0) {
      return {
        ref: { sheet, kind: 'cols', a: { row: 0, col: c1, absCol: m[1] === '$', absRow: true }, b: { row: MAX_ROWS - 1, col: c2, absCol: m[3] === '$', absRow: true } },
        end: j + m[0].length,
      };
    }
  }
  m = /^\$?[A-Za-z]{1,3}\$?\d{1,7}/.exec(s);
  if (m && ends(m[0].length)) {
    const a = parseCellRef(m[0]);
    if (a) return { ref: { sheet, kind: 'cell', a }, end: j + m[0].length };
  }
  return null;
}

/** A reference written out again. */
export function refText(r: RefToken): string {
  const pre = r.sheet !== undefined ? `${quoteSheet(r.sheet)}!` : '';
  if (r.broken) return `${pre}#REF!`;
  if (r.kind === 'cell') return pre + formatCellRef(r.a);
  if (r.kind === 'cols') return `${pre}${r.a.absCol ? '$' : ''}${colName(r.a.col)}:${r.b!.absCol ? '$' : ''}${colName(r.b!.col)}`;
  return `${pre}${formatCellRef(r.a)}:${formatCellRef(r.b!)}`;
}

/** Tokens back to formula text (without the =). */
export function untokenize(tokens: Token[]): string {
  return tokens.map((t) => (t.t === 'ref' ? refText(t.v) : t.s)).join('');
}

// ---------------------------------------------------------------- the formula tree

export type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'err'; v: string }
  | { t: 'ref'; v: RefToken }
  | { t: 'name'; v: string }
  | { t: 'neg'; x: Node }
  | { t: 'pct'; x: Node }
  | { t: 'bin'; op: string; l: Node; r: Node }
  | { t: 'fn'; name: string; args: Node[] };

// Excel's order: comparisons, then &, then + −, then × ÷, then ^, then %, then a leading minus
const BINARY: Record<string, number> = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };

/** Read a formula (with or without its leading =) into a tree. Throws FormulaSyntaxError. */
export function parseFormula(text: string): Node {
  const src = text.startsWith('=') ? text.slice(1) : text;
  const toks = tokenize(src).filter((t) => t.t !== 'ws');
  let p = 0;
  const peek = () => toks[p];
  const expr = (minPrec: number): Node => {
    let left = unary();
    for (;;) {
      const t = peek();
      if (!t || t.t !== 'op' || !(t.v in BINARY)) break;
      const prec = BINARY[t.v];
      if (prec < minPrec) break;
      p++;
      // ^ is worked out left to right in Excel, like the others
      const right = expr(prec + 1);
      left = { t: 'bin', op: t.v, l: left, r: right };
    }
    return left;
  };
  const unary = (): Node => {
    const t = peek();
    if (t && t.t === 'op' && (t.v === '-' || t.v === '+')) {
      p++;
      const x = unary();
      return t.v === '-' ? { t: 'neg', x } : x;
    }
    return postfix(primary());
  };
  const postfix = (n: Node): Node => {
    while (peek()?.t === 'op' && (peek() as { v: string }).v === '%') { p++; n = { t: 'pct', x: n }; }
    return n;
  };
  const primary = (): Node => {
    const t = toks[p++];
    if (!t) throw new FormulaSyntaxError('The formula ends too soon');
    switch (t.t) {
      case 'num': return { t: 'num', v: t.v };
      case 'str': return { t: 'str', v: t.v };
      case 'bool': return { t: 'bool', v: t.v };
      case 'err': return { t: 'err', v: t.v };
      case 'ref': return { t: 'ref', v: t.v };
      case 'name': return { t: 'name', v: t.v };
      case '(': {
        const e = expr(1);
        if (toks[p++]?.t !== ')') throw new FormulaSyntaxError('A bracket is not closed: add )');
        return e;
      }
      case 'fn': {
        if (toks[p++]?.t !== '(') throw new FormulaSyntaxError(`${t.v} needs (`);
        const args: Node[] = [];
        if (peek()?.t === ')') { p++; return { t: 'fn', name: t.v, args }; }
        for (;;) {
          // an empty argument (as in ROUND(A1,)) counts as nothing
          if (peek()?.t === ',' || peek()?.t === ')') args.push({ t: 'str', v: '' });
          else args.push(expr(1));
          const sep = toks[p++];
          if (sep?.t === ')') break;
          if (sep?.t !== ',') throw new FormulaSyntaxError(`Add a comma or ) after an argument of ${t.v}`);
        }
        return { t: 'fn', name: t.v, args };
      }
      default:
        throw new FormulaSyntaxError(`"${t.s}" can't be used here`);
    }
  };
  if (!toks.length) throw new FormulaSyntaxError('The formula is empty');
  const tree = expr(1);
  if (p < toks.length) throw new FormulaSyntaxError(`"${toks[p].s}" is not expected here`);
  return tree;
}

/** A formula tidied as Excel does it: function names and references in capitals. Unreadable formulas come back as they are. */
export function normalizeFormula(text: string): string {
  if (!text.startsWith('=')) return text;
  try {
    const toks = tokenize(text.slice(1));
    return '=' + toks.map((t) => (t.t === 'ref' ? refText(t.v) : t.t === 'fn' || t.t === 'bool' ? t.s.toUpperCase() : t.s)).join('');
  } catch {
    return text;
  }
}

/** Every reference in a formula (none when it can't be read). */
export function formulaRefs(text: string): RefToken[] {
  try {
    return tokenize(text.startsWith('=') ? text.slice(1) : text).flatMap((t) => (t.t === 'ref' ? [t.v] : []));
  } catch {
    return [];
  }
}

/** Rewrite every reference in a formula with `fn`. Formulas that can't be read are returned unchanged. */
export function mapRefs(text: string, fn: (r: RefToken) => RefToken): string {
  if (!text.startsWith('=')) return text;
  let toks: Token[];
  try {
    toks = tokenize(text.slice(1));
  } catch {
    return text;
  }
  return '=' + toks.map((t) => (t.t === 'ref' ? refText(fn(t.v)) : t.s)).join('');
}

/** A formula copied dr rows down and dc columns across: relative references move with it (Excel's copy and fill). */
export function shiftFormula(text: string, dr: number, dc: number): string {
  if (!dr && !dc) return text;
  return mapRefs(text, (r) => shiftRef(r, dr, dc));
}

/** A reference copied dr rows down and dc columns across (its $ parts stay); broken when it would leave the sheet. */
function shiftRef(r: RefToken, dr: number, dc: number): RefToken {
  if (r.broken) return r;
  const move = (c: CellRef, wholeCol: boolean): CellRef | null => {
    const row = c.absRow || wholeCol ? c.row : c.row + dr;
    const col = c.absCol ? c.col : c.col + dc;
    if (row < 0 || row >= MAX_ROWS || col < 0 || col >= MAX_COLS) return null;
    return { ...c, row, col };
  };
  const a = move(r.a, r.kind === 'cols'), b = r.b ? move(r.b, r.kind === 'cols') : null;
  if (!a || (r.b && !b)) return { ...r, broken: true };
  return { ...r, a, b: b ?? undefined };
}

/**
 * A formula copied from (fromRow, fromCol) to (toRow, toCol) with Paste Special's Transpose: its
 * relative references turn with the block, so a cell to its left becomes a cell above it.
 * References with $ in them move as an ordinary copy does.
 */
export function transposeFormula(text: string, from: { row: number; col: number }, to: { row: number; col: number }): string {
  return mapRefs(text, (r) => {
    if (r.broken) return r;
    const turn = (c: CellRef, wholeCol: boolean): CellRef | null => {
      let row: number, col: number;
      if (!c.absRow && !c.absCol && !wholeCol) { row = to.row + (c.col - from.col); col = to.col + (c.row - from.row); }
      else { row = c.absRow || wholeCol ? c.row : c.row + to.row - from.row; col = c.absCol ? c.col : c.col + to.col - from.col; }
      if (row < 0 || row >= MAX_ROWS || col < 0 || col >= MAX_COLS) return null;
      return { ...c, row, col };
    };
    const a = turn(r.a, r.kind === 'cols'), b = r.b ? turn(r.b, r.kind === 'cols') : null;
    if (!a || (r.b && !b)) return { ...r, broken: true };
    // a block turned keeps its corners in order (A1:C1 becomes A1:A3)
    if (b && r.kind === 'range') return { ...r, a: { ...a, row: Math.min(a.row, b.row), col: Math.min(a.col, b.col) }, b: { ...b, row: Math.max(a.row, b.row), col: Math.max(a.col, b.col) } };
    return { ...r, a, b: b ?? undefined };
  });
}

/**
 * A formula's tree as if copied dr rows down and dc columns across: the same as shifting its
 * text and reading it again, without the reading (conditional formatting asks this of every cell).
 */
export function shiftTree(n: Node, dr: number, dc: number): Node {
  if (!dr && !dc) return n;
  switch (n.t) {
    case 'ref': {
      const r = shiftRef(n.v, dr, dc);
      return r.broken ? { t: 'err', v: '#REF!' } : { t: 'ref', v: r };
    }
    case 'neg': case 'pct': return { t: n.t, x: shiftTree(n.x, dr, dc) };
    case 'bin': return { t: 'bin', op: n.op, l: shiftTree(n.l, dr, dc), r: shiftTree(n.r, dr, dc) };
    case 'fn': return { t: 'fn', name: n.name, args: n.args.map((x) => shiftTree(x, dr, dc)) };
    default: return n;
  }
}

/** Rows or columns put in or taken out of a sheet. */
export interface SheetChange {
  sheet: string;
  axis: 'row' | 'col';
  /** First row or column affected. */
  at: number;
  /** How many: positive inserts, negative deletes. */
  count: number;
}

/**
 * Keep a formula pointing at the same cells after rows or columns are inserted or deleted
 * (`home` is the sheet the formula is on). References to deleted cells become #REF!; a block
 * that loses some of its rows or columns shrinks, and one with rows inserted inside it grows.
 */
export function adjustFormula(text: string, home: string, ch: SheetChange): string {
  return mapRefs(text, (r) => adjustRef(r, home, ch));
}

/** Is a reference on this sheet? (Sheet names are matched whatever their case, as they are worked out.) */
const onSheet = (r: RefToken, home: string, sheet: string) => (r.sheet ?? home).toLowerCase() === sheet.toLowerCase();

export function adjustRef(r: RefToken, home: string, ch: SheetChange): RefToken {
  if (r.broken || !onSheet(r, home, ch.sheet)) return r;
  const key = ch.axis === 'row' ? 'row' : 'col';
  if (r.kind === 'cols' && ch.axis === 'row') return r;
  const pos = (c: CellRef) => c[key];
  const set = (c: CellRef, v: number): CellRef => ({ ...c, [key]: v });
  // a block typed backwards (A10:A5) is the same block put in order
  if (r.b && pos(r.a) > pos(r.b)) r = { ...r, a: set(r.a, pos(r.b)), b: set(r.b, pos(r.a)) };
  if (ch.count > 0) {
    const shift = (c: CellRef) => (pos(c) >= ch.at ? set(c, pos(c) + ch.count) : c);
    if (r.kind === 'cell') return { ...r, a: shift(r.a) };
    // a block grows when rows go in below its first row
    const a = r.a, b = r.b!;
    return { ...r, a: shift(a), b: pos(b) >= ch.at ? set(b, pos(b) + ch.count) : b };
  }
  const n = -ch.count, end = ch.at + n - 1;
  if (r.kind === 'cell') {
    const v = pos(r.a);
    if (v < ch.at) return r;
    if (v <= end) return { ...r, broken: true };
    return { ...r, a: set(r.a, v - n) };
  }
  const lo = pos(r.a), hi = pos(r.b!);
  if (hi < ch.at) return r;
  if (lo > end) return { ...r, a: set(r.a, lo - n), b: set(r.b!, hi - n) };
  // part or all of the block goes
  const newLo = lo < ch.at ? lo : ch.at;
  const newHi = hi > end ? hi - n : ch.at - 1;
  if (newHi < newLo) return { ...r, broken: true };
  return { ...r, a: set(r.a, newLo), b: set(r.b!, newHi) };
}

/**
 * Keep a formula pointing at cells that were moved (Cut and Paste): a reference to a cell of the
 * block, or to a range inside it, follows the block by dr rows and dc columns, fixed ($) or not,
 * as in Excel. References to anything else stay as they are.
 */
export function moveRefs(text: string, home: string, sheet: string, block: { r1: number; c1: number; r2: number; c2: number }, dr: number, dc: number): string {
  const inside = (c: CellRef) => c.row >= block.r1 && c.row <= block.r2 && c.col >= block.c1 && c.col <= block.c2;
  const move = (c: CellRef): CellRef => ({ ...c, row: c.row + dr, col: c.col + dc });
  return mapRefs(text, (r) => {
    if (r.broken || r.kind === 'cols' || !onSheet(r, home, sheet)) return r;
    if (r.kind === 'cell') return inside(r.a) ? { ...r, a: move(r.a) } : r;
    return inside(r.a) && inside(r.b!) ? { ...r, a: move(r.a), b: move(r.b!) } : r;
  });
}

/** Rename a sheet in a formula's references. */
export function renameSheetInFormula(text: string, from: string, to: string): string {
  return mapRefs(text, (r) => (r.sheet !== undefined && r.sheet.toLowerCase() === from.toLowerCase() ? { ...r, sheet: to } : r));
}
