// Design > Templates (Slides): about twenty ready-made looks for a deck, each shown as its title
// slide and a content slide, and your own themes beside them. Picking one changes every slide's
// fonts, colours, background and shapes at once (Undo puts them back); the slides' text,
// structures and pictures stay. New Theme makes a theme of your own from any of them (or from
// the deck's look); your themes can be changed or deleted here, the ready-made ones copied.

import { Doc } from '../model';
import { Master, SlideSize, LayoutId, layoutFrames, frameFields, textStyles, slideColours } from '../deck/deck';
import { paintSlide } from '../deck/slide-view';
import { SLIDE_TEMPLATES, SlideTemplate, applyTemplate, themeFromMaster, newThemeId } from '../deck/templates';
import { editTheme } from './theme-editor';

export interface TemplateChoice {
  /** The template picked, or none when the window was closed after only making or changing themes. */
  template: SlideTemplate | null;
  forNew: boolean;
  /** Your themes, as made, changed and deleted in the window. */
  mine: SlideTemplate[];
}

/** Resolves with the template picked (and whether new decks should start with it), or null when cancelled with no theme changed. */
export function pickSlideTemplate(m: Master, size: SlideSize, defaultId: string | null, mine0: SlideTemplate[] = []): Promise<TemplateChoice | null> {
  return new Promise((resolve) => {
    let mine = mine0.map((t) => ({ ...t }));
    let changed = false;
    const d = document.createElement('dialog');
    d.className = 'ask template-gallery slide-templates';
    const h = document.createElement('h2');
    h.textContent = 'Slide Templates';
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = 'A template sets the fonts, colours, background and shapes of every slide. Your text, structures, logo, footer and slide numbers stay as they are, and Slide Master changes any part of the look afterwards.';
    const tools = document.createElement('div');
    tools.className = 'st-tools';
    const tool = (label: string, title: string, run: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', run);
      tools.append(b);
    };
    const body = document.createElement('div');
    body.className = 'st-body';
    let result: TemplateChoice | null = null;
    let repaint: (() => void)[] = [];
    const forNew = document.createElement('input');
    forNew.type = 'checkbox';

    /** Make or change a theme of your own; `from` is what it starts as. */
    const edit = async (from: SlideTemplate, isNew: boolean) => {
      const got = await editTheme(from, m, size, isNew ? 'New Theme' : 'Edit Theme', mine);
      if (!got) return;
      const k = mine.findIndex((x) => x.id === got.id);
      if (k >= 0) mine[k] = got; else mine.push(got);
      changed = true;
      render();
    };
    const fresh = (t: SlideTemplate, name: string): SlideTemplate => ({ ...t, id: newThemeId(mine), name, group: 'Mine', ...(t.titleSlide ? { titleSlide: { ...t.titleSlide } } : {}) });
    const uniqueName = (base: string) => {
      let n = base, k = 2;
      while (mine.some((x) => x.name === n)) n = `${base} ${k++}`;
      return n;
    };
    tool('New Theme…', 'A theme of your own, starting from the Plain template', () => void edit(fresh(SLIDE_TEMPLATES[0], uniqueName('My Theme')), true));
    tool('New Theme from This Deck…', 'A theme of your own with this deck\'s fonts, colours and shapes', () => void edit(themeFromMaster(m, uniqueName(m.template ? `${m.template} (mine)` : 'My Theme'), newThemeId(mine)), true));

    function card(t: SlideTemplate): HTMLElement {
      const wrap = document.createElement('div');
      wrap.className = 'tg-card-wrap';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tg-card';
      if (m.template === t.name) b.classList.add('current');
      const c = document.createElement('canvas');
      c.className = 'tg-thumb';
      const look = applyTemplate(m, t);
      paintTemplate(c, look, size, W, H);
      repaint.push(() => paintTemplate(c, look, size, W, H));
      const name = document.createElement('strong');
      name.textContent = t.name + (m.template === t.name ? ' (in use)' : '') + (defaultId === t.id ? ' · for new decks' : '');
      const fonts = document.createElement('span');
      fonts.className = 'muted tg-size';
      fonts.textContent = t.titleFont === t.bodyFont ? t.titleFont : `${t.titleFont} and ${t.bodyFont}`;
      b.append(c, name, fonts);
      b.addEventListener('click', () => { result = { template: t, forNew: forNew.checked, mine }; d.close(); });
      const acts = document.createElement('span');
      acts.className = 'tg-mine';
      const act = (label: string, title: string, run: () => void) => {
        const x = document.createElement('button');
        x.type = 'button';
        x.textContent = label;
        x.title = title;
        x.addEventListener('click', (e) => { e.stopPropagation(); run(); });
        acts.append(x);
      };
      if (t.group === 'Mine') {
        act('Edit', `Change ${t.name}`, () => void edit({ ...t }, false));
        act('Delete', `Delete ${t.name} (decks that use it keep their look)`, () => {
          mine = mine.filter((x) => x.id !== t.id);
          changed = true;
          render();
        });
      } else act('Copy', `A theme of your own made from ${t.name}, to change`, () => void edit(fresh(t, uniqueName(`${t.name} (mine)`)), true));
      wrap.append(b, acts);
      return wrap;
    }

    function render(): void {
      repaint = [];
      const kids: HTMLElement[] = [];
      for (const group of ['Mine', 'Light', 'Dark title slide', 'Bright'] as const) {
        const list = group === 'Mine' ? mine : SLIDE_TEMPLATES.filter((x) => x.group === group);
        if (!list.length) continue;
        const g = document.createElement('h3');
        g.textContent = group === 'Mine' ? 'Your themes' : group === 'Dark title slide' ? 'Dark title slide (light content slides)' : group;
        const grid = document.createElement('div');
        grid.className = 'tg-grid';
        grid.append(...list.map(card));
        kids.push(g, grid);
      }
      body.replaceChildren(...kids);
    }
    render();

    const opt = document.createElement('label');
    opt.className = 'st-option';
    opt.append(forNew, document.createTextNode(' Also start new slide decks with the template I pick'));
    const buttons = document.createElement('p');
    buttons.className = 'ask-buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Close';
    cancel.addEventListener('click', () => d.close());
    buttons.append(cancel);
    d.append(h, note, tools, body, opt, buttons);
    d.addEventListener('close', () => {
      d.remove();
      resolve(result ?? (changed ? { template: null, forNew: false, mine } : null));
    });
    document.body.append(d);
    d.showModal();
    (body.querySelector('.tg-card') as HTMLElement | null)?.focus();
    // the fonts that come with the app load when first used: draw the cards again once they have
    if (typeof document.fonts?.load === 'function') {
      const families = new Set([...SLIDE_TEMPLATES, ...mine].flatMap((t) => [t.titleFont, t.bodyFont]));
      void Promise.allSettled([...families].flatMap((f) => [document.fonts.load(`12px "${f}"`), document.fonts.load(`bold 12px "${f}"`)]))
        .then(() => { if (d.isConnected) for (const r of repaint) r(); });
    }
  });
}

