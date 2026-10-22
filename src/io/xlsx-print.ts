// .xlsx parts for printing and for objects floating over the cells, following ECMA-376 part 1:
// page setup (18.3.1.62-64, printOptions, pageMargins, pageSetup, headerFooter, rowBreaks and
// colBreaks), the print area and print titles (the defined names _xlnm.Print_Area and
// _xlnm.Print_Titles, 18.2.5), and pictures, shapes and text boxes in the sheet's drawing part
// (SpreadsheetML drawing, 20.5).

import { xml, xmlAttr, hex6, kids, kid, rAttr } from './ooxml';
import { colName, quoteSheet, MAX_COLS, MAX_ROWS, Range, colIndex } from '../sheet/refs';
import { PageSetup, SHEET_PAPERS, paperFromCode, headerFooterText, readHeaderFooter, isDefaultSetup, DEFAULT_MARGINS, HeaderFooter } from '../sheet/page-setup';
import { SheetObject, ShapeKind, objectLook, isLine, newObjectId } from '../sheet/sheet-objects';

const isOn = (v: string | null | undefined) => v === '1' || v === 'true';
const num = (v: string | null | undefined, d: number) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

// ---------------------------------------------------------------- page setup: writing

/** The sheet's page setup as the worksheet's elements, each in its place in the schema's order. */
export function pageSetupXml(ps: PageSetup | null): { fitToPage: boolean; printOptions: string; pageMargins: string; pageSetup: string; headerFooter: string; breaks: string } {
  const m = ps?.margins ?? DEFAULT_MARGINS;
  const pageMargins = `<pageMargins left="${m.left}" right="${m.right}" top="${m.top}" bottom="${m.bottom}" header="${m.header}" footer="${m.footer}"/>`;
  if (!ps || isDefaultSetup(ps)) return { fitToPage: false, printOptions: '', pageMargins, pageSetup: '', headerFooter: '', breaks: '' };
  const opts = `${ps.headings ? ' headings="1"' : ''}${ps.gridlines ? ' gridLines="1"' : ''}${ps.centerH ? ' horizontalCentered="1"' : ''}${ps.centerV ? ' verticalCentered="1"' : ''}`;
  const attrs: string[] = [];
  if (ps.paper) attrs.push(`paperSize="${SHEET_PAPERS[ps.paper].code}"`);
  if (ps.scale && ps.scale !== 100) attrs.push(`scale="${Math.round(ps.scale)}"`);
  if (ps.firstPage && ps.firstPage !== 1) attrs.push(`firstPageNumber="${ps.firstPage}"`);
  if (ps.fit) attrs.push(`fitToWidth="${ps.fit.wide}"`, `fitToHeight="${ps.fit.tall}"`);
  if (ps.order === 'over') attrs.push('pageOrder="overThenDown"');
  if (ps.orientation) attrs.push(`orientation="${ps.orientation}"`);
  if (ps.firstPage && ps.firstPage !== 1) attrs.push('useFirstPageNumber="1"');
  const hf = (tag: string, h: HeaderFooter | undefined) => {
    const t = headerFooterText(h);
    return t ? `<${tag}>${xml(t)}</${tag}>` : '';
  };
  const first = ps.differentFirst ? hf('firstHeader', ps.firstHeader) + hf('firstFooter', ps.firstFooter) : '';
  const body = hf('oddHeader', ps.header) + hf('oddFooter', ps.footer) + first;
  const headerFooter = body || ps.differentFirst ? `<headerFooter${ps.differentFirst ? ' differentFirst="1"' : ''}>${body}</headerFooter>` : '';
  const brk = (tag: string, list: number[] | undefined, max: number) => list?.length
    ? `<${tag} count="${list.length}" manualBreakCount="${list.length}">${list.map((i) => `<brk id="${i}" max="${max}" man="1"/>`).join('')}</${tag}>`
    : '';
  return {
    fitToPage: !!ps.fit,
    printOptions: opts ? `<printOptions${opts}/>` : '',
    pageMargins,
    pageSetup: attrs.length ? `<pageSetup ${attrs.join(' ')}/>` : '',
    headerFooter,
    breaks: brk('rowBreaks', ps.rowBreaks, MAX_COLS - 1) + brk('colBreaks', ps.colBreaks, MAX_ROWS - 1),
  };
}

