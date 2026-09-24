/**
 * Transmittance and the field inside layers past tmmcore's opaque-layer bound.
 *
 * tmmcore holds the imaginary phase thickness of a layer at 50 so that cosh
 * cannot overflow, and the held matrix is the true one divided by
 * e^{|Im δ| − 50}. The evaluators TFStudio builds on layerMatrix have to carry
 * that factor as tmm() does. Without it T stops near 1e-43 per such layer,
 * and the field profile stays flat at its front-face value through the first
 * part of the layer instead of decaying: 0.16 of the incident |E|² 200 nm
 * into 1 µm of aluminium at normal incidence, where it is 8.5e-15.
 *
 * The reference builds the unclamped characteristic matrices in this file,
 * which is safe here because |Im δ| stays far below the overflow of cosh, and
 * takes the field at each depth from the matrix of the thickness still to
 * come (Macleod, Thin-Film Optical Filters 5th ed., §3, Eqs. 3.5 and 3.6).
 *
 * Held here: the field profile in s and p, tmmWithAdmittances, the monitor
 * evaluators with and without the kernel, with the growing layer on either
 * side of the bound, and |t|² from the phase evaluator with and without the
 * kernel.
 *
 * Run: node tests/opaque_layer_field.mjs
 */
import assert from 'node:assert/strict';

import { setTmmWasmEnabled, tmm } from 'tmmcore';
import { initWasmForTest } from './_wasmInit.mjs';
import { initCatalogs } from '../src/utils/materials/catalogManager.js';
import {
    computeEFieldProfile, createGrowingLayerEvaluator, createMonitorTmmEvaluator, tmmWithAdmittances,
} from '../src/utils/physics/thinFilmMath.js';
import { evaluateStackPhaseDispersion } from '../src/utils/physics/phaseDispersion/stackEvaluator.js';

initCatalogs({});
const kernel = await initWasmForTest();
setTmmWasmEnabled(false);

let checks = 0;
function close(got, want, tolerance, what) {
    const error = Math.abs(got - want) / Math.abs(want);
    assert.ok(error <= tolerance, `${what}: got ${got}, want ${want}, relative error ${error.toExponential(2)}`);
    checks++;
}

// ── The reference ────────────────────────────────────────────────────────────

const add = ([a, b], [c, d]) => [a + c, b + d];
const mul = ([a, b], [c, d]) => [a * c - b * d, a * d + b * c];
const div = ([a, b], [c, d]) => {
    const q = c * c + d * d;
    return [(a * c + b * d) / q, (b * c - a * d) / q];
};
const abs2 = ([a, b]) => a * a + b * b;
const cos = ([a, b]) => [Math.cos(a) * Math.cosh(b), -Math.sin(a) * Math.sinh(b)];
const sin = ([a, b]) => [Math.sin(a) * Math.cosh(b), Math.cos(a) * Math.sinh(b)];
const apply = (M, [e, h]) => [add(mul(M[0][0], e), mul(M[0][1], h)), add(mul(M[1][0], e), mul(M[1][1], h))];

// n cosθ = sqrt(n² − a²) with a = n0 sinθ0, on the root with Im ≥ 0; the
// smaller part of the root is formed by division so that it keeps its digits.
function normalComponent(n, a) {
    const [x, y] = add(mul(n, n), [-a * a, 0]);
    const m = Math.hypot(x, y);
    let root;
    if (x >= 0) {
        const re = Math.sqrt((m + x) / 2);
        root = [re, y / (2 * re)];
    } else {
        const im = Math.sqrt((m - x) / 2);
        root = [y / (2 * im), im];
    }
    return root[1] < 0 || (root[1] === 0 && root[0] < 0) ? [-root[0], -root[1]] : root;
}

