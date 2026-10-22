// The ruler above the pages (View > Ruler), as Word's: inches from the left margin, the margins
// grey, and the paragraph's indents and tab stops to drag. The top triangle is the first line's
// indent, the bottom one the other lines' (the hanging indent), the box under it moves both, and
// the triangle at the right is the right indent. Click the ruler to put a tab stop there, of the
// kind the button at the left shows (left, centre, right or decimal: click it for the next);
// drag a tab stop to move it, or down off the ruler to take it away.

import type { ParaStyle, TabStop } from '../model';
import { DEFAULT_TAB } from '../text/layout';

/** Where the paragraph the caret is in sits on screen. */
export interface RulerGeometry {
  /** The column's left and right edges, and the page's, in pixels across the ruler. */
  colLeft: number;
  colRight: number;
  pageLeft: number;
  pageRight: number;
  /** Pixels to a point. */
  zoom: number;
  para: ParaStyle;
}

export interface RulerHost {
  geometry(): RulerGeometry | null;
  /** Change the selected paragraphs (one undo step). */
  setParas(patch: Partial<ParaStyle>, what: string): void;
  focus(): void;
}

/** Whether the ruler shows (kept in the settings); `changed` saves it. */
export const docRulerPrefs: { shown: boolean; changed?: () => void } = { shown: false };

const KINDS: TabStop['kind'][] = ['left', 'center', 'right', 'decimal'];
const KIND_MARK: Record<TabStop['kind'], string> = { left: 'L', center: '⊥', right: '⅃', decimal: '⊥.' };
const KIND_NAME: Record<TabStop['kind'], string> = { left: 'Left tab', center: 'Centre tab', right: 'Right tab', decimal: 'Decimal tab' };
/** Indents and tab stops land on sixteenths of an inch (hold Alt to place them freely). */
const SNAP = 72 / 16;
const H = 24;

type Grip = { kind: 'first' | 'hang' | 'left' | 'right' } | { kind: 'tab'; i: number };

export class Ruler {
  private canvas: HTMLCanvasElement;
  private kindBtn: HTMLButtonElement;
  private tabKind: TabStop['kind'] = 'left';
  private drag: { grip: Grip; x: number; off: boolean; free: boolean } | null = null;
  private geo: RulerGeometry | null = null;

