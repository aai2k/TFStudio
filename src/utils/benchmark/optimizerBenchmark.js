/**
 * Optimizer benchmark — shared, environment-agnostic driver core.
 *
 * One source of truth for the cross-optimizer benchmark, imported by BOTH:
 *   • the CLI report  (tests/optimizer_grand_benchmark.mjs)
 *   • the in-app window's worker (src/utils/workers/benchmarkWorker.js → the
 *     OptimizerBenchmark dev/QA window).
 *
 * No DOM, no workers, no material database import — every driver takes the
 * `resolveMat(id) → material` resolver as a parameter, so it runs identically
 * in Node, in a Web Worker, or on the main thread. The synthesis drivers are
 * faithful ports of the canonical loops (NeedleVariation / GradualEvolution /
 * StructuralOptimizer components) using the SAME validated primitives from
 * optimizer.js — see those components and [[project_optimizer_worker]].
 *
 * Metrics returned per run: final merit function (lower better), wall time
 * (ms), and layer count (fewer better for synthesis; fixed for refinement).
 */
import {
    makeOperand, makeConstraintOperand, calcMF, scanNeedlesPFunction, findOptimalNeedleThickness,
    insertNeedle, insertNeedleIntra, cleanupLayers, scanGEInsertions,
    buildEvalContext, evaluateOperands, removeRedundantLayers,
} from '../physics/optimizer.js';
import { makeEngine } from '../optimizers/index.js';
import {
    makeRng, proposeMutation, metropolisAccept, temperatureAt, tidyLayers, MUTATION_KINDS,
    deepTemperature, stagnationAction, basinKick,
} from '../synthesis/structuralOptimizer.js';
import { generateARSeeds, rankSeeds } from '../synthesis/seedGenerator.js';
import { cullMarginalNeedles } from '../synthesis/synthesisConfig.js';

// ── timing (works in Node and the browser/worker) ────────────────────────────────
const now = (typeof performance !== 'undefined' && performance.now)
    ? () => performance.now()
    : () => Number(process.hrtime.bigint() / 1000n) / 1000;
const deep = (x) => JSON.parse(JSON.stringify(x));

// ── candidate pool + method lists ────────────────────────────────────────────────
// Synthesis material pool — a SINGLE high/low pair (the standard 2-material
// coating pool): TiO2 (high, n≈2.4) + SiO2 (low, n≈1.46), on a BK7 substrate in
// Air. The pool is CRUCIAL to every synthesis result, so describePool() surfaces
// it in the report/UI.
export const POOL_IDS = ['TiO2', 'SiO2'];
export const makePool = (resolveMat) => POOL_IDS.map((id) => ({ id, name: id, mat: resolveMat(id) }));

/** One-line description of the synthesis pool with indices at λ=550 nm. */
export function describePool(resolveMat, lamNm = 550) {
    const parts = POOL_IDS.map((id) => {
        let n = null;
        try { const m = resolveMat(id); const nk = m && m.getNK ? m.getNK(lamNm) : null; if (nk) n = nk[0]; } catch (_) {}
        return n != null ? `${id} (n≈${n.toFixed(2)})` : id;
    });
    return `${parts.join(' + ')}  on BK7, in Air`;
}

export const LOCAL_METHODS  = ['dls', 'cg', 'newton', 'newton-cg', 'sqp'];
export const GLOBAL_METHODS = ['de', 'sa'];
// Inner LOCAL refiners a synthesis tool (Needle/GE/Structural) can use to polish
// each candidate — mirrors SYNTHESIS_INNER_ENGINES / the synthesis "engine" dropdown.
export const SYNTH_ENGINES  = ['dls', 'cg', 'newton', 'newton-cg', 'sqp'];
export const REFINE_MAXITERS = [60, 200, 500];
export const DMIN_SWEEP = [1, 40];
// Per-method iteration budgets — BYTE-MATCH Refinement.js MAXITER_FOR so the
// benchmark runs each engine exactly as the Refinement window does: to
// convergence OR this cap. CG needs ~600 to use all its auto-relaunch cycles;
// capping it lower (the old flat 60/200/500 sweep) cut it off mid-relaunch and
// understated it. This is the fair, apples-to-apples default.
export const REFINE_MAXITER = { dls: 500, cg: 600, newton: 200, 'newton-cg': 200, sqp: 200 };
export const GLOBAL_MAXITER = { de: 250, sa: 400, 'dls-multi': 500 };

// ── operands + seeds ──────────────────────────────────────────────────────────────
const tgt = (type, a, b, t, te) =>
    makeOperand({ type, lambdaStart: a, lambdaEnd: b, aoi: 0, pol: 'avg', target: t, targetEnd: te ?? t, weight: 1 });

const baseDesign = (frontLayers) => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers, backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
});

/**
 * Deterministic alternating H/L QWOT@550 stack for the FIXED-N refinement runs,
 * lightly perturbed so every method starts from the same non-optimal point.
 */
