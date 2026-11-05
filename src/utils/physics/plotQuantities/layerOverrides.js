import { parseAxisVar } from './axisVars.js';

/**
 * The per-layer overrides {thk?} that `[token, value]` pairs set, and
 * the λ and AOI they set in place of the fixed ones.
 */
export function overridesFrom(pairs, fixedLambda, fixedAOI) {
    const byLayer = {};
    let lambda = fixedLambda, aoi = fixedAOI;
    for (const [varTok, value] of pairs) {
        const p = parseAxisVar(varTok);
        if (p.kind === 'lambda') lambda = value;
        else if (p.kind === 'aoi') aoi = value;
        else (byLayer[p.layer] || (byLayer[p.layer] = {}))[p.kind] = value;
    }
    return { byLayer, lambda, aoi };
}

/** Collect per-layer overrides {thk?} from the two axis values. */
export function collectLayerOverrides(spec, xv, yv) {
    return overridesFrom([[spec.xVar, xv], [spec.yVar, yv]], spec.fixedLambda_nm, spec.fixedAOI_deg);
}
