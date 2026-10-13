// CDX, ChemDraw's binary format, which ChemDraw puts on the clipboard. CDX holds the same
// objects and properties as CDXML, so this converts between the two: copying writes our CDXML
// as CDX, and pasting turns ChemDraw's CDX into CDXML for the CDXML reader.
//
// Written from CambridgeSoft's published CDX format documentation, and checked against CDX
// files saved by ChemDraw 25; where the two disagree, this follows ChemDraw's files. A CDX file
// is a 28-byte header, then a tree of objects, each a 2-byte tag (top bit set), a 4-byte id, its
// properties and child objects, and two zero bytes. A property is a 2-byte tag, a 2-byte length
// and the data. Numbers are little-endian; coordinates are 1/65536 of a point.
//
// CDXML attributes with no known CDX property (chemical-property captions, sequence settings
// and so on) are left out of CDX; nothing that changes how the drawing looks depends on them.

// ---------------------------------------------------------------- objects

const OBJECTS: Record<string, number> = {
  page: 0x8001, group: 0x8002, fragment: 0x8003, n: 0x8004, b: 0x8005, t: 0x8006, graphic: 0x8007,
  curve: 0x8008, embeddedobject: 0x8009, altgroup: 0x800a, templategrid: 0x800b, regnum: 0x800c,
  scheme: 0x800d, step: 0x800e, spectrum: 0x8010, objecttag: 0x8011, sequence: 0x8013,
  crossreference: 0x8014, splitter: 0x8015, table: 0x8016, bracketedgroup: 0x8017,
  bracketattachment: 0x8018, crossingbond: 0x8019,
  // The documentation numbers the rest from 0x8020, skipping 0x801A to 0x801F, but ChemDraw's
  // numbers carry on without the gap: its CDX files store arrows as 0x8021, not 0x8027.
  border: 0x801a, geometry: 0x801b, constraint: 0x801c, tlcplate: 0x801d, tlclane: 0x801e,
  tlcspot: 0x801f, chemicalproperty: 0x8020, arrow: 0x8021,
};
const OBJECT_NAMES = new Map(Object.entries(OBJECTS).map(([k, v]) => [v, k]));

// ---------------------------------------------------------------- property types

type Kind =
  | 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'f64'
  | 'coord' | 'pt2' | 'pt3' | 'rect' | 'str' | 'id' | 'ids' | 'idsCounted' | 'i16list'
  | 'bool' | 'implied' | 'hex'
  | 'x10' | 'deg65536' // INT16 stored ×10 (bond spacing, arc angles); INT32 angle × 65536
  | 'x20' // line heights: UINT16 in 1/20 pt, with 0 and 1 kept for "variable" and "auto"
  | 'enum8' | 'enum16' | 'bits16'
  | 'side'; // the side of a double bond's second line (see DoublePosition below)

interface Prop { tag: number; kind: Kind; values?: Record<string, number> }

// Enumerations, CDXML name → CDX number, from the documentation's property pages.
const list = (...names: string[]) => Object.fromEntries(names.map((n, i) => [n, i]).filter(([n]) => n !== ''));
const DISPLAY = list('Solid', 'Dash', 'Hash', 'WedgedHashBegin', 'WedgedHashEnd', 'Bold', 'WedgeBegin', 'WedgeEnd', 'Wavy',
  'HollowWedgeBegin', 'HollowWedgeEnd', 'WavyWedgeBegin', 'WavyWedgeEnd', 'Dot', 'DashDot');
const JUSTIFY = { Right: -1, Left: 0, Center: 1, Full: 2, Above: 3, Below: 4, Auto: 5, Best: 6 };
const ALIGN = list('Auto', 'Left', 'Center', 'Right', 'Above', 'Below', 'Best');
const NODE_TYPE = list('Unspecified', 'Element', 'ElementList', 'ElementListNickname', 'Nickname', 'Fragment', 'Formula',
  'GenericNickname', 'AnonymousAlternativeGroup', 'NamedAlternativeGroup', 'MultiAttachment', 'VariableAttachment',
  'ExternalConnectionPoint', 'LinkNode');
const ORDER = {
  '1': 0x1, '2': 0x2, '3': 0x4, '4': 0x8, '5': 0x10, '6': 0x20, '0.5': 0x40, '1.5': 0x80, '2.5': 0x100, '3.5': 0x200,
  '4.5': 0x400, '5.5': 0x800, dative: 0x1000, ionic: 0x2000, hydrogen: 0x4000, threecenter: 0x8000,
};
// The side of a double bond's second line: 0 centre, 1 right, 2 left, plus 0x100 when the user
// chose the side. ChemDraw writes the side it picked itself too, but leaves those out of CDXML,
// so only sides the user chose are carried over.
const SIDES = ['Center', 'Right', 'Left'];
const USER_SIDE = 0x100;
// Arrowheads of `arrow` objects. The documentation names these properties but its pages for
// their values are missing. CDX files saved by ChemDraw 25 confirm Full = 2, Solid = 1 and
// fill None = 1; the other values are a best guess from the order of the names.
const HEAD = list('Unspecified', 'None', 'Full', 'HalfLeft', 'HalfRight');
const HEAD_TYPE = list('Unspecified', 'Solid', 'Hollow', 'Angle');
const FILL = list('Unspecified', 'None', 'Solid', 'Shaded', 'Gradient', 'Pattern');
const NOGO = list('Unspecified', 'None', 'Cross', 'Hash');

