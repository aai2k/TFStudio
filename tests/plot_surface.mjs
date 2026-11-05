/**
 * Plot Engine — 3D surface compute.
 *
 * computeSurface() plots a scalar Z over two swept variables:
 *   • Optical T/R/A at a single (λ, AOI) probe (reuses the validated TMM path).
 *   • Merit Function over two layer parameters (reuses buildEvalContext +
 *     evaluateOperands + calcMF — the SAME MF the optimizer minimizes).
 * Axis variables: wavelength, AOI, and per-layer thickness.
 *
 * Checks:
 *   1. Optical T grid: right shape (z[ny][nx]), every value in [0,1].
 *   2. Single-quarter-wave AR: T(λ=550, AOI=0) vs L thickness has a MAX near the
 *      QWOT — sweep thickness, confirm the peak sits at the quarter-wave point.
 *   3. MF surface over two thicknesses reproduces calcMF exactly at a grid point
 *      (the surface IS the optimizer's MF — verified bit-for-bit).
 *   4. MF surface has its minimum at the design's optimum (a BBAR's AR thicknesses).
 *   5. Guard: MF with a λ/AOI axis is rejected; the axis options are λ, AOI and
 *      layer thicknesses, with no n or k.
 *
 * Run: node tests/plot_surface.mjs
 */

import './_kernel.mjs';
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
    ok(r.z.flat().every(v => v >= 0 && v <= 1), '1c every T in [0,1]');
    ok(r.zKey === 'T', '1d zKey = T');
}

// ── 2. AR transmission peaks near the quarter-wave thickness ────────────────────
{
    // MgF2 n≈1.385 @ 550 → QWOT d = 550/(4·1.385) ≈ 99.3 nm. T should peak there.
    const spec = makeDefaultSurfaceSpec(single, { z: 'T', xVar: 'thk:0', yVar: 'aoi',
        xFrom: 20, xTo: 200, xSteps: 181, yFrom: 0, yTo: 0, ySteps: 2, fixedLambda_nm: 550 });
    const r = computeSurface(spec, single, resolveMat);
    const row = r.z[0];               // AOI = 0
    const dPeak = r.x[row.indexOf(Math.max(...row))];
    ok(Math.abs(dPeak - 99.3) < 8, `2 T peaks at quarter-wave thickness (~99 nm, got ${dPeak.toFixed(1)} nm)`);
}

// ── 3. MF surface == calcMF at a grid point (bit-for-bit) ───────────────────────
{
    const spec = makeDefaultSurfaceSpec(bbar, { z: 'MF', xVar: 'thk:0', yVar: 'thk:1',
        xFrom: 80, xTo: 160, xSteps: 5, yFrom: 150, yTo: 230, ySteps: 5 });
    const r = computeSurface(spec, bbar, resolveMat);
    ok(r.ok, '3a MF surface computes');
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
    ok(approx(r.z[j][i], mfRef, 1e-12), `3b surface MF matches calcMF exactly (Δ=${Math.abs(r.z[j][i] - mfRef).toExponential(1)})`);
}

// ── 4. MF surface minimum sits at the BBAR optimum ──────────────────────────────
{
    // Sweep both thicknesses around the nominal AR design; the minimum cell
    // should be close to the nominal (116.7 / 187.3 nm) which IS the optimum.
    const spec = makeDefaultSurfaceSpec(bbar, { z: 'MF', xVar: 'thk:0', yVar: 'thk:1',
        xFrom: 80, xTo: 160, xSteps: 33, yFrom: 150, yTo: 230, ySteps: 33 });
    const r = computeSurface(spec, bbar, resolveMat);
    const cells = r.z.flatMap((row, j) => row.map((value, i) => ({ value, i, j })));
    const best = cells.reduce((a, b) => (b.value < a.value ? b : a));
    const dxBest = r.x[best.i], dyBest = r.y[best.j];
    ok(Math.abs(dxBest - 116.7) < 12 && Math.abs(dyBest - 187.3) < 14,
        `4 MF minimum near AR optimum (got ${dxBest.toFixed(1)}/${dyBest.toFixed(1)} nm, expect ~116.7/187.3)`);
}

// ── 4b. Batched λ-row optical path == per-point (WASM speedup, same result) ──────
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
        ok(maxAbs < 1e-12, `4b batched λ×${otherVar} == per-point (max|Δ|=${maxAbs.toExponential(1)})`);
    }
}

// ── 5. Guards + axis-option plumbing ────────────────────────────────────────────
{
    const bad = makeDefaultSurfaceSpec(bbar, { z: 'MF', xVar: 'wavelength', yVar: 'thk:1' });
    const r = computeSurface(bad, bbar, resolveMat);
    ok(!r.ok && r.errorKey === 'errMfAxes', '5a MF rejects a wavelength axis');

    const optOpts = buildAxisVarOptions(bbar, true).map(o => o.value);
    const mfOpts = buildAxisVarOptions(bbar, false).map(o => o.value);
    ok(optOpts.includes('wavelength') && optOpts.includes('aoi'), '5b optical axis options include λ + AOI');
    ok(!mfOpts.includes('wavelength') && mfOpts.every(isLayerVar), '5c MF axis options are layer params only');
    ok(optOpts.includes('thk:1') && !optOpts.some(value => /^[nk]:/.test(value)),
        '5d per-layer thickness options present, no n or k');
}

// ── 6. Worker path: chunked rows + Approach-A presampled materials == full ──────
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
        { name: 'opt thk×AOI', design: single, spec: makeDefaultSurfaceSpec(single, { z: 'R', xVar: 'thk:0', yVar: 'aoi', xFrom: 80, xTo: 140, xSteps: 9, yFrom: 0, yTo: 60, ySteps: 7, fixedLambda_nm: 550 }) },
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
        const maxAbs = Math.max(...full.z.flatMap((row, j) => row.map((v, i) => Math.abs(z[j][i] - v))));
        ok(strict._misses.length === 0, `6 [${name}] presampled λ set complete (no table misses)`);
        ok(maxAbs < 1e-12, `6 [${name}] chunked+presampled == single-thread (max|Δ|=${maxAbs.toExponential(1)})`);
    }
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
