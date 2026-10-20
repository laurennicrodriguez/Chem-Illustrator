// Toolbar icons (24×24 SVG, drawn with the current text colour).

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

function poly(n: number, r = 8, inner = false, flat = false): string {
  const pts: [number, number][] = [];
  const start = flat ? -Math.PI / 2 + Math.PI / n : -Math.PI / 2;
  for (let i = 0; i < n; i++) {
    const a = start + (i * 2 * Math.PI) / n;
    pts.push([12 + r * Math.cos(a), 12.5 + r * Math.sin(a)]);
  }
  let s = `<polygon points="${pts.map((p) => p.map((v) => v.toFixed(2)).join(',')).join(' ')}"/>`;
  if (inner) {
    // alternate inner lines for the aromatic rings
    for (let i = 0; i < n - (n % 2); i += 2) {
      const a = pts[i], b = pts[(i + 1) % n];
      const k = 0.72;
      const ia: [number, number] = [12 + (a[0] - 12) * k, 12.5 + (a[1] - 12.5) * k];
      const ib: [number, number] = [12 + (b[0] - 12) * k, 12.5 + (b[1] - 12.5) * k];
      s += `<line x1="${ia[0].toFixed(2)}" y1="${ia[1].toFixed(2)}" x2="${ib[0].toFixed(2)}" y2="${ib[1].toFixed(2)}"/>`;
    }
  }
  return svg(s);
}

