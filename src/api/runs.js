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
import { warnWithoutKernel } from './environment.js';
import { checkOptions, checkHooks, refusal } from './check.js';

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

/**
 * The names of the hooks a run takes. A hook a run does not call is refused,
 * so a script can look here before it passes one.
 *
 * @param method `'refine'`, or a synthesis method as `synthesize` takes it.
 * @returns The hook names, a list; an empty one for a name that is no run.
 * @example
 * console.log('refine:', tf.runHooks('refine').join(', '));
 * console.log('needle:', tf.runHooks('needle').join(', '));
 */
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
    if (!operands.some(op => op.enabled !== false)) throw refusal('noMerit', { call }, `${call}: the design has no merit function; set one with setMerit`);
    return operands;
}

/**
 * Refines the layer thicknesses of a design against its merit function, as
 * the [Refinement](/synthesis/refinement/) window does; no layer is added or
 * taken out. The run computes on the script's own thread, so the script waits
 * for it.
 *
 * @param design The design; it needs a merit function.
 * @param settings
 * @param settings.method The method: an id from the methods below, `'all'` for each of them in turn, or a list of ids tried one by one from the same start, keeping the best.
 * @param [settings.seed] The number the random draws of a method that makes them start from, a whole number from 1 to 2^32 - 1; the same seed, design and settings repeat the run. Without it, a fresh one, which the result reports.
 * @param [hooks]
 * @param [hooks.signal] An AbortSignal; aborting it stops the run, which then ends `'stopped'` with the design as it was. The run looks at it between its jobs.
 * @param [hooks.onStart] Called once the run has started, with `{ seed }`, null for a run that draws no random numbers.
 * @param [hooks.onMethodStart] Called with `(method, index)` as each method of the run starts.
 * @param [hooks.onProgress] Called as the run goes with the readout values that changed: `iter`, `mf`, `mfBest`, `omf`, `omfBest`, `mfInitial`, `omfInitial`, `mfHistory` and `restartIdx`, with `design`, the layers now, and `best`, the best design so far.
 * @param [hooks.onRecord] Called when a method runs to its own end, with `{ method, iter, mf, omf, frontLayers, backLayers, layerSide, mfHistory }`, and `restarts` and `seed` where the method has them.
 * @returns A promise of `{ result, design }`.
 * @property result.completed `true` when the run ended on its own.
 * @property result.stopReason Why it ended: `'target'` (the merit fell below 10^-6), `'maxiter'`, `'stalled'` (the merit stopped falling), `'best:<method>'` (a list of methods, naming the one kept), `'restartsDone'` (DLS multi-start), `'stopped'`, `'workerFailed'`, `'workerError'`, `'presampleFailed'` (the materials could not be sampled), or `'invalidOperand'` (a row that cannot be evaluated, with `message`).
 * @property result.mf The merit at the end, on the run's own wavelength grid, as the Refinement window shows it; `tf.merit` of the answer scores it as the Merit Function Editor does, and the two can differ in the last digits.
 * @property result.omf The merit at the end without the manufacturing rows MNT, MXT, TT and STR.
 * @property result.mfInitial The merit at the start.
 * @property result.omfInitial The merit at the start without the manufacturing rows.
 * @property result.iter The iterations the run took.
 * @property result.frontLayers The refined front layers, or null when the run did not complete.
 * @property result.backLayers The refined back layers, or null.
 * @property result.seed The seed the random draws started from, or null.
 * @property design The design with the refined layers when the run completed, otherwise the design as it was.
 * @throws a design with no merit function, or one that names a material that resolves to nothing
 * @throws a method or setting the run does not know, or a value it cannot take
 * @example
 * const ar = tf.stackFromFormula(tf.newDesign({ name: 'AR' }), { formula: '(HL)^2' });
 * const start = tf.setMerit(ar, [{ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0 }]);
 * const { result, design } = await tf.refine(start, { method: 'dls', maxIter: 100 });
 * console.log(result.stopReason, 'merit', result.mf, design.frontLayers.map(l => l.thickness.toFixed(1)).join(', '));
 */
