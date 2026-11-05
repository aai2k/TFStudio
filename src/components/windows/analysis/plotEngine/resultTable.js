/**
 * The plotted data as rows.
 *
 * Curves are written long: one row per sample, tagged with the curve it belongs
 * to. Each curve carries its own x axis — one may run over wavelength and the
 * next over angle — so there is no single grid to lay them side by side on.
 * A surface is written as its grid, one row per (x, y) point.
 */

import { isFraction } from '../../../../utils/physics/plotQuantities.js';
import { surfaceZLabel, surfaceZTitle } from './charts/surfaceOption.js';

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

// The grid holds T, R and A as fractions, which the table writes as they are,
// so their heading carries no unit.
function zHeading(t, result) {
    if (!result?.zKey) return t.plotEngine.colZ;
    return isFraction(result.zKey) ? surfaceZLabel(result, t) : surfaceZTitle(result, t);
}

export function surfaceColumns(t, result) {
    const pe = t.plotEngine;
    return [
        { key: 'x', label: pe.colX, fmt: value => value.toFixed(4) },
        { key: 'y', label: pe.colY, fmt: value => value.toFixed(4) },
        { key: 'z', label: zHeading(t, result), fmt: value => value.toFixed(6) },
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
