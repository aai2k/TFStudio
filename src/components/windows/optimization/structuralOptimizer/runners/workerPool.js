import {
    requiredLambdas, collectDesignMaterialIds, isConstraint, mirrorLayers,
    scanNeedlesPFunction, findOptimalNeedleThickness, insertNeedle, insertNeedleIntra,
    buildEvalContext, evaluateOperands, calcMF, calcOMF,
} from '../../../../../utils/physics/optimizer.js';
import {
    makeRng, proposeMutation, metropolisAccept, temperatureAt,
    deepTemperature, stagnationAction, basinKick, tidyLayers, MUTATION_KINDS,
} from '../../../../../utils/synthesis/structuralOptimizer.js';
import {
    getSynthesisInnerEngine, getSynthesisSmartSeed, getThreadCount,
} from '../../../../../utils/synthesis/synthesisConfig.js';
import { getTmmWasmBytesForWorker } from '../../../../../utils/workers/tmmWasm.js';
import { OPTIMIZER_WORKER_URL as WORKER_URL } from '../../../../../workerUrls.js';
import {
    activeSide, densifyForRun, resolveMat, minOmfOf,
    getPoolMaterials, buildARSeedCandidates, computePareto,
} from '../../synthesisShared/synthesisHelpers.js';

const REFINE_TIMEOUT_MS = 45000;
const SCAN_DELTA = 0.5;
const HARD_CAP = 2_000_000;
const deep = value => JSON.parse(JSON.stringify(value));
const sumD = layers => (layers || []).reduce((sum, layer) => sum + (Number(layer.thickness) || 0), 0);
const mkLayers = layers => (layers || []).map(layer => ({
    id: layer.id, material: layer.material, thickness: layer.thickness || 0, locked: !!layer.locked,
}));

function presampleAll(design, operands, pool) {
    const lambdas = requiredLambdas(operands);
    const ids = new Set(collectDesignMaterialIds(design));
    for (const material of pool) ids.add(material.id);
    ids.add('Air');
    const materials = {};
    for (const id of ids) {
        const mat = resolveMat(id);
        const n = new Array(lambdas.length);
        const k = new Array(lambdas.length);
        for (let i = 0; i < lambdas.length; i++) {
            const nk = mat.getNK(lambdas[i]);
            n[i] = nk[0];
            k[i] = nk[1];
        }
        materials[id] = { lambdas, n, k };
    }
    return materials;
}

function refineOnce(worker, job, onTick) {
    return new Promise((resolve, reject) => {
        worker.onmessage = event => {
            const message = event.data;
            if (!message) return;
            if (message.type === 'warn') { console.warn(message.message); return; }
            if (message.type === 'init') return;
            if (message.type === 'progress') { if (onTick) onTick(message); return; }
            if (message.type === 'error') {
                worker.onmessage = null;
                worker.onerror = null;
                reject(new Error(message.message || 'worker error'));
                return;
            }
            if (message.type === 'done') {
                worker.onmessage = null;
                worker.onerror = null;
                resolve({
                    mf: message.mfBest,
                    omf: message.omfBest,
                    frontLayers: message.bestFrontLayers,
                    backLayers: message.bestBackLayers,
                });
            }
        };
        worker.onerror = event => {
            worker.onmessage = null;
            worker.onerror = null;
            reject(new Error((event && event.message) || 'worker onerror'));
        };
        worker.postMessage(job);
    });
}

const alive = (ctx, S) => ctx.runningRef.current && ctx.runIdRef.current === S.runId;

function designFor(S, activeLayers, otherLayers) {
    const design = { ...S.media };
    design[S.layerKey] = mkLayers(activeLayers);
    if (S.surfaceMode === 'symmetric' && S.layerKey === 'frontLayers') {
        design.backLayers = mirrorLayers(design.frontLayers);
    } else {
        design[S.otherKey] = mkLayers(otherLayers);
    }
    return design;
}

