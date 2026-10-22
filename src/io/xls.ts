// Old Excel workbooks (.xls, Excel 97 to 2003): the BIFF8 records of the "Workbook" stream in
// an OLE compound file, as Microsoft publishes them in [MS-XLS]. Cells, their values and
// formulas, number formats, bold and italic, alignment, merged cells, column widths and row
// heights are read; charts, pictures, macros and the rest are not. Excel 5 and 95 files (BIFF5)
// open with their values only. Files are only read: saving writes .xlsx.

import { cfbStreams, isCfb } from './cfb';
import { Workbook, CellStyle } from '../sheet/workbook';
import { colName, quoteSheet, Range } from '../sheet/refs';
import { normalizeFormula } from '../sheet/formula';
import type { DefinedName } from '../sheet/names';
import { BUILTIN_FORMATS, pxFromWidth, textInput } from './xlsx';
import { safeSheetName } from './sheet-files';

/** Is this an old Excel workbook (a compound file with a workbook stream)? */
export function isXls(bytes: Uint8Array): boolean {
  if (!isCfb(bytes)) return false;
  try {
    const s = cfbStreams(bytes);
    return s.has('Workbook') || s.has('Book');
  } catch {
    return false;
  }
}

interface Rec { id: number; data: Uint8Array; /** where CONTINUE records were joined on (for the shared strings) */ breaks: number[] }

const R = {
  BOF: 0x0809, EOF: 0x000a, CONTINUE: 0x003c, FILEPASS: 0x002f, CODEPAGE: 0x0042, DATEMODE: 0x0022,
  BOUNDSHEET: 0x0085, SST: 0x00fc, FORMAT: 0x041e, FORMAT_OLD: 0x001e, FONT: 0x0031, XF: 0x00e0, NAME: 0x0018, EXTERNSHEET: 0x0017,
  LABELSST: 0x00fd, LABEL: 0x0204, RSTRING: 0x00d6, NUMBER: 0x0203, RK: 0x027e, MULRK: 0x00bd, BOOLERR: 0x0205,
  FORMULA: 0x0006, STRING: 0x0207, SHRFMLA: 0x04bc, ARRAY: 0x0221, MERGECELLS: 0x00e5, COLINFO: 0x007d, ROW: 0x0208,
} as const;

/** The records from `at` to the end of their substream (its EOF), CONTINUE records joined to the one before. */
function records(b: Uint8Array, at: number): Rec[] {
  const out: Rec[] = [];
  while (at + 4 <= b.length) {
    const id = b[at] | (b[at + 1] << 8), len = b[at + 2] | (b[at + 3] << 8);
    const data = b.subarray(at + 4, Math.min(b.length, at + 4 + len));
    at += 4 + len;
    const last = out[out.length - 1];
    if (id === R.CONTINUE && last) {
      const joined = new Uint8Array(last.data.length + data.length);
      joined.set(last.data);
      joined.set(data, last.data.length);
      last.breaks.push(last.data.length);
      last.data = joined;
      continue;
    }
    out.push({ id, data, breaks: [] });
    if (id === R.EOF) break;
  }
  return out;
}

const u16 = (d: Uint8Array, at: number) => d[at] | (d[at + 1] << 8);
const i16 = (d: Uint8Array, at: number) => (u16(d, at) << 16) >> 16;
const u32 = (d: Uint8Array, at: number) => (d[at] | (d[at + 1] << 8) | (d[at + 2] << 16) | (d[at + 3] << 24)) >>> 0;
const f64 = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset + at, 8).getFloat64(0, true);

/** An RK number: a whole number or the top of a double, maybe divided by 100. */
function rk(v: number): number {
  const n = v & 2 ? (v >> 2) : (() => {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setUint32(4, v & 0xfffffffc, true);
    return dv.getFloat64(0, true);
  })();
  return v & 1 ? n / 100 : n;
}

/** Reads strings out of a record, carrying on across the places CONTINUE records were joined. */
class StringReader {
  constructor(private d: Uint8Array, public at: number, private breaks: number[] = [], private ansi = new TextDecoder('windows-1252')) {}

