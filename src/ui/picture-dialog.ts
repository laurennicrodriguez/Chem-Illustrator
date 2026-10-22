// Picture Format…: a picture's corrections (brightness, contrast, sharpen), colour (greyscale,
// sepia, washout, black and white, two colours of one's own, a colour made see-through), its
// see-through amount, Remove Background, and cropping to a shape or to proportions, as
// PowerPoint's and Word's Picture Format offer them. A preview shows the picture as it will
// look; nothing changes until Apply, and Undo puts it back. The picture's own data is never
// changed, so every setting can be taken off again later.

import type { PictureFx, Recolor } from '../model';
import { BG_TOL, PICTURE_SHAPES, makeFxCanvas, tidyFx } from '../render/picture-fx';
import { loadImage } from '../render/images';

type Crop = { l: number; t: number; r: number; b: number };

export interface PictureFormatOptions {
  src: string;
  fx?: PictureFx;
  crop?: Crop;
  /** Its size on the page, in points (for cropping to proportions). */
  w: number;
  h: number;
  /** How many pictures the settings go to (the crop goes to the first only). */
  count?: number;
}

export interface PictureFormatResult {
  fx?: PictureFx;
  crop?: Crop;
  /** The shown size's new width over height, when cropping to proportions changed it. */
  aspect?: number;
}

const RECOLORS: [string, string][] = [
  ['none', 'No recolour'], ['grey', 'Greyscale'], ['sepia', 'Sepia'], ['washout', 'Washout'],
  ['bw', 'Black and white'], ['tint', 'Two colours (dark to light)'],
];

/** Proportions to crop to, as width over height ('' leaves the crop alone, 'own' the picture's own). */
const ASPECTS: [string, string][] = [
  ['', 'Leave as cropped'], ['own', 'Whole picture'], ['1', 'Square (1:1)'], ['1.3333', '4:3'], ['0.75', '3:4'],
  ['1.7778', '16:9'], ['0.5625', '9:16'], ['1.5', '3:2'], ['0.6667', '2:3'], ['1.25', '5:4'], ['0.8', '4:5'],
];

/**
 * The crop that shows the largest part of a picture (iw × ih pixels) with these proportions
 * (width over height), centred.
 */
export function aspectCrop(iw: number, ih: number, aspect: number): Crop {
  if (!(iw > 0 && ih > 0 && aspect > 0)) return { l: 0, t: 0, r: 0, b: 0 };
  const own = iw / ih;
  if (own > aspect) {
    const cut = (1 - aspect / own) / 2;
    return { l: cut, t: 0, r: cut, b: 0 };
  }
  const cut = (1 - own / aspect) / 2;
  return { l: 0, t: cut, r: 0, b: cut };
}

const PREVIEW = 300;

