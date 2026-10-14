// Sheet mode's Conditional Formatting and Format as Table, as Excel offers them: menus of
// ready-made rules and looks, a window for any rule, a list to reorder and change the rules,
// and the Table Design settings (header row, totals row, bands, first and last column).

import { popupMenu } from './sheet-view';
import type { SheetView } from './sheet-view';
import { ask, Field } from './ask';
import type { Sheet } from '../sheet/workbook';
import { Range, parseRange, rangeName, rangesOverlap, keyOf } from '../sheet/refs';
import {
  CondFormat, CfRule, CfLook, CfOp, CfValue, IconSetName, newCondFormat, scaleRule, describeRule,
  PRESET_LOOKS, PRESET_SCALES, PRESET_BARS, ICON_SETS, rulesAt,
} from '../sheet/conditional';
import { TABLE_STYLES, TableDef, newTable, tableCellLook, tableColumnNames, DEFAULT_TABLE_STYLE, tableStyleInfo } from '../sheet/table-styles';

export interface FormatHost {
  readonly view: SheetView;
  /** One undoable change to the sheet showing. */
  edit(label: string, fn: (s: Sheet) => void): void;
  flash(msg: string, ms?: number): void;
}

const LOOK_OPTIONS = [...PRESET_LOOKS.map((p, i) => ({ value: String(i), label: p.name })), { value: 'custom', label: 'Your own colours…' }];

/** A number when the text is one, else the text. */
const numOrText = (s: string): number | string => (s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : s.trim());

/** "B2:B20, D2:D20" → ranges (null if any part doesn't read). */
export function parseRanges(text: string): Range[] | null {
  const parts = text.split(/[,;\s]+/).filter(Boolean);
  if (!parts.length) return null;
  const out: Range[] = [];
  for (const p of parts) {
    const r = parseRange(p);
    if (!r) return null;
    out.push(r);
  }
  return out;
}

export const rangesText = (rs: Range[]): string => rs.map(rangeName).join(', ');

export class SheetFormatting {
  constructor(private host: FormatHost) {}

  private get sheet(): Sheet {
    return this.host.view.sheet!;
  }

  /** The selection, or the table around the active cell when one cell is selected. */
  private target(): Range {
    const v = this.host.view;
    const R = v.sel.range;
    if (R.r1 === R.r2 && R.c1 === R.c2) return R;
    return this.sheet.clip(R) ?? R;
  }

  private add(rule: CfRule, label: string, ranges = [this.target()]): void {
    this.host.edit(label, (s) => s.setCondFormats([newCondFormat(ranges, rule), ...s.condFormats]));
    this.host.view.focus();
  }

  // ---------------------------------------------------------------- the Conditional Formatting menu

  conditionalMenu(x: number, y: number): void {
    const sub = (items: ([string, () => void, boolean?] | null)[]) => () => popupMenu(x, y, items);
    popupMenu(x, y, [
      ['Highlight Cells Rules ▸', sub([
        ['Greater Than…', () => void this.highlight('gt')],
        ['Less Than…', () => void this.highlight('lt')],
        ['Between…', () => void this.highlight('between')],
        ['Equal To…', () => void this.highlight('eq')],
        ['Text that Contains…', () => void this.highlight('text')],
        ['Duplicate Values…', () => void this.highlight('duplicates')],
        ['Empty Cells…', () => void this.highlight('blank')],
      ])],
      ['Top/Bottom Rules ▸', sub([
        ['Top 10 Items…', () => void this.topBottom(false, false)],
        ['Top 10%…', () => void this.topBottom(false, true)],
        ['Bottom 10 Items…', () => void this.topBottom(true, false)],
        ['Bottom 10%…', () => void this.topBottom(true, true)],
        ['Above Average…', () => void this.average(false)],
        ['Below Average…', () => void this.average(true)],
      ])],
      ['Data Bars ▸', sub([
        ...PRESET_BARS.map((b) => [`${b.name} (shaded)`, () => this.add({ kind: 'bar', color: b.color, gradient: true }, 'Data bars')] as [string, () => void]),
        null,
        ...PRESET_BARS.map((b) => [`${b.name} (solid)`, () => this.add({ kind: 'bar', color: b.color, gradient: false }, 'Data bars')] as [string, () => void]),
        null,
        ['Your own…', () => void this.ruleDialog({ kind: 'bar', color: '#638ec6', gradient: true })],
      ])],
      ['Colour Scales ▸', sub([
        ...PRESET_SCALES.map((p) => [p.name, () => this.add(scaleRule(p.colors), 'Colour scale')] as [string, () => void]),
        null,
        ['Your own…', () => void this.ruleDialog(scaleRule(['#f8696b', '#ffeb84', '#63be7b']))],
      ])],
      ['Icon Sets ▸', sub([
        ...(Object.keys(ICON_SETS) as IconSetName[]).map((k) => [ICON_SETS[k], () => this.add({ kind: 'icons', set: k }, 'Icon set')] as [string, () => void]),
      ])],
      null,
      ['New Rule…', () => void this.ruleDialog(null)],
      ['Clear Rules from Selected Cells', () => this.clear('selection')],
      ['Clear Rules from Entire Sheet', () => this.clear('sheet'), this.sheet.condFormats.length > 0],
      ['Manage Rules…', () => this.manage()],
    ]);
  }

