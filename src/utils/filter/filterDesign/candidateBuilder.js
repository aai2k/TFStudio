import { structureLayerCount, structureThickness, applySymmetry } from './structureMetrics.js';

/** Build a candidate record from a structure WITHOUT descending. */
export function makeCandidate(mirrors, spacers, ctx, extra = {}) {
    const { mfOf, symMirrors, symCavities, dH, dL, spacerIsL } = ctx;
    const sym = applySymmetry(mirrors, spacers, { symMirrors, symCavities });
    return {
        mirrors: sym.mirrors, spacers: sym.spacers, mf: mfOf(mirrors, spacers),
        layers: structureLayerCount(sym.mirrors, sym.spacers),
        thicknessNm: structureThickness(sym.mirrors, sym.spacers, dH, dL, spacerIsL),
        ...extra,
    };
}
