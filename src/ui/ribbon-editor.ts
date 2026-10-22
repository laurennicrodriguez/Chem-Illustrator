// Customize the Ribbon (View menu, or right-click a ribbon's tabs): the same jiggling icons as
// Customize Toolboxes, for the ribbons of Slides, Documents, Sheets and Designs. Pick a ribbon:
// its tabs show as a row to drag into your order, rename or hide; the tab picked shows its groups
// as icons to drag about, drag onto another tab to move them there, or drag out (or ✕) to hide.
// New Group makes a group of your own, which opens like a folder to drag commands into from the
// list on the left. Every change shows at once in the ribbon; Undo takes them back one at a time.

import { inserted, moved, type Pickable } from './toolboxes';
import { groupLayout, tabOrder, type RibbonInfo, type RibbonPrefs, type RibbonsPrefs } from './ribbon-custom';
import { dragTile, inside } from './tile-drag';
import { initials } from './toolbox-editor';

export interface RibbonEditorHooks {
  ribbons(): RibbonInfo[];
  get(): RibbonsPrefs;
  /** Use these ribbons now (laid out, and kept in the settings). */
  set(p: RibbonsPrefs): void;
  /** The top menus' commands, in groups, with their icons. */
  menus(): { name: string; items: Pickable[] }[];
  /** Whether icons jiggle (the Customize Toolboxes switch). */
  jiggle(): boolean;
}

/** A ribbon button's name: its own words, or its tool tip's first phrase when it only shows a sign. */
function buttonLabel(b: HTMLElement): string {
  const t = b.cloneNode(true) as HTMLElement;
  t.querySelectorAll('.rb-icon, .sw, svg, kbd').forEach((x) => x.remove());
  const own = t.textContent!.replace(/[▾…]/g, '').replace(/\s+/g, ' ').trim();
  const tip = (b.title || b.getAttribute('aria-label') || '').replace(/\s*\(.*?\)/g, '').split(/[.:;,] /)[0].trim();
  return own.length > 2 ? own : tip || own;
}

/** A ribbon button's picture, if it has one. */
function buttonIcon(b: Element | null | undefined): string | undefined {
  if (!b) return undefined;
  const svg = b.querySelector('svg');
  if (svg) return svg.outerHTML;
  const ic = b.querySelector('.rb-icon');
  return ic?.textContent?.trim() ? `<span class="tbe-glyph">${ic.textContent.trim().replace(/[&<>]/g, '')}</span>` : undefined;
}

const keyOf = (b: HTMLElement) => (b.dataset.cmd ? `cmd:${b.dataset.cmd}` : b.dataset.sh ? `sh:${b.dataset.sh}` : b.dataset.doc ? `doc:${b.dataset.doc}` : '');

export class RibbonEditor {
  private d: HTMLDialogElement | null = null;
  private ribbon = 'slides';
  private tab = '';
  /** A group opened (its key), or none. */
  private group: string | null = null;
  private undo: RibbonsPrefs[] = [];
  private filter = '';
  private shut = new Set<string>();
  private els!: {
    pick: HTMLSelectElement; tabs: HTMLElement; tabName: HTMLInputElement; tabShown: HTMLInputElement; grid: HTMLElement;
    crumb: HTMLElement; gname: HTMLInputElement; gnameRow: HTMLElement; gdel: HTMLButtonElement; list: HTMLElement; say: HTMLElement;
    undo: HTMLButtonElement; note: HTMLElement; tabRow: HTMLElement;
  };

  constructor(private hooks: RibbonEditorHooks) {}

  /** Open the window at a ribbon (the one showing, as a rule). */
  open(ribbon?: string): void {
    if (!this.d) this.build();
    const ids = this.hooks.ribbons().map((r) => r.id);
    if (ribbon && ids.includes(ribbon)) this.ribbon = ribbon;
    this.tab = '';
    this.group = null;
    this.undo = [];
    this.draw();
    this.say('');
    if (!this.d!.open) this.d!.showModal();
  }