  private async pickLook(values: Record<string, string>): Promise<CfLook | null> {
    if (values.look !== 'custom') return { ...PRESET_LOOKS[Number(values.look)].look };
    const got = await ask('Your own look', [
      { name: 'fill', label: 'Fill', type: 'color', value: '#ffeb9c' },
      { name: 'nofill', label: 'No fill', type: 'checkbox', value: 'false' },
      { name: 'color', label: 'Text colour', type: 'color', value: '#9c5700' },
      { name: 'bold', label: 'Bold', type: 'checkbox', value: 'false' },
      { name: 'italic', label: 'Italic', type: 'checkbox', value: 'false' },
    ]);
    if (!got) return null;
    return { ...(got.nofill === 'true' ? {} : { fill: got.fill }), color: got.color, ...(got.bold === 'true' ? { bold: true } : {}), ...(got.italic === 'true' ? { italic: true } : {}) };
  }

  private async highlight(kind: CfOp | 'text' | 'duplicates' | 'blank'): Promise<void> {
    const look: Field = { name: 'look', label: 'With', value: '0', options: LOOK_OPTIONS };
    const range: Field = { name: 'range', label: 'Applies to', value: rangesText([this.target()]) };
    const titles: Record<string, string> = { gt: 'Greater Than', lt: 'Less Than', between: 'Between', eq: 'Equal To', text: 'Text that Contains', duplicates: 'Duplicate Values', blank: 'Empty Cells' };
    const fields: Field[] = [];
    if (kind === 'between') fields.push({ name: 'a', label: 'From', value: '' }, { name: 'b', label: 'To', value: '' });
    else if (kind === 'text') fields.push({ name: 'a', label: 'Text', value: '' });
    else if (kind === 'duplicates') fields.push({ name: 'a', label: 'Show', value: 'dup', options: [{ value: 'dup', label: 'Duplicate values' }, { value: 'unique', label: 'Unique values' }] });
    else if (kind === 'blank') fields.push({ name: 'a', label: 'Show', value: 'blank', options: [{ value: 'blank', label: 'Empty cells' }, { value: 'filled', label: 'Cells with something in them' }] });
    else fields.push({ name: 'a', label: 'Value', value: '' });
    const got = await ask(titles[kind], [...fields, look, range]);
    if (!got) return;
    const ranges = parseRanges(got.range);
    if (!ranges) { this.host.flash('The "Applies to" cells don\'t read as a range (like B2:B20).'); return; }
    const l = await this.pickLook(got);
    if (!l) return;
    let rule: CfRule;
    if (kind === 'text') rule = { kind: 'text', op: 'contains', text: got.a, look: l };
    else if (kind === 'duplicates') rule = { kind: 'duplicates', unique: got.a === 'unique', look: l };
    else if (kind === 'blank') rule = { kind: 'blank', not: got.a === 'filled', look: l };
    else rule = { kind: 'cells', op: kind, value: numOrText(got.a), ...(kind === 'between' ? { value2: numOrText(got.b) } : {}), look: l };
    this.add(rule, 'Highlight cells', ranges);
  }

  private async topBottom(bottom: boolean, percent: boolean): Promise<void> {
    const got = await ask(`${bottom ? 'Bottom' : 'Top'} ${percent ? '10%' : '10 Items'}`, [
      { name: 'n', label: percent ? 'Percent' : 'How many', type: 'number', value: '10' },
      { name: 'look', label: 'With', value: '0', options: LOOK_OPTIONS },
      { name: 'range', label: 'Applies to', value: rangesText([this.target()]) },
    ]);
    if (!got) return;
    const ranges = parseRanges(got.range);
    const l = ranges && (await this.pickLook(got));
    if (!ranges || !l) return;
    this.add({ kind: 'top', n: Math.max(1, Number(got.n) || 10), percent, bottom, look: l }, `${bottom ? 'Bottom' : 'Top'} values`, ranges);
  }

