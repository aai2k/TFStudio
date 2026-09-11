/**
 * Characterization against synthetic measurements of known films.
 *
 * Every case builds a spectrum from a film whose n and k are already known,
 * feeds it through the window's own request path, and checks that what comes
 * back is that film again. The expected accuracies are the ones the fitter
 * actually reaches, so a case that tightens or loosens is a change in the
 * fitter rather than a change in the test.
 *
 * The `limited` cases are measurements that do not determine the film. They
 * are here because the fitter must still return a spectrum that matches, and
 * must not be silently improved into claiming a thickness it cannot measure;
 * their thickness tolerance is deliberately wide and is documented per case.
 */

import assert from 'node:assert/strict';
import { loadApp, shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest } from './_wasmInit.mjs';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { filmSpectrum, filmEllipsometry } from '../src/utils/materials/characterization/sampleSpectrum.js';
import { evaluateComplexDispersionModel, evaluateDispersionFit } from '../src/utils/materials/dispersionFits.js';
import { characterizeFilm, INDEX_MODELS } from '../src/utils/materials/characterization/nkFit.js';
import { energyExcess } from '../src/utils/materials/characterization/diagnostics.js';

shimBrowserGlobals();
await loadApp();
await initWasmForTest();
const { runCharacterization, characterizationRequest } = await import(
    '../src/components/windows/dataExchange/nkCharacterization/model.js');

const lambdas = Array.from({ length: 101 }, (_, index) => 400 + 4 * index);
const metal = model => ({ getNK: nm => evaluateComplexDispersionModel(model, nm) });
const drude = metal({
    kind: 'drude', epsilonInfinity: 3, plasmaEnergyEv: 8.8, drudeDampingEv: 0.1, oscillators: [],
});
const lorentz = metal({
    kind: 'drude-lorentz', epsilonInfinity: 3, plasmaEnergyEv: 8.8, drudeDampingEv: 0.1,
    oscillators: [
        { strengthEv2: 5, resonanceEv: 2.7, dampingEv: 0.6 },
        { strengthEv2: 2, resonanceEv: 4.1, dampingEv: 0.9 },
    ],
});
// Both metals are fitted with Drude-Lorentz, the only metal model offered. A
// film with no absorption band in range must come back from it with no
// oscillators, which is the plain Drude fit; that is why there is no separate
// Drude entry to pick.
const films = {
    SiO2: { film: getMaterial('SiO2'), model: 'sellmeier' },
    MgF2: { film: getMaterial('MgF2'), model: 'cauchy' },
    TiO2: { film: getMaterial('TiO2'), model: 'cauchy' },
    Ta2O5: { film: getMaterial('Ta2O5'), model: 'cauchy' },
    'free electron': { film: drude, model: 'drude-lorentz', oscillators: 0 },
    'drude-lorentz': { film: lorentz, model: 'drude-lorentz', oscillators: 2 },
};

assert.ok(!INDEX_MODELS.includes('drude'),
    'Drude-Lorentz covers a free-electron metal on its own, so Drude is not offered');
assert.deepEqual(INDEX_MODELS, ['cauchy', 'sellmeier', 'drude-lorentz']);

// dNm, dn and dk are the largest errors accepted in the thickness and in the
// recovered constants over the whole range. rms is the largest residual the fit
// may leave, in fractions for R/T and in degrees for Ψ/Δ.
const cases = [];
const add = (material, thickness, mode, expect, extra = {}) => cases.push({
    material, thickness, mode, expect, ...films[material], ...extra,
});

