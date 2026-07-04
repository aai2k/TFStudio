/**
 * Qualifier → MF unit-consistency tests.
 *
 * The MFE displays T/R/A operands in PERCENT (TAV target 0.99 → "99.00") but
 * historically displayed math operands (OPGT/OPLT/…) RAW (target 0.99 → "0.99")
 * even when the referenced row was optical. That mismatch confused users
 * generating MF from the Specification window's BBAR preset.
 *
 * Tests:
 *   • mathTargetInPercent(OPGT-on-TAV) === true
 *   • mathTargetInPercent(OPGT-on-MXWT) === false  (argwave ref → raw nm)
 *   • mathTargetInPercent(OPGT-on-MNT)  === false  (constraint ref → raw nm)
 *   • mathTargetInPercent(DIFF-of-two-TAVs) === true
 *   • mathTargetInPercent(DIFF-of-TAV-and-MNT) === false (mixed → raw)
 *
 * Plus qualifier → MF generation:
 *   • BBAR_VIS preset emits exactly TAV(weight=0) + OPGT(weight>0)
 *     and RAV(weight=0) + OPLT(weight>0).
 *   • OPGT target equals q.target (0.99 — the fraction, math-internal unit).
 *   • Base operand target = q.target (so MFE delta is meaningful).
 *
 * Plus residual:
 *   • calcMF with all weights = 0 returns 0 (not NaN).
 */

import { applyPreset }                  from '../src/utils/synthesis/qualifierPresets.js';
import { qualifiersToMFOperands }       from '../src/utils/synthesis/qualifiers.js';
import {
    mathTargetInPercent, isFractionalUnit,
    isMath, isMathSingleRef,
    calcMF, makeOperand, makeConstraintOperand,
} from '../src/utils/physics/optimizer.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;

// ── 1. isFractionalUnit covers the right types ────────────────────────────
console.log('— isFractionalUnit —');
{
    for (const t of ['T', 'R', 'A', 'TS', 'TP', 'RS', 'RP',
                     'TAV', 'RAV', 'AAV',
                     'TIW', 'RIW', 'AIW',
                     'TMN', 'TMX', 'RMN', 'RMX', 'AMN', 'AMX']) {
        ok(isFractionalUnit(t) === true, `${t} is fractional`);
    }
    for (const t of ['MNT', 'MXT',                       // constraints (nm)
                     'MXWT', 'MNWT', 'MXWR', 'MNWR',     // argwave (nm)
                     'OPGT', 'OPLT', 'OPVA', 'ABSO',     // math
                     'DIFF', 'SUMM', 'PROD']) {
        ok(isFractionalUnit(t) === false, `${t} is NOT fractional`);
    }
}

// ── 2. mathTargetInPercent: OPGT on TAV → percent ─────────────────────────
console.log('— mathTargetInPercent —');
{
    const base = makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 700, target: 0 });
    const opgt = makeOperand({ type: 'OPGT', refId: base.id, target: 0.99 });
    const byId = new Map([[base.id, base], [opgt.id, opgt]]);
    ok(mathTargetInPercent(opgt, byId) === true,
       'OPGT pointing at TAV → percent');
}

// ── 3. mathTargetInPercent: OPGT on argwave (MXWT) → raw ─────────────────
{
    const mxwt = makeOperand({ type: 'MXWT', lambdaStart: 400, lambdaEnd: 700, target: 550 });
    const opgt = makeOperand({ type: 'OPGT', refId: mxwt.id, target: 545 });
    const byId = new Map([[mxwt.id, mxwt], [opgt.id, opgt]]);
    ok(mathTargetInPercent(opgt, byId) === false,
       'OPGT pointing at MXWT → raw nm');
}

// ── 4. mathTargetInPercent: OPGT on MNT constraint → raw ──────────────────
{
    const mnt  = makeConstraintOperand({ type: 'MNT', layerStart: 1, layerEnd: 1, target: 15 });
    const opgt = makeOperand({ type: 'OPGT', refId: mnt.id, target: 20 });
    const byId = new Map([[mnt.id, mnt], [opgt.id, opgt]]);
    ok(mathTargetInPercent(opgt, byId) === false,
       'OPGT pointing at MNT → raw');
}

// ── 5. mathTargetInPercent: DIFF of two TAVs → percent ────────────────────
{
    const a = makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 500, target: 0 });
    const b = makeOperand({ type: 'TAV', lambdaStart: 500, lambdaEnd: 700, target: 0 });
    const d = makeOperand({ type: 'DIFF', refId1: a.id, refId2: b.id, target: 0.02 });
    const byId = new Map([[a.id, a], [b.id, b], [d.id, d]]);
    ok(mathTargetInPercent(d, byId) === true,
       'DIFF of two optical refs → percent');
}

