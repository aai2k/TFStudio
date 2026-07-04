/**
 * MF evaluation-mode tests (decoupling "what is optimized" from "how the MF is
 * scored"), 2026-05-29.
 *
 * design.mfEvalMode ∈ {'side','total'} only affects front_only / back_only:
 *   'side'  → single-surface MF (legacy)
 *   'total' → full-system MF (this side + substrate + the fixed opposite coating)
 * symmetric / both_independent are always full-system regardless.
 *
 * Checks:
 *  1. front_only+side ≠ front_only+total when a back coating exists (total
 *     actually folds in the back + substrate backside).
 *  2. front_only+total MF == both_independent MF for the SAME front+back stacks
 *     (same physical filter, same TMM) — the only difference between the two is
 *     which layers are free, which doesn't change the MF VALUE at a fixed point.
 *  3. back_only+total == both_independent MF likewise.
 *  4. Existing-design safety: with no mfEvalMode field, behavior == 'side'.
 *
 * Run: node tests/mf_eval_mode.mjs
 */

import {
    buildEvalContext, evaluateOperands, calcMF, makeOperand, isFullSystemEval,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const resolveMat = id => getMaterial(id);

const FRONT = [
    { id: 'F1', material: 'TiO2', thickness: 92,  locked: false },
    { id: 'F2', material: 'SiO2', thickness: 158, locked: false },
];
const BACK = [
    { id: 'B1', material: 'SiO2', thickness: 120, locked: false },
    { id: 'B2', material: 'TiO2', thickness: 70,  locked: false },
];

function design(surfaceMode, mfEvalMode) {
    const d = {
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 },
        frontLayers: FRONT.map(l => ({ ...l })),
        backLayers:  BACK.map(l => ({ ...l })),
        surfaceMode,
    };
    if (mfEvalMode !== undefined) d.mfEvalMode = mfEvalMode;
    return d;
}

const ops = [
    makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
    makeOperand({ type: 'TAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 1, weight: 1 }),
];

const mfOf = (d) => calcMF(ops, evaluateOperands(ops, buildEvalContext(d, resolveMat)));

// ── helper predicate ─────────────────────────────────────────────────────────
ok(isFullSystemEval('front_only', 'side')  === false, 'front_only+side  → single surface');
ok(isFullSystemEval('front_only', 'total') === true,  'front_only+total → full system');
ok(isFullSystemEval('back_only',  'total') === true,  'back_only+total  → full system');
ok(isFullSystemEval('symmetric',  'side')  === true,  'symmetric always full system');
ok(isFullSystemEval('both_independent', 'side') === true, 'both_independent always full system');

// ── values ─────────────────────────────────────────────────────────────────
const mfFrontSide  = mfOf(design('front_only', 'side'));
const mfFrontTotal = mfOf(design('front_only', 'total'));
const mfBackTotal  = mfOf(design('back_only',  'total'));
const mfBoth       = mfOf(design('both_independent', undefined));

console.log('MF front_only+side  =', mfFrontSide.toFixed(6));
console.log('MF front_only+total =', mfFrontTotal.toFixed(6));
console.log('MF back_only+total  =', mfBackTotal.toFixed(6));
console.log('MF both_independent =', mfBoth.toFixed(6));

// 1. total ≠ side (the back coating + substrate backside change the MF)
ok(Math.abs(mfFrontTotal - mfFrontSide) > 1e-4,
   `front_only total (${mfFrontTotal.toFixed(6)}) must differ from side (${mfFrontSide.toFixed(6)})`);

// 2/3. total (either side) == full-system MF for the identical front+back stacks.
ok(Math.abs(mfFrontTotal - mfBoth) < 1e-9,
   `front_only+total (${mfFrontTotal}) == both_independent (${mfBoth})`);
ok(Math.abs(mfBackTotal - mfBoth) < 1e-9,
   `back_only+total (${mfBackTotal}) == both_independent (${mfBoth})`);

// 4. Missing mfEvalMode field behaves as 'side' (existing designs unaffected).
const mfNoField = mfOf(design('front_only', undefined));
ok(Math.abs(mfNoField - mfFrontSide) < 1e-12,
   `front_only with no mfEvalMode (${mfNoField}) == explicit 'side' (${mfFrontSide})`);

if (fails === 0) { console.log('\nALL PASS'); process.exit(0); }
else { console.log(`\n${fails} FAIL(S)`); process.exit(1); }
