// Design mode's own parts: the window that picks a page size, and the shape library on the left
// (searchable, in groups, each shape drawn as a small picture). Clicking a shape picks it as the
// tool (click or drag on the page to place it); a shape can also be dragged straight onto the page.

import { DESIGN_SIZES, SlideSize } from '../deck/deck';
import { GEOS, GEO_GROUPS, GeoDef, traceSteps } from '../design/geo';

/** The type a library shape is dragged as. */
export const GEO_DRAG_TYPE = 'application/x-chem-illustrator-geo';

const UNITS: { id: string; name: string; pt: number }[] = [
  { id: 'in', name: 'in', pt: 72 },
  { id: 'cm', name: 'cm', pt: 72 / 2.54 },
  { id: 'mm', name: 'mm', pt: 72 / 25.4 },
  { id: 'pt', name: 'pt', pt: 1 },
  // pixels at 96 per inch, as screens and Canva count them
  { id: 'px', name: 'px', pt: 0.75 },
];

const round = (v: number) => String(Math.round(v * 100) / 100);

/** A size written in inches and centimetres, for the page-size list. */
export function sizeLabel(s: SlideSize): string {
  return `${round(s.w / 72)} × ${round(s.h / 72)} in, ${round((s.w / 72) * 2.54)} × ${round((s.h / 72) * 2.54)} cm`;
}

/**
 * The page-size window: the journals' TOC and graphical-abstract sizes, posters, slides and paper,
 * or any size typed in the unit you like. Resolves with the size in points, or null when cancelled.
 */
export function pickDesignSize(title: string, current?: SlideSize): Promise<SlideSize | null> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'ask design-size';
    const form = document.createElement('form');
    const h = document.createElement('h2');
    h.textContent = title;
    const list = document.createElement('div');
    list.className = 'ds-list';
    list.setAttribute('role', 'radiogroup');
    let chosen = current ? DESIGN_SIZES.find((s) => s.size.w === current.w && s.size.h === current.h)?.id ?? 'custom' : 'toc-acs';
    let group = '';
    for (const s of DESIGN_SIZES) {
      if (s.group !== group) {
        group = s.group;
        const g = document.createElement('h3');
        g.textContent = group;
        list.append(g);
      }
      list.append(choice(s.id, s.name, sizeLabel(s.size)));
    }
    const g = document.createElement('h3');
    g.textContent = 'Your own';
    list.append(g, choice('custom', 'Custom size', ''));

    const custom = document.createElement('div');
    custom.className = 'ds-custom';
    const w = num('Width'), hh = num('Height');
    const unit = document.createElement('select');
    unit.setAttribute('aria-label', 'Unit');
    for (const u of UNITS) unit.add(new Option(u.name, u.id));
    unit.value = 'in';
    let unitPt = 72;
    const start = current ?? DESIGN_SIZES[0].size;
    w.input.value = round(start.w / unitPt);
    hh.input.value = round(start.h / unitPt);
    unit.addEventListener('change', () => {
      const next = UNITS.find((u) => u.id === unit.value)!.pt;
      for (const f of [w.input, hh.input]) {
        const v = parseFloat(f.value);
        if (isFinite(v)) f.value = round((v * unitPt) / next);
      }
      unitPt = next;
    });
    for (const f of [w.input, hh.input]) f.addEventListener('input', () => pick('custom'));
    custom.append(w.label, hh.label, unit);

    const status = document.createElement('p');
    status.className = 'name-status';
    status.setAttribute('role', 'status');
    const buttons = document.createElement('p');
    buttons.className = 'ask-buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'primary';
    ok.textContent = 'OK';
    buttons.append(cancel, ok);
    form.append(h, list, custom, status, buttons);
    d.append(form);

    function choice(id: string, name: string, detail: string): HTMLLabelElement {
      const l = document.createElement('label');
      l.className = 'ds-item';
      const r = document.createElement('input');
      r.type = 'radio';
      r.name = 'design-size';
      r.value = id;
      r.checked = id === chosen;
      r.addEventListener('change', () => pick(id));
      const t = document.createElement('span');
      t.textContent = name;
      const s = document.createElement('span');
      s.className = 'muted';
      s.textContent = detail;
      l.append(r, t, s);
      return l;
    }
    function num(name: string): { label: HTMLLabelElement; input: HTMLInputElement } {
      const label = document.createElement('label');
      label.textContent = `${name} `;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = 'any';
      input.className = 'ds-num';
      label.append(input);
      return { label, input };
    }
    function pick(id: string): void {
      chosen = id;
      for (const r of list.querySelectorAll<HTMLInputElement>('input[type=radio]')) r.checked = r.value === id;
      custom.classList.toggle('active', id === 'custom');
    }
    pick(chosen);

    let result: SlideSize | null = null;
    const close = () => { if (d.open) d.close(); d.remove(); resolve(result); };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (chosen !== 'custom') {
        result = { ...DESIGN_SIZES.find((s) => s.id === chosen)!.size };
        close();
        return;
      }
      const ww = parseFloat(w.input.value) * unitPt, hp = parseFloat(hh.input.value) * unitPt;
      // PowerPoint takes pages from 1 to 56 inches a side
      if (!(ww >= 72 && hp >= 72 && ww <= 4032 && hp <= 4032)) {
        status.textContent = 'Each side must be between 1 and 56 inches (2.54 to 142 cm), the sizes PowerPoint can open.';
        status.classList.add('error');
        return;
      }
      result = { w: Math.round(ww * 10) / 10, h: Math.round(hp * 10) / 10 };
      close();
    });
    cancel.addEventListener('click', close);
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    document.body.append(d);
    d.showModal();
    (list.querySelector<HTMLInputElement>('input:checked') ?? ok).focus();
  });
}

