// Accessibility: alt text on pictures, charts and structures, and the checker (Review > Check
// Accessibility) that finds what makes a drawing, deck, document or workbook hard to use with a
// screen reader or for people with low vision: things with no alt text, text that doesn't stand
// out from what is behind it, slides without titles, headings that skip a level, and things read
// out of order. The contrast rule is WCAG 2.2's (success criterion 1.4.3): 4.5 to 1, or 3 to 1
// for large text (18 pt, or 14 pt bold); the rest follow what Office's own checkers look for.

import type { Doc, Atom, Caption, Shape, Contents } from './model';

const isEmptyText = (c: Pick<Caption, 'runs'>): boolean => !c.runs.some((r) => r.text.trim());
import type { DocText } from './document/document';
import { usedObjects, floatOf } from './document/document';
import { headingsOf } from './document/navigation';
import type { Workbook } from './sheet/workbook';
import { rowOf, colOf, cellName } from './sheet/refs';

// ---------------------------------------------------------------- alt text

/** A structure's own alt text: the first set on one of its atoms (none: it is described by its SMILES). */
export function structureAlt(atoms: Iterable<Atom>): string | undefined {
  let best: Atom | undefined;
  for (const a of atoms) if (a.alt?.trim() && (!best || a.id < best.id)) best = a;
  return best?.alt?.trim();
}

/** The alt text of the structures in a drawing's contents (their own, joined), if any. */
export function contentsAlt(c: Pick<Contents, 'atoms'>): string | undefined {
  const seen = new Set<string>();
  for (const a of [...c.atoms].sort((x, y) => x.id - y.id)) if (a.alt?.trim()) seen.add(a.alt.trim());
  return seen.size ? [...seen].join(' ') : undefined;
}

/** Give the structure `atomId` is in its alt text (empty takes it off): kept on its first atom. One undo step. */
export function setStructureAlt(doc: Doc, atomId: number, text: string): void {
  const frag = [...doc.fragmentOf(atomId)].sort((a, b) => a - b);
  if (!frag.length) return;
  const t = text.trim();
  doc.edit('Alt text', () => {
    for (const id of frag) if (doc.atoms.get(id)?.alt) doc.updateAtom(id, { alt: undefined });
    if (t) doc.updateAtom(frag[0], { alt: t });
  });
}

// ---------------------------------------------------------------- contrast

/** A colour's relative luminance (WCAG 2.2), from "#rrggbb" or "#rgb". */
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const ch = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** How much two colours differ in brightness, 1 (the same) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The least contrast text needs: 3 to 1 when large (18 pt, or 14 pt and bold), 4.5 to 1 otherwise. */
export function neededContrast(size: number, bold: boolean): number {
  return size >= 18 || (bold && size >= 14) ? 3 : 4.5;
}

const isHex = (c: string | undefined): c is string => !!c && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);

// ---------------------------------------------------------------- the checker

export type IssueLevel = 'error' | 'warning' | 'tip';

/** What an issue is about, so the pane can go to it (and fix the alt text there). */
export type IssuePlace =
  | { kind: 'drawing'; slide?: number; atoms?: number[]; shapes?: number[]; captions?: number[] }
  | { kind: 'doc-object'; id: number }
  | { kind: 'doc-para'; para: number }
  | { kind: 'cell'; sheet: number; row: number; col: number }
  | { kind: 'sheet-object'; sheet: number; id: number }
  | { kind: 'sheet-chart'; sheet: number; id: number }
  | { kind: 'sheet'; sheet: number };

export interface Issue {
  level: IssueLevel;
  /** The rule broken: issues are grouped by it. */
  rule: Rule;
  /** What and where, in a few words ("Picture 2 on slide 3"). */
  where: string;
  place: IssuePlace;
  /** More about this one (the colours and their contrast, the heading levels). */
  detail?: string;
}

export type Rule = 'alt-missing' | 'alt-smiles' | 'contrast' | 'slide-title' | 'title-repeated' | 'reading-order' | 'heading-order' | 'table-header' | 'floating' | 'merged-cells' | 'sheet-name';

