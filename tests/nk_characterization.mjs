/**
 * n, k and thickness extracted from measured R and T.
 *
 * Every case here generates its measurement from a film whose constants are
 * known, runs the extraction on it, and compares. That is the only way to tell a
 * fit that found the film from one that merely matched the data: Macleod's own
 * worked examples (5th ed., Figures 14.13 and 14.14) both recalculate their
 * input perfectly while describing the wrong film, and two of them are
 * reproduced below as guard tests.
 */
import assert from 'node:assert/strict';
import { initWasmForTest } from './_wasmInit.mjs';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { evaluateDispersionFit } from '../src/utils/materials/dispersionFits.js';
import {
    filmEllipsometry, filmSpectrum, constantFilm, griddedFilm, makeSampleEvaluator,
} from '../src/utils/materials/characterization/sampleSpectrum.js';
import { extractEnvelope } from '../src/utils/materials/characterization/envelope.js';
import { characterizeFilm } from '../src/utils/materials/characterization/nkFit.js';
import { fitDiagnostics, resolvableExtinction } from '../src/utils/materials/characterization/diagnostics.js';

// The same kernel the application runs on. It falls back to the JS loop when
// the kernel has not been built, which changes the numbers below by about 1e-15
// and the time this file takes by a factor of eight.
await initWasmForTest();

const air = getMaterial('Air');
const bk7 = getMaterial('BK7');

// A transparent oxide: Cauchy index falling from 2.30 at 400 nm to 2.16 at
// 900 nm, which is a plausible sputtered Ta2O5.
const CAUCHY = [2.14, 0.0235, 0.00042];
const cauchyIndex = (lambdaNm) => {
    const um = lambdaNm / 1000;
    return CAUCHY[0] + CAUCHY[1] / um ** 2 + CAUCHY[2] / um ** 4;
};

// An Urbach tail: k = 0.0030 at 400 nm, 3.4e-5 at 900 nm.
const URBACH = { amplitude: 3.0e-7, inverse: 3.7 };
const urbachExtinction = (lambdaNm) =>
    URBACH.amplitude * Math.exp(URBACH.inverse / (lambdaNm / 1000));

function knownFilm(absorbing) {
    return {
        getNK: lambda => [cauchyIndex(lambda), absorbing ? urbachExtinction(lambda) : 0],
    };
}

const SAMPLE = {
    incident: air, substrate: bk7, exit: air,
    substrateThicknessMm: 1.0, geometry: 'slab',
};

function grid(startNm, endNm, stepNm) {
    const lambdas = [];
    for (let value = startNm; value <= endNm + 1e-9; value += stepNm) lambdas.push(value);
    return lambdas;
}

/** Generate what a spectrophotometer would report for a known film. */
function measure(lambdas, film, thicknessNm, quantities = ['T', 'R'], scale = 1) {
    const conditions = { ...SAMPLE, lambdas, aoi: 0, pol: 'avg', side: 'front' };
    const spectrum = filmSpectrum(conditions, film, thicknessNm);
    return quantities.map(quantity => ({
        quantity, lambdas,
        values: spectrum[quantity].map(value => value * scale),
        aoi: 0, pol: 'avg', side: 'front',
    }));
}

/** Generate a conventional instrument Ψ/Δ pair at one angle. */
function measureEllipsometry(lambdas, film, thicknessNm, aoi = 70) {
    const conditions = {
        ...SAMPLE, geometry: 'coating', lambdas, aoi, side: 'front',
        deltaConvention: 'azzam',
    };
    const spectrum = filmEllipsometry(conditions, film, thicknessNm);
    return ['PSI', 'DEL'].map(quantity => ({
        quantity, lambdas, values: spectrum[quantity], aoi, side: 'front',
        deltaConvention: 'azzam',
    }));
}

function maxIndexError(result, absorbing) {
    let worst = 0;
    for (const lambda of grid(420, 880, 20)) {
        const [n] = evaluateDispersionFit(result.fit, lambda);
        worst = Math.max(worst, Math.abs(n - cauchyIndex(lambda)));
    }
    return worst;
}

function maxExtinctionError(result) {
    let worst = 0;
    for (const lambda of grid(420, 880, 20)) {
        const [, k] = evaluateDispersionFit(result.fit, lambda);
        worst = Math.max(worst, Math.abs(k - urbachExtinction(lambda)));
    }
    return worst;
}

