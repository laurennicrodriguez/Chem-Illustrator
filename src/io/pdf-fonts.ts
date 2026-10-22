// Fonts inside PDF files, so labels and captions look the same in every reader and journals'
// checks ("all fonts embedded") pass. Each TrueType file goes in as a composite font (Type0 with
// a CIDFontType2 descendant, ISO 32000-1 §9.7): two-byte codes that are the glyph numbers, the
// widths of the glyphs used, and a ToUnicode map so the text can still be searched and copied.
//
// The fonts are the free ones that come with the app, cut by Fontsource into Latin,
// Latin-extended and Greek files; each file is already a small subset, so it is embedded whole.
// Arial, Helvetica and the like are drawn with Arimo, Times with Tinos and Courier with Cousine:
// free fonts (SIL Open Font License) with the same letter widths.

/** Gets the TrueType files of a font face, each covering some characters (none when it has none to give). */
export type PdfFontSource = (family: string, bold: boolean, italic: boolean) => Promise<Uint8Array[]>;

/** One TrueType file, read enough to write text with it. */
export class TrueType {
  readonly unitsPerEm: number;
  readonly postScriptName: string;
  readonly bbox: [number, number, number, number];
  readonly ascent: number;
  readonly descent: number;
  readonly capHeight: number;
  readonly italicAngle: number;
  readonly fixedPitch: boolean;
  readonly serif: boolean;
  /** May it go inside a file (OS/2 fsType: restricted-licence fonts may not). */
  readonly embeddable: boolean;
  private cmap = new Map<number, number>();
  private advances: number[] = [];

  constructor(readonly data: Uint8Array) {
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const t = new Map<string, number>();
    for (let i = 0, n = v.getUint16(4); i < n; i++) {
      const d = 12 + i * 16;
      t.set(String.fromCharCode(data[d], data[d + 1], data[d + 2], data[d + 3]), v.getUint32(d + 8));
    }
    const at = (tag: string) => {
      const o = t.get(tag);
      if (o === undefined) throw new Error(`Font has no ${tag} table`);
      return o;
    };
    const head = at('head'), hhea = at('hhea'), hmtx = at('hmtx'), maxp = at('maxp');
    this.unitsPerEm = v.getUint16(head + 18) || 1000;
    const em = (x: number) => Math.round((x * 1000) / this.unitsPerEm);
    this.bbox = [em(v.getInt16(head + 36)), em(v.getInt16(head + 38)), em(v.getInt16(head + 40)), em(v.getInt16(head + 42))];
    this.ascent = em(v.getInt16(hhea + 4));
    this.descent = em(v.getInt16(hhea + 6));
    const os2 = t.get('OS/2');
    this.capHeight = os2 !== undefined && v.getUint16(os2) >= 2 ? em(v.getInt16(os2 + 88)) : Math.round(this.ascent * 0.7);
    this.embeddable = os2 === undefined || (v.getUint16(os2 + 8) & 0x0002) === 0;
    // PANOSE family 2 (text) with a serif style below 11 ("normal sans" and up are sans)
    this.serif = os2 !== undefined && data[os2 + 32] === 2 && data[os2 + 33] > 1 && data[os2 + 33] < 11;
    const post = t.get('post');
    this.italicAngle = post !== undefined ? v.getInt32(post + 4) / 65536 : 0;
    this.fixedPitch = post !== undefined && v.getUint32(post + 12) !== 0;
    const glyphs = v.getUint16(maxp + 4), metrics = v.getUint16(hhea + 34);
    let last = 0;
    for (let g = 0; g < glyphs; g++) {
      if (g < metrics) last = v.getUint16(hmtx + g * 4);
      this.advances.push(em(last));
    }
    this.postScriptName = readPostScriptName(data, v, t.get('name')) ?? 'Font';
    this.readCmap(v, at('cmap'));
  }

  /** The glyph for a character (0 when the font hasn't got it). */
  glyph(code: number): number {
    return this.cmap.get(code) ?? 0;
  }

  /** A glyph's width, in thousandths of the font size. */
  width(gid: number): number {
    return this.advances[gid] ?? this.advances[this.advances.length - 1] ?? 0;
  }

  /** The Unicode map (format 12 when there is one, else format 4). */
  private readCmap(v: DataView, base: number): void {
    let best = -1, bestRank = 0;
    for (let i = 0, n = v.getUint16(base + 2); i < n; i++) {
      const r = base + 4 + i * 8;
      const platform = v.getUint16(r), encoding = v.getUint16(r + 2), sub = base + v.getUint32(r + 4);
      const format = v.getUint16(sub);
      const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
      const rank = !unicode ? 0 : format === 12 ? 2 : format === 4 ? 1 : 0;
      if (rank > bestRank) { best = sub; bestRank = rank; }
    }
    if (best < 0) return;
    if (v.getUint16(best) === 12) {
      for (let i = 0, n = v.getUint32(best + 12); i < n; i++) {
        const g = best + 16 + i * 12;
        const start = v.getUint32(g), end = v.getUint32(g + 4), gid = v.getUint32(g + 8);
        for (let c = start; c <= end && c - start < 0x10000; c++) this.cmap.set(c, gid + c - start);
      }
      return;
    }
    const segs = v.getUint16(best + 6) / 2;
    const ends = best + 14, starts = ends + segs * 2 + 2, deltas = starts + segs * 2, offsets = deltas + segs * 2;
    for (let s = 0; s < segs; s++) {
      const end = v.getUint16(ends + s * 2), start = v.getUint16(starts + s * 2);
      const delta = v.getInt16(deltas + s * 2), ro = v.getUint16(offsets + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let gid: number;
        if (ro === 0) gid = (c + delta) & 0xffff;
        else {
          const g = v.getUint16(offsets + s * 2 + ro + (c - start) * 2);
          gid = g === 0 ? 0 : (g + delta) & 0xffff;
        }
        if (gid) this.cmap.set(c, gid);
      }
    }
  }
}

