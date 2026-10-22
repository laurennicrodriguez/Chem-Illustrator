// Review > Compare and Combine: two versions of a document, and the differences between them as
// tracked changes.

import { describe, it, expect } from 'vitest';
import { compareDocuments, combineDocuments, diff } from '../src/document/compare';
import { newDocument, OBJECT_CHAR, type DocText } from '../src/document/document';
import { changesIn, decide, revText } from '../src/document/revisions';
import * as rt from '../src/richtext';
import type { TextRun } from '../src/model';

const doc = (text: string, extra: Partial<DocText> = {}): DocText => ({ ...newDocument(), runs: [{ text }], paras: text.split('\n').map(() => ({})), ...extra });
const opts = { author: 'Reviewer', date: '2026-10-22T12:00:00Z' };
const marked = (runs: TextRun[]) => changesIn(runs).map((c) => `${c.kind}:${c.text}`);

describe('diff', () => {
  it('finds the shortest edit', () => {
    const ops = diff('ABCABBA'.split(''), 'CBABAC'.split(''));
    expect(ops.filter((o) => o !== 'eq').length).toBe(5);
    expect(diff(['a'], ['a'])).toEqual(['eq']);
    expect(diff([], ['a', 'b'])).toEqual(['ins', 'ins']);
  });
});

describe('compare', () => {
  it('marks changed words as deleted and inserted', () => {
    const { doc: d, changes } = compareDocuments(doc('Stir the mixture at 65 °C for 2 h.'), doc('Stir the solution at 65 °C for 3 h.'), opts);
    expect(marked(d.runs)).toEqual(['del:mixture', 'ins:solution', 'del:2', 'ins:3']);
    expect(changes).toBe(4);
    expect(rt.plainText(decide(d, true).runs)).toBe('Stir the solution at 65 °C for 3 h.');
    expect(rt.plainText(decide(d, false).runs)).toBe('Stir the mixture at 65 °C for 2 h.');
    expect(d.runs.find((r) => r.rev)?.rev).toBe(revText({ kind: 'ins', author: 'Reviewer', date: opts.date }).replace('ins', 'del'));
  });

  it('compares letter by letter when asked', () => {
    const { doc: d } = compareDocuments(doc('MgSO4'), doc('Na2SO4'), { ...opts, level: 'char' });
    expect(marked(d.runs)).toEqual(['del:Mg', 'ins:Na2']);
  });

  it('keeps whole paragraphs that match, and paragraph settings', () => {
    const a = doc('Intro\nOld text here.\nEnd', { paras: [{ style: 'Heading1' }, {}, {}] });
    const b = doc('Intro\nNew text here.\nAdded para\nEnd', { paras: [{ style: 'Heading1' }, {}, {}, {}] });
    const { doc: d } = compareDocuments(a, b, opts);
    expect(rt.plainText(decide(d, true).runs)).toBe('Intro\nNew text here.\nAdded para\nEnd');
    expect(rt.plainText(decide(d, false).runs)).toBe('Intro\nOld text here.\nEnd');
    expect(d.paras[0].style).toBe('Heading1');
    expect(d.paras.length).toBe(rt.plainText(d.runs).split('\n').length);
  });

  it('compares each document as it reads with its own changes accepted', () => {
    const a: DocText = { ...doc(''), runs: [{ text: 'A ' }, { text: 'big ', rev: 'ins|X|2026-01-01T00:00:00Z' }, { text: 'flask', rev: undefined }], paras: [{}] };
    const { doc: d, changes } = compareDocuments(a, doc('A big flask'), opts);
    expect(changes).toBe(0);
    expect(d.runs.every((r) => !r.rev)).toBe(true);
  });

  it('copies objects only the original has, with citations of its references', () => {
    const ref = { id: 'r-1', type: 'article' as const, authors: ['Smith, J.'], title: 'T', journal: 'J', year: '2020', volume: '', issue: '', pages: '', doi: '10.1/x', url: '', publisher: '', note: '' };
    const a: DocText = { ...doc(''), runs: [{ text: 'Known' }, { text: OBJECT_CHAR, obj: 1 }, { text: '.' }], paras: [{}], objects: { 1: { kind: 'cite', refs: ['r-1'] } }, references: [ref] };
    const b: DocText = { ...doc(''), runs: [{ text: 'Known.' }], paras: [{}], objects: { 1: { kind: 'math', tex: 'x' } } };
    const { doc: d } = compareDocuments(a, b, opts);
    const del = d.runs.find((r) => r.obj !== undefined)!;
    expect(del.rev?.startsWith('del|')).toBe(true);
    expect(del.obj).not.toBe(1);
    expect(d.objects[del.obj!]).toEqual({ kind: 'cite', refs: ['r-1'] });
    expect(d.references?.map((r) => r.id)).toEqual(['r-1']);
  });

  it('matches citations of the same reference under different ids', () => {
    const ref = (id: string) => ({ id, type: 'article' as const, authors: [], title: 'T', journal: '', year: '2020', volume: '', issue: '', pages: '', doi: '10.1/X', url: '', publisher: '', note: '' });
    const a: DocText = { ...doc(''), runs: [{ text: 'See' }, { text: OBJECT_CHAR, obj: 4 }], paras: [{}], objects: { 4: { kind: 'cite', refs: ['r-a'] } }, references: [ref('r-a')] };
    const b: DocText = { ...doc(''), runs: [{ text: 'See' }, { text: OBJECT_CHAR, obj: 2 }], paras: [{}], objects: { 2: { kind: 'cite', refs: ['r-b'] } }, references: [ref('r-b')] };
    const { changes, doc: d } = compareDocuments(a, b, opts);
    expect(changes).toBe(0);
    expect(d.references?.length).toBe(1);
  });
});