// ── The sample model itself ───────────────────────────────────────────────────
//
// A thick transparent slab transmits (1 − R₁)/(1 + R₁) with R₁ the single-surface
// reflectance, the standard incoherent two-surface result. If the geometry is
// wrong here, every extracted k below is wrong by the same amount.
{
    const lambda = 550;
    const s = 1.52;
    const singleSurface = ((s - 1) / (s + 1)) ** 2;
    const expected = (1 - singleSurface) / (1 + singleSurface);
    // A transparent substrate, so the comparison is against the geometry alone.
    // BK7's own k is 9e-9, which moves T in the fifth decimal.
    const bare = filmSpectrum(
        {
            ...SAMPLE, substrate: constantFilm(s, 0),
            lambdas: [lambda], aoi: 0, pol: 'avg', side: 'front',
        },
        constantFilm(1, 0), 0,
    );
    assert.ok(Math.abs(bare.T[0] - expected) < 1e-9,
        `bare slab T ${bare.T[0]} should be ${expected}`);
    assert.ok(Math.abs(expected - 2 * s / (s * s + 1)) < 1e-12,
        'the two closed forms for a transparent slab must agree');
    console.log(`bare BK7 slab: T = ${bare.T[0].toFixed(5)} (closed form ${expected.toFixed(5)})`);
}

// ── Envelope method on its own ────────────────────────────────────────────────
//
// Macleod Eq. 14.15 is approximate: it assumes the fringe envelopes of an ideal
// homogeneous film. It has to land close enough to seed the exact fit, which is
// all it is used for here.
{
    const lambdas = grid(400, 1000, 2);
    const [transmittance] = measure(lambdas, knownFilm(false), 420, ['T']);
    const envelope = extractEnvelope({
        lambdas,
        transmittance: transmittance.values,
        incidentIndexAt: lambda => air.getNK(lambda)[0],
        substrateIndexAt: lambda => bk7.getNK(lambda)[0],
    });
    assert.ok(!envelope.error, `envelope method failed: ${envelope.error}`);
    const thicknessError = Math.abs(envelope.thicknessNm - 420);
    assert.ok(thicknessError < 8,
        `envelope thickness ${envelope.thicknessNm.toFixed(1)} nm, expected 420`);
    const worstIndex = Math.max(...envelope.points.map(
        point => Math.abs(point.index - cauchyIndex(point.lambda))));
    assert.ok(worstIndex < 0.03, `envelope index off by ${worstIndex.toFixed(4)}`);
    console.log(`envelope: d = ${envelope.thicknessNm.toFixed(1)} nm (420), `
        + `${envelope.extremaCount} extrema, worst Δn = ${worstIndex.toFixed(4)}`);
}

// ── Transparent film, T and R ─────────────────────────────────────────────────
{
    const lambdas = grid(400, 1000, 2);
    const result = characterizeFilm({
        channels: measure(lambdas, knownFilm(false), 420),
        sample: SAMPLE, indexModel: 'cauchy',
    });
    assert.ok(!result.error, `characterization failed: ${result.error}`);
    assert.ok(Math.abs(result.thicknessNm - 420) < 0.5,
        `thickness ${result.thicknessNm.toFixed(2)} nm, expected 420`);
    const indexError = maxIndexError(result);
    assert.ok(indexError < 0.005, `index off by ${indexError.toFixed(5)}`);
    assert.ok(result.residuals.T.rms < 1e-4 && result.residuals.R.rms < 1e-4,
        'residual should be at the level of the model itself');
    for (const lambda of grid(400, 1000, 10)) {
        assert.ok(evaluateDispersionFit(result.fit, lambda)[1] >= 0,
            `k went negative at ${lambda} nm`);
    }
    console.log(`transparent T+R: d = ${result.thicknessNm.toFixed(2)} nm (420), `
        + `Δn ≤ ${indexError.toFixed(5)}, RMS T ${result.residuals.T.rms.toExponential(1)}`);
}

// ── Absorbing film, T and R ───────────────────────────────────────────────────
{
    const lambdas = grid(400, 1000, 2);
    const result = characterizeFilm({
        channels: measure(lambdas, knownFilm(true), 420),
        sample: SAMPLE, indexModel: 'cauchy',
    });
    assert.ok(!result.error, `characterization failed: ${result.error}`);
    assert.ok(Math.abs(result.thicknessNm - 420) < 1.0,
        `thickness ${result.thicknessNm.toFixed(2)} nm, expected 420`);
    const indexError = maxIndexError(result);
    const extinctionError = maxExtinctionError(result);
    assert.ok(indexError < 0.01, `index off by ${indexError.toFixed(5)}`);
    // The tail is 3e-3 at the blue end; recovering it to a few parts in ten
    // thousand is well inside what a real measurement could resolve.
    assert.ok(extinctionError < 3e-4, `k off by ${extinctionError.toExponential(2)}`);
    assert.ok(result.pointwise.solvedExtinction, 'k should be solved from the R and T pair');
    assert.equal(result.diagnostics.warnings.length, 0,
        `clean data should raise nothing: ${JSON.stringify(result.diagnostics.warnings)}`);
    console.log(`absorbing T+R: d = ${result.thicknessNm.toFixed(2)} nm (420), `
        + `Δn ≤ ${indexError.toFixed(5)}, Δk ≤ ${extinctionError.toExponential(2)}`);
}

