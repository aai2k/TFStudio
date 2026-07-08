/**
 * Optical evaluation core — TMM evaluation, adaptive merit sampling, math
 * operands, eval-context construction, and the merit (calcMF) function.
 *
 * This is the
 * numerical heart shared by DLSOptimizer and the needle/GE scanners. Imports the
 * leaf modules (operand model, sampling, layer ops) + the TMM kernels; exports
 * the full eval surface. Reference: Macleod, Thin-Film Optical Filters 5e;
 * Sullivan & Dobrowolski Appl. Opt. 35 (1996).
 */

import { tmm, tmmNeedleScan, tmmThicknessJacobian, tmmThicknessHessian } from '../thinFilmMath.js';
import { resolveSourceSpec, resolveDetectorSpec } from '../spectralWeightings.js';
import { tmmWasmActive, getTmmWasm } from '../../workers/tmmWasm.js';
import {
    OPTICAL_OPERAND_TYPES, RANGE_TARGET_OPERAND_TYPES, TOTAL_THICKNESS_OPERAND_TYPES, BLANK_OPERAND_TYPES, INTEGRAL_OPERAND_TYPES, MINMAX_OPERAND_TYPES, CONSTRAINT_OPERAND_TYPES, INEQUALITY_OPERAND_TYPES, MATH_OPERAND_TYPES, ARGWAVE_OPERAND_TYPES, OPERAND_TYPES, OPERAND_POLS, isConstraint, isDmfs, isBlank, isTotalThickness, isRangeTarget, isIntegral, isMinmax, isMinType, isInequality, isArgwave, isArgwaveMin, isMath, isMathSingleRef, isMathPairRef, isFractionalUnit, mathTargetInPercent, argwaveOpticalChar, argwavePolCode, polFromType, AVG_POINTS, AVG_STEP_NM, AVG_POINTS_MAX, bandSampleCount, ARGWAVE_DEFAULT_POINTS, PNORM_DEFAULT, makeOperand, isRamp, makeConstraintOperand, makeDefaultConstraints, makeDmfsOperand
} from './operandModel.js';
import { isRangeAvg, charOf, operandSampleLambdas, requiredLambdas, buildPresampledTable } from './sampling.js';
import { mirrorLayers } from './layerOps.js';
import { makeConeSpec, coneIsActive, coneNodes } from './coneAngle.js';

// Single (λ,θ,pol) R/T/A — WASM kernel when the feature flag is on AND a module
// is instantiated (in this thread), else the JS tmm(). pol: 's'|'p'. Behind the
// flag (default off) so optimizer output is unchanged until the .wasm is built,
// the flag enabled, and tests/wasm_tmm_equivalence.mjs passes.
function tmmEval(lam, aoi, polCode, n0, ns, layers) {
    if (tmmWasmActive()) {
        return getTmmWasm().tmmOne(lam, aoi, polCode === 'p' ? 1 : 0, n0, ns, layers);
    }
    return tmm(lam, aoi, polCode, n0, ns, layers);
}

// Analytic thickness Jacobian for one (λ,θ,pol) — WASM kernel when active, else
// the JS tmmThicknessJacobian(). Returns the SAME shape ({R,T,A,dRdd,dTdd,dAdd,N})
// so the DLS _analyticJacobian chain rule is unchanged. Behind the flag (off by
// default); the DLS step is the other optimizer hot path besides mfAt.
export function tmmJacEval(lam, aoi, polCode, n0, ns, layers) {
    if (tmmWasmActive()) {
        return getTmmWasm().tmmJacobian(lam, aoi, polCode === 'p' ? 1 : 0, n0, ns, layers);
    }
    return tmmThicknessJacobian(lam, aoi, polCode, n0, ns, layers);
}

// Analytic thickness HESSIAN — WASM kernel when active AND the loaded module
// carries it (older .wasm builds lack it → JS fallback), else JS. Returns the
// SAME shape ({R,T,A,dRdd,dTdd,dAdd,d2Rdd,d2Tdd,d2Add,N}) as the JS oracle so the
// SQP/Newton getH() consumer is unchanged. The dense Hessian is ~17× a gradient
// and was the un-accelerated hot spot starving SQP in synthesis.
export function tmmHessEval(lam, aoi, polCode, n0, ns, layers) {
    if (tmmWasmActive()) {
        const w = getTmmWasm();
        if (w.hasHessian()) {
            return w.tmmHessian(lam, aoi, polCode === 'p' ? 1 : 0, n0, ns, layers);
        }
    }
    return tmmThicknessHessian(lam, aoi, polCode, n0, ns, layers);
}

// Analytic needle P-function scan — WASM kernel when active, else JS. Returns
// the SAME nested {R,T,A,gaps,intra,N} so the Needle/GE scanners are unchanged.
export function tmmNeedleScanEval(lam, aoi, polCode, n0, ns, layers, candNs, fracs) {
    if (tmmWasmActive()) {
        return getTmmWasm().tmmNeedleScan(lam, aoi, polCode === 'p' ? 1 : 0, n0, ns, layers, candNs, fracs);
    }
    return tmmNeedleScan(lam, aoi, polCode, n0, ns, layers, candNs, fracs);
}

// ── Adaptive merit sampling ───────────────────────────────────────────────────
//
// Uniform operand grids (default ~2 nm for range-targets, ~1 nm for worst-case
// min/max) are BLIND to spectral features narrower than their step: a ~1 nm
// resonance can fall between samples, so the merit function carries no value and
// no gradient on it and the optimizer cannot suppress it (e.g. a 411 nm stopband
// spike). This raises a band-sampled operand's UNIFORM sample
// count so its step resolves the narrowest significant feature found in its band,
// and ONLY when such a feature exists — smooth designs are returned untouched, so
// they stay bit-identical.
//
// Why uniform densification (not local point insertion): a TGT/RGT/AGT merit is
// the UNWEIGHTED RMS over its samples and TAV/RAV the unweighted mean — both
// assume a uniform grid. Keeping the grid uniform preserves those semantics
// exactly and needs NO change to evalOperand / the analytic Jacobian; we only
// bump the count through the operand's existing runtime override (rampPoints for
// range-targets, bandPoints for worst-case), which operandSampleLambdas already
// honors. The densified operands are what BOTH the main thread AND the worker
// pre-sampler consume, so the byte-identical λ-grid contract holds by
// construction (requiredLambdas iterates the same densified operands).
//
// Applied to RANGE-TARGET (TGT/RGT/AGT) and WORST-CASE (TMN…AMX) operands — the
// ones whose merit can actually catch a narrow feature. Band AVERAGES / integrals
// are intentionally skipped: a 1 nm spike barely moves a 300 nm average (the right
// tool there is a worst-case operand), and a non-uniform grid would bias the mean.
export const ADAPTIVE_SAMPLING_DEFAULTS = {
    enabled:           true,
    probeStepNm:       0.25,   // probe resolution used to DISCOVER features
    minProminence:     0.02,   // ignore departures < 2 % (R/T/A live in [0,1])
    samplesPerFeature: 4,      // want ≥ this many uniform samples across a feature
    maxPoints:         2001,   // cost cap on one operand's densified count
    maxProbe:          12001,  // cap probe evals per operand (launch-time safety)
};

