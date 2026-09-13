/**
 * GD / GDD / TOD validation for the Group Delay window.
 *
 * Run: node tests/gd_gdd_validation.mjs
 *
 * The window reports the first three derivatives of the reflected phase with
 * respect to angular frequency. Derivatives divide by h, h² and h³, so any
 * perturbation of the sample points is amplified accordingly and a plausible
 * looking curve can be entirely numerical. These tests pin the result against
 * things that do not depend on the window's own implementation:
 *
 *   1. An analytic zero. A lossless bare substrate has
 *      r = (n₀ − n_s)/(n₀ + n_s), real and negative for any real n_s,
 *      so the phase is exactly π at every wavelength and all three derivatives
 *      vanish even when the real index is dispersive.
 *   2. An analytic phase. A quarter-wave stack at λ₀ has a real negative r,
 *      so the reported phase must be 180°.
 *   3. An independent differentiation: a 7-point stencil with Richardson
 *      extrapolation, sharing no code with the window's analytic evaluator
 *      beyond the transfer matrix itself.
 *   4. Step independence. A converged derivative must not depend on the
 *      sampling interval. This is the regression guard for the wavelength
 *      quantization defect, where GDD at 550 nm ranged over four orders of
 *      magnitude as the step was refined.
 *   5. Macleod, Thin-Film Optical Filters 5th ed., Figure 11.21: calculated
 *      GDD for a 23-layer quarter-wave stack of TiO₂ and SiO₂, TiO₂ outermost,
 *      reference wavelength 550 nm. The text states the effect is small and
 *      that varying the total number of layers makes little difference.
 */
import {
    computeGdGddSpectrum,
    AUTOMATIC_GD_GDD_FINE_STEP_NM,
} from '../src/components/windows/analysis/gdGddEvaluation/spectrum.js';
import {
    chromaticDispersionCoefficient, tmmWithAdmittances, C_NM_PER_FS,
} from '../src/utils/physics/thinFilmMath.js';
import { designMaterialLookup } from '../src/utils/materials/designMaterials.js';

const TWO_PI_C = 2 * Math.PI * C_NM_PER_FS;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-30, Math.abs(b));

const N_H = 2.51660, N_L = 1.45991, LAM0 = 550;

function qwStack(pairs, extraH = false) {
    const front = [];
    for (let i = 0; i < pairs; i++) {
        front.push({ material: 'TiO2', thickness: LAM0 / (4 * N_H) },
                   { material: 'SiO2', thickness: LAM0 / (4 * N_L) });
    }
    if (extraH) front.push({ material: 'TiO2', thickness: LAM0 / (4 * N_H) });
    return {
        incidentMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
        exitMedium: 'Air', surfaceMode: 'front_only', frontLayers: front, backLayers: [],
    };
}

function windowAt(design, lo, hi, step, target) {
    const s = computeGdGddSpectrum(design, {
        side: 'front', lambdaStart: lo, lambdaEnd: hi,
        lambdaStep: step, thetaDeg: 0, polarization: 's', target: 'R',
    });
    let k = 0;
    for (let i = 1; i < s.lambda.length; i++) {
        if (Math.abs(s.lambda[i] - target) < Math.abs(s.lambda[k] - target)) k = i;
    }
    return { lam: s.lambda[k], gd: s.gd[k], gdd: s.gdd[k], tod: s.tod[k], phase: s.phaseDeg[k] };
}

