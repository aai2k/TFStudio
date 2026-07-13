import { computeEllipsometry } from '../../../../utils/physics/thinFilmMath.js';
import { nkAt, resolveMaterial, sideLayersAt, sideMedia, toDeltaConvention } from './model.js';

export function computeSpectral(design, options) {
    const { side, lambdaStart, lambdaEnd, lambdaStep, thetaDeg } = options;
    const { n0Id, nsId } = sideMedia(design, side);
    const n0mat = resolveMaterial(n0Id);
    const nsmat = resolveMaterial(nsId);
    const x = [], psi = [], delta = [];
    for (let lam = lambdaStart; lam <= lambdaEnd + 1e-9; lam += lambdaStep) {
        const L = Math.round(lam * 1000) / 1000;
        const layers = sideLayersAt(design, side, L);
        const e = computeEllipsometry(L, thetaDeg, nkAt(n0mat, L), nkAt(nsmat, L), layers);
        x.push(L); psi.push(e.psi); delta.push(e.delta);
    }
    return { x, psi, delta, xLabel: 'Wavelength (nm)' };
}

export function computeAngular(design, options) {
    const { side, lambdaNm, angleStart, angleEnd, angleStep } = options;
    const { n0Id, nsId } = sideMedia(design, side);
    const n0mat = resolveMaterial(n0Id);
    const nsmat = resolveMaterial(nsId);
    const n0 = nkAt(n0mat, lambdaNm);
    const ns = nkAt(nsmat, lambdaNm);
    const layers = sideLayersAt(design, side, lambdaNm);
    const x = [], psi = [], delta = [];
    for (let a = angleStart; a <= angleEnd + 1e-9; a += angleStep) {
        const A = Math.round(a * 1000) / 1000;
        const e = computeEllipsometry(lambdaNm, A, n0, ns, layers);
        x.push(A); psi.push(e.psi); delta.push(e.delta);
    }
    return { x, psi, delta, xLabel: 'Angle of incidence (°)' };
}

export function computeEllipsometrySweep(design, options) {
    let raw;
    if (options.mode === 'spectral') {
        const step = Math.max(1, Math.min(options.lambdaStep, Math.abs(options.lambdaEnd - options.lambdaStart) || 1));
        raw = computeSpectral(design, {
            side: options.side,
            lambdaStart: Math.min(options.lambdaStart, options.lambdaEnd),
            lambdaEnd: Math.max(options.lambdaStart, options.lambdaEnd),
            lambdaStep: step,
            thetaDeg: options.thetaDeg,
        });
    } else {
        const step = Math.max(0.05, Math.min(options.angleStep, Math.abs(options.angleEnd - options.angleStart) || 1));
        raw = computeAngular(design, {
            side: options.side,
            lambdaNm: options.lambdaNm,
            angleStart: Math.min(options.angleStart, options.angleEnd),
            angleEnd: Math.min(89.5, Math.max(options.angleStart, options.angleEnd)),
            angleStep: step,
        });
    }
    return { ...raw, delta: toDeltaConvention(raw.delta, options.deltaConvention) };
}