/** Each rule's name in the pane, how much it matters, why, and how to fix it. */
export const RULES: Record<Rule, { name: string; level: IssueLevel; why: string; fix: string }> = {
  'alt-missing': { name: 'Missing alt text', level: 'error', why: 'Screen readers read alt text out in place of a picture or chart. Without it, people who can\'t see it miss what it shows.', fix: 'Select it and choose Alt Text… (right-click) to say in a sentence or two what it shows.' },
  'alt-smiles': { name: 'Structure described only by its SMILES', level: 'tip', why: 'A structure with no alt text of its own is described by its SMILES, which a screen reader spells out a character at a time.', fix: 'Add alt text that names the compound or says what the scheme shows (Alt Text… on the right-click menu). The SMILES stays in the file for programs to read.' },
  contrast: { name: 'Hard-to-read text contrast', level: 'warning', why: 'Text needs to stand out from what is behind it: a contrast of at least 4.5 to 1, or 3 to 1 for large text (WCAG 2.2).', fix: 'Make the text darker or the background lighter (or the other way round).' },
  'slide-title': { name: 'Missing slide title', level: 'error', why: 'Screen reader users go from slide to slide by their titles, and the titles name the slides in outlines and the slide list.', fix: 'Type a title into the slide\'s title placeholder (choose a layout with a title if it has none). It can be off the slide if it shouldn\'t show.' },
  'title-repeated': { name: 'Duplicate slide title', level: 'warning', why: 'Slides with the same title are hard to tell apart when going from slide to slide by title.', fix: 'Give each slide its own title ("Results (2 of 3)").' },
  'reading-order': { name: 'Check reading order', level: 'warning', why: 'A screen reader reads a slide\'s things in the order they are stacked (the order they are saved), which can differ from the order they are seen.', fix: 'Move the title so it doesn\'t overlap other things (it is then read first), or bring the things to the front in the order they should be read.' },
  'heading-order': { name: 'Skipped heading level', level: 'warning', why: 'Headings give a document its outline. A heading more than one level below the one before it makes the outline hard to follow.', fix: 'Use the next level down (Heading 2 after Heading 1).' },
  'table-header': { name: 'Missing table header', level: 'warning', why: 'Header rows let screen readers say which column a cell is in.', fix: 'Make the first row a heading row (Table Design > Header Row, or Format Table).' },
  floating: { name: 'Object not in line with text', level: 'warning', why: 'Screen readers can lose their place round things that float over or behind the text.', fix: 'Set Wrap Text to In Line with Text (right-click), and put it after the paragraph it belongs to.' },
  'merged-cells': { name: 'Merged cells', level: 'warning', why: 'Screen readers count cells across and down to say where they are; merged cells throw the count out.', fix: 'Unmerge them (Home > Merge & Centre), and use Centre Across Selection for a title instead.' },
  'sheet-name': { name: 'Default sheet name', level: 'tip', why: 'A name that says what a sheet holds helps everyone find their way round the workbook.', fix: 'Double-click the sheet\'s tab and give it a name.' },
};

const issue = (rule: Rule, where: string, place: IssuePlace, detail?: string): Issue => ({ level: RULES[rule].level, rule, where, place, ...(detail ? { detail } : {}) });

/** A caption's plain text, shortened to name it in the pane. */
function captionName(c: Pick<Caption, 'runs'>): string {
  const t = c.runs.map((r) => r.text).join('').replace(/\s+/g, ' ').trim();
  return t.length > 30 ? `"${t.slice(0, 28)}…"` : `"${t}"`;
}

function shapeName(s: Shape, n: number): string {
  if (s.name?.trim()) return s.name.trim();
  if (s.chart) return `Chart ${n}`;
  if (s.math) return `Equation ${n}`;
  if (s.video) return s.video.audio ? `Sound ${n}` : `Video ${n}`;
  return `Picture ${n}`;
}

const boxOf = (s: Pick<Shape, 'x1' | 'y1' | 'x2' | 'y2'>) => ({ x1: Math.min(s.x1, s.x2), y1: Math.min(s.y1, s.y2), x2: Math.max(s.x1, s.x2), y2: Math.max(s.y1, s.y2) });
type Box = { x1: number; y1: number; x2: number; y2: number };
const overlaps = (a: Box, b: Box) => a.x1 < b.x2 - 0.5 && b.x1 < a.x2 - 0.5 && a.y1 < b.y2 - 0.5 && b.y1 < a.y2 - 0.5;
const holds = (a: Box, x: number, y: number) => x >= a.x1 && x <= a.x2 && y >= a.y1 && y <= a.y2;

