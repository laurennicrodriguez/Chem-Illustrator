// PivotTables and data tables in Excel's own form (ECMA-376 part 1, 18.10 PivotTables, and the
// dataTable formula of 18.3.1.40). A PivotTable goes to Excel as a pivot cache (where the records
// are, the items of each field, and the records themselves) and a pivot table part (which fields
// sit on rows, columns, filters and values, with the items left out), marked to refresh when Excel
// opens it, so Excel lays the report out itself. Its cells are written too, for programs that
// only read cells. A data table is the TABLE() formula on its first result cell.

import { xmlAttr, kids, kid } from './ooxml';
import type { Sheet, Workbook } from '../sheet/workbook';
import { cellName, parseRange, rangeName, type Range } from '../sheet/refs';
import { refersTo } from '../sheet/names';
import type { Value } from '../sheet/values';
import { isError } from '../sheet/values';
import type { DataTable } from '../sheet/what-if';
import { newDataTableId } from '../sheet/what-if';
import {
  type PivotTable, type PivotFn, type ShowAs, type PivotValueField, type PivotSource,
  fieldItems, itemText, newPivotId, valueCaption,
} from '../sheet/pivot';
import { reportOf, sourceRange, blockValues } from '../sheet/pivot-sheet';
import { sourceOf } from '../sheet/pivot';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export const PIVOT_CT = {
  table: 'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml',
  cache: 'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml',
  records: 'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml',
};

export const PIVOT_REL = {
  table: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable',
  cache: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition',
  records: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords',
};

// ---------------------------------------------------------------- data tables

/** A cell reference without its sheet or dollar signs ("=$B$1" is B1), as the dataTable formula has it. */
const plainRef = (ref: string | undefined): string => (ref ?? '').replace(/^=/, '').replace(/^.*!/, '').replace(/\$/g, '');

/** The formula on a data table's first result cell (18.3.1.40: t="dataTable"). */
export function dataTableXml(t: DataTable): string {
  const ref = rangeName(t.ref);
  if (t.rowInput && t.colInput) return `<f t="dataTable" ref="${ref}" dt2D="1" dtr="1" r1="${plainRef(t.rowInput)}" r2="${plainRef(t.colInput)}"/>`;
  if (t.rowInput) return `<f t="dataTable" ref="${ref}" dt2D="0" dtr="1" r1="${plainRef(t.rowInput)}"/>`;
  return `<f t="dataTable" ref="${ref}" dt2D="0" dtr="0" r1="${plainRef(t.colInput)}"/>`;
}

/** A data table from its formula element (null when it isn't one). */
export function readDataTable(f: Element): DataTable | null {
  if (f.getAttribute('t') !== 'dataTable') return null;
  const ref = parseRange(f.getAttribute('ref') ?? '');
  if (!ref) return null;
  const abs = (a: string | null) => {
    const R = a ? parseRange(a) : null;
    return R ? `=$${cellName(R.r1, R.c1).replace(/(\d)/, '$$$1')}` : undefined;
  };
  const on = (a: string | null) => a === '1' || a === 'true';
  const r1 = abs(f.getAttribute('r1')), r2 = abs(f.getAttribute('r2'));
  if (!r1) return null;
  const t: DataTable = { id: newDataTableId(), ref };
  if (on(f.getAttribute('dt2D'))) { t.rowInput = r1; if (r2) t.colInput = r2; }
  else if (on(f.getAttribute('dtr'))) t.rowInput = r1;
  else t.colInput = r1;
  return t;
}

// ---------------------------------------------------------------- PivotTables: writing

/** The records a PivotTable reads, and where Excel is told they are. */
function sourceFor(wb: Workbook, s: Sheet, pt: PivotTable): { src: PivotSource; xml: string } | null {
  const at = sourceRange(wb, pt.source, s);
  if (typeof at === 'string') return null;
  const src = sourceOf(blockValues(at.sheet, at.range));
  if (typeof src === 'string') return null;
  const text = pt.source.trim().replace(/^=/, '');
  // a table's or defined name's name stays a name; a block is its cells and sheet
  const isName = /^[A-Za-z_\\][\w.]*$/.test(text) && !/^[A-Za-z]{1,3}\d+$/.test(text);
  const R: Range = { ...at.range, r2: at.range.r1 + src.records.length };
  const ws = isName ? `<worksheetSource name="${xmlAttr(text)}"/>` : `<worksheetSource ref="${rangeName(R)}" sheet="${xmlAttr(at.sheet.name)}"/>`;
  return { src, xml: `<cacheSource type="worksheet">${ws}</cacheSource>` };
}

