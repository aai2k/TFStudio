// The designs a session works on, each under an id ('d1', 'd2', ...) that the
// tools take, and the view of a design the tools answer with.

export function createDesignStore() {
    const designs = new Map();
    let seq = 0;
    return {
        add(design) {
            const id = `d${++seq}`;
            designs.set(id, design);
            return id;
        },
        get(id) {
            const design = designs.get(id);
            if (!design) throw new Error(`Unknown design '${id}'. Designs: ${[...designs.keys()].join(', ') || 'none yet; open or create one'}`);
            return design;
        },
        set(id, design) {
            this.get(id);
            designs.set(id, design);
        },
        entries: () => [...designs.entries()],
    };
}

const withoutId = row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'id'));

const layersView = layers => (layers || []).map((layer, index) => ({
    index, material: layer.material, thickness: layer.thickness, ...(layer.locked ? { locked: true } : {}),
}));

/**
 * A design as the tools show it: media, substrate (thickness in mm), surface
 * mode and how a one-sided design is scored, each side's layers as the design stores them (the front from the
 * incident medium inward, the back from the substrate outward; thickness in
 * nm), and the merit rows, in full with `rows`, as a count otherwise.
 */
export function designView(id, design, { rows = false } = {}) {
    const operands = design.meritOperands || [];
    return {
        designId: id, name: design.name ?? null, surfaceMode: design.surfaceMode ?? 'front_only', mfEvalMode: design.mfEvalMode ?? 'side',
        incidentMedium: design.incidentMedium, exitMedium: design.exitMedium,
        substrate: { material: design.substrate?.material, thicknessMm: design.substrate?.thickness },
        referenceWavelength: design.referenceWavelength ?? null,
        front: layersView(design.frontLayers), back: layersView(design.backLayers),
        ...(rows ? { meritRows: operands.map(withoutId) } : { meritRowCount: operands.length }),
    };
}

/** Whether two designs have the same layers on both sides. */
export function sameLayers(a, b) {
    const key = d => JSON.stringify([layersView(d.frontLayers), layersView(d.backLayers)]);
    return key(a) === key(b);
}
