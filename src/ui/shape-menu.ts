// Insert > Shapes and Insert > Icons in Slides and Documents: the Design mode's library (basic
// shapes, block arrows, flowchart, callouts, lab glassware; and the icons) in a drop-down under the button.

import { DesignLibrary, type LibraryTab } from './design-panel';

export class ShapeMenu {
  private pop: HTMLDivElement;
  private lib: DesignLibrary;
  private pick: (id: string) => void = () => {};
  private close = (e: Event) => {
    if (e instanceof KeyboardEvent ? e.key === 'Escape' : !this.pop.contains(e.target as Node)) this.hide();
  };

  constructor() {
    this.pop = document.createElement('div');
    this.pop.className = 'shape-pop';
    this.pop.hidden = true;
    this.pop.setAttribute('role', 'dialog');
    this.pop.setAttribute('aria-label', 'Shapes and icons');
    const body = document.createElement('div');
    this.pop.append(body);
    document.body.append(this.pop);
    this.lib = new DesignLibrary(body, (id) => { this.hide(); this.pick(id); });
  }

  get shown(): boolean { return !this.pop.hidden; }

  /** Show the shapes (or the icons) under `button`; `pick` gets the one clicked. `tip` says what happens next. */
  show(button: HTMLElement, tip: string, pick: (id: string) => void, tab: LibraryTab = 'shapes'): void {
    if (this.shown) { this.hide(); return; }
    this.pick = pick;
    this.lib.showTab(tab);
    const p = this.pop.querySelector('.dl-head p');
    if (p) p.textContent = tip;
    this.pop.hidden = false;
    const r = button.getBoundingClientRect();
    const w = this.pop.offsetWidth;
    this.pop.style.left = `${Math.max(4, Math.min(r.left, innerWidth - w - 4))}px`;
    this.pop.style.top = `${r.bottom + 4}px`;
    this.lib.focusSearch();
    // after this click has finished
    setTimeout(() => { addEventListener('mousedown', this.close, true); addEventListener('keydown', this.close, true); });
  }

  hide(): void {
    this.pop.hidden = true;
    removeEventListener('mousedown', this.close, true);
    removeEventListener('keydown', this.close, true);
  }
}
