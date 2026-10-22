// Encapsulated PostScript pictures (EPSF 3.0), for journals and layout programs that still ask
// for EPS. Written from Adobe's PostScript Language Reference (third edition) and the EPSF 3.0
// specification, using only Level 2 operators. The shapes and text are the same recorded items
// as the SVG, EMF and PDF pictures. Text uses the PostScript fonts every printer and reader has
// (Helvetica, Times, Courier, and Symbol for Greek letters and arrows), set to Windows' Western
// character set so accented letters and dashes come out right. Pictures inside are stored
// LZW-compressed; EPS has no see-through colours, so those are blended with white.

import { Item, Seg, parseColor } from './vector';
import type { EmfBox } from './emf';
import { textPieces, standardFont, type PdfImage } from '../io/pdf';
import { lzw } from './tiff';

const num = (v: number): string => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

function pathOps(segs: Seg[]): string {
  return segs.map((s) => {
    switch (s.k) {
      case 'M': return `${num(s.x)} ${num(s.y)} m`;
      case 'L': return `${num(s.x)} ${num(s.y)} l`;
      case 'C': return `${num(s.x1)} ${num(s.y1)} ${num(s.x2)} ${num(s.y2)} ${num(s.x)} ${num(s.y)} c`;
      case 'Z': return 'h';
    }
  }).join(' ');
}

function psString(codes: number[]): string {
  let s = '(';
  for (const c of codes) {
    if (c === 0x28 || c === 0x29 || c === 0x5c) s += '\\' + String.fromCharCode(c);
    else if (c < 0x20 || c > 0x7e) s += '\\' + c.toString(8).padStart(3, '0');
    else s += String.fromCharCode(c);
  }
  return s + ')';
}

/** Bytes as ASCII85 (PostScript's ~> ended text form of binary data), in lines of 75. */
export function ascii85(b: Uint8Array): string {
  let out = '', line = 0;
  const push = (s: string) => {
    for (const ch of s) { out += ch; if (++line === 75) { out += '\n'; line = 0; } }
  };
  for (let i = 0; i < b.length; i += 4) {
    const n = Math.min(4, b.length - i);
    let v = 0;
    for (let k = 0; k < 4; k++) v = v * 256 + (k < n ? b[i + k] : 0);
    if (v === 0 && n === 4) { push('z'); continue; }
    const d: string[] = [];
    for (let k = 0; k < 5; k++) { d.unshift(String.fromCharCode(33 + (v % 85))); v = Math.floor(v / 85); }
    push(d.slice(0, n + 1).join(''));
  }
  return out + '~>';
}

/** Glyph names for Windows' Western characters that ISO Latin-1 puts elsewhere (0x80–0x9F, and the straight quotes). */
const WIN_ANSI_NAMES: Record<number, string> = {
  0x27: 'quotesingle', 0x60: 'grave',
  0x80: 'Euro', 0x82: 'quotesinglbase', 0x83: 'florin', 0x84: 'quotedblbase', 0x85: 'ellipsis', 0x86: 'dagger', 0x87: 'daggerdbl',
  0x88: 'circumflex', 0x89: 'perthousand', 0x8a: 'Scaron', 0x8b: 'guilsinglleft', 0x8c: 'OE', 0x8e: 'Zcaron', 0x91: 'quoteleft',
  0x92: 'quoteright', 0x93: 'quotedblleft', 0x94: 'quotedblright', 0x95: 'bullet', 0x96: 'endash', 0x97: 'emdash', 0x98: 'tilde',
  0x99: 'trademark', 0x9a: 'scaron', 0x9b: 'guilsinglright', 0x9c: 'oe', 0x9e: 'zcaron', 0x9f: 'Ydieresis',
};

/**
 * An EPS file of the items, one point to one PostScript unit, `box` being the picture's edge.
 * `image` gives a picture's pixels (null draws a grey box in its place).
 */