// Walk outward from index i in direction dir (±1), in sign-normalized space
// s = sgn·value, until the curve exceeds the extremum level `si` (a separate
// feature begins); return the lowest s reached — the local baseline that side.
function _sideBaseline(v, i, dir, sgn, si) {
    let base = si;
    for (let j = i + dir; j >= 0 && j < v.length; j += dir) {
        const s = sgn * v[j];
        if (s > si) break;
        base = Math.min(base, s);
    }
    return base;
}

// Contiguous span, in samples, around i where s = sgn·value stays ≥ `level`.
function _halfWidthSamples(v, i, sgn, level) {
    const n = v.length;
    let l = i, r = i;
    while (l > 0     && sgn * v[l] >= level) l--;
    while (r < n - 1 && sgn * v[r] >= level) r++;
    return r - l;
}

// Topographic half-prominence width (nm) of the local extremum at probe index i,
// or null if its prominence is below `minProm`. Prominence = the smaller of the
// left/right drops to the surrounding baseline (standard peak prominence), so a
// spike riding on a high stopband plateau is still measured by its own height,
// not the absolute level. Width = the contiguous span at half that prominence.
// A minimum is handled by working in sign-normalized space (s = sgn·value) so it
// reduces to the maximum case — no duplicated max/min branches.
function _featureWidthAt(v, i, probeStep, minProm) {
    const vi = v[i];
    const isMax = vi >= v[i - 1] && vi >= v[i + 1];
    const isMin = vi <= v[i - 1] && vi <= v[i + 1];
    if (!isMax && !isMin) return null;

    const sgn = isMax ? 1 : -1;             // s = sgn·value → extremum is a maximum
    const si  = sgn * vi;
    const leftBase  = _sideBaseline(v, i, -1, sgn, si);
    const rightBase = _sideBaseline(v, i, +1, sgn, si);

    const prom = si - Math.max(leftBase, rightBase);
    if (!(prom >= minProm)) return null;

    const span = _halfWidthSamples(v, i, sgn, si - prom * 0.5);
    return Math.max(probeStep, span * probeStep);
}

// Probe ONE operand's band for the narrowest significant feature its current
// uniform grid would alias. Returns the sample count needed to resolve it
// (clamped to [curN, maxPoints]) plus diagnostics, or null when no aliasing
// feature exists (→ leave the operand exactly as-is). Pure read of the spectrum
// through the same tmmProp path evalOperand uses, so the probe sees what the
// merit sees.
function adaptiveCountForOperand(op, ctx, cfg) {
    const a = op.lambdaStart, b = op.lambdaEnd;
    const width = Math.abs(b - a);
    if (!(width > 0)) return null;

    // Current uniform grid + its step (magnitude, direction-agnostic).
    const nominal = operandSampleLambdas(op);
    const curN = nominal.length;
    if (curN < 2) return null;
    const nominalStep = width / (curN - 1);

    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol ?? 'avg';
    const lo   = Math.min(a, b);

    // Fine probe grid over the band. It must be enough finer than the nominal
    // grid both to reveal what the grid steps over AND to MEASURE a feature's
    // width (a feature can't be resolved narrower than ~2× the probe step), so
    // cap the probe step at nominalStep/PROBE_VS_NOMINAL as well as the absolute
    // cfg.probeStepNm.
    const PROBE_VS_NOMINAL = 4;
    const probeTarget = Math.min(cfg.probeStepNm, nominalStep / PROBE_VS_NOMINAL);
    let nProbe = Math.round(width / probeTarget) + 1;
    if (nProbe > cfg.maxProbe) nProbe = cfg.maxProbe;
    if (nProbe <= curN) return null;
    const probeStep = width / (nProbe - 1);
    const v = new Array(nProbe);
    for (let i = 0; i < nProbe; i++) {
        v[i] = tmmProp(lo + probeStep * i, op.aoi, pol, char, ctx, ctx.frontThicks, ctx.frontMats);
    }

    // Narrowest significant feature anywhere in the band (prominence-based, so
    // it is independent of where the nominal grid points happen to fall).
    let minFeatureWidth = Infinity;
    for (let i = 1; i < nProbe - 1; i++) {
        const w = _featureWidthAt(v, i, probeStep, cfg.minProminence);
        if (w != null && w < minFeatureWidth) minFeatureWidth = w;
    }

    // Only act when the feature is narrower than the grid actually steps over it.
    if (!Number.isFinite(minFeatureWidth) || minFeatureWidth >= nominalStep) return null;

    const desiredStep = Math.max(probeStep, minFeatureWidth / cfg.samplesPerFeature);
    const neededN     = Math.round(width / desiredStep) + 1;
    const count       = Math.min(cfg.maxPoints, Math.max(curN, neededN));
    if (count <= curN) return null;
    return { count, featureWidth: minFeatureWidth, capped: neededN > cfg.maxPoints };
}

// Densify the band-sampled operands whose bands hide a sub-grid feature, returning
// a NEW operands array (unchanged operands keep their identity; densified ones are
// shallow clones with a raised rampPoints/bandPoints override). Call at run launch
// and feed the result to BOTH requiredLambdas/pre-sampling AND the worker job, so
// the byte-identical λ-grid contract is preserved. `notify(summary)` (optional)
// receives a one-line report so callers can surface what was densified / capped
// (no silent caps).
export function densifyOperandsForFeatures(operands, design, resolveMat, cfg = ADAPTIVE_SAMPLING_DEFAULTS, notify = null) {
    if (!cfg || cfg.enabled === false || !Array.isArray(operands) || operands.length === 0) return operands;
    let ctx;
    try { ctx = buildEvalContext(design, resolveMat); }
    catch { return operands; }   // can't probe → fail safe to the uniform default

    let changed = false;
    let capped  = 0;
    const out = operands.map(op => {
        if (!op || op.enabled === false) return op;
        if (!(isRangeTarget(op.type) || isMinmax(op.type))) return op;
        let res = null;
        try { res = adaptiveCountForOperand(op, ctx, cfg); }
        catch { res = null; }
        if (!res) return op;
        changed = true;
        if (res.capped) capped++;
        const field = isRangeTarget(op.type) ? 'rampPoints' : 'bandPoints';
        return { ...op, [field]: res.count };
    });
    if (changed && typeof notify === 'function') {
        const bumped = out.filter((o, i) => o !== operands[i]).length;
        notify({ bumped, capped });
    }
    return changed ? out : operands;
}