// The whole problem with unclamped matrices, in tmmcore's conventions: n + ik,
// off-diagonals −i, η = n cosθ (s) or n / cosθ (p).
function reference({ lambda, theta, pol, n0, ns, layers }) {
    const rad = theta * Math.PI / 180;
    const a = n0[0] * Math.sin(rad);
    const cos0 = Math.cos(rad);
    const admittance = n => {
        const q = normalComponent(n, a);
        return pol === 's' ? q : div(mul(n, n), q);
    };
    const eta0 = pol === 's' ? [n0[0] * cos0, 0] : [n0[0] / cos0, 0];
    const etaS = admittance(ns);
    const k0 = 2 * Math.PI / lambda;
    const matrix = (n, d) => {
        const delta = mul(normalComponent(n, a), [k0 * d, 0]);
        const eta = admittance(n);
        return [[cos(delta), mul([0, -1], div(sin(delta), eta))],
            [mul([0, -1], mul(eta, sin(delta))), cos(delta)]];
    };
    // [E, H] at the back of every layer, from the substrate outward.
    const back = new Array(layers.length);
    let eh = [[1, 0], etaS];
    for (let k = layers.length - 1; k >= 0; k--) {
        back[k] = eh;
        eh = apply(matrix(layers[k].n, layers[k].d), eh);
    }
    const t = div(mul([2, 0], eta0), add(mul(eta0, eh[0]), eh[1]));
    const T = etaS[0] / eta0[0] * abs2(t);
    const scale = abs2(t) * (pol === 'p' ? cos0 * cos0 : 1);
    // |E_tangential|² at depth z, as a fraction of the incident field.
    const field = z => {
        let top = 0;
        for (let k = 0; k < layers.length; k++) {
            const bottom = top + layers[k].d;
            if (z <= bottom + 1e-9) return scale * abs2(apply(matrix(layers[k].n, bottom - z), back[k])[0]);
            top = bottom;
        }
        throw new Error(`depth ${z} is past the stack`);
    };
    return { T, t, field };
}

// ── Stacks ───────────────────────────────────────────────────────────────────

const AIR = [1, 0], GLASS = [1.52, 0], SIO2 = [1.46, 0], MGF2 = [1.38, 0], TIO2 = [2.35, 0.0005];
// Al at 550 nm (Rakić): Im δ is 76 over 1 µm at normal incidence, 26 past the bound.
const AL = [0.96, 6.69];

const CASES = [
    { name: 'SiO2 90 nm over Al 1000 nm', lambda: 550, angles: [0, 30, 60], n0: AIR, ns: GLASS,
        layers: [{ n: SIO2, d: 90 }, { n: AL, d: 1000 }] },
    // Evanescent past 41.1° in the glass: Im δ of the gap is 155 at 80° and 450 nm.
    { name: 'air gap 10 µm in glass', lambda: 450, angles: [80], n0: GLASS, ns: GLASS,
        layers: [{ n: TIO2, d: 80 }, { n: AIR, d: 10000 }, { n: MGF2, d: 100 }] },
];

const RUNS = CASES.flatMap(c => c.angles.flatMap(theta => ['s', 'p'].map(pol => ({
    ...c, theta, pol,
    at: `${c.name}, ${c.lambda} nm, ${theta}° ${pol}`,
    args: [c.lambda, theta, pol, c.n0, c.ns, c.layers],
}))));

const constant = (name, nk) => {
    const getNK = () => nk;
    getNK.constantNK = nk;
    return { name, getNK };
};

const KERNEL_MODES = kernel ? [false, true] : [false];
const modeName = useKernel => (useKernel ? 'kernel' : 'JavaScript');

// ── Checks ───────────────────────────────────────────────────────────────────

// The field profile, sample by sample. The tangential component is what the
// characteristic matrix carries; in s it is the whole field.
function checkField(run, exact) {
    const profile = computeEFieldProfile(...run.args, 60);
    profile.z.forEach((z, i) => close(profile.e2Tangential[i], exact.field(z), 1e-9,
        `${run.at}: tangential |E|² at ${z.toFixed(1)} nm`));
    if (run.layers[1].n !== AL) return;
    const inside = profile.z.findIndex(z => z >= 90 + 200);
    assert.ok(profile.e2[inside] < 1e-10,
        `${run.at}: |E|² 200 nm into the Al is ${profile.e2[inside]}, not below 1e-10`);
    checks++;
}

