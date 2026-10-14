// The Find and Replace box of Document mode (Ctrl+F, Ctrl+H): it floats over the top right of
// the pages, lights up every place the words are found, steps through them, and replaces one or
// all of them, optionally changing how they look (make every CH2Cl2 a formula, every "in vacuo"
// italic). Every replacement is one step to undo.

import type { DocFile } from '../document/doc-file';
import type { DocText } from '../document/document';
import { OBJECT_CHAR } from '../document/document';
import { findAll, lookPatch, replaceRanges, type FindOptions, type ReplaceLook } from '../document/find';

export interface DocFindHost {
  file(): DocFile | null;
  /** Put the keyboard back in the document. */
  focus(): void;
  flash(msg: string, ms?: number): void;
  /** The found places changed (draw them). */
  redraw(): void;
}

const LOOKS: { key: keyof ReplaceLook; label: string; title: string }[] = [
  { key: 'formula', label: 'CH₂', title: 'Chemical formula: numbers as subscripts, charges as superscripts (CH₂Cl₂)' },
  { key: 'bold', label: '<b>B</b>', title: 'Bold' },
  { key: 'italic', label: '<i>I</i>', title: 'Italic' },
  { key: 'underline', label: '<u>U</u>', title: 'Underline' },
  { key: 'sub', label: 'x₂', title: 'Subscript' },
  { key: 'sup', label: 'x²', title: 'Superscript' },
  { key: 'plain', label: 'Plain', title: 'Take off bold, italic, underline, subscript, superscript and formula first' },
];
/** These each set where characters sit, so choosing one turns the others off. */
const POSITION: (keyof ReplaceLook)[] = ['formula', 'sub', 'sup'];

export class DocFind {
  readonly el: HTMLDivElement;
  /** The places found, in order. */
  hits: [number, number][] = [];
  private look: ReplaceLook = {};
  /** Where the caret was when the box opened: typing finds the first place from there. */
  private origin = 0;
  private findBox: HTMLInputElement;
  private withBox: HTMLInputElement;
  private countEl: HTMLElement;
  private replaceEl: HTMLElement;
  private toggleEl: HTMLButtonElement;

