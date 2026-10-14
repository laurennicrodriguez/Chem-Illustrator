// Reading ChemDraw CDXML files: structures (atoms, bonds, abbreviations), captions with
// their formatting, arrows, and the common graphics (lines, boxes, circles, brackets,
// charge symbols). Anything not understood yet is counted and skipped, never fatal.

import { Doc, Atom, Bond, BondDisplay, TextRun, Arrow, Shape, Entity, Kind, StereoLabel, Caption, StepRoles } from '../model';
import { TEXT_TAG, parseTextTag, runsFromChemDraw } from '../text/chemdraw-text';
import { DocStyle } from '../style';
import { elementNumber, hasImplicitH, implicitHydrogens, SYMBOLS } from '../chem/elements';
import { DEG } from '../geom';
import { kids, descendants } from './xml';
import { styleFromFace, isSymbolFont, fromSymbolFont } from '../richtext';
import { dataUrl, fromDataUrl, imageSize } from '../render/images';
import { emfToSvg } from '../render/emf-read';
import { TABLE_TAG, TABLE_PART_TAG, applyTableTag, gridOf, linesFromBorders, parseTableTag, type ReadCell } from './cdxml-table';
import { layoutTable, NOTE_SCALE } from '../table';
import { arialWidth } from '../text-metrics';

export interface ReadStats {
  atoms: number;
  bonds: number;
  captions: number;
  arrows: number;
  shapes: number;
  skipped: Record<string, number>;
  parseMs: number;
  buildMs: number;
}

/** The captions grouped with a table: its title, footnotes, and the text of joined cells by "row column". */
interface TableParts { title?: Element; notes?: Element; cells?: [string, Element][] }

const num = (el: Element, name: string, def = 0): number => {
  const v = el.getAttribute(name);
  if (v === null) return def;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
};

const pts = (v: string | null): number[] => (v ? v.trim().split(/\s+/).map(Number) : []);

