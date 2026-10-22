// Data > Get Data and the Query Editor (Power Query lite). Get Data reads a CSV or text file, a
// JSON file, a web page's tables or another workbook, and opens the Query Editor on it: a
// preview of the data, buttons that each add a step (remove or keep columns, rename, change
// type, filter, split, replace, sort, remove duplicates, unpivot…), and the list of Applied
// Steps, any of which can be looked at or taken away. Close & Load writes the results into a
// table; Refresh (or Refresh All) reads the source again and runs the same steps.
//
// The desktop app reads files by their path and web pages through the app itself (pages can't
// fetch from other sites). In a browser a file is read again from the copy picked this session,
// or asked for again; web pages can be read only where the site allows it.

import { invoke, isTauri } from '@tauri-apps/api/core';
import type { SheetView } from './sheet-view';
import { popupMenu } from './sheet-view';
import { ToolWindow } from './tool-window';
import { ask } from './ask';
import type { Sheet, Workbook } from '../sheet/workbook';
import { cellName, parseCellRef, parseRange } from '../sheet/refs';
import { formatValue } from '../sheet/numfmt';
import { isError, type Value } from '../sheet/values';
import {
  type Query, type QuerySource, type QueryStep, type QTable, type ColType, type FilterTest,
  TYPE_NAMES, FILTER_NAMES, DELIMITERS, newQueryId, newQueryName, textTable, jsonTable, jsonPaths, htmlTables,
  rawTable, firstSteps, runSteps, stepName, splitCount, sourceText,
} from '../sheet/query';
import { queryTable, queryOfTable, resultRange, loadProblem, wouldCover, writeResult, fitWidths, DATE_FORMAT } from '../sheet/query-sheet';
import { openBytesDialog, readPath, type FileType } from '../io/files';
import { decodeText } from '../io/sheet-files';
import { readXlsx } from '../io/xlsx';
import { readXls, isXls } from '../io/xls';
import { readOds, isOds } from '../io/ods';

export interface QueryUiHost {
  readonly view: SheetView;
  flash(msg: string, ms?: number): void;
}

const desktop = isTauri();

const TEXT_TYPES: FileType[] = [
  { description: 'CSV (comma-separated values)', extension: 'csv', mime: 'text/csv' },
  { description: 'Tab-separated values', extension: 'tsv', mime: 'text/tab-separated-values' },
  { description: 'Text', extension: 'txt', mime: 'text/plain' },
  { description: 'Data file', extension: 'dat', mime: 'text/plain' },
];
const JSON_TYPES: FileType[] = [{ description: 'JSON', extension: 'json', mime: 'application/json' }];
const BOOK_TYPES: FileType[] = [
  { description: 'Excel workbook', extension: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { description: 'Excel macro-enabled workbook', extension: 'xlsm', mime: 'application/vnd.ms-excel.sheet.macroEnabled.12' },
  { description: 'Excel 97-2003 workbook', extension: 'xls', mime: 'application/vnd.ms-excel' },
  { description: 'OpenDocument spreadsheet', extension: 'ods', mime: 'application/vnd.oasis.opendocument.spreadsheet' },
];

const isUrl = (s: string) => /^https?:\/\//i.test(s.trim());

/** Files picked this session in a browser, by name (a browser can't open a file again by its path). */
const picked = new Map<string, Uint8Array>();

/** A web address read (in the desktop app, by the app; in a browser, where the site allows it). */
async function readUrl(url: string): Promise<Uint8Array> {
  if (desktop) {
    try {
      return new Uint8Array(await invoke<ArrayBuffer>('web_get', { url }));
    } catch (e) {
      throw new Error(String(e));
    }
  }
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error(`Could not read ${url}. In a browser only sites that allow it can be read; the desktop app can read any page.`);
  }
  if (!res.ok) throw new Error(`${url} answered with an error (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

/** A source file read again: by its path (desktop), from this session's copy, or asked for. */
async function readFile(file: string, types: FileType[]): Promise<Uint8Array> {
  if (isUrl(file)) return readUrl(file);
  if (desktop && /[\\/]/.test(file)) {
    try {
      return await readPath(file);
    } catch {
      throw new Error(`Could not read ${file}: has it been moved or renamed? Change Source in the Query Editor points the query at it again.`);
    }
  }
  const name = file.replace(/^.*[\\/]/, '');
  const have = picked.get(name);
  if (have) return have;
  const ok = await ask('Find the file', [], { ok: 'Choose…', note: `The query reads ${name}. A browser can't open it again by itself: choose it to read it.` });
  if (!ok) throw new Error(`${name} wasn't chosen.`);
  const got = await openBytesDialog('Data files', types);
  if (!got) throw new Error(`${name} wasn't chosen.`);
  picked.set(name, got.bytes);
  return got.bytes;
}

/** A workbook from its bytes (no structures drawn: only its values are wanted). */
async function readBook(bytes: Uint8Array, name: string): Promise<Workbook> {
  const ext = name.replace(/^.*\./, '').toLowerCase();
  if (ext === 'ods' || isOds(bytes)) return readOds(bytes).book;
  if (ext === 'xls' || isXls(bytes)) return readXls(bytes).book;
  return (await readXlsx(bytes)).book;
}

/** The tables and sheets of a workbook that a query can read: "table:Name" and "sheet:Name". */
function bookItems(wb: Workbook): { item: string; label: string }[] {
  return [
    ...wb.sheets.flatMap((s) => s.tables.map((t) => ({ item: `table:${t.name}`, label: `Table ${t.name} (${s.name})` }))),
    ...wb.sheets.filter((s) => !s.dashboard).map((s) => ({ item: `sheet:${s.name}`, label: `Sheet ${s.name}` })),
  ];
}

/** A workbook's table or sheet as a table of values (a sheet's first row not yet taken as headers). */
function bookTable(wb: Workbook, item: string): { table: QTable; headed: boolean } {
  const [kind, ...rest] = item.split(':');
  const name = rest.join(':');
  const values = (s: Sheet, r1: number, c1: number, r2: number, c2: number): Value[][] => {
    const rows: Value[][] = [];
    for (let r = r1; r <= r2; r++) {
      const line: Value[] = [];
      for (let c = c1; c <= c2; c++) {
        const v = s.value(r, c);
        line.push(isError(v) && v.code === '#BUSY!' ? null : v);
      }
      rows.push(line);
    }
    return rows;
  };
  if (kind === 'table') {
    for (const s of wb.sheets) {
      const t = s.tables.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!t) continue;
      const R = t.range;
      const rows = values(s, R.r1, R.c1, t.totals ? R.r2 - 1 : R.r2, R.c2);
      const heads = rows.shift()!.map((v, i) => (v === null ? `Column${i + 1}` : String(v)));
      return { table: { cols: heads, types: heads.map(() => 'any'), rows }, headed: true };
    }
    throw new Error(`The workbook has no table called ${name}.`);
  }
  const s = wb.sheetNamed(name);
  if (!s) throw new Error(`The workbook has no sheet called ${name}.`);
  if (s.lastRow < 0) return { table: rawTable([]), headed: false };
  return { table: rawTable(values(s, 0, 0, Math.max(s.lastRow, s.lastDataRow), s.lastCol)), headed: false };
}

