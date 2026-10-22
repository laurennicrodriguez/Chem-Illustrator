// Page setup for printing a sheet (Excel's Page Layout tab): paper and orientation, margins,
// scaling (a percentage, or fit to so many pages wide and tall), the print area, rows and columns
// printed on every page, page breaks put in by hand, and headers and footers. Pagination follows
// Excel's rules: pages go down then across (or across then down), a manual break starts a new
// page, and fitting to pages ignores manual breaks.

import type { Range } from './refs';

/** One header or footer: text at the left, centre and right, in Excel's codes (&P for the page number). */
export interface HeaderFooter { left?: string; center?: string; right?: string }

/** Margins in inches, as Excel keeps them. */
export interface Margins { left: number; right: number; top: number; bottom: number; header: number; footer: number }

export type PaperName = 'letter' | 'a4' | 'legal' | 'a3' | 'a5' | 'tabloid';

export interface PageSetup {
  paper?: PaperName;
  orientation?: 'portrait' | 'landscape';
  margins?: Margins;
  /** Percentage, 10 to 400 (unset: 100), used when not fitting to pages. */
  scale?: number;
  /** Fit to so many pages wide and tall (0: as many as it takes). Set: fitting is on. */
  fit?: { wide: number; tall: number };
  /** The blocks printed (unset: everything in use). Each starts on a page of its own. */
  printArea?: Range[];
  /** Rows (first and last) printed at the top of every page. */
  titleRows?: [number, number];
  /** Columns printed at the left of every page. */
  titleCols?: [number, number];
  /** Page breaks put in by hand: the first row (or column) of each new page. */
  rowBreaks?: number[];
  colBreaks?: number[];
  header?: HeaderFooter;
  footer?: HeaderFooter;
  /** A different header and footer on the first page. */
  firstHeader?: HeaderFooter;
  firstFooter?: HeaderFooter;
  differentFirst?: boolean;
  /** The number of the first page (unset: 1). */
  firstPage?: number;
  centerH?: boolean;
  centerV?: boolean;
  /** Print the gridlines, and the row and column headings. */
  gridlines?: boolean;
  headings?: boolean;
  /** 'over': across then down (unset: down then across, Excel's default). */
  order?: 'down' | 'over';
}

/** Paper sizes in points, with Excel's paperSize numbers (ECMA-376 part 1, 18.3.1.63). */
export const SHEET_PAPERS: Record<PaperName, { name: string; w: number; h: number; code: number }> = {
  letter: { name: 'Letter (8.5 × 11 in)', w: 612, h: 792, code: 1 },
  legal: { name: 'Legal (8.5 × 14 in)', w: 612, h: 1008, code: 5 },
  tabloid: { name: 'Tabloid (11 × 17 in)', w: 792, h: 1224, code: 3 },
  a4: { name: 'A4 (210 × 297 mm)', w: 595.28, h: 841.89, code: 9 },
  a3: { name: 'A3 (297 × 420 mm)', w: 841.89, h: 1190.55, code: 8 },
  a5: { name: 'A5 (148 × 210 mm)', w: 419.53, h: 595.28, code: 11 },
};

export function paperFromCode(code: number): PaperName | undefined {
  return (Object.keys(SHEET_PAPERS) as PaperName[]).find((k) => SHEET_PAPERS[k].code === code);
}

/** Excel's margin presets (Page Layout > Margins), in inches. */
export const MARGIN_PRESETS: Record<'normal' | 'wide' | 'narrow', { name: string; m: Margins }> = {
  normal: { name: 'Normal', m: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 } },
  wide: { name: 'Wide', m: { left: 1, right: 1, top: 1, bottom: 1, header: 0.5, footer: 0.5 } },
  narrow: { name: 'Narrow', m: { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 } },
};
export const DEFAULT_MARGINS = MARGIN_PRESETS.normal.m;

/** The paper's size in points, turned for the orientation. */
export function paperSize(ps: PageSetup | null | undefined, fallback: PaperName = 'letter'): { w: number; h: number } {
  const p = SHEET_PAPERS[ps?.paper ?? fallback];
  return ps?.orientation === 'landscape' ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
}

/** True when nothing differs from Excel's defaults (nothing worth saving). */
export function isDefaultSetup(ps: PageSetup | null | undefined): boolean {
  if (!ps) return true;
  return !Object.entries(ps).some(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length));
}

