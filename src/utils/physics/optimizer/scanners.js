/**
 * Needle / Gradual-Evolution insertion scanners — analytic P-function scan,
 * finite-difference fallback, optimal-thickness search, GE boundary scan.
 *
 * Imports the
 * eval core (TMM needle scan + merit) and layer ops. Reference: Sullivan &
 * Dobrowolski / Tikhonravov, Appl. Opt. 35 (1996).
 */

import { tmm, tmmNeedleScan, tmmThicknessJacobian, tmmThicknessHessian } from '../thinFilmMath.js';
import { resolveSourceSpec, resolveDetectorSpec } from '../spectralWeightings.js';
import {
    tmmJacEval, tmmNeedleScanEval, ADAPTIVE_SAMPLING_DEFAULTS, densifyOperandsForFeatures, collectDesignMaterialIds, tmmFullSystem,
    isFullSystemEval, resolveEvalMode, tmmProp, MATH_REGISTRY, makeRefResolver, computeMathValue,
    mathResidual, mathResidualKind, evalOperand, buildEvalContext, evaluateOperands, ARGWAVE_RESIDUAL_SCALE_NM,
    operandResidualScale, calcMF,
} from './evalCore.js';
import {
    OPTICAL_OPERAND_TYPES, RANGE_TARGET_OPERAND_TYPES, TOTAL_THICKNESS_OPERAND_TYPES, BLANK_OPERAND_TYPES, INTEGRAL_OPERAND_TYPES, MINMAX_OPERAND_TYPES,
    CONSTRAINT_OPERAND_TYPES, INEQUALITY_OPERAND_TYPES, MATH_OPERAND_TYPES, ARGWAVE_OPERAND_TYPES, OPERAND_TYPES, OPERAND_POLS,
    isConstraint, isDmfs, isBlank, isTotalThickness, isRangeTarget, isIntegral,
    isMinmax, isMinType, isInequality, isArgwave, isArgwaveMin, isMath,
    isMathSingleRef, isMathPairRef, isFractionalUnit, mathTargetInPercent, argwaveOpticalChar, argwavePolCode,
    polFromType, AVG_POINTS, AVG_STEP_NM, AVG_POINTS_MAX, bandSampleCount, ARGWAVE_DEFAULT_POINTS,
    PNORM_DEFAULT, makeOperand, isRamp, makeConstraintOperand, makeDefaultConstraints, makeDmfsOperand,
} from './operandModel.js';
import { isRangeAvg, charOf, operandSampleLambdas, requiredLambdas, buildPresampledTable } from './sampling.js';
import { makeConeSpec, coneIsActive } from './coneAngle.js';
import { mirrorLayers, insertNeedle, cleanupLayers, bestNeedlePerPosition, insertNeedleIntra } from './layerOps.js';

// ── Needle P-function scan ────────────────────────────────────────────────────
//
// For each insertion position (N+1 interface gaps + 4 intra-layer fractions per
// layer) × each candidate material, inserts a thin probe needle of deltaNm and
// computes ΔMF / deltaNm (the gradient of the merit function w.r.t. needle
// thickness).  Returns { candidates, mf0 }.
//
// candidates: [{ pos, materialId, dMF, grad, intra?, layerK?, frac? }]
//   pos: integer gap index, or layerK + frac for intra positions
//   dMF: gradient × deltaNm  (negative = MF improves with this needle)

// Dispatcher: prefer the exact analytic Tikhonravov/Sullivan P-function;
// fall back to the validated finite-difference scan when the merit function
// contains terms whose ∂Q/∂(B,C) is not analytically defined here (ramp /
// constraint-only / custom). Sullivan & Dobrowolski (1996) give exactly this
// rationale for keeping a numerical variant available.
//
// Surface-mode awareness: both scanners route through buildEvalContext /
// tmmFullSystem (Macleod §2.6.4) when design.surfaceMode != 'front_only'.
// `side` ('front'|'back') chooses which stack to scan; it is forced to 'front'
// in front_only and symmetric (symmetric auto-mirrors into the back), and to
// 'back' in back_only. In both_independent the caller passes it explicitly.
export function scanNeedlesPFunction(args) {
    const analytic = scanNeedlesAnalytic(args);
    if (analytic) return analytic;
    return scanNeedlesFD(args);
}