/** What a source gave when read, so its settings can change without reading it again. */
interface Fetched { bytes: Uint8Array; book?: Workbook }

/** The source read and turned into a table (throws a message to show when it can't be). */
function sourceTable(src: QuerySource, got: Fetched): { table: QTable; headed: boolean } {
  switch (src.kind) {
    case 'text': return { table: textTable(decodeText(got.bytes), src.delimiter), headed: false };
    case 'json': {
      const text = decodeText(got.bytes);
      try {
        return { table: jsonTable(text, src.path ?? ''), headed: true };
      } catch (e) {
        throw new Error(e instanceof SyntaxError ? 'The file isn\'t JSON that can be read.' : (e as Error).message);
      }
    }
    case 'web': {
      const tables = htmlTables(decodeText(got.bytes));
      const t = tables[src.table];
      if (!t) throw new Error(tables.length ? `The page has ${tables.length} table${tables.length > 1 ? 's' : ''} now, not ${src.table + 1}.` : 'The page has no tables.');
      return { table: t.table, headed: true };
    }
    case 'workbook': return bookTable(got.book!, src.item);
  }
}

async function fetchSource(src: QuerySource): Promise<Fetched> {
  switch (src.kind) {
    case 'text': return { bytes: await readFile(src.file, TEXT_TYPES) };
    case 'json': return { bytes: src.url ? await readUrl(src.url) : await readFile(src.file ?? '', JSON_TYPES) };
    case 'web': return { bytes: await readUrl(src.url) };
    case 'workbook': {
      const bytes = await readFile(src.file, BOOK_TYPES);
      return { bytes, book: await readBook(bytes, src.file) };
    }
  }
}

/** A query's results now: the source read again and every step run. */
export async function runQuery(q: Query): Promise<QTable> {
  const got = sourceTable(q.source, await fetchSource(q.source));
  const res = runSteps(got.table, q.steps);
  if ('error' in res) throw new Error(`Step ${res.step + 1} (${stepName(q.steps[res.step])}): ${res.error}`);
  return res.table;
}

const TYPE_BADGE: Record<ColType, string> = { any: 'ABC 123', text: 'ABC', number: '1.2', whole: '123', percent: '%', date: 'Date', logical: 'T/F' };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** A value as the preview shows it (dates as dates, errors as Error). */
function shown(v: Value, type: ColType): string {
  if (v === null) return '';
  if (isError(v)) return 'Error';
  if (type === 'date' && typeof v === 'number') return formatValue(v, DATE_FORMAT).text;
  if (type === 'percent' && typeof v === 'number') return formatValue(v, '0.00%').text;
  return formatValue(v, undefined).text;
}

export class SheetQueries {
  private paneWin: ToolWindow | null = null;

  constructor(private host: QueryUiHost) {}

  private get wb(): Workbook {
    return this.host.view.wb!;
  }

  // ---------------------------------------------------------------- Get Data

  getDataMenu(x: number, y: number): void {
    popupMenu(x, y, [
      ['From Text/CSV…', () => void this.fromText()],
      ['From JSON…', () => void this.fromJson()],
      ['From Web…', () => void this.fromWeb()],
      ['From Workbook…', () => void this.fromWorkbook()],
      null,
      ['Queries & Connections', () => this.queriesPane()],
    ]);
  }

