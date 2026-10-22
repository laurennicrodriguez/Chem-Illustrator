// @vitest-environment jsdom
// Word's text formatting, multilevel lists, tab stops, character styles and page background
// (small caps, Change Case, Clear Formatting, list schemes and bullets, tabs, Styles, watermark,
// page colour and borders), and their trip through Word files.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import * as rt from '../src/richtext';
import { layoutText, type TextFrame } from '../src/text/layout';
import { listInfo } from '../src/text/paragraphs';
import { arialWidth } from '../src/text-metrics';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import {
  applyCharStyle, charStylesOf, clearFormatting, defaultPageBorder, defaultStyles, defaultWatermark, newCharStyle, newDocument, paraFromStyle, runStyleOf, type DocText,
} from '../src/document/document';
import type { ParaStyle, TextRun } from '../src/model';

const measure = (t: string, s: number, _f: string, style: string) => arialWidth(t, s, /bold/.test(style));
const deps: DocxDeps = {
  async picture() { return { png: new Uint8Array(), svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', w: 1, h: 1 }; },
  async svgToPng() { return new Uint8Array(); },
};

describe('Change Case', () => {
  const run = (text: string, mode: rt.CaseMode, start = 0, end = text.length) => rt.plainText(rt.changeCase([{ text }], start, end, mode));
  it('writes text in each of Word’s cases', () => {
    expect(run('the rate of SN2 reactions. it rose', 'sentence')).toBe('The rate of sn2 reactions. It rose');
    expect(run('Hello World', 'lower')).toBe('hello world');
    expect(run('Hello World', 'upper')).toBe('HELLO WORLD');
    expect(run('the total synthesis of taxol', 'title')).toBe('The Total Synthesis Of Taxol');
    expect(run('Hello World', 'toggle')).toBe('hELLO wORLD');
  });
  it('changes only what is selected, keeping the formatting', () => {
    const out = rt.changeCase([{ text: 'one ' }, { text: 'two', bold: true }], 4, 7, 'upper');
    expect(out).toEqual([{ text: 'one ' }, { text: 'TWO', bold: true }]);
  });
  it('leaves chemical formulas as they are', () => {
    expect(rt.plainText(rt.changeCase([{ text: 'add ' }, { text: 'NaBH4', formula: true }], 0, 9, 'lower'))).toBe('add NaBH4');
  });
});

describe('multilevel lists and the bullet library', () => {
  const markers = (paras: ParaStyle[]) => listInfo(paras).map((m) => m.marker);
  it('numbers each level the way its scheme says', () => {
    const p = (level: number, scheme?: string): ParaStyle => ({ list: 'number', level, ...(scheme ? { scheme } : {}) });
    expect(markers([p(0), p(1), p(1), p(2), p(0)])).toEqual(['1.', 'a.', 'b.', 'i.', '2.']);
    expect(markers([p(0, 'outline'), p(1, 'outline'), p(2, 'outline'), p(0, 'outline')])).toEqual(['1.', '1.1.', '1.1.1.', '2.']);
    expect(markers([p(0, 'legal'), p(1, 'legal')])).toEqual(['1', '1.1']);
    expect(markers([p(0, 'roman'), p(1, 'roman'), p(2, 'roman')])).toEqual(['I.', 'A.', '1.']);
    expect(markers([p(0, 'paren'), p(1, 'paren')])).toEqual(['1)', 'a)']);
    expect(markers([p(0, 'brackets')])).toEqual(['(1)']);
    expect(markers([p(0, 'steps'), p(0, 'steps')])).toEqual(['Step 1.', 'Step 2.']);
  });
  it('shows a bullet picked from the library', () => {
    expect(markers([{ list: 'bullet' }, { list: 'bullet', bullet: '✓' }])).toEqual(['•', '✓']);
  });
});

describe('tab stops', () => {
  const xs = (runs: TextRun[], paras: ParaStyle[]) => {
    const f: TextFrame = { runs, justify: 'left', paras };
    const lay = layoutText(f, 10, measure);
    return lay.lines[0].pieces.filter((g) => !g.tab).map((g) => [g.text, Math.round(g.x * 10) / 10]);
  };
  it('takes a tab to the next default stop (every half inch) with none set', () => {
    expect(xs([{ text: 'a\tb' }], [{}])[1]).toEqual(['b', 36]);
  });
  it('lines text up at left, right, centre and decimal stops', () => {
    const w = (s: string) => measure(s, 10, '', '');
    expect(xs([{ text: 'a\tb' }], [{ tabs: [{ pos: 100, kind: 'left' }] }])[1]).toEqual(['b', 100]);
    const right = xs([{ text: 'a\tend' }], [{ tabs: [{ pos: 100, kind: 'right' }] }])[1];
    expect(Number(right[1]) + w('end')).toBeCloseTo(100, 0);
    const centre = xs([{ text: 'a\tmid' }], [{ tabs: [{ pos: 100, kind: 'center' }] }])[1];
    expect(Number(centre[1]) + w('mid') / 2).toBeCloseTo(100, 0);
    const dec = xs([{ text: 'a\t12.5' }], [{ tabs: [{ pos: 100, kind: 'decimal' }] }])[1];
    expect(Number(dec[1]) + w('12')).toBeCloseTo(100, 0);
  });
  it('gives a tab its leader', () => {
    const lay = layoutText({ runs: [{ text: 'Intro\t5' }], justify: 'left', paras: [{ tabs: [{ pos: 200, kind: 'right', leader: 'dot' }] }] }, 10, measure);
    const tab = lay.lines[0].pieces.find((g) => g.tab);
    expect(tab).toMatchObject({ leader: 'dot' });
    expect(tab!.w).toBeGreaterThan(100);
  });
});

describe('character styles and Clear Formatting', () => {
  const doc = (): DocText => {
    const d = newDocument();
    const n = runStyleOf(d.styles.Normal);
    return { ...d, runs: [{ ...n, text: 'Compound 12 was formed' }], paras: [paraFromStyle(d.styles.Normal, {})] };
  };
  it('gives words a character style’s look and name', () => {
    const t = applyCharStyle(doc(), 9, 11, 'Strong');
    expect(t.runs.find((r) => r.text === '12')).toMatchObject({ bold: true, cstyle: 'Strong' });
  });
  it('makes a style from the words picked', () => {
    const d = doc();
    const { t, id } = newCharStyle(d, 'Reagent', 0, 8, { ...runStyleOf(d.styles.Normal), italic: true, smallCaps: true }, d.paras[0]);
    expect(charStylesOf(t)[id]).toMatchObject({ name: 'Reagent', italic: true, smallCaps: true, custom: true });
  });
  it('takes the selection back to plain Normal text', () => {
    let t = doc();
    t = { ...t, runs: rt.applyStyle(t.runs, 0, 8, { bold: true, smallCaps: true, color: '#ff0000' }), paras: [{ ...t.paras[0], style: 'Heading2' }] };
    t = clearFormatting(t, 0, 8, 0, 0);
    expect(t.runs[0]).toMatchObject({ text: 'Compound 12 was formed', ...runStyleOf(defaultStyles().Normal) });
    expect(t.runs[0].bold || t.runs[0].smallCaps || t.runs[0].color).toBeFalsy();
    expect(t.paras[0].style).toBeUndefined();
  });
});

describe('Word files', () => {
  /** A document with each of the new things in it. */
  const sample = (): DocText => {
    const d = newDocument();
    const n = runStyleOf(d.styles.Normal);
    const P = (ps: ParaStyle = {}) => paraFromStyle(d.styles.Normal, ps);
    const runs: TextRun[] = [
      { ...n, text: 'Plain ' }, { ...n, smallCaps: true, text: 'small caps' }, { ...n, text: ' ' }, { ...n, strike: true, text: 'struck' }, { ...n, text: ' ' }, { ...n, allCaps: true, text: 'caps' },
      { ...n, text: ' ' }, { ...n, bold: true, cstyle: 'Strong', text: 'strong' }, { ...n, text: '\nName\tYield\n' },
      { ...n, text: 'Step\nSub\n' }, { ...n, text: 'Done\nEnd' },
    ];
    return {
      ...d,
      runs,
      paras: [
        P(),
        P({ tabs: [{ pos: 144, kind: 'right', leader: 'dot' }, { pos: 216, kind: 'decimal' }] }),
        P({ list: 'number', scheme: 'outline' }),
        P({ list: 'number', level: 1, scheme: 'outline' }),
        P({ list: 'bullet', bullet: '✓' }),
        P(),
      ],
      watermark: { ...defaultWatermark('CONFIDENTIAL'), color: '#ff0000', layout: 'horizontal' },
      pageColor: '#fff2cc',
      pageBorder: { ...defaultPageBorder(), style: 'double', width: 1.5, color: '#1f4e79', from: 'text', space: 4 },
    };
  };
  const parts = async (d: DocText) => {
    const files = unzipSync(await writeDocx(d, deps));
    return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strFromU8(v)]));
  };

  it('writes Word’s own markup for each', async () => {
    const p = await parts(sample());
    const body = p['word/document.xml'];
    expect(body).toContain('<w:smallCaps/>');
    expect(body).toContain('<w:strike/>');
    expect(body).toContain('<w:caps/>');
    expect(body).toContain('<w:rStyle w:val="Strong"/>');
    expect(body).toContain('<w:tab w:val="right" w:leader="dot" w:pos="2880"/>');
    expect(body).toContain('<w:background w:color="FFF2CC"/>');
    expect(body).toMatch(/<w:pgBorders w:offsetFrom="text"><w:top w:val="double" w:sz="12" w:space="4" w:color="1F4E79"\/>/);
    expect(p['word/settings.xml']).toContain('<w:displayBackgroundShape/>');
    expect(p['word/styles.xml']).toMatch(/w:styleId="Strong"/);
    expect(p['word/numbering.xml']).toContain('<w:lvlText w:val="%1.%2."/>');
    expect(p['word/numbering.xml']).toContain('<w:lvlText w:val="✓"/>');
    const header = Object.entries(p).find(([k]) => /^word\/header\d*\.xml$/.test(k))?.[1] ?? '';
    expect(header).toContain('PowerPlusWaterMarkObject');
    expect(header).toContain('string="CONFIDENTIAL"');
  });

  it('brings them all back', async () => {
    const d = sample();
    const { doc, warnings } = await readDocx(await writeDocx(d, deps));
    expect(warnings).toEqual([]);
    expect(doc.runs.find((r) => r.text === 'small caps')).toMatchObject({ smallCaps: true });
    expect(doc.runs.find((r) => r.text === 'struck')).toMatchObject({ strike: true });
    expect(doc.runs.find((r) => r.text === 'caps')).toMatchObject({ allCaps: true });
    expect(doc.runs.find((r) => r.text === 'strong')).toMatchObject({ bold: true, cstyle: 'Strong' });
    expect(doc.paras[1].tabs).toEqual([{ pos: 144, kind: 'right', leader: 'dot' }, { pos: 216, kind: 'decimal' }]);
    expect(doc.paras[2]).toMatchObject({ list: 'number', scheme: 'outline' });
    expect(doc.paras[3]).toMatchObject({ list: 'number', level: 1, scheme: 'outline' });
    expect(doc.paras[4]).toMatchObject({ list: 'bullet', bullet: '✓' });
    expect(doc.watermark).toEqual(d.watermark);
    expect(doc.pageColor).toBe('#fff2cc');
    expect(doc.pageBorder).toEqual(d.pageBorder);
    expect(doc.charStyles?.Strong).toMatchObject({ bold: true });
  });

  it('keeps the lower headings', async () => {
    const d = newDocument();
    const h = runStyleOf(d.styles.Heading6);
    const t: DocText = { ...d, runs: [{ ...h, text: 'Deep' }], paras: [paraFromStyle(d.styles.Heading6, {})] };
    const { doc } = await readDocx(await writeDocx(t, deps));
    expect(doc.paras[0].style).toBe('Heading6');
    expect(doc.styles.Heading6.outline).toBe(6);
  });
});
