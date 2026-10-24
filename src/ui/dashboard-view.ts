// A dashboard sheet on screen: its tiles on a grid, each drawn from the workbook's tables with
// the slicers applied. Tiles are moved by dragging and resized by their corner, snapping to the
// grid; clicking slicer buttons, or a bar, slice or Sankey node or band of a chart, filters every
// tile fed by the same table (the chart clicked shows what it picked, the rest faded).

import type { Sheet, Workbook, Structure } from '../sheet/workbook';
import {
  Dashboard, Tile, KpiTile, TableTile, SlicerTile, GalleryTile, TextTile, ChartTile,
  resolveSource, filterMask, joinMasks, pickMask, shownRows, kpiValue, distinctValues, columnOf, slicerText, AGGREGATE_NAMES, sourceName, groupSeries,
} from '../sheet/dashboard';
import { chartData } from '../sheet/chart';
import { drawChart, partHit, samePick, type ChartHits } from '../render/chart-draw';
import { formatValue } from '../sheet/numfmt';
import { isError } from '../sheet/values';

export interface DashHost {
  readonly wb: Workbook | null;
  readonly zoom: number;
  structureBox(s: Structure): { w: number; h: number };
  /** A structure's picture: null when not made yet (a negative scale makes it now). */
  structureBitmap(s: Structure, scale: number): CanvasImageSource | null;
  /** One undoable change to the dashboard sheet. */
  setDashboard(d: Dashboard, label: string): void;
  /** The tile picked changed. */
  picked(): void;
  /** A tile was double-clicked (its settings). */
  open(tile: Tile): void;
  contextMenu(x: number, y: number): void;
  flash(msg: string, ms?: number): void;
  /** Keys the dashboard doesn't use (undo, save, switching tabs…): true when the app used it. */
  key(e: KeyboardEvent): boolean;
}

type Drag = { id: number; how: 'move' | 'size'; x0: number; y0: number; orig: Tile; pointer: number; moved: boolean; el: HTMLElement; target: EventTarget | null };

export class DashboardView {
  readonly el: HTMLDivElement;
  private page: HTMLDivElement;
  /** The tile picked (by id). */
  picked: number | null = null;
  private drag: Drag | null = null;
  private queued = false;
  private sheet: Sheet | null = null;