/** A page setup with one part changed (undefined takes it off); null when nothing is left. */
export function withSetup(ps: PageSetup | null, patch: Partial<PageSetup>): PageSetup | null {
  const next: PageSetup = { ...ps, ...patch };
  for (const k of Object.keys(next) as (keyof PageSetup)[]) {
    const v = next[k];
    if (v === undefined || (Array.isArray(v) && !v.length)) delete next[k];
  }
  return isDefaultSetup(next) ? null : next;
}

/** Add or take away a manual break at an index (a row or column starting a new page). */
export function toggleBreak(list: number[] | undefined, at: number, on: boolean): number[] | undefined {
  const set = new Set(list ?? []);
  if (on && at > 0) set.add(at); else set.delete(at);
  const out = [...set].sort((a, b) => a - b);
  return out.length ? out : undefined;
}

// ---------------------------------------------------------------- moving with inserted and deleted rows

/** The page setup after rows or columns were inserted (count > 0) or deleted (count < 0) at `at`. */
export function shiftSetup(ps: PageSetup, axis: 'row' | 'col', at: number, count: number): PageSetup {
  const move = (i: number): number | null => {
    if (i < at) return i;
    if (count > 0) return i + count;
    return i >= at - count ? i + count : null;
  };
  const span = (lo: number, hi: number): [number, number] | null => {
    if (count > 0) return [lo >= at ? lo + count : lo, hi >= at ? hi + count : hi];
    const n = -count, end = at + n - 1;
    if (lo > end) return [lo - n, hi - n];
    if (hi < at) return [lo, hi];
    const nlo = lo < at ? lo : at, nhi = hi > end ? hi - n : at - 1;
    return nhi < nlo ? null : [nlo, nhi];
  };
  const next: PageSetup = { ...ps };
  const breaks = axis === 'row' ? ps.rowBreaks : ps.colBreaks;
  if (breaks) {
    const moved = [...new Set(breaks.map(move).filter((i): i is number => i !== null && i > 0))].sort((a, b) => a - b);
    if (axis === 'row') next.rowBreaks = moved.length ? moved : undefined; else next.colBreaks = moved.length ? moved : undefined;
  }
  const titles = axis === 'row' ? ps.titleRows : ps.titleCols;
  if (titles) {
    const t = span(titles[0], titles[1]) ?? undefined;
    if (axis === 'row') next.titleRows = t; else next.titleCols = t;
  }
  if (ps.printArea) {
    const areas = ps.printArea.map((R) => {
      const t = axis === 'row' ? span(R.r1, R.r2) : span(R.c1, R.c2);
      return t ? (axis === 'row' ? { ...R, r1: t[0], r2: t[1] } : { ...R, c1: t[0], c2: t[1] }) : null;
    }).filter((R): R is Range => !!R);
    next.printArea = areas.length ? areas : undefined;
  }
  return withSetup(null, next) ?? {};
}

// ---------------------------------------------------------------- pagination

/** What pagination needs to know of a sheet: sizes in pixels at 100% (0 for hidden). */
export interface SheetSizes {
  colW(c: number): number;
  rowH(r: number): number;
}

export interface PrintPage {
  /** The rows and columns of the block printed on this page (titles not counted). */
  rows: [number, number];
  cols: [number, number];
  /** This page's number among all the sheet's pages, from 1. */
  index: number;
}

export interface Pagination {
  /** The factor sheet pixels are drawn at: points = pixels × 0.75 × scale. */
  scale: number;
  pages: PrintPage[];
  /** The area inside the margins, in points. */
  paper: { w: number; h: number };
  inner: { x: number; y: number; w: number; h: number };
}

const PT = 0.75;

/** Where pages start along one axis: the first index of each page. */
function cut(lo: number, hi: number, size: (i: number) => number, room: number, manual: Set<number>): number[] {
  const starts = [lo];
  let used = 0;
  for (let i = lo; i <= hi; i++) {
    const s = size(i);
    if (i > starts[starts.length - 1] && (manual.has(i) || (used + s > room + 1e-6 && used > 0))) {
      starts.push(i);
      used = 0;
    }
    used += s;
  }
  return starts;
}

const sum = (lo: number, hi: number, size: (i: number) => number) => {
  let t = 0;
  for (let i = lo; i <= hi; i++) t += size(i);
  return t;
};

