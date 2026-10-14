// @vitest-environment jsdom
//
// Citations and the bibliography in a document: laid out on pages (the bibliography's lines
// flow across pages and are picked as one), saved to Word as the numbers and paragraphs Word
// shows, and opened here again live, with the references kept in the file.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { DocLayouter, EMPTY_BIBLIOGRAPHY, bibHang } from '../src/document/doc-layout';
import { OBJECT_CHAR, documentPlainText, fieldTexts, newDocument, objectRun, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import { blankRef, bibliography, type Reference } from '../src/document/references';
import { caretPos, offsetAt } from '../src/text/layout';
import { TextEditing } from '../src/text/editing';
import type { TextRun } from '../src/model';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };
const measure = (t: string, s: number) => t.length * s * 0.5;
const layouter = () => new DocLayouter({ measure, drawingSize: () => ({ w: 10, h: 10 }) });

/** A zip again, each file as the zip library's own kind of byte array (not taken for a folder). */
const rezip = (files: Record<string, Uint8Array>): Uint8Array => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => {
  const out = new Uint8Array(v.length);
  out.set(v);
  return [k, out];
})));

const REFS: Reference[] = [
  { ...blankRef('article', 'r-a'), authors: ['Fulmer, Gregory R.', 'Miller, Alexander J. M.'], title: 'NMR Chemical Shifts', journal: 'Organometallics', year: '2010', volume: '29', pages: '2176–2179', doi: '10.1021/om100106e' },
  { ...blankRef('article', 'r-b'), authors: ['Smith, John'], journal: 'Org. Lett.', year: '2020', volume: '22', pages: '1–5' },
  { ...blankRef('book', 'r-c'), authors: ['Clayden, Jonathan'], title: 'Organic Chemistry', publisher: 'OUP', year: '2012' },
  { ...blankRef('article', 'r-d'), authors: ['Never, Cited'], journal: 'J. Org. Chem.', year: '1999' },
];

/** A document citing b, then a and c, then b again, with a heading and the bibliography at the end. */
function sample(extraRefs = 0): DocText {
  const d = newDocument();
  const n = runStyleOf(d.styles.Normal), h = runStyleOf(d.styles.Heading1);
  const sup = { ...n, sup: true };
  d.references = [...REFS, ...Array.from({ length: extraRefs }, (_, i) => ({ ...blankRef('article', `r-x${i}`), authors: [`Author${i}, A.`], title: `A rather long title for reference number ${i} so that it wraps onto more lines`, journal: 'J. Am. Chem. Soc.', year: '2001', volume: '1', pages: '1–2' }))];
  d.objects = { 1: { kind: 'cite', refs: ['r-b'] }, 2: { kind: 'cite', refs: ['r-a', 'r-c'] }, 3: { kind: 'cite', refs: ['r-b'] }, 4: { kind: 'bib' } };
  if (extraRefs) d.objects[5] = { kind: 'cite', refs: d.references.slice(4).map((r) => r.id) };
  const runs: TextRun[] = [
    { ...n, text: 'Known compounds' }, objectRun(1, sup), { ...n, text: ' were made as reported' }, objectRun(2, sup), { ...n, text: ' and again' }, objectRun(3, sup),
    ...(extraRefs ? [{ ...n, text: ' and more' }, objectRun(5, sup)] : []),
    { ...n, text: '.\n' }, { ...h, text: 'References\n' }, objectRun(4, n),
  ];
  d.runs = runs;
  d.paras = [paraFromStyle(d.styles.Normal, {}), paraFromStyle(d.styles.Heading1, {}), paraFromStyle(d.styles.Normal, {})];
  return d;
}