// The monitor evaluator, with the first layer growing on the rest, and |t|²
// from the phase evaluator times the admittance ratio T takes, each with and
// without the kernel.
function checkEvaluators(run, exact, Tfac) {
    const [top, ...below] = run.layers;
    for (const useKernel of KERNEL_MODES) {
        setTmmWasmEnabled(useKernel);
        const monitor = createMonitorTmmEvaluator(run.theta, constant('incident', run.n0),
            constant('substrate', run.ns), below.map((l, k) => constant(`below ${k}`, l.n)),
            below.map(l => l.d), [run.lambda], null);
        close(monitor.sample('T', run.pol, constant('top', top.n), top.d)[0], exact.T, 1e-12,
            `${run.at}: T from the monitor evaluator, ${modeName(useKernel)}`);
        monitor.free?.();
        const phase = evaluateStackPhaseDispersion({
            wavelengthNm: run.lambda, target: 'T', polarization: run.pol, thetaDeg: run.theta,
            incidentMaterial: constant('incident', run.n0), substrateMaterial: constant('substrate', run.ns),
            layers: run.layers.map((l, k) => ({ material: constant(`layer ${k}`, l.n), thicknessNm: l.d })),
        });
        assert.ok(phase.valid, `${run.at}: phase evaluator: ${phase.reason}`);
        close(Tfac * phase.magnitudeSquared, exact.T, 1e-12,
            `${run.at}: T from |t|² of the phase evaluator, ${modeName(useKernel)}`);
    }
    setTmmWasmEnabled(false);
}

for (const run of RUNS) {
    const exact = reference(run);
    close(tmm(...run.args).T, exact.T, 1e-12, `${run.at}: T from tmmcore`);
    const w = tmmWithAdmittances(...run.args);
    const Tfac = w.etaS[0] / w.eta0[0];
    close(Tfac * abs2(w.t), exact.T, 1e-12, `${run.at}: T from tmmWithAdmittances`);
    checkField(run, exact);
    checkEvaluators(run, exact, Tfac);
}

// ── A held layer growing ─────────────────────────────────────────────────────
// Al grows on SiO2 90 nm over glass at 550 nm, through the bound: 300 nm is
// short of it, 800 and 1000 nm are past it. Both monitor evaluators, the
// per-scan one and the per-curve one behind the Monitor Worksheet.

const GROWN = [300, 800, 1000];

function checkGrowing(theta, pol) {
    const incident = constant('incident', AIR);
    const substrate = constant('substrate', GLASS);
    const silica = constant('SiO2', SIO2);
    const aluminium = constant('Al', AL);
    for (const useKernel of KERNEL_MODES) {
        setTmmWasmEnabled(useKernel);
        const monitor = createMonitorTmmEvaluator(theta, incident, substrate, [silica], [90], [550], null);
        const growing = createGrowingLayerEvaluator(theta, incident, substrate, [silica], [90], 550, null);
        const curve = growing.sampleMany('T', pol, aluminium, GROWN);
        GROWN.forEach((d, i) => {
            const layers = [{ n: AL, d }, { n: SIO2, d: 90 }];
            const exact = reference({ lambda: 550, theta, pol, n0: AIR, ns: GLASS, layers }).T;
            const at = `Al ${d} nm growing on SiO2, ${theta}° ${pol}, ${modeName(useKernel)}`;
            close(monitor.sample('T', pol, aluminium, d)[0], exact, 1e-12, `${at}: monitor evaluator`);
            close(curve[i], exact, 1e-12, `${at}: growing-layer evaluator`);
        });
        monitor.free?.();
        growing.free();
    }
    setTmmWasmEnabled(false);
}

for (const theta of [0, 45]) ['s', 'p'].forEach(pol => checkGrowing(theta, pol));

console.log(`PASS: opaque_layer_field (${checks} checks${kernel ? '' : ', kernel rows skipped'})`);