// ── Dielectrics, thickness solved ────────────────────────────────────────────
// Low index against the substrate, high index, and one of each measured thick
// enough to put several interference orders inside the range.
add('SiO2', 250, 'photometry', { dNm: 0.1, dn: 5e-4, dk: 1e-6, rms: 1e-5 });
add('SiO2', 1200, 'photometry', { dNm: 0.1, dn: 5e-4, dk: 1e-6, rms: 1e-4 });
add('SiO2', 500, 'ellipsometry', { dNm: 0.5, dn: 5e-3, dk: 5e-3, rms: 0.05 });
add('SiO2', 1200, 'ellipsometry', { dNm: 0.5, dn: 5e-3, dk: 5e-3, rms: 0.05 });
add('MgF2', 500, 'photometry', { dNm: 0.5, dn: 5e-3, dk: 1e-6, rms: 1e-4 });
add('MgF2', 1200, 'ellipsometry', { dNm: 0.5, dn: 5e-3, dk: 5e-3, rms: 0.05 });
add('TiO2', 80, 'photometry', { dNm: 0.5, dn: 5e-3, dk: 1e-6, rms: 1e-4 });
add('TiO2', 500, 'photometry', { dNm: 0.5, dn: 5e-3, dk: 1e-6, rms: 1e-3 });
add('TiO2', 80, 'ellipsometry', { dNm: 0.5, dn: 5e-3, dk: 1e-3, rms: 0.05 });
add('TiO2', 500, 'ellipsometry', { dNm: 0.5, dn: 5e-3, dk: 1e-3, rms: 0.1 });
add('Ta2O5', 80, 'photometry', { dNm: 0.5, dn: 0.02, dk: 1e-3, rms: 1e-3 });
add('Ta2O5', 1200, 'photometry', { dNm: 0.5, dn: 0.02, dk: 1e-3, rms: 5e-3 });
add('Ta2O5', 250, 'ellipsometry', { dNm: 0.5, dn: 0.02, dk: 5e-3, rms: 0.5 });

// ── Dielectrics, thickness held ──────────────────────────────────────────────
add('SiO2', 80, 'photometry', { dNm: 0, dn: 5e-4, dk: 1e-6, rms: 1e-5 }, { hold: true });
add('TiO2', 80, 'photometry', { dNm: 0, dn: 0.01, dk: 1e-6, rms: 1e-3 }, { hold: true });
add('Ta2O5', 80, 'ellipsometry', { dNm: 0, dn: 0.03, dk: 5e-3, rms: 0.5 }, { hold: true });

// ── Metals ───────────────────────────────────────────────────────────────────
for (const material of ['free electron', 'drude-lorentz']) {
    // Thin enough to transmit, so R/T can see the thickness at all.
    add(material, 25, 'photometry', { dNm: 0.01, dn: 1e-6, dk: 1e-5, rms: 1e-9 });
    add(material, 25, 'photometry', { dNm: 0, dn: 1e-6, dk: 1e-6, rms: 1e-7 }, { hold: true });
    add(material, 35, 'ellipsometry', { dNm: 0.01, dn: 1e-9, dk: 1e-9, rms: 1e-8 });
    add(material, 120, 'ellipsometry', { dNm: 0.01, dn: 1e-9, dk: 1e-9, rms: 1e-8 });
    // Opaque: the reflection carries no thickness, so Solve must keep the
    // entered value and say so rather than return a fitted number.
    add(material, 500, 'ellipsometry',
        { dn: 1e-8, dk: 1e-8, rms: 1e-7, unresolved: true });
    add(material, 500, 'ellipsometry',
        { dNm: 0, dn: 1e-8, dk: 1e-8, rms: 1e-7 }, { hold: true });
}

// ── A film that absorbs, where k has to come back ────────────────────────────
// Everything above is transparent or nearly so, which leaves the extinction
// model untested. This is an Urbach-like tail: k = 3e-3 at 400 nm falling by e
// every 108 nm, which is what a real oxide does near its band edge.
const absorbingOxide = {
    getNK: nm => [getMaterial('Ta2O5').getNK(nm)[0], 3e-3 * Math.exp(-(nm - 400) / 108)],
};
films.absorbing = { film: absorbingOxide, model: 'cauchy' };
add('absorbing', 200, 'photometry', { dNm: 0.5, dn: 0.01, dk: 1e-4, rms: 1e-3 }, { hold: true });
add('absorbing', 800, 'photometry', { dNm: 0.5, dn: 0.01, dk: 2e-4, rms: 2e-3 }, { hold: true });

// ── Illumination through the uncoated face ───────────────────────────────────
// The instrument turned the witness round. Transmittance is the same either
// way and reflectance is not, so the film has to come back from the far side.
add('TiO2', 400, 'photometry', { dNm: 0.5, dn: 0.01, dk: 1e-6, rms: 2e-3 },
    { side: 'back', hold: true });

// ── A substrate that is not BK7 ──────────────────────────────────────────────
add('TiO2', 400, 'photometry', { dNm: 0.5, dn: 0.01, dk: 1e-6, rms: 2e-3 },
    { substrate: 'SiO2', hold: true });

