/**
 * The characterization result as a design.
 *
 * A fit is only believable once the design it implies reproduces the spectrum it
 * was fitted to, so the window can hand back exactly that design: the witness
 * sample, one layer of the fitted material at the fitted thickness, on the
 * substrate the fit assumed, evaluated the way the fit evaluated it.
 *
 * The measured curves the fit used travel with it. Without them the new design
 * is a stack with nothing to check it against, and checking it is the point.
 */

import { makeDefaultDesign } from '../../../../state/DesignContext.js';
import { sampleFor } from './model.js';

/**
 * Which face the instrument illuminated, as the design stores coatings.
 *
 * Transmittance is the same through either face, so a reflectance decides it
 * when one was measured. A curve taken through the uncoated face is a coating on
 * the design's back side: evaluated that way, the design sees what the
 * instrument saw.
 */
function measuredSide(chosen) {
    const deciding = chosen.find(curve => curve.quantity === 'R') || chosen[0];
    return deciding?.side === 'back' ? 'back' : 'front';
}

/**
 * @param {object} request
 *   request.design    the design the curves were imported into
 *   request.settings  the window's sample settings
 *   request.chosen    the measured curves the fit used
 *   request.result    the characterization result
 *   request.materialId  id of the material already written to a user catalog
 *   request.materialName
 * @returns {object} a design ready for the project explorer
 */
export function buildCharacterizedDesign({
    design, settings, chosen, result, materialId, materialName,
}) {
    const sample = sampleFor(design, {
        ...settings, measurementMode: result.measurementMode || settings.measurementMode,
    });
    const base = makeDefaultDesign(`${materialName} witness`);
    const side = measuredSide(chosen);
    const ellipsometric = chosen.some(curve => curve.quantity === 'PSI' || curve.quantity === 'DEL');
    const layer = {
        id: `${base.id}-film`,
        material: materialId,
        thickness: result.thicknessNm,
        locked: false,
    };
    const [low, high] = result.fit.rangeNm;
    return {
        ...base,
        incidentMedium: design?.incidentMedium || base.incidentMedium,
        exitMedium: design?.exitMedium || base.exitMedium,
        substrate: {
            material: sample.substrateId,
            thickness: sample.substrateThicknessMm,
        },
        surfaceMode: side === 'back' ? 'back_only' : 'front_only',
        // A slab measurement saw both faces of the witness, which is what a
        // full-system evaluation computes. "Film only" is the single-surface
        // spectrum, which is what ignoring the other side computes.
        mfEvalMode: sample.geometry === 'slab' ? 'total' : 'side',
        frontLayers: side === 'back' ? [] : [layer],
        backLayers: side === 'back' ? [layer] : [],
        referenceWavelength: Math.round((low + high) / 2),
        // The measurement travels with the design so the new material can be
        // checked against what it was fitted to. It goes back into the list it
        // came from, so the window that imported it still owns it.
        [ellipsometric ? 'measuredEllipsometry' : 'measuredCurves']:
            chosen.map(curve => ({ ...curve })),
        notes: `Characterized from measured ${Object.keys(result.measured).join(' and ')}`
            + ` over ${Math.round(low)}-${Math.round(high)} nm.`,
    };
}