export function readCdxml(text: string): { doc: Doc; stats: ReadStats } {
  const t0 = performance.now();
  // ChemDraw writes a DOCTYPE pointing at a web address; drop it so nothing is fetched.
  const xml = new DOMParser().parseFromString(text.replace(/<!DOCTYPE[^>]*>/i, ''), 'application/xml');
  const t1 = performance.now();
  const root = xml.documentElement;
  if (!root || root.nodeName !== 'CDXML') throw new Error('This does not look like a CDXML file.');
  const doc = new Doc();
  // Remember where each object came from, so saving can rewrite only what changed.
  const all = descendants(root);
  const ordOf = new Map<Element, number>();
  let maxId = 0;
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    ordOf.set(el, i);
    const v = Number(el.getAttribute('id'));
    if (v > maxId) maxId = v;
  }
  const ord = new Map<string, number>();
  /** Which entity each element became (kind + id), for the references in reaction steps. */
  const refOf = new Map<Element, string>();
  const from = (kind: Kind, id: number, el: Element) => { ord.set(kind + id, ordOf.get(el)!); refOf.set(el, kind + id); };
  const stats: ReadStats = { atoms: 0, bonds: 0, captions: 0, arrows: 0, shapes: 0, skipped: {}, parseMs: t1 - t0, buildMs: 0 };
  const skip = (what: string) => { stats.skipped[what] = (stats.skipped[what] ?? 0) + 1; };

  // Document style.
  const st: DocStyle = { ...doc.style, name: 'From file' };
  st.bondLength = num(root, 'BondLength', 30);
  st.lineWidth = num(root, 'LineWidth', 1);
  st.boldWidth = num(root, 'BoldWidth', 4);
  st.marginWidth = num(root, 'MarginWidth', 2);
  st.hashSpacing = num(root, 'HashSpacing', 2.7);
  st.bondSpacing = num(root, 'BondSpacing', 12);
  st.chainAngle = num(root, 'ChainAngle', 120);
  st.labelSize = num(root, 'LabelSize', 10);
  st.captionSize = num(root, 'CaptionSize', 12);
  st.captionFace = num(root, 'CaptionFace', 0);
  doc.style = st;

  // Colours: index 0 is black and 1 white; the colour table starts at index 2.
  const colors: string[] = ['#000000', '#ffffff'];
  const ct = all.find((e) => e.nodeName === 'colortable');
  if (ct) {
    for (const c of kids(ct)) {
      if (c.nodeName !== 'color') continue;
      const h = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0');
      colors.push('#' + h(num(c, 'r')) + h(num(c, 'g')) + h(num(c, 'b')));
    }
  }
  const color = (el: Element): string | undefined => {
    const v = el.getAttribute('color');
    if (v === null) return undefined;
    const c = colors[Number(v)];
    return c && c !== '#000000' ? c : undefined;
  };
  const bg = root.getAttribute('bgcolor');
  if (bg !== null && colors[Number(bg)]) doc.background = colors[Number(bg)];

  const fonts = new Map<string, string>();
  const ft = all.find((e) => e.nodeName === 'fonttable');
  if (ft) for (const f of kids(ft)) if (f.nodeName === 'font') fonts.set(f.getAttribute('id') ?? '', f.getAttribute('name') ?? 'Arial');

  // Charges drawn by a separate circled-charge graphic are not drawn again on the atom.
  const chargeShown = new Set<string>();
  for (const r of all) {
    if (r.nodeName === 'represent' && r.getAttribute('attribute') === 'Charge') chargeShown.add(r.getAttribute('object') ?? '');
  }

  /** The text pieces of a <t>. Symbol-font text becomes the characters it shows, unless `raw`. */
  const runsOf = (t: Element, raw = false): TextRun[] => {
    const out: TextRun[] = [];
    for (const s of kids(t)) {
      if (s.nodeName !== 's') continue;
      const face = num(s, 'face', 0);
      const fontName = fonts.get(s.getAttribute('font') ?? '');
      const run: TextRun = { text: s.textContent ?? '', ...styleFromFace(face) };
      const size = s.getAttribute('size');
      if (size !== null) run.size = Number(size);
      // Greek letters and signs written in the Symbol font become the characters they show
      if (isSymbolFont(fontName) && !raw) run.text = fromSymbolFont(run.text);
      else if (fontName && !/^arial$/i.test(fontName)) run.font = fontName;
      const c = color(s);
      if (c) run.color = c;
      out.push(run);
    }
    return out;
  };

  const usedIds = new Set<number>();
  const idFor = (el: Element): number => {
    const v = Number(el.getAttribute('id'));
    if (Number.isInteger(v) && v > 0 && !usedIds.has(v)) { usedIds.add(v); return v; }
    const n = doc.newId();
    usedIds.add(n);
    return n;
  };

  /** A stereo label (ChemDraw's objecttag named "stereo"), placed relative to (ox, oy). */
  const stereoTag = (tag: Element, ox: number, oy: number): StereoLabel | undefined => {
    const st = kids(tag).find((k) => k.nodeName === 't');
    const runs = st ? runsOf(st) : [];
    const [sx, sy] = pts(st?.getAttribute('p') ?? null);
    const text = runs.map((r) => r.text).join('');
    if (!text || !Number.isFinite(sx) || !Number.isFinite(sy) || st!.getAttribute('Visible') === 'no') return undefined;
    const l: StereoLabel = { text, dx: sx - ox, dy: sy - oy, size: runs[0].size ?? 4.5 };
    if (runs[0].italic) l.italic = true;
    return l;
  };

  interface PendingLabel { atom: Atom; text: string; hShown: number | null }
  const pendingLabels: PendingLabel[] = [];

  const readFragment = (frag: Element) => {
    const nodeIds = new Map<string, number>();
    for (const n of kids(frag)) {
      if (n.nodeName !== 'n') continue;
      const type = n.getAttribute('NodeType');
      const [x, y] = pts(n.getAttribute('p'));
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const id = idFor(n);
      if (type === 'ExternalConnectionPoint') {
        // a point of attachment drawn on its own (the wavy line ending a substituent)
        const a = doc.addAtom(x, y, 0, { id, attach: n.getAttribute('ExternalConnectionType') ?? 'Unspecified' });
        const num = Number(n.getAttribute('ExternalConnectionNum'));
        if (Number.isInteger(num) && num > 0) a.attachNum = num;
        from('a', a.id, n);
        nodeIds.set(n.getAttribute('id') ?? '', id);
        continue;
      }
      const z = num(n, 'Element', 6);
      const extra: Partial<Atom> = { id, charge: num(n, 'Charge', 0), isotope: num(n, 'Isotope', 0) };
      if (n.getAttribute('IgnoreWarnings') === 'yes') extra.ignoreWarnings = true;
      const rad = n.getAttribute('Radical');
      if (rad === 'Singlet' || rad === 'Doublet' || rad === 'Triplet') extra.radical = rad.toLowerCase() as Atom['radical'];
      const c = color(n);
      if (c) extra.color = c;
      if (chargeShown.has(n.getAttribute('id') ?? '')) extra.hideCharge = true;
      const ls = n.getAttribute('LabelSize');
      if (ls !== null) extra.s = Number(ls) / st.labelSize;
      let t: Element | null = null;
      for (const ch of kids(n)) {
        if (ch.nodeName === 't') t = ch;
        else if (ch.nodeName === 'objecttag' && ch.getAttribute('Name') === 'stereo') {
          // ChemDraw's (R)/(S) label beside the atom
          const l = stereoTag(ch, x, y);
          if (l) extra.stereoLabel = l;
        } else if (ch.nodeName === 'objecttag' && ch.getAttribute('Name') === 'number') {
          // where the atom number sits (the ' key)
          const l = stereoTag(ch, x, y);
          if (l) extra.numberLabel = { dx: l.dx, dy: l.dy, size: l.size };
        }
      }
      if (n.getAttribute('ShowAtomStereo') === 'yes') extra.showStereo = true;
      const atomNumber = n.getAttribute('AtomNumber');
      if (atomNumber) extra.atomNumber = atomNumber;
      if (n.getAttribute('ShowAtomNumber') === 'yes') extra.showNumber = true;
      const atom = doc.addAtom(x, y, z, extra);
      from('a', id, n);
      nodeIds.set(n.getAttribute('id') ?? '', id);
      stats.atoms++;
      if (t) {
        const runs = runsOf(t);
        let txt = runs.map((r) => r.text).join('');
        if (atom.charge) {
          // the charge is part of the label text ("N+", "O2−"); it is drawn from the charge instead
          const n = Math.abs(atom.charge);
          txt = txt.replace(new RegExp(`${n > 1 ? n : ''}[${atom.charge > 0 ? '+' : '\\-−'}]$`), '');
        }
        if (runs.some((r) => r.sup && /^\d+$/.test(r.text))) atom.supDigits = true;
        const size = runs[0]?.size;
        if (size && ls === null) atom.s = size / st.labelSize;
        const lj = t.getAttribute('LabelJustification');
        const la = t.getAttribute('LabelAlignment');
        if (la === 'Above' || la === 'Below') atom.just = 'auto';
        else if (la === 'Right' || lj === 'Right') atom.just = 'left';
        else if (la === 'Left' || lj === 'Left') atom.just = 'right';
        const nh = n.getAttribute('NumHydrogens');
        const isPlain = !type || type === 'Element';
        pendingLabels.push({ atom, text: txt, hShown: isPlain && nh !== null ? Number(nh) : isPlain ? null : -1 });
      }
    }
    for (const b of kids(frag)) {
      if (b.nodeName === 'graphic') readGraphic(b); // circled charges and lone pairs sit with their structure
      if (b.nodeName !== 'b') continue;
      let a1 = nodeIds.get(b.getAttribute('B') ?? '');
      let a2 = nodeIds.get(b.getAttribute('E') ?? '');
      if (a1 === undefined || a2 === undefined || a1 === a2) continue;
      const ord = b.getAttribute('Order') ?? '1';
      let order = ord === '2' ? 2 : ord === '3' ? 3 : ord === '1.5' ? 1.5 : 1;
      let display: BondDisplay = 'solid';
      const disp = b.getAttribute('Display');
      let swap = false;
      switch (disp) {
        case 'WedgeBegin': case 'HollowWedgeBegin': display = 'wedge'; break;
        case 'WedgeEnd': case 'HollowWedgeEnd': display = 'wedge'; swap = true; break;
        case 'WedgedHashBegin': display = 'hashWedge'; break;
        case 'WedgedHashEnd': display = 'hashWedge'; swap = true; break;
        case 'Hash': display = 'hash'; break;
        case 'Bold': display = 'bold'; break;
        case 'Dash': display = 'dash'; break;
        case 'Wavy': display = 'wavy'; break;
      }
      if (ord === 'hydrogen') display = 'dash';
      if (order === 2 && b.getAttribute('Display2') === 'Dash') order = 1.5;
      let dpos: Bond['dpos'] = 'auto';
      const dp = b.getAttribute('DoublePosition');
      if (dp === 'Center') dpos = 'center';
      else if (dp === 'Right') dpos = 'right';
      else if (dp === 'Left') dpos = 'left';
      if (swap) {
        [a1, a2] = [a2, a1];
        if (dpos === 'left') dpos = 'right'; else if (dpos === 'right') dpos = 'left';
      }
      const extra: Partial<Bond> = { id: idFor(b), dpos };
      if (b.getAttribute('IgnoreWarnings') === 'yes') extra.ignoreWarnings = true;
      if (b.getAttribute('ShowBondStereo') === 'yes') extra.showStereo = true;
      if (kids(b).some((k) => k.nodeName === 'objecttag' && k.getAttribute('Name') === CIRCLE_TAG)) extra.circle = true;
      // a bond crossing others: the higher Z is in front
      if (b.hasAttribute('CrossingBonds') && b.hasAttribute('Z')) extra.z = num(b, 'Z');
      const tag = kids(b).find((k) => k.nodeName === 'objecttag' && k.getAttribute('Name') === 'stereo');
      if (tag) {
        // ChemDraw's (E)/(Z) label by the double bond, kept relative to the bond's middle
        const p = doc.atoms.get(a1)!, q = doc.atoms.get(a2)!;
        const l = stereoTag(tag, (p.x + q.x) / 2, (p.y + q.y) / 2);
        if (l) extra.stereoLabel = l;
      }
      const lw = b.getAttribute('LineWidth');
      if (lw !== null) extra.s = Number(lw) / st.lineWidth;
      const c = color(b);
      if (c) extra.color = c;
      const bond = doc.addBond(a1, a2, order, display, extra);
      from('b', bond.id, b);
      stats.bonds++;
    }
  };

  const readCaption = (t: Element) => {
    const c = captionOf(t);
    if (!c) return;
    const cap = doc.addCaption({ id: idFor(t), ...c });
    from('c', cap.id, t);
    stats.captions++;
  };

  /** A caption's text and layout as read from its element (null for an empty or hidden one). */
  const captionOf = (t: Element): Omit<Caption, 'id'> | null => {
    const runs = runsOf(t, true);
    if (!runs.length || t.getAttribute('Visible') === 'no') return null;
    const [px, py] = pts(t.getAttribute('p'));
    const bb = pts(t.getAttribute('BoundingBox'));
    const j = t.getAttribute('Justification') ?? t.getAttribute('CaptionJustification');
    const justify = j === 'Center' ? 'center' : j === 'Right' ? 'right' : j === 'Full' ? 'justify' : 'left';
    const ww = Number(t.getAttribute('WordWrapWidth'));
    const wrap = ww > 0 ? ww : undefined;
    let x = px, width: number | undefined;
    if (wrap !== undefined) {
      // a text box: its lines wrap to its width, and p is on the side the lines are lined up on
      if (justify === 'center') x = px - wrap / 2;
      else if (justify === 'right') x = px - wrap;
    } else if (justify !== 'left' && bb.length === 4) {
      x = Math.min(bb[0], bb[2]);
      width = Math.abs(bb[2] - bb[0]);
    }
    for (const r of runs) if (r.size === undefined) r.size = st.captionSize;
    // ChemDraw stores where each line starts (as UTF-8 byte offsets). Without a wrap width those
    // are all line breaks; in a text box the lines wrap by themselves.
    const ls = t.getAttribute('LineStarts');
    if (ls && wrap === undefined) applyLineEnds(runs, ls.trim().split(/\s+/).map(Number).slice(0, -1));
    // (the line ends count the text as stored, so Symbol-font text is turned into Greek letters afterwards)
    for (const r of runs) if (isSymbolFont(r.font)) { r.text = fromSymbolFont(r.text); delete r.font; }
    const lh = t.getAttribute('LineHeight') ?? t.getAttribute('CaptionLineHeight');
    let lineHeight = lh && /^[\d.]+$/.test(lh) ? Number(lh) : undefined;
    // lists and paragraph formatting saved by this program, if the text still matches them
    const tagEl = kids(t).find((k) => k.nodeName === 'objecttag' && k.getAttribute('Name') === TEXT_TAG);
    const back = runsFromChemDraw(runs, parseTextTag(tagEl?.getAttribute('Value') ?? null));
    const extra: Partial<Caption> = {};
    if (wrap !== undefined) extra.wrap = wrap;
    if (back.paras) extra.paras = back.paras;
    if (back.lineSpacing) { extra.lineSpacing = back.lineSpacing; lineHeight = undefined; }
    return { x, y: py, runs: back.runs, justify, width, lineHeight, ...extra };
  };

  /**
   * A ChemDraw table: its cells' text, column widths and rules, with what this program tagged
   * on it (heading rows, alignment, joined cells), and its title and footnotes when they are
   * grouped with it. `outer` is the group holding them, which stands for the table when saving.
   */
  const readTable = (tbl: Element, outer: Element | null, parts: TableParts) => {
    const read: ReadCell[] = [];
    /** Add a text's runs to a cell (after any it has, on a new line). */
    const addText = (cell: ReadCell['cell'], t: Element) => {
      const c = captionOf(t);
      if (!c) return;
      if (cell.runs.length) cell.runs.push({ text: '\n' });
      cell.runs.push(...c.runs);
      if (c.paras) cell.paras = c.paras;
      // text lined up on purpose keeps it; ChemDraw's own text sits where it was clicked, so
      // it takes its column's alignment here
      if (t.getAttribute('Justification')) cell.align = c.justify;
    };
    for (const pg of kids(tbl)) {
      if (pg.nodeName !== 'page') continue;
      const bb = pts(pg.getAttribute('BoundingBox') ?? pg.getAttribute('BoundsInParent'));
      if (bb.length < 4) continue;
      const [x1, y1, x2, y2] = [Math.min(bb[0], bb[2]), Math.min(bb[1], bb[3]), Math.max(bb[0], bb[2]), Math.max(bb[1], bb[3])];
      // ChemDraw leaves out a border as wide as the drawing's lines (and keeps the ones it hides, at 0)
      const borders = { left: st.lineWidth, top: st.lineWidth, bottom: st.lineWidth, right: st.lineWidth };
      const cell: ReadCell['cell'] = { runs: [] };
      for (const ch of kids(pg)) {
        if (ch.nodeName === 'border') {
          const side = ch.getAttribute('Side') as keyof typeof borders | null;
          if (side && side in borders) borders[side] = num(ch, 'LineWidth', st.lineWidth);
        } else if (ch.nodeName === 't') addText(cell, ch);
        else if (ch.nodeName === 'fragment') {
          // ChemDraw turns text it can read as chemistry (Pd(OAc)2, THF) into a label; its text stays
          const label = labelText(ch);
          if (label) addText(cell, label);
          else skip('structure in a table cell');
        } else if (ch.nodeName !== 'objecttag') skip(`${ch.nodeName} in a table cell`);
      }
      read.push({ x1, y1, x2, y2, cell, borders });
    }
    const grid = gridOf(read);
    if (!grid) { skip('empty table'); return; }
    // the text of joined cells, kept beside the table
    for (const [key, t] of parts.cells ?? []) {
      const [r, c] = key.split(' ').map(Number);
      const at = grid.rows[r]?.[c];
      if (at) addText(at.cell, t);
    }
    // the size most of the text is set in becomes the table's own; runs keep any other size
    const sizes = new Map<number, number>();
    for (const row of grid.rows) for (const c of row) for (const r of c.cell.runs) if (r.size !== undefined && r.text.trim()) sizes.set(r.size, (sizes.get(r.size) ?? 0) + r.text.length);
    const common = [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? st.captionSize;
    const plain = (runs: TextRun[], size: number) => runs.map((r) => { if (r.size !== size) return r; const { size: _, ...rest } = r; return rest; });
    let table: NonNullable<Shape['table']> = {
      cols: grid.cols,
      rows: grid.rows.map((row) => row.map((c) => {
        const cell = { ...c.cell, runs: plain(c.cell.runs, common) };
        if (!cell.paras) delete cell.paras;
        return cell;
      })),
      head: 0,
      lines: 'acs',
    };
    if (common !== st.captionSize) table.size = common;
    const tagEl = kids(tbl).find((k) => k.nodeName === 'objecttag' && k.getAttribute('Name') === TABLE_TAG);
    const tag = parseTableTag(tagEl?.getAttribute('Value') ?? null);
    table = applyTableTag(table, tag, linesFromBorders(grid.rows.map((row) => row.map((c) => c.borders))));
    // with the tag, cells line up as their columns do unless they were set on their own
    if (tag) table.rows = table.rows.map((row, r) => row.map((cell, c) => {
      const own = tag.cellAlign?.some(([rr, cc]) => rr === r && cc === c);
      if (own || !cell.align) return cell;
      const { align: _, ...rest } = cell;
      return rest;
    }));
    const partRuns = (el: Element | undefined, size: number) => {
      const c = el ? captionOf(el) : null;
      return c ? plain(c.runs, size) : undefined;
    };
    const title = partRuns(parts.title, table.size ?? st.captionSize);
    const notes = partRuns(parts.notes, (table.size ?? st.captionSize) * NOTE_SCALE);
    if (title?.length) table.title = title;
    if (notes?.length) table.notes = notes;
    // the table's corner: its first cell, less the room its title takes
    const lay = layoutTable(table, st.captionSize, (t, size, _f, style) => arialWidth(t, size, /bold/.test(style)));
    const x1 = grid.rows[0][0].x1, y1 = grid.rows[0][0].y1 - lay.ys[0];
    const sh = doc.addShape({ id: idFor(outer ?? tbl), kind: 'table', x1, y1, x2: x1 + lay.width, y2: y1 + lay.height, table, z: tbl.hasAttribute('Z') ? num(tbl, 'Z') : undefined });
    from('s', sh.id, outer ?? tbl);
    stats.shapes++;
  };

  /** A group made of a table and its tagged title, footnotes and joined cells' text. */
  const tableGroup = (g: Element): ({ table: Element } & TableParts) | null => {
    let table: Element | null = null;
    const parts: TableParts = {};
    for (const ch of kids(g)) {
      if (ch.nodeName === 'table' && !table) { table = ch; continue; }
      const part = ch.nodeName === 't' ? kids(ch).find((k) => k.nodeName === 'objecttag' && k.getAttribute('Name') === TABLE_PART_TAG)?.getAttribute('Value') : null;
      if (part === 'title' || part === 'notes') { parts[part] = ch; continue; }
      const cell = part ? /^cell (\d+) (\d+)$/.exec(part) : null;
      if (cell) { (parts.cells ??= []).push([`${cell[1]} ${cell[2]}`, ch]); continue; }
      if (ch.nodeName !== 'objecttag') return null;
    }
    return table ? { table, ...parts } : null;
  };

  /** The text of a label ChemDraw made from a cell's text: a fragment of one labelled node. */
  const labelText = (frag: Element): Element | null => {
    const nodes = kids(frag).filter((k) => k.nodeName === 'n');
    if (nodes.length !== 1 || kids(frag).some((k) => k.nodeName === 'b')) return null;
    return kids(nodes[0]).find((k) => k.nodeName === 't') ?? null;
  };

  const headOf = (v: string | null): Arrow['headStyle'] => (v === 'Full' ? 'full' : v === 'HalfLeft' ? 'halfLeft' : v === 'HalfRight' ? 'halfRight' : 'none');

  const readArrow = (a: Element) => {
    const head = pts(a.getAttribute('Head3D'));
    const tail = pts(a.getAttribute('Tail3D'));
    if (head.length < 2 || tail.length < 2) { skip('arrow without ends'); return; }
    const lw = num(a, 'LineWidth', st.lineWidth);
    const headStyle = headOf(a.getAttribute('ArrowheadHead'));
    const tailStyle = headOf(a.getAttribute('ArrowheadTail'));
    const lt = a.getAttribute('LineType') ?? '';
    const type = a.getAttribute('ArrowheadType');
    let sweep = 0;
    const ang = a.getAttribute('AngularSize');
    if (ang !== null && Number(ang) !== 0) {
      // CDXML angles run anticlockwise (y up); ours run with y down.
      sweep = -Number(ang) * DEG;
      const c = pts(a.getAttribute('Center3D'));
      if (c.length >= 2) {
        const a0 = Math.atan2(tail[1] - c[1], tail[0] - c[0]);
        const r = Math.hypot(tail[0] - c[0], tail[1] - c[1]);
        const hx = c[0] + r * Math.cos(a0 + sweep), hy = c[1] + r * Math.sin(a0 + sweep);
        if (Math.hypot(hx - head[0], hy - head[1]) > r * 0.2) sweep = -sweep;
      }
    }
    const arrow: Omit<Arrow, 'id'> & { id: number } = {
      id: idFor(a),
      tail: { x: tail[0], y: tail[1] },
      head: { x: head[0], y: head[1] },
      headStyle,
      tailStyle,
      headType: type === 'Hollow' ? 'hollow' : type === 'Angle' ? 'angle' : 'solid',
      line: lt.includes('Dashed') ? 'dashed' : lt.includes('Bold') ? 'bold' : lt.includes('Wavy') ? 'wavy' : 'solid',
      noGo: a.getAttribute('NoGo') !== null,
      equilibrium: a.getAttribute('ArrowShaftSpacing') !== null && headStyle.startsWith('half') && tailStyle.startsWith('half'),
      sweep,
      headLength: (num(a, 'HeadSize', 1000) / 100) * lw,
      headWidth: (num(a, 'ArrowheadWidth', 250) / 100) * lw,
      color: color(a),
    };
    if (lw !== st.lineWidth) arrow.lineWidth = lw;
    // two shafts with a full head: a retrosynthetic arrow (spacing in hundredths of the line width)
    const spacing = a.getAttribute('ArrowShaftSpacing');
    if (spacing !== null && !arrow.equilibrium && Number(spacing) > 0) arrow.shaftSpacing = (Number(spacing) / 100) * lw;
    doc.addArrow(arrow);
    from('r', arrow.id, a);
    stats.arrows++;
  };

  const readGraphic = (g: Element) => {
    if (g.getAttribute('SupersededBy') !== null) return;
    const type = g.getAttribute('GraphicType');
    const bb = pts(g.getAttribute('BoundingBox'));
    const c = color(g);
    const z = num(g, 'Z', 0);
    const base = { id: idFor(g), color: c, z };
    const add = (s: Omit<Shape, 'id'> & { id: number }) => { doc.addShape(s); from('s', s.id, g); stats.shapes++; };
    switch (type) {
      case 'Line': {
        if (bb.length < 4) return;
        const lt = g.getAttribute('LineType') ?? '';
        add({ ...base, kind: 'line', x1: bb[0], y1: bb[1], x2: bb[2], y2: bb[3], dashed: lt.includes('Dashed'), bold: lt.includes('Bold') });
        return;
      }
      case 'Rectangle': {
        if (bb.length < 4) return;
        const rt = g.getAttribute('RectangleType') ?? '';
        const rect: Omit<Shape, 'id'> & { id: number } = {
          ...base, kind: 'rect', x1: bb[0], y1: bb[1], x2: bb[2], y2: bb[3], rounded: rt.includes('RoundEdge'), shadow: rt.includes('Shadow'),
          filled: rt.includes('Filled'), dashed: rt.includes('Dashed'), bold: rt.includes('Bold'),
        };
        // corner radius and shadow size are stored in hundredths of the line width
        const lw = num(g, 'LineWidth', st.lineWidth);
        const cr = g.getAttribute('CornerRadius'), ss = g.getAttribute('ShadowSize');
        if (rect.rounded && cr !== null && Number.isFinite(Number(cr))) rect.radius = (Number(cr) / 100) * lw;
        if (rect.shadow && ss !== null && Number.isFinite(Number(ss))) rect.shadowSize = (Number(ss) / 100) * lw;
        add(rect);
        return;
      }
      case 'Oval':
      case 'Orbital': {
        const cen = pts(g.getAttribute('Center3D')), maj = pts(g.getAttribute('MajorAxisEnd3D')), min = pts(g.getAttribute('MinorAxisEnd3D'));
        if (cen.length < 2 || maj.length < 2) return;
        const rx = Math.hypot(maj[0] - cen[0], maj[1] - cen[1]);
        const ry = min.length >= 2 ? Math.hypot(min[0] - cen[0], min[1] - cen[1]) : rx;
        const ot = g.getAttribute('OvalType') ?? '';
        add({ ...base, kind: 'oval', x1: cen[0] - rx, y1: cen[1] - ry, x2: cen[0] + rx, y2: cen[1] + ry, filled: ot.includes('Filled'), dashed: ot.includes('Dashed'), bold: ot.includes('Bold'), shadow: ot.includes('Shadow') });
        return;
      }
      case 'Symbol': {
        if (bb.length < 4) return;
        const sym = g.getAttribute('SymbolType') ?? '';
        if (sym === 'LonePair' || sym === 'Electron') {
          add({ ...base, kind: 'symbol', symbol: sym, x1: bb[0], y1: bb[1], x2: bb[2], y2: bb[3] });
        } else {
          // circled charges: the box is the symbol's width, sitting on the baseline y
          const d = Math.abs(bb[0] - bb[2]) || 4;
          const cx = (bb[0] + bb[2]) / 2, cy = bb[1] - d / 2;
          add({ ...base, kind: 'symbol', symbol: sym, x1: cx - d / 2, y1: cy - d / 2, x2: cx + d / 2, y2: cy + d / 2 });
        }
        return;
      }
      case 'Bracket': {
        if (bb.length < 4) return;
        const bt = g.getAttribute('BracketType') ?? 'Square';
        const kind = bt.startsWith('Round') ? 'round' : bt.startsWith('Curly') ? 'curly' : 'square';
        add({ ...base, kind: 'bracket', bracket: kind, pair: bt.endsWith('Pair'), x1: bb[0], y1: bb[1], x2: bb[2], y2: bb[3] });
        return;
      }
      default:
        skip(`graphic ${type}`);
    }
  };

  const walk = (el: Element) => {
    for (const ch of kids(el)) {
      switch (ch.nodeName) {
        case 'group': {
          const tg = tableGroup(ch);
          if (tg) readTable(tg.table, ch, tg);
          else walk(ch);
          break;
        }
        case 'table': readTable(ch, null, {}); break;
        case 'page': case 'altgroup': walk(ch); break;
        case 'fragment': readFragment(ch); break;
        case 't': readCaption(ch); break;
        case 'arrow': readArrow(ch); break;
        case 'graphic': readGraphic(ch); break;
        case 'embeddedobject': {
          // pictures: ChemDraw keeps a PNG copy of each (with Windows metafiles beside it)
          const bb = pts(ch.getAttribute('BoundingBox'));
          if (bb.length === 4) {
            const pic = pictureOf(ch);
            const sh = pic
              ? doc.addShape({ id: idFor(ch), kind: 'picture', x1: bb[0], y1: bb[1], x2: bb[2], y2: bb[3], src: pic.src, px: pic.px, ...(pic.crop ? { crop: pic.crop } : {}) })
              // only pictures this program can't show: mark where they sit, and keep them as they are
              : doc.addShape({ id: idFor(ch), kind: 'rect', x1: bb[0], y1: bb[1], x2: bb[2], y2: bb[3], dashed: true, color: '#9aa4b2', picture: true });
            from('s', sh.id, ch);
            stats.shapes++;
            if (!pic) skip('picture');
          }
          break;
        }
        case 'scheme': case 'step': case 'colortable': case 'fonttable': case 'objecttag': case 'bracketedgroup': case 'chemicalproperty': break;
        default: skip(ch.nodeName);
      }
    }
  };

  doc.bulk(() => {
    walk(root);
    readSteps(all, refOf, doc);
    // Element labels like "OH", "H2N" or "N" become automatic labels (so they re-justify
    // when the structure changes); anything else is kept exactly as written.
    for (const { atom, text, hShown } of pendingLabels) {
      const auto = hShown !== null && hShown >= 0 && isAutoLabel(atom.z, text, hShown);
      const bos = doc.valenceSum(atom.id);
      const implicitOk = auto && (!hasImplicitH(atom.z) || implicitHydrogens(atom.z, bos, atom.charge) === hShown);
      if (!implicitOk) {
        atom.label = text;
        atom.fileLabel = true;
        if (hShown === null && atom.z === 6 && /^[A-Z][a-z]?$/.test(text) && elementNumber(text) !== undefined) {
          atom.z = elementNumber(text)!;
          atom.label = null;
        }
      }
    }
  });
  doc.reserveIds(maxId);
  const orig = new Map<string, Entity>();
  const keep = (kind: Kind, m: Map<number, Entity>) => { for (const e of m.values()) if (ord.has(kind + e.id)) orig.set(kind + e.id, structuredClone(e)); };
  keep('a', doc.atoms); keep('b', doc.bonds); keep('c', doc.captions); keep('r', doc.arrows); keep('s', doc.shapes);
  doc.source = { text, ord, orig, maxId };
  doc.allDirty = true;
  stats.buildMs = performance.now() - t1;
  return { doc, stats };
}

