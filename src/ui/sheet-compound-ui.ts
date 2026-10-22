// Data > Data Types > Compound: names (or drawn structures) in cells looked up on PubChem and
// turned into compound cells, each carrying a card of the compound's properties. The card shows
// in the side panel; Insert Data adds a column of FIELDVALUE formulas beside the compounds, and
// Refresh looks the cards up again. Only the name or SMILES is sent to PubChem.

import type { SheetView } from './sheet-view';
import { popupMenu } from './sheet-view';
import type { Sheet } from '../sheet/workbook';
import { colName, cellName, keyOf, rowOf, colOf } from '../sheet/refs';
import { isError } from '../sheet/values';
import { type CompoundCard, COMPOUND_FIELDS, cardFields } from '../sheet/compound';
import { pubchemCard, PubChemError } from '../chem/pubchem';
import { followLink } from './links-ui';

export interface CompoundUiHost {
  readonly view: SheetView;
  flash(msg: string, ms?: number): void;
  edit(label: string, fn: (s: Sheet) => void): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export class SheetCompounds {
  private busy = false;

  constructor(private host: CompoundUiHost) {}

  private get view(): SheetView {
    return this.host.view;
  }

  /** The Data Types button's menu. */
  menu(x: number, y: number): void {
    const s = this.view.sheet;
    const card = s?.cell(this.view.sel.active.r, this.view.sel.active.c)?.compound;
    popupMenu(x, y, [
      ['Compound', () => void this.convert(true)],
      ['Compound, without measured properties (faster)', () => void this.convert(false)],
      null,
      ['Insert Data ▸', () => this.insertMenu(x, y), !!card],
      ['Refresh Compound Data', () => void this.refreshCards(), !!card || this.anyIn()],
      ['Convert to Text', () => this.toText(), !!card || this.anyIn()],
    ]);
  }

  private anyIn(): boolean {
    const s = this.view.sheet;
    return !!s && s.keysIn(this.view.sel.range).some((k) => !!s.cells.get(k)?.compound);
  }

  /** The cells picked that can be looked up: text, or a drawn structure (by its SMILES). */
  private targets(onlyCards: boolean): { r: number; c: number; q: { name: string } | { smiles: string } | { cid: number }; shown: string }[] {
    const v = this.view, s = v.sheet!;
    const R = s.clip(v.sel.range) ?? v.sel.range;
    const out: ReturnType<SheetCompounds['targets']> = [];
    for (let r = R.r1; r <= Math.min(R.r2, s.lastRow); r++) {
      for (let c = R.c1; c <= Math.min(R.c2, s.lastCol); c++) {
        const cell = s.cell(r, c);
        if (s.hiddenRows.has(r)) continue;
        if (onlyCards) {
          if (cell?.compound) out.push({ r, c, q: { cid: cell.compound.cid }, shown: cell.compound.name });
          continue;
        }
        if (cell?.structure) {
          const m = s.wb.chem?.structure(cell.structure);
          if (m && !isError(m)) out.push({ r, c, q: { smiles: m.smiles }, shown: s.shownText(r, c) || m.formula });
          continue;
        }
        const val = s.values.get(keyOf(r, c));
        if (typeof val === 'string' && val.trim() && !cell?.input?.startsWith('=')) out.push({ r, c, q: { name: val.trim() }, shown: val.trim() });
      }
    }
    return out;
  }

  /** Turn the cells picked into compounds (a header, a word over the names that PubChem doesn't know, is left as it is). */
  async convert(measured: boolean, onlyCards = false): Promise<void> {
    if (this.busy) { this.host.flash('Still looking up the last compounds…'); return; }
    const s = this.view.sheet;
    if (!s || s.dashboard) return;
    const list = this.targets(onlyCards);
    if (!list.length) { this.host.flash(onlyCards ? 'Pick cells holding compounds first.' : 'Pick cells with names (Aspirin, DMAP, THF), CAS numbers or drawn structures first.', 6000); return; }
    this.busy = true;
    const found: { r: number; c: number; card: CompoundCard; shown: string }[] = [];
    const missed: string[] = [];
    try {
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        this.host.flash(`Looking up ${list.length > 1 ? `${i + 1} of ${list.length}` : t.shown} on PubChem…`, 60000);
        // a card looked up again keeps its measured fields if it had them
        const want = onlyCards ? measured || COMPOUND_FIELDS.some((f) => f.slow && s.cell(t.r, t.c)?.compound?.fields[f.name] !== undefined) : measured;
        let card: CompoundCard | null;
        try {
          card = await pubchemCard(t.q, want);
        } catch (e) {
          this.host.flash(e instanceof PubChemError ? e.message : 'Could not reach PubChem.', 8000);
          if (!found.length) return;
          break;
        }
        if (card) found.push({ ...t, card: { ...card, name: t.shown } });
        else missed.push(t.shown);
      }
    } finally {
      this.busy = false;
    }
    if (!found.length) {
      this.host.flash(`PubChem doesn't know ${missed.length === 1 ? missed[0] : `any of these: ${missed.slice(0, 4).join(', ')}${missed.length > 4 ? '…' : ''}`}.`, 8000);
      return;
    }
    this.host.edit(onlyCards ? 'Refresh compound data' : 'Compound data type', (sh) => {
      for (const f of found) {
        const cell = sh.cell(f.r, f.c);
        // skip a cell changed while the look-ups ran
        if (!onlyCards && !cell?.structure && sh.values.get(keyOf(f.r, f.c)) !== f.shown) continue;
        sh.setCompound(f.r, f.c, f.card);
      }
    });
    const header = missed.length === 1 && list[0].shown === missed[0];
    this.host.flash(`${onlyCards ? 'Refreshed' : 'Made'} ${found.length} compound${found.length > 1 ? 's' : ''}.${missed.length && !header ? ` PubChem doesn't know: ${missed.slice(0, 4).join(', ')}${missed.length > 4 ? '…' : ''}` : ''} Their cards are in the side panel; Insert Data adds a column of a property.`, missed.length && !header ? 9000 : 5000);
  }

  refreshCards(): Promise<void> {
    return this.convert(false, true);
  }

  /** Make compound cells plain text again (their names stay). */
  toText(): void {
    const v = this.view, s = v.sheet!;
    const keys = s.keysIn(v.sel.range).filter((k) => !!s.cells.get(k)?.compound);
    if (!keys.length) return;
    this.host.edit('Convert to Text', (sh) => { for (const k of keys) sh.setCompound(rowOf(k), colOf(k), undefined); });
  }

  /** Insert Data: pick a field of the active cell's card. */
  insertMenu(x: number, y: number): void {
    const s = this.view.sheet;
    const card = s?.cell(this.view.sel.active.r, this.view.sel.active.c)?.compound;
    if (!card) { this.host.flash('Click a compound cell first (Data > Data Types > Compound).'); return; }
    popupMenu(x, y, cardFields(card).filter(([n]) => n !== 'Name').map(([n]) => [n, () => this.insertData(n)] as [string, () => void]));
  }

  /**
   * A column of a field beside the compounds around the active cell: a FIELDVALUE formula in each
   * row, headed with the field's name. A table grows to take it in.
   */
  insertData(field: string): void {
    const v = this.view, s = v.sheet!;
    const { r, c } = v.sel.active;
    if (!s.cell(r, c)?.compound) { this.host.flash('Click a compound cell first.'); return; }
    let r1 = r, r2 = r;
    while (r1 > 0 && s.cell(r1 - 1, c)?.compound) r1--;
    while (s.cell(r2 + 1, c)?.compound) r2++;
    const table = s.tableAt(r, c);
    const region = table?.range ?? s.currentRegion(r, c);
    const col = region.c2 + 1;
    const head = r1 > 0 && !s.cell(r1 - 1, c)?.compound && (table ? table.range.r1 === r1 - 1 : typeof s.values.get(keyOf(r1 - 1, c)) === 'string') ? r1 - 1 : -1;
    let used = false;
    for (let row = head >= 0 ? head : r1; row <= r2; row++) if (s.cell(row, col)?.input || s.cell(row, col)?.structure) used = true;
    this.host.edit(`Insert ${field}`, (sh) => {
      if (used) sh.insertCols(col, 1);
      if (head >= 0) sh.setInput(head, col, field);
      for (let row = r1; row <= r2; row++) sh.setInput(row, col, `=FIELDVALUE(${cellName(row, c)},"${field.replace(/"/g, '""')}")`);
      const t = table && sh.tables.find((x) => x.id === table.id);
      if (t && t.range.c2 === col - 1) {
        const R = { ...t.range, c2: col };
        sh.setTables(sh.tables.map((x) => (x.id === t.id ? { ...x, range: R } : x)));
        if (sh.filter && JSON.stringify(sh.filter.range) === JSON.stringify(t.range)) sh.setFilter({ ...sh.filter, range: R });
      }
    });
    this.host.flash(`Added ${field} in column ${colName(col)}.`, 3000);
  }

  /** The card, for the side panel. */
  card(card: CompoundCard, r: number, c: number): HTMLElement[] {
    const box = el('div', 'cp-compound');
    const h = el('p', 'cp-compound-title');
    h.append(el('strong', undefined, card.name));
    if (card.fields.Name && card.fields.Name !== card.name) h.append(document.createTextNode(` (PubChem: ${card.fields.Name})`));
    box.append(h);
    const t = el('table', 'cp-compound-fields');
    for (const [name, value] of cardFields(card)) {
      if (name === 'Name' || name === 'PubChem page') continue;
      const tr = el('tr');
      const add = el('button', 'cp-add', '+');
      add.type = 'button';
      add.title = `Insert Data: a column of ${name} beside the compounds`;
      add.setAttribute('aria-label', `Insert ${name}`);
      add.addEventListener('click', () => { this.view.selectCell(r, c); this.insertData(name); });
      const td = el('td');
      td.append(add);
      tr.append(el('th', undefined, name), el('td', 'cp-val', typeof value === 'number' ? String(value) : value), td);
      t.append(tr);
    }
    box.append(t);
    const row = el('div', 'cp-buttons');
    const btn = (label: string, fn: () => void, title: string) => { const b = el('button', undefined, label); b.type = 'button'; b.title = title; b.addEventListener('click', fn); row.append(b); };
    btn('Open on PubChem', () => void followLink(String(card.fields['PubChem page'] ?? `https://pubchem.ncbi.nlm.nih.gov/compound/${card.cid}`)), 'The compound\'s page on PubChem, in the browser');
    btn('Refresh', () => { this.view.selectCell(r, c); void this.refreshCards(); }, 'Look the card up on PubChem again');
    btn('Convert to Text', () => { this.view.selectCell(r, c); this.toText(); }, 'Keep the name, without the card');
    box.append(row);
    if (card.looked) box.append(el('p', 'muted', `From PubChem (CID ${card.cid}), ${new Date(card.looked).toLocaleDateString()}. In a formula: =FIELDVALUE(${cellName(r, c)},"Molecular weight").`));
    return [box];
  }
}
