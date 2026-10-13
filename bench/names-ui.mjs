// Checks Name to Structure in a real browser: the window, a name that works, one that doesn't,
// converting selected captions (and Undo), and what OPSIN's extras (attachment points, racemic
// and polymer names) turn into. Run with the preview server going:
//   node bench/names-ui.mjs [output folder]
import { launch } from './browser.mjs';
import fs from 'fs';
const out = process.argv[2] || 'test-results';
fs.mkdirSync(out, { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'log') logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 6).join('\n')));
const url = process.env.APP_URL || 'http://localhost:4173/';
await page.goto(url);
await page.waitForFunction(() => window.__app?.chem.ready, null, { timeout: 20000 });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); };
const clear = () => page.evaluate(() => { const A = window.__app; A.doc.loadFrom(new A.Doc()); A.editor.clearSelection(); });
const counts = () => page.evaluate(() => ({ atoms: window.__app.doc.atoms.size, bonds: window.__app.doc.bonds.size, captions: window.__app.doc.captions.size }));
const labels = () => page.evaluate(() => [...window.__app.doc.atoms.values()].filter((a) => !a.attach).map((a) => a.label ?? (a.z === 6 ? '' : a.z)).filter((x) => x !== ''));
const wedges = () => page.evaluate(() => [...window.__app.doc.bonds.values()].filter((b) => b.display !== 'solid').map((b) => b.display));
const attachments = () => page.evaluate(() => [...window.__app.doc.atoms.values()].filter((a) => a.attach).map((a) => a.attach));

await clear();
// the menu item and its key
await page.click('#btn-structure');
const kbd = await page.locator('[data-cmd="name-to-structure"] kbd').textContent().catch(() => '');
check('Structure menu has Name to Structure with Ctrl+Shift+N', kbd === 'Ctrl+Shift+N', kbd);
await page.click('[data-cmd="name-to-structure"]');
await page.waitForSelector('dialog.name-dialog[open]');
check('the window opens', true);
await page.fill('.name-input', 'benzene');
let t0 = Date.now();
await page.keyboard.press('Enter');
await page.waitForSelector('dialog.name-dialog', { state: 'detached', timeout: 30000 });
const firstMs = Date.now() - t0;
let c = await counts();
check('benzene gives 6 atoms and 6 bonds', c.atoms === 6 && c.bonds === 6, JSON.stringify(c) + `, first name took ${firstMs} ms`);
await page.screenshot({ path: `${out}/names-benzene.png` });

// a name that can't be read keeps the window open with the reason
await page.keyboard.press('Control+Shift+N');
await page.waitForSelector('dialog.name-dialog[open]');
check('the window remembers the last name', (await page.inputValue('.name-input')) === 'benzene');
await page.fill('.name-input', '2-methyl-1-ol');
await page.click('dialog.name-dialog button.primary');
await page.waitForSelector('.name-status.error', { timeout: 10000 });
const why = await page.textContent('.name-status');
check('an unreadable name shows why and stays open', /uninterpretable|1-ol/.test(why) && await page.isVisible('dialog.name-dialog[open]'), why);
await page.screenshot({ path: `${out}/names-error.png` });
// fix it in place
t0 = Date.now();
await page.fill('.name-input', '(2R)-butan-2-ol');
await page.click('dialog.name-dialog button.primary');
await page.waitForSelector('dialog.name-dialog', { state: 'detached', timeout: 10000 });
c = await counts();
const w = await wedges();
check('(2R)-butan-2-ol is added (5 more atoms) with a wedge', c.atoms === 11 && w.length === 1, JSON.stringify(c) + ' ' + JSON.stringify(w) + ` in ${Date.now() - t0} ms`);
check('the new structure is selected', (await page.evaluate(() => window.__app.editor.sel.atoms.size)) === 5);

// a caption holding a name is replaced by the structure; Undo brings it back
await clear();
await page.evaluate(() => {
  const A = window.__app;
  A.doc.edit('caption', () => {
    A.doc.addCaption({ x: 100, y: 100, runs: [{ text: 'ethyl 2-oxo-2H-chromene-\n3-carboxylate' }], justify: 'left' });
    A.doc.addCaption({ x: 100, y: 300, runs: [{ text: 'Scheme 1' }], justify: 'left' });
  });
  A.editor.sel.captions = new Set([...A.doc.captions.keys()]);
  A.editor.changed();
});
await page.keyboard.press('Control+Shift+N');
await page.waitForFunction(() => window.__app.doc.atoms.size > 0, null, { timeout: 10000 });
c = await counts();
check('a selected caption becomes its structure (16 atoms), the non-name caption stays', c.atoms === 16 && c.captions === 1, JSON.stringify(c));
const flashText = await page.textContent('#flash');
check('the caption that was not a name is reported', /Not read as a name.*"Scheme 1"/.test(flashText), flashText);
await page.screenshot({ path: `${out}/names-caption.png` });
await page.evaluate(() => window.__app.doc.undo());
c = await counts();
check('Undo puts the caption back', c.atoms === 0 && c.captions === 2, JSON.stringify(c));

// OPSIN's extras
for (const [name, want] of [
  ['4-methoxyphenyl', (l, at) => l.length === 1 && l[0] === 8 && at.length === 1 && at[0] === 'Wavy'],
  ['rac-(2R,3S)-2,3-dibromobutane', (l) => l.filter((x) => x === 35).length === 2],
  ['caffeine', (l) => l.length > 0],
  ['tert-butyldimethylsilyl chloride', (l) => l.includes(14) && l.includes(17)],
  ['sodium acetate', (l) => l.includes(11)],
]) {
  await clear();
  await page.keyboard.press('Control+Shift+N');
  await page.waitForSelector('dialog.name-dialog[open]');
  await page.fill('.name-input', name);
  await page.click('dialog.name-dialog button.primary');
  await page.waitForFunction(() => !document.querySelector('dialog.name-dialog') || document.querySelector('.name-status.error'), null, { timeout: 10000 });
  const err = await page.$('.name-status.error') ? await page.textContent('.name-status') : '';
  if (err) await page.click('dialog.name-dialog button:not(.primary)');
  const l = await labels();
  const at = await attachments();
  check(`${name} is drawn`, !err && want(l, at), err || JSON.stringify(l) + ' ' + JSON.stringify(at) + ' ' + JSON.stringify(await counts()));
  await page.screenshot({ path: `${out}/names-${name.replace(/[^a-z0-9]+/gi, '_')}.png` });
}

console.log(logs.length ? 'Browser messages:\n' + logs.join('\n') : 'No browser errors.');
await browser.close();
process.exit(results.every((r) => r.ok) && !logs.some((l) => l.startsWith('PAGEERROR')) ? 0 : 1);
