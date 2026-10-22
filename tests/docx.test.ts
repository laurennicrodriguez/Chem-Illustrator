// @vitest-environment jsdom
//
// Word files: a document saved here is a complete Word package (Word's own styles, lists,
// tables, captions and cross-references, header and footer), and opens here again as it was.
// Files made by Word open with their formatting worked out through the styles, as Word does;
// ChemDraw objects in them become structures. The compound file reader (for embedded objects)
// is checked against a file built by hand from Microsoft's published description.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { listIndent, soleTable } from '../src/io/docx-write';
import { cfbStreams, isCfb } from '../src/io/cfb';
import { cdxmlToCdx, cdxToCdxml } from '../src/io/cdx';
import { readCdxml } from '../src/io/cdxml';
import {
  COMPOUND, newDocument, runStyleOf, paraFromStyle, captionRuns, objectRun, documentPlainText, fieldTexts, type DocText,
} from '../src/document/document';
import * as rt from '../src/richtext';
import type { Contents, ParaStyle, TableData, TextRun } from '../src/model';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1]);
const DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';

const deps: DocxDeps = {
  async picture() { return { png: PNG, svg: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"/>', w: 80, h: 40 }; },
  async svgToPng() { return PNG; },
};

const DRAWING: Contents = { atoms: [], bonds: [], captions: [{ id: 1, x: 0, y: 0, runs: [{ text: 'OH' }], justify: 'left' }], arrows: [], shapes: [] };
const TABLE: TableData = {
  cols: [60, 40], head: 1, lines: 'acs',
  rows: [[{ runs: [{ text: 'Entry' }] }, { runs: [{ text: 'Yield' }] }], [{ runs: [{ text: '1' }] }, { runs: [{ text: '95%' }] }]],
  title: [{ text: 'Table 1. Optimization', bold: true }], notes: [{ text: 'Isolated yield.' }],
};
const TABLE_DRAWING: Contents = { atoms: [], bonds: [], captions: [], arrows: [], shapes: [{ id: 1, kind: 'table', x1: 0, y1: 0, x2: 100, y2: 40, table: TABLE }] };

/** A document with a bit of everything. */
function sample(): DocText {
  const d = newDocument();
  const n = runStyleOf(d.styles.Normal), h = runStyleOf(d.styles.Heading1), c = runStyleOf(d.styles.Caption);
  d.objects = {
    1: { kind: 'drawing', contents: DRAWING },
    2: { kind: 'seq', name: 'Scheme' },
    3: { kind: 'ref', target: 2 },
    4: { kind: 'drawing', contents: TABLE_DRAWING, scale: 0.5 },
    5: { kind: 'picture', src: DOT, w: 30, h: 20, px: { w: 1, h: 1 } },
  };
  const paras: { runs: TextRun[]; ps: ParaStyle }[] = [
    { runs: [{ ...h, text: 'Experimental Section' }], ps: paraFromStyle(d.styles.Heading1, {}) },
    { runs: [{ ...n, text: 'Dissolve in ' }, { ...n, formula: true, text: 'CH2Cl2' }, { ...n, text: '\t(see ' }, objectRun(3, n), { ...n, text: ').' }], ps: paraFromStyle(d.styles.Normal, {}) },
    { runs: [objectRun(1, n)], ps: { ...paraFromStyle(d.styles.Normal, {}), align: 'center' } },
    { runs: [...captionRuns('Scheme', 'S', 2, c), { ...c, text: 'Synthesis of ' }, { ...c, italic: true, text: 'trans' }, { ...c, text: '-stilbene.' }], ps: paraFromStyle(d.styles.Caption, {}) },
    { runs: [{ ...n, text: 'First' }], ps: paraFromStyle(d.styles.Normal, { list: 'bullet' }) },
    { runs: [{ ...n, text: 'Second' }], ps: paraFromStyle(d.styles.Normal, { list: 'bullet', level: 1 }) },
    { runs: [{ ...n, text: 'One' }], ps: paraFromStyle(d.styles.Normal, { list: 'number' }) },
    { runs: [{ ...n, text: 'Two' }], ps: { ...paraFromStyle(d.styles.Normal, { list: 'number' }), indent: 18 } },
    { runs: [objectRun(4, n)], ps: { ...paraFromStyle(d.styles.Normal, {}), align: 'center' } },
    {
      runs: [{ ...n, text: 'New page H' }, { ...n, sub: true, text: '2' }, { ...n, text: 'O' }, { ...n, sup: true, text: '+' },
        { ...n, bold: true, underline: true, color: '#c00000', font: 'Arial', size: 12, text: ' loud' }, objectRun(5, n)],
      ps: { ...paraFromStyle(d.styles.Normal, { pageBreak: true }), firstLine: 18, line: 1.5, spaceBefore: 6 },
    },
  ];
  // each line break takes the look of the paragraph it ends
  const ends = [h, n, n, c, n, n, n, n, n, n];
  const runs: TextRun[] = [];
  paras.forEach((p, i) => {
    runs.push(...p.runs);
    if (i < paras.length - 1) runs.push({ ...ends[i], text: '\n' });
  });
  return {
    ...d,
    runs: rt.normalizeRuns(runs),
    paras: paras.map((p) => p.ps),
    page: { ...d.page, left: 54, right: 54 },
    hf: { header: ['J. Org. Chem.', '', 'Supporting Information'], footer: ['', '', ''], numbers: 'footer-center', prefix: 'S', start: 2, onFirst: false },
  };
}

/** Text as bytes the zip library takes for a file (its own kind of byte array, not a folder). */
const u8 = (s: string | Uint8Array): Uint8Array => {
  const b = typeof s === 'string' ? strToU8(s) : s;
  const out = new Uint8Array(b.length);
  out.set(b);
  return out;
};
const zip = (files: Record<string, Uint8Array>): Uint8Array => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, u8(v)])));

