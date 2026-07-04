/**
 * Design-spectrum computation + CSV column builder (export).
 *
 * Computes the active design's T/R/A spectrum over a λ grid + AOI list (honoring
 * the surface evaluation mode) and turns it into named columns for tableToCsv.
 * Shared by the Measured Spectra window's "Export design spectrum" panel so the
 * export does not depend on the Optical Evaluation window being open, and uses
 * the SAME TMM entry points as Optical Evaluation (bit-identical curves).
 *
 * computeDesignSpectrum is impure (resolves materials from the catalog); the
 * column builder designSpectrumColumns is pure and unit-tested.
 */

import { evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal } from '../physics/thinFilmMath.js';
import { getMaterialById } from '../materials/catalogManager.js';
import { getMaterial } from '../materials/materialDatabase.js';

function resolveMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

function formatTheta(t) {
    return Number.isInteger(t) ? String(t) : t.toFixed(1);
}

/**
 * Compute { lambda, series } for a design — same shape Optical Evaluation uses.
 * @param design   TFStudio design object
 * @param params   { lambdaStart, lambdaEnd, lambdaStep, thetas?: number[] }
 * @param evalMode 'front' | 'back' | 'total'
 */
export function computeDesignSpectrum(design, params, evalMode) {
    const incMat = resolveMaterial(design.incidentMedium);
    const subMat = resolveMaterial(design.substrate?.material);
    const exitMat = resolveMaterial(design.exitMedium);
    const subThick = design.substrate?.thickness ?? 1.0;

    const front = (design.frontLayers || [])
        .filter(l => l.thickness > 0)
        .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));
    const back = (design.backLayers || [])
        .filter(l => l.thickness > 0)
        .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));

    const thetas = (params.thetas?.length ? params.thetas : [0]);
    const series = [];
    let lambda = null;

    for (const theta of thetas) {
        const p = { ...params, theta };
        let r;
        if (evalMode === 'front')      r = evaluateSpectrum(p, incMat, subMat, front);
        else if (evalMode === 'back')  r = evaluateSpectrumBack(p, exitMat, subMat, back);
        else                           r = evaluateSpectrumTotal(p, incMat, subMat, exitMat, front, back, subThick);
        if (!lambda) lambda = r.lambda;
        series.push({ theta, T: r.T, R: r.R, A: r.A, Ts: r.Ts, Rs: r.Rs, Tp: r.Tp, Rp: r.Rp });
    }
    return { lambda: lambda || [], series };
}

// Per-polarization series key for each quantity. A (absorptance) has no separate
// s/p series in the evaluator output, so it is emitted for 'avg' only.
const POL_KEY = {
    avg: { T: 'T',  R: 'R',  A: 'A' },
    s:   { T: 'Ts', R: 'Rs' },
    p:   { T: 'Tp', R: 'Rp' },
};

/**
 * Build CSV columns from a computed spectrum.
 * @param spec  { lambda, series }
 * @param opts  quantities (subset of ['T','R','A'], default all),
 *              pols (subset of ['avg','s','p'], default ['avg']),
 *              asPercent (default true → 0..100, else fraction)
 * @returns { x: lambda, columns: [{ name, values }] }
 */
export function designSpectrumColumns(spec, opts = {}) {
    const { lambda = [], series = [] } = spec || {};
    const quantities = opts.quantities || ['T', 'R', 'A'];
    const pols = opts.pols || ['avg'];
    const asPercent = opts.asPercent !== false;
    const multiAoi = series.length > 1;

    const columns = [];
    series.forEach(s => {
        const suffix = multiAoi ? ` @${formatTheta(s.theta)}°` : '';
        pols.forEach(pol => {
            quantities.forEach(q => {
                const key = POL_KEY[pol]?.[q];
                if (!key || !s[key]) return;                  // e.g. A has no s/p
                const polLabel = pol === 'avg' ? '' : ` ${pol}`;
                const name = `${q}${polLabel}${asPercent ? ' %' : ''}${suffix}`;
                columns.push({
                    name,
                    values: asPercent ? s[key].map(v => v * 100) : s[key].slice(),
                });
            });
        });
    });
    return { x: lambda, columns };
}