const absBlock = (R: Range) => `$${colName(R.c1)}$${R.r1 + 1}:$${colName(R.c2)}$${R.r2 + 1}`;

/** The print area and print titles as the workbook's defined names for a sheet. */
export function printNames(ps: PageSetup | null, sheetName: string, sheetIndex: number): string[] {
  if (!ps) return [];
  const q = quoteSheet(sheetName);
  const out: string[] = [];
  if (ps.printArea?.length) out.push(`<definedName name="_xlnm.Print_Area" localSheetId="${sheetIndex}">${xml(ps.printArea.map((R) => `${q}!${absBlock(R)}`).join(','))}</definedName>`);
  const titles: string[] = [];
  if (ps.titleCols) titles.push(`${q}!$${colName(ps.titleCols[0])}:$${colName(ps.titleCols[1])}`);
  if (ps.titleRows) titles.push(`${q}!$${ps.titleRows[0] + 1}:$${ps.titleRows[1] + 1}`);
  if (titles.length) out.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${sheetIndex}">${xml(titles.join(','))}</definedName>`);
  return out;
}

// ---------------------------------------------------------------- page setup: reading

/** The parts of a defined name's formula: each sheet!block, the sheet name unquoted. */
function refList(text: string): { sheet: string; ref: string }[] {
  const out: { sheet: string; ref: string }[] = [];
  let i = 0;
  while (i < text.length) {
    let sheet = '';
    if (text[i] === "'") {
      i++;
      while (i < text.length) {
        if (text[i] === "'" && text[i + 1] === "'") { sheet += "'"; i += 2; continue; }
        if (text[i] === "'") { i++; break; }
        sheet += text[i++];
      }
    } else {
      while (i < text.length && text[i] !== '!') sheet += text[i++];
    }
    if (text[i] !== '!') break;
    i++;
    let ref = '';
    while (i < text.length && text[i] !== ',') ref += text[i++];
    out.push({ sheet, ref: ref.trim() });
    i++;
  }
  return out;
}

/** A block like $A$1:$D$20, A1, $1:$2 (whole rows) or $A:$B (whole columns). */
export function readBlock(ref: string): Range | null {
  const t = ref.replace(/\$/g, '').toUpperCase();
  const [a, b = a] = t.split(':');
  const cell = /^([A-Z]{1,3})(\d+)$/;
  const ma = cell.exec(a), mb = cell.exec(b);
  if (ma && mb) {
    const r1 = Number(ma[2]) - 1, r2 = Number(mb[2]) - 1, c1 = colIndex(ma[1]), c2 = colIndex(mb[1]);
    return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
  }
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return { r1: Number(a) - 1, r2: Number(b) - 1, c1: 0, c2: MAX_COLS - 1 };
  if (/^[A-Z]{1,3}$/.test(a) && /^[A-Z]{1,3}$/.test(b)) return { r1: 0, r2: MAX_ROWS - 1, c1: colIndex(a), c2: colIndex(b) };
  return null;
}

