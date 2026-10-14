// @vitest-environment jsdom
//
// Figures taken out of the line (Word's Wrap Text) and text boxes: where they go on the page,
// how the text goes round them, and how they go to and from Word files.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { newDocument, objectRun, paraFromStyle, runStyleOf, type DocObject, type DocText } from '../src/document/document';
import { DocLayouter, narrowLine, MIN_BESIDE, type WrapRect } from '../src/document/doc-layout';
import { layoutText } from '../src/text/layout';
import * as rt from '../src/richtext';
import type { TextRun } from '../src/model';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1]);
const DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const deps: DocxDeps = { async picture() { return { png: PNG, w: 80, h: 40 }; }, async svgToPng() { return PNG; } };
const measure = (t: string, size: number) => t.length * size * 0.5;
const layouter = () => new DocLayouter({ measure, drawingSize: () => ({ w: 80, h: 40 }) });
const WORDS = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp '.repeat(12);

/** A document of paragraphs, the first holding object 1 at its start. */
function doc(paras: string[], o: DocObject): DocText {
  const d = newDocument();
  const n = runStyleOf(d.styles.Normal);
  const runs: TextRun[] = [];
  paras.forEach((text, i) => {
    if (i) runs.push({ ...n, text: '\n' });
    if (i === 0) runs.push(objectRun(1, n));
    runs.push({ ...n, text });
  });
  const N = paraFromStyle(d.styles.Normal, {});
  return { ...d, runs: rt.normalizeRuns(runs), paras: paras.map(() => N), objects: { 1: o } };
}

const picture = (float?: DocObject extends never ? never : Extract<DocObject, { kind: 'picture' }>['float']): DocObject =>
  ({ kind: 'picture', src: DOT, w: 144, h: 72, px: { w: 1, h: 1 }, ...(float ? { float } : {}) });

describe('room beside a floating figure', () => {
  const W = 468;
  const fig = (x1: number, x2: number, wrap: WrapRect['wrap'] = 'square'): WrapRect => ({ x1, y1: 0, x2, y2: 100, wrap });

  it('text goes down the wider side of a square-wrapped figure', () => {
    expect(narrowLine([fig(-9, 153)], 10, 24, W)).toEqual({ left: 153, right: 0 });
    expect(narrowLine([fig(300, 477)], 10, 24, W)).toEqual({ left: 0, right: 168 });
  });

  it('lines above or below the figure keep their whole width', () => {
    expect(narrowLine([fig(-9, 153)], 100, 114, W)).toBeNull();
  });

  it('moves the line below the figure when it is top and bottom, or leaves too little room beside it', () => {
    expect(narrowLine([fig(-9, 153, 'topBottom')], 10, 24, W)).toEqual({ left: 0, right: 0, down: 90 });
    expect(narrowLine([fig(MIN_BESIDE - 20, W - MIN_BESIDE + 20)], 10, 24, W)).toEqual({ left: 0, right: 0, down: 90 });
  });

  it('text goes over and under figures behind or in front of it', () => {
    expect(narrowLine([fig(0, 200, 'behind'), fig(0, 200, 'front')], 10, 24, W)).toBeNull();
  });

  it('the text layout gives up the room it is told to', () => {
    const narrow = (top: number) => (top < 30 ? { left: 50, right: 0 } : null);
    const lay = layoutText({ runs: [{ text: WORDS }], justify: 'left', wrap: 200, boxes: true, narrow }, 10, measure);
    expect(lay.lines[0].x).toBeCloseTo(50);
    expect(lay.lines[0].width).toBeLessThanOrEqual(150 + 1e-6);
    const later = lay.lines.find((l) => l.y > 40)!;
    expect(later.x).toBeCloseTo(0);
  });
});

