// The Formulas tab of Sheet mode, as Excel's: the Insert Function window (search, categories, and
// then a box for each argument with its help and what it works out to), the function category
// menus, and the defined names (Name Manager, Define Name, Use in Formula, Create from Selection,
// and the name box going to or giving names).

import { popupMenu } from './sheet-view';
import type { SheetView } from './sheet-view';
import type { Sheet } from '../sheet/workbook';
import type { Value } from '../sheet/values';
import { formatValue } from '../sheet/numfmt';
import { isBlock, type Arg } from '../sheet/args';
import { Range, sameRange, rangeName, keyOf } from '../sheet/refs';
import { CATEGORIES, type Category, type FnHelp, functionHelp, searchFunctions, syntaxOf } from '../sheet/fn-help';
import {
  type DefinedName, nameProblem, findName, resolveName, isBuiltInName, nameTarget, refersTo, renameInFormula, nameFromLabel,
} from '../sheet/names';

export interface FormulasUiHost {
  readonly view: SheetView;
  /** One undoable change to the sheet showing. */
  edit(label: string, fn: (s: Sheet) => void): void;
  flash(msg: string, ms?: number): void;
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

function button(text: string, cls?: string): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  return b;
}

/** A value as the Function Arguments window shows it: the number, "text", or {1, 2, 3…} for a block. */
export function previewText(v: Arg): string {
  const one = (x: Value): string => (typeof x === 'string' ? `"${x}"` : formatValue(x).text);
  if (!isBlock(v)) return one(v as Value);
  const cells = v.block.flat().slice(0, 6).map(one);
  const more = v.h * v.w > 6 ? ', …' : '';
  return v.h * v.w === 1 ? cells[0] : `{${cells.join(', ')}${more}} (${v.h}×${v.w})`;
}

/** A function and its arguments as the formula is written (empty arguments at the end left out). */
export function callText(name: string, args: string[]): string {
  const a = args.map((x) => x.trim());
  while (a.length && !a[a.length - 1]) a.pop();
  return `${name}(${a.join(', ')})`;
}

export class SheetFormulas {
  constructor(private host: FormulasUiHost) {}

  private get view(): SheetView {
    return this.host.view;
  }

  // ---------------------------------------------------------------- putting text in the cell

  /** Put text into the formula being typed, or start one with it in the active cell. */
  private put(text: string, caretBack = 0): void {
    const v = this.view;
    if (!v.sheet) return;
    if (v.editing) {
      const inp = v.input;
      const p = inp.selectionStart ?? inp.value.length;
      const before = inp.value.slice(0, p);
      const lead = before.trim() === '' ? '=' : '';
      inp.value = before + lead + text + inp.value.slice(inp.selectionEnd ?? p);
      v.setTyping(inp.value);
      inp.focus();
      const at = p + lead.length + text.length - caretBack;
      inp.setSelectionRange(at, at);
    } else {
      v.editCell(`=${text}`);
      const inp = v.input;
      const at = inp.value.length - caretBack;
      inp.setSelectionRange(at, at);
    }
  }

