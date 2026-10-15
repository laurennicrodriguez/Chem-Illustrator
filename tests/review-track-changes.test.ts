// @vitest-environment jsdom
//
// Track Changes: edits made other than by typing are marked too (Replace, autocorrect, pasting
// our own copy, text boxes and table cells), and Accept All / Reject All reach every one.

import { describe, it, expect } from 'vitest';
import { DocFile } from '../src/document/doc-file';
import { newDocument, objectRun, type DocText } from '../src/document/document';
import { DocFind } from '../src/ui/doc-find';
import { afterTyping } from '../src/text/typing';
import { changesIn, countChanges, decide, decideEverywhere } from '../src/document/revisions';
import * as rt from '../src/richtext';

const tracked = (text: string, extra: Partial<DocText> = {}) => new DocFile({ ...newDocument(), runs: [{ text }], paras: [{}], track: true, ...extra } as DocText);
const kinds = (f: DocFile) => changesIn(f.t.runs).map((c) => [c.kind, c.text]);

describe('track changes', () => {
  it('marks Replace All', () => {
    const f = tracked('Dry over MgSO4 and filter.');
    const parent = document.createElement('div');
    document.body.append(parent);
    const find = new DocFind(parent, { file: () => f, focus: () => {}, flash: () => {}, redraw: () => {} });
    find.show(true);
    (parent.querySelector('.df-find') as HTMLInputElement).value = 'MgSO4';
    (parent.querySelector('.df-with') as HTMLInputElement).value = 'Na2SO4';
    find.refresh();
    (parent.querySelector('[data-act="all"]') as HTMLButtonElement).click();
    expect(kinds(f)).toEqual([['del', 'MgSO4'], ['ins', 'Na2SO4']]);
    // the struck-through words are not found again
    find.refresh();
    (parent.querySelector('[data-act="all"]') as HTMLButtonElement).click();
    expect(kinds(f)).toEqual([['del', 'MgSO4'], ['ins', 'Na2SO4']]);
    expect(rt.plainText(decide(f.t, false).runs)).toBe('Dry over MgSO4 and filter.');
  });

  it('marks an autocorrection, so Reject All gives back the text as it was', () => {
    const f = tracked('Stir at 65 u');
    f.ed.onTyped = (typed) => afterTyping(f.ed, typed);
    f.ed.setCaret(f.ed.text.length);
    for (const ch of 'L ') f.ed.type(ch);
    expect(f.ed.text).toBe('Stir at 65 uµL ');
    expect(rt.plainText(decide(f.t, false).runs)).toBe('Stir at 65 u');
    expect(rt.plainText(decide(f.t, true).runs)).toBe('Stir at 65 µL ');
  });

  it('marks our own copy pasted in (objects first, then the text joined to that step)', () => {
    const f = tracked('Dry over MgSO4.');
    f.ed.select(9, 14);
    const copied = f.ed.selected();
    f.ed.setCaret(f.ed.text.length);
    f.ed.update({ ...f.t }, 'paste');
    f.ed.replace(f.ed.start, f.ed.end, copied.runs, undefined, null);
    expect(kinds(f)).toEqual([['ins', 'MgSO4']]);
  });

  it('marks typing in a text box and a table cell, and Accept All takes in both', () => {
    const f = tracked('See the box and the table.', {
      objects: {
        1: { kind: 'textbox', runs: [{ text: 'Box' }], w: 100 },
        2: { kind: 'table', table: { cols: [100], rows: [[{ runs: [{ text: 'Cell' }] }]], head: 0 } },
      } as never,
    });
    f.ed.update({ ...f.t, runs: [...f.t.runs, objectRun(1, {}), objectRun(2, {})] }, 'setup');
    const box = f.editBox(1)!;
    box.type(' text');
    f.endBox();
    const cell = f.editCell(2, 0, 0)!;
    cell.type(' text');
    f.endBox();
    expect(countChanges(f.t)).toBe(2);
    const done = decideEverywhere(f.t, true);
    expect(countChanges(done)).toBe(0);
    expect(rt.plainText((done.objects[1] as { runs: never }).runs)).toBe('Box text');
    const rejected = decideEverywhere(f.t, false) as DocText;
    const t2 = rejected.objects[2] as { table: { rows: { runs: never }[][] } };
    expect(rt.plainText(t2.table.rows[0][0].runs)).toBe('Cell');
  });
});
