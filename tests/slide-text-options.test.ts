// @vitest-environment jsdom
//
// Text options on slides: strikethrough, character spacing, Change Case, Clear Formatting,
// columns, AutoFit and text direction, in the text engine and through PowerPoint files.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { Doc, type Caption, type TextRun } from '../src/model';
import { defaultMaster } from '../src/deck/deck';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { changeCase, clearFormatting } from '../src/richtext';
import { layoutText } from '../src/text/layout';
import { formatWhole } from '../src/text/format';
import { arialWidth } from '../src/text-metrics';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };
const measure = (t: string, s: number, _f: string, st: string) => arialWidth(t, s, /bold/.test(st));
const text = (runs: TextRun[]) => runs.map((r) => r.text).join('');

async function save(c: Omit<Caption, 'id'>): Promise<Uint8Array> {
  const doc = new Doc();
  doc.style = { ...defaultMaster().drawing } as Doc['style'];
  doc.edit('text', () => { doc.addCaption(c); });
  return writePptx({ size: { w: 960, h: 540 }, master: defaultMaster(), slides: [{ layout: 'blank', doc, notes: '' }] }, opts);
}
const slideXml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['ppt/slides/slide1.xml']);
const captionOf = (bytes: Uint8Array) => {
  const caps = readPptx(bytes).slides[0].contents.captions;
  expect(caps).toHaveLength(1);
  return caps[0];
};
/** The file as PowerPoint might save it: our tags gone, so the text is read from PowerPoint's own markup. */
const untagged = (bytes: Uint8Array) => {
  const files = unzipSync(bytes);
  const xml = strFromU8(files['ppt/slides/slide1.xml']).replace(/<p:custDataLst>.*?<\/p:custDataLst>/gs, '');
  files['ppt/slides/slide1.xml'] = new Uint8Array(strToU8(xml));
  return zipSync(files);
};

describe('Change Case and Clear Formatting', () => {
  const runs: TextRun[] = [{ text: 'the yield WAS ' }, { text: 'high. so ', bold: true }, { text: "it's good" }];
  it('changes case and keeps each run\'s formatting', () => {
    expect(text(changeCase(runs, 0, 32, 'upper'))).toBe("THE YIELD WAS HIGH. SO IT'S GOOD");
    expect(text(changeCase(runs, 0, 32, 'lower'))).toBe("the yield was high. so it's good");
    expect(text(changeCase(runs, 0, 32, 'title'))).toBe("The Yield Was High. So It's Good");
    expect(text(changeCase(runs, 0, 32, 'sentence'))).toBe("The yield was high. So it's good");
    expect(text(changeCase(runs, 0, 9, 'toggle'))).toBe('THE YIELD WAS high. so it\'s good');
    expect(changeCase(runs, 0, 32, 'upper')[1]).toEqual({ text: 'HIGH. SO ', bold: true });
  });
  it('leaves letters that change length alone', () => {
    expect(text(changeCase([{ text: 'straße' }], 0, 6, 'upper'))).toBe('STRAßE');
  });
  it('clears character formatting but keeps links', () => {
    const got = clearFormatting([{ text: 'ab', bold: true, size: 30, color: '#ff0000', spacing: 2 }, { text: 'cd', link: 'https://x.org', italic: true }], 0, 4);
    expect(got).toEqual([{ text: 'ab' }, { text: 'cd', link: 'https://x.org' }]);
  });
  it('the ribbon does both to a whole text box', () => {
    const t = formatWhole({ runs: [{ text: 'hello world', bold: true }], justify: 'left' as const }, { kind: 'case', mode: 'title' }, {}, 18);
    expect(t.runs).toEqual([{ text: 'Hello World', bold: true }]);
    expect(formatWhole(t, { kind: 'clear' }, {}, 18).runs).toEqual([{ text: 'Hello World' }]);
    expect(formatWhole(t, { kind: 'toggle', key: 'strike' }, {}, 18).runs[0].strike).toBe(true);
  });
});