export function refineStart(nLayers) {
    const H = 550 / (4 * 2.40), L = 550 / (4 * 1.46);  // ~57 nm / ~94 nm
    const layers = [];
    for (let i = 0; i < nLayers; i++) {
        const isH = i % 2 === 0;
        const jitter = 1 + 0.18 * Math.sin(i * 1.7 + 0.5);
        layers.push({ id: `R${i}`, material: isH ? 'TiO2' : 'SiO2', thickness: (isH ? H : L) * jitter, locked: false });
    }
    return baseDesign(layers);
}

/** The fixed benchmark suite. Seeds are factories (fresh layers per run). */
export const BENCH_CASES = [
    {
        id: 'bbar', name: 'BBAR  (T→1, 420–680 nm)', refineN: 8,
        ops: [tgt('TGT', 420, 680, 1)],
        thin: () => baseDesign([
            { id: 'S1', material: 'TiO2', thickness: 30, locked: false },
            { id: 'S2', material: 'SiO2', thickness: 50, locked: false },
        ]),
        thick: () => baseDesign([{ id: 'T1', material: 'SiO2', thickness: 6000, locked: false }]),
    },
    {
        // BBAR synthesised from a SINGLE low-index layer (the user's achromat-
        // style workflow): every family starts from 1 layer, so this isolates how
        // well the smart-seed + synthesis recover a compact AR from nothing. The
        // refinement family can only tune the lone layer (it cannot add layers).
        id: 'bbar1l', name: 'BBAR 1-layer start  (T→1, 420–680 nm)', refineN: 1,
        ops: [tgt('TGT', 420, 680, 1)],
        thin:  () => baseDesign([{ id: 'S1', material: 'SiO2', thickness: 94, locked: false }]),
        thick: () => baseDesign([{ id: 'T1', material: 'SiO2', thickness: 94, locked: false }]),
    },
    {
        id: 'bs', name: 'Beam splitter  (R=0.5, 480–620 nm)', refineN: 8,
        ops: [tgt('RGT', 480, 620, 0.5)],
        thin: () => baseDesign([
            { id: 'S1', material: 'TiO2', thickness: 40, locked: false },
            { id: 'S2', material: 'SiO2', thickness: 60, locked: false },
        ]),
        thick: () => baseDesign([{ id: 'T1', material: 'TiO2', thickness: 1500, locked: false }]),
    },
    {
        id: 'bandpass', name: '3-line bandpass  (445/535/635 pass)', refineN: 12,
        ops: [
            tgt('TGT', 440, 450, 1), tgt('TGT', 530, 540, 1), tgt('TGT', 630, 640, 1),
            tgt('TGT', 400, 435, 0), tgt('TGT', 455, 525, 0), tgt('TGT', 545, 625, 0), tgt('TGT', 645, 700, 0),
        ],
        thin: () => baseDesign([
            { id: 'S1', material: 'TiO2', thickness: 50, locked: false },
            { id: 'S2', material: 'SiO2', thickness: 80, locked: false },
        ]),
        thick: () => baseDesign([{ id: 'T1', material: 'SiO2', thickness: 7000, locked: false }]),
    },
    {
        id: 'shortpass', name: 'Shortpass edge  (T→1 <540, T→0 >600)', refineN: 10,
        ops: [tgt('TGT', 420, 540, 1), tgt('TGT', 600, 700, 0)],
        thin: () => baseDesign([
            { id: 'S1', material: 'TiO2', thickness: 50, locked: false },
            { id: 'S2', material: 'SiO2', thickness: 80, locked: false },
        ]),
        thick: () => baseDesign([{ id: 'T1', material: 'TiO2', thickness: 3000, locked: false }]),
    },
    {
        // The OTF-demo 4-line multipassband (tests/synthesis_4band_escape.mjs): a
        // genuinely hard target that is the canonical needle stress-test — needle
        // adds no bulk, so it MUST start from a thick HIGH-index (TiO2) seed that
        // already holds the total optical thickness for it to CARVE.
        id: 'otf4', name: '4-line multipassband  (OTF demo, HIGH-index seed)', refineN: 16,
        ops: [
            tgt('TGT', 437, 467, 1), tgt('TGT', 512, 543, 1), tgt('TGT', 593, 648, 1), tgt('TGT', 700, 763, 1), // passbands
            tgt('TGT', 400, 430, 0), tgt('TGT', 473, 507, 0), tgt('TGT', 550, 587, 0),                          // stopbands
        ],
        thin: () => baseDesign([
            { id: 'S1', material: 'TiO2', thickness: 60, locked: false },
            { id: 'S2', material: 'SiO2', thickness: 100, locked: false },
        ]),
        // HIGH-index thick seed: 7000 nm TiO2 — the OTF showcase start.
        thick: () => baseDesign([{ id: 'T1', material: 'TiO2', thickness: 7000, locked: false }]),
    },
];
export const caseById = (id) => BENCH_CASES.find((c) => c.id === id);

/** Human-readable one-line description of a seed design's starting stack. */
export function describeSeed(design) {
    const fl = design.frontLayers || [];
    const tot = fl.reduce((s, l) => s + (l.thickness || 0), 0);
    if (!fl.length) return '(empty)';
    if (fl.length <= 3) return `${fl.map((l) => `${l.material} ${Math.round(l.thickness)}nm`).join(' / ')}  (Σd=${Math.round(tot)}nm)`;
    return `${fl.length} layers, Σd=${Math.round(tot)}nm`;
}

