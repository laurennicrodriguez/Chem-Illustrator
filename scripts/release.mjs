// Used by the Desktop app workflow (.github/workflows/desktop.yml) to publish each build of main
// as a release that the app's updater can find, with installers for Windows, macOS and Linux.
//
//   node scripts/release.mjs prepare <version> <sign: true|false>
//     Puts the version into src-tauri/tauri.conf.json and, when the signing key is there, asks
//     Tauri to sign the installers for the updater.
//   node scripts/release.mjs collect <version> <platform: windows|macos|linux> <out dir>
//     After a build: copies that platform's installers (and the updater's signatures) into
//     <out dir> with names without spaces, and on Windows makes the portable zip.
//   node scripts/release.mjs manifest <version> <notes file> <dir>
//     Once every platform is built and collected into <dir>: writes latest.json there, the
//     newest version, what changed, and where each platform's signed installer is.

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = 'nathanohare/Chem-Illustrator';
const CONF = 'src-tauri/tauri.conf.json';

/** What each platform's build leaves, and the plain name it is published under. */
export function installers(version) {
  return {
    windows: {
      bundle: 'src-tauri/target/release/bundle',
      files: [
        { dir: 'nsis', end: '-setup.exe', as: `Chem-Illustrator_${version}_x64-setup.exe`, signed: true },
        { dir: 'msi', end: '.msi', as: `Chem-Illustrator_${version}_x64.msi` },
      ],
      // the app on its own, for portable copies: the zip to download (the app and its
      // "Chem Illustrator Data" folder), and the bare app that portable copies update from
      portable: {
        exe: 'src-tauri/target/release/chem-illustrator.exe',
        zip: `Chem-Illustrator_${version}_x64-portable.zip`,
        update: `Chem-Illustrator_${version}_x64-portable.exe`,
      },
    },
    macos: {
      // one app for both Apple silicon and Intel Macs
      bundle: 'src-tauri/target/universal-apple-darwin/release/bundle',
      files: [
        { dir: 'dmg', end: '.dmg', as: `Chem-Illustrator_${version}_universal.dmg` },
        // made only when the updater's signing key is there
        { dir: 'macos', end: '.app.tar.gz', as: `Chem-Illustrator_${version}_universal.app.tar.gz`, signed: true, anyVersion: true, updaterOnly: true },
      ],
    },
    linux: {
      bundle: 'src-tauri/target/release/bundle',
      files: [
        { dir: 'appimage', end: '.AppImage', as: `Chem-Illustrator_${version}_amd64.AppImage`, signed: true },
        { dir: 'deb', end: '.deb', as: `Chem-Illustrator_${version}_amd64.deb` },
        { dir: 'rpm', end: '.rpm', as: `Chem-Illustrator-${version}.x86_64.rpm` },
      ],
    },
  };
}

/** What the portable zip holds: the app, and the folder that makes it keep its settings beside it. */
export async function portableZip(exe) {
  // loaded here, not at the top: the publish job runs this script without installing packages
  const { zipSync, strToU8 } = await import('fflate');
  return zipSync({
    'Chem Illustrator/Chem Illustrator.exe': [exe, { level: 6 }],
    'Chem Illustrator/Chem Illustrator Data/About this folder.txt': strToU8(PORTABLE_NOTE.replace(/\n/g, '\r\n')),
  });
}

const PORTABLE_NOTE = `This folder makes Chem Illustrator a portable copy. While it sits next to
Chem Illustrator.exe, the app keeps your settings (hotkeys, preferences, styles, templates,
recent files) here instead of on the computer, so you can run it from a flash drive or any
folder without installing it.

Keep this folder and the app together. Copy both to move your copy, settings and all.
Delete this folder and the app keeps its settings on the computer, as an installed copy does.

Help > Check for Updates replaces Chem Illustrator.exe with the newer version in place.

Windows needs the Microsoft Edge WebView2 Runtime, which Windows 10 and 11 already have.
`;

/** latest.json: for each of the updater's platform names, the signed installer it downloads. */
export function manifest(version, notes, signatures, date = new Date()) {
  const url = (name) => `https://github.com/${REPO}/releases/download/v${version}/${name}`;
  const all = installers(version);
  const platforms = {};
  const add = (keys, file) => {
    const sig = signatures[file];
    if (sig) for (const k of keys) platforms[k] = { signature: sig, url: url(file) };
  };
  add(['windows-x86_64', 'windows-x86_64-nsis'], all.windows.files[0].as);
  add(['windows-x86_64-portable'], all.windows.portable.update);
  add(['darwin-aarch64', 'darwin-x86_64', 'darwin-aarch64-app', 'darwin-x86_64-app'], all.macos.files[1].as);
  add(['linux-x86_64', 'linux-x86_64-appimage'], all.linux.files[0].as);
  return { version, notes: notes.trim(), pub_date: date.toISOString(), platforms };
}

const [cmd, version, ...rest] = process.argv.slice(2);
const run = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (run && !/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error(`Not a version: ${version}`);

if (!run) {
  // imported (by the tests): nothing to do
} else if (cmd === 'prepare') {
  const conf = JSON.parse(readFileSync(CONF, 'utf8'));
  conf.version = version;
  conf.bundle.createUpdaterArtifacts = rest[0] === 'true';
  writeFileSync(CONF, JSON.stringify(conf, null, 2) + '\n');
  console.log(`Version ${version}; updater signature ${conf.bundle.createUpdaterArtifacts ? 'on' : 'off'}`);
} else if (cmd === 'collect') {
  const [platform, out] = rest;
  const p = installers(version)[platform];
  if (!p) throw new Error(`Unknown platform: ${platform}`);
  mkdirSync(out, { recursive: true });
  for (const f of p.files) {
    const dir = join(p.bundle, f.dir);
    // the macOS update archive is named after the app, not the version
    const name = existsSync(dir) && readdirSync(dir).find((n) => n.endsWith(f.end) && (f.anyVersion || n.includes(version)));
    if (!name && f.updaterOnly) continue;
    if (!name) throw new Error(`No ${f.end} for ${version} in ${dir}`);
    copyFileSync(join(dir, name), join(out, f.as));
    if (existsSync(join(dir, name + '.sig'))) copyFileSync(join(dir, name + '.sig'), join(out, f.as + '.sig'));
    console.log(`${name} → ${f.as}`);
  }
  if (p.portable) {
    const exe = readFileSync(p.portable.exe);
    writeFileSync(join(out, p.portable.zip), await portableZip(exe));
    copyFileSync(p.portable.exe, join(out, p.portable.update));
    if (existsSync(p.portable.exe + '.sig')) copyFileSync(p.portable.exe + '.sig', join(out, p.portable.update + '.sig'));
    console.log(`${p.portable.exe} → ${p.portable.zip}, ${p.portable.update}`);
  }
} else if (cmd === 'manifest') {
  const [notesFile, dir] = rest;
  const signatures = {};
  for (const n of readdirSync(dir)) if (n.endsWith('.sig')) signatures[n.slice(0, -4)] = readFileSync(join(dir, n), 'utf8').trim();
  const latest = manifest(version, readFileSync(notesFile, 'utf8'), signatures);
  if (!Object.keys(latest.platforms).length) throw new Error('No signed installers to list');
  writeFileSync(join(dir, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');
  console.log(`Wrote latest.json for ${version}: ${Object.keys(latest.platforms).join(', ')}`);
} else {
  throw new Error(`Unknown command: ${cmd}`);
}
