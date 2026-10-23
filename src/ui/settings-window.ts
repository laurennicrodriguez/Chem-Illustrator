// The Settings window: every setting in one place, with a list of pages on the left and a search
// box, as in Office. Each page is one of the program's settings windows shown inside this one
// (the menu items that used to open them now open their page here). Saving or cancelling a
// page shows it again with what it now holds.

import { hostNextDialog } from './dialog-host';

export interface SettingsPage {
  id: string;
  title: string;
  /** Words to find it by (the names of its settings). */
  words: string;
  /** Open the page's settings window (it opens inside this one). */
  open: () => void | Promise<void>;
}

/** The pages whose title or words have every word of `q`, best first (title matches before word matches). */
export function findPages(pages: SettingsPage[], q: string): SettingsPage[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return pages;
  const has = (s: string) => words.every((w) => s.toLowerCase().includes(w));
  return [...pages.filter((p) => has(p.title)), ...pages.filter((p) => !has(p.title) && has(`${p.title} ${p.words}`))];
}

export class SettingsWindow {
  private d: HTMLDialogElement | null = null;
  private list!: HTMLElement;
  private pane!: HTMLElement;
  private search!: HTMLInputElement;
  private page = '';
  private reopen = 0;
  /** The page's own window, shown in the pane. */
  private current: HTMLDialogElement | null = null;

  constructor(private pages: SettingsPage[]) {}

  get isOpen(): boolean { return !!this.d?.open; }

  /** Open at a page (by id), or at the first. */
  open(id = this.pages[0].id): void {
    this.build();
    if (!this.d!.open) this.d!.showModal();
    this.search.value = '';
    this.fillList();
    this.show(id);
  }

  private build(): void {
    if (this.d) return;
    const d = document.createElement('dialog');
    d.className = 'settings-window';
    d.setAttribute('aria-label', 'Settings');
    d.innerHTML = `<div class="sw-head"><h2>Settings</h2><input type="search" class="sw-search" placeholder="Find a setting" aria-label="Find a setting"><button type="button" class="sw-close" title="Close (Esc)">×</button></div>`
      + `<div class="sw-body"><nav class="sw-list" aria-label="Pages"></nav><div class="sw-pane"></div></div>`;
    this.list = d.querySelector('.sw-list')!;
    this.pane = d.querySelector('.sw-pane')!;
    this.search = d.querySelector('.sw-search')!;
    d.querySelector('.sw-close')!.addEventListener('click', () => this.close());
    d.addEventListener('cancel', (e) => { e.preventDefault(); this.close(); });
    this.search.addEventListener('input', () => {
      const found = this.fillList();
      if (found.length && !found.some((p) => p.id === this.page)) this.show(found[0].id);
    });
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.pane.querySelector<HTMLElement>('input, select, textarea, button')?.focus(); }
    });
    // a page saved or cancelled closes its window: show the page again, with its new values
    new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) if (n instanceof HTMLDialogElement) this.current = n;
        for (const n of r.removedNodes) if (n === this.current) this.pageClosed();
      }
    }).observe(this.pane, { childList: true });
    this.pane.addEventListener('close', (e) => { if (e.target === this.current) this.pageClosed(); }, true);
    document.body.append(d);
    this.d = d;
  }

  private pageClosed(): void {
    this.current = null;
    clearTimeout(this.reopen);
    this.reopen = window.setTimeout(() => { if (this.d?.open && !this.current) this.show(this.page); }, 60);
  }

  close(): void {
    clearTimeout(this.reopen);
    hostNextDialog(null);
    const was = this.current;
    this.current = null;
    this.d?.close();
    this.pane?.replaceChildren();
    was?.close();
  }

  private fillList(): SettingsPage[] {
    const found = findPages(this.pages, this.search.value);
    this.list.replaceChildren(...found.map((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.page = p.id;
      b.textContent = p.title;
      b.classList.toggle('on', p.id === this.page);
      b.addEventListener('click', () => this.show(p.id));
      return b;
    }));
    if (!found.length) {
      const none = document.createElement('p');
      none.className = 'muted';
      none.textContent = 'No setting has those words.';
      this.list.append(none);
    }
    return found;
  }

  private show(id: string): void {
    const p = this.pages.find((x) => x.id === id) ?? this.pages[0];
    this.page = p.id;
    for (const b of this.list.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', b.dataset.page === p.id);
    // a page left unsaved is dropped, as Cancel would
    const was = this.current;
    this.current = null;
    this.pane.replaceChildren();
    if (was) was.close();
    clearTimeout(this.reopen);
    hostNextDialog(this.pane);
    void p.open();
  }
}