  /** `cch` characters, 16-bit when `wide`; a CONTINUE part starts again with its own flags byte. */
  chars(cch: number, wide: boolean): string {
    let s = '';
    while (cch > 0) {
      const next = this.breaks.find((b) => b > this.at) ?? this.d.length;
      const fit = Math.min(cch, Math.floor((next - this.at) / (wide ? 2 : 1)));
      if (fit > 0) {
        const part = this.d.subarray(this.at, this.at + fit * (wide ? 2 : 1));
        s += wide ? String.fromCharCode(...u16s(part)) : this.ansi.decode(part);
        this.at += part.length;
        cch -= fit;
      }
      if (cch > 0) {
        if (this.at >= this.d.length) break;
        wide = (this.d[this.at++] & 1) === 1;
      }
    }
    return s;
  }

  /** An XLUnicodeRichExtendedString (the shared strings, BIFF8). */
  rich(): string {
    const cch = u16(this.d, this.at), flags = this.d[this.at + 2];
    this.at += 3;
    let runs = 0, ext = 0;
    if (flags & 8) { runs = u16(this.d, this.at); this.at += 2; }
    if (flags & 4) { ext = u32(this.d, this.at); this.at += 4; }
    const s = this.chars(cch, (flags & 1) === 1);
    this.at += runs * 4 + ext;
    return s;
  }
}

function u16s(b: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < b.length; i += 2) out.push(b[i] | (b[i + 1] << 8));
  return out;
}

/** A string with a 16-bit length (cell text, BIFF8): XLUnicodeString. */
function xlString(d: Uint8Array, at: number, biff8: boolean): string {
  const cch = u16(d, at);
  if (!biff8) return new TextDecoder('windows-1252').decode(d.subarray(at + 2, at + 2 + cch));
  return new StringReader(d, at + 3).chars(cch, (d[at + 2] & 1) === 1);
}

/** A string with an 8-bit length (sheet names, formats in BIFF5): ShortXLUnicodeString. */
function shortString(d: Uint8Array, at: number, biff8: boolean): string {
  const cch = d[at];
  if (!biff8) return new TextDecoder('windows-1252').decode(d.subarray(at + 1, at + 1 + cch));
  return new StringReader(d, at + 2).chars(cch, (d[at + 1] & 1) === 1);
}

const ERRORS: Record<number, string> = { 0x00: '#NULL!', 0x07: '#DIV/0!', 0x0f: '#VALUE!', 0x17: '#REF!', 0x1d: '#NAME?', 0x24: '#NUM!', 0x2a: '#N/A' };

