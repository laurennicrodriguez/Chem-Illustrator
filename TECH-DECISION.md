# Chem Illustrator: technology decision (step 2)

*Written 2026-10-12 after building and measuring the speed prototype.*

## The decision

| Part | Choice | Why |
|---|---|---|
| Drawing engine | TypeScript, drawing on an HTML canvas | Full control over every line and letter (ChemDraw's ACS 1996 look), and the same code runs on the desktop and in a browser. |
| Desktop app | Tauri (a small Rust shell around the system's web view) | On Windows the web view is Microsoft WebView2, which is the same engine as Chrome, so the speeds below carry over. Installers are small (a few MB plus the 7 MB chemistry engine), unlike Electron, which ships a whole browser (100+ MB). |
| Chemistry | RDKit (free, BSD licence) compiled to WebAssembly, running in a background worker | Formula, masses, R/S and E/Z, SMILES in and out. Running it off the drawing thread means drawing never waits for chemistry. |
| Files | CDXML read directly (ChemDraw's XML format) | Your existing files open as they are. |
| Web version | Same code, published as a web page | Comes almost free; nothing in the desktop app is slowed down to allow it. |

Licences of everything used so far: TypeScript (Apache-2.0), Vite (MIT), Vitest (MIT), Playwright (Apache-2.0, testing only), RDKit (BSD-3-Clause), Tauri (MIT/Apache-2.0, next step). All free and open source.

## Measured speed

Measured in Chromium (the engine inside WebView2) on this cloud machine, at normal and at high-resolution (2×) screen density. Your files were used only for testing on this machine and are not in the published prototype.

| Target (from the feature map) | Result | Verdict |
|---|---|---|
| Keypress or mouse move to screen under 16 ms | Hover highlight: under 0.1 ms to paint. Hotkey edits on a small drawing: about 12 ms median from the key press to the finished frame, most of which is waiting for the screen's next refresh. | Met |
| Open your 8 MB poster file in under 1 s | 0.19–0.22 s to read and draw (1,534 atoms, 166 captions, 81 arrows) | Met |
| Open your 4.2 MB file of schemes | 0.22–0.34 s (2,156 atoms, 494 captions, 384 arrows) | Met |
| Scrolling a full page | 0.1 ms per frame at any zoom, on every file tried, including a 40,000-atom stress test | Met |
| Editing inside a big drawing | Moving a structure or pressing a hotkey with the whole poster on screen: 4–8 ms median; occasional frames of 20–30 ms on a 2× screen. On the 40,000-atom stress test: 8–15 ms median. | Met at normal zoom; close at whole-poster zoom |
| Start-up under 2 s | Drawing on screen about 0.1 s after the page loads; chemistry engine ready 0.2–0.9 s later (first load compiles 7 MB of WebAssembly) | Met |
| Chemistry under 50 ms, in the background | About 2 ms per structure after the first call (the first one takes about 80 ms while RDKit warms up) | Met |

How it stays fast:

- **Two layers.** The drawing sits on one layer, and the hover highlight, selection and the bond or ring you are dragging sit on another, so pointing at things never redraws the drawing.
- **Tiles.** The page is cut into 256-pixel tiles that are drawn once and then reused while scrolling. An edit redraws only the tiles it touches.
- **Zooming.** After a zoom, the old tiles are shown stretched until the new ones are ready, a few per frame.
- **Caching.** Label layouts and double-bond placement are cached per atom and bond, and recomputed only within four bonds of a change.

The one known weak spot is dragging a structure while zoomed out on a very large poster. The fix, if it is ever noticeable, is to draw the dragged part on the top layer during the drag.

## What the prototype already does

- **Look.** Draws in the ACS Document 1996 style: bond length, line widths, hash spacing, double-bond spacing, label margins and Arial labels. Double bonds go inside rings automatically. Labels turn around (OH or HO, MeO2C) and stack the H on ring NH.
- **Tools.** Single, double and triple bonds; wedge, hashed wedge, hashed, bold, dashed and wavy bonds; chains; rings of 3 to 8 atoms, benzene and cyclopentadiene (free, fused onto a bond, or spiro); text labels and captions; arrows; select, move and erase. Undo and redo cover everything.
- **Hotkeys.** ChemDraw's atom, bond and empty-space hotkeys, for example 1 to grow a bond, 6 for cyclohexane, a to fuse benzene, w for wedge, o for O, and Shift+O for OMe.
- **Your files.** Opens CDXML: structures, abbreviations (Bn, Ph, Boc and so on), R groups, captions with bold, italic, sub- and superscripts and their original line breaks, structures resized in ChemDraw, colours, arrows (straight, curved, equilibrium, no-go), boxes, circles, brackets, circled charges and lone pairs. Pasted pictures are shown as grey placeholders for now.
- **Chemistry.** Formula, exact mass, molecular weight, [M+H]+ and [M+Na]+, and R/S labels for the selected structure. You can paste a SMILES string to get a structure, and copy a selection as SMILES.

## Risks and how they are handled

- **Text widths.** The prototype uses the system's Arial. That is the real Arial on Windows, so widths will match ChemDraw closely there. Captions in other fonts fall back to Arial if the font is not installed.
- **CDXML coverage.** Pictures, freehand curves, tables and per-letter styling inside atom labels are not read yet. They are counted and listed when a file opens, so nothing is lost silently. Saving to CDXML is part of step 3.
- **WebView2 on Windows.** It comes with Windows 10 and 11, and the Tauri installer can add it if it is missing.

## Next (step 3: ChemDraw parity)

1. Desktop build with a Windows installer, built automatically on GitHub.
2. Save and copy as CDXML, so drawings paste into ChemDraw and Office.
3. Clean Up structure, templates, more arrow and bracket tools, and rich-text captions.
4. Remaining hotkeys and the chemistry warnings from the feature map.
