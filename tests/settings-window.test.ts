import { describe, it, expect } from 'vitest';
import { findPages, type SettingsPage } from '../src/ui/settings-window';

const page = (id: string, title: string, words: string): SettingsPage => ({ id, title, words, open: () => {} });
const pages = [
  page('general', 'General', 'groups linked text reviewer'),
  page('drawing', 'Drawing', 'methyl axial charges'),
  page('style', 'Drawing Style', 'bond length journal'),
  page('online', 'Online', 'pubchem updates'),
];

describe('finding a page in Settings', () => {
  it('lists every page with nothing typed', () => {
    expect(findPages(pages, '  ').map((p) => p.id)).toEqual(['general', 'drawing', 'style', 'online']);
  });

  it('finds pages by their settings, title matches first', () => {
    expect(findPages(pages, 'pubchem').map((p) => p.id)).toEqual(['online']);
    expect(findPages(pages, 'drawing').map((p) => p.id)).toEqual(['drawing', 'style']);
    expect(findPages(pages, 'Bond JOURNAL').map((p) => p.id)).toEqual(['style']);
    expect(findPages(pages, 'axial pubchem')).toEqual([]);
  });
});
