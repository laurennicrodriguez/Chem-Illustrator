// @vitest-environment jsdom
//
// Pasting into a Document: cells (an HTML table, or tab-separated text with no HTML) become a
// table in the text; text with a table among other things stays text.

import { describe, it, expect } from 'vitest';
import { onlyTable, tsvTable } from '../src/ui/doc-mode';

describe('cells pasted into a document', () => {
  it('takes an HTML table on its own as cells', () => {
    expect(onlyTable('<html><body><!--StartFragment--><table><tr><td>Phenol</td><td>95</td></tr></table><!--EndFragment--></body></html>')).toBe(true);
    expect(onlyTable('<p>Intro</p><table><tr><td>a</td><td>b</td></tr></table>')).toBe(false);
    expect(onlyTable('<p>No table</p>')).toBe(false);
  });
  it('takes tab-separated rows of the same length as cells, and other text with tabs as text', () => {
    expect(tsvTable('Phenol\t95\tC[C@H](O)c1ccccc1\r\n')?.[0].map((c) => c.runs.map((r) => r.text).join(''))).toEqual(['Phenol', '95', 'C[C@H](O)c1ccccc1']);
    expect(tsvTable('Name\tYield\nX\t95\n')?.length).toBe(2);
    expect(tsvTable('•\tfirst item\nsecond line')).toBeNull();
    expect(tsvTable('no tabs here')).toBeNull();
  });
});
