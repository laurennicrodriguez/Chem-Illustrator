// Search Commands (Alt+Q, or the search box at the top): type a few letters of what you want
// to do and pick it from the list, as in Office's "Tell me" box. It lists every menu command,
// the buttons on the ribbon showing, and the drawing tools, with their keys.

export interface CommandItem {
  /** Unique, e.g. "cmd:save" or "tool:bond-wedge". */
  id: string;
  label: string;
  /** Where it lives: "File menu", "Home tab", "Drawing tools". */
  place: string;
  /** More words that find it (its tool tip). */
  more?: string;
  key?: string;
  /** Ticked menu options show their tick. */
  checked?: boolean | null;
  run(): void;
}

const words = (s: string) => s.toLowerCase().replace(/[…'’]/g, '').split(/[^a-z0-9α-ω+#]+/).filter(Boolean);

/**
 * How well an item matches what was typed: every typed word must start a word of its name,
 * be inside its name, or start a word of where it lives or its tool tip. Names that start with
 * what was typed come first. Null when it doesn't match.
 */
export function matchScore(item: Pick<CommandItem, 'label' | 'place' | 'more'>, query: string): number | null {
  const q = words(query);
  if (!q.length) return 0;
  const name = words(item.label), joined = item.label.toLowerCase();
  const other = [...words(item.place), ...words(item.more ?? '')];
  let score = 0;
  for (const w of q) {
    if (name.includes(w)) score += 5;
    else if (name.some((n) => n.startsWith(w))) score += 4;
    else if (joined.includes(w)) score += 2;
    else if (other.some((n) => n.startsWith(w))) score += 1;
    else return null;
  }
  if (joined.startsWith(query.trim().toLowerCase())) score += 4;
  // shorter names are the more likely meaning ("Save" before "Save Workspace As")
  return score - name.length * 0.1;
}

/** The matches, best first; with nothing typed, the ones used lately first and then the rest in order. */
export function searchCommands<T extends Pick<CommandItem, 'id' | 'label' | 'place' | 'more'>>(items: T[], query: string, recent: string[] = [], max = 60): T[] {
  if (!words(query).length) {
    const rank = (t: T) => { const i = recent.indexOf(t.id); return i < 0 ? recent.length : i; };
    return items.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).slice(0, max).map((x) => x.t);
  }
  const scored: { t: T; s: number; i: number }[] = [];
  items.forEach((t, i) => {
    const s = matchScore(t, query);
    if (s !== null) scored.push({ t, s: s + (recent.includes(t.id) ? 1 : 0), i });
  });
  return scored.sort((a, b) => b.s - a.s || a.i - b.i).slice(0, max).map((x) => x.t);
}

/** Drop repeats: the same command in a menu and on the ribbon is listed once (the first). */
export function uniqueCommands<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

export class CommandSearch {
  private d: HTMLDialogElement | null = null;
  private input!: HTMLInputElement;
  private list!: HTMLUListElement;
  private items: CommandItem[] = [];
  private shown: CommandItem[] = [];
  private at = 0;
  /** Used lately, newest first (kept while the app is open). */
  private recent: string[] = [];

  constructor(private gather: () => CommandItem[]) {}

  open(): void {
    const d = this.d ?? this.build();
    this.items = this.gather();
    this.input.value = '';
    this.draw();
    if (!d.open) d.showModal();
    this.input.focus();
  }

  private build(): HTMLDialogElement {
    const d = (this.d = document.createElement('dialog'));
    d.className = 'command-search';
    d.setAttribute('aria-label', 'Search commands');
    d.innerHTML = `
      <input type="search" placeholder="What would you like to do?" aria-label="Search commands" autocomplete="off" spellcheck="false" />
      <ul role="listbox" aria-label="Commands"></ul>
      <p class="muted small cs-foot">↑ ↓ to choose, Enter to run, Esc to close</p>`;
    this.input = d.querySelector('input')!;
    this.list = d.querySelector('ul')!;
    this.input.addEventListener('input', () => { this.at = 0; this.draw(); });
    d.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (this.shown.length) this.at = (this.at + (e.key === 'ArrowDown' ? 1 : -1) + this.shown.length) % this.shown.length;
        this.mark();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.choose(this.at);
      }
    });
    this.list.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLLIElement>('li[data-i]');
      if (li) this.choose(Number(li.dataset.i));
    });
    this.list.addEventListener('pointermove', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLLIElement>('li[data-i]');
      if (li && Number(li.dataset.i) !== this.at) { this.at = Number(li.dataset.i); this.mark(); }
    });
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    document.body.append(d);
    return d;
  }

  private draw(): void {
    this.shown = searchCommands(this.items, this.input.value, this.recent, 400);
    this.at = Math.min(this.at, Math.max(0, this.shown.length - 1));
    this.list.replaceChildren(...this.shown.map((c, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.dataset.i = String(i);
      const name = document.createElement('span');
      name.className = 'cs-name';
      name.textContent = (c.checked === true ? '✓ ' : '') + c.label;
      const place = document.createElement('span');
      place.className = 'cs-place muted';
      place.textContent = c.place;
      li.append(name, place);
      if (c.key) {
        const k = document.createElement('kbd');
        k.textContent = c.key;
        li.append(k);
      }
      return li;
    }));
    if (!this.shown.length) {
      const li = document.createElement('li');
      li.className = 'muted cs-none';
      li.textContent = 'Nothing matches. Try another word, or Edit > Hotkeys for the full list of keys.';
      this.list.append(li);
    }
    this.mark();
  }

  private mark(): void {
    this.list.querySelectorAll('li[aria-selected="true"]').forEach((li) => li.setAttribute('aria-selected', 'false'));
    const li = this.list.querySelector<HTMLLIElement>(`li[data-i="${this.at}"]`);
    li?.setAttribute('aria-selected', 'true');
    li?.scrollIntoView({ block: 'nearest' });
  }

  private choose(i: number): void {
    const c = this.shown[i];
    if (!c) return;
    this.recent = [c.id, ...this.recent.filter((r) => r !== c.id)].slice(0, 8);
    this.d!.close();
    c.run();
  }
}
