// Design > Templates > New Theme or Edit: a theme of your own, made from one of the ready-made
// templates (or the deck's look) and changed as you like: its name, title and text fonts, the
// background and text colours, the accent colours and shapes behind every slide, and a title
// slide with its own dark colours. The title slide and a content slide show the look as it
// changes. Your themes are kept in the settings, in the gallery with the ready-made ones.

import type { Master, SlideSize } from '../deck/deck';
import { DECORS, type Decor } from '../deck/deck';
import { SLIDE_TEMPLATES, applyTemplate, type SlideTemplate } from '../deck/templates';
import { paintTemplate } from './slide-templates';

/** Change a theme; resolves with it as changed, or null when cancelled. `title` heads the window. */
export function editTheme(t: SlideTemplate, master: Master, size: SlideSize, title = 'Edit Theme', mine: SlideTemplate[] = []): Promise<SlideTemplate | null> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'theme-editor';
    const form = document.createElement('form');
    d.append(form);
    const h = document.createElement('h2');
    h.textContent = title;
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = 'A theme sets the fonts, colours, background and shapes of every slide. Content slides read best light, so structures (drawn in black) stand out.';
    form.append(h, note);
    const body = document.createElement('div');
    body.className = 'te-body';
    const grid = document.createElement('div');
    grid.className = 'md-grid';
    const previews = document.createElement('div');
    previews.className = 'te-previews';
    body.append(grid, previews);
    form.append(body);

    const section = (s: string) => { const e = document.createElement('h3'); e.textContent = s; grid.append(e); };
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
    const text = (v: string, fonts = false) => {
      const i = document.createElement('input');
      i.type = 'text';
      i.value = v;
      if (fonts) i.setAttribute('list', 'ci-fonts');
      return i;
    };
    const colour = (v: string) => {
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

    const name = text(t.name);
    row('Name', name);
    const base = document.createElement('select');
    base.add(new Option('(keep these settings)', ''));
    for (const x of [...SLIDE_TEMPLATES, ...mine.filter((m) => m.id !== t.id)]) base.add(new Option(x.group === 'Mine' ? `${x.name} (yours)` : x.name, x.id));
    row('Start from', base);

    section('Fonts');
    const titleFont = text(t.titleFont, true), bodyFont = text(t.bodyFont, true), titleBold = check(t.titleBold ?? true);
    row('Titles', titleFont);
    row('Bold titles', titleBold);
    row('Text', bodyFont);

    section('Colours');
    const bg = colour(t.background), titleColor = colour(t.titleColor), textColor = colour(t.textColor), footerColor = colour(t.footerColor);
    row('Background', bg);
    row('Titles', titleColor);
    row('Text', textColor);
    row('Slide numbers and footer', footerColor);

    section('Shapes behind every slide');
    const decor = document.createElement('select');
    for (const x of DECORS) decor.add(new Option(x.name, x.id, false, x.id === t.decor));
    row('Shapes', decor);
    const accent = colour(t.accent), accent2 = colour(t.accent2);
    row('Accent colours', accent, accent2);

    section('Title slide');
    const ownTitle = check(!!t.titleSlide);
    row('Own (dark) colours', ownTitle);
    const tsBg = colour(t.titleSlide?.background ?? '#1d3557'), tsTitle = colour(t.titleSlide?.titleColor ?? '#ffffff'), tsText = colour(t.titleSlide?.textColor ?? '#d9e2ec');
    const tsRows = [row('Background', tsBg), row('Title colour', tsTitle), row('Text colour', tsText)];

    const canvas = document.createElement('canvas');
    previews.append(canvas);

    /** The theme as the window has it now. */
    const now = (): SlideTemplate => ({
      id: t.id, name: name.value.trim() || 'My Theme', group: 'Mine',
      background: bg.value, titleFont: titleFont.value.trim() || 'Arial', bodyFont: bodyFont.value.trim() || 'Arial',
      titleColor: titleColor.value, textColor: textColor.value, footerColor: footerColor.value,
      accent: accent.value, accent2: accent2.value, decor: decor.value as Decor, titleBold: titleBold.checked,
      ...(ownTitle.checked ? { titleSlide: { background: tsBg.value, titleColor: tsTitle.value, textColor: tsText.value } } : {}),
    });
    const repaint = () => {
      for (const r of tsRows) r.hidden = !ownTitle.checked;
      paintTemplate(canvas, applyTemplate(master, now()), size, 220, Math.round((220 * size.h) / size.w), true);
    };
    form.addEventListener('input', repaint);
    form.addEventListener('change', repaint);
    base.addEventListener('change', () => {
      const x = [...SLIDE_TEMPLATES, ...mine].find((y) => y.id === base.value);
      if (!x) return;
      titleFont.value = x.titleFont; bodyFont.value = x.bodyFont; titleBold.checked = x.titleBold ?? true;
      bg.value = x.background; titleColor.value = x.titleColor; textColor.value = x.textColor; footerColor.value = x.footerColor;
      decor.value = x.decor; accent.value = x.accent; accent2.value = x.accent2;
      ownTitle.checked = !!x.titleSlide;
      if (x.titleSlide) { tsBg.value = x.titleSlide.background; tsTitle.value = x.titleSlide.titleColor; tsText.value = x.titleSlide.textColor; }
      base.value = '';
      repaint();
    });

    const buttons = document.createElement('p');
    buttons.className = 'ask-buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'primary';
    ok.textContent = 'Save Theme';
    buttons.append(cancel, ok);
    form.append(buttons);

    let finished = false;
    const done = (v: SlideTemplate | null) => {
      if (finished) return;
      finished = true;
      if (d.open) d.close();
      d.remove();
      resolve(v);
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); done(now()); });
    cancel.addEventListener('click', () => done(null));
    d.addEventListener('close', () => done(null));
    document.body.append(d);
    repaint();
    d.showModal();
    name.focus();
    name.select();
  });
}
