import {
    FILTER_TYPES, convertCustomTargetValue, customTargetStatement, customTargetWritesPoints,
    defaultFilterParams, isDmfs,
} from '../../../../utils/physics/optimizer.js';

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

// The custom target's channel, unit, comparison and value read as one
// statement: T in dB ≥ −0.5.
const STATEMENT = ['channel', 'unit', 'cmp', 'valuePct'];

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

/**
 * What one field shows for the current parameters: its value, the options a
 * select offers and the bounds of a number. A select whose stored value the
 * other fields rule out shows the first value it still offers, which is also
 * what Generate writes.
 */
export function fieldView(typeId, key, params) {
    const def = fieldDef(typeId, key);
    if (!def) return null;
    const all = { ...defaultFilterParams(typeId), ...params };
    const allowed = def.available ? def.available(all) : null;
    const options = allowed ? def.options.filter(option => allowed.includes(option.value)) : def.options;
    const stored = all[key];
    const value = allowed && !allowed.includes(stored) ? allowed[0] : stored;
    const bounds = def.boundsFor ? def.boundsFor(all) : def;
    return { def, value, options, min: bounds.min, max: bounds.max, step: bounds.step ?? 1 };
}

/**
 * The parameters after one field changes. A Custom Target whose unit changes,
 * by choice or because the channel no longer takes it, has its value moved to
 * the new unit at the same level of T or R, so 80 % becomes −0.97 dB.
 */
export function paramsWithChange(typeId, params, key, value) {
    const next = { ...params, [key]: value };
    if (!fieldDef(typeId, 'unit')) return next;
    const all = { ...defaultFilterParams(typeId), ...params };
    const before = customTargetStatement(all).unit;
    const after = customTargetStatement({ ...all, [key]: value }).unit;
    if (before !== after) next.valuePct = convertCustomTargetValue(all.valuePct, before, after);
    return next;
}

/** Whether the type writes point rows on the wavelength step whatever the target mode. */
export function writesPointsOnly(typeId, params) {
    if (!fieldDef(typeId, 'unit')) return false;
    return customTargetWritesPoints({ ...defaultFilterParams(typeId), ...params });
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
