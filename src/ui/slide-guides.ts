// Slides' rulers, drawing guides and Grid and Guides window. The rulers run along the top and
// left of the slide area, counting from the slide's middle (as PowerPoint's do) or its top left,
// in inches or centimetres, with the selection's extent shaded on them. Drag down from the top
// ruler (or right from the left one) for a new guide. On the slide a guide is dragged where it
// is wanted (its place shown as it goes), Ctrl+drag copies it, and dragging it off the slide
// takes it away.

import type { SlideSize } from '../deck/deck';
import { GRID_SPACINGS, rulerSteps, rulerText, type RulerPrefs, type SlideView } from '../deck/guides';
import type { Rect } from '../geom';
import { ask } from './ask';

const R = 18;

export interface RulerHost {
  view(): { ox: number; oy: number; scale: number };
  size(): SlideSize | null;
  prefs(): RulerPrefs;
  /** The selection's box on the slide (shaded on the rulers). */
  selection(): Rect | null;
  /** A guide dragged out of a ruler: which way it runs and the pointer event that starts its drag. */
  newGuide(axis: 'x' | 'y', e: PointerEvent): void;
}

export class SlideRulers {
  private h: HTMLCanvasElement;
  private v: HTMLCanvasElement;
  private corner: HTMLDivElement;
  private key = '';
  shown = false;

  constructor(host: HTMLElement, private hooks: RulerHost) {
    this.h = document.createElement('canvas');
    this.h.className = 'slide-ruler slide-ruler-h';
    this.v = document.createElement('canvas');
    this.v.className = 'slide-ruler slide-ruler-v';
    this.corner = document.createElement('div');
    this.corner.className = 'slide-ruler-corner';
    for (const el of [this.h, this.v, this.corner]) { el.hidden = true; host.append(el); }
    this.h.title = 'Drag down for a guide across the slide';
    this.v.title = 'Drag across for a guide down the slide';
    this.h.addEventListener('pointerdown', (e) => { if (e.button === 0) { e.preventDefault(); this.hooks.newGuide('y', e); } });
    this.v.addEventListener('pointerdown', (e) => { if (e.button === 0) { e.preventDefault(); this.hooks.newGuide('x', e); } });
  }

  show(on: boolean): void {
    this.shown = on;
    for (const el of [this.h, this.v, this.corner]) el.hidden = !on;
    this.key = '';
    this.update();
  }

  /** Draw the rulers again if the view, slide or selection has changed. */
  update(): void {
    if (!this.shown) return;
    const size = this.hooks.size();
    if (!size) return;
    const v = this.hooks.view(), p = this.hooks.prefs(), sel = this.hooks.selection();
    const W = this.h.parentElement?.clientWidth ?? 0, H = this.h.parentElement?.clientHeight ?? 0;
    const key = JSON.stringify([v, size, p, sel, W, H]);
    if (key === this.key) return;
    this.key = key;
    this.paint(this.h, 'x', W - R, size, v, p, sel);
    this.paint(this.v, 'y', H - R, size, v, p, sel);
  }

