// The release script: which file each platform's updater downloads.

import { describe, it, expect } from 'vitest';
// @ts-expect-error a plain JavaScript script
import { manifest, installers } from '../scripts/release.mjs';

describe('releases', () => {
  it('names every platform the updater asks for, with its signed installer', () => {
    const all = installers('0.1.90');
    const sigs = {
      [all.windows.files[0].as]: 'WIN',
      [all.macos.files[1].as]: 'MAC',
      [all.linux.files[0].as]: 'LINUX',
    };
    const m = manifest('0.1.90', ' Presenter view \n', sigs, new Date('2026-10-14T20:00:00Z'));
    expect(m.notes).toBe('Presenter view');
    expect(m.pub_date).toBe('2026-10-14T20:00:00.000Z');
    expect(m.platforms['windows-x86_64']).toEqual({ signature: 'WIN', url: 'https://github.com/nathanohare/Chem-Illustrator/releases/download/v0.1.90/Chem-Illustrator_0.1.90_x64-setup.exe' });
    expect(m.platforms['darwin-aarch64'].url).toMatch(/Chem-Illustrator_0\.1\.90_universal\.app\.tar\.gz$/);
    expect(m.platforms['darwin-x86_64'].signature).toBe('MAC');
    expect(m.platforms['linux-x86_64'].url).toMatch(/Chem-Illustrator_0\.1\.90_amd64\.AppImage$/);
  });

  it('lists only the platforms that were built', () => {
    const all = installers('0.1.91');
    const m = manifest('0.1.91', '', { [all.windows.files[0].as]: 'WIN' });
    expect(Object.keys(m.platforms)).toEqual(['windows-x86_64', 'windows-x86_64-nsis']);
  });
});