// Resolve effective scan side (mode-forced where applicable).
//   front_only / symmetric → 'front'  (symmetric mirrors front→back automatically)
//   back_only              → 'back'
//   both_independent       → whatever the caller requested ('front'|'back')
// UI components call this with a stored radio selection to know which layer
// array is the synthesis target for the current design.
export function resolveScanSide(surfaceMode, requestedSide) {
    if (surfaceMode === 'front_only')  return 'front';
    if (surfaceMode === 'back_only')   return 'back';
    if (surfaceMode === 'symmetric')   return 'front';   // back mirrored
    return requestedSide === 'back' ? 'back' : 'front';   // both_independent
}

// Build a perturbed eval context for one needle insertion (gap or intra) into
// the chosen side; in symmetric mode the back stack is rebuilt as reverse(front).
function _perturbCtxGap(ctx, surfaceMode, side, pos, mat, deltaNm) {
    if (side === 'front') {
        const frontThicks = [...ctx.frontThicks.slice(0, pos), deltaNm, ...ctx.frontThicks.slice(pos)];
        const frontMats   = [...ctx.frontMats.slice(0, pos),   mat,     ...ctx.frontMats.slice(pos)];
        let backThicks = ctx.backThicks, backMats = ctx.backMats;
        if (surfaceMode === 'symmetric') {
            backThicks = [...frontThicks].reverse();
            backMats   = [...frontMats].reverse();
        }
        return { ...ctx, frontThicks, frontMats, backThicks, backMats,
            fullThicks: surfaceMode === 'both_independent'
                ? [...frontThicks, ...backThicks] : frontThicks };
    }
    const backThicks = [...ctx.backThicks.slice(0, pos), deltaNm, ...ctx.backThicks.slice(pos)];
    const backMats   = [...ctx.backMats.slice(0, pos),   mat,     ...ctx.backMats.slice(pos)];
    return { ...ctx, backThicks, backMats,
        fullThicks: surfaceMode === 'both_independent'
            ? [...ctx.frontThicks, ...backThicks] : ctx.frontThicks };
}

function _perturbCtxIntra(ctx, surfaceMode, side, k, frac, mat, deltaNm) {
    const tKey = side === 'back' ? 'backThicks' : 'frontThicks';
    const mKey = side === 'back' ? 'backMats'   : 'frontMats';
    const dk = ctx[tKey][k];
    const d1 = Math.max(frac * dk, 1e-3);
    const d2 = Math.max((1 - frac) * dk, 1e-3);
    const hostMat = ctx[mKey][k];
    const thicksNew = [
        ...ctx[tKey].slice(0, k), d1, deltaNm, d2, ...ctx[tKey].slice(k + 1),
    ];
    const matsNew = [
        ...ctx[mKey].slice(0, k), hostMat, mat, hostMat, ...ctx[mKey].slice(k + 1),
    ];
    if (side === 'front') {
        let backThicks = ctx.backThicks, backMats = ctx.backMats;
        if (surfaceMode === 'symmetric') {
            backThicks = [...thicksNew].reverse();
            backMats   = [...matsNew].reverse();
        }
        return { ...ctx, frontThicks: thicksNew, frontMats: matsNew, backThicks, backMats,
            fullThicks: surfaceMode === 'both_independent'
                ? [...thicksNew, ...backThicks] : thicksNew };
    }
    return { ...ctx, backThicks: thicksNew, backMats: matsNew,
        fullThicks: surfaceMode === 'both_independent'
            ? [...ctx.frontThicks, ...thicksNew] : ctx.frontThicks };
}

