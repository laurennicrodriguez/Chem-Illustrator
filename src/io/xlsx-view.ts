// Excel's parts for the sheet finishing touches: turned text, how each sheet is viewed (Page
// Layout, Page Break Preview, gridlines, headings, zoom), the outline (summary rows' places),
// sparklines (the x14 extension Excel 2010 added to worksheets), custom views, and the workbook's
// theme (colours and fonts). All follow ECMA-376 part 1 and Microsoft's published [MS-XLSX]
// extensions.

import { xml, xmlAttr, hex6, kids, kid } from './ooxml';
import type { Sheet, Workbook } from '../sheet/workbook';
import type { SheetViewOpts, CustomView, CustomSheetView } from '../sheet/views';
import { SparklineGroup, SparkKind, SparkAxisLimit, SPARK_DEFAULTS, newSparkId } from '../sheet/sparklines';
import { WorkbookTheme, SCHEME_ELEMENTS, readThemeParts, DEFAULT_THEME, sameTheme } from '../sheet/themes';
import { cellName, quoteSheet } from '../sheet/refs';

const DML = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const X14_NS = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
export const XM_NS = 'http://schemas.microsoft.com/office/excel/2006/main';
/** The extension that holds a worksheet's sparklines. */
const SPARK_EXT = '{05C60535-1F16-4fd2-B633-F4F36F0B64E0}';

// ---------------------------------------------------------------- turned text

/** Our angle (anticlockwise, −90 to 90, or 255 stacked) as Excel's textRotation (91 to 180 are clockwise). */
export const textRotation = (r: number): number => (r === 255 ? 255 : r >= 0 ? Math.min(90, Math.round(r)) : 90 + Math.min(90, Math.round(-r)));
export function readTextRotation(v: string | null): number | undefined {
  const n = Number(v ?? 0);
  if (!n || !Number.isFinite(n)) return undefined;
  if (n === 255) return 255;
  return n <= 90 ? n : 90 - n;
}

// ---------------------------------------------------------------- sheet views

/** The attributes of a sheet's sheetView for its view settings. */
export function sheetViewAttrs(o: SheetViewOpts | null): string {
  if (!o) return '';
  return `${o.gridlines === false ? ' showGridLines="0"' : ''}${o.headings === false ? ' showRowColHeaders="0"' : ''}` +
    `${o.zeros === false ? ' showZeros="0"' : ''}${o.outlineSymbols === false ? ' showOutlineSymbols="0"' : ''}` +
    `${o.layout ? ` view="${o.layout}"` : ''}${o.zoom && o.zoom !== 100 ? ` zoomScale="${Math.round(o.zoom)}"${o.layout === 'pageLayout' ? ` zoomScalePageLayoutView="${Math.round(o.zoom)}"` : o.layout === 'pageBreakPreview' ? ` zoomScaleSheetLayoutView="${Math.round(o.zoom)}"` : ' zoomScaleNormal="' + Math.round(o.zoom) + '"'}` : ''}`;
}

export function readSheetViewOpts(v: Element | null): SheetViewOpts | null {
  if (!v) return null;
  const off = (name: string) => v.getAttribute(name) === '0' || v.getAttribute(name) === 'false';
  const view = v.getAttribute('view');
  const zoom = Number(v.getAttribute('zoomScale') ?? 100);
  const o: SheetViewOpts = {
    ...(view === 'pageLayout' || view === 'pageBreakPreview' ? { layout: view } : {}),
    ...(off('showGridLines') ? { gridlines: false as const } : {}),
    ...(off('showRowColHeaders') ? { headings: false as const } : {}),
    ...(off('showZeros') ? { zeros: false as const } : {}),
    ...(off('showOutlineSymbols') ? { outlineSymbols: false as const } : {}),
    ...(Number.isFinite(zoom) && zoom >= 10 && zoom <= 400 && zoom !== 100 ? { zoom } : {}),
  };
  return Object.keys(o).length ? o : null;
}

// ---------------------------------------------------------------- the outline

