/**
 * Filter Design reverse-engineering harness (LEC25D9).
 *
 * Goal: reproduce the reference numbers for the narrow-band-pass example so the
 * new engine matches by construction. NOT a pass/fail test yet — it prints the
 * quantities to calibrate against:
 *   - embedded single-cavity FP bandwidth vs (m, k)
 *   - Step-4 (m,k) equivalence table (expected 8,1 / 7,3 / 6,5 /
 *     5,9 / 4,16 / 3,27 / 2,44 / 1,72 for H=2.35, L=1.46)
 *   - full N-cavity embedded Thelen prototype passband
 *
 * Embedded case: incident medium index == substrate index (1.52). This is the
 * key matching assumption ("Match medium = 1.52") that makes the prototype a
 * clean flat-top with no air/first-layer ripple.
 *
 * Run: node tests/filter_design_explore.mjs
 */

import { tmm } from '../src/utils/physics/thinFilmMath.js';

// ── LEC25D9 constants ────────────────────────────────────────────────────────
const LAM0 = 600;
const nH = 2.35;
const nL = 1.46;
const nSub = 1.52;       // embedded incident == substrate
const nAir = 1.0;

const NK = (n) => [n, 0];
const dH = LAM0 / (4 * nH);   // QW physical thickness
const dL = LAM0 / (4 * nL);

// ── Layer builders ────────────────────────────────────────────────────────────
// Spacer = L, so mirrors must present H on the spacer-facing side(s).
// Mirror with g QW layers, both ends H (odd g):  H (L H)^a, g = 2a+1.
// Outer-left mirror against substrate: same H(LH)^a pattern (ends H toward spacer).
function mirrorLayersHended(g) {
    // Mirror of g QW layers presenting H on the spacer-facing side.
    //   odd  g: H(LH)^a  — both ends H
    //   even g: (LH)^(g/2) — starts L (outer), ends H (spacer side)
    // Build so the LAST layer is always H (spacer-facing).
    const out = [];
    // parity: last must be H. Work backwards: index from end.
    for (let i = 0; i < g; i++) {
        // position from the spacer-facing end (end = H)
        const fromEnd = g - 1 - i;
        const isH = (fromEnd % 2 === 0);
        out.push({ n: NK(isH ? nH : nL), d: isH ? dH : dL });
    }
    return out;
}

// Spacer of order s (s half-waves of L) = 2s QW of L
function spacerL(s) {
    return [{ n: NK(nL), d: 2 * s * dL }];
}

// Single embedded cavity:  Mirror_g  Spacer_s  Mirror_g
function singleCavity(g, s) {
    return [...mirrorLayersHended(g), ...spacerL(s), ...mirrorLayersHended(g)];
}

// Full N-cavity Thelen embedded prototype:
//   M_1 S_1 M_2 S_2 ... S_N M_{N+1}, all mirrors g layers, all spacers order s.
function fullPrototype(N, g, s) {
    const layers = [];
    for (let i = 0; i <= N; i++) {
        layers.push(...mirrorLayersHended(g));
        if (i < N) layers.push(...spacerL(s));
    }
    return layers;
}

// ── TMM evaluation (embedded) ─────────────────────────────────────────────────
function Tat(lam, layers, nInc = nSub, nS = nSub) {
    // average pol at normal incidence == s == p
    const { T } = tmm(lam, 0, 's', NK(nInc), NK(nS), layers);
    return T;
}

// Scan T over a window, return {peakT, peakLam, samples}
function scanT(layers, lamLo, lamHi, step, nInc = nSub, nS = nSub) {
    const xs = [], ts = [];
    for (let lam = lamLo; lam <= lamHi + 1e-9; lam += step) {
        xs.push(lam); ts.push(Tat(lam, layers, nInc, nS));
    }
    let peakT = -1, peakLam = lamLo;
    for (let i = 0; i < ts.length; i++) if (ts[i] > peakT) { peakT = ts[i]; peakLam = xs[i]; }
    return { xs, ts, peakT, peakLam };
}

// Width (full) at an absolute T level, around the central peak.
function widthAtLevel(layers, level, lamLo, lamHi, step, nInc = nSub, nS = nSub) {
    const { xs, ts, peakLam } = scanT(layers, lamLo, lamHi, step, nInc, nS);
    // find peak index nearest LAM0
    let ci = 0, best = Infinity;
    for (let i = 0; i < xs.length; i++) {
        const d = Math.abs(xs[i] - LAM0);
        if (ts[i] > level && d < best) { best = d; ci = i; }
    }
    // walk left/right from center until below level
    let li = ci, ri = ci;
    while (li > 0 && ts[li] >= level) li--;
    while (ri < xs.length - 1 && ts[ri] >= level) ri++;
    // linear interpolate crossings
    const cross = (i0, i1) => {
        const t0 = ts[i0], t1 = ts[i1];
        if (t1 === t0) return xs[i0];
        return xs[i0] + (level - t0) * (xs[i1] - xs[i0]) / (t1 - t0);
    };
    const lamL = cross(li, li + 1);
    const lamR = cross(ri, ri - 1);
    return Math.abs(lamR - lamL);
}

