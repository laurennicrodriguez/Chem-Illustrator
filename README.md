# Chem Illustrator

A fast chemical structure drawing program for the lab, built to work like ChemDraw: the same hotkeys, the same ACS Document 1996 look, and it opens your existing ChemDraw `.cdxml` files.

This is a working prototype: it opens, saves and copies ChemDraw files (milestone 1) and has the main drawing tools (milestone 2). It runs as a Windows desktop app and in a web browser. See [TECH-DECISION.md](TECH-DECISION.md) for why it is built this way and how fast it is.

## Run it on your computer

You need Node.js once. Everything else is installed into this folder.

1. **Install Node.js** (the LTS version, 24 or newer) from [nodejs.org](https://nodejs.org). The Windows installer is fine; keep the default options.
2. **Get the code.** Either use GitHub Desktop (File > Clone repository > `nathanohare/chem-illustrator`), or in a terminal:
   ```
   git clone https://github.com/nathanohare/chem-illustrator.git
   cd chem-illustrator
   ```
3. **Install the parts it needs** (about 60 MB, once):
   ```
   npm install
   ```
4. **Start it:**
   ```
   npm run dev
   ```
   Then open the address it prints, usually <http://localhost:5173>, in Chrome or Edge. Press Ctrl+C in the terminal to stop it.

## Desktop app (Windows)

Download the newest installer from the repository's **Releases** (on the right of the repository's GitHub page): the file whose name ends in `setup.exe`. The installer is not signed with a Windows certificate, so Windows will say "Windows protected your PC"; click **More info**, then **Run anyway**.

Once installed, the app looks for a newer version a few seconds after it starts and offers to install it (turn this off in **Edit ▸ Preferences**; **File ▸ Check for Updates…** looks at any time). Updates are checked against a signing key before they install, so only releases built from this repository are accepted.

### How releases are made

Every merge into `main` builds the Windows installer, runs the app's self-test, and publishes the installer as a release numbered 0.1.*build number*, with a `latest.json` file that the app's update check reads (`.github/workflows/desktop.yml`, `scripts/release.mjs`). This needs the update signing key saved as a repository secret named `TAURI_SIGNING_PRIVATE_KEY` (**Settings ▸ Secrets and variables ▸ Actions**). Its public half is in `src-tauri/tauri.conf.json`. Keep a copy of the private key somewhere safe: if it is lost, a new key can be made, but copies installed before the change won't accept updates and need installing once by hand. Without the secret the build still runs, and the installer is kept for a week under the run in the **Actions** tab instead of being published.

