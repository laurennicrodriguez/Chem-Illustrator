// Data > Get Data, as Excel's Power Query does it without its M language: data read from a
// CSV or text file, a JSON file, the tables of a web page or another workbook, then a list of
// steps (remove columns, split, filter, change type, unpivot…) worked through in order. The
// steps are kept with the workbook, so Refresh reads the data again and runs the same steps on
// it. Everything here is pure: reading the file or page is the caller's job.

import { CellError, ERR, Value, compareValues, isError, numberText, readTyped } from './values';
import { readDateTime } from './dates';
import { parseDelimited } from './csv';

/** What a column holds, as Power Query's data types (any: left as it came). */
export type ColType = 'any' | 'text' | 'number' | 'whole' | 'percent' | 'date' | 'logical';

export const TYPE_NAMES: Record<ColType, string> = {
  any: 'Any', text: 'Text', number: 'Decimal Number', whole: 'Whole Number', percent: 'Percentage', date: 'Date', logical: 'True/False',
};

/** A table of data as the steps see it: named columns, each with a type, and rows of values. */
export interface QTable {
  cols: string[];
  types: ColType[];
  rows: Value[][];
}

export type FilterTest = 'equals' | 'notEquals' | 'contains' | 'notContains' | 'begins' | 'ends' | 'gt' | 'ge' | 'lt' | 'le' | 'blank' | 'notBlank';

export const FILTER_NAMES: Record<FilterTest, string> = {
  equals: 'equals', notEquals: 'does not equal', contains: 'contains', notContains: 'does not contain', begins: 'begins with', ends: 'ends with',
  gt: 'is greater than', ge: 'is greater than or equal to', lt: 'is less than', le: 'is less than or equal to', blank: 'is blank', notBlank: 'is not blank',
};

export type QueryStep =
  | { op: 'promoteHeaders' }
  | { op: 'removeTopRows'; n: number }
  | { op: 'removeBlankRows' }
  | { op: 'removeColumns'; cols: string[] }
  | { op: 'keepColumns'; cols: string[] }
  | { op: 'rename'; from: string; to: string }
  | { op: 'changeType'; types: Record<string, ColType> }
  | { op: 'filter'; col: string; test: FilterTest; value?: string }
  | { op: 'split'; col: string; by: string; mode: 'each' | 'left' | 'right'; n?: number }
  /** With `other`, `cols` are the columns kept and every other column is unpivoted. */
  | { op: 'unpivot'; cols: string[]; other?: boolean; attr: string; value: string }
  | { op: 'replace'; col: string; find: string; with: string }
  | { op: 'sort'; col: string; desc?: boolean }
  /** No columns: rows the same in every column. */
  | { op: 'removeDuplicates'; cols: string[] }
  | { op: 'trim'; cols: string[] };

/** Where a query's data comes from. `file` is the file's path in the desktop app, else its name. */
export type QuerySource =
  | { kind: 'text'; file: string; delimiter: string }
  | { kind: 'json'; file?: string; url?: string; path?: string }
  | { kind: 'web'; url: string; table: number }
  | { kind: 'workbook'; file: string; item: string };

export interface Query {
  id: number;
  name: string;
  source: QuerySource;
  steps: QueryStep[];
  /** The table its results are loaded into (null: only a connection, loaded nowhere). */
  table: string | null;
  /** When it was last read (ISO time). */
  refreshed?: string;
}

let nextQueryId = 1;
export function newQueryId(): number {
  return nextQueryId++;
}
export function seenQueryId(id: number): void {
  if (id >= nextQueryId) nextQueryId = id + 1;
}

/** A name for a new query, from its source's name, not yet used ("Reactions", "Reactions (2)"). */
export function newQueryName(base: string, taken: string[]): string {
  const b = base.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').trim() || 'Query';
  const low = new Set(taken.map((t) => t.toLowerCase()));
  if (!low.has(b.toLowerCase())) return b;
  for (let n = 2; ; n++) if (!low.has(`${b} (${n})`.toLowerCase())) return `${b} (${n})`;
}

