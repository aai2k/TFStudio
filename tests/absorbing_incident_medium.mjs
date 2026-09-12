/**
 * An absorbing incident medium at an angle.
 *
 * A design lit from inside an absorbing medium (a cemented cube, an immersion
 * liquid) used to show R + T above 1 at oblique incidence by an amount linear
 * in the medium's k, and the incident medium's k alone was the whole of the
 * disagreement with Essential Macleod on the cube beamsplitter. The cause was
 * the complex index carried into Snell's invariant: the incident wave's
 * amplitude then varies along the interface and energy flows sideways inside
 * lossless layers. Every wave now shares the real invariant n0 sinθ0, n0 the
 * real part of the index (Macleod 5th ed., §10.2, Eqs. 10.11 to 10.13), in
 * the kernel and in every incident admittance TFStudio forms itself.
 *
 * What remains of R + T − 1 over lossless layers is the interference of the
 * incident and reflected waves inside the absorbing medium, which the
 * transmittance definition of Macleod's Eq. 2.83 carries:
 *
 *     1 − R − T = −2 (Im η0 / Re η0) Im(r)      (TFStudio's sign convention)
 *
 * It is exact at every angle and polarization, and second order in k0 for a
 * bare interface, where Im(r) is itself of order k0.
 *
 *  1. The identity holds to round-off at 0, 30 and 60 degrees, s and p, for
 *     incident k from 1e-6 to 1e-2, so no term linear in k0 is left.
 *  2. The kernel and the admittance evaluator agree on the same model.
 *  3. A bare interface between an absorbing medium and its conjugate at
 *     normal incidence gives T = 1 + k0²/n0² and R = k0²/n0² (Eq. 2.84).
 *  4. The bare back face of the slab model and the admittance-diagram
 *     evaluator take the same incident admittance as the coated pass.
 *
 * Run: node tests/absorbing_incident_medium.mjs
 */
import assert from 'node:assert/strict';
import { tmm, tmmWithAdmittances } from '../src/utils/physics/thinFilmMath.js';
import { bareInterface } from '../src/utils/physics/thinFilmMath/totalSystem.js';

const near = (actual, expected, tolerance, message) => assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: got ${actual}, expected ${expected}, tolerance ${tolerance}`);

const H = [2.3, 0], L = [1.46, 0], GLASS = [1.52, 0];
const STACKS = {
    'two layers': [{ n: H, d: 70 }, { n: L, d: 110 }],
    'quarter-wave 21': Array.from({ length: 21 }, (_, i) => (i % 2 ? { n: L, d: 94.2 } : { n: H, d: 58.5 })),
};

// The admittance evaluator's R and T on glass, with the incident-side
// interference term the identity predicts.
function evaluate(lam, theta, pol, n0, layers) {
    const { r, t, eta0, etaS } = tmmWithAdmittances(lam, theta, pol, n0, GLASS, layers);
    const R = r[0] * r[0] + r[1] * r[1];
    const T = etaS[0] / eta0[0] * (t[0] * t[0] + t[1] * t[1]);
    return { r, eta0, R, T, interference: -2 * (eta0[1] / eta0[0]) * r[1] };
}

// ── 1 and 2 ──────────────────────────────────────────────────────────────────

let worstGap = 0;
for (const [name, layers] of Object.entries(STACKS)) {
    for (const k0 of [1e-6, 1e-4, 1e-2]) {
        const n0 = [1.5, k0];
        for (const theta of [0, 30, 60]) {
            for (const pol of ['s', 'p']) {
                const at = `${name}, k0 = ${k0}, ${theta}°, ${pol}`;
                const { R, T, interference } = evaluate(550, theta, pol, n0, layers);
                const gap = Math.abs(1 - R - T - interference);
                worstGap = Math.max(worstGap, gap);
                assert.ok(gap <= 1e-14, `${at}: 1 − R − T = ${1 - R - T}, interference ${interference}, gap ${gap}`);
                const kernel = tmm(550, theta, pol, n0, GLASS, layers);
                near(kernel.R, R, 1e-15, `${at}: the kernel's R`);
                near(kernel.T, T, 1e-15, `${at}: the kernel's T`);
            }
        }
    }
}

// The interference term itself is first order in k0 in general, and it is all
// that is left: doubling k0 doubles it, and the gap stays at round-off.
{
    const layers = STACKS['quarter-wave 21'];
    const small = evaluate(550, 60, 's', [1.5, 1e-4], layers);
    const large = evaluate(550, 60, 's', [1.5, 2e-4], layers);
    near(large.interference / small.interference, 2, 1e-3, 'the remaining departure from R + T = 1 is linear in k0');
    assert.ok(Math.abs(small.interference) > 1e-6, `and it is the interference term, not nothing (${small.interference})`);
}

// ── 3. The bare interface of Eq. 2.82 ───────────────────────────────────────

for (const [n, k] of [[1.5, 0.01], [1.5, 0.1], [2, 0.3]]) {
    const { R, T } = tmm(550, 0, 's', [n, k], [n, -k], []);
    near(T, 1 + (k / n) ** 2, 1e-15, `T into the conjugate admittance, n0 = ${n} + ${k}i`);
    near(R, (k / n) ** 2, 1e-15, `R from the conjugate admittance, n0 = ${n} + ${k}i`);
}
// At an angle the excess stays second order: Im(r) of a bare interface is of
// order k0, so the interference term is of order k0².
{
    const bare = k0 => evaluate(550, 60, 'p', [1.5, k0], []);
    const ratio = (1 - bare(2e-3).R - bare(2e-3).T) / (1 - bare(1e-3).R - bare(1e-3).T);
    near(ratio, 4, 1e-2, 'a bare interface at 60° departs from R + T = 1 in second order');
}

// ── 4. The other incident admittances TFStudio forms ────────────────────────

{
    const n0 = [1.5, 0.02];
    const sin0 = [Math.sin(Math.PI / 3), 0];
    const face = bareInterface(n0, GLASS, sin0);
    for (const pol of ['s', 'p']) {
        const { eta0 } = tmmWithAdmittances(550, 60, pol, n0, GLASS, []);
        assert.deepEqual(face[pol].eta0, eta0, `the slab model's bare face uses the coated pass's incident admittance (${pol})`);
        near(face[pol].R, tmm(550, 60, pol, n0, GLASS, []).R, 1e-15, `and its reflectance is the kernel's (${pol})`);
    }
}

console.log(`worst gap in the energy identity: ${worstGap.toExponential(2)}`);
console.log('PASS: absorbing_incident_medium');