// Every distinct material identifier a design references (incident / exit /
// substrate media + all front & back layer materials). The worker pre-samples
// each of these on requiredLambdas() so its table-lookup getNK is exact.
export function collectDesignMaterialIds(design) {
    const inc  = typeof design.incidentMedium === 'string'
        ? design.incidentMedium : (design.incidentMedium?.material ?? 'Air');
    const exit = typeof design.exitMedium === 'string'
        ? design.exitMedium : (design.exitMedium?.material ?? 'Air');
    const ids = new Set(['Air']);                 // always present (resolveMat fallback)
    ids.add(inc);
    ids.add(exit);
    ids.add(design.substrate?.material ?? 'BK7');
    for (const l of (design.frontLayers || [])) ids.add(l.material);
    for (const l of (design.backLayers  || [])) ids.add(l.material);
    return Array.from(ids).filter(x => x != null);
}

// ── Per-evaluateOperands memoization ──────────────────────────────────────────
//
// Within one evaluateOperands call the thicknesses and materials are fixed, so
// the full {R,T,A} at a given (λ, aoi, polCode) is invariant across operands.
// Paired R+T operands (every AR/HR/BS/edge generator emits them) otherwise
// each trigger an independent full TMM that discards two-thirds of its result.
// These caches return bit-identical numbers — pure speedup, no math change.

function nkOf(ctx, mat, lam) {
    const c = ctx && ctx._nkCache;
    if (!c) return mat.getNK(lam);
    let m = c.get(mat);
    if (!m) { m = new Map(); c.set(mat, m); }
    let v = m.get(lam);
    if (v === undefined) { v = mat.getNK(lam); m.set(lam, v); }
    return v;
}

// Cached single-polarization TMM. Key spans (λ, aoi, polCode) plus a `tag`
// distinguishing independent stacks/passes that share those coordinates
// (front forward vs. reverse vs. back in the full-system model).
function tmmC(ctx, tag, lam, aoi, polCode, n0, ns, layers) {
    const c = ctx && ctx._tmmCache;
    if (!c) return tmmEval(lam, aoi, polCode, n0, ns, layers);
    const key = tag + '|' + lam + '|' + aoi + '|' + polCode;
    let v = c.get(key);
    if (v === undefined) { v = tmmEval(lam, aoi, polCode, n0, ns, layers); c.set(key, v); }
    return v;
}

// Select the R/T/A component named by `char` ('T'|'R' → T/R, else A) from a
// {T,R,A} result object.
const _rtaChar = (r, char) => (char === 'T' ? r.T : char === 'R' ? r.R : r.A);

// Front-coating-only TMM evaluation (no back stack, ignores substrate bulk and exit medium).
// Used when ctx.surfaceMode === 'front_only'.
function tmmFrontOnly(lam, aoi, pol, char, ctx, thicknesses, mats) {
    const n0     = nkOf(ctx, ctx.n0mat, lam);
    const ns     = nkOf(ctx, ctx.nsmat, lam);
    const layers = mats.map((m, i) => ({ n: nkOf(ctx, m, lam), d: thicknesses[i] }));

    if (pol === 'avg') {
        const s = tmmC(ctx, 'f', lam, aoi, 's', n0, ns, layers);
        const p = tmmC(ctx, 'f', lam, aoi, 'p', n0, ns, layers);
        return (_rtaChar(s, char) + _rtaChar(p, char)) * 0.5;
    }
    return _rtaChar(tmmC(ctx, 'f', lam, aoi, pol, n0, ns, layers), char);
}

// Back-coating-only TMM evaluation — symmetric to tmmFrontOnly. Single surface
// from the back: light incident from the EXIT medium, semi-infinite substrate,
// front coating ignored. backLayers are stored substrate→exit, so they are
// reversed here so the per-layer TMM sees them in exit→substrate (incident →
// substrate) order, matching evaluateSpectrumBack in thinFilmMath.js (which is
// what the SpectralMonitor's "back" mode displays). Used when
// ctx.surfaceMode === 'back_only'.
function tmmBackOnly(lam, aoi, pol, char, ctx, thicknesses, mats) {
    const n0     = nkOf(ctx, ctx.neMat || ctx.n0mat, lam);
    const ns     = nkOf(ctx, ctx.nsmat, lam);
    const layers = mats.map((m, i) => ({ n: nkOf(ctx, m, lam), d: thicknesses[i] })).reverse();

    if (pol === 'avg') {
        const s = tmmC(ctx, 'b', lam, aoi, 's', n0, ns, layers);
        const p = tmmC(ctx, 'b', lam, aoi, 'p', n0, ns, layers);
        return (_rtaChar(s, char) + _rtaChar(p, char)) * 0.5;
    }
    return _rtaChar(tmmC(ctx, 'b', lam, aoi, pol, n0, ns, layers), char);
}

// Per-polarization full-system R/T/A for one incidence: coherent front and back
// coatings joined by an incoherent (intensity-summed) substrate bulk pass P.
// `s` carries the precomputed geometry/indices from tmmFullSystem.
function _fullSystemRTA(polCode, s) {
    const { ctx, lam, aoi, aoiSub, cosTs, n0, ns, ne, fLayers, bLayers } = s;
    // forward pass:   incident → front → substrate
    const fwd = tmmC(ctx, 'fwd', lam, aoi,    polCode, n0, ns, fLayers);
    // reverse pass:  substrate → front_reversed → incident   (R_f', T_f')
    const rev = tmmC(ctx, 'rev', lam, aoiSub, polCode, ns, n0, [...fLayers].reverse());
    // back coating from substrate side:  substrate → back → exit
    const bck = tmmC(ctx, 'bck', lam, aoiSub, polCode, ns, ne, bLayers);

    // Substrate bulk transmittance per pass: P = exp(−4π k d / (λ cosθ_sub))
    const k_sub    = ns[1];
    const d_sub_nm = (ctx.substrateThicknessMm || 1.0) * 1e6;
    const P = (k_sub > 0 && cosTs > 0)
        ? Math.exp(-4 * Math.PI * k_sub * d_sub_nm / (lam * cosTs))
        : 1.0;
    const P2 = P * P;

    const denom = 1 - rev.R * bck.R * P2;
    const T = denom > 0 ? (fwd.T * P * bck.T) / denom : 0;
    const R = denom > 0 ? fwd.R + (fwd.T * rev.T * P2 * bck.R) / denom : 1;
    const A = Math.max(0, 1 - R - T);
    return { R, T, A };
}

