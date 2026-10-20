# Drawing

This page covers Drawing mode in depth: the tools, hotkeys on atoms and bonds, text, arrows and shapes, the Structure, Scheme and Object menus, drawing styles, the dark page, the Analysis panel and the other chemistry tools.

If you use ChemDraw, most of this will feel familiar: the hotkeys are ChemDraw's, new drawings use the ACS Document 1996 style, and files are saved as `.cdxml` or `.cdx`. Mac users: read Cmd for Ctrl and Option for Alt.

![A drawing with a reaction scheme, the toolbox on the left and the side panel on the right](../images/drawing.png)

## The toolbox

The drawing tools run down the left side, in groups. A button with a small arrow beside it holds a set of tools; click the arrow, right-click the button, or press and hold it to open the set. The button then shows the tool you used last. Rest the mouse on any tool to see its name and hotkey, and watch the hint line at the bottom of the window for how to use it.

### Select and eraser

- **Select and move**: click to select, drag a box round things to select them, drag a selection to move it. Double-click an atom or bond to select its whole structure. Delete removes the selection.
- **Eraser**: click an atom, bond, caption, arrow or shape to remove it.

### Bonds and chains

Single, double, triple and quadruple bonds; wedge, hashed wedge, hashed, bold, dashed and wavy bonds; a dative bond; and the chain tool.

- Click empty space or an atom to draw a bond; drag to aim it. New bonds point in 15° steps and are a standard length. Hold Alt while drawing to draw at any angle, or turn off **Structure ▸ Fixed Bond Lengths** (Ctrl+L) and **Fixed Angles** (Ctrl+E).
- Click an existing bond with the single bond tool to step it through single, double and triple. Click a double bond again with the double bond tool to move its second line. Click a wedge or dative bond again to reverse it.
- Draw a dative bond from the donor atom to the acceptor (H3N→BF3). Neither atom loses a hydrogen for it.
- **Chain**: drag from empty space or an atom; a number shows how many bonds you have. Or click and type how many atoms you want. Alt+click draws the same number again.

### Rings

Cyclopropane to cyclooctane, benzene and cyclopentadiene.

- Click empty space to place a ring, a bond to fuse it on, or an atom to make a spiro ring. Alt+click an atom to attach the ring by a new bond instead. Drag to turn it.
- With benzene, Shift+click swaps the double bonds round; Ctrl+click draws it with a circle inside. Ctrl+click with cyclopentadiene also draws a circle.

### Templates

Four palettes of ready-made structures: **Ring systems**, **Heterocycles**, **Amino acids** and **Sugars and chair**, plus **My templates**.

- Click empty space to place a template (drag while placing to turn it).
- Click a bond to fuse it on: pyridine on a benzene bond gives quinoline.
- Click an atom to join it there. Hold Alt to join it the other way (by a new bond, or sharing the atom).

To make your own template, select a structure and click the first button on the **My templates** palette, or use **Structure ▸ Save as Template…**. Give it a name and it appears in the palette. **Structure ▸ Delete Template…** removes one.

### Text, periodic table and fragmentation

