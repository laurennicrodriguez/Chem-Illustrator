// @vitest-environment jsdom
//
// Tracked changes: while tracking is on, typed text is marked inserted and deleted text stays,
// marked deleted, until it is accepted or rejected. Saved to Word as Word's own tracked changes
// (w:ins and w:del) and opened from Word the same way.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { newDocument, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import { accepted, authorColours, changesIn, decide, markedRuns, parseRev, revText, revisionDate, trackedReplace } from '../src/document/revisions';
import { TextEditing } from '../src/text/editing';
import * as rt from '../src/richtext';
import type { TextRun } from '../src/model';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };
const NATE = { author: 'Nate', date: '2026-10-14T21:00:00Z' };
const ANA = { author: 'Ana', date: '2026-10-14T22:00:00Z' };
const plain = (text: string) => ({ runs: [{ text }] as TextRun[], paras: [{}] });
const text = (t: { runs: TextRun[] }) => rt.plainText(t.runs);
const shown = (t: { runs: TextRun[] }) => changesIn(t.runs).map((c) => `${c.kind}:${c.author}:${c.text}`);

describe('tracked edits', () => {
  it('keeps deleted text in place, marked, and marks typed text inserted', () => {
    const got = trackedReplace(plain('stirred for 2 h'), 12, 13, [{ text: '16' }], undefined, NATE);
    expect(text(got.t)).toBe('stirred for 216 h');
    expect(shown(got.t)).toEqual(['del:Nate:2', 'ins:Nate:16']);
    expect(got.caret).toBe(15);
    expect(got.kept).toBe(1);
    expect(parseRev(got.t.runs[1].rev)).toEqual({ kind: 'del', ...NATE });
  });

  it('takes text inserted while tracking away for real, and leaves text already deleted as it was', () => {
    let t = trackedReplace(plain('add THF'), 4, 4, [{ text: 'dry ' }], undefined, NATE).t;
    t = trackedReplace(t, 4, 6, [], undefined, NATE).t; // "dr" of the insertion
    expect(text(t)).toBe('add y THF');
    t = trackedReplace(t, 0, 4, [], undefined, ANA).t; // Ana deletes "add "
    t = trackedReplace(t, 0, 6, [], undefined, NATE).t; // Nate deletes over Ana's deletion and his "y "
    expect(text(t)).toBe('add THF');
    expect(shown(t)).toEqual(['del:Ana:add ']);
  });

  it('accepts or rejects changes, all of them or the ones in a range', () => {
    const t = trackedReplace(plain('stirred for 2 h'), 12, 13, [{ text: '16' }], undefined, NATE).t;
    expect(text(accepted(t))).toBe('stirred for 16 h');
    expect(changesIn(accepted(t).runs)).toEqual([]);
    expect(text(decide(t, false))).toBe('stirred for 2 h');
    expect(decide(t, false).runs).toEqual([{ text: 'stirred for 2 h' }]);
    // only the deletion
    const one = decide(t, true, 12, 13);
    expect(text(one)).toBe('stirred for 16 h');
    expect(shown(one)).toEqual(['ins:Nate:16']);
  });

  it('keeps paragraph styles in step when a paragraph break is inserted or taken away', () => {
    const d = { runs: [{ text: 'One\nTwo' }] as TextRun[], paras: [{ justify: 'center' as const }, {}] };
    const ins = trackedReplace(d, 3, 3, [{ text: '\nNew' }], [{ indent: 20 }], NATE).t;
    expect(text(ins)).toBe('One\nNew\nTwo');
    expect(ins.paras).toHaveLength(3);
    expect(decide(ins, false).paras).toHaveLength(2);
    const del = trackedReplace(d, 3, 4, [], undefined, NATE).t;
    expect(text(del)).toBe('One\nTwo');
    expect(accepted(del).paras).toHaveLength(1);
  });

  it('gives each person a colour and shows insertions underlined, deletions struck through', () => {
    let t = trackedReplace(plain('ab'), 0, 1, [], undefined, NATE).t;
    t = trackedReplace(t, 2, 2, [{ text: 'c' }], undefined, ANA).t;
    const colours = authorColours(t.runs);
    expect([...colours.keys()]).toEqual(['Nate', 'Ana']);
    const m = markedRuns(t.runs, colours);
    expect(m[0]).toMatchObject({ strike: true, color: colours.get('Nate') });
    expect(m[2]).toMatchObject({ underline: true, color: colours.get('Ana') });
    expect(m[1].strike).toBeUndefined();
  });

  it('stores who and when on the run', () => {
    expect(revText({ kind: 'ins', author: 'A|B', date: 'x' })).toBe('ins|A/B|x');
    expect(parseRev('bogus|a|b')).toBeNull();
    expect(revisionDate(new Date('2026-10-14T21:00:00.123Z'))).toBe('2026-10-14T21:00:00Z');
  });
});

