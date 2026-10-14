// Putting fonts inside saved Word and PowerPoint files, so a document or deck that uses one of
// the free fonts that come with the app looks the same on a computer that doesn't have it.
//
// The bundled files are WOFF: TrueType with each table zlib-compressed, turned back into plain
// TrueType here. Word keeps embedded fonts "obfuscated" (ECMA-376 Part 1, §17.8.1: the first 32
// bytes XORed with a key made from a GUID). PowerPoint keeps them in Embedded OpenType form
// (W3C EOT submission, version 2.0: a header describing the font, then the TrueType bytes).
// Only fonts whose licence allows embedding are bundled (all SIL Open Font License).

import { unzlibSync } from 'fflate';

/** One face of a font to embed. */
export interface EmbedFace {
  bold: boolean;
  italic: boolean;
  /** Plain TrueType/OpenType bytes. */
  data: Uint8Array;
}

/** Gets the faces of a font that can be embedded (none when it isn't one of the bundled free fonts). */
export type FontSource = (family: string) => Promise<EmbedFace[]>;

/** WOFF 1.0 → the TrueType (or OpenType) it holds. */
export function woffToSfnt(woff: Uint8Array): Uint8Array {
  const v = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  if (v.getUint32(0) !== 0x774f4646) throw new Error('Not a WOFF file');
  const flavor = v.getUint32(4), numTables = v.getUint16(12), totalSfntSize = v.getUint32(16);
  const out = new Uint8Array(totalSfntSize);
  const o = new DataView(out.buffer);
  o.setUint32(0, flavor);
  o.setUint16(4, numTables);
  let pow = 1, log = 0;
  while (pow * 2 <= numTables) { pow *= 2; log++; }
  o.setUint16(6, pow * 16);
  o.setUint16(8, log);
  o.setUint16(10, numTables * 16 - pow * 16);
  let at = 12 + numTables * 16;
  for (let i = 0; i < numTables; i++) {
    const e = 44 + i * 20;
    const tag = v.getUint32(e), offset = v.getUint32(e + 4), compLength = v.getUint32(e + 8), origLength = v.getUint32(e + 12), checksum = v.getUint32(e + 16);
    const raw = woff.subarray(offset, offset + compLength);
    const table = compLength < origLength ? unzlibSync(raw) : raw;
    out.set(table.subarray(0, origLength), at);
    const d = 12 + i * 16;
    o.setUint32(d, tag);
    o.setUint32(d + 4, checksum);
    o.setUint32(d + 8, at);
    o.setUint32(d + 12, origLength);
    at += (origLength + 3) & ~3;
  }
  return out;
}

/** The table directory of a TrueType file: tag → [offset, length]. */
function tables(ttf: Uint8Array): Map<string, [number, number]> {
  const v = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const n = v.getUint16(4);
  const out = new Map<string, [number, number]>();
  for (let i = 0; i < n; i++) {
    const d = 12 + i * 16;
    const tag = String.fromCharCode(ttf[d], ttf[d + 1], ttf[d + 2], ttf[d + 3]);
    out.set(tag, [v.getUint32(d + 8), v.getUint32(d + 12)]);
  }
  return out;
}

export interface FontInfo {
  family: string;
  style: string;
  version: string;
  fullName: string;
  weight: number;
  italic: boolean;
  /** Whether and how the font may be embedded (OS/2 fsType; 0 is installable, bit 1 forbids it). */
  fsType: number;
  panose: Uint8Array;
  unicodeRange: number[];
  codePageRange: number[];
  checkSumAdjustment: number;
}

/** What the font says about itself (its 'name', 'OS/2' and 'head' tables). */
export function fontInfo(ttf: Uint8Array): FontInfo {
  const v = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const t = tables(ttf);
  const names = new Map<number, string>();
  const nm = t.get('name');
  if (nm) {
    const [base] = nm;
    const count = v.getUint16(base + 2), strings = base + v.getUint16(base + 4);
    for (let i = 0; i < count; i++) {
      const r = base + 6 + i * 12;
      const platform = v.getUint16(r), encoding = v.getUint16(r + 2), id = v.getUint16(r + 6), len = v.getUint16(r + 8), off = v.getUint16(r + 10);
      if (platform !== 3 || (encoding !== 1 && encoding !== 0) || names.has(id)) continue;
      let s = '';
      for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(v.getUint16(strings + off + k));
      names.set(id, s);
    }
  }
  const os2 = t.get('OS/2')?.[0];
  const head = t.get('head')?.[0];
  return {
    family: names.get(1) ?? '', style: names.get(2) ?? 'Regular', version: names.get(5) ?? '', fullName: names.get(4) ?? names.get(1) ?? '',
    weight: os2 !== undefined ? v.getUint16(os2 + 4) : 400,
    italic: os2 !== undefined ? (v.getUint16(os2 + 62) & 1) === 1 : false,
    fsType: os2 !== undefined ? v.getUint16(os2 + 8) : 0,
    panose: os2 !== undefined ? ttf.slice(os2 + 32, os2 + 42) : new Uint8Array(10),
    unicodeRange: os2 !== undefined ? [0, 1, 2, 3].map((k) => v.getUint32(os2 + 42 + k * 4)) : [0, 0, 0, 0],
    codePageRange: os2 !== undefined && v.getUint16(os2) >= 1 ? [v.getUint32(os2 + 78), v.getUint32(os2 + 82)] : [0, 0],
    checkSumAdjustment: head !== undefined ? v.getUint32(head + 8) : 0,
  };
}

