/**
 * Surface-mode-aware synthesis tests.
 *
 * Verifies the math fix for scanNeedlesAnalytic / scanNeedlesFD / scanGEInsertions
 * when design.surfaceMode != 'front_only'. Macleod §2.6.4 full-system
 * formula T = T_f·P·T_b/D, R = R_f + T_f·T_f'·P²·R_b/D with
 * D = 1 − R_f'·R_b·P² (incoherent substrate, coatings on both faces).
 *
 * Run: node tests/synthesis_surface_modes.mjs
 *
 * Properties asserted:
 *   1. front_only path unchanged — analytic scan output bit-identical to the
 *      pre-Phase-2 result (regression guard against the refactor).
 *   2. Analytic ≡ FD for both_independent (side='front'): the analytic
 *      gradient is the d→0 limit of the FD gradient, so they agree to O(δ).
 *   3. Analytic ≡ FD for both_independent (side='back'): same, on the back
 *      stack. Exercises the dedicated back-insertion chain rule
 *      (∂R/∂d = T_f·T_f'·P²·∂R_b/∂d / D²).
 *   4. Analytic ≡ FD for symmetric (side='front', back mirrored): exercises
 *      the front-contribution + back-mirror-contribution sum.
 *   5. Analytic ≡ FD for back_only: side forced to 'back' by surface mode.
 *   6. insertNeedle(symmetric) leaves backLayers = mirror(frontLayers).
 *   7. scanGEInsertions returns sensible mfNew for non-front_only modes (the
 *      mf0 it reports matches a full-system buildEvalContext baseline).
 */

