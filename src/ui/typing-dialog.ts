// Edit > Typing and Spelling: switch chemistry formatting and the spelling check on or off,
// change the replacements made as you type, and edit the words added to the spelling check.
// Everything takes effect at once and is saved in the settings file.

import { DEFAULT_REPLACEMENTS } from '../text/chemtext';

export interface TypingDialogOptions {
  get(): { chemistry: boolean; spelling: boolean; replacements: [string, string][]; dictionary: string[] };
  set(v: Partial<{ chemistry: boolean; spelling: boolean; replacements: [string, string][]; dictionary: string[] }>): void;
  location(): Promise<string>;
}

export class TypingDialog {
  private d: HTMLDialogElement;
  private rows: HTMLTableSectionElement;
  private words: HTMLTextAreaElement;
  private chem: HTMLInputElement;
  private spell: HTMLInputElement;

  constructor(private opts: TypingDialogOptions) {
    const d = (this.d = document.createElement('dialog'));
    d.className = 'typing-dialog';
    d.setAttribute('aria-label', 'Typing and Spelling');
    d.innerHTML = `
      <h2>Typing and Spelling</h2>
      <label class="hk-opt"><input type="checkbox" data-opt="chem" /><span>Format chemistry as I type: CH2Cl2 → CH<sub>2</sub>Cl<sub>2</sub>, 1H NMR → <sup>1</sup>H NMR, DMSO-d6 → DMSO-<i>d</i><sub>6</sub>. Press <kbd>Ctrl+Z</kbd> straight after to take one back. (Text in formula style already shows its subscripts.)</span></label>
      <label class="hk-opt"><input type="checkbox" data-opt="spell" /><span>Check spelling, with chemistry words (red underlines), and chemistry formatting (blue underlines) in text being typed. Right-click an underlined word for suggestions.</span></label>
      <h3>Replacements as you type</h3>
      <p class="muted small">When you finish a word with a space or punctuation, text on the left becomes text on the right. A replacement that starts with a letter only applies as a whole word (65 oC, not ZnoC).</p>
      <div class="ty-table-wrap"><table class="ty-table"><thead><tr><th>Type</th><th>Becomes</th><th></th></tr></thead><tbody></tbody></table></div>
      <div class="ty-row-buttons"><button type="button" data-act="add">Add a replacement</button><button type="button" data-act="reset">Use the standard list</button></div>
      <h3>My dictionary</h3>
      <p class="muted small">Words the spelling check accepts, one per line (Add to Dictionary on an underlined word adds it here).</p>
      <textarea class="ty-words" rows="6" spellcheck="false" aria-label="My dictionary, one word per line"></textarea>
      <div class="hk-foot">
        <span class="muted small">Saved in <code class="ty-where"></code></span>
        <span class="hk-buttons"><button type="button" data-act="close" class="primary">Close</button></span>
      </div>`;
    this.rows = d.querySelector('tbody')!;
    this.words = d.querySelector('.ty-words')!;
    this.chem = d.querySelector('input[data-opt=chem]')!;
    this.spell = d.querySelector('input[data-opt=spell]')!;
    this.chem.addEventListener('change', () => opts.set({ chemistry: this.chem.checked }));
    this.spell.addEventListener('change', () => opts.set({ spelling: this.spell.checked }));
    this.words.addEventListener('input', () => opts.set({ dictionary: this.words.value.split(/\r?\n/).map((w) => w.trim()).filter(Boolean) }));
    d.querySelector('[data-act=add]')!.addEventListener('click', () => { this.addRow('', ''); (this.rows.lastElementChild?.querySelector('input') as HTMLInputElement | null)?.focus(); });
    d.querySelector('[data-act=reset]')!.addEventListener('click', () => { this.fill(DEFAULT_REPLACEMENTS); this.saveRows(); });
    d.querySelector('[data-act=close]')!.addEventListener('click', () => d.close());
    // keys typed here are for the window, not the drawing
    d.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    document.body.appendChild(d);
  }

  open(): void {
    const v = this.opts.get();
    this.chem.checked = v.chemistry;
    this.spell.checked = v.spelling;
    this.fill(v.replacements);
    this.words.value = v.dictionary.join('\n');
    void this.opts.location().then((w) => { this.d.querySelector('.ty-where')!.textContent = w; });
    this.d.showModal();
  }

  private fill(list: readonly [string, string][]): void {
    this.rows.textContent = '';
    for (const [a, b] of list) this.addRow(a, b);
  }

  private addRow(from: string, to: string): void {
    const tr = document.createElement('tr');
    const cell = (value: string, label: string) => {
      const td = document.createElement('td');
      const input = document.createElement('input');
      input.value = value;
      input.setAttribute('aria-label', label);
      input.spellcheck = false;
      input.addEventListener('input', () => this.saveRows());
      td.appendChild(input);
      tr.appendChild(td);
    };
    cell(from, 'Type');
    cell(to, 'Becomes');
    const td = document.createElement('td');
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'hk-add';
    del.textContent = '×';
    del.title = 'Remove this replacement';
    del.setAttribute('aria-label', `Remove ${from || 'this replacement'}`);
    del.addEventListener('click', () => { tr.remove(); this.saveRows(); });
    td.appendChild(del);
    tr.appendChild(td);
    this.rows.appendChild(tr);
  }

  private saveRows(): void {
    const list: [string, string][] = [];
    for (const tr of this.rows.rows) {
      const [a, b] = [...tr.querySelectorAll('input')].map((i) => i.value);
      if (a) list.push([a, b]);
    }
    this.opts.set({ replacements: list });
  }
}