const parts = (bytes: Uint8Array): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(unzipSync(bytes))) if (/\.(xml|rels)$/.test(k)) out[k] = strFromU8(v);
  return out;
};
const wellFormed = (s: string) => new DOMParser().parseFromString(s, 'application/xml').getElementsByTagName('parsererror').length === 0;

describe('saving Word files', () => {
  it('writes a complete package of well-formed parts', async () => {
    const p = parts(await writeDocx(sample(), deps));
    for (const name of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/settings.xml',
      'word/_rels/document.xml.rels', 'word/header1.xml', 'word/footer1.xml', 'customXml/item1.xml', 'docProps/core.xml']) {
      expect(p[name], name).toBeDefined();
      expect(wellFormed(p[name]), name).toBe(true);
    }
    // every part the relationships point to is in the file, with a content type
    const files = Object.keys(unzipSync(await writeDocx(sample(), deps)));
    for (const m of p['word/_rels/document.xml.rels'].matchAll(/Target="([^"]+)"/g)) expect(files).toContain(m[1].startsWith('../') ? m[1].slice(3) : `word/${m[1]}`);
  });

  it('writes Word\'s own styles, headings Word knows, and formulas marked as formulas', async () => {
    const p = parts(await writeDocx(sample(), deps));
    const styles = p['word/styles.xml'];
    expect(styles).toContain('w:styleId="Heading1"><w:name w:val="heading 1"/>');
    expect(styles).toContain('<w:name w:val="caption"/>');
    expect(styles).toContain('w:styleId="ChemFormula"');
    const body = p['word/document.xml'];
    // CH2Cl2 as C, H, ₂, Cl, ₂: subscripts where the formula has them
    expect(body).toMatch(/<w:rStyle w:val="ChemFormula"\/><w:vertAlign w:val="subscript"\/><\/w:rPr><w:t xml:space="preserve">2<\/w:t>/);
    expect(body).toContain('<w:pStyle w:val="Heading1"/>');
  });

  it('writes captions and references as Word\'s fields, with the reference\'s bookmark round the label and number', async () => {
    const body = parts(await writeDocx(sample(), deps))['word/document.xml'];
    expect(body).toContain('> SEQ Scheme \\* ARABIC \\* CHARFORMAT </w:instrText>');
    expect(body).toContain('> REF _Ref100000002 \\h \\* CHARFORMAT </w:instrText>');
    const start = body.indexOf('<w:bookmarkStart w:id="0" w:name="_Ref100000002"/>');
    const seq = body.indexOf('SEQ Scheme');
    const end = body.indexOf('<w:bookmarkEnd w:id="0"/>');
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(seq);
    expect(seq).toBeLessThan(end);
    // what Word shows until it updates the fields, in the same look as the field's code, which
    // Word keeps when it updates them: the caption number bold, the reference plain
    const b = '<w:rPr><w:b/><w:bCs/></w:rPr>';
    expect(body).toContain(`<w:r>${b}<w:instrText xml:space="preserve"> SEQ Scheme \\* ARABIC \\* CHARFORMAT </w:instrText></w:r>` +
      `<w:r>${b}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${b}<w:t xml:space="preserve">1</w:t></w:r>`);
    expect(body).toContain('<w:r><w:instrText xml:space="preserve"> REF _Ref100000002 \\h \\* CHARFORMAT </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t xml:space="preserve">Scheme S1</w:t></w:r>');
  });

  it('writes tables as Word tables with ACS rules, and structures as pictures with their SVG', async () => {
    const p = parts(await writeDocx(sample(), deps));
    const body = p['word/document.xml'];
    expect(body).toContain('<w:tblCaption w:val="Chem Illustrator table 4"/>');
    expect(body).toContain('<w:tblHeader/>');
    expect(body).toContain('<w:gridCol w:w="1200"/><w:gridCol w:w="800"/>');
    expect(body).toContain('name="Chem Illustrator drawing 1"');
    expect(body).toContain('asvg:svgBlip');
    expect(p['[Content_Types].xml']).toContain('Extension="svg"');
  });

  it('writes lists that Word numbers the same way, each numbered list starting at 1', async () => {
    const p = parts(await writeDocx(sample(), deps));
    expect(p['word/numbering.xml']).toContain('<w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/>');
    expect(p['word/document.xml']).toContain('<w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>');
    expect(p['word/numbering.xml']).toContain('<w:startOverride w:val="1"/>');
    // a numbered list item's number hangs out by 1.6 em, as laid out here
    expect(listIndent({ list: 'number' }, 10)).toEqual({ left: 16, hang: 16 });
  });

  it('writes the page, header, footer and S-numbered pages, with no number on the first page', async () => {
    const p = parts(await writeDocx(sample(), deps));
    const body = p['word/document.xml'];
    expect(body).toContain('<w:pgSz w:w="12240" w:h="15840"/>');
    expect(body).toContain('w:left="1080"');
    expect(body).toContain('<w:pgNumType w:start="2"/>');
    expect(body).toContain('<w:titlePg/>');
    expect(p['word/footer1.xml']).toContain('> PAGE \\* CHARFORMAT </w:instrText>');
    expect(p['word/footer1.xml']).toContain('>S</w:t>');
    expect(p['word/footer2.xml']).toBeUndefined();
    expect(p['word/header1.xml']).toContain('>Supporting Information</w:t>');
  });
});

