# For developers

How to run Chem Illustrator from its source code, how releases are made, where things are in the code, and how to check changes. To use the program, download it instead: see [Getting started](guide/getting-started.md).

Chem Illustrator is written in TypeScript. The drawing runs in a web page; the desktop app wraps that page with [Tauri](https://tauri.app). The chemistry (stereo, clean-up, properties) uses [RDKit](https://www.rdkit.org) compiled to WebAssembly, and names are read by [OPSIN](https://github.com/dan2097/opsin). [TECH-DECISION.md](../TECH-DECISION.md) explains why it is built this way.

## Run it from the source code

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

## How releases are made

Every merge into `main` builds the installers for Windows, macOS and Linux (and the portable Windows zip, with the bare app that portable copies update from, signed with the same key), runs the app's self-test on Windows, and publishes them as a release numbered 0.1.*build number*, with a `latest.json` file that the app's update check reads (`.github/workflows/desktop.yml`, `scripts/release.mjs`). Releases publish one at a time, and "latest" (which is where the update check looks) always goes to the highest version, so two merges close together can't leave an older build marked latest. This needs the update signing key saved as a repository secret named `TAURI_SIGNING_PRIVATE_KEY` (**Settings ▸ Secrets and variables ▸ Actions**). Its public half is in `src-tauri/tauri.conf.json`. Keep a copy of the private key somewhere safe: if it is lost, a new key can be made, but copies installed before the change won't accept updates and need installing once by hand. Without the secret the builds still run, and the installers are kept for a week under the run in the **Actions** tab instead of being published. Builds cost nothing while the repository is public; if it is made private, only Windows is built unless a run is started by hand.

To build it on your own computer you also need Rust (from [rustup.rs](https://rustup.rs)) and, on Windows, the Microsoft C++ Build Tools that the Rust installer offers (on macOS, Xcode's command line tools; on Linux, the WebKitGTK packages listed in the workflow). Then:
```
npm run desktop          # opens the desktop app; it reloads as the code changes
npm run desktop:build    # makes the installers in src-tauri/target/release/bundle/
```

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
| `src/design/`, `src/ui/design-panel.ts`, `layers-panel.ts`, `template-gallery.ts` | Design mode: the shape library, the icon library (`design/icons.ts`, data made by `scripts/build-icons.mjs` from `@mdi/svg`), ready-made layouts, the Layers panel |
| `src/document/` | Document mode: the document, page layout, captions and fields, references and citations, find and replace, printing |
| `src/io/docx-write.ts`, `docx-read.ts`, `cfb.ts` | Saving and opening Word files, and the ChemDraw objects embedded in them |
| `src/worker/` | The RDKit chemistry engine, running in the background |
| `src-tauri/` | The desktop app shell (Tauri), its settings and icons |
| `tests/` | Unit tests |
| `bench/` | Speed measurements and checks that drive the app in a browser |


## Screenshots

The pictures in `docs/images/` are taken by `scripts/screenshots.mjs`, which drives the program in a browser and builds each scene (the scheme, the slides, the sheet, the document, the design, the ring fills, the hover tooltip, the moved toolboxes) from scratch. The animated GIFs are recorded by `scripts/animations.mjs`; both share their helpers in `scripts/shot-lib.mjs`. To take them again after the look changes, start the program (`npm run dev`), then run `node scripts/screenshots.mjs` and `node scripts/animations.mjs` (add names, such as `node scripts/animations.mjs frames spelling`, to record only some). They need Playwright (`npm install --no-save playwright` and `npx playwright install chromium`, or set `CHROMIUM` to a Chromium you already have), and the animations need `ffmpeg` on the path.

## What stays out of the repository

Keep ChemDraw files, manuals and other reference documents out of this repository: it is public. The `.gitignore` already refuses `.cdxml`, `.cdx`, `.cds` and `.pdf` files. Test files made for the tests are built by the tests themselves.
