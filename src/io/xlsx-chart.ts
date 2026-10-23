// Charts in Excel files, as the Office Open XML standard writes them (ECMA-376 part 1, 21.2:
// DrawingML charts): the chart part with its series, fitted lines (trendlines), error bars,
// axes and legend, and reading charts made in Excel back in. Each series keeps its cell
// references and a copy of its numbers (for programs that don't work them out).

import { xml, hex6, kid, kids, type Package } from './ooxml';
import type { Chart, ChartAxis, ChartKind, Series, SeriesData, SeriesFit, ErrorBars, MarkerShape, Bins, BoxOptions } from '../sheet/chart';
import { seenChartId, isChartEx, comboAs, onSecondAxis } from '../sheet/chart';
import type { FitKind } from '../sheet/fit';
import { textRuns } from '../render/chart-draw';

export const C_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
export const CT_CHART = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
export const REL_CHART = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart';
/** Excel 2016's newer charts (histogram, box and whisker…): their own part, and the namespace a program must know to show them. */
export const CX_NS = 'http://schemas.microsoft.com/office/drawing/2014/chartex';
export const CX1_NS = 'http://schemas.microsoft.com/office/drawing/2015/9/8/chartex';
export const CT_CHARTEX = 'application/vnd.ms-office.chartex+xml';
export const REL_CHARTEX = 'http://schemas.microsoft.com/office/2014/relationships/chartEx';
const CS_NS = 'http://schemas.microsoft.com/office/drawing/2012/chartStyle';
const CT_CHART_STYLE = 'application/vnd.ms-office.chartstyle+xml';
const CT_CHART_COLORS = 'application/vnd.ms-office.chartcolorstyle+xml';
const REL_CHART_STYLE = 'http://schemas.microsoft.com/office/2011/relationships/chartStyle';
const REL_CHART_COLORS = 'http://schemas.microsoft.com/office/2011/relationships/chartColorStyle';

/** The parts of a chart's look ([MS-ODRAWXML] 2.3.4.2), each with every entry the schema asks for, in its order. */
const STYLE_ENTRIES = ['axisTitle', 'categoryAxis', 'chartArea', 'dataLabel', 'dataPoint', 'dataPoint3D', 'dataPointLine', 'dataPointMarker',
  'dataPointWireframe', 'dataTable', 'downBar', 'dropLine', 'errorBar', 'floor', 'gridlineMajor', 'gridlineMinor', 'hiLoLine', 'leaderLine',
  'legend', 'plotArea', 'plotArea3D', 'seriesAxis', 'seriesLine', 'title', 'trendline', 'trendlineLabel', 'upBar', 'valueAxis', 'wall'];

/** A plain chart style part: the chart's own formatting says how it looks, so every entry only points at the theme. */
function chartStyleXml(): string {
  const entry = (tag: string) => `<cs:${tag}><cs:lnRef idx="0"/><cs:fillRef idx="0"/><cs:effectRef idx="0"/><cs:fontRef idx="minor"><a:schemeClr val="tx1"/></cs:fontRef></cs:${tag}>`;
  return `<cs:chartStyle xmlns:cs="${CS_NS}" xmlns:a="${A_NS}" id="201">${STYLE_ENTRIES.map(entry).join('')}</cs:chartStyle>`;
}

/** A chart colour part: the theme's six accents in turn, then lighter and darker turns of them. */
function chartColorsXml(): string {
  const accents = [1, 2, 3, 4, 5, 6].map((i) => `<a:schemeClr val="accent${i}"/>`).join('');
  const turns = [[], [60000], [80000, 20000], [80000], [60000, 40000], [50000]]
    .map(([mod, off]) => `<cs:variation>${mod ? `<a:lumMod val="${mod}"/>` : ''}${off ? `<a:lumOff val="${off}"/>` : ''}</cs:variation>`).join('');
  return `<cs:colorStyle xmlns:cs="${CS_NS}" xmlns:a="${A_NS}" meth="cycle" id="10">${accents}${turns}</cs:colorStyle>`;
}

/**
 * Give a newer chart part (chartEx) its style and colour parts, beside it as style`n`.xml and
 * colors`n`.xml. Office writes them with every chartEx and asks to repair a file whose chartEx
 * has none (Word won't open it at all).
 */
export function addChartExStyle(pkg: Package, chartPath: string, n: number): void {
  const dir = chartPath.split('/').slice(0, -1).join('/');
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  pkg.add(`${dir}/style${n}.xml`, head + chartStyleXml(), CT_CHART_STYLE);
  pkg.add(`${dir}/colors${n}.xml`, head + chartColorsXml(), CT_CHART_COLORS);
  pkg.relate(chartPath, REL_CHART_STYLE, `style${n}.xml`);
  pkg.relate(chartPath, REL_CHART_COLORS, `colors${n}.xml`);
}

// ---------------------------------------------------------------- writing

const v = (tag: string, val: string | number | boolean) => `<c:${tag} val="${typeof val === 'boolean' ? (val ? 1 : 0) : xml(String(val))}"/>`;
const ref = (t: string | undefined) => (t ?? '').replace(/^=/, '');
const fill = (c: string) => `<a:solidFill><a:srgbClr val="${hex6(c)}"/></a:solidFill>`;
const DASH: Record<string, string> = { dash: 'dash', dot: 'sysDot' };

/** Text with k_{obs} and s^{-1} as runs set lower and higher (as Excel's own sub- and superscripts). */
function richText(text: string, sizePt: number, bold = false): string {
  const runs = textRuns(text).map((r) => {
    const base = r.pos === 'sub' ? ' baseline="-25000"' : r.pos === 'sup' ? ' baseline="30000"' : '';
    return `<a:r><a:rPr lang="en-US" sz="${Math.round(sizePt * 100)}" b="${bold ? 1 : 0}"${base}/><a:t>${xml(r.t)}</a:t></a:r>`;
  }).join('');
  return `<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${Math.round(sizePt * 100)}" b="${bold ? 1 : 0}"/></a:pPr>${runs}</a:p></c:rich></c:tx>`;
}

const titleXml = (text: string | undefined, sizePt: number, bold = false) => (text ? `<c:title>${richText(text, sizePt, bold)}<c:overlay val="0"/></c:title>` : '');

function numRef(f: string | undefined, values: number[]): string {
  const pts = values.map((x, i) => (Number.isFinite(x) ? `<c:pt idx="${i}"><c:v>${x}</c:v></c:pt>` : '')).join('');
  const cache = `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${pts}</c:numCache>`;
  return f ? `<c:numRef><c:f>${xml(ref(f))}</c:f>${cache}</c:numRef>` : `<c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${pts}</c:numLit>`;
}