/** A name Excel takes for a table: letters, digits, _ and . only, starting with a letter or _. */
export function tableNameFor(name: string, taken: string[]): string {
  let b = name.replace(/[^A-Za-z0-9_.]+/g, '_').replace(/^_+|_+$/g, '') || 'Query';
  if (!/^[A-Za-z_]/.test(b)) b = '_' + b;
  // names that read as cell references (A1, R1C1) aren't allowed
  if (/^[A-Za-z]{1,3}\d+$/.test(b) || /^[RC]$/i.test(b)) b = '_' + b;
  const low = new Set(taken.map((t) => t.toLowerCase()));
  if (!low.has(b.toLowerCase())) return b;
  for (let n = 2; ; n++) if (!low.has(`${b}_${n}`.toLowerCase())) return `${b}_${n}`;
}

// ---------------------------------------------------------------- reading sources

const colNames = (n: number): string[] => Array.from({ length: n }, (_, i) => `Column${i + 1}`);

/** Rows of text as a table with columns Column1, Column2… (the first row not yet taken as headers). */
export function rawTable(rows: Value[][]): QTable {
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return { cols: colNames(w), types: Array(w).fill('any'), rows: rows.map((r) => (r.length === w ? r : [...r, ...Array(w - r.length).fill(null)])) };
}

export const DELIMITERS: [string, string][] = [['auto', 'Detect'], [',', 'Comma'], ['\t', 'Tab'], [';', 'Semicolon'], ['|', 'Vertical bar'], [' ', 'Space'], [':', 'Colon'], ['=', 'Equals sign']];

/** A CSV, TSV or other delimited text file. Fields that are blank are null. */
export function textTable(text: string, delimiter: string): QTable {
  let rows: string[][];
  if (delimiter === 'auto' || delimiter === ',' || delimiter === '\t' || delimiter === ';') rows = parseDelimited(text, delimiter as ',' | '\t' | ';' | 'auto');
  else rows = splitText(text, delimiter);
  while (rows.length && rows[rows.length - 1].every((f) => f === '')) rows.pop();
  return rawTable(rows.map((r) => r.map((f) => (f === '' ? null : f))));
}

/** Text split at any other character (quotes still keep a field whole). */
function splitText(text: string, sep: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!sep) return text.split(/\r\n|\r|\n/).map((l) => [l]);
  const lines = text.split(/\r\n|\r|\n/);
  return lines.map((line) => {
    const out: string[] = [];
    let field = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"') { if (line[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch;
      } else if (ch === '"' && field === '') quoted = true;
      else if (line.startsWith(sep, i)) { out.push(field); field = ''; i += sep.length - 1; } else field += ch;
    }
    out.push(field);
    return out;
  });
}

/** Where tables of records are in some JSON: "" for the top level, else a path of keys (data.items). */
export function jsonPaths(data: unknown, max = 40): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string, depth: number) => {
    if (out.length >= max || depth > 6) return;
    if (Array.isArray(v)) {
      if (v.length && v.some((x) => (x && typeof x === 'object') || Array.isArray(x))) out.push(path);
      else if (v.length && path) out.push(path);
      return;
    }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, depth + 1);
  };
  walk(data, '', 0);
  // a single object of values is a table of one row
  if (!out.length && data && typeof data === 'object') out.push('');
  return out;
}

function atPath(data: unknown, path: string): unknown {
  if (!path) return data;
  let v = data;
  for (const k of path.split('.')) {
    if (!v || typeof v !== 'object') return undefined;
    v = (v as Record<string, unknown>)[k];
  }
  return v;
}

const jsonValue = (v: unknown): Value => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  if (Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object')) return v.map((x) => (x === null ? '' : String(x))).join(', ');
  return JSON.stringify(v);
};

/** Nested objects as columns of their own ("price.amount"), as Power Query expands them. */
function flatten(o: Record<string, unknown>, into: Map<string, unknown>, prefix = '', depth = 0): void {
  for (const [k, v] of Object.entries(o)) {
    const name = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 4) flatten(v as Record<string, unknown>, into, name, depth + 1);
    else into.set(name, v);
  }
}

