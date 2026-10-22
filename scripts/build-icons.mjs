// Builds the icon library's data (src/design/icons/mdi.json) from the Material Design Icons
// package (@mdi/svg, Apache-2.0, by Pictogrammers): each icon's name, the words to find it by,
// its groups and its outline (one SVG path on a 24 × 24 grid). Logos of companies and products
// are left out (they are trademarks), as are icons the set has retired.
// Runs automatically after `npm install` and before `npm run dev` / `npm run build`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = path.join(root, 'node_modules', '@mdi', 'svg');
const out = path.join(root, 'src', 'design', 'icons', 'mdi.json');
if (!fs.existsSync(path.join(pkg, 'meta.json'))) {
  console.error(`build-icons: ${pkg} is missing. Run "npm install" first.`);
  process.exit(1);
}
// changed when this script changes what it makes, so the data is made again
const BUILD = 3;
const version = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version;
if (fs.existsSync(out)) {
  try {
    const had = JSON.parse(fs.readFileSync(out, 'utf8'));
    if (had.build === BUILD && had.version === version) process.exit(0);
  } catch { /* remake it */ }
}

/** Trademarks: not shipped. */
const SKIP_TAGS = new Set(['Brand / Logo', 'Social Media']);

/** The library's own group for the lab: chemistry, safety and hazard signs, and lab and medical things. */
const LAB = 'Lab and science';
const LAB_TAGS = new Set(['Science', 'Medical / Hospital']);
const LAB_STEMS = /^(atom|beaker|flask|test-tube|molecule|dna|microscope|petri-dish|virus|bacteria|biohazard|radioactive|skull-crossbones|gas-cylinder|thermometer|eyedropper|magnet|mortar-pestle|bottle-tonic|pill|needle|iv-bag|chart-bell-curve|chart-scatter-plot)(-|$)/;
const LAB_NAMES = new Set(('fire fire-alert fire-extinguisher flash-triangle flash-triangle-outline lightning-bolt snowflake scale-balance water water-outline ' +
  'sine-wave alert alert-outline alert-octagon alert-rhombus exclamation-thick safety-goggles hand-wash lightbulb lightbulb-outline weight weight-gram ' +
  'timer-sand calculator recycle leaf sprout filter filter-outline pipe-valve valve pump spray-bottle cup-water glasses heart-pulse brain lungs ' +
  'stethoscope hospital-box').split(' '));

/** The lab group's order: these first, then the other science icons, then the rest of the group. */
const LAB_FIRST = ('flask flask-outline flask-empty flask-empty-outline flask-round-bottom flask-round-bottom-outline flask-round-bottom-empty ' +
  'flask-round-bottom-empty-outline beaker beaker-outline test-tube test-tube-empty eyedropper eyedropper-variant mortar-pestle ' +
  'gas-cylinder thermometer thermometer-lines scale-balance magnet microscope petri-dish atom atom-variant molecule molecule-co2 dna ' +
  'periodic-table ph orbit chart-bell-curve chart-scatter-plot sine-wave lightbulb lightbulb-outline lightning-bolt snowflake fire water ' +
  'biohazard radioactive radioactive-circle skull-crossbones skull-crossbones-outline flash-triangle flash-triangle-outline fire-alert ' +
  'alert alert-outline alert-rhombus alert-octagon exclamation-thick fire-extinguisher safety-goggles glasses hand-wash recycle ' +
  'bacteria bacteria-outline virus virus-outline pill needle iv-bag stethoscope heart-pulse brain lungs').split(' ');
/** More words to find lab icons by: the hazard each sign stands for, and lab names for glassware. */
const LAB_WORDS = {
  'flask': 'erlenmeyer conical', 'flask-outline': 'erlenmeyer conical', 'flask-empty': 'erlenmeyer conical', 'flask-empty-outline': 'erlenmeyer conical',
  'flask-round-bottom': 'rbf', 'flask-round-bottom-outline': 'rbf', 'flask-round-bottom-empty': 'rbf', 'flask-round-bottom-empty-outline': 'rbf',
  'eyedropper': 'pipette pasteur dropper', 'eyedropper-variant': 'pipette pasteur dropper', 'mortar-pestle': 'grind',
  'gas-cylinder': 'compressed gas hazard warning', 'scale-balance': 'weigh balance mass', 'thermometer': 'temperature',
  'biohazard': 'hazard biological warning', 'radioactive': 'hazard radiation warning', 'radioactive-circle': 'hazard radiation warning',
  'skull-crossbones': 'hazard toxic poison warning', 'skull-crossbones-outline': 'hazard toxic poison warning',
  'fire': 'hazard flammable warning', 'fire-alert': 'hazard flammable warning',
  'flash-triangle': 'hazard electrical high voltage warning', 'flash-triangle-outline': 'hazard electrical high voltage warning',
  'alert': 'hazard warning caution', 'alert-outline': 'hazard warning caution', 'alert-rhombus': 'hazard warning caution',
  'alert-octagon': 'hazard stop', 'exclamation-thick': 'hazard warning irritant', 'safety-goggles': 'eye protection ppe',
  'glasses': 'eye protection ppe', 'hand-wash': 'ppe wash hands', 'snowflake': 'cold cryogenic ice', 'lightning-bolt': 'electricity energy',
  'chart-bell-curve': 'gaussian peak distribution', 'sine-wave': 'wave spectrum light', 'periodic-table': 'elements',
};
const labRank = (name, tags) => {
  const i = LAB_FIRST.indexOf(name);
  return i >= 0 ? i : tags.includes('Science') ? 1000 : 2000;
};

const meta = JSON.parse(fs.readFileSync(path.join(pkg, 'meta.json'), 'utf8'));
const groups = [LAB];
const groupIndex = new Map([[LAB, 0]]);
const tagNames = [...new Set(meta.flatMap((m) => m.tags))].filter((t) => !SKIP_TAGS.has(t)).sort();
for (const t of tagNames) { groupIndex.set(t, groups.length); groups.push(t); }
const OTHER = groups.length;
groups.push('Other');

const icons = [];
for (const m of meta) {
  if (m.deprecated || m.tags.some((t) => SKIP_TAGS.has(t))) continue;
  const svg = fs.readFileSync(path.join(pkg, 'svg', `${m.name}.svg`), 'utf8');
  const d = /<path d="([^"]+)"/.exec(svg)?.[1];
  if (!d || (svg.match(/<path /g) ?? []).length !== 1) continue;
  const g = m.tags.map((t) => groupIndex.get(t));
  if (m.tags.some((t) => LAB_TAGS.has(t)) || LAB_STEMS.test(m.name) || LAB_NAMES.has(m.name)) g.unshift(0);
  if (!g.length) g.push(OTHER);
  // the words to find it by besides its name: its other names and its groups
  const words = [...new Set([...m.aliases.map((a) => a.replace(/-/g, ' ')), ...(LAB_WORDS[m.name] ? [LAB_WORDS[m.name]] : [])])].join(',');
  icons.push([m.name, g, words, d, g[0] === 0 ? labRank(m.name, m.tags) : 9999]);
}
// the lab icons first, in their order; then the rest by name
icons.sort((a, b) => a[4] - b[4] || (a[0] < b[0] ? -1 : 1));
for (const i of icons) i.length = 4;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ set: 'Material Design Icons', version, build: BUILD, groups, icons }));
console.log(`build-icons: ${icons.length} icons in ${groups.length} groups`);
