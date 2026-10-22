// The Table Design side of a document's Table tab: the table styles gallery and its options,
// the borders (line kind, width, colour, the Borders menu and the Border Painter), cell
// margins, and turning text into a table and back.

import type { BorderLine, CellMargins, TableData, TableLook } from '../model';
import * as rt from '../richtext';
import { coveringCell } from '../table';
import { paraRange } from '../text/paragraphs';
import type { DocFile } from '../document/doc-file';
import { objectOffsets } from '../document/document';
import {
  BORDER_PICKS, BORDER_STYLES, BORDER_WIDTHS, DEFAULT_MARGINS, TABLE_STYLES, applyBorders, cellMargins, clearBorders, lookOfTable, resolveTable, strokeOf,
  type BorderPick, type CellBlock, type TableStyleDef,
} from '../document/table-styles';
import { SEPARATOR_NAMES, guessSeparator, splitTable, tableToText, textToTable, type Separator } from '../document/table-convert';
import { ask } from './ask';
import { popupMenu } from './sheet-view';
import { parseLength, showLength } from './doc-panel';

export interface DocTablesHost {
  file(): DocFile | null;
  /** The table and cell the Table tab works on. */
  target(): { id: number; r: number; c: number; t: TableData } | null;
  /** The cells chosen: a block dragged across, the cell typed into, or every cell of a picked table. */
  block(): CellBlock | null;
  setTable(id: number, t: TableData, kind: string): void;
  /** The width text is set in. */
  textW(): number;
  flash(msg: string, ms?: number): void;
  focus(): void;
  /** Leave the cell typed into (before changing the text round a table). */
  leaveCell(): void;
  /** Type into a table's cell. */
  startCell(id: number, r: number, c: number): void;
  changed(): void;
}

/** The look choices for a table (other than the style), in the order Word lists them. */
export const LOOK_OPTIONS: [keyof TableLook, string, string][] = [
  ['header', 'Header Row', 'The heading rows look different (and repeat on each page)'],
  ['total', 'Total Row', 'The last row looks different, as a total'],
  ['bandRows', 'Banded Rows', 'Every other row shaded, to read across easily'],
  ['firstCol', 'First Column', 'The first column looks different'],
  ['lastCol', 'Last Column', 'The last column looks different'],
  ['bandCols', 'Banded Columns', 'Every other column shaded'],
];

export class DocTablesUI {
  /** The pen the Borders menu and the Border Painter draw with. */
  pen: BorderLine = { style: 'single', w: 0.5, color: '#000000' };
  /** Border Painter is on: clicking a cell's edge gives it the pen's line. */
  painting = false;

  constructor(private host: DocTablesHost) {}

  // ---------------------------------------------------------------- styles

  /** The gallery of table styles, under the button pressed. */
  styleGallery(x: number, y: number): void {
    const tg = this.host.target();
    if (!tg) { this.host.flash('Click in a table first.'); return; }
    document.querySelector('.popup-menu')?.remove();
    const m = document.createElement('div');
    m.className = 'menu popup-menu table-gallery doc-table-gallery';
    m.setAttribute('role', 'menu');
    const kept = this.host.file()?.t.tableStyles;
    const current = tg.t.style ?? (tg.t.lines === 'grid' ? 'TableGrid' : tg.t.lines === 'acs' ? '@acs' : '@none');
    const pick = (id: string) => {
      m.remove();
      const t = this.host.target();
      if (!t) return;
      let table: TableData;
      if (id === '@acs' || id === '@none' || id === 'TableGrid') {
        table = { ...t.t, lines: id === '@acs' ? 'acs' : id === '@none' ? 'none' : 'grid' };
        delete table.style;
      } else {
        // a style picks out the heading row: at least one row is a heading
        table = { ...t.t, style: id, head: lookOfTable(t.t).header ? Math.max(1, t.t.head) : t.t.head };
      }
      this.host.setTable(t.id, table, 'Table style');
      this.host.focus();
    };
    const section = (title: string, items: { id: string; name: string; table: TableData }[]) => {
      const h = document.createElement('div');
      h.className = 'tg-head';
      h.textContent = title;
      m.append(h);
      const grid = document.createElement('div');
      grid.className = 'tg-grid';
      for (const it of items) {
        const b = document.createElement('button');
        b.type = 'button';
        b.title = it.name;
        if (it.id === current) b.classList.add('picked');
        b.append(stylePreview(it.table, kept));
        b.addEventListener('click', () => pick(it.id));
        grid.append(b);
      }
      m.append(grid);
    };
    const sample = (patch: Partial<TableData>): TableData => ({ ...SAMPLE, look: tg.t.look, ...patch });
    section('Plain Tables', [
      { id: '@acs', name: 'ACS rules (above, under the headings and at the bottom)', table: sample({ lines: 'acs' }) },
      { id: '@none', name: 'No lines', table: sample({ lines: 'none' }) },
      ...TABLE_STYLES.filter((s) => s.group === 'Plain').map((s) => ({ id: s.id, name: s.name, table: sample({ style: s.id }) })),
    ]);
    const own = Object.values(kept ?? {});
    if (own.length) section('This Document', own.map((s) => ({ id: s.id, name: s.name, table: sample({ style: s.id }) })));
    for (const g of ['Grid', 'List'] as const) section(`${g} Tables`, TABLE_STYLES.filter((s) => s.group === g).map((s) => ({ id: s.id, name: s.name, table: sample({ style: s.id }) })));
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'tg-none';
    clear.textContent = 'Clear (Table Grid, no shading)';
    clear.addEventListener('click', () => pick('TableGrid'));
    m.append(clear);
    placePopup(m, x, y);
  }

