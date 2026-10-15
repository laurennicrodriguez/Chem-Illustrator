import { describe, it, expect } from 'vitest';
import { newDocument, fieldTexts, objectRun } from '../src/document/document';
import { bibliography, blankRef } from '../src/document/references';

describe('citations in table cells', () => {
  it('number the bibliography the way the citations show', () => {
    const d = newDocument();
    const A = { ...blankRef('article', 'A'), title: 'Alpha' }, B = { ...blankRef('article', 'B'), title: 'Beta' }, C = { ...blankRef('article', 'C'), title: 'Gamma' };
    d.references = [A, B, C];
    d.objects = {
      1: { kind: 'cite', refs: ['A'] },
      2: { kind: 'table', table: { cols: [100], rows: [[{ runs: [{ text: 'yield ' }, objectRun(3, {})] }]], head: 0 } } as never,
      3: { kind: 'cite', refs: ['B'] },
      4: { kind: 'cite', refs: ['C'] },
      5: { kind: 'bib' },
    };
    d.runs = [{ text: 'First ' }, objectRun(1, {}), { text: ' then\n' }, objectRun(2, {}), { text: '\nlast ' }, objectRun(4, {}), { text: '\n' }, objectRun(5, {})];
    d.paras = [{}, {}, {}, {}];
    const shown = fieldTexts(d);
    const bib = bibliography(d).map((e) => `${e.label} ${e.ref.id}`);
    // A is cited first, B inside the table, C after it: 1, 2, 3 in the text and in the list
    expect([shown.get(1), shown.get(3), shown.get(4)].map((x) => x!.replace(/\D/g, ''))).toEqual(['1', '2', '3']);
    expect(bib.map((x) => x.split(' ')[1])).toEqual(['A', 'B', 'C']);
  });
});