describe('opening Word files saved here', () => {
  it('brings back the text, its formatting and the paragraphs', async () => {
    const d = sample();
    const { doc, warnings } = await readDocx(await writeDocx(d, deps));
    expect(warnings).toEqual([]);
    expect(documentPlainText(doc)).toBe(documentPlainText(d));
    expect(doc.paras).toEqual(d.paras.map((p) => cleanParaLike(p)));
    expect(rt.normalizeRuns(doc.runs.map(noObj))).toEqual(rt.normalizeRuns(d.runs.map(noObj)));
  });

  it('brings back the styles, page, header and footer', async () => {
    const d = sample();
    const { doc } = await readDocx(await writeDocx(d, deps));
    expect(doc.styles).toEqual(d.styles);
    expect(doc.page).toEqual(d.page);
    expect(doc.hf).toEqual(d.hf);
    expect(doc.drawingStyle).toEqual(d.drawingStyle);
  });

  it('brings back structures, tables, pictures, captions and references as they were', async () => {
    const d = sample();
    const { doc } = await readDocx(await writeDocx(d, deps));
    const objs = Object.values(doc.objects);
    const drawing = objs.find((o) => o.kind === 'drawing' && !soleTable(o.contents));
    expect(drawing).toEqual({ kind: 'drawing', contents: DRAWING, scale: undefined });
    const table = objs.find((o) => o.kind === 'drawing' && soleTable(o.contents));
    expect(table && table.kind === 'drawing' && soleTable(table.contents)).toEqual(TABLE);
    expect(objs.find((o) => o.kind === 'picture')).toMatchObject({ kind: 'picture', w: 30, h: 20 });
    // the reference still follows its caption
    const shown = fieldTexts(doc);
    const ref = Object.entries(doc.objects).find(([, o]) => o.kind === 'ref')!;
    expect(shown.get(Number(ref[0]))).toBe('Scheme S1');
  });

  it('brings back compound numbers and their mentions, the bookmark round just the number', async () => {
    const d = newDocument();
    const n = runStyleOf(d.styles.Normal), b = { ...n, bold: true };
    const doc: DocText = {
      ...d, paras: [{}],
      runs: [{ ...n, text: 'Ester ' }, objectRun(1, b), { ...n, text: ' gave acid ' }, objectRun(2, b), { ...n, text: '; acid ' }, objectRun(3, b), { ...n, text: ' is a solid.' }],
      objects: { 1: { kind: 'seq', name: COMPOUND }, 2: { kind: 'seq', name: COMPOUND }, 3: { kind: 'ref', target: 2 } },
    };
    const bytes = await writeDocx(doc, deps);
    const body = parts(bytes)['word/document.xml'];
    // Word shows "Ester 1 gave acid 2; acid 2 is a solid." and updates the mention to the number alone
    expect(body).toMatch(/<w:bookmarkStart w:id="\d+" w:name="_Ref100000002"\/><w:r><w:rPr><w:b\/><w:bCs\/><\/w:rPr><w:fldChar w:fldCharType="begin"\/>/);
    expect(body).toMatch(/<w:t xml:space="preserve">2<\/w:t><\/w:r><w:r><w:rPr><w:b\/><w:bCs\/><\/w:rPr><w:fldChar w:fldCharType="end"\/><\/w:r><w:bookmarkEnd/);
    const back = (await readDocx(bytes)).doc;
    expect(documentPlainText(back)).toBe('Ester 1 gave acid 2; acid 2 is a solid.');
    const kinds = Object.values(back.objects).map((o) => o.kind === 'seq' ? `seq:${o.name}` : o.kind);
    expect(kinds).toEqual(['seq:Compound', 'seq:Compound', 'ref']);
    expect(back.runs.filter((r) => r.obj !== undefined).every((r) => r.bold)).toBe(true);
  });

  it('keeps a structure\'s size when it was made smaller', async () => {
    const d = sample();
    d.objects[1] = { kind: 'drawing', contents: DRAWING, scale: 0.5 };
    const { doc } = await readDocx(await writeDocx(d, deps));
    expect(Object.values(doc.objects).find((o) => o.kind === 'drawing' && !soleTable(o.contents))).toMatchObject({ scale: 0.5 });
  });

  it('uses Word\'s table when its text was changed in Word', async () => {
    const bytes = await writeDocx(sample(), deps);
    const files = unzipSync(bytes);
    files['word/document.xml'] = u8(strFromU8(files['word/document.xml']).replace('>95%<', '>97%<'));
    const { doc } = await readDocx(zip(files));
    const table = Object.values(doc.objects).find((o) => o.kind === 'drawing' && soleTable(o.contents));
    const t = table && table.kind === 'drawing' ? soleTable(table.contents)! : null;
    expect(rt.plainText(t!.rows[1][1].runs)).toBe('97%');
    expect(t!.head).toBe(1);
    expect(t!.lines).toBe('acs');
    // its title and notes stay as the paragraphs Word has
    expect(documentPlainText(doc)).toContain('Table 1. Optimization\n');
    expect(documentPlainText(doc)).toContain('\nIsolated yield.');
  });

  it('opens an empty document', async () => {
    const { doc } = await readDocx(await writeDocx(newDocument(), deps));
    expect(doc.runs).toEqual([]);
    expect(doc.paras).toEqual([{ spaceAfter: 8, align: 'justify' }].map(cleanParaLike));
  });
});

