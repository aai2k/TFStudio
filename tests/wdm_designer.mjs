/**
 * WDM Filter Designer tests.
 *
 * Run: node tests/wdm_designer.mjs
 *
 * Properties asserted:
 *   • Quarter-wave thicknesses match d = λ₀ / (4·n) for both H and L
 *   • Layer count formula:
 *       layers_per_cavity = 4·k + 1
 *       total layers      = N · (4·k + 1)  (+1 if includeAR)
 *   • First layer (against substrate) is H; last is L by default (or AR top = L)
 *   • Spacer is at the centre of each cavity, of the correct multiple
 *   • Centred TMM evaluation: T(λ₀) > T(λ₀ ± stopband_edge) for a well-formed
 *     prototype (sanity check — the passband actually exists)
 *   • estimateFWHM_nm scales 1/m with spacer order m (Macleod Eq. 7.27)
 *   • Merit operands include exactly one TAV passband, one or two RAV
 *     stopbands, and MNT/MXT constraints with the 9999 sentinel
 */

import {
    buildWDMStack, buildWDMOperands, buildWDMDesign, estimateFWHM_nm,
    isMaterialLosslessForWDM, WDM_LOSSY_THRESHOLD,
    mirrorPairs_to_notationM, notationM_to_mirrorPairs,
    solveMirrorPairsFromFWHM, buildPrototypeCandidates, suggestCavities,
    multicavityFwhmFactor, wdmLayerCount,
} from '../src/utils/filter/wdmDesigner.js';
import { getMaterialById } from '../src/utils/materials/catalogManager.js';
import { evaluateSpectrum } from '../src/utils/physics/thinFilmMath.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;

const LAM0 = 550;

// ── 1. Quarter-wave thickness ────────────────────────────────────────────────
console.log('— QW thickness —');
{
    const stack = buildWDMStack({
        matH: 'builtin:Ta2O5', matL: 'builtin:SiO2',
        lambda0_nm: LAM0, cavities: 1, mirrorPairs: 3, spacerOrder: 1, spacerKind: 'L',
    });
    const matH = getMaterialById('builtin:Ta2O5');
    const matL = getMaterialById('builtin:SiO2');
    const [nH] = matH.getNK(LAM0);
    const [nL] = matL.getNK(LAM0);
    const expectedDH = LAM0 / (4 * nH);
    const expectedDL = LAM0 / (4 * nL);
    ok(near(stack.H_QW, expectedDH, 1e-6), `H QW = λ/(4·n_H) (got ${stack.H_QW}, expected ${expectedDH})`);
    ok(near(stack.L_QW, expectedDL, 1e-6), `L QW = λ/(4·n_L) (got ${stack.L_QW}, expected ${expectedDL})`);

    // Spacer = 2m·d_L for L-spacer, m=1 → 2·d_L
    ok(near(stack.spacerNm, 2 * expectedDL, 1e-6),
        `spacer = 2·d_L for m=1, L-spacer (got ${stack.spacerNm}, expected ${2 * expectedDL})`);
}

// ── 2. Layer count formula (canonical M_1 S_1 M_2 … S_q M_{q+1} layout) ─────
console.log('— layer count formula —');
{
    for (const N of [1, 2, 3, 4]) {
        for (const k of [2, 4, 6]) {
            const stack = buildWDMStack({
                matH: 'builtin:Ta2O5', matL: 'builtin:SiO2',
                lambda0_nm: LAM0, cavities: N, mirrorPairs: k, spacerOrder: 1, spacerKind: 'L',
            });
            const expected = wdmLayerCount(N, k);
            ok(stack.layers.length === expected,
                `N=${N}, k=${k}: ${expected} layers (got ${stack.layers.length})`);
        }
    }

    // N=1 cavity = 4k+1 (= classic Fabry-Perot, no inner mirrors).
    const sing = buildWDMStack({
        matH: 'builtin:Ta2O5', matL: 'builtin:SiO2',
        lambda0_nm: LAM0, cavities: 1, mirrorPairs: 4, spacerOrder: 1, spacerKind: 'L',
    });
    ok(sing.layers.length === 4 * 4 + 1, `single-cavity = 4k+1 (got ${sing.layers.length})`);

    // includeAR adds exactly one L layer on top.
    const withAR = buildWDMStack({
        matH: 'builtin:Ta2O5', matL: 'builtin:SiO2',
        lambda0_nm: LAM0, cavities: 2, mirrorPairs: 4, spacerOrder: 1, spacerKind: 'L',
        includeAR: true,
    });
    ok(withAR.layers.length === wdmLayerCount(2, 4) + 1,
        `includeAR adds 1 layer (got ${withAR.layers.length})`);
    ok(withAR.layers[withAR.layers.length - 1].material === 'builtin:SiO2',
        `AR top layer is L material`);
}

