/**
 * Error Analysis & Layer Sensitivity utilities.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Layer Sensitivity
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Each variable layer is ranked by the sensitivity of the merit function
 * to a small variation of its thickness:
 *
 *     ΔMF_j = MF(d₁, …, d_j + Δd_j, …, d_N) − MF(d₁, …, d_j, …, d_N)
 *
 * Layers are then scaled to the maximum |ΔMF| and expressed as a percentage,
 * with the most sensitive layer = 100 %.
 *
 * We compute ΔMF via central differences against the existing merit-operand
 * machinery (`buildEvalContext` / `evaluateOperands` / `calcMF`), so the
 * sensitivity is naturally surface-mode-aware (front_only / back_only /
 * symmetric / both_independent) and consistent with what the optimizer sees.
 *
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Monte Carlo Error Analysis
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Statistical evaluation of the influence of random manufacturing errors on a
 * spectral characteristic — following Macleod §13.7 ("Tolerances"):
 *
 *     RMS_j^res = RMS_abs + RMS_rel · d_j
 *
 * for layer thicknesses, plus optional absolute σ on Re(n) and Im(n). For each
 * Monte-Carlo trial we draw independent Gaussian deviations for every layer,
 * rebuild a perturbed design, evaluate the chosen spectral characteristic
 * (T, R or A; s/p/avg; one AOI), and accumulate online sums. The output is the
 * theoretical curve plus the sample mean ("Exp") and ±kσ corridors (k = 1 by
 * default).
 *
 * Reference: Macleod 5th ed. §13.7 — Monte Carlo is the established way to
 * model manufacturing tolerances:
 *   "Such modeling, almost invariably of the Monte Carlo type, allows the
 *    study of errors and tolerances in an almost completely realistic way."
 *
 *
 * No new physics is introduced here — every spectral evaluation routes through
 * the validated `evaluateSpectrum` / `evaluateSpectrumBack` / `evaluateSpectrumTotal`
 * TMM in `thinFilmMath.js`, and the merit-function path reuses
 * `evaluateOperands` / `calcMF` from `optimizer.js`.
 */

import {
    evaluateSpectrum,
    evaluateSpectrumBack,
    evaluateSpectrumTotal,
} from './thinFilmMath.js';
import {
    buildEvalContext,
    evaluateOperands,
    calcMF,
} from './optimizer.js';
import {
    evaluateQualifiers,
    aggregateVerdict,
} from '../synthesis/qualifiers.js';

// ── Random number generation ──────────────────────────────────────────────────

/**
 * Box–Muller transform: two independent Gaussian samples (mean 0, σ = 1) from
 * two uniforms in (0, 1]. We use Math.random() so trials are not reproducible
 * by default; callers wanting determinism should inject a seeded RNG.
 */
function gauss2(rng) {
    // Avoid u1 == 0 (log(0) = −∞)
    let u1 = rng();
    while (u1 <= 1e-12) u1 = rng();
    const u2 = rng();
    const mag = Math.sqrt(-2 * Math.log(u1));
    const ang = 2 * Math.PI * u2;
    return [mag * Math.cos(ang), mag * Math.sin(ang)];
}

/**
 * Draw one random parameter deviation according to the selected distribution.
 *
 * `level` is the per-layer error magnitude from the tolerance formula
 * (RMS_abs + RMS_rel·d for thickness; the absolute σ for n/k). Its
 * interpretation depends on the distribution:
 *
 *   'gaussian'  (default) — `level` is the RMS / standard
 *               deviation σ. Draw N(0, σ); deviations are UNBOUNDED (a true
 *               Gaussian tail), so |Δ| > level occurs ~32 % of the time
 *               (resulting RMS error = RMS_abs + RMS_rel·d, corridor = one
 *               standard deviation).
 *
 *   'uniform'   — `level` is a HARD bound B. Draw uniformly on [−B, +B]; every
 *               deviation inside the band is equally likely and |Δ| never
 *               exceeds B. This is the worst-case ±tolerance-band model
 *               (Abs.Dev sets upper limits). The
 *               realized RMS is B/√3 ≈ 0.577·B.
 *
 *   'truncated' — `level` is a HARD bound B interpreted as 3σ (σ = B/3). Draw
 *               N(0, σ) but reject/redraw any |g| > 3σ, giving a bell shape
 *               that never exceeds ±B. Realized RMS ≈ 0.97·(B/3).
 *
 * All three measure the spectral corridor from the *realized* trial spectra,
 * so corridorSigma still multiplies the empirical σ regardless of which draw
 * shape produced the perturbations.
 */
