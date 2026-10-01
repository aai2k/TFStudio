import { MATERIALS } from '../materialDatabase.js';

/** Wrap materialDatabase.js's built-in materials as a catalogManager catalog. */
export function buildBuiltinCatalog() {
    const mats = {};
    for (const m of MATERIALS) {
        // Real validity range (nm) attached to getNK by materialDatabase.js — the
        // exact tabulated extent for table materials, the literature range for the
        // Sellmeier fits. Fall back to a broad span for a range-less entry (Air).
        // Stored in µm to match the rest of the material schema.
        const r = (typeof m.getNK === 'function' && m.getNK.rangeNm) || null;
        mats[m.id] = {
            id: m.id,
            name: m.name,
            formulaNum: 0,          // 0 = built-in JS function
            coefficients: [],
            lambdaMin: r ? r[0] / 1000 : 0.2,
            lambdaMax: r ? r[1] / 1000 : 20.0,
            rangeDeclared: !!r,
            kTable: [],
            nd: null,
            vd: null,
            density: null,
            comment: m.description || '',
            color: m.color,
            group: m.group,
            getNK: m.getNK,         // direct function reference
            ...(m.getNK?.interp ? { interp: m.getNK.interp } : {}),
        };
    }
    return {
        id: 'builtin',
        name: 'Built-in',
        source: 'builtin',
        materials: mats,
    };
}

/**
 * A built-in catalog material as rows [λ nm, n, k], for a copy that has to
 * store data rather than a function. A table material gives its own rows, so
 * the copy computes what the original does; any other is sampled at 200 even
 * steps over its range.
 */
export function builtinMaterialRows(mat) {
    const table = mat.getNK.tabData;
    if (table) return table.map(row => [...row]);
    const lo = Math.round((mat.lambdaMin || 0.2) * 1000);
    const hi = Math.round((mat.lambdaMax || 2.5) * 1000);
    const N = 200;
    const rows = [];
    for (let i = 0; i < N; i++) {
        const lam = Math.round(lo + (i / (N - 1)) * (hi - lo));
        try {
            const [n, k] = mat.getNK(lam);
            if (isFinite(n)) rows.push([lam, +n, +(k || 0)]);
        } catch (_) { /* a wavelength the function cannot evaluate is left out */ }
    }
    return rows;
}
