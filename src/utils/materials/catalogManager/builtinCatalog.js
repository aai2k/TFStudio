import { MATERIALS } from '../materialDatabase.js';

/** Wrap materialDatabase.js's built-in materials as a catalogManager catalog. */
export function buildBuiltinCatalog() {
    const mats = {};
    for (const m of MATERIALS) {
        // Real validity range (nm) attached to getNK by materialDatabase.js — the
        // exact tabulated extent for table materials, the literature range for the
        // Sellmeier fits. Fall back to a broad span for range-less entries (Air,
        // Custom). Stored in µm to match the rest of the material schema.
        const r = (typeof m.getNK === 'function' && m.getNK.rangeNm) || null;
        mats[m.id] = {
            id: m.id,
            name: m.name,
            formulaNum: 0,          // 0 = built-in JS function
            coefficients: [],
            lambdaMin: r ? r[0] / 1000 : 0.2,
            lambdaMax: r ? r[1] / 1000 : 20.0,
            kTable: [],
            nd: null,
            vd: null,
            density: null,
            comment: m.description || '',
            color: m.color,
            group: m.group,
            getNK: m.getNK,         // direct function reference
        };
    }
    return {
        id: 'builtin',
        name: 'Built-in',
        source: 'builtin',
        materials: mats,
    };
}
