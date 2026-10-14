// Units for reaction conditions (°C, mol%, equiv, M…) as number formats. A cell formatted as a
// temperature shows −78 as "−78 °C" but keeps the number −78, so it still sorts, filters and
// works in formulas. The formats are ordinary Excel formats with the unit as quoted text, so
// Excel shows them the same way. Typing "-78 °C" (or "-78 C") into a cell also gives it the format.

export interface Unit {
  /** What the unit is for, as the ribbon's list and the side panel show it. */
  name: string;
  /** The unit as shown after the number. */
  unit: string;
  /** No space between the number and the unit ("95% ee"). */
  tight?: boolean;
  /** Decimal places when picked from the list. */
  decimals: number;
  /** Ways of typing the unit after a number. */
  typed: RegExp;
}

export const UNITS: Unit[] = [
  { name: 'Temperature', unit: '°C', decimals: 0, typed: /^(?:[°º˚]|o|deg ?)?C$/ },
  { name: 'Catalyst loading', unit: 'mol%', decimals: 0, typed: /^mol ?%$/i },
  { name: 'Equivalents', unit: 'equiv', decimals: 1, typed: /^(?:equiv|eq)\.?$/i },
  { name: 'Concentration', unit: 'M', decimals: 2, typed: /^M$/ },
  { name: 'Density', unit: 'g/mL', decimals: 2, typed: /^g ?\/ ?(?:mL|ml|cm3|cm³)$/ },
  { name: 'Amount', unit: 'mmol', decimals: 2, typed: /^mmol$/i },
  { name: 'Mass', unit: 'mg', decimals: 1, typed: /^mg$/ },
  { name: 'Volume', unit: 'mL', decimals: 2, typed: /^m[lL]$/ },
  { name: 'Small volume', unit: 'µL', decimals: 0, typed: /^[µμu]L$/i },
  { name: 'Time', unit: 'h', decimals: 0, typed: /^(?:h|hr|hrs|hours?)$/i },
  { name: 'Short time', unit: 'min', decimals: 0, typed: /^(?:min|mins|minutes?)$/i },
  { name: 'Pressure', unit: 'atm', decimals: 0, typed: /^atm$/i },
  { name: 'Enantiomeric excess', unit: '% ee', tight: true, decimals: 0, typed: /^% ?ee$/i },
];

/**
 * The number format for a unit: the number, then the unit, with a true minus sign (−78 °C, as
 * journals set it) for numbers below zero.
 */
export function unitFormat(u: Unit, decimals = u.decimals): string {
  const num = decimals > 0 ? `0.${'0'.repeat(decimals)}` : '0';
  const lit = `"${u.tight ? '' : ' '}${u.unit}"`;
  return `${num}${lit};"−"${num}${lit}`;
}

/** The unit a format shows, if it is one of these. */
export function unitOfFormat(code: string | undefined): Unit | null {
  if (!code) return null;
  const first = code.split(';')[0];
  const m = /^[0#?.,]+"\s?([^"]*)"$/.exec(first);
  return m ? UNITS.find((u) => u.unit === m[1]) ?? null : null;
}

/** A number typed with a unit after it ("-78 °C", "5 mol%", "1.2 equiv"): its value and format. */
export function readWithUnit(s: string): { value: number; format: string } | null {
  const m = /^([+\-−]?(?:\d+(?:\.\d*)?|\.\d+))\s*(\S.*)$/.exec(s);
  if (!m) return null;
  const u = UNITS.find((x) => x.typed.test(m[2].trim()));
  if (!u) return null;
  const num = m[1].replace('−', '-');
  const decimals = num.includes('.') ? num.split('.')[1].length : 0;
  return { value: Number(num), format: unitFormat(u, decimals) };
}
