// @vitest-environment jsdom
//
// Accessibility: the contrast rule (WCAG 2.2), the checker's rules for drawings, slides,
// documents and workbooks, and alt text kept on structures, pictures and charts through
// ChemDraw, PowerPoint, Word and Excel files.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { Doc, type TextRun } from '../src/model';
import { Deck } from '../src/deck/deck';
import {
  contrastRatio, neededContrast, checkDrawing, checkDocument, checkWorkbook, repeatedTitles, groupIssues,
  setStructureAlt, structureAlt, contentsAlt,
} from '../src/accessibility';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { newDocument, objectRun, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import * as rt from '../src/richtext';
import { Workbook } from '../src/sheet/workbook';
import { chartFromRange } from '../src/sheet/chart';
import { writeXlsx, readXlsx, type XlsxPictures } from '../src/io/xlsx';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1]);
const PNG_URL = `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`;

/** Ethanol, drawn at (100, 100). */
function ethanol(d: Doc): number {
  let first = 0;
  d.edit('draw', () => {
    const a = d.addAtom(100, 100), b = d.addAtom(117, 90), c = d.addAtom(134, 100, 8);
    d.addBond(a.id, b.id);
    d.addBond(b.id, c.id);
    first = a.id;
  });
  return first;
}

describe('contrast', () => {
  it('works out WCAG contrast ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // the classic borderline grey
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#767676', '#fff')).toBeGreaterThanOrEqual(4.5);
    expect(neededContrast(12, false)).toBe(4.5);
    expect(neededContrast(18, false)).toBe(3);
    expect(neededContrast(14, true)).toBe(3);
  });
});

describe('alt text on structures', () => {
  it('is kept on one atom of the structure, and survives a ChemDraw file', () => {
    const d = new Doc();
    const a = ethanol(d);
    const last = [...d.atoms.keys()].pop()!;
    setStructureAlt(d, last, 'Ethanol, the solvent');
    const atoms = [...d.atoms.values()];
    expect(structureAlt(atoms)).toBe('Ethanol, the solvent');
    expect(atoms.filter((x) => x.alt).map((x) => x.id)).toEqual([a]);
    // undone in one step
    d.undo();
    expect(structureAlt([...d.atoms.values()])).toBeUndefined();
    d.redo();
    const back = readCdxml(writeCdxml(d)).doc;
    expect(structureAlt([...back.atoms.values()])).toBe('Ethanol, the solvent');
    setStructureAlt(d, a, '');
    expect(structureAlt([...d.atoms.values()])).toBeUndefined();
  });

  it('keeps a picture\'s alt text in a ChemDraw file', () => {
    const d = new Doc();
    d.edit('pic', () => d.addShape({ kind: 'picture', x1: 0, y1: 0, x2: 50, y2: 30, src: PNG_URL, px: { w: 2, h: 1 }, alt: 'A TLC plate' }));
    const back = readCdxml(writeCdxml(d)).doc;
    expect([...back.shapes.values()].find((s) => s.kind === 'picture')?.alt).toBe('A TLC plate');
  });
});

