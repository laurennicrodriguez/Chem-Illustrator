// The Slides ribbon's Font and Paragraph buttons (round 3, item 7): on the whole of a picked text
// box, and on the selection while typing.

import { describe, it, expect } from 'vitest';
import { applyFormat, formatWhole, stepSize } from '../src/text/format';
import { TextEditing } from '../src/text/editing';
import { plainText } from '../src/richtext';

const measure = (s: string) => s.length * 6;

describe('font size steps', () => {
  it('goes up and down PowerPoint\'s steps', () => {
    expect(stepSize(18, 1)).toBe(20);
    expect(stepSize(18, -1)).toBe(16);
    expect(stepSize(19, 1)).toBe(20);
    expect(stepSize(19, -1)).toBe(18);
    expect(stepSize(96, 1)).toBe(106);
    expect(stepSize(8, -1)).toBe(7);
  });
});

describe('formatting a whole text box', () => {
  const box = { runs: [{ text: 'Big ', size: 24 }, { text: 'small', size: 12 }], justify: 'left' as const };

  it('makes all of it bold, then takes bold off again', () => {
    const once = formatWhole(box, { kind: 'toggle', key: 'bold' }, {}, 18, measure);
    expect(once.runs.every((r) => r.bold)).toBe(true);
    expect(plainText(once.runs)).toBe('Big small');
    const twice = formatWhole(once, { kind: 'toggle', key: 'bold' }, {}, 18, measure);
    expect(twice.runs.some((r) => r.bold)).toBe(false);
  });

  it('steps each size on its own', () => {
    const r = formatWhole(box, { kind: 'grow', by: 1 }, {}, 18, measure);
    expect(r.runs.map((x) => x.size)).toEqual([28, 14]);
  });

  it('sets a font and colour on every run', () => {
    const r = formatWhole(box, { kind: 'style', patch: { font: 'Arial', color: '#ff0000' } }, {}, 18, measure);
    expect(r.runs.every((x) => x.font === 'Arial' && x.color === '#ff0000')).toBe(true);
  });

  it('lines up, lists and spaces the paragraphs', () => {
    const two = { runs: [{ text: 'one\ntwo' }], justify: 'left' as const };
    expect(formatWhole(two, { kind: 'align', j: 'center' }, {}, 18, measure).justify).toBe('center');
    expect(formatWhole(two, { kind: 'list', list: 'bullet' }, {}, 18, measure).paras?.every((p) => p.list === 'bullet')).toBe(true);
    expect(formatWhole(two, { kind: 'line', v: 1.5 }, {}, 18, measure).lineSpacing).toBe(1.5);
  });
});

describe('formatting while typing', () => {
  it('changes only the selected words', () => {
    const ed = new TextEditing({ runs: [{ text: 'Hello world' }] }, {}, measure, 18);
    ed.select(6, 11);
    applyFormat(ed, { kind: 'toggle', key: 'italic' });
    expect(ed.t.runs.map((r) => [r.text, !!r.italic])).toEqual([['Hello ', false], ['world', true]]);
  });
});
