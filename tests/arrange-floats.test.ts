// @vitest-environment jsdom
//
// Arrange for floating figures in documents: Position, Rotate and Flip, Bring Forward and Send
// Backward, Group, and the Selection Pane's hidden figures and names, saved in Word files.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { newDocument, paraFromStyle, type DocObject, type DocText, type Float } from '../src/document/document';
import { DocLayouter } from '../src/document/doc-layout';
import { recordPages } from '../src/document/doc-paint';
import { grouped, groupOf, objectName, positioned, restacked, stackOrder, turned, ungrouped } from '../src/document/arrange';
import { documentMeasure } from '../src/text/font-measure';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import type { TextRun } from '../src/model';

const measure = documentMeasure((t: string, size: number) => t.length * size * 0.5);
const layouter = () => new DocLayouter({ measure, drawingSize: () => ({ w: 200, h: 100 }) });
const deps: DocxDeps = { async picture() { return null; }, async svgToPng() { return new Uint8Array(); } };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const look = { font: 'Calibri', size: 11 };

function picture(float?: Float): DocObject {
  return { kind: 'picture', src: PNG, w: 100, h: 50, px: { w: 1, h: 1 }, ...(float ? { float } : {}) };
}

/** A paragraph with three floating pictures (ids 1, 2, 3). */
function threeDoc(): DocText {
  const d = newDocument();
  const runs: TextRun[] = [{ ...look, obj: 1, text: '￼' }, { ...look, obj: 2, text: '￼' }, { ...look, obj: 3, text: '￼' }, { ...look, text: 'Some text round the pictures.' }];
  const fl = (x: number): Float => ({ wrap: 'square', x, y: 0 });
  return { ...d, runs, paras: [paraFromStyle(d.styles.Normal, {})], objects: { 1: picture(fl(0)), 2: picture(fl(50)), 3: picture(fl(100)) } };
}

describe('Position', () => {
  it('puts a figure at one of nine places inside the margins, text round it', () => {
    const page = newDocument().page;
    const fl = positioned(undefined, 'bottom-right', { w: 100, h: 50 }, page);
    expect(fl).toMatchObject({ wrap: 'square', xFrom: 'margin', yFrom: 'margin' });
    expect(fl.x).toBeCloseTo(page.w - page.left - page.right - 100);
    expect(fl.y).toBeCloseTo(page.h - page.top - page.bottom - 50);
    expect(positioned({ wrap: 'topBottom', x: 3, y: 4 }, 'top-center', { w: 100, h: 50 }, page).wrap).toBe('topBottom');
    // placed there on the page
    const t = threeDoc();
    t.objects[1] = picture(fl);
    const lay = layouter().layout(t);
    const o = lay.objects.find((x) => x.id === 1)!;
    expect(o.x + o.w).toBeCloseTo(lay.pages[0].x + page.w - page.right, 0);
  });
});

describe('Rotate and flip', () => {
  it('turns a quarter at a time and flips, and saves and reads it in Word', async () => {
    let p = picture({ wrap: 'front', x: 0, y: 0 }) as Extract<DocObject, { kind: 'picture' }>;
    p = turned(p, 'left');
    expect(p.rot).toBe(270);
    p = turned(turned(p, 'right'), 'flipH');
    expect(p.rot).toBeUndefined();
    expect(p.flipH).toBe(true);
    p = turned(p, 33);
    const t = threeDoc();
    t.objects[2] = p;
    const bytes = await writeDocx(t, deps);
    expect(strFromU8(unzipSync(bytes)['word/document.xml'])).toContain('<a:xfrm rot="1980000" flipH="1">');
    const { doc } = await readDocx(bytes);
    const back = Object.values(doc.objects).filter((o) => o.kind === 'picture');
    expect(back.map((o) => o.kind === 'picture' && [o.rot, o.flipH])).toContainEqual([33, true]);
    // drawn turned in a PDF
    const pages = recordPages(t, layouter().layout(t), () => null);
    expect(pages[0].items.find((i) => i.kind === 'image' && i.rot === 33)).toMatchObject({ flipH: true });
  });
});

describe('order, groups and the Selection Pane', () => {
  it('brings forward and sends backward, and keeps the order in Word', async () => {
    let t = threeDoc();
    expect(stackOrder(t)).toEqual([1, 2, 3]);
    t = restacked(t, 1, 'front');
    expect(stackOrder(t)).toEqual([2, 3, 1]);
    t = restacked(t, 3, 'backward');
    expect(stackOrder(t)).toEqual([3, 2, 1]);
    // drawn in that order
    expect(layouter().layout(t).objects.map((o) => o.id)).toEqual([3, 2, 1]);
    const { doc } = await readDocx(await writeDocx(t, deps));
    expect(stackOrder(doc).map((id) => Object.keys(doc.objects).indexOf(String(id)))).toEqual([2, 1, 0]);
  });

  it('groups figures, which then move together, and ungroups them', () => {
    let t = grouped(threeDoc(), [1, 3]);
    expect(groupOf(t, 1)).toEqual([1, 3]);
    expect(groupOf(t, 2)).toEqual([2]);
    t = grouped(t, [2, 3]);
    expect(groupOf(t, 2)).toEqual([1, 2, 3]);
    t = ungrouped(t, 1);
    expect(groupOf(t, 1)).toEqual([1]);
  });

  it('hides figures from the page, names them, and keeps both in Word', async () => {
    let t = grouped(threeDoc(), [1, 2]);
    t.objects[2] = { ...t.objects[2], float: { ...(t.objects[2] as { float: Float }).float, hidden: true, name: 'TLC plate' } } as DocObject;
    expect(objectName(t, 2)).toBe('TLC plate');
    expect(objectName(t, 3)).toBe('Picture 3');
    const lay = layouter().layout(t);
    expect(lay.objects.map((o) => o.id)).not.toContain(2);
    const bytes = await writeDocx(t, deps);
    expect(strFromU8(unzipSync(bytes)['word/document.xml'])).toMatch(/<wp:docPr [^>]*hidden="1"/);
    const { doc } = await readDocx(bytes);
    const floats = Object.values(doc.objects).map((o) => (o as { float?: Float }).float).filter(Boolean) as Float[];
    expect(floats.find((f) => f.hidden)).toMatchObject({ name: 'TLC plate' });
    expect(floats.filter((f) => f.group !== undefined)).toHaveLength(2);
  });
});
