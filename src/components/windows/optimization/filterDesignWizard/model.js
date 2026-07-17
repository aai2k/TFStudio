import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { getMaterial } from '../../../../utils/materials/materialDatabase.js';
import { materialIndexFn, qwThickness, couplingOrder } from '../../../../utils/filter/filterDesign.js';

// Thelen coupling order δ (Eq. 10) from the chosen materials.
export function couplingD(p) {
    const nH = materialIndexFn(p.matH, getMaterialById)(p.lambda0_nm)[0];
    const nL = materialIndexFn(p.matL, getMaterialById)(p.lambda0_nm)[0];
    const nS = materialIndexFn(p.substrateMaterial, getMaterialById)(p.lambda0_nm)[0];
    return couplingOrder(nH, nL, nS);
}

// ── Defaults ──────────────────────────────────────────────────────────────────
export const DEFAULTS = {
    matH: 'builtin:Nb2O5', matL: 'builtin:SiO2',
    substrateMaterial: 'builtin:BK7', substrateThicknessMm: 1.0,
    incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
    lambda0_nm: 600,
    passHalf_nm: 1.5,          // Δλ @ passLevel
    stopHalf_nm: 4.5,          // Δλ @ stopLevel
    passLevel: 89.13,          // % (0.5 dB)
    stopLevel: 0.1,            // % (30 dB)
    cavities: null,            // null → auto
    spacerKind: 'L',
    aoi: 0, pol: 'avg', oblique: false,
    // prototype selection (step 4)
    seedMirror: null, seedSpacer: null,
    // integer-search options (step 5)
    symMirrors: false, symCavities: false, restarts: 14,
    // chosen candidate + AR (step 5/6)
    selected: null,            // { mirrors, spacers, mf, layers, thicknessNm }
    arMode: 'vcoat',
    name: 'Filter Design',
};

export function shapeFactor(p) { return p.passHalf_nm > 0 ? p.stopHalf_nm / p.passHalf_nm : 0; }

export function resolveMat(id) { return getMaterialById(id) || getMaterial(id) || getMaterial('Air'); }

// Runs fn(), falling back to `fallback` on any thrown error — used by preview
// computations that must never crash the wizard on transient invalid input.
export function safeCall(fn, fallback) {
    try { return fn(); } catch { return fallback; }
}
