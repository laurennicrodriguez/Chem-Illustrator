// Customize Toolboxes (View > Toolboxes): every tool and command down the left, with its icon,
// and the toolbox picked at the right laid out as it is, its icons jiggling as on a phone's home
// screen being rearranged. Drag icons about to reorder them, drag tools and commands in from the
// left, and drag them out (or click their ✕) to take them away; the others slide aside to make
// room. A fly-out palette opens like a folder to rearrange its tools, and a tool dropped on one
// goes inside. Toolboxes are made, renamed, deleted and put in order here too. Every change
// shows at once in the toolbox itself, and Undo takes changes back one at a time.

import {
  boxIds, boxItems, boxTitle, inserted, isEditable, isOwnBox, KEEP, moved, withBoxesRestored, withBoxMoved,
  withFlyout, withItems, withItemsReset, withNewBox, withoutBox, withTitle, type Pickable, type ToolboxState,
} from './toolboxes';
import { dragTile, inside } from './tile-drag';

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
  /** A fly-out palette: its name, and its tools as they come; null when its tools can't be changed. */
  palette(name: string): { title: string; given: readonly string[] } | null;
  /** The tools a fly-out holds now. */
  flyout(name: string): string[];
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
    list: HTMLElement; grid: HTMLElement; pick: HTMLSelectElement; name: HTMLInputElement; shown: HTMLInputElement;
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
          <div class="tbe-list" role="listbox" aria-label="Tools and commands: drag one into the toolbox, or press Enter to add it at the end"></div>
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
          <div class="tbe-grid" role="list"></div>
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
      list: q('.tbe-list'), grid: q('.tbe-grid'), pick: q('.tbe-pick select'), name: q('.tbe-name input[type=text]'),
      shown: q('[data-act=shown]'), del: q('[data-act=delete]'), up: q('[data-act=up]'), down: q('[data-act=down]'),
      crumb: q('.tbe-crumb'), note: q('.tbe-note'), say: q('.tbe-say'), undo: q('[data-act=undo]'), reset: q('[data-act=reset]'),
      restore: q('[data-act=restore]'), jiggle: q('[data-act=jiggle]'),
    };
    const search = q<HTMLInputElement>('input[type=search]');
    search.addEventListener('input', () => { this.filter = search.value; this.drawList(); });
    // keys stay in the window (Escape still closes it)
    d.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') return;
      e.stopPropagation();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target as Element).matches('input[type=text], input[type=search]')) { e.preventDefault(); this.takeBack(); }
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
    this.say('A new toolbox, floating over the drawing: name it, then drag tools and commands into it from the left.');
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
      this.change((s) => withFlyout(s, name, null));
      this.say('The fly-out has its own tools again.');
      return;
    }
    const st = this.hooks.get();
    if (isOwnBox(this.box)) this.change((s) => withItems(s, this.box, []));
    else this.change((s) => withItemsReset(s, this.box, this.hooks.given(this.box)));
    this.say(isOwnBox(this.box) ? 'Emptied the toolbox.' : `${boxTitle(st, this.box, this.hooks.title(this.box))} has what it comes with again.`);
  }

  /** What the grid shows now: the toolbox's buttons, or the open fly-out's tools (as "tool:" keys). */
  private keys(): string[] {
    if (this.folder) return this.hooks.flyout(this.folder).map((t) => `tool:${t}`);
    return boxItems(this.hooks.get(), this.box, this.hooks.given(this.box));
  }

  /** The grid's buttons changed. */
  private setKeys(keys: string[]): void {
    const folder = this.folder;
    if (folder) this.change((s) => withFlyout(s, folder, keys.filter((k) => k.startsWith('tool:')).map((k) => k.slice(5))));
    else this.change((s) => withItems(s, this.box, keys));
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
    this.drawGrid();
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
    t.textContent = `${this.hooks.palette(this.folder)?.title ?? ''} fly-out: drag its tools about, in from the left, or out to take them away`;
    crumb.append(back, t);
  }

  // ------------------------------------------------------------ the toolbox, as icons

  private drawGrid(): void {
    const { grid, note } = this.els;
    grid.replaceChildren();
    const editable = isEditable(this.box);
    grid.hidden = !editable;
    note.hidden = editable;
    if (!editable) {
      note.textContent = this.box === 'details'
        ? 'The side panel shows the Style, Warnings and Analysis boxes (Format in documents, Cell in sheets). You can rename it, and move it in the list.'
        : 'The app lays this toolbox out itself. You can rename it, show or hide it, move it in the list, or delete it. To choose your own buttons, make a New toolbox.';
      return;
    }
    const keys = this.keys();
    keys.forEach((k, i) => grid.append(this.tile(k, i)));
    if (!keys.length) {
      const empty = document.createElement('p');
      empty.className = 'tbe-empty muted';
      empty.textContent = this.folder ? 'Nothing in this fly-out: it won’t show. Drag tools in from the left.' : 'Empty: drag tools and commands in from the left.';
      grid.append(empty);
    }
  }

  private tile(key: string, i: number): HTMLElement {
    const it = this.hooks.describe(key);
    const t = document.createElement('div');
    t.className = 'tbe-tile';
    t.dataset.key = key;
    t.dataset.i = String(i);
    t.tabIndex = 0;
    t.setAttribute('role', 'listitem');
    t.title = `${it.label}. Drag to move; drag out, ✕ or Delete to take out${key.startsWith('pal:') ? '; click to open its tools' : ''}. Ctrl+arrow keys move it.`;
    t.setAttribute('aria-label', it.label);
    const wig = document.createElement('div');
    wig.className = 'tbe-wig';
    // a different start in the jiggle for each, as on the phone
    wig.style.animationDelay = `${-((i * 37) % 23) / 100}s`;
    const ic = document.createElement('div');
    ic.className = 'tbe-ic';
    if (key === 'sep') { t.classList.add('sep'); ic.innerHTML = '<span class="tbe-bar"></span>'; }
    else if (key.startsWith('pal:')) { t.classList.add('folder'); ic.append(this.folderIcon(key.slice(4))); }
    else if (it.icon) ic.innerHTML = it.icon;
    else { ic.classList.add('word'); ic.textContent = initials(it.label); }
    const name = document.createElement('div');
    name.className = 'tbe-name-tag';
    name.textContent = key === 'sep' ? 'Divider' : it.label;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'tbe-x';
    x.textContent = '×';
    x.title = `Take ${it.label} out`;
    x.setAttribute('aria-label', x.title);
    x.tabIndex = -1;
    x.addEventListener('pointerdown', (e) => e.stopPropagation());
    x.addEventListener('click', () => this.remove(i));
    wig.append(ic, name);
    t.append(wig, x);
    t.addEventListener('pointerdown', (e) => this.press(e, key, i, t));
    t.addEventListener('keydown', (e) => this.tileKey(e, key, i));
    return t;
  }

  /** A fly-out's icon: its first four tools, small, as a phone shows a folder. */
  private folderIcon(palette: string): HTMLElement {
    const box = document.createElement('div');
    box.className = 'tbe-folder';
    for (const tool of this.hooks.flyout(palette).slice(0, 4)) {
      const m = document.createElement('span');
      m.innerHTML = this.hooks.describe(`tool:${tool}`).icon ?? '';
      box.append(m);
    }
    return box;
  }

  private remove(i: number): void {
    const keys = this.keys();
    const label = this.hooks.describe(keys[i]).label;
    this.setKeys(keys.filter((_, j) => j !== i));
    this.say(`Took ${label} out.`);
    this.focusTile(Math.min(i, this.keys().length - 1));
  }

  private focusTile(i: number): void {
    this.els.grid.querySelector<HTMLElement>(`.tbe-tile[data-i="${i}"]`)?.focus();
  }

  private tileKey(e: KeyboardEvent, key: string, i: number): void {
    const n = this.keys().length;
    const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
    if (step && (e.ctrlKey || e.altKey || e.metaKey)) {
      e.preventDefault();
      const j = Math.max(0, Math.min(n - 1, i + step));
      if (j !== i) { this.setKeys(moved(this.keys(), i, j)); this.focusTile(j); }
    } else if (step) {
      e.preventDefault();
      this.focusTile(Math.max(0, Math.min(n - 1, i + step)));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.remove(i);
    } else if ((e.key === 'Enter' || e.key === ' ') && key.startsWith('pal:')) {
      e.preventDefault();
      this.openFolder(key.slice(4));
    }
  }

  private openFolder(palette: string): void {
    if (this.folder) return;
    if (!this.hooks.palette(palette)) { this.say('This fly-out’s tools come from your own templates (save one with Chemistry > Nicknames and Templates > Save as Template).'); return; }
    this.folder = palette;
    this.draw();
    this.focusTile(0);
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
      for (const it of items) list.append(this.row(it, inBox.has(it.key) && it.key !== 'sep'));
    }
  }

  private row(it: Pickable, there: boolean): HTMLElement {
    const r = document.createElement('div');
    r.className = 'tbe-row' + (there ? ' there' : '');
    r.dataset.key = it.key;
    r.tabIndex = 0;
    r.setAttribute('role', 'option');
    r.setAttribute('aria-selected', String(there));
    r.title = there ? `${it.label}: in this ${this.folder ? 'fly-out' : 'toolbox'} (drag to move it there)` : `Drag ${it.label} into the ${this.folder ? 'fly-out' : 'toolbox'}, or click + to put it at the end`;
    const ic = document.createElement('span');
    ic.className = 'tbe-row-ic';
    if (it.key === 'sep') ic.innerHTML = '<span class="tbe-bar"></span>';
    else if (it.icon) ic.innerHTML = it.icon;
    else { ic.classList.add('word'); ic.textContent = initials(it.label); }
    const name = document.createElement('span');
    name.className = 'tbe-row-name';
    name.textContent = it.label;
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'tbe-add';
    add.textContent = there ? '✓' : '+';
    add.title = there ? 'Already there' : 'Put it at the end';
    add.setAttribute('aria-label', `${add.title}: ${it.label}`);
    add.tabIndex = -1;
    add.disabled = there || !isEditable(this.box);
    add.addEventListener('pointerdown', (e) => e.stopPropagation());
    add.addEventListener('click', () => this.addAt(it.key, this.keys().length));
    r.append(ic, name, add);
    r.addEventListener('pointerdown', (e) => this.press(e, it.key, null, r));
    r.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !there) { e.preventDefault(); this.addAt(it.key, this.keys().length); } });
    return r;
  }

  /** Put a button in the grid at a place (one already there moves). */
  private addAt(key: string, at: number): void {
    if (!isEditable(this.box)) { this.say('Pick or make a toolbox you can put buttons in (New makes one).'); return; }
    if (this.folder && !key.startsWith('tool:')) { this.say('A fly-out holds drawing tools only.'); return; }
    if (this.folder && this.keys().includes(key)) return;
    this.setKeys(inserted(this.keys(), key, at));
    this.say(`Put ${this.hooks.describe(key).label} in.`);
  }

  // ------------------------------------------------------------ dragging

  /**
   * Press on an icon in the grid (`from` its place) or a row of the list (`from` null): after a
   * small move it lifts and follows the pointer, and the grid makes room where it would go.
   * Let go over the grid to put it there, over a fly-out to put a tool inside, or outside the
   * grid to take it out. A press that doesn't move is a click (it opens a fly-out).
   */
  private press(e: PointerEvent, key: string, from: number | null, el: HTMLElement): void {
    dragTile(e, {
      grid: this.els.grid, layer: this.d!, from, el,
      ghost: () => this.icon(key),
      stand: () => this.tile(key, -1),
      canStart: () => {
        if (isEditable(this.box)) return true;
        this.say('Pick or make a toolbox you can put buttons in (New makes one).');
        return false;
      },
      // over a fly-out's middle, a tool goes inside it
      into: (tiles, x, y) => (!this.folder && key.startsWith('tool:') ? tiles.find((t) => t.dataset.key!.startsWith('pal:') && inside(t, x, y, 0.22)) ?? null : null),
      // (the grid keeps still over a fly-out, so a tool can reach its middle)
      hold: (tiles, x, y) => !this.folder && key.startsWith('tool:') && tiles.some((t) => t.dataset.key!.startsWith('pal:') && inside(t, x, y)),
      // a click on a fly-out opens it like a folder
      click: () => { if (from !== null && key.startsWith('pal:')) this.openFolder(key.slice(4)); },
      drop: (where) => {
        const keys = this.keys();
        if (where.kind === 'into') {
          const palette = where.el.dataset.key!.slice(4);
          const tools = this.hooks.flyout(palette);
          const tool = key.slice(5);
          if (tools.includes(tool)) { this.say(`${this.hooks.describe(key).label} is in that fly-out already.`); this.draw(); return; }
          const pal = this.hooks.palette(palette);
          if (!pal) { this.say('That fly-out holds your own templates only.'); this.draw(); return; }
          this.change((s) => {
            let n = withFlyout(s, palette, [...tools, tool]);
            // dragged from the toolbox, it leaves it
            if (from !== null) n = withItems(n, this.box, keys.filter((_, j) => j !== from));
            return n;
          });
          this.say(`Put ${this.hooks.describe(key).label} in the ${pal.title} fly-out.`);
        } else if (where.kind === 'at') {
          if (from === null) this.addAt(key, where.at);
          else if (where.at !== from) this.setKeys(moved(keys, from, where.at));
          else this.draw();
        } else if (from !== null) this.remove(from);
        else this.draw();
      },
    });
  }

  /** A button's picture, as the grid shows it. */
  private icon(key: string): HTMLElement {
    const it = this.hooks.describe(key);
    const ic = document.createElement('div');
    ic.className = 'tbe-ic';
    if (key === 'sep') ic.innerHTML = '<span class="tbe-bar"></span>';
    else if (key.startsWith('pal:')) ic.append(this.folderIcon(key.slice(4)));
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
