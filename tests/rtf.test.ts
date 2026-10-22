// @vitest-environment jsdom
//
// RTF files in Document mode: opened (Word's and WordPad's RTF) and saved.

import { describe, it, expect } from 'vitest';
import { newDocument, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import { readRtf, writeRtf, rtfText, isRtf } from '../src/io/rtf';
import * as rt from '../src/richtext';
import type { TextRun } from '../src/model';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const bytes = (s: string) => new TextEncoder().encode(s);

function sample(): DocText {
  const d = newDocument();
  const H = d.styles.Heading1, N = d.styles.Normal;
  const runs: TextRun[] = [
    { ...runStyleOf(H), text: 'Synthesis of 3\n' },
    { ...runStyleOf(N), text: 'To ' },
    { ...runStyleOf(N), formula: true, text: 'CH2Cl2' },
    { ...runStyleOf(N), text: ' (5 mL) at −78 °C was added ' },
    { ...runStyleOf(N), italic: true, text: 'n' },
    { ...runStyleOf(N), text: '-BuLi' },
    { ...runStyleOf(N), color: '#c00000', bold: true, text: ' {care}' },
    { ...runStyleOf(N), obj: 1, text: '￼' },
    { ...runStyleOf(N), text: '\n' },
    { ...runStyleOf(N), obj: 2, text: '￼' },
    { ...runStyleOf(N), text: '\nYield 85% — 1.2 g' },
  ];
  return {
    ...d, runs,
    paras: [paraFromStyle(H, { style: 'Heading1' }), paraFromStyle(N, {}), paraFromStyle(N, {}), { ...paraFromStyle(N, { pageBreak: true }), align: 'center' }],
    objects: {
      1: { kind: 'note', runs: [{ ...runStyleOf(N), text: 'Freshly titrated.' }] },
      2: { kind: 'table', table: { cols: [100, 120], head: 1, lines: 'grid', rows: [[{ runs: [{ text: 'Entry' }] }, { runs: [{ text: 'Yield' }] }], [{ runs: [{ text: '1' }] }, { runs: [{ text: '85%' }] }]] } },
    },
  };
}

describe('RTF', () => {
  it('escapes its special characters and writes others as cp1252 or Unicode', () => {
    expect(rtfText('a{b}\\c')).toBe('a\\{b\\}\\\\c');
    expect(rtfText('é—')).toBe("\\'e9\\'97");
    expect(rtfText('−→')).toBe('\\u8722?\\u8594?');
  });

  it('saves a document and opens it again', async () => {
    const out = await writeRtf(sample());
    expect(isRtf(out)).toBe(true);
    const { doc } = readRtf(out);
    const text = rt.plainText(doc.runs);
    expect(text).toContain('Synthesis of 3');
    expect(text).toContain('CH2Cl2 (5 mL) at −78 °C was added n-BuLi {care}');
    expect(doc.paras[0].style).toBe('Heading1');
    expect(doc.runs.find((r) => r.text === 'n')?.italic).toBe(true);
    expect(doc.runs.find((r) => r.text === '2')?.sub).toBe(true);
    expect(doc.runs.find((r) => r.text.includes('{care}'))).toMatchObject({ bold: true, color: '#c00000' });
    const objs = Object.values(doc.objects);
    const note = objs.find((o) => o.kind === 'note');
    expect(note?.kind === 'note' && rt.plainText(note.runs)).toBe('Freshly titrated.');
    const tb = objs.find((o) => o.kind === 'table');
    expect(tb?.kind === 'table' && tb.table.rows.map((r) => r.map((c) => rt.plainText(c.runs)))).toEqual([['Entry', 'Yield'], ['1', '85%']]);
    expect(tb?.kind === 'table' && tb.table.cols).toEqual([100, 120]);
    expect(doc.paras[doc.paras.length - 1].pageBreak).toBe(true);
    expect(doc.paras[doc.paras.length - 1].align).toBe('center');
    expect(text.endsWith('Yield 85% — 1.2 g')).toBe(true);
  });

  it('keeps pictures and the page', async () => {
    const t = sample();
    t.objects[3] = { kind: 'picture', src: PNG, w: 72, h: 36, px: { w: 1, h: 1 } };
    t.runs = [...t.runs, { text: '\n' }, { obj: 3, text: '￼' }];
    t.page = { ...t.page, w: 595, h: 842, left: 50 };
    const { doc } = readRtf(await writeRtf(t));
    const pic = Object.values(doc.objects).find((o) => o.kind === 'picture');
    expect(pic).toMatchObject({ kind: 'picture', w: 72, h: 36, src: PNG });
    expect(doc.page).toMatchObject({ w: 595, h: 842, left: 50 });
  });

  it('opens RTF as Word and WordPad write it', () => {
    const src = String.raw`{\rtf1\ansi\ansicpg1252\deff0\nouicompat{\fonttbl{\f0\fnil\fcharset0 Calibri;}{\f1\fswiss Arial;}}
{\colortbl ;\red0\green0\blue255;}
{\*\generator Riched20 10.0.19041}\viewkind4\uc1
{\stylesheet{\s0 Normal;}{\s1\outlinelevel0 heading 1;}}
{\info{\author Nate}}
\pard\s1\sa200\sl276\slmult1\b\f1\fs32 Results\b0\par
\pard\sa200\sl276\slmult1\qj\f0\fs22 The \i ee\i0  was 98\'25 by HPLCUNI see \cf1 SI\cf0 .\par
{\*\shppict{\pict\pngblip\picw1\pich1\picwgoal720\pichgoal720 89504e470d0a1a0a}}{\nonshppict{\pict\wmetafile8 0102}}\par
}`.replace('UNI', '\\u8212?');
    const { doc } = readRtf(bytes(src));
    const text = rt.plainText(doc.runs);
    expect(text.startsWith('Results\nThe ee was 98% by HPLC— see SI.')).toBe(true);
    expect(doc.paras[0]).toMatchObject({ style: 'Heading1', spaceAfter: 10, line: 1.15 });
    expect(doc.paras[1].align).toBe('justify');
    expect(doc.runs[0]).toMatchObject({ font: 'Arial', size: 16, bold: true });
    expect(doc.runs.find((r) => r.text === 'SI')?.color).toBe('#0000ff');
    expect(Object.values(doc.objects).filter((o) => o.kind === 'picture')).toHaveLength(1);
  });
});