function sampleDeviation(level, distribution, rng) {
    if (!(level > 0)) return 0;
    if (distribution === 'uniform') {
        // level = hard half-width bound B; uniform on [−B, +B]
        return (rng() * 2 - 1) * level;
    }
    if (distribution === 'truncated') {
        // level = hard bound B = 3σ; Gaussian σ=B/3, rejection-clipped to ±B
        const sigma = level / 3;
        let g = gauss2(rng)[0];
        // Rejection sampling: |g| ≤ 3 guarantees |Δ| ≤ B. Bounded iteration
        // count in practice (P(|g|>3) ≈ 0.27 %), but cap to stay safe.
        for (let tries = 0; Math.abs(g) > 3 && tries < 50; tries++) g = gauss2(rng)[0];
        if (Math.abs(g) > 3) g = g > 0 ? 3 : -3; // hard clamp fallback
        return g * sigma;
    }
    // 'gaussian' (default): level = σ (RMS), unbounded tails
    return gauss2(rng)[0] * level;
}

// ── Layer sensitivity ─────────────────────────────────────────────────────────

function buildSensitivityVariables(surfaceMode, front, back) {
    if (surfaceMode === 'both_independent') {
        return [
            ...front.map((layer, layerIndex) => ({ side: 'front', layerIndex, layer })),
            ...back.map((layer, layerIndex) => ({ side: 'back', layerIndex, layer })),
        ];
    }
    if (surfaceMode === 'back_only') {
        return back.map((layer, layerIndex) => ({ side: 'back', layerIndex, layer }));
    }
    return front.map((layer, layerIndex) => ({ side: 'front', layerIndex, layer }));
}

function evaluateSensitivityThickness({ design, operands, resolveMat, surfaceMode,
    side, layerIndex, thickness, mfOptions }) {
    const ctx = buildEvalContext(design, resolveMat);
    if (side === 'front') {
        ctx.frontThicks = [...ctx.frontThicks];
        ctx.frontThicks[layerIndex] = thickness;
        if (surfaceMode === 'symmetric') ctx.backThicks = [...ctx.frontThicks].reverse();
    } else {
        ctx.backThicks = [...ctx.backThicks];
        ctx.backThicks[layerIndex] = thickness;
    }

    if (surfaceMode === 'both_independent') {
        ctx.fullThicks = [...ctx.frontThicks, ...ctx.backThicks];
    } else if (surfaceMode === 'back_only') {
        ctx.fullThicks = ctx.backThicks;
    } else {
        ctx.fullThicks = ctx.frontThicks;
    }
    const comp = evaluateOperands(operands, ctx);
    return calcMF(operands, comp, mfOptions);
}

function makeSensitivityRow(variable, index, settings) {
    const { side, layerIndex, layer } = variable;
    const locked = !!layer.locked;
    if (locked && !settings.includeLocked) return null;

    const thickness = layer.thickness || 0;
    const delta = settings.mode === 'absolute'
        ? Math.max(1e-6, Math.abs(settings.absDeltaNm))
        : Math.max(1e-6, thickness * settings.relPct / 100);
    const plus = thickness + delta;
    const minus = Math.max(0, thickness - delta);
    const span = plus - minus;
    const mfPlus = evaluateSensitivityThickness({
        ...settings, side, layerIndex, thickness: plus,
    });
    const mfMinus = evaluateSensitivityThickness({
        ...settings, side, layerIndex, thickness: minus,
    });
    const deltaMF = span > 0 ? (mfPlus - mfMinus) / span * (2 * delta) : 0;

    return {
        index,
        side,
        layerIndex,
        materialId: layer.material,
        thickness,
        deltaNm: delta,
        deltaMFAbs: Math.abs(deltaMF),
        deltaMF,
        sensitivity: 0,
        locked,
    };
}

