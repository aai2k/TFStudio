/**
 * TMM kernel entry points: each picks the WASM kernel when the feature flag is on
 * and a module is instantiated in this thread, and falls back to the JS
 * implementation in tmmcore otherwise. Every wrapper returns the same shape from
 * both paths, so callers never branch on which one ran.
 *
 * Arguments are TFStudio's: pol 's' | 'p', each ñ as [re, im], layers as
 * [{ n: [re, im], d }] with d in nm, angle of incidence in degrees. The
 * wavelength and angle are read through Number(), so a row with neither set
 * evaluates to NaN rather than throwing.
 */

import { hessian, jacobian, rta, tmmNeedleScan, tmmWasmActive, getTmmWasm } from '../../../../tmmcore.js';
import { pointStack } from '../../kernelStack.js';

// The polarization a kernel result is cached and computed under. At normal
// incidence cos θ = 1 in every medium, so the tilted admittances y·n·cos θ (s)
// and y·n / cos θ (p) coincide (Macleod, Thin-Film Optical Filters 5e, §9.2)
// and both kernels return bit-identical s and p results, derivatives included.
// Keying both on 's' there makes the second polarization of an average a cache
// hit instead of a second identical evaluation.
export function kernelPol(aoi, polCode) {
    return Number(aoi) === 0 ? 's' : polCode;
}

// The kernels in use in this thread: the loaded module's when it is active.
const kernels = () => (tmmWasmActive() ? getTmmWasm() : { rta, jacobian, hessian });

// Single (λ,θ,pol) R/T/A.
export function rtaEval(lam, aoi, polCode, n0, ns, layers) {
    return kernels().rta(pointStack(n0, ns, layers), Number(lam), { angle: Number(aoi), pol: polCode });
}

// Analytic thickness Jacobian for one (λ,θ,pol): { R, T, A, dRdd, dTdd, dAdd, N },
// which the DLS chain rule reads. The DLS step is the other optimizer hot path
// besides mfAt.
export function tmmJacEval(lam, aoi, polCode, n0, ns, layers) {
    return kernels().jacobian(pointStack(n0, ns, layers), Number(lam), { angle: Number(aoi), pol: polCode });
}

// Analytic thickness Hessian for one (λ,θ,pol): the Jacobian's keys plus
// d2Rdd, d2Tdd and d2Add, which the SQP/Newton getH() reads. The dense Hessian
// is ~17× a gradient and the hot spot of SQP in synthesis.
export function tmmHessEval(lam, aoi, polCode, n0, ns, layers) {
    if (tmmWasmActive()) {
        const w = getTmmWasm();
        if (w.hasHessian()) {
            return w.hessian(pointStack(n0, ns, layers), Number(lam), { angle: Number(aoi), pol: polCode });
        }
    }
    return hessian(pointStack(n0, ns, layers), Number(lam), { angle: Number(aoi), pol: polCode });
}

// Analytic needle P-function scan — WASM kernel when active, else JS. Returns
// the SAME nested {R,T,A,gaps,intra,N} so the Needle/GE scanners are unchanged.
export function tmmNeedleScanEval(lam, aoi, polCode, n0, ns, layers, candNs, fracs) {
    if (tmmWasmActive()) {
        return getTmmWasm().tmmNeedleScan(lam, aoi, polCode === 'p' ? 1 : 0, n0, ns, layers, candNs, fracs);
    }
    return tmmNeedleScan(lam, aoi, polCode, n0, ns, layers, candNs, fracs);
}
