/**
 * A refractiveindex.info page's formula, read through the catalog's formula
 * registry (../dispersionFormulas.js), where the database's formula N is
 * formula 200 + N. The browser, the sampler and an imported material all
 * evaluate a page there, so they compute one thing.
 */

import { RII_FORMULA_OFFSET, evalN } from '../dispersionFormulas.js';

const RII_FORMULA_COUNT = 9;

/** The catalog formula number for database formula `num`, or null outside 1 to 9. */
export function riiCatalogFormula(num) {
    return Number.isInteger(num) && num >= 1 && num <= RII_FORMULA_COUNT ? RII_FORMULA_OFFSET + num : null;
}

/** Evaluate n at lambda_nm from an RII parsed material. Returns null if not a formula type. */
export function evalFormulaN(mat, lambda_nm) {
    if (!mat.riiFormulaNum || !mat.formulaCoeffs) return null;
    const formulaNum = riiCatalogFormula(mat.riiFormulaNum);
    if (!formulaNum) {
        // riiFormula lets the browser say why in the user's language.
        throw Object.assign(
            new Error(`RII formula ${mat.riiFormulaNum} is not one of the database's formulas 1 to 9.`),
            { riiFormula: mat.riiFormulaNum },
        );
    }
    return evalN(formulaNum, mat.formulaCoeffs, lambda_nm / 1000);
}