const W = 112, H = 63, GAP = 6;

/** A look's title slide and a content slide, side by side (or one above the other), each w × h. */
export function paintTemplate(c: HTMLCanvasElement, m: Master, size: SlideSize, w = W, h = H, stacked = false): void {
  const k = devicePixelRatio;
  const cw = stacked ? w : 2 * w + GAP, ch = stacked ? 2 * h + GAP : h;
  c.width = cw * k;
  c.height = ch * k;
  c.style.width = `${cw}px`;
  c.style.height = `${ch}px`;
  const g = c.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, c.width, c.height);
  const one = document.createElement('canvas');
  const pages: [LayoutId, string[]][] = [['title', ['Total Synthesis', 'Group meeting']], ['title-content', ['Results', 'Scope of the coupling\nYields and selectivity']]];
  pages.forEach(([layout, text], i) => {
    try {
      paintSlide(one, w, h, k, { size, master: m, layout, index: i }, sample(m, size, layout, text), slideColours(m, layout).background);
      const x = stacked ? 0 : i * (w + GAP) * k, y = stacked ? i * (h + GAP) * k : 0;
      g.drawImage(one, x, y);
      g.strokeStyle = 'rgba(0,0,0,0.18)';
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, w * k - 1, h * k - 1);
    } catch {
      // no canvas here: the card stays plain
    }
  });
}

/** A slide of this layout with its placeholders filled with sample text. */
function sample(m: Master, size: SlideSize, layout: LayoutId, text: string[]): Doc {
  const d = new Doc();
  const styles = textStyles(m, layout);
  d.textStyles = styles;
  d.edit('Sample', () => {
    layoutFrames(layout, size, m).forEach((f, i) => {
      if (!text[i]) return;
      d.addCaption({ ...frameFields(f, styles), runs: [{ text: text[i] }], paras: f.ph === 'body' ? text[i].split('\n').map(() => ({ list: 'bullet' as const })) : undefined });
    });
  });
  return d;
}