const P: Record<string, Prop> = {
  // general
  CreationUserName: { tag: 0x0001, kind: 'str' },
  CreationProgram: { tag: 0x0003, kind: 'str' },
  ModificationUserName: { tag: 0x0004, kind: 'str' },
  ModificationProgram: { tag: 0x0006, kind: 'str' },
  Name: { tag: 0x0008, kind: 'str' },
  Comment: { tag: 0x0009, kind: 'str' },
  Z: { tag: 0x000a, kind: 'i16' },
  RegistryNumber: { tag: 0x000b, kind: 'str' },
  RegistryAuthority: { tag: 0x000c, kind: 'str' },
  IgnoreWarnings: { tag: 0x000f, kind: 'implied' },
  Warning: { tag: 0x0010, kind: 'str' },
  Visible: { tag: 0x0011, kind: 'bool' },
  // the documentation says 0x0012; ChemDraw's files use 0x0013
  SupersededBy: { tag: 0x0013, kind: 'id' },
  // positions
  p: { tag: 0x0200, kind: 'pt2' },
  xyz: { tag: 0x0201, kind: 'pt3' },
  extent: { tag: 0x0202, kind: 'pt2' },
  BoundingBox: { tag: 0x0204, kind: 'rect' },
  RotationAngle: { tag: 0x0205, kind: 'deg65536' },
  BoundsInParent: { tag: 0x0206, kind: 'rect' },
  Head3D: { tag: 0x0207, kind: 'pt3' },
  Tail3D: { tag: 0x0208, kind: 'pt3' },
  TopLeft: { tag: 0x0209, kind: 'pt2' },
  TopRight: { tag: 0x020a, kind: 'pt2' },
  BottomRight: { tag: 0x020b, kind: 'pt2' },
  BottomLeft: { tag: 0x020c, kind: 'pt2' },
  Center3D: { tag: 0x020d, kind: 'pt3' },
  MajorAxisEnd3D: { tag: 0x020e, kind: 'pt3' },
  MinorAxisEnd3D: { tag: 0x020f, kind: 'pt3' },
  // colours
  color: { tag: 0x0301, kind: 'u16' },
  bgcolor: { tag: 0x0302, kind: 'i16' },
  FadePercent: { tag: 0x0303, kind: 'i16' }, // how faint an orbital is drawn (from ChemDraw's files)
  // atoms
  NodeType: { tag: 0x0400, kind: 'enum16', values: NODE_TYPE },
  LabelDisplay: { tag: 0x0401, kind: 'enum8', values: list('Auto', 'Left', 'Center', 'Right', 'Above', 'Below', 'BestInitial') },
  Element: { tag: 0x0402, kind: 'i16' },
  Isotope: { tag: 0x0420, kind: 'i16' },
  Charge: { tag: 0x0421, kind: 'i8' },
  Radical: { tag: 0x0422, kind: 'enum8', values: { None: 0, Singlet: 1, Doublet: 2, Triplet: 3 } }, // Singlet seen in ChemDraw's files
  FreeSites: { tag: 0x0423, kind: 'u8' },
  ImplicitHydrogens: { tag: 0x0424, kind: 'implied' },
  RingBondCount: { tag: 0x0425, kind: 'i8' },
  UnsaturatedBonds: { tag: 0x0426, kind: 'i8' },
  RxnChange: { tag: 0x0427, kind: 'implied' },
  AbnormalValence: { tag: 0x0429, kind: 'implied' },
  NumHydrogens: { tag: 0x042b, kind: 'u16' },
  HDot: { tag: 0x042e, kind: 'implied' },
  HDash: { tag: 0x042f, kind: 'implied' },
  Geometry: { tag: 0x0430, kind: 'enum8', values: { Tetrahedral: 7 } }, // the one value seen in ChemDraw's files
  BondOrdering: { tag: 0x0431, kind: 'ids' },
  Attachments: { tag: 0x0432, kind: 'idsCounted' },
  GenericNickname: { tag: 0x0433, kind: 'str' },
  AltGroupID: { tag: 0x0434, kind: 'id' },
  SubstituentsUpTo: { tag: 0x0435, kind: 'u8' },
  SubstituentsExactly: { tag: 0x0436, kind: 'u8' },
  AS: { tag: 0x0437, kind: 'enum8', values: list('U', 'N', 'R', 'S', 'r', 's', 'u') },
  AtomNumber: { tag: 0x0439, kind: 'str' },
  ShowAtomQuery: { tag: 0x043a, kind: 'bool' },
  ShowAtomStereo: { tag: 0x043b, kind: 'bool' },
  ShowAtomNumber: { tag: 0x043c, kind: 'bool' },
  LinkCountLow: { tag: 0x043d, kind: 'i16' },
  LinkCountHigh: { tag: 0x043e, kind: 'i16' },
  ExternalConnectionType: { tag: 0x0440, kind: 'enum8', values: list('Unspecified', 'Diamond', 'Star', 'PolymerBead', 'Wavy') },
  // not in the documentation; matched to CDXML in ChemDraw's files (one byte)
  ExternalConnectionNum: { tag: 0x044b, kind: 'u8' },
  // documented as present-means-yes, but ChemDraw 25 writes these with a yes/no byte
  ShowTerminalCarbonLabels: { tag: 0x0442, kind: 'bool' },
  ShowNonTerminalCarbonLabels: { tag: 0x0443, kind: 'bool' },
  HideImplicitHydrogens: { tag: 0x0444, kind: 'bool' },
  ShowAtomEnhancedStereo: { tag: 0x0445, kind: 'bool' },
  EnhancedStereoType: { tag: 0x0446, kind: 'u8' },
  EnhancedStereoGroupNum: { tag: 0x0447, kind: 'u16' },
  // not in the documentation; matched to CDXML in ChemDraw's files
  NeedsClean: { tag: 0x0448, kind: 'implied' },
  AtomID: { tag: 0x044d, kind: 'i32' },
  // fragments
  Racemic: { tag: 0x0500, kind: 'bool' },
  Absolute: { tag: 0x0501, kind: 'bool' },
  Relative: { tag: 0x0502, kind: 'bool' },
  Weight: { tag: 0x0504, kind: 'f64' },
  ConnectionOrder: { tag: 0x0505, kind: 'ids' },
  // bonds
  Order: { tag: 0x0600, kind: 'bits16', values: ORDER },
  Display: { tag: 0x0601, kind: 'enum16', values: DISPLAY },
  Display2: { tag: 0x0602, kind: 'enum16', values: DISPLAY },
  DoublePosition: { tag: 0x0603, kind: 'side' },
  B: { tag: 0x0604, kind: 'id' },
  E: { tag: 0x0605, kind: 'id' },
  BeginAttach: { tag: 0x0608, kind: 'u8' },
  EndAttach: { tag: 0x0609, kind: 'u8' },
  BS: { tag: 0x060a, kind: 'enum8', values: list('U', 'N', 'E', 'Z') },
  BondCircularOrdering: { tag: 0x060b, kind: 'ids' },
  ShowBondQuery: { tag: 0x060c, kind: 'bool' },
  ShowBondStereo: { tag: 0x060d, kind: 'bool' },
  CrossingBonds: { tag: 0x060e, kind: 'ids' },
  ShowBondRxn: { tag: 0x060f, kind: 'bool' },
  // text
  Justification: { tag: 0x0701, kind: 'enum8', values: JUSTIFY },
  LineHeight: { tag: 0x0702, kind: 'x20', values: { variable: 0, auto: 1 } },
  WordWrapWidth: { tag: 0x0703, kind: 'i16' },
  LineStarts: { tag: 0x0704, kind: 'i16list' },
  LabelAlignment: { tag: 0x0705, kind: 'enum8', values: ALIGN },
  LabelLineHeight: { tag: 0x0706, kind: 'x20', values: { variable: 0, auto: 1 } },
  CaptionLineHeight: { tag: 0x0707, kind: 'x20', values: { variable: 0, auto: 1 } },
  InterpretChemically: { tag: 0x0708, kind: 'bool' }, // a yes/no byte in ChemDraw 25's files
  // document and drawing settings
  PrintMargins: { tag: 0x0802, kind: 'rect' },
  ChainAngle: { tag: 0x0803, kind: 'deg65536' },
  BondSpacing: { tag: 0x0804, kind: 'x10' },
  BondLength: { tag: 0x0805, kind: 'coord' },
  BoldWidth: { tag: 0x0806, kind: 'coord' },
  LineWidth: { tag: 0x0807, kind: 'coord' },
  MarginWidth: { tag: 0x0808, kind: 'coord' },
  HashSpacing: { tag: 0x0809, kind: 'coord' },
  CaptionJustification: { tag: 0x080c, kind: 'enum8', values: JUSTIFY },
  FractionalWidths: { tag: 0x080d, kind: 'bool' }, // a yes/no byte in ChemDraw 25's files
  Magnification: { tag: 0x080e, kind: 'i16' },
  WidthPages: { tag: 0x080f, kind: 'i16' },
  HeightPages: { tag: 0x0810, kind: 'i16' },
  DrawingSpace: { tag: 0x0811, kind: 'enum8', values: { pages: 0, poster: 1 } },
  Width: { tag: 0x0812, kind: 'coord' },
  Height: { tag: 0x0813, kind: 'coord' },
  PageOverlap: { tag: 0x0814, kind: 'coord' },
  Header: { tag: 0x0815, kind: 'str' },
  HeaderPosition: { tag: 0x0816, kind: 'coord' },
  Footer: { tag: 0x0817, kind: 'str' },
  FooterPosition: { tag: 0x0818, kind: 'coord' },
  PrintTrimMarks: { tag: 0x0819, kind: 'implied' },
  LabelColor: { tag: 0x0820, kind: 'i16' },
  CaptionColor: { tag: 0x0821, kind: 'i16' },
  BondSpacingAbs: { tag: 0x0822, kind: 'coord' },
  LabelJustification: { tag: 0x0823, kind: 'enum8', values: JUSTIFY },
  WindowIsZoomed: { tag: 0x0900, kind: 'implied' },
  WindowPosition: { tag: 0x0901, kind: 'pt2' },
  WindowSize: { tag: 0x0902, kind: 'pt2' },
  // graphics
  GraphicType: { tag: 0x0a00, kind: 'enum16', values: list('Undefined', 'Line', 'Arc', 'Rectangle', 'Oval', 'Orbital', 'Bracket', 'Symbol') },
  LineType: { tag: 0x0a01, kind: 'bits16', values: { Solid: 0, Dashed: 1, Bold: 2, Wavy: 4 } },
  ArrowType: { tag: 0x0a02, kind: 'bits16', values: { NoHead: 0, HalfHead: 1, FullHead: 2, Resonance: 4, Equilibrium: 8, Hollow: 16, RetroSynthetic: 32, NoGo: 64, Dipole: 128 } },
  RectangleType: { tag: 0x0a03, kind: 'bits16', values: { Plain: 0, RoundEdge: 1, Shadow: 2, Shaded: 4, Filled: 8, Dashed: 16, Bold: 32 } },
  OvalType: { tag: 0x0a04, kind: 'bits16', values: { Plain: 0, Circle: 1, Shaded: 2, Filled: 4, Dashed: 8, Bold: 16, Shadowed: 32 } },
  BracketType: { tag: 0x0a06, kind: 'enum16', values: list('RoundPair', 'SquarePair', 'CurlyPair', 'Square', 'Curly', 'Round') },
  SymbolType: { tag: 0x0a07, kind: 'enum16', values: list('LonePair', 'Electron', 'RadicalCation', 'RadicalAnion', 'CirclePlus', 'CircleMinus', 'Dagger', 'DoubleDagger', 'Plus', 'Minus', 'Racemic', 'Absolute', 'Relative') },
  OrbitalType: { tag: 0x0a05, kind: 'enum16', values: { s: 0 } }, // only "s" (0) is confirmed
  CurveType: { tag: 0x0a08, kind: 'i16' },
  HeadSize: { tag: 0x0a20, kind: 'i16' },
  AngularSize: { tag: 0x0a21, kind: 'x10' },
  LipSize: { tag: 0x0a22, kind: 'i16' },
  BracketedObjectIDs: { tag: 0x0a27, kind: 'ids' },
  RepeatCount: { tag: 0x0a28, kind: 'f64' },
  ComponentOrder: { tag: 0x0a29, kind: 'i16' },
  SRULabel: { tag: 0x0a2a, kind: 'str' },
  GraphicID: { tag: 0x0a2b, kind: 'id' },
  BondID: { tag: 0x0a2c, kind: 'id' },
  InnerAtomID: { tag: 0x0a2d, kind: 'id' },
  ArrowheadType: { tag: 0x0a2f, kind: 'enum16', values: HEAD_TYPE },
  ArrowheadCenterSize: { tag: 0x0a30, kind: 'u16' },
  ArrowheadWidth: { tag: 0x0a31, kind: 'u16' },
  ShadowSize: { tag: 0x0a32, kind: 'u16' },
  ArrowShaftSpacing: { tag: 0x0a33, kind: 'u16' },
  ArrowEquilibriumRatio: { tag: 0x0a34, kind: 'u16' },
  ArrowheadHead: { tag: 0x0a35, kind: 'enum16', values: HEAD },
  ArrowheadTail: { tag: 0x0a36, kind: 'enum16', values: HEAD },
  FillType: { tag: 0x0a37, kind: 'enum16', values: FILL },
  Dipole: { tag: 0x0a3a, kind: 'bool' },
  NoGo: { tag: 0x0a3b, kind: 'enum8', values: NOGO },
  CornerRadius: { tag: 0x0a3c, kind: 'i16' },
  // reactions
  ReactionStepAtomMap: { tag: 0x0c00, kind: 'ids' },
  ReactionStepReactants: { tag: 0x0c01, kind: 'ids' },
  ReactionStepProducts: { tag: 0x0c02, kind: 'ids' },
  ReactionStepPlusses: { tag: 0x0c03, kind: 'ids' },
  ReactionStepArrows: { tag: 0x0c04, kind: 'ids' },
  ReactionStepObjectsAboveArrow: { tag: 0x0c05, kind: 'ids' },
  ReactionStepObjectsBelowArrow: { tag: 0x0c06, kind: 'ids' },
  ReactionStepAtomMapManual: { tag: 0x0c07, kind: 'ids' },
  ReactionStepAtomMapAuto: { tag: 0x0c08, kind: 'ids' },
  // object tags (stereo labels, and the paragraph styles Chem Illustrator keeps with a text);
  // the values are from ChemDraw's files. A String value is stored like any text, a Double as
  // FLOAT64 and a Long as INT32.
  TagType: { tag: 0x0d00, kind: 'enum16', values: { Unknown: 0, Double: 1, Long: 2, String: 3 } },
  Value: { tag: 0x0d05, kind: 'str' },
  PositioningType: { tag: 0x0d06, kind: 'enum8', values: { offset: 2 } },
  PositioningOffset: { tag: 0x0d08, kind: 'pt2' },
  // pictures: the picture data, as raw bytes in CDX and in hexadecimal in CDXML
  Edition: { tag: 0x0a60, kind: 'hex' },
  EditionAlias: { tag: 0x0a61, kind: 'hex' },
  MacPICT: { tag: 0x0a62, kind: 'hex' },
  WindowsMetafile: { tag: 0x0a63, kind: 'hex' },
  OLEObject: { tag: 0x0a64, kind: 'hex' },
  EnhancedMetafile: { tag: 0x0a65, kind: 'hex' },
  GIF: { tag: 0x0a6e, kind: 'hex' },
  TIFF: { tag: 0x0a6f, kind: 'hex' },
  PNG: { tag: 0x0a70, kind: 'hex' },
  JPEG: { tag: 0x0a71, kind: 'hex' },
  BMP: { tag: 0x0a72, kind: 'hex' },
  BasisObjects: { tag: 0x0b82, kind: 'ids' },
  ChemicalPropertyDisplayID: { tag: 0x0bb1, kind: 'id' },
  ChemicalPropertyIsActive: { tag: 0x0bb2, kind: 'bool' },
};
const BY_TAG = new Map(Object.entries(P).map(([name, p]) => [p.tag, [name, p] as const]));