function trueEval(S, frontLayers, backLayers, fallbackMf, fallbackOmf) {
    try {
        const design = { ...S.media, frontLayers: frontLayers || [], backLayers: backLayers || [] };
        const computed = evaluateOperands(S.fullOps, buildEvalContext(design, resolveMat));
        const mf = calcMF(S.fullOps, computed);
        const omf = calcOMF(S.fullOps, computed);
        if (Number.isFinite(mf)) {
            return { mf, omf: Number.isFinite(omf) ? omf : (fallbackOmf ?? null) };
        }
    } catch (_) {}
    return { mf: fallbackMf, omf: fallbackOmf ?? null };
}

function refineJob(S, design) {
    return {
        type: 'start', method: S.structEngine, operands: S.operands, design,
        materials: S.materials, opts: { maxIter: S.cfg.refineIter },
        engineOpts: { dMin: S.cfg.dMin, dMax: S.cfg.dMax }, wasmBytes: S.wasmBytes,
    };
}

function replaceTimedOutWorker(ctx, S, workerIndex) {
    console.warn(`[Structural] refine worker ${workerIndex} timed out — replacing`);
    try { ctx.workersRef.current[workerIndex]?.terminate(); } catch (_) {}
    try {
        const worker = new Worker(WORKER_URL, { type: 'module' });
        if (S.wasmBytes) worker.postMessage({ type: 'wasmInit', wasmBytes: S.wasmBytes });
        ctx.workersRef.current[workerIndex] = worker;
    } catch (_) {}
}

function refineGuarded(ctx, S, workerIndex, job, tick) {
    return new Promise(resolve => {
        let settled = false;
        let timeout = null;
        const done = value => {
            if (settled) return;
            settled = true;
            if (timeout) clearTimeout(timeout);
            resolve(value);
        };
        timeout = setTimeout(() => {
            if (settled) return;
            replaceTimedOutWorker(ctx, S, workerIndex);
            done(null);
        }, REFINE_TIMEOUT_MS);
        refineOnce(ctx.workersRef.current[workerIndex], job, tick)
            .then(result => done(result))
            .catch(() => done(null));
    });
}

function onTick(ctx, S, message) {
    const now = Date.now();
    if (now - S.lastTick < 100) return;
    S.lastTick = now;
    if (message.mf != null) ctx.setMf(message.mf);
    if (message.omf != null) ctx.setOmf(message.omf);
}

function normalizeResult(S, result) {
    const rawActive = S.layerKey === 'frontLayers' ? result.frontLayers : result.backLayers;
    const tidied = tidyLayers(rawActive || [], S.cfg.dMin);
    const frontLayers = S.layerKey === 'frontLayers' ? tidied : deep(result.frontLayers);
    const backLayers = S.layerKey === 'backLayers'
        ? tidied
        : (S.surfaceMode === 'symmetric' ? mirrorLayers(tidied) : deep(result.backLayers));
    const score = trueEval(S, frontLayers, backLayers, result.mf, result.omf ?? null);
    return { mf: score.mf, omf: score.omf, frontLayers, backLayers };
}

async function refineScore(ctx, S, activeLayers, otherLayers, workerIndex = 0) {
    const result = await refineGuarded(
        ctx, S, workerIndex, refineJob(S, designFor(S, activeLayers, otherLayers)), null);
    return result ? normalizeResult(S, result) : null;
}

function needleProposals(S, current, count) {
    if (!S.pool.length || count <= 0) return [];
    const design = {
        ...S.media,
        [S.layerKey]: current[S.layerKey],
        [S.otherKey]: current[S.otherKey],
    };
    let candidates;
    try {
        ({ candidates } = scanNeedlesPFunction({
            operands: S.operands, design, resolveMat, candidateMats: S.pool,
            deltaNm: SCAN_DELTA, side: S.side,
        }));
    } catch (err) {
        console.warn('[Structural] needle scan failed:', err);
        return [];
    }
    const improving = (candidates || []).filter(candidate => candidate.dMF < 0)
        .sort((a, b) => a.dMF - b.dMF);
    const proposals = [];
    for (let i = 0; i < improving.length && proposals.length < count; i++) {
        const candidate = improving[i];
        let thickness = S.cfg.dMin;
        try {
            thickness = findOptimalNeedleThickness({
                operands: S.operands, design, resolveMat, candidate,
                deltaNm: S.cfg.dMin, maxNm: Math.min(500, S.cfg.dMax), tol: 0.5, side: S.side,
            });
            if (!(thickness >= S.cfg.dMin)) thickness = S.cfg.dMin;
        } catch (_) {
            thickness = S.cfg.dMin;
        }
        const nextDesign = candidate.intra
            ? insertNeedleIntra(design, candidate.layerK, candidate.frac, candidate.materialId, thickness, S.side)
            : insertNeedle(design, candidate.pos, candidate.materialId, thickness, S.side);
        proposals.push({
            layers: nextDesign[S.layerKey],
            mutation: {
                kind: candidate.intra ? 'split' : 'add',
                pos: candidate.intra ? candidate.layerK : candidate.pos,
                materialId: candidate.materialId,
                insertMat: candidate.materialId,
                thickness,
            },
        });
    }
    return proposals;
}

