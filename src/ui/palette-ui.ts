// Your own palettes in the colour menus (Format > Edit Palettes…). Every colour box in the app
// opens the same small menu: the standard colours, your palette rows, and "More colours…", so
// the rows you make in a drawing are there in slides, sheets, documents and designs as well.

import { showDialog } from './dialog-host';
import { PRESET_PALETTES, cleanColour, freshName, withColour, type Palette, PALETTES_MAX } from '../palettes';
import { STANDARD_COLOURS } from '../colours';

let palettes: Palette[] = [];
/** The colours used in the drawing now showing (set up by the app), for "New palette from the drawing's colours". */
let drawingColours: () => string[] = () => [];

export function useDrawingColours(f: () => string[]): void {
  drawingColours = f;
}
const listeners: (() => void)[] = [];

export function getPalettes(): Palette[] {
  return palettes;
}

/** Use these palettes (read from the settings, or changed in the window); everyone listening hears. */
export function setPalettes(p: Palette[]): void {
  palettes = p.map((x) => ({ name: x.name, colors: [...x.colors] }));
  for (const f of listeners) f();
}

/** Hear about changes (to save the settings). */
export function onPalettes(f: () => void): void {
  listeners.push(f);
}

function cell(c: string, value: string | undefined, pick: (c: string) => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'colour-cell';
  b.title = c.toUpperCase();
  b.setAttribute('aria-label', c.toUpperCase());
  b.style.background = c;
  if (value && c.toLowerCase() === value.toLowerCase()) b.setAttribute('aria-pressed', 'true');
  b.addEventListener('click', () => pick(c));
  return b;
}

/**
 * Your palette rows for a colour menu: each row's name and colours, a + that adds the colour
 * now chosen to that row, and "Edit palettes…". `close` shuts the menu before the window opens.
 */
export function paletteRows(value: string | undefined, pick: (c: string) => void, close: () => void): HTMLElement {
  const box = document.createElement('div');
  box.className = 'palette-rows';
  palettes.forEach((p, i) => {
    const name = document.createElement('div');
    name.className = 'palette-name';
    name.textContent = p.name;
    const row = document.createElement('div');
    row.className = 'colour-grid palette-row';
    for (const c of p.colors) row.append(cell(c, value, pick));
    const k = value && cleanColour(value);
    if (k && !p.colors.includes(k)) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'colour-cell palette-add';
      add.textContent = '+';
      add.title = `Add ${k.toUpperCase()} to ${p.name}`;
      add.addEventListener('click', () => {
        const next = palettes.slice();
        next[i] = withColour(p, k);
        setPalettes(next);
        row.insertBefore(cell(k, value, pick), add);
        add.remove();
      });
      row.append(add);
    }
    box.append(name, row);
  });
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'colour-auto palette-edit';
  edit.textContent = palettes.length ? 'Edit palettes…' : 'Make your own palette…';
  edit.addEventListener('click', () => { close(); editPalettes(); });
  box.append(edit);
  return box;
}

// ---------------------------------------------------------------- plain colour boxes everywhere

let pop: HTMLElement | null = null;
let popFor: HTMLInputElement | null = null;

function closePop(): void {
  pop?.remove();
  pop = null;
  popFor = null;
}

