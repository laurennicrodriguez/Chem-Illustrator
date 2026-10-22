// The User Guide, inside the program: the same pages as the guide on the project's GitHub page
// (docs/), built in so they open without a network connection. A window that floats over the
// drawing (moved by its title bar, sized from its corner) with the list of pages on the left,
// a search box, and Back. F1 opens it at the part about the tool or mode in use.

import { Marked } from 'marked';

// the pages load the first time the guide opens; pictures are files beside the program
const PAGES = import.meta.glob('../../docs/**/*.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;
const PICTURES = import.meta.glob('../../docs/images/*', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

const ROOT = '../../docs/';
/** The pages in the order the contents list shows them. */
const ORDER = ['README.md', 'guide/getting-started.md', 'guide/keyboard-and-mouse.md', 'guide/drawing.md', 'guide/slides.md', 'guide/sheets.md',
  'guide/documents.md', 'guide/design.md', 'guide/files-and-sharing.md', 'guide/feedback.md', 'developers.md'];

/** A heading's anchor, made the way GitHub makes them, so links such as design.md#icons work in both places. */
export function slug(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}

/** `href` (relative to the page `from`, such as "guide/drawing.md") as a page of the guide and a heading, or null for a link elsewhere. */
export function resolveLink(from: string, href: string): { page: string; anchor: string } | null {
  if (/^[a-z]+:/i.test(href)) return null;
  const [path, anchor = ''] = href.split('#');
  if (!path) return { page: from, anchor };
  const parts = from.split('/').slice(0, -1);
  for (const p of path.split('/')) {
    if (p === '..') parts.pop();
    else if (p !== '.') parts.push(p);
  }
  return { page: parts.join('/'), anchor };
}

/** The page and heading that explain a tool (by its kind) or a mode. */
export function guideSpot(mode: string, toolKind?: string): { page: string; anchor: string } {
  const pages: Record<string, string> = { slides: 'guide/slides.md', sheet: 'guide/sheets.md', document: 'guide/documents.md', design: 'guide/design.md' };
  if (pages[mode]) return { page: pages[mode], anchor: '' };
  const tools: Record<string, string> = {
    select: 'select-and-eraser', eraser: 'select-and-eraser', bond: 'bonds-and-chains', chain: 'bonds-and-chains', ring: 'rings',
    template: 'templates', text: 'text-periodic-table-and-fragmentation', element: 'text-periodic-table-and-fragmentation',
    fragment: 'text-periodic-table-and-fragmentation', arrow: 'arrows-mechanism-symbols-shapes-and-brackets',
    symbol: 'arrows-mechanism-symbols-shapes-and-brackets', shape: 'arrows-mechanism-symbols-shapes-and-brackets',
    bracket: 'arrows-mechanism-symbols-shapes-and-brackets', line: 'arrows-mechanism-symbols-shapes-and-brackets',
    mark: 'arrows-mechanism-symbols-shapes-and-brackets',
  };
  return { page: 'guide/drawing.md', anchor: (toolKind && tools[toolKind]) || '' };
}

export class GuideWindow {
  private el: HTMLDivElement | null = null;
  private article!: HTMLElement;
  private list!: HTMLElement;
  private search!: HTMLInputElement;
  private back!: HTMLButtonElement;
  private texts = new Map<string, string>();
  private titles = new Map<string, string>();
  private history: { page: string; anchor: string }[] = [];
  private page = '';
  private md = new Marked({ gfm: true });

  /** `openLink` opens a web address in the browser. */
  constructor(private openLink: (url: string) => void) {}

  get isOpen(): boolean { return !!this.el && !this.el.hidden; }

  /** Open at a page ("guide/drawing.md") and heading anchor. */
  async open(page = 'README.md', anchor = ''): Promise<void> {
    this.build();
    this.el!.hidden = false;
    await this.loadAll();
    this.history = [];
    await this.show(page, anchor);
  }

  close(): void {
    if (this.el) this.el.hidden = true;
  }

  private build(): void {
    if (this.el) return;
    const el = document.createElement('div');
    el.className = 'guide-window';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'User Guide');
    el.innerHTML = `<div class="gw-head"><span class="gw-title">User Guide</span><button type="button" class="gw-back" title="Back (Alt+Left)" disabled>‹ Back</button>`
      + `<input type="search" class="gw-search" placeholder="Search the guide" aria-label="Search the guide"><button type="button" class="gw-close" title="Close (Esc)">×</button></div>`
      + `<div class="gw-body"><nav class="gw-list" aria-label="Pages"></nav><article class="gw-page" tabindex="-1"></article></div>`;
    this.article = el.querySelector('.gw-page')!;
    this.list = el.querySelector('.gw-list')!;
    this.search = el.querySelector('.gw-search')!;
    this.back = el.querySelector('.gw-back')!;
    el.querySelector('.gw-close')!.addEventListener('click', () => this.close());
    this.back.addEventListener('click', () => this.goBack());
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
      else if (e.key === 'ArrowLeft' && e.altKey) { e.preventDefault(); this.goBack(); }
      // the guide's keys are its own, not the drawing's
      e.stopPropagation();
    });
    this.search.addEventListener('input', () => this.find(this.search.value));
    this.article.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('a');
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute('href') ?? '';
      const to = resolveLink(this.page, href);
      if (!to) { this.openLink(href); return; }
      if (to.page.endsWith('.md') && this.texts.has(to.page)) void this.go(to.page, to.anchor);
    });
    this.wireDrag(el.querySelector('.gw-head')!, el);
    document.body.append(el);
    this.el = el;
  }

  private async loadAll(): Promise<void> {
    if (this.texts.size) return;
    await Promise.all(Object.entries(PAGES).map(async ([path, load]) => {
      const page = path.slice(ROOT.length);
      const text = await load();
      this.texts.set(page, text);
      this.titles.set(page, /^#\s+(.+)$/m.exec(text)?.[1].trim() ?? page);
    }));
    this.titles.set('README.md', 'Contents');
    const pages = [...ORDER.filter((p) => this.texts.has(p)), ...[...this.texts.keys()].filter((p) => !ORDER.includes(p))];
    this.list.replaceChildren(...pages.map((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.page = p;
      b.textContent = this.titles.get(p)!;
      b.addEventListener('click', () => { this.search.value = ''; void this.go(p, ''); });
      return b;
    }));
  }

  private async go(page: string, anchor: string): Promise<void> {
    if (this.page) this.history.push({ page: this.page, anchor: '' });
    await this.show(page, anchor);
  }

  private goBack(): void {
    const to = this.history.pop();
    if (to) void this.show(to.page, to.anchor);
  }

  private async show(page: string, anchor: string): Promise<void> {
    if (!this.texts.has(page)) page = 'README.md';
    this.page = page;
    this.back.disabled = !this.history.length;
    for (const b of this.list.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', b.dataset.page === page);
    this.article.innerHTML = await this.md.parse(this.texts.get(page)!);
    const seen = new Map<string, number>();
    for (const h of this.article.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      const s = slug(h.textContent ?? '');
      const n = seen.get(s) ?? 0;
      seen.set(s, n + 1);
      h.id = n ? `${s}-${n}` : s;
    }
    for (const img of this.article.querySelectorAll('img')) {
      const to = resolveLink(page, img.getAttribute('src') ?? '');
      const url = to && PICTURES[ROOT + to.page];
      if (url) img.src = url; else img.remove();
      img.loading = 'lazy';
    }
    const target = anchor ? this.article.querySelector<HTMLElement>(`#${CSS.escape(anchor)}`) : null;
    if (target) { target.scrollIntoView({ block: 'start' }); target.classList.add('gw-here'); }
    else this.article.scrollTop = 0;
    this.article.focus({ preventScroll: true });
  }

  /** Searching: the pages with the words, each with the headings whose sections have them. */
  private find(q: string): void {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) { void this.show(this.page, ''); return; }
    const hits: { page: string; heading: string; anchor: string }[] = [];
    for (const [page, text] of this.texts) {
      let heading = this.titles.get(page)!, anchor = '', body = '';
      const flush = () => {
        const lower = (heading + ' ' + body).toLowerCase();
        if (words.every((w) => lower.includes(w))) hits.push({ page, heading, anchor });
      };
      for (const line of text.split('\n')) {
        const h = /^#{1,6}\s+(.+)$/.exec(line);
        if (h) { flush(); heading = h[1].trim(); anchor = slug(heading); body = ''; }
        else body += line + '\n';
      }
      flush();
    }
    this.article.replaceChildren();
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = hits.length ? `${hits.length} section${hits.length === 1 ? '' : 's'} mention “${q.trim()}”.` : `Nothing in the guide mentions “${q.trim()}”.`;
    const ul = document.createElement('ul');
    ul.className = 'gw-hits';
    for (const h of hits.slice(0, 80)) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `#${h.anchor}`;
      a.textContent = h.heading;
      a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); void this.go(h.page, h.anchor); });
      const where = document.createElement('span');
      where.className = 'muted';
      where.textContent = ` (${this.titles.get(h.page)})`;
      li.append(a, where);
      ul.append(li);
    }
    this.article.append(p, ul);
  }

  private wireDrag(head: HTMLElement, el: HTMLElement): void {
    head.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button, input')) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      head.setPointerCapture(e.pointerId);
      const move = (m: PointerEvent) => {
        el.style.left = `${Math.max(0, Math.min(innerWidth - 80, m.clientX - dx))}px`;
        el.style.top = `${Math.max(0, Math.min(innerHeight - 40, m.clientY - dy))}px`;
        el.style.right = 'auto';
      };
      const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
    });
  }
}
