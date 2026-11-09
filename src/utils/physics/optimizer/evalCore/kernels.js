/**
 * TMM kernel entry points of the optimizer, each a call on the WASM kernel
 * loaded in this thread.
 *
 * Arguments are TFStudio's: pol 'p' for p and anything else for s, each medium
 * ñ as [re, im], layers as kernelLayer()s, { n, k, d } with d in nm, angle of
 * incidence in degrees. The layers reach the kernel as given, without a copy
 * (kernelPointStack). The wavelength and angle are read through Number(), so a
 * row with neither set evaluates to NaN rather than throwing.
 */

import { kernelPointStack, sOrP, wasmKernel } from '../../kernelStack.js';

// The polarization a kernel result is cached and computed under. At normal
// incidence cos θ = 1 in every medium, so the tilted admittances y·n·cos θ (s)
// and y·n / cos θ (p) coincide (Macleod, Thin-Film Optical Filters 5e, §9.2)
// and both kernels return bit-identical s and p results, derivatives included.
// Keying both on 's' there makes the second polarization of an average a cache
// hit instead of a second identical evaluation.
export function kernelPol(aoi, polCode) {
    return Number(aoi) === 0 ? 's' : polCode;
}

// The angles of a cone's `rays` ({ aoiDeg }) a cache still has to compute for
// the polarizations `pols`: [polarization, angles] pairs, grouped by the
// polarization each is computed and kept under (kernelPol), without the ones
// `isHeld(polarization, angle)` and without repeats.
export function raysToCompute(rays, pols, isHeld) {
    const groups = new Map();
    for (const pol of pols) {
        for (const { aoiDeg } of rays) {
            const pc = kernelPol(aoiDeg, pol);
            if (isHeld(pc, aoiDeg)) continue;
            if (!groups.has(pc)) groups.set(pc, new Set());
            groups.get(pc).add(aoiDeg);
        }
    }
    return [...groups].map(([pc, angles]) => [pc, [...angles]]);
}

// Single (λ,θ,pol) R/T/A.
export function rtaEval(lam, aoi, polCode, n0, ns, layers) {
    return wasmKernel().rta(kernelPointStack(n0, ns, layers), Number(lam), { angle: Number(aoi), pol: sOrP(polCode) });
}

// The calls below that end in RaysEval take a whole cone's rays at one λ:
// a grid call with the same wavelength at every entry and one angle of
// incidence (degrees) per entry, `stack` as { n0, ns, layers }. Each entry
// runs the kernel the one-angle call runs, on the same inputs, so it is
// bit-identical to that call at its angle.
const sameWavelength = (lam, angles) => new Float64Array(angles.length).fill(Number(lam));

// R, T and A in s and p at every angle in `angles`: { Rs, Ts, As, Rp, Tp, Ap },
// entry i at angles[i].
export function rtaRaysEval(lam, angles, { n0, ns, layers }) {
    return wasmKernel().rtaSpectrum(kernelPointStack(n0, ns, layers), sameWavelength(lam, angles), { angle: angles, pol: 's' });
}

// Analytic thickness Jacobian for one (λ,θ,pol): { R, T, A, dRdd, dTdd, dAdd, N },
// which the DLS chain rule reads. The DLS step is the other optimizer hot path
// besides mfAt.
export function tmmJacEval(lam, aoi, polCode, n0, ns, layers) {
    return wasmKernel().jacobian(kernelPointStack(n0, ns, layers), Number(lam), { angle: Number(aoi), pol: sOrP(polCode) });
}

// tmmJacEval at every angle in `angles`, one polarization: R, T and A as one
// entry per angle, dRdd, dTdd and dAdd as N entries per angle, angle by angle,
// and N.
export function tmmJacRaysEval(lam, angles, polCode, { n0, ns, layers }) {
    return wasmKernel().jacobianSpectrum(kernelPointStack(n0, ns, layers), sameWavelength(lam, angles),
        { angle: angles, pol: sOrP(polCode) });
}

// Analytic thickness Hessian for one (λ,θ,pol): the Jacobian's keys plus
// d2Rdd, d2Tdd and d2Add, which the SQP/Newton getH() reads. The dense Hessian
// is ~17× a gradient and the hot spot of SQP in synthesis.
export function tmmHessEval(lam, aoi, polCode, n0, ns, layers) {
    return wasmKernel().hessian(kernelPointStack(n0, ns, layers), Number(lam), { angle: Number(aoi), pol: sOrP(polCode) });
}

// Analytic needle P-function scan, for candidate materials given as [re, im]
// and split fractions of each layer. Returns the nested {R,T,A,gaps,intra,N}
// the Needle/GE scanners read.
export function tmmNeedleScanEval(lam, aoi, polCode, n0, ns, layers, candNs, fracs) {
    return wasmKernel().needleScan(kernelPointStack(n0, ns, layers), Number(lam), {
        angle: Number(aoi), pol: sOrP(polCode), candidates: candNs.map(([n, k]) => ({ n, k })), fractions: fracs,
    });
}

// tmmNeedleScanEval at every angle in `angles`, one polarization, for the
// candidates and split fractions { candNs, fracs }, in the kernel's flat
// layout: R, T and A per angle, and gaps and intra each as { dR, dT, dA },
// angle by angle, [position][candidate] and [layer][fraction][candidate]
// within an angle.
export function tmmNeedleScanRaysEval(lam, angles, polCode, { n0, ns, layers }, { candNs, fracs }) {
    return wasmKernel().needleScanSpectrum(kernelPointStack(n0, ns, layers), sameWavelength(lam, angles), {
        angle: angles, pol: sOrP(polCode), candidates: candNs.map(([n, k]) => ({ n, k })), fractions: fracs,
    });
}
