// The windows of Sheet mode's tools for cleaning and arranging data, as Excel has them: Find and
// Replace (Ctrl+F, Ctrl+H), Go To (F5, Ctrl+G) and Go To Special, the Series window, Paste
// Special (Ctrl+Alt+V), Text to Columns, Remove Duplicates, Flash Fill (Ctrl+E), Sort with
// several levels, Advanced Filter, and Freeze Panes and Split on the View tab.

import type { SheetView } from './sheet-view';
import { popupMenu } from './sheet-view';
import type { Sheet } from '../sheet/workbook';
import { Range, rangeName, colName, cellName, parseRange, parseCellRef, keyOf, MAX_ROWS, MAX_COLS } from '../sheet/refs';
import {
  FindOptions, findCells, replaceCell, searchedText, goToSpecial, SpecialKind, SpecialOptions, fillSeries, SeriesOptions,
  PasteSpecialOptions, PasteWhat, PasteOp, splitText, SplitOptions, textToColumns, removeDuplicates, applyAdvancedFilter, showAllRows,
} from '../sheet/data-tools';
import { flashFill } from '../sheet/flash-fill';
import { readTyped } from '../sheet/values';

export interface DataUiHost {
  readonly view: SheetView;
  /** One undoable change to the sheet showing; `after` is the selection afterwards. */
  edit(label: string, fn: (s: Sheet) => void, after?: () => Range): void;
  flash(msg: string, ms?: number): void;
  /** The table around the active cell: its rows of data, and its header row if it has one. */
  table(): { data: Range; header: number | null } | null;
  /** Go to a cell, block or sheet, as typed in the name box. */
  goTo(text: string): void;
  /** Paste the cells copied, with these choices. */
  pasteSpecial(o: PasteSpecialOptions): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function row(label: string, input: HTMLElement): HTMLLabelElement {
  const r = el('label', 'ask-row');
  r.append(el('span', undefined, label), input);
  return r;
}

function check(label: string, on = false): { row: HTMLLabelElement; box: HTMLInputElement } {
  const r = el('label', 'ask-row ask-check');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = on;
  r.append(box, el('span', undefined, label));
  return { row: r, box };
}

function button(label: string, cls = '', title = ''): HTMLButtonElement {
  const b = el('button', cls || undefined, label);
  b.type = 'button';
  if (title) b.title = title;
  return b;
}

/** A group of radio buttons; returns the box and a reader of the one picked. */
function radios<T extends string>(name: string, legend: string, options: [T, string][], picked: T): { box: HTMLFieldSetElement; value: () => T; set: (v: T) => void; inputs: Map<T, HTMLInputElement> } {
  const box = el('fieldset', 'sd-radios');
  box.append(el('legend', undefined, legend));
  const inputs = new Map<T, HTMLInputElement>();
  for (const [v, label] of options) {
    const l = el('label');
    const r = el('input');
    r.type = 'radio';
    r.name = name;
    r.value = v;
    r.checked = v === picked;
    inputs.set(v, r);
    l.append(r, ` ${label}`);
    box.append(l);
  }
  return { box, value: () => ([...inputs].find(([, r]) => r.checked)?.[0] ?? picked), set: (v) => { const r = inputs.get(v); if (r) r.checked = true; }, inputs };
}

/** A window with a title, a form, a line for problems and OK and Cancel; `ok` returns a problem to show, or nothing to close. */
function windowOf(title: string, cls: string, okLabel = 'OK'): {
  d: HTMLDialogElement; form: HTMLFormElement; problem: HTMLElement; buttons: HTMLElement; fail: (msg: string) => void; onOk: (fn: () => string | void) => void; close: () => void;
} {
  const d = el('dialog', `ask ${cls}`);
  const form = el('form');
  form.append(el('h2', undefined, title));
  const problem = el('p', 'dv-problem');
  problem.hidden = true;
  const buttons = el('p', 'ask-buttons');
  const cancel = button('Cancel');
  const ok = el('button', 'primary', okLabel);
  ok.type = 'submit';
  buttons.append(cancel, ok);
  d.append(form);
  const close = () => { if (d.open) d.close(); d.remove(); };
  cancel.addEventListener('click', close);
  d.addEventListener('close', () => d.remove());
  let fn: () => string | void = () => {};
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = fn();
    if (msg) { problem.textContent = msg; problem.hidden = false; return; }
    close();
  });
  return {
    d, form, problem, buttons,
    fail: (msg) => { problem.textContent = msg; problem.hidden = false; },
    onOk: (f) => { fn = f; },
    close,
  };
}

/** Put a window's problem line and buttons at its end and show it. */
function open(w: ReturnType<typeof windowOf>, first?: HTMLElement | null): void {
  w.form.append(w.problem, w.buttons);
  document.body.append(w.d);
  w.d.showModal();
  first?.focus();
}

/** A cell or block typed in a window ("B2", "$A$1:$C$9"); null when it isn't one. */
const readRange = (t: string): Range | null => parseRange(t.trim().replace(/\$/g, '').toUpperCase());
const readCell = (t: string): { row: number; col: number } | null => {
  const r = parseCellRef(t.trim().replace(/\$/g, '').toUpperCase());
  return r ? { row: r.row, col: r.col } : null;
};

/** A block written with $ signs, as Excel's windows show them. */
const absName = (r: Range) => rangeName(r).replace(/([A-Z]+)(\d+)/g, '$$$1$$$2');

export class SheetData {
  /** What Find and Replace last looked for (the window opens with it, and Find Next goes on from it). */
  private lastFind: FindOptions & { within: 'sheet' | 'workbook'; replace: string } = { text: '', lookIn: 'formulas', within: 'sheet', replace: '' };
  private findWindow: HTMLDialogElement | null = null;

  constructor(private host: DataUiHost) {}

  private get view(): SheetView {
    return this.host.view;
  }

  // ---------------------------------------------------------------- find and replace

