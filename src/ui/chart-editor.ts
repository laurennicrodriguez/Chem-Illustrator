// Insert > Chart (Document, Slides and Design modes), and double-clicking a chart there: a window
// with the chart's data in a grid (a real sheet: type, paste from Excel, use formulas), the chart
// as it will look, and every setting Sheet mode's chart panel has. As in Word and PowerPoint,
// the chart keeps its own data; rows and columns added beside the data join the chart.

import { SheetView } from './sheet-view';
import { SheetCharts } from './sheet-chart-ui';
import { Workbook, type Sheet, type CellBlock, type Cell } from '../sheet/workbook';
import { Chart, ChartKind, CHART_NAMES, chartFromRange, sameChartData } from '../sheet/chart';
import { ChartBox, boxSheetName, sheetCells, PX_PER_PT } from '../sheet/chart-box';
import { parseDelimited } from '../sheet/csv';
import { drawChart } from '../render/chart-draw';
import { chartBoxData } from '../render/chart-box-paint';
import type { Range } from '../sheet/refs';

const KINDS = Object.keys(CHART_NAMES) as ChartKind[];
const KIND_ICONS: Record<ChartKind, string> = { scatter: '⁘', line: '⟋', column: '▥', bar: '☰', area: '◭', pie: '◔', combo: '◧', histogram: '▇', box: '⊟', bubble: '◯', radar: '✳', sankey: '⫘', treemap: '▦', decomp: '⊢' };

/** What the window gave back: the chart changed, the chart to be deleted, or nothing (Cancel). */
export type ChartEdit = ChartBox | 'delete' | null;

/** The block of the sheet with data in it (from A1). */
function usedBlock(s: Sheet): Range {
  return { r1: 0, c1: 0, r2: Math.max(0, s.lastRow), c2: Math.max(0, s.lastCol) };
}

/** The chart charting a block again, keeping its look and each series' own settings. */
function rechart(c: Chart, s: Sheet, r: Range): Chart {
  const fresh = chartFromRange(s, r, c.kind);
  return {
    ...c,
    series: fresh.series.map((f, i) => ({ ...(c.series[i] ?? {}), name: f.name, x: f.x, y: f.y, ...(f.size ? { size: f.size } : {}) })),
    legend: c.legend === 'none' && fresh.series.length > 1 && c.series.length <= 1 ? 'right' : c.legend,
  };
}

/** Does the chart chart the whole block (so rows and columns typed beside it should join it)? */
function chartsWhole(c: Chart, s: Sheet): boolean {
  return sameChartData(c, chartFromRange(s, usedBlock(s), c.kind));
}

/**
 * Open the chart window on `start` (a new chart's sample data, or a chart being changed). `isNew`
 * names the button Insert and leaves out Delete.
 */