const STEP_ROLES: [string, keyof StepRoles][] = [
  ['ReactionStepReactants', 'reactants'], ['ReactionStepProducts', 'products'],
  ['ReactionStepObjectsAboveArrow', 'above'], ['ReactionStepObjectsBelowArrow', 'below'], ['ReactionStepPlusses', 'plusses'],
];

/**
 * ChemDraw's reaction steps: the roles are kept with each step's arrow. A step names whole
 * structures (fragments), captions, groups of them, and the arrow (or the older copy of it that
 * ChemDraw keeps for old versions).
 */
function readSteps(all: Element[], refOf: Map<Element, string>, doc: Doc): void {
  const byId = new Map<string, Element>();
  for (const el of all) { const id = el.getAttribute('id'); if (id && !byId.has(id)) byId.set(id, el); }
  const refsOf = (el: Element | undefined, out: string[]) => {
    if (!el) return;
    const own = refOf.get(el);
    if (own) { if (!out.includes(own)) out.push(own); return; }
    if (el.nodeName === 'fragment') {
      const n = kids(el).find((k) => k.nodeName === 'n' && refOf.has(k));
      if (n && !out.includes(refOf.get(n)!)) out.push(refOf.get(n)!);
      return;
    }
    if (el.nodeName === 'group') for (const k of kids(el)) refsOf(k, out);
  };
  for (const st of all) {
    if (st.nodeName !== 'step') continue;
    const arrows: string[] = [];
    for (const id of (st.getAttribute('ReactionStepArrows') ?? '').split(/\s+/).filter(Boolean)) {
      let el = byId.get(id);
      const newer = el?.getAttribute('SupersededBy');
      if (el && !refOf.has(el) && newer) el = byId.get(newer);
      refsOf(el, arrows);
    }
    const r = arrows.map((a) => (a[0] === 'r' ? doc.arrows.get(Number(a.slice(1))) : undefined)).find(Boolean);
    if (!r || r.step) continue;
    const roles: StepRoles = { reactants: [], products: [], above: [], below: [] };
    for (const [attr, key] of STEP_ROLES) {
      const list: string[] = [];
      for (const id of (st.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean)) refsOf(byId.get(id), list);
      if (list.length || key !== 'plusses') (roles[key] as string[]) = list;
    }
    r.step = roles;
  }
}

