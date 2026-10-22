// SVG pictures of a drawing, from the same recorded shapes and text as the EMF pictures.

import { Item, Seg, ImageItem, parseColor } from './vector';
import { EmfBox } from './emf';
import { showableSrc } from './images';

const n = (v: number): string => String(Math.round(v * 100) / 100);

function pathData(segs: Seg[]): string {
  return segs.map((s) => (s.k === 'Z' ? 'Z' : s.k === 'C' ? `C${n(s.x1)} ${n(s.y1)} ${n(s.x2)} ${n(s.y2)} ${n(s.x)} ${n(s.y)}` : `${s.k}${n(s.x)} ${n(s.y)}`)).join('');
}

const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A fill or stroke colour as attributes. See-through colours become a plain colour and an
 * opacity, which every SVG reader takes (PowerPoint's and Word's don't all read rgba()).
 */
function paint(attr: 'fill' | 'stroke', colour: string): string {
  if (!/^rgba?\(/i.test(colour.trim())) return `${attr}="${esc(colour)}"`;
  const { r, g, b, a } = parseColor(colour);
  const hex = '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  return `${attr}="${hex}"${a < 1 ? ` ${attr}-opacity="${n(Math.max(0, a))}"` : ''}`;
}

let clipCount = 0;

/** A picture, cropped by drawing it larger inside a clip (SVG's way of showing part of an image). */
function svgImage(item: ImageItem): string {
  // a Windows metafile goes in as its SVG copy (an SVG viewer can't show EMF)
  const it = { ...item, src: showableSrc(item.src) ?? item.src };
  const c = it.crop;
  const rx = it.radius ? ` rx="${n(it.radius)}"` : '';
  if ((!c || !(c.l || c.t || c.r || c.b)) && !rx) {
    return `<image x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" preserveAspectRatio="none" href="${esc(it.src)}"/>`;
  }
  const k = c ?? { l: 0, t: 0, r: 0, b: 0 };
  const W = it.w / Math.max(0.01, 1 - k.l - k.r), H = it.h / Math.max(0.01, 1 - k.t - k.b);
  const id = `crop${++clipCount}`;
  return `<clipPath id="${id}"><rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}"${rx}/></clipPath>` +
    `<image clip-path="url(#${id})" x="${n(it.x - k.l * W)}" y="${n(it.y - k.t * H)}" width="${n(W)}" height="${n(H)}" preserveAspectRatio="none" href="${esc(it.src)}"/>`;
}

/** An SVG file showing the items, one point to one SVG unit, sized in points. */
export function itemsToSvg(items: Item[], box: EmfBox): string {
  const W = box.x2 - box.x1, H = box.y2 - box.y1;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${n(W)}pt" height="${n(H)}pt" viewBox="${n(box.x1)} ${n(box.y1)} ${n(W)} ${n(H)}">`];
  for (const it of items) {
    if (it.kind === 'path') {
      if (!it.segs.some((s) => s.k !== 'M')) continue;
      if (it.fill) out.push(`<path d="${pathData(it.segs)}" ${paint('fill', it.fill)}/>`);
      else if (it.stroke) {
        const st = it.stroke;
        out.push(`<path d="${pathData(it.segs)}" fill="none" ${paint('stroke', st.color)} stroke-width="${n(st.width)}" stroke-linecap="${st.cap}" stroke-linejoin="${st.join}"/>`);
      }
    } else if (it.kind === 'image') {
      out.push(it.rot ? `<g transform="rotate(${n(it.rot)} ${n(it.x + it.w / 2)} ${n(it.y + it.h / 2)})">${svgImage(it)}</g>` : svgImage(it));
    } else {
      const family = /^(sans-serif|system-ui|helvetica)$/i.test(it.family) ? 'Arial' : it.family;
      out.push(
        `<text x="${n(it.x)}" y="${n(it.y)}" font-family="'${esc(family)}', Arial, Helvetica, sans-serif" font-size="${n(it.size)}"` +
          `${it.bold ? ' font-weight="bold"' : ''}${it.italic ? ' font-style="italic"' : ''} ${paint('fill', it.color)}${it.angle ? ` transform="rotate(${n(-it.angle)} ${n(it.x)} ${n(it.y)})"` : ''} xml:space="preserve">${esc(it.text)}</text>`,
      );
    }
  }
  out.push('</svg>');
  return out.join('\n');
}