/**
 * Starting points for a case, per synthesis seed. Refinement runs from a fixed
 * perturbed QWOT stack; Needle from the THICK seed (it carves, adds no bulk);
 * GE + Structural from the THIN seed (they grow/forced-TOT).
 */
export function caseSeeds(caseOrId) {
    const C = typeof caseOrId === 'string' ? caseById(caseOrId) : caseOrId;
    if (!C) return null;
    return {
        refine: `${describeSeed(refineStart(C.refineN))}  — fixed ${C.refineN}-layer H/L QWOT@550 (refinement)`,
        thick:  `${describeSeed(C.thick())}  — Needle seed (carve)`,
        thin:   `${describeSeed(C.thin())}  — GE / Structural seed (grow)`,
    };
}

/** Default synthesis config (UI may override budgetMs / maxSteps / maxLayers). */
export const SYNTH_DEFAULTS = {
    budgetMs: 12000, maxLayers: 45, maxSteps: 220, innerIter: 40,
    structK: 4, structMaxIter: 70,
};

// ── shared helpers ────────────────────────────────────────────────────────────────
const frontCount = (d) => (d.frontLayers || []).length;
const mfOf = (design, ops, resolveMat) =>
    calcMF(ops, evaluateOperands(ops, buildEvalContext(design, resolveMat)), { skipConstraints: true });
/** Optical-only merit function on `design` (skips constraint operands). */
export const opticalMF = (design, ops, resolveMat) => mfOf(design, ops, resolveMat);
/** Min FRONT layer thickness (nm) — used to check MNT-constraint satisfaction. */
export const minFrontThk = (d) => { const fl = d.frontLayers || []; return fl.length ? Math.min(...fl.map((l) => l.thickness || 0)) : 0; };
/** λ0 for seed generation = centre of a case's operand band(s). */
function bandCenter(ops) {
    let lo = Infinity, hi = -Infinity;
    for (const o of ops || []) {
        if (Number.isFinite(o.lambdaStart)) lo = Math.min(lo, o.lambdaStart);
        if (Number.isFinite(o.lambdaEnd))   hi = Math.max(hi, o.lambdaEnd);
    }
    return (Number.isFinite(lo) && Number.isFinite(hi)) ? (lo + hi) / 2 : 550;
}
/** Greedy merit-aware layer consolidation on a finished synthesis design
 *  (Macleod "remove the thin layers"); mirrors GE finalize. Returns the
 *  de-bloated { design, mf } or the input unchanged. */
function consolidate(best, ops, dMin, resolveMat, innerIter, engine, tol) {
    if (frontCount(best.design) <= 1) return best;
    const r = removeRedundantLayers({
        design: best.design, side: 'front', dMin, tol: tol ?? 0.05, minLayers: 1, maxIter: innerIter,
        refineFn: (d, mi) => { const rr = refinePrune(d, ops, dMin, resolveMat, mi ?? innerIter, engine); return { mf: rr.mf, design: rr.design }; },
    });
    return r ? { design: r.design, mf: r.mf } : best;
}
/** An MNT (minimum-thickness) constraint over every layer: one-sided penalty d ≥ nm. */
export const mntOperand = (nm) => makeConstraintOperand({ type: 'MNT', lambdaStart: 1, lambdaEnd: 9999, target: nm, weight: 1 });

// ── refinement (fixed-N) ──────────────────────────────────────────────────────────
export function runRefine(method, design, ops, maxIter, dMin, resolveMat, dMax = 600) {
    let eng;
    try { eng = makeEngine(method, ops, design, resolveMat, { dMin, dMax, seed: 12345 }); }
    catch (e) { return { err: e.message }; }
    const mf0 = eng.mf;
    const t0 = now();
    let it = 0;
    try { for (; it < maxIter && !eng.isConverged(); it++) eng.step(); }
    catch (e) { return { err: e.message, it }; }
    const ms = now() - t0;
    if (eng.restoreBest) eng.restoreBest();
    const out = eng.applyToDesign(design);
    return { mf0, mf: eng.mfBest ?? eng.mf, it, ms, design: out };
}

/** Main-thread multistart over DLS (mirrors Refinement.js dls-multi). */
export function runDlsMulti(design, ops, maxIter, dMin, resolveMat, starts = 6) {
    const t0 = now();
    let best = Infinity, mf0 = null, bestDesign = design;
    for (let s = 0; s < starts; s++) {
        const d = deep(design);
        d.frontLayers = d.frontLayers.map((L, i) => ({ ...L, thickness: L.thickness * (1 + 0.15 * Math.sin(s * 3.1 + i * 0.9)) }));
        const r = runRefine('dls', d, ops, maxIter, dMin, resolveMat);
        if (r.err) continue;
        if (mf0 == null) mf0 = r.mf0;
        if (r.mf < best) { best = r.mf; bestDesign = r.design; }
    }
    return { mf0, mf: best, it: starts, ms: now() - t0, design: bestDesign };
}