function commitBest(ctx, S) {
    if (S.best.frontLayers || S.best.backLayers) {
        const patch = {};
        if (S.best.frontLayers) patch.frontLayers = S.best.frontLayers;
        if (S.best.backLayers) patch.backLayers = S.best.backLayers;
        ctx.updateDesignRef.current(patch, { transient: true });
        ctx.baseDesignRef.current = { ...(ctx.baseDesignRef.current || ctx.designRef.current), ...patch };
        ctx.setMf(S.best.mf);
        ctx.setMfBest(S.best.mf);
        ctx.setLayerCount((S.best[S.layerKey] || []).length);
        if (S.best.omf != null) {
            ctx.setOmf(S.best.omf);
            ctx.setOmfBest(S.best.omf);
        }
    }
    ctx.saveCache();
}

function finalize(ctx, S, reason) {
    if (ctx.runIdRef.current !== S.runId) return;
    commitBest(ctx, S);
    ctx.runningRef.current = false;
    ctx.killWorkers();
    ctx.setRunning(false);
    ctx.setTemp(null);
    ctx.setCanReset(true);
    ctx.setStatusMsg(reason || S.ts.statusDone);
}

function recordBaseline(ctx, S, score) {
    if (ctx.gensRef.current.length) return;
    const generation = {
        id: Math.random().toString(36).slice(2),
        genNum: 0, mf: score.mf, omf: score.omf, dMF: null, side: S.side,
        kind: (S.smartSeed && S.pool.length) ? 'seed' : 'baseline',
        layerCount: (S.current[S.layerKey] || []).length,
        tot: sumD(S.current.frontLayers) + sumD(S.current.backLayers),
        tMs: performance.now() - S.runT0, insertMat: null,
        frontSnap: deep(S.current.frontLayers), backSnap: deep(S.current.backLayers),
        layers: deep(S.current[S.layerKey] || []),
    };
    ctx.gensRef.current = [generation];
    ctx.setGenerations(ctx.gensRef.current.slice());
    ctx.setTopDesigns(computePareto(ctx.gensRef.current));
    ctx.saveCache();
}

function smartSeedDesign(S, candidate) {
    const activeLayers = candidate.name === 'current'
        ? S.curDes[S.layerKey]
        : (S.layerKey === 'frontLayers'
            ? candidate.frontLayers
            : (candidate.backLayers.length ? candidate.backLayers : candidate.frontLayers));
    return designFor(S, activeLayers, S.curDes[S.otherKey]);
}

function bestSeedIndex(results) {
    let bestIndex = -1;
    for (let i = 0; i < results.length; i++) {
        if (results[i] && (bestIndex < 0 || results[i].mf < results[bestIndex].mf)) bestIndex = i;
    }
    return bestIndex;
}

async function smartSeedBaseline(ctx, S) {
    if (!S.smartSeed || !S.pool.length) return null;
    const candidates = buildARSeedCandidates({
        design: S.curDes, pool: S.pool, maxLayers: S.cfg.maxLayers,
    });
    ctx.setStatusMsg(S.ts.smartSeeding(candidates.length));
    const results = [];
    for (let offset = 0; offset < candidates.length && alive(ctx, S); offset += S.workerCount) {
        const wave = candidates.slice(offset, offset + S.workerCount);
        const waveResults = await Promise.all(wave.map((candidate, index) => refineGuarded(
            ctx, S, index, refineJob(S, smartSeedDesign(S, candidate)),
            index === 0 ? message => onTick(ctx, S, message) : null)));
        results.push(...waveResults);
    }
    if (!alive(ctx, S)) return null;
    const bestIndex = bestSeedIndex(results);
    if (bestIndex < 0) return null;
    const best = results[bestIndex];
    console.log('[Structural] Smart seed:', candidates.map((candidate, index) =>
        `${candidate.name}=${results[index]?.mf?.toFixed?.(6) ?? '×'}`).join('  '),
    `→ best "${candidates[bestIndex].name}" ${best.mf.toFixed(6)}`);
    return best;
}

