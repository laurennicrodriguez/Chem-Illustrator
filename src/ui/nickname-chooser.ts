// The = key: a list of the nicknames (abbreviations such as Boc, OTf, TBS) to pick one for the
// atom under the mouse. Typing narrows the list; Enter or a click uses the highlighted one.

import { NICKNAMES } from '../chem/labels';

export class NicknameChooser {
  private d: HTMLDialogElement;
  private filter: HTMLInputElement;
  private list: HTMLDivElement;
  private pick: ((name: string) => void) | null = null;
  private shown: string[] = [];
  private current = 0;

  constructor() {
    this.d = document.createElement('dialog');
    this.d.className = 'nicknames';
    this.d.innerHTML = `<h2>Choose a nickname</h2>
      <input type="search" placeholder="Type to narrow the list (Boc, TBS, OTf…)" aria-label="Find a nickname" />
      <div class="nick-list" role="listbox" aria-label="Nicknames"></div>
      <p class="ask-buttons"><button type="button" data-act="cancel">Cancel</button></p>`;
    this.filter = this.d.querySelector('input')!;
    this.list = this.d.querySelector('.nick-list')!;
    this.filter.addEventListener('input', () => this.render());
    this.filter.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.move(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (this.shown[this.current]) this.choose(this.shown[this.current]);
      }
    });
    this.list.addEventListener('click', (e) => {
      const name = (e.target as HTMLElement).closest<HTMLElement>('[data-name]')?.dataset.name;
      if (name) this.choose(name);
    });
    this.d.querySelector('[data-act="cancel"]')!.addEventListener('click', () => this.d.close());
    this.d.addEventListener('close', () => { this.pick = null; });
    document.body.append(this.d);
  }

  /** Open the list; `pick` gets the chosen nickname. */
  open(pick: (name: string) => void): void {
    this.pick = pick;
    this.filter.value = '';
    this.render();
    this.d.showModal();
    this.filter.focus();
  }

  private render(): void {
    const q = this.filter.value.trim().toLowerCase();
    const names = Object.keys(NICKNAMES).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    // names starting with what was typed first, then those containing it
    this.shown = q
      ? [...names.filter((n) => n.toLowerCase().startsWith(q)), ...names.filter((n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q))]
      : names;
    this.current = 0;
    this.list.replaceChildren(...this.shown.map((n, i) => {
      const row = document.createElement('div');
      row.className = 'nick' + (i === 0 ? ' current' : '');
      row.setAttribute('role', 'option');
      row.dataset.name = n;
      const name = document.createElement('b');
      name.textContent = n;
      const smi = document.createElement('span');
      smi.className = 'muted';
      smi.textContent = NICKNAMES[n] === '*' ? 'any group' : NICKNAMES[n];
      row.append(name, smi);
      return row;
    }));
    if (!this.shown.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No nickname matches. Press Enter on an atom to type any label.';
      this.list.append(p);
    }
  }

  private move(step: number): void {
    if (!this.shown.length) return;
    const rows = this.list.querySelectorAll<HTMLElement>('.nick');
    rows[this.current]?.classList.remove('current');
    this.current = (this.current + step + this.shown.length) % this.shown.length;
    rows[this.current]?.classList.add('current');
    rows[this.current]?.scrollIntoView({ block: 'nearest' });
  }

  private choose(name: string): void {
    const pick = this.pick;
    this.d.close();
    pick?.(name);
  }
}