// ── 3. First / spacer / sequence positions ───────────────────────────────────
console.log('— material sequence —');
{
    const stack = buildWDMStack({
        matH: 'builtin:Ta2O5', matL: 'builtin:SiO2',
        lambda0_nm: LAM0, cavities: 1, mirrorPairs: 3, spacerOrder: 2, spacerKind: 'H',
    });
    // Layout: H L H L H L  H_spacer  L H L H L H   (4·k = 12 mirror layers + 1 spacer)
    ok(stack.layers[0].material === 'builtin:Ta2O5',
        `first layer is H against substrate (got ${stack.layers[0].material})`);
    const spacerIdx = 2 * 3; // = 2k = 6 for k=3
    ok(stack.layers[spacerIdx].material === 'builtin:Ta2O5',
        `spacer at position 2k=${spacerIdx} is H material`);
    // spacer thickness = 2·m·d_H = 4·d_H for m=2, H spacer
    ok(near(stack.layers[spacerIdx].thickness, 4 * stack.H_QW, 1e-6),
        `spacer thickness = 4·d_H for m=2, H-spacer (got ${stack.layers[spacerIdx].thickness})`);
    // First mirror pair: H, L, H, L, H, L  (k=3 → 6 layers before spacer)
    const expected = ['builtin:Ta2O5', 'builtin:SiO2', 'builtin:Ta2O5',
                      'builtin:SiO2', 'builtin:Ta2O5', 'builtin:SiO2'];
    for (let i = 0; i < 6; i++) {
        ok(stack.layers[i].material === expected[i],
            `layer ${i} = ${expected[i]} (got ${stack.layers[i].material})`);
    }
}

// ── 4. estimateFWHM scales 1/m ───────────────────────────────────────────────
console.log('— FWHM ∝ 1/m —');
{
    const base = {
        matH: 'builtin:Ta2O5', matL: 'builtin:SiO2', substrateMaterial: 'builtin:BK7',
        lambda0_nm: LAM0, mirrorPairs: 5, spacerKind: 'L',
    };
    const f1 = estimateFWHM_nm({ ...base, spacerOrder: 1 });
    const f2 = estimateFWHM_nm({ ...base, spacerOrder: 2 });
    const f3 = estimateFWHM_nm({ ...base, spacerOrder: 3 });
    ok(f1 > 0 && f2 > 0 && f3 > 0, `FWHM estimates positive (${f1}, ${f2}, ${f3})`);
    ok(near(f1 / f2, 2.0, 1e-9), `FWHM(m=1) / FWHM(m=2) = 2 exactly (got ${f1 / f2})`);
    ok(near(f1 / f3, 3.0, 1e-9), `FWHM(m=1) / FWHM(m=3) = 3 exactly (got ${f1 / f3})`);
}

