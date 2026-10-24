/**
 * The headless API's design edits (src/api/designEdits.js) on designs made by
 * hand, against other parts of the app, and through the JS objects;
 * api_design_edits.mjs checks them against the Design Editor's dialogs and
 * buttons.
 *
 *   1. scaleThicknesses: each unlocked thickness times the factor, a locked
 *      one kept, a symmetric back the mirror, the back of a back_only design
 *      by default.
 *   2. designDifferences: each setting, a layer added and one gone, a lock,
 *      numbers from the substrate on both sides, settings left out read as
 *      the Design Editor reads them.
 *   3. Cross-checks: the TT sum designFacts gives scales by the factor; in
 *      'qwot' mode each rounded layer's QWOT, as the Design Editor shows it,
 *      is a whole number of increments; a perturbed layer moves by no more
 *      than the percent, and the differences list exactly the layers perturb
 *      moved, by their move; flipping twice gives the design back.
 *   4. Each name and value they cannot use is refused with the code and
 *      fields an object layer words it from.
 *   5. The JS objects' methods change the design as the plain calls do.
 *
 * Run: node tests/api_design_edits_checks.mjs
 */
import { isDeepStrictEqual } from 'node:util';

const api = await import('../src/api/index.js');
const objects = await import('../src/api/objects/index.js');
const { mirrorLayers } = await import('../src/utils/physics/optimizer.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const thrown = fn => { try { fn(); return null; } catch (err) { return err; } };
const all = conditions => conditions.every(Boolean);

await api.init();
const layer = (id, material, thickness, locked = false) => ({ id, material, thickness, locked });

// ── 1. scaleThicknesses ─────────────────────────────────────────────────────
{
    const design = { ...api.newDesign({ name: 'Scale' }), frontLayers: [layer('a', 'TiO2', 50), layer('b', 'SiO2', 80, true), layer('c', 'TiO2', 33.3)] };
    const scaled = api.scaleThicknesses(design, { factor: 1.1 });
    ok('scaleThicknesses multiplies each unlocked thickness by the factor and keeps a locked one, leaving the design given as it was',
        all([isDeepStrictEqual(scaled.frontLayers.map(l => l.thickness), [50 * 1.1, 80, 33.3 * 1.1]), design.frontLayers[0].thickness === 50]));
    const symmetric = api.scaleThicknesses({ ...design, surfaceMode: 'symmetric', backLayers: mirrorLayers(design.frontLayers) }, { factor: 0.5 });
    ok('and on a symmetric design makes the back the mirror of the new front', isDeepStrictEqual(symmetric.backLayers, mirrorLayers(symmetric.frontLayers)));
    const backOnly = { ...api.newDesign({ name: 'Back', surfaceMode: 'back_only' }), backLayers: [layer('x', 'MgF2', 100)] };
    ok('and scales the back of a back_only design by default', api.scaleThicknesses(backOnly, { factor: 2 }).backLayers[0].thickness === 200);
}

// ── 2. designDifferences ───────────────────────────────────────────────────
{
    const a = { ...api.newDesign({ name: 'A', surfaceMode: 'both_independent' }), frontLayers: [layer('o', 'SiO2', 90), layer('i', 'TiO2', 60)], backLayers: [layer('s', 'MgF2', 100)] };
    ok('a design differs from itself in nothing, and the name is not compared', all([isDeepStrictEqual(api.designDifferences(a, a), { same: true, setup: [], layers: [] }),
        api.designDifferences(a, { ...a, name: 'Renamed' }).same]));
    const b = {
        ...a, incidentMedium: 'BK7', exitMedium: 'SiO2', substrate: { ...a.substrate, material: 'SiO2', thickness: 3 }, referenceWavelength: 600, mfEvalMode: 'total',
        frontLayers: [layer('n', 'Al2O3', 20), layer('o', 'SiO2', 91), layer('i', 'TiO2', 60, true)], backLayers: [],
    };
    const d = api.designDifferences(a, b);
    ok('each setting that differs is listed by setDesignSetup\'s name, with its value in each', isDeepStrictEqual(d.setup, [
        { setting: 'incidentMedium', before: a.incidentMedium, after: 'BK7' }, { setting: 'exitMedium', before: a.exitMedium, after: 'SiO2' },
        { setting: 'substrate', before: a.substrate.material, after: 'SiO2' }, { setting: 'substrateThicknessMm', before: a.substrate.thickness, after: 3 },
        { setting: 'referenceWavelength', before: a.referenceWavelength, after: 600 }, { setting: 'mfEvalMode', before: 'side', after: 'total' },
    ]), JSON.stringify(d.setup));
    const state = (material, thickness, locked = false) => ({ material, thickness, locked });
    ok('and each layer by its number from the substrate: a lock, a thickness, a layer added outermost on the front and one gone from the back', all([!d.same, isDeepStrictEqual(d.layers, [
        { side: 'front', number: 1, before: state('TiO2', 60), after: state('TiO2', 60, true), change: 0 },
        { side: 'front', number: 2, before: state('SiO2', 90), after: state('SiO2', 91), change: 1 },
        { side: 'front', number: 3, before: null, after: state('Al2O3', 20), change: null },
        { side: 'back', number: 1, before: state('MgF2', 100), after: null, change: null },
    ])]), JSON.stringify(d.layers));
    ok('a surface mode and a reference left out read as the Design Editor reads them', api.designDifferences({ ...a, surfaceMode: undefined, referenceWavelength: undefined },
        { ...a, surfaceMode: 'front_only', referenceWavelength: 550 }).setup.length === 0);
    const refusedWith = (args, option, value) => {
        const err = thrown(() => api.designDifferences(...args)) ?? {};
        return all([err.code === 'badValue', isDeepStrictEqual(err.fields, { call: 'designDifferences', option, takes: 'a design', value }),
            err.message === `designDifferences: ${option} is a design, as openDesign or newDesign give one`]);
    };
    ok('a design or an other that is not a design is refused with its code and fields', all([refusedWith([a, null], 'other', 'null'),
        refusedWith([undefined, a], 'design', 'undefined'), refusedWith([a, { name: 'x' }], 'other', 'object')]));
}

// ── 3. Cross-checks ────────────────────────────────────────────────────────
{
    const mirror = api.stackFromFormula(api.newDesign({ name: 'Mirror' }), { formula: '(HL)^4 H' });
    const factor = 1.037;
    const tt = api.designFacts(mirror).thickness;
    ok('the TT sum designFacts gives scales by the factor', Math.abs(api.designFacts(api.scaleThicknesses(mirror, { factor })).thickness / tt - factor) < 1e-12);
    const kicked = api.perturb(mirror, { percent: 5, seed: 4 }).design;
    const qw = api.quantize(kicked, { mode: 'qwot', value: 0.25 });
    const counts = api.designFacts(qw).qwot.front.map(q => q / 0.25);
    ok('in qwot mode each rounded layer\'s QWOT, as the Design Editor shows it, is a whole number of increments',
        all([counts.every(n => Math.abs(n - Math.round(n)) < 1e-9), !isDeepStrictEqual(qw.frontLayers, kicked.frontLayers)]), counts.join());
    const locked = { ...mirror, frontLayers: mirror.frontLayers.map((l, i) => (i === 3 ? { ...l, locked: true } : l)) };
    const moved = api.perturb(locked, { percent: 4, seed: 21 }).design;
    const ratios = moved.frontLayers.map((l, i) => l.thickness / locked.frontLayers[i].thickness - 1);
    const diff = api.designDifferences(locked, moved);
    const count = locked.frontLayers.length;
    const numbers = locked.frontLayers.map((l, i) => count - i).filter((_, i) => i !== 3).sort((x, y) => x - y);
    ok('a perturbed layer moves by no more than the percent, and the differences list exactly the layers perturb moved, by their move', all([
        ratios.every(r => Math.abs(r) <= 0.04 + 1e-15), ratios[3] === 0, isDeepStrictEqual(diff.layers.map(l => l.number), numbers),
        diff.layers.every(l => l.change === l.after.thickness - l.before.thickness), diff.layers.every(l => l.change !== 0),
    ]), JSON.stringify(ratios));
    ok('flipping twice gives the design back', isDeepStrictEqual(api.flipLayers(api.flipLayers(locked)), locked));
}

// ── 4. Refusals ────────────────────────────────────────────────────────────
{
    const design = api.stackFromFormula(api.newDesign({ name: 'Refused' }), { formula: 'HL' });
    const cases = [
        ['scaleThicknesses', { factor: 2, by: 1 }, 'unknownOption', { option: 'by' }, /scaleThicknesses: unknown option 'by'; the options are factor, side/],
        ['scaleThicknesses', {}, 'badValue', { option: 'factor' }, /scaleThicknesses: factor is a number above 0, not undefined/],
        ['scaleThicknesses', { factor: -1 }, 'badValue', { option: 'factor', value: -1 }, /factor is a number above 0, not -1/],
        ['quantize', { mode: 'round' }, 'badValue', { option: 'mode', value: 'round' }, /quantize: mode is 'decimals', 'step' or 'qwot', not "round"/],
        ['quantize', { mode: 'decimals', value: 9 }, 'badValue', { option: 'value', value: 9 }, /value is a whole number of decimal places from 0 to 8, not 9/],
        ['quantize', { mode: 'decimals', value: 1.5 }, 'badValue', { option: 'value', value: 1.5 }, /from 0 to 8, not 1.5/],
        ['quantize', { value: 0 }, 'badValue', { option: 'value', value: 0 }, /value is a step in nm above 0, not 0/],
        ['quantize', { mode: 'qwot', value: -1 }, 'badValue', { option: 'value', value: -1 }, /value is a number of quarter waves above 0, not -1/],
        ['quantize', { side: 'total' }, 'badValue', { option: 'side', value: 'total' }, /quantize: side is 'front' or 'back', not "total"/],
        ['perturb', { percent: 0 }, 'badValue', { option: 'percent', value: 0 }, /perturb: percent is a percentage above 0 and up to 100, not 0/],
        ['perturb', { percent: 101 }, 'badValue', { option: 'percent', value: 101 }, /not 101/],
        ['perturb', { seed: 0 }, 'badValue', { option: 'seed', value: 0 }, /perturb: seed is a whole number from 1 to 2\^32 - 1, or null for a fresh one, not 0/],
        ['perturb', { seed: 1.5 }, 'badValue', { option: 'seed', value: 1.5 }, /not 1.5/],
        ['flipLayers', { side: 'up' }, 'badValue', { option: 'side', value: 'up' }, /flipLayers: side is 'front' or 'back', not "up"/],
        ['copySide', {}, 'badValue', { option: 'from' }, /copySide: from is 'front' or 'back', not undefined/],
        ['copySide', { to: 'back' }, 'unknownOption', { option: 'to' }, /copySide: unknown option 'to'; the options are from/],
        ['flipLayers', { side: 'back' }, 'closedSide', { side: 'back', surfaceMode: 'front_only' }, /flipLayers: a front_only design scored on its side alone does not evaluate the back/],
    ];
    for (const [call, options, code, fields, pattern] of cases) {
        const err = thrown(() => api[call](design, options)) ?? {};
        const fieldsMatch = Object.entries({ call, ...fields }).every(([key, value]) => isDeepStrictEqual(err.fields?.[key], value));
        ok(`${call} refuses ${JSON.stringify(options)}`, all([err.code === code, fieldsMatch, pattern.test(err.message)]), `${err.code} ${JSON.stringify(err.fields)} ${err.message}`);
    }
}

// ── 5. The JS objects ──────────────────────────────────────────────────────
{
    const design = new objects.Design(api.stackFromFormula(api.newDesign({ name: 'Objects' }), { formula: '(HL)^2 H' }));
    const plain = design._data;
    design.scaleThicknesses(1.2);
    const scaled = design._data;
    design.quantize({ mode: 'step', value: 0.5 });
    const rounded = design._data;
    const seed = design.perturb(3, { seed: 5 });
    const kicked = design._data;
    const defaultSeed = design.copy().perturb({ seed: 6 });
    design.layers.flip();
    const flipped = design._data;
    ok('scaleThicknesses, quantize, perturb and layers.flip change the design as the plain calls do, perturb giving its seed', all([
        isDeepStrictEqual(scaled, api.scaleThicknesses(plain, { factor: 1.2 })), isDeepStrictEqual(rounded, api.quantize(scaled, { mode: 'step', value: 0.5 })),
        seed === 5, defaultSeed === 6, isDeepStrictEqual(kicked, api.perturb(rounded, { percent: 3, seed: 5 }).design), isDeepStrictEqual(flipped, api.flipLayers(kicked)),
    ]));
    design.sides = 'both';
    design.copyFrontToBack();
    const [mine, theirs] = [design._data.backLayers, api.copySide(flipped, { from: 'front' }).backLayers].map(ls => ls.map(({ id, ...l }) => l));
    ok('copyFrontToBack copies as copySide does', isDeepStrictEqual(mine, theirs));
    const other = design.copy();
    other.sides = 'symmetric';
    other.reference = 600;
    const found = design.differences(other);
    ok('differences() names the settings by the objects\' names and words sides as they do', all([found.layers.length > 0,
        isDeepStrictEqual(found.setup.map(s => [s.setting, s.before, s.after]), [['reference', 550, 600], ['sides', 'both', 'symmetric']])]), JSON.stringify(found.setup));
    ok('and refuses an other that is not a Design', /differences: other is a Design/.test(thrown(() => design.differences(plain))?.message));
    ok('perturb refuses in its own words', thrown(() => design.perturb(0))?.message === 'perturb: percent is a percentage above 0 and up to 100, not 0');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
