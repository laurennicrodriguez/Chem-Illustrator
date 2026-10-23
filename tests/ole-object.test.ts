// @vitest-environment jsdom
//
// Embedded objects (Insert > Object): compound files written from Microsoft's published
// description read back stream for stream; a file wrapped in an OLE package comes out whole;
// Office files go in as Word keeps them (a part of their own); and an object survives a Word
// file being saved here and opened again, part, program and picture.
import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { cfbClass, cfbStreams, isCfb, writeCfb } from '../src/io/cfb';
import { embedFile, embeddedPart, fileInside, fromEmbedSource, objectKind, packageObject, progIdOf, readEmbedded, withFile, OLE_REL, PACKAGE_REL } from '../src/io/ole-object';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { newDocument, objectRun, runStyleOf, type DocText, type Embedded } from '../src/document/document';
import { cellsPicture, iconPicture, objectPicture, showsContents } from '../src/render/object-picture';
import { fromDataUrl } from '../src/render/images';
import { Workbook } from '../src/sheet/workbook';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1]);
const DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const deps: DocxDeps = {
  async picture() { return { png: PNG, w: 80, h: 40 }; },
  async svgToPng() { return PNG; },
};
const bytes = (n: number, k = 7) => Uint8Array.from({ length: n }, (_, i) => (i * k + 3) & 255);
const XLSX = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'xl/workbook.xml': strToU8('<workbook/>') });

describe('compound files written here', () => {
  it('read back stream for stream, small and large, with the class id', () => {
    const streams: [string, Uint8Array][] = [['\u0001Ole', bytes(20)], ['CONTENTS', bytes(5000)], ['Tiny', bytes(1)], ['Empty', new Uint8Array(0)], ['Exactly4096', bytes(4096, 3)], ['Small4095', bytes(4095, 5)]];
    const file = writeCfb(streams, '{00020830-0000-0000-C000-000000000046}');
    expect(isCfb(file)).toBe(true);
    const back = cfbStreams(file);
    for (const [name, data] of streams) expect(back.get(name)).toEqual(data);
    expect(cfbClass(file)).toBe('{00020830-0000-0000-C000-000000000046}');
  });

  it('hold files too big for the header\'s list of FAT sectors', () => {
    const big = bytes(8 * 1024 * 1024, 13);
    const back = cfbStreams(writeCfb([['Big', big], ['small', bytes(10)]]));
    const got = back.get('Big')!;
    expect(got.length).toBe(big.length);
    expect(got.every((v, i) => v === big[i])).toBe(true);
    expect(back.get('small')).toEqual(bytes(10));
  });
});

describe('OLE packages', () => {
  it('wrap any file so it comes out whole with its name', () => {
    const pdf = new Uint8Array([...strToU8('%PDF-1.7\n'), ...bytes(9000)]);
    const pkg = packageObject('Spectrum 1H.pdf', pdf);
    expect(cfbClass(pkg)).toBe('{0003000C-0000-0000-C000-000000000046}');
    expect(progIdOf(pkg)).toBe('Package');
    const e = embedFile('Spectrum 1H.pdf', pdf);
    expect(e).toMatchObject({ prog: 'Package', part: 'ole', ext: 'bin', name: 'Spectrum 1H.pdf' });
    expect(fileInside(e)).toEqual({ name: 'Spectrum 1H.pdf', bytes: pdf });
    expect(objectKind(e)).toBe('PDF file');
    // saved in its program: the package is made again round the new file
    const changed = withFile(e, { name: 'Spectrum 1H.pdf', bytes: bytes(50) })!;
    expect(fileInside(changed)?.bytes).toEqual(bytes(50));
    expect(embeddedPart(changed).rel).toBe(OLE_REL);
  });
});