// Analytic P-function scan (d→0 limit of the pre/post method).
//
// Surface-mode-aware. Two math paths:
//   front_only  → single tmmNeedleScan on the front stack (fast).
//   full-system → tmmNeedleScan three times (forward front, reverse front, back),
//                 then chain-rule through Macleod §2.6.4:
//                     T = T_f · P · T_b / D
//                     R = R_f + T_f · T_f' · P² · R_b / D
//                     D = 1 − R_f' · R_b · P²
//
// Derivatives (d → 0):
//   FRONT insertion (∂R_b/∂d = ∂T_b/∂d = 0, ∂D/∂d = −P²·R_b·∂R_f'/∂d):
//     ∂R/∂d = ∂R_f/∂d
//             + (P²·R_b/D²) · [ D·(∂T_f/∂d·T_f' + T_f·∂T_f'/∂d)
//                             + T_f·T_f'·P²·R_b·∂R_f'/∂d ]
//     ∂T/∂d = (P·T_b/D²) · [ D·∂T_f/∂d + T_f·P²·R_b·∂R_f'/∂d ]
//
//   BACK insertion (∂R_f/∂d = ∂T_f/∂d = ∂R_f'/∂d = ∂T_f'/∂d = 0,
//                   ∂D/∂d = −P²·R_f'·∂R_b/∂d):
//     ∂R/∂d = T_f·T_f'·P²·∂R_b/∂d / D²        (D + R_b·P²·R_f' = 1)
//     ∂T/∂d = (P·T_f/D²) · [ D·∂T_b/∂d + T_b·P²·R_f'·∂R_b/∂d ]
//
//   SYMMETRIC mode: insertion at front gap p is mirrored to back gap (N−p)
//                   (intra: layer (N−1−k), frac (1−f)). Sum the front-insertion
//                   chain rule at p AND the back-insertion chain rule at the
//                   mirror with the same material.
//
// Returns the same { candidates, mf0 } contract, or null if not applicable.
export function scanNeedlesAnalytic({ operands, design, resolveMat, candidateMats, deltaNm = 0.5, nIntra = 4, side = 'front' }) {
    const surfaceMode = design?.surfaceMode || 'front_only';
    side = resolveScanSide(surfaceMode, side);
    // Cone-angle averaging: the analytic P-function is a single-
    // incidence-angle gradient. With a cone active the merit is averaged over
    // many angles, so decline → the dispatcher uses scanNeedlesFD, which runs
    // through buildEvalContext/evaluateOperands/tmmProp and is cone-averaged
    // (and cone-consistent) by construction. (Cone-summing the analytic scan is
    // a future speedup.)
    if (coneIsActive(makeConeSpec(design?.cone || {}))) return null;
    // 'total' MF on a single-side optimize mode (front_only/back_only) needs a
    // full-system gradient that this analytic path doesn't yet compose for a
    // single variable side — defer to the FD scan (scanNeedlesFD), which builds
    // its ctx from buildEvalContext and is therefore total-aware and exact
    // (just slower). The accept/revert + DLS refine that gate every insertion
    // already use the full-system MF, so synthesis stays correct regardless.
    if (isFullSystemEval(surfaceMode, design?.mfEvalMode || 'side')
        && (surfaceMode === 'front_only' || surfaceMode === 'back_only')) {
        return null;
    }
    // Single-surface modes use the fast direct-gradient path; full-system
    // (symmetric / both_independent) needs the three-pass Macleod composition.
    const isSingleSurface = surfaceMode === 'front_only' || surfaceMode === 'back_only';
    const isFull = !isSingleSurface;

    // Applicable to plain optical operands (R/T/A, any pol) — single-λ, band-
    // average (TAV/RAV/AAV) AND continuous per-λ targets (TGT/RGT/AGT).
    // Weighted-integral and minmax operands have non-uniform per-sample
    // weighting / non-linear surrogates the analytic scan does not yet handle →
    // FD fallback (still mathematically correct, just slower).
    const optOps = [];
    for (const op of operands) {
        if (!op.enabled) continue;
        // Excluded from synthesis MF: DMFS/BLNK (inert), MNT/MXT (skipConstraints),
        // TT (thickness-domain, not a spectral characteristic).
        if (isDmfs(op.type) || isBlank(op.type) || isConstraint(op.type) || isTotalThickness(op.type)) continue;
        if (isIntegral(op.type) || isMinmax(op.type)) return null;
        // Math (OPGT/OPLT/OPVA/ABSO/ABGT/ABLT/DIFF/SUMM/PROD) and argwave
        // operands haven't been ported to the analytic needle scan yet — FD
        // fallback handles them correctly.
        if (isMath(op.type) || isArgwave(op.type)) return null;
        if (!'RTA'.includes(charOf(op.type))) return null;
        optOps.push(op);
    }
    if (optOps.length === 0) return null;

    // Symmetric mode auto-derives back = reverse(front); for other modes use the
    // stored back layers. resolveScanSide forces side='front' in front_only and
    // symmetric and side='back' in back_only.
    const front = design.frontLayers || [];
    const backRaw = design.backLayers || [];
    const back = surfaceMode === 'symmetric' ? [...front].reverse() : backRaw;
    const Nf = front.length;
    const Nb = back.length;
    const targetLayers = side === 'back' ? back : front;
    const N = targetLayers.length;
    if (N === 0 || !candidateMats?.length) return null;

    const inc   = typeof design.incidentMedium === 'string'
        ? design.incidentMedium : (design.incidentMedium?.material ?? 'Air');
    const exit  = typeof design.exitMedium === 'string'
        ? design.exitMedium     : (design.exitMedium?.material     ?? 'Air');
    const n0mat = resolveMat(inc);
    const nsmat = resolveMat(design.substrate?.material ?? 'BK7');
    const neMat = resolveMat(exit);
    const subThickMm = design.substrate?.thickness ?? 1.0;

    const frontMats = front.map(l => resolveMat(l.material));
    const backMats  = back.map(l => resolveMat(l.material));

    // mf0 via the existing path → guaranteed consistent with calcMF / FD scan.
    const ctx0 = buildEvalContext(design, resolveMat);
    const mf0  = calcMF(operands, evaluateOperands(operands, ctx0), { skipConstraints: true });
    if (!(mf0 > 1e-12)) return null;

    let sumW = 0;
    for (const op of optOps) sumW += op.weight;
    if (!(sumW > 0)) return null;

    const fracs = Array.from({ length: nIntra }, (_, i) => (i + 1) / (nIntra + 1));

    // Candidate descriptors (gaps then intra) on the chosen side.
    const descs = [];
    for (let pos = 0; pos <= N; pos++)
        for (let ci = 0; ci < candidateMats.length; ci++)
            descs.push({ kind: 'gap', pos, ci, num: 0 });
    for (let k = 0; k < N; k++)
        for (let fi = 0; fi < fracs.length; fi++)
            for (let ci = 0; ci < candidateMats.length; ci++) {
                if (candidateMats[ci].id === targetLayers[k].material) continue;  // host → ~0
                descs.push({ kind: 'intra', k, fi, frac: fracs[fi], ci, num: 0 });
            }

    // Cache scans by (λ, pol, aoi); for full-system this includes three
    // tmmNeedleScan results (forward, reverse, back) plus composed R/T/A and P.
    const cache = new Map();
    const scanAt = (lam, pol, aoi) => {
        const key = lam + '|' + pol + '|' + aoi;
        let v = cache.get(key);
        if (v) return v;

        const n0 = n0mat.getNK(lam);
        const ns = nsmat.getNK(lam);
        const candNs = candidateMats.map(c => c.mat.getNK(lam));

        if (!isFull) {
            if (surfaceMode === 'back_only') {
                // Single back-surface scan: light incident from the exit medium.
                // backLayers are stored substrate→exit, so reverse them so the
                // TMM "sees" them in exit→substrate (light direction) order.
                // Descriptor positions stay in storage order; readDeriv applies
                // a mirror=true mapping when reading gradients out.
                const ne = neMat.getNK(lam);
                const bLayersND = back.map((l, idx) => ({ n: backMats[idx].getNK(lam), d: l.thickness || 0 }));
                const bLayersRev = [...bLayersND].reverse();
                const res = tmmNeedleScanEval(lam, aoi, pol, ne, ns, bLayersRev, candNs, fracs);
                v = { mode: 'back_only', R: res.R, T: res.T, A: res.A, bck: res };
                cache.set(key, v);
                return v;
            }
            const layersND = front.map((l, idx) => ({ n: frontMats[idx].getNK(lam), d: l.thickness || 0 }));
            const res = tmmNeedleScanEval(lam, aoi, pol, n0, ns, layersND, candNs, fracs);
            v = { mode: 'front_only', R: res.R, T: res.T, A: res.A, fwd: res };
            cache.set(key, v);
            return v;
        }

        // full-system: three passes
        const ne = neMat.getNK(lam);
        const sin0 = Math.sin(aoi * Math.PI / 180);
        const sinSub = ns[0] > 0 ? Math.min(1, n0[0] * sin0 / ns[0]) : 0;
        const cosSub = Math.sqrt(1 - sinSub * sinSub);
        const aoiSub = Math.asin(sinSub) * 180 / Math.PI;

        const fLayersND = front.map((l, idx) => ({ n: frontMats[idx].getNK(lam), d: l.thickness || 0 }));
        const fLayersRev = [...fLayersND].reverse();
        const bLayersND = back.map((l, idx) => ({ n: backMats[idx].getNK(lam), d: l.thickness || 0 }));

        // Forward and back passes always run; reverse front pass only needed when
        // there's a front insertion (front_only is already short-circuited above,
        // so for back_only we technically could skip rev, but keeping it keeps the
        // cache shape uniform and is a single TMM per (λ,pol,aoi) — cheap).
        const fwd = tmmNeedleScanEval(lam, aoi,    pol, n0, ns, fLayersND,  candNs, fracs);
        const rev = tmmNeedleScanEval(lam, aoiSub, pol, ns, n0, fLayersRev, candNs, fracs);
        const bck = tmmNeedleScanEval(lam, aoiSub, pol, ns, ne, bLayersND,  candNs, fracs);

        const Rf  = fwd.R, Tf  = fwd.T;
        const Rfp = rev.R, Tfp = rev.T;
        const Rb  = bck.R, Tb  = bck.T;

        const k_sub    = ns[1];
        const d_sub_nm = subThickMm * 1e6;
        const P = (k_sub > 0 && cosSub > 0)
            ? Math.exp(-4 * Math.PI * k_sub * d_sub_nm / (lam * cosSub))
            : 1.0;
        const P2 = P * P;
        const D  = 1 - Rfp * Rb * P2;
        const R  = Rf + (Tf * Tfp * P2 * Rb) / D;
        const T  = (Tf * P * Tb) / D;
        const A  = Math.max(0, 1 - R - T);

        v = { mode: 'full', R, T, A, P, P2, D, Rf, Tf, Rfp, Tfp, Rb, Tb, fwd, rev, bck };
        cache.set(key, v);
        return v;
    };

    // Read needle derivative {dR, dT} at a position descriptor from a
    // tmmNeedleScan result, with optional position mirroring (used for the
    // reverse-front and symmetric-back passes: gap p ↔ N-p,
    // intra (k, fi) ↔ (N-1-k, nIntra-1-fi)).
    const readDeriv = (scan, d, NLayers, mirror) => {
        if (d.kind === 'gap') {
            const p = mirror ? (NLayers - d.pos) : d.pos;
            return scan.gaps[p][d.ci];
        }
        const k  = mirror ? (NLayers - 1 - d.k)        : d.k;
        const fi = mirror ? (nIntra - 1 - d.fi)        : d.fi;
        return scan.intra[k][fi].perCand[d.ci];
    };

    // Per-descriptor characteristic sensitivity d(char)/d(needle) at one
    // (λ,pol,aoi) scan result — encapsulates the front_only / back_only /
    // full-system chain rule. Returns the SAME value the previous inline code
    // produced, so the band-average path stays numerically unchanged.
    const charDerivAt = (res, char, d) => {
        if (res.mode === 'front_only') return readDeriv(res.fwd, d, Nf, false)['d' + char];
        if (res.mode === 'back_only')  return readDeriv(res.bck, d, Nb, true)['d' + char];
        const { D, P, P2, Tf, Rfp, Tfp, Rb, Tb, fwd, rev, bck } = res;
        const invD2 = 1 / (D * D);
        let dR = 0, dT = 0;
        if (side === 'front' || surfaceMode === 'symmetric') {
            const fM = readDeriv(fwd, d, Nf, false);
            const rM = readDeriv(rev, d, Nf, true);              // mirror p→N-p
            const dRf = fM.dR, dTf = fM.dT, dRfp = rM.dR, dTfp = rM.dT;
            dT += (P * Tb) * invD2 * (D * dTf + Tf * P2 * Rb * dRfp);
            dR += dRf + (P2 * Rb) * invD2 * (D * (dTf * Tfp + Tf * dTfp) + Tf * Tfp * P2 * Rb * dRfp);
        }
        if (side === 'back' || surfaceMode === 'symmetric') {
            const bM = readDeriv(bck, d, Nb, surfaceMode === 'symmetric');
            const dRb = bM.dR, dTb = bM.dT;
            dR += (Tf * Tfp * P2) * invD2 * dRb;
            dT += (P * Tf) * invD2 * (D * dTb + Tb * P2 * Rfp * dRb);
        }
        return char === 'R' ? dR : char === 'T' ? dT : -(dR + dT);
    };

    for (const op of optOps) {
        const char  = charOf(op.type);                       // 'R' | 'T' | 'A'
        const pol   = polFromType(op.type) ?? op.pol ?? 'avg';
        const pols  = pol === 'avg' ? ['s', 'p'] : [pol];
        // SAME λ grid as evalOperand/calcMF (operandSampleLambdas) → gradient
        // consistent with the MF and with the worker's pre-sampled getNK table.
        const lams  = operandSampleLambdas(op);
        const nL = lams.length, npol = pols.length;

        if (isRangeTarget(op.type)) {
            // Continuous per-λ target (TGT/RGT/AGT): the operand
            // value is comp = √((1/nL)Σ devₛ²), devₛ = val(λₛ) − targetₛ. Its
            // MF-gradient contribution is w·comp·∂comp/∂d = (w/nL)·Σₛ devₛ·gₛ
            // (the 1/comp cancels), gₛ = ∂val(λₛ)/∂d. Reduces to the band-avg
            // single-point form when nL=1, so mixed TAV+TGT stays consistent.
            const t0 = op.target;
            const t1 = op.targetEnd != null ? op.targetEnd : op.target;
            const wn = op.weight / nL;
            for (let s = 0; s < nL; s++) {
                const lam = lams[s];
                let val = 0;
                const g = new Float64Array(descs.length);
                for (const pl of pols) {
                    const res = scanAt(lam, pl, op.aoi);
                    val += res[char] / npol;
                    for (let di = 0; di < descs.length; di++) g[di] += charDerivAt(res, char, descs[di]) / npol;
                }
                const f   = nL > 1 ? s / (nL - 1) : 0;
                const dev = val - (t0 + (t1 - t0) * f);
                for (let di = 0; di < descs.length; di++) descs[di].num += wn * dev * g[di];
            }
            continue;
        }

        // Single-λ / band-average (TAV/RAV/AAV): residual = mean(char) − target.
        const wlp = 1 / (nL * npol);
        let qBase = 0;
        const dq = new Float64Array(descs.length);
        for (const lam of lams) {
            for (const pl of pols) {
                const res = scanAt(lam, pl, op.aoi);
                qBase += wlp * res[char];
                for (let di = 0; di < descs.length; di++) dq[di] += wlp * charDerivAt(res, char, descs[di]);
            }
        }
        const resid = qBase - op.target;
        for (let di = 0; di < descs.length; di++) descs[di].num += op.weight * resid * dq[di];
    }

    const invF = 1 / (mf0 * sumW);
    const candidates = descs.map(d => {
        const grad = d.num * invF;                            // dF/dd  (P₁)
        const base = { materialId: candidateMats[d.ci].id, dMF: grad * deltaNm, grad, side };
        return d.kind === 'gap'
            ? { ...base, pos: d.pos }
            : { ...base, pos: d.k + d.frac, intra: true, layerK: d.k, frac: d.frac };
    });

    return { candidates, mf0 };
}

