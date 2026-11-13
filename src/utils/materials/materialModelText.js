/**
 * The dispersion model a material is computed with, as the Group Delay / GDD
 * and Material Dispersion windows word it in the user's language. `parts` is
 * the `modelParts` of materialOmegaResponse, `t` the locale: the words are
 * t.gdgdd's, a fit is named by dispersionFitText.js, and a formula keeps the
 * name the Material Editor shows it under.
 */

import { FORMULA_NAMES } from './dispersionFormulas.js';
import { dispersionFitModelText } from './dispersionFitText.js';

function partText(part, t) {
    const words = t.gdgdd;
    if (!part) return words.modelUnavailable;
    if (part.kind === 'fit') return words.modelFit(dispersionFitModelText(part.fit, t.dispersionFit, t.units));
    if (part.kind === 'formula') return FORMULA_NAMES[part.formulaNum] || words.modelFormula(part.formulaNum);
    if (part.kind === 'table') return words.modelTable[part.interp];
    return part.kind === 'constant' ? words.modelConstant : words.modelZero;
}

/** The model of n and k, as one name when both come from it. */
export function materialModelText(parts, t) {
    if (!parts) return t.gdgdd.modelUnavailable;
    const n = partText(parts.n, t);
    const k = partText(parts.k, t);
    return n === k ? n : t.gdgdd.modelSplit(n, k);
}

/**
 * A line of the window's model list: the material, or the role it plays when it
 * has no name, and its model. `entry` is one of the phase evaluators'
 * `modelEntries`.
 */
export function modelEntryText(entry, t) {
    return t.gdgdd.modelOf(entry.material ?? t.gdgdd.modelRoles[entry.role], materialModelText(entry.parts, t));
}
