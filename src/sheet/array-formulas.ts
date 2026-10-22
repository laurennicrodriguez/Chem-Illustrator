// Formulas as Excel saves them, now that arrays spill. A formula from before spilling (one an
// .xlsx file doesn't mark as a dynamic array formula) took one value wherever a block of cells
// stood in for a value: =A1:A9*2 gave the cell in the formula's own row. Excel shows such
// formulas with @ (=@A1:A9*2) to keep their answers, and so does opening one here. Saving, a
// formula that spills or works on arrays is marked as a dynamic array formula; Excel's own
// spellings are used for A1# (ANCHORARRAY), @ (SINGLE) and LET's and LAMBDA's names (_xlpm.).

import { parseFormula, tokenize, untokenize, type Node, type Token } from './formula';
import { liftedArgs } from './evaluate';

/** Functions that only work in Excel with dynamic arrays. */
const DYNAMIC_FUNCTIONS = new Set(['FILTER', 'SORT', 'SORTBY', 'UNIQUE', 'SEQUENCE', 'RANDARRAY', 'LET', 'LAMBDA', 'MAP', 'REDUCE', 'SCAN',
  'BYROW', 'BYCOL', 'MAKEARRAY', 'VSTACK', 'HSTACK', 'TAKE', 'DROP', 'CHOOSEROWS', 'CHOOSECOLS', 'TOCOL', 'TOROW', 'TEXTSPLIT', 'EXPAND',
  'WRAPROWS', 'WRAPCOLS']);

/** Where blocks of cells stand in for one value (as token numbers, spaces not counted). */
function valueBlocks(n: Node, value: boolean, out: number[]): void {
  switch (n.t) {
    case 'ref':
      if (value && (n.v.kind !== 'cell' || n.v.spill) && n.i !== undefined) out.push(n.i);
      return;
    case 'neg': case 'pct': valueBlocks(n.x, true, out); return;
    case 'bin': valueBlocks(n.l, true, out); valueBlocks(n.r, true, out); return;
    case 'call': valueBlocks(n.f, false, out); n.args.forEach((a) => valueBlocks(a, false, out)); return;
    case 'fn': {
      const name = n.name;
      n.args.forEach((a, k) => {
        // a test takes one value; IF's answers are the formula's own
        let v: boolean;
        if (name === 'IF' || name === 'CHOOSE' || name === 'SWITCH') v = k === 0 || value;
        else if (name === 'IFERROR' || name === 'IFNA') v = value;
        else if (name === 'IFS') v = k % 2 === 0 || value;
        else v = k < liftedArgs(name);
        valueBlocks(a, v, out);
      });
      return;
    }
    default: return;
  }
}

/** Tokens without spaces, and where each is in the full list. */
function tokens(text: string): { all: Token[]; at: number[] } | null {
  try {
    const all = tokenize(text.startsWith('=') ? text.slice(1) : text);
    const at: number[] = [];
    all.forEach((t, i) => { if (t.t !== 'ws') at.push(i); });
    return { all, at };
  } catch {
    return null;
  }
}

function tree(text: string): Node | null {
  try { return parseFormula(text); } catch { return null; }
}

/** A formula from a file that doesn't mark it as a dynamic array formula, with @ where Excel would show one. */
export function legacyFormula(text: string): string {
  const t = tree(text), toks = tokens(text);
  if (!t || !toks) return text;
  const marks: number[] = [];
  valueBlocks(t, true, marks);
  if (!marks.length) return text;
  const before = new Set(marks.map((i) => toks.at[i]));
  return '=' + toks.all.map((tok, i) => (before.has(i) ? '@' : '') + (tok.t === 'ref' ? untokenize([tok]) : tok.s)).join('');
}

/**
 * Does a formula need saving as a dynamic array formula (Excel would otherwise work it out the
 * old way)? Formulas that spilled always do; others when they use blocks as values (=SUM(A1:A9*B1:B9))
 * or functions that only exist with dynamic arrays.
 */
