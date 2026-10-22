// File > New from Template, for sheets: our own starting points (a reaction optimization table
// and a reagent sheet with the yield worked out). Written here for this app; none is taken from
// another program's templates.

import { Workbook } from './workbook';
import { fillReagentTable } from './reagents';

export interface SheetTemplate {
  id: string;
  name: string;
  blurb: string;
  make(): Workbook;
}

const REACTION_HEADS = ['Entry', 'Substrate', 'Catalyst', 'Loading (mol %)', 'Ligand', 'Additive', 'Solvent', 'Conc. (M)', 'Temp (°C)', 'Time (h)', 'Conv. (%)', 'Yield (%)', 'ee (%)', 'dr', 'Notes'];
const REACTION_WIDTHS = [48, 110, 110, 104, 96, 96, 88, 72, 76, 64, 72, 70, 56, 52, 200];

/** A reaction optimization table: one row per entry, the best yield picked out. */
function reactionTable(): Workbook {
  const wb = new Workbook(['Optimization']);
  wb.build(() => {
    const sh = wb.sheets[0];
    REACTION_HEADS.forEach((h, c) => { sh.setInput(0, c, h); sh.setColWidth(c, REACTION_WIDTHS[c]); });
    const last = REACTION_HEADS.length - 1;
    sh.patchStyle({ r1: 0, c1: 0, r2: 0, c2: last }, { bold: true, wrap: true, borders: { bottom: { style: 'thin' } } });
    for (let r = 1; r <= 12; r++) sh.setInput(r, 0, String(r));
    sh.patchStyle({ r1: 1, c1: 0, r2: 12, c2: 0 }, { align: 'center' });
    sh.patchStyle({ r1: 1, c1: 3, r2: 12, c2: 13 }, { align: 'center' });
    sh.patchStyle({ r1: 12, c1: 0, r2: 12, c2: last }, { borders: { bottom: { style: 'thin' } } });
    sh.setInput(14, 0, 'Best yield');
    sh.setInput(14, 11, '=IF(COUNT(L2:L13)=0,"",MAX(L2:L13))');
    sh.setInput(15, 0, 'Best entry');
    sh.setInput(15, 11, '=IF(L15="","",INDEX(A2:A13,MATCH(L15,L2:L13,0)))');
    sh.patchStyle({ r1: 14, c1: 0, r2: 15, c2: 0 }, { bold: true });
    sh.patchStyle({ r1: 14, c1: 11, r2: 15, c2: 11 }, { bold: true, align: 'center' });
    sh.frozen = { rows: 1, cols: 1 };
  });
  return wb;
}

/** A reagent table (structures give MW; equivalents give amounts) and the yield worked out from it. */
function reagentSheet(): Workbook {
  const wb = new Workbook(['Reagents', 'Yield']);
  wb.build(() => {
    fillReagentTable(wb.sheets[0]);
    wb.sheets[0].frozen = { rows: 1, cols: 0 };
    const y = wb.sheets[1];
    const rows: [string, string, string?][] = [
      ['Product', ''],
      ['Product structure', ''],
      ['Product MW (g/mol)', '=IF(B2="","",MW(B2))', '0.00'],
      ['Limiting reagent (mmol)', '=Reagents!E2', '0.00'],
      ['Theoretical yield (mg)', '=IF(OR(B3="",B4=""),"",B3*B4)', '0.0'],
      ['Isolated mass (mg)', ''],
      ['Yield (%)', '=IF(OR(B6="",B5="",B5=0),"",100*B6/B5)', '0'],
    ];
    rows.forEach(([label, input, fmt], r) => {
      y.setInput(r, 0, label);
      if (input) y.setInput(r, 1, input);
      if (fmt) y.patchStyle({ r1: r, c1: 1, r2: r, c2: 1 }, { numFmt: fmt });
    });
    y.setInput(0, 2, 'Type the product\'s name in B1, draw or type its SMILES in B2, and its isolated mass in B6.');
    y.patchStyle({ r1: 0, c1: 0, r2: rows.length - 1, c2: 0 }, { bold: true });
    y.patchStyle({ r1: 6, c1: 1, r2: 6, c2: 1 }, { bold: true });
    y.setColWidth(0, 170);
    y.setColWidth(1, 160);
  });
  return wb;
}

export const SHEET_TEMPLATES: SheetTemplate[] = [
  { id: 'reaction-table', name: 'Reaction table', blurb: 'Optimization entries: catalyst, loading, solvent, temperature, time, conversion, yield, ee and dr, with the best entry found for you.', make: reactionTable },
  { id: 'reagent-sheet', name: 'Reagent sheet', blurb: 'MW from each structure, amounts from equivalents, masses and volumes, and the percent yield from the isolated mass.', make: reagentSheet },
];