/** Open the colour menu for a plain colour box: picking sets the box and tells its owner, as the system picker would. */
function openFor(input: HTMLInputElement): void {
  if (pop) { const same = popFor === input; closePop(); if (same) return; }
  const p = document.createElement('div');
  p.className = 'colour-pop';
  p.setAttribute('role', 'dialog');
  p.setAttribute('aria-label', 'Colours');
  const value = input.value;
  const pick = (c: string) => {
    closePop();
    input.value = c;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const grid = document.createElement('div');
  grid.className = 'colour-grid';
  for (const c of STANDARD_COLOURS) grid.append(cell(c, value, pick));
  grid.append(cell('#ffffff', value, pick));
  const more = document.createElement('label');
  more.className = 'colour-more';
  const sys = document.createElement('input');
  sys.type = 'color';
  sys.dataset.systemPicker = '';
  sys.value = value || '#000000';
  sys.addEventListener('change', () => pick(sys.value.toLowerCase()));
  more.append(document.createTextNode('More colours…'), sys);
  p.append(grid, paletteRows(value, pick, closePop), more);
  // inside an open window the menu has to be in the window too, or it can't be clicked
  (input.closest('dialog[open]') ?? document.body).append(p);
  const r = input.getBoundingClientRect();
  const w = p.offsetWidth, h = p.offsetHeight;
  p.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left))}px`;
  p.style.top = `${r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
  pop = p;
  popFor = input;
  (p.querySelector<HTMLElement>('[aria-pressed="true"]') ?? p.querySelector<HTMLElement>('button'))?.focus();
  p.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); input.focus(); } else e.stopPropagation(); });
}

/**
 * Make every plain colour box (input type=color) in the app open the colour menu with your
 * palettes, instead of going straight to the system picker ("More colours…" still opens that).
 */
export function usePaletteMenus(): void {
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement | null;
    if (!t?.closest) return;
    let input = t.closest('input[type=color]') as HTMLInputElement | null;
    // a click on a colour box's label (not on another button in it) opens the box too
    if (!input && !t.closest('button, select, textarea, a, input')) {
      const c = t.closest('label')?.control;
      if (c instanceof HTMLInputElement && c.type === 'color') input = c;
    }
    if (!input || input.disabled || 'systemPicker' in input.dataset || input.closest('.colour-pop, .palette-dialog')) return;
    e.preventDefault();
    openFor(input);
  }, true);
  document.addEventListener('pointerdown', (e) => {
    if (pop && !pop.contains(e.target as Node) && e.target !== popFor) closePop();
  }, true);
}

// ---------------------------------------------------------------- Edit Palettes window

let dialog: HTMLDialogElement | null = null;

/** The Edit Palettes window: add, rename, reorder and delete rows, and add or take out colours. */
export function editPalettes(): void {
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'palette-dialog';
    dialog.setAttribute('aria-label', 'Edit palettes');
    dialog.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    document.body.append(dialog);
  }
  fillDialog(dialog);
  showDialog(dialog);
}