export function needsDynamic(text: string): boolean {
  const toks = tokens(text);
  if (!toks) return false;
  if (toks.all.some((t) => (t.t === 'fn' && DYNAMIC_FUNCTIONS.has(t.v)) || (t.t === 'ref' && t.v.spill))) return true;
  const t = tree(text);
  if (!t) return false;
  const marks: number[] = [];
  valueBlocks(t, true, marks);
  return marks.length > 0;
}

/** The names a formula's LETs and LAMBDAs give (upper case). */
function boundNames(n: Node, out: Set<string>): void {
  switch (n.t) {
    case 'fn':
      if (n.name === 'LET') n.args.forEach((a, k) => { if (k % 2 === 0 && k < n.args.length - 1 && a.t === 'name') out.add(a.v.toUpperCase()); });
      if (n.name === 'LAMBDA') n.args.slice(0, -1).forEach((a) => { if (a.t === 'name') out.add(a.v.toUpperCase()); });
      n.args.forEach((a) => boundNames(a, out));
      return;
    case 'call': boundNames(n.f, out); n.args.forEach((a) => boundNames(a, out)); return;
    case 'neg': case 'pct': case 'at': boundNames(n.x, out); return;
    case 'bin': boundNames(n.l, out); boundNames(n.r, out); return;
    default: return;
  }
}

/**
 * A formula (without its =) as Excel saves it: A1# as _xlfn.ANCHORARRAY(A1), LET's and LAMBDA's
 * names with _xlpm., and @ as _xlfn.SINGLE(…) in a dynamic array formula (in an old-style one @
 * is how Excel works it out anyway, so it is left out). Newer functions' _xlfn. prefixes are
 * added by the caller.
 */
export function fileFormula(text: string, dynamic: boolean): string {
  const toks = tokens(text);
  const t = tree(text);
  if (!toks || !t) return text.startsWith('=') ? text.slice(1) : text;
  const bound = new Set<string>();
  boundNames(t, bound);
  const all = toks.all;
  const out: string[] = [];
  for (let i = 0; i < all.length; i++) {
    const tok = all[i];
    if (tok.t === 'op' && tok.v === '@') {
      if (!dynamic) continue;
      // @ applies to what follows: a reference, a name, or a function with its brackets
      let j = i + 1;
      while (all[j]?.t === 'ws') j++;
      const nx = all[j];
      if (!nx) continue;
      let end = j;
      if (nx.t === 'fn' || nx.t === '(') {
        let depth = 0;
        for (let k = j; k < all.length; k++) {
          if (all[k].t === '(') depth++;
          else if (all[k].t === ')' && --depth === 0) { end = k; break; }
        }
      }
      out.push('_xlfn.SINGLE(' + fileFormula('=' + untokenize(all.slice(j, end + 1)), dynamic) + ')');
      i = end;
      continue;
    }
    if (tok.t === 'ref' && tok.v.spill) { out.push(`_xlfn.ANCHORARRAY(${untokenize([{ ...tok, v: { ...tok.v, spill: false } }])})`); continue; }
    if ((tok.t === 'name' || tok.t === 'fn') && bound.has(tok.v.toUpperCase())) { out.push('_xlpm.' + tok.s); continue; }
    out.push(tok.t === 'ref' ? untokenize([tok]) : tok.s);
  }
  return out.join('');
}

/** A formula (without its =) from a file, in this program's spelling: prefixes taken off, ANCHORARRAY(A1) as A1#, SINGLE(x) as @x. */
export function readFileFormula(text: string): string {
  let f = text.replace(/_xlfn\.|_xlws\.|_xlpm\./g, '');
  f = f.replace(/\bANCHORARRAY\(\s*((?:'(?:[^']|'')+'|[A-Za-z0-9_.]+)?!?\$?[A-Za-z]{1,3}\$?\d+)\s*\)/gi, '$1#');
  f = f.replace(/\bSINGLE\(/gi, '@(');
  return '=' + f;
}
