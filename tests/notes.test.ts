// @vitest-environment jsdom
//
// Footnotes and endnotes (References > Insert Footnote, Insert Endnote): numbered apart, each in
// its own format; footnotes at the foot of the page their number is on (a line moves to the next
// page with its note when they don't both fit), endnotes after the text; saved as Word's own
// footnotes and endnotes, and opened here again as notes. The table of figures lists the
// captions of a label with their pages, and is Word's TOC field for captions in a Word file.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { DocLayouter, NOTE_RULE } from '../src/document/doc-layout';
import {
  captionRuns, fieldTexts, newDocument, noteLabel, noteStyle, objectRun, paraFromStyle, runStyleOf, type DocObject, type DocText,
} from '../src/document/document';
import { emptyTof, tofEntries } from '../src/document/toc';
import type { ParaStyle, TextRun } from '../src/model';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };
const measure = (t: string, s: number) => t.length * s * 0.5;
const layouter = () => new DocLayouter({ measure, drawingSize: () => ({ w: 10, h: 10 }) });
const BODY = 'The crude product was purified by flash chromatography on silica gel to give the title compound as a white solid. ';

/** Paragraphs of text; `notes` puts a note's number at the end of the paragraph with that index. */
function sample(count: number, notes: Record<number, { end?: boolean; text: string }>, extra: Partial<DocText> = {}): DocText {
  const d = { ...newDocument(), ...extra };
  const n = runStyleOf(d.styles.Normal);
  const ns = runStyleOf(noteStyle(d));
  const runs: TextRun[] = [];
  const paras: ParaStyle[] = [];
  const objects: Record<number, DocObject> = {};
  let id = 1;
  for (let p = 0; p < count; p++) {
    if (p) runs.push({ ...n, text: '\n' });
    runs.push({ ...n, text: `${p}: ${BODY.repeat(3)}` });
    const note = notes[p];
    if (note) {
      objects[id] = { kind: 'note', ...(note.end ? { end: true } : {}), runs: [{ ...ns, text: note.text }] };
      runs.push(objectRun(id++, { ...n, sup: true }));
    }
    paras.push(paraFromStyle(d.styles.Normal, {}));
  }
  return { ...d, runs, paras, objects };
}

const shown = (l: { pieces: { text: string; obj?: number }[] }) => l.pieces.filter((p) => p.obj === undefined).map((p) => p.text).join('');

describe('note numbers', () => {
  it('counts in Word\'s formats', () => {
    expect([1, 2, 3, 4, 9, 14].map((n) => noteLabel(n, 'lowerRoman'))).toEqual(['i', 'ii', 'iii', 'iv', 'ix', 'xiv']);
    expect(noteLabel(4, 'upperRoman')).toBe('IV');
    expect([1, 2, 26, 27].map((n) => noteLabel(n, 'lowerLetter'))).toEqual(['a', 'b', 'z', 'aa']);
    expect([1, 2, 3, 4, 5, 6].map((n) => noteLabel(n, 'chicago'))).toEqual(['*', '†', '‡', '§', '**', '††']);
    expect(noteLabel(12, 'decimal')).toBe('12');
  });

  it('numbers footnotes and endnotes apart, in the order they come', () => {
    const d = sample(4, { 0: { text: 'a' }, 1: { end: true, text: 'b' }, 2: { text: 'c' }, 3: { end: true, text: 'd' } });
    const f = fieldTexts(d);
    expect([1, 2, 3, 4].map((id) => f.get(id))).toEqual(['1', 'i', '2', 'ii']);
    const g = fieldTexts({ ...d, notes: { foot: 'chicago', end: 'decimal' } });
    expect([1, 2, 3, 4].map((id) => g.get(id))).toEqual(['*', '1', '†', '2']);
  });
});