const TAG_TEXT = 0x0700;
// The same text in UTF-8, which ChemDraw 25 writes after the single-byte text (not in the
// documentation). Its style runs start at byte offsets, and LineStarts count its bytes.
const TAG_UTF8_TEXT = 0x0709;
const TAG_FONTTABLE = 0x0100;
const TAG_COLORTABLE = 0x0300;
const TAG_REPRESENT = 0x000e;
const TAG_LABELSTYLE = 0x080a;
const TAG_CAPTIONSTYLE = 0x080b;
// The header as ChemDraw writes it: "VjCD0100", 04 03 02 01, ten zero bytes, and the document
// object's tag (0x8000) and id (0), which the documentation counts as reserved bytes.
const HEADER = [0x56, 0x6a, 0x43, 0x44, 0x30, 0x31, 0x30, 0x30, 0x04, 0x03, 0x02, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x80, 0, 0, 0, 0];

// Font character sets: Windows code page ↔ CDXML name.
const CHARSETS: Record<string, number> = {
  Unknown: 0, 'iso-8859-1': 1252, 'x-mac-roman': 10000, 'shift_jis': 932, 'gb2312': 936, 'ks_c_5601-1987': 949, 'big5': 950,
  'windows-1250': 1250, 'windows-1251': 1251, 'windows-1253': 1253, 'windows-1254': 1254, 'windows-1255': 1255,
  'windows-1256': 1256, 'windows-1257': 1257, 'windows-1258': 1258, 'utf-16': 1200,
};
const CHARSET_NAMES = new Map(Object.entries(CHARSETS).map(([k, v]) => [v, k]));