/** sheetPr's outlinePr, when the summary rows or columns aren't in Excel's default places. */
export function outlinePrXml(s: Sheet): string {
  const o = s.outline;
  if (!o?.summaryAbove && !o?.summaryLeft) return '';
  return `<outlinePr${o.summaryAbove ? ' summaryBelow="0"' : ''}${o.summaryLeft ? ' summaryRight="0"' : ''}/>`;
}

/** sheetFormatPr's attributes for the deepest outline levels. */
export function outlineLevelAttrs(s: Sheet): string {
  let rows = 0, cols = 0;
  for (const v of s.rowLevels.values()) rows = Math.max(rows, v);
  for (const v of s.colLevels.values()) cols = Math.max(cols, v);
  return `${rows ? ` outlineLevelRow="${rows}"` : ''}${cols ? ` outlineLevelCol="${cols}"` : ''}`;
}

/** A row's (or column's) outline attributes: its level, and collapsed on a summary row whose details are all hidden. */
export function outlineAttrs(levels: Map<number, number>, hidden: Map<number, true>, i: number, summaryBefore: boolean): string {
  const lv = levels.get(i) ?? 0;
  // the details are next to the summary: below it when summaries are above, else above it
  const d = summaryBefore ? i + 1 : i - 1;
  const dl = levels.get(d) ?? 0;
  const collapsed = dl > lv && hidden.has(d);
  return `${lv ? ` outlineLevel="${lv}"` : ''}${collapsed ? ' collapsed="1"' : ''}`;
}

// ---------------------------------------------------------------- sparklines

const sparkType = (k: SparkKind) => (k === 'column' ? ' type="column"' : k === 'winloss' ? ' type="stacked"' : '');
const qualified = (data: string, sheet: string) => (data.includes('!') ? data : `${quoteSheet(sheet)}!${data}`);

function axisAttrs(which: 'min' | 'max', a: SparkAxisLimit | undefined): string {
  if (a === undefined || a === 'each') return '';
  if (a === 'group') return ` ${which}AxisType="group"`;
  return ` ${which}AxisType="custom" manual${which === 'min' ? 'Min' : 'Max'}="${a}"`;
}

/** The worksheet's extension list holding its sparklines (empty when it has none). */
export function sparklinesExt(groups: SparklineGroup[], sheet: string): string {
  if (!groups.length) return '';
  const colour = (name: string, c: string | undefined) => (c ? `<x14:${name} rgb="FF${hex6(c)}"/>` : '');
  const body = groups.map((g) => {
    const flags = (['markers', 'high', 'low', 'first', 'last', 'negative'] as const).map((k) => (g[k] ? ` ${k}="1"` : '')).join('');
    return `<x14:sparklineGroup${g.weight && g.weight !== 0.75 ? ` lineWeight="${g.weight}"` : ''}${sparkType(g.kind)} displayEmptyCellsAs="${g.empty === 'zero' ? 'zero' : g.empty === 'span' ? 'span' : 'gap'}"${flags}` +
      `${g.axis ? ' displayXAxis="1"' : ''}${g.hidden ? ' displayHidden="1"' : ''}${axisAttrs('min', g.minAxis)}${axisAttrs('max', g.maxAxis)}${g.rtl ? ' rightToLeft="1"' : ''}>` +
      colour('colorSeries', g.color) + colour('colorNegative', g.negColor) + colour('colorAxis', g.axisColor ?? '#000000') + colour('colorMarkers', g.markerColor) +
      colour('colorFirst', g.firstColor) + colour('colorLast', g.lastColor) + colour('colorHigh', g.highColor) + colour('colorLow', g.lowColor) +
      `<x14:sparklines>${g.items.map((it) => `<x14:sparkline><xm:f>${xml(qualified(it.data, sheet))}</xm:f><xm:sqref>${cellName(it.row, it.col)}</xm:sqref></x14:sparkline>`).join('')}</x14:sparklines></x14:sparklineGroup>`;
  }).join('');
  return `<ext uri="${SPARK_EXT}" xmlns:x14="${X14_NS}"><x14:sparklineGroups xmlns:xm="${XM_NS}">${body}</x14:sparklineGroups></ext>`;
}

