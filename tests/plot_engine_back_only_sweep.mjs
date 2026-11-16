/**
 * On a design coated on its back alone (surface mode back_only), every Plot
 * Engine layer sweep is a back layer, for every quantity: the menu, the axis
 * titles and the computation name and move the same layer. Before, the menu
 * listed front layers, the MF moved the back layer with the same index, and
 * every other quantity moved a front layer the back spectrum does not see.
 *
 *   1. The menus list the back layers, B1 on the substrate first, by
 *      material; front layers left in the design are not offered.
 *   2. An MF curve along B1 moves B1 and nothing else: it equals the merit of
 *      the design with that back layer set, and a front layer left in the
 *      design changes nothing.
 *   3. T read on the back side moves with B1, along a curve and over a
 *      surface, and equals the back spectrum of the design with B1 set.
 *   4. Ψ (a point surface) and GD (a curve) move with B1 as well.
 *   5. A front-coated design is unchanged: the menu lists L1 first and a
 *      sweep moves the front layer.
 *
 * Run: node tests/plot_engine_back_only_sweep.mjs
 */
import assert from 'node:assert/strict';
import { initWasmForTest } from './_wasmInit.mjs';
import {
    buildAxisTargetOptions, buildAxisVarOptions, computeSurface, layerSymbol, sweptSide,
} from '../src/utils/physics/plotQuantities.js';
import { computeMeritCurve } from '../src/utils/physics/plotQuantities/meritSurface.js';
import { buildEvalContext, evaluateOperands, calcMF } from '../src/utils/physics/optimizer.js';
import { evaluateSpectrumBack, evaluateSpectrum } from '../src/utils/physics/thinFilmMath.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

await initWasmForTest();
const resolveMat = id => getMaterial(id);
const layer = (material, thickness) => ({ id: `${material}${thickness}`, material, thickness, locked: false });
const rows = [{ id: 'r1', type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1, enabled: true, aoi: 0, pol: 'avg' }];
const back = [layer('MgF2', 100), layer('Ta2O5', 30), layer('SiO2', 20)];
const base = {
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'back_only', mfEvalMode: 'side', meritOperands: rows,
};
const design = { ...base, frontLayers: [layer('TiO2', 50), layer('SiO2', 90)], backLayers: back };
const withB1 = (d, thickness) => ({ ...d, backLayers: [{ ...d.backLayers[0], thickness }, ...d.backLayers.slice(1)] });
const close = (a, b, what) => assert.ok(Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)), `${what}: ${a} against ${b}`);

// ── 1. The menus ─────────────────────────────────────────────────────────────
{
    assert.equal(sweptSide(design), 'back');
    const menu = buildAxisTargetOptions(design, false);
    assert.deepEqual(menu.map(o => o.value), ['thk:0', 'thk:1', 'thk:2'], 'the three back layers');
    assert.deepEqual(menu.map(o => o.label), ['B1 (MgF2)', 'B2 (Ta2O5)', 'B3 (SiO2)'], 'B1 on the substrate first, by material');
    assert.equal(layerSymbol(design, 0), 'B1');
    assert.equal(buildAxisVarOptions(design, true).find(o => o.value === 'thk:0').label, 'B1 (MgF2) d (nm)', 'the axis title names the same layer');
    assert.deepEqual(buildAxisTargetOptions({ ...design, frontLayers: [] }, false).map(o => o.label), menu.map(o => o.label),
        'a back-only design with no front layers offers its back layers');
}

// ── 2. MF along B1 ───────────────────────────────────────────────────────────
{
    const values = [10, 60, 110];
    const curve = computeMeritCurve('thk:0', values, design, resolveMat);
    assert.ok(curve.ok);
    values.forEach((value, i) => {
        const ctx = buildEvalContext(withB1(design, value), resolveMat);
        close(curve.mf[i], calcMF(rows, evaluateOperands(rows, ctx)), `MF with B1 at ${value} nm`);
    });
    const noFront = computeMeritCurve('thk:0', values, { ...design, frontLayers: [] }, resolveMat);
    assert.deepEqual(noFront.mf, curve.mf, 'the front layers left in a back-only design change nothing');
}

