/**
 * Essential Macleod .dds design reader checks.
 *
 *  1. A four-layer AR in the shipped file layout: media, reference
 *     wavelength, full-wave optical thickness kept for later conversion,
 *     layer 1 next to the incident medium, formula and symbols, notes.
 *  2. Physical thickness files, locks, a numeric material, a µm database and
 *     the single-line XML layout.
 *  3. The wavelength unit block: its own <Unit> child in either position, a
 *     <Parameters> tag with attributes, and a file with no unit block.
 *  4. Rejections, packing density (the program's rugate mechanism) among them.
 *  5. The program's material database: every name it holds is embedded, read
 *     under the database's unit and the program's linear rule, matched without
 *     regard to case, and converts the optical thicknesses on build; a name it
 *     does not hold, an unreadable file and an eV database are passed over.
 *  6. Maintainer-only: every shipped sample design parses.
 *
 * Run: node tests/macleod_design.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseMacleodDesign, isConstantIndexName } from '../src/utils/io/designImport/macleodDesign.js';
import { buildImportedDesign } from '../src/utils/io/designImport/buildDesign.js';
import { makeGetNK } from '../src/utils/materials/catalogManager/dispersion.js';
import { getLocale } from '../src/constants/locales.js';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg} (${a} vs ${b}, tol ${tol})`);

const unit = (scale, name) => `<Unit Name="Wavelength"><Format>####0.00</Format><Name>Wavelength</Name><ScaleFactor> ${scale}</ScaleFactor><Unit>${name}</Unit></Unit>`;
const layer = (i, material, thickness, over = {}) => {
    const f = { PackingDensity: ' 1', VoidMaterial: 'Air', VoidDensity: ' 0', Link: '0', Lock: 'No', ...over };
    const tags = Object.entries(f).map(([k, v]) => `<${k}>${v}</${k}>`).join('');
    return `<Layer LayerNumber="${i}"><Material>${material}</Material><Thickness> ${thickness}</Thickness>${tags}</Layer>`;
};

const AR = `<?xml version="1.0"?>
<EssentialMacleodDesign>
   <Parameters>
      <IncidentAngle> 0</IncidentAngle>
      ${unit('.000000001', 'nm')}
      <ReferenceWavelength> 510</ReferenceWavelength>
      <ThicknessType>O</ThicknessType>
      <HorizontalParameters Name="Wavelength"><Min> 400</Min><Max> 700</Max><PlotInterval> 1</PlotInterval></HorizontalParameters>
   </Parameters>
   <Medium>Air</Medium>
   <Substrate>Glass</Substrate>
   <Layers>
      ${layer(2, 'ZrO2', '.5335445')}
      ${layer(1, 'MgF2', '.2516994')}
      ${layer(3, 'MgF2', '.08233427', { Lock: 'Yes' })}
      ${layer(4, 'ZrO2', '.06699026')}
   </Layers>
   <Formula>
      <Formula>LHH.25L.25H</Formula>
      <Symbols>
         <Symbol Number="1"><Name>L</Name><Material>MgF2</Material></Symbol>
         <Symbol Number="2"><Name>H</Name><Material>ZrO2</Material></Symbol>
      </Symbols>
   </Formula>
   <RefinementParameters><Targets><Target Number="1"><Wavelength> 510</Wavelength></Target></Targets></RefinementParameters>
   <Notes>A two-layer replacement &amp; refined.</Notes>
</EssentialMacleodDesign>`;

const d = parseMacleodDesign(AR, 'Four Layer AR.dds');
ok(d.program === 'macleod' && d.name === 'Four Layer AR', 'program and name');
ok(d.incidentMedium === 'Air' && d.substrate === 'Glass' && d.exitMedium === null, 'medium, substrate, no exit medium');
near(d.referenceWavelengthNm, 510, 1e-12, 'reference wavelength in nm');
ok(d.front.length === 4 && d.back.length === 0, 'four front layers');
ok(d.front[0].material === 'MgF2' && d.front[1].material === 'ZrO2', 'layers sorted by number, layer 1 first (incident side)');
ok(d.front[0].thicknessNm === null && d.front[0].optical.kind === 'fwot', 'optical thickness stays optical until materials resolve');
near(d.front[0].optical.value, 0.2516994, 1e-12, 'FWOT value kept');
ok(d.front[2].locked === true && d.front[0].locked === false, 'Lock Yes becomes locked');
ok(d.formula === 'LHH.25L.25H' && d.symbols.L === 'MgF2' && d.symbols.H === 'ZrO2', 'formula and symbols');
ok(d.comments[0] === 'A two-layer replacement & refined.', 'notes unescaped');
ok(d.notes.some(n => n.code === 'targets' && n.count === 1), 'targets counted');
ok(d.spectrum.fromNm === 400 && d.spectrum.toNm === 700, 'plot range from the wavelength axis');
ok(d.backSurface === false, 'the substrate is the emergent medium: semi-infinite');

// Physical thickness, numeric materials, single-line XML, µm database.
const P = `<EssentialMacleodDesign><Parameters><IncidentAngle> 45</IncidentAngle>${unit('.000001', 'µm')}<ReferenceWavelength> .6</ReferenceWavelength><ThicknessType>P</ThicknessType></Parameters><Medium>1.52</Medium><Substrate>Glass</Substrate><Layers>${layer(1, 'Y2O3', '.14722')}${layer(2, '2.35', '.09', { Link: '3' })}</Layers></EssentialMacleodDesign>`;
const p = parseMacleodDesign(P, 'phys.dds');
near(p.referenceWavelengthNm, 600, 1e-9, 'µm reference wavelength converted to nm');
near(p.front[0].thicknessNm, 147.22, 1e-9, 'physical thickness converted with the wavelength unit');
ok(p.front[0].optical === null, 'no optical value for a physical file');
ok(p.constants['1.52'] === 1.52 && p.constants['2.35'] === 2.35, 'numeric names are constant indices');
ok(p.angleDeg === 45, 'incident angle');
ok(p.notes.some(n => n.code === 'linkedLayers' && n.count === 1), 'link groups noted');
ok(isConstantIndexName(' 1.45 ') && !isConstantIndexName('MgF2') && !isConstantIndexName(''), 'constant-index name test');

// The unit block holds a <Unit> child of its own name; the scale factor is
// read whichever side of it the child sits, and attributes on <Parameters>
// change nothing.
const unitChildFirst = (scale, name) => `<Unit Name="Wavelength"><Unit>${name}</Unit><Format>####0.00</Format><ScaleFactor> ${scale}</ScaleFactor></Unit>`;
const cf = parseMacleodDesign(AR.replace(unit('.000000001', 'nm'), unitChildFirst('.000001', 'µm')).replace('<Parameters>', '<Parameters Version="2">'), 'cf.dds');
near(cf.referenceWavelengthNm, 510000, 1e-6, 'scale factor read with the unit child first and an attribute on Parameters');
const noUnit = parseMacleodDesign(AR.replace(unit('.000000001', 'nm'), ''), 'nounit.dds');
near(noUnit.referenceWavelengthNm, 510, 1e-9, 'a file with no unit block is read in nanometres');
ok(noUnit.notes.some(n => n.code === 'unitAssumed'), 'and says so');
let message = '';
try { parseMacleodDesign(P.replace(unit('.000001', 'µm'), ''), 'nounit-um.dds'); } catch (e) { message = e.message; }
ok(/names no wavelength unit/.test(message), 'a file with no unit block whose reference wavelength cannot be nanometres is refused');

let threw = false;
try { parseMacleodDesign('<EssentialMacleodMaterial Name="x"/>', 'M1.tfx'); } catch (_) { threw = true; }
ok(threw, 'a material file is not a design');
threw = false;
try { parseMacleodDesign(AR.replace('<ThicknessType>O', '<ThicknessType>G'), 'g.dds'); } catch (_) { threw = true; }
ok(threw, 'an unknown thickness type is refused');
message = '';
try { parseMacleodDesign(P.replace('<PackingDensity> 1</PackingDensity>', '<PackingDensity> 1.2231</PackingDensity>'), 'rugate.dds'); } catch (e) { message = e.message; }
ok(/packing density \(layer 1\)/.test(message), 'a layer with packing density is refused as a rugate mechanism');

// ── The program's material database ──────────────────────────────────────────
const tfx = (name, points) => `<?xml version="1.0"?>\r\n<EssentialMacleodMaterial Name="${name}" NType="1" KType="1" TType="-1"><NKPoints>${points.map(([w, n, k]) => `<NKPoint W="${w}" n="${n}" k="${k}"/>`).join('')}</NKPoints><Cauchy Max="0" Min="0"><Parameter N="0" A="1"/></Cauchy><Sellmeier Max="0" Min="0"><Parameter N="0" A="0" B="0"/></Sellmeier><KPoints><KPoint W="100" k="0"/><KPoint W="1000" k="0"/></KPoints><KCauchy><Parameter N="0" A="0"/></KCauchy><KExp><Parameter A="0" B="0"/></KExp><Notes></Notes></EssentialMacleodMaterial>\r\n`;
const database = {
    databaseDir: 'C:\\db',
    unitsText: '"Wavelength",1E-09,"nm","####0.00"',
    siblings: [
        { name: 'M1', ext: 'tfx', text: tfx('Glass', [[300, 1.553, 0], [500, 1.521, 0], [700, 1.513, 0]]) },
        { name: 'M2', ext: 'tfx', text: tfx('MgF2', [[400, 1.385, 0], [600, 1.380, 0], [800, 1.378, 0]]) },
        { name: 'M3', ext: 'tfx', text: tfx('ZrO2', [[400, 2.10, 0], [600, 2.05, 0], [800, 2.03, 0]]) },
        { name: 'M5', ext: 'tfx', text: tfx('Air', [[300, 1, 0], [2000, 1, 0]]) },
        { name: 'M4', ext: 'tfx', text: 'MT1\rN\u00d9-\u0000\u00007\u0000garbage' },
    ],
};
const db = parseMacleodDesign(AR, 'Four Layer AR.dds', database);
ok(Object.keys(db.embedded).sort().join() === 'Glass,MgF2,ZrO2', `every name the database holds is embedded: ${Object.keys(db.embedded).join(', ')}`);
ok(db.embedded.MgF2.formulaNum === -1 && db.embedded.MgF2.interp === 'linear', 'a database table is read the way the program reads it');
ok(!('Air' in db.embedded), 'Air stays the built-in Air even when the database holds one');
ok(!('Water' in parseMacleodDesign(AR.replace('<Medium>Air</Medium>', '<Medium>Water</Medium>'), 'w.dds', database).embedded), 'a name the database does not hold is left for the catalogs');
ok(db.notes.some(n => n.code === 'materialsFromDatabase' && n.count === 3 && n.dir === 'C:\\db'), 'the design says what it took from the database and where');
ok(!db.notes.some(n => n.code === 'noDatabase') && d.notes.some(n => n.code === 'noDatabase'), 'and without a database it says that instead');

const upper = parseMacleodDesign(AR.replace('<Substrate>Glass</Substrate>', '<Substrate>GLASS</Substrate>'), 'upper.dds', database);
ok(upper.embedded.GLASS?.name === 'Glass' && !('Glass' in upper.embedded), 'names match without regard to case, under the file\'s own spelling');

const um = { ...database, unitsText: '"Wavelength",.000001,"µm","####0.00"', siblings: [{ name: 'M1', ext: 'tfx', text: tfx('Glass', [[0.3, 1.553, 0], [0.5, 1.521, 0], [0.7, 1.513, 0]]) }] };
near(parseMacleodDesign(AR, 'um.dds', um).embedded.Glass.lambdaMin, 0.3, 1e-12, 'a µm database is read in its own unit');
const wavenumber = parseMacleodDesign(AR, 'cm.dds', { ...database, unitsText: '"Wavelength",0.01,"cm-1"' });
ok(Object.keys(wavenumber.embedded).length === 0 && wavenumber.notes.some(n => n.code === 'databaseUnused' && n.dir === 'C:\\db'), 'a database in a unit the importer cannot read is passed over, and the design says so');
const stranger = parseMacleodDesign(AR, 'other.dds', { ...database, siblings: [{ name: 'M1', ext: 'tfx', text: tfx('Other', [[300, 1.5, 0], [700, 1.5, 0]]) }] });
ok(Object.keys(stranger.embedded).length === 0 && stranger.notes.some(n => n.code === 'databaseUnused') && !stranger.notes.some(n => n.code === 'noDatabase'), 'a database holding none of the names says so rather than nothing');

{
    const built = buildImportedDesign(db, name => name === 'Air' ? 'builtin:Air' : null, getLocale('en').designImport);
    ok(built.unresolved.length === 0 && built.warnings.length === 0, 'every name resolves through the database');
    ok(built.design.substrate.material === 'import:Glass' && built.design.frontLayers[0].material === 'import:MgF2', 'the database materials are embedded in the design');
    const n = makeGetNK(db.embedded.MgF2)(510)[0];
    near(n, 1.385 + (1.380 - 1.385) * 110 / 200, 1e-12, 'linear index at the reference wavelength');
    near(built.design.frontLayers[0].thickness, 0.2516994 * 510 / n, 1e-9, 'full waves converted with the database material at λ0');
    ok(built.design.materials['import:MgF2'].interp === 'linear', 'the embedded definition carries the linear rule into the design');
}

// ── Maintainer-only: the shipped sample designs ──────────────────────────────
const DIR = 'C:\\Users\\Public\\Documents\\Thin Film Center\\Designs';
if (fs.existsSync(DIR)) {
    const errors = [];
    let parsed = 0, physical = 0, rugates = 0, constants = 0, ranged = 0;
    for (const file of fs.readdirSync(DIR).filter(n => /\.dds$/i.test(n))) {
        try {
            const item = parseMacleodDesign(fs.readFileSync(path.join(DIR, file), 'utf8'), file);
            parsed++;
            if (item.front.some(l => l.thicknessNm != null)) physical++;
            if (Object.keys(item.constants).length) constants++;
            if (item.spectrum) ranged++;
        } catch (e) {
            if (/packing density/.test(e.message) && /^Rugate/.test(file)) rugates++;
            else errors.push(`${file}: ${e.message}`);
        }
    }
    ok(errors.length === 0 && parsed > 0 && rugates > 0, `all ${parsed} sample designs parse and the ${rugates} rugate samples are refused (${physical} physical, ${constants} with constant indices, ${ranged} with a plot range)${errors.length ? ': ' + errors.slice(0, 5).join('; ') : ''}`);
} else {
    console.log('(maintainer section not run: Essential Macleod sample designs not present)');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
