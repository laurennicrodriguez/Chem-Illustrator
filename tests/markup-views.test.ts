// @vitest-environment jsdom
//
// Review > Display for Review (All Markup, Simple Markup, No Markup, Original), Show Markup by
// reviewer, and formatting changes tracked like typing (Word's w:rPrChange).

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { newDocument, paraFromStyle, type DocText } from '../src/document/document';
import { DocLayouter } from '../src/document/doc-layout';
import { DocFile } from '../src/document/doc-file';
import { changesIn, decide, parseFmt, revText, showChanges, trackFormatting } from '../src/document/revisions';
import { documentMeasure } from '../src/text/font-measure';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import * as rt from '../src/richtext';
import type { TextRun } from '../src/model';

const measure = documentMeasure((t: string, size: number) => t.length * size * 0.5);
const deps: DocxDeps = { async picture() { return null; }, async svgToPng() { return new Uint8Array(); } };
const look = { font: 'Calibri', size: 11 };
const ins = (author: string) => revText({ kind: 'ins', author, date: '2026-10-22T10:00:00Z' });
const del = (author: string) => revText({ kind: 'del', author, date: '2026-10-22T10:00:00Z' });
const who = { author: 'Nate', date: '2026-10-22T10:00:00Z' };

/** "The old new yield" with "old " deleted by Nate and "new " inserted by Sam. */
function reviewed(): TextRun[] {
  return [{ ...look, text: 'The ' }, { ...look, text: 'old ', rev: del('Nate') }, { ...look, text: 'new ', rev: ins('Sam') }, { ...look, text: 'yield' }];
}

function docOf(runs: TextRun[]): DocText {
  const d = newDocument();
  return { ...d, runs, paras: [paraFromStyle(d.styles.Normal, {})] };
}

const shown = (runs: TextRun[]) => runs.filter((r) => !r.hide).map((r) => r.text).join('');

describe('markup views', () => {
  it('All Markup marks each change in its reviewer\'s colour', () => {
    const out = showChanges(reviewed(), { mode: 'all' });
    expect(out[1].strike).toBe(true);
    expect(out[2].underline).toBe(true);
    expect(out[1].color).not.toBe(out[2].color);
    expect(shown(out)).toBe('The old new yield');
  });

  it('Simple and No Markup show the text as it will read, Original as it was', () => {
    for (const mode of ['simple', 'none'] as const) {
      const out = showChanges(reviewed(), { mode });
      expect(shown(out)).toBe('The new yield');
      expect(out.some((r) => r.underline || r.strike)).toBe(false);
    }
    expect(shown(showChanges(reviewed(), { mode: 'original' }))).toBe('The old yield');
  });

  it('marks only the reviewers shown', () => {
    const out = showChanges(reviewed(), { mode: 'all', hidden: ['Sam'] });
    expect(out[1].strike).toBe(true);
    expect(out[2].underline).toBeFalsy();
    expect(out[2].hide).toBeFalsy();
  });

  it('lays out hidden text with no width and puts a bar by changed lines', () => {
    const t = docOf(reviewed());
    const L = new DocLayouter({ measure, drawingSize: () => ({ w: 1, h: 1 }) });
    const all = L.layout(t);
    L.review = { mode: 'simple' };
    const simple = L.layout(t);
    const width = (lay: typeof all) => lay.text.lines[0].width;
    expect(width(simple)).toBeLessThan(width(all));
    const hidden = simple.text.lines[0].pieces.filter((g) => g.hidden);
    expect(hidden.map((g) => g.text).join('')).toBe('old ');
    expect(simple.changeBars).toHaveLength(1);
    expect(simple.changeBars[0].simple).toBe(true);
    expect(all.changeBars[0].simple).toBe(false);
    L.review = { mode: 'none' };
    expect(L.layout(t).changeBars).toEqual([]);
  });
});

describe('formatting changes', () => {
  it('keeps the look before, and accepting or rejecting keeps or puts it back', () => {
    const before: TextRun[] = [{ ...look, text: 'crude product' }];
    const after = rt.applyStyle(before, 0, 5, { bold: true });
    const tracked = trackFormatting(before, after, 0, 5, who);
    expect(tracked[0].bold).toBe(true);
    expect(parseFmt(tracked[0].fmt)?.old.bold).toBeUndefined();
    expect(changesIn(tracked).map((c) => [c.kind, c.text])).toEqual([['fmt', 'crude']]);
    const t = { runs: tracked, paras: [{}] };
    expect(decide(t, true).runs).toEqual([{ ...look, bold: true, text: 'crude' }, { ...look, text: ' product' }]);
    expect(decide(t, false).runs).toEqual([{ ...look, text: 'crude product' }]);
    // changed back: no change left
    const back = trackFormatting(tracked, rt.applyStyle(tracked, 0, 5, { bold: false }), 0, 5, who);
    expect(back.some((r) => r.fmt)).toBe(false);
  });

  it('tracks the ribbon\'s formatting while Track Changes is on', () => {
    const f = new DocFile({ ...docOf([{ ...look, text: 'crude product' }]), track: true });
    f.ed.select(6, 13);
    f.ed.setStyle({ color: '#1f5fbf' });
    const r = f.t.runs.find((x) => x.fmt);
    expect(r?.text).toBe('product');
    expect(parseFmt(r!.fmt)?.author).toBeTruthy();
  });

  it('saves formatting changes in Word and reads them back', async () => {
    const before: TextRun[] = [{ ...look, text: 'crude product' }];
    const runs = trackFormatting(before, rt.applyStyle(before, 0, 5, { italic: true }), 0, 5, who);
    const bytes = await writeDocx(docOf(runs), deps);
    const doc = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(doc).toMatch(/<w:rPrChange w:id="\d+" w:author="Nate"/);
    const { doc: back } = await readDocx(bytes);
    const r = back.runs.find((x) => x.fmt);
    expect(r?.text).toBe('crude');
    expect(r?.italic).toBe(true);
    expect(parseFmt(r!.fmt)).toMatchObject({ author: 'Nate', date: '2026-10-22T10:00:00Z' });
    expect(parseFmt(r!.fmt)?.old.italic).toBeUndefined();
    expect(rt.plainText(decide({ runs: back.runs, paras: back.paras }, false).runs)).toBe('crude product');
    expect(decide({ runs: back.runs, paras: back.paras }, false).runs.some((x) => x.italic)).toBe(false);
  });
});
