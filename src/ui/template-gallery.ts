// File > New Design: a blank page, or one of the ready-made designs, each shown as a small
// picture of the page it makes.

import { Doc } from '../model';
import { Deck } from '../deck/deck';
import { paintSlide } from '../deck/slide-view';
import { DESIGN_TEMPLATES, DesignTemplate, fillTemplate, templateSize } from '../design/templates';
import { sizeLabel } from './design-panel';

/** Resolves with the template picked, 'blank' for an empty page, or null when cancelled. */
export function pickTemplate(): Promise<DesignTemplate | 'blank' | null> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'ask template-gallery';
    const h = document.createElement('h2');
    h.textContent = 'New Design';
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = 'Start from a blank page or a ready-made layout. Everything in a layout can be moved, retyped, recoloured or deleted, and Page Size changes the page later.';
    const grid = document.createElement('div');
    grid.className = 'tg-grid';
    let result: DesignTemplate | 'blank' | null = null;
    const card = (name: string, blurb: string, detail: string, paint: (c: HTMLCanvasElement) => void, pick: DesignTemplate | 'blank') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tg-card';
      const c = document.createElement('canvas');
      c.className = 'tg-thumb';
      paint(c);
      const t = document.createElement('strong');
      t.textContent = name;
      const p = document.createElement('span');
      p.className = 'tg-blurb';
      p.textContent = blurb;
      const s = document.createElement('span');
      s.className = 'muted tg-size';
      s.textContent = detail;
      b.append(c, t, p, s);
      b.addEventListener('click', () => { result = pick; d.close(); });
      return b;
    };
    grid.append(card('Blank page', 'An empty page: choose its size next (journal graphics, posters, slides, paper or your own).', 'Any size', blank, 'blank'));
    for (const t of DESIGN_TEMPLATES) grid.append(card(t.name, t.blurb, sizeLabel(templateSize(t)), (c) => thumb(c, t), t));
    const buttons = document.createElement('p');
    buttons.className = 'ask-buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => d.close());
    buttons.append(cancel);
    d.append(h, note, grid, buttons);
    d.addEventListener('close', () => { d.remove(); resolve(result); });
    document.body.append(d);
    d.showModal();
    (grid.firstElementChild as HTMLElement | null)?.focus();
  });
}

const THUMB_W = 168, THUMB_H = 112;

function sizeCanvas(c: HTMLCanvasElement): void {
  c.width = THUMB_W * devicePixelRatio;
  c.height = THUMB_H * devicePixelRatio;
  c.style.width = `${THUMB_W}px`;
  c.style.height = `${THUMB_H}px`;
}

/** An empty white page. */
function blank(c: HTMLCanvasElement): void {
  sizeCanvas(c);
  const g = c.getContext('2d');
  if (!g) return;
  const k = devicePixelRatio;
  g.fillStyle = '#ffffff';
  g.fillRect(44 * k, 14 * k, 80 * k, 84 * k);
}

/** A small picture of the page a template makes. */
function thumb(c: HTMLCanvasElement, t: DesignTemplate): void {
  sizeCanvas(c);
  const size = templateSize(t);
  const deck = Deck.design(new Doc(), size, (d) => fillTemplate(d, t));
  const doc = deck.docOf(0);
  try {
    paintSlide(c, THUMB_W, THUMB_H, devicePixelRatio, { size, master: deck.master, layout: 'blank', index: 0 }, doc, 'rgba(0,0,0,0)');
  } catch {
    // a picture that can't be drawn here (no canvas) leaves the card plain
  }
}
