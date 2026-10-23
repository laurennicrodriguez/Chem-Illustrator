// Insert ▸ Diagram… (and Edit Diagram…): SmartArt-style diagrams from text. On the left the
// layouts (lists, processes, cycles, hierarchies…), in the middle the text (one item per line,
// Tab for a level down), on the right the diagram as it will look; below, its colours and look.

import {
  DIAGRAM_BY_ID, DIAGRAM_CATEGORIES, DIAGRAM_COLOURS, DIAGRAM_DEFAULTS, DIAGRAM_LAYOUTS, newDiagram,
  type DiagramColours, type DiagramData,
} from '../design/diagrams';
import type { Doc } from '../model';
import { colourButton } from './colour-picker';

/** How the last diagram looked, so a new one starts the same way. */
let lastLook: Pick<DiagramData, 'colours' | 'accent' | 'rounded' | 'shadow'> & { layout: string } = { ...DIAGRAM_DEFAULTS, layout: 'process' };

export interface DiagramDialogOptions {
  /** The diagram drawn as an SVG picture (for the preview and the layout buttons). */
  preview(d: DiagramData): string;
  /** New diagrams' size as a part of each layout's usual size (smaller in documents). */
  scale: number;
  /** The drawing it goes in: the accent colour is picked from its colours and your palettes, as in the Style panel. */
  doc?: Doc;
}