/** A worksheet's sparklines, from its extension list. References to its own sheet lose the sheet name. */
export function readSparklines(ws: Element, sheet: string, theme: (el: Element | null) => string | undefined): SparklineGroup[] {
  const out: SparklineGroup[] = [];
  for (const el of Array.from(ws.getElementsByTagNameNS(X14_NS, 'sparklineGroup'))) {
    const at = (n: string) => el.getAttribute(n);
    const on = (n: string) => at(n) === '1' || at(n) === 'true';
    const t = at('type');
    const kind: SparkKind = t === 'column' ? 'column' : t === 'stacked' ? 'winloss' : 'line';
    const col = (n: string, d: string) => theme(kidNS(el, n)) ?? d;
    const limit = (which: 'min' | 'max'): SparkAxisLimit | undefined => {
      const type = at(`${which}AxisType`);
      if (type === 'group') return 'group';
      if (type === 'custom') { const v = Number(at(which === 'min' ? 'manualMin' : 'manualMax')); return Number.isFinite(v) ? v : undefined; }
      return undefined;
    };
    const items = Array.from(el.getElementsByTagNameNS(X14_NS, 'sparkline')).flatMap((sp) => {
      const f = sp.getElementsByTagNameNS(XM_NS, 'f')[0]?.textContent?.trim() ?? '';
      const ref = sp.getElementsByTagNameNS(XM_NS, 'sqref')[0]?.textContent?.trim() ?? '';
      const m = /^([A-Z]+)(\d+)$/.exec(ref.replace(/\$/g, ''));
      if (!f || !m) return [];
      let c = 0;
      for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64;
      // the sparkline's own sheet needs no name
      const bang = f.lastIndexOf('!');
      const own = bang > 0 && f.slice(0, bang).replace(/^'(.*)'$/, '$1').replace(/''/g, "'").toLowerCase() === sheet.toLowerCase();
      return [{ row: Number(m[2]) - 1, col: c - 1, data: (own ? f.slice(bang + 1) : f).replace(/\$/g, '') }];
    });
    if (!items.length) continue;
    const empty = at('displayEmptyCellsAs');
    const weight = Number(at('lineWeight') ?? 0.75);
    out.push({
      id: newSparkId(), kind, items,
      color: col('colorSeries', SPARK_DEFAULTS.color), negColor: col('colorNegative', SPARK_DEFAULTS.negColor),
      markerColor: col('colorMarkers', SPARK_DEFAULTS.markerColor), highColor: col('colorHigh', SPARK_DEFAULTS.highColor),
      lowColor: col('colorLow', SPARK_DEFAULTS.lowColor), firstColor: col('colorFirst', SPARK_DEFAULTS.firstColor), lastColor: col('colorLast', SPARK_DEFAULTS.lastColor),
      ...(theme(kidNS(el, 'colorAxis')) && theme(kidNS(el, 'colorAxis')) !== '#000000' ? { axisColor: theme(kidNS(el, 'colorAxis')) } : {}),
      ...(on('markers') ? { markers: true } : {}), ...(on('high') ? { high: true } : {}), ...(on('low') ? { low: true } : {}),
      ...(on('first') ? { first: true } : {}), ...(on('last') ? { last: true } : {}), ...(on('negative') ? { negative: true } : {}),
      ...(on('displayXAxis') ? { axis: true } : {}), ...(on('displayHidden') ? { hidden: true } : {}), ...(on('rightToLeft') ? { rtl: true } : {}),
      ...(empty === 'zero' || empty === 'span' ? { empty } : {}),
      ...(Number.isFinite(weight) && weight !== 0.75 ? { weight } : {}),
      ...(limit('min') !== undefined ? { minAxis: limit('min') } : {}), ...(limit('max') !== undefined ? { maxAxis: limit('max') } : {}),
    });
  }
  return out;
}