  private async average(below: boolean): Promise<void> {
    const got = await ask(`${below ? 'Below' : 'Above'} Average`, [
      { name: 'look', label: 'With', value: '0', options: LOOK_OPTIONS },
      { name: 'range', label: 'Applies to', value: rangesText([this.target()]) },
    ]);
    if (!got) return;
    const ranges = parseRanges(got.range);
    const l = ranges && (await this.pickLook(got));
    if (!ranges || !l) return;
    this.add({ kind: 'average', below, look: l }, `${below ? 'Below' : 'Above'} average`, ranges);
  }

  private clear(where: 'selection' | 'sheet'): void {
    const R = this.host.view.sel.range;
    this.host.edit('Clear rules', (s) => {
      if (where === 'sheet') { s.setCondFormats([]); return; }
      const keep: CondFormat[] = [];
      for (const cf of s.condFormats) {
        // rules partly inside the selection keep the cells outside it
        const ranges = cf.ranges.flatMap((r) => (rangesOverlap(r, R) ? subtract(r, R) : [r]));
        if (ranges.length) keep.push({ ...cf, ranges });
      }
      s.setCondFormats(keep);
    });
  }

  // ---------------------------------------------------------------- any rule

  /** The window for a new rule (or changing one): what kind, its settings, its look. */
  async ruleDialog(start: CfRule | null, existing?: CondFormat): Promise<void> {
    const kinds = [
      { value: 'scale', label: 'Colour scale' },
      { value: 'bar', label: 'Data bar' },
      { value: 'icons', label: 'Icon set' },
      { value: 'cells', label: 'Cells whose value is…' },
      { value: 'text', label: 'Cells whose text…' },
      { value: 'top', label: 'Top or bottom values' },
      { value: 'average', label: 'Above or below average' },
      { value: 'duplicates', label: 'Duplicate or unique values' },
      { value: 'blank', label: 'Empty or filled cells' },
      { value: 'formula', label: 'Use a formula' },
    ];
    let kind = start?.kind;
    if (!kind) {
      const k = await ask('New Formatting Rule', [{ name: 'kind', label: 'Format', value: 'cells', options: kinds }]);
      if (!k) return;
      kind = k.kind as CfRule['kind'];
    }
    const r = start;
    const rangeField: Field = { name: 'range', label: 'Applies to', value: rangesText(existing?.ranges ?? [this.target()]) };
    const stopField: Field = { name: 'stop', label: 'Stop here: rules below don\'t apply where this one does', type: 'checkbox', value: String(!!existing?.stop) };
    const pointOpts = [{ value: 'min', label: 'Lowest value' }, { value: 'max', label: 'Highest value' }, { value: 'num', label: 'Number' }, { value: 'percent', label: 'Percent' }, { value: 'percentile', label: 'Percentile' }, { value: 'auto', label: 'Automatic' }];
    const pt = (t: string, v: string): CfValue => (t === 'min' || t === 'max' || t === 'auto' ? { type: t } : { type: t as CfValue['type'], value: Number(v) || 0 });
    const lookFields = (l?: CfLook): Field[] => [
      { name: 'fill', label: 'Fill', type: 'color', value: l?.fill ?? '#ffc7ce' },
      { name: 'nofill', label: 'No fill', type: 'checkbox', value: String(!!l && !l.fill) },
      { name: 'color', label: 'Text colour', type: 'color', value: l?.color ?? '#9c0006' },
      { name: 'bold', label: 'Bold', type: 'checkbox', value: String(!!l?.bold) },
      { name: 'italic', label: 'Italic', type: 'checkbox', value: String(!!l?.italic) },
    ];
    const lookOf = (g: Record<string, string>): CfLook => ({ ...(g.nofill === 'true' ? {} : { fill: g.fill }), color: g.color, ...(g.bold === 'true' ? { bold: true } : {}), ...(g.italic === 'true' ? { italic: true } : {}) });
    const opOptions = [
      { value: 'gt', label: 'greater than' }, { value: 'ge', label: 'greater than or equal to' }, { value: 'lt', label: 'less than' },
      { value: 'le', label: 'less than or equal to' }, { value: 'eq', label: 'equal to' }, { value: 'ne', label: 'not equal to' },
      { value: 'between', label: 'between' }, { value: 'notBetween', label: 'not between' },
    ];
    let fields: Field[] = [];
    let build: (g: Record<string, string>) => CfRule;
    switch (kind) {
      case 'scale': {
        const s = r?.kind === 'scale' ? r : (scaleRule(['#f8696b', '#ffeb84', '#63be7b']) as Extract<CfRule, { kind: 'scale' }>);
        const three = s.stops.length >= 3;
        const st = (i: number) => s.stops[Math.min(i, s.stops.length - 1)];
        fields = [
          { name: 'n', label: 'Colours', value: three ? '3' : '2', options: [{ value: '2', label: 'Two' }, { value: '3', label: 'Three' }] },
          { name: 't0', label: 'Lowest is', value: st(0).at.type, options: pointOpts }, { name: 'v0', label: 'Number', value: String(st(0).at.value ?? '') }, { name: 'c0', label: 'Colour', type: 'color', value: st(0).color },
          { name: 't1', label: 'Middle is', value: three ? st(1).at.type : 'percentile', options: pointOpts }, { name: 'v1', label: 'Number', value: String(three ? st(1).at.value ?? 50 : 50) }, { name: 'c1', label: 'Colour', type: 'color', value: three ? st(1).color : '#ffeb84' },
          { name: 't2', label: 'Highest is', value: st(2).at.type, options: pointOpts }, { name: 'v2', label: 'Number', value: String(st(2).at.value ?? '') }, { name: 'c2', label: 'Colour', type: 'color', value: st(2).color },
        ];
        build = (g) => ({ kind: 'scale', stops: (g.n === '3' ? [0, 1, 2] : [0, 2]).map((i) => ({ at: pt(g[`t${i}`], g[`v${i}`]), color: g[`c${i}`] })) });
        break;
      }
      case 'bar': {
        const b = r?.kind === 'bar' ? r : { kind: 'bar' as const, color: '#638ec6', gradient: true };
        fields = [
          { name: 'color', label: 'Colour', type: 'color', value: b.color },
          { name: 'gradient', label: 'Shaded (fades to white)', type: 'checkbox', value: String(b.gradient !== false) },
          { name: 'barOnly', label: 'Show the bar only (hide the value)', type: 'checkbox', value: String(!!b.barOnly) },
          { name: 'tmin', label: 'Shortest bar', value: b.min?.type ?? 'auto', options: pointOpts }, { name: 'vmin', label: 'Number', value: String(b.min?.value ?? '') },
          { name: 'tmax', label: 'Longest bar', value: b.max?.type ?? 'auto', options: pointOpts }, { name: 'vmax', label: 'Number', value: String(b.max?.value ?? '') },
        ];
        build = (g) => ({ kind: 'bar', color: g.color, gradient: g.gradient === 'true', ...(g.barOnly === 'true' ? { barOnly: true } : {}),
          ...(g.tmin !== 'auto' ? { min: pt(g.tmin, g.vmin) } : {}), ...(g.tmax !== 'auto' ? { max: pt(g.tmax, g.vmax) } : {}) });
        break;
      }
      case 'icons': {
        const ic = r?.kind === 'icons' ? r : { kind: 'icons' as const, set: 'arrows' as IconSetName };
        fields = [
          { name: 'set', label: 'Icons', value: ic.set, options: (Object.keys(ICON_SETS) as IconSetName[]).map((k) => ({ value: k, label: ICON_SETS[k] })) },
          { name: 'reverse', label: 'Reverse (low values get the best icon)', type: 'checkbox', value: String(!!ic.reverse) },
          { name: 'iconOnly', label: 'Show the icon only', type: 'checkbox', value: String(!!ic.iconOnly) },
          { name: 't1', label: 'Middle icon from', value: ic.limits?.[0].type ?? 'percent', options: pointOpts.slice(2, 5) }, { name: 'v1', label: 'Value', value: String(ic.limits?.[0].value ?? 33) },
          { name: 't2', label: 'Top icon from', value: ic.limits?.[1].type ?? 'percent', options: pointOpts.slice(2, 5) }, { name: 'v2', label: 'Value', value: String(ic.limits?.[1].value ?? 67) },
        ];
        build = (g) => ({ kind: 'icons', set: g.set as IconSetName, ...(g.reverse === 'true' ? { reverse: true } : {}), ...(g.iconOnly === 'true' ? { iconOnly: true } : {}),
          limits: [pt(g.t1, g.v1), pt(g.t2, g.v2)] });
        break;
      }
      case 'cells': {
        const c = r?.kind === 'cells' ? r : null;
        fields = [
          { name: 'op', label: 'Value is', value: c?.op ?? 'gt', options: opOptions },
          { name: 'a', label: 'Value', value: String(c?.value ?? '') },
          { name: 'b', label: 'And (for between)', value: String(c?.value2 ?? '') },
          ...lookFields(c?.look),
        ];
        build = (g) => ({ kind: 'cells', op: g.op as CfOp, value: numOrText(g.a), ...(g.op === 'between' || g.op === 'notBetween' ? { value2: numOrText(g.b) } : {}), look: lookOf(g) });
        break;
      }
      case 'text': {
        const t = r?.kind === 'text' ? r : null;
        fields = [
          { name: 'op', label: 'Text', value: t?.op ?? 'contains', options: [{ value: 'contains', label: 'contains' }, { value: 'notContains', label: 'does not contain' }, { value: 'begins', label: 'begins with' }, { value: 'ends', label: 'ends with' }] },
          { name: 'text', label: 'This', value: t?.text ?? '' },
          ...lookFields(t?.look),
        ];
        build = (g) => ({ kind: 'text', op: g.op as 'contains', text: g.text, look: lookOf(g) });
        break;
      }
      case 'top': {
        const t = r?.kind === 'top' ? r : null;
        fields = [
          { name: 'which', label: 'Show', value: t?.bottom ? 'bottom' : 'top', options: [{ value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }] },
          { name: 'n', label: 'How many', type: 'number', value: String(t?.n ?? 10) },
          { name: 'percent', label: 'As a percentage of the cells', type: 'checkbox', value: String(!!t?.percent) },
          ...lookFields(t?.look),
        ];
        build = (g) => ({ kind: 'top', n: Math.max(1, Number(g.n) || 10), ...(g.percent === 'true' ? { percent: true } : {}), ...(g.which === 'bottom' ? { bottom: true } : {}), look: lookOf(g) });
        break;
      }
      case 'average': {
        const a = r?.kind === 'average' ? r : null;
        fields = [{ name: 'which', label: 'Values', value: a?.below ? 'below' : 'above', options: [{ value: 'above', label: 'Above average' }, { value: 'below', label: 'Below average' }] }, ...lookFields(a?.look)];
        build = (g) => ({ kind: 'average', ...(g.which === 'below' ? { below: true } : {}), look: lookOf(g) });
        break;
      }
      case 'duplicates': {
        const d = r?.kind === 'duplicates' ? r : null;
        fields = [{ name: 'which', label: 'Values', value: d?.unique ? 'unique' : 'dup', options: [{ value: 'dup', label: 'Duplicate' }, { value: 'unique', label: 'Unique' }] }, ...lookFields(d?.look)];
        build = (g) => ({ kind: 'duplicates', ...(g.which === 'unique' ? { unique: true } : {}), look: lookOf(g) });
        break;
      }
      case 'blank': {
        const b = r?.kind === 'blank' ? r : null;
        fields = [{ name: 'which', label: 'Cells', value: b?.not ? 'filled' : 'blank', options: [{ value: 'blank', label: 'Empty' }, { value: 'filled', label: 'With something in them' }] }, ...lookFields(b?.look)];
        build = (g) => ({ kind: 'blank', ...(g.which === 'filled' ? { not: true } : {}), look: lookOf(g) });
        break;
      }
      default: {
        const f = r?.kind === 'formula' ? r : null;
        const home = existing?.ranges[0] ?? this.target();
        fields = [{ name: 'formula', label: `Formula for ${rangeName({ r1: home.r1, c1: home.c1, r2: home.r1, c2: home.c1 })}`, value: f?.formula ?? `=${rangeName({ r1: home.r1, c1: home.c1, r2: home.r1, c2: home.c1 })}>0`, placeholder: '=B2>0.5' }, ...lookFields(f?.look)];
        build = (g) => ({ kind: 'formula', formula: g.formula.startsWith('=') ? g.formula : '=' + g.formula, look: lookOf(g) });
      }
    }
    const got = await ask(existing ? 'Change Formatting Rule' : 'New Formatting Rule', [...fields, rangeField, stopField], {
      note: kind === 'formula' ? 'Write the formula for the first cell of the range; it moves to each other cell the way a copied formula does.' : undefined,
    });
    if (!got) return;
    const ranges = parseRanges(got.range);
    if (!ranges) { this.host.flash('The "Applies to" cells don\'t read as a range (like B2:B20).'); return; }
    const rule = build(got);
    const stop = got.stop === 'true';
    this.host.edit(existing ? 'Change rule' : 'New rule', (s) => {
      if (existing) s.setCondFormats(s.condFormats.map((cf) => (cf.id === existing.id ? { ...cf, rule, ranges, stop: stop || undefined } : cf)));
      else s.setCondFormats([newCondFormat(ranges, rule, stop), ...s.condFormats]);
    });
  }