/** Insert line breaks into styled runs at the given UTF-8 byte offsets. */
export function applyLineEnds(runs: TextRun[], ends: number[]): void {
  const want = new Set(ends);
  const chars: { ch: string; run: number }[] = [];
  runs.forEach((r, k) => { for (const ch of r.text) chars.push({ ch, run: k }); });
  const breaks: number[] = [];
  let bytes = 0;
  chars.forEach((c, i) => {
    if (i > 0 && want.has(bytes)) breaks.push(i);
    const cp = c.ch.codePointAt(0)!;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  });
  for (let k = breaks.length - 1; k >= 0; k--) {
    const i = breaks[k];
    const prev = chars[i - 1];
    if (prev.ch === '\n') continue;
    if (prev.ch === ' ') prev.ch = '\n';
    else chars.splice(i, 0, { ch: '\n', run: prev.run });
  }
  runs.forEach((r) => (r.text = ''));
  for (const c of chars) runs[c.run].text += c.ch;
}

/** Is `text` just the element symbol with its hydrogens, in either order (N, NH, HN, H3C)? */
export function isAutoLabel(z: number, text: string, h: number): boolean {
  const sym = SYMBOLS[z];
  if (!sym) return false;
  const hs = h === 0 ? '' : h === 1 ? 'H' : `H${h}`;
  return text === sym + hs || text === hs + sym || (h === 0 && text === sym);
}

