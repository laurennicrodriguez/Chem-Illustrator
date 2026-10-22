// Design > Slide Size > Custom Slide Size…: any size of slide, as in PowerPoint. Pick one of the
// usual sizes or type the width and height (in inches or centimetres), turn it to portrait, and
// say how what is on the slides fits the new size: as it is, centred; as big as fits (Ensure Fit);
// or as big as the slide allows (Maximize).

import type { SlideSize, SizeFit } from '../deck/deck';

/** The usual slide sizes, in points (PowerPoint's own list, from its published page sizes). */
export const SLIDE_SIZES: { id: string; name: string; size: SlideSize }[] = [
  { id: 'wide', name: 'Widescreen (16:9)', size: { w: 960, h: 540 } },
  { id: 'standard', name: 'Standard (4:3)', size: { w: 720, h: 540 } },
  { id: 'screen-16-10', name: 'On-screen Show (16:10)', size: { w: 720, h: 450 } },
  { id: 'letter', name: 'Letter Paper (8.5 × 11 in)', size: { w: 720, h: 540 } },
  { id: 'a4', name: 'A4 Paper (210 × 297 mm)', size: { w: 780, h: 540 } },
  { id: 'a3', name: 'A3 Paper (297 × 420 mm)', size: { w: 1008, h: 756 } },
  { id: 'b4', name: 'B4 (ISO) Paper (250 × 353 mm)', size: { w: 852.3, h: 639.2 } },
  { id: '35mm', name: '35 mm Slides', size: { w: 810, h: 540 } },
  { id: 'overhead', name: 'Overhead', size: { w: 720, h: 540 } },
  { id: 'banner', name: 'Banner', size: { w: 576, h: 72 } },
  { id: 'poster-a0', name: 'Poster A0 (841 × 1189 mm)', size: { w: 3370.4, h: 2383.9 } },
  { id: 'poster-48x36', name: 'Poster 48 × 36 in', size: { w: 3456, h: 2592 } },
];

export interface SlideSizeChoice { size: SlideSize; fit: SizeFit }

const PT = { in: 72, cm: 72 / 2.54 } as const;

/** Resolves with the size and how the slides' contents fit it, or null when cancelled. */
export function pickSlideSize(now: SlideSize): Promise<SlideSizeChoice | null> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'ask slide-size-dialog';
    const form = document.createElement('form');
    d.append(form);
    const h = document.createElement('h2');
    h.textContent = 'Slide Size';
    form.append(h);
    const row = (label: string, ...els: (HTMLElement | string)[]) => {
      const l = document.createElement('label');
      l.className = 'ask-row';
      const s = document.createElement('span');
      s.textContent = label;
      l.append(s, ...els);
      form.append(l);
      return l;
    };
    const preset = document.createElement('select');
    for (const p of SLIDE_SIZES) preset.add(new Option(p.name, p.id));
    preset.add(new Option('Custom', 'custom'));
    row('Slides sized for', preset);
    const unit = document.createElement('select');
    unit.add(new Option('inches', 'in'));
    unit.add(new Option('cm', 'cm'));
    const num = () => {
      const i = document.createElement('input');
      i.type = 'number';
      i.min = '0.1';
      i.step = 'any';
      i.className = 'md-num';
      return i;
    };
    const w = num(), hh = num();
    row('Width', w, unit);
    row('Height', hh);
    const orient = document.createElement('select');
    orient.add(new Option('Landscape', 'landscape'));
    orient.add(new Option('Portrait', 'portrait'));
    row('Orientation', orient);
    const fit = document.createElement('select');
    fit.add(new Option('Ensure Fit: as big as fits on the new slide', 'fit'));
    fit.add(new Option('Maximize: as big as the slide allows (may run off)', 'max'));
    fit.add(new Option('Don\'t scale: keep the size, centred', 'centre'));
    row('What is on the slides', fit);
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = 'Placeholders always move to their layouts\' places. Sizes from 1 to 56 inches, as in PowerPoint.';
    form.append(note);

    // the size in points as typed
    let pts: SlideSize = { ...now };
    const show = () => {
      const k = PT[unit.value as 'in' | 'cm'];
      w.value = String(+(pts.w / k).toFixed(2));
      hh.value = String(+(pts.h / k).toFixed(2));
      orient.value = pts.h > pts.w ? 'portrait' : 'landscape';
    };
    // the size the deck has now, by name when it is one of the usual ones (either way round)
    const near = (a: SlideSize, b: SlideSize) => (Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5) || (Math.abs(a.w - b.h) < 0.5 && Math.abs(a.h - b.w) < 0.5);
    preset.value = SLIDE_SIZES.find((x) => near(x.size, now))?.id ?? 'custom';
    preset.addEventListener('change', () => {
      const p = SLIDE_SIZES.find((x) => x.id === preset.value);
      if (!p) return;
      const portrait = orient.value === 'portrait';
      pts = portrait ? { w: Math.min(p.size.w, p.size.h), h: Math.max(p.size.w, p.size.h) } : { ...p.size };
      show();
    });
    const typed = () => {
      const k = PT[unit.value as 'in' | 'cm'];
      const a = parseFloat(w.value), b = parseFloat(hh.value);
      if (Number.isFinite(a) && a > 0) pts.w = a * k;
      if (Number.isFinite(b) && b > 0) pts.h = b * k;
      preset.value = 'custom';
      show();
    };
    w.addEventListener('change', typed);
    hh.addEventListener('change', typed);
    unit.addEventListener('change', show);
    orient.addEventListener('change', () => {
      const portrait = orient.value === 'portrait';
      if (portrait !== pts.h > pts.w) pts = { w: pts.h, h: pts.w };
      show();
    });
    show();

    const buttons = document.createElement('p');
    buttons.className = 'ask-buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'primary';
    ok.textContent = 'OK';
    buttons.append(cancel, ok);
    form.append(buttons);

    let finished = false;
    const done = (v: SlideSizeChoice | null) => {
      if (finished) return;
      finished = true;
      if (d.open) d.close();
      d.remove();
      resolve(v);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      typedIfChanged();
      // PowerPoint's limits: 1 to 56 inches each way
      const lim = (v: number) => Math.round(Math.max(72, Math.min(56 * 72, v)) * 100) / 100;
      done({ size: { w: lim(pts.w), h: lim(pts.h) }, fit: fit.value as SizeFit });
    });
    /** A number typed but not yet left (Enter pressed in the box) counts too. */
    function typedIfChanged(): void {
      const k = PT[unit.value as 'in' | 'cm'];
      const a = parseFloat(w.value), b = parseFloat(hh.value);
      // (a number shown rounded is not a change)
      if (Number.isFinite(a) && a > 0 && w.value !== String(+(pts.w / k).toFixed(2))) pts.w = a * k;
      if (Number.isFinite(b) && b > 0 && hh.value !== String(+(pts.h / k).toFixed(2))) pts.h = b * k;
    }
    cancel.addEventListener('click', () => done(null));
    d.addEventListener('close', () => done(null));
    document.body.append(d);
    d.showModal();
    preset.focus();
  });
}