// ── Mixed measurement conditions ─────────────────────────────────────────────
// Each curve carries its own angle and polarization. R and T taken under
// different illumination must not be added up as an energy balance.
add('SiO2', 250, 'photometry', { dNm: 0.5, dn: 5e-3, dk: 1e-6, rms: 1e-4 },
    { conditions: { T: { aoi: 60, pol: 'p' }, R: { aoi: 60, pol: 'p' } } });
add('TiO2', 250, 'photometry', { dNm: 0.5, dn: 5e-3, dk: 1e-6, rms: 1e-3 },
    { conditions: { T: { aoi: 0, pol: 'avg' }, R: { aoi: 45, pol: 's' } }, mixedAngles: true });

// ── Measurements that do not determine the film ──────────────────────────────
// A film thinner than one interference order, on a substrate close to its own
// index, leaves n and d entering the spectrum almost only as their product. The
// fitter returns a spectrum that matches; the thickness in it is not measured.
add('SiO2', 80, 'photometry', { dNm: 35, dn: 0.2, dk: 1e-6, rms: 1e-5 }, { limited: true });
add('MgF2', 80, 'photometry', { dNm: 10, dn: 0.05, dk: 1e-6, rms: 1e-5 }, { limited: true });
add('SiO2', 80, 'ellipsometry', { dNm: 10, dn: 0.02, dk: 0.02, rms: 0.01 }, { limited: true });
add('Ta2O5', 80, 'ellipsometry', { dNm: 15, dn: 0.2, dk: 0.5, rms: 0.2 }, { limited: true });
// The same film with its thickness held exactly. Forced transparent, R and T
// are one equation per wavelength rather than two, and R passes through a
// minimum at n = √n_substrate, so an index either side of that minimum
// reproduces the measurement. The fit takes the lower branch, near 1.11, which
// is under any dense film. It reproduces R and T to 1e-6 and the rising index
// is what gives it away, so the notice is part of what this case checks.
add('MgF2', 80, 'photometry', { dNm: 0, dn: 0.3, dk: 1e-6, rms: 1e-5, notice: 'anomalousDispersion' },
    { limited: true, hold: true });
// A 1200 nm titania film at one angle puts many interference orders inside the
// measured range. The scan cannot separate them and the fit settles an order
// high. Recorded so that a future improvement is visible as this case tightening.
add('TiO2', 1200, 'ellipsometry',
    { dNm: 140, dn: 0.15, dk: 1e-3, rms: 4, notice: 'anomalousDispersion' }, { limited: true });