/** The records at a place in some JSON, as a table: objects give named columns, arrays give rows. */
export function jsonTable(text: string, path = ''): QTable {
  const data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown;
  let v = atPath(data, path);
  if (v === undefined) throw new Error(`The JSON has nothing at "${path}".`);
  if (!Array.isArray(v)) v = [v];
  const list = v as unknown[];
  if (list.every((x) => Array.isArray(x))) return rawTable((list as unknown[][]).map((r) => r.map(jsonValue)));
  const cols: string[] = [];
  const seen = new Set<string>();
  const recs = list.map((x) => {
    const m = new Map<string, unknown>();
    if (x && typeof x === 'object' && !Array.isArray(x)) flatten(x as Record<string, unknown>, m);
    else m.set('Value', x);
    for (const k of m.keys()) if (!seen.has(k)) { seen.add(k); cols.push(k); }
    return m;
  });
  const rows = recs.map((m) => cols.map((c) => jsonValue(m.get(c))));
  return { cols, types: cols.map((_, i) => detectType(rows.map((r) => r[i]), true)), rows };
}

/** A web page's tables: a name for each (its caption, else its id, else Table 1, Table 2…) and its cells. */
export function htmlTables(html: string): { name: string; table: QTable }[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: { name: string; table: QTable }[] = [];
  doc.querySelectorAll('table').forEach((t, i) => {
    // cells spanning rows or columns are copied into each place they cover
    const grid: (string | null)[][] = [];
    const heads: boolean[] = [];
    const trs = [...t.querySelectorAll('tr')].filter((tr) => tr.closest('table') === t);
    trs.forEach((tr, r) => {
      grid[r] ??= [];
      let c = 0;
      const cells = [...tr.children].filter((x) => x.tagName === 'TD' || x.tagName === 'TH');
      heads[r] = cells.length > 0 && (cells.every((x) => x.tagName === 'TH') || tr.parentElement?.tagName === 'THEAD');
      for (const cell of cells) {
        while (grid[r][c] !== undefined) c++;
        const text = (cell.textContent ?? '').replace(/\s+/g, ' ').trim();
        const cs = Math.max(1, Math.min(50, Number(cell.getAttribute('colspan')) || 1));
        const rs = Math.max(1, Math.min(500, Number(cell.getAttribute('rowspan')) || 1));
        for (let dr = 0; dr < rs; dr++) {
          grid[r + dr] ??= [];
          for (let dc = 0; dc < cs; dc++) grid[r + dr][c + dc] = text === '' ? null : text;
        }
        c += cs;
      }
    });
    const rows = grid.filter((r) => r && r.length).map((r) => Array.from(r, (x) => x ?? null));
    if (!rows.length) return;
    const caption = t.querySelector('caption')?.textContent?.replace(/\s+/g, ' ').trim();
    const table = rawTable(rows);
    // a header row of <th> cells names the columns
    if (heads[0] && rows.length > 1) {
      const named = runSteps(table, [{ op: 'promoteHeaders' }]);
      if (!('error' in named)) { out.push({ name: caption || t.id || `Table ${i + 1}`, table: withTypes(named.table) }); return; }
    }
    out.push({ name: caption || t.id || `Table ${i + 1}`, table: withTypes(table) });
  });
  return out;
}

/** Strings read as numbers, dates and so on where a whole column reads that way. */
function withTypes(t: QTable): QTable {
  const types: Record<string, ColType> = {};
  t.cols.forEach((c, i) => { types[c] = detectType(t.rows.map((r) => r[i])); });
  const got = runSteps(t, [{ op: 'changeType', types }]);
  return 'error' in got ? t : got.table;
}

// ---------------------------------------------------------------- types

const isBlank = (v: Value) => v === null || v === '';

