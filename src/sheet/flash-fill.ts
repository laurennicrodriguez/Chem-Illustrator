// Flash Fill (Excel's Ctrl+E): from a few examples typed beside a table, work out how each was
// made from the cells of its row (a word, a part, its first letter, in capitals or not, with
// fixed text between), and fill the rest of the column the same way.
//
// Each example is broken into pieces that are either fixed text or a part of one of the row's
// cells. The ways that fit the first example are tried on the others; of those that fit every
// example, the simplest is used.

/** How a cell's text is cut into parts. */
type Cutting = 'whole' | 'words' | 'alnum' | 'kinds';
type Change = 'same' | 'lower' | 'upper' | 'proper' | 'initial' | 'initial-upper';

/** A part of one of the row's cells: from one piece of it to another (counted from the start, or from the end when negative), changed. */
interface Atom {
  col: number;
  cut: Cutting;
  from: number;
  to: number;
  change: Change;
}

type Piece = { text: string } | { atoms: Atom[] };

const CUTS: Cutting[] = ['whole', 'words', 'alnum', 'kinds'];
const CHANGES: Change[] = ['same', 'lower', 'upper', 'proper', 'initial', 'initial-upper'];

/** The pieces of a text, as spans [start, end). */
function spans(text: string, cut: Cutting): [number, number][] {
  if (cut === 'whole') return text ? [[0, text.length]] : [];
  const re = cut === 'words' ? /\S+/gu : cut === 'alnum' ? /[\p{L}\p{N}]+/gu : /\p{L}+|\p{N}+(?:\.\p{N}+)?/gu;
  const out: [number, number][] = [];
  for (const m of text.matchAll(re)) out.push([m.index!, m.index! + m[0].length]);
  return out;
}

