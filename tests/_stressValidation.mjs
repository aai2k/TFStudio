/**
 * Test helper: the validation design of
 * `validation/macleod/Stress validation case/`, built as a TFStudio design, for
 * the Stress window, the STR row and the API's `stress` to read alike.
 *
 * Four films, all compressive at the first of the three dialog settings
 * (20 °C, deposited at 3000 °C), on a 15 mm substrate 33 mm across. Essential
 * Macleod's table for it: radius 1050 m, centre deflection 0.000129 mm, total
 * strain energy 53.1 J/m², cracking parameter 34.8.
 */

/** Lossless n = 2 optics; the case is about mechanics alone. */
export const OPTICS = { formulaNum: -1, tabData: [[400, 2.0, 0], [700, 2.0, 0]] };

export const MATERIALS = {
    'user_m:H': {
        id: 'H', name: 'TFS Stress H', ...OPTICS,
        mechanical: {
            youngsModulusGPa: 200, poissonsRatio: 0.25, linearExpansionPerK: 3.0e-6,
            intrinsicStressMPa: -300, referenceTemperatureC: 300, surfaceEnergyJm2: 1.0,
        },
    },
    'user_m:L': {
        id: 'L', name: 'TFS Stress L', ...OPTICS,
        mechanical: {
            youngsModulusGPa: 70, poissonsRatio: 0.17, linearExpansionPerK: 10.0e-6,
            intrinsicStressMPa: 150, referenceTemperatureC: 200, surfaceEnergyJm2: 0.3,
        },
    },
    'user_m:Sub': {
        id: 'Sub', name: 'TFS Stress Sub', ...OPTICS,
        mechanical: {
            youngsModulusGPa: 80, poissonsRatio: 0.22, linearExpansionPerK: 5.0e-6,
            surfaceEnergyJm2: 0.5,
        },
    },
};

// Essential Macleod numbers layers from the incident medium, and TFStudio
// stores a front coating air-first, so this list is in the program's own
// order: its layer 1 is next to the medium.
const FRONT = [
    { id: 'F1', material: 'user_m:H', thickness: 300 },
    { id: 'F2', material: 'user_m:L', thickness: 250 },
    { id: 'F3', material: 'user_m:H', thickness: 450 },
    { id: 'F4', material: 'user_m:L', thickness: 400 },
];

/** The validation design on the front, with `overrides` laid over it. */
export function validationDesign(overrides = {}) {
    return {
        name: 'Stress validation case',
        incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
        substrate: { material: 'user_m:Sub', thickness: 15, diameterMm: 33 },
        frontLayers: FRONT.map(layer => ({ ...layer })),
        backLayers: [],
        surfaceMode: 'front_only', mfEvalMode: 'side',
        stress: { temperatureC: 20, depositionTemperatureC: 3000 },
        materials: MATERIALS,
        ...overrides,
    };
}

/**
 * The same four films as a back stack. A back stack is stored substrate first,
 * so it is the front reversed: the same films outward from the substrate.
 */
export function validationBack() {
    return [...FRONT].reverse().map(layer => ({ ...layer, id: 'B' + layer.id.slice(1) }));
}