// ── synthesis inner refine + needle insertion ─────────────────────────────────────
// `engine` = the inner LOCAL refiner the synthesis loop uses to polish each
// candidate (dls | cg | newton | newton-cg | sqp) — the thing we sweep to find
// the best inner method per tool. Mirrors SYNTHESIS_INNER_ENGINES / the
// Needle/GE/Structural "engine" dropdown.
function refinePrune(design, ops, dMin, resolveMat, innerIter, engine = 'dls') {
    const opt = makeEngine(engine, ops, design, resolveMat, { dMin });
    let it = 0; while (it < innerIter && !opt.isConverged()) { opt.step(); it++; }
    const rd = opt.applyToDesign(design);
    const pd = { ...rd, frontLayers: cleanupLayers(rd.frontLayers || [], dMin) };
    return { design: pd, mf: mfOf(pd, ops, resolveMat) };
}
function insertOptimal(design, cand, ops, dMin, resolveMat) {
    cand._mat = resolveMat(cand.materialId);
    let dOpt = dMin;
    try {
        dOpt = findOptimalNeedleThickness({ operands: ops, design, resolveMat, candidate: cand, deltaNm: dMin, maxNm: 500, tol: 0.5, side: 'front' });
        if (!(dOpt >= dMin)) dOpt = dMin;
    } catch { dOpt = dMin; }
    return cand.intra
        ? insertNeedleIntra(design, cand, dOpt, 'front')
        : insertNeedle(design, cand.pos, cand.materialId, dOpt, 'front');
}

function synthQueue(state) {
    const { candidates } = scanNeedlesPFunction({
        operands: state.ops, design: state.work.design, resolveMat: state.resolveMat,
        candidateMats: state.pool, deltaNm: 0.5, side: 'front',
    });
    return cullMarginalNeedles(
        candidates.filter((c) => c.dMF < 0).sort((a, b) => a.dMF - b.dMF),
        state.cfg.needleSensFloor,
    );
}

function acceptSynthCandidate(state, queue) {
    for (const cand of queue) {
        if (now() - state.t0 >= state.budgetMs) break;
        const design = insertOptimal(state.work.design, cand, state.ops, state.dMin, state.resolveMat);
        const result = refinePrune(
            design, state.ops, state.dMin, state.resolveMat, state.innerIter, state.engine,
        );
        if (result.mf < state.work.mf - 1e-9) {
            state.work = result;
            updateSynthBest(state);
            return true;
        }
    }
    return false;
}

function updateSynthBest(state) {
    if (state.work.mf >= state.best.mf - 1e-9) return;
    state.best = { ...state.work };
    state.geStagn = 0;
    if (state.onTick) state.onTick({
        phase: state.forced ? 'ge' : 'needle',
        mf: state.best.mf,
        layers: frontCount(state.best.design),
        steps: state.steps,
        elapsed: now() - state.t0,
    });
}

function forceGeStep(state) {
    const geScan = scanGEInsertions({
        operands: state.ops, design: state.work.design, resolveMat: state.resolveMat,
        candidateMats: state.pool, thickNm: state.dMin, side: 'front',
    });
    if (!geScan.candidates.length) return false;
    const bestGe = geScan.candidates.reduce(
        (best, candidate) => (candidate.mfNew < best.mfNew ? candidate : best),
        geScan.candidates[0],
    );
    const inserted = insertNeedle(
        state.work.design, bestGe.pos, bestGe.materialId, state.dMin, 'front',
    );
    state.work = {
        design: { ...inserted, frontLayers: cleanupLayers(inserted.frontLayers || [], state.dMin) },
        mf: bestGe.mfNew,
    };
    state.geStagn++;
    return state.geStagn <= 6;
}

function makeSynthState(args) {
    const { forced, start, ops, dMin, resolveMat, cfg, onTick } = args;
    const pool = makePool(resolveMat);
    const innerIter = cfg.innerIter ?? SYNTH_DEFAULTS.innerIter;
    const engine = cfg.engine || 'dls';
    const work = refinePrune(deep(start), ops, dMin, resolveMat, innerIter, engine);
    return {
        forced, ops, dMin, resolveMat, cfg, onTick, innerIter, engine,
        pool,
        budgetMs: cfg.budgetMs ?? SYNTH_DEFAULTS.budgetMs,
        maxLayers: cfg.maxLayers ?? SYNTH_DEFAULTS.maxLayers,
        maxSteps: cfg.maxSteps ?? SYNTH_DEFAULTS.maxSteps,
        work,
        best: { ...work },
        t0: now(),
        geStagn: 0,
        steps: 0,
    };
}

/**
 * Unified Needle / Gradual-Evolution driver.
 *   forced=false → standalone Needle (stop when no improving needle)
 *   forced=true  → Gradual Evolution (forced-TOT step on stall + needle inner loop)
 * `onTick({phase, mf, layers, steps, elapsed})` is called as best improves.
 */
export function runSynth(forced, start, ops, dMin, resolveMat, cfg = {}, onTick) {
    const state = makeSynthState({ forced, start, ops, dMin, resolveMat, cfg, onTick });
    for (; state.steps < state.maxSteps && now() - state.t0 < state.budgetMs; state.steps++) {
        if (frontCount(state.work.design) >= state.maxLayers) break;
        if (acceptSynthCandidate(state, synthQueue(state))) continue;
        if (!forced) break;
        if (!forceGeStep(state)) break;
    }
    if (cfg.consolidate) state.best = consolidate(
        state.best, ops, dMin, resolveMat, state.innerIter, state.engine, cfg.consolidateTol,
    );
    return {
        mf: state.best.mf,
        layers: frontCount(state.best.design),
        ms: now() - state.t0,
        steps: state.steps,
        design: state.best.design,
    };
}