function strRef(f: string, values: string[]): string {
  const pts = values.map((x, i) => `<c:pt idx="${i}"><c:v>${xml(x)}</c:v></c:pt>`).join('');
  return `<c:strRef><c:f>${xml(ref(f))}</c:f><c:strCache><c:ptCount val="${values.length}"/>${pts}</c:strCache></c:strRef>`;
}

const FIT_TYPE: Record<FitKind, [string, number?]> = { linear: ['linear'], poly2: ['poly', 2], poly3: ['poly', 3], exp: ['exp'], log: ['log'], power: ['power'] };

function trendlineXml(f: SeriesFit, color: string): string {
  const [type, order] = FIT_TYPE[f.kind];
  return `<c:trendline><c:spPr><a:ln w="19050" cap="rnd">${fill(f.color ?? color)}<a:prstDash val="sysDash"/></a:ln></c:spPr>` +
    `${v('trendlineType', type)}${order ? v('order', order) : ''}` +
    `${f.forward ? v('forward', f.forward) : ''}${f.backward ? v('backward', f.backward) : ''}${f.intercept !== undefined ? v('intercept', f.intercept) : ''}` +
    `${v('dispRSqr', !!f.showR2)}${v('dispEq', !!f.showEq)}` +
    (f.showEq || f.showR2 ? `<c:trendlineLbl><c:numFmt formatCode="General" sourceLinked="0"/></c:trendlineLbl>` : '') +
    `</c:trendline>`;
}

function errBarsXml(e: ErrorBars, scatter: boolean): string {
  const type = e.kind === 'fixed' ? 'fixedVal' : e.kind === 'percent' ? 'percentage' : e.kind === 'stdev' ? 'stdDev' : 'cust';
  const custom = e.kind === 'cells' && e.plus
    ? `<c:plus><c:numRef><c:f>${xml(ref(e.plus))}</c:f></c:numRef></c:plus><c:minus><c:numRef><c:f>${xml(ref(e.minus ?? e.plus))}</c:f></c:numRef></c:minus>`
    : '';
  return `<c:errBars>${scatter ? v('errDir', 'y') : ''}${v('errBarType', 'both')}${v('errValType', type)}${v('noEndCap', false)}${custom}` +
    `${e.kind !== 'cells' ? v('val', e.value ?? (e.kind === 'percent' ? 5 : 1)) : ''}<c:spPr><a:ln w="9525">${fill('#404040')}</a:ln></c:spPr></c:errBars>`;
}

/**
 * A mass spectrum's sticks, as Excel draws them: error bars from each point to zero (minus 100 %
 * of the value, which Excel takes with its sign, so peaks below zero run up to it), with no caps,
 * in the series' colour.
 */
function sticksXml(color: string, width: number): string {
  return `<c:errBars>${v('errDir', 'y')}${v('errBarType', 'minus')}${v('errValType', 'percentage')}${v('noEndCap', true)}${v('val', 100)}` +
    `<c:spPr><a:ln w="${Math.round(width * 9525)}" cap="flat">${fill(color)}</a:ln></c:spPr></c:errBars>`;
}

const MARKER_NAME: Record<MarkerShape, string> = { circle: 'circle', square: 'square', diamond: 'diamond', triangle: 'triangle', cross: 'x', none: 'none' };

function axisXml(kind: 'cat' | 'val', id: number, cross: number, pos: string, a: ChartAxis, deleteIt: boolean, grid: boolean, crossBetween?: string, labelsLow = false, crosses = 'autoZero'): string {
  const scaling = `<c:scaling>${a.log ? v('logBase', 10) : ''}${v('orientation', a.reverse ? 'maxMin' : 'minMax')}${kind === 'val' && a.max !== undefined ? v('max', a.max) : ''}${kind === 'val' && a.min !== undefined ? v('min', a.min) : ''}</c:scaling>`;
  const gridXml = grid ? `<c:majorGridlines><c:spPr><a:ln w="9525">${fill('#d9d9d9')}</a:ln></c:spPr></c:majorGridlines>` : '';
  const fmt = `<c:numFmt formatCode="${xml(a.numFmt ?? 'General')}" sourceLinked="${a.numFmt ? 0 : 1}"/>`;
  const common = `${v('axId', id)}${scaling}${v('delete', deleteIt)}${v('axPos', pos)}${gridXml}${titleXml(a.title, 10)}${fmt}` +
    `${v('majorTickMark', 'out')}${v('minorTickMark', 'none')}${v('tickLblPos', labelsLow ? 'low' : 'nextTo')}<c:spPr><a:ln w="9525">${fill('#bfbfbf')}</a:ln></c:spPr>${v('crossAx', cross)}${v('crosses', crosses)}`;
  if (kind === 'cat') return `<c:catAx>${common}${v('auto', true)}${v('lblAlgn', 'ctr')}${v('lblOffset', 100)}${v('noMultiLvlLbl', false)}</c:catAx>`;
  return `<c:valAx>${common}${crossBetween ? v('crossBetween', crossBetween) : ''}${a.step ? v('majorUnit', a.step) : ''}</c:valAx>`;
}

/** How a series is written: the kind of chart group it goes in. */
type SerKind = 'scatter' | 'line' | 'column' | 'bar' | 'area' | 'pie' | 'bubble' | 'radar';