/** Runs without their object ids (the ids are numbered again on opening). */
function noObj(r: TextRun): TextRun {
  const { obj, ...rest } = r;
  return obj === undefined ? r : { ...rest, text: `[${obj === undefined ? '' : 'obj'}]` };
}
function cleanParaLike(p: ParaStyle): ParaStyle {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== false && v !== 0 && v !== null) o[k] = v;
  if (!o.list) { delete o.level; delete o.cont; }
  return o as ParaStyle;
}

// ---------------------------------------------------------------- files made by Word

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const NSV = 'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"';

/** A Word file from its parts (the document's relationships given as [id, type, target]). */
function wordFile(body: string, opts: { styles?: string; numbering?: string; rels?: [string, string, string][]; extra?: Record<string, Uint8Array | string>; sect?: string } = {}): Uint8Array {
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const rels: [string, string, string][] = [['rIdS', 'styles', 'styles.xml'], ['rIdN', 'numbering', 'numbering.xml'], ['rIdT', 'theme', 'theme/theme1.xml'], ...(opts.rels ?? [])];
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': u8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    '_rels/.rels': u8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/_rels/document.xml.rels': u8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map(([id, type, target]) => `<Relationship Id="${id}" Type="${R}${type}" Target="${target}"${type === 'hyperlink' ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`),
    'word/document.xml': u8(`<?xml version="1.0"?><w:document ${W} ${NSV} xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}${opts.sect ?? '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'}</w:body></w:document>`),
    'word/styles.xml': u8(`<?xml version="1.0"?><w:styles ${W}>${opts.styles ?? WORD_STYLES}</w:styles>`),
    'word/numbering.xml': u8(`<?xml version="1.0"?><w:numbering ${W}>${opts.numbering ?? ''}</w:numbering>`),
    'word/theme/theme1.xml': u8('<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>'),
  };
  for (const [k, v] of Object.entries(opts.extra ?? {})) files[k] = typeof v === 'string' ? u8(v) : v;
  return zip(files);
}

/** Styles as Word 2016 writes them (German style ids, as a German Word has). */
const WORD_STYLES = `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="berschrift1"><w:name w:val="heading 1"/><w:basedOn w:val="Standard"/><w:next w:val="Standard"/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="0"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:color w:val="2F5496" w:themeColor="accent1"/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Listenabsatz"><w:name w:val="List Paragraph"/><w:basedOn w:val="Standard"/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Beschriftung"><w:name w:val="caption"/><w:basedOn w:val="Standard"/><w:next w:val="Standard"/><w:pPr><w:spacing w:after="200" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:i/><w:iCs/><w:color w:val="44546A"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Compound"><w:name w:val="Compound"/><w:basedOn w:val="Standard"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Fett"><w:name w:val="Strong"/><w:rPr><w:b/><w:bCs/></w:rPr></w:style>
<w:style w:type="table" w:styleId="Tabellenraster"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr></w:style>`;

const BULLETS = `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val=""/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
<w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1)"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>`;