describe('typing with tracking on', () => {
  const make = (t: string, who: typeof NATE | null = NATE) => {
    const ed = new TextEditing({ runs: [{ text: t }], justify: 'left' }, { size: 10 }, (s, z) => s.length * z * 0.5, 10);
    ed.track = () => who;
    return ed;
  };

  it('marks typing, and backspace and delete leave the text struck through, moving past it', () => {
    const ed = make('2 h');
    ed.setCaret(1);
    ed.backspace();
    expect(ed.text).toBe('2 h');
    expect(ed.focus).toBe(0);
    ed.type('16');
    expect(ed.text).toBe('162 h');
    expect(shown(ed.t)).toEqual(['ins:Nate:16', 'del:Nate:2']);
    ed.setCaret(2);
    ed.deleteForward(); // over the struck "2": nothing changes, the caret moves past
    expect(ed.text).toBe('162 h');
    expect(ed.focus).toBe(3);
    ed.setCaret(2);
    ed.backspace(); // the typed "6" goes for real
    expect(ed.text).toBe('12 h');
  });

  it('edits normally when tracking is off', () => {
    const ed = make('2 h', null);
    ed.setCaret(1);
    ed.backspace();
    expect(ed.text).toBe(' h');
    expect(ed.t.runs.some((r) => r.rev)).toBe(false);
  });
});

describe('Word files', () => {
  function sample(): DocText {
    const d = newDocument();
    const n = runStyleOf(d.styles.Normal);
    let t: DocText = { ...d, runs: [{ ...n, text: 'The mixture was stirred for 2 h.\nThen filtered.' }], paras: [paraFromStyle(d.styles.Normal, {}), paraFromStyle(d.styles.Normal, {})], track: true };
    const two = text(t).indexOf("2 h");
    t = trackedReplace(t, two, two + 1, [{ ...n, text: "16" }], undefined, NATE).t;
    // Ana joins the two paragraphs (the paragraph mark is deleted)
    const nl = text(t).indexOf('\n');
    t = trackedReplace(t, nl, nl + 1, [], undefined, ANA).t;
    return t;
  }

  it('saves changes as Word\'s own, with tracking left on', async () => {
    const files = unzipSync(await writeDocx(sample(), deps));
    const body = strFromU8(files['word/document.xml']);
    expect(body).toMatch(/<w:del w:id="\d+" w:author="Nate" w:date="2026-10-14T21:00:00Z"><w:r>(<w:rPr>.*?<\/w:rPr>)?<w:delText[^>]*>2<\/w:delText><\/w:r><\/w:del>/);
    expect(body).toMatch(/<w:ins w:id="\d+" w:author="Nate" w:date="2026-10-14T21:00:00Z"><w:r>(<w:rPr>.*?<\/w:rPr>)?<w:t[^>]*>16<\/w:t><\/w:r><\/w:ins>/);
    // the deleted paragraph mark
    expect(body).toMatch(/<w:pPr>.*?<w:rPr><w:del w:id="\d+" w:author="Ana"[^/]*\/><\/w:rPr><\/w:pPr>/);
    expect(strFromU8(files['word/settings.xml'])).toContain('<w:trackRevisions/>');
  });

  it('opens Word\'s changes as changes, with tracking on as it was', async () => {
    const before = sample();
    const back = await readDocx(await writeDocx(before, deps));
    expect(back.doc.track).toBe(true);
    expect(text(back.doc)).toBe(text(before));
    expect(shown(back.doc)).toEqual(shown(before));
    expect(back.warnings.join(' ')).not.toMatch(/track/i);
    expect(text(accepted(back.doc))).toBe('The mixture was stirred for 16 h.Then filtered.');
  });

  it('leaves a document with no changes as it was', async () => {
    const d = newDocument();
    d.runs = [{ ...runStyleOf(d.styles.Normal), text: 'Plain' }];
    const files = unzipSync(await writeDocx(d, deps));
    expect(strFromU8(files['word/document.xml'])).not.toMatch(/<w:(ins|del) /);
    expect(strFromU8(files['word/settings.xml'])).not.toContain('trackRevisions');
    expect((await readDocx(await writeDocx(d, deps))).doc.track).toBeFalsy();
  });
});
