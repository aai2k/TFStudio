/**
 * Inhomogeneity / Interlayer tests — verifies the slice-approximation
 * machinery: profile functions hit (0,0) and (1,1), midpoint sampling is
 * O(1/N²), mixMaterials honors fraction endpoints, buildGradedSlices
 * conserves total thickness, expandLayersWithInterlayers is identity when
 * no interlayers are enabled, expansion produces the right slice count and
 * preserves the host layers' thicknesses, and a very-thin interlayer
 * perturbs the spectrum only slightly while a thick interlayer perturbs it
 * a lot.
 *
 * Run: node tests/inhomogeneity.mjs
 */

import {
    PROFILES, PROFILE_IDS, applyProfile, mixMaterials, buildGradedSlices,
    expandLayersWithInterlayers, enumerateInterfaces, totalInterlayerThickness,
    emptyInhomogeneity, cloneInhomogeneity,
} from '../src/utils/physics/inhomogeneity.js';
import { evaluateSpectrum } from '../src/utils/physics/thinFilmMath.js';

let fails = 0;
const ok    = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const near  = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol;

// Test materials
const matA = { id: 'A', getNK: () => [1.46, 0] };  // SiO2-like
const matB = { id: 'B', getNK: () => [2.40, 0] };  // TiO2-like
const matSub = { id: 'Sub', getNK: () => [1.52, 0] };
const matAir = { id: 'Air', getNK: () => [1.0, 0] };

// ── 1) Profile endpoints ────────────────────────────────────────────────────
for (const id of PROFILE_IDS) {
    ok(near(applyProfile(id, 0), 0, 1e-10), `${id} profile: f(0) = 0`);
    ok(near(applyProfile(id, 1), 1, 1e-10), `${id} profile: f(1) = 1`);
    // Monotonic non-decreasing on [0,1]
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const v = applyProfile(id, t);
        ok(v >= prev - 1e-12, `${id} profile: monotone at t=${t.toFixed(2)} (${v} < ${prev})`);
        prev = v;
    }
}

// ── 2) Unknown profile falls back to linear ─────────────────────────────────
ok(near(applyProfile('nonsense', 0.5), 0.5), 'unknown profile falls back to linear');

// ── 3) mixMaterials at endpoints reproduces the input materials ────────────
{
    const m0 = mixMaterials(matA, matB, 0);
    const m1 = mixMaterials(matA, matB, 1);
    const [nA] = m0.getNK(550);
    const [nB] = m1.getNK(550);
    ok(near(nA, 1.46), 'mix @ f=0: n = n_A');
    ok(near(nB, 2.40), 'mix @ f=1: n = n_B');

    // Midpoint = (n_A + n_B) / 2
    const mh = mixMaterials(matA, matB, 0.5);
    const [nh] = mh.getNK(550);
    ok(near(nh, (1.46 + 2.40) / 2), 'mix @ f=0.5: n = (n_A + n_B) / 2');
}

// ── 4) k is clamped to ≥ 0 after mixing ────────────────────────────────────
{
    const mA = { id: 'A', getNK: () => [1.5, 0.1] };
    const mB = { id: 'B', getNK: () => [1.5, -0.5] };
    const m = mixMaterials(mA, mB, 0.5);
    const [, k] = m.getNK(550);
    ok(k >= 0, `mix: k clamped to ≥ 0 (got ${k})`);
}

// ── 5) buildGradedSlices conserves total thickness ─────────────────────────
{
    const slices = buildGradedSlices(matA, matB, 10, 'linear', 8);
    ok(slices.length === 8, 'buildGradedSlices: 8 slices');
    const total = slices.reduce((s, x) => s + x.thickness, 0);
    ok(near(total, 10, 1e-12), `buildGradedSlices: total thickness conserved (${total} vs 10)`);
    // First slice midpoint t = 1/(2N) = 0.0625; n = (1-0.0625)·n_A + 0.0625·n_B
    const [n0] = slices[0].material.getNK(550);
    ok(near(n0, (1 - 1/16) * 1.46 + (1/16) * 2.40, 1e-12),
        `first slice midpoint sampling: n=${n0}`);
    // Last slice midpoint t = 1 - 1/(2N) = 0.9375
    const [nN] = slices[7].material.getNK(550);
    ok(near(nN, (1/16) * 1.46 + (15/16) * 2.40, 1e-12),
        `last slice midpoint sampling: n=${nN}`);
}

// ── 6) buildGradedSlices with thickness=0 returns empty ────────────────────
{
    const s = buildGradedSlices(matA, matB, 0, 'linear', 10);
    ok(s.length === 0, 'thickness=0 → empty slice list');
}

// ── 7) buildGradedSlices clamps slices to ≥ 2 ──────────────────────────────
{
    const s = buildGradedSlices(matA, matB, 10, 'linear', 1);
    ok(s.length === 2, 'slices=1 clamped to 2');
}