// Excel's built-in functions by number ([MS-XLS] 2.5.198.17), with how many arguments the ones
// that always take the same number have (a fixed-argument call doesn't say).
const FTAB_TEXT = '0:COUNT 1:IF 2:ISNA/1 3:ISERROR/1 4:SUM 5:AVERAGE 6:MIN 7:MAX 8:ROW 9:COLUMN 10:NA/0 11:NPV 12:STDEV 13:DOLLAR 14:FIXED 15:SIN/1 16:COS/1 17:TAN/1 18:ATAN/1 19:PI/0 20:SQRT/1 21:EXP/1 22:LN/1 23:LOG10/1 24:ABS/1 25:INT/1 26:SIGN/1 27:ROUND/2 28:LOOKUP 29:INDEX 30:REPT/2 31:MID/3 32:LEN/1 33:VALUE/1 34:TRUE/0 35:FALSE/0 36:AND 37:OR 38:NOT/1 39:MOD/2 40:DCOUNT/3 41:DSUM/3 42:DAVERAGE/3 43:DMIN/3 44:DMAX/3 45:DSTDEV/3 46:VAR 47:DVAR/3 48:TEXT/2 49:LINEST 50:TREND 51:LOGEST 52:GROWTH 56:PV 57:FV 58:NPER 59:PMT 60:RATE 61:MIRR/3 62:IRR 63:RAND/0 64:MATCH 65:DATE/3 66:TIME/3 67:DAY/1 68:MONTH/1 69:YEAR/1 70:WEEKDAY 71:HOUR/1 72:MINUTE/1 73:SECOND/1 74:NOW/0 75:AREAS/1 76:ROWS/1 77:COLUMNS/1 78:OFFSET 82:SEARCH 83:TRANSPOSE/1 86:TYPE/1 97:ATAN2/2 98:ASIN/1 99:ACOS/1 100:CHOOSE 101:HLOOKUP 102:VLOOKUP 105:ISREF/1 109:LOG 111:CHAR/1 112:LOWER/1 113:UPPER/1 114:PROPER/1 115:LEFT 116:RIGHT 117:EXACT/2 118:TRIM/1 119:REPLACE/4 120:SUBSTITUTE 121:CODE/1 124:FIND 125:CELL 126:ISERR/1 127:ISTEXT/1 128:ISNUMBER/1 129:ISBLANK/1 130:T/1 131:N/1 140:DATEVALUE/1 141:TIMEVALUE/1 142:SLN/3 143:SYD/4 144:DDB 148:INDIRECT 162:CLEAN/1 163:MDETERM/1 164:MINVERSE/1 165:MMULT/2 167:IPMT 168:PPMT 169:COUNTA 183:PRODUCT 184:FACT/1 189:DPRODUCT/3 190:ISNONTEXT/1 193:STDEVP 194:VARP 195:DSTDEVP/3 196:DVARP/3 197:TRUNC 198:ISLOGICAL/1 199:DCOUNTA/3 204:USDOLLAR 205:FINDB 206:SEARCHB 207:REPLACEB/4 208:LEFTB 209:RIGHTB 210:MIDB/3 211:LENB/1 212:ROUNDUP/2 213:ROUNDDOWN/2 214:ASC/1 215:DBCS/1 216:RANK 219:ADDRESS 220:DAYS360 221:TODAY/0 222:VDB 227:MEDIAN 228:SUMPRODUCT 229:SINH/1 230:COSH/1 231:TANH/1 232:ASINH/1 233:ACOSH/1 234:ATANH/1 235:DGET/3 244:INFO/1 247:DB 252:FREQUENCY/2 261:ERROR.TYPE/1 269:AVEDEV 270:BETADIST 271:GAMMALN/1 272:BETAINV 273:BINOMDIST/4 274:CHIDIST/2 275:CHIINV/2 276:COMBIN/2 277:CONFIDENCE/3 278:CRITBINOM/3 279:EVEN/1 280:EXPONDIST/3 281:FDIST/3 282:FINV/3 283:FISHER/1 284:FISHERINV/1 285:FLOOR/2 286:GAMMADIST/4 287:GAMMAINV/3 288:CEILING/2 289:HYPGEOMDIST/4 290:LOGNORMDIST/3 291:LOGINV/3 292:NEGBINOMDIST/3 293:NORMDIST/4 294:NORMSDIST/1 295:NORMINV/3 296:NORMSINV/1 297:STANDARDIZE/3 298:ODD/1 299:PERMUT/2 300:POISSON/3 301:TDIST/3 302:WEIBULL/4 303:SUMXMY2/2 304:SUMX2MY2/2 305:SUMX2PY2/2 306:CHITEST/2 307:CORREL/2 308:COVAR/2 309:FORECAST/3 310:FTEST/2 311:INTERCEPT/2 312:PEARSON/2 313:RSQ/2 314:STEYX/2 315:SLOPE/2 316:TTEST/4 317:PROB 318:DEVSQ 319:GEOMEAN 320:HARMEAN 321:SUMSQ 322:KURT 323:SKEW 324:ZTEST 325:LARGE/2 326:SMALL/2 327:QUARTILE/2 328:PERCENTILE/2 329:PERCENTRANK 330:MODE 331:TRIMMEAN/2 332:TINV/2 336:CONCATENATE 337:POWER/2 342:RADIANS/1 343:DEGREES/1 344:SUBTOTAL 345:SUMIF 346:COUNTIF/2 347:COUNTBLANK/1 350:ISPMT/4 351:DATEDIF/3 352:DATESTRING/1 353:NUMBERSTRING/2 354:ROMAN 358:GETPIVOTDATA 359:HYPERLINK 360:PHONETIC/1 361:AVERAGEA 362:MAXA 363:MINA 364:STDEVPA 365:VARPA 366:STDEVA 367:VARA';
const FTAB = new Map<number, { name: string; args: number }>(FTAB_TEXT.split(' ').map((e) => {
  const [n, rest] = e.split(':');
  const [name, args] = rest.split('/');
  return [Number(n), { name, args: args === undefined ? -1 : Number(args) }];
}));

/** What a formula's references need from the workbook. */
interface FormulaWorld {
  sheetNames: string[];
  /** EXTERNSHEET's entries: the first and last sheet of each (-1 for another workbook). */
  xti: { first: number; last: number }[];
  names: string[];
}

class Unreadable extends Error {}

