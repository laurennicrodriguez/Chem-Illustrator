// View > Notes Page: every slide on its own page with its speaker notes under it, as the pages
// print (the Notes Master's way up, picture size and type, and the header and footer from
// Header & Footer > Notes and Handouts). Type in a page's notes; click a slide's picture to
// go back to Normal view on it. Notes Master and Handout Master are small windows of settings.

import type { Deck, Master, NotesHF } from '../deck/deck';
import { defaultNotesHF, DATE_FORMATS } from '../deck/deck';
import { HANDOUT_COUNTS, defaultHandout, notesLayout, pageTexts, type Box, type HandoutSetup, type NotesPageSetup } from '../deck/notes-pages';
import { paintSlide } from '../deck/slide-view';
import { ask } from './ask';

export interface NotesPageHooks {
  deck(): Deck | null;
  /** Go to slide i in Normal view. */
  open(i: number): void;
}

export class NotesPageView {
  readonly el: HTMLDivElement;
  shown = false;

  constructor(host: HTMLElement, private hooks: NotesPageHooks) {
    this.el = document.createElement('div');
    this.el.className = 'notes-pages';
    this.el.hidden = true;
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', 'Notes pages');
    host.append(this.el);
  }

  show(on: boolean): void {
    if (!on) this.flush();
    this.shown = on;
    this.el.hidden = !on;
    if (on) this.rebuild();
    else this.el.replaceChildren();
  }

  /** Keep what is being typed (before the view closes, or the deck changes under it). */
  flush(): void {
    const ta = this.el.querySelector<HTMLTextAreaElement>('textarea:focus');
    ta?.dispatchEvent(new Event('change'));
  }

  /** Draw every page again (the slides, notes or masters changed). */
  rebuild(): void {
    const d = this.hooks.deck();
    if (!this.shown || !d) return;
    const focused = this.el.querySelector<HTMLTextAreaElement>('textarea:focus');
    if (focused) return; // (typing: the page being typed in stays as it is)
    const scroll = this.el.scrollTop;
    this.el.replaceChildren();
    const m = d.master;
    const L = notesLayout(d.size, m.notesPage);
    const W = Math.max(240, Math.min(this.el.clientWidth - 48, 720));
    const k = W / L.page.w;
    const font = m.notesPage?.font || m.bodyFont || 'Arial';
    const size = (m.notesPage?.size ?? 12) * k;
    const at = (el: HTMLElement, b: Box) => Object.assign(el.style, { left: `${b.x * k}px`, top: `${b.y * k}px`, width: `${b.w * k}px`, height: `${b.h * k}px` });
    d.slides.forEach((s, i) => {
      const page = document.createElement('div');
      page.className = 'np-page';
      page.style.width = `${W}px`;
      page.style.height = `${L.page.h * k}px`;
      if (i === d.index) page.classList.add('np-current');
      const t = pageTexts(m.notesHF, i + 1);
      for (const [key, align] of [['header', 'left'], ['date', 'right'], ['footer', 'left'], ['number', 'right']] as const) {
        if (!t[key]) continue;
        const span = document.createElement('div');
        span.className = `np-hf np-${key}`;
        span.textContent = t[key];
        span.style.textAlign = align;
        span.style.fontSize = `${11 * k}px`;
        at(span, L[key]);
        page.append(span);
      }
      const canvas = document.createElement('canvas');
      canvas.className = 'np-slide';
      canvas.title = `Slide ${i + 1}: click to edit it`;
      at(canvas, L.slide);
      paintSlide(canvas, L.slide.w * k, L.slide.h * k, window.devicePixelRatio || 1, d.page(i), d.docOf(i));
      canvas.addEventListener('click', () => this.hooks.open(i));
      const ta = document.createElement('textarea');
      ta.className = 'np-notes';
      ta.value = s.notes;
      ta.placeholder = 'Click to add notes';
      ta.setAttribute('aria-label', `Notes for slide ${i + 1}`);
      ta.style.fontFamily = `"${font}", sans-serif`;
      ta.style.fontSize = `${size}px`;
      at(ta, L.notes);
      ta.addEventListener('change', () => { if (ta.value !== s.notes) d.setNotes(ta.value, i); });
      ta.addEventListener('blur', () => { if (ta.value !== s.notes) d.setNotes(ta.value, i); });
      const label = document.createElement('div');
      label.className = 'np-label';
      label.textContent = `Slide ${i + 1}`;
      page.append(canvas, ta);
      this.el.append(label, page);
    });
    this.el.scrollTop = scroll;
  }

