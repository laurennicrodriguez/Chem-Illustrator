// A reagent table, as chemists set one up before a reaction: each reagent's molecular weight
// comes from its structure, its amount from its equivalents and the limiting reagent's amount,
// and its mass and volume (from a density for a liquid, or a concentration for a solution) from
// those. Every worked-out value is an ordinary column formula, so any can be typed over.
//
// Units: mmol × g/mol = mg; mg ÷ (g/mL) = µL; mmol ÷ (mol/L) = mL, × 1000 = µL.

import type { Sheet } from './workbook';

export const REAGENT_HEADS = ['Reagent', 'Structure', 'MW (g/mol)', 'equiv', 'mmol', 'mass (mg)', 'density (g/mL)', 'conc. (M)', 'volume (µL)'];
// wide enough for each heading in the sheet's bold 11 pt (MW (g/mol), density (g/mL))
const WIDTHS = [140, 160, 96, 60, 70, 88, 112, 76, 96];

/** Lay out a reagent table on an empty sheet, with the limiting reagent (1 equiv, 1 mmol) in row 2. */
export function fillReagentTable(sh: Sheet): void {
  REAGENT_HEADS.forEach((h, c) => {
    sh.setInput(0, c, h);
    sh.setColWidth(c, WIDTHS[c]);
  });
  sh.patchStyle({ r1: 0, c1: 0, r2: 0, c2: REAGENT_HEADS.length - 1 }, { bold: true, borders: { bottom: { style: 'thin' } } });
  // the limiting reagent: its amount is typed in, and the others' follow from it
  sh.setInput(1, 0, 'limiting reagent');
  sh.setInput(1, 3, '1');
  sh.setInput(1, 4, '1');
  sh.patchStyle({ r1: 1, c1: 4, r2: 1, c2: 4 }, { numFmt: '0.00' });
  sh.setColDef(2, { formula: '=IF(B2="","",MW(B2))', firstRow: 1, style: { numFmt: '0.00' } });
  sh.setColDef(4, { formula: '=IF(D3="","",D3*$E$2/$D$2)', firstRow: 2, style: { numFmt: '0.00' } });
  sh.setColDef(5, { formula: '=IF(OR(C2="",E2=""),"",C2*E2)', firstRow: 1, style: { numFmt: '0.0' } });
  sh.setColDef(8, { formula: '=IF(G2<>"",IF(F2="","",F2/G2),IF(AND(H2<>"",E2<>""),1000*E2/H2,""))', firstRow: 1, style: { numFmt: '0' } });
}
