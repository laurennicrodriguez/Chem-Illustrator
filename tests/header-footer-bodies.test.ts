// @vitest-environment jsdom
//
// Full headers and footers, as in Word: a different first page, different odd and even pages
// (the page number on the outside edge), and headers with pictures, tables and fields, laid out
// on each page and saved in Word files and read back.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { newDocument, paraFromStyle, runStyleOf, type DocObject, type DocText, type HeaderFooter } from '../src/document/document';
import { DocLayouter } from '../src/document/doc-layout';
import { headerFooterText } from '../src/document/doc-paint';
import { bodyFromZones, hfKeyFor, insertInZone, numbersFor, zonesFor } from '../src/document/hf-bodies';
import { documentMeasure } from '../src/text/font-measure';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import * as rt from '../src/richtext';
import type { ParaStyle, TableData, TextRun } from '../src/model';

const measure = documentMeasure((t: string, size: number) => t.length * size * 0.5);
const layouter = () => new DocLayouter({ measure, drawingSize: () => ({ w: 200, h: 100 }) });
const deps: DocxDeps = { async picture() { return null; }, async svgToPng() { return new Uint8Array(); } };
// a 1×1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** A document of `n` pages (a page break before each paragraph after the first). */
function pagesDoc(n: number, hf: Partial<HeaderFooter>, objects: Record<number, DocObject> = {}): DocText {
  const d = newDocument();
  const s = d.styles.Normal;
  const runs: TextRun[] = [];
  const ps: ParaStyle[] = [];
  for (let i = 0; i < n; i++) {
    runs.push({ ...runStyleOf(s), text: `page ${i + 1}${i < n - 1 ? '\n' : ''}` });
    ps.push({ ...paraFromStyle(s, {}), ...(i > 0 ? { pageBreak: true } : {}) });
  }
  return { ...d, runs, paras: ps, hf: { ...d.hf, ...hf }, objects };
}

const texts = (t: DocText, lay: ReturnType<DocLayouter['layout']>, i: number) => headerFooterText(t, lay.pages[i].label, lay.pages[i].hf, lay.pages[i]).map((p) => `${p.where}:${p.align}:${p.text}`);

describe('first, odd and even pages', () => {
  it('chooses the first page\'s or an even page\'s header, the number on the other side on even pages', () => {
    const hf = { ...newDocument().hf, firstPage: true, oddEven: true, numbers: 'footer-right' as const };
    expect(hfKeyFor(hf, 'header', true, 1)).toBe('firstHeader');
    expect(hfKeyFor(hf, 'footer', false, 2)).toBe('evenFooter');
    expect(hfKeyFor(hf, 'header', false, 3)).toBe('header');
    expect(numbersFor(hf, 'evenFooter')).toBe('footer-left');
    expect(numbersFor(hf, 'footer')).toBe('footer-right');
    expect(zonesFor({ ...hf, even: { header: ['E', '', ''], footer: ['', '', ''] } }, 'evenHeader')).toEqual(['E', '', '']);
  });

  it('shows each page\'s own header and footer', () => {
    const t = pagesDoc(3, {
      header: ['', '', 'Odd'], numbers: 'footer-right', onFirst: false,
      firstPage: true, first: { header: ['', 'Title page', ''], footer: ['', '', ''] },
      oddEven: true, even: { header: ['Even', '', ''], footer: ['', '', ''] },
    });
    const lay = layouter().layout(t);
    expect(lay.pages).toHaveLength(3);
    expect(texts(t, lay, 0)).toEqual(['header:center:Title page']);
    expect(texts(t, lay, 1)).toEqual(['header:left:Even', 'footer:left:2']);
    expect(texts(t, lay, 2)).toEqual(['header:right:Odd', 'footer:right:3']);
  });

  it('saves Different First Page and Different Odd & Even Pages in Word and reads them back', async () => {
    const t = pagesDoc(3, {
      header: ['', '', 'Odd'], numbers: 'footer-right', onFirst: false,
      firstPage: true, first: { header: ['', 'Title page', ''], footer: ['', '', ''] },
      oddEven: true, even: { header: ['Even', '', ''], footer: ['', '', ''] },
    });
    const bytes = await writeDocx(t, deps);
    const parts = unzipSync(bytes);
    expect(strFromU8(parts['word/settings.xml'])).toContain('<w:evenAndOddHeaders/>');
    const doc = strFromU8(parts['word/document.xml']);
    expect(doc).toContain('w:type="first"');
    expect(doc).toContain('w:type="even"');
    expect(doc).toContain('<w:titlePg/>');
    const { doc: back } = await readDocx(bytes);
    expect(back.hf.firstPage).toBe(true);
    expect(back.hf.first?.header).toEqual(['', 'Title page', '']);
    expect(back.hf.oddEven).toBe(true);
    expect(back.hf.even?.header).toEqual(['Even', '', '']);
    expect(back.hf.header).toEqual(['', '', 'Odd']);
    expect(back.hf.numbers).toBe('footer-right');
    expect(back.hf.onFirst).toBe(false);
    expect(back.hf.bodies).toBeUndefined();
  });
});

