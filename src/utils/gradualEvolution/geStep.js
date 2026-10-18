// Structural steps of a Gradual Evolution run, taken when needle optimization
// has stalled. The forced step deliberately increases total optical thickness
// (Tikhonravov 2007 §2: forced TOT increase between needle optimizations; MF
// typically rises and is then recovered by the subsequent needle
// optimization). At the layer limit a swap takes out the layer that costs
// least, so the needles can place one somewhere better. Before either, the
// design without the layers parked on the floor is tried, and a step that led
// nowhere is not taken again from the same stack (undoneSteps.js). The run ends
// on the GE-step budget, the target merit, or when no step is left; with Deep
// search it perturbs the best design instead and ends only on Stop or the
// target (deepSearch.js).
//
// Each step returns 'continue' after a step, 'none' when it has no step to
// take, 'stop' when the run was stopped meanwhile, or { end } when the run ends.

import { deep, designSnap, reportDesign, recordCycle } from './core.js';
import { alive } from './runState.js';
import {
    noteStructuralStep, settleStructuralStep, forgetUndone, forgetTried, undoneForcedSteps, takenSwapStructures,
    structureOf,
} from './undoneSteps.js';
import { perturbBest } from './deepSearch.js';

const sideLayers = (S, sd) => (sd === 'back' ? S.work.backLayers : S.work.frontLayers);

// The sides a structural step tries, in order: in both_independent the side
// with fewer layers first for a forced step, so growth stays balanced, and the
// side with more first for a swap.
function sidesInOrder(S, fewerFirst) {
    if (S.scanSides.length === 1) return S.scanSides;
    const frontFewer = S.work.frontLayers.length <= S.work.backLayers.length;
    return frontFewer === fewerFirst ? ['front', 'back'] : ['back', 'front'];
}

// Take `res`, a full design from a structural step, as `work` (and `best` when
// it is a new best), and record it as a history row of `type`. Returns whether
// it set a new best.
function applyStructuralResult(S, res, row) {
    S.work.mf = res.mf;
    S.work.frontLayers = deep(res.frontLayers || S.work.frontLayers);
    S.work.backLayers  = deep(res.backLayers  || S.work.backLayers);
    S.geSteps += 1;
    reportDesign(S, S.work.frontLayers, S.work.backLayers, { mf: res.mf, omf: res.omf, geSteps: S.geSteps });
    const newBest = res.mf < S.best.mf - 1e-9;
    if (newBest) {
        S.best.mf = res.mf;
        S.best.frontLayers = deep(S.work.frontLayers);
        S.best.backLayers  = deep(S.work.backLayers);
    }
    const activeLayers = sideLayers(S, res.side);
    recordCycle(S, { ...row, mf: res.mf, layerCount: res.nLayers, side: res.side, activeLayers, omf: res.omf });
    return newBest;
}

// Needle optimization has stalled: take the layers parked on the floor out of
// `work` and refine what is left (thin-layer removal with reoptimization,
// Tikhonravov, Trubetskov & DeBell, Appl. Opt. 46, 704 (2007)). The result is
// kept only as a new global best: a forced step puts its layer on the floor
// on purpose, and taking it out just to beat `work` would take the step back.
// Returns true when it was kept, recorded as a 'clean' cycle.
async function dropParkedOnStall(S) {
    const res = await S.workerPool.run({
        type: 'dropParked', operands: S.operands,
        design: designSnap(S, S.work.frontLayers, S.work.backLayers),
        materials: S.materials, dMin: S.dMin, dlsIter: S.stepIter,
        jobId: 'dropParked', side: S.scanSides[0], engine: S.innerEngine,
    }, (m) => S.onTick(0, m));
    if (!alive(S) || !res.removed || !(res.mf < S.best.mf - 1e-9)) return false;
    S.work.mf = res.mf;
    S.work.frontLayers = deep(res.frontLayers);
    S.work.backLayers  = deep(res.backLayers);
    S.best.mf = res.mf;
    S.best.frontLayers = deep(res.frontLayers);
    S.best.backLayers  = deep(res.backLayers);
    reportDesign(S, S.work.frontLayers, S.work.backLayers, { mf: res.mf, omf: res.omf });
    const activeLayers = res.side === 'back' ? S.work.backLayers : S.work.frontLayers;
    console.log(`[GE] Took ${res.removed} parked layer(s) out: MF=${res.mf.toFixed(6)} layers=${res.nLayers}`);
    recordCycle(S, { type: 'clean', mf: res.mf, layerCount: res.nLayers, insertMat: null, side: res.side, activeLayers, omf: res.omf });
    return true;
}

