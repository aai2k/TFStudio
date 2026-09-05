import { evalN } from '../dispersionFormulas.js';
import {
    createInterpolator,
    createTabulatedNKSampler,
    interpolationRuleOf,
} from '../pchip.js';
import { evaluateDispersionFit } from '../dispersionFits.js';

// One interpolator per k table and rule; a table is shared by every getNK
// built from the same record.
const kInterpolatorCache = new WeakMap();

function makeKInterpolator(kTable, interp) {
    if (!Array.isArray(kTable) || kTable.length === 0) return null;
    let byRule = kInterpolatorCache.get(kTable);
    if (!byRule) kInterpolatorCache.set(kTable, byRule = new Map());
    let interpolate = byRule.get(interp);
    if (!interpolate) {
        interpolate = createInterpolator(kTable.map(row => [row.lam_um, row.k]), interp);
        byRule.set(interp, interpolate);
    }
    return interpolate;
}

/** Interpolate k from a [{lam_um, k}, ...] table under the named rule (PCHIP by default). */
export function interpK(kTable, lambda_um, interp) {
    return makeKInterpolator(kTable, interpolationRuleOf({ interp }))?.(lambda_um) ?? 0;
}

/** Build a getNK(lambda_nm) function for a catalog material entry. */
export function makeGetNK(mat) {
    if (mat.getNK) return mat.getNK;
    const interp = interpolationRuleOf(mat);
    // formulaNum === -1 → user tabular: tabData = [[lam_nm, n, k], ...]
    if (mat.formulaNum === -1) {
        const base = createTabulatedNKSampler(mat.tabData, interp) || (() => [1.5, 0]);
        if (!mat.dispersionFit?.active) return base;
        const getNK = (lambdaNm) => {
            const [low, high] = mat.dispersionFit.rangeNm;
            return lambdaNm >= low && lambdaNm <= high
                ? evaluateDispersionFit(mat.dispersionFit, lambdaNm)
                : base(lambdaNm);
        };
        Object.assign(getNK, base, { dispersionFit: mat.dispersionFit });
        return getNK;
    }
    const kAt = makeKInterpolator(mat.kTable, interp);
    const getNK = (lambda_nm) => {
        const lum = lambda_nm / 1000;
        const n = evalN(mat.formulaNum, mat.coefficients, lum);
        return [n, kAt?.(lum) ?? 0];
    };
    if (kAt) getNK.interp = interp;
    getNK.dispersionFormula = {
        formulaNum: mat.formulaNum,
        coefficients: mat.coefficients,
    };
    if (kAt) {
        getNK.kInterpolator = kAt;
        getNK.kInterpolatorUnit = 'um';
    }
    return getNK;
}
