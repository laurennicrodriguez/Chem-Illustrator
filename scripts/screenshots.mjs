// Takes the still pictures in docs/images/ for the README and the user guide.
// Start the program first (npm run dev), then: node scripts/screenshots.mjs [address]
// Needs Playwright with Chromium (npm install --no-save playwright; npx playwright install chromium),
// or set CHROMIUM to a Chromium program to use instead. scripts/animations.mjs makes the GIFs.

import { open, shot, pointer, glide, look, addSmiles, atomAt, canvasBox, tool, drawScheme, select, fitOnSlide, contentClip } from './shot-lib.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';

// ---------------------------------------------------------------- the drawing, light and dark
{
  const { browser, page, problems } = await open(url);
  // the product selected, so the Analysis panel shows its formula and masses
  await drawScheme(page, { select: true });
  await shot(page, 'drawing');

  // the same page dark (screen only)
  await page.evaluate(() => window.__app.command('dark-page'));
  await shot(page, 'dark-page');
  await page.evaluate(() => window.__app.command('dark-page'));

  // Slides: a title slide and a slide with the scheme, in one of the design templates
  await page.evaluate(async () => {
    const a = window.__app; a.ws.newSlides();
    const t = await import('/src/deck/templates.ts');
    const d = a.ws.active.deck; d.setMaster(t.applyTemplate(d.master, t.SLIDE_TEMPLATES.find((x) => x.id === 'harbor')));
  });
  await page.waitForTimeout(600);
  const phs = async () => page.evaluate(() => { const a = window.__app; return [...a.doc.captions.values()].filter(c => c.ph).map(c => { const b = a.renderer.captionBox(c); const s = a.renderer.toScreen({ x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 }); const r = document.querySelector('#overlay').getBoundingClientRect(); return [s.x + r.left, s.y + r.top]; }); });
  let p = await phs();
  await page.mouse.click(...p[0]); await page.keyboard.type('Asymmetric Hydrogenation of Profens'); await page.keyboard.press('Escape');
  await page.mouse.click(...p[1]); await page.keyboard.type('Group meeting, 16 October'); await page.keyboard.press('Escape');
  await page.evaluate(() => window.__app.command('new-slide')); await page.waitForTimeout(600);
  p = await phs();
  await page.mouse.click(...p[0]); await page.keyboard.type('Route to the enoate'); await page.keyboard.press('Escape');
  await page.mouse.click(...p[1]); await page.keyboard.type('Suzuki coupling, then Horner-Wadsworth-Emmons olefination'); await page.keyboard.press('Enter'); await page.keyboard.type('Both steps run on a 10 g scale'); await page.keyboard.press('Escape');
  // the side panel folded away, so the slide has the room
  await page.evaluate(() => window.__app.command('fold-side'));
  await page.waitForTimeout(400);
  await drawScheme(page, { xs: [150, 420, 740], y: 360, fit: false });
  await fitOnSlide(page);
  // the mouse resting on an atom with a drawing tool picked: the structures are real ones,
  // edited right on the slide with the same tools and hotkeys
  await pointer(page);
  await tool(page, 'bond-single', false);
  const ids = await page.evaluate(() => [...window.__app.doc.atoms.keys()]);
  // the product's C=C (the 7th and 8th of its 19 atoms): pointing at a bond lights it up
  const p1 = await atomAt(page, ids[ids.length - 19 + 6]), p2 = await atomAt(page, ids[ids.length - 19 + 7]);
  const on = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  await page.mouse.move(on.x + 60, on.y + 80);
  await glide(page, on.x, on.y, 8);
  await page.waitForTimeout(400);
  await shot(page, 'slides', { mouseAway: false });
  await pointer(page, false);

  // Sheet: a table of products with structures, worked-out formula and MW, and a chart
  await page.evaluate(() => window.__app.ws.newSheet());
  await page.waitForTimeout(800);
  const rows = [['Entry', 'Product', 'Yield (%)', 'ee (%)'], ['1', 'CC(C)Cc1ccc(cc1)[C@@H](C)C(=O)O', '78', '92'], ['2', 'COc1ccc2cc(ccc2c1)[C@H](C)C(=O)O', '85', '96'], ['3', 'C[C@H](C(=O)O)c1ccc(c(F)c1)-c1ccccc1', '64', '88'], ['4', 'C[C@H](C(=O)O)c1cccc(c1)C(=O)c1ccccc1', '71', '90']];
  await page.evaluate(async (rows) => {
    const sm = window.__app.sheetMode, v = sm.view;
    for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
      v.select({ r1: r, c1: c, r2: r, c2: c });
      if (r > 0 && c === 1) await sm.structureFromText(rows[r][c]);
    }
  }, rows);
  for (let r = 0; r < rows.length; r++) {
    await page.evaluate(([r]) => window.__app.sheetMode.view.select({ r1: r, c1: 0, r2: r, c2: 0 }), [r]);
    for (let c = 0; c < rows[r].length; c++) {
      if (r > 0 && c === 1) { await page.keyboard.press('Tab'); continue; }
      await page.keyboard.type(rows[r][c]); await page.keyboard.press('Tab');
    }
  }
  await page.waitForTimeout(500);
  await page.evaluate(async () => { const sm = window.__app.sheetMode; sm.view.select({ r1: 1, c1: 1, r2: 1, c2: 1 }); await sm.propertyColumns({ col: 1, props: [{ name: 'FORMULA' }, { name: 'MW' }] }); });
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    const sm = window.__app.sheetMode, v = sm.view;
    sm.edit('Sizes', (sh) => { sh.setColWidth(1, 150); sh.setColWidth(4, 110); for (let r = 1; r <= 4; r++) sh.setRowHeight(r, 92); });
    v.select({ r1: 0, c1: 0, r2: 4, c2: 5 });
    sm.run('insert-table');
  });
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const sm = window.__app.sheetMode;
    sm.view.select({ r1: 0, c1: 2, r2: 4, c2: 3 });
    sm.run('chart-column');
    sm.edit('Chart', (sh) => sh.setCharts(sh.charts.map((c) => ({ ...c, title: 'Yield and ee by entry', palette: 'safe', at: { row: 0, col: 6, dx: 16, dy: 4 }, w: 420, h: 300 }))));
    sm.view.select({ r1: 2, c1: 1, r2: 2, c2: 1 });
  });
  await page.waitForTimeout(1500);
  await page.mouse.click(300, 760);
  await page.waitForTimeout(4000);
  await shot(page, 'sheet');

  // Document: an experimental paragraph with a structure in the text
  await page.evaluate(() => window.__app.ws.newDocument()); await page.waitForTimeout(800);
  await page.mouse.click(700, 330); await page.waitForTimeout(200);
  await page.keyboard.press('Control+Alt+1');
  await page.keyboard.type('Ethyl (E)-3-([1,1\'-biphenyl]-4-yl)acrylate'); await page.keyboard.press('Enter');
  await page.keyboard.type('Sodium hydride (60% in oil, 0.48 g, 12.0 mmol) was suspended in THF (30 mL) at 0 °C, and triethyl phosphonoacetate (2.4 mL, 12.0 mmol) was added dropwise. After 20 min, a solution of 4-phenylbenzaldehyde (1.82 g, 10.0 mmol) in THF (10 mL) was added. The mixture was stirred for 2 h, quenched with saturated aqueous NH4Cl and extracted with EtOAc. Chromatography gave the enoate as a white solid (2.22 g, 88%, E/Z > 20:1).');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+e');
  await page.evaluate(async () => { const dm = window.__app.docMode; const r = await dm.host.toStructure('CCOC(=O)/C=C/c1ccc(-c2ccccc2)cc1', dm.file.t.drawingStyle); dm.insertDrawing(r.contents); });
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+l');
  await page.keyboard.type('1H NMR (400 MHz, CDCl3): δ 7.73 (d, J = 16.0 Hz, 1H), 7.64–7.58 (m, 6H), 7.46 (t, J = 7.5 Hz, 2H), 7.38 (t, J = 7.3 Hz, 1H), 6.49 (d, J = 16.0 Hz, 1H), 4.28 (q, J = 7.1 Hz, 2H), 1.35 (t, J = 7.1 Hz, 3H).');
  await page.waitForTimeout(600);
  await shot(page, 'document');

  // Split view: the scheme beside the document
  await page.evaluate(() => window.__app.command('split-view'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => { window.__app.editor.clearSelection(); window.__app.editor.fit(); });
  await shot(page, 'split-view');
  await page.evaluate(() => window.__app.command('split-view'));
  await page.waitForTimeout(600);

  // References: the document cites the literature from its own list (References > Manage References)
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Suzuki couplings of aryl bromides are well precedented');
  await page.evaluate(async () => {
    const dm = window.__app.docMode, f = dm.file;
    const refs = [
      { id: 'r-suzuki', type: 'article', authors: ['Miyaura, Norio', 'Suzuki, Akira'], title: 'Palladium-Catalyzed Cross-Coupling Reactions of Organoboron Compounds', journal: 'Chem. Rev.', year: '1995', volume: '95', issue: '7', pages: '2457–2483', doi: '10.1021/cr00039a007', url: '', publisher: '', note: '' },
      { id: 'r-hwe', type: 'article', authors: ['Wadsworth, William S.', 'Emmons, William D.'], title: 'The Utility of Phosphonate Carbanions in Olefin Synthesis', journal: 'J. Am. Chem. Soc.', year: '1961', volume: '83', issue: '7', pages: '1733–1738', doi: '10.1021/ja01468a042', url: '', publisher: '', note: '' },
      { id: 'r-fulmer', type: 'article', authors: ['Fulmer, Gregory R.', 'Miller, Alexander J. M.', 'Sherden, Nathaniel H.', 'Gottlieb, Hugo E.', 'Nudelman, Abraham', 'Stoltz, Brian M.', 'Bercaw, John E.', 'Goldberg, Karen I.'], title: 'NMR Chemical Shifts of Trace Impurities: Common Laboratory Solvents, Organics, and Gases in Deuterated Solvents Relevant to the Organometallic Chemist', journal: 'Organometallics', year: '2010', volume: '29', issue: '9', pages: '2176–2179', doi: '10.1021/om100106e', url: '', publisher: '', note: '' },
      { id: 'r-still', type: 'article', authors: ['Still, W. Clark', 'Gennari, Cesare'], title: 'Direct Synthesis of Z-Unsaturated Esters. A Useful Modification of the Horner-Emmons Olefination', journal: 'Tetrahedron Lett.', year: '1983', volume: '24', issue: '41', pages: '4405–4408', doi: '10.1016/S0040-4039(00)85909-2', url: '', publisher: '', note: '' },
    ];
    f.ed.update({ ...f.t, references: refs }, 'References');
    f.ed.setCaret(f.ed.end);
    dm.insertObject({ kind: 'cite', refs: ['r-suzuki'] }, 'Insert citation', { sup: true });
    f.ed.setStyle({ sup: false });
  });
  await page.keyboard.type(', and the olefination follows Wadsworth and Emmons');
  await page.evaluate(() => { const dm = window.__app.docMode, f = dm.file; dm.insertObject({ kind: 'cite', refs: ['r-hwe', 'r-still'] }, 'Insert citation', { sup: true }); f.ed.setStyle({ sup: false }); });
  await page.keyboard.type('. Solvent peaks were assigned from the usual tables');
  await page.evaluate(() => { const dm = window.__app.docMode, f = dm.file; dm.insertObject({ kind: 'cite', refs: ['r-fulmer'] }, 'Insert citation', { sup: true }); f.ed.setStyle({ sup: false }); });
  await page.keyboard.type('.');
  await page.keyboard.press('Enter');
  await page.evaluate(() => window.__app.docMode.insertBibliography());
  await page.waitForTimeout(600);
  await page.evaluate(() => void window.__app.docMode.manageReferences());
  await page.waitForTimeout(800);
  // the list to the right, so the citations and the bibliography show beside it
  await page.evaluate(() => { const d = document.querySelector('dialog.refs-dialog'); if (d) { d.style.margin = '0'; d.style.left = 'auto'; d.style.right = '16px'; d.style.top = '170px'; d.style.width = '640px'; } });
  await page.waitForTimeout(400);
  await shot(page, 'references');
  await page.keyboard.press('Escape');

  // Design: the conference poster template, with the shape library open
  await page.evaluate(() => window.__app.command('new-design'));
  await page.waitForTimeout(800);
  await page.locator('dialog[open] button', { hasText: 'Conference poster' }).click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__app.editor.clearSelection(); window.__app.editor.fit(); });
  await shot(page, 'design');

  // Help > Send Feedback
  await page.evaluate(() => window.__app.command('send-feedback'));
  await page.waitForTimeout(300);
  await page.keyboard.type('Number compounds in the order the text mentions them');
  await page.keyboard.press('Tab');
  await page.keyboard.type('In Document mode, it would help if compound numbers followed the order the compounds are first mentioned in the text, as journals ask.');
  await shot(page, 'feedback');
  await page.keyboard.press('Escape');

  if (problems.length) console.log('Errors on the page:', problems);
  await browser.close();
}