/** One shared item, as the cache lists it. */
function itemXml(v: Value): string {
  if (v === null || v === '') return '<m/>';
  if (typeof v === 'number') return `<n v="${Number.isFinite(v) ? v : 0}"/>`;
  if (typeof v === 'boolean') return `<b v="${v ? 1 : 0}"/>`;
  if (isError(v)) return `<e v="${xmlAttr(v.code)}"/>`;
  return `<s v="${xmlAttr(String(v))}"/>`;
}

/** A field's shared items, with the flags Excel checks them against (18.10.1.90). */
function sharedItemsXml(items: { value: Value }[]): string {
  const vals = items.map((i) => i.value);
  const nums = vals.filter((v): v is number => typeof v === 'number');
  const strings = vals.some((v) => typeof v === 'string' && v !== '');
  const blank = vals.some((v) => v === null || v === '');
  const other = vals.some((v) => typeof v === 'boolean' || isError(v));
  const a: string[] = [];
  if (nums.length && !strings && !other) a.push('containsSemiMixedTypes="0"', 'containsString="0"');
  if (nums.length && (strings || other)) a.push('containsMixedTypes="1"');
  if (nums.length) {
    a.push('containsNumber="1"');
    if (nums.every((x) => Number.isInteger(x))) a.push('containsInteger="1"');
    a.push(`minValue="${Math.min(...nums)}"`, `maxValue="${Math.max(...nums)}"`);
  }
  if (blank) a.push('containsBlank="1"');
  return `<sharedItems ${a.join(' ')}${a.length ? ' ' : ''}count="${items.length}">${vals.map(itemXml).join('')}</sharedItems>`;
}

