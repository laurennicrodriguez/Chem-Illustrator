// Data validation in Sheet mode, as Excel offers it: the Data Validation window (Settings, Input
// Message and Error Alert, as Excel's three tabs), the drop-down list of a cell with a list rule
// (or, in any cell, the entries already in its column: Excel's Pick From Drop-down List), the
// alert when typing breaks a rule, and Circle Invalid Data.

import { popupMenu } from './sheet-view';
import type { SheetView } from './sheet-view';
import type { Sheet } from '../sheet/workbook';
import { Range, rangeName, colName } from '../sheet/refs';
import { readTyped } from '../sheet/values';
import {
  Validation, ValidationKind, ValidationOp, AlertStyle, KIND_NAMES, OP_NAMES, newValidation, listItems, describeValidation,
  limitNumber, twoLimits,
} from '../sheet/validation';
import { subtract, parseRanges, rangesText } from './sheet-format-ui';

export interface ValidationUiHost {
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

/** A labelled row of the window. */
function row(label: string, input: HTMLElement): HTMLLabelElement {
  const r = el('label', 'ask-row');
  r.append(el('span', undefined, label), input);
  return r;
}

function check(label: string, on: boolean): { row: HTMLLabelElement; box: HTMLInputElement } {
  const r = el('label', 'ask-row ask-check');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = on;
  r.append(box, el('span', undefined, label));
  return { row: r, box };
}

/** A list item as typed into a cell (an item starting with = stays text, not a formula). */
const asInput = (t: string): string => (readTyped(t).formula ? `'${t}` : t);

export class SheetValidation {
  constructor(private host: ValidationUiHost) {}

  private get sheet(): Sheet {
    return this.host.view.sheet!;
  }

  // ---------------------------------------------------------------- the drop-down

  /** The cell's list (its rule's, or the entries above and below it in its column), under a point. */
  dropDown(r: number, c: number, at: { x: number; y: number }): void {
    const s = this.sheet;
    const wb = this.host.view.wb!;
    const rule = s.validationAt(r, c);
    const fromRule = rule?.kind === 'list' && !rule.noDropDown;
    const items = fromRule ? listItems(rule!, s, wb.validationHost(s)) : this.columnEntries(s, r, c);
    if (!items.length) {
      this.host.flash(fromRule ? 'The list for this cell is empty: check its source in Data Validation.' : 'There is no text above or below this cell to pick from.');
      return;
    }
    const now = s.shownText(r, c);
    const m = popupMenu(at.x, at.y, items.map((t) => [t, () => {
      this.host.edit('Pick from list', (sh) => sh.setInput(r, c, asInput(t)));
      this.host.view.focus();
    }] as [string, () => void]));
    m.classList.add('sh-drop');
    m.style.minWidth = `${Math.max(80, (this.host.view.screenRect(r, c)?.width ?? 80))}px`;
    // the cell's own value starts picked
    const cur = [...m.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === now);
    if (cur) { cur.classList.add('picked'); cur.focus(); cur.scrollIntoView({ block: 'nearest' }); }
  }