/**
 * Split the blocks to print into pages. `used` is the sheet's used range (printed when there is
 * no print area); null when the sheet is empty.
 */
export function paginate(ps: PageSetup | null, sizes: SheetSizes, used: Range | null, defaultPaper: PaperName = 'letter'): Pagination {
  const paper = paperSize(ps, defaultPaper);
  const m = ps?.margins ?? DEFAULT_MARGINS;
  const inner = { x: m.left * 72, y: m.top * 72, w: Math.max(36, paper.w - (m.left + m.right) * 72), h: Math.max(36, paper.h - (m.top + m.bottom) * 72) };
  const areas = ps?.printArea?.length ? ps.printArea : used ? [used] : [];
  const tr = ps?.titleRows, tc = ps?.titleCols;
  const headW = ps?.headings ? 32 : 0, headH = ps?.headings ? 20 : 0;
  const titleW = (tc ? sum(tc[0], tc[1], sizes.colW) : 0) + headW;
  const titleH = (tr ? sum(tr[0], tr[1], sizes.rowH) : 0) + headH;
  const rowBreaks = new Set(ps?.rowBreaks ?? []), colBreaks = new Set(ps?.colBreaks ?? []);
  const none = new Set<number>();

  const layout = (scale: number, manual: boolean) => {
    const roomW = inner.w / (PT * scale) - titleW, roomH = inner.h / (PT * scale) - titleH;
    return areas.map((R) => {
      // titles inside the block are not printed twice on its first page
      const rowStarts = cut(R.r1, R.r2, sizes.rowH, Math.max(1, roomH), manual ? rowBreaks : none);
      const colStarts = cut(R.c1, R.c2, sizes.colW, Math.max(1, roomW), manual ? colBreaks : none);
      return { R, rowStarts, colStarts };
    });
  };

  let scale = (ps?.scale ?? 100) / 100;
  let blocks = layout(scale, true);
  if (ps?.fit) {
    const { wide, tall } = ps.fit;
    const fits = (b: ReturnType<typeof layout>) => b.every((x) => (!wide || x.colStarts.length <= wide) && (!tall || x.rowStarts.length <= tall));
    scale = 1;
    blocks = layout(1, false);
    if (!fits(blocks)) {
      // the largest scale that fits, to a tenth of a percent (Excel goes no smaller than 10%)
      let lo = 0.1, hi = 1;
      for (let k = 0; k < 14; k++) {
        const mid = (lo + hi) / 2;
        if (fits(layout(mid, false))) lo = mid; else hi = mid;
      }
      scale = Math.floor(lo * 1000) / 1000;
      blocks = layout(scale, false);
    }
  }

  const pages: PrintPage[] = [];
  for (const { R, rowStarts, colStarts } of blocks) {
    const rowSpans = rowStarts.map((s, i) => [s, (rowStarts[i + 1] ?? R.r2 + 1) - 1] as [number, number]);
    const colSpans = colStarts.map((s, i) => [s, (colStarts[i + 1] ?? R.c2 + 1) - 1] as [number, number]);
    if (ps?.order === 'over') {
      for (const rows of rowSpans) for (const cols of colSpans) pages.push({ rows, cols, index: pages.length + 1 });
    } else {
      for (const cols of colSpans) for (const rows of rowSpans) pages.push({ rows, cols, index: pages.length + 1 });
    }
  }
  return { scale, pages, paper, inner };
}

/** Where automatic and manual page breaks fall in the used part of a sheet, for drawing on the grid. */
export function breakLines(p: Pagination): { rows: Set<number>; cols: Set<number> } {
  const rows = new Set<number>(), cols = new Set<number>();
  for (const pg of p.pages) { rows.add(pg.rows[0]); rows.add(pg.rows[1] + 1); cols.add(pg.cols[0]); cols.add(pg.cols[1] + 1); }
  return { rows, cols };
}

// ---------------------------------------------------------------- headers and footers

/** Excel's codes, and the words shown for them in the Header and Footer window. */
const CODES: [string, string][] = [['&P', '&[Page]'], ['&N', '&[Pages]'], ['&D', '&[Date]'], ['&T', '&[Time]'], ['&Z&F', '&[Path]&[File]'], ['&F', '&[File]'], ['&A', '&[Tab]']];