// Validated finite-difference needle scan (Sullivan & Dobrowolski numerical
// variant). Surface-mode-aware: evaluation runs through buildEvalContext /
// tmmFullSystem (Macleod §2.6.4) so back coating + substrate bulk are included
// for non-front_only modes. Retained as the analytic-path fallback (handles
// ramp / weighted-integral / minmax operands the analytic scan cannot).
export function scanNeedlesFD({ operands, design, resolveMat, candidateMats, deltaNm = 0.5, nIntra = 4, side = 'front' }) {
    const surfaceMode = design?.surfaceMode || 'front_only';
    side = resolveScanSide(surfaceMode, side);

    // Build the base eval context (symmetric auto-mirrors back from front).
    const ctx0 = buildEvalContext(design, resolveMat);
    const sourceLayers = side === 'back' ? (design.backLayers || []) : (design.frontLayers || []);
    const N = sourceLayers.length;

    // Synthesis gradient uses the optical MF only — the virtual probe is
    // sub-floor by construction; the min-thickness bound is handled by the
    // post-insert DLS refine + pruning, not this scan.
    const MF_OPT = { skipConstraints: true };
    const mf0   = calcMF(operands, evaluateOperands(operands, ctx0), MF_OPT);

    const candidates = [];

    // A. Interface gap positions (N+1 gaps, indices 0…N)
    for (let pos = 0; pos <= N; pos++) {
        for (const { id: matId, mat } of candidateMats) {
            const ctxNew = _perturbCtxGap(ctx0, surfaceMode, side, pos, mat, deltaNm);
            const mfNew  = calcMF(operands, evaluateOperands(operands, ctxNew), MF_OPT);
            const grad   = (mfNew - mf0) / deltaNm;
            candidates.push({ pos, materialId: matId, dMF: grad * deltaNm, grad, side });
        }
    }

    // B. Intra-layer positions (nIntra fractions per layer)
    const fracs = Array.from({ length: nIntra }, (_, i) => (i + 1) / (nIntra + 1));
    for (let k = 0; k < N; k++) {
        const hostId = sourceLayers[k].material;
        for (const frac of fracs) {
            for (const { id: matId, mat } of candidateMats) {
                if (matId === hostId) continue;   // same material → zero net effect
                const ctxNew = _perturbCtxIntra(ctx0, surfaceMode, side, k, frac, mat, deltaNm);
                const mfNew  = calcMF(operands, evaluateOperands(operands, ctxNew), MF_OPT);
                const grad   = (mfNew - mf0) / deltaNm;
                candidates.push({
                    pos: k + frac, materialId: matId,
                    dMF: grad * deltaNm, grad,
                    intra: true, layerK: k, frac, side,
                });
            }
        }
    }

    return { candidates, mf0 };
}

