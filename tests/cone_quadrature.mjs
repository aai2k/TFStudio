/**
 * Cone quadrature accuracy.
 *
 *  1. The one-dimensional rule in u = 1 − cos θ reproduces the double integral
 *     over the cone (brute force in the cone's own polar and azimuth angles)
 *     for uniform, Lambertian and tabulated intensity, for a cone about the
 *     normal, a tilted cone clear of the normal, one that contains it, and one
 *     that reaches past grazing.
 *  2. No node sits at or above 90°, and the weights sum to 1.
 *  3. The node count rule: doubling from the grid points until the average
 *     moves by no more than the tolerance, keeping the finer count, never past
 *     200; the Clenshaw-Curtis rule it doubles is exact to its degree and
 *     nested.
 *  4. The single-cavity 1550 nm filter under the default cone (7.5°, normal
 *     axis) and under a 10° cone lands within 1e-4 of an independent 200-node
 *     answer, in the merit function and in the spectrum windows' average.
 *
 * The cone-averaged Jacobian and needle function are checked in
 * cone_derivatives.mjs.
 *
 * Run: node tests/cone_quadrature.mjs
 */

import {
    makeConeSpec, coneNodes, coneAverageResult, resolveConeNodes, clenshawCurtis,
    CONE_AVERAGE_TOLERANCE, buildEvalContext, evaluateOperands, operandSampleDeviations,
    makeOperand,
} from '../src/utils/physics/optimizer.js';
import { tmm, evaluateSpectrum } from '../src/utils/physics/thinFilmMath.js';
import { initWasmForTest } from './_wasmInit.mjs';
import { MATS, resolveMat, filterLayers, filterDesign, glOn, maxAbsDiff } from './_coneFilter.mjs';

await initWasmForTest();

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const DEG = Math.PI / 180, RAD = 180 / Math.PI;

// ── 1. reduction to one integral against brute force over the cone ──────────
// Brute force: ∫∫ f(θ) I(α) sin α dα dφ over the rays that reach the surface,
// divided by the same integral of 1. α is cut where clipping at 90° starts and
// at every table angle, and φ runs over the visible arc only, so each piece is
// smooth and Gauss-Legendre converges.

// α cut points: the axis, the cone edge, the start of clipping, table rows.
function bruteCuts(g, T, cutsDeg) {
    const cuts = [0, T];
    const clip = Math.PI / 2 - g;
    if (g > 0 && clip > 0 && clip < T) cuts.push(clip);
    for (const c of cutsDeg) if (c * DEG > 0 && c * DEG < T) cuts.push(c * DEG);
    return cuts.sort((a, b) => a - b);
}

// First azimuth of the ring at offset α that meets the surface (φ runs from it
// to π), or null when none of the ring does: cos θ = cc − ss cos φ > 0.
function visiblePhiStart(g, a) {
    const ss = Math.sin(g) * Math.sin(a), cc = Math.cos(g) * Math.cos(a);
    if (!(ss > 0)) return cc > 0 ? 0 : null;
    const r = cc / ss;
    if (r <= -1) return null;
    return r < 1 ? Math.acos(r) : 0;
}

// Σ w f(θ) and Σ w over the visible part of the ring at offset α.
function ringSums(f, g, a, M) {
    const phi0 = visiblePhiStart(g, a);
    if (phi0 === null) return { num: 0, den: 0 };
    const ss = Math.sin(g) * Math.sin(a), cc = Math.cos(g) * Math.cos(a);
    const P = glOn(phi0, Math.PI, M);
    let num = 0, den = 0;
    for (let j = 0; j < M; j++) {
        num += P.w[j] * f(Math.acos(Math.max(-1, Math.min(1, cc - ss * Math.cos(P.x[j])))));
        den += P.w[j];
    }
    return { num, den };
}

// `cone` = { axisDeg, halfDeg, I, cutsDeg }.
function bruteCone(f, cone, M = 240) {
    const g = cone.axisDeg * DEG, T = cone.halfDeg * DEG;
    const cuts = bruteCuts(g, T, cone.cutsDeg);
    let num = 0, den = 0;
    for (let k = 1; k < cuts.length; k++) {
        const A = glOn(cuts[k - 1], cuts[k], M);
        for (let i = 0; i < M; i++) {
            const ring = ringSums(f, g, A.x[i], M);
            const w = A.w[i] * cone.I(A.x[i]) * Math.sin(A.x[i]);
            num += w * ring.num;
            den += w * ring.den;
        }
    }
    return num / den;
}

