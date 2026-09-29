// Merit, gradient and refinement of a Deep Synthesis run. One evaluator is
// built per run on the calling thread and one per job in a worker, both from
// the same presampled material tables, so every merit of a run comes from the
// same numbers.
//
// The merit is TFStudio's MF (calcMF), scored by an LSQEngine kept per material
// sequence. Refinement is the lab's refine_clean and refine_part (refine.c
// 560-589) on a makeEngine engine: steps up to an iteration budget or a
// plateau, then, once the refinement has ended, the clean passes that merge
// what refinement thinned away and refine again.

import { LSQEngine } from '../../physics/optimizer/lsqEngine.js';
import { OperandEvaluationError, resolveEvalMode } from '../../physics/optimizer/evalCore.js';
import { requiredLambdas } from '../../physics/optimizer/sampling.js';
import { mirrorLayers } from '../../physics/optimizer/layerOps.js';
import { makeEngine } from '../../optimizers/index.js';
import { makeResolveMat } from '../../workers/resolveMat.js';
import { normalize } from './design.js';
import { DEFAULT_TARGET_MF } from './trace.js';

export const DEFAULT_ENGINE = 'trust-region';
// giga4.c 983 (refine_iter=60 plateau=6), refine.c 111 (plateau_gain 1e-4)
export const REFINE_DEFAULTS = Object.freeze({ maxIter: 60, plateau: 6, plateauGain: 1e-4 });
export const CLEAN_PASSES = 1000;   // refine.c clean_passes 502
export const ENGINE_CACHE = 16;     // LSQEngine instances kept for ev.mf and ev.grad, one per material sequence
export const DEFAULT_REFERENCE_NM = 550;   // nm, TFStudio's reference wavelength when a design sets none

// refine.h 68-73: a refinement in parts. iters: engine steps so far; state:
// engine state to go on with; done: the refinement has ended; mf: its merit;
// void: the item's preparation failed, so it never entered the race.
export function newPart() {
    return { iters: 0, state: null, done: false, mf: NaN, void: false };
}

const mediumId = m => (typeof m === 'string' ? m : (m?.material ?? 'Air'));

function runSettings(spec) {
    const surfaceMode = spec.base.surfaceMode || 'front_only';
    const dMin = spec.dMin ?? 0;
    return {
        operands: spec.operands, pool: spec.pool, otherLayers: spec.otherLayers ?? [],
        dMin, dMax: spec.dMax ?? Infinity, floor: dMin,
        maxLayers: spec.maxLayers, engine: spec.engine ?? DEFAULT_ENGINE,
        refineOpts: { ...REFINE_DEFAULTS, ...spec.refine }, targetMf: spec.targetMf ?? DEFAULT_TARGET_MF,
        surfaceMode, side: spec.side ?? (surfaceMode === 'back_only' ? 'back' : 'front'),
        // Light enters a back_only stack from the exit medium only when the back
        // side is scored on its own. Otherwise the angle is set in the incident
        // medium: the full-system score lights the back coating through the
        // substrate at the angle Snell's law gives from the incident medium.
        incident: mediumId(resolveEvalMode(spec.base) === 'back' ? spec.base.exitMedium : spec.base.incidentMedium),
    };
}

// The operands' wavelength grid, nm, and lamRef, the grid entry nearest the
// design's reference wavelength (ties to the shorter). lamRef stands in for
// the lab case's ref_nm, the wavelength a case names for optical thickness
// (lab.h Problem), as referenceWavelength does in a TFStudio design. Taken on
// the grid, every index the run reads comes from the presampled tables.
function wavelengths(operands, refNm) {
    const lambdas = requiredLambdas(operands);
    const lamMin = lambdas[0], lamMax = lambdas[lambdas.length - 1];
    let lamRef = lamMin;
    for (const lam of lambdas) if (Math.abs(lam - refNm) < Math.abs(lamRef - refNm)) lamRef = lam;
    return { lambdas, lamMin, lamMax, lamRef };
}

