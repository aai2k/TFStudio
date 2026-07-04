/**
 * Refinement methods × surface modes — end-to-end regression.
 *
 * The DLS Jacobian is already verified per surface mode
 * (tests/dls_jacobian_surface_modes.mjs) and synthesis scans too
 * (tests/synthesis_surface_modes.mjs). But the *global / second-order* refinement
 * engines (Newton, Newton-CG, CG, DE, SA) were only ever exercised on front_only
 * (tests/global_optimizers.mjs). They are surface-mode correct BY CONSTRUCTION —
 * EngineBase wraps a DLSOptimizer as evaluator (cg/de/sa) and Newton/Newton-CG
 * extend DLSOptimizer directly, so they inherit the surface-mode vector layout +
 * applyToDesign — but that was never asserted. This test drives EVERY method
 * through EVERY surface mode and checks the contract:
 *
 *   For each (method, surfaceMode):
 *     A. MF is non-increasing  (mfBest <= mf0; the engine never makes it worse).
 *     B. The optimization vector targets the correct stack(s):
 *          front_only       → front changes, back untouched
 *          back_only        → back changes,  front untouched
 *          symmetric        → back === mirror(front) after applyToDesign
 *          both_independent → both stacks are free vars (dim = nFront + nBack),
 *                             both may change
 *     C. applyToDesign writes back to the correct array(s).
 *     D. Locked layers are pinned (thickness unchanged) on the active side.
 *
 * Run: node tests/refinement_methods_surface_modes.mjs
 */

import { mirrorLayers } from '../src/utils/physics/optimizer.js';
import { makeOperand } from '../src/utils/physics/optimizer.js';
import { makeEngine, ALL_METHODS } from '../src/utils/optimizers/index.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

let fails = 0;
const ok   = (cond, msg) => { if (!cond) { console.error('  FAIL:', msg); fails++; } };
const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;
const resolveMat = id => getMaterial(id);

// Deliberately SUBOPTIMAL start so every engine has room to improve the MF.
function makeDesign(surfaceMode) {
    const front = [
        { id: 'F1', material: 'TiO2', thickness: 55,  locked: false },
        { id: 'F2', material: 'SiO2', thickness: 95,  locked: true  },  // a locked layer on the front
        { id: 'F3', material: 'TiO2', thickness: 40,  locked: false },
    ];
    const back = [
        { id: 'B1', material: 'SiO2', thickness: 110, locked: false },
        { id: 'B2', material: 'TiO2', thickness: 65,  locked: false },
    ];
    return {
        incidentMedium: 'Air',
        exitMedium:     'Air',
        substrate:      { material: 'BK7', thickness: 1.0 },
        frontLayers:    front,
        backLayers:     surfaceMode === 'symmetric' ? mirrorLayers(front) : back,
        surfaceMode,
        mfEvalMode:     'side',
    };
}

// Broadband AR-ish target — gives a real gradient on the active coating.
function makeOps() {
    return [
        makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
        makeOperand({ type: 'TAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 1, weight: 1 }),
    ];
}

function runEngine(eng, n) {
    for (let i = 0; i < n; i++) {
        eng.step();
        if (eng.isConverged()) break;
    }
    eng.restoreBest();
    return eng;
}

const MODES = ['front_only', 'back_only', 'symmetric', 'both_independent'];
// Methods that explore stochastically need a seed + a few more iters to reliably
// register an improvement; gradient/Newton methods converge in a handful.
const ITERS = { dls: 120, newton: 60, 'newton-cg': 60, cg: 120, de: 200, sa: 200 };

console.log('Refinement methods × surface modes\n');

for (const mode of MODES) {
    console.log(`=== surfaceMode = ${mode} ===`);
    const baseDesign = makeDesign(mode);
    const nFront = baseDesign.frontLayers.length;
    const nBack  = baseDesign.backLayers.length;
    const expectDim = mode === 'both_independent' ? nFront + nBack
                    : mode === 'back_only'        ? nBack
                    : nFront;                        // front_only / symmetric

    for (const method of ALL_METHODS) {
        const ops = makeOps();
        let eng;
        try {
            eng = makeEngine(method, ops, baseDesign, resolveMat,
                { seed: 12345, maxIter: ITERS[method] ?? 150, dMin: 1, dMax: 2000 });
        } catch (err) {
            ok(false, `${method}/${mode}: constructor threw: ${err.message}`);
            continue;
        }

        const mf0 = eng.mf;
        // Dimension of the optimization vector must match the surface mode.
        ok(eng.thicknesses.length === expectDim,
            `${method}/${mode}: vector dim ${eng.thicknesses.length} === ${expectDim}`);

        runEngine(eng, ITERS[method] ?? 150);

        // A. Non-increasing MF.
        ok(eng.mfBest <= mf0 + 1e-9,
            `${method}/${mode}: mfBest ${eng.mfBest.toFixed(6)} <= mf0 ${mf0.toFixed(6)}`);
        // Sanity: this start is suboptimal, so a competent engine should
        // actually lower it (loose threshold to stay non-flaky for DE/SA).
        ok(eng.mfBest < mf0 - 1e-6,
            `${method}/${mode}: engine improved MF (Δ=${(mf0 - eng.mfBest).toExponential(2)})`);

        // B/C. Write-back targets the correct stack(s).
        const out = eng.applyToDesign(baseDesign);
        const frontT = out.frontLayers.map(l => l.thickness);
        const backT  = out.backLayers.map(l => l.thickness);
        const baseFrontT = baseDesign.frontLayers.map(l => l.thickness);
        const baseBackT  = baseDesign.backLayers.map(l => l.thickness);
        const changed = (a, b) => a.some((v, i) => !near(v, b[i], 1e-9));
        const same    = (a, b) => a.length === b.length && a.every((v, i) => near(v, b[i], 1e-9));

        if (mode === 'front_only') {
            ok(changed(frontT, baseFrontT), `${method}/${mode}: front changed`);
            ok(same(backT, baseBackT),      `${method}/${mode}: back untouched`);
        } else if (mode === 'back_only') {
            ok(changed(backT, baseBackT),   `${method}/${mode}: back changed`);
            ok(same(frontT, baseFrontT),    `${method}/${mode}: front untouched`);
        } else if (mode === 'symmetric') {
            ok(changed(frontT, baseFrontT), `${method}/${mode}: front changed`);
            const mirror = mirrorLayers(out.frontLayers).map(l => l.thickness);
            ok(same(backT, mirror),         `${method}/${mode}: back === mirror(front)`);
        } else { // both_independent
            ok(changed(frontT, baseFrontT) || changed(backT, baseBackT),
                `${method}/${mode}: at least one side changed`);
            // The engine vector splits [front..., back...]; verify the split maps
            // straight onto the two arrays.
            const vFront = eng.thicknesses.slice(0, nFront);
            const vBack  = eng.thicknesses.slice(nFront);
            ok(same(frontT, vFront), `${method}/${mode}: front == vector[0:nFront]`);
            ok(same(backT, vBack),   `${method}/${mode}: back == vector[nFront:]`);
        }

        // D. Locked front layer (F2) is pinned whenever the front is a free stack.
        if (mode !== 'back_only') {
            ok(near(frontT[1], baseFrontT[1], 1e-9),
                `${method}/${mode}: locked front layer pinned (${frontT[1].toFixed(4)})`);
        }
    }
    console.log('');
}

console.log(fails === 0 ? 'ALL PASS\n' : `${fails} FAILED\n`);
process.exit(fails === 0 ? 0 : 1);