describe('the checker', () => {
  it('finds pictures without alt text, structures with only SMILES, and faint text in a drawing', () => {
    const d = new Doc();
    ethanol(d);
    d.edit('more', () => {
      d.addShape({ kind: 'picture', x1: 200, y1: 0, x2: 260, y2: 40, src: PNG_URL });
      d.addShape({ kind: 'picture', x1: 300, y1: 0, x2: 360, y2: 40, src: PNG_URL, alt: 'A flask' });
      d.addCaption({ x: 10, y: 200, runs: [{ text: 'faint note', size: 10, color: '#bbbbbb' } as TextRun] });
      d.addCaption({ x: 10, y: 260, runs: [{ text: 'clear note', size: 10, color: '#333333' } as TextRun] });
    });
    const issues = checkDrawing(d);
    expect(issues.filter((i) => i.rule === 'alt-missing')).toHaveLength(1);
    expect(issues.filter((i) => i.rule === 'alt-smiles')).toHaveLength(1);
    const faint = issues.filter((i) => i.rule === 'contrast');
    expect(faint).toHaveLength(1);
    expect(faint[0].where).toContain('faint note');
    expect(faint[0].detail).toMatch(/needs 4.5 to 1/);
    // grouped errors first
    expect(groupIssues(issues).map((g) => g.level)).toEqual(['error', 'warning', 'tip']);
  });

  it('finds slides without titles, repeated titles, and titles read after what they overlap', () => {
    const deck = Deck.blank(new Doc());
    const d = deck.docOf(0);
    // the title slide's title is empty
    expect(checkDrawing(d, { slide: 0, slideTitle: true }).map((i) => i.rule)).toContain('slide-title');
    const title = [...d.captions.values()].find((c) => c.ph === 'title')!;
    d.edit('type', () => d.updateCaption(title.id, { runs: [{ ...title.runs[0], text: 'Results' } as TextRun] }));
    expect(checkDrawing(d, { slide: 0, slideTitle: true }).map((i) => i.rule)).not.toContain('slide-title');
    d.edit('pic', () => d.addShape({ kind: 'picture', x1: title.x, y1: title.y - 10, x2: title.x + 100, y2: title.y + 20, src: PNG_URL, alt: 'x' }));
    expect(checkDrawing(d, { slide: 0, slideTitle: true }).map((i) => i.rule)).toContain('reading-order');
    const rep = repeatedTitles(['Results', 'Methods', 'results ', null]);
    expect(rep).toHaveLength(1);
    expect(rep[0].where).toBe('Slide 3');
  });

  it('finds a document\'s pictures without alt text, skipped heading levels, tables without headers and floating pictures', () => {
    const d = newDocument();
    const n = runStyleOf(d.styles.Normal);
    const runs: TextRun[] = [
      { ...n, text: 'Intro\n' }, { ...n, text: 'Deep\n' }, objectRun(1, n), { ...n, text: '\n' }, objectRun(2, n), { ...n, text: '\nEnd' },
    ];
    const N = paraFromStyle(d.styles.Normal, {});
    const t: DocText = {
      ...d, runs: rt.normalizeRuns(runs),
      paras: [paraFromStyle(d.styles.Heading1, {}), paraFromStyle(d.styles.Heading3, {}), N, N, N],
      objects: {
        1: { kind: 'picture', src: PNG_URL, w: 100, h: 50, float: { wrap: 'behind', x: 0, y: 0 } },
        2: { kind: 'table', table: { rows: [[{ runs: [] }], [{ runs: [] }]], cols: [100], head: 0 } as never },
      },
    };
    const rules = checkDocument(t).map((i) => i.rule);
    expect(rules).toContain('alt-missing');
    expect(rules).toContain('heading-order');
    expect(rules).toContain('table-header');
    expect(rules).toContain('floating');
  });

  it('finds a workbook\'s merged cells, charts and pictures without alt text, and faint cells', () => {
    const wb = new Workbook(['Sheet1', 'Data']);
    const s = wb.sheets[0];
    wb.build(() => {
      s.setInput(0, 0, 'x'); s.setInput(1, 0, '1'); s.setInput(2, 0, '2');
      s.setInput(0, 1, 'y'); s.setInput(1, 1, '3'); s.setInput(2, 1, '4');
      s.merge({ r1: 4, c1: 0, r2: 4, c2: 2 });
      s.setInput(6, 0, 'pale');
      s.patchStyle({ r1: 6, c1: 0, r2: 6, c2: 0 }, { color: '#ffff00' });
      s.setCharts([chartFromRange(s, { r1: 0, c1: 0, r2: 2, c2: 1 }, 'scatter')!]);
    });
    const rules = checkWorkbook(wb).map((i) => i.rule);
    expect(rules.filter((r) => r === 'alt-missing')).toHaveLength(1);
    expect(rules).toContain('merged-cells');
    expect(rules).toContain('contrast');
    expect(rules).toContain('sheet-name');
  });
});

