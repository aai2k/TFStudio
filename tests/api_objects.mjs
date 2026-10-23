/**
 * The object API (src/api/objects) gives what the plain calls (src/api) give
 * for the same design, as tests/_pythonObjects.mjs checks the Python
 * package's objects:
 *
 *   newDesign, with its arguments and with them left out, and stack with
 *   symbols, on the back from the outermost layer in, and an option stack
 *   does not take; layer edits by number from the
 *   substrate, on the front and the back, a copy changing apart, numbers a side
 *   has no layer of refused, and layers[n] not set; the setup attributes
 *   (substrate material and thickness in mm, media, name, and a reference
 *   that rescales the layers); save(), refusing a file that is there without
 *   overwrite, and openDesign(); sides and scoreOn
 *   round-tripping to surfaceMode and mfEvalMode, and the mode of a spectrum, a
 *   Monte Carlo run, a refinement, a layer ranking, an index profile and a
 *   list of layer thicknesses being the API's evaluation mode, and the
 *   design's facts counting its coated sides, for every pair; materials by id, catalog:key ids
 *   included, by name and by the builtin: id a stacked layer holds, and their
 *   n and k, and a name two materials share refused; spectrum curves at two
 *   angles as arrays, their mean, min and max over a band and the whole range,
 *   and the CSV file; merit rows, with start and end left out before the
 *   options, and options given as undefined or null, value, rows and clear(),
 *   and rows added in separate processes, as separate Script Console runs add
 *   them, each with an id of its own; specification checks of every kind
 *   added with the wavelengths each kind takes and the defaults add()
 *   documents, read back as SpecChecks, removed and cleared, the verdict of
 *   check(), estimateYield() with a seed, its documented defaults, progress,
 *   stop and a progress that throws, and a Monte Carlo run's spec as a Yield;
 *   clean() changing the design in place to what cleanDesign gives, its
 *   options by the objects' names, its defaults and a symmetric design's
 *   back, its operations naming their layers by number on both sides, and its
 *   refusals in the objects' words; indexProfile() and layerThicknesses()
 *   with their defaults and options, totalThickness(), opticalThickness()
 *   and layerCounts() with and without side, layer.qwot read and set on both
 *   sides, and their refusals in the objects' words; refine and synthesize with seeds, Monte
 *   Carlo with a seed and layer sensitivity, its step 'nm' or 'percent', with
 *   back rows and locked rows; the Progress objects of a refinement, a Needle
 *   run, a Deep Synthesis run and a Monte Carlo run; a stop aborted in
 *   progress and before the run, a run of each method stopped part way leaving
 *   the design as it was, Deep Synthesis's included, a progress function that
 *   throws at any report of a run of each method, ending a long run there
 *   whether the run was given a stop or not, and a stop or progress of the
 *   wrong kind; the refusals of the plain calls the objects make, in the
 *   objects' words, the layer edits' included, while the plain calls keep
 *   theirs.
 *
 * Run: node tests/api_objects.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspect } from 'node:util';
import { execFileSync } from 'node:child_process';
import { encode } from '../src/apiServer/wire.js';
import { deleteOperands } from '../src/components/windows/optimization/meritFunctionEditor/meritOperandModel.js';
import { QUALIFIER_KINDS } from '../src/utils/synthesis/qualifiers.js';
import { fixtureFile } from './_apiCorpus.mjs';

const api = await import('../src/api/index.js');
const objects = await import('../src/api/objects/index.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
// A value without what differs from one computation of it to the next: the
// ids a design draws at random, and the time a synthesis step took (tMs).
const DRAWN = new Set(['id', 'tMs']);
const undrawn = v => {
    if (Array.isArray(v)) return v.map(undrawn);
    if (!v || typeof v !== 'object' || ArrayBuffer.isView(v)) return v;
    return Object.fromEntries(Object.entries(v).filter(([key]) => !DRAWN.has(key)).map(([key, x]) => [key, undrawn(x)]));
};
const canon = v => encode(undrawn(v));
// The engine prints as it runs; the runs made here keep it off the test's output.
const quietly = async run => {
    const { log, warn, info } = console;
    console.log = console.warn = console.info = () => {};
    try { return await run(); } finally { Object.assign(console, { log, warn, info }); }
};
// The message of what `make` threw, or null.
const refused = async make => {
    try { await make(); return null; } catch (err) { return err.message; }
};

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-objects-'));
// A data folder with two user catalogs, each holding a material named
// SHARED, a name no material has as its id.
const SHARED = 'Lab film';
const dataDir = path.join(WORK, 'data');
{
    const userDir = path.join(dataDir, 'Materials', 'user');
    fs.mkdirSync(userDir, { recursive: true });
    const lab = JSON.parse(fs.readFileSync(new URL('./fixtures/designs/user-catalog-no-copy/catalogs/catalog-present/user/user_lab.catalog.json', import.meta.url), 'utf8'));
    for (const id of ['lab_a', 'lab_b']) {
        const materials = { Ta2O5: { ...lab.materials.Ta2O5, name: SHARED } };
        fs.writeFileSync(path.join(userDir, `${id}.catalog.json`), JSON.stringify({ ...lab, id, name: id, materials }));
    }
}
const tf = await objects.start({ dataDir });
const POOL = ['TiO2', 'SiO2'];
const QUANTITIES = ['R', 'T', 'A', 'Rs', 'Rp', 'Ts', 'Tp', 'As', 'Ap'];
const listed = layers => [...layers].map(layer => [layer.number, layer.side, layer.material, layer.thickness, layer.locked]);
const stored = (layers, side) => layers.map((layer, i) => [i + 1, side, layer.material, layer.thickness, !!layer.locked]);
// A layer ranking's rows as the API gives them, numbered as the objects number
// a side's layers, and as a LayerSensitivity gives them.
const apiRanks = (ranking, frontCount) => ranking.rows.map(r => [r.side, r.side === 'front' ? frontCount - r.layerIndex : r.layerIndex + 1, r.materialId,
    r.thickness, r.deltaNm, r.deltaMFAbs, r.deltaMF, r.sensitivity, r.locked]);
const objectRanks = ranking => ranking.rows.map(r => [r.side, r.number, r.material, r.thickness, r.step, r.meritChange, r.signedMeritChange, r.sensitivity, r.locked]);
const SIDE_LAYERS = { front: 'layers', back: 'backLayers' };

// ── Designs and their layers ────────────────────────────────────────────────
const design = tf.newDesign('Stack', { substrate: 'BK7', reference: 550 });
const fresh = design._data;
ok('newDesign is newDesign with the name, substrate and reference wavelength',
    canon(fresh) === canon(api.newDesign({ name: 'Stack', substrate: 'BK7', referenceWavelength: 550 })));
ok('and its name may be left out before the options, and every argument after', canon(tf.newDesign({ substrate: 'SiO2' })._data) === canon(api.newDesign({ substrate: 'SiO2' }))
    && canon(tf.newDesign()._data) === canon(api.newDesign()));
ok('and options given as undefined or null are no options', canon(tf.newDesign('Stack', undefined)._data) === canon(fresh)
    && canon(tf.newDesign('Stack', null)._data) === canon(fresh));
design.stack('(HL)^3 H', { H: 'TiO2', L: 'SiO2', at: 600 });
const stacked = design._data;
ok('stack is stackFromFormula with the symbols, and at as the reference wavelength',
    canon(stacked) === canon(api.stackFromFormula(fresh, { formula: '(HL)^3 H', symbols: { H: 'TiO2', L: 'SiO2' }, referenceWavelength: 600 })));
const stackOption = await refused(() => design.copy().stack('HL', { sid: 'back' }));
ok('and an option stack does not take is refused, naming those it takes',
    stackOption === "stack: unknown option 'sid'; the options are at, side, fromSubstrate, and a letter for each symbol", stackOption);
{
    // H and L are different materials, so a formula read from the wrong end shows.
    const backed = design.copy();
    backed.sides = 'both';
    const before = backed._data;
    backed.stack('HL', { side: 'back', fromSubstrate: false, H: 'Ta2O5' });
    ok('side and fromSubstrate are stackFromFormula\'s side and startFromSubstrate',
        canon(backed._data) === canon(api.stackFromFormula(before, { formula: 'HL', symbols: { H: 'Ta2O5' }, side: 'back', startFromSubstrate: false })));
}

design.layers[1].thickness = 12.5;
design.layers[3].locked = true;
design.layers[2].material = 'Ta2O5';
design.layers.append('MgF2', 95);
design.layers.insert(2, 'Al2O3', 20);
design.layers.remove(4);
// Layer n on the front is the API's index count - n, the outermost first; a
// new layer n goes in at count + 1 - n.
const front = d => d.frontLayers.length;
const FRONT_EDITS = [
    d => api.setLayer(d, { index: front(d) - 1, thickness: 12.5 }),
    d => api.setLayer(d, { index: front(d) - 3, locked: true }),
    d => api.setLayer(d, { index: front(d) - 2, material: 'Ta2O5' }),
    d => api.insertLayer(d, { index: 0, material: 'MgF2', thickness: 95 }),
    d => api.insertLayer(d, { index: front(d) + 1 - 2, material: 'Al2O3', thickness: 20 }),
    d => api.deleteLayer(d, { index: front(d) - 4 }),
];
const edited = FRONT_EDITS.reduce((d, edit) => edit(d), stacked);
ok('layer edits by number from the substrate are the API\'s edits at the front\'s indices', canon(design._data) === canon(edited));
ok('and the layers go from layer 1, next to the substrate, outward', canon(listed(design.layers)) === canon(stored([...edited.frontLayers].reverse(), 'front'))
    && design.layers[1].thickness === 12.5 && design.layers.length === edited.frontLayers.length, JSON.stringify(listed(design.layers)));
const count = design.layers.length;
const numbered = `the front has ${count} layers, numbered from 1 next to the substrate`;
const refusals = [
    await refused(() => design.layers[0]), await refused(() => design.layers[count + 1]),
    await refused(() => design.layers.insert(count + 2, 'SiO2', 10)), await refused(() => design.layers.remove('1')), await refused(() => design.layers[1.5]),
];
ok('a number the side has no layer of is refused, naming the numbers', JSON.stringify(refusals) === JSON.stringify([
    `layer 0: ${numbered}`, `layer ${count + 1}: ${numbered}`, `layer ${count + 2}: ${numbered}, and a new one can be layer ${count + 1}`,
    `layer "1": ${numbered}`, `layer 1.5: ${numbered}`]), JSON.stringify(refusals));
const setWhole = await refused(() => { design.layers[1] = 5; });
ok('layers[n] cannot be set, and setting it changes nothing', setWhole === 'layers[1] cannot be set: set its material, thickness or locked, or use insert() and remove()'
    && canon(design._data) === canon(edited), setWhole);

const both = design.copy();
both.sides = 'both';
both.backLayers.append('SiO2', 100);
both.backLayers.append('TiO2', 30);
both.backLayers.insert(1, 'MgF2', 40);
both.backLayers[2].thickness = 21;
both.backLayers.remove(3);
// On the back, layer n is the API's index n - 1.
const BACK_EDITS = [
    d => api.setDesignSetup(d, { surfaceMode: 'both_independent' }),
    d => api.insertLayer(d, { side: 'back', index: d.backLayers.length, material: 'SiO2', thickness: 100 }),
    d => api.insertLayer(d, { side: 'back', index: d.backLayers.length, material: 'TiO2', thickness: 30 }),
    d => api.insertLayer(d, { side: 'back', index: 0, material: 'MgF2', thickness: 40 }),
    d => api.setLayer(d, { side: 'back', index: 1, thickness: 21 }),
    d => api.deleteLayer(d, { side: 'back', index: 2 }),
];
const back = BACK_EDITS.reduce((d, edit) => edit(d), edited);
ok('on the back, layer n is the API\'s index n - 1', canon(both._data) === canon(back) && canon(listed(both.backLayers)) === canon(stored(back.backLayers, 'back')),
    JSON.stringify(listed(both.backLayers)));
ok('a copy changes apart from its design', design._data.surfaceMode === 'front_only' && canon(design._data) === canon(edited));
const symmetric = both.copy();
symmetric.sides = 'symmetric';
const symmetricBack = await refused(() => { symmetric.backLayers[1].thickness = 5; });
ok('the back of a symmetric design is refused', symmetricBack === 'layer 1: the back of a symmetric design mirrors its front; edit the front', symmetricBack);

// ── The design's setup ──────────────────────────────────────────────────────
{
    // The design's reference is 600 nm after stack(), so 700 rescales its
    // layers; the four materials differ, so a setter that sets another shows.
    const set = design.copy();
    set.substrate.material = 'Al2O3';
    set.substrate.thickness = 3;
    set.incidentMedium = 'MgF2';
    set.exitMedium = 'SiO2';
    set.name = 'Renamed';
    set.reference = 700;
    const there = api.setDesignSetup(design._data,
        { substrate: 'Al2O3', substrateThicknessMm: 3, incidentMedium: 'MgF2', exitMedium: 'SiO2', name: 'Renamed', referenceWavelength: 700 });
    const read = [set.substrate.material, set.substrate.thickness, set.incidentMedium, set.exitMedium, set.name, set.reference];
    ok('the setup attributes are setDesignSetup\'s options, the substrate thickness in mm, and a new reference rescales the layers',
        canon(set._data) === canon(there) && canon(read) === canon(['Al2O3', 3, 'MgF2', 'SiO2', 'Renamed', 700])
        && canon(set._data.frontLayers) !== canon(design._data.frontLayers), JSON.stringify(read));
}

// ── save() and openDesign() ─────────────────────────────────────────────────
{
    const file = path.join(WORK, 'saved.tfs');
    const plainFile = path.join(WORK, 'plain.tfs');
    const rated = design.copy();
    rated.merit.add('RAV', 450, 650, { target: 0 });
    rated.save(file);
    api.saveDesign(rated._data, plainFile);
    const bytes = fs.readFileSync(file);
    const again = await refused(() => rated.save(file));
    const kept = fs.readFileSync(file).equals(bytes);
    rated.name = 'Saved again';
    rated.save(file, { overwrite: true });
    const opened = tf.openDesign(file);
    ok('save() writes what saveDesign writes, and refuses a file that is there without overwrite, which it leaves as it was',
        bytes.toString('utf8') === fs.readFileSync(plainFile, 'utf8') && again === `save: ${file} exists; pass { overwrite: true } to write over it` && kept, again);
    ok('and writes over it with overwrite, which openDesign() reads as openDesign does', canon(opened._data) === canon(api.openDesign(file))
        && opened.name === 'Saved again' && opened.merit.length === 1, opened.name);
}

// ── sides, scoreOn and the mode of each result ──────────────────────────────
const SIDES = { front: 'front_only', back: 'back_only', both: 'both_independent', symmetric: 'symmetric' };
const SCORE_ON = { side: 'side', 'whole part': 'total' };
{
    const twoSided = both.copy();
    twoSided.merit.add('RAV', 450, 650, { target: 0 });
    const wrong = [];
    const kinds = new Set();
    for (const sides of Object.keys(SIDES)) {
        for (const scoreOn of Object.keys(SCORE_ON)) {
            const each = twoSided.copy();
            each.sides = sides;
            each.scoreOn = scoreOn;
            const held = [each.sides, each.scoreOn, each._data.surfaceMode, each._data.mfEvalMode].join() === [sides, scoreOn, SIDES[sides], SCORE_ON[scoreOn]].join();
            const { evalMode } = api.spectrum(api.setDesignSetup(twoSided._data, { surfaceMode: SIDES[sides], mfEvalMode: SCORE_ON[scoreOn] }), { from: 500, to: 600, step: 50 });
            const found = [each.spectrum(500, 600, { step: 50 }).mode, (await each.monteCarlo(500, 600, { step: 50, runs: 1, seed: 1 })).mode,
                (await quietly(() => each.copy().refine({ maxIter: 1 }))).mode, each.layerSensitivity().mode,
                each.indexProfile().mode, each.layerThicknesses().mode];
            kinds.add(evalMode);
            if (!held || !found.every(mode => mode === evalMode)) wrong.push(`${sides}/${scoreOn}: ${found} / ${evalMode}`);
            // The facts count the coated sides, which the TT row sums, whatever the scoring.
            const facts = api.designFacts(each._data);
            const coated = { front: 'front', back: 'back', both: 'total', symmetric: 'front' }[sides];
            if (canon([facts.mode, each.totalThickness()]) !== canon([coated, facts.thickness])) wrong.push(`${sides}/${scoreOn}: facts ${facts.mode} / ${coated}`);
        }
    }
    ok('sides and scoreOn round-trip to surfaceMode and mfEvalMode, a spectrum\'s, a Monte Carlo run\'s, a run\'s, a ranking\'s, an index profile\'s and a thickness list\'s mode are the API\'s evaluation mode, and the facts\' the coated sides, for every pair',
        wrong.length === 0 && kinds.size === 3, wrong.join('; '));
    const badSides = await refused(() => { twoSided.sides = 'two'; });
    const badScoreOn = await refused(() => { twoSided.scoreOn = 'total'; });
    ok('sides and scoreOn the app does not have are refused, naming those it has', badSides === 'sides is \'front\', \'back\', \'both\' or \'symmetric\', not "two"'
        && badScoreOn === 'scoreOn is \'side\' or \'whole part\', not "total"', `${badSides} / ${badScoreOn}`);
}

// ── Materials ───────────────────────────────────────────────────────────────
{
    const tio2 = tf.materials.get('TiO2');
    const there = api.findMaterials('TiO2').find(m => m.id === 'TiO2');
    const nk = api.materialNK('TiO2', [400, 550, 700]).nk;
    ok('tf.materials.get(id) is the material, and nk() gives [n, k] at one wavelength or an array of each at several',
        canon([tio2.id, tio2.name, tio2.catalog]) === canon([there.id, there.name, there.catalog]) && canon(tio2.nk(550)) === canon([nk[1].n, nk[1].k])
        && canon(tio2.nk([400, 550, 700])) === canon([nk.map(p => p.n), nk.map(p => p.k)]));
    const named = api.findMaterials('').find(m => m.catalog === 'builtin' && m.name !== m.id);
    const unknown = await refused(() => tf.materials.get('Unobtainium'));
    ok('find() finds what findMaterials finds, get(name) goes by name too, and an unknown material is refused',
        canon(tf.materials.find('SiO2').map(m => m.id)) === canon(api.findMaterials('SiO2').map(m => m.id)) && tf.materials.get(named.name).id === named.id
        && /^materials: no material has the id or name 'Unobtainium'/.test(unknown ?? ''), unknown);
    const stackedOn = tf.newDesign();
    stackedOn.stack('(HL)^2 H');
    const held = stackedOn.layers[1].material;
    const heldMaterial = tf.materials.get(held);
    const heldNK = api.materialNK(held, [550]).nk[0];
    ok('get() takes the builtin: id a layer stack() made holds, as the built-in material of that id',
        /^builtin:/.test(held) && heldMaterial.id === held.slice('builtin:'.length) && heldMaterial.catalog === 'builtin'
        && canon(heldMaterial.nk(550)) === canon([heldNK.n, heldNK.k]), held);
    const sharing = api.findMaterials(SHARED).filter(m => m.name === SHARED).map(m => m.id);
    const shared = await refused(() => tf.materials.get(SHARED));
    ok('a name two materials share, and no material has as its id, is refused, naming their ids, by which get() takes each',
        sharing.length === 2 && shared === `materials: 2 materials are named '${SHARED}': take one by its id, ${sharing.join(', ')}`
        && sharing.every(id => tf.materials.get(id).id === id), shared);
}

// ── Spectra ─────────────────────────────────────────────────────────────────
{
    const s = design.spectrum(400, 700, { step: 10, angles: [45, 0] });
    const there = api.spectrum(design._data, { from: 400, to: 700, step: 10, angles: [45, 0] });
    const [whole, band] = api.summarize(there, { bands: [{ from: 450, to: 650 }] })[45];
    const axes = s.mode === there.evalMode && canon(s.wavelength) === canon(there.lambda) && canon(s.angles) === '[45,0]';
    const curves = QUANTITIES.every(q => canon(s[q]) === canon(there.angles[45][q]) && canon(s.angle(0)[q]) === canon(there.angles[0][q]));
    ok('a spectrum\'s curves are the API\'s, at the first angle asked and at another', axes && curves && canon(s.outOfRange) === canon(there.outOfRange));
    const isCurve = Array.isArray(s.R) && s.R instanceof objects.Curve && canon(s.R.wavelength) === canon(there.lambda);
    const plainMade = !(s.R.map(x => x) instanceof objects.Curve);
    ok('and are arrays, whose array methods make plain arrays', isCurve && plainMade && Math.max(...s.R) === Math.max(...there.angles[45].R));
    ok('a curve\'s mean, min and max are summarize\'s, over a band and over the whole range',
        canon([s.R.mean(450, 650), s.R.min(450, 650), s.R.max(450, 650)]) === canon([band.R.mean, band.R.min, band.R.max])
        && canon([s.T.mean(), s.T.min(), s.T.max()]) === canon([whole.T.mean, whole.T.min, whole.T.max]));
    const noAngle = await refused(() => s.angle(30));
    const noBand = await refused(() => s.R.mean(800, 900));
    ok('an angle the spectrum was not computed at, and a band with no wavelength of it, are refused', noAngle === 'angle: the spectrum was computed at [45, 0], not at 30'
        && noBand === 'mean: no wavelength of this curve is from 800 to 900 nm', `${noAngle} / ${noBand}`);
    const file = path.join(WORK, 'spectrum.csv');
    s.saveCsv(file);
    const csv = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map(line => line.split(','));
    const header = ['Wavelength (nm)', ...[45, 0].flatMap(angle => QUANTITIES.map(q => `${q} at ${angle} deg`))];
    const rows = there.lambda.map((lambda, i) => [lambda, ...[45, 0].flatMap(angle => QUANTITIES.map(q => there.angles[angle][q][i]))]);
    ok('saveCsv writes the wavelengths, then each quantity at each angle, each headed', canon(csv[0]) === canon(header)
        && canon(csv.slice(1).map(row => row.map(Number))) === canon(rows), JSON.stringify(csv[0]));
}

// ── The merit function ──────────────────────────────────────────────────────
{
    const rated = design.copy();
    rated.merit.add('RAV', 450, 650, { target: 0 });
    rated.merit.add('MNT', 1, rated.layers.length, { target: 10 });
    rated.merit.add('TAV', 800, 900, { target: 0.95, weight: 2, aoi: 45, pol: 'p' });
    const ROWS = [{ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0 }, { type: 'MNT', lambdaStart: 1, lambdaEnd: count, target: 10 },
        { type: 'TAV', lambdaStart: 800, lambdaEnd: 900, target: 0.95, weight: 2, aoi: 45, pol: 'p' }];
    const made = api.setMerit(design._data, ROWS);
    ok('merit.add() makes the rows setMerit makes', canon(rated._data) === canon(made) && rated.merit.length === 3, canon(rated._data.meritOperands).slice(0, 300));
    const DEFAULTS = { weight: 1, aoi: 0, pol: 'avg', enabled: true };
    ok('and the defaults it documents, weight 1, aoi 0, pol avg and enabled, are the editor\'s',
        ROWS.slice(0, 2).every(row => canon(api.setMerit(design._data, [row])) === canon(api.setMerit(design._data, [{ ...row, ...DEFAULTS }]))));
    const open = design.copy();
    open.merit.add('MNT', { target: 10 });
    const tooMany = await refused(() => open.merit.add('RAV', 450, 650, 0));
    ok('start and end may be left out before the options, and a value past them is refused', canon(open._data) === canon(api.setMerit(design._data, [{ type: 'MNT', target: 10 }]))
        && tooMany === 'add: takes start and end before its options object, not 3 values', tooMany);
    const scored = api.merit(made);
    const rows = scored.rows.map(r => [r.type, r.lambdaStart ?? null, r.lambdaEnd ?? null, r.aoi ?? null, r.pol ?? null, r.target, r.weight, r.enabled, r.value, r.error]);
    const read = rated.merit.rows.map(r => [r.type, r.start, r.end, r.aoi, r.pol, r.target, r.weight, r.enabled, r.value, r.error]);
    ok('value, opticalValue and rows are merit\'s', rated.merit.value === scored.total && rated.merit.opticalValue === scored.optical && canon(read) === canon(rows),
        JSON.stringify(read));
    const cleared = rated.copy();
    cleared.merit.clear();
    ok('clear() leaves no row, in the copy alone', cleared.merit.length === 0 && rated.merit.length === 3);
    const given = design.copy();
    given.merit.add('RAV', 450, 650, undefined);
    given.merit.add('RAV', 450, 650, null);
    const plainRow = { type: 'RAV', lambdaStart: 450, lambdaEnd: 650 };
    ok('and an options object given as undefined or null is no options', canon(given._data) === canon(api.setMerit(design._data, [plainRow, plainRow])));
}

// Each Script Console run is a process of its own. A row merit.add() adds in
// one, to a design whose rows an earlier run added, gets an id of its own, so
// the Merit Function Editor, which finds a row by its id, deletes that row alone.
{
    const CHILD = [
        `import { Design } from ${JSON.stringify(new URL('../src/api/objects/index.js', import.meta.url).href)};`,
        "let text = '';",
        'for await (const chunk of process.stdin) text += chunk;',
        'const design = new Design(JSON.parse(text));',
        "design.merit.add('TAV', 800, 900, { target: 1 });",
        'process.stdout.write(JSON.stringify(design._data));',
    ].join('\n');
    const addedApart = data => JSON.parse(execFileSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', CHILD],
        { input: JSON.stringify(data), encoding: 'utf8' }));
    const rows = addedApart(addedApart(design._data)).meritOperands;
    const ids = rows.map(row => row.id);
    const { operands: left } = deleteOperands(rows, [ids[1]]);
    ok('rows merit.add() adds in separate processes each have an id of their own, so deleting one in the editor keeps the other',
        rows.length === 2 && ids[0] !== ids[1] && left.length === 1 && left[0].id === ids[0], ids.join(', '));
}

// ── The specification ───────────────────────────────────────────────────────
// A design's checks without the id each draws, as the wire writes them.
const checksOf = data => encode(data.qualifiers.map(({ id, ...check }) => check));
// A check of each kind, added to the gain flattening fixture, which holds a
// measured curve for PPEF: the arguments add() is given, and the fields
// setSpecification is given for the same check. No wavelength is one a check
// starts with, so a wavelength given to another field shows.
const measured = tf.openDesign(fixtureFile('measured-curve-ppef'));
const curveId = measured._data.measuredCurves[0].id;
const SPEC_KINDS = [
    ['T_AT', [1530, { cmp: 'ge', target: 0.5 }], { lambda: 1530, cmp: 'ge', target: 0.5 }],
    ['R_AT', [1560, { cmp: 'le', target: 0.5, aoi: 30, pol: 'p' }], { lambda: 1560, cmp: 'le', target: 0.5, aoi: 30, pol: 'p' }],
    ['A_AT', [1575], { lambda: 1575 }],
    ['T_AVG', [1510, 1590, { cmp: 'between', lo: 0.1, hi: 0.9 }], { lambdaStart: 1510, lambdaEnd: 1590, cmp: 'between', lo: 0.1, hi: 0.9 }],
    ['R_AVG', [1520, 1580, { flag: 2, label: 'R band' }], { lambdaStart: 1520, lambdaEnd: 1580, flag: 2, label: 'R band' }],
    ['A_AVG', [1505, 1595, { enabled: false }], { lambdaStart: 1505, lambdaEnd: 1595, enabled: false }],
    ['MIN_MAX', [1515, 1585, { channel: 'R', direction: 'min', cmp: 'le', target: 0.4 }],
        { lambdaStart: 1515, lambdaEnd: 1585, channel: 'R', direction: 'min', cmp: 'le', target: 0.4 }],
    ['CENTRAL_LAMBDA', [1500, 1600, { cmp: 'eq', target: 1550, tol: 20 }], { lambdaStart: 1500, lambdaEnd: 1600, cmp: 'eq', target: 1550, tol: 20 }],
    ['FWHM', [1500, 1600, { level: 0.4, bandPoints: 801, cmp: 'ge', target: 10 }], { lambdaStart: 1500, lambdaEnd: 1600, level: 0.4, bandPoints: 801, cmp: 'ge', target: 10 }],
    ['EDGE_LAMBDA', [1500, 1600, { channel: 'R', edgeSide: 'right', cmp: 'ge', target: 1520 }],
        { lambdaStart: 1500, lambdaEnd: 1600, channel: 'R', edgeSide: 'right', cmp: 'ge', target: 1520 }],
    ['INTEGRAL', [1500, 1600, { channel: 'R', source: { id: 'blackbody', T: 3000 }, detector: { id: 'flat' }, presetLabel: 'Lamp' }],
        { lambdaStart: 1500, lambdaEnd: 1600, channel: 'R', source: { id: 'blackbody', T: 3000 }, detector: { id: 'flat' }, presetLabel: 'Lamp' }],
    ['INTEGRAL', [{ presetKey: 'TNIR', cmp: 'ge', target: 0.5 }], { presetKey: 'TNIR', cmp: 'ge', target: 0.5 }],
    ['THICKNESS_BUDGET', [{ cmp: 'le', target: 5000, side: 'front' }], { cmp: 'le', target: 5000, side: 'front' }],
    ['LAYER_COUNT', [{ cmp: 'le', target: 30 }], { cmp: 'le', target: 30 }],
    ['PPEF', [{ curveId, cmp: 'le', target: 3 }], { curveId, cmp: 'le', target: 3 }],
];
// SpecCheck's attributes, by the fields of a check they read.
const SPEC_FIELDS = {
    kind: 'kind', label: 'label', enabled: 'enabled', cmp: 'cmp', target: 'target', tol: 'tol', lo: 'lo', hi: 'hi', wavelength: 'lambda',
    start: 'lambdaStart', end: 'lambdaEnd', aoi: 'aoi', pol: 'pol', channel: 'channel', direction: 'direction', level: 'level',
    edgeSide: 'edgeSide', flag: 'flag', side: 'side', presetKey: 'presetKey', presetLabel: 'presetLabel', source: 'source',
    detector: 'detector', bandPoints: 'bandPoints', curveId: 'curveId',
};
// A mirror whose checks a few % of thickness error fails now and then, and a
// check left out of the verdict.
const yielded = tf.newDesign('Mirror');
yielded.stack('(HL)^5 H');
yielded.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9953 });
yielded.specification.add('R_AT', 550, { cmp: 'ge', target: 0.99585 });
yielded.specification.add('LAYER_COUNT', { cmp: 'le', target: 15 });
yielded.specification.add('T_AT', 600, { cmp: 'le', target: 0.5, enabled: false });
const ERRORS = { thicknessRelPct: 3, indexRe: 0.01, distribution: 'uniform', seed: 9 };
// A yield's fields, and those of the API's answer they are read from.
const yieldRead = y => [y.value, y.passCount, y.evaluated, y.interval, y.checks, y.runs, y.seed, y.mode];
const yieldThere = (spec, seed, mode) => [spec.yield, spec.passCount, spec.evaluated, spec.yieldInterval, spec.perQualifier, spec.nTrials, seed, mode];
{
    const added = measured.copy();
    const before = added.specification;
    SPEC_KINDS.forEach(([kind, args]) => added.specification.add(kind, ...args));
    const made = api.setSpecification(measured._data, SPEC_KINDS.map(([kind, , fields]) => ({ kind, ...fields })));
    const ids = added._data.qualifiers.map(check => check.id);
    ok('specification.add() makes the checks setSpecification makes, with the wavelengths each kind takes', checksOf(added._data) === checksOf(made),
        checksOf(added._data).slice(0, 300));
    ok('for every kind', QUALIFIER_KINDS.every(kind => SPEC_KINDS.some(([listed]) => listed === kind)));
    ok('and changes the design in place, the rest of it as it was', canon({ ...added._data, qualifiers: null }) === canon({ ...measured._data, qualifiers: null }));
    ok('a Specification read before the adds seeing them, each check with an id of its own, and the design copied from without one',
        before.length === SPEC_KINDS.length && new Set(ids).size === ids.length && measured.specification.length === 0);
    // A check the app saved that setSpecification refuses, such as one of an
    // integral preset its user saved, stays as it is when a check is added.
    const saved = { ...made.qualifiers[11], id: 'saved', presetKey: 'My preset' };
    const holding = measured.copy();
    holding._data = { ...holding._data, qualifiers: [saved] };
    holding.specification.add('LAYER_COUNT', { cmp: 'le', target: 30 });
    ok('and a check the app saved that setSpecification refuses stays as it was', encode(holding._data.qualifiers[0]) === encode(saved) && holding.specification.length === 2);
    const DEFAULTS = { cmp: 'ge', target: 0.99, lo: 0.95, hi: 1, aoi: 0, pol: 'avg', channel: 'T', direction: 'max', level: 0.5, presetKey: '', presetLabel: '',
        source: { id: 'D65' }, detector: { id: 'photopic' }, label: '', enabled: true };
    const plainAdded = design.copy();
    plainAdded.specification.add('MIN_MAX');
    plainAdded.specification.add('T_AT');
    ok('and the defaults it documents are the window\'s, 550 nm for one wavelength and 400 to 700 nm for a band among them',
        checksOf(plainAdded._data) === checksOf(api.setSpecification(design._data, [{ kind: 'MIN_MAX', ...DEFAULTS, lambdaStart: 400, lambdaEnd: 700 },
            { kind: 'T_AT', ...DEFAULTS, lambda: 550 }])));

    const rows = added.specification.rows;
    const read = rows.map(check => Object.keys(SPEC_FIELDS).map(name => check[name]));
    // The wire writes a field a check does not hold as null, as its attribute gives it.
    const held = added._data.qualifiers.map(check => Object.values(SPEC_FIELDS).map(field => check[field]));
    const getters = Object.getOwnPropertyNames(objects.SpecCheck.prototype).filter(name => name !== 'constructor').sort();
    ok('rows are SpecChecks', rows.every(check => check instanceof objects.SpecCheck));
    ok('each attribute reading its field of the check', encode(read) === encode(held), encode(read[0]));
    ok('every attribute among them', encode(getters) === encode(Object.keys(SPEC_FIELDS).sort()), encode(getters));
    rows[10].source.T = 1;
    ok('as they were when rows was read, so changing what one holds changes nothing', added._data.qualifiers[10].source.T === 3000);

    const removed = added.copy();
    removed.specification.remove(1);
    removed.specification.remove(removed.specification.length - 1);
    const last = SPEC_KINDS.length - 1;
    ok('remove() takes out the check at its index from 0, the others staying in order',
        checksOf(removed._data) === checksOf({ qualifiers: made.qualifiers.filter((_, i) => ![1, last].includes(i)) }));
    const count = added.specification.length;
    const outside = await Promise.all([-1, count, 1.5, '1', true].map(index => refused(() => added.specification.remove(index))));
    const numberedFrom0 = `the specification has ${count} checks, numbered from 0`;
    ok('and refuses an index the specification has no check at, naming the indices', encode(outside) === encode([`check -1: ${numberedFrom0}`,
        `check ${count}: ${numberedFrom0}`, `check 1.5: ${numberedFrom0}`, `check "1": ${numberedFrom0}`, `check true: ${numberedFrom0}`]), encode(outside));
    const cleared = added.copy();
    cleared.specification.clear();
    ok('clear() leaves no check, in the copy alone', canon(cleared._data) === canon(api.setSpecification(added._data, [])) && cleared.specification.length === 0
        && added.specification.length === count);

    const report = added.specification.check();
    const verdict = api.checkSpecification(added._data);
    const resultRows = report.rows.map(r => [r.kind, r.label, r.value, r.unit, r.passed, r.margin, r.threshold, r.reason]);
    const plainRows = verdict.rows.map(r => [r.kind, r.label, r.value, r.unit, r.passed, r.margin, r.threshold, r.reason]);
    const passes = [...new Set(report.rows.map(r => r.passed))].sort();
    const signs = [...new Set(report.rows.map(r => Math.sign(r.margin)))].sort();
    ok('check() is checkSpecification: each row with its kind, label, value, unit, verdict, margin, threshold and reason',
        encode(resultRows) === encode(plainRows), encode(resultRows).slice(0, 300));
    ok('a SpecReport of CheckResults', report instanceof objects.SpecReport && report.rows.every(r => r instanceof objects.CheckResult));
    ok('with checks that pass, fail and are left out, and margins on both sides of 0', encode(passes) === '[false,null,true]' && signs.includes(-1) && signs.includes(1),
        `${encode(passes)} ${encode(signs)}`);
    ok('and passed, passing, total and mode are its', encode([report.passed, report.passing, report.total, report.mode])
        === encode([verdict.passed, verdict.passing, verdict.total, verdict.mode]) && report.total === count - 1 && report.passing > 0);
    const whole = added.copy();
    whole.scoreOn = 'whole part';
    ok('and its mode is what the design is scored on', report.mode === 'front' && whole.specification.check().mode === 'total');
    const layerCount = report.rows[13];
    ok('console.log shows a disabled check as disabled, and a value with no unit without one', inspect(report.rows[5]) === '<CheckResult A_AVG: disabled>'
        && inspect(layerCount) === `<CheckResult LAYER_COUNT: ${layerCount.value}, ${layerCount.passed ? 'passed' : 'not passed'}>`,
        `${inspect(report.rows[5])} ${inspect(layerCount)}`);
}
{
    const y = await yielded.specification.estimateYield(40, ERRORS);
    const there = await api.estimateYield(yielded._data, { runs: 40, ...ERRORS });
    ok('estimateYield() is the API\'s estimateYield with the same seed: value, passCount, evaluated, interval, checks, runs, seed and mode',
        encode(yieldRead(y)) === encode(yieldThere(there, there.seed, there.mode)), encode(yieldRead(y)));
    ok('a Yield, of some trials and not all, the checks failing in shares of their own', y instanceof objects.Yield && y.value > 0 && y.value < 1
        && new Set(y.checks.map(check => check.failRate)).size === 3);
    ok('console.log shows the yield with the trials that passed of those checked', inspect(y) === `<Yield ${y.value} (${y.passCount} of ${y.evaluated} checked), seed 9>`, inspect(y));
    const defaulted = await yielded.specification.estimateYield(30, { seed: 4 });
    const documented = await api.estimateYield(yielded._data, { runs: 30, seed: 4, thicknessRelPct: 1, thicknessAbsNm: 0, indexRe: 0, indexIm: 0, distribution: 'gaussian' });
    ok('and the defaults it documents are monteCarlo\'s', encode(yieldRead(defaulted)) === encode(yieldThere(documented, 4, 'front')));
    const mc = await yielded.monteCarlo(500, 600, { step: 10, runs: 40, ...ERRORS });
    const mcThere = await api.monteCarlo(yielded._data, { from: 500, to: 600, step: 10, runs: 40, ...ERRORS });
    ok('a MonteCarlo\'s spec is a Yield of its trials, monteCarlo\'s spec with the run\'s seed and mode',
        mc.spec instanceof objects.Yield && encode(yieldRead(mc.spec)) === encode(yieldThere(mcThere.spec, mcThere.seed, 'front')), encode(yieldRead(mc.spec)));
    ok('and the yield estimateYield() counts', encode(yieldRead(mc.spec)) === encode(yieldRead(y)));
    // With every check left out of the verdict, no trial is checked, though
    // each is run; scored on the whole part, its mode says so.
    const unchecked = yielded.copy();
    unchecked.specification.clear();
    unchecked.specification.add('LAYER_COUNT', { cmp: 'le', target: 15, enabled: false });
    unchecked.scoreOn = 'whole part';
    const none = (await unchecked.monteCarlo(500, 600, { step: 50, runs: 5, seed: 1 })).spec;
    ok('a spec with no trial checked has no value or interval, its runs the trials run, and the mode the whole part', encode(yieldRead(none))
        === encode([null, 0, 0, null, [{ label: 'LAYER_COUNT', failRate: 0 }], 5, 1, 'total']), encode(yieldRead(none)));

    const reports = [];
    await yielded.specification.estimateYield(10, { seed: 2, progress: p => reports.push([p.trial, p.total]) });
    ok('progress is given a Progress after each trial', encode(reports) === encode(Array.from({ length: 10 }, (_, i) => [i + 1, 10])), encode(reports));
    const early = new AbortController();
    early.abort();
    const stopped = await yielded.specification.estimateYield(100000, { seed: 2, stop: early.signal });
    ok('a stop aborted before the run ends it at once, answering with the trials made', stopped.runs <= 1, stopped.runs);
    const thrown = new Error('thrown at report 3');
    let calls = 0;
    const kept = yielded.copy()._data;
    const how = await yielded.specification.estimateYield(20, { seed: 2, progress: () => { if (++calls === 3) throw thrown; } }).then(() => 'resolved', err => err);
    ok('a progress function that throws ends the run, which rejects with it, calling progress no more, the design as it was',
        how === thrown && calls === 3 && canon(yielded._data) === canon(kept), `${how} ${calls}`);
}
{
    // The refusals of the checks and the yield in the objects' words.
    const bare = design.copy();
    const SPEC_WORDED = [
        [() => bare.specification.check(), 'check: the design has no specification check; add one with specification.add()'],
        [() => bare.specification.estimateYield(5), 'estimateYield: the design has no enabled specification check; add one with specification.add()'],
        [() => bare.specification.add('R_AT', 550, 600), 'add: R_AT is checked at one wavelength, start, and takes no end, not 600'],
        [() => bare.specification.add('LAYER_COUNT', 15), 'add: LAYER_COUNT reads no wavelength, and takes no start or end, not 15'],
        [() => bare.specification.add('PPEF', undefined, 3), 'add: PPEF reads no wavelength, and takes no start or end, not 3'],
        [() => bare.specification.add('R_AVG', 650, 450), 'add: start 650 is above end 450'],
        [() => bare.specification.add('R_AT', -5), 'add: start is a wavelength in nm above 0, not -5'],
        [() => bare.specification.add('R_AVG', 450, 'x'), 'add: end is a wavelength in nm above 0, not "x"'],
        [() => bare.specification.add('R_AVG', 450, 650, 1, {}), 'add: takes start and end before its options object, not 3 values'],
        [() => bare.specification.add('R_AVG', 450, 650, { id: 'mine' }), "add: unknown option 'id'; each check add() adds gets an id of its own"],
        [() => bare.specification.add('R_AVG', 450, 650, { lambdaStart: 450 }),
            "add: unknown option 'lambdaStart'; a check's kind and wavelengths are add()'s arguments, kind, start and end"],
        [() => bare.specification.add('R_AVG', 450, 650, { kind: 'T_AVG' }),
            "add: unknown option 'kind'; a check's kind and wavelengths are add()'s arguments, kind, start and end"],
        [() => bare.specification.add('EDGE_LAMBDA', 450, 650, { edgeSide: 'up' }), "add: edgeSide is 'left' or 'right', not \"up\""],
        [() => bare.specification.add('INTEGRAL', 400, 700, { presetKey: 'Rvis' }), 'add: start is 380, as preset Rvis sets it, or left out, not 400'],
        [() => bare.specification.add('R_AT', 550, { cmp: 'between', lo: 0.9, hi: 0.8 }), "add: hi is a number in the check's unit no lower than lo, 0.9, not 0.8"],
        [() => bare.specification.add('MIN_MAX', 450, 650, { channel: 'R', flag: 2 }), 'add: flag is null, as MIN_MAX of the highest R has no Step, not 2'],
        [() => bare.specification.add('PPEF', { curveId: 'none' }), "add: curveId is the id of one of the design's measured curves, and it has none, not \"none\""],
        [() => bare.specification.remove(0), 'check 0: the specification has 0 checks, numbered from 0'],
        [() => yielded.specification.estimateYield(0), 'estimateYield: runs is a whole number of 1 or more, not 0'],
        [() => yielded.specification.estimateYield(), 'estimateYield: runs is a whole number of 1 or more, not undefined'],
        [() => yielded.specification.estimateYield(5, { rnus: 2 }),
            "estimateYield: unknown option 'rnus'; the options are thicknessRelPct, thicknessAbsNm, indexRe, indexIm, distribution, seed, progress, stop"],
        [() => yielded.specification.estimateYield(5, { runs: 7 }), "estimateYield: unknown option 'runs'; the trials are estimateYield()'s first argument"],
    ];
    const unlike = (await Promise.all(SPEC_WORDED.map(async ([make, words]) => [await refused(make), words]))).filter(([got, words]) => got !== words);
    ok('the specification\'s refusals reach the objects in the objects\' words', unlike.length === 0, unlike.map(([got]) => got).join('\n'));
    const point = bare.copy();
    point.specification.add('R_AVG', 600, 600);
    ok('a band whose end is its start is taken', point.specification.rows[0].start === 600 && point.specification.rows[0].end === 600);
    const rowOption = String(await refused(() => bare.specification.add('R_AVG', 450, 650, { targt: 1 })));
    const listed = rowOption.slice(rowOption.indexOf('; the options are ') + '; the options are '.length).split(', ');
    ok('and an option a check does not take is refused naming the options add() takes', ['cmp', 'edgeSide', 'curveId'].every(name => listed.includes(name)), rowOption);
    ok('kind, start, end and the id being none of them', !['kind', 'id', 'lambda', 'lambdaStart', 'lambdaEnd', 'start', 'end'].some(name => listed.includes(name)), rowOption);
}

// ── Cleaning ────────────────────────────────────────────────────────────────
{
    // Coated on both sides, each with a same-material pair and thin layers,
    // more taken out than merged, no two other layers alike, so a number
    // counted from the wrong end names a layer of another material or
    // thickness.
    const dirty = tf.newDesign('Two sides to clean');
    dirty.sides = 'both';
    [['TiO2', 20], ['SiO2', 30], ['SiO2', 50], ['Ta2O5', 2], ['MgF2', 100], ['Al2O3', 3]].forEach(([material, thickness]) => dirty.layers.append(material, thickness));
    [['Al2O3', 40], ['Al2O3', 25], ['TiO2', 60], ['MgF2', 1.5]].forEach(([material, thickness]) => dirty.backLayers.append(material, thickness));
    const before = dirty.copy();
    const report = dirty.clean();
    const plain = api.cleanDesign(before._data);
    ok('clean() changes the design in place to what cleanDesign gives with its defaults, its CleanReport holding cleanDesign\'s counts and operations',
        canon([dirty._data, report.removed, report.merged, report.operations, inspect(report)])
        === canon([plain.design, 3, 2, plain.operations, '<CleanReport 3 taken out, 2 merged>']), inspect(report));
    // Each operation's layer, and the one a merge goes into, read by number in the design before.
    const layerOf = (side, number) => before[SIDE_LAYERS[side]][number] ?? {};
    const read = report.operations.map(op => [op.side, op.kind, op.number, op.mergedInto, layerOf(op.side, op.number).material,
        layerOf(op.side, op.number).thickness, layerOf(op.side, op.mergedInto).material, op.material, op.thickness]);
    ok('each operation names its layer by its number in the design before, as design.layers and design.backLayers number them, on both sides',
        canon(read) === canon([['front', 'merge', 2, 3, 'SiO2', 30, 'SiO2', 'SiO2', 30], ['front', 'remove', 6, null, 'Al2O3', 3, undefined, 'Al2O3', 3],
            ['front', 'remove', 4, null, 'Ta2O5', 2, undefined, 'Ta2O5', 2],
            ['back', 'merge', 2, 1, 'Al2O3', 25, 'Al2O3', 'Al2O3', 25], ['back', 'remove', 4, null, 'MgF2', 1.5, undefined, 'MgF2', 1.5]]), canon(read));
    const optioned = before.copy();
    const backOnly = optioned.clean({ minThickness: 1.8, merge: false, back: true });
    const frontOnly = before.copy();
    frontOnly.clean({ back: false, merge: true });
    const undefinedOptions = before.copy();
    undefinedOptions.clean({ minThickness: undefined, merge: undefined, back: undefined });
    ok('minThickness, merge and back are cleanDesign\'s minThickness, mergeAdjacent and cleanBack, and an option given as undefined takes its default',
        canon([optioned._data, backOnly.operations, frontOnly._data, frontOnly.backLayers.length, undefinedOptions._data]) === canon([
            api.cleanDesign(before._data, { minThickness: 1.8, mergeAdjacent: false, cleanBack: true }).design,
            [{ side: 'back', kind: 'remove', number: 4, material: 'MgF2', thickness: 1.5, mergedInto: null }],
            api.cleanDesign(before._data, { cleanBack: false, mergeAdjacent: true }).design, 4, plain.design]), canon(backOnly.operations));
    const symmetric = before.copy();
    symmetric.sides = 'symmetric';
    const symmetricData = symmetric._data;
    symmetric.clean();
    ok('a symmetric design\'s back follows its cleaned front', canon([symmetric._data, symmetric.backLayers.length])
        === canon([api.cleanDesign(symmetricData).design, 3]));
    const kept = before.copy();
    const CLEAN_WORDED = [
        [() => kept.clean({ mergeAdjacent: true }), "clean: unknown option 'mergeAdjacent'; the options are minThickness, merge, back"],
        [() => kept.clean({ minThickness: -1 }), 'clean: minThickness is a thickness in nm of 0 or more, not -1'],
        [() => kept.clean({ merge: 1 }), 'clean: merge is true or false, not 1'],
        [() => kept.clean({ back: 'yes' }), 'clean: back is true or false, not "yes"'],
        [() => tf.newDesign('Bare').clean(), 'clean: the design has no layers; add them with layers.append() or stack()'],
    ];
    const worded = await Promise.all(CLEAN_WORDED.map(([make]) => refused(make)));
    ok('clean()\'s refusals are in the objects\' words, and leave the design as it was', canon([worded, kept._data])
        === canon([CLEAN_WORDED.map(([, words]) => words), before._data]), worded.join('\n'));
}

// ── The stack read: index profile, layer thicknesses, facts and QWOT ────────
{
    // Coated on both sides, the back with layers unlike the front's.
    const read = both.copy();
    const profiles = [{}, { wavelength: 633 }, { side: 'total' }, { side: 'back', wavelength: 1064 }];
    const profileFields = p => [p.mode, p.wavelength, p.incident, p.substrate, p.layers, p.thickness, p.opticalThickness, p.outOfRange];
    const thicknessFields = t => [t.mode, t.wavelength, t.rows, t.outOfRange];
    ok('indexProfile() and layerThicknesses() give what indexProfile and layerThicknesses give, with their defaults and with each option',
        profiles.every(options => canon(profileFields(read.indexProfile(options))) === canon(profileFields(api.indexProfile(read._data, options)))
            && canon(thicknessFields(read.layerThicknesses(options))) === canon(thicknessFields(api.layerThicknesses(read._data, options))))
        && read.indexProfile({ side: 'front' }).layers.length === read.layers.length && read.layerThicknesses().rows.length === read.layers.length + read.backLayers.length);
    const sides = [undefined, 'front', 'back', 'total'];
    const facts = sides.map(side => api.designFacts(read._data, { side }));
    ok('totalThickness(), opticalThickness() and layerCounts() are designFacts\' thickness, opticalThickness and layerCounts, with and without side',
        canon(sides.map(side => [read.totalThickness({ side }), read.opticalThickness({ side }), read.layerCounts({ side })]))
        === canon(facts.map(f => [f.thickness, f.opticalThickness, f.layerCounts])) && facts[3].thickness > facts[1].thickness);
    ok('an IndexProfile and a LayerThicknesses print what they hold', inspect(read.indexProfile({ wavelength: 600 })) === `<IndexProfile total at 600 nm: ${read.layers.length + read.backLayers.length} layers, ${facts[3].thickness} nm>`
        && inspect(read.layerThicknesses({ side: 'front' })) === `<LayerThicknesses front at ${read.reference} nm: ${read.layers.length} layers>`, inspect(read.indexProfile({ wavelength: 600 })));
    const qwots = [...[...read.layers].map(layer => layer.qwot), ...[...read.backLayers].map(layer => layer.qwot)];
    ok('layer.qwot reads designFacts\' QWOT of the layer, on the front and the back', canon(qwots) === canon([...facts[3].qwot.front, ...facts[3].qwot.back]) && qwots.every(q => q > 0),
        canon(qwots));
    const set = read.copy();
    set.layers[2].qwot = 1.5;
    set.backLayers[1].qwot = 0.75;
    const there = api.setLayer(api.setLayer(read._data, { index: read.layers.length - 2, qwot: 1.5 }), { side: 'back', index: 0, qwot: 0.75 });
    ok('setting layer.qwot is setLayer with qwot, and reads back as set', canon(set._data) === canon(there)
        && Math.abs(set.layers[2].qwot - 1.5) < 1e-12 && Math.abs(set.backLayers[1].qwot - 0.75) < 1e-12, canon(set.layers[2].thickness));
    const lost = read.copy();
    const [outer, ...inner] = lost._data.frontLayers;
    lost._data = { ...lost._data, frontLayers: [{ ...outer, material: 'NoSuchFilm' }, ...inner] };
    const top = lost.layers.length;
    const symmetric = read.copy();
    symmetric.sides = 'symmetric';
    const QWOT_WORDED = [
        [() => { set.layers[1].qwot = 0; }, 'layer 1: qwot is a quarter-wave optical thickness above 0, not 0'],
        [() => { lost.layers[top].qwot = 1; }, `layer ${top}: NoSuchFilm resolves to nothing, so the layer has no quarter wave; set its thickness in nm`],
        [() => { symmetric.backLayers[1].qwot = 1; }, 'layer 1: the back of a symmetric design mirrors its front; edit the front'],
        [() => read.indexProfile({ side: 'both' }), 'indexProfile: side is \'front\', \'back\' or \'total\', not "both"'],
        [() => read.layerThicknesses({ wavelength: -5 }), 'layerThicknesses: wavelength is a wavelength in nm above 0, not -5'],
        [() => read.totalThickness({ sides: 'front' }), "totalThickness: unknown option 'sides'; the options are side"],
        [() => design.layerThicknesses({ side: 'back' }), 'layerThicknesses: the back has no layers'],
        [() => tf.newDesign('Bare').indexProfile(), 'indexProfile: the front has no layer thicker than 0 nm'],
        [() => new objects.Design({ ...read._data, ...Object.fromEntries(['frontLayers', 'backLayers'].map(key => [key, read._data[key].map(layer => ({ ...layer, thickness: 0 }))])) })
            .indexProfile({ side: 'total' }), 'indexProfile: the design has no layer thicker than 0 nm'],
        [() => tf.newDesign('Bare').layerCounts({ side: 'total' }), null],
    ];
    const worded = await Promise.all(QWOT_WORDED.map(([make]) => refused(make)));
    ok('their refusals are in the objects\' words, and a material that resolves to nothing has no QWOT to read', canon(worded) === canon(QWOT_WORDED.map(([, words]) => words))
        && lost.layers[top].qwot === null && lost.opticalThickness() === null, worded.join('\n'));
}

// ── Runs ────────────────────────────────────────────────────────────────────
const start = design.copy();
start.merit.add('RAV', 450, 650, { target: 0 });
const startData = start._data;
{
    const RUNS = {
        dls: [d => d.refine({ method: 'dls', maxIter: 20 }), data => api.refine(data, { method: 'dls', maxIter: 20 })],
        sa: [d => d.refine({ method: 'sa', maxIter: 20, seed: 5 }), data => api.refine(data, { method: 'sa', maxIter: 20, seed: 5 })],
        needle: [d => d.synthesize('needle', POOL, { maxLayers: 12, refineIter: 10, threads: 1 }),
            data => api.synthesize(data, { method: 'needle', pool: POOL, settings: { maxLayers: 12, refineIter: 10, threads: 1 } })],
        structural: [d => d.synthesize('structural', POOL, { maxIter: 3, refineIter: 5, threads: 1, seed: 7 }),
            data => api.synthesize(data, { method: 'structural', pool: POOL, settings: { maxIter: 3, refineIter: 5, threads: 1, seed: 7 } })],
    };
    const wrong = [];
    for (const [name, [run, call]] of Object.entries(RUNS)) {
        const each = start.copy();
        const got = await quietly(() => run(each));
        const { result, design: answer } = await quietly(() => call(startData));
        const said = [got.completed, got.stopReason, got.merit, got.opticalMerit, got.initialMerit, got.iterations, got.seed, got.mode];
        const expected = [result.completed, result.stopReason, result.mf ?? null, result.omf ?? null, result.mfInitial ?? null,
            result.iter ?? result.iters ?? null, result.seed ?? null, 'front'];
        if (canon(each._data) !== canon(answer) || canon(said) !== canon(expected) || canon(got.reported) !== canon(result)) wrong.push(`${name}: ${canon(said)} / ${canon(expected)}`);
    }
    ok('refine and synthesize leave in the design what the API answers, and their results are its result, seeds included',
        wrong.length === 0 && canon(start._data) === canon(startData), wrong.join('\n'));
    const mc = await start.monteCarlo(450, 650, { step: 10, runs: 5, seed: 3 });
    const there = await api.monteCarlo(startData, { from: 450, to: 650, step: 10, runs: 5, seed: 3 });
    ok('monteCarlo answers what the API\'s monteCarlo answers with the same seed', canon([mc.wavelength, mc.theory, mc.mean, mc.stdev, mc.lower, mc.upper, mc.lowest, mc.highest])
        === canon([there.lambda, there.theory, there.mean, there.stdev, there.lower, there.upper, there.envLower, there.envUpper])
        && canon([mc.runs, mc.quantity, mc.seed, mc.spec, mc.mode]) === canon([there.nTrials, there.char, there.seed, there.spec, 'front']));
    const defaulted = await start.monteCarlo(450, 650, { step: 50, runs: undefined, quantity: undefined, seed: undefined });
    ok('and an option given as undefined takes its default', defaulted.runs === 100 && defaulted.quantity === 'R' && Number.isInteger(defaulted.seed));
    const ranked = start.layerSensitivity({ deltaNm: 2 });
    const apiRanked = api.layerSensitivity(startData, { deltaNm: 2 });
    const ranks = apiRanks(apiRanked, startData.frontLayers.length);
    const got = objectRanks(ranked);
    ok('layerSensitivity is the API\'s, its rows numbered from the substrate', canon(got) === canon(ranks) && ranked.merit === apiRanked.mf0 && ranked.mode === 'front');
    ok('and each row\'s number names its layer', got.length > 0 && ranked.rows.every(r => start.layers[r.number].material === r.material && start.layers[r.number].thickness === r.thickness));

    // A design coated on both sides, with a locked layer, ranked by a step in
    // percent, which differs from the 1 nm default so a step taken in nm shows.
    const sided = both.copy();
    sided.merit.add('RAV', 450, 650, { target: 0 });
    sided.layers[1].locked = true;
    const relative = sided.layerSensitivity({ step: 'percent', relPct: 3, includeLocked: true });
    const apiRelative = api.layerSensitivity(sided._data, { mode: 'relative', relPct: 3, includeLocked: true });
    const relativeGot = objectRanks(relative);
    const named = relative.rows.map(r => [r.material, r.thickness]);
    const layersNamed = relative.rows.map(r => sided[SIDE_LAYERS[r.side]][r.number]).map(layer => [layer.material, layer.thickness]);
    ok('step \'percent\' is the API\'s relative mode, and back rows and locked rows are numbered on their side as its layers are',
        canon(relativeGot) === canon(apiRanks(apiRelative, sided._data.frontLayers.length)) && relative.rows.some(r => r.side === 'back')
        && relative.rows.some(r => r.locked) && canon(named) === canon(layersNamed), JSON.stringify(relativeGot));
    const badStep = await refused(() => start.layerSensitivity({ step: 'relative' }));
    const apiName = await refused(() => start.layerSensitivity({ mode: 'relative' }));
    ok('a step other than \'nm\' and \'percent\' is refused, and so is the API\'s mode', badStep === 'layerSensitivity: step is \'nm\' or \'percent\', not "relative"'
        && apiName === "layerSensitivity: unknown option 'mode'; the options are step, deltaNm, relPct, includeLocked", `${badStep} / ${apiName}`);
}

// ── Progress ────────────────────────────────────────────────────────────────
// What a run reports, folded as a Progress holds it: each report in the order
// the run made them, its method from onMethodStart. Resolves to the fold at
// the end, and as it was after each report.
async function folded(run) {
    const reported = {};
    const each = [];
    const report = hook => (...args) => {
        if (hook === 'onMethodStart') reported.method = args[0];
        for (const arg of args) if (arg && typeof arg === 'object' && !Array.isArray(arg)) Object.assign(reported, arg);
        each.push(canon(reported));
    };
    await quietly(() => run(report));
    return { reported, each };
}
{
    const hooksOf = (method, report) => Object.fromEntries(api.runHooks(method).filter(hook => hook !== 'signal').map(hook => [hook, report(hook)]));
    const NEEDLE = { maxLayers: 12, refineIter: 10, threads: 1 };
    const DEEP = { dMin: 20, maxLayers: 6, seed: 7, threads: 1, method: { search: { rounds: 2, children: 3 } } };
    const expected = {
        refine: await folded(report => api.refine(startData, { method: ['dls', 'cg'] }, hooksOf('refine', report))),
        needle: await folded(report => api.synthesize(startData, { method: 'needle', pool: POOL, settings: NEEDLE }, hooksOf('needle', report))),
        deep: await folded(report => api.synthesize(startData, { method: 'deep', pool: POOL, settings: DEEP }, hooksOf('deep', report))),
        monteCarlo: await folded(report => api.monteCarlo(startData, { from: 450, to: 650, step: 10, runs: 40, seed: 3 }, { onProgress: report('onProgress') })),
    };
    // Each Progress a run gives, and what it held when it was given.
    const reports = { refine: [], needle: [], deep: [], monteCarlo: [] };
    const seen = { refine: [], needle: [], deep: [], monteCarlo: [] };
    const take = name => p => { reports[name].push(p); seen[name].push(canon(p.reported)); };
    await quietly(() => start.copy().refine({ method: ['dls', 'cg'], progress: take('refine') }));
    await quietly(() => start.copy().synthesize('needle', POOL, { ...NEEDLE, progress: take('needle') }));
    await quietly(() => start.copy().synthesize('deep', POOL, { ...DEEP, progress: take('deep') }));
    await start.copy().monteCarlo(450, 650, { step: 10, runs: 40, seed: 3, progress: take('monteCarlo') });
    // The Progress attributes, by the names the API's hooks report them under.
    const KEYS = { merit: 'mf', bestMerit: 'mfBest', opticalMerit: 'omf', iteration: 'iter', generation: 'genNum', layerCount: 'layerCount',
        method: 'method', seed: 'seed', trial: 'trial', total: 'total', activity: 'activity' };
    // A refinement scores its start on a worker of its own while its first
    // method runs (refinement/methodsFlow.js), so the merit history it reports
    // depends on which answers first and differs from one run to the next;
    // the rest of what was reported is compared.
    const differing = (a = {}, b = {}) => [...new Set([...Object.keys(a), ...Object.keys(b)])]
        .filter(key => key !== 'mfHistory' && !DRAWN.has(key) && canon(a[key] ?? null) !== canon(b[key] ?? null));
    const wrong = Object.entries(expected).map(([name, { reported }]) => {
        const last = reports[name].at(-1);
        const attributes = Object.entries(KEYS).filter(([attribute, key]) => canon(last?.[attribute] ?? null) !== canon(reported[key] ?? null)).map(([attribute]) => attribute);
        return [name, [...attributes, ...differing(last?.reported, reported)]];
    }).filter(([, keys]) => keys.length).map(([name, keys]) => `${name}: ${keys.join(', ')}`);
    const reached = reports.refine.at(-1)?.method === 'cg' && reports.needle.at(-1)?.generation > 0 && reports.monteCarlo.at(-1)?.trial === 40;
    ok('progress is given a Progress holding what the run reported up to it, for a refinement, a Needle run, a Deep Synthesis run and a Monte Carlo run',
        wrong.length === 0 && reached && reports.deep.length > 0, wrong.join(', '));
    // A Needle, Deep Synthesis or Monte Carlo run makes the same reports in the
    // same order each time, so each Progress it gives is compared, Deep's
    // being given two objects at once.
    const unlike = ['needle', 'deep', 'monteCarlo'].filter(name => canon(seen[name]) !== canon(expected[name].each));
    ok('and every Progress before the last holds what the run had reported by then', unlike.length === 0, unlike.join(', '));
    const trials = reports.monteCarlo;
    ok('each Progress a snapshot of its own', trials[0].reported !== trials.at(-1).reported && trials[0].trial !== trials.at(-1).trial);
    ok('and a refinement\'s method is there from the moment it starts, before its first iteration', reports.refine.every(p => !p.iteration || p.method));
}

// ── Stop ────────────────────────────────────────────────────────────────────
{
    const stop = new AbortController();
    const grown = start.copy();
    const run = await quietly(() => grown.synthesize('needle', POOL, { maxLayers: 20, refineIter: 10, threads: 1, targetMF: 0, progress: () => stop.abort(), stop: stop.signal }));
    ok('a stop aborted in progress ends a run stopped, the design as it was', run.stopReason === 'stopped' && canon(grown._data) === canon(startData), run.stopReason);
    const early = new AbortController();
    early.abort();
    const refined = start.copy();
    const already = await quietly(() => refined.refine({ method: 'dls', stop: early.signal }));
    const trials = await start.monteCarlo(450, 650, { runs: 100000, seed: 5, stop: early.signal });
    ok('a stop aborted before a run ends it at once', already.stopReason === 'stopped' && canon(refined._data) === canon(startData) && trials.runs <= 1,
        `${already.stopReason} ${trials.runs}`);
    const notStop = await refused(() => start.refine({ stop: true }));
    const notProgress = await refused(() => start.monteCarlo(450, 650, { progress: 5 }));
    ok('a stop that is not an AbortSignal, and a progress that is not a function, are refused',
        notStop === 'stop is an AbortSignal, the signal of an AbortController whose abort() ends the run'
        && notProgress === 'progress is a function, called with a Progress as the run reports', `${notStop} / ${notProgress}`);
}

// A run of each method, given its progress function and its stop. Gradual
// Evolution runs a single cycle, which makes every kind of report a longer
// run makes, since the sweep below runs each method once for each of its
// reports.
const RUN_OF = {
    'refine dls': (d, progress, stop) => d.refine({ method: 'dls', maxIter: 20, progress, stop }),
    'refine cg': (d, progress, stop) => d.refine({ method: 'cg', maxIter: 20, progress, stop }),
    needle: (d, progress, stop) => d.synthesize('needle', POOL, { maxLayers: 12, refineIter: 10, threads: 1, progress, stop }),
    ge: (d, progress, stop) => d.synthesize('ge', POOL, { maxLayers: 10, maxGeCycles: 1, refineIter: 1, threads: 1, progress, stop }),
    structural: (d, progress, stop) => d.synthesize('structural', POOL, { maxIter: 3, refineIter: 5, threads: 1, seed: 7, progress, stop }),
    deep: (d, progress, stop) => d.synthesize('deep', POOL, { dMin: 20, maxLayers: 6, seed: 7, threads: 1, method: { search: { rounds: 2, children: 3 } }, progress, stop }),
    monteCarlo: (d, progress, stop) => d.monteCarlo(450, 650, { step: 10, runs: 20, seed: 3, progress, stop }),
};

// ── A run stopped part way ──────────────────────────────────────────────────
{
    // Deep Synthesis is stopped once it has reported a best design, the one
    // its plain call answers with when stopped; the others at their third
    // report.
    const STOPPED = ['refine dls', 'refine cg', 'needle', 'ge', 'structural', 'deep'];
    const ended = [];
    for (const name of STOPPED) {
        const stop = new AbortController();
        const each = start.copy();
        let reports = 0;
        const due = p => (name === 'deep' ? Array.isArray(p.reported.layers) : ++reports === 3);
        const run = await quietly(() => RUN_OF[name](each, p => { if (due(p)) stop.abort(); }, stop.signal));
        ended.push([name, run.stopReason, canon(each._data) === canon(startData)]);
    }
    ok('a run of each method stopped part way ends stopped, the design as it was, Deep Synthesis\'s, which answers with its best so far, included',
        canon(ended) === canon(STOPPED.map(name => [name, 'stopped', true])), JSON.stringify(ended));
}

// ── A progress function that throws ─────────────────────────────────────────
// How a run ends when its progress function throws at report `at`: how it
// settled, how many more times it called progress, and whether it left the
// design as it was.
async function throwingAt(run, at) {
    const each = start.copy();
    const thrown = new Error(`thrown at report ${at}`);
    let reports = 0;
    const settled = run(each, () => { if (++reports === at) throw thrown; })
        .then(result => `resolved ${result.stopReason}`, err => (err === thrown ? 'rejected with it' : `rejected with ${err?.message}`));
    // A run the error leaves hanging never settles. Each of these runs ends
    // within a second, so ten seconds tells the two apart.
    let timer;
    const hanging = new Promise(resolve => { timer = setTimeout(resolve, 10000, 'never settled'); });
    const how = await quietly(() => Promise.race([settled, hanging]));
    clearTimeout(timer);
    return [how, reports - at, canon(each._data) === canon(startData)];
}
const THROWN_AS_DOCUMENTED = ['rejected with it', 0, true];
{
    // The engines catch the errors of the code their reports come from, each
    // in its own places, so the error is thrown at each report in turn. Some
    // reports are paced by the clock, so how many a run gives varies with the
    // machine's load: a run judged is one that reached its report `at`, and
    // the first that ends before it ends the sweep of that method.
    const ends = [];
    for (const name of Object.keys(RUN_OF)) {
        for (let at = 1, end; (end = await throwingAt(RUN_OF[name], at))[1] >= 0; at++) ends.push([`${name} at report ${at}`, end]);
    }
    const wrong = ends.filter(([, end]) => canon(end) !== canon(THROWN_AS_DOCUMENTED));
    ok('an error a progress function throws at any report ends the run, which rejects with it, calling progress no more, the design as it was, for each method',
        ends.length > 0 && wrong.length === 0, JSON.stringify(wrong));
    // A hundred thousand trials take many seconds; thrown at the first, the
    // run ends then, not after them, whether it was given a stop or not.
    const early = [];
    for (const stop of [undefined, new AbortController().signal]) {
        const began = Date.now();
        const end = await throwingAt((d, progress) => d.monteCarlo(450, 650, { step: 10, runs: 100000, seed: 3, progress, stop }), 1);
        early.push({ end, took: Date.now() - began });
    }
    ok('and the run ends there: a Monte Carlo run of a hundred thousand trials thrown at its first ends within two seconds, given a stop or not',
        early.every(({ end, took }) => canon(end) === canon(THROWN_AS_DOCUMENTED) && took < 2000), JSON.stringify(early));
}

// ── Refusals in the objects' words ──────────────────────────────────────────
{
    // `design` is coated on its front, scored on its side, and has no merit function.
    const front = design.copy();
    // What each object call is refused with, and the words it is to be refused in.
    const WORDED = [
        [() => front.refine(), 'refine: the design has no merit function; add a row with merit.add()'],
        [() => front.layerSensitivity(), 'layerSensitivity: the design has no merit function; add a row with merit.add()'],
        [() => front.backLayers.append('SiO2', 10),
            "append: a design coated on the front alone and scored on that side does not evaluate the back; to edit it, set sides to 'both', or scoreOn to 'whole part'"],
        [() => front.backLayers.insert(1, 'SiO2', 10),
            "insert: a design coated on the front alone and scored on that side does not evaluate the back; to edit it, set sides to 'both', or scoreOn to 'whole part'"],
        [() => symmetric.backLayers.remove(1), 'remove: the back of a symmetric design mirrors its front; edit the front'],
        [() => { front.layers[1].thickness = -5; }, 'layer 1: thickness is a physical thickness in nm above 0, not -5'],
        [() => front.merit.add('RAV', 450, 650, { aoi: 95 }), 'add: aoi is an angle of incidence in degrees, 0 <= aoi < 90, not 95'],
        [() => front.merit.add('RAV', 'x', 650), 'add: start is a number, not "x"'],
        [() => front.merit.add('RAV', 700, 400), 'add: start 700 is above end 400'],
        [() => front.merit.add('RAV', { lambdaStart: 450, lambdaEnd: 650, target: 0 }),
            "add: unknown option 'lambdaStart'; a row's type, start and end are add()'s arguments"],
        [() => front.merit.add('RAV', 450, 650, { type: 'TAV' }), "add: unknown option 'type'; a row's type, start and end are add()'s arguments"],
        [() => front.spectrum(700, 400), 'spectrum: start and end are wavelengths in nm, 0 < start < end'],
        [() => front.monteCarlo(400, 700, { rnus: 5 }), "monteCarlo: unknown option 'rnus'; the options are quantity, step, angle, polarization, runs, "
            + 'thicknessRelPct, thicknessAbsNm, indexRe, indexIm, distribution, seed, progress, stop'],
        [() => { front.reference = -1; }, 'reference is a wavelength in nm above 0, not -1'],
        [() => { front.substrate.thickness = 0; }, 'substrate.thickness is a thickness in mm above 0, not 0'],
        [() => front.stack('HL', { at: -5 }), 'stack: at is a wavelength in nm above 0, not -5'],
        [() => front.stack('Air | HL | BK7'),
            "stack: the formula names media; write the layers alone, such as '(HL)^5 H', and set the media with incidentMedium, exitMedium and substrate.material"],
        [() => tf.materials.get('TiO2').nk(-5), 'nk: wavelengths is a list of wavelengths in nm above 0'],
        [() => tf.newDesign('X', { reference: 0 }), 'newDesign: reference is a wavelength in nm above 0, not 0'],
        [() => front.save(path.join(WORK, 'never.tfs'), { overwite: true }), "save: unknown option 'overwite'; the options are overwrite"],
    ];
    const unlike = [];
    for (const [make, words] of WORDED) unlike.push([await refused(make), words]);
    ok('the plain calls\' refusals reach the objects in the objects\' words', unlike.every(([got, words]) => got === words),
        unlike.filter(([got, words]) => got !== words).map(([got]) => got).join('\n'));
    const rowType = String(await refused(() => front.merit.add('XYZ')));
    const formula = String(await refused(() => front.stack('(HL')));
    ok('a row\'s type and a formula that does not read too, the method named in place of the call',
        /^add: unknown operand type 'XYZ'\. Types: /.test(rowType) && /^stack: the formula does not read: /.test(formula), `${rowType} / ${formula}`);
    const rowOption = String(await refused(() => front.merit.add('RAV', 450, 650, { targt: 0 })));
    ok('and an option a row does not take is refused naming the options add() takes, start and end and the type being its arguments',
        /^add: unknown option 'targt'; the options are id, enabled, aoi, pol, target, targetEnd, weight, cmp, /.test(rowOption) && !/lambda/.test(rowOption), rowOption);

    // What a plain call throws: its message, code and fields.
    const thrown = async make => {
        try { await make(); return null; } catch (err) { return { message: err.message, code: err.code, fields: err.fields }; }
    };
    const plain = {
        noMerit: await thrown(() => api.refine(front._data, { method: 'dls' })),
        closedSide: await thrown(() => api.insertLayer(front._data, { side: 'back', material: 'SiO2', thickness: 10 })),
        rowBand: await thrown(() => api.setMerit(front._data, [{ type: 'RAV', lambdaStart: 700, lambdaEnd: 400 }])),
        range: await thrown(() => api.spectrum(front._data, { from: 700, to: 400 })),
    };
    ok('while the plain calls keep their own words, which agents read through MCP, with the code and fields each object layer words them from', canon(plain) === canon({
        noMerit: { message: 'refine: the design has no merit function; set one with setMerit', code: 'noMerit', fields: { call: 'refine' } },
        closedSide: {
            message: "insertLayer: a front_only design scored on its side alone does not evaluate the back; to edit it, make the design both_independent, or score it as the whole part (mfEvalMode 'total'), with setDesignSetup",
            code: 'closedSide', fields: { call: 'insertLayer', side: 'back', surfaceMode: 'front_only' },
        },
        rowBand: { message: 'setMerit: row 0: lambdaStart 700 is above lambdaEnd 400', code: 'bandOrder', fields: { call: 'setMerit', row: 0, start: 700, end: 400 } },
        range: { message: 'spectrum: from and to are wavelengths in nm, 0 < from < to', code: 'wavelengthRange', fields: { call: 'spectrum', from: 700, to: 400 } },
    }), canon(plain));
    const unknownMaterial = await refused(() => front.layers.append('Unobtainium', 10));
    const apiUnknown = await thrown(() => api.insertLayer(front._data, { material: 'Unobtainium', thickness: 10 }));
    ok('a refusal that names no call, such as an unknown material, reaches the objects as the API words it', !!apiUnknown?.message && unknownMaterial === apiUnknown.message,
        unknownMaterial);
}

fs.rmSync(WORK, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