function scaleSensitivityRows(rows) {
    let maxAbs = 0;
    for (const row of rows) if (row.deltaMFAbs > maxAbs) maxAbs = row.deltaMFAbs;
    if (maxAbs > 0) {
        for (const row of rows) row.sensitivity = 100 * row.deltaMFAbs / maxAbs;
    }
}

/**
 * Per-layer merit-function sensitivity ranking.
 *
 * For each *unlocked* layer j (across front and, in symmetric / both_independent
 * / back_only modes, back too — whatever DLS sees as a free variable), compute
 *
 *     ΔMF_j = (MF(d_j + Δd) − MF(d_j − Δd)) / 2          [central difference]
 *
 * where Δd_j is either `absDeltaNm` or `relPct·d_j/100` depending on `mode`.
 * The "sensitivity %" is |ΔMF_j| scaled so that the max layer = 100.
 *
 * @param {object}  design       the design object (CLAUDE.md schema)
 * @param {Array}   operands     `design.meritOperands` (or any operand list)
 * @param {Function} resolveMat  id → material object (with `.getNK(λ)`)
 * @param {object}  [opts]
 *   - mode:          'absolute' | 'relative'      (default 'relative')
 *   - absDeltaNm:    Δd in nm when mode='absolute' (default 1)
 *   - relPct:        Δd / d × 100 when mode='relative' (default 1)
 *   - includeLocked: if true, locked layers also analysed (default false)
 *
 * @returns {{
 *   rows:   Array<{
 *     index:        number,   // 0-based index in the optimization vector
 *     side:         'front'|'back',
 *     layerIndex:   number,   // 0-based index within frontLayers/backLayers
 *     materialId:   string,
 *     thickness:    number,   // nm
 *     deltaNm:      number,   // Δd actually used (nm)
 *     deltaMFAbs:   number,   // |ΔMF_j|  (absolute)
 *     deltaMF:      number,   //  ΔMF_j   (signed central difference)
 *     sensitivity:  number,   // 0..100   (% of max layer)
 *     locked:       boolean,
 *   }>,
 *   mf0: number,              // MF at the unperturbed design
 *   surfaceMode: string,
 * }}
 */
export function computeLayerSensitivity(design, operands, resolveMat, opts = {}) {
    const surfaceMode = design?.surfaceMode || 'front_only';
    const front = design.frontLayers || [];
    const back  = surfaceMode === 'symmetric' ? [...front].reverse() : (design.backLayers || []);
    const variables = buildSensitivityVariables(surfaceMode, front, back);

    // Error analysis ranks layers by *optical* sensitivity. MNT/MXT thickness
    // constraints (one-sided quadratic penalties used during DLS refinement)
    // would dominate ΔMF for any layer whose thickness sits within Δd of a
    // bound — e.g. a 42 nm layer with MNT=40 nm trips a huge penalty under
    // a −5 nm perturbation, swamping the actual optical contribution. The
    // sensitivity ranking must reflect spectrum behaviour, not constraint
    // proximity, so we evaluate MF with constraints disabled — matching what
    // the needle / GE scans use as their optical merit.
    const MF_OPT = { skipConstraints: true };
    const ctx0 = buildEvalContext(design, resolveMat);
    const comp0 = evaluateOperands(operands, ctx0);
    const mf0   = calcMF(operands, comp0, MF_OPT);
    const rows = [];
    const settings = {
        design,
        operands,
        resolveMat,
        surfaceMode,
        mfOptions: MF_OPT,
        mode: opts.mode ?? 'relative',
        absDeltaNm: opts.absDeltaNm ?? 1.0,
        relPct: opts.relPct ?? 1.0,
        includeLocked: !!opts.includeLocked,
    };
    for (let i = 0; i < variables.length; i++) {
        const row = makeSensitivityRow(variables[i], i, settings);
        if (row) rows.push(row);
    }
    scaleSensitivityRows(rows);
    return { rows, mf0, surfaceMode };
}