describe('footnotes on the page', () => {
  it('puts a footnote at the foot of the page its number is on, under a short line', () => {
    const d = sample(3, { 1: { text: 'Prepared as in ref 4.' } });
    const lay = layouter().layout(d);
    const n = lay.notes.get(1)!;
    expect(n.page).toBe(0);
    expect(n.x).toBe(72);
    // at the bottom of the text area
    expect(n.y + n.h).toBeCloseTo(lay.pageH - 72, 3);
    expect(shown(n.lay.lines[0])).toBe('1Prepared as in ref 4.');
    // the number comes before the text, raised and smaller
    const mark = n.lay.lines[0].pieces[0];
    expect(mark.text).toBe('1');
    expect(mark.dy).toBeLessThan(0);
    expect(mark.size).toBeLessThan(noteStyle(d).size);
    const rule = lay.noteRules.find((r) => r.page === 0)!;
    expect(rule.w).toBe(NOTE_RULE);
    expect(rule.y).toBeLessThan(n.y);
    // the text stays above it
    for (const l of lay.text.lines) expect(l.y).toBeLessThan(rule.y);
    // it can be clicked into (a placed object)
    expect(lay.objects.some((o) => o.id === 1 && o.page === 0)).toBe(true);
  });

  it('keeps a line and its footnote on one page, taking the room the notes need from the text', () => {
    const plain = layouter().layout(sample(14, {}));
    const pageOneEnd = plain.pages[0].end;
    // a long note on a line near the bottom of the first page
    const lastPara = plain.text.lines[pageOneEnd - 1].para;
    const long = 'A note long enough to take several lines at the foot of the page. '.repeat(6);
    const lay = layouter().layout(sample(14, { [lastPara]: { text: long } }));
    const n = lay.notes.get(1)!;
    // the line with the number is on the same page as the note
    const refLine = lay.text.lines.findIndex((l) => l.pieces.some((g) => g.obj === 1));
    const refPage = lay.pages.findIndex((p) => refLine >= p.first && refLine < p.end);
    expect(n.page).toBe(refPage);
    // the first page holds fewer lines, as its foot is taken by the note (or the number moved on)
    expect(lay.pages[0].end).toBeLessThan(pageOneEnd);
    for (let i = lay.pages[n.page].first; i < lay.pages[n.page].end; i++) expect(lay.text.lines[i].y).toBeLessThan(n.y);
  });

  it('puts endnotes after the text, and footnotes there too in the views without pages', () => {
    const d = sample(3, { 0: { text: 'foot' }, 1: { end: true, text: 'end one' }, 2: { end: true, text: 'end two' } });
    const lay = layouter().layout(d);
    const last = lay.text.lines[lay.text.lines.length - 1];
    const e1 = lay.notes.get(2)!, e2 = lay.notes.get(3)!;
    expect(e1.y).toBeGreaterThan(last.y);
    expect(e2.y).toBeGreaterThan(e1.y);
    expect(shown(e1.lay.lines[0])).toBe('iend one');
    expect(lay.notes.get(1)!.y).toBeGreaterThan(e2.y);
    const cont = layouter().layout(d, { notesAtEnd: true });
    expect(cont.notes.get(1)!.y).toBeGreaterThan(last.y);
    expect(cont.notes.get(1)!.y).toBeLessThan(cont.notes.get(2)!.y);
    expect(cont.noteRules).toHaveLength(2);
  });
});

describe('footnotes in Word files', () => {
  it('saves Word\'s own footnotes and endnotes, and opens them as notes again', async () => {
    const d = sample(3, { 0: { text: 'Prepared as in ref 4.' }, 1: { end: true, text: 'An endnote.' }, 2: { text: 'Second footnote.' } }, { notes: { end: 'decimal', foot: 'chicago' } });
    const bytes = await writeDocx(d, deps);
    const files = unzipSync(bytes);
    const body = strFromU8(files['word/document.xml']);
    expect(body).toContain('<w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/>');
    expect(body).toContain('<w:footnoteReference w:id="2"/>');
    expect(body).toContain('<w:endnoteReference w:id="1"/>');
    expect(body).toContain('<w:footnotePr><w:numFmt w:val="chicago"/></w:footnotePr><w:endnotePr><w:numFmt w:val="decimal"/></w:endnotePr>');
    const foot = strFromU8(files['word/footnotes.xml']);
    expect(foot).toContain('<w:footnote w:type="separator" w:id="-1">');
    expect(foot).toContain('<w:pStyle w:val="FootnoteText"/>');
    expect(foot).toContain('<w:footnoteRef/>');
    expect(foot).toContain('Prepared as in ref 4.');
    expect(strFromU8(files['word/endnotes.xml'])).toContain('An endnote.');
    expect(strFromU8(files['word/settings.xml'])).toContain('<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>');
    expect(strFromU8(files['[Content_Types].xml'])).toContain('wordprocessingml.footnotes+xml');
    expect(strFromU8(files['word/_rels/document.xml.rels'])).toContain('relationships/endnotes');
    const styles = strFromU8(files['word/styles.xml']);
    expect(styles).toContain('<w:name w:val="footnote text"/>');
    expect(styles).toContain('<w:name w:val="footnote reference"/>');

    const back = await readDocx(bytes);
    expect(back.warnings.join(' ')).not.toMatch(/note/i);
    const notes = Object.values(back.doc.objects).filter((o) => o.kind === 'note') as Extract<DocObject, { kind: 'note' }>[];
    expect(notes.map((o) => [!!o.end, o.runs.map((r) => r.text).join('')])).toEqual([[false, 'Prepared as in ref 4.'], [true, 'An endnote.'], [false, 'Second footnote.']]);
    expect(back.doc.notes).toEqual({ foot: 'chicago', end: 'decimal' });
    // the numbers sit in the text, raised
    const refs = back.doc.runs.filter((r) => r.obj !== undefined && back.doc.objects[r.obj]?.kind === 'note');
    expect(refs).toHaveLength(3);
    expect(refs.every((r) => r.sup)).toBe(true);
    expect([...fieldTexts(back.doc).values()]).toEqual(['*', '1', '†']);
  });
});

