/**
 * Analytic P-function needle scan (d→0 limit of the pre/post method).
 *
 * Surface-mode-aware orchestration. Two math paths:
 *   front_only  → single needleScan on the front stack (fast).
 *   full-system → needleScan three times (forward front, reverse front, back),
 *                 then chain-rule through Macleod §2.6.4.
 * The TMM passes live in needleScanPasses.js, the per-descriptor chain rule in
 * chainRule.js, and the per-row gradient accumulation in gradientAccum.js.
 *
 *   SYMMETRIC mode: insertion at front gap p is mirrored to back gap (N−p)
 *                   (intra: layer (N−1−k), frac (1−f)). Sum the front-insertion
 *                   chain rule at p AND the back-insertion chain rule at the
 *                   mirror with the same material.
 *
 * Every row the synthesis merit scores adds its own contribution. A row built
 * on R, T or A takes its needle slope from the analytic Jacobian's row builders
 * (jacobianAssembly/jacRows.js) over the needle descriptors: band and
 * single-wavelength rows, range targets, weighted integrals, worst-case and
 * MXW/MNW rows, dB rows, PPEF, level-free curve blocks, and the math rows
 * reading any of them by the chain rule through the rows they read. A row
 * whose needle slope those derivatives do not give is differenced on its own
 * per candidate (rowDifference.js). The merit and its normalization are
 * calcMF's with skipConstraints, the ones scanNeedlesFD differences.
 *
 * With a cone active, each R/T/A read is the weighted sum over the cone's rays,
 * so its needle derivative is the same weighted sum of the per-ray derivatives.
 *
 * Reference: Sullivan & Dobrowolski / Tikhonravov, Appl. Opt. 35 (1996).
 */

import {
    isFullSystemEval, buildEvalContext, effectiveBackLayers, evaluateOperands, calcMF,
    mfWeightDenominator, operandSampleDeviations, residualScaleIn,
} from '../evalCore.js';
import { isEllipsometry, isManufacturability, isPhaseDispersion, isRangeTarget } from '../operandModel.js';
import { operandResidualRows } from '../residualRows.js';
import { _jacRows, _jacRowsDecline } from '../jacobianAssembly/jacRows.js';
import { rangeTargetRowSum } from '../jacobianAssembly/bandRows.js';
import { coneNodesAt, inConeRow } from '../evalCore/tmmEval.js';
import { coneIsActive } from '../coneAngle.js';
import { resolveScanSide } from './sides.js';
import { _buildDescriptors, _buildCandidates } from './descriptors.js';
import { _makeScanAt } from './needleScanPasses.js';
import { needlePointEvaluators, _accumRows } from './gradientAccum.js';
import { _accumRowDifference } from './rowDifference.js';
import { meritStacks, needleIn } from '../environmentStacks.js';
import { meanSquareMerit } from '../../../environments/environmentMerit.js';

const MF_OPT = { skipConstraints: true };

// Rows whose needle slope the R and T derivatives of needleScan do not give:
// the thickness rows (TT, STR, MNT, MXT), which the scan meets only through a
// math row since the synthesis merit skips them, and the rows read from the
// complex amplitudes (phase, group delay and its orders, Ψ, Δ, tanΨ, cosΔ).
const outOfReach = op => isManufacturability(op.type) || isPhaseDispersion(op.type) || isEllipsometry(op.type);

// Rows the synthesis merit scores: enabled, weighted, and not a thickness row,
// which skipConstraints leaves out.
const isScored = op => op.enabled && !isManufacturability(op.type) && op.weight > 0;

/**
 * Whether the analytic scan of `operands` differences some scored row on its
 * own, at one evaluation of that row per insertion. Read from the rows alone,
 * so a row counts even where it adds nothing on the stack at hand (a one-sided
 * row that holds).
 */
