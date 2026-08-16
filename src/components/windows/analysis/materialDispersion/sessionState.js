/** Control state kept for the lifetime of the app session. */

const DEFAULT_STATE = Object.freeze({
    materialId: 'builtin:SiO2',
    thicknessMm: 1,
    thicknessUnit: 'mm',
    quantity: 'gdd',
    start: 400,
    end: 1100,
    showTable: false,
});

let sessionState = { ...DEFAULT_STATE };

export function readMaterialDispersionSession() {
    return { ...sessionState };
}

export function writeMaterialDispersionSession(next) {
    sessionState = { ...sessionState, ...next };
    return readMaterialDispersionSession();
}
