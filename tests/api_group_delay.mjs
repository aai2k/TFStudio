/**
 * The headless API's groupDelay (src/api/groupDelay.js) against the GD/GDD
 * window's own code, the evaluator under it, Pulse Analysis's whole part and
 * the merit's PR, GD and GDD rows.
 *
 *   1. On the corpus designs with no catalog, groupDelay with step 'auto' is
 *      computeGdGddSpectrum, the function the window's hook calls, with the
 *      window's options: on four designs over front and back, R and T, s, p
 *      and avg, at 0 and 45 degrees; on the others at one of those
 *      combinations each, taken in turn. outOfRange is the window's range
 *      notice on each side, and on the whole part names every material.
 *      Without options it takes the window's factory settings and a uniform
 *      0.5 nm step.
 *   2. The uniform grid: every step from `from`, the last point at `to`, 801
 *      points for 400-800 nm at 0.5, and 200001 points computed whole; at
 *      each, the values are those of
 *      createDesignPhaseDispersionEvaluator at that wavelength, for s, p and
 *      their mean as the window averages them, the phase to a whole turn; a
 *      table knot that is a grid wavelength carries the evaluator's two
 *      one-sided values, and only those knots, under the knot rule's density
 *      limit.
 *   3. The objects' CSV with step 'auto' is the window's table through its
 *      Copy CSV (buildGdGddView, csvFromRows); with a reference, the phase is
 *      the window's plotted phase, and nothing else moves; a reference whose
 *      nearest sample has no value is not applied and reads null.
 *   4. Cross-checks: the whole part in transmission is Pulse Analysis's
 *      response (createCoatingResponses with side 'whole'), its GDD the mean
 *      of the s and p channels' as the spectrum view draws it at one pass, its
 *      phase the same on a 0.5 and a 0.01 nm grid and turning by −∫GD dω; the
 *      PR, GD and GDD rows of the corpus golden file are the API's values at
 *      their wavelength, angle and polarization; in every surface mode the
 *      PR, GD, GDDT and TOD rows score what groupDelay computes without side.
 *   5. Refusals with their codes and fields.
 *
 * Run: node tests/api_group_delay.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { fixtureFile, golden, manifest } from './_apiCorpus.mjs';

// The window's CSV writer sits in a module of React components.
globalThis.React = createRequire(import.meta.url)('react');
const api = await import('../src/api/index.js');
const objects = await import('../src/api/objects/index.js');
const { computeGdGddSpectrum } = await import('../src/components/windows/analysis/gdGddEvaluation/spectrum.js');
const { buildGdGddView } = await import('../src/components/windows/analysis/gdGddEvaluation/viewModel.js');
const { sessionDefaults } = await import('../src/constants/analysisDefaults.js');
const en = (await import('../src/constants/locales/en.js')).default;
const { withHerpinRecords } = await import('../src/utils/materials/designMaterials.js');
const { designRangeCoverage, materialsRangeCoverage, rangeMaterials } = await import('../src/utils/materials/materialRange.js');
const { createDesignPhaseDispersionEvaluator } = await import('../src/utils/physics/phaseDispersion.js');
const { C_NM_PER_FS, chromaticDispersionCoefficient } = await import('../src/utils/physics/thinFilmMath.js');
const { createCoatingResponses } = await import('../src/utils/physics/pulsePropagation/coatingResponse.js');
const { mirrorLayers } = await import('../src/utils/physics/optimizer.js');
const { csvFromRows } = await import('../src/components/ui/ResultsSection.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const thrown = fn => { try { fn(); return null; } catch (err) { return err; } };
const same = (a, b) => isDeepStrictEqual(a, b);
// The angle between two phases in degrees, a whole turn apart taken as none.
const turnApart = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);

await api.init();
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-group-delay-'));
const DEFAULTS = sessionDefaults('gdGddEvaluation');

// ── The designs ────────────────────────────────────────────────────────────
const CORPUS = Object.entries(manifest.fixtures).filter(([, fixture]) => Object.keys(fixture.variants).join() === 'default').map(([name]) => name);
const opened = CORPUS.map(name => [name, api.openDesign(fixtureFile(name))]);
const resolves = design => !thrown(() => api.spectrum(design, { from: 500, to: 501 }))?.message?.includes('resolve to nothing');
const corpus = opened.filter(([, design]) => resolves(design));
const unresolved = opened.filter(([, design]) => !resolves(design));
const mirror = api.stackFromFormula(api.newDesign({ name: 'Mirror' }), { formula: '(HL)^8 H' });

// The window's spectrum as the hook computes it, in the API's fields.
function windowCurves(design, { side, response, pol, angle, from = 400, to = 800 }) {
    const raw = computeGdGddSpectrum(withHerpinRecords(design), {
        side, target: response, polarization: pol, thetaDeg: angle, lambdaStart: from, lambdaEnd: to, preview: false,
    });
    return [raw.lambda, raw.phaseDeg, raw.gd, raw.gdd, raw.tod, raw.cdc, raw.outsideRange,
        raw.knotSamples.map(({ wavelengthNm, gd, gdd, tod, cdc }) => ({ wavelength: wavelengthNm, gd, gdd, tod, cdc })),
        raw.invalid.map(({ wavelengthNm, reason }) => ({ wavelength: wavelengthNm, reason })), raw.models];
}
const curvesOf = g => [g.wavelength, g.phase, g.gd, g.gdd, g.tod, g.cdc, g.outside, g.knots, g.invalid, g.models];

// ── 1. The window's numbers ────────────────────────────────────────────────
const COMBINATIONS = ['front', 'back'].flatMap(side => ['R', 'T'].flatMap(response => ['s', 'p', 'avg'].flatMap(pol => [0, 45].map(angle => ({ side, response, pol, angle })))));
// The full product on designs coated on both sides, on the back alone, with
// a dense table and with many layers; one combination on each of the others.
const FULL = ['absorbing-substrate-both-sides-total', 'back-only-side', 'coating-library-applied', 'pulse-spectrum'];
{
    const cases = corpus.flatMap(([name, design], i) => (FULL.includes(name) ? COMBINATIONS : [COMBINATIONS[(i * 7) % COMBINATIONS.length]]).map(c => [name, design, c]));
    const wrong = cases.filter(([, design, c]) => {
        const got = api.groupDelay(design, { ...c, step: 'auto' });
        return !same([got.mode, got.step, ...curvesOf(got)], [c.side, 'auto', ...windowCurves(design, c)]);
    }).map(([name, , c]) => `${name} ${JSON.stringify(c)}`);
    const covered = new Set(cases.map(([, , c]) => JSON.stringify(c)));
    ok(`on ${corpus.length} designs, groupDelay with step 'auto' is computeGdGddSpectrum: the full product on ${FULL.length}, every combination met`,
        corpus.length >= 12 && FULL.every(name => corpus.some(([n]) => n === name)) && covered.size === COMBINATIONS.length && wrong.length === 0, wrong.slice(0, 4).join('\n'));
}
{
    // The window's range notice names the computed side's materials
    // (GDGDDEvaluation.js); the whole part computes with every one.
    const ta2o5 = api.openDesign(fixtureFile('absorbing-substrate-both-sides-total'));
    const backOnly = api.setLayer(ta2o5, { side: 'front', index: ta2o5.frontLayers.findIndex(l => l.material === 'builtin:Ta2O5'), material: 'builtin:MgF2' });
    const notice = (design, side) => materialsRangeCoverage(rangeMaterials(withHerpinRecords(design), side), [300, 1100]).offenders;
    const cases = [...corpus, ['Ta2O5 on the back alone', backOnly]].flatMap(([name, design]) => ['front', 'back'].map(side => [name, design, side]));
    const wrong = cases.filter(([, design, side]) => !same(api.groupDelay(design, { from: 300, to: 1100, step: 5, side }).outOfRange, notice(design, side)))
        .map(([name, , side]) => `${name} ${side}`);
    const names = side => api.groupDelay(backOnly, { from: 300, to: 1100, step: 5, side, response: 'T' }).outOfRange.map(o => o.name);
    const whole = api.groupDelay(backOnly, { from: 300, to: 1100, step: 5, side: 'total', response: 'T' }).outOfRange;
    ok('outOfRange is the window\'s notice on each side, names Ta2O5 on the back alone, and on the whole part every material',
        wrong.length === 0 && same([names('front'), names('back')], [[], ['Ta2O5']]) && same(whole, designRangeCoverage(withHerpinRecords(backOnly), [300, 1100]).offenders)
        && whole.some(o => o.name === 'Ta2O5'), wrong.slice(0, 4).join('; '));
}
{
    const wrong = corpus.filter(([, design]) => !same(api.groupDelay(design), api.groupDelay(design, { from: 400, to: 800, step: 0.5, angle: 0, pol: 'avg', response: 'R' })))
        .map(([name]) => name);
    const g = api.groupDelay(mirror);
    ok('without options it takes the window\'s factory settings, 400 to 800 nm at 0 degrees, avg, R, on a uniform 0.5 nm grid',
        same([DEFAULTS.lamStart, DEFAULTS.lamEnd, DEFAULTS.theta, DEFAULTS.pol, DEFAULTS.target], [400, 800, 0, 'avg', 'R']) && wrong.length === 0
        && same([g.mode, g.response, g.angle, g.pol, g.step, g.reference], ['front', 'R', 0, 'avg', 0.5, null]), wrong.join(', '));
}
{
    // A side with no layers gives its bare surface, as the window's model
    // computes it, where the window itself shows no curve.
    const bare = corpus.find(([, design]) => design.surfaceMode === 'front_only' && !design.backLayers.length)?.[1];
    const got = api.groupDelay(bare, { side: 'back', pol: 's', step: 'auto' });
    ok('a side with no layers gives its bare surface', got.mode === 'back' && got.gd.every(Number.isFinite)
        && same(curvesOf(got), windowCurves(bare, { side: 'back', response: 'R', pol: 's', angle: 0 })));
}

// ── 2. The uniform grid ────────────────────────────────────────────────────
const normalizeRadians = value => ((value + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
// The values at one wavelength, from the evaluator directly: one
// polarization, or s and p averaged as the window averages them.
function pointAt(design, { side, response, pol, angle }) {
    const each = Object.fromEntries(['s', 'p'].map(code => [code, createDesignPhaseDispersionEvaluator(withHerpinRecords(design), { side, target: response, polarization: code, thetaDeg: angle })]));
    return (wavelength, knotSide) => {
        const [s, p] = ['s', 'p'].map(code => each[code](wavelength, knotSide));
        if (pol !== 'avg') return pol === 's' ? s : p;
        const mean = key => (s[key] + p[key]) / 2;
        return { phaseRad: s.phaseRad + normalizeRadians(p.phaseRad - s.phaseRad) / 2, gdFs: mean('gdFs'), gddFs2: mean('gddFs2'), todFs3: mean('todFs3') };
    };
}
{
    const g = api.groupDelay(mirror, { from: 400, to: 800, step: 0.5 });
    const odd = api.groupDelay(mirror, { from: 400, to: 800, step: 0.3 }).wavelength;
    const even = g.wavelength.every((w, i) => Math.abs(w - (400 + i * 0.5)) <= 1e-9);
    ok('the uniform grid runs every step from `from` and ends at `to`: 801 points for 400-800 nm at 0.5, and at 0.3 a last point at 800',
        same([g.wavelength.length, even, odd.length, odd.slice(-2)], [801, true, 1335, [400 + 1333 * 0.3, 800]]), `${g.wavelength.length} ${odd.length} ${odd.slice(-2)}`);
    // A grid far larger than the window's own, whose phase is unwrapped in one run.
    const bare = api.newDesign({ name: 'Bare' });
    const large = thrown(() => api.groupDelay(bare, { from: 300, to: 1300, step: 0.005, pol: 's' })) ?? api.groupDelay(bare, { from: 300, to: 1300, step: 0.005, pol: 's' });
    ok('a grid of 200001 points is computed, its phase unwrapped', large.wavelength?.length === 200001 && large.phase.every(Number.isFinite), large.message);
}
{
    const designs = [['mirror', mirror], ...corpus.filter(([name]) => ['back-only-side', 'absorbing-substrate-both-sides-total', 'pulse-spectrum'].includes(name))];
    const wrong = [];
    for (const [name, design] of designs) {
        for (const c of [{ side: 'front', response: 'R', pol: 'avg', angle: 0 }, { side: 'back', response: 'T', pol: 's', angle: 45 }, { side: 'front', response: 'T', pol: 'p', angle: 45 }, { side: 'back', response: 'R', pol: 'avg', angle: 30 }]) {
            const g = api.groupDelay(design, { ...c, from: 400, to: 800, step: 0.5 });
            const at = pointAt(design, c);
            const off = g.wavelength.findIndex((w, i) => {
                const v = at(w);
                const derivatives = [v.gdFs, v.gddFs2, v.todFs3, chromaticDispersionCoefficient(v.gddFs2, w)];
                return turnApart(g.phase[i], v.phaseRad * 180 / Math.PI) > 1e-9 || !same([g.gd[i], g.gdd[i], g.tod[i], g.cdc[i]], derivatives);
            });
            if (off >= 0) wrong.push(`${name} ${JSON.stringify(c)} at ${g.wavelength[off]}`);
        }
    }
    ok(`on ${designs.length} designs, every value of the uniform grid is the evaluator's at that wavelength, s, p and avg, the phase to a whole turn`,
        designs.length === 4 && wrong.length === 0, wrong.slice(0, 4).join('; '));
}
{
    // The knots: a table knot that is a grid wavelength, read on each side,
    // unless the knots are too dense for the grid (knots.js).
    const wrong = [];
    let sampled = 0, dense = 0;
    for (const [name, design] of [['mirror', mirror], ...corpus]) {
        const c = { side: design.surfaceMode === 'back_only' ? 'back' : 'front', response: 'R', pol: 's', angle: 0 };
        const g = api.groupDelay(design, { ...c, from: 300, to: 1100, step: 0.5 });
        const evaluator = createDesignPhaseDispersionEvaluator(withHerpinRecords(design), { side: c.side, target: 'R', polarization: 's', thetaDeg: 0 });
        const inRange = evaluator.knotWavelengths.filter(knot => knot > 300 && knot < 1100);
        const onGrid = inRange.filter(knot => g.wavelength.some(w => Math.abs(w - knot) <= 1e-9));
        const expected = inRange.length * 8 > g.wavelength.length ? [] : onGrid;
        if (!expected.length && inRange.length) dense++;
        sampled += g.knots.length;
        const sides = g.knots.every(knot => same([knot.gd, knot.gdd, knot.tod], ['left', 'right'].reduce((acc, side) => {
            const v = evaluator(knot.wavelength, side);
            acc[0].push(v.gdFs); acc[1].push(v.gddFs2); acc[2].push(v.todFs3);
            return acc;
        }, [[], [], []])) && g.wavelength.includes(knot.wavelength));
        if (!same(g.knots.map(k => k.wavelength), expected) || !sides || g.wavelength.length !== 1601) wrong.push(name);
    }
    ok(`the uniform grid samples the table knots that are its wavelengths, on each side, and only under the density rule (${sampled} knots sampled, ${dense} designs too dense)`,
        sampled > 20 && dense >= 1 && wrong.length === 0, wrong.join(', '));
}

// ── 3. The CSV and the reference ───────────────────────────────────────────
{
    const view = (design, c, extra = {}) => {
        const raw = computeGdGddSpectrum(withHerpinRecords(design), { side: c.side, target: c.response, polarization: c.pol, thetaDeg: c.angle, lambdaStart: 400, lambdaEnd: 800, preview: false });
        return buildGdGddView(raw, { quantity: 'gd', outsideLabel: en.materialRange.outsideColumn, units: en.units, ...extra }, en.gdgdd, undefined, en.spectralAxis.lambdaShort);
    };
    const designs = [['mirror', mirror], ...corpus.filter(([name]) => ['pulse-spectrum', 'coating-library-applied', 'back-only-side'].includes(name))];
    const c = { side: 'front', response: 'R', pol: 'avg', angle: 0 };
    const wrong = designs.filter(([name, design], i) => {
        const file = path.join(WORK, `${i}.csv`);
        const asked = { ...c, side: design.surfaceMode === 'back_only' ? 'back' : 'front' };
        new objects.Design(design).groupDelay(400, 800, { ...asked, step: 'auto' }).saveCsv(file);
        const shown = view(design, asked);
        return fs.readFileSync(file, 'utf8') !== csvFromRows(shown.tableColumns, shown.tableRows);
    }).map(([name]) => name);
    const knotted = view(mirror, c).tableColumns.some(column => column.key === 'knot');
    const pulse = designs.find(([name]) => name === 'pulse-spectrum')?.[1];
    const outsideColumn = !!pulse && view(pulse, c).tableColumns.some(column => column.key === 'outside');
    ok(`with step 'auto' the CSV is the window's table through its Copy CSV, on ${designs.length} designs, knot rows and the outside column among them`,
        designs.length === 4 && knotted && outsideColumn && wrong.length === 0, wrong.join(', '));
    const plotted = view(mirror, c, { quantity: 'phase', referenceLambda: 550, showReference: true }).plotData;
    const referenced = api.groupDelay(mirror, { ...c, step: 'auto', reference: 550 });
    const absolute = api.groupDelay(mirror, { ...c, step: 'auto' });
    const nearest = referenced.wavelength.indexOf(550);
    const shifted = referenced.phase.every((p, i) => Math.abs(p - (absolute.phase[i] - absolute.phase[nearest])) <= 1e-9);
    ok('with a reference the phase is the window\'s plotted phase, 0 at the sample nearest it, and nothing else moves',
        same([plotted.lambda, plotted.y, referenced.phase[nearest], referenced.reference, shifted], [referenced.wavelength, referenced.phase, 0, 550, true])
        && same(curvesOf(referenced).slice(2), curvesOf(absolute).slice(2)));
    // One 100 nm SiO2 layer on BK7 has no value from 52 to 77 nm.
    const silica = api.insertLayer(api.newDesign({ name: 'Silica' }), { material: 'SiO2', thickness: 100 });
    const unshifted = api.groupDelay(silica, { from: 40, to: 120, step: 1 });
    const unapplied = api.groupDelay(silica, { from: 40, to: 120, step: 1, reference: 60 });
    ok('a reference whose nearest sample has no value leaves the phase absolute, and reference is null',
        Number.isNaN(unshifted.phase[unshifted.wavelength.indexOf(60)]) && unapplied.reference === null && same(unapplied.phase, unshifted.phase),
        `${unapplied.reference}`);
}

// ── 4. Cross-checks ────────────────────────────────────────────────────────
{
    // Pulse Analysis's whole part: its s and p responses, whose mean GDD the
    // spectrum view draws for one pass (pulseModel.js spectrumCurves).
    const wholeDesigns = corpus.filter(([name]) => ['absorbing-substrate-both-sides-total', 'back-only-side', 'front-only-total-mode'].includes(name));
    const wrong = [];
    for (const [name, design] of wholeDesigns) {
        for (const angle of [0, 45]) {
            const g = api.groupDelay(design, { response: 'T', side: 'total', angle, from: 500, to: 1000, step: 1 });
            const channels = createCoatingResponses(withHerpinRecords(design), { side: 'whole', polarization: 'avg', thetaDeg: angle });
            const off = g.wavelength.findIndex((w, i) => {
                const [s, p] = channels.map(channel => channel(w));
                return !s.valid || Math.abs(g.gdd[i] - (s.gddFs2 + p.gddFs2) / 2) > 1e-9 * Math.max(1, Math.abs(g.gdd[i])) || Math.abs(g.gd[i] - (s.gdFs + p.gdFs) / 2) > 1e-9 * Math.abs(g.gd[i]);
            });
            if (off >= 0 || g.mode !== 'total') wrong.push(`${name} ${angle} at ${g.wavelength[off]}`);
        }
    }
    ok(`on ${wholeDesigns.length} designs the whole part in transmission is Pulse Analysis's response, its GDD the mean of the s and p channels' at one pass`,
        wholeDesigns.length === 3 && wrong.length === 0, wrong.join('; '));
}
{
    // The whole part's phase on 1 mm substrates, BK7 and absorbing Si, whose
    // own phase turns by π over about 0.1 nm: a 0.5 nm grid gives the phase of
    // a 0.01 nm grid at their shared wavelengths, and across 600-610 nm the
    // phase changes by −∫GD dω, ω = 2πc/λ, the trapezoid rule on the fine grid.
    const designs = corpus.filter(([name]) => ['absorbing-substrate-both-sides-total', 'front-only-total-mode'].includes(name));
    // Each case's largest phase difference between the grids and how far the
    // phase's turn is from −∫GD dω, degrees. A wavelength of the coarse grid
    // missing from the fine one makes the difference NaN.
    const off = designs.flatMap(([name, design]) => [0, 45].map(angle => {
        const at = step => api.groupDelay(design, { response: 'T', side: 'total', angle, from: 600, to: 610, step });
        const [coarse, fine] = [at(0.5), at(0.01)];
        const fineAt = new Map(fine.wavelength.map((w, i) => [Math.round(w * 1e6), fine.phase[i]]));
        const apart = Math.max(...coarse.wavelength.map((w, i) => Math.abs(coarse.phase[i] - fineAt.get(Math.round(w * 1e6)))));
        const omega = fine.wavelength.map(w => 2 * Math.PI * C_NM_PER_FS / w);
        const integral = omega.slice(1).reduce((sum, w, i) => sum - (fine.gd[i + 1] + fine.gd[i]) / 2 * (w - omega[i]), 0) * 180 / Math.PI;
        return [`${name} ${angle}`, apart, fine.phase.at(-1) - fine.phase[0] - integral];
    }));
    ok('on the whole part the phase does not depend on the step, and turns by −∫GD dω, on a BK7 and an absorbing Si substrate 1 mm thick',
        designs.length === 2 && designs.every(([, design]) => design.substrate.thickness === 1)
        && off.every(([, apart, turn]) => apart <= 1e-6 && Math.abs(turn) <= 0.01), JSON.stringify(off));
}
{
    // The golden file's PR, GD and GDD rows, each at its wavelength, angle and
    // polarization, on the side the rows score.
    const rows = corpus.flatMap(([name, design]) => (design.meritOperands || []).map((op, i) => [name, design, op, golden[`${name}/default`]?.merit?.rows[i]])
        .filter(([, , op]) => ['PR', 'GD', 'GDD'].includes(op.type)));
    const off = rows.map(([name, design, op, row]) => {
        const g = api.groupDelay(design, { from: op.lambdaStart, to: op.lambdaStart + 1, step: 1, angle: op.aoi, pol: op.pol });
        const value = { PR: g.phase, GD: g.gd, GDD: g.gdd }[op.type][0];
        const d = op.type === 'PR' ? turnApart(value, row?.value) : Math.abs(value - row?.value);
        return [`${name} ${op.type}`, d / Math.max(1, Math.abs(row?.value))];
    });
    ok(`the corpus golden file's PR, GD and GDD rows (${off.map(([what]) => what).join('; ')}) are the API's values to the golden file's 12 digits`,
        off.length >= 4 && off.every(([, d]) => d <= 1e-10), JSON.stringify(off));
}
const MODES = ['front_only', 'back_only', 'both_independent', 'symmetric'];
const otherSide = (layers, tag) => [...layers].reverse().map(layer => ({ ...layer, id: `${tag}${layer.id}`, thickness: layer.thickness * 0.8 }));
function made(design, mode) {
    const front = [design.frontLayers, otherSide(design.backLayers, 'f')].find(layers => layers.length);
    const back = { symmetric: mirrorLayers(front) }[mode] ?? [design.backLayers, otherSide(design.frontLayers, 'b')].find(layers => layers.length);
    return { ...design, surfaceMode: mode, frontLayers: front, backLayers: back };
}
{
    // A PR, a GD, a GDDT and a TOD row at 600 nm and 30 degrees, scored on one
    // side, in every surface mode and scoring.
    const ROWS = [{ type: 'PR', pol: 'avg' }, { type: 'GD', pol: 's' }, { type: 'GDDT', pol: 'p' }, { type: 'TOD', pol: 'avg' }]
        .map(row => ({ ...row, lambdaStart: 600, lambdaEnd: 600, aoi: 30, target: 0 }));
    const plain = corpus.filter(([, design]) => design.frontLayers.length || design.backLayers.length).slice(0, 6);
    const wrong = plain.flatMap(([name, design]) => MODES.flatMap(mode => ['side', 'total'].filter(mfEvalMode => {
        const each = { ...made(design, mode), mfEvalMode };
        const scored = api.merit(api.setMerit(each, ROWS)).rows.map(r => r.value);
        const at = (pol, response) => api.groupDelay(each, { from: 600, to: 601, step: 1, angle: 30, pol, response });
        const computed = [at('avg', 'R').phase[0], at('s', 'R').gd[0], at('p', 'T').gdd[0], at('avg', 'R').tod[0]];
        const side = mode === 'back_only' ? 'back' : 'front';
        return at('avg', 'R').mode !== side || turnApart(scored[0], computed[0]) > 1e-9
            || !scored.slice(1).every((value, i) => Math.abs(value - computed[i + 1]) <= 1e-9 * Math.max(1, Math.abs(value)));
    }).map(mfEvalMode => `${name} ${mode}/${mfEvalMode}`)));
    ok('in every surface mode and scoring, PR, GD, GDDT and TOD rows score what groupDelay computes without side, the back of a back_only design and the front of any other',
        plain.length >= 4 && wrong.length === 0, wrong.slice(0, 4).join('; '));
}

// ── 5. Refusals ────────────────────────────────────────────────────────────
{
    const [, design] = corpus[0];
    const REFUSED = [
        ['an option it does not take', () => api.groupDelay(design, { start: 400 }), 'unknownOption', { option: 'start' }, /unknown option 'start'; the options are from, to, step, angle, pol, response, side, reference$/],
        ['a range that is not one', () => api.groupDelay(design, { from: 800, to: 400 }), 'wavelengthRange', { from: 800, to: 400 }, /from and to are wavelengths in nm, 0 < from < to$/],
        ['a range that is not one, on the window\'s grid', () => api.groupDelay(design, { from: 800, to: 400, step: 'auto' }), 'wavelengthRange', { from: 800, to: 400 }, /0 < from < to$/],
        ['a step of 0', () => api.groupDelay(design, { step: 0 }), 'badValue', { option: 'step', value: 0 }, /step is a wavelength step in nm above 0, or 'auto', not 0$/],
        ['a step it does not have', () => api.groupDelay(design, { step: 'fine' }), 'badValue', { option: 'step', value: 'fine' }, /or 'auto', not "fine"$/],
        ['an angle of 90', () => api.groupDelay(design, { angle: 90 }), 'badValue', { option: 'angle', value: 90 }, /angle is an angle of incidence in degrees, 0 <= angle < 90, not 90$/],
        ['a polarization it does not have', () => api.groupDelay(design, { pol: 'x' }), 'badValue', { option: 'pol', value: 'x' }, /pol is 'avg', 's' or 'p', not "x"$/],
        ['a response it does not have', () => api.groupDelay(design, { response: 'A' }), 'badValue', { option: 'response', value: 'A' }, /response is 'R' or 'T', not "A"$/],
        ['a side it does not have', () => api.groupDelay(design, { side: 'both' }), 'badValue', { option: 'side', value: 'both' }, /side is 'front', 'back' or 'total', not "both"$/],
        ['the whole part in reflection', () => api.groupDelay(design, { side: 'total' }), 'badValue', { option: 'side', value: 'total', takes: "'front' or 'back' with response 'R'" }, /^groupDelay: the whole part is computed in transmission alone, so with response 'R' side is 'front' or 'back', not 'total'$/],
        ['a reference of 0', () => api.groupDelay(design, { reference: 0 }), 'badValue', { option: 'reference', value: 0 }, /reference is a wavelength in nm above 0, not 0$/],
        ['a reference that is not a number', () => api.groupDelay(design, { reference: '550' }), 'badValue', { option: 'reference', value: '550' }, /not "550"$/],
    ];
    for (const [what, make, code, fields, pattern] of REFUSED) {
        const err = thrown(make) ?? {};
        const given = Object.fromEntries(Object.keys({ call: 'groupDelay', ...fields }).map(key => [key, err.fields?.[key]]));
        ok(`groupDelay refuses ${what}`, same([err.code, given, pattern.test(err.message), String(err.message).startsWith('groupDelay: ')], [code, { call: 'groupDelay', ...fields }, true, true]),
            `${err.code} ${JSON.stringify(err.fields)} ${err.message}`);
    }
    const many = thrown(() => api.groupDelay(design, { from: 400, to: 800, step: 0.0003 }))?.message;
    ok('more points than the API\'s limit is refused, as spectrum refuses them', /^groupDelay: 1333334 points .* is more than 1000000; take a larger step$/.test(many), many);
    const [[name, lost] = []] = unresolved;
    const messages = ['groupDelay', 'spectrum'].map(call => thrown(() => api[call](lost, call === 'spectrum' ? { from: 500, to: 600 } : undefined))?.message?.replace(/^\w+: /, ''));
    ok(`a design whose materials resolve to nothing (${name}) is refused, as spectrum refuses it`, !!lost && new Set(messages).size === 1 && /resolve to nothing/.test(messages[0]), messages.join(' / '));
}

fs.rmSync(WORK, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