/**
 * A formula's parsed tokens (Rgce, BIFF8) as text without its =, for the cell at row, col
 * (shared formulas' relative references are counted from it). Throws Unreadable for parts
 * this program doesn't read (array constants, data tables, add-in functions).
 */
export function formulaText(d: Uint8Array, at: number, end: number, row: number, col: number, world: FormulaWorld): string {
  const st: string[] = [];
  const pop = () => { const v = st.pop(); if (v === undefined) throw new Unreadable('stack'); return v; };
  const ref = (rw: number, cl: number, rel: boolean) => {
    const rowRel = (cl & 0x8000) !== 0, colRel = (cl & 0x4000) !== 0;
    let r = rw, c = cl & 0x3fff;
    if (rel) {
      // shared formulas: relative parts are offsets from the cell (rows 16-bit, columns 8-bit)
      if (rowRel) r = (row + ((rw << 16) >> 16) + 65536) % 65536;
      if (colRel) c = (col + ((c & 0xff) << 24 >> 24) + 256) % 256;
    }
    return `${colRel ? '' : '$'}${colName(c)}${rowRel ? '' : '$'}${r + 1}`;
  };
  const sheetPrefix = (ixti: number) => {
    const x = world.xti[ixti];
    if (!x || x.first < 0 || x.first >= world.sheetNames.length) throw new Unreadable('external sheet');
    const a = world.sheetNames[x.first], b = world.sheetNames[Math.min(x.last, world.sheetNames.length - 1)];
    return x.last !== x.first ? `${quoteSheet(a)}:${quoteSheet(b)}!` : `${quoteSheet(a)}!`;
  };
  const BIN: Record<number, string> = { 0x03: '+', 0x04: '-', 0x05: '*', 0x06: '/', 0x07: '^', 0x08: '&', 0x09: '<', 0x0a: '<=', 0x0b: '=', 0x0c: '>=', 0x0d: '>', 0x0e: '<>', 0x0f: ' ', 0x10: ',', 0x11: ':' };
  const call = (name: string, n: number) => {
    const args: string[] = [];
    for (let i = 0; i < n; i++) args.unshift(pop());
    st.push(`${name}(${args.join(',')})`);
  };
  let i = at;
  while (i < end) {
    const p = d[i++];
    const base = p >= 0x20 ? (p & 0x1f) | 0x20 : p;
    if (BIN[base]) { const b = pop(), a = pop(); st.push(a + BIN[base] + b); continue; }
    switch (base) {
      case 0x12: st.push('+' + pop()); break;
      case 0x13: st.push('-' + pop()); break;
      case 0x14: st.push(pop() + '%'); break;
      case 0x15: st.push(`(${pop()})`); break;
      case 0x16: st.push(''); break;
      case 0x17: {
        const cch = d[i], wide = (d[i + 1] & 1) === 1;
        const r = new StringReader(d, i + 2);
        st.push(`"${r.chars(cch, wide).replace(/"/g, '""')}"`);
        i = r.at;
        break;
      }
      case 0x19: {
        const flags = d[i];
        if (flags & 0x04) i += 3 + (u16(d, i + 1) + 1) * 2; // a CHOOSE's jump table
        else i += 3;
        if (flags & 0x10) st.push(`SUM(${pop()})`);
        break;
      }
      case 0x1c: st.push(ERRORS[d[i]] ?? '#N/A'); i++; break;
      case 0x1d: st.push(d[i] ? 'TRUE' : 'FALSE'); i++; break;
      case 0x1e: st.push(String(u16(d, i))); i += 2; break;
      case 0x1f: st.push(String(f64(d, i))); i += 8; break;
      case 0x21: {
        const f = FTAB.get(u16(d, i));
        i += 2;
        if (!f || f.args < 0) throw new Unreadable('function');
        call(f.name, f.args);
        break;
      }
      case 0x22: {
        const n = d[i] & 0x7f, tab = u16(d, i + 1) & 0x7fff;
        i += 3;
        const f = FTAB.get(tab);
        if (!f) throw new Unreadable('function');
        call(f.name, n);
        break;
      }
      case 0x23: {
        const name = world.names[u16(d, i) - 1];
        if (!name) throw new Unreadable('name');
        st.push(name);
        i += 4;
        break;
      }
      case 0x24: st.push(ref(u16(d, i), u16(d, i + 2), false)); i += 4; break;
      case 0x25: st.push(`${ref(u16(d, i), u16(d, i + 4), false)}:${ref(u16(d, i + 2), u16(d, i + 6), false)}`); i += 8; break;
      case 0x26: case 0x27: case 0x28: i += 6; break;
      case 0x29: i += 2; break;
      case 0x2a: st.push('#REF!'); i += 4; break;
      case 0x2b: st.push('#REF!'); i += 8; break;
      case 0x2c: st.push(ref(u16(d, i), u16(d, i + 2), true)); i += 4; break;
      case 0x2d: st.push(`${ref(u16(d, i), u16(d, i + 4), true)}:${ref(u16(d, i + 2), u16(d, i + 6), true)}`); i += 8; break;
      case 0x3a: st.push(sheetPrefix(u16(d, i)) + ref(u16(d, i + 2), u16(d, i + 4), false)); i += 6; break;
      case 0x3b: st.push(sheetPrefix(u16(d, i)) + `${ref(u16(d, i + 2), u16(d, i + 6), false)}:${ref(u16(d, i + 4), u16(d, i + 8), false)}`); i += 10; break;
      case 0x3c: st.push('#REF!'); i += 6; break;
      case 0x3d: st.push('#REF!'); i += 10; break;
      default: throw new Unreadable(`token ${p.toString(16)}`);
    }
  }
  if (st.length !== 1) throw new Unreadable('stack');
  return st[0];
}