const kidNS = (el: Element, name: string): Element | null => {
  for (const c of Array.from(el.children)) if (c.namespaceURI === X14_NS && c.localName === name) return c;
  return null;
};

// ---------------------------------------------------------------- custom views

const sheetIdOf = (wb: Workbook, name: string) => Math.max(1, wb.sheets.findIndex((s) => s.name.toLowerCase() === name.toLowerCase()) + 1);

/** The workbook's list of custom views (goes after calcPr). */
export function customWorkbookViewsXml(wb: Workbook): string {
  if (!wb.customViews.length) return '';
  return `<customWorkbookViews>${wb.customViews.map((v) => `<customWorkbookView name="${xmlAttr(v.name)}" guid="${v.guid}"${v.printSettings ? '' : ' includePrintSettings="0"'}${v.hiddenAndFilters ? '' : ' includeHiddenRowCol="0"'} windowWidth="1280" windowHeight="800" activeSheetId="${sheetIdOf(wb, v.activeSheet)}"/>`).join('')}</customWorkbookViews>`;
}

/** A sheet's part of each custom view (goes before mergeCells). Print settings and hidden rows are kept in our own part. */
export function customSheetViewsXml(wb: Workbook, s: Sheet): string {
  const mine = wb.customViews.flatMap((v) => v.sheets.filter((x) => x.sheet.toLowerCase() === s.name.toLowerCase()).map((x) => ({ v, x })));
  if (!mine.length) return '';
  return `<customSheetViews>${mine.map(({ v, x }) => {
    const o = x.view;
    const a = x.active ?? [0, 0];
    return `<customSheetView guid="${v.guid}"${o?.zoom && o.zoom !== 100 ? ` scale="${Math.round(o.zoom)}"` : ''}${o?.gridlines === false ? ' showGridLines="0"' : ''}${o?.headings === false ? ' showRowCol="0"' : ''}` +
      `${o?.outlineSymbols === false ? ' outlineSymbols="0"' : ''}${o?.zeros === false ? ' zeroValues="0"' : ''}${o?.layout ? ` view="${o.layout}"` : ''}` +
      `${x.hiddenRows.length ? ' hiddenRows="1"' : ''}${x.hiddenCols.length ? ' hiddenColumns="1"' : ''}${x.filter ? ' filter="1"' : ''}>` +
      `<selection activeCell="${cellName(a[0], a[1])}" sqref="${cellName(a[0], a[1])}"/></customSheetView>`;
  }).join('')}</customSheetViews>`;
}

/** Custom views as Excel saved them: the workbook's list, and each sheet's part. */
export function readCustomViews(root: Element, sheets: { name: string; ws: Element | null }[]): CustomView[] {
  const out: CustomView[] = [];
  for (const el of kids(kid(root, 'customWorkbookViews'), 'customWorkbookView')) {
    const guid = el.getAttribute('guid') ?? '';
    const name = el.getAttribute('name') ?? '';
    if (!guid || !name) continue;
    const activeId = Number(el.getAttribute('activeSheetId') ?? 1);
    const parts: CustomSheetView[] = [];
    for (const { name: sheet, ws } of sheets) {
      const sv = kids(kid(ws, 'customSheetViews'), 'customSheetView').find((x) => (x.getAttribute('guid') ?? '').toUpperCase() === guid.toUpperCase());
      if (!sv) continue;
      const off = (n: string) => sv.getAttribute(n) === '0' || sv.getAttribute(n) === 'false';
      const view = sv.getAttribute('view');
      const zoom = Number(sv.getAttribute('scale') ?? 100);
      const o: SheetViewOpts = {
        ...(view === 'pageLayout' || view === 'pageBreakPreview' ? { layout: view } : {}),
        ...(off('showGridLines') ? { gridlines: false as const } : {}),
        ...(off('showRowCol') ? { headings: false as const } : {}),
        ...(off('outlineSymbols') ? { outlineSymbols: false as const } : {}),
        ...(off('zeroValues') ? { zeros: false as const } : {}),
        ...(zoom !== 100 && zoom >= 10 && zoom <= 400 ? { zoom } : {}),
      };
      const cell = kid(sv, 'selection')?.getAttribute('activeCell') ?? 'A1';
      const m = /^([A-Z]+)(\d+)$/.exec(cell);
      let c = 0;
      for (const ch of m?.[1] ?? 'A') c = c * 26 + ch.charCodeAt(0) - 64;
      parts.push({ sheet, hiddenRows: [], hiddenCols: [], view: Object.keys(o).length ? o : null, active: [Number(m?.[2] ?? 1) - 1, c - 1] });
    }
    out.push({ name, guid, activeSheet: sheets[activeId - 1]?.name ?? sheets[0]?.name ?? '', printSettings: false, hiddenAndFilters: false, sheets: parts });
  }
  return out;
}

