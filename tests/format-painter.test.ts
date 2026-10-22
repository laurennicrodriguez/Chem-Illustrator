// Format Painter: the look of text, drawn things and cells picked up and given to others, and
// the brush that paints once (click) or until put down (double-click).

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { TextEditing } from '../src/text/editing';
import { Brush, cellPaintTarget, paintCells, paintObjects, paintParas, paintRuns, pickObjectLook, picksParagraph } from '../src/format-painter';
import { Workbook } from '../src/sheet/workbook';
import * as rt from '../src/richtext';

const measure = (text: string, size: number) => text.length * size * 0.5;
const editing = (runs: rt.RunStyle[] & { text: string }[]) => new TextEditing({ runs }, {}, measure, 10);
const empty = () => ({ atoms: new Set<number>(), bonds: new Set<number>(), captions: new Set<number>(), arrows: new Set<number>(), shapes: new Set<number>() });

describe('text', () => {
  it('paints the look but keeps the words, links and figures', () => {
    const runs = [{ text: 'see ' }, { text: 'here', link: 'https://example.org', italic: true }, { text: '￼', obj: 3 }];
    const out = paintRuns(runs, 0, 9, { bold: true, color: '#c00000', font: 'Arial' });
    expect(rt.plainText(out)).toBe('see here￼');
    expect(out[0]).toMatchObject({ text: 'see ', bold: true, color: '#c00000', font: 'Arial' });
    // italic was the old look: it goes; the link stays
    expect(out[1]).toEqual({ text: 'here', link: 'https://example.org', bold: true, color: '#c00000', font: 'Arial' });
    expect(out[2]).toEqual({ text: '￼', obj: 3 });
  });

  it('takes the paragraph too for a caret or whole paragraphs, not for some words', () => {
    const text = 'One two\nThree';
    expect(picksParagraph(text, 2, 2)).toBe(true);
    expect(picksParagraph(text, 0, 7)).toBe(true);
    expect(picksParagraph(text, 0, 13)).toBe(true);
    expect(picksParagraph(text, 0, 3)).toBe(false);
    expect(picksParagraph(text, 4, 7)).toBe(false);
  });

  it('paints paragraphs without losing their breaks', () => {
    const out = paintParas([{ align: 'left', pageBreak: true }, { list: 'bullet' }], 0, 1, { align: 'center', spaceAfter: 6 });
    expect(out).toEqual([{ align: 'center', spaceAfter: 6, pageBreak: true }, { align: 'center', spaceAfter: 6 }]);
  });

  it('picks up from one place and paints the word clicked', () => {
    const ed = editing([{ text: 'red', color: '#ff0000', bold: true }, { text: ' plain words' }]);
    ed.select(0, 3);
    const look = ed.pickLook();
    expect(look.run).toEqual({ color: '#ff0000', bold: true });
    expect(look.para).toBeUndefined();
    ed.setCaret(6); // in "plain"
    expect(ed.paintLook(look)).toBe(true);
    expect(rt.sliceRuns(ed.t.runs, 4, 9)).toEqual([{ text: 'plain', color: '#ff0000', bold: true }]);
    expect(rt.sliceRuns(ed.t.runs, 10, 15)).toEqual([{ text: 'words' }]);
    // one undo step
    ed.undo();
    expect(rt.sliceRuns(ed.t.runs, 4, 9)).toEqual([{ text: 'plain' }]);
  });
});