export interface DrawingCheck {
  /** Which slide (for slides), counted from 0. */
  slide?: number;
  /** A caption's box on the page (the renderer's, when it is drawing this one; roughly worked out when not given). */
  captionBox?(c: Caption): Box;
  /** Look for slide titles (slides only). */
  slideTitle?: boolean;
}

/** Roughly where a caption's text is: its placeholder's box, or its lines at about half an em a character. */
export function roughCaptionBox(c: Caption, size: number): Box {
  if (c.wrap && c.boxH) {
    const top = c.y - 0.9 * size;
    return { x1: c.x, y1: top, x2: c.x + c.wrap, y2: top + c.boxH };
  }
  const lines = c.runs.map((r) => r.text).join('').split('\n');
  const w = c.wrap ?? Math.max(...lines.map((l) => l.length)) * size * 0.5;
  return { x1: c.x, y1: c.y - 0.9 * size, x2: c.x + w, y2: c.y + (lines.length - 0.6) * size * 1.2 };
}

/** What makes a drawing (or one slide, or a design) hard to use with a screen reader or to read. */
export function checkDrawing(doc: Doc, opts: DrawingCheck = {}): Issue[] {
  const out: Issue[] = [];
  const base = (c: Caption) => (c.ph ? doc.textStyles?.[c.ph] : undefined);
  const textColor = (c: Caption) => base(c)?.color ?? '#000000';
  const captionBox = (c: Caption) => opts.captionBox?.(c) ?? roughCaptionBox(c, base(c)?.size ?? c.runs[0]?.size ?? 12);
  const on = opts.slide !== undefined ? ` on slide ${opts.slide + 1}` : '';
  const at = (p: Omit<Extract<IssuePlace, { kind: 'drawing' }>, 'kind'>): IssuePlace => ({ kind: 'drawing', ...(opts.slide !== undefined ? { slide: opts.slide } : {}), ...p });
  // pictures and charts without alt text
  let n = 0;
  for (const s of doc.shapes.values()) {
    if (s.kind !== 'picture' || s.hidden || s.picture) continue;
    n++;
    // an equation reads as its LaTeX
    if (s.math || s.alt?.trim()) continue;
    out.push(issue('alt-missing', `${shapeName(s, n)}${on}`, at({ shapes: [s.id] })));
  }
  // structures with only their SMILES
  let k = 0;
  for (const frag of doc.fragments()) {
    const atoms = [...frag].map((id) => doc.atoms.get(id)).filter((a): a is Atom => !!a && !a.attach && !a.multi);
    if (atoms.length < 2 && !atoms.some((a) => a.label || a.z !== 6)) continue;
    k++;
    if (!structureAlt(atoms)) out.push(issue('alt-smiles', `Structure ${k}${on}`, at({ atoms: atoms.map((a) => a.id) })));
  }
  // text that doesn't stand out from what is behind it
  const filled = [...doc.shapes.values()].filter((s) => (s.kind === 'rect' || s.kind === 'oval' || s.kind === 'geo') && s.filled && !s.hidden && (s.transparency ?? 0) < 0.5)
    .sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  const bgAt = (b: Box) => {
    const mx = (b.x1 + b.x2) / 2, my = (b.y1 + b.y2) / 2;
    let bg = doc.background;
    for (const s of filled) if (holds(boxOf(s), mx, my)) bg = s.fillColor ?? s.color ?? bg;
    return bg;
  };
  for (const c of doc.captions.values()) {
    if (c.hidden || isEmptyText(c)) continue;
    const bg = bgAt(captionBox(c));
    if (!isHex(bg)) continue;
    let worst: { ratio: number; need: number; fg: string } | null = null;
    for (const r of c.runs) {
      if (!r.text.trim()) continue;
      const fg = r.color ?? textColor(c);
      if (!isHex(fg)) continue;
      const ratio = contrastRatio(fg, bg), need = neededContrast(r.size ?? base(c)?.size ?? 12, !!(r.bold ?? base(c)?.bold));
      if (ratio < need && (!worst || ratio < worst.ratio)) worst = { ratio, need, fg };
    }
    if (worst) out.push(issue('contrast', `Text ${captionName(c)}${on}`, at({ captions: [c.id] }), `${worst.fg} on ${bg}: ${worst.ratio.toFixed(1)} to 1 (needs ${worst.need} to 1)`));
  }
  for (const s of doc.shapes.values()) {
    if (!s.text?.runs.some((r) => r.text.trim()) || s.hidden) continue;
    const bg = s.filled ? s.fillColor ?? s.color : bgAt(boxOf(s));
    if (!isHex(bg)) continue;
    for (const r of s.text.runs) {
      const fg = r.color ?? '#000000';
      if (!r.text.trim() || !isHex(fg)) continue;
      const ratio = contrastRatio(fg, bg), need = neededContrast(r.size ?? 12, !!r.bold);
      if (ratio < need) { out.push(issue('contrast', `Text in ${s.name?.trim() || 'a shape'}${on}`, at({ shapes: [s.id] }), `${fg} on ${bg}: ${ratio.toFixed(1)} to 1 (needs ${need} to 1)`)); break; }
    }
  }
  if (opts.slideTitle) {
    const title = [...doc.captions.values()].find((c) => c.ph === 'title');
    if (!title || isEmptyText(title)) out.push(issue('slide-title', `Slide ${(opts.slide ?? 0) + 1}`, at(title ? { captions: [title.id] } : {})));
    else if (titleOverlaps(doc, title, captionBox(title))) out.push(issue('reading-order', `Slide ${(opts.slide ?? 0) + 1}`, at({ captions: [title.id] }), 'The title overlaps other things, so it is read after them'));
  }
  return out;
}

