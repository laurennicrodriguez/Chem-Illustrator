// Table styles, cell borders and cell margins in Word files: a style as Word's own table style
// in styles.xml (w:style w:type="table", with a w:tblStylePr for each part it formats; ECMA-376
// part 1, 17.7.6), a table's choice of parts as w:tblLook, lines as w:tblBorders and
// w:tcBorders, and margins as w:tblCellMar and w:tcMar.

import type { BorderLine, BorderSide, CellBorders, CellMargins, TableData, TableLook } from '../model';
import { kid, kids } from './ooxml';
import { twips } from './docx';
import { coveringCell } from '../table';
import { DEFAULT_LOOK, PART_ORDER, resolveTable, type PartName, type StyleEdge, type StylePart, type TableStyleDef } from '../document/table-styles';

const hex6 = (c: string) => (c.startsWith('#') ? c.slice(1) : c).slice(0, 6).toUpperCase();
const EDGE_ORDER: StyleEdge[] = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'];
const WORD_LINE: Record<BorderLine['style'], string> = { none: 'nil', single: 'single', double: 'double', dotted: 'dotted', dashed: 'dashed' };

/** One border element (w:top…): Word's line kind, its width in eighths of a point, and its colour. */
export function borderXml(name: string, b: BorderLine): string {
  if (b.style === 'none') return `<w:${name} w:val="nil"/>`;
  return `<w:${name} w:val="${WORD_LINE[b.style]}" w:sz="${Math.max(2, Math.round(b.w * 8))}" w:space="0" w:color="${hex6(b.color)}"/>`;
}

export function bordersXml(wrap: string, sides: Partial<Record<StyleEdge, BorderLine>> | undefined): string {
  if (!sides) return '';
  const inner = EDGE_ORDER.filter((e) => sides[e]).map((e) => borderXml(e, sides[e]!)).join('');
  return inner ? `<w:${wrap}>${inner}</w:${wrap}>` : '';
}

/** Margins as w:tblCellMar or w:tcMar (only the sides given). */
export function marginsXml(wrap: string, m: Partial<CellMargins>): string {
  const order: [keyof CellMargins, string][] = [['top', 'top'], ['left', 'left'], ['bottom', 'bottom'], ['right', 'right']];
  const inner = order.filter(([k]) => m[k] !== undefined).map(([k, n]) => `<w:${n} w:w="${twips(m[k]!)}" w:type="dxa"/>`).join('');
  return inner ? `<w:${wrap}>${inner}</w:${wrap}>` : '';
}

/** The parts a table picks out, as Word's w:tblLook (both the attributes and the older bit mask). */
export function lookXml(t: TableData): string {
  const l = { ...DEFAULT_LOOK, ...t.look };
  const bits = (l.header ? 0x20 : 0) | (l.total ? 0x40 : 0) | (l.firstCol ? 0x80 : 0) | (l.lastCol ? 0x100 : 0) | (l.bandRows ? 0 : 0x200) | (l.bandCols ? 0 : 0x400);
  const b = (v: boolean) => (v ? '1' : '0');
  return `<w:tblLook w:val="${bits.toString(16).toUpperCase().padStart(4, '0')}" w:firstRow="${b(l.header)}" w:lastRow="${b(l.total)}" w:firstColumn="${b(l.firstCol)}" w:lastColumn="${b(l.lastCol)}" w:noHBand="${b(!l.bandRows)}" w:noVBand="${b(!l.bandCols)}"/>`;
}

const PART_TYPE: Record<Exclude<PartName, 'whole'>, string> = {
  firstRow: 'firstRow', lastRow: 'lastRow', firstCol: 'firstCol', lastCol: 'lastCol', band1H: 'band1Horz', band2H: 'band2Horz', band1V: 'band1Vert', band2V: 'band2Vert',
};

function rPr(p: StylePart): string {
  const out: string[] = [];
  if (p.bold !== undefined) out.push(p.bold ? '<w:b/><w:bCs/>' : '<w:b w:val="0"/><w:bCs w:val="0"/>');
  if (p.italic !== undefined) out.push(p.italic ? '<w:i/><w:iCs/>' : '<w:i w:val="0"/><w:iCs w:val="0"/>');
  if (p.color) out.push(`<w:color w:val="${hex6(p.color)}"/>`);
  return out.length ? `<w:rPr>${out.join('')}</w:rPr>` : '';
}