// ── Macleod Figure 14.14: a one percent photometric scale error ───────────────
//
// Data from a transparent dispersive film, multiplied by 0.99. Macleod's point
// is that the recalculation is perfect and the only sign of trouble is an
// extinction coefficient that rises toward longer wavelengths. The extraction
// has to raise that flag rather than report an absorbing film.
{
    const lambdas = grid(400, 1000, 2);
    const result = characterizeFilm({
        channels: measure(lambdas, knownFilm(false), 420, ['T', 'R'], 0.99),
        sample: SAMPLE, indexModel: 'cauchy',
    });
    assert.ok(!result.error, `characterization failed: ${result.error}`);
    const codes = result.diagnostics.warnings.map(warning => warning.code);
    assert.ok(codes.includes('risingExtinction'),
        `a scale error must be flagged, got ${JSON.stringify(codes)}`);
    console.log(`scale error 0.99: flagged ${JSON.stringify(codes)}, `
        + `k rises ${result.diagnostics.extinctionRange.map(v => v.toExponential(1)).join(' to ')}`);
}

// ── Reflectance alone cannot give an extinction coefficient ───────────────────
//
// "Reflectance fringes on their own should not be used for the extraction of
// extinction coefficient" (Macleod, 5th ed.). So k is not solved for, and the
// result says as much rather than returning a number nothing determined. The
// index and thickness are still recovered: the fringes are in the reflectance
// too. The envelope method reads transmittance, so the starting thickness comes
// from the operator instead, deliberately 10% out here.
{
    const lambdas = grid(400, 1000, 2);
    const result = characterizeFilm({
        channels: measure(lambdas, knownFilm(true), 420, ['R']),
        sample: SAMPLE, indexModel: 'cauchy', thicknessNm: 380,
    });
    assert.ok(!result.error, `characterization failed: ${result.error}`);
    assert.equal(result.pointwise.solvedExtinction, false,
        'one channel cannot separate n from k at a point');
    assert.equal(result.fit.k.kind, 'zero', 'k must not be invented from R alone');
    assert.ok(Math.abs(result.thicknessNm - 420) < 2,
        `thickness ${result.thicknessNm.toFixed(2)} nm, expected 420`);
    console.log(`R only, seeded at 380 nm: d = ${result.thicknessNm.toFixed(2)} nm (420), `
        + `k model = ${result.fit.k.kind}`);
}

// ── Spectroscopic ellipsometry ───────────────────────────────────────────────
//
// Ψ and Δ are two independent observables at every wavelength, so they solve n
// and k without a photometric scale. Δ is deliberately in the instrument
// convention here; the forward model must apply the same convention and use a
// circular residual at the 0°/360° boundary.
{
    const lambdas = grid(450, 850, 4);
    const thicknessNm = 180;
    const result = characterizeFilm({
        channels: measureEllipsometry(lambdas, knownFilm(false), thicknessNm),
        sample: { ...SAMPLE, geometry: 'coating' },
        indexModel: 'cauchy', thicknessNm: 160,
    });
    assert.ok(!result.error, `ellipsometry characterization failed: ${result.error}`);
    assert.ok(Math.abs(result.thicknessNm - thicknessNm) < 1,
        `ellipsometry returned ${result.thicknessNm} nm, expected ${thicknessNm}`);
    const indexError = maxIndexError(result);
    assert.ok(indexError < 0.01,
        `a clean Ψ/Δ pair must recover the film index, error ${indexError}`);
    assert.ok(result.residuals.PSI.rms < 0.02 && result.residuals.DEL.rms < 0.02,
        `ellipsometric residual is too large: ${JSON.stringify(result.residuals)}`);
}

// ── The forward model reports Δ the way a file does ──────────────────────────
//
// The case above generates its measurement from the same function that fits it,
// so it would pass just as happily with the Δ convention inverted. This anchors
// the direction outside the module: a bare absorbing surface passes Δ = 90° at
// the principal angle, which is the definition of that angle, and the same
// sample is pinned to 269.83° in the engine's own sign in the correctness
// benchmark. Getting this backwards costs about 180° in Δ and is invisible in Ψ.
{
    const silicon = { getNK: () => [3.88, 0.02] };
    const principal = Math.atan(3.88) * 180 / Math.PI;
    const bare = convention => filmEllipsometry(
        { lambdas: [632.8], incident: air, substrate: silicon, exit: air,
            aoi: principal, side: 'front', deltaConvention: convention },
        constantFilm(1, 0), 0).DEL[0];

    assert.ok(Math.abs(bare('azzam') - 90.17) < 0.05,
        `Azzam-Bashara Δ at the principal angle is ${bare('azzam').toFixed(2)}°, expected 90°`);
    assert.ok(Math.abs(bare('reversed') - 269.83) < 0.05,
        `the engine's own Δ is ${bare('reversed').toFixed(2)}°, expected 269.83°`);
}