async function establishBaseline(ctx, S) {
    let baseline = await smartSeedBaseline(ctx, S);
    if (!alive(ctx, S)) return false;
    if (!baseline) {
        const design = designFor(S, S.curDes[S.layerKey], S.curDes[S.otherKey]);
        baseline = await refineGuarded(
            ctx, S, 0, refineJob(S, design), message => onTick(ctx, S, message));
    }
    if (!alive(ctx, S)) return false;
    if (!baseline) {
        finalize(ctx, S, S.ts.statusNoMut);
        return false;
    }
    const score = trueEval(
        S, baseline.frontLayers, baseline.backLayers, baseline.mf, baseline.omf ?? null);
    S.current = {
        mf: score.mf, omf: score.omf,
        frontLayers: deep(baseline.frontLayers), backLayers: deep(baseline.backLayers),
    };
    S.best = {
        mf: score.mf, omf: score.omf,
        frontLayers: deep(baseline.frontLayers), backLayers: deep(baseline.backLayers),
    };
    ctx.updateDesignRef.current({
        frontLayers: S.current.frontLayers, backLayers: S.current.backLayers,
    }, { transient: true });
    ctx.setMf(score.mf);
    ctx.setMfBest(score.mf);
    ctx.setLayerCount((S.current[S.layerKey] || []).length);
    ctx.setOmf(score.omf);
    ctx.setOmfBest(score.omf);
    S.trendX = ctx.trendRef.current.length
        ? ctx.trendRef.current[ctx.trendRef.current.length - 1].iter
        : 0;
    ctx.trendRef.current = [
        ...ctx.trendRef.current,
        { iter: S.trendX, cur: S.current.mf, best: S.best.mf },
    ];
    ctx.setTrend(ctx.trendRef.current.slice());
    recordBaseline(ctx, S, score);
    S.prevBestMF = S.best.mf;
    return true;
}

function recordBest(ctx, S, candidate, mutation) {
    S.noImprove = 0;
    S.best = {
        mf: candidate.mf, omf: candidate.omf,
        frontLayers: deep(candidate.frontLayers), backLayers: deep(candidate.backLayers),
    };
    ctx.updateDesignRef.current({
        frontLayers: S.best.frontLayers, backLayers: S.best.backLayers,
    }, { transient: true });
    ctx.setMf(candidate.mf);
    ctx.setOmf(candidate.omf);
    ctx.setLayerCount((S.best[S.layerKey] || []).length);
    ctx.genCountRef.current += 1;
    const dMF = S.prevBestMF === Infinity ? null : candidate.mf - S.prevBestMF;
    S.prevBestMF = candidate.mf;
    const generation = {
        id: Math.random().toString(36).slice(2),
        genNum: ctx.genCountRef.current,
        mf: candidate.mf, omf: candidate.omf, dMF, side: S.side,
        kind: mutation.kind,
        layerCount: (S.best[S.layerKey] || []).length,
        tot: sumD(candidate.frontLayers) + sumD(candidate.backLayers),
        tMs: performance.now() - S.runT0,
        insertMat: mutation.insertMat ?? null,
        frontSnap: deep(candidate.frontLayers), backSnap: deep(candidate.backLayers),
        layers: deep(S.best[S.layerKey] || []),
    };
    ctx.gensRef.current = [...ctx.gensRef.current, generation];
    ctx.setGenerations(ctx.gensRef.current.slice());
    ctx.setTopDesigns(computePareto(ctx.gensRef.current));
    ctx.setMfBest(S.best.mf);
    ctx.setOmfBest(minOmfOf(ctx.gensRef.current));
    ctx.saveCache();
    return S.best.mf < S.cfg.targetMF;
}

