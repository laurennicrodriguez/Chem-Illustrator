// SVG pictures of a drawing, from the same recorded shapes and text as the EMF pictures.

import { Item, Seg } from './vector';
import { EmfBox } from './emf';

const n = (v: number): string => String(Math.round(v * 100) / 100);

function pathData(segs: Seg[]): string {
  return segs.map((s) => (s.k === 'Z' ? 'Z' : s.k === 'C' ? `C${n(s.x1)} ${n(s.y1)} ${n(s.x2)} ${n(s.y2)} ${n(s.x)} ${n(s.y)}` : `${s.k}${n(s.x)} ${n(s.y)}`)).join('');
}

const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** An SVG file showing the items, one point to one SVG unit, sized in points. */
export function itemsToSvg(items: Item[], box: EmfBox): string {
  const W = box.x2 - box.x1, H = box.y2 - box.y1;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${n(W)}pt" height="${n(H)}pt" viewBox="${n(box.x1)} ${n(box.y1)} ${n(W)} ${n(H)}">`];
  for (const it of items) {
    if (it.kind === 'path') {
      if (!it.segs.some((s) => s.k !== 'M')) continue;
      if (it.fill) out.push(`<path d="${pathData(it.segs)}" fill="${esc(it.fill)}"/>`);
      else if (it.stroke) {
        const st = it.stroke;
        out.push(`<path d="${pathData(it.segs)}" fill="none" stroke="${esc(st.color)}" stroke-width="${n(st.width)}" stroke-linecap="${st.cap}" stroke-linejoin="${st.join}"/>`);
      }
    } else {
      const family = /^(sans-serif|system-ui|helvetica)$/i.test(it.family) ? 'Arial' : it.family;
      out.push(
        `<text x="${n(it.x)}" y="${n(it.y)}" font-family="${esc(family)}, Arial, Helvetica, sans-serif" font-size="${n(it.size)}"` +
          `${it.bold ? ' font-weight="bold"' : ''}${it.italic ? ' font-style="italic"' : ''} fill="${esc(it.color)}" xml:space="preserve">${esc(it.text)}</text>`,
      );
    }
  }
  out.push('</svg>');
  return out.join('\n');
}