/** The parts of one PivotTable: its cache definition, its records, and the pivot table. */
export function pivotParts(wb: Workbook, s: Sheet, pt: PivotTable, cacheId: number): { cache: (recordsRid: string) => string; records: string; table: string } | null {
  const got = sourceFor(wb, s, pt);
  if (!got) return null;
  const { src } = got;
  const items = src.fields.map((f) => fieldItems(src, f));
  const index = items.map((list) => new Map(list.map((it, i) => [it.text, i])));
  const cacheFields = src.fields.map((f, i) => `<cacheField name="${xmlAttr(f)}" numFmtId="0">${sharedItemsXml(items[i])}</cacheField>`).join('');
  const cache = (rid: string) => `<pivotCacheDefinition xmlns="${MAIN}" xmlns:r="${RNS}" r:id="${rid}" refreshOnLoad="1" createdVersion="6" refreshedVersion="6" minRefreshableVersion="3" recordCount="${src.records.length}">` +
    `${got.xml}<cacheFields count="${src.fields.length}">${cacheFields}</cacheFields></pivotCacheDefinition>`;
  const records = `<pivotCacheRecords xmlns="${MAIN}" xmlns:r="${RNS}" count="${src.records.length}">` +
    src.records.map((r) => `<r>${src.fields.map((_, i) => `<x v="${index[i].get(itemText(r[i] ?? null)) ?? 0}"/>`).join('')}</r>`).join('') +
    '</pivotCacheRecords>';

  // where the report sits: Excel's location leaves out the filters above it
  const rep = reportOf(wb, s, pt);
  if (typeof rep === 'string') return null;
  const width = Math.max(1, ...rep.cells.map((r) => r.length));
  const top = pt.at.row + rep.filterRows;
  const loc: Range = { r1: top, c1: pt.at.col, r2: Math.max(top, pt.at.row + rep.cells.length - 1), c2: pt.at.col + width - 1 };
  const nf = pt.filters.length;
  const compact = pt.layout === 'compact', tabular = pt.layout === 'tabular';
  const desc = new Set(pt.descending ?? []);
  const fieldXml = src.fields.map((f, i) => {
    const axis = pt.rows.includes(f) ? 'axisRow' : pt.cols.includes(f) ? 'axisCol' : pt.filters.includes(f) ? 'axisPage' : null;
    const data = pt.values.some((v) => v.field === f);
    const attrs = [
      ...(axis ? [`axis="${axis}"`] : []),
      ...(data ? ['dataField="1"'] : []),
      ...(compact ? [] : ['compact="0"']),
      ...(tabular ? ['outline="0"'] : []),
      'showAll="0"',
      ...(axis && desc.has(f) ? ['sortType="descending"'] : []),
      ...(axis && !pt.subtotals ? ['defaultSubtotal="0"'] : []),
      ...(axis === 'axisPage' && (pt.hidden[f]?.length ?? 0) > 0 ? ['multipleItemSelectionAllowed="1"'] : []),
    ];
    if (!axis) return `<pivotField ${attrs.join(' ')}/>`;
    const hid = new Set(pt.hidden[f] ?? []);
    const list = items[i].map((it, k) => `<item${hid.has(it.text) ? ' h="1"' : ''} x="${k}"/>`);
    if (pt.subtotals) list.push('<item t="default"/>');
    return `<pivotField ${attrs.join(' ')}><items count="${list.length}">${list.join('')}</items></pivotField>`;
  }).join('');
  const fx = (f: string) => src.fields.indexOf(f);
  const many = pt.values.length > 1;
  const rowFields = [...pt.rows.map(fx), ...(many && pt.valuesOnRows ? [-2] : [])];
  const colFields = [...pt.cols.map(fx), ...(many && !pt.valuesOnRows ? [-2] : [])];
  const fieldsXml = (tag: string, list: number[]) => (list.length ? `<${tag} count="${list.length}">${list.map((x) => `<field x="${x}"/>`).join('')}</${tag}>` : '');
  const pageXml = nf ? `<pageFields count="${nf}">${pt.filters.map((f) => {
    // one item shown: the filter names it
    const shown = items[fx(f)].map((it, k) => ({ it, k })).filter(({ it }) => !(pt.hidden[f] ?? []).includes(it.text));
    return `<pageField fld="${fx(f)}"${shown.length === 1 && (pt.hidden[f]?.length ?? 0) > 0 ? ` item="${shown[0].k}"` : ''} hier="-1"/>`;
  }).join('')}</pageFields>` : '';
  const dataXml = pt.values.length ? `<dataFields count="${pt.values.length}">${pt.values.map((v) => {
    const show = v.showAs && v.showAs !== 'normal' ? ` showDataAs="${v.showAs}"` : '';
    return `<dataField name="${xmlAttr(valueCaption(v))}" fld="${fx(v.field)}"${v.fn !== 'sum' ? ` subtotal="${v.fn}"` : ''}${show} baseField="0" baseItem="0"/>`;
  }).join('')}</dataFields>` : '';
  const headRows = rep.headRows;
  const table = `<pivotTableDefinition xmlns="${MAIN}" name="${xmlAttr(pt.name)}" cacheId="${cacheId}" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="Values"` +
    `${many && pt.valuesOnRows ? ' dataOnRows="1"' : ''}${pt.emptyText !== undefined ? ` showMissing="1" missingCaption="${xmlAttr(pt.emptyText)}"` : ''}` +
    ` updatedVersion="6" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" createdVersion="6" indent="0"` +
    `${compact ? '' : ' compact="0" compactData="0"'} outline="1" outlineData="1"${pt.grandCols ? '' : ' rowGrandTotals="0"'}${pt.grandRows ? '' : ' colGrandTotals="0"'} multipleFieldFilters="0">` +
    `<location ref="${rangeName(loc)}" firstHeaderRow="${Math.min(1, headRows)}" firstDataRow="${headRows}" firstDataCol="${rep.labelCols}"${nf ? ` rowPageCount="${nf}" colPageCount="1"` : ''}/>` +
    `<pivotFields count="${src.fields.length}">${fieldXml}</pivotFields>` +
    fieldsXml('rowFields', rowFields) + fieldsXml('colFields', colFields) + pageXml + dataXml +
    `<pivotTableStyleInfo name="PivotStyleLight16" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/>` +
    '</pivotTableDefinition>';
  return { cache, records, table };
}

// ---------------------------------------------------------------- PivotTables: reading

const FNS: PivotFn[] = ['sum', 'count', 'average', 'max', 'min', 'product', 'countNums', 'stdDev', 'stdDevp', 'var', 'varp'];
const SHOWS: ShowAs[] = ['normal', 'percentOfTotal', 'percentOfRow', 'percentOfCol'];

/** A shared item's label. */
function readItem(el: Element): string {
  const v = el.getAttribute('v');
  switch (el.localName) {
    case 'm': return '(blank)';
    case 'b': return v === '1' || v === 'true' ? 'TRUE' : 'FALSE';
    case 'n': return itemText(Number(v));
    default: return v ?? '';
  }
}

/**
 * A PivotTable from Excel's parts (its pivot table and cache definition), placed on its sheet.
 * Its report's cells are as Excel saved them. Null when the parts can't be read.
 */
