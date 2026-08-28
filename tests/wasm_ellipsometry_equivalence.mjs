/**
 * WASM phase kernel ⇄ JS oracle equivalence for ellipsometry sweeps.
 *
 * evaluateEllipsometrySpectrum and evaluateEllipsometryAngles read Ψ and Δ off
 * the phase kernel, which reports |r|² and φ = −arg(r) and carries refractive
 * indices as Taylor jets. The oracle is computeEllipsometry, which forms the
 * same two amplitudes from the JavaScript transfer matrices. This asserts the
 * two agree across dielectric, absorbing and bare-substrate stacks at normal,
 * oblique and near-grazing incidence, and that the kernel path is the one being
 * taken rather than the fallback.
 *
 * Uses the prebuilt kernel shipped by tmmcore.
 * Run: node tests/wasm_ellipsometry_equivalence.mjs
 */
import { readFileSync } from 'node:fs';
import {
    computeEllipsometry, evaluateEllipsometryAngles, evaluateEllipsometrySpectrum,
} from '../src/utils/physics/thinFilmMath.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { initTmmWasmMainThread, getTmmWasm, setTmmWasmEnabled, tmmWasmActive } from 'tmmcore';
import { TMMCORE_WASM_PATH } from './_wasmInit.mjs';

await initTmmWasmMainThread(readFileSync(TMMCORE_WASM_PATH), true);
let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

ok(tmmWasmActive(), 'WASM active');
ok(getTmmWasm().hasPhase(), 'module carries the tmm_phase_spectrum export');
if (!getTmmWasm().hasPhase()) {
    console.error('\n✗ tmmcore kernel lacks the phase exports');
    process.exit(1);
}

// Δ is periodic, so a difference across the 360° seam is small, not enormous.
const angleDiff = (a, b) => {
    const d = Math.abs(a - b) % 360;
    return Math.min(d, 360 - d);
};

const CASES = [
    { name: 'AR 4L dielectric', spec: [['TiO2', 95], ['SiO2', 150], ['TiO2', 70], ['SiO2', 130]] },
    { name: 'QW stack 9L', spec: Array.from({ length: 9 }, (_, i) => (i % 2 ? ['SiO2', 94.2] : ['TiO2', 59.5])) },
    { name: 'absorbing Cr/SiO2', spec: [['SiO2', 120], ['Cr', 20], ['SiO2', 90]] },
    { name: 'bare substrate', spec: [] },
];
const AOIS = [0, 45, 65, 85];
const SUBSTRATE = getMaterial('BK7');
const N0 = [1, 0];

const lambdas = [];
for (let lam = 400; lam <= 800 + 1e-9; lam += 12.5) lambdas.push(lam);

let worstPsi = 0, worstDelta = 0, nChecked = 0;

// ── Wavelength sweeps ────────────────────────────────────────────────────────
for (const testCase of CASES) {
    const materials = testCase.spec.map(([id]) => getMaterial(id));
    const thick = testCase.spec.map(([, d]) => d);
    const n0List = lambdas.map(() => N0);
    const nsList = lambdas.map(lam => SUBSTRATE.getNK(lam));
    const layerNK = materials.map(material => lambdas.map(lam => material.getNK(lam)));

    for (const aoi of AOIS) {
        setTmmWasmEnabled(false);
        const oracle = evaluateEllipsometrySpectrum(lambdas, aoi, n0List, nsList, layerNK, thick);
        setTmmWasmEnabled(true);
        const kernel = evaluateEllipsometrySpectrum(lambdas, aoi, n0List, nsList, layerNK, thick);

        const tag = `${testCase.name} λ-sweep aoi${aoi}`;
        ok(kernel.psi.length === lambdas.length, `${tag}: sample count`);
        for (let i = 0; i < lambdas.length; i++) {
            const dPsi = Math.abs(oracle.psi[i] - kernel.psi[i]);
            const dDelta = angleDiff(oracle.delta[i], kernel.delta[i]);
            if (!(dPsi < 1e-8)) ok(false, `${tag} λ${lambdas[i]}: Ψ ${oracle.psi[i]} vs ${kernel.psi[i]}`);
            if (!(dDelta < 1e-7)) ok(false, `${tag} λ${lambdas[i]}: Δ ${oracle.delta[i]} vs ${kernel.delta[i]}`);
            worstPsi = Math.max(worstPsi, dPsi);
            worstDelta = Math.max(worstDelta, dDelta);
            nChecked++;
        }

        // The oracle is the point evaluator itself, so a fallback that silently
        // dropped the layers would still agree with it. Anchor one sample.
        const layers = materials.map((material, k) => ({ n: material.getNK(lambdas[0]), d: thick[k] }));
        const point = computeEllipsometry(lambdas[0], aoi, N0, SUBSTRATE.getNK(lambdas[0]), layers);
        ok(Math.abs(point.psi - kernel.psi[0]) < 1e-8, `${tag}: first sample matches the point evaluator`);
    }
}