// ---------------------------------------------------------------- text encoding

// CDX text is single-byte (Windows code page 1252, ChemDraw's Western-language encoding).
const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';

function encode1252(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c === 0x0a) out.push(0x0d); // CDX ends lines with a carriage return
    else if (c < 0x80 || (c >= 0xa0 && c < 0x100)) out.push(c);
    else {
      const i = CP1252_HIGH.indexOf(ch);
      out.push(i >= 0 ? 0x80 + i : 0x3f); // '?' for characters CDX cannot hold
    }
  }
  return Uint8Array.from(out);
}

function decode1252(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b === 0x0d ? '\n' : b >= 0x80 && b < 0xa0 ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b);
  return s;
}

/** Character offsets (as older CDX counts LineStarts) → UTF-8 byte offsets (as CDXML does). */
function charsToUtf8(text: string, offsets: number[]): number[] {
  const ends: number[] = [0];
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    ends.push(bytes);
  }
  return offsets.map((o) => ends[Math.min(o, ends.length - 1)]);
}

// ---------------------------------------------------------------- numbers

const nums = (v: string) => v.trim().split(/[\s,]+/).filter(Boolean).map(Number);
const fix = (x: number) => Math.round(x * 65536);
/** A number as CDXML writes it: up to two decimals, no trailing zeros. */
const fmt = (x: number) => {
  const s = (Math.round(x * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};

class Bytes {
  private buf = new Uint8Array(1 << 16);
  private view = new DataView(this.buf.buffer);
  len = 0;
  private room(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const b = new Uint8Array(size);
    b.set(this.buf.subarray(0, this.len));
    this.buf = b;
    this.view = new DataView(b.buffer);
  }
  u8(v: number): void { this.room(1); this.view.setUint8(this.len, v & 0xff); this.len += 1; }
  u16(v: number): void { this.room(2); this.view.setUint16(this.len, v & 0xffff, true); this.len += 2; }
  i32(v: number): void { this.room(4); this.view.setInt32(this.len, v | 0, true); this.len += 4; }
  u32(v: number): void { this.room(4); this.view.setUint32(this.len, v >>> 0, true); this.len += 4; }
  f64(v: number): void { this.room(8); this.view.setFloat64(this.len, v, true); this.len += 8; }
  bytes(b: ArrayLike<number>): void { this.room(b.length); this.buf.set(b, this.len); this.len += b.length; }
  done(): Uint8Array { return this.buf.slice(0, this.len); }
}

// ---------------------------------------------------------------- CDXML → CDX

/** The data of one property, from its CDXML attribute value; null when it cannot be written. */
function encodeValue(p: Prop, v: string): Uint8Array | null {
  const b = new Bytes();
  const n = nums(v);
  const int = (x: number) => Math.round(x);
  const named = p.values?.[v];
  switch (p.kind) {
    case 'i8': case 'u8': if (!Number.isFinite(n[0])) return null; b.u8(int(n[0])); break;
    case 'i16': case 'u16':
      if (named !== undefined) b.u16(named);
      else if (Number.isFinite(n[0])) b.u16(int(n[0]));
      else return null;
      break;
    case 'i32': case 'u32': if (!Number.isFinite(n[0])) return null; b.i32(int(n[0])); break;
    case 'f64': if (!Number.isFinite(n[0])) return null; b.f64(n[0]); break;
    case 'x10': if (!Number.isFinite(n[0])) return null; b.u16(int(n[0] * 10)); break;
    case 'x20':
      // ChemDraw 25 saves a 17.25 pt line height as 345
      if (named !== undefined) b.u16(named);
      else if (Number.isFinite(n[0])) b.u16(Math.max(2, int(n[0] * 20)));
      else return null;
      break;
    case 'deg65536': if (!Number.isFinite(n[0])) return null; b.i32(fix(n[0])); break;
    case 'coord': if (!Number.isFinite(n[0])) return null; b.i32(fix(n[0])); break;
    case 'pt2': if (n.length < 2) return null; b.i32(fix(n[1])); b.i32(fix(n[0])); break;
    // unlike 2D points, ChemDraw stores 3D points x first (the documentation says z first)
    case 'pt3': if (n.length < 2) return null; b.i32(fix(n[0])); b.i32(fix(n[1])); b.i32(fix(n[2] ?? 0)); break;
    case 'rect': if (n.length < 4) return null; b.i32(fix(n[1])); b.i32(fix(n[0])); b.i32(fix(n[3])); b.i32(fix(n[2])); break;
    case 'str': b.u16(0); b.bytes(encode1252(v)); break;
    case 'id': if (!Number.isFinite(n[0])) return null; b.u32(n[0]); break;
    case 'ids': for (const x of n) b.u32(x); break;
    case 'idsCounted': b.u16(n.length); for (const x of n) b.u32(x); break;
    case 'i16list': b.u16(n.length); for (const x of n) b.u16(x); break;
    case 'bool': if (v !== 'yes' && v !== 'no') return null; b.u8(v === 'yes' ? 1 : 0); break;
    case 'implied': if (v !== 'yes') return null; break;
    case 'hex': for (let i = 0; i + 1 < v.length; i += 2) b.u8(parseInt(v.slice(i, i + 2), 16)); break;
    case 'enum8': if (named === undefined) return null; b.u8(named); break;
    case 'enum16': if (named === undefined) return null; b.u16(named); break;
    case 'side': {
      const i = SIDES.indexOf(v);
      if (i < 0) return null;
      b.u16(USER_SIDE | i);
      break;
    }
    case 'bits16': {
      let bits = 0;
      for (const word of v.split(/\s+/)) {
        const x = p.values![word];
        if (x === undefined) return null;
        bits |= x;
      }
      b.u16(bits);
      break;
    }
  }
  return b.done();
}

function writeProp(out: Bytes, tag: number, data: ArrayLike<number>): void {
  out.u16(tag);
  if (data.length > 0xfffe) { out.u16(0xffff); out.u32(data.length); }
  else out.u16(data.length);
  out.bytes(data);
}

const kids = (e: Element) => {
  const out: Element[] = [];
  for (let c = e.firstElementChild; c; c = c.nextElementSibling) out.push(c);
  return out;
};

/** A font style: font id, face bits, size in twentieths of a point, colour index. */
function fontStyle(font: string | null, face: string | null, size: string | null, color: string | null): Uint8Array {
  const b = new Bytes();
  const num = (v: string | null, k = 1) => (v === null || !Number.isFinite(Number(v)) ? 0xffff : Math.round(Number(v) * k));
  b.u16(num(font));
  b.u16(num(face));
  b.u16(num(size, 20));
  b.u16(color === null ? 3 : num(color));
  return b.done();
}

/** The properties of one CDXML element. */
function writeAttributes(out: Bytes, e: Element, skip: Set<string> = new Set()): void {
  for (const a of Array.from(e.attributes)) {
    if (a.name === 'id' || skip.has(a.name)) continue;
    const p = P[a.name];
    if (!p) continue;
    let v = a.value;
    if (a.name === 'LineStarts') continue; // written with the text, in CDX's character offsets
    if (a.name === 'Charge' && !Number.isFinite(Number(v))) continue;
    // ChemDraw stores an object tag's name as plain text, without the style-run count
    const tagType = e.nodeName === 'objecttag' && a.name === 'Value' ? e.getAttribute('TagType') : null;
    const data = tagType === 'Double' || tagType === 'Long' ? encodeValue({ ...p, kind: tagType === 'Double' ? 'f64' : 'i32' }, v)
      : p.kind === 'str' && e.nodeName === 'objecttag' && a.name !== 'Value' ? encode1252(v) : encodeValue(p, v);
    if (data) writeProp(out, p.tag, data);
  }
}

const utf8 = new TextEncoder();

/** A text's runs and characters, as single-byte text and again as UTF-8, as ChemDraw 25 does. */
function writeText(out: Bytes, t: Element): void {
  const runs = kids(t).filter((s) => s.nodeName === 's');
  const styles = runs.map((s) => fontStyle(s.getAttribute('font'), s.getAttribute('face') ?? '0', s.getAttribute('size'), s.getAttribute('color')));
  const parts = runs.map((s) => s.textContent ?? '');
  const text = parts.join('');
  for (const wide of [false, true]) {
    const b = new Bytes();
    b.u16(runs.length);
    let at = 0;
    parts.forEach((part, i) => {
      b.u16(at);
      b.bytes(styles[i]);
      at += wide ? utf8.encode(part).length : [...part].length;
    });
    b.bytes(wide ? utf8.encode(text.replace(/\n/g, '\r')) : encode1252(text));
    writeProp(out, wide ? TAG_UTF8_TEXT : TAG_TEXT, b.done());
  }
  // LineStarts count UTF-8 bytes, as in CDXML
  const ls = t.getAttribute('LineStarts');
  if (ls) {
    const l = new Bytes();
    const ends = nums(ls);
    l.u16(ends.length);
    for (const x of ends) l.u16(x);
    writeProp(out, P.LineStarts.tag, l.done());
  }
}

function writeObject(out: Bytes, e: Element): void {
  const tag = OBJECTS[e.nodeName];
  if (tag === undefined) return; // not part of the drawing's objects (or unknown to CDX)
  out.u16(tag);
  out.u32(Number(e.getAttribute('id')) || 0);
  writeAttributes(out, e);
  if (e.nodeName === 't') writeText(out, e);
  for (const c of kids(e)) {
    if (c.nodeName === 'represent') {
      const p = P[c.getAttribute('attribute') ?? ''];
      const id = Number(c.getAttribute('object'));
      if (!p || !Number.isFinite(id)) continue;
      const b = new Bytes();
      b.u32(id);
      b.u16(p.tag);
      writeProp(out, TAG_REPRESENT, b.done());
    } else writeObject(out, c);
  }
  out.u16(0);
}

/** A CDXML document as CDX. */
export function cdxmlToCdx(xml: string): Uint8Array {
  const root = new DOMParser().parseFromString(xml.replace(/<!DOCTYPE[^>]*>/i, ''), 'application/xml').documentElement;
  if (!root || root.nodeName !== 'CDXML') throw new Error('not a CDXML document');
  const out = new Bytes();
  out.bytes(HEADER);
  // the document's own properties follow the header directly
  const styles = ['LabelFont', 'LabelSize', 'LabelFace', 'CaptionFont', 'CaptionSize', 'CaptionFace'];
  writeAttributes(out, root, new Set(styles));
  const at = (k: string) => root.getAttribute(k);
  if (at('LabelFont') || at('LabelSize') || at('LabelFace')) writeProp(out, TAG_LABELSTYLE, fontStyle(at('LabelFont'), at('LabelFace') ?? '0', at('LabelSize'), null));
  if (at('CaptionFont') || at('CaptionSize') || at('CaptionFace')) writeProp(out, TAG_CAPTIONSTYLE, fontStyle(at('CaptionFont'), at('CaptionFace') ?? '0', at('CaptionSize'), null));
  for (const c of kids(root)) {
    if (c.nodeName === 'colortable') {
      const colors = kids(c).filter((k) => k.nodeName === 'color');
      const b = new Bytes();
      b.u16(colors.length);
      for (const k of colors) for (const ch of ['r', 'g', 'b']) b.u16(Math.round(Math.max(0, Math.min(1, Number(k.getAttribute(ch) ?? 0))) * 65535));
      writeProp(out, TAG_COLORTABLE, b.done());
    } else if (c.nodeName === 'fonttable') {
      const fonts = kids(c).filter((k) => k.nodeName === 'font');
      const b = new Bytes();
      b.u16(0); // as ChemDraw for Windows writes it
      b.u16(fonts.length);
      for (const f of fonts) {
        const name = encode1252(f.getAttribute('name') ?? '');
        b.u16(Number(f.getAttribute('id')) || 0);
        b.u16(CHARSETS[f.getAttribute('charset') ?? ''] ?? 0);
        b.u16(name.length);
        b.bytes(name);
      }
      writeProp(out, TAG_FONTTABLE, b.done());
    }
  }
  for (const c of kids(root)) writeObject(out, c);
  out.u16(0);
  return out.done();
}

// ---------------------------------------------------------------- CDX → CDXML

interface Node { name: string; attrs: [string, string][]; children: Node[]; text?: string }

class Reader {
  private v: DataView;
  at = 0;
  constructor(private b: Uint8Array) { this.v = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  get left(): number { return this.b.length - this.at; }
  u16(): number { this.need(2); const x = this.v.getUint16(this.at, true); this.at += 2; return x; }
  u32(): number { this.need(4); const x = this.v.getUint32(this.at, true); this.at += 4; return x; }
  take(n: number): Uint8Array { this.need(n); this.at += n; return this.b.subarray(this.at - n, this.at); }
  private need(n: number): void { if (this.at + n > this.b.length) throw new Error('The ChemDraw data is cut short'); }
}

/** A property's value as CDXML writes it; null to leave it out. */
function decodeValue(p: Prop, d: Uint8Array): string | null {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const len = d.length;
  // documented quirk: some integers were written with the wrong size, so read by length
  const int = (signed: boolean) => (len >= 4 ? (signed ? v.getInt32(0, true) : v.getUint32(0, true)) : len >= 2 ? (signed ? v.getInt16(0, true) : v.getUint16(0, true)) : len >= 1 ? (signed ? v.getInt8(0) : v.getUint8(0)) : null);
  const name = (x: number | null) => {
    if (x === null) return null;
    for (const [k, n] of Object.entries(p.values ?? {})) if (n === x) return k;
    return null;
  };
  const i32 = (k: number) => v.getInt32(k * 4, true) / 65536;
  switch (p.kind) {
    case 'i8': case 'i16': case 'i32': {
      // ChemDraw 8 saved charges in four bytes, with the charge in the top byte
      const x = p.tag === 0x0421 && len === 4 ? v.getInt32(0, true) >> 24 : int(true);
      return x === null ? null : name(x) ?? String(x);
    }
    case 'u8': case 'u16': case 'u32': {
      const x = int(false);
      return x === null ? null : name(x) ?? String(x);
    }
    case 'f64': return len >= 8 ? String(v.getFloat64(0, true)) : null;
    case 'x10': { const x = int(true); return x === null ? null : fmt(x / 10); }
    case 'x20': { const x = int(false); return x === null ? null : name(x) ?? fmt(x / 20); }
    case 'deg65536': case 'coord': return len >= 4 ? fmt(i32(0)) : null;
    case 'pt2': return len >= 8 ? `${fmt(i32(1))} ${fmt(i32(0))}` : null;
    case 'pt3': return len >= 12 ? `${fmt(i32(0))} ${fmt(i32(1))} ${fmt(i32(2))}` : null;
    case 'rect': return len >= 16 ? `${fmt(i32(1))} ${fmt(i32(0))} ${fmt(i32(3))} ${fmt(i32(2))}` : null;
    case 'str': {
      const runs = len >= 2 ? v.getUint16(0, true) : 0;
      // an object tag's name has no style-run count in front (as ChemDraw writes it)
      if (len < 2 || 2 + runs * 10 > len) return decode1252(d);
      return decode1252(d.subarray(2 + runs * 10));
    }
    case 'id': return len >= 4 ? String(v.getUint32(0, true)) : null;
    case 'ids': return Array.from({ length: len >> 2 }, (_, i) => v.getUint32(i * 4, true)).join(' ');
    case 'idsCounted': {
      if (len < 2) return null;
      const n = Math.min(v.getUint16(0, true), (len - 2) >> 2);
      return Array.from({ length: n }, (_, i) => v.getUint32(2 + i * 4, true)).join(' ');
    }
    case 'i16list': {
      if (len < 2) return null;
      const n = Math.min(v.getUint16(0, true), (len - 2) >> 1);
      return Array.from({ length: n }, (_, i) => v.getUint16(2 + i * 2, true)).join(' ');
    }
    case 'bool': return len ? (d[0] ? 'yes' : 'no') : null;
    // present means yes, unless ChemDraw wrote a yes/no byte
    case 'implied': return len && !d[0] ? 'no' : 'yes';
    case 'hex': return Array.from(d, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join('');
    case 'enum8': case 'enum16': return name(int(true));
    case 'side': {
      const x = int(false);
      return x !== null && x & USER_SIDE ? SIDES[x & 0xff] ?? null : null;
    }
    case 'bits16': {
      const x = int(false);
      if (x === null || x === 0xffff) return null;
      const vals = Object.entries(p.values!);
      if (x === 0) return vals.find(([, n]) => n === 0)?.[0] ?? null;
      const words = vals.filter(([, n]) => n && (x & n) === n).map(([k]) => k);
      return words.length ? words.join(' ') : null;
    }
  }
}

function readFontStyle(d: Uint8Array): { font: number; face: number; size: number; color: number } | null {
  if (d.length < 8) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return { font: v.getUint16(0, true), face: v.getUint16(2, true), size: v.getUint16(4, true), color: v.getUint16(6, true) };
}

function readObject(r: Reader, name: string, id: number): Node {
  const node: Node = { name, attrs: id ? [['id', String(id)]] : [], children: [] };
  let lineStarts: number[] | null = null;
  let single: Uint8Array | null = null, wide: Uint8Array | null = null;
  for (;;) {
    const tag = r.u16();
    if (tag === 0) break;
    if (tag & 0x8000) {
      const childId = r.u32();
      const child = readObject(r, OBJECT_NAMES.get(tag) ?? '', childId);
      if (child.name) node.children.push(child);
      continue;
    }
    let len = r.u16();
    if (len === 0xffff) len = r.u32();
    const d = r.take(len);
    if (tag === TAG_TEXT && len >= 2) { single = d; continue; }
    if (tag === TAG_UTF8_TEXT && len >= 2) { wide = d; continue; }
    if (tag === P.LineStarts.tag) {
      const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
      const n = len >= 2 ? Math.min(v.getUint16(0, true), (len - 2) >> 1) : 0;
      lineStarts = Array.from({ length: n }, (_, i) => v.getUint16(2 + i * 2, true));
      continue;
    }
    if (tag === TAG_LABELSTYLE || tag === TAG_CAPTIONSTYLE) {
      const s = readFontStyle(d);
      const pre = tag === TAG_LABELSTYLE ? 'Label' : 'Caption';
      if (s) {
        if (s.font !== 0xffff) node.attrs.push([pre + 'Font', String(s.font)]);
        if (s.size !== 0xffff) node.attrs.push([pre + 'Size', fmt(s.size / 20)]);
        if (s.face !== 0xffff) node.attrs.push([pre + 'Face', String(s.face)]);
      }
      continue;
    }
    if (tag === TAG_REPRESENT && len >= 6) {
      const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
      const prop = BY_TAG.get(v.getUint16(4, true));
      if (prop) node.children.push({ name: 'represent', attrs: [['attribute', prop[0]], ['object', String(v.getUint32(0, true))]], children: [] });
      continue;
    }
    if (tag === TAG_COLORTABLE && len >= 2) {
      const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
      const n = Math.min(v.getUint16(0, true), Math.floor((len - 2) / 6));
      const table: Node = { name: 'colortable', attrs: [], children: [] };
      for (let i = 0; i < n; i++) {
        const c = (k: number) => String(Math.round((v.getUint16(2 + i * 6 + k * 2, true) / 65535) * 10000) / 10000);
        table.children.push({ name: 'color', attrs: [['r', c(0)], ['g', c(1)], ['b', c(2)]], children: [] });
      }
      node.children.unshift(table);
      continue;
    }
    if (tag === TAG_FONTTABLE && len >= 4) {
      const fr = new Reader(d);
      fr.u16(); // Mac or Windows names
      const n = fr.u16();
      const table: Node = { name: 'fonttable', attrs: [], children: [] };
      for (let i = 0; i < n && fr.left >= 6; i++) {
        const fid = fr.u16(), cs = fr.u16(), nl = fr.u16();
        const fname = decode1252(fr.take(Math.min(nl, fr.left)));
        table.children.push({ name: 'font', attrs: [['id', String(fid)], ['charset', CHARSET_NAMES.get(cs) ?? 'iso-8859-1'], ['name', fname]], children: [] });
      }
      node.children.splice(node.children[0]?.name === 'colortable' ? 1 : 0, 0, table);
      continue;
    }
    const known = BY_TAG.get(tag);
    if (!known) continue;
    let prop = known[1];
    if (known[0] === 'Value' && name === 'objecttag') {
      const type = node.attrs.find(([k]) => k === 'TagType')?.[1];
      if (type === 'Double' || type === 'Long') prop = { ...prop, kind: type === 'Double' ? 'f64' : 'i32' };
    }
    const value = decodeValue(prop, d);
    if (value !== null) node.attrs.push([known[0], value]);
  }
  // the text and its style runs become <s> children; the UTF-8 copy keeps every character
  const d = wide ?? single;
  if (d) {
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const n = Math.min(v.getUint16(0, true), Math.floor((d.length - 2) / 10));
    const body = d.subarray(2 + n * 10);
    const runs = Array.from({ length: n }, (_, i) => ({ start: v.getUint16(2 + i * 10, true), style: readFontStyle(d.subarray(4 + i * 10, 12 + i * 10))! }));
    if (!runs.length) runs.push({ start: 0, style: { font: 0xffff, face: 0, size: 0xffff, color: 0xffff } });
    // single-byte runs start at character offsets (one byte each), UTF-8 runs at byte offsets
    const piece = (a: number, b: number) => (wide ? new TextDecoder().decode(body.subarray(a, b)).replace(/\r/g, '\n') : decode1252(body.subarray(a, b)));
    let text = '';
    runs.forEach((run, i) => {
      const s = run.style;
      const attrs: [string, string][] = [];
      if (s.font !== 0xffff) attrs.push(['font', String(s.font)]);
      if (s.size !== 0xffff) attrs.push(['size', fmt(s.size / 20)]);
      if (s.color !== 0xffff) attrs.push(['color', String(s.color)]);
      if (s.face !== 0xffff) attrs.push(['face', String(s.face)]);
      const part = piece(Math.min(run.start, body.length), i + 1 < runs.length ? Math.min(runs[i + 1].start, body.length) : body.length);
      node.children.push({ name: 's', attrs, children: [], text: part });
      text += part;
    });
    // LineStarts count UTF-8 bytes in CDXML; older CDX without the UTF-8 copy counts characters
    if (lineStarts) node.attrs.push(['LineStarts', (wide ? lineStarts : charsToUtf8(text, lineStarts)).join(' ')]);
  }
  return node;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escAttr = (s: string) => esc(s).replace(/\n/g, '&#10;').replace(/\r/g, '&#13;').replace(/\t/g, '&#9;');

function toXml(n: Node, out: string[]): void {
  out.push('<', n.name);
  for (const [k, v] of n.attrs) out.push(' ', k, '="', escAttr(v), '"');
  if (!n.children.length && n.name !== 's') { out.push('/>'); return; }
  out.push('>');
  if (n.name === 's') out.push(esc(n.text ?? ''));
  for (const c of n.children) toXml(c, out);
  out.push('</', n.name, '>');
}

/** True when the bytes look like CDX (with or without the file header). */
export function isCdx(b: Uint8Array): boolean {
  return b.length >= 8 && HEADER.slice(0, 8).every((x, i) => b[i] === x);
}

/** CDX data (a file, or ChemDraw's clipboard data) as a CDXML document. */
export function cdxToCdxml(data: Uint8Array): string {
  const r = new Reader(data);
  if (isCdx(data)) r.take(HEADER.length);
  // the documentation allows the document object's own tag and id after the header
  if (r.left >= 6 && new DataView(data.buffer, data.byteOffset + r.at, 2).getUint16(0, true) === 0x8000) { r.u16(); r.u32(); }
  const root = readObject(r, 'CDXML', 0);
  const out = ['<?xml version="1.0" encoding="UTF-8" ?>\n'];
  toXml(root, out);
  return out.join('');
}