export const ICONS: Record<string, string> = {
  select: svg('<rect x="4" y="5" width="16" height="14" stroke-dasharray="2.5 2"/>'),
  eraser: svg('<path d="M14.5 4.5l5 5-9 9H6l-2.5-2.5z"/><path d="M10 9l5 5"/><path d="M11 18.5h9"/>'),
  'bond-single': svg('<line x1="5" y1="18" x2="19" y2="6"/>'),
  'bond-double': svg('<line x1="4" y1="16" x2="17" y2="5"/><line x1="7" y1="19" x2="20" y2="8"/>'),
  'bond-triple': svg('<line x1="3.5" y1="15" x2="15.5" y2="4.5"/><line x1="5.5" y1="17.5" x2="18" y2="7"/><line x1="8.5" y1="19.5" x2="20.5" y2="9"/>'),
  'bond-wedge': svg('<path d="M5 18L18.4 4.6 20 6.4z" fill="currentColor"/>'),
  'bond-hashWedge': svg('<g stroke-width="1.3"><line x1="6" y1="17.4" x2="6.6" y2="18"/><line x1="8.4" y1="14.4" x2="9.8" y2="15.8"/><line x1="10.8" y1="11.4" x2="13" y2="13.6"/><line x1="13.2" y1="8.4" x2="16.2" y2="11.4"/><line x1="15.6" y1="5.4" x2="19.4" y2="9.2"/></g>'),
  'bond-hash': svg('<g stroke-width="1.3"><line x1="5" y1="15.5" x2="7.5" y2="18"/><line x1="8" y1="12.5" x2="10.5" y2="15"/><line x1="11" y1="9.5" x2="13.5" y2="12"/><line x1="14" y1="6.5" x2="16.5" y2="9"/><line x1="17" y1="3.5" x2="19.5" y2="6"/></g>'),
  'bond-bold': svg('<line x1="5" y1="18" x2="19" y2="6" stroke-width="4" stroke-linecap="butt"/>'),
  'bond-dash': svg('<line x1="5" y1="18" x2="19" y2="6" stroke-dasharray="2 2.2"/>'),
  'own-template-add': svg('<polygon points="12,3 19,7 19,15 12,19 5,15 5,7" stroke-dasharray="2 2"/><path d="M12 8v7M8.5 11.5h7"/>'),
  fragment: svg('<polyline points="3,16 7.5,11 12,16 16.5,11 21,14"/><line x1="12.5" y1="3" x2="9" y2="21" stroke-dasharray="2 2"/>'),
  element: svg('<rect x="3" y="4" width="5" height="5"/><rect x="3" y="9" width="5" height="5"/><rect x="8" y="9" width="5" height="5"/><rect x="16" y="4" width="5" height="5"/><rect x="16" y="9" width="5" height="5"/><rect x="8" y="16" width="8" height="4"/>'),
  'bond-quadruple': svg('<line x1="3" y1="14" x2="14" y2="4"/><line x1="5" y1="16.3" x2="16.3" y2="6"/><line x1="7.5" y1="18.5" x2="18.8" y2="8"/><line x1="10" y1="20.5" x2="21" y2="10.5"/>'),
  'bond-dative': svg('<line x1="4" y1="19" x2="17" y2="7"/><path d="M20 4l-7.2 2.3 4.8 5z" fill="currentColor"/>'),
  'bond-hapto': svg('<polygon points="12.0,5.3 18.7,7.5 16.1,11.1 7.9,11.1 5.3,7.5"/><line x1="12" y1="9" x2="12" y2="20"/><circle cx="12" cy="20.2" r="1.6" fill="currentColor"/>'),
  'bond-wavy': svg('<path d="M4 18c2-1 1-3 3-4s2 1 4 0 1-3 3-4 2 1 4 0 1-3 3-4"/>'),
  chain: svg('<polyline points="3,15 7.5,9 12,15 16.5,9 21,15"/>'),
  'ring-3': poly(3),
  'ring-4': poly(4, 8, false, true),
  'ring-5': poly(5),
  'ring-6': poly(6),
  'ring-7': poly(7),
  'ring-8': poly(8, 8.5, false, true),
  'ring-benzene': poly(6, 8, true),
  'ring-cp': poly(5, 8, true),
  text: svg('<path d="M6 19L12 5l6 14"/><path d="M8.4 14h7.2"/>'),
  arrow: svg('<line x1="3" y1="12" x2="18" y2="12"/><path d="M15 8.5l5 3.5-5 3.5z" fill="currentColor"/>'),
  'arrow-dashed': svg('<line x1="3" y1="12" x2="17" y2="12" stroke-dasharray="2.6 2.2"/><path d="M15 8.5l5 3.5-5 3.5z" fill="currentColor"/>'),
  'arrow-hollow': svg('<line x1="3" y1="12" x2="14" y2="12"/><path d="M14 8l6.5 4-6.5 4z"/>'),
  'arrow-double': svg('<line x1="6" y1="12" x2="18" y2="12"/><path d="M15 8.5l5 3.5-5 3.5zM9 8.5L4 12l5 3.5z" fill="currentColor"/>'),
  'arrow-equilibrium': svg('<path d="M3 9.5h17l-5-3.5M21 14.5H4l5 3.5"/>'),
  'arrow-retro': svg('<path d="M3 9.8h13.5M3 14.2h13.5M14 6.5l6 5.5-6 5.5"/>'),
  'arrow-nogo': svg('<line x1="3" y1="12" x2="18" y2="12"/><path d="M15 8.5l5 3.5-5 3.5z" fill="currentColor"/><path d="M8.5 8.5l4 7M12.5 8.5l-4 7"/>'),
  'arrow-curved': svg('<path d="M4 17A8 8 0 0 1 20 16"/><path d="M20 19.5l-2.9-5.6h5.8z" fill="currentColor" stroke="none"/>'),
  'arrow-fishhook': svg('<path d="M4 17A8 8 0 0 1 20 16"/><path d="M20 19.5l2.9-5.6H20z" fill="currentColor" stroke="none"/>'),
  'shape-rect': svg('<rect x="4" y="6" width="16" height="12"/>'),
  'shape-rect-rounded': svg('<rect x="4" y="6" width="16" height="12" rx="3.5"/>'),
  'shape-rect-shadow': svg('<rect x="3.5" y="5" width="15" height="12"/><path d="M20 7.2v11.8H6" stroke-width="2.4" opacity="0.45" stroke-linecap="butt"/>'),
  'shape-rect-rounded-shadow': svg('<rect x="3.5" y="5" width="15" height="12" rx="3"/><path d="M20 8.5v7.5a3 3 0 0 1-3 3H7.5" stroke-width="2.4" opacity="0.45" stroke-linecap="butt"/>'),
  'shape-rect-dashed': svg('<rect x="4" y="6" width="16" height="12" stroke-dasharray="2.6 2"/>'),
  'shape-circle': svg('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>'),
  'shape-circle-filled': svg('<circle cx="12" cy="12" r="5" fill="currentColor"/>'),
  'shape-oval': svg('<ellipse cx="12" cy="12" rx="9" ry="6"/>'),
  'shape-line': svg('<line x1="4" y1="19" x2="20" y2="5"/>'),
  'shape-line-dashed': svg('<line x1="4" y1="19" x2="20" y2="5" stroke-dasharray="2.6 2.2"/>'),
  'shape-line-bold': svg('<line x1="5" y1="18" x2="19" y2="6" stroke-width="3.4"/>'),
  'bracket-square': svg('<path d="M8.5 4H5.5v16h3M15.5 4h3v16h-3"/>'),
  'bracket-round': svg('<path d="M8.5 4c-4.5 4-4.5 12 0 16M15.5 4c4.5 4 4.5 12 0 16"/>'),
  'sym-lonepair': svg('<text x="12" y="19" font-size="13" text-anchor="middle" fill="currentColor" stroke="none" font-family="Arial, sans-serif">O</text><circle cx="9.5" cy="4.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="14.5" cy="4.5" r="1.3" fill="currentColor" stroke="none"/>'),
  'sym-radical': svg('<text x="11" y="19" font-size="13" text-anchor="middle" fill="currentColor" stroke="none" font-family="Arial, sans-serif">C</text><circle cx="18.5" cy="7" r="1.5" fill="currentColor" stroke="none"/>'),
  'sym-plus': svg('<circle cx="12" cy="12" r="6.5"/><path d="M8.5 12h7M12 8.5v7"/>'),
  'sym-minus': svg('<circle cx="12" cy="12" r="6.5"/><path d="M8.5 12h7"/>'),
  'sym-delta-plus': svg('<text x="10" y="18" font-size="13" text-anchor="middle" fill="currentColor" stroke="none" font-family="Arial, sans-serif">δ</text><path d="M15 7h5M17.5 4.5v5"/>'),
  'sym-delta-minus': svg('<text x="10" y="18" font-size="13" text-anchor="middle" fill="currentColor" stroke="none" font-family="Arial, sans-serif">δ</text><path d="M15 7h5"/>'),
  'bracket-curly': svg('<path d="M9.5 4C7.5 4 7 5 7 7v2.5c0 1.5-.8 2.5-2.5 2.5C6.2 12 7 13 7 14.5V17c0 2 .5 3 2.5 3M14.5 4c2 0 2.5 1 2.5 3v2.5c0 1.5.8 2.5 2.5 2.5-1.7 0-2.5 1-2.5 2.5V17c0 2-.5 3-2.5 3"/>'),
};
