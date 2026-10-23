// @vitest-environment jsdom
//
// Old Word documents (.doc): a small Word 97 file made here by the published layout ([MS-DOC]),
// opened with its text, formatting, headings, a table, a link and a footnote.

import { describe, it, expect } from 'vitest';
import { writeCfb } from '../src/io/cfb';
import { isDoc, readDoc } from '../src/io/doc-binary';
import * as rt from '../src/richtext';

/** Bytes with little-endian numbers written into them. */
class Buf {
  b: number[] = [];
  u8(v: number) { this.b.push(v & 0xff); return this; }
  u16(v: number) { return this.u8(v).u8(v >> 8); }
  u32(v: number) { return this.u16(v & 0xffff).u16((v >>> 16) & 0xffff); }
  at(n: number) { while (this.b.length < n) this.b.push(0); return this; }
  bytes(xs: number[]) { this.b.push(...xs); return this; }
  get length() { return this.b.length; }
}

const sprm = (code: number, ...op: number[]) => [code & 0xff, code >> 8, ...op];

/**
 * A .doc of paragraphs (each its text, character runs and paragraph sprms). Text is stored as
 * cp1252 from offset 0x400 of WordDocument; the CHPX and PAPX pages follow.
 */
function makeDoc(paras: { text: string; runs?: [number, number, number[]][]; pap?: number[]; istd?: number }[], notes: { at: number; text: string }[] = []): Uint8Array {
  let main = paras.map((p) => p.text).join('');
  const ftn = notes.map((n) => `\x02 ${n.text}\r`).join('');
  const all = main + ftn + (ftn ? '\r' : '');
  const TEXT = 0x400;
  const fcOf = (cp: number) => TEXT + cp;
  // character runs: the default (none), then the given ones
  const chpRuns: [number, number, number[]][] = [];
  let at = 0;
  for (const p of paras) {
    for (const [a, b, g] of p.runs ?? []) chpRuns.push([at + a, at + b, g]);
    at += p.text.length;
  }
  chpRuns.sort((x, y) => x[0] - y[0]);
  const runs: [number, number, number[]][] = [];
  let cur = 0;
  for (const r of chpRuns) { if (r[0] > cur) runs.push([cur, r[0], []]); runs.push(r); cur = r[1]; }
  if (cur < all.length) runs.push([cur, all.length, []]);
  const chpPage = Math.ceil((TEXT + all.length) / 512);
  const papPage = chpPage + 1;
  const wd = new Buf();
  // FibBase, csw 14, rgW, cslw 22, rgLw, cbRgFcLcb 93, then the fc/lcb pairs
  wd.u16(0xa5ec).u16(0xc1).at(0x0a).u16(0x0200).at(32);
  wd.u16(14).at(34 + 28).u16(22);
  const lw = wd.length;
  wd.at(lw + 88).u16(93);
  const fcl = wd.length;
  wd.at(fcl + 93 * 8);
  const put = (off: number, v: number) => { wd.b[off] = v & 0xff; wd.b[off + 1] = (v >> 8) & 0xff; wd.b[off + 2] = (v >> 16) & 0xff; wd.b[off + 3] = (v >>> 24) & 0xff; };
  put(lw + 12, main.length);
  put(lw + 16, ftn ? ftn.length + 1 : 0);
  wd.at(TEXT);
  for (const ch of all) wd.u8(ch.charCodeAt(0));
  // CHPX page
  wd.at(chpPage * 512);
  const cp0 = chpPage * 512;
  runs.forEach(([a], i) => { wd.b[cp0 + 4 * i] = 0; put(cp0 + 4 * i, fcOf(a)); });
  put(cp0 + 4 * runs.length, fcOf(all.length));
  let free = 511;
  runs.forEach(([, , g], i) => {
    if (!g.length) { wd.b[cp0 + 4 * (runs.length + 1) + i] = 0; return; }
    free -= g.length + 1;
    free -= free % 2;
    wd.b[cp0 + free] = g.length;
    g.forEach((v, k) => { wd.b[cp0 + free + 1 + k] = v; });
    wd.b[cp0 + 4 * (runs.length + 1) + i] = free / 2;
  });
  wd.b[cp0 + 511] = runs.length;
  // PAPX page
  wd.at(papPage * 512 + 512);
  const pp = papPage * 512;
  let pcp = 0;
  const pr: [number, number, number[]][] = [];
  for (const p of paras) { pr.push([pcp, pcp + p.text.length, [(p.istd ?? 0) & 0xff, (p.istd ?? 0) >> 8, ...(p.pap ?? [])]]); pcp += p.text.length; }
  if (pcp < all.length) pr.push([pcp, all.length, [0, 0]]);
  pr.forEach(([a], i) => put(pp + 4 * i, fcOf(a)));
  put(pp + 4 * pr.length, fcOf(all.length));
  free = 511;
  pr.forEach(([, , g], i) => {
    const body = g.length % 2 ? g : [...g, 0];
    free -= body.length + 2;
    free -= free % 2;
    // cb = 0, then the size in words
    wd.b[pp + free] = 0;
    wd.b[pp + free + 1] = body.length / 2;
    body.forEach((v, k) => { wd.b[pp + free + 2 + k] = v; });
    wd.b[pp + 4 * (pr.length + 1) + 13 * i] = free / 2;
  });
  wd.b[pp + 511] = pr.length;
  // the table stream: Clx, bin tables, styles, fonts, footnotes
  const tb = new Buf();
  const pair = (k: number, fc: number, lcb: number) => { put(fcl + 8 * k, fc); put(fcl + 8 * k + 4, lcb); };
  const clx = tb.length;
  tb.u8(2).u32(4 + 4 + 8).u32(0).u32(all.length).u16(0).u32((TEXT * 2) | 0x40000000).u16(0);
  pair(33, clx, tb.length - clx);
  const bc = tb.length;
  tb.u32(fcOf(0)).u32(fcOf(all.length)).u32(chpPage);
  pair(12, bc, 12);
  const bp = tb.length;
  tb.u32(fcOf(0)).u32(fcOf(all.length)).u32(papPage);
  pair(13, bp, 12);
  // styles: 0 Normal (sti 0), 1 heading 1 (sti 1)
  const st = tb.length;
  tb.u16(18).u16(2).u16(10).at(st + 2 + 18);
  for (const sti of [0, 1]) { tb.u16(10).u16(sti).bytes([0, 0, 0, 0, 0, 0, 0, 0]); }
  pair(1, st, tb.length - st);
  // fonts: Times New Roman, Arial
  const ff = tb.length;
  tb.u16(2).u16(0);
  for (const name of ['Times New Roman', 'Arial']) {
    const data = [...new Array(39).fill(0)];
    for (const ch of name) data.push(ch.charCodeAt(0), 0);
    data.push(0, 0);
    tb.u8(data.length).bytes(data);
  }
  pair(15, ff, tb.length - ff);
  if (notes.length) {
    const fr = tb.length;
    for (const n of notes) tb.u32(n.at);
    tb.u32(main.length);
    for (let i = 0; i < notes.length; i++) tb.u16(1);
    pair(2, fr, tb.length - fr);
    const ft = tb.length;
    let c = 0;
    for (const n of notes) { tb.u32(c); c += n.text.length + 3; }
    tb.u32(c).u32(c + 1);
    pair(3, ft, tb.length - ft);
  }
  return writeCfb([['WordDocument', new Uint8Array(wd.b)], ['1Table', new Uint8Array(tb.b)]]);
}

