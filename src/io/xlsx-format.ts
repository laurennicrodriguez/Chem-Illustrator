// Conditional formatting and tables in Excel files, as the Office Open XML standard writes them
// (ECMA-376 part 1: 18.3.1.10 conditionalFormatting, 18.3.1.18 dataBar, 18.3.1.49 iconSet,
// 18.3.1.16 colorScale, 18.8.17 dxf, 18.5 tables). What Excel's own file can't say (solid data
// bars, star icons, our own table colours) is also kept in this program's part of the file.

import { xml, hex6, kid, kids } from './ooxml';
import type { CondFormat, CfRule, CfLook, CfValue, CfOp, IconSetName } from '../sheet/conditional';
import { newCondFormat } from '../sheet/conditional';
import type { TableDef } from '../sheet/table-styles';
import { Range, parseRange, cellName, rangeName } from '../sheet/refs';

// ---------------------------------------------------------------- writing

/** A highlight look as a "differential format" (dxf): only what it changes. */
export function dxfXml(l: CfLook): string {
  const font = `${l.bold ? '<b/>' : ''}${l.italic ? '<i/>' : ''}${l.underline ? '<u/>' : ''}${l.color ? `<color rgb="FF${hex6(l.color)}"/>` : ''}`;
  return `<dxf>${font ? `<font>${font}</font>` : ''}${l.fill ? `<fill><patternFill><bgColor rgb="FF${hex6(l.fill)}"/></patternFill></fill>` : ''}</dxf>`;
}

const CF_OPS: Record<CfOp, string> = { gt: 'greaterThan', ge: 'greaterThanOrEqual', lt: 'lessThan', le: 'lessThanOrEqual', eq: 'equal', ne: 'notEqual', between: 'between', notBetween: 'notBetween' };
const ICON_NAMES: Record<IconSetName, string> = { arrows: '3Arrows', lights: '3TrafficLights1', marks: '3Symbols', flags: '3Flags', stars: '3Symbols2' };

const cfvo = (v: CfValue | undefined, fallback: 'min' | 'max'): string => {
  const t = !v || v.type === 'auto' ? fallback : v.type;
  return t === 'min' || t === 'max' ? `<cfvo type="${t}"/>` : `<cfvo type="${t}" val="${v?.value ?? 0}"/>`;
};
const formulaValue = (v: number | string): string => (typeof v === 'number' ? String(v) : `"${String(v).replace(/"/g, '""')}"`);
const quoteText = (t: string) => `"${t.replace(/"/g, '""')}"`;