describe('headers with pictures, tables and fields', () => {
  const look = { font: 'Calibri', size: 10 };

  function logoDoc(): DocText {
    const objects: Record<number, DocObject> = { 1: { kind: 'picture', src: PNG, w: 72, h: 36, px: { w: 1, h: 1 } } };
    let body = bodyFromZones(['Group meeting', '', ''], 2, 'p. ', look, 468, () => { objects[2] = { kind: 'field', code: 'page' }; return 2; });
    body = insertInZone(body, 1, { ...look, obj: 1, text: '￼' });
    return pagesDoc(2, { numbers: 'header-right', bodies: { header: body } }, objects);
  }

  it('puts a picture in a part of the header, keeping its text and page number', () => {
    const t = logoDoc();
    const body = t.hf.bodies!.header!;
    expect(rt.plainText(body.runs)).toBe('Group meeting\t￼\tp. ￼');
    expect(body.paras?.[0].tabs?.map((x) => x.kind)).toEqual(['center', 'right']);
  });

  it('lays out the header on each page with its picture and that page\'s number', () => {
    const t = logoDoc();
    const lay = layouter().layout(t);
    expect(lay.hfs).toHaveLength(2);
    const [p1, p2] = lay.hfs;
    expect(p1.objects.map((o) => o.id)).toEqual([1]);
    expect(p2.objects[0].page).toBe(1);
    // the picture sits at the top margin's header distance, in the middle
    expect(p1.objects[0].y).toBeGreaterThanOrEqual(lay.pages[0].top + lay.pages[0].setup.header - 1);
    const shown = (h: typeof p1) => h.texts.flatMap((l) => l.lines.flatMap((x) => x.pieces.map((g) => g.shown ?? (g.obj === undefined ? g.text : '')))).join('');
    expect(shown(p1)).toContain('p. 1');
    expect(shown(p2)).toContain('p. 2');
    // the plain header is not drawn as well
    expect(headerFooterText(t, lay.pages[0].label, lay.pages[0].hf, lay.pages[0]).filter((p) => p.where === 'header')).toEqual([]);
  });

  it('saves a header with a picture and a table in Word and reads them back', async () => {
    const t = logoDoc();
    const cell = (text: string) => ({ runs: [{ ...look, text }] });
    t.objects[3] = { kind: 'table', table: { cols: [200, 200], rows: [[cell('Lab notebook'), cell('NOH-123')]] } as unknown as TableData };
    t.hf = { ...t.hf, bodies: { ...t.hf.bodies, footer: { runs: [{ ...look, obj: 3, text: '￼' }] } } };
    const bytes = await writeDocx(t, deps);
    const parts = unzipSync(bytes);
    const header = Object.keys(parts).find((k) => /word\/header\d+\.xml$/.test(k))!;
    const hx = strFromU8(parts[header]);
    expect(hx).toContain('<w:drawing>');
    expect(hx).toContain(' PAGE ');
    expect(strFromU8(parts[`word/_rels/${header.slice(5)}.rels`])).toContain('media/');
    const footer = Object.keys(parts).find((k) => /word\/footer\d+\.xml$/.test(k))!;
    expect(strFromU8(parts[footer])).toContain('<w:tbl>');
    const { doc, warnings } = await readDocx(bytes);
    expect(warnings.join(' ')).not.toMatch(/header and footer were left out/);
    const hb = doc.hf.bodies?.header;
    const fb = doc.hf.bodies?.footer;
    expect(hb).toBeDefined();
    expect(fb).toBeDefined();
    const kinds = (runs: TextRun[]) => runs.filter((r) => r.obj !== undefined).map((r) => doc.objects[r.obj!]?.kind);
    expect(kinds(hb!.runs)).toEqual(['picture', 'field']);
    expect(kinds(fb!.runs)).toEqual(['table']);
    const tb = doc.objects[fb!.runs.find((r) => r.obj !== undefined)!.obj!];
    expect(tb.kind === 'table' && rt.plainText(tb.table.rows[0][1].runs)).toBe('NOH-123');
    expect(rt.plainText(hb!.runs)).toContain('Group meeting');
    // and they are laid out
    expect(layouter().layout(doc).hfs.length).toBeGreaterThan(0);
  });
});
