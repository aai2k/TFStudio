/**
 * Filter type catalog (design wizard) — categories, per-type field specs, and
 * operand generators.
 *
 * Depends only on the operand data model. optimizer.js re-exports this whole
 * surface so existing importers are unchanged.
 */

import { fractionFromLog, isLogPoint, logValue, makeOperand } from './operandModel.js';

// ── Filter type catalog (wizard) ─────────────────────────────────────────────
//
// Filter types are grouped by category. Each type declares:
//   - label, category
//   - fields[]: the per-type inputs the wizard renders
//   - generate(params, common): returns operand list
//
// Operand generation is paired R+T by default so the optimizer cannot satisfy
// an AR target by absorbing the light (the classic "1-operand RAV→0 wins by
// making T→0 too" failure mode). Per-type weights are tuned: HR weights its
// stopband R higher than T because residual T in mirrors is a softer
// constraint than residual R (Macleod §10).

export const FILTER_CATEGORIES = [
    { id: 'AR',       types: ['BBAR', 'V_COAT', 'DUAL_AR', 'TRIPLE_AR'] },
    { id: 'HR',       types: ['BB_HR', 'SINGLE_HR', 'DUAL_HR', 'TRIPLE_HR'] },
    { id: 'BS',       types: ['NEUTRAL_BS', 'CUSTOM_BS'] },
    { id: 'EDGE',     types: ['LONGPASS', 'SHORTPASS'] },
    { id: 'BAND',     types: ['BANDPASS', 'NOTCH'] },
    { id: 'GRAD',     types: ['LINEAR_RAMP'] },
    { id: 'INTEGRAL', types: ['VIS_AR', 'SOLAR_BLOCK', 'SOLAR_PASS', 'WORST_T_MIN', 'WORST_R_MAX'] },
    { id: 'CUSTOM',   types: ['CUSTOM_TARGET'] },
];

// Operand type codes are polarization-AGNOSTIC now — polarization rides on
// op.pol (avg/s/p), set by the generators below. So:
//   band-average → always {T|R|A}AV   (TAV/RAV/AAV, evaluated at op.pol)
//   single-λ     → always {T|R|A}      (T/R/A, evaluated at op.pol)
// (Previously these appended S/P, producing the now-removed RS/TS/… types.)
function avgTypeCode(base /*, pol */)  { return base + 'AV'; }
function discTypeCode(base /*, pol */) { return base; }

function aoiArray(common) {
    const { aoi = 0, aoiEnd = null, aoiSteps = 1 } = common;
    const a1 = aoi, a2 = aoiEnd == null ? aoi : aoiEnd;
    const n  = (a1 === a2 || aoiSteps <= 1) ? 1 : Math.max(2, Math.round(aoiSteps));
    return n === 1 ? [a1] : Array.from({ length: n }, (_, i) => a1 + (a2 - a1) * i / (n - 1));
}

// Build a paired R+T operand block over a wavelength range, targeting (rTarget, tTarget).
// Used by all band-based filter types (AR, HR, edge, bandpass, notch).
//
// The target is enforced PER-WAVELENGTH (not as a single band average): with
// common.targetMode = 'continuous' (default) each channel becomes one flat
// range-target operand (RGT/TGT) across [λStart, λEnd]; 'discrete' emits point
// operands on a `common.stepNm` grid. TAV/RAV are pure averages now and are no
// longer used for spectral targets (see spectralTargetOps).
function rangeRT({ lamStart, lamEnd, rTarget, tTarget, rWeight = 1.0, tWeight = 1.0, common }) {
    const pol  = common.pol || 'avg';
    const mode = common.targetMode || 'continuous';
    const step = common.stepNm || 1;
    const ops  = [];
    for (const aoi of aoiArray(common)) {
        ops.push(...spectralTargetOps({ channel: 'R', pol, lamStart, lamEnd, t0: rTarget, weight: rWeight, mode, stepNm: step, aoi }));
        ops.push(...spectralTargetOps({ channel: 'T', pol, lamStart, lamEnd, t0: tTarget, weight: tWeight, mode, stepNm: step, aoi }));
    }
    return ops;
}

