/**
 * Needle Manual window — integration tests for the pure logic the UI drives.
 *
 * The NeedleManual window itself is React/DOM, but every numeric operation it
 * performs is delegated to optimizer.js helpers that are validated here exactly
 * as the window calls them:
 *
 *   1. scanNeedlesPFunction returns improving candidates + mf0 > 0 on a
 *      sub-optimal design.
 *   2. The window's depth-mapping (depthBoundaries / candidateDepth, copied
 *      verbatim below) maps every candidate to a physical depth z within
 *      [0, totalZ]; gap positions land exactly on cumulative-thickness
 *      boundaries and intra positions land inside their host layer.
 *   3. The most-improving candidate (min grad) genuinely lowers the MF when a
 *      thin needle is inserted there — predicted ΔMF (calcMF on the inserted
 *      design, exactly the window's preview path) is negative, and its sign
 *      agrees with the analytic gradient sign.
 *   4. insertNeedleIntra splits the host into d1 + needle(d) + d2 with the
 *      d_min floor; insertNeedle inserts one layer at the gap index.
 *   5. findOptimalNeedleThickness returns a finite thickness ≥ d_min.
 *   6. symmetric mode: insertNeedle keeps backLayers = mirror(frontLayers).
 *
 * Run: node tests/needle_manual.mjs
 */

import {
    makeOperand, evaluateOperands, buildEvalContext, calcMF,
    scanNeedlesPFunction, findOptimalNeedleThickness,
    insertNeedle, insertNeedleIntra, mirrorLayers, isConstraint,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

let fails = 0;
const ok   = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } else { console.log('  ok:', msg); } };
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;

const resolveMat = id => getMaterial(id);
const POOL = ['TiO2', 'SiO2', 'MgF2'].map(id => ({ id, name: id, mat: resolveMat(id) }));

// ── Copies of the window's depth helpers (NeedleManual.js) ────────────────────
function depthBoundaries(layers) {
    const z = [0];
    for (const l of layers) z.push(z[z.length - 1] + (l.thickness || 0));
    return z;
}
function candidateDepth(cand, zb) {
    if (cand.intra) {
        const z0 = zb[cand.layerK] ?? 0;
        const z1 = zb[cand.layerK + 1] ?? z0;
        return z0 + cand.frac * (z1 - z0);
    }
    return zb[cand.pos] ?? 0;
}