// ── 3. T on the back side along B1 ───────────────────────────────────────────
const backT = (d, theta = 0) => evaluateSpectrumBack({ lambdaStart: 550, lambdaEnd: 550, lambdaStep: 1, theta, polarization: 'avg' },
    resolveMat('Air'), resolveMat('BK7'), d.backLayers.map(l => ({ material: resolveMat(l.material), thickness: l.thickness }))).T[0];
{
    const spec = {
        z: 'T', polarization: 'avg', surfaceMode: 'back', fixedLambda_nm: 550, fixedAOI_deg: 0,
        xVar: 'thk:0', xFrom: 50, xTo: 150, xSteps: 3, yVar: 'aoi', yFrom: 0, yTo: 30, ySteps: 2,
    };
    const map = computeSurface(spec, design, resolveMat);
    assert.ok(map.ok);
    assert.deepEqual(map.x, [50, 100, 150]);
    map.x.forEach((value, i) => close(map.z[0][i], backT(withB1(design, value)), `T at B1 ${value} nm, 0°`));
    map.x.forEach((value, i) => close(map.z[1][i], backT(withB1(design, value), 30), `T at B1 ${value} nm, 30°`));
    assert.ok(Math.abs(map.z[0][0] - map.z[0][2]) > 1e-4, 'T moves with B1');

    const lambdaRows = computeSurface({ ...spec, xVar: 'wavelength', xFrom: 540, xTo: 560, xSteps: 3, yVar: 'thk:0', yFrom: 50, yTo: 150, ySteps: 2 }, design, resolveMat);
    assert.ok(lambdaRows.ok);
    close(lambdaRows.z[1][1], backT(withB1(design, 150)), 'the batched wavelength row moves B1 too');
}

// ── 4. A point surface and a phase quantity ──────────────────────────────────
{
    const psiSpec = {
        z: 'psi', polarization: 'avg', surfaceMode: 'back', fixedLambda_nm: 550, fixedAOI_deg: 60,
        xVar: 'thk:0', xFrom: 50, xTo: 150, xSteps: 2, yVar: 'aoi', yFrom: 60, yTo: 70, ySteps: 2,
    };
    const psi = computeSurface(psiSpec, design, resolveMat);
    assert.ok(psi.ok && Number.isFinite(psi.z[0][0]) && Math.abs(psi.z[0][0] - psi.z[0][1]) > 1e-6, 'Ψ moves with B1');
    const gd = computeSurface({ ...psiSpec, z: 'gdR', fixedAOI_deg: 0, yFrom: 0, yTo: 10 }, design, resolveMat);
    assert.ok(gd.ok && Math.abs(gd.z[0][0] - gd.z[0][1]) > 1e-9, 'GD moves with B1');
}

// ── 5. A front-coated design is as it was ────────────────────────────────────
{
    const front = { ...base, surfaceMode: 'front_only', frontLayers: [layer('TiO2', 50), layer('SiO2', 90)], backLayers: [] };
    assert.deepEqual(buildAxisTargetOptions(front, false).map(o => o.label), ['L1 (SiO2)', 'L2 (TiO2)'], 'L1 on the substrate first');
    const spec = {
        z: 'T', polarization: 'avg', surfaceMode: 'front', fixedLambda_nm: 550, fixedAOI_deg: 0,
        xVar: 'thk:0', xFrom: 40, xTo: 60, xSteps: 2, yVar: 'aoi', yFrom: 0, yTo: 10, ySteps: 2,
    };
    const map = computeSurface(spec, front, resolveMat);
    const frontT = thickness => evaluateSpectrum({ lambdaStart: 550, lambdaEnd: 550, lambdaStep: 1, theta: 0, polarization: 'avg' },
        resolveMat('Air'), resolveMat('BK7'), [{ material: resolveMat('TiO2'), thickness }, { material: resolveMat('SiO2'), thickness: 90 }]).T[0];
    close(map.z[0][0], frontT(40), 'T with front layer 0 at 40 nm');
    close(map.z[0][1], frontT(60), 'T with front layer 0 at 60 nm');
}

console.log('PASS plot_engine_back_only_sweep');