// One forced total-optical-thickness step on `side` that fits the layer limit,
// leaving out the insertions undone on this structure.
async function forcedStepOnSide(S, side) {
    const before = sideLayers(S, side);
    S.emit({ phase: 'scanning', activity: { id: 'geScanning' } });
    const _geT0 = performance.now();
    const gres = await S.workerPool.run({
        type: 'geStep', operands: S.operands,
        design: designSnap(S, S.work.frontLayers, S.work.backLayers),
        materials: S.materials, pool: S.poolLite, dMin: S.dMin, side,
        exclude: undoneForcedSteps(S, side, before), maxLayers: S.maxLayers,
    });
    if (!alive(S)) return 'stop';
    console.log(`[GE timing] FORCED-TOT geStep=${(performance.now() - _geT0).toFixed(0)}ms`);
    if (gres.empty) return 'none';
    console.log(`[GE Insert] GE → forced ${gres.materialId} at pos ${gres.pos} side=${gres.side} (MF ${gres.mf0.toFixed(5)} → ${gres.mfNew.toFixed(5)}, +TOT) layers=${gres.nLayers}`);
    // `work` becomes the TOT-increased design (accumulates, never snaps back).
    // work.mf takes the step's full merit, the quantity every later needle is
    // compared against; the optical merit the scan ranked it on is display only.
    const newBest = applyStructuralResult(S, gres, { type: 'ge', insertMat: gres.materialId });
    noteStructuralStep(S, 'forced', {
        side: gres.side, pos: gres.pos, materialId: gres.materialId,
        structure: structureOf(before), merged: gres.nLayers === before.length,
    }, newBest);
    return 'continue';
}

// At the layer limit: take out the layer on `side` whose removal costs least,
// leaving out removals to a structure a swap has already left this run, so the
// needle optimization that follows can place a layer somewhere better.
async function swapOnSide(S, side) {
    S.emit({ phase: 'refining', activity: { id: 'freeing' } });
    const res = await S.workerPool.run({
        type: 'dropWeakest', operands: S.operands,
        design: designSnap(S, S.work.frontLayers, S.work.backLayers),
        materials: S.materials, dMin: S.dMin, dlsIter: S.stepIter, side, engine: S.innerEngine,
        skip: takenSwapStructures(S, side), jobId: 'dropWeakest',
    }, (m) => S.onTick(0, m));
    if (!alive(S)) return 'stop';
    if (!res.removed) return 'none';
    console.log(`[GE] Freed a layer: took out layer ${res.i + 1}, MF ${res.baseMf.toFixed(6)} → ${res.mf.toFixed(6)}, layers=${res.nLayers}`);
    const newBest = applyStructuralResult(S, res, { type: 'clean', insertMat: null });
    noteStructuralStep(S, 'swap', { side: res.side, structure: res.structure }, newBest);
    return 'continue';
}

// Deep search, with no forced step or swap left: the best design perturbed on
// the scanned sides and refined in full becomes `work` (deepSearch.js), and
// every forced insertion and swap is open again.
async function perturbStep(S) {
    S.emit({ phase: 'refining', activity: { id: 'perturbing' } });
    const { frontLayers, backLayers, scale } = perturbBest(S, S.best, S.scanSides, S.dMin);
    const res = await S.workerPool.run({
        type: 'seedDls', operands: S.operands,
        design: designSnap(S, frontLayers, backLayers),
        materials: S.materials, dMin: S.dMin, dlsIter: S.dlsIter,
        jobId: 'perturb', side: S.scanSides[0], engine: S.innerEngine,
    }, (m) => S.onTick(0, m));
    if (!alive(S)) return 'stop';
    console.log(`[GE] Deep search: best design perturbed by ±${Math.round(scale * 100)}%, refined to MF ${res.mf.toFixed(6)}`);
    applyStructuralResult(S, { ...res, nLayers: res.layers.length }, { type: 'perturb', insertMat: null });
    forgetTried(S);
    return 'continue';
}

// A forced step on the first side that has one left.
async function forcedGeStep(S) {
    for (const side of sidesInOrder(S, true)) {
        const outcome = await forcedStepOnSide(S, side);
        if (outcome !== 'none') return outcome;
    }
    return 'none';
}

// A swap on the first side that has one left.
async function swapStep(S) {
    for (const side of sidesInOrder(S, false)) {
        const outcome = await swapOnSide(S, side);
        if (outcome !== 'none') return outcome;
    }
    return 'none';
}

const atLayerLimit = S => S.scanSides.every(sd => sideLayers(S, sd).length >= S.maxLayers);

// One structural step within the GE-step budget: a swap first at the layer
// limit and a forced step first below it, then with Deep search a perturbation
// of the best design, which has no budget. The run ends on the budget or with
// no step left.
async function structuralStep(S) {
    if (!S.deepSearch && S.geSteps >= S.maxGeCycles) {
        console.log(`[GE] Max GE steps reached (${S.geSteps})`);
        return { end: { stopReason: 'maxGeCycles' } };
    }
    const steps = atLayerLimit(S) ? [swapStep, forcedGeStep] : [forcedGeStep, swapStep];
    if (S.deepSearch) steps.push(perturbStep);
    for (const step of steps) {
        const outcome = await step(S);
        if (outcome !== 'none') return outcome;
    }
    return { end: { stopReason: 'stuck' } };
}

// Needle optimization has stalled on every side: the design without its
// parked layers when that is a new best; otherwise a structural step, a swap
// first at the layer limit and a forced step first below it, each leaving out
// what led nowhere from this stack.
export async function stallStep(S) {
    const settled = settleStructuralStep(S);
    if (settled) console.log(`[GE] The ${settled.kind === 'swap' ? 'freed layer' : 'forced step'} before this stall led to no new best`);
    let outcome = 'continue';
    if (await dropParkedOnStall(S)) forgetUndone(S);
    else outcome = await structuralStep(S);
    if (outcome === 'continue' && S.best.mf < S.targetMF) return { end: { stopReason: 'target', stopMF: S.best.mf } };
    return outcome;
}