/** The conditionalFormatting elements of a sheet. `dxf` gives a look's number in the styles part. */
export function condFormatsXml(rules: CondFormat[], dxf: (l: CfLook) => number): string {
  let priority = 0;
  return rules.map((cf) => {
    if (!cf.ranges.length) return '';
    priority++;
    const sqref = cf.ranges.map(rangeName).join(' ');
    const first = cellName(cf.ranges[0].r1, cf.ranges[0].c1);
    const stop = cf.stop ? ' stopIfTrue="1"' : '';
    const r = cf.rule;
    const withLook = (attrs: string, body = '') => {
      const look = (r as { look?: CfLook }).look ?? {};
      return `<cfRule ${attrs} dxfId="${dxf(look)}" priority="${priority}"${stop}>${body}</cfRule>`;
    };
    let rule = '';
    switch (r.kind) {
      case 'scale':
        rule = `<cfRule type="colorScale" priority="${priority}"><colorScale>${r.stops.map((s, i) => cfvo(s.at, i === 0 ? 'min' : 'max')).join('')}${r.stops.map((s) => `<color rgb="FF${hex6(s.color)}"/>`).join('')}</colorScale></cfRule>`;
        break;
      case 'bar':
        rule = `<cfRule type="dataBar" priority="${priority}"><dataBar${r.barOnly ? ' showValue="0"' : ''}>${cfvo(r.min, 'min')}${cfvo(r.max, 'max')}<color rgb="FF${hex6(r.color)}"/></dataBar></cfRule>`;
        break;
      case 'icons': {
        const [a, b] = r.limits ?? [{ type: 'percent', value: 33 }, { type: 'percent', value: 67 }];
        rule = `<cfRule type="iconSet" priority="${priority}"><iconSet iconSet="${ICON_NAMES[r.set]}"${r.reverse ? ' reverse="1"' : ''}${r.iconOnly ? ' showValue="0"' : ''}>` +
          `<cfvo type="percent" val="0"/>${cfvo(a, 'min')}${cfvo(b, 'max')}</iconSet></cfRule>`;
        break;
      }
      case 'cells': {
        const two = r.op === 'between' || r.op === 'notBetween';
        rule = withLook(`type="cellIs" operator="${CF_OPS[r.op]}"`, `<formula>${xml(formulaValue(r.value))}</formula>${two ? `<formula>${xml(formulaValue(r.value2 ?? r.value))}</formula>` : ''}`);
        break;
      }
      case 'text': {
        const t = quoteText(r.text);
        const [type, op, f] = r.op === 'contains' ? ['containsText', 'containsText', `NOT(ISERROR(SEARCH(${t},${first})))`]
          : r.op === 'notContains' ? ['notContainsText', 'notContains', `ISERROR(SEARCH(${t},${first}))`]
          : r.op === 'begins' ? ['beginsWith', 'beginsWith', `LEFT(${first},LEN(${t}))=${t}`]
          : ['endsWith', 'endsWith', `RIGHT(${first},LEN(${t}))=${t}`];
        rule = withLook(`type="${type}" operator="${op}" text="${xml(r.text)}"`, `<formula>${xml(f)}</formula>`);
        break;
      }
      case 'top':
        rule = withLook(`type="top10" rank="${r.n}"${r.percent ? ' percent="1"' : ''}${r.bottom ? ' bottom="1"' : ''}`);
        break;
      case 'average':
        rule = withLook(`type="aboveAverage"${r.below ? ' aboveAverage="0"' : ''}`);
        break;
      case 'duplicates':
        rule = withLook(`type="${r.unique ? 'uniqueValues' : 'duplicateValues'}"`);
        break;
      case 'blank':
        rule = withLook(`type="${r.not ? 'notContainsBlanks' : 'containsBlanks'}"`, `<formula>${xml(`LEN(TRIM(${first}))${r.not ? '>' : '='}0`)}</formula>`);
        break;
      case 'formula':
        rule = withLook('type="expression"', `<formula>${xml(r.formula.replace(/^=/, ''))}</formula>`);
        break;
    }
    return `<conditionalFormatting sqref="${sqref}">${rule}</conditionalFormatting>`;
  }).join('');
}

/** A table part. `names` are the header texts (as written in the header cells); `totals` what each totals-row cell holds. */
export function tableXml(t: TableDef, id: number, names: string[], totals: (string | { formula: string } | null)[] | null, autoFilter: string): string {
  const R = t.range;
  const columns = names.map((n, i) => {
    const tot = totals?.[i];
    if (!tot) return `<tableColumn id="${i + 1}" name="${xml(n)}"/>`;
    if (typeof tot === 'string') return `<tableColumn id="${i + 1}" name="${xml(n)}" totalsRowLabel="${xml(tot)}"/>`;
    return `<tableColumn id="${i + 1}" name="${xml(n)}" totalsRowFunction="custom"><totalsRowFormula>${xml(tot.formula.replace(/^=/, ''))}</totalsRowFormula></tableColumn>`;
  }).join('');
  const info = tableStyleXml(t);
  return `<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="${id}" name="${xml(t.name)}" displayName="${xml(t.name)}" ref="${rangeName(R)}"` +
    `${t.totals ? ' totalsRowCount="1"' : ' totalsRowShown="0"'}>` +
    autoFilter +
    `<tableColumns count="${names.length}">${columns}</tableColumns>${info}</table>`;
}

const tableStyleXml = (t: TableDef) =>
  `<tableStyleInfo${t.style !== 'none' ? ` name="${xml(t.style)}"` : ''} showFirstColumn="${t.firstCol ? 1 : 0}" showLastColumn="${t.lastCol ? 1 : 0}" showRowStripes="${t.bandRows ? 1 : 0}" showColumnStripes="${t.bandCols ? 1 : 0}"/>`;