  constructor(parent: HTMLElement, private host: DocFindHost) {
    const el = document.createElement('div');
    el.className = 'doc-find';
    el.setAttribute('role', 'search');
    el.hidden = true;
    el.innerHTML = `
      <div class="df-row">
        <button type="button" class="df-toggle" data-act="toggle" title="Show or hide Replace (Ctrl+H)" aria-expanded="false">›</button>
        <input type="search" class="df-find" placeholder="Find" aria-label="Find in the document" spellcheck="false" />
        <span class="df-count muted" aria-live="polite"></span>
        <button type="button" data-act="prev" title="The one before (Shift+Enter)">↑</button>
        <button type="button" data-act="next" title="The next one (Enter)">↓</button>
        <button type="button" data-act="close" title="Close (Esc)">×</button>
      </div>
      <div class="df-row df-opts">
        <label class="check small"><input type="checkbox" class="df-case" /> Match case</label>
        <label class="check small"><input type="checkbox" class="df-word" /> Whole words</label>
      </div>
      <div class="df-replace" hidden>
        <div class="df-row">
          <input type="text" class="df-with" placeholder="Replace with" aria-label="Replace with" spellcheck="false" />
          <button type="button" data-act="one" title="Replace this one and go to the next (Enter in this box)">Replace</button>
          <button type="button" data-act="all" title="Replace every one (one step to undo)">All</button>
        </div>
        <div class="df-row df-look" role="group" aria-label="How the replacement looks">
          <span class="muted">Make it</span>
          ${LOOKS.map((l) => `<button type="button" data-look="${l.key}" aria-pressed="false" title="${l.title}">${l.label}</button>`).join('')}
        </div>
        <p class="df-hint muted">Leave “Replace with” empty to change only how the found words look.</p>
      </div>`;
    parent.append(el);
    this.el = el;
    this.findBox = el.querySelector('.df-find')!;
    this.withBox = el.querySelector('.df-with')!;
    this.countEl = el.querySelector('.df-count')!;
    this.replaceEl = el.querySelector('.df-replace')!;
    this.toggleEl = el.querySelector('.df-toggle')!;

    this.findBox.addEventListener('input', () => { this.refresh(); this.go(0); });
    for (const c of el.querySelectorAll<HTMLInputElement>('input[type=checkbox]')) c.addEventListener('change', () => { this.refresh(); this.go(0); });
    el.addEventListener('keydown', (e) => this.key(e));
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      const look = b.dataset.look as keyof ReplaceLook | undefined;
      if (look) { this.toggleLook(look); this.withBox.focus(); return; }
      switch (b.dataset.act) {
        case 'toggle': this.showReplace(this.replaceEl.hidden); break;
        case 'prev': this.go(-1); break;
        case 'next': this.go(1); break;
        case 'close': this.close(); break;
        case 'one': this.replaceOne(); break;
        case 'all': this.replaceAll(); break;
      }
    });
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  /** Ctrl+F (find) or Ctrl+H (find and replace). Short selected text becomes what is looked for. */
  show(replace: boolean): void {
    const f = this.host.file();
    if (!f) return;
    const ed = f.ed;
    const sel = ed.text.slice(ed.start, ed.end);
    if (sel && sel.length <= 80 && !sel.includes('\n') && !sel.includes(OBJECT_CHAR)) this.findBox.value = sel;
    this.origin = ed.start;
    this.el.hidden = false;
    if (replace) this.showReplace(true);
    this.refresh();
    this.findBox.focus();
    this.findBox.select();
  }

  /** Hide the box (and put the keyboard back in the document, unless another tab is coming). */
  close(focus = true): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.hits = [];
    this.host.redraw();
    if (focus) this.host.focus();
  }

  private showReplace(on: boolean): void {
    this.replaceEl.hidden = !on;
    this.toggleEl.setAttribute('aria-expanded', String(on));
    this.toggleEl.textContent = on ? '⌄' : '›';
    if (on && this.open) this.withBox.focus();
  }

  private options(): FindOptions {
    return {
      matchCase: this.el.querySelector<HTMLInputElement>('.df-case')!.checked,
      wholeWord: this.el.querySelector<HTMLInputElement>('.df-word')!.checked,
    };
  }

  /** Look again (the words or the text changed). */
  refresh(): void {
    const f = this.host.file();
    this.hits = f && this.open ? findAll(f.ed.text, this.findBox.value, this.options()) : [];
    this.showCount();
    this.host.redraw();
  }

  /** The found place that is selected now, if any. */
  private current(): number {
    const ed = this.host.file()?.ed;
    return ed ? this.hits.findIndex(([a, b]) => a === ed.start && b === ed.end) : -1;
  }

  showCount(): void {
    if (!this.findBox.value) { this.countEl.textContent = ''; return; }
    const n = this.hits.length, i = this.current();
    this.countEl.textContent = !n ? 'Not found' : i >= 0 ? `${i + 1} of ${n}` : `${n} found`;
  }

  /** Select the next (1) or previous (-1) place, or (0) the first from where the box opened. */
  go(dir: -1 | 0 | 1): void {
    const ed = this.host.file()?.ed;
    const h = this.hits, n = h.length;
    if (!ed || !n) { this.showCount(); return; }
    const cur = this.current();
    let i: number;
    if (dir === 0) i = cur >= 0 ? cur : Math.max(0, h.findIndex(([a]) => a >= this.origin));
    else if (cur >= 0) i = (cur + dir + n) % n;
    else if (dir > 0) i = Math.max(0, h.findIndex(([a]) => a >= ed.end));
    else { const j = h.map(([, b]) => b <= ed.start).lastIndexOf(true); i = j >= 0 ? j : n - 1; }
    ed.select(h[i][0], h[i][1]);
    this.showCount();
  }

  private toggleLook(key: keyof ReplaceLook): void {
    const on = !this.look[key];
    this.look = { ...this.look, [key]: on || undefined };
    if (on && POSITION.includes(key)) for (const k of POSITION) if (k !== key) delete this.look[k];
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-look]')) b.setAttribute('aria-pressed', String(!!this.look[b.dataset.look as keyof ReplaceLook]));
  }

  /** Replace the selected place, then go to the next. */
  private replaceOne(): void {
    const f = this.host.file();
    if (!f) return;
    const i = this.current();
    if (i < 0) { this.go(1); return; }
    const [a, b] = this.hits[i];
    const with_ = this.withBox.value;
    const keep = !with_ && lookPatch(this.look) !== null;
    const runs = replaceRanges(f.t.runs, [[a, b]], with_, this.look, f.ed.defaults);
    const after = keep ? b : a + with_.length;
    f.ed.update({ ...f.t, runs } as DocText, 'Replace', after, after);
    // the text changed, so the places were found again; go to the next one from here
    this.refresh();
    const h = this.hits;
    if (!h.length) return;
    const j = Math.max(0, h.findIndex(([x]) => x >= after));
    f.ed.select(h[j][0], h[j][1]);
    this.showCount();
  }

  private replaceAll(): void {
    const f = this.host.file();
    if (!f || !this.hits.length) { this.host.flash('Nothing to replace: the words were not found.'); return; }
    const n = this.hits.length;
    const with_ = this.withBox.value;
    const keep = !with_ && lookPatch(this.look) !== null;
    const runs = replaceRanges(f.t.runs, this.hits, with_, this.look, f.ed.defaults);
    const at = Math.min(f.ed.start, f.ed.text.length);
    f.ed.update({ ...f.t, runs } as DocText, 'Replace all', at, at);
    this.refresh();
    const what = n === 1 ? 'one place' : `${n} places`;
    this.host.flash(keep ? `Changed the look of ${what}. Ctrl+Z puts it back.` : with_ ? `Replaced ${what}. Ctrl+Z puts them back.` : `Deleted ${what}. Ctrl+Z puts them back.`);
  }

  private key(e: KeyboardEvent): void {
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    // the document's own keys don't act while typing here
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
    if (ctrl && k === 'f') { e.preventDefault(); this.findBox.focus(); this.findBox.select(); return; }
    if (ctrl && k === 'h') { e.preventDefault(); this.showReplace(true); return; }
    if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement) || e.target.type === 'checkbox') return;
    e.preventDefault();
    if (e.target === this.withBox) {
      if (ctrl) this.replaceAll();
      else this.replaceOne();
    } else this.go(e.shiftKey ? -1 : 1);
  }
}
