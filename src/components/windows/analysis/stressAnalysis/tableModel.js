/**
 * The two tables: what the part does as a whole, and what each film carries.
 *
 * A quantity the design does not have the constants for prints as a dash, not
 * as a zero. The notice badge says which constant is missing.
 */

const DASH = '—';

function fixed(digits) {
    return value => (value == null ? DASH : value.toFixed(digits));
}

// A radius runs from a metre on a bowed wafer to thousands on a flat one, and a
// deflection from a nanometre to a millimetre, so neither reads well at a fixed
// number of decimals.
function significant(digits) {
    return value => (value == null ? DASH : Number(value.toPrecision(digits)).toString());
}

/** The whole-part table: one quantity per row, so it needs no unit column. */
export function wholeRows(whole, sa) {
    return [
        { quantity: sa.filmForce, unit: 'N/m', value: whole.forceNm, fmt: fixed(3) },
        { quantity: sa.radius, unit: 'm', value: whole.radiusM, fmt: significant(4) },
        { quantity: sa.deflection, unit: 'µm', value: whole.deflectionUm, fmt: significant(4) },
        { quantity: sa.totalStrainEnergy, unit: 'J/m²', value: whole.strainEnergy, fmt: fixed(3) },
        { quantity: sa.crackingParameter, unit: '', value: whole.cracking, fmt: fixed(3) },
    ].map(row => ({ ...row, display: row.fmt(row.value) }));
}

export function wholeColumns(sa) {
    return [
        { key: 'quantity', label: sa.colQuantity, align: 'left' },
        { key: 'display', label: sa.colValue, csv: sa.colValue },
        { key: 'unit', label: sa.colUnit, align: 'left' },
    ];
}

/**
 * The per-film table. The side column appears only when both coatings count,
 * since each side numbers its own layers from the substrate out and two rows
 * would otherwise read as one layer twice.
 */
export function filmColumns(sa, bothSides) {
    return [
        ...(bothSides ? [{ key: 'sideLabel', label: sa.colSide, align: 'left' }] : []),
        { key: 'layerNumber', label: sa.colLayer },
        { key: 'materialName', label: sa.colMaterial, align: 'left' },
        { key: 'thicknessNm', label: sa.colThickness, fmt: fixed(2) },
        { key: 'stressMPa', label: sa.colStress, fmt: fixed(2) },
        { key: 'strainEnergy', label: sa.colStrainEnergy, fmt: fixed(4) },
        { key: 'delamination', label: sa.colDelamination, fmt: fixed(3) },
        { key: 'shearMPa', label: sa.colShear, fmt: fixed(2) },
    ];
}

export function filmRows(rows, sa) {
    return rows.map(row => ({ ...row, sideLabel: row.side === 'back' ? sa.back : sa.front }));
}

/**
 * Chart label for one film. A single coating is numbered plainly; with both, a
 * one-letter side tag keeps 1, 2, 1, 2 from reading as a mistake.
 */
export function barLabel(row, sa, bothSides) {
    const tag = row.side === 'back' ? sa.backTag : sa.frontTag;
    return bothSides ? `${tag}${row.layerNumber}` : String(row.layerNumber);
}