export function readPivot(table: Document, cache: Document | null, sheetName: string): PivotTable | null {
  const t = table.documentElement;
  if (t.localName !== 'pivotTableDefinition') return null;
  const loc = kid(t, 'location');
  const R = loc ? parseRange(loc.getAttribute('ref') ?? '') : null;
  if (!R || !cache) return null;
  const c = cache.documentElement;
  const ws = kid(c, 'cacheSource', 'worksheetSource');
  if (!ws) return null;
  const sourceName = ws.getAttribute('name');
  const ref = ws.getAttribute('ref') ? parseRange(ws.getAttribute('ref')!) : null;
  const source = sourceName ?? (ref ? refersTo(ws.getAttribute('sheet') ?? sheetName, ref) : null);
  if (!source) return null;
  const cacheFields = kids(kid(c, 'cacheFields'), 'cacheField');
  const names = cacheFields.map((f) => f.getAttribute('name') ?? '');
  const shared = cacheFields.map((f) => [...(kid(f, 'sharedItems')?.children ?? [])].map(readItem));
  const fields = kids(kid(t, 'pivotFields'), 'pivotField');
  const on = (v: string | null, dflt: boolean) => (v === null ? dflt : v === '1' || v === 'true');
  const list = (tag: string) => kids(kid(t, tag), 'field').map((f) => Number(f.getAttribute('x')));
  const rowsX = list('rowFields'), colsX = list('colFields');
  const pages = kids(kid(t, 'pageFields'), 'pageField');
  const hidden: Record<string, string[]> = {};
  const descending: string[] = [];
  let subtotals = true, compact = true, tabular = false;
  fields.forEach((f, i) => {
    const name = names[i];
    if (!name || !f.getAttribute('axis')) return;
    const hid = kids(kid(f, 'items'), 'item').filter((it) => on(it.getAttribute('h'), false) && it.getAttribute('x') !== null).map((it) => shared[i]?.[Number(it.getAttribute('x'))]).filter((x): x is string => x !== undefined);
    if (hid.length) hidden[name] = hid;
    if (f.getAttribute('sortType') === 'descending') descending.push(name);
    if (!on(f.getAttribute('defaultSubtotal'), true)) subtotals = false;
    if (!on(f.getAttribute('compact'), true)) compact = false;
    if (!on(f.getAttribute('outline'), true)) tabular = true;
  });
  // a filter on one item: every other item is left out
  for (const p of pages) {
    const fi = Number(p.getAttribute('fld')), item = p.getAttribute('item');
    if (item !== null && shared[fi]) hidden[names[fi]] = shared[fi].filter((_, k) => k !== Number(item));
  }
  const values: PivotValueField[] = kids(kid(t, 'dataFields'), 'dataField').map((d) => {
    const field = names[Number(d.getAttribute('fld'))] ?? '';
    const fn = (FNS as string[]).includes(d.getAttribute('subtotal') ?? '') ? (d.getAttribute('subtotal') as PivotFn) : 'sum';
    const showAs = (SHOWS as string[]).includes(d.getAttribute('showDataAs') ?? '') ? (d.getAttribute('showDataAs') as ShowAs) : undefined;
    const v: PivotValueField = { field, fn, ...(showAs && showAs !== 'normal' ? { showAs } : {}) };
    const name = d.getAttribute('name');
    if (name && name !== valueCaption(v)) v.name = name;
    return v;
  });
  const nf = pages.length;
  const at = { row: Math.max(0, R.r1 - (nf ? nf + 1 : 0)), col: R.c1 };
  const pt: PivotTable = {
    id: newPivotId(), name: t.getAttribute('name') ?? 'PivotTable1', source, at,
    rows: rowsX.filter((x) => x >= 0).map((x) => names[x]),
    cols: colsX.filter((x) => x >= 0).map((x) => names[x]),
    values, filters: pages.map((p) => names[Number(p.getAttribute('fld'))]), hidden,
    layout: tabular ? 'tabular' : compact && on(t.getAttribute('compact'), true) ? 'compact' : 'outline',
    subtotals, grandRows: on(t.getAttribute('colGrandTotals'), true), grandCols: on(t.getAttribute('rowGrandTotals'), true),
    last: { r1: at.row, c1: R.c1, r2: R.r2, c2: R.c2 },
  };
  if (rowsX.includes(-2)) pt.valuesOnRows = true;
  if (descending.length) pt.descending = descending;
  if (on(t.getAttribute('showMissing'), true) && t.getAttribute('missingCaption') !== null) pt.emptyText = t.getAttribute('missingCaption')!;
  return pt;
}

/** Do two PivotTables (ours as saved, and one read from Excel's parts) say the same thing? */
export function samePivot(a: PivotTable, b: PivotTable): boolean {
  const key = (p: PivotTable) => JSON.stringify([p.name, p.at, p.rows, p.cols, p.filters, p.values.map((v) => [v.field, v.fn, v.showAs ?? 'normal'])]);
  return key(a) === key(b);
}
