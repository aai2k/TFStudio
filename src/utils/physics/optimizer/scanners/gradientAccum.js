/**
 * Per-row MF-gradient accumulation for the analytic P-function scan.
 *
 * The scan's variables are the needle descriptors: the thickness d of a needle
 * at each insertion, at d = 0. The point evaluators here are the scan's
 * counterpart of the Jacobian's (jacobianAssembly/pointEvaluators.js):
 * propDeriv(λ, pol, char, aoi) is ∂C/∂d at every descriptor and propValue is C
 * itself, with C ∈ {R, T, A} summed over cfg.raysAt(aoi, λ), the cone's rays
 * and weights at that wavelength (one ray of weight 1 without a cone), and the
 * polarizations averaged with equal weight, as the evaluation averages C. The
 * Jacobian's row builders read them unchanged, so a row's needle slope comes
 * by the same chain rule as its thickness slope.
 *
 * With MF = √(SSR/W), SSR = Σ rₛ² over the residual rows and W the weight sum
 * calcMF normalizes by, ∂MF/∂d = Σ rₛ·∂rₛ/∂d / (MF·W): each row adds
 * Σ rₛ·∂rₛ/∂d to descs[].num (descriptors.js divides by MF·W).
 */

import { _charDerivAt } from './chainRule.js';

/** { propDeriv, propValue } over the descriptors `descs`, from the memoized scan `scans` (_makeScanAt). */
export function needlePointEvaluators(cfg, descs, scans) {
    // Every scan result the average at (λ, pol, aoi) is taken over, with its
    // weight. A cone's rays are scanned together, one kernel call per pass and
    // polarization.
    const forEachRead = (lam, pol, aoi, visit) => {
        const pols = pol === 'avg' ? ['s', 'p'] : [pol];
        const rays = cfg.raysAt(aoi, lam);
        scans.fill(lam, pols, rays);
        for (const pl of pols) {
            for (const ray of rays) visit(scans.at(lam, pl, ray.aoiDeg), ray.weight / pols.length);
        }
    };
    const propDeriv = (lam, pol, char, aoi) => {
        const out = new Float64Array(descs.length);
        forEachRead(lam, pol, aoi, (res, weight) => {
            for (let di = 0; di < descs.length; di++) out[di] += weight * _charDerivAt(cfg, res, char, descs[di]);
        });
        return out;
    };
    const propValue = (lam, pol, char, aoi) => {
        let value = 0;
        forEachRead(lam, pol, aoi, (res, weight) => { value += weight * res[char]; });
        return value;
    };
    return { propDeriv, propValue };
}

/** Add Σₛ rₛ·∂rₛ/∂d of one row to every descriptor: `residuals` rₛ, `rows` ∂rₛ/∂d over the descriptors. */
export function _accumRows(descs, residuals, rows) {
    residuals.forEach((residual, s) => {
        if (residual === 0) return;
        const row = rows[s];
        for (let di = 0; di < descs.length; di++) descs[di].num += residual * row[di];
    });
}
