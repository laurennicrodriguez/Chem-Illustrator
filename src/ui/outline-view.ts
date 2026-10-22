// View > Outline View: in place of the slide pictures beside the slide, every slide's title and
// body text as one outline to type in. Enter in a title goes on to its body; Tab and Shift+Tab
// move a body line in and out a level, and Shift+Tab on a line already all the way out makes it
// the title of a new slide (the lines after it go with it). Ctrl+Enter adds a slide after.
// Click a slide's number to edit that slide.

import type { Deck } from '../deck/deck';
import { applyOutline, outlineText, parseOutline, slideOutline } from '../deck/outline';

export interface OutlineHooks {
  deck(): Deck | null;
  go(i: number): void;
  /** Done typing in the outline: back to the slide. */
  focusSlide(): void;
}

export class OutlineView {
  readonly el: HTMLDivElement;
  shown = false;
  private typing = 0;

  constructor(parent: HTMLElement, private hooks: OutlineHooks) {
    this.el = document.createElement('div');
    this.el.id = 'slide-outline';
    this.el.hidden = true;
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', 'Outline');
    parent.append(this.el);
  }

  show(on: boolean): void {
    if (!on) this.flush();
    this.shown = on;
    this.el.hidden = !on;
    if (on) this.rebuild(); else this.el.replaceChildren();
  }

  /** Keep what is being typed. */
  flush(): void {
    const el = document.activeElement;
    if (el instanceof HTMLElement && this.el.contains(el)) el.dispatchEvent(new Event('change'));
  }

  /** The outline again from the slides (not while typing in it). */
  rebuild(): void {
    const d = this.hooks.deck();
    if (!this.shown || !d) return;
    if (this.el.contains(document.activeElement)) { this.mark(d.index); return; }
    const scroll = this.el.scrollTop;
    this.el.replaceChildren();
    d.slides.forEach((s, i) => {
      const o = slideOutline(d.docOf(i));
      const row = document.createElement('div');
      row.className = 'ol-slide';
      row.dataset.i = String(i);
      const num = document.createElement('button');
      num.type = 'button';
      num.className = 'ol-num';
      num.textContent = `${i + 1}`;
      num.title = `Edit slide ${i + 1}${s.hidden ? ' (hidden in the show)' : ''}`;
      num.addEventListener('click', () => this.hooks.go(i));
      const col = document.createElement('div');
      col.className = 'ol-col';
      const title = document.createElement('input');
      title.className = 'ol-title';
      title.value = o.title ?? '';
      title.placeholder = o.title === null ? '(this layout has no title)' : 'Title';
      title.disabled = o.title === null;
      title.setAttribute('aria-label', `Slide ${i + 1} title`);
      const body = document.createElement('textarea');
      body.className = 'ol-body';
      body.value = outlineText(o.body ?? []);
      body.placeholder = o.body === null ? '(no text placeholder)' : 'Text';
      body.disabled = o.body === null;
      body.rows = Math.max(1, (o.body ?? []).length);
      body.setAttribute('aria-label', `Slide ${i + 1} text`);
      body.spellcheck = true;
      const grow = () => { body.style.height = 'auto'; body.style.height = `${body.scrollHeight}px`; };
      requestAnimationFrame(grow);
      body.addEventListener('input', grow);
      const commit = () => { clearTimeout(this.typing); this.commit(i, title, body); };
      // what is typed goes onto the slide after a moment's pause (and when the box is left)
      const soon = () => { clearTimeout(this.typing); this.typing = window.setTimeout(commit, 400); };
      for (const el of [title, body]) {
        el.addEventListener('input', soon);
        el.addEventListener('change', commit);
        el.addEventListener('blur', commit);
      }
      title.addEventListener('focus', () => this.hooks.deck()?.index !== i && this.hooks.go(i));
      body.addEventListener('focus', () => this.hooks.deck()?.index !== i && this.hooks.go(i));
      title.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); this.addAfter(i); }
        else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); body.focus(); body.setSelectionRange(0, 0); }
        else if (e.key === 'Escape') { commit(); this.hooks.focusSlide(); }
      });
      body.addEventListener('keydown', (e) => this.bodyKey(e, i, title, body));
      col.append(title, body);
      row.append(num, col);
      this.el.append(row);
    });
    this.mark(d.index);
    this.el.scrollTop = scroll;
  }

  /** Show which slide is being edited. */
  mark(i: number): void {
    for (const r of this.el.querySelectorAll<HTMLElement>('.ol-slide')) r.classList.toggle('ol-current', r.dataset.i === String(i));
  }

  private commit(i: number, title: HTMLInputElement, body: HTMLTextAreaElement): void {
    const d = this.hooks.deck();
    if (!d || !d.slides[i]) return;
    const o = slideOutline(d.docOf(i));
    const t = o.title === null ? null : title.value;
    const b = o.body === null ? null : parseOutline(body.value);
    if (t === o.title && outlineText(b ?? []) === outlineText(o.body ?? [])) return;
    d.editSlides('Edit outline', [i], (doc) => { applyOutline(doc, t, b); });
  }

  private addAfter(i: number): void {
    const d = this.hooks.deck();
    if (!d) return;
    d.insertSlide(i + 1, 'title-content', () => {}, 'New slide');
    this.rebuild();
    this.el.querySelectorAll<HTMLInputElement>('.ol-title')[i + 1]?.focus();
  }

  private bodyKey(e: KeyboardEvent, i: number, title: HTMLInputElement, body: HTMLTextAreaElement): void {
    if (e.key === 'Escape') { body.dispatchEvent(new Event('change')); this.hooks.focusSlide(); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); body.dispatchEvent(new Event('change')); this.addAfter(i); return; }
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const v = body.value;
    const start = v.lastIndexOf('\n', body.selectionStart - 1) + 1;
    const endAt = v.indexOf('\n', body.selectionEnd);
    const end = endAt < 0 ? v.length : endAt;
    const lines = v.slice(start, end).split('\n');
    if (e.shiftKey && lines.every((l) => !l.startsWith('\t')) && lines.length === 1) {
      // all the way out already: this line and those after it become a new slide
      const after = v.slice(end + 1);
      const before = v.slice(0, Math.max(0, start - 1));
      body.value = start > 0 ? before : '';
      this.commit(i, title, body);
      const d = this.hooks.deck();
      if (!d) return;
      const rest = parseOutline(after);
      d.insertSlide(i + 1, 'title-content', (doc) => { applyOutline(doc, lines[0], rest); }, 'New slide');
      this.rebuild();
      this.el.querySelectorAll<HTMLInputElement>('.ol-title')[i + 1]?.focus();
      return;
    }
    const caret = body.selectionStart, collapsed = caret === body.selectionEnd;
    const moved = lines.map((l) => (e.shiftKey ? l.replace(/^\t/, '') : `\t${l}`)).join('\n');
    body.value = v.slice(0, start) + moved + v.slice(end);
    // the caret moves with its line's text; several lines stay picked
    if (collapsed && lines.length === 1) { const p = Math.max(start, caret + moved.length - (end - start)); body.setSelectionRange(p, p); }
    else body.setSelectionRange(start, start + moved.length);
    body.dispatchEvent(new Event('input'));
    this.commit(i, title, body);
  }
}
