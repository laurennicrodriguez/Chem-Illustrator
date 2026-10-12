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
};
