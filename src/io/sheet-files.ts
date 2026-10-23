// Sheet files: Excel workbooks (.xlsx, and .xlsm with their macros kept), CSV text, and SD files
// of structures with their data. Old Excel (.xls) and OpenDocument (.ods) spreadsheets open too,
// and save as .xlsx.
// CSV and SD files hold only values, so they keep one sheet (the one showing) as it looks:
// numbers as they are shown, structures as SMILES (CSV) or molfiles (SD).

import { Doc, Contents } from '../model';
import type { DocStyle } from '../style';
import { addMolfile } from '../chem/molfile';
import { Workbook, Sheet } from '../sheet/workbook';
import { keyOf } from '../sheet/refs';
import { isError, CellError } from '../sheet/values';
import { parseDelimited, toDelimited } from '../sheet/csv';
import { structureMolfile } from '../sheet/structure-doc';
import { writeXlsx, readXlsx, XlsxPictures } from './xlsx';
import { readXls, isXls } from './xls';
import { readOds, isOds } from './ods';

export interface SheetFileDeps extends XlsxPictures {
  /** Waits until every structure's properties (and SMILES) are worked out. */
  settled(): Promise<void>;
}

/** The start of a zip file (PK, then 3 and 4): two letters alone could be the head of a CSV column. */
const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;
const extOf = (name: string) => (/\.([^.\\/]+)$/.exec(name)?.[1] ?? '').toLowerCase();
const baseOf = (name: string) => name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');

/** Open a sheet file. */
export async function readSheetFile(bytes: Uint8Array, name: string, deps: SheetFileDeps): Promise<{ book: Workbook; warnings: string[] }> {
  const ext = extOf(name);
  if (ext === 'ods' || isOds(bytes)) return readOds(bytes);
  if (ext === 'xlsx' || ext === 'xlsm' || (isZip(bytes) && !['csv', 'tsv', 'txt', 'sdf', 'sd'].includes(ext))) return withMacroNote(await readXlsx(bytes, deps), ext);
  if (ext === 'xls' || isXls(bytes)) return readXls(bytes);
  const text = decodeText(bytes);
  if (ext === 'sdf' || ext === 'sd') return readSdf(text, baseOf(name));
  return { book: bookFromText(text, baseOf(name), ext === 'tsv' ? '\t' : 'auto'), warnings: [] };
}

/** Save a workbook in the format its name ends with. */
export async function writeSheetFile(book: Workbook, name: string, deps: SheetFileDeps): Promise<Uint8Array | string> {
  const ext = extOf(name);
  // structures' SMILES (and property columns) must be worked out before saving
  book.recalc();
  await deps.settled();
  book.recalc();
  if (ext === 'csv') return '﻿' + csvText(book.sheet);
  if (ext === 'sdf' || ext === 'sd') return sdfText(book.sheet, book.drawingStyle);
  return writeXlsx(book, deps, { macros: ext === 'xlsm' });
}

/** Says that a workbook's macros are kept but never run (and lost when it is saved as .xlsx). */
function withMacroNote(got: { book: Workbook; warnings: string[] }, ext: string): { book: Workbook; warnings: string[] } {
  if (got.book.macros) {
    got.warnings.unshift(ext === 'xlsm'
      ? 'This workbook has macros (VBA). They are kept as they are and saved back into the .xlsm file, but never run here.'
      : 'This workbook has macros (VBA), which are never run here. Save it as .xlsm to keep them.');
  }
  return got;
}

/** UTF-8 (with or without a byte-order mark), else Windows' Western European code page, as Excel writes CSV. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

// ---------------------------------------------------------------- CSV

/** A table of text as a workbook of one sheet; numbers, percentages and formulas are read as Excel reads them. */
export function bookFromText(text: string, sheetName: string, sep: ',' | '\t' | 'auto' = 'auto'): Workbook {
  const rows = parseDelimited(text, sep);
  const wb = new Workbook([safeSheetName(sheetName)]);
  const s = wb.sheets[0];
  wb.build(() => {
    rows.forEach((row, r) => row.forEach((field, c) => { if (field !== '') s.setInput(r, c, field); }));
  });
  return wb;
}

/** A sheet as CSV: each cell as it shows (structures as SMILES). */
export function csvText(s: Sheet): string {
  return toDelimited(sheetRows(s), ',');
}

/** The used part of a sheet as rows of text. */
export function sheetRows(s: Sheet): string[][] {
  const rows: string[][] = [];
  const r2 = Math.max(s.lastRow, s.lastDataRow), c2 = s.lastCol;
  for (let r = 0; r <= r2; r++) {
    const line: string[] = [];
    for (let c = 0; c <= c2; c++) line.push(cellText(s, r, c));
    rows.push(line);
  }
  return rows;
}

function cellText(s: Sheet, r: number, c: number): string {
  const v = s.values.get(keyOf(r, c));
  if (s.cell(r, c)?.structure) return typeof v === 'string' ? v : '';
  if (v === undefined || v === null) return '';
  if (isError(v)) return (v as CellError).code === '#BUSY!' ? '' : (v as CellError).code;
  return s.shownText(r, c);
}

/** Excel's rules for sheet names: at most 31 characters, none of \ / ? * [ ] : */
export function safeSheetName(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || 'Sheet1';
}

// ---------------------------------------------------------------- SD files