describe('citations and the bibliography in a document', () => {
  it('numbers the citations and lists only the cited references, in order', () => {
    const d = sample();
    const f = fieldTexts(d);
    expect([f.get(1), f.get(2), f.get(3)]).toEqual(['1', '2,3', '1']);
    expect(bibliography(d).map((e) => e.ref.id)).toEqual(['r-b', 'r-a', 'r-c']);
    expect(documentPlainText(d)).toContain('Known compounds1 were made as reported2,3 and again1.');
  });

  it('lays citations out raised and smaller, as superscripts', () => {
    const lay = layouter().layout(sample());
    const g = lay.text.lines.flatMap((l) => l.pieces).find((p) => p.obj === 1)!;
    expect(g.shown).toBe('1');
    expect(g.dy).toBeLessThan(0);
    expect(g.size).toBeCloseTo(11 * 0.75);
  });

  it('lays the bibliography out as lines of entries that hold its one character', () => {
    const d = sample();
    const lay = layouter().layout(d);
    const bibLines = lay.text.lines.filter((l) => l.block === 4);
    expect(bibLines.length).toBeGreaterThanOrEqual(3);
    const shown = bibLines.map((l) => l.pieces.filter((p) => p.decor).map((p) => p.text).join('')).join(' ');
    expect(shown).toMatch(/^\(1\)Smith, J\. Org\. Lett\. 2020, 22, 1–5\./);
    expect(shown).toContain('(2)Fulmer, G. R.; Miller, A. J. M. NMR Chemical Shifts.');
    expect(shown).not.toContain('Never');
    // the caret goes before and after the whole bibliography, never into it
    const at = d.runs.reduce((a, r) => a + r.text.length, 0) - 1;
    expect(caretPos(lay.text, at).line).toBe(lay.text.lines.indexOf(bibLines[0]));
    expect(caretPos(lay.text, at + 1).line).toBe(lay.text.lines.indexOf(bibLines[bibLines.length - 1]));
    const mid = bibLines[1];
    expect(offsetAt(lay.text, 200, mid.y)).toBeGreaterThanOrEqual(at);
    // clicking anywhere on it picks it: its box
    const box = lay.objects.find((o) => o.id === 4)!;
    expect(box.w).toBeCloseTo(lay.textW);
    expect(box.h).toBeGreaterThan(30);
  });

  it('runs a long bibliography on to the next pages, framed on each', () => {
    const lay = layouter().layout(sample(120));
    const pages = new Set(lay.text.lines.filter((l) => l.block === 4).map((l) => lay.pages.findIndex((p) => lay.text.lines.indexOf(l) >= p.first && lay.text.lines.indexOf(l) < p.end)));
    expect(pages.size).toBeGreaterThan(1);
    expect(lay.objects.filter((o) => o.id === 4).length).toBe(pages.size);
    for (const o of lay.objects.filter((x) => x.id === 4)) expect(o.y + o.h).toBeLessThanOrEqual(lay.pages[o.page].top + lay.pageH);
  });

  it('says so when nothing is cited yet', () => {
    const d = sample();
    d.runs = d.runs.filter((r) => r.obj === undefined || r.obj === 4);
    const lay = layouter().layout(d);
    expect(lay.text.lines.filter((l) => l.block === 4).flatMap((l) => l.pieces).map((p) => p.text).join('')).toContain(EMPTY_BIBLIOGRAPHY.slice(0, 20));
  });

  it('puts a citation in as one step of Undo', () => {
    const d = newDocument();
    d.runs = [{ text: 'Shifts' }];
    d.references = REFS;
    const ed = new TextEditing(d, {}, measure, 11);
    ed.setCaret(6);
    ed.update({ ...ed.t, objects: { 1: { kind: 'cite', refs: ['r-a'] } } } as DocText, 'Insert citation');
    ed.replace(6, 6, [objectRun(1, { sup: true })], undefined, null);
    expect(documentPlainText(ed.t as DocText)).toBe('Shifts1');
    ed.undo();
    expect(documentPlainText(ed.t as DocText)).toBe('Shifts');
    expect((ed.t as DocText).objects).toEqual({});
  });

  it('hangs every entry\'s number out by the same amount', () => {
    expect(bibHang(['(1)', '(10)'], 10, 'Times New Roman', measure)).toBeCloseTo(4 * 5 + 5);
    expect(bibHang(['1'], 10, 'Times New Roman', measure)).toBe(15);
  });
});

