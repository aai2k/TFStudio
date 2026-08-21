/**
 * The plotted data as rows.
 *
 * Curves are written long: one row per sample, tagged with the curve it belongs
 * to. Each curve carries its own x axis — one may run over wavelength and the
 * next over angle — so there is no single grid to lay them side by side on.
 * A surface is written as its grid, one row per (x, y) point.
 */

export function curveColumns(t) {
    const pe = t.plotEngine;
    return [
        { key: 'curve', label: pe.colCurve, align: 'left' },
        { key: 'x', label: pe.colX, fmt: value => value.toFixed(4) },
        { key: 'y', label: pe.colY, fmt: value => value.toFixed(6) },
    ];
}

export function curveRows(curves, results) {
    const rows = [];
    for (const curve of curves || []) {
        const data = results?.[curve.id];
        if (!data?.x?.length) continue;
        for (let index = 0; index < data.x.length; index++) {
            rows.push({ curve: curve.label || curve.id, x: data.x[index], y: data.y[index] });
        }
    }
    return rows;
}

export function surfaceColumns(t, result) {
    const pe = t.plotEngine;
    return [
        { key: 'x', label: pe.colX, fmt: value => value.toFixed(4) },
        { key: 'y', label: pe.colY, fmt: value => value.toFixed(4) },
        { key: 'z', label: result?.zLabel || pe.colZ, fmt: value => value.toFixed(6) },
    ];
}

export function surfaceRows(result) {
    if (!result?.ok || !result.x?.length || !result.y?.length) return [];
    const rows = [];
    for (let row = 0; row < result.y.length; row++) {
        const values = result.z?.[row];
        if (!values) continue;
        for (let column = 0; column < result.x.length; column++) {
            rows.push({ x: result.x[column], y: result.y[row], z: values[column] });
        }
    }
    return rows;
}