  private info(): RibbonInfo { return this.hooks.ribbons().find((r) => r.id === this.ribbon)!; }
  private prefs(): RibbonPrefs { return this.hooks.get()[this.ribbon] ?? {}; }

  private build(): void {
    const d = document.createElement('dialog');
    d.className = 'toolbox-dialog tbe rbe';
    d.setAttribute('aria-label', 'Customize the Ribbon');
    d.innerHTML = `
      <h2>Customize the Ribbon</h2>
      <div class="tbe-cols">
        <div class="tbe-all">
          <input type="search" placeholder="Find a command" aria-label="Find a command" />
          <div class="tbe-list" role="listbox" aria-label="Commands and hidden groups: drag one in"></div>
        </div>
        <div class="tbe-side">
          <div class="tbe-pick">
            <select aria-label="Ribbon to change"></select>
            <button type="button" data-act="new" title="A group of your own on this tab, to drag commands into">New Group</button>
          </div>
          <div class="rbe-tabs tbe-grid" role="list" aria-label="Tabs: drag to put them in order; drop a group on one to move it there"></div>
          <div class="tbe-name rbe-tab-row">
            <label>Tab <input type="text" maxlength="40" data-act="tab-name" /></label>
            <label class="check"><input type="checkbox" data-act="tab-shown" /> Shown</label>
          </div>
          <div class="tbe-crumb" hidden></div>
          <div class="tbe-name rbe-group-row" hidden>
            <label>Group <input type="text" maxlength="40" data-act="group-name" /></label>
            <button type="button" data-act="group-delete">Delete Group</button>
          </div>
          <div class="tbe-grid rbe-groups" role="list"></div>
          <p class="tbe-note muted" hidden></p>
          <p class="tbe-say muted" aria-live="polite"></p>
        </div>
      </div>
      <div class="hk-foot tbe-foot">
        <button type="button" data-act="undo" title="Take back the last change (Ctrl+Z)">Undo</button>
        <button type="button" data-act="reset" title="This ribbon as it comes: its tabs and groups back in place, your own groups gone">Reset This Ribbon</button>
        <span class="tbe-gap"></span>
        <button type="button" class="primary" data-act="done">Done</button>
      </div>`;
    const q = <T extends HTMLElement>(sel: string) => d.querySelector<T>(sel)!;
    this.els = {
      pick: q('.tbe-pick select'), tabs: q('.rbe-tabs'), tabName: q('[data-act=tab-name]'), tabShown: q('[data-act=tab-shown]'),
      grid: q('.rbe-groups'), crumb: q('.tbe-crumb'), gname: q('[data-act=group-name]'), gnameRow: q('.rbe-group-row'), gdel: q('[data-act=group-delete]'),
      list: q('.tbe-list'), say: q('.tbe-say'), undo: q('[data-act=undo]'), note: q('.tbe-note'), tabRow: q('.rbe-tab-row'),
    };
    const search = q<HTMLInputElement>('input[type=search]');
    search.addEventListener('input', () => { this.filter = search.value; this.drawList(); });
    d.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') return;
      e.stopPropagation();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target as Element).matches('input[type=text], input[type=search]')) { e.preventDefault(); this.takeBack(); }
    });
    this.els.pick.addEventListener('change', () => { this.ribbon = this.els.pick.value; this.tab = ''; this.group = null; this.draw(); this.say(''); });
    this.els.tabName.addEventListener('change', () => {
      const v = this.els.tabName.value.trim();
      this.change((p) => ({ ...p, tabNames: { ...p.tabNames, [this.tab]: v || this.info().tabs.get(this.tab)!.name } }));
    });
    this.els.tabShown.addEventListener('change', () => this.change((p) => {
      const hidden = new Set(p.hiddenTabs ?? []);
      if (this.els.tabShown.checked) hidden.delete(this.tab); else hidden.add(this.tab);
      return { ...p, hiddenTabs: [...hidden] };
    }));
    this.els.gname.addEventListener('change', () => {
      const g = this.group!, v = this.els.gname.value.trim();
      if (!v) return;
      if (g.startsWith('own:')) this.change((p) => ({ ...p, own: { ...p.own, [g.slice(4)]: { ...p.own![g.slice(4)], title: v } } }));
      else this.change((p) => ({ ...p, groupNames: { ...p.groupNames, [g]: v } }));
    });
    this.els.gdel.addEventListener('click', () => {
      const g = this.group!;
      const name = this.groupName(g);
      this.change((p) => {
        const own = { ...p.own };
        delete own[g.slice(4)];
        const groups: Record<string, string[]> = {};
        for (const [t, l] of Object.entries(p.groups ?? {})) groups[t] = l.filter((x) => x !== g);
        return { ...p, own, groups };
      });
      this.group = null;
      this.draw();
      this.say(`Deleted ${name}. Undo brings it back.`);
    });
    q('[data-act=new]').addEventListener('click', () => this.newGroup());
    this.els.undo.addEventListener('click', () => this.takeBack());
    q('[data-act=reset]').addEventListener('click', () => {
      this.change(() => ({}));
      this.group = null;
      this.draw();
      this.say(`The ${this.info().title} ribbon is as it comes again.`);
    });
    q('[data-act=done]').addEventListener('click', () => d.close());
    document.body.append(d);
    this.d = d;
  }

  private say(t: string): void { this.els.say.textContent = t; }

  /** Change this ribbon's settings (kept for Undo), lay it out, and draw the window again. */
  private change(f: (p: RibbonPrefs) => RibbonPrefs): void {
    const before = this.hooks.get();
    const next = { ...before, [this.ribbon]: f(before[this.ribbon] ?? {}) };
    this.undo.push(before);
    if (this.undo.length > 100) this.undo.shift();
    this.hooks.set(next);
    this.draw();
  }

  private takeBack(): void {
    const p = this.undo.pop();
    if (!p) return;
    this.hooks.set(p);
    if (this.group?.startsWith('own:') && !p[this.ribbon]?.own?.[this.group.slice(4)]) this.group = null;
    this.draw();
    this.say('Took back the last change.');
  }

  /** The groups of each tab, in order, as things are now. */
  private layout(): Record<string, string[]> { return groupLayout(this.info().plan, this.prefs()); }

  private groupName(key: string): string {
    const p = this.prefs();
    if (key.startsWith('own:')) return p.own?.[key.slice(4)]?.title ?? 'My Commands';
    return p.groupNames?.[key] ?? this.info().groups.get(key)?.name ?? key;
  }

  private tabName(key: string): string { return this.prefs().tabNames?.[key] ?? this.info().tabs.get(key)?.name ?? key; }

  /** Put the tab's groups in this order (the tab keeps them there from now on). */
  private setGroups(tab: string, list: string[], p: RibbonPrefs): RibbonPrefs {
    const groups: Record<string, string[]> = {};
    // a group is in one tab only
    for (const [t, l] of Object.entries(p.groups ?? {})) groups[t] = l.filter((g) => !list.includes(g));
    groups[tab] = list;
    return { ...p, groups };
  }

  private newGroup(): void {
    const id = Date.now().toString(36);
    const tab = this.tab;
    this.change((p) => this.setGroups(tab, [...this.layout()[tab], `own:${id}`], { ...p, own: { ...p.own, [id]: { title: 'My Commands', items: [] } } }));
    this.group = `own:${id}`;
    this.draw();
    this.say('A new group at the end of this tab: name it, then drag commands into it from the left.');
    this.els.gname.focus();
    this.els.gname.select();
  }

  // ------------------------------------------------------------ drawing

  private draw(): void {
    const ribbons = this.hooks.ribbons();
    const info = this.info();
    const p = this.prefs();
    this.d!.classList.toggle('still', !this.hooks.jiggle());
    this.els.pick.replaceChildren(...ribbons.map((r) => new Option(`${r.title} ribbon`, r.id)));
    this.els.pick.value = this.ribbon;
    const order = tabOrder(info.plan, p);
    if (!order.includes(this.tab)) this.tab = order.find((k) => !info.tabs.get(k)?.button?.hidden) ?? order[0];
    // the tabs, as a row of their own
    const tabbed = !!info.tabs.get(this.tab)?.button;
    this.els.tabs.hidden = !tabbed;
    this.els.tabRow.hidden = !tabbed || !!this.group;
    this.els.tabs.replaceChildren(...order.map((k, i) => this.tabChip(k, i)));
    this.els.tabName.value = this.tabName(this.tab);
    this.els.tabShown.checked = !p.hiddenTabs?.includes(this.tab);
    this.els.undo.disabled = !this.undo.length;
    this.drawCrumb();
    this.drawGrid();
    this.drawList();
  }

  private tabChip(key: string, i: number): HTMLElement {
    const t = document.createElement('div');
    const p = this.prefs();
    const sometimes = !!this.info().tabs.get(key)?.button?.classList.contains('rb-context');
    t.className = 'tbe-tile rbe-tab' + (key === this.tab ? ' on' : '') + (p.hiddenTabs?.includes(key) ? ' off' : '');
    t.dataset.key = key;
    t.tabIndex = 0;
    t.setAttribute('role', 'listitem');
    t.title = `${this.tabName(key)}${sometimes ? ' (shows only when it applies)' : ''}${p.hiddenTabs?.includes(key) ? ' (hidden)' : ''}. Click to change its groups; drag to move it; drop a group on it to move the group here.`;
    const wig = document.createElement('div');
    wig.className = 'tbe-wig';
    wig.style.animationDelay = `${-((i * 37) % 23) / 100}s`;
    wig.textContent = this.tabName(key);
    t.append(wig);
    t.addEventListener('pointerdown', (e) => dragTile(e, {
      grid: this.els.tabs, layer: this.d!, from: i, el: t,
      ghost: () => { const g = document.createElement('div'); g.className = 'rbe-tab-ghost'; g.textContent = this.tabName(key); return g; },
      stand: () => this.tabChip(key, -1),
      click: () => { this.tab = key; this.group = null; this.draw(); },
      drop: (w) => {
        if (w.kind !== 'at' || w.at === i) { this.draw(); return; }
        const order = tabOrder(this.info().plan, this.prefs());
        this.change((p) => ({ ...p, tabs: moved(order, i, w.at) }));
      },
    }));
    t.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      const order = tabOrder(this.info().plan, this.prefs());
      if (step && (e.ctrlKey || e.altKey)) { e.preventDefault(); this.change((p) => ({ ...p, tabs: moved(order, i, Math.max(0, i + step)) })); this.els.tabs.querySelector<HTMLElement>(`[data-key="${key}"]`)?.focus(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.tab = key; this.group = null; this.draw(); }
    });
    return t;
  }

  private drawCrumb(): void {
    const { crumb, gnameRow, gname, gdel } = this.els;
    crumb.hidden = gnameRow.hidden = !this.group;
    crumb.replaceChildren();
    if (!this.group) return;
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = `‹ ${this.tabName(this.tab)}`;
    back.addEventListener('click', () => { this.group = null; this.draw(); });
    const own = this.group.startsWith('own:');
    const t = document.createElement('span');
    t.textContent = own ? 'Your group: drag commands in from the left, about, or out to take them away' : 'Rename this group here. Its buttons are laid out by the app; for your own choice, make a New Group.';
    crumb.append(back, t);
    gname.value = this.groupName(this.group);
    gdel.hidden = !own;
  }

  /** The tab's groups as icons, or an open group of your own's commands. */
  private drawGrid(): void {
    const { grid, note } = this.els;
    grid.replaceChildren();
    note.hidden = true;
    if (this.group && !this.group.startsWith('own:')) {
      // a group of the ribbon's: its buttons, to see what is in it
      grid.classList.add('preview');
      const el = this.info().groups.get(this.group)?.el;
      for (const b of el?.querySelectorAll<HTMLElement>('button[data-cmd], button[data-sh], button[data-doc]') ?? []) {
        if (b.classList.contains('rb-fold-btn')) continue;
        grid.append(this.tile(keyOf(b), -1, { key: keyOf(b), label: buttonLabel(b), icon: buttonIcon(b) }, true));
      }
      return;
    }
    grid.classList.remove('preview');
    const keys = this.keys();
    keys.forEach((k, i) => grid.append(this.tile(k, i)));
    if (!keys.length) {
      const empty = document.createElement('p');
      empty.className = 'tbe-empty muted';
      empty.textContent = this.group ? 'Empty: drag commands in from the left.' : 'No groups on this tab: drag hidden groups back from the left, or make a New Group.';
      grid.append(empty);
    }
  }

  /** What the grid holds: the tab's groups (hidden ones too, shown faint), or your group's commands. */
  private keys(): string[] {
    if (this.group) return this.prefs().own?.[this.group.slice(4)]?.items ?? [];
    const hidden = new Set(this.prefs().hiddenGroups ?? []);
    return (this.layout()[this.tab] ?? []).filter((g) => !hidden.has(g));
  }

  /** A command's name and picture, from this ribbon's buttons or the menus. */
  private describe(key: string): Pickable {
    if (key.startsWith('g:') || key.startsWith('own:')) {
      const el = key.startsWith('own:') ? null : this.info().groups.get(key)?.el;
      const first = el?.querySelector('button svg, .rb-icon')?.closest('button');
      return { key, label: this.groupName(key), icon: buttonIcon(first) };
    }
    const [kind, ...rest] = key.split(':');
    const name = rest.join(':');
    const attr = kind === 'cmd' ? 'data-cmd' : kind === 'sh' ? 'data-sh' : 'data-doc';
    const b = [...this.info().el.querySelectorAll<HTMLElement>(`button[${attr}="${CSS.escape(name)}"]`)].find((x) => !x.closest('.rb-own'));
    if (b) return { key, label: buttonLabel(b), icon: buttonIcon(b) };
    for (const g of this.hooks.menus()) { const it = g.items.find((x) => x.key === key); if (it) return it; }
    return { key, label: name };
  }

  private tile(key: string, i: number, it = this.describe(key), still = false): HTMLElement {
    const t = document.createElement('div');
    t.className = 'tbe-tile' + (key.startsWith('own:') ? ' folder' : '');
    t.dataset.key = key;
    t.dataset.i = String(i);
    t.tabIndex = 0;
    t.setAttribute('role', 'listitem');
    t.setAttribute('aria-label', it.label);
    const wig = document.createElement('div');
    wig.className = 'tbe-wig';
    wig.style.animationDelay = `${-((i * 37) % 23) / 100}s`;
    const ic = document.createElement('div');
    ic.className = 'tbe-ic';
    if (it.icon) ic.innerHTML = it.icon; else { ic.classList.add('word'); ic.textContent = initials(it.label); }
    const name = document.createElement('div');
    name.className = 'tbe-name-tag';
    name.textContent = it.label;
    wig.append(ic, name);
    t.append(wig);
    if (still) { t.title = it.label; return t; }
    const isGroup = !this.group;
    t.title = isGroup
      ? `${it.label}. Click to open it; drag to move it, onto a tab to move it there; drag out, ✕ or Delete to hide it.`
      : `${it.label}. Drag to move it; drag out, ✕ or Delete to take it out.`;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'tbe-x';
    x.textContent = '×';
    x.title = isGroup ? `Hide ${it.label} (drag it back from the left to show it again)` : `Take ${it.label} out`;
    x.setAttribute('aria-label', x.title);
    x.tabIndex = -1;
    x.addEventListener('pointerdown', (e) => e.stopPropagation());
    x.addEventListener('click', () => this.remove(i));
    t.append(x);
    t.addEventListener('pointerdown', (e) => this.press(e, key, i, t));
    t.addEventListener('keydown', (e) => {
      const n = this.keys().length;
      const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
      if (step && (e.ctrlKey || e.altKey || e.metaKey)) {
        e.preventDefault();
        const j = Math.max(0, Math.min(n - 1, i + step));
        if (j !== i) { this.put(moved(this.keys(), i, j)); this.els.grid.querySelector<HTMLElement>(`[data-i="${j}"]`)?.focus(); }
      } else if (step) { e.preventDefault(); this.els.grid.querySelector<HTMLElement>(`[data-i="${Math.max(0, Math.min(n - 1, i + step))}"]`)?.focus(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.remove(i); }
      else if ((e.key === 'Enter' || e.key === ' ') && isGroup) { e.preventDefault(); this.group = key; this.draw(); }
    });
    return t;
  }

  /** The grid's contents put in this order (the tab's groups, or your group's commands). */
  private put(keys: string[]): void {
    const g = this.group;
    if (g) { this.change((p) => ({ ...p, own: { ...p.own, [g.slice(4)]: { ...p.own![g.slice(4)], items: keys } } })); return; }
    // hidden groups keep their places among the others
    const tab = this.tab;
    const hidden = new Set(this.prefs().hiddenGroups ?? []);
    const all = this.layout()[tab] ?? [];
    const kept = all.filter((x) => hidden.has(x) && !keys.includes(x));
    this.change((p) => this.setGroups(tab, [...keys, ...kept], { ...p, hiddenGroups: (p.hiddenGroups ?? []).filter((x) => !keys.includes(x)) }));
  }

  private remove(i: number): void {
    const keys = this.keys();
    const key = keys[i];
    const label = this.describe(key).label;
    if (this.group) { this.put(keys.filter((_, j) => j !== i)); this.say(`Took ${label} out.`); return; }
    this.change((p) => ({ ...p, hiddenGroups: [...new Set([...(p.hiddenGroups ?? []), key])] }));
    this.say(`Hid ${label}: drag it back from Hidden groups on the left to show it again.`);
  }

  private press(e: PointerEvent, key: string, from: number | null, el: HTMLElement): void {
    const isGroupKey = key.startsWith('g:') || key.startsWith('own:');
    dragTile(e, {
      grid: this.els.grid, layer: this.d!, from, el,
      ghost: () => { const t = this.tile(key, -1, undefined, true); return t.querySelector('.tbe-ic')!; },
      stand: () => this.tile(key, -1, undefined, true),
      canStart: () => {
        if (this.group && !this.group.startsWith('own:')) { this.say('A group of the ribbon’s keeps its own buttons: make a New Group for your own choice.'); return false; }
        if (!this.group && !isGroupKey) { this.say('Commands go in a group of your own: click New Group (or open one of yours), then drag them in.'); return false; }
        if (this.group && isGroupKey) { this.say('Go back to the tab (‹ at the top) to put a group there.'); return false; }
        return true;
      },
      // a group dropped on another tab moves there
      target: isGroupKey && !this.group ? (x, y) => [...this.els.tabs.querySelectorAll<HTMLElement>('.rbe-tab')].find((t) => t.dataset.key !== this.tab && inside(t, x, y)) ?? null : undefined,
      click: () => { if (from !== null && isGroupKey) { this.group = key; this.draw(); } },
      drop: (w) => {
        const keys = this.keys();
        if (w.kind === 'target') {
          const to = w.el.dataset.key!;
          const list = [...(this.layout()[to] ?? []).filter((g) => g !== key), key];
          this.change((p) => { const n = this.setGroups(to, list, p); return { ...n, hiddenGroups: (n.hiddenGroups ?? []).filter((x) => x !== key) }; });
          this.say(`Moved ${this.describe(key).label} to the ${this.tabName(to)} tab.`);
        } else if (w.kind === 'at') {
          if (from === null) this.put(inserted(keys, key, w.at));
          else if (w.at !== from) this.put(moved(keys, from, w.at));
          else this.draw();
          if (from === null) this.say(`Put ${this.describe(key).label} in.`);
        } else if (from !== null) this.remove(from);
        else this.draw();
      },
    });
  }

  // ------------------------------------------------------------ the list on the left

  /** Hidden groups (to show again), this ribbon's commands by tab and group, and the menus' commands. */
  private catalogue(): { name: string; items: Pickable[] }[] {
    const info = this.info();
    const p = this.prefs();
    const out: { name: string; items: Pickable[] }[] = [];
    const hidden = (p.hiddenGroups ?? []).filter((g) => g.startsWith('own:') ? !!p.own?.[g.slice(4)] : info.groups.has(g));
    out.push({ name: 'Hidden groups', items: hidden.map((g) => this.describe(g)) });
    for (const t of info.plan.tabs) {
      for (const g of t.groups) {
        const el = info.groups.get(g)!.el;
        const items: Pickable[] = [];
        const seen = new Set<string>();
        for (const b of el.querySelectorAll<HTMLElement>('button[data-cmd], button[data-sh], button[data-doc]')) {
          const k = keyOf(b);
          if (!k || seen.has(k)) continue;
          seen.add(k);
          items.push({ key: k, label: buttonLabel(b), icon: buttonIcon(b) });
        }
        if (items.length) out.push({ name: `${info.tabs.get(t.key)!.name} › ${info.groups.get(g)!.name}`, items });
      }
    }
    for (const g of this.hooks.menus()) out.push(g);
    return out;
  }

  private drawList(): void {
    const { list } = this.els;
    const q = this.filter.trim().toLowerCase();
    const inGroup = new Set(this.group?.startsWith('own:') ? this.keys() : []);
    list.replaceChildren();
    for (const g of this.catalogue()) {
      const items = g.items.filter((it) => !q || it.label.toLowerCase().includes(q) || g.name.toLowerCase().includes(q));
      if (!items.length) continue;
      // (the menus' long lists start shut)
      const shut = !q && (this.shut.has(g.name) || (!this.shut.has(`open:${g.name}`) && g.name.endsWith(' menu')));
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'tbe-group';
      head.setAttribute('aria-expanded', String(!shut));
      head.textContent = `${shut ? '▸' : '▾'} ${g.name}`;
      head.addEventListener('click', () => {
        if (shut) { this.shut.delete(g.name); this.shut.add(`open:${g.name}`); } else { this.shut.add(g.name); this.shut.delete(`open:${g.name}`); }
        this.drawList();
      });
      list.append(head);
      if (shut) continue;
      for (const it of items) list.append(this.row(it, inGroup.has(it.key)));
    }
  }

  private row(it: Pickable, there: boolean): HTMLElement {
    const r = document.createElement('div');
    r.className = 'tbe-row' + (there ? ' there' : '');
    r.dataset.key = it.key;
    r.tabIndex = 0;
    r.setAttribute('role', 'option');
    const isGroup = it.key.startsWith('g:') || it.key.startsWith('own:');
    r.title = isGroup ? `Drag ${it.label} onto the tab to show it again, or click +` : `Drag ${it.label} into a group of your own, or click + to put it at the end of the one open`;
    const ic = document.createElement('span');
    ic.className = 'tbe-row-ic';
    if (it.icon) ic.innerHTML = it.icon; else { ic.classList.add('word'); ic.textContent = initials(it.label); }
    const name = document.createElement('span');
    name.className = 'tbe-row-name';
    name.textContent = it.label;
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'tbe-add';
    add.textContent = there ? '✓' : '+';
    add.tabIndex = -1;
    add.disabled = there || (isGroup ? !!this.group : !this.group?.startsWith('own:'));
    add.title = add.disabled ? (isGroup ? 'Go back to the tab to show it there' : 'Open a group of your own first (New Group makes one)') : 'Put it at the end';
    add.setAttribute('aria-label', `${add.title}: ${it.label}`);
    add.addEventListener('pointerdown', (e) => e.stopPropagation());
    const addIt = () => { this.put(inserted(this.keys(), it.key, this.keys().length)); this.say(`Put ${it.label} in.`); };
    add.addEventListener('click', addIt);
    r.append(ic, name, add);
    r.addEventListener('pointerdown', (e) => this.press(e, it.key, null, r));
    r.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !add.disabled) { e.preventDefault(); addIt(); } });
    return r;
  }
}
