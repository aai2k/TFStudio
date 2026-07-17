export const deep = value => JSON.parse(JSON.stringify(value));

export const sumD = layers => (layers || []).reduce((sum, layer) => sum + (Number(layer.thickness) || 0), 0);

export const mkLayers = layers => (layers || []).map(layer => ({
    id: layer.id, material: layer.material, thickness: layer.thickness || 0, locked: !!layer.locked,
}));

export const alive = (ctx, S) => ctx.runningRef.current && ctx.runIdRef.current === S.runId;