// ---------------------------------------------------------------- ring fills and highlights
{
  const { browser, page, problems } = await open(url);
  // estrone: each ring filled a different way
  const est = await addSmiles(page, 'C[C@]12CC[C@H]3[C@@H](CCc4cc(O)ccc34)[C@@H]1CCC2=O', 230, 250);
  await select(page, { atoms: est });
  await page.evaluate(() => {
    const a = window.__app, doc = a.doc;
    a.command('fill-rings');
    const rings = [...doc.shapes.values()].filter((s) => s.kind === 'ring').sort((p, q) => p.x1 - q.x1);
    const looks = [
      { filled: true, fill: 'gradient', fillColor: '#5b8def', fill2: '#e8f0ff', gradAngle: 90, shadow: true },
      { filled: true, fillColor: '#fbe0df', pattern: 'hatch', patternColor: '#d9534f', patternSize: 2.2, patternTransparency: 0.45 },
      { filled: true, fillColor: '#fde9b8', pattern: 'dots', patternColor: '#b8860b', patternSize: 2.2 },
      { filled: true, fillColor: '#cdebd3', shadow: true },
    ];
    doc.edit('Ring looks', () => rings.forEach((r, i) => doc.updateShape(r.id, looks[i % looks.length])));
    a.editor.clearSelection();
  });
  // a kinase-inhibitor-like structure: its parts picked out with highlights of each shape
  const imb = await addSmiles(page, 'Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1', 420, 250);
  await page.evaluate(async (imb) => {
    const a = window.__app, doc = a.doc, e = a.editor;
    // atoms by their place in the SMILES
    const pick = (idx) => {
      const atoms = new Set(idx.map((i) => imb[i]));
      const bonds = new Set([...doc.bonds.values()].filter((b) => atoms.has(b.a1) && atoms.has(b.a2)).map((b) => b.id));
      e.selectThese({ atoms, bonds, captions: new Set(), arrows: new Set(), shapes: new Set() });
    };
    pick([13, 14, 15, 16, 18, 19]); e.highlight('#9ed9a8', { shape: 'round', soft: true, smooth: true });
    pick([5, 6, 7]); e.highlight('#f6b38a', { shape: 'straight', ends: 'pointed' });
    pick([25, 26, 27, 28, 29, 36]); e.highlight('#a9c8ff', { shape: 'straight', centre: true });
    pick([30, 31, 32, 33, 34, 35]); e.highlight('#f2a7c3', { shape: 'round', shadow: true, smooth: true, centre: true });
    e.clearSelection();
    e.fit();
  }, imb);
  await page.evaluate(() => window.__app.command('fold-side'));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__app.editor.fit());
  await shot(page, 'ring-fills', { clip: await contentClip(page, 40) });
  if (problems.length) console.log('Errors on the page:', problems);
  await browser.close();
}