// Continuous range-target type code for a channel ('T'→'TGT', 'R'→'RGT', 'A'→'AGT').
function rangeTargetCode(base) { return base + 'GT'; }

// Emit a spectral target for ONE channel + pol over [lamStart, lamEnd]:
//   • mode='continuous' → a single range-target operand (TGT/RGT/AGT) carrying
//     the per-λ target line target=t0 (at λStart) → targetEnd=t1 (at λEnd).
//     Flat target ⇒ t1 = t0.
//   • mode='discrete'   → N point operands (T/R/A or S/P) on a `stepNm` grid,
//     each with the interpolated single target at its λ.
// This is the shared engine for the beamsplitter and gradient wizards (item 5/7):
// TAV/RAV are never used for spectral targets anymore — they are pure averages.
// Wavelengths from lamStart to lamEnd on a step of about `stepNm`: both ends,
// equally spaced, never fewer than two.
function stepGrid(lamStart, lamEnd, stepNm) {
    const nPts = Math.max(2, Math.round(Math.abs(lamEnd - lamStart) / stepNm) + 1);
    return Array.from({ length: nPts }, (_, i) => lamStart + (lamEnd - lamStart) * (i / (nPts - 1)));
}

function spectralTargetOps({ channel, pol, lamStart, lamEnd, t0, t1 = null, weight = 1, mode = 'continuous', stepNm = 1, aoi }) {
    const end = (t1 == null) ? t0 : t1;
    if (mode === 'discrete') {
        const lams = stepGrid(lamStart, lamEnd, stepNm);
        return lams.map((lam, i) => makeOperand({
            type: discTypeCode(channel, pol),
            lambdaStart: lam, lambdaEnd: lam, aoi, pol,
            target: t0 + (end - t0) * (i / (lams.length - 1)), weight,
        }));
    }
    // continuous → one range-target operand
    return [makeOperand({
        type: rangeTargetCode(channel),
        lambdaStart: lamStart, lambdaEnd: lamEnd, aoi, pol,
        target: t0, targetEnd: end, weight,
    })];
}

// A wizard type writing one worst-case row per angle over a band; `tStart` is
// reused as the target, a floor for a TMN row and a ceiling for an RMX one.
function worstCaseType(type, defaultTarget) {
    return {
        category: 'INTEGRAL',
        fields: [
            { key: 'lamStart', default: 400, positive: true },
            { key: 'lamEnd',   default: 700, positive: true },
            { key: 'tStart',   default: defaultTarget, min: 0, max: 1, step: 0.001 },
        ],
        generate: (p, common) => aoiArray(common).map(aoi => makeOperand({
            type, lambdaStart: p.lamStart, lambdaEnd: p.lamEnd, aoi,
            pol: common.pol || 'avg',
            target: Math.max(0, Math.min(1, p.tStart)), weight: 1.0,
        })),
    };
}

// Build paired R+T operands at a single wavelength (V-coat, single-HR, multi-wave AR/HR).
function singleRT({ lam, rTarget, tTarget, rWeight = 1.0, tWeight = 1.0, common }) {
    const pol = common.pol || 'avg';
    const ops = [];
    for (const aoi of aoiArray(common)) {
        ops.push(makeOperand({ type: discTypeCode('R', pol), lambdaStart: lam, lambdaEnd: lam, aoi, pol, target: rTarget, weight: rWeight }));
        ops.push(makeOperand({ type: discTypeCode('T', pol), lambdaStart: lam, lambdaEnd: lam, aoi, pol, target: tTarget, weight: tWeight }));
    }
    return ops;
}

