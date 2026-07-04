/**
 * H10 regression — Monte-Carlo error analysis must perturb the RIGHT layer.
 *
 * Three per-layer arrays were on two different index spaces: the Δn/Δk/Δd DRAWS
 * were indexed by the UNFILTERED layer list, but the material lookup was indexed
 * by the thickness>0-FILTERED list. Any 0 nm layer therefore shifted every
 * subsequent layer's draw by one — a layer received the deviation drawn for the
 * 0 nm layer before it (bit-exact wrong spectrum, while the trial inspector
 * still reported the intended draw).
 *
 * Deterministic reproduction of the report's case  [A 0 nm, B(=A duplicate) … ,
 * C 100 nm]: with a 'uniform' distribution sampleDeviation is linear in rng()
 * and consumes exactly one rng() per (level>0) draw. With thickness error off
 * and Im(n) error off, only the two Re(n) draws consume the rng, in layer order.
 * Feeding rng = [1.0, 0.0] makes the 0 nm layer's draw +Δ and the 100 nm
 * layer's OWN draw −Δ. The physically-evaluated spectrum (only the 100 nm layer
 * matters) must reflect n = nC − Δ (its own draw), NOT n = nC + Δ (the 0 nm
 * layer's draw the pre-fix code applied).
 *
 * Run: node tests/error_analysis_index_alignment.mjs
 */

import { runErrorAnalysisMC } from '../src/utils/physics/errorAnalysis.js';
import { evaluateSpectrum }   from '../src/utils/physics/thinFilmMath.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } else { console.log('  ✓', msg); } };

// Constant (non-dispersive) materials keyed by id.
const constMat = (n, k = 0) => ({ getNK: () => [n, k] });
const MATS = {
    Air: constMat(1.0),
    Sub: constMat(1.52),
    A:   constMat(2.0),   // the 0 nm layer (must not lend its draw to C)
    C:   constMat(4.0),   // the 100 nm layer under test
};
const resolveMat = (id) => MATS[id];

const design = {
    frontLayers: [
        { material: 'A', thickness: 0 },     // 0 nm — the index-shifting culprit
        { material: 'C', thickness: 100 },   // the only physically-present layer
    ],
    backLayers: [],
    incidentMedium: 'Air',
    exitMedium:     'Air',
    substrate: { material: 'Sub', thickness: 1.0 },
};
const params = { lambdaStart: 500, lambdaEnd: 600, lambdaStep: 50, theta: 0, polarization: 's' };

// Deterministic rng: first draw (layer A, idx 0) → +Δ, second (layer C, idx 1) → −Δ.
const seq = [1.0, 0.0];
let k = 0;
const rng = () => (k < seq.length ? seq[k++] : 0.5);

const Δ = 0.1;
const mc = await runErrorAnalysisMC(design, params, resolveMat, {
    char: 'R', evalMode: 'front', nTrials: 1,
    rmsAbsNm: 0, rmsRelPct: 0,        // no thickness perturbation
    rmsReN: Δ, rmsImN: 0,            // only Re(n), uniform ±Δ
    distribution: 'uniform', rng,
});

// Reference spectra: only layer C is physically present.
const refAt = (nC) => evaluateSpectrum(params, MATS.Air, MATS.Sub,
    [{ material: constMat(nC), thickness: 100 }]).R;
const refCorrect = refAt(4.0 - Δ);   // C applied its OWN draw (−Δ)  → 3.9
const refBuggy   = refAt(4.0 + Δ);   // C wrongly applied A's draw (+Δ) → 4.1

const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

ok(maxDiff(mc.mean, refCorrect) < 1e-9,
   `perturbed spectrum matches C's OWN draw (n=3.9) — Δmax=${maxDiff(mc.mean, refCorrect).toExponential(2)}`);
ok(maxDiff(mc.mean, refBuggy) > 1e-4,
   `perturbed spectrum is NOT the pre-fix wrong-layer result (n=4.1) — Δmax=${maxDiff(mc.mean, refBuggy).toExponential(2)}`);
// Sanity: the two references really are distinguishable.
ok(maxDiff(refCorrect, refBuggy) > 1e-4, 'reference n=3.9 vs n=4.1 are distinguishable');

if (fails) { console.error(`\n${fails} test(s) FAILED`); process.exit(1); }
console.log('\nAll tests passed.');
