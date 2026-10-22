// @vitest-environment jsdom
//
// Tables on slides saved as PowerPoint tables: the cells, joined cells, rules, title and
// footnotes come back as they were; text changed in PowerPoint is kept; and tables made in
// PowerPoint come in as tables.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { Doc, type TableData, type TextRun } from '../src/model';
import { defaultMaster } from '../src/deck/deck';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { layoutTable } from '../src/table';
import { arialWidth } from '../src/text-metrics';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };
const measure = (t: string, s: number, _f: string, st: string) => arialWidth(t, s, /bold/.test(st));
const R = (text: string): { runs: TextRun[] } => ({ runs: text ? [{ text }] : [] });

function sample(): TableData {
  return {
    cols: [40, 80, 60, 60],
    rows: [
      [R('entry'), { runs: [{ text: 'conditions' }], span: 2 }, R(''), R('yield (%)')],
      [R(''), R('catalyst'), R('solvent'), R('')],
      [R('1'), { runs: [{ text: 'Pd(OAc)' }, { text: '2', sub: true }] }, R('THF'), R('45')],
      [R('2'), R('none'), R('DMF'), { runs: [{ text: 'NR' }, { text: 'b', sup: true, italic: true }] }],
    ],
    head: 2,
    lines: 'acs',
    size: 14,
    title: [{ text: 'Table 1. ', bold: true }, { text: 'Optimization' }],
    notes: [{ text: 'b', sup: true, italic: true }, { text: 'No reaction.' }],
  };
}

async function save(t: TableData): Promise<Uint8Array> {
  const doc = new Doc();
  doc.style = { ...defaultMaster().drawing } as Doc['style'];
  const lay = layoutTable(t, doc.style.captionSize, measure);
  doc.edit('table', () => { doc.addShape({ kind: 'table', x1: 100, y1: 120, x2: 100 + lay.width, y2: 120 + lay.height, table: t }); });
  return writePptx({ size: { w: 960, h: 540 }, master: defaultMaster(), slides: [{ layout: 'blank', doc, notes: '' }] }, opts);
}

const slideXml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['ppt/slides/slide1.xml']);
const withSlide = (bytes: Uint8Array, xml: string) => {
  const files = unzipSync(bytes);
  // (a copy, so the zip library knows it for bytes: jsdom's text encoder makes them in another realm)
  files['ppt/slides/slide1.xml'] = new Uint8Array(strToU8(xml));
  return zipSync(files);
};
const tableOf = (bytes: Uint8Array) => {
  const back = readPptx(bytes);
  const shapes = back.slides[0].contents.shapes.filter((s) => s.kind === 'table');
  expect(shapes).toHaveLength(1);
  return { shape: shapes[0], table: shapes[0].table!, back };
};
const text = (t: TableData) => t.rows.map((row) => row.map((c) => c.runs.map((r) => r.text).join('')));

