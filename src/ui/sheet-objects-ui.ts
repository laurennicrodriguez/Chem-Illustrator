// Sheet mode's pictures, shapes and text boxes: Insert > Pictures, Shapes and Text Box, typing
// in a shape, the right-click menu, Format Shape, and the panel shown while one is picked.

import { popupMenu } from './sheet-view';
import type { SheetView } from './sheet-view';
import { ask } from './ask';
import type { Sheet } from '../sheet/workbook';
import { SheetObject, ShapeKind, SHAPE_NAMES, newObjectId, objectLook, isLine } from '../sheet/sheet-objects';
import { dataUrl, imageSize, webpToPng } from '../render/images';

export interface ObjectsHost {
  readonly view: SheetView;
  /** One undoable change to the sheet showing. */
  edit(label: string, fn: (s: Sheet) => void): void;
  flash(msg: string, ms?: number): void;
  /** Ask for a picture file. */
  pickPicture?(): Promise<{ bytes: Uint8Array; mime: string; name: string } | null>;
}

/** The shapes offered on Insert > Shapes, in the order of Excel's gallery. */
export const SHAPE_MENU: ShapeKind[][] = [
  ['line', 'arrow'],
  ['rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star5'],
  ['rightArrow', 'leftArrow', 'upArrow', 'downArrow'],
];

/** Pictures the sheet keeps as they are (Excel shows these); others are turned into PNG. */
const KEPT = new Set(['image/png', 'image/jpeg', 'image/gif']);

export class SheetObjects {
  private typing: HTMLTextAreaElement | null = null;

  constructor(private host: ObjectsHost) {}

  private get view(): SheetView { return this.host.view; }
  private get sheet(): Sheet { return this.view.sheet!; }
  get picked(): SheetObject | null { return this.view.selectedObject; }

  /** Put a new object on the sheet and pick it. */
  private add(o: SheetObject, label: string): void {
    this.host.edit(label, (s) => s.setObjects([...s.objects, o]));
    this.view.pickObject(o.id);
  }

  async insertPicture(): Promise<void> {
    if (!this.host.pickPicture) return;
    const s = this.sheet;
    const pic = await this.host.pickPicture();
    if (!pic || this.view.sheet !== s) return;
    let { bytes, mime } = pic;
    if (!KEPT.has(mime)) {
      const png = mime === 'image/webp' ? await webpToPng(bytes) : await toPng(bytes, mime);
      if (!png) { this.host.flash(`${pic.name} can't be put on a sheet (Excel shows PNG, JPEG and GIF pictures).`, 6000); return; }
      bytes = png; mime = 'image/png';
    }
    const size = imageSize(bytes, mime) ?? { w: 320, h: 240 };
    // as large as it is, up to about half a screen of cells
    const k = Math.min(1, 480 / size.w, 360 / size.h);
    const o: SheetObject = { id: newObjectId(), kind: 'picture', at: this.view.newObjectPlace(), w: Math.round(size.w * k), h: Math.round(size.h * k), src: dataUrl(bytes, mime), name: pic.name.replace(/\.[^.]+$/, '') };
    this.add(o, 'Insert picture');
    this.host.flash('Drag the picture to move it, its corners to size it. Right-click for Alt Text.');
  }

  insertShape(kind: ShapeKind): void {
    const line = kind === 'line' || kind === 'arrow';
    const o: SheetObject = { id: newObjectId(), kind: 'shape', shape: kind, at: this.view.newObjectPlace(), w: line ? 120 : 110, h: line ? 0 : 70 };
    if (line) o.h = 40;
    this.add(o, `Insert ${SHAPE_NAMES[kind].toLowerCase()}`);
    if (!line) this.host.flash('Type to put text in the shape (or double-click it). Format Shape changes its colours.');
  }

  insertTextBox(): void {
    const o: SheetObject = { id: newObjectId(), kind: 'text', shape: 'rect', at: this.view.newObjectPlace(), w: 180, h: 60, text: '' };
    this.add(o, 'Insert text box');
    this.editText(o.id);
  }

