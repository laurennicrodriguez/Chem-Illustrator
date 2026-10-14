// Icons for the ribbons' small buttons (text alignment, lists, indents, lining things up), in
// place of their written names. Each keeps its tooltip, and its name for screen readers.

import { COMMAND_ICONS } from './command-icons';

const svg = (body: string) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">${body}</svg>`;

/** Four lines of text set left, centred, right or to both edges. */
function lines(how: 'left' | 'center' | 'right' | 'justify'): string {
  const rows = [0, 1, 2, 3].map((i) => [i % 2 && how !== 'justify' ? 8 : 12, 3 + i * 3.3] as const);
  return svg(rows.map(([w, y]) => {
    const x = how === 'left' || how === 'justify' ? 2 : how === 'center' ? 8 - w / 2 : 14 - w;
    return `<path d="M${x} ${y.toFixed(1)}h${w}"/>`;
  }).join(''));
}

/** A box with a line at its top, middle or bottom: where text sits up and down in a cell. */
function valign(at: 'top' | 'middle' | 'bottom'): string {
  const y = at === 'top' ? 5 : at === 'middle' ? 8 : 11;
  return svg(`<rect x="2" y="2" width="12" height="12" rx="1" stroke-opacity="0.55"/><path d="M5 ${y}h6" stroke-width="2"/>`);
}

const bullets = svg('<circle cx="3" cy="4" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1" fill="currentColor" stroke="none"/><path d="M6 4h8M6 8h8M6 12h8"/>');
const numbering = svg('<text x="1.2" y="5.6" font-size="5" font-family="system-ui,sans-serif" fill="currentColor" stroke="none">1</text><text x="1.2" y="9.6" font-size="5" font-family="system-ui,sans-serif" fill="currentColor" stroke="none">2</text><text x="1.2" y="13.6" font-size="5" font-family="system-ui,sans-serif" fill="currentColor" stroke="none">3</text><path d="M6 4h8M6 8h8M6 12h8"/>');
const indent = (more: boolean) => svg(`<path d="M7 4h7M7 8h7M7 12h7"/><path d="${more ? 'M2 6l2.5 2L2 10' : 'M4.5 6L2 8l2.5 2'}"/>`);

/** The icon for a ribbon button, by its data-doc, data-sh or data-cmd name. */
export const RIBBON_ICONS: Record<string, string> = {
  'doc-align-left': lines('left'), 'doc-align-center': lines('center'), 'doc-align-right': lines('right'), 'doc-justify': lines('justify'),
  'sh:align-left': lines('left'), 'sh:align-center': lines('center'), 'sh:align-right': lines('right'),
  'sh:valign-top': valign('top'), 'sh:valign-middle': valign('middle'), 'sh:valign-bottom': valign('bottom'),
  'doc-bullets': bullets, 'doc-numbering': numbering, 'doc-outdent': indent(false), 'doc-indent': indent(true),
};

/** Put icons on the ribbons' small buttons that have one; their names stay as tooltips. */
export function applyRibbonIcons(root: ParentNode = document): void {
  for (const b of root.querySelectorAll<HTMLButtonElement>('.ribbon button:not(.rb-big)')) {
    const key = b.dataset.doc ?? (b.dataset.sh ? 'sh:' + b.dataset.sh : undefined) ?? (b.classList.contains('rb-sq') ? b.dataset.cmd : undefined);
    const icon = key ? RIBBON_ICONS[key] ?? (b.dataset.cmd ? COMMAND_ICONS[b.dataset.cmd] : undefined) : undefined;
    if (!icon || b.dataset.iconed) continue;
    const name = b.title || b.textContent?.trim() || key!;
    if (!b.title) b.title = name;
    b.setAttribute('aria-label', name);
    b.innerHTML = icon;
    b.dataset.iconed = '1';
    b.classList.add('rb-iconbtn');
  }
}