describe('tables in PowerPoint files', () => {
  it('writes a PowerPoint table: a column for each column, a cell for each place, and joined cells merged', async () => {
    const xml = slideXml(await save(sample()));
    const dom = new DOMParser().parseFromString(xml, 'application/xml');
    expect(dom.querySelector('parsererror')).toBeNull();
    const tbl = dom.getElementsByTagName('a:tbl')[0];
    expect(tbl.getElementsByTagName('a:gridCol')).toHaveLength(4);
    const rows = [...tbl.getElementsByTagName('a:tr')];
    expect(rows).toHaveLength(4);
    for (const tr of rows) expect([...tr.children].filter((e) => e.localName === 'tc')).toHaveLength(4);
    const first = [...rows[0].children];
    expect(first[1].getAttribute('gridSpan')).toBe('2');
    expect(first[2].getAttribute('hMerge')).toBe('1');
    // ACS rules: a line over the first row, none down the sides
    const tcPr = first[0].getElementsByTagName('a:tcPr')[0];
    expect(tcPr.getElementsByTagName('a:lnT')[0].getElementsByTagName('a:solidFill')).toHaveLength(1);
    expect(tcPr.getElementsByTagName('a:lnL')[0].getElementsByTagName('a:noFill')).toHaveLength(1);
    // the title and footnotes are text boxes
    expect(xml).toContain('Optimization');
    expect(xml).toContain('No reaction.');
  });

  it('comes back as it was saved', async () => {
    const t = sample();
    const { shape, table, back } = tableOf(await save(t));
    expect(back.warnings).toEqual([]);
    expect(table).toEqual(t);
    expect(shape.x1).toBeCloseTo(100, 1);
    expect(shape.y1).toBeCloseTo(120, 1);
    // the title and footnotes are part of the table again, not loose text
    expect(back.slides[0].contents.captions).toHaveLength(0);
  });

  it('keeps text changed in PowerPoint, with the table\'s headings and rules', async () => {
    const bytes = await save(sample());
    const { table } = tableOf(withSlide(bytes, slideXml(bytes).replace('>THF<', '>MeCN<').replace('>Optimization<', '>Screening<')));
    expect(text(table)[2]).toEqual(['1', 'Pd(OAc)2', 'MeCN', '45']);
    expect(table.rows[2][1].runs[1]).toMatchObject({ text: '2', sub: true });
    expect(table.head).toBe(2);
    expect(table.lines).toBe('acs');
    expect(table.rows[0][1].span).toBe(2);
    expect(table.title!.map((r) => r.text).join('')).toBe('Table 1. Screening');
  });

  it('keeps column widths changed in PowerPoint', async () => {
    const bytes = await save(sample());
    const xml = slideXml(bytes).replace(/<a:gridCol w="\d+"\/>/, '<a:gridCol w="914400"/>');
    expect(tableOf(withSlide(bytes, xml)).table.cols).toEqual([72, 80, 60, 60]);
  });

  it('a deleted table leaves its title as text; a deleted title is gone', async () => {
    const bytes = await save(sample());
    const noTable = slideXml(bytes).replace(/<p:graphicFrame>.*<\/p:graphicFrame>/s, '');
    const back = readPptx(withSlide(bytes, noTable));
    expect(back.slides[0].contents.shapes).toHaveLength(0);
    expect(back.slides[0].contents.captions.map((c) => c.runs.map((r) => r.text).join(''))).toEqual(['Table 1. Optimization', 'bNo reaction.']);
    const noTitle = slideXml(bytes).replace(/<p:sp>.*?Optimization.*?<\/p:sp>/s, '');
    expect(tableOf(withSlide(bytes, noTitle)).table.title).toBeUndefined();
  });

  it('reads a table made in PowerPoint', async () => {
    const bytes = await save(sample());
    const cell = (t: string, extra = '') => `<a:tc${extra}><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${t}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`;
    const frame = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="Table 8"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
      `<p:xfrm><a:off x="1270000" y="1270000"/><a:ext cx="3657600" cy="741680"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">` +
      `<a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId></a:tblPr><a:tblGrid><a:gridCol w="1219200"/><a:gridCol w="1219200"/><a:gridCol w="1219200"/></a:tblGrid>` +
      `<a:tr h="370840">${cell('Substrate')}${cell('Yield', ' gridSpan="2"')}${cell('', ' hMerge="1"')}</a:tr>` +
      `<a:tr h="370840">${cell('1a')}${cell('82')}${cell('91')}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const xml = slideXml(bytes).replace(/<p:graphicFrame>.*<\/p:graphicFrame>/s, frame).replace(/<p:sp>.*?<\/p:sp>/gs, '');
    const { table, back } = tableOf(withSlide(bytes, xml));
    expect(text(table)).toEqual([['Substrate', 'Yield', ''], ['1a', '82', '91']]);
    expect(table.cols).toEqual([96, 96, 96]);
    expect(table.rows[0][1].span).toBe(2);
    expect(table.size).toBe(18);
    expect(table.head).toBe(1);
    expect(table.style).toBe('pp-medium2-1');
    expect(table.look).toMatchObject({ bandRows: true, total: false, firstCol: false });
    expect(back.warnings).toEqual([]);
  });

  it('keeps a table style, cell colours and cells merged down', async () => {
    const t: TableData = {
      cols: [60, 60, 60],
      rows: [
        [R('a'), R('b'), R('c')],
        [{ runs: [{ text: 'tall' }], rowSpan: 2 }, { runs: [{ text: 'x' }], fill: '#ff0000' }, R('y')],
        [R(''), R('z'), R('w')],
      ],
      head: 1, lines: 'acs', style: 'pp-medium2-2', look: { bandRows: true, firstCol: true },
    };
    const bytes = await save(t);
    const xml = slideXml(bytes);
    const dom = new DOMParser().parseFromString(xml, 'application/xml');
    const rows = [...dom.getElementsByTagName('a:tr')].map((tr) => [...tr.children].filter((e) => e.localName === 'tc'));
    expect(rows[1][0].getAttribute('rowSpan')).toBe('2');
    expect(rows[2][0].getAttribute('vMerge')).toBe('1');
    expect(xml).toContain('{21E4AEA4-8DFA-4A89-87EB-49C32662AFE8}');
    expect(dom.getElementsByTagName('a:tblPr')[0].getAttribute('firstCol')).toBe('1');
    // the style's colours are written on the cells, so PowerPoint shows them whatever it knows
    expect(rows[0][0].getElementsByTagName('a:tcPr')[0].innerHTML).toContain('ED7D31');
    expect(rows[1][1].getElementsByTagName('a:tcPr')[0].innerHTML).toContain('FF0000');
    expect(tableOf(bytes).table).toEqual(t);
    // changed in PowerPoint: the style stays, and the written-out colours don't stick to the cells
    const { table } = tableOf(withSlide(bytes, xml.replace('>y<', '>v<')));
    expect(table.style).toBe('pp-medium2-2');
    expect(table.rows[1][0].rowSpan).toBe(2);
    expect(table.rows[1][1].fill?.toLowerCase()).toBe('#ff0000');
    expect(table.rows[1][2].fill).toBeUndefined();
    expect(table.rows[0][0].runs[0].color).toBeUndefined();
    expect(table.rows[0][0].runs[0].bold).toBeUndefined();
  });

  it('writes the colours of a PowerPoint style from the file onto a table made in PowerPoint', async () => {
    const bytes = await save(sample());
    const cell = (t: string, extra = '') => `<a:tc${extra}><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${t}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`;
    const id = '{9D7B26C5-4107-4FEC-AEDC-1716B250EE53}';
    const frame = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="Table 8"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
      `<p:xfrm><a:off x="1270000" y="1270000"/><a:ext cx="2438400" cy="741680"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">` +
      `<a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>${id}</a:tableStyleId></a:tblPr><a:tblGrid><a:gridCol w="1219200"/><a:gridCol w="1219200"/></a:tblGrid>` +
      `<a:tr h="370840">${cell('A')}${cell('B')}</a:tr><a:tr h="370840">${cell('1', ' rowSpan="2"')}${cell('2')}</a:tr><a:tr h="370840">${cell('', ' vMerge="1"')}${cell('3')}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const xml = slideXml(bytes).replace(/<p:graphicFrame>.*<\/p:graphicFrame>/s, frame).replace(/<p:sp>.*?<\/p:sp>/gs, '');
    const files = unzipSync(withSlide(bytes, xml));
    files['ppt/tableStyles.xml'] = new Uint8Array(strToU8(`<?xml version="1.0"?><a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="${id}"><a:tblStyle styleId="${id}" styleName="Mine">` +
      `<a:wholeTbl><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:srgbClr val="EEEEEE"/></a:solidFill></a:fill></a:tcStyle></a:wholeTbl>` +
      `<a:band1H><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:srgbClr val="CCCCCC"/></a:solidFill></a:fill></a:tcStyle></a:band1H>` +
      `<a:firstRow><a:tcTxStyle b="on"><a:srgbClr val="FFFFFF"/></a:tcTxStyle><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:fill></a:tcStyle></a:firstRow>` +
      `</a:tblStyle></a:tblStyleLst>`));
    const { table, back } = tableOf(zipSync(files));
    expect(back.warnings).toEqual([]);
    expect(table.rows[0][0].fill).toBe('#112233');
    expect(table.rows[0][0].runs[0]).toMatchObject({ text: 'A', bold: true, color: '#ffffff' });
    expect(table.rows[1][1].fill).toBe('#cccccc');
    expect(table.rows[2][1].fill).toBe('#eeeeee');
    expect(table.rows[1][0].rowSpan).toBe(2);
    expect(table.lines).toBe('none');
  });
});
