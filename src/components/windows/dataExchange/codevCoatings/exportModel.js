import { buildCodevSeq, CODEV_LIMITS } from '../../../../utils/io/codevCoatingFile.js';
import { buildGrid } from '../../../../utils/io/zemaxCoatingFile.js';
import { designMaterialLookup, isBuiltinId } from '../../../../utils/materials/designMaterials.js';

// A built-in material stored bare ('TiO2', as synthesis inserts it and old
// files have it) is the one the catalogs list as 'builtin:TiO2'. Both
// spellings get one MIC entry and one label.
const canonicalId = (id) => (id && !id.includes(':') && isBuiltinId(id) ? `builtin:${id}` : id);

const codevLayer = (layer) => ({
    material: canonicalId(layer.material), thickness: layer.thickness, locked: !!layer.locked,
});

/**
 * One side of a design as CODE V takes it: from the incident medium to the
 * substrate, thickness in nm, layers of zero thickness left out.
 *
 * Front: the design's incident medium, then frontLayers as stored (incident
 * side first), then the substrate.
 *
 * Back: on a glass/air surface CODE V wants air as the incident medium and the
 * glass as the substrate, whichever face of the element it is (MUL Technical
 * Notes, "Sequential Surfaces"). The incident medium is therefore the design's
 * exit medium and the layers run from the exit side to the substrate, which is
 * backLayers reversed: backLayers are stored substrate side first.
 */
export function sideStack(design, side) {
    const back = side === 'back';
    const stored = back ? [...(design.backLayers || [])].reverse() : (design.frontLayers || []);
    return {
        incident: canonicalId(back ? design.exitMedium : design.incidentMedium),
        substrate: canonicalId(design.substrate?.material),
        layers: stored.filter(layer => layer.thickness > 0).map(codevLayer),
    };
}

/**
 * The analysis wavelengths of the From, To and Step fields, nm, and their
 * count. Past the WL limit only the count is worked out, so a very small step
 * does not build a long list just to have it refused.
 */
export function analysisWavelengths(startNm, endNm, stepNm) {
    const span = Math.abs(endNm - startNm) / stepNm;
    if (!(span < CODEV_LIMITS.wavelengths)) return { count: Math.ceil(span - 1e-6) + 1, wavelengthsNm: null };
    const wavelengthsNm = buildGrid(startNm, endNm, stepNm);
    return { count: wavelengthsNm.length, wavelengthsNm };
}

/**
 * The .seq text for one side of `design`. Every material is resolved through
 * the design, the way the design computes it: the catalog here first, then the
 * definition the design carries. An id that resolves nowhere throws
 * UnresolvedDesignMaterialError rather than being written as air.
 *
 * @returns {{ text: string, warnings: object[] }}  as buildCodevSeq returns them
 * @throws {CodevExportError} past a limit of the MUL option
 */
export function buildDesignSeq(design, { side, title, saveName, wavelengthsNm, anglesDeg, refNm }) {
    const lookup = designMaterialLookup(design);
    return buildCodevSeq({
        ...sideStack(design, side),
        title, saveName, wavelengthsNm, anglesDeg, refNm,
        materialName: (id) => lookup(id).name || id,
        getNK: (id, wavelengthNm) => lookup(id).getNK(wavelengthNm),
    });
}
