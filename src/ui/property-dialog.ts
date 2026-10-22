// Chemistry > Insert Property Column…: pick the properties to work out from a column of structures
// (or SMILES). Each becomes a column of its own that fills itself in for every row.

import { PROPERTIES } from '../sheet/properties';
import { COMMON_ADDUCTS } from '../chem/hrms';

export interface PropertyChoice {
  /** The sheet function, e.g. MW. */
  name: string;
  /** HRMS: the ion, e.g. [M+Na]+. */
  adduct?: string;
}

export interface PropertyDialogOptions {
  /** Columns that hold structures or SMILES, by number, with their header text. */
  columns: { col: number; label: string }[];
  /** The column picked to start with. */
  col: number;
}

/** Ask which properties to add. Null when cancelled. */
export function askProperties(opts: PropertyDialogOptions): Promise<{ col: number; props: PropertyChoice[] } | null> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'ask prop-dialog';
    d.setAttribute('aria-label', 'Insert property columns');
    const form = document.createElement('form');
    form.method = 'dialog';
    form.innerHTML = `<h2>Insert property columns</h2>
      <p class="muted">Each property gets a column that works itself out from the structure in the same row, and updates when the structure changes. Type over any value to replace it; Reset to Calculated puts it back.</p>
      <label class="ask-row"><span>Structures in</span><select name="col"></select></label>
      <div class="prop-list" role="group" aria-label="Properties"></div>
      <p class="ask-buttons"><button type="button" data-act="cancel">Cancel</button> <button type="submit" class="primary">Insert</button></p>`;
    const colSel = form.querySelector<HTMLSelectElement>('select[name=col]')!;
    for (const c of opts.columns) colSel.add(new Option(c.label, String(c.col), false, c.col === opts.col));
    const list = form.querySelector<HTMLDivElement>('.prop-list')!;
    const picked = new Set(['FORMULA', 'MW']);
    for (const [name, def] of Object.entries(PROPERTIES)) {
      const row = document.createElement('label');
      row.className = 'prop-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = name;
      box.checked = picked.has(name);
      const text = document.createElement('span');
      const b = document.createElement('b');
      b.textContent = def.label;
      text.append(b, ' ', Object.assign(document.createElement('span'), { className: 'muted', textContent: def.help.replace(/:.*$/, '') }));
      row.append(box, text);
      if (name === 'HRMS') {
        const ion = document.createElement('input');
        ion.name = 'adduct';
        ion.value = '[M+H]+';
        ion.setAttribute('list', 'prop-adducts');
        ion.className = 'prop-adduct';
        ion.setAttribute('aria-label', 'Ion');
        ion.title = 'The ion: [M+H]+, [M+Na]+, [M-H]-, [M+2H]2+, [2M+Na]+… (any adduct can be typed)';
        ion.addEventListener('input', () => { box.checked = true; });
        const dl = document.createElement('datalist');
        dl.id = 'prop-adducts';
        for (const a of COMMON_ADDUCTS) dl.append(new Option(a));
        row.append(ion, dl);
      }
      list.append(row);
    }
    d.append(form);
    document.body.append(d);
    const finish = (v: { col: number; props: PropertyChoice[] } | null) => { d.remove(); resolve(v); };
    form.querySelector('[data-act=cancel]')!.addEventListener('click', () => { d.close(); finish(null); });
    d.addEventListener('cancel', () => finish(null));
    d.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const props: PropertyChoice[] = [];
      for (const box of list.querySelectorAll<HTMLInputElement>('input[type=checkbox]')) {
        if (!box.checked) continue;
        const adduct = box.value === 'HRMS' ? form.querySelector<HTMLInputElement>('input[name=adduct]')!.value.trim() || '[M+H]+' : undefined;
        props.push({ name: box.value, adduct });
      }
      d.close();
      finish(props.length ? { col: Number(colSel.value), props } : null);
    });
    d.showModal();
  });
}
