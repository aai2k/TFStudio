/**
 * Grazing incidence, in every evaluator that forms its own admittances.
 *
 * At 89.99999° sin θ0 lies within 3e-14 of one, so √(1 − sin²θ0) keeps about
 * three digits of cos θ0. Near grazing incidence 1 − R, T and the surface field
 * all go as cos θ0, and each inherits that error, 7e-4 relative in 1 − R. The
 * kernel takes cos θ0 directly; the evaluators TFStudio builds on its
 * snellCosTheta and incidentCosTheta primitives have to hand it the same
 * cosine, or the spectrum window and the ellipsometry, field, monitoring and
 * admittance windows show different numbers for one design.
 *
 * The reference is a bare air/glass interface with its tilted admittances
 * η = n cos θ (s) and n / cos θ (p), cos θ0 from Math.cos, and the Fresnel
 * forms of Macleod, Thin-Film Optical Filters 5th ed., Eqs. 2.91 to 2.94:
 *
 *     r = (η0 − η1)/(η0 + η1),   t = 2η0/(η0 + η1),   T = 1 − R = 4η0η1/(η0 + η1)²
 *
 * 1 − R is compared rather than R, because R is within 1e-6 of one there. The
 * tolerance, 1e-8 relative, sits far above the rounding in forming 1 − R from
 * R (about 3e-10) and far below the error the square-root form leaves.
 *
 * Held here: the spectrum path with and without the WASM kernel, the
 * ellipsometry point evaluator, the field profile, the monitor evaluators
 * (semi-infinite and slab, JavaScript and kernel), and the incident admittance
 * of the admittance diagram.
 *
 * Run: node tests/grazing_incidence_cosine.mjs
 */
import assert from 'node:assert/strict';

import { setTmmWasmEnabled } from 'tmmcore';
import { initWasmForTest } from './_wasmInit.mjs';
import { initCatalogs } from '../src/utils/materials/catalogManager.js';
import {
    computeEFieldProfile, computeEllipsometry, createGrowingLayerEvaluator,
    createMonitorTmmEvaluator, evaluateSpectrum,
} from '../src/utils/physics/thinFilmMath.js';
import { buildDiagramData } from '../src/components/windows/analysis/admittanceDiagram/model.js';

initCatalogs({});
const kernel = await initWasmForTest();

const THETA = 89.99999;           // degrees
const LAMBDA = 550;               // nm
const N0 = 1;
const NS = 1.52;
const AIR = { name: 'air', getNK: () => [N0, 0] };
const GLASS = { name: 'glass', getNK: () => [NS, 0] };
const TOLERANCE = 1e-8;

// ── The reference ────────────────────────────────────────────────────────────

const rad = THETA * Math.PI / 180;
const cos0 = Math.cos(rad);
const cosS = Math.sqrt(1 - (N0 * Math.sin(rad) / NS) ** 2);   // 41° in the glass, far from grazing
const ADMITTANCE = { s: [N0 * cos0, NS * cosS], p: [N0 / cos0, NS / cosS] };
const fresnelT = pol => {
    const [a, b] = ADMITTANCE[pol];
    return 4 * a * b / (a + b) ** 2;
};
const fresnelTAmplitude = pol => {
    const [a, b] = ADMITTANCE[pol];
    return 2 * a / (a + b);
};

let checks = 0;
function close(got, want, what) {
    const error = Math.abs(got - want) / Math.abs(want);
    assert.ok(error <= TOLERANCE,
        `${what}: got ${got}, want ${want}, relative error ${error.toExponential(2)}`);
    checks++;
}

// A slab of the glass with the same bare face front and back, lossless: the
// incoherent sum T_f T_b / (1 − R_f' R_b) with every face alike is T/(1 + R).
const slabT = pol => fresnelT(pol) / (2 - fresnelT(pol));

// ── The spectrum path ────────────────────────────────────────────────────────