/**
 * Smart-seed driver: build the canonical QW/HW AR templates from the pool,
 * refine each, return the best. Shows what "a very good starting design + a
 * minimum of refinement" (Macleod) achieves for the case — the lever that
 * reaches compact classics (e.g. the 3-layer QHQ) that needle/GE miss.
 */
export function runSeed(C, ops, dMin, resolveMat, cfg = {}) {
    const pool = makePool(resolveMat);
    const engine = cfg.engine || 'dls';
    const refIter = Math.max(200, cfg.innerIter ?? SYNTH_DEFAULTS.innerIter);
    const lambda0 = bandCenter(C.ops);
    const t0 = now();
    const media = baseDesign([]); media.referenceWavelength = lambda0;
    const seeds = generateARSeeds({ pool, lambda0, baseDesign: media, maxLayers: cfg.maxLayers ?? 8 });
    if (!seeds.length) return { mf: Infinity, layers: 0, ms: now() - t0, design: media };
    const refineFn = (d) => { const r = refinePrune(d, ops, dMin, resolveMat, refIter, engine); return { mf: r.mf, design: r.design }; };
    const { best } = rankSeeds(seeds, refineFn);
    return { mf: best.mf, layers: frontCount(best.refinedDesign), ms: now() - t0, design: best.refinedDesign };
}

function makeStructuralState(args) {
    const { start, ops, dMin, resolveMat, cfg, onTick } = args;
    const pool = (cfg.poolIds && cfg.poolIds.length)
        ? cfg.poolIds.map((id) => ({ id, name: id, mat: resolveMat(id) }))
        : makePool(resolveMat);
    const innerIter = cfg.innerIter ?? SYNTH_DEFAULTS.innerIter;
    const engine = cfg.engine || 'dls';
    const structMaxIter = cfg.structMaxIter ?? SYNTH_DEFAULTS.structMaxIter;
    const current = refinePrune(deep(start), ops, dMin, resolveMat, innerIter, engine);
    return {
        ops, dMin, resolveMat, cfg, onTick, pool, innerIter, engine, structMaxIter,
        poolLite: pool.map((p) => ({ id: p.id, name: p.name })),
        budgetMs: cfg.budgetMs ?? SYNTH_DEFAULTS.budgetMs,
        maxLayers: cfg.maxLayers ?? SYNTH_DEFAULTS.maxLayers,
        structK: cfg.structK ?? SYNTH_DEFAULTS.structK,
        deepMode: !!cfg.deepMode,
        rng: makeRng(cfg.seed ?? 777),
        T0: 0.2,
        Tend: 0.2 * 0.005,
        current,
        best: { ...current },
        t0: now(),
        noImprove: 0,
        reheats: 0,
        cycleStart: 1,
        patience: Math.max(15, Math.round(structMaxIter / 3)),
        coolPeriod: Math.max(40, structMaxIter),
        itDone: 0,
        stopReason: 'maxIter',
    };
}

function structuralTemperature(state, it) {
    return state.deepMode
        ? deepTemperature(it - state.cycleStart, state.coolPeriod, state.T0, state.Tend)
        : temperatureAt(it / state.structMaxIter, state.T0, state.Tend);
}

function structuralProposals(state, it) {
    const currentLayers = state.current.design.frontLayers || [];
    const atCap = currentLayers.filter((layer) => !layer.locked).length >= state.maxLayers;
    const kinds = atCap ? ['remove', 'merge', 'perturb'] : MUTATION_KINDS;
    const proposals = [];
    if (!atCap) {
        const { candidates } = scanNeedlesPFunction({
            operands: state.ops, design: state.current.design, resolveMat: state.resolveMat,
            candidateMats: state.pool, deltaNm: 0.5, side: 'front',
        });
        const candidate = candidates.filter((x) => x.dMF < 0).sort((a, b) => a.dMF - b.dMF)[0];
        if (candidate) proposals.push({
            layers: insertOptimal(
                state.current.design, candidate, state.ops, state.dMin, state.resolveMat,
            ).frontLayers,
            mutation: { kind: 'add' },
        });
    }
    for (let j = proposals.length; j < state.structK; j++) {
        const proposal = proposeMutation(currentLayers, {
            rng: state.rng, pool: state.poolLite, dMin: state.dMin, dMax: 2000,
            addMaxNm: 120, jitterPct: 0.15, kinds,
        });
        if (proposal) proposals.push(proposal);
    }
    return { proposals, temperature: structuralTemperature(state, it) };
}

function evaluateStructuralProposals(state, proposals) {
    let bestResult = null;
    for (const proposal of proposals) {
        if (now() - state.t0 >= state.budgetMs) break;
        const result = refinePrune(
            { ...state.current.design, frontLayers: proposal.layers },
            state.ops, state.dMin, state.resolveMat, state.innerIter, state.engine,
        );
        if (!bestResult || result.mf < bestResult.mf) bestResult = result;
    }
    return bestResult;
}

