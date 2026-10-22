// Home > Cell Styles: Excel's built-in styles (Good, Bad and Neutral; Title, Headings and Total;
// Input, Output, Calculation and the rest; the Accent colours; number formats), as the Office Open
// XML standard lists them (ECMA-376 part 1, 18.8.7 and its preset cell styles). Their colours
// come from the workbook's theme where Excel's do, so changing the theme changes them.
//
// A style sets the font, fill, borders and (for the number styles) number format of a cell, and
// leaves its alignment alone. The cell remembers the style's name, which goes to Excel as the
// cell's style (so Excel's gallery shows it picked).

import type { CellStyle, Border } from './workbook';
import { WorkbookTheme, themeOf, tintColour } from './themes';

export type CellStyleGroup = 'Good, Bad and Neutral' | 'Data and Model' | 'Titles and Headings' | 'Themed Cell Styles' | 'Number Format';

export interface CellStyleDef {
  name: string;
  /** Excel's number for a built-in style (cellStyle builtinId). */
  builtinId: number;
  group: CellStyleGroup;
  look: (t: WorkbookTheme) => Partial<CellStyle>;
}

const thin = (color: string): Border => ({ style: 'thin', color });
const all = (b: Border) => ({ top: b, right: b, bottom: b, left: b });

const accent = (n: number, pct: 0 | 20 | 40 | 60): CellStyleDef => ({
  name: pct ? `${pct}% - Accent${n}` : `Accent${n}`,
  builtinId: 29 + (n - 1) * 4 + [0, 20, 40, 60].indexOf(pct),
  group: 'Themed Cell Styles',
  look: (t) => {
    const a = t.colors[3 + n];
    return pct === 0 ? { fill: a, color: t.colors[1] } : { fill: tintColour(a, pct === 20 ? 0.8 : pct === 40 ? 0.6 : 0.4), color: pct === 60 ? t.colors[1] : t.colors[0] };
  },
});

export const CELL_STYLES: CellStyleDef[] = [
  { name: 'Normal', builtinId: 0, group: 'Good, Bad and Neutral', look: () => ({}) },
  { name: 'Bad', builtinId: 27, group: 'Good, Bad and Neutral', look: () => ({ fill: '#ffc7ce', color: '#9c0006' }) },
  { name: 'Good', builtinId: 26, group: 'Good, Bad and Neutral', look: () => ({ fill: '#c6efce', color: '#006100' }) },
  { name: 'Neutral', builtinId: 28, group: 'Good, Bad and Neutral', look: () => ({ fill: '#ffeb9c', color: '#9c5700' }) },
  { name: 'Calculation', builtinId: 22, group: 'Data and Model', look: () => ({ fill: '#f2f2f2', color: '#fa7d00', bold: true, borders: all(thin('#7f7f7f')) }) },
  { name: 'Check Cell', builtinId: 23, group: 'Data and Model', look: () => ({ fill: '#a5a5a5', color: '#ffffff', bold: true, borders: all({ style: 'double', color: '#3f3f3f' }) }) },
  { name: 'Explanatory Text', builtinId: 53, group: 'Data and Model', look: () => ({ italic: true, color: '#7f7f7f' }) },
  { name: 'Input', builtinId: 20, group: 'Data and Model', look: () => ({ fill: '#ffcc99', color: '#3f3f76', borders: all(thin('#7f7f7f')) }) },
  { name: 'Linked Cell', builtinId: 24, group: 'Data and Model', look: () => ({ color: '#fa7d00', borders: { bottom: { style: 'double', color: '#ff8001' } } }) },
  { name: 'Note', builtinId: 10, group: 'Data and Model', look: () => ({ fill: '#ffffcc', borders: all(thin('#b2b2b2')) }) },
  { name: 'Output', builtinId: 21, group: 'Data and Model', look: () => ({ fill: '#f2f2f2', color: '#3f3f3f', bold: true, borders: all(thin('#3f3f3f')) }) },
  { name: 'Warning Text', builtinId: 11, group: 'Data and Model', look: () => ({ color: '#ff0000' }) },
  { name: 'Heading 1', builtinId: 16, group: 'Titles and Headings', look: (t) => ({ bold: true, size: 15, color: t.colors[2], borders: { bottom: { style: 'thick', color: t.colors[4] } } }) },
  { name: 'Heading 2', builtinId: 17, group: 'Titles and Headings', look: (t) => ({ bold: true, size: 13, color: t.colors[2], borders: { bottom: { style: 'thick', color: tintColour(t.colors[4], 0.5) } } }) },
  { name: 'Heading 3', builtinId: 18, group: 'Titles and Headings', look: (t) => ({ bold: true, color: t.colors[2], borders: { bottom: { style: 'medium', color: tintColour(t.colors[4], 0.4) } } }) },
  { name: 'Heading 4', builtinId: 19, group: 'Titles and Headings', look: (t) => ({ bold: true, color: t.colors[2] }) },
  { name: 'Title', builtinId: 15, group: 'Titles and Headings', look: (t) => ({ size: 18, color: t.colors[2], font: t.major }) },
  { name: 'Total', builtinId: 25, group: 'Titles and Headings', look: (t) => ({ bold: true, borders: { top: thin(t.colors[4]), bottom: { style: 'double', color: t.colors[4] } } }) },
  ...[1, 2, 3, 4, 5, 6].flatMap((n) => ([20, 40, 60, 0] as const).map((p) => accent(n, p))),
  { name: 'Comma', builtinId: 3, group: 'Number Format', look: () => ({ numFmt: '#,##0.00' }) },
  { name: 'Comma [0]', builtinId: 6, group: 'Number Format', look: () => ({ numFmt: '#,##0' }) },
  { name: 'Currency', builtinId: 4, group: 'Number Format', look: () => ({ numFmt: '"$"#,##0.00' }) },
  { name: 'Currency [0]', builtinId: 7, group: 'Number Format', look: () => ({ numFmt: '"$"#,##0' }) },
  { name: 'Percent', builtinId: 5, group: 'Number Format', look: () => ({ numFmt: '0%' }) },
];

export const cellStyleNamed = (name: string | undefined): CellStyleDef | undefined => (name ? CELL_STYLES.find((d) => d.name.toLowerCase() === name.toLowerCase()) : undefined);

/** What a cell's formatting looks like with a style applied: its font, fill and borders replaced (number format too, for the number styles). */
export function cellStylePatch(name: string, theme: WorkbookTheme | null): Partial<CellStyle> {
  const def = cellStyleNamed(name);
  if (!def) return {};
  const look = def.look(themeOf(theme));
  // a number style changes only the number format, as in Excel
  if (def.group === 'Number Format') return { ...look, cellStyle: def.name };
  return {
    bold: look.bold, italic: look.italic, underline: undefined, color: look.color, fill: look.fill,
    font: look.font, size: look.size, borders: undefined, numFmt: undefined,
    cellStyle: def.name === 'Normal' ? undefined : def.name,
  };
}

/** The borders a style puts on (set after the rest, since patching borders merges sides). */
export function cellStyleBorders(name: string, theme: WorkbookTheme | null): CellStyle['borders'] {
  const def = cellStyleNamed(name);
  return def && def.group !== 'Number Format' ? def.look(themeOf(theme)).borders : undefined;
}