/** Our own clipboard attributes for pictures (any format, and cropping), which ChemDraw doesn't have. */
/** The tag that marks a bond as part of an aromatic ring drawn with a circle (ours; ChemDraw has none). */
export const CIRCLE_TAG = 'ci-aromatic-circle';
export const OWN_PICTURE = 'ChemIllustratorPicture';
export const OWN_CROP = 'ChemIllustratorCrop';

/** The picture in a ChemDraw embedded object, when there is one this program can show. */
function pictureOf(el: Element): { src: string; px: { w: number; h: number }; crop: Shape['crop'] | null } | null {
  const own = el.getAttribute(OWN_PICTURE);
  const c = pts(el.getAttribute(OWN_CROP));
  const crop = c.length === 4 && c.every(Number.isFinite) ? { l: c[0], t: c[1], r: c[2], b: c[3] } : null;
  if (own?.startsWith('data:image/')) {
    try {
      const { mime, bytes } = fromDataUrl(own);
      return { src: own, px: imageSize(bytes, mime) ?? { w: 100, h: 100 }, crop };
    } catch {
      // fall back to the PNG
    }
  }
  const hexBytes = (name: string): Uint8Array | null => {
    const hex = el.getAttribute(name);
    if (!hex || hex.length < 48 || !/^[0-9a-f]+$/i.test(hex.slice(0, 64))) return null;
    const bytes = new Uint8Array(hex.length >> 1);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    return bytes;
  };
  const picture = (bytes: Uint8Array, mime: string) => ({ src: dataUrl(bytes, mime), px: imageSize(bytes, mime) ?? { w: 100, h: 100 }, crop });
  // a Windows metafile with lines and text (a chart or spectrum) is sharper than ChemDraw's PNG copy of it
  const emf = hexBytes('EnhancedMetafile');
  const drawn = emf ? emfToSvg(emf) : null;
  if (emf && drawn && drawn.vectors > 0) return picture(emf, 'image/x-emf');
  for (const [name, mime] of [['PNG', 'image/png'], ['JPEG', 'image/jpeg'], ['GIF', 'image/gif'], ['BMP', 'image/bmp']]) {
    const bytes = hexBytes(name);
    if (bytes) return picture(bytes, mime);
  }
  return emf && drawn ? picture(emf, 'image/x-emf') : null;
}