/** Ask for a diagram: a new one, or `editing` with its text and look to change. */
export function askDiagram(editing: DiagramData | null, o: DiagramDialogOptions): Promise<DiagramData | null> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'ask diagram-dialog';
    d.setAttribute('aria-label', 'Diagram');
    const form = document.createElement('form');
    form.method = 'dialog';
    form.innerHTML = `<h2>${editing ? 'Edit Diagram' : 'Diagram'}</h2>
      <div class="dg-body">
        <div class="dg-layouts" role="listbox" aria-label="Layout"></div>
        <div class="dg-text">
          <label for="dg-text"><b>Text</b></label>
          <textarea id="dg-text" name="text" rows="12" spellcheck="true"></textarea>
          <p class="muted small">One item per line. <kbd>Tab</kbd> moves a line a level down (under the line above), <kbd>Shift+Tab</kbd> back up.
            Formulas get their subscripts (CO2, ArB(OH)2); <code>_</code> and <code>^</code> make others (TS^‡).</p>
          <p class="muted small dg-blurb"></p>
        </div>
        <div class="dg-preview" aria-label="How it will look"></div>
      </div>
      <div class="dg-look">
        <label class="ask-row"><span>Colours</span><select name="colours"></select></label>
        <label class="ask-row"><span>Accent colour</span><input name="accent" type="color" /></label>
        <label class="ask-row"><span>Text size</span><span class="energy-pair"><input name="size" type="number" min="4" max="96" step="0.5" placeholder="fit" aria-label="Text size in points (empty: as big as fits)" /> pt</span></label>
        <label class="ask-row"><span>Size</span><span class="energy-pair"><input name="w" type="number" min="40" step="any" aria-label="Width" /> × <input name="h" type="number" min="30" step="any" aria-label="Height" /> pt</span></label>
        <label class="ask-row ask-check"><input name="rounded" type="checkbox" /><span>Rounded corners</span></label>
        <label class="ask-row ask-check"><input name="shadow" type="checkbox" /><span>Shadow</span></label>
      </div>
      <p class="ask-buttons"><button type="button" data-act="cancel">Cancel</button> <button type="submit" class="primary">${editing ? 'Change' : 'Insert'}</button></p>`;
    const $ = <T extends Element>(q: string) => form.querySelector<T>(q)!;
    const text = $<HTMLTextAreaElement>('textarea');
    const coloursSel = $<HTMLSelectElement>('select[name=colours]');
    for (const [k, name] of DIAGRAM_COLOURS) coloursSel.append(new Option(name, k));
    const accent = $<HTMLInputElement>('input[name=accent]');
    const size = $<HTMLInputElement>('input[name=size]');
    const wIn = $<HTMLInputElement>('input[name=w]'), hIn = $<HTMLInputElement>('input[name=h]');
    const rounded = $<HTMLInputElement>('input[name=rounded]'), shadow = $<HTMLInputElement>('input[name=shadow]');
    const look = editing ?? newDiagram(lastLook.layout, null, lastLook, o.scale);
    let layout = look.layout;
    text.value = look.text;
    coloursSel.value = look.colours;
    accent.value = look.accent;
    size.value = look.size ? String(look.size) : '';
    wIn.value = String(Math.round(look.w));
    hIn.value = String(Math.round(look.h));
    rounded.checked = look.rounded;
    shadow.checked = look.shadow;
    // the drawing's colour menu (its colours, your palettes, More colours…) in place of the plain colour box
    if (o.doc) {
      const doc = o.doc;
      accent.hidden = true;
      const swap = () => {
        const b = colourButton(doc, accent.value, (v) => { if (!v) return; accent.value = v; swap(); later(); }, { autoLabel: 'Default blue', autoSwatch: DIAGRAM_DEFAULTS.accent });
        b.classList.add('dg-accent');
        accent.parentElement!.querySelector('.dg-accent')?.remove();
        accent.after(b);
      };
      swap();
    }
    // a layout's sample text is replaced by the next layout's sample until the text is changed
    let sample = !editing;
    text.addEventListener('input', () => { sample = false; later(); });

    const data = (): DiagramData => ({
      layout, text: text.value,
      colours: coloursSel.value as DiagramColours, accent: accent.value,
      rounded: rounded.checked, shadow: shadow.checked,
      ...(Number(size.value) > 0 ? { size: Number(size.value) } : {}),
      w: Math.max(40, Number(wIn.value) || look.w), h: Math.max(30, Number(hIn.value) || look.h),
      // the room kept for structures in its items stays (it is worked out again after the change)
      ...(editing?.figs ? { figs: editing.figs } : {}),
    });

    // the layouts, by kind, each a button with a small picture of it
    const list = $<HTMLDivElement>('.dg-layouts');
    const buttons = new Map<string, HTMLButtonElement>();
    for (const cat of DIAGRAM_CATEGORIES) {
      const ls = DIAGRAM_LAYOUTS.filter((l) => l.category === cat);
      if (!ls.length) continue;
      list.append(Object.assign(document.createElement('h3'), { textContent: cat }));
      const grid = document.createElement('div');
      grid.className = 'dg-grid';
      for (const l of ls) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'dg-layout';
        b.setAttribute('role', 'option');
        b.title = `${l.name}: ${l.blurb}`;
        b.setAttribute('aria-label', l.name);
        const pic = document.createElement('span');
        pic.className = 'dg-thumb';
        pic.innerHTML = o.preview({ ...newDiagram(l.id, null, { colours: 'accent', accent: '#4472c4', rounded: true, shadow: false }), size: 0.1 });
        b.append(pic, Object.assign(document.createElement('span'), { textContent: l.name }));
        b.addEventListener('click', () => pick(l.id));
        buttons.set(l.id, b);
        grid.append(b);
      }
      list.append(grid);
    }
    const pick = (id: string) => {
      const l = DIAGRAM_BY_ID.get(id);
      if (!l) return;
      const was = DIAGRAM_BY_ID.get(layout);
      layout = id;
      if (sample) text.value = l.sample;
      // a new diagram takes the layout's own shape (a cycle is square, a process wide) unless the size was typed
      if (!editing && was && Math.round(was.size[0] * o.scale) === Number(wIn.value) && Math.round(was.size[1] * o.scale) === Number(hIn.value)) {
        wIn.value = String(Math.round(l.size[0] * o.scale));
        hIn.value = String(Math.round(l.size[1] * o.scale));
      }
      for (const [k, b] of buttons) { b.classList.toggle('on', k === id); b.setAttribute('aria-selected', String(k === id)); }
      $('.dg-blurb').textContent = l.blurb;
      draw();
    };

    const view = $<HTMLDivElement>('.dg-preview');
    const draw = () => { view.innerHTML = o.preview(data()); };
    let timer = 0;
    const later = () => { clearTimeout(timer); timer = window.setTimeout(draw, 120); };
    for (const el of [coloursSel, accent, size, wIn, hIn, rounded, shadow]) el.addEventListener('input', later);

    // Tab and Shift+Tab move the lines the caret or selection is on a level down or up
    text.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const v = text.value;
      const a = v.lastIndexOf('\n', text.selectionStart - 1) + 1;
      let b = v.indexOf('\n', Math.max(text.selectionStart, text.selectionEnd - 1));
      if (b < 0) b = v.length;
      const lines = v.slice(a, b).split('\n').map((l) => (e.shiftKey ? l.replace(/^(\t| {1,2})/, '') : '\t' + l));
      const block = lines.join('\n');
      text.value = v.slice(0, a) + block + v.slice(b);
      text.selectionStart = a;
      text.selectionEnd = a + block.length;
      sample = false;
      later();
    });

    d.append(form);
    document.body.append(d);
    const finish = (v: DiagramData | null) => { clearTimeout(timer); d.remove(); resolve(v); };
    form.querySelector('[data-act=cancel]')!.addEventListener('click', () => { d.close(); finish(null); });
    d.addEventListener('cancel', () => finish(null));
    d.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const out = data();
      if (!out.text.trim()) { text.focus(); return; }
      lastLook = { layout: out.layout, colours: out.colours, accent: out.accent, rounded: out.rounded, shadow: out.shadow };
      d.close();
      finish(out);
    });
    pick(layout);
    d.showModal();
    text.focus();
  });
}
