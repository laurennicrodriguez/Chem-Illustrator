// PDF files from recorded drawings (the same shapes and text as the EMF and SVG pictures), one
// page per slide or one page for a drawing. Lines and text stay sharp at any zoom. Text is
// written in fonts kept inside the file when a font source is given (see pdf-fonts.ts), so it
// looks the same everywhere; characters none of those have, or every character when there is no
// source, use the fonts every PDF reader has (Helvetica, Times, Courier and Symbol).
// Written from the published PDF 1.7 specification (ISO 32000-1).

import { zlibSync } from 'fflate';
import { Item, Seg, parseColor } from '../render/vector';
import { EmbeddedFont, TrueType, subsetTag, type PdfFontSource } from './pdf-fonts';

export interface PdfPage {
  /** Page size in points. */
  w: number;
  h: number;
  /** What is drawn, in points from the top left corner of the page. */
  items: Item[];
  /** Where the page's top left corner is in the items' coordinates (0, 0 when left out). */
  origin?: { x: number; y: number };
}

/** A picture's pixels, ready for a PDF: a JPEG as it is, or red-green-blue bytes and an alpha channel. */
export type PdfImage =
  | { kind: 'jpeg'; bytes: Uint8Array; w: number; h: number; components: 1 | 3 | 4 }
  | { kind: 'raw'; w: number; h: number; rgb: Uint8Array; alpha: Uint8Array | null };

export interface PdfOptions {
  title?: string;
  /** The pixels of a picture (data URL), or null when it can't be shown (it is drawn as a grey box). */
  image(src: string): Promise<PdfImage | null>;
  /** The font files to keep inside the file for a face (left out: the reader's standard fonts). */
  fonts?: PdfFontSource;
}

// ---------------------------------------------------------------- text encodings

/** Windows' Western character set (PDF's WinAnsiEncoding) beyond Latin-1. */
const WIN_ANSI_EXTRA: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c,
  'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b,
  'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

/** Characters the Symbol font has (Greek letters, arrows, maths), by their place in it. */
const SYMBOL: Record<string, number> = {};
{
  const greek = 'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ';
  const latin = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'αβχδεφγηιϕκλμνοπθρστυϖωξψζ';
  for (let i = 0; i < 26; i++) {
    SYMBOL[greek[i]] = latin.charCodeAt(i);
    SYMBOL[lower[i]] = latin.toLowerCase().charCodeAt(i);
  }
  Object.assign(SYMBOL, {
    'ς': 0x56, '∆': 0x44, 'Ω': 0x57, '−': 0x2d, '′': 0xa2, '″': 0xb2, '≤': 0xa3, '≥': 0xb3, '∞': 0xa5, '↔': 0xab, '←': 0xac,
    '↑': 0xad, '→': 0xae, '↓': 0xaf, '∝': 0xb5, '∂': 0xb6, '∙': 0xb7, '≠': 0xb9, '≡': 0xba, '≈': 0xbb, '⇔': 0xdb, '⇐': 0xdc,
    '⇑': 0xdd, '⇒': 0xde, '⇓': 0xdf, '√': 0xd6, '⋅': 0xd7, '∑': 0xe5, '∫': 0xf2, '∠': 0xd0, '∇': 0xd1, '∏': 0xd5, '⊕': 0xc5,
    '⊗': 0xc4, '∈': 0xce, '∀': 0x22, '∃': 0x24, '♦': 0xa8, '♥': 0xa9, '♠': 0xaa, '♣': 0xa7, '•': 0xb7, 'µ': 0x6d,
  });
}

/** Where a character can be written: the font's own encoding, or Symbol. */
function winAnsi(ch: string): number | null {
  const c = ch.codePointAt(0)!;
  if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff)) return c;
  return WIN_ANSI_EXTRA[ch] ?? null;
}

/** Text cut into pieces that one font can write, with each piece's position along the line. */
export function textPieces(text: string, widths: number[]): { symbol: boolean; codes: number[]; dx: number }[] {
  const out: { symbol: boolean; codes: number[]; dx: number }[] = [];
  let x = 0;
  [...text].forEach((ch, i) => {
    let code = winAnsi(ch), symbol = false;
    if (code === null && SYMBOL[ch] !== undefined) { code = SYMBOL[ch]; symbol = true; }
    // a narrow no-break space and other spaces count as spaces; anything else unknown shows as "?"
    if (code === null) code = /\s/.test(ch) ? 0x20 : 0x3f;
    const last = out[out.length - 1];
    if (last && last.symbol === symbol) last.codes.push(code);
    else out.push({ symbol, codes: [code], dx: x });
    x += widths[i] ?? 0;
  });
  return out;
}