describe('floating figures on the page', () => {
  it('takes no room in its line, sits where it is put, and the text wraps round it', () => {
    const t = doc([WORDS, WORDS], picture({ wrap: 'square', x: 0, y: 0 }));
    const lay = layouter().layout(t);
    const o = lay.objects.find((x) => x.id === 1)!;
    expect(o.wrap).toBe('square');
    expect(o.x).toBeCloseTo(t.page.left);
    expect(o.y).toBeCloseTo(t.page.top);
    // lines beside it start right of it and its gap; lines below it start at the margin
    const beside = lay.text.lines.filter((l) => l.y - 5 < o.y + o.h);
    const below = lay.text.lines.filter((l) => l.y - 12 > o.y + o.h + 9);
    expect(beside.length).toBeGreaterThan(2);
    for (const l of beside) expect(l.x).toBeGreaterThanOrEqual(t.page.left + 144 + 9 - 1e-6);
    expect(below[0].x).toBeCloseTo(t.page.left);
  });

  it('top and bottom: no text beside it', () => {
    const t = doc([WORDS], picture({ wrap: 'topBottom', x: 100, y: 0 }));
    const lay = layouter().layout(t);
    const o = lay.objects.find((x) => x.id === 1)!;
    const first = lay.text.lines[0];
    // its letters start below the figure and its gap (the line's box reaches up past it)
    expect(first.y - first.ascent).toBeGreaterThanOrEqual(o.y + o.h + 9 - 1e-6);
  });

  it('behind and in front of the text leave the text where it was', () => {
    const plain = layouter().layout(doc([WORDS], picture({ wrap: 'behind', x: 0, y: 0 }))).text.lines;
    const front = layouter().layout(doc([WORDS], picture({ wrap: 'front', x: 0, y: 0 }))).text.lines;
    expect(front.map((l) => [l.x, l.y])).toEqual(plain.map((l) => [l.x, l.y]));
    expect(plain[0].x).toBeCloseTo(72);
  });

  it('can be placed from the page or the margin, and is kept on the page', () => {
    const t = doc(['short'], picture({ wrap: 'front', x: 36, y: 760, xFrom: 'page', yFrom: 'page' }));
    const o = layouter().layout(t).objects.find((x) => x.id === 1)!;
    expect(o.x).toBeCloseTo(36);
    expect(o.y).toBeCloseTo(t.page.h - 72);
  });
});

describe('text boxes', () => {
  const box = (text: string, w = 144): DocObject => ({ kind: 'textbox', runs: [{ text }], w, fill: '#ffffff', look: { frame: 0.75 }, float: { wrap: 'square', x: 0, y: 0 } });

  it('grows down to fit its text, and lays it out inside its margins', () => {
    const one = layouter().layout(doc([WORDS], box('Note')));
    const many = layouter().layout(doc([WORDS], box(WORDS.slice(0, 200))));
    const h1 = one.sizes.get(1)!.h, h2 = many.sizes.get(1)!.h;
    expect(h2).toBeGreaterThan(h1 * 3);
    for (const l of many.boxes.get(1)!.lines) expect(l.x + l.width).toBeLessThanOrEqual(144 - 2 * 7.2 + 1e-6);
  });

  it('saves as a Word text box and opens again', async () => {
    const t = doc([WORDS], { ...box('Air sensitive: weigh under argon.'), fill: '#fff2cc' });
    const files = unzipSync(await writeDocx(t, deps));
    const body = strFromU8(files['word/document.xml']);
    expect(body).toContain('<mc:Choice Requires="wps">');
    expect(body).toContain('<wps:cNvSpPr txBox="1"/>');
    expect(body).toContain('<wp:wrapSquare wrapText="largest"/>');
    expect(body).toContain('FFF2CC');
    const back = (await readDocx(await writeDocx(t, deps))).doc;
    const o = Object.values(back.objects).find((x) => x.kind === 'textbox');
    expect(o?.kind).toBe('textbox');
    if (o?.kind !== 'textbox') return;
    expect(rt.plainText(o.runs)).toBe('Air sensitive: weigh under argon.');
    expect(o.fill).toBe('#fff2cc');
    expect(o.look).toEqual({ frame: 0.75 });
    expect(o.w).toBeCloseTo(144);
    expect(o.float).toEqual({ wrap: 'square', x: 0, y: 0 });
  });
});

