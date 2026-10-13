// The Hotkeys window (Edit > Hotkeys…): every action, the keys that do it, and a way to change
// them by pressing the new key. Changes take effect and are saved straight away. Taking a key
// that another action had is allowed (the window says what changed), never blocked.

import { keymap, CONTEXTS, KeyContext, DEFAULT_KEYS, actionsFor, actionName, displayChord, chordOf, parseAction } from '../editor/keymap';

export interface HotkeysOptions {
  mac: boolean;
  /** Where the settings file is, to tell the person. */
  location: () => Promise<string>;
  exportKeys: () => void;
  importKeys: () => void;
  /** ChemDraw's 1/0 behaviour, which some people find surprising. */
  keepHotspot: { get(): boolean; set(v: boolean): void };
}

interface Recording { ctx: KeyContext; action: string; button: HTMLButtonElement }

export class HotkeysDialog {
  private d: HTMLDialogElement;
  private body: HTMLDivElement;
  private search: HTMLInputElement;
  private status: HTMLParagraphElement;
  private where: HTMLElement;
  private keepBox: HTMLInputElement;
  private resetAllBtn: HTMLButtonElement;
  private recording: Recording | null = null;
  private resetTimer = 0;

  constructor(private opts: HotkeysOptions) {
    const d = (this.d = document.createElement('dialog'));
    d.className = 'hotkeys';
    d.setAttribute('aria-label', 'Hotkeys');
    d.innerHTML = `
      <div class="hk-head">
        <h2>Hotkeys</h2>
        <input type="search" placeholder="Find an action or a key" aria-label="Find an action or a key" />
      </div>
      <p class="muted">Click <b>+</b> next to an action and press the key you want for it. Click <b>×</b> on a key to take it away. Keys are case-sensitive: <kbd>f</kbd> and <kbd>Shift+F</kbd> are different keys.</p>
      <label class="hk-opt small"><input type="checkbox" data-opt="keep" /><span>After <kbd>1</kbd> or <kbd>0</kbd> on the atom under the mouse, keep the highlight there, as ChemDraw does (pressing 1 three times adds three bonds). Off: the highlight moves to the new atom, so 1 1 1 draws a chain.</span></label>
      <p class="hk-status" role="status" aria-live="polite"></p>
      <div class="hk-body"></div>
      <div class="hk-foot">
        <span class="muted small">Saved in <code class="hk-where"></code></span>
        <span class="hk-buttons">
          <button type="button" data-act="export" title="Save your keys to a file, to back them up or use them on another computer">Export…</button>
          <button type="button" data-act="import" title="Use keys saved with Export">Import…</button>
          <button type="button" data-act="reset-all">Reset all to ChemDraw's keys</button>
          <button type="button" data-act="close" class="primary">Close</button>
        </span>
      </div>`;
    this.body = d.querySelector('.hk-body')!;
    this.search = d.querySelector('input[type=search]')!;
    this.status = d.querySelector('.hk-status')!;
    this.where = d.querySelector('.hk-where')!;
    this.keepBox = d.querySelector('input[data-opt=keep]')!;
    this.resetAllBtn = d.querySelector('[data-act=reset-all]')!;
    this.search.addEventListener('input', () => this.applyFilter());
    this.keepBox.addEventListener('change', () => opts.keepHotspot.set(this.keepBox.checked));
    d.querySelector('[data-act=close]')!.addEventListener('click', () => d.close());
    d.querySelector('[data-act=export]')!.addEventListener('click', () => opts.exportKeys());
    d.querySelector('[data-act=import]')!.addEventListener('click', () => opts.importKeys());
    this.resetAllBtn.addEventListener('click', () => this.resetAll());
    this.body.addEventListener('click', (e) => this.onClick(e));
    // while waiting for a key, every key press is the new key (Esc cancels)
    d.addEventListener('keydown', (e) => this.onRecordKey(e), true);
    d.addEventListener('cancel', (e) => { if (this.recording) { e.preventDefault(); this.stopRecording('Cancelled: no key changed.'); } });
    d.addEventListener('close', () => this.stopRecording(''));
    keymap.onChange(() => { if (d.open) this.render(); });
    document.body.append(d);
  }

  open(): void {
    this.status.textContent = '';
    this.search.value = '';
    this.keepBox.checked = this.opts.keepHotspot.get();
    this.render();
    void this.opts.location().then((w) => { this.where.textContent = w; });
    this.d.showModal();
    this.search.focus();
  }

  /** Say something at the top of the window (after an import, say). */
  say(msg: string): void {
    this.status.textContent = msg;
  }

  // ------------------------------------------------------------------ the list