// ── 8) expandLayersWithInterlayers is identity when no interlayers ─────────
{
    const layers = [
        { material: matB, thickness: 100 },
        { material: matA, thickness: 137 },
    ];
    const out = expandLayersWithInterlayers(layers, matAir, matSub, []);
    ok(out.length === 2, 'no interlayers: identity length');
    ok(out[0] === layers[0] && out[1] === layers[1], 'no interlayers: identity refs');
    const out2 = expandLayersWithInterlayers(layers, matAir, matSub, null);
    ok(out2 === layers, 'null interlayers: identity reference');
}

// ── 9) Interlayer at afterIndex=0 expands between layers ───────────────────
{
    const layers = [
        { material: matB, thickness: 100 },
        { material: matA, thickness: 137 },
    ];
    const interlayers = [{ afterIndex: 0, thickness: 5, profile: 'linear', slices: 10, enabled: true }];
    const out = expandLayersWithInterlayers(layers, matAir, matSub, interlayers);

    // Should be 1 + 10 + 1 = 12 layers
    ok(out.length === 12, `interlayer expanded: 12 layers (got ${out.length})`);
    // Host layers' thicknesses preserved
    ok(out[0].thickness === 100, 'host layer 0 thickness preserved');
    ok(out[11].thickness === 137, 'host layer 1 thickness preserved');
    // Interlayer total thickness = configured value
    const ilTotal = out.slice(1, 11).reduce((s, l) => s + l.thickness, 0);
    ok(near(ilTotal, 5, 1e-12), `interlayer total thickness = 5 nm (got ${ilTotal})`);
    // Mid-interlayer n at midpoint sample:
    //   out[0] = host layer; out[1..10] = interlayer slices 0..9; out[11] = host
    //   out[5] = interlayer slice 4 → t = (4+0.5)/10 = 0.45
    //   buildGradedSlices(matB, matA, ...) → f=0 is matB (n=2.40), f=1 is matA (n=1.46)
    //   n_eff = (1-0.45)·2.40 + 0.45·1.46
    const [nMid] = out[5].material.getNK(550);
    const tMid = (4 + 0.5) / 10;
    const expected = (1 - tMid) * 2.40 + tMid * 1.46;
    ok(near(nMid, expected, 1e-9), `interlayer slice 4 midpoint n matches (${nMid} vs ${expected})`);
}

// ── 10) Pre-stack interlayer (afterIndex = -1) ─────────────────────────────
{
    const layers = [
        { material: matB, thickness: 100 },
    ];
    const interlayers = [{ afterIndex: -1, thickness: 8, profile: 'linear', slices: 4, enabled: true }];
    const out = expandLayersWithInterlayers(layers, matAir, matSub, interlayers);
    ok(out.length === 5, 'pre-stack interlayer: 4 slices + 1 host = 5 layers');
    // First slice should be mostly Air (matAir = 1.0) — t = 0.125
    const [n0] = out[0].material.getNK(550);
    ok(near(n0, 0.875 * 1.0 + 0.125 * 2.40, 1e-12), `pre-stack first slice n=${n0}`);
}

// ── 11) Post-stack interlayer (afterIndex = N-1) goes to substrate ─────────
{
    const layers = [
        { material: matB, thickness: 100 },
        { material: matA, thickness: 137 },
    ];
    const interlayers = [{ afterIndex: 1, thickness: 8, profile: 'linear', slices: 4, enabled: true }];
    const out = expandLayersWithInterlayers(layers, matAir, matSub, interlayers);
    ok(out.length === 6, 'post-stack interlayer: 2 hosts + 4 slices = 6 layers');
    // Last slice should be mostly Sub — t = 0.875
    const [nLast] = out[5].material.getNK(550);
    ok(near(nLast, 0.125 * 1.46 + 0.875 * 1.52, 1e-12), `post-stack last slice n=${nLast}`);
}

// ── 12) Disabled interlayer is skipped ─────────────────────────────────────
{
    const layers = [
        { material: matB, thickness: 100 },
        { material: matA, thickness: 137 },
    ];
    const interlayers = [{ afterIndex: 0, thickness: 5, profile: 'linear', slices: 10, enabled: false }];
    const out = expandLayersWithInterlayers(layers, matAir, matSub, interlayers);
    ok(out.length === 2, 'disabled interlayer skipped');
}

// ── 13) Thin interlayer barely perturbs the spectrum (sanity) ──────────────
{
    const layers = [
        { material: matB, thickness: 95 },
        { material: matA, thickness: 137 },
        { material: matB, thickness: 95 },
        { material: matA, thickness: 137 },
    ];
    const params = { lambdaStart: 500, lambdaEnd: 600, lambdaStep: 25, theta: 0, polarization: 'avg' };
    const baseline = evaluateSpectrum(params, matAir, matSub, layers);

    const interlayers = [{ afterIndex: 1, thickness: 0.5, profile: 'linear', slices: 10, enabled: true }];
    const expanded = expandLayersWithInterlayers(layers, matAir, matSub, interlayers);
    const perturbed = evaluateSpectrum(params, matAir, matSub, expanded);

    // 0.5 nm interlayer should change T by < 1 % at every wavelength.
    let maxDiff = 0;
    for (let i = 0; i < baseline.T.length; i++) {
        maxDiff = Math.max(maxDiff, Math.abs(baseline.T[i] - perturbed.T[i]));
    }
    ok(maxDiff < 0.01, `thin 0.5 nm interlayer: |ΔT| max = ${maxDiff.toFixed(5)} < 0.01`);
}

