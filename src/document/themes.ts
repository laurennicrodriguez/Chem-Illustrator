// Design > Document Formatting, as Word's: a theme (fonts for headings and for body text, and
// colours), a style set (how the headings, title and body text are laid out), and paragraph
// spacing, each changing the document's styles, so every paragraph in them changes too (except
// what was formatted by hand). The themes and style sets are this app's own, set in the free
// fonts that come with it (or Times New Roman, the journal default).

import { defaultStyles, modifyStyle, type DocDesign, type DocText, type NamedStyle } from './document';

export type { DocDesign };

export interface ThemeFonts { name: string; heading: string; body: string }
export interface ThemeColors { name: string; /** Headings and the title. */ heading: string; /** Body text (unset: automatic, black). */ text?: string; /** The six accents, for the colour boxes. */ accents: string[] }
export interface Theme { name: string; fonts: string; colors: string }

export const THEME_FONTS: ThemeFonts[] = [
  { name: 'Journal', heading: 'Times New Roman', body: 'Times New Roman' },
  { name: 'Source', heading: 'Source Sans 3', body: 'Source Serif 4' },
  { name: 'Plex', heading: 'IBM Plex Sans', body: 'IBM Plex Sans' },
  { name: 'Inter', heading: 'Inter', body: 'Inter' },
  { name: 'Baskerville', heading: 'Libre Baskerville', body: 'Source Serif 4' },
  { name: 'Merriweather', heading: 'Merriweather', body: 'Lato' },
  { name: 'Montserrat', heading: 'Montserrat', body: 'Lato' },
];

export const THEME_COLORS: ThemeColors[] = [
  { name: 'Black and White', heading: '#000000', accents: ['#000000', '#404040', '#7f7f7f', '#a6a6a6', '#c00000', '#1f5fbf'] },
  { name: 'Navy', heading: '#1f3864', accents: ['#1f3864', '#2e75b6', '#9dc3e6', '#c55a11', '#548235', '#7030a0'] },
  { name: 'Teal', heading: '#0b5d6b', accents: ['#0b5d6b', '#17a2b8', '#a3d9e2', '#e07a1f', '#5b8c2a', '#6f42c1'] },
  { name: 'Crimson', heading: '#8b1a1a', accents: ['#8b1a1a', '#c0392b', '#e6a39b', '#2c3e50', '#7f8c8d', '#d4a017'] },
  { name: 'Forest', heading: '#2e5d34', accents: ['#2e5d34', '#4f9d56', '#b7d7a8', '#8d6e63', '#c0a062', '#3e6f8e'] },
  { name: 'Violet', heading: '#4b2a7b', accents: ['#4b2a7b', '#7e57c2', '#cdb8e8', '#00897b', '#f9a825', '#c2185b'] },
  { name: 'Slate', heading: '#37474f', accents: ['#37474f', '#607d8b', '#b0bec5', '#ef6c00', '#00838f', '#6d4c41'] },
];

export const THEMES: Theme[] = [
  { name: 'Journal', fonts: 'Journal', colors: 'Black and White' },
  { name: 'Report', fonts: 'Source', colors: 'Navy' },
  { name: 'Technical', fonts: 'Plex', colors: 'Slate' },
  { name: 'Clean', fonts: 'Inter', colors: 'Teal' },
  { name: 'Classic', fonts: 'Baskerville', colors: 'Crimson' },
  { name: 'Field Notes', fonts: 'Merriweather', colors: 'Forest' },
  { name: 'Poster', fonts: 'Montserrat', colors: 'Violet' },
];

/** The look of a style a style set gives (fonts and colours come from the theme). */
type Shape = Partial<Pick<NamedStyle, 'size' | 'bold' | 'italic' | 'align' | 'spaceBefore' | 'spaceAfter' | 'line' | 'firstLine'>>;

export interface StyleSet { name: string; description: string; styles: Record<string, Shape> }

const H = (n: number) => `Heading${n}`;