const rows = [];
const failures = [];
let limitedCount = 0;
// Every case is checked to the end and the table is printed whatever happens,
// so one regression shows what it did to the others rather than hiding them.
const check = (condition, message) => { if (!condition) failures.push(message); };
for (const test of cases) {
    const ellipsometry = test.mode === 'ellipsometry';
    const hold = !!test.hold;
    const substrate = test.substrate || 'BK7';
    const side = test.side || 'front';
    const base = {
        incident: getMaterial('Air'), substrate: getMaterial(substrate), exit: getMaterial('Air'),
        substrateThicknessMm: 1, geometry: ellipsometry ? 'coating' : 'slab',
        lambdas, aoi: ellipsometry ? 70 : 0, pol: 'avg', side, deltaConvention: 'azzam',
    };
    const quantities = ellipsometry ? ['PSI', 'DEL'] : ['T', 'R'];
    const curves = quantities.map((quantity) => {
        const at = { ...base, ...test.conditions?.[quantity] };
        const measured = (ellipsometry ? filmEllipsometry : filmSpectrum)(at, test.film, test.thickness);
        return {
            id: quantity, name: quantity, quantity, x: lambdas, y: measured[quantity],
            xUnit: 'nm', yWasPercent: false, aoi: at.aoi, pol: at.pol,
            side: at.side, deltaConvention: 'azzam',
        };
    });
    // A FRONT design with a stale film-only setting, to exercise the window's
    // request path and not only the solver: photometry must reach the fitter as
    // the full slab whatever the design says.
    const design = {
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: substrate, thickness: 1 },
        surfaceMode: 'front_only', mfEvalMode: 'side', frontLayers: [], backLayers: [],
        measuredCurves: ellipsometry ? [] : curves,
        measuredEllipsometry: ellipsometry ? curves : [],
    };
    const settings = {
        measurementMode: test.mode, geometry: 'coating', indexModel: test.model,
        transmittanceId: 'T', reflectanceId: 'R', psiId: 'PSI', deltaId: 'DEL',
        deltaConvention: 'azzam', fixThickness: hold,
        thicknessNm: String(test.thickness * (hold ? 1 : 0.95)),
    };
    const label = `${test.material} ${test.thickness} nm ${test.mode} ${hold ? 'hold' : 'solve'}`
        + (test.side === 'back' ? ' back' : '')
        + (test.substrate ? ` on ${test.substrate}` : '')
        + (test.conditions ? ' mixed' : '') + (test.limited ? ' [limited]' : '');

    const prepared = characterizationRequest(design, settings);
    assert.equal(prepared.request.sample.geometry, ellipsometry ? 'coating' : 'slab',
        `${label}: photometry is fitted through the whole slab`);
    const result = runCharacterization(design, settings);
    assert.ok(!result.error, `${label}: ${result.error}`);

    let nError = 0;
    let kError = 0;
    for (const nm of lambdas) {
        const expected = test.film.getNK(nm);
        const actual = evaluateDispersionFit(result.fit, nm);
        nError = Math.max(nError, Math.abs(actual[0] - expected[0]));
        kError = Math.max(kError, Math.abs(actual[1] - expected[1]));
    }
    const worstRms = Math.max(...quantities.map(quantity => result.residuals[quantity].rms));
    const { expect } = test;

    if (expect.unresolved) {
        check(result.thicknessStatus === 'unresolved',
            `${label}: an opaque film's thickness is not measured, got "${result.thicknessStatus}"`);
        check(result.thicknessNm === test.thickness * 0.95,
            `${label}: the entered value is kept exactly, got ${result.thicknessNm}`);
        check(result.thicknessSpreadNm === null, `${label}: no spread belongs on an assumption`);
        check(result.diagnostics.warnings.some(warning => warning.code === 'thicknessUnresolved'),
            `${label}: the reader is not told the thickness was assumed`);
    } else {
        check(result.thicknessStatus === (hold ? 'held' : 'fitted'),
            `${label}: thickness status "${result.thicknessStatus}"`);
        check(Math.abs(result.thicknessNm - test.thickness) <= expect.dNm,
            `${label}: thickness ${result.thicknessNm.toFixed(2)} nm, wanted within ${expect.dNm} nm`);
    }
    check(nError <= expect.dn, `${label}: n out by ${nError.toExponential(2)}, allowed ${expect.dn}`);
    check(kError <= expect.dk, `${label}: k out by ${kError.toExponential(2)}, allowed ${expect.dk}`);
    check(worstRms <= expect.rms,
        `${label}: residual ${worstRms.toExponential(2)}, allowed ${expect.rms}`);

    const codes = result.diagnostics.warnings.map(warning => warning.code);
    if (test.model === 'drude-lorentz') {
        check(!codes.includes('risingExtinction'),
            `${label}: a metal's k rises with wavelength by nature, not as a fault`);
        check(!codes.includes('indexOutOfRange'), `${label}: a metal's index is below one`);
    }
    // A free-electron film must come back with no oscillators, and one with
    // absorption bands must come back with some. The count is the fitter's own
    // reading of the film, which is what makes a separate Drude entry pointless.
    if (test.oscillators === 0 && !test.limited) {
        check(result.fit.complex.oscillators.length === 0,
            `${label}: no absorption band in range, so no oscillator should be spent`);
    }
    if (test.oscillators > 0 && !test.limited) {
        check(result.fit.complex.oscillators.length > 0, `${label}: Lorentz terms are not recovered`);
    }
    if (expect.notice) {
        check(codes.includes(expect.notice),
            `${label}: a fit this far off must raise "${expect.notice}", raised [${codes}]`);
    }
    if (test.mixedAngles) {
        check(curves[0].y.some((value, index) => value + curves[1].y[index] > 1.001),
            `${label}: this pair does not exceed unity, so it tests nothing`);
        check(!codes.includes('energyExcess'),
            `${label}: R and T under different illumination are not an energy balance`);
    }
    if (test.limited) limitedCount++;

    rows.push([
        label,
        `${result.thicknessNm.toFixed(2)} nm`,
        `${(result.thicknessNm - test.thickness >= 0 ? '+' : '')}${(result.thicknessNm - test.thickness).toFixed(2)}`,
        nError.toExponential(1),
        kError.toExponential(1),
        worstRms.toExponential(1),
        codes.join(',') || '-',
    ]);
}