  /** Find (Ctrl+F) or Replace (Ctrl+H): a window that stays open beside the sheet while you work. */
  findReplace(replace: boolean): void {
    const v = this.view;
    const s = v.sheet;
    if (!s || s.dashboard) return;
    v.commitEdit();
    this.findWindow?.remove();
    const o = this.lastFind;
    const d = el('dialog', 'ask sd-find');
    this.findWindow = d;
    d.setAttribute('aria-label', 'Find and Replace');
    const form = el('form');
    const head = el('div', 'sd-find-head');
    const tabs = el('div', 'dv-tabs');
    tabs.setAttribute('role', 'tablist');
    const findTab = button('Find'), replTab = button('Replace');
    for (const t of [findTab, replTab]) t.setAttribute('role', 'tab');
    tabs.append(findTab, replTab);
    const x = button('×', 'sd-close', 'Close (Esc)');
    head.append(tabs, x);
    const what = el('input');
    what.value = o.text;
    what.spellcheck = false;
    const by = el('input');
    by.value = o.replace;
    by.spellcheck = false;
    const withRow = row('Replace with', by);
    // options, as Excel's Options >> shows them
    const within = el('select');
    within.add(new Option('Sheet', 'sheet'));
    within.add(new Option('Workbook', 'workbook'));
    within.value = o.within;
    const order = el('select');
    order.add(new Option('By Rows', 'rows'));
    order.add(new Option('By Columns', 'cols'));
    order.value = o.byColumns ? 'cols' : 'rows';
    const lookIn = el('select');
    lookIn.add(new Option('Formulas', 'formulas'));
    lookIn.add(new Option('Values', 'values'));
    lookIn.add(new Option('Notes and comments', 'notes'));
    lookIn.value = o.lookIn ?? 'formulas';
    const matchCase = check('Match case', !!o.matchCase);
    const whole = check('Match entire cell contents', !!o.whole);
    const opts = el('details', 'sd-find-opts');
    opts.append(el('summary', undefined, 'Options'), row('Within', within), row('Search', order), row('Look in', lookIn), matchCase.row, whole.row,
      el('p', 'muted small', 'Wildcards: ? any one character, * any run of them; ~ before either finds it as itself.'));
    const status = el('p', 'muted small sd-find-status');
    const list = el('div', 'sd-find-list');
    const buttons = el('p', 'ask-buttons');
    const replAll = button('Replace All'), replOne = button('Replace'), findAll = button('Find All'), next = el('button', 'primary', 'Find Next');
    next.type = 'submit';
    buttons.append(replAll, replOne, findAll, next);
    form.append(head, row('Find what', what), withRow, opts, status, list, buttons);
    d.append(form);

    const setMode = (r: boolean) => {
      withRow.hidden = !r;
      replAll.hidden = !r;
      replOne.hidden = !r;
      findTab.setAttribute('aria-selected', String(!r));
      replTab.setAttribute('aria-selected', String(r));
      // Excel's Replace looks in what was typed only
      if (r) lookIn.value = 'formulas';
      lookIn.disabled = r;
      d.dataset.mode = r ? 'replace' : 'find';
    };
    const read = (): FindOptions & { within: 'sheet' | 'workbook'; replace: string } => ({
      text: what.value, replace: by.value, matchCase: matchCase.box.checked, whole: whole.box.checked,
      lookIn: lookIn.value as FindOptions['lookIn'], byColumns: order.value === 'cols', within: within.value as 'sheet' | 'workbook',
    });
    const close = () => { this.lastFind = read(); if (d.open) d.close(); d.remove(); if (this.findWindow === d) this.findWindow = null; v.focus(); };
    findTab.addEventListener('click', () => setMode(false));
    replTab.addEventListener('click', () => setMode(true));
    x.addEventListener('click', close);
    d.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); this.lastFind = read(); this.findNext(status); });
    findAll.addEventListener('click', () => { this.lastFind = read(); this.findAll(list, status); });
    replOne.addEventListener('click', () => { this.lastFind = read(); this.replaceOne(status); });
    replAll.addEventListener('click', () => { this.lastFind = read(); this.replaceAll(status); });
    setMode(replace);
    document.body.append(d);
    // not modal: the sheet can be clicked and typed in while it is open
    d.show();
    what.focus();
    what.select();
  }

  /** The sheets searched, the one showing first. */
  private sheetsSearched(): Sheet[] {
    const wb = this.view.wb!;
    if (this.lastFind.within !== 'workbook') return [wb.sheet];
    const i = wb.active;
    return [...wb.sheets.slice(i), ...wb.sheets.slice(0, i)].filter((x) => !x.dashboard);
  }

  /** Every match, sheet by sheet (only within the selection when several cells are selected and searching one sheet). */
  private matches(): { s: Sheet; r: number; c: number }[] {
    const v = this.view;
    const sel = v.sel.range;
    const within = this.lastFind.within === 'sheet' && (sel.r1 !== sel.r2 || sel.c1 !== sel.c2) ? sel : null;
    return this.sheetsSearched().flatMap((s) => findCells(s, this.lastFind, s === v.sheet ? within : null).map((h) => ({ s, ...h })));
  }

  /** Go to a cell found (on its sheet). */
  private show(s: Sheet, r: number, c: number): void {
    const v = this.view, wb = v.wb!;
    const i = wb.sheets.indexOf(s);
    if (i !== wb.active) v.goSheet(i);
    // keep a selected block selected while stepping through it, as Excel does
    const sel = v.sel.range;
    if (sel.r1 !== sel.r2 || sel.c1 !== sel.c2) {
      if (r >= sel.r1 && r <= sel.r2 && c >= sel.c1 && c <= sel.c2) { v.select(sel, { r, c }, v.sel.anchor); return; }
    }
    v.selectCell(r, c);
  }

  /** Find Next: the next match after the active cell (on to the next sheet when looking in the workbook). */
  findNext(status?: HTMLElement): void {
    const v = this.view;
    if (!this.lastFind.text) { this.findReplace(false); return; }
    const hits = this.matches();
    const say = (t: string) => { if (status) status.textContent = t; else this.host.flash(t); };
    if (!hits.length) { say(`Nothing found for "${this.lastFind.text}".`); return; }
    const s = v.sheet!, { r, c } = v.sel.active;
    const after = (h: { r: number; c: number }) => (this.lastFind.byColumns ? h.c > c || (h.c === c && h.r > r) : h.r > r || (h.r === r && h.c > c));
    const here = hits.findIndex((h) => h.s === s && after(h));
    const firstOther = hits.findIndex((h) => h.s !== s);
    const h = hits[here >= 0 ? here : firstOther >= 0 ? firstOther : 0];
    this.show(h.s, h.r, h.c);
    say(`${hits.length} found. ${h.s !== s || here < 0 ? 'Went on from the start. ' : ''}${h.s.name === s.name ? '' : `On ${h.s.name}: `}${cellName(h.r, h.c)}`);
  }

  /** Find All: a list of every match; click one to go to it, or select them all. */
  private findAll(list: HTMLElement, status: HTMLElement): void {
    const hits = this.matches();
    list.replaceChildren();
    status.textContent = hits.length ? `${hits.length} cell${hits.length === 1 ? '' : 's'} found.` : `Nothing found for "${this.lastFind.text}".`;
    if (!hits.length) return;
    const table = el('table', 'sd-find-table');
    const head = el('tr');
    for (const t of ['Sheet', 'Cell', 'Value', 'Formula']) head.append(el('th', undefined, t));
    table.append(head);
    for (const h of hits.slice(0, 2000)) {
      const tr = el('tr');
      tr.tabIndex = 0;
      const input = h.s.cell(h.r, h.c)?.input ?? '';
      tr.append(el('td', undefined, h.s.name), el('td', undefined, absName({ r1: h.r, c1: h.c, r2: h.r, c2: h.c })),
        el('td', undefined, this.lastFind.lookIn === 'notes' ? searchedText(h.s, h.r, h.c, 'notes') ?? '' : h.s.shownText(h.r, h.c)), el('td', undefined, input.startsWith('=') ? input : ''));
      const go = () => { for (const x of table.querySelectorAll('tr.on')) x.classList.remove('on'); tr.classList.add('on'); this.show(h.s, h.r, h.c); };
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      table.append(tr);
    }
    const pickAll = button('Select All Found', '', 'Select every cell found on this sheet (then format them, or type and press Ctrl+Enter to fill them all)');
    pickAll.addEventListener('click', () => {
      const v = this.view;
      const mine = hits.filter((h) => h.s === v.sheet);
      if (!mine.length) { status.textContent = 'None of them is on this sheet.'; return; }
      v.selectAreas(mine.map((h) => ({ r1: h.r, c1: h.c, r2: h.r, c2: h.c })));
      status.textContent = `Selected ${mine.length} cell${mine.length === 1 ? '' : 's'}.`;
    });
    list.append(table, pickAll);
  }

  /** Replace: the active cell, if it matches, then on to the next match. */
  private replaceOne(status: HTMLElement): void {
    const v = this.view;
    const s = v.sheet!, { r, c } = v.sel.active;
    const o = this.lastFind;
    if (!o.text) return;
    let done = false;
    this.host.edit('Replace', (sh) => { done = replaceCell(sh, r, c, o, o.replace); });
    if (!done) { this.findNext(status); return; }
    status.textContent = `Replaced in ${cellName(r, c)}${s !== v.sheet ? ` on ${s.name}` : ''}.`;
    this.findNext(status);
  }

  /** Replace All: every match, as one step to undo. */
  private replaceAll(status: HTMLElement): void {
    const o = this.lastFind;
    if (!o.text) return;
    const hits = this.matches();
    const wb = this.view.wb!;
    let n = 0;
    wb.edit('Replace All', () => {
      for (const h of hits) if (replaceCell(h.s, h.r, h.c, o, o.replace)) n++;
    }, this.view.place());
    this.view.refresh();
    status.textContent = n ? `All done. ${n} replacement${n === 1 ? '' : 's'} made.` : hits.length ? 'The cells found are worked out by formulas or hold structures, so nothing was replaced.' : `Nothing found for "${o.text}".`;
    this.host.flash(status.textContent);
  }

  // ---------------------------------------------------------------- go to

  /** Go To (F5, Ctrl+G): a cell, block or sheet by name, or Special… */
  goTo(): void {
    const v = this.view;
    if (!v.sheet || v.sheet.dashboard) return;
    v.commitEdit();
    const w = windowOf('Go To', 'sd-goto');
    const ref = el('input');
    ref.placeholder = 'B5, A1:C9, Sheet2!A1 or Sheet2';
    ref.spellcheck = false;
    const special = button('Special…', '', 'Go to cells of a kind: blanks, constants, formulas, notes, differences, precedents…');
    special.addEventListener('click', () => { w.close(); this.goToSpecial(); });
    w.buttons.prepend(special);
    w.form.append(row('Reference', ref));
    w.onOk(() => {
      if (!ref.value.trim()) return 'Type a cell or block to go to.';
      this.host.goTo(ref.value.trim());
    });
    open(w, ref);
  }

  /** Go To Special: select the cells of a kind (within the selection, or on the whole sheet). */
  goToSpecial(): void {
    const v = this.view;
    const s = v.sheet;
    if (!s || s.dashboard) return;
    v.commitEdit();
    const w = windowOf('Go To Special', 'sd-special');
    const kinds: [SpecialKind | 'objects', string][] = [
      ['notes', 'Notes and comments'], ['constants', 'Constants'], ['formulas', 'Formulas'], ['blanks', 'Blanks'],
      ['region', 'Current region'], ['objects', 'Objects (charts)'], ['structures', 'Structures'],
      ['rowdiff', 'Row differences'], ['coldiff', 'Column differences'], ['precedents', 'Precedents'], ['dependents', 'Dependents'],
      ['lastcell', 'Last cell'], ['visible', 'Visible cells only'], ['condformats', 'Conditional formats'], ['validation', 'Data validation'],
    ];
    const pick = radios('sd-special', 'Select', kinds, 'blanks');
    pick.box.classList.add('sd-two-cols');
    // the choices under some kinds, as Excel's window has them
    const types = el('fieldset', 'sd-sub');
    types.append(el('legend', undefined, 'Of formulas and constants'));
    const t = { numbers: check('Numbers', true), text: check('Text', true), logicals: check('Logicals', true), errors: check('Errors', true) };
    types.append(t.numbers.row, t.text.row, t.logicals.row, t.errors.row);
    const levels = radios('sd-levels', 'Precedents and dependents', [['direct', 'Direct only'], ['all', 'All levels']], 'direct');
    const same = radios('sd-same', 'Conditional formats and data validation', [['all', 'All'], ['same', 'Same as the active cell']], 'all');
    const side = el('div', 'sd-special-side');
    side.append(types, levels.box, same.box);
    const body = el('div', 'sd-special-body');
    body.append(pick.box, side);
    w.form.append(body);
    const sync = () => {
      const k = pick.value();
      types.disabled = k !== 'constants' && k !== 'formulas';
      levels.box.disabled = k !== 'precedents' && k !== 'dependents';
      same.box.disabled = k !== 'condformats' && k !== 'validation';
    };
    for (const r of pick.inputs.values()) r.addEventListener('change', sync);
    sync();
    w.onOk(() => {
      const k = pick.value();
      if (k === 'objects') {
        if (!s.charts.length) return 'There are no charts on this sheet.';
        v.pickChart(s.charts[0].id);
        return;
      }
      const o: SpecialOptions = {
        kind: k,
        types: { numbers: t.numbers.box.checked, text: t.text.box.checked, logicals: t.logicals.box.checked, errors: t.errors.box.checked },
        allLevels: levels.value() === 'all',
        same: same.value() === 'same',
      };
      const got = goToSpecial(s, v.sel.range, v.sel.active, o);
      if (!got) return 'No cells were found.';
      v.selectAreas(got, k === 'region' || k === 'rowdiff' || k === 'coldiff' ? v.sel.active : undefined);
      const n = got.reduce((sum, a) => sum + (a.r2 - a.r1 + 1) * (a.c2 - a.c1 + 1), 0);
      if (got.length > 1 || n > 1) this.host.flash(`${n.toLocaleString()} cell${n === 1 ? '' : 's'} selected. Type and press Ctrl+Enter to fill them all, or format them.`, 6000);
    });
    open(w, pick.inputs.get('blanks'));
    v.focus();
    w.d.querySelector<HTMLInputElement>('input:checked')?.focus();
  }

  // ---------------------------------------------------------------- the Series window

  /** Fill > Series…: linear, growth or date series (or AutoFill) through the selected cells. */
  series(): void {
    const v = this.view;
    const s = v.sheet;
    if (!s || s.dashboard) return;
    v.commitEdit();
    const R = v.sel.range;
    const w = windowOf('Series', 'sd-series');
    const tall = R.r2 - R.r1 >= R.c2 - R.c1;
    const by = radios('sd-by', 'Series in', [['rows', 'Rows'], ['cols', 'Columns']], tall ? 'cols' : 'rows');
    const type = radios<SeriesOptions['type']>('sd-type', 'Type', [['linear', 'Linear'], ['growth', 'Growth'], ['date', 'Date'], ['auto', 'AutoFill']], 'linear');
    const unit = radios<NonNullable<SeriesOptions['unit']>>('sd-unit', 'Date unit', [['day', 'Day'], ['weekday', 'Weekday'], ['month', 'Month'], ['year', 'Year']], 'day');
    const trend = check('Trend (a best fit through the values already there; the step is worked out)');
    const step = el('input');
    step.value = '1';
    const stop = el('input');
    stop.placeholder = 'optional';
    const top = el('div', 'sd-series-top');
    top.append(by.box, type.box, unit.box);
    w.form.append(top, trend.row, row('Step value', step), row('Stop value', stop),
      el('p', 'muted small', 'Starts from the first cell of each row or column (dates are typed as dates, such as 2026-01-31). With a stop value and one cell selected, the series runs on until it reaches it.'));
    const sync = () => {
      unit.box.disabled = type.value() !== 'date';
      trend.box.disabled = type.value() === 'date' || type.value() === 'auto';
      step.disabled = trend.box.checked || type.value() === 'auto';
    };
    for (const r of [...type.inputs.values()]) r.addEventListener('change', sync);
    trend.box.addEventListener('change', sync);
    sync();
    w.onOk(() => {
      const st = Number(step.value);
      const sp = stop.value.trim() === '' ? undefined : Number(stop.value);
      if (!step.disabled && !Number.isFinite(st)) return 'The step value has to be a number.';
      if (sp !== undefined && !Number.isFinite(sp)) return 'The stop value has to be a number (or left empty).';
      const o: SeriesOptions = { by: by.value(), type: type.value(), unit: unit.value(), step: Number.isFinite(st) ? st : 1, stop: sp, trend: !trend.box.disabled && trend.box.checked };
      if (R.r1 === R.r2 && R.c1 === R.c2 && sp === undefined && o.type !== 'auto') return 'With one cell selected, give a stop value (or select the cells to fill first).';
      if (typeof s.value(R.r1, R.c1) !== 'number' && o.type !== 'auto') return `The series starts from ${cellName(R.r1, R.c1)}: type a number (or a date) there first.`;
      let n = 0;
      this.host.edit('Series', (sh) => { n = fillSeries(sh, R, o); });
      this.host.flash(n ? `Filled ${n} cell${n === 1 ? '' : 's'}.` : 'Nothing to fill: the next value would pass the stop value.');
    });
    open(w, step);
  }

  // ---------------------------------------------------------------- Paste Special

  /** Paste Special (Ctrl+Alt+V): which part of the copied cells to paste, and how. */
  pasteSpecial(): void {
    const v = this.view;
    if (!v.sheet || v.sheet.dashboard) return;
    v.commitEdit();
    const w = windowOf('Paste Special', 'sd-paste');
    const what = radios<PasteWhat>('sd-what', 'Paste', [
      ['all', 'All'], ['formulas', 'Formulas'], ['values', 'Values'], ['formats', 'Formats'], ['notes', 'Notes and comments'], ['validation', 'Validation'],
      ['no-borders', 'All except borders'], ['widths', 'Column widths'], ['formulas-numfmt', 'Formulas and number formats'], ['values-numfmt', 'Values and number formats'],
    ], 'all');
    what.box.classList.add('sd-two-cols');
    const op = radios<PasteOp>('sd-op', 'Operation', [['none', 'None'], ['add', 'Add'], ['subtract', 'Subtract'], ['multiply', 'Multiply'], ['divide', 'Divide']], 'none');
    op.box.classList.add('sd-two-cols');
    const skip = check('Skip blanks');
    const transpose = check('Transpose (rows become columns)');
    w.form.append(what.box, op.box, skip.row, transpose.row,
      el('p', 'muted small', 'Operation combines the copied numbers with the numbers already in the cells (multiply a column of mmol by 1000 to get µmol, say).'));
    w.onOk(() => { this.host.pasteSpecial({ what: what.value(), op: op.value(), skipBlanks: skip.box.checked, transpose: transpose.box.checked }); });
    open(w, what.inputs.get('all'));
  }

  // ---------------------------------------------------------------- Text to Columns

  /** Text to Columns: one column of text cut into several, at separators or fixed widths, with a preview. */
  textToColumns(): void {
    const v = this.view;
    const s = v.sheet;
    if (!s || s.dashboard) return;
    v.commitEdit();
    let R = s.clip(v.sel.range) ?? v.sel.range;
    if (R.c1 !== R.c2) { this.host.flash('Select one column of text to split (Text to Columns works on one column at a time).', 6000); return; }
    if (R.r1 === R.r2) {
      // one cell: the column of the table around it
      const t = s.currentRegion(R.r1, R.c1);
      R = { r1: t.r1, c1: R.c1, r2: t.r2, c2: R.c1 };
    }
    const texts: string[] = [];
    for (let r = R.r1; r <= R.r2 && texts.length < 8; r++) {
      const val = s.values.get(keyOf(r, R.c1));
      if (val !== undefined && val !== null && val !== '' && !s.cell(r, R.c1)?.input?.startsWith('=')) texts.push(typeof val === 'string' ? val : s.shownText(r, R.c1));
    }
    if (!texts.length) { this.host.flash('The selected cells hold no text to split.'); return; }
    const w = windowOf('Text to Columns', 'sd-ttc', 'Finish');
    // a first guess at the separator, as Excel's wizard makes
    const guess = texts.some((t) => t.includes('\t')) ? '\t' : texts.some((t) => t.includes(';')) ? ';' : texts.some((t) => t.includes(',')) ? ',' : ' ';
    const mode = radios<SplitOptions['mode']>('sd-mode', 'Original data type', [['delimited', 'Delimited: characters such as commas or tabs separate each field'], ['fixed', 'Fixed width: fields are lined up in columns']], 'delimited');
    const delim = el('fieldset', 'sd-delims');
    delim.append(el('legend', undefined, 'Delimiters'));
    const ds = { tab: check('Tab', guess === '\t'), semi: check('Semicolon', guess === ';'), comma: check('Comma', guess === ','), space: check('Space', guess === ' ') };
    const other = el('input');
    other.maxLength = 1;
    other.size = 2;
    const otherRow = el('label', 'ask-row ask-check');
    const otherBox = el('input');
    otherBox.type = 'checkbox';
    otherRow.append(otherBox, el('span', undefined, 'Other: '), other);
    other.addEventListener('input', () => { otherBox.checked = !!other.value; update(); });
    const consecutive = check('Treat consecutive delimiters as one', guess === ' ');
    const qual = el('select');
    qual.add(new Option('"', '"'));
    qual.add(new Option("'", "'"));
    qual.add(new Option('{none}', ''));
    delim.append(ds.tab.row, ds.semi.row, ds.comma.row, ds.space.row, otherRow, consecutive.row, row('Text qualifier', qual));
    const breaks = el('input');
    breaks.placeholder = 'e.g. 10, 18';
    const breakRow = row('Break after characters', breaks);
    const dest = el('input');
    dest.value = absName({ r1: R.r1, c1: R.c1, r2: R.r1, c2: R.c1 });
    const preview = el('div', 'sd-preview');
    w.form.append(mode.box, delim, breakRow, row('Destination', dest), el('p', 'muted small', 'Data preview (pick each column\'s format above it):'), preview);
    let formats: SplitOptions['formats'] = [];
    const options = (): SplitOptions => ({
      mode: mode.value(),
      delimiters: (ds.tab.box.checked ? '\t' : '') + (ds.semi.box.checked ? ';' : '') + (ds.comma.box.checked ? ',' : '') + (ds.space.box.checked ? ' ' : '') + (otherBox.checked ? other.value : ''),
      consecutive: consecutive.box.checked,
      qualifier: qual.value,
      breaks: breaks.value.split(/[,;\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0),
      formats,
    });
    const update = () => {
      const fixed = mode.value() === 'fixed';
      delim.disabled = fixed;
      breakRow.hidden = !fixed;
      const o = options();
      const rows = texts.map((t) => splitText(t, o));
      const width = Math.max(...rows.map((x) => x.length));
      formats = Array.from({ length: width }, (_, i) => formats?.[i] ?? 'general');
      const table = el('table', 'sd-preview-table');
      const head = el('tr');
      for (let i = 0; i < width; i++) {
        const th = el('th');
        const f = el('select');
        f.add(new Option('General', 'general'));
        f.add(new Option('Text', 'text'));
        f.add(new Option('Skip', 'skip'));
        f.value = formats[i]!;
        f.setAttribute('aria-label', `Format of column ${i + 1}`);
        f.addEventListener('change', () => { formats![i] = f.value as 'general'; update(); });
        th.append(f);
        head.append(th);
      }
      table.append(head);
      for (const line of rows) {
        const tr = el('tr');
        for (let i = 0; i < width; i++) {
          const td = el('td', formats[i] === 'skip' ? 'skip' : undefined, line[i] ?? '');
          tr.append(td);
        }
        table.append(tr);
      }
      preview.replaceChildren(table);
    };
    for (const b of [ds.tab, ds.semi, ds.comma, ds.space, consecutive]) b.box.addEventListener('change', update);
    for (const x of [otherBox, qual]) x.addEventListener('change', update);
    for (const r of mode.inputs.values()) r.addEventListener('change', update);
    breaks.addEventListener('input', update);
    update();
    w.onOk(() => {
      const o = options();
      if (o.mode === 'delimited' && !o.delimiters) return 'Tick at least one delimiter.';
      if (o.mode === 'fixed' && !o.breaks!.length) return 'Give where to break each line (characters from the start, such as 10, 18).';
      const at = readCell(dest.value);
      if (!at) return `"${dest.value}" isn't a cell (for example $B$2).`;
      let n = 0;
      this.host.edit('Text to Columns', (sh) => { n = textToColumns(sh, R, o, at); }, () => ({ r1: at.row, c1: at.col, r2: at.row + R.r2 - R.r1, c2: at.col + Math.max(0, n - 1) }));
      this.host.flash(n > 1 ? `Split into ${n} columns.` : 'Nothing was split: no delimiter was found in the cells.');
    });
    open(w, null);
  }

  // ---------------------------------------------------------------- Remove Duplicates

  /** Remove Duplicates: rows that repeat an earlier row in the ticked columns go, and the rows below move up. */
  removeDuplicates(): void {
    const v = this.view;
    const s = v.sheet;
    if (!s || s.dashboard) return;
    v.commitEdit();
    const t = this.host.table();
    if (!t) { this.host.flash('Click in a table (or select it) to remove its duplicate rows.'); return; }
    const all: Range = { ...t.data, r1: t.header ?? t.data.r1 };
    const w = windowOf('Remove Duplicates', 'sd-dups');
    const header = check('My data has headers', t.header !== null);
    const list = el('div', 'sd-cols');
    const boxes: HTMLInputElement[] = [];
    const names = () => {
      list.replaceChildren();
      boxes.length = 0;
      for (let c = all.c1; c <= all.c2; c++) {
        const name = header.box.checked ? s.shownText(all.r1, c) || `Column ${colName(c)}` : `Column ${colName(c)}`;
        const b = check(name, true);
        b.box.value = String(c);
        boxes.push(b.box);
        list.append(b.row);
      }
    };
    header.box.addEventListener('change', names);
    names();
    const selAll = button('Select All'), none = button('Unselect All');
    selAll.addEventListener('click', () => boxes.forEach((b) => { b.checked = true; }));
    none.addEventListener('click', () => boxes.forEach((b) => { b.checked = false; }));
    const btns = el('div', 'cp-buttons');
    btns.append(selAll, none);
    w.form.append(el('p', 'muted small', `In ${rangeName(all)}: rows whose ticked columns match an earlier row (ignoring capitals; structures by their SMILES) are removed.`), btns, header.row, list);
    w.onOk(() => {
      const cols = boxes.filter((b) => b.checked).map((b) => Number(b.value));
      if (!cols.length) return 'Tick at least one column.';
      let got = { removed: 0, kept: 0 };
      this.host.edit('Remove Duplicates', (sh) => { got = removeDuplicates(sh, all, cols, header.box.checked); });
      this.host.flash(got.removed ? `${got.removed} duplicate row${got.removed === 1 ? '' : 's'} found and removed; ${got.kept} unique row${got.kept === 1 ? '' : 's'} remain.` : 'No duplicate rows found.', 6000);
    });
    open(w, null);
  }

  // ---------------------------------------------------------------- Flash Fill

  /** Flash Fill (Ctrl+E): fill the active column the way the examples typed in it were made from their rows. */
  flashFill(): void {
    const v = this.view;
    const s = v.sheet;
    if (!s || s.dashboard) return;
    v.commitEdit();
    const { r, c } = v.sel.active;
    // the table beside the column: its rows, and the columns of text in them
    const region = s.currentRegion(r, c);
    const text = (rr: number, cc: number) => (s.cell(rr, cc)?.structure ? '' : s.shownText(rr, cc));
    const sources: number[] = [];
    for (let cc = region.c1; cc <= region.c2; cc++) if (cc !== c) sources.push(cc);
    if (!sources.length) { this.host.flash('Flash Fill works beside a table: type an example or two next to the data, then press Ctrl+E.', 7000); return; }
    const filled = (rr: number) => text(rr, c) !== '';
    const examples: { row: string[]; out: string }[] = [];
    const empty: number[] = [];
    for (let rr = region.r1; rr <= region.r2; rr++) {
      const srcRow = sources.map((cc) => text(rr, cc));
      if (!srcRow.some(Boolean)) continue;
      if (filled(rr)) examples.push({ row: srcRow, out: text(rr, c) });
      else empty.push(rr);
    }
    // the first row is a header when its example can't be made from its row and the others can
    if (examples.length > 1 && filled(region.r1)) {
      const rest = examples.slice(1);
      if (flashFill(rest, []) && !flashFill(examples, [])) examples.shift();
    }
    if (!examples.length) { this.host.flash('Type what you want in the first cell of the column (an example), then press Ctrl+E.', 7000); return; }
    if (!empty.length) { this.host.flash('Every row of the column is filled already.'); return; }
    const got = flashFill(examples, empty.map((rr) => sources.map((cc) => text(rr, cc))));
    if (!got) { this.host.flash('Flash Fill couldn\'t see a pattern in the examples. Type another example or two and press Ctrl+E again.', 7000); return; }
    const fills = empty.map((rr, i) => ({ rr, t: got.values[i] })).filter((x) => x.t !== null);
    if (!fills.length) { this.host.flash('The pattern doesn\'t fit the other rows.'); return; }
    this.host.edit('Flash Fill', (sh) => {
      // text that would read as a formula is kept as text
      for (const { rr, t } of fills) sh.setInput(rr, c, readTyped(t!).formula ? `'${t}` : t!);
    }, () => ({ r1: fills[0].rr, c1: c, r2: fills[fills.length - 1].rr, c2: c }));
    const named = got.describe.replace(/column (\d+)/g, (_, n) => `column ${colName(sources[Number(n) - 1])}`);
    this.host.flash(`Flash Fill: ${fills.length} cell${fills.length === 1 ? '' : 's'} filled (${named}). Undo takes them back.`, 8000);
  }

  // ---------------------------------------------------------------- sort with several levels

  /** Custom Sort: sort the table by several columns in turn, each smallest first, largest first or in a list's order. */
  sortDialog(): void {
    const v = this.view;
    const s = v.sheet;
    if (!s || s.dashboard) return;
    v.commitEdit();
    const t = this.host.table();
    if (!t) { this.host.flash('Click in a table (or select its rows) to sort it.'); return; }
    const all: Range = { ...t.data, r1: t.header ?? t.data.r1 };
    const w = windowOf('Sort', 'sd-sort');
    const header = check('My data has headers', t.header !== null);
    const caseBox = check('Case sensitive');
    const across = check('Sort left to right (sort the columns, by rows)');
    type Level = { key: HTMLSelectElement; order: HTMLSelectElement; custom: HTMLInputElement; line: HTMLElement };
    const levels: Level[] = [];
    const list = el('div', 'sd-levels');
    const keyOptions = (sel: HTMLSelectElement) => {
      const was = sel.value;
      sel.replaceChildren();
      if (across.box.checked) for (let r = all.r1; r <= all.r2; r++) sel.add(new Option(`Row ${r + 1}`, String(r)));
      else for (let c = all.c1; c <= all.c2; c++) {
        const h = header.box.checked ? s.shownText(all.r1, c) : '';
        sel.add(new Option(h ? `${h} (${colName(c)})` : `Column ${colName(c)}`, String(c)));
      }
      if ([...sel.options].some((o) => o.value === was)) sel.value = was;
    };
    const redraw = () => {
      list.replaceChildren(...levels.map((l, i) => {
        (l.line.firstChild as HTMLElement).textContent = i ? 'Then by' : 'Sort by';
        return l.line;
      }));
    };
    let picked = 0;
    const addLevel = (from?: Level) => {
      if (levels.length >= 64) return;
      const line = el('div', 'sd-level');
      const key = el('select');
      key.setAttribute('aria-label', 'Column');
      keyOptions(key);
      const order = el('select');
      order.setAttribute('aria-label', 'Order');
      order.add(new Option('Smallest to largest (A to Z)', 'asc'));
      order.add(new Option('Largest to smallest (Z to A)', 'desc'));
      order.add(new Option('Custom list…', 'custom'));
      const custom = el('input');
      custom.placeholder = 'Low, Medium, High';
      custom.setAttribute('aria-label', 'Custom order, separated by commas');
      custom.hidden = true;
      order.addEventListener('change', () => { custom.hidden = order.value !== 'custom'; if (!custom.hidden) custom.focus(); });
      if (from) { key.value = from.key.value; order.value = from.order.value; custom.value = from.custom.value; custom.hidden = from.custom.hidden; }
      else if (levels.length) {
        // the next column along, as Excel offers it
        const next = key.options[Math.min(key.options.length - 1, levels.length)];
        if (next) key.value = next.value;
      } else key.value = String(across.box.checked ? Math.min(Math.max(v.sel.active.r, all.r1), all.r2) : Math.min(Math.max(v.sel.active.c, all.c1), all.c2));
      line.append(el('span', 'sd-level-name'), key, order, custom);
      const level: Level = { key, order, custom, line };
      line.addEventListener('focusin', () => { picked = levels.indexOf(level); for (const l of levels) l.line.classList.toggle('on', l === level); });
      levels.push(level);
      redraw();
    };
    addLevel();
    const add = button('Add Level'), del = button('Delete Level'), copy = button('Copy Level'), up = button('▲', '', 'Move the level up'), down = button('▼', '', 'Move the level down');
    add.addEventListener('click', () => addLevel());
    copy.addEventListener('click', () => addLevel(levels[picked] ?? levels[levels.length - 1]));
    del.addEventListener('click', () => { if (levels.length > 1) { levels.splice(Math.min(picked, levels.length - 1), 1); picked = 0; redraw(); } });
    const move = (d: number) => {
      const j = picked + d;
      if (j < 0 || j >= levels.length) return;
      [levels[picked], levels[j]] = [levels[j], levels[picked]];
      picked = j;
      redraw();
    };
    up.addEventListener('click', () => move(-1));
    down.addEventListener('click', () => move(1));
    const bar = el('div', 'cp-buttons');
    bar.append(add, del, copy, up, down);
    for (const b of [header.box, across.box]) b.addEventListener('change', () => levels.forEach((l) => keyOptions(l.key)));
    w.form.append(bar, list, header.row, caseBox.row, across.row);
    w.onOk(() => {
      const keys = levels.map((l) => ({
        col: Number(l.key.value),
        descending: l.order.value === 'desc' || undefined,
        custom: l.order.value === 'custom' ? l.custom.value.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
      }));
      if (keys.some((k) => k.custom && !k.custom.length)) return 'Type the custom order, separated by commas (Low, Medium, High).';
      const byCols = across.box.checked;
      // the header row (or, left to right, nothing: Excel's headers are only for top to bottom)
      const R: Range = byCols ? all : { ...all, r1: header.box.checked ? all.r1 + 1 : all.r1 };
      if (byCols ? R.c2 <= R.c1 : R.r2 <= R.r1) return 'There is only one row to sort.';
      this.host.edit('Sort', (sh) => sh.sort(R, keys, { caseSensitive: caseBox.box.checked, byColumns: byCols }));
      this.host.flash(`Sorted ${byCols ? `${R.c2 - R.c1 + 1} columns` : `${R.r2 - R.r1 + 1} rows`} by ${keys.length} level${keys.length === 1 ? '' : 's'}.`);
    });
    open(w, levels[0].key);
  }

  // ---------------------------------------------------------------- Advanced Filter

  /** Advanced Filter: rows that pass the tests in a criteria block, filtered in place or copied elsewhere. */
  advancedFilter(): void {
    const v = this.view;
    const s = v.sheet;
    if (!s || s.dashboard) return;
    v.commitEdit();
    const t = this.host.table();
    const listRange = t ? { ...t.data, r1: t.header ?? t.data.r1 } : null;
    const w = windowOf('Advanced Filter', 'sd-adv');
    const action = radios('sd-adv-action', 'Action', [['place', 'Filter the list, in place'], ['copy', 'Copy to another location']], 'place');
    const list = el('input');
    list.value = listRange ? absName(listRange) : '';
    const crit = el('input');
    crit.placeholder = 'e.g. $H$1:$I$3';
    const to = el('input');
    to.placeholder = 'e.g. $K$1';
    const toRow = row('Copy to', to);
    const unique = check('Unique records only');
    w.form.append(action.box, row('List range', list), row('Criteria range', crit), toRow, unique.row,
      el('p', 'muted small', 'Criteria: a row of headers from the list, with tests under them (>50, <>THF, Pd* for "begins with", = for blank). Tests on one row must all pass; each row is another way to pass. A formula under a header that isn\'t in the list (=B2>AVERAGE($B$2:$B$40)) tests each row from the first.'));
    const sync = () => { toRow.hidden = action.value() !== 'copy'; };
    for (const r of action.inputs.values()) r.addEventListener('change', sync);
    sync();
    w.onOk(() => {
      const L = readRange(list.value);
      if (!L || L.r2 <= L.r1) return 'Give the list: its header row and the rows under it (such as $A$1:$D$40).';
      const C = crit.value.trim() ? readRange(crit.value) : null;
      if (crit.value.trim() && (!C || C.r2 <= C.r1)) return 'The criteria range needs a header row and at least one row of tests under it.';
      const copy = action.value() === 'copy';
      const dest = copy ? readCell(to.value.replace(/:.*$/, '')) : null;
      if (copy && !dest) return 'Give a cell to copy the rows to (such as $K$1).';
      if (dest && dest.row <= L.r2 && dest.row >= L.r1 && dest.col <= L.c2 && dest.col + (L.c2 - L.c1) >= L.c1) return 'Copy the rows somewhere clear of the list.';
      let got = { shown: 0, total: 0 };
      this.host.edit('Advanced Filter', (sh) => { got = applyAdvancedFilter(sh, { list: L, criteria: C, unique: unique.box.checked, copyTo: dest }); },
        dest ? () => ({ r1: dest.row, c1: dest.col, r2: dest.row + got.shown, c2: dest.col + L.c2 - L.c1 }) : undefined);
      this.host.flash(copy ? `Copied ${got.shown} of ${got.total} rows.` : `${got.shown} of ${got.total} rows show. Data > Clear shows them all again.`, 6000);
    });
    open(w, crit);
  }

  /** Data > Clear: show every row of the table again (after a filter in place). */
  clearFilter(): void {
    const v = this.view;
    const s = v.sheet;
    if (!s) return;
    if (s.filter) { this.host.edit('Clear filter', (sh) => { for (const c of Object.keys(sh.filter!.conditions)) sh.setCondition(Number(c), null); }); return; }
    const t = this.host.table();
    const R = t ? { ...t.data, r1: t.header ?? t.data.r1 } : { r1: 0, c1: 0, r2: MAX_ROWS - 1, c2: MAX_COLS - 1 };
    let n = 0;
    this.host.edit('Clear filter', (sh) => { n = showAllRows(sh, R); });
    this.host.flash(n ? `${n} hidden row${n === 1 ? '' : 's'} show again.` : 'No rows are hidden here.');
  }

  // ---------------------------------------------------------------- freeze panes and split

  /** View > Freeze Panes ▾ */
  freezeMenu(x: number, y: number): void {
    const s = this.view.sheet;
    if (!s) return;
    const frozen = s.frozen.rows > 0 || s.frozen.cols > 0;
    popupMenu(x, y, [
      [frozen ? 'Unfreeze Panes' : 'Freeze Panes', () => this.freeze(frozen ? 'off' : 'cell')],
      ['Freeze Top Row', () => this.freeze('row')],
      ['Freeze First Column', () => this.freeze('col')],
    ]);
  }

  /**
   * Freeze Panes: the rows above and the columns left of the active cell stay in view (or, with a
   * split window, those of the split); Freeze Top Row and Freeze First Column; or unfreeze.
   */
  freeze(how: 'cell' | 'row' | 'col' | 'off'): void {
    const v = this.view;
    const s = v.sheet;
    if (!s || s.dashboard) return;
    let rows = 0, cols = 0;
    if (how === 'cell') {
      if (s.split) { rows = s.split.rows; cols = s.split.cols; }
      else { rows = v.sel.active.r; cols = v.sel.active.c; }
      if (!rows && !cols) { this.host.flash('Select the cell below the rows and right of the columns to keep in view, then Freeze Panes.', 6000); return; }
    } else if (how === 'row') rows = 1;
    else if (how === 'col') cols = 1;
    v.keepPlaceForFreeze();
    this.host.edit(how === 'off' ? 'Unfreeze Panes' : 'Freeze Panes', (sh) => { sh.setSplit(null); sh.setFrozen(rows, cols); });
    if (how === 'off') { this.host.flash('Panes unfrozen.'); return; }
    const what = [rows ? (rows === 1 ? 'row 1' : `rows 1–${rows}`) : '', cols ? (cols === 1 ? 'column A' : `columns A–${colName(cols - 1)}`) : ''].filter(Boolean).join(' and ');
    this.host.flash(`Frozen: ${what} stay in view as you scroll.`);
  }

  /** View > Split: split the window above and left of the active cell into panes that scroll on their own (again to take it away). */
  toggleSplit(): void {
    const v = this.view;
    const s = v.sheet;
    if (!s || s.dashboard) return;
    v.commitEdit();
    if (s.split) { v.splitAt(0, 0); return; }
    let { r, c } = v.sel.active;
    // from the top left cell, Excel splits the window in four through its middle
    if (!r && !c) { r = Math.max(1, Math.floor(v.visibleRows() / 2)); c = Math.max(1, Math.floor(v.visibleCols() / 2)); }
    if (s.frozen.rows || s.frozen.cols) this.host.edit('Unfreeze Panes', (sh) => sh.setFrozen(0, 0));
    v.splitAt(r, c);
    this.host.flash('Split: each pane scrolls on its own (the mouse wheel over the upper or left pane scrolls it). Drag a bar to move the split; double-click it, or Split again, to take it away.', 8000);
  }
}
