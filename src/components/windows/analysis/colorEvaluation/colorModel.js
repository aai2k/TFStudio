/**
 * The colorimetric side of the Color Evaluation window.
 *
 * Physics in ../../../../utils/physics/colorimetry.js
 * (Macleod §12.2 Eqs. 12.1–12.5 + CIE 15:2004 standard data).
 *
 * The spectral response R(λ)/T(λ) is taken from the same validated TMM used by
 * Optical Evaluation (evaluateSpectrum / …Back / …Total), sampled on the
 * 380–780 nm color grid and fed to the colorimetric integral.
 */

import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { colorReport } from '../../../../utils/physics/colorimetry.js';
import { coneAverageResult, makeConeSpec } from '../../../../utils/physics/optimizer.js';
import {
    evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal,
} from '../../../../utils/physics/thinFilmMath.js';

// The visible band the colour-matching functions are defined over. Fixed: it is
// a property of the CIE observer, not a user setting.
export const COLOR_RANGE_NM = [380, 780];

export const formatValue = (value, digits = 4) =>
    (value == null || !isFinite(value) ? '—' : value.toFixed(digits));

// Build an interpolating R|T(λ) fraction-function from a TMM spectrum sweep.
function responseFn(design, evalMode, characteristic, pol, theta) {
    const resolveMaterial = designMaterialLookup(design);
    const incMat = resolveMaterial(design.incidentMedium);
    const subMat = resolveMaterial(design.substrate?.material);
    const exitMat = resolveMaterial(design.exitMedium);
    const subThk = design.substrate?.thickness ?? 1.0;
    const params = {
        lambdaStart: COLOR_RANGE_NM[0], lambdaEnd: COLOR_RANGE_NM[1], lambdaStep: 1,
        theta, polarization: pol,
    };

    const front = (design.frontLayers || []).filter(layer => layer.thickness > 0)
        .map(layer => ({ material: resolveMaterial(layer.material), thickness: layer.thickness }));
    const back = (design.backLayers || []).filter(layer => layer.thickness > 0)
        .map(layer => ({ material: resolveMaterial(layer.material), thickness: layer.thickness }));

    // Cone-angle averaging: `theta` is the cone axis; the colour is computed from
    // the cone-averaged spectrum so it matches the Optical Evaluation plot and
    // the merit function. Inactive cone → single call.
    const coneSpec = makeConeSpec(design.cone || {});
    const computeAt = (angle) => {
        const at = { ...params, theta: angle };
        if (evalMode === 'back') return evaluateSpectrumBack(at, exitMat, subMat, back);
        if (evalMode === 'total') {
            return evaluateSpectrumTotal(at, incMat, subMat, exitMat, front, back, subThk);
        }
        return evaluateSpectrum(at, incMat, subMat, front);
    };
    const res = coneAverageResult(coneSpec, theta, computeAt,
        ['T', 'R', 'A', 'Ts', 'Rs', 'Tp', 'Rp', 'As', 'Ap']);

    const values = characteristic === 'T' ? res.T : res.R;
    const lam0 = res.lambda[0];
    const count = res.lambda.length;
    const delta = count > 1 ? (res.lambda[count - 1] - lam0) / (count - 1) : 1;
    return (lambda) => {
        if (lambda <= lam0) return values[0] ?? 0;
        if (lambda >= res.lambda[count - 1]) return values[count - 1] ?? 0;
        const position = (lambda - lam0) / delta;
        const index = Math.floor(position);
        const fraction = position - index;
        return (values[index] ?? 0) * (1 - fraction) + (values[index + 1] ?? 0) * fraction;
    };
}

/**
 * Colorimetric report for the current design, or null when there is nothing to
 * show (no design, empty front stack). Failures are reported via `setError`.
 */
export function computeColorReport(options) {
    const { design, evalMode, characteristic, pol, theta,
            observer, illuminant, step, setError } = options;
    if (!design) return null;
    const front = (design.frontLayers || []).filter(layer => layer.thickness > 0);
    if (evalMode === 'front' && front.length === 0) return null;
    try {
        const response = responseFn(design, evalMode, characteristic, pol, theta);
        setError(null);
        return colorReport(response, { observer, illuminant, step });
    } catch (error) {
        setError(error.message || 'Computation error');
        return null;
    }
}

function dominantWavelength(report, ce) {
    if (report.dom.dom != null) {
        return `${formatValue(report.dom.dom, 1)} nm   ${ce.purity} ${formatValue(report.dom.purity * 100, 2)}%`;
    }
    if (report.dom.comp != null) {
        return `${ce.compl} ${formatValue(report.dom.comp, 1)} nm   ${ce.purity} ${formatValue(report.dom.purity * 100, 2)}%`;
    }
    return '—';
}

/** One row per colour space, as the quantity's name and its coordinates. */
export function colorReadoutRows(report, ce) {
    if (!report) return [];
    const f = formatValue;
    return [
        [ce.xyY, `x ${f(report.xy.x)}   y ${f(report.xy.y)}   Y ${f(report.XYZ.Y, 3)}`],
        [ce.XYZ, `X ${f(report.XYZ.X, 3)}   Y ${f(report.XYZ.Y, 3)}   Z ${f(report.XYZ.Z, 3)}`],
        ['CIE L*a*b*', `L* ${f(report.Lab.L, 3)}   a* ${f(report.Lab.a, 3)}   b* ${f(report.Lab.b, 3)}`],
        ['L* C*ab h°ab', `C* ${f(report.Lab.C, 3)}   h° ${f(report.Lab.h, 2)}`],
        ['CIE L*u*v*', `L* ${f(report.Luv.L, 3)}   u* ${f(report.Luv.u, 3)}   v* ${f(report.Luv.v, 3)}`],
        ['C*uv h°uv suv', `C* ${f(report.Luv.C, 3)}   h° ${f(report.Luv.h, 2)}   s ${f(report.Luv.s, 4)}`],
        ["u' v' (1976)", `u' ${f(report.uvP.up)}   v' ${f(report.uvP.vp)}`],
        ['u v (1960)', `u ${f(report.uv60.u)}   v ${f(report.uv60.v)}`],
        ['Hunter Lab', `L ${f(report.Hunter.L, 3)}   a ${f(report.Hunter.a, 3)}   b ${f(report.Hunter.b, 3)}`],
        [ce.dominant, dominantWavelength(report, ce)],
        ['CCT / Duv', `${f(report.cct.cct, 0)} K   Duv ${f(report.cct.duv, 4)}`],
    ];
}

export function readoutColumns(ce) {
    return [
        { key: 'quantity', label: ce.colQuantity, align: 'left' },
        { key: 'value', label: ce.colValue, align: 'left' },
    ];
}

export function readoutTableRows(report, ce) {
    return colorReadoutRows(report, ce).map(([quantity, value]) => ({ quantity, value }));
}