function generateProposals(S) {
    const currentLayers = S.current[S.layerKey] || [];
    const atCap = currentLayers.filter(layer => !layer.locked).length >= S.cfg.maxLayers;
    const enabledKinds = atCap
        ? S.kinds.filter(kind => kind !== 'add' && kind !== 'split')
        : S.kinds;
    if (!enabledKinds.length) return { reason: S.ts.statusCap, proposals: [] };

    const proposals = [];
    if (enabledKinds.includes('add') || enabledKinds.includes('split')) {
        proposals.push(...needleProposals(S, S.current, Math.ceil(S.workerCount / 2)));
    }
    const randomKinds = enabledKinds.filter(kind => kind !== 'add' && kind !== 'split');
    const fillKinds = randomKinds.length ? randomKinds : enabledKinds;
    for (let index = proposals.length; index < S.workerCount; index++) {
        const proposal = proposeMutation(currentLayers, {
            rng: S.rng, pool: S.poolLite, dMin: S.cfg.dMin, dMax: S.cfg.dMax,
            addMaxNm: S.cfg.addMaxNm, jitterPct: S.cfg.jitterPct, kinds: fillKinds,
        });
        if (proposal) proposals.push(proposal);
    }
    return { reason: proposals.length ? null : S.ts.statusNoMut, proposals };
}

async function refineProposals(ctx, S, proposals) {
    ctx.setStatusMsg(S.ts.statusRefining(proposals.length));
    const otherLayers = S.current[S.otherKey];
    const results = await Promise.all(proposals.map((proposal, index) => refineGuarded(
        ctx, S, index, refineJob(S, designFor(S, proposal.layers, otherLayers)),
        index === 0 ? message => onTick(ctx, S, message) : null)
        .then(result => (result ? { result, proposal } : null))));
    if (!alive(ctx, S)) return null;
    let best = null;
    for (const item of results) {
        if (!item || item.result.mf == null) continue;
        if (!best || item.result.mf < best.result.mf) best = item;
    }
    return best;
}

function acceptProposal(ctx, S, bestResult, temperature) {
    if (!bestResult) {
        S.noImprove += 1;
        return false;
    }
    S.attempts += 1;
    const candidate = normalizeResult(S, bestResult.result);
    const isNewBest = candidate.mf < S.best.mf - 1e-12;
    if (metropolisAccept(S.current.mf, candidate.mf, temperature, S.rng)) {
        S.accepts += 1;
        S.current = candidate;
    }
    if (isNewBest) return recordBest(ctx, S, candidate, bestResult.proposal.mutation);
    S.noImprove += 1;
    return false;
}

function updateIterationState(ctx, S, iteration) {
    if (S.current.mf > S.best.mf * 1.3) {
        S.current = {
            mf: S.best.mf, omf: S.best.omf,
            frontLayers: deep(S.best.frontLayers), backLayers: deep(S.best.backLayers),
        };
    }
    ctx.trendRef.current = [
        ...ctx.trendRef.current,
        { iter: ++S.trendX, cur: S.current.mf, best: S.best.mf },
    ];
    if (iteration % 2 === 0 || S.noImprove === 0) ctx.setTrend(ctx.trendRef.current.slice());
    ctx.setAccRate(S.attempts ? S.accepts / S.attempts : null);
}

async function reheat(ctx, S, iteration) {
    S.reheatCount += 1;
    ctx.setReheats(S.reheatCount);
    ctx.setStatusMsg(S.ts.statusReheat(S.reheatCount));
    const kicked = basinKick(deep(S.best[S.layerKey] || []), {
        rng: S.rng, pool: S.poolLite, dMin: S.cfg.dMin, dMax: S.cfg.dMax,
        addMaxNm: S.cfg.addMaxNm, jitterPct: S.cfg.jitterPct,
        kinds: S.kinds, maxKick: 3,
    });
    const result = await refineScore(ctx, S, kicked, S.current[S.otherKey], 0);
    if (!alive(ctx, S)) return false;
    if (result) {
        S.current = result;
        if (result.mf < S.best.mf - 1e-12 &&
            recordBest(ctx, S, result, { kind: 'perturb', insertMat: null })) {
            finalize(ctx, S, S.ts.statusConverged(S.best.mf));
            return false;
        }
    } else {
        S.current = {
            mf: S.best.mf, omf: S.best.omf,
            frontLayers: deep(S.best.frontLayers), backLayers: deep(S.best.backLayers),
        };
    }
    S.cycleStart = iteration + 1;
    S.noImprove = 0;
    return true;
}