  /** Turn one of the Table Style Options on or off. */
  toggleLook(key: keyof TableLook): void {
    const tg = this.host.target();
    if (!tg) return;
    const look = lookOfTable(tg.t);
    const on = !look[key];
    const next: TableData = { ...tg.t, look: { ...tg.t.look, [key]: on } };
    if (key === 'header') next.head = on ? Math.max(1, tg.t.head) : 0;
    this.host.setTable(tg.id, next, 'Table style options');
  }

  // ---------------------------------------------------------------- borders

  /** The Borders menu: which edges of the chosen cells get the pen's line. */
  bordersMenu(x: number, y: number): void {
    const tg = this.host.target();
    const b = this.host.block();
    if (!tg || !b) { this.host.flash('Click in a table first.'); return; }
    popupMenu(x, y, [
      ...BORDER_PICKS.map(([pick, label]): [string, () => void] => [label, () => this.borders(pick)]),
      null,
      ['Back to the Style\'s Borders', () => { const t = this.host.target(), bl = this.host.block(); if (t && bl) this.host.setTable(t.id, clearBorders(t.t, bl), 'Borders'); }],
      [`${this.painting ? '✓ ' : ''}Border Painter`, () => this.setPainting(!this.painting)],
    ]);
  }

  borders(pick: BorderPick): void {
    const tg = this.host.target();
    const b = this.host.block();
    if (!tg || !b) return;
    this.host.setTable(tg.id, applyBorders(tg.t, b, pick, this.pen), 'Borders');
    this.host.focus();
  }

  setPen(patch: Partial<BorderLine>): void {
    this.pen = { ...this.pen, ...patch };
    // choosing a pen turns the painter on, as in Word
    if (!this.painting && (patch.style || patch.w || patch.color)) this.setPainting(true);
    this.host.changed();
  }

  setPainting(on: boolean): void {
    this.painting = on;
    if (on) this.host.flash('Border Painter: click the edges of cells to give them the line chosen (drag along several). Esc stops.', 5000);
    this.host.changed();
  }

  // ---------------------------------------------------------------- cell margins

  /** Cell Margins: every cell's (the table's default), and the cell typed into's own. */
  async cellMarginsDialog(): Promise<void> {
    const tg = this.host.target();
    if (!tg) { this.host.flash('Click in a table first.'); return; }
    const f = this.host.file();
    const base = tg.t.pad ?? DEFAULT_MARGINS;
    const own = tg.t.rows[tg.r]?.[tg.c]?.pad;
    const mine = cellMargins(tg.t, tg.r, tg.c);
    const len = (pt: number) => showLength(pt, 'in');
    const inCell = !!f?.box?.cell;
    const got = await ask('Cell Margins', [
      { name: 'top', label: 'Top', value: len(base.top), unit: 'in' },
      { name: 'bottom', label: 'Bottom', value: len(base.bottom), unit: 'in' },
      { name: 'left', label: 'Left', value: len(base.left), unit: 'in' },
      { name: 'right', label: 'Right', value: len(base.right), unit: 'in' },
      ...(inCell ? [
        { name: 'own', label: 'This cell has its own margins', type: 'checkbox' as const, value: String(!!own) },
        { name: 'ctop', label: 'This cell: top', value: len(mine.top), unit: 'in' },
        { name: 'cbottom', label: 'This cell: bottom', value: len(mine.bottom), unit: 'in' },
        { name: 'cleft', label: 'This cell: left', value: len(mine.left), unit: 'in' },
        { name: 'cright', label: 'This cell: right', value: len(mine.right), unit: 'in' },
      ] : []),
    ], { ok: 'OK', note: 'Room between each cell\'s edge and its text, for every cell of the table (Word\'s default cell margins). Any unit can be typed (0.1 in, 2 mm, 4 pt).' });
    this.host.focus();
    if (!got) return;
    const t = this.host.target();
    if (!t || t.id !== tg.id) return;
    const read = (k: string, was: number) => { const v = parseLength(got[k] ?? '', 'in'); return v === null ? was : Math.max(0, Math.min(72, v)); };
    const pad: CellMargins = { top: read('top', base.top), bottom: read('bottom', base.bottom), left: read('left', base.left), right: read('right', base.right) };
    let table: TableData = { ...t.t, pad };
    if (sameMargins(pad, DEFAULT_MARGINS)) delete table.pad;
    if (inCell) {
      const cellPad: CellMargins = { top: read('ctop', mine.top), bottom: read('cbottom', mine.bottom), left: read('cleft', mine.left), right: read('cright', mine.right) };
      const o = coveringCell(t.t, t.r, t.c);
      table = {
        ...table,
        rows: table.rows.map((row, r) => row.map((cell, c) => {
          if (r !== o.r || c !== o.c) return cell;
          const out = { ...cell };
          if (got.own === 'true' && !sameMargins(cellPad, pad)) out.pad = cellPad; else delete out.pad;
          return out;
        })),
      };
    }
    this.host.setTable(t.id, table, 'Cell margins');
  }