function acceptStructuralResult(state, result, temperature, it) {
    if (metropolisAccept(state.current.mf, result.mf, temperature, state.rng)) {
        state.current = {
            design: {
                ...result.design,
                frontLayers: tidyLayers(result.design.frontLayers || [], state.dMin),
            },
            mf: result.mf,
        };
    }
    if (result.mf < state.best.mf - 1e-12) {
        state.best = { ...result };
        state.noImprove = 0;
        if (state.onTick) state.onTick({
            phase: 'structural', mf: state.best.mf, layers: frontCount(state.best.design),
            steps: it, elapsed: now() - state.t0,
        });
    } else {
        state.noImprove++;
    }
    if (state.current.mf > state.best.mf * 1.3) {
        state.current = { design: deep(state.best.design), mf: state.best.mf };
    }
}

function reheatStructuralState(state, it) {
    state.reheats++;
    const kicked = basinKick(deep(state.best.design.frontLayers || []), {
        rng: state.rng, pool: state.poolLite, dMin: state.dMin, dMax: 2000,
        addMaxNm: 120, jitterPct: 0.15, kinds: MUTATION_KINDS, maxKick: 3,
    });
    const result = refinePrune(
        { ...state.best.design, frontLayers: kicked },
        state.ops, state.dMin, state.resolveMat, state.innerIter, state.engine,
    );
    state.current = {
        design: { ...result.design, frontLayers: tidyLayers(result.design.frontLayers || [], state.dMin) },
        mf: result.mf,
    };
    if (result.mf < state.best.mf - 1e-12) {
        state.best = { ...result };
        if (state.onTick) state.onTick({
            phase: 'reheat', mf: state.best.mf, layers: frontCount(state.best.design),
            steps: it, elapsed: now() - state.t0,
        });
    }
    state.cycleStart = it + 1;
    state.noImprove = 0;
}

function structuralStagnationPhase(state, it) {
    const action = stagnationAction({
        deepMode: state.deepMode, noImprove: state.noImprove, patience: state.patience,
    });
    if (action === 'stop') state.stopReason = 'patience';
    if (action === 'reheat') reheatStructuralState(state, it);
    return action;
}

/** Structural optimizer driver — faithful to StructuralOptimizer.js.
 *  cfg.deepMode: drop the STRUCT_MAXIT cap + patience early-stop, and
 *  REHEAT + basin-kick on stagnation instead of stopping — runs until `budgetMs`.
 *  cfg.poolIds: override the candidate material pool (default POOL_IDS). */
export function runStructural(start, ops, dMin, resolveMat, cfg = {}, onTick) {
    const state = makeStructuralState({ start, ops, dMin, resolveMat, cfg, onTick });
    const HARD_CAP = 2_000_000;
    for (let it = 1;
        (state.deepMode ? it <= HARD_CAP : it <= state.structMaxIter) && now() - state.t0 < state.budgetMs;
        it++) {
        state.itDone = it;
        const { proposals, temperature } = structuralProposals(state, it);
        if (!proposals.length) { state.stopReason = 'noProposals'; break; }
        const bestResult = evaluateStructuralProposals(state, proposals);
        if (!bestResult) { state.noImprove++; continue; }
        acceptStructuralResult(state, bestResult, temperature, it);
        if (structuralStagnationPhase(state, it) === 'stop') break;
    }
    if (now() - state.t0 >= state.budgetMs) state.stopReason = 'budget';
    return {
        mf: state.best.mf,
        layers: frontCount(state.best.design),
        ms: now() - state.t0,
        design: state.best.design,
        reheats: state.reheats,
        iters: state.itDone,
        stopReason: state.stopReason,
    };
}

// ── job model: one (case × optimizer × setting) cell ──────────────────────────────
//
//   { id, caseId, group, optimizer, setting, kind, method?, maxIter?, dMin?, cfg? }
//   kind ∈ 'refine' | 'refine-global' | 'dls-multi' | 'needle' | 'ge' | 'structural'

const mntSuffix = (mnt) => (mnt ? ` ·MNT${mnt}` : '');

function appendJob(state, job) {
    state.jobs.push({ id: `j${state.jobs.length}`, ...job });
}

function addLocalJobs(state, caseId, mnt) {
    if (state.config.refineLocal === false) return;
    if (state.converge) {
        for (const method of LOCAL_METHODS) appendJob(state, {
            caseId, group: 'Refinement (local)', optimizer: method,
            setting: `→conv${mntSuffix(mnt)}`, kind: 'refine', method,
            maxIter: REFINE_MAXITER[method], dMin: 10, mnt,
        });
    } else {
        for (const method of LOCAL_METHODS) {
            for (const maxIter of state.maxIters) appendJob(state, {
                caseId, group: 'Refinement (local)', optimizer: method,
                setting: `maxIter=${maxIter}${mntSuffix(mnt)}`, kind: 'refine', method,
                maxIter, dMin: 10, mnt,
            });
        }
    }
}