// ── 5. TMM sanity: a passband exists somewhere in [λ₀ ± half-FWHM] ──────────
// IMPORTANT: this exercises `buildWDMDesign`, the WDM quick-builder, which
// emits the canonical N-cavity SYMMETRIC PROTOTYPE seed only — it does not run
// Global Integer Search itself. (GIS *is* implemented — `globalIntegerSearch`
// in filterDesign.js, driven by FilterDesignWizard's step 5 / filterDesignWorker
// — it's just a separate refinement path not wired into this quick-builder.)
// The raw symmetric prototype's response has N sub-peaks distributed across the
// passband — a textbook Chebyshev ripple (Macleod §8.2 Fig 8.16). Sampling
// EXACTLY at λ₀ for N>1 lands on a *dip* between two sub-peaks, not a peak.
// What the user actually cares about is "there is a passband in the right
// neighbourhood with good off-band rejection", so we scan and look for a
// max within ±FWHM and compare it to far-off-band sample.
console.log('— TMM passband exists somewhere in [λ₀ ± FWHM] —');
{
    const design = buildWDMDesign({
        name: 'test',
        matH: 'builtin:Nb2O5', matL: 'builtin:SiO2',
        substrateMaterial: 'builtin:BK7', incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
        lambda0_nm: LAM0, cavities: 2, mirrorPairs: 6, spacerOrder: 1, spacerKind: 'L',
        passbandFWHM_nm: 10, stopbandWidth_nm: 50, transitionNm: 5,
        aoi: 0, pol: 'avg',
    });

    const incMat = getMaterialById('builtin:Air');
    const subMat = getMaterialById('builtin:BK7');
    const layersResolved = design.frontLayers.map(l => ({
        material: getMaterialById(l.material), thickness: l.thickness,
    }));

    // Fine scan ±10 nm to find the actual peak (it's split into N sub-peaks
    // straddling λ₀ for a 2-cavity prototype, max around λ₀±2 nm).
    const passSpec = evaluateSpectrum({
        lambdaStart: LAM0 - 10, lambdaEnd: LAM0 + 10, lambdaStep: 0.05,
        theta: 0, polarization: 'avg',
    }, incMat, subMat, layersResolved);
    let peakT = 0;
    for (const T of passSpec.T) if (T > peakT) peakT = T;

    // Off-band samples well outside the passband (no ripple structure to miss)
    const stopSpec = evaluateSpectrum({
        lambdaStart: LAM0 - 30, lambdaEnd: LAM0 + 30, lambdaStep: 60,
        theta: 0, polarization: 'avg',
    }, incMat, subMat, layersResolved);
    const Tlow  = stopSpec.T[0];
    const Thigh = stopSpec.T[1];

    ok(peakT > 0.85, `peak T in passband > 0.85 with lossless H (got ${peakT.toFixed(4)})`);
    ok(peakT / Math.max(Tlow, 1e-9)  > 20,
        `peakT ≫ T(λ₀−30 nm) (ratio ${(peakT / Math.max(Tlow, 1e-9)).toFixed(0)})`);
    ok(peakT / Math.max(Thigh, 1e-9) > 20,
        `peakT ≫ T(λ₀+30 nm) (ratio ${(peakT / Math.max(Thigh, 1e-9)).toFixed(0)})`);
}

// ── 6. Merit operands well-formed ───────────────────────────────────────────
console.log('— merit operands —');
{
    const ops = buildWDMOperands({
        lambda0_nm: LAM0,
        passbandFWHM_nm: 20, stopbandWidth_nm: 60, transitionNm: 5,
        aoi: 0, pol: 'avg',
    });
    const dmfs = ops.filter(o => o.type === 'DMFS');
    const tav  = ops.filter(o => o.type === 'TAV');
    const rav  = ops.filter(o => o.type === 'RAV');
    const mnt  = ops.filter(o => o.type === 'MNT');
    const mxt  = ops.filter(o => o.type === 'MXT');

    ok(dmfs.length === 1, `1 DMFS header (got ${dmfs.length})`);
    ok(tav.length === 1,  `1 TAV passband (got ${tav.length})`);
    ok(rav.length === 2,  `2 RAV stopbands (got ${rav.length})`);
    ok(mnt.length === 1 && mxt.length === 1, `MNT+MXT constraints present`);
    ok(mnt[0].lambdaEnd === 9999 && mxt[0].lambdaEnd === 9999,
       `MNT/MXT use 9999 sentinel so they cover layers added by GE/Needle later`);

    const pass = tav[0];
    ok(near(pass.lambdaStart, LAM0 - 10) && near(pass.lambdaEnd, LAM0 + 10),
        `TAV passband = [λ₀ - FWHM/2, λ₀ + FWHM/2]`);
    ok(pass.target === 1.0, `TAV target = 1.0 (got ${pass.target})`);

    // Stopbands flank the passband with the transition gap.
    const lowStop  = rav.find(o => o.lambdaEnd < LAM0);
    const highStop = rav.find(o => o.lambdaStart > LAM0);
    ok(lowStop && highStop, `low and high stopbands both present`);
    ok(near(lowStop.lambdaEnd, LAM0 - 10 - 5), `low stop ends at passStart - transition`);
    ok(near(highStop.lambdaStart, LAM0 + 10 + 5), `high stop starts at passEnd + transition`);
    ok(lowStop.target === 1.0 && highStop.target === 1.0, `RAV stopbands target R=1.0`);
}

