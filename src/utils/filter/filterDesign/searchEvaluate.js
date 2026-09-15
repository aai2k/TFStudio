import { buildPrototypeLayers } from './prototypeLayers.js';
import { meritFunctionEmbedded, meritFunctionParts } from './meritFunction.js';
import { applySymmetry } from './structureMetrics.js';

/** The embedded layers of a structure under the search's symmetry settings. */
function layersOf({ nH, nL, lambda0_nm, symMirrors, symCavities }, mirrors, spacers) {
    const { mirrors: m, spacers: s } = applySymmetry(mirrors, spacers, { symMirrors, symCavities });
    return buildPrototypeLayers({ nH, nL, lambda0_nm, mirrors: m, spacers: s });
}

/** Build the embedded-MF evaluator for a fixed material/target context. */
export function makeMfOf(ctx) {
    return (mirrors, spacers) => meritFunctionEmbedded(layersOf(ctx, mirrors, spacers), ctx.target, ctx.nSub);
}

/** The same evaluator returning the merit with its normal and tilted parts. */
export function makePartsOf(ctx) {
    return (mirrors, spacers) => meritFunctionParts(layersOf(ctx, mirrors, spacers), ctx.target, ctx.nSub);
}