// Full-system R/T/A combining front coating + (incoherent) substrate bulk + back coating.
// Reference: Macleod §2.6.4 "Substrate with thin films on both sides".
//   T = T_f · P · T_b / (1 − R_f' · R_b · P²)
//   R = R_f + T_f · T_f' · P² · R_b / (1 − R_f' · R_b · P²)
// Substrate is treated as optically thick (incoherent intensity sum).
export function tmmFullSystem(lam, aoi, pol, char, ctx, frontThicks, frontMats, backThicks, backMats) {
    const n0 = nkOf(ctx, ctx.n0mat, lam);
    const ns = nkOf(ctx, ctx.nsmat, lam);
    const ne = nkOf(ctx, (ctx.neMat || ctx.n0mat), lam);

    const fLayers = frontMats.map((m, i) => ({ n: nkOf(ctx, m, lam), d: frontThicks[i] })).filter(l => l.d > 0);
    const bLayers = backMats.map((m, i)  => ({ n: nkOf(ctx, m, lam), d: backThicks[i]  })).filter(l => l.d > 0);

    // Angle inside substrate via real-part Snell's law
    const sinT0  = Math.sin(aoi * Math.PI / 180);
    const sinTs  = (ns[0] > 0) ? Math.min(1, n0[0] * sinT0 / ns[0]) : 0;
    const cosTs  = Math.sqrt(1 - sinTs * sinTs);
    const aoiSub = Math.asin(sinTs) * 180 / Math.PI;

    const s = { ctx, lam, aoi, aoiSub, cosTs, n0, ns, ne, fLayers, bLayers };

    if (pol === 'avg') {
        const rs = _fullSystemRTA('s', s);
        const rp = _fullSystemRTA('p', s);
        return (_rtaChar(rs, char) + _rtaChar(rp, char)) * 0.5;
    }
    return _rtaChar(_fullSystemRTA(pol, s), char);
}

// Does this (surfaceMode, mfEvalMode) pair score the merit function against the
// FULL system (front + substrate + back) rather than a single surface?
//   symmetric / both_independent → always full system (two-sided by definition)
//   front_only / back_only       → full system iff the user picked 'total'
//                                   (mfEvalMode='total'); 'side' (default) keeps
//                                   the legacy single-surface evaluation.
// This DECOUPLES "which layers are optimized" (surfaceMode) from "how the MF is
// scored" (mfEvalMode): you can optimize only the front yet judge it against the
// whole filter including a fixed back coating.
export function isFullSystemEval(surfaceMode, mfEvalMode) {
    if (surfaceMode === 'symmetric' || surfaceMode === 'both_independent') return true;
    return mfEvalMode === 'total';
}

// Single source of truth for "which spectrum is the physical answer" — derived
// purely from the design's surfaceMode + mfEvalMode. Every viewer / analysis
// window (Optical Evaluation, Color, Error Analysis, …) reads THIS instead of an
// independently-toggled local mode, so what you see, what specs score, and what
// tolerances perturb can never disagree.
//   front_only + side  → 'front'   (front coating on semi-infinite substrate)
//   back_only  + side  → 'back'    (back coating on semi-infinite substrate)
//   anything full-system → 'total' (front + substrate + back, incoherent series)
export function resolveEvalMode(design) {
    const sm = design?.surfaceMode || 'front_only';
    const me = design?.mfEvalMode  || 'side';
    if (isFullSystemEval(sm, me)) return 'total';
    return sm === 'back_only' ? 'back' : 'front';
}

// Resolve a single-λ optical property through whichever model the surface mode
// + eval mode demand, AVERAGED over the illumination cone when one is active.
//
// Cone-angle averaging wraps the single-angle evaluation: when
// ctx.cone is active, `aoi` is treated as the cone AXIS and the property is the
// weighted sum over the cone's quadrature nodes (coneNodes). With no cone (the
// default) this is a single call to tmmPropSingle → bit-identical to before.
// Because EVERY optical operand (TGT/TAV/TMN/integral/argwave/…) funnels through
// here, cone averaging applies uniformly to the merit function, every viewer,
// and all synthesis (all T/R/A operands + synthesis).
export function tmmProp(lam, aoi, pol, char, ctx, thicknesses, mats) {
    const cone = ctx.cone;
    if (cone && coneIsActive(cone)) {
        const nodes = coneNodes(cone, aoi);
        if (nodes.length > 1) {
            let acc = 0;
            for (let i = 0; i < nodes.length; i++) {
                acc += nodes[i].weight *
                    tmmPropSingle(lam, nodes[i].aoiDeg, pol, char, ctx, thicknesses, mats);
            }
            return acc;
        }
    }
    return tmmPropSingle(lam, aoi, pol, char, ctx, thicknesses, mats);
}

// Single-angle property evaluation (the pre-cone tmmProp body).
function tmmPropSingle(lam, aoi, pol, char, ctx, thicknesses, mats) {
    const sm = ctx.surfaceMode || 'front_only';
    const fullSystem = ctx.evalFullSystem
        || sm === 'symmetric' || sm === 'both_independent';
    if (fullSystem) {
        // Full system: front = ctx.frontThicks/Mats, back = ctx.backThicks/Mats.
        // For front_only+total the back stack is the FIXED back coating (or bare
        // substrate if empty); for back_only+total the front is the fixed front.
        return tmmFullSystem(lam, aoi, pol, char, ctx,
            ctx.frontThicks || thicknesses, ctx.frontMats || mats,
            ctx.backThicks || [], ctx.backMats || []);
    }
    if (sm === 'back_only') {
        // Single back-surface model: evalOperand passes ctx.frontThicks/Mats by
        // convention, but in back_only those are inactive — read the back stack
        // directly from ctx so the merit function and SpectralMonitor's "back"
        // mode agree by construction.
        return tmmBackOnly(lam, aoi, pol, char, ctx, ctx.backThicks || [], ctx.backMats || []);
    }
    // front_only, single-surface (legacy default)
    return tmmFrontOnly(lam, aoi, pol, char, ctx, thicknesses, mats);
}