const TABLE = [{ theta: 0, intensity: 100 }, { theta: 6, intensity: 80 }, { theta: 14, intensity: 20 }, { theta: 25, intensity: 5 }];
function tableIntensity(a) {
    const t = a * RAD;
    const k = TABLE.findIndex(row => t <= row.theta);
    if (k === 0) return TABLE[0].intensity;
    if (k < 0) return TABLE[TABLE.length - 1].intensity;
    const f = (t - TABLE[k - 1].theta) / (TABLE[k].theta - TABLE[k - 1].theta);
    return TABLE[k - 1].intensity + f * (TABLE[k].intensity - TABLE[k - 1].intensity);
}

{
    const functions = [
        ['Rs', theta => tmm(550, theta * RAD, 's', [1, 0], [1.5, 0], []).R],
        ['cos', theta => Math.cos(theta)],
    ];
    // Uniform and Lambertian weights are smooth on every θ range, so 40 points
    // meet the brute force to its own accuracy (about 1e-9 where the cone is
    // clipped). A table's rows put kinks inside the ranges, which converge
    // algebraically; 160 points hold those to 2e-6.
    const dists = [
        { name: 'uniform', I: () => 1, userTable: null, cutsDeg: [], gridPoints: 40, tol: 2e-9 },
        { name: 'lambertian', I: a => Math.cos(a), userTable: null, cutsDeg: [], gridPoints: 40, tol: 2e-9 },
        { name: 'user', I: tableIntensity, userTable: TABLE, cutsDeg: TABLE.map(r => r.theta), gridPoints: 160, tol: 2e-6 },
    ];
    for (const dist of dists) {
        for (const [axisDeg, halfDeg] of [[0, 20], [30, 12], [8, 20], [75, 25]]) {
            const spec = makeConeSpec({ enabled: true, halfAngleDeg: halfDeg, distribution: dist.name, gridPoints: dist.gridPoints, userTable: dist.userTable });
            const nodes = coneNodes(spec, axisDeg);
            for (const [fname, f] of functions) {
                const quad = nodes.reduce((s, nd) => s + nd.weight * f(nd.aoiDeg * DEG), 0);
                const ref = bruteCone(f, { axisDeg, halfDeg, I: dist.I, cutsDeg: dist.cutsDeg });
                ok(Math.abs(quad - ref) <= dist.tol,
                    `${dist.name} axis ${axisDeg} half ${halfDeg} ${fname}: rule ${quad} vs brute force ${ref} (|Δ| ${Math.abs(quad - ref).toExponential(2)})`);
            }
        }
    }
}

// ── 2. nothing at or past grazing, weights normalized ───────────────────────
for (const [axis, half] of [[75, 25], [80, 15], [60, 30], [0, 89]]) {
    const nodes = coneNodes(makeConeSpec({ enabled: true, halfAngleDeg: half, gridPoints: 15 }), axis);
    const wsum = nodes.reduce((s, nd) => s + nd.weight, 0);
    ok(Math.abs(wsum - 1) < 1e-12, `axis ${axis} half ${half}: Σw = ${wsum}`);
    ok(nodes.every(nd => nd.aoiDeg < 90 && nd.weight > 0), `axis ${axis} half ${half}: a node at or above 90°`);
}

// ── 3. node count rule ──────────────────────────────────────────────────────
{
    const spec = makeConeSpec({ enabled: true, halfAngleDeg: 10, gridPoints: 15 });
    // An average that settles only at 60 nodes: the pair (60, 120) is the first
    // to agree, and the finer count of it is kept.
    const settled = resolveConeNodes(spec, 0, nodes => nodes.length, (a, b) => (Math.min(a, b) >= 60 ? 0 : 1));
    ok(settled.count === 120 && settled.nodes.length === coneNodes(spec, 0, 120).length,
        `doubling keeps the finer count of the first agreeing pair (got ${settled.count})`);
    // The grid points are where the comparison starts: an average that never
    // changes is taken at twice them.
    const floor = resolveConeNodes(makeConeSpec({ enabled: true, halfAngleDeg: 10, gridPoints: 40 }), 0, () => 0, () => 0);
    ok(floor.count === 80, `grid points start the comparison (got ${floor.count})`);
    // Doubling stops before it would pass 200.
    const capped = resolveConeNodes(spec, 0, nodes => nodes.length, () => 1);
    ok(capped.count === 120, `15 doubles to 120 and no further (got ${capped.count})`);
    const high = resolveConeNodes(makeConeSpec({ enabled: true, halfAngleDeg: 10, gridPoints: 150 }), 0, nodes => nodes.length, () => 1);
    ok(high.count === 150, `150 grid points are not doubled (got ${high.count})`);
    ok(CONE_AVERAGE_TOLERANCE === 1e-4, 'tolerance is 0.01 % in R/T/A');
}

