// File > New from Template: a gallery of our own document and sheet templates (lab report,
// Supporting Information, thesis chapter; reaction table, reagent sheet), each shown as a small
// page of its headings, or its first row of column headings.

import { DOC_TEMPLATES, type DocTemplate } from '../document/templates';
import { SHEET_TEMPLATES, type SheetTemplate } from '../sheet/templates';
import { keyOf } from '../sheet/refs';

export type TemplateChoice = { kind: 'document'; template: DocTemplate | null } | { kind: 'sheet'; template: SheetTemplate | null };

/** A small page showing a document template's title and headings. */
function docPreview(t: DocTemplate): HTMLElement {
  const page = document.createElement('div');
  page.className = 'ft-page';
  page.setAttribute('aria-hidden', 'true');
  const d = t.make();
  const text = d.runs.map((r) => r.text).join('').split('\n');
  d.paras.slice(0, 40).forEach((p, i) => {
    const s = p.style;
    if (s !== 'Title' && s !== 'Heading1' && s !== 'Heading2') return;
    const line = document.createElement('div');
    line.className = s === 'Title' ? 'ft-title' : s === 'Heading1' ? 'ft-h1' : 'ft-h2';
    line.textContent = text[i] ?? '';
    page.append(line);
  });
  return page;
}

/** A small grid showing a sheet template's column headings. */
function sheetPreview(t: SheetTemplate): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'ft-sheet';
  grid.setAttribute('aria-hidden', 'true');
  const sh = t.make().sheets[0];
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 5; c++) {
      const cell = document.createElement('span');
      cell.textContent = r === 0 ? (sh.cells.get(keyOf(0, c))?.input ?? '') : '';
      if (r === 0) cell.className = 'ft-head';
      grid.append(cell);
    }
  }
  return grid;
}

/** Ask which template to start from; `prefer` puts that kind's templates first. Null when cancelled. */
export function pickFileTemplate(prefer: 'document' | 'sheet' = 'document'): Promise<TemplateChoice | null> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'ask template-gallery file-templates';
    d.setAttribute('aria-label', 'New from Template');
    const h = document.createElement('h2');
    h.textContent = 'New from Template';
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = 'Each template opens as a new, unsaved file. Text in [brackets] says what goes there; type over it.';
    let result: TemplateChoice | null = null;
    const card = (name: string, blurb: string, preview: HTMLElement, choice: TemplateChoice) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tg-card ft-card';
      const t = document.createElement('strong');
      t.textContent = name;
      const p = document.createElement('span');
      p.className = 'tg-blurb';
      p.textContent = blurb;
      b.append(preview, t, p);
      b.addEventListener('click', () => { result = choice; d.close(); });
      return b;
    };
    const section = (title: string, cards: HTMLElement[]) => {
      const s = document.createElement('section');
      const h3 = document.createElement('h3');
      h3.textContent = title;
      const grid = document.createElement('div');
      grid.className = 'tg-grid';
      grid.append(...cards);
      s.append(h3, grid);
      return s;
    };
    const blankPage = document.createElement('div');
    blankPage.className = 'ft-page';
    const blankGrid = document.createElement('div');
    blankGrid.className = 'ft-sheet';
    for (let i = 0; i < 30; i++) blankGrid.append(document.createElement('span'));
    const docs = section('Documents', [
      card('Blank document', 'An empty page in the standard styles.', blankPage, { kind: 'document', template: null }),
      ...DOC_TEMPLATES.map((t) => card(t.name, t.blurb, docPreview(t), { kind: 'document', template: t })),
    ]);
    const sheets = section('Sheets', [
      card('Blank sheet', 'An empty workbook.', blankGrid, { kind: 'sheet', template: null }),
      ...SHEET_TEMPLATES.map((t) => card(t.name, t.blurb, sheetPreview(t), { kind: 'sheet', template: t })),
    ]);
    const body = document.createElement('div');
    body.className = 'ft-body';
    body.append(...(prefer === 'sheet' ? [sheets, docs] : [docs, sheets]));
    const buttons = document.createElement('p');
    buttons.className = 'ask-buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => d.close());
    buttons.append(cancel);
    d.append(h, note, body, buttons);
    d.addEventListener('close', () => { d.remove(); resolve(result); });
    document.body.append(d);
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    (body.querySelector('.ft-card') as HTMLElement | null)?.focus();
  });
}