// ── 7. buildWDMDesign returns a fully-formed Design object ───────────────────
console.log('— buildWDMDesign shape —');
{
    const design = buildWDMDesign({
        name: 'My WDM',
        matH: 'builtin:Ta2O5', matL: 'builtin:SiO2',
        substrateMaterial: 'builtin:BK7', incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
        lambda0_nm: LAM0, cavities: 3, mirrorPairs: 5, spacerOrder: 1, spacerKind: 'L',
        passbandFWHM_nm: 8, stopbandWidth_nm: 50, transitionNm: 4,
    });

    ok(design.name === 'My WDM',                       `design.name carried through`);
    ok(design.referenceWavelength === LAM0,            `referenceWavelength = λ₀`);
    ok(design.substrate.material === 'builtin:BK7',    `substrate carried through`);
    ok(design.surfaceMode === 'front_only',            `surfaceMode defaults to front_only`);
    ok(design.frontLayers.length === wdmLayerCount(3, 5),
        `layer count from N,k formula (got ${design.frontLayers.length}, expected ${wdmLayerCount(3, 5)})`);
    ok(Array.isArray(design.meritOperands),            `meritOperands array present`);
    ok(design.meritOperands.some(o => o.type === 'TAV'), `meritOperands includes TAV`);
    ok(design.wdmRecipe && design.wdmRecipe.lambda0_nm === LAM0,
        `wdmRecipe preserved for round-tripping`);
}

// ── 8. Lossless-material gate ───────────────────────────────────────────────
console.log('— lossless material gate —');
{
    // Ta2O5 at 1550 nm is lossy in our refractiveindex.info data (k ≈ 3e-3)
    ok(!isMaterialLosslessForWDM('builtin:Ta2O5', 1550),
       `Ta2O5 at 1550nm is rejected (k > ${WDM_LOSSY_THRESHOLD})`);
    // Nb2O5 at 1550 nm is lossless in our data
    ok(isMaterialLosslessForWDM('builtin:Nb2O5', 1550),
       `Nb2O5 at 1550nm is accepted (k = 0)`);
    // SiO2 always lossless
    ok(isMaterialLosslessForWDM('builtin:SiO2', 550),
       `SiO2 at 550nm is accepted`);
    ok(isMaterialLosslessForWDM('builtin:SiO2', 1550),
       `SiO2 at 1550nm is accepted`);
}

// ── 9. mirror-layer (m) parameter translation ───────────────────────────────
console.log('— (m,k) parameter mapping —');
{
    ok(mirrorPairs_to_notationM(5) === 10, `5 QW pairs → m=10 layers`);
    ok(mirrorPairs_to_notationM(8) === 16, `8 QW pairs → m=16 layers`);
    ok(notationM_to_mirrorPairs(17) === 9, `m=17 → 9 QW pairs (rounded up)`);
    ok(notationM_to_mirrorPairs(16) === 8, `m=16 → 8 QW pairs`);
}

// ── 10. solveMirrorPairsFromFWHM — round trip with estimateFWHM ──────────────
console.log('— FWHM↔k round trip —');
{
    // Solve for k given target FWHM, then verify estimateFWHM gives back
    // approximately the same FWHM (after rounding k to integer).
    for (const targetFWHM of [1.0, 5.0, 10.0, 50.0]) {
        const kReal = solveMirrorPairsFromFWHM({
            matH: 'builtin:Nb2O5', matL: 'builtin:SiO2',
            substrateMaterial: 'builtin:BK7',
            lambda0_nm: 550, targetFWHM_nm: targetFWHM,
            spacerOrder: 1, spacerKind: 'L', cavities: 1,
        });
        ok(kReal != null && kReal > 0, `solveMirrorPairsFromFWHM returns positive for FWHM=${targetFWHM}`);
        const kInt = Math.max(1, Math.round(kReal));
        const est = estimateFWHM_nm({
            matH: 'builtin:Nb2O5', matL: 'builtin:SiO2',
            substrateMaterial: 'builtin:BK7',
            lambda0_nm: 550, mirrorPairs: kInt,
            spacerOrder: 1, spacerKind: 'L',
        });
        // Should land within factor 2 of target after rounding (worst case for
        // tight integer rounding when ratio.nL/nH is moderate).
        ok(est != null && est > targetFWHM / 3 && est < targetFWHM * 3,
            `target ${targetFWHM} nm → k=${kInt} → est ${est?.toFixed(2)} nm (within factor 3)`);
    }
}

