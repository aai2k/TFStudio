/**
 * Test helper for tests/python_client.mjs: the checks of the tfstudio
 * package's objects. tests/_pythonObjects.py drives them and prints each
 * answer beside the design it was computed on, and each is computed again
 * here with the API's calls on that design:
 *
 *   new_design; the setup attributes (name, reference, substrate material
 *   and thickness in mm, the two media) set and read back; stack with
 *   symbols, on the back from the incident medium in, and an option stack
 *   does not take; layer edits by number from the substrate, on the front and
 *   the back, a copy changing apart, numbers a side has no layer of refused,
 *   True among them, and the back of a symmetric design refused; save()
 *   writing the file saveDesign writes, refusing that file then and writing
 *   over it with overwrite=True, and tf.open_design() of it; sides and
 *   score_on round-tripping to surfaceMode and mfEvalMode, and the mode of a
 *   spectrum, a Monte Carlo run, a refinement, a layer ranking, an index
 *   profile and a list of layer thicknesses being the API's evaluation mode,
 *   and total_thickness() counting the coated sides, for every pair; layer rankings of a two-sided
 *   design with a locked layer, with the defaults, with step "percent",
 *   rel_pct and include_locked, and with step "percent" alone, back rows
 *   numbered from the substrate; materials by id, by name and by the
 *   builtin: id a stacked layer holds, their n and k, a name two materials
 *   share refused, and one of them by its catalog:key id; spectrum curves at
 *   two angles, their mean, min and max over a band and the whole range, NaN
 *   left out of min and max, inf and -inf over a band of NaN alone, and the
 *   CSV file; merit rows, value, rows and clear(); specification checks of
 *   every kind added with the wavelengths each kind takes and keywords in
 *   snake_case, read back as SpecChecks, removed and cleared, the verdict of
 *   check(), estimate_yield() with a seed and with its documented defaults,
 *   a Monte Carlo run's spec, progress, a progress function that raises and
 *   a Stop, and their refusals; clean() with its defaults, with each option
 *   and on a symmetric design, its CleanReport's named tuples, each
 *   operation's number read back through the layers, and its refusals;
 *   index_profile() and layer_thicknesses() as named tuples, save_csv(), the
 *   facts with and without side, layer.qwot read and set, None for a
 *   material that resolves to nothing, and their refusals;
 *   refine and synthesize with seeds, Monte Carlo with a seed and layer
 *   sensitivity; the settings' snake_case names; the Progress objects of a
 *   refinement, a Needle run and a Monte Carlo run; stop= in progress, Deep
 *   Synthesis's included, and before the run; Ctrl+C in progress; every
 *   public name documented with an example; and the plain calls' refusals in
 *   Python's words, synthesize()'s among them and true, false and null
 *   written True, False and None, while studio._calls keeps the API's, with
 *   their code and fields.
 *
 * checkObjects(t) runs them with the test's helpers in `t`: api, scenario,
 * ok, canon, attempt, local, failure, POOL, QUANTITIES, WORK, DRAWN and
 * STOPPED_WITHIN_S.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NEEDLE_DEFAULTS } from '../src/utils/needle/settings.js';
import { GE_DEFAULTS } from '../src/utils/gradualEvolution/settings.js';
import { RUN_DEFAULTS } from '../src/utils/structural/settings.js';
import { fixtureFile } from './_apiCorpus.mjs';

const DRIVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '_pythonObjects.py');

// A setting's snake_case name in Python: the API Reference's camelCase name
// with an underscore before each capital that follows a small letter or a
// digit, in small letters.
const snake = name => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
// The settings of the synthesis methods, by the API's names.
const SETTINGS = [...new Set([...Object.keys(NEEDLE_DEFAULTS), ...Object.keys(GE_DEFAULTS), ...Object.keys(RUN_DEFAULTS), 'threads'])];
const listed = (layers, side) => layers.map((layer, i) => [i + 1, side, layer.material, layer.thickness, !!layer.locked]);
// A ranking's rows as SensitivityRow gives them: layer n on the front is the
// API's index count - n, on the back its index n - 1.
const rankRows = (answer, frontCount) => (answer?.rows ?? []).map(r => [r.side, r.side === 'front' ? frontCount - r.layerIndex : r.layerIndex + 1,
    r.materialId, r.thickness, r.deltaNm, r.deltaMFAbs, r.deltaMF, r.sensitivity, r.locked]);

async function designs(t, said) {
    const { api, ok, canon, attempt, failure } = t;
    ok('new_design is newDesign with the name, substrate and reference wavelength',
        canon(said.new) === canon(api.newDesign({ name: 'Stack', substrate: 'BK7', referenceWavelength: 550 })), failure(t.ran));
    const setup = await attempt(() => api.setDesignSetup(said.new, { name: 'Set up', referenceWavelength: 600, substrate: 'SiO2', substrateThicknessMm: 3, incidentMedium: 'MgF2', exitMedium: 'Al2O3' }));
    ok('the setup attributes are setDesignSetup\'s, the substrate thickness in mm, and read back as set', canon(said.setup ?? null) === canon(setup) && said.setupRead?.[3] === 3
        && canon(said.setupRead) === canon([setup.name, setup.referenceWavelength, setup.substrate?.material, setup.substrate?.thickness, setup.incidentMedium, setup.exitMedium]),
    JSON.stringify(said.setupRead));
    ok('stack is stackFromFormula with the symbols, and at as the reference wavelength',
        canon(said.stacked) === canon(await attempt(() => api.stackFromFormula(said.new, { formula: '(HL)^3 H', symbols: { H: 'TiO2', L: 'SiO2' }, referenceWavelength: 600 }))));
    ok('and an option stack does not take is refused, naming those it takes', said.stackOption === "stack: unknown option 'sid'; the options are at, side, from_substrate, and a letter for each symbol",
        said.stackOption);
    const [before, after] = said.stackedBack ?? [];
    ok('stack with side and from_substrate is stackFromFormula with side and startFromSubstrate', !!before
        && canon(after) === canon(await attempt(() => api.stackFromFormula(before, { formula: 'HL', symbols: { H: 'Ta2O5' }, side: 'back', startFromSubstrate: false }))),
    JSON.stringify(after?.backLayers));

    // Layer n on the front is the API's index count - n, the outermost
    // first; a new layer n goes in at count + 1 - n.
    const front = design => design.frontLayers.length;
    const FRONT_EDITS = [
        d => api.setLayer(d, { index: front(d) - 1, thickness: 12.5 }),
        d => api.setLayer(d, { index: front(d) - 3, locked: true }),
        d => api.setLayer(d, { index: front(d) - 2, material: 'Ta2O5' }),
        d => api.insertLayer(d, { index: 0, material: 'MgF2', thickness: 95 }),
        d => api.insertLayer(d, { index: front(d) + 1 - 2, material: 'Al2O3', thickness: 20 }),
        d => api.deleteLayer(d, { index: front(d) - 4 }),
    ];
    const edited = await attempt(() => FRONT_EDITS.reduce((design, edit) => edit(design), said.stacked));
    ok('layer edits by number from the substrate are the API\'s edits at the front\'s indices', canon(said.edited) === canon(edited), canon(said.edited)?.slice(0, 300));
    ok('and the layers go from layer 1, next to the substrate, outward', canon(said.listed) === canon(listed([...(edited.frontLayers ?? [])].reverse(), 'front'))
        && said.first === 12.5, JSON.stringify(said.listed));
    const count = edited.frontLayers?.length;
    const numbered = `the front has ${count} layers, numbered from 1 next to the substrate`;
    ok('a number the side has no layer of is refused, naming the numbers', JSON.stringify(said.refusals) === JSON.stringify([
        `layer 0: ${numbered}`, `layer ${count + 1}: ${numbered}`, `layer ${count + 2}: ${numbered}, and a new one can be layer ${count + 1}`, `layer '1': ${numbered}`,
        `layer True: ${numbered}`]),
    JSON.stringify(said.refusals));

    // On the back, layer n is the API's index n - 1.
    const BACK_EDITS = [
        d => api.setDesignSetup(d, { surfaceMode: 'both_independent' }),
        d => api.insertLayer(d, { side: 'back', index: d.backLayers.length, material: 'SiO2', thickness: 100 }),
        d => api.insertLayer(d, { side: 'back', index: d.backLayers.length, material: 'TiO2', thickness: 30 }),
        d => api.insertLayer(d, { side: 'back', index: 0, material: 'MgF2', thickness: 40 }),
        d => api.setLayer(d, { side: 'back', index: 1, thickness: 21 }),
        d => api.deleteLayer(d, { side: 'back', index: 2 }),
    ];
    const back = await attempt(() => BACK_EDITS.reduce((design, edit) => edit(design), said.edited));
    ok('on the back, layer n is the API\'s index n - 1', canon(said.back) === canon(back) && canon(said.backListed) === canon(listed(back.backLayers ?? [], 'back')),
        JSON.stringify(said.backListed));
    ok('a copy changes apart from its design', said.copyApart === 'front_only', said.copyApart);
    ok('the back of a symmetric design is refused in the objects\' words, naming the layer',
        said.symmetricBack === 'layer 1: the back of a symmetric design mirrors its front; edit the front', said.symmetricBack);
    return count;
}

// save() and tf.open_design() on the edited design, against the file
// saveDesign writes of the same design here.
async function files(t, said) {
    const { api, ok, canon, attempt, WORK } = t;
    const got = said.saved ?? {};
    const written = async (design, name) => {
        const file = path.join(WORK, name);
        await attempt(() => api.saveDesign(design, file));
        return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    };
    const first = await written(said.edited, 'api-saved.tfs');
    ok('save() writes the file saveDesign writes', first !== null && got.first === first, String(got.first).slice(0, 200));
    ok('and refuses that file then with a TFStudioError in Python\'s words, which is no AppError, leaving the file as it was',
        canon(got.refused ?? null) === canon(['TFStudioError', `save: ${path.join(WORK, 'saved.tfs')} exists; pass overwrite=True to write over it`]) && got.kept === true,
        `${JSON.stringify(got.refused)} ${got.kept}`);
    ok('tf.open_design() is openDesign', !!got.opened && canon(got.opened) === canon(await attempt(() => api.openDesign(path.join(WORK, 'api-saved.tfs')))),
        JSON.stringify(got.opened)?.slice(0, 200));
    const over = await written(got.changed, 'api-over.tfs');
    ok('and save() with overwrite=True writes the changed design over it', over !== null && got.over === over && over !== first
        && got.changed?.frontLayers?.at(-1)?.thickness === 33, String(got.over).slice(0, 200));
}

const SIDES = { front: 'front_only', back: 'back_only', both: 'both_independent', symmetric: 'symmetric' };
const SCORE_ON = { side: 'side', 'whole part': 'total' };

async function modes(t, said) {
    const { api, ok, attempt } = t;
    const wrong = [];
    for (const [sides, scoreOn, sidesRead, scoreOnRead, surfaceMode, mfEvalMode, ...found] of said.modes ?? []) {
        const { evalMode } = await attempt(() => api.spectrum(api.setDesignSetup(said.twoSided, { surfaceMode, mfEvalMode }), { from: 500, to: 600, step: 50 }));
        const held = [sidesRead, scoreOnRead, surfaceMode, mfEvalMode].join() === [sides, scoreOn, SIDES[sides], SCORE_ON[scoreOn]].join();
        if (!held || !found.every(mode => mode === evalMode)) wrong.push(`${sides}/${scoreOn}: ${[sidesRead, scoreOnRead, surfaceMode, mfEvalMode, ...found]} / ${evalMode}`);
    }
    const kinds = new Set((said.modes ?? []).map(row => row[6])).size;
    ok('sides and score_on round-trip to surfaceMode and mfEvalMode, and a spectrum\'s, a Monte Carlo run\'s, a run\'s, a ranking\'s, an index profile\'s and a thickness list\'s mode are the API\'s evaluation mode, for every pair',
        said.modes?.length === 8 && said.modes.every(row => row.length === 12) && wrong.length === 0 && kinds === 3, wrong.join('; ') || JSON.stringify(said.modes));
    const factsWrong = [];
    for (const [design, total] of said.modeFacts ?? []) {
        const facts = await attempt(() => api.designFacts(design));
        const coated = { front_only: 'front', back_only: 'back', both_independent: 'total', symmetric: 'front' }[design.surfaceMode];
        if (facts.thickness !== total || facts.mode !== coated) factsWrong.push(`${design.surfaceMode}/${design.mfEvalMode}: ${total} / ${facts.thickness} ${facts.mode}`);
    }
    ok('and total_thickness() is designFacts\' thickness, on the coated sides, for every pair', said.modeFacts?.length === 8 && factsWrong.length === 0, factsWrong.join('; '));
    ok('sides and score_on the app does not have are refused, naming those it has', said.badSides === "sides is 'front', 'back', 'both' or 'symmetric', not 'two'"
        && said.badScoreOn === "score_on is 'side' or 'whole part', not 'total'", `${said.badSides} / ${said.badScoreOn}`);
    await rankings(t, said.ranked ?? {});
}

// The rankings of a two-sided design with two back layers and front layer 1
// locked: with the defaults, with step "percent", rel_pct 3 and the locked
// layers scored, and with step "percent" alone.
async function rankings(t, ranked) {
    const { api, ok, canon, attempt } = t;
    const design = ranked.design ?? {};
    const frontCount = design.frontLayers?.length;
    const expected = [await attempt(() => api.layerSensitivity(design)),
        await attempt(() => api.layerSensitivity(design, { mode: 'relative', relPct: 3, includeLocked: true })),
        await attempt(() => api.layerSensitivity(design, { mode: 'relative' }))].map(answer => rankRows(answer, frontCount));
    ok('layer_sensitivity\'s defaults are layerSensitivity\'s, rel_pct\'s with step "percent" too, and step "percent", rel_pct and include_locked are its mode relative, relPct and includeLocked',
        expected[0].length > 0 && canon(ranked.rows ?? null) === canon(expected), JSON.stringify(ranked.rows)?.slice(0, 300));
    const [plain = [], percent = []] = ranked.rows ?? [];
    const layerOf = (side, number) => (side === 'front' ? design.frontLayers?.[frontCount - number] : design.backLayers?.[number - 1]);
    const named = percent.every(([side, number, material, thickness]) => canon([layerOf(side, number)?.material, layerOf(side, number)?.thickness]) === canon([material, thickness]));
    const lockedWhenAsked = percent.some(row => row[8] === true) && plain.length > 0 && !plain.some(row => row[8] === true);
    ok('and each row, the back\'s too, names its layer by its number on its side, a locked one scored only when asked',
        named && percent.some(row => row[0] === 'back') && lockedWhenAsked, JSON.stringify(percent.map(row => row.slice(0, 4))));
    ok('a step that is not nm or percent is refused, naming those it is', ranked.badStep === "step is 'nm' or 'percent', not 'relative'", ranked.badStep);
}

async function materials(t, said, named) {
    const { api, ok, canon, attempt } = t;
    const tio2 = api.findMaterials('TiO2').find(m => m.id === 'TiO2');
    const nk = api.materialNK('TiO2', [400, 550, 700]).nk;
    const nkRight = canon(said.nkOne) === canon([nk[1].n, nk[1].k]) && canon(said.nkMany) === canon([nk.map(p => p.n), nk.map(p => p.k)]);
    ok('tf.materials[id] is the material, and nk() gives n and k at one wavelength or a list of each at several',
        canon(said.material) === canon([tio2.id, tio2.name, tio2.catalog]) && nkRight, JSON.stringify([said.material, said.nkOne]));
    ok('find() finds what findMaterials finds, tf.materials[name] goes by name too, and an unknown material is refused', canon(said.found) === canon(api.findMaterials('SiO2').map(m => m.id))
        && said.byName === named.id && /^materials: no material has the id or name 'Unobtainium'/.test(said.unknown ?? ''), `${said.byName} ${said.unknown}`);
    const [held, heldNK] = said.held ?? [];
    const there = (await attempt(() => api.materialNK(held, [550]))).nk?.[0] ?? {};
    ok('tf.materials[] takes the builtin: id that a layer stack() made holds', /^builtin:/.test(held ?? '') && canon(heldNK) === canon([there.n, there.k]), JSON.stringify(said.held));
    ok('and refuses a name two materials share, naming their ids', said.twins === "materials: 2 materials are named 'Twin': take one by its id, twins:A, twins:B", said.twins);
    ok('and takes one of them by its catalog:key id', canon(said.twinById ?? null) === canon(['twins:A', 'Twin']), JSON.stringify(said.twinById));
}

// A data folder whose user catalog holds two materials named Twin.
function twinsFolder(work) {
    const folder = path.join(work, 'twins data');
    fs.mkdirSync(path.join(folder, 'Materials', 'user'), { recursive: true });
    const twin = id => ({ id, name: 'Twin', formulaNum: -1, coefficients: [], kTable: [], tabData: [[400, 1.5, 0], [800, 1.5, 0]] });
    fs.writeFileSync(path.join(folder, 'Materials', 'user', 'twins.catalog.json'),
        JSON.stringify({ id: 'twins', name: 'Twins', source: 'user', materials: { A: twin('A'), B: twin('B') } }));
    return folder;
}

async function spectra(t, said) {
    const { api, ok, canon, attempt, QUANTITIES, WORK } = t;
    const s = said.spectrum ?? {};
    const there = await attempt(() => api.spectrum(said.edited, { from: 400, to: 700, step: 10, angles: [45, 0] }));
    const [whole, band] = (await attempt(() => api.summarize(there, { bands: [{ from: 450, to: 650 }] })))[45] ?? [];
    const axes = s.mode === there.evalMode && canon(s.wavelength) === canon(there.lambda) && canon(s.angles) === '[45,0]';
    const curves = canon(s.R) === canon(there.angles?.[45]?.R) && canon(s.Tp0) === canon(there.angles?.[0]?.Tp);
    ok('a spectrum\'s curves are the API\'s, at the first angle asked and at another', axes && curves && canon(s.outOfRange) === canon(there.outOfRange), canon(s).slice(0, 300));
    ok('and are lists', s.isList === true && s.maxR === Math.max(...(there.angles?.[45]?.R ?? [])), `${s.isList} ${s.maxR}`);
    ok('a curve\'s mean, min and max are summarize\'s, over a band and over the whole range', canon(s.band) === canon([band?.R.mean, band?.R.min, band?.R.max])
        && canon(s.whole) === canon([whole?.T.mean, whole?.T.min, whole?.T.max]), JSON.stringify([s.band, s.whole]));
    ok('an angle the spectrum was not computed at, and a band with no wavelength of it, are refused', s.noAngle === 'angle: the spectrum was computed at [45, 0], not at 30'
        && s.noBand === 'mean: no wavelength of this curve is from 800 to 900 nm', `${s.noAngle} / ${s.noBand}`);
    const [values, lambda, gappy] = s.gappy ?? [];
    const [all, from510, only510] = (await attempt(() => api.summarize({ lambda, angles: { 0: Object.fromEntries(QUANTITIES.map(q => [q, values])) } },
        { bands: [{ from: 510, to: 530 }, { from: 510, to: 510 }] })))[0] ?? [];
    ok('a curve\'s min and max leave a NaN out, and its mean is NaN, as summarize\'s are', !!from510 && canon(gappy) === canon([from510.R.min, from510.R.max, all.R.mean]),
        JSON.stringify(s.gappy));
    ok('and over a band holding a NaN alone they are inf and -inf, as summarize\'s are', only510?.R.min === Infinity && only510.R.max === -Infinity
        && canon(s.nanBand ?? null) === canon([only510.R.min, only510.R.max]), canon(s.nanBand ?? null));
    const file = path.join(WORK, 'spectrum.csv');
    const csv = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map(line => line.split(',')) : [];
    const header = ['Wavelength (nm)', ...[45, 0].flatMap(angle => QUANTITIES.map(q => `${q} at ${angle} deg`))];
    const rows = (there.lambda ?? []).map((lambda, i) => [lambda, ...[45, 0].flatMap(angle => QUANTITIES.map(q => there.angles[angle][q][i]))]);
    ok('save_csv writes the wavelengths, then each quantity at each angle, each headed', canon(csv[0]) === canon(header) && canon(csv.slice(1).map(row => row.map(Number))) === canon(rows),
        JSON.stringify(csv[0]));
}

async function merit(t, said, count) {
    const { api, ok, canon, attempt } = t;
    const got = said.merit ?? {};
    const ROWS = [{ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0 }, { type: 'MNT', lambdaStart: 1, lambdaEnd: count, target: 10 },
        { type: 'TAV', lambdaStart: 800, lambdaEnd: 900, target: 0.95, weight: 2, aoi: 45, pol: 'p' }];
    const rated = await attempt(() => api.setMerit(said.edited, ROWS));
    ok('merit.add() makes the rows setMerit makes', canon(got.design) === canon(rated) && got.count === 3, canon(got.design?.meritOperands)?.slice(0, 300));
    const DEFAULTS = { weight: 1, aoi: 0, pol: 'avg', enabled: true };
    ok('and the defaults it documents, weight 1, aoi 0, pol avg and enabled, are the editor\'s',
        ROWS.slice(0, 2).every(row => canon(api.setMerit(said.edited, [row])) === canon(api.setMerit(said.edited, [{ ...row, ...DEFAULTS }]))));
    const scored = await attempt(() => api.merit(rated));
    const rows = scored.rows?.map(r => [r.type, r.lambdaStart ?? null, r.lambdaEnd ?? null, r.aoi ?? null, r.pol ?? null, r.target, r.weight, r.enabled, r.value, r.error]);
    ok('value, optical_value and rows are merit\'s', got.value === scored.total && got.optical === scored.optical && canon(got.rows) === canon(rows), JSON.stringify(got.rows));
    ok('clear() leaves no row, in the copy alone', canon(got.cleared) === '[0,3]', canon(got.cleared));
}

// A check of each kind as the package adds it to a design with the measured
// curve `curveId`: [kind, wavelengths, keyword arguments, the fields
// setSpecification is given for the same check]. No wavelength is one a check
// starts with, so a wavelength given to another field shows.
const specKinds = curveId => [
    ['T_AT', [1530], { cmp: 'ge', target: 0.5 }, { lambda: 1530, cmp: 'ge', target: 0.5 }],
    ['R_AT', [1560], { cmp: 'le', target: 0.5, aoi: 30, pol: 'p' }, { lambda: 1560, cmp: 'le', target: 0.5, aoi: 30, pol: 'p' }],
    ['A_AT', [1575], {}, { lambda: 1575 }],
    ['T_AVG', [1510, 1590], { cmp: 'between', lo: 0.1, hi: 0.9 }, { lambdaStart: 1510, lambdaEnd: 1590, cmp: 'between', lo: 0.1, hi: 0.9 }],
    ['R_AVG', [1520, 1580], { flag: 2, label: 'R band' }, { lambdaStart: 1520, lambdaEnd: 1580, flag: 2, label: 'R band' }],
    ['A_AVG', [1505, 1595], { enabled: false }, { lambdaStart: 1505, lambdaEnd: 1595, enabled: false }],
    ['MIN_MAX', [1515, 1585], { channel: 'R', direction: 'min', cmp: 'le', target: 0.4 },
        { lambdaStart: 1515, lambdaEnd: 1585, channel: 'R', direction: 'min', cmp: 'le', target: 0.4 }],
    ['CENTRAL_LAMBDA', [1500, 1600], { cmp: 'eq', target: 1550, tol: 20 }, { lambdaStart: 1500, lambdaEnd: 1600, cmp: 'eq', target: 1550, tol: 20 }],
    ['FWHM', [1500, 1600], { level: 0.4, band_points: 801, cmp: 'ge', target: 10 },
        { lambdaStart: 1500, lambdaEnd: 1600, level: 0.4, bandPoints: 801, cmp: 'ge', target: 10 }],
    ['EDGE_LAMBDA', [1500, 1600], { channel: 'R', edge_side: 'right', cmp: 'ge', target: 1520 },
        { lambdaStart: 1500, lambdaEnd: 1600, channel: 'R', edgeSide: 'right', cmp: 'ge', target: 1520 }],
    ['INTEGRAL', [1500, 1600], { channel: 'R', source: { id: 'blackbody', T: 3000 }, detector: { id: 'flat' }, preset_label: 'Lamp' },
        { lambdaStart: 1500, lambdaEnd: 1600, channel: 'R', source: { id: 'blackbody', T: 3000 }, detector: { id: 'flat' }, presetLabel: 'Lamp' }],
    ['INTEGRAL', [], { preset_key: 'TNIR', cmp: 'ge', target: 0.5 }, { presetKey: 'TNIR', cmp: 'ge', target: 0.5 }],
    ['THICKNESS_BUDGET', [], { cmp: 'le', target: 5000, side: 'front' }, { cmp: 'le', target: 5000, side: 'front' }],
    ['LAYER_COUNT', [], { cmp: 'le', target: 30 }, { cmp: 'le', target: 30 }],
    ['PPEF', [], { curve_id: curveId, cmp: 'le', target: 3 }, { curveId, cmp: 'le', target: 3 }],
];
// SpecCheck's attributes in Python's names, in _pythonObjects.py's order, by
// the fields of a check they read.
const SPEC_FIELDS = [['kind', 'kind'], ['label', 'label'], ['enabled', 'enabled'], ['cmp', 'cmp'], ['target', 'target'], ['tol', 'tol'], ['lo', 'lo'],
    ['hi', 'hi'], ['wavelength', 'lambda'], ['start', 'lambdaStart'], ['end', 'lambdaEnd'], ['aoi', 'aoi'], ['pol', 'pol'], ['channel', 'channel'],
    ['direction', 'direction'], ['level', 'level'], ['edge_side', 'edgeSide'], ['flag', 'flag'], ['side', 'side'], ['preset_key', 'presetKey'],
    ['preset_label', 'presetLabel'], ['source', 'source'], ['detector', 'detector'], ['band_points', 'bandPoints'], ['curve_id', 'curveId']];
// A design's checks without the id each draws.
const checksOf = (canon, data) => canon((data?.qualifiers ?? []).map(({ id, ...check }) => check));

// The words each refusal of _pythonObjects.py specification() is to be in, in its order.
const SPEC_WORDED = [
    'check: the design has no specification check; add one with specification.add()',
    'estimate_yield: the design has no enabled specification check; add one with specification.add()',
    'add: R_AT is checked at one wavelength, start, and takes no end, not 600',
    'add: LAYER_COUNT reads no wavelength, and takes no start or end, not 15',
    'add: PPEF reads no wavelength, and takes no start or end, not 3',
    'add: start 650 is above end 450',
    'add: start is a wavelength in nm above 0, not -5',
    "add: end is a wavelength in nm above 0, not 'x'",
    "add: unknown option 'id'; each check add() adds gets an id of its own",
    "add: unknown option 'lambda_start'; a check's kind and wavelengths are add()'s arguments, kind, start and end",
    "add: unknown option 'lambdaStart'; a check's kind and wavelengths are add()'s arguments, kind, start and end",
    "add: unknown option 'lambdaStart'; a check's kind and wavelengths are add()'s arguments, kind, start and end",
    "add: edge_side is 'left' or 'right', not 'up'",
    'add: start is 380, as preset Rvis sets it, or left out, not 400',
    "add: hi is a number in the check's unit no lower than lo, 0.9, not 0.8",
    'add: flag is None, as MIN_MAX of the highest R has no Step, not 2',
    "add: curve_id is the id of one of the design's measured curves, and it has none, not 'none'",
    'add: band_points is a whole number of 2 or more, or None for the default, not 1',
    'check 0: the specification has 0 checks, numbered from 0',
    "add: unknown option 'targt'; the options are enabled, label, cmp, target, tol, lo, hi, aoi, pol, channel, direction, level, edge_side, flag, side, "
        + 'preset_key, preset_label, source, detector, band_points, curve_id',
];

// The checks _pythonObjects.py added, read, removed and cleared, and the
// verdict on them, against setSpecification and checkSpecification here.
async function specification(t, said, measured) {
    const { api, ok, canon, attempt } = t;
    const got = said.specification ?? {};
    const kinds = specKinds(measured.measuredCurves[0].id);
    const made = await attempt(() => api.setSpecification(measured, kinds.map(([kind, , , fields]) => ({ kind, ...fields }))));
    ok('specification.add() makes the checks setSpecification makes, for every kind, with the wavelengths its kind takes and keywords in snake_case',
        checksOf(canon, got.added) === checksOf(canon, made) && canon({ ...got.added, qualifiers: null }) === canon({ ...measured, qualifiers: null }),
        checksOf(canon, got.added).slice(0, 300));
    const held = (got.added?.qualifiers ?? []).map(check => SPEC_FIELDS.map(([, field]) => check[field] ?? null));
    // A check the app saved that setSpecification refuses, such as one of an
    // integral preset its user saved, stays as it is when a check is added.
    const layerCount = (await attempt(() => api.setSpecification(measured, [{ kind: 'LAYER_COUNT', cmp: 'le', target: 30 }]))).qualifiers?.[0];
    ok('and a check the app saved that setSpecification refuses stays as it was',
        canon(got.holding) === canon([{ ...made.qualifiers?.[11], presetKey: 'My preset' }, layerCount]), canon(got.holding));
    ok('rows are SpecChecks, each attribute reading its field of the check', canon(got.rows) === canon(held)
        && canon(got.attributes) === canon(SPEC_FIELDS.map(([name]) => name).sort()), canon(got.rows?.[0]));
    ok('as they were when rows was read, so changing what one holds changes nothing', got.snapshot === 3000, got.snapshot);
    const last = kinds.length - 1;
    const [cleared, clearedCount, count] = got.cleared ?? [];
    ok('remove() takes out the check at its index from 0', checksOf(canon, got.removed) === checksOf(canon, { qualifiers: made.qualifiers?.filter((_, i) => ![1, last].includes(i)) }));
    ok('and clear() every check, in the copy alone', canon(cleared) === canon(await attempt(() => api.setSpecification(got.added, [])))
        && clearedCount === 0 && count === kinds.length);
    const numberedFrom0 = `the specification has ${count} checks, numbered from 0`;
    ok('and remove() refuses an index the specification has no check at, True among them', canon(got.outside) === canon([`check -1: ${numberedFrom0}`,
        `check ${count}: ${numberedFrom0}`, `check 1.5: ${numberedFrom0}`, `check '1': ${numberedFrom0}`, `check True: ${numberedFrom0}`]), canon(got.outside));
    const verdict = await attempt(() => api.checkSpecification(got.added));
    const rows = (verdict.rows ?? []).map(r => [r.kind, r.label, r.value, r.unit, r.passed, r.margin,
        ['cmp', 'target', 'tol', 'lo', 'hi'].map(field => r.threshold[field] ?? null), r.reason]);
    ok('check() is checkSpecification, row by row, with passed, passing, total and mode', rows.length === kinds.length && canon(got.report) === canon(rows)
        && canon(got.verdict) === canon([verdict.passed, verdict.passing, verdict.total, verdict.mode]), canon(got.report)?.slice(0, 300));
    const unlike = SPEC_WORDED.map((words, i) => [got.worded?.[i], words]).filter(([saidWords, words]) => saidWords !== words);
    ok('the specification\'s refusals reach the objects in Python\'s words', got.worded?.length === SPEC_WORDED.length && unlike.length === 0,
        unlike.map(([saidWords]) => saidWords).join('\n'));
    ok('a band whose end is its start is taken', canon(got.point) === '[600,600]', canon(got.point));
    const [disabled, counted, value, passed] = got.shown ?? [];
    ok('repr() shows a disabled check as disabled, and a value with no unit without one', disabled === '<CheckResult A_AVG: disabled>'
        && counted === `<CheckResult LAYER_COUNT: ${value}, ${passed ? 'passed' : 'not passed'}>`, `${disabled} ${counted}`);
}

// The yields _pythonObjects.py yields() counted, against estimateYield and
// monteCarlo here with the same seeds.
async function yields(t, said) {
    const { api, ok, canon, attempt } = t;
    const got = said.yield ?? {};
    const errors = { thicknessRelPct: 3, indexRe: 0.01, distribution: 'uniform', seed: 9 };
    const fields = (spec, seed, mode) => [spec?.yield, spec?.passCount, spec?.evaluated, spec?.yieldInterval,
        (spec?.perQualifier ?? []).map(check => [check.label, check.failRate]), spec?.nTrials, seed, mode];
    const seeded = await attempt(() => api.estimateYield(got.design, { runs: 40, ...errors }));
    ok('estimate_yield() is estimateYield with the same seed: value, pass_count, evaluated, interval, checks, runs, seed and mode',
        canon(got.seeded) === canon(fields(seeded, seeded.seed, seeded.mode)) && got.seeded[0] > 0 && got.seeded[0] < 1, canon(got.seeded));
    ok('repr() shows the yield with the trials that passed of those checked', got.shown === `<Yield ${seeded.yield} (${seeded.passCount} of ${seeded.evaluated} checked), seed 9>`, got.shown);
    const documented = await attempt(() => api.estimateYield(got.design, { runs: 30, seed: 4, thicknessRelPct: 1, thicknessAbsNm: 0, indexRe: 0, indexIm: 0,
        distribution: 'gaussian' }));
    ok('and the defaults it documents are monteCarlo\'s', canon(got.defaults) === canon(fields(documented, 4, 'front')), canon(got.defaults));
    const mc = await attempt(() => api.monteCarlo(got.design, { from: 500, to: 600, step: 10, runs: 40, ...errors }));
    ok('a MonteCarlo\'s spec is a Yield of its trials, monteCarlo\'s spec with the run\'s seed and mode', canon(got.monteCarlo) === canon(fields(mc.spec, mc.seed, 'front'))
        && canon(got.monteCarlo) === canon(got.seeded), canon(got.monteCarlo));
    // With every check left out of the verdict, no trial is checked, though
    // each is run; scored on the whole part, its mode says so.
    ok('a spec with no trial checked has no value or interval, its runs the trials run, and the mode the whole part',
        canon(got.unchecked) === canon([null, 0, 0, null, [['LAYER_COUNT', 0]], 5, 1, 'total']), canon(got.unchecked));
    // The server sends on at most four reports a second (apiServer/hooks.js),
    // so the trials reported are the first, the last and some between.
    const trials = got.trials ?? [];
    const inOrder = trials.every(([trial, total], i) => total === 10 && trial >= (trials[i - 1]?.[0] ?? 1));
    ok('progress= is given a Progress of the trials made, the first to the last', canon(trials[0]) === '[1,10]' && canon(trials.at(-1)) === '[10,10]' && inOrder,
        canon(trials));
    ok('and an exception it raises stops the run and goes on', got.raised === 'raised at trial 1 of 20', got.raised);
    ok('a Stop stopped before the run ends it at once, answering with the trials made', got.stopped <= 1, got.stopped);
    ok('and runs that are not a count of trials, and a setting it does not take, are refused in Python\'s words', canon(got.refused) === canon([
        'estimate_yield: runs is a whole number of 1 or more, not 0', 'estimate_yield: runs is a whole number of 1 or more, not None',
        "estimate_yield: unknown option 'thickness_rel'; the options are thickness_rel_pct, thickness_abs_nm, index_re, index_im, distribution, seed, progress, stop"]),
    canon(got.refused));
}

// The cleanups _pythonObjects.py cleaning() made, against cleanDesign here on
// the design they started from.
async function cleaning(t, said) {
    const { api, ok, canon, attempt } = t;
    const got = said.cleaning ?? {};
    const reportOf = cleaned => [cleaned.removed, cleaned.merged, (cleaned.operations ?? []).map(op => [op.side, op.kind, op.number, op.material, op.thickness, op.mergedInto])];
    const plain = await attempt(() => api.cleanDesign(got.before));
    ok('clean() changes the design in place to what cleanDesign gives with its defaults, and its CleanReport holds cleanDesign\'s counts and operations',
        !!plain.design && canon(got.after) === canon(plain.design) && canon(got.report) === canon(reportOf(plain)) && plain.operations.length === 5, canon(got.report));
    ok('as named tuples (side, kind, number, material, thickness, merged_into), and repr() shows the counts',
        canon(got.fields) === canon(['side', 'kind', 'number', 'material', 'thickness', 'merged_into']) && got.shown === '<CleanReport 3 taken out, 2 merged>', got.shown);
    ok('each operation\'s number reads, through design.layers and design.back_layers of the design before, its layer and the one it is merged into',
        canon(got.named) === canon((plain.operations ?? []).map(op => [op.material, op.thickness, op.kind === 'merge' ? op.material : null])), canon(got.named));
    const [optioned, backOnly] = got.optioned ?? [];
    const optionedThere = await attempt(() => api.cleanDesign(got.before, { minThickness: 1.8, mergeAdjacent: false, cleanBack: true }));
    ok('min_thickness, merge and back are cleanDesign\'s minThickness, mergeAdjacent and cleanBack', canon(optioned) === canon(optionedThere.design)
        && canon(backOnly) === canon(reportOf(optionedThere)) && optionedThere.operations?.length === 1, canon(backOnly));
    ok('back=False leaves the back as it was', canon(got.frontOnly) === canon((await attempt(() => api.cleanDesign(got.before, { cleanBack: false }))).design)
        && got.frontOnly?.backLayers?.length === 5);
    const [symmetricBefore, symmetricAfter] = got.symmetric ?? [];
    ok('a symmetric design\'s back follows its cleaned front', canon(symmetricAfter) === canon((await attempt(() => api.cleanDesign(symmetricBefore))).design)
        && symmetricAfter?.backLayers?.length === symmetricAfter?.frontLayers?.length);
    ok('clean()\'s refusals are in Python\'s words, and leave the design as it was', canon(got.worded) === canon([
        'clean: min_thickness is a thickness in nm of 0 or more, not -1', 'clean: min_thickness is a thickness in nm of 0 or more, not None',
        'clean: merge is True or False, not 1', "clean: back is True or False, not 'yes'",
        'clean: the design has no layers; add them with layers.append() or stack()']) && got.kept === true, canon(got.worded));
}

// What _pythonObjects.py stack_views() read of a design coated on both
// sides, against the plain calls here on the design it read.
const profileOf = p => [p.mode, p.wavelength, p.incident && [p.incident.material, p.incident.n, p.incident.k],
    p.substrate && [p.substrate.material, p.substrate.n, p.substrate.k, p.substrate.thickness ?? null],
    p.layers.map(l => [l.side ?? p.mode, l.number, l.material, l.n, l.k, l.thickness, l.start, l.end]), p.thickness, p.opticalThickness, p.outOfRange];
const thicknessesOf = t => [t.mode, t.wavelength, t.rows.map(r => [r.side ?? t.mode, r.number, r.material, r.thickness, r.opticalThickness, r.qwot, r.fwot]), t.outOfRange];
// A CSV's text as rows of fields, the numbers read as numbers, since Python
// and JavaScript print some of them differently (1e-05 and 0.00001).
const csvRows = text => String(text).split(/\r?\n/).filter(Boolean).map(line => line.split(',').map(field => (field !== '' && Number.isFinite(Number(field)) ? Number(field) : field)));

async function stackViews(t, said) {
    const { api, ok, canon, attempt, WORK } = t;
    const got = said.stackViews ?? {};
    const design = got.design ?? {};
    const PROFILES = [undefined, { wavelength: 633 }, { side: 'back', wavelength: 1064 }];
    const profiles = await Promise.all(PROFILES.map(options => attempt(() => profileOf(api.indexProfile(design, options)))));
    const thicknesses = await Promise.all([undefined, { wavelength: 550, side: 'front' }].map(options => attempt(() => thicknessesOf(api.layerThicknesses(design, options)))));
    ok('index_profile() and layer_thicknesses() are indexProfile and layerThicknesses, with their defaults and each argument, as named tuples',
        canon(got.profiles) === canon(profiles) && canon(got.thicknesses) === canon(thicknesses) && profiles[0][0] === 'total'
        && canon(got.fields) === canon([['side', 'number', 'material', 'n', 'k', 'thickness', 'start', 'end'], ['side', 'number', 'material', 'thickness', 'optical_thickness', 'qwot', 'fwot']]),
        canon(got.profiles)?.slice(0, 300));
    const objects = await import('../src/api/objects/index.js');
    const csvThere = [{ side: 'front', wavelength: 633 }, undefined].map((options, i) => {
        const file = path.join(WORK, `js-profile-${i}.csv`);
        new objects.IndexProfile(api.indexProfile(design, options)).saveCsv(file);
        return csvRows(fs.readFileSync(file, 'utf8'));
    });
    ok('save_csv writes what saveCsv writes, on one side and on the whole part', canon((got.csv ?? []).map(csvRows)) === canon(csvThere) && csvThere[1][0].join() === 'region,z,n,k',
        String(got.csv?.[1]).slice(0, 200));
    const facts = ['front', 'back', 'total'].reduce((all, side) => [...all, api.designFacts(design, { side })], [api.designFacts(design)]);
    ok('total_thickness(), optical_thickness() and layer_counts() are designFacts\', with and without side', canon(got.facts) === canon(facts.map(f => [f.thickness, f.opticalThickness, f.layerCounts])),
        canon(got.facts));
    const all = facts[3];
    ok('layer.qwot reads designFacts\' QWOT of each layer, on the front and the back', canon(got.qwots) === canon([...all.qwot.front, ...all.qwot.back]) && got.qwots.every(q => q > 0), canon(got.qwots));
    const front = design.frontLayers?.length ?? 0;
    const set = await attempt(() => api.setLayer(api.setLayer(design, { index: front - 2, qwot: 1.5 }), { side: 'back', index: 0, qwot: 0.75 }));
    ok('setting layer.qwot is setLayer with qwot, and reads back as set', canon(got.set) === canon(set) && Math.abs(got.read?.[0] - 1.5) < 1e-12 && Math.abs(got.read?.[1] - 0.75) < 1e-12,
        canon(got.read));
    ok('a layer whose material resolves to nothing reads its QWOT and the optical thickness as None', canon(got.lost) === canon([null, null]), canon(got.lost));
    ok('their refusals are in Python\'s words', canon(got.worded) === canon([
        'layer 1: qwot is a quarter-wave optical thickness above 0, not 0',
        `layer ${front}: NoSuchFilm resolves to nothing, so the layer has no quarter wave; set its thickness in nm`,
        'layer 1: the back of a symmetric design mirrors its front; edit the front',
        "index_profile: side is 'front', 'back' or 'total', not 'both'",
        'layer_thicknesses: wavelength is a wavelength in nm above 0, not -5',
        'layer_thicknesses: the back has no layers',
        'index_profile: the front has no layer thicker than 0 nm',
    ]), canon(got.worded));
    ok('and repr() shows what they hold', canon(got.shown) === canon([`<IndexProfile total at 600 nm: ${front + (design.backLayers?.length ?? 0)} layers, ${api.indexProfile(design, { wavelength: 600 }).thickness} nm>`,
        `<LayerThicknesses front at 600 nm: ${front} layers>`]), canon(got.shown));
}

const RUN_CALLS = {
    dls: (api, before) => api.refine(before, { method: 'dls', maxIter: 20 }),
    sa: (api, before) => api.refine(before, { method: 'sa', maxIter: 20, seed: 5 }),
    needle: (api, before, pool) => api.synthesize(before, { method: 'needle', pool, settings: { maxLayers: 12, refineIter: 10, threads: 1 } }),
    structural: (api, before, pool) => api.synthesize(before, { method: 'structural', pool, settings: { maxIter: 3, refineIter: 5, threads: 1, seed: 7 } }),
};

async function runs(t, said) {
    const { api, ok, canon, attempt, failure, POOL } = t;
    const wrong = [];
    for (const [name, call] of Object.entries(RUN_CALLS)) {
        const got = said.runs?.[name] ?? {};
        const { result = {}, design } = await attempt(() => call(api, got.before, POOL));
        const expected = [result.completed, result.stopReason, result.mf ?? null, result.omf ?? null, result.mfInitial ?? null,
            result.iter ?? result.iters ?? null, result.seed ?? null, 'front'];
        const same = canon(got.after) === canon(design) && canon(got.result) === canon(expected) && canon(got.reported) === canon(result);
        if (!same) wrong.push(`${name}: ${canon(got.result)} / ${canon(expected)}`);
    }
    ok('refine and synthesize leave in the design what the API answers, and their results are its result, seeds included', wrong.length === 0
        && said.unchanged === true, wrong.join('\n') || failure(t.ran));
    const before = said.runs?.dls?.before;
    const mc = await attempt(() => api.monteCarlo(before, { from: 450, to: 650, step: 10, runs: 5, seed: 3 }));
    ok('monte_carlo answers what monteCarlo answers with the same seed', canon(said.monteCarlo?.curves)
        === canon([mc.lambda, mc.theory, mc.mean, mc.stdev, mc.lower, mc.upper, mc.envLower, mc.envUpper])
        && canon(said.monteCarlo?.rest) === canon([mc.nTrials, mc.char, mc.seed, mc.spec, 'front']), canon(said.monteCarlo?.rest));
    const ranked = await attempt(() => api.layerSensitivity(before, { deltaNm: 2 }));
    const ranks = rankRows(ranked, before?.frontLayers?.length);
    const sensitivity = said.sensitivity ?? {};
    ok('layer_sensitivity is layerSensitivity, its rows numbered from the substrate', canon(sensitivity.rows) === canon(ranks)
        && sensitivity.merit === ranked.mf0 && sensitivity.mode === 'front', canon(sensitivity.rows)?.slice(0, 200));
    const byNumber = Object.fromEntries((said.listed ?? []).map(([number, , material, thickness]) => [number, canon([material, thickness])]));
    const scored = sensitivity.rows ?? [];
    ok('and each row\'s number names its layer', scored.length > 0 && scored.every(([, number, material, thickness]) => byNumber[number] === canon([material, thickness])));
    const misnamed = SETTINGS.filter(name => said.settingNames?.[snake(name)] !== name);
    ok('every setting of the synthesis methods is taken by its snake_case name', SETTINGS.length > 20 && misnamed.length === 0, misnamed.join(', '));
}

// What a run reports, folded as a Progress holds it: each report in the
// order the run made them, its method from onMethodStart.
async function folded(t, run) {
    const reported = {};
    const report = hook => (...args) => {
        if (hook === 'onMethodStart') reported.method = args[0];
        for (const arg of args) if (arg && typeof arg === 'object' && !Array.isArray(arg)) Object.assign(reported, arg);
    };
    await t.attempt(() => run(report));
    return reported;
}

// The Progress attributes, by the names the API's hooks report them under.
const KEYS = ['mf', 'mfBest', 'omf', 'iter', 'genNum', 'layerCount', 'method', 'seed', 'trial', 'total', 'activity'];

async function progress(t, said) {
    const { api, ok, canon, failure, POOL, DRAWN } = t;
    const got = said.progress ?? {};
    const hooksOf = (method, report) => Object.fromEntries(api.runHooks(method).filter(hook => hook !== 'signal').map(hook => [hook, report(hook)]));
    const expected = {
        refine: await folded(t, report => api.refine(got.design, { method: ['dls', 'cg'] }, hooksOf('refine', report))),
        needle: await folded(t, report => api.synthesize(got.design, { method: 'needle', pool: POOL, settings: { maxLayers: 12, refineIter: 10, threads: 1 } }, hooksOf('needle', report))),
        monteCarlo: await folded(t, report => api.monteCarlo(got.design, { from: 450, to: 650, step: 10, runs: 40, seed: 3 }, { onProgress: report('onProgress') })),
    };
    // A refinement goes on changing the merit history it reported, in place,
    // so the history that reaches Python is the one the server sent, which
    // depends on when it sent it. A Needle run's `live` report comes from its
    // pool's own message handling, so which one is last depends on timing too.
    // The rest of what was reported is compared.
    const TIMED = new Set(['mfHistory', 'live']);
    const differing = (a = {}, b = {}) => [...new Set([...Object.keys(a), ...Object.keys(b)])]
        .filter(key => !TIMED.has(key) && !DRAWN.has(key) && canon(a[key] ?? null) !== canon(b[key] ?? null));
    const wrong = Object.entries(expected).filter(([name, reported]) => !got.reported?.[name] || canon(got.last?.[name]) !== canon(KEYS.map(key => reported[key] ?? null))
        || differing(got.reported[name], reported).length > 0)
        .map(([name]) => `${name}: ${canon(got.last?.[name])} / ${canon(KEYS.map(key => expected[name][key] ?? null))}, differing ${differing(got.reported?.[name], expected[name])}`);
    const reached = got.last?.refine?.[6] === 'cg' && got.last?.needle?.[4] > 0 && got.last?.monteCarlo?.[8] === 40;
    ok('progress= is given a Progress holding what the run reported up to it, for a refinement, a Needle run and a Monte Carlo run', wrong.length === 0 && reached,
        wrong.join('\n') || failure(t.ran));
    ok('each Progress a snapshot of its own', got.snapshots === true);
    ok('and a refinement\'s method is there from the moment it starts, before its first iteration', got.methodWhileIterating === true);
}

function stopping(t, said) {
    const { ok, canon, STOPPED_WITHIN_S } = t;
    const got = said.stopping ?? {};
    ok('a Stop stopped in progress ends a run stopped, the design as it was', canon(got.stopped) === '["stopped",true]', canon(got.stopped));
    ok('Deep Synthesis\'s too, stopped once it has a best design, which its plain call answers with', canon(got.deep) === '["stopped",true]', canon(got.deep));
    ok('a Stop stopped before a run ends it at once', canon(got.before) === '["stopped",true]' && got.trials <= 1, `${canon(got.before)} ${got.trials}`);
    const [interruptedAfter, kept, runAfter] = got.interrupted ?? [];
    ok('Ctrl+C in progress stops the run, keeps the design and raises KeyboardInterrupt, and the server runs on', interruptedAfter < STOPPED_WITHIN_S && kept === true
        && typeof runAfter === 'string', JSON.stringify(got.interrupted));
    ok('a stop that is not a Stop is refused', got.notStop === 'stop is a tfstudio.Stop, whose stop() ends the run', got.notStop);
    ok('every public class, method and attribute is documented, with an example', said.names?.undocumented?.length === 0
        && Object.keys(said.names.all).includes('Design'), JSON.stringify(said.names?.undocumented));
}

// The words each refusal of _pythonObjects.py refusals() is to be in, in its
// order: those tests/api_objects.mjs checks, in Python's names; those of
// insert(), remove(), a design coated on its back and synthesize(); what
// an option takes with the API's true, false and null as True, False and None;
// and a setting misspelt, or of a value it cannot take, for each run.
const WORDED = [
    'refine: the design has no merit function; add a row with merit.add()',
    'layer_sensitivity: the design has no merit function; add a row with merit.add()',
    "append: a design coated on the front alone and scored on that side does not evaluate the back; to edit it, set sides to 'both', or score_on to 'whole part'",
    "insert: a design coated on the front alone and scored on that side does not evaluate the back; to edit it, set sides to 'both', or score_on to 'whole part'",
    "append: a design coated on the back alone and scored on that side does not evaluate the front; to edit it, set sides to 'both', or score_on to 'whole part'",
    'remove: the back of a symmetric design mirrors its front; edit the front',
    'layer 1: thickness is a physical thickness in nm above 0, not -5',
    'add: aoi is an angle of incidence in degrees, 0 <= aoi < 90, not 95',
    "add: start is a number, not 'x'",
    'add: start 700 is above end 400',
    'spectrum: start and end are wavelengths in nm, 0 < start < end',
    "monte_carlo: unknown option 'thickness_rel'; the options are quantity, step, angle, polarization, runs, thickness_rel_pct, thickness_abs_nm, index_re, index_im, "
        + 'distribution, seed, progress, stop',
    'reference is a wavelength in nm above 0, not -1',
    'substrate.thickness is a thickness in mm above 0, not 0',
    'stack: at is a wavelength in nm above 0, not -5',
    "stack: the formula names media; write the layers alone, such as '(HL)^5 H', and set the media with incident_medium, exit_medium and substrate.material",
    'nk: wavelengths is a list of wavelengths in nm above 0',
    'new_design: reference is a wavelength in nm above 0, not 0',
    'synthesize: the design has no merit function; add a row with merit.add()',
    'append: locked is True or False, not 1',
    "add: target_end is a number or None, not 'x'",
    "add: unknown option 'lambda_start'; a row's type, start and end are add()'s arguments",
    "add: unknown option 'lambdaStart'; a row's type, start and end are add()'s arguments",
    "refine: unknown option 'max_iters'; the options are method, max_iter, n_restarts, perturb_pct, seed, threads, progress, stop",
    'synthesize: max_layers is a whole number of 1 or more, not 0',
    'synthesize: refine_iter is a whole number of 1 or more, not 0',
    'synthesize: max_iter is a whole number of 1 or more, not 0',
    'synthesize: max_layers is a whole number of 1 or more, not 0',
];

// The plain calls' refusals reaching the objects in Python's words, while
// studio._calls keeps the API's own, with the code and fields they are
// worded from.
async function refusals(t, got) {
    const { api, ok, canon, local } = t;
    const unlike = WORDED.map((words, i) => [got.worded?.[i], words]).filter(([said, words]) => said !== words);
    ok('the plain calls\' refusals reach the objects in Python\'s words', got.worded?.length === WORDED.length && unlike.length === 0,
        unlike.map(([said]) => said).join('\n'));
    ok('a row\'s type and a formula that does not read too, the method named in place of the call',
        /^add: unknown operand type 'XYZ'\. Types: /.test(got.rowType ?? '') && /^stack: the formula does not read: /.test(got.formula ?? ''), `${got.rowType} / ${got.formula}`);
    const listed = String(got.rowOption).split('; the options are ')[1]?.split(', ') ?? [];
    ok('and an option a row does not take is refused naming the options add() takes in snake_case, start and end and the type being its arguments',
        /^add: unknown option 'targt'; the options are id, enabled, aoi, pol, target, target_end, weight, cmp, comment, /.test(got.rowOption ?? '')
        && listed.includes('ref_id1') && !['type', 'start', 'end', 'lambda_start', 'lambda_end'].some(name => listed.includes(name)), got.rowOption);
    const design = got.design ?? {};
    const apiSays = (await local('insertLayer', [design, { material: 'Unobtainium', thickness: 10 }])).error;
    ok('a refusal that names no call, such as an unknown material, reaches the objects as the API words it', !!apiSays && got.unknownMaterial === apiSays,
        got.unknownMaterial);
    const thrown = async make => {
        try { await make(); return null; } catch (err) { return [err.message, err.code, err.fields]; }
    };
    const plain = [
        await thrown(() => api.refine(design, { method: 'dls' })),
        await thrown(() => api.insertLayer(design, { side: 'back', material: 'SiO2', thickness: 10 })),
        await thrown(() => api.setMerit(design, [{ type: 'RAV', lambdaStart: 700, lambdaEnd: 400 }])),
        await thrown(() => api.spectrum(design, { from: 700, to: 400 })),
    ];
    ok('while studio._calls keeps the API\'s words, with the code and fields of each refusal', plain.every(Boolean) && canon(got.plain ?? null) === canon(plain),
        canon(got.plain ?? null));
}

export async function checkObjects(t) {
    const named = t.api.findMaterials('').find(m => m.catalog === 'builtin' && m.name !== m.id);
    const measuredFile = fixtureFile('measured-curve-ppef');
    const measured = t.api.openDesign(measuredFile);
    const input = { name: named.name, pool: t.POOL, settingNames: SETTINGS.map(snake), dataDir: twinsFolder(t.WORK), measured: measuredFile,
        specKinds: specKinds(measured.measuredCurves[0].id) };
    const ran = await t.scenario('objects', { driver: DRIVER, input });
    const u = { ...t, ran };
    const count = await designs(u, ran.said);
    await files(u, ran.said);
    await modes(u, ran.said);
    await materials(u, ran.said, named);
    await spectra(u, ran.said);
    await merit(u, ran.said, count);
    await specification(u, ran.said, measured);
    await yields(u, ran.said);
    await cleaning(u, ran.said);
    await stackViews(u, ran.said);
    await runs(u, ran.said);
    await progress(u, ran.said);
    stopping(u, ran.said);
    await refusals(u, ran.said.pythonWords ?? {});
}