export async function itemsToEps(items: Item[], box: EmfBox, image: (src: string) => Promise<PdfImage | null>, title = 'Drawing'): Promise<string> {
  const W = box.x2 - box.x1, H = box.y2 - box.y1;
  const fonts = new Map<string, string>();
  const body: string[] = [];
  const colour = (c: string) => {
    const k = parseColor(c);
    // no see-through in PostScript: mix with white
    const mix = (v: number) => num((v / 255) * k.a + (1 - k.a));
    return { v: `${mix(k.r)} ${mix(k.g)} ${mix(k.b)}`, a: k.a };
  };
  const fontKey = (name: string) => {
    let f = fonts.get(name);
    if (!f) { f = `F${fonts.size + 1}`; fonts.set(name, f); }
    return f;
  };
  for (const it of items) {
    if (it.kind === 'path') {
      if (!it.segs.some((s) => s.k !== 'M')) continue;
      const paint = colour(it.fill ?? it.stroke!.color);
      if (paint.a <= 0) continue;
      if (it.fill) body.push(`${paint.v} rg np ${pathOps(it.segs)} f`);
      else {
        const st = it.stroke!;
        const cap = { butt: 0, round: 1, square: 2 }[st.cap] ?? 0, join = { miter: 0, round: 1, bevel: 2 }[st.join] ?? 0;
        body.push(`${paint.v} rg ${num(st.width)} w ${cap} J ${join} j np ${pathOps(it.segs)} S`);
      }
    } else if (it.kind === 'text') {
      const paint = colour(it.color);
      if (paint.a <= 0 || !it.text) continue;
      body.push(`gsave ${paint.v} rg ${num(it.x)} ${num(it.y)} translate ${num(-(it.angle ?? 0))} rotate 1 -1 scale`);
      for (const p of textPieces(it.text, it.widths)) {
        const f = fontKey(p.symbol ? 'Symbol' : standardFont(it.family, it.bold, it.italic));
        body.push(`${f} ${num(it.size)} sf ${num(p.dx)} 0 m ${psString(p.codes)} show`);
      }
      body.push('grestore');
    } else {
      const c = it.crop ?? { l: 0, t: 0, r: 0, b: 0 };
      const iw = it.w / Math.max(0.01, 1 - c.l - c.r), ih = it.h / Math.max(0.01, 1 - c.t - c.b);
      body.push(`gsave ${num(it.x)} ${num(it.y)} ${num(it.w)} ${num(it.h)} rectclip`);
      const img = await image(it.src).catch(() => null);
      if (!img) body.push(`0.85 0.85 0.85 rg ${num(it.x)} ${num(it.y)} ${num(it.w)} ${num(it.h)} rectfill`);
      else {
        let data: Uint8Array, filter: string, comps: number, decode = '';
        if (img.kind === 'jpeg') {
          data = img.bytes; filter = '/DCTDecode filter'; comps = img.components;
          if (comps === 4) decode = ' /Decode [1 0 1 0 1 0 1 0]';
        } else {
          data = img.rgb;
          if (img.alpha) {
            data = img.rgb.slice();
            for (let i = 0; i < img.alpha.length; i++) for (let k = 0; k < 3; k++) data[i * 3 + k] = Math.round((data[i * 3 + k] * img.alpha[i] + 255 * (255 - img.alpha[i])) / 255);
          }
          data = lzw(data); filter = '/LZWDecode filter'; comps = 3;
        }
        const space = comps === 1 ? '/DeviceGray' : comps === 4 ? '/DeviceCMYK' : '/DeviceRGB';
        body.push(
          `${num(it.x - c.l * iw)} ${num(it.y - c.t * ih)} translate ${num(iw)} ${num(ih)} scale ${space} setcolorspace`,
          `<< /ImageType 1 /Width ${img.w} /Height ${img.h} /BitsPerComponent 8${decode || ` /Decode [${Array(comps).fill('0 1').join(' ')}]`} /ImageMatrix [${img.w} 0 0 ${img.h} 0 0]`,
          `/DataSource currentfile /ASCII85Decode filter ${filter} >> image`,
          ascii85(data),
        );
      }
      body.push('grestore');
    }
  }
  const bb = (v: number, up: boolean) => (up ? Math.ceil(v) : Math.floor(v));
  // each text font set to Windows' Western characters (Symbol keeps its own)
  const fontDefs = [...fonts].map(([name, key]) => name === 'Symbol'
    ? `/${key} /Symbol findfont def`
    : `/${key} /${name} findfont dup length dict begin { 1 index /FID ne { def } { pop pop } ifelse } forall /Encoding ISOLatin1Encoding 256 array copy ${Object.entries(WIN_ANSI_NAMES).map(([c, n]) => `dup ${c} /${n} put`).join(' ')} def currentdict end /${name}-Win exch definefont def`);
  const safeTitle = title.replace(/[^\x20-\x7e]/g, '?');
  return [
    '%!PS-Adobe-3.0 EPSF-3.0',
    `%%BoundingBox: 0 0 ${bb(W, true)} ${bb(H, true)}`,
    `%%HiResBoundingBox: 0 0 ${num(W)} ${num(H)}`,
    `%%Title: ${safeTitle}`,
    '%%Creator: Chem Illustrator',
    '%%LanguageLevel: 2',
    ...(fonts.size ? [...fonts.keys()].map((f, i) => `${i ? '%%+' : '%%DocumentNeededResources:'} font ${f}`) : []),
    '%%Pages: 1',
    '%%EndComments',
    '%%BeginProlog',
    '/ci_eps 20 dict def ci_eps begin',
    '/m /moveto load def /l /lineto load def /c /curveto load def /h /closepath load def /np /newpath load def',
    '/f /fill load def /S /stroke load def /w /setlinewidth load def /J /setlinecap load def /j /setlinejoin load def',
    '/rg /setrgbcolor load def /sf { scalefont setfont } bind def',
    'end',
    '%%EndProlog',
    '%%Page: 1 1',
    'save ci_eps begin',
    ...fontDefs,
    // points from the top left, as recorded: flip the y axis
    `0 ${num(H)} translate 1 -1 scale ${num(-box.x1)} ${num(-box.y1)} translate`,
    ...body,
    'end restore',
    'showpage',
    '%%EOF',
    '',
  ].join('\n');
}
