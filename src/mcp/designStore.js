// The designs a session works on, each under an id ('d1', 'd2', ...) that the
// tools take, and the view of a design the tools answer with.
//
// A design read from the open app (liveTools.js) also keeps where it came
// from, its link: { appDesignId, revision }. Edits keep the link; a copy is a
// design of its own and has none.

export function createDesignStore() {
    const designs = new Map();
    const links = new Map();
    let seq = 0;
    return {
        add(design, link = null) {
            const id = `d${++seq}`;
            designs.set(id, design);
            if (link) links.set(id, link);
            return id;
        },
        get(id) {
            const design = designs.get(id);
            if (!design) throw new Error(`Unknown design '${id}'. Designs: ${[...designs.keys()].join(', ') || 'none yet; open or create one'}`);
            return design;
        },
        /** Replaces the design under `id`, and its link when one is given. */
        set(id, design, link = null) {
            this.get(id);
            designs.set(id, design);
            if (link) links.set(id, link);
        },
        /** Where the design under `id` was read from in the app, or null. */
        linkOf: id => links.get(id) ?? null,
        entries: () => [...designs.entries()],
    };
}

const withoutId = row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'id'));

const layersView = layers => (layers || []).map((layer, index) => ({
    index, material: layer.material, thickness: layer.thickness, ...(layer.locked ? { locked: true } : {}),
}));

// `{ [name]: value }` when the value is set, nothing otherwise.
const ifSet = (name, value) => (typeof value === 'number' && Number.isFinite(value) ? { [name]: value } : {});

/**
 * A design as the tools show it: media, substrate (thickness and, when set,
 * diameter in mm), the temperatures the stress tool reads in °C, each when set,
 * surface mode and how a one-sided design is scored, each side's layers as the design stores them (the front from the
 * incident medium inward, the back from the substrate outward; thickness in
 * nm), and the merit rows, in full with `rows`, as a count otherwise. With
 * `rows` it also gives the specification's checks as the design holds them,
 * each with its id, which marks it to setSpecification as a check the design
 * holds.
 */
export function designView(id, design, { rows = false } = {}) {
    const operands = design.meritOperands || [];
    return {
        designId: id, name: design.name ?? null, surfaceMode: design.surfaceMode ?? 'front_only', mfEvalMode: design.mfEvalMode ?? 'side',
        incidentMedium: design.incidentMedium, exitMedium: design.exitMedium,
        substrate: {
            material: design.substrate?.material, thicknessMm: design.substrate?.thickness,
            ...ifSet('diameterMm', design.substrate?.diameterMm),
        },
        ...ifSet('stressTemperatureC', design.stress?.temperatureC),
        ...ifSet('depositionTemperatureC', design.stress?.depositionTemperatureC),
        referenceWavelength: design.referenceWavelength ?? null,
        front: layersView(design.frontLayers), back: layersView(design.backLayers),
        ...(rows ? { meritRows: operands.map(withoutId), specification: design.qualifiers || [] } : { meritRowCount: operands.length }),
    };
}

/** Whether two designs have the same layers on both sides. */
export function sameLayers(a, b) {
    const key = d => JSON.stringify([layersView(d.frontLayers), layersView(d.backLayers)]);
    return key(a) === key(b);
}