export async function refine(design, settings = {}, hooks) {
    // The settings, defaults and hooks are runRefinement.js's; on the calling
    // thread a refine sees the signal between its jobs.
    const passed = checkHooks('refine', hooks, HOOKS.refine);
    const operands = operandsOf('refine', design);
    const runSettings = given(settings);
    warnWithoutKernel();
    const result = await runRefinement(design, operands, runSettings, { ...passed, makeWorker });
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

/** The synthesis methods `synthesize` takes. */
export const SYNTHESIS_METHODS = Object.keys(SYNTHESIS);

/**
 * The methods whose windows start their floor at the strictest MNT row of the
 * merit function when there is one (synthesisShared/minThickness.js). Needle
 * keeps its own thin floor for its needles.
 */
export const FLOOR_FROM_MNT = new Set(['ge', 'structural', 'deep']);

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
 * Grows or restructures a design against its merit function with a synthesis
 * method, inserting materials from a pool, as the method's window does. The
 * run computes on the script's own thread, so the script waits for it.
 *
 * @param design The design; it needs a merit function.
 * @param request
 * @param request.method The method, from the methods below.
 * @param request.pool The materials the run may insert, by id: one or more, none twice.
 * @param [request.settings={}] The method's settings, below; a setting left out takes its default.
 * @param [hooks]
 * @param [hooks.signal] An AbortSignal; aborting it stops the run, which then answers with the design as it was.
 * @param [hooks.onStart] Called once the run has started.
 * @param [hooks.onProgress] Called as the run goes with what changed, such as `mf`, `layerCount`, `design` (the layers the run goes on from) and `activity`, what it is doing.
 * @param [hooks.onGeneration] Needle: called with each accepted generation: its number `genNum`, `mf`, `omf`, the change `dMF`, `layerCount`, the material inserted `insertMat` and the `layers`.
 * @param [hooks.onRow] Gradual Evolution and Structural: called with each row of the run's history: `genNum`, the row's `type` (Gradual Evolution) or mutation `kind` (Structural), `mf`, `omf`, `dMF`, `layerCount`, `insertMat` and the `layers`.
 * @returns A promise of `{ result, design }`.
 * @property result.completed `true` when the run ended on its own.
 * @property result.stopReason Why it ended. On its own: `'target'` (with `stopMF`, the merit that reached it); for Needle `'maxLayers'` or `'needleOptimal'`; for Gradual Evolution `'maxGeCycles'` or `'stuck'` (no step left); for Structural `'maxIter'`, `'iterationCap'`, `'patience'` (with `patience`), `'budget'`, `'layerCap'` or `'noMutation'`. Otherwise `'stopped'`, `'workerError'` (with `message`), or why the run could not start: `'workerFailed'`, `'noOperands'`, `'noMaterials'` or `'presampleFailed'`.
 * @property result.mf The merit of the answer, or null when there is none.
 * @property result.omf Needle and Structural: the same merit without the manufacturing rows MNT, MXT, TT and STR.
 * @property result.frontLayers The answer's front layers, or null.
 * @property result.backLayers The answer's back layers, or null.
 * @property result.seed Structural: the seed the random draws started from.
 * @property result.geSteps Gradual Evolution: the forced steps it took.
 * @property result.iters Structural: the generations it ran.
 * @property result.reheats Structural: the restarts deepSearch made.
 * @property design The design with the answer when the run has one, otherwise the design as it was; a symmetric design's back mirrors its front.
 * @throws a design with no merit function, or one that names a material that resolves to nothing
 * @throws a method or setting the run does not know, or a value it cannot take
 * @throws a pool material id that resolves to nothing, and a pool given inside the settings
 * @throws a hook the method does not call
 * @example
 * const ar = tf.stackFromFormula(tf.newDesign({ name: 'AR' }), { formula: '(HL)^2' });
 * const start = tf.setMerit(ar, [{ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0 }]);
 * const { result, design } = await tf.synthesize(start, {
 *     method: 'ge', pool: ['TiO2', 'SiO2'], settings: { maxLayers: 10, maxGeCycles: 2 },
 * });
 * console.log(result.stopReason, 'merit', result.mf, design.frontLayers.length, 'layers');
 */
export async function synthesize(design, request, hooks) {
    // Each run's settings and their defaults are its settings.js; the pool
    // comes from `pool`. Without a dMin, the methods in FLOOR_FROM_MNT take
    // the strictest MNT row as their floor, as their windows do.
    // 'deep' (Deep Synthesis) is taken too, with the hooks signal, onStart
    // ({ seed, parts }) and onEvent (event, best); stopped, it answers with its
    // best design so far. Its result holds the synthesized side's layers in
    // `layers` and `side`, with `seed`, `parts`, `start` and `search`, and it
    // ends 'done' or 'noDesign', or cannot start: 'locked' or 'noPool'.
    const { method, pool, settings = {} } = checkOptions('synthesize', request, ['method', 'pool', 'settings']);
    const run = SYNTHESIS[method];
    if (!run) throw new Error(`synthesize: method is one of ${Object.keys(SYNTHESIS).join(', ')}, not '${method}'`);
    if (settings && 'pool' in settings) throw new Error('synthesize: give the pool as `pool`, a list of material ids');
    const operands = operandsOf('synthesize', design);
    const plan = { ...settingsFor(method, operands, settings), pool: poolOf(design, pool) };
    const passed = checkHooks(`synthesize ${method}`, hooks, HOOKS[method]);
    warnWithoutKernel();
    const result = await run(design, operands, plan, passed);
    const answer = answerOf(method, design, result);
    return { result, design: answer.frontLayers || answer.backLayers ? withAnswer(design, answer) : design };
}
