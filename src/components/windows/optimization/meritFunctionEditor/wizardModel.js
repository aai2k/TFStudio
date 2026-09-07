import { FILTER_TYPES, isDmfs } from '../../../../utils/physics/optimizer.js';

// Field keys the wizard shows side by side on one row, and the locale key of
// that row's label.
const PAIRS = [
    ['lamStart', 'lamEnd', 'lam'],
    ['stopStart', 'stopEnd', 'stop'],
    ['passStart', 'passEnd', 'pass'],
    ['lowStopStart', 'lowStopEnd', 'lowStop'],
    ['highStopStart', 'highStopEnd', 'highStop'],
    ['lowPassStart', 'lowPassEnd', 'lowPass'],
    ['highPassStart', 'highPassEnd', 'highPass'],
    ['rsPct', 'rpPct', 'rsRp'],
    ['tStart', 'tEnd', 'tRange'],
];

// The custom target's channel, comparison and value read as one statement.
const STATEMENT = ['channel', 'cmp', 'valuePct'];

function rowFor(key, keys) {
    if (key === STATEMENT[0] && STATEMENT.every(k => keys.includes(k))) {
        return { kind: 'statement', label: 'statement', keys: STATEMENT };
    }
    const pair = PAIRS.find(([start, end]) => start === key && keys.includes(end));
    if (pair) return { kind: 'pair', label: pair[2], keys: [pair[0], pair[1]] };
    return { kind: 'single', label: key, keys: [key] };
}

/**
 * The rows the Preset box shows for a filter type. Each row is one label and
 * the fields it holds, in the type's own field order except that the λ range
 * always comes first, so every type reads the same way.
 */
export function fieldRows(typeId) {
    const def = FILTER_TYPES[typeId];
    if (!def) return [];
    const keys = def.fields.map(field => field.key);
    const rows = [];
    const placed = new Set();
    for (const key of keys) {
        if (placed.has(key)) continue;
        const row = rowFor(key, keys);
        row.keys.forEach(k => placed.add(k));
        rows.push(row);
    }
    const lam = rows.findIndex(row => row.label === 'lam');
    if (lam > 0) rows.unshift(...rows.splice(lam, 1));
    return rows;
}

/** Field definition for `key` within a filter type. */
export function fieldDef(typeId, key) {
    return FILTER_TYPES[typeId]?.fields.find(field => field.key === key) || null;
}

/** Whether the type sets polarization itself, so the Pol control is not shown. */
export function polIsFixed(typeId) {
    return !!FILTER_TYPES[typeId]?.fixedPol;
}

/** Whether the type offers continuous or discrete spectral targets. */
export function hasTargetMode(typeId) {
    return !!FILTER_TYPES[typeId]?.supportsTargetMode;
}

/**
 * What a generated block amounts to: the number of operand rows and the
 * operand types they use, in order of first appearance. The DMFS header row
 * is not counted.
 */
export function blockSummary(block) {
    const rows = block.filter(op => !isDmfs(op.type));
    const types = [];
    for (const op of rows) if (!types.includes(op.type)) types.push(op.type);
    return { count: rows.length, types };
}

/** Short text for the collapsed header: type name, λ range, angle. */
export function wizardSummary({ typeLabel, params, aoi, aoiEnd }) {
    const parts = [typeLabel];
    if (params.lamStart != null && params.lamEnd != null) parts.push(`${params.lamStart}–${params.lamEnd} nm`);
    parts.push(aoi === aoiEnd ? `${aoi}°` : `${aoi}–${aoiEnd}°`);
    return parts.join(' · ');
}
