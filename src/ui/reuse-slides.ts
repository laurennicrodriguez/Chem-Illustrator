// Reuse Slides (Home > Reuse, or Insert > Reuse Slides): the slides of another PowerPoint file
// as small pictures. Click slides to pick them (Shift+click for a run of them), then insert
// them after the slide being edited, in this deck's look or each keeping its own.

import type { Deck } from '../deck/deck';
import { paintSlide } from '../deck/slide-view';

export interface ReuseChoice { indices: number[]; keep: boolean }

const W = 168;

/** Resolves with the slides picked (by index in `from`) and whether they keep their own look, or null when cancelled. */
export function pickReuseSlides(name: string, from: Deck, keep: boolean): Promise<ReuseChoice | null> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'ask template-gallery reuse-slides';
    d.setAttribute('aria-label', 'Reuse Slides');
    const h = document.createElement('h2');
    h.textContent = 'Reuse Slides';
    const note = document.createElement('p');
    note.className = 'muted';
    const n = from.slides.length;
    note.textContent = `${name}: ${n} slide${n === 1 ? '' : 's'}. Click the slides you want (Shift+click picks a run of them); they go in after the slide you are on.`;
    const grid = document.createElement('div');
    grid.className = 'tg-grid rs-grid';
    grid.setAttribute('role', 'listbox');
    grid.setAttribute('aria-multiselectable', 'true');
    grid.setAttribute('aria-label', 'Slides in the file');
    const picked = new Set<number>();
    let anchor = 0;
    const cards: HTMLButtonElement[] = [];
    const insert = document.createElement('button');
    const mark = () => {
      cards.forEach((c, i) => { c.classList.toggle('current', picked.has(i)); c.setAttribute('aria-selected', String(picked.has(i))); });
      insert.disabled = !picked.size;
      insert.textContent = picked.size > 1 ? `Insert ${picked.size} Slides` : 'Insert Slide';
    };
    const hgt = Math.round((W * from.size.h) / from.size.w);
    for (let i = 0; i < n; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tg-card rs-card';
      b.setAttribute('role', 'option');
      const c = document.createElement('canvas');
      c.className = 'tg-thumb';
      c.style.width = `${W}px`;
      c.style.height = `${hgt}px`;
      paintSlide(c, W, hgt, window.devicePixelRatio || 1, from.page(i), from.docOf(i));
      const label = document.createElement('span');
      label.className = 'muted tg-size';
      const title = [...from.docOf(i).captions.values()].find((x) => x.ph === 'title')?.runs.map((r) => r.text).join('').trim();
      label.textContent = `${i + 1}${title ? `. ${title}` : ''}${from.slides[i].hidden ? ' (hidden)' : ''}`;
      b.append(c, label);
      b.addEventListener('click', (e) => {
        if (e.shiftKey) {
          const [a, z] = [Math.min(anchor, i), Math.max(anchor, i)];
          for (let k = a; k <= z; k++) picked.add(k);
        } else if (picked.has(i)) picked.delete(i);
        else picked.add(i);
        anchor = i;
        mark();
      });
      b.addEventListener('dblclick', () => { picked.clear(); picked.add(i); finish(); });
      cards.push(b);
      grid.append(b);
    }
    const keepBox = document.createElement('input');
    keepBox.type = 'checkbox';
    keepBox.checked = keep;
    const opt = document.createElement('label');
    opt.className = 'st-option';
    opt.title = 'Off: the slides take this deck\'s fonts, colours and background, as PowerPoint\'s Use Destination Theme. On: each keeps the look it has in the other file';
    opt.append(keepBox, document.createTextNode(' Keep source formatting (the slides keep their own background, fonts and colours)'));
    const buttons = document.createElement('p');
    buttons.className = 'ask-buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const all = document.createElement('button');
    all.type = 'button';
    all.textContent = 'Insert All';
    insert.type = 'button';
    insert.className = 'primary';
    buttons.append(cancel, ' ', all, ' ', insert);
    let result: ReuseChoice | null = null;
    const finish = () => { if (picked.size) result = { indices: [...picked].sort((a, b) => a - b), keep: keepBox.checked }; d.close(); };
    cancel.addEventListener('click', () => d.close());
    all.addEventListener('click', () => { for (let i = 0; i < n; i++) picked.add(i); finish(); });
    insert.addEventListener('click', finish);
    d.append(h, note, grid, opt, buttons);
    d.addEventListener('close', () => { d.remove(); resolve(result); });
    document.body.append(d);
    mark();
    d.showModal();
    cards[0]?.focus();
  });
}