export const FILTER_TYPES = {
    // ── Anti-reflection ──────────────────────────────────────────────────────
    BBAR: {
        category: 'AR',
        supportsTargetMode: true,
        fields: [
            { key: 'lamStart', default: 400, positive: true },
            { key: 'lamEnd',   default: 700, positive: true },
        ],
        // Paired R+T forces absorption to be penalized: a stack with R≈0 but T≪1
        // (i.e. absorbing) cannot satisfy both operands simultaneously.
        generate: (p, common) => rangeRT({ lamStart: p.lamStart, lamEnd: p.lamEnd, rTarget: 0.0, tTarget: 1.0, common }),
    },
    V_COAT: {
        category: 'AR',
        fields: [{ key: 'lam0', default: 550, positive: true }],
        generate: (p, common) => singleRT({ lam: p.lam0, rTarget: 0.0, tTarget: 1.0, common }),
    },
    DUAL_AR: {
        category: 'AR',
        fields: [
            { key: 'lam1', default: 450, positive: true },
            { key: 'lam2', default: 650, positive: true },
        ],
        generate: (p, common) => [
            ...singleRT({ lam: p.lam1, rTarget: 0.0, tTarget: 1.0, common }),
            ...singleRT({ lam: p.lam2, rTarget: 0.0, tTarget: 1.0, common }),
        ],
    },
    TRIPLE_AR: {
        category: 'AR',
        fields: [
            { key: 'lam1', default: 450, positive: true },
            { key: 'lam2', default: 550, positive: true },
            { key: 'lam3', default: 650, positive: true },
        ],
        generate: (p, common) => [
            ...singleRT({ lam: p.lam1, rTarget: 0.0, tTarget: 1.0, common }),
            ...singleRT({ lam: p.lam2, rTarget: 0.0, tTarget: 1.0, common }),
            ...singleRT({ lam: p.lam3, rTarget: 0.0, tTarget: 1.0, common }),
        ],
    },

    // ── Mirror / High reflector ──────────────────────────────────────────────
    // For HR: R is the primary spec; residual T is softer. Weight R higher.
    BB_HR: {
        category: 'HR',
        supportsTargetMode: true,
        fields: [
            { key: 'lamStart', default: 400, positive: true },
            { key: 'lamEnd',   default: 700, positive: true },
        ],
        generate: (p, common) => rangeRT({ lamStart: p.lamStart, lamEnd: p.lamEnd, rTarget: 1.0, tTarget: 0.0, rWeight: 1.0, tWeight: 0.5, common }),
    },
    SINGLE_HR: {
        category: 'HR',
        fields: [{ key: 'lam0', default: 550, positive: true }],
        generate: (p, common) => singleRT({ lam: p.lam0, rTarget: 1.0, tTarget: 0.0, rWeight: 1.0, tWeight: 0.5, common }),
    },
    DUAL_HR: {
        category: 'HR',
        fields: [
            { key: 'lam1', default: 450, positive: true },
            { key: 'lam2', default: 650, positive: true },
        ],
        generate: (p, common) => [
            ...singleRT({ lam: p.lam1, rTarget: 1.0, tTarget: 0.0, rWeight: 1.0, tWeight: 0.5, common }),
            ...singleRT({ lam: p.lam2, rTarget: 1.0, tTarget: 0.0, rWeight: 1.0, tWeight: 0.5, common }),
        ],
    },
    TRIPLE_HR: {
        category: 'HR',
        fields: [
            { key: 'lam1', default: 450, positive: true },
            { key: 'lam2', default: 550, positive: true },
            { key: 'lam3', default: 650, positive: true },
        ],
        generate: (p, common) => [
            ...singleRT({ lam: p.lam1, rTarget: 1.0, tTarget: 0.0, rWeight: 1.0, tWeight: 0.5, common }),
            ...singleRT({ lam: p.lam2, rTarget: 1.0, tTarget: 0.0, rWeight: 1.0, tWeight: 0.5, common }),
            ...singleRT({ lam: p.lam3, rTarget: 1.0, tTarget: 0.0, rWeight: 1.0, tWeight: 0.5, common }),
        ],
    },

    // ── Beamsplitter ─────────────────────────────────────────────────────────
    // Spectral targets via spectralTargetOps: continuous (one range-target
    // operand per channel/pol) or discrete (point operands at `common.stepNm`).
    // Paired R+T keeps absorption penalized. No TAV/RAV "50→50" anymore.
    NEUTRAL_BS: {
        category: 'BS',
        supportsTargetMode: true,
        fields: [
            { key: 'lamStart', default: 400, positive: true },
            { key: 'lamEnd',   default: 700, positive: true },
            { key: 'rPct',     default: 50,  min: 0,   max: 100, step: 1 },
        ],
        // 50/50 (or user R%) on the chosen polarization (avg/s/p). R + paired T.
        generate: (p, common) => {
            const pol  = common.pol || 'avg';
            const mode = common.targetMode || 'continuous';
            const step = common.stepNm || 1;
            const r    = Math.max(0, Math.min(1, p.rPct / 100));
            const t    = 1 - r;
            const ops  = [];
            for (const aoi of aoiArray(common)) {
                ops.push(...spectralTargetOps({ channel: 'R', pol, lamStart: p.lamStart, lamEnd: p.lamEnd, t0: r, mode, stepNm: step, aoi }));
                ops.push(...spectralTargetOps({ channel: 'T', pol, lamStart: p.lamStart, lamEnd: p.lamEnd, t0: t, mode, stepNm: step, aoi }));
            }
            return ops;
        },
    },
    CUSTOM_BS: {
        category: 'BS',
        supportsTargetMode: true,
        // Generates s and p rows itself, so the wizard's Pol choice does not apply.
        fixedPol: true,
        // Independent s/p reflectance (e.g. polarizing splitter Rs=30, Rp=70, or
        // a balanced 50/50). T targets are auto-set to the complement (paired) so
        // the optimizer can't satisfy R by absorbing.
        fields: [
            { key: 'lamStart', default: 400, positive: true },
            { key: 'lamEnd',   default: 700, positive: true },
            { key: 'rsPct',    default: 50,  min: 0,   max: 100, step: 1 },
            { key: 'rpPct',    default: 50,  min: 0,   max: 100, step: 1 },
        ],
        generate: (p, common) => {
            const mode = common.targetMode || 'continuous';
            const step = common.stepNm || 1;
            const rs   = Math.max(0, Math.min(1, p.rsPct / 100));
            const rp   = Math.max(0, Math.min(1, p.rpPct / 100));
            const ops  = [];
            for (const aoi of aoiArray(common)) {
                // s-pol R + paired T
                ops.push(...spectralTargetOps({ channel: 'R', pol: 's', lamStart: p.lamStart, lamEnd: p.lamEnd, t0: rs,     mode, stepNm: step, aoi }));
                ops.push(...spectralTargetOps({ channel: 'T', pol: 's', lamStart: p.lamStart, lamEnd: p.lamEnd, t0: 1 - rs, mode, stepNm: step, aoi }));
                // p-pol R + paired T
                ops.push(...spectralTargetOps({ channel: 'R', pol: 'p', lamStart: p.lamStart, lamEnd: p.lamEnd, t0: rp,     mode, stepNm: step, aoi }));
                ops.push(...spectralTargetOps({ channel: 'T', pol: 'p', lamStart: p.lamStart, lamEnd: p.lamEnd, t0: 1 - rp, mode, stepNm: step, aoi }));
            }
            return ops;
        },
    },

    // ── Edge filters ─────────────────────────────────────────────────────────
    // User specifies pass band and stop band explicitly (transition gap = pass-end → stop-start).
    LONGPASS: {
        category: 'EDGE',
        supportsTargetMode: true,
        fields: [
            { key: 'stopStart', default: 400, positive: true },
            { key: 'stopEnd',   default: 600, positive: true },
            { key: 'passStart', default: 700, positive: true },
            { key: 'passEnd',   default: 1000, positive: true },
        ],
        generate: (p, common) => [
            ...rangeRT({ lamStart: p.stopStart, lamEnd: p.stopEnd, rTarget: 1.0, tTarget: 0.0, common }),
            ...rangeRT({ lamStart: p.passStart, lamEnd: p.passEnd, rTarget: 0.0, tTarget: 1.0, common }),
        ],
    },
    SHORTPASS: {
        category: 'EDGE',
        supportsTargetMode: true,
        fields: [
            { key: 'passStart', default: 400, positive: true },
            { key: 'passEnd',   default: 600, positive: true },
            { key: 'stopStart', default: 700, positive: true },
            { key: 'stopEnd',   default: 1000, positive: true },
        ],
        generate: (p, common) => [
            ...rangeRT({ lamStart: p.passStart, lamEnd: p.passEnd, rTarget: 0.0, tTarget: 1.0, common }),
            ...rangeRT({ lamStart: p.stopStart, lamEnd: p.stopEnd, rTarget: 1.0, tTarget: 0.0, common }),
        ],
    },

    // ── Bandpass / Notch ────────────────────────────────────────────────────
    BANDPASS: {
        category: 'BAND',
        supportsTargetMode: true,
        fields: [
            { key: 'lowStopStart',  default: 300, positive: true },
            { key: 'lowStopEnd',    default: 450, positive: true },
            { key: 'passStart',     default: 500, positive: true },
            { key: 'passEnd',       default: 600, positive: true },
            { key: 'highStopStart', default: 650, positive: true },
            { key: 'highStopEnd',   default: 1000, positive: true },
        ],
        generate: (p, common) => [
            ...rangeRT({ lamStart: p.lowStopStart,  lamEnd: p.lowStopEnd,  rTarget: 1.0, tTarget: 0.0, common }),
            ...rangeRT({ lamStart: p.passStart,     lamEnd: p.passEnd,     rTarget: 0.0, tTarget: 1.0, common }),
            ...rangeRT({ lamStart: p.highStopStart, lamEnd: p.highStopEnd, rTarget: 1.0, tTarget: 0.0, common }),
        ],
    },
    NOTCH: {
        category: 'BAND',
        supportsTargetMode: true,
        fields: [
            { key: 'lowPassStart',  default: 300, positive: true },
            { key: 'lowPassEnd',    default: 450, positive: true },
            { key: 'stopStart',     default: 500, positive: true },
            { key: 'stopEnd',       default: 600, positive: true },
            { key: 'highPassStart', default: 650, positive: true },
            { key: 'highPassEnd',   default: 1000, positive: true },
        ],
        generate: (p, common) => [
            ...rangeRT({ lamStart: p.lowPassStart,  lamEnd: p.lowPassEnd,  rTarget: 0.0, tTarget: 1.0, common }),
            ...rangeRT({ lamStart: p.stopStart,     lamEnd: p.stopEnd,     rTarget: 1.0, tTarget: 0.0, common }),
            ...rangeRT({ lamStart: p.highPassStart, lamEnd: p.highPassEnd, rTarget: 0.0, tTarget: 1.0, common }),
        ],
    },

    // ── Integral / Worst-case ────────────────────────────────────────────────
    // These wizard types use the TIW (weighted integral) and TMN/RMX
    // (worst-case minimum / maximum over the band) operands. Source/detector specs are
    // resolved at evaluation time from `op.source` / `op.detector` against
    // the spectralWeightings catalog (D65, V(λ), AM1.5G, etc.).

    // Photopic-weighted AR over the visible: minimize photopic R, maximize
    // photopic T. One operand pair, naturally weighted by the eye's response
    // — the merit function "cares" about the visible the way a human does.
    VIS_AR: {
        category: 'INTEGRAL',
        fields: [
            { key: 'lamStart', default: 380, positive: true },
            { key: 'lamEnd',   default: 780, positive: true },
        ],
        generate: (p, common) => {
            const ops = [];
            for (const aoi of aoiArray(common)) {
                ops.push(makeOperand({
                    type: 'TIW', lambdaStart: p.lamStart, lambdaEnd: p.lamEnd, aoi,
                    pol: common.pol || 'avg', target: 1.0, weight: 1.0,
                    source: { id: 'D65' }, detector: { id: 'photopic' },
                }));
                ops.push(makeOperand({
                    type: 'RIW', lambdaStart: p.lamStart, lambdaEnd: p.lamEnd, aoi,
                    pol: common.pol || 'avg', target: 0.0, weight: 1.0,
                    source: { id: 'D65' }, detector: { id: 'photopic' },
                }));
            }
            return ops;
        },
    },

    // Solar block: AM1.5G-weighted transmission must hit a low target.
    SOLAR_BLOCK: {
        category: 'INTEGRAL',
        fields: [
            { key: 'lamStart', default: 300, positive: true },
            { key: 'lamEnd',   default: 2500, positive: true },
            { key: 'tStart',   default: 0.0,  min: 0, max: 1, step: 0.01 },  // reused as target T̄
        ],
        generate: (p, common) => {
            const ops = [];
            for (const aoi of aoiArray(common)) {
                ops.push(makeOperand({
                    type: 'TIW', lambdaStart: p.lamStart, lambdaEnd: p.lamEnd, aoi,
                    pol: common.pol || 'avg', target: Math.max(0, Math.min(1, p.tStart)), weight: 1.0,
                    source: { id: 'AM1.5G' }, detector: { id: 'flat' },
                }));
            }
            return ops;
        },
    },

    // Solar pass: AM1.5G-weighted transmission must hit a high target.
    SOLAR_PASS: {
        category: 'INTEGRAL',
        fields: [
            { key: 'lamStart', default: 300, positive: true },
            { key: 'lamEnd',   default: 2500, positive: true },
            { key: 'tStart',   default: 1.0,  min: 0, max: 1, step: 0.01 },
        ],
        generate: (p, common) => {
            const ops = [];
            for (const aoi of aoiArray(common)) {
                ops.push(makeOperand({
                    type: 'TIW', lambdaStart: p.lamStart, lambdaEnd: p.lamEnd, aoi,
                    pol: common.pol || 'avg', target: Math.max(0, Math.min(1, p.tStart)), weight: 1.0,
                    source: { id: 'AM1.5G' }, detector: { id: 'flat' },
                }));
            }
            return ops;
        },
    },

    // Worst-case T ≥ target: TMN operand reports the lowest T over the band;
    // any point in the band drifting below `target` triggers a violation.
    WORST_T_MIN: worstCaseType('TMN', 0.99),

    // Worst-case R ≤ target: RMX operand reports the highest R over the band.
    WORST_R_MAX: worstCaseType('RMX', 0.01),

    // ── Gradient ─────────────────────────────────────────────────────────────
    // Linear T target from tStart (at λStart) to tEnd (at λEnd), with the
    // complementary R ramp. Emitted as a continuous range-target operand
    // (TGT/RGT) — no TAV/RAV "0→100" — or discrete point operands.
    LINEAR_RAMP: {
        category: 'GRAD',
        supportsTargetMode: true,
        fields: [
            { key: 'lamStart', default: 400, positive: true },
            { key: 'lamEnd',   default: 700, positive: true },
            { key: 'tStart',   default: 0.0, min: 0, max: 1, step: 0.01 },
            { key: 'tEnd',     default: 1.0, min: 0, max: 1, step: 0.01 },
        ],
        generate: (p, common) => {
            const pol  = common.pol || 'avg';
            const mode = common.targetMode || 'continuous';
            const step = common.stepNm || 1;
            const cl   = x => Math.max(0, Math.min(1, x));
            const t0   = cl(p.tStart), t1 = cl(p.tEnd);
            const ops  = [];
            for (const aoi of aoiArray(common)) {
                ops.push(...spectralTargetOps({ channel: 'T', pol, lamStart: p.lamStart, lamEnd: p.lamEnd, t0,           t1,           mode, stepNm: step, aoi }));
                ops.push(...spectralTargetOps({ channel: 'R', pol, lamStart: p.lamStart, lamEnd: p.lamEnd, t0: cl(1-t0), t1: cl(1-t1), mode, stepNm: step, aoi }));
            }
            return ops;
        },
    },

    // ── Custom target ────────────────────────────────────────────────────────
    // A single user-specified spectral target on one channel over a band:
    //   • cmp '=' → equal to `valuePct` across [λStart, λEnd] (continuous
    //     range-target, or discrete point operands when targetMode='discrete').
    //   • cmp '≤' → worst-case max (TMX/RMX/AMX): every point in the band ≤ value.
    //   • cmp '≥' → worst-case min (TMN/RMN/AMN): every point in the band ≥ value.
    // In dB or optical density the statement writes the matching row of
    // CUSTOM_LOG_TYPES instead, and `valuePct` holds the value in that unit.
    // Unlike the canned filter types this is intentionally NOT paired with a
    // complementary channel — the user is specifying one exact target (e.g.
    // "Tp = 80 % at 45° over 500–600 nm"). Channel/comparison ride on `params`
    // (select fields); pol/AOI/targetMode come from the shared `common` block.
    CUSTOM_TARGET: {
        category: 'CUSTOM',
        supportsTargetMode: true,
        fields: [
            { key: 'channel', kind: 'select', default: 'T',
              options: [{ value: 'T', label: 'T' }, { value: 'R', label: 'R' }, { value: 'A', label: 'A' }] },
            { key: 'unit', kind: 'select', default: 'pct',
              options: [{ value: 'pct', label: '%' }, { value: 'dB', label: 'dB' }, { value: 'OD', label: 'OD' }],
              available: p => customTargetUnits(customTargetStatement(p).channel) },
            { key: 'cmp', kind: 'select', default: 'eq',
              options: [{ value: 'eq', label: '=' }, { value: 'le', label: '≤' }, { value: 'ge', label: '≥' }],
              available: (p) => {
                  const { channel, unit } = customTargetStatement(p);
                  return customTargetComparisons(channel, unit);
              } },
            { key: 'valuePct', default: 80, min: 0, max: 100, step: 1,
              boundsFor: p => CUSTOM_VALUE_BOUNDS[customTargetStatement(p).unit] },
            { key: 'lamStart', default: 400, positive: true },
            { key: 'lamEnd',   default: 700, positive: true },
        ],
        generate: (p, common) => {
            const statement = customTargetStatement(p);
            if (statement.logType) return customLogTargetOps(statement, p, common);
            const { channel, cmp } = statement;
            const pol     = common.pol || 'avg';
            const mode    = common.targetMode || 'continuous';
            const step    = common.stepNm || 1;
            const val     = Math.max(0, Math.min(1, (p.valuePct ?? 0) / 100));
            const ops     = [];
            for (const aoi of aoiArray(common)) {
                if (cmp === 'le' || cmp === 'ge') {
                    // Worst-case ceiling (≤ → *MX) or floor (≥ → *MN) over the band.
                    ops.push(makeOperand({
                        type: channel + (cmp === 'le' ? 'MX' : 'MN'),
                        lambdaStart: p.lamStart, lambdaEnd: p.lamEnd, aoi, pol,
                        target: val, weight: 1.0,
                    }));
                } else {
                    ops.push(...spectralTargetOps({
                        channel, pol, lamStart: p.lamStart, lamEnd: p.lamEnd,
                        t0: val, mode, stepNm: step, aoi,
                    }));
                }
            }
            return ops;
        },
    },
};