// ── Spectrum evaluator factored out for Monte Carlo ───────────────────────────

/**
 * Evaluate the chosen spectral characteristic on a *modified* design.
 *
 * `modLayers` may be different objects than `design.frontLayers` /
 * `design.backLayers` — we always pass them through the design's `evalMode`
 * routing (front / back / total) and recompute spectrally on the same grid.
 *
 * `getMatForLayer(side, layerIdx)` lets callers inject perturbed material
 * proxies (n,k variations). When not supplied, the original material from
 * the layer's `material` id is used via `resolveMat`.
 */
function evaluateChar({ design, params, evalMode, resolveMat,
    frontLayers, backLayers, getMatForLayer }) {
    const incId = typeof design.incidentMedium === 'string'
        ? design.incidentMedium : (design.incidentMedium?.material ?? 'Air');
    const exitId = typeof design.exitMedium === 'string'
        ? design.exitMedium : (design.exitMedium?.material ?? 'Air');
    const subId = design.substrate?.material ?? 'BK7';
    const subThick = design.substrate?.thickness ?? 1.0;

    const incMat  = resolveMat(incId);
    const subMat  = resolveMat(subId);
    const exitMat = resolveMat(exitId);

    // H10: capture the ORIGINAL (unfiltered) layer index BEFORE dropping
    // zero-thickness layers, and hand THAT index to getMatForLayer. The trial's
    // perturbation arrays (dThk/dn/dk) and matsFront/matsBack are all on the
    // unfiltered index space, so a layer that is 0 nm nominally — or clamped to
    // 0 by this trial's draw — must not shift the material lookup for the layers
    // after it.
    const fLayers = (frontLayers || [])
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => l.thickness > 0)
        .map(({ l, i }) => ({
            material:  getMatForLayer ? getMatForLayer('front', i) : resolveMat(l.material),
            thickness: l.thickness,
        }));
    const bLayers = (backLayers || [])
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => l.thickness > 0)
        .map(({ l, i }) => ({
            material:  getMatForLayer ? getMatForLayer('back', i) : resolveMat(l.material),
            thickness: l.thickness,
        }));

    if (evalMode === 'back') {
        return evaluateSpectrumBack(params, exitMat, subMat, bLayers);
    }
    if (evalMode === 'total') {
        return evaluateSpectrumTotal(params, incMat, subMat, exitMat,
                                     fLayers, bLayers, subThick);
    }
    return evaluateSpectrum(params, incMat, subMat, fLayers);
}

/**
 * Build a material proxy with shifted n,k. Wraps the underlying material's
 * `getNK(λ)` so dispersion is preserved; the perturbation is a constant
 * additive offset (a per-layer absolute σ on Re(n) / Im(n)).
 *
 * `dn` adds to n; `dk` adds to k (k ≥ 0 absorbing convention). All other
 * material fields are kept; this proxy is intended for one Monte-Carlo trial
 * only.
 */
function makeShiftedMaterial(baseMat, dn, dk) {
    if (!dn && !dk) return baseMat;
    return {
        ...baseMat,
        getNK: (lam) => {
            const [n, k] = baseMat.getNK(lam);
            return [n + dn, k + dk];
        },
    };
}