// ---------------------------------------------------------------- the theme

/** A theme part (xl/theme/theme1.xml): the colours, the two fonts, and the plain format scheme Office needs. */
export function themeXml(t: WorkbookTheme): string {
  const fmt = (inner: string) => `<a:solidFill><a:schemeClr val="phClr">${inner}</a:schemeClr></a:solidFill>`;
  const ln = (w: number) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;
  const clr = (el: string, c: string) => (el === 'dk1' || el === 'lt1')
    ? `<a:${el}><a:sysClr val="${el === 'dk1' ? 'windowText' : 'window'}" lastClr="${hex6(c)}"/></a:${el}>`
    : `<a:${el}><a:srgbClr val="${hex6(c)}"/></a:${el}>`;
  // Office wants the system colours only when they are black and white
  const scheme = SCHEME_ELEMENTS.map((el, i) => ((el === 'dk1' && t.colors[i] !== '#000000') || (el === 'lt1' && t.colors[i] !== '#ffffff')
    ? `<a:${el}><a:srgbClr val="${hex6(t.colors[i])}"/></a:${el}>` : clr(el, t.colors[i]))).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a:theme xmlns:a="${DML}" name="${xmlAttr(t.name)}"><a:themeElements>` +
    `<a:clrScheme name="${xmlAttr(t.name)}">${scheme}</a:clrScheme>` +
    `<a:fontScheme name="${xmlAttr(t.name)}"><a:majorFont><a:latin typeface="${xmlAttr(t.major)}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
    `<a:minorFont><a:latin typeface="${xmlAttr(t.minor)}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
    `<a:fmtScheme name="${xmlAttr(t.name)}"><a:fillStyleLst>${fmt('')}${fmt('<a:tint val="50000"/>')}${fmt('<a:shade val="80000"/>')}</a:fillStyleLst>` +
    `<a:lnStyleLst>${ln(6350)}${ln(12700)}${ln(19050)}</a:lnStyleLst>` +
    `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
    `<a:bgFillStyleLst>${fmt('')}${fmt('<a:tint val="95000"/>')}${fmt('<a:shade val="90000"/>')}</a:bgFillStyleLst></a:fmtScheme>` +
    `</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}

/** A workbook's theme from its theme part (null when it is Excel's default, or there is none). */
export function readWorkbookTheme(doc: Document | null): WorkbookTheme | null {
  if (!doc) return null;
  const scheme = doc.getElementsByTagNameNS(DML, 'clrScheme')[0];
  const colours = SCHEME_ELEMENTS.map((n) => {
    const c = scheme ? kid(scheme, n)?.firstElementChild : null;
    return c?.getAttribute('lastClr') ?? c?.getAttribute('val') ?? undefined;
  });
  const font = (which: string) => doc.getElementsByTagNameNS(DML, which)[0]?.getElementsByTagNameNS(DML, 'latin')[0]?.getAttribute('typeface') ?? undefined;
  const t = readThemeParts(colours, font('majorFont'), font('minorFont'), doc.documentElement.getAttribute('name') ?? undefined);
  // Office's own default goes by other names in some versions: the same colours and fonts are the default
  if (sameTheme({ ...t, name: DEFAULT_THEME.name }, DEFAULT_THEME)) return null;
  return t;
}