  async fromText(): Promise<void> {
    const got = await openBytesDialog('Text and CSV files', TEXT_TYPES);
    if (!got) return;
    const file = got.ref.kind === 'path' ? got.ref.path : got.name;
    picked.set(got.name, got.bytes);
    const ext = got.name.replace(/^.*\./, '').toLowerCase();
    this.start({ kind: 'text', file, delimiter: ext === 'tsv' ? '\t' : 'auto' }, { bytes: got.bytes }, got.name);
  }

  async fromJson(): Promise<void> {
    const got = await openBytesDialog('JSON files', JSON_TYPES);
    if (!got) return;
    picked.set(got.name, got.bytes);
    let path = '';
    try {
      path = jsonPaths(JSON.parse(decodeText(got.bytes)))[0] ?? '';
    } catch {
      this.host.flash(`${got.name} isn't JSON that can be read.`, 6000);
      return;
    }
    this.start({ kind: 'json', file: got.ref.kind === 'path' ? got.ref.path : got.name, path }, { bytes: got.bytes }, got.name);
  }

  async fromWeb(): Promise<void> {
    const ans = await ask('From Web', [{ name: 'url', label: 'URL', value: 'https://', placeholder: 'https://example.org/data' }], {
      ok: 'OK', note: 'A web page\'s tables, or a CSV or JSON file on the web. Only the address is sent; the page is read as it is now each time the query refreshes.',
    });
    const url = ans?.url.trim();
    if (!url || url === 'https://') return;
    if (!isUrl(url)) { this.host.flash('Give an address starting with http:// or https://.', 5000); return; }
    this.host.flash(`Reading ${url}…`, 30000);
    let bytes: Uint8Array;
    try {
      bytes = await readUrl(url);
    } catch (e) {
      this.host.flash((e as Error).message, 9000);
      return;
    }
    this.host.flash('', 1);
    const text = decodeText(bytes).trimStart();
    const name = url.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/^.*\//, '') || 'Web';
    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        const path = jsonPaths(JSON.parse(text))[0] ?? '';
        this.start({ kind: 'json', url, path }, { bytes }, name);
        return;
      } catch { /* not JSON after all */ }
    }
    if (!text.startsWith('<')) {
      // a CSV or text file
      this.start({ kind: 'text', file: url, delimiter: 'auto' }, { bytes }, name);
      return;
    }
    const tables = htmlTables(text);
    if (!tables.length) { this.host.flash('The page has no tables to read.', 6000); return; }
    const pick = tables.length === 1 ? 0 : await this.navigator('Navigator', tables.map((t, i) => ({ id: String(i), label: `${t.name} (${t.table.rows.length} rows)`, table: t.table })));
    if (pick === null) return;
    const i = Number(pick);
    this.start({ kind: 'web', url, table: i }, { bytes }, tables[i].name.startsWith('Table ') ? name : tables[i].name);
  }

  async fromWorkbook(): Promise<void> {
    const got = await openBytesDialog('Workbooks', BOOK_TYPES);
    if (!got) return;
    picked.set(got.name, got.bytes);
    let book: Workbook;
    try {
      book = await readBook(got.bytes, got.name);
    } catch (e) {
      this.host.flash(`${got.name} could not be read: ${(e as Error).message}`, 8000);
      return;
    }
    const items = bookItems(book);
    if (!items.length) { this.host.flash('The workbook has nothing to read.', 5000); return; }
    const pick = await this.navigator(`Navigator: ${got.name}`, items.map((x) => ({ id: x.item, label: x.label, table: bookTable(book, x.item).table })));
    if (pick === null) return;
    const label = pick.replace(/^[a-z]+:/, '');
    this.start({ kind: 'workbook', file: got.ref.kind === 'path' ? got.ref.path : got.name, item: pick }, { bytes: got.bytes, book }, label);
  }

  /** Excel's Navigator: pick one of several tables, each previewed. Null when cancelled. */
  private navigator(title: string, items: { id: string; label: string; table: QTable }[]): Promise<string | null> {
    return new Promise((resolve) => {
      const w = new ToolWindow(title, 'query-nav');
      let done = false;
      const list = el('div', 'qn-list');
      const preview = el('div', 'qn-preview');
      let chosen = items[0].id;
      const show = (id: string) => {
        chosen = id;
        for (const b of list.querySelectorAll('button')) b.classList.toggle('on', b.dataset.id === id);
        preview.replaceChildren(this.grid(items.find((x) => x.id === id)!.table, 20));
      };
      for (const it of items) {
        const b = el('button', undefined, it.label);
        b.type = 'button';
        b.dataset.id = it.id;
        b.addEventListener('click', () => show(it.id));
        b.addEventListener('dblclick', () => { done = true; w.close(); resolve(it.id); });
        list.append(b);
      }
      const box = el('div', 'qn-box');
      box.append(list, preview);
      w.body.append(box);
      w.onClose = () => { if (!done) resolve(null); };
      w.actions('Transform Data', () => { done = true; resolve(chosen); });
      show(chosen);
      w.show();
    });
  }

  /** A new query on a source just read: its first steps (headers, types), then the editor. */
  private start(source: QuerySource, got: Fetched, name: string): void {
    let raw: { table: QTable; headed: boolean };
    try {
      raw = sourceTable(source, got);
    } catch (e) {
      this.host.flash((e as Error).message, 8000);
      return;
    }
    const q: Query = { id: newQueryId(), name: newQueryName(name, this.wb.queries.map((x) => x.name)), source, steps: firstSteps(raw.table, raw.headed), table: null };
    this.editor(q, got, true);
  }

  // ---------------------------------------------------------------- the Query Editor

  /** The Query Editor on a query (`fresh`: not yet in the workbook). */
  editor(query: Query, got: Fetched | null, fresh: boolean): void {
    let q: Query = { ...query, steps: query.steps.slice() };
    let fetched = got;
    let raw: QTable | null = null;
    let problem: string | null = null;
    /** The step shown: the result after it (the last, unless one is picked). */
    let at = q.steps.length - 1;
    let sel: string[] = [];
    const w = new ToolWindow(`Query Editor: ${q.name}`, 'query-editor');
    const top = el('div', 'qe-top');
    const name = el('input');
    name.value = q.name;
    name.setAttribute('aria-label', 'Query name');
    const nameRow = el('label', 'qe-name');
    nameRow.append(el('span', undefined, 'Name'), name);
    const srcLine = el('span', 'qe-source muted');
    const settings = el('span', 'qe-settings');
    top.append(nameRow, srcLine, settings);
    const tools = el('div', 'qe-tools');
    const main = el('div', 'qe-main');
    const gridBox = el('div', 'qe-grid');
    const side = el('div', 'qe-steps');
    main.append(gridBox, side);
    const status = el('p', 'qe-status muted');
    w.body.append(top, tools, main, status);

    const current = (): { table: QTable; error?: string; step?: number } => {
      if (!raw) return { table: rawTable([]), error: problem ?? 'Reading…' };
      const res = runSteps(raw, q.steps, at + 1);
      return 'error' in res ? { table: res.table, error: res.error, step: res.step } : { table: res.table };
    };

    const reparse = () => {
      if (!fetched) return;
      try {
        raw = sourceTable(q.source, fetched).table;
        problem = null;
      } catch (e) {
        raw = null;
        problem = (e as Error).message;
      }
    };

    const addStep = (s: QueryStep) => {
      q.steps.splice(at + 1, 0, s);
      at++;
      render();
    };

    const need = (n = 1): string[] | null => {
      if (sel.length >= n) return sel;
      this.host.flash(n > 1 ? 'Click the headers of the columns first (Ctrl or Shift for more).' : 'Click a column\'s header first.', 4000);
      return null;
    };

    const tool = (label: string, title: string, fn: () => void | Promise<void>) => {
      const b = el('button', undefined, label);
      b.type = 'button';
      b.title = title;
      b.addEventListener('click', () => void fn());
      tools.append(b);
      return b;
    };
    const t = () => current().table;
    tool('Use First Row as Headers', 'Promote Headers: the first row names the columns', () => addStep({ op: 'promoteHeaders' }));
    tool('Remove Columns', 'Take away the columns picked', () => { const c = need(); if (c) { addStep({ op: 'removeColumns', cols: c.slice() }); sel = []; render(); } });
    tool('Keep Only', 'Remove Other Columns: keep only the columns picked, in the order picked', () => { const c = need(); if (c) addStep({ op: 'keepColumns', cols: c.slice() }); });
    tool('Rename…', 'Rename the column picked', async () => {
      const c = need(); if (!c) return;
      const a = await ask('Rename Column', [{ name: 'to', label: 'New name', value: c[0] }]);
      if (a?.to.trim() && a.to.trim() !== c[0]) { addStep({ op: 'rename', from: c[0], to: a.to.trim() }); sel = [a.to.trim()]; render(); }
    });
    tool('Data Type ▾', 'Change Type: what the columns picked hold (text, numbers, dates…)', () => {
      const c = need(); if (!c) return;
      const b = tools.querySelector<HTMLElement>('[data-qe=type]')!.getBoundingClientRect();
      popupMenu(b.left, b.bottom + 2, (Object.keys(TYPE_NAMES) as ColType[]).map((k) => [TYPE_NAMES[k], () => addStep({ op: 'changeType', types: Object.fromEntries(c.map((x) => [x, k])) })] as [string, () => void]));
    }).dataset.qe = 'type';
    tool('Filter…', 'Filter Rows: keep the rows whose value in the column picked passes a test', async () => {
      const c = need(); if (!c) return;
      const a = await ask(`Filter Rows: ${c[0]}`, [
        { name: 'test', label: 'Keep rows where the value', value: 'equals', options: (Object.keys(FILTER_NAMES) as FilterTest[]).map((k) => ({ value: k, label: FILTER_NAMES[k] })) },
        { name: 'value', label: 'Value', value: '' },
      ]);
      if (a) addStep({ op: 'filter', col: c[0], test: a.test as FilterTest, value: a.value });
    });
    tool('Split Column…', 'Split Column by Delimiter: the column picked into several at a character', async () => {
      const c = need(); if (!c) return;
      const a = await ask(`Split Column: ${c[0]}`, [
        { name: 'by', label: 'Delimiter', value: ',', help: 'Type \\t for a tab.' },
        { name: 'mode', label: 'Split at', value: 'each', options: [{ value: 'each', label: 'Each occurrence of the delimiter' }, { value: 'left', label: 'Left-most delimiter' }, { value: 'right', label: 'Right-most delimiter' }] },
      ]);
      if (!a || !a.by) return;
      const by = a.by.replace(/\\t/g, '\t');
      const mode = a.mode as 'each' | 'left' | 'right';
      addStep({ op: 'split', col: c[0], by, mode, ...(mode === 'each' ? { n: splitCount(t(), c[0], by) } : {}) });
    });
    tool('Replace Values…', 'Replace text (or a whole value) in the column picked', async () => {
      const c = need(); if (!c) return;
      const a = await ask(`Replace Values: ${c[0]}`, [{ name: 'find', label: 'Value To Find', value: '' }, { name: 'with', label: 'Replace With', value: '' }]);
      if (a) addStep({ op: 'replace', col: c[0], find: a.find, with: a.with });
    });
    tool('Trim', 'Take spaces off the ends of text in the columns picked (and runs of spaces in it)', () => { const c = need(); if (c) addStep({ op: 'trim', cols: c.slice() }); });
    tool('Sort ↑', 'Sort the rows by the column picked, smallest first', () => { const c = need(); if (c) addStep({ op: 'sort', col: c[0] }); });
    tool('Sort ↓', 'Sort the rows by the column picked, largest first', () => { const c = need(); if (c) addStep({ op: 'sort', col: c[0], desc: true }); });
    tool('Remove Duplicates', 'Rows that repeat an earlier row in the columns picked (or in every column, when none are picked)', () => addStep({ op: 'removeDuplicates', cols: sel.slice() }));
    tool('Remove Blank Rows', 'Rows with nothing in them', () => addStep({ op: 'removeBlankRows' }));
    tool('Remove Top Rows…', 'Take away a number of rows at the top', async () => {
      const a = await ask('Remove Top Rows', [{ name: 'n', label: 'Number of rows', value: '1', type: 'number' }]);
      const n = Math.floor(Number(a?.n));
      if (n > 0) addStep({ op: 'removeTopRows', n });
    });
    tool('Unpivot Columns', 'The columns picked become rows: one for each value, with the column\'s name beside it (Attribute, Value)', () => {
      const c = need(); if (c) { addStep({ op: 'unpivot', cols: c.slice(), attr: 'Attribute', value: 'Value' }); sel = []; render(); }
    });
    tool('Unpivot Other Columns', 'Every column but those picked becomes rows (Attribute, Value)', () => {
      const c = need(); if (c) { addStep({ op: 'unpivot', cols: c.slice(), other: true, attr: 'Attribute', value: 'Value' }); sel = []; render(); }
    });

    const renderSettings = () => {
      srcLine.textContent = sourceText(q.source);
      settings.replaceChildren();
      const src = q.source;
      const select = (label: string, options: [string, string][], value: string, on: (v: string) => void) => {
        const s = el('select');
        for (const [v, l] of options) s.add(new Option(l, v, false, v === value));
        s.setAttribute('aria-label', label);
        s.addEventListener('change', () => on(s.value));
        const lab = el('label');
        lab.append(el('span', undefined, label), s);
        settings.append(lab);
      };
      if (src.kind === 'text') {
        const opts = DELIMITERS.slice();
        if (!opts.some(([v]) => v === src.delimiter)) opts.push([src.delimiter, `"${src.delimiter}"`]);
        select('Delimiter', opts, src.delimiter, (v) => { q.source = { ...src, delimiter: v }; reparse(); render(); });
      } else if (src.kind === 'json' && fetched) {
        let paths: string[] = [];
        try { paths = jsonPaths(JSON.parse(decodeText(fetched.bytes))); } catch { /* shown as the problem */ }
        if (paths.length > 1) select('Records', paths.map((p) => [p, p || '(top level)']), src.path ?? '', (v) => { q.source = { ...src, path: v }; reparse(); render(); });
      } else if (src.kind === 'web' && fetched) {
        const tables = htmlTables(decodeText(fetched.bytes));
        if (tables.length > 1) select('Table', tables.map((x, i) => [String(i), `${x.name} (${x.table.rows.length} rows)`]), String(src.table), (v) => { q.source = { ...src, table: Number(v) }; reparse(); render(); });
      } else if (src.kind === 'workbook' && fetched?.book) {
        select('Item', bookItems(fetched.book).map((x) => [x.item, x.label]), src.item, (v) => { q.source = { ...src, item: v }; reparse(); render(); });
      }
      if (src.kind !== 'web' && !(src.kind === 'json' && src.url) && !(src.kind === 'text' && isUrl(src.file))) {
        const b = el('button', undefined, 'Change Source…');
        b.type = 'button';
        b.title = 'Read another file with the same steps (a file that has moved, or the next batch of results)';
        b.addEventListener('click', async () => {
          const types = src.kind === 'text' ? TEXT_TYPES : src.kind === 'json' ? JSON_TYPES : BOOK_TYPES;
          const g = await openBytesDialog('Data files', types);
          if (!g) return;
          picked.set(g.name, g.bytes);
          const file = g.ref.kind === 'path' ? g.ref.path : g.name;
          fetched = { bytes: g.bytes };
          if (src.kind === 'workbook') {
            try { fetched.book = await readBook(g.bytes, g.name); } catch (e) { this.host.flash((e as Error).message, 6000); return; }
          }
          q.source = { ...src, file } as QuerySource;
          reparse();
          renderSettings();
          render();
        });
        settings.append(b);
      }
    };

    const render = () => {
      at = Math.min(at, q.steps.length - 1);
      const cur = current();
      // the steps
      side.replaceChildren(el('h3', undefined, 'Applied Steps'));
      const list = el('ol', 'qe-step-list');
      const srcItem = el('li', at === -1 ? 'on' : '');
      const srcBtn = el('button', 'qe-step', 'Source');
      srcBtn.type = 'button';
      srcBtn.title = sourceText(q.source);
      srcBtn.addEventListener('click', () => { at = -1; render(); });
      srcItem.append(srcBtn);
      list.append(srcItem);
      q.steps.forEach((s, i) => {
        const li = el('li', `${i === at ? 'on' : ''}${cur.step === i ? ' bad' : ''}`.trim());
        const b = el('button', 'qe-step', stepName(s));
        b.type = 'button';
        b.title = stepName(s);
        b.addEventListener('click', () => { at = i; render(); });
        const x = el('button', 'qe-x', '×');
        x.type = 'button';
        x.title = 'Delete this step';
        x.setAttribute('aria-label', `Delete ${stepName(s)}`);
        x.addEventListener('click', () => { q.steps.splice(i, 1); if (at >= i) at--; render(); });
        li.append(b, x);
        list.append(li);
      });
      side.append(list);
      // the data
      if (cur.error) {
        gridBox.replaceChildren(el('p', 'qe-error', cur.step !== undefined ? `${stepName(q.steps[cur.step])}: ${cur.error}` : cur.error));
        status.textContent = cur.step !== undefined ? 'Delete the step, or change the steps before it.' : '';
      } else {
        sel = sel.filter((c) => cur.table.cols.includes(c));
        gridBox.replaceChildren(this.grid(cur.table, 200, sel, (col, e) => {
          if (e.ctrlKey || e.metaKey) sel = sel.includes(col) ? sel.filter((c) => c !== col) : [...sel, col];
          else if (e.shiftKey && sel.length) {
            const cols = cur.table.cols;
            const a = cols.indexOf(sel[sel.length - 1]), b = cols.indexOf(col);
            sel = cols.slice(Math.min(a, b), Math.max(a, b) + 1);
          } else sel = sel.length === 1 && sel[0] === col ? [] : [col];
          render();
        }));
        const n = cur.table.rows.length;
        status.textContent = `${cur.table.cols.length} column${cur.table.cols.length === 1 ? '' : 's'}, ${n} row${n === 1 ? '' : 's'}${n > 200 ? ' (the first 200 shown)' : ''}.${at < q.steps.length - 1 ? ' Showing the data after the step picked: new steps go in after it.' : ''}`;
      }
    };

    const finish = async (where: 'default' | 'ask'): Promise<string | false | null> => {
      const nm = name.value.trim();
      if (!nm) return 'Give the query a name.';
      if (this.wb.queries.some((x) => x.id !== q.id && x.name.toLowerCase() === nm.toLowerCase())) return `There is a query called ${nm} already.`;
      q.name = nm;
      if (!raw) return problem ?? 'The source hasn\'t been read.';
      const res = runSteps(raw, q.steps);
      if ('error' in res) return `Step ${res.step + 1} (${stepName(q.steps[res.step])}): ${res.error}`;
      return this.load(q, res.table, fresh, where);
    };
    w.actions('Close & Load', () => finish('default'), [['Close & Load To…', async () => { const p = await finish('ask'); if (typeof p === 'string') w.error(p); else if (p !== false) w.close(); }]]);

    renderSettings();
    reparse();
    render();
    w.show();
    name.blur();
    if (!fetched) {
      // an existing query: read its source again to show it
      void fetchSource(q.source).then((g) => { fetched = g; reparse(); renderSettings(); render(); }, (e: Error) => { problem = e.message; render(); });
    }
  }

  /** A table of values for the editor and the Navigator; `onHead` makes the headers pickable. */
  private grid(t: QTable, max: number, sel: string[] = [], onHead?: (col: string, e: MouseEvent) => void): HTMLElement {
    const box = el('div', 'qe-table-box');
    const table = el('table', 'qe-table');
    const head = el('tr');
    head.append(el('th', 'qe-rn', ''));
    t.cols.forEach((c, i) => {
      const th = el('th', sel.includes(c) ? 'on' : '');
      const badge = el('span', 'qe-type', TYPE_BADGE[t.types[i]]);
      badge.title = TYPE_NAMES[t.types[i]];
      th.append(badge, document.createTextNode(c));
      if (onHead) { th.tabIndex = 0; th.addEventListener('click', (e) => onHead(c, e)); th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onHead(c, e as unknown as MouseEvent); } }); }
      head.append(th);
    });
    const thead = el('thead');
    thead.append(head);
    const body = el('tbody');
    t.rows.slice(0, max).forEach((r, ri) => {
      const tr = el('tr');
      tr.append(el('td', 'qe-rn', String(ri + 1)));
      t.cols.forEach((c, i) => {
        const v = r[i] ?? null;
        const td = el('td', `${isError(v) ? 'err' : v === null ? 'null' : typeof v === 'number' ? 'num' : ''}${sel.includes(c) ? ' on' : ''}`.trim(), v === null ? 'null' : shown(v, t.types[i]));
        if (isError(v)) td.title = v.detail ?? v.code;
        tr.append(td);
      });
      body.append(tr);
    });
    table.append(thead, body);
    box.append(table);
    return box;
  }

  // ---------------------------------------------------------------- loading

  /**
   * Put a query's results in the workbook. A query already loaded writes over its table; a new
   * one goes on a new sheet (or, with 'ask', where Close & Load To… says, or nowhere).
   */
  private async load(q: Query, t: QTable, fresh: boolean, where: 'default' | 'ask'): Promise<string | false | null> {
    const wb = this.wb;
    const v = this.host.view;
    const old = fresh ? null : wb.queries.find((x) => x.id === q.id) ?? null;
    let place = old ? queryTable(wb, old) : null;
    let target: { kind: 'new' } | { kind: 'here'; sheet: Sheet; at: { row: number; col: number } } | { kind: 'none' } = place ? { kind: 'here', sheet: place.sheet, at: { row: place.table.range.r1, col: place.table.range.c1 } } : { kind: 'new' };
    if (where === 'ask') {
      const s = v.sheet!;
      const a = await ask('Import Data', [
        { name: 'where', label: 'Where do you want to put the data?', value: place ? 'here' : 'new', options: [{ value: 'new', label: 'New worksheet' }, { value: 'here', label: 'Existing worksheet' }, { value: 'none', label: 'Only Create Connection' }] },
        { name: 'cell', label: 'Existing worksheet: top left cell', value: place ? `${place.sheet.name}!${cellName(place.table.range.r1, place.table.range.c1)}` : `${s.name}!${cellName(v.sel.active.r, v.sel.active.c)}` },
      ], { ok: 'OK', note: 'The data goes in as a table, which Refresh fills in again.' });
      if (!a) return false;
      if (a.where === 'none') target = { kind: 'none' };
      else if (a.where === 'new') target = { kind: 'new' };
      else {
        const text = a.cell.trim();
        const bang = text.lastIndexOf('!');
        const sheet = bang >= 0 ? wb.sheetNamed(text.slice(0, bang).replace(/^'(.*)'$/, '$1')) : s;
        const refText = text.slice(bang + 1);
        const block = parseRange(refText);
        const ref = parseCellRef(refText) ?? (block ? { row: block.r1, col: block.c1 } : null);
        if (!sheet || !ref) return 'Give the cell the table starts at, such as Sheet1!A1.';
        target = { kind: 'here', sheet, at: ref };
        // moved somewhere else: the old table stays as it is, a range of values
        if (place && (place.sheet !== sheet || place.table.range.r1 !== ref.row || place.table.range.c1 !== ref.col)) place = null;
      }
    }
    if (target.kind === 'here') {
      const R = resultRange(target.at, t);
      const own = place && place.sheet === target.sheet ? place.table : null;
      const p = loadProblem(target.sheet, R, own);
      if (p) return p;
      if (wouldCover(target.sheet, R, own)) {
        const ok = await ask('Replace the cells?', [], { ok: 'Replace', note: `The results would cover cells that have something in them (${cellName(R.r1, R.c1)}:${cellName(R.r2, R.c2)}). Replace what is there?` });
        if (!ok) return false;
      }
    }
    v.commitEdit();
    let errors = 0;
    let shownSheet: Sheet | null = null;
    wb.edit(fresh ? 'Get Data' : 'Edit Query', () => {
      let next: Query = { ...q, refreshed: new Date().toISOString() };
      if (target.kind === 'none') {
        // only a connection: a table it loaded before stays, a range of values
        next = { ...next, table: null };
      } else {
        let sheet: Sheet, at: { row: number; col: number }, own = null as ReturnType<typeof queryTable>;
        if (target.kind === 'new') {
          sheet = wb.addSheet(this.sheetName(q.name), wb.sheets.indexOf(v.sheet!) + 1);
          at = { row: 0, col: 0 };
        } else {
          sheet = target.sheet;
          at = target.at;
          own = place && place.sheet === sheet ? place : null;
        }
        const got = writeResult(sheet, at, t, own?.table ?? null, next);
        if (!own) fitWidths(sheet, at, t);
        errors = got.errors;
        next = { ...next, table: got.table.name };
        shownSheet = sheet;
      }
      wb.setQueries(fresh ? [...wb.queries, next] : wb.queries.map((x) => (x.id === q.id ? next : x)));
    }, v.place());
    if (shownSheet) {
      const i = wb.sheets.indexOf(shownSheet);
      if (i >= 0 && wb.sheets[wb.active] !== shownSheet) v.goSheet(i);
    }
    v.refresh();
    this.host.flash(`${q.name}: ${t.rows.length} row${t.rows.length === 1 ? '' : 's'} loaded${errors ? `, ${errors} error${errors > 1 ? 's' : ''} (left blank)` : ''}.`, errors ? 8000 : 3000);
    if (this.paneWin && ToolWindow.open === this.paneWin) this.queriesPane();
    return null;
  }

  /** A sheet name for a query's results: its name, made allowed and not yet used. */
  private sheetName(name: string): string {
    const b = name.replace(/[\\/?*[\]:]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Query';
    if (!this.wb.sheetNamed(b)) return b;
    for (let n = 2; ; n++) {
      const t = `${b.slice(0, 31 - String(n).length - 3)} (${n})`;
      if (!this.wb.sheetNamed(t)) return t;
    }
  }

  // ---------------------------------------------------------------- refreshing

  /** Refresh one query: read its source again and run its steps, writing over its table. */
  async refresh(q: Query, quiet = false): Promise<string | null> {
    let t: QTable;
    try {
      t = await runQuery(q);
    } catch (e) {
      return `${q.name}: ${(e as Error).message}`;
    }
    const wb = this.wb;
    const cur = wb.queries.find((x) => x.id === q.id);
    if (!cur) return null;
    const place = queryTable(wb, cur);
    const v = this.host.view;
    if (!place) {
      wb.edit('Refresh', () => wb.setQueries(wb.queries.map((x) => (x.id === q.id ? { ...x, refreshed: new Date().toISOString() } : x))), v.place());
      return null;
    }
    const at = { row: place.table.range.r1, col: place.table.range.c1 };
    const R = resultRange(at, t);
    const p = loadProblem(place.sheet, R, place.table);
    if (p) return `${q.name}: ${p}`;
    if (wouldCover(place.sheet, R, place.table)) {
      if (quiet) return `${q.name}: the new results would cover cells beside the table. Refresh it on its own to replace them.`;
      const ok = await ask('Replace the cells?', [], { ok: 'Replace', note: `${q.name} has grown: its results would cover cells that have something in them. Replace what is there?` });
      if (!ok) return null;
    }
    v.commitEdit();
    let errors = 0;
    wb.edit(`Refresh ${q.name}`, () => {
      errors = writeResult(place.sheet, at, t, place.table, cur).errors;
      wb.setQueries(wb.queries.map((x) => (x.id === q.id ? { ...x, refreshed: new Date().toISOString() } : x)));
    }, v.place());
    v.refresh();
    return errors ? `${q.name}: ${errors} error${errors > 1 ? 's' : ''} (left blank).` : null;
  }

  /** The query whose table holds the active cell. */
  here(): Query | undefined {
    const s = this.host.view.sheet;
    const t = s?.tableAt(this.host.view.sel.active.r, this.host.view.sel.active.c);
    return t ? queryOfTable(this.wb, t) : undefined;
  }

  /** Refresh every query, one after another. Returns what went wrong, if anything. */
  async refreshQueries(): Promise<string[]> {
    const problems: string[] = [];
    for (const q of this.wb.queries.slice()) {
      const p = await this.refresh(q, true);
      if (p) problems.push(p);
    }
    if (this.paneWin && ToolWindow.open === this.paneWin) this.queriesPane();
    return problems;
  }

  // ---------------------------------------------------------------- Queries & Connections

  /** The Queries & Connections window: each query, with Edit, Refresh, Load To and Delete. */
  queriesPane(): void {
    const w = new ToolWindow('Queries & Connections', 'query-pane');
    this.paneWin = w;
    w.onClose = () => { if (this.paneWin === w) this.paneWin = null; };
    const list = el('div', 'qp-list');
    const qs = this.wb.queries;
    if (!qs.length) list.append(el('p', 'muted', 'No queries yet. Data > Get Data reads a CSV, JSON, web page or workbook and makes one.'));
    for (const q of qs) {
      const item = el('div', 'qp-item');
      const place = queryTable(this.wb, q);
      item.append(el('strong', undefined, q.name));
      item.append(el('div', 'muted', sourceText(q.source)));
      item.append(el('div', 'muted', `${q.steps.length} step${q.steps.length === 1 ? '' : 's'}; ${place ? `loaded to ${place.table.name} on ${place.sheet.name} (${place.table.range.r2 - place.table.range.r1} rows)` : 'Connection only'}${q.refreshed ? `; refreshed ${new Date(q.refreshed).toLocaleString()}` : ''}`));
      const row = el('div', 'cp-buttons');
      const btn = (label: string, fn: () => void, title = '') => { const b = el('button', undefined, label); b.type = 'button'; if (title) b.title = title; b.addEventListener('click', fn); row.append(b); };
      btn('Edit', () => this.editor(q, null, false), 'Open the Query Editor on it');
      btn('Refresh', () => void this.refresh(q).then((p) => { this.host.flash(p ?? `Refreshed ${q.name}.`, p ? 8000 : 2500); if (ToolWindow.open === w) this.queriesPane(); }), 'Read the source again and run the steps');
      if (place) btn('Go to', () => { const i = this.wb.sheets.indexOf(place.sheet); this.host.view.goSheet(i); this.host.view.select(place.table.range); }, 'Select its table');
      btn('Delete', async () => {
        const ok = await ask('Delete query?', [], { ok: 'Delete', note: `The query ${q.name} goes; its table stays as it is, as values.` });
        if (!ok) return;
        this.wb.edit('Delete query', () => this.wb.setQueries(this.wb.queries.filter((x) => x.id !== q.id)), this.host.view.place());
        this.queriesPane();
      });
      item.append(row);
      list.append(item);
    }
    w.body.append(list);
    w.button('Get Data ▾', () => { const b = w.d.querySelector<HTMLElement>('.ask-buttons button')!.getBoundingClientRect(); this.getDataMenu(b.left, b.bottom + 2); });
    w.button('Close', () => w.close(), 'primary');
    w.show();
  }
}