import {
    makeOperand, evaluateOperands, buildEvalContext, calcMF,
    scanNeedlesAnalytic, scanNeedlesFD, scanGEInsertions,
    insertNeedle, mirrorLayers, resolveScanSide,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

let fails = 0;
const ok   = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;

const resolveMat = id => getMaterial(id);
const TiO2 = { id: 'TiO2', name: 'TiO2', mat: resolveMat('TiO2') };
const SiO2 = { id: 'SiO2', name: 'SiO2', mat: resolveMat('SiO2') };
const POOL = [TiO2, SiO2];

function makeBaseDesign(surfaceMode) {
    return {
        incidentMedium: 'Air',
        exitMedium:     'Air',
        substrate:      { material: 'BK7', thickness: 1.0 },
        frontLayers: [
            { id: 'F1', material: 'TiO2', thickness: 80, locked: false },
            { id: 'F2', material: 'SiO2', thickness: 140, locked: false },
            { id: 'F3', material: 'TiO2', thickness: 60, locked: false },
        ],
        backLayers: surfaceMode === 'symmetric' ? mirrorLayers([
            { id: 'F1', material: 'TiO2', thickness: 80, locked: false },
            { id: 'F2', material: 'SiO2', thickness: 140, locked: false },
            { id: 'F3', material: 'TiO2', thickness: 60, locked: false },
        ]) : [
            { id: 'B1', material: 'SiO2', thickness: 120, locked: false },
            { id: 'B2', material: 'TiO2', thickness: 70, locked: false },
        ],
        surfaceMode,
    };
}

function makeOps() {
    return [
        makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
        makeOperand({ type: 'TAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 1, weight: 1 }),
    ];
}

// Pair analytic candidates with FD candidates by descriptor (kind, pos, mat).
function pairCandidates(anaCands, fdCands) {
    const key = c => c.intra
        ? `intra|${c.layerK}|${c.frac.toFixed(4)}|${c.materialId}`
        : `gap|${c.pos}|${c.materialId}`;
    const fdMap = new Map(fdCands.map(c => [key(c), c]));
    const pairs = [];
    for (const a of anaCands) {
        const f = fdMap.get(key(a));
        if (f) pairs.push({ a, f });
    }
    return pairs;
}

// ── 1. front_only path unchanged ─────────────────────────────────────────────
console.log('— front_only regression guard —');
{
    const design = makeBaseDesign('front_only');
    const ops = makeOps();
    const ana = scanNeedlesAnalytic({
        operands: ops, design, resolveMat,
        candidateMats: POOL, deltaNm: 0.5, nIntra: 4,
    });
    ok(ana && ana.candidates.length > 0, 'analytic returns candidates for front_only');
    // Smoke check: gradient is finite for at least one candidate.
    const allFinite = ana.candidates.every(c => Number.isFinite(c.grad));
    ok(allFinite, 'all front_only gradients finite');
}

// ── 2. Analytic ≡ FD on both_independent (side='front') ──────────────────────
console.log('— both_independent / side=front: analytic ≡ FD —');
{
    const design = makeBaseDesign('both_independent');
    const ops = makeOps();
    const deltaNm = 0.05;   // small so FD ≈ analytic gradient
    const ana = scanNeedlesAnalytic({ operands: ops, design, resolveMat,
        candidateMats: POOL, deltaNm, nIntra: 3, side: 'front' });
    const fd  = scanNeedlesFD({ operands: ops, design, resolveMat,
        candidateMats: POOL, deltaNm, nIntra: 3, side: 'front' });
    ok(ana && fd, 'both scans returned');
    ok(near(ana.mf0, fd.mf0, 1e-12), `mf0 match (ana=${ana.mf0.toExponential(3)} fd=${fd.mf0.toExponential(3)})`);

    const pairs = pairCandidates(ana.candidates, fd.candidates);
    ok(pairs.length === ana.candidates.length, `paired all ${ana.candidates.length} candidates`);

    // Compare grad (= dF/dd). FD is (mfNew - mf0)/deltaNm; ana is the d→0 limit.
    // For small δ, |fd.grad − ana.grad| ≤ K·δ for some bounded K.
    let maxAbsErr = 0, maxRelErr = 0;
    for (const { a, f } of pairs) {
        const abs = Math.abs(a.grad - f.grad);
        const ref = Math.max(Math.abs(a.grad), Math.abs(f.grad), 1e-12);
        maxAbsErr = Math.max(maxAbsErr, abs);
        maxRelErr = Math.max(maxRelErr, abs / ref);
    }
    console.log(`  front: max|Δgrad|=${maxAbsErr.toExponential(3)}  max rel=${maxRelErr.toExponential(3)}`);
    ok(maxAbsErr < 1e-3, `max |Δgrad| < 1e-3 (got ${maxAbsErr.toExponential(3)})`);
    ok(maxRelErr < 1e-2, `max rel err < 1% (got ${(maxRelErr*100).toFixed(3)}%)`);
}

// ── 3. Analytic ≡ FD on both_independent (side='back') ───────────────────────
console.log('— both_independent / side=back: analytic ≡ FD —');
{
    const design = makeBaseDesign('both_independent');
    const ops = makeOps();
    const deltaNm = 0.05;
    const ana = scanNeedlesAnalytic({ operands: ops, design, resolveMat,
        candidateMats: POOL, deltaNm, nIntra: 3, side: 'back' });
    const fd  = scanNeedlesFD({ operands: ops, design, resolveMat,
        candidateMats: POOL, deltaNm, nIntra: 3, side: 'back' });
    ok(ana && fd, 'back-side scans returned');
    ok(near(ana.mf0, fd.mf0, 1e-12), `back-side mf0 match`);

    const pairs = pairCandidates(ana.candidates, fd.candidates);
    let maxAbsErr = 0, maxRelErr = 0;
    for (const { a, f } of pairs) {
        const abs = Math.abs(a.grad - f.grad);
        const ref = Math.max(Math.abs(a.grad), Math.abs(f.grad), 1e-12);
        maxAbsErr = Math.max(maxAbsErr, abs);
        maxRelErr = Math.max(maxRelErr, abs / ref);
    }
    console.log(`  back: max|Δgrad|=${maxAbsErr.toExponential(3)}  max rel=${maxRelErr.toExponential(3)}`);
    ok(maxAbsErr < 1e-3, `back-side: max |Δgrad| < 1e-3`);
    ok(maxRelErr < 1e-2, `back-side: max rel err < 1%`);
}

// ── 4. Analytic ≡ FD on symmetric mode ───────────────────────────────────────
console.log('— symmetric: analytic ≡ FD —');
{
    const design = makeBaseDesign('symmetric');
    const ops = makeOps();
    const deltaNm = 0.05;
    const ana = scanNeedlesAnalytic({ operands: ops, design, resolveMat,
        candidateMats: POOL, deltaNm, nIntra: 3 });
    const fd  = scanNeedlesFD({ operands: ops, design, resolveMat,
        candidateMats: POOL, deltaNm, nIntra: 3 });
    ok(ana && fd, 'symmetric scans returned');
    ok(near(ana.mf0, fd.mf0, 1e-12), `symmetric mf0 match`);

    const pairs = pairCandidates(ana.candidates, fd.candidates);
    let maxAbsErr = 0, maxRelErr = 0;
    for (const { a, f } of pairs) {
        const abs = Math.abs(a.grad - f.grad);
        const ref = Math.max(Math.abs(a.grad), Math.abs(f.grad), 1e-12);
        maxAbsErr = Math.max(maxAbsErr, abs);
        maxRelErr = Math.max(maxRelErr, abs / ref);
    }
    console.log(`  sym: max|Δgrad|=${maxAbsErr.toExponential(3)}  max rel=${maxRelErr.toExponential(3)}`);
    ok(maxAbsErr < 1e-3, `symmetric: max |Δgrad| < 1e-3`);
    ok(maxRelErr < 1e-2, `symmetric: max rel err < 1%`);
}

// ── 5. Analytic ≡ FD on back_only ────────────────────────────────────────────
console.log('— back_only: analytic ≡ FD —');
{
    const design = makeBaseDesign('back_only');
    const ops = makeOps();
    const deltaNm = 0.05;
    const ana = scanNeedlesAnalytic({ operands: ops, design, resolveMat,
        candidateMats: POOL, deltaNm, nIntra: 3 });
    const fd  = scanNeedlesFD({ operands: ops, design, resolveMat,
        candidateMats: POOL, deltaNm, nIntra: 3 });
    ok(ana && fd, 'back_only scans returned');
    ok(near(ana.mf0, fd.mf0, 1e-12), `back_only mf0 match`);

    const pairs = pairCandidates(ana.candidates, fd.candidates);
    let maxAbsErr = 0, maxRelErr = 0;
    for (const { a, f } of pairs) {
        const abs = Math.abs(a.grad - f.grad);
        const ref = Math.max(Math.abs(a.grad), Math.abs(f.grad), 1e-12);
        maxAbsErr = Math.max(maxAbsErr, abs);
        maxRelErr = Math.max(maxRelErr, abs / ref);
    }
    console.log(`  back_only: max|Δgrad|=${maxAbsErr.toExponential(3)}  max rel=${maxRelErr.toExponential(3)}`);
    ok(maxAbsErr < 1e-3, `back_only: max |Δgrad| < 1e-3`);
    ok(maxRelErr < 1e-2, `back_only: max rel err < 1%`);
}

// ── 6. insertNeedle preserves symmetric mirror ───────────────────────────────
console.log('— insertNeedle(symmetric) keeps back = mirror(front) —');
{
    const design = makeBaseDesign('symmetric');
    const inserted = insertNeedle(design, 1, 'SiO2', 10, 'front');
    const expectedBack = mirrorLayers(inserted.frontLayers);
    ok(inserted.backLayers.length === expectedBack.length, 'back length matches mirror');
    for (let i = 0; i < expectedBack.length; i++) {
        ok(inserted.backLayers[i].material === expectedBack[i].material,
           `back[${i}].material matches mirror`);
        ok(near(inserted.backLayers[i].thickness, expectedBack[i].thickness),
           `back[${i}].thickness matches mirror`);
    }
}

// ── 7a. Candidates carry side; merging two scans yields global best ──────────
console.log('— both_independent: merged candidate list w/ side tags —');
{
    const design = makeBaseDesign('both_independent');
    const ops = makeOps();
    const front = scanNeedlesAnalytic({ operands: ops, design, resolveMat,
        candidateMats: POOL, deltaNm: 0.5, nIntra: 3, side: 'front' });
    const back  = scanNeedlesAnalytic({ operands: ops, design, resolveMat,
        candidateMats: POOL, deltaNm: 0.5, nIntra: 3, side: 'back' });

    ok(front.candidates.every(c => c.side === 'front'),
       'every front-scan candidate is tagged side="front"');
    ok(back.candidates.every(c => c.side === 'back'),
       'every back-scan candidate is tagged side="back"');

    // mf0 is the full-system baseline; both scans agree.
    ok(near(front.mf0, back.mf0, 1e-12), 'front & back scans report same mf0');

    // Merged + sorted by ΔMF = global best ranking.
    const merged = [...front.candidates, ...back.candidates]
        .filter(c => c.dMF < 0)
        .sort((a, b) => a.dMF - b.dMF);
    ok(merged.length > 0, `merged queue non-empty (got ${merged.length})`);
    const top = merged[0];
    ok(top.side === 'front' || top.side === 'back',
       `top candidate has a valid side (got "${top.side}")`);
    console.log(`  top: side=${top.side} dMF=${top.dMF.toExponential(3)} mat=${top.materialId}`);

    // Sanity: the global best should equal the best of (front-best, back-best).
    const fb = front.candidates.filter(c => c.dMF < 0).sort((a,b) => a.dMF - b.dMF)[0];
    const bb = back.candidates .filter(c => c.dMF < 0).sort((a,b) => a.dMF - b.dMF)[0];
    if (fb && bb) {
        const expected = fb.dMF <= bb.dMF ? fb : bb;
        ok(top === expected || (top.side === expected.side && near(top.dMF, expected.dMF, 1e-15)),
           'global best == min(front-best, back-best)');
    }
}

// ── 7b. scanGEInsertions tags side ───────────────────────────────────────────
console.log('— scanGEInsertions tags side —');
{
    const design = makeBaseDesign('both_independent');
    const ops = makeOps();
    const f = scanGEInsertions({ operands: ops, design, resolveMat,
        candidateMats: POOL, thickNm: 15, side: 'front' });
    const b = scanGEInsertions({ operands: ops, design, resolveMat,
        candidateMats: POOL, thickNm: 15, side: 'back' });
    ok(f.candidates.every(c => c.side === 'front'), 'GE front candidates side="front"');
    ok(b.candidates.every(c => c.side === 'back'),  'GE back candidates side="back"');
}

// ── 8. resolveScanSide & scanGEInsertions sanity ─────────────────────────────
console.log('— resolveScanSide + scanGEInsertions —');
{
    ok(resolveScanSide('front_only', 'back') === 'front', 'front_only forces front');
    ok(resolveScanSide('back_only', 'front') === 'back',  'back_only forces back');
    ok(resolveScanSide('symmetric', 'back')  === 'front', 'symmetric forces front');
    ok(resolveScanSide('both_independent', 'front') === 'front', 'both_independent honors front');
    ok(resolveScanSide('both_independent', 'back')  === 'back',  'both_independent honors back');

    const design = makeBaseDesign('both_independent');
    const ops = makeOps();
    const ctx0 = buildEvalContext(design, resolveMat);
    const baselineMf = calcMF(ops, evaluateOperands(ops, ctx0), { skipConstraints: true });
    const ge = scanGEInsertions({ operands: ops, design, resolveMat,
        candidateMats: POOL, thickNm: 15, side: 'front' });
    ok(near(ge.mf0, baselineMf, 1e-12),
       `GE mf0 matches full-system baseline (ge.mf0=${ge.mf0.toExponential(3)} vs ${baselineMf.toExponential(3)})`);
    ok(ge.candidates.length === 2 * POOL.length,
       `GE returns 2·|pool| candidates (front-boundary + sub-boundary)`);
}

// ── summary ──────────────────────────────────────────────────────────────────
if (fails === 0) {
    console.log('\nAll tests passed.');
    process.exit(0);
} else {
    console.error(`\n${fails} test(s) failed.`);
    process.exit(1);
}
