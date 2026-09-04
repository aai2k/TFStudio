/**
 * Design file import: dispatcher, material name resolution and the build of
 * a TFStudio design from an imported description.
 *
 *  1. A mixed batch routes by extension; unreadable files, and files the
 *     main process could not read, come back as errors.
 *  2. Name suggestions: same-program catalog beats a user catalog beats the
 *     built-in library; Air is built-in Air; unknown names give null; a
 *     numeric name is looked up like any other.
 *  3. Constant-index records.
 *  4. Build: optical thickness to nm with the resolved index and the match
 *     angle, exit medium defaults to the substrate, back layers set the
 *     surface mode, the program's back-surface rule sets the evaluation
 *     mode, unresolved names are reported and left in place, folder
 *     definitions are embedded under ids that never collide, warnings and
 *     notes are worded through the locale.
 *  5. The built design evaluates: a quarter-wave MgF2 layer on glass gives the
 *     textbook reflectance at the reference wavelength.
 *  6. The index a file carries of its own: derived from a layer that stores
 *     both its quarter waves and its physical thickness, taken from a
 *     constant, and absent where the file has neither.
 *
 * Run: node tests/design_file_import.mjs
 */
import { initCatalogs } from '../src/utils/materials/catalogManager.js';
import { makeGetNK } from '../src/utils/materials/catalogManager/dispersion.js';
import { designMaterialLookup, unresolvedMaterials } from '../src/utils/materials/designMaterials.js';
import { evaluateSpectrum } from '../src/utils/physics/thinFilmMath.js';
import { resolveEvalMode } from '../src/utils/physics/optimizer/evalCore.js';
import { getLocale } from '../src/constants/locales.js';
import {
    parseDesignFiles, programForExtension, batchMaterialNames, designMaterialNames, DESIGN_FILE_EXTENSIONS, materialKey, sourceIndexOf,
} from '../src/utils/io/designImport/designFileImport.js';
import { suggestMaterialId, constantIndexRecord } from '../src/utils/io/designImport/materialResolution.js';
import { buildImportedDesign, importNoteText, importWarningText } from '../src/utils/io/designImport/buildDesign.js';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg} (${a} vs ${b}, tol ${tol})`);
const di = getLocale('en').designImport;

const constant = (id, name, n, extra = {}) => ({
    id, name, formulaNum: -1, tabData: [[200, n, 0], [2000, n, 0]], lambdaMin: 0.2, lambdaMax: 2, ...extra,
});
initCatalogs({
    lab: {
        id: 'lab', name: 'Lab', source: 'user',
        materials: {
            MgF2: constant('MgF2', 'MgF2', 1.38),
            Glass: constant('Glass', 'Glass', 1.52),
            Y2O3: constant('Y2O3', 'Y2O3', 1.8, { kTable: [], lambdaMin: 0.3, lambdaMax: 1.5, tabData: [[300, 1.8, 0.01], [1500, 1.8, 0.01]] }),
            7980: constant('7980', 'Corning 7980', 1.4585),
        },
    },
    tf: {
        id: 'tf', name: 'TFCalc materials', source: 'user',
        materials: { ZRO2: constant('ZRO2', 'ZRO2', 2.05, { tfcalc: { format: 1 } }), MGF2: constant('MGF2', 'MgF2 (TFCalc)', 1.38, { tfcalc: { format: 1 } }) },
    },
});

// ── 1. Dispatcher ─────────────────────────────────────────────────────────────
ok(DESIGN_FILE_EXTENSIONS.every(e => programForExtension(e)) && programForExtension('TFD') === 'tfcalc' && programForExtension('DSG') === 'optilayer' && programForExtension('mat') === null, 'extension routing');
const tfd = 'VERSION*1*\nENVIRON*400*700*10*550*0*AIR*GLASS*\nENVIRON3*1*GLASS*WHITE*IDEAL*1*\nLAYERS*1*\nLAYER*1*MGF2*1.0*99.63768*0*1*Y*N*0*N*N*\nLAYERS2*0*\nEOF*';
const dds = '<EssentialMacleodDesign><Parameters><ReferenceWavelength> 550</ReferenceWavelength><ThicknessType>O</ThicknessType></Parameters><Medium>Air</Medium><Substrate>Glass</Substrate><Layers><Layer LayerNumber="1"><Material>MgF2</Material><Thickness> .25</Thickness></Layer></Layers></EssentialMacleodDesign>';
const dsg = JSON.stringify({ VERSION: 1, name: 'QW', comment: '', controlW: 550, matchAngle: 0, matchMedium: 1, layers: [{ abbr: 'L', qwot_thickness: 1, status: 'A', zn_re: 1.38, zn_im: 0 }] });
const dsgFolder = {
    projectText: '[LoadedData]\nIncidentMedium=Air\nExitMedium=Air\n',
    siblings: [
        { name: 'MgF2 const', ext: 'lm', text: JSON.stringify({ nType: 0, kType: 0, wavelength: null, n: [1.38], k: [0], name: 'MgF2 const' }) },
        { name: 'Air', ext: 'sub', text: JSON.stringify({ nType: 0, kType: 0, wavelength: null, n: [1], k: [0], name: 'Air' }) },
        { name: 'Glass', ext: 'sub', text: JSON.stringify({ nType: 0, kType: 0, wavelength: null, n: [1.52], k: [0], name: 'Glass' }) },
    ],
};
const files = [
    { name: 'qw', ext: 'tfd', dir: 'my', text: tfd },
    { name: 'One Layer AR', ext: 'dds', dir: 'Designs', text: dds },
    { name: 'broken', ext: 'dds', dir: 'Designs', text: 'nothing' },
    { name: 'glass', ext: 'agf', dir: 'x', text: '' },
    { name: 'QW', ext: 'dsg', dir: 'LEC', text: dsg, ...dsgFolder },
    { name: 'locked', ext: 'tfd', dir: 'my', text: null, error: 'EACCES: permission denied' },
];
const { items, errors } = parseDesignFiles(files);
ok(items.length === 3 && errors.length === 3, `3 parsed, 3 errors (${items.length}/${errors.length})`);
ok(items[0].program === 'tfcalc' && items[1].program === 'macleod' && items[2].program === 'optilayer', 'programs by extension');
ok(errors[0].file === 'broken.dds' && /Essential Macleod/.test(errors[0].error), 'unreadable file reported');
ok(errors[1].code === 'unsupported-type', 'unsupported extension reported by code');
ok(errors[2].file === 'locked.tfd' && /permission denied/.test(errors[2].error), 'a file the main process could not read is listed with its reason');
ok(parseDesignFiles(files.slice(0, 1), { tfcalc: 'um' }).items[0].item.referenceWavelengthNm === 550000, 'unit setting reaches the TFCalc reader');
ok(parseDesignFiles(files.slice(0, 1)).items[0].item.referenceWavelengthNm === 550, 'the default unit setting lets the file decide');

const names = batchMaterialNames(items);
ok(names.length === 9, `distinct names per program: ${names.map(n => `${n.program}:${n.name}`).join(', ')}`);
ok(designMaterialNames(items[0].item).join() === 'AIR,GLASS,MGF2', 'names of one design: media, substrate, layers');
ok(names.find(n => n.name === 'MgF2 const').embedded === true && names.find(n => n.name === 'MGF2').embedded === false, 'names defined by the file\'s folder are flagged');

// ── 2. Suggestions ────────────────────────────────────────────────────────────
ok(suggestMaterialId('AIR', 'tfcalc') === 'builtin:Air', 'Air is the built-in Air');
ok(suggestMaterialId('MGF2', 'tfcalc') === 'tf:MGF2', 'a TFCalc-imported material wins for a TFCalc design');
ok(suggestMaterialId('MgF2', 'macleod') === 'lab:MgF2', 'a user catalog wins over the built-in library');
ok(suggestMaterialId('SiO2', 'macleod') === 'builtin:SiO2', 'the built-in library is the last resort');
ok(suggestMaterialId('ZrO2', 'macleod') === 'tf:ZRO2', 'match is case-insensitive');
ok(suggestMaterialId('7980', 'macleod') === 'lab:7980', 'a numeric name finds a catalog material of that name');
ok(suggestMaterialId('Na3AlF6', 'macleod') === null && suggestMaterialId('', 'macleod') === null, 'unknown names give null');

// ── 3. Records ────────────────────────────────────────────────────────────────
const c = constantIndexRecord(1.45);
ok(c.id === 'import:n1.45' && makeGetNK(c)(632.8)[0] === 1.45 && makeGetNK(c)(632.8)[1] === 0, 'constant record');
const ck = constantIndexRecord(2.2, 3.76);
ok(ck.id === 'import:n2.2_k3.76' && makeGetNK(ck)(632.8)[1] === 3.76 && /k = 3.76/.test(ck.name), 'absorbing constant record');

// ── 4. Build ──────────────────────────────────────────────────────────────────
const mapping = {
    [materialKey('macleod', 'Air')]: 'builtin:Air', [materialKey('macleod', 'Glass')]: 'lab:Glass', [materialKey('macleod', 'MgF2')]: 'lab:MgF2',
    [materialKey('macleod', 'Y2O3')]: 'lab:Y2O3',
    [materialKey('tfcalc', 'AIR')]: 'builtin:Air', [materialKey('tfcalc', 'GLASS')]: 'lab:Glass', [materialKey('tfcalc', 'MGF2')]: 'tf:MGF2',
};
const resolveFor = program => name => mapping[materialKey(program, name)] || null;

const m = buildImportedDesign(items[1].item, resolveFor('macleod'), di);
ok(m.unresolved.length === 0 && m.warnings.length === 0, 'Macleod design fully resolved');
near(m.design.frontLayers[0].thickness, 0.25 * 550 / 1.38, 1e-9, 'FWOT 0.25 becomes λ0 / (4 n)');
ok(m.design.exitMedium === 'lab:Glass' && m.design.substrate.material === 'lab:Glass', 'exit medium is the substrate');
ok(m.design.surfaceMode === 'front_only' && m.design.mfEvalMode === 'side' && resolveEvalMode(m.design) === 'front', 'a semi-infinite substrate evaluates the front side alone');
ok(m.design.referenceWavelength === 550 && m.design.incidentMedium === 'builtin:Air', 'design fields');
ok(/Imported from One Layer AR.dds \(Essential Macleod\)/.test(m.design.notes), 'notes name the source');
ok(!m.design.materials, 'nothing embedded when every name resolves to a catalog');

const t = buildImportedDesign(items[0].item, resolveFor('tfcalc'), di);
near(t.design.frontLayers[0].thickness, 99.63768, 1e-9, 'TFCalc physical thickness kept');
ok(t.design.frontLayers[0].material === 'tf:MGF2' && t.design.frontLayers[0].locked === false, 'layer material and lock');
ok(t.design.mfEvalMode === 'side', 'TFCalc exit medium equal to the substrate: semi-infinite');

// A TFCalc design with an exit medium of its own is evaluated with both
// surfaces of the substrate, as TFCalc did.
const airExit = parseDesignFiles([{ name: 'ar', ext: 'tfd', dir: 'my', text: tfd.replace('ENVIRON3*1*GLASS*', 'ENVIRON3*1*AIR*') }]).items[0].item;
const ax = buildImportedDesign(airExit, resolveFor('tfcalc'), di);
ok(airExit.backSurface === true && ax.design.exitMedium === 'builtin:Air' && ax.design.surfaceMode === 'front_only' && ax.design.mfEvalMode === 'total', 'exit medium kept and the evaluation mode set to both surfaces');
ok(resolveEvalMode(ax.design) === 'total', 'TFStudio evaluates the whole substrate for it');

// Unresolved names stay in place and are reported; the warning is worded.
const u = buildImportedDesign(items[1].item, name => name === 'Air' ? 'builtin:Air' : null, di);
ok(u.unresolved.slice().sort().join() === 'Glass,MgF2', `unresolved names reported: ${u.unresolved.join(', ')}`);
ok(u.design.substrate.material === 'missing:Glass' && unresolvedMaterials(u.design).includes('missing:Glass'), 'the design carries the source name as a missing id');
ok(unresolvedMaterials(u.design).includes('missing:MgF2'), 'an unmapped name is not taken for the built-in material of the same name');
ok(u.design.frontLayers[0].thickness === 0 && u.warnings.length === 1 && u.warnings[0].code === 'noIndex' && u.warnings[0].side === 'front' && u.warnings[0].index === 1, 'an optical layer without an index gets thickness 0 and a warning');
ok(importWarningText(u.warnings[0], di) === 'front layer 1: no index for MgF2 at 550 nm, thickness set to 0.', 'the warning reads through the locale');

// Constants embed records; back layers set the surface mode; notes are worded.
const item = {
    name: 'mix', program: 'macleod', file: 'mix.dds', referenceWavelengthNm: 1000, angleDeg: 0, matchAngleDeg: 0, matchMedium: 1,
    incidentMedium: '1.52', substrate: 'Glass', exitMedium: null, substrateThicknessMm: null, backSurface: false,
    front: [{ material: 'Y2O3', thicknessNm: null, optical: { kind: 'fwot', value: 0.5 }, locked: true }],
    back: [{ material: 'MgF2', thicknessNm: 100, optical: null, locked: false }],
    formula: null, symbols: {}, constants: { '1.52': 1.52 }, comments: ['from the file'], notes: [{ code: 'targets', count: 2 }],
};
const x = buildImportedDesign(item, resolveFor('macleod'), di);
ok(x.design.incidentMedium === 'import:n1.52' && x.design.materials['import:n1.52'], 'numeric medium embedded as a constant');
near(x.design.frontLayers[0].thickness, 0.5 * 1000 / 1.8, 1e-9, 'optical thickness converted with the resolved index');
ok(x.design.frontLayers[0].locked === true && x.design.surfaceMode === 'both_independent' && x.design.backLayers[0].thickness === 100, 'lock, surface mode and back layer');
ok(/^from the file\n/.test(x.design.notes) && x.design.notes.endsWith('2 targets in the file not imported.'), 'the file\'s own notes come first, the reader\'s notes last, worded');
ok(importNoteText({ code: 'unitMismatch', chosen: 'nm', detected: 'um' }, di) === 'Wavelengths read as nanometres, as chosen; the layers\' quarter waves and thicknesses fit micrometres.', 'a note with parameters reads through the locale');
ok(importNoteText({ code: 'noMedium', which: 'exit', assumed: 'Air' }, di) === 'The project names no exit medium; Air assumed.', 'note wording names the medium');

// An OptiLayer layer without a stored index converts with the assigned
// material's index at the match angle, like its indexed neighbours.
const unindexed = {
    ...item, program: 'optilayer', file: 'qwm.dsg', referenceWavelengthNm: 550, incidentMedium: 'Air', exitMedium: 'Air', matchAngleDeg: 45, matchMedium: 1,
    front: [{ material: 'MgF2', thicknessNm: null, optical: { kind: 'qwot', value: 1, angleDeg: 45, matchMedium: 1 }, locked: false },
            { material: 'Ag', thicknessNm: null, optical: { kind: 'qwot', value: 0.02, angleDeg: 45, matchMedium: 1 }, locked: false }],
    back: [], constants: { Ag: { n: 0.04, k: 7 } }, comments: [], notes: [],
};
const ux = buildImportedDesign(unindexed, name => ({ MgF2: 'lab:MgF2', Air: 'builtin:Air', Glass: 'lab:Glass' })[name] || null, di);
{
    const cos = Math.sqrt(1 - Math.pow(Math.sin(Math.PI / 4) / 1.38, 2));
    near(ux.design.frontLayers[0].thickness, 550 / (4 * 1.38 * cos), 1e-9, 'quarter wave at 45° converted with the cosine in the assigned material');
    near(ux.design.frontLayers[1].thickness, 0.02 * 550 / (4 * 0.04), 1e-9, 'a metal the angle cannot be applied to converts at normal incidence');
    ok(ux.warnings.length === 1 && ux.warnings[0].code === 'obliqueNotApplied' && ux.warnings[0].index === 2, 'and is warned about');
}

// An OptiLayer design with nothing in the catalogs carries its folder's definitions.
const o = buildImportedDesign(items[2].item, () => null, di);
ok(o.unresolved.length === 0, 'every OptiLayer name is defined by the folder');
ok(o.design.frontLayers[0].material === 'import:MgF2_const' && o.design.materials['import:MgF2_const'].tabData.length === 1, 'the layer material is embedded from the folder\'s .lm');
ok(o.design.substrate.material === 'import:Glass' && o.design.incidentMedium === 'import:Air', 'substrate and media embedded from the folder\'s .sub files');
near(o.design.frontLayers[0].thickness, 550 / (4 * 1.38), 1e-9, 'thickness from the file\'s own index');
ok(!('getNK' in o.design.materials['import:Glass']), 'embedded records carry no functions');
ok(o.design.exitMedium === 'import:Air' && o.design.mfEvalMode === 'side', 'OptiLayer\'s exit medium is kept and the substrate stays semi-infinite');
// A catalog match by name takes precedence over the folder definition.
const oc = buildImportedDesign(items[2].item, name => name === 'MgF2 const' ? 'lab:MgF2' : null, di);
ok(oc.design.frontLayers[0].material === 'lab:MgF2' && !oc.design.materials?.['import:MgF2_const'], 'a mapped name is not embedded');

// Two folder names that sanitize to the same id get ids of their own.
const twins = {
    ...unindexed, matchAngleDeg: 0, constants: {},
    front: [{ material: 'Ag (Silver)', thicknessNm: 10, optical: null, locked: false }, { material: 'Ag Silver', thicknessNm: 10, optical: null, locked: false }],
    embedded: { 'Ag (Silver)': constant('a', 'Ag (Silver)', 0.05), 'Ag Silver': constant('b', 'Ag Silver', 0.15) },
};
const tw = buildImportedDesign(twins, name => ({ Air: 'builtin:Air', Glass: 'lab:Glass' })[name] || null, di);
ok(tw.design.frontLayers[0].material === 'import:Ag_Silver' && tw.design.frontLayers[1].material === 'import:Ag_Silver_2', `colliding names get distinct ids: ${tw.design.frontLayers.map(l => l.material).join(', ')}`);
ok(tw.design.materials['import:Ag_Silver'].name === 'Ag (Silver)' && tw.design.materials['import:Ag_Silver_2'].name === 'Ag Silver', 'each id carries its own definition');

// ── 5. The built design evaluates ─────────────────────────────────────────────
{
    const lookup = designMaterialLookup(m.design);
    const layers = m.design.frontLayers.map(l => ({ material: lookup(l.material), thickness: l.thickness }));
    const r = evaluateSpectrum({ lambdaStart: 550, lambdaEnd: 550, lambdaStep: 1 }, lookup(m.design.incidentMedium), lookup(m.design.substrate.material), layers);
    // Quarter-wave 1.38 on 1.52: R = ((n0 ns - n1²) / (n0 ns + n1²))²
    const expected = Math.pow((1.52 - 1.38 * 1.38) / (1.52 + 1.38 * 1.38), 2);
    near(r.R[0], expected, 1e-6, 'quarter-wave MgF2 on glass at λ0');
}

// ── 6. The index the file itself carries ──────────────────────────────────────
{
    const src = (item, name) => sourceIndexOf(item, name);
    // A TFCalc layer stores quarter waves and physical thickness: n = qwot λ0 / (4 d).
    near(src(items[0].item, 'MGF2').n, 1.38, 1e-6, 'TFCalc layer gives the index the design was built with');
    ok(src(items[0].item, 'GLASS') === null && src(items[0].item, 'AIR') === null, 'a medium has no layer and no index');
    // Essential Macleod stores optical thickness alone, so nothing can be derived.
    ok(src(items[1].item, 'MgF2') === null, 'a Macleod design carries no index');
    // An OptiLayer abbreviation with no folder file becomes a constant, which is the index.
    const bare = parseDesignFiles([{ name: 'QW', ext: 'dsg', dir: 'ol', text: dsg }]).items[0].item;
    const bareName = designMaterialNames(bare).find(n => /^L /.test(n));
    ok(src(bare, bareName).n === 1.38, `a constant is its own index (${bareName})`);
    // The relation holds at normal incidence, so a match angle rules it out.
    const oblique = parseDesignFiles([{
        name: 'QW', ext: 'dsg', dir: 'ol', text: dsg.replace('"matchAngle":0', '"matchAngle":45'), ...dsgFolder,
    }]).items[0].item;
    ok(oblique.matchAngleDeg === 45 && src(oblique, 'MgF2 const') === null, 'an optical thickness defined at an angle gives no index');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