  constructor(root: HTMLElement, private host: DashHost) {
    this.el = document.createElement('div');
    this.el.className = 'dash';
    this.el.tabIndex = 0;
    this.el.hidden = true;
    this.el.setAttribute('aria-label', 'Dashboard');
    this.page = document.createElement('div');
    this.page.className = 'dash-page';
    this.el.append(this.page);
    root.prepend(this.el);
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.el || e.target === this.page) { this.pick(null); this.el.focus({ preventScroll: true }); }
    });
    this.el.addEventListener('pointermove', (e) => this.onMove(e));
    this.el.addEventListener('pointerup', (e) => this.onUp(e));
    this.el.addEventListener('keydown', (e) => this.onKey(e));
    this.el.addEventListener('contextmenu', (e) => {
      if (e.target === this.el || e.target === this.page) { e.preventDefault(); this.pick(null); this.host.contextMenu(e.clientX, e.clientY); }
    });
    new ResizeObserver(() => { if (!this.el.hidden) this.render(); }).observe(this.el);
  }

  get dashboard(): Dashboard | null {
    return this.sheet?.dashboard ?? null;
  }

  get pickedTile(): Tile | null {
    return this.dashboard?.tiles.find((t) => t.id === this.picked) ?? null;
  }

  /** Show a dashboard sheet (null: hide). */
  show(sheet: Sheet | null): void {
    if (sheet !== this.sheet) this.picked = null;
    this.sheet = sheet;
    this.el.hidden = !sheet;
    if (sheet) this.render();
  }

  pick(id: number | null): void {
    if (id === this.picked) return;
    this.picked = id;
    for (const t of this.page.querySelectorAll<HTMLElement>('.dash-tile')) t.classList.toggle('picked', Number(t.dataset.id) === id);
    this.host.picked();
  }

  render(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.draw();
    });
  }

  /** The grid's measures at the width showing. */
  private grid(d: Dashboard): { colW: number; rowH: number; gap: number } {
    const z = this.host.zoom;
    const gap = d.gap * z;
    const width = Math.max(320, this.el.clientWidth - 2);
    return { colW: (width - gap * (d.cols + 1)) / d.cols, rowH: d.rowH * z, gap };
  }

  private place(el: HTMLElement, t: Tile, g: ReturnType<DashboardView['grid']>): void {
    el.style.left = `${g.gap + t.x * (g.colW + g.gap)}px`;
    el.style.top = `${g.gap + t.y * (g.rowH + g.gap)}px`;
    el.style.width = `${t.w * g.colW + (t.w - 1) * g.gap}px`;
    el.style.height = `${t.h * g.rowH + (t.h - 1) * g.gap}px`;
  }

  /** New structure pictures still to be made in this frame. */
  private budget = 0;

  draw(): void {
    this.budget = 12;
    const d = this.dashboard, wb = this.host.wb;
    if (!d || !wb || this.el.hidden) return;
    const g = this.grid(d);
    this.page.style.background = d.background ?? '';
    this.el.style.background = d.background ?? '';
    const bottom = Math.max(4, ...d.tiles.map((t) => t.y + t.h));
    this.page.style.height = `${g.gap + bottom * (g.rowH + g.gap) + 40}px`;
    const els = d.tiles.map((t) => {
      // each tile is filtered by the slicers and by every chart's pick but its own
      const mask = filterMask(wb, d, t.id);
      const el = document.createElement('div');
      el.className = `dash-tile dash-tile-${t.kind}${t.id === this.picked ? ' picked' : ''}`;
      el.dataset.id = String(t.id);
      if (t.fill) el.style.background = t.fill;
      this.place(el, t, g);
      const head = document.createElement('div');
      head.className = 'dash-head';
      head.textContent = t.title ?? '';
      const body = document.createElement('div');
      body.className = 'dash-body';
      const size = document.createElement('div');
      size.className = 'dash-size';
      size.title = 'Drag to resize';
      el.append(head, body, size);
      el.addEventListener('pointerdown', (e) => this.onDown(e, t, el, (e.target as HTMLElement) === size ? 'size' : 'move'));
      el.addEventListener('dblclick', (e) => { if (!(e.target as HTMLElement).closest('button') && !this.onTreemap(e)) this.host.open(t); });
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.pick(t.id); this.host.contextMenu(e.clientX, e.clientY); });
      try {
        this.fill(t, head, body, mask, g);
      } catch (err) {
        body.textContent = `This tile could not be drawn: ${String(err)}`;
      }
      return el;
    });
    if (!d.tiles.length) {
      const hint = document.createElement('div');
      hint.className = 'dash-empty';
      hint.textContent = 'An empty dashboard. Add tiles from the Dashboard tab: charts, headline numbers, tables, slicers (filter buttons) and galleries of structures, all fed by the tables in this workbook.';
      els.push(hint);
    }
    this.page.replaceChildren(...els);
  }

  // ---------------------------------------------------------------- tiles

  private fill(t: Tile, head: HTMLElement, body: HTMLElement, mask: Map<Sheet, Set<number>>, g: ReturnType<DashboardView['grid']>): void {
    const wb = this.host.wb!;
    switch (t.kind) {
      case 'chart': return this.chartTile(t, body, mask, g);
      case 'kpi': return this.kpiTile(t, head, body, mask);
      case 'table': return this.tableTile(t, body, mask);
      case 'slicer': return this.slicerTile(t, head, body, wb);
      case 'gallery': return this.galleryTile(t, body, mask);
      case 'text': return this.textTile(t, body);
    }
  }

  private missing(body: HTMLElement, what: string): void {
    body.append(Object.assign(document.createElement('p'), { className: 'dash-missing', textContent: what }));
  }

  private chartTile(t: ChartTile, body: HTMLElement, mask: Map<Sheet, Set<number>>, g: ReturnType<DashboardView['grid']>): void {
    const wb = this.host.wb!;
    const z = this.host.zoom;
    const w = Math.max(60, t.w * g.colW + (t.w - 1) * g.gap - 2), h = Math.max(60, t.h * g.rowH + (t.h - 1) * g.gap - (t.title ? 26 * z : 2));
    const chart = { ...t.chart, w: w / z, h: h / z, border: false, background: 'none' };
    const c = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    c.style.width = `${w}px`; c.style.height = `${h}px`;
    c.classList.add('dash-pickable');
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, 0, 0);
    const data = (m: Map<Sheet, Set<number>>) => groupSeries(chartData(wb, wb.sheet, chart, m), chart.kind, t.group);
    // its own pick shows as a highlight over everything else it shows
    const lit = t.pick?.length ? data(joinMasks(mask, pickMask(wb, this.dashboard!, undefined, t.id))) : undefined;
    const hits = drawChart(ctx, chart, data(mask), chart.w, chart.h, lit);
    this.hits.set(c, { tile: t.id, hits });
    body.append(c);
  }

  /** Where each chart tile drew its parts (for clicks on them). */
  private hits = new WeakMap<HTMLCanvasElement, { tile: number; hits: ChartHits }>();

  /** The chart tile a canvas draws, and the part of it under the pointer. */
  private chartPart(canvas: HTMLCanvasElement, e: MouseEvent): { t: ChartTile; part: ReturnType<typeof partHit> } | null {
    const got = this.hits.get(canvas);
    const t = got && this.dashboard?.tiles.find((x) => x.id === got.tile);
    if (!got || !t || t.kind !== 'chart') return null;
    const r = canvas.getBoundingClientRect(), z = this.host.zoom;
    return { t, part: partHit(got.hits, (e.clientX - r.left) / z, (e.clientY - r.top) / z) };
  }

  /**
   * A click on a chart: its bar, slice, Sankey node or band, or treemap box filters the other
   * tiles; clicking it again, or clicking away from the chart's parts, shows everything again. A
   * decomposition tree's node is expanded (or closed up) and filters by what it stands for; a
   * treemap's trail of categories drills back up.
   */
  private chartClick(canvas: HTMLCanvasElement, e: PointerEvent): void {
    const got = this.chartPart(canvas, e);
    if (!got) return;
    const { t, part } = got;
    // a second click on the same treemap box drills into it, putting back the pick the first changed
    // (the tile is drawn afresh after each click, so the browser's own double-click never comes)
    const last = this.lastClick, now = e.timeStamp;
    this.lastClick = { tile: t.id, at: now, x: e.clientX, y: e.clientY, before: t.pick };
    if (t.chart.kind === 'treemap' && part?.drill?.length && last && last.tile === t.id && now - last.at < 450 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 6) {
      this.lastClick = null;
      this.update(t.id, { chart: { ...t.chart, path: part.drill }, pick: last.before } as Partial<ChartTile>, 'Drill down');
      return;
    }
    if (part?.drill && (t.chart.kind === 'decomp' || !part.pick.length)) {
      const path = part.drill.length ? part.drill : undefined;
      const pick = t.chart.kind === 'decomp' && path ? path.map((value, level) => ({ level, value })) : t.pick;
      const { path: _was, ...chart } = t.chart;
      this.update(t.id, { chart: path ? { ...chart, path } : chart, pick } as Partial<ChartTile>, t.chart.kind === 'decomp' ? (path ? 'Expand tree' : 'Close up tree') : 'Drill up');
      return;
    }
    const pick = part?.pick.length ? part.pick : null;
    if (!pick && !t.pick) return;
    const next = pick && !samePick(pick, t.pick) ? pick : undefined;
    this.update(t.id, { pick: next } as Partial<ChartTile>, next ? 'Filter by chart' : 'Clear chart filter');
  }

  /** The last click on a chart tile (a second one soon after on a treemap's box drills into it). */
  private lastClick: { tile: number; at: number; x: number; y: number; before: ChartTile['pick'] } | null = null;

  /** Is a double-click on a treemap (which drills into the box, not open the tile's settings)? */
  private onTreemap(e: MouseEvent): boolean {
    const canvas = e.target;
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.classList.contains('dash-pickable')) return false;
    return this.chartPart(canvas, e)?.t.chart.kind === 'treemap';
  }

  private kpiTile(t: KpiTile, head: HTMLElement, body: HTMLElement, mask: Map<Sheet, Set<number>>): void {
    const wb = this.host.wb!;
    const v = kpiValue(wb, t, mask);
    if (!t.title) head.textContent = t.formula ? t.formula : `${AGGREGATE_NAMES[t.agg]}${t.column ? ` of ${t.column}` : ''}`;
    const big = document.createElement('div');
    big.className = 'dash-kpi';
    const text = v === null ? '–' : isError(v) ? formatValue(v).text : formatValue(v, t.numFmt ?? (typeof v === 'number' && !Number.isInteger(v) ? '0.0' : undefined)).text;
    big.textContent = `${text}${v !== null && t.suffix ? t.suffix : ''}`;
    if (typeof v === 'number' && t.target !== undefined) {
      const good = t.higherIsBetter === false ? v <= t.target : v >= t.target;
      big.classList.add(good ? 'good' : 'bad');
    }
    body.append(big);
    if (!t.formula) {
      const res = resolveSource(wb, t.source);
      if (!res) { this.missing(body, `The table ${sourceName(t.source)} isn't in this workbook any more.`); return; }
      const shown = shownRows(res, mask).length;
      const sub = document.createElement('div');
      sub.className = 'dash-sub';
      sub.textContent = `${shown === res.rows.length ? `All ${shown}` : `${shown} of ${res.rows.length}`} rows of ${sourceName(t.source)}${t.target !== undefined ? ` · target ${t.higherIsBetter === false ? '≤' : '≥'} ${t.target}` : ''}`;
      body.append(sub);
    }
  }

  private tableTile(t: TableTile, body: HTMLElement, mask: Map<Sheet, Set<number>>): void {
    const wb = this.host.wb!;
    const res = resolveSource(wb, t.source);
    if (!res) { this.missing(body, `The table ${sourceName(t.source)} isn't in this workbook any more.`); return; }
    const cols = (t.columns?.length ? t.columns : res.names).map((n) => ({ n, c: columnOf(res, n) })).filter((x): x is { n: string; c: number } => x.c !== null);
    let rows = shownRows(res, mask);
    const sc = columnOf(res, t.sortBy);
    if (sc !== null) {
      rows = [...rows].sort((a, b) => {
        const va = res.sheet.value(a, sc), vb = res.sheet.value(b, sc);
        const k = typeof va === 'number' && typeof vb === 'number' ? va - vb : slicerText(va).localeCompare(slicerText(vb), undefined, { numeric: true });
        return t.descending ? -k : k;
      });
    }
    const max = t.maxRows ?? 200;
    const table = document.createElement('table');
    table.className = 'dash-table';
    const thead = table.createTHead().insertRow();
    for (const { n, c } of cols) {
      const th = document.createElement('th');
      th.textContent = n;
      th.title = sc === c ? `Sorted by ${n}` : `Sort by ${n}`;
      th.addEventListener('click', () => this.update(t.id, { sortBy: n, descending: sc === c ? !t.descending : false } as Partial<TableTile>, 'Sort table'));
      if (sc === c) th.textContent += t.descending ? ' ▾' : ' ▴';
      thead.append(th);
    }
    const tb = table.createTBody();
    for (const r of rows.slice(0, max)) {
      const tr = tb.insertRow();
      for (const { c } of cols) {
        const td = tr.insertCell();
        const st = res.sheet.cell(r, c)?.structure;
        if (st) td.append(this.structureCanvas(st, 90, 60));
        else {
          td.textContent = res.sheet.shownText(r, c);
          if (typeof res.sheet.value(r, c) === 'number') td.className = 'num';
        }
      }
    }
    body.append(table);
    if (rows.length > max) this.missing(body, `${rows.length - max} more rows not shown (the tile's settings set how many).`);
  }

  private slicerTile(t: SlicerTile, head: HTMLElement, body: HTMLElement, wb: Workbook): void {
    if (!t.title) head.textContent = t.column;
    const values = distinctValues(wb, t.source, t.column);
    if (!values.length) { this.missing(body, `No column ${t.column} in ${sourceName(t.source)}.`); return; }
    const sel = new Set(t.selected ?? []);
    if (sel.size) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'dash-clear';
      clear.textContent = '✕';
      clear.title = 'Show everything again';
      clear.addEventListener('click', (e) => { e.stopPropagation(); this.update(t.id, { selected: undefined }, 'Clear slicer'); });
      head.append(clear);
    }
    const box = document.createElement('div');
    box.className = 'dash-slicer';
    for (const v of values) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = v;
      b.setAttribute('aria-pressed', String(sel.has(v)));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = new Set(sel);
        if (e.ctrlKey || e.metaKey || e.shiftKey || sel.size) { if (next.has(v)) next.delete(v); else next.add(v); }
        else next.add(v);
        this.update(t.id, { selected: next.size ? [...next] : undefined }, 'Slicer');
      });
      box.append(b);
    }
    body.append(box);
  }

  private galleryTile(t: GalleryTile, body: HTMLElement, mask: Map<Sheet, Set<number>>): void {
    const wb = this.host.wb!;
    const res = resolveSource(wb, t.source);
    const sc = res ? columnOf(res, t.structure) : null;
    if (!res || sc === null) { this.missing(body, `No column ${t.structure} in ${sourceName(t.source)}.`); return; }
    const z = this.host.zoom;
    const size = (t.size ?? 120) * z;
    const box = document.createElement('div');
    box.className = 'dash-gallery';
    box.style.gridTemplateColumns = `repeat(auto-fill, minmax(${size}px, 1fr))`;
    const labels = (t.labels ?? []).map((n) => ({ n, c: columnOf(res, n) })).filter((x): x is { n: string; c: number } => x.c !== null);
    for (const r of shownRows(res, mask)) {
      const st = res.sheet.cell(r, sc)?.structure;
      const card = document.createElement('div');
      card.className = 'dash-card';
      if (st) card.append(this.structureCanvas(st, size, size * 0.75));
      else card.append(Object.assign(document.createElement('div'), { className: 'dash-nostruct', textContent: res.sheet.shownText(r, sc) || '—' }));
      for (const { n, c } of labels) {
        const l = document.createElement('div');
        l.className = 'dash-label';
        const txt = res.sheet.shownText(r, c);
        l.textContent = labels.length > 1 && labels.indexOf(labels.find((x) => x.c === c)!) > 0 ? `${n}: ${txt}` : txt;
        card.append(l);
      }
      box.append(card);
    }
    body.append(box);
  }

  private textTile(t: TextTile, body: HTMLElement): void {
    const p = document.createElement('div');
    p.className = 'dash-text';
    p.textContent = t.text;
    p.style.fontSize = `${(t.size ?? 16) * this.host.zoom}px`;
    p.style.fontWeight = t.bold ? '700' : '400';
    p.style.textAlign = t.align ?? 'left';
    if (t.color) p.style.color = t.color;
    body.append(p);
  }

  /** A structure drawn to fit a box (filled in when its picture is ready). */
  private structureCanvas(st: Structure, w: number, h: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    c.style.width = `${w}px`; c.style.height = `${h}px`;
    const box = this.host.structureBox(st);
    const k = Math.min(w / Math.max(1, box.w), h / Math.max(1, box.h), 1.6);
    // pictures already made are drawn at once; a few new ones are made each time, the rest next frame
    let bmp = this.host.structureBitmap(st, k * dpr);
    if (!bmp && this.budget > 0) { this.budget--; bmp = this.host.structureBitmap(st, -k * dpr); }
    if (!bmp) { this.render(); return c; }
    const ctx = c.getContext('2d')!;
    const bw = box.w * k * dpr, bh = box.h * k * dpr;
    ctx.drawImage(bmp, (c.width - bw) / 2, (c.height - bh) / 2, bw, bh);
    return c;
  }

  // ---------------------------------------------------------------- changing tiles

  update(id: number, patch: Partial<Tile>, label: string): void {
    const d = this.dashboard;
    if (!d) return;
    this.host.setDashboard({ ...d, tiles: d.tiles.map((t) => (t.id === id ? ({ ...t, ...patch } as Tile) : t)) }, label);
  }

  remove(id = this.picked): void {
    const d = this.dashboard;
    if (!d || id === null) return;
    this.host.setDashboard({ ...d, tiles: d.tiles.filter((t) => t.id !== id) }, 'Delete tile');
    if (this.picked === id) this.pick(null);
  }

  private onDown(e: PointerEvent, t: Tile, el: HTMLElement, how: 'move' | 'size'): void {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, th, input, select')) { this.pick(t.id); return; }
    e.preventDefault();
    this.el.focus({ preventScroll: true });
    this.pick(t.id);
    el.setPointerCapture(e.pointerId);
    this.drag = { id: t.id, how, x0: e.clientX, y0: e.clientY, orig: t, pointer: e.pointerId, moved: false, el, target: e.target };
  }

  /** Where a dragged tile would land, in grid squares. */
  private dropped(d: Drag, e: PointerEvent): Tile {
    const dash = this.dashboard!;
    const g = this.grid(dash);
    const dx = Math.round((e.clientX - d.x0) / (g.colW + g.gap)), dy = Math.round((e.clientY - d.y0) / (g.rowH + g.gap));
    const o = d.orig;
    if (d.how === 'move') return { ...o, x: Math.max(0, Math.min(dash.cols - o.w, o.x + dx)), y: Math.max(0, o.y + dy) };
    return { ...o, w: Math.max(1, Math.min(dash.cols - o.x, o.w + dx)), h: Math.max(1, o.h + dy) };
  }

  private onMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    if (!d.moved && Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) < 4) return;
    d.moved = true;
    const t = this.dropped(d, e);
    this.place(d.el, t, this.grid(this.dashboard!));
    d.el.classList.add('dragging');
    if (d.how === 'size') this.host.flash(`${t.w} × ${t.h} grid squares`, 700);
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    this.drag = null;
    // a click (not a drag) on a chart picks the part under it
    if (!d.moved) { if (d.target instanceof HTMLCanvasElement && d.target.classList.contains('dash-pickable')) this.chartClick(d.target, e); return; }
    const t = this.dropped(d, e);
    if (t.x !== d.orig.x || t.y !== d.orig.y || t.w !== d.orig.w || t.h !== d.orig.h) this.update(d.id, { x: t.x, y: t.y, w: t.w, h: t.h }, d.how === 'move' ? 'Move tile' : 'Resize tile');
    else this.render();
  }

  private onKey(e: KeyboardEvent): void {
    const t = this.pickedTile;
    if (!t || e.ctrlKey || e.metaKey || e.altKey) { if (this.host.key(e)) e.preventDefault(); return; }
    const k = e.key;
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this.remove(); return; }
    if (k === 'Escape') { e.preventDefault(); this.pick(null); return; }
    if (k === 'Enter') { e.preventDefault(); this.host.open(t); return; }
    const arrows: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (arrows[k]) {
      e.preventDefault();
      const [dx, dy] = arrows[k];
      const dash = this.dashboard!;
      if (e.shiftKey) this.update(t.id, { w: Math.max(1, Math.min(dash.cols - t.x, t.w + dx)), h: Math.max(1, t.h + dy) }, 'Resize tile');
      else this.update(t.id, { x: Math.max(0, Math.min(dash.cols - t.w, t.x + dx)), y: Math.max(0, t.y + dy) }, 'Move tile');
    }
  }
}