/** One series, as the chart group of its kind takes it (ECMA-376 21.2.2: each group's series has its own order of parts). */
function serXml(c: Chart, s: Series, i: number, d: SeriesData | undefined, kind: SerKind): string {
  const scatter = kind === 'scatter', pie = kind === 'pie', bubble = kind === 'bubble', radar = kind === 'radar';
  const color = d?.color ?? '#4472c4';
  const name = s.name?.startsWith('=') ? `<c:tx>${strRef(s.name, [d?.name ?? ''])}</c:tx>` : s.name ? `<c:tx><c:v>${xml(s.name)}</c:v></c:tx>` : '';
  const lineOn = kind === 'line' || (radar && !c.filled) ? s.line !== false : !!s.line;
  const lineLike = scatter || kind === 'line' || (radar && !c.filled);
  const sp = pie ? '' : lineLike
    ? `<c:spPr>${lineOn ? `<a:ln w="${Math.round((s.lineWidth ?? 2) * 9525)}" cap="rnd">${fill(color)}${s.dash && s.dash !== 'solid' ? `<a:prstDash val="${DASH[s.dash]}"/>` : ''}<a:round/></a:ln>` : '<a:ln w="19050"><a:noFill/></a:ln>'}</c:spPr>`
    : bubble ? `<c:spPr><a:solidFill><a:srgbClr val="${hex6(color)}"><a:alpha val="75000"/></a:srgbClr></a:solidFill><a:ln w="9525">${fill(color)}</a:ln></c:spPr>`
      : `<c:spPr>${fill(color)}</c:spPr>`;
  const sticks = scatter && !!s.sticks;
  const markerShape = s.marker ?? (scatter && !sticks ? 'circle' : 'none');
  const marker = lineLike ? `<c:marker>${v('symbol', MARKER_NAME[markerShape])}${markerShape !== 'none' ? `${v('size', Math.max(2, Math.min(72, Math.round((s.markerSize ?? 7) * 0.75))))}<c:spPr>${fill(color)}<a:ln w="9525">${fill(color)}</a:ln></c:spPr>` : ''}</c:marker>` : '';
  const showX = scatter && !!s.labelX;
  const lblFmt = s.labelFmt ? `<c:numFmt formatCode="${xml(s.labelFmt)}" sourceLinked="0"/>` : '';
  // labels of peaks drawn downwards go under them
  const below = sticks && (d?.ys ?? []).some((y) => y < 0) && !(d?.ys ?? []).some((y) => y > 0);
  const dLbls = s.labels ? `<c:dLbls>${lblFmt}${showX || sticks ? v('dLblPos', below ? 'b' : 't') : ''}${v('showLegendKey', false)}${v('showVal', !pie && !showX)}${v('showCatName', showX)}${v('showSerName', false)}${v('showPercent', pie)}${v('showBubbleSize', false)}</c:dLbls>` : '';
  const trend = s.fit && !pie && !radar ? trendlineXml(s.fit, color) : '';
  const errs = sticks ? sticksXml(color, s.lineWidth ?? 1.5) : s.errors && !pie && !radar ? errBarsXml(s.errors, scatter || bubble) : '';
  const xs = d?.xs ?? [], ys = d?.ys ?? [];
  const catNumbers = s.x && d ? d.cats.every((t) => t === '' || Number.isFinite(Number(t))) : false;
  const cat = s.x ? (scatter || bubble || catNumbers ? numRef(s.x, xs) : strRef(s.x, d?.cats ?? [])) : '';
  const head = `${v('idx', i)}${v('order', i)}${name}${sp}`;
  if (bubble) {
    const sizes = `<c:bubbleSize>${numRef(s.size, d?.sizes ?? ys.map(() => 1))}</c:bubbleSize>`;
    return `<c:ser>${head}${v('invertIfNegative', false)}${dLbls}${trend}${errs}${cat ? `<c:xVal>${cat}</c:xVal>` : ''}<c:yVal>${numRef(s.y, ys)}</c:yVal>${sizes}${v('bubble3D', false)}</c:ser>`;
  }
  const xy = scatter
    ? `${cat ? `<c:xVal>${cat}</c:xVal>` : ''}<c:yVal>${numRef(s.y, ys)}</c:yVal>${v('smooth', !!s.smooth)}`
    : `${cat ? `<c:cat>${cat}</c:cat>` : ''}<c:val>${numRef(s.y, ys)}</c:val>${kind === 'line' ? v('smooth', !!s.smooth) : ''}`;
  if (kind === 'column' || kind === 'bar') return `<c:ser>${head}${v('invertIfNegative', false)}${dLbls}${trend}${errs}${xy}</c:ser>`;
  if (kind === 'area') return `<c:ser>${head}${dLbls}${trend}${errs}${xy}</c:ser>`;
  if (pie) return `<c:ser>${head}${dLbls}${xy}</c:ser>`;
  if (radar) return `<c:ser>${head}${marker}${dLbls}${xy}</c:ser>`;
  return `<c:ser>${head}${marker}${dLbls}${trend}${errs}${xy}</c:ser>`;
}