describe('citations in Word files', () => {
  async function parts(d: DocText) {
    const zip = unzipSync(await writeDocx(d, deps));
    return { zip, body: strFromU8(zip['word/document.xml']) };
  }

  it('writes citations as superscript numbers inside a field Word leaves alone, and the bibliography as paragraphs', async () => {
    const { body, zip } = await parts(sample());
    expect(body).toContain('ADDIN CHEMILLUSTRATOR_CITE r-a r-c');
    expect(body).toMatch(/<w:vertAlign w:val="superscript"\/><\/w:rPr><w:t xml:space="preserve">2,3<\/w:t>/);
    expect(body).toMatch(/<w:p><w:pPr>[^]*?<\/w:pPr><w:bookmarkStart w:id="\d+" w:name="_ChemBib4"\/><w:r><w:t xml:space="preserve">\(1\)/);
    expect(body).toMatch(/<w:bookmarkEnd w:id="\d+"\/><\/w:p><w:sectPr>/);
    // the entries: number, tab, text with the journal in italics and the year in bold
    expect(body).toMatch(/<w:t xml:space="preserve">\(1\)<\/w:t><w:tab\/><\/w:r><w:r><w:t xml:space="preserve">Smith, J\. <\/w:t><\/w:r><w:r><w:rPr><w:i\/><w:iCs\/><\/w:rPr><w:t xml:space="preserve">Org\. Lett\.<\/w:t>/);
    expect(body).toMatch(/<w:b\/><w:bCs\/><\/w:rPr><w:t xml:space="preserve">2020<\/w:t>/);
    expect(body).not.toContain('Never');
    const model = strFromU8(zip['customXml/item1.xml']);
    expect(model).toContain('r-d');
  });

  it('opens again with live citations, the bibliography, the references and the style', async () => {
    const d = { ...sample(), citeStyle: 'rsc' as const };
    d.references = d.references!.map((r) => (r.id === 'r-c' ? { ...r, typed: 'Typed by hand.' } : r));
    const back = (await readDocx(await writeDocx(d, deps))).doc;
    expect(back.citeStyle).toBe('rsc');
    expect(back.references?.map((r) => r.id)).toEqual(['r-a', 'r-b', 'r-c', 'r-d']);
    expect(back.references?.find((r) => r.id === 'r-c')?.typed).toBe('Typed by hand.');
    const kinds = Object.values(back.objects).map((o) => o.kind).sort();
    expect(kinds).toEqual(['bib', 'cite', 'cite', 'cite']);
    const cites = back.runs.filter((r) => r.obj !== undefined && back.objects[r.obj].kind === 'cite');
    expect(cites.every((r) => r.sup)).toBe(true);
    expect([...fieldTexts(back).values()]).toEqual(['1', '2,3', '1']);
    expect(documentPlainText(back)).toBe(documentPlainText(d));
    expect(back.paras).toHaveLength(3);
    // and the same file again
    const again = (await readDocx(await writeDocx(back, deps))).doc;
    expect(documentPlainText(again)).toBe(documentPlainText(d));
    expect(Object.values(again.objects).filter((o) => o.kind === 'bib')).toHaveLength(1);
  });

  it('keeps a bibliography changed in Word as the text typed there', async () => {
    const bytes = await writeDocx(sample(), deps);
    const zip = unzipSync(bytes);
    zip['word/document.xml'] = strToU8(strFromU8(zip['word/document.xml']).replace('Smith, J. ', 'Smith, John '));
    const back = (await readDocx(rezip(zip))).doc;
    expect(Object.values(back.objects).some((o) => o.kind === 'bib')).toBe(false);
    expect(documentPlainText(back)).toContain('(1)\tSmith, John Org. Lett.');
    // the citations are still live
    expect(Object.values(back.objects).filter((o) => o.kind === 'cite')).toHaveLength(3);
  });

  it('reads another program\'s citations as the text Word showed', async () => {
    const bytes = await writeDocx(sample(), deps);
    const zip = unzipSync(bytes);
    delete zip['customXml/item1.xml'];
    const back = await readDocx(rezip(zip));
    expect(Object.values(back.doc.objects).length).toBe(0);
    expect(back.doc.references).toBeUndefined();
    expect(documentPlainText(back.doc)).toContain('Known compounds1 were made as reported2,3 and again1.');
    expect(documentPlainText(back.doc)).toContain('(2)\tFulmer, G. R.');
    expect(back.doc.runs.some((r) => r.sup && r.text === '2,3')).toBe(true);
    expect(back.doc.runs.some((r) => r.text.includes(OBJECT_CHAR))).toBe(false);
  });
});
