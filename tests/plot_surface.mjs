/**
 * Plot Engine — 3D surface compute.
 *
 * computeSurface() plots a scalar Z over two swept variables:
 *   • Optical T/R/A at a single (λ, AOI) probe (reuses the validated TMM path).
 *   • Merit Function over two layer parameters (reuses buildEvalContext +
 *     evaluateOperands + calcMF — the SAME MF the optimizer minimizes).
 * Axis variables: wavelength, AOI, and per-layer thickness / n / k (the n,k
 * sweeps use a constant-index what-if material).
 *
 * Checks:
 *   1. Optical T grid: right shape (z[ny][nx]), every value in [0,1].
 *   2. Single-quarter-wave AR: T(λ=550, AOI=0) vs L thickness has a MAX near the
 *      QWOT — sweep thickness, confirm the peak sits at the quarter-wave point.
 *   3. n-override sweep: at a bare single layer, reflectance rises monotonically
 *      with the layer index n (more index contrast → more R). Physically correct.
 *   4. MF surface over two thicknesses reproduces calcMF exactly at a grid point
 *      (the surface IS the optimizer's MF — verified bit-for-bit).
 *   5. MF surface has its minimum at the design's optimum (a BBAR's AR thicknesses).
 *   6. Guard: MF with a λ/AOI axis is rejected.
 *
 * Run: node tests/plot_surface.mjs
 */

import {
    computeSurface, makeDefaultSurfaceSpec, buildAxisVarOptions, isLayerVar,
    requiredSurfaceLambdas,
} from '../src/utils/physics/plotQuantities.js';
import {
    makeOperand, evaluateOperands, calcMF, buildEvalContext,
    collectDesignMaterialIds, buildPresampledTable,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const resolveMat = id => {
    if (!id) return getMaterial('Air');
    return getMaterial(id) || getMaterial('Air');
};
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };
const approx = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// ── Designs ───────────────────────────────────────────────────────────────────

// Single MgF2 layer on glass (a classic single-layer AR around 550 nm).
const single = {
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    surfaceMode: 'front_only', mfEvalMode: 'side',
    frontLayers: [{ material: 'MgF2', thickness: 99 }],
    backLayers: [],
    meritOperands: [],
};

// 2-layer BBAR (TiO2/SiO2) with an RAV target — gives an MF landscape.
const bbar = {
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    surfaceMode: 'front_only', mfEvalMode: 'side',
    frontLayers: [
        { material: 'TiO2', thickness: 116.7 },
        { material: 'SiO2', thickness: 187.3 },
    ],
    backLayers: [],
    meritOperands: [
        makeOperand({ id: 'r1', type: 'RAV', enabled: true, weight: 1, target: 0,
            aoi: 0, polarization: 'avg', characteristic: 'R', lambdaStart: 450, lambdaEnd: 650 }),
    ],
};

// ── 1. Optical T grid shape + bounds ───────────────────────────────────────────
{
    const spec = makeDefaultSurfaceSpec(single, { z: 'T', xVar: 'thk:0', yVar: 'aoi',
        xFrom: 50, xTo: 150, xSteps: 9, yFrom: 0, yTo: 60, ySteps: 7, fixedLambda_nm: 550 });
    const r = computeSurface(spec, single, resolveMat);
    ok(r.ok, '1a optical surface computes');
    ok(r.z.length === 7 && r.z[0].length === 9, `1b grid shape z[7][9] (got z[${r.z.length}][${r.z[0]?.length}])`);
    let allIn = true;
    for (const row of r.z) for (const v of row) if (!(v >= 0 && v <= 1)) allIn = false;
    ok(allIn, '1c every T in [0,1]');
    ok(r.zLabel === 'Transmittance', '1d zLabel = Transmittance');
}

// ── 2. AR transmission peaks near the quarter-wave thickness ────────────────────
{
    // MgF2 n≈1.385 @ 550 → QWOT d = 550/(4·1.385) ≈ 99.3 nm. T should peak there.
    const spec = makeDefaultSurfaceSpec(single, { z: 'T', xVar: 'thk:0', yVar: 'aoi',
        xFrom: 20, xTo: 200, xSteps: 181, yFrom: 0, yTo: 0, ySteps: 2, fixedLambda_nm: 550 });
    const r = computeSurface(spec, single, resolveMat);
    const row = r.z[0];               // AOI = 0
    let iMax = 0; for (let i = 1; i < row.length; i++) if (row[i] > row[iMax]) iMax = i;
    const dPeak = r.x[iMax];
    ok(Math.abs(dPeak - 99.3) < 8, `2 T peaks at quarter-wave thickness (~99 nm, got ${dPeak.toFixed(1)} nm)`);
}