export function scanDifferencesRows(operands) {
    const jc = { operands, outOfReach };
    return operands.some((op, i) => isScored(op) && _jacRowsDecline(op, i, jc));
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

// The layers of the side scanned. Symmetric mode auto-derives back =
// reverse(front); for other modes use the stored back layers. resolveScanSide
// forces side='front' in front_only and symmetric and side='back' in back_only.
const scannedLayers = (design, side) => (side === 'back' ? effectiveBackLayers(design) : (design.frontLayers || []));

// The evaluation of `args.design` the gradient loop needs, all but the
// descriptors: { ctx0, comp, cfg, mf0, sumW, targetLayers, fracs }, or null
// when the side has no layer or there is no candidate material.
function _scanBase(args, surfaceMode, side) {
    const { operands, design, resolveMat, candidateMats, nIntra = 4 } = args;

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
    // The evaluation also settles each row's cone rays on ctx0; the gradient
    // below sums each row over the same rays and weights (coneNodesAt).
    const ctx0 = buildEvalContext(design, resolveMat);
    const comp = evaluateOperands(operands, ctx0);
    const mf0  = calcMF(operands, comp, MF_OPT);
    const sumW = mfWeightDenominator(operands, comp, MF_OPT);

    const fracs = Array.from({ length: nIntra }, (_, i) => (i + 1) / (nIntra + 1));
    const isSingleSurface = surfaceMode === 'front_only' || surfaceMode === 'back_only';
    const cfg = {
        surfaceMode, side, isFull: !isSingleSurface,
        front, back, Nf, Nb, nIntra,
        frontMats, backMats, n0mat, nsmat, neMat, candidateMats, fracs, subThickMm,
        raysAt: (aoi, lam) => coneNodesAt(ctx0, aoi, lam),
        coneActive: coneIsActive(ctx0.cone),
    };
    return { ctx0, comp, cfg, mf0, sumW, targetLayers, fracs };
}

// Validate eligibility and assemble everything the gradient loop needs:
// { ctx0, comp, descs, cfg, mf0, sumW }, or null if the analytic scan can't run.
function _prepareScan(args, surfaceMode, side) {
    const base = _scanBase(args, surfaceMode, side);
    if (!base || !(base.mf0 > 1e-12) || !(base.sumW > 0)) return null;
    const descs = _buildDescriptors(base.targetLayers.length, args.candidateMats, base.targetLayers, base.fracs, args.dMin ?? 0);
    return { ...base, descs };
}

// Add the needle numerators of one environment's stack (environmentStacks.js)
// to `descs`, each times f / D: f the factor a needle of its material takes in
// the environment, D the stack's weight sum. The stack scans the needle of
// each pool material as its environment deposits it (needleIn), at the places
// of the recipe's descriptors. Returns the stack's optical merit.
function _accumStack(args, stack, descs, { surfaceMode, side }) {
    const { candidateMats, resolveMat, deltaNm = 0.5 } = args;
    const needles = candidateMats.map(c => needleIn(stack, c.id, c.mat, resolveMat));
    const mats = candidateMats.map((c, ci) => ({ ...c, mat: needles[ci].mat }));
    const own = { ...args, operands: stack.operands, design: stack.design, candidateMats: mats };
    const base = _scanBase(own, surfaceMode, side);
    if (!(base.mf0 > 1e-12) || !(base.sumW > 0)) return base.mf0;
    const local = descs.map(d => ({ ...d, num: 0 }));
    _accumMerit(stack.operands, { ...base, descs: local }, deltaNm);
    local.forEach((d, di) => { descs[di].num += needles[d.ci].factor * d.num / base.sumW; });
    return base.mf0;
}

// The analytic scan of a design with environments: with OMF² = (1/N) Σ OMF_k²
// over its N stacks, dOMF/dd = Σ_k f_k·OMF_k·dOMF_k/dd_k / (N·OMF) and
// OMF_k·dOMF_k/dd_k = num_k / D_k, so each descriptor's numerator is
// Σ_k f_k·num_k / D_k and the denominator N·OMF. The descriptors are the
// recipe's: its places and the pool's materials, the host's own recipe
// material left out, the split floor on recipe thickness.
function _scanStacks(args, stacks, surfaceMode, side) {
    const { design, candidateMats, nIntra = 4, dMin = 0, deltaNm = 0.5 } = args;
    const targetLayers = scannedLayers(design, side);
    if (targetLayers.length === 0 || !candidateMats?.length || stacks.length === 0) return null;
    const fracs = Array.from({ length: nIntra }, (_, i) => (i + 1) / (nIntra + 1));
    const descs = _buildDescriptors(targetLayers.length, candidateMats, targetLayers, fracs, dMin);
    const mf0 = meanSquareMerit(stacks.map(stack => _accumStack(args, stack, descs, { surfaceMode, side })));
    if (!(mf0 > 1e-12)) return null;
    return { candidates: _buildCandidates(descs, candidateMats, { mf0, sumW: stacks.length, deltaNm, side }), mf0 };
}

// The Jacobian-row context (jacRows.js) over the needle descriptors.
function _needleRowContext(operands, { ctx0, comp, descs, cfg }) {
    const { propDeriv, propValue } = needlePointEvaluators(cfg, descs, _makeScanAt(cfg));
    return {
        comp,
        freeIdx: descs.map((_, di) => di),
        nFree: descs.length,
        ctx: ctx0,
        propDeriv,
        propValue,
        residualScale: residualScaleIn(operands),
        operands,
        outOfReach,
    };
}

// Add every scored row's contribution to descs[].num. A row adds nothing when
// its weight is 0 or every residual of it is 0 (an inequality that holds), so
// neither is differentiated.
function _accumMerit(operands, prep, deltaNm) {
    const { ctx0, comp, descs, cfg } = prep;
    const jc = _needleRowContext(operands, prep);
    const deviations = operandSampleDeviations(comp);
    for (let i = 0; i < operands.length; i++) {
        const op = operands[i];
        if (!isScored(op) || comp[i] == null) continue;
        const sigma = jc.residualScale(op);
        const residuals = operandResidualRows(op, comp[i], deviations[i], sigma);
        if (residuals.every(r => r === 0)) continue;
        if (isRangeTarget(op.type)) {
            inConeRow(ctx0, op, () => rangeTargetRowSum(op, jc, residuals))
                .forEach((value, di) => { descs[di].num += value; });
            continue;
        }
        const rows = _jacRows(op, i, jc);
        if (rows) _accumRows(descs, residuals, rows);
        else _accumRowDifference({ operands, comp, ctx0, cfg, descs, candidateMats: cfg.candidateMats, deltaNm, sigma }, i);
    }
}

// Returns the same { candidates, mf0 } contract, or null if not applicable.
// `args.dMin` (nm) leaves out intra positions whose split would put a half of
// the host below the floor (descriptors.js, intraSplitFits). `args.deltaNm` is
// the needle the rows without an exact slope are differenced with. A design
// with environments is scanned on every environment the optical merit counts
// (environmentStacks.js, _scanStacks), and declined when one of those scores
// a one-sided design as the whole part, as the design's own setting would.
export function scanNeedlesAnalytic(args) {
    const { candidateMats, deltaNm = 0.5 } = args;
    const surfaceMode = args.design?.surfaceMode || 'front_only';
    const side = resolveScanSide(surfaceMode, args.side ?? 'front');
    const scored = meritStacks(args.design, args.operands, { optical: true, resolveMat: args.resolveMat });
    const scanned = scored.stacks ? scored.stacks.map(stack => stack.design) : [args.design];
    if (scanned.some(design => _analyticDeclines(surfaceMode, design))) return null;
    if (scored.stacks) return _scanStacks(args, scored.stacks, surfaceMode, side);
    const own = { ...args, operands: scored.operands, design: scored.design };
    const prep = _prepareScan(own, surfaceMode, side);
    if (!prep) return null;
    _accumMerit(own.operands, prep, deltaNm);
    const { descs, mf0, sumW } = prep;
    return { candidates: _buildCandidates(descs, candidateMats, { mf0, sumW, deltaNm, side }), mf0 };
}
