// File > Print: the pages are put in the window (hidden on screen), the window's print style
// shows only them, and the system's Print dialog takes it from there (printer, copies, which
// pages, or Save as PDF). They are taken away again once printing is done.

let root: HTMLDivElement | null = null;
let pageRule: HTMLStyleElement | null = null;

function clear(): void {
  root?.remove();
  pageRule?.remove();
  root = pageRule = null;
  document.body.classList.remove('printing');
}

/**
 * Print pages of one size (w × h points), each an SVG or HTML laid out at that size. Fonts and
 * pictures are those of the window, so text prints as on screen.
 */
export function printPages(what: { pages: string[]; w: number; h: number }): void {
  clear();
  root = document.createElement('div');
  root.id = 'print-root';
  pageRule = document.createElement('style');
  pageRule.textContent = `@page { size: ${what.w}pt ${what.h}pt; margin: 0; }`;
  for (const svg of what.pages) {
    const p = document.createElement('div');
    p.className = 'print-page';
    p.style.width = `${what.w}pt`;
    p.style.height = `${what.h}pt`;
    p.innerHTML = svg;
    root.append(p);
  }
  document.head.append(pageRule);
  document.body.append(root);
  document.body.classList.add('printing');
  window.addEventListener('afterprint', clear, { once: true });
  // let pictures load before the dialog takes its copy
  const pics = [...root.querySelectorAll('img')].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; }));
  void Promise.all(pics).then(() => requestAnimationFrame(() => window.print()));
}