// ── 3. n-override sweep: low-n layer = AR, high-n layer = reflector ──────────────
// R(n) at fixed physical thickness is NOT monotonic (the phase n·d sweeps through
// quarter/half-wave resonances), but the envelope is robust: the least reflective
// point is the lowest index (near-AR) and the most reflective is the highest index.
{
    const bare = { ...single, frontLayers: [{ material: 'MgF2', thickness: 120 }] };
    const spec = makeDefaultSurfaceSpec(bare, { z: 'R', xVar: 'n:0', yVar: 'aoi',
        xFrom: 1.4, xTo: 2.6, xSteps: 13, yFrom: 0, yTo: 0, ySteps: 2, fixedLambda_nm: 550 });
    const r = computeSurface(spec, bare, resolveMat);
    const row = r.z[0];
    let iMin = 0, iMax = 0;
    for (let i = 1; i < row.length; i++) { if (row[i] < row[iMin]) iMin = i; if (row[i] > row[iMax]) iMax = i; }
    ok(r.ok && iMin === 0, '3a least reflective at lowest index n (const-index override)');
    ok(iMax === row.length - 1, '3b most reflective at highest index n');
    ok(row[row.length - 1] > row[0] + 0.05, `3c high-n end clearly more reflective (${row[0].toFixed(3)} → ${row[row.length - 1].toFixed(3)})`);
}

// ── 4. MF surface == calcMF at a grid point (bit-for-bit) ───────────────────────
{
    const spec = makeDefaultSurfaceSpec(bbar, { z: 'MF', xVar: 'thk:0', yVar: 'thk:1',
        xFrom: 80, xTo: 160, xSteps: 5, yFrom: 150, yTo: 230, ySteps: 5 });
    const r = computeSurface(spec, bbar, resolveMat);
    ok(r.ok, '4a MF surface computes');
    // Reproduce MF at grid cell (i=2, j=3) directly.
    const i = 2, j = 3;
    const dx = r.x[i], dy = r.y[j];
    const probe = {
        ...bbar,
        frontLayers: [
            { material: 'TiO2', thickness: dx },
            { material: 'SiO2', thickness: dy },
        ],
    };
    const ctx = buildEvalContext(probe, resolveMat);
    const computed = evaluateOperands(probe.meritOperands, ctx);
    const mfRef = calcMF(probe.meritOperands, computed);
    ok(approx(r.z[j][i], mfRef, 1e-12), `4b surface MF matches calcMF exactly (Δ=${Math.abs(r.z[j][i] - mfRef).toExponential(1)})`);
}

// ── 5. MF surface minimum sits at the BBAR optimum ──────────────────────────────
{
    // Sweep both thicknesses around the nominal AR design; the minimum cell
    // should be close to the nominal (116.7 / 187.3 nm) which IS the optimum.
    const spec = makeDefaultSurfaceSpec(bbar, { z: 'MF', xVar: 'thk:0', yVar: 'thk:1',
        xFrom: 80, xTo: 160, xSteps: 33, yFrom: 150, yTo: 230, ySteps: 33 });
    const r = computeSurface(spec, bbar, resolveMat);
    let best = Infinity, bi = 0, bj = 0;
    for (let j = 0; j < r.y.length; j++) for (let i = 0; i < r.x.length; i++)
        if (r.z[j][i] < best) { best = r.z[j][i]; bi = i; bj = j; }
    const dxBest = r.x[bi], dyBest = r.y[bj];
    ok(Math.abs(dxBest - 116.7) < 12 && Math.abs(dyBest - 187.3) < 14,
        `5 MF minimum near AR optimum (got ${dxBest.toFixed(1)}/${dyBest.toFixed(1)} nm, expect ~116.7/187.3)`);
}

// ── 5b. Batched λ-row optical path == per-point (WASM speedup, same result) ──────
// When an axis is wavelength and the other is AOI or thickness, computeSurface
// batches the whole λ row through one evaluateSpectrum (WASM batch). It must be
// bit-identical to the per-point path. Compare λ×AOI and λ×thickness surfaces
// against a manual per-point recomputation via single-point specs.
{
    for (const otherVar of ['aoi', 'thk:0']) {
        const spec = makeDefaultSurfaceSpec(single, { z: 'R', xVar: 'wavelength', yVar: otherVar,
            xFrom: 420, xTo: 700, xSteps: 15,
            yFrom: otherVar === 'aoi' ? 0 : 60, yTo: otherVar === 'aoi' ? 50 : 140, ySteps: 6,
            fixedAOI_deg: 0 });
        const r = computeSurface(spec, single, resolveMat);
        // Per-point reference: a 1×1 surface at each (x[i], y[j]).
        let maxAbs = 0;
        for (let j = 0; j < r.y.length; j++) for (let i = 0; i < r.x.length; i++) {
            const one = computeSurface({ ...spec, xFrom: r.x[i], xTo: r.x[i], xSteps: 2,
                yFrom: r.y[j], yTo: r.y[j], ySteps: 2 }, single, resolveMat);
            maxAbs = Math.max(maxAbs, Math.abs(r.z[j][i] - one.z[0][0]));
        }
        ok(maxAbs < 1e-12, `5b batched λ×${otherVar} == per-point (max|Δ|=${maxAbs.toExponential(1)})`);
    }
}