describe('drawings', () => {
  it('gives each kind the look of its own kind, and others just the colour', () => {
    const doc = new Doc();
    let a1 = 0, a2 = 0, b = 0, r1 = 0, r2 = 0, c = 0, w = 0, w2 = 0;
    doc.edit('draw', () => {
      a1 = doc.addAtom(0, 0, 6, { color: '#0000ff' }).id;
      a2 = doc.addAtom(14, 0, 6).id;
      b = doc.addBond(a1, a2, 2, 'solid').id;
      r1 = doc.addShape({ kind: 'rect', x1: 0, y1: 0, x2: 10, y2: 10, color: '#00aa00', fillColor: '#eeffee', filled: true, shadow: true, dashed: true }).id;
      r2 = doc.addShape({ kind: 'oval', x1: 20, y1: 0, x2: 30, y2: 10, rounded: true }).id;
      c = doc.addCaption({ x: 0, y: 30, runs: [{ text: 'Caption', font: 'Arial', size: 14 }], justify: 'left' }).id;
      w = doc.addArrow({ tail: { x: 0, y: 0 }, head: { x: 10, y: 0 }, headStyle: 'halfLeft', tailStyle: 'none', headType: 'solid', line: 'dashed', noGo: false, equilibrium: false, sweep: 0, headLength: 9, headWidth: 3, color: '#ff00ff', lineWidth: 2 }).id;
      w2 = doc.addArrow({ tail: { x: 0, y: 20 }, head: { x: 10, y: 20 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 2 }).id;
    });
    const from = empty();
    from.shapes.add(r1);
    from.arrows.add(w);
    const look = pickObjectLook(doc, from)!;
    expect(look.shape).toMatchObject({ color: '#00aa00', fillColor: '#eeffee', filled: true, shadow: true, dashed: true });
    const to = empty();
    to.shapes.add(r2);
    to.arrows.add(w2);
    to.atoms.add(a2);
    to.bonds.add(b);
    to.captions.add(c);
    doc.edit('Format Painter', () => paintObjects(doc, to, look));
    expect(doc.shapes.get(r2)).toMatchObject({ kind: 'oval', color: '#00aa00', fillColor: '#eeffee', filled: true, shadow: true, dashed: true, rounded: true });
    // the arrow's line and colour, not its kind of head
    expect(doc.arrows.get(w2)).toMatchObject({ headStyle: 'full', line: 'dashed', color: '#ff00ff', lineWidth: 2, headLength: 9 });
    // the structure and caption take the colour of the box (a shape's comes first), not its fill
    expect(doc.atoms.get(a2)!.color).toBe('#00aa00');
    expect(doc.bonds.get(b)).toMatchObject({ order: 2, color: '#00aa00' });
    expect(doc.captions.get(c)!.runs).toEqual([{ text: 'Caption', font: 'Arial', size: 14, color: '#00aa00' }]);
  });

  it('a caption gives its text look to captions and to the text in shapes', () => {
    const doc = new Doc();
    let c1 = 0, c2 = 0, g = 0;
    doc.edit('draw', () => {
      c1 = doc.addCaption({ x: 0, y: 0, runs: [{ text: 'Big', bold: true, size: 20, color: '#123456' }], justify: 'center' }).id;
      c2 = doc.addCaption({ x: 0, y: 40, runs: [{ text: 'small ', italic: true }, { text: 'H2O', formula: true }], justify: 'left' }).id;
      g = doc.addShape({ kind: 'geo', geo: 'rect', x1: 0, y1: 60, x2: 50, y2: 90, text: { runs: [{ text: 'in box' }] } }).id;
    });
    const from = empty();
    from.captions.add(c1);
    const look = pickObjectLook(doc, from)!;
    const to = empty();
    to.captions.add(c2);
    to.shapes.add(g);
    doc.edit('Format Painter', () => paintObjects(doc, to, look));
    expect(doc.captions.get(c2)!.runs).toEqual([{ text: 'small H2O', bold: true, size: 20, color: '#123456' }]);
    expect(doc.captions.get(c2)!.justify).toBe('center');
    expect(doc.shapes.get(g)!.text!.runs).toEqual([{ text: 'in box', bold: true, size: 20, color: '#123456' }]);
    // one undo puts it all back
    doc.undo();
    expect(doc.captions.get(c2)!.runs[0]).toEqual({ text: 'small ', italic: true });
  });

  it('has nothing to give from a table or an empty selection', () => {
    const doc = new Doc();
    let t = 0;
    doc.edit('draw', () => { t = doc.addShape({ kind: 'table', x1: 0, y1: 0, x2: 10, y2: 10 }).id; });
    expect(pickObjectLook(doc, empty())).toBeNull();
    const sel = empty();
    sel.shapes.add(t);
    expect(pickObjectLook(doc, sel)).toBeNull();
  });
});

describe('sheets', () => {
  it('a single cell clicked takes the whole block; a range is filled with it repeated', () => {
    expect(cellPaintTarget({ rows: 2, cols: 1 }, { r1: 5, c1: 3, r2: 5, c2: 3 })).toEqual({ r1: 5, c1: 3, r2: 6, c2: 3 });
    expect(cellPaintTarget({ rows: 2, cols: 1 }, { r1: 0, c1: 0, r2: 4, c2: 1 })).toEqual({ r1: 0, c1: 0, r2: 4, c2: 1 });
    const wb = new Workbook();
    const s = wb.sheet;
    s.setCell(0, 0, { input: '1', style: { bold: true } });
    s.setCell(1, 0, { input: '2', style: { fill: '#ffff00' } });
    s.setCell(0, 2, { input: 'keep me' });
    const block = s.copy({ r1: 0, c1: 0, r2: 1, c2: 0 });
    paintCells(s, block, { r1: 0, c1: 2, r2: 2, c2: 2 });
    expect(s.cell(0, 2)).toMatchObject({ input: 'keep me', style: { bold: true } });
    expect(s.cell(1, 2)?.style).toEqual({ fill: '#ffff00' });
    expect(s.cell(2, 2)?.style).toEqual({ bold: true });
  });
});

describe('the brush', () => {
  it('a click paints once; a double-click keeps it until put down', () => {
    const b = new Brush<string>();
    let t = 0;
    b.now = () => t;
    expect(b.press('doc', () => 'look')).toBe('picked');
    b.used();
    expect(b.held).toBe(false);
    expect(b.press('doc', () => 'look')).toBe('picked');
    t = 200;
    expect(b.press('doc', () => 'other')).toBe('sticky');
    b.used();
    b.used();
    expect(b.held).toBe(true);
    expect(b.look).toBe('look');
    t = 5000;
    expect(b.press('doc', () => 'look')).toBe('dropped');
    expect(b.held).toBe(false);
    expect(b.press('doc', () => null)).toBe('nothing');
  });

  it('a press later on puts down a brush picked up in a single click', () => {
    const b = new Brush<string>();
    let t = 0;
    b.now = () => t;
    b.press('sheet', () => 'a');
    t = 2000;
    expect(b.press('sheet', () => 'b')).toBe('dropped');
  });
});
