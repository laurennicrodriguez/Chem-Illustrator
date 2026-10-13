// The Name to Structure window: type a name, press Insert. If the name can't be read the window
// stays open with OPSIN's reason, so the name can be corrected.

export class NameDialog {
  private last = '';

  /** `convert` inserts the structure for a name and returns null, or returns why it could not. */
  constructor(private convert: (name: string) => Promise<string | null>, private starting: () => boolean) {}

  open(initial?: string): void {
    const d = document.createElement('dialog');
    d.className = 'ask name-dialog';
    const form = document.createElement('form');
    const h = document.createElement('h2');
    h.textContent = 'Name to Structure';
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = 'Type a systematic (IUPAC) or common name, such as (2S)-2-aminopropanoic acid, ethyl acetate or caffeine. Names are read on this computer.';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'name-input';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('aria-label', 'Chemical name');
    input.value = initial ?? this.last;
    const status = document.createElement('p');
    status.className = 'name-status';
    status.setAttribute('role', 'status');
    const buttons = document.createElement('p');
    buttons.className = 'ask-buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'primary';
    ok.textContent = 'Insert';
    buttons.append(cancel, ok);
    form.append(h, note, input, status, buttons);
    d.append(form);

    let busy = false;
    const close = () => { if (d.open) d.close(); d.remove(); };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      const name = input.value.trim();
      if (!name) { status.textContent = 'Type a chemical name.'; status.classList.add('error'); return; }
      busy = true;
      ok.disabled = true;
      status.classList.remove('error');
      status.textContent = this.starting() ? 'Starting the name reader (only the first time)…' : 'Reading the name…';
      const err = await this.convert(name);
      busy = false;
      ok.disabled = false;
      this.last = name;
      if (err === null) { close(); return; }
      status.textContent = err;
      status.classList.add('error');
      input.focus();
    });
    cancel.addEventListener('click', close);
    d.addEventListener('close', () => d.remove());
    input.addEventListener('input', () => { status.textContent = ''; status.classList.remove('error'); });
    document.body.append(d);
    d.showModal();
    input.focus();
    input.select();
  }
}