// ---------------------------------------------------------------- group abbreviations
{
  const { browser, page, problems } = await open(url);
  const ids = await addSmiles(page, 'O=C1CC[C@@H](O)[C@H](C)C1', 300, 250);
  await look(page, 4.2, 300, 252);
  await pointer(page);
  await tool(page, 'text', false);
  await page.waitForTimeout(500);
  // a label typed onto an atom, as a person would
  const lab = async (id, text) => { const o = await atomAt(page, id); await page.mouse.click(o.x, o.y); await page.waitForTimeout(250); await page.keyboard.type(text); await page.keyboard.press('Enter'); await page.waitForTimeout(250); };
  // the hydroxyl O (the sixth atom in the SMILES) labelled OTBS
  const oh = ids[5];
  await lab(oh, 'OTBS');
  await tool(page, 'select', false);
  await page.waitForTimeout(300);
  const o = await atomAt(page, oh);
  await page.mouse.move(o.x + 40, o.y + 50);
  await glide(page, o.x + 10, o.y + 2, 10);
  await page.waitForTimeout(1500);
  // the structure and the tooltip, with some room round them
  const m = await contentClip(page, 70);
  const t = await page.locator('.label-tip').boundingBox();
  const x1 = Math.min(m.x, t.x, o.x - 150) - 30, y1 = Math.min(m.y, t.y) - 30, x2 = Math.max(m.x + m.width, t.x + t.width) + 30, y2 = Math.max(m.y + m.height, t.y + t.height) + 30;
  await shot(page, 'group-tooltip', { mouseAway: false, clip: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } });
  if (problems.length) console.log('Errors on the page:', problems);
  await browser.close();
}