  // ---------------------------------------------------------------- text and tables

  /** Convert Text to Table: the paragraphs selected, cut into cells. */
  async textToTableDialog(): Promise<void> {
    const f = this.host.file();
    if (!f) return;
    this.host.leaveCell();
    const ed = f.ed;
    const [a, b] = ed.selectedParas();
    const text = rt.plainText(f.t.runs);
    const lines = text.split('\n').slice(a, b + 1);
    const guess = guessSeparator(lines);
    const counts = (sep: string) => Math.max(1, ...lines.map((l) => l.split(sep).length));
    const got = await ask('Convert Text to Table', [
      { name: 'sep', label: 'Separate text at', value: typeof guess === 'string' ? guess : 'other', options: SEPARATOR_NAMES.map(([value, label]) => ({ value, label })) },
      { name: 'other', label: 'Other character', value: '-', help: 'Used when "Other" is chosen.' },
      { name: 'cols', label: 'Number of columns', value: String(guess === 'para' ? 1 : counts(guess === 'tab' ? '\t' : guess === 'comma' ? ',' : ';')), type: 'number', help: 'With Paragraphs, how many paragraphs go in each row.' },
      { name: 'style', label: 'Look', value: 'grid', options: [{ value: 'grid', label: 'Grid lines (Table Grid)' }, { value: 'acs', label: 'ACS rules' }, { value: 'none', label: 'No lines' }, { value: 'GridTable4-Accent1', label: 'Grid Table 4 - Accent 1' }] },
    ], { ok: 'Convert', note: `${b - a + 1} paragraph${b > a ? 's' : ''}: each becomes a row, cut into cells at the separator.` });
    this.host.focus();
    if (!got || this.host.file() !== f) return;
    const sep: Separator = got.sep === 'other' ? { other: got.other || '-' } : got.sep as Separator;
    const cols = Math.max(1, Math.min(63, Math.round(Number(got.cols) || 1)));
    const looks = got.style === 'grid' || got.style === 'acs' || got.style === 'none';
    const r = textToTable(f.t, a, b, { sep, cols, width: this.host.textW(), lines: looks ? got.style as TableData['lines'] : 'none', style: looks ? undefined : got.style });
    const at = paraRange(text, a).start;
    ed.update(r.t, 'Convert text to table', at, at + 1);
    this.host.startCell(r.id, 0, 0);
  }

  /** Convert to Text: the table's rows back into paragraphs, cells joined by the separator. */
  async tableToTextDialog(): Promise<void> {
    const tg = this.host.target();
    const f = this.host.file();
    if (!tg || !f) { this.host.flash('Click in a table first.'); return; }
    const got = await ask('Convert Table to Text', [
      { name: 'sep', label: 'Separate text with', value: 'tab', options: SEPARATOR_NAMES.map(([value, label]) => ({ value, label: label === 'Paragraphs' ? 'Paragraph marks' : label })) },
      { name: 'other', label: 'Other character', value: '-', help: 'Used when "Other" is chosen.' },
    ], { ok: 'Convert', note: 'Each row becomes a paragraph; a table inside a cell becomes text too.' });
    this.host.focus();
    if (!got || this.host.file() !== f) return;
    const sep: Separator = got.sep === 'other' ? { other: got.other || '-' } : got.sep as Separator;
    this.host.leaveCell();
    const r = tableToText(f.t, tg.id, sep);
    if (!r) { this.host.flash('Convert to Text works on a table in the text (not one inside a cell).'); return; }
    f.ed.update(r.t, 'Convert table to text', r.start, r.end);
  }