describe('floating figures in Word files', () => {
  it('writes the place and the wrapping, and reads them back', async () => {
    for (const fl of [
      { wrap: 'square' as const, x: 200, y: 12 },
      { wrap: 'topBottom' as const, x: 0, y: 30, yFrom: 'margin' as const },
      { wrap: 'behind' as const, x: 50, y: 60, xFrom: 'page' as const, yFrom: 'page' as const, gap: 4 },
      { wrap: 'front' as const, x: 10, y: 0 },
    ]) {
      const t = doc([WORDS], picture(fl));
      const body = strFromU8(unzipSync(await writeDocx(t, deps))['word/document.xml']);
      expect(body).toContain('<wp:anchor');
      expect(body).toContain(`behindDoc="${fl.wrap === 'behind' ? 1 : 0}"`);
      const back = (await readDocx(await writeDocx(t, deps))).doc;
      const o = Object.values(back.objects).find((x) => x.kind === 'picture');
      expect(o?.kind === 'picture' ? o.float : null).toEqual(fl);
    }
  });

  it('keeps a frame outside the place it was put', async () => {
    const t = doc([WORDS], { ...picture({ wrap: 'square', x: 20, y: 10 }), look: { frame: 2 } } as DocObject);
    const body = strFromU8(unzipSync(await writeDocx(t, deps))['word/document.xml']);
    // Word places the picture itself; ours is the box round its frame (1 pt out)
    expect(body).toContain(`<wp:posOffset>${Math.round(21 * 12700)}</wp:posOffset>`);
    const back = (await readDocx(await writeDocx(t, deps))).doc;
    const o = Object.values(back.objects).find((x) => x.kind === 'picture');
    expect(o?.kind === 'picture' ? o.float : null).toEqual({ wrap: 'square', x: 20, y: 10 });
  });
});

describe('columns', () => {
  const cols = (n: number, paras: string[], colGap?: number): DocText => {
    const t = doc(paras, { kind: 'seq', name: 'Figure' });
    return { ...t, page: { ...t.page, cols: n, ...(colGap !== undefined ? { colGap } : {}) } };
  };
  const LONG = Array.from({ length: 14 }, () => WORDS);

  it('sets the text in columns half an inch apart, filling the first before the second', () => {
    const t = cols(2, LONG);
    const lay = layouter().layout(t);
    const w = (468 - 36) / 2;
    expect(lay.textW).toBeCloseTo(w);
    expect(lay.cols.x).toEqual([0, w + 36]);
    const first = lay.pages[0];
    const xs = lay.text.lines.slice(first.first, first.end).map((l) => l.left);
    const k = xs.findIndex((x) => x > 72 + 1);
    // the first column's lines, then the second's
    expect(k).toBeGreaterThan(10);
    expect(xs.slice(k).every((x) => Math.abs(x - (72 + w + 36)) < 1e-6)).toBe(true);
    for (const l of lay.text.lines) expect(l.width).toBeLessThanOrEqual(w + 1e-6);
    // the second column starts at the top of the page
    const second = lay.text.lines[first.first + k];
    expect(second.y - (second.above ?? 0)).toBeCloseTo(t.page.top);
  });

  it('a column break starts the next column, and a click finds the line in the column clicked', async () => {
    const t = cols(2, ['one', 'two']);
    t.paras[1] = { ...t.paras[1], colBreak: true };
    const lay = layouter().layout(t);
    const [a, b] = lay.text.lines;
    expect(b.left).toBeGreaterThan(a.left + 200);
    expect(b.y).toBeCloseTo(a.y);
    const { offsetAt } = await import('../src/text/layout');
    expect(offsetAt(lay.text, b.left + 2, b.y)).toBeGreaterThanOrEqual(b.start);
    expect(offsetAt(lay.text, a.left + 2, a.y)).toBeLessThanOrEqual(a.end);
  });

  it('saves columns and column breaks for Word, and opens them again', async () => {
    const t = cols(3, ['one', 'two'], 18);
    t.paras[1] = { ...t.paras[1], colBreak: true };
    const body = strFromU8(unzipSync(await writeDocx(t, deps))['word/document.xml']);
    expect(body).toContain('<w:cols w:num="3" w:space="360"/>');
    expect(body).toContain('<w:br w:type="column"/>');
    const back = (await readDocx(await writeDocx(t, deps))).doc;
    expect(back.page.cols).toBe(3);
    expect(back.page.colGap).toBe(18);
    expect(back.paras[1].colBreak).toBe(true);
    expect(rt.plainText(back.runs)).toBe(rt.plainText(t.runs));
  });
});
