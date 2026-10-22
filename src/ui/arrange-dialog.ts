// Chemistry > Reactions and Schemes > Arrange Scheme: a gallery of scheme layouts, like SmartArt in Office. Clicking a layout lays
// the selected scheme out that way at once, so layouts can be tried one after another; Cancel
// puts the scheme back as it was, Done keeps it (one Undo takes it back).

import type { ArrangeKind, ArrangeOptions } from '../chem/scheme-arrange';

export interface ArrangeHooks {
  /** Lay the scheme out; false when it can't be (nothing to arrange, or a branch in a line). */
  apply(opts: ArrangeOptions): boolean;
  undo(): void;
}

interface Layout { kind: ArrangeKind; name: string; hint: string; svg: string }

// little pictures: dots are structures, lines are arrows
const dot = (x: number, y: number) => `<rect x="${x - 6}" y="${y - 5}" width="12" height="10" rx="2"/>`;
const arr = (x1: number, y1: number, x2: number, y2: number) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#ah)"/>`;
const arc = (x1: number, y1: number, x2: number, y2: number, r: number, sweep = 1) => `<path d="M${x1} ${y1} A${r} ${r} 0 0 ${sweep} ${x2} ${y2}" fill="none" marker-end="url(#ah)"/>`;
const pic = (body: string) => `<svg viewBox="0 0 96 64" aria-hidden="true"><defs><marker id="ah" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L6 3L0 6z"/></marker></defs>${body}</svg>`;

const LAYOUTS: Layout[] = [
  { kind: 'line', name: 'Line', hint: 'Every step in one row, left to right.',
    svg: pic(dot(10, 32) + arr(18, 32, 34, 32) + dot(42, 32) + arr(50, 32, 66, 32) + dot(76, 32)) },
  { kind: 'rows', name: 'Rows', hint: 'Left to right, starting a new row (with its arrow) after so many steps, like a page of text.',
    svg: pic(dot(10, 16) + arr(18, 16, 34, 16) + dot(42, 16) + arr(50, 16, 66, 16) + dot(76, 16) + arr(4, 46, 20, 46) + dot(30, 46) + arr(38, 46, 54, 46) + dot(64, 46)) },
  { kind: 'snake', name: 'Snake', hint: 'Rows that turn back on themselves, so each step follows on from the one before.',
    svg: pic(dot(10, 14) + arr(18, 14, 34, 14) + dot(44, 14) + arr(52, 14, 68, 14) + dot(78, 14) + arr(78, 21, 78, 39) + dot(78, 48) + arr(70, 48, 54, 48) + dot(44, 48)) },
  { kind: 'down', name: 'Down the page', hint: 'Each step below the one before, with the conditions beside the arrow.',
    svg: pic(dot(48, 8) + arr(48, 15, 48, 26) + dot(48, 32) + arr(48, 39, 48, 50) + dot(48, 56)) },
  { kind: 'cycle', name: 'Catalytic cycle', hint: 'Round a circle; the last step leads back to the first. A caption selected on its own goes in the middle.',
    svg: pic(dot(48, 8) + arc(57, 12, 72, 40, 26) + dot(74, 48) + arc(66, 54, 30, 54, 26) + dot(22, 48) + arc(24, 40, 39, 12, 26) + '<text x="48" y="38" text-anchor="middle">cat.</text>') },
  { kind: 'tree', name: 'Branching', hint: 'Steps that split or come together, laid out in columns from left to right.',
    svg: pic(dot(12, 32) + arr(20, 28, 38, 16) + arr(20, 36, 38, 48) + dot(46, 14) + dot(46, 50) + arr(54, 14, 72, 14) + dot(82, 14)) },
];

export class ArrangeDialog {
  constructor(private hooks: ArrangeHooks) {}

  open(): void {
    const d = document.createElement('dialog');
    d.className = 'ask arrange-dialog';
    const form = document.createElement('form');
    const h = document.createElement('h2');
    h.textContent = 'Arrange Scheme';
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = 'Lays out the selected scheme (or the whole drawing). Structures that aren\'t in a step yet are joined on in reading order with new arrows. Click a layout to try it.';
    const grid = document.createElement('div');
    grid.className = 'arrange-grid';
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', 'Layout');

    // options
    const opts = document.createElement('div');
    opts.className = 'arrange-opts';
    const perRow = document.createElement('input');
    perRow.type = 'number';
    perRow.min = '1';
    perRow.max = '12';
    perRow.value = '3';
    const perLabel = label('Arrows in each row', perRow);
    const anti = document.createElement('input');
    anti.type = 'checkbox';
    const antiLabel = label('Go round anticlockwise', anti);
    const reagents = document.createElement('input');
    reagents.type = 'checkbox';
    const reagentLabel = label('Reagents in and by-products out on small arrows (conditions above go in, below come out)', reagents);
    const fork = document.createElement('input');
    fork.type = 'checkbox';
    fork.checked = true;
    const forkLabel = label('Branches fan out from one point (a forked arrow)', fork);
    opts.append(perLabel, antiLabel, reagentLabel, forkLabel);

    const status = document.createElement('p');
    status.className = 'name-status';
    status.setAttribute('role', 'status');
    const buttons = document.createElement('p');
    buttons.className = 'ask-buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'primary';
    ok.textContent = 'Done';
    buttons.append(cancel, ok);

    let kind: ArrangeKind | null = null;
    let applied = false;
    const tiles = new Map<ArrangeKind, HTMLButtonElement>();
    const showOpts = () => {
      perLabel.hidden = kind !== 'rows' && kind !== 'snake';
      antiLabel.hidden = reagentLabel.hidden = kind !== 'cycle';
      forkLabel.hidden = kind !== 'tree';
      for (const [k, b] of tiles) b.setAttribute('aria-checked', String(k === kind));
    };
    const run = () => {
      if (!kind) return;
      if (applied) { this.hooks.undo(); applied = false; }
      const per = Math.max(1, Math.min(12, Math.round(Number(perRow.value)) || 3));
      applied = this.hooks.apply({ kind, perRow: per, anticlockwise: anti.checked, reagentArrows: reagents.checked, forked: fork.checked });
      status.classList.toggle('error', !applied);
      status.textContent = applied ? ''
        : kind === 'tree' ? 'Nothing to arrange: select structures, or a scheme with arrows.'
        : 'This layout needs the steps to follow one after another. For steps that split or join, choose Branching.';
    };
    for (const l of LAYOUTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'arrange-tile';
      b.setAttribute('role', 'radio');
      b.title = l.hint;
      b.innerHTML = l.svg;
      const cap = document.createElement('span');
      cap.textContent = l.name;
      b.append(cap);
      b.addEventListener('click', () => { kind = l.kind; showOpts(); run(); });
      tiles.set(l.kind, b);
      grid.append(b);
    }
    for (const el of [perRow, anti, reagents, fork]) el.addEventListener('change', run);
    showOpts();

    form.append(h, note, grid, opts, status, buttons);
    d.append(form);
    let keep = false;
    form.addEventListener('submit', (e) => { e.preventDefault(); keep = true; d.close(); });
    cancel.addEventListener('click', () => d.close());
    d.addEventListener('close', () => {
      if (!keep && applied) this.hooks.undo();
      d.remove();
    });
    document.body.append(d);
    d.showModal();
    tiles.get('line')!.focus();
  }
}

function label(text: string, input: HTMLInputElement): HTMLLabelElement {
  const l = document.createElement('label');
  const s = document.createElement('span');
  s.textContent = text;
  if (input.type === 'checkbox') l.append(input, s);
  else l.append(s, input);
  return l;
}