/** The chart part of a chart, with a copy of its numbers. */
export function chartXml(c: Chart, data: SeriesData[]): string {
  if (isChartEx(c.kind)) return chartExXml(c, data);
  const sizePt = (c.fontSize ?? 12) * 0.75;
  const all = (k: SerKind) => c.series.map((s, i) => serXml(c, s, i, data[i], k)).join('');
  const grouping = c.stacked ? 'stacked' : c.kind === 'column' || c.kind === 'bar' ? 'clustered' : 'standard';
  const ax = `${v('axId', 101)}${v('axId', 102)}`;
  let plot = '';
  switch (c.kind) {
    case 'scatter': case 'bubble': {
      const group = c.kind === 'scatter'
        ? `<c:scatterChart>${v('scatterStyle', 'lineMarker')}${v('varyColors', false)}${all('scatter')}${ax}</c:scatterChart>`
        : `<c:bubbleChart>${v('varyColors', false)}${all('bubble')}${v('bubbleScale', 100)}${v('showNegBubbles', false)}${ax}</c:bubbleChart>`;
      plot = group + axisXml('val', 101, 102, 'b', c.x, false, !!c.x.grid, 'midCat', true) + axisXml('val', 102, 101, 'l', c.y, false, c.y.grid !== false, 'midCat');
      break;
    }
    case 'line': case 'area':
      plot = `<c:${c.kind}Chart>${v('grouping', grouping)}${v('varyColors', false)}${all(c.kind)}${c.kind === 'line' ? v('marker', true) : ''}${ax}</c:${c.kind}Chart>` +
        axisXml('cat', 101, 102, 'b', c.x, false, !!c.x.grid) + axisXml('val', 102, 101, 'l', c.y, false, c.y.grid !== false, c.kind === 'area' ? 'midCat' : 'between');
      break;
    case 'radar':
      plot = `<c:radarChart>${v('radarStyle', c.filled ? 'filled' : 'marker')}${v('varyColors', false)}${all('radar')}${ax}</c:radarChart>` +
        axisXml('cat', 101, 102, 'b', c.x, false, true) + axisXml('val', 102, 101, 'l', c.y, false, c.y.grid !== false, 'between');
      break;
    case 'column': case 'bar': {
      const bar = c.kind === 'bar';
      // a bar chart's categories run down its left side: they are its "y" axis here
      plot = `<c:barChart>${v('barDir', bar ? 'bar' : 'col')}${v('grouping', grouping)}${v('varyColors', false)}${all(c.kind)}${v('gapWidth', 80)}${c.stacked ? v('overlap', 100) : ''}${ax}</c:barChart>` +
        axisXml('cat', 101, 102, bar ? 'l' : 'b', bar ? c.y : c.x, false, bar ? !!c.y.grid : !!c.x.grid) +
        axisXml('val', 102, 101, bar ? 'b' : 'l', bar ? c.x : c.y, false, bar ? c.x.grid !== false : c.y.grid !== false, 'between');
      break;
    }
    case 'combo': {
      // a group of columns and a group of lines on each axis used; the second axis's categories are hidden
      const groups: string[] = [];
      for (const right of [false, true]) {
        const ids = right ? `${v('axId', 103)}${v('axId', 104)}` : ax;
        const pick = (as: 'column' | 'line') => c.series.map((s, i) => (comboAs(s, i) === as && onSecondAxis(s, i) === right ? serXml(c, s, i, data[i], as) : '')).join('');
        const cols = pick('column'), lines = pick('line');
        if (cols) groups.push(`<c:barChart>${v('barDir', 'col')}${v('grouping', 'clustered')}${v('varyColors', false)}${cols}${v('gapWidth', 80)}${ids}</c:barChart>`);
        if (lines) groups.push(`<c:lineChart>${v('grouping', 'standard')}${v('varyColors', false)}${lines}${v('marker', true)}${ids}</c:lineChart>`);
      }
      const second = c.series.some((s, i) => onSecondAxis(s, i));
      plot = groups.join('') + axisXml('cat', 101, 102, 'b', c.x, false, !!c.x.grid) + axisXml('val', 102, 101, 'l', c.y, false, c.y.grid !== false, 'between') +
        (second ? axisXml('cat', 103, 104, 'b', {}, true, false) + axisXml('val', 104, 103, 'r', c.y2 ?? {}, false, !!c.y2?.grid, 'between', false, 'max') : '');
      break;
    }
    case 'pie':
      plot = `<c:pieChart>${v('varyColors', true)}${all('pie')}${v('firstSliceAng', 0)}</c:pieChart>`;
      break;
  }
  const legend = c.legend === 'none' ? '' : `<c:legend>${v('legendPos', c.legend === 'right' ? 'r' : c.legend === 'top' ? 't' : 'b')}${v('overlay', false)}</c:legend>`;
  const bg = c.background === 'none' ? '<a:noFill/>' : fill(c.background ?? '#ffffff');
  const border = c.border === false ? '<a:ln><a:noFill/></a:ln>' : `<a:ln w="9525">${fill('#d9d9d9')}</a:ln>`;
  return `<c:chartSpace xmlns:c="${C_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}">${v('roundedCorners', false)}` +
    `<c:chart>${titleXml(c.title, sizePt * 1.4)}${v('autoTitleDeleted', !c.title)}<c:plotArea><c:layout/>${plot}</c:plotArea>${legend}` +
    `${v('plotVisOnly', !c.showHidden)}${v('dispBlanksAs', 'gap')}</c:chart>` +
    `<c:spPr>${bg}${border}</c:spPr>` +
    `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${Math.round(sizePt * 100)}"><a:solidFill><a:srgbClr val="404040"/></a:solidFill>${c.font ? `<a:latin typeface="${xml(c.font)}"/>` : ''}</a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>` +
    `</c:chartSpace>`;
}

// ---------------------------------------------------------------- Excel 2016's newer charts

/** Text with sub- and superscripts, in a newer chart's own form. */
function richEx(text: string, sizePt: number): string {
  const runs = textRuns(text).map((r) => {
    const base = r.pos === 'sub' ? ' baseline="-25000"' : r.pos === 'sup' ? ' baseline="30000"' : '';
    return `<a:r><a:rPr lang="en-US" sz="${Math.round(sizePt * 100)}" b="0"${base}/><a:t>${xml(r.t)}</a:t></a:r>`;
  }).join('');
  return `<cx:tx><cx:rich><a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" vert="horz" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr" anchorCtr="1"/><a:lstStyle/><a:p><a:pPr algn="ctr"><a:defRPr sz="${Math.round(sizePt * 100)}" b="0"/></a:pPr>${runs}</a:p></cx:rich></cx:tx>`;
}

const exNum = (x: number | undefined) => (x === undefined || !Number.isFinite(x) ? undefined : String(x));
const exAttrs = (o: Record<string, string | undefined>) => Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => ` ${k}="${xml(x!)}"`).join('');

/**
 * A histogram or box and whisker chart, as Excel 2016 and later keep them (the chartEx part): the
 * numbers of each series as a block of data with its reference, the series with how they are
 * binned or what of the boxes is shown, and the axes.
 */
