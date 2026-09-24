/**
 * Band sample counts follow the coating's fringe spacing.
 *
 * A band average, integral or range target sampled on a grid coarser than the
 * coating's fringes lets the optimizer park fringes between samples, so the
 * merit it reports is not the band's true average. The grid now comes from the
 * design: step = λ²/(2G)/SAMPLES_PER_FRINGE at the band's short end, G the group
 * optical thickness, with no upper limit.
 *
 * Checks:
 *   1. The 80-layer, 9.4 µm TiO2/SiO2 stack refined for 60 LM steps on its
 *      fringe grid: sampled and dense (6001-point) band averages agree to 0.1
 *      points. On the old 201-point grid they differ by 1.6 points.
 *   2. A thin 4-layer AR gets a small grid, below the design-free 151 points.
 *   3. The count grows with the coating and has no ceiling; the group index,
 *      not the phase index, sets it; a full-system merit adds both faces.
 *   4. An operand's own count is raised when the fringes need more and kept
 *      otherwise; a second application changes nothing.
 *   5. s and p kernel results are bit-identical at normal incidence (the
 *      premise of the shared s/p cache entry there), and a polarization
 *      average there equals the single-polarization value exactly.
 *   6. On a thin coating's small grid the band average is still within 0.1
 *      points of a dense one (trapezoid rule, not a plain mean of the samples).
 *
 * Run: node tests/band_sampling_fringe.mjs
 */

import {
    makeOperand, buildEvalContext, operandSampleLambdas, bandSampleCount,
    fringeSampleCount, groupThicknessAt, withFringeSampleCounts, DLSOptimizer,
    evaluateOperands, tmmJacEval,
} from '../src/utils/physics/optimizer.js';
import { tmmOne } from '../src/utils/physics/optimizer/evalCore/kernels.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { initWasmForTest } from './_wasmInit.mjs';

const resolveMat = id => getMaterial(id);
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };

const media = {
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1 },
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
};

// The numerics-review stack: 80 alternating TiO2/SiO2 layers, 60-180 nm each
// from a fixed Lehmer sequence, 9.39 µm in total.
function broadband80() {
    let s = 12345;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const frontLayers = [];
    for (let i = 0; i < 80; i++) {
        frontLayers.push({ id: 'L' + i, material: i % 2 ? 'SiO2' : 'TiO2', thickness: 60 + 120 * rnd(), locked: false });
    }
    return { ...media, frontLayers };
}

const thinAR = {
    ...media,
    frontLayers: [
        { id: 'a', material: 'TiO2', thickness: 80,  locked: false },
        { id: 'b', material: 'SiO2', thickness: 140, locked: false },
        { id: 'c', material: 'TiO2', thickness: 60,  locked: false },
        { id: 'd', material: 'SiO2', thickness: 120, locked: false },
    ],
};

console.log('WASM:', await initWasmForTest());

// ── 1. Sampled and dense averages agree after 60 LM steps ────────────────────
{
    const design = broadband80();
    const op = makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 1600, aoi: 0, pol: 'avg', target: 1, weight: 1 });
    const [sampled] = withFringeSampleCounts([op], buildEvalContext(design, resolveMat));
    const n = operandSampleLambdas(sampled).length;
    const engine = new DLSOptimizer([sampled], design, resolveMat, { dMin: 5 });
    const dense = new DLSOptimizer([{ ...op, bandPoints: 6001 }], design, resolveMat, { dMin: 5 });
    for (let i = 0; i < 60; i++) engine.step();
    const sampledAvg = 1 - engine.mf;
    const denseAvg = 1 - dense.mfAt(engine.thicknesses);
    const gapPoints = Math.abs(sampledAvg - denseAvg) * 100;
    ok(gapPoints < 0.1,
        `80-layer TAV(400-1600) on ${n} samples: sampled ${(sampledAvg * 100).toFixed(2)} %, dense ${(denseAvg * 100).toFixed(2)} % after 60 LM steps (gap ${gapPoints.toFixed(3)} points < 0.1)`);
}

// ── 2. A thin AR gets a small grid ───────────────────────────────────────────
{
    const op = makeOperand({ type: 'RAV', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, weight: 1 });
    const [out] = withFringeSampleCounts([op], buildEvalContext(thinAR, resolveMat));
    const n = operandSampleLambdas(out).length;
    ok(n < bandSampleCount(op) / 4,
        `4-layer AR RAV(400-700): ${n} samples, under a quarter of the design-free ${bandSampleCount(op)}`);
}

// ── 3. Count grows with the coating, no ceiling, group index, both faces ─────
{
    const op = makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 1600, aoi: 0, pol: 'avg', target: 1, weight: 1 });
    const design = broadband80();
    const [thick] = withFringeSampleCounts([op], buildEvalContext(design, resolveMat));
    ok(thick.bandPoints > 2000, `80-layer stack over 400-1600 nm gets ${thick.bandPoints} samples, far above the old 201`);

    const doubled = { ...design, frontLayers: design.frontLayers.map(l => ({ ...l, thickness: 2 * l.thickness })) };
    const [twice] = withFringeSampleCounts([op], buildEvalContext(doubled, resolveMat));
    const ratio = (twice.bandPoints - 1) / (thick.bandPoints - 1);
    ok(Math.abs(ratio - 2) < 0.01, `doubling every layer doubles the step count (ratio ${ratio.toFixed(4)})`);

    const ctx = buildEvalContext(design, resolveMat);
    const g = groupThicknessAt(ctx, 400);
    let phaseOT = 0;
    for (const l of design.frontLayers) phaseOT += l.thickness * getMaterial(l.material).getNK(400)[0];
    ok(g > 1.3 * phaseOT, `group optical thickness at 400 nm (${g.toFixed(0)} nm) exceeds the phase one (${phaseOT.toFixed(0)} nm): titania is strongly dispersive there`);
    ok(fringeSampleCount(op, g) > fringeSampleCount(op, phaseOT), 'the group index asks for more samples than the phase index');

    const symmetric = { ...design, surfaceMode: 'symmetric' };
    const gSym = groupThicknessAt(buildEvalContext(symmetric, resolveMat), 400);
    ok(Math.abs(gSym - 2 * g) < 1e-9 * g, `a symmetric (both faces coated) merit counts both coatings (${gSym.toFixed(0)} = 2 × ${g.toFixed(0)} nm)`);
    const sideOnly = { ...design, backLayers: design.frontLayers.slice(0, 10) };
    ok(groupThicknessAt(buildEvalContext(sideOnly, resolveMat), 400) === g,
        'a front-only side merit ignores a back coating it does not evaluate');
}