  /** The active cell's formula when it is one function call: its name and argument texts. */
  private callHere(): { name: string; args: string[] } | null {
    const v = this.view;
    const s = v.sheet;
    if (!s || v.editing) return null;
    const text = s.cell(v.sel.active.r, v.sel.active.c)?.input ?? '';
    const m = /^=\s*([A-Za-z_][\w.]*)\((.*)\)\s*$/s.exec(text);
    if (!m || !functionHelp().has(m[1].toUpperCase())) return null;
    // split at the commas that aren't inside brackets, braces or quotes
    const args: string[] = [];
    let depth = 0, quote = false, cur = '';
    for (const ch of m[2]) {
      if (ch === '"') quote = !quote;
      if (!quote && (ch === '(' || ch === '{')) depth++;
      if (!quote && (ch === ')' || ch === '}')) depth--;
      if (!quote && depth === 0 && ch === ',') { args.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim() || args.length) args.push(cur.trim());
    if (depth !== 0 || quote) return null;
    return { name: m[1].toUpperCase(), args };
  }

  // ---------------------------------------------------------------- Insert Function

  /** The Insert Function window (fx, Shift+F3): find a function, then fill in its arguments. */
  insertFunction(category?: Category, picked?: string): void {
    const v = this.view;
    if (!v.sheet || v.sheet.dashboard) return;
    const here = !picked && !category ? this.callHere() : null;
    if (here) { this.argumentsWindow(functionHelp().get(here.name)!, here.args, true); return; }
    if (picked) { const h = functionHelp().get(picked); if (h) this.argumentsWindow(h, [], false); return; }

    const d = el('dialog', 'ask fx-dialog');
    const form = el('form');
    form.append(el('h2', undefined, 'Insert Function'));
    const search = el('input');
    search.type = 'search';
    search.placeholder = 'What should it work out? (e.g. "days between dates", "molar mass", SUMIF)';
    const cat = el('select');
    cat.add(new Option('All', ''));
    for (const c of CATEGORIES) cat.add(new Option(c, c, false, c === category));
    const list = el('select', 'fx-list');
    list.size = 10;
    const syntax = el('p', 'fx-syntax');
    const about = el('p', 'fx-about');
    form.append(row('Search', search), row('Category', cat), list, syntax, about);
    const buttons = el('p', 'ask-buttons');
    const cancel = button('Cancel');
    const ok = el('button', 'primary', 'OK');
    ok.type = 'submit';
    buttons.append(cancel, ok);
    form.append(buttons);
    d.append(form);

    const fill = () => {
      const was = list.value;
      list.replaceChildren();
      const found = searchFunctions(search.value, (cat.value || undefined) as Category | undefined);
      for (const h of found.slice(0, 400)) list.add(new Option(h.name, h.name, false, h.name === was));
      if (list.selectedIndex < 0 && list.options.length) list.selectedIndex = 0;
      show();
    };
    const show = () => {
      const h = functionHelp().get(list.value);
      syntax.textContent = h ? syntaxOf(h) : search.value ? 'Nothing matches: try other words, or All categories.' : '';
      about.textContent = h?.about ?? '';
      ok.disabled = !h;
    };
    search.addEventListener('input', fill);
    cat.addEventListener('change', fill);
    list.addEventListener('change', show);
    list.addEventListener('dblclick', () => form.requestSubmit());
    search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        list.selectedIndex = Math.max(0, Math.min(list.options.length - 1, list.selectedIndex + (e.key === 'ArrowDown' ? 1 : -1)));
        show();
      }
    });
    const finish = () => { if (d.open) d.close(); d.remove(); };
    cancel.addEventListener('click', () => { finish(); v.focus(); });
    d.addEventListener('close', () => d.remove());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const h = functionHelp().get(list.value);
      if (!h) return;
      finish();
      this.argumentsWindow(h, [], false);
    });
    document.body.append(d);
    fill();
    d.showModal();
    search.focus();
  }

  /** Function Arguments: a box for each argument, its help, what it is and what the whole works out to. */
  private argumentsWindow(h: FnHelp, given: string[], replace: boolean): void {
    const v = this.view;
    const s = v.sheet!;
    const wb = v.wb!;
    const { r, c } = v.sel.active;
    const d = el('dialog', 'ask fx-dialog');
    const form = el('form');
    form.append(el('h2', undefined, 'Function Arguments'), el('p', 'fx-syntax', syntaxOf(h)));
    const box = el('div', 'fx-args');
    const help = el('p', 'fx-arg-help');
    const about = el('p', 'fx-about', h.about);
    const result = el('p', 'fx-result');
    form.append(box, help, about, result);
    const buttons = el('p', 'ask-buttons');
    const cancel = button('Cancel');
    const ok = el('button', 'primary', 'OK');
    ok.type = 'submit';
    buttons.append(cancel, ok);
    form.append(buttons);
    d.append(form);

    const worked = (text: string): string => {
      if (!text.trim()) return '';
      const val = wb.formulaArg(s, '=' + text, r, c);
      return '= ' + previewText(val);
    };
    type Field = { input: HTMLInputElement; shown: HTMLElement; arg: FnHelp['args'][number]; n: number };
    const fields: Field[] = [];
    const label = (f: Pick<Field, 'arg' | 'n'>) => (f.arg.repeats ? `${f.arg.name}${f.n}` : f.arg.name);
    const addField = (arg: FnHelp['args'][number], n: number, value: string) => {
      const input = el('input');
      input.spellcheck = false;
      input.value = value;
      const shown = el('span', 'fx-value');
      const f: Field = { input, shown, arg, n };
      const rw = row(label(f), input);
      rw.append(shown);
      if (!arg.optional && !(arg.repeats && n > 1)) rw.classList.add('fx-needed');
      box.append(rw);
      fields.push(f);
      input.addEventListener('focus', () => { help.textContent = `${label(f)}: ${arg.help}${arg.optional || (arg.repeats && n > 1) ? ' (can be left out)' : ''}`; });
      input.addEventListener('input', () => {
        // a repeating argument gets another box once its last is used
        const last = fields[fields.length - 1];
        if (f === last && arg.repeats && input.value.trim() && fields.length < 255) addField(arg, n + 1, '');
        update();
      });
      return f;
    };
    let gi = 0;
    for (const a of h.args) {
      if (a.repeats) {
        let n = 1;
        do addField(a, n++, given[gi++] ?? ''); while (gi < given.length);
        if (fields[fields.length - 1].input.value.trim()) addField(a, n, '');
      } else addField(a, 1, given[gi++] ?? '');
    }
    if (!h.args.length) box.append(el('p', 'muted small', `${h.name} takes no arguments.`));

    const text = () => callText(h.name, fields.map((f) => f.input.value));
    const update = () => {
      for (const f of fields) f.shown.textContent = worked(f.input.value);
      const missing = fields.some((f) => !f.arg.optional && !(f.arg.repeats && f.n > 1) && !f.input.value.trim());
      result.textContent = missing ? 'Formula result: (fill in the arguments in bold)' : `Formula result ${worked(text())}`;
    };
    update();

    const finish = () => { if (d.open) d.close(); d.remove(); };
    cancel.addEventListener('click', () => { finish(); v.focus(); });
    d.addEventListener('close', () => d.remove());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const t = text();
      const p = wb.formulaProblem('=' + t);
      if (p) { result.textContent = `That can't be read: ${p}`; return; }
      finish();
      if (replace || !v.editing) {
        this.host.edit(`Insert ${h.name}`, (sh) => sh.setInput(r, c, '=' + t));
        v.focus();
      } else this.put(t);
    });
    document.body.append(d);
    d.showModal();
    (fields[0]?.input ?? ok).focus();
  }

  /** A category's functions (the Function Library buttons); picking one opens its arguments. */
  categoryMenu(cat: Category, x: number, y: number): void {
    const list = searchFunctions('', cat);
    const m = popupMenu(x, y, [
      ...list.map((h) => [h.name, () => this.insertFunction(undefined, h.name)] as [string, () => void]),
      null,
      ['Insert Function…', () => this.insertFunction(cat)],
    ]);
    m.classList.add('fx-menu');
    for (const b of m.querySelectorAll('button')) {
      const h = functionHelp().get(b.textContent ?? '');
      if (h) b.title = `${syntaxOf(h)}\n${h.about}`;
    }
  }

  // ---------------------------------------------------------------- defined names

  /** The names shown to people (Excel's own print areas and filters, and hidden ones, left out). */
  private shownNames(): DefinedName[] {
    const wb = this.view.wb;
    return wb ? wb.liveNames().filter((n) => !n.hidden && !isBuiltInName(n.name)) : [];
  }

  /** The name for exactly these cells, if one is defined (for the name box). */
  nameFor(s: Sheet, r: Range): string | null {
    for (const n of this.shownNames()) {
      if (n.sheet && n.sheet !== s) continue;
      const t = nameTarget(n.formula);
      if (t && t.sheet?.toLowerCase() === s.name.toLowerCase() && sameRange(t.range, r)) return n.name;
    }
    return null;
  }

  /** The name box: go to a name's cells. False when the text isn't a name of cells. */
  goToName(text: string): boolean {
    const v = this.view;
    const wb = v.wb;
    if (!wb || !v.sheet) return false;
    const n = resolveName(wb.liveNames(), text, v.sheet);
    if (!n) return false;
    const t = nameTarget(n.formula);
    if (!t) { this.host.flash(`${n.name} is ${n.formula}, not a block of cells.`); return true; }
    const i = t.sheet ? wb.sheets.findIndex((sh) => sh.name.toLowerCase() === t.sheet!.toLowerCase()) : wb.sheets.indexOf(v.sheet);
    if (i < 0) { this.host.flash(`${n.name} refers to a sheet that isn't there (${n.formula}).`); return true; }
    v.goSheet(i);
    v.select(t.range, { r: t.range.r1, c: t.range.c1 });
    v.focus();
    return true;
  }

  /** The name box: a new name typed there names the selected cells (as in Excel). */
  nameSelection(text: string): boolean {
    const v = this.view;
    const wb = v.wb;
    if (!wb || !v.sheet || nameProblem(text)) return false;
    if (findName(wb.names, text, undefined)) return false;
    wb.edit(`Name ${text}`, () => wb.setNames([...wb.names, { name: text, formula: refersTo(v.sheet!.name, v.sel.range) }]), v.place());
    this.host.flash(`${text} now names ${rangeName(v.sel.range)}.`);
    v.focus();
    return true;
  }

  /** Change the names in one undoable step (renames carried into every formula). */
  private saveNames(label: string, next: DefinedName[], renames: [string, string][] = []): void {
    const v = this.view;
    const wb = v.wb!;
    wb.edit(label, () => {
      wb.setNames(next);
      for (const [from, to] of renames) wb.rewriteAllFormulas((f) => renameInFormula(f, from, to));
    }, v.place());
    v.refresh();
  }

  /** New Name / Edit Name: name, scope, comment and what it refers to. Resolves with the saved name, or null. */
  private editName(was: DefinedName | null, preset?: Partial<DefinedName>): Promise<boolean> {
    const v = this.view;
    const wb = v.wb!;
    return new Promise((done) => {
      const d = el('dialog', 'ask nm-edit');
      const form = el('form');
      form.append(el('h2', undefined, was ? 'Edit Name' : 'New Name'));
      const name = el('input');
      name.value = was?.name ?? preset?.name ?? '';
      name.spellcheck = false;
      const scope = el('select');
      scope.add(new Option('Workbook', ''));
      wb.sheets.forEach((sh, i) => scope.add(new Option(sh.name, String(i), false, sh === (was?.sheet ?? preset?.sheet))));
      scope.disabled = !!was;
      const comment = el('textarea');
      comment.rows = 2;
      comment.value = was?.comment ?? '';
      comment.style.fontFamily = 'inherit';
      const refers = el('input');
      refers.spellcheck = false;
      refers.value = was?.formula ?? preset?.formula ?? refersTo(v.sheet!.name, v.sel.range);
      const hint = el('p', 'ask-help muted', 'Refers to: cells (=Sheet1!$B$2:$B$20), a number (=0.082057), or a formula, including a LAMBDA (=LAMBDA(mass, mw, mass/mw)) to call it like a function.');
      const problem = el('p', 'dv-problem');
      problem.hidden = true;
      form.append(row('Name', name), row('Scope', scope), row('Comment', comment), row('Refers to', refers), hint, problem);
      const buttons = el('p', 'ask-buttons');
      const cancel = button('Cancel');
      const ok = el('button', 'primary', 'OK');
      ok.type = 'submit';
      buttons.append(cancel, ok);
      form.append(buttons);
      d.append(form);
      const finish = (saved: boolean) => { if (d.open) d.close(); d.remove(); done(saved); };
      cancel.addEventListener('click', () => finish(false));
      d.addEventListener('cancel', () => done(false));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const nm = name.value.trim();
        const sheet = was ? was.sheet : scope.value ? wb.sheets[Number(scope.value)] : undefined;
        const fail = (msg: string) => { problem.textContent = msg; problem.hidden = false; };
        const why = nameProblem(nm);
        if (why) return fail(why);
        const clash = findName(wb.names, nm, sheet);
        if (clash && clash !== was) return fail(`There is already a name ${clash.name} ${sheet ? `on ${sheet.name}` : 'in the workbook'}.`);
        let f = refers.value.trim();
        if (!f) return fail('Give what the name refers to.');
        if (!f.startsWith('=')) f = '=' + f;
        const p = wb.formulaProblem(f);
        if (p) return fail(`"Refers to" can't be read: ${p}`);
        const next: DefinedName = { name: nm, formula: f, ...(sheet ? { sheet } : {}), ...(comment.value.trim() ? { comment: comment.value.trim() } : {}), ...(was?.hidden ? { hidden: true } : {}) };
        const list = was ? wb.names.map((n) => (n === was ? next : n)) : [...wb.names, next];
        const renames: [string, string][] = was && was.name !== nm ? [[was.name, nm]] : [];
        this.saveNames(was ? `Edit name ${nm}` : `Define name ${nm}`, list, renames);
        finish(true);
      });
      document.body.append(d);
      d.showModal();
      name.focus();
      name.select();
    });
  }

  /** Define Name: a new name for the selected cells (their column's heading suggested). */
  async defineName(): Promise<void> {
    const v = this.view;
    const s = v.sheet;
    if (!s || !v.wb) return;
    v.commitEdit();
    const R = v.sel.range;
    const above = R.r1 > 0 ? s.shownText(R.r1 - 1, R.c1) : '';
    const top = R.r2 > R.r1 ? s.shownText(R.r1, R.c1) : '';
    const guess = nameFromLabel(above) ?? nameFromLabel(top) ?? '';
    await this.editName(null, { name: guess });
    v.focus();
  }

  /** Name Manager: every name, with New, Edit and Delete. */
  nameManager(): void {
    const v = this.view;
    const wb = v.wb;
    if (!wb) return;
    v.commitEdit();
    const d = el('dialog', 'ask nm-dialog');
    const form = el('form');
    form.method = 'dialog';
    form.append(el('h2', undefined, 'Name Manager'));
    const tools = el('p', 'nm-tools');
    const add = button('New…'), change = button('Edit…'), del = button('Delete');
    const filter = el('input');
    filter.type = 'search';
    filter.placeholder = 'Filter';
    tools.append(add, change, del, filter);
    const table = el('table', 'nm-table');
    const head = el('tr');
    for (const t of ['Name', 'Value', 'Refers To', 'Scope', 'Comment']) head.append(el('th', undefined, t));
    const thead = el('thead');
    thead.append(head);
    const body = el('tbody');
    table.append(thead, body);
    const wrap = el('div', 'nm-wrap');
    wrap.append(table);
    const buttons = el('p', 'ask-buttons');
    const close = el('button', 'primary', 'Close');
    close.type = 'submit';
    buttons.append(close);
    form.append(tools, wrap, buttons);
    d.append(form);

    let picked: DefinedName | null = null;
    const render = () => {
      body.replaceChildren();
      const q = filter.value.trim().toLowerCase();
      const list = this.shownNames().filter((n) => !q || n.name.toLowerCase().includes(q) || n.formula.toLowerCase().includes(q));
      list.sort((a, b) => a.name.localeCompare(b.name) || (a.sheet?.name ?? '').localeCompare(b.sheet?.name ?? ''));
      if (!list.includes(picked!)) picked = null;
      for (const n of list) {
        const tr = el('tr');
        const home = n.sheet ?? v.sheet!;
        let val = '';
        try { val = previewText(wb.formulaArg(home, n.formula, 0, 0)); } catch { val = ''; }
        if (/^=\s*LAMBDA\(/i.test(n.formula)) val = '(a function)';
        for (const t of [n.name, val, n.formula, n.sheet?.name ?? 'Workbook', n.comment ?? '']) tr.append(el('td', undefined, t));
        tr.tabIndex = 0;
        tr.setAttribute('aria-selected', String(n === picked));
        tr.addEventListener('click', () => { picked = n; render(); });
        tr.addEventListener('dblclick', () => { picked = n; void edit(); });
        body.append(tr);
      }
      if (!list.length) {
        const tr = el('tr');
        const td = el('td', 'muted', q ? 'No names match.' : 'No names yet. A name stands for cells, a number or a formula: =SUM(Yields) reads better than =SUM($C$2:$C$40).');
        td.colSpan = 5;
        tr.append(td);
        body.append(tr);
      }
      change.disabled = del.disabled = !picked;
    };
    const edit = async () => { if (picked && await this.editName(picked)) render(); };
    add.addEventListener('click', async () => { if (await this.editName(null)) render(); });
    change.addEventListener('click', () => void edit());
    del.addEventListener('click', () => {
      if (!picked) return;
      const gone = picked;
      this.saveNames(`Delete name ${gone.name}`, wb.names.filter((n) => n !== gone));
      this.host.flash(`${gone.name} deleted: formulas using it show #NAME? (Undo brings it back).`);
      picked = null;
      render();
    });
    filter.addEventListener('input', render);
    d.addEventListener('close', () => { d.remove(); v.focus(); });
    document.body.append(d);
    render();
    d.showModal();
    add.focus();
  }

  /** Use in Formula: the names, to put in the formula being typed. */
  useInFormulaMenu(x: number, y: number): void {
    const v = this.view;
    const names = this.shownNames().filter((n) => !n.sheet || n.sheet === v.sheet);
    const items: ([string, () => void] | null)[] = names.sort((a, b) => a.name.localeCompare(b.name)).map((n) => {
      const fn = /^=\s*LAMBDA\(/i.test(n.formula);
      return [fn ? `${n.name}(…)` : n.name, () => this.put(fn ? `${n.name}()` : n.name, fn ? 1 : 0)] as [string, () => void];
    });
    if (!items.length) items.push(['(no names yet)', () => {}]);
    items.push(null, ['Define Name…', () => void this.defineName()], ['Name Manager…', () => this.nameManager()]);
    popupMenu(x, y, items);
  }

  /** Create from Selection: name each column (or row) of the selection by its heading. */
  createFromSelection(): void {
    const v = this.view;
    const s = v.sheet;
    const wb = v.wb;
    if (!s || !wb) return;
    v.commitEdit();
    const R = v.sel.range;
    if (R.r1 === R.r2 && R.c1 === R.c2) { this.host.flash('Select the headings and the cells under them (or beside them) first.'); return; }
    const d = el('dialog', 'ask');
    const form = el('form');
    form.append(el('h2', undefined, 'Create Names from Selection'), el('p', 'ask-help', 'Name the cells by the headings in the selection\'s:'));
    const boxes: Record<'top' | 'left' | 'bottom' | 'right', HTMLInputElement> = {} as never;
    const labels = { top: 'Top row', left: 'Left column', bottom: 'Bottom row', right: 'Right column' } as const;
    // Excel's guess: headings along the top when the first row is text, down the left when the first column is
    const text = (r: number, c: number) => typeof s.values.get(keyOf(r, c)) === 'string';
    const topGuess = Array.from({ length: R.c2 - R.c1 + 1 }, (_, i) => text(R.r1, R.c1 + i)).every(Boolean);
    const leftGuess = Array.from({ length: R.r2 - R.r1 + 1 }, (_, i) => text(R.r1 + i, R.c1)).every(Boolean) && R.c2 > R.c1;
    for (const k of ['top', 'left', 'bottom', 'right'] as const) {
      const r = el('label', 'ask-row ask-check');
      const b = el('input');
      b.type = 'checkbox';
      b.checked = k === 'top' ? topGuess || !leftGuess : k === 'left' ? leftGuess : false;
      boxes[k] = b;
      r.append(b, el('span', undefined, labels[k]));
      form.append(r);
    }
    const buttons = el('p', 'ask-buttons');
    const cancel = button('Cancel');
    const ok = el('button', 'primary', 'OK');
    ok.type = 'submit';
    buttons.append(cancel, ok);
    form.append(buttons);
    d.append(form);
    const finish = () => { if (d.open) d.close(); d.remove(); v.focus(); };
    cancel.addEventListener('click', finish);
    d.addEventListener('close', () => d.remove());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const b = { top: boxes.top.checked, left: boxes.left.checked, bottom: boxes.bottom.checked, right: boxes.right.checked };
      // the cells left once the heading rows and columns are taken off
      const body: Range = { r1: R.r1 + (b.top ? 1 : 0), r2: R.r2 - (b.bottom ? 1 : 0), c1: R.c1 + (b.left ? 1 : 0), c2: R.c2 - (b.right ? 1 : 0) };
      if (body.r1 > body.r2 || body.c1 > body.c2) { finish(); this.host.flash('That leaves no cells to name.'); return; }
      const made: DefinedName[] = [];
      const skipped: string[] = [];
      const make = (label: string, range: Range) => {
        const nm = nameFromLabel(label);
        if (!nm) { if (label.trim()) skipped.push(label); return; }
        if (made.some((n) => n.name.toLowerCase() === nm.toLowerCase())) { skipped.push(label); return; }
        made.push({ name: nm, formula: refersTo(s.name, range) });
      };
      if (b.top) for (let c = body.c1; c <= body.c2; c++) make(s.shownText(R.r1, c), { r1: body.r1, r2: body.r2, c1: c, c2: c });
      if (b.bottom) for (let c = body.c1; c <= body.c2; c++) make(s.shownText(R.r2, c), { r1: body.r1, r2: body.r2, c1: c, c2: c });
      if (b.left) for (let r = body.r1; r <= body.r2; r++) make(s.shownText(r, R.c1), { r1: r, r2: r, c1: body.c1, c2: body.c2 });
      if (b.right) for (let r = body.r1; r <= body.r2; r++) make(s.shownText(r, R.c2), { r1: r, r2: r, c1: body.c1, c2: body.c2 });
      finish();
      if (!made.length) { this.host.flash('No headings there could be made into names.'); return; }
      // a name already in the workbook is replaced, as Excel asks to
      const kept = wb.names.filter((n) => n.sheet || !made.some((m) => m.name.toLowerCase() === n.name.toLowerCase()));
      this.saveNames('Create names from selection', [...kept, ...made]);
      this.host.flash(`Named ${made.map((n) => n.name).join(', ')}.${skipped.length ? ` Skipped: ${skipped.join(', ')}.` : ''}`, 5000);
    });
    document.body.append(d);
    d.showModal();
    ok.focus();
  }
}
