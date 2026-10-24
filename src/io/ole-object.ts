// Another program's file kept whole inside a document (Insert > Object, or an object in a Word
// file), as Word keeps it: an Office file as a part of its own (Excel.Sheet.12 and the like),
// anything else wrapped in an OLE package (a compound file holding the file, which Windows opens
// in the file's own program when the object is double-clicked). Written from Microsoft's
// published descriptions ([MS-CFB], [MS-OLEDS]) and the Office Open XML standard.

import { cfbClass, cfbStreams, isCfb, writeCfb } from './cfb';
import { isCdx } from './cdx';
import { dataUrl, fromDataUrl } from '../render/images';
import type { Embedded } from '../document/document';

export type { Embedded };

const OCTET = 'application/octet-stream';
/** The relationship types from the document to an embedded object's part. */
export const OLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject';
export const PACKAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/package';
/** The content type of an OLE object's part (embeddings/oleObject1.bin). */
export const OLE_TYPE = 'application/vnd.openxmlformats-officedocument.oleObject';

/** Office files Word embeds as parts of their own: their program's name for them, Word's name for the part, and the content type. */
const OFFICE: Record<string, { prog: string; part: string; type: string; kind: string }> = {
  xlsx: { prog: 'Excel.Sheet.12', part: 'Microsoft_Excel_Worksheet', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'Excel worksheet' },
  xlsm: { prog: 'Excel.SheetMacroEnabled.12', part: 'Microsoft_Excel_Macro-Enabled_Worksheet', type: 'application/vnd.ms-excel.sheet.macroEnabled.12', kind: 'Excel worksheet' },
  docx: { prog: 'Word.Document.12', part: 'Microsoft_Word_Document', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'Word document' },
  docm: { prog: 'Word.DocumentMacroEnabled.12', part: 'Microsoft_Word_Macro-Enabled_Document', type: 'application/vnd.ms-word.document.macroEnabled.12', kind: 'Word document' },
  pptx: { prog: 'PowerPoint.Show.12', part: 'Microsoft_PowerPoint_Presentation', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'PowerPoint presentation' },
  pptm: { prog: 'PowerPoint.ShowMacroEnabled.12', part: 'Microsoft_PowerPoint_Macro-Enabled_Presentation', type: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12', kind: 'PowerPoint presentation' },
};
/** Older Office objects whose whole compound file is the program's own file (an .xls, .doc or .ppt). */
const BINARY: Record<string, string> = { 'Excel.Sheet.8': 'xls', 'Excel.Sheet.5': 'xls', 'Word.Document.8': 'doc', 'Word.Document.6': 'doc', 'PowerPoint.Show.8': 'ppt' };
/** Class ids of common objects, for compound files that don't name their program. */
const CLASSES: Record<string, string> = {
  '{0003000C-0000-0000-C000-000000000046}': 'Package',
  '{00020830-0000-0000-C000-000000000046}': 'Excel.Sheet.12',
  '{00020820-0000-0000-C000-000000000046}': 'Excel.Sheet.8',
  '{F4754C9B-64F5-4B40-8AF4-679732AC0607}': 'Word.Document.12',
  '{00020906-0000-0000-C000-000000000046}': 'Word.Document.8',
  '{CF4F55F4-8F87-4D47-80BB-5808164BB3F8}': 'PowerPoint.Show.12',
  '{64818D10-4F9B-11CF-86EA-00AA00B929E8}': 'PowerPoint.Show.8',
};
const PACKAGE_CLASS = '{0003000C-0000-0000-C000-000000000046}';

/** The extension of a file name, in lower case ("" if none). */
function extOf(name: string): string {
  const m = /\.([^.\\/]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

/** A file to embed: an Office file as Word embeds it, anything else in an OLE package. */
export function embedFile(name: string, bytes: Uint8Array, icon = false): Embedded {
  const ext = extOf(name);
  const office = OFFICE[ext];
  const base: Embedded = office
    ? { prog: office.prog, part: 'package', ext, data: dataUrl(bytes, office.type), name }
    : { prog: 'Package', part: 'ole', ext: 'bin', data: dataUrl(packageObject(name, bytes), OCTET), name };
  return icon ? { ...base, icon: true } : base;
}

/** An object as found in a Word file: its part's bytes, extension and relationship type. */
export function readEmbedded(prog: string, bytes: Uint8Array, path: string, relType: string, icon: boolean): Embedded {
  const ext = extOf(path) || 'bin';
  const pkg = /\/package$/.test(relType);
  const e: Embedded = { prog: prog || (pkg ? OFFICE[ext]?.prog ?? '' : ''), part: pkg ? 'package' : 'ole', ext, data: dataUrl(bytes, pkg ? OFFICE[ext]?.type ?? OCTET : OCTET) };
  const inside = pkg ? null : fileInside(e);
  if (inside && e.prog === 'Package') e.name = inside.name;
  return icon ? { ...e, icon: true } : e;
}

/** Whether an object is ChemDraw's (by the program name Word keeps with it). */
export function isChemDraw(e: Pick<Embedded, 'prog'> | string): boolean {
  return /^ChemDraw/i.test(typeof e === 'string' ? e : e.prog);
}

/** The CDX drawing inside a ChemDraw object's part (the CDX itself, or a compound file holding it); null when there is none. */
export function chemdrawCdx(bin: Uint8Array): Uint8Array | null {
  try {
    if (isCdx(bin)) return bin;
    if (!isCfb(bin)) return null;
    const streams = cfbStreams(bin);
    return [...streams.values()].find(isCdx) ?? streams.get('CONTENTS') ?? null;
  } catch {
    return null;
  }
}

/** The part to write in a Word file: its bytes, the relationship type and content type. */
export function embeddedPart(e: Embedded): { bytes: Uint8Array; ext: string; rel: string; type: string; base: string } {
  const bytes = fromDataUrl(e.data).bytes;
  if (e.part === 'package') {
    const office = OFFICE[e.ext];
    return { bytes, ext: e.ext, rel: PACKAGE_REL, type: office?.type ?? OCTET, base: office?.part ?? 'Package' };
  }
  return { bytes, ext: e.ext || 'bin', rel: OLE_REL, type: OLE_TYPE, base: 'oleObject' };
}

/** What kind of thing it is, for menus and messages ("Excel worksheet", "PDF file"). */
export function objectKind(e: Embedded): string {
  if (e.part === 'package') return OFFICE[e.ext]?.kind ?? 'Office file';
  const f = fileInside(e);
  const ext = f ? extOf(f.name) : '';
  if (ext && OFFICE[ext]) return OFFICE[ext].kind;
  if (ext) return `${ext.toUpperCase()} file`;
  return e.prog || 'object';
}

/**
 * The file inside an object, to open in its own program: an Office part as it is, the file in
 * an OLE package, an Office file in an object's "Package" stream, an older Office object's own
 * file, or a file of a kind we know in one of its streams (a PDF in Acrobat's). Null when the
 * object holds nothing we can take out (Word still opens it).
 */
export function fileInside(e: Embedded): { name: string; bytes: Uint8Array } | null {
  let bytes: Uint8Array;
  try { bytes = fromDataUrl(e.data).bytes; } catch { return null; }
  const stem = (e.name ?? '').replace(/\.[^.\\/]+$/, '') || 'Embedded ' + (OFFICE[e.ext]?.kind ?? 'object');
  if (e.part === 'package') return { name: `${stem}.${e.ext}`, bytes };
  if (!isCfb(bytes)) return null;
  let streams: Map<string, Uint8Array>;
  try { streams = cfbStreams(bytes); } catch { return null; }
  const native = streams.get('\u0001Ole10Native');
  if (native) return readNative(native);
  const prog = e.prog || progIdOf(bytes) || '';
  const pkg = streams.get('Package');
  if (pkg && isZip(pkg)) {
    const ext = Object.keys(OFFICE).find((k) => OFFICE[k].prog === prog) ?? zipKind(pkg);
    if (ext) return { name: `${stem}.${ext}`, bytes: pkg };
  }
  const old = BINARY[prog];
  if (old) return { name: `${stem}.${old}`, bytes };
  for (const s of streams.values()) {
    if (startsWith(s, '%PDF')) return { name: `${stem}.pdf`, bytes: s };
    if (isZip(s)) { const ext = zipKind(s); if (ext) return { name: `${stem}.${ext}`, bytes: s }; }
  }
  return null;
}

/**
 * The object after its file was changed in its own program: an Office part replaced, a package
 * made again round the new file, an Office file in a "Package" stream kept as Word's own part.
 * Null when the object can't take the file back.
 */
export function withFile(e: Embedded, file: { name: string; bytes: Uint8Array }): Embedded | null {
  const keep = e.icon ? { icon: true } : {};
  if (e.part === 'package') return { ...e, data: dataUrl(file.bytes, OFFICE[e.ext]?.type ?? OCTET) };
  const ext = extOf(file.name);
  if (e.prog === 'Package') return { ...e, data: dataUrl(packageObject(e.name ?? file.name, file.bytes), OCTET) };
  if (OFFICE[ext]) return { ...embedFile(e.name ?? file.name, file.bytes), name: e.name, ...keep };
  if (BINARY[e.prog] === ext && isCfb(file.bytes)) return { ...e, data: dataUrl(file.bytes, OCTET) };
  return null;
}

/**
 * An object copied in another program (Windows' "Embed Source": a compound file), as Word
 * would keep it: an Office file inside becomes a part of its own, anything else stays as it is.
 */
export function fromEmbedSource(cfb: Uint8Array): Embedded | null {
  if (!isCfb(cfb)) return null;
  let streams: Map<string, Uint8Array>;
  try { streams = cfbStreams(cfb); } catch { return null; }
  const prog = progIdOf(cfb) || '';
  const pkg = streams.get('Package');
  const ext = Object.keys(OFFICE).find((k) => OFFICE[k].prog === prog) ?? (pkg && isZip(pkg) ? zipKind(pkg) : null);
  if (pkg && isZip(pkg) && ext) return { prog: OFFICE[ext].prog, part: 'package', ext, data: dataUrl(pkg, OFFICE[ext].type) };
  if (!prog) return null;
  const e: Embedded = { prog, part: 'ole', ext: 'bin', data: dataUrl(cfb, OCTET) };
  const inside = prog === 'Package' ? fileInside(e) : null;
  return inside ? { ...e, name: inside.name } : e;
}

// ---------------------------------------------------------------- OLE packages

/** Text as single bytes ending in a zero (names in a package are in the Windows code page; others become "_"). */
function ansi(s: string): number[] {
  return [...s].map((c) => { const n = c.charCodeAt(0); return n < 256 ? n : 0x5f; }).concat(0);
}

/**
 * A file wrapped in an OLE package: a compound file of the Package class whose "Ole10Native"
 * stream holds the file's name and bytes, as the Windows Object Packager makes them.
 */
export function packageObject(name: string, bytes: Uint8Array): Uint8Array {
  const label = ansi(name), temp = ansi(name);
  const head = [2, 0, ...label, ...label, 0, 0, 3, 0];
  const body = new Uint8Array(head.length + 4 + temp.length + 4 + bytes.length);
  const dv = new DataView(body.buffer);
  let at = 0;
  body.set(head, at); at += head.length;
  dv.setUint32(at, temp.length, true); at += 4;
  body.set(temp, at); at += temp.length;
  dv.setUint32(at, bytes.length, true); at += 4;
  body.set(bytes, at);
  const native = new Uint8Array(4 + body.length);
  new DataView(native.buffer).setUint32(0, body.length, true);
  native.set(body, 4);
  return writeCfb([
    ['\u0001Ole10Native', native],
    ['\u0001CompObj', compObj('OLE Package', 'Package')],
    ['\u0001Ole', OLE_STREAM],
  ], PACKAGE_CLASS);
}

/** The file in an "Ole10Native" stream (a package's), or null. */
function readNative(s: Uint8Array): { name: string; bytes: Uint8Array } | null {
  const dv = new DataView(s.buffer, s.byteOffset, s.byteLength);
  let at = 4;
  const zstr = (): string | null => {
    const end = s.indexOf(0, at);
    if (end < 0) return null;
    const t = String.fromCharCode(...s.subarray(at, end));
    at = end + 1;
    return t;
  };
  if (at + 2 > s.length) return null;
  at += 2;
  const label = zstr();
  const path = zstr();
  if (label === null || path === null || at + 8 > s.length) return null;
  at += 4;
  const tempLen = dv.getUint32(at, true);
  at += 4 + tempLen;
  if (at + 4 > s.length) return null;
  const size = dv.getUint32(at, true);
  at += 4;
  if (at + size > s.length) return null;
  const name = (label || path).split(/[\\/]/).pop() || 'Embedded file';
  return { name, bytes: s.slice(at, at + size) };
}

/** The "\u0001Ole" stream of an embedded (not linked) object: [MS-OLEDS] 2.3.3, version 0x02000001 with nothing set. */
const OLE_STREAM = Uint8Array.from([1, 0, 0, 2, ...new Array(16).fill(0)]);

/** A "\u0001CompObj" stream ([MS-OLEDS] 2.3.8): the object's type for people and its program's name. */
function compObj(userType: string, prog: string): Uint8Array {
  const out: number[] = [];
  const u32 = (n: number) => out.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
  const str = (t: string) => { const b = ansi(t); u32(b.length); out.push(...b); };
  u32(0xfffe0001); u32(0x00000a03); u32(0xffffffff);
  // the class id again (Package's), as programs write it
  out.push(0x0c, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46);
  str(userType);
  u32(0); // no clipboard format
  str(prog);
  u32(0x71b239f4);
  u32(0); u32(0); u32(0);
  return Uint8Array.from(out);
}

/** The program's name for an object (its ProgID) from its CompObj stream, else from its class id. */
export function progIdOf(cfb: Uint8Array): string | null {
  let streams: Map<string, Uint8Array>;
  try { streams = cfbStreams(cfb); } catch { return null; }
  const c = streams.get('\u0001CompObj');
  if (c && c.length > 32) {
    const dv = new DataView(c.buffer, c.byteOffset, c.byteLength);
    let at = 28;
    const skipStr = (): boolean => {
      if (at + 4 > c.length) return false;
      const n = dv.getUint32(at, true);
      at += 4;
      if (n === 0xffffffff || n === 0xfffffffe) { at += 4; return true; }
      at += n;
      return at <= c.length;
    };
    if (skipStr() && skipStr() && at + 4 <= c.length) {
      const n = dv.getUint32(at, true);
      if (n > 1 && n < 256 && at + 4 + n <= c.length) {
        const prog = String.fromCharCode(...c.subarray(at + 4, at + 4 + n - 1)).replace(/\0+$/, '');
        if (/^[A-Za-z][\w.-]*$/.test(prog)) return prog;
      }
    }
  }
  try {
    const id = cfbClass(cfb);
    return id ? CLASSES[id] ?? null : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- telling files apart

function startsWith(b: Uint8Array, s: string): boolean {
  return b.length >= s.length && [...s].every((c, i) => b[i] === c.charCodeAt(0));
}

function isZip(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;
}

/** Which Office file a zip is, from the names of its parts (read straight from the zip's headers). */
function zipKind(b: Uint8Array): string | null {
  const text = new TextDecoder('latin1').decode(b.subarray(0, Math.min(b.length, 1 << 20)));
  if (text.includes('xl/workbook.xml')) return 'xlsx';
  if (text.includes('word/document.xml')) return 'docx';
  if (text.includes('ppt/presentation.xml')) return 'pptx';
  return null;
}