// Custom Target statements in dB or optical density, and the row each writes.
// A combination not here has no row behind it and is not offered: R in dB is
// written for return loss, a ceiling, and a density is a floor on T.
const CUSTOM_LOG_TYPES = {
    'T|dB|eq': 'TDB', 'T|dB|ge': 'TDBMN', 'T|dB|le': 'TDBMX',
    'R|dB|le': 'RDBMX', 'T|OD|ge': 'ODMN',
};
const CUSTOM_COMPARISONS = ['eq', 'le', 'ge'];
// What a value can be in each unit: a percentage of 0-100, a T or R in dB no
// higher than 0 dB, a density no lower than 0.
const CUSTOM_VALUE_BOUNDS = {
    pct: { min: 0, max: 100, step: 1 },
    dB:  { max: 0, step: 0.1 },
    OD:  { min: 0, step: 0.1 },
};

/** The units a Custom Target on `channel` can be written in. */
export function customTargetUnits(channel) {
    const units = ['pct'];
    for (const key of Object.keys(CUSTOM_LOG_TYPES)) {
        const [rowChannel, unit] = key.split('|');
        if (rowChannel === channel && !units.includes(unit)) units.push(unit);
    }
    return units;
}

/** The comparisons a Custom Target on `channel` in `unit` can make. */
export function customTargetComparisons(channel, unit) {
    if (unit === 'pct') return CUSTOM_COMPARISONS;
    return CUSTOM_COMPARISONS.filter(cmp => CUSTOM_LOG_TYPES[`${channel}|${unit}|${cmp}`]);
}

