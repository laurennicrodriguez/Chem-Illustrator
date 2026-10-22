// Ribbons in a narrow window, as Office does it: when the groups don't fit, the groups at the
// right end drop their buttons' words first (icons only, the words stay in the tooltips), and
// if that is not enough they fold into one button each, named after the group, that drops the
// group's buttons down below it.

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

let queued = false;
/** Fit every ribbon showing (after a change of window size, mode or ribbon tab). */
export function fitRibbons(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    for (const row of rows()) if (row.offsetParent) fitRow(row);
  });
}

/** Keep the ribbons fitted: on resizing, on picking a ribbon tab, and when a ribbon or panel comes into view. */
export function watchRibbons(): void {
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
    // a click on a dropped-down group's button closes it, as a click anywhere else does
    if (!t.closest?.('.rb-fold-btn') && !t.closest?.('.rb-popped input, .rb-popped select')) closePopped();
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopped(); });
  window.addEventListener('resize', () => closePopped());
  fitRibbons();
}
