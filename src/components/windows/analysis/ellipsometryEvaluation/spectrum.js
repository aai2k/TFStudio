import {
    evaluateEllipsometryAngles, evaluateEllipsometrySpectrum, toDeltaConvention,
} from '../../../../utils/physics/thinFilmMath.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { nkAt, sideLayersAt, sideMedia, sideStack } from './model.js';

export function computeSpectral(design, options) {
    const { side, lambdaStart, lambdaEnd, lambdaStep, thetaDeg } = options;
    const { n0Id, nsId } = sideMedia(design, side);
    const resolveMaterial = designMaterialLookup(design);
    const n0mat = resolveMaterial(n0Id);
    const nsmat = resolveMaterial(nsId);
    const x = [];
    for (let lam = lambdaStart; lam <= lambdaEnd + 1e-9; lam += lambdaStep) {
        x.push(Math.round(lam * 1000) / 1000);
    }
    const stack = sideStack(resolveMaterial, design, side);
    const { psi, delta } = evaluateEllipsometrySpectrum(
        x, thetaDeg,
        x.map(lam => nkAt(n0mat, lam)),
        x.map(lam => nkAt(nsmat, lam)),
        stack.map(layer => x.map(lam => nkAt(layer.material, lam))),
        stack.map(layer => layer.thickness),
    );
    return { x, psi, delta, xLabel: 'Wavelength (nm)' };
}

export function computeAngular(design, options) {
    const { side, lambdaNm, angleStart, angleEnd, angleStep } = options;
    const { n0Id, nsId } = sideMedia(design, side);
    const resolveMaterial = designMaterialLookup(design);
    const n0mat = resolveMaterial(n0Id);
    const nsmat = resolveMaterial(nsId);
    const n0 = nkAt(n0mat, lambdaNm);
    const ns = nkAt(nsmat, lambdaNm);
    const layers = sideLayersAt(resolveMaterial, design, side, lambdaNm);
    const x = [];
    for (let a = angleStart; a <= angleEnd + 1e-9; a += angleStep) {
        x.push(Math.round(a * 1000) / 1000);
    }
    const { psi, delta } = evaluateEllipsometryAngles(lambdaNm, x, n0, ns, layers);
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
