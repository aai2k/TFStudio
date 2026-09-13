import { isRangeTarget, isMinmax, polFromType } from '../operandModel.js';
import { expandMeasuredCurveOperands } from '../measuredCurveOperand.js';
import { charOf, operandSampleLambdas } from '../sampling.js';
import { tmmProp } from './tmmEval.js';
import { buildEvalContext } from './evalContext.js';

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
    return count > curN
        ? { count, featureWidth: minFeatureWidth, capped: neededN > cfg.maxPoints }
        : null;
}

// Densify the band-sampled operands whose bands hide a sub-grid feature, returning
// a NEW operands array (unchanged operands keep their identity; densified ones are
// shallow clones with a raised rampPoints/bandPoints override). Call at run launch
// and feed the result to BOTH requiredLambdas/pre-sampling AND the worker job, so
// the byte-identical λ-grid contract is preserved. `notify(summary)` (optional)
// receives a one-line report so callers can surface what was densified / capped
// (no silent caps).
// Densify one band-sampled operand if its band hides a sub-grid feature; returns
// a shallow clone with a raised rampPoints/bandPoints override, or the operand
// unchanged. Bumps `state.capped` when the needed count was clamped to maxPoints.
function _densifyOne(op, ctx, cfg, state) {
    if (!op || op.enabled === false) return op;
    if (!(isRangeTarget(op.type) || isMinmax(op.type))) return op;
    let res = null;
    try { res = adaptiveCountForOperand(op, ctx, cfg); }
    catch { res = null; }
    if (!res) return op;
    if (res.capped) state.capped++;
    const field = isRangeTarget(op.type) ? 'rampPoints' : 'bandPoints';
    return { ...op, [field]: res.count };
}

export function densifyOperandsForFeatures(operands, design, resolveMat, cfg = ADAPTIVE_SAMPLING_DEFAULTS, notify = null) {
    if (!Array.isArray(operands) || operands.length === 0) return operands;
    // Measured blocks always expand at this run-launch seam, independent of
    // adaptive feature sampling. The expanded list is fed to both
    // requiredLambdas/material pre-sampling and the optimizer/worker job.
    const expanded = expandMeasuredCurveOperands(operands);
    if (!cfg || cfg.enabled === false) return expanded;
    let ctx;
    try { ctx = buildEvalContext(design, resolveMat); }
    catch { return expanded; }   // can't probe → keep measured expansion, skip adaptive probing

    const state = { capped: 0 };
    const out = expanded.map(op => _densifyOne(op, ctx, cfg, state));
    // A densified operand is a fresh object (≠ its input); unchanged ones keep identity.
    const changed = out.some((o, i) => o !== expanded[i]);
    if (changed && typeof notify === 'function') {
        const bumped = out.filter((o, i) => o !== expanded[i]).length;
        notify({ bumped, capped: state.capped });
    }
    return changed ? out : expanded;
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
