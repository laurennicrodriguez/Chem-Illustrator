// Charts in Excel files, as the Office Open XML standard writes them (ECMA-376 part 1, 21.2:
// DrawingML charts): the chart part with its series, fitted lines (trendlines), error bars,
// axes and legend, and reading charts made in Excel back in. Each series keeps its cell
// references and a copy of its numbers (for programs that don't work them out).

import { xml, hex6, kid, kids } from './ooxml';
import type { Chart, ChartAxis, ChartKind, Series, SeriesData, SeriesFit, ErrorBars, MarkerShape } from '../sheet/chart';
import { seenChartId } from '../sheet/chart';
import type { FitKind } from '../sheet/fit';
import { textRuns } from '../render/chart-draw';

export const C_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const CT_CHART = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
export const REL_CHART = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart';

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

const MARKER_NAME: Record<MarkerShape, string> = { circle: 'circle', square: 'square', diamond: 'diamond', triangle: 'triangle', cross: 'x', none: 'none' };

function axisXml(kind: 'cat' | 'val', id: number, cross: number, pos: string, a: ChartAxis, deleteIt: boolean, grid: boolean, crossBetween?: string): string {
  const scaling = `<c:scaling>${a.log ? v('logBase', 10) : ''}${v('orientation', a.reverse ? 'maxMin' : 'minMax')}${kind === 'val' && a.max !== undefined ? v('max', a.max) : ''}${kind === 'val' && a.min !== undefined ? v('min', a.min) : ''}</c:scaling>`;
  const gridXml = grid ? `<c:majorGridlines><c:spPr><a:ln w="9525">${fill('#d9d9d9')}</a:ln></c:spPr></c:majorGridlines>` : '';
  const fmt = `<c:numFmt formatCode="${xml(a.numFmt ?? 'General')}" sourceLinked="${a.numFmt ? 0 : 1}"/>`;
  const common = `${v('axId', id)}${scaling}${v('delete', deleteIt)}${v('axPos', pos)}${gridXml}${titleXml(a.title, 10)}${fmt}` +
    `${v('majorTickMark', 'out')}${v('minorTickMark', 'none')}${v('tickLblPos', 'nextTo')}<c:spPr><a:ln w="9525">${fill('#bfbfbf')}</a:ln></c:spPr>${v('crossAx', cross)}${v('crosses', 'autoZero')}`;
  if (kind === 'cat') return `<c:catAx>${common}${v('auto', true)}${v('lblAlgn', 'ctr')}${v('lblOffset', 100)}${v('noMultiLvlLbl', false)}</c:catAx>`;
  return `<c:valAx>${common}${crossBetween ? v('crossBetween', crossBetween) : ''}${a.step ? v('majorUnit', a.step) : ''}</c:valAx>`;
}

