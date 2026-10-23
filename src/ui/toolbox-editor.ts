// Customize Toolboxes (View > Toolboxes): every tool and command down the left, with its icon,
// and the toolbox picked at the right laid out on its grid, cell by cell, as it shows on screen,
// its icons jiggling as on a phone's home screen being rearranged. The grid's size is chosen
// (typed, or from a few presets); cells can be left empty to keep groups apart, and a thin line
// put between two rows. Drag icons from cell to cell (two swap), drag tools and commands in from
// the left, and drag them out (or click their ✕) to take them away. A fly-out palette opens like
// a folder to lay out its own grid of tools, and a tool dropped on one goes inside. Toolboxes are
// made, renamed, deleted and put in order here too. Every change shows at once in the toolbox
// itself, and Undo takes changes back one at a time.

import {
  boxGrid, boxIds, boxTitle, isEditable, isOwnBox, KEEP, overflowOf, withBoxesRestored, withBoxMoved, withFlyGrid,
  withGrid, withItemsReset, withNewBox, withoutBox, withOverflow, withTitle, type Overflow, type Pickable, type ToolboxState,
} from './toolboxes';
import { added, cutOff, emptied, GRID_PRESETS, gridItems, MAX_COLS, MAX_ROWS, placed, resized, withLine, type Grid } from './toolbox-grid';
import { inside } from './tile-drag';

export interface ToolboxEditorHooks {
  get(): ToolboxState;
  /** Use these toolboxes now (shown, and kept in the settings). */
  set(s: ToolboxState): void;
  /** Everything that can go in a toolbox, in groups, for the list on the left. */
  catalogue(): { name: string; items: Pickable[] }[];
  /** A button's name and icon. */
  describe(key: string): Pickable;
  /** A toolbox's name as the app gives it. */
  title(id: string): string;
  /** What is in one of the app's toolboxes as it comes. */
  given(id: string): readonly string[];
  /** A fly-out palette's name; null when its tools can't be changed. */
  palette(name: string): { title: string } | null;
  /** A fly-out's tools on their grid now (tool names). */
  flyGrid(name: string): Grid;
  /** Where a new toolbox of your own floats. */
  newPlace(): { x: number; y: number };
}

export class ToolboxEditor {
  private d: HTMLDialogElement | null = null;
  private box = 'custom';
  /** A fly-out opened like a folder (its palette's name), or none. */
  private folder: string | null = null;
  private undo: ToolboxState[] = [];
  private filter = '';
  /** Groups of the list folded shut (the long template lists start shut). */
  private shut = new Set<string>();
  private shutSet = false;
  /** The list on the left, read once each time the window opens. */
  private cat: { name: string; items: Pickable[] }[] = [];
  private els!: {
    list: HTMLElement; board: HTMLElement; size: HTMLElement; cols: HTMLInputElement; rows: HTMLInputElement; preset: HTMLSelectElement;
    overflow: HTMLSelectElement; fit: HTMLElement; pick: HTMLSelectElement; name: HTMLInputElement; shown: HTMLInputElement;
    del: HTMLButtonElement; up: HTMLButtonElement; down: HTMLButtonElement; crumb: HTMLElement; note: HTMLElement;
    say: HTMLElement; undo: HTMLButtonElement; reset: HTMLButtonElement; restore: HTMLButtonElement; jiggle: HTMLInputElement;
  };

  constructor(private hooks: ToolboxEditorHooks) {}

  /** Open the window at a toolbox (My Toolbox unless one is named). */
  open(id?: string): void {
    const st = this.hooks.get();
    if (id && boxIds(st).includes(id)) this.box = id;
    else if (!boxIds(st).includes(this.box)) this.box = 'custom';
    this.folder = null;
    this.undo = [];
    if (!this.d) this.build();
    this.cat = this.hooks.catalogue();
    if (!this.shutSet) {
      for (const g of this.cat) if (g.items.length > 40) this.shut.add(g.name);
      this.shutSet = true;
    }
    this.draw();
    this.say('');
    if (!this.d!.open) this.d!.showModal();
  }

