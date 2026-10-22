// Edit > Export Settings and Import Settings: every setting in one file, to set up another computer.

import { describe, expect, it } from 'vitest';
import { exportText, importSettings, parseSettings } from '../src/settings';
import { withNewBox, withItems } from '../src/ui/toolboxes';

describe('exporting and importing settings', () => {
  const mine = () => {
    const s = parseSettings(null);
    s.hotkeys = { space: { 'ctrl+k': 'command clean-up' } };
    s.methylStyle = 'CH3';
    s.nicknames = { Tf: 'S(=O)(=O)C(F)(F)F' };
    s.toolboxes = withItems(withNewBox(s.toolboxes, 'Lab set', { x: 10, y: 20 }, 'own-lab').state, 'own-lab', ['cmd:clean-up', 'sep', 'tool:chain']);
    s.recentFiles = ['C:/Users/me/a.cdxml'];
    s.fileTypesOffered = true;
    return s;
  };

  it('writes every setting but those that belong to this computer', () => {
    const out = JSON.parse(exportText(mine(), new Date('2026-10-22T12:00:00Z')));
    expect(out).toMatchObject({ app: 'Chem Illustrator', kind: 'settings', version: 1, exported: '2026-10-22', methylStyle: 'CH3' });
    expect(out.toolboxes.own).toEqual([{ id: 'own-lab', title: 'Lab set' }]);
    expect(out).not.toHaveProperty('recentFiles');
    expect(out).not.toHaveProperty('fileTypesOffered');
  });

  it('reads them back on another computer, keeping that one\'s recent files', () => {
    const there = parseSettings(null);
    there.recentFiles = ['/home/lab/b.cdxml'];
    const got = importSettings(exportText(mine()), there)!;
    expect(got.only).toBeUndefined();
    expect(got.settings.methylStyle).toBe('CH3');
    expect(got.settings.nicknames).toEqual({ Tf: 'S(=O)(=O)C(F)(F)F' });
    expect(got.settings.hotkeys).toEqual({ space: { 'ctrl+k': 'command clean-up' } });
    expect(got.settings.toolboxes.items?.['own-lab']).toEqual(['cmd:clean-up', 'sep', 'tool:chain']);
    expect(got.settings.recentFiles).toEqual(['/home/lab/b.cdxml']);
    expect(got.settings.fileTypesOffered).toBe(false);
  });

  it('keeps what a file leaves out as it is', () => {
    const now = parseSettings(null);
    now.axialStyle = 'PM';
    const got = importSettings(JSON.stringify({ app: 'Chem Illustrator', kind: 'settings', version: 1, methylStyle: 'CH3' }), now)!;
    expect(got.settings.axialStyle).toBe('PM');
    expect(got.settings.methylStyle).toBe('CH3');
  });

  it('takes only the keys from a hotkeys file, and refuses other files', () => {
    const now = parseSettings(null);
    now.methylStyle = 'CH3';
    const got = importSettings(JSON.stringify({ app: 'Chem Illustrator', kind: 'hotkeys', version: 1, hotkeys: { space: { x: null } } }), now)!;
    expect(got.only).toBe('hotkeys');
    expect(got.settings.hotkeys).toEqual({ space: { x: null } });
    expect(got.settings.methylStyle).toBe('CH3');
    expect(importSettings('not json', now)).toBeNull();
    expect(importSettings(JSON.stringify({ app: 'Something else' }), now)).toBeNull();
    expect(importSettings(JSON.stringify([1, 2]), now)).toBeNull();
  });
});
