import { buildPrototypeLayers } from './prototypeLayers.js';
import { meritFunctionEmbedded } from './meritFunction.js';
import { applySymmetry } from './structureMetrics.js';

/** Build the embedded-MF evaluator for a fixed material/target context. */
export function makeMfOf({ nH, nL, lambda0_nm, spacerKind, symMirrors, symCavities, target, nSub }) {
    return (mirrors, spacers) => {
        const { mirrors: m, spacers: s } = applySymmetry(mirrors, spacers, { symMirrors, symCavities });
        const layers = buildPrototypeLayers({ nH, nL, lambda0_nm, mirrors: m, spacers: s, spacerKind });
        return meritFunctionEmbedded(layers, target, nSub);
    };
}