  // ------------------------------------------------------------ the window

  private build(): void {
    const d = document.createElement('dialog');
    d.className = 'toolbox-dialog tbe';
    d.setAttribute('aria-label', 'Customize Toolboxes');
    d.innerHTML = `
      <h2>Customize Toolboxes</h2>
      <div class="tbe-cols">
        <div class="tbe-all">
          <input type="search" placeholder="Find a tool or command" aria-label="Find a tool or command" />
          <div class="tbe-list" role="listbox" aria-label="Tools and commands: drag one into a cell of the toolbox, or press Enter to put it in the first empty cell"></div>
        </div>
        <div class="tbe-side">
          <div class="tbe-pick">
            <select aria-label="Toolbox to change"></select>
            <button type="button" data-act="new" title="A new toolbox of your own, empty, to drag tools and commands into">New</button>
            <button type="button" data-act="up" title="Move this toolbox up the list (the View menu, and its place in a dock)" aria-label="Move up the list">↑</button>
            <button type="button" data-act="down" title="Move this toolbox down the list" aria-label="Move down the list">↓</button>
            <button type="button" data-act="delete" title="Delete this toolbox (Undo brings it back)">Delete</button>
          </div>
          <div class="tbe-name">
            <label>Name <input type="text" maxlength="60" /></label>
            <label class="check"><input type="checkbox" data-act="shown" /> Shown</label>
          </div>
          <div class="tbe-crumb" hidden></div>
          <div class="tbe-size">
            <label title="Columns across the grid">Grid <input type="number" data-act="cols" min="1" max="${MAX_COLS}" aria-label="Columns" /></label>
            <span aria-hidden="true">×</span>
            <input type="number" data-act="rows" min="1" max="${MAX_ROWS}" aria-label="Rows" title="Rows down the grid" />
            <select data-act="preset" aria-label="Grid size presets">
              <option value="">Presets…</option>
              ${GRID_PRESETS.map((p) => `<option value="${p.cols}x${p.rows}">${p.label}</option>`).join('')}
            </select>
            <label class="tbe-fit" title="When the window is too short (or narrow) for the whole grid">If there isn't room
              <select data-act="overflow">
                <option value="scroll">Scroll</option>
                <option value="wrap">Wrap into more columns</option>
              </select>
            </label>
          </div>
          <div class="tbe-board" role="grid"></div>
          <p class="tbe-note muted" hidden></p>
          <p class="tbe-say muted" aria-live="polite"></p>
        </div>
      </div>
      <div class="hk-foot tbe-foot">
        <button type="button" data-act="undo" title="Take back the last change (Ctrl+Z)">Undo</button>
        <button type="button" data-act="reset">Reset This Toolbox</button>
        <button type="button" data-act="restore" title="Bring back the toolboxes that come with the app that were deleted, with their own names">Restore Deleted Toolboxes</button>
        <label class="check" title="Off: the icons keep still. They always keep still when Windows (or your system) is set to show fewer animations."><input type="checkbox" data-act="jiggle" /> Jiggle icons</label>
        <span class="tbe-gap"></span>
        <button type="button" class="primary" data-act="done">Done</button>
      </div>`;
    const q = <T extends HTMLElement>(sel: string) => d.querySelector<T>(sel)!;
    this.els = {
      list: q('.tbe-list'), board: q('.tbe-board'), size: q('.tbe-size'), cols: q('[data-act=cols]'), rows: q('[data-act=rows]'),
      preset: q('[data-act=preset]'), overflow: q('[data-act=overflow]'), fit: q('.tbe-fit'), pick: q('.tbe-pick select'),
      name: q('.tbe-name input[type=text]'), shown: q('[data-act=shown]'), del: q('[data-act=delete]'), up: q('[data-act=up]'),
      down: q('[data-act=down]'), crumb: q('.tbe-crumb'), note: q('.tbe-note'), say: q('.tbe-say'), undo: q('[data-act=undo]'),
      reset: q('[data-act=reset]'), restore: q('[data-act=restore]'), jiggle: q('[data-act=jiggle]'),
    };
    const search = q<HTMLInputElement>('input[type=search]');
    search.addEventListener('input', () => { this.filter = search.value; this.drawList(); });
    // keys stay in the window (Escape still closes it)
    d.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') return;
      e.stopPropagation();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target as Element).matches('input[type=text], input[type=search], input[type=number]')) { e.preventDefault(); this.takeBack(); }
    });
    d.addEventListener('close', () => { this.folder = null; });
    this.els.pick.addEventListener('change', () => { this.box = this.els.pick.value; this.folder = null; this.draw(); this.say(''); });
    this.els.name.addEventListener('change', () => this.change((s) => withTitle(s, this.box, this.els.name.value), false));
    this.els.shown.addEventListener('change', () => this.change((s) => ({ ...s, places: { ...s.places, [this.box]: { ...s.places[this.box], shown: this.els.shown.checked } } }), false));
    q('[data-act=new]').addEventListener('click', () => this.newBox());
    this.els.up.addEventListener('click', () => this.change((s) => withBoxMoved(s, this.box, -1), false));
    this.els.down.addEventListener('click', () => this.change((s) => withBoxMoved(s, this.box, 1), false));
    this.els.del.addEventListener('click', () => this.deleteBox());
    this.els.undo.addEventListener('click', () => this.takeBack());
    this.els.reset.addEventListener('click', () => this.reset());
    this.els.restore.addEventListener('click', () => { this.change(withBoxesRestored, false); this.say('The toolboxes that come with the app are back in View > Toolboxes, with their own names.'); });
    this.els.jiggle.addEventListener('change', () => this.change((s) => ({ ...s, jiggle: this.els.jiggle.checked ? undefined : false }), false));
    this.els.cols.addEventListener('change', () => this.resize(Number(this.els.cols.value), this.grid().rows));
    this.els.rows.addEventListener('change', () => this.resize(this.grid().cols, Number(this.els.rows.value)));
    this.els.preset.addEventListener('change', () => {
      const [c, r] = this.els.preset.value.split('x').map(Number);
      this.els.preset.value = '';
      if (c && r) this.resize(c, r);
    });
    this.els.overflow.addEventListener('change', () => this.change((s) => withOverflow(s, this.box, this.els.overflow.value as Overflow), false));
    q('[data-act=done]').addEventListener('click', () => d.close());
    document.body.append(d);
    this.d = d;
  }

  private say(text: string): void {
    this.els.say.textContent = text;
  }

  /** Make a change (kept for Undo), show it everywhere, and draw the window again. */
  private change(f: (s: ToolboxState) => ToolboxState, show = true): void {
    const before = this.hooks.get();
    let next = f(before);
    if (next === before) return;
    // a toolbox being filled shows, so the change can be seen
    if (show && next.places[this.box] && !next.places[this.box].shown) next = { ...next, places: { ...next.places, [this.box]: { ...next.places[this.box], shown: true } } };
    this.undo.push(before);
    if (this.undo.length > 100) this.undo.shift();
    this.hooks.set(next);
    this.draw();
  }

  private takeBack(): void {
    const s = this.undo.pop();
    if (!s) return;
    this.hooks.set(s);
    if (!boxIds(s).includes(this.box)) this.box = 'custom';
    if (this.folder && !this.hooks.palette(this.folder)) this.folder = null;
    this.draw();
    this.say('Took back the last change.');
  }

  private newBox(): void {
    const st = this.hooks.get();
    let n = 1;
    const names = new Set(boxIds(st).map((id) => boxTitle(st, id, this.hooks.title(id))));
    while (names.has(`Toolbox ${n}`)) n++;
    const made = withNewBox(st, `Toolbox ${n}`, this.hooks.newPlace());
    this.undo.push(st);
    this.hooks.set(made.state);
    this.box = made.id;
    this.folder = null;
    this.draw();
    this.say('A new toolbox, floating over the drawing: name it, pick its grid size, then drag tools and commands into its cells from the left.');
    this.els.name.focus();
    this.els.name.select();
  }

  private deleteBox(): void {
    const st = this.hooks.get();
    const name = boxTitle(st, this.box, this.hooks.title(this.box));
    if (KEEP.includes(this.box)) return;
    this.change((s) => withoutBox(s, this.box), false);
    this.box = 'custom' === this.box || !boxIds(this.hooks.get()).includes('custom') ? 'main' : 'custom';
    this.folder = null;
    this.draw();
    this.say(`Deleted ${name}. Undo brings it back${isOwnBox(this.box) ? '' : ', and so does Restore Deleted Toolboxes for the app’s own'}.`);
  }

  private reset(): void {
    if (this.folder) {
      const name = this.folder;
      this.change((s) => withFlyGrid(s, name, null));
      this.say('The fly-out has its own tools again, laid out as they come.');
      return;
    }
    const st = this.hooks.get();
    if (isOwnBox(this.box)) { const g = this.grid(); this.setGrid({ cols: g.cols, rows: g.rows, cells: g.cells.map(() => null) }); }
    else this.change((s) => withItemsReset(s, this.box, this.hooks.given(this.box)));
    this.say(isOwnBox(this.box) ? 'Emptied the toolbox (its grid keeps its size).' : `${boxTitle(st, this.box, this.hooks.title(this.box))} has what it comes with again, laid out as it comes.`);
  }

  // ------------------------------------------------------------ the grid being changed

  /** The grid showing now: the toolbox's, or the open fly-out's (its cells tool names). */
  private grid(): Grid {
    if (this.folder) return this.hooks.flyGrid(this.folder);
    return boxGrid(this.hooks.get(), this.box, this.hooks.given(this.box));
  }

  /** A cell's button as a key ("tool:…" in a fly-out). */
  private keyOf(cell: string): string {
    return this.folder ? `tool:${cell}` : cell;
  }

  /** What goes in a cell for a key (a fly-out's cells hold tool names). */
  private cellOf(key: string): string {
    return this.folder ? key.slice(5) : key;
  }

  /** The keys in the grid now. */
  private keys(): string[] {
    return gridItems(this.grid()).map((c) => this.keyOf(c));
  }

  private setGrid(g: Grid): void {
    const folder = this.folder;
    if (folder) this.change((s) => withFlyGrid(s, folder, g));
    else this.change((s) => withGrid(s, this.box, g));
  }

  /** A new size for the grid: the buttons stay in their cells, and it asks first before any are cut off. */
  private resize(cols: number, rows: number): void {
    const g = this.grid();
    cols = Math.max(1, Math.min(MAX_COLS, Math.round(cols) || g.cols));
    rows = Math.max(1, Math.min(MAX_ROWS, Math.round(rows) || g.rows));
    if (cols === g.cols && rows === g.rows) { this.draw(); return; }
    const lost = cutOff(g, cols, rows);
    if (lost.length) {
      const names = lost.map((k) => this.hooks.describe(this.keyOf(k)).label);
      const list = names.length > 6 ? `${names.slice(0, 6).join(', ')} and ${names.length - 6} more` : names.join(', ');
      if (!window.confirm(`A ${cols} × ${rows} grid leaves no room for ${lost.length === 1 ? 'this button' : `these ${lost.length} buttons`}: ${list}.\n\nMake it ${cols} × ${rows} anyway, taking ${lost.length === 1 ? 'it' : 'them'} out? (Undo brings ${lost.length === 1 ? 'it' : 'them'} back.)`)) { this.draw(); return; }
    }
    this.setGrid(resized(g, cols, rows));
    this.say(`The grid is ${cols} × ${rows} now${lost.length ? `; took out ${lost.length}` : ''}.`);
  }

  private draw(): void {
    const st = this.hooks.get();
    const ids = boxIds(st);
    const { pick, name, shown, del, up, down, undo, reset, restore, jiggle } = this.els;
    pick.replaceChildren(...ids.map((id) => {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = boxTitle(st, id, this.hooks.title(id)) + (st.places[id]?.shown ? '' : ' (hidden)');
      return o;
    }));
    pick.value = this.box;
    name.value = boxTitle(st, this.box, this.hooks.title(this.box));
    shown.checked = !!st.places[this.box]?.shown;
    // the side panel always shows
    shown.disabled = this.box === 'details';
    del.disabled = KEEP.includes(this.box);
    del.title = del.disabled ? 'This toolbox can’t be deleted (it can be hidden: untick Shown)' : 'Delete this toolbox (Undo brings it back)';
    up.disabled = ids[0] === this.box;
    down.disabled = ids[ids.length - 1] === this.box;
    undo.disabled = !this.undo.length;
    restore.hidden = !st.removed?.length && !Object.keys(st.titles ?? {}).length;
    jiggle.checked = st.jiggle !== false;
    const editable = isEditable(this.box);
    reset.hidden = !editable;
    reset.textContent = this.folder ? 'Reset This Fly-out' : isOwnBox(this.box) ? 'Empty This Toolbox' : 'Reset This Toolbox';
    this.d!.classList.toggle('still', st.jiggle === false);
    this.drawCrumb();
    this.drawBoard();
    this.drawList();
  }

  private drawCrumb(): void {
    const { crumb } = this.els;
    crumb.hidden = !this.folder;
    crumb.replaceChildren();
    if (!this.folder) return;
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = `‹ ${boxTitle(this.hooks.get(), this.box, this.hooks.title(this.box))}`;
    back.title = 'Back to the toolbox';
    back.addEventListener('click', () => { this.folder = null; this.draw(); });
    const t = document.createElement('span');
    t.textContent = `${this.hooks.palette(this.folder)?.title ?? ''} fly-out, as it opens: drag its tools from cell to cell, in from the left, or out to take them away`;
    crumb.append(back, t);
  }

  // ------------------------------------------------------------ the toolbox, cell by cell

  private drawBoard(): void {
    const { board, note, size, cols, rows, overflow, fit } = this.els;
    board.replaceChildren();
    const editable = isEditable(this.box);
    board.hidden = size.hidden = !editable;
    note.hidden = editable;
    if (!editable) {
      note.textContent = this.box === 'details'
        ? 'The side panel shows the Style, Warnings and Analysis boxes (Format in documents, Cell in sheets). You can rename it, and move it in the list.'
        : 'The app lays this toolbox out itself. You can rename it, show or hide it, move it in the list, or delete it. To choose your own buttons, make a New toolbox.';
      return;
    }
    const g = this.grid();
    cols.value = String(g.cols);
    rows.value = String(g.rows);
    fit.hidden = !!this.folder;
    overflow.value = overflowOf(this.hooks.get(), this.box);
    // a gutter down the left for the lines between rows (not in a fly-out), then the cells
    const gutter = !this.folder;
    board.classList.toggle('lines', gutter);
    board.style.gridTemplateColumns = `${gutter ? '14px ' : ''}repeat(${g.cols}, minmax(38px, auto))`;
    const lines = new Set(g.lines ?? []);
    for (let r = 0; r < g.rows; r++) {
      if (gutter) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tbe-rule' + (lines.has(r) ? ' on' : '');
        b.disabled = r === 0;
        if (r) {
          b.title = lines.has(r) ? 'Take away the line above this row' : 'Put a thin line above this row, to set a group apart';
          b.setAttribute('aria-label', b.title);
          b.setAttribute('aria-pressed', String(lines.has(r)));
          b.addEventListener('click', () => this.setGrid(withLine(this.grid(), r, !lines.has(r))));
        } else b.setAttribute('aria-hidden', 'true');
        board.append(b);
      }
      for (let c = 0; c < g.cols; c++) board.append(this.cell(g, r * g.cols + c, lines.has(r)));
    }
    if (!gridItems(g).length) this.say(this.folder ? 'Nothing in this fly-out: it won’t show. Drag tools in from the left.' : 'Empty: drag tools and commands into its cells from the left.');
  }

  private cell(g: Grid, i: number, lineAbove: boolean): HTMLElement {
    const k = g.cells[i];
    const cell = document.createElement('div');
    cell.className = 'tbe-cell' + (k ? '' : ' empty') + (lineAbove ? ' line-above' : '');
    cell.dataset.i = String(i);
    cell.setAttribute('role', 'gridcell');
    cell.tabIndex = i === 0 ? 0 : -1;
    const r = Math.floor(i / g.cols) + 1, c = (i % g.cols) + 1;
    if (!k) {
      cell.title = `Empty cell (row ${r}, column ${c}): drag a tool or command here`;
      cell.setAttribute('aria-label', `Empty, row ${r}, column ${c}`);
    } else {
      const key = this.keyOf(k);
      const it = this.hooks.describe(key);
      cell.title = `${it.label}. Drag to another cell (two swap), or out to take it away${key.startsWith('pal:') ? '; click to lay out its tools' : ''}. Ctrl+arrow keys move it, Delete takes it out.`;
      cell.setAttribute('aria-label', `${it.label}, row ${r}, column ${c}`);
      const t = document.createElement('div');
      t.className = 'tbe-tile' + (key.startsWith('pal:') ? ' folder' : '');
      t.dataset.key = key;
      const wig = document.createElement('div');
      wig.className = 'tbe-wig';
      // a different start in the jiggle for each, as on the phone
      wig.style.animationDelay = `${-((i * 37) % 23) / 100}s`;
      wig.append(this.icon(key));
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'tbe-x';
      x.textContent = '×';
      x.title = `Take ${it.label} out`;
      x.setAttribute('aria-label', x.title);
      x.tabIndex = -1;
      x.addEventListener('pointerdown', (e) => e.stopPropagation());
      x.addEventListener('click', () => this.remove(i));
      t.append(wig, x);
      cell.append(t);
      cell.addEventListener('pointerdown', (e) => this.press(e, key, i, cell));
    }
    cell.addEventListener('keydown', (e) => this.cellKey(e, i));
    return cell;
  }

  /** A fly-out's icon: its tool in the first cell, with the corner mark the toolbox shows. */
  private folderIcon(palette: string): HTMLElement {
    const box = document.createElement('div');
    box.className = 'tbe-fly';
    const first = gridItems(this.hooks.flyGrid(palette))[0];
    box.innerHTML = (first && this.hooks.describe(`tool:${first}`).icon) ?? '';
    const mark = document.createElement('span');
    mark.className = 'tbe-fly-mark';
    box.append(mark);
    return box;
  }

  private remove(i: number): void {
    const g = this.grid();
    const k = g.cells[i];
    if (!k) return;
    this.setGrid(emptied(g, i));
    this.say(`Took ${this.hooks.describe(this.keyOf(k)).label} out.`);
    this.focusCell(i);
  }

  private focusCell(i: number): void {
    const cells = this.els.board.querySelectorAll<HTMLElement>('.tbe-cell');
    cells.forEach((c) => { c.tabIndex = -1; });
    const c = this.els.board.querySelector<HTMLElement>(`.tbe-cell[data-i="${i}"]`);
    if (c) { c.tabIndex = 0; c.focus(); }
  }

  private cellKey(e: KeyboardEvent, i: number): void {
    const g = this.grid();
    const r = Math.floor(i / g.cols), c = i % g.cols;
    const dr = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0, dc = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (dr || dc) {
      e.preventDefault();
      const nr = Math.max(0, Math.min(g.rows - 1, r + dr)), nc = Math.max(0, Math.min(g.cols - 1, c + dc));
      const j = nr * g.cols + nc;
      const k = g.cells[i];
      if (j !== i && k && (e.ctrlKey || e.altKey || e.metaKey)) { const n = placed(g, k, j); if (n) this.setGrid(n); }
      this.focusCell(j);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.remove(i);
    } else if ((e.key === 'Enter' || e.key === ' ') && g.cells[i]?.startsWith('pal:') && !this.folder) {
      e.preventDefault();
      this.openFolder(g.cells[i]!.slice(4));
    }
  }

  private openFolder(palette: string): void {
    if (this.folder) return;
    if (!this.hooks.palette(palette)) { this.say('This fly-out’s tools come from your own templates (save one with Chemistry > Nicknames and Templates > Save as Template).'); return; }
    this.folder = palette;
    this.draw();
    this.focusCell(0);
  }

  // ------------------------------------------------------------ the list down the left

  private drawList(): void {
    const { list } = this.els;
    const q = this.filter.trim().toLowerCase();
    const inBox = new Set(isEditable(this.box) ? this.keys() : []);
    list.replaceChildren();
    for (const g of this.cat) {
      const items = g.items.filter((it) => (!q || it.label.toLowerCase().includes(q) || g.name.toLowerCase().includes(q)) && (!this.folder || it.key.startsWith('tool:')));
      if (!items.length) continue;
      const shut = !q && this.shut.has(g.name);
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'tbe-group';
      head.setAttribute('aria-expanded', String(!shut));
      head.textContent = `${shut ? '▸' : '▾'} ${g.name}`;
      head.addEventListener('click', () => { if (this.shut.has(g.name)) this.shut.delete(g.name); else this.shut.add(g.name); this.drawList(); });
      list.append(head);
      if (shut) continue;
      for (const it of items) list.append(this.row(it, inBox.has(it.key)));
    }
  }

  private row(it: Pickable, there: boolean): HTMLElement {
    const r = document.createElement('div');
    r.className = 'tbe-row' + (there ? ' there' : '');
    r.dataset.key = it.key;
    r.tabIndex = 0;
    r.setAttribute('role', 'option');
    r.setAttribute('aria-selected', String(there));
    r.title = there ? `${it.label}: in this ${this.folder ? 'fly-out' : 'toolbox'} (drag to move it to another cell)` : `Drag ${it.label} into a cell of the ${this.folder ? 'fly-out' : 'toolbox'}, or click + to put it in the first empty cell`;
    const ic = document.createElement('span');
    ic.className = 'tbe-row-ic';
    if (it.icon) ic.innerHTML = it.icon;
    else { ic.classList.add('word'); ic.textContent = initials(it.label); }
    const name = document.createElement('span');
    name.className = 'tbe-row-name';
    name.textContent = it.label;
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'tbe-add';
    add.textContent = there ? '✓' : '+';
    add.title = there ? 'Already there' : 'Put it in the first empty cell (a row is added when the grid is full)';
    add.setAttribute('aria-label', `${add.title}: ${it.label}`);
    add.tabIndex = -1;
    add.disabled = there || !isEditable(this.box);
    add.addEventListener('pointerdown', (e) => e.stopPropagation());
    add.addEventListener('click', () => this.addFirst(it.key));
    r.append(ic, name, add);
    r.addEventListener('pointerdown', (e) => this.press(e, it.key, null, r));
    r.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !there) { e.preventDefault(); this.addFirst(it.key); } });
    return r;
  }

  /** Whether a key can go in the grid showing (say why not). */
  private fits(key: string): boolean {
    if (!isEditable(this.box)) { this.say('Pick or make a toolbox you can put buttons in (New makes one).'); return false; }
    if (this.folder && !key.startsWith('tool:')) { this.say('A fly-out holds drawing tools only.'); return false; }
    return true;
  }

  /** Put a button in the first empty cell (a row added when the grid is full). */
  private addFirst(key: string): void {
    if (!this.fits(key)) return;
    const g = this.grid();
    const n = added(g, this.cellOf(key));
    if (n === g) return;
    this.setGrid(n);
    this.say(`Put ${this.hooks.describe(key).label} in${n.rows > g.rows ? ', in a new row at the foot' : ''}.`);
  }

  /** Put a button in a cell: one in the grid moves (two swap); one from the list pushes what is there along to the next empty cell. */
  private putAt(key: string, at: number): void {
    if (!this.fits(key)) return;
    const n = placed(this.grid(), this.cellOf(key), at);
    if (!n) { this.say('No empty cell for what is there to move to: make the grid bigger first.'); this.draw(); return; }
    this.setGrid(n);
    this.say(`Put ${this.hooks.describe(key).label} in.`);
  }

  // ------------------------------------------------------------ dragging

  /**
   * Press on a button in the grid (`from` its cell) or a row of the list (`from` null): after a
   * small move it lifts and follows the pointer, and the cell it would go to lights up. Let go
   * over a cell to put it there, over a fly-out's middle to put a tool inside, or away from the
   * grid to take it out. A press that doesn't move is a click (it opens a fly-out).
   */
  private press(e: PointerEvent, key: string, from: number | null, el: HTMLElement): void {
    if (e.button !== 0) return;
    const { board } = this.els;
    const d = this.d!;
    const x0 = e.clientX, y0 = e.clientY;
    let ghost: HTMLElement | null = null;
    let over: HTMLElement | null = null;
    let into = false, out = false;
    const light = (on: boolean) => { over?.classList.toggle(into ? 'drop-in' : 'drop-at', on); };
    const move = (m: PointerEvent) => {
      if (!ghost) {
        if (Math.hypot(m.clientX - x0, m.clientY - y0) < 5) return;
        if (!this.fits(key)) { done(); return; }
        ghost = document.createElement('div');
        ghost.className = 'tbe-ghost';
        ghost.append(this.icon(key));
        d.append(ghost);
        d.classList.add('dragging');
        if (from !== null) el.classList.add('hole');
      }
      m.preventDefault();
      ghost.style.left = `${m.clientX}px`;
      ghost.style.top = `${m.clientY}px`;
      light(false);
      const b = board.getBoundingClientRect();
      out = !(m.clientX > b.left - 16 && m.clientX < b.right + 16 && m.clientY > b.top - 16 && m.clientY < b.bottom + 16);
      const hit = out ? null : (document.elementFromPoint(m.clientX, m.clientY) as Element | null)?.closest<HTMLElement>('.tbe-cell') ?? null;
      over = hit && board.contains(hit) ? hit : null;
      // over a fly-out's middle, a tool goes inside it
      const k = over ? this.grid().cells[Number(over.dataset.i)] : null;
      into = !!over && !this.folder && key.startsWith('tool:') && !!k?.startsWith('pal:') && inside(over, m.clientX, m.clientY, 0.22);
      light(true);
      ghost.classList.toggle('removing', out && from !== null);
    };
    const done = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      d.classList.remove('dragging');
      el.classList.remove('hole');
      light(false);
      ghost?.remove();
    };
    const up = () => {
      const was = ghost;
      done();
      if (!was) { if (from !== null && key.startsWith('pal:')) this.openFolder(key.slice(4)); return; }
      if (out) { if (from !== null) this.remove(from); return; }
      if (!over) return;
      const at = Number(over.dataset.i);
      if (into) this.dropInto(key, from, this.grid().cells[at]!.slice(4));
      else if (at !== from) this.putAt(key, at);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** A tool dropped on a fly-out goes inside it (in its first empty cell), leaving the toolbox when it came from there. */
  private dropInto(key: string, from: number | null, palette: string): void {
    const pal = this.hooks.palette(palette);
    if (!pal) { this.say('That fly-out holds your own templates only.'); return; }
    const fg = this.hooks.flyGrid(palette);
    const tool = key.slice(5);
    if (fg.cells.includes(tool)) { this.say(`${this.hooks.describe(key).label} is in that fly-out already.`); return; }
    this.change((s) => {
      let n = withFlyGrid(s, palette, added(fg, tool));
      if (from !== null) n = withGrid(n, this.box, emptied(this.grid(), from));
      return n;
    });
    this.say(`Put ${this.hooks.describe(key).label} in the ${pal.title} fly-out.`);
  }

  /** A button's picture, as the toolbox shows it. */
  private icon(key: string): HTMLElement {
    const it = this.hooks.describe(key);
    const ic = document.createElement('div');
    ic.className = 'tbe-ic';
    if (key.startsWith('pal:')) ic.append(this.folderIcon(key.slice(4)));
    else if (it.icon) ic.innerHTML = it.icon;
    else { ic.classList.add('word'); ic.textContent = initials(it.label); }
    return ic;
  }
}
/** Up to two letters for a command with no icon of its own. */
export function initials(label: string): string {
  const words = label.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase();
}
