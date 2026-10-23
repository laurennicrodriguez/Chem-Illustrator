// Design mode's own parts: the window that picks a page size, and the shape library on the left
// (shapes and icons, searchable, in groups, each drawn as a small picture). Clicking a shape picks it as the
// tool (click or drag on the page to place it); a shape can also be dragged straight onto the page.

import { DESIGN_SIZES, SlideSize } from '../deck/deck';
import { GEOS, GEO_GROUPS, GeoDef, traceSteps } from '../design/geo';
import { ICON_CREDIT, findIcons, iconGroups, iconSvg, iconsLoaded, loadIcons, whenIconsLoaded } from '../design/icons';

/** The library's two tabs. */
export type LibraryTab = 'shapes' | 'icons';

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

/** The size of the enlarged picture shown while the mouse rests on a shape or icon. */
const PREVIEW_PX = 112;

let preview: HTMLDivElement | null = null;
let previewTimer = 0;

/** After a moment's rest on a tile, its picture enlarged beside it, with its name. */
function showPreview(tile: HTMLElement, name: string, big: () => HTMLElement | string): void {
  hidePreview();
  previewTimer = window.setTimeout(() => {
    if (!tile.isConnected) return;
    if (!preview) {
      preview = document.createElement('div');
      preview.className = 'dl-preview';
      preview.setAttribute('aria-hidden', 'true');
      document.body.append(preview);
    }
    const pic = document.createElement('div');
    pic.className = 'dl-preview-pic';
    const p = big();
    if (typeof p === 'string') pic.innerHTML = p;
    else pic.append(p);
    const label = document.createElement('div');
    label.className = 'dl-preview-name';
    label.textContent = name;
    preview.replaceChildren(pic, label);
    preview.hidden = false;
    // beside the tile, on whichever side has room, kept inside the window
    const r = tile.getBoundingClientRect(), w = preview.offsetWidth, h = preview.offsetHeight;
    const x = r.right + 8 + w <= innerWidth - 4 ? r.right + 8 : Math.max(4, r.left - 8 - w);
    const y = Math.min(Math.max(4, r.top + r.height / 2 - h / 2), innerHeight - 4 - h);
    preview.style.left = `${x}px`;
    preview.style.top = `${y}px`;
  }, 350);
}

function hidePreview(): void {
  clearTimeout(previewTimer);
  if (preview) preview.hidden = true;
}

/** How many icons are shown at a time (more with "Show more"). */
const ICON_PAGE = 160;

/**
 * The shape library: on the left of Design mode, and under Insert > Shapes and Insert > Icons in
 * Slides and Documents. Two tabs: the shapes (in groups) and the icons (a group at a time, or
 * found by name). Both are searched from the same box.
 */
export class DesignLibrary {
  private search: HTMLInputElement;
  private body: HTMLDivElement;
  private tabs: Record<LibraryTab, HTMLButtonElement>;
  private groupPick: HTMLSelectElement;
  private active = '';
  private tab: LibraryTab = 'shapes';
  /** The icon group chosen in the list ('' for all); searches look in it only once one is chosen. */
  private iconGroup = '';
  private groupChosen = false;
  private iconCount = ICON_PAGE;

  constructor(private el: HTMLElement, private pick: (id: string) => void) {
    el.classList.add('design-lib');
    const head = document.createElement('div');
    head.className = 'dl-head';
    const bar = document.createElement('div');
    bar.className = 'dl-tabs';
    bar.setAttribute('role', 'tablist');
    const tab = (id: LibraryTab, label: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.textContent = label;
      b.addEventListener('click', () => this.showTab(id));
      bar.append(b);
      return b;
    };
    this.tabs = { shapes: tab('shapes', 'Shapes'), icons: tab('icons', 'Icons') };
    this.search = document.createElement('input');
    this.search.type = 'search';
    this.search.addEventListener('input', () => { this.iconCount = ICON_PAGE; this.build(); });
    this.groupPick = document.createElement('select');
    this.groupPick.className = 'dl-group';
    this.groupPick.setAttribute('aria-label', 'Icon group');
    this.groupPick.addEventListener('change', () => {
      this.iconGroup = this.groupPick.value;
      this.groupChosen = true;
      this.iconCount = ICON_PAGE;
      this.build();
    });
    const tip = document.createElement('p');
    tip.className = 'muted small';
    tip.textContent = 'Click a shape, then click or drag on the page. Or drag it onto the page.';
    head.append(bar, this.search, this.groupPick, tip);
    this.body = document.createElement('div');
    this.body.className = 'dl-body';
    el.replaceChildren(head, this.body);
    whenIconsLoaded(() => this.fillGroups());
    this.showTab('shapes');
  }

