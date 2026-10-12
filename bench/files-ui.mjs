// Checks the File menu in a browser: title, unsaved marker, Save As (as a download), open,
// edit and save again. Usage: node bench/files-ui.mjs [folder with a .cdxml] [output folder]
import { launch } from './browser.mjs';
import fs from 'fs';
import path from 'path';
const dir = process.argv[2] || '';
const out = process.argv[3] || 'test-results';
fs.mkdirSync(out, { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
page.on('dialog', (d) => { logs.push('dialog: ' + d.message()); d.accept(); });
await page.goto(process.env.APP_URL || 'http://localhost:4173/');
await page.waitForFunction(() => window.__app?.chem.ready, null, { timeout: 20000 });
const title = () => page.title();
console.log('start title:', await title());
// draw a benzene ring with the tool
await page.click('[data-tool="ring-benzene"]');
const box = await page.locator('#overlay').boundingBox();
await page.mouse.click(box.x + 300, box.y + 300);
console.log('after drawing:', await title());
// the File menu
await page.click('#btn-file');
await page.screenshot({ path: path.join(out, 'file-menu.png'), clip: { x: 0, y: 0, width: 520, height: 260 } });
// Save As falls back to a download when the browser has no save dialog
await page.evaluate(() => { delete window.showSaveFilePicker; });
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-cmd="save-as"]')]);
const saved = path.join(out, dl.suggestedFilename());
await dl.saveAs(saved);
console.log('downloaded:', dl.suggestedFilename(), fs.statSync(saved).size, 'bytes; title now', await title());
const text = fs.readFileSync(saved, 'utf8');
console.log('starts:', JSON.stringify(text.slice(0, 120)));
const back = await page.evaluate((t) => { const s = window.__app.openText(t, 'x'); return s && { atoms: s.atoms, bonds: s.bonds }; }, text);
console.log('read back:', back);
// a real file: open, move everything, save, read back
const f = dir && fs.readdirSync(dir).find((n) => n.endsWith('.cdxml'));
if (f) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const r = await page.evaluate(async ([t, n]) => {
    const app = window.__app;
    await app.file.openText(t, n);
    const before = { title: document.title, atoms: app.doc.atoms.size };
    app.doc.edit('move', () => app.doc.moveAtoms([...app.doc.atoms.keys()], 10, 0));
    app.editor.changed();
    return { before, after: document.title };
  }, [src, f]);
  console.log('opened real file:', r);
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const p2 = path.join(out, 'edited-' + dl2.suggestedFilename());
  await dl2.saveAs(p2);
  const t2 = fs.readFileSync(p2, 'utf8');
  const cmp = await page.evaluate(([a, b]) => {
    const A = window.__app.openText(a, 'a'); const xa = [...window.__app.doc.atoms.values()].map((q) => q.x).sort((p, q) => p - q);
    const B = window.__app.openText(b, 'b'); const xb = [...window.__app.doc.atoms.values()].map((q) => q.x).sort((p, q) => p - q);
    return { atoms: [A.atoms, B.atoms], shift: +(xb[0] - xa[0]).toFixed(2), sameCount: xa.length === xb.length };
  }, [src, t2]);
  console.log('saved edit, title', await title(), cmp, 'size', src.length, '->', t2.length);
}
console.log(logs.join('\n') || 'no page errors');
await browser.close();