// ── What ordinary measurement noise does to the fitter ───────────────────────
//
// Everything above is noiseless. These two are the failures a real measurement
// found, both at or below the 0.1% absolute accuracy this module assumes a
// careful photometric measurement reaches.
{
    // A repeatable instrument. The seeds are the ones that reproduced the two
    // faults; the point is a fixed set of realizations, not these numbers.
    const noisy = (values, amplitude, seed) => {
        let state = seed;
        return values.map((value) => {
            state = (state * 1103515245 + 12345) & 0x7fffffff;
            return value + ((state / 0x7fffffff) - 0.5) * 2 * amplitude;
        });
    };
    const sample = {
        incident: getMaterial('Air'), substrate: getMaterial('BK7'), exit: getMaterial('Air'),
        substrateThicknessMm: 1, geometry: 'slab',
        lambdas, aoi: 0, pol: 'avg', side: 'front',
    };
    const silica = getMaterial('SiO2');
    const truth = filmSpectrum(sample, silica, 400);

    // A Sellmeier resonance parked immediately outside the fitted range sends
    // the index at the first measured wavelength to infinity and returns a
    // non-finite one there. The fit that came back had a NaN residual, an empty
    // index range, and could still be saved as a material. It reached that by
    // sitting five parts in ten million below the low edge, where a test on the
    // coefficient alone does not see it.
    for (const seed of [520, 528, 536, 551]) {
        const result = characterizeFilm({
            sample,
            channels: ['T', 'R'].map(quantity => ({
                quantity, lambdas, values: noisy(truth[quantity], 0.0005, seed),
                aoi: 0, pol: 'avg', side: 'front',
            })),
            indexModel: 'sellmeier', thicknessNm: 400, fixThickness: true,
        });
        check(!result.error, `noise seed ${seed}: ${result.error}`);
        if (result.error) continue;
        const indices = lambdas.map(nm => evaluateDispersionFit(result.fit, nm)[0]);
        check(indices.every(Number.isFinite),
            `noise seed ${seed}: the fitted index is not finite at every wavelength`);
        check(indices.every(index => index > 0 && index < 8),
            `noise seed ${seed}: the fitted index left what a film can have`);
        check(Number.isFinite(result.residuals.T.rms) && Number.isFinite(result.residuals.R.rms),
            `noise seed ${seed}: the reported residual is not a number`);
        check(result.diagnostics.indexRange.every(Number.isFinite),
            `noise seed ${seed}: the reported index range is not a number`);
    }

    // The energy-balance notice is a calibration fault, which lifts the whole
    // range together. Judged on the worst single wavelength it fired on every
    // measurement made to the accuracy the module assumes, because the largest
    // of a few hundred noisy sums sits about three times that above one.
    for (const seed of [11, 12, 13, 14]) {
        const measured = {
            T: noisy(truth.T, 0.001, seed),
            R: noisy(truth.R, 0.001, seed + 500),
        };
        check(!energyExcess(measured),
            `noise seed ${seed}: 0.1% noise is not a calibration fault`);
        check(!!energyExcess({ T: measured.T.map(value => value * 1.01), R: measured.R }),
            `noise seed ${seed}: a one percent scale error on T is one`);
    }
}

// ── A spectrum of the coated surface alone ───────────────────────────────────
//
// Exporting a design from Optical Evaluation in FRONT or BACK gives the single
// surface, with no substrate rear face. That is not a witness, and it does not
// invert as one: the rear face is worth about four percentage points of
// reflectance on glass. It failed with "could not be solved at any wavelength",
// which reads as a broken measurement and sends the reader looking in the wrong
// place, so the fit now recognizes the case and names it.
{
    const sample = {
        incident: getMaterial('Air'), substrate: getMaterial('BK7'), exit: getMaterial('Air'),
        substrateThicknessMm: 1, geometry: 'slab',
        lambdas, aoi: 0, pol: 'avg', side: 'front',
    };
    const singleSurface = { ...sample, geometry: 'coating' };
    for (const thickness of [80, 200, 500]) {
        const seen = filmSpectrum(singleSurface, getMaterial('TiO2'), thickness);
        const result = characterizeFilm({
            sample,                                   // the witness the window assumes
            channels: ['T', 'R'].map(quantity => ({
                quantity, lambdas, values: seen[quantity], aoi: 0, pol: 'avg', side: 'front',
            })),
            indexModel: 'cauchy', thicknessNm: thickness, fixThickness: true,
        });
        check(result.error === 'singleSurfaceSpectrum',
            `single-surface ${thickness} nm: got "${result.error}", which does not say what is wrong`);
    }
    // A measurement that is simply unusable still says so plainly, rather than
    // blaming a geometry that would not have saved it either.
    const rubbish = characterizeFilm({
        sample,
        channels: ['T', 'R'].map(quantity => ({
            quantity, lambdas, values: lambdas.map(() => (quantity === 'T' ? 2.5 : 2.5)),
            aoi: 0, pol: 'avg', side: 'front',
        })),
        indexModel: 'cauchy', thicknessNm: 200, fixThickness: true,
    });
    check(rubbish.error === 'notInvertible',
        `an impossible spectrum must stay "notInvertible", got "${rubbish.error}"`);
}