describe('combine', () => {
  const X = 'ins|Ann|2026-10-20T10:00:00Z', XD = 'del|Ann|2026-10-20T10:00:00Z';
  const Y = 'ins|Ben|2026-10-21T10:00:00Z';

  it('keeps each reviewer\'s tracked changes with their own names', () => {
    const ann: DocText = { ...doc(''), runs: [{ text: 'Add the ' }, { text: 'dry ', rev: X }, { text: 'THF slowly.' }], paras: [{}] };
    const ben: DocText = { ...doc(''), runs: [{ text: 'Add the THF ' }, { text: 'very ', rev: Y }, { text: 'slowly.' }], paras: [{}] };
    const { doc: d } = combineDocuments(ann, ben, opts);
    expect(changesIn(d.runs).map((c) => `${c.author}:${c.kind}:${c.text}`)).toEqual(['Ann:ins:dry ', 'Ben:ins:very ']);
    expect(rt.plainText(decide(d, true).runs)).toBe('Add the dry THF very slowly.');
    expect(rt.plainText(decide(d, false).runs)).toBe('Add the THF slowly.');
  });

  it('marks untracked edits in the revised copy as its reviewer\'s', () => {
    const ann: DocText = { ...doc(''), runs: [{ text: 'Wash with ' }, { text: 'cold ', rev: XD }, { text: 'water.' }], paras: [{}] };
    const ben = doc('Wash with cold brine.');
    const { doc: d } = combineDocuments(ann, ben, opts);
    expect(changesIn(d.runs).map((c) => `${c.author}:${c.kind}:${c.text}`)).toEqual(['Ann:del:cold ', 'Reviewer:del:water', 'Reviewer:ins:brine']);
    expect(rt.plainText(decide(d, true).runs)).toBe('Wash with brine.');
  });

  it('puts the same insertion in once', () => {
    const ann: DocText = { ...doc(''), runs: [{ text: 'A ' }, { text: 'new ', rev: X }, { text: 'idea' }], paras: [{}] };
    const ben: DocText = { ...doc(''), runs: [{ text: 'A ' }, { text: 'new ', rev: Y }, { text: 'idea' }], paras: [{}] };
    expect(rt.plainText(combineDocuments(ann, ben, opts).doc.runs)).toBe('A new idea');
  });
});
