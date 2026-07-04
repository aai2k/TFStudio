/**
 * Diagnostic — does CENTRAL_LAMBDA qualifier really agree with MXWT operand
 * for a 6-layer AR design on 400–700 nm?
 *
 * Reproduces the configuration the user described:
 *   "central lambda  516.00 nm in spec, MXWT  580.58"
 *
 * We try several plausible 6-layer Ta2O5/SiO2 AR stacks and print both paths.
 * If they ever differ, we report which params produced the divergence so we
 * can find the bug.
 */

import {
    makeOperand, evaluateOperands, buildEvalContext,
    operandSampleLambdas, ARGWAVE_DEFAULT_POINTS,
} from '../src/utils/physics/optimizer.js';
import {
    makeQualifier, evaluateQualifier,
} from '../src/utils/synthesis/qualifiers.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const resolveMat = id => getMaterial(id);

// A few plausible 6-layer AR stacks for 500-700 nm.  We don't know the user's
// exact thicknesses, so we try several typical ones.
const CANDIDATES = [
    { name: '6L AR (HL × 3)',
      layers: [
        ['Ta2O5', 80], ['SiO2', 130],
        ['Ta2O5', 60], ['SiO2', 110],
        ['Ta2O5', 90], ['SiO2', 95],
      ]},
    { name: '6L AR (varied)',
      layers: [
        ['Ta2O5', 110], ['SiO2', 95 ],
        ['Ta2O5', 65 ], ['SiO2', 140],
        ['Ta2O5', 80 ], ['SiO2', 92 ],
      ]},
    { name: '6L AR (sym)',
      layers: [
        ['SiO2', 95], ['Ta2O5', 60],
        ['SiO2', 130], ['Ta2O5', 60],
        ['SiO2', 130], ['Ta2O5', 80],
      ]},
];

function buildDesign(layerSpec) {
    return {
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 },
        frontLayers: layerSpec.map(([mat, d], i) => ({
            id: `L${i+1}`, material: mat, thickness: d, locked: false,
        })),
        backLayers: [],
        surfaceMode: 'front_only',
    };
}

const PARAM_VARIANTS = [
    { aoi: 0,  pol: 'avg', dir: 'max', channel: 'T' },
    { aoi: 0,  pol: 's',   dir: 'max', channel: 'T' },
    { aoi: 0,  pol: 'p',   dir: 'max', channel: 'T' },
    { aoi: 15, pol: 'avg', dir: 'max', channel: 'T' },
    { aoi: 0,  pol: 'avg', dir: 'min', channel: 'T' },   // notch = MNWT
    { aoi: 0,  pol: 'avg', dir: 'max', channel: 'R' },   // MXWR
];

function argwaveType(direction, ch /*, pol */) {
    // Pol is carried by op.pol now, not the type code (S/P variants removed).
    return (direction === 'min' ? 'MNW' : 'MXW') + ch;
}

let mismatch = 0;
console.log(`ARGWAVE_DEFAULT_POINTS = ${ARGWAVE_DEFAULT_POINTS}\n`);

for (const cand of CANDIDATES) {
    const design = buildDesign(cand.layers);
    const ctx = buildEvalContext(design, resolveMat);
    console.log(`=== ${cand.name} ===`);

    for (const v of PARAM_VARIANTS) {
        // Spec path
        const q = makeQualifier({
            kind: 'CENTRAL_LAMBDA',
            channel: v.channel, direction: v.dir,
            cmp: 'eq', target: 550, tol: 5,
            lambdaStart: 400, lambdaEnd: 700,
            aoi: v.aoi, pol: v.pol,
        });
        const rQ = evaluateQualifier(q, design, resolveMat);

        // Operand path (mirrors what the qualifier internally builds)
        const opType = argwaveType(v.dir, v.channel, v.pol);
        const op = makeOperand({
            type: opType, lambdaStart: 400, lambdaEnd: 700,
            aoi: v.aoi, pol: v.pol, target: 550, weight: 1,
        });
        const opVal = evaluateOperands([op], ctx)[0];

        const lams = operandSampleLambdas(op);
        const same = rQ.value === opVal;

        console.log(
            `  ${opType.padEnd(6)} aoi=${String(v.aoi).padStart(2)} pol=${v.pol.padEnd(3)} ` +
            `dir=${v.dir.padEnd(3)} | spec=${rQ.value.toFixed(3)} op=${opVal.toFixed(3)} ` +
            `Δ=${(rQ.value - opVal).toExponential(2).padStart(9)} N=${lams.length} ${same ? '✓' : '✗'}`
        );
        if (!same) {
            mismatch++;
            // Dump operand details for diagnosis
            console.log(`    OPERAND: bandPoints=${op.bandPoints}, target=${op.target}`);
            console.log(`    QUALIFIER: bandPoints=${q.bandPoints}, target=${q.target}`);
        }
    }
}

if (mismatch === 0) {
    console.log('\n✓ All Specification CENTRAL_LAMBDA results match MXWT/MNW* operand bit-identically.');
    console.log('  If the user still sees a discrepancy in the app, the two operands have');
    console.log('  different parameters (AOI, pol, channel, lambdaStart, lambdaEnd, or direction).');
} else {
    console.error(`\n✗ ${mismatch} mismatches — there is a real bug in one of the code paths.`);
    process.exit(1);
}