export function chartExXml(c: Chart, data: SeriesData[]): string {
  const sizePt = (c.fontSize ?? 12) * 0.75;
  const hist = c.kind === 'histogram';
  const series = hist ? c.series.slice(0, 1) : c.series;
  const blocks = series.map((s, i) => {
    const d = data[i];
    const ys = d?.ys ?? [];
    const pts = ys.map((y, j) => (Number.isFinite(y) ? `<cx:pt idx="${j}">${y}</cx:pt>` : '')).join('');
    const cats = s.x && !hist ? `<cx:strDim type="cat"><cx:f>${xml(ref(s.x))}</cx:f><cx:lvl ptCount="${d?.cats.length ?? 0}">${(d?.cats ?? []).map((t, j) => `<cx:pt idx="${j}">${xml(t)}</cx:pt>`).join('')}</cx:lvl></cx:strDim>` : '';
    return `<cx:data id="${i}">${cats}<cx:numDim type="val"><cx:f>${xml(ref(s.y))}</cx:f><cx:lvl ptCount="${ys.length}" formatCode="General">${pts}</cx:lvl></cx:numDim></cx:data>`;
  }).join('');
  const o = c.boxes ?? {}, b = c.bins ?? {};
  const sers = series.map((s, i) => {
    const d = data[i];
    const name = s.name?.startsWith('=') ? `<cx:tx><cx:txData><cx:f>${xml(ref(s.name))}</cx:f><cx:v>${xml(d?.name ?? '')}</cx:v></cx:txData></cx:tx>`
      : s.name ? `<cx:tx><cx:txData><cx:v>${xml(s.name)}</cx:v></cx:txData></cx:tx>` : '';
    const sp = `<cx:spPr>${hist ? fill(d?.color ?? '#4472c4') : `<a:solidFill><a:srgbClr val="${hex6(d?.color ?? '#4472c4')}"><a:alpha val="30000"/></a:srgbClr></a:solidFill>`}<a:ln w="${hist ? 9525 : 15875}">${fill(hist ? '#ffffff' : d?.color ?? '#4472c4')}</a:ln></cx:spPr>`;
    const labels = s.labels ? `<cx:dataLabels pos="outEnd"><cx:visibility seriesName="0" categoryName="0" value="1"/></cx:dataLabels>` : '';
    const layout = hist
      ? `<cx:binning intervalClosed="r"${exAttrs({ underflow: exNum(b.underflow), overflow: exNum(b.overflow) })}>${b.width ? `<cx:binSize val="${b.width}"/>` : b.count ? `<cx:binCount val="${Math.round(b.count)}"/>` : ''}</cx:binning>`
      : `<cx:visibility meanLine="${o.meanLine ? 1 : 0}" meanMarker="${o.mean === false ? 0 : 1}" nonoutliers="${o.points ? 1 : 0}" outliers="${o.outliers === false ? 0 : 1}"/><cx:statistics quartileMethod="${o.quartiles ?? 'exclusive'}"/>`;
    const uid = `{${(c.id >>> 0).toString(16).padStart(8, '0')}-0000-4000-8000-${i.toString(16).padStart(12, '0')}}`;
    return `<cx:series layoutId="${hist ? 'clusteredColumn' : 'boxWhisker'}" uniqueId="${uid}" formatIdx="${i}">${name}${sp}${labels}<cx:dataId val="${i}"/><cx:layoutPr>${layout}</cx:layoutPr></cx:series>`;
  }).join('');
  // the chart's title has a place; an axis title has none ([MS-ODRAWXML] CT_AxisTitle), and Office won't open one that does
  const title = (t: string | undefined, size: number) => (t ? `<cx:title pos="t" align="ctr" overlay="0">${richEx(t, size)}</cx:title>` : '');
  const axisTitle = (t: string | undefined) => (t ? `<cx:title>${richEx(t, 10)}</cx:title>` : '');
  const gridEx = (on: boolean) => (on ? `<cx:majorGridlines><cx:spPr><a:ln w="9525">${fill('#d9d9d9')}</a:ln></cx:spPr></cx:majorGridlines>` : '');
  const numFmt = (a: ChartAxis) => (a.numFmt ? `<cx:numFmt formatCode="${xml(a.numFmt)}" sourceLinked="0"/>` : '');
  const axes = `<cx:axis id="0"><cx:catScaling${hist ? ' gapWidth="0"' : ' gapWidth="1"'}/>${axisTitle(c.x.title)}${gridEx(!!c.x.grid)}<cx:tickLabels/></cx:axis>` +
    `<cx:axis id="1"><cx:valScaling${exAttrs({ max: exNum(c.y.max), min: exNum(c.y.min), majorUnit: exNum(c.y.step) })}/>${axisTitle(c.y.title)}${gridEx(c.y.grid !== false)}<cx:tickLabels/>${numFmt(c.y)}</cx:axis>`;
  const legend = c.legend === 'none' ? '' : `<cx:legend pos="${c.legend === 'right' ? 'r' : c.legend === 'top' ? 't' : 'b'}" align="ctr" overlay="0"/>`;
  const bg = c.background === 'none' ? '<a:noFill/>' : fill(c.background ?? '#ffffff');
  const border = c.border === false ? '<a:ln><a:noFill/></a:ln>' : `<a:ln w="9525">${fill('#d9d9d9')}</a:ln>`;
  return `<cx:chartSpace xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:cx="${CX_NS}">` +
    `<cx:chartData>${blocks}</cx:chartData>` +
    `<cx:chart>${title(c.title, sizePt * 1.4)}<cx:plotArea><cx:plotAreaRegion>${sers}</cx:plotAreaRegion>${axes}</cx:plotArea>${legend}</cx:chart>` +
    `<cx:spPr>${bg}${border}</cx:spPr>` +
    `<cx:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${Math.round(sizePt * 100)}"><a:solidFill><a:srgbClr val="404040"/></a:solidFill>${c.font ? `<a:latin typeface="${xml(c.font)}"/>` : ''}</a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></cx:txPr>` +
    `</cx:chartSpace>`;
}

