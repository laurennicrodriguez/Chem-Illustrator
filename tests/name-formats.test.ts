import { describe, it, expect } from 'vitest';
import { nameFormats } from '../src/text/chemtext';

// what the rules would change, as the text it covers and how, with `typed` the key just pressed
const run = (before: string, typed: string, opts = { stereo: true, numbers: true }) => {
  const text = before + typed;
  return nameFormats(text, before.length, opts).map((e) => `${text.slice(e.start, e.end)}:${e.bold ? 'b' : ''}${e.italic ? 'i' : ''}`);
};

describe('stereodescriptors in italics', () => {
  it('italicises the letters as the name goes on', () => {
    expect(run('then (S)', '-')).toEqual(['S:i']);
    expect(run('(R,R)', '-')).toEqual(['R:i', 'R:i']);
    expect(run('a (2E,4Z)', '-')).toEqual(['E:i', 'Z:i']);
    expect(run('(1R*,2S*)', '-')).toEqual(['R:i', 'S:i']);
  });
  it('leaves other brackets alone', () => {
    expect(run('compound(s)', '-')).toEqual([]);
    expect(run('then (S)', ' ')).toEqual([]);
    expect(run('(X)', '-')).toEqual([]);
    expect(run('(S)', '-', { stereo: false, numbers: true })).toEqual([]);
  });
});

describe('compound numbers in bold', () => {
  it('bolds a number in brackets or after "compound"', () => {
    expect(run('the ketone (4', ')')).toEqual(['4:b']);
    expect(run('the ketones (4a,b', ')')).toEqual(['4a,b:b']);
    expect(run('(12b', ')')).toEqual(['12b:b']);
    expect(run('then compound 4a', ' ')).toEqual(['4a:b']);
    expect(run('Compounds 7', ',')).toEqual(['7:b']);
  });
  it('leaves years, amounts and function calls alone', () => {
    expect(run('Smith (2019', ')')).toEqual([]);
    expect(run('(5 mol%', ')')).toEqual([]);
    expect(run('f(2', ')')).toEqual([]);
    expect(run('ketone (4', ')', { stereo: true, numbers: false })).toEqual([]);
  });
});
