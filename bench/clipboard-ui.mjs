// Checks cut, copy and paste and the Edit menu in a browser (the Windows app uses its own
// clipboard commands instead, which this cannot reach). Usage: node bench/clipboard-ui.mjs [output folder]
import { launch } from './browser.mjs';
import fs from 'fs';
import path from 'path';
const out = process.argv[2] || 'test-results';
fs.mkdirSync(out, { recursive: true });
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 860 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: process.env.APP_URL || 'http://localhost:4173' });
const page = await context.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
await page.goto(process.env.APP_URL || 'http://localhost:4173/');
await page.waitForFunction(() => window.__app?.chem.ready, null, { timeout: 20000 });
const count = () => page.evaluate(() => ({ atoms: window.__app.doc.atoms.size, bonds: window.__app.doc.bonds.size, selected: window.__app.editor.sel.atoms.size }));
const flash = () => page.evaluate(() => document.querySelector('#flash').textContent);
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);

// draw a benzene ring with an OMe
await page.click('[data-tool="ring-benzene"]');
const box = await page.locator('#overlay').boundingBox();
await page.mouse.click(box.x + 300, box.y + 300);
await page.evaluate(() => {
  const { doc, editor } = window.__app;
  const a = [...doc.atoms.values()][0];
  doc.edit('OMe', () => doc.addBond(a.id, doc.addAtom(a.x + 14.4, a.y, 6, { label: 'OMe' }).id));
  editor.changed();
});
await page.click('[data-tool="select"]');
check('drew anisole', (await count()).atoms === 7);

// Ctrl+C with nothing selected copies the whole drawing as a PNG
await page.keyboard.press('Control+c');
await page.waitForFunction(() => /Copied/.test(document.querySelector('#flash').textContent));
const clip = await page.evaluate(async () => {
  const items = await navigator.clipboard.read();
  const t = items[0].types;
  const png = t.includes('image/png') ? await items[0].getType('image/png') : null;
  const bmp = png && (await createImageBitmap(png));
  return { types: t, bytes: png?.size, w: bmp?.width, h: bmp?.height };
});
check('copy puts a picture on the clipboard', clip.types.includes('image/png'), `${await flash()} | ${JSON.stringify(clip)}`);

// Ctrl+V pastes a copy, selected, in the middle of the window
await page.keyboard.press('Control+v');
await page.waitForTimeout(200);
let c = await count();
check('paste adds a second copy', c.atoms === 14 && c.bonds === 14 && c.selected === 7, JSON.stringify(c));

// Ctrl+X cuts the pasted copy
await page.keyboard.press('Control+x');
await page.waitForTimeout(200);
c = await count();
check('cut removes the selection', c.atoms === 7 && c.selected === 0, `${JSON.stringify(c)} | ${await flash()}`);
await page.keyboard.press('Control+v');
await page.waitForTimeout(200);
check('paste after cut brings it back', (await count()).atoms === 14);
await page.keyboard.press('Control+z');
await page.waitForTimeout(100);
check('undo removes the paste in one step', (await count()).atoms === 7);

// Ctrl+Alt+C still copies SMILES
await page.keyboard.press('Control+a');
await page.keyboard.press('Control+Alt+c');
await page.waitForFunction(() => /SMILES/.test(document.querySelector('#flash').textContent));
const smiles = await page.evaluate(() => navigator.clipboard.readText());
check('Ctrl+Alt+C copies SMILES', /^COc1ccccc1$|^c1ccc\(OC\)cc1$/.test(smiles), smiles);

// a SMILES string from another program pastes as a structure
await page.evaluate(() => navigator.clipboard.writeText('CCO'));
await page.keyboard.press('Escape');
await page.keyboard.press('Control+v');
await page.waitForTimeout(500);
check('pasting SMILES text draws it', (await count()).atoms === 10, JSON.stringify(await count()));

// the Edit menu, and moving between menus with the arrow keys
await page.click('#btn-edit');
await page.screenshot({ path: path.join(out, 'edit-menu.png'), clip: { x: 0, y: 0, width: 560, height: 330 } });
const shown = await page.evaluate(() => [...document.querySelectorAll('#edit-menu button')].filter((b) => b.offsetParent).map((b) => b.dataset.cmd));
check('Edit menu items', shown.join(',') === 'undo,redo,cut,copy,paste,copy-smiles,select-all', shown.join(','));
await page.keyboard.press('ArrowLeft');
check('left arrow opens the File menu', await page.evaluate(() => !document.querySelector('#file-menu').hidden && document.querySelector('#edit-menu').hidden));
await page.keyboard.press('Escape');
// the Copy menu item works too
await page.click('#btn-edit');
await page.click('[data-cmd="select-all"]');
await page.click('#btn-edit');
await page.click('[data-cmd="copy"]');
await page.waitForFunction(() => /^Copied as/.test(document.querySelector('#flash').textContent));
await page.click('#btn-edit');
await page.click('[data-cmd="paste"]');
await page.waitForTimeout(300);
check('Edit menu copy and paste', (await count()).atoms === 20, JSON.stringify(await count()));
await page.screenshot({ path: path.join(out, 'after-paste.png') });
console.log(logs.join('\n') || 'no page errors');
await browser.close();