  private paint(c: HTMLCanvasElement, axis: 'x' | 'y', len: number, size: SlideSize, v: { ox: number; oy: number; scale: number }, p: RulerPrefs, sel: Rect | null): void {
    const dpr = window.devicePixelRatio || 1;
    const across = axis === 'x';
    const w = across ? len : R, h = across ? R : len;
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(c);
    const ink = css.color || '#555', page = css.getPropertyValue('--ruler-page').trim() || '#ffffff', off = css.backgroundColor || '#e8e8e8';
    ctx.fillStyle = off;
    ctx.fillRect(0, 0, w, h);
    // screen position along the ruler of a point on the slide (the ruler starts R px in from the host's edge)
    const o = (across ? v.ox : v.oy) - R, k = v.scale;
    const at = (pt: number) => o + pt * k;
    const extent = across ? size.w : size.h;
    ctx.fillStyle = page;
    if (across) ctx.fillRect(at(0), 0, extent * k, h); else ctx.fillRect(0, at(0), w, extent * k);
    if (sel) {
      const a = across ? sel.x1 : sel.y1, b = across ? sel.x2 : sel.y2;
      ctx.fillStyle = 'rgba(80, 120, 200, 0.22)';
      if (across) ctx.fillRect(at(a), 0, (b - a) * k, h); else ctx.fillRect(0, at(a), w, (b - a) * k);
    }
    const zero = p.from === 'centre' ? extent / 2 : 0;
    const { major, minor } = rulerSteps(p, k);
    const unit = p.units === 'in' ? 72 : 72 / 2.54;
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 1;
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const first = Math.floor((-o / k - zero) / major) - 1, last = Math.ceil(((len - o) / k - zero) / major) + 1;
    ctx.beginPath();
    for (let i = first; i <= last; i++) {
      const base = zero + i * major;
      for (let j = 0; j < minor; j++) {
        const pt = base + (j * major) / minor, s = Math.round(at(pt)) + 0.5;
        if (s < 0 || s > len) continue;
        const tick = j === 0 ? 0 : j === minor / 2 ? R * 0.35 : R * 0.2;
        if (j === 0) continue;
        if (across) { ctx.moveTo(s, R - tick); ctx.lineTo(s, R); } else { ctx.moveTo(R - tick, s); ctx.lineTo(R, s); }
      }
      const s = at(base);
      if (s < -20 || s > len + 20) continue;
      const n = Math.abs(i * major) / unit;
      const label = Number.isInteger(+n.toFixed(3)) ? String(Math.round(n)) : n.toFixed(n < 1 ? 2 : 1).replace(/0+$/, '');
      if (across) ctx.fillText(label, s, R / 2);
      else { ctx.save(); ctx.translate(R / 2, s); ctx.rotate(-Math.PI / 2); ctx.fillText(label, 0, 0); ctx.restore(); }
    }
    ctx.stroke();
    // the edge next to the slide
    ctx.beginPath();
    if (across) { ctx.moveTo(0, R - 0.5); ctx.lineTo(w, R - 0.5); } else { ctx.moveTo(R - 0.5, 0); ctx.lineTo(R - 0.5, h); }
    ctx.globalAlpha = 0.4;
    ctx.stroke();
  }
}

/** A guide's place as it is dragged, shown beside the pointer. */
export class GuideTip {
  private el: HTMLDivElement;
  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'guide-tip';
    this.el.hidden = true;
    host.append(this.el);
  }
  show(text: string, x: number, y: number): void {
    this.el.textContent = text;
    this.el.hidden = false;
    this.el.style.left = `${x + 12}px`;
    this.el.style.top = `${y + 12}px`;
  }
  hide(): void { this.el.hidden = true; }
}

/** Draw the guides over the slide (on screen only): dashed, a little past the slide's edges. */
export function drawGuides(ctx: CanvasRenderingContext2D, view: SlideView, size: SlideSize, scale: number, moving?: { axis: 'x' | 'y'; i: number } | null): void {
  ctx.save();
  ctx.lineWidth = 1 / scale;
  ctx.setLineDash([4 / scale, 3 / scale]);
  const past = 24 / scale;
  view.guides.x.forEach((x, i) => {
    ctx.strokeStyle = moving?.axis === 'x' && moving.i === i ? 'rgba(200, 60, 40, 0.9)' : 'rgba(110, 110, 110, 0.85)';
    ctx.beginPath(); ctx.moveTo(x, -past); ctx.lineTo(x, size.h + past); ctx.stroke();
  });
  view.guides.y.forEach((y, i) => {
    ctx.strokeStyle = moving?.axis === 'y' && moving.i === i ? 'rgba(200, 60, 40, 0.9)' : 'rgba(110, 110, 110, 0.85)';
    ctx.beginPath(); ctx.moveTo(-past, y); ctx.lineTo(size.w + past, y); ctx.stroke();
  });
  ctx.restore();
}

/**
 * View > Grid and Guides: snap to the grid and its spacing, show the gridlines and guides,
 * smart guides, the rulers' units and where they count from; and add guides. Null when cancelled.
 */