export const STYLE_SETS: StyleSet[] = [
  { name: 'Journal', description: 'The standard: justified 11 pt text, bold headings (as a journal\'s Supporting Information)', styles: {} },
  {
    name: 'Simple', description: 'Left-aligned text, larger plain headings, more room between paragraphs',
    styles: { Normal: { align: 'left', spaceAfter: 10, line: 1.08 }, Title: { size: 22, bold: false, align: 'left' }, [H(1)]: { size: 16, bold: false, spaceBefore: 20 }, [H(2)]: { size: 13, bold: false }, [H(3)]: { size: 12, bold: false, italic: false } },
  },
  {
    name: 'Centered', description: 'The title and main headings centred',
    styles: { Title: { size: 20, align: 'center' }, [H(1)]: { size: 14, align: 'center', spaceBefore: 24 }, [H(2)]: { align: 'center' } },
  },
  {
    name: 'Compact', description: 'Less space everywhere, to fit more on a page',
    styles: { Normal: { spaceAfter: 4 }, Title: { spaceAfter: 6 }, [H(1)]: { spaceBefore: 10, spaceAfter: 4 }, [H(2)]: { spaceBefore: 8, spaceAfter: 3 }, [H(3)]: { spaceBefore: 6, spaceAfter: 2 }, Caption: { spaceAfter: 6 } },
  },
  {
    name: 'Open', description: 'Airier lines and paragraphs, easier to read on screen',
    styles: { Normal: { align: 'left', spaceAfter: 12, line: 1.25 }, [H(1)]: { size: 15, spaceBefore: 24, spaceAfter: 10 }, [H(2)]: { size: 13, spaceBefore: 18 }, Caption: { spaceAfter: 14 } },
  },
  {
    name: 'Thesis', description: 'Double-spaced text with indented first lines, as many graduate schools ask',
    styles: { Normal: { align: 'left', spaceAfter: 0, line: 2, firstLine: 36 }, Title: { size: 14, align: 'center', spaceAfter: 24 }, [H(1)]: { size: 14, align: 'center', spaceBefore: 24, spaceAfter: 12 }, [H(2)]: { size: 12, spaceBefore: 18 }, [H(3)]: { size: 12 }, Caption: { line: 1, spaceAfter: 12 } },
  },
];

/** Paragraph Spacing: the body text's space after and line spacing. */
export const PARA_SPACINGS: { name: string; spaceBefore: number; spaceAfter: number; line: number }[] = [
  { name: 'No Paragraph Space', spaceBefore: 0, spaceAfter: 0, line: 1 },
  { name: 'Compact', spaceBefore: 0, spaceAfter: 4, line: 1 },
  { name: 'Tight', spaceBefore: 0, spaceAfter: 6, line: 1.08 },
  { name: 'Open', spaceBefore: 0, spaceAfter: 10, line: 1.15 },
  { name: 'Relaxed', spaceBefore: 0, spaceAfter: 6, line: 1.5 },
  { name: 'Double', spaceBefore: 0, spaceAfter: 8, line: 2 },
];

const HEADINGS = (id: string) => /^(Title|Heading\d)$/.test(id);

/** The styles a theme's fonts and colours change: headings (and the title) take the heading font and colour; the rest the body font. */
function themed(s: NamedStyle, fonts?: ThemeFonts, colors?: ThemeColors): NamedStyle {
  const head = HEADINGS(s.id);
  let out = s;
  if (fonts) out = { ...out, font: head ? fonts.heading : fonts.body };
  if (colors) {
    const c = head ? colors.heading : colors.text;
    out = { ...out, color: c && c !== '#000000' ? c : undefined };
  }
  return out;
}

/** Apply each changed style, so the paragraphs in it follow. */
function withStyles(t: DocText, change: (s: NamedStyle) => NamedStyle): DocText {
  let out = t;
  for (const s of Object.values(t.styles)) {
    const next = change(s);
    if (JSON.stringify(next) !== JSON.stringify(s)) out = modifyStyle(out, next);
  }
  return out;
}

export function setThemeFonts(t: DocText, name: string): DocText {
  const f = THEME_FONTS.find((x) => x.name === name);
  if (!f) return t;
  return { ...withStyles(t, (s) => themed(s, f)), design: { ...t.design, fonts: name, theme: undefined } };
}