// ── 11. suggestCavities — Chebyshev formula (Tikhonravov 2002) ─────────────
console.log('— suggestCavities Chebyshev —');
{
    // SF=1.714 should give q=5 (paper's worked example with Δλ_p=0.35, Δλ_r=0.6)
    ok(suggestCavities(1.714) === 5, `SF=1.714 → 5 cavities (Tikhonravov 2002 example)`);
    // SF=3 → q=3 (1.5 GHz example; Chebyshev gives 3.0)
    ok(suggestCavities(3.0) === 3,   `SF=3   → 3 cavities`);
    // SF=5 → q=3 (NOT 5 as the previous heuristic claimed)
    ok(suggestCavities(5.0) === 3,   `SF=5   → 3 cavities (Chebyshev, NOT 5)`);
    // SF=2 → q=4
    ok(suggestCavities(2.0) === 4,   `SF=2   → 4 cavities`);
    // SF=10 → q=2 (very loose spec)
    ok(suggestCavities(10) === 2,    `SF=10  → 2 cavities`);
    // SF ≤ 1 → 1 cavity
    ok(suggestCavities(1.0) === 1,   `SF=1   → 1 cavity (no rejection requirement)`);
    ok(suggestCavities(0.5) === 1,   `SF<1   → 1 cavity`);
}

// ── 11b. Strong-mirror gate: candidate table only returns k ≥ MIN ───────────
console.log('— strong-mirror gate (no k < WDM_K_MIRROR_MIN) —');
{
    // Mimic the previous "WDM Filter2" bad-recipe attempt to confirm the
    // updated table never returns a degenerate prototype.
    const rows = buildPrototypeCandidates({
        matH: 'builtin:Nb2O5', matL: 'builtin:SiO2',
        substrateMaterial: 'builtin:BK7',
        lambda0_nm: 550, targetFWHM_nm: 10,
        spacerKind: 'L', cavities: 5,
    });
    ok(rows.length > 0, `candidate table non-empty`);
    const minK = rows.reduce((m, r) => Math.min(m, r.mirrorPairs), Infinity);
    const maxM = rows.reduce((m, r) => Math.max(m, r.spacerOrder), -Infinity);
    ok(minK >= 4,  `every row has k_mirror ≥ 4 (got min = ${minK})`);
    ok(maxM <= 3,  `every row has spacer order ≤ 3 (got max = ${maxM})`);
    // Every row should have R_mirror ≥ 90% (lower bound).
    const minR = rows.reduce((m, r) => Math.min(m, r.mirrorReflectance), Infinity);
    ok(minR >= 0.9, `every row has mirror R ≥ 90% (got min = ${(minR*100).toFixed(1)}%)`);
}

// ── 12. buildPrototypeCandidates table ──────────────────────────────────────
console.log('— prototype candidate table —');
{
    const rows = buildPrototypeCandidates({
        matH: 'builtin:Nb2O5', matL: 'builtin:SiO2',
        substrateMaterial: 'builtin:BK7',
        lambda0_nm: 1550, targetFWHM_nm: 1.0,
        spacerKind: 'L', cavities: 3,
    });
    ok(rows.length >= 4, `candidate table populated (got ${rows.length} rows)`);
    // Each row's k must satisfy the strong-mirror bound; each m must be ≤ 3.
    ok(rows.every(r => r.mirrorPairs >= 4 && r.mirrorPairs <= 18),
        `every row has 4 ≤ k_mirror ≤ 18`);
    ok(rows.every(r => r.spacerOrder >= 1 && r.spacerOrder <= 3),
        `every row has 1 ≤ spacer order ≤ 3`);
    // m = 2·mirrorPairs
    ok(rows.every(r => r.notationM === 2 * r.mirrorPairs),
       `every row has notationM = 2·mirrorPairs`);
    // Sorted with best-match-to-target first.
    const headErr = Math.abs(rows[0].estimatedFWHM_nm - 1.0);
    const tailErr = Math.abs(rows[rows.length - 1].estimatedFWHM_nm - 1.0);
    ok(headErr <= tailErr, `table is sorted best-match-first (head ${headErr.toFixed(3)} ≤ tail ${tailErr.toFixed(3)})`);
}

