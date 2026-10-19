// Refinement and synthesis on a design, by the runs the windows run
// (runRefinement, runNeedle, runGradualEvolution, runStructural and Deep
// Synthesis's runDeepSynthesisOnDesign), against the design's merit function.
// Their workers run on the calling thread, so a call computes where it is
// made; a caller that must stay responsive makes it on a thread of its own.

import { runRefinement } from '../utils/refinement/runRefinement.js';
import { runNeedle } from '../utils/needle/runNeedle.js';
import { runGradualEvolution } from '../utils/gradualEvolution/runGradualEvolution.js';
import { runStructural } from '../utils/structural/runStructural.js';
import { runDeepSynthesisOnDesign } from '../utils/synthesis/deepSynthesis/runOnDesign.js';
import { InThreadOptimizerWorker } from '../utils/workers/inThreadOptimizerWorker.js';
import { InThreadSynthesisPool } from '../utils/workers/inThreadSynthesisPool.js';
import { activeSide } from '../components/windows/optimization/synthesisShared/synthesisMath.js';
import { strictestMnt } from '../components/windows/optimization/synthesisShared/minThickness.js';
import { mirrorLayers } from '../utils/physics/optimizer.js';
import { ensureLayerIds } from '../utils/io/newDesign.js';
import { requireMaterial, requireResolved, materialName } from './materials.js';
import { checkOptions, checkHooks } from './check.js';

const makeWorker = () => new InThreadOptimizerWorker();
const makeWorkerPool = size => new InThreadSynthesisPool(size);
// The hooks each run calls (each run's own doc), so a hook a run never calls
// is refused rather than taken and left silent.
const HOOKS = {
    refine: ['signal', 'onStart', 'onProgress', 'onMethodStart', 'onRecord'],
    needle: ['signal', 'onStart', 'onProgress', 'onGeneration'],
    ge: ['signal', 'onStart', 'onProgress', 'onRow'],
    structural: ['signal', 'onStart', 'onProgress', 'onRow'],
    deep: ['signal', 'onStart', 'onEvent'],
};

/** The hooks a run takes: `method` is 'refine' or a synthesis method. */
export const runHooks = method => HOOKS[method] || [];

// The given settings without those left undefined, so each run fills in its
// own defaults.
const given = settings => Object.fromEntries(Object.entries(settings || {}).filter(([, v]) => v !== undefined));

// `design` with the layers a run answered with; a symmetric design's back is
// the mirror of its front, as the app keeps it.
function withAnswer(design, { frontLayers, backLayers }) {
    const next = {
        ...design,
        ...(frontLayers ? { frontLayers: ensureLayerIds(frontLayers) } : {}),
        ...(backLayers ? { backLayers: ensureLayerIds(backLayers) } : {}),
    };
    return design.surfaceMode === 'symmetric' ? { ...next, backLayers: mirrorLayers(next.frontLayers) } : next;
}

function operandsOf(call, design) {
    requireResolved(design);
    const operands = design.meritOperands || [];
    if (!operands.some(op => op.enabled !== false)) throw new Error(`${call}: the design has no merit function; set one with setMerit`);
    return operands;
}

/**
 * Refines `design`'s layer thicknesses against its merit function with
 * `settings` (runRefinement.js: method, maxIter, nRestarts, perturbPct, seed,
 * threads), stopped by `signal`, reporting through the Refinement window's
 * hooks onStart, onProgress, onMethodStart and onRecord (runRefinement.js). Resolves to { result, design }: the run's
 * result and the design with the refined layers when the run finished, the
 * design as it was otherwise. The result's mf is scored on the run's own
 * wavelength grid, as the Refinement window shows it; merit() of the design
 * scores it as the Merit Function Editor does, and the two can differ in the
 * last digits. On the calling thread a refine sees Stop between its jobs.
 */
export async function refine(design, settings = {}, hooks) {
    const passed = checkHooks('refine', hooks, HOOKS.refine);
    const result = await runRefinement(design, operandsOf('refine', design), given(settings), { ...passed, makeWorker });
    return { result, design: result.completed ? withAnswer(design, result) : design };
}

// The candidate materials as the runs take them, from catalog or design ids.
function poolOf(design, ids) {
    if (!Array.isArray(ids) || !ids.length) throw new Error('synthesize: pool is a list of one or more material ids to insert');
    if (new Set(ids).size !== ids.length) throw new Error('synthesize: a material appears twice in the pool');
    return ids.map(id => ({ id, name: materialName(design, id), mat: requireMaterial(design, id) }));
}

const SYNTHESIS = {
    needle: (design, operands, settings, hooks) => runNeedle(design, operands, settings, { ...hooks, makeWorkerPool }),
    ge: (design, operands, settings, hooks) => runGradualEvolution(design, operands, settings, { ...hooks, makeWorkerPool }),
    structural: (design, operands, settings, hooks) => runStructural(design, operands, settings, { ...hooks, makeWorker }),
    deep: (design, operands, settings, hooks) => runDeepSynthesisOnDesign(design, operands, settings, hooks),
};

// The methods whose windows start their floor at the strictest MNT row of the
// merit function when there is one (synthesisShared/minThickness.js). Needle
// keeps its own thin floor for its needles.
const FLOOR_FROM_MNT = new Set(['ge', 'structural', 'deep']);

function settingsFor(method, operands, settings) {
    const out = given(settings);
    const mnt = strictestMnt(operands);
    if (FLOOR_FROM_MNT.has(method) && out.dMin === undefined && mnt > 0) out.dMin = mnt;
    return out;
}

// Deep Synthesis answers with the active side's layers alone.
function answerOf(method, design, result) {
    if (method !== 'deep') return result;
    if (!result.layers) return {};
    const layers = result.layers.map(({ material, thickness }) => ({ material, thickness, locked: false }));
    return activeSide(design) === 'back' ? { backLayers: layers } : { frontLayers: layers };
}

/**
 * Synthesizes `design` against its merit function with `method` ('needle',
 * 'ge', 'structural' or 'deep'), inserting materials from `pool` (material
 * ids), with the method's `settings` (each run's settings.js; the pool comes
 * from `pool`). Without a dMin, Gradual Evolution, Structural and Deep take
 * the strictest MNT row as their floor, as their windows do. `signal` stops the
 * run; each run's hooks pass through (needle: onStart, onProgress,
 * onGeneration; ge and structural: onStart, onProgress, onRow; deep: onStart,
 * onEvent), and a hook the method does not call is refused. Resolves to { result, design }: the run's result, and
 * the design with the run's answer when it has one.
 */
export async function synthesize(design, request, hooks) {
    const { method, pool, settings = {} } = checkOptions('synthesize', request, ['method', 'pool', 'settings']);
    const run = SYNTHESIS[method];
    if (!run) throw new Error(`synthesize: method is one of ${Object.keys(SYNTHESIS).join(', ')}, not '${method}'`);
    if (settings && 'pool' in settings) throw new Error('synthesize: give the pool as `pool`, a list of material ids');
    const operands = operandsOf('synthesize', design);
    const plan = { ...settingsFor(method, operands, settings), pool: poolOf(design, pool) };
    const result = await run(design, operands, plan, checkHooks(`synthesize ${method}`, hooks, HOOKS[method]));
    const answer = answerOf(method, design, result);
    return { result, design: answer.frontLayers || answer.backLayers ? withAnswer(design, answer) : design };
}
