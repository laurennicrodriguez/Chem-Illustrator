// Search Commands: finding a command by part of its name.

import { describe, it, expect } from 'vitest';
import { matchScore, searchCommands, uniqueCommands } from '../src/ui/command-search';

const items = [
  { id: 'cmd:save', label: 'Save', place: 'File menu' },
  { id: 'cmd:save-as', label: 'Save As…', place: 'File menu' },
  { id: 'cmd:save-workspace-as', label: 'Save Workspace As…', place: 'File menu' },
  { id: 'cmd:clean-up', label: 'Clean Up Structure', place: 'Structure menu' },
  { id: 'cmd:clean-up-reaction', label: 'Clean Up Reaction', place: 'Structure menu', more: 'Tidy a scheme' },
  { id: 'tool:bond-wedge', label: 'Wedge bond', place: 'Drawing tools' },
  { id: 'sh:cell-bold', label: 'Bold', place: 'Home tab' },
];
const labels = (q: string, recent: string[] = []) => searchCommands(items, q, recent).map((i) => i.label);

describe('search commands', () => {
  it('finds commands by the start of any word, shortest name first', () => {
    expect(labels('save')).toEqual(['Save', 'Save As…', 'Save Workspace As…']);
    expect(labels('clean react')).toEqual(['Clean Up Reaction']);
    expect(labels('wedge')).toEqual(['Wedge bond']);
    expect(labels('react')[0]).toBe('Clean Up Reaction');
  });

  it('also looks at where a command lives and its tool tip, after its name', () => {
    expect(labels('tidy')).toEqual(['Clean Up Reaction']);
    expect(labels('drawing')).toEqual(['Wedge bond']);
    expect(labels('structure')).toEqual(['Clean Up Structure', 'Clean Up Reaction']);
  });

  it('finds nothing when a word matches nothing', () => {
    expect(labels('save zebra')).toEqual([]);
    expect(matchScore(items[0], 'xyz')).toBeNull();
  });

  it('with nothing typed lists everything, the ones used lately first', () => {
    expect(labels('', ['sh:cell-bold', 'cmd:clean-up'])).toEqual(['Bold', 'Clean Up Structure', 'Save', 'Save As…', 'Save Workspace As…', 'Clean Up Reaction', 'Wedge bond']);
  });

  it('lists a command once when it is in a menu and on the ribbon', () => {
    expect(uniqueCommands([{ id: 'cmd:a', n: 1 }, { id: 'cmd:b', n: 2 }, { id: 'cmd:a', n: 3 }])).toEqual([{ id: 'cmd:a', n: 1 }, { id: 'cmd:b', n: 2 }]);
  });
});