/** Excel's codes as the words people type (&P → &[Page]). */
export function codesToWords(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '&' && s[i + 1] === '&') { out += '&&'; i++; continue; }
    const hit = CODES.find(([code]) => s.startsWith(code, i));
    if (hit) { out += hit[1]; i += hit[0].length - 1; continue; }
    out += s[i];
  }
  return out;
}

/** The words back into Excel's codes (&[Page] → &P). */
export function wordsToCodes(s: string): string {
  let out = s;
  for (const [code, word] of CODES) out = out.split(word).join(code);
  return out;
}

/** One header or footer as Excel writes it: &L…&C…&R…. */
export function headerFooterText(h: HeaderFooter | undefined): string {
  if (!h) return '';
  return `${h.left ? `&L${h.left}` : ''}${h.center ? `&C${h.center}` : ''}${h.right ? `&R${h.right}` : ''}`;
}

/** Excel's header or footer text split into its three parts. */
export function readHeaderFooter(text: string | null | undefined): HeaderFooter | undefined {
  if (!text) return undefined;
  const out: HeaderFooter = {};
  let part: keyof HeaderFooter = 'center';
  let cur = '';
  const flush = () => { if (cur) out[part] = (out[part] ?? '') + cur; cur = ''; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '&' && i + 1 < text.length) {
      const nx = text[i + 1];
      if (nx === '&') { cur += '&&'; i++; continue; }
      if (nx === 'L' || nx === 'C' || nx === 'R') { flush(); part = nx === 'L' ? 'left' : nx === 'C' ? 'center' : 'right'; i++; continue; }
    }
    cur += ch;
  }
  flush();
  return out.left || out.center || out.right ? out : undefined;
}

export interface HfContext { page: number; pages: number; sheet: string; file: string; date: Date }

/** A run of header or footer text with its look. */
export interface HfRun { text: string; bold?: boolean; italic?: boolean; underline?: boolean; size?: number; font?: string; sub?: boolean; sup?: boolean }

/**
 * One part of a header or footer worked out for a page: the codes for page numbers, dates and
 * names filled in, the font codes (&B, &I, &12, &"Arial,Bold") turned into runs.
 */
export function headerRuns(text: string | undefined, ctx: HfContext): HfRun[] {
  if (!text) return [];
  const runs: HfRun[] = [];
  let look: Omit<HfRun, 'text'> = {};
  let cur = '';
  const flush = () => { if (cur) runs.push({ text: cur, ...look }); cur = ''; };
  const date = ctx.date;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '&' || i + 1 >= text.length) { cur += ch; continue; }
    const nx = text[i + 1];
    i++;
    switch (nx) {
      case '&': cur += '&'; break;
      case 'P': {
        // &P+2, &P-1: the page number moved on or back
        const m = /^([+-]\d+)/.exec(text.slice(i + 1));
        cur += String(ctx.page + (m ? Number(m[1]) : 0));
        if (m) i += m[1].length;
        break;
      }
      case 'N': cur += String(ctx.pages); break;
      case 'D': cur += date.toLocaleDateString(); break;
      case 'T': cur += date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); break;
      case 'F': cur += ctx.file; break;
      case 'Z': break; // the folder: not known here
      case 'A': cur += ctx.sheet; break;
      case 'B': flush(); look = { ...look, bold: !look.bold }; break;
      case 'I': flush(); look = { ...look, italic: !look.italic }; break;
      case 'U': case 'E': flush(); look = { ...look, underline: !look.underline }; break;
      case 'S': case 'O': case 'H': break; // strikethrough, outline, shadow: not drawn
      case 'X': flush(); look = { ...look, sup: !look.sup, sub: false }; break;
      case 'Y': flush(); look = { ...look, sub: !look.sub, sup: false }; break;
      case 'K': i += 6; break; // a colour (&KFF0000): text stays black
      case 'G': break; // a picture: not drawn
      case '"': {
        const end = text.indexOf('"', i + 1);
        if (end < 0) break;
        const [font, style] = text.slice(i + 1, end).split(',');
        flush();
        look = { ...look, ...(font && font !== '-' ? { font } : {}), bold: /bold/i.test(style ?? '') || undefined, italic: /italic/i.test(style ?? '') || undefined };
        i = end;
        break;
      }
      default:
        if (/\d/.test(nx)) {
          const m = /^\d+/.exec(text.slice(i))!;
          flush();
          look = { ...look, size: Number(m[0]) };
          i += m[0].length - 1;
        } else cur += '&' + nx;
    }
  }
  flush();
  return runs;
}
