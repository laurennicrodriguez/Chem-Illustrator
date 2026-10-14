// The periodic table window: pick an element, then click atoms to make them that element (or
// empty space for a new atom). It stays open beside the drawing so several can be picked in turn.

import { SYMBOLS, tablePosition } from '../chem/elements';

export class PeriodicTable {
  private d: HTMLDialogElement | null = null;
  private cells = new Map<number, HTMLButtonElement>();

  /** `pick` gets the atomic number chosen; `current` says which one is in use. */
  constructor(private pick: (z: number) => void, private current: () => number) {}

  get isOpen(): boolean {
    return !!this.d?.open;
  }

  open(): void {
    if (this.d) { this.mark(); this.d.querySelector('input')?.focus(); return; }
    const d = document.createElement('dialog');
    d.className = 'periodic-table';
    d.setAttribute('aria-label', 'Periodic table');
    const head = document.createElement('div');
    head.className = 'pt-head';
    const h = document.createElement('h2');
    h.textContent = 'Periodic Table';
    const find = document.createElement('input');
    find.type = 'text';
    find.placeholder = 'Type a symbol';
    find.setAttribute('aria-label', 'Element symbol');
    find.spellcheck = false;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'pt-close';
    close.textContent = '×';
    close.title = 'Close';
    head.append(h, find, close);

    const grid = document.createElement('div');
    grid.className = 'pt-grid';
    grid.setAttribute('role', 'grid');
    for (let z = 1; z < SYMBOLS.length; z++) {
      const p = tablePosition(z);
      if (!p) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pt-cell';
      b.style.gridRow = String(p.row);
      b.style.gridColumn = String(p.col);
      b.title = `${SYMBOLS[z]} (${z})`;
      const num = document.createElement('small');
      num.textContent = String(z);
      b.append(num, document.createTextNode(SYMBOLS[z]));
      b.addEventListener('click', () => this.choose(z));
      this.cells.set(z, b);
      grid.append(b);
    }
    const note = document.createElement('p');
    note.className = 'muted small';
    note.textContent = 'Pick an element, then click atoms to change them, or empty space to add one. Atoms already selected change straight away.';

    find.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key !== 'Enter') return;
      const t = find.value.trim();
      const z = SYMBOLS.findIndex((s, i) => i > 0 && s.toLowerCase() === t.toLowerCase());
      if (z > 0) { this.choose(z); find.value = ''; } else find.select();
    });
    close.addEventListener('click', () => d.close());
    d.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); d.close(); } });
    d.addEventListener('close', () => { d.remove(); this.d = null; this.cells.clear(); });
    d.append(head, grid, note);
    document.body.append(d);
    this.d = d;
    d.show();
    this.mark();
    find.focus();
  }

  close(): void {
    this.d?.close();
  }

  private choose(z: number): void {
    this.pick(z);
    this.mark();
  }

  /** Show which element is in use. */
  mark(): void {
    const z = this.current();
    for (const [k, b] of this.cells) b.setAttribute('aria-pressed', String(k === z));
  }
}
