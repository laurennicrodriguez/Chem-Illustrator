// Insert > Header & Footer (also Date & Time and Slide Number): the date (today's, kept up to
// date in the form picked, or fixed text), slide number and footer on the slides, for the slides
// picked (Apply) or every slide (Apply to All), and the header, footer, date and page numbers of
// notes pages and handouts. Saved as PowerPoint's own date, number and footer placeholders.

import { DATE_FORMATS, dateText, defaultNotesHF, showsDate, showsFooter, showsNumber, type DateFormat, type LayoutId, type Master, type SlideHF } from '../deck/deck';
import { showDialog } from './dialog-host';

export interface HeaderFooterResult {
  master: Master;
  /** What the slides show (for the slides picked, or every slide). */
  show: { number: boolean; footer: boolean; date: boolean };
  /** Apply (the slides picked) or Apply to All. */
  scope: 'picked' | 'all';
}

/** Show the window for a deck with this master; `slide` is the slide being edited (its layout and own say). */
export function editHeaderFooter(m: Master, slide: { layout: LayoutId; hf?: SlideHF }, picked: number, tab: 'slide' | 'notes' = 'slide'): Promise<HeaderFooterResult | null> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'ask hf-dialog';
    const form = document.createElement('form');
    form.method = 'dialog';
    d.append(form);
    const h = document.createElement('h2');
    h.textContent = 'Header and Footer';
    const tabs = document.createElement('div');
    tabs.className = 'hf-tabs';
    tabs.setAttribute('role', 'tablist');
    const pages = { slide: document.createElement('div'), notes: document.createElement('div') };
    const tabBtn = (id: 'slide' | 'notes', label: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.textContent = label;
      b.addEventListener('click', () => show(id));
      tabs.append(b);
      return b;
    };
    const tabBtns = { slide: tabBtn('slide', 'Slide'), notes: tabBtn('notes', 'Notes and Handouts') };
    const show = (id: 'slide' | 'notes') => {
      for (const k of ['slide', 'notes'] as const) {
        pages[k].hidden = k !== id;
        tabBtns[k].setAttribute('aria-selected', String(k === id));
      }
      apply.hidden = id !== 'slide';
    };

    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string) => { const x = document.createElement(tag); if (cls) x.className = cls; return x; };
    const check = (label: string, on: boolean, title = '') => {
      const l = el('label', 'hf-check');
      const i = el('input');
      i.type = 'checkbox';
      i.checked = on;
      l.append(i, ` ${label}`);
      if (title) l.title = title;
      return { l, i };
    };
    const textBox = (v: string, placeholder = '') => { const i = el('input'); i.type = 'text'; i.value = v; i.placeholder = placeholder; return i; };
    /** Today's date, kept up to date in a form, or fixed text: the radio buttons and boxes. */
    const dateBlock = (name: string, on: boolean, fmt: DateFormat | undefined, fixed: string | undefined) => {
      const box = el('div', 'hf-block');
      const c = check('Date and time', on, 'The date (and time) at the bottom left');
      const auto = el('label', 'hf-radio');
      const ra = el('input');
      ra.type = 'radio'; ra.name = name; ra.checked = !fixed?.trim();
      const sel = el('select');
      for (const f of DATE_FORMATS) sel.add(new Option(exampleOf(f.id), f.id));
      sel.value = fmt ?? 'datetime1';
      auto.append(ra, ' Update automatically ', sel);
      auto.title = 'Today\'s date when the slides are shown or printed (PowerPoint keeps it up to date too)';
      const fix = el('label', 'hf-radio');
      const rf = el('input');
      rf.type = 'radio'; rf.name = name; rf.checked = !!fixed?.trim();
      const ft = textBox(fixed ?? '', 'e.g. Group meeting, 22 October 2026');
      fix.append(rf, ' Fixed ', ft);
      fix.title = 'This text stays as it is';
      const sync = () => { for (const x of [ra, rf, sel, ft]) x.disabled = !c.i.checked; };
      c.i.addEventListener('change', sync);
      ft.addEventListener('input', () => { if (ft.value) rf.checked = true; });
      sync();
      box.append(c.l, auto, fix);
      return { box, on: c.i, fixed: () => (rf.checked ? ft.value : ''), format: () => sel.value as DateFormat };
    };

    // ---- the slides
    const sd = dateBlock('hf-date', showsDate(m, slide.layout, slide.hf), m.dateFormat, m.dateFixed);
    const num = check('Slide number', showsNumber(m, slide.layout, slide.hf), 'The slide\'s number at the bottom right');
    const foot = check('Footer', showsFooter(m, slide.layout, slide.hf), 'Text at the bottom in the middle');
    const footText = textBox(m.footer, 'e.g. Smith group · Auburn University');
    footText.addEventListener('input', () => { if (footText.value.trim()) foot.i.checked = true; });
    const footRow = el('div', 'hf-block');
    footRow.append(foot.l, footText);
    const offTitle = check('Don\'t show on title slide', !m.numberTitleSlides, 'Title Slide layouts show none of the three');
    const preview = el('p', 'muted small hf-note');
    const note = () => {
      const bits = [sd.on.checked ? 'date' : '', num.i.checked ? 'number' : '', foot.i.checked && footText.value.trim() ? 'footer' : ''].filter(Boolean);
      preview.textContent = `${bits.length ? `Slides show the ${bits.join(', ')}` : 'Slides show none of these'}${sd.on.checked ? ` (${sd.fixed() || dateText({ dateFormat: sd.format() })})` : ''}. Apply changes the ${picked > 1 ? `${picked} slides picked` : 'slide being edited'}; Apply to All changes every slide.`;
    };
    form.addEventListener('input', note);
    form.addEventListener('change', note);
    pages.slide.append(sd.box, num.l, footRow, offTitle.l, preview);

    // ---- notes pages and handouts
    const n0 = m.notesHF ?? defaultNotesHF();
    const nd = dateBlock('hf-ndate', n0.date, n0.dateFormat, n0.dateFixed);
    const hdr = check('Header', !!n0.header.trim(), 'Text at the top left of each notes page and handout');
    const hdrText = textBox(n0.header);
    hdrText.addEventListener('input', () => { if (hdrText.value.trim()) hdr.i.checked = true; });
    const hdrRow = el('div', 'hf-block');
    hdrRow.append(hdr.l, hdrText);
    const page = check('Page number', n0.pageNumbers, 'The page\'s number at the bottom right');
    const nfoot = check('Footer', !!n0.footer.trim(), 'Text at the bottom left');
    const nfootText = textBox(n0.footer);
    nfootText.addEventListener('input', () => { if (nfootText.value.trim()) nfoot.i.checked = true; });
    const nfootRow = el('div', 'hf-block');
    nfootRow.append(nfoot.l, nfootText);
    const nnote = el('p', 'muted small hf-note');
    nnote.textContent = 'For printed notes pages and handouts (File > Print), and PowerPoint\'s notes and handout masters.';
    pages.notes.append(nd.box, hdrRow, page.l, nfootRow, nnote);

    const buttons = el('p', 'ask-buttons');
    const cancel = el('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const apply = el('button');
    apply.type = 'button';
    apply.textContent = 'Apply';
    apply.title = picked > 1 ? `Only the ${picked} slides picked` : 'Only the slide being edited';
    const all = el('button', 'primary');
    all.type = 'submit';
    all.textContent = 'Apply to All';
    buttons.append(cancel, apply, all);
    form.append(h, tabs, pages.slide, pages.notes, buttons);
    show(tab);
    note();

    let finished = false;
    const done = (v: HeaderFooterResult | null) => {
      if (finished) return;
      finished = true;
      if (d.open) d.close();
      d.remove();
      resolve(v);
    };
    const result = (scope: 'picked' | 'all'): HeaderFooterResult => {
      const off = offTitle.i.checked;
      const fixed = sd.fixed().trim();
      const nfixed = nd.fixed().trim();
      const master: Master = {
        ...m,
        footer: footText.value,
        dateFormat: sd.format(),
        numberTitleSlides: !off,
        notesHF: {
          header: hdr.i.checked ? hdrText.value : '', footer: nfoot.i.checked ? nfootText.value : '',
          date: nd.on.checked, dateFormat: nd.format(), ...(nfixed ? { dateFixed: nfixed } : {}), pageNumbers: page.i.checked,
        },
      };
      if (fixed) master.dateFixed = fixed; else delete master.dateFixed;
      if (off) master.footerOffTitle = true; else delete master.footerOffTitle;
      // with the footer unticked everywhere, its text is kept for later
      return { master, show: { number: num.i.checked, footer: foot.i.checked && !!footText.value.trim(), date: sd.on.checked }, scope };
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); done(result('all')); });
    apply.addEventListener('click', () => done(result('picked')));
    cancel.addEventListener('click', () => done(null));
    d.addEventListener('close', () => done(null));
    showDialog(d);
  });
}

/** Today in a date field's form, as the list shows it. */
function exampleOf(f: DateFormat): string {
  return dateText({ dateFormat: f });
}