// ── Normal incidence measures nothing ────────────────────────────────────────
//
// r_p and r_s differ only by the sign the reference frame flips, so Ψ = 45° and
// Δ = 180° for every film. A Ψ/Δ curve whose file carried no angle arrives with
// aoi 0, which is the ordinary way to reach this, so it has to be refused
// rather than fitted.
{
    const lambdas = grid(450, 850, 4);
    const flat = filmEllipsometry(
        { lambdas, incident: air, substrate: bk7, exit: air, aoi: 0, side: 'front',
            deltaConvention: 'azzam' },
        knownFilm(false), 180);
    assert.ok(flat.PSI.every(value => Math.abs(value - 45) < 1e-9)
        && flat.DEL.every(value => Math.abs(value - 180) < 1e-9),
        'the forward model should be film-independent at normal incidence');

    const channels = measureEllipsometry(lambdas, knownFilm(false), 180)
        .map(channel => ({ ...channel, aoi: 0 }));
    const refused = characterizeFilm({
        channels, sample: { ...SAMPLE, geometry: 'coating' },
        indexModel: 'cauchy', thicknessNm: 180,
    });
    assert.equal(refused.error, 'ellipsometryNormalIncidence');
}

// ── A film with no fringes holds no thickness ─────────────────────────────────
//
// Below about a quarter wave there is no extremum in range, and n and d enter
// the spectrum as their product. Reporting one of the pairs that fit would be
// worse than saying so.
{
    const lambdas = grid(700, 1000, 2);
    const result = characterizeFilm({
        channels: measure(lambdas, knownFilm(false), 30),
        sample: SAMPLE, indexModel: 'cauchy',
    });
    assert.equal(result.error, 'thicknessUndetermined');
    console.log('30 nm film over 700-1000 nm: thickness correctly reported as undetermined');
}

// ── The same film, with the thickness supplied ────────────────────────────────
{
    const lambdas = grid(700, 1000, 2);
    const result = characterizeFilm({
        channels: measure(lambdas, knownFilm(false), 30),
        sample: SAMPLE, indexModel: 'cauchy',
        thicknessNm: 30, fixThickness: true,
    });
    assert.ok(!result.error, `characterization failed: ${result.error}`);
    const indexError = maxIndexError(result);
    assert.ok(indexError < 0.02, `index off by ${indexError.toFixed(4)} with d held`);
    assert.equal(result.thicknessSpreadNm, null, 'a held thickness has no spread');
    console.log(`30 nm film, d held: Δn ≤ ${indexError.toFixed(4)}`);
}

// ── A 50 nm TiO2 witness, the thin-film import workflow ──────────────────────
//
// One 50 nm layer has no visible fringe spacing, so a run without a thickness
// must refuse to invent one. Once the deposition thickness is supplied, the
// same exported T/R pair must still produce a usable material fit.
{
    const lambdas = grid(400, 1000, 2);
    const titaniumDioxide = getMaterial('TiO2');
    const channels = measure(lambdas, titaniumDioxide, 50);
    const withoutThickness = characterizeFilm({
        channels, sample: SAMPLE, indexModel: 'cauchy',
    });
    assert.equal(withoutThickness.error, 'thicknessUndetermined');

    const held = characterizeFilm({
        channels, sample: SAMPLE, indexModel: 'cauchy',
        thicknessNm: 50, fixThickness: true,
    });
    assert.ok(!held.error, `50 nm TiO2 with held thickness failed: ${held.error}`);
    assert.equal(held.thicknessNm, 50);
    assert.ok(held.residuals.T.rms < 5e-4 && held.residuals.R.rms < 5e-4,
        `50 nm TiO2 residuals are too large: ${JSON.stringify(held.residuals)}`);
    for (const lambda of grid(420, 980, 20)) {
        const expected = titaniumDioxide.getNK(lambda)[0];
        const [actual] = evaluateDispersionFit(held.fit, lambda);
        assert.ok(Math.abs(actual - expected) < 0.04,
            `50 nm TiO2 n at ${lambda} nm is ${actual}, expected ${expected}`);
    }
    console.log(`50 nm TiO2, d held: RMS T ${held.residuals.T.rms.toExponential(1)}, `
        + `R ${held.residuals.R.rms.toExponential(1)}`);
}

