// The fonts in every font box: free fonts that come with the app (all from Google Fonts, under
// the SIL Open Font License, packaged by Fontsource), grouped as Sans, Serif, Poster and
// Monospace, then the usual fonts on this computer (Arial, Calibri…), folded away until opened.
// Any other installed font can still be typed in.
//
// Only the Latin, Latin-extended and Greek letters of each are bundled (in regular and bold,
// upright and italic where the font has them); the screen loads a file only when it is used.

import { woffToSfnt, type EmbedFace, type FontSource } from './io/font-embed';
import type { PdfFontSource } from './io/pdf-fonts';

export interface FontGroup {
  name: string;
  fonts: string[];
  /** Folded away in the list until opened. */
  folded?: boolean;
}

/** Fonts bundled with the app, by group (the names are the families as Google Fonts gives them). */
export const BUNDLED_GROUPS: FontGroup[] = [
  { name: 'Sans', fonts: ['Inter', 'Source Sans 3', 'IBM Plex Sans', 'Lato'] },
  { name: 'Serif', fonts: ['Source Serif 4', 'Merriweather', 'Libre Baskerville'] },
  { name: 'Poster', fonts: ['Montserrat', 'Oswald', 'Bebas Neue', 'Archivo Black', 'Barlow Condensed'] },
  { name: 'Monospace', fonts: ['JetBrains Mono', 'IBM Plex Mono'] },
];

/** Fonts usually on Windows and macOS: used when installed, never shipped. */
export const SYSTEM_FONTS = ['Arial', 'Helvetica', 'Calibri', 'Aptos', 'Cambria', 'Times New Roman', 'Georgia', 'Garamond', 'Palatino Linotype', 'Segoe UI', 'Verdana', 'Courier New', 'Symbol'];

export const FONT_GROUPS: FontGroup[] = [...BUNDLED_GROUPS, { name: 'On this computer', fonts: SYSTEM_FONTS, folded: true }];

/** Is this one of the fonts that come with the app (so it can go inside saved Office files)? */
export function isBundled(family: string): boolean {
  const f = family.trim().toLowerCase();
  return BUNDLED_GROUPS.some((g) => g.fonts.some((x) => x.toLowerCase() === f));
}

/** Fontsource's package name for a family ("Source Sans 3" → "source-sans-3"). */
export function packageName(family: string): string {
  return family.trim().toLowerCase().replace(/\s+/g, '-');
}

// Unicode ranges of the subsets, as Fontsource gives them.
const RANGES: Record<string, string> = {
  latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  'latin-ext': 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
  greek: 'U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF',
};

/** One bundled file: "…/files/inter-latin-ext-700-italic.woff2" → its family, subset, weight and style. */
export function readFontFile(path: string): { pkg: string; subset: string; weight: number; style: 'normal' | 'italic' } | null {
  const m = /@fontsource\/([a-z0-9-]+)\/files\/\1-(latin-ext|latin|greek)-(400|700)-(normal|italic)\.woff2?$/.exec(path);
  return m ? { pkg: m[1], subset: m[2], weight: Number(m[3]), style: m[4] as 'normal' | 'italic' } : null;
}

// the bundled files (Vite copies the ones listed and gives each its address)
const FILES = import.meta.glob('/node_modules/@fontsource/*/files/*-{latin,latin-ext,greek}-{400,700}-{normal,italic}.woff2', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const WOFF = import.meta.glob('/node_modules/@fontsource/*/files/*-{latin,latin-ext,greek}-{400,700}-{normal,italic}.woff', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

let registered = false;

/** Tell the page about the bundled fonts (each file loads when text first uses it). `changed` runs when files have loaded. */
export function registerBundledFonts(changed: () => void): void {
  if (registered || typeof FontFace === 'undefined') return;
  registered = true;
  const family = new Map<string, string>();
  for (const g of BUNDLED_GROUPS) for (const f of g.fonts) family.set(packageName(f), f);
  for (const [path, url] of Object.entries(FILES)) {
    const f = readFontFile(path);
    const name = f && family.get(f.pkg);
    if (!f || !name) continue;
    document.fonts.add(new FontFace(name, `url(${url}) format('woff2')`, { weight: String(f.weight), style: f.style, unicodeRange: RANGES[f.subset], display: 'swap' }));
  }
  document.fonts.addEventListener('loadingdone', () => changed());
}

/** The bundled Latin file of a font (WOFF, which can be turned into the TrueType that Word and PowerPoint embed). */
export function bundledFontUrl(family: string, bold: boolean, italic: boolean): string | null {
  const pkg = packageName(family);
  const want = `${pkg}-latin-${bold ? 700 : 400}-${italic ? 'italic' : 'normal'}.woff`;
  for (const [path, url] of Object.entries(WOFF)) if (path.endsWith('/' + want) && path.includes(`/@fontsource/${pkg}/`)) return url;
  return null;
}

/** The shared list of fonts for every font box (`list="ci-fonts"`), grouped. */
export function installFontList(): void {
  if (document.getElementById('ci-fonts')) return;
  const list = document.createElement('datalist');
  list.id = 'ci-fonts';
  for (const g of FONT_GROUPS) {
    for (const f of g.fonts) {
      const o = new Option(f);
      o.dataset.group = g.name;
      if (g.folded) o.dataset.folded = 'true';
      list.append(o);
    }
  }
  document.body.append(list);
}

/** The faces of a bundled font as TrueType, for putting inside saved Word and PowerPoint files (none for other fonts). */
export const bundledFaces: FontSource = async (family) => {
  if (!isBundled(family)) return [];
  const out: EmbedFace[] = [];
  for (const [bold, italic] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    const url = bundledFontUrl(family, bold, italic);
    if (!url) continue;
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    out.push({ bold, italic, data: woffToSfnt(bytes) });
  }
  return out;
};

/** The free font a PDF uses for a family the app doesn't ship: same letter widths as Arial, Times New Roman or Courier New. */
export function pdfStandIn(family: string): string {
  if (isBundled(family)) return family;
  if (/courier|consolas|mono/i.test(family)) return 'Cousine';
  if (/times|georgia|cambria|garamond|book antiqua|palatino|serif$/i.test(family) && !/sans/i.test(family)) return 'Tinos';
  return 'Arimo';
}

/** The bundled files (Latin, then Latin-extended, then Greek) of a face, nearest weight and style first. */
export function pdfFontUrls(family: string, bold: boolean, italic: boolean): string[] {
  const pkg = packageName(pdfStandIn(family));
  const pick = (b: boolean, i: boolean) => ['latin', 'latin-ext', 'greek']
    .map((sub) => Object.entries(WOFF).find(([path]) => path.endsWith(`/@fontsource/${pkg}/files/${pkg}-${sub}-${b ? 700 : 400}-${i ? 'italic' : 'normal'}.woff`))?.[1])
    .filter((u): u is string => !!u);
  // a font without a bold or italic face uses the one it has
  for (const [b, i] of [[bold, italic], [false, italic], [bold, false], [false, false]] as const) {
    const urls = pick(b, i);
    if (urls.length) return urls;
  }
  return [];
}

/** Font files for PDF export: every face as TrueType, Symbol left to the reader's own. */
export const pdfFonts: PdfFontSource = async (family, bold, italic) => {
  if (/^symbol$/i.test(family.trim())) return [];
  return Promise.all(pdfFontUrls(family, bold, italic).map(async (url) => woffToSfnt(new Uint8Array(await (await fetch(url)).arrayBuffer()))));
};