const shd = (fill: string | undefined) => (fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${hex6(fill)}"/>` : '');

/** A table style as Word's own, for styles.xml. */
export function tableStyleXml(def: TableStyleDef): string {
  const whole = def.parts.whole ?? {};
  const out: string[] = [
    `<w:style w:type="table" w:styleId="${def.id}"><w:name w:val="${escapeXml(def.name)}"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="${def.group === 'Plain' ? 40 : 46}"/>`,
    '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>',
    rPr(whole),
    `<w:tblPr><w:tblStyleRowBandSize w:val="1"/><w:tblStyleColBandSize w:val="1"/>${bordersXml('tblBorders', whole.borders)}</w:tblPr>`,
    whole.fill ? `<w:tcPr>${shd(whole.fill)}</w:tcPr>` : '',
  ];
  for (const name of PART_ORDER) {
    if (name === 'whole') continue;
    const p = def.parts[name];
    if (!p) continue;
    const tc = bordersXml('tcBorders', p.borders) + shd(p.fill);
    out.push(`<w:tblStylePr w:type="${PART_TYPE[name]}">${rPr(p)}<w:tblPr/>${tc ? `<w:tcPr>${tc}</w:tcPr>` : ''}</w:tblStylePr>`);
  }
  out.push('</w:style>');
  return out.join('');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------- reading

type Attr = (el: Element | null | undefined, name?: string) => string | null;

/** A border element read back (null when it isn't a border Word draws, or isn't one at all). */
export function readBorder(el: Element | null, a: Attr): BorderLine | null {
  if (!el) return null;
  const v = (a(el) ?? 'nil').toLowerCase();
  if (v === 'nil' || v === 'none') return { style: 'none', w: 0, color: '#000000' };
  const sz = Number(a(el, 'sz') ?? 4);
  const col = a(el, 'color');
  const color = col && /^[0-9a-f]{6}$/i.test(col) ? `#${col.toLowerCase()}` : '#000000';
  const style: BorderLine['style'] = /double|triple|thinThick|thickThin/i.test(v) ? 'double' : /dot(?!Dash)/i.test(v) && !/dash/i.test(v) ? 'dotted' : /dash/i.test(v) ? 'dashed' : 'single';
  return { style, w: Math.max(0.25, (Number.isFinite(sz) ? sz : 4) / 8), color };
}

export function readBorders(el: Element | null, a: Attr): Partial<Record<StyleEdge, BorderLine>> {
  const out: Partial<Record<StyleEdge, BorderLine>> = {};
  for (const c of kids(el)) {
    const name = c.localName === 'start' ? 'left' : c.localName === 'end' ? 'right' : c.localName;
    if (!EDGE_ORDER.includes(name as StyleEdge)) continue;
    const b = readBorder(c, a);
    if (b) out[name as StyleEdge] = b;
  }
  return out;
}

export function readMargins(el: Element | null, a: Attr): Partial<CellMargins> {
  const out: Partial<CellMargins> = {};
  for (const c of kids(el)) {
    const name = c.localName === 'start' ? 'left' : c.localName === 'end' ? 'right' : c.localName;
    if (name !== 'top' && name !== 'bottom' && name !== 'left' && name !== 'right') continue;
    const type = a(c, 'type');
    const w = Number(a(c, 'w'));
    if (!Number.isFinite(w) || (type && type !== 'dxa')) continue;
    out[name] = Math.max(0, w / 20);
  }
  return out;
}

/** A table's w:tblLook: its attributes, or the older bit mask. */
export function readLook(el: Element | null, a: Attr): TableLook | undefined {
  if (!el) return undefined;
  const at = (n: string) => { const v = a(el, n); return v === null ? undefined : /^(1|true|on)$/i.test(v); };
  const mask = parseInt(a(el) ?? '', 16);
  const bit = (b: number) => (Number.isFinite(mask) ? (mask & b) !== 0 : undefined);
  const header = at('firstRow') ?? bit(0x20), total = at('lastRow') ?? bit(0x40), firstCol = at('firstColumn') ?? bit(0x80), lastCol = at('lastColumn') ?? bit(0x100);
  const noH = at('noHBand') ?? bit(0x200), noV = at('noVBand') ?? bit(0x400);
  const look: TableLook = {};
  if (header !== undefined) look.header = header;
  if (total !== undefined) look.total = total;
  if (firstCol !== undefined) look.firstCol = firstCol;
  if (lastCol !== undefined) look.lastCol = lastCol;
  if (noH !== undefined) look.bandRows = !noH;
  if (noV !== undefined) look.bandCols = !noV;
  return look;
}

const TYPE_PART: Record<string, PartName> = {
  firstRow: 'firstRow', lastRow: 'lastRow', firstCol: 'firstCol', lastCol: 'lastCol', band1Horz: 'band1H', band2Horz: 'band2H', band1Vert: 'band1V', band2Vert: 'band2V',
};

function readPart(rpr: Element | null, tcpr: Element | null, borders: Element | null, a: Attr, on: (el: Element | null) => boolean): StylePart {
  const p: StylePart = {};
  const b = kid(rpr, 'b');
  if (b) p.bold = on(b);
  const i = kid(rpr, 'i');
  if (i) p.italic = on(i);
  const col = a(kid(rpr, 'color'));
  if (col && /^[0-9a-f]{6}$/i.test(col)) p.color = `#${col.toLowerCase()}`;
  const fill = a(kid(tcpr, 'shd'), 'fill');
  if (fill && /^[0-9a-f]{6}$/i.test(fill)) p.fill = `#${fill.toLowerCase()}`;
  const bs = readBorders(borders, a);
  if (Object.keys(bs).length) p.borders = bs;
  return p;
}

/**
 * A Word table style read from styles.xml, its own settings over those of the styles it is
 * based on (`chain`, the first style first, the style itself last).
 */
export function readTableStyle(id: string, name: string, chain: Element[], a: Attr, on: (el: Element | null) => boolean): TableStyleDef {
  const parts: TableStyleDef['parts'] = {};
  const mergePart = (k: PartName, p: StylePart) => {
    if (!Object.keys(p).length) return;
    const was = parts[k] ?? {};
    parts[k] = { ...was, ...p, ...(p.borders || was.borders ? { borders: { ...was.borders, ...p.borders } } : {}) };
  };
  for (const el of chain) {
    mergePart('whole', readPart(kid(el, 'rPr'), kid(el, 'tcPr'), kid(el, 'tblPr', 'tblBorders') ?? kid(el, 'tcPr', 'tcBorders'), a, on));
    for (const sp of kids(el, 'tblStylePr')) {
      const k = TYPE_PART[a(sp, 'type') ?? ''];
      if (!k) continue;
      mergePart(k, readPart(kid(sp, 'rPr'), kid(sp, 'tcPr'), kid(sp, 'tcPr', 'tcBorders') ?? kid(sp, 'tblPr', 'tblBorders'), a, on));
    }
  }
  return { id, name, group: 'Custom', parts };
}

/** Does a style do more than draw lines round every cell (shading, text, or parts of its own)? */
export function styleIsRich(def: TableStyleDef): boolean {
  const w = def.parts.whole;
  if (w && (w.fill || w.color || w.bold !== undefined || w.italic !== undefined)) return true;
  return Object.keys(def.parts).some((k) => k !== 'whole' && Object.keys(def.parts[k as PartName] ?? {}).length);
}

/** Two styles that draw the same (to tell a built-in style written here from one changed in Word). */
export function sameStyle(a: TableStyleDef, b: TableStyleDef): boolean {
  return canon(a.parts) === canon(b.parts);
}

function canon(parts: TableStyleDef['parts']): string {
  const out: Record<string, unknown> = {};
  for (const k of [...PART_ORDER].sort()) {
    const p = parts[k];
    if (!p) continue;
    const q: Record<string, unknown> = {};
    if (p.fill) q.fill = p.fill.toLowerCase();
    if (p.color) q.color = p.color.toLowerCase();
    if (p.bold !== undefined) q.bold = p.bold;
    if (p.italic !== undefined) q.italic = p.italic;
    if (p.borders) {
      const bs: Record<string, unknown> = {};
      for (const e of [...EDGE_ORDER].sort()) {
        const b = p.borders[e];
        if (!b) continue;
        bs[e] = b.style === 'none' ? 'none' : `${b.style}/${Math.round(b.w * 8)}/${b.color.toLowerCase()}`;
      }
      if (Object.keys(bs).length) q.borders = bs;
    }
    if (Object.keys(q).length) out[k] = q;
  }
  return JSON.stringify(out);
}

/**
 * The lines a Word table draws itself (its w:tblBorders and each cell's w:tcBorders), kept as
 * cell borders where they differ from what the table's style (or lines) draws here. On an edge
 * two cells share, a cell's own line wins over the table's, as in Word.
 */
export function keepDirectBorders(t: TableData, table: Partial<Record<StyleEdge, BorderLine>>, cells: (CellBorders | undefined)[][], kept?: Record<string, TableStyleDef>): TableData {
  const n = t.rows.length, m = t.cols.length;
  if (!n || !m) return t;
  const base = resolveTable(t, kept);
  const shown = (x: BorderLine | null | undefined) => (x && x.style !== 'none' ? x : null);
  const same = (x: BorderLine | null | undefined, y: BorderLine | null | undefined) => {
    const nx = shown(x), ny = shown(y);
    if (!nx || !ny) return !nx && !ny;
    return nx.style === ny.style && Math.abs(nx.w - ny.w) < 0.07 && nx.color.toLowerCase() === ny.color.toLowerCase();
  };
  const ownOf = (r: number, c: number) => { const o = coveringCell(t, r, c); return { o, b: cells[o.r]?.[o.c] }; };
  // the line Word draws on an edge from the two cells' own lines, else the table's
  const effective = (a: BorderLine | undefined, b: BorderLine | undefined, tableLine: BorderLine | undefined): BorderLine | undefined => {
    if (a || b) {
      const sa = shown(a), sb = shown(b);
      if (!sa && !sb) return a ?? b;
      if (!sa) return sb!;
      if (!sb) return sa;
      return sb.w * (sb.style === 'double' ? 3 : 1) > sa.w * (sa.style === 'double' ? 3 : 1) ? sb : sa;
    }
    return tableLine;
  };
  const want = new Map<string, CellBorders>();
  const put = (o: { r: number; c: number }, side: BorderSide, x: BorderLine) => {
    const k = `${o.r},${o.c}`;
    want.set(k, { ...want.get(k), [side]: x });
  };
  for (let r = 0; r <= n; r++) {
    for (let c = 0; c < m; c++) {
      const up = r > 0 ? ownOf(r - 1, c) : null, down = r < n ? ownOf(r, c) : null;
      if (up && down && up.o.r === down.o.r && up.o.c === down.o.c) continue;
      const x = effective(up?.b?.bottom, down?.b?.top, r === 0 ? table.top : r === n ? table.bottom : table.insideH);
      if (!x || same(x, base.h[r][c])) continue;
      if (up) put(up.o, 'bottom', x);
      if (down) put(down.o, 'top', x);
    }
  }
  for (let r = 0; r < n; r++) {
    for (let c = 0; c <= m; c++) {
      const left = c > 0 ? ownOf(r, c - 1) : null, right = c < m ? ownOf(r, c) : null;
      if (left && right && left.o.r === right.o.r && left.o.c === right.o.c) continue;
      const x = effective(left?.b?.right, right?.b?.left, c === 0 ? table.left : c === m ? table.right : table.insideV);
      if (!x || same(x, base.v[r][c])) continue;
      if (left) put(left.o, 'right', x);
      if (right) put(right.o, 'left', x);
    }
  }
  if (!want.size) return t;
  return {
    ...t,
    rows: t.rows.map((row, r) => row.map((cell, c) => {
      const w = want.get(`${r},${c}`);
      return w ? { ...cell, borders: { ...cell.borders, ...w } } : cell;
    })),
  };
}