// ── Math-operand value computation + ref resolver ────────────────────────────
//
// Each math operand kind declares how to compute its *value* given the
// resolved value(s) of its referenced operand(s).  Residual semantics are
// declared by `MATH_RESIDUAL_KIND` below and consumed by calcMF / _residuals.
//
// Adding a new Zemax math operand (ABSO, RECI, LOGE, SQRT, …) is now a
// one-line addition to MATH_REGISTRY + an entry in MATH_RESIDUAL_KIND.
export const MATH_REGISTRY = {
    OPGT: { refs: 'single', value: (refs) => refs[0] },
    OPLT: { refs: 'single', value: (refs) => refs[0] },
    OPVA: { refs: 'single', value: (refs) => refs[0] },
    ABSO: { refs: 'single', value: (refs) => Math.abs(refs[0]) },
    ABGT: { refs: 'single', value: (refs) => Math.abs(refs[0]) },
    ABLT: { refs: 'single', value: (refs) => Math.abs(refs[0]) },
    DIFF: { refs: 'pair',   value: (refs) => refs[0] - refs[1] },
    SUMM: { refs: 'pair',   value: (refs) => refs[0] + refs[1] },
    PROD: { refs: 'pair',   value: (refs) => refs[0] * refs[1] },
};

// Residual = how the operand contributes to the merit function.
//   'one-sided-min' — residual = max(0, target − value)  (ref ≥ target)
//   'one-sided-max' — residual = max(0, value − target)  (ref ≤ target)
//   'equality'      — residual = value − target
const MATH_RESIDUAL_KIND = {
    OPGT: 'one-sided-min',
    OPLT: 'one-sided-max',
    ABGT: 'one-sided-min',
    ABLT: 'one-sided-max',
    OPVA: 'equality',
    ABSO: 'equality',
    DIFF: 'equality',
    SUMM: 'equality',
    PROD: 'equality',
};

// Look-up referenced operand row(s) by id and recursively evaluate.  Cycle
// detection: an operand on a cycle returns NaN.  ctx._refStack is the call
// stack of in-flight ref evaluations; ctx._refCache memoizes finished values.
export function makeRefResolver(ctx) {
    const operands = ctx?._operandsById;
    return (refId) => {
        if (!operands) return NaN;
        const op = operands.get(refId);
        if (!op || !op.enabled) return NaN;
        if (!ctx._refCache) ctx._refCache = new Map();
        if (ctx._refCache.has(refId)) return ctx._refCache.get(refId);
        if (!ctx._refStack) ctx._refStack = new Set();
        if (ctx._refStack.has(refId)) return NaN;  // cycle
        ctx._refStack.add(refId);
        const v = evalOperand(op, ctx);
        ctx._refStack.delete(refId);
        ctx._refCache.set(refId, v);
        return v;
    };
}

// Compute the *value* (not the residual) of a math operand.
export function computeMathValue(op, resolve) {
    const reg = MATH_REGISTRY[op.type];
    if (!reg) return NaN;
    if (reg.refs === 'single') {
        const v = resolve(op.refId);
        return reg.value([v]);
    }
    if (reg.refs === 'pair') {
        const v1 = resolve(op.refId1);
        const v2 = resolve(op.refId2);
        return reg.value([v1, v2]);
    }
    return NaN;
}

// Translate a math operand's computed value + target into the residual the
// optimizer sees.  Returns 0 when the inequality is satisfied (inert).
export function mathResidual(op, value) {
    if (value == null || !Number.isFinite(value)) return 0;
    const kind = MATH_RESIDUAL_KIND[op.type] || 'equality';
    switch (kind) {
        case 'one-sided-min': return Math.max(0, op.target - value);
        case 'one-sided-max': return Math.max(0, value - op.target);
        case 'equality':      return value - op.target;
        default:              return 0;
    }
}

export function mathResidualKind(type) { return MATH_RESIDUAL_KIND[type] || 'equality'; }

// 3-point parabolic interpolation around a discrete extremum at index i in a
// uniformly-spaced sample (lams[i] linear in i). Returns the sub-sample λ and
// the interpolated value. Falls back to the discrete extremum when the parabola
// is degenerate or the peak sits on a boundary.
function parabolicPeakLambda(lams, vals, i) {
    const n = lams.length;
    if (n < 3 || i <= 0 || i >= n - 1) return { lam: lams[i], val: vals[i] };
    const y0 = vals[i - 1], y1 = vals[i], y2 = vals[i + 1];
    const denom = (y0 - 2 * y1 + y2);
    if (Math.abs(denom) < 1e-15) return { lam: lams[i], val: vals[i] };
    // Δ ∈ (−0.5, 0.5) is the sub-sample offset; standard parabolic-peak formula.
    const delta = 0.5 * (y0 - y2) / denom;
    const dLam  = lams[i + 1] - lams[i];   // uniform step assumed
    const lamP  = lams[i] + delta * dLam;
    const valP  = y1 - 0.25 * (y0 - y2) * delta;
    return { lam: lamP, val: valP };
}

// Total thickness (TT): sum of all active layer thicknesses (nm). Uses the full
// optimization vector (front, or front+back in both_independent) so it tracks
// exactly the layers the optimizer can move — matching the constraints' domain.
function _evalTotalThickness(op, ctx) {
    const all = ctx.fullThicks || ctx.frontThicks || [];
    let sum = 0;
    for (let i = 0; i < all.length; i++) sum += all[i] || 0;
    return sum;
}

// MNT/MXT layer-thickness constraint: min (MNT) or max (MXT) thickness over a
// 1-based layer-index range. The range clamps to the actual layer count, so
// generators can emit lambdaEnd=9999 to mean "every current and future layer".
// In both_independent mode ctx.fullThicks spans front+back so constraints can
// reach either stack; otherwise it equals frontThicks.
function _evalConstraint(op, ctx) {
    const all = ctx.fullThicks || ctx.frontThicks || [];
    const lo = Math.max(0, Math.round(op.lambdaStart) - 1);
    const hi = Math.min(all.length - 1, Math.round(op.lambdaEnd) - 1);
    if (lo > hi) return 0;
    if (op.type === 'MNT') {
        let v = Infinity;
        for (let i = lo; i <= hi; i++) v = Math.min(v, all[i] || 0);
        return isFinite(v) ? v : 0;
    }
    let v = 0;
    for (let i = lo; i <= hi; i++) v = Math.max(v, all[i] || 0);
    return v;
}

// Zemax-style math operands (OPGT/OPLT/OPVA/ABSO/ABGT/ABLT/DIFF/SUMM/PROD):
// resolve op.refId / op.refId1+refId2 to other MF rows and compute a derived
// value. Returns the underlying VALUE — one-sided residual logic happens in
// calcMF / _residuals / the Jacobian.
function _evalMath(op, ctx) {
    // Legacy shim: an older saved file may have an OPGT/OPLT with op.baseType and
    // no refId — evaluate the virtual base operand directly (no recursion into
    // ctx.operands).
    if ((op.type === 'OPGT' || op.type === 'OPLT') && op.baseType && !op.refId) {
        return evalOperand({ ...op, type: op.baseType }, ctx);
    }
    return computeMathValue(op, makeRefResolver(ctx));
}

