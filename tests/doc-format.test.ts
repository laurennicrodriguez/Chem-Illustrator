// @vitest-environment jsdom
//
// Document formatting added in round 2: highlighted text, right indents, line spacing in points
// (exactly or at least), and frames and shadows on figures and pictures. Each lays out as Word
// does and goes to and from Word files.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { highlightName, lookXml } from '../src/io/docx-write';
import { readLook } from '../src/io/docx-read';
import { newDocument, objectRun, paraFromStyle, runStyleOf, lookExtent, type DocText } from '../src/document/document';
import { layoutText, SINGLE } from '../src/text/layout';
import * as rt from '../src/richtext';
import type { ParaStyle, TextRun } from '../src/model';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1]);
const DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const deps: DocxDeps = { async picture() { return { png: PNG, w: 80, h: 40 }; }, async svgToPng() { return PNG; } };
const measure = (t: string, size: number) => t.length * size * 0.5;

function doc(paras: { runs: TextRun[]; ps: ParaStyle }[], objects: DocText['objects'] = {}): DocText {
  const d = newDocument();
  const n = runStyleOf(d.styles.Normal);
  const runs: TextRun[] = [];
  paras.forEach((p, i) => {
    runs.push(...p.runs.map((r) => ({ ...n, ...r })));
    if (i < paras.length - 1) runs.push({ ...n, text: '\n' });
  });
  return { ...d, runs: rt.normalizeRuns(runs), paras: paras.map((p) => p.ps), objects };
}

const body = async (d: DocText) => strFromU8(unzipSync(await writeDocx(d, deps))['word/document.xml']);

describe('highlighted text', () => {
  it("uses Word's highlighter names for its colours, and shading for any other", () => {
    expect(highlightName('#ffff00')).toBe('yellow');
    expect(highlightName('#00FFFF')).toBe('cyan');
    expect(highlightName('#ffd8a8')).toBeNull();
  });

  it('saves and opens a highlight both ways', async () => {
    const N = paraFromStyle(newDocument().styles.Normal, {});
    const d = doc([{ runs: [{ text: 'plain ' }, { text: 'yellow', highlight: '#ffff00' }, { text: ' peach', highlight: '#ffd8a8' }], ps: N }]);
    const xmlText = await body(d);
    expect(xmlText).toContain('<w:highlight w:val="yellow"/>');
    expect(xmlText).toContain('w:fill="FFD8A8"');
    const back = (await readDocx(await writeDocx(d, deps))).doc;
    const hl = back.runs.filter((r) => r.highlight).map((r) => [r.text, r.highlight]);
    expect(hl).toEqual([['yellow', '#ffff00'], [' peach', '#ffd8a8']]);
  });

  it('keeps highlighted text a run of its own', () => {
    expect(rt.sameStyle({ highlight: '#ffff00' }, {})).toBe(false);
  });
});