  /** The different text entries in a cell's column, in the block of filled cells around it (as Excel's Pick From Drop-down List). */
  private columnEntries(s: Sheet, r: number, c: number): string[] {
    const region = s.currentRegion(r, c);
    const seen = new Set<string>();
    for (let row = region.r1; row <= region.r2; row++) {
      if (row === r) continue;
      const v = s.value(row, c);
      if (typeof v === 'string' && v.trim()) seen.add(s.shownText(row, c));
    }
    return [...seen].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  // ---------------------------------------------------------------- the alert

  /** Typing broke a rule: show its alert (Stop: Retry or Cancel; Warning: go on, retry, cancel; Information: OK or Cancel). */
  alert(rule: Validation, text: string): Promise<'retry' | 'keep' | 'cancel'> {
    return new Promise((resolve) => {
      const style: AlertStyle = rule.alertStyle ?? 'stop';
      const d = el('dialog', 'ask sh-alert');
      d.setAttribute('role', 'alertdialog');
      const h = el('h2', undefined, rule.alertTitle || (style === 'stop' ? 'Not allowed here' : style === 'warning' ? 'Check this value' : 'About this value'));
      const icon = el('span', `sh-alert-icon ${style}`, style === 'stop' ? '✕' : style === 'warning' ? '!' : 'i');
      icon.setAttribute('aria-hidden', 'true');
      h.prepend(icon);
      const msg = el('p', 'sh-alert-text', rule.alert || `"${text}" isn't allowed in this cell: it takes ${describeValidation(rule)}.`);
      const buttons = el('p', 'ask-buttons');
      let answered = false;
      const done = (v: 'retry' | 'keep' | 'cancel') => {
        if (answered) return;
        answered = true;
        if (d.open) d.close();
        d.remove();
        resolve(v);
      };
      const btn = (label: string, v: 'retry' | 'keep' | 'cancel', primary = false) => {
        const b = el('button', primary ? 'primary' : undefined, label);
        b.type = 'button';
        b.addEventListener('click', () => done(v));
        buttons.append(b);
        return b;
      };
      let first: HTMLButtonElement;
      if (style === 'stop') { first = btn('Retry', 'retry', true); btn('Cancel', 'cancel'); }
      else if (style === 'warning') {
        msg.append(el('br'), el('span', 'muted', 'Keep it anyway?'));
        first = btn('Yes', 'keep', true); btn('No', 'retry'); btn('Cancel', 'cancel');
      } else { first = btn('OK', 'keep', true); btn('Cancel', 'cancel'); }
      d.append(h, msg, buttons);
      // Escape is Cancel (for Stop, back to typing as Excel's Retry would leave it is the safer choice)
      d.addEventListener('cancel', (e) => { e.preventDefault(); done(style === 'stop' ? 'retry' : 'cancel'); });
      d.addEventListener('close', () => done('retry'));
      document.body.append(d);
      d.showModal();
      first.focus();
    });
  }

  // ---------------------------------------------------------------- Circle Invalid Data

  /** Data > Circle Invalid Data (again: Clear Validation Circles). */
  toggleCircles(on = !this.host.view.circleInvalid): void {
    const v = this.host.view;
    v.circleInvalid = on;
    v.refresh();
    if (!on) return;
    const n = v.invalidCount();
    this.host.flash(n ? `${n} cell${n > 1 ? 's break their' : ' breaks its'} data validation rule${n > 1 ? 's' : ''} (circled in red).` : 'Every cell with a rule passes it.');
  }

  // ---------------------------------------------------------------- the window

  /** The rule on the selected cells (Data > Data Validation…). */
  dialog(): void {
    const v = this.host.view;
    const s = this.sheet;
    if (!s || s.dashboard) return;
    v.commitEdit();
    const R = v.sel.range;
    const target: Range = R;
    const rule = s.validationAt(v.sel.active.r, v.sel.active.c);
    const others = s.validations.filter((x) => x !== rule && x.ranges.some((rr) => rr.r1 <= target.r2 && target.r1 <= rr.r2 && rr.c1 <= target.c2 && target.c1 <= rr.c2));

    const d = el('dialog', 'ask dv-dialog');
    const form = el('form');
    form.append(el('h2', undefined, 'Data Validation'));
    const tabs = el('div', 'dv-tabs');
    tabs.setAttribute('role', 'tablist');
    const pages: HTMLElement[] = [];
    const tabBtns: HTMLButtonElement[] = [];
    const page = (name: string) => {
      const b = el('button', undefined, name);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      const p = el('div', 'dv-page');
      p.setAttribute('role', 'tabpanel');
      const i = pages.length;
      b.addEventListener('click', () => pick(i));
      tabs.append(b);
      tabBtns.push(b);
      pages.push(p);
      return p;
    };
    const pick = (i: number) => {
      pages.forEach((p, j) => { p.hidden = j !== i; });
      tabBtns.forEach((b, j) => b.setAttribute('aria-selected', String(j === i)));
    };

    // Settings
    const settings = page('Settings');
    const kind = el('select');
    for (const k of Object.keys(KIND_NAMES) as ValidationKind[]) kind.add(new Option(KIND_NAMES[k], k, false, k === (rule?.kind ?? 'any')));
    const op = el('select');
    for (const o of Object.keys(OP_NAMES) as ValidationOp[]) op.add(new Option(OP_NAMES[o], o, false, o === (rule?.op ?? 'between')));
    const v1 = el('input');
    v1.value = rule?.value1 ?? '';
    const v2 = el('input');
    v2.value = rule?.value2 ?? '';
    const blank = check('Ignore blank (empty cells pass)', !rule?.noBlank);
    const drop = check('In-cell drop-down', !rule?.noDropDown);
    const rows = { op: row('Data', op), v1: row('Minimum', v1), v2: row('Maximum', v2) };
    const hint = el('p', 'muted small');
    const where = el('input');
    where.value = rule ? rangesText(rule.ranges) : rangeName(target);
    settings.append(row('Allow', kind), rows.op, rows.v1, rows.v2, blank.row, drop.row, hint, row('Applies to', where));
    const sync = () => {
      const k = kind.value as ValidationKind;
      const comparing = k !== 'any' && k !== 'list' && k !== 'custom';
      const two = comparing && twoLimits({ op: op.value as ValidationOp });
      rows.op.hidden = !comparing;
      rows.v1.hidden = k === 'any';
      rows.v2.hidden = !two;
      drop.row.hidden = k !== 'list';
      blank.row.hidden = k === 'any';
      const unit = k === 'date' ? ' date' : k === 'time' ? ' time' : k === 'length' ? ' length' : '';
      const o = op.value as ValidationOp;
      (rows.v1.firstChild as HTMLElement).textContent = k === 'list' ? 'Source' : k === 'custom' ? 'Formula' : two ? `Minimum${unit}` : o === 'greaterThan' || o === 'greaterThanOrEqual' ? `Minimum${unit}` : o === 'lessThan' || o === 'lessThanOrEqual' ? `Maximum${unit}` : `Value${unit}`;
      (rows.v2.firstChild as HTMLElement).textContent = `Maximum${unit}`;
      v1.placeholder = k === 'list' ? 'Pd(OAc)2, PdCl2, Pd(PPh3)4  or  =$H$2:$H$20' : k === 'custom' ? `=ISNUMBER(${colName(target.c1)}${target.r1 + 1})` : k === 'date' ? '2026-01-31 or =TODAY()' : k === 'time' ? '08:00' : '0 or =B1';
      v2.placeholder = k === 'date' ? '2026-12-31' : k === 'time' ? '18:00' : '100';
      hint.textContent = k === 'list' ? 'Items separated by commas, or a reference to cells holding them (=$H$2:$H$20, or =Reagents!$A$2:$A$40).'
        : k === 'custom' ? `A formula for the first cell (${colName(target.c1)}${target.r1 + 1}) that is TRUE for values to allow; it moves to each other cell as a copied formula does.`
          : k === 'any' ? 'Anything can be typed. An input message can still be shown.' : 'A limit can be a number or a formula (=B1, =TODAY()).';
    };
    kind.addEventListener('change', sync);
    op.addEventListener('change', sync);

    // Input Message
    const input = page('Input Message');
    const showPrompt = check('Show input message when the cell is selected', !rule?.hidePrompt);
    const pTitle = el('input');
    pTitle.value = rule?.promptTitle ?? '';
    pTitle.maxLength = 32;
    const pText = el('textarea');
    pText.rows = 4;
    pText.value = rule?.prompt ?? '';
    pText.maxLength = 255;
    pText.placeholder = 'e.g. Equivalents relative to the limiting reagent';
    input.append(showPrompt.row, row('Title', pTitle), row('Message', pText));

    // Error Alert
    const alert = page('Error Alert');
    const showAlert = check('Show an alert after something else is typed', !rule?.noAlert);
    const style = el('select');
    for (const [k, label] of [['stop', 'Stop: it can\'t be typed'], ['warning', 'Warning: ask whether to keep it'], ['information', 'Information: say so, and keep it']] as const) style.add(new Option(label, k, false, k === (rule?.alertStyle ?? 'stop')));
    const aTitle = el('input');
    aTitle.value = rule?.alertTitle ?? '';
    aTitle.maxLength = 32;
    const aText = el('textarea');
    aText.rows = 4;
    aText.value = rule?.alert ?? '';
    aText.maxLength = 255;
    aText.placeholder = 'Left empty, the alert says what the cell takes.';
    alert.append(showAlert.row, row('Style', style), row('Title', aTitle), row('Message', aText));

    const problem = el('p', 'dv-problem');
    problem.hidden = true;
    const buttons = el('p', 'ask-buttons');
    const clearAll = el('button', 'dv-clear', 'Clear All');
    clearAll.type = 'button';
    clearAll.title = 'Take the rules off the selected cells';
    const cancel = el('button', undefined, 'Cancel');
    cancel.type = 'button';
    const ok = el('button', 'primary', 'OK');
    ok.type = 'submit';
    buttons.append(clearAll, cancel, ok);
    form.append(tabs, ...pages, problem, buttons);
    d.append(form);
    pick(0);
    sync();
    if (others.length) {
      const note = el('p', 'muted small', 'Some of the selected cells have another rule: OK replaces it there with this one.');
      settings.append(note);
    }

    const finish = () => { if (d.open) d.close(); d.remove(); v.focus(); };
    const fail = (msg: string, tab = 0) => { problem.textContent = msg; problem.hidden = false; pick(tab); };
    cancel.addEventListener('click', finish);
    d.addEventListener('close', () => d.remove());
    clearAll.addEventListener('click', () => {
      const ranges = parseRanges(where.value) ?? [target];
      this.apply(ranges, null, 'Clear data validation');
      finish();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const k = kind.value as ValidationKind;
      const ranges = parseRanges(where.value);
      if (!ranges) return fail('"Applies to" doesn\'t read as cells (like B2:B20, D2:D20).');
      const comparing = k !== 'any' && k !== 'list' && k !== 'custom';
      const o = op.value as ValidationOp;
      const two = comparing && twoLimits({ op: o });
      const reads = (t: string) => t.trim().startsWith('=') ? t.trim().length > 1 : limitNumber(k, t) !== null;
      if (comparing && !reads(v1.value)) return fail(`The ${k === 'date' ? 'date' : k === 'time' ? 'time' : 'limit'} "${v1.value}" doesn't read${k === 'date' ? ' (type it as 2026-01-31)' : k === 'time' ? ' (type it as 13:30)' : ' as a number or a formula'}.`);
      if (two && !reads(v2.value)) return fail(`The maximum "${v2.value}" doesn't read as a ${k === 'date' ? 'date' : k === 'time' ? 'time' : 'number or a formula'}.`);
      if (k === 'list' && !v1.value.split(',').some((x) => x.trim())) return fail('Give the list: items separated by commas, or a reference like =$H$2:$H$20.');
      if (k === 'list' && !v1.value.trim().startsWith('=') && v1.value.length > 255) return fail('Excel takes a typed list of up to 255 characters: put longer lists in cells and give their reference.');
      if (k === 'custom' && !v1.value.trim()) return fail('Give a formula that is TRUE for the values to allow.');
      if (k === 'custom' || v1.value.trim().startsWith('=') || v2.value.trim().startsWith('=')) {
        for (const t of [v1.value, two ? v2.value : '']) {
          const f = t.trim();
          if (!f || (!f.startsWith('=') && k !== 'custom')) continue;
          const p = v.wb!.formulaProblem(f.startsWith('=') ? f : '=' + f);
          if (p) return fail(`That formula can't be read: ${p}`);
        }
      }
      const next: Omit<Validation, 'id' | 'ranges'> = {
        kind: k,
        ...(comparing && o !== 'between' ? { op: o } : {}),
        ...(k !== 'any' ? { value1: k === 'custom' && !v1.value.trim().startsWith('=') ? '=' + v1.value.trim() : v1.value.trim() } : {}),
        ...(two ? { value2: v2.value.trim() } : {}),
        ...(k !== 'any' && !blank.box.checked ? { noBlank: true } : {}),
        ...(k === 'list' && !drop.box.checked ? { noDropDown: true } : {}),
        ...(pTitle.value.trim() ? { promptTitle: pTitle.value.trim() } : {}),
        ...(pText.value.trim() ? { prompt: pText.value.trim() } : {}),
        ...(!showPrompt.box.checked ? { hidePrompt: true } : {}),
        ...(style.value !== 'stop' ? { alertStyle: style.value as AlertStyle } : {}),
        ...(aTitle.value.trim() ? { alertTitle: aTitle.value.trim() } : {}),
        ...(aText.value.trim() ? { alert: aText.value.trim() } : {}),
        ...(!showAlert.box.checked ? { noAlert: true } : {}),
      };
      // "any value" with no message is no rule at all
      const keep = k !== 'any' || !!next.prompt || !!next.promptTitle;
      this.apply(ranges, keep ? next : null, rule ? 'Change data validation' : 'Data validation');
      finish();
    });
    document.body.append(d);
    d.showModal();
    kind.focus();
  }

  /** Put a rule on some cells (null: take the rules off them), taking those cells out of other rules. */
  private apply(ranges: Range[], rule: Omit<Validation, 'id' | 'ranges'> | null, label: string): void {
    this.host.edit(label, (s) => {
      const list = s.validations
        .map((x) => ({ ...x, ranges: ranges.reduce((acc, cut) => acc.flatMap((rr) => subtract(rr, cut)), x.ranges) }))
        .filter((x) => x.ranges.length);
      if (rule) list.push(newValidation(ranges, rule));
      s.setValidations(list);
    });
  }
}
