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
 * Pull `n` Gaussian samples (σ = 1) into a fresh Float64Array. Vectorized via
 * Box–Muller pairs so the cost per sample is one log + one cos/sin.
 */
function gaussArray(n, rng = Math.random) {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i += 2) {
        const [g1, g2] = gauss2(rng);
        out[i] = g1;
        if (i + 1 < n) out[i + 1] = g2;
    }
    return out;
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
    const mode         = opts.mode ?? 'relative';
    const absDeltaNm   = opts.absDeltaNm ?? 1.0;
    const relPct       = opts.relPct ?? 1.0;
    const includeLocked = !!opts.includeLocked;

    const surfaceMode = design?.surfaceMode || 'front_only';
    const front = design.frontLayers || [];
    const back  = surfaceMode === 'symmetric' ? [...front].reverse() : (design.backLayers || []);

    // Build the same optimization-vector layout DLSOptimizer uses, so the index
    // we report matches what the user sees in the Refinement variables panel.
    let varDesc;
    if (surfaceMode === 'both_independent') {
        varDesc = [
            ...front.map((l, i) => ({ side:'front', layerIndex:i, layer:l })),
            ...back .map((l, i) => ({ side:'back',  layerIndex:i, layer:l })),
        ];
    } else if (surfaceMode === 'back_only') {
        varDesc = back.map((l, i) => ({ side:'back', layerIndex:i, layer:l }));
    } else {
        // front_only and symmetric both expose the front stack as the variables
        varDesc = front.map((l, i) => ({ side:'front', layerIndex:i, layer:l }));
    }

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

    // Helper: re-evaluate MF with a single thickness replaced
    const evalAtThk = (sideTag, layerIdx, thkNm) => {
        const ctx = buildEvalContext(design, resolveMat);
        // Mutate only the specific layer
        if (sideTag === 'front') {
            ctx.frontThicks = [...ctx.frontThicks];
            ctx.frontThicks[layerIdx] = thkNm;
            if (surfaceMode === 'symmetric') {
                // Sync mirrored back stack so the full system reflects the change
                ctx.backThicks = [...ctx.frontThicks].reverse();
            }
        } else {
            ctx.backThicks = [...ctx.backThicks];
            ctx.backThicks[layerIdx] = thkNm;
        }
        // Keep `fullThicks` consistent (used by MNT/MXT constraints)
        if (surfaceMode === 'both_independent') {
            ctx.fullThicks = [...ctx.frontThicks, ...ctx.backThicks];
        } else if (surfaceMode === 'back_only') {
            ctx.fullThicks = ctx.backThicks;
        } else {
            ctx.fullThicks = ctx.frontThicks;
        }
        const comp = evaluateOperands(operands, ctx);
        return calcMF(operands, comp, MF_OPT);
    };

    const rows = [];
    for (let i = 0; i < varDesc.length; i++) {
        const { side, layerIndex, layer } = varDesc[i];
        const locked = !!layer.locked;
        if (locked && !includeLocked) continue;

        const d = layer.thickness || 0;
        // Δd is a *step magnitude* in the central difference — its sign is
        // meaningless. Take |Δd| so a user-entered negative absolute Δd (e.g.
        // −5 nm) still probes sensitivity instead of producing a negative span
        // that collapses every dMF to 0 (the "negative Δd → all sensitivities
        // zero" bug). Also guards against a 0 entry.
        const dPert = mode === 'absolute'
            ? Math.max(1e-6, Math.abs(absDeltaNm))
            : Math.max(1e-6, d * relPct / 100);

        // Central difference; clamp the down-step at zero (thickness can't go negative)
        const dPlus  = d + dPert;
        const dMinus = Math.max(0, d - dPert);
        const span   = dPlus - dMinus;

        const mfP = evalAtThk(side, layerIndex, dPlus);
        const mfM = evalAtThk(side, layerIndex, dMinus);
        const dMF = span > 0 ? (mfP - mfM) / span * (2 * dPert) : 0;
        // The standard definition uses ΔMF_j = MF(d+Δd) − MF(d), but for a
        // ranking the central-difference magnitude is just as good and far
        // less biased near a minimum (the sign of the one-sided difference
        // can flip there). We carry the central difference scaled to the
        // (d−Δd, d+Δd) sample interval so the reported number is comparable
        // to a forward difference at the same Δd.

        rows.push({
            index:       i,
            side, layerIndex,
            materialId:  layer.material,
            thickness:   d,
            deltaNm:     dPert,
            deltaMFAbs:  Math.abs(dMF),
            deltaMF:     dMF,
            sensitivity: 0,           // filled in below
            locked,
        });
    }

    // Scale to max layer = 100 %
    let maxAbs = 0;
    for (const r of rows) if (r.deltaMFAbs > maxAbs) maxAbs = r.deltaMFAbs;
    if (maxAbs > 0) for (const r of rows) r.sensitivity = 100 * r.deltaMFAbs / maxAbs;

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
function evaluateChar(design, params, evalMode, resolveMat,
                     frontLayers, backLayers, getMatForLayer) {
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
    const char           = opts.char ?? 'R';
    const evalMode       = opts.evalMode ?? 'front';
    const nTrials        = Math.max(1, Math.floor(opts.nTrials ?? 20));
    const corridorSigma  = opts.corridorSigma ?? 1.0;
    const rmsAbsNm       = opts.rmsAbsNm ?? 0;
    const rmsRelPct      = opts.rmsRelPct ?? 1;
    const rmsReN         = opts.rmsReN ?? 0;
    const rmsImN         = opts.rmsImN ?? 0;
    // Draw shape: 'gaussian' (σ/RMS, unbounded — default),
    // 'uniform' (hard ±bound), or 'truncated' (bell clipped at ±bound = 3σ).
    const distribution   = opts.distribution ?? 'gaussian';
    const keepOPT        = !!opts.keepOpticalThickness;
    const perMaterial    = !!opts.perMaterialErrors;
    const rng            = opts.rng || Math.random;
    const onTrial        = opts.onTrial || null;
    // Optional: evaluate the design Specification (qualifiers) on each trial to
    // report process yield. NOTE v1 — qualifiers are scored on the
    // *thickness*-perturbed design (the dominant tolerancing case); per-layer
    // Δn/Δk index perturbations are reflected in the spectral corridor but not
    // in this qualifier check.
    const evalSpec       = !!opts.evaluateSpec;
    const qualifiers     = opts.qualifiers || design.qualifiers || [];
    // Record per-trial detail (thickness/index deviations + spec verdict) so the
    // UI can open an inspector of "what changed and did it pass" for each trial.
    const recordTrials   = !!opts.recordTrials;
    // M18: cooperative cancellation + yielding. The UI passes an async `onYield`
    // (e.g. a setTimeout(0)) awaited every `yieldEvery` trials so the event loop
    // can paint progress and process a Stop click, and `shouldCancel` to break
    // early. Programmatic/test callers omit both → the loop runs straight through
    // (the function is async but never actually awaits). A cancelled run still
    // returns the stats accumulated so far (nTrials: runningN).
    const shouldCancel   = typeof opts.shouldCancel === 'function' ? opts.shouldCancel : null;
    const onYield        = typeof opts.onYield === 'function' ? opts.onYield : null;
    const yieldEvery     = Math.max(1, Math.floor(opts.yieldEvery ?? 8));

    const front = design.frontLayers || [];
    const back  = design.backLayers  || [];

    // Use the same λ grid as the spectrum evaluator (rounded) so theory and
    // perturbed runs share identical x-coordinates.
    const theoryRun = evaluateChar(design, params, evalMode, resolveMat, front, back, null);
    const lambdas = theoryRun.lambda;
    const theory  = theoryRun[char];           // arrays already on .R/.T/.A
    const nLam = lambdas.length;

    // Welford online mean & variance per wavelength
    const mean  = new Float64Array(nLam);
    const m2    = new Float64Array(nLam);
    // Realized min/max envelope across trials — the TRUE bound for bounded
    // distributions (uniform/truncated). For Gaussian it has no fixed limit and
    // widens with nTrials (sample extremes), so the UI flags it accordingly.
    const minV  = new Float64Array(nLam).fill(Infinity);
    const maxV  = new Float64Array(nLam).fill(-Infinity);
    let runningN = 0;

    // Spec-yield accumulation (only when evalSpec && qualifiers present)
    let specPass = 0, specEvaluated = 0;
    const qFail = qualifiers.map(() => 0);

    // Per-trial inspector records (when recordTrials)
    const trials = [];
    const hasIdxErr = !!(rmsReN || rmsImN);
    // Only perturb the side(s) the chosen analysis evaluates: 'front' → front
    // only, 'back' → back only, 'total' → both. A front analysis must not show
    // (or apply) back-layer deviations that don't affect the front spectrum.
    const usesFront = evalMode === 'front' || evalMode === 'total';
    const usesBack  = evalMode === 'back'  || evalMode === 'total';

    // Reference wavelength for "keep optical thickness" — use mid of the band
    // since n,k at that wavelength is what's most representative; for any
    // real coating the relative variation is nearly λ-independent anyway.
    const lamRef = 0.5 * (params.lambdaStart + params.lambdaEnd);

    // Materials we may need to perturb (per-layer xor per-material toggle).
    // H10: keep these on the UNFILTERED layer index space — one entry per layer,
    // INCLUDING zero-thickness layers — so matsFront[i] aligns with front[i],
    // dThkF[i], dnF[i], dkF[i]. Filtering here (thickness>0) put materials on a
    // different index than the per-layer draw arrays, so any 0 nm layer made
    // every subsequent layer receive the previous layer's Δn/Δk/Δd draw.
    const collectMats = (layers) => layers.map((l) => resolveMat(l.material));
    const matsFront = collectMats(front);
    const matsBack  = collectMats(back);

    for (let trial = 0; trial < nTrials; trial++) {
        // ── Draw thickness deviations ────────────────────────────────────────
        const drawSide = (layers) => {
            const ds = new Float64Array(layers.length);
            for (let i = 0; i < layers.length; i++) {
                if (layers[i].thickness <= 0) { ds[i] = 0; continue; }
                // Per-layer error level; interpreted as σ or
                // as a hard ±bound depending on `distribution`.
                const level = rmsAbsNm + (rmsRelPct / 100) * layers[i].thickness;
                ds[i] = sampleDeviation(level, distribution, rng);
            }
            return ds;
        };
        const dThkF = drawSide(front);
        const dThkB = drawSide(back);

        // ── Draw refractive index deviations ─────────────────────────────────
        // Per-material mode: one draw shared across all layers of the same
        // material id (front+back); per-layer mode: independent per layer.
        let dnF, dkF, dnB, dkB;
        if (perMaterial) {
            // Build per-id draws once
            const idDraws = new Map();
            const need = new Set();
            for (const l of front) if (l.thickness > 0) need.add(l.material);
            for (const l of back ) if (l.thickness > 0) need.add(l.material);
            for (const id of need) {
                idDraws.set(id, {
                    dn: sampleDeviation(rmsReN, distribution, rng),
                    dk: sampleDeviation(rmsImN, distribution, rng),
                });
            }
            const reuse = (layers) => {
                const dn = new Float64Array(layers.length);
                const dk = new Float64Array(layers.length);
                for (let i = 0; i < layers.length; i++) {
                    const d = idDraws.get(layers[i].material);
                    if (d) { dn[i] = d.dn; dk[i] = d.dk; }
                }
                return [dn, dk];
            };
            [dnF, dkF] = reuse(front);
            [dnB, dkB] = reuse(back);
        } else {
            const drawNK = (n) => {
                const dn = new Float64Array(n);
                const dk = new Float64Array(n);
                for (let i = 0; i < n; i++) {
                    dn[i] = sampleDeviation(rmsReN, distribution, rng);
                    dk[i] = sampleDeviation(rmsImN, distribution, rng);
                }
                return [dn, dk];
            };
            [dnF, dkF] = drawNK(front.length);
            [dnB, dkB] = drawNK(back.length);
        }

        // ── Optionally link thickness to n via constant optical thickness ────
        if (keepOPT) {
            const linkSide = (layers, mats, dn, dThk) => {
                for (let i = 0; i < layers.length; i++) {
                    if (layers[i].thickness <= 0 || !mats[i]) continue;
                    const [nNom] = mats[i].getNK(lamRef);
                    const nNew = nNom + dn[i];
                    if (nNew > 1e-3) {
                        // n·d = n_nom · d_nom  →  d_new = d_nom · n_nom / n_new
                        // Δd = d_new − d_nom = d_nom · (n_nom / n_new − 1)
                        dThk[i] = layers[i].thickness * (nNom / nNew - 1);
                    }
                }
            };
            linkSide(front, matsFront, dnF, dThkF);
            linkSide(back,  matsBack,  dnB, dThkB);
        }

        // Restrict perturbation to the analyzed side(s) — zero the other side so
        // it neither affects the spectrum nor appears in the trial record.
        if (!usesFront) { dThkF.fill(0); if (dnF) dnF.fill(0); if (dkF) dkF.fill(0); }
        if (!usesBack)  { dThkB.fill(0); if (dnB) dnB.fill(0); if (dkB) dkB.fill(0); }

        // ── Build perturbed design view (layers + material proxies) ──────────
        const pertFront = front.map((l, i) => ({
            ...l, thickness: Math.max(0, l.thickness + dThkF[i])
        }));
        const pertBack = back.map((l, i) => ({
            ...l, thickness: Math.max(0, l.thickness + dThkB[i])
        }));

        const getMatFor = (rmsReN || rmsImN)
            ? (side, idx) => {
                const baseMats = side === 'front' ? matsFront : matsBack;
                const dnArr    = side === 'front' ? dnF : dnB;
                const dkArr    = side === 'front' ? dkF : dkB;
                const base = baseMats[idx];
                if (!base) return base;
                // k ≥ 0 enforcement: clamp negative draws to zero (a
                // non-absorbing material can't become "negatively absorbing")
                const dk = dkArr[idx];
                const baseK = base.getNK(lamRef)[1];
                const dkClamp = (baseK + dk < 0) ? -baseK : dk;
                return makeShiftedMaterial(base, dnArr[idx], dkClamp);
            }
            : null;

        // ── Evaluate this perturbed trial ────────────────────────────────────
        const run = evaluateChar(design, params, evalMode, resolveMat,
                                 pertFront, pertBack, getMatFor);
        const yi = run[char];

        // Welford update
        runningN++;
        for (let i = 0; i < nLam; i++) {
            const x = yi[i];
            const d1 = x - mean[i];
            mean[i] += d1 / runningN;
            const d2 = x - mean[i];
            m2[i]   += d1 * d2;
            if (x < minV[i]) minV[i] = x;
            if (x > maxV[i]) maxV[i] = x;
        }

        // Spec yield: evaluate qualifiers on the thickness-perturbed design.
        let trialSpec = null;
        if (evalSpec && qualifiers.length) {
            const pertDesign = { ...design, frontLayers: pertFront, backLayers: pertBack };
            try {
                const qres = evaluateQualifiers(qualifiers, pertDesign, resolveMat);
                const v = aggregateVerdict(qres);
                if (v.total > 0) { specEvaluated++; if (v.allPass) specPass++; }
                qres.forEach((r, qi) => { if (r && r.pass === false) qFail[qi]++; });
                trialSpec = {
                    allPass: v.allPass, passing: v.passing, total: v.total,
                    results: qres.map((r, qi) => ({
                        label: qualifiers[qi].label || qualifiers[qi].kind || ('#' + (qi + 1)),
                        pass: r ? r.pass : null,
                        value: r ? r.displayValue : null,
                    })),
                };
            } catch (_) { /* skip this trial's spec check */ }
        }

        // Per-trial inspector record (Δd per layer, optional Δn/Δk, spec verdict)
        if (recordTrials) {
            trials.push({
                i: trial + 1,
                dThkF: usesFront ? Array.from(dThkF) : null,
                dThkB: usesBack  ? Array.from(dThkB) : null,
                dnF: (hasIdxErr && usesFront) ? Array.from(dnF) : null,
                dkF: (hasIdxErr && usesFront) ? Array.from(dkF) : null,
                dnB: (hasIdxErr && usesBack)  ? Array.from(dnB) : null,
                dkB: (hasIdxErr && usesBack)  ? Array.from(dkB) : null,
                spec: trialSpec,
            });
        }

        if (onTrial) onTrial({ i: trial + 1, total: nTrials });

        // M18: yield to the event loop (paint progress / process Stop) and honour
        // cancellation. Both are no-ops for programmatic callers.
        if (onYield && (trial + 1) % yieldEvery === 0) await onYield(trial + 1);
        if (shouldCancel && shouldCancel()) break;
    }

    // Finalize stdev (sample, divide by N — empirical-σ for a Monte Carlo
    // corridor)
    const stdev = new Float64Array(nLam);
    for (let i = 0; i < nLam; i++) {
        stdev[i] = runningN > 0 ? Math.sqrt(m2[i] / runningN) : 0;
    }

    // Build corridor (clip to physical [0,1] since T, R, A are fractions)
    const lower = new Array(nLam);
    const upper = new Array(nLam);
    // Realized min/max envelope (clip to [0,1]); falls back to the mean when no
    // trials ran so the arrays are always plottable.
    const envLower = new Array(nLam);
    const envUpper = new Array(nLam);
    for (let i = 0; i < nLam; i++) {
        lower[i] = Math.max(0, mean[i] - corridorSigma * stdev[i]);
        upper[i] = Math.min(1, mean[i] + corridorSigma * stdev[i]);
        envLower[i] = runningN > 0 ? Math.max(0, minV[i]) : mean[i];
        envUpper[i] = runningN > 0 ? Math.min(1, maxV[i]) : mean[i];
    }

    // Spec yield summary (null when not requested or no qualifiers)
    const spec = (evalSpec && qualifiers.length) ? {
        nTrials:   runningN,
        evaluated: specEvaluated,
        passCount: specPass,
        yield:     specEvaluated > 0 ? specPass / specEvaluated : null,
        perQualifier: qualifiers.map((q, i) => ({
            label:    q.label || q.kind || ('#' + (i + 1)),
            failRate: runningN > 0 ? qFail[i] / runningN : 0,
        })),
    } : null;

    return {
        lambda:  lambdas,
        theory:  Array.from(theory),
        mean:    Array.from(mean),
        stdev:   Array.from(stdev),
        lower, upper,
        envLower, envUpper,
        nTrials: runningN,
        char,
        spec,
        trials: recordTrials ? trials : null,
    };
}

