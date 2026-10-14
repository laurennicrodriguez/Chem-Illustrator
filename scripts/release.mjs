// Used by the Desktop app workflow (.github/workflows/desktop.yml) to publish each build of main
// as a release that the app's updater can find.
//
//   node scripts/release.mjs prepare <version> <sign: true|false>
//     Puts the version into src-tauri/tauri.conf.json and, when the signing key is there, asks
//     Tauri to sign the installer for the updater.
//   node scripts/release.mjs manifest <version> <notes file> <out dir>
//     Copies the installers into <out dir> with names without spaces, and writes latest.json:
//     the newest version, what changed, and where its signed installer is.

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = 'nathanohare/Chem-Illustrator';
const CONF = 'src-tauri/tauri.conf.json';
const BUNDLE = 'src-tauri/target/release/bundle';

const [cmd, version, ...rest] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error(`Not a version: ${version}`);

if (cmd === 'prepare') {
  const conf = JSON.parse(readFileSync(CONF, 'utf8'));
  conf.version = version;
  conf.bundle.createUpdaterArtifacts = rest[0] === 'true';
  writeFileSync(CONF, JSON.stringify(conf, null, 2) + '\n');
  console.log(`Version ${version}; updater signature ${conf.bundle.createUpdaterArtifacts ? 'on' : 'off'}`);
} else if (cmd === 'manifest') {
  const [notesFile, out] = rest;
  mkdirSync(out, { recursive: true });
  const find = (dir, end) => {
    const f = readdirSync(join(BUNDLE, dir)).find((n) => n.endsWith(end) && n.includes(version));
    if (!f) throw new Error(`No ${end} for ${version} in ${dir}`);
    return join(BUNDLE, dir, f);
  };
  const setup = `Chem-Illustrator_${version}_x64-setup.exe`;
  copyFileSync(find('nsis', '-setup.exe'), join(out, setup));
  copyFileSync(find('msi', '.msi'), join(out, `Chem-Illustrator_${version}_x64.msi`));
  const signature = readFileSync(find('nsis', '-setup.exe.sig'), 'utf8').trim();
  const url = `https://github.com/${REPO}/releases/download/v${version}/${setup}`;
  const latest = {
    version,
    notes: readFileSync(notesFile, 'utf8').trim(),
    pub_date: new Date().toISOString(),
    platforms: {
      'windows-x86_64': { signature, url },
      'windows-x86_64-nsis': { signature, url },
    },
  };
  writeFileSync(join(out, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');
  console.log(`Wrote latest.json for ${version}`);
} else {
  throw new Error(`Unknown command: ${cmd}`);
}