function independentDerivs(design, lamNm, hFrac = 1e-4) {
    const resolve = designMaterialLookup(design);
    const inc = resolve(design.incidentMedium), sub = resolve(design.substrate.material);
    const nk = (m, l) => { const [n, k] = m.getNK(l); return [n, k]; };
    const phiAt = (w) => {
        const lam = TWO_PI_C / w;
        const layers = design.frontLayers.map(l => ({ n: nk(resolve(l.material), lam), d: l.thickness }));
        const r = tmmWithAdmittances(lam, 0, 's', nk(inc, lam), nk(sub, lam), layers).r;
        return Math.atan2(r[1], r[0]);
    };
    const w0 = TWO_PI_C / lamNm;
    const estimate = (h) => {
        const p = [];
        for (let i = -3; i <= 3; i++) p.push(phiAt(w0 + i * h));
        for (let i = 1; i < p.length; i++) {
            while (p[i] - p[i - 1] > Math.PI) p[i] -= 2 * Math.PI;
            while (p[i] - p[i - 1] < -Math.PI) p[i] += 2 * Math.PI;
        }
        const [m3, m2, m1, f0, p1, p2, p3] = p;
        return {
            gd: (-m3 + 9 * m2 - 45 * m1 + 45 * p1 - 9 * p2 + p3) / (60 * h),
            gdd: (2 * m3 - 27 * m2 + 270 * m1 - 490 * f0 + 270 * p1 - 27 * p2 + 2 * p3) / (180 * h * h),
            tod: -(m3 - 8 * m2 + 13 * m1 - 13 * p1 + 8 * p2 - p3) / (8 * h * h * h),
        };
    };
    const h = w0 * hFrac;
    const a = estimate(h), b = estimate(h / 2);
    return {
        gd: b.gd + (b.gd - a.gd) / 63,
        gdd: b.gdd + (b.gdd - a.gdd) / 63,
        tod: -(b.tod + (b.tod - a.tod) / 15),
    };
}

// ── 1. Analytic zero: bare substrate ─────────────────────────────────────────
{
const bare = {
        incidentMedium: 'Air', substrate: { material: 'SiO2', thickness: 1 },
        exitMedium: 'Air', surfaceMode: 'front_only', frontLayers: [], backLayers: [],
    };
    const w = windowAt(bare, 450, 700, 1, 550);
    ok(Math.abs(w.gd) < 1e-6, `bare substrate: GD = 0 (got ${w.gd})`);
    ok(Math.abs(w.gdd) < 1e-6, `bare substrate: GDD = 0 (got ${w.gdd})`);
    ok(Math.abs(w.tod) < 1e-6, `bare substrate: TOD = 0 (got ${w.tod})`);
    ok(Math.abs(Math.abs(w.phase) - 180) < 1e-5, `bare substrate: phase = 180° (got ${w.phase})`);
}

// ── 2. Analytic phase: quarter-wave stack at λ₀ ──────────────────────────────
{
    const w = windowAt(qwStack(8), 540, 560, 0.01, 550);
    ok(Math.abs(Math.abs(w.phase) - 180) < 0.01,
       `quarter-wave stack: phase at λ₀ = 180° (got ${w.phase})`);
}

// ── 3. Independent differentiation ───────────────────────────────────────────
for (const lam of [500, 550, 600]) {
    const ref = independentDerivs(qwStack(8), lam);
    const w = windowAt(qwStack(8), lam - 40, lam + 40, 0.05, lam);
    ok(rel(w.gd, ref.gd) < 2e-3, `GD at ${lam} nm: ${w.gd} vs reference ${ref.gd}`);
    ok(rel(w.gdd, ref.gdd) < 5e-2, `GDD at ${lam} nm: ${w.gdd} vs reference ${ref.gdd}`);
    ok(rel(w.tod, ref.tod) < 1e-1, `TOD at ${lam} nm: ${w.tod} vs reference ${ref.tod}`);
}

// ── 4. Step independence (regression guard) ──────────────────────────────────
{
    const vals = [0.5, AUTOMATIC_GD_GDD_FINE_STEP_NM, 0.1, 0.05, 0.01, 0.005]
        .map(step => windowAt(qwStack(8), 500, 620, step, 550));
    const spread = (key) => Math.max(...vals.map(v => v[key])) - Math.min(...vals.map(v => v[key]));
    ok(spread('gd') < 1e-3, `GD independent of step (spread ${spread('gd')})`);
    ok(spread('gdd') < 0.05, `GDD independent of step (spread ${spread('gdd')})`);
    ok(spread('tod') < 0.05, `TOD independent of step (spread ${spread('tod')})`);

    const atDefault = vals[1], fine = vals[3];
    ok(Math.abs(atDefault.gdd - fine.gdd) < 1e-4,
       `default-step GDD agrees with 0.05 nm (difference ${Math.abs(atDefault.gdd - fine.gdd)})`);
    ok(Math.abs(atDefault.tod - fine.tod) < 1e-3,
       `default-step TOD agrees with 0.05 nm (difference ${Math.abs(atDefault.tod - fine.tod)})`);
}