  constructor(readonly el: HTMLElement, private host: RulerHost) {
    this.canvas = document.createElement('canvas');
    this.kindBtn = document.createElement('button');
    this.kindBtn.type = 'button';
    this.kindBtn.className = 'ruler-tab-kind';
    this.showKind();
    this.kindBtn.addEventListener('mousedown', (e) => e.preventDefault());
    this.kindBtn.addEventListener('click', () => {
      this.tabKind = KINDS[(KINDS.indexOf(this.tabKind) + 1) % KINDS.length];
      this.showKind();
    });
    el.append(this.canvas, this.kindBtn);
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.moveTo(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', () => { this.drag = null; this.paint(); });
    this.canvas.addEventListener('mousemove', (e) => { if (!this.drag) this.canvas.title = this.tipAt(e.offsetX, e.offsetY); });
    new ResizeObserver(() => this.paint()).observe(el);
  }

  get shown(): boolean {
    return !this.el.hidden;
  }

  set shown(on: boolean) {
    this.el.hidden = !on;
    if (on) this.update();
  }

  private showKind(): void {
    this.kindBtn.textContent = KIND_MARK[this.tabKind];
    this.kindBtn.title = `${KIND_NAME[this.tabKind]}: click the ruler to put one there (click this for the next kind of tab)`;
  }

  /** The caret moved, or the view scrolled or zoomed. */
  update(): void {
    if (this.el.hidden || this.drag) return;
    this.geo = this.host.geometry();
    this.paint();
  }

  // ---------------------------------------------------------------- where things are

  /** A paragraph's indents and tab stops as they are, or as being dragged. */
  private marks(): { first: number; left: number; right: number; tabs: TabStop[] } {
    const g = this.geo!;
    const p = g.para;
    const left = p.indent ?? 0;
    const out = { first: left + (p.list ? 0 : p.firstLine ?? 0), left, right: p.indentRight ?? 0, tabs: [...(p.tabs ?? [])] };
    const d = this.drag;
    if (!d) return out;
    const pt = this.ptAt(d.x, d.free);
    const width = (g.colRight - g.colLeft) / g.zoom;
    switch (d.grip.kind) {
      case 'first': out.first = Math.max(0, Math.min(width - out.right - 9, pt)); break;
      case 'hang': out.left = Math.max(0, Math.min(width - out.right - 9, pt)); break;
      case 'left': { const dd = Math.max(-Math.min(out.left, out.first), Math.min(width - out.right - 9, pt) - left); out.left += dd; out.first += dd; break; }
      case 'right': out.right = Math.max(0, Math.min(width - Math.max(out.left, out.first) - 9, width - pt)); break;
      case 'tab': if (d.off) out.tabs.splice(d.grip.i, 1); else out.tabs[d.grip.i] = { ...out.tabs[d.grip.i], pos: Math.max(1, Math.min(width, pt)) }; break;
    }
    return out;
  }

  /** Points from the left margin at an x across the ruler. */
  private ptAt(x: number, free: boolean): number {
    const g = this.geo!;
    const pt = (x - g.colLeft) / g.zoom;
    return free ? Math.round(pt * 100) / 100 : Math.round(pt / SNAP) * SNAP;
  }

  private xAt(pt: number): number {
    return this.geo!.colLeft + pt * this.geo!.zoom;
  }

  private gripAt(x: number, y: number): Grip | null {
    if (!this.geo) return null;
    const m = this.marks();
    const near = (pt: number) => Math.abs(this.xAt(pt) - x) <= 5;
    const width = (this.geo.colRight - this.geo.colLeft) / this.geo.zoom;
    if (y <= 9 && near(m.first)) return { kind: 'first' };
    if (y > 9 && y <= 16 && near(m.left)) return { kind: 'hang' };
    if (y > 16 && near(m.left)) return { kind: 'left' };
    if (y > 9 && near(width - m.right)) return { kind: 'right' };
    const i = m.tabs.findIndex((t) => near(t.pos));
    if (i >= 0 && y > 8) return { kind: 'tab', i };
    return null;
  }

  private tipAt(x: number, y: number): string {
    const g = this.gripAt(x, y);
    if (!g) return 'Click to put a tab stop here (the button at the left chooses which kind)';
    switch (g.kind) {
      case 'first': return 'First Line Indent';
      case 'hang': return 'Hanging Indent';
      case 'left': return 'Left Indent (moves the first line with it)';
      case 'right': return 'Right Indent';
      case 'tab': return `${KIND_NAME[this.marks().tabs[g.i].kind]}: drag to move it, or down off the ruler to take it away`;
    }
  }

  // ---------------------------------------------------------------- dragging

  private down(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.geo = this.host.geometry();
    if (!this.geo) return;
    e.preventDefault();
    let grip = this.gripAt(e.offsetX, e.offsetY);
    if (!grip) {
      // a new tab stop where the ruler was clicked (inside the text's width)
      const pt = this.ptAt(e.offsetX, e.altKey);
      const width = (this.geo.colRight - this.geo.colLeft) / this.geo.zoom;
      if (pt <= 0 || pt > width) return;
      const tabs = [...(this.geo.para.tabs ?? []), { pos: pt, kind: this.tabKind }];
      this.geo = { ...this.geo, para: { ...this.geo.para, tabs } };
      grip = { kind: 'tab', i: tabs.length - 1 };
    }
    this.drag = { grip, x: e.offsetX, off: false, free: e.altKey };
    this.canvas.setPointerCapture(e.pointerId);
    this.paint();
  }

  private moveTo(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    d.x = e.offsetX;
    d.free = e.altKey;
    d.off = d.grip.kind === 'tab' && e.offsetY > H + 14;
    this.paint();
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    if (!d || !this.geo) return;
    d.x = e.offsetX;
    const m = this.marks();
    this.drag = null;
    const p = this.geo.para;
    switch (d.grip.kind) {
      case 'first': case 'hang': case 'left': {
        const firstLine = m.first - m.left;
        this.host.setParas(p.list ? { indent: m.left || undefined } : { indent: m.left || undefined, firstLine: Math.abs(firstLine) < 0.01 ? undefined : firstLine }, 'indent');
        break;
      }
      case 'right': this.host.setParas({ indentRight: m.right || undefined }, 'indent'); break;
      case 'tab': {
        // stops in order, none on top of another
        const tabs = m.tabs.sort((a, b) => a.pos - b.pos).filter((t, i, all) => i === 0 || Math.abs(t.pos - all[i - 1].pos) > 0.5);
        this.host.setParas({ tabs: tabs.length ? tabs : undefined }, 'tabs');
        break;
      }
    }
    this.host.focus();
    this.update();
  }

  // ---------------------------------------------------------------- drawing

  private paint(): void {
    const c = this.canvas;
    const w = this.el.clientWidth, dpr = window.devicePixelRatio || 1;
    if (!w) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(H * dpr); }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(this.el);
    ctx.clearRect(0, 0, w, H);
    const g = this.geo;
    if (!g) return;
    // the paper: grey margins, white where the text goes
    ctx.fillStyle = '#e4e6ea';
    ctx.fillRect(g.pageLeft, 3, g.pageRight - g.pageLeft, H - 6);
    ctx.fillStyle = '#fff';
    ctx.fillRect(g.colLeft, 3, g.colRight - g.colLeft, H - 6);
    ctx.strokeStyle = '#b8bcc4';
    ctx.lineWidth = 1;
    ctx.strokeRect(g.pageLeft + 0.5, 3.5, g.pageRight - g.pageLeft - 1, H - 7);
    // inches from the left margin, with eighths
    ctx.fillStyle = css.getPropertyValue('--muted') || '#677084';
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const step = 9 * g.zoom;
    const from = Math.ceil((g.pageLeft - g.colLeft) / step), to = Math.floor((g.pageRight - g.colLeft) / step);
    for (let k = from; k <= to; k++) {
      const x = Math.round(g.colLeft + k * step) + 0.5;
      if (k % 8 === 0) { if (k) ctx.fillText(String(Math.abs(k / 8)), x, 15); }
      else ctx.fillRect(x - 0.5, k % 4 === 0 ? 9 : k % 2 === 0 ? 11 : 12, 1, k % 4 === 0 ? 6 : k % 2 === 0 ? 3 : 1.5);
    }
    const m = this.marks();
    const width = (g.colRight - g.colLeft) / g.zoom;
    // Word's default tab stops, after the last of the paragraph's own
    const last = Math.max(0, ...m.tabs.map((t) => t.pos));
    ctx.fillStyle = '#9aa0aa';
    for (let pt = (Math.floor(last / DEFAULT_TAB) + 1) * DEFAULT_TAB; pt < width; pt += DEFAULT_TAB) ctx.fillRect(Math.round(this.xAt(pt)), H - 4, 1, 2);
    // the tab stops
    ctx.strokeStyle = '#1d2330';
    ctx.lineWidth = 1.5;
    m.tabs.forEach((t, i) => {
      const x = Math.round(this.xAt(t.pos)) + 0.5;
      const ghost = this.drag?.grip.kind === 'tab' && this.drag.grip.i === i && this.drag.off;
      ctx.globalAlpha = ghost ? 0.3 : 1;
      ctx.beginPath();
      const y = H - 5;
      if (t.kind === 'left') { ctx.moveTo(x, y - 7); ctx.lineTo(x, y); ctx.lineTo(x + 5, y); }
      else if (t.kind === 'right') { ctx.moveTo(x, y - 7); ctx.lineTo(x, y); ctx.lineTo(x - 5, y); }
      else { ctx.moveTo(x, y - 7); ctx.lineTo(x, y); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); }
      ctx.stroke();
      if (t.kind === 'decimal') ctx.fillRect(x + 2, y - 4, 1.6, 1.6);
      ctx.globalAlpha = 1;
    });
    // the indents: first line (top), hanging (bottom) with the box under it, right
    const tri = (x: number, down: boolean, y: number) => {
      ctx.beginPath();
      if (down) { ctx.moveTo(x - 4.5, y); ctx.lineTo(x + 4.5, y); ctx.lineTo(x, y + 5); }
      else { ctx.moveTo(x - 4.5, y); ctx.lineTo(x + 4.5, y); ctx.lineTo(x, y - 5); }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };
    ctx.fillStyle = '#f4f5f7';
    ctx.strokeStyle = '#4a5160';
    ctx.lineWidth = 1;
    tri(Math.round(this.xAt(m.first)) + 0.5, true, 2.5);
    const lx = Math.round(this.xAt(m.left)) + 0.5;
    tri(lx, false, 16.5);
    ctx.fillRect(lx - 4.5, 17, 9, 5);
    ctx.strokeRect(lx - 4.5, 17, 9, 5);
    tri(Math.round(this.xAt(width - m.right)) + 0.5, false, 16.5);
    // a line down from what is being dragged
    if (this.drag && !this.drag.off) {
      ctx.strokeStyle = 'rgba(40, 90, 200, 0.6)';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(this.drag.x + 0.5, 0);
      ctx.lineTo(this.drag.x + 0.5, H);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}
