// Ribbons in a narrow window, as Office does it: when the groups don't fit, the groups at the
// right end drop their buttons' words first (icons only, the words stay in the tooltips), and
// if that is not enough they fold into one button each, named after the group, that drops the
// group's buttons down below it.
//
// A ribbon keeps one height whichever of its tabs is open (the height of its tallest tab), and
// can be collapsed to its row of tabs (Ctrl+F1, a double-click on a tab, or the ˄ at the end of
// the tabs): then a click on a tab drops that tab's buttons over the work until they're used.

/** The rows of groups: a tabbed ribbon's panels, or a plain ribbon itself. */
function rows(): HTMLElement[] {
  const out = new Set<HTMLElement>();
  for (const g of document.querySelectorAll<HTMLElement>('.ribbon .rb-group')) if (g.parentElement) out.add(g.parentElement);
  return [...out];
}

const groupsOf = (row: HTMLElement) => [...row.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.classList.contains('rb-group'));

/** A folded group's button, made the first time the group folds. */
function foldButton(g: HTMLElement): HTMLButtonElement {
  let b = g.querySelector<HTMLButtonElement>(':scope > .rb-fold-btn');
  if (b) return b;
  b = document.createElement('button');
  b.type = 'button';
  b.className = 'rb-fold-btn';
  const name = g.querySelector('.rb-label')?.textContent?.trim() || 'More';
  b.innerHTML = `<span>${name.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)}</span><span aria-hidden="true">▾</span>`;
  b.title = `${name}: show this group's buttons`;
  b.setAttribute('aria-expanded', 'false');
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !g.classList.contains('rb-popped');
    closePopped();
    if (!open) return;
    const r = b!.getBoundingClientRect();
    g.style.setProperty('--pop-x', `${Math.max(4, r.left)}px`);
    g.style.setProperty('--pop-y', `${r.bottom + 2}px`);
    g.classList.add('rb-popped');
    b!.setAttribute('aria-expanded', 'true');
    // kept inside the window
    const box = g.querySelector<HTMLElement>(':scope > .rb-row')?.getBoundingClientRect();
    if (box && box.right > innerWidth - 4) g.style.setProperty('--pop-x', `${Math.max(4, innerWidth - 4 - box.width)}px`);
  });
  g.prepend(b);
  return b;
}

function closePopped(): void {
  for (const g of document.querySelectorAll<HTMLElement>('.rb-group.rb-popped')) {
    g.classList.remove('rb-popped');
    g.querySelector(':scope > .rb-fold-btn')?.setAttribute('aria-expanded', 'false');
  }
}

const overflows = (row: HTMLElement) => row.scrollWidth > row.clientWidth + 1;

/** Fit one row of groups to its width: words off from the right, then groups folded from the right. */
export function fitRow(row: HTMLElement): void {
  if (!row.clientWidth) return;
  const groups = groupsOf(row);
  for (const g of groups) g.classList.remove('rb-compact', 'rb-folded', 'rb-popped');
  if (!overflows(row)) return;
  for (let i = groups.length - 1; i >= 0 && overflows(row); i--) groups[i].classList.add('rb-compact');
  // the first group (Clipboard, usually) keeps its place longest
  for (let i = groups.length - 1; i >= 1 && overflows(row); i--) {
    foldButton(groups[i]);
    groups[i].classList.add('rb-folded');
  }
  // folding can free more room than it needed: give the words back where they fit, from the left
  for (const g of groups) {
    if (!g.classList.contains('rb-compact') || g.classList.contains('rb-folded')) continue;
    g.classList.remove('rb-compact');
    if (overflows(row)) { g.classList.add('rb-compact'); break; }
  }
}

/** Give a tabbed ribbon the height of its tallest tab, so it keeps one height whichever tab is open. */
function evenHeights(ribbon: HTMLElement): void {
  const panels = [...ribbon.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.classList.contains('rb-panel'));
  if (panels.length < 2) return;
  ribbon.style.removeProperty('--rb-panel-h');
  let tallest = 0;
  for (const p of panels) {
    const was = p.hidden;
    p.hidden = false;
    tallest = Math.max(tallest, p.offsetHeight);
    p.hidden = was;
  }
  if (tallest) ribbon.style.setProperty('--rb-panel-h', `${tallest}px`);
}