describe('Office files as objects', () => {
  it('go in as Word keeps them: a part of their own named by their program', () => {
    const e = embedFile('Yields.xlsx', XLSX);
    expect(e).toMatchObject({ prog: 'Excel.Sheet.12', part: 'package', ext: 'xlsx' });
    const part = embeddedPart(e);
    expect(part).toMatchObject({ rel: PACKAGE_REL, base: 'Microsoft_Excel_Worksheet', ext: 'xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(part.bytes).toEqual(XLSX);
    expect(fileInside(e)).toEqual({ name: 'Yields.xlsx', bytes: XLSX });
    expect(objectKind(e)).toBe('Excel worksheet');
  });

  it('copied from Excel (its "Package" stream) become Word\'s own part', () => {
    const src = writeCfb([['Package', XLSX], ['\u0001CompObj', new Uint8Array(0)]], '{00020830-0000-0000-C000-000000000046}');
    expect(fromEmbedSource(src)).toMatchObject({ prog: 'Excel.Sheet.12', part: 'package', ext: 'xlsx' });
    // another program's object stays as it is
    const other = writeCfb([['CONTENTS', bytes(100)]], '{00020906-0000-0000-C000-000000000046}');
    expect(fromEmbedSource(other)).toMatchObject({ prog: 'Word.Document.8', part: 'ole', ext: 'bin' });
  });

  it('older Office objects open as their program\'s own file', () => {
    const doc = writeCfb([['WordDocument', bytes(600)]]);
    const e = readEmbedded('Word.Document.8', doc, 'embeddings/oleObject1.bin', OLE_REL, false);
    expect(fileInside(e)?.name).toMatch(/\.doc$/);
    expect(fileInside(e)?.bytes).toEqual(doc);
  });
});

describe('objects in Word files', () => {
  const docWith = (embed: Embedded): DocText => {
    const d = newDocument();
    const n = runStyleOf(d.styles.Normal);
    d.objects = { 1: { kind: 'picture', src: DOT, w: 120, h: 60, px: { w: 1, h: 1 }, embed } };
    d.runs = [{ ...n, text: 'Data: ' }, objectRun(1, n), { ...n, text: '\n' }];
    d.paras = [d.paras[0], d.paras[0]];
    return d;
  };

  it('are written as Word writes them and come back whole', async () => {
    const pdf = new Uint8Array([...strToU8('%PDF-1.4\n'), ...bytes(300)]);
    for (const embed of [embedFile('Yields.xlsx', XLSX), embedFile('Spectrum.pdf', pdf, true)]) {
      const file = await writeDocx(docWith(embed), deps);
      const z = unzipSync(file);
      const main = strFromU8(z['word/document.xml']);
      expect(main).toContain(`ProgID="${embed.prog}"`);
      expect(main).toContain(`DrawAspect="${embed.icon ? 'Icon' : 'Content'}"`);
      expect(main).toContain('<v:imagedata r:id=');
      const part = Object.keys(z).find((k) => k.startsWith('word/embeddings/'))!;
      expect(z[part]).toEqual(fromDataUrl(embed.data).bytes);
      const rels = strFromU8(z['word/_rels/document.xml.rels']);
      expect(rels).toContain(embed.part === 'package' ? PACKAGE_REL : OLE_REL);
      const types = strFromU8(z['[Content_Types].xml']);
      expect(types).toContain(`PartName="/${part}"`);
      const { doc, warnings } = await readDocx(file);
      expect(warnings.join(' ')).not.toMatch(/came in as pictures/);
      const o = Object.values(doc.objects).find((x) => x.kind === 'picture');
      expect(o).toMatchObject({ kind: 'picture', w: 120, h: 60, embed: { prog: embed.prog, part: embed.part, ext: embed.ext, ...(embed.icon ? { icon: true } : {}) } });
      expect(o?.kind === 'picture' && fromDataUrl(o.embed!.data).bytes).toEqual(fromDataUrl(embed.data).bytes);
      // and again: saved here a second time, the part is the same
      const again = unzipSync(await writeDocx(doc, deps));
      expect(again[part]).toEqual(z[part]);
    }
  });
});

describe('the picture an object shows', () => {
  it('is the cells in use for a workbook, gridlines and all', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('fill', () => {
      s.setInput(0, 0, 'Entry'); s.setInput(0, 1, 'Yield');
      s.setInput(1, 0, '1'); s.setInput(1, 1, '0.95');
    });
    const pic = cellsPicture(wb)!;
    expect(pic.w).toBeCloseTo(2 * 64 * 0.75);
    expect(pic.h).toBeCloseTo(2 * 20 * 0.75);
    const svg = strFromU8(fromDataUrl(pic.src).bytes);
    expect(svg).toContain('>Yield</text>');
    expect(svg).toMatch(/text-anchor="end"[^>]*>0.95</);
    expect(cellsPicture(new Workbook())).toBeNull();
  });

  it('is an icon with the name for files it can\'t show, or when asked', async () => {
    expect(showsContents('a.xlsx')).toBe(true);
    expect(showsContents('a.pdf')).toBe(true);
    expect(showsContents('a.png')).toBe(true);
    expect(showsContents('notes.docx')).toBe(false);
    const icon = iconPicture('Lab notes.docx');
    expect(strFromU8(fromDataUrl(icon.src).bytes)).toContain('Lab notes.docx');
    const got = await objectPicture('Lab notes.docx', bytes(10), false);
    expect(got.src).toBe(icon.src);
    const asked = await objectPicture('a.png', PNG, true);
    expect(asked.src).toBe(iconPicture('a.png').src);
    const shown = await objectPicture('a.png', PNG, false);
    expect(shown).toMatchObject({ w: 1.5, h: 0.75, px: { w: 2, h: 1 } });
  });
});