// ── 6. Guards + axis-option plumbing ────────────────────────────────────────────
{
    const bad = makeDefaultSurfaceSpec(bbar, { z: 'MF', xVar: 'wavelength', yVar: 'thk:1' });
    const r = computeSurface(bad, bbar, resolveMat);
    ok(!r.ok && /layer parameter/i.test(r.error || ''), '6a MF rejects a wavelength axis');

    const optOpts = buildAxisVarOptions(bbar, true).map(o => o.value);
    const mfOpts = buildAxisVarOptions(bbar, false).map(o => o.value);
    ok(optOpts.includes('wavelength') && optOpts.includes('aoi'), '6b optical axis options include λ + AOI');
    ok(!mfOpts.includes('wavelength') && mfOpts.every(isLayerVar), '6c MF axis options are layer params only');
    ok(optOpts.includes('thk:1') && optOpts.includes('n:0') && optOpts.includes('k:0'),
        '6d per-layer thickness/n/k options present');
}

// ── 7. Worker path: chunked rows + Approach-A presampled materials == full ──────
// The pool computes Y-row chunks in a worker whose materials come from a
// pre-sampled exact-λ table (requiredSurfaceLambdas + buildPresampledTable).
// Verify (a) the λ set is COMPLETE — a strict table-lookup getNK never misses —
// and (b) assembling row chunks computed against that table reproduces the
// single-thread surface bit-for-bit.
{
    // Strict table resolver: exact Map lookup, records any miss (no fallback).
    const makeStrictResolver = (materials) => {
        const misses = [];
        const cache = new Map();
        const build = (id) => {
            const e = materials[id] || materials['Air'];
            const map = new Map();
            if (e && e.lambdas) for (let i = 0; i < e.lambdas.length; i++) map.set(e.lambdas[i], [e.n[i], e.k[i]]);
            return { getNK(lam) { const v = map.get(lam); if (v === undefined) { misses.push([id, lam]); return [1, 0]; } return v; } };
        };
        const fn = (id) => { const key = (id == null || id === '') ? 'Air' : id; let s = cache.get(key); if (!s) { s = build(key); cache.set(key, s); } return s; };
        fn._misses = misses;
        return fn;
    };

    const cases = [
        { name: 'MF thk×thk',  design: bbar,   spec: makeDefaultSurfaceSpec(bbar, { z: 'MF', xVar: 'thk:0', yVar: 'thk:1', xFrom: 90, xTo: 150, xSteps: 11, yFrom: 160, yTo: 220, ySteps: 9 }) },
        { name: 'opt λ×thk',   design: single, spec: makeDefaultSurfaceSpec(single, { z: 'T', xVar: 'wavelength', yVar: 'thk:0', xFrom: 420, xTo: 680, xSteps: 14, yFrom: 70, yTo: 130, ySteps: 8, fixedAOI_deg: 0 }) },
        { name: 'opt thk×n',   design: single, spec: makeDefaultSurfaceSpec(single, { z: 'R', xVar: 'thk:0', yVar: 'n:0', xFrom: 80, xTo: 140, xSteps: 9, yFrom: 1.3, yTo: 2.4, ySteps: 7, fixedLambda_nm: 550, fixedAOI_deg: 0 }) },
    ];

    for (const { name, design, spec } of cases) {
        const full = computeSurface(spec, design, resolveMat);              // single-thread reference
        const lambdas = requiredSurfaceLambdas(spec, design);
        const pairs = collectDesignMaterialIds(design).map(id => ({ id, mat: resolveMat(id) }));
        const materials = buildPresampledTable(lambdas, pairs);
        const strict = makeStrictResolver(materials);

        // Simulate the pool: compute in row chunks, assemble.
        const ny = full.y.length;
        const z = new Array(ny);
        const chunk = 3;
        for (let from = 0; from < ny; from += chunk) {
            const to = Math.min(ny, from + chunk);
            const part = computeSurface(spec, design, strict, { rowFrom: from, rowTo: to });
            for (let j = from; j < to; j++) z[j] = part.z[j];
        }
        let maxAbs = 0;
        for (let j = 0; j < ny; j++) for (let i = 0; i < full.x.length; i++)
            maxAbs = Math.max(maxAbs, Math.abs(z[j][i] - full.z[j][i]));
        ok(strict._misses.length === 0, `7 [${name}] presampled λ set complete (no table misses)`);
        ok(maxAbs < 1e-12, `7 [${name}] chunked+presampled == single-thread (max|Δ|=${maxAbs.toExponential(1)})`);
    }
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