for (const useKernel of [false, true]) {
    if (useKernel && !kernel) continue;
    setTmmWasmEnabled(useKernel);
    const label = useKernel ? 'spectrum, kernel' : 'spectrum, JavaScript';
    const spectrum = evaluateSpectrum({
        lambdaStart: LAMBDA, lambdaEnd: LAMBDA, lambdaStep: 5, theta: THETA, polarization: 'avg',
    }, AIR, GLASS, []);
    close(1 - spectrum.Rs[0], fresnelT('s'), `${label}: 1 − R, s`);
    close(1 - spectrum.Rp[0], fresnelT('p'), `${label}: 1 − R, p`);
    close(spectrum.Ts[0], fresnelT('s'), `${label}: T, s`);
    close(spectrum.Tp[0], fresnelT('p'), `${label}: T, p`);
}
setTmmWasmEnabled(false);

// ── Ellipsometry and the field profile ──────────────────────────────────────

{
    const { rs, rp } = computeEllipsometry(LAMBDA, THETA, [N0, 0], [NS, 0], []);
    close(1 - (rs[0] ** 2 + rs[1] ** 2), fresnelT('s'), 'ellipsometry: 1 − |r_s|²');
    close(1 - (rp[0] ** 2 + rp[1] ** 2), fresnelT('p'), 'ellipsometry: 1 − |r_p|²');
}
{
    // On a bare surface the profile is one sample: the tangential field there,
    // t in s, as a fraction of the incident field.
    const profile = computeEFieldProfile(LAMBDA, THETA, 's', [N0, 0], [NS, 0], [], 60, { components: false });
    close(profile.e2[0], fresnelTAmplitude('s') ** 2, 'field profile: |E|² at the surface, s');
}

// ── Monitor evaluators ───────────────────────────────────────────────────────

for (const useKernel of [false, true]) {
    if (useKernel && !kernel) continue;
    setTmmWasmEnabled(useKernel);
    const label = useKernel ? 'kernel' : 'JavaScript';
    for (const pol of ['s', 'p']) {
        const bare = createMonitorTmmEvaluator(THETA, AIR, GLASS, [], [], [LAMBDA], null);
        close(1 - bare.sample('R', pol, GLASS, 0)[0], fresnelT(pol), `monitor, ${label}, semi-infinite: 1 − R, ${pol}`);
        bare.free?.();
        const slab = createMonitorTmmEvaluator(THETA, AIR, GLASS, [], [], [LAMBDA], 1);
        close(slab.sample('T', pol, GLASS, 0)[0], slabT(pol), `monitor, ${label}, slab: T, ${pol}`);
        slab.free?.();
        const growing = createGrowingLayerEvaluator(THETA, AIR, GLASS, [], [], LAMBDA, 1);
        close(growing.sampleMany('T', pol, GLASS, [0])[0], slabT(pol), `growing layer, ${label}, slab: T, ${pol}`);
        growing.free();
    }
}
setTmmWasmEnabled(false);

// ── Admittance diagram ──────────────────────────────────────────────────────
//
// The incident admittance is the point the locus is read against, cos θ0 in s
// and 1/cos θ0 in p over air.

{
    const design = {
        incidentMedium: 'builtin:Air',
        substrate: { material: 'builtin:BK7' },
        backLayers: [],
        frontLayers: [{ id: '1', material: 'builtin:SiO2', thickness: 100 }],
    };
    const series = buildDiagramData(design, {
        lambda_nm: LAMBDA, theta_deg: THETA, pol: 'avg', side: 'front', view: 'admittance',
    });
    for (const { pol, eta0 } of series) {
        close(eta0[0], ADMITTANCE[pol][0], `admittance diagram: η0, ${pol}`);
        assert.ok(eta0[1] === 0, `admittance diagram: η0 is real over a transparent medium, ${pol}`);
    }
}

console.log(`PASS: grazing_incidence_cosine (${checks} checks at ${THETA}°${kernel ? '' : ', kernel rows skipped'})`);