// ── Optical Evaluation exports use coating geometry ──────────────────────────
//
// FRONT/BACK evaluation is one coating on a semi-infinite substrate. Treating
// those exported curves as a physical slab adds a back-surface reflection that
// is not in the data, so even exact 200/500 nm TiO2 spectra become impossible
// to invert. With the matching geometry both fringe-rich cases must solve.
{
    const lambdas = grid(360, 850, 2);
    const titaniumDioxide = getMaterial('TiO2');
    const coatingSample = { ...SAMPLE, geometry: 'coating' };
    for (const thicknessNm of [200, 500]) {
        const conditions = {
            ...coatingSample, lambdas, aoi: 0, pol: 'avg', side: 'front',
        };
        const spectrum = filmSpectrum(conditions, titaniumDioxide, thicknessNm);
        const channels = ['T', 'R'].map(quantity => ({
            quantity, lambdas, values: spectrum[quantity], aoi: 0, pol: 'avg', side: 'front',
        }));
        const result = characterizeFilm({
            channels, sample: coatingSample, indexModel: 'cauchy',
        });
        assert.ok(!result.error,
            `${thicknessNm} nm TiO2 coating export failed: ${result.error}`);
        assert.ok(Math.abs(result.thicknessNm - thicknessNm) < 3,
            `${thicknessNm} nm TiO2 returned ${result.thicknessNm.toFixed(2)} nm`);
        console.log(`${thicknessNm} nm TiO2 coating export: d = `
            + `${result.thicknessNm.toFixed(2)} nm`);
    }
}

// ── The user's 500 nm TOTAL export exercises the full model sweep ────────────
//
// Built-in TiO2 is tabulated only over most of this range, so Optical
// Evaluation clamps its short/long tails. A low-order Cauchy model cannot copy
// those flat tails exactly. Even so, later supported terms improve the actual
// spectrum materially; the sweep must not stop just because an intermediate
// term count stalls in the nonlinear refinement.
{
    const lambdas = grid(360, 850, 2);
    const titaniumDioxide = getMaterial('TiO2');
    const conditions = { ...SAMPLE, lambdas, aoi: 0, pol: 'avg', side: 'front' };
    const spectrum = filmSpectrum(conditions, titaniumDioxide, 500);
    const channels = ['T', 'R'].map(quantity => ({
        quantity, lambdas, values: spectrum[quantity], aoi: 0, pol: 'avg', side: 'front',
    }));
    const result = characterizeFilm({ channels, sample: SAMPLE, indexModel: 'cauchy' });
    assert.ok(!result.error, `500 nm TiO2 TOTAL export failed: ${result.error}`);
    assert.ok(Math.abs(result.thicknessNm - 500) < 3,
        `500 nm TiO2 TOTAL export returned ${result.thicknessNm.toFixed(2)} nm`);
    assert.ok(result.residuals.T.rms < 0.011 && result.residuals.R.rms < 0.011,
        `the full term sweep did not improve the spectrum: ${JSON.stringify(result.residuals)}`);
    assert.ok(result.diagnostics.warnings.some(warning => warning.code === 'modelMismatch'),
        'a fit outside photometric accuracy must warn before it is saved as a material');
    console.log(`500 nm TiO2 TOTAL export: d = ${result.thicknessNm.toFixed(2)} nm, `
        + `RMS T ${result.residuals.T.rms.toExponential(2)}, `
        + `R ${result.residuals.R.rms.toExponential(2)}, ${result.modelName}`);
}

// ── Reported spread ───────────────────────────────────────────────────────────
//
// A well fringed measurement determines the thickness tightly. The spread is
// the linearised standard error and has to come back small and finite, not
// absent, or nothing tells the user how far to trust the number.
{
    const lambdas = grid(400, 1000, 2);
    const result = characterizeFilm({
        channels: measure(lambdas, knownFilm(true), 420),
        sample: SAMPLE, indexModel: 'cauchy',
    });
    assert.ok(result.spread, 'a solved fit must report its spread');
    assert.ok(result.thicknessSpreadNm > 0 && result.thicknessSpreadNm < 1,
        `thickness spread ${result.thicknessSpreadNm} nm is not credible`);
    assert.equal(result.spread.labels[0], 'ln d');
    assert.ok(result.spread.maxCorrelation <= 1);
    console.log(`spread: d = ${result.thicknessNm.toFixed(2)} `
        + `± ${result.thicknessSpreadNm.toFixed(3)} nm, `
        + `max |correlation| = ${result.spread.maxCorrelation.toFixed(3)}`);
}

// ── Photometric noise ─────────────────────────────────────────────────────────
//
// Exact data proves the algebra, not the method. Macleod puts a careful R and T
// measurement at "0.1% absolute", so this adds that much noise, from a fixed
// generator so the case is the same on every run.
{
    let state = 20260828;
    const noise = () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return ((state / 0x7fffffff) - 0.5) * 2 * 0.001;
    };
    const lambdas = grid(400, 1000, 2);
    const channels = measure(lambdas, knownFilm(true), 420)
        .map(channel => ({ ...channel, values: channel.values.map(value => value + noise()) }));
    const result = characterizeFilm({ channels, sample: SAMPLE, indexModel: 'cauchy' });
    assert.ok(!result.error, `characterization failed: ${result.error}`);
    assert.ok(Math.abs(result.thicknessNm - 420) < 1.5,
        `thickness ${result.thicknessNm.toFixed(2)} nm from noisy data, expected 420`);
    const indexError = maxIndexError(result);
    assert.ok(indexError < 0.01, `index off by ${indexError.toFixed(4)} on noisy data`);
    // The spread has to grow with the noise, or it is not measuring anything.
    assert.ok(result.thicknessSpreadNm > 0, 'noisy data must report a spread');
    console.log(`0.1% noise: d = ${result.thicknessNm.toFixed(2)} `
        + `± ${result.thicknessSpreadNm.toFixed(2)} nm (420), Δn ≤ ${indexError.toFixed(4)}, `
        + `k floor ${result.diagnostics.resolvableExtinction.toExponential(1)}`);
}