/** The type a column's values read as (the first 200 looked at), as Power Query detects them. */
export function detectType(values: Value[], typedOnly = false): ColType {
  let kind: ColType | null = null;
  let n = 0;
  for (const v of values) {
    if (isBlank(v) || isError(v)) continue;
    if (++n > 200) break;
    let k: ColType;
    if (typeof v === 'number') k = Number.isInteger(v) ? 'whole' : 'number';
    else if (typeof v === 'boolean') k = 'logical';
    else if (typedOnly) k = 'text';
    else {
      const s = String(v).trim();
      const up = s.toUpperCase();
      if (up === 'TRUE' || up === 'FALSE') k = 'logical';
      else if (/^[+-]?(\d+(\.\d*)?|\.\d+)\s*%$/.test(s)) k = 'percent';
      else if (/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s) && !/^[+-]?0\d/.test(s)) k = /[.eE]/.test(s) ? 'number' : 'whole';
      else if (readDateTime(s, true) && /\d{4}|[A-Za-z]{3}/.test(s)) k = 'date';
      else k = 'text';
    }
    if (kind === null) kind = k;
    else if (kind !== k) {
      if ((kind === 'whole' && k === 'number') || (kind === 'number' && k === 'whole')) kind = 'number';
      else return 'text';
    }
  }
  return kind ?? 'any';
}

