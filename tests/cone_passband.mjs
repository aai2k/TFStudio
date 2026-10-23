/**
 * A narrow passband under a wide cone, and smooth spectra under the same cone.
 *
 * (HL)^7 LL (LH)^7, quarter-waves at 560 nm of n = 2.35 / 1.46 on n = 1.52,
 * under a 20° cone about the normal, uniform, Lambertian and tabulated. The
 * passband wavelengths are where a rule that stopped at one agreement and
 * never passed 200 nodes left a single-wavelength T row furthest off: a chance
 * agreement at 30 nodes at 554.5 nm (1.3 %) and the 120-node ceiling elsewhere
 * (0.08 %). Each must land within 1e-4 of a 400-point Gauss-Legendre answer,
 * in a merit row and in the spectrum windows' average, with at most
 * MAX_CONE_NODES nodes. A 4-layer AR and a long-pass edge must keep the value
 * of 30 nodes, within rounding, with no more nodes.
 *
 * Run: node tests/cone_passband.mjs
 */

import {
    makeConeSpec, coneNodes, coneAverageResult, MAX_CONE_NODES, buildEvalContext,
    evaluateOperands, makeOperand,
} from '../src/utils/physics/optimizer.js';
import { initWasmForTest } from './_wasmInit.mjs';
import { resolveMat, filterDesign, glOn, maxAbsDiff } from './_coneFilter.mjs';

await initWasmForTest();

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const DEG = Math.PI / 180, RAD = 180 / Math.PI;
const HALF_DEG = 20;

const TABLE = [{ theta: 0, intensity: 100 }, { theta: 6, intensity: 80 }, { theta: 14, intensity: 20 }, { theta: 25, intensity: 5 }];
function tableIntensity(a) {
    const t = a * RAD;
    const k = TABLE.findIndex(row => t <= row.theta);
    if (k === 0) return TABLE[0].intensity;
    if (k < 0) return TABLE[TABLE.length - 1].intensity;
    const f = (t - TABLE[k - 1].theta) / (TABLE[k].theta - TABLE[k - 1].theta);
    return TABLE[k - 1].intensity + f * (TABLE[k].intensity - TABLE[k - 1].intensity);
}

const qw = n => 560 / (4 * n);
const mirror = Array.from({ length: 7 }, () => [['H', qw(2.35)], ['L', qw(1.46)]]).flat();
const passband = [...mirror, ['L', qw(1.46)], ['L', qw(1.46)], ...[...mirror].reverse()];
const ar = [['L', 94], ['H', 116], ['L', 31], ['H', 13]];
const edge = [];
for (let i = 0; i < 12; i++) edge.push(['L', 480 / 8 / 1.46], ['H', 480 / 4 / 2.35], ['L', 480 / 8 / 1.46]);

const designOf = (stack, cone) => ({
    ...filterDesign(cone),
    frontLayers: stack.map(([material, thickness], i) => ({ id: `p${i}`, material, thickness, locked: false })),
});
const rows = (lams, aoi = 0) => lams.map((l, i) => ({
    ...makeOperand({ type: 'T', lambdaStart: l, lambdaEnd: l, aoi, pol: 'avg', target: 0, weight: 1 }), id: `s${i}`,
}));
const countOf = (ctx, i, lam) => ctx._coneNodeCache.get(`s${i}`).get(0).countByLambda.get(lam);
// T at the wavelengths `lams` (nm) at one angle of incidence (degrees), no cone.
const tAt = (stack, lams, thetaDeg) => evaluateOperands(rows(lams, thetaDeg), buildEvalContext(designOf(stack, null), resolveMat));

// Reference: 400-point Gauss-Legendre in u = 1 − cos θ on each piece between
// the table's rows, weighted by the intensity at θ (a cone about the normal).
function reference(stack, lams, I, cutsDeg) {
    const uOf = deg => 2 * Math.sin(deg * DEG / 2) ** 2;
    const cuts = [0, ...cutsDeg.filter(c => c > 0 && c < HALF_DEG), HALF_DEG].map(uOf);
    const acc = lams.map(() => 0);
    let wsum = 0;
    for (let p = 1; p < cuts.length; p++) {
        const { x, w } = glOn(cuts[p - 1], cuts[p], 400);
        x.forEach((u, i) => {
            const theta = 2 * Math.asin(Math.sqrt(u / 2));
            const wi = w[i] * I(theta);
            tAt(stack, lams, theta * RAD).forEach((t, k) => { acc[k] += wi * t; });
            wsum += wi;
        });
    }
    return acc.map(v => v / wsum);
}

const dists = [
    { distribution: 'uniform', I: () => 1, cutsDeg: [], lams: [554.5, 553.9, 554] },
    { distribution: 'lambertian', I: Math.cos, cutsDeg: [], lams: [554.5, 553.9, 554] },
    { distribution: 'user', userTable: TABLE, I: tableIntensity, cutsDeg: TABLE.map(r => r.theta), lams: [555.8, 556.2, 555.4] },
];
for (const d of dists) {
    const cone = { enabled: true, halfAngleDeg: HALF_DEG, distribution: d.distribution, gridPoints: 15, userTable: d.userTable };
    const ref = reference(passband, d.lams, d.I, d.cutsDeg);
    const ctx = buildEvalContext(designOf(passband, cone), resolveMat);
    const merit = evaluateOperands(rows(d.lams), ctx);
    d.lams.forEach((l, i) => {
        const count = countOf(ctx, i, l);
        ok(Math.abs(merit[i] - ref[i]) <= 1e-4 && count <= MAX_CONE_NODES,
            `${HALF_DEG}° ${d.distribution} cone, T at ${l} nm: ${merit[i]} vs ${ref[i]} with ${count} nodes`);
    });
    const shown = coneAverageResult(makeConeSpec(cone), 0, theta => ({ T: tAt(passband, d.lams, theta) }), ['T']).T;
    ok(maxAbsDiff(shown, ref) <= 1e-4,
        `${HALF_DEG}° ${d.distribution} cone, spectrum average at the passband: max |Δ| = ${maxAbsDiff(shown, ref).toExponential(2)}`);
}

for (const [name, stack, lams] of [['4-layer AR', ar, [450, 550, 650]], ['long-pass edge', edge, [555, 560, 565, 570]]]) {
    for (const distribution of ['uniform', 'lambertian']) {
        const cone = { enabled: true, halfAngleDeg: HALF_DEG, distribution, gridPoints: 15 };
        const ctx = buildEvalContext(designOf(stack, cone), resolveMat);
        const merit = evaluateOperands(rows(lams), ctx);
        const at30 = lams.map(() => 0);
        for (const nd of coneNodes(makeConeSpec(cone), 0, 30)) {
            tAt(stack, lams, nd.aoiDeg).forEach((t, k) => { at30[k] += nd.weight * t; });
        }
        lams.forEach((l, i) => {
            const count = countOf(ctx, i, l);
            ok(Math.abs(merit[i] - at30[i]) <= 1e-12 && count <= 30,
                `${name}, ${distribution} cone, T at ${l} nm: |Δ| from 30 nodes ${Math.abs(merit[i] - at30[i]).toExponential(1)} with ${count} nodes`);
        });
    }
}

if (fails === 0) console.log('cone_passband: ALL PASS');
else { console.error(`cone_passband: ${fails} FAIL(S)`); process.exit(1); }