/** Text cut into runs that one kept font can draw (the first that has each character), and runs that none can. */
export function keptPieces(text: string, widths: number[], fonts: EmbeddedFont[]): { font: EmbeddedFont | null; text: string; widths: number[]; dx: number }[] {
  const out: { font: EmbeddedFont | null; text: string; widths: number[]; dx: number }[] = [];
  let x = 0;
  [...text].forEach((ch, i) => {
    const c = ch.codePointAt(0)!;
    const font = fonts.find((f) => f.font.glyph(c) !== 0) ?? null;
    const last = out[out.length - 1];
    if (last && last.font === font) { last.text += ch; last.widths.push(widths[i] ?? 0); }
    else out.push({ font, text: ch, widths: [widths[i] ?? 0], dx: x });
    x += widths[i] ?? 0;
  });
  return out;
}

const SERIF = /times|georgia|cambria|garamond|serif$|book antiqua|palatino/i;
const MONO = /courier|consolas|mono/i;

/** The standard PDF font that looks most like a font family. */
export function standardFont(family: string, bold: boolean, italic: boolean): string {
  if (/^symbol$/i.test(family)) return 'Symbol';
  const style = (base: string, b: string, i: string, bi: string) => (bold && italic ? bi : bold ? b : italic ? i : base);
  if (MONO.test(family)) return style('Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique');
  if (SERIF.test(family) && !/sans/i.test(family)) return style('Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic');
  return style('Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique');
}

/** A JPEG's size and number of colour channels, from its frame header. */
export function jpegInfo(b: Uint8Array): { w: number; h: number; components: 1 | 3 | 4 } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const n = b[i + 9];
      return n === 1 || n === 3 || n === 4 ? { h: v.getUint16(i + 5), w: v.getUint16(i + 7), components: n } : null;
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    i += 2 + v.getUint16(i + 2);
  }
  return null;
}

// ---------------------------------------------------------------- writing the file

const num = (v: number): string => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

function pdfString(codes: number[]): string {
  let s = '(';
  for (const c of codes) {
    if (c === 0x28 || c === 0x29 || c === 0x5c) s += '\\' + String.fromCharCode(c);
    else if (c < 0x20 || c > 0x7e) s += '\\' + c.toString(8).padStart(3, '0');
    else s += String.fromCharCode(c);
  }
  return s + ')';
}

/** Text that can go in the document's information (title), in PDF's Unicode form when needed. */
function infoString(t: string): string {
  if ([...t].every((ch) => winAnsi(ch) !== null && ch.charCodeAt(0) < 0x80)) return pdfString([...t].map((ch) => ch.charCodeAt(0)));
  let hex = 'FEFF';
  for (let i = 0; i < t.length; i++) hex += t.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${hex.toUpperCase()}>`;
}

function pathOps(segs: Seg[]): string {
  return segs.map((s) => {
    switch (s.k) {
      case 'M': return `${num(s.x)} ${num(s.y)} m`;
      case 'L': return `${num(s.x)} ${num(s.y)} l`;
      case 'C': return `${num(s.x1)} ${num(s.y1)} ${num(s.x2)} ${num(s.y2)} ${num(s.x)} ${num(s.y)} c`;
      case 'Z': return 'h';
    }
  }).join('\n');
}

const CAP: Record<CanvasLineCap, number> = { butt: 0, round: 1, square: 2 };
const JOIN: Record<CanvasLineJoin, number> = { miter: 0, round: 1, bevel: 2 };

/** Collects the numbered objects of a PDF file. */
class Objects {
  private parts: (string | Uint8Array)[] = [];
  private offsets: number[] = [];
  private length = 0;
  private enc = new TextEncoder();

  constructor() {
    // the header, and a comment with high bytes so programs treat the file as binary
    this.push('%PDF-1.7\n%âãÏÓ\n');
  }

  private push(p: string | Uint8Array): void {
    const b = typeof p === 'string' ? latin1(p) : p;
    this.parts.push(b);
    this.length += b.length;
  }

  /** Reserve an object number (to refer to it before it is written). */
  reserve(): number {
    this.offsets.push(-1);
    return this.offsets.length;
  }

  /** Write object `n` (or a new one). Returns its number. */
  put(body: string, n = this.reserve()): number {
    this.offsets[n - 1] = this.length;
    this.push(`${n} 0 obj\n${body}\nendobj\n`);
    return n;
  }

  /** A stream object, compressed unless it already is. */
  stream(dict: string, data: Uint8Array, compress = true, n = this.reserve()): number {
    const bytes = compress ? zlibSync(data, { level: 6 }) : data;
    const filter = compress ? '/Filter /FlateDecode ' : '';
    this.offsets[n - 1] = this.length;
    this.push(`${n} 0 obj\n<< ${filter}${dict} /Length ${bytes.length} >>\nstream\n`);
    this.push(bytes);
    this.push('\nendstream\nendobj\n');
    return n;
  }

  text(s: string): Uint8Array {
    return this.enc.encode(s);
  }

  finish(root: number, info: number): Uint8Array {
    const xref = this.length;
    let x = `xref\n0 ${this.offsets.length + 1}\n0000000000 65535 f \n`;
    for (const o of this.offsets) x += `${String(Math.max(0, o)).padStart(10, '0')} 00000 n \n`;
    x += `trailer\n<< /Size ${this.offsets.length + 1} /Root ${root} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    this.push(x);
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) { out.set(p as Uint8Array, at); at += (p as Uint8Array).length; }
    return out;
  }
}