/** Draws a shape's picture for the library. */
export function drawGeoIcon(c: HTMLCanvasElement, def: GeoDef, px: number, colour: string): void {
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(px * dpr);
  c.height = Math.round(px * dpr);
  c.style.width = c.style.height = `${px}px`;
  const g = c.getContext('2d');
  if (!g) return;
  g.scale(dpr, dpr);
  const pad = 3, room = px - 2 * pad;
  const [sw, sh] = def.size;
  const k = room / Math.max(sw, sh);
  const w = sw * k, h = sh * k;
  g.translate(pad + (room - w) / 2, pad + (room - h) / 2);
  const o = def.draw(w, h);
  g.lineWidth = 1.2;
  g.lineJoin = 'round';
  g.strokeStyle = colour;
  g.beginPath();
  traceSteps(g, o.body);
  if (!def.outline) {
    g.fillStyle = 'rgba(123, 63, 191, 0.14)';
    g.fill();
  }
  g.stroke();
  if (o.lines?.length) {
    g.beginPath();
    traceSteps(g, o.lines);
    g.stroke();
  }
}

/** The shape library on the left of Design mode. */
export class DesignLibrary {
  private search: HTMLInputElement;
  private body: HTMLDivElement;
  private active = '';

  constructor(private el: HTMLElement, private pick: (id: string) => void) {
    el.classList.add('design-lib');
    const head = document.createElement('div');
    head.className = 'dl-head';
    const h = document.createElement('h2');
    h.textContent = 'Shapes';
    this.search = document.createElement('input');
    this.search.type = 'search';
    this.search.placeholder = 'Find a shape (e.g. flask, decision)';
    this.search.setAttribute('aria-label', 'Find a shape');
    this.search.addEventListener('input', () => this.build());
    const tip = document.createElement('p');
    tip.className = 'muted small';
    tip.textContent = 'Click a shape, then click or drag on the page. Or drag it onto the page.';
    head.append(h, this.search, tip);
    this.body = document.createElement('div');
    this.body.className = 'dl-body';
    el.replaceChildren(head, this.body);
    this.build();
  }

  /** Marks the shape whose tool is in use (or none). */
  setActive(tool: string): void {
    this.active = tool.startsWith('geo:') ? tool.slice(4) : '';
    for (const b of this.body.querySelectorAll<HTMLButtonElement>('.dl-shape')) b.classList.toggle('active', b.dataset.geo === this.active);
  }

  focusSearch(): void {
    this.search.focus();
    this.search.select();
  }

  private build(): void {
    const words = this.search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const found = GEOS.filter((g) => {
      const text = `${g.name} ${g.group} ${g.keywords ?? ''} ${g.id}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
    const colour = getComputedStyle(this.el).getPropertyValue('--fg').trim() || '#222';
    const parts: HTMLElement[] = [];
    for (const group of GEO_GROUPS) {
      const inGroup = found.filter((g) => g.group === group);
      if (!inGroup.length) continue;
      const h = document.createElement('h3');
      h.textContent = group;
      const grid = document.createElement('div');
      grid.className = 'dl-grid';
      for (const def of inGroup) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'dl-shape';
        b.dataset.geo = def.id;
        b.title = def.name;
        b.setAttribute('aria-label', def.name);
        b.draggable = true;
        b.classList.toggle('active', def.id === this.active);
        const c = document.createElement('canvas');
        drawGeoIcon(c, def, 34, colour);
        b.append(c);
        b.addEventListener('click', () => this.pick(def.id));
        b.addEventListener('dragstart', (e) => {
          e.dataTransfer?.setData(GEO_DRAG_TYPE, def.id);
          e.dataTransfer?.setData('text/plain', def.name);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
        });
        grid.append(b);
      }
      parts.push(h, grid);
    }
    if (!parts.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No shape has that name.';
      parts.push(p);
    }
    this.body.replaceChildren(...parts);
  }
}