// ── A metal measured from its interband edge, thickness held ─────────────────
//
// Silver's interband absorption sits at 300-340 nm, where n falls from 1.35 to
// 0.15. A 100 nm film held at its true thickness and fitted over 300-800 nm
// came back as plain Drude on a 2 nm grid and with two oscillators on a 5 nm
// one. The table fitter that seeded the model rejected every count whose n
// strayed past the extracted values by more than one grid step, and a finer
// grid shrank that step until no count survived. The residual was then wrong by
// degrees, n(550) six times too high, and nothing said so. The count is chosen
// on the measured spectrum now, held or solved, so the grid cannot decide it.
{
    const silver = getMaterial('Ag');
    const sample = {
        incident: getMaterial('Air'), substrate: getMaterial('BK7'), exit: getMaterial('Air'),
        substrateThicknessMm: 1, geometry: 'coating',
    };
    const fitHeld = (stepNm) => {
        const grid = Array.from({ length: Math.round(500 / stepNm) + 1 }, (_, index) => 300 + stepNm * index);
        const conditions = { ...sample, lambdas: grid, aoi: 65, pol: 'avg', side: 'front', deltaConvention: 'azzam' };
        const measured = filmEllipsometry(conditions, silver, 100);
        return characterizeFilm({
            sample,
            channels: ['PSI', 'DEL'].map(quantity => ({
                quantity, lambdas: grid, values: measured[quantity],
                aoi: 65, pol: 'avg', side: 'front', deltaConvention: 'azzam',
            })),
            indexModel: 'drude-lorentz', thicknessNm: 100, fixThickness: true,
        });
    };
    const fine = fitHeld(2);
    const coarse = fitHeld(5);
    const trueIndex = silver.getNK(550)[0];
    for (const [label, result] of [['2 nm', fine], ['5 nm', coarse]]) {
        check(!result.error, `silver held, ${label} grid: ${result.error}`);
        if (result.error) continue;
        check(result.fit.complex.oscillators.length > 0,
            `silver held, ${label} grid: the interband edge needs Lorentz terms, got plain Drude`);
        const worst = Math.max(result.residuals.PSI.rms, result.residuals.DEL.rms);
        check(worst < 1.5, `silver held, ${label} grid: residual ${worst.toFixed(3)}°, plain Drude leaves 4°`);
        const [n550] = evaluateDispersionFit(result.fit, 550);
        check(Math.abs(n550 - trueIndex) < 0.15,
            `silver held, ${label} grid: n(550) ${n550.toFixed(3)} against ${trueIndex.toFixed(3)}`);
    }
    if (!fine.error && !coarse.error) {
        const counts = [fine, coarse].map(result => result.fit.complex.oscillators.length);
        check(counts[0] === counts[1],
            `the grid step chose the oscillator count: ${counts[0]} on 2 nm, ${counts[1]} on 5 nm`);
        const ratio = fine.residuals.DEL.rms / coarse.residuals.DEL.rms;
        check(ratio > 0.67 && ratio < 1.5,
            `the grid step changed the fit: Δ residual ${fine.residuals.DEL.rms.toFixed(3)}° on 2 nm,`
            + ` ${coarse.residuals.DEL.rms.toFixed(3)}° on 5 nm`);
    }
}

const headers = ['case', 'thickness', 'error', 'max Δn', 'max Δk', 'worst rms', 'notices'];
const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map(row => row[column].length)));
const line = cells => cells.map((cell, column) =>
    (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('  ');
console.log(line(headers));
console.log(widths.map(width => '-'.repeat(width)).join('  '));
for (const row of rows) console.log(line(row));
assert.equal(failures.length, 0, `\n  ${failures.join('\n  ')}\n`);
console.log(`\nPASS: ${cases.length} synthetic characterization cases`
    + ` (${limitedCount} of them measurements that do not determine the film)`);
