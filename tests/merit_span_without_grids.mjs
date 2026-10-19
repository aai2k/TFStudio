/**
 * The wavelength span of a merit function (wavelengthSpan.js operandWavelengthSpan),
 * which the material range notice beside the merit tables and the synthesis
 * half-wave span read, comes from the ends of the rows' grids without building
 * them. It is bit for bit the lowest and highest wavelength of the grids the
 * optimizer samples (requiredLambdas), for every kind of row, and it stays
 * quick for a row at the finest Step, whose grid has a million samples.
 *
 * Run: node tests/merit_span_without_grids.mjs
 */
import assert from 'node:assert/strict';
import { makeOperand, operandWavelengthSpan, requiredLambdas } from '../src/utils/physics/optimizer.js';

const row = (type, fields) => makeOperand({ type, aoi: 0, pol: 'avg', target: 0.5, weight: 1, ...fields });
// The span the optimizer's own grids give: their lowest and highest finite
// wavelength.
const gridSpan = ops => {
    const lambdas = requiredLambdas(ops).filter(Number.isFinite);
    if (!lambdas.length) return null;
    return [lambdas.reduce((a, b) => Math.min(a, b)), lambdas.reduce((a, b) => Math.max(a, b))];
};

const CASES = {
    'a band average at a fine Step': [row('TAV', { lambdaStart: 400.3, lambdaEnd: 1599.7, flag: 3 })],
    'a band average with a stamped count': [row('RAV', { lambdaStart: 412.37, lambdaEnd: 687.11, bandPoints: 777 })],
    // Bands where the grid's arithmetic alone lands one unit in the last place
    // off the end: start + (range * 243) / 243, and start + range in the next.
    'a band average whose arithmetic misses its end': [row('TAV', { lambdaStart: 417.96, lambdaEnd: 1348.05, bandPoints: 244 })],
    'a range target whose arithmetic misses its end': [row('TGT', { lambdaStart: 992.488, lambdaEnd: 445.309, rampPoints: 51 })],
    // Ends that are not numbers, read as the grids read them.
    'a band average with no end': [row('TAV', { lambdaStart: 500, lambdaEnd: undefined })],
    'a peak row with no end': [row('TMX', { lambdaStart: 500, lambdaEnd: null })],
    'a dip row whose end is not a number': [row('TMN', { lambdaStart: 500, lambdaEnd: NaN })],
    'a peak wavelength row with an endless band': [row('MXWR', { lambdaStart: 1119.437, lambdaEnd: Infinity, target: 1200 })],
    'a range target drawn high to low': [row('TGT', { lambdaStart: 700.9, lambdaEnd: 401.3, flag: 2 })],
    'a range target with a stamped count': [row('RGT', { lambdaStart: 433.3, lambdaEnd: 655.55, rampPoints: 333, target: 0.1, targetEnd: 0.9 })],
    'an integral': [row('TIW', { lambdaStart: 380.1, lambdaEnd: 780.7, presetKey: 'Tvis' })],
    'a flatness row': [row('GDFLAT', { lambdaStart: 1530.1, lambdaEnd: 1565.9, flag: 3, target: 0 })],
    'a peak row': [row('TMX', { lambdaStart: 530.4, lambdaEnd: 590.4, flag: 3 })],
    'a peak wavelength row drawn high to low': [row('MXWT', { lambdaStart: 590.37, lambdaEnd: 530.41, target: 550 })],
    'a row at one wavelength': [row('T', { lambdaStart: 1064.3 })],
    'a measured curve': [{ ...row('MCURVE', {}), quantity: 'R', sampleLambdas: [612.5, 455.25, 1710.75], sampleTargets: [0.1, 0.1, 0.1] }],
    'an old OPGT that names its base type': [{ ...row('OPGT', { lambdaStart: 423.17, lambdaEnd: 611.83 }), baseType: 'TAV', refId: null }],
    'a math row reading another row': [row('OPGT', { refId: 'other', lambdaStart: 10, lambdaEnd: 20 })],
    'a layer-thickness row': [row('MNT', { lambdaStart: 1, lambdaEnd: 4, target: 25 })],
};
const all = Object.values(CASES).flat();
const disabled = row('TAV', { lambdaStart: 200, lambdaEnd: 300, enabled: false });

// Compared as numbers are compared here, Object.is, so a difference in the last
// place shows.
for (const [name, ops] of Object.entries(CASES)) {
    assert.deepEqual(operandWavelengthSpan(ops), gridSpan(ops), `${name}: the span is the grids' own ends`);
}
assert.deepEqual(operandWavelengthSpan([...all, disabled]), gridSpan(all), 'all of them together, a disabled row left out');
assert.equal(operandWavelengthSpan(CASES['a layer-thickness row']), null, 'a merit function sampling no wavelength has no span');

// A band grid ends on its band's end itself, so where a band ends on the last
// wavelength a material covers, every Step reads inside the material's data.
for (const name of ['a band average whose arithmetic misses its end', 'a range target whose arithmetic misses its end']) {
    const [op] = CASES[name];
    const lambdas = requiredLambdas([op]);
    assert.ok(lambdas.includes(op.lambdaEnd) && lambdas.includes(op.lambdaStart), `${name}: its grid holds both ends exactly`);
}

const finest = [row('TAV', { lambdaStart: 400, lambdaEnd: 1600, flag: 4 }), row('TMX', { lambdaStart: 400, lambdaEnd: 1600, flag: 4 })];
const started = performance.now();
const span = operandWavelengthSpan(finest);
const took = performance.now() - started;
assert.deepEqual(span, [400, 1600], 'rows at the finest Step span their band');
assert.ok(took < 50, `without building their grids: ${took.toFixed(1)} ms`);

console.log('PASS: merit_span_without_grids');