let collapsed = false;
let onCollapse: (on: boolean) => void = () => {};

/** Show the ribbons as their tabs only (true), or whole. */
export function setRibbonCollapsed(on: boolean): void {
  collapsed = on;
  document.body.classList.toggle('ribbon-collapsed', on);
  for (const r of document.querySelectorAll('.ribbon.rb-peek')) r.classList.remove('rb-peek');
  for (const b of document.querySelectorAll<HTMLElement>('.rb-collapse')) {
    b.textContent = on ? '˅' : '˄';
    b.title = on ? 'Pin the ribbon open (Ctrl+F1)' : 'Collapse the ribbon to its tabs, for more room (Ctrl+F1). Click a tab to use its buttons';
    b.setAttribute('aria-label', b.title);
  }
  document.querySelector('[data-cmd="collapse-ribbon"]')?.setAttribute('aria-checked', String(on));
  if (!on) fitRibbons();
}
export const ribbonCollapsed = () => collapsed;

function toggleCollapsed(): void {
  setRibbonCollapsed(!collapsed);
  onCollapse(collapsed);
}

/** The ˄ button at the right end of each ribbon's row of tabs. */
function addCollapseButtons(): void {
  for (const tabs of document.querySelectorAll<HTMLElement>('.ribbon .rb-tabs')) {
    if (tabs.querySelector(':scope > .rb-collapse')) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rb-collapse';
    b.addEventListener('click', (e) => { e.stopPropagation(); toggleCollapsed(); });
    tabs.append(b);
  }
}

let queued = false;
/** Fit every ribbon showing (after a change of window size, mode or ribbon tab). */
export function fitRibbons(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    for (const row of rows()) if (row.offsetParent) fitRow(row);
    for (const r of document.querySelectorAll<HTMLElement>('.ribbon')) if (r.offsetParent) evenHeights(r);
  });
}

/** Keep the ribbons fitted: on resizing, on picking a ribbon tab, and when a ribbon or panel comes into view. */
export function watchRibbons(collapseChanged: (on: boolean) => void = () => {}): void {
  onCollapse = collapseChanged;
  addCollapseButtons();
  setRibbonCollapsed(collapsed);
  const widths = new WeakMap<Element, number>();
  const ro = new ResizeObserver((entries) => {
    // only a change of width matters: folding groups changes the height, which must not start it again
    if (entries.some((e) => widths.get(e.target) !== Math.round(e.contentRect.width))) fitRibbons();
    for (const e of entries) widths.set(e.target, Math.round(e.contentRect.width));
  });
  for (const r of document.querySelectorAll('.ribbon')) ro.observe(r);
  for (const row of rows()) ro.observe(row);
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest?.('.rb-tabs')) fitRibbons();
    // collapsed: a tab drops its buttons down; using one (or clicking elsewhere) puts them away
    if (collapsed) {
      const tab = t.closest?.<HTMLElement>('.rb-tabs [role="tab"]');
      const ribbon = t.closest?.<HTMLElement>('.ribbon');
      if (tab && ribbon) {
        for (const r of document.querySelectorAll('.ribbon.rb-peek')) if (r !== ribbon) r.classList.remove('rb-peek');
        ribbon.classList.add('rb-peek');
        fitRibbons();
      } else if (!ribbon || t.closest('.rb-panel button:not(.rb-fold-btn)')) {
        for (const r of document.querySelectorAll('.ribbon.rb-peek')) r.classList.remove('rb-peek');
      }
    }
    // a click on a dropped-down group's button closes it, as a click anywhere else does
    if (!t.closest?.('.rb-fold-btn') && !t.closest?.('.rb-popped input, .rb-popped select')) closePopped();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePopped();
      for (const r of document.querySelectorAll('.ribbon.rb-peek')) r.classList.remove('rb-peek');
    }
    // Ctrl+F1 collapses the ribbon or pins it open again, as in Office
    if (e.key === 'F1' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) { e.preventDefault(); toggleCollapsed(); }
  });
  document.addEventListener('dblclick', (e) => { if ((e.target as HTMLElement).closest?.('.rb-tabs [role="tab"]')) toggleCollapsed(); });
  window.addEventListener('resize', () => closePopped());
  fitRibbons();
}
