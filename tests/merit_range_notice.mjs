/**
 * The material-range check the optimizer windows make: operandWavelengthSpan
 * (utils/physics/optimizer/sampling.js) applied through designRangeCoverage.
 *
 * The analysis windows check a plot axis. An optimizer has none, so the span it
 * checks is the hull of every wavelength the enabled operands sample, taken
 * from the same derivation a run evaluates on. The case that raised it was a
 * three-band AR at 400-700, 900-1700 and 3500-4950 nm in TiO2/SiO2 on BK7: the
 * built-in TiO2 table ends at 827 nm and BK7 at 2500 nm, so most of the run
 * scored a constant index and nothing on screen said so.
 */
import assert from 'node:assert/strict';
import {
    makeConstraintOperand, makeDmfsOperand, makeOperand, operandWavelengthSpan,
} from '../src/utils/physics/optimizer.js';
import { designRangeCoverage } from '../src/utils/materials/materialRange.js';
import { initCatalogs } from '../src/utils/materials/catalogManager.js';

const band = (type, lambdaStart, lambdaEnd, extra = {}) =>
    makeOperand({ type, lambdaStart, lambdaEnd, target: 0.01, ...extra });

// ── operandWavelengthSpan: which rows hold a wavelength at all ──────────────
{
    assert.equal(operandWavelengthSpan([]), null, 'no operands, no span');

    // A thickness constraint's λ pair is a layer range, 1 to 1000 by default,
    // and must not read as 1–1000 nm. The others carry no wavelength either.
    const noWavelength = [
        makeConstraintOperand({ type: 'MNT', target: 10 }),
        makeConstraintOperand({ type: 'MXT', lambdaStart: 1, lambdaEnd: 40, target: 300 }),
        makeOperand({ type: 'TT', cmp: 'le', target: 2000 }),
        makeOperand({ type: 'BLNK', comment: 'note' }),
        makeDmfsOperand('wizard block'),
        makeOperand({ type: 'OPGT', refId: 'some-row', target: 0.5 }),
    ];
    assert.equal(operandWavelengthSpan(noWavelength), null,
        'constraints, thickness, comments and row references contribute no wavelength');

    const single = operandWavelengthSpan([makeOperand({ type: 'R', lambdaStart: 550, lambdaEnd: 900 })]);
    assert.deepEqual(single, [550, 550],
        'a single-wavelength row contributes λ Start only; a stale λ End is not read');

    assert.deepEqual(operandWavelengthSpan([band('RAV', 400, 700)]), [400, 700],
        'a band row contributes both ends');
    assert.deepEqual(operandWavelengthSpan([band('RAV', 700, 400)]), [400, 700],
        'a band typed high to low still spans the same wavelengths');
    assert.deepEqual(operandWavelengthSpan([band('TIW', 380, 780)]), [380, 780],
        'an integral row samples the band its preset set');
}

// ── The hull over several bands, and what is left out of it ─────────────────
{
    const threeBand = [band('RAV', 400, 700), band('RAV', 900, 1700), band('RAV', 3500, 4950)];
    assert.deepEqual(operandWavelengthSpan(threeBand), [400, 4950],
        'several bands give one hull; a material range is an interval, so a gap cannot hide a shortfall');

    const mwirOff = [band('RAV', 400, 700), band('RAV', 900, 1700), band('RAV', 3500, 4950, { enabled: false })];
    assert.deepEqual(operandWavelengthSpan(mwirOff), [400, 1700], 'a disabled row is not sampled and not counted');

    const measured = makeOperand({
        type: 'MCURVE', sampleLambdas: [450, 500, 650], sampleTargets: [0.1, 0.1, 0.1], quantity: 'R',
    });
    assert.deepEqual(operandWavelengthSpan([measured]), [450, 650],
        'a measured block spans its own stored grid');

    const withBadRow = [band('RAV', 400, 700), makeOperand({ type: 'R', lambdaStart: Number.NaN })];
    assert.deepEqual(operandWavelengthSpan(withBadRow), [400, 700],
        'a row whose wavelength is not a number is left out rather than poisoning the hull');
}

// ── Against the built-in materials: the case that raised the item ───────────
initCatalogs({});

const design = (meritOperands) => ({
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'builtin:BK7', thickness: 1 },
    frontLayers: [
        { material: 'builtin:TiO2', thickness: 100 },
        { material: 'builtin:SiO2', thickness: 90 },
    ],
    backLayers: [],
    meritOperands,
});
const coverage = (meritOperands) =>
    designRangeCoverage(design(meritOperands), operandWavelengthSpan(meritOperands));

{
    const threeBand = coverage([band('RAV', 400, 700), band('RAV', 900, 1700), band('RAV', 3500, 4950)]);
    assert.deepEqual(threeBand.offenders.map(item => item.id), ['builtin:BK7', 'builtin:TiO2'],
        'the substrate and the high-index film run out of data; SiO2 covers the whole span');
    const tio2 = threeBand.offenders.find(item => item.id === 'builtin:TiO2');
    assert.equal(Math.round(tio2.rangeNm[0]), 370, 'TiO2 is reported with the start of its table');
    assert.equal(Math.round(tio2.rangeNm[1]), 827, 'and the end of it');
    const bk7 = threeBand.offenders.find(item => item.id === 'builtin:BK7');
    assert.deepEqual(bk7.rangeNm, [300, 2500], 'BK7 is reported with its declared Sellmeier range');

    const visible = coverage([band('RAV', 400, 700)]);
    assert.equal(visible.offenders.length, 0, 'targets inside every material raise nothing');

    const mwirOff = coverage([band('RAV', 400, 700), band('RAV', 900, 1700), band('RAV', 3500, 4950, { enabled: false })]);
    assert.deepEqual(mwirOff.offenders.map(item => item.id), ['builtin:TiO2'],
        'disabling the MWIR band clears BK7 and leaves TiO2, whose table ends inside the SWIR band');

    const constraintsOnly = coverage([makeConstraintOperand({ type: 'MNT', target: 10 })]);
    assert.equal(constraintsOnly.offenders.length, 0,
        'a merit function with no spectral operand has no span to check');
}

console.log('merit_range_notice: passed');
