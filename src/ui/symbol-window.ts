// Insert > Symbol: a window of characters to type, found by name ("degree", "angstrom", "arrow
// right"), by group or by code (U+00B0), with the ones used lately along the top. It floats
// beside the work and leaves the typing where it was: a click on a character types it there and
// the window stays open for the next one, as Word's does.

import { SYMBOL_GROUPS, codeOf, groupSymbols, searchSymbols, symbolInfo, type SymbolInfo } from '../text/symbols';

export interface SymbolTarget {
  /** Type the character where the person is typing; false (with a message shown) when there is nowhere to type it. */
  insert(ch: string): boolean;
  /** The recently used symbols, newest first. */
  recent(): string[];
  /** A symbol was used. */
  used(ch: string): void;
  /** A word of warning about a character where it would go now ('' for none), e.g. that a ChemDraw file can't keep it. */
  warn?(ch: string): string;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** How a character is described: its name (capitalised) and its code. */
export function describe(s: SymbolInfo): string {
  const name = s.name ? s.name[0].toUpperCase() + s.name.slice(1) : 'Character';
  return `${name} (${codeOf(s.ch)})`;
}

export class SymbolWindow {
  readonly d: HTMLDialogElement;
  private search: HTMLInputElement;
  private group: HTMLSelectElement;
  private recentRow: HTMLDivElement;
  private grid: HTMLDivElement;
  private info: HTMLParagraphElement;
  private shown: SymbolInfo[] = [];

  constructor(private target: SymbolTarget) {
    this.d = el('dialog', 'ask tool-window symbol-window');
    // typing stays where it was while this window is used (see caption-editor)
    this.d.dataset.keepsTyping = '';
    this.d.setAttribute('aria-label', 'Insert Symbol');
    const form = el('form');
    form.method = 'dialog';
    form.addEventListener('submit', (e) => e.preventDefault());
    const h = el('h2', undefined, 'Symbol');
    const top = el('div', 'sym-top');
    this.search = el('input');
    this.search.type = 'search';
    this.search.spellcheck = false;
    this.search.placeholder = 'Find: alpha, degree, arrow, U+00B0…';
    this.search.setAttribute('aria-label', 'Find a symbol by name or code');
    this.group = el('select');
    this.group.setAttribute('aria-label', 'Group of symbols');
    this.group.add(new Option('Recently used', 'recent'));
    for (const g of SYMBOL_GROUPS) this.group.add(new Option(g.title, g.id));
    top.append(this.search, this.group);
    const recentHead = el('div', 'sym-head', 'Recently used');
    this.recentRow = el('div', 'sym-row');
    this.recentRow.setAttribute('role', 'group');
    this.recentRow.setAttribute('aria-label', 'Recently used symbols');
    this.grid = el('div', 'sym-grid');
    this.grid.setAttribute('role', 'group');
    this.grid.setAttribute('aria-label', 'Symbols');
    this.info = el('p', 'sym-info muted', 'Click a symbol to type it where the caret is.');
    const buttons = el('p', 'ask-buttons');
    const close = el('button', undefined, 'Close');
    close.type = 'button';
    close.addEventListener('click', () => this.close());
    buttons.append(close);
    form.append(h, top, recentHead, this.recentRow, this.grid, this.info, buttons);
    this.d.append(form);

    this.search.addEventListener('input', () => this.fill());
    this.group.addEventListener('change', () => { this.search.value = ''; this.fill(); });
    this.search.addEventListener('keydown', (e) => {
      // Enter types the first symbol found; Down goes into the symbols
      if (e.key === 'Enter') { e.preventDefault(); if (this.shown[0]) this.use(this.shown[0].ch); }
      if (e.key === 'ArrowDown') { e.preventDefault(); this.grid.querySelector<HTMLButtonElement>('button')?.focus(); }
    });
    this.grid.addEventListener('keydown', (e) => this.arrowKeys(e));
    this.d.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    // moved by its title, as the other tool windows are
    h.addEventListener('pointerdown', (e) => {
      const r = this.d.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = (m: PointerEvent) => { this.d.style.left = `${Math.max(0, m.clientX - dx)}px`; this.d.style.top = `${Math.max(0, m.clientY - dy)}px`; this.d.style.right = 'auto'; };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
    });
  }

  get isOpen(): boolean {
    return this.d.open;
  }

  /** Show the window (it stays open beside the work until closed). */
  open(): void {
    if (!this.d.isConnected) document.body.append(this.d);
    if (!this.d.open) this.d.show();
    // the recently used group when there are some, as Word opens on them
    if (!this.search.value && this.group.value === 'recent' && !this.target.recent().length) this.group.value = SYMBOL_GROUPS[0].id;
    this.fill();
    this.search.focus();
    this.search.select();
  }

  close(): void {
    if (this.d.open) this.d.close();
  }

  private tile(s: SymbolInfo): HTMLButtonElement {
    const b = el('button', 'sym', s.ch);
    b.type = 'button';
    b.title = describe(s);
    b.setAttribute('aria-label', b.title);
    // pressing it doesn't take the focus from the text being typed
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => this.use(s.ch));
    const show = () => this.describe(s);
    b.addEventListener('pointerenter', show);
    b.addEventListener('focus', show);
    return b;
  }

  private describe(s: SymbolInfo): void {
    const warn = this.target.warn?.(s.ch) ?? '';
    this.info.replaceChildren(el('span', 'sym-big', s.ch), el('span', undefined, describe(s)), ...(warn ? [el('span', 'sym-warn', warn)] : []));
  }

  /** Show the recently used row and the symbols found or of the group picked. */
  fill(): void {
    const recent = this.target.recent().map(symbolInfo);
    this.recentRow.replaceChildren(...recent.map((s) => this.tile(s)));
    if (!recent.length) this.recentRow.append(el('span', 'muted small', 'Symbols you use show here.'));
    const q = this.search.value.trim();
    this.shown = q ? searchSymbols(q) : this.group.value === 'recent' ? recent : groupSymbols(this.group.value);
    this.grid.replaceChildren(...this.shown.map((s) => this.tile(s)));
    if (!this.shown.length) this.grid.append(el('span', 'muted small', q ? `Nothing called "${q}". Try another word, or a code such as U+2192.` : 'No symbols used yet.'));
  }

  private use(ch: string): void {
    if (!this.target.insert(ch)) return;
    this.target.used(ch);
    const s = symbolInfo(ch);
    this.fill();
    this.describe(s);
  }

  /** Arrow keys move through the symbols (a row is as wide as the window shows it). */
  private arrowKeys(e: KeyboardEvent): void {
    const tiles = [...this.grid.querySelectorAll<HTMLButtonElement>('button.sym')];
    const i = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const across = Math.max(1, Math.round(this.grid.clientWidth / (tiles[0].offsetWidth || 32)));
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: across, ArrowUp: -across }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const j = i + step;
    if (j < 0) { this.search.focus(); return; }
    tiles[Math.min(tiles.length - 1, j)]?.focus();
  }
}