  private actions(ctx: KeyContext): string[] {
    const list = actionsFor(ctx);
    if (ctx === 'atom') {
      // labels have no fixed list: show ChemDraw's and any the person added
      const labels: string[] = [];
      for (const a of [...Object.values(DEFAULT_KEYS.atom), ...keymap.entries('atom').map(([, a]) => a)]) {
        if (a.startsWith('label ') && !labels.includes(a)) labels.push(a);
      }
      list.unshift(...labels);
    }
    if (ctx === 'space') {
      // tools that have a key first
      const keyed = list.filter((a) => keymap.keysFor(ctx, a).length);
      return [...keyed, ...list.filter((a) => !keyed.includes(a))];
    }
    return list;
  }

  private render(): void {
    const keep = this.recording ? { ctx: this.recording.ctx, action: this.recording.action } : null;
    const scroll = this.body.scrollTop;
    this.body.replaceChildren();
    for (const c of CONTEXTS) {
      const sec = document.createElement('section');
      sec.dataset.ctx = c.id;
      const h = document.createElement('h3');
      h.textContent = c.title;
      const note = document.createElement('p');
      note.className = 'muted small';
      note.textContent = c.note;
      sec.append(h, note);
      if (c.id === 'atom') sec.append(this.addLabelRow());
      const table = document.createElement('table');
      table.className = 'hk-table';
      const tb = table.createTBody();
      for (const action of this.actions(c.id)) tb.append(this.row(c.id, action));
      sec.append(table);
      this.body.append(sec);
    }
    this.body.scrollTop = scroll;
    this.applyFilter();
    if (keep) {
      const btn = this.body.querySelector<HTMLButtonElement>(`section[data-ctx="${keep.ctx}"] tr[data-action="${CSS.escape(keep.action)}"] button.hk-add`);
      if (btn) { this.recording = { ...keep, button: btn }; btn.textContent = 'Press a key…'; btn.classList.add('recording'); }
    }
  }

  private row(ctx: KeyContext, action: string): HTMLTableRowElement {
    const tr = document.createElement('tr');
    tr.dataset.action = action;
    const changed = !keymap.actionIsDefault(ctx, action);
    if (changed) tr.className = 'changed';
    const name = tr.insertCell();
    name.className = 'hk-name';
    name.textContent = actionName(action);
    const cell = tr.insertCell();
    const keys = document.createElement('div');
    keys.className = 'hk-keys';
    cell.append(keys);
    for (const k of keymap.keysFor(ctx, action)) {
      const chip = document.createElement('span');
      chip.className = 'hk-chip';
      const kbd = document.createElement('kbd');
      kbd.textContent = displayChord(k, this.opts.mac);
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'hk-remove';
      x.dataset.chord = k;
      x.title = `Take ${displayChord(k, this.opts.mac)} away from this action`;
      x.setAttribute('aria-label', x.title);
      x.textContent = '×';
      chip.append(kbd, x);
      keys.append(chip);
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'hk-add';
    add.textContent = '+';
    add.title = 'Give this action a key: click, then press the key';
    add.setAttribute('aria-label', `Add a key for ${actionName(action)}`);
    keys.append(add);
    const reset = tr.insertCell();
    reset.className = 'hk-reset';
    if (changed) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'link';
      b.dataset.act = 'reset';
      b.textContent = DEFAULT_KEYS[ctx] && Object.values(DEFAULT_KEYS[ctx]).includes(action) ? 'Reset' : 'Remove';
      b.title = b.textContent === 'Reset' ? "Put back ChemDraw's keys for this action" : 'Take away the keys you added';
      reset.append(b);
    }
    return tr;
  }

  private addLabelRow(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'hk-addlabel';
    div.innerHTML = `<label>New label key: <input type="text" placeholder="e.g. OTBS, NHBoc, Ar" aria-label="Label text" /></label>
      <button type="button" class="hk-add" data-label="1">Choose its key…</button>`;
    return div;
  }

  private applyFilter(): void {
    const q = this.search.value.trim();
    const lower = q.toLowerCase();
    for (const sec of this.body.querySelectorAll<HTMLElement>('section')) {
      const ctx = sec.dataset.ctx as KeyContext;
      let shown = 0;
      for (const tr of sec.querySelectorAll<HTMLTableRowElement>('tr')) {
        let hit = !q;
        if (q) {
          const keys = keymap.keysFor(ctx, tr.dataset.action!);
          // one character is a key ("k", "F"); longer text also matches names
          hit = keys.includes(q) || (q.length > 1 && (tr.cells[0].textContent!.toLowerCase().includes(lower)
            || keys.some((k) => displayChord(k, this.opts.mac).toLowerCase() === lower)));
        }
        tr.hidden = !hit;
        if (hit) shown++;
      }
      sec.hidden = !!q && !shown;
    }
  }

