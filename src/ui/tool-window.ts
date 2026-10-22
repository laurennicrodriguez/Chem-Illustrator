// Windows for Excel's Data tools (the Analysis ToolPak, Goal Seek, Data Table, Solver, PivotTable):
// they float beside the sheet without blocking it, so cells can be picked while one is open.
// Clicking or dragging over cells fills the last range box that had the focus (Excel's RefEdit),
// with absolute references ($A$1:$B$9), and the sheet's name when the cells are on another sheet.

import type { Range } from '../sheet/refs';
import { colName, quoteSheet } from '../sheet/refs';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** A block as a range box shows it: $A$1:$B$9, with the sheet's name when it isn't the window's own. */
export function absText(r: Range, sheet: string | null): string {
  const a = `$${colName(r.c1)}$${r.r1 + 1}`, b = `$${colName(r.c2)}$${r.r2 + 1}`;
  return `${sheet ? `${quoteSheet(sheet)}!` : ''}${a === b ? a : `${a}:${b}`}`;
}

/** The window open now (one at a time, as Excel's tools are). */
let current: ToolWindow | null = null;

export class ToolWindow {
  readonly d: HTMLDialogElement;
  readonly form: HTMLFormElement;
  readonly body: HTMLDivElement;
  private err: HTMLParagraphElement;
  private lastRef: HTMLInputElement | null = null;
  private buttons: HTMLParagraphElement;
  onClose: (() => void) | null = null;
  /** The sheet the window was opened on (cells picked on another sheet carry its name). */
  home: string | null = null;

  constructor(title: string, cls = '') {
    current?.close();
    current = this;
    this.d = el('dialog', `ask tool-window ${cls}`.trim());
    this.form = el('form');
    this.form.method = 'dialog';
    const h = el('h2', undefined, title);
    this.body = el('div', 'tool-body');
    this.err = el('p', 'tool-error');
    this.err.hidden = true;
    this.buttons = el('p', 'ask-buttons');
    this.form.append(h, this.body, this.err, this.buttons);
    this.d.append(this.form);
    // Enter in a box never closes a window without an OK button
    this.form.addEventListener('submit', (e) => e.preventDefault());
    this.d.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    // the window can be moved by its title
    h.addEventListener('pointerdown', (e) => {
      const r = this.d.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = (m: PointerEvent) => { this.d.style.left = `${Math.max(0, m.clientX - dx)}px`; this.d.style.top = `${Math.max(0, m.clientY - dy)}px`; this.d.style.right = 'auto'; };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
    });
  }

  /** The open window, if any (cell picks go to it). */
  static get open(): ToolWindow | null {
    return current && current.d.open ? current : null;
  }

  /** A line of text. */
  note(text: string, cls = 'muted'): HTMLParagraphElement {
    const p = el('p', cls, text);
    this.body.append(p);
    return p;
  }

  /** A titled group (Input, Output options). */
  group(title: string): HTMLFieldSetElement {
    const f = el('fieldset', 'tw-group');
    f.append(el('legend', undefined, title));
    this.body.append(f);
    return f;
  }

  private row(label: string, input: HTMLElement, into: HTMLElement = this.body, unit?: string): HTMLLabelElement {
    const r = el('label', 'ask-row');
    r.append(el('span', undefined, label), input);
    if (unit) r.append(el('span', 'muted', unit));
    into.append(r);
    return r;
  }

  /** A box for a reference: filled by picking cells while it (or nothing else) has the focus. */
  ref(label: string, value = '', into?: HTMLElement): HTMLInputElement {
    const inp = el('input', 'ref-box');
    inp.value = value;
    inp.spellcheck = false;
    inp.placeholder = 'Pick cells, or type $A$1:$B$9';
    inp.addEventListener('focus', () => { this.lastRef = inp; });
    this.row(label, inp, into);
    if (!this.lastRef) this.lastRef = inp;
    return inp;
  }