  // ---------------------------------------------------------------- Manage Rules

  manage(): void {
    const d = document.createElement('dialog');
    d.className = 'ask cf-manage';
    const h = document.createElement('h2');
    h.textContent = 'Conditional Formatting Rules';
    const show = document.createElement('select');
    show.add(new Option('Rules for the selected cells', 'sel'));
    show.add(new Option('Every rule on this sheet', 'all'));
    show.value = rulesAt(this.sheet.condFormats, this.host.view.sel.active.r, this.host.view.sel.active.c).length ? 'sel' : 'all';
    const list = document.createElement('div');
    list.className = 'cf-list';
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = 'Rules higher in the list win where two set the same thing.';
    const buttons = document.createElement('p');
    buttons.className = 'ask-buttons';
    const btn = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', fn);
      return b;
    };
    let picked: number | null = null;
    const rules = () => {
      const all = this.sheet.condFormats;
      const R = this.host.view.sel.range;
      return show.value === 'all' ? all : all.filter((cf) => cf.ranges.some((r) => rangesOverlap(r, R)));
    };
    const render = () => {
      list.replaceChildren();
      const rs = rules();
      if (!rs.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'No rules here yet.'; list.append(p); }
      for (const cf of rs) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'cf-row' + (cf.id === picked ? ' picked' : '');
        const sw = document.createElement('span');
        sw.className = 'cf-swatch';
        paintSwatch(sw, cf.rule);
        const what = document.createElement('span');
        what.textContent = describeRule(cf.rule) + (cf.stop ? ' (stop)' : '');
        const where = document.createElement('span');
        where.className = 'muted';
        where.textContent = rangesText(cf.ranges);
        row.append(sw, what, where);
        row.addEventListener('click', () => { picked = cf.id; render(); });
        row.addEventListener('dblclick', () => void change());
        list.append(row);
      }
    };
    const move = (step: number) => {
      if (picked === null) return;
      const all = this.sheet.condFormats.slice();
      const i = all.findIndex((x) => x.id === picked);
      const j = i + step;
      if (i < 0 || j < 0 || j >= all.length) return;
      [all[i], all[j]] = [all[j], all[i]];
      this.host.edit('Reorder rules', (s) => s.setCondFormats(all));
      render();
    };
    const change = async () => {
      const cf = this.sheet.condFormats.find((x) => x.id === picked);
      if (!cf) return;
      d.close();
      await this.ruleDialog(cf.rule, cf);
      this.manage();
    };
    const remove = () => {
      if (picked === null) return;
      const id = picked;
      this.host.edit('Delete rule', (s) => s.setCondFormats(s.condFormats.filter((x) => x.id !== id)));
      picked = null;
      render();
    };
    show.addEventListener('change', render);
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    buttons.append(
      btn('New Rule…', () => { d.close(); void this.ruleDialog(null).then(() => this.manage()); }),
      btn('Change…', () => void change()),
      btn('Delete', remove),
      btn('▲', () => move(-1)),
      btn('▼', () => move(1)),
      spacer,
      btn('Close', () => d.close()),
    );
    d.append(h, show, list, note, buttons);
    d.addEventListener('close', () => { d.remove(); this.host.view.focus(); });
    document.body.append(d);
    render();
    d.showModal();
  }

  // ---------------------------------------------------------------- Format as Table

  /** The gallery of table looks. */
  tableMenu(x: number, y: number, onPick?: (style: string) => void): void {
    document.querySelector('.popup-menu')?.remove();
    const m = document.createElement('div');
    m.className = 'menu popup-menu table-gallery';
    m.setAttribute('role', 'menu');
    for (const group of ['Light', 'Medium', 'Dark']) {
      const h = document.createElement('div');
      h.className = 'tg-head';
      h.textContent = group;
      m.append(h);
      const grid = document.createElement('div');
      grid.className = 'tg-grid';
      for (const st of TABLE_STYLES.filter((s) => s.group === group)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.title = `${st.label} (${st.name.replace('TableStyle', '')})`;
        b.append(tablePreview(st.name));
        b.addEventListener('click', () => { m.remove(); (onPick ?? ((n) => this.formatAsTable(n)))(st.name); });
        grid.append(b);
      }
      m.append(grid);
    }
    const none = document.createElement('button');
    none.type = 'button';
    none.className = 'tg-none';
    none.textContent = 'No style (plain table)';
    none.addEventListener('click', () => { m.remove(); (onPick ?? ((n) => this.formatAsTable(n)))('none'); });
    m.append(none);
    document.body.append(m);
    const r = m.getBoundingClientRect();
    m.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
    m.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof PointerEvent && m.contains(e.target as Node)) return;
      m.remove();
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', close, true);
    };
    setTimeout(() => { document.addEventListener('pointerdown', close, true); document.addEventListener('keydown', close, true); });
  }

  /** Format the selection (or the table around the cell) as a table; a cell already in one changes its look. */
  async formatAsTable(style: string): Promise<void> {
    const v = this.host.view;
    const s = this.sheet;
    const { r, c } = v.sel.active;
    const already = s.tableAt(r, c);
    if (already) { this.setTable(already, { style }, 'Table style'); return; }
    const R = v.sel.range;
    const region = R.r1 !== R.r2 || R.c1 !== R.c2 ? (s.clip(R) ?? R) : s.currentRegion(r, c);
    const got = await ask('Format as Table', [
      { name: 'range', label: 'Cells', value: rangeName(region) },
      { name: 'header', label: 'My table has headers', type: 'checkbox', value: 'true' },
    ]);
    if (!got) return;
    const range = parseRange(got.range);
    if (!range) { this.host.flash('The cells don\'t read as a range (like A1:D20).'); return; }
    if (s.tables.some((t) => rangesOverlap(t.range, range))) { this.host.flash('Those cells overlap a table already.'); return; }
    const header = got.header === 'true';
    const t = newTable(header ? range : { ...range, r1: range.r1 - 1 < 0 ? range.r1 : range.r1 }, s.tables, style, header);
    this.host.edit('Format as table', (sh) => {
      let tr = range;
      if (!header) {
        // a header row goes in above, named as Excel names them
        sh.insertRows(range.r1, 1);
        tr = { ...range, r2: range.r2 + 1 };
        const names = tableColumnNames(Array(range.c2 - range.c1 + 1).fill(''));
        names.forEach((n, i) => sh.setInput(range.r1, range.c1 + i, n));
      } else {
        // every header filled in and different, as Excel needs
        const heads: string[] = [];
        for (let col = tr.c1; col <= tr.c2; col++) heads.push(sh.shownText(tr.r1, col));
        tableColumnNames(heads).forEach((n, i) => { if (n !== heads[i]) sh.setInput(tr.r1, tr.c1 + i, n); });
      }
      sh.setTables([...sh.tables, { ...t, range: tr, header: true }]);
      if (!sh.filter) sh.setFilter({ range: tr, conditions: {} });
    });
    this.host.flash('Formatted as a table. Its settings are on the Table Design tab.');
  }

  setTable(t: TableDef, patch: Partial<TableDef>, label: string): void {
    this.host.edit(label, (s) => s.setTables(s.tables.map((x) => (x.id === t.id ? { ...x, ...patch } : x))));
  }

  /** Turn the totals row on or off: a row under the table with a sum for each column of numbers. */
  toggleTotals(t: TableDef): void {
    const on = !t.totals;
    this.host.edit(on ? 'Totals row' : 'No totals row', (s) => {
      const R = t.range;
      if (on) {
        const row = R.r2 + 1;
        s.insertRows(row, 1);
        s.setInput(row, R.c1, 'Total');
        for (let col = R.c1 + 1; col <= R.c2; col++) {
          let numbers = false;
          for (let rr = R.r1 + 1; rr <= R.r2 && !numbers; rr++) numbers = typeof s.values.get(keyOf(rr, col)) === 'number';
          if (numbers) s.setInput(row, col, `=SUBTOTAL(109,${rangeName({ r1: R.r1 + 1, c1: col, r2: R.r2, c2: col })})`);
        }
        const cur = s.tables.find((x) => x.id === t.id)!;
        s.setTables(s.tables.map((x) => (x.id === t.id ? { ...x, totals: true, range: { ...cur.range, r2: cur.range.r2 + 1 } } : x)));
      } else {
        const cur = s.tables.find((x) => x.id === t.id)!;
        const row = cur.range.r2;
        s.setTables(s.tables.map((x) => (x.id === t.id ? { ...x, totals: false, range: { ...cur.range, r2: row - 1 } } : x)));
        s.deleteRows(row, 1);
      }
    });
  }

  /** Make the table plain cells again, keeping its look as ordinary formatting (Excel's Convert to Range). */
  convertToRange(t: TableDef): void {
    this.host.edit('Convert to range', (s) => {
      for (let row = t.range.r1; row <= t.range.r2; row++) {
        for (let col = t.range.c1; col <= t.range.c2; col++) {
          const look = tableCellLook(t, row, col);
          if (!look) continue;
          const own = s.cell(row, col)?.style;
          s.patchStyle({ r1: row, c1: col, r2: row, c2: col }, {
            fill: own?.fill ?? look.fill, color: own?.color ?? look.color, bold: own?.bold ?? look.bold,
            borders: { ...look.borders, ...own?.borders },
          });
        }
      }
      s.setTables(s.tables.filter((x) => x.id !== t.id));
    });
  }
}