function readPostScriptName(data: Uint8Array, v: DataView, base: number | undefined): string | null {
  if (base === undefined) return null;
  const count = v.getUint16(base + 2), strings = base + v.getUint16(base + 4);
  for (let i = 0; i < count; i++) {
    const r = base + 6 + i * 12;
    if (v.getUint16(r + 6) !== 6) continue;
    const platform = v.getUint16(r), len = v.getUint16(r + 8), off = strings + v.getUint16(r + 10);
    let s = '';
    if (platform === 1) for (let k = 0; k < len; k++) s += String.fromCharCode(data[off + k]);
    else for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(v.getUint16(off + k));
    s = s.replace(/[^\x21-\x7e]|[()<>[\]{}/%#]/g, '');
    if (s) return s;
  }
  return null;
}

/** One embedded font in a PDF being written: which glyphs it has drawn, and what each stands for. */
export class EmbeddedFont {
  readonly used = new Map<number, string>();
  constructor(readonly font: TrueType, readonly id: number, readonly tag: string) {}

  /** A run of text as the font's two-byte glyph codes, in PDF hex form. */
  show(text: string): string {
    let hex = '';
    for (const ch of text) {
      const gid = this.font.glyph(ch.codePointAt(0)!);
      if (!this.used.has(gid)) this.used.set(gid, ch);
      hex += gid.toString(16).padStart(4, '0');
    }
    return `<${hex.toUpperCase()}>`;
  }

  /** The objects that describe the font: [body of the Type0 font, the CID font, the descriptor, the ToUnicode map]. */
  objects(ref: { fontFile: number; cidFont: number; descriptor: number; toUnicode: number }): { type0: string; cidFont: string; descriptor: string; toUnicode: string } {
    const f = this.font;
    const name = `${this.tag}+${f.postScriptName}`;
    const gids = [...this.used.keys()].sort((a, b) => a - b);
    // widths in runs of neighbouring glyphs: [first [w w w] first [w] ...]
    const w: string[] = [];
    for (let i = 0; i < gids.length; ) {
      let j = i;
      while (j + 1 < gids.length && gids[j + 1] === gids[j] + 1) j++;
      w.push(`${gids[i]} [${gids.slice(i, j + 1).map((g) => f.width(g)).join(' ')}]`);
      i = j + 1;
    }
    // flags: fixed pitch 1, serif 2, non-symbolic 32, italic 64
    const flags = (f.fixedPitch ? 1 : 0) | (f.serif ? 2 : 0) | 32 | (f.italicAngle !== 0 ? 64 : 0);
    const stemV = 80;
    const descriptor = `<< /Type /FontDescriptor /FontName /${name} /Flags ${flags} /FontBBox [${f.bbox.join(' ')}] /ItalicAngle ${Math.round(f.italicAngle * 100) / 100} /Ascent ${f.ascent} /Descent ${f.descent} /CapHeight ${f.capHeight} /StemV ${stemV} /FontFile2 ${ref.fontFile} 0 R >>`;
    const cidFont = `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${ref.descriptor} 0 R /DW 1000 /W [${w.join(' ')}] /CIDToGIDMap /Identity >>`;
    const type0 = `<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${ref.cidFont} 0 R] /ToUnicode ${ref.toUnicode} 0 R >>`;
    return { type0, cidFont, descriptor, toUnicode: toUnicodeCMap(gids.map((g) => [g, this.used.get(g)!])) };
  }
}

/** A ToUnicode CMap (Adobe Technical Note #5411): glyph code → the character it shows. */
export function toUnicodeCMap(pairs: [number, string][]): string {
  const hex4 = (n: number) => n.toString(16).padStart(4, '0').toUpperCase();
  const utf16 = (s: string) => [...s].map((c) => {
    const p = c.codePointAt(0)!;
    if (p < 0x10000) return hex4(p);
    const q = p - 0x10000;
    return hex4(0xd800 + (q >> 10)) + hex4(0xdc00 + (q & 0x3ff));
  }).join('');
  const rows: string[] = [];
  // at most 100 entries per block
  for (let i = 0; i < pairs.length; i += 100) {
    const chunk = pairs.slice(i, i + 100);
    rows.push(`${chunk.length} beginbfchar`, ...chunk.map(([g, s]) => `<${hex4(g)}> <${utf16(s)}>`), 'endbfchar');
  }
  return [
    '/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def', '/CMapName /Adobe-Identity-UCS def', '/CMapType 2 def',
    '1 begincodespacerange', '<0000> <FFFF>', 'endcodespacerange',
    ...rows,
    'endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end',
  ].join('\n');
}

/** Six capital letters for a subset font's name ("CIAAAB+Arimo-Regular"), different for each font in a file. */
export function subsetTag(n: number): string {
  let s = '';
  for (let i = 0; i < 4; i++) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return 'CI' + s;
}
