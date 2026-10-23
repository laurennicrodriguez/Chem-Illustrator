// Offering newer versions of the desktop app.

import { describe, it, expect } from 'vitest';
import { worthOffering, shortNotes } from '../src/updates';
import { parseSettings } from '../src/settings';

describe('updates', () => {
  it('offers a version unless the user skipped that one', () => {
    expect(worthOffering('0.1.80', null)).toBe(true);
    expect(worthOffering('0.1.80', '0.1.80')).toBe(false);
    expect(worthOffering('v0.1.80', '0.1.80')).toBe(false);
    // skipping one version doesn't hide the next
    expect(worthOffering('0.1.81', '0.1.80')).toBe(true);
  });

  it('shortens long release notes for the notice', () => {
    expect(shortNotes('a\n\nb\nc')).toBe('a\nb\nc');
    expect(shortNotes('1\n2\n3\n4\n5\n6', 4)).toBe('1\n2\n3\n4\n…');
  });

  it('remembers whether to check when the app starts, and a skipped version', () => {
    expect(parseSettings(null).updateCheck).toBe(true);
    expect(parseSettings(null).skipVersion).toBeNull();
    const s = parseSettings(JSON.stringify({ updateCheck: false, skipVersion: '0.1.80' }));
    expect(s.updateCheck).toBe(false);
    expect(s.skipVersion).toBe('0.1.80');
    expect(parseSettings(JSON.stringify({ updateCheck: 'yes', skipVersion: 5 })).updateCheck).toBe(true);
  });

  it('remembers the update channel, Latest unless Stable was chosen', () => {
    expect(parseSettings(null).updateChannel).toBe('latest');
    expect(parseSettings(JSON.stringify({ updateChannel: 'stable' })).updateChannel).toBe('stable');
    expect(parseSettings(JSON.stringify({ updateChannel: 'nightly' })).updateChannel).toBe('latest');
  });
});
