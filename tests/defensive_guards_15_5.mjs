/**
 * Defensive-guard regressions (D7 + D9).
 *
 * D7: BBM `simulateRun` must deposit NOTHING for a zero-thickness / deactivated
 *     front layer (previously the cut search ran on a 0-target layer and the
 *     confirmScans fallback could deposit spurious material).
 *
 * D9: `calcMF` must not let a single non-finite operand residual poison the
 *     whole merit function. A NaN/Inf from one operand (dispersion pole, missing
 *     material, cyclic math operand) previously propagated to Math.sqrt(NaN) →
 *     the entire MF became NaN, silently breaking every optimizer. Such an
 *     operand now makes the MF Infinity, which every accept test rejects.
 *
 * Run: node tests/defensive_guards_15_5.mjs
 */

import { simulateRun } from '../src/utils/monitoring/monitoringSim.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { calcMF } from '../src/utils/physics/optimizer/evalCore.js';
import { makeOperand } from '../src/utils/physics/optimizer/operandModel.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const resolveMat = (id) => getMaterial(id) || getMaterial('Air');

// ── D7: zero-thickness layer deposits nothing ────────────────────────────────
{
    const design = {
        id: 'z', name: 'zero-mid', referenceWavelength: 550,
        substrate: { material: 'BK7', thickness: 1.0 },
        incidentMedium: 'Air', exitMedium: 'Air',
        frontLayers: [
            { id: 'L1', material: 'TiO2', thickness: 60, locked: false },
            { id: 'L2', material: 'SiO2', thickness: 0,  locked: false }, // deactivated
            { id: 'L3', material: 'TiO2', thickness: 80, locked: false },
        ],
        backLayers: [], surfaceMode: 'front_only',
        meritOperands: [{ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1, enabled: true }],
    };
    const cfg = {
        rates: new Map([['TiO2', { mean: 0.5, sigma: 0 }], ['SiO2', { mean: 0.5, sigma: 0 }]]),
        sigmaReN: 0, sigmaImN: 0, sigmaThkAbsNm: 0, sigmaThkRelPct: 0,
        mon: { char: 'T', theta: 0, polarization: 'avg', lambdaStart: 400, lambdaEnd: 800, nPoints: 21, scanIntervalSec: 0.4 },
        sig: { randomPct: 0, driftPctPer1000s: 0 },
        rng: makeRng(1234),
    };
    const res = simulateRun(design, resolveMat, cfg);
    ok(res.asBuiltFront[1] === 0, `D7: zero-thickness layer deposits nothing (got ${res.asBuiltFront[1]} nm)`);
    ok(res.asBuiltFront[0] > 0 && res.asBuiltFront[2] > 0, `D7: neighbours still deposit (got ${res.asBuiltFront[0]}, ${res.asBuiltFront[2]})`);
    ok(res.cutTimes[1] === 0, `D7: zero layer has zero cut time (got ${res.cutTimes[1]})`);
}

// ── D9: a NaN operand value must not poison the MF ───────────────────────────
// The MF is never NaN. A non-finite operand makes it Infinity, which every
// accept test rejects, rather than being skipped: skipping it would also drop
// its weight and report a merit better than the design.
{
    const opGood = makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 });
    const opBad  = makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 });
    // calcMF(operands, computed, opts): computed is the per-operand value array.
    const mfClean = calcMF([opGood], [0.5]);
    const mfWithNaN = calcMF([opGood, opBad], [0.5, NaN]);
    const mfWithInf = calcMF([opGood, opBad], [0.5, Infinity]);
    ok(mfWithNaN === Infinity, `D9: MF is Infinity, not NaN, when one operand is NaN (got ${mfWithNaN})`);
    ok(mfWithInf === Infinity, `D9: MF is Infinity when one operand is Inf (got ${mfWithInf})`);
    ok(mfWithNaN > mfClean, `D9: the NaN operand is not skipped (${mfWithNaN} vs clean ${mfClean})`);
}

if (fails === 0) { console.log('PASS — D7 zero-thickness + D9 NaN-guard regressions.'); process.exit(0); }
else { console.error(`\n${fails} assertion(s) failed.`); process.exit(1); }
