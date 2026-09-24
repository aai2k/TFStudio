/**
 * Analytic P-function needle scan (d→0 limit of the pre/post method).
 *
 * Surface-mode-aware orchestration. Two math paths:
 *   front_only  → single tmmNeedleScan on the front stack (fast).
 *   full-system → tmmNeedleScan three times (forward front, reverse front, back),
 *                 then chain-rule through Macleod §2.6.4.
 * The TMM passes live in needleScanPasses.js, the per-descriptor chain rule in
 * chainRule.js, and the per-operand gradient accumulation in gradientAccum.js.
 *
 *   SYMMETRIC mode: insertion at front gap p is mirrored to back gap (N−p)
 *                   (intra: layer (N−1−k), frac (1−f)). Sum the front-insertion
 *                   chain rule at p AND the back-insertion chain rule at the
 *                   mirror with the same material.
 *
 * With a cone active, each R/T/A read is the weighted sum over the cone's rays,
 * so its needle derivative is the same weighted sum of the per-ray derivatives.
 *
 * Reference: Sullivan & Dobrowolski / Tikhonravov, Appl. Opt. 35 (1996).
 */

import { isFullSystemEval, buildEvalContext, effectiveBackLayers, evaluateOperands, calcMF } from '../evalCore.js';
import {
    isDmfs, isBlank, isManufacturability, isRangeTarget,
    OPTICAL_OPERAND_TYPES, RANGE_TARGET_OPERAND_TYPES,
} from '../operandModel.js';
import { coneNodesAt } from '../evalCore/tmmEval.js';
import { coneIsActive } from '../coneAngle.js';
import { resolveScanSide } from './sides.js';
import { _buildDescriptors, _buildCandidates } from './descriptors.js';
import { _makeScanAt } from './needleScanPasses.js';
import { _accumRangeTarget, _accumBandAvg } from './gradientAccum.js';

// Row types whose value is the R, T or A of the spectrum, the only quantities
// the chain rule here differentiates: single-wavelength and band-average rows,
// the per-wavelength targets, and the s/p-suffixed point types older designs
// still carry. The accumulators take the channel from the first letter of the
// type, so admission has to be by name: TANPSI and the TOD family also start
// with T and are tanΨ and third-order dispersion, not transmittance.
const PHOTOMETRIC_TYPES = new Set([
    ...OPTICAL_OPERAND_TYPES, ...RANGE_TARGET_OPERAND_TYPES,
    'TS', 'TP', 'RS', 'RP', 'AS', 'AP',
]);

// The enabled rows the analytic scan scores, or null when the analytic path does
// not apply. Any other row that counts toward the synthesis merit (weighted
// integrals, band extrema, math, argwave, ellipsometric, phase and field rows,
// measured blocks) sends the whole scan to the FD path.
function _collectOptOps(operands) {
    const optOps = [];
    for (const op of operands) {
        if (!op.enabled) continue;
        // Excluded from synthesis MF: DMFS/BLNK (inert), and the
        // manufacturability rows, which skipConstraints drops and which read
        // the thickness vector rather than a spectral characteristic.
        if (isDmfs(op.type) || isBlank(op.type) || isManufacturability(op.type)) continue;
        if (!PHOTOMETRIC_TYPES.has(op.type)) return null;
        optOps.push(op);
    }
    return optOps.length === 0 ? null : optOps;
}

// Whether the analytic path must decline: a 'total' MF on a single-side
// optimize mode, which this path doesn't compose a single-side full-system
// gradient for. That case defers to scanNeedlesFD, which is total-aware by
// construction.
function _analyticDeclines(surfaceMode, design) {
    return isFullSystemEval(surfaceMode, design?.mfEvalMode || 'side')
        && (surfaceMode === 'front_only' || surfaceMode === 'back_only');
}