describe('opening files made by Word', () => {
  it('works out formatting through the styles: theme fonts, sizes, headings in any language', async () => {
    const { doc } = await readDocx(wordFile(
      '<w:p><w:pPr><w:pStyle w:val="berschrift1"/></w:pPr><w:r><w:t>Results</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">Plain and </w:t></w:r><w:r><w:rPr><w:rStyle w:val="Fett"/></w:rPr><w:t>strong</w:t></w:r><w:r><w:rPr><w:i/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve"> big italic</w:t></w:r></w:p>',
    ));
    expect(doc.paras[0].style).toBe('Heading1');
    expect(doc.styles.Heading1).toMatchObject({ name: 'Heading 1', font: 'Calibri Light', size: 16, color: '#2f5496', keepNext: true, spaceBefore: 12, spaceAfter: 0, outline: 1, next: 'Normal', line: 1.08 });
    expect(doc.styles.Normal).toMatchObject({ font: 'Calibri', size: 11, spaceAfter: 8, align: 'left', line: 1.08 });
    expect(doc.styles.Caption).toMatchObject({ italic: true, size: 9, spaceAfter: 10, line: 1 });
    expect(doc.runs[0]).toMatchObject({ text: 'Results\n', font: 'Calibri Light', size: 16, color: '#2f5496' });
    expect(doc.runs.find((r) => r.text === 'strong')).toMatchObject({ bold: true, font: 'Calibri', size: 11 });
    expect(doc.runs.find((r) => r.text === ' big italic')).toMatchObject({ italic: true, size: 12 });
    expect(doc.page).toMatchObject({ w: 595.3, h: 841.9, left: 72, header: 35.4 });
  });

  it('keeps styles of its own that the text uses', async () => {
    const { doc } = await readDocx(wordFile('<w:p><w:pPr><w:pStyle w:val="Compound"/></w:pPr><w:r><w:t>1a</w:t></w:r></w:p>'));
    expect(doc.paras[0]).toMatchObject({ style: 'Compound', align: 'center' });
    expect(doc.styles.Compound).toMatchObject({ name: 'Compound', bold: true, align: 'center' });
    expect(doc.runs[0]).toMatchObject({ text: '1a', bold: true });
  });

  it('reads bullets and numbers at their levels, with the space Word leaves between list items', async () => {
    const item = (num: number, lvl: number, text: string) => `<w:p><w:pPr><w:pStyle w:val="Listenabsatz"/><w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${num}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
    const { doc, warnings } = await readDocx(wordFile(item(1, 0, 'a') + item(1, 1, 'b') + item(2, 0, 'c') + '<w:p><w:r><w:t>after</w:t></w:r></w:p>', { numbering: BULLETS }));
    expect(doc.paras.map((p) => [p.list, p.level ?? 0])).toEqual([['bullet', 0], ['bullet', 1], ['number', 0], [undefined, 0]]);
    // the text starts where Word starts it (36 pt in at the first level)
    expect(doc.paras[0].indent! + listIndent({ list: 'bullet' }, 11).left).toBeCloseTo(36, 1);
    expect(doc.paras[0].spaceAfter ?? 0).toBe(0);
    expect(doc.paras[2].spaceAfter).toBe(8);
    // "1)" is the 1) a) i) scheme
    expect(doc.paras[2].scheme).toBe('paren');
    expect(warnings.join(' ')).not.toMatch(/numbering/);
  });

  it('turns caption numbers and cross-references into its own, following the bookmark', async () => {
    const body =
      '<w:p><w:r><w:t xml:space="preserve">As shown in </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> REF _Ref123 \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Figure 7</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t>.</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="Beschriftung"/></w:pPr><w:bookmarkStart w:id="0" w:name="_Ref123"/><w:r><w:t xml:space="preserve">Figure </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> SEQ Figure \\* ARABIC </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>7</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:bookmarkEnd w:id="0"/><w:r><w:t>. A caption.</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">See page </w:t></w:r><w:fldSimple w:instr=" PAGEREF _Ref999 \\h "><w:r><w:t>4</w:t></w:r></w:fldSimple></w:p>';
    const { doc } = await readDocx(wordFile(body));
    expect(Object.values(doc.objects).map((o) => o.kind).sort()).toEqual(['ref', 'seq']);
    // the numbers are worked out here: the first Figure caption is Figure 1
    expect(documentPlainText(doc)).toBe('As shown in Figure 1.\nFigure 1. A caption.\nSee page 4');
    expect(doc.paras[1].style).toBe('Caption');
  });

  it('keeps a reference to something that is not a caption as the text Word showed', async () => {
    const { doc } = await readDocx(wordFile('<w:p><w:bookmarkStart w:id="1" w:name="cmpd"/><w:r><w:t>3b</w:t></w:r><w:bookmarkEnd w:id="1"/><w:r><w:t xml:space="preserve"> and </w:t></w:r><w:fldSimple w:instr=" REF cmpd \\h "><w:r><w:t>3b</w:t></w:r></w:fldSimple></w:p>'));
    expect(Object.keys(doc.objects)).toEqual([]);
    expect(documentPlainText(doc)).toBe('3b and 3b');
  });

  it('reads page breaks, line breaks, tabs and Symbol-font Greek letters', async () => {
    const { doc } = await readDocx(wordFile(
      '<w:p><w:r><w:t>one</w:t><w:br/><w:t>two</w:t><w:tab/><w:t>three</w:t></w:r></w:p>' +
      '<w:p><w:r><w:br w:type="page"/></w:r><w:r><w:t xml:space="preserve">next page </w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr><w:t>a</w:t></w:r><w:r><w:sym w:font="Symbol" w:char="F062"/></w:r></w:p>',
    ));
    expect(documentPlainText(doc)).toBe('one\ntwo\tthree\nnext page αβ');
    expect(doc.paras[0].spaceAfter ?? 0).toBe(0);
    expect(doc.paras[1].spaceBefore ?? 0).toBe(0);
    expect(doc.paras[2].pageBreak).toBe(true);
    expect(doc.runs.find((r) => r.text.includes('αβ'))?.font).toBe('Calibri');
  });

  it('reads Word tables: columns, merged cells, heading rows and lines from the table style', async () => {
    const cell = (t: string, extra = '') => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${extra}</w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
    const tbl = `<w:tbl><w:tblPr><w:tblStyle w:val="Tabellenraster"/><w:jc w:val="center"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>
      <w:tr><w:trPr><w:tblHeader/></w:trPr>${cell('Conditions', '<w:gridSpan w:val="2"/>')}${cell('Yield')}</w:tr>
      <w:tr>${cell('A')}${cell('B')}${cell('90%')}</w:tr></w:tbl><w:p/>`;
    const { doc } = await readDocx(wordFile(tbl));
    expect(doc.paras).toHaveLength(1);
    const o = Object.values(doc.objects)[0];
    // a table from Word is a table in the text, typed into in place
    const t = o.kind === 'table' ? o.table : null;
    expect(t!.cols).toEqual([100, 100, 100]);
    expect(t!.rows[0][0].span).toBe(2);
    expect(rt.plainText(t!.rows[0][2].runs)).toBe('Yield');
    expect(t!.head).toBe(1);
    expect(t!.lines).toBe('grid');
    expect(t!.align).toEqual(['center', 'center', 'center']);
    expect(doc.paras[0].align).toBe('center');
  });

  it('reads pictures in line with the text at the size Word shows them', async () => {
    const pic = `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="1270000" cy="635000"/><wp:docPr id="1" name="Picture 1"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rIdP"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    const { doc } = await readDocx(wordFile(pic, { rels: [['rIdP', 'image', 'media/image1.png']], extra: { 'word/media/image1.png': PNG } }));
    expect(Object.values(doc.objects)[0]).toMatchObject({ kind: 'picture', w: 100, h: 50, px: { w: 2, h: 1 } });
  });

  it('turns a ChemDraw object into a structure, and keeps other embedded objects as their pictures', async () => {
    const cdx = cdxmlToCdx('<CDXML><page id="1"><fragment id="2"><n id="3" p="10 20"/><n id="4" p="24.4 20" Element="8"/><b id="5" B="3" E="4"/></fragment></page></CDXML>');
    const ole = makeCfb([['\u0001CompObj', new Uint8Array(40)], ['CONTENTS', cdx]]);
    const obj = (prog: string, rel: string) => `<w:p><w:r><w:object><v:shape style="width:60pt;height:30pt"><v:imagedata r:id="rIdE"/></v:shape><o:OLEObject Type="Embed" ProgID="${prog}" r:id="${rel}"/></w:object></w:r></w:p>`;
    const file = wordFile(obj('ChemDraw.Document.6.0', 'rIdO') + obj('Excel.Sheet.12', 'rIdX'), {
      rels: [['rIdE', 'image', 'media/image1.png'], ['rIdO', 'oleObject', 'embeddings/oleObject1.bin'], ['rIdX', 'oleObject', 'embeddings/oleObject2.bin']],
      extra: { 'word/media/image1.png': PNG, 'word/embeddings/oleObject1.bin': ole, 'word/embeddings/oleObject2.bin': new Uint8Array(600) },
    });
    let given: Uint8Array | null = null;
    const { doc, warnings } = await readDocx(file, {
      chemdraw: (b) => { given = b; return readCdxml(cdxToCdxml(b)).doc.contents(); },
      drawingSize: () => ({ w: 30, h: 15 }),
    });
    expect(given).toEqual(cdx);
    const [chem, other] = Object.values(doc.objects);
    expect(chem.kind).toBe('drawing');
    expect(chem.kind === 'drawing' && chem.contents.atoms.length).toBe(2);
    expect(chem.kind === 'drawing' && chem.scale).toBe(2);
    expect(other).toMatchObject({ kind: 'picture', w: 60, h: 30 });
    expect(warnings.join(' ')).toMatch(/Embedded objects other than ChemDraw/);
  });

  it('reads the header, footer and page numbers', async () => {
    const hdr = `<?xml version="1.0"?><w:hdr ${W}><w:p><w:r><w:t>Smith et al.</w:t></w:r><w:r><w:ptab w:alignment="right" w:relativeTo="margin" w:leader="none"/></w:r><w:r><w:t>SI</w:t></w:r></w:p></w:hdr>`;
    const ftr = `<?xml version="1.0"?><w:ftr ${W}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">Page S</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>3</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> of 9</w:t></w:r></w:p></w:ftr>`;
    const sect = '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/><w:footerReference w:type="default" r:id="rIdF"/><w:pgSz w:w="12240" w:h="15840"/><w:pgNumType w:start="5"/></w:sectPr>';
    const { doc, warnings } = await readDocx(wordFile('<w:p><w:r><w:t>x</w:t></w:r></w:p>', {
      sect, rels: [['rIdH', 'header', 'header1.xml'], ['rIdF', 'footer', 'footer1.xml']], extra: { 'word/header1.xml': hdr, 'word/footer1.xml': ftr },
    }));
    expect(doc.hf).toEqual({ header: ['Smith et al.', '', 'SI'], footer: ['', 'Page', ''], numbers: 'footer-center', prefix: 'S', start: 5, onFirst: true });
    expect(warnings.join(' ')).toMatch(/after the page number/);
  });

  it('notes what it leaves out, and never refuses a file', async () => {
    const { doc, warnings } = await readDocx(wordFile(
      '<w:p><w:hyperlink r:id="x"><w:r><w:t>link</w:t></w:r></w:hyperlink><w:ins><w:r><w:t xml:space="preserve"> added</w:t></w:r></w:ins><w:del><w:r><w:delText>gone</w:delText></w:r></w:del><w:r><w:footnoteReference w:id="1"/></w:r></w:p>',
    ));
    // tracked changes stay tracked (see revisions.test.ts)
    expect(documentPlainText(doc)).toBe('link addedgone');
    expect(doc.runs.filter((r) => r.rev).map((r) => r.rev!.split('|')[0])).toEqual(['ins', 'del']);
    // a link whose address is missing stays as its text
    expect(doc.runs[0].link).toBeUndefined();
    expect(warnings.join(' ')).not.toMatch(/Links/);
    expect(warnings.join(' ')).not.toMatch(/Tracked/);
  });

  it('reads Word\'s footnotes and endnotes as notes, without Word\'s number mark', async () => {
    const ref = (tag: string, id: number) => `<w:r><w:rPr><w:rStyle w:val="Funotenzeichen"/></w:rPr><w:${tag}Reference w:id="${id}"/></w:r>`;
    const notes = (tag: string, text: string) => `<?xml version="1.0"?><w:${tag}s ${W}><w:${tag} w:type="separator" w:id="0"><w:p><w:r><w:separator/></w:r></w:p></w:${tag}>` +
      `<w:${tag} w:type="continuationSeparator" w:id="1"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${tag}>` +
      `<w:${tag} w:id="2"><w:p><w:pPr><w:pStyle w:val="Funotentext"/></w:pPr><w:r><w:rPr><w:rStyle w:val="Funotenzeichen"/></w:rPr><w:${tag}Ref/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r><w:r><w:t>${text}</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> in situ</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p></w:${tag}>` +
      `</w:${tag}s>`;
    const styles = `${WORD_STYLES}<w:style w:type="paragraph" w:styleId="Funotentext"><w:name w:val="footnote text"/><w:basedOn w:val="Standard"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style>` +
      '<w:style w:type="character" w:styleId="Funotenzeichen"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>';
    const { doc, warnings } = await readDocx(wordFile(`<w:p><w:r><w:t>Made</w:t></w:r>${ref('footnote', 2)}<w:r><w:t xml:space="preserve"> and kept</w:t></w:r>${ref('endnote', 2)}<w:r><w:t>.</w:t></w:r></w:p>`, {
      styles, rels: [['rIdF', 'footnotes', 'footnotes.xml'], ['rIdE', 'endnotes', 'endnotes.xml']],
      extra: { 'word/footnotes.xml': notes('footnote', 'Generated'), 'word/endnotes.xml': notes('endnote', 'Stored cold') },
    }));
    expect(warnings.join(' ')).not.toMatch(/note/i);
    const all = Object.values(doc.objects).filter((o) => o.kind === 'note');
    expect(all.map((o) => o.kind === 'note' && [!!o.end, o.runs.map((r) => r.text).join('')])).toEqual([[false, 'Generated in situ.'], [true, 'Stored cold in situ.']]);
    const first = all[0].kind === 'note' ? all[0].runs : [];
    expect(first.find((r) => r.text.includes('in situ'))?.italic).toBe(true);
    expect(first[0].size).toBe(10);
    expect(documentPlainText(doc)).toBe('Made1 and kepti.');
  });

  it('says so when a file is not a Word document', async () => {
    await expect(readDocx(zip({ 'a.txt': u8('hello') }))).rejects.toThrow(/not a Word document/);
  });
});


