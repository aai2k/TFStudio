/**
 * The specification calls of the headless API: setSpecification and
 * checkSpecification (src/api/specification.js) and estimateYield
 * (src/api/tolerance.js), against the Specification window's own code.
 *
 *   1. checkSpecification gives the analysis worker's 'specification' pass
 *      row by row, for every kind of check and every comparison, with a Step
 *      on some, on corpus designs coated on the front, on the back and on
 *      both, scored on one side and on the whole part, under a cone of
 *      incidence and with a measured curve, and on a Fabry-Perot filter and a
 *      symmetric stack: each value, unit, verdict, threshold and reason, with
 *      the totals and the side the design is scored on. It has a disabled
 *      check, an integral preset, and thickness budgets and layer counts on
 *      each side. A check at one wavelength reads the spectrum's value there,
 *      a thickness budget the stack's thicknesses. A design with no
 *      specification, or a material that resolves to nothing, is refused.
 *   2. The margin is 0 or more exactly when the check passes, for each
 *      comparison, over a spread of values and on every bound, eq with a
 *      tolerance and without one; it is the distance to the nearest bound.
 *   3. estimateYield gives monteCarlo's spec with the same seed and errors on
 *      two grids, on a design scored on its side, one scored on the whole
 *      part, one under a cone and one coated on the back; it reports each
 *      trial, stops on a signal with the trials it ran, computes no spread, so
 *      it takes a fraction of the time a curve on a fine grid takes, and is
 *      refused without an enabled check.
 *   4. setSpecification completes each new check as the window adds one and
 *      edits its fields (useSpecificationState.js), stamps an integral preset
 *      as picking it does, starts a thickness budget or layer count on the
 *      side the design coats, keeps a field the kind does not read when it
 *      holds a value that field takes, gives the checks it returns, and those
 *      a saved design holds, back unchanged, and refuses each name and value
 *      it cannot use, with the code and fields an object layer words it from.
 *      A check given with an id goes back as it is given: a thickness budget
 *      and layer count saved without a side, on a symmetric design and on one
 *      scored on the whole part, and checks the window makes that a new check
 *      is refused, read the same before and after.
 *   5. The doc examples of the three calls run, with the plain API as tf.
 *
 * Run: node tests/api_specification.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { fixtureFile } from './_apiCorpus.mjs';
import { fabryPerot } from './_peakDesigns.mjs';

const require = createRequire(import.meta.url);
globalThis.React = require('react');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = await import('../src/api/index.js');
const { dispatchAnalysisEvaluation } = await import('../src/utils/workers/analysisEvaluationWorker.js');
const { embedDesignMaterials, withHerpinRecords } = await import('../src/utils/materials/designMaterials.js');
const { QUALIFIER_KINDS, QUALIFIER_CMPS, SIDE_KINDS, makeQualifier, aggregateVerdict, thresholdMargin, stepFlags, coatedSide, defaultTolForKind } =
    await import('../src/utils/synthesis/qualifiers.js');
const { finishCompare } = await import('../src/utils/synthesis/qualifiers/format.js');
const { buildMfePresetList } = await import('../src/utils/physics/integralValues.js');
const { resolveEvalMode } = await import('../src/utils/physics/optimizer.js');
const { addQualifierTo, updateQualifierIn, insertQualifierInto } = await import('../src/components/windows/design/specification/useSpecificationState.js');
const { apiCalls } = await import('../tools/api-reference/docComments.mjs');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
// What `fn` throws, or null.
const thrown = fn => { try { fn(); return null; } catch (err) { return err; } };
// `object` without its field `key`.
const without = (object, key) => Object.fromEntries(Object.entries(object).filter(([name]) => name !== key));
const withoutId = check => without(check, 'id');

await api.init();

// ── Designs ────────────────────────────────────────────────────────────────
const open = name => api.openDesign(fixtureFile(name));
const ppef = open('measured-curve-ppef');
const curveId = ppef.measuredCurves[0].id;
const qwStack = api.stackFromFormula(api.newDesign({ name: 'QW' }), { formula: '(HL)^3 H' });
// Each design with the band its checks read, nm.
const DESIGNS = {
    'front, with a measured curve': { design: ppef, band: [1500, 1600] },
    'under a cone': { design: open('cone-user-distribution'), band: [400, 800] },
    'back only': { design: open('back-only-side'), band: [400, 800] },
    'both sides': { design: open('absorbing-substrate-both-sides-total'), band: [900, 1100] },
    'front, scored on the whole part': { design: open('front-only-total-mode'), band: [400, 800] },
    'Fabry-Perot': { design: fabryPerot, band: [550, 565] },
    'symmetric': { design: api.setDesignSetup(qwStack, { surfaceMode: 'symmetric' }), band: [400, 800] },
};

// ── 1. checkSpecification is the worker's pass ─────────────────────────────
const CHANNELS = ['T', 'R', 'A'];
const POLS = ['avg', 's', 'p'];

// A threshold in each check's unit, { target, tol, lo, hi }, on the band [a, b]:
// a fraction of 1 for the kinds this does not list.
const atCentre = ([a, b]) => ({ target: (a + b) / 2, tol: 5, lo: a, hi: b });
const THRESHOLDS = {
    CENTRAL_LAMBDA: atCentre, EDGE_LAMBDA: atCentre,
    FWHM: () => ({ target: 20, tol: 5, lo: 1, hi: 100 }),
    THICKNESS_BUDGET: () => ({ target: 500, tol: 50, lo: 100, hi: 5000 }),
    LAYER_COUNT: () => ({ target: 6, tol: 2, lo: 1, hi: 20 }),
    PPEF: () => ({ target: 0.5, tol: 0.1, lo: 0.1, hi: 2 }),
};
const thresholdOf = (kind, band) => (THRESHOLDS[kind] ?? (() => ({ target: 0.5, tol: 0.1, lo: 0.2, hi: 0.8 })))(band);

// Where a check of each kind reads on the band [a, b]: the band itself for
// the kinds this does not list.
const atPoint = ([a, b]) => ({ lambda: (a + b) / 2 });
const PLACES = {
    T_AT: atPoint, R_AT: atPoint, A_AT: atPoint, THICKNESS_BUDGET: () => ({}), LAYER_COUNT: () => ({}), PPEF: () => ({ curveId }),
    INTEGRAL: ([a, b]) => ({ lambdaStart: a, lambdaEnd: b, source: { id: 'E' }, detector: { id: 'flat' } }),
};
const placeOf = (kind, band) => (PLACES[kind] ?? (([a, b]) => ({ lambdaStart: a, lambdaEnd: b })))(band);

// A check of every kind with every comparison on the band, its channel,
// direction, polarization and angle varied, and an eq check at its finest
// offered Step but one; then the side kinds on each side, a disabled check
// and, on a visible band, an integral preset.
function checksFor(design, band) {
    const kinds = QUALIFIER_KINDS.filter(kind => kind !== 'PPEF' || design === ppef);
    const checks = kinds.flatMap(kind => QUALIFIER_CMPS.map((cmp, i) => {
        const check = {
            kind, cmp, label: `${kind} ${cmp}`, ...thresholdOf(kind, band), ...placeOf(kind, band),
            channel: CHANNELS[i % 3], direction: i % 2 ? 'min' : 'max', pol: POLS[i % 3], aoi: i === 1 ? 30 : 0,
        };
        const flags = stepFlags(makeQualifier(check));
        return cmp === 'eq' && flags.length ? { ...check, flag: flags[0] } : check;
    }));
    const sides = SIDE_KINDS.flatMap(kind => ['front', 'back', 'both'].map(side => ({ kind, side, cmp: 'ge', ...thresholdOf(kind, band) })));
    const visible = band[0] >= 380 && band[1] <= 780 ? [{ kind: 'INTEGRAL', presetKey: 'Tvis', cmp: 'ge', target: 0.5 }] : [];
    return [...checks, ...sides, { kind: 'T_AVG', lambdaStart: band[0], lambdaEnd: band[1], enabled: false }, ...visible];
}

// A result's unit by the API's name for it.
const UNIT_NAMES = { '%': 'fraction', nm: 'nm', dB: 'dB', '': '' };

// A check's row as the worker's result for it says it should read, the margin aside.
function expectedRow(check, result, index) {
    return {
        index, label: check.label, kind: check.kind, enabled: check.enabled,
        value: Number.isFinite(result.value) ? result.value : null, unit: UNIT_NAMES[result.unit], passed: result.pass,
        threshold: { cmp: check.cmp, target: check.target, tol: check.tol, lo: check.lo, hi: check.hi },
        reason: result.summaryKey ?? null,
    };
}

// The distance from `value` to the nearest bound of `check`, positive inside,
// by its comparison; eq holds a value to its target alone when tol is 0 or less.
// Each bound lies `s` past the stated one: half the last digit the window
// shows a value in the row's unit to.
const MARGINS = {
    ge: (check, value, s) => value - (check.target - s),
    le: (check, value, s) => (check.target + s) - value,
    eq: (check, value, s, tol = Math.max(0, check.tol) + s) => Math.min(value - (check.target - tol), (check.target + tol) - value),
    between: (check, value, s) => Math.min(value - (check.lo - s), (check.hi + s) - value),
};
const HALF_SHOWN_DIGIT = { fraction: 0.000005, nm: 0.005, dB: 0.0005, '': 0 };
const expectedMargin = (check, value, unit = '') => MARGINS[check.cmp](check, value, HALF_SHOWN_DIGIT[unit]);

const seen = { valued: new Set(), passing: new Set(), failing: new Set() };
for (const [name, { design: bare, band }] of Object.entries(DESIGNS)) {
    const design = api.setSpecification(bare, checksFor(bare, band));
    const verdict = api.checkSpecification(design);
    const results = dispatchAnalysisEvaluation('specification', { designs: [embedDesignMaterials(withHerpinRecords(design))] })[0];
    const rows = verdict.rows.map(row => without(row, 'margin'));
    const expected = design.qualifiers.map((check, i) => expectedRow(check, results[i], i));
    const differ = rows.map((row, i) => (isDeepStrictEqual(row, expected[i]) ? null : `${i} ${JSON.stringify(row)} / ${JSON.stringify(expected[i])}`)).filter(Boolean);
    ok(`${name}: each row is the worker's`, rows.length === design.qualifiers.length && differ.length === 0, differ.slice(0, 3).join('\n'));
    const margins = verdict.rows.filter(row => (row.value === null ? row.margin !== null
        : row.margin !== expectedMargin(design.qualifiers[row.index], row.value, row.unit) || (row.margin >= 0) !== row.passed));
    ok(`${name}: each margin is the distance to the nearest bound, 0 or more exactly when the check passes`, margins.length === 0, JSON.stringify(margins[0]));
    const { passing, total, allPass } = aggregateVerdict(results);
    ok(`${name}: the verdict counts the enabled checks as the window does`, verdict.passed === allPass && verdict.passing === passing && verdict.total === total
        && total === design.qualifiers.filter(q => q.enabled).length, JSON.stringify([verdict.passed, verdict.passing, verdict.total]));
    ok(`${name}: it is scored as its spectrum is`, verdict.mode === api.spectrum(design, { from: band[0], to: band[1] }).evalMode && verdict.mode === resolveEvalMode(design), verdict.mode);
    const { value, passed, margin, reason, unit } = verdict.rows.find(row => !row.enabled);
    ok(`${name}: a disabled check has no value, verdict or margin`, isDeepStrictEqual([value, passed, margin, reason, unit], [null, null, null, 'disabled', '']),
        JSON.stringify([value, passed, margin, reason, unit]));
    for (const row of verdict.rows.filter(r => r.value !== null)) {
        seen.valued.add(row.kind);
        (row.passed ? seen.passing : seen.failing).add(row.threshold.cmp);
    }
}
ok('every kind gave a value on some design', QUALIFIER_KINDS.every(kind => seen.valued.has(kind)), QUALIFIER_KINDS.filter(kind => !seen.valued.has(kind)).join());
ok('every comparison both passed and failed', QUALIFIER_CMPS.every(cmp => seen.passing.has(cmp) && seen.failing.has(cmp)));
{
    // Against other parts of the app: the spectrum at a point, and the stack.
    const { design: both } = DESIGNS['both sides'];
    const lambda = 1000;
    const checked = api.checkSpecification(api.setSpecification(both, [
        { kind: 'T_AT', lambda, aoi: 30, pol: 's' },
        { kind: 'THICKNESS_BUDGET', side: 'front' },
        { kind: 'LAYER_COUNT', side: 'both' },
    ]));
    const Ts = api.spectrum(both, { from: lambda, to: lambda + 1, angles: [30] }).angles[30].Ts[0];
    ok('a check at one wavelength reads the spectrum\'s value there', Math.abs(checked.rows[0].value - Ts) < 1e-12, `${checked.rows[0].value} / ${Ts}`);
    ok('a thickness budget adds up the stack', checked.rows[1].value === both.frontLayers.reduce((s, l) => s + l.thickness, 0)
        && checked.rows[2].value === both.frontLayers.length + both.backLayers.length);
    const preset = api.checkSpecification(api.setSpecification(DESIGNS['under a cone'].design, [{ kind: 'INTEGRAL', presetKey: 'Rvis' }])).rows[0];
    ok('an integral preset gives a value in its unit', preset.value > 0 && preset.value < 1 && preset.unit === 'fraction', JSON.stringify(preset));
}
{
    const none = thrown(() => api.checkSpecification(qwStack));
    ok('a design with no specification is refused, saying to set one', none?.code === 'noSpecification' && isDeepStrictEqual(none.fields, { call: 'checkSpecification' })
        && /setSpecification/.test(none.message), none?.message);
    const lost = { ...api.setSpecification(qwStack, [{ kind: 'T_AT' }]), frontLayers: [{ id: 'x', material: 'Unobtainium', thickness: 10 }] };
    ok('so is one whose material resolves to nothing', /resolve to nothing: Unobtainium/.test(thrown(() => api.checkSpecification(lost))?.message ?? ''));
}

// ── 2. The margin's sign is the verdict ────────────────────────────────────
{
    // The doubles either side of `x`.
    const adjacent = (x, up) => {
        if (x === 0) return up ? Number.MIN_VALUE : -Number.MIN_VALUE;
        const f = new Float64Array([x]);
        const bits = new BigInt64Array(f.buffer);
        bits[0] += (x > 0) === up ? 1n : -1n;
        return f[0];
    };
    const around = x => [adjacent(x, false), x, adjacent(x, true)];
    const spread = Array.from({ length: 41 }, (_, i) => -1 + i * 0.075);
    // Each threshold with its bounds, written as the check computes them.
    const CASES = [
        [{ cmp: 'ge', target: 0.3 }, [0.3]],
        [{ cmp: 'le', target: 0.3 }, [0.3]],
        [{ cmp: 'eq', target: 0.3, tol: 0.1 }, [0.3 - 0.1, 0.3 + 0.1]],
        [{ cmp: 'eq', target: 0.3, tol: 0 }, [0.3]],
        [{ cmp: 'eq', target: 0.3, tol: -0.05 }, [0.3]],
        [{ cmp: 'eq', target: 1550.1, tol: 0.3 }, [1550.1 - 0.3, 1550.1 + 0.3]],
        [{ cmp: 'between', lo: 0.2, hi: 0.7 }, [0.2, 0.7]],
        [{ cmp: 'between', lo: -0.1, hi: 0.1 }, [-0.1, 0.1]],
    ];
    for (const [check, bounds] of CASES) {
        const values = [...spread, ...bounds.flatMap(around), ...spread.map(v => v + (check.target ?? 0))];
        const wrong = values.filter(v => {
            const margin = thresholdMargin(check, v);
            return (margin >= 0) !== finishCompare(check, v, '').pass || margin !== expectedMargin(check, v);
        });
        ok(`${JSON.stringify(check)}: the margin is 0 or more exactly when it passes`, wrong.length === 0, wrong.slice(0, 3).join());
        ok(`${JSON.stringify(check)}: a value on a bound passes with no room left`,
            bounds.every(b => finishCompare(check, b, '').pass && thresholdMargin(check, b) === 0), bounds.map(b => thresholdMargin(check, b)).join());
    }
    ok('a comparison the check does not know has no margin', thresholdMargin({ cmp: 'gt', target: 0 }, 1) === null && finishCompare({ cmp: 'gt', target: 0 }, 1, '').pass === false);
}

// ── 3. estimateYield is monteCarlo's spec ──────────────────────────────────
const quietly = async run => {
    const { log, warn } = console;
    console.log = console.warn = () => {};
    try { return await run(); } finally { Object.assign(console, { log, warn }); }
};
// The spec fields of an estimateYield answer, in the order monteCarlo's spec holds them.
const specOf = ({ nTrials, evaluated, passCount, yield: share, yieldInterval, perQualifier }) => ({ nTrials, evaluated, passCount, yield: share, yieldInterval, perQualifier });
{
    const ar = api.insertLayer(api.insertLayer(api.newDesign({ name: 'AR' }), { material: 'TiO2', thickness: 30 }), { material: 'SiO2', thickness: 50 });
    const nominal = api.checkSpecification(api.setSpecification(ar, [{ kind: 'R_AVG', lambdaStart: 450, lambdaEnd: 650 }, { kind: 'R_AT', lambda: 550 }])).rows.map(r => r.value);
    const specified = api.setSpecification(ar, [
        { kind: 'R_AVG', lambdaStart: 450, lambdaEnd: 650, cmp: 'le', target: nominal[0] * 1.02, label: 'R avg' },
        { kind: 'R_AT', lambda: 550, cmp: 'le', target: nominal[1] * 1.1 },
        { kind: 'LAYER_COUNT', cmp: 'le', target: 2 },
        { kind: 'T_AT', lambda: 550, cmp: 'ge', target: 1, enabled: false },
    ]);
    const both = DESIGNS['both sides'].design;
    const bothNominal = api.checkSpecification(api.setSpecification(both, [{ kind: 'T_AVG', lambdaStart: 950, lambdaEnd: 1050 }])).rows[0].value;
    const wholePart = api.setSpecification(api.setDesignSetup(both, { mfEvalMode: 'total' }),
        [{ kind: 'T_AVG', lambdaStart: 950, lambdaEnd: 1050, cmp: 'ge', target: bothNominal * 0.995 }, { kind: 'THICKNESS_BUDGET', side: 'both', cmp: 'le', target: 930 }]);
    // A design under a cone and one coated on the back, each with a check its
    // trials pass and fail.
    const banded = (design, from, to) => {
        const nominalT = api.checkSpecification(api.setSpecification(design, [{ kind: 'T_AVG', lambdaStart: from, lambdaEnd: to }])).rows[0].value;
        return api.setSpecification(design, [{ kind: 'T_AVG', lambdaStart: from, lambdaEnd: to, cmp: 'ge', target: nominalT * 0.999 }]);
    };
    const ERRORS = { runs: 30, thicknessRelPct: 2, thicknessAbsNm: 0.5, indexRe: 0.01, indexIm: 0.001, distribution: 'uniform', seed: 11 };
    for (const [name, design] of [['scored on its side', specified], ['scored on the whole part', wholePart],
        ['under a cone', banded(DESIGNS['under a cone'].design, 500, 600)], ['coated on the back', banded(DESIGNS['back only'].design, 500, 600)]]) {
        const y = await quietly(() => api.estimateYield(design, ERRORS));
        const coarse = await quietly(() => api.monteCarlo(design, { ...ERRORS, from: 400, to: 700, step: 10 }));
        const fine = await quietly(() => api.monteCarlo(design, { ...ERRORS, quantity: 'T', from: 520, to: 560, step: 0.5, angle: 30, polarization: 's' }));
        ok(`${name}: the yield is monteCarlo's spec on either grid`, isDeepStrictEqual(specOf(y), coarse.spec) && isDeepStrictEqual(coarse.spec, fine.spec),
            `${JSON.stringify(specOf(y))} / ${JSON.stringify(coarse.spec)} / ${JSON.stringify(fine.spec)}`);
        ok(`${name}: some trials pass and some fail`, y.yield > 0 && y.yield < 1 && y.perQualifier.some(q => q.failRate > 0), JSON.stringify(y));
        const errors = Object.fromEntries(['rmsRelPct', 'rmsAbsNm', 'rmsReN', 'rmsImN', 'distribution'].map(key => [key, coarse.settings[key]]));
        ok(`${name}: with its seed, its error settings and the mode it was scored in`, y.seed === 11 && isDeepStrictEqual(y.settings, errors)
            && y.mode === resolveEvalMode(design) && y.nTrials === ERRORS.runs, JSON.stringify([y.seed, y.settings, y.mode]));
    }
    const disabledRow = (await quietly(() => api.estimateYield(specified, { runs: 5, seed: 2 }))).perQualifier[3];
    ok('a disabled check never fails, the share of all the trials run', disabledRow.failRate === 0 && disabledRow.label === 'T_AT', JSON.stringify(disabledRow));

    const reports = [];
    const reported = await quietly(() => api.estimateYield(specified, { runs: 7, seed: 3 }, { onProgress: p => reports.push(p) }));
    ok('it reports each trial', reported.nTrials === 7 && isDeepStrictEqual(reports, Array.from({ length: 7 }, (_, i) => ({ trial: i + 1, total: 7 }))), JSON.stringify(reports));
    const stop = new AbortController();
    const cut = await quietly(() => api.estimateYield(specified, { runs: 400, seed: 3 }, { signal: stop.signal, onProgress: ({ trial }) => { if (trial === 5) stop.abort(); } }));
    ok('it stops between trials, with the trials it ran', cut.nTrials >= 5 && cut.nTrials < 400 && cut.evaluated === cut.nTrials, JSON.stringify(specOf(cut)));

    // Nothing but the checks is computed: a run takes a fraction of what the
    // same trials take with a curve on a fine grid.
    const counted = api.setSpecification(ar, [{ kind: 'LAYER_COUNT', cmp: 'le', target: 2 }]);
    const timed = async run => { const t = process.hrtime.bigint(); await quietly(run); return Number(process.hrtime.bigint() - t) / 1e6; };
    const tYield = await timed(() => api.estimateYield(counted, { runs: 20, seed: 4 }));
    const tCurve = await timed(() => api.monteCarlo(counted, { runs: 20, seed: 4, from: 400, to: 700, step: 0.05 }));
    ok('it computes no spread: a fraction of the time a curve on a fine grid takes', tYield * 4 < tCurve, `${tYield.toFixed(1)} ms / ${tCurve.toFixed(1)} ms`);

    const REFUSED = [
        ['a design with no specification', () => api.estimateYield(ar), /no enabled specification check; set them with setSpecification/, 'noSpecification'],
        ['one whose checks are all disabled', () => api.estimateYield(api.setSpecification(ar, [{ kind: 'T_AT', enabled: false }])), /no enabled specification check/, 'noSpecification'],
        ['an option it does not take', () => api.estimateYield(counted, { from: 400 }), /unknown option 'from'; the options are runs, /, 'unknownOption'],
        ['a run of no trial', () => api.estimateYield(counted, { runs: 0 }), /runs is a whole number of 1 or more/, 'badValue'],
        ['a seed of 0', () => api.estimateYield(counted, { seed: 0 }), /seed is a whole number from 1/, 'badValue'],
        ['a bare substrate', () => api.estimateYield(api.setSpecification(api.newDesign(), [{ kind: 'T_AT' }])), /estimateYield: the design has no layers to perturb/, undefined],
        ['a hook it does not call', () => api.estimateYield(counted, {}, { onRow: () => {} }), /unknown option 'onRow'/, 'unknownOption'],
    ];
    for (const [what, fn, pattern, code] of REFUSED) {
        const err = thrown(fn);
        ok(`estimateYield refuses ${what}`, pattern.test(err?.message ?? '') && err.code === code, err?.message ?? 'not refused');
    }
}

// ── 4. setSpecification ────────────────────────────────────────────────────
const twoSided = DESIGNS['both sides'].design;
const set = checks => api.setSpecification(twoSided, checks).qualifiers;
// A check as the window makes it: a row of `kind` added, then `fields` typed in.
function windowCheck(design, kind, fields) {
    let qualifiers = [];
    const write = next => { qualifiers = next; };
    addQualifierTo(qualifiers, write, () => {}, kind, design);
    updateQualifierIn(qualifiers, write, qualifiers[0].id, fields, design);
    return qualifiers[0];
}
{
    const plain = QUALIFIER_KINDS.map(kind => [kind, kind === 'PPEF' ? { curveId } : {}]);
    const typed = [['T_AVG', { lambdaStart: 450, lambdaEnd: 650, cmp: 'eq', target: 0.9, tol: 0.02, pol: 's', flag: 2 }],
        ['FWHM', { channel: 'R', direction: 'min', level: 0.3, edgeSide: 'right', flag: 3 }], ['LAYER_COUNT', { side: 'both', cmp: 'between', lo: 3, hi: 9 }]];
    for (const design of [twoSided, ppef, DESIGNS['back only'].design, DESIGNS.symmetric.design]) {
        const differ = [...plain, ...typed].filter(([kind]) => kind !== 'PPEF' || design === ppef).filter(([kind, fields]) =>
            !isDeepStrictEqual(withoutId(api.setSpecification(design, [{ kind, ...fields }]).qualifiers[0]), withoutId(windowCheck(design, kind, fields))));
        ok(`on a ${design.surfaceMode} design each check is the window's, with makeQualifier's defaults`, differ.length === 0, differ.map(([kind]) => kind).join());
    }
    const sides = Object.values(DESIGNS).map(({ design }) => [design.surfaceMode, api.setSpecification(design, [{ kind: 'THICKNESS_BUDGET' }, { kind: 'LAYER_COUNT' }])
        .qualifiers.map(q => q.side).join(), coatedSide(design)]);
    ok('a thickness budget or layer count adds up the side the design coats', sides.every(([, got, coated]) => got === `${coated},${coated}`)
        && new Set(sides.map(([, , coated]) => coated)).size === 3, JSON.stringify(sides));
    ok('a side given is kept', set([{ kind: 'LAYER_COUNT', side: 'back' }])[0].side === 'back');
    const presets = buildMfePresetList([]).filter(p => {
        const stamped = withoutId(set([{ kind: 'INTEGRAL', presetKey: p.key }])[0]);
        const picked = withoutId(windowCheck(twoSided, 'INTEGRAL', {
            channel: p.char, presetKey: p.key, presetLabel: p.label, source: { ...p.sourceSpec }, detector: { ...p.detectorSpec }, lambdaStart: p.band[0], lambdaEnd: p.band[1],
        }));
        return !isDeepStrictEqual(stamped, picked);
    });
    ok('an integral preset sets the channel, band, source and detector as picking it in the window does', presets.length === 0, presets.map(p => p.key).join());
    ok('a field that agrees with its preset is taken', set([{ kind: 'INTEGRAL', presetKey: 'Tsol', channel: 'T', source: { id: 'AM1.5G' } }])[0].source.id === 'AM1.5G');

    const kept = set([{ kind: 'T_AT', lambdaStart: 600, side: 'back' }, { kind: 'LAYER_COUNT', aoi: 45, pol: 's' }, { kind: 'THICKNESS_BUDGET', cmp: 'between', target: 2, lambda: 900 }]);
    const asKept = [kept[0].lambdaStart, kept[0].side, kept[1].aoi, kept[1].pol, kept[2].target, kept[2].lambda];
    ok('a field the kind does not read is kept as given, when it holds a value the field takes', isDeepStrictEqual(asKept, [600, 'back', 45, 's', 2, 900]), JSON.stringify(asKept));
    ok('a band whose end is its start is taken, as setMerit takes one, and so is a between whose hi is its lo',
        set([{ kind: 'T_AVG', lambdaStart: 550, lambdaEnd: 550 }, { kind: 'LAYER_COUNT', cmp: 'between', lo: 7, hi: 7 }]).length === 2);
    const given = set([{ kind: 'T_AT', id: 'mine' }, { kind: 'R_AT' }]);
    ok('a check given with an id is kept as it is given, and one given none takes a fresh id', isDeepStrictEqual(given[0], { kind: 'T_AT', id: 'mine' })
        && typeof given[1].id === 'string' && given[1].id.length > 0, JSON.stringify(given[0]));

    const first = api.setSpecification(ppef, [...checksFor(ppef, [1500, 1600]), { kind: 'INTEGRAL', presetKey: 'TNIR' }]);
    const again = api.setSpecification(ppef, first.qualifiers);
    const throughJson = api.setSpecification(ppef, JSON.parse(JSON.stringify(first.qualifiers)));
    ok('the checks it gives go back through unchanged', isDeepStrictEqual(again.qualifiers, first.qualifiers)
        && isDeepStrictEqual(throughJson.qualifiers, JSON.parse(JSON.stringify(first.qualifiers))));
    const saved = open('operand-families');
    ok('so do those a saved design holds', saved.qualifiers.length === 2 && isDeepStrictEqual(api.setSpecification(saved, saved.qualifiers).qualifiers, saved.qualifiers));
    const before = JSON.stringify(first);
    ok('an empty list clears the specification, and the design given is left as it was', api.setSpecification(first, []).qualifiers.length === 0 && JSON.stringify(first) === before);
}
{
    // Checks a design holds that setSpecification would not make: a thickness
    // budget and layer count from a file saved before checks had a side, which
    // add up both sides, and checks the window makes and evaluates that a new
    // check is refused: a Step kept from the kind a row was switched from, an
    // integral preset its user saved, a level above 1, an angle below 0, a
    // band typed high to low, a PPEF check before its curve is picked, and a
    // row copied with Ins.
    const edited = (check, patch) => {
        let qualifiers = [check];
        updateQualifierIn(qualifiers, next => { qualifiers = next; }, check.id, patch);
        return qualifiers[0];
    };
    const heldBy = design => {
        const copied = [];
        const source = windowCheck(design, 'T_AVG', { lambdaStart: 450, lambdaEnd: 650 });
        insertQualifierInto({ qualifiers: [source], writeQualifiers: next => copied.push(...next), setSelectedId: () => {}, containerRef: { current: null } }, 1, source);
        return [
            makeQualifier({ kind: 'LAYER_COUNT', cmp: 'le', target: 10 }),
            makeQualifier({ kind: 'THICKNESS_BUDGET', cmp: 'le', target: 600 }),
            edited(windowCheck(design, 'T_AVG', { flag: 1 }), { kind: 'FWHM', tol: defaultTolForKind('FWHM') }),
            windowCheck(design, 'INTEGRAL', { presetKey: 'My lamp', presetLabel: 'My lamp', source: { id: 'A' }, detector: { id: 'flat' }, lambdaStart: 420, lambdaEnd: 680 }),
            windowCheck(design, 'FWHM', { level: 1.5 }),
            windowCheck(design, 'T_AT', { aoi: -10 }),
            windowCheck(design, 'EDGE_LAMBDA', { lambdaStart: 700, lambdaEnd: 400 }),
            windowCheck(design, 'PPEF', {}),
            copied[1],
        ];
    };
    for (const name of ['symmetric', 'front, scored on the whole part']) {
        const { design } = DESIGNS[name];
        const holding = { ...design, qualifiers: heldBy(design) };
        const back = thrown(() => api.setSpecification(holding, holding.qualifiers)) ?? api.setSpecification(holding, holding.qualifiers);
        ok(`${name}: the checks a design holds go back as they are`, isDeepStrictEqual(back.qualifiers, holding.qualifiers), back.message ?? JSON.stringify(back.qualifiers?.[0]));
        const rowsOf = d => api.checkSpecification(d).rows;
        ok(`${name}: and read as they did`, !back.message && isDeepStrictEqual(rowsOf(back), rowsOf(holding)));
        const [count, budget] = rowsOf(holding);
        const sided = rowsOf(api.setSpecification(design, [{ kind: 'LAYER_COUNT', side: 'both' }, { kind: 'LAYER_COUNT', side: coatedSide(design) }]));
        ok(`${name}: a layer count saved without a side adds up both sides, which here is not the side the design coats`,
            count.value === sided[0].value && count.value !== sided[1].value && budget.value > 0, JSON.stringify([count.value, sided.map(row => row.value)]));
        const appended = api.setSpecification(holding, [...holding.qualifiers, { kind: 'R_AVG' }]).qualifiers;
        ok(`${name}: a check added after them leaves them as they are`, isDeepStrictEqual(appended.slice(0, -1), holding.qualifiers) && appended.at(-1).kind === 'R_AVG');
    }
}
{
    // [what, checks, the refusal's code, its fields (row and option, or start and end), the message]
    const PRESETS = 'Tvis, Rvis, Avis, Tsol, Rsol, Asol, TUV, RUV, TNIR, RNIR';
    const REFUSED = [
        ['a kind it does not know', [{ kind: 'T_AVERAGE' }], 'badValue', { option: 'kind' }, /check 0: kind is one of T_AT, .*PPEF, not "T_AVERAGE"/],
        ['a check without a kind', [{ cmp: 'ge' }], 'badValue', { option: 'kind' }, /kind is one of/],
        ['a misspelt field', [{ kind: 'T_AVG' }, { kind: 'T_AVG', lamStart: 450 }], 'unknownOption', { row: 1, option: 'lamStart' }, /check 1: 'lamStart' is not a field of a check; a check takes id, enabled, kind/],
        ['a comparison it does not know', [{ kind: 'T_AVG', cmp: 'gt' }], 'badValue', { option: 'cmp' }, /cmp is 'ge', 'le', 'eq' or 'between', not "gt"/],
        ['between with lo above hi', [{ kind: 'T_AVG', cmp: 'between', lo: 0.9, hi: 0.5 }], 'badValue', { option: 'hi' }, /hi is a number in the check's unit no lower than lo, 0.9, not 0.5/],
        ['between with no lo', [{ kind: 'T_AVG', cmp: 'between', lo: null }], 'badValue', { option: 'lo' }, /lo is a number in the check's unit, not null/],
        ['a target that is not a number', [{ kind: 'R_AT', cmp: 'le', target: NaN }], 'badValue', { option: 'target' }, /target is a number in the check's unit, not NaN/],
        ['a tolerance that is not a number', [{ kind: 'R_AT', cmp: 'eq', tol: '1' }], 'badValue', { option: 'tol' }, /tol is a number/],
        ['a wavelength of 0', [{ kind: 'T_AT', lambda: 0 }], 'badValue', { option: 'lambda' }, /lambda is a wavelength in nm above 0, not 0/],
        ['a band that starts below 0', [{ kind: 'A_AVG', lambdaStart: -400 }], 'badValue', { option: 'lambdaStart' }, /lambdaStart is a wavelength in nm above 0/],
        ['a band that ends below 0', [{ kind: 'MIN_MAX', lambdaEnd: -5 }], 'badValue', { option: 'lambdaEnd' }, /lambdaEnd is a wavelength in nm above 0, not -5/],
        ['a band that runs backwards', [{ kind: 'T_AVG', lambdaStart: 700, lambdaEnd: 400 }], 'bandOrder', { start: 700, end: 400 }, /check 0: lambdaEnd 400 is below lambdaStart 700/],
        ['an angle of 90 degrees', [{ kind: 'R_AVG', aoi: 90 }], 'badValue', { option: 'aoi' }, /aoi is an angle of incidence in degrees, 0 <= aoi < 90, not 90/],
        ['a polarization it does not know', [{ kind: 'R_AT', pol: 'te' }], 'badValue', { option: 'pol' }, /pol is 'avg', 's' or 'p', not "te"/],
        ['a channel it does not know', [{ kind: 'MIN_MAX', channel: 'X' }], 'badValue', { option: 'channel' }, /channel is 'T', 'R' or 'A'/],
        ['a direction it does not know', [{ kind: 'CENTRAL_LAMBDA', direction: 'up' }], 'badValue', { option: 'direction' }, /direction is 'max' or 'min'/],
        ['a level above 1', [{ kind: 'FWHM', level: 1.5 }], 'badValue', { option: 'level' }, /level is a fraction, 0 to 1, not 1.5/],
        ['a level below 0', [{ kind: 'EDGE_LAMBDA', level: -0.1 }], 'badValue', { option: 'level' }, /level is a fraction/],
        ['an edge side it does not know', [{ kind: 'EDGE_LAMBDA', edgeSide: 'middle' }], 'badValue', { option: 'edgeSide' }, /edgeSide is 'left' or 'right'/],
        ['a Step the window does not offer on a width', [{ kind: 'FWHM', flag: 1 }], 'badValue', { option: 'flag' }, /flag is null for the default, or one of 2, 3, 4, not 1/],
        ['a Step the window does not offer on an average', [{ kind: 'T_AVG', flag: 5 }], 'badValue', { option: 'flag' }, /flag is null for the default, or one of 1, 2, 3, 4, not 5/],
        ['a Step that is not a whole number', [{ kind: 'MIN_MAX', flag: 2.5 }], 'badValue', { option: 'flag' }, /not 2.5/],
        ['a Step on the highest R, which has none', [{ kind: 'MIN_MAX', channel: 'R', direction: 'max', flag: 2 }], 'badValue', { option: 'flag' }, /flag is null, as MIN_MAX of the highest R has no Step, not 2/],
        ['a Step on the lowest T at its centre', [{ kind: 'CENTRAL_LAMBDA', direction: 'min', flag: 3 }], 'badValue', { option: 'flag' }, /flag is null, as CENTRAL_LAMBDA of the lowest T has no Step, not 3/],
        ['a Step on a thickness budget', [{ kind: 'THICKNESS_BUDGET', flag: 9 }], 'badValue', { option: 'flag' }, /flag is null, as THICKNESS_BUDGET has no Step, not 9/],
        ['a band start the kind does not read, below 0', [{ kind: 'T_AT', lambdaStart: -5 }], 'badValue', { option: 'lambdaStart' }, /lambdaStart is a wavelength in nm above 0, not -5/],
        ['a wavelength the kind does not read, of 0', [{ kind: 'THICKNESS_BUDGET', lambda: 0 }], 'badValue', { option: 'lambda' }, /lambda is a wavelength in nm above 0, not 0/],
        ['a side on a kind that adds up none', [{ kind: 'T_AT', side: 'top' }], 'badValue', { option: 'side' }, /side is 'front', 'back' or 'both', not "top"/],
        ['an angle on a layer count of 95 degrees', [{ kind: 'LAYER_COUNT', aoi: 95 }], 'badValue', { option: 'aoi' }, /aoi is an angle of incidence/],
        ['a polarization on a layer count it does not know', [{ kind: 'LAYER_COUNT', pol: 'x' }], 'badValue', { option: 'pol' }, /pol is 'avg', 's' or 'p', not "x"/],
        ['a target between does not read, as text', [{ kind: 'THICKNESS_BUDGET', cmp: 'between', target: 'abc' }], 'badValue', { option: 'target' }, /target is a number in the check's unit, not "abc"/],
        ['a hi that ge does not read, as text',[{ kind: 'R_AT', cmp: 'ge', hi: 'x' }], 'badValue', { option: 'hi' }, /hi is a number in the check's unit, not "x"/],
        ['a preset key that is not text', [{ kind: 'R_AT', presetKey: 5 }], 'badValue', { option: 'presetKey' }, /presetKey is text, not 5/],
        ['a curve id that is not text', [{ kind: 'T_AT', curveId: 5 }], 'badValue', { option: 'curveId' }, /curveId is text or null, not 5/],
        ['a sample count below 2', [{ kind: 'INTEGRAL', bandPoints: 1 }], 'badValue', { option: 'bandPoints' }, /bandPoints is a whole number of 2 or more/],
        ['a side it does not know', [{ kind: 'LAYER_COUNT', side: 'top' }], 'badValue', { option: 'side' }, /side is 'front', 'back' or 'both', not "top"/],
        ['a side of null', [{ kind: 'THICKNESS_BUDGET', side: null }], 'badValue', { option: 'side' }, /not null/],
        ['a curve the design does not hold', [{ kind: 'PPEF', curveId: 'nope' }], 'badValue', { option: 'curveId' }, new RegExp(`curveId is the id of one of the design's measured curves: ${curveId}, not "nope"`)],
        ['a PPEF check that names no curve', [{ kind: 'PPEF' }], 'badValue', { option: 'curveId' }, /curveId is .*, not null/],
        ['a preset it does not offer', [{ kind: 'INTEGRAL', presetKey: 'Tviz' }], 'badValue', { option: 'presetKey' }, new RegExp(`presetKey is '' for none, or one of ${PRESETS}, not "Tviz"`)],
        ['a field given otherwise than its preset sets it', [{ kind: 'INTEGRAL', presetKey: 'Tvis', channel: 'R' }], 'badValue', { option: 'channel' }, /channel is "T", as preset Tvis sets it, or left out, not "R"/],
        ['a band given otherwise than its preset', [{ kind: 'INTEGRAL', presetKey: 'Tvis', lambdaStart: 400 }], 'badValue', { option: 'lambdaStart' }, /lambdaStart is 380, as preset Tvis sets it/],
        ['a source it does not know', [{ kind: 'INTEGRAL', source: { id: 'D66' } }], 'badValue', { option: 'source' }, /source is one with an id of D65, D50, A, AM1\.5G, E, blackbody or custom; a blackbody/],
        ['a custom source without its table', [{ kind: 'INTEGRAL', source: { id: 'custom' } }], 'badValue', { option: 'source' }, /source is/],
        ['a blackbody without its temperature', [{ kind: 'INTEGRAL', source: { id: 'blackbody' } }], 'badValue', { option: 'source' }, /blackbody with T/],
        ['a detector it does not know', [{ kind: 'INTEGRAL', detector: { id: 'scotopic' } }], 'badValue', { option: 'detector' }, /detector is one with an id of photopic, flat or custom; a custom one/],
        ['a source on a kind that weighs nothing, unknown', [{ kind: 'R_AVG', source: { id: 'D66' } }], 'badValue', { option: 'source' }, /source is one with an id of/],
        ['enabled given as text', [{ kind: 'T_AT', enabled: 'yes' }], 'badValue', { option: 'enabled' }, /enabled is true or false/],
        ['a label that is not text', [{ kind: 'T_AT', label: 5 }], 'badValue', { option: 'label' }, /label is text, not 5/],
        ['an id that is not a name', [{ kind: 'T_AT', id: '' }], 'badValue', { option: 'id' }, /id is a name, as text/],
        ['two checks with one id', [{ kind: 'T_AT', id: 'a' }, { kind: 'R_AT', id: 'a' }], 'badValue', { row: 1, option: 'id' }, /check 1: id is a name no other check has, not "a"/],
    ];
    for (const [what, checks, code, fields, pattern] of REFUSED) {
        const err = thrown(() => api.setSpecification(ppef, checks));
        const fieldsMatch = !!err?.fields && Object.entries({ row: 0, ...fields }).every(([key, value]) => isDeepStrictEqual(err.fields[key], value));
        ok(`setSpecification refuses ${what}`, err?.code === code && err.fields.call === 'setSpecification' && fieldsMatch && pattern.test(err.message), err ? `${err.code} ${JSON.stringify(err.fields)} ${err.message}` : 'not refused');
    }
    ok('setSpecification refuses checks that are not a list', /checks is a list of specification checks/.test(thrown(() => api.setSpecification(ppef, { kind: 'T_AT' }))?.message ?? ''));
    ok('and a check that is not an object', /check 0: a check is an object of fields/.test(thrown(() => api.setSpecification(ppef, ['T_AT']))?.message ?? ''));
}

// ── 5. The examples run ────────────────────────────────────────────────────
{
    const AsyncFunction = (async () => {}).constructor;
    const calls = apiCalls(path.join(ROOT, 'src', 'api')).filter(call => ['setSpecification', 'checkSpecification', 'estimateYield'].includes(call.name));
    for (const call of calls) {
        const printed = [];
        const failed = await new AsyncFunction('tf', 'console', call.example)(api, { log: (...args) => printed.push(args.join(' ')) }).then(() => null, err => err.message);
        ok(`the example of ${call.name} runs and prints what it found`, failed === null && printed.length > 0, failed ?? printed.join(' | '));
    }
    ok('each call has its example', calls.length === 3 && calls.every(call => call.example));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