// Resolve the incident / substrate / exit material handles + substrate bulk.
function _resolveMedia(design, resolveMat) {
    const inc  = typeof design.incidentMedium === 'string'
        ? design.incidentMedium : (design.incidentMedium?.material ?? 'Air');
    const exit = typeof design.exitMedium === 'string'
        ? design.exitMedium     : (design.exitMedium?.material     ?? 'Air');
    return {
        n0mat: resolveMat(inc),
        nsmat: resolveMat(design.substrate?.material ?? 'BK7'),
        neMat: resolveMat(exit),
        subThickMm: design.substrate?.thickness ?? 1.0,
    };
}

// Validate eligibility and assemble everything the gradient loop needs:
// { optOps, descs, cfg, mf0, sumW }, or null if the analytic scan can't run.
function _prepareScan(args, surfaceMode, side) {
    const { operands, design, resolveMat, candidateMats, nIntra = 4, dMin = 0 } = args;
    const optOps = _collectOptOps(operands);
    if (!optOps) return null;

    // Symmetric mode auto-derives back = reverse(front); for other modes use the
    // stored back layers. resolveScanSide forces side='front' in front_only and
    // symmetric and side='back' in back_only.
    const front = design.frontLayers || [];
    const back = effectiveBackLayers(design);
    const Nf = front.length;
    const Nb = back.length;
    const targetLayers = side === 'back' ? back : front;
    const N = targetLayers.length;
    if (N === 0 || !candidateMats?.length) return null;

    const { n0mat, nsmat, neMat, subThickMm } = _resolveMedia(design, resolveMat);
    const frontMats = front.map(l => resolveMat(l.material));
    const backMats  = back.map(l => resolveMat(l.material));

    // mf0 via the existing path → guaranteed consistent with calcMF / FD scan.
    // The evaluation also settles the cone's rays on ctx0; the gradient below
    // is summed over the same rays and weights (coneNodesAt).
    const ctx0 = buildEvalContext(design, resolveMat);
    const mf0  = calcMF(operands, evaluateOperands(operands, ctx0), { skipConstraints: true });
    if (!(mf0 > 1e-12)) return null;

    let sumW = 0;
    for (const op of optOps) sumW += op.weight;
    if (!(sumW > 0)) return null;

    const fracs = Array.from({ length: nIntra }, (_, i) => (i + 1) / (nIntra + 1));
    const descs = _buildDescriptors(N, candidateMats, targetLayers, fracs, dMin);

    const isSingleSurface = surfaceMode === 'front_only' || surfaceMode === 'back_only';
    const cfg = {
        surfaceMode, side, isFull: !isSingleSurface,
        front, back, Nf, Nb, nIntra,
        frontMats, backMats, n0mat, nsmat, neMat, candidateMats, fracs, subThickMm,
        raysAt: (aoi, lam) => coneNodesAt(ctx0, aoi, lam),
        coneActive: coneIsActive(ctx0.cone),
    };
    return { optOps, descs, cfg, mf0, sumW };
}

// Returns the same { candidates, mf0 } contract, or null if not applicable.
// `args.dMin` (nm) leaves out intra positions whose split would put a half of
// the host below the floor (descriptors.js, intraSplitFits).
export function scanNeedlesAnalytic(args) {
    const { design, candidateMats, deltaNm = 0.5 } = args;
    const surfaceMode = design?.surfaceMode || 'front_only';
    const side = resolveScanSide(surfaceMode, args.side ?? 'front');
    if (_analyticDeclines(surfaceMode, design)) return null;

    const prep = _prepareScan(args, surfaceMode, side);
    if (!prep) return null;
    const { optOps, descs, cfg, mf0, sumW } = prep;

    const scanAt = _makeScanAt(cfg);
    for (const op of optOps) {
        if (isRangeTarget(op.type)) _accumRangeTarget(cfg, op, descs, scanAt);
        else _accumBandAvg(cfg, op, descs, scanAt);
    }

    return { candidates: _buildCandidates(descs, candidateMats, { mf0, sumW, deltaNm, side }), mf0 };
}