// ── 6. mathTargetInPercent: DIFF of TAV + MNT → raw (mixed) ───────────────
{
    const tav = makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 700, target: 0 });
    const mnt = makeConstraintOperand({ type: 'MNT', layerStart: 1, layerEnd: 1, target: 15 });
    const d   = makeOperand({ type: 'DIFF', refId1: tav.id, refId2: mnt.id, target: 50 });
    const byId = new Map([[tav.id, tav], [mnt.id, mnt], [d.id, d]]);
    ok(mathTargetInPercent(d, byId) === false,
       'DIFF of mixed refs → raw (conservative)');
}

// ── 7. mathTargetInPercent: no operandsById → false ───────────────────────
{
    const opgt = makeOperand({ type: 'OPGT', refId: 'nonexistent', target: 0.99 });
    ok(mathTargetInPercent(opgt, new Map()) === false,
       'unresolvable ref → raw (safe fallback)');
    ok(mathTargetInPercent(opgt, null) === false,
       'null operandsById → false');
}

// ── 8. BBAR preset → base operands have weight=0, math operands have weight>0 ─
console.log('— qualifiersToMFOperands(BBAR_VIS) —');
{
    const items = applyPreset('BBAR_VIS');
    ok(items.length >= 2, 'BBAR_VIS yields at least 2 qualifiers');

    const ops = qualifiersToMFOperands(items);
    const types = ops.map(o => o.type);
    ok(types.includes('TAV') && types.includes('OPGT'),
       'TAV + OPGT pair emitted (ge spec)');
    ok(types.includes('RAV') && types.includes('OPLT'),
       'RAV + OPLT pair emitted (le spec)');

    const tav  = ops.find(o => o.type === 'TAV');
    const opgt = ops.find(o => o.type === 'OPGT' && o.refId === tav.id);
    ok(opgt, 'OPGT references the TAV base operand by id');
    ok(tav.weight === 0,                 'TAV base weight = 0 (inert)');
    ok(opgt.weight > 0,                  'OPGT carries the spec weight');
    ok(near(tav.target, 0.99),           'TAV base target = q.target (for display)');
    ok(near(opgt.target, 0.99),
       'OPGT target = q.target (math-internal fraction)');

    const rav  = ops.find(o => o.type === 'RAV');
    const oplt = ops.find(o => o.type === 'OPLT' && o.refId === rav.id);
    ok(oplt, 'OPLT references the RAV base operand');
    ok(rav.weight === 0,                 'RAV base weight = 0 (inert)');
    ok(oplt.weight > 0,                  'OPLT carries the spec weight');
    ok(near(rav.target, 0.01),           'RAV base target = q.target');
    ok(near(oplt.target, 0.01),          'OPLT target = q.target');
}

// ── 9. Math target on round-trip OPGT-on-TAV (after generation) ───────────
{
    const items = applyPreset('BBAR_VIS');
    const ops = qualifiersToMFOperands(items);
    const byId = new Map(ops.map(o => [o.id, o]));
    const opgt = ops.find(o => o.type === 'OPGT');
    ok(mathTargetInPercent(opgt, byId),
       'generated OPGT → mathTargetInPercent = true (display in %)');
    // What the MFE will SHOW in the target cell: 99.00, not 0.99.
    const shown = (opgt.target * 100).toFixed(2);
    ok(shown === '99.00', `OPGT displayed target = ${shown} (expected 99.00)`);
}

// ── 10. calcMF guard: all-zero-weight returns 0, not NaN ──────────────────
console.log('— calcMF guards —');
{
    const a = makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 700, target: 0.5, weight: 0 });
    const mf = calcMF([a], [0.7]);
    ok(mf === 0, `all-zero-weight calcMF = ${mf} (expected 0)`);
    ok(Number.isFinite(mf), 'all-zero-weight calcMF is finite (not NaN)');
}

// ── 11. calcMF with mixed zero + non-zero weight ──────────────────────────
{
    const tav   = makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 700, target: 0.99, weight: 0 });
    const opgt  = makeOperand({ type: 'OPGT', refId: tav.id, target: 0.99, weight: 1 });
    // Pretend the TAV measured 0.97 (below spec) — the OPGT residual is 0.02.
    const comp = [0.97, 0.97];   // both rows have computed value = 0.97
    const mf = calcMF([tav, opgt], comp);
    // Only the OPGT contributes: sumW=1, sumWRes2 = 1*(0.99-0.97)² = 4e-4
    // → MF = sqrt(4e-4) = 0.02
    ok(near(mf, 0.02, 1e-9),
       `OPGT-only MF = ${mf} (expected 0.02 — base TAV inert with weight=0)`);
}

if (fails) {
    console.error(`\n${fails} test(s) FAILED`);
    process.exit(1);
}
console.log('\nAll tests passed.');