const proper = (t: string) => t.replace(/\p{L}+/gu, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

function changed(t: string, ch: Change): string {
  switch (ch) {
    case 'same': return t;
    case 'lower': return t.toLowerCase();
    case 'upper': return t.toUpperCase();
    case 'proper': return proper(t);
    case 'initial': return t.slice(0, 1);
    case 'initial-upper': return t.slice(0, 1).toUpperCase();
  }
}

/** What an atom gives for a row (null when the row hasn't that many pieces). */
function evalAtom(a: Atom, row: string[], memo?: Map<string, [number, number][]>): string | null {
  const text = row[a.col] ?? '';
  const key = `${a.col}|${a.cut}`;
  let sp = memo?.get(key);
  if (!sp) { sp = spans(text, a.cut); memo?.set(key, sp); }
  const i = a.from < 0 ? sp.length + a.from : a.from, j = a.to < 0 ? sp.length + a.to : a.to;
  if (i < 0 || j < i || j >= sp.length) return null;
  const t = changed(text.slice(sp[i][0], sp[j][1]), a.change);
  return t || null;
}

/** How simple an atom is (lower is simpler), to choose between atoms that give the same text. */
function atomCost(a: Atom, row: string[]): number {
  const n = spans(row[a.col] ?? '', a.cut).length;
  const pos = (x: number) => (x < 0 ? -x - 1 : x);
  const counted = (x: number) => Math.min(pos(x), x < 0 ? n + x : n - 1 - x);
  // an index from the end is chosen when the piece is nearer the end (a surname after any middle names)
  const fromEnd = (x: number) => (x < 0 ? (n + x < -x - 1 ? 0.5 : 0) : (n - 1 - x < x ? 0.5 : 0));
  return CUTS.indexOf(a.cut) * 0.3 + CHANGES.indexOf(a.change) * 0.4 + (a.from !== a.to ? 1 : 0) + counted(a.from) * 0.05 + fromEnd(a.from) + fromEnd(a.to) + a.col * 0.01;
}

/** Every atom giving some non-empty text for a row, with the text each gives. */
function atomsFor(row: string[]): { atom: Atom; text: string }[] {
  const out: { atom: Atom; text: string }[] = [];
  const seen = new Set<string>();
  row.forEach((text, col) => {
    if (!text) return;
    for (const cut of CUTS) {
      const n = spans(text, cut).length;
      if (!n || n > 30) continue;
      for (let i = 0; i < n; i++) {
        for (let j = i; j < n; j++) {
          // each piece counted from the start and from the end
          for (const from of [i, i - n]) for (const to of [j, j - n]) {
            for (const change of CHANGES) {
              if ((change === 'initial' || change === 'initial-upper') && i !== j) continue;
              const atom: Atom = { col, cut, from, to, change };
              const t = evalAtom(atom, row);
              if (!t) continue;
              const id = `${col}|${cut}|${from}|${to}|${change}`;
              if (seen.has(id)) continue;
              seen.add(id);
              out.push({ atom, text: t });
            }
          }
        }
      }
    }
  });
  return out;
}

const MAX_PROGRAMS = 4000;
const MAX_PIECES = 9;

/** The ways of making `out` from a row: pieces of fixed text and atoms, no two fixed texts in a row. */
function programs(row: string[], out: string): Piece[][] {
  const all = atomsFor(row);
  // the atoms that give the text starting at each place of the example
  const at: Map<number, Atom[]>[] = Array.from({ length: out.length }, () => new Map());
  const letter = (i: number) => i >= 0 && i < out.length && /\p{L}/u.test(out[i]);
  for (const { atom, text } of all) {
    for (let p = out.indexOf(text); p >= 0; p = out.indexOf(text, p + 1)) {
      // one lowercase letter inside a word is part of fixed text, not some cell's first letter
      if (text.length === 1 && /\p{Ll}/u.test(text) && letter(p - 1) && letter(p + 1)) continue;
      const m = at[p];
      const list = m.get(text.length) ?? [];
      list.push(atom);
      m.set(text.length, list);
    }
  }
  const found: Piece[][] = [];
  const walk = (p: number, acc: Piece[], lastFixed: boolean) => {
    if (found.length >= MAX_PROGRAMS || acc.length > MAX_PIECES) return;
    if (p === out.length) { found.push(acc.slice()); return; }
    // longer parts first: they make simpler ways
    for (const [len, atoms] of [...at[p]].sort((a, b) => b[0] - a[0])) {
      acc.push({ atoms });
      walk(p + len, acc, false);
      acc.pop();
    }
    if (lastFixed) return;
    // fixed text up to a place where some atom starts (or to the end)
    for (let q = p + 1; q <= out.length; q++) {
      if (q < out.length && !at[q].size) continue;
      acc.push({ text: out.slice(p, q) });
      walk(q, acc, true);
      acc.pop();
    }
  };
  walk(0, [], false);
  return found;
}

/** Keep the atoms of a way that also make another example; null when the way can't make it. */
function narrow(prog: Piece[], row: string[], out: string): Piece[] | null {
  const memo = new Map<string, [number, number][]>();
  const go = (i: number, p: number): Piece[] | null => {
    if (i === prog.length) return p === out.length ? [] : null;
    const piece = prog[i];
    if ('text' in piece) {
      if (!out.startsWith(piece.text, p)) return null;
      const rest = go(i + 1, p + piece.text.length);
      return rest && [piece, ...rest];
    }
    // the atoms grouped by the text they give here; each group that fits is tried
    const groups = new Map<string, Atom[]>();
    for (const a of piece.atoms) {
      const t = evalAtom(a, row, memo);
      if (t === null || !out.startsWith(t, p)) continue;
      const g = groups.get(t) ?? [];
      g.push(a);
      groups.set(t, g);
    }
    for (const [t, atoms] of [...groups].sort((a, b) => b[0].length - a[0].length)) {
      const rest = go(i + 1, p + t.length);
      if (rest) return [{ atoms }, ...rest];
    }
    return null;
  };
  return go(0, 0);
}

export interface FlashExample {
  /** The texts of the row's cells (by column of the table). */
  row: string[];
  /** What was typed beside them. */
  out: string;
}

export interface FlashResult {
  /** What each row to fill gets (null: the way found doesn't work for that row). */
  values: (string | null)[];
  /** The way found, in words (for the message after filling). */
  describe: string;
}

/**
 * Work out a way that makes every example from its row, and use it on the other rows. Null
 * when no way fits all the examples.
 */
export function flashFill(examples: FlashExample[], rows: string[][]): FlashResult | null {
  const ex = examples.filter((e) => e.out !== '');
  if (!ex.length) return null;
  let candidates: Piece[][] = programs(ex[0].row, ex[0].out);
  for (const e of ex.slice(1)) {
    candidates = candidates.map((p) => narrow(p, e.row, e.out)).filter((p): p is Piece[] => !!p);
    if (!candidates.length) return null;
  }
  if (!candidates.length) return null;
  // the simplest way: fewest fixed characters, then fewest pieces, then the simplest atoms
  const ref = ex[0].row;
  const best = (p: Piece) => ('atoms' in p ? p.atoms.reduce((m, a) => (atomCost(a, ref) < atomCost(m, ref) ? a : m)) : null);
  // fixed letters and digits cost more than fixed punctuation, which is usually what joins the parts
  const fixed = (t: string) => [...t].reduce((n, ch) => n + (/[\p{L}\p{N}]/u.test(ch) ? 5 : 0.5), 1);
  const cost = (prog: Piece[]) => prog.reduce((s, p) => s + ('text' in p ? fixed(p.text) : 1 + atomCost(best(p)!, ref)), 0);
  candidates.sort((a, b) => cost(a) - cost(b));
  const prog = candidates[0].map((p) => ('text' in p ? p : { atoms: [best(p)!] }));
  const values = rows.map((row) => {
    let s = '';
    for (const p of prog) {
      if ('text' in p) { s += p.text; continue; }
      const t = evalAtom(p.atoms[0], row);
      if (t === null) return null;
      s += t;
    }
    return s;
  });
  return { values, describe: prog.map((p) => ('text' in p ? JSON.stringify(p.text) : describeAtom(p.atoms[0]))).join(' + ') };
}

const ORD = ['first', 'second', 'third', 'fourth', 'fifth'];

function describeAtom(a: Atom): string {
  const name = a.cut === 'whole' ? 'text' : a.cut === 'words' ? 'word' : a.cut === 'alnum' ? 'part' : 'run';
  const nth = (x: number) => (x >= 0 ? ORD[x] ?? `${x + 1}th` : x === -1 ? 'last' : `${ORD[-x - 1] ?? `${-x}th`} from last`);
  const what = a.cut === 'whole' ? 'the text' : a.from === a.to ? `the ${nth(a.from)} ${name}` : `${name}s ${nth(a.from)} to ${nth(a.to)}`;
  const ch = a.change === 'same' ? '' : a.change === 'initial' ? ', first letter' : a.change === 'initial-upper' ? ', first letter in capitals' : `, ${a.change === 'proper' ? 'capitalised' : `in ${a.change}case`}`;
  return `${what}${ch} of column ${a.col + 1}`;
}