// Clenshaw-Curtis: exact to degree n, and the points for n are among those for
// 2n bit for bit, so a doubled count re-evaluates nothing.
for (const n of [15, 16, 30]) {
    const { x, w } = clenshawCurtis(n);
    let worst = 0;
    for (let d = 0; d <= n; d++) {
        const q = x.reduce((s, xi, i) => s + w[i] * xi ** d, 0);
        worst = Math.max(worst, Math.abs(q - (d % 2 ? 0 : 2 / (d + 1))));
    }
    ok(worst < 1e-14, `Clenshaw-Curtis n=${n} exact to degree n (${worst.toExponential(1)})`);
    const finer = new Set(clenshawCurtis(2 * n).x);
    ok(x.every(xi => finer.has(xi)), `Clenshaw-Curtis n=${n} points are among those for ${2 * n}`);
}
{
    const tilted = makeConeSpec({ enabled: true, halfAngleDeg: 20, gridPoints: 15 });
    const fine = new Set(coneNodes(tilted, 30, 30).map(nd => nd.aoiDeg));
    ok(coneNodes(tilted, 30, 15).every(nd => fine.has(nd.aoiDeg)), 'a tilted cone\'s rays for 15 are among its rays for 30');
}

// ── 4. convergence to 1e-4 at the chosen count ──────────────────────────────
// Independent reference: Gauss-Legendre in the polar angle α with the sin α
// solid-angle factor, 200 nodes, uniform cone about the normal.
function reference200(values, halfDeg) {
    const { x, w } = glOn(0, halfDeg * DEG, 200);
    let acc = null, wsum = 0;
    for (let i = 0; i < 200; i++) {
        const wi = w[i] * Math.sin(x[i]);
        const v = values(x[i] * RAD);
        if (!acc) acc = v.map(() => 0);
        for (let k = 0; k < v.length; k++) acc[k] += wi * v[k];
        wsum += wi;
    }
    return acc.map(v => v / wsum);
}
{
    const layers = filterLayers().map(l => ({ material: MATS[l.material], thickness: l.thickness }));
    const params = { lambdaStart: 1540, lambdaEnd: 1555, lambdaStep: 0.05, polarization: 'avg' };
    const spectrumT = theta => evaluateSpectrum({ ...params, theta }, MATS.Air, MATS.Sub, layers).T;
    for (const half of [7.5, 10]) {
        const ref = reference200(spectrumT, half);
        const cone = { enabled: true, halfAngleDeg: half, distribution: 'uniform', gridPoints: 15 };
        const display = coneAverageResult(makeConeSpec(cone), 0, theta => ({ T: spectrumT(theta) }), ['T']).T;
        const dDisplay = maxAbsDiff(display, ref);
        ok(dDisplay <= 1e-4, `${half}° cone, spectrum average: max |T − T200| = ${dDisplay.toExponential(2)}`);

        // A zero-target range target over the same grid: its per-sample
        // deviations are the cone-averaged T the merit function scores.
        const op = { ...makeOperand({ type: 'TGT', lambdaStart: 1540, lambdaEnd: 1555, aoi: 0, pol: 'avg', target: 0, weight: 1 }), id: 'band', rampPoints: ref.length };
        const ctx = buildEvalContext(filterDesign(cone), resolveMat);
        const merit = operandSampleDeviations(evaluateOperands([op], ctx))[0];
        const counts = [...ctx._coneNodeCache.get(0).countByLambda.values()];
        const most = Math.max(...counts), least = Math.min(...counts);
        const dMerit = maxAbsDiff(merit, ref);
        ok(most > 15, `${half}° cone: the merit function raised the node count above the 15 grid points near the passband (${most})`);
        ok(dMerit <= 1e-4, `${half}° cone, merit-function average: max |T − T200| = ${dMerit.toExponential(2)} with ${least} to ${most} nodes`);
    }
}

if (fails === 0) console.log('cone_quadrature: ALL PASS');
else { console.error(`cone_quadrature: ${fails} FAIL(S)`); process.exit(1); }
