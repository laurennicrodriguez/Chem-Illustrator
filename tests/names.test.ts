// Name to structure: tidying names, reading OPSIN's answers, and the JavaScript build of OPSIN
// itself, which must answer exactly as Java OPSIN does (tests/opsin-expected.json is written by
// the Java build in opsin-js/).

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { cleanName, captionName, parseReply, attachmentAtoms, cxNotes } from '../src/chem/names';
import { load, parse } from '../src/vendor/opsin/opsin.js';

describe('tidying a name', () => {
  it('turns typographic dashes, quotes and spaces into plain ones', () => {
    expect(cleanName('2–methyl‑propan‒2−ol')).toBe('2-methyl-propan-2-ol');
    expect(cleanName('N’-methyl')).toBe("N'-methyl");
    expect(cleanName('  ethyl  acetate \n')).toBe('ethyl acetate');
    expect(cleanName('chloro­form​')).toBe('chloroform');
  });

  it('keeps primes, which OPSIN reads', () => {
    expect(cleanName("N,N′-dimethylurea")).toBe('N,N′-dimethylurea');
  });

  it('puts a name wrapped over several caption lines back together', () => {
    expect(captionName('ethyl 2-oxo-2H-chromene-\n3-carboxylate')).toBe('ethyl 2-oxo-2H-chromene-3-carboxylate');
    expect(captionName('ethyl\nacetate')).toBe('ethyl acetate');
    expect(captionName('2,\n4-dinitrophenol')).toBe('2,4-dinitrophenol');
    expect(captionName('\n  benzene  \n\n')).toBe('benzene');
  });
});

describe("reading OPSIN's answers", () => {
  it('passes on a structure and its warnings', () => {
    expect(parseReply('{"ok":true,"smiles":"CCO","warnings":["Stereo ignored",""]}')).toEqual({ ok: true, smiles: 'CCO', warnings: ['Stereo ignored'], message: '' });
  });

  it('passes on why a name could not be read', () => {
    expect(parseReply('{"ok":false,"message":"xyzzy was uninterpretable"}')).toMatchObject({ ok: false, message: 'xyzzy was uninterpretable' });
  });

  it('treats anything odd as a failure, never a crash', () => {
    expect(parseReply('not json').ok).toBe(false);
    expect(parseReply('{"ok":true}').ok).toBe(false);
    expect(parseReply('null').ok).toBe(false);
    expect(parseReply('{"ok":false}').message).toBeTruthy();
  });

  it('finds the points of attachment of substituent names', () => {
    expect(attachmentAtoms('*C1=CC=C(C=C1)OC |$_AP1$|')).toEqual([0]);
    expect(attachmentAtoms('*C1=CC=C(C=C1)* |$_AP1;;;;;;;_AP2$|')).toEqual([0, 7]);
    expect(attachmentAtoms('C1=CC=CC=C1')).toEqual([]);
    // polymer ends are not attachment points; atom values are not labels
    expect(attachmentAtoms('[*:1]CC[*:2] |$star_e;;;star_e$,Sg:n:1,2::ht|')).toEqual([]);
    expect(attachmentAtoms('*CC |$_AV:1;2;3$|')).toEqual([]);
    expect(attachmentAtoms('*CC |$_AV:;1;2$,$_AP1;;$|')).toEqual([0]);
  });
});

describe('what a drawing cannot show yet', () => {
  it('notes racemic and relative stereochemistry', () => {
    expect(cxNotes('Br[C@H](C)[C@H](C)Br |r|')).toEqual([expect.stringMatching(/racemic/)]);
    expect(cxNotes('C[C@H](O)CC |&1:1|')).toEqual([expect.stringMatching(/racemic/)]);
    expect(cxNotes('[C@@H]1([C@H](CCCC1)O)O |o1:0,1|')).toEqual([expect.stringMatching(/relative/)]);
  });

  it('notes polymer brackets', () => {
    expect(cxNotes('[*:1]CC[*:2] |$star_e;;;star_e$,Sg:n:1,2::ht|')).toEqual([expect.stringMatching(/Polymer/)]);
  });

  it('says nothing about plain structures or labels', () => {
    expect(cxNotes('C[C@H](CC)O')).toEqual([]);
    expect(cxNotes('*C1=CC=C(C=C1)OC |$_AP1$|')).toEqual([]);
    expect(cxNotes('*C |$r;$|')).toEqual([]);
  });
});

describe('the JavaScript build of OPSIN', () => {
  const expected: Record<string, string> = JSON.parse(fs.readFileSync('tests/opsin-expected.json', 'utf8')).results;

  beforeAll(() => {
    const raw = zlib.gunzipSync(fs.readFileSync('public/opsin/opsin-data.dat'));
    expect(load(new Int8Array(raw.buffer, raw.byteOffset, raw.byteLength))).toBe('');
  });

  it('refuses data that is not its own', () => {
    expect(load(new Int8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toMatch(/not an OPSIN data pack/i);
    // put the real data back for the other tests
    const raw = zlib.gunzipSync(fs.readFileSync('public/opsin/opsin-data.dat'));
    expect(load(new Int8Array(raw.buffer, raw.byteOffset, raw.byteLength))).toBe('');
  });

  it('gives exactly what Java OPSIN gives', () => {
    const names = Object.keys(expected);
    expect(names.length).toBeGreaterThan(40);
    for (const name of names) expect(JSON.parse(parse(name)), name).toEqual(expected[name]);
  }, 60_000);

  it('reads systematic names, stereo and all', () => {
    expect(parseReply(parse('(2R)-butan-2-ol'))).toMatchObject({ ok: true, smiles: 'C[C@H](CC)O' });
    expect(parseReply(parse('(E)-but-2-enoic acid')).smiles).toMatch(/[/\\]/); // a double-bond direction mark
  });
});
