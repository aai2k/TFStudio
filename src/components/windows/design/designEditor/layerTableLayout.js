/** Shared column geometry for the Design Editor header and layer rows. */
export const LAYER_THICKNESS_COLUMNS = Object.freeze([
    { unit: 'nm', label: 'd (nm)', title: 'Physical thickness (nm) — editable', primary: true },
    { unit: 'OT', label: 'OT', title: 'Optical thickness n·d (nm)' },
    { unit: 'QWOT', label: 'QW', title: 'Quarter-wave optical thickness 4·n·d/λ₀' },
    { unit: 'FWOT', label: 'FW', title: 'Full-wave optical thickness n·d/λ₀' },
]);

export const LAYER_TABLE = Object.freeze({
    gap: 2,
    scrollInset: 4,
    numberWidth: 32, // compact drag handle plus a three-digit layer index
    materialMinWidth: 92,
    materialTextInset: 22, // picker padding + color swatch + spacing
    numericTextInset: 4,
    thicknessWidth: 52,
    lockWidth: 22,
    actionsWidth: 24,
});

const TRACK_COUNT = 8; // number, material, four thicknesses, lock, delete
const ROW_INSET = 10; // 4 px row padding and a 2 px selection border

export const LAYER_TABLE_MIN_WIDTH = ROW_INSET
    + LAYER_TABLE.numberWidth
    + LAYER_TABLE.materialMinWidth
    + LAYER_THICKNESS_COLUMNS.length * LAYER_TABLE.thicknessWidth
    + LAYER_TABLE.lockWidth
    + LAYER_TABLE.actionsWidth
    + (TRACK_COUNT - 1) * LAYER_TABLE.gap;

export function fixedLayerTrack(width, extra = {}) {
    return { width, flexShrink: 0, ...extra };
}

export function materialLayerTrack(extra = {}) {
    return {
        flex: `1 0 ${LAYER_TABLE.materialMinWidth}px`,
        minWidth: LAYER_TABLE.materialMinWidth,
        overflow: 'hidden',
        ...extra,
    };
}

export function shiftedThicknessUnit(unit, delta) {
    const index = Math.max(0, LAYER_THICKNESS_COLUMNS.findIndex(column => column.unit === unit));
    const next = Math.max(0, Math.min(LAYER_THICKNESS_COLUMNS.length - 1, index + delta));
    return LAYER_THICKNESS_COLUMNS[next].unit;
}

/** Excel-style destination after committing a thickness cell. */
export function nextThicknessCell(rows, rowId, unit, direction) {
    const rowIndex = rows.findIndex(row => row.id === rowId);
    const unitIndex = LAYER_THICKNESS_COLUMNS.findIndex(column => column.unit === unit);
    if (rowIndex < 0 || unitIndex < 0) return null;

    let nextRow = rowIndex;
    let nextUnit = unitIndex;
    if (direction === 'up') nextRow--;
    else if (direction === 'down') nextRow++;
    else if (direction === 'left') {
        nextUnit--;
        if (nextUnit < 0) { nextUnit = LAYER_THICKNESS_COLUMNS.length - 1; nextRow--; }
    } else if (direction === 'right') {
        nextUnit++;
        if (nextUnit >= LAYER_THICKNESS_COLUMNS.length) { nextUnit = 0; nextRow++; }
    }

    if (nextRow < 0 || nextRow >= rows.length) return null;
    return { rowId: rows[nextRow].id, unit: LAYER_THICKNESS_COLUMNS[nextUnit].unit };
}