export function editChart(start: ChartBox, isNew: boolean, flash: (msg: string, ms?: number) => void): Promise<ChartEdit> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'ask chart-editor';
    d.setAttribute('aria-label', 'Chart');
    d.innerHTML = `<h2>${isNew ? 'Insert Chart' : 'Chart'}</h2>
      <div class="ce-body">
        <div class="ce-left">
          <div class="ce-kinds" role="radiogroup" aria-label="Chart type"></div>
          <div class="ce-preview"><canvas aria-label="The chart as it will look"></canvas></div>
          <div class="ce-data-head"><b>Data</b><span class="muted small">Type over it, or paste from Excel or a sheet. Rows and columns added beside it join the chart.</span>
            <button type="button" data-act="whole" title="Chart every row and column of the data again (the series follow the table's columns)">Chart All the Data</button></div>
          <div class="ce-grid"></div>
        </div>
        <div class="ce-settings" aria-label="Chart settings"></div>
      </div>
      <p class="ask-buttons"><button type="button" data-act="cancel">Cancel</button> <button type="button" class="primary" data-act="ok">${isNew ? 'Insert' : 'Done'}</button></p>`;
    const $ = <T extends Element>(q: string) => d.querySelector<T>(q)!;
    document.body.append(d);

    // the data, as a workbook of one sheet shown in a real grid
    const wb = new Workbook([boxSheetName(start)]);
    const sheet = wb.sheet;
    wb.build(() => start.cells.forEach((row, r) => row.forEach((t, c) => { if (t !== '') sheet.setInput(r, c, t); })));
    let chart: Chart = { ...start.chart };
    let whole = chartsWhole(chart, sheet);
    let lastBlock = usedBlock(sheet);

    const view = new SheetView($('.ce-grid'), {
      structureBox: () => ({ w: 0, h: 0 }),
      structureBitmap: () => null,
      editStructure: () => flash('Charts take numbers and labels: structures go in Sheet mode.'),
      key: (e) => key(e),
      changed: () => {},
      contextMenu: () => {},
      filterMenu: () => {},
      flash,
      typing: () => {},
    });
    const charts = new SheetCharts({ view, edit: (label, fn) => wb.edit(label, () => fn(sheet)), flash });
    charts.ownData = true;
    charts.target = {
      get: () => chart,
      set: (c) => { chart = c; whole = chartsWhole(c, sheet); refresh(); },
      remove: () => finish('delete'),
    };
    wb.onChange = () => {
      view.refresh();
      const now = usedBlock(sheet);
      // the data grew or shrank: a chart of all of it follows
      if (whole && (now.r2 !== lastBlock.r2 || now.c2 !== lastBlock.c2)) chart = rechart(chart, sheet, now);
      lastBlock = now;
      refresh();
    };
    view.show(wb);

    // ---------------------------------------------------------------- chart type buttons
    const kinds = $<HTMLDivElement>('.ce-kinds');
    for (const k of KINDS) {
      const b = Object.assign(document.createElement('button'), { type: 'button', title: CHART_NAMES[k] });
      b.dataset.kind = k;
      b.setAttribute('role', 'radio');
      b.innerHTML = `<span class="ce-kind-icon">${KIND_ICONS[k]}</span>${CHART_NAMES[k].replace(/ \(x–y\)/, '')}`;
      b.addEventListener('click', () => {
        const was = whole;
        charts.setKind(k);
        // a chart of all the data takes it as the new kind takes a table (a bubble chart's columns in pairs, a histogram's one column)
        if (was) { chart = rechart(chart, sheet, usedBlock(sheet)); whole = chartsWhole(chart, sheet); refresh(); }
      });
      kinds.append(b);
    }

    // ---------------------------------------------------------------- preview and settings
    const canvas = $<HTMLCanvasElement>('.ce-preview canvas');
    const settings = $<HTMLDivElement>('.ce-settings');
    let queued = false;
    const refresh = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; paint(); panel(); });
    };
    const paint = () => {
      for (const b of kinds.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-checked', String(b.dataset.kind === chart.kind));
      const holder = canvas.parentElement!;
      const room = { w: Math.max(100, holder.clientWidth - 8), h: Math.max(80, holder.clientHeight - 8) };
      const k = Math.min(1, room.w / chart.w, room.h / chart.h);
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = `${chart.w * k}px`;
      canvas.style.height = `${chart.h * k}px`;
      canvas.width = Math.round(chart.w * k * dpr);
      canvas.height = Math.round(chart.h * k * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
      ctx.clearRect(0, 0, chart.w, chart.h);
      drawChart(ctx, chart, chartBoxData(current()), chart.w, chart.h);
    };
    const panel = () => {
      // (the box being typed in keeps its place: the panel is rebuilt only when focus is elsewhere)
      if (settings.contains(document.activeElement) && document.activeElement !== settings) return;
      const top = settings.scrollTop;
      settings.replaceChildren(...charts.panel(chart));
      settings.scrollTop = top;
    };
    settings.addEventListener('focusout', () => setTimeout(() => { if (!settings.contains(document.activeElement)) refresh(); }, 0));

    // ---------------------------------------------------------------- the grid's keys
    function key(e: KeyboardEvent): boolean {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return false;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { wb.undo(); return true; }
      if (k === 'y' || (k === 'z' && e.shiftKey)) { wb.redo(); return true; }
      if (k === 'c' || k === 'x') {
        const R = view.sel.range;
        const rows: string[] = [];
        for (let r = R.r1; r <= R.r2; r++) {
          const out: string[] = [];
          for (let c = R.c1; c <= R.c2; c++) out.push(sheet.cell(r, c)?.input ?? '');
          rows.push(out.join('\t'));
        }
        void navigator.clipboard?.writeText(rows.join('\n')).catch(() => {});
        if (k === 'x') wb.edit('Cut', () => { for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) sheet.setInput(r, c, ''); });
        return true;
      }
      if (k === 'v') {
        // the paste event brings the text (reading the clipboard straight may be refused)
        return false;
      }
      return false;
    }
    const pasteText = (text: string) => {
      const rows = parseDelimited(text, text.includes('\t') ? '\t' : 'auto');
      if (!rows.length) return;
      const width = Math.max(...rows.map((x) => x.length));
      const block: CellBlock = { rows: rows.length, cols: width, cells: rows.map((x) => x.map((t) => (t === '' ? undefined : { input: t } as Cell))), origin: null };
      const { r, c } = view.sel.active;
      wb.edit('Paste', () => sheet.paste({ row: r, col: c }, block, 'all'));
      view.select({ r1: r, c1: c, r2: r + block.rows - 1, c2: c + block.cols - 1 }, { r, c }, { r, c });
    };
    $('.ce-grid').addEventListener('paste', (e) => {
      if (view.editing) return;
      const text = (e as ClipboardEvent).clipboardData?.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      e.stopPropagation();
      pasteText(text);
    }, true);

    // ---------------------------------------------------------------- finishing
    const current = (): ChartBox => {
      const cells = sheetCells(sheet);
      return { chart, cells, ...(sheet.name !== 'Sheet1' ? { sheet: sheet.name } : {}) };
    };
    let done = false;
    function finish(result: ChartEdit | 'ok'): void {
      if (done) return;
      done = true;
      view.commitEdit();
      const out = result === 'ok' ? current() : result;
      wb.onChange = () => {};
      d.close();
      d.remove();
      resolve(out);
    }
    $('[data-act="cancel"]').addEventListener('click', () => finish(null));
    $('[data-act="ok"]').addEventListener('click', () => finish('ok'));
    $('[data-act="whole"]').addEventListener('click', () => { chart = rechart(chart, sheet, usedBlock(sheet)); whole = true; lastBlock = usedBlock(sheet); refresh(); });
    d.addEventListener('cancel', (e) => {
      e.preventDefault();
      // Escape leaves the cell being typed in first
      if (view.editing) { view.cancelEdit(); return; }
      finish(null);
    });
    d.addEventListener('keydown', (e) => {
      // keys stay in the window (not the app's hotkeys underneath)
      e.stopPropagation();
    });
    d.showModal();
    paint();
    panel();
    requestAnimationFrame(() => { paint(); view.refresh(); view.focus(); });
  });
}

/** The chart's size in points (its pixels at 96 to the inch). */
export const chartPoints = (c: Chart): { w: number; h: number } => ({ w: c.w / PX_PER_PT, h: c.h / PX_PER_PT });