describe('the text engine', () => {
  it('character spacing adds room after each character', () => {
    const plain = layoutText({ runs: [{ text: 'abcd' }], justify: 'left' }, 20, measure);
    const spaced = layoutText({ runs: [{ text: 'abcd', spacing: 3 }], justify: 'left' }, 20, measure);
    expect(spaced.lines[0].width - plain.lines[0].width).toBeCloseTo(12, 5);
    expect(spaced.lines[0].pieces[0].spacing).toBe(3);
  });
  it('columns share the lines, filling each to the box height or evenly', () => {
    const runs = [{ text: Array.from({ length: 6 }, (_, i) => `line ${i}`).join('\n') }];
    const even = layoutText({ runs, justify: 'left', wrap: 200, cols: 2, colGap: 20 }, 10, measure);
    expect(even.lines.map((l) => l.band![0])).toEqual([0, 0, 0, 110, 110, 110]);
    expect(even.lines[3].y).toBeCloseTo(even.lines[0].y, 5);
    expect(even.lines[3].pieces[0].x).toBeCloseTo(110, 5);
    const tall = layoutText({ runs, justify: 'left', wrap: 200, cols: 2, colGap: 20, boxH: 60 }, 10, measure);
    expect(tall.lines.filter((l) => l.band![0] === 0).length).toBeGreaterThan(3);
    expect(tall.box.x2).toBe(200);
  });
  it('shrink on overflow makes the text fit its box', () => {
    const runs = [{ text: 'one\ntwo\nthree\nfour\nfive' }];
    const full = layoutText({ runs, justify: 'left', wrap: 200 }, 20, measure);
    const fit = layoutText({ runs, justify: 'left', wrap: 200, boxH: 60, fit: 'shrink' }, 20, measure);
    expect(full.box.y2 - full.box.y1).toBeGreaterThan(60);
    expect(fit.box.y2 - fit.box.y1).toBeLessThanOrEqual(60);
    expect(fit.fontScale).toBeLessThan(1);
    expect(layoutText({ runs: [{ text: 'one' }], justify: 'left', wrap: 200, boxH: 60, fit: 'shrink' }, 20, measure).fontScale).toBeUndefined();
  });
});

describe('text options in PowerPoint files', () => {
  const box: Omit<Caption, 'id'> = {
    x: 100, y: 100, justify: 'left', wrap: 300, cols: 2, colGap: 18, fit: 'shrink', boxH: 80,
    runs: [{ text: 'gone', strike: true }, { text: ' spaced', spacing: 2.5 }, { text: '\nmore text\nand more\nand more' }],
  };
  it('writes them as PowerPoint\'s own settings', async () => {
    const xml = slideXml(await save(box));
    expect(xml).toContain('strike="sngStrike"');
    expect(xml).toContain('spc="250"');
    expect(xml).toMatch(/numCol="2" spcCol="228600"/);
    expect(xml).toMatch(/<a:normAutofit/);
  });
  it('comes back as it was saved', async () => {
    const c = captionOf(await save(box));
    expect(c).toMatchObject({ cols: 2, colGap: 18, fit: 'shrink', boxH: 80 });
    expect(c.runs[0]).toMatchObject({ text: 'gone', strike: true });
  });
  it('reads PowerPoint\'s settings', async () => {
    const c = captionOf(untagged(await save(box)));
    expect(c.cols).toBe(2);
    expect(c.colGap).toBeCloseTo(18, 1);
    expect(c.fit).toBe('shrink');
    expect(c.boxH).toBeCloseTo(80, 0);
    expect(c.runs.find((r) => r.strike)?.text).toBe('gone');
    expect(c.runs.find((r) => r.spacing)?.spacing).toBe(2.5);
  });
  it('text running down: a quarter turn in the file, the box the other way round', async () => {
    const down: Omit<Caption, 'id'> = { x: 100, y: 100, justify: 'left', wrap: 200, rot: 90, dir: 'vert', runs: [{ text: 'Down the side' }] };
    const bytes = await save(down);
    const xml = slideXml(bytes);
    expect(xml).toContain('vert="vert"');
    // PowerPoint's own box isn't turned: the text turns in it
    expect(xml).not.toMatch(/<a:xfrm rot=/);
    for (const c of [captionOf(bytes), captionOf(untagged(bytes))]) {
      expect(c.dir).toBe('vert');
      expect(c.rot).toBeCloseTo(90, 5);
      expect(c.wrap).toBeCloseTo(200, 0);
      expect(c.x).toBeCloseTo(100, 0);
      expect(c.y).toBeCloseTo(100, 0);
    }
  });
});
