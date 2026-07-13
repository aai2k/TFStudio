export function quantityMeta(quantity, text) {
    switch (quantity) {
        case 'phase': return { key: 'phaseDeg', label: text.phaseAxis, unit: '°', dp: 2, color: '#ab47bc' };
        case 'gd': return { key: 'gd', label: text.gdAxis, unit: 'fs', dp: 3, color: '#4fc3f7' };
        case 'gdd': return { key: 'gdd', label: text.gddAxis, unit: 'fs²', dp: 3, color: '#ef5350' };
        case 'tod': return { key: 'tod', label: text.todAxis, unit: 'fs³', dp: 3, color: '#66bb6a' };
        default: return { key: 'gd', label: text.gdAxis, unit: 'fs', dp: 3, color: '#4fc3f7' };
    }
}

function buildPlotData(raw, meta, quantity, referenceLambda, showReference) {
    if (!raw || !raw.lambda.length) return null;
    let y = raw[meta.key];
    if (quantity === 'phase' && showReference) {
        let closestIndex = 0;
        let closestDistance = Infinity;
        for (let i = 0; i < raw.lambda.length; i++) {
            const distance = Math.abs(raw.lambda[i] - referenceLambda);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = i;
            }
        }
        const offset = y[closestIndex];
        y = y.map(value => value - offset);
    }
    return { lambda: raw.lambda, y };
}

function buildTable(raw) {
    const columns = [];
    const rows = [];
    if (!raw?.lambda?.length) return { columns, rows };
    const available = {
        phase: Array.isArray(raw.phaseDeg),
        gd: Array.isArray(raw.gd),
        gdd: Array.isArray(raw.gdd),
        tod: Array.isArray(raw.tod),
    };
    columns.push({ key: 'lambda', label: 'λ (nm)', align: 'left', fmt: value => value.toFixed(1) });
    if (available.gd) columns.push({ key: 'gd', label: 'GD (fs)', fmt: value => value.toFixed(3) });
    if (available.gdd) columns.push({ key: 'gdd', label: 'GDD (fs²)', fmt: value => value.toFixed(3) });
    if (available.phase) columns.push({ key: 'phase', label: 'Phase (°)', fmt: value => value.toFixed(2) });
    if (available.tod) columns.push({ key: 'tod', label: 'TOD (fs³)', fmt: value => value.toFixed(3) });
    for (let i = 0; i < raw.lambda.length; i++) {
        const row = { lambda: raw.lambda[i] };
        if (available.gd) row.gd = raw.gd[i];
        if (available.gdd) row.gdd = raw.gdd[i];
        if (available.phase) row.phase = raw.phaseDeg[i];
        if (available.tod) row.tod = raw.tod[i];
        rows.push(row);
    }
    return { columns, rows };
}

export function buildGdGddView(raw, options, text) {
    const meta = quantityMeta(options.quantity, text);
    const table = buildTable(raw);
    return {
        meta,
        plotData: buildPlotData(raw, meta, options.quantity, options.referenceLambda, options.showReference),
        tableColumns: table.columns,
        tableRows: table.rows,
    };
}

export function buildLayerSummary(design, side) {
    const layers = (side === 'back' ? design.backLayers : design.frontLayers) || [];
    const visibleLayers = layers.filter(layer => layer.material && layer.thickness > 0);
    return {
        layerCount: visibleLayers.length,
        totalThickness: visibleLayers.reduce((sum, layer) => sum + layer.thickness, 0),
    };
}