async function runIteration(ctx, S, iteration) {
    ctx.setIter(iteration);
    const temperature = S.cfg.deepMode
        ? deepTemperature(iteration - S.cycleStart, S.coolPeriod, S.cfg.T0, S.endTemperature)
        : temperatureAt(iteration / S.cfg.maxIter, S.cfg.T0, S.endTemperature);
    ctx.setTemp(temperature);
    if (S.deepBudgetMs && performance.now() - S.runT0 >= S.deepBudgetMs) {
        finalize(ctx, S, S.ts.statusTimeUp);
        return false;
    }

    const batch = generateProposals(S);
    if (batch.reason) {
        finalize(ctx, S, batch.reason);
        return false;
    }
    const bestResult = await refineProposals(ctx, S, batch.proposals);
    if (!alive(ctx, S)) return false;
    if (acceptProposal(ctx, S, bestResult, temperature)) {
        finalize(ctx, S, S.ts.statusConverged(S.best.mf));
        return false;
    }
    updateIterationState(ctx, S, iteration);

    const action = stagnationAction({
        deepMode: S.cfg.deepMode, noImprove: S.noImprove, patience: S.patience,
    });
    if (action === 'stop') {
        finalize(ctx, S, S.ts.statusStalled(S.patience));
        return false;
    }
    if (action === 'reheat') return reheat(ctx, S, iteration);
    return true;
}

async function runLoop(ctx, S) {
    try {
        if (!(await establishBaseline(ctx, S))) return;
        for (let iteration = 1;
            alive(ctx, S) && (S.cfg.deepMode ? iteration <= HARD_CAP : iteration <= S.cfg.maxIter);
            iteration++) {
            if (!(await runIteration(ctx, S, iteration))) return;
        }
        finalize(ctx, S, S.cfg.deepMode ? S.ts.statusDone : S.ts.statusMaxIter);
    } catch (err) {
        console.error('[Structural] run error:', err);
        if (alive(ctx, S)) ctx.stopOpt(String((err && err.message) || err));
    }
}

function applyConstraintBounds(cfg, enabled) {
    const minimums = enabled.filter(op => op.type === 'MNT' && Number.isFinite(op.target));
    const maximums = enabled.filter(op => op.type === 'MXT' && Number.isFinite(op.target));
    const minNm = minimums.length ? Math.max(...minimums.map(op => op.target)) : 0;
    const maxNm = maximums.length ? Math.min(...maximums.map(op => op.target)) : Infinity;
    cfg.dMin = Math.max(cfg.dMin, minNm);
    cfg.dMax = Math.max(cfg.dMin + 1, Math.min(2000, maxNm));
    if (minNm > 0 || Number.isFinite(maxNm)) {
        console.log(`[Structural] constraint-bound synthesis: dMin=${cfg.dMin} dMax=${cfg.dMax} (MNT=${minNm || '—'}, MXT=${Number.isFinite(maxNm) ? maxNm : '—'})`);
    }
}

function createWorkers(ctx, count) {
    try {
        ctx.killWorkers();
        for (let i = 0; i < count; i++) {
            ctx.workersRef.current.push(new Worker(WORKER_URL, { type: 'module' }));
        }
        return true;
    } catch (err) {
        console.error('[Structural] worker construction failed:', err);
        ctx.setStatusMsg('Worker init failed');
        ctx.killWorkers();
        return false;
    }
}