function makeMCConfig(design, params, resolveMat, opts) {
    const evalMode = opts.evalMode ?? 'front';
    const rmsReN = opts.rmsReN ?? 0;
    const rmsImN = opts.rmsImN ?? 0;
    return {
        design,
        params,
        resolveMat,
        char: opts.char ?? 'R',
        evalMode,
        nTrials: Math.max(1, Math.floor(opts.nTrials ?? 20)),
        corridorSigma: opts.corridorSigma ?? 1.0,
        rmsAbsNm: opts.rmsAbsNm ?? 0,
        rmsRelPct: opts.rmsRelPct ?? 1,
        rmsReN,
        rmsImN,
        distribution: opts.distribution ?? 'gaussian',
        keepOpticalThickness: !!opts.keepOpticalThickness,
        perMaterialErrors: !!opts.perMaterialErrors,
        rng: opts.rng || Math.random,
        onTrial: opts.onTrial || null,
        evaluateSpec: !!opts.evaluateSpec,
        qualifiers: opts.qualifiers || design.qualifiers || [],
        recordTrials: !!opts.recordTrials,
        shouldCancel: typeof opts.shouldCancel === 'function' ? opts.shouldCancel : null,
        onYield: typeof opts.onYield === 'function' ? opts.onYield : null,
        yieldEvery: Math.max(1, Math.floor(opts.yieldEvery ?? 8)),
        front: design.frontLayers || [],
        back: design.backLayers || [],
        usesFront: evalMode === 'front' || evalMode === 'total',
        usesBack: evalMode === 'back' || evalMode === 'total',
        hasIndexErrors: !!(rmsReN || rmsImN),
        lambdaReference: 0.5 * (params.lambdaStart + params.lambdaEnd),
    };
}

function initializeMCState(config) {
    const theoryRun = evaluateChar({
        ...config,
        frontLayers: config.front,
        backLayers: config.back,
        getMatForLayer: null,
    });
    const lambdas = theoryRun.lambda;
    const nLambda = lambdas.length;
    return {
        lambdas,
        theory: theoryRun[config.char],
        nLambda,
        mean: new Float64Array(nLambda),
        m2: new Float64Array(nLambda),
        min: new Float64Array(nLambda).fill(Infinity),
        max: new Float64Array(nLambda).fill(-Infinity),
        runningN: 0,
        specPass: 0,
        specEvaluated: 0,
        qualifierFailures: config.qualifiers.map(() => 0),
        trials: [],
        // Material and deviation arrays share the original, unfiltered layer index.
        frontMaterials: config.front.map((layer) => config.resolveMat(layer.material)),
        backMaterials: config.back.map((layer) => config.resolveMat(layer.material)),
    };
}

function drawThicknessDeviations(layers, config) {
    const deviations = new Float64Array(layers.length);
    for (let i = 0; i < layers.length; i++) {
        if (layers[i].thickness <= 0) {
            deviations[i] = 0;
            continue;
        }
        const level = config.rmsAbsNm + (config.rmsRelPct / 100) * layers[i].thickness;
        deviations[i] = sampleDeviation(level, config.distribution, config.rng);
    }
    return deviations;
}

function reuseMaterialDeviations(layers, idDraws) {
    const dn = new Float64Array(layers.length);
    const dk = new Float64Array(layers.length);
    for (let i = 0; i < layers.length; i++) {
        const deviation = idDraws.get(layers[i].material);
        if (deviation) {
            dn[i] = deviation.dn;
            dk[i] = deviation.dk;
        }
    }
    return [dn, dk];
}

function drawPerMaterialIndexDeviations(config) {
    // Front-first insertion order is part of the seeded Monte Carlo sequence.
    const needed = new Set();
    for (const layer of config.front) if (layer.thickness > 0) needed.add(layer.material);
    for (const layer of config.back) if (layer.thickness > 0) needed.add(layer.material);

    const idDraws = new Map();
    for (const id of needed) {
        idDraws.set(id, {
            dn: sampleDeviation(config.rmsReN, config.distribution, config.rng),
            dk: sampleDeviation(config.rmsImN, config.distribution, config.rng),
        });
    }
    const [dnF, dkF] = reuseMaterialDeviations(config.front, idDraws);
    const [dnB, dkB] = reuseMaterialDeviations(config.back, idDraws);
    return { dnF, dkF, dnB, dkB };
}

function drawLayerIndexDeviations(count, config) {
    const dn = new Float64Array(count);
    const dk = new Float64Array(count);
    for (let i = 0; i < count; i++) {
        // Keep dn/dk interleaved for each layer to preserve RNG draw order.
        dn[i] = sampleDeviation(config.rmsReN, config.distribution, config.rng);
        dk[i] = sampleDeviation(config.rmsImN, config.distribution, config.rng);
    }
    return [dn, dk];
}

