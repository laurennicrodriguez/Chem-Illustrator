# Keyboard and mouse

This page lists the hotkeys in Drawing mode, explains how to change them, and describes what the mouse does with Shift, Ctrl and Alt held and what each mouse pointer means.

The keys are ChemDraw's wherever ChemDraw has one, so your fingers should already know most of them. On a Mac, Cmd works wherever this page says Ctrl, and Option wherever it says Alt; the menus show the Mac symbols (⌘, ⌥).

## How hotkeys work in a drawing

What a key does depends on what the mouse is pointing at:

- **Pointing at an atom** (it highlights blue): the key changes or grows from that atom.
- **Pointing at a bond**: the key changes that bond or fuses a ring onto it.
- **Pointing at empty space**: plain keys pick a tool.
- **Anywhere**: keys with Ctrl or Alt run menu commands.

Letters are case-sensitive: `f` and Shift+F do different things.

A key that grows something moves the highlight to the new atom, so you can carry on typing: `8` then `1` makes an E double bond, `1 1 1` draws a chain. `1` and `0` pressed with the mouse still on an atom keep the highlight there, so pressing `1` three times adds three bonds to the same atom. (The Hotkeys window has a box to turn this off.)

If several atoms are selected and you point at one of them, a label key labels them all.

## Pointing at an atom

### Labels

| Key | Label | Key | Label |
|---|---|---|---|
| `c` | C | `o` or `q` | O |
| `n` or `w` | N | Shift+O | OMe |
| Shift+N | NO2 | `s` | S |
| `p` | P | Shift+S | Si |
| Shift+P | Ph | `f` | F |
| `h` | H | Shift+F | CF3 |
| `d` | D | `l` or Shift+C | Cl |
| `b` | Br | `i` | I |
| Shift+B | B | `x` | X |
| `r` | R | `m` | Me |
| `e` | Et | Shift+E | CO2Me |
| Shift+A | Ac | Shift+Z | N3 |
| Shift+M | MgBr | Shift+L | Li |
| Shift+Y | Boc | Shift+H | Cbz |
| Shift+Q | Fmoc | | |

### Growing and changing

| Key | Does |
|---|---|
| `1` | Grow a bond (zig-zag) |
| `0` | Grow a bond, ring style (the other side; longer on busy atoms) |
| `2` | C=O, or acetyl on an end atom |
| `3` or `a` | Phenyl |
| `4` | Wedge (plus Me on an end atom) |
| `5` | Hashed wedge (plus Me on an end atom) |
| `6` | Cyclohexyl, or a spiro ring on a ring atom |
| `7` | Cyclopentyl, or a spiro ring on a ring atom |
| `u` | Cyclobutyl |
| `v` | Cyclopropyl |
| `8` | =CH2 (then `1` for E, `0` for Z) |
| `9` | Two methyls (iPr, gem-dimethyl) |
| Shift+K | t-Bu |
| `k` | Sulfonyl (SO2) |
| `z` | Alkyne |
| `+` / `-` | Charge +1 / −1 |
| `'` | Show or hide the atom number |
| `.` | Attachment point |
| `=` | Choose a nickname from a list |
| `/` or `?` | The atom's settings in the Style panel |
| Enter | Type a label |
| Backspace or Delete | Remove the label, then the atom |
| `g` | Select the atom |
| Arrow keys | Move the highlight to the next atom that way |
| Shift+arrow keys | Move the highlight about three bonds that way |

## Pointing at a bond

| Key | Does | Key | Does |
|---|---|---|---|
| `1` | Single | `d` | Dashed |
| `2` | Double | Shift+D | Dashed double |
| `3` | Triple | `b` | Bold |
| `w` | Wedge (again to reverse) | Shift+B | Bold double |
| `h` | Hashed wedge (again to reverse) | `y` | Wavy |
| Shift+H | Hashed | `l` / `c` / `r` | Double bond: second line left, centred, right |
| `a` | Fuse benzene | `z` | Fuse cyclopentadiene |
| `4` to `8` | Fuse a 4- to 8-membered ring | `9` / `0` | Fuse a chair cyclohexane (either way) |
| `/` or `?` | The bond's settings in the Style panel | `g` | Select the bond |
| Delete or Backspace | Delete the bond | Arrow keys | Move the highlight |