// ── Angle sweeps ─────────────────────────────────────────────────────────────
const thetas = [];
for (let angle = 0; angle <= 89.5 + 1e-9; angle += 3.5) thetas.push(angle);

for (const testCase of CASES) {
    for (const lam of [450, 632.8]) {
        const layers = testCase.spec.map(([id, d]) => ({ n: getMaterial(id).getNK(lam), d }));
        const ns = SUBSTRATE.getNK(lam);

        setTmmWasmEnabled(false);
        const oracle = evaluateEllipsometryAngles(lam, thetas, N0, ns, layers);
        setTmmWasmEnabled(true);
        const kernel = evaluateEllipsometryAngles(lam, thetas, N0, ns, layers);

        const tag = `${testCase.name} θ-sweep λ${lam}`;
        for (let i = 0; i < thetas.length; i++) {
            const dPsi = Math.abs(oracle.psi[i] - kernel.psi[i]);
            const dDelta = angleDiff(oracle.delta[i], kernel.delta[i]);
            if (!(dPsi < 1e-8)) ok(false, `${tag} θ${thetas[i]}: Ψ ${oracle.psi[i]} vs ${kernel.psi[i]}`);
            if (!(dDelta < 1e-7)) ok(false, `${tag} θ${thetas[i]}: Δ ${oracle.delta[i]} vs ${kernel.delta[i]}`);
            worstPsi = Math.max(worstPsi, dPsi);
            worstDelta = Math.max(worstDelta, dDelta);
            nChecked++;
        }
    }
}

// ── Known values ─────────────────────────────────────────────────────────────
// At normal incidence Macleod's η_p equals η_s, so r_p = r_s: Ψ = 45° and the
// +180° p-admittance correction is the whole of Δ.
setTmmWasmEnabled(true);
const normal = evaluateEllipsometryAngles(550, [0], N0, SUBSTRATE.getNK(550), []);
ok(Math.abs(normal.psi[0] - 45) < 1e-9, `normal incidence Ψ = ${normal.psi[0]}, expected 45`);
ok(angleDiff(normal.delta[0], 180) < 1e-9, `normal incidence Δ = ${normal.delta[0]}, expected 180`);

// A bare dielectric flips Δ through Brewster and Ψ → 0 there.
const brewster = Math.atan(SUBSTRATE.getNK(550)[0]) * 180 / Math.PI;
const across = evaluateEllipsometryAngles(550, [brewster - 15, brewster, brewster + 15],
    N0, SUBSTRATE.getNK(550), []);
ok(angleDiff(across.delta[0], 180) < 1e-6, `below Brewster Δ = ${across.delta[0]}, expected 180`);
ok(across.psi[1] < 1e-6, `Ψ at Brewster = ${across.psi[1]}, expected 0`);
ok(angleDiff(across.delta[2], 0) < 1e-6, `above Brewster Δ = ${across.delta[2]}, expected 0`);

console.log(`Checked ${nChecked} sweep samples across ${CASES.length} stacks.`);
console.log(`worst |ΔΨ| = ${worstPsi.toExponential(3)}°, worst |ΔΔ| = ${worstDelta.toExponential(3)}°`);
if (fails === 0) console.log('\n✓ WASM ELLIPSOMETRY ⇄ JS EQUIVALENCE PASSED');
else { console.error(`\n✗ ${fails} mismatch(es)`); process.exit(1); }