function drawPerLayerIndexDeviations(config) {
    const [dnF, dkF] = drawLayerIndexDeviations(config.front.length, config);
    const [dnB, dkB] = drawLayerIndexDeviations(config.back.length, config);
    return { dnF, dkF, dnB, dkB };
}

function linkOpticalThickness(layers, materials, dn, thicknessDeviations, lambdaReference) {
    for (let i = 0; i < layers.length; i++) {
        if (layers[i].thickness <= 0 || !materials[i]) continue;
        const [nNom] = materials[i].getNK(lambdaReference);
        const nNew = nNom + dn[i];
        if (nNew > 1e-3) {
            thicknessDeviations[i] = layers[i].thickness * (nNom / nNew - 1);
        }
    }
}

function maskUnusedSides(draws, config) {
    if (!config.usesFront) {
        draws.dThkF.fill(0);
        draws.dnF.fill(0);
        draws.dkF.fill(0);
    }
    if (!config.usesBack) {
        draws.dThkB.fill(0);
        draws.dnB.fill(0);
        draws.dkB.fill(0);
    }
}

function perturbLayers(layers, thicknessDeviations) {
    return layers.map((layer, index) => ({
        ...layer,
        thickness: Math.max(0, layer.thickness + thicknessDeviations[index]),
    }));
}

function makeTrialMaterialResolver(draws, state, config) {
    if (!config.hasIndexErrors) return null;
    return (side, index) => {
        const baseMaterials = side === 'front' ? state.frontMaterials : state.backMaterials;
        const dn = side === 'front' ? draws.dnF : draws.dnB;
        const dk = side === 'front' ? draws.dkF : draws.dkB;
        const base = baseMaterials[index];
        if (!base) return base;
        const indexK = dk[index];
        const baseK = base.getNK(config.lambdaReference)[1];
        // A shifted material cannot cross into negative absorption.
        const clampedK = (baseK + indexK < 0) ? -baseK : indexK;
        return makeShiftedMaterial(base, dn[index], clampedK);
    };
}

function prepareMCTrial(config, state) {
    // Draw front and back unconditionally; side masking occurs only after all draws.
    const dThkF = drawThicknessDeviations(config.front, config);
    const dThkB = drawThicknessDeviations(config.back, config);
    const indexDraws = config.perMaterialErrors
        ? drawPerMaterialIndexDeviations(config)
        : drawPerLayerIndexDeviations(config);
    const draws = { dThkF, dThkB, ...indexDraws };

    if (config.keepOpticalThickness) {
        linkOpticalThickness(config.front, state.frontMaterials, draws.dnF,
            draws.dThkF, config.lambdaReference);
        linkOpticalThickness(config.back, state.backMaterials, draws.dnB,
            draws.dThkB, config.lambdaReference);
    }
    maskUnusedSides(draws, config);

    const frontLayers = perturbLayers(config.front, draws.dThkF);
    const backLayers = perturbLayers(config.back, draws.dThkB);
    return {
        ...draws,
        frontLayers,
        backLayers,
        getMatForLayer: makeTrialMaterialResolver(draws, state, config),
    };
}

function updateMCStatistics(state, values) {
    state.runningN++;
    for (let i = 0; i < state.nLambda; i++) {
        const x = values[i];
        const d1 = x - state.mean[i];
        state.mean[i] += d1 / state.runningN;
        const d2 = x - state.mean[i];
        state.m2[i] += d1 * d2;
        if (x < state.min[i]) state.min[i] = x;
        if (x > state.max[i]) state.max[i] = x;
    }
}

function accumulateSpecificationVerdict(state, results, verdict) {
    if (verdict.total > 0) {
        state.specEvaluated++;
        if (verdict.allPass) state.specPass++;
    }
    results.forEach((result, index) => {
        if (result && result.pass === false) state.qualifierFailures[index]++;
    });
}