/** Read a histogram or box and whisker chart from Excel 2016's newer chart part; null for the kinds this can't show (treemaps, maps…). */
export function readChartExXml(doc: Document, at: Chart['at'], w: number, h: number, id: number): { chart: Chart; partial: boolean } | null {
  const root = doc.documentElement;
  const blocks = new Map<string, { y?: string; x?: string }>();
  for (const d of kids(kid(root, 'chartData'), 'data')) {
    const f = (dim: string, type: string) => kids(d, dim).find((e) => e.getAttribute('type') === type);
    blocks.set(d.getAttribute('id') ?? '', { y: kid(f('numDim', 'val') ?? null, 'f')?.textContent ?? undefined, x: kid(f('strDim', 'cat') ?? f('numDim', 'cat') ?? null, 'f')?.textContent ?? undefined });
  }
  const ch = kid(root, 'chart');
  const plot = kid(ch, 'plotArea');
  const sers = kids(kid(plot, 'plotAreaRegion'), 'series');
  const layout = (e: Element) => e.getAttribute('layoutId') ?? '';
  let kind: ChartKind | null = null;
  if (sers.some((e) => layout(e) === 'boxWhisker')) kind = 'box';
  else if (sers.some((e) => layout(e) === 'clusteredColumn' && kid(e, 'layoutPr', 'binning'))) kind = 'histogram';
  if (!kind) return null;
  const mine = sers.filter((e) => layout(e) === (kind === 'box' ? 'boxWhisker' : 'clusteredColumn'));
  const series: Series[] = [];
  const chart: Chart = { id, kind, series, x: {}, y: {}, legend: 'none', at, w: Math.max(80, Math.round(w)), h: Math.max(80, Math.round(h)) };
  for (const e of mine) {
    const blk = blocks.get(kid(e, 'dataId')?.getAttribute('val') ?? '');
    if (!blk?.y) continue;
    const s: Series = { y: `=${blk.y}` };
    if (blk.x && kind === 'box') s.x = `=${blk.x}`;
    const txd = kid(e, 'tx', 'txData');
    const nf = kid(txd, 'f')?.textContent;
    if (nf) s.name = `=${nf}`;
    else if (kid(txd, 'v')?.textContent) s.name = kid(txd, 'v')!.textContent!;
    const sp = kid(e, 'spPr');
    const col = colourIn(sp && kids(sp).find((x) => x.localName === 'solidFill') ? sp : null);
    if (col) s.color = col;
    if (kid(e, 'dataLabels', 'visibility')?.getAttribute('value') === '1') s.labels = true;
    const lp = kid(e, 'layoutPr');
    if (kind === 'histogram') {
      const bn = kid(lp, 'binning');
      const bins: Bins = {};
      const size = Number(kid(bn, 'binSize')?.getAttribute('val')), count = Number(kid(bn, 'binCount')?.getAttribute('val'));
      if (size > 0) bins.width = size; else if (count > 0) bins.count = count;
      const under = Number(bn?.getAttribute('underflow') ?? NaN), over = Number(bn?.getAttribute('overflow') ?? NaN);
      if (Number.isFinite(under)) bins.underflow = under;
      if (Number.isFinite(over)) bins.overflow = over;
      if (Object.keys(bins).length) chart.bins = bins;
    } else if (!chart.boxes) {
      const vis = kid(lp, 'visibility'), st = kid(lp, 'statistics');
      const on = (a: string, dflt: boolean) => { const t = vis?.getAttribute(a); return t === null || t === undefined ? dflt : t === '1' || t === 'true'; };
      const o: BoxOptions = {};
      if (!on('meanMarker', true)) o.mean = false;
      if (on('meanLine', false)) o.meanLine = true;
      if (!on('outliers', true)) o.outliers = false;
      if (on('nonoutliers', false)) o.points = true;
      if (st?.getAttribute('quartileMethod') === 'inclusive') o.quartiles = 'inclusive';
      if (Object.keys(o).length) chart.boxes = o;
    }
    series.push(s);
  }
  if (!series.length) return null;
  for (const ax of kids(plot, 'axis')) {
    const a: ChartAxis = {};
    const t = readTitle(kid(ax, 'title'));
    if (t) a.title = t;
    a.grid = !!kid(ax, 'majorGridlines');
    const vs = kid(ax, 'valScaling');
    if (vs) {
      for (const [attr, key] of [['min', 'min'], ['max', 'max'], ['majorUnit', 'step']] as const) {
        const x = Number(vs.getAttribute(attr) ?? NaN);
        if (Number.isFinite(x)) a[key] = x;
      }
      const code = kid(ax, 'numFmt')?.getAttribute('formatCode');
      if (code && code !== 'General') a.numFmt = code;
      chart.y = a;
    } else if (kid(ax, 'catScaling')) chart.x = a;
  }
  const legendEl = kid(ch, 'legend');
  const pos = legendEl?.getAttribute('pos');
  chart.legend = !legendEl ? 'none' : pos === 'b' ? 'bottom' : pos === 't' ? 'top' : 'right';
  const title = readTitle(kid(ch, 'title'));
  if (title) chart.title = title;
  const chartSp = kid(root, 'spPr');
  if (kid(chartSp, 'noFill')) chart.background = 'none';
  seenChartId(id);
  return { chart, partial: mine.length < sers.length };
}

/** The drawing's anchor holding a chart (moves with its corner cell, keeps its size). */
export function chartAnchorXml(c: Chart, to: { col: number; colOff: number; row: number; rowOff: number }, n: number, rid: string): string {
  const PX = 9525;
  const ex = isChartEx(c.kind);
  const descr = c.alt?.trim() ? ` descr="${xml(c.alt.trim())}"` : '';
  const frame = `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${n}" name="Chart ${c.id}"${descr}/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
    `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
    (ex ? `<a:graphic><a:graphicData uri="${CX_NS}"><cx:chart xmlns:cx="${CX_NS}" r:id="${rid}"/></a:graphicData></a:graphic></xdr:graphicFrame>`
      : `<a:graphic><a:graphicData uri="${C_NS}"><c:chart xmlns:c="${C_NS}" r:id="${rid}"/></a:graphicData></a:graphic></xdr:graphicFrame>`);
  // a newer chart, with a note in its place for programs that can't show it (as Excel writes one)
  const body = ex
    ? `<mc:AlternateContent xmlns:mc="${MC_NS}"><mc:Choice xmlns:cx1="${CX1_NS}" Requires="cx1">${frame}</mc:Choice><mc:Fallback>` +
      `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${n}" name="Chart ${c.id}"/><xdr:cNvSpPr><a:spLocks noTextEdit="1"/></xdr:cNvSpPr></xdr:nvSpPr>` +
      `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:prstClr val="white"/></a:solidFill><a:ln w="1"><a:solidFill><a:prstClr val="green"/></a:solidFill></a:ln></xdr:spPr>` +
      `<xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1100"/><a:t>This chart needs Excel 2016 or later.</a:t></a:r></a:p></xdr:txBody></xdr:sp></mc:Fallback></mc:AlternateContent>`
    : frame;
  return `<xdr:twoCellAnchor editAs="oneCell">` +
    `<xdr:from><xdr:col>${c.at.col}</xdr:col><xdr:colOff>${Math.round(c.at.dx * PX)}</xdr:colOff><xdr:row>${c.at.row}</xdr:row><xdr:rowOff>${Math.round(c.at.dy * PX)}</xdr:rowOff></xdr:from>` +
    `<xdr:to><xdr:col>${to.col}</xdr:col><xdr:colOff>${Math.round(to.colOff * PX)}</xdr:colOff><xdr:row>${to.row}</xdr:row><xdr:rowOff>${Math.round(to.rowOff * PX)}</xdr:rowOff></xdr:to>` +
    `${body}<xdr:clientData/></xdr:twoCellAnchor>`;
}

// ---------------------------------------------------------------- reading

const val = (el: Element | null, name: string): string | null => kid(el, name)?.getAttribute('val') ?? null;
const bool = (el: Element | null, name: string, dflt = false): boolean => {
  const x = kid(el, name);
  if (!x) return dflt;
  const a = x.getAttribute('val');
  return a === null || a === '1' || a === 'true';
};
const numVal = (el: Element | null, name: string): number | undefined => {
  const t = val(el, name);
  return t !== null && Number.isFinite(Number(t)) ? Number(t) : undefined;
};
const withEq = (f: string | null | undefined) => (f ? `=${f}` : undefined);

/** The words of a title, with lowered and raised runs written back as _{…} and ^{…}. */
function readTitle(t: Element | null): string | undefined {
  const rich = kid(t, 'tx', 'rich');
  if (rich) {
    const out = kids(rich, 'p').map((p) => kids(p, 'r').map((r) => {
      const text = kid(r, 't')?.textContent ?? '';
      const base = Number(kid(r, 'rPr')?.getAttribute('baseline') ?? 0);
      return base < 0 ? `_{${text}}` : base > 0 ? `^{${text}}` : text.replace(/([_^])/g, '\\$1');
    }).join('')).join(' ');
    return out || undefined;
  }
  const plain = kid(t, 'tx', 'txData', 'v')?.textContent;
  return plain ? plain.replace(/([_^])/g, '\\$1') : undefined;
}