  /** Bring the current slide's page into view. */
  reveal(i: number): void {
    // (scrolls only this view: scrollIntoView would also scroll the canvas host under it)
    const label = this.el.querySelectorAll<HTMLElement>('.np-label')[i];
    if (label) this.el.scrollTop = Math.max(0, label.offsetTop - 10);
  }
}

const hfFields = (hf: NotesHF) => [
  { name: 'header', label: 'Header', value: hf.header, placeholder: 'Top left of every page' },
  { name: 'footer', label: 'Footer', value: hf.footer, placeholder: 'Bottom left of every page' },
  { name: 'date', label: 'Date at the top right', value: String(hf.date), type: 'checkbox' as const },
  { name: 'dateFormat', label: 'Date as', value: hf.dateFormat ?? 'datetime1', options: DATE_FORMATS.map((f) => ({ value: f.id, label: f.name })) },
  { name: 'pageNumbers', label: 'Page number at the bottom right', value: String(hf.pageNumbers), type: 'checkbox' as const },
];
const hfOf = (v: Record<string, string>, was: NotesHF): NotesHF => ({
  ...was, header: v.header, footer: v.footer, date: v.date === 'true', dateFormat: v.dateFormat as NotesHF['dateFormat'], pageNumbers: v.pageNumbers === 'true',
});

/** View > Notes Master: notes pages' way up, how big the slide's picture is, the notes' font and size, and their header and footer. */
export async function editNotesMaster(m: Master): Promise<Master | null> {
  const s: NotesPageSetup = m.notesPage ?? {};
  const hf = m.notesHF ?? defaultNotesHF();
  const v = await ask('Notes Master', [
    { name: 'way', label: 'Page', value: s.landscape ? 'landscape' : 'portrait', options: [{ value: 'portrait', label: 'Portrait (7.5 × 10 in)' }, { value: 'landscape', label: 'Landscape (10 × 7.5 in)' }] },
    { name: 'slide', label: 'Slide picture', value: String(Math.round((s.slide ?? 0.42) * 100)), type: 'number', unit: '% of the page', help: 'How far down the page the slide\'s picture reaches; the notes fill the rest.' },
    { name: 'font', label: 'Notes font', value: s.font ?? '', placeholder: `The slides' body font (${m.bodyFont})` },
    { name: 'size', label: 'Notes size', value: String(s.size ?? 12), type: 'number', unit: 'pt' },
    ...hfFields(hf),
  ], { ok: 'Apply', note: 'Notes pages show this way in View > Notes Page and when printed (File > Print > Notes Pages). The header and footer are shared with handouts. Saved as PowerPoint\'s own notes master.' });
  if (!v) return null;
  const slide = Math.max(20, Math.min(75, Number(v.slide) || 42)) / 100;
  const size = Math.max(6, Math.min(48, Number(v.size) || 12));
  const notesPage: NotesPageSetup = { ...(v.way === 'landscape' ? { landscape: true } : {}), ...(Math.abs(slide - 0.42) > 0.001 ? { slide } : {}), ...(v.font.trim() ? { font: v.font.trim() } : {}), ...(size !== 12 ? { size } : {}) };
  return { ...m, notesPage: Object.keys(notesPage).length ? notesPage : undefined, notesHF: hfOf(v, hf) };
}

/** View > Handout Master: slides to a page, the page's way up, frames, and the header and footer. */
export async function editHandoutMaster(m: Master): Promise<Master | null> {
  const s: HandoutSetup = m.handout ?? defaultHandout();
  const hf = m.notesHF ?? defaultNotesHF();
  const v = await ask('Handout Master', [
    { name: 'per', label: 'Slides per page', value: String(s.perPage), options: HANDOUT_COUNTS.map((n) => ({ value: String(n), label: n === 3 ? '3 (with lines for notes)' : String(n) })) },
    { name: 'way', label: 'Page', value: s.landscape ? 'landscape' : 'portrait', options: [{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }] },
    { name: 'frame', label: 'Frame the slides', value: String(s.frame !== false), type: 'checkbox' },
    ...hfFields(hf),
  ], { ok: 'Apply', note: 'File > Print > Handouts as the Handout Master sets them prints this way. The header and footer are shared with notes pages. Saved as PowerPoint\'s own handout master.' });
  if (!v) return null;
  const handout: HandoutSetup = { perPage: Number(v.per) as HandoutSetup['perPage'], ...(v.way === 'landscape' ? { landscape: true } : {}), frame: v.frame === 'true' };
  return { ...m, handout, notesHF: hfOf(v, hf) };
}
