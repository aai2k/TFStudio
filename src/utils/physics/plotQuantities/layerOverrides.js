import { parseAxisVar } from './axisVars.js';

/** Collect per-layer overrides {thk?,n?,k?} from the two axis values. */
export function collectLayerOverrides(spec, xv, yv) {
    const byLayer = {};
    let lambda = spec.fixedLambda_nm, aoi = spec.fixedAOI_deg;
    for (const [varTok, value] of [[spec.xVar, xv], [spec.yVar, yv]]) {
        const p = parseAxisVar(varTok);
        if (p.kind === 'lambda') lambda = value;
        else if (p.kind === 'aoi') aoi = value;
        else (byLayer[p.layer] || (byLayer[p.layer] = {}))[p.kind] = value;
    }
    return { byLayer, lambda, aoi };
}