function addGlobalJobs(state, caseId, mnt) {
    if (!state.config.refineGlobal) return;
    for (const method of GLOBAL_METHODS) appendJob(state, {
        caseId, group: 'Refinement (global)', optimizer: method,
        setting: `→conv${mntSuffix(mnt)}`, kind: 'refine-global', method,
        maxIter: GLOBAL_MAXITER[method], dMin: 10, mnt,
    });
    if (state.config.dlsMulti !== false) appendJob(state, {
        caseId, group: 'Refinement (global)', optimizer: 'dls-multi',
        setting: `6 starts${mntSuffix(mnt)}`, kind: 'dls-multi',
        maxIter: GLOBAL_MAXITER['dls-multi'], dMin: 10, mnt,
    });
}

function addSeedJob(state, caseId, mnt, engine, engineSuffix) {
    if (!state.config.seed) return;
    appendJob(state, {
        caseId, group: 'Synthesis', optimizer: 'seed', engine,
        setting: `seed${engineSuffix}${mntSuffix(mnt)}`, kind: 'seed',
        dMin: state.dMins[0] ?? 1, mnt, cfg: { ...state.synthCfg, engine },
    });
}

function addSynthesisToolJob(state, common, optimizer, kind) {
    appendJob(state, {
        caseId: common.caseId,
        group: common.group,
        optimizer,
        engine: common.engine,
        setting: common.setting,
        kind,
        dMin: common.dMin,
        mnt: common.mnt,
        cfg: common.cfg,
    });
}

function addSynthesisVariant(state, variant) {
    const { caseId, mnt, engine, engineSuffix, dMin, consolidateLayers } = variant;
    const consolidationSuffix = consolidateLayers ? ' ·cons' : '';
    const setting = `dMin=${dMin}${engineSuffix}${consolidationSuffix}${mntSuffix(mnt)}`;
    const cfg = {
        ...state.synthCfg, engine, consolidate: consolidateLayers, consolidateTol: 0.05,
    };
    const common = { caseId, group: 'Synthesis', engine, setting, dMin, mnt, cfg };
    if (state.config.needle) addSynthesisToolJob(state, common, 'needle', 'needle');
    if (state.config.ge) addSynthesisToolJob(state, common, 'ge', 'ge');
    if (state.config.structural) addSynthesisToolJob(state, common, 'structural', 'structural');
}

function addSynthesisJobs(state, caseId, mnt) {
    const consolidationSweep = state.config.consolidate ? [false, true] : [false];
    for (const engine of state.synthEngines) {
        const engineSuffix = state.synthEngines.length > 1 ? ` ·${engine}` : '';
        addSeedJob(state, caseId, mnt, engine, engineSuffix);
        for (const dMin of state.dMins) {
            for (const consolidateLayers of consolidationSweep) {
                addSynthesisVariant(state, {
                    caseId, mnt, engine, engineSuffix, dMin, consolidateLayers,
                });
            }
        }
    }
}

function makeJobBuildState(config) {
    return {
        config,
        caseIds: config.cases && config.cases.length
            ? config.cases
            : BENCH_CASES.map((benchCase) => benchCase.id),
        maxIters: config.refineMaxIters || REFINE_MAXITERS,
        dMins: config.dMins || DMIN_SWEEP,
        mnts: config.mnts && config.mnts.length ? config.mnts : [null],
        synthEngines: config.synthEngines && config.synthEngines.length
            ? config.synthEngines
            : ['dls'],
        synthCfg: config.synthCfg || {},
        converge: config.refineConverge != null
            ? config.refineConverge
            : !(config.refineMaxIters && config.refineMaxIters.length),
        jobs: [],
    };
}

/**
 * Expand a UI config into the full job list.
 * config = {
 *   cases:      [caseId,…]                 (default: all)
 *   refineLocal: bool
 *   refineConverge: bool  — run each refiner to convergence at its window budget
 *                           (REFINE_MAXITER); DEFAULT true unless refineMaxIters set
 *   refineMaxIters:[…]    — explicit flat-cap sweep instead of convergence
 *   refineGlobal: bool, dlsMulti: bool
 *   needle: bool, ge: bool, structural: bool, dMins:[1,40]
 *   synthEngines: ['dls','cg','newton','newton-cg','sqp']   inner-refiner sweep
 *                                          for synthesis tools (default ['dls'])
 *   mnts: [null, 40]                       MNT minimum-thickness constraint sweep
 *                                          (null = unconstrained; default [null])
 *   synthCfg: { budgetMs, maxSteps, maxLayers, innerIter, structK, structMaxIter }
 * }
 */
export function buildJobs(config = {}) {
    const state = makeJobBuildState(config);
    for (const caseId of state.caseIds) {
        if (!caseById(caseId)) continue;
        for (const mnt of state.mnts) {
            addLocalJobs(state, caseId, mnt);
            addGlobalJobs(state, caseId, mnt);
            addSynthesisJobs(state, caseId, mnt);
        }
    }
    return state.jobs;
}

/**
 * Pareto frontier over (mf, ms, layers) — all three MINIMIZED. Returns the
 * subset of `points` that is NOT dominated (no other point is ≤ in all three
 * and < in at least one). Each point needs numeric .mf, .ms, .layers.
 */