function formatTrialSpecification(qualifiers, results, verdict) {
    return {
        allPass: verdict.allPass,
        passing: verdict.passing,
        total: verdict.total,
        results: results.map((result, index) => ({
            label: qualifiers[index].label || qualifiers[index].kind || ('#' + (index + 1)),
            pass: result ? result.pass : null,
            value: result ? result.displayValue : null,
        })),
    };
}

function evaluateTrialSpecification(config, state, frontLayers, backLayers) {
    let trialSpec = null;
    if (config.evaluateSpec && config.qualifiers.length) {
        const perturbedDesign = {
            ...config.design,
            frontLayers,
            backLayers,
        };
        try {
            const results = evaluateQualifiers(config.qualifiers, perturbedDesign, config.resolveMat);
            const verdict = aggregateVerdict(results);
            accumulateSpecificationVerdict(state, results, verdict);
            trialSpec = formatTrialSpecification(config.qualifiers, results, verdict);
        } catch (_) { /* skip this trial's spec check */ }
    }
    return trialSpec;
}

function recordMCTrial(config, state, trial, data, spec) {
    if (!config.recordTrials) return;
    state.trials.push({
        i: trial + 1,
        dThkF: config.usesFront ? Array.from(data.dThkF) : null,
        dThkB: config.usesBack ? Array.from(data.dThkB) : null,
        dnF: (config.hasIndexErrors && config.usesFront) ? Array.from(data.dnF) : null,
        dkF: (config.hasIndexErrors && config.usesFront) ? Array.from(data.dkF) : null,
        dnB: (config.hasIndexErrors && config.usesBack) ? Array.from(data.dnB) : null,
        dkB: (config.hasIndexErrors && config.usesBack) ? Array.from(data.dkB) : null,
        spec,
    });
}

function makeMCSpecSummary(config, state) {
    if (!(config.evaluateSpec && config.qualifiers.length)) return null;
    return {
        nTrials: state.runningN,
        evaluated: state.specEvaluated,
        passCount: state.specPass,
        yield: state.specEvaluated > 0 ? state.specPass / state.specEvaluated : null,
        perQualifier: config.qualifiers.map((qualifier, index) => ({
            label: qualifier.label || qualifier.kind || ('#' + (index + 1)),
            failRate: state.runningN > 0 ? state.qualifierFailures[index] / state.runningN : 0,
        })),
    };
}

function finalizeMCResult(config, state) {
    const stdev = new Float64Array(state.nLambda);
    for (let i = 0; i < state.nLambda; i++) {
        stdev[i] = state.runningN > 0 ? Math.sqrt(state.m2[i] / state.runningN) : 0;
    }

    const lower = new Array(state.nLambda);
    const upper = new Array(state.nLambda);
    const envLower = new Array(state.nLambda);
    const envUpper = new Array(state.nLambda);
    for (let i = 0; i < state.nLambda; i++) {
        lower[i] = Math.max(0, state.mean[i] - config.corridorSigma * stdev[i]);
        upper[i] = Math.min(1, state.mean[i] + config.corridorSigma * stdev[i]);
        envLower[i] = state.runningN > 0 ? Math.max(0, state.min[i]) : state.mean[i];
        envUpper[i] = state.runningN > 0 ? Math.min(1, state.max[i]) : state.mean[i];
    }

    return {
        lambda: state.lambdas,
        theory: Array.from(state.theory),
        mean: Array.from(state.mean),
        stdev: Array.from(stdev),
        lower,
        upper,
        envLower,
        envUpper,
        nTrials: state.runningN,
        char: config.char,
        spec: makeMCSpecSummary(config, state),
        trials: config.recordTrials ? state.trials : null,
    };
}

// ── Monte Carlo error analysis ────────────────────────────────────────────────