export async function gridAndGuides(view: SlideView, shown: { grid: boolean; smart: boolean }, prefs: RulerPrefs, size: SlideSize): Promise<{ view: SlideView; grid: boolean; smart: boolean; prefs: RulerPrefs } | null> {
  const near = GRID_SPACINGS.reduce((a, b) => (Math.abs(b.pt - view.grid) < Math.abs(a.pt - view.grid) ? b : a));
  const custom = Math.abs(near.pt - view.grid) > 0.01;
  const v = await ask('Grid and Guides', [
    { name: 'snap', label: 'Snap objects to grid', value: String(view.snapToGrid), type: 'checkbox' },
    { name: 'spacing', label: 'Grid spacing', value: custom ? 'custom' : String(near.pt), options: [...GRID_SPACINGS.map((g) => ({ value: String(g.pt), label: g.name })), { value: 'custom', label: 'Other (below)' }] },
    { name: 'custom', label: 'Other spacing', value: custom ? String(+view.grid.toFixed(2)) : '', type: 'number', unit: 'pt' },
    { name: 'grid', label: 'Display grid on screen', value: String(shown.grid), type: 'checkbox' },
    { name: 'guides', label: 'Display drawing guides on screen', value: String(view.showGuides), type: 'checkbox' },
    { name: 'smart', label: 'Display smart guides when shapes are aligned', value: String(shown.smart), type: 'checkbox' },
    { name: 'addX', label: 'Add a vertical guide at', value: '', type: 'number', unit: prefs.units === 'in' ? 'in' : 'cm', help: `Measured as the rulers are, ${prefs.from === 'centre' ? 'from the middle of the slide (left is less than 0)' : 'from the slide\'s left edge'}.` },
    { name: 'addY', label: 'Add a horizontal guide at', value: '', type: 'number', unit: prefs.units === 'in' ? 'in' : 'cm', help: prefs.from === 'centre' ? 'From the middle (above is less than 0).' : 'From the top edge.' },
    { name: 'clear', label: 'Take away every guide', value: 'false', type: 'checkbox' },
    { name: 'units', label: 'Ruler units', value: prefs.units, options: [{ value: 'in', label: 'Inches' }, { value: 'cm', label: 'Centimetres' }] },
    { name: 'from', label: 'Rulers count from', value: prefs.from, options: [{ value: 'centre', label: 'The middle of the slide (as PowerPoint)' }, { value: 'corner', label: 'The top left corner' }] },
  ], { ok: 'OK', note: 'Hold Alt while dragging to place things freely. Drag a guide off the slide to take it away; Ctrl+drag a guide for a copy.' });
  if (!v) return null;
  const nextPrefs: RulerPrefs = { units: v.units === 'cm' ? 'cm' : 'in', from: v.from === 'corner' ? 'corner' : 'centre' };
  const spacing = v.spacing === 'custom' ? Number(v.custom) : Number(v.spacing);
  const next: SlideView = {
    guides: v.clear === 'true' ? { x: [], y: [] } : { x: [...view.guides.x], y: [...view.guides.y] },
    showGuides: v.guides === 'true',
    snapToGrid: v.snap === 'true',
    grid: spacing > 0.5 && spacing < 1000 ? spacing : view.grid,
  };
  // a guide typed in, in the units given, from where the rulers count
  const pt = (t: string, axis: 'x' | 'y') => {
    const n = Number(t);
    if (t.trim() === '' || !isFinite(n)) return null;
    const zero = nextPrefs.from === 'centre' ? (axis === 'x' ? size.w : size.h) / 2 : 0;
    return zero + n * (nextPrefs.units === 'in' ? 72 : 72 / 2.54);
  };
  const ax = pt(v.addX, 'x'), ay = pt(v.addY, 'y');
  if (ax !== null) { next.guides.x.push(ax); next.showGuides = true; }
  if (ay !== null) { next.guides.y.push(ay); next.showGuides = true; }
  return { view: next, grid: v.grid === 'true', smart: v.smart === 'true', prefs: nextPrefs };
}

export { rulerText };
