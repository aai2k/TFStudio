// Target points of the deep synthesis (the lab's Point, lab.h 34-40, and
// point_kind, cavity.c 83-87): every sample wavelength of the run's T and R
// targets, marked a pass point (T = 1 or R = 0), a stop point (T = 0 or R = 1)
// or neither. The comb fits its cavities to them and the half-wave moves drop
// or add a half wave at the pass points, so both read their n cos(theta) here.
//
// A lab point's weight is its weight in the merit, 1 unless the case gives
// another (tools/make_cases.mjs), and the comb's fit weighs each point by it.
// A TFStudio row spreads its weight over its samples with the trapezoid
// weights of the band grid (bandQuadratureWeights), so a point here carries
// that share: a band's points sum to the row's weight, however many samples
// the run's grid gives it. The lab builds one point per target sample
// (make_cases.mjs buildGrid) and shares only the samples. Here, rows asking
// for the same kind of point at one wavelength and angle (a shared band edge,
// a zero-width range row that samples one wavelength many times) give one
// point with their shares added, so the half-wave moves (giga4.c 706, uniform
// over the pass points) draw that wavelength once. The comb's fit is the same
// either way.

import { bandQuadratureWeights, operandSampleLambdas } from '../../physics/optimizer/sampling.js';
import { isBlank, isDmfs, isManufacturability, isRangeTarget } from '../../physics/optimizer/operandModel.js';

// Row types whose value is T or R at each of their sample wavelengths.
export const PASS_STOP_TYPES = Object.freeze({
    T: Object.freeze(['T', 'TAV', 'TGT', 'TS', 'TP']),
    R: Object.freeze(['R', 'RAV', 'RGT', 'RS', 'RP']),
});

const DEG = Math.PI / 180;

// cavity.c point_kind 83-87: T = 1 or R = 0 is a pass point, T = 0 or R = 1 a
// stop point. Exact comparisons: a target of 0.99 is neither.
export function pointKind(q, target) {
    if (target !== 0 && target !== 1) return 'none';
    return (target === 1) === (q === 'T') ? 'pass' : 'stop';
}

function quantityOf(type) {
    if (PASS_STOP_TYPES.T.includes(type)) return 'T';
    return PASS_STOP_TYPES.R.includes(type) ? 'R' : null;
}

// Rows that count toward the optical merit: enabled, weighted, and neither
// inert nor a manufacturability row (operandModel.js 144-157).
export function countsOptically(op) {
    if (!op.enabled || !(op.weight > 0)) return false;
    return !isManufacturability(op.type) && !isBlank(op.type) && !isDmfs(op.type);
}

// A range target whose line is not flat is neither a pass nor a stop target
// at any of its samples.
function isRamp(op) {
    return isRangeTarget(op.type) && op.targetEnd != null && op.targetEnd !== op.target;
}

// The target line at sample i of n, as _evalRangeTarget draws it (fraction).
function sampleTarget(op, i, n) {
    if (!isRamp(op)) return op.target;
    return op.target + (op.targetEnd - op.target) * (n > 1 ? i / (n - 1) : 0);
}

// One Point per sample wavelength of op, weighing its share of op's weight;
// n0 is the real index of the medium light enters the active stack from.
function operandPoints(ev, op, q) {
    const lams = operandSampleLambdas(op);
    const share = bandQuadratureWeights(lams.length);
    const ramp = isRamp(op);
    return lams.map((lam, i) => {
        const target = sampleTarget(op, i, lams.length);
        const kind = ramp ? 'none' : pointKind(q, target);
        return { lam, aoi: op.aoi ?? 0, n0: ev.n(ev.incident, lam), q, target, weight: op.weight * share[i], kind };
    });
}

// Points of one kind at one wavelength and angle made one, at the place of
// the first, with the weights added. The comb's fit is the same either way.
function mergePoints(points) {
    const at = new Map();
    const out = [];
    for (const p of points) {
        const key = `${p.lam}|${p.aoi}|${p.kind}`;
        const k = at.get(key);
        if (k === undefined) {
            at.set(key, out.length);
            out.push(p);
        } else {
            out[k] = { ...out[k], weight: out[k].weight + p.weight };
        }
    }
    return out;
}

// The points of every T and R target in operand order, repeats merged.
// allPassStop: every row that counts toward the optical merit is such a
// target and all its points are pass or stop points (the case cavity.c 17-24
// asks for).
export function targetPoints(ev) {
    const points = [];
    let allPassStop = true;
    for (const op of ev.operands) {
        if (!countsOptically(op)) continue;
        const q = quantityOf(op.type);
        const own = q ? operandPoints(ev, op, q) : [];
        if (!q || own.some(p => p.kind === 'none')) allPassStop = false;
        points.push(...own);
    }
    return { points: mergePoints(points), allPassStop };
}

// giga4.c 642: the indices of the pass points.
export function passIndices(points) {
    const out = [];
    points.forEach((p, i) => { if (p.kind === 'pass') out.push(i); });
    return out;
}

// cavity.c pass_runs 101-115: the runs of pass points between stop points in
// wavelength order, a pass point before a stop point at one wavelength; 0 when
// some point or row is neither a pass nor a stop target.
export function passRuns(points, allPassStop) {
    if (!allPassStop || points.some(p => p.kind === 'none')) return 0;
    const marks = points.map(p => ({ lam: p.lam, pass: p.kind === 'pass' }))
        .sort((x, y) => (x.lam - y.lam) || (y.pass - x.pass));
    let runs = 0;
    marks.forEach((m, i) => { if (m.pass && (i === 0 || !marks[i - 1].pass)) runs++; });
    return runs;
}

// cavity.c n_cos 118-123, giga4.c 204-209: n cos(theta) in `material` at the
// point's wavelength and angle, with Snell's law from the incident medium.
export function nCos(ev, material, point) {
    const n = ev.n(material, point.lam);
    const s = point.n0 * Math.sin(point.aoi * DEG) / n;
    return n * Math.sqrt(1 - s * s);
}

// giga4.c half_wave 215-217: the thickness that makes a layer of `material` an
// absentee at the point, nm.
export function halfWave(ev, material, point) {
    return point.lam / (2 * nCos(ev, material, point));
}