// ── Reflectance measured off normal ───────────────────────────────────────────
//
// A near-normal reflectance accessory works at six or eight degrees, not zero,
// and each curve carries the angle it was measured at. Transmittance here stays
// at normal incidence, so the two channels are evaluated under different
// conditions in the same fit.
{
    const lambdas = grid(400, 1000, 2);
    const [transmittance] = measure(lambdas, knownFilm(true), 420, ['T']);
    const obliqueConditions = {
        ...SAMPLE, lambdas, aoi: 8, pol: 'avg', side: 'front',
    };
    const oblique = filmSpectrum(obliqueConditions, knownFilm(true), 420);
    const result = characterizeFilm({
        channels: [
            transmittance,
            { quantity: 'R', lambdas, values: oblique.R, aoi: 8, pol: 'avg', side: 'front' },
        ],
        sample: SAMPLE, indexModel: 'cauchy',
    });
    assert.ok(!result.error, `characterization failed: ${result.error}`);
    assert.ok(Math.abs(result.thicknessNm - 420) < 0.5,
        `thickness ${result.thicknessNm.toFixed(2)} nm, expected 420`);
    assert.ok(maxIndexError(result) < 0.005, 'index must survive a mixed-angle pair');
    console.log(`T at 0°, R at 8°: d = ${result.thicknessNm.toFixed(2)} nm (420)`);
}

// ── A library material, characterized back out of its own spectrum ────────────
//
// The cases above extract a Cauchy film from a spectrum a Cauchy film made, so
// the model can reproduce the film exactly. This one uses a tabulated material,
// where it cannot, and checks the answer against the table itself.
//
// The second half is the failure this test exists for. A tabulated material is
// flat outside the wavelengths it holds data for, and a spectrum generated past
// that edge carries a film no dispersion model can describe: falling in the
// middle and flat at the end. A Cauchy fitted to it bends upward at the red end
// rather than matching, which produces a material that would be used to design
// with. Normal dispersion is not a matter of degree, so it is a warning.
{
    const anatase = getMaterial('TiO2');
    const run = (startNm, endNm) => {
        const lambdas = grid(startNm, endNm, 2);
        const [transmittance, reflectance] = measure(lambdas, anatase, 500);
        return characterizeFilm({
            channels: [transmittance, reflectance], sample: SAMPLE, indexModel: 'cauchy',
        });
    };
    const codesOf = result => result.diagnostics.warnings.map(warning => warning.code);
    const indexErrorAgainst = (result) => {
        const [low, high] = result.fit.rangeNm;
        let worst = 0;
        for (let lambda = low; lambda <= high; lambda += 1) {
            worst = Math.max(worst,
                Math.abs(evaluateDispersionFit(result.fit, lambda)[0] - anatase.getNK(lambda)[0]));
        }
        return worst;
    };

    // Inside the material's own data, this is an ordinary good fit.
    const inside = run(370, 820);
    assert.ok(!inside.error, `characterization failed: ${inside.error}`);
    assert.ok(Math.abs(inside.thicknessNm - 500) < 0.5,
        `thickness ${inside.thicknessNm.toFixed(2)} nm, expected 500`);
    assert.ok(indexErrorAgainst(inside) < 0.005,
        `index error ${indexErrorAgainst(inside).toFixed(4)} against the library table`);
    assert.deepEqual(codesOf(inside), [],
        'a fit that reproduces a real material must raise nothing');

    // Past both edges of the table, where the material is flat and no film is.
    const past = run(360, 850);
    assert.ok(!past.error, `characterization failed: ${past.error}`);
    assert.ok(codesOf(past).includes('anomalousDispersion'),
        `an index that turns upward must be reported, got: ${codesOf(past).join(', ') || 'nothing'}`);
    const [low, high] = past.fit.rangeNm;
    const turn = past.diagnostics.warnings
        .find(warning => warning.code === 'anomalousDispersion').detail;
    assert.ok(turn.turnsAt > low && turn.turnsAt < high, 'the turn is reported inside the range');
    assert.ok(turn.rise > 0.005, `the reported rise ${turn.rise.toFixed(4)} must be the real one`);
    console.log(`library TiO2, 500 nm: d = ${inside.thicknessNm.toFixed(2)} nm, `
        + `Δn ≤ ${indexErrorAgainst(inside).toFixed(4)} in range; `
        + `past the table n turns up at ${turn.turnsAt.toFixed(0)} nm by ${turn.rise.toFixed(4)}`);
}