/** Open an old Excel workbook. */
export function readXls(bytes: Uint8Array): { book: Workbook; warnings: string[] } {
  let streams: Map<string, Uint8Array>;
  try {
    streams = cfbStreams(bytes);
  } catch {
    throw new Error('This is not an Excel workbook (or it is damaged).');
  }
  const stream = streams.get('Workbook') ?? streams.get('Book');
  if (!stream) throw new Error('This file has no Excel workbook in it.');
  const globals = records(stream, 0);
  const bof = globals[0];
  if (!bof || bof.id !== R.BOF) throw new Error('This Excel file is too old to read (before Excel 5). Save it as .xlsx in Excel first.');
  const biff8 = u16(bof.data, 0) === 0x0600;
  const warnings: string[] = [];

  let date1904 = false;
  const sst: string[] = [];
  const formats = new Map<number, string>(Object.entries(BUILTIN_FORMATS).map(([k, v]) => [Number(k), v]));
  const fonts: { bold: boolean; italic: boolean; underline: boolean }[] = [];
  const xfs: (CellStyle | undefined)[] = [];
  const sheets: { name: string; at: number; hidden: boolean }[] = [];
  const xti: { first: number; last: number }[] = [];
  const nameRecs: { name: string; builtin: boolean; itab: number; rgce: Uint8Array }[] = [];
  let otherSheets = 0;
  for (const rec of globals) {
    const d = rec.data;
    switch (rec.id) {
      case R.FILEPASS: throw new Error('This workbook is protected with a password. Open it in Excel, take the password off, and save it again.');
      case R.DATEMODE: date1904 = u16(d, 0) === 1; break;
      case R.SST: {
        if (!biff8) break;
        const n = u32(d, 4);
        const r = new StringReader(d, 8, rec.breaks);
        for (let k = 0; k < n && r.at < d.length; k++) sst.push(r.rich());
        break;
      }
      case R.FORMAT: case R.FORMAT_OLD:
        formats.set(u16(d, 0), biff8 ? xlString(d, 2, true) : shortString(d, 2, false));
        break;
      case R.FONT:
        fonts.push({ bold: u16(d, 6) >= 700, italic: (u16(d, 2) & 2) !== 0, underline: d[10] > 0 });
        break;
      case R.XF: {
        // the font numbers skip 4 ([MS-XLS] 2.5.129)
        const fi = u16(d, 0);
        const font = fonts[fi >= 4 ? fi - 1 : fi];
        const fmt = formats.get(u16(d, 2)) ?? 'General';
        const al = d[6] & 7, wrap = (d[6] & 8) !== 0, va = (d[6] >> 4) & 7;
        const st: CellStyle = {};
        if (fmt !== 'General') st.numFmt = fmt;
        if (font?.bold) st.bold = true;
        if (font?.italic) st.italic = true;
        if (font?.underline) st.underline = true;
        if (al === 1) st.align = 'left'; else if (al === 2) st.align = 'center'; else if (al === 3) st.align = 'right';
        if (wrap) st.wrap = true;
        if (va === 0) st.valign = 'top'; else if (va === 1) st.valign = 'middle';
        xfs.push(Object.keys(st).length ? st : undefined);
        break;
      }
      case R.BOUNDSHEET: {
        const type = d[5];
        if (type !== 0) { otherSheets++; break; }
        sheets.push({ at: u32(d, 0), hidden: (d[4] & 3) !== 0, name: biff8 ? shortString(d, 6, true) : shortString(d, 6, false) });
        break;
      }
      case R.EXTERNSHEET:
        if (!biff8) break;
        for (let k = 0, n = u16(d, 0); k < n; k++) {
          const first = i16(d, 4 + 6 * k), last = i16(d, 6 + 6 * k);
          xti.push({ first, last });
        }
        break;
      case R.NAME: {
        if (!biff8) break;
        const flags = u16(d, 0), cch = d[3], cce = u16(d, 4), itab = u16(d, 8);
        const r = new StringReader(d, 15);
        const builtin = (flags & 0x20) !== 0;
        const name = builtin ? `_builtin${d[15]}` : r.chars(cch, (d[14] & 1) === 1);
        nameRecs.push({ name, builtin, itab, rgce: d.subarray(r.at, r.at + cce) });
        break;
      }
    }
  }
  if (!sheets.length) throw new Error('This workbook has no sheets.');

  // sheet names as this program takes them (and unique)
  const names: string[] = [];
  for (const s of sheets) {
    let n = safeSheetName(s.name);
    for (let k = 2; names.some((x) => x.toLowerCase() === n.toLowerCase()); k++) n = safeSheetName(`${s.name} (${k})`);
    names.push(n);
  }
  const world: FormulaWorld = { sheetNames: names, xti, names: nameRecs.map((n) => n.name) };
  const book = new Workbook(names);
  let unreadFormulas = 0;
  const defined: DefinedName[] = [];
  book.build(() => {
    sheets.forEach((sh, si) => {
      const s = book.sheets[si];
      const recs = records(stream, sh.at);
      const merges: Range[] = [];
      const shared: { r1: number; r2: number; c1: number; c2: number; rgce: Uint8Array }[] = [];
      // formulas made from a shared or array formula are read once the sheet's records are all in
      const pending: { r: number; c: number; xf: number; anchor: [number, number]; cached: string | undefined }[] = [];
      const put = (r: number, c: number, xf: number, input: string | undefined) => {
        const style = xfs[xf];
        if (input === undefined && !style) return;
        s.setCell(r, c, { input: input || undefined, style });
      };
      const num = (v: number) => (Number.isFinite(v) ? String(v) : undefined);
      let stringFor: { r: number; c: number; xf: number } | null = null;
      for (const rec of recs) {
        const d = rec.data;
        const r = u16(d, 0), c = u16(d, 2), xf = u16(d, 4);
        switch (rec.id) {
          case R.LABELSST: put(r, c, xf, textInput(sst[u32(d, 6)] ?? '')); break;
          case R.LABEL: case R.RSTRING: put(r, c, xf, textInput(xlString(d, 6, biff8))); break;
          case R.NUMBER: put(r, c, xf, num(f64(d, 6))); break;
          case R.RK: put(r, c, xf, num(rk(u32(d, 6)))); break;
          case R.MULRK: {
            const last = u16(d, d.length - 2);
            for (let k = 0; c + k <= last; k++) put(r, c + k, u16(d, 4 + 6 * k), num(rk(u32(d, 6 + 6 * k))));
            break;
          }
          case R.BOOLERR: put(r, c, xf, d[7] ? ERRORS[d[6]] ?? '#N/A' : d[6] ? 'TRUE' : 'FALSE'); break;
          case R.FORMULA: {
            // the value it last worked out: a number, or (marked by FFFF at the top) text, TRUE/FALSE or an error
            let cached: string | undefined;
            const isNum = u16(d, 12) !== 0xffff;
            if (isNum) cached = num(f64(d, 6));
            else if (d[6] === 1) cached = d[8] ? 'TRUE' : 'FALSE';
            else if (d[6] === 2) cached = ERRORS[d[8]] ?? '#N/A';
            else if (d[6] === 3) cached = '';
            const cce = u16(d, biff8 ? 20 : 20);
            const at = 22;
            if (!isNum && d[6] === 0) stringFor = { r, c, xf };
            if (!biff8) { put(r, c, xf, cached); unreadFormulas++; break; }
            if (d[at] === 0x01 && cce === 5) {
              pending.push({ r, c, xf, anchor: [u16(d, at + 1), u16(d, at + 3)], cached });
              put(r, c, xf, cached);
              break;
            }
            try {
              put(r, c, xf, normalizeFormula('=' + formulaText(d, at, at + cce, r, c, world)));
            } catch {
              unreadFormulas++;
              put(r, c, xf, cached);
            }
            break;
          }
          case R.STRING:
            if (stringFor) {
              const text = xlString(d, 0, biff8);
              const p = pending.find((x) => x.r === stringFor!.r && x.c === stringFor!.c);
              if (p) p.cached = textInput(text);
              const cur = s.cell(stringFor.r, stringFor.c);
              // a formula keeps its formula; one kept as its value takes the text
              if (!cur?.input?.startsWith('=')) put(stringFor.r, stringFor.c, stringFor.xf, textInput(text));
              stringFor = null;
            }
            break;
          case R.SHRFMLA: case R.ARRAY: {
            const r1 = u16(d, 0), r2 = u16(d, 2), c1 = d[4], c2 = d[5];
            const cceAt = rec.id === R.SHRFMLA ? 8 : 12;
            shared.push({ r1, r2, c1, c2, rgce: d.subarray(cceAt + 2, cceAt + 2 + u16(d, cceAt)) });
            if (rec.id === R.ARRAY) shared[shared.length - 1].r1 = -1 - r1; // array formulas aren't shared: kept as values
            break;
          }
          case R.MERGECELLS:
            for (let k = 0, n = u16(d, 0); k < n; k++) merges.push({ r1: u16(d, 2 + 8 * k), r2: u16(d, 4 + 8 * k), c1: u16(d, 6 + 8 * k), c2: u16(d, 8 + 8 * k) });
            break;
          case R.COLINFO: {
            const first = u16(d, 0), last = Math.min(u16(d, 2), 255), w = u16(d, 4), opts = u16(d, 8);
            for (let k = first; k <= last; k++) {
              s.setColWidth(k, pxFromWidth(w / 256));
              if (opts & 1) s.setColHidden(k, true);
            }
            break;
          }
          case R.ROW: {
            const h = u16(d, 6) & 0x7fff, flags = biff8 ? u32(d, 12) : 0;
            if (flags & 0x20) s.setRowHidden(r, true);
            else if (flags & 0x40) s.setRowHeight(r, Math.round((h / 20) * (4 / 3)));
            break;
          }
        }
      }
      for (const p of pending) {
        const def = shared.find((x) => x.r1 === p.anchor[0] && x.c1 === p.anchor[1] && p.r <= x.r2 && p.c >= x.c1 && p.c <= x.c2);
        let input: string | undefined;
        if (def) {
          try { input = normalizeFormula('=' + formulaText(def.rgce, 0, def.rgce.length, p.r, p.c, world)); } catch { input = undefined; }
        }
        if (input === undefined) unreadFormulas++;
        put(p.r, p.c, p.xf, input ?? p.cached);
      }
      if (merges.length) s.setMerges(merges);
      if (sh.hidden) warnings.push(`The sheet "${names[si]}" was hidden; it shows here.`);
    });
    for (const n of nameRecs) {
      if (n.builtin || !n.rgce.length) continue;
      try {
        defined.push({ name: n.name, formula: normalizeFormula('=' + formulaText(n.rgce, 0, n.rgce.length, 0, 0, world)), ...(n.itab ? { sheet: book.sheets[n.itab - 1] } : {}) });
      } catch {
        // a name this program can't read is left out
      }
    }
    if (defined.length) book.setNames(defined);
  });
  if (date1904) warnings.push('This workbook counts dates from 1904 (an old Mac setting): dates may show four years early.');
  if (!biff8) warnings.push('This is an Excel 5 or 95 workbook: its formulas open as the values they last worked out.');
  else if (unreadFormulas) warnings.push(`${unreadFormulas} formula${unreadFormulas > 1 ? 's' : ''} could not be read and ${unreadFormulas > 1 ? 'show' : 'shows'} the value Excel last worked out.`);
  if (otherSheets) warnings.push(`${otherSheets} chart or macro sheet${otherSheets > 1 ? 's were' : ' was'} left out.`);
  warnings.push('Old .xls files open here but save as .xlsx (charts, pictures and macros in the .xls are not kept).');
  return { book, warnings };
}
