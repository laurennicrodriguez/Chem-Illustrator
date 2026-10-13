// Small windows that ask for a value or two (Rotate…, Scale…). The desktop app can't rely on
// the browser's own prompt boxes, so these are drawn by the page.

export interface Field {
  name: string;
  label: string;
  value: string;
  /** Text after the box, such as a unit. */
  unit?: string;
  type?: 'number' | 'text';
  /** Pick one of these instead of typing. */
  options?: { value: string; label: string }[];
}

/** Show the fields; resolves with what was entered, or null if the window was cancelled. */
export function ask(title: string, fields: Field[], opts: { ok?: string; note?: string } = {}): Promise<Record<string, string> | null> {
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
    const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
    for (const f of fields) {
      const row = document.createElement('label');
      row.className = 'ask-row';
      const name = document.createElement('span');
      name.textContent = f.label;
      let input: HTMLInputElement | HTMLSelectElement;
      if (f.options) {
        const sel = document.createElement('select');
        for (const o of f.options) sel.add(new Option(o.label, o.value, false, o.value === f.value));
        input = sel;
      } else {
        const inp = document.createElement('input');
        inp.type = f.type ?? 'text';
        if (inp.type === 'number') inp.step = 'any';
        inp.value = f.value;
        input = inp;
      }
      inputs.set(f.name, input);
      row.append(name, input);
      if (f.unit) {
        const u = document.createElement('span');
        u.className = 'muted';
        u.textContent = f.unit;
        row.append(u);
      }
      form.append(row);
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
    buttons.append(cancel, ok);
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
      for (const [k, el] of inputs) out[k] = el.value;
      done(out);
    });
    cancel.addEventListener('click', () => done(null));
    d.addEventListener('close', () => done(null));
    document.body.append(d);
    d.showModal();
    const first = form.querySelector<HTMLInputElement>('input');
    first?.focus();
    first?.select();
  });
}