/**
 * Statistical error analysis (Macleod §13.7).
 *
 * For each of N trials, draw independent Gaussian deviations:
 *
 *     Δd_j  ~ N(0, σ_d_j)   with σ_d_j = rmsAbsNm + (rmsRelPct/100) · d_j
 *     Δn_j  ~ N(0, σ_n_j)   (Re(n)  absolute σ)
 *     Δk_j  ~ N(0, σ_k_j)   (Im(n)  absolute σ — k ≥ 0 enforced afterwards)
 *
 * The "keep optical thickness" option
 * links Δd and Δn so n·d stays at the nominal value: d → d · n_nom / (n_nom + Δn).
 * In that case Δd is *derived* from Δn (not drawn independently): the optical
 * thickness of a layer with random variations in thickness and refractive
 * indices is held equal to the initial optical thickness of the same layer.
 *
 * Then a single chosen spectral characteristic C(λ) ∈ {T, R, A} for s/p/avg at
 * a single AOI is evaluated, and online mean + variance are accumulated:
 *
 *     C̄(λ)  = (1/N) Σ C_i(λ)
 *     σ²(λ) = (1/N) Σ (C_i(λ) − C̄(λ))²        (sample, no Bessel correction)
 *
 * (Welford's online algorithm.) The output corridor is mean ± k·σ (k from
 * `corridorSigma`, default 1 — one standard deviation).
 *
 * @param {object}   design
 * @param {object}   params   { lambdaStart, lambdaEnd, lambdaStep, theta, polarization }
 * @param {Function} resolveMat
 * @param {object}   opts
 *   - char:           'T'|'R'|'A'       (default 'R')
 *   - evalMode:       'front'|'back'|'total'  (default 'front')
 *   - nTrials:        number of Monte-Carlo runs (default 20)
 *   - corridorSigma:  k in mean ± k·σ corridor (default 1)
 *   - rmsAbsNm:       per-layer thickness σ — absolute component, in nm (default 0)
 *   - rmsRelPct:      per-layer thickness σ — relative component, % of d (default 1)
 *   - rmsReN:         absolute σ on Re(n) (default 0)
 *   - rmsImN:         absolute σ on Im(n) (default 0)
 *   - distribution:   'gaussian' | 'uniform' | 'truncated' (default 'gaussian')
 *                     'gaussian'  — the set level is σ (RMS); tails unbounded.
 *                     'uniform'   — the set level is a HARD ±bound; uniform draw,
 *                                   |Δ| never exceeds it (RMS = bound/√3).
 *                     'truncated' — the set level is a HARD ±bound = 3σ; bell
 *                                   shape clipped at ±bound (RMS ≈ bound/3).
 *   - keepOpticalThickness: link Δd and Δn so n·d = const (default false)
 *   - perMaterialErrors:    one ΔRe(n)/ΔIm(n) draw per *material id* instead
 *                           of per layer (default false)
 *   - rng:            (optional) custom Math.random()-style function for reproducibility
 *   - onTrial:        (optional) callback ({i, total}) after each completed trial
 *
 * @returns {{
 *   lambda:    number[],
 *   theory:    number[],     // unperturbed C(λ)
 *   mean:      number[],     // sample mean across trials
 *   stdev:     number[],     // sample stdev across trials
 *   lower:     number[],     // mean − k·σ (clipped to ≥ 0)
 *   upper:     number[],     // mean + k·σ (clipped to ≤ 1)
 *   nTrials:   number,
 *   char:      string,
 * }}
 */
export async function runErrorAnalysisMC(design, params, resolveMat, opts = {}) {
    const config = makeMCConfig(design, params, resolveMat, opts);
    const state = initializeMCState(config);

    for (let trial = 0; trial < config.nTrials; trial++) {
        const data = prepareMCTrial(config, state);
        const run = evaluateChar({
            ...config,
            frontLayers: data.frontLayers,
            backLayers: data.backLayers,
            getMatForLayer: data.getMatForLayer,
        });
        updateMCStatistics(state, run[config.char]);
        const trialSpec = evaluateTrialSpecification(
            config, state, data.frontLayers, data.backLayers,
        );
        recordMCTrial(config, state, trial, data, trialSpec);

        if (config.onTrial) config.onTrial({ i: trial + 1, total: config.nTrials });
        if (config.onYield && (trial + 1) % config.yieldEvery === 0) {
            await config.onYield(trial + 1);
        }
        if (config.shouldCancel && config.shouldCancel()) break;
    }

    return finalizeMCResult(config, state);
}