/** A value as a type ("12" as a whole number). Values that can't be are errors, as in Power Query. */
export function convert(v: Value, type: ColType): Value {
  if (type === 'any' || isError(v)) return v;
  if (v === null) return null;
  if (typeof v === 'string' && v.trim() === '' && type !== 'text') return null;
  const bad = (): CellError => ERR.value(`"${typeof v === 'string' ? v : String(v)}" can't be read as ${TYPE_NAMES[type]}`);
  switch (type) {
    case 'text':
      return typeof v === 'string' ? v : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : numberText(v);
    case 'logical': {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v !== 0;
      const s = v.trim().toLowerCase();
      if (s === 'true' || s === 'yes' || s === '1') return true;
      if (s === 'false' || s === 'no' || s === '0') return false;
      return bad();
    }
    case 'number': case 'whole': case 'percent': {
      let n: number;
      if (typeof v === 'number') n = v;
      else if (typeof v === 'boolean') n = v ? 1 : 0;
      else {
        const t = readTyped(v.trim());
        if (typeof t.value !== 'number' || t.formula || (t.format && /[dmyhs]/i.test(t.format.replace(/"[^"]*"/g, '')) && !/%/.test(t.format))) return bad();
        n = t.value;
        // "12" as a percentage is 12%, as Power Query reads it
        if (type === 'percent' && !/%/.test(v)) n /= 100;
      }
      return type === 'whole' ? Math.round(n) : n;
    }
    case 'date': {
      if (typeof v === 'number') return Math.floor(v);
      if (typeof v === 'boolean') return bad();
      const d = readDateTime(v.trim());
      return d ? Math.floor(d.value) : bad();
    }
  }
}

// ---------------------------------------------------------------- the steps

/** A step's name as the Applied Steps list shows it. */
export function stepName(s: QueryStep): string {
  switch (s.op) {
    case 'promoteHeaders': return 'Promoted Headers';
    case 'removeTopRows': return `Removed Top Rows (${s.n})`;
    case 'removeBlankRows': return 'Removed Blank Rows';
    case 'removeColumns': return `Removed Columns (${s.cols.join(', ')})`;
    case 'keepColumns': return `Removed Other Columns (kept ${s.cols.join(', ')})`;
    case 'rename': return `Renamed Column (${s.from} to ${s.to})`;
    case 'changeType': return `Changed Type (${Object.entries(s.types).map(([c, t]) => `${c}: ${TYPE_NAMES[t]}`).join(', ')})`;
    case 'filter': return `Filtered Rows (${s.col} ${FILTER_NAMES[s.test]}${s.test === 'blank' || s.test === 'notBlank' ? '' : ` ${s.value ?? ''}`})`;
    case 'split': return `Split Column by Delimiter (${s.col} at ${s.by === '\t' ? 'tab' : s.by === ' ' ? 'space' : `"${s.by}"`}${s.mode === 'each' ? '' : `, ${s.mode === 'left' ? 'left-most' : 'right-most'} only`})`;
    case 'unpivot': return s.other ? `Unpivoted Other Columns (kept ${s.cols.join(', ')})` : `Unpivoted Columns (${s.cols.join(', ')})`;
    case 'replace': return `Replaced Value (${s.col}: "${s.find}" with "${s.with}")`;
    case 'sort': return `Sorted Rows (${s.col}, ${s.desc ? 'descending' : 'ascending'})`;
    case 'removeDuplicates': return s.cols.length ? `Removed Duplicates (${s.cols.join(', ')})` : 'Removed Duplicates';
    case 'trim': return `Trimmed Text (${s.cols.join(', ')})`;
  }
}

/** The steps a source is first given: its first row as headers, when it looks like them, and each column's type. */
export function firstSteps(raw: QTable, headed: boolean): QueryStep[] {
  const steps: QueryStep[] = [];
  let t = raw;
  if (!headed && looksHeaded(raw)) {
    steps.push({ op: 'promoteHeaders' });
    const got = runSteps(raw, steps);
    if (!('error' in got)) t = got.table;
  }
  const types: Record<string, ColType> = {};
  t.cols.forEach((c, i) => {
    if (t.types[i] !== 'any') return;
    const k = detectType(t.rows.map((r) => r[i]));
    if (k !== 'any') types[c] = k;
  });
  if (Object.keys(types).length) steps.push({ op: 'changeType', types });
  return steps;
}

/** Is the first row names for the columns: all text, filled in and all different (as Power Query takes it)? */
function looksHeaded(t: QTable): boolean {
  if (t.rows.length < 2) return false;
  const first = t.rows[0];
  if (first.some((v) => typeof v !== 'string' || !v.trim())) return false;
  if (new Set(first.map((v) => String(v).trim().toLowerCase())).size !== first.length) return false;
  return first.every((v) => detectType([v]) === 'text');
}

/** Each step in turn. An error names the step that went wrong (by its place in the list). */
export function runSteps(start: QTable, steps: QueryStep[], upTo = steps.length): { table: QTable } | { error: string; step: number; table: QTable } {
  let t = start;
  for (let i = 0; i < Math.min(upTo, steps.length); i++) {
    try {
      t = applyStep(t, steps[i]);
    } catch (e) {
      return { error: (e as Error).message, step: i, table: t };
    }
  }
  return { table: t };
}

class StepError extends Error {}

function colIndex(t: QTable, name: string): number {
  const i = t.cols.indexOf(name);
  if (i < 0) throw new StepError(`The column "${name}" isn't in the table.`);
  return i;
}

/** Names made different and filled in: Column1 for a blank, Name_1 for a second Name. */
function uniqueNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((n, i) => {
    let b = n.trim() || `Column${i + 1}`;
    if (used.has(b)) { let k = 1; while (used.has(`${b}_${k}`)) k++; b = `${b}_${k}`; }
    used.add(b);
    return b;
  });
}

const textOf = (v: Value): string => (v === null ? '' : isError(v) ? v.code : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : typeof v === 'number' ? numberText(v) : v);

function passes(v: Value, test: FilterTest, value: string | undefined, type: ColType): boolean {
  if (test === 'blank') return isBlank(v);
  if (test === 'notBlank') return !isBlank(v);
  if (isError(v)) return false;
  const want = value ?? '';
  if (test === 'contains' || test === 'notContains' || test === 'begins' || test === 'ends') {
    const a = textOf(v).toLowerCase(), b = want.toLowerCase();
    const r = test === 'begins' ? a.startsWith(b) : test === 'ends' ? a.endsWith(b) : a.includes(b);
    return test === 'notContains' ? !r : r;
  }
  // compared as the column's type: 5 > 10 is false for numbers, true for text
  let w: Value = want;
  if (type !== 'text' && type !== 'any') {
    const c = convert(want, type);
    if (!isError(c)) w = c;
  } else if (typeof v === 'number' || typeof v === 'boolean') {
    const t = readTyped(want);
    if (!t.formula && typeof t.value === typeof v) w = t.value;
  }
  if (isBlank(v) && test !== 'notEquals') return false;
  const c = compareValues(v, w);
  switch (test) {
    case 'equals': return c === 0;
    case 'notEquals': return c !== 0;
    case 'gt': return c > 0;
    case 'ge': return c >= 0;
    case 'lt': return c < 0;
    default: return c <= 0;
  }
}

/** The number of columns a split by delimiter makes, as many as the most pieces in the column. */
export function splitCount(t: QTable, col: string, by: string): number {
  const i = t.cols.indexOf(col);
  if (i < 0 || !by) return 1;
  return Math.max(1, ...t.rows.map((r) => (isBlank(r[i]) ? 1 : textOf(r[i]).split(by).length)));
}

function applyStep(t: QTable, s: QueryStep): QTable {
  switch (s.op) {
    case 'promoteHeaders': {
      if (!t.rows.length) return t;
      const cols = uniqueNames(t.rows[0].map(textOf));
      return { cols, types: t.types.map(() => 'any'), rows: t.rows.slice(1) };
    }
    case 'removeTopRows':
      return { ...t, rows: t.rows.slice(Math.max(0, s.n)) };
    case 'removeBlankRows':
      return { ...t, rows: t.rows.filter((r) => r.some((v) => !isBlank(v))) };
    case 'removeColumns': {
      const drop = new Set(s.cols.map((c) => colIndex(t, c)));
      const keep = t.cols.map((_, i) => i).filter((i) => !drop.has(i));
      return pick(t, keep);
    }
    case 'keepColumns':
      return pick(t, s.cols.map((c) => colIndex(t, c)));
    case 'rename': {
      const i = colIndex(t, s.from);
      const to = s.to.trim();
      if (!to) throw new StepError('A column needs a name.');
      if (to !== s.from && t.cols.includes(to)) throw new StepError(`There is a column called "${to}" already.`);
      const cols = t.cols.slice();
      cols[i] = to;
      return { ...t, cols };
    }
    case 'changeType': {
      const types = t.types.slice();
      const at = Object.entries(s.types).map(([c, k]) => { const i = colIndex(t, c); types[i] = k; return [i, k] as const; });
      const rows = t.rows.map((r) => {
        const out = r.slice();
        for (const [i, k] of at) out[i] = convert(r[i], k);
        return out;
      });
      return { cols: t.cols, types, rows };
    }
    case 'filter': {
      const i = colIndex(t, s.col);
      return { ...t, rows: t.rows.filter((r) => passes(r[i], s.test, s.value, t.types[i])) };
    }
    case 'split': {
      const i = colIndex(t, s.col);
      if (!s.by) throw new StepError('Give the character to split at.');
      const n = s.mode === 'each' ? Math.max(1, s.n ?? splitCount(t, s.col, s.by)) : 2;
      const pieces = t.rows.map((r) => {
        if (isBlank(r[i])) return Array(n).fill(null) as Value[];
        const text = textOf(r[i]);
        let parts: string[];
        if (s.mode === 'each') parts = text.split(s.by).slice(0, n);
        else {
          const k = s.mode === 'left' ? text.indexOf(s.by) : text.lastIndexOf(s.by);
          parts = k < 0 ? [text] : [text.slice(0, k), text.slice(k + s.by.length)];
        }
        return Array.from({ length: n }, (_, j) => (parts[j] === undefined || parts[j] === '' ? null : parts[j]));
      });
      const names = uniqueNames([...t.cols.slice(0, i), ...Array.from({ length: n }, (_, j) => `${s.col}.${j + 1}`), ...t.cols.slice(i + 1)]).slice(i, i + n);
      const types = names.map((_, j) => detectType(pieces.map((p) => p[j])));
      const rows = t.rows.map((r, ri) => [...r.slice(0, i), ...pieces[ri].map((v, j) => convert(v, types[j])), ...r.slice(i + 1)]);
      return { cols: [...t.cols.slice(0, i), ...names, ...t.cols.slice(i + 1)], types: [...t.types.slice(0, i), ...types, ...t.types.slice(i + 1)], rows };
    }
    case 'unpivot': {
      const named = new Set(s.cols.map((c) => colIndex(t, c)));
      const keep = t.cols.map((_, i) => i).filter((i) => (s.other ? named.has(i) : !named.has(i)));
      const turn = t.cols.map((_, i) => i).filter((i) => !keep.includes(i));
      const attr = s.attr.trim() || 'Attribute', value = s.value.trim() || 'Value';
      const cols = uniqueNames([...keep.map((i) => t.cols[i]), attr, value]);
      const vt = new Set(turn.map((i) => t.types[i]));
      const rows: Value[][] = [];
      for (const r of t.rows) {
        for (const i of turn) {
          // blank values make no row, as in Power Query
          if (r[i] === null) continue;
          rows.push([...keep.map((k) => r[k]), t.cols[i], r[i]]);
        }
      }
      return { cols, types: [...keep.map((i) => t.types[i]), 'text', vt.size === 1 ? [...vt][0] : 'any'], rows };
    }
    case 'replace': {
      const i = colIndex(t, s.col);
      const rows = t.rows.map((r) => {
        const v = r[i];
        let nv: Value = v;
        if (t.types[i] === 'text' || t.types[i] === 'any' || typeof v === 'string') {
          // text: every place the text is found; anything else: the whole value
          if (typeof v === 'string' && s.find !== '') nv = v.split(s.find).join(s.with);
          else if (isBlank(v) && s.find === '') nv = s.with === '' ? null : s.with;
        } else if (textOf(v) === s.find || (isBlank(v) && s.find === '')) nv = convert(s.with === '' ? null : s.with, t.types[i]);
        if (nv === v) return r;
        const out = r.slice();
        out[i] = nv;
        return out;
      });
      return { ...t, rows };
    }
    case 'sort': {
      const i = colIndex(t, s.col);
      const sign = s.desc ? -1 : 1;
      // blanks go last either way
      const rows = t.rows.map((r, k) => ({ r, k })).sort((a, b) => {
        const x = a.r[i], y = b.r[i];
        if (isBlank(x) || isBlank(y)) return isBlank(x) === isBlank(y) ? a.k - b.k : isBlank(x) ? 1 : -1;
        return sign * compareValues(isError(x) ? x.code : x, isError(y) ? y.code : y) || a.k - b.k;
      }).map((x) => x.r);
      return { ...t, rows };
    }
    case 'removeDuplicates': {
      const at = s.cols.length ? s.cols.map((c) => colIndex(t, c)) : t.cols.map((_, i) => i);
      const seen = new Set<string>();
      return {
        ...t, rows: t.rows.filter((r) => {
          const key = JSON.stringify(at.map((i) => (isError(r[i]) ? (r[i] as CellError).code : r[i])));
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      };
    }
    case 'trim': {
      const at = s.cols.map((c) => colIndex(t, c));
      return { ...t, rows: t.rows.map((r) => { const out = r.slice(); for (const i of at) if (typeof out[i] === 'string') out[i] = (out[i] as string).trim().replace(/\s+/g, ' ') || null; return out; }) };
    }
  }
}

function pick(t: QTable, keep: number[]): QTable {
  return { cols: keep.map((i) => t.cols[i]), types: keep.map((i) => t.types[i]), rows: t.rows.map((r) => keep.map((i) => r[i])) };
}

/** The source described in a line, for the Queries & Connections list. */
export function sourceText(src: QuerySource): string {
  const file = (f: string) => f.replace(/^.*[\\/]/, '');
  switch (src.kind) {
    case 'text': return `Text/CSV: ${file(src.file)}`;
    case 'json': return `JSON: ${src.url ?? file(src.file ?? '')}${src.path ? ` (${src.path})` : ''}`;
    case 'web': return `Web: ${src.url} (table ${src.table + 1})`;
    case 'workbook': return `Workbook: ${file(src.file)} (${src.item})`;
  }
}
