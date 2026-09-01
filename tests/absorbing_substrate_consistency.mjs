/**
 * The two reverse-pass formulations against each other on absorbing
 * substrates.
 *
 * The spectrum family (evaluateSpectrumTotalAt) evaluates the front
 * coating's reverse pass explicitly, on the reversed stack at the real-part
 * refracted angle. The evaluator family (createMonitorTmmEvaluator and the
 * growing kernels behind the Process Exporter's step spectra) takes it from
 * the anti-transposed forward matrix, with the reverse transmittance equal
 * to the forward one by reciprocity. For a transparent substrate the two are
 * identical; for a complex ñ_sub they are different approximations, and both
 * families can meet on one chart.
 *
 * Why the difference cannot show: it enters only through the back-face term,
 * which is weighted by the substrate's bulk pass P = exp(−4πk·d/(λ·cosθ)).
 * Over a millimetre of substrate, P is already ~0 at k ≈ 4e-4, so wherever
 * ñ_sub is complex enough for the formulations to part, the term they feed
 * is dead; wherever the term is alive, ñ_sub is real to one part in ten
 * thousand and they coincide. Measured, the divergence peaks near 4e-6 in
 * R/T at the translucency midpoint and vanishes at both ends: below the
 * 8 ppm band the engine is validated to against OptiLayer, and far below
 * anything an instrument or a chart resolves. This test pins that bound
 * across the translucency range, at an oblique angle where the divergence
 * is near its largest.
 *
 * Run: node tests/absorbing_substrate_consistency.mjs
 */
import { createMonitorTmmEvaluator, evaluateSpectrumTotalAt } from '../src/utils/physics/thinFilmMath.js';

const mk = (name, n, k = 0) => ({ name, getNK: () => [n, k] });
const AIR = mk('Air', 1.0);
const H = mk('H', 2.28, 0.0004);
const L = mk('L', 1.45);

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fail++; };

const lambdas = Array.from({ length: 21 }, (_, i) => 900 + i * 10);
const front = Array.from({ length: 8 }, (_, i) => ({
    material: i % 2 ? L : H, thickness: i % 2 ? 172 : 110,
}));
const THETA = 60;
const SUBTHK = 1;   // mm

// k_sub spans the whole translucency range at λ ≈ 1 µm over 1 mm:
// transparent, P ≈ 0.5 (the worst plausible regime: complex ñ AND a live
// back-face term), P ≈ 0.05, and opaque.
const CASES = [0, 5.5e-5, 2.4e-4, 5e-3];

let worstAll = 0;
for (const kSub of CASES) {
    const sub = mk('Si', 3.5, kSub);
    let worst = 0;
    for (const pol of ['s', 'p', 'avg']) {
        const spectrum = evaluateSpectrumTotalAt(lambdas, { theta: THETA, polarization: pol },
            AIR, sub, AIR, front, [], SUBTHK);
        const ev = createMonitorTmmEvaluator(THETA, AIR, sub,
            front.slice(1).map(l => l.material), front.slice(1).map(l => l.thickness),
            lambdas, SUBTHK);
        for (const char of ['R', 'T']) {
            const sampled = ev.sample(char, pol, front[0].material, front[0].thickness);
            for (let li = 0; li < lambdas.length; li++) {
                worst = Math.max(worst, Math.abs(sampled[li] - spectrum[char][li]));
            }
        }
    }
    console.log(`     k_sub = ${kSub}: worst |Δ| between families = ${worst.toExponential(2)}`);
    if (kSub === 0) ok(worst < 1e-12, 'transparent substrate: the formulations are identical');
    worstAll = Math.max(worstAll, worst);
}
ok(worstAll < 1e-5,
   'the families agree to under 1e-5 everywhere (divergence is P-suppressed)');

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