/**
 * The statement a Custom Target's fields make, with a unit or comparison its
 * channel cannot take replaced by the first one it can, and the dB or density
 * row it writes (null for a percentage).
 */
export function customTargetStatement(p) {
    const channel = (p.channel === 'R' || p.channel === 'A') ? p.channel : 'T';
    const unit = customTargetUnits(channel).includes(p.unit) ? p.unit : 'pct';
    const comparisons = customTargetComparisons(channel, unit);
    const cmp = comparisons.includes(p.cmp) ? p.cmp : comparisons[0];
    return { channel, unit, cmp, logType: CUSTOM_LOG_TYPES[`${channel}|${unit}|${cmp}`] ?? null };
}

/** Whether a Custom Target writes one row per wavelength step whatever the target mode: T = a level in dB. */
export function customTargetWritesPoints(p) {
    const { logType } = customTargetStatement(p);
    return !!logType && isLogPoint(logType);
}

/** A Custom Target value moved from one unit to another at the same level of T or R. */
export function convertCustomTargetValue(value, fromUnit, toUnit) {
    if (fromUnit === toUnit || !Number.isFinite(value)) return value;
    const fraction = fromUnit === 'pct' ? value / 100 : fractionFromLog(fromUnit, value);
    if (toUnit === 'pct') return Number((Math.min(1, Math.max(0, fraction)) * 100).toFixed(2));
    return Number(logValue(toUnit, Math.min(1, fraction)).toFixed(toUnit === 'OD' ? 3 : 2));
}

