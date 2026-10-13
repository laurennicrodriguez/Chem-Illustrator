// Document drawing style: the handful of numbers that set the look of every drawing
// (ChemDraw User Guide pp. 40–42, 59). Values are in points.

export interface DocStyle {
  name: string;
  bondLength: number;
  lineWidth: number;
  boldWidth: number;
  /** Clearance around atom labels and at bond crossings. */
  marginWidth: number;
  hashSpacing: number;
  /** Distance between the lines of a double bond, as a percentage of bond length. */
  bondSpacing: number;
  chainAngle: number;
  labelFont: string;
  labelSize: number;
  captionFont: string;
  captionSize: number;
  /** How new captions look, as ChemDraw's face bits (1 bold, 2 italic, 4 underline, 96 formula). */
  captionFace: number;
}

export const ACS_1996: DocStyle = {
  name: 'ACS Document 1996',
  bondLength: 14.4,
  lineWidth: 0.6,
  boldWidth: 2,
  marginWidth: 1.6,
  hashSpacing: 2.5,
  bondSpacing: 18,
  chainAngle: 120,
  labelFont: 'Arial',
  labelSize: 10,
  captionFont: 'Arial',
  captionSize: 10,
  captionFace: 96,
};

export function doubleBondGap(s: DocStyle): number {
  return (s.bondSpacing / 100) * s.bondLength;
}

/** Width of a wedge's wide end: 1.5 × bold width (User Guide p. 41). */
export function wedgeWidth(s: DocStyle): number {
  return 1.5 * s.boldWidth;
}