function fillDialog(d: HTMLDialogElement): void {
  const redraw = () => fillDialog(d);
  const change = (next: Palette[]) => { setPalettes(next); redraw(); };
  d.replaceChildren();
  const h = document.createElement('h2');
  h.textContent = 'Your palettes';
  const intro = document.createElement('p');
  intro.className = 'muted';
  intro.textContent = 'Rows of colours shown in every colour menu, in every mode. Click a colour to change it; × takes it out.';
  d.append(h, intro);

  const list = document.createElement('div');
  list.className = 'palette-list';
  if (!palettes.length) {
    const none = document.createElement('p');
    none.className = 'muted';
    none.textContent = 'No palettes yet. Start an empty one, or add a ready-made row below.';
    list.append(none);
  }
  palettes.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'palette-edit-row';
    const name = document.createElement('input');
    name.type = 'text';
    name.value = p.name;
    name.setAttribute('aria-label', 'Palette name');
    name.addEventListener('change', () => {
      const next = palettes.slice();
      next[i] = { ...p, name: name.value.trim() || p.name };
      setPalettes(next);
    });
    const tools = document.createElement('span');
    tools.className = 'palette-tools';
    const tool = (text: string, title: string, on: () => void, off = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.disabled = off;
      b.addEventListener('click', on);
      tools.append(b);
    };
    const move = (to: number) => { const next = palettes.slice(); const [x] = next.splice(i, 1); next.splice(to, 0, x); change(next); };
    tool('↑', 'Move up', () => move(i - 1), i === 0);
    tool('↓', 'Move down', () => move(i + 1), i === palettes.length - 1);
    tool('Delete', `Delete ${p.name}`, () => change(palettes.filter((_, j) => j !== i)));
    const head = document.createElement('div');
    head.className = 'palette-edit-head';
    head.append(name, tools);

    const sw = document.createElement('div');
    sw.className = 'palette-swatches';
    p.colors.forEach((c, j) => {
      const wrap = document.createElement('span');
      wrap.className = 'palette-swatch';
      const inp = document.createElement('input');
      inp.type = 'color';
      inp.dataset.systemPicker = '';
      inp.value = c;
      inp.title = `${c.toUpperCase()}: click to change`;
      inp.addEventListener('change', () => {
        const colors = p.colors.slice();
        colors[j] = inp.value.toLowerCase();
        const next = palettes.slice();
        next[i] = { ...p, colors };
        change(next);
      });
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'palette-x';
      x.textContent = '×';
      x.title = `Take ${c.toUpperCase()} out`;
      x.addEventListener('click', () => {
        const next = palettes.slice();
        next[i] = { ...p, colors: p.colors.filter((_, k) => k !== j) };
        change(next);
      });
      wrap.append(inp, x);
      sw.append(wrap);
    });
    const add = document.createElement('label');
    add.className = 'palette-add-colour';
    add.title = 'Add a colour';
    const addInp = document.createElement('input');
    addInp.type = 'color';
    addInp.dataset.systemPicker = '';
    addInp.value = '#000000';
    addInp.addEventListener('change', () => {
      const next = palettes.slice();
      next[i] = withColour(p, addInp.value);
      change(next);
    });
    add.append('+', addInp);
    // typing a code is quicker when the colour comes from a journal's or a group's style guide
    const hex = document.createElement('input');
    hex.type = 'text';
    hex.className = 'palette-hex';
    hex.placeholder = '#1f5fbf';
    hex.setAttribute('aria-label', 'Add a colour by its code');
    hex.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      // several codes at once, separated by spaces or commas
      let q = p;
      for (const part of hex.value.split(/[\s,;]+/)) if (cleanColour(part)) q = withColour(q, part);
      if (q === p) { hex.select(); return; }
      const next = palettes.slice();
      next[i] = q;
      change(next);
    });
    sw.append(add, hex);
    row.append(head, sw);
    list.append(row);
  });
  d.append(list);

  const foot = document.createElement('div');
  foot.className = 'hk-foot';
  const left = document.createElement('span');
  left.className = 'hk-buttons';
  const full = palettes.length >= PALETTES_MAX;
  const newRow = document.createElement('button');
  newRow.type = 'button';
  newRow.textContent = 'New palette';
  newRow.disabled = full;
  newRow.addEventListener('click', () => change([...palettes, { name: freshName(palettes), colors: [] }]));
  const preset = document.createElement('select');
  preset.setAttribute('aria-label', 'Add a ready-made row');
  preset.disabled = full;
  preset.append(new Option('Add a ready-made row…', ''));
  for (const p of PRESET_PALETTES) preset.append(new Option(p.name, p.name));
  preset.addEventListener('change', () => {
    const p = PRESET_PALETTES.find((x) => x.name === preset.value);
    if (p) change([...palettes, { name: freshName(palettes, p.name), colors: [...p.colors] }]);
  });
  const fromDrawing = document.createElement('button');
  fromDrawing.type = 'button';
  fromDrawing.textContent = 'New palette from the drawing’s colours';
  fromDrawing.title = 'A row of every colour used in the drawing you have open';
  fromDrawing.disabled = full;
  fromDrawing.addEventListener('click', () => {
    const used = drawingColours().map(cleanColour).filter((c): c is string => !!c);
    let p: Palette = { name: freshName(palettes, 'Drawing colours'), colors: [] };
    for (const c of used) p = withColour(p, c);
    if (!p.colors.length) { fromDrawing.textContent = 'The drawing has no colours yet'; return; }
    change([...palettes, p]);
  });
  left.append(newRow, fromDrawing, preset);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'primary';
  close.textContent = 'Close';
  close.addEventListener('click', () => d.close());
  foot.append(left, close);
  d.append(foot);
}