export function paretoFront(points) {
    const pts = points.filter((p) => p && Number.isFinite(p.mf) && Number.isFinite(p.ms) && Number.isFinite(p.layers));
    const dominates = (a, b) =>
        a.mf <= b.mf && a.ms <= b.ms && a.layers <= b.layers &&
        (a.mf < b.mf || a.ms < b.ms || a.layers < b.layers);
    return pts.filter((p) => !pts.some((q) => q !== p && dominates(q, p)));
}

/**
 * The STARTING-POINT design a job runs from (for the "open seed" button):
 * Needle → thick seed, GE/Structural → thin seed, refinement → the fixed
 * perturbed QWOT stack. Returns null for an unknown case.
 */
export function seedForJob(job) {
    const C = caseById(job.caseId);
    if (!C) return null;
    switch (job.kind) {
        case 'needle':     return C.thick();
        case 'ge':
        case 'structural':
        case 'seed':       return C.thin();
        default:           return refineStart(C.refineN);
    }
}

/**
 * The merit operands for a job — to attach as a loaded design's meritOperands so
 * the inspected design shows the SAME merit function the cell ran against. For a
 * constrained cell (job.mnt set) this includes the MNT min-thickness operand, so
 * opening a constrained seed/result shows the constraint in its MF (and, for
 * Needle which ignores MNT by design, the resulting violation).
 */
export function operandsForJob(job) {
    const C = caseById(job.caseId);
    if (!C) return [];
    return job && job.mnt ? [...C.ops, mntOperand(job.mnt)] : C.ops;
}

function runRefinementJob(state) {
    return runRefine(
        state.job.method, refineStart(state.C.refineN), state.optOps,
        state.job.maxIter, state.job.dMin, state.resolveMat,
    );
}

function runDlsMultiJob(state) {
    return runDlsMulti(
        refineStart(state.C.refineN), state.optOps, state.job.maxIter,
        state.job.dMin, state.resolveMat, 6,
    );
}

function runNeedleJob(state) {
    return runSynth(
        false, state.C.thick(), state.baseOps, state.job.dMin,
        state.resolveMat, state.job.cfg, state.onTick,
    );
}

function runGeJob(state) {
    const dMin = state.job.mnt
        ? Math.max(state.job.dMin, state.job.mnt)
        : state.job.dMin;
    return runSynth(
        true, state.C.thin(), state.optOps, dMin,
        state.resolveMat, state.job.cfg, state.onTick,
    );
}

function runStructuralJob(state) {
    return runStructural(
        state.C.thin(), state.optOps, state.job.dMin,
        state.resolveMat, state.job.cfg, state.onTick,
    );
}

function runSeedJob(state) {
    const dMin = state.job.mnt
        ? Math.max(state.job.dMin, state.job.mnt)
        : state.job.dMin;
    return runSeed(state.C, state.optOps, dMin, state.resolveMat, state.job.cfg);
}

const JOB_RUNNERS = new Map([
    ['refine', runRefinementJob],
    ['refine-global', runRefinementJob],
    ['dls-multi', runDlsMultiJob],
    ['needle', runNeedleJob],
    ['ge', runGeJob],
    ['structural', runStructuralJob],
    ['seed', runSeedJob],
]);

function reportJobResult(result, state) {
    if (result.err) return result;
    return {
        mf: result.design ? mfOf(result.design, state.baseOps, state.resolveMat) : result.mf,
        layers: result.layers != null ? result.layers : state.C.refineN,
        ms: result.ms,
        it: result.it,
        mf0: result.mf0,
        minThk: result.design ? minFrontThk(result.design) : null,
        mnt: state.job.mnt || null,
        design: result.design || null,
    };
}

/** Run ONE job. `resolveMat` resolves material ids; `onTick` streams synth progress. */
export function runJob(job, resolveMat, { onTick } = {}) {
    const C = caseById(job.caseId);
    // Optimize WITH the MNT constraint (penalty in the DLS residual / SQP box)
    // when job.mnt is set; ALWAYS report the OPTICAL-only MF on the base operands
    // (comparable across constrained / unconstrained) plus minThk so you can see
    // whether the d ≥ mnt constraint was actually honored.
    //
    // FIDELITY to the real tools: Needle STRIPS thickness constraints by design
    // (NeedleVariation.js: densifyForRun(enabled.filter(op => !isConstraint(...))))
    // — an active MNT penalty wipes out every improving needle candidate, so
    // Needle always runs optical-only and IGNORES MNT. GE keeps the constraint
    // (GradualEvolution.js does NOT filter constraints; its DLS refine applies the
    // penalty, even though the needle SCAN sub-step is optical) and so do
    // Refinement and Structural. Hence Needle shows MNT violations; GE/Structural/
    // Refinement honor it.
    let output;
    if (!C) {
        output = { err: `unknown case ${job.caseId}` };
    } else {
        const baseOps = C.ops;
        const state = {
            job, C, baseOps, resolveMat, onTick,
            optOps: job.mnt ? [...baseOps, mntOperand(job.mnt)] : baseOps,
        };
        const runner = JOB_RUNNERS.get(job.kind);
        output = runner
            ? reportJobResult(runner(state), state)
            : { err: `unknown kind ${job.kind}` };
    }
    return output;
}