/** A sheet's page setup from its worksheet and the workbook's defined names (null: Excel's defaults). */
export function readPageSetup(ws: Element, names: Element[], sheetName: string, sheetIndex: number): PageSetup | null {
  const ps: PageSetup = {};
  const po = kid(ws, 'printOptions');
  if (po) {
    if (isOn(po.getAttribute('gridLines'))) ps.gridlines = true;
    if (isOn(po.getAttribute('headings'))) ps.headings = true;
    if (isOn(po.getAttribute('horizontalCentered'))) ps.centerH = true;
    if (isOn(po.getAttribute('verticalCentered'))) ps.centerV = true;
  }
  const pm = kid(ws, 'pageMargins');
  if (pm) {
    const m = {
      left: num(pm.getAttribute('left'), DEFAULT_MARGINS.left), right: num(pm.getAttribute('right'), DEFAULT_MARGINS.right),
      top: num(pm.getAttribute('top'), DEFAULT_MARGINS.top), bottom: num(pm.getAttribute('bottom'), DEFAULT_MARGINS.bottom),
      header: num(pm.getAttribute('header'), DEFAULT_MARGINS.header), footer: num(pm.getAttribute('footer'), DEFAULT_MARGINS.footer),
    };
    const same = (Object.keys(m) as (keyof typeof m)[]).every((k) => Math.abs(m[k] - DEFAULT_MARGINS[k]) < 1e-6);
    if (!same) ps.margins = m;
  }
  const setup = kid(ws, 'pageSetup');
  const fitOn = isOn(kid(ws, 'sheetPr', 'pageSetUpPr')?.getAttribute('fitToPage'));
  if (setup) {
    const paper = paperFromCode(num(setup.getAttribute('paperSize'), 1));
    if (setup.hasAttribute('paperSize') && paper) ps.paper = paper;
    const o = setup.getAttribute('orientation');
    if (o === 'landscape' || o === 'portrait') ps.orientation = o;
    const scale = num(setup.getAttribute('scale'), 100);
    if (scale !== 100) ps.scale = Math.min(400, Math.max(10, scale));
    if (setup.getAttribute('pageOrder') === 'overThenDown') ps.order = 'over';
    if (isOn(setup.getAttribute('useFirstPageNumber'))) ps.firstPage = num(setup.getAttribute('firstPageNumber'), 1);
  }
  if (fitOn) ps.fit = { wide: num(setup?.getAttribute('fitToWidth'), 1), tall: num(setup?.getAttribute('fitToHeight'), 1) };
  const hf = kid(ws, 'headerFooter');
  if (hf) {
    ps.header = readHeaderFooter(kid(hf, 'oddHeader')?.textContent);
    ps.footer = readHeaderFooter(kid(hf, 'oddFooter')?.textContent);
    if (isOn(hf.getAttribute('differentFirst'))) {
      ps.differentFirst = true;
      ps.firstHeader = readHeaderFooter(kid(hf, 'firstHeader')?.textContent);
      ps.firstFooter = readHeaderFooter(kid(hf, 'firstFooter')?.textContent);
    }
  }
  const breaks = (tag: string) => {
    const list = kids(kid(ws, tag), 'brk').filter((b) => b.getAttribute('man') === null || isOn(b.getAttribute('man'))).map((b) => num(b.getAttribute('id'), 0)).filter((i) => i > 0);
    return list.length ? [...new Set(list)].sort((a, b) => a - b) : undefined;
  };
  ps.rowBreaks = breaks('rowBreaks');
  ps.colBreaks = breaks('colBreaks');
  for (const d of names) {
    const name = d.getAttribute('name');
    if (name !== '_xlnm.Print_Area' && name !== '_xlnm.Print_Titles') continue;
    const local = d.getAttribute('localSheetId');
    const refs = refList(d.textContent ?? '');
    if (local !== null ? Number(local) !== sheetIndex : !refs.some((r) => r.sheet === sheetName)) continue;
    const blocks = refs.filter((r) => local !== null || r.sheet === sheetName).map((r) => readBlock(r.ref)).filter((R): R is Range => !!R);
    if (name === '_xlnm.Print_Area') {
      if (blocks.length) ps.printArea = blocks;
    } else {
      for (const R of blocks) {
        if (R.c1 === 0 && R.c2 >= MAX_COLS - 1) ps.titleRows = [R.r1, R.r2];
        else if (R.r1 === 0 && R.r2 >= MAX_ROWS - 1) ps.titleCols = [R.c1, R.c2];
      }
    }
  }
  for (const k of Object.keys(ps) as (keyof PageSetup)[]) if (ps[k] === undefined) delete ps[k];
  return isDefaultSetup(ps) ? null : ps;
}

// ---------------------------------------------------------------- objects: writing

