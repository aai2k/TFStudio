/**
 * The side of a design a monitored run deposits, and its layers as the front of
 * a design. A design coated on the back alone deposits its back; any other its
 * front. The back is stored from the substrate out, so its layers are turned
 * round to be deposited substrate side first, as the front is stored. The
 * Monitor Worksheet window, the report's worksheet and the API's
 * monitorWorksheet read the run this way, substrate side first, as the Process Exporter
 * deposits a side.
 */

/** 'back' for a design coated on the back alone, 'front' otherwise. */
export const depositedSide = design => (design?.surfaceMode === 'back_only' ? 'back' : 'front');

/** The layers of `side` as the front of the design, deposited substrate side first. */
export function depositedAsFront(design, side = depositedSide(design)) {
    return !design || side === 'front' ? design : { ...design, frontLayers: [...(design.backLayers || [])].reverse() };
}