// ---------------------------------------------------------------- reading

/** The highlight looks (dxfs) of a styles part. `colour` reads a colour element. */
export function readDxfs(styles: Document | null, colour: (el: Element | null) => string | undefined): CfLook[] {
  if (!styles) return [];
  return kids(kid(styles.documentElement, 'dxfs'), 'dxf').map((d) => {
    const look: CfLook = {};
    const font = kid(d, 'font');
    if (font) {
      if (kid(font, 'b') && kid(font, 'b')!.getAttribute('val') !== '0') look.bold = true;
      if (kid(font, 'i') && kid(font, 'i')!.getAttribute('val') !== '0') look.italic = true;
      if (kid(font, 'u')) look.underline = true;
      const c = colour(kid(font, 'color'));
      if (c) look.color = c;
    }
    const pf = kid(d, 'fill', 'patternFill');
    if (pf) {
      const c = colour(kid(pf, 'bgColor')) ?? colour(kid(pf, 'fgColor'));
      if (c) look.fill = c;
    }
    return look;
  });
}

const readCfvo = (el: Element): CfValue => {
  const type = el.getAttribute('type') ?? 'min';
  const val = Number(el.getAttribute('val'));
  if (type === 'min' || type === 'max') return { type };
  if (type === 'num' || type === 'percent' || type === 'percentile') return { type, value: Number.isFinite(val) ? val : 0 };
  return { type: 'auto' };
};

const BACK_OPS: Record<string, CfOp> = Object.fromEntries(Object.entries(CF_OPS).map(([k, v]) => [v, k as CfOp]));
const BACK_ICONS: Record<string, IconSetName> = { '3Arrows': 'arrows', '3ArrowsGray': 'arrows', '3TrafficLights1': 'lights', '3TrafficLights2': 'lights', '3Signs': 'lights', '3Symbols': 'marks', '3Symbols2': 'marks', '3Flags': 'flags', '3Stars': 'stars' };

const readValue = (f: string | null | undefined): number | string => {
  const t = (f ?? '').trim();
  if (/^".*"$/s.test(t)) return t.slice(1, -1).replace(/""/g, '"');
  return t !== '' && Number.isFinite(Number(t)) ? Number(t) : t;
};

