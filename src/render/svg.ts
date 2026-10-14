// SVG pictures of a drawing, from the same recorded shapes and text as the EMF pictures.

import { Item, Seg, ImageItem } from './vector';
import { EmfBox } from './emf';
import { showableSrc } from './images';

const n = (v: number): string => String(Math.round(v * 100) / 100);

function pathData(segs: Seg[]): string {
  return segs.map((s) => (s.k === 'Z' ? 'Z' : s.k === 'C' ? `C${n(s.x1)} ${n(s.y1)} ${n(s.x2)} ${n(s.y2)} ${n(s.x)} ${n(s.y)}` : `${s.k}${n(s.x)} ${n(s.y)}`)).join('');
}

const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let clipCount = 0;

/** A picture, cropped by drawing it larger inside a clip (SVG's way of showing part of an image). */
function svgImage(item: ImageItem): string {
  // a Windows metafile goes in as its SVG copy (an SVG viewer can't show EMF)
  const it = { ...item, src: showableSrc(item.src) ?? item.src };
  const c = it.crop;
  if (!c || !(c.l || c.t || c.r || c.b)) {
    return `<image x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" preserveAspectRatio="none" href="${esc(it.src)}"/>`;
  }
  const W = it.w / Math.max(0.01, 1 - c.l - c.r), H = it.h / Math.max(0.01, 1 - c.t - c.b);
  const id = `crop${++clipCount}`;
  return `<clipPath id="${id}"><rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}"/></clipPath>` +
    `<image clip-path="url(#${id})" x="${n(it.x - c.l * W)}" y="${n(it.y - c.t * H)}" width="${n(W)}" height="${n(H)}" preserveAspectRatio="none" href="${esc(it.src)}"/>`;
}

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
    } else if (it.kind === 'image') {
      out.push(svgImage(it));
    } else {
      const family = /^(sans-serif|system-ui|helvetica)$/i.test(it.family) ? 'Arial' : it.family;
      out.push(
        `<text x="${n(it.x)}" y="${n(it.y)}" font-family="${esc(family)}, Arial, Helvetica, sans-serif" font-size="${n(it.size)}"` +
          `${it.bold ? ' font-weight="bold"' : ''}${it.italic ? ' font-style="italic"' : ''} fill="${esc(it.color)}"${it.angle ? ` transform="rotate(${n(-it.angle)} ${n(it.x)} ${n(it.y)})"` : ''} xml:space="preserve">${esc(it.text)}</text>`,
      );
    }
  }
  out.push('</svg>');
  return out.join('\n');
}