// Argmax/argmin-wavelength (MXW*/MNW*): sample C(λ) over [λStart,λEnd] on a
// uniform grid, find the discrete extremum, refine with a 3-pt parabolic fit.
// Returns λ in nm.
function _evalArgwave(op, ctx) {
    const char = argwaveOpticalChar(op.type);                     // 'T' | 'R' | 'A'
    const pol  = argwavePolCode(op.type) ?? op.pol ?? 'avg';
    const lams = operandSampleLambdas(op);
    const n    = lams.length;
    if (n === 0) return op.lambdaStart;
    const vals = new Array(n);
    for (let i = 0; i < n; i++) {
        vals[i] = tmmProp(lams[i], op.aoi, pol, char, ctx, ctx.frontThicks, ctx.frontMats);
    }
    const minMode = isArgwaveMin(op.type);
    let bestI = 0, bestV = vals[0];
    for (let i = 1; i < n; i++) {
        if (minMode ? vals[i] < bestV : vals[i] > bestV) { bestV = vals[i]; bestI = i; }
    }
    return parabolicPeakLambda(lams, vals, bestI).lam;
}

// Weighted-integral operand (TIW/RIW/AIW):
//   C̄ = Σ w_i · C_i  /  Σ w_i      with w_i = S(λ_i) · D(λ_i)
// S(λ) and D(λ) come from the operand's source/detector specs (or default to
// E × flat = unity, i.e. an unweighted band average).
function _evalIntegral(op, ctx) {
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    const lams = operandSampleLambdas(op);
    const n    = lams.length;
    const S = resolveSourceSpec(op.source   || { id: 'E' });
    const D = resolveDetectorSpec(op.detector || { id: 'flat' });
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
        const lam = lams[i];
        const w   = S.sampler(lam) * D.sampler(lam);
        const v   = tmmProp(lam, op.aoi, pol, char, ctx, ctx.frontThicks, ctx.frontMats);
        num += w * v;
        den += w;
    }
    return den > 1e-30 ? num / den : 0;
}

// Worst-case minmax operand (TMN/RMN/AMN/TMX/RMX/AMX): the TRUE extremum of C(λ)
// over the band (the real physical worst-case T/R/A — never >100%, never <0%).
// The earlier log-sum-exp "soft" surrogate was abandoned: its un-normalized form
// inflated a flat 99% T to >100% ("TMX = 108.9%"), and any smoothing biases the
// value away from the real extremum. We report the honest extremum here (so the
// MFE "Current" cell and the Specification window agree exactly) and give the
// optimizer a single-argmax SUBGRADIENT in _analyticJacobian — the same
// hard-extremum approach used for MNT/MXT. Sampled on the dense argwave grid
// (≈1 nm) so a narrow peak / dip can't slip between samples.
function _evalMinmax(op, ctx) {
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    const lams    = operandSampleLambdas(op);
    const n       = lams.length;
    const minMode = isMinType(op.type);
    let ext = minMode ? Infinity : -Infinity;
    for (let i = 0; i < n; i++) {
        const v = tmmProp(lams[i], op.aoi, pol, char, ctx, ctx.frontThicks, ctx.frontMats);
        if (minMode) { if (v < ext) ext = v; }
        else         { if (v > ext) ext = v; }
    }
    return Number.isFinite(ext) ? ext : 0;
}

// Continuous per-λ target (TGT/RGT/AGT): RMS deviation of the spectrum from the
// (flat or linearly ramped) target line, sampled across the band. calcMF squares
// this directly (the per-sample residuals are already folded into the RMS).
function _evalRangeTarget(op, ctx) {
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    const lams = operandSampleLambdas(op);
    const n    = lams.length;
    const t0   = op.target;
    const t1   = op.targetEnd != null ? op.targetEnd : op.target;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
        const f   = i / (n - 1);
        const ti  = t0 + (t1 - t0) * f;
        const d   = tmmProp(lams[i], op.aoi, pol, char, ctx, ctx.frontThicks, ctx.frontMats) - ti;
        sumSq += d * d;
    }
    return Math.sqrt(sumSq / n);
}

// Band average (TAV/RAV/AAV = mean of C(λ) over the band) or, for a plain
// single-wavelength operand, C at op.lambdaStart. The λ grid comes from the
// centralized helper so the worker pre-sampler cannot diverge from what we
// evaluate here → bit-identical.
function _evalBandAvgOrSingle(op, ctx) {
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    if (!isRangeAvg(op.type)) {
        return tmmProp(op.lambdaStart, op.aoi, pol, char, ctx, ctx.frontThicks, ctx.frontMats);
    }
    const lams = operandSampleLambdas(op);
    const n    = lams.length;
    let sum = 0;
    for (let i = 0; i < n; i++) {
        sum += tmmProp(lams[i], op.aoi, pol, char, ctx, ctx.frontThicks, ctx.frontMats);
    }
    return sum / n;
}

// Ordered operand-kind → evaluator dispatch. Order matters (checked top-down);
// the band-average / single-λ evaluator is the fall-through default.
const _EVAL_DISPATCH = [
    [isTotalThickness, _evalTotalThickness],
    [isConstraint,     _evalConstraint],
    [isMath,           _evalMath],
    [isArgwave,        _evalArgwave],
    [isIntegral,       _evalIntegral],
    [isMinmax,         _evalMinmax],
    [isRangeTarget,    _evalRangeTarget],
];

export function evalOperand(op, ctx) {
    if (isDmfs(op.type) || isBlank(op.type)) return null;   // inert / comment
    for (const [test, evalFn] of _EVAL_DISPATCH) {
        if (test(op.type)) return evalFn(op, ctx);
    }
    return _evalBandAvgOrSingle(op, ctx);
}