/** The chart part of a chart, with a copy of its numbers. */
export function chartXml(c: Chart, data: SeriesData[]): string {
  const sizePt = (c.fontSize ?? 12) * 0.75;
  const scatter = c.kind === 'scatter', pie = c.kind === 'pie';
  const sers = c.series.map((s, i) => {
    const d = data[i];
    const color = d?.color ?? '#4472c4';
    const name = s.name?.startsWith('=') ? `<c:tx>${strRef(s.name, [d?.name ?? ''])}</c:tx>` : s.name ? `<c:tx><c:v>${xml(s.name)}</c:v></c:tx>` : '';
    const lineOn = c.kind === 'line' ? s.line !== false : !!s.line;
    const lineLike = scatter || c.kind === 'line';
    const sp = pie ? '' : lineLike
      ? `<c:spPr>${lineOn ? `<a:ln w="${Math.round((s.lineWidth ?? 2) * 9525)}" cap="rnd">${fill(color)}${s.dash && s.dash !== 'solid' ? `<a:prstDash val="${DASH[s.dash]}"/>` : ''}<a:round/></a:ln>` : '<a:ln w="19050"><a:noFill/></a:ln>'}</c:spPr>`
      : `<c:spPr>${fill(color)}</c:spPr>`;
    const markerShape = s.marker ?? (scatter ? 'circle' : 'none');
    const marker = lineLike ? `<c:marker>${v('symbol', MARKER_NAME[markerShape])}${markerShape !== 'none' ? `${v('size', Math.max(2, Math.min(72, Math.round((s.markerSize ?? 7) * 0.75))))}<c:spPr>${fill(color)}<a:ln w="9525">${fill(color)}</a:ln></c:spPr>` : ''}</c:marker>` : '';
    const dLbls = s.labels ? `<c:dLbls>${v('showLegendKey', false)}${v('showVal', !pie)}${v('showCatName', false)}${v('showSerName', false)}${v('showPercent', pie)}${v('showBubbleSize', false)}</c:dLbls>` : '';
    const trend = s.fit && !pie ? trendlineXml(s.fit, color) : '';
    const errs = s.errors && !pie ? errBarsXml(s.errors, scatter) : '';
    const xs = d?.xs ?? [], ys = d?.ys ?? [];
    const catNumbers = s.x && d ? d.cats.every((t) => t === '' || Number.isFinite(Number(t))) : false;
    const cat = s.x ? (scatter || catNumbers ? numRef(s.x, xs) : strRef(s.x, d?.cats ?? [])) : '';
    const xy = scatter
      ? `${cat ? `<c:xVal>${cat}</c:xVal>` : ''}<c:yVal>${numRef(s.y, ys)}</c:yVal>${v('smooth', !!s.smooth)}`
      : `${cat ? `<c:cat>${cat}</c:cat>` : ''}<c:val>${numRef(s.y, ys)}</c:val>${c.kind === 'line' ? v('smooth', !!s.smooth) : ''}`;
    const head = `${v('idx', i)}${v('order', i)}${name}${sp}`;
    if (c.kind === 'column' || c.kind === 'bar') return `<c:ser>${head}${v('invertIfNegative', false)}${dLbls}${trend}${errs}${xy}</c:ser>`;
    if (c.kind === 'area') return `<c:ser>${head}${dLbls}${trend}${errs}${xy}</c:ser>`;
    if (pie) return `<c:ser>${head}${dLbls}${xy}</c:ser>`;
    return `<c:ser>${head}${marker}${dLbls}${trend}${errs}${xy}</c:ser>`;
  }).join('');
  const grouping = c.stacked ? 'stacked' : c.kind === 'column' || c.kind === 'bar' ? 'clustered' : 'standard';
  const ax = `${v('axId', 101)}${v('axId', 102)}`;
  let plot: string;
  switch (c.kind) {
    case 'scatter':
      plot = `<c:scatterChart>${v('scatterStyle', 'lineMarker')}${v('varyColors', false)}${sers}${ax}</c:scatterChart>` +
        axisXml('val', 101, 102, 'b', c.x, false, !!c.x.grid, 'midCat') + axisXml('val', 102, 101, 'l', c.y, false, c.y.grid !== false, 'midCat');
      break;
    case 'line': case 'area':
      plot = `<c:${c.kind}Chart>${v('grouping', grouping)}${v('varyColors', false)}${sers}${c.kind === 'line' ? v('marker', true) : ''}${ax}</c:${c.kind}Chart>` +
        axisXml('cat', 101, 102, 'b', c.x, false, !!c.x.grid) + axisXml('val', 102, 101, 'l', c.y, false, c.y.grid !== false, c.kind === 'area' ? 'midCat' : 'between');
      break;
    case 'column': case 'bar': {
      const bar = c.kind === 'bar';
      // a bar chart's categories run down its left side: they are its "y" axis here
      plot = `<c:barChart>${v('barDir', bar ? 'bar' : 'col')}${v('grouping', grouping)}${v('varyColors', false)}${sers}${v('gapWidth', 80)}${c.stacked ? v('overlap', 100) : ''}${ax}</c:barChart>` +
        axisXml('cat', 101, 102, bar ? 'l' : 'b', bar ? c.y : c.x, false, bar ? !!c.y.grid : !!c.x.grid) +
        axisXml('val', 102, 101, bar ? 'b' : 'l', bar ? c.x : c.y, false, bar ? c.x.grid !== false : c.y.grid !== false, 'between');
      break;
    }
    case 'pie':
      plot = `<c:pieChart>${v('varyColors', true)}${sers}${v('firstSliceAng', 0)}</c:pieChart>`;
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

/** The drawing's anchor holding a chart (moves with its corner cell, keeps its size). */
export function chartAnchorXml(c: Chart, to: { col: number; colOff: number; row: number; rowOff: number }, n: number, rid: string): string {
  const PX = 9525;
  return `<xdr:twoCellAnchor editAs="oneCell">` +
    `<xdr:from><xdr:col>${c.at.col}</xdr:col><xdr:colOff>${Math.round(c.at.dx * PX)}</xdr:colOff><xdr:row>${c.at.row}</xdr:row><xdr:rowOff>${Math.round(c.at.dy * PX)}</xdr:rowOff></xdr:from>` +
    `<xdr:to><xdr:col>${to.col}</xdr:col><xdr:colOff>${Math.round(to.colOff * PX)}</xdr:colOff><xdr:row>${to.row}</xdr:row><xdr:rowOff>${Math.round(to.rowOff * PX)}</xdr:rowOff></xdr:to>` +
    `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${n}" name="Chart ${c.id}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
    `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
    `<a:graphic><a:graphicData uri="${C_NS}"><c:chart xmlns:c="${C_NS}" r:id="${rid}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
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
  return undefined;
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
  const xEl = kid(ser, kind === 'scatter' ? 'xVal' : 'cat');
  const yEl = kid(ser, kind === 'scatter' ? 'yVal' : 'val');
  s.x = withEq(kid(xEl, 'numRef', 'f')?.textContent ?? kid(xEl, 'strRef', 'f')?.textContent);
  s.y = withEq(kid(yEl, 'numRef', 'f')?.textContent) ?? '';
  const sp = kid(ser, 'spPr');
  const ln = kid(sp, 'ln');
  const lineColour = colourIn(ln);
  const fillColour = colourIn(sp && kids(sp).find((e) => e.localName === 'solidFill') ? sp : null);
  if (kind === 'scatter' || kind === 'line') {
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
  if (kid(ser, 'dLbls') && (bool(kid(ser, 'dLbls'), 'showVal') || bool(kid(ser, 'dLbls'), 'showPercent'))) s.labels = true;
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
    if (t === 'cust') {
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
  const types: [string, ChartKind][] = [['scatterChart', 'scatter'], ['lineChart', 'line'], ['barChart', 'column'], ['areaChart', 'area'], ['pieChart', 'pie'], ['doughnutChart', 'pie'], ['line3DChart', 'line'], ['bar3DChart', 'column'], ['pie3DChart', 'pie'], ['area3DChart', 'area']];
  const found = kids(plot).filter((e) => types.some(([t]) => t === e.localName));
  const known = kids(plot).filter((e) => /Chart$/.test(e.localName));
  if (!found.length) return null;
  const main = found[0];
  let kind = types.find(([t]) => t === main.localName)![1];
  if (kind === 'column' && val(main, 'barDir') === 'bar') kind = 'bar';
  const series = found.flatMap((g) => kids(g, 'ser').map((s) => readSeries(s, kind))).filter((s) => s.y);
  if (!series.length) return null;
  const grouping = val(main, 'grouping');
  const valAxes = kids(plot, 'valAx'), catAxes = kids(plot, 'catAx').concat(kids(plot, 'dateAx'));
  const axPos = (a: Element) => val(a, 'axPos');
  let xAx: Element | null, yAx: Element | null;
  if (kind === 'scatter') { xAx = valAxes.find((a) => axPos(a) === 'b' || axPos(a) === 't') ?? valAxes[0] ?? null; yAx = valAxes.find((a) => a !== xAx) ?? null; }
  else if (kind === 'bar') { xAx = valAxes[0] ?? null; yAx = catAxes[0] ?? null; }
  else { xAx = catAxes[0] ?? null; yAx = valAxes[0] ?? null; }
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
  const title = readTitle(kid(ch, 'title'));
  if (title) chart.title = title;
  if (grouping === 'stacked' || grouping === 'percentStacked') chart.stacked = true;
  if (bgNone) chart.background = 'none';
  else if (bg && bg !== '#ffffff') chart.background = bg;
  if (kid(chartSp, 'ln') && kid(kid(chartSp, 'ln'), 'noFill')) chart.border = false;
  if (sz && Math.abs(sz / 100 / 0.75 - 12) > 0.5) chart.fontSize = Math.round((sz / 100 / 0.75) * 10) / 10;
  if (!bool(ch, 'plotVisOnly', true)) chart.showHidden = true;
  seenChartId(id);
  return { chart, partial: found.length > 1 || known.length > found.length };
}