// ── 14) Thick interlayer significantly perturbs the spectrum ───────────────
{
    const layers = [
        { material: matB, thickness: 95 },
        { material: matA, thickness: 137 },
        { material: matB, thickness: 95 },
        { material: matA, thickness: 137 },
    ];
    const params = { lambdaStart: 500, lambdaEnd: 600, lambdaStep: 25, theta: 0, polarization: 'avg' };
    const baseline = evaluateSpectrum(params, matAir, matSub, layers);

    const interlayers = [
        { afterIndex: 0, thickness: 30, profile: 'linear', slices: 20, enabled: true },
        { afterIndex: 1, thickness: 30, profile: 'linear', slices: 20, enabled: true },
        { afterIndex: 2, thickness: 30, profile: 'linear', slices: 20, enabled: true },
    ];
    const expanded = expandLayersWithInterlayers(layers, matAir, matSub, interlayers);
    const perturbed = evaluateSpectrum(params, matAir, matSub, expanded);

    let maxDiff = 0;
    for (let i = 0; i < baseline.T.length; i++) {
        maxDiff = Math.max(maxDiff, Math.abs(baseline.T[i] - perturbed.T[i]));
    }
    ok(maxDiff > 0.05, `thick 3×30 nm interlayers: |ΔT| max = ${maxDiff.toFixed(4)} > 0.05`);
}

// ── 15) Convergence: more slices → output converges ────────────────────────
{
    const layers = [
        { material: matB, thickness: 100 },
        { material: matA, thickness: 100 },
    ];
    const params = { lambdaStart: 550, lambdaEnd: 550, lambdaStep: 1, theta: 0, polarization: 'avg' };
    const mkSpec = (N) => {
        const interlayers = [{ afterIndex: 0, thickness: 20, profile: 'linear', slices: N, enabled: true }];
        const expanded = expandLayersWithInterlayers(layers, matAir, matSub, interlayers);
        return evaluateSpectrum(params, matAir, matSub, expanded).T[0];
    };
    const T5   = mkSpec(5);
    const T20  = mkSpec(20);
    const T100 = mkSpec(100);
    // |T5 - T100| > |T20 - T100| — finer grid converges to the same limit
    const e5  = Math.abs(T5  - T100);
    const e20 = Math.abs(T20 - T100);
    ok(e20 <= e5,
        `convergence: 20 slices closer to 100 than 5 (|T5-T100|=${e5.toExponential(2)}, |T20-T100|=${e20.toExponential(2)})`);
}

// ── 16) enumerateInterfaces gives N+1 entries with correct labels ─────────
{
    const layers = [
        { material: matB, thickness: 1 },
        { material: matA, thickness: 1 },
        { material: matB, thickness: 1 },
    ];
    const ifaces = enumerateInterfaces(layers, 'Air', 'Sub');
    ok(ifaces.length === 4, `enumerateInterfaces: N+1=4 entries (got ${ifaces.length})`);
    ok(ifaces[0].label === 'Air → L1', 'first label is medium → L1');
    ok(ifaces[1].label === 'L1 → L2',  'second label is L1 → L2');
    ok(ifaces[3].label === 'L3 → Sub', 'last label is L3 → medium');
    ok(ifaces[0].afterIndex === -1, 'first afterIndex = -1');
    ok(ifaces[3].afterIndex === 2,  'last afterIndex = N-1 = 2');
}

// ── 17) totalInterlayerThickness sums only enabled, positive entries ───────
{
    const inh = {
        interlayers: [
            { afterIndex: 0, thickness: 5,  enabled: true },
            { afterIndex: 1, thickness: 3,  enabled: false },  // disabled — skip
            { afterIndex: 2, thickness: 2,  enabled: true },
            { afterIndex: 3, thickness: -1, enabled: true },   // invalid — skip
        ],
    };
    ok(totalInterlayerThickness(inh) === 7, 'totalInterlayerThickness sums enabled & positive');
    ok(totalInterlayerThickness(null) === 0, 'totalInterlayerThickness handles null');
}

// ── 18) cloneInhomogeneity is a deep copy ──────────────────────────────────
{
    const inh = { interlayers: [{ afterIndex: 0, thickness: 5, profile: 'linear', slices: 10, enabled: true }] };
    const copy = cloneInhomogeneity(inh);
    copy.interlayers[0].thickness = 999;
    ok(inh.interlayers[0].thickness === 5, 'cloneInhomogeneity: independent of source');
    ok(copy.interlayers[0].thickness === 999, 'cloneInhomogeneity: copy mutates independently');
    const e = cloneInhomogeneity(null);
    ok(Array.isArray(e.interlayers) && e.interlayers.length === 0, 'cloneInhomogeneity(null) → empty');
}

// ── Summary ────────────────────────────────────────────────────────────────
if (fails === 0) {
    console.log('All inhomogeneity tests passed.');
    process.exit(0);
} else {
    console.error(`${fails} test(s) failed.`);
    process.exit(1);
}