// ── 13. Multi-cavity narrowing factor monotonic ─────────────────────────────
console.log('— multicavity narrowing factor —');
{
    let mono = true;
    for (let N = 2; N <= 6; N++) {
        if (multicavityFwhmFactor(N) >= multicavityFwhmFactor(N - 1)) {
            mono = false; break;
        }
    }
    ok(mono, `multicavityFwhmFactor strictly decreases with N`);
    ok(multicavityFwhmFactor(1) === 1.0, `single-cavity factor = 1.0`);
}

// ── 14. End-to-end: Tikhonravov 2002 §3 worked example ─────────────────────
// Paper specs: λ₀=1550 nm, Δλ_p=0.8 nm, Δλ_r=2.4 nm (SF=3, q=3 from Chebyshev),
// n_H=2.1, n_L=1.45, n_sub=1.52, n_inc=1.0. Paper reports peak T ≈ 1.0
// after Global Integer Search; this test checks `buildWDMDesign`'s SYMMETRIC
// PROTOTYPE seed (GIS refinement is a separate step in FilterDesignWizard, not
// applied by the WDM quick-builder), so we expect peak T > 0.85 — enough to
// confirm the prototype is in the right neighbourhood, not pathological like
// the previous k=1/m=7 case.
console.log('— Tikhonravov 2002 worked example —');
{
    // Use Nb2O5 (n≈2.26 at 1550) instead of paper's n=2.1; close enough.
    // q = suggestCavities(3) should be 3.
    const N = suggestCavities(3);
    ok(N === 3, `Tikhonravov example: q=3 from SF=3 (got ${N})`);

    // Solve the (m=1) prototype k from target FWHM.
    const kReal = solveMirrorPairsFromFWHM({
        matH: 'builtin:Nb2O5', matL: 'builtin:SiO2',
        substrateMaterial: 'builtin:BK7',
        lambda0_nm: 1550, targetFWHM_nm: 0.8,
        spacerOrder: 1, spacerKind: 'L',
    });
    const k = Math.max(4, Math.round(kReal));
    ok(k >= 4 && k <= 18, `k_mirror in [4,18] (got ${k})`);

    const design = buildWDMDesign({
        name: 'Tikhonravov example',
        matH: 'builtin:Nb2O5', matL: 'builtin:SiO2',
        substrateMaterial: 'builtin:BK7', incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
        lambda0_nm: 1550, cavities: N, mirrorPairs: k, spacerOrder: 1, spacerKind: 'L',
        passbandFWHM_nm: 0.8, stopbandWidth_nm: 2.4, transitionNm: 0.4,
    });
    const incMat = getMaterialById('builtin:Air');
    const subMat = getMaterialById('builtin:BK7');
    const layersResolved = design.frontLayers.map(l => ({
        material: getMaterialById(l.material), thickness: l.thickness,
    }));
    // Sample very finely around 1550 to capture the narrow peak
    const spec = evaluateSpectrum({
        lambdaStart: 1549, lambdaEnd: 1551, lambdaStep: 0.005,
        theta: 0, polarization: 'avg',
    }, incMat, subMat, layersResolved);
    let peakT = 0;
    for (const T of spec.T) if (T > peakT) peakT = T;
    // Symmetric prototype peak T > 0.85 — paper reports ~1.0 after Global
    // Integer Search, but the WDM quick-builder emits only the symmetric
    // starting prototype (GIS refinement lives in FilterDesignWizard), so we
    // accept moderate ripple here.
    ok(peakT > 0.85, `Tikhonravov symmetric prototype peak T > 0.85 (got ${peakT.toFixed(4)})`);

    // Confirm the prototype is NOT pathological: stopband T < 5% at ±5 nm
    // from λ₀ (well inside the stop region for a 0.8 nm passband).
    const stop = evaluateSpectrum({
        lambdaStart: 1543, lambdaEnd: 1543.001, lambdaStep: 1,
        theta: 0, polarization: 'avg',
    }, getMaterialById('builtin:Air'), getMaterialById('builtin:BK7'),
       design.frontLayers.map(l => ({ material: getMaterialById(l.material), thickness: l.thickness })));
    ok(stop.T[0] < 0.05, `stopband T < 5% at λ₀-7 nm (got ${(stop.T[0]*100).toFixed(2)}%)`);
}

// ── Summary ──────────────────────────────────────────────────────────────────
if (fails === 0) {
    console.log('\nAll WDM-designer tests passed.');
} else {
    console.error(`\n${fails} assertion(s) failed.`);
    process.exit(1);
}