  shapesMenu(x: number, y: number): void {
    document.querySelector('.popup-menu')?.remove();
    const m = document.createElement('div');
    m.className = 'menu popup-menu shape-gallery';
    m.setAttribute('role', 'menu');
    const heads = ['Lines', 'Basic shapes', 'Block arrows'];
    SHAPE_MENU.forEach((row, i) => {
      const h = document.createElement('div');
      h.className = 'shape-gallery-head';
      h.textContent = heads[i];
      const grid = document.createElement('div');
      grid.className = 'shape-gallery-row';
      for (const k of row) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.title = SHAPE_NAMES[k];
        b.setAttribute('aria-label', SHAPE_NAMES[k]);
        b.innerHTML = shapeIcon(k);
        b.addEventListener('click', () => { m.remove(); this.insertShape(k); });
        grid.append(b);
      }
      m.append(h, grid);
    });
    document.body.append(m);
    const r = m.getBoundingClientRect();
    m.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
    m.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof PointerEvent && m.contains(e.target as Node)) return;
      m.remove();
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', close, true);
    };
    setTimeout(() => { document.addEventListener('pointerdown', close, true); document.addEventListener('keydown', close, true); });
    m.querySelector<HTMLButtonElement>('button')?.focus();
  }

  /** Type in a shape or text box, in a box over it (Esc or a click elsewhere ends it). */
  editText(id: number): void {
    const o = this.sheet.objects.find((x) => x.id === id);
    if (!o || o.kind === 'picture' || isLine(o)) return;
    this.typing?.remove();
    const b = this.view.chartBox(o);
    const host = this.view.scroller.getBoundingClientRect();
    const z = this.view.zoom;
    const ta = document.createElement('textarea');
    ta.className = 'sh-object-text';
    ta.value = o.text ?? '';
    ta.spellcheck = true;
    ta.setAttribute('aria-label', 'Text in the shape');
    const look = objectLook(o);
    Object.assign(ta.style, {
      left: `${host.left + b.x}px`, top: `${host.top + b.y}px`, width: `${b.w}px`, height: `${b.h}px`,
      font: `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${(((o.size ?? 11) * 96) / 72) * z}px ${o.font ? `"${o.font}", ` : ''}Calibri, Carlito, Arial, sans-serif`,
      textAlign: o.align ?? (o.kind === 'text' ? 'left' : 'center'),
      color: look.color, background: look.fill === 'none' ? 'rgba(255,255,255,0.85)' : look.fill,
    });
    document.body.append(ta);
    this.typing = ta;
    ta.focus();
    ta.select();
    let done = false;
    const finish = (keep: boolean) => {
      if (done) return;
      done = true;
      ta.remove();
      if (this.typing === ta) this.typing = null;
      const cur = this.view.sheet?.objects.find((x) => x.id === id);
      const text = ta.value.replace(/\s+$/, '');
      if (keep && cur && text !== (cur.text ?? '')) this.view.replaceObject({ ...cur, text: text || undefined }, o.kind === 'text' ? 'Type in text box' : 'Type in shape');
      this.view.focus();
    };
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); finish(true); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(true); }
    });
    ta.addEventListener('blur', () => finish(true));
  }

  /** A key typed while an object is picked: letters start typing in a shape, as in Excel. */
  typeInto(o: SheetObject, key: string): boolean {
    if (o.kind === 'picture' || isLine(o) || key.length !== 1) return false;
    this.editText(o.id);
    if (this.typing) { this.typing.value = key; this.typing.setSelectionRange(1, 1); }
    return true;
  }

  /** Format Shape (or Picture): colours, line, text and placement, in one window. */
  async format(o = this.picked): Promise<void> {
    if (!o) return;
    const look = objectLook(o);
    const pic = o.kind === 'picture', line = isLine(o);
    const fields = [
      ...(!pic && !line ? [
        { name: 'fill', label: 'Fill colour', value: look.fill === 'none' ? '#ffffff' : look.fill, type: 'color' as const },
        { name: 'noFill', label: 'No fill', value: String(look.fill === 'none'), type: 'checkbox' as const },
      ] : []),
      { name: 'line', label: pic ? 'Border colour' : 'Line colour', value: look.line === 'none' ? '#000000' : look.line, type: 'color' as const },
      { name: 'noLine', label: pic ? 'No border' : 'No line', value: String(look.line === 'none'), type: 'checkbox' as const },
      { name: 'lineW', label: 'Line width', value: String(look.lineW), type: 'number' as const, unit: 'pt' },
      ...(!pic && !line ? [
        { name: 'size', label: 'Text size', value: String(o.size ?? 11), type: 'number' as const, unit: 'pt' },
        { name: 'color', label: 'Text colour', value: look.color, type: 'color' as const },
        { name: 'bold', label: 'Bold', value: String(!!o.bold), type: 'checkbox' as const },
        { name: 'italic', label: 'Italic', value: String(!!o.italic), type: 'checkbox' as const },
        { name: 'align', label: 'Text across', value: o.align ?? (o.kind === 'text' ? 'left' : 'center'), options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }] },
        { name: 'valign', label: 'Text up and down', value: o.valign ?? (o.kind === 'text' ? 'top' : 'middle'), options: [{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }] },
      ] : []),
      { name: 'w', label: 'Width', value: String(o.w), type: 'number' as const, unit: 'px' },
      { name: 'h', label: 'Height', value: String(o.h), type: 'number' as const, unit: 'px' },
      ...(!line ? [{ name: 'rot', label: 'Rotation', value: String(o.rot ?? 0), type: 'number' as const, unit: '°' }] : []),
      { name: 'placement', label: 'When cells change size', value: o.placement ?? (pic ? 'oneCell' : 'twoCell'), options: [
        { value: 'twoCell', label: 'Move and size with cells' }, { value: 'oneCell', label: 'Move but don\'t size with cells' }, { value: 'absolute', label: 'Don\'t move or size with cells' },
      ] },
      { name: 'descr', label: 'Alt text', value: o.descr ?? '', type: 'textarea' as const, placeholder: 'What it shows, for screen readers' },
    ];
    const got = await ask(pic ? 'Format Picture' : o.kind === 'text' ? 'Format Text Box' : 'Format Shape', fields, { ok: 'Apply' });
    const cur = this.view.sheet?.objects.find((x) => x.id === o.id);
    if (!got || !cur) return;
    const n = (v: string | undefined, d: number, lo: number, hi: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
    const next: SheetObject = { ...cur };
    const dflt = objectLook({ ...cur, fill: undefined, line: undefined, lineW: undefined, color: undefined });
    const put = <K extends keyof SheetObject>(k: K, v: SheetObject[K] | undefined, d?: unknown) => { if (v === undefined || v === d) delete next[k]; else next[k] = v; };
    if ('fill' in got) put('fill', got.noFill === 'true' ? 'none' : got.fill, dflt.fill);
    put('line', got.noLine === 'true' ? 'none' : got.line, dflt.line);
    put('lineW', n(got.lineW, dflt.lineW, 0, 20), dflt.lineW);
    if ('size' in got) {
      put('size', n(got.size, 11, 4, 200), 11);
      put('color', got.color, dflt.color);
      put('bold', got.bold === 'true' || undefined);
      put('italic', got.italic === 'true' || undefined);
      put('align', got.align as SheetObject['align'], cur.kind === 'text' ? 'left' : 'center');
      put('valign', got.valign as SheetObject['valign'], cur.kind === 'text' ? 'top' : 'middle');
    }
    next.w = Math.round(n(got.w, cur.w, 1, 5000));
    next.h = Math.round(n(got.h, cur.h, line ? 0 : 1, 5000));
    if ('rot' in got) put('rot', ((n(got.rot, 0, -3600, 3600) % 360) + 360) % 360 || undefined);
    put('placement', got.placement as SheetObject['placement'], pic ? 'oneCell' : 'twoCell');
    put('descr', got.descr.trim() || undefined);
    this.view.replaceObject(next, pic ? 'Format picture' : 'Format shape');
  }

  async altText(o = this.picked): Promise<void> {
    if (!o) return;
    const got = await ask('Alt Text', [{ name: 'descr', label: 'Description', value: o.descr ?? '', type: 'textarea', placeholder: 'What it shows, for people who can\'t see it' }], { ok: 'Save' });
    const cur = this.view.sheet?.objects.find((x) => x.id === o.id);
    if (!got || !cur) return;
    this.view.replaceObject({ ...cur, descr: got.descr.trim() || undefined }, 'Alt text');
  }

  /** Bring to Front (+1) or Send to Back (−1). */
  restack(dir: 1 | -1): void {
    const o = this.picked;
    if (!o) return;
    this.host.edit(dir > 0 ? 'Bring to front' : 'Send to back', (s) => {
      const rest = s.objects.filter((x) => x.id !== o.id);
      s.setObjects(dir > 0 ? [...rest, o] : [o, ...rest]);
    });
  }

  duplicate(): void {
    const o = this.picked;
    if (!o) return;
    const copy: SheetObject = { ...o, id: newObjectId(), at: { ...o.at, dx: o.at.dx + 12, dy: o.at.dy + 12 } };
    this.add(copy, 'Duplicate');
  }

  menuItems(): ([string, () => void, boolean?] | null)[] {
    const o = this.picked;
    if (!o) return [];
    const text = o.kind !== 'picture' && !isLine(o);
    return [
      ...(text ? [['Edit Text', () => this.editText(o.id)] as [string, () => void]] : []),
      [o.kind === 'picture' ? 'Format Picture…' : 'Format Shape…', () => void this.format(o)],
      ['Alt Text…', () => void this.altText(o)],
      null,
      ['Bring to Front', () => this.restack(1), this.sheet.objects.length > 1],
      ['Send to Back', () => this.restack(-1), this.sheet.objects.length > 1],
      ['Duplicate', () => this.duplicate()],
      null,
      [`Delete ${o.kind === 'picture' ? 'Picture' : o.kind === 'text' ? 'Text Box' : 'Shape'}`, () => this.view.deleteObject(o.id)],
    ];
  }

  contextMenu(x: number, y: number): void {
    popupMenu(x, y, this.menuItems());
  }

  /** The right-hand panel while an object is picked. */
  panel(o: SheetObject): HTMLElement[] {
    const para = (text: string, cls = '') => Object.assign(document.createElement('p'), { textContent: text, className: cls });
    const button = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', fn);
      return b;
    };
    const what = o.kind === 'picture' ? 'A picture' : o.kind === 'text' ? 'A text box' : `A ${SHAPE_NAMES[o.shape ?? 'rect'].toLowerCase()}`;
    const out: HTMLElement[] = [para(`${what}, ${Math.round(o.w)} × ${Math.round(o.h)} pixels, floating over the cells. Drag it to move it, its handles to size it; arrow keys nudge it.`)];
    if (o.descr) out.push(para(`Alt text: ${o.descr}`, 'muted'));
    const row = document.createElement('div');
    row.className = 'cp-buttons';
    if (o.kind !== 'picture' && !isLine(o)) row.append(button('Edit Text', () => this.editText(o.id)));
    row.append(button(o.kind === 'picture' ? 'Format Picture…' : 'Format Shape…', () => void this.format(o)), button('Alt Text…', () => void this.altText(o)), button('Delete', () => this.view.deleteObject(o.id)));
    out.push(row);
    out.push(para('Saved in .xlsx files as Excel\'s own pictures and shapes.', 'muted'));
    return out;
  }
}

