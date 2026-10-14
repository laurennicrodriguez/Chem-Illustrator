// File > Recent: the list of files opened or saved lately.

import { describe, it, expect } from 'vitest';
import { addRecent, removeRecent, recentLabel, RECENT_MAX } from '../src/recent';

describe('recent files', () => {
  it('puts the newest at the top without repeating a file', () => {
    let list = addRecent([], '/a/one.cdxml');
    list = addRecent(list, '/a/two.pptx');
    list = addRecent(list, '/a/one.cdxml');
    expect(list).toEqual(['/a/one.cdxml', '/a/two.pptx']);
  });

  it('treats Windows paths alike whatever their capitals, but not Mac or Linux ones', () => {
    expect(addRecent(['C:\\Work\\Scheme.cdxml'], 'c:\\work\\scheme.CDXML')).toEqual(['c:\\work\\scheme.CDXML']);
    expect(addRecent(['/w/Scheme.cdxml'], '/w/scheme.cdxml')).toEqual(['/w/scheme.cdxml', '/w/Scheme.cdxml']);
    expect(removeRecent(['C:\\A\\x.docx', 'C:\\A\\y.docx'], 'c:\\a\\X.DOCX')).toEqual(['C:\\A\\y.docx']);
  });

  it('keeps only the newest ten', () => {
    let list: string[] = [];
    for (let i = 0; i < 15; i++) list = addRecent(list, `/f/${i}.cdxml`);
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0]).toBe('/f/14.cdxml');
    expect(addRecent(list, '/f/new.cdxml', 3)).toEqual(['/f/new.cdxml', '/f/14.cdxml', '/f/13.cdxml']);
  });

  it('labels each file with its name and a short folder', () => {
    expect(recentLabel('C:\\Users\\n\\OneDrive\\Papers\\Route\\Scheme 1.cdxml')).toEqual({ name: 'Scheme 1.cdxml', folder: '…\\Papers\\Route' });
    expect(recentLabel('C:\\Work\\a.cdxml')).toEqual({ name: 'a.cdxml', folder: 'C:\\Work' });
    expect(recentLabel('/home/n/a.cdxml')).toEqual({ name: 'a.cdxml', folder: '/home/n' });
  });
});