describe('links in Word files', () => {
  it('saves links as Word\'s own and reads them back: web pages, bookmarks, links in footnotes', async () => {
    const d = newDocument();
    const n = runStyleOf(d.styles.Normal), h = runStyleOf(d.styles.Heading1);
    d.objects = { 1: { kind: 'note', runs: [{ ...n, text: 'See ' }, { ...n, text: 'the paper', link: 'https://doi.org/10.1021/ja00001' }, { ...n, text: '.' }] } };
    const runs: TextRun[] = [
      { ...h, text: 'Results' }, { ...n, text: '\n' },
      { ...n, text: 'Read ' }, { ...n, text: 'the site', link: 'https://example.com/a?b=1&c=2', color: '#0563c1', underline: true },
      { ...n, text: ' or ' }, { ...n, text: 'results', link: '#_Heading1' }, { ...n, text: ' or ' }, { ...n, text: 'the file', link: 'data/run 1.cdxml' },
      objectRun(1, n),
    ];
    d.runs = rt.normalizeRuns(runs);
    d.paras = [{ ...paraFromStyle(d.styles.Heading1, {}), marks: ['_Heading1'] }, paraFromStyle(d.styles.Normal, {})];
    const bytes = await writeDocx(d, deps);
    const files = unzipSync(bytes);
    const xml = strFromU8(files['word/document.xml']);
    const rels = strFromU8(files['word/_rels/document.xml.rels']);
    expect(xml).toMatch(/<w:hyperlink r:id="[^"]+"[^>]*>.*the site/);
    expect(xml).toMatch(/<w:hyperlink w:anchor="_Heading1"/);
    expect(xml).toMatch(/<w:bookmarkStart w:id="\d+" w:name="_Heading1"\/>/);
    expect(rels).toMatch(/Target="https:\/\/example.com\/a\?b=1&amp;c=2" TargetMode="External"/);
    expect(rels).toMatch(/Target="data\/run%201.cdxml" TargetMode="External"/);
    const notes = strFromU8(files['word/footnotes.xml']);
    expect(notes).toMatch(/<w:hyperlink r:id=/);
    expect(strFromU8(files['word/_rels/footnotes.xml.rels'])).toMatch(/doi.org\/10.1021/);

    const { doc } = await readDocx(bytes);
    const linked = doc.runs.filter((r) => r.link).map((r) => [r.text, r.link]);
    expect(linked).toEqual([['the site', 'https://example.com/a?b=1&c=2'], ['results', '#_Heading1'], ['the file', 'data/run 1.cdxml']]);
    expect(doc.paras[0].marks).toEqual(['_Heading1']);
    const note = Object.values(doc.objects).find((o) => o.kind === 'note');
    expect(note?.kind === 'note' && note.runs.find((r) => r.link)?.link).toBe('https://doi.org/10.1021/ja00001');
  });

  it('reads Word\'s links, HYPERLINK fields and bookmarks, and drops hidden bookmarks nothing uses', async () => {
    const { doc } = await readDocx(wordFile(
      '<w:p><w:bookmarkStart w:id="0" w:name="Intro"/><w:bookmarkStart w:id="1" w:name="_Toc123"/><w:r><w:t>Intro</w:t></w:r><w:bookmarkEnd w:id="0"/><w:bookmarkEnd w:id="1"/></w:p>' +
      '<w:p><w:hyperlink r:id="rIdL" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>web</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve"> </w:t></w:r>' +
      '<w:hyperlink w:anchor="Intro"><w:r><w:t>back</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve"> </w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK "mailto:a@b.org" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>mail</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      '<w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>',
      { rels: [['rIdL', 'hyperlink', 'https://www.rsc.org/']] },
    ));
    expect(doc.runs.filter((r) => r.link).map((r) => [r.text, r.link])).toEqual([['web', 'https://www.rsc.org/'], ['back', '#Intro'], ['mail', 'mailto:a@b.org']]);
    expect(doc.runs.find((r) => r.text.includes('after'))?.link).toBeUndefined();
    expect(doc.paras[0].marks).toEqual(['Intro']);
  });
});