// Build an evaluation context from a design. Used by callers that already have
// `design` and `resolveMat` (Refinement, GE, Needle, MeritFunctionEditor).
//   surfaceMode = 'symmetric'        → backLayers auto-synced to frontLayers
//   surfaceMode = 'both_independent' → both stacks used as stored
//   surfaceMode = 'front_only'       → back stack ignored
export function buildEvalContext(design, resolveMat) {
    const surfaceMode = design?.surfaceMode || 'front_only';
    const mfEvalMode  = design?.mfEvalMode  || 'side';
    const evalFullSystem = isFullSystemEval(surfaceMode, mfEvalMode);
    const inc   = typeof design.incidentMedium === 'string' ? design.incidentMedium : (design.incidentMedium?.material ?? 'Air');
    const exit  = typeof design.exitMedium === 'string' ? design.exitMedium : (design.exitMedium?.material ?? 'Air');
    const front = design.frontLayers || [];
    const backRaw = design.backLayers || [];
    const back  = surfaceMode === 'symmetric' ? [...front].reverse() : backRaw;

    const frontThicks = front.map(l => l.thickness || 0);
    const frontMats   = front.map(l => resolveMat(l.material));
    const backThicks  = back.map(l => l.thickness || 0);
    const backMats    = back.map(l => resolveMat(l.material));

    // Cone-angle averaging: a design-level convergent/divergent
    // beam spec. Normalized once here so every operand evaluated through this
    // ctx shares the same cone. Absent/disabled → coneIsActive() is false and
    // tmmProp stays on the single-angle fast path (bit-identical).
    const cone = makeConeSpec(design?.cone || {});

    return {
        _isEvalContext:       true,
        surfaceMode,
        mfEvalMode,
        evalFullSystem,
        cone,
        n0mat:                resolveMat(inc),
        nsmat:                resolveMat(design.substrate?.material ?? 'BK7'),
        neMat:                resolveMat(exit),
        substrateThicknessMm: design.substrate?.thickness ?? 1.0,
        frontThicks, frontMats,
        backThicks,  backMats,
        // fullThicks is what constraint operands act on. In both_independent
        // mode it spans front+back so MNT/MXT constraints reach the back layers too.
        fullThicks:  surfaceMode === 'both_independent'
                        ? [...frontThicks, ...backThicks]
                        : frontThicks,
    };
}

// Backward-compatible evaluator.
//   Old form: evaluateOperands(operands, n0mat, nsmat, thicknesses, mats)
//   New form: evaluateOperands(operands, ctx)  where ctx is from buildEvalContext
// The old form defaults to surfaceMode='front_only'.
export function evaluateOperands(operands, ctxOrN0, nsmatLegacy, thicknessesLegacy, matsLegacy) {
    let ctx;
    if (ctxOrN0 && ctxOrN0._isEvalContext) {
        ctx = ctxOrN0;
    } else {
        ctx = {
            _isEvalContext:       true,
            surfaceMode:          'front_only',
            mfEvalMode:           'side',
            evalFullSystem:       false,
            n0mat:                ctxOrN0,
            nsmat:                nsmatLegacy,
            neMat:                ctxOrN0,
            substrateThicknessMm: 1.0,
            frontThicks:          thicknessesLegacy,
            frontMats:            matsLegacy,
            backThicks:           [],
            backMats:             [],
            fullThicks:           thicknessesLegacy,
        };
    }
    // Fresh per-call memoization. Thicknesses/materials are fixed for the
    // duration of this call, so (λ,aoi,polCode)→{R,T,A} and (mat,λ)→ñ are
    // invariant and shared across operands (notably paired R+T). Always
    // overwritten so a reused ctx object can never serve a stale result.
    ctx._tmmCache = new Map();
    ctx._nkCache  = new Map();
    // Index operands by id so math operands can resolve op.refId / refId1/2
    // in O(1) and so makeRefResolver above can do recursive eval with
    // memoization + cycle detection.
    ctx._operandsById = new Map();
    for (const op of operands) ctx._operandsById.set(op.id, op);
    ctx._refCache = new Map();
    ctx._refStack = new Set();
    return operands.map(op => op.enabled ? evalOperand(op, ctx) : null);
}

// ── Residual unit normalization (mixed-unit merit functions) ──────────────────
//
// Operands of different units share ONE weighted-RMS merit function. Optical
// T/R/A residuals are fractions in ~[0, 1]; argwave (MXW*/MNW*) residuals are
// in NANOMETRES. Without normalization a 10 nm wavelength miss (residual 10)
// dwarfs a 1 % optical miss (residual 0.01) no matter how the weights are set,
// so the optimizer effectively ignores the optical targets.
//
// Fix: divide each residual by a per-type characteristic scale σ before the
// weighted RMS, making the MF a dimensionless χ²-style sum (Press et al.,
// *Numerical Recipes*, §15.1 — normalized least squares) so `weight` is pure
// importance and units stop competing:
//
//     MF² = Σ wᵢ·(residualᵢ / σᵢ)² / Σ wᵢ
//
//   • σ = 1 for every fraction-unit operand (T/R/A, TAV/RAV/AAV, TGT/RGT/AGT
//     RMS, TIW/RIW/AIW, TMN…AMX, math) → every PURE-OPTICAL merit function is
//     numerically UNCHANGED (no regression on existing designs).
//   • Argwave (λ in nm): σ = ARGWAVE_RESIDUAL_SCALE_NM. With 500, a 5 nm peak/
//     edge miss weighs the same as a 1 % optical miss.
//   • Thickness operands (MNT/MXT/TT) DELIBERATELY stay σ = 1 (raw nm, "hard"):
//     a violated manufacturing bound should dominate and be fixed first, not be
//     softened to optical scale.
//
// Applied in exactly two chokepoints — calcMF (the reported MF) and
// DLSOptimizer._residuals (the LM step). The analytic Jacobian only ever runs
// for σ = 1 operands (argwave forces the FD fallback, which differences
// _residuals and therefore inherits σ automatically), so no Jacobian change is
// needed and the gradient stays exactly consistent with the residual.
//
// TO REVERT to the old raw-nm behavior: set ARGWAVE_RESIDUAL_SCALE_NM = 1
// (or make operandResidualScale always return 1 to disable normalization
// entirely). Nothing else depends on it.
export const ARGWAVE_RESIDUAL_SCALE_NM = 500;
export function operandResidualScale(op) {
    return isArgwave(op.type) ? ARGWAVE_RESIDUAL_SCALE_NM : 1;
}

// One-sided total-thickness residual: ≤/≥ give a penalty (0 when satisfied);
// default (eq) is a two-sided equality residual (total − target, nm).
function _ttResidual(op, val) {
    if (op.cmp === 'le') return Math.max(0, val - op.target);
    if (op.cmp === 'ge') return Math.max(0, op.target - val);
    return val - op.target;
}

// Per-operand merit residual (before unit normalization). Constraints (MNT/MXT)
// and worst-case min/max are one-sided penalties (0 when satisfied); math
// operands defer to mathResidual (one- or two-sided by kind); ramp operands
// already carry their RMS deviation; everything else is two-sided (value − target).
function _operandResidual(op, val) {
    if (isTotalThickness(op.type)) return _ttResidual(op, val);
    if (isConstraint(op.type) || isMinmax(op.type)) {
        // Satisfied on the ≥target side for MNT / min-type, ≤target side otherwise.
        const lowerBound = op.type === 'MNT' || isMinType(op.type);
        return lowerBound ? Math.max(0, op.target - val) : Math.max(0, val - op.target);
    }
    if (isMath(op.type)) return mathResidual(op, val);
    if (isRamp(op)) return val;
    return val - op.target;
}

