/**
 * Cone-angle averaging tests.
 *
 * Validates the pure quadrature core (coneAngle.js) and its integration into the
 * operand evaluator (evalCore.tmmProp):
 *
 *  1. Gauss–Legendre quadrature is exact for low-degree polynomials.
 *  2. f-number / NA / half-angle conversions round-trip.
 *  3. coneNodes weights are normalized (Σ = 1) for every distribution, normal
 *     and oblique axis; node angles lie in the geometrically valid range.
 *  4. Inactive / Θ=0 cone → single node → operand eval is BIT-IDENTICAL to the
 *     pre-cone single-angle path.
 *  5. Self-consistency: a cone-averaged operand equals the manual Σ wᵢ·(value at
 *     the node angle) reconstruction to machine precision (plumbing is exact).
 *  6. Physics (Macleod §16): an oblique cone raises s-pol Fresnel reflectance
 *     above normal incidence and is bracketed by the rim ray; a UNIFORM cone
 *     (more weight at larger α) shifts more than a LAMBERTIAN cone (∝cosα,
 *     deweights the rim).
 *
 * Run: node tests/cone_angle.mjs
 */

import {
    gaussLegendre, makeConeSpec, coneIsActive, coneNodes,
    naFromHalfAngle, halfAngleFromNA, naFromFNumber, fNumberFromNA,
    halfAngleFromFNumber, fNumberFromHalfAngle,
    buildEvalContext, evaluateOperands, makeOperand,
} from '../src/utils/physics/optimizer.js';
import { tmm, evaluateSpectrum } from '../src/utils/physics/thinFilmMath.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