// ---------------------------------------------------------------- compound files

/** A compound file (version 3, 512-byte sectors) holding these streams, built from Microsoft's description. */
function makeCfb(streams: [string, Uint8Array][]): Uint8Array {
  const S = 512, M = 64, END = 0xfffffffe, FREE = 0xffffffff;
  const sectors: Uint8Array[] = [new Uint8Array(S)];
  const fat: number[] = [0xfffffffd];
  const alloc = (data: Uint8Array): number => {
    const n = Math.max(1, Math.ceil(data.length / S));
    const start = sectors.length;
    for (let i = 0; i < n; i++) {
      const s = new Uint8Array(S);
      s.set(data.subarray(i * S, (i + 1) * S));
      sectors.push(s);
      fat.push(i < n - 1 ? start + i + 1 : END);
    }
    return start;
  };
  const u32s = (xs: number[]) => { const b = new Uint8Array(xs.length * 4); const dv = new DataView(b.buffer); xs.forEach((x, i) => dv.setUint32(i * 4, x, true)); return b; };
  const mini: Uint8Array[] = [], miniFat: number[] = [];
  const entries: { name: string; start: number; size: number }[] = [];
  for (const [name, data] of streams) {
    if (data.length < 4096) {
      const n = Math.max(1, Math.ceil(data.length / M));
      const start = miniFat.length;
      for (let i = 0; i < n; i++) {
        const s = new Uint8Array(M);
        s.set(data.subarray(i * M, (i + 1) * M));
        mini.push(s);
        miniFat.push(i < n - 1 ? start + i + 1 : END);
      }
      entries.push({ name, start, size: data.length });
    } else entries.push({ name, start: alloc(data), size: data.length });
  }
  const miniBytes = new Uint8Array(mini.length * M);
  mini.forEach((m, i) => miniBytes.set(m, i * M));
  const miniStart = mini.length ? alloc(miniBytes) : END;
  const miniFatStart = miniFat.length ? alloc(u32s(miniFat)) : END;
  const all = [{ name: 'Root Entry', start: miniStart, size: miniBytes.length, type: 5 }, ...entries.map((e) => ({ ...e, type: 2 }))];
  const dir = new Uint8Array(128 * Math.ceil(all.length / 4) * 4);
  const ddv = new DataView(dir.buffer);
  all.forEach((e, i) => {
    const at = i * 128;
    for (let k = 0; k < e.name.length; k++) ddv.setUint16(at + 2 * k, e.name.charCodeAt(k), true);
    ddv.setUint16(at + 64, (e.name.length + 1) * 2, true);
    dir[at + 66] = e.type;
    ddv.setUint32(at + 68, FREE, true);
    ddv.setUint32(at + 72, i > 0 && i + 1 < all.length ? i + 1 : FREE, true);
    ddv.setUint32(at + 76, i === 0 && all.length > 1 ? 1 : FREE, true);
    ddv.setUint32(at + 116, e.start, true);
    ddv.setUint32(at + 120, e.size, true);
  });
  const dirStart = alloc(dir);
  while (fat.length < S / 4) fat.push(FREE);
  sectors[0] = u32s(fat);
  const head = new Uint8Array(S);
  const hdv = new DataView(head.buffer);
  head.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  hdv.setUint16(0x18, 0x3e, true); hdv.setUint16(0x1a, 3, true); hdv.setUint16(0x1c, 0xfffe, true);
  hdv.setUint16(0x1e, 9, true); hdv.setUint16(0x20, 6, true);
  hdv.setUint32(0x2c, 1, true); hdv.setUint32(0x30, dirStart, true); hdv.setUint32(0x38, 4096, true);
  hdv.setUint32(0x3c, miniFatStart, true); hdv.setUint32(0x40, miniFat.length ? 1 : 0, true);
  hdv.setUint32(0x44, END, true); hdv.setUint32(0x48, 0, true);
  hdv.setUint32(0x4c, 0, true);
  for (let i = 1; i < 109; i++) hdv.setUint32(0x4c + 4 * i, FREE, true);
  const out = new Uint8Array(S * (sectors.length + 1));
  out.set(head);
  sectors.forEach((s, i) => out.set(s, S * (i + 1)));
  return out;
}

describe('compound files (embedded objects)', () => {
  it('reads small streams from the mini stream and large ones from their sectors', () => {
    const small = Uint8Array.from({ length: 100 }, (_, i) => i);
    const big = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) & 255);
    const file = makeCfb([['\u0001Ole', small], ['CONTENTS', big]]);
    expect(isCfb(file)).toBe(true);
    const s = cfbStreams(file);
    expect(s.get('\u0001Ole')).toEqual(small);
    expect(s.get('CONTENTS')).toEqual(big);
  });

  it('refuses what is not a compound file', () => {
    expect(isCfb(new Uint8Array(600))).toBe(false);
    expect(() => cfbStreams(new Uint8Array(600))).toThrow();
  });
});