// The TFStudio design of `layers`: the active stack on ev.side, the other side
// fixed (locked in both_independent, so the run stays on one stack), and in
// symmetric mode the back mirrored from the front.
function designOf(ev, layers) {
    const active = layers.map((l, i) => ({ id: 'L' + i, material: l.material, thickness: l.thickness, locked: false }));
    const locked = ev.surfaceMode === 'both_independent';
    const other = ev.otherLayers.map((l, i) => ({ id: 'O' + i, material: l.material, thickness: l.thickness, locked }));
    const base = ev.spec.base;
    if (ev.surfaceMode === 'symmetric') return { ...base, frontLayers: active, backLayers: mirrorLayers(active) };
    if (ev.side === 'back') return { ...base, frontLayers: other, backLayers: active };
    return { ...base, frontLayers: active, backLayers: other };
}

// LSQEngine's thickness vector (lsqEngine.js 104-121): the active layers
// first, then in both_independent the other side's.
function vectorOf(ev, layers) {
    const active = layers.map(l => l.thickness);
    if (ev.surfaceMode !== 'both_independent') return active;
    return active.concat(ev.otherLayers.map(l => l.thickness));
}

// A merit-function row that cannot be scored throws OperandEvaluationError
// (lsqEngine.js 170-176); such a point gets `fallback`.
function scored(fn, fallback) {
    try {
        return fn();
    } catch (err) {
        if (err instanceof OperandEvaluationError) return fallback;
        throw err;
    }
}

// The last ENGINE_CACHE engines used, by material sequence. A sequence whose
// engine could not be built is not kept, so a later design tries again.
function engineCache(ev) {
    const cache = new Map();
    const build = layers => scored(
        () => new LSQEngine(ev.operands, ev.designOf(layers), ev.resolveMat, { dMin: ev.dMin, dMax: ev.dMax }), null);
    return layers => {
        const key = layers.map(l => l.material).join('\u0001');
        const eng = cache.get(key) ?? build(layers);
        cache.delete(key);
        if (!eng) return null;
        cache.set(key, eng);
        if (cache.size > ENGINE_CACHE) cache.delete(cache.keys().next().value);
        return eng;
    };
}

// MF of `layers`; Infinity where the operands cannot be evaluated.
function meritOf(ev, eng, layers) {
    return eng ? scored(() => eng.mfAt(vectorOf(ev, layers)), Infinity) : Infinity;
}

// dMF/dd per active layer, per nm; zeros where the merit cannot be scored.
function gradientOf(ev, eng, layers) {
    const zeros = layers.map(() => 0);
    if (!eng) return zeros;
    return scored(() => eng.gradMF(vectorOf(ev, layers)).slice(0, layers.length), zeros);
}

// ── Refinement ───────────────────────────────────────────────────────────────

const defined = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

// refine.c 576 and 581: what a part hands to the next, chiefly the trust
// radius (nm) of the trust-region engine, and the damping of the others.
function engineState(eng) {
    return defined({ lamD: eng.lamD, lamN: eng.lamN, lamS: eng.lamS, delta: eng.delta });
}

function resumeOpts(state) {
    if (!state) return {};
    return defined({ lamInit: state.lamD, lamNInit: state.lamN, lamSInit: state.lamS, delta0: state.delta });
}

// refine.c 484-487: stop when the merit fell by less than plateauGain of
// itself over the last `plateau` steps.
function atPlateau(hist, { plateau, plateauGain }) {
    const k = hist.length - 1;
    if (!(plateau > 0) || k < plateau) return false;
    const past = hist[k - plateau];
    return !(past > 0 && (past - hist[k]) / past >= plateauGain);
}

// Steps up to `budget`. ended: the engine converged or the merit reached a
// plateau, as opposed to the budget running out (refine.c 582).
function stepEngine(eng, budget, opts) {
    const hist = [eng.mf];
    let steps = 0;
    while (!eng.isConverged() && steps < budget) {
        eng.step();
        steps++;
        hist.push(eng.mf);
        if (atPlateau(hist, opts)) return { steps, ended: true };
    }
    return { steps, ended: eng.isConverged() };
}

