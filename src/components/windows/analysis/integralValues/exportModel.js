/**
 * The results table as plain rows, for the export control. The table on screen
 * stays editable and is rendered by ResultsTable; this is the same data in the
 * shape `csvFromRows` writes.
 */

function band(weighting) {
    return weighting.lamMin === weighting.lamMax
        ? ''
        : `${weighting.lamMin.toFixed(0)}-${weighting.lamMax.toFixed(0)} nm`;
}

export function exportColumns(t) {
    const iv = t.integralValues;
    return [
        { key: 'label', label: iv.col_integral },
        { key: 'value', label: iv.col_value },
        { key: 'percent', label: '%' },
        { key: 'min', label: iv.col_min },
        { key: 'lamAtMin', label: `${iv.col_min} λ (nm)` },
        { key: 'max', label: iv.col_max },
        { key: 'lamAtMax', label: `${iv.col_max} λ (nm)` },
        { key: 'band', label: iv.col_band },
    ];
}

export function exportRows(integrals, results) {
    if (!results) return [];
    return (integrals || []).map(definition => {
        const result = results[definition.key];
        return {
            label: definition.label,
            value: result ? result.value : null,
            percent: result ? result.value * 100 : null,
            min: result ? result.min : null,
            lamAtMin: result ? result.lamAtMin : null,
            max: result ? result.max : null,
            lamAtMax: result ? result.lamAtMax : null,
            band: band(definition.weighting),
        };
    });
}