const colourIn = (sp: Element | null): string | undefined => {
  const c = sp?.getElementsByTagNameNS(A_NS, 'srgbClr')[0]?.getAttribute('val');
  return c ? `#${c.toLowerCase()}` : undefined;
};

function readAxis(ax: Element | null): ChartAxis {
  if (!ax) return {};
  const sc = kid(ax, 'scaling');
  const fmt = kid(ax, 'numFmt');
  const code = fmt?.getAttribute('formatCode');
  const a: ChartAxis = {
    title: readTitle(kid(ax, 'title')),
    min: numVal(sc, 'min'), max: numVal(sc, 'max'), step: numVal(ax, 'majorUnit'),
    log: kid(sc, 'logBase') ? true : undefined,
    reverse: val(sc, 'orientation') === 'maxMin' || undefined,
    grid: !!kid(ax, 'majorGridlines'),
    numFmt: code && code !== 'General' && fmt?.getAttribute('sourceLinked') !== '1' ? code : undefined,
  };
  for (const k of Object.keys(a) as (keyof ChartAxis)[]) if (a[k] === undefined) delete a[k];
  return a;
}

const FIT_FROM: Record<string, FitKind> = { linear: 'linear', exp: 'exp', log: 'log', power: 'power' };
const MARKER_FROM: Record<string, MarkerShape> = { circle: 'circle', square: 'square', diamond: 'diamond', triangle: 'triangle', x: 'cross', star: 'cross', plus: 'cross', dash: 'square', dot: 'circle', none: 'none' };

function readSeries(ser: Element, kind: ChartKind): Series {
  const s: Series = { y: '' };
  const tx = kid(ser, 'tx');
  const nameRef = kid(tx, 'strRef', 'f')?.textContent;
  if (nameRef) s.name = `=${nameRef}`;
  else if (kid(tx, 'v')) s.name = kid(tx, 'v')!.textContent ?? undefined;
  const xy = kind === 'scatter' || kind === 'bubble';
  const xEl = kid(ser, xy ? 'xVal' : 'cat');
  const yEl = kid(ser, xy ? 'yVal' : 'val');
  s.x = withEq(kid(xEl, 'numRef', 'f')?.textContent ?? kid(xEl, 'strRef', 'f')?.textContent);
  s.y = withEq(kid(yEl, 'numRef', 'f')?.textContent) ?? '';
  if (kind === 'bubble') s.size = withEq(kid(ser, 'bubbleSize', 'numRef', 'f')?.textContent);
  const sp = kid(ser, 'spPr');
  const ln = kid(sp, 'ln');
  const lineColour = colourIn(ln);
  const fillColour = colourIn(sp && kids(sp).find((e) => e.localName === 'solidFill') ? sp : null);
  if (kind === 'scatter' || kind === 'line' || (kind === 'radar' && !fillColour)) {
    const noLine = !!kid(ln, 'noFill');
    if (kind === 'scatter') { if (ln && !noLine) s.line = true; }
    else if (noLine) s.line = false;
    if (lineColour) s.color = lineColour;
    const w = Number(ln?.getAttribute('w') ?? 0);
    if (w && !noLine && Math.abs(w / 9525 - 2) > 0.3) s.lineWidth = Math.round((w / 9525) * 10) / 10;
    const dash = kid(ln, 'prstDash')?.getAttribute('val');
    if (dash && dash !== 'solid') s.dash = /dot/i.test(dash) && !/dash/i.test(dash) ? 'dot' : 'dash';
    const m = kid(ser, 'marker');
    const sym = val(m, 'symbol');
    if (sym) s.marker = MARKER_FROM[sym] ?? 'circle';
    const size = numVal(m, 'size');
    if (size && size !== 5) s.markerSize = Math.round(size / 0.75);
    if (!s.color) s.color = colourIn(kid(m, 'spPr'));
    if (bool(ser, 'smooth')) s.smooth = true;
  } else if (fillColour && kind !== 'pie') s.color = fillColour;
  const dl = kid(ser, 'dLbls');
  if (dl && (bool(dl, 'showVal') || bool(dl, 'showPercent'))) s.labels = true;
  else if (dl && kind === 'scatter' && bool(dl, 'showCatName')) { s.labels = true; s.labelX = true; }
  const lf = kid(dl, 'numFmt');
  if (s.labels && lf?.getAttribute('sourceLinked') !== '1' && lf?.getAttribute('formatCode') && lf.getAttribute('formatCode') !== 'General') s.labelFmt = lf.getAttribute('formatCode')!;
  const tl = kid(ser, 'trendline');
  if (tl && kind !== 'pie') {
    const t = val(tl, 'trendlineType') ?? 'linear';
    const fk: FitKind | undefined = t === 'poly' ? (numVal(tl, 'order') === 3 ? 'poly3' : 'poly2') : FIT_FROM[t];
    if (fk) {
      const f: SeriesFit = { kind: fk, showEq: bool(tl, 'dispEq'), showR2: bool(tl, 'dispRSqr') };
      const icpt = numVal(tl, 'intercept'), fw = numVal(tl, 'forward'), bw = numVal(tl, 'backward');
      if (icpt !== undefined) f.intercept = icpt;
      if (fw) f.forward = fw;
      if (bw) f.backward = bw;
      const tc = colourIn(kid(tl, 'spPr'));
      if (tc && tc !== s.color) f.color = tc;
      s.fit = f;
    }
  }
  const eb = kids(ser, 'errBars').find((e) => val(e, 'errDir') !== 'x');
  if (eb && kind !== 'pie') {
    const t = val(eb, 'errValType');
    const dir = val(eb, 'errBarType');
    if (kind === 'scatter' && t === 'percentage' && numVal(eb, 'val') === 100 && (dir === 'minus' || dir === 'plus') && bool(eb, 'noEndCap')) {
      // sticks to zero: a mass spectrum
      s.sticks = true;
      const ebc = colourIn(kid(eb, 'spPr'));
      if (ebc) s.color = ebc;
      const w = Number(kid(kid(eb, 'spPr'), 'ln')?.getAttribute('w') ?? 0);
      if (w && Math.abs(w / 9525 - 1.5) > 0.2) s.lineWidth = Math.round((w / 9525) * 10) / 10;
      if (s.marker === 'none') delete s.marker;
    } else if (t === 'cust') {
      const plus = kid(eb, 'plus', 'numRef', 'f')?.textContent, minus = kid(eb, 'minus', 'numRef', 'f')?.textContent;
      if (plus) s.errors = { kind: 'cells', plus: `=${plus}`, ...(minus && minus !== plus ? { minus: `=${minus}` } : {}) };
    } else if (t) {
      s.errors = { kind: t === 'percentage' ? 'percent' : t === 'stdDev' ? 'stdev' : 'fixed', value: numVal(eb, 'val') ?? 1 };
    }
  }
  for (const k of Object.keys(s) as (keyof Series)[]) if (s[k] === undefined) delete s[k];
  return s;
}