  /** Show the shapes or the icons. */
  showTab(tab: LibraryTab): void {
    this.tab = tab;
    for (const [id, b] of Object.entries(this.tabs)) {
      b.setAttribute('aria-selected', String(id === tab));
      b.classList.toggle('active', id === tab);
    }
    const what = tab === 'icons' ? 'an icon (e.g. flask, atom, hazard)' : 'a shape (e.g. flask, decision)';
    this.search.placeholder = `Find ${what}`;
    this.search.setAttribute('aria-label', tab === 'icons' ? 'Find an icon' : 'Find a shape');
    this.groupPick.hidden = tab !== 'icons';
    if (tab === 'icons' && !iconsLoaded()) void loadIcons().then(() => this.build(), () => this.build());
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

  private fillGroups(): void {
    const groups = iconGroups();
    this.groupPick.replaceChildren(new Option('All icons', ''), ...groups.map((g) => new Option(g, g)));
    if (!this.groupChosen) this.iconGroup = groups[0] ?? '';
    this.groupPick.value = this.iconGroup;
    if (this.tab === 'icons') this.build();
  }

  private words(): string[] {
    return this.search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  }

  private build(): void {
    this.body.replaceChildren(...(this.tab === 'icons' ? this.iconParts() : this.shapeParts()));
  }

  /**
   * A button for a shape or icon: click to pick it, or drag it onto the page. Resting the mouse
   * on it shows `big`, the same picture enlarged, with its name (in place of a plain tooltip).
   */
  private tile(id: string, name: string, picture: HTMLElement | string, big: () => HTMLElement | string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dl-shape';
    b.dataset.geo = id;
    b.setAttribute('aria-label', name);
    b.addEventListener('pointerenter', () => showPreview(b, name, big));
    b.addEventListener('pointerleave', hidePreview);
    b.addEventListener('pointerdown', hidePreview);
    b.draggable = true;
    b.classList.toggle('active', id === this.active);
    if (typeof picture === 'string') b.innerHTML = picture;
    else b.append(picture);
    b.addEventListener('click', () => this.pick(id));
    b.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData(GEO_DRAG_TYPE, id);
      e.dataTransfer?.setData('text/plain', name);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
    });
    return b;
  }

  private shapeParts(): HTMLElement[] {
    const words = this.words();
    const found = GEOS.filter((g) => {
      const text = `${g.name} ${g.group} ${g.keywords ?? ''} ${g.id}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
    const colour = getComputedStyle(this.el).getPropertyValue('--tile-ink').trim() || '#222';
    const parts: HTMLElement[] = [];
    for (const group of GEO_GROUPS) {
      const inGroup = found.filter((g) => g.group === group);
      if (!inGroup.length) continue;
      const h = document.createElement('h3');
      h.textContent = group;
      const grid = document.createElement('div');
      grid.className = 'dl-grid';
      for (const def of inGroup) {
        const c = document.createElement('canvas');
        drawGeoIcon(c, def, 26, colour);
        grid.append(this.tile(def.id, def.name, c, () => {
          const large = document.createElement('canvas');
          drawGeoIcon(large, def, PREVIEW_PX, colour);
          return large;
        }));
      }
      parts.push(h, grid);
    }
    // the icons that match too, a click away
    const icons = words.length ? findIcons(words.join(' ')) : [];
    if (icons.length) parts.push(this.link(`${icons.length === 1 ? 'An icon matches' : `${icons.length.toLocaleString()} icons match`} too: show ${icons.length === 1 ? 'it' : 'them'}`, () => {
      this.iconGroup = '';
      this.groupChosen = false;
      this.groupPick.value = '';
      this.showTab('icons');
    }));
    if (!parts.length) parts.push(this.note('No shape has that name.'));
    return parts;
  }

  private iconParts(): HTMLElement[] {
    if (!iconsLoaded()) return [this.note('Loading the icons…')];
    const words = this.words();
    // typing looks through every icon, unless a group was chosen from the list
    const group = words.length && !this.groupChosen ? '' : this.iconGroup;
    if (group !== this.groupPick.value) this.groupPick.value = group;
    const found = findIcons(words.join(' '), group || undefined);
    const parts: HTMLElement[] = [];
    const h = document.createElement('h3');
    h.textContent = `${group || (words.length ? 'Found' : 'All icons')} · ${found.length.toLocaleString()}`;
    parts.push(h);
    if (!found.length) parts.push(this.note(group ? `No icon in ${group} has that name.` : 'No icon has that name.'));
    else {
      const grid = document.createElement('div');
      grid.className = 'dl-grid dl-icons';
      for (const i of found.slice(0, this.iconCount)) grid.append(this.tile(i.id, i.name, iconSvg(i.id, 26), () => iconSvg(i.id, PREVIEW_PX)));
      parts.push(grid);
      if (found.length > this.iconCount) parts.push(this.link(`Show more (${(found.length - this.iconCount).toLocaleString()} left)`, () => { this.iconCount += ICON_PAGE * 2; this.build(); }));
    }
    if (words.length && group) parts.push(this.link('Look in all the icons', () => { this.iconGroup = ''; this.groupChosen = true; this.build(); }));
    const credit = this.note(ICON_CREDIT);
    credit.classList.add('dl-credit');
    parts.push(credit);
    return parts;
  }

  private note(text: string): HTMLParagraphElement {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = text;
    return p;
  }

  private link(text: string, go: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dl-more';
    b.textContent = text;
    b.addEventListener('click', go);
    return b;
  }
}
