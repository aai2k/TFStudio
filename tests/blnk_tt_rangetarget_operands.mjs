/**
 * Tests for the operand-model changes:
 *   • BLNK  — inert comment operand (value null, zero MF contribution)
 *   • TT    — total physical thickness of all layers (nm), equality target
 *   • TGT/RGT/AGT — continuous per-λ spectral target (flat or linear ramp),
 *                   merit = RMS deviation from the target line
 *   • TAV/RAV — pure band AVERAGE (single target); targetEnd is IGNORED
 *               (no more "50→50" ramp on range-average types)
 */

import {
    makeOperand, evaluateOperands, calcMF, buildEvalContext,
    operandSampleLambdas, isRangeTarget, isBlank, isTotalThickness, isRamp,
    OPERAND_TYPES,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const resolveMat = id => getMaterial(id);
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// A simple 3-layer design on BK7.
const design = {
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [
        { id: 'L1', material: 'Ta2O5', thickness: 100, locked: false },
        { id: 'L2', material: 'SiO2',  thickness: 150, locked: false },
        { id: 'L3', material: 'Ta2O5', thickness:  80, locked: false },
    ],
    backLayers: [],
    surfaceMode: 'front_only',
};
const ctx = buildEvalContext(design, resolveMat);

// ── Type registry / helper sanity ────────────────────────────────────────────
ok(OPERAND_TYPES.includes('BLNK'), 'BLNK registered');
ok(OPERAND_TYPES.includes('TT'),   'TT registered');
ok(['TGT','RGT','AGT'].every(t => OPERAND_TYPES.includes(t)), 'TGT/RGT/AGT registered');
ok(!OPERAND_TYPES.includes('MXWTS'), 'S/P argwave variant MXWTS removed');
ok(isBlank('BLNK') && isTotalThickness('TT'), 'isBlank / isTotalThickness helpers');
ok(isRangeTarget('RGT') && !isRangeTarget('RAV'), 'isRangeTarget true for RGT, false for RAV');
ok(isRamp(makeOperand({ type: 'TGT' })) && !isRamp(makeOperand({ type: 'TAV' })),
   'isRamp true for TGT, false for TAV');

// ── BLNK is inert ─────────────────────────────────────────────────────────────
{
    const blnk = makeOperand({ type: 'BLNK', comment: 'hello' });
    ok(operandSampleLambdas(blnk).length === 0, 'BLNK samples no λ');
    const rav = makeOperand({ type: 'RAV', lambdaStart: 400, lambdaEnd: 700, target: 0.01, weight: 1 });
    const mfWith    = calcMF([rav, blnk], evaluateOperands([rav, blnk], ctx));
    const mfWithout = calcMF([rav],       evaluateOperands([rav],       ctx));
    ok(close(mfWith, mfWithout), 'BLNK does not change MF');
}

// ── TT = total thickness (nm) ─────────────────────────────────────────────────
{
    const tt = makeOperand({ type: 'TT', target: 300, weight: 1 });
    const v  = evaluateOperands([tt], ctx)[0];
    ok(close(v, 330), `TT = Σ thicknesses = 330 nm (got ${v})`);
    // equality residual vs target 330 → MF 0; vs 300 → 30
    ok(close(calcMF([makeOperand({ type: 'TT', target: 330 })], [330]), 0), 'TT MF=0 when on target');
    ok(close(calcMF([makeOperand({ type: 'TT', target: 300 })], [330]), 30), 'TT MF = |Σd − target|');
    // TT is excluded from synthesis MF (skipConstraints)
    ok(close(calcMF([makeOperand({ type: 'TT', target: 300 })], [330], { skipConstraints: true }), 0),
       'TT skipped under skipConstraints (synthesis scan)');
}

// ── TGT/RGT continuous target: flat + ramp ────────────────────────────────────
{
    // Flat R target 0% over the band → merit = RMS(R) over the band.
    const rgtFlat = makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700, pol: 'avg', target: 0, weight: 1 });
    ok(rgtFlat.targetEnd === 0, 'fresh RGT defaults to a FLAT target (targetEnd = target)');
    const vFlat = evaluateOperands([rgtFlat], ctx)[0];
    ok(vFlat >= 0, `RGT flat returns a non-negative RMS deviation (got ${vFlat.toFixed(5)})`);
    // calcMF of a range-target = its computed value (the RMS) directly
    ok(close(calcMF([rgtFlat], [vFlat]), vFlat), 'range-target MF == its RMS value');

    // Ramp T target 0→100% — sampled grid endpoints span the band.
    const tgt = makeOperand({ type: 'TGT', lambdaStart: 400, lambdaEnd: 700, pol: 'avg', target: 0, targetEnd: 1, rampPoints: 11 });
    const lams = operandSampleLambdas(tgt);
    ok(lams.length === 11 && close(lams[0], 400) && close(lams[10], 700), 'TGT samples rampPoints across band');
    const vRamp = evaluateOperands([tgt], ctx)[0];
    ok(Number.isFinite(vRamp) && vRamp >= 0, `TGT ramp returns finite RMS deviation (got ${vRamp.toFixed(5)})`);
}

// ── TAV ignores targetEnd (pure average, item 3) ──────────────────────────────
{
    const lamA = 400, lamB = 700;
    const tavPlain = makeOperand({ type: 'TAV', lambdaStart: lamA, lambdaEnd: lamB, pol: 'avg', target: 0.5 });
    const tavWithEnd = makeOperand({ type: 'TAV', lambdaStart: lamA, lambdaEnd: lamB, pol: 'avg', target: 0.5, targetEnd: 0.9 });
    const vPlain   = evaluateOperands([tavPlain],   ctx)[0];
    const vWithEnd = evaluateOperands([tavWithEnd], ctx)[0];
    ok(close(vPlain, vWithEnd), 'TAV ignores targetEnd → identical band average regardless of targetEnd');
    // Both equal the simple mean of T over the AVG_POINTS grid.
    ok(vPlain > 0 && vPlain < 1, `TAV value is a band average in (0,1): ${vPlain.toFixed(4)}`);
}

if (fails === 0) console.log('\nAll BLNK / TT / range-target / TAV-average tests passed.');
else { console.error(`\n${fails} test(s) failed.`); process.exit(1); }