/** An SVG or BMP turned into PNG by the browser (null when it can't be read). */
async function toPng(bytes: Uint8Array, mime: string): Promise<Uint8Array | null> {
  if (mime !== 'image/svg+xml' && mime !== 'image/bmp') return null;
  try {
    const img = new Image();
    img.src = dataUrl(bytes, mime);
    await img.decode();
    const w = img.naturalWidth || 320, h = img.naturalHeight || 240;
    // SVGs drawn at twice their size, to print sharply
    const k = mime === 'image/svg+xml' ? 2 : 1;
    const c = document.createElement('canvas');
    c.width = w * k; c.height = h * k;
    c.getContext('2d')!.drawImage(img, 0, 0, w * k, h * k);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** A small picture of a shape for the gallery. */
export function shapeIcon(k: ShapeKind): string {
  const d: Record<ShapeKind, string> = {
    line: '<path d="M3 17L17 3"/>', arrow: '<path d="M3 17L15 5"/><path d="M10 4h6v6" />',
    rect: '<rect x="3" y="5" width="14" height="10"/>', roundRect: '<rect x="3" y="5" width="14" height="10" rx="3"/>', ellipse: '<ellipse cx="10" cy="10" rx="7" ry="5.5"/>',
    triangle: '<path d="M10 3l7 14H3z"/>', diamond: '<path d="M10 2l8 8-8 8-8-8z"/>', pentagon: '<path d="M10 2.5l7.5 5.5-2.9 9H5.4l-2.9-9z"/>', hexagon: '<path d="M6 3h8l4 7-4 7H6l-4-7z"/>',
    star5: '<path d="M10 2l2.3 5.3 5.7.5-4.3 3.8 1.3 5.6L10 14.3 5 17.2l1.3-5.6L2 7.8l5.7-.5z"/>',
    rightArrow: '<path d="M2 7h9V3l7 7-7 7v-4H2z"/>', leftArrow: '<path d="M18 7H9V3l-7 7 7 7v-4h9z"/>', upArrow: '<path d="M7 18V9H3l7-7 7 7h-4v9z"/>', downArrow: '<path d="M7 2v9H3l7 7 7-7h-4V2z"/>',
  };
  return `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true">${d[k]}</svg>`;
}
