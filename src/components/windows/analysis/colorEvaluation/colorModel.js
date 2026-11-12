/**
 * The colorimetric side of the Color Evaluation window.
 *
 * Physics in ../../../../utils/physics/colorimetry.js
 * (Macleod §12.2 Eqs. 12.1–12.5 + CIE 15:2004 standard data).
 *
 * The spectral response R(λ)/T(λ) is taken from the same validated TMM used by
 * Optical Evaluation (evaluateSpectrum / …Back / …Total), computed on the
 * 380–780 nm band at the window's Δλ, and the colorimetric integral runs over
 * every point of that grid.
 */

import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { colorReport, COLOR_RANGE_NM, xyzToSRGB } from '../../../../utils/physics/colorimetry.js';
import { coneAverageResult, makeConeSpec } from '../../../../utils/physics/optimizer.js';
import {
    evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal,
} from '../../../../utils/physics/thinFilmMath.js';

export const formatValue = (value, digits = 4) =>
    (value == null || !isFinite(value) ? '—' : value.toFixed(digits));

/**
 * The colour shown on screen for `report` at the window's exposure: 'fit' for
 * the hue at full brightness, '1' for the report's own sRGB, scaled against a
 * perfect white reflector. Exposure changes what is shown only; the
 * colorimetric values are unchanged.
 */
export function exposedRgb(report, exposure) {
    return exposure === 'fit' ? xyzToSRGB(report.XYZ, report.white, { fit: true }) : report.rgb;
}

/**
 * R|T(λ) as a fraction on the colour band, every `step` nm, on the sides
 * `evalMode` names ('front', 'back' or 'total'), averaged over the design's
 * cone. A side with no layers gives its bare surface.
 */
export function responseSpectrum(design, { evalMode, characteristic, pol, theta, step }) {
    const resolveMaterial = designMaterialLookup(design);
    const incMat = resolveMaterial(design.incidentMedium);
    const subMat = resolveMaterial(design.substrate?.material);
    const exitMat = resolveMaterial(design.exitMedium);
    const subThk = design.substrate?.thickness ?? 1.0;
    const params = {
        lambdaStart: COLOR_RANGE_NM[0], lambdaEnd: COLOR_RANGE_NM[1], lambdaStep: step,
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

    return { lambda: res.lambda, values: characteristic === 'T' ? res.T : res.R };
}

/**
 * The colour at each angle of `options.thetas`, degrees, as `{ theta, report }`
 * in the order given, or null with no design. A side with no layers is its bare
 * surface, as in Optical Evaluation. A failure at any angle is reported via
 * `setError` and leaves no result.
 */
export function computeColorReports(options) {
    const { design, thetas, observer, illuminant, setError } = options;
    if (!design) return null;
    try {
        const reports = thetas.map(theta => ({
            theta,
            report: colorReport(responseSpectrum(design, { ...options, theta }), { observer, illuminant }),
        }));
        setError(null);
        return reports;
    } catch (error) {
        setError(error.message || 'Computation error');
        return null;
    }
}

/**
 * computeColorReports on each of `designs`, one per environment the window
 * shows: a list of report lists, or null when any of them fails.
 */
export function computeEnvironmentReports(designs, options) {
    const sets = [];
    for (const design of designs) {
        const reports = computeColorReports({ ...options, design });
        if (!reports) return null;
        sets.push(reports);
    }
    return sets;
}

/**
 * What the window shows of `sets`, the reports of each environment in `views`:
 * that environment's, or under All (`every`) each environment's in turn, each
 * report naming its environment, `{ number, label }`, in `env`.
 */
export function shownReports(sets, every, views) {
    if (!sets) return null;
    if (!every) return sets[0];
    return sets.flatMap((reports, k) => reports.map(entry => ({
        ...entry, env: { number: views[k].number, label: views[k].label },
    })));
}