export function setThemeColors(t: DocText, name: string): DocText {
  const c = THEME_COLORS.find((x) => x.name === name);
  if (!c) return t;
  return { ...withStyles(t, (s) => themed(s, undefined, c)), design: { ...t.design, colors: name, theme: undefined } };
}

/** A whole theme: its fonts and its colours. */
export function setTheme(t: DocText, name: string): DocText {
  const th = THEMES.find((x) => x.name === name);
  if (!th) return t;
  const f = THEME_FONTS.find((x) => x.name === th.fonts), c = THEME_COLORS.find((x) => x.name === th.colors);
  return { ...withStyles(t, (s) => themed(s, f, c)), design: { ...t.design, theme: name, fonts: th.fonts, colors: th.colors } };
}

/**
 * A style set: the standard styles' sizes, bold and italic, alignment and spacing as the set
 * has them (from the standard look, so sets don't pile up), keeping the theme's fonts and colours.
 */
export function setStyleSet(t: DocText, name: string): DocText {
  const set = STYLE_SETS.find((x) => x.name === name);
  if (!set) return t;
  const base = defaultStyles();
  const out = withStyles(t, (s) => {
    const std = base[s.id];
    if (!std || s.custom) return s;
    const look = set.styles[s.id] ?? {};
    return { ...s, size: std.size, bold: std.bold, italic: std.italic, align: std.align, spaceBefore: std.spaceBefore, spaceAfter: std.spaceAfter, line: std.line, firstLine: std.firstLine, ...look };
  });
  return { ...out, design: { ...t.design, styleSet: name, spacing: undefined } };
}

/** Paragraph Spacing: the body text's (Normal's) spacing, or back to the style set's. */
export function setParaSpacing(t: DocText, name: string | null): DocText {
  if (name === null) {
    const set = STYLE_SETS.find((x) => x.name === (t.design?.styleSet ?? 'Journal')) ?? STYLE_SETS[0];
    const std = defaultStyles().Normal;
    const N = t.styles.Normal;
    if (!N) return t;
    const shape = set.styles.Normal ?? {};
    const out = modifyStyle(t, { ...N, spaceBefore: shape.spaceBefore ?? std.spaceBefore, spaceAfter: shape.spaceAfter ?? std.spaceAfter, line: shape.line ?? std.line });
    return { ...out, design: { ...t.design, spacing: undefined } };
  }
  const sp = PARA_SPACINGS.find((x) => x.name === name);
  const N = t.styles.Normal;
  if (!sp || !N) return t;
  const out = modifyStyle(t, { ...N, spaceBefore: sp.spaceBefore, spaceAfter: sp.spaceAfter, line: sp.line });
  return { ...out, design: { ...t.design, spacing: name } };
}

/** A document with every Design choice made again (Set as Default's look, on a new document). */
export function applyDesign(t: DocText, d: DocDesign | null | undefined): DocText {
  if (!d) return t;
  let out = t;
  if (d.styleSet) out = setStyleSet(out, d.styleSet);
  if (d.theme) out = setTheme(out, d.theme);
  if (d.fonts) out = setThemeFonts(out, d.fonts);
  if (d.colors) out = setThemeColors(out, d.colors);
  if (d.spacing) out = setParaSpacing(out, d.spacing);
  return { ...out, design: { ...d } };
}

/** The Design choices new documents start with (Design > Set as Default), from the settings. */
let defaultDesign: DocDesign | null = null;
export const newDocDesign = (): DocDesign | null => defaultDesign;
export function setNewDocDesign(d: DocDesign | null): void {
  defaultDesign = d && Object.keys(d).length ? { ...d } : null;
}

/** Design choices read from settings (anything unknown dropped). */
export function parseDesign(v: unknown): DocDesign | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const out: DocDesign = {};
  for (const k of ['theme', 'fonts', 'colors', 'styleSet', 'spacing'] as const) if (typeof o[k] === 'string') out[k] = o[k] as string;
  return Object.keys(out).length ? out : null;
}
