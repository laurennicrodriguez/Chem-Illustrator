// Design > Templates (Slides): about twenty ready-made looks for a deck, each shown as its title
// slide and a content slide. Picking one changes every slide's fonts, colours, background and
// shapes at once (Undo puts them back); the slides' text, structures and pictures stay.

import { Doc } from '../model';
import { Master, SlideSize, LayoutId, layoutFrames, frameFields, textStyles, slideColours } from '../deck/deck';
import { paintSlide } from '../deck/slide-view';
import { SLIDE_TEMPLATES, SlideTemplate, applyTemplate } from '../deck/templates';

export interface TemplateChoice { template: SlideTemplate; forNew: boolean }

/** Resolves with the template picked (and whether new decks should start with it), or null when cancelled. */
export function pickSlideTemplate(m: Master, size: SlideSize, defaultId: string | null): Promise<TemplateChoice | null> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'ask template-gallery slide-templates';
    const h = document.createElement('h2');
    h.textContent = 'Slide Templates';
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = 'A template sets the fonts, colours, background and shapes of every slide. Your text, structures, logo, footer and slide numbers stay as they are, and Slide Master changes any part of the look afterwards.';
    const body = document.createElement('div');
    body.className = 'st-body';
    let result: TemplateChoice | null = null;
    const repaint: (() => void)[] = [];
    const forNew = document.createElement('input');
    forNew.type = 'checkbox';
    for (const group of ['Light', 'Dark title slide', 'Bright'] as const) {
      const g = document.createElement('h3');
      g.textContent = group === 'Dark title slide' ? 'Dark title slide (light content slides)' : group;
      const grid = document.createElement('div');
      grid.className = 'tg-grid';
      for (const t of SLIDE_TEMPLATES.filter((x) => x.group === group)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tg-card';
        if (m.template === t.name) b.classList.add('current');
        const c = document.createElement('canvas');
        c.className = 'tg-thumb';
        const look = applyTemplate(m, t);
        thumbs(c, look, size);
        repaint.push(() => thumbs(c, look, size));
        const name = document.createElement('strong');
        name.textContent = t.name + (m.template === t.name ? ' (in use)' : '') + (defaultId === t.id ? ' · for new decks' : '');
        const fonts = document.createElement('span');
        fonts.className = 'muted tg-size';
        fonts.textContent = t.titleFont === t.bodyFont ? t.titleFont : `${t.titleFont} and ${t.bodyFont}`;
        b.append(c, name, fonts);
        b.addEventListener('click', () => { result = { template: t, forNew: forNew.checked }; d.close(); });
        grid.append(b);
      }
      body.append(g, grid);
    }
    const opt = document.createElement('label');
    opt.className = 'st-option';
    opt.append(forNew, document.createTextNode(' Also start new slide decks with the template I pick'));
    const buttons = document.createElement('p');
    buttons.className = 'ask-buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => d.close());
    buttons.append(cancel);
    d.append(h, note, body, opt, buttons);
    d.addEventListener('close', () => { d.remove(); resolve(result); });
    document.body.append(d);
    d.showModal();
    (body.querySelector('button') as HTMLElement | null)?.focus();
    // the fonts that come with the app load when first used: draw the cards again once they have
    if (typeof document.fonts?.load === 'function') {
      const families = new Set(SLIDE_TEMPLATES.flatMap((t) => [t.titleFont, t.bodyFont]));
      void Promise.allSettled([...families].flatMap((f) => [document.fonts.load(`12px "${f}"`), document.fonts.load(`bold 12px "${f}"`)]))
        .then(() => { if (d.isConnected) for (const r of repaint) r(); });
    }
  });
}

const W = 112, H = 63, GAP = 6;

/** The template's title slide and a content slide, side by side. */
function thumbs(c: HTMLCanvasElement, m: Master, size: SlideSize): void {
  const k = devicePixelRatio;
  c.width = (2 * W + GAP) * k;
  c.height = H * k;
  c.style.width = `${2 * W + GAP}px`;
  c.style.height = `${H}px`;
  const g = c.getContext('2d');
  if (!g) return;
  const one = document.createElement('canvas');
  const pages: [LayoutId, string[]][] = [['title', ['Total Synthesis', 'Group meeting']], ['title-content', ['Results', 'Scope of the coupling\nYields and selectivity']]];
  pages.forEach(([layout, text], i) => {
    try {
      paintSlide(one, W, H, k, { size, master: m, layout, index: i }, sample(m, size, layout, text), slideColours(m, layout).background);
      g.drawImage(one, i * (W + GAP) * k, 0);
      g.strokeStyle = 'rgba(0,0,0,0.18)';
      g.lineWidth = 1;
      g.strokeRect(i * (W + GAP) * k + 0.5, 0.5, W * k - 1, H * k - 1);
    } catch {
      // no canvas here: the card stays plain
    }
  });
}

/** A slide of this layout with its placeholders filled with sample text. */
function sample(m: Master, size: SlideSize, layout: LayoutId, text: string[]): Doc {
  const d = new Doc();
  const styles = textStyles(m, layout);
  d.textStyles = styles;
  d.edit('Sample', () => {
    layoutFrames(layout, size).forEach((f, i) => {
      if (!text[i]) return;
      d.addCaption({ ...frameFields(f, styles), runs: [{ text: text[i] }], paras: f.ph === 'body' ? text[i].split('\n').map(() => ({ list: 'bullet' as const })) : undefined });
    });
  });
  return d;
}