// ---------------------------------------------------------------- made your own
{
  const { browser, page, problems } = await open(url);
  await drawScheme(page);
  // toolboxes unlocked and moved: Structure docked along the top, Colours floating by the scheme
  await page.evaluate(() => { const a = window.__app; a.command('lock-toolboxes'); a.command('toolbox-structure'); a.command('toolbox-colours'); });
  await page.waitForTimeout(500);
  const c = await canvasBox(page);
  const head = async (title) => page.locator('.toolbox', { has: page.locator('.tb-title', { hasText: title }) }).locator('.tb-title').boundingBox();
  let h = await head('Structure');
  await page.mouse.move(h.x + 10, h.y + h.height / 2); await page.mouse.down();
  await page.mouse.move(c.x + c.width / 2, c.y + 6, { steps: 20 }); await page.mouse.up();
  await page.waitForTimeout(400);
  h = await head('Colours');
  await page.mouse.move(h.x + 10, h.y + h.height / 2); await page.mouse.down();
  await page.mouse.move(c.x + 40, c.y + c.height - 150, { steps: 20 }); await page.mouse.up();
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__app.command('lock-toolboxes'));
  // a dark page in the Slate colours
  await page.evaluate(() => window.__app.command('dark-page'));
  await page.evaluate(() => window.__app.command('dark-colours'));
  await page.waitForTimeout(400);
  await page.locator('dialog[open] select').first().selectOption('Slate');
  await page.locator('dialog[open] button', { hasText: 'Use' }).click();
  await page.waitForTimeout(400);
  // Edit > Hotkeys, finding the benzene ring's key
  await page.evaluate(() => window.__app.command('hotkeys'));
  await page.waitForTimeout(400);
  await page.keyboard.type('ring');
  await page.waitForTimeout(400);
  await page.evaluate(() => { const d = document.querySelector('.hotkeys')?.closest('dialog'); if (d) { d.style.margin = '0'; d.style.left = 'auto'; d.style.right = '24px'; d.style.top = '120px'; d.style.maxHeight = '560px'; } });
  await page.waitForTimeout(400);
  await shot(page, 'customize');
  if (problems.length) console.log('Errors on the page:', problems);
  await browser.close();
}