export function pictureFormat(o: PictureFormatOptions): Promise<PictureFormatResult | null> {
  return new Promise((resolve) => {
    let fx: PictureFx = structuredClone(o.fx ?? {});
    let crop: Crop = { ...(o.crop ?? { l: 0, t: 0, r: 0, b: 0 }) };
    let aspect: number | undefined;
    let small: HTMLCanvasElement | null = null;
    // what a click on the preview does: nothing, mark to keep, mark to remove, or pick the see-through colour
    let clickDoes: 'none' | 'keep' | 'drop' | 'clear' = 'none';

    const d = document.createElement('dialog');
    d.className = 'master-dialog bg-dialog pic-dialog';
    const form = document.createElement('form');
    d.append(form);
    const h = document.createElement('h2');
    h.textContent = 'Picture format';
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = (o.count ?? 1) > 1
      ? `For the ${o.count} pictures picked (cropping goes to the first). The pictures themselves stay as they are, so any of this can be taken off again.`
      : 'The picture itself stays as it is, so any of this can be taken off again. Saved as PowerPoint\'s and Word\'s own picture settings.';
    const preview = document.createElement('canvas');
    preview.className = 'bg-preview pic-preview';
    const hint = document.createElement('p');
    hint.className = 'muted pic-hint';
    form.append(h, note, preview, hint);

    const grid = document.createElement('div');
    grid.className = 'md-grid';
    form.append(grid);
    const row = (parent: HTMLElement, label: string, ...els: HTMLElement[]) => {
      const l = document.createElement('label');
      l.className = 'md-row';
      const span = document.createElement('span');
      span.textContent = label;
      const box = document.createElement('span');
      box.className = 'md-controls';
      box.append(...els);
      l.append(span, box);
      parent.append(l);
      return l;
    };
    const unit = (s: string) => {
      const u = document.createElement('span');
      u.className = 'muted';
      u.textContent = s;
      return u;
    };
    const head = (text: string) => {
      const x = document.createElement('h3');
      x.textContent = text;
      grid.append(x);
    };
    /** A slider with its number beside it, from `min` to `max` percent. */
    const slider = (v: number, min: number, max: number, on: (v: number) => void, title: string) => {
      const box = document.createElement('span');
      box.className = 'bg-slider';
      box.title = title;
      const r = document.createElement('input');
      r.type = 'range';
      r.min = String(min);
      r.max = String(max);
      r.value = String(Math.round(v));
      const n = document.createElement('input');
      n.type = 'number';
      n.min = String(min);
      n.max = String(max);
      n.value = r.value;
      n.className = 'md-num';
      r.addEventListener('input', () => { n.value = r.value; on(Number(r.value)); });
      n.addEventListener('input', () => { const x = parseFloat(n.value); if (Number.isFinite(x)) { const c = Math.max(min, Math.min(max, x)); r.value = String(c); on(c); } });
      box.append(r, n, unit('%'));
      return Object.assign(box, { set: (x: number) => { r.value = n.value = String(Math.round(x)); } });
    };
    const button = (text: string, title: string, on: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.title = title;
      b.addEventListener('click', on);
      return b;
    };
    const color = (v: string, on: (v: string) => void) => {
      const i = document.createElement('input');
      i.type = 'color';
      i.value = /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000';
      i.addEventListener('input', () => on(i.value));
      return i;
    };

    // ------------------------------------------------ corrections
    head('Corrections');
    const bright = slider((fx.bright ?? 0) * 100, -100, 100, (v) => { fx.bright = v / 100; draw(); }, 'Brighter or darker');
    const contrast = slider((fx.contrast ?? 0) * 100, -100, 100, (v) => { fx.contrast = v / 100; draw(); }, 'More or less difference between light and dark');
    const sharp = slider((fx.sharpen ?? 0) * 100, -100, 100, (v) => { fx.sharpen = v / 100; draw(); }, 'Sharper (above 0) or softer (below 0)');
    row(grid, 'Brightness', bright);
    row(grid, 'Contrast', contrast);
    row(grid, 'Sharpen / soften', sharp);

    // ------------------------------------------------ colour
    head('Colour');
    const recolor = document.createElement('select');
    for (const [id, name] of RECOLORS) recolor.add(new Option(name, id, false, id === (fx.recolor?.kind ?? 'none')));
    row(grid, 'Recolour', recolor);
    const level = slider(((fx.recolor?.kind === 'bw' ? fx.recolor.level : undefined) ?? 0.5) * 100, 1, 99, (v) => { if (fx.recolor?.kind === 'bw') fx.recolor = { kind: 'bw', ...(v !== 50 ? { level: v / 100 } : {}) }; draw(); }, 'Lighter than this turns white, darker turns black');
    const levelRow = row(grid, 'Black below', level);
    const tint0 = fx.recolor?.kind === 'tint' ? fx.recolor : { kind: 'tint' as const, dark: '#1f3864', light: '#ddebf7' };
    let tint: Extract<Recolor, { kind: 'tint' }> = tint0;
    const dark = color(tint.dark, (v) => { tint = { ...tint, dark: v }; if (fx.recolor?.kind === 'tint') fx.recolor = tint; draw(); });
    const light = color(tint.light, (v) => { tint = { ...tint, light: v }; if (fx.recolor?.kind === 'tint') fx.recolor = tint; draw(); });
    const tintRow = row(grid, 'Dark and light', dark, light);
    recolor.addEventListener('change', () => {
      const k = recolor.value;
      fx.recolor = k === 'none' ? undefined : k === 'tint' ? tint : k === 'bw' ? { kind: 'bw' } : { kind: k as 'grey' | 'sepia' | 'washout' };
      if (k === 'bw') level.set(50);
      show();
      draw();
    });
    const swatch = document.createElement('span');
    swatch.className = 'pic-swatch';
    const pickClear = button('Pick in the picture', 'Click the colour in the preview that should be see-through (a white or coloured background)', () => { clickDoes = clickDoes === 'clear' ? 'none' : 'clear'; show(); });
    const noClear = button('None', 'No colour see-through', () => { fx.clear = undefined; clickDoes = clickDoes === 'clear' ? 'none' : clickDoes; show(); draw(); });
    row(grid, 'See-through colour', swatch, pickClear, noClear);
    const alpha = slider((fx.alpha ?? 0) * 100, 0, 100, (v) => { fx.alpha = v / 100; draw(); }, 'How see-through the whole picture is');
    row(grid, 'Transparency', alpha);

    // ------------------------------------------------ remove background
    head('Remove background');
    const bgOn = document.createElement('input');
    bgOn.type = 'checkbox';
    bgOn.checked = !!fx.bg;
    row(grid, 'Remove background', bgOn, unit('(what joins the edges in colour goes)'));
    const tol = slider((fx.bg?.tol ?? BG_TOL) * 100, 1, 60, (v) => { if (fx.bg) fx.bg = { ...fx.bg, tol: v / 100 }; draw(); }, 'How near in colour to the background a part must be to go: raise it if background is left, lower it if the subject loses parts');
    const tolRow = row(grid, 'How near counts', tol);
    const keepBtn = button('Mark to keep', 'Click parts of the preview that should stay', () => { clickDoes = clickDoes === 'keep' ? 'none' : 'keep'; show(); });
    const dropBtn = button('Mark to remove', 'Click parts of the preview that should go', () => { clickDoes = clickDoes === 'drop' ? 'none' : 'drop'; show(); });
    const clearMarks = button('Clear marks', 'Take off the marks', () => { if (fx.bg) fx.bg = { ...(fx.bg.tol !== undefined ? { tol: fx.bg.tol } : {}) }; show(); draw(); });
    const marksRow = row(grid, 'Marks', keepBtn, dropBtn, clearMarks);
    bgOn.addEventListener('change', () => {
      fx.bg = bgOn.checked ? { ...(Number(tol.querySelector('input')!.value) / 100 !== BG_TOL ? { tol: Number(tol.querySelector('input')!.value) / 100 } : {}) } : undefined;
      if (!bgOn.checked && (clickDoes === 'keep' || clickDoes === 'drop')) clickDoes = 'none';
      show();
      draw();
    });

    // ------------------------------------------------ crop
    head('Crop');
    const shape = document.createElement('select');
    for (const p of PICTURE_SHAPES) shape.add(new Option(p.name, p.prst, false, p.prst === (fx.shape ?? 'rect')));
    shape.addEventListener('change', () => { fx.shape = shape.value === 'rect' ? undefined : shape.value; draw(); });
    row(grid, 'Crop to shape', shape);
    const ratio = document.createElement('select');
    for (const [v, name] of ASPECTS) ratio.add(new Option(name, v));
    ratio.addEventListener('change', () => {
      const img = small;
      if (!img || !ratio.value) { aspect = undefined; crop = { ...(o.crop ?? { l: 0, t: 0, r: 0, b: 0 }) }; draw(); return; }
      const want = ratio.value === 'own' ? img.width / img.height : Number(ratio.value);
      crop = aspectCrop(img.width, img.height, want);
      aspect = want;
      draw();
    });
    row(grid, 'Crop to proportions', ratio, unit('(centred; drag the crop handles to move it)'));

    // ------------------------------------------------ buttons
    const buttons = document.createElement('p');
    buttons.className = 'ask-buttons bg-buttons';
    const reset = button('Reset Picture', 'Take off every setting here (the crop too)', () => {
      fx = {};
      crop = { l: 0, t: 0, r: 0, b: 0 };
      aspect = small ? small.width / small.height : undefined;
      for (const s of [bright, contrast, sharp, alpha]) s.set(0);
      recolor.value = 'none';
      bgOn.checked = false;
      shape.value = 'rect';
      ratio.value = '';
      clickDoes = 'none';
      show();
      draw();
    });
    const cancel = button('Cancel', 'Close without changing anything', () => done(null));
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'primary';
    ok.textContent = 'Apply';
    const spacer = document.createElement('span');
    spacer.className = 'bg-spacer';
    buttons.append(reset, spacer, cancel, ok);
    form.append(buttons);

    function show(): void {
      levelRow.hidden = fx.recolor?.kind !== 'bw';
      tintRow.hidden = fx.recolor?.kind !== 'tint';
      tolRow.hidden = marksRow.hidden = !fx.bg;
      swatch.style.background = fx.clear ?? 'transparent';
      swatch.title = fx.clear ? `${fx.clear} is see-through` : 'None';
      swatch.classList.toggle('pic-none', !fx.clear);
      pickClear.setAttribute('aria-pressed', String(clickDoes === 'clear'));
      keepBtn.setAttribute('aria-pressed', String(clickDoes === 'keep'));
      dropBtn.setAttribute('aria-pressed', String(clickDoes === 'drop'));
      preview.style.cursor = clickDoes === 'none' ? '' : 'crosshair';
      hint.textContent = clickDoes === 'clear' ? 'Click the colour in the picture to make see-through.'
        : clickDoes === 'keep' ? 'Click parts of the picture to keep (green dots). Click Mark to keep again to stop.'
          : clickDoes === 'drop' ? 'Click parts of the picture to remove (red dots). Click Mark to remove again to stop.'
            : '';
    }

    // the preview: the part shown, with the settings, on a checkerboard (so see-through parts show)
    let box = { x: 0, y: 0, w: PREVIEW, h: PREVIEW };
    function draw(): void {
      const dpr = window.devicePixelRatio || 1;
      const cw = (1 - crop.l - crop.r), ch = (1 - crop.t - crop.b);
      const shownAspect = aspect ?? (small ? (small.width * cw) / (small.height * ch) : o.w / Math.max(1e-6, o.h));
      const W = PREVIEW, H = Math.round(Math.max(80, Math.min(PREVIEW, W / Math.max(0.2, shownAspect))));
      preview.style.width = `${W}px`;
      preview.style.height = `${H}px`;
      preview.width = Math.round(W * dpr);
      preview.height = Math.round(H * dpr);
      const g = preview.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const k = Math.min(W / shownAspect, H) ;
      const bw = k * shownAspect, bh = k;
      box = { x: (W - bw) / 2, y: (H - bh) / 2, w: bw, h: bh };
      // checkerboard
      const sq = 8;
      for (let y = 0; y < H; y += sq) for (let x = 0; x < W; x += sq) { g.fillStyle = ((x + y) / sq) % 2 ? '#e6e6e6' : '#ffffff'; g.fillRect(x, y, sq, sq); }
      if (!small) return;
      const f = tidyFx(fx);
      const c = f ? makeFxCanvas(small, { crop }, f) : small;
      g.imageSmoothingEnabled = true;
      g.drawImage(c, crop.l * c.width, crop.t * c.height, Math.max(1, cw * c.width), Math.max(1, ch * c.height), box.x, box.y, box.w, box.h);
      // the marks
      for (const [list, colour] of [[fx.bg?.keep, '#1e9e3a'], [fx.bg?.drop, '#d23c3c']] as const) {
        for (const [mx, my] of list ?? []) {
          const px = box.x + ((mx - crop.l) / cw) * box.w, py = box.y + ((my - crop.t) / ch) * box.h;
          g.beginPath();
          g.arc(px, py, 4, 0, Math.PI * 2);
          g.fillStyle = colour;
          g.fill();
          g.strokeStyle = '#fff';
          g.lineWidth = 1.5;
          g.stroke();
        }
      }
    }

    preview.addEventListener('click', (e) => {
      if (clickDoes === 'none' || !small) return;
      const r = preview.getBoundingClientRect();
      const u = (e.clientX - r.left - box.x) / box.w, v = (e.clientY - r.top - box.y) / box.h;
      if (u < 0 || u > 1 || v < 0 || v > 1) return;
      // as a fraction of the whole picture
      const fxp = crop.l + u * (1 - crop.l - crop.r), fyp = crop.t + v * (1 - crop.t - crop.b);
      if (clickDoes === 'clear') {
        const px = small.getContext('2d')!.getImageData(Math.min(small.width - 1, Math.floor(fxp * small.width)), Math.min(small.height - 1, Math.floor(fyp * small.height)), 1, 1).data;
        fx.clear = '#' + [px[0], px[1], px[2]].map((x) => x.toString(16).padStart(2, '0')).join('');
        clickDoes = 'none';
      } else if (fx.bg) {
        const pt: [number, number] = [+fxp.toFixed(4), +fyp.toFixed(4)];
        fx.bg = clickDoes === 'keep' ? { ...fx.bg, keep: [...(fx.bg.keep ?? []), pt] } : { ...fx.bg, drop: [...(fx.bg.drop ?? []), pt] };
      }
      show();
      draw();
    });

    let finished = false;
    const done = (v: PictureFormatResult | null) => {
      if (finished) return;
      finished = true;
      if (d.open) d.close();
      d.remove();
      resolve(v);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const tidy = tidyFx(fx);
      const changedCrop = JSON.stringify(crop) !== JSON.stringify(o.crop ?? { l: 0, t: 0, r: 0, b: 0 });
      done({ fx: tidy, ...(changedCrop ? { crop } : {}), ...(changedCrop && aspect ? { aspect } : {}) });
    });
    d.addEventListener('close', () => done(null));
    document.body.append(d);
    d.showModal();
    show();
    draw();
    // the picture, made small enough to change at once as the sliders move
    loadImage(o.src).then((img) => {
      const iw = img.naturalWidth || o.w, ih = img.naturalHeight || o.h;
      const k = Math.min(1, (PREVIEW * 2) / Math.max(iw, ih));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(iw * k));
      c.height = Math.max(1, Math.round(ih * k));
      c.getContext('2d', { willReadFrequently: true })!.drawImage(img, 0, 0, c.width, c.height);
      small = c;
      draw();
    }).catch(() => { hint.textContent = 'This picture could not be read.'; });
  });
}