/** Characters 0–255 as single bytes (the file's own text is plain ASCII apart from the header comment). */
function latin1(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

/** A PDF file with these pages. */
export async function writePdf(pages: PdfPage[], opts: PdfOptions): Promise<Uint8Array> {
  const o = new Objects();
  const catalog = o.reserve(), pagesId = o.reserve();
  const fonts = new Map<string, number>();
  const fontRef = (name: string) => {
    let n = fonts.get(name);
    if (!n) {
      const enc = name === 'Symbol' ? '' : ' /Encoding /WinAnsiEncoding';
      n = o.put(`<< /Type /Font /Subtype /Type1 /BaseFont /${name}${enc} >>`);
      fonts.set(name, n);
    }
    return `F${n}`;
  };
  // fonts kept in the file: each face's files, read once
  const faces = new Map<string, Promise<EmbeddedFont[]>>();
  const kept: EmbeddedFont[] = [];
  const faceFonts = (family: string, bold: boolean, italic: boolean): Promise<EmbeddedFont[]> => {
    if (!opts.fonts) return Promise.resolve([]);
    const key = `${family.toLowerCase()}|${bold}|${italic}`;
    let f = faces.get(key);
    if (!f) {
      f = opts.fonts(family, bold, italic).catch(() => [] as Uint8Array[]).then((files) => files.flatMap((data) => {
        try {
          const tt = new TrueType(data);
          if (!tt.embeddable) return [];
          const e = new EmbeddedFont(tt, o.reserve(), subsetTag(kept.length));
          kept.push(e);
          return [e];
        } catch { return []; }
      }));
      faces.set(key, f);
    }
    return f;
  };
  // each picture is stored once, however many times it shows
  const images = new Map<string, number | null>();
  const imageRef = async (src: string): Promise<number | null> => {
    if (images.has(src)) return images.get(src)!;
    let n: number | null = null;
    const img = await opts.image(src).catch(() => null);
    if (img?.kind === 'jpeg') {
      const cs = img.components === 1 ? '/DeviceGray' : img.components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
      // CMYK JPEGs from Adobe programs store their ink amounts inverted
      const decode = img.components === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
      n = o.stream(`/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace ${cs} /BitsPerComponent 8${decode} /Filter /DCTDecode`, img.bytes, false);
    } else if (img?.kind === 'raw') {
      const mask = img.alpha ? o.stream(`/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceGray /BitsPerComponent 8`, img.alpha) : 0;
      n = o.stream(`/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8${mask ? ` /SMask ${mask} 0 R` : ''}`, img.rgb);
    }
    images.set(src, n);
    return n;
  };
  // see-through colours need a graphics state each
  const alphas = new Map<string, number>();
  const alphaRef = (fill: number, stroke: number) => {
    const key = `${num(fill)}/${num(stroke)}`;
    let n = alphas.get(key);
    if (!n) { n = o.put(`<< /Type /ExtGState /ca ${num(fill)} /CA ${num(stroke)} >>`); alphas.set(key, n); }
    return `G${n}`;
  };

  const kids: number[] = [];
  for (const page of pages) {
    const ops: string[] = [];
    const usedFonts = new Set<string>(), usedImages = new Set<number>(), usedStates = new Set<string>();
    // points from the top left, as recorded: flip the page's y axis
    ops.push(`1 0 0 -1 0 ${num(page.h)} cm`);
    if (page.origin) ops.push(`1 0 0 1 ${num(-page.origin.x)} ${num(-page.origin.y)} cm`);
    const rgb = (c: string) => {
      const k = parseColor(c);
      return { v: `${num(k.r / 255)} ${num(k.g / 255)} ${num(k.b / 255)}`, a: k.a };
    };
    for (const it of page.items) {
      if (it.kind === 'path') {
        if (!it.segs.some((s) => s.k !== 'M')) continue;
        const paint = it.fill ? rgb(it.fill) : rgb(it.stroke!.color);
        if (paint.a <= 0) continue;
        ops.push('q');
        if (paint.a < 1) {
          const g = it.fill ? alphaRef(paint.a, 1) : alphaRef(1, paint.a);
          usedStates.add(g);
          ops.push(`/${g} gs`);
        }
        if (it.fill) ops.push(`${paint.v} rg`, pathOps(it.segs), 'f');
        else {
          const st = it.stroke!;
          ops.push(`${paint.v} RG`, `${num(st.width)} w ${CAP[st.cap] ?? 0} J ${JOIN[st.join] ?? 0} j`, pathOps(it.segs), 'S');
        }
        ops.push('Q');
      } else if (it.kind === 'text') {
        const paint = rgb(it.color);
        if (paint.a <= 0 || !it.text) continue;
        ops.push('q', `${paint.v} rg`);
        // turned text (degrees anticlockwise): along the line, and up from it, on the page
        const a = ((it.angle ?? 0) * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
        const kept = await faceFonts(it.family, it.bold, it.italic);
        const show = (f: string, dx: number, s: string) => {
          usedFonts.add(f);
          // the text matrix turns the letters the right way up again
          const m = `${num(cos)} ${num(-sin)} ${num(-sin)} ${num(-cos)} ${num(it.x + dx * cos)} ${num(it.y - dx * sin)}`;
          ops.push(`BT /${f} ${num(it.size)} Tf ${m} Tm ${s} Tj ET`);
        };
        for (const piece of keptPieces(it.text, it.widths, kept)) {
          if (piece.font) show(`F${piece.font.id}`, piece.dx, piece.font.show(piece.text));
          else for (const p of textPieces(piece.text, piece.widths)) show(fontRef(p.symbol ? 'Symbol' : standardFont(it.family, it.bold, it.italic)), piece.dx + p.dx, pdfString(p.codes));
        }
        ops.push('Q');
      } else {
        const n = await imageRef(it.src);
        const c = it.crop ?? { l: 0, t: 0, r: 0, b: 0 };
        const W = it.w / Math.max(0.01, 1 - c.l - c.r), H = it.h / Math.max(0.01, 1 - c.t - c.b);
        ops.push('q');
        if (it.rot) {
          // turned about its middle (in the page's points from the top left, as recorded)
          const a = (it.rot * Math.PI) / 180, cx = it.x + it.w / 2, cy = it.y + it.h / 2;
          ops.push(`1 0 0 1 ${num(cx)} ${num(cy)} cm ${num(Math.cos(a))} ${num(Math.sin(a))} ${num(-Math.sin(a))} ${num(Math.cos(a))} 0 0 cm 1 0 0 1 ${num(-cx)} ${num(-cy)} cm`);
        }
        if (it.flipH || it.flipV) {
          const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
          ops.push(`1 0 0 1 ${num(cx)} ${num(cy)} cm ${it.flipH ? -1 : 1} 0 0 ${it.flipV ? -1 : 1} 0 0 cm 1 0 0 1 ${num(-cx)} ${num(-cy)} cm`);
        }
        ops.push(`${num(it.x)} ${num(it.y)} ${num(it.w)} ${num(it.h)} re W n`);
        if (n) {
          usedImages.add(n);
          // the picture's top row goes at the top
          ops.push(`${num(W)} 0 0 ${num(-H)} ${num(it.x - c.l * W)} ${num(it.y - c.t * H + H)} cm /I${n} Do`);
        } else ops.push(`0.85 0.85 0.85 rg ${num(it.x)} ${num(it.y)} ${num(it.w)} ${num(it.h)} re f`);
        ops.push('Q');
      }
    }
    const content = o.stream('', o.text(ops.join('\n')));
    const res = [
      usedFonts.size ? `/Font << ${[...usedFonts].map((f) => `/${f} ${f.slice(1)} 0 R`).join(' ')} >>` : '',
      usedImages.size ? `/XObject << ${[...usedImages].map((n) => `/I${n} ${n} 0 R`).join(' ')} >>` : '',
      usedStates.size ? `/ExtGState << ${[...usedStates].map((g) => `/${g} ${g.slice(1)} 0 R`).join(' ')} >>` : '',
    ].filter(Boolean).join(' ');
    kids.push(o.put(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(page.w)} ${num(page.h)}] /Resources << ${res} >> /Contents ${content} 0 R >>`));
  }
  for (const e of kept) {
    if (!e.used.size) { o.put('null', e.id); continue; }
    const fontFile = o.stream(`/Length1 ${e.font.data.length}`, e.font.data);
    const descriptor = o.reserve(), cidFont = o.reserve(), toUnicode = o.reserve();
    const parts = e.objects({ fontFile, cidFont, descriptor, toUnicode });
    o.put(parts.descriptor, descriptor);
    o.put(parts.cidFont, cidFont);
    o.stream('', o.text(parts.toUnicode), true, toUnicode);
    o.put(parts.type0, e.id);
  }
  o.put(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`, pagesId);
  o.put(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, catalog);
  const info = o.put(`<< /Producer (Chem Illustrator)${opts.title ? ` /Title ${infoString(opts.title)}` : ''} >>`);
  return o.finish(catalog, info);
}