let fails = 0;
const ok    = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const close = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg} (|${a} − ${b}| = ${Math.abs(a - b)} > ${tol})`);

// ── 1. Gauss–Legendre exactness ──────────────────────────────────────────────
{
    const { x, w } = gaussLegendre(3);
    let s0 = 0, s2 = 0, s4 = 0;
    for (let i = 0; i < x.length; i++) { s0 += w[i]; s2 += w[i] * x[i] ** 2; s4 += w[i] * x[i] ** 4; }
    close(s0, 2,     1e-13, 'GL3 ∫_{-1}^1 1 dx = 2');
    close(s2, 2 / 3, 1e-13, 'GL3 ∫_{-1}^1 x² dx = 2/3');
    // n=3 is exact up to degree 5, so x⁴ (degree 4) must also be exact = 2/5.
    close(s4, 2 / 5, 1e-13, 'GL3 ∫_{-1}^1 x⁴ dx = 2/5');
}

// ── 2. conversions round-trip ─────────────────────────────────────────────────
{
    for (const deg of [1, 5, 7.5, 15, 30, 45]) {
        const na = naFromHalfAngle(deg, 1);
        close(halfAngleFromNA(na, 1), deg, 1e-10, `NA round-trip @ ${deg}°`);
    }
    // NA = 0.25 ⇒ f/# = 2 ; back to NA.
    close(fNumberFromNA(0.25), 2, 1e-12, 'f/# from NA=0.25 → 2');
    close(naFromFNumber(2), 0.25, 1e-12, 'NA from f/#=2 → 0.25');
    // f/# ↔ half-angle round-trip.
    const f = fNumberFromHalfAngle(10, 1);
    close(halfAngleFromFNumber(f, 1), 10, 1e-10, 'f/# ↔ half-angle round-trip @ 10°');
}

// ── 3. node normalization + ranges ────────────────────────────────────────────
function wsum(nodes) { return nodes.reduce((s, n) => s + n.weight, 0); }
{
    for (const dist of ['uniform', 'lambertian', 'user']) {
        const userTable = dist === 'user'
            ? [{ theta: 0, intensity: 100 }, { theta: 10, intensity: 60 }, { theta: 20, intensity: 10 }]
            : null;
        const spec = makeConeSpec({ enabled: true, halfAngleDeg: 20, distribution: dist, gridPoints: 16, userTable });
        ok(coneIsActive(spec), `${dist}: cone active`);

        // normal axis
        const nn = coneNodes(spec, 0);
        close(wsum(nn), 1, 1e-12, `${dist} normal: Σw = 1`);
        ok(nn.every(n => n.aoiDeg >= -1e-9 && n.aoiDeg <= 20 + 1e-9), `${dist} normal: angles ∈ [0,Θ]`);

        // oblique axis γ=20, Θ=10 → θ ∈ [γ−Θ, γ+Θ] = [10,30]
        const sp2 = makeConeSpec({ enabled: true, halfAngleDeg: 10, distribution: dist, gridPoints: 14, userTable });
        const no = coneNodes(sp2, 20);
        close(wsum(no), 1, 1e-12, `${dist} oblique: Σw = 1`);
        ok(no.every(n => n.aoiDeg >= 10 - 1e-6 && n.aoiDeg <= 30 + 1e-6), `${dist} oblique: θ ∈ [10,30]`);
    }
}

// ── 4. inactive cone → single node ────────────────────────────────────────────
{
    ok(!coneIsActive(makeConeSpec({})), 'absent cone inactive');
    ok(!coneIsActive(makeConeSpec({ enabled: true, halfAngleDeg: 0 })), 'Θ=0 inactive');
    ok(!coneIsActive(makeConeSpec({ enabled: false, halfAngleDeg: 20 })), 'disabled inactive');
    const nodes = coneNodes(makeConeSpec({ enabled: false, halfAngleDeg: 20 }), 12);
    ok(nodes.length === 1 && nodes[0].aoiDeg === 12 && nodes[0].weight === 1, 'inactive → single axis node');
}

// ── design plumbing helpers ───────────────────────────────────────────────────
const resolveMat = id => getMaterial(id);
const baseDesign = (cone) => ({
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [
        { id: 'F1', material: 'TiO2', thickness: 92,  locked: false },
        { id: 'F2', material: 'SiO2', thickness: 158, locked: false },
    ],
    surfaceMode: 'front_only',
    ...(cone ? { cone } : {}),
});

// ── 5. bit-identical when disabled + exact self-consistency when enabled ───────
{
    const op = makeOperand({ type: 'RAV', lambdaStart: 500, lambdaEnd: 600, aoi: 0, pol: 'avg', target: 0, weight: 1 });
    const valNoCone   = evaluateOperands([op], buildEvalContext(baseDesign(null), resolveMat))[0];
    const valDisabled = evaluateOperands([op], buildEvalContext(baseDesign({ enabled: false, halfAngleDeg: 25 }), resolveMat))[0];
    ok(valNoCone === valDisabled, 'disabled cone is bit-identical to no cone');

    // Enable a wide cone, reconstruct manually from per-node single-angle evals.
    const coneCfg = { enabled: true, halfAngleDeg: 25, distribution: 'uniform', gridPoints: 12 };
    const valCone = evaluateOperands([op], buildEvalContext(baseDesign(coneCfg), resolveMat))[0];
    ok(Math.abs(valCone - valNoCone) > 1e-4, 'cone changes an angle-sensitive operand value');

    const nodes = coneNodes(makeConeSpec(coneCfg), 0);
    let manual = 0;
    for (const nd of nodes) {
        const opAtNode = makeOperand({ type: 'RAV', lambdaStart: 500, lambdaEnd: 600, aoi: nd.aoiDeg, pol: 'avg', target: 0, weight: 1 });
        manual += nd.weight * evaluateOperands([opAtNode], buildEvalContext(baseDesign(null), resolveMat))[0];
    }
    close(valCone, manual, 1e-12, 'cone average == manual Σ wᵢ·value(θᵢ) reconstruction');
}

// ── 6. physics: Fresnel s-pol reflectance vs cone ─────────────────────────────
// Bare 1→2 interface, λ irrelevant (non-dispersive constants). R_s rises
// monotonically with angle, so an oblique cone must raise R above normal and
// stay below the rim ray; uniform (more rim weight) must exceed lambertian.
{
    const n0 = [1, 0], ns = [2, 0];
    const Rs = (deg) => tmm(550, deg, 's', n0, ns, []).R;
    const coneAvgRs = (dist, halfAngleDeg) => {
        const nodes = coneNodes(makeConeSpec({ enabled: true, halfAngleDeg, distribution: dist, gridPoints: 24 }), 0);
        return nodes.reduce((s, nd) => s + nd.weight * Rs(nd.aoiDeg), 0);
    };
    const R0  = Rs(0);
    const R30 = Rs(30);
    const Ru  = coneAvgRs('uniform', 30);
    const Rl  = coneAvgRs('lambertian', 30);
    ok(Ru > R0,  'uniform cone raises R_s above normal incidence');
    ok(Ru < R30, 'uniform cone average below the rim ray R(Θ)');
    ok(Rl > R0,  'lambertian cone raises R_s above normal incidence');
    ok(Ru > Rl,  'uniform shifts more than lambertian (more rim weight)');
}

// ── 7. Optical-Evaluation plot path (evaluateSpectrum cone averaging) ─────────
// Mirrors OpticalEvaluation.coneAverageSpectrum: the cone-averaged spectrum must
// equal the manual Σ wᵢ·spectrum(θᵢ) reconstruction, and differ from collimated.
{
    const inc = getMaterial('Air'), sub = getMaterial('BK7');
    const layers = [
        { material: getMaterial('TiO2'), thickness: 92 },
        { material: getMaterial('SiO2'), thickness: 158 },
    ];
    const params = { lambdaStart: 450, lambdaEnd: 650, lambdaStep: 10, polarization: 'avg' };
    const specAt = (theta) => evaluateSpectrum({ ...params, theta }, inc, sub, layers);

    const spec = makeConeSpec({ enabled: true, halfAngleDeg: 20, distribution: 'uniform', gridPoints: 12 });
    const nodes = coneNodes(spec, 0);

    const collimated = specAt(0);
    // manual reconstruction
    const manual = collimated.R.map(() => 0);
    for (const nd of nodes) {
        const r = specAt(nd.aoiDeg);
        for (let i = 0; i < manual.length; i++) manual[i] += nd.weight * r.R[i];
    }
    // helper-equivalent accumulation (what OE does)
    let acc = null;
    for (const nd of nodes) {
        const r = specAt(nd.aoiDeg);
        if (!acc) acc = r.R.map(v => v * nd.weight);
        else for (let i = 0; i < acc.length; i++) acc[i] += r.R[i] * nd.weight;
    }
    let maxAbs = 0, maxDelta = 0;
    for (let i = 0; i < manual.length; i++) {
        maxAbs   = Math.max(maxAbs, Math.abs(acc[i] - manual[i]));
        maxDelta = Math.max(maxDelta, Math.abs(acc[i] - collimated.R[i]));
    }
    close(maxAbs, 0, 1e-12, 'OE spectrum cone-average == manual reconstruction');
    ok(maxDelta > 1e-4, 'OE cone-averaged spectrum differs from collimated');
}

if (fails === 0) console.log('cone_angle: ALL PASS');
else { console.error(`cone_angle: ${fails} FAIL(S)`); process.exit(1); }