/** Does a slide's title overlap anything else on it (so it can't be read first without changing how the slide looks)? */
export function titleOverlaps(doc: Doc, title: Caption, box: Box): boolean {
  for (const s of doc.shapes.values()) if (!s.hidden && !s.ring && !s.pin && overlaps(box, boxOf(s))) return true;
  for (const a of doc.atoms.values()) if (holds(box, a.x, a.y)) return true;
  for (const r of doc.arrows.values()) if (overlaps(box, { x1: Math.min(r.tail.x, r.head.x), y1: Math.min(r.tail.y, r.head.y), x2: Math.max(r.tail.x, r.head.x), y2: Math.max(r.tail.y, r.head.y) })) return true;
  return false;
}

/** The slide titles that more than one slide has (by their text), for the checker. */
export function repeatedTitles(titles: (string | null)[]): Issue[] {
  const out: Issue[] = [];
  const seen = new Map<string, number>();
  titles.forEach((t, i) => {
    const key = t?.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!key) return;
    const first = seen.get(key);
    if (first === undefined) seen.set(key, i);
    else out.push(issue('title-repeated', `Slide ${i + 1}`, { kind: 'drawing', slide: i }, `Same title as slide ${first + 1}: "${t!.trim()}"`));
  });
  return out;
}

/** What makes a document hard to use with a screen reader or to read. */
export function checkDocument(t: DocText, page = '#ffffff'): Issue[] {
  const out: Issue[] = [];
  let pics = 0, charts = 0, figs = 0, tables = 0;
  for (const id of usedObjects(t)) {
    const o = t.objects[id];
    if (!o) continue;
    if (o.kind === 'picture') {
      const name = o.chart ? `Chart ${++charts}` : `Picture ${++pics}`;
      if (!o.alt?.trim()) out.push(issue('alt-missing', name, { kind: 'doc-object', id }));
    } else if (o.kind === 'drawing') {
      figs++;
      if (o.contents.atoms.length && !o.alt?.trim() && !contentsAlt(o.contents)) out.push(issue('alt-smiles', `Structure or scheme ${figs}`, { kind: 'doc-object', id }));
    } else if (o.kind === 'table') {
      tables++;
      if (!o.table.head && o.table.rows.length > 1) out.push(issue('table-header', `Table ${tables}`, { kind: 'doc-object', id }));
    }
    const fl = floatOf(o);
    if (fl && (fl.wrap === 'behind' || fl.wrap === 'front') && o.kind !== 'textbox') out.push(issue('floating', o.kind === 'drawing' ? `Structure or scheme ${figs}` : o.kind === 'picture' ? (o.chart ? `Chart ${charts}` : `Picture ${pics}`) : 'A text box', { kind: 'doc-object', id }, fl.wrap === 'behind' ? 'Behind the text' : 'In front of the text'));
  }
  // headings that skip a level
  let last = 0;
  for (const h of headingsOf(t)) {
    if (h.level > last + 1) out.push(issue('heading-order', `"${h.text.length > 30 ? h.text.slice(0, 28) + '…' : h.text}"`, { kind: 'doc-para', para: h.para }, `Heading ${h.level} after ${last ? `Heading ${last}` : 'the start of the document'}`));
    last = h.level;
  }
  // coloured text on the page (or its highlight)
  const bg = isHex(page) ? page : '#ffffff';
  let para = 0;
  const flagged = new Set<number>();
  for (const r of t.runs) {
    if (r.obj === undefined && r.text) {
      const back = isHex(r.highlight) ? r.highlight : bg;
      if (isHex(r.color) && r.text.trim() && !flagged.has(para)) {
        const ratio = contrastRatio(r.color, back), need = neededContrast(r.size ?? 11, !!r.bold);
        if (ratio < need) {
          flagged.add(para);
          out.push(issue('contrast', `Text "${r.text.trim().slice(0, 28)}${r.text.trim().length > 28 ? '…' : ''}"`, { kind: 'doc-para', para }, `${r.color} on ${back}: ${ratio.toFixed(1)} to 1 (needs ${need} to 1)`));
        }
      }
      para += (r.text.match(/\n/g) ?? []).length;
    }
  }
  return out;
}

