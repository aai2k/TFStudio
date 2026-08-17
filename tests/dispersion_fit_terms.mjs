/**
 * A fit chooses its own number of terms, and may not invent structure the table
 * never measured.
 *
 * The table below is a hand-entered transparent oxide, thirteen rows with k = 0
 * throughout. Asked for six Lorentz oscillators, the fitter put a resonance
 * between two of the samples: n reached 12 and dropped below zero around 495 nm,
 * while the residual, taken at the tabulated points alone, reported nothing
 * unusual. A model is only worth its terms if it behaves between the points too.
 */
import assert from 'node:assert/strict';
import {
    fitTabulatedMaterial,
    evaluateDispersionFit,
    evaluateComplexDispersionModel,
    dispersionFitParameters,
} from '../src/utils/materials/dispersionFits.js';

const oxide = [
    [350, 2.3, 0], [370, 2.2, 0], [400, 2.05, 0], [420, 2.0, 0], [450, 1.98, 0],
    [470, 1.965, 0], [500, 1.955, 0], [550, 1.953, 0], [600, 1.952, 0],
    [700, 1.952, 0], [750, 1.951, 0], [800, 1.95, 0], [850, 1.95, 0],
];

// Every n the model takes over the fitted range, sampled far finer than the table.
function indexRange(fit, rangeNm, step = 0.5) {
    let low = Infinity;
    let high = -Infinity;
    for (let nm = rangeNm[0]; nm <= rangeNm[1]; nm += step) {
        const n = evaluateDispersionFit(fit, nm)[0];
        assert.ok(Number.isFinite(n), `index is finite at ${nm} nm`);
        low = Math.min(low, n);
        high = Math.max(high, n);
    }
    return [low, high];
}

// ── No pole between the samples ───────────────────────────────────────────────

for (const nModel of ['cauchy', 'sellmeier', 'drude-lorentz']) {
    const fit = fitTabulatedMaterial(oxide, { nModel });
    const [low, high] = indexRange(fit, [350, 850]);
    assert.ok(low > 1.7 && high < 2.6,
        `${nModel} stays near the tabulated 1.95 to 2.30, not ${low.toFixed(3)} to ${high.toFixed(3)}`);
}

// ── The term count comes from the data, not from the caller ───────────────────

const cauchy = fitTabulatedMaterial(oxide, { nModel: 'cauchy' });
const sellmeier = fitTabulatedMaterial(oxide, { nModel: 'sellmeier' });
assert.equal(cauchy.n.kind, 'cauchy');
assert.ok(cauchy.n.coefficients.length >= 2 && cauchy.n.coefficients.length <= 6);
assert.ok(sellmeier.n.terms >= 1 && sellmeier.n.terms <= 3);
assert.ok(cauchy.residuals.n.rms < 5e-3,
    'the chosen Cauchy fit is the best this table supports');

// A table this rounded cannot be fitted much closer by any of these models, so
// the residual stays visible rather than being driven down by adding terms.
assert.ok(cauchy.residuals.n.max > 1e-3, 'and it does not pretend otherwise');

// ── An oscillator narrower than the sampling is not offered ───────────────────

const metal = fitTabulatedMaterial(oxide, { nModel: 'drude-lorentz' });
const spacingEv = Math.abs(1.239841984 / (0.5) - 1.239841984 / (0.55));
for (const oscillator of metal.complex.oscillators) {
    assert.ok(oscillator.dampingEv >= spacingEv * 0.5,
        `an oscillator ${oscillator.dampingEv.toExponential(2)} eV wide is narrower than the table's own sampling`);
}

// ── A real metal still fits, and gains oscillators until it stops paying ──────

const source = {
    kind: 'drude-lorentz',
    epsilonInfinity: 3, plasmaEnergyEv: 8.8, drudeDampingEv: 0.1,
    oscillators: [
        { strengthEv2: 5, resonanceEv: 2.7, dampingEv: 0.6 },
        { strengthEv2: 2, resonanceEv: 4.1, dampingEv: 0.9 },
    ],
};
const metalRows = [];
for (let nm = 400; nm <= 900; nm += 10) {
    metalRows.push([nm, ...evaluateComplexDispersionModel(source, nm)]);
}
const metalFit = fitTabulatedMaterial(metalRows, { nModel: 'drude-lorentz' });
assert.ok(metalFit.residuals.n.rms < 1e-6, 'a genuine Drude-Lorentz material is recovered');
assert.ok(metalFit.residuals.k.rms < 1e-6, 'in k as well as n');
assert.ok(metalFit.complex.oscillators.length >= 1,
    'and the oscillators the data supports are kept');

// ── The coefficients are readable, since they are what gets computed ──────────

const shown = dispersionFitParameters(cauchy);
assert.equal(shown.parameters.length, cauchy.n.coefficients.length,
    'every Cauchy coefficient is listed');
assert.equal(shown.parameters[0].label, 'A0');
assert.match(shown.parameters[1].label, /µm/, 'and carries the units it is in');
assert.match(shown.formula, /λ in µm/, 'with the formula the coefficients sit in');

const sellmeierShown = dispersionFitParameters(sellmeier);
assert.equal(sellmeierShown.parameters.length, 1 + 2 * sellmeier.n.terms,
    'a Sellmeier fit lists its strength and pole per term');

const metalShown = dispersionFitParameters(metalFit);
assert.equal(metalShown.parameters.length, 3 + 3 * metalFit.complex.oscillators.length,
    'a metal fit lists the Drude term and three numbers per oscillator');
assert.ok(metalShown.parameters.every(parameter => Number.isFinite(parameter.value)));

console.log('PASS: dispersion_fit_terms');
