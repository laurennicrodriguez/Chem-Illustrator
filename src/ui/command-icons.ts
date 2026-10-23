// Icons for menu commands on toolbox buttons (24×24 SVG in the current text colour, like the
// drawing tools). Drawn for this app in the usual style for these commands; a command without
// one shows its name instead.

import { ICONS } from '../icons';

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** A flat-sided hexagon centred at (cx, cy). */
function hex(cx: number, cy: number, r: number, extra = ''): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `<polygon points="${pts.join(' ')}"${extra}/>`;
}

const filled = (opacity = 0.35) => ` fill="currentColor" fill-opacity="${opacity}"`;
const txt = (x: number, y: number, s: string, size = 8, weight = 600) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" font-family="system-ui, sans-serif" fill="currentColor" stroke="none" text-anchor="middle">${s}</text>`;

export const COMMAND_ICONS: Record<string, string> = {
  // ---- object: align (the line is the edge or centre they line up on)
  'align-left': svg('<line x1="4" y1="3" x2="4" y2="21"/><rect x="6" y="6" width="13" height="4"/><rect x="6" y="14" width="8" height="4"/>'),
  'align-hcenter': svg('<line x1="12" y1="3" x2="12" y2="21" stroke-dasharray="2 2"/><rect x="5" y="6" width="14" height="4"/><rect x="8" y="14" width="8" height="4"/>'),
  'align-right': svg('<line x1="20" y1="3" x2="20" y2="21"/><rect x="5" y="6" width="13" height="4"/><rect x="10" y="14" width="8" height="4"/>'),
  'align-top': svg('<line x1="3" y1="4" x2="21" y2="4"/><rect x="6" y="6" width="4" height="13"/><rect x="14" y="6" width="4" height="8"/>'),
  'align-vcenter': svg('<line x1="3" y1="12" x2="21" y2="12" stroke-dasharray="2 2"/><rect x="6" y="5" width="4" height="14"/><rect x="14" y="8" width="4" height="8"/>'),
  'align-bottom': svg('<line x1="3" y1="20" x2="21" y2="20"/><rect x="6" y="5" width="4" height="13"/><rect x="14" y="10" width="4" height="8"/>'),
  // ---- object: spread out evenly
  'distribute-h': svg('<line x1="3" y1="4" x2="3" y2="20"/><line x1="21" y1="4" x2="21" y2="20"/><rect x="6" y="8" width="3" height="8"/><rect x="10.5" y="8" width="3" height="8"/><rect x="15" y="8" width="3" height="8"/>'),
  'distribute-v': svg('<line x1="4" y1="3" x2="20" y2="3"/><line x1="4" y1="21" x2="20" y2="21"/><rect x="8" y="6" width="8" height="3"/><rect x="8" y="10.5" width="8" height="3"/><rect x="8" y="15" width="8" height="3"/>'),
  // ---- object: flip and turn
  'flip-h': svg('<line x1="12" y1="3" x2="12" y2="21" stroke-dasharray="2 2"/><path d="M10 6v12L4 18z"' + filled() + '/><path d="M14 6v12l6 0z"/>'),
  'flip-v': svg('<line x1="3" y1="12" x2="21" y2="12" stroke-dasharray="2 2"/><path d="M6 10h12L18 4z"' + filled() + '/><path d="M6 14h12l0 6z"/>'),
  'rotate-cw': svg('<path d="M18.5 12.5a6.5 6.5 0 1 1-2.2-5"/><path d="M17 3.5v4h-4"/>'),
  'rotate-ccw': svg('<path d="M5.5 12.5a6.5 6.5 0 1 0 2.2-5"/><path d="M7 3.5v4h4"/>'),
  'rotate-180': svg('<path d="M5 12a7 7 0 0 1 14 0"/><path d="M15.5 11.5L19 12l.6-3.6"/><path d="M8 17h8" stroke-dasharray="2 2"/>'),
  // ---- object: front and back
  'shape-front': svg('<rect x="3.5" y="3.5" width="11" height="11"/><rect x="9.5" y="9.5" width="11" height="11"' + filled(0.55) + '/>'),
  'shape-back': svg('<rect x="9.5" y="9.5" width="11" height="11"' + filled(0.55) + '/><rect x="3.5" y="3.5" width="11" height="11" fill="var(--panel, #fff)"/>'),
  'shape-forward': svg('<rect x="3.5" y="3.5" width="11" height="11"/><rect x="9.5" y="9.5" width="11" height="11"' + filled(0.25) + '/><path d="M15 2.5v4M13 4.5l2-2 2 2"/>'),
  'shape-backward': svg('<rect x="9.5" y="9.5" width="11" height="11"' + filled(0.25) + '/><rect x="3.5" y="3.5" width="11" height="11" fill="var(--panel, #fff)"/><path d="M19 2.5v4M17 4.5l2 2 2-2"/>'),
  group: svg('<rect x="3" y="3" width="18" height="18" stroke-dasharray="2.5 2"/><rect x="6" y="6" width="6" height="6"/><circle cx="15" cy="15" r="3"/>'),
  ungroup: svg('<rect x="3" y="3" width="8" height="8" stroke-dasharray="2.5 2"/><rect x="13" y="13" width="8" height="8" stroke-dasharray="2.5 2"/>'),
  scale: svg('<rect x="3" y="11" width="10" height="10"/><path d="M8 3h13v13" stroke-dasharray="2 2"/><path d="M12 12l7-7M14 5h5v5"/>'),
  'rotate-dialog': svg('<path d="M18.5 12.5a6.5 6.5 0 1 1-2.2-5"/><path d="M17 3.5v4h-4"/>' + txt(11.5, 15.5, '°', 9)),
  // ---- structure
  'clean-up': svg(hex(10.5, 13, 7) + '<path d="M19 2.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" fill="currentColor" stroke="none"/>'),
  // ---- scheme: a cycle of four species with arrows round it; levels over a reaction coordinate
  'catalytic-cycle': svg('<path d="M12 4.5a7.5 7.5 0 0 1 7.5 7.5"/><path d="M19.5 12a7.5 7.5 0 0 1-7.5 7.5"/><path d="M12 19.5a7.5 7.5 0 0 1-7.5-7.5"/><path d="M4.5 12a7.5 7.5 0 0 1 7.5-7.5"/><path d="M17.6 9.6l1.9 2.4 1.9-2.4M14.4 17.6l-2.4 1.9 2.4 1.9M6.4 14.4l-1.9-2.4-1.9 2.4M9.6 6.4l2.4-1.9-2.4-1.9"/>'),
  'energy-diagram': svg('<path d="M3 3v18h18" stroke-width="1.2"/><path d="M5 17h3M10 8h3M15 13h3M20 18.5h1.5" stroke-width="2.2"/><path d="M8 17l2-9M13 8l2 5M18 13l2 5.5" stroke-dasharray="1.5 1.5" stroke-width="1"/>'),
  // ---- a diagram: a box over two, joined
  'insert-diagram': svg('<rect x="8" y="2.5" width="8" height="5" rx="1"/><rect x="2.5" y="16.5" width="8" height="5" rx="1"/><rect x="13.5" y="16.5" width="8" height="5" rx="1"/><path d="M12 7.5v4.5M6.5 16.5V12h11v4.5"/>'),
  'add-frame': svg('<rect x="2.5" y="3.5" width="19" height="17" rx="1"/>' + hex(12, 12, 5)),
  'fill-rings': svg(hex(12, 12.5, 8.5, filled(0.4))),
  highlight: svg('<path d="M3 15.5L13 5.5" stroke-width="7" stroke-opacity="0.35"/><path d="M3 15.5L13 5.5"/><path d="M13 5.5l7 4"/>'),
  'remove-highlight': svg('<path d="M3 15.5L13 5.5" stroke-width="7" stroke-opacity="0.35"/><path d="M3 15.5L13 5.5"/><path d="M15 15l6 6M21 15l-6 6"/>'),
  'chain-ends': svg('<polyline points="2,16 6,12 10,16"/>' + txt(17, 15.5, 'Me', 8.5)),
  'explicit-h': svg('<line x1="3" y1="18" x2="10" y2="11"/>' + txt(15, 11, 'H', 10)),
  'aromatic-circles': svg(hex(12, 12.5, 8.5) + '<circle cx="12" cy="12.5" r="4.6"/>'),
  'stereo-labels': svg(txt(12, 15.5, 'R/S', 9, 700)),
  'enhanced-stereo': svg(txt(12, 15.5, '&amp;1', 9, 700)),
  'contract-label': svg('<polyline points="2,15 5.5,11 9,15 12.5,11"/><path d="M14 13h4"/><path d="M16.5 11l2 2-2 2"/>' + txt(21, 9.5, 'R', 7)),
  'expand-label': svg(txt(4.5, 9.5, 'R', 7) + '<path d="M3 13h4"/><path d="M5.5 11l2 2-2 2"/><polyline points="10,15 13.5,11 17,15 20.5,11"/>'),
  'hapto-bond': svg('<polygon points="5,6 12,3.5 19,6 16.5,9 7.5,9"/><path d="M12 6.5V17"/>' + txt(12, 22.5, 'M', 7, 700)),
  'name-to-structure': svg(txt(6.5, 9, 'abc', 7) + '<path d="M6 11v4M4.5 13.5L6 15l1.5-1.5"/>' + hex(15.5, 15, 5)),
  'check-structure': svg(hex(11, 12.5, 8) + '<path d="M14.5 17.5l2.5 2.5 5-6"/>'),
  'periodic-table': ICONS.element ?? svg(txt(12, 15, 'Pt', 9)),
  // ---- text tied under a structure
  'add-id-label': svg(hex(12, 7, 5) + txt(12, 22, '1', 10.5, 800)),
  'add-caption': svg(hex(12, 7, 5) + '<path d="M4 16.5h16M6.5 20.5h11"/>'),
  'attach-descriptors': svg(hex(12, 7, 5) + txt(12, 21.5, 'MW', 8.5, 700)),
  'number-compounds': svg(hex(6.5, 7, 4.2) + hex(17.5, 7, 4.2) + txt(6.5, 21.5, '1', 9, 800) + txt(17.5, 21.5, '2', 9, 800)),
  'clean-up-reaction': svg('<path d="M3 12h14"/><path d="M14 9l3 3-3 3"/><path d="M19.5 3.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z" fill="currentColor" stroke="none"/>'),
};

/** The icon for a command on a toolbox button, if it has one. */
export function commandIcon(cmd: string): string | undefined {
  return COMMAND_ICONS[cmd];
}
