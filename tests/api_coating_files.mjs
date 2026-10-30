/**
 * The headless API's Zemax and CODE V coating calls (src/api/zemaxCoating.js
 * and src/api/codevCoating.js) against the Zemax Coatings and CODE V Coatings
 * windows' own code.
 *
 *   1. saveZemaxCoating writes the text the Zemax window's Export builds
 *      (buildCoatingText with the window's fields), and saveCodevCoating the
 *      text buildDesignSeq builds on the window's analysis wavelengths, with
 *      its warnings as the window words them, on the corpus designs: each
 *      coated side, absolute and relative thicknesses, the used materials and
 *      all of them, one angle and three; the window's defaults, and the side
 *      taken without one.
 *   2. readZemaxCoating lists each MATE record as the import holds it, k with
 *      the file's sign turned, and each COAT as the Coatings tab shows it, a
 *      relative thickness at the window's λ0 (coatLayerThkNm), on a file with a
 *      repeated name, ideal and encrypted coatings and a layer naming no MATE
 *      record; readCodevCoating gives the stack the window reads, from the
 *      CODE V reference files, a .seq and the .mul CODE V saved from it
 *      reading to the same layers.
 *   3. importZemaxCoating and importCodevCoating put in the layers the
 *      windows' imports put in (convertSelectedCoating and importedLayers,
 *      writing), the ids by their material part for a file never imported,
 *      and the catalog's own ids and records, an edit included, for a file the
 *      window imported before, named in any case on Windows. The design
 *      carries the records and computes as the window's design computes with
 *      the catalog, and no call writes a catalog. At a λ0 between a MATE
 *      table's rows the import's thicknesses are the ones readZemaxCoating
 *      lists.
 *   4. Round trips: a side written and imported back gives its layers, and
 *      its spectrum at the wavelengths the file samples, on the front and the
 *      back; the back is written from the exit medium to the substrate, so it
 *      reads back reversed and goes on the back reversed again.
 *   5. The refusals, each with its code where it has one, writing no file.
 *   6. The object methods (tf.saveZemaxCoating(), design.importCodevCoating()
 *      and the rest) give the plain calls' files and answers, start and end
 *      standing for from and to, and refuse in their own words.
 *
 * Run: node tests/api_coating_files.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { fixtureFile, manifest } from './_apiCorpus.mjs';

const api = await import('../src/api/index.js');
const { buildCoatingText, coatLayerThkNm, coatSideLayers } = await import('../src/components/windows/dataExchange/zemaxCoatings/model.js');
const { convertSelectedCoating } = await import('../src/components/windows/dataExchange/zemaxCoatings/coatingLayers.js');
const { analysisWavelengths, buildDesignSeq } = await import('../src/components/windows/dataExchange/codevCoatings/exportModel.js');
const { importedLayers } = await import('../src/components/windows/dataExchange/codevCoatings/fileStack.js');
const { warningText } = await import('../src/components/windows/dataExchange/codevCoatings/messages.js');
const { parseZemaxCoating } = await import('../src/utils/io/zemaxCoatingFile.js');
const { parseCodevMul, parseCodevSeq } = await import('../src/utils/io/codevCoatingFile.js');
const { addCatalog, getCatalog, getCatalogs } = await import('../src/utils/materials/catalogManager.js');
const { stripGetNK } = await import('../src/utils/materials/catalogManager/persistence.js');
const { requireResolved } = await import('../src/api/materials.js');
const en = (await import('../src/constants/locales/en.js')).default;

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const thrown = fn => { try { fn(); return null; } catch (err) { return err; } };

await api.init();

// The window's imports write their catalogs through window.electronAPI; each
// write is counted, so that a call writing one shows.
const saves = [];
globalThis.window ??= globalThis;
globalThis.window.electronAPI = {
    saveCatalog: async (cat) => { saves.push(cat.id); return { success: true }; },
    deleteCatalog: async () => ({ success: true }),
};
const catalogIds = () => getCatalogs().map(cat => cat.id).sort().join();

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'api-coating-'));
const at = name => path.join(TEMP, name);
const text = file => fs.readFileSync(file, 'utf8');
const zemax = en.zemaxCoatings;
const codev = en.codevCoatings;

const CORPUS = Object.entries(manifest.fixtures).filter(([, fixture]) => Object.keys(fixture.variants).join() === 'default').map(([name]) => name);
const DESIGNS = CORPUS.map(name => ({ name, design: api.openDesign(fixtureFile(name)) })).filter(({ design }) => !thrown(() => requireResolved(design)));
const sides = design => ['front', 'back'].filter(side => coatSideLayers(design, side).length);

// An import draws the random part of a catalog id anew for a file never
// imported; layers and records are compared without it.
const materialPart = id => String(id).replace(/((?:zemax|codev)_\w*?)_[0-9a-f]{8}:/g, '$1:');
const layerRows = layers => layers.map(({ id: _id, ...layer }) => ({ ...layer, material: materialPart(layer.material) }));
const recordRows = records => Object.fromEntries(Object.entries(records).map(([id, record]) => [materialPart(id), stripGetNK(record)]));

// ── 1. The files the windows' Export tabs write ─────────────────────────────
const ZEMAX_SETTINGS = [
    {}, { thickness: 'relative', wavelength: 633, from: 450, to: 950, step: 50, name: 'Corpus' }, { scope: 'all', step: 100 },
];
const CODEV_SETTINGS = [{}, { angles: [0, 30, 45], from: 450, to: 900, step: 25, wavelength: 633, title: 'Corpus', saveName: 'corpus' }];
let written = 0;
const savesBefore = saves.length;
DESIGNS.forEach(({ name, design }, i) => {
    for (const side of sides(design)) {
        ZEMAX_SETTINGS.filter((_, k) => k === 0 || (i + k) % 2 === 0).forEach((settings, k) => {
            const file = at(`${name} ${side} ${k}.dat`);
            api.saveZemaxCoating(design, file, { ...settings, side });
            const { name: coatName = 'TFSTUDIO_DESIGN', thickness = 'absolute', wavelength = 550, from = 400, to = 800, step = 25, scope = 'used' } = settings;
            const expected = buildCoatingText({ design, gStart: from, gEnd: to, gStep: step, scope, coatName, thMode: thickness, refNm: wavelength, side }).text;
            written++;
            ok(`${name} ${side} ${JSON.stringify(settings)}: the Zemax window's COATING.DAT`, text(file) === expected);
        });
        CODEV_SETTINGS.forEach((settings, k) => {
            const file = at(`${name} ${side} ${k}.seq`);
            const warnings = api.saveCodevCoating(design, file, { ...settings, side });
            const { from = 400, to = 800, step = 10, angles = [0] } = settings;
            const built = buildDesignSeq(design, {
                side, title: settings.title ?? design.name ?? '', saveName: settings.saveName ?? design.name ?? '',
                wavelengthsNm: analysisWavelengths(from, to, step).wavelengthsNm, anglesDeg: angles, refNm: settings.wavelength ?? design.referenceWavelength ?? 550,
            });
            written++;
            ok(`${name} ${side} ${JSON.stringify(settings)}: the CODE V window's .seq and its warnings`,
                text(file) === built.text && isDeepStrictEqual(warnings, built.warnings.map(warning => warningText(codev, warning))));
        });
    }
});
ok('the corpus gives files of the front and the back', written > 4 * DESIGNS.length, `${written}`);
ok('and writing them wrote no catalog', saves.length === savesBefore);

const stack = api.stackFromFormula(api.newDesign({ name: 'Stack', referenceWavelength: 600 }), { formula: '(HL)^2 H' });
const twoSided = api.setDesignSetup(api.stackFromFormula(api.setDesignSetup(stack, { surfaceMode: 'both_independent' }), { formula: 'H 2L', side: 'back' }), {});
const backOnly = api.setDesignSetup(twoSided, { surfaceMode: 'back_only' });
api.saveZemaxCoating(stack, at('defaults.dat'));
api.saveCodevCoating(stack, at('defaults.seq'));
ok('at the windows\' opening settings: TFSTUDIO_DESIGN, absolute, 550 nm, 400 to 800 nm by 25, the used materials; the design\'s name and REF, 400 to 800 nm by 10, 0 degrees',
    text(at('defaults.dat')) === buildCoatingText({ design: stack, gStart: 400, gEnd: 800, gStep: 25, scope: 'used', coatName: 'TFSTUDIO_DESIGN', thMode: 'absolute', refNm: 550 }).text
    && text(at('defaults.seq')) === buildDesignSeq(stack, {
        side: 'front', title: 'Stack', saveName: 'Stack', wavelengthsNm: analysisWavelengths(400, 800, 10).wavelengthsNm, anglesDeg: [0], refNm: 600,
    }).text);
api.saveZemaxCoating(backOnly, at('back only.dat'));
api.saveCodevCoating(backOnly, at('back only.seq'));
ok('without a side, a design coated on the back alone writes its back',
    text(at('back only.dat')) === buildCoatingText({ design: backOnly, gStart: 400, gEnd: 800, gStep: 25, scope: 'used', coatName: 'TFSTUDIO_DESIGN', thMode: 'absolute', refNm: 550, side: 'back' }).text
    && api.readCodevCoating(at('back only.seq')).layers.length === 2);

// ── 2. What the windows show of a file ──────────────────────────────────────
const LIBRARY = [
    'MATE TIO2', '0.40 2.60 -0.002', '0.45 2.45 -0.001', '0.50 2.36 0', '0.60 2.28 0', '0.80 2.22 0',
    'MATE SIO2', '0.40 1.470 0', '0.80 1.453 0',
    'MATE SIO2', '0.40 1.480 0', '0.80 1.460 0',
    'COAT I.0.9',
    'IDEAL HALF 0.5 0.5',
    'COAT AR3', 'TIO2 0.25 0', 'SIO2 0.110 1', 'AL2O3 0.25 0', 'TIO2 0.05 1', 'AIR 0.1 1',
    'ENCRYPTED SECRET',
    'COAT LOST', 'AL2O3 0.25 0',
].join('\n');
fs.writeFileSync(at('LIBRARY.DAT'), `${LIBRARY}\n`);
const library = api.readZemaxCoating(at('LIBRARY.DAT'), { wavelength: 600 });
const doc = parseZemaxCoating(LIBRARY);
const byName = Object.fromEntries(doc.materials.map(material => [material.name.toUpperCase(), material]));
ok('readZemaxCoating lists each MATE record, a repeated name told apart as the import tells it, k with the file\'s sign turned',
    isDeepStrictEqual(library.materials.map(m => [m.name, m.repeat, m.importedAs, m.wavelength, m.n, m.k]), [
        ['TIO2', null, 'TIO2', [400, 450, 500, 600, 800], [2.6, 2.45, 2.36, 2.28, 2.22], [0.002, 0.001, 0, 0, 0]],
        ['SIO2', { index: 1, count: 2 }, 'SIO2', [400, 800], [1.47, 1.453], [0, 0]],
        ['SIO2', { index: 2, count: 2 }, 'SIO2 (2)', [400, 800], [1.48, 1.46], [0, 0]],
    ]), JSON.stringify(library.materials.map(m => [m.importedAs, m.k])));
const shown = library.coatings.find(c => c.name === 'AR3');
const kinds = isDeepStrictEqual(library.coatings.map(c => [c.name, c.type, c.layers?.length ?? null]),
    [['I.0.9', 'ideal', null], ['HALF', 'ideal', null], ['AR3', 'stack', 5], ['SECRET', 'encrypted', null], ['LOST', 'stack', 1]]);
const asWritten = isDeepStrictEqual(shown.layers.map(l => [l.material, l.fileThickness, l.mode]),
    [['TIO2', 0.25, 'relative'], ['SIO2', 0.11, 'absolute'], ['AL2O3', 0.25, 'relative'], ['TIO2', 0.05, 'absolute'], ['AIR', 0.1, 'absolute']]);
const tabNm = doc.coatings[2].layers.map((l) => {
    const nm = coatLayerThkNm(l, byName, 600);
    return Number.isFinite(nm) ? nm : null;
});
const byHand = shown.layers[2].thickness === null && Math.abs(shown.layers[1].thickness - 110) < 1e-9
    && Math.abs(shown.layers[0].thickness - 600 * 0.25 / 2.28) < 1e-9;
ok('and each coating by its kind, a stack\'s layers in nm: µm times 1000, waves at the tab\'s λ0 as the tab converts them, null with no index',
    kinds && asWritten && isDeepStrictEqual(shown.layers.map(l => l.thickness), tabNm) && byHand, JSON.stringify(shown.layers));
ok('the wavelength a relative thickness is read at changes it alone', api.readZemaxCoating(at('LIBRARY.DAT')).coatings[2].layers.map(l => l.thickness)
    .every((nm, j) => (shown.layers[j].mode === 'relative' && nm !== null ? nm !== shown.layers[j].thickness : nm === shown.layers[j].thickness)));

const REFERENCE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'reference', 'codev');
const references = fs.readdirSync(REFERENCE).filter(file => /\.(seq|mul)$/.test(file));
const unlike = references.filter((file) => {
    const read = api.readCodevCoating(path.join(REFERENCE, file));
    const stackRead = (/\.mul$/.test(file) ? parseCodevMul : parseCodevSeq)(fs.readFileSync(path.join(REFERENCE, file), 'utf8'));
    const index = ref => ('label' in ref ? [ref.label, null, null] : [null, ref.n, ref.k]);
    return !isDeepStrictEqual(
        [read.title, read.angles, [read.incident.label, read.incident.n, read.incident.k], read.layers.map(l => [[l.index.label, l.index.n, l.index.k], l.thickness, l.code, l.locked]), read.warnings],
        [stackRead.title, stackRead.anglesDeg, index(stackRead.incident), stackRead.layers.map(l => [index(l.index), l.thicknessNm, l.code, l.code === 100]),
            stackRead.warnings.map(warning => warningText(codev, warning))]);
});
ok('readCodevCoating gives the stack the CODE V window reads, on the reference files', references.length === 15 && unlike.length === 0, unlike.join(', '));
const pairs = references.filter(file => file.endsWith('.seq') && references.includes(file.replace(/\.seq$/, '.mul')));
const sameLayers = (seq, mul) => seq.layers.length === mul.layers.length
    && seq.layers.every((l, j) => l.code === mul.layers[j].code && Math.abs(l.thickness - mul.layers[j].thickness) <= 1e-3);
const apart = pairs.filter((file) => {
    const [seq, mul] = [file, file.replace(/\.seq$/, '.mul')].map(name => api.readCodevCoating(path.join(REFERENCE, name)));
    return !sameLayers(seq, mul) || !isDeepStrictEqual(seq.wavelengths, mul.wavelengths) || seq.reference !== mul.reference;
});
ok('a .seq and the .mul CODE V saved from it read to the same layers, wavelengths and REF', pairs.length === 7 && apart.length === 0, apart.join(', '));

// ── 3. The imports against the windows' ─────────────────────────────────────
const fresh = api.newDesign({ name: 'Bare' });
const both = api.setDesignSetup(api.stackFromFormula(api.setDesignSetup(fresh, { surfaceMode: 'both_independent' }), { formula: 'HL' }), {});
// A spectrum names the materials it holds flat past their data, by id.
const spectrumOf = design => materialPart(JSON.stringify(api.spectrum(design, { from: 420, to: 780, step: 15, angles: [0, 40] })));

let before = saves.length;
const ids = catalogIds();
const first = api.importZemaxCoating(fresh, at('LIBRARY.DAT'), { coating: 'ar3', wavelength: 600 });
const again = api.importZemaxCoating(fresh, at('LIBRARY.DAT'), { coating: 2, wavelength: 600 });
ok('importZemaxCoating writes no catalog and draws a new id for a file never imported',
    saves.length === before && catalogIds() === ids && first.design.frontLayers[0].material !== again.design.frontLayers[0].material
    && materialPart(first.design.frontLayers[0].material) === materialPart(again.design.frontLayers[0].material));
const windowZemax = convertSelectedCoating({ z: zemax, doc, selCoating: 2, fileName: 'LIBRARY.DAT', filePath: at('LIBRARY.DAT'), refNm: 600 }, { write: true });
const zemaxCat = getCatalog(windowZemax.registration.catId);
ok('it puts in the layers the window\'s Import to front coating puts in, with the warnings, by their material part',
    isDeepStrictEqual(layerRows(first.design.frontLayers), layerRows(windowZemax.layers)) && isDeepStrictEqual(first.warnings, windowZemax.warnings)
    && first.design.frontLayers.length === 4 && first.warnings.length === 1, JSON.stringify(first.warnings));
const carried = Object.fromEntries(Object.keys(first.design.materials).filter(id => id.startsWith('zemax_')).map(id => [id, first.design.materials[id]]));
const held = Object.fromEntries(windowZemax.layers.filter(l => l.material.startsWith(`${zemaxCat.id}:`))
    .map(l => [l.material, zemaxCat.materials[l.material.slice(zemaxCat.id.length + 1)]]));
ok('the design carries the record the window\'s catalog holds for each layer\'s material, and computes as the window\'s design computes with that catalog',
    isDeepStrictEqual(recordRows(carried), recordRows(held)) && Object.keys(held).length === 2
    && spectrumOf(first.design) === spectrumOf({ ...fresh, frontLayers: windowZemax.layers }), Object.keys(carried).join());
ok('the window\'s import wrote its catalog, as the app does', saves.length === before + 1 && saves.at(-1) === zemaxCat.id);

before = saves.length;
const imported = api.importZemaxCoating(fresh, at('LIBRARY.DAT'), { coating: 'AR3', wavelength: 600 });
ok('on a file the window imported before, the catalog\'s own ids, with no catalog written',
    isDeepStrictEqual(imported.design.frontLayers.map(({ id: _id, ...l }) => l), windowZemax.layers) && saves.length === before);
const tio2 = Object.keys(zemaxCat.materials).find(id => zemaxCat.materials[id].name === 'TIO2');
const edited = { ...zemaxCat.materials[tio2], tabData: zemaxCat.materials[tio2].tabData.map(([w, n, k]) => [w, n + 0.1, k]) };
addCatalog({ ...zemaxCat, materials: { ...zemaxCat.materials, [tio2]: edited } });
before = saves.length;
const afterEdit = api.importZemaxCoating(fresh, at('LIBRARY.DAT'), { coating: 'AR3', wavelength: 600 });
const windowAgain = convertSelectedCoating({ z: zemax, doc, selCoating: 2, fileName: 'LIBRARY.DAT', filePath: at('LIBRARY.DAT'), refNm: 600 }, { write: false });
ok('and the record it holds, an edit made in the Material Editor included, as the window uses it',
    isDeepStrictEqual(stripGetNK(afterEdit.design.materials[`${zemaxCat.id}:${tio2}`]), stripGetNK(getCatalog(zemaxCat.id).materials[tio2]))
    && afterEdit.design.materials[`${zemaxCat.id}:${tio2}`].tabData[0][1] === edited.tabData[0][1]
    && isDeepStrictEqual(afterEdit.design.frontLayers.map(({ id: _id, ...l }) => l), windowAgain.layers) && saves.length === before);
// Windows names a file without regard to case.
const caseOf = file => file.replace(/^[a-z]:/i, drive => drive.toLowerCase()).replace(/[^\\/]+$/, name => name.toLowerCase());
if (process.platform === 'win32') {
    const cased = api.importZemaxCoating(fresh, caseOf(at('LIBRARY.DAT')), { coating: 'AR3', wavelength: 600 });
    ok('a path that differs only in case from the one the window imported is that file: the catalog\'s ids',
        isDeepStrictEqual(cased.design.frontLayers.map(({ id: _id, ...l }) => l), windowAgain.layers) && saves.length === before);
}
// TIO2's MATE table has rows at 500 and 600 nm, where n is 2.36 and 2.28.
const listed = api.readZemaxCoating(at('LIBRARY.DAT'), { wavelength: 550 }).coatings[2].layers.flatMap(l => (l.thickness === null ? [] : [l.thickness]));
const put = api.importZemaxCoating(fresh, at('LIBRARY.DAT'), { coating: 'AR3', wavelength: 550 }).design.frontLayers.map(l => l.thickness);
ok('at a λ0 between the rows of a MATE table the import puts in the thicknesses readZemaxCoating lists, the table read by straight lines as Zemax reads it',
    listed.length === put.length && listed.every((nm, j) => Math.abs(nm - put[j]) < 1e-9) && Math.abs(put[0] - 550 * 0.25 / 2.32) < 1e-9,
    JSON.stringify([listed, put]));

const codevFiles = references.filter(file => !file.startsWith('tfs_cr41g'));
const differ = [];
for (const file of codevFiles) {
    const copy = at(`window ${file}`);
    fs.copyFileSync(path.join(REFERENCE, file), copy);
    const read = (/\.mul$/.test(file) ? parseCodevMul : parseCodevSeq)(text(copy));
    before = saves.length;
    const front = api.importCodevCoating(fresh, copy);
    const back = api.importCodevCoating(both, copy, { side: 'back' });
    if (saves.length !== before) differ.push(`${file}: wrote a catalog`);
    const windowFront = importedLayers({ z: codev, stack: read, fileName: path.basename(copy), filePath: copy }, 'front', { write: true });
    const windowBack = importedLayers({ z: codev, stack: read, fileName: path.basename(copy), filePath: copy }, 'back', { write: true });
    if (!isDeepStrictEqual(layerRows(front.design.frontLayers), layerRows(windowFront.layers))) differ.push(`${file}: front layers`);
    if (!isDeepStrictEqual(layerRows(back.design.backLayers), layerRows(windowBack.layers)) || !isDeepStrictEqual(back.design.frontLayers, both.frontLayers)) differ.push(`${file}: back layers`);
    if (!isDeepStrictEqual(front.warnings, windowFront.warnings.map(warning => warningText(codev, warning)))) differ.push(`${file}: warnings`);
    if (!isDeepStrictEqual(recordRows(Object.fromEntries(Object.keys(windowFront.materials).map(id => [id, front.design.materials[Object.keys(front.design.materials).find(own => materialPart(own) === materialPart(id))]]))),
        recordRows(windowFront.materials))) differ.push(`${file}: records`);
    if (spectrumOf(back.design) !== spectrumOf({ ...both, backLayers: windowBack.layers })) differ.push(`${file}: spectrum`);
    before = saves.length;
    const known = api.importCodevCoating(fresh, copy);
    if (!isDeepStrictEqual(known.design.frontLayers.map(({ id: _id, ...l }) => l), windowFront.layers) || saves.length !== before) differ.push(`${file}: imported before`);
}
ok('importCodevCoating puts in the layers, records and warnings of the CODE V window\'s imports to the front and the back, computes as its design does, and writes no catalog; on a file it imported, its ids',
    differ.length === 0, differ.join('; '));
if (process.platform === 'win32') {
    const windowFile = at('window tfs_ar4.seq');
    const layersOf = file => api.importCodevCoating(fresh, file).design.frontLayers.map(({ id: _id, ...l }) => l);
    ok('and on that file named in another case, the same ids', isDeepStrictEqual(layersOf(caseOf(windowFile).toUpperCase()), layersOf(windowFile)));
}
ok('the back takes the file\'s layers reversed, the front kept', (() => {
    const { design } = api.importCodevCoating(both, path.join(REFERENCE, 'tfs_ar4.seq'), { side: 'back' });
    const { design: onFront } = api.importCodevCoating(fresh, path.join(REFERENCE, 'tfs_ar4.seq'));
    return isDeepStrictEqual(layerRows(design.backLayers), layerRows([...onFront.frontLayers].reverse())) && design.backLayers.length === 4;
})());
const symmetric = api.importCodevCoating(api.setDesignSetup(fresh, { surfaceMode: 'symmetric' }), path.join(REFERENCE, 'tfs_ar4.seq'));
ok('on a symmetric design the front, the back mirroring it', isDeepStrictEqual(layerRows(symmetric.design.backLayers), layerRows([...symmetric.design.frontLayers].reverse())));
ok('without a side, a design coated on the back alone takes it on its back', api.importCodevCoating(backOnly, path.join(REFERENCE, 'tfs_ar4.seq')).design.backLayers.length === 4);

// ── 4. Round trips ──────────────────────────────────────────────────────────
// A file holds n and k on its grid, so the spectrum is compared there.
const GRID = { from: 400, to: 800, step: 25 };
const close = (a, b, tolerance) => a.length === b.length && a.every((x, j) => Math.abs(x - b[j]) <= tolerance);
const spectraClose = (a, b, tolerance) => Object.keys(a.angles).every(angle => ['T', 'R'].every(q => close(Array.from(a.angles[angle][q]), Array.from(b.angles[angle][q]), tolerance)));
const trips = [];
let tripped = 0;
DESIGNS.forEach(({ name, design }) => {
    if (design.frontLayers.some(l => !(l.thickness > 0))) return;
    const onFront = api.setDesignSetup({ ...design, frontLayers: [], backLayers: [] }, { surfaceMode: 'front_only', mfEvalMode: 'side' });
    const dat = at(`trip ${name}.dat`);
    const seq = at(`trip ${name}.seq`);
    if (!design.frontLayers.length) return;
    api.saveZemaxCoating(design, dat, { side: 'front', ...GRID });
    api.saveCodevCoating(design, seq, { side: 'front', ...GRID, angles: [0, 40] });
    const viaZemax = api.importZemaxCoating(onFront, dat).design;
    const viaCodev = api.importCodevCoating(onFront, seq).design;
    const own = api.spectrum({ ...onFront, frontLayers: design.frontLayers }, { ...GRID, angles: [0, 40] });
    tripped++;
    if (!close(viaZemax.frontLayers.map(l => l.thickness), design.frontLayers.map(l => l.thickness), 1e-3)) trips.push(`${name}: Zemax thicknesses`);
    if (!close(viaCodev.frontLayers.map(l => l.thickness), design.frontLayers.map(l => l.thickness), 1e-3)) trips.push(`${name}: CODE V thicknesses`);
    if (!isDeepStrictEqual(viaCodev.frontLayers.map(l => !!l.locked), design.frontLayers.map(l => !!l.locked))) trips.push(`${name}: locks`);
    if (!spectraClose(api.spectrum(viaZemax, { ...GRID, angles: [0, 40] }), own, 1e-4)) trips.push(`${name}: Zemax spectrum`);
    if (!spectraClose(api.spectrum(viaCodev, { ...GRID, angles: [0, 40] }), own, 1e-4)) trips.push(`${name}: CODE V spectrum`);
});
ok('a front written and imported back gives its layers, locks and spectrum', tripped > 10 && trips.length === 0, trips.join('; '));

api.saveZemaxCoating(twoSided, at('back.dat'), { side: 'back' });
api.saveCodevCoating(twoSided, at('back.seq'), { side: 'back', ...GRID });
const backRead = api.readZemaxCoating(at('back.dat')).coatings[0].layers;
const backAgain = api.importCodevCoating(api.setDesignSetup({ ...twoSided, backLayers: [] }, {}), at('back.seq'), { side: 'back' }).design;
ok('a back is written from the exit medium to the substrate, read back reversed, and goes on the back as it was',
    close(backRead.map(l => l.thickness), [...twoSided.backLayers].reverse().map(l => l.thickness), 1e-3)
    && close(backAgain.backLayers.map(l => l.thickness), twoSided.backLayers.map(l => l.thickness), 1e-3)
    && spectraClose(api.spectrum(backAgain, GRID), api.spectrum(twoSided, GRID), 1e-4), JSON.stringify(backRead.map(l => l.thickness)));
const zemaxBack = api.importZemaxCoating(fresh, at('back.dat')).design;
ok('the Zemax back read onto a front faces air as it did', close(zemaxBack.frontLayers.map(l => l.thickness), [...twoSided.backLayers].reverse().map(l => l.thickness), 1e-3));

// ── 5. Refusals ─────────────────────────────────────────────────────────────
before = saves.length;
const refusedFile = at('refused.dat');
const REFUSED = [
    ['an empty side', () => api.saveZemaxCoating(stack, refusedFile, { side: 'back' }), 'emptySide'],
    ['an empty side', () => api.saveCodevCoating(stack, refusedFile, { side: 'back' }), 'emptySide'],
    ['a file that is there', () => api.saveZemaxCoating(stack, at('defaults.dat')), 'fileExists'],
    ['a file that is there', () => api.saveCodevCoating(stack, at('defaults.seq')), 'fileExists'],
    ['a thickness mode', () => api.saveZemaxCoating(stack, refusedFile, { thickness: 'waves' }), 'badValue'],
    ['a scope', () => api.saveZemaxCoating(stack, refusedFile, { scope: 'some' }), 'badValue'],
    ['a range', () => api.saveZemaxCoating(stack, refusedFile, { from: 600, to: 600 }), 'wavelengthRange'],
    ['a range', () => api.saveCodevCoating(stack, refusedFile, { from: 800, to: 400 }), 'wavelengthRange'],
    ['an angle', () => api.saveCodevCoating(stack, refusedFile, { angles: [0, 90] }), 'badValue'],
    ['an option', () => api.saveCodevCoating(stack, refusedFile, { name: 'X' }), 'unknownOption'],
    ['an overwrite', () => api.saveZemaxCoating(stack, refusedFile, { overwrite: 'yes' }), 'badValue'],
    ['a path', () => api.readZemaxCoating(''), 'badValue'],
    ['a wavelength', () => api.readZemaxCoating(at('LIBRARY.DAT'), { wavelength: 0 }), 'badValue'],
    ['a coating the file does not hold', () => api.importZemaxCoating(fresh, at('LIBRARY.DAT'), { coating: 'nothing' }), 'badValue'],
    ['a place past the coatings', () => api.importZemaxCoating(fresh, at('LIBRARY.DAT'), { coating: 5 }), 'badValue'],
    ['the front of a design scored on its back alone', () => api.importZemaxCoating(backOnly, at('LIBRARY.DAT')), 'closedSide'],
    ['the back of a symmetric design', () => api.importCodevCoating(api.setDesignSetup(fresh, { surfaceMode: 'symmetric' }), at('defaults.seq'), { side: 'back' }), 'closedSide'],
    ['the back of a design scored on its front alone', () => api.importCodevCoating(fresh, at('defaults.seq'), { side: 'back' }), 'closedSide'],
    ['a side', () => api.importCodevCoating(fresh, at('defaults.seq'), { side: 'total' }), 'badValue'],
];
const codes = REFUSED.map(([, make]) => thrown(make)?.code);
ok('a value an option cannot take, a side that is empty or closed and a file that is there are refused with their codes',
    REFUSED.every(([, , code], j) => codes[j] === code), REFUSED.map(([what], j) => `${what} ${codes[j]}`).join(', '));
fs.writeFileSync(at('nothing.dat'), 'just text\n');
fs.writeFileSync(at('broken.seq'), 'MUL\nCOA 10 0 1.5\n');
const MESSAGES = [
    [() => api.importZemaxCoating(fresh, at('LIBRARY.DAT'), { coating: 'HALF' }), `importZemaxCoating: ${zemax.importNotStack}`],
    [() => api.readZemaxCoating(at('nothing.dat')), `readZemaxCoating: ${at('nothing.dat')}: ${zemax.errParse}`],
    [() => api.saveCodevCoating(stack, refusedFile, { step: 1 }), `saveCodevCoating: ${codev.errTooManyWavelengths(401, 100)}`],
];
ok('a coating that is not a stack, a file of neither, and more wavelengths than CODE V takes are refused in the windows\' words',
    MESSAGES.every(([make, message]) => thrown(make)?.message === message), MESSAGES.map(([make]) => thrown(make)?.message).join(' | '));
ok('a COAT none of whose layers converts is refused with what the conversion said', /^importZemaxCoating: .*AL2O3/.test(thrown(() => api.importZemaxCoating(fresh, at('LIBRARY.DAT'), { coating: 'LOST' }))?.message ?? ''),
    thrown(() => api.importZemaxCoating(fresh, at('LIBRARY.DAT'), { coating: 'LOST' }))?.message);
ok('a file the CODE V reader cannot read is refused naming it', /^readCodevCoating: .*broken\.seq: /.test(thrown(() => api.readCodevCoating(at('broken.seq')))?.message ?? '')
    && /^importCodevCoating: .*missing\.seq: /.test(thrown(() => api.importCodevCoating(fresh, at('missing.seq')))?.message ?? ''));
ok('no refusal wrote a file or a catalog', !fs.existsSync(refusedFile) && saves.length === before);

// ── 6. The object methods against the plain calls ───────────────────────────
const objects = await import('../src/api/objects/index.js');
const tf = await objects.start();
const coated = new objects.Design(twoSided);
tf.saveZemaxCoating(coated, at('object.dat'), { name: 'Coated', thickness: 'relative', wavelength: 600, start: 450, end: 700, step: 50, side: 'back' });
api.saveZemaxCoating(twoSided, at('plain.dat'), { name: 'Coated', thickness: 'relative', wavelength: 600, from: 450, to: 700, step: 50, side: 'back' });
const objectNotes = tf.saveCodevCoating(coated, at('object.seq'), { title: 'Two', saveName: 'two', start: 450, end: 700, step: 25, angles: [0, 30] });
const plainNotes = api.saveCodevCoating(twoSided, at('plain.seq'), { title: 'Two', saveName: 'two', from: 450, to: 700, step: 25, angles: [0, 30] });
ok('tf.saveZemaxCoating() and tf.saveCodevCoating() write the plain calls\' files, start and end for from and to',
    text(at('object.dat')) === text(at('plain.dat')) && text(at('object.seq')) === text(at('plain.seq')) && isDeepStrictEqual(objectNotes, plainNotes));
ok('tf.readZemaxCoating() and tf.readCodevCoating() are the plain calls',
    isDeepStrictEqual(tf.readZemaxCoating(at('LIBRARY.DAT'), { wavelength: 550 }), api.readZemaxCoating(at('LIBRARY.DAT'), { wavelength: 550 }))
    && isDeepStrictEqual(tf.readCodevCoating(at('plain.seq')), api.readCodevCoating(at('plain.seq'))));
const ownDesign = new objects.Design(fresh);
const objectSkipped = ownDesign.importZemaxCoating(at('LIBRARY.DAT'), { coating: 'AR3', wavelength: 600 });
const plainImport = api.importZemaxCoating(fresh, at('LIBRARY.DAT'), { coating: 'AR3', wavelength: 600 });
const backDesign = new objects.Design(both);
const objectRead = backDesign.importCodevCoating(at('plain.seq'), { side: 'back' });
const plainBack = api.importCodevCoating(both, at('plain.seq'), { side: 'back' });
const withoutIds = layers => layers.map(({ id: _id, ...l }) => l);
ok('design.importZemaxCoating() and design.importCodevCoating() put in what the plain calls put in and give their warnings',
    isDeepStrictEqual(withoutIds(ownDesign._data.frontLayers), withoutIds(plainImport.design.frontLayers)) && isDeepStrictEqual(objectSkipped, plainImport.warnings)
    && isDeepStrictEqual(layerRows(backDesign._data.backLayers), layerRows(plainBack.design.backLayers)) && isDeepStrictEqual(objectRead, plainBack.warnings));
const OBJECT_REFUSALS = [
    [() => tf.saveZemaxCoating(coated, refusedFile, { to: 700 }),
        "saveZemaxCoating: unknown option 'to'; the options are name, thickness, wavelength, step, scope, side, overwrite, start, end"],
    [() => tf.saveCodevCoating(coated, refusedFile, { start: 700, end: 450 }), 'saveCodevCoating: start and end are wavelengths in nm, 0 < start < end'],
    [() => tf.saveZemaxCoating(twoSided, refusedFile), 'saveZemaxCoating: design is a Design, as tf.newDesign() or tf.openDesign() gives one'],
];
ok('their refusals are in the objects\' words', OBJECT_REFUSALS.every(([make, message]) => thrown(make)?.message === message),
    OBJECT_REFUSALS.map(([make]) => thrown(make)?.message).join(' | '));

fs.rmSync(TEMP, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
