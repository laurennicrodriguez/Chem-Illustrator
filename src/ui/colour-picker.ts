// A colour button for the Style panel: a swatch that opens a small palette of the drawing's
// colours (a standard set plus the colours already used, up to twenty), your own palette rows,
// "Automatic", and "More colours…" for any colour at all.

import type { Doc } from '../model';
import { documentColours } from '../colours';
import { paletteRows } from './palette-ui';

export interface ColourPickerOptions {
  /** What "no colour set" means here, shown as the first choice (Automatic, None…). */
  autoLabel?: string;
  /** The swatch shown for "no colour set". */
  autoSwatch?: string;
}

/**
 * A button showing `value` that lets the user pick a colour; `on` gets the new colour, or
 * undefined for the automatic one.
 */
export function colourButton(doc: Doc, value: string | undefined, on: (v: string | undefined) => void, opts: ColourPickerOptions = {}): HTMLElement {
  const auto = opts.autoLabel ?? 'Auto (black)';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'colour-button';
  btn.setAttribute('aria-haspopup', 'true');
  const sw = document.createElement('span');
  sw.className = 'colour-swatch';
  paint(sw, value ?? opts.autoSwatch);
  const name = document.createElement('span');
  name.textContent = value ? value.toUpperCase() : auto;
  btn.append(sw, name);
  btn.addEventListener('click', () => openPalette(btn, doc, value, on, auto, opts.autoSwatch));
  return btn;
}

function paint(el: HTMLElement, colour: string | undefined): void {
  if (colour) { el.style.background = colour; el.classList.remove('none'); } else { el.style.background = ''; el.classList.add('none'); }
}

let open: HTMLElement | null = null;
let owner: HTMLElement | null = null;

function closePalette(): void {
  open?.remove();
  open = null;
  owner = null;
}

function openPalette(btn: HTMLElement, doc: Doc, value: string | undefined, on: (v: string | undefined) => void, auto: string, autoSwatch?: string): void {
  if (open) { const was = owner === btn; closePalette(); if (was) return; }
  const pop = document.createElement('div');
  pop.className = 'colour-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Colours');
  const pick = (v: string | undefined) => { closePalette(); on(v); };

  const autoBtn = document.createElement('button');
  autoBtn.type = 'button';
  autoBtn.className = 'colour-auto';
  const asw = document.createElement('span');
  asw.className = 'colour-swatch';
  paint(asw, autoSwatch);
  autoBtn.append(asw, document.createTextNode(auto));
  autoBtn.addEventListener('click', () => pick(undefined));

  const grid = document.createElement('div');
  grid.className = 'colour-grid';
  for (const c of documentColours(doc)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'colour-cell';
    b.title = c.toUpperCase();
    b.setAttribute('aria-label', c.toUpperCase());
    b.style.background = c;
    if (value && c.toLowerCase() === value.toLowerCase()) b.setAttribute('aria-pressed', 'true');
    b.addEventListener('click', () => pick(c));
    grid.append(b);
  }

  const more = document.createElement('label');
  more.className = 'colour-more';
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.dataset.systemPicker = '';
  inp.value = value ?? '#000000';
  inp.addEventListener('change', () => pick(inp.value.toLowerCase()));
  more.append(document.createTextNode('More colours…'), inp);

  pop.append(autoBtn, grid, paletteRows(value, pick, closePalette), more);
  // in a window (a modal dialog) the menu goes inside it, or it would sit behind it out of reach
  (btn.closest('dialog') ?? document.body).append(pop);
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
  pop.style.top = `${r.bottom + 4}px`;
  open = pop;
  owner = btn;
  (grid.querySelector('[aria-pressed="true"]') as HTMLElement | null ?? autoBtn).focus();
  const away = (e: Event) => {
    if (!open || open !== pop) { document.removeEventListener('pointerdown', away, true); return; }
    if (!pop.contains(e.target as Node) && e.target !== btn && !btn.contains(e.target as Node)) closePalette();
  };
  document.addEventListener('pointerdown', away, true);
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePalette(); btn.focus(); } });
}