## Pointing at empty space: tools

| Key | Tool | Key | Tool |
|---|---|---|---|
| Space | Select | `t` | Text |
| `x` | Single bond | Shift+X | Chain |
| `2` | Double bond | `e` | Reaction arrow |
| `w` | Wedge | `h` | Hashed wedge |
| `j` | Benzene | Shift+J | Cyclopentadiene |
| `3` to `8` | Cyclopropane to cyclooctane | Shift+T | Square brackets |

## Anywhere

| Key | Command |
|---|---|
| Ctrl+N, Ctrl+O | New drawing, Open |
| Ctrl+S, Ctrl+Shift+S | Save, Save As |
| Ctrl+P | Print |
| Ctrl+W | Close the tab |
| Ctrl+Tab, Ctrl+Shift+Tab | Next tab, previous tab |
| Ctrl+Z | Undo |
| Ctrl+Y or Ctrl+Shift+Z | Redo |
| Ctrl+X, Ctrl+C, Ctrl+V | Cut, Copy, Paste |
| Ctrl+Alt+C | Copy as SMILES |
| Ctrl+Alt+O | Copy as molfile text |
| Ctrl+D | Copy as CDXML text |
| Ctrl+Alt+P | Paste SMILES |
| Ctrl+A | Select all |
| Tab, Shift+Tab | Select the next or previous structure |
| Delete or Backspace | Delete the selection |
| Esc | Clear the selection |
| Arrow keys | Nudge the selection 1 pt |
| Shift+arrow keys | Nudge the selection 10 pt |
| Alt+← / Alt+→ | Turn 1° anticlockwise / clockwise |
| Alt+↑ / Alt+↓ | Turn 15° anticlockwise / clockwise |
| Ctrl+R | Rotate by an angle… |
| Ctrl+K | Scale… |
| Ctrl+Shift+H, Ctrl+Shift+V | Flip left to right, flip top to bottom |
| Ctrl+Alt+Shift+L, C, R | Align left edges, centres across, right edges |
| Ctrl+Alt+Shift+T, M, B | Align top edges, middles down, bottom edges |
| Ctrl+Alt+Shift+H, V | Space evenly across, down |
| Ctrl+→ (or ←, ↑, ↓) | Reaction arrow and a copy of the selection that way |
| Ctrl+J | Join two selected atoms or bonds |
| Ctrl+L | Fixed bond lengths on or off |
| Ctrl+E | Fixed angles on or off |
| Ctrl+Shift+K | Clean Up Structure |
| Ctrl+Shift+R | Clean Up Reaction |
| Alt+K | Aromatic rings: circle or double bonds |
| Ctrl+Shift+N | Name to Structure |
| Ctrl+= or Ctrl+Shift+=, Ctrl+- | Zoom in, zoom out |
| Ctrl+0 | Fit the drawing in the window |
| F5, F6, F7, F8 | Actual size, fit, zoom in, zoom out |
| Alt+Q | Search for a command |

### While typing text

| Key | Does |
|---|---|
| Ctrl+B, Ctrl+I, Ctrl+U | Bold, italic, underline |
| Ctrl+= or F9 | Subscript |
| Ctrl+Shift+= or F10 | Superscript |
| Ctrl+F | Formula style |
| Ctrl+Shift+V | Paste as plain text |
| Esc | Finish typing |

