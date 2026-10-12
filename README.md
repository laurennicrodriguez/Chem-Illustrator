# Chem Illustrator

A fast chemical structure drawing program for the lab, built to work like ChemDraw: the same hotkeys, the same ACS Document 1996 look, and it opens your existing ChemDraw `.cdxml` files.

This is the step 2 speed prototype. It runs as a Windows desktop app and in a web browser. See [TECH-DECISION.md](TECH-DECISION.md) for why it is built this way and how fast it is.

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

Every change pushed to GitHub builds a Windows installer automatically. Open the repository's **Actions** tab, click the latest **Desktop app** run, and download **chem-illustrator-windows-installer** at the bottom of the page. Unzip it and run the file whose name ends in `setup.exe`. The installer is not signed yet, so Windows will say "Windows protected your PC"; click **More info**, then **Run anyway**.

To build it on your own computer you also need Rust (from [rustup.rs](https://rustup.rs)) and the Microsoft C++ Build Tools that the Rust installer offers. Then:
```
npm run desktop          # opens the desktop app; it reloads as the code changes
npm run desktop:build    # makes the installers in src-tauri/target/release/bundle/
```

## What to try

- Point at an atom or bond and press a hotkey, as in ChemDraw: `1 1 1` grows a chain, `6` adds cyclohexane, `a` on a bond fuses benzene, `o` makes an O, `Shift+O` makes OMe. The Help button lists them all.
- Click **Open CDXML…** or drop a ChemDraw `.cdxml` file onto the drawing.
- Select a structure to see its formula, exact mass, MW, [M+H]+ and [M+Na]+. Tick **Show R/S** for stereo labels.
- Paste a SMILES string with Ctrl+V to draw it.
- **Stress test** draws thousands of molecules; the Speed panel shows how long each redraw takes.

## Checks

```
npm test          # unit tests for the chemistry and geometry
npm run build     # type-check and build the web version into dist/
```

The `bench/` scripts drive the app in a headless browser to measure speed. Start `npm run build` and `npm run preview` first, then for example `node bench/perf.mjs stress`. They need Playwright's Chromium once: `npx playwright install chromium`.

## Where things are

| Folder | What is in it |
|---|---|
| `src/model.ts` | The drawing: atoms, bonds, text, arrows, shapes, undo and redo |
| `src/render/` | Drawing to the screen (tiles, bond and label drawing) |
| `src/editor/` | Mouse tools and hotkeys |
| `src/chem/` | Elements, labels, ring and chain geometry, molfile, formula |
| `src/io/cdxml.ts` | Reading ChemDraw `.cdxml` files |
| `src/worker/` | The RDKit chemistry engine, running in the background |
| `src-tauri/` | The desktop app shell (Tauri), its settings and icons |
| `tests/` | Unit tests |
| `bench/` | Speed measurements |

## Licences

Everything used is free and open source. RDKit (BSD-3-Clause) and Tauri (MIT or Apache-2.0) are shipped with the app; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Chem Illustrator itself has no licence chosen yet, so by default all rights are reserved.

Keep ChemDraw files, manuals and other reference documents out of this repository. The `.gitignore` already refuses `.cdxml`, `.cdx` and `.pdf` files.
