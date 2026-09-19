/**
 * The conditions a file states beside its numbers, and the curves they cut a
 * flat table into.
 *
 * An ellipsometer writes the angle of incidence as a header setting or as a
 * column next to the wavelength; an imaging ellipsometer adds the region of
 * the sample each row belongs to. Neither is a spectrum. A file that varies
 * one of them repeats its wavelengths once per value, and each spectrum column
 * is then one curve per value, which the characterization module can pair and
 * fit without a new multidimensional curve type.
 */

import { parseNumber } from './numberParsing.js';

// The incidence angle a header states: `AOI 70`, `Angle of incidence: 70`.
function headerAoi(headerLines, decimal) {
    const label = /(?:\baoi\b|angle\s+of\s+incidence|incidence\s+angle)/i;
    for (const line of headerLines) {
        const hit = String(line || '').match(label);
        if (!hit) continue;
        const tail = line.slice((hit.index || 0) + hit[0].length);
        const number = tail.match(/[-+]?\d+(?:[.,]\d+)?/);
        const value = number ? parseNumber(number[0], decimal) : NaN;
        if (isAngle(value)) return value;
    }
    return null;
}

function isAoiColumn(column) {
    const label = `${column?.baseName || column?.name || ''} ${column?.unit || ''}`.trim();
    return /^(?:aoi\b|angle\s+of\s+incidence\b|incidence\s+angle\b)/i.test(label);
}

// The region of interest an imaging ellipsometer measured, written as an index
// column: "ROIidx", "ROI index", "ROI_id". The region's position columns,
// "ROI_x" and "ROI_y", are ordinary values and stay out of this.
function isRoiColumn(column) {
    const label = String(column?.baseName || column?.name || '').trim();
    return /^roi(?:[\s_-]?(?:idx|index|id|no|number|#))?$/i.test(label);
}

const isAngle = value => Number.isFinite(value) && value >= 0 && value <= 90;
const near = (list, value) => list.find(entry => Math.abs(entry - value) <= 1e-7);
const withAoi = (column, aoi) => (Number.isFinite(aoi) ? { ...column, aoi } : column);
const angleLabel = aoi => ` @${Number.isInteger(aoi) ? aoi : aoi.toFixed(3)}°`;

// An angle written into a column's own name, "Psi @55°". A variable-angle file
// carries an angle per column and has no single one to state in its header, so
// the name is the only place it fits, which is where the split above writes it
// and where an export of those curves brings it back.
const NAME_ANGLE = /@\s*([-+]?\d+(?:[.,]\d+)?)\s*°/;

function nameAngle(column, decimal) {
    const hit = String(column?.name || '').match(NAME_ANGLE);
    const value = hit ? parseNumber(hit[1], decimal) : NaN;
    return isAngle(value) ? value : null;
}

// The distinct values of a condition column, in the order the file first
// states each one.
function distinct(values, accept = Number.isFinite) {
    const output = [];
    for (const value of values || []) {
        if (accept(value) && near(output, value) === undefined) output.push(value);
    }
    return output;
}

// The rows sorted into the conditions they were taken under.
function rowGroups(aoiColumn, roiColumn, aois, rois) {
    const rowCount = (aoiColumn || roiColumn).values.length;
    const groups = new Map();
    for (let row = 0; row < rowCount; row++) {
        const aoi = aoiColumn ? near(aois, aoiColumn.values[row]) : null;
        const roi = roiColumn ? near(rois, roiColumn.values[row]) : null;
        if (aoi === undefined || roi === undefined) continue;
        const key = `${aoi}|${roi}`;
        if (!groups.has(key)) groups.set(key, { aoi, roi, rows: [] });
        groups.get(key).rows.push(row);
    }
    return [...groups.values()];
}

// The spectrum columns under the conditions stated per row. One condition is
// the ordinary case, and the columns pass through with the angle attached.
function columnsByCondition(columns, { aoiColumn, roiColumn, declaredAoi }) {
    const spectra = columns.filter(column => column !== aoiColumn && column !== roiColumn);
    const aois = aoiColumn ? distinct(aoiColumn.values, isAngle) : [];
    const rois = roiColumn ? distinct(roiColumn.values) : [];
    const fileAoi = aois.length ? aois[0] : declaredAoi;
    if (aois.length <= 1 && rois.length <= 1) {
        return {
            columns: spectra.map(column => withAoi(column, fileAoi)),
            aois: [fileAoi].filter(isAngle),
        };
    }

    const suffix = group => (aois.length > 1 ? angleLabel(group.aoi) : '')
        + (rois.length > 1 ? ` (ROI ${group.roi})` : '');
    // A condition column none of whose values are usable states nothing, and
    // grouping rows by it would match no row and leave the file with no curves
    // at all. It is still not a spectrum, so it stays out of the columns.
    const groups = rowGroups(aois.length ? aoiColumn : null, rois.length ? roiColumn : null, aois, rois);
    return {
        aois: aois.length ? aois : [declaredAoi].filter(isAngle),
        columns: spectra.flatMap(column => groups.map(group => withAoi({
            ...column,
            name: column.name + suffix(group),
            x: group.rows.map(row => column.x[row]),
            values: group.rows.map(row => column.values[row]),
        }, group.aoi ?? fileAoi))),
    };
}

/**
 * The curves a file's columns become under the conditions it states, and the
 * distinct angles among them.
 *
 * @param {object[]} columns  built columns, condition columns included
 * @param {object} source
 *   source.headerLines  the file's header, for an angle stated there
 *   source.decimal      '.' or ','
 *   source.headerAois   an angle per column index from the header layout, or
 *                       [] when the header states none per column; a
 *                       CompleteEASE variable-angle export states one
 * @returns {{ columns: object[], aois: number[] }}
 */
export function columnsUnderConditions(columns, { headerLines, decimal, headerAois }) {
    const byCondition = columnsByCondition(columns, {
        aoiColumn: columns.find(isAoiColumn) || null,
        roiColumn: columns.find(isRoiColumn) || null,
        declaredAoi: headerAoi(headerLines, decimal),
    });
    // A column that states its own angle, in the header's angle list or in its
    // name, is taken at its word: it is more specific than anything the file
    // says about all of its columns at once.
    const stated = byCondition.columns.map(column =>
        withAoi(column, headerAois[column.index] ?? nameAngle(column, decimal)));
    const aois = distinct(stated.map(column => column.aoi), isAngle);
    return { columns: stated, aois: aois.length ? aois : byCondition.aois };
}
