// Time the real desktop app: build it with bench/desktop/run-in-app.js added, start it, read the results.
//   node bench/desktop.mjs build      (once per version: npm run build, then the app without installers)
//   node bench/desktop.mjs run [n]    (starts the app n times; on Linux without a screen, run under xvfb-run)
// Works on any version of the app, since it only needs window.__app.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, spawn } from 'child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const [cmd = 'run', count = '3'] = process.argv.slice(2);
const out = path.join(os.tmpdir(), 'chem-illustrator-bench.json');
const exe = path.join(process.env.CARGO_TARGET_DIR ?? path.join(root, 'src-tauri', 'target'), 'release', process.platform === 'win32' ? 'chem-illustrator.exe' : 'chem-illustrator');

if (cmd === 'build') {
  execSync('npm run build', { cwd: root, stdio: 'inherit' });
  const js = fs.readFileSync(path.join(root, 'bench', 'desktop', 'run-in-app.js'), 'utf8')
    .replace('__OUT__', out.replace(/\\/g, '\\\\')).replace('__N__', process.env.N || '2000');
  fs.writeFileSync(path.join(root, 'dist', 'bench-run.js'), js);
  const html = path.join(root, 'dist', 'index.html');
  fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace('</body>', '<script src="./bench-run.js"></script></body>'));
  // (the web part is built already, with the timing script in it)
  const conf = path.join(os.tmpdir(), 'chem-illustrator-bench-tauri.json');
  fs.writeFileSync(conf, JSON.stringify({ build: { beforeBuildCommand: '' } }));
  execSync(`npx tauri build --no-bundle --config "${conf}"`, { cwd: root, stdio: 'inherit' });
} else {
  const runs = [];
  for (let i = 0; i < Number(count); i++) {
    fs.rmSync(out, { force: true });
    const t0 = Date.now();
    const p = spawn(exe, [], { stdio: 'ignore' });
    const deadline = t0 + 180000;
    while (!fs.existsSync(out) && Date.now() < deadline) await new Promise((ok) => setTimeout(ok, 100));
    await new Promise((ok) => setTimeout(ok, 300));
    p.kill();
    if (!fs.existsSync(out)) { console.log('no results (timed out)'); continue; }
    const r = JSON.parse(fs.readFileSync(out, 'utf8'));
    r.launchToAppUpMs = r.appUpEpoch - t0;
    delete r.appUpEpoch;
    runs.push(r);
    console.log(JSON.stringify(r));
    await new Promise((ok) => setTimeout(ok, 1000));
  }
}