// ── Find optimal needle thickness ─────────────────────────────────────────────
//
// After scanNeedlesPFunction identifies the best position+material, this
// function searches for the thickness that minimises the MF (golden-section
// search over [deltaNm, maxNm]).

export function findOptimalNeedleThickness({ operands, design, resolveMat, candidate, deltaNm = 0.5, maxNm = 200, tol = 0.5, side = 'front' }) {
    const surfaceMode = design?.surfaceMode || 'front_only';
    side = resolveScanSide(surfaceMode, side);

    const ctx0 = buildEvalContext(design, resolveMat);
    const mat  = candidate._mat;

    function mfAt(d) {
        const ctxNew = candidate.intra
            ? _perturbCtxIntra(ctx0, surfaceMode, side, candidate.layerK, candidate.frac, mat, d)
            : _perturbCtxGap(ctx0,   surfaceMode, side, candidate.pos, mat, d);
        // Optical-only, consistent with the scan that selected this candidate;
        // the thickness floor is enforced by the subsequent DLS refine + prune.
        return calcMF(operands, evaluateOperands(operands, ctxNew), { skipConstraints: true });
    }

    // A needle is a THIN perturbation (Tikhonravov 1996; Sullivan §3): the
    // line search only tunes it near the thin end, then DLS grows it. The
    // static-MF surface over a wide range is multimodal — an unbounded search
    // can land on a huge "needle" (a design-destroying slab) that lowers the
    // frozen-stack MF but ruins synthesis. So clamp the upper bound to needle
    // scale and only accept the optimized thickness if it actually beats the
    // thin insert; otherwise insert thin and let DLS do the work.
    const bMax = Math.min(maxNm, Math.max(4 * deltaNm, 60));
    const fMin = mfAt(deltaNm);

    const phi = (Math.sqrt(5) - 1) / 2;
    let a = deltaNm, b = bMax;
    let c = b - phi * (b - a);
    let fd = a + phi * (b - a);
    let fc = mfAt(c), ffd = mfAt(fd);
    for (let i = 0; i < 50 && (b - a) > tol; i++) {
        if (fc < ffd) { b = fd; fd = c; ffd = fc; c = b - phi * (b - a); fc = mfAt(c); }
        else          { a = c;  c = fd; fc = ffd;  fd = a + phi * (b - a); ffd = mfAt(fd); }
    }
    const dOpt = (a + b) / 2;
    // Guard: never return a thickness that isn't strictly better (statically)
    // than the thin insert — keeps it a genuine needle.
    return (mfAt(dOpt) < fMin - 1e-12) ? dOpt : deltaNm;
}

