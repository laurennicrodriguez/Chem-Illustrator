// Slide > Slide Master…: the look of every slide in one place (fonts, sizes, colours, the
// background, a logo, slide numbers, a footer, and how big structures are drawn).
// Everything here changes every slide at once, and Undo puts it back.

import { Master, Corner, Image, DECORS, type Decor } from '../deck/deck';
import { scaleStyle } from '../drawing-styles';
import { ACS_1996 } from '../style';

const CORNERS: [Corner, string][] = [['top-left', 'Top left'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right']];

export interface MasterDialogHooks {
  /** Ask for a picture file for the logo. */
  pickPicture(): Promise<Image | null>;
}

/** Show the master's settings; resolves with the changed master, or null when cancelled. */
export function editMaster(m: Master, hooks: MasterDialogHooks): Promise<Master | null> {
  return new Promise((resolve) => {
    let logo = m.logo;
    const d = document.createElement('dialog');
    d.className = 'master-dialog';
    const form = document.createElement('form');
    d.append(form);
    const h = document.createElement('h2');
    h.textContent = 'Slide master';
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = 'These settings apply to every slide. Text you have formatted yourself keeps its own formatting.';
    form.append(h, note);


    const grid = document.createElement('div');
    grid.className = 'md-grid';
    form.append(grid);
    const section = (title: string) => {
      const s = document.createElement('h3');
      s.textContent = title;
      grid.append(s);
    };
    const row = (label: string, ...els: HTMLElement[]) => {
      const l = document.createElement('label');
      l.className = 'md-row';
      const span = document.createElement('span');
      span.textContent = label;
      const box = document.createElement('span');
      box.className = 'md-controls';
      box.append(...els);
      l.append(span, box);
      grid.append(l);
      return l;
    };
    const text = (v: string, list = false) => {
      const i = document.createElement('input');
      i.type = 'text';
      i.value = v;
      if (list) i.setAttribute('list', 'ci-fonts');
      return i;
    };
    const num = (v: number, min: number, max: number, step = 1) => {
      const i = document.createElement('input');
      i.type = 'number';
      i.min = String(min);
      i.max = String(max);
      i.step = String(step);
      i.value = String(+v.toFixed(2));
      i.className = 'md-num';
      return i;
    };
    const color = (v: string) => {
      const i = document.createElement('input');
      i.type = 'color';
      i.value = /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000';
      return i;
    };
    const check = (v: boolean) => {
      const i = document.createElement('input');
      i.type = 'checkbox';
      i.checked = v;
      return i;
    };
    const unit = (s: string) => {
      const u = document.createElement('span');
      u.className = 'muted';
      u.textContent = s;
      return u;
    };

    section('Background');
    const bg = color(m.background);
    const fancy = m.fill ? ({ gradient: 'a gradient', picture: 'a picture', pattern: 'a pattern', solid: 'a see-through colour' } as const)[m.fill.kind] : '';
    row('Colour', bg, ...(fancy ? [unit(`(now ${fancy}, from Format Background; a colour here takes its place)`)] : []));
    const decor = document.createElement('select');
    for (const x of DECORS) decor.add(new Option(x.name, x.id, false, x.id === m.decor));
    row('Template shapes', decor);
    const accent = color(m.accent), accent2 = color(m.accent2);
    row('Accent colours', accent, accent2);

    section('Title slides');
    const ts = m.titleSlide;
    const ownTitle = check(!!ts);
    row('Own background and text colours', ownTitle);
    const tsBg = color(ts?.background ?? '#1d3557'), tsTitle = color(ts?.titleColor ?? '#ffffff'), tsText = color(ts?.textColor ?? '#d9e2ec');
    const tsRows = [row('Background', tsBg), row('Title colour', tsTitle), row('Text colour', tsText)];
    const showTs = () => { for (const r of tsRows) r.hidden = !ownTitle.checked; };
    ownTitle.addEventListener('change', showTs);
    showTs();

    section('Titles');
    const titleFont = text(m.titleFont, true), titleSize = num(m.titleSize, 4, 200), titleColor = color(m.titleColor), titleBold = check(m.titleBold);
    row('Font', titleFont);
    row('Size', titleSize, unit('pt'));
    row('Colour', titleColor);
    row('Bold', titleBold);

    section('Text');
    const bodyFont = text(m.bodyFont, true), bodySize = num(m.bodySize, 4, 200), subtitleSize = num(m.subtitleSize, 4, 200), textColor = color(m.textColor);
    row('Font', bodyFont);
    row('Size', bodySize, unit('pt'));
    row('Subtitle size', subtitleSize, unit('pt'));
    row('Colour', textColor);

    section('Logo');
    const preview = document.createElement('img');
    preview.className = 'md-logo';
    preview.alt = 'Logo';
    const choose = document.createElement('button');
    choose.type = 'button';
    choose.textContent = 'Choose picture…';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    const showLogo = () => {
      preview.hidden = !logo;
      if (logo) preview.src = logo.src;
      remove.hidden = !logo;
    };
    showLogo();
    choose.addEventListener('click', async () => {
      const got = await hooks.pickPicture();
      if (got) { logo = got; showLogo(); }
    });
    remove.addEventListener('click', () => { logo = null; showLogo(); });
    row('Picture', preview, choose, remove);
    const corner = document.createElement('select');
    for (const [v, l] of CORNERS) corner.add(new Option(l, v, false, v === m.logoCorner));
    row('Corner', corner);
    const logoWidth = num(m.logoWidth, 4, 600);
    row('Width', logoWidth, unit('pt'));

    section('Slide numbers and footer');
    const numbers = check(m.slideNumbers), numberTitle = check(m.numberTitleSlides);
    row('Slide numbers', numbers);
    row('Also on title slides', numberTitle);
    const footer = text(m.footer);
    footer.placeholder = 'e.g. Group meeting, 14 October';
    row('Footer', footer);
    const footerSize = num(m.footerSize, 4, 72), footerColor = color(m.footerColor);
    row('Size', footerSize, unit('pt'));
    row('Colour', footerColor);

    section('Structures');
    const bond = num(m.drawing.bondLength, 2, 200, 0.1);
    row('Bond length', bond, unit(`pt (${+(m.drawing.bondLength / ACS_1996.bondLength).toFixed(2)} × ACS 1996)`));
    const fit = check(m.fitPasted);
    row('Resize pasted structures to this bond length', fit);

    const buttons = document.createElement('p');
    buttons.className = 'ask-buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'primary';
    ok.textContent = 'Apply to all slides';
    buttons.append(cancel, ok);
    form.append(buttons);

    let finished = false;
    const done = (v: Master | null) => {
      if (finished) return;
      finished = true;
      if (d.open) d.close();
      d.remove();
      resolve(v);
    };
    const n = (i: HTMLInputElement, fallback: number) => {
      const v = parseFloat(i.value);
      return Number.isFinite(v) && v > 0 ? v : fallback;
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const len = n(bond, m.drawing.bondLength);
      // the drawing style scales as a whole with the bond length, so structures keep their proportions
      const drawing = Math.abs(len - m.drawing.bondLength) < 1e-6 ? m.drawing : scaleStyle(m.drawing, len / m.drawing.bondLength);
      // a colour picked here takes the place of a gradient or picture; left alone, they stay
      const sameBg = bg.value.toLowerCase() === m.background.toLowerCase();
      const sameTs = !!ts && ownTitle.checked && tsBg.value.toLowerCase() === ts.background.toLowerCase();
      done({
        ...m,
        background: bg.value,
        fill: sameBg ? m.fill : undefined,
        titleFont: titleFont.value.trim() || m.titleFont, titleSize: n(titleSize, m.titleSize), titleColor: titleColor.value, titleBold: titleBold.checked,
        bodyFont: bodyFont.value.trim() || m.bodyFont, bodySize: n(bodySize, m.bodySize), subtitleSize: n(subtitleSize, m.subtitleSize), textColor: textColor.value,
        logo, logoCorner: corner.value as Corner, logoWidth: n(logoWidth, m.logoWidth),
        slideNumbers: numbers.checked, numberTitleSlides: numberTitle.checked,
        footer: footer.value, footerSize: n(footerSize, m.footerSize), footerColor: footerColor.value,
        drawing, fitPasted: fit.checked,
        decor: decor.value as Decor, accent: accent.value, accent2: accent2.value,
        titleSlide: ownTitle.checked ? { background: tsBg.value, titleColor: tsTitle.value, textColor: tsText.value, ...(sameTs && ts.fill ? { fill: ts.fill } : {}) } : undefined,
      });
    });
    cancel.addEventListener('click', () => done(null));
    d.addEventListener('close', () => done(null));
    document.body.append(d);
    d.showModal();
  });
}