// ── 4. Own counts: raised when too coarse, kept otherwise; idempotent ────────
{
    const design = broadband80();
    const ctx = buildEvalContext(design, resolveMat);
    const coarse = makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 1600, aoi: 0, pol: 'avg', target: 1, weight: 1, bandPoints: 201 });
    const fine   = makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 1600, aoi: 0, pol: 'avg', target: 1, weight: 1, bandPoints: 20001 });
    const ramp   = makeOperand({ type: 'TGT', lambdaStart: 400, lambdaEnd: 1600, aoi: 0, pol: 'avg', target: 1, targetEnd: 1, weight: 1 });
    const argw   = makeOperand({ type: 'TMX', lambdaStart: 400, lambdaEnd: 1600, aoi: 0, pol: 'avg', target: 1, weight: 1 });
    const input = [coarse, fine, ramp, argw];
    const out = withFringeSampleCounts(input, ctx);
    ok(out[0].bandPoints > 201, `a 201-point count on a 9.4 µm stack is raised to ${out[0].bandPoints}`);
    ok(out[1] === fine, 'a count finer than the fringes need is kept as it is');
    ok(Number.isFinite(out[2].rampPoints) && out[2].bandPoints === undefined, `a range target carries its count in rampPoints (${out[2].rampPoints})`);
    ok(out[3] === argw, 'a worst-case operand keeps its own dense default');
    ok(withFringeSampleCounts(out, ctx) === out, 'applying it again to the same design changes nothing');

    const thinCtx = buildEvalContext(thinAR, resolveMat);
    ok(withFringeSampleCounts(out, thinCtx) === out, 'a thinner design never lowers a count already set');
}

// ── 5. Normal incidence: s and p coincide exactly ───────────────────────────
{
    const sameValues = (a, b) => ['R', 'T', 'A'].every(key => a[key] === b[key]);
    const sameArray = (x, y) => [...x].every((v, i) => v === y[i]);
    let identical = true;
    const mats = ['TiO2', 'SiO2', 'Ag', 'Cr'].map(getMaterial);
    for (const lam of [380, 455.5, 632.8, 1064, 1550]) {
        const layers = mats.map((m, i) => ({ n: m.getNK(lam), d: 20 + 37 * i }));
        const n0 = [1, 0], ns = getMaterial('BK7').getNK(lam);
        const a = tmmOne(lam, 0, 's', n0, ns, layers), b = tmmOne(lam, 0, 'p', n0, ns, layers);
        const ja = tmmJacEval(lam, 0, 's', n0, ns, layers), jb = tmmJacEval(lam, 0, 'p', n0, ns, layers);
        const checks = [sameValues(a, b), sameArray(ja.dTdd, jb.dTdd), sameArray(ja.dRdd, jb.dRdd)];
        if (!checks.every(Boolean)) identical = false;
    }
    ok(identical, 's and p R/T/A and thickness derivatives are bit-identical at 0°');

    const ctx = buildEvalContext(thinAR, resolveMat);
    const avg = makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 1, weight: 1 });
    const sOnly = makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 's', target: 1, weight: 1 });
    const [va, vs] = evaluateOperands([avg, sOnly], ctx);
    ok(va === vs, `TAV averaged over s and p equals the s value exactly at 0° (${va})`);
}

// ── 6. A small grid still gives the band's true average ──────────────────────
{
    // Trapezoid reference on a 0.01 nm grid. A plain mean of 13 samples of the
    // single Ta2O5 layer is 0.67 points off it, because it counts the band edges
    // twice as heavily as the interior; the band average uses the trapezoid rule.
    const single = { ...media, frontLayers: [{ id: 'L1', material: 'Ta2O5', thickness: 120, locked: false }] };
    for (const [label, design, type] of [['single 120 nm Ta2O5 layer', single, 'TAV'], ['4-layer AR', thinAR, 'RAV']]) {
        const op = makeOperand({ type, lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, weight: 1 });
        const ctx = buildEvalContext(design, resolveMat);
        const [sampled] = withFringeSampleCounts([op], ctx);
        const [onGrid, dense] = evaluateOperands([sampled, { ...op, bandPoints: 30001 }], ctx);
        const gapPoints = Math.abs(onGrid - dense) * 100;
        ok(gapPoints < 0.1,
            `${label} ${type}(400-700) on ${operandSampleLambdas(sampled).length} samples is ${gapPoints.toFixed(3)} points from the 30001-sample value`);
    }
}

if (fails === 0) console.log('\nAll band-sampling tests passed.');
else { console.error(`\n${fails} test(s) failed.`); process.exit(1); }