Slides, sheets and documents have their own keys (PowerPoint's, Excel's and Word's), which take priority while that kind of tab is showing. For example, F5 starts a slide show in Slides, and Ctrl+D fills down in a sheet. See their pages.

## Changing hotkeys

Every key can be changed. Open **Edit ▸ Hotkeys…**, or **Help** and then **Show and change all hotkeys…**.

The window lists every action, grouped as above (pointing at an atom, at a bond, at empty space, anywhere, in slides, in sheets, in documents, and typing text), with the keys that do each one.

- Type in the box at the top to find an action or a key.
- Click **+** next to an action and press the key you want. Press Esc to cancel.
- Click **×** on a key to take it away from that action.
- If the key already did something else, the window tells you which action lost it. Nothing is blocked.
- **Reset** next to an action puts ChemDraw's keys back for it; **Reset all to ChemDraw's keys** does it for everything.
- **Export…** saves your keys to a file, and **Import…** loads them, for example on another computer.

Changes work straight away and are saved in the settings file; the window shows where it is. New default keys added in later versions still reach you, because only your changes are stored.

## The mouse

### Clicking and selecting

- **Click** selects one thing. **Shift+click** or **Ctrl+click** adds to the selection, or takes out something already in it.
- **Drag across empty space** with the select tool to select everything in the box. Hold Shift to add to what is already selected.
- **Double-click** an atom or bond with the select tool to select the whole structure (Shift+double-click adds it to the selection). With other tools, double-clicking an atom types a label.
- **Double-click** a caption to edit its text, or a table cell to type in it.
- **Right-click** opens a menu for what you clicked (see [Drawing](drawing.md#the-right-click-menu)).
- **Space** (pointing at empty space) switches to the select tool.

### Dragging

- **Drag a selection** to move it, with any tool. With the select tool, dragging an atom or object that isn't selected moves just that one.
- **Ctrl+drag** makes a copy: the copy goes with the pointer and the original stays. Ctrl+dragging an unselected atom or bond copies its whole structure.
- **Shift while dragging** keeps the move straight across or straight up and down.
- **Alt while dragging** turns off the alignment guides, so you can move freely.
- **Alt while drawing** a bond, arrow or line lets it point at any angle instead of 15° steps (and ignores fixed bond lengths).

### Turning

Drag the **round handle** above the selection to turn it, in 1° steps. Hold **Alt or Shift** while turning to go in 15° steps.

### Resizing with handles

Boxes, ovals, frames and pictures have square handles on their corners and sides.

- **Shift** on a corner handle keeps the proportions.
- **Ctrl** on a handle resizes about the middle instead of the opposite side.
- **Pictures** keep their proportions on their own. Hold **Alt** on a picture's handle to stretch it freely.
- **Arrow and line ends** snap to 15° steps; hold Alt to place them anywhere. Dragging an arrow's middle bends it in 15° steps; hold Alt to bend it freely.

### Scrolling and zooming

- The **mouse wheel** scrolls up and down; **Shift+wheel** scrolls sideways.
- **Ctrl+wheel** zooms.
- **Middle-drag** or **right-drag** pans the drawing.

## What the mouse pointer means

The pointer changes to show what a click or drag will do.

| Pointer | Where | What it means |
|---|---|---|
| Small square with a shadow | Empty space, select tool | Drag to draw a selection box. |
| Crosshair | Over an atom or bond (select tool), or anywhere with a drawing tool | Click to select or draw at that spot. |
| Open hand | Over something already selected, or the middle of a selected arrow | Drag to move it (or bend the arrow). It closes while you drag. |
| Arrow with a plus (copy) | Over the selection with Ctrl held | Drag to make a copy. |
| Eraser | Eraser tool | Click something to remove it. |
| Two-headed arrows | Over a resize handle | Drag to resize, in the direction shown. |
| Four-headed arrow | Over the end of an arrow or line | Drag to move that end anywhere. |
| Curved arrow | Over the round handle above the selection | Drag to turn the selection. |
| I-beam | Text tool, or over text being typed | Click to type. |

In **Slides** and **Design**, the select tool keeps the usual arrow pointer over empty space, as in PowerPoint, and shows a four-headed arrow over things you can move. Over a text box it shows an I-beam, and one click there starts typing.

In **Documents** and **Sheets**, a **pointing hand** over a structure means it is a drawing: a click picks it, and a **double-click** opens it for editing with the drawing tools.

---

Next: [Getting started](getting-started.md) · [Drawing](drawing.md) · [Slides](slides.md) · [Documents](documents.md) · [Sheets](sheets.md) · [Design](design.md) · [Files and sharing](files-and-sharing.md) · [Feedback](feedback.md)
