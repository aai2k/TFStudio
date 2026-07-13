export function displayLayerNumber(row, frontCount) {
    return row.side === 'back' ? row.layerIndex + 1 : frontCount - row.layerIndex;
}

export function displayLayerLabel(row, frontCount) {
    return (row.side === 'back' ? 'B' : 'F') + displayLayerNumber(row, frontCount);
}

export function orderSubstrateFirst(rows, frontCount) {
    return [...rows].sort((a, b) => {
        if (a.side !== b.side) return a.side === 'back' ? 1 : -1;
        return displayLayerNumber(a, frontCount) - displayLayerNumber(b, frontCount);
    });
}

export function rankSensitivityRows(rows) {
    const ranked = rows.map((row, index) => ({ ...row, _orig: index }));
    ranked.sort((a, b) => b.deltaMFAbs - a.deltaMFAbs);
    for (let index = 0; index < ranked.length; index++) ranked[index].rank = index + 1;
    ranked.sort((a, b) => a._orig - b._orig);
    return ranked;
}

export function hasSensitivityLayers(design) {
    const surfaceMode = design?.surfaceMode || 'front_only';
    const hasFront = !!design?.frontLayers?.length;
    const hasBack = !!design?.backLayers?.length;
    if (surfaceMode === 'back_only') return hasBack;
    if (surfaceMode === 'both_independent') return hasFront || hasBack;
    return hasFront;
}

export function buildSpecDesigns(design, mode, relPct, absDeltaNm) {
    if (!design) return [];
    const perturb = sign => {
        const perturbLayer = layer => {
            const thickness = layer.thickness || 0;
            const nextThickness = mode === 'absolute'
                ? Math.max(0, thickness + sign * absDeltaNm)
                : Math.max(0, thickness * (1 + sign * relPct / 100));
            return { ...layer, thickness: nextThickness };
        };
        return {
            ...design,
            frontLayers: (design.frontLayers || []).map(perturbLayer),
            backLayers: (design.backLayers || []).map(perturbLayer),
        };
    };
    return [perturb(1), perturb(-1)];
}

export function buildSensitivityViewModel(design, result) {
    const rows = result?.rows || [];
    const frontCount = design?.frontLayers?.length || 0;
    return {
        rows,
        frontCount,
        orderedRows: orderSubstrateFirst(rows, frontCount),
        peakRank1: rows.reduce(
            (peak, row) => row.deltaMFAbs > (peak?.deltaMFAbs ?? -1) ? row : peak,
            null,
        ),
    };
}