// ── The reported points belong to the reported thickness ──────────────────────
//
// The points are drawn beside the model and read against it, so both have to be
// solved at the same thickness. They used to come from whichever trial thickness
// the scan stopped at, which is a grid point up to a hundred-and-twentieth of
// the thickness away from the refined answer, and that is enough to put a
// fringe-period offset between the points and the curve.
{
    const lambdas = grid(400, 1000, 2);
    const result = characterizeFilm({
        channels: measure(lambdas, knownFilm(false), 420),
        sample: SAMPLE, indexModel: 'cauchy',
    });
    assert.ok(!result.error, `characterization failed: ${result.error}`);

    const conditions = { ...SAMPLE, lambdas: result.lambdas, aoi: 0, pol: 'avg', side: 'front' };
    const channels = ['T', 'R'].map(quantity => ({
        quantity, values: result.measured[quantity], conditions,
    }));
    const calculated = makeSampleEvaluator(channels)(
        griddedFilm(result.lambdas, result.pointwise.n, result.pointwise.k),
        result.thicknessNm);

    let worst = 0;
    result.lambdas.forEach((lambda, index) => {
        if (!result.pointwise.resolved[index]) return;
        worst = Math.max(worst,
            Math.abs(calculated[0][index] - result.measured.T[index]),
            Math.abs(calculated[1][index] - result.measured.R[index]));
    });
    assert.ok(worst < 1e-6,
        `a reported point misses the measurement by ${worst.toExponential(2)} at the reported thickness`);
    console.log(`points solved at the reported d: `
        + `${result.pointwise.resolved.filter(Boolean).length} / ${result.lambdas.length}, `
        + `worst residual ${worst.toExponential(2)}`);
}

// ── An absorbing film keeps its right to rise ─────────────────────────────────
//
// Anomalous dispersion is real near an absorption edge, so the check above must
// not fire on a film the measurement found absorbing.
{
    const lambdas = grid(400, 1000, 2);
    const result = characterizeFilm({
        channels: measure(lambdas, knownFilm(true), 420),
        sample: SAMPLE, indexModel: 'cauchy',
    });
    assert.ok(!result.error, `characterization failed: ${result.error}`);
    assert.ok(result.diagnostics.extinctionRange[1] > result.diagnostics.resolvableExtinction,
        'this film has to read as absorbing for the case to mean anything');
}

// ── The resolvable extinction floor ───────────────────────────────────────────
{
    const floor = resolvableExtinction(550, 420);
    const expected = 0.001 * 550 / (4 * Math.PI * 420);
    assert.ok(Math.abs(floor - expected) < 1e-12);
    console.log(`resolvable k for a 420 nm film at 550 nm: ${floor.toExponential(2)}`);
}

// ── A Ψ/Δ pair out of one file is never reported as resampled ────────────────
//
// Both curves carry the instrument's own wavelengths, and the λ range rounds to
// whole nanometres, so it clips an end off that grid. A channel whose points are
// all present in the clipped grid is selected from rather than interpolated:
// otherwise every pair from every ellipsometer reads as having been resampled,
// and the notice that means something stops meaning it.
{
    const lambdas = grid(400.37, 800.37, 2);
    const angles = filmEllipsometry(
        { lambdas, incident: air, substrate: bk7, exit: air, aoi: 70, side: 'front',
            deltaConvention: 'azzam' },
        knownFilm(false), 240);
    const channels = ['PSI', 'DEL'].map(quantity => ({
        quantity, lambdas, values: angles[quantity],
        aoi: 70, pol: 'avg', side: 'front', deltaConvention: 'azzam',
    }));
    const result = characterizeFilm({
        channels, indexModel: 'cauchy', thicknessNm: 240,
        sample: { incident: air, substrate: bk7, exit: air, substrateThicknessMm: 1,
            geometry: 'coating' },
        rangeNm: [401, 800],
    });
    assert.ok(!result.error, `ellipsometric characterization failed: ${result.error}`);
    assert.deepEqual(result.resampled, [],
        'two curves on one grid must not be interpolated because the range clipped an end');
    assert.ok(Math.abs(result.thicknessNm - 240) < 0.05,
        `Ψ and Δ alone should recover the thickness, got ${result.thicknessNm.toFixed(2)} nm`);
    assert.ok(result.residuals.PSI.rms < 1e-3 && result.residuals.DEL.rms < 1e-3,
        'and reproduce the pair it was fitted to');
    console.log(`Ψ/Δ at 70°: d = ${result.thicknessNm.toFixed(2)} nm (240), `
        + `residual ${result.residuals.PSI.rms.toExponential(1)}° / `
        + `${result.residuals.DEL.rms.toExponential(1)}°`);
}