// ── GE boundary-position scan ─────────────────────────────────────────────────
//
// "Forced insertion" fallback (Sullivan & Dobrowolski 1996): when no needle
// gradient is negative, try inserting a D_MIN-thick layer at the entry (pos=0)
// and exit (pos=N) boundaries for every candidate material.  Returns the best
// result after DLS refinement, or null if none improves MF.
//
// opts: { operands, design, resolveMat, candidateMats, thickNm, dlsIter, mfCurrent }

export function scanGEInsertions({ operands, design, resolveMat, candidateMats, thickNm = 15.0, side = 'front' }) {
    const surfaceMode = design?.surfaceMode || 'front_only';
    side = resolveScanSide(surfaceMode, side);

    const sourceLayers = side === 'back' ? (design.backLayers || []) : (design.frontLayers || []);
    const N = sourceLayers.length;

    // Optical-only: GE forced insertions are sub-floor probes; the bound is
    // enforced by the post-insert DLS refine + cleanupLayers, not this scan.
    const MF_OPT = { skipConstraints: true };
    const ctx0   = buildEvalContext(design, resolveMat);
    const mf0    = calcMF(operands, evaluateOperands(operands, ctx0), MF_OPT);

    const candidates = [];
    for (const pos of [0, N]) {
        for (const { id: matId, mat } of candidateMats) {
            const ctxNew = _perturbCtxGap(ctx0, surfaceMode, side, pos, mat, thickNm);
            const mfNew  = calcMF(operands, evaluateOperands(operands, ctxNew), MF_OPT);
            candidates.push({ pos, materialId: matId, dMF: mfNew - mf0, mfNew, side });
        }
    }

    return { candidates, mf0 };
}

