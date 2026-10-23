// Small windows that ask for a value or two (Rotate…, Scale…). The desktop app can't rely on
// the browser's own prompt boxes, so these are drawn by the page.

import { showDialog } from './dialog-host';
export interface Field {
  name: string;
  label: string;
  value: string;
  /** Text after the box, such as a unit. */
  unit?: string;
  /** A checkbox gives 'true' or 'false'. */
  type?: 'number' | 'text' | 'textarea' | 'checkbox' | 'color' | 'password';
  /** Grey example text shown in an empty box. */
  placeholder?: string;
  /** Pick one of these instead of typing. */
  options?: { value: string; label: string }[];
  /** Offered in a list under a text box, which can still be typed in. */
  suggestions?: string[];
  /** A line of help shown under the box. */
  help?: string;
}

/** Show the fields; resolves with what was entered, or null if the window was cancelled. */
export function ask(title: string, fields: Field[], opts: { ok?: string; note?: string; /** Only an OK button, for a message. */ noCancel?: boolean } = {}): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'ask';
    const form = document.createElement('form');
    const h = document.createElement('h2');
    h.textContent = title;
    form.append(h);
    if (opts.note) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = opts.note;
      form.append(p);
    }
    const inputs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
    for (const f of fields) {
      const row = document.createElement('label');
      row.className = 'ask-row';
      const name = document.createElement('span');
      name.textContent = f.label;
      let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      if (f.type === 'textarea') {
        const ta = document.createElement('textarea');
        ta.rows = 8;
        ta.value = f.value;
        ta.spellcheck = false;
        if (f.placeholder) ta.placeholder = f.placeholder;
        input = ta;
        row.classList.add('ask-wide');
      } else if (f.type === 'checkbox') {
        const inp = document.createElement('input');
        inp.type = 'checkbox';
        inp.checked = f.value === 'true';
        input = inp;
        row.classList.add('ask-check');
      } else if (f.options) {
        const sel = document.createElement('select');
        for (const o of f.options) sel.add(new Option(o.label, o.value, false, o.value === f.value));
        input = sel;
      } else {
        const inp = document.createElement('input');
        inp.type = f.type ?? 'text';
        if (inp.type === 'number') inp.step = 'any';
        inp.value = f.value;
        if (f.placeholder) inp.placeholder = f.placeholder;
        if (f.suggestions) {
          const dl = document.createElement('datalist');
          dl.id = `ask-list-${f.name}-${Math.random().toString(36).slice(2, 8)}`;
          for (const sg of f.suggestions) dl.append(new Option(sg));
          inp.setAttribute('list', dl.id);
          row.append(dl);
        }
        input = inp;
      }
      inputs.set(f.name, input);
      if (f.type === 'checkbox') row.append(input, name); else row.append(name, input);
      if (f.unit) {
        const u = document.createElement('span');
        u.className = 'muted';
        u.textContent = f.unit;
        row.append(u);
      }
      form.append(row);
      if (f.help) {
        const help = document.createElement('p');
        help.className = 'ask-help muted';
        help.textContent = f.help;
        form.append(help);
      }
    }
    const buttons = document.createElement('p');
    buttons.className = 'ask-buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'primary';
    ok.textContent = opts.ok ?? 'OK';
    if (opts.noCancel) buttons.append(ok);
    else buttons.append(cancel, ok);
    form.append(buttons);
    d.append(form);

    let finished = false;
    const done = (v: Record<string, string> | null) => {
      if (finished) return;
      finished = true;
      if (d.open) d.close();
      d.remove();
      resolve(v);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const out: Record<string, string> = {};
      for (const [k, el] of inputs) out[k] = el instanceof HTMLInputElement && el.type === 'checkbox' ? String(el.checked) : el.value;
      done(out);
    });
    cancel.addEventListener('click', () => done(null));
    d.addEventListener('close', () => done(null));
    showDialog(d);
    const first = form.querySelector<HTMLInputElement | HTMLTextAreaElement>('input:not([type=checkbox]), textarea');
    first?.focus();
    first?.select();
  });
}