/** What makes a workbook hard to use with a screen reader or to read. */
export function checkWorkbook(book: Workbook): Issue[] {
  const out: Issue[] = [];
  book.sheets.forEach((s, si) => {
    const on = ` on ${s.name}`;
    let pics = 0;
    for (const o of s.objects) {
      if (o.kind !== 'picture') continue;
      pics++;
      if (!o.descr?.trim()) out.push(issue('alt-missing', `Picture ${pics}${on}`, { kind: 'sheet-object', sheet: si, id: o.id }));
    }
    s.charts.forEach((c, i) => {
      if (!c.alt?.trim()) out.push(issue('alt-missing', `${c.title?.trim() ? `Chart "${c.title.trim()}"` : `Chart ${i + 1}`}${on}`, { kind: 'sheet-chart', sheet: si, id: c.id }));
    });
    for (const m of s.merges) out.push(issue('merged-cells', `${cellName(m.r1, m.c1)}:${cellName(m.r2, m.c2)}${on}`, { kind: 'cell', sheet: si, row: m.r1, col: m.c1 }));
    for (const tb of s.tables) if (!tb.header) out.push(issue('table-header', `Table ${tb.name ?? ''}${on}`.replace('  ', ' '), { kind: 'cell', sheet: si, row: tb.range.r1, col: tb.range.c1 }));
    if (/^Sheet\d+$/i.test(s.name) && book.sheets.length > 1) out.push(issue('sheet-name', s.name, { kind: 'sheet', sheet: si }));
    // coloured text on a coloured fill (or the white page)
    let shown = 0;
    for (const [k, cell] of s.cells) {
      const st = cell.style;
      if (!st || (!st.color && !st.fill) || !(cell.input ?? '').trim()) continue;
      const fg = isHex(st.color) ? st.color : '#000000', bg = isHex(st.fill) ? st.fill : '#ffffff';
      const ratio = contrastRatio(fg, bg), need = neededContrast(st.size ?? 11, !!st.bold);
      if (ratio >= need) continue;
      if (++shown > 50) break;
      out.push(issue('contrast', `${cellName(rowOf(k), colOf(k))}${on}`, { kind: 'cell', sheet: si, row: rowOf(k), col: colOf(k) }, `${fg} on ${bg}: ${ratio.toFixed(1)} to 1 (needs ${need} to 1)`));
    }
  });
  return out;
}

/** Issues grouped by rule, errors first, then warnings, then tips. */
export function groupIssues(list: Issue[]): { rule: Rule; level: IssueLevel; items: Issue[] }[] {
  const order: IssueLevel[] = ['error', 'warning', 'tip'];
  const groups = new Map<Rule, Issue[]>();
  for (const i of list) groups.set(i.rule, [...(groups.get(i.rule) ?? []), i]);
  return [...groups].map(([rule, items]) => ({ rule, level: RULES[rule].level, items }))
    .sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
}