/** A chart made in Excel (or saved here), as this program's chart; null when it has nothing it can show. */
export function readChartXml(doc: Document, at: Chart['at'], w: number, h: number, id: number): { chart: Chart; partial: boolean } | null {
  const root = doc.documentElement;
  const ch = kid(root, 'chart');
  const plot = kid(ch, 'plotArea');
  if (!plot) return null;
  if (root.namespaceURI === CX_NS) return readChartExXml(doc, at, w, h, id);
  const types: [string, ChartKind][] = [['scatterChart', 'scatter'], ['lineChart', 'line'], ['barChart', 'column'], ['areaChart', 'area'], ['pieChart', 'pie'], ['doughnutChart', 'pie'], ['bubbleChart', 'bubble'], ['radarChart', 'radar'], ['line3DChart', 'line'], ['bar3DChart', 'column'], ['pie3DChart', 'pie'], ['area3DChart', 'area']];
  const found = kids(plot).filter((e) => types.some(([t]) => t === e.localName));
  const known = kids(plot).filter((e) => /Chart$/.test(e.localName));
  if (!found.length) return null;
  const main = found[0];
  let kind = types.find(([t]) => t === main.localName)![1];
  if (kind === 'column' && val(main, 'barDir') === 'bar') kind = 'bar';
  const valAxes = kids(plot, 'valAx'), catAxes = kids(plot, 'catAx').concat(kids(plot, 'dateAx'));
  const axPos = (a: Element) => val(a, 'axPos');
  // columns and lines together, or on two value axes: a combo chart
  const groupAxis = (g: Element) => valAxes.find((a) => kids(g, 'axId').some((x) => x.getAttribute('val') === val(a, 'axId'))) ?? null;
  const isRight = (g: Element) => { const a = groupAxis(g); return !!a && (axPos(a) === 'r' || val(a, 'crosses') === 'max'); };
  const comboable = (g: Element) => g.localName === 'lineChart' || (g.localName === 'barChart' && val(g, 'barDir') !== 'bar');
  if (found.length > 1 && found.every(comboable) && (new Set(found.map((g) => g.localName)).size > 1 || found.some(isRight))) kind = 'combo';
  const series = kind === 'combo'
    ? found.flatMap((g) => kids(g, 'ser').map((e) => {
      const as = g.localName === 'barChart' ? 'column' : 'line';
      const s = readSeries(e, as === 'column' ? 'column' : 'line');
      return { s, order: numVal(e, 'order') ?? 0, as, right: isRight(g) } as const;
    })).sort((a, b) => a.order - b.order).map(({ s, as, right }, i): Series => {
      const out: Series = { ...s };
      if (as !== (i === 0 ? 'column' : 'line')) out.as = as;
      if (right !== i > 0) out.secondary = right;
      return out;
    }).filter((s) => s.y)
    : found.flatMap((g) => kids(g, 'ser').map((s) => readSeries(s, kind))).filter((s) => s.y);
  if (!series.length) return null;
  const grouping = val(main, 'grouping');
  let xAx: Element | null, yAx: Element | null, y2Ax: Element | null = null;
  if (kind === 'scatter' || kind === 'bubble') { xAx = valAxes.find((a) => axPos(a) === 'b' || axPos(a) === 't') ?? valAxes[0] ?? null; yAx = valAxes.find((a) => a !== xAx) ?? null; }
  else if (kind === 'bar') { xAx = valAxes[0] ?? null; yAx = catAxes[0] ?? null; }
  else if (kind === 'combo') {
    const rights = found.filter(isRight).map(groupAxis), lefts = found.filter((g) => !isRight(g)).map(groupAxis);
    xAx = catAxes.find((a) => val(a, 'delete') !== '1') ?? catAxes[0] ?? null;
    yAx = lefts[0] ?? valAxes.find((a) => !rights.includes(a)) ?? null;
    y2Ax = rights[0] ?? null;
  } else { xAx = catAxes[0] ?? null; yAx = valAxes[0] ?? null; }
  const legendEl = kid(ch, 'legend');
  const pos = val(legendEl, 'legendPos');
  const chartSp = kid(root, 'spPr');
  const bgNone = !!kid(chartSp, 'noFill');
  const bg = colourIn(chartSp && kids(chartSp).find((e) => e.localName === 'solidFill') ? chartSp : null);
  const sz = Number(root.getElementsByTagNameNS(A_NS, 'defRPr')[root.getElementsByTagNameNS(A_NS, 'defRPr').length - 1]?.getAttribute('sz') ?? 0);
  const chart: Chart = {
    id,
    kind,
    series,
    x: readAxis(xAx),
    y: readAxis(yAx),
    legend: !legendEl ? 'none' : pos === 'b' ? 'bottom' : pos === 't' ? 'top' : 'right',
    at, w: Math.max(80, Math.round(w)), h: Math.max(80, Math.round(h)),
  };
  if (kind === 'scatter' || kind === 'line') chart.y.grid = chart.y.grid ?? false;
  if (y2Ax) chart.y2 = readAxis(y2Ax);
  if (kind === 'radar' && val(main, 'radarStyle') === 'filled') chart.filled = true;
  const title = readTitle(kid(ch, 'title'));
  if (title) chart.title = title;
  if (grouping === 'stacked' || grouping === 'percentStacked') chart.stacked = true;
  if (bgNone) chart.background = 'none';
  else if (bg && bg !== '#ffffff') chart.background = bg;
  if (kid(chartSp, 'ln') && kid(kid(chartSp, 'ln'), 'noFill')) chart.border = false;
  if (sz && Math.abs(sz / 100 / 0.75 - 12) > 0.5) chart.fontSize = Math.round((sz / 100 / 0.75) * 10) / 10;
  if (!bool(ch, 'plotVisOnly', true)) chart.showHidden = true;
  seenChartId(id);
  return { chart, partial: (found.length > 1 && kind !== 'combo') || known.length > found.length };
}