/** The parts of range a outside range b. */
export function subtract(a: Range, b: Range): Range[] {
  if (!rangesOverlap(a, b)) return [a];
  const out: Range[] = [];
  if (a.r1 < b.r1) out.push({ ...a, r2: b.r1 - 1 });
  if (a.r2 > b.r2) out.push({ ...a, r1: b.r2 + 1 });
  const r1 = Math.max(a.r1, b.r1), r2 = Math.min(a.r2, b.r2);
  if (a.c1 < b.c1) out.push({ r1, r2, c1: a.c1, c2: b.c1 - 1 });
  if (a.c2 > b.c2) out.push({ r1, r2, c1: b.c2 + 1, c2: a.c2 });
  return out;
}

/** A small picture of a rule, for the rules list. */
function paintSwatch(el: HTMLElement, rule: CfRule): void {
  if (rule.kind === 'scale') el.style.background = `linear-gradient(90deg, ${rule.stops.map((s) => s.color).join(', ')})`;
  else if (rule.kind === 'bar') el.style.background = rule.gradient === false ? rule.color : `linear-gradient(90deg, ${rule.color}, #ffffff)`;
  else if (rule.kind === 'icons') { el.textContent = rule.set === 'arrows' ? '↑' : rule.set === 'lights' ? '●' : rule.set === 'marks' ? '✓' : rule.set === 'flags' ? '⚑' : '★'; }
  else {
    el.style.background = rule.look.fill ?? 'transparent';
    el.style.color = rule.look.color ?? 'inherit';
    el.style.fontWeight = rule.look.bold ? '700' : '400';
    el.textContent = 'Ab';
  }
}

