// Word's Styles pane (Home > Styles > More Styles, Ctrl+Alt+Shift+S): every paragraph style
// (Normal, the nine headings, Caption and the person's own) and every character style
// (Emphasis, Strong, Compound Number…), each shown in its own look. Click one to give it to
// the paragraphs or text picked; New Style makes one from the text the caret is in; Modify
// changes one (every paragraph or word in it follows); Delete takes away one made here.

import { FloatBox } from './float-box';
import { charStylesOf, styleOf, STANDARD_STYLES, type CharStyle, type DocText, type NamedStyle } from '../document/document';
import type { ParaStyle } from '../model';
import type * as rt from '../richtext';
import { cssFamily } from '../text/layout';

export interface StylesPaneHost {
  doc(): { t: DocText; para: ParaStyle; look: rt.RunStyle } | null;
  applyPara(id: string): void;
  applyChar(id: string | null): void;
  newStyle(): void;
  modify(kind: 'para' | 'char', id: string): void;
  remove(kind: 'para' | 'char', id: string): void;
  focus(): void;
}

export class StylesPane {
  private box: FloatBox;
  private list: HTMLDivElement;
  private preview: HTMLInputElement;
  private picked: { kind: 'para' | 'char'; id: string } | null = null;
  private del: HTMLButtonElement;
  private mod: HTMLButtonElement;

  constructor(private host: StylesPaneHost) {
    this.box = new FloatBox('Styles', () => {});
    this.box.el.classList.add('styles-pane');
    this.box.el.querySelector<HTMLElement>('.fb-pin')?.setAttribute('hidden', '');
    this.list = document.createElement('div');
    this.list.className = 'sp-list';
    this.list.setAttribute('role', 'listbox');
    const buttons = document.createElement('div');
    buttons.className = 'sp-buttons';
    const button = (label: string, title: string, f: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', f);
      buttons.append(b);
      return b;
    };
    button('New Style…', 'A new style with the look of the text the caret is in (a paragraph style, or a character style for words)', () => this.host.newStyle());
    this.mod = button('Modify…', 'Change how the style picked looks: every paragraph or word in it follows (except what was formatted by hand)', () => {
      const p = this.picked ?? this.current();
      if (p) this.host.modify(p.kind, p.id);
    });
    this.del = button('Delete', 'Delete a style you made: its paragraphs go back to Normal, its words to their paragraph’s look', () => {
      if (this.picked) this.host.remove(this.picked.kind, this.picked.id);
    });
    button('Clear Character Style', 'Take the selected words out of their character style (Word’s Default Paragraph Font)', () => this.host.applyChar(null));
    const pv = document.createElement('label');
    pv.className = 'sp-preview';
    this.preview = document.createElement('input');
    this.preview.type = 'checkbox';
    this.preview.checked = true;
    this.preview.addEventListener('change', () => this.refresh());
    pv.append(this.preview, 'Show Preview');
    this.box.body.append(this.list, buttons, pv);
  }

  get open(): boolean {
    return this.box.open;
  }

  toggle(near?: HTMLElement | null): void {
    if (this.box.open) { this.box.close(); return; }
    this.picked = null;
    this.box.show(near);
    this.refresh();
  }

  close(): void {
    this.box.close();
  }

  /** The styles the caret is in: its paragraph's, and its text's character style. */
  private current(): { kind: 'para' | 'char'; id: string } | null {
    const d = this.host.doc();
    if (!d) return null;
    return d.look.cstyle ? { kind: 'char', id: d.look.cstyle } : { kind: 'para', id: styleOf(d.t, d.para).id };
  }

  /** Show the styles again (after the caret moved or a style changed). */
  refresh(): void {
    if (!this.box.open) return;
    const d = this.host.doc();
    this.list.replaceChildren();
    if (!d) return;
    const paraId = styleOf(d.t, d.para).id;
    const charId = d.look.cstyle;
    const head = (text: string) => {
      const h = document.createElement('div');
      h.className = 'sp-head';
      h.textContent = text;
      this.list.append(h);
    };
    const item = (kind: 'para' | 'char', id: string, name: string, look: Partial<NamedStyle & CharStyle>, on: boolean) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sp-item';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-pressed', String(on));
      b.title = kind === 'para' ? `${name}: a paragraph style (click to give it to the paragraphs picked)` : `${name}: a character style (click to give it to the words picked)`;
      const n = document.createElement('span');
      n.className = 'sp-name';
      n.textContent = name;
      if (this.preview.checked) {
        if (look.font) n.style.fontFamily = cssFamily(look.font);
        if (look.size) n.style.fontSize = `${Math.max(10, Math.min(18, look.size * 1.15))}px`;
        if (look.bold) n.style.fontWeight = '700';
        if (look.italic) n.style.fontStyle = 'italic';
        if (look.color) n.style.color = look.color;
        if (look.underline || look.strike) n.style.textDecoration = [look.underline ? 'underline' : '', look.strike ? 'line-through' : ''].join(' ').trim();
        if (look.smallCaps) n.style.fontVariant = 'small-caps';
        if (look.allCaps) n.style.textTransform = 'uppercase';
      }
      const k = document.createElement('span');
      k.className = 'sp-kind';
      k.textContent = kind === 'para' ? '¶' : 'a';
      b.append(n, k);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        this.picked = { kind, id };
        if (kind === 'para') this.host.applyPara(id);
        else this.host.applyChar(id);
      });
      b.addEventListener('dblclick', () => this.host.modify(kind, id));
      this.list.append(b);
    };
    head('Paragraph styles');
    // the headings in order, then the rest as the document has them
    const ids = Object.keys(d.t.styles).sort((a, b) => order(d.t.styles[a]) - order(d.t.styles[b]));
    for (const id of ids) item('para', id, d.t.styles[id].name, d.t.styles[id], id === paraId);
    head('Character styles');
    const cs = charStylesOf(d.t);
    for (const id of Object.keys(cs)) item('char', id, cs[id].name, cs[id], id === charId);
    const p = this.picked;
    const deletable = !!p && (p.kind === 'para' ? !STANDARD_STYLES.has(p.id) && !!d.t.styles[p.id] : !!cs[p.id]?.custom);
    this.del.disabled = !deletable;
    this.mod.disabled = !p && !this.current();
  }
}

/** Where a paragraph style goes in the list: Normal, Title, the headings by level, then the others. */
function order(s: NamedStyle): number {
  if (s.id === 'Normal') return 0;
  if (s.id === 'Title') return 1;
  if (s.outline) return 1 + s.outline;
  return s.custom ? 20 : 11;
}
