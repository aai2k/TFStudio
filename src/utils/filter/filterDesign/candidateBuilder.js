import { structureLayerCount, structureThickness, applySymmetry } from './structureMetrics.js';

/**
 * Build a candidate record from a structure WITHOUT descending. `mf` is what
 * the search sorts on; `mf0` and `mfTilt` are its normal-incidence and tilted
 * parts, the latter null while the tilt is off.
 *
 * A caller that already holds the merit passes it as `knownMf`. With the tilt
 * off the merit IS its normal part, so that alone is the whole record and the
 * structure need not be evaluated a second time.
 */
export function makeCandidate(mirrors, spacers, ctx, extra = {}, knownMf = null) {
    const { partsOf, tilted, symMirrors, symCavities, dH, dL } = ctx;
    const sym = applySymmetry(mirrors, spacers, { symMirrors, symCavities });
    const { mf, mf0, mfTilt } = (knownMf != null && !tilted)
        ? { mf: knownMf, mf0: knownMf, mfTilt: null }
        : partsOf(mirrors, spacers);
    return {
        mirrors: sym.mirrors, spacers: sym.spacers, mf, mf0, mfTilt,
        layers: structureLayerCount(sym.mirrors, sym.spacers),
        thicknessNm: structureThickness(sym.mirrors, sym.spacers, dH, dL),
        ...extra,
    };
}
