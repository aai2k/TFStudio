// Small helpers shared by the parts of a Structural run.

export const deep = value => JSON.parse(JSON.stringify(value));

/** Total physical thickness of `layers`, in nm. */
export const sumD = layers => (layers || []).reduce((sum, layer) => sum + (Number(layer.thickness) || 0), 0);

export const mkLayers = layers => (layers || []).map(layer => ({
    id: layer.id, material: layer.material, thickness: layer.thickness || 0, locked: !!layer.locked,
}));