/** May this font go inside a document? (Not when its fsType says "restricted licence embedding".) */
export function embeddable(ttf: Uint8Array): boolean {
  return (fontInfo(ttf).fsType & 0x0002) === 0;
}

/** A GUID such as "{0B5C8F1E-...}" from 16 random bytes. */
export function newGuid(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const b = random(16);
  const h = [...b].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join('');
  return `{${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}}`;
}

/** Word's obfuscated font (ECMA-376 §17.8.1): the first 32 bytes XORed with the GUID's bytes, read from its end. Doing it twice gives the font back. */
export function obfuscate(ttf: Uint8Array, guid: string): Uint8Array {
  const hex = guid.replace(/[{}-]/g, '');
  const key = new Uint8Array(16);
  for (let i = 0; i < 16; i++) key[i] = parseInt(hex.slice(30 - i * 2, 32 - i * 2), 16);
  const out = ttf.slice();
  for (let i = 0; i < 32 && i < out.length; i++) out[i] ^= key[i % 16];
  return out;
}

/** PowerPoint's embedded font: the TrueType in an Embedded OpenType (version 2.0) wrapper, uncompressed. */
export function toEot(ttf: Uint8Array): Uint8Array {
  const f = fontInfo(ttf);
  const utf16 = (s: string) => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { b[i * 2] = s.charCodeAt(i) & 0xff; b[i * 2 + 1] = s.charCodeAt(i) >> 8; } return b; };
  const strings = [f.family, f.style, f.version, f.fullName].map(utf16);
  const headerSize = 80 + strings.reduce((n, s) => n + 4 + s.length, 0) + 4; // fixed part, 4 names with padding and size, root string
  const out = new Uint8Array(headerSize + ttf.length);
  const v = new DataView(out.buffer);
  let p = 0;
  const u32 = (x: number) => { v.setUint32(p, x >>> 0, true); p += 4; };
  const u16 = (x: number) => { v.setUint16(p, x, true); p += 2; };
  const u8 = (x: number) => { out[p++] = x; };
  u32(out.length);
  u32(ttf.length);
  u32(0x00020000);
  u32(0); // flags: no subsetting, compression or XOR
  out.set(f.panose, p); p += 10;
  u8(1); // DEFAULT_CHARSET
  u8(f.italic ? 1 : 0);
  u32(f.weight);
  u16(f.fsType);
  u16(0x504c);
  for (const r of f.unicodeRange) u32(r);
  for (const r of f.codePageRange) u32(r);
  u32(f.checkSumAdjustment);
  u32(0); u32(0); u32(0); u32(0);
  for (const s of strings) { u16(0); u16(s.length); out.set(s, p); p += s.length; }
  u16(0); u16(0); // padding, no root string
  out.set(ttf, p);
  return out;
}

/** The fonts named in Word's run properties (w:rFonts) or in DrawingML text (a:latin, a:ea, a:cs). */
export function fontsNamed(xmlText: string): Set<string> {
  const out = new Set<string>();
  for (const m of xmlText.matchAll(/<w:rFonts\b[^>]*>/g)) for (const a of m[0].matchAll(/w:(?:ascii|hAnsi|cs|eastAsia)="([^"]+)"/g)) out.add(unescape(a[1]));
  for (const m of xmlText.matchAll(/<a:(?:latin|ea|cs)\b[^>]*\btypeface="([^"]+)"/g)) if (!m[1].startsWith('+')) out.add(unescape(m[1]));
  return out;
}

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The faces to embed for every font the parts name that `source` can supply, by family. */
export async function facesToEmbed(xmlTexts: Iterable<string>, source: FontSource | undefined): Promise<{ family: string; faces: EmbedFace[] }[]> {
  if (!source) return [];
  const names = new Set<string>();
  for (const t of xmlTexts) for (const f of fontsNamed(t)) names.add(f);
  const out: { family: string; faces: EmbedFace[] }[] = [];
  for (const family of [...names].sort()) {
    const faces = (await source(family).catch(() => [])).filter((f) => embeddable(f.data));
    if (faces.length) out.push({ family, faces });
  }
  return out;
}
