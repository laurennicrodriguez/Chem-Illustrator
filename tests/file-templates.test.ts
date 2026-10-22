// @vitest-environment jsdom
//
// File > New from Template: our own document and sheet templates, and that they save to Word
// and Excel and come back.

import { describe, it, expect } from 'vitest';
import { DOC_TEMPLATES } from '../src/document/templates';
import { SHEET_TEMPLATES } from '../src/sheet/templates';
import { checkDocument } from '../src/accessibility';
import { keyOf } from '../src/sheet/refs';
import { writeXlsx, readXlsx } from '../src/io/xlsx';
import { pickFileTemplate } from '../src/ui/file-templates';

const textOf = (t: { runs: { text: string }[] }) => t.runs.map((r) => r.text).join('');

describe('document templates', () => {
  it('each has a paragraph per line, headings in the heading styles, and no accessibility errors', () => {
    expect(DOC_TEMPLATES.map((t) => t.id)).toEqual(['lab-report', 'si', 'thesis-chapter']);
    for (const tpl of DOC_TEMPLATES) {
      const t = tpl.make();
      expect(textOf(t).split('\n').length).toBe(t.paras.length);
      expect(t.paras.some((p) => p.style === 'Heading1')).toBe(true);
      expect(t.paras[0].style).toBe('Title');
      expect(checkDocument(t).filter((i) => i.level === 'error')).toEqual([]);
    }
  });
  it('the lab report has a reagent table with a heading row, and the SI a contents list', () => {
    const lab = DOC_TEMPLATES[0].make();
    const tables = Object.values(lab.objects).filter((o) => o.kind === 'table');
    expect(tables).toHaveLength(1);
    expect(tables[0].kind === 'table' && tables[0].table.head).toBe(1);
    const si = DOC_TEMPLATES[1].make();
    expect(Object.values(si.objects).some((o) => o.kind === 'toc')).toBe(true);
    expect(textOf(si)).toContain('General Information');
  });
  it('the thesis chapter has a binding margin and 1.5 line spacing', () => {
    const t = DOC_TEMPLATES[2].make();
    expect(t.page.left).toBe(108);
    expect(t.styles.Normal.line).toBe(1.5);
  });
});

describe('sheet templates', () => {
  it('the reaction table picks out the best entry', () => {
    const wb = SHEET_TEMPLATES[0].make();
    const sh = wb.sheets[0];
    expect(sh.cells.get(keyOf(0, 11))?.input).toBe('Yield (%)');
    wb.edit('yields', () => { sh.setInput(1, 11, '62'); sh.setInput(2, 11, '88'); sh.setInput(3, 11, '71'); });
    expect(sh.values.get(keyOf(14, 11))).toBe(88);
    expect(sh.values.get(keyOf(15, 11))).toBe(2);
    expect(sh.frozen).toEqual({ rows: 1, cols: 1 });
  });
  it('the reagent sheet works out the yield from the limiting reagent', () => {
    const wb = SHEET_TEMPLATES[1].make();
    const [reagents, y] = wb.sheets;
    expect(reagents.name).toBe('Reagents');
    expect(y.values.get(keyOf(3, 1))).toBe(1);
    wb.edit('amounts', () => { reagents.setInput(1, 4, '2'); y.setInput(2, 1, '150'); y.setInput(5, 1, '240'); });
    expect(y.values.get(keyOf(4, 1))).toBe(300);
    expect(y.values.get(keyOf(6, 1))).toBe(80);
  });
  it('saves to .xlsx and opens again', async () => {
    const wb = SHEET_TEMPLATES[0].make();
    const bytes = await writeXlsx(wb, { structurePng: async () => null } as never);
    const { book } = await readXlsx(bytes);
    const sh = book.sheets[0];
    expect(sh.name).toBe('Optimization');
    expect(sh.cells.get(keyOf(15, 11))?.input).toMatch(/^=IF\(L15=""/);
    expect(sh.cells.get(keyOf(0, 0))?.input).toBe('Entry');
  });
});

describe('the gallery', () => {
  it('offers blank and template cards for both kinds and resolves with the one clicked', async () => {
    // jsdom has no dialog methods
    const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
    proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
    proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
    const got = pickFileTemplate('sheet');
    const cards = [...document.querySelectorAll('.file-templates .ft-card')] as HTMLButtonElement[];
    expect(cards.map((c) => c.querySelector('strong')!.textContent)).toEqual(['Blank sheet', 'Reaction table', 'Reagent sheet', 'Blank document', 'Lab report', 'Supporting Information', 'Thesis chapter']);
    cards[1].click();
    const choice = await got;
    expect(choice?.kind).toBe('sheet');
    expect(choice?.template?.id).toBe('reaction-table');
  });
});
