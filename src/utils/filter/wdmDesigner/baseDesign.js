/**
 * Minimal default-design factory — kept local so `wdmDesigner.js` can be
 * imported under Node (DesignContext.js touches the React global). Mirrors
 * the shape produced by `makeDefaultDesign` in DesignContext.js.
 */

function _uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

export function makeBaseDesign(name) {
    const ts = _uid();
    return {
        id: `design-${ts}`,
        name,
        incidentMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 },
        exitMedium: 'Air',
        surfaceMode: 'front_only',
        frontLayers: [],
        backLayers: [],
        referenceWavelength: 550,
        notes: '',
    };
}