describe('table of figures', () => {
  function figures(): DocText {
    const d = newDocument();
    const n = runStyleOf(d.styles.Normal), c = runStyleOf(d.styles.Caption);
    d.objects = { 1: { kind: 'tof', name: 'Scheme' }, 2: { kind: 'seq', name: 'Scheme' }, 3: { kind: 'seq', name: 'Figure' }, 4: { kind: 'seq', name: 'Scheme' } };
    const runs: TextRun[] = [objectRun(1, n)];
    const paras: ParaStyle[] = [paraFromStyle(d.styles.Normal, {})];
    const cap = (id: number, name: string, text: string) => {
      runs.push({ ...n, text: '\n' }, ...captionRuns(name, 'S', id, c), { ...c, text });
      paras.push(paraFromStyle(d.styles.Caption, {}));
    };
    const body = () => { for (let k = 0; k < 8; k++) { runs.push({ ...n, text: '\n' + BODY.repeat(4) }); paras.push(paraFromStyle(d.styles.Normal, {})); } };
    cap(2, 'Scheme', 'Synthesis of ketone 3.');
    body();
    cap(3, 'Figure', 'X-ray structure of 3.');
    body();
    cap(4, 'Scheme', 'Scope of the reaction.');
    d.runs = runs;
    d.paras = paras;
    return d;
  }

  it('lists the captions of its label with their whole text', () => {
    const d = figures();
    expect(tofEntries(d, 'Scheme').map((e) => e.text)).toEqual(['Scheme S1. Synthesis of ketone 3.', 'Scheme S2. Scope of the reaction.']);
    expect(tofEntries(d, '').map((e) => e.text)).toEqual(['Scheme S1. Synthesis of ketone 3.', 'Figure S1. X-ray structure of 3.', 'Scheme S2. Scope of the reaction.']);
    expect(tofEntries(d, 'Table')).toEqual([]);
  });

  it('shows each caption with dots up to its page number', () => {
    const d = figures();
    const lay = layouter().layout(d);
    const lines = lay.text.lines.filter((l) => l.block === 1);
    const last = shown(lines[lines.length - 1]);
    const entries = tofEntries(d, 'Scheme');
    expect(lay.pages.length).toBeGreaterThan(1);
    expect(last).toMatch(/^Scheme S2\. Scope of the reaction\.[. ]+\d+$/);
    expect(last.endsWith(String(lay.paraTops[entries[1].para].page + 1))).toBe(true);
    // no captions of the label yet: what to do
    const none = layouter().layout({ ...d, objects: { ...d.objects, 1: { kind: 'tof', name: 'Chart' } } });
    expect(none.text.lines.filter((l) => l.block === 1).map(shown).join(' ')).toContain(emptyTof('Chart').slice(0, 30));
  });

  it('saves as Word\'s TOC field for the label, and opens as a table of figures again', async () => {
    const d = figures();
    const lay = layouter().layout(d);
    const pages = lay.paraTops.map((pt) => lay.pages[pt.page].label);
    const bytes = await writeDocx(d, { ...deps, pages: () => pages });
    const files = unzipSync(bytes);
    const body = strFromU8(files['word/document.xml']);
    expect(body).toContain('<w:instrText xml:space="preserve"> TOC \\h \\z \\c "Scheme" </w:instrText>');
    expect(body).toContain('<w:pStyle w:val="TableofFigures"/>');
    expect(body).toContain('Scheme S2. Scope of the reaction.');
    expect(strFromU8(files['word/styles.xml'])).toContain('<w:name w:val="table of figures"/>');
    const back = await readDocx(bytes);
    expect(Object.values(back.doc.objects).filter((o) => o.kind === 'tof')).toEqual([{ kind: 'tof', name: 'Scheme' }]);
    // the list's lines are not kept as text as well
    expect(back.doc.runs.map((r) => r.text).join('').match(/Scope of the reaction/g)).toHaveLength(1);
    // every caption: the Caption style's paragraphs
    const all = await writeDocx({ ...d, objects: { ...d.objects, 1: { kind: 'tof', name: '' } } }, deps);
    expect(strFromU8(unzipSync(all)['word/document.xml'])).toContain(' TOC \\h \\z \\t "Caption,1" ');
    expect(Object.values((await readDocx(all)).doc.objects).filter((o) => o.kind === 'tof')).toEqual([{ kind: 'tof', name: '' }]);
  });
});