const PX = 9525;
const PRESET: Record<ShapeKind, string> = {
  rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', diamond: 'diamond', pentagon: 'pentagon', hexagon: 'hexagon', star5: 'star5',
  rightArrow: 'rightArrow', leftArrow: 'leftArrow', upArrow: 'upArrow', downArrow: 'downArrow', line: 'line', arrow: 'straightConnector1',
};

type Corner = { col: number; colOff: number; row: number; rowOff: number };

const solid = (c: string) => `<a:solidFill><a:srgbClr val="${hex6(c)}"/></a:solidFill>`;

/**
 * One object as a drawing anchor. `pic` is the relationship of a picture's image; `from` and
 * `to` are its corners in cells, `x`, `y` its place on the sheet in pixels.
 */
export function objectAnchorXml(o: SheetObject, to: Corner, n: number, at: { x: number; y: number }, pic?: string): string {
  const look = objectLook(o);
  const placement = o.placement ?? (o.kind === 'picture' ? 'oneCell' : 'twoCell');
  const from: Corner = { col: o.at.col, colOff: o.at.dx, row: o.at.row, rowOff: o.at.dy };
  const corner = (tag: string, c: Corner) => `<xdr:${tag}><xdr:col>${c.col}</xdr:col><xdr:colOff>${Math.round(c.colOff * PX)}</xdr:colOff><xdr:row>${c.row}</xdr:row><xdr:rowOff>${Math.round(c.rowOff * PX)}</xdr:rowOff></xdr:${tag}>`;
  const flips = `${o.flipH ? ' flipH="1"' : ''}${o.flipV ? ' flipV="1"' : ''}`;
  const xfrm = `<a:xfrm${o.rot ? ` rot="${Math.round(o.rot * 60000)}"` : ''}${flips}><a:off x="${Math.round(at.x * PX)}" y="${Math.round(at.y * PX)}"/><a:ext cx="${Math.round(o.w * PX)}" cy="${Math.round(o.h * PX)}"/></a:xfrm>`;
  const name = xmlAttr(o.name ?? defaultName(o, n));
  const descr = o.descr ? ` descr="${xmlAttr(o.descr)}"` : '';
  const ln = look.line === 'none' ? '<a:ln><a:noFill/></a:ln>' : `<a:ln w="${Math.round(look.lineW * 12700)}">${solid(look.line)}${o.shape === 'arrow' ? '<a:tailEnd type="triangle"/>' : ''}</a:ln>`;
  let body: string;
  if (o.kind === 'picture') {
    body = `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${n}" name="${name}"${descr}/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
      `<xdr:blipFill><a:blip r:embed="${pic}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
      `<xdr:spPr>${xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${look.line === 'none' ? '' : ln}</xdr:spPr></xdr:pic>`;
  } else if (isLine(o)) {
    body = `<xdr:cxnSp macro=""><xdr:nvCxnSpPr><xdr:cNvPr id="${n}" name="${name}"${descr}/><xdr:cNvCxnSpPr/></xdr:nvCxnSpPr>` +
      `<xdr:spPr>${xfrm}<a:prstGeom prst="${PRESET[o.shape!]}"><a:avLst/></a:prstGeom>${ln}</xdr:spPr></xdr:cxnSp>`;
  } else {
    const fill = look.fill === 'none' ? '<a:noFill/>' : solid(look.fill);
    // text boxes: top left; shapes: centred (as Excel starts them)
    const v = o.valign ?? (o.kind === 'text' ? 'top' : 'middle'), a = o.align ?? (o.kind === 'text' ? 'left' : 'center');
    const anchor = v === 'middle' ? 'ctr' : v === 'bottom' ? 'b' : 't';
    const algn = a === 'center' ? 'ctr' : a === 'right' ? 'r' : 'l';
    const rPr = `<a:rPr lang="en-US" sz="${Math.round((o.size ?? 11) * 100)}"${o.bold ? ' b="1"' : ''}${o.italic ? ' i="1"' : ''}>${solid(look.color)}${o.font ? `<a:latin typeface="${xmlAttr(o.font)}"/>` : ''}</a:rPr>`;
    const paras = (o.text ?? '').split('\n').map((line) => `<a:p><a:pPr algn="${algn}"/>${line ? `<a:r>${rPr}<a:t>${xml(line)}</a:t></a:r>` : `<a:endParaRPr lang="en-US" sz="${Math.round((o.size ?? 11) * 100)}"/>`}</a:p>`).join('');
    body = `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${n}" name="${name}"${descr}/><xdr:cNvSpPr${o.kind === 'text' ? ' txBox="1"' : ''}/></xdr:nvSpPr>` +
      `<xdr:spPr>${xfrm}<a:prstGeom prst="${PRESET[o.shape ?? 'rect']}"><a:avLst/></a:prstGeom>${fill}${ln}</xdr:spPr>` +
      `<xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip" wrap="square" rtlCol="0" anchor="${anchor}"/><a:lstStyle/>${paras}</xdr:txBody></xdr:sp>`;
  }
  if (placement === 'absolute') {
    return `<xdr:absoluteAnchor><xdr:pos x="${Math.round(at.x * PX)}" y="${Math.round(at.y * PX)}"/><xdr:ext cx="${Math.round(o.w * PX)}" cy="${Math.round(o.h * PX)}"/>${body}<xdr:clientData/></xdr:absoluteAnchor>`;
  }
  return `<xdr:twoCellAnchor editAs="${placement}">${corner('from', from)}${corner('to', to)}${body}<xdr:clientData/></xdr:twoCellAnchor>`;
}