// refine.c refine 396-498 on the run's engine, resuming from `state` when
// given. The loop here owns the budget and the plateau, the same for every
// engine, so the engine's own are turned off. A design the merit cannot score
// ends at once with an infinite merit.
function runEngine(ev, layers, budget, state) {
    const opts = { dMin: ev.dMin, dMax: ev.dMax, maxIter: Infinity, plateau: 0, ...resumeOpts(state) };
    const eng = scored(() => makeEngine(ev.engine, ev.operands, ev.designOf(layers), ev.resolveMat, opts), null);
    if (!eng) return { layers, mf: Infinity, steps: 0, ended: true, state: null };
    const { steps, ended } = stepEngine(eng, budget, ev.refineOpts);
    const best = eng.thickBest.slice(0, layers.length).map((t, i) => ({ material: layers[i].material, thickness: t }));
    return { layers: best, mf: eng.mfBest, steps, ended, state: engineState(eng) };
}

// refine.c clean_passes 501-514: normalize; when that merged or dropped a
// layer, refine again from a fresh engine with the full budget. With a floor
// above zero no layer reaches zero and this is one normalize.
function cleanPasses(ev, held) {
    let cur = held;
    for (let pass = 0; pass < CLEAN_PASSES; pass++) {
        const next = normalize(cur.layers);
        if (next.length === cur.layers.length) break;
        cur = runEngine(ev, next, ev.refineOpts.maxIter, null);
    }
    return cur;
}

// refine.c refine_part 569-589: goes on from where the part stopped until its
// iterations reach min(upto, maxIter) or the refinement ends; a part already
// there, or done, comes back unchanged. Clean passes once it is done.
function refinePart(ev, item, upto) {
    const { part } = item;
    const { maxIter } = ev.refineOpts;
    const cap = Math.min(upto, maxIter);
    if (part.done || (part.iters > 0 && cap <= part.iters)) return item;
    const run = runEngine(ev, item.layers, cap - part.iters, part.iters > 0 ? part.state : null);
    const iters = part.iters + run.steps;
    const done = run.ended || iters >= maxIter;
    const end = done ? cleanPasses(ev, run) : run;
    return { ...item, layers: end.layers, part: { iters, state: run.state, done, mf: end.mf, void: false } };
}

// refine.c refine_clean 560-566.
function refine(ev, layers) {
    const out = refinePart(ev, { layers, prep: null, part: newPart() }, ev.refineOpts.maxIter);
    return { layers: out.layers, mf: out.part.mf, iters: out.part.iters };
}

// spec, built once per run and carried by every job (structured-clonable):
//   operands      the run's enabled operands, MNT and MXT taken out as dMin and dMax
//   base          the design without its layers (synthesisMath.js serializableMedia)
//   side          'front' | 'back', the stack the run works on
//   otherLayers   the other side's Layers, fixed for the run
//   pool          material ids the run may insert
//   dMin, dMax    thickness bounds, nm; dMin is the floor
//   maxLayers, engine (a makeEngine name), refine ({ maxIter, plateau, plateauGain }), targetMf
//   referenceWavelength  the design's, nm (DEFAULT_REFERENCE_NM when absent)
// materials: tables presampled on the operands' grid (runGrid.js presampleSynthesisMaterials).
export function makeEvaluator(spec, { materials, resolveMat } = {}) {
    const resolve = resolveMat || makeResolveMat(materials, 'deepSynthesis', m => console.warn(m.message));
    const refNm = spec.referenceWavelength || DEFAULT_REFERENCE_NM;
    const ev = { spec, materials, resolveMat: resolve, ...runSettings(spec), ...wavelengths(spec.operands, refNm) };
    ev.candidateMats = ev.pool.map(id => ({ id, name: id, mat: resolve(id) }));
    ev.n = (material, lam) => resolve(material).getNK(lam)[0];
    ev.nRef = material => ev.n(material, ev.lamRef);
    ev.designOf = layers => designOf(ev, layers);
    const engineFor = engineCache(ev);
    ev.mf = layers => meritOf(ev, engineFor(layers), layers);
    ev.grad = layers => gradientOf(ev, engineFor(layers), layers);
    ev.refinePart = (item, upto) => refinePart(ev, item, upto);
    ev.refine = layers => refine(ev, layers);
    return ev;
}