// The rows of a dB or density statement: one band row, or TDB points on the
// wizard's wavelength step. The value is held to its unit's bounds.
function customLogTargetOps({ logType, unit }, p, common) {
    const pol = common.pol || 'avg';
    const bounds = CUSTOM_VALUE_BOUNDS[unit];
    const target = Math.min(bounds.max ?? Infinity, Math.max(bounds.min ?? -Infinity, Number(p.valuePct) || 0));
    const lambdas = isLogPoint(logType)
        ? stepGrid(p.lamStart, p.lamEnd, common.stepNm || 1)
        : [null];
    const ops = [];
    for (const aoi of aoiArray(common)) {
        for (const lambda of lambdas) {
            ops.push(makeOperand({
                type: logType,
                lambdaStart: lambda ?? p.lamStart, lambdaEnd: lambda ?? p.lamEnd,
                aoi, pol, target, weight: 1.0,
            }));
        }
    }
    return ops;
}

// Default field values for a filter type (used to seed the wizard form).
export function defaultFilterParams(typeId) {
    const def = FILTER_TYPES[typeId];
    if (!def) return {};
    const out = {};
    for (const f of def.fields) out[f.key] = f.default;
    return out;
}

// Run the generator for a filter type and return the operand list.
//   common = { aoi, aoiEnd, aoiSteps, pol }
export function generateFilterOperands(typeId, params, common = {}) {
    const def = FILTER_TYPES[typeId];
    if (!def) return [];
    return def.generate(params, common);
}