  /** Split Table: the rows from the one with the caret on become a table of their own. */
  splitTable(): void {
    const tg = this.host.target();
    const f = this.host.file();
    if (!tg || !f) { this.host.flash('Click in a table first.'); return; }
    const r = coveringCell(tg.t, tg.r, tg.c).r;
    if (r === 0) { this.host.flash('Click in the row the new table should start with (not the first row).'); return; }
    const got = splitTable(f.t, tg.id, r);
    if (!got) { this.host.flash('Split Table works on a table in the text (not one inside a cell).'); return; }
    this.host.leaveCell();
    // the caret in the empty paragraph between the two, as in Word
    const at = objectOffsets(got.t.runs).get(tg.id) ?? 0;
    f.ed.update(got.t, 'Split table', at + 2, at + 2);
  }
}

const sameMargins = (a: CellMargins, b: CellMargins) => Math.abs(a.top - b.top) < 0.01 && Math.abs(a.bottom - b.bottom) < 0.01 && Math.abs(a.left - b.left) < 0.01 && Math.abs(a.right - b.right) < 0.01;

/** The table each style is shown on in the gallery: five rows of four columns. */
const SAMPLE: TableData = {
  cols: [1, 1, 1, 1],
  rows: Array.from({ length: 5 }, () => Array.from({ length: 4 }, () => ({ runs: [] }))),
  head: 1,
  lines: 'none',
};

/** A small picture of a table in a style: its shading, its lines, and a dash for the text (bold where the style makes it bold). */
export function stylePreview(t: TableData, kept?: Record<string, TableStyleDef>): HTMLCanvasElement {
  const W = 66, H = 46, dpr = Math.min(2, window.devicePixelRatio || 1);
  const cv = document.createElement('canvas');
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.width = `${W}px`; cv.style.height = `${H}px`;
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  const res = resolveTable(t, kept);
  const n = t.rows.length, m = t.cols.length;
  const x0 = 4, y0 = 4, cw = (W - 8) / m, rh = (H - 8) / n;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < m; c++) {
      const f = res.fill[r][c];
      if (f) { ctx.fillStyle = f; ctx.fillRect(x0 + c * cw, y0 + r * rh, cw, rh); }
      const tx = res.text[r][c];
      ctx.fillStyle = tx?.color ?? '#555';
      const bw = tx?.bold ? 2 : 1;
      ctx.fillRect(x0 + c * cw + 2, y0 + r * rh + rh / 2 - bw / 2, cw * 0.55, bw);
    }
  }
  ctx.lineCap = 'butt';
  const stroke = (x1: number, y1: number, x2: number, y2: number, e: BorderLine | null) => {
    if (!e) return;
    const s = strokeOf(e);
    ctx.strokeStyle = e.color;
    ctx.lineWidth = Math.max(0.6, Math.min(2, s.w));
    ctx.setLineDash(s.dash.length ? [1.5, 1.5] : []);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  };
  for (let r = 0; r <= n; r++) for (let c = 0; c < m; c++) stroke(x0 + c * cw, y0 + r * rh, x0 + (c + 1) * cw, y0 + r * rh, res.h[r][c]);
  for (let r = 0; r < n; r++) for (let c = 0; c <= m; c++) stroke(x0 + c * cw, y0 + r * rh, x0 + c * cw, y0 + (r + 1) * rh, res.v[r][c]);
  return cv;
}

/** A small picture of the pen: its line across a swatch. */
export function penSwatch(b: BorderLine): string {
  const s = strokeOf(b);
  const dash = s.dash.length ? ` stroke-dasharray="${s.dash.join(' ')}"` : '';
  const w = Math.min(4, s.w * 1.4);
  const lines = b.style === 'none' ? '' : s.double
    ? `<line x1="2" y1="${8 - w}" x2="38" y2="${8 - w}" stroke="${b.color}" stroke-width="${w}"/><line x1="2" y1="${8 + w}" x2="38" y2="${8 + w}" stroke="${b.color}" stroke-width="${w}"/>`
    : `<line x1="2" y1="8" x2="38" y2="8" stroke="${b.color}" stroke-width="${w}"${dash}/>`;
  return `<svg width="40" height="16" viewBox="0 0 40 16" aria-hidden="true">${lines}</svg>`;
}

export { BORDER_STYLES, BORDER_WIDTHS };

function placePopup(m: HTMLElement, x: number, y: number): void {
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
}