function defaultName(o: SheetObject, n: number): string {
  return `${o.kind === 'picture' ? 'Picture' : o.kind === 'text' ? 'TextBox' : isLine(o) ? 'Straight Connector' : 'Shape'} ${n}`;
}

// ---------------------------------------------------------------- objects: reading

const KIND_OF: Record<string, ShapeKind> = Object.fromEntries(Object.entries(PRESET).map(([k, v]) => [v, k as ShapeKind]));
// connectors Excel draws for lines and arrows
KIND_OF.straightConnector1 = 'line';
KIND_OF.flowChartProcess = 'rect';
KIND_OF.flowChartAlternateProcess = 'roundRect';
KIND_OF.flowChartConnector = 'ellipse';
KIND_OF.flowChartDecision = 'diamond';
KIND_OF.rtTriangle = 'triangle';

const SCHEME: Record<string, number> = { lt1: 0, bg1: 0, dk1: 1, tx1: 1, lt2: 2, bg2: 2, dk2: 3, tx2: 3, accent1: 4, accent2: 5, accent3: 6, accent4: 7, accent5: 8, accent6: 9, hlink: 10, folHlink: 11 };

/** A DrawingML colour (srgbClr, schemeClr, sysClr, prstClr with lumMod/lumOff) as #rrggbb. */
export function drawingColour(el: Element | null, theme: string[]): string | undefined {
  if (!el) return undefined;
  let hex: string | undefined;
  const v = el.getAttribute('val');
  if (el.localName === 'srgbClr') hex = v ?? undefined;
  else if (el.localName === 'schemeClr') hex = v && SCHEME[v] !== undefined ? theme[SCHEME[v]] : undefined;
  else if (el.localName === 'sysClr') hex = el.getAttribute('lastClr') ?? (v === 'window' ? 'FFFFFF' : '000000');
  else if (el.localName === 'prstClr') hex = ({ black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080' } as Record<string, string>)[v ?? ''];
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return undefined;
  const mod = Number(kid(el, 'lumMod')?.getAttribute('val') ?? 100000) / 100000;
  const off = Number(kid(el, 'lumOff')?.getAttribute('val') ?? 0) / 100000;
  if (mod === 1 && off === 0) return '#' + hex.toLowerCase();
  // lumMod and lumOff change the lightness in HSL
  const rgb = [0, 2, 4].map((i) => parseInt(hex!.slice(i, i + 2), 16) / 255);
  const mx = Math.max(...rgb), mn = Math.min(...rgb);
  let h = 0, s = 0;
  let l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === rgb[0] ? (rgb[1] - rgb[2]) / d + (rgb[1] < rgb[2] ? 6 : 0) : mx === rgb[1] ? (rgb[2] - rgb[0]) / d + 2 : (rgb[0] - rgb[1]) / d + 4;
    h /= 6;
  }
  l = Math.min(1, Math.max(0, l * mod + off));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  const out = s === 0 ? [l, l, l] : [f(h + 1 / 3), f(h), f(h - 1 / 3)];
  return '#' + out.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

/** The colour of a fill or line element's content (solidFill → colour, noFill → 'none'). */
function fillOf(el: Element | null, theme: string[]): string | undefined {
  if (!el) return undefined;
  if (kid(el, 'noFill')) return 'none';
  const sf = kid(el, 'solidFill');
  return sf ? drawingColour(sf.firstElementChild, theme) : undefined;
}

export interface ReadAnchor {
  /** The top-left corner in cells, offsets in pixels. */
  from: Corner;
  /** Size in pixels. */
  w: number;
  h: number;
  placement: 'twoCell' | 'oneCell' | 'absolute';
}

/**
 * The objects of a drawing part that are pictures, shapes, text boxes or lines (not charts, and
 * not our structures' pictures). `image` gives a picture's data: URL from its relationship;
 * `place` turns an anchor element into a corner and size. Counts what can't be shown.
 */
export function readObjects(dr: Document, image: (rid: string) => string | null, place: (anchor: Element) => ReadAnchor | null, theme: string[], skip: (name: string) => boolean): { objects: SheetObject[]; skipped: number } {
  const objects: SheetObject[] = [];
  let skipped = 0;
  for (const anchor of kids(dr.documentElement)) {
    if (!/Anchor$/.test(anchor.localName)) continue;
    const el = kids(anchor).find((k) => ['pic', 'sp', 'cxnSp', 'grpSp', 'graphicFrame', 'AlternateContent'].includes(k.localName));
    // charts are read with the charts (a newer chart's frame is in an AlternateContent)
    if (!el || el.localName === 'graphicFrame') continue;
    if (el.localName === 'AlternateContent') {
      if (!Array.from(el.getElementsByTagName('*')).some((x) => x.localName === 'graphicFrame')) skipped++;
      continue;
    }
    const cNvPr = el.getElementsByTagName('*');
    let nv: Element | null = null;
    for (const x of Array.from(cNvPr)) if (x.localName === 'cNvPr') { nv = x; break; }
    const name = nv?.getAttribute('name') ?? '';
    if (skip(name)) continue;
    if (el.localName === 'grpSp') { skipped++; continue; }
    const at = place(anchor);
    if (!at) { skipped++; continue; }
    const spPr = kid(el, 'spPr');
    const xf = kid(spPr, 'xfrm');
    const o: SheetObject = {
      id: newObjectId(), kind: 'shape', at: { row: at.from.row, col: at.from.col, dx: Math.round(at.from.colOff), dy: Math.round(at.from.rowOff) },
      w: Math.max(1, Math.round(at.w)), h: Math.max(1, Math.round(at.h)),
    };
    if (name) o.name = name;
    const descr = nv?.getAttribute('descr');
    if (descr) o.descr = descr;
    const rot = Number(xf?.getAttribute('rot') ?? 0) / 60000;
    if (rot) o.rot = Math.round(rot * 100) / 100;
    if (isOn(xf?.getAttribute('flipV'))) o.flipV = true;
    if (isOn(xf?.getAttribute('flipH'))) o.flipH = true;
    if (at.placement !== (el.localName === 'pic' ? 'oneCell' : 'twoCell')) o.placement = at.placement;
    const ln = kid(spPr, 'ln');
    const styleEl = kid(el, 'style');
    const lineCol = fillOf(ln, theme) ?? (styleEl ? drawingColour(kid(styleEl, 'lnRef')?.firstElementChild ?? null, theme) : undefined);
    const lineW = ln?.getAttribute('w') ? Number(ln.getAttribute('w')) / 12700 : undefined;
    if (el.localName === 'pic') {
      const blip = el.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'blip')[0];
      const src = blip ? image(rAttr(blip, 'embed') ?? '') : null;
      if (!src) { skipped++; continue; }
      o.kind = 'picture';
      o.src = src;
      if (ln && lineCol && lineCol !== 'none') { o.line = lineCol; if (lineW) o.lineW = lineW; }
      objects.push(o);
      continue;
    }
    const prst = kid(spPr, 'prstGeom')?.getAttribute('prst') ?? (kid(spPr, 'custGeom') ? null : 'rect');
    let kind = prst ? KIND_OF[prst] : undefined;
    if (!kind) { skipped++; continue; }
    if (el.localName === 'cxnSp' || kind === 'line') {
      kind = kid(ln, 'tailEnd') && kid(ln, 'tailEnd')!.getAttribute('type') !== 'none' ? 'arrow' : kid(ln, 'headEnd') && kid(ln, 'headEnd')!.getAttribute('type') !== 'none' ? 'arrow' : 'line';
      // an arrow head at the start only: the line turned round
      if (kind === 'arrow' && !(kid(ln, 'tailEnd') && kid(ln, 'tailEnd')!.getAttribute('type') !== 'none')) { o.flipH = !o.flipH; o.flipV = !o.flipV; }
    }
    o.shape = kind;
    const txBox = isOn(kid(el, 'nvSpPr', 'cNvSpPr')?.getAttribute('txBox'));
    if (txBox) o.kind = 'text';
    const fill = fillOf(spPr, theme) ?? (styleEl ? drawingColour(kid(styleEl, 'fillRef')?.firstElementChild ?? null, theme) : undefined);
    const dflt = objectLook({ ...o, fill: undefined, line: undefined, lineW: undefined, color: undefined });
    if (!isLine(o)) {
      // a text box drawn by Excel has no fill or line given: none
      const f = fill ?? (txBox ? 'none' : undefined);
      if (f && f !== dflt.fill) o.fill = f;
    }
    const lc = lineCol ?? (txBox && !ln ? 'none' : undefined);
    if (lc && lc !== dflt.line) o.line = lc;
    if (lineW !== undefined && Math.abs(lineW - dflt.lineW) > 0.01) o.lineW = Math.round(lineW * 100) / 100;
    // the text: paragraphs joined by new lines, the look of the first run
    const tx = kid(el, 'txBody');
    if (tx) {
      const paras = kids(tx, 'p');
      const text = paras.map((p) => kids(p).filter((r) => r.localName === 'r' || r.localName === 'fld' || r.localName === 'br').map((r) => (r.localName === 'br' ? '\n' : kid(r, 't')?.textContent ?? '')).join('')).join('\n');
      if (text.trim()) {
        o.text = text.replace(/\n+$/, '');
        const rPr = tx.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'rPr')[0];
        if (rPr) {
          const sz = rPr.getAttribute('sz');
          if (sz && Number(sz) / 100 !== 11) o.size = Number(sz) / 100;
          if (isOn(rPr.getAttribute('b'))) o.bold = true;
          if (isOn(rPr.getAttribute('i'))) o.italic = true;
          const col = fillOf(rPr, theme);
          if (col && col !== 'none' && col !== dflt.color) o.color = col;
          const font = kid(rPr, 'latin')?.getAttribute('typeface');
          if (font && !font.startsWith('+')) o.font = font;
        } else if (styleEl) {
          const col = drawingColour(kid(styleEl, 'fontRef')?.firstElementChild ?? null, theme);
          if (col && col !== dflt.color) o.color = col;
        }
        const algn = kid(paras[0], 'pPr')?.getAttribute('algn');
        const a = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'l' ? 'left' : undefined;
        if (a && a !== (o.kind === 'text' ? 'left' : 'center')) o.align = a;
        if (!a && o.kind !== 'text') o.align = 'left';
        const anchorV = kid(tx, 'bodyPr')?.getAttribute('anchor');
        const v = anchorV === 'ctr' ? 'middle' : anchorV === 'b' ? 'bottom' : 'top';
        if (v !== (o.kind === 'text' ? 'top' : 'middle')) o.valign = v;
      }
    }
    objects.push(o);
  }
  return { objects, skipped };
}