To build it on your own computer you also need Rust (from [rustup.rs](https://rustup.rs)) and the Microsoft C++ Build Tools that the Rust installer offers. Then:
```
npm run desktop          # opens the desktop app; it reloads as the code changes
npm run desktop:build    # makes the installers in src-tauri/target/release/bundle/
```

## What to try

- Point at an atom or bond and press a hotkey, as in ChemDraw: `1 1 1` grows a chain, `6` adds cyclohexane, `a` on a bond fuses benzene, `o` makes an O, `Shift+O` makes OMe. The Help button lists them all.
- **File ▸ Open** (Ctrl+O) a ChemDraw `.cdxml` file, or drop one onto the drawing. Edit it and **Save** (Ctrl+S): only what you changed is rewritten, so everything else in the file stays exactly as ChemDraw wrote it. **Save As** (Ctrl+Shift+S) saves a copy; new drawings are saved as `.cdxml` too.
- **Edit ▸ Copy** (Ctrl+C) copies the selection, or the whole drawing when nothing is selected. In the Windows app, paste it into ChemDraw as structures, or into Word or PowerPoint as a sharp picture that stays crisp when enlarged; in a browser it is copied as a high-resolution picture. **Paste** (Ctrl+V) takes drawings copied here or in ChemDraw (Windows app), or a SMILES string or molfile. **Cut** is Ctrl+X.
- **File ▸ Export Molfile** saves the selected structures (or all of them) as a `.mol` file; **Edit ▸ Copy as SMILES** (Ctrl+Alt+C) copies them as SMILES text.
- **Text tool** (`t`): click and type a caption. Ctrl+B, Ctrl+I and Ctrl+U for bold, italic and underline; Ctrl+= and Ctrl+Shift+= for subscript and superscript; the bar above the text has Greek letters and symbols. Formulas such as CH3CO2H get their subscripts automatically (Style panel: Formula style).
- **Arrows, shapes and brackets** from the tool bar: reaction, equilibrium, retrosynthetic, crossed-out and curved arrows; boxes, circles and lines; square, round and curly brackets. Drag a handle to change one; the Style panel sets line width and colour.
- **Templates**: ring systems, heterocycles, amino acids and sugars. Click empty space to place one (drag to turn it), click a bond to fuse it on, or click an atom to join it there.
- **Object menu**: align, space evenly, flip (Ctrl+Shift+H, Ctrl+Shift+V) and rotate the selection, or drag the round handle above it.
- **Structure ▸ Clean Up Structure** (Ctrl+Shift+K): evens out bond lengths and angles of the selected structures (or all of them) while keeping their shape, stereocentres and cis/trans double bonds. Undo puts it back.
- **Scheme menu**: **Clean Up Reaction** (Ctrl+Shift+R) lines up a reaction step; **Arrange Scheme…** lays out a multi-step scheme as a line, rows, a snake, down the page, a catalytic cycle or a branching tree, trying each in turn; **Number Compounds…** puts bold numbers under the structures. Curved and fishhook arrows snap between lone pairs, atoms and bonds, and the mechanism palette puts lone pairs, radical dots and circled charges in the open space round an atom.
- **Structure menu** extras: aromatic rings with circles (Alt+K), bonds in front or behind where they cross, the periodic table, terminal methyls, hiding or drawing H atoms, your own templates and nicknames (kept in `settings.json`), and Contract Label. The chain tool takes a number of atoms; quadruple and dative bonds are on the bond palette; colour buttons offer a palette, and shapes can be filled solid, faded or shaded.
- **Analysis panel** (right side): select a structure for its formula, exact mass, MW, m/z for the ion picked, elemental analysis, isotope pattern, properties (cLogP, TPSA, H-bond donors and acceptors) and estimated boiling and melting points. Buttons put a formula caption, ACS-style HRMS text or elemental analysis text under the structure. **View ▸ Show R/S Preview** shows every stereo label in red.
- **Chemistry tools**: the **mass fragmentation** tool (a dashed line across bonds labels each piece with its formula and mass); **Structure ▸ Stereo Group** (abs, &1, or1) and **Chiral Flag** (Abs, Rel, Rac); **Polymer or Repeat Brackets** (n for a polymer's repeat unit, or a number); **R-Group Table** (a table of each compound's groups with its number, formula and MW worked out). All are saved the way ChemDraw saves them.
- **View ▸ Split View** puts a drawing beside a document, sheet or slides. Click a side to work on it; the bar above the drawing picks a drawing and inserts structures into the document, cell or slide. Drag the divider to change the widths.
- Paste a SMILES string or a molfile with Ctrl+V to draw it.
- **+ Document** opens a Word-style document: pages with margins, styles (Normal, Heading 1–3, Caption; change a style in the Format panel and every paragraph in it follows), bullet and numbered lists (Tab and Shift+Tab change the level), structures drawn in the text (Insert ▸ Structure), numbered captions and cross-references that renumber themselves, references (References ▸ Manage References: add by DOI from Crossref, by hand, or from BibTeX/RIS; citations numbered in order of first citation and a bibliography in ACS, RSC, Wiley-VCH, Chemistry Europe, Elsevier, Nature, Science, Thieme, Beilstein or MDPI style, with every detail changeable under Style Options and a style of your own for new documents), and page numbers such as S1, S2 (Layout tab). **Find** (Ctrl+F) and **Replace** (Ctrl+H) can also change how the found words look, for example making every CH2Cl2 a formula. Save as a Word file (`.docx`; structures stay editable here and show as pictures in Word), open Word files (embedded ChemDraw drawings come in as structures), or **File ▸ Export PDF**.
- **+ Design** (File ▸ New Design) is for graphics: TOC graphics and graphical abstracts at the journals' sizes, posters, flowcharts, workup schemes and timelines. Start from a blank page of any size or a ready-made layout. The shape library on the left has basic shapes, block arrows, flowchart shapes, callouts and lab glassware (click one, or drag it onto the page); double-click a shape to type in it. **Connector** and **Elbow** join shapes and follow them when they move; pink guides show when things line up (hold Alt to stop them); the **Layers** panel on the right reorders, hides, locks and renames everything. Pictures can have their white background removed. Designs save as a one-slide PowerPoint file (or `.cdxml`), and **Export Picture** saves a PNG at the dpi you choose (300 or 600 for journals) or an SVG, on the page colour or see-through.
- **Right-click** the drawing for a menu of what fits what you clicked: the usual edit commands, plus the Structure, Scheme, Align, Rotate and View commands from the top menus. With any tool, drag something already selected to move it (the pointer turns into a hand).
- **Structure ▸ Add Frame** draws a box round the selection that grows, shrinks and moves with what is inside it; the Style panel sets the gap across and up and down.
- **Structure ▸ Show Terminal Methyls** writes out chain ends as CH3 or as Me (Structure ▸ Terminal Methyls as CH3 / as Me, or the Style panel for one structure).
- **Edit ▸ Colour Palettes…**: rows of your own colours, shown in every colour menu in every mode (start from a colour-blind-safe set or the drawing's own colours).
- **Structure ▸ Fill Rings** colours in the selected rings, and **Highlight** puts a soft band of colour behind atoms and bonds. Ring fills, boxes, ovals and design shapes can be shaded with a two-colour gradient and hatched or stippled (Style panel ▸ Pattern), as in black-and-white charts.
- **View ▸ Toolbox** items show more toolboxes: Structure, Arrange, Templates, Colours and **My Toolbox** (any tools and commands you choose). Untick **Lock Toolboxes** to drag one by its title to any edge of the drawing, or to float it.
- **View ▸ Developer Tools** shows the Speed panel (how long each redraw takes) and a **Stress test** that draws thousands of molecules. Hidden unless switched on; the choice is kept in `settings.json`.

## Checks

```
npm test          # unit tests for the chemistry, geometry and saving
npm run build     # type-check and build the web version into dist/
```

To also check saving against your own ChemDraw files (they stay on your computer), point the tests at a folder of `.cdxml` files: in PowerShell `$env:CHEM_TEST_FILES="C:\path\to\folder"; npm test`. Any `.cdx` files saved by ChemDraw in that folder, or in a folder inside it, are also checked against the `.cdxml` file of the same name.

The `bench/` scripts drive the app in a headless browser to measure speed. Start `npm run build` and `npm run preview` first, then for example `node bench/perf.mjs stress`. They need Playwright's Chromium once: `npx playwright install chromium`.

## Where things are

| Folder | What is in it |
|---|---|
| `src/model.ts` | The drawing: atoms, bonds, text, arrows, shapes, undo and redo |
| `src/render/` | Drawing to the screen (tiles, bond and label drawing), and pictures for other programs (EMF, SVG, PNG) |
| `src/editor/` | Mouse tools and hotkeys; align, flip and rotate |
| `src/ui/` | Tool bar, Style panel, the caption text box and template pictures |
| `src/richtext.ts` | Styled caption text (bold, subscripts, Greek letters) |
| `src/chem/` | Elements, labels, ring and chain geometry, templates, Clean Up Structure, molfile, formula |
| `scripts/make-templates.mjs` | Makes the template shapes (`src/chem/templates.json`) with RDKit |
| `src/io/cdxml.ts`, `cdxml-write.ts` | Reading and saving ChemDraw `.cdxml` files |
| `src/io/cdx.ts` | ChemDraw's binary CDX format (used on the clipboard), converted to and from CDXML |
| `src/io/files.ts`, `document-file.ts` | Open and Save dialogs, unsaved-changes prompts |
| `src/io/clipboard.ts`, `src-tauri/src/clipboard.rs` | Cut, copy and paste; the Windows clipboard |
| `src/ui/context-menu.ts`, `toolboxes.ts`, `palette-ui.ts`, `src/editor/frames.ts`, `src/chem/ring-fill.ts`, `src/render/fills.ts` | The right-click menu, toolboxes, your palettes, frames, ring fills, and hatched and gradient fills |
| `src/design/`, `src/ui/design-panel.ts`, `layers-panel.ts`, `template-gallery.ts` | Design mode: the shape library, ready-made layouts, the Layers panel |
| `src/document/` | Document mode: the document, page layout, captions and fields, references and citations, find and replace, printing |
| `src/io/docx-write.ts`, `docx-read.ts`, `cfb.ts` | Saving and opening Word files, and the ChemDraw objects embedded in them |
| `src/worker/` | The RDKit chemistry engine, running in the background |
| `src-tauri/` | The desktop app shell (Tauri), its settings and icons |
| `tests/` | Unit tests |
| `bench/` | Speed measurements and checks that drive the app in a browser |

## Licences

Chem Illustrator is free software: you can use, share and change it under the terms of the [GNU General Public License](LICENSE), version 3 or (at your option) any later version. It comes with no warranty. Copyright © 2026 Nathan O'Hare.

Everything it uses is free and open source, and keeps its own licence: RDKit (BSD-3-Clause), OPSIN (MIT), Tauri (MIT or Apache-2.0), the bundled fonts (SIL Open Font License) and others listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). All of them can be shipped with a GPL program.

ChemDraw is a trademark of Revvity, Inc. Chem Illustrator is not made by, connected with or endorsed by Revvity; it reads and writes ChemDraw's published CDXML and CDX file formats so that your files open in both.

Keep ChemDraw files, manuals and other reference documents out of this repository. The `.gitignore` already refuses `.cdxml`, `.cdx` and `.pdf` files.