console.log('=== LEC25D9 constants ===');
console.log(`λ0=${LAM0} nH=${nH} nL=${nL} nSub=${nSub}  dH=${dH.toFixed(3)} dL=${dL.toFixed(3)}  nH/nL=${(nH/nL).toFixed(4)}`);

// ── 1. Single-cavity bandwidth vs mirror size (order 1) ──────────────────────
console.log('\n=== Single embedded cavity, order s=1: FWHM & 89.13% width vs mirror layers g ===');
for (let g = 1; g <= 17; g += 2) {
    const layers = singleCavity(g, 1);
    const peak = scanT(layers, LAM0 - 60, LAM0 + 60, 0.02).peakT;
    const fwhm = widthAtLevel(layers, 0.5 * peak, LAM0 - 60, LAM0 + 60, 0.02);
    const w89 = widthAtLevel(layers, 0.8913, LAM0 - 60, LAM0 + 60, 0.02);
    console.log(`  g=${String(g).padStart(2)} (a=${(g-1)/2})  peakT=${peak.toFixed(4)}  FWHM=${fwhm.toFixed(3)} nm  W@89.13%=${w89.toFixed(3)} nm`);
}

// ── 2. (m,k) equivalence table — match Thelen bottom-row bandwidth ──────────
// Reference table for this example (M=ext mirror layers, K=spacer order):
//   8,1  7,3  6,5  5,9  4,16  3,27  2,44  1,72
// Reproduce: for each m, find integer spacer order k giving FWHM closest to the
// reference (m=8, k=1) single-cavity FWHM.
console.log('\n=== (m,k) equivalence: reference table is 8,1/7,3/6,5/5,9/4,16/3,27/2,44/1,72 ===');
console.log('   mapping hypothesis: reference M = g-1 (g = mirror QW layer count incl spacer-facing H)');
{
    // Reference = Thelen prototype: M=8 → g=9, k=1.
    const ref = singleCavity(9, 1);
    const refPeak = scanT(ref, LAM0-60, LAM0+60, 0.01).peakT;
    const refFWHM = widthAtLevel(ref, 0.5 * refPeak, LAM0-60, LAM0+60, 0.01);
    const ref89  = widthAtLevel(ref, 0.8913, LAM0-60, LAM0+60, 0.01);
    console.log(`  reference (g=9 ⇒ M=8, k=1): FWHM=${refFWHM.toFixed(4)}  W@89.13%=${ref89.toFixed(4)}`);
    console.log('   g  M=g-1   bestK(FWHM)  bestK(@89.13%)   reference_K');
    const optiK = { 8:1, 7:3, 6:5, 5:9, 4:16, 3:27, 2:44, 1:72 }; // keyed by M
    for (let g = 2; g <= 9; g++) {
        const M = g - 1;
        let bF = 1, eF = Infinity, b9 = 1, e9 = Infinity;
        for (let k = 1; k <= 130; k++) {
            const lay = singleCavity(g, k);
            const peak = scanT(lay, LAM0 - 30, LAM0 + 30, 0.01).peakT;
            const f = widthAtLevel(lay, 0.5 * peak, LAM0 - 30, LAM0 + 30, 0.01);
            const w9 = widthAtLevel(lay, 0.8913, LAM0 - 30, LAM0 + 30, 0.01);
            if (Math.abs(f - refFWHM) < eF) { eF = Math.abs(f - refFWHM); bF = k; }
            if (Math.abs(w9 - ref89) < e9) { e9 = Math.abs(w9 - ref89); b9 = k; }
        }
        console.log(`  ${String(g).padStart(2)}  M=${String(M).padStart(2)}     k=${String(bF).padStart(3)}        k=${String(b9).padStart(3)}          ${optiK[M] ?? '-'}`);
    }
}

// ── 3. Full N=4 embedded Thelen prototype passband ──────────────────────────
console.log('\n=== Full N=4 embedded Thelen prototype (g=9, s=1) ===');
{
    const N = 4, g = 9, s = 1;
    const layers = fullPrototype(N, g, s);
    const { peakT, peakLam } = scanT(layers, LAM0 - 10, LAM0 + 10, 0.01);
    const fwhm = widthAtLevel(layers, 0.5 * peakT, LAM0 - 10, LAM0 + 10, 0.01);
    console.log(`  layers=${layers.length}  peakT=${peakT.toFixed(4)} @${peakLam.toFixed(2)}  FWHM=${fwhm.toFixed(3)} nm`);
    // embedded vs air (front_only) to show the difference
    const peakAir = scanT(layers, LAM0 - 10, LAM0 + 10, 0.01, nAir, nSub).peakT;
    console.log(`  peakT in AIR (n_inc=1.0)= ${peakAir.toFixed(4)}  <-- this is what the current impl shows`);
}