describe('alt text in Office files', () => {
  it('goes to PowerPoint as each picture\'s and structure\'s description, and comes back', async () => {
    const deck = Deck.design(new Doc(), { w: 960, h: 540 });
    const d = deck.docOf(0);
    const a = ethanol(d);
    setStructureAlt(d, a, 'Ethanol');
    d.edit('pic', () => d.addShape({ kind: 'picture', x1: 300, y1: 80, x2: 400, y2: 140, src: PNG_URL, px: { w: 2, h: 1 }, alt: 'Crude NMR spectrum' }));
    const opts: PptxOptions = { async picture() { return { png: PNG, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', box: { x1: 90, y1: 80, x2: 140, y2: 110 } }; }, async svgToPng() { return PNG; } };
    const bytes = await writePptx({ size: deck.size, master: deck.master, design: true, slides: [{ layout: 'blank', doc: d, notes: '' }] }, opts);
    const xml = strFromU8(unzipSync(bytes)['ppt/slides/slide1.xml']);
    expect(xml).toContain('descr="Ethanol"');
    expect(xml).toContain('descr="Crude NMR spectrum"');
    const back = readPptx(bytes).slides[0].contents;
    expect(back.shapes.find((s) => s.kind === 'picture')?.alt).toBe('Crude NMR spectrum');
    expect(contentsAlt(back)).toBe('Ethanol');
  });

  it('writes a slide\'s title first, so screen readers read it first', async () => {
    const deck = Deck.blank(new Doc());
    const d = deck.docOf(0);
    const title = [...d.captions.values()].find((c) => c.ph === 'title')!;
    d.edit('type', () => {
      d.updateCaption(title.id, { runs: [{ ...title.runs[0], text: 'Total synthesis' } as TextRun] });
      d.addShape({ kind: 'picture', x1: 700, y1: 420, x2: 900, y2: 520, src: PNG_URL, alt: 'Logo' });
    });
    const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };
    const bytes = await writePptx({ size: deck.size, master: deck.master, slides: [{ layout: deck.slides[0].layout, doc: d, notes: '' }] }, opts);
    const xml = strFromU8(unzipSync(bytes)['ppt/slides/slide1.xml']);
    expect(xml.indexOf('Total synthesis')).toBeLessThan(xml.indexOf('descr="Logo"'));
  });

  it('goes to Word as each picture\'s and figure\'s description, and comes back', async () => {
    const d = newDocument();
    const n = runStyleOf(d.styles.Normal);
    const N = paraFromStyle(d.styles.Normal, {});
    const fig = new Doc();
    ethanol(fig);
    const t: DocText = {
      ...d, runs: rt.normalizeRuns([{ ...n, text: 'A\n' }, objectRun(1, n), { ...n, text: '\n' }, objectRun(2, n)]), paras: [N, N, N],
      objects: { 1: { kind: 'picture', src: PNG_URL, w: 100, h: 50, alt: 'Reaction set-up' }, 2: { kind: 'drawing', contents: fig.contents(), alt: 'Ethanol' } },
    };
    const deps: DocxDeps = { async picture() { return { png: PNG, w: 80, h: 40 }; }, async svgToPng() { return PNG; } };
    const bytes = await writeDocx(t, deps);
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(xml).toContain('descr="Reaction set-up"');
    expect(xml).toContain('descr="Ethanol"');
    const back = (await readDocx(bytes)).doc;
    const objs = Object.values(back.objects);
    expect(objs.find((o) => o.kind === 'picture')).toMatchObject({ alt: 'Reaction set-up' });
    expect(objs.find((o) => o.kind === 'drawing')).toMatchObject({ alt: 'Ethanol' });
  });

  it('goes to Excel as a chart\'s description, and comes back', async () => {
    const wb = new Workbook(['Data']);
    const s = wb.sheet;
    wb.build(() => {
      s.setInput(0, 0, 'x'); s.setInput(1, 0, '1'); s.setInput(2, 0, '2');
      s.setInput(0, 1, 'y'); s.setInput(1, 1, '3'); s.setInput(2, 1, '4');
      s.setCharts([{ ...chartFromRange(s, { r1: 0, c1: 0, r2: 2, c2: 1 }, 'scatter')!, alt: 'Yield against time' }]);
    });
    const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => null };
    const bytes = await writeXlsx(wb, pictures);
    expect(strFromU8(unzipSync(bytes)['xl/drawings/drawing1.xml'])).toContain('descr="Yield against time"');
    const back = (await readXlsx(bytes)).book;
    expect(back.sheet.charts[0].alt).toBe('Yield against time');
  });
});