- **Text**: click an atom to type a label, or empty space for a caption. See [Text and captions](#text-and-captions).
- **Periodic table**: pick an element, then click atoms to change them, or empty space to add a lone atom. Atoms already selected change at once. You can type a symbol in its box and press Enter. **Structure ▸ Periodic Table…** opens it too.
- **Mass fragmentation**: see [Mass fragmentation](#mass-fragmentation).

### Arrows, mechanism symbols, shapes and brackets

- **Arrows**: reaction, dashed, hollow-headed, resonance (heads at both ends), equilibrium, retrosynthetic and crossed-out (reaction does not go). Drag to draw one, or click for a standard length. Drag an end to move it and drag the middle to bend the arrow into an arc. With the arrow tool, Shift+drag from an arrow's end or middle to branch a second arrow off it (one starting material, two products).
- **Curved arrows** (electron pair) and **fishhook arrows** (one electron): drag from a lone pair, atom or bond to an atom or bond, and the arrow snaps into place as in a mechanism. If you have drawn lone pairs on the atom, the arrow starts from the one facing where it goes. The arrow picks the side and curl that keep it clear of the other atoms and bonds; swing out to one side as you drag to bend it that way instead. Drag the middle dot to change the curve. Hold Alt to draw freely.
- **Moving an arrow's end:** drag the end of a curved arrow onto a lone pair, atom or bond and it snaps there, keeping the side it bends to. Hold Alt to put the end anywhere.
- **Clean Up Arrow** (**Scheme ▸ Clean Up Arrow**, or right-click a curved arrow): redraws the selected curved arrows from the lone pair, bond or atom their tail is on to what their head points at, starting and ending at a sensible angle and clear of the structure. Undo puts them back. It has no key to start with; give it one in **Edit ▸ Hotkeys…**.
- **Mechanism symbols**: lone pair, radical dot, circled plus and minus, δ+ and δ−. Click an atom and the symbol goes in the most open space round it. A radical dot makes the atom a radical (one H fewer); a circled charge sets the atom's charge.
- **Shapes**: boxes (plain, round-cornered, with a shadow, dashed), ovals, circles drawn from the centre, a filled circle, and plain, dashed and bold lines. Drag to draw; Shift while drawing an oval makes a circle. Drag the corner squares to resize.
- **Brackets**: square, round and curly. Drag a box to put a pair of brackets round it, or click a structure to bracket it.

Select any arrow, shape or bracket to change its line width, colour, dashes, fill, corners and shadow in the **Style** panel.

## Hotkeys on atoms and bonds

As in ChemDraw, point at an atom or bond (it highlights blue) and press a key. Some favourites:

- On an atom: `1` adds a bond, `2` a C=O, `6` cyclohexyl, `a` phenyl, `o` makes it O, Shift+O makes it OMe, `+` and `-` charge it.
- On a bond: `2` makes it double, `w` a wedge, `h` a hashed wedge, `a` fuses benzene, `6` fuses cyclohexane, `9` and `0` fuse a chair.

A key that grows something moves the highlight to the new atom, so you can keep typing: `8` then `1` gives an E double bond. Pressing `1` or `0` with the mouse on an atom keeps the highlight there, so `1` three times adds three bonds to it.

[Keyboard and mouse](keyboard-and-mouse.md) has the complete lists. **Edit ▸ Hotkeys…** shows every key and lets you change any of them.

## Text and captions

Pick the text tool (`t` over empty space) and:

- **click an atom** to type a label such as OMe, CO2Et or NHBoc;
- **click empty space** for a one-line caption;
- **drag across empty space** to make a text box that wraps its lines. Drag the small handle on its right side to make it wider or narrower.

Double-click a caption to edit it again. Press Esc to finish.

While you type, a bar above the text has bold, italic and underline, subscript and superscript, **formula style**, font, size and colour, alignment, bullets and numbering, indents, line and paragraph spacing, and a set of Greek letters and symbols (**αΩ**).

Useful keys while typing:

| Key | Does |
|---|---|
| Ctrl+B, Ctrl+I, Ctrl+U | Bold, italic, underline |
| Ctrl+= or F9 | Subscript |
| Ctrl+Shift+= or F10 | Superscript |
| Ctrl+F | Formula style |
| Tab, Shift+Tab | Change the level of a list item |
| Ctrl+Shift+V | Paste as plain text |

Formula style writes CH3CO2H with its numbers lowered and raises a + at the end of a word (NH4+). To raise a minus charge or a charge with a number (Fe3+), select it and use superscript, as in ChemDraw.

As you type, common chemistry is tidied for you: CH2Cl2 gets its subscripts, `0 oC` becomes 0 °C, `1H NMR` gets its superscript. Press Ctrl+Z straight away to undo just that change. Misspelt words get a red underline and formatting slips (a hyphen in a range, a number run into its unit) a blue one; right-click for suggestions. **Edit ▸ Typing and Spelling…** turns these helpers off, adds your own replacements (`rxn` → reaction) and edits your dictionary.

You can paste formatted text from Word into a text box; bold, italic, subscripts, colours and lists come across.

### Turning text

Select a caption or text box on its own with the select tool, and a round handle appears above it. Drag the handle to turn the text; hold Shift or Alt to turn in 15° steps. When you turn a structure that has captions with it, the captions move round with the structure but stay upright. Labels attached to a structure (ID labels, descriptors) also stay upright.

## Moving, turning and the Object menu

Select something and:

- drag it to move it (with any tool: the pointer turns into a hand over a selection);
- drag the round handle above the selection to turn it;
- use the arrow keys to nudge it 1 pt, or Shift+arrow for 10 pt;
- press Alt+← or Alt+→ to turn it 1°, Alt+↑ or Alt+↓ for 15°.

The **Object** menu has:

- **Align Left Edges**, **Align Centres Across**, **Align Right Edges**, **Align Top Edges**, **Align Middles Down**, **Align Bottom Edges**;
- **Space Evenly Across** and **Space Evenly Down** (three or more things);
- **Flip Left to Right** (Ctrl+Shift+H), **Flip Top to Bottom** (Ctrl+Shift+V);
- **Rotate 90° Clockwise**, **Rotate 90° Anticlockwise**, **Rotate 180°** and **Rotate…** (Ctrl+R, any angle);
- **Scale…** (Ctrl+K): by a percentage, or to a bond length in points;
- **Join** (Ctrl+J): joins two selected atoms, or two selected bonds, into one;
- **Bring Bond to Front** and **Send Bond to Back**: where two bonds cross, the one behind gets a small gap.

**View ▸ Alignment Guides** makes things you move snap into line with other structures, text, arrows, shapes and the page edges, with pink guide lines. It starts off in drawings. Hold Alt while dragging to move freely.

To start a reaction quickly, select a structure and press Ctrl+→ (or Ctrl+←, Ctrl+↑, Ctrl+↓): you get a reaction arrow and a copy of the structure to edit into the product.

## The Structure menu

### Tidying and checking

- **Clean Up Structure** (Ctrl+Shift+K): evens out bond lengths and angles of the selected structures (or all of them) while keeping their shape, stereocentres and cis/trans double bonds. Undo puts it back.
- **Check Structure (next warning)**: goes to the next problem; see [Warnings](#warnings).
- **Aromatic Rings: Circle or Double Bonds** (Alt+K): switches selected rings (or all) between a circle and alternating double bonds.
- **H Atoms: Hide or Draw**: hides hydrogens that add nothing (not ones on wedges, charged ones, or ones on N or O); with nothing to hide, it draws the selected atoms' hydrogens.
- **Show Terminal Methyls (or Hide)**: writes chain ends out as CH3 or Me, or takes them away again. Choose Me or CH3 in **Edit ▸ Preferences**. With one structure selected, the Style panel's **Terminal methyls** box sets it for that structure.

### Labels and groups

- **Contract Label…**: turns a selected group into one label (such as PMP) that keeps its chemistry. ChemDraw opens it as a contracted label.
- **Define Nickname…**: select a group that hangs off a structure by one bond and give it a name. Typing that name as a label anywhere then counts as the full group for formula and mass. **Delete Nickname…** removes one.
- **Name to Structure…** (Ctrl+Shift+N): type a systematic, CAS-style or common name and the structure is drawn. Select a caption holding a name first to turn the caption into the structure. Names are read on your computer, so this works offline; names it can't read (DMAP, DIPEA) can be looked up on PubChem if you allow it in **Edit ▸ Preferences**.

### Frames, highlights and fills

- **Add Frame**: draws a box round the selection that grows, shrinks and moves with what is inside. Click the frame to set the gap across and up and down in the Style panel, untick **Fit round its contents** to stop it following, or click **Fit now**. Dragging a corner by hand also stops it following.
- **Highlight**: a soft band of colour (yellow to start) behind the selected atoms and bonds. With highlighted atoms selected, the Style panel sets the colour, **Highlight shape** (round, diamond or square), **Smooth outline** (round highlights), **Highlight size (%)**, **Grow round atom labels**, a shadow and soft edges. **Remove Highlight** takes it off.
  - Square and diamond highlights are one even band along the bonds, with sharp corners where bonds meet, square or pointed ends, and a square or diamond only under an atom with no highlighted bond. Round highlights put a disc on each atom unless **Smooth outline** is on (or **Structure > Smooth Highlight**, also on the right-click menu), which makes them one even band with round corners. Where a label is bigger than the band, the band swells smoothly round it; untick **Grow round atom labels** to keep it even.
- **Fill Rings**: colours in the selected rings. The fills move with the structure. In the Style panel, a fill can be solid, faded, shaded or a two-colour **Gradient**, and can have a **Pattern** (diagonal lines, cross-hatch, horizontal or vertical lines, grid, dots), with its own colour and spacing. **Pattern see-through** lets what is behind show through the lines or dots, and **Pattern under double bonds** decides whether the pattern runs under the inner line of a double bond. **Shadow** gives a filled ring a drop shadow (with or without a highlight), and **Shadow size** sets how far it sticks out; right-click a structure and choose **Highlight and Fill > Ring Fill Shadow** to turn it on or off. Copies of a structure (Ctrl+drag, or copy and paste) keep their ring fills. Boxes and ovals take the same fills and patterns.

### Labelling a structure

- **Add ID Label**: puts the next compound number under the structure, ready to type over.
- **Add Caption**: an empty caption under the structure, ready to type.
- **Attach Descriptors (Formula, Mass)**: the formula and masses under the structure. They follow it when you move it and update when you change it. Select them to choose the side and gap, which values are shown (formula, exact mass, MW, m/z, elemental analysis, HRMS) and the ion, or untick **Update when the structure changes** to keep text you typed yourself.

These follow the structure when it moves. Several stack up: ID label first, then caption, then descriptors.

### Stereochemistry

R/S and E/Z are worked out for every structure as you draw.

- **View ▸ Show R/S Preview** shows every label in red, on screen only.
- **Structure ▸ Show Stereo Labels (R/S, E/Z)** adds them to the selected structures (or all) as part of the drawing; they update themselves after edits. Select a stereocentre to hide its label or type your own, such as (R*).
- Plain bold bonds count as wedges and plain hashed bonds as hashed wedges, as in ChemDraw. Where R or S would depend on what an R or Ar group is, no label is given.
- **Axial chirality** (biaryls, allenes, alkylidenecycloalkanes) is labelled Ra or Sa by IUPAC rule P-93.5.1. Draw the groups on one end of the axis with a wedge and a hash (or one wedge) to show which way round it is. Without that, or when one end has two of the same group, no label is shown. **Edit ▸ Preferences** writes them as P/M instead (Ra = M, Sa = P).
- **Stereo Group (abs, &, or)…**: marks selected stereocentres as abs (known as drawn), &1 (a mixture of both forms) or or1 (one form, not known which).
- **Chiral Flag (Abs, Rel, Rac)…**: puts the boxed flag under the selected structure, or removes it.

### Polymers and R-groups

- **Polymer or Repeat Brackets (n, ×3)…**: put square brackets round a repeat unit with the bracket tool, select both brackets, and type `n` for a polymer or a number for a group repeated that many times. The Analysis panel then shows the formula as end groups plus the repeat unit.
- **R-Group Table…**: draw a core with R1, R2 (or R, X, Ar) as labels, select it and choose this. Type one compound per line, its groups separated by commas (`Me, H`), or paste cells from Excel. You can set a compound number (2 gives 2a, 2b, 2c…), choose whether formula and MW are worked out, and add columns to fill in yourself (`Yield (%), ee (%)`). The table goes under the structure; double-click a cell to change it.

### PubChem

**Structure ▸ Look Up on PubChem** (also in the Analysis panel and the right-click menu) sends the selected structure to PubChem and shows its names, CAS number, a link to its PubChem page, GHS hazards, and measured melting point, boiling point and density where known. See [The Analysis panel](#the-analysis-panel).

## The Scheme menu

- **Clean Up Reaction** (Ctrl+Shift+R): lines up the structures on the arrow, centres the reagents over and under it, and spaces everything evenly.
- **Arrange Scheme…**: lays out a multi-step scheme. Click the layouts to try each one: **Line**, **Rows**, **Snake**, **Down the page**, **Catalytic cycle** (select a caption such as the catalyst's name too, and it goes in the middle) and **Branching**. **Done** keeps it; **Cancel** puts it back.
- **Number Compounds…**: puts numbers under the structures in scheme order. Choose 1, 2, 3; 1a, 1b; a, b; A, B; i, ii or I, II; where to start; text before and after (S for S1, S2); bold; whether copies of one structure share a number (**Same structure, same ID**); whether to renumber or keep existing numbers; and whether reagents over arrows get numbers. Each number is an ordinary caption you can retype. If two different structures end up with the same number, the Warnings panel says so.
- **Show Reaction Roles**: marks how the program reads the scheme (starting materials, products, above and below the arrow).
- **Scheme Settings…**: your defaults for schemes, kept between sessions. Distances are in points; leave one blank to scale it with the bond length (the grey number shows what that comes to).
  - **Gap between arrow and structures** and **Space either side of +**, used by Clean Up Reaction and Arrange Scheme.
  - **Show + boxes above and below new arrows**.
  - **Text size**, **Text alignment** (left, centre or right) and **Gap between arrow and text** for reagents and conditions.
  - **Fit arrow length to its text**: the arrow grows or shrinks to its text, and the products, their + signs and their numbers move with the head. **Arrow before the text starts** and **Space between text and arrowhead** set how much arrow shows on each side of the text. Untick it to keep arrows the length you drew them, with the text centred on them.

### Reagents and conditions on an arrow

When you draw a level reaction arrow, dotted boxes with a **+** appear above and below it for a few seconds. Click one and type the reagents or conditions; formulas such as K2CO3 get their subscripts as you type. When you finish, the text is lined up and (with fitting on) the arrow is sized to it. Afterwards, move the mouse just above or below an arrow that has no text on that side and the box comes back.

With an arrow selected, the **Reaction** section of the Style panel also has **Above arrow** and **Below arrow** boxes. Type and press Enter to set the text (Shift+Enter starts a new line); empty a box to remove that text. You can still click any reagent text to edit it by hand, drag it anywhere, and change its font, size or alignment like any caption.

## Warnings

Red boxes mark atoms with too many or too few bonds, labels that can't be read, and atoms sitting on top of each other. Point at one to see why. The **Warnings** panel on the right lists them all, with **Ignore** to hide one. **Show on drawing** turns the red boxes off. They are never printed, saved or copied.

Rest the mouse on an abbreviation or condensed label (OTBS, NHBoc, CO2Me, CH2OH) to see the group written out, with its name and formula. **View ▸ Group Tooltips** turns this off.

## Drawing styles

**File ▸ Drawing Style…** sets how structures are drawn in the tab showing: bond length, line, bold and margin widths, hash spacing, double bond spacing, chain angle, and the fonts and sizes of atom labels and captions.

- **Start from** picks a built-in style: **ACS Document 1996** (every ACS journal), **RSC**, **Nature journals**, or **Slides (ACS 1996 × 2)**. The line under it says where the numbers come from.
- Every number can be typed over. With **Change widths and font sizes with it** ticked, changing the bond length scales the rest in proportion.
- **Save as My Style** keeps your settings under a name, in every mode. **Delete** removes one of your own.
- When there are structures already, choose **Redraw the structures already there in the new style** or **Keep their look; only new structures use it**.
- Tick **Use this style for new drawings** to make every new drawing start in it.

Press **Apply**. One Undo puts everything back.

## Dark page

**View ▸ Dark Page**, or the eye button at the top, shows the page dark: black ink as light grey, white paper as dark grey, and pale fills dimmed. It changes the screen only; saved files, printing, copies and exports stay black on white. **View ▸ Dark Page Colours…** picks **Graphite**, **Slate** or **Warm dark**, or your own paper and ink colours.

![The same drawing with the dark page on](../images/dark-page.png)

## The Analysis panel

Select a structure and the **Analysis** panel on the right shows:

- its formula, exact mass and molecular weight;
- the m/z of the ion picked in the **Ion** box at the top of the panel ([M+H]+, [M+Na]+, [M−H]− and so on);
- elemental analysis (percentages);
- **Isotope pattern**: the peaks of that ion, drawn and listed (useful for Cl and Br);
- **Properties**: cLogP, molar refractivity, TPSA, H-bond donors and acceptors, rotatable bonds, heavy atoms, Fsp3, and estimated boiling and melting points (Joback method; treat these as rough guides);
- the structure's SMILES.

Buttons put text under the structure:

- **Attach descriptors**: the formula and masses, which follow the structure and update with it;
- **HRMS text**: an ACS-style line such as `HRMS (ESI) m/z: [M + H]+ Calcd for C8H11N4O2 195.0877; Found 000.0000.` Type your found value over the zeros;
- **Anal. text**: an ACS-style elemental analysis line.

Everything they insert is ordinary text you can change.

**Look up on PubChem** (needs the internet) sends the structure to PubChem, the free NIH database, and shows its common and IUPAC names, CAS number(s), its CID (click it to open the PubChem page), GHS hazards (signal word, pictograms and H statements) and measured physical data. **Name caption**, **CAS caption** and **Hazards caption** put that information under the structure. A structure is only sent when you click the button; nothing is looked up on its own.

## Mass fragmentation

Pick the mass fragmentation tool (the dashed line through a bond) and drag a line across one or more bonds, or click a single bond. A dashed line is drawn and each piece gets a caption with its formula and exact mass, placed clear of the structure. They are ordinary captions, so you can move or retype them.

## Pictures and tables

**Insert ▸ Picture…** puts a picture on the drawing (or drop a picture file on it). Drag a corner to resize it; it keeps its proportions unless you hold Alt. **Insert ▸ Crop Picture** crops it. **Insert ▸ Table…** adds an ACS-style table (rules above and below the heading row and under the last row) of the rows and columns you ask for; double-click a cell to type in it, and use the Style panel to change its lines, rows and columns.

## Colours and palettes

Every colour button opens a palette: Automatic, the standard colours, the colours already in the drawing, your own palettes, and **More colours…**. Atoms, bonds and whole structures can be coloured from the Style panel.

**Edit ▸ Colour Palettes…** makes rows of your own colours, which show in every colour menu in every mode. Start a **New palette**, add a ready-made row (colour-blind safe, greys, blues or warm), or make one from the drawing's colours.

## Toolboxes and My Toolbox

The **View** menu can show more toolboxes besides the drawing tools:

- **Toolbox: Structure**: Clean Up, frames, fills, highlights, terminal methyls, H atoms, aromatic circles, stereo labels, ID labels, captions, descriptors, Number Compounds, Contract Label and Name to Structure.
- **Toolbox: Object**: align, space evenly, flip, rotate, and bring to front or send to back.
- **Toolbox: Templates**: every template in one grid.
- **Toolbox: Colours**: pick **Colour**, **Highlight** or **Fill**, then click a swatch to apply it to the selection. Your palettes are there too.
- **Toolbox: My Toolbox**: the tools and commands you choose with **View ▸ Choose What Is in My Toolbox…**, which lists every tool and menu command with a search box.

To move a toolbox, unlock it first: click the padlock on its title bar (or right-click the toolbox and choose **Unlock**). Each toolbox locks on its own. **Locked** in the top bar (or **View ▸ Lock Toolboxes**) locks or unlocks them all at once. Then drag a toolbox by its title to the left, right, top or bottom edge of the drawing to dock it there, or anywhere else to float it. Right-click a toolbox's title for **Dock Left**, **Dock Right**, **Dock at the Top**, **Dock at the Bottom**, **Float** and more. The side panel (Style, Warnings, Analysis) is a toolbox too: it starts docked at the right, and moves, floats and locks like the others. Its arrow (or **View ▸ Fold Side Panel**) folds it to a strip, separately in each mode. The app remembers where you left them.

## The right-click menu

Right-click the drawing for a menu of what fits what you clicked. The names and keys match the top menus.

- **On a structure**: it is selected first (the whole structure), and the menu has Cut, Copy, Paste and Delete; **Copy As** (SMILES, molfile, CDXML text); **Clean Up Structure**; a **Structure** group (stereo labels, aromatic circles, terminal methyls, H atoms, Contract Label, Join, bond order, stereo groups, chiral flag, repeat brackets, R-group table, Check Structure, templates and nicknames, PubChem); **Scheme**; **Add Frame**; **Label the Structure**; **Scale…**; **Highlight and Fill**; **Align**; **Rotate or Flip**; and **View**.
- **On empty space**: Paste, Paste SMILES, Select All, Undo and Redo, an **Insert** group (Name to Structure, Periodic Table, Picture, Text Box), **Scheme**, **Drawing Style…** and **View**.

Right-drag still scrolls the drawing; the menu only opens when the mouse doesn't move.

---

Next: [Getting started](getting-started.md) · [Keyboard and mouse](keyboard-and-mouse.md) · [Slides](slides.md) · [Documents](documents.md) · [Sheets](sheets.md) · [Design](design.md) · [Files and sharing](files-and-sharing.md) · [Feedback](feedback.md)
