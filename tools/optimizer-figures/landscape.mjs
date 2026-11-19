/**
 * The two-layer case the optimization figures are drawn on, its merit function
 * on a grid of the two thicknesses, and runs of the app's own refinement
 * engines on it with every iterate recorded.
 *
 * The engines are built and stepped exactly as the Refinement window's
 * optimizer worker builds and steps them (src/utils/workers/optimizerJob.js):
 * same options, same iteration caps, same stopping tests. The only addition
 * is a recorder on the engine's `thicknesses` field, which every engine
 * assigns when it moves, so the path drawn is the path the engine took.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initTmmWasmMainThread } from 'tmmcore';
import { makeOperand, DLSOptimizer } from '../../src/utils/physics/optimizer.js';
import { makeEngine } from '../../src/utils/optimizers/index.js';
import { getMaterial } from '../../src/utils/materials/materialDatabase.js';
import { MAXITER_FOR } from '../../src/utils/refinement/methods.js';
import { densifyForRun } from '../../src/utils/refinement/workerInputs.js';
import { perturbPayload, restartRng } from '../../src/utils/refinement/restarts.js';

export async function loadKernel() {
    const wasm = readFileSync(createRequire(import.meta.url).resolve('tmmcore/tmm_kernel.wasm'));
    if (!(await initTmmWasmMainThread(wasm, true))) throw new Error('the WASM kernel did not load');
}

const resolveMat = id => getMaterial(id);

/**
 * A two-layer antireflection coating on BK7 in air: `outer` faces the air,
 * `inner` sits on the glass, with the thicknesses `start` [dOuter, dInner], nm.
 * The merit is one RGT row: R held at 0 % from 450 to 650 nm at normal
 * incidence, on the wavelength grid a Refinement run starting from that design
 * samples it on.
 */
export function makeCase({ outer, inner, start, band = [450, 650] }) {
    const design = {
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 },
        frontLayers: [
            { id: 'outer', material: outer, thickness: start[0], locked: false },
            { id: 'inner', material: inner, thickness: start[1], locked: false },
        ],
        backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
    };
    const row = makeOperand({ type: 'RGT', lambdaStart: band[0], lambdaEnd: band[1], aoi: 0, pol: 'avg', target: 0, targetEnd: 0, weight: 1 });
    return { design, operands: densifyForRun([row], design), outer, inner };
}

/** The case's design with the two thicknesses set, nm. */
export function designAt(kase, [dOuter, dInner]) {
    const [o, i] = kase.design.frontLayers;
    return { ...kase.design, frontLayers: [{ ...o, thickness: dOuter }, { ...i, thickness: dInner }] };
}

/**
 * The merit on an n × n grid from lo to hi nm in both thicknesses:
 * { grid[i][j] at (axis[i], axis[j]), axis, lowest: [dOuter, dInner, mf] }.
 */
export function meritGrid(kase, { lo, hi, n }) {
    const ev = new DLSOptimizer(kase.operands, kase.design, resolveMat);
    const axis = Array.from({ length: n }, (_, k) => lo + (hi - lo) * k / (n - 1));
    let lowest = [0, 0, Infinity];
    const grid = axis.map(a => axis.map(b => {
        const mf = ev.mfAt([a, b]);
        if (mf < lowest[2]) lowest = [a, b, mf];
        return mf;
    }));
    return { grid, axis, lowest };
}

// Records every value an engine assigns to its `thicknesses`, the moves it
// takes, grouped by the step() that made them.
function recordMoves(eng) {
    let current = eng.thicknesses;
    const moves = [];
    Object.defineProperty(eng, 'thicknesses', {
        configurable: true,
        get: () => current,
        set: (v) => { current = v; moves.push(v.slice()); },
    });
    return moves;
}

/**
 * One single-start run of `method` from `start` [dOuter, dInner], as the
 * Refinement window runs it. Returns { method, start, current0, population0,
 * steps, best, mfBest, iters, converged }. steps[k] holds the points the engine
 * moved through in step k + 1 (empty when the step moved nothing) and, for
 * Differential Evolution, the population after it; population0 is the starting
 * population and current0 its best member, null and the start for the other
 * methods.
 */
export function runMethod(kase, method, start, { seed = 1, maxIter } = {}) {
    const cap = maxIter ?? MAXITER_FOR[method] ?? 500;
    const eng = makeEngine(method, kase.operands, designAt(kase, start), resolveMat, {
        maxIter: cap, persistent: true, halfWaveProbe: true, seed,
    });
    // A population engine has already moved to its best starting member; x0 is
    // the design it was handed.
    const origin = (eng.x0 || eng.thicknesses).slice();
    const current0 = eng.thicknesses.slice();
    const population0 = eng.pop ? eng.pop.map(p => p.slice()) : null;
    const moves = recordMoves(eng);
    const steps = [];
    while (!eng.isConverged() && eng.iter < cap) {
        const from = moves.length;
        eng.step();
        steps.push({
            points: moves.slice(from),
            mf: eng.mf, mfBest: eng.mfBest,
            population: eng.pop ? eng.pop.map(p => p.slice()) : undefined,
        });
    }
    return {
        method, start: origin, current0, population0, steps,
        best: eng.thickBest.slice(), mfBest: eng.mfBest,
        iters: eng.iter, converged: eng.isConverged(),
    };
}

/**
 * DLS multi-start from `start` as the Refinement window runs it on its own:
 * restarts 1 to n, each a DLS run from the start with every thickness scaled
 * by a factor in [1 − pct/100, 1 + pct/100] drawn from that restart's random
 * stream of `seed`. Returns the runs, in restart order.
 */
export function runMultiStart(kase, start, { n, pct, seed, maxIter }) {
    const runs = [];
    for (let restart = 1; restart <= n; restart++) {
        const jittered = perturbPayload(designAt(kase, start), pct, restart, restartRng(seed, restart));
        runs.push(runMethod(kase, 'dls', jittered.frontLayers.map(l => l.thickness), { maxIter }));
    }
    return runs;
}