// ── 5. Macleod Figure 11.21 ──────────────────────────────────────────────────
{
    const mac = qwStack(11, true);
    ok(mac.frontLayers.length === 23, `Macleod stack is 23 layers (got ${mac.frontLayers.length})`);
    ok(mac.frontLayers[0].material === 'TiO2', 'Macleod stack has TiO2 outermost');

    const w = windowAt(mac, 450, 700, 0.5, 550);
    ok(Math.abs(w.gdd) < 5, `Macleod 23-layer GDD at 550 nm is small (got ${w.gdd} fs²)`);

    const gdds = [[8, false], [11, true], [16, false]]
        .map(([pairs, extra]) => windowAt(qwStack(pairs, extra), 450, 700, 0.5, 550).gdd);
    const spread = Math.max(...gdds) - Math.min(...gdds);
    ok(spread < 1, `layer count makes little difference to GDD (spread ${spread} fs²)`);
}

// ── 6. Macleod p448: 25 quarter waves at 1 µm, round trip about 42 fs ────────
{
    const t = 2 * 25 * (1000 / 4) / C_NM_PER_FS;
    ok(Math.abs(t - 42) < 1, `full-traverse round trip is about 42 fs (got ${t.toFixed(1)})`);
}

// ── 7. CDC is GDD against wavelength ────────────────────────────────────────
// Essential Macleod reports both, so the conversion and its sign are pinned by
// its own output rather than by an algebraic argument here. Reflectance, s
// polarization, normal incidence, from the exports in validation/macleod.
{
    const macleod = [
        [500, 0.054297809157203565, 0.00040911261328161407],   // Ag, one 100 nm layer
        [900, 0.00018984743935080404, 4.4148941565767525e-7],   // Ag, one 100 nm layer
        [700, -401.537976616122, -1.5435870183407834],          // 21 Layer Longwave Pass
        [1545, -9453.3035112527632, -7.459800368750872],        // Three Cavity Narrowband
    ];
    for (const [lam, gdd, cdc] of macleod) {
        const got = chromaticDispersionCoefficient(gdd, lam);
        ok(rel(got, cdc) < 1e-12,
           `CDC at ${lam} nm matches Essential Macleod (got ${got}, expected ${cdc})`);
    }
    // A positive GDD gives a positive CDC: the sign of the dw/dlambda factor is
    // not carried, which is the convention the numbers above establish.
    ok(chromaticDispersionCoefficient(1, 1000) > 0, 'CDC keeps the sign of GDD');

    // And the window's own series carries that conversion of its own GDD at
    // every wavelength. The expectation is written out from the constants
    // rather than taken from the function under test, so a wrong factor, a
    // wrong sign or a misaligned wavelength all fail here.
    const stack = computeGdGddSpectrum(qwStack(11, true), {
        side: 'front', lambdaStart: 450, lambdaEnd: 700,
        lambdaStep: 0.5, thetaDeg: 0, polarization: 's', target: 'R',
    });
    let worst = 0;
    let compared = 0;
    for (let i = 0; i < stack.lambda.length; i++) {
        if (!Number.isFinite(stack.gdd[i])) continue;
        const lam = stack.lambda[i];
        const expected = stack.gdd[i] * TWO_PI_C / (lam * lam);
        worst = Math.max(worst, rel(stack.cdc[i], expected));
        compared++;
    }
    ok(compared > 400, `the CDC series was actually compared (${compared} wavelengths)`);
    ok(worst < 1e-15, `plotted CDC is GDD·2πc/λ² at every wavelength (worst ${worst})`);

    // A wavelength that is not positive has no angular frequency, so there is
    // no coefficient to report rather than an infinity to plot.
    for (const bad of [0, -500, NaN, Infinity]) {
        ok(Number.isNaN(chromaticDispersionCoefficient(1, bad)),
           `CDC at a wavelength of ${bad} is NaN, not a number the plot would draw`);
    }
}

console.log(fails === 0 ? 'PASS: gd_gdd_validation' : `${fails} assertion(s) failed`);
process.exitCode = fails ? 1 : 0;