describe('paragraph indents and spacing', () => {
  it('a right indent narrows the lines and moves right-aligned text in from the edge', () => {
    const text = 'aaaa bbbb cccc dddd';
    const plain = layoutText({ runs: [{ text }], justify: 'left', wrap: 100, boxes: true }, 10, measure);
    const indented = layoutText({ runs: [{ text }], paras: [{ indentRight: 40 }], justify: 'left', wrap: 100, boxes: true }, 10, measure);
    expect(indented.lines.length).toBeGreaterThan(plain.lines.length);
    for (const l of indented.lines) expect(l.width).toBeLessThanOrEqual(60 + 1e-9);
    const right = layoutText({ runs: [{ text: 'ab' }], paras: [{ align: 'right', indentRight: 30 }], justify: 'left', wrap: 100, boxes: true }, 10, measure);
    expect(right.lines[0].x + right.lines[0].width).toBeCloseTo(70);
  });

  it('spacing exactly 20 pt puts baselines 20 pt apart; at least 20 pt never makes lines closer than single', () => {
    // two lines from wrapping "aa bb" in a narrow box
    const two = (ps: ParaStyle) => layoutText({ runs: [{ text: 'aa bb' }], paras: [ps], justify: 'left', wrap: 12, boxes: true }, 10, measure).lines;
    const exact = two({ linePt: 20, lineRule: 'exact' });
    expect(exact[1].y - exact[0].y).toBeCloseTo(20);
    const small = two({ linePt: 6, lineRule: 'exact' });
    expect(small[1].y - small[0].y).toBeCloseTo(6);
    const atLeast = two({ linePt: 6, lineRule: 'atLeast' });
    expect(atLeast[1].y - atLeast[0].y).toBeCloseTo(SINGLE * 10);
    const big = two({ linePt: 30, lineRule: 'atLeast' });
    expect(big[1].y - big[0].y).toBeCloseTo(30);
  });

  it('saves and opens right indents and spacing in points', async () => {
    const N = paraFromStyle(newDocument().styles.Normal, {});
    const d = doc([
      { runs: [{ text: 'Exactly' }], ps: { ...N, linePt: 14, lineRule: 'exact', indentRight: 36 } },
      { runs: [{ text: 'At least' }], ps: { ...N, linePt: 18, lineRule: 'atLeast' } },
    ]);
    const xmlText = await body(d);
    expect(xmlText).toContain('w:line="280" w:lineRule="exact"');
    expect(xmlText).toContain('w:line="360" w:lineRule="atLeast"');
    expect(xmlText).toContain('w:right="720"');
    const back = (await readDocx(await writeDocx(d, deps))).doc;
    expect(back.paras[0]).toMatchObject({ linePt: 14, lineRule: 'exact', indentRight: 36 });
    expect(back.paras[1]).toMatchObject({ linePt: 18, lineRule: 'atLeast' });
  });
});

describe('frames and shadows on figures', () => {
  it('takes room for the frame and the shadow round the figure', () => {
    expect(lookExtent(undefined)).toEqual([0, 0, 0, 0]);
    expect(lookExtent({ frame: 2 })).toEqual([1, 1, 1, 1]);
    const [l, t, r, b] = lookExtent({ frame: 1, shadow: 'soft' });
    expect([l, t]).toEqual([0.5, 0.5]);
    expect(r).toBe(9);
    expect(b).toBe(9);
  });

  it("writes Word's picture line and outer shadow, and reads them back", () => {
    const x = lookXml({ frame: 1.5, frameColor: '#1f4e79', shadow: 'soft' });
    expect(x).toMatch(/^<a:solidFill>.*<\/a:solidFill><a:ln w="19050">.*1F4E79.*<\/a:ln><a:effectLst><a:outerShdw /);
    const el = new DOMParser().parseFromString(`<pic:spPr xmlns:pic="p" xmlns:a="a">${x.replace(/<a:/g, '<a:').replace(/<\/a:/g, '</a:')}</pic:spPr>`, 'application/xml').documentElement;
    expect(readLook(el)).toEqual({ frame: 1.5, frameColor: '#1f4e79', shadow: 'soft' });
    expect(lookXml(undefined)).toBe('');
  });

  it('saves and opens a framed picture and a shadowed structure', async () => {
    const N = paraFromStyle(newDocument().styles.Normal, {});
    const n = runStyleOf(newDocument().styles.Normal);
    const d = doc([{ runs: [objectRun(1, n), { text: ' and ' }, objectRun(2, n)], ps: N }], {
      1: { kind: 'picture', src: DOT, w: 30, h: 20, px: { w: 1, h: 1 }, look: { frame: 0.75 } },
      2: { kind: 'drawing', contents: { atoms: [], bonds: [], captions: [], arrows: [], shapes: [] }, look: { shadow: 'hard' } },
    });
    const xmlText = await body(d);
    expect(xmlText).toContain('<wp:effectExtent l="4763" t="4763" r="4763" b="4763"/>');
    const back = (await readDocx(await writeDocx(d, deps))).doc;
    const looks = Object.values(back.objects).map((o) => (o.kind === 'picture' || o.kind === 'drawing' ? o.look : null));
    expect(looks).toEqual([{ frame: 0.75 }, { shadow: 'hard' }]);
  });
});