/** A small picture of a table look: five rows of four cells. */
export function tablePreview(style: string): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  const W = 56, H = 40, dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.width = `${W}px`; cv.style.height = `${H}px`;
  const g = cv.getContext('2d')!;
  g.scale(dpr, dpr);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  const t: TableDef = { id: 0, name: '', range: { r1: 0, c1: 0, r2: 4, c2: 3 }, style, header: true, bandRows: true };
  const cw = (W - 4) / 4, rh = (H - 4) / 5;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 4; c++) {
      const look = tableCellLook(t, r, c);
      const x = 2 + c * cw, y = 2 + r * rh;
      if (look?.fill) { g.fillStyle = look.fill; g.fillRect(x, y, cw, rh); }
      g.fillStyle = look?.color ?? (tableStyleInfo(style) ? '#404040' : '#808080');
      g.fillRect(x + 2, y + rh / 2 - 0.5, cw - 5, look?.bold ? 1.6 : 1);
      g.strokeStyle = look?.borders?.bottom?.color ?? 'transparent';
      g.lineWidth = 1;
      if (look?.borders?.bottom) { g.beginPath(); g.moveTo(x, y + rh - 0.5); g.lineTo(x + cw, y + rh - 0.5); g.stroke(); }
      if (look?.borders?.top) { g.strokeStyle = look.borders.top.color ?? '#000'; g.beginPath(); g.moveTo(x, y + 0.5); g.lineTo(x + cw, y + 0.5); g.stroke(); }
      if (look?.borders?.left) { g.strokeStyle = look.borders.left.color ?? '#000'; g.beginPath(); g.moveTo(x + 0.5, y); g.lineTo(x + 0.5, y + rh); g.stroke(); }
      if (look?.borders?.right) { g.strokeStyle = look.borders.right.color ?? '#000'; g.beginPath(); g.moveTo(x + cw - 0.5, y); g.lineTo(x + cw - 0.5, y + rh); g.stroke(); }
    }
  }
  return cv;
}

export { DEFAULT_TABLE_STYLE };