// ── The points drawn beside the model are on the same branch as it ───────────
//
// A wavelength's own Ψ and Δ have more than one (n, k) that reproduces them at a
// given thickness, so the per-wavelength solve returns whichever root it started
// nearest. Started from a flat guess, a half-micron film came back a whole
// interference order out: n near 3.1 where the film is 2.4 to 2.8, with k up to
// 0.14 on a transparent oxide, and every one of those points reproduced the
// measurement to eight decimal places. Drawn against the fitted curve on the
// same plot, that is a second answer with nothing to say which is the film.
{
    const tio2 = getMaterial('TiO2');
    const lambdas = grid(400, 800, 5);
    const conditions = {
        lambdas, incident: air, substrate: bk7, exit: air,
        aoi: 70, side: 'front', deltaConvention: 'azzam',
    };
    const measured = filmEllipsometry(conditions, tio2, 500);
    const channels = ['PSI', 'DEL'].map(quantity => ({
        quantity, lambdas, values: measured[quantity],
        aoi: 70, pol: 'avg', side: 'front', deltaConvention: 'azzam',
    }));
    const result = characterizeFilm({
        channels, indexModel: 'cauchy', thicknessNm: 500,
        sample: { incident: air, substrate: bk7, exit: air, substrateThicknessMm: 1,
            geometry: 'coating' },
    });
    assert.ok(!result.error, `characterization failed: ${result.error}`);

    let worstIndex = 0;
    let worstExtinction = 0;
    result.lambdas.forEach((lambda, index) => {
        if (!result.pointwise.resolved[index]) return;
        worstIndex = Math.max(worstIndex, Math.abs(result.pointwise.n[index] - tio2.getNK(lambda)[0]));
        worstExtinction = Math.max(worstExtinction, result.pointwise.k[index]);
    });
    assert.ok(worstIndex < 0.01,
        `a reported point misses the film's index by ${worstIndex.toFixed(3)}, which is another root`);
    assert.ok(worstExtinction < 0.01,
        `a transparent film came back with k = ${worstExtinction.toFixed(3)} at a point`);

    // Choosing the root does not make the points agree with the model by
    // construction: they still have to reproduce the measurement on their own.
    const solved = ['PSI', 'DEL'].map((quantity, index) => ({
        quantity, values: result.measured[quantity],
        conditions: { ...conditions, lambdas: result.lambdas },
    }));
    const atPoints = makeSampleEvaluator(solved)(
        griddedFilm(result.lambdas, result.pointwise.n, result.pointwise.k), result.thicknessNm);
    let worstResidual = 0;
    result.lambdas.forEach((lambda, index) => {
        if (!result.pointwise.resolved[index]) return;
        worstResidual = Math.max(worstResidual,
            Math.abs(atPoints[0][index] - result.measured.PSI[index]),
            Math.abs(((atPoints[1][index] - result.measured.DEL[index] + 540) % 360) - 180));
    });
    assert.ok(worstResidual < 1e-5,
        `a reported point misses the measurement by ${worstResidual.toExponential(2)} degrees`);
    console.log(`500 nm TiO₂ from Ψ/Δ: d = ${result.thicknessNm.toFixed(2)} nm, `
        + `points within ${worstIndex.toExponential(1)} of the film's n`);
}

// ── An extinction that leaves the physical range is named ────────────────────
//
// The absorption model has two parameters that trade off exactly, so a fit with
// nothing holding it can run out along that direction until the numbers
// overflow. It reaches the window as a material with a k in the hundreds, which
// no film has.
{
    const rangeNm = [320, 850];
    const index = { kind: 'cauchy', coefficients: [1.68, 0.1056] };
    // The coefficients a Ψ/Δ fit of a three-layer sample came back with: ln k0
    // travels unbounded, so the amplitude ends at the top of double precision and
    // k peaks near 800 where the two exponential terms cancel.
    const runaway = fitDiagnostics({
        fit: { n: index, k: { kind: 'urbach', coefficients: [1.742117362593985e308, -136.684259, -904.064492] } },
        rangeNm, thicknessNm: 240, measured: { PSI: [], DEL: [] }, residuals: {},
        metallic: false,
    });
    assert.ok(runaway.extinctionRange[1] > 100, 'the case has to reach a k no film has');
    assert.ok(runaway.warnings.some(warning => warning.code === 'extinctionOutOfRange'),
        `a k of ${runaway.extinctionRange[1].toExponential(1)} has to be named`);

    const ordinary = fitDiagnostics({
        fit: { n: index, k: { kind: 'urbach', coefficients: [URBACH.amplitude, URBACH.inverse, 0] } },
        rangeNm, thicknessNm: 240, measured: { T: [], R: [] }, residuals: {},
        metallic: false,
    });
    assert.ok(!ordinary.warnings.some(warning => warning.code === 'extinctionOutOfRange'),
        'an ordinary absorbing film raises nothing');
}

console.log('PASS: nk_characterization');
