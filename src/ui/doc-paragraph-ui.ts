// Home > Paragraph's Borders, Shading and Sort in Document mode: the Borders menu (Word's
// choices), the Borders and Shading window, a background colour for paragraphs, and sorting
// paragraphs or a table's rows.

import type { BorderLine, ParaBorders, TableData } from '../model';
import type { TextEditing } from '../text/editing';
import { fitParas, paraCount } from '../text/paragraphs';
import * as rt from '../richtext';
import type { DocFile } from '../document/doc-file';
import { BORDER_CHOICES, DEFAULT_LINE, chooseBorder, cleanBorders, hasChoice, type BorderChoice } from '../document/para-borders';
import { sortParagraphs, sortTableRows, type SortKey, type SortOptions, type SortType } from '../document/sort';
import { ask, type Field } from './ask';
import { popupMenu } from './sheet-view';

export interface DocParagraphHost {
  file(): DocFile | null;
  /** Where typing goes now (the text box or cell typed into, or the body). */
  ed(): TextEditing;
  /** The table the caret is in, if any. */
  table(): { id: number; t: TableData } | null;
  setTable(id: number, t: TableData, kind: string): void;
  flash(msg: string, ms?: number): void;
  focus(): void;
}

const LINE_STYLES: [BorderLine['style'], string][] = [['single', 'Single'], ['double', 'Double'], ['dotted', 'Dotted'], ['dashed', 'Dashed']];
const LINE_WIDTHS = ['0.25', '0.5', '0.75', '1', '1.5', '2.25', '3', '4.5', '6'];

export class DocParagraphUI {
  /** The line the Borders menu draws (set in Borders and Shading), as Word's last-used border. */
  line: BorderLine = { ...DEFAULT_LINE };

  constructor(private host: DocParagraphHost) {}

  /** The selected paragraphs' borders (the first one's). */
  private current(): ParaBorders | undefined {
    const ed = this.host.ed();
    return ed.currentPara().border;
  }

  /** Every selected paragraph has this choice already (the menu then takes it off). */
  private allHave(choice: BorderChoice): boolean {
    const ed = this.host.ed();
    const [a, b] = ed.selectedParas();
    const paras = fitParas(ed.result().paras ?? [], paraCount(ed.text));
    for (let i = a; i <= b; i++) if (!hasChoice(paras[i]?.border, choice)) return false;
    return true;
  }

  /** Home > Borders: a choice from the menu, for each selected paragraph. */
  border(choice: BorderChoice): void {
    if (!this.host.file()) return;
    const ed = this.host.ed();
    const [a, b] = ed.selectedParas();
    const paras = fitParas(ed.result().paras ?? [], paraCount(ed.text));
    const all = choice !== 'none' && choice !== 'horizontal' && this.allHave(choice);
    // each paragraph keeps its other sides
    for (let i = a; i <= b; i++) ed.setParas(i, i, { border: chooseBorder(paras[i]?.border, choice, this.line, all) }, i === a ? 'Borders' : null);
    this.host.focus();
  }

  /** The Borders menu, under its button. */
  bordersMenu(x: number, y: number): void {
    const cur = this.current();
    popupMenu(x, y, [
      ...BORDER_CHOICES.map(([c, label]) => [`${hasChoice(cur, c) && c !== 'none' ? '✓ ' : ''}${label}`, () => this.border(c)] as [string, () => void]),
      null,
      ['Borders and Shading…', () => void this.bordersDialog()],
    ]);
  }

  /** Home > Shading: a background colour behind the selected paragraphs (or none). */
  shade(fill: string | undefined): void {
    if (!this.host.file()) return;
    this.host.ed().setSelectedParas({ shade: fill && fill.toLowerCase() !== '#ffffff' ? fill : undefined }, 'Shading');
    this.host.focus();
  }

  /** Borders and Shading: each side on or off, the line's kind, width and colour, and the shading. */
  async bordersDialog(): Promise<void> {
    const f = this.host.file();
    if (!f) return;
    const ed = this.host.ed();
    const cur = cleanBorders(ed.currentPara().border) ?? {};
    const shade = ed.currentPara().shade;
    const any = cur.top ?? cur.bottom ?? cur.left ?? cur.right ?? cur.between ?? this.line;
    const side = (k: keyof ParaBorders, label: string): Field => ({ name: k, label, value: String(!!cur[k]), type: 'checkbox' });
    const got = await ask('Borders and Shading', [
      side('top', 'Top'), side('bottom', 'Bottom'), side('left', 'Left'), side('right', 'Right'), side('between', 'Between paragraphs'),
      { name: 'style', label: 'Line', value: any.style === 'none' ? 'single' : any.style, options: LINE_STYLES.map(([v, label]) => ({ value: v, label })) },
      { name: 'w', label: 'Width', value: String(any.w), unit: 'pt', options: LINE_WIDTHS.map((v) => ({ value: v, label: `${v} pt` })) },
      { name: 'color', label: 'Colour', value: any.color || '#000000', type: 'color' },
      { name: 'shaded', label: 'Shade the paragraphs', value: String(!!shade), type: 'checkbox' },
      { name: 'fill', label: 'Shading colour', value: shade ?? '#d9e2f3', type: 'color' },
    ], { ok: 'OK', note: 'For the selected paragraphs. Paragraphs one after another with the same borders share one box. Saved as Word\'s paragraph borders and shading.' });
    this.host.focus();
    if (!got || this.host.file() !== f) return;
    const line: BorderLine = { style: got.style as BorderLine['style'], w: Number(got.w) || 0.5, color: got.color || '#000000' };
    this.line = line;
    const b: ParaBorders = {};
    for (const k of ['top', 'bottom', 'left', 'right', 'between'] as const) if (got[k] === 'true') b[k] = { ...line };
    ed.setSelectedParas({ border: cleanBorders(b), shade: got.shaded === 'true' ? got.fill : undefined }, 'Borders and Shading');
  }

