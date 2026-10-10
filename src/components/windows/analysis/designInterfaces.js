import { matFriendlyName } from '../optimization/synthesisShared/materialNames.js';
import { enumerateInterfaces } from '../../../utils/physics/inhomogeneity.js';
import { editorLayerNumber } from '../../../utils/misc/layerNumbers.js';

// A medium is stored as a material id or as { material: id }.
const mediumId = medium => (typeof medium === 'string' ? medium : medium?.material);

// The interfaces of each stack, with the media named as the design shows them
// and the layers numbered as the Design Editor numbers them. Front layers are
// stored air side first and L1 is the one on the substrate; back layers are
// stored substrate first, which is already their order. Interface i is still
// the i-th in storage order, which is how per-interface settings are indexed.
// `names` holds mediumIncident, mediumSubstrate and mediumExit, the window's
// words for a medium the design leaves unset.
export function designInterfaces(design, names) {
    const name = medium => matFriendlyName(mediumId(medium), design);
    const incident = name(design?.incidentMedium) || names.mediumIncident;
    const substrate = name(design?.substrate?.material) || names.mediumSubstrate;
    const exit = name(design?.exitMedium) || names.mediumExit;
    const frontCount = design?.frontLayers?.length || 0;
    const front = design?.frontLayers
        ? enumerateInterfaces(design.frontLayers, incident, substrate, i => editorLayerNumber('front', frontCount, i))
        : [];
    const back = design?.backLayers?.length ? enumerateInterfaces(design.backLayers, substrate, exit) : [];
    return { front, back };
}
