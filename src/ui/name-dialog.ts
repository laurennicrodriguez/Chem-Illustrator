// The Name to Structure window: type a name, press Insert. If the name can't be read the window
// stays open with a short message, the part that couldn't be read underlined, and the name
// reader's own words under Details, so the name can be corrected.

/** Why a name couldn't be used: the message, the part of the name at fault, and the reader's own text. */
export interface NameProblem { error: string; bad?: string; details?: string }

export class NameDialog {
  private last = '';

  /** `convert` inserts the structure for a name and returns null, or returns why it could not. */
  constructor(private convert: (name: string) => Promise<NameProblem | null>, private starting: () => boolean) {}

  open(initial?: string): void {
    const d = document.createElement('dialog');
    d.className = 'ask name-dialog';
    const form = document.createElement('form');
    const h = document.createElement('h2');
    h.textContent = 'Name to Structure';
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = 'Type a systematic (IUPAC) or common name, such as (2S)-2-aminopropanoic acid, ethyl acetate or caffeine. Names are read on this computer; others, such as trade names and abbreviations (DMAP, DIPEA), are looked up on PubChem (Edit > Settings turns that off).';
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
      showProblem(status, name, err);
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

/** The message, with the name shown and the unreadable part underlined, and the details folded away. */
function showProblem(status: HTMLElement, name: string, p: NameProblem): void {
  status.textContent = '';
  const msg = document.createElement('span');
  msg.textContent = p.error;
  status.append(msg);
  const at = p.bad ? name.indexOf(p.bad) : -1;
  if (at >= 0) {
    const shown = document.createElement('span');
    shown.className = 'name-shown';
    const u = document.createElement('u');
    u.textContent = p.bad!;
    u.title = 'The name reader stopped here';
    shown.append(name.slice(0, at), u, name.slice(at + p.bad!.length));
    status.append(document.createElement('br'), shown);
  }
  if (p.details) {
    const d = document.createElement('details');
    const s = document.createElement('summary');
    s.textContent = 'Details';
    const t = document.createElement('p');
    t.textContent = p.details;
    d.append(s, t);
    status.append(d);
  }
}