function createRunState(ctx) {
    const cfg = { ...ctx.cfgRef.current };
    const curDes = ctx.baseDesignRef.current || ctx.designRef.current;
    if (!curDes) return null;
    const enabled = ctx.operandsRef.current.filter(op => op.enabled);
    const operands = densifyForRun(enabled.filter(op => !isConstraint(op.type)), curDes);
    if (!operands.length) {
        ctx.setStatusMsg(ctx.ts.noOperands);
        return null;
    }
    applyConstraintBounds(cfg, enabled);

    const side = activeSide(curDes);
    const layerKey = side === 'back' ? 'backLayers' : 'frontLayers';
    const otherKey = layerKey === 'frontLayers' ? 'backLayers' : 'frontLayers';
    const surfaceMode = curDes.surfaceMode || 'front_only';
    const pool = getPoolMaterials(ctx.selectedCatsRef.current, { excluded: ctx.excludedMatsRef.current });
    const needsPool = cfg.kinds.has('add') || cfg.kinds.has('split');
    const hasNonPool = cfg.kinds.has('remove') || cfg.kinds.has('merge') || cfg.kinds.has('perturb');
    if (needsPool && !pool.length && !hasNonPool) {
        ctx.setStatusMsg(ctx.ts.noMaterials);
        return null;
    }

    let materials;
    try {
        materials = presampleAll(curDes, operands, pool);
    } catch (err) {
        console.error('[Structural] pre-sampling failed:', err);
        ctx.setStatusMsg('Pre-sampling failed');
        return null;
    }
    if (!ctx.savedDesignRef.current) {
        if (ctx.checkpointRef.current) ctx.checkpointRef.current();
        ctx.savedDesignRef.current = {
            frontLayers: ctx.designRef.current.frontLayers,
            backLayers: ctx.designRef.current.backLayers,
        };
        ctx.baseDesignRef.current = curDes;
        ctx.setCanReset(true);
    }

    const workerCount = getThreadCount();
    const wasmBytes = getTmmWasmBytesForWorker();
    if (!createWorkers(ctx, workerCount)) return null;
    const previousElapsed = ctx.gensRef.current.length
        ? (ctx.gensRef.current[ctx.gensRef.current.length - 1].tMs || 0)
        : 0;
    const runT0 = performance.now() - previousElapsed;
    const runId = ++ctx.runIdRef.current;
    const best = { mf: Infinity, omf: null, frontLayers: null, backLayers: null };
    return {
        cfg, curDes, operands, fullOps: ctx.operandsRef.current.filter(op => op.enabled),
        side, layerKey, otherKey, surfaceMode, pool,
        poolLite: pool.map(material => ({ id: material.id, name: material.name })),
        materials, workerCount, wasmBytes, runId, runT0,
        media: {
            surfaceMode, mfEvalMode: curDes.mfEvalMode ?? 'side',
            incidentMedium: curDes.incidentMedium ?? 'Air',
            exitMedium: curDes.exitMedium ?? 'Air',
            substrate: {
                material: curDes.substrate?.material ?? 'BK7',
                thickness: curDes.substrate?.thickness ?? 1.0,
            },
            ...(curDes.cone ? { cone: curDes.cone } : {}),
        },
        structEngine: getSynthesisInnerEngine('structural'),
        smartSeed: getSynthesisSmartSeed('structural'),
        rng: makeRng((Date.now() ^ (ctx.genCountRef.current * 2654435761)) >>> 0),
        ts: ctx.ts, best, current: { ...best }, lastTick: 0,
        trendX: 0, accepts: 0, attempts: 0, prevBestMF: Infinity, noImprove: 0,
        patience: Math.max(15, Math.round(cfg.maxIter / 3)),
        kinds: MUTATION_KINDS.filter(kind => cfg.kinds.has(kind)),
        endTemperature: cfg.T0 * 0.005,
        coolPeriod: Math.max(40, cfg.maxIter),
        deepBudgetMs: cfg.deepMaxMin > 0 ? cfg.deepMaxMin * 60000 : 0,
        cycleStart: 1, reheatCount: 0,
    };
}

export function runStructuralWorker(ctx) {
    if (ctx.runningRef.current) return;
    const state = createRunState(ctx);
    if (!state) return;
    ctx.runningRef.current = true;
    ctx.setRunning(true);
    ctx.setStatusMsg(ctx.ts.statusBaseline);
    ctx.setIter(0);
    ctx.setReheats(0);
    return runLoop(ctx, state);
}