  text(label: string, value = '', into?: HTMLElement, unit?: string): HTMLInputElement {
    const inp = el('input');
    inp.value = value;
    inp.addEventListener('focus', () => { this.lastRef = null; });
    this.row(label, inp, into, unit);
    return inp;
  }

  num(label: string, value: number | string, into?: HTMLElement, unit?: string): HTMLInputElement {
    const inp = this.text(label, String(value), into, unit);
    inp.inputMode = 'decimal';
    return inp;
  }

  check(label: string, checked = false, into: HTMLElement = this.body): HTMLInputElement {
    const r = el('label', 'ask-row ask-check');
    const inp = el('input');
    inp.type = 'checkbox';
    inp.checked = checked;
    r.append(inp, el('span', undefined, label));
    into.append(r);
    return inp;
  }

  select<T extends string>(label: string, options: [T, string][], value: T, into?: HTMLElement): HTMLSelectElement {
    const sel = el('select');
    for (const [v, t] of options) sel.add(new Option(t, v, false, v === value));
    sel.addEventListener('focus', () => { this.lastRef = null; });
    this.row(label, sel, into);
    return sel;
  }

  /** Radio buttons; returns a getter for the picked value. */
  radios<T extends string>(name: string, options: [T, string][], value: T, into: HTMLElement = this.body): { get: () => T; inputs: HTMLInputElement[] } {
    const inputs: HTMLInputElement[] = [];
    const box = el('div', 'tool-radios');
    for (const [v, t] of options) {
      const r = el('label', 'ask-check');
      const inp = el('input');
      inp.type = 'radio';
      inp.name = name;
      inp.value = v;
      inp.checked = v === value;
      r.append(inp, el('span', undefined, t));
      box.append(r);
      inputs.push(inp);
    }
    into.append(box);
    return { get: () => (inputs.find((i) => i.checked)?.value ?? value) as T, inputs };
  }

  /** Show a problem (or clear it with null). */
  error(msg: string | null): void {
    this.err.textContent = msg ?? '';
    this.err.hidden = !msg;
  }

  /**
   * The buttons: OK, Cancel, and others before them. OK's handler returns a problem to show (the
   * window stays open), false to stay open without one, or nothing to close.
   */
  actions(ok: string, onOk: () => string | false | null | void | Promise<string | false | null | void>, extra: [string, () => void][] = [], cancel = 'Cancel'): void {
    for (const [t, f] of extra) {
      const b = el('button', undefined, t);
      b.type = 'button';
      b.addEventListener('click', f);
      this.buttons.append(b);
    }
    const c = el('button', undefined, cancel);
    c.type = 'button';
    c.addEventListener('click', () => this.close());
    const o = el('button', 'primary', ok);
    o.type = 'submit';
    this.buttons.append(c, o);
    this.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      this.error(null);
      const problem = await onOk();
      if (typeof problem === 'string') this.error(problem);
      else if (problem !== false) this.close();
    });
  }

  /** A button at the bottom (for windows that act as soon as something changes, with no OK). */
  button(text: string, fn: () => void, cls = ''): HTMLButtonElement {
    const b = el('button', cls || undefined, text);
    b.type = 'button';
    b.addEventListener('click', fn);
    this.buttons.append(b);
    return b;
  }

  show(): void {
    document.body.append(this.d);
    this.d.show();
    const first = this.form.querySelector<HTMLInputElement>('input:not([type=checkbox]):not([type=radio]), select');
    first?.focus();
    first?.select?.();
  }

  close(): void {
    if (current === this) current = null;
    if (this.d.open) this.d.close();
    this.d.remove();
    this.onClose?.();
  }

  /** Cells were picked on a sheet: fill the range box that last had the focus. */
  picked(r: Range, sheet: string | null): void {
    const box = this.lastRef;
    if (!box || !box.isConnected) return;
    box.value = absText(r, sheet);
    box.dispatchEvent(new Event('input'));
  }
}