// opts.skipConstraints — exclude MNT/MXT penalties. Used by the needle/GE
// synthesis scans, whose virtual probe layers are intentionally sub-floor;
// the thickness bound is enforced by dMin insertion + post-insert DLS refine
// (which keeps the penalty) + cleanupLayers pruning, not by the scan gradient.
export function calcMF(operands, computed, opts = {}) {
    const skipConstraints = !!opts.skipConstraints;
    // Two weight accumulators: `sumWopt` (the optical/spec operands that define
    // the merit's normalization) and `sumWcon` (manufacturability constraints —
    // MNT/MXT layer bounds and the TT/TOT total-thickness budget). The RMS is
    // normalized by the OPTICAL weight only; constraints add their one-sided
    // penalty to the NUMERATOR but never enter the denominator. See the return
    // block for the rationale (keeps MF == OMF when constraints are satisfied).
    let sumWRes2 = 0, sumWopt = 0, sumWcon = 0, n = 0;
    let sawNonFinite = false;   // a contributing operand evaluated to NaN/Inf
    for (let i = 0; i < operands.length; i++) {
        const op = operands[i];
        if (!op.enabled || computed[i] == null) continue;
        const w = op.weight;
        // TT and MNT/MXT are manufacturability constraints — excluded from the
        // synthesis-scan / OMF merit (skipConstraints) so they never distort
        // needle placement; active during DLS refinement only. Their one-sided
        // penalty enters the numerator but not the normalization denominator (below).
        if (skipConstraints && (isTotalThickness(op.type) || isConstraint(op.type))) continue;
        let diff = _operandResidual(op, computed[i]);
        // Normalize to dimensionless units (σ = 1 for optical → no change;
        // argwave nm residual ÷ σ_λ). See operandResidualScale above.
        const sc = operandResidualScale(op);
        if (sc !== 1) diff /= sc;
        // Guard against a non-finite residual poisoning the entire MF. A NaN/Inf
        // from a single operand (e.g. a material at a dispersion pole, a missing
        // material, or a cyclic math operand) would otherwise propagate through
        // sumWRes2 → Math.sqrt(NaN) and make the whole merit function NaN,
        // silently breaking every optimizer. Skip the bad operand instead.
        if (!Number.isFinite(diff)) { sawNonFinite = true; continue; }
        sumWRes2 += w * diff * diff;
        // Denominator policy. Manufacturability CONSTRAINTS (MNT/MXT layer bounds
        // and the TT/TOT total-thickness budget) add their one-sided penalty to
        // the numerator above, but their weight is kept OUT of the normalization
        // denominator (sumWopt). Everything else — optical T/R/A targets, ramps,
        // min/max spec operands and math operands (all of which express OPTICAL
        // performance and are also kept by calcOMF) — normalizes the RMS.
        //
        // Why: a SATISFIED constraint then contributes 0/0 → it leaves the MF
        // EXACTLY equal to the OMF, instead of diluting the RMS denominator and
        // deflating MF below OMF (the surprising MF < OMF the user hit). A
        // VIOLATED constraint raises the numerator from 0 continuously, so MF
        // climbs smoothly above OMF — no discontinuity (this was the concern the
        // earlier "always count in sumW" change addressed; counting the penalty
        // in the numerator at ALL times, satisfied or not, fixes BOTH: continuity
        // AND MF ≥ OMF). The needle scanner already normalizes by optical weight
        // only (scanners.js), so this also aligns the reported MF with the scan.
        if (isConstraint(op.type) || isTotalThickness(op.type)) sumWcon += w;
        else sumWopt += w;
        n++;
    }
    // n === 0 means NO operand contributed. Two very different causes:
    //  (a) at least one operand evaluated to NaN/Inf and every operand was
    //      dropped — the H5 NaN-cascade: a genuinely degenerate design. Return
    //      Infinity so it can never masquerade as a perfect MF=0 and be accepted
    //      by `mfTry < mf` / trip isConverged().
    //  (b) no operand was degenerate — the list is empty, or every operand is a
    //      constraint skipped by skipConstraints (synthesis-scan / OMF), or all
    //      disabled. Nothing to score → trivially-perfect MF 0 (long-standing,
    //      tested behaviour the needle/GE scanners rely on).
    if (n === 0) return sawNonFinite ? Infinity : 0;
    // Normalize by the optical weight. Fall back to the constraint-weight sum for
    // a CONSTRAINTS-ONLY merit (e.g. a pure total-thickness target with no optical
    // operand to normalize against) so such a merit still scores its violations.
    // n > 0 but both sums 0: real, finite operands exist but all weight 0 —
    // trivially satisfied, established (tested) merit is 0.
    const denom = sumWopt > 0 ? sumWopt : sumWcon;
    if (denom <= 0) return 0;
    return Math.sqrt(sumWRes2 / denom);
}

// Optical merit function (OMF) — the SAME RMS as calcMF but excluding the
// non-optical manufacturability penalties (MNT/MXT per-layer bounds and the
// TT/TOT total-thickness budget). This is the canonical "optical MF" used by
// the needle/GE scanners, error analysis and the yield simulators, surfaced to
// the user alongside the full MF. Min/max spec operands and math operands stay
// IN the OMF because they express optical performance, not manufacturability.
// One place defines what OMF means — adjust the opts here to retune it globally.
export function calcOMF(operands, computed) {
    return calcMF(operands, computed, { skipConstraints: true });
}

// The weighted-RMS NORMALIZATION denominator used by calcMF — the optical weight
// sum (everything except MNT/MXT/TT manufacturability constraints), with a
// constraints-only fallback. Exported so the analytic-gradient path (gradMF in
// dls.js) divides by the SAME quantity calcMF does: MF = √(SSR/denom) ⇒
// ∇MF = (Jᵀr)/(‖r‖·√denom). Keep this byte-consistent with calcMF's denom logic.
export function mfWeightDenominator(operands, { skipConstraints = false } = {}) {
    let sumWopt = 0, sumWcon = 0;
    for (const op of operands) {
        if (!op.enabled) continue;
        if (isConstraint(op.type) || isTotalThickness(op.type)) {
            if (skipConstraints) continue;
            sumWcon += op.weight;
        } else {
            sumWopt += op.weight;
        }
    }
    return sumWopt > 0 ? sumWopt : sumWcon;
}
