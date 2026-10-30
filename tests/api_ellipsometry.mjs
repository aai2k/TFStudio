/**
 * The headless API's ellipsometry and ellipsometryVsAngle
 * (src/api/ellipsometry.js) against the Ellipsometry window's own code and
 * against the merit's PSI and DEL rows.
 *
 *   1. On the corpus designs with no catalog, on the front and on the back,
 *      in both Delta conventions: ellipsometry on the window's factory grid
 *      and on a coarser one, at three angles, and ellipsometryVsAngle at three
 *      wavelengths over the window's factory sweep, the whole of the sweep at
 *      its finest step and a step that does not divide the span, are
 *      computeEllipsometrySweep, the function the window's hook calls, with
 *      the window's options; their outOfRange is the window's range notice on
 *      each side, on the corpus and on a design with Ta2O5 on the back alone;
 *      without options both take the window's factory settings, the angular
 *      sweep at the design's reference wavelength.
 *   2. Cross-checks: the PSI and DEL rows of the corpus golden file, each in
 *      the convention it records ('reversed' for a row stored without one),
 *      are the API's Psi and Delta at the row's wavelength and angle, against
 *      wavelength and against angle; in every surface mode a PSI and a DEL
 *      row in each convention score what the API computes without side; a
 *      side with no layers gives the bare surface, whose Psi is that of
 *      the Fresnel coefficients of the substrate; with no interface at all
 *      Psi and Delta are NaN, the thickness Jacobian has no value there and
 *      the merit rows that read them cannot be evaluated; 'azzam' and
 *      'reversed' add up to 360 degrees.
 *   3. The sides: without side, the back of a back_only design and the front
 *      of any other, whatever the scoring.
 *   4. Refusals with their codes and fields: an unknown option, angles,
 *      a range that is not one, a convention, a side, the whole part as the
 *      side, a wavelength, the settings the window's sweep clamps (an end
 *      above 89.5 degrees, a start not below the end, a step below 0.05
 *      degrees or above the span), and a design whose materials resolve to
 *      nothing.
 *   5. The objects: an Ellipsometry's psi and delta are Curves against
 *      wavelength and AngleCurves against angle, angle() picks one angle,
 *      AngleCurve's mean, min and max over a range of angles, and saveCsv
 *      writes the window's table.
 *
 * Run: node tests/api_ellipsometry.mjs
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
const { computeEllipsometrySweep } = await import('../src/components/windows/analysis/ellipsometryEvaluation/spectrum.js');
const { sessionDefaults } = await import('../src/constants/analysisDefaults.js');
const { withHerpinRecords } = await import('../src/utils/materials/designMaterials.js');
const { designRangeCoverage, materialsRangeCoverage, rangeMaterials } = await import('../src/utils/materials/materialRange.js');
const { mirrorLayers } = await import('../src/utils/physics/optimizer.js');
const { evaluateEllipsometryThicknessJacobian } = await import('../src/utils/physics/thinFilmMath.js');
const { csvFromRows } = await import('../src/components/ui/ResultsSection.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const thrown = fn => { try { fn(); return null; } catch (err) { return err; } };
const same = (a, b) => isDeepStrictEqual(a, b);

await api.init();
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-ellipsometry-'));
const DEFAULTS = sessionDefaults('ellipsometryEvaluation');

// ── The designs ────────────────────────────────────────────────────────────
const CORPUS = Object.entries(manifest.fixtures).filter(([, fixture]) => Object.keys(fixture.variants).join() === 'default').map(([name]) => name);
const opened = CORPUS.map(name => [name, api.openDesign(fixtureFile(name))]);
const resolves = design => !thrown(() => api.spectrum(design, { from: 500, to: 501 }))?.message?.includes('resolve to nothing');
const corpus = opened.filter(([, design]) => resolves(design));
const unresolved = opened.filter(([, design]) => !resolves(design));
const CONVENTIONS = ['azzam', 'reversed'];

// The window's sweep (computeEllipsometrySweep) as the hook calls it.
const windowSweep = (design, options) => computeEllipsometrySweep(withHerpinRecords(design), options);

// ── 1. The window's numbers ────────────────────────────────────────────────
const GRIDS = [{ from: DEFAULTS.lambdaStart, to: DEFAULTS.lambdaEnd, step: DEFAULTS.lambdaStep }, { from: 350, to: 1200, step: 5 }];
const ANGLES = [0, 45, DEFAULTS.thetaDeg];
{
    const wrong = corpus.flatMap(([name, design]) => ['front', 'back'].flatMap(side => CONVENTIONS.flatMap(deltaConvention => GRIDS.filter(grid => {
        const got = api.ellipsometry(design, { ...grid, angles: ANGLES, side, deltaConvention });
        const shown = ANGLES.map(thetaDeg => windowSweep(design, {
            mode: 'spectral', side, lambdaStart: grid.from, lambdaEnd: grid.to, lambdaStep: grid.step, thetaDeg, deltaConvention,
        }));
        return !same([got.mode, got.deltaConvention, got.wavelength, got.angles],
            [side, deltaConvention, shown[0].x, shown.map(({ psi, delta }, i) => ({ angle: ANGLES[i], psi, delta }))]);
    }).map(grid => `${name} ${side} ${deltaConvention} ${JSON.stringify(grid)}`))));
    ok(`on ${corpus.length} designs, front and back, both conventions, two grids and three angles, ellipsometry is computeEllipsometrySweep`,
        corpus.length >= 12 && wrong.length === 0, wrong.slice(0, 4).join('\n'));
}
const SWEEPS = [{ angleStart: DEFAULTS.angleStart, angleEnd: DEFAULTS.angleEnd, angleStep: DEFAULTS.angleStep }, { angleStart: 0, angleEnd: 89.5, angleStep: 0.05 },
    { angleStart: 10, angleEnd: 60, angleStep: 7.3 }];
const WAVELENGTHS = [450, 633, 1064];
{
    const wrong = corpus.flatMap(([name, design]) => ['front', 'back'].flatMap(side => CONVENTIONS.flatMap(deltaConvention => WAVELENGTHS.flatMap(wavelength => SWEEPS.filter(sweep => {
        const got = api.ellipsometryVsAngle(design, { wavelength, ...sweep, side, deltaConvention });
        const shown = windowSweep(design, { mode: 'angular', side, lambdaNm: wavelength, ...sweep, deltaConvention });
        return !same([got.mode, got.wavelength, got.deltaConvention, got.angle, got.psi, got.delta], [side, wavelength, deltaConvention, shown.x, shown.psi, shown.delta]);
    }).map(sweep => `${name} ${side} ${deltaConvention} ${wavelength} ${JSON.stringify(sweep)}`)))));
    const fine = api.ellipsometryVsAngle(corpus[0][1], { wavelength: 633, ...SWEEPS[1] }).angle;
    const odd = api.ellipsometryVsAngle(corpus[0][1], { wavelength: 633, ...SWEEPS[2] }).angle;
    ok(`on ${corpus.length} designs, front and back, both conventions, three wavelengths and three sweeps, ellipsometryVsAngle is computeEllipsometrySweep, its angles rounded to 0.001 degree`,
        wrong.length === 0 && fine.length === 1791 && fine.at(-1) === 89.5 && same(odd, [10, 17.3, 24.6, 31.9, 39.2, 46.5, 53.8]), wrong.slice(0, 4).join('\n'));
}
{
    // The window's range notices: the computed side's materials over the
    // spectral sweep's band (EllipsometryEvaluation.js), and at the angular
    // sweep's one wavelength (useMaterialLambdaNotice).
    const spanNotice = (design, side, band) => materialsRangeCoverage(rangeMaterials(design, side), band).offenders;
    const lambdaNotice = (design, side, lambda) => designRangeCoverage(design, [lambda, lambda], side).offenders;
    const ta2o5 = api.openDesign(fixtureFile('absorbing-substrate-both-sides-total'));
    const backOnly = api.setLayer(ta2o5, { side: 'front', index: ta2o5.frontLayers.findIndex(l => l.material === 'builtin:Ta2O5'), material: 'builtin:MgF2' });
    const cases = [...corpus, ['Ta2O5 on the back alone', backOnly]].flatMap(([name, design]) => ['front', 'back'].map(side => [name, design, side]));
    const wrong = cases.filter(([, design, side]) => !same(api.ellipsometry(design, { step: 5, side }).outOfRange, spanNotice(design, side, [400, 800]))
        || !same(api.ellipsometryVsAngle(design, { wavelength: 450, angleStep: 5, side }).outOfRange, lambdaNotice(design, side, 450)))
        .map(([name, , side]) => `${name} ${side}`);
    const names = (design, side) => api.ellipsometry(design, { step: 5, side }).outOfRange.map(o => o.name);
    ok('outOfRange is the window\'s notice on each side, against wavelength and against angle, and names Ta2O5 on the back alone',
        wrong.length === 0 && same([names(backOnly, 'front'), names(backOnly, 'back')], [[], ['Ta2O5']]), wrong.slice(0, 4).join('; '));
}
{
    const factory = [DEFAULTS.lambdaStart, DEFAULTS.lambdaEnd, DEFAULTS.lambdaStep, DEFAULTS.thetaDeg, DEFAULTS.angleStart, DEFAULTS.angleEnd, DEFAULTS.angleStep, DEFAULTS.deltaConvention];
    const wrong = corpus.filter(([, design]) => {
        const lambdaNm = design.referenceWavelength || 550;
        return !same(api.ellipsometry(design), api.ellipsometry(design, { from: 400, to: 800, step: 0.5, angles: [65], deltaConvention: 'azzam' }))
            || !same(api.ellipsometryVsAngle(design), api.ellipsometryVsAngle(design, { wavelength: lambdaNm, angleStart: 45, angleEnd: 80, angleStep: 0.5, deltaConvention: 'azzam' }));
    }).map(([name]) => name);
    const bare = api.newDesign({ name: 'No reference' });
    ok('without options both take the window\'s factory settings: 400 to 800 nm every 0.5 nm at 65 degrees, 45 to 80 degrees every 0.5 at the reference wavelength, Azzam-Bashara',
        same(factory, [400, 800, 0.5, 65, 45, 80, 0.5, 'azzam']) && wrong.length === 0 && api.ellipsometryVsAngle({ ...bare, referenceWavelength: null }).wavelength === 550,
        wrong.join(', '));
}

// ── 2. Cross-checks ────────────────────────────────────────────────────────
{
    // The golden file's PSI and DEL rows, each read as the merit reads it: a
    // DEL row stored without a convention reads 'reversed'.
    const rows = corpus.flatMap(([name, design]) => (design.meritOperands || []).map((op, i) => [name, design, op, golden[`${name}/default`]?.merit?.rows[i]])
        .filter(([, , op]) => op.type === 'PSI' || op.type === 'DEL'));
    const off = rows.map(([name, design, op, row]) => {
        const deltaConvention = op.type === 'DEL' ? op.deltaConvention || 'reversed' : 'reversed';
        const key = op.type === 'PSI' ? 'psi' : 'delta';
        const spectral = api.ellipsometry(design, { from: op.lambdaStart, to: op.lambdaStart + 1, step: 1, angles: [op.aoi], deltaConvention }).angles[0][key][0];
        const angular = api.ellipsometryVsAngle(design, { wavelength: op.lambdaStart, angleStart: op.aoi, angleEnd: op.aoi + 1, angleStep: 1, deltaConvention })[key][0];
        return [`${name} ${op.type} ${deltaConvention}`, Math.max(Math.abs(spectral - row?.value), Math.abs(angular - row?.value))];
    });
    ok(`the corpus golden file's PSI and DEL rows (${off.map(([what]) => what).join('; ')}) are the API's Psi and Delta against wavelength and against angle, to 1e-8 degree`,
        off.length >= 3 && off.some(([what]) => /DEL reversed/.test(what)) && off.every(([, d]) => d <= 1e-8), JSON.stringify(off));
}
const MODES = ['front_only', 'back_only', 'both_independent', 'symmetric'];
const otherSide = (layers, tag) => [...layers].reverse().map(layer => ({ ...layer, id: `${tag}${layer.id}`, thickness: layer.thickness * 0.8 }));
function made(design, mode) {
    const front = [design.frontLayers, otherSide(design.backLayers, 'f')].find(layers => layers.length);
    const back = { symmetric: mirrorLayers(front) }[mode] ?? [design.backLayers, otherSide(design.frontLayers, 'b')].find(layers => layers.length);
    return { ...design, surfaceMode: mode, frontLayers: front, backLayers: back };
}
const plain = corpus.filter(([, design]) => design.frontLayers.length || design.backLayers.length).slice(0, 6);
{
    // A PSI row and a DEL row in each convention at 600 nm and 60 degrees,
    // scored on one side, in every surface mode.
    const ROWS = [{ type: 'PSI', lambdaStart: 600, lambdaEnd: 600, aoi: 60, target: 0 },
        ...CONVENTIONS.map(deltaConvention => ({ type: 'DEL', lambdaStart: 600, lambdaEnd: 600, aoi: 60, target: 0, deltaConvention }))];
    const wrong = plain.flatMap(([name, design]) => MODES.filter(mode => {
        const each = { ...made(design, mode), mfEvalMode: 'side' };
        const scored = api.merit(api.setMerit(each, ROWS)).rows.map(r => r.value);
        const [azzam, reversed] = CONVENTIONS.map(deltaConvention => api.ellipsometry(each, { from: 600, to: 601, step: 1, angles: [60], deltaConvention }).angles[0]);
        const computed = [azzam.psi[0], azzam.delta[0], reversed.delta[0]];
        return !scored.every((value, i) => Math.abs(value - computed[i]) <= 1e-9);
    }).map(mode => `${name} ${mode}`));
    ok('in every surface mode a PSI row and a DEL row in each convention score what ellipsometry computes without side', plain.length >= 4 && wrong.length === 0, wrong.join('; '));
}
{
    // A side with no layers is the bare substrate: tan Psi = |r_p| / |r_s| of
    // the Fresnel coefficients (Macleod, Thin-Film Optical Filters, 5th ed.,
    // Eqs. 2.53 and 2.54), here for fused silica, which has no k, in air at 60 degrees.
    const bare = api.newDesign({ name: 'Bare', substrate: 'SiO2' });
    const [{ n, k }] = api.materialNK('SiO2', [600], bare).nk;
    const theta = 60 * Math.PI / 180;
    const cosT = Math.sqrt(1 - (Math.sin(theta) / n) ** 2);
    const rs = (Math.cos(theta) - n * cosT) / (Math.cos(theta) + n * cosT);
    const rp = (n * Math.cos(theta) - cosT) / (n * Math.cos(theta) + cosT);
    const psi = Math.atan(Math.abs(rp) / Math.abs(rs)) * 180 / Math.PI;
    const got = thrown(() => api.ellipsometry(bare, { from: 600, to: 601, step: 1, angles: [60] })) ?? api.ellipsometry(bare, { from: 600, to: 601, step: 1, angles: [60] });
    const angular = thrown(() => api.ellipsometryVsAngle(bare, { wavelength: 600, angleStart: 60, angleEnd: 61, angleStep: 1 })) ?? api.ellipsometryVsAngle(bare, { wavelength: 600, angleStart: 60, angleEnd: 61, angleStep: 1 });
    ok('a side with no layers gives the bare surface: Psi of the substrate\'s Fresnel coefficients, against wavelength and against angle',
        k === 0 && Math.abs(got.angles?.[0].psi[0] - psi) <= 1e-9 && Math.abs(angular.psi?.[0] - psi) <= 1e-9, `${got.message ?? got.angles?.[0].psi[0]} / ${angular.message ?? angular.psi?.[0]} / ${psi}`);
}
{
    // With no interface, the medium light comes from being the substrate's
    // glass, r_s and r_p are exactly zero and Psi and Delta are undefined: both
    // calls give NaN there, as the thickness Jacobian gives no value, a merit
    // row that reads them cannot be evaluated, and a Curve leaves them out.
    const matched = api.newDesign({ name: 'Matched', incidentMedium: 'BK7', substrate: 'BK7' });
    const spectral = api.ellipsometry(matched, { from: 500, to: 600, step: 50, angles: [0, 30] });
    const angular = api.ellipsometryVsAngle(matched, { wavelength: 550, angleStart: 20, angleEnd: 40, angleStep: 10 });
    const values = [...spectral.angles.flatMap(({ psi, delta }) => [...psi, ...delta]), ...angular.psi, ...angular.delta];
    ok('with no interface Psi and Delta are NaN, against wavelength and against angle', values.length === 18 && values.every(Number.isNaN), values.join(', '));
    const jacobian = evaluateEllipsometryThicknessJacobian({ lambdas: [550], theta_deg: 30, n0List: [[1.5, 0]], nsList: [[1.5, 0]], layerNK: [], thick: [] });
    ok('as the thickness Jacobian gives no value there', jacobian.length === 1 && jacobian[0] === null, JSON.stringify(jacobian));
    const rows = ['PSI', 'DEL', 'TANPSI', 'COSDEL'].map(type => api.merit(api.setMerit(matched, [{ type, lambdaStart: 550, lambdaEnd: 550, aoi: 30, target: 0, weight: 1 }])));
    ok('a PSI, DEL, TANPSI or COSDEL row there cannot be evaluated, and the merit is null',
        rows.every(m => m.total === null && m.rows[0].value === null && m.rows[0].error !== null), JSON.stringify(rows.map(m => [m.total, m.rows[0].error])));
    const curve = new objects.Design(matched).ellipsometry(500, 600, { step: 50, angles: [30] }).psi;
    ok("an Ellipsometry's Curve leaves NaN out of min and max", curve.min() === Infinity && curve.max() === -Infinity && Number.isNaN(curve.mean()));
}
{
    const [, design] = corpus[0];
    const [azzam, reversed] = CONVENTIONS.map(deltaConvention => api.ellipsometry(design, { deltaConvention }).angles[0]);
    const sums = azzam.delta.map((d, i) => (d + reversed.delta[i]) % 360);
    ok('Psi is the same in both conventions and the two Deltas add up to 360 degrees', same(azzam.psi, reversed.psi) && sums.every(s => Math.min(s, 360 - s) <= 1e-9));
}

// ── 3. The sides ───────────────────────────────────────────────────────────
{
    const wrong = plain.flatMap(([name, design]) => MODES.flatMap(mode => ['side', 'total'].filter(mfEvalMode => {
        const each = { ...made(design, mode), mfEvalMode };
        const side = mode === 'back_only' ? 'back' : 'front';
        const spectral = api.ellipsometry(each, { step: 5 });
        const angular = api.ellipsometryVsAngle(each, { angleStep: 5 });
        return !same([spectral.mode, angular.mode], [side, side]) || !same(spectral, api.ellipsometry(each, { step: 5, side }))
            || !same(angular, api.ellipsometryVsAngle(each, { angleStep: 5, side }));
    }).map(mfEvalMode => `${name} ${mode}/${mfEvalMode}`)));
    ok('without side both compute the back of a back_only design and the front of any other, in every surface mode and scoring', wrong.length === 0, wrong.slice(0, 3).join('; '));
}

// ── 4. Refusals ────────────────────────────────────────────────────────────
{
    const [, design] = corpus[0];
    const REFUSED = [
        ['ellipsometry', 'an option it does not take', () => api.ellipsometry(design, { start: 400 }), 'unknownOption', { option: 'start' }, /unknown option 'start'; the options are from, to, step, angles, side, deltaConvention$/],
        ['ellipsometry', 'angles that are not a list', () => api.ellipsometry(design, { angles: 65 }), 'badValue', { option: 'angles', value: 65 }, /angles is a list of angles of incidence in degrees, each 0 <= angle < 90, not 65$/],
        ['ellipsometry', 'an angle of 90', () => api.ellipsometry(design, { angles: [45, 90] }), 'badValue', { option: 'angles' }, /not \[45,90\]$/],
        ['ellipsometry', 'a range that is not one', () => api.ellipsometry(design, { from: 800, to: 400 }), 'wavelengthRange', { from: 800, to: 400 }, /from and to are wavelengths in nm, 0 < from < to$/],
        ['ellipsometry', 'a step of 0', () => api.ellipsometry(design, { step: 0 }), 'badValue', { option: 'step', value: 0 }, /step is a wavelength step in nm above 0, not 0$/],
        ['ellipsometry', 'a convention it does not have', () => api.ellipsometry(design, { deltaConvention: 'tompkins' }), 'badValue', { option: 'deltaConvention', value: 'tompkins' }, /deltaConvention is 'azzam' or 'reversed', not "tompkins"$/],
        ['ellipsometry', 'a side it does not have', () => api.ellipsometry(design, { side: 'both' }), 'badValue', { option: 'side', value: 'both' }, /side is 'front' or 'back', not "both"$/],
        ['ellipsometry', 'the whole part: Psi and Delta are measured on one surface', () => api.ellipsometry(design, { side: 'total' }), 'badValue', { option: 'side', value: 'total', takes: "'front' or 'back'" }, /^ellipsometry: Psi and Delta are measured on one surface, so side is 'front' or 'back', not 'total'$/],
        ['ellipsometryVsAngle', 'the whole part', () => api.ellipsometryVsAngle(design, { side: 'total' }), 'badValue', { option: 'side', value: 'total', takes: "'front' or 'back'" }, /^ellipsometryVsAngle: Psi and Delta are measured on one surface, so side is 'front' or 'back', not 'total'$/],
        ['ellipsometryVsAngle', 'an option it does not take', () => api.ellipsometryVsAngle(design, { step: 1 }), 'unknownOption', { option: 'step' }, /the options are wavelength, angleStart, angleEnd, angleStep, side, deltaConvention$/],
        ['ellipsometryVsAngle', 'a wavelength of 0', () => api.ellipsometryVsAngle(design, { wavelength: 0 }), 'badValue', { option: 'wavelength', value: 0 }, /wavelength is a wavelength in nm above 0, not 0$/],
        ['ellipsometryVsAngle', 'an end above 89.5 degrees, which the window sweeps to 89.5', () => api.ellipsometryVsAngle(design, { angleEnd: 89.6 }), 'angleRange', { start: 45, end: 89.6, max: 89.5 }, /angleStart and angleEnd are angles of incidence in degrees, 0 <= angleStart < angleEnd <= 89.5$/],
        ['ellipsometryVsAngle', 'a start above the end, which the window swaps', () => api.ellipsometryVsAngle(design, { angleStart: 80, angleEnd: 45 }), 'angleRange', { start: 80, end: 45, max: 89.5 }, /0 <= angleStart < angleEnd <= 89.5$/],
        ['ellipsometryVsAngle', 'a start equal to the end', () => api.ellipsometryVsAngle(design, { angleStart: 60, angleEnd: 60 }), 'angleRange', { start: 60, end: 60, max: 89.5 }, /0 <= angleStart < angleEnd <= 89.5$/],
        ['ellipsometryVsAngle', 'a start below 0', () => api.ellipsometryVsAngle(design, { angleStart: -5 }), 'angleRange', { start: -5, end: 80, max: 89.5 }, /0 <= angleStart < angleEnd <= 89.5$/],
        ['ellipsometryVsAngle', 'a step below 0.05 degrees, which the window raises to 0.05', () => api.ellipsometryVsAngle(design, { angleStep: 0.01 }), 'badValue', { option: 'angleStep', value: 0.01 }, /angleStep is an angle step in degrees from 0.05 up to the span, 35, not 0.01$/],
        ['ellipsometryVsAngle', 'a step above the span, which the window cuts to the span', () => api.ellipsometryVsAngle(design, { angleStart: 50, angleEnd: 60, angleStep: 12 }), 'badValue', { option: 'angleStep', value: 12 }, /from 0.05 up to the span, 10, not 12$/],
        ['ellipsometryVsAngle', 'a convention it does not have', () => api.ellipsometryVsAngle(design, { deltaConvention: 'Azzam' }), 'badValue', { option: 'deltaConvention', value: 'Azzam' }, /not "Azzam"$/],
    ];
    for (const [call, what, make, code, fields, pattern] of REFUSED) {
        const err = thrown(make) ?? {};
        const given = Object.fromEntries(Object.keys({ call, ...fields }).map(key => [key, err.fields?.[key]]));
        ok(`${call} refuses ${what}`, same([err.code, given, pattern.test(err.message), String(err.message).startsWith(`${call}: `)], [code, { call, ...fields }, true, true]),
            `${err.code} ${JSON.stringify(err.fields)} ${err.message}`);
    }
    const many = thrown(() => api.ellipsometry(design, { step: 0.001, angles: [50, 60, 70] }))?.message;
    ok('more points than the API\'s limit is refused, as spectrum refuses them', /^ellipsometry: 1200003 points .* is more than 1000000; take a larger step$/.test(many), many);
    const [[name, lost] = []] = unresolved;
    const messages = ['ellipsometry', 'ellipsometryVsAngle', 'spectrum'].map(call => thrown(() => api[call](lost, call === 'spectrum' ? { from: 500, to: 600 } : undefined))?.message?.replace(/^\w+: /, ''));
    ok(`a design whose materials resolve to nothing (${name}) is refused by both, as spectrum refuses it`, !!lost && new Set(messages).size === 1 && /resolve to nothing/.test(messages[0]), messages.join(' / '));
}

// ── 5. The objects ─────────────────────────────────────────────────────────
{
    const [, data] = corpus[0];
    const design = new objects.Design(data);
    const e = design.ellipsometry(400, 800, { step: 2, angles: [55, 70] });
    const plainE = api.ellipsometry(data, { from: 400, to: 800, step: 2, angles: [55, 70] });
    ok('an Ellipsometry against wavelength: psi and delta are Curves at the first angle, angle() the sweep at another',
        same([e.psi instanceof objects.Curve, [...e.psi], [...e.angle(70).delta], e.psi.wavelength, e.angles, e.mode, e.deltaConvention],
            [true, plainE.angles[0].psi, plainE.angles[1].delta, plainE.wavelength, [55, 70], plainE.mode, 'azzam']));
    const a = design.ellipsometryVsAngle(633, 40, 80, { step: 0.5, deltaConvention: 'reversed' });
    const plainA = api.ellipsometryVsAngle(data, { wavelength: 633, angleStart: 40, angleEnd: 80, angleStep: 0.5, deltaConvention: 'reversed' });
    const inRange = (values, lo, hi) => values.filter((_, i) => plainA.angle[i] >= lo && plainA.angle[i] <= hi);
    const band = inRange(plainA.psi, 55, 65);
    ok('against angle they are AngleCurves, whose mean, min and max read a range of angles, both ends included',
        same([a.psi instanceof objects.AngleCurve, a.psi.angle, a.angles, a.wavelength, a.psi.mean(55, 65), band.length, a.delta.min(), a.delta.max(70)],
            [true, plainA.angle, plainA.angle, 633, band.reduce((s, v) => s + v, 0) / band.length, 21, Math.min(...plainA.delta), Math.max(...inRange(plainA.delta, 70, 80))]));
    const refused = [() => a.psi.mean(10, 20), () => a.angle(50), () => e.angle(65)].map(f => thrown(f)?.message);
    ok('a range no angle is in, angle() on a sweep against angle and an angle not computed are refused', same(refused, [
        'mean: no angle of this curve is from 10 to 20 degrees', 'angle: this sweep runs over angle at 633 nm; psi and delta hold it',
        'angle: the sweep was computed at [55, 70], not at 65']), refused.join(' / '));
    const one = path.join(WORK, 'one.csv');
    const two = path.join(WORK, 'two.csv');
    const swept = path.join(WORK, 'angle.csv');
    design.ellipsometry(400, 800, { step: 50 }).saveCsv(one);
    e.saveCsv(two);
    a.saveCsv(swept);
    // The window's table and CSV (EllipsometryResults.js buildEllipsometryTable, csvFromRows).
    const table = (label, data) => csvFromRows([{ key: 'x', label }, { key: 'psi', label: 'Ψ (°)' }, { key: 'delta', label: 'Δ (°)' }],
        data.x.map((x, i) => ({ x, psi: data.psi[i], delta: data.delta[i] })));
    const spectral = windowSweep(data, { mode: 'spectral', side: e.mode, lambdaStart: 400, lambdaEnd: 800, lambdaStep: 50, thetaDeg: 65, deltaConvention: 'azzam' });
    const angular = windowSweep(data, { mode: 'angular', side: a.mode, lambdaNm: 633, angleStart: 40, angleEnd: 80, angleStep: 0.5, deltaConvention: 'reversed' });
    const header = fs.readFileSync(two, 'utf8').split('\n')[0];
    ok('saveCsv writes the window\'s table, at one angle after the design\'s name, the angle and the side as Measured Ellipsometry writes them, one column pair per angle when there are several',
        fs.readFileSync(one, 'utf8') === `# ${design.name}\n# AOI 65 deg, ${e.mode} side\n${table('λ (nm)', spectral)}` && fs.readFileSync(swept, 'utf8') === table('AOI (°)', angular)
        && header === 'λ (nm),Ψ (°) at 55 deg,Δ (°) at 55 deg,Ψ (°) at 70 deg,Δ (°) at 70 deg', header);
}

fs.rmSync(WORK, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
