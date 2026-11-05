/**
 * A surface of a quantity the GD/GDD or the Ellipsometry window computes: GD,
 * GDD and TOD of the reflected or the transmitted light, Ψ and Δ.
 *
 * Each grid point is one evaluation at its own wavelength and angle, of the
 * design with the swept layer parameters set, by the code a 2D curve reads
 * (curveFamilies.js): a surface and a curve through the same points agree.
 */

import { computeSpectral } from '../../../components/windows/analysis/ellipsometryEvaluation/spectrum.js';
import { gdGddPointEvaluator } from '../../../components/windows/analysis/gdGddEvaluation/spectrum.js';
import { toDeltaConvention } from '../thinFilmMath.js';
import { isLayerVar, parseAxisVar } from './axisVars.js';
import { phaseMember } from './quantities.js';
import { sweptDesign } from './sweptDesign.js';

const MEMBER_KEYS = { gd: 'gdFs', gdd: 'gddFs2', tod: 'todFs3' };

// A grid point: its wavelength and angle, and the design with its layer
// parameters at their swept values, { lambda, aoi, design, resolveMat }.
function pointAt(spec, base, xValue, yValue) {
    const axes = [[spec.xVar, xValue], [spec.yVar, yValue]];
    const point = { lambda: spec.fixedLambda_nm, aoi: spec.fixedAOI_deg, ...base };
    for (const [token, value] of axes) {
        const { kind } = parseAxisVar(token);
        if (kind === 'lambda') point.lambda = value;
        else if (kind === 'aoi') point.aoi = value;
    }
    for (const [token, value] of axes) {
        if (isLayerVar(token)) Object.assign(point, sweptDesign(point, token, value));
    }
    return point;
}

// GD (fs), GDD (fs²) or TOD (fs³) at a point. The whole part is the GD/GDD
// window's 'whole' side, the light transmitted through the front coating, the
// substrate and the back coating.
function phaseValue(spec, point) {
    const { member, response } = phaseMember(spec.z);
    const side = spec.surfaceMode === 'total' && response === 'T' ? 'whole' : spec.surfaceMode;
    const value = gdGddPointEvaluator(point.design, {
        side, target: response, polarization: spec.polarization,
        thetaDeg: point.aoi, resolveMaterial: point.resolveMat,
    }).evaluateAt(point.lambda);
    return value.valid ? value[MEMBER_KEYS[member]] : NaN;
}

// Ψ or Δ at a point, degrees, Δ in the Azzam-Bashara sign an ellipsometer writes.
function ellipsometricValue(spec, point) {
    const { psi, delta } = computeSpectral(point.design, {
        side: spec.surfaceMode, lambdaStart: point.lambda, lambdaEnd: point.lambda, lambdaStep: 1,
        thetaDeg: point.aoi, resolveMaterial: point.resolveMat,
    });
    return spec.z === 'psi' ? psi[0] : toDeltaConvention([delta[0]], 'azzam')[0];
}

/** The surface over `grid` = { x, y, rowFrom, rowTo, nPoints }, rows [rowFrom, rowTo) filled. */
export function computePointSurface(spec, design, resolveMat, grid) {
    const { x, y, rowFrom, rowTo, nPoints } = grid;
    const valueAt = phaseMember(spec.z) ? phaseValue : ellipsometricValue;
    const base = { design, resolveMat };
    const z = new Array(y.length);
    for (let j = rowFrom; j < rowTo; j++) {
        z[j] = x.map(xValue => valueAt(spec, pointAt(spec, base, xValue, y[j])));
    }
    return { ok: true, x, y, z, zKey: spec.z, nPoints };
}