/** The conditional formatting of a worksheet, highest priority first. Rules this program can't hold are counted in `skipped`. */
export function readCondFormats(ws: Element, dxfs: CfLook[], colour: (el: Element | null) => string | undefined): { rules: CondFormat[]; skipped: number } {
  const found: { priority: number; cf: CondFormat }[] = [];
  let skipped = 0;
  for (const el of kids(ws, 'conditionalFormatting')) {
    const ranges = (el.getAttribute('sqref') ?? '').split(/\s+/).map((s) => parseRange(s)).filter((r): r is Range => !!r);
    if (!ranges.length) continue;
    for (const c of kids(el, 'cfRule')) {
      const look = dxfs[Number(c.getAttribute('dxfId') ?? -1)] ?? {};
      const type = c.getAttribute('type');
      const formulas = kids(c, 'formula').map((f) => f.textContent ?? '');
      let rule: CfRule | null = null;
      switch (type) {
        case 'colorScale': {
          const cs = kid(c, 'colorScale');
          const vos = kids(cs, 'cfvo'), cols = kids(cs, 'color');
          if (vos.length >= 2 && cols.length === vos.length) rule = { kind: 'scale', stops: vos.map((v, i) => ({ at: readCfvo(v), color: colour(cols[i]) ?? '#ffffff' })) };
          break;
        }
        case 'dataBar': {
          const db = kid(c, 'dataBar');
          const vos = kids(db, 'cfvo');
          const min = vos[0] ? readCfvo(vos[0]) : undefined, max = vos[1] ? readCfvo(vos[1]) : undefined;
          rule = { kind: 'bar', color: colour(kid(db, 'color')) ?? '#638ec6', gradient: true,
            ...(min && min.type !== 'min' ? { min } : {}), ...(max && max.type !== 'max' ? { max } : {}), ...(db?.getAttribute('showValue') === '0' ? { barOnly: true } : {}) };
          break;
        }
        case 'iconSet': {
          const is = kid(c, 'iconSet');
          const name = is?.getAttribute('iconSet') ?? '3TrafficLights1';
          const set = BACK_ICONS[name];
          const vos = kids(is, 'cfvo');
          if (set && vos.length === 3) {
            rule = { kind: 'icons', set, limits: [readCfvo(vos[1]), readCfvo(vos[2])],
              ...(is?.getAttribute('reverse') === '1' ? { reverse: true } : {}), ...(is?.getAttribute('showValue') === '0' ? { iconOnly: true } : {}) };
          }
          break;
        }
        case 'cellIs': {
          const op = BACK_OPS[c.getAttribute('operator') ?? ''];
          if (op) rule = { kind: 'cells', op, value: readValue(formulas[0]), ...(formulas[1] !== undefined ? { value2: readValue(formulas[1]) } : {}), look };
          break;
        }
        case 'containsText': case 'notContainsText': case 'beginsWith': case 'endsWith': {
          const op = type === 'containsText' ? 'contains' : type === 'notContainsText' ? 'notContains' : type === 'beginsWith' ? 'begins' : 'ends';
          rule = { kind: 'text', op, text: c.getAttribute('text') ?? '', look };
          break;
        }
        case 'top10':
          rule = { kind: 'top', n: Number(c.getAttribute('rank') ?? 10), ...(c.getAttribute('percent') === '1' ? { percent: true } : {}), ...(c.getAttribute('bottom') === '1' ? { bottom: true } : {}), look };
          break;
        case 'aboveAverage':
          rule = { kind: 'average', ...(c.getAttribute('aboveAverage') === '0' ? { below: true } : {}), look };
          break;
        case 'duplicateValues': case 'uniqueValues':
          rule = { kind: 'duplicates', ...(type === 'uniqueValues' ? { unique: true } : {}), look };
          break;
        case 'containsBlanks': case 'notContainsBlanks':
          rule = { kind: 'blank', ...(type === 'notContainsBlanks' ? { not: true } : {}), look };
          break;
        case 'expression':
          if (formulas[0]) rule = { kind: 'formula', formula: '=' + formulas[0], look };
          break;
      }
      if (!rule) { skipped++; continue; }
      found.push({ priority: Number(c.getAttribute('priority') ?? 9999), cf: newCondFormat(ranges, rule, c.getAttribute('stopIfTrue') === '1') });
    }
  }
  found.sort((a, b) => a.priority - b.priority);
  return { rules: found.map((f) => f.cf), skipped };
}

/** A table part: the table, and its filter element (for the sheet's filter). */
export function readTable(doc: Document, id: number): { table: TableDef; autoFilter: Element | null } | null {
  const t = doc.documentElement;
  const range = parseRange(t.getAttribute('ref') ?? '');
  if (!range) return null;
  const info = kid(t, 'tableStyleInfo');
  const on = (name: string, dflt = false) => (info?.hasAttribute(name) ? info.getAttribute(name) === '1' || info.getAttribute(name) === 'true' : dflt);
  const table: TableDef = {
    id,
    name: t.getAttribute('displayName') ?? t.getAttribute('name') ?? `Table${id}`,
    range,
    style: info?.getAttribute('name') ?? 'none',
    header: t.getAttribute('headerRowCount') !== '0',
    bandRows: on('showRowStripes', true),
    ...(Number(t.getAttribute('totalsRowCount') ?? 0) > 0 ? { totals: true } : {}),
    ...(on('showColumnStripes') ? { bandCols: true } : {}),
    ...(on('showFirstColumn') ? { firstCol: true } : {}),
    ...(on('showLastColumn') ? { lastCol: true } : {}),
  };
  return { table, autoFilter: kid(t, 'autoFilter') };
}

/** Do two lists of rules cover the same cells in the same order (so the saved copy of our own can be used)? */
export function sameRules(a: CondFormat[], b: CondFormat[]): boolean {
  return a.length === b.length && a.every((x, i) => x.rule.kind === b[i].rule.kind && x.ranges.map(rangeName).join(' ') === b[i].ranges.map(rangeName).join(' '));
}