  // ---------------------------------------------------------------- sort

  /** Home > Sort: the selected paragraphs, or the rows of the table the caret is in. */
  async sortDialog(): Promise<void> {
    const f = this.host.file();
    if (!f) return;
    const tb = this.host.table();
    const ed = f.ed;
    const [a, b] = ed.selectedParas();
    if (!tb && a === b) { this.host.flash('Select the paragraphs to sort (or click in a table to sort its rows).'); return; }
    const cols = tb ? tb.t.cols.length : 0;
    const fieldOptions = tb
      ? Array.from({ length: cols }, (_, i) => ({ value: String(i), label: `Column ${i + 1}${tb.t.head ? `: ${rt.plainText(tb.t.rows[0]?.[i]?.runs ?? []).slice(0, 24)}` : ''}` }))
      : [{ value: '', label: 'Paragraphs (all of each)' }, ...[0, 1, 2, 3].map((i) => ({ value: String(i), label: `Field ${i + 1}` }))];
    const types = [{ value: 'text', label: 'Text' }, { value: 'number', label: 'Number' }, { value: 'date', label: 'Date' }];
    const orders = [{ value: 'asc', label: 'Ascending (A to Z, 1 to 9)' }, { value: 'desc', label: 'Descending' }];
    const got = await ask(tb ? 'Sort Table' : 'Sort Text', [
      { name: 'k1', label: 'Sort by', value: tb ? '0' : '', options: fieldOptions },
      { name: 't1', label: 'Type', value: 'text', options: types },
      { name: 'o1', label: 'Order', value: 'asc', options: orders },
      { name: 'k2', label: 'Then by', value: 'none', options: [{ value: 'none', label: '(none)' }, ...fieldOptions.filter((o) => o.value !== '')] },
      { name: 't2', label: 'Type', value: 'text', options: types },
      { name: 'o2', label: 'Order', value: 'asc', options: orders },
      ...(tb ? [] : [{ name: 'sep', label: 'Fields cut at', value: 'tab', options: [{ value: 'tab', label: 'Tabs' }, { value: 'comma', label: 'Commas' }] }]),
      { name: 'header', label: tb ? 'The first row is a heading (keep it at the top)' : 'The first paragraph is a heading (keep it at the top)', value: String(!!tb?.t.head), type: 'checkbox' },
      { name: 'case', label: 'Case sensitive (capitals first)', value: 'false', type: 'checkbox' },
    ], { ok: 'Sort', note: tb ? 'The table\'s rows go in order by the column chosen; rows that tie keep their order.' : 'The selected paragraphs go in order, each keeping its formatting; paragraphs that tie keep their order.' });
    this.host.focus();
    if (!got || this.host.file() !== f) return;
    const key = (k: string, t: string, o: string): SortKey => ({ ...(k !== '' ? { field: Number(k) } : {}), type: t as SortType, ...(o === 'desc' ? { descending: true } : {}) });
    const keys = [key(got.k1, got.t1, got.o1)];
    if (got.k2 !== 'none') keys.push(key(got.k2, got.t2, got.o2));
    const opts: SortOptions = { keys, header: got.header === 'true', caseSensitive: got.case === 'true', sep: got.sep === 'comma' ? ',' : '\t' };
    if (tb) {
      const sorted = sortTableRows(tb.t, opts);
      if (sorted === tb.t) { this.host.flash('A table with cells merged down across rows can\'t be sorted.'); return; }
      this.host.setTable(tb.id, sorted, 'Sort');
      return;
    }
    if (keys.some((k) => k.field !== undefined) && !ed.text.split('\n').slice(a, b + 1).some((s) => s.includes(opts.sep!))) {
      this.host.flash(`None of the paragraphs has ${opts.sep === ',' ? 'commas' : 'tabs'} to cut into fields: sorting by the whole paragraph instead.`);
      for (const k of keys) delete k.field;
    }
    ed.update(sortParagraphs(f.t, a, b, opts), 'Sort');
  }
}