describe('.doc (Word 97-2003)', () => {
  it('opens the text with its formatting and headings', () => {
    // the footnote mark's place in the text
    const at = 'Results\r'.length + 'The ee was 98% (\x13 HYPERLINK "https://example.org" \x14SI\x15).'.length;
    const fixed = makeDoc([
      { text: 'Results\r', istd: 1, runs: [[0, 7, [...sprm(0x0835, 1), ...sprm(0x4a43, 28, 0)]]] },
      { text: 'The ee was 98% (\x13 HYPERLINK "https://example.org" \x14SI\x15).\x02\r', pap: [...sprm(0x2461, 3)], runs: [[4, 6, sprm(0x0836, 1)], [12, 14, sprm(0x6870, 0xc0, 0, 0, 0)]] },
    ], [{ at, text: 'Freshly made.' }]);
    expect(isDoc(fixed)).toBe(true);
    const { doc } = readDoc(fixed);
    expect(rt.plainText(doc.runs)).toBe('Results\nThe ee was 98% (SI).￼');
    expect(doc.paras[0].style).toBe('Heading1');
    expect(doc.runs[0]).toMatchObject({ bold: true, size: 14, font: 'Times New Roman' });
    expect(doc.runs.find((r) => r.text === 'ee')?.italic).toBe(true);
    expect(doc.runs.find((r) => r.text === 'SI')?.link).toBe('https://example.org');
    expect(doc.paras[1].align).toBe('justify');
    const note = Object.values(doc.objects).find((o) => o.kind === 'note');
    expect(note?.kind === 'note' && rt.plainText(note.runs)).toBe('Freshly made.');
  });

  it('opens tables', () => {
    const inTable = sprm(0x2416, 1);
    const rowEnd = [...sprm(0x2416, 1), ...sprm(0x2417, 1), ...sprm(0xd608, 8, 0, 2, 0, 0, 0x08, 0x07, 0x10, 0x0e)];
    const { doc } = readDoc(makeDoc([
      { text: 'Before\r' },
      { text: 'Entry\x07', pap: inTable }, { text: 'Yield\x07', pap: inTable }, { text: '\x07', pap: rowEnd },
      { text: '1\x07', pap: inTable }, { text: '85%\x07', pap: inTable }, { text: '\x07', pap: rowEnd },
      { text: 'After\r' },
    ]));
    const tb = Object.values(doc.objects).find((o) => o.kind === 'table');
    expect(tb?.kind === 'table' && tb.table.rows.map((r) => r.map((c) => rt.plainText(c.runs)))).toEqual([['Entry', 'Yield'], ['1', '85%']]);
    expect(tb?.kind === 'table' && tb.table.cols).toEqual([90, 90]);
    expect(rt.plainText(doc.runs)).toBe('Before\n￼\nAfter');
  });

  it('says so when a file is not a Word document', () => {
    expect(() => readDoc(writeCfb([['Workbook', new Uint8Array(600)]]))).toThrow(/Word 97-2003/);
  });
});