/** The records of an SD file: each molfile with its data items. */
export function parseSdf(text: string): { molblock: string; title: string; data: [string, string][] }[] {
  const out: { molblock: string; title: string; data: [string, string][] }[] = [];
  // (the line break after each $$$$ goes with it, so a first record with an empty title line keeps that line)
  for (const rec of text.replace(/\r\n?/g, '\n').split(/^\$\$\$\$[^\n]*(?:\n|$)/m)) {
    if (!rec.trim()) continue;
    const lines = rec.split('\n');
    const end = lines.findIndex((l) => l.startsWith('M  END'));
    if (end < 0) continue;
    const molblock = lines.slice(0, end + 1).join('\n');
    const data: [string, string][] = [];
    for (let i = end + 1; i < lines.length; i++) {
      const m = /^>.*?<([^>]+)>/.exec(lines[i]);
      if (!m) continue;
      const value: string[] = [];
      for (i++; i < lines.length && lines[i].trim() !== ''; i++) value.push(lines[i]);
      data.push([m[1].trim(), value.join('\n')]);
    }
    out.push({ molblock, title: lines[0].trim(), data });
  }
  return out;
}

/** An SD file as a sheet: a structure column, the names (titles) if any, then a column for each data item. */
export function readSdf(text: string, sheetName: string, style?: DocStyle): { book: Workbook; warnings: string[] } {
  const recs = parseSdf(text);
  const wb = new Workbook([safeSheetName(sheetName)]);
  const st = style ?? wb.drawingStyle;
  const s = wb.sheets[0];
  const fields: string[] = [];
  for (const r of recs) for (const [k] of r.data) if (!fields.includes(k)) fields.push(k);
  const named = recs.some((r) => r.title);
  let failed = 0;
  wb.build(() => {
    const head = ['Structure', ...(named ? ['Name'] : []), ...fields];
    head.forEach((h, c) => { s.setInput(0, c, h); });
    s.patchStyle({ r1: 0, c1: 0, r2: 0, c2: head.length - 1 }, { bold: true, borders: { bottom: { style: 'thin' } } });
    s.setColWidth(0, 160);
    recs.forEach((rec, i) => {
      const r = i + 1;
      const contents = molblockContents(rec.molblock, st);
      if (contents) { if (contents.atoms.length) s.setStructure(r, 0, contents); }
      else failed++;
      let c = 1;
      if (named) { if (rec.title) s.setInput(r, c, rec.title); c++; }
      const byName = new Map(rec.data);
      for (const f of fields) {
        const v = byName.get(f);
        if (v !== undefined && v !== '') s.setInput(r, c, v.includes('\n') ? v : v.trim());
        c++;
      }
    });
    s.setFrozen(1, 0);
  });
  const warnings = failed ? [`${failed} structure${failed > 1 ? 's' : ''} could not be read (only V2000 molfiles are read so far).`] : [];
  return { book: wb, warnings };
}

/** A molfile drawn in a style (null when it can't be read). */
export function molblockContents(molblock: string, style: DocStyle): Contents | null {
  const d = new Doc();
  d.style = { ...style };
  try {
    d.bulk(() => { addMolfile(d, molblock, 0, 0); });
  } catch {
    return null;
  }
  return d.contents();
}

/** The structure column of a sheet: the one with the most structures. */
function structureColumn(s: Sheet): number {
  const count = new Map<number, number>();
  for (const [k, c] of s.cells) if (c.structure) count.set(k % 16384, (count.get(k % 16384) ?? 0) + 1);
  let best = -1, n = 0;
  for (const [c, m] of count) if (m > n) { best = c; n = m; }
  return best;
}

/** A sheet as an SD file: a record for each row with a structure, the other columns as data items named by their headers. */
export function sdfText(s: Sheet, style: DocStyle): string {
  const col = structureColumn(s);
  if (col < 0) throw new Error('There are no structures in this sheet to save as an SD file.');
  // the header row: the first row with text and no structure in the structure column
  let first = 0;
  while (first <= s.lastRow && !s.cell(first, col)?.structure) first++;
  const headRow = first - 1;
  const names: [number, string][] = [];
  for (let c = 0; c <= s.lastCol; c++) {
    if (c === col) continue;
    const h = headRow >= 0 ? s.shownText(headRow, c).trim() : '';
    names.push([c, h || `Column ${c + 1}`]);
  }
  const titleCol = names.find(([, h]) => /^(name|compound|title)$/i.test(h))?.[0];
  const out: string[] = [];
  const last = Math.max(s.lastRow, s.lastDataRow);
  for (let r = first; r <= last; r++) {
    const st = s.cell(r, col)?.structure;
    const data = names.map(([c, h]) => [h, cellText(s, r, c)] as const).filter(([, v]) => v !== '');
    if (!st && !data.length) continue;
    let mb = st ? structureMolfile(st.contents, style).molblock : null;
    if (!mb) mb = '\n  Chem Illustrator\n\n  0  0  0  0  0  0  0  0  0  0999 V2000\nM  END';
    const lines = mb.replace(/\r\n?/g, '\n').split('\n');
    lines[0] = titleCol !== undefined ? cellText(s, r, titleCol).replace(/\n/g, ' ').slice(0, 80) : '';
    out.push(lines.join('\n'));
    for (const [h, v] of data) {
      if (titleCol !== undefined && h === names.find(([c]) => c === titleCol)![1]) continue;
      out.push(`> <${h.replace(/[<>]/g, '')}>`, v.replace(/\n\s*\n/g, '\n'), '');
    }
    out.push('$$$$');
  }
  return out.join('\n') + '\n';
}
