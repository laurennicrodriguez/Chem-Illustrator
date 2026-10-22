// @vitest-environment jsdom
//
// OpenDocument text (.odt) in Document mode: saved, and opened again (ours and LibreOffice's).

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8, strToU8 } from 'fflate';
import { newDocument, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import { readOdt, writeOdt, isOdt, points, zipFiles } from '../src/io/odt';
import * as rt from '../src/richtext';
import type { TextRun } from '../src/model';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function sample(): DocText {
  const d = newDocument();
  const H = d.styles.Heading1, N = d.styles.Normal;
  const runs: TextRun[] = [
    { ...runStyleOf(H), text: 'Synthesis\n' },
    { ...runStyleOf(N), text: 'Dissolve in ' },
    { ...runStyleOf(N), formula: true, text: 'CH2Cl2' },
    { ...runStyleOf(N), text: '  & stir ' },
    { ...runStyleOf(N), bold: true, color: '#c00000', text: '<1 h>' },
    { ...runStyleOf(N), obj: 1, text: '￼' },
    { ...runStyleOf(N), link: 'https://doi.org/10.1000/x', text: ' (ref)' },
    { ...runStyleOf(N), text: '\nFirst step\nSecond step\n' },
    { ...runStyleOf(N), obj: 2, text: '￼' },
    { ...runStyleOf(N), text: '\n' },
    { ...runStyleOf(N), obj: 3, text: '￼' },
  ];
  return {
    ...d, runs,
    paras: [paraFromStyle(H, { style: 'Heading1' }), paraFromStyle(N, {}), paraFromStyle(N, { list: 'number' }), paraFromStyle(N, { list: 'number' }), paraFromStyle(N, {}), { ...paraFromStyle(N, { pageBreak: true }), align: 'center' }],
    objects: {
      1: { kind: 'note', runs: [{ ...runStyleOf(N), text: 'Dry solvent.' }] },
      2: { kind: 'table', table: { cols: [100, 120], head: 1, lines: 'grid', rows: [[{ runs: [{ text: 'Entry' }] }, { runs: [{ text: 'Yield' }] }], [{ runs: [{ text: '1' }] }, { runs: [{ text: '85%' }] }]] } },
      3: { kind: 'picture', src: PNG, w: 72, h: 36, px: { w: 1, h: 1 } },
    },
    page: { ...d.page, w: 595.28, h: 841.89 },
  };
}

describe('ODT', () => {
  it('reads lengths in any unit as points', () => {
    expect(points('1in')).toBe(72);
    expect(points('2.54cm')).toBe(72);
    expect(points('12pt')).toBe(12);
  });

  it('saves a valid package: the mimetype first and uncompressed', async () => {
    const bytes = await writeOdt(sample());
    expect(isOdt(bytes)).toBe(true);
    const files = unzipSync(bytes);
    expect(Object.keys(files)[0]).toBe('mimetype');
    const content = strFromU8(files['content.xml']);
    expect(content).toContain('<text:h text:style-name="P1" text:outline-level="1">');
    expect(content).toContain('<text:s text:c="1"/>');
    expect(content).toContain('&lt;1 h&gt;');
    expect(Object.keys(files).some((k) => k.startsWith('Pictures/'))).toBe(true);
    // well-formed XML
    for (const f of ['content.xml', 'styles.xml', 'meta.xml', 'META-INF/manifest.xml']) {
      const d = new DOMParser().parseFromString(strFromU8(files[f]), 'application/xml');
      expect(d.getElementsByTagName('parsererror').length).toBe(0);
    }
  });

  it('opens what it saves', async () => {
    const { doc } = readOdt(await writeOdt(sample()));
    const text = rt.plainText(doc.runs);
    expect(text.split('\n').slice(0, 4)).toEqual(['Synthesis', 'Dissolve in CH2Cl2  & stir <1 h>￼ (ref)', 'First step', 'Second step']);
    expect(doc.paras[0].style).toBe('Heading1');
    expect(doc.paras[2].list).toBe('number');
    expect(doc.runs.find((r) => r.text === '2')?.sub).toBe(true);
    expect(doc.runs.find((r) => r.text === '<1 h>')).toMatchObject({ bold: true, color: '#c00000' });
    expect(doc.runs.find((r) => r.text === ' (ref)')?.link).toBe('https://doi.org/10.1000/x');
    const objs = Object.values(doc.objects);
    const note = objs.find((o) => o.kind === 'note');
    expect(note?.kind === 'note' && rt.plainText(note.runs)).toBe('Dry solvent.');
    const tb = objs.find((o) => o.kind === 'table');
    expect(tb?.kind === 'table' && tb.table.rows.map((r) => r.map((c) => rt.plainText(c.runs)))).toEqual([['Entry', 'Yield'], ['1', '85%']]);
    expect(tb?.kind === 'table' && [tb.table.cols, tb.table.head]).toEqual([[100, 120], 1]);
    expect(objs.find((o) => o.kind === 'picture')).toMatchObject({ w: 72, h: 36, src: PNG });
    const last = doc.paras[doc.paras.length - 1];
    expect(last).toMatchObject({ align: 'center', pageBreak: true });
    expect(doc.page.w).toBeCloseTo(595.28, 1);
    expect(doc.styles.Normal.font).toBe(sample().styles.Normal.font);
  });

  it('opens a LibreOffice document', () => {
    const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0">
<office:font-face-decls><style:font-face style:name="Liberation Serif" svg:font-family="'Liberation Serif'"/></office:font-face-decls>
<office:automatic-styles><style:style style:name="P1" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="justify" fo:margin-bottom="0.247cm" fo:line-height="150%"/></style:style><style:style style:name="T1" style:family="text"><style:text-properties fo:font-style="italic"/></style:style><style:style style:name="T2" style:family="text"><style:text-properties style:text-position="super 58%"/></style:style></office:automatic-styles>
<office:body><office:text><text:sequence-decls/><text:h text:style-name="Heading_20_2" text:outline-level="2">Methods</text:h><text:p text:style-name="P1">The <text:span text:style-name="T1">ee</text:span> was 98%<text:span text:style-name="T2">a</text:span>,<text:s text:c="2"/>see<text:tab/>SI.</text:p><text:list text:style-name="L1"><text:list-item><text:p>one</text:p></text:list-item></text:list></office:text></office:body></office:document-content>`;
    const styles = `<?xml version="1.0" encoding="UTF-8"?><office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"><office:styles><style:style style:name="Standard" style:family="paragraph"><style:text-properties style:font-name="Liberation Serif" fo:font-size="12pt"/></style:style><text:list-style style:name="L1"><text:list-level-style-number text:level="1" style:num-format="1"/></text:list-style></office:styles><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21.001cm" fo:page-height="29.7cm" fo:margin-left="2cm" fo:margin-right="2cm" fo:margin-top="2cm" fo:margin-bottom="2cm"/></style:page-layout></office:automatic-styles></office:document-styles>`;
    const bytes = zipFiles([['mimetype', strToU8('application/vnd.oasis.opendocument.text'), false], ['content.xml', strToU8(content), true], ['styles.xml', strToU8(styles), true]]);
    expect(isOdt(bytes)).toBe(true);
    const { doc } = readOdt(bytes);
    expect(rt.plainText(doc.runs)).toBe('Methods\nThe ee was 98%a,  see\tSI.\none');
    expect(doc.paras[0].style).toBe('Heading2');
    expect(doc.paras[1]).toMatchObject({ align: 'justify', line: 1.5, spaceAfter: 7 });
    expect(doc.paras[2].list).toBe('number');
    expect(doc.runs.find((r) => r.text === 'ee')).toMatchObject({ italic: true, font: 'Liberation Serif', size: 12 });
    expect(doc.runs.find((r) => r.text === 'a')?.sup).toBe(true);
    expect(doc.page.left).toBeCloseTo(56.69, 1);
  });
});