function makeDesign() {
    return {
        incidentMedium: 'Air',
        exitMedium:     'Air',
        substrate:      { material: 'BK7', thickness: 1.0 },
        // Deliberately un-optimized BBAR-ish stack so needles can improve it.
        frontLayers: [
            { id: 'F1', material: 'TiO2', thickness: 40, locked: false },
            { id: 'F2', material: 'SiO2', thickness: 90, locked: false },
            { id: 'F3', material: 'TiO2', thickness: 30, locked: false },
        ],
        backLayers: [],
        surfaceMode: 'front_only',
    };
}
const makeOps = () => [
    makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
    makeOperand({ type: 'TAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 1, weight: 1 }),
];

// MF of an arbitrary design — exactly the window's preview computation.
const dMin = 1.0;
function mfOf(design, ops) {
    return calcMF(ops, evaluateOperands(ops, buildEvalContext(design, resolveMat)), { skipConstraints: true });
}

// ── 1. scan returns improving candidates ──────────────────────────────────────
console.log('— scan —');
const design = makeDesign();
const ops = makeOps().filter(op => op.enabled).filter(op => !isConstraint(op.type));
const scan = scanNeedlesPFunction({ operands: ops, design, resolveMat, candidateMats: POOL, deltaNm: 0.5, nIntra: 16, side: 'front' });
ok(scan && Array.isArray(scan.candidates) && scan.candidates.length > 0, 'scan returns candidates');
ok(scan.mf0 > 0, `mf0 > 0 (mf0=${scan.mf0?.toFixed(6)})`);
const improving = scan.candidates.filter(c => c.grad < 0);
ok(improving.length > 0, `at least one improving candidate (${improving.length} of ${scan.candidates.length})`);

// ── 2. depth mapping ──────────────────────────────────────────────────────────
console.log('— depth mapping —');
const zb = depthBoundaries(design.frontLayers);
const totalZ = zb[zb.length - 1];
ok(near(totalZ, 40 + 90 + 30), `total depth = sum of thicknesses (${totalZ} nm)`);
let allInRange = true, gapExact = true, intraInside = true;
for (const cand of scan.candidates) {
    const z = candidateDepth(cand, zb);
    if (!(z >= -1e-9 && z <= totalZ + 1e-9)) allInRange = false;
    if (!cand.intra) { if (!near(z, zb[cand.pos], 1e-9)) gapExact = false; }
    else {
        const z0 = zb[cand.layerK], z1 = zb[cand.layerK + 1];
        if (!(z >= z0 - 1e-9 && z <= z1 + 1e-9)) intraInside = false;
    }
}
ok(allInRange, 'every candidate depth ∈ [0, totalZ]');
ok(gapExact, 'gap candidates land exactly on cumulative-thickness boundaries');
ok(intraInside, 'intra candidates land inside their host layer span');

// ── 3. best improving candidate lowers MF; sign agrees with grad ──────────────
console.log('— predicted ΔMF —');
const best = improving.slice().sort((a, b) => a.grad - b.grad)[0];
ok(best.grad < 0, `best candidate grad < 0 (${best.grad.toExponential(3)})`);
const insertedThin = best.intra
    ? insertNeedleIntra(design, best.layerK, best.frac, best.materialId, dMin, 'front')
    : insertNeedle(design, best.pos, best.materialId, dMin, 'front');
const mfThin = mfOf(insertedThin, makeOps());
ok(mfThin < scan.mf0, `thin needle lowers MF (${scan.mf0.toFixed(6)} → ${mfThin.toFixed(6)})`);
// Linearization check: ΔMF and grad·dMin share a sign for a thin perturbation.
ok((mfThin - scan.mf0) < 0 && best.grad < 0, 'ΔMF sign agrees with analytic grad sign');

// ── 4. insertion geometry ─────────────────────────────────────────────────────
console.log('— insertion geometry —');
{
    // intra insertion into layer 1 (SiO2, 90 nm) at frac 0.5
    const intraCand = scan.candidates.find(c => c.intra && c.layerK === 1);
    ok(!!intraCand, 'found an intra candidate in layer 1');
    const dN = 12;
    const ins = insertNeedleIntra(design, 1, intraCand.frac, intraCand.materialId, dN, 'front');
    ok(ins.frontLayers.length === design.frontLayers.length + 2, 'intra insert grows stack by 2 layers');
    const [p1, needle, p2] = [ins.frontLayers[1], ins.frontLayers[2], ins.frontLayers[3]];
    ok(needle.material === intraCand.materialId && near(needle.thickness, dN), 'needle layer has right material + thickness');
    ok(p1.material === 'SiO2' && p2.material === 'SiO2', 'host split keeps host material on both sides');
    ok(near(p1.thickness + p2.thickness, 90, 1e-6) || (p1.thickness >= dMin && p2.thickness >= dMin),
        `host parts sum to host thickness or are floored (${p1.thickness}+${p2.thickness})`);
}
{
    // gap insertion at pos 2
    const gapCand = scan.candidates.find(c => !c.intra && c.pos === 2);
    ok(!!gapCand, 'found a gap candidate at pos 2');
    const ins = insertNeedle(design, 2, gapCand.materialId, 10, 'front');
    ok(ins.frontLayers.length === design.frontLayers.length + 1, 'gap insert grows stack by 1 layer');
    ok(ins.frontLayers[2].material === gapCand.materialId && near(ins.frontLayers[2].thickness, 10),
        'gap needle placed at the requested index');
}

// ── 5. optimal thickness ──────────────────────────────────────────────────────
console.log('— optimal thickness —');
{
    const cand = { ...best, _mat: POOL.find(p => p.id === best.materialId)?.mat || resolveMat(best.materialId) };
    const dOpt = findOptimalNeedleThickness({ operands: ops, design, resolveMat, candidate: cand, deltaNm: dMin, maxNm: 200, tol: 0.5, side: 'front' });
    ok(Number.isFinite(dOpt) && dOpt >= dMin, `findOptimalNeedleThickness ≥ dMin and finite (${dOpt.toFixed(2)} nm)`);
}

// ── 6. symmetric mirror ───────────────────────────────────────────────────────
console.log('— symmetric mirror —');
{
    const sym = { ...makeDesign(), surfaceMode: 'symmetric' };
    sym.backLayers = mirrorLayers(sym.frontLayers);
    const ins = insertNeedle(sym, 1, 'MgF2', 8, 'front');
    const expectBack = mirrorLayers(ins.frontLayers);
    ok(ins.backLayers.length === expectBack.length, 'symmetric: back length mirrors front');
    let mats = true, thk = true;
    for (let i = 0; i < expectBack.length; i++) {
        if (ins.backLayers[i].material !== expectBack[i].material) mats = false;
        if (!near(ins.backLayers[i].thickness, expectBack[i].thickness)) thk = false;
    }
    ok(mats && thk, 'symmetric: backLayers == mirror(frontLayers) after insert');
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
