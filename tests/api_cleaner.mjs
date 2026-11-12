/**
 * The headless API's cleanDesign (src/api/cleaner.js) against the Design
 * Cleaner window's own code.
 *
 *   1. cleanDesign gives cleanupDesign's design and operations, on the corpus
 *      designs coated on the front, on the back, on both and symmetric, each
 *      with thin layers, same-material neighbours and locked layers made in on
 *      each side, over a spread of minimum thicknesses with and without
 *      merging, on each side the design takes and on both, and with cleanBack
 *      either way. Each operation's number and mergedInto name, by its number
 *      from the substrate, the layer cleanupDesign's index names; the counts
 *      are cleanupDesign's, a locked layer is never touched, a side not
 *      cleaned is left exactly as it was, a symmetric design's back is the
 *      mirror of its cleaned front with no id on both sides, and the design
 *      given is left as it was.
 *   2. On a stack coated on both sides, unlike on each, the numbers are the
 *      Design Editor's: on this stack, where no layer taken out had one merged
 *      into it, the layer at each number in the design given has the
 *      operation's material and thickness, on the front, whose layers are
 *      stored from the incident medium in, and on the back, stored from the
 *      substrate out. A layer taken out after a neighbour was merged into it
 *      gives the two layers' thickness. Side 'back' cleans the back as both
 *      sides' cleanup does and leaves the front exactly as it was, side
 *      'front' the other way round; cleanBack false is side 'front' and true
 *      is 'both'.
 *   3. The defaults are the window's factory settings (sessionState.js), each
 *      of which the test design tells apart from another value.
 *   4. Each name and value it cannot use is refused with the code and fields
 *      an object layer words it from: a side it does not know, side beside
 *      cleanBack, the back of a symmetric design, a side with no layers, and
 *      a design with no layers. cleanBack false on a design coated on the
 *      back alone still does nothing.
 *   5. The window's path, against the window's model with Re-optimize on
 *      (model.js applyCleanup, on this thread, no worker). Clean, then an MNT
 *      row at the window's minimum thickness, then refine with the window's
 *      method and step budget, ends on the window's thicknesses, as the doc
 *      says: on a mirror whose refinement keeps its layers above the minimum;
 *      on an antireflection coating whose refinement drives layers thin, which
 *      the window holds at its minimum thickness and refine with no MNT row at
 *      1 nm; and on a narrowband filter scored by a TGT row over its pass
 *      band, which a run samples more densely than the merit does.
 *   6. The doc example runs, with the plain API as tf.
 *   7. The docs of cleanDesign and of design.clean in JavaScript and Python
 *      give the window's minimum thickness as the default, and its method
 *      and step budget for Re-optimize.
 *
 * Run: node tests/api_cleaner.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { fixtureFile, manifest } from './_apiCorpus.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = await import('../src/api/index.js');
const { cleanupDesign } = await import('../src/utils/synthesis/designCleaner.js');
const { mirrorLayers, makeOperand, withDesignSampleCounts } = await import('../src/utils/physics/optimizer.js');
const { DEFAULT_REFINE_METHOD } = await import('../src/utils/optimizers/index.js');
const { densifyForRun } = await import('../src/utils/refinement/workerInputs.js');
const { designCleanerSession } = await import('../src/components/windows/optimization/designCleaner/sessionState.js');
const { applyCleanup, computeCleanupPreview } = await import('../src/components/windows/optimization/designCleaner/model.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { apiCalls } = await import('../tools/api-reference/docComments.mjs');
const { jsObjects } = await import('../tools/api-reference/jsObjects.mjs');
const { pyObjects } = await import('../tools/api-reference/pyDocstrings.mjs');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
// What `fn` throws, or null.
const thrown = fn => { try { fn(); return null; } catch (err) { return err; } };
const quietly = async run => {
    const { log, warn, error } = console;
    console.log = console.warn = console.error = () => {};
    try { return await run(); } finally { Object.assign(console, { log, warn, error }); }
};

await api.init();

// The window's factory settings, as a window with no copy open reads them.
const FACTORY = designCleanerSession.peek(null, null);

// ── 1. cleanDesign is cleanupDesign ────────────────────────────────────────
// `layers` (stored order, some side of a design) and a TiO2 and a SiO2 layer,
// with what the cleaner acts on made in: a same-material neighbour, a 2 nm
// layer, a locked 1 nm one, a 3.5 nm layer between two of one material, and a
// locked pair of one material.
function messy(layers, tag) {
    const base = [...layers, { id: `${tag}x1`, material: 'TiO2', thickness: 50, locked: false }, { id: `${tag}x2`, material: 'SiO2', thickness: 80, locked: false }];
    const a = base[0].material;
    const b = base.find(l => l.material !== a).material;
    return [
        { id: `${tag}n1`, material: a, thickness: 7, locked: false },
        base[0],
        { id: `${tag}t1`, material: b, thickness: 2, locked: false },
        { id: `${tag}t2`, material: b, thickness: 1, locked: true },
        ...base.slice(1),
        { id: `${tag}a1`, material: a, thickness: 30, locked: false },
        { id: `${tag}t3`, material: b, thickness: 3.5, locked: false },
        { id: `${tag}a2`, material: a, thickness: 20, locked: false },
        { id: `${tag}l1`, material: a, thickness: 40, locked: true },
        { id: `${tag}l2`, material: a, thickness: 40, locked: true },
    ];
}

const MODES = ['front_only', 'back_only', 'both_independent', 'symmetric'];
// A design with both sides made messy, in surface mode `mode`; a symmetric
// design's back is the mirror of its front, as the app keeps it.
function made(design, mode) {
    const frontLayers = messy(design.frontLayers || [], 'f');
    const backLayers = mode === 'symmetric' ? mirrorLayers(frontLayers) : messy(design.backLayers || [], 'b');
    return { ...design, surfaceMode: mode, frontLayers, backLayers };
}

// cleanupDesign's operation `op` on `design` as cleanDesign is to give it: its
// layers numbered by their place counted from the substrate.
function expectedOperation(design, op) {
    const stored = op.side === 'front' ? design.frontLayers : design.backLayers;
    const fromSubstrate = op.side === 'front' ? [...stored].reverse() : stored;
    const numberOf = index => fromSubstrate.indexOf(stored[index]) + 1;
    return {
        side: op.side, kind: op.kind, number: numberOf(op.srcIdx), material: op.materialId, thickness: op.thickness,
        mergedInto: op.kind === 'merge' ? numberOf(op.mergedInto) : null,
    };
}

// The locked layers of each side, which a cleanup leaves as they are.
const lockedOf = d => [d.frontLayers, d.backLayers].map(layers => layers.filter(l => l.locked).map(l => [l.id, l.material, l.thickness]));
const mirrored = d => d.surfaceMode !== 'symmetric' || isDeepStrictEqual(d.backLayers, mirrorLayers(d.frontLayers));
const sharedIds = d => d.frontLayers.filter(front => d.backLayers.some(back => back.id === front.id));

// The side cleanDesign is to clean with `options`: side, or as cleanBack says.
const sideOf = options => options.side ?? (options.cleanBack === false ? 'front' : 'both');

// cleanDesign's operations on `design` with `options`, and what is wrong with
// its answer against the window's code: cleanupDesign with the same settings.
// A side not cleaned is left exactly as it was, unless it mirrors the front.
function checked(design, options) {
    const given = JSON.stringify(design);
    const got = api.cleanDesign(design, options);
    const side = sideOf(options);
    const raw = cleanupDesign(design, { dMin: options.minThickness, mergeAdjacent: options.mergeAdjacent, side });
    const expected = {
        design: raw.design, removed: raw.removedCount, merged: raw.mergedCount,
        operations: raw.ops.map(op => expectedOperation(design, op)), layersBefore: raw.layersBefore, layersAfter: raw.layersAfter,
    };
    const untouched = { front: 'back', back: 'front' }[side];
    const keptAsItWas = !untouched || design.surfaceMode === 'symmetric'
        || isDeepStrictEqual(got.design[`${untouched}Layers`], design[`${untouched}Layers`]);
    const checks = [
        [isDeepStrictEqual(got, expected), `${JSON.stringify(got.operations)} / ${JSON.stringify(expected.operations)}`],
        [isDeepStrictEqual(lockedOf(got.design), lockedOf(design)), 'a locked layer changed'],
        [mirrored(got.design), 'the back is not the mirror of the cleaned front'],
        [sharedIds(got.design).length === 0, 'a layer id is on both sides'],
        [keptAsItWas && got.operations.every(op => op.side !== untouched), `the ${untouched} was not left as it was`],
        [JSON.stringify(design) === given, 'the design given changed'],
    ];
    return { operations: got.operations, wrong: checks.filter(([held]) => !held).map(([, what]) => what) };
}

const CORPUS = Object.entries(manifest.fixtures).filter(([, fixture]) => Object.keys(fixture.variants).join() === 'default').map(([name]) => name);
// The sides each mode is cleaned on: cleanBack either way, and each side a
// design of that mode takes; a symmetric design's back follows its front.
const sidesTaken = mode => [{ cleanBack: true }, { cleanBack: false },
    ...(mode === 'symmetric' ? ['front', 'both'] : ['front', 'back', 'both']).map(side => ({ side }))];
const spread = mode => [0, 2.5, 5, 12].flatMap(minThickness => [true, false].flatMap(mergeAdjacent => sidesTaken(mode).map(side => ({ minThickness, mergeAdjacent, ...side }))));
const cases = CORPUS.flatMap(name => {
    const opened = api.openDesign(fixtureFile(name));
    return MODES.flatMap(mode => spread(mode).map(options => ({ name, mode, options, ...checked(made(opened, mode), options) })));
});
const wrong = cases.flatMap(({ name, mode, options, wrong: what }) => what.map(w => `${name} ${mode} ${JSON.stringify(options)}: ${w}`));
ok(`on ${CORPUS.length} corpus designs in every surface mode, cleanDesign gives cleanupDesign's design and operations, numbered from the substrate`,
    CORPUS.length >= 10 && wrong.length === 0, wrong.slice(0, 3).join('\n'));
const seen = [...new Set(cases.flatMap(({ mode, operations }) => operations.map(op => `${mode} ${op.side} ${op.kind}`)))].sort();
const sidesOf = mode => (mode === 'symmetric' ? ['front'] : ['front', 'back']);
const everyKind = MODES.flatMap(mode => sidesOf(mode).flatMap(side => ['merge', 'remove'].map(kind => `${mode} ${side} ${kind}`))).sort();
ok('layers were taken out and merged on each side in every mode, a symmetric design\'s back only mirrored', isDeepStrictEqual(seen, everyKind), seen.join(', '));

// ── 2. The numbers name the Design Editor's layers ─────────────────────────
{
    // Front stored from the incident medium in, back from the substrate out;
    // no two layers alike, so a number counted from the wrong end names a
    // layer of another material or thickness.
    const layer = (id, material, thickness) => ({ id, material, thickness, locked: false });
    const design = {
        ...api.newDesign({ name: 'Two sides' }), surfaceMode: 'both_independent',
        frontLayers: [layer('f0', 'MgF2', 100), layer('f1', 'Ta2O5', 2), layer('f2', 'SiO2', 50), layer('f3', 'SiO2', 30), layer('f4', 'TiO2', 20)],
        backLayers: [layer('b0', 'Al2O3', 40), layer('b1', 'Al2O3', 25), layer('b2', 'TiO2', 60), layer('b3', 'MgF2', 1.5)],
    };
    const { operations, design: cleaned } = api.cleanDesign(design);
    const shown = operations.map(op => [op.side, op.kind, op.number, op.mergedInto]);
    ok('on a stack coated on both sides each operation has the Design Editor\'s numbers', isDeepStrictEqual(shown, [
        ['front', 'merge', 2, 3], ['front', 'remove', 4, null], ['back', 'merge', 2, 1], ['back', 'remove', 4, null],
    ]), JSON.stringify(shown));
    // The Design Editor's layer `number` of a side, read as the object API reads it.
    const editorLayer = (side, number) => (side === 'front' ? design.frontLayers[design.frontLayers.length - number] : design.backLayers[number - 1]);
    const named = operations.every(op => editorLayer(op.side, op.number)?.material === op.material && editorLayer(op.side, op.number)?.thickness === op.thickness
        && (op.kind === 'remove' || editorLayer(op.side, op.mergedInto)?.material === op.material));
    ok('the layer at each number in the design given has the operation\'s material and thickness, and the one it is merged into its material', named);
    ok('and the cleaned stack holds the merged layers\' sum', cleaned.frontLayers.map(l => l.thickness).join() === '100,80,20'
        && cleaned.backLayers.map(l => l.thickness).join() === '65,60', JSON.stringify([cleaned.frontLayers, cleaned.backLayers].map(side => side.map(l => l.thickness))));
    // Two 2 nm SiO2 layers merged into one of 4 nm, which is then taken out.
    const chain = { ...api.newDesign({ name: 'Chain' }), frontLayers: [layer('c0', 'TiO2', 60), layer('c1', 'SiO2', 2), layer('c2', 'SiO2', 2), layer('c3', 'TiO2', 50)] };
    const takenOut = api.cleanDesign(chain).operations.find(op => op.kind === 'remove');
    ok('a layer taken out after a neighbour was merged into it gives the two layers\' thickness', takenOut?.material === 'SiO2' && takenOut.thickness === 4,
        JSON.stringify(takenOut));

    // One side cleaned: the other exactly as it was, ids and all, and the
    // side cleaned as cleaning both sides cleans it.
    const back = api.cleanDesign(design, { side: 'back' });
    ok('side \'back\' leaves the front of a design coated on both sides exactly as it was',
        isDeepStrictEqual(back.design.frontLayers, design.frontLayers), JSON.stringify(back.design.frontLayers.map(l => l.thickness)));
    ok('and cleans its back as cleaning both sides does, with the back\'s operations alone',
        isDeepStrictEqual([back.design.backLayers, back.removed, back.merged], [cleaned.backLayers, 1, 1])
        && back.operations.every(op => op.side === 'back'), JSON.stringify(back.operations));
    const front = api.cleanDesign(design, { side: 'front' });
    ok('and side \'front\' cleans its front and leaves its back exactly as it was',
        isDeepStrictEqual(front.design.backLayers, design.backLayers) && isDeepStrictEqual(front.design.frontLayers, cleaned.frontLayers)
        && front.operations.every(op => op.side === 'front'), JSON.stringify(front.operations));
    ok('cleanBack false cleans as side \'front\' does, and true as side \'both\'', isDeepStrictEqual(api.cleanDesign(design, { cleanBack: false }), front)
        && isDeepStrictEqual(api.cleanDesign(design, { cleanBack: true }), api.cleanDesign(design, { side: 'both' })));
}

// ── 3. The defaults are the window's ───────────────────────────────────────
{
    // A layer 0.01 nm under the factory minimum and one at it, each between
    // layers of another material, so a minimum 0.01 nm lower, or any higher,
    // cleans otherwise; a same-material pair; and a thin back layer.
    const layer = (id, material, thickness) => ({ id, material, thickness, locked: false });
    const design = {
        ...api.newDesign({ name: 'Defaults' }), surfaceMode: 'both_independent',
        frontLayers: [layer('f0', 'SiO2', 80), layer('f1', 'TiO2', FACTORY.dMin - 0.01), layer('f2', 'SiO2', 60), layer('f3', 'TiO2', FACTORY.dMin), layer('f4', 'SiO2', 50),
            layer('f5', 'SiO2', 40), layer('f6', 'TiO2', 30)],
        backLayers: [layer('b0', 'MgF2', 90), layer('b1', 'TiO2', 2), layer('b2', 'SiO2', 70)],
    };
    const windowSettings = { minThickness: FACTORY.dMin, mergeAdjacent: FACTORY.mergeAdjacent, side: FACTORY.side };
    const byDefault = api.cleanDesign(design);
    ok('with no options cleanDesign cleans as the window does with its factory settings', isDeepStrictEqual(byDefault, api.cleanDesign(design, windowSettings))
        && isDeepStrictEqual(byDefault, api.cleanDesign(design, {})), JSON.stringify(windowSettings));
    const otherSides = ['front', 'back', 'both'].filter(side => side !== FACTORY.side).map(side => ({ side }));
    const others = [{ minThickness: FACTORY.dMin - 2.5 }, { minThickness: FACTORY.dMin + 2.5 }, { mergeAdjacent: !FACTORY.mergeAdjacent }, ...otherSides];
    ok('and each default tells from another value on this design', others.every(changed => !isDeepStrictEqual(api.cleanDesign(design, { ...windowSettings, ...changed }), byDefault)));
}

// ── 4. Refusals ────────────────────────────────────────────────────────────
{
    const design = api.stackFromFormula(api.newDesign({ name: 'Stack' }), { formula: '(HL)^2' });
    const symmetric = api.setDesignSetup(design, { surfaceMode: 'symmetric' });
    const backOnly = { ...api.newDesign({ name: 'Back' }), surfaceMode: 'back_only', backLayers: [{ id: 'b', material: 'TiO2', thickness: 2, locked: false }] };
    const REFUSED = [
        ['an option it does not take', { mergeSame: true }, 'unknownOption', { option: 'mergeSame', options: ['minThickness', 'mergeAdjacent', 'side', 'cleanBack'] },
            /cleanDesign: unknown option 'mergeSame'; the options are minThickness, mergeAdjacent, side, cleanBack/],
        ['a minimum thickness below 0', { minThickness: -1 }, 'badValue', { option: 'minThickness', value: -1 }, /cleanDesign: minThickness is a thickness in nm of 0 or more, not -1/],
        ['a minimum thickness of NaN', { minThickness: NaN }, 'badValue', { option: 'minThickness' }, /not NaN/],
        ['a minimum thickness as text', { minThickness: '5' }, 'badValue', { option: 'minThickness', value: '5' }, /not "5"/],
        ['a merge switch that is not true or false', { mergeAdjacent: 1 }, 'badValue', { option: 'mergeAdjacent', takes: 'true or false', value: 1 }, /mergeAdjacent is true or false, not 1/],
        ['a back switch that is not true or false', { cleanBack: 'yes' }, 'badValue', { option: 'cleanBack', takes: 'true or false' }, /cleanBack is true or false, not "yes"/],
        ['a side it does not know', { side: 'top' }, 'badValue', { option: 'side', takes: "'front', 'back' or 'both'", value: 'top' },
            /cleanDesign: side is 'front', 'back' or 'both', not "top"/],
        ['side and cleanBack both', { side: 'back', cleanBack: false }, 'badValue', { option: 'cleanBack', takes: 'left out when side is given', value: false },
            /cleanDesign: cleanBack is left out when side is given, not false/],
        ['the back of a symmetric design, whose back mirrors its front', { side: 'back' }, 'badValue', { option: 'side', value: 'back' },
            /cleanDesign: side is 'front' or 'both' on a symmetric design, whose back mirrors its front, not "back"/, symmetric],
        ['a back with no layers', { side: 'back' }, 'emptySide', { side: 'back' }, /^cleanDesign: the back has no layers$/],
        ['a front with no layers', { side: 'front' }, 'emptySide', { side: 'front' }, /^cleanDesign: the front has no layers$/, backOnly],
    ];
    for (const [what, options, code, fields, pattern, on = design] of REFUSED) {
        const err = thrown(() => api.cleanDesign(on, options));
        const fieldsMatch = !!err?.fields && Object.entries({ call: 'cleanDesign', ...fields }).every(([key, value]) => isDeepStrictEqual(err.fields[key], value));
        ok(`cleanDesign refuses ${what}`, err?.code === code && fieldsMatch && pattern.test(err.message), err ? `${err.code} ${JSON.stringify(err.fields)} ${err.message}` : 'not refused');
    }
    const bare = thrown(() => api.cleanDesign(api.newDesign({ name: 'Bare' })));
    ok('and a design with no layers, as the window shows nothing to clean', bare?.code === 'noLayers' && isDeepStrictEqual(bare.fields, { call: 'cleanDesign' })
        && /cleanDesign: the design has no layers; add them with insertLayer or stackFromFormula/.test(bare.message), bare?.message);
    ok('a design with layers on its back alone is cleaned', api.cleanDesign(backOnly).removed === 1 && api.cleanDesign(backOnly, { side: 'back' }).removed === 1);
    const asBefore = api.cleanDesign(backOnly, { cleanBack: false });
    ok('and cleanBack false on it still cleans nothing, as it did before side', asBefore.removed === 0 && asBefore.operations.length === 0
        && isDeepStrictEqual(asBefore.design.backLayers, backOnly.backLayers));
    const sym = api.cleanDesign(symmetric, { side: 'front' });
    ok('a symmetric design takes side \'front\', which cleans it as \'both\' does', isDeepStrictEqual(sym, api.cleanDesign(symmetric, { side: 'both' })));
}

// ── 5. Clean, then refine, is the window's Re-optimize ─────────────────────
// The front of a design, alternating TiO2 and SiO2 at `base` nm each scaled
// off any optimum, with a 2 nm Ta2O5 layer the cleanup takes out and a SiO2
// pair it merges.
function toClean(base) {
    const frontLayers = Array.from({ length: 10 }, (_, i) => ({
        id: `L${i + 1}`, material: i % 2 === 0 ? 'TiO2' : 'SiO2', thickness: base[i % base.length] * (1 + 0.25 * Math.sin(1.7 * i + 0.3)), locked: false,
    }));
    frontLayers.splice(3, 0, { id: 'thin', material: 'Ta2O5', thickness: 2, locked: false });
    frontLayers.splice(7, 0, { id: 'pair', material: 'SiO2', thickness: 30, locked: false });
    return frontLayers;
}
// `start` refined with the window's method and step budget through the API.
const refineAsWindow = async start => (await quietly(() => api.refine(start, { method: DEFAULT_REFINE_METHOD, maxIter: FACTORY.reoptIters }))).design;
// `design` cleaned by the window with Re-optimize on, at its factory settings
// on this thread, and through the API: cleaned, given an MNT row at the
// window's minimum thickness, and refined as the window refines.
async function bothWays(design) {
    const resolveMat = designMaterialLookup(design);
    const preview = computeCleanupPreview(design, { dMin: FACTORY.dMin, mergeAdjacent: FACTORY.mergeAdjacent, side: FACTORY.side });
    const dc = { appliedMsg: () => '', mfRefineMsg: () => '' };
    const windowRun = await quietly(() => applyCleanup(preview, design, dc, { ...FACTORY, inWorker: false }, resolveMat));
    const cleaned = api.cleanDesign(design);
    const bounded = api.setMerit(cleaned.design, [...cleaned.design.meritOperands, { type: 'MNT', target: FACTORY.dMin }]);
    return { preview, cleaned, refined: await refineAsWindow(bounded), windowed: windowRun.nextDesign };
}
const thicknesses = d => d.frontLayers.map(l => l.thickness);
const rav = (lambdaStart, lambdaEnd, target) => makeOperand({ type: 'RAV', lambdaStart, lambdaEnd, aoi: 0, pol: 'avg', target, weight: 1 });
// What is wrong with `refined`, clean then MNT then refine, against the
// window's Re-optimize `windowed` of the same design cleaned to `cleaned`.
const recipeWrong = ({ cleaned, refined, windowed }) => [
    [!isDeepStrictEqual(thicknesses(refined), thicknesses(cleaned.design)), 'the refinement did not move the layers'],
    [isDeepStrictEqual(thicknesses(refined), thicknesses(windowed)), `${thicknesses(refined).join()} / ${thicknesses(windowed).join()}`],
].filter(([held]) => !held).map(([, what]) => what).join('; ');
const RECIPE = `clean, an MNT row at ${FACTORY.dMin}, then refine with ${DEFAULT_REFINE_METHOD} and maxIter ${FACTORY.reoptIters}, ends on the thicknesses of the window's Re-optimize`;
{
    // A quarter-wave mirror at 550 nm scored on its stop band, whose layers
    // the refinement keeps far above the window's minimum.
    const design = { ...api.newDesign({ name: 'Mirror to clean' }), frontLayers: toClean([57, 94]), meritOperands: [rav(520, 580, 1)] };
    const both = await bothWays(design);
    const { preview, cleaned, refined } = both;
    ok('the cleanup took out a layer and merged one, as the window\'s preview does', cleaned.removed === 1 && cleaned.merged === 1
        && isDeepStrictEqual(cleaned.design, preview.design), JSON.stringify([cleaned.removed, cleaned.merged]));
    ok('on a mirror whose layers stay thick', Math.min(...thicknesses(refined)) > FACTORY.dMin, `${Math.min(...thicknesses(refined))}`);
    const wrong = recipeWrong(both);
    ok(`there, ${RECIPE}`, !wrong, wrong);
}
{
    // An antireflection coating off any optimum, whose refinement drives
    // layers thin: the window's pass holds them at its minimum thickness and
    // refine at 1 nm, unless an MNT row holds them. Its band is wide enough
    // that the grid the design's fringes set has fewer points than the
    // default one, so the grid the window's pass samples on shows.
    const design = { ...api.newDesign({ name: 'AR to clean' }), frontLayers: toClean([25, 40, 110, 20]), meritOperands: [rav(400, 700, 0)] };
    const both = await bothWays(design);
    const unbounded = await refineAsWindow(both.cleaned.design);
    const [windowFloor, unboundedFloor] = [both.windowed, unbounded].map(d => Math.min(...thicknesses(d)));
    ok('where the refinement drives a layer thin, the window stops it at its minimum thickness and refine with no MNT row at 1 nm',
        windowFloor === FACTORY.dMin && unboundedFloor >= 1 && unboundedFloor < FACTORY.dMin, `${windowFloor} / ${unboundedFloor}`);
    const wrong = recipeWrong(both);
    ok(`there, ${RECIPE}`, !wrong, wrong);
}
{
    // A narrowband filter scored by a TGT row over its pass band, a feature
    // narrower than the row's grid, with a 2 nm layer outside it to take out.
    const fp = api.stackFromFormula(api.newDesign({ name: 'Narrowband to clean' }), { formula: '(HL)^7 HH (LH)^7' });
    const tgt = makeOperand({ type: 'TGT', lambdaStart: 500, lambdaEnd: 600, aoi: 0, pol: 'avg', target: 0, weight: 1 });
    const design = { ...fp, frontLayers: [{ id: 'thin', material: 'Ta2O5', thickness: 2, locked: false }, ...fp.frontLayers], meritOperands: [tgt] };
    const both = await bothWays(design);
    // The grid merit samples the row on, and the one a run samples it on.
    const { cleaned } = both;
    const [shown] = withDesignSampleCounts(cleaned.design.meritOperands, cleaned.design, designMaterialLookup(cleaned.design));
    const [run] = await quietly(() => densifyForRun(cleaned.design.meritOperands, cleaned.design));
    ok('on a narrowband filter scored by a TGT row, a run samples the row more densely than merit does', run.rampPoints > shown.rampPoints,
        `${run.rampPoints} / ${shown.rampPoints}`);
    const wrong = recipeWrong(both);
    ok(`there, ${RECIPE}`, !wrong, wrong);
}

// ── 6. The example runs ────────────────────────────────────────────────────
{
    const AsyncFunction = (async () => {}).constructor;
    const [call] = apiCalls(path.join(ROOT, 'src', 'api')).filter(c => c.name === 'cleanDesign');
    const printed = [];
    const failed = await new AsyncFunction('tf', 'console', call.example)(api, { log: (...args) => printed.push(args.join(' ')) }).then(() => null, err => err.message);
    ok('the example of cleanDesign runs and prints what it found', !!call?.example && failed === null && printed.length === 3, failed ?? printed.join(' | '));
}

// ── 7. The docs give the window's settings ─────────────────────────────────
{
    const [call] = apiCalls(path.join(ROOT, 'src', 'api')).filter(c => c.name === 'cleanDesign');
    const js = jsObjects(path.join(ROOT, 'src', 'api', 'objects')).Design.members.clean;
    const py = pyObjects(path.join(ROOT, 'python', 'tfstudio')).classes.Design.members.clean;
    const defaultOf = (params, name) => params.find(p => p.name === name)?.value;
    const dMin = String(FACTORY.dMin);
    ok('cleanDesign and design.clean give the window\'s minimum thickness as their default', defaultOf(call.params, 'options.minThickness') === dMin
        && defaultOf(js.doc.params, 'options.minThickness') === dMin && defaultOf(py.doc.args, 'min_thickness') === dMin && py.params.includes(`min_thickness=${dMin}`),
        `${defaultOf(call.params, 'options.minThickness')} ${defaultOf(js.doc.params, 'options.minThickness')} ${defaultOf(py.doc.args, 'min_thickness')} ${py.params}`);
    const [method, steps] = [DEFAULT_REFINE_METHOD, FACTORY.reoptIters];
    const said = [
        [call.lead, [`method \`'${method}'\` and \`maxIter: ${steps}\``]],
        [js.doc.lead, [`design.merit.add('MNT', { target: ${dMin} })`, `design.refine({ method: '${method}', maxIter: ${steps} })`]],
        [py.doc.lead, [`design.merit.add("MNT", target=${dMin})`, `design.refine(method="${method}", max_iter=${steps})`]],
    ];
    ok('and the MNT row at it and the window\'s method and step budget for Re-optimize', said.every(([lead, texts]) => texts.every(text => lead.join(' ').includes(text))),
        said.map(([lead]) => lead[1]).join(' | '));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