  // ------------------------------------------------------------------ changing keys

  private onClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!btn) return;
    const sec = btn.closest<HTMLElement>('section');
    const ctx = sec?.dataset.ctx as KeyContext | undefined;
    if (!ctx) return;
    if (btn.dataset.label) {
      const input = sec!.querySelector<HTMLInputElement>('.hk-addlabel input')!;
      const text = input.value.trim();
      if (!text) { this.say('Type the label first (for example OTBS), then choose its key.'); input.focus(); return; }
      if (/\s/.test(text)) { this.say('A label key can’t have spaces in it.'); input.focus(); return; }
      this.startRecording(ctx, `label ${text}`, btn);
      return;
    }
    const action = btn.closest<HTMLTableRowElement>('tr')?.dataset.action;
    if (!action) return;
    if (btn.classList.contains('hk-add')) {
      if (this.recording?.button === btn) this.stopRecording('Cancelled: no key changed.');
      else this.startRecording(ctx, action, btn);
    } else if (btn.classList.contains('hk-remove')) {
      const chord = btn.dataset.chord!;
      keymap.bind(ctx, chord, null);
      this.say(`${displayChord(chord, this.opts.mac)} no longer does “${actionName(action)}”.`);
    } else if (btn.dataset.act === 'reset') {
      keymap.resetAction(ctx, action);
      this.say(`“${actionName(action)}” has ChemDraw’s keys again.`);
    }
  }

  private startRecording(ctx: KeyContext, action: string, button: HTMLButtonElement): void {
    this.stopRecording('');
    this.recording = { ctx, action, button };
    button.dataset.text = button.textContent ?? '';
    button.textContent = 'Press a key…';
    button.classList.add('recording');
    this.say(`Press the new key for “${actionName(action)}” (Esc cancels).`);
  }

  private stopRecording(msg: string): void {
    const r = this.recording;
    this.recording = null;
    if (r) {
      r.button.textContent = r.button.dataset.text || '+';
      r.button.classList.remove('recording');
    }
    if (msg) this.say(msg);
  }

  private onRecordKey(e: KeyboardEvent): void {
    if (!this.recording) return;
    const chord = chordOf(e);
    e.preventDefault();
    e.stopPropagation();
    if (!chord) return; // a modifier on its own: wait for the rest
    if (chord === 'Escape') { this.stopRecording('Cancelled: no key changed.'); return; }
    const { ctx, action } = this.recording;
    this.stopRecording('');
    this.say(this.assign(ctx, action, chord));
  }

  /** Give `action` the key; returns what to tell the person. */
  private assign(ctx: KeyContext, action: string, chord: string): string {
    const shown = displayChord(chord, this.opts.mac);
    const before = keymap.lookup(ctx, chord);
    if (before === action) return `${shown} already does “${actionName(action)}”.`;
    keymap.bind(ctx, chord, action);
    if (ctx === 'atom' && parseAction(action).verb === 'label') {
      const input = this.body.querySelector<HTMLInputElement>('.hk-addlabel input');
      if (input) input.value = '';
    }
    let msg = `${shown} now does “${actionName(action)}”.`;
    if (before) {
      msg += ` It used to do “${actionName(before)}”`;
      msg += keymap.keysFor(ctx, before).length ? '.' : ', which has no key now (Reset puts it back).';
    }
    // a plain key for a menu command only works when it isn't used where the mouse points
    if (ctx === 'command') {
      const places = CONTEXTS.filter((c) => c.id === 'atom' || c.id === 'bond' || c.id === 'space')
        .filter((c) => keymap.lookup(c.id, chord))
        .map((c) => c.title.toLowerCase());
      if (places.length) msg += ` When ${places.join(' or ')}, ${shown} does that place’s action instead.`;
    }
    return msg;
  }

  private resetAll(): void {
    if (!this.resetAllBtn.classList.contains('confirm')) {
      this.resetAllBtn.classList.add('confirm');
      this.resetAllBtn.textContent = 'Click again to reset every key';
      clearTimeout(this.resetTimer);
      this.resetTimer = window.setTimeout(() => {
        this.resetAllBtn.classList.remove('confirm');
        this.resetAllBtn.textContent = "Reset all to ChemDraw's keys";
      }, 4000);
      return;
    }
    clearTimeout(this.resetTimer);
    this.resetAllBtn.classList.remove('confirm');
    this.resetAllBtn.textContent = "Reset all to ChemDraw's keys";
    keymap.resetAll();
    this.say('Every key is back to ChemDraw’s. (Export first next time if you want to keep a copy of yours.)');
  }
}
