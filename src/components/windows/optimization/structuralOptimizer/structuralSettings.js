import { MUTATION_KINDS } from '../../../../utils/synthesis/structuralOptimizer.js';

export const STRUCT_CATS_KEY = 'tfstudio_struct_selectedCats';
const STRUCT_KINDS_KEY = 'tfstudio_struct_kinds';

// Settings a fresh window starts with. The optimizer benchmark takes T0, the
// jitter and Max added from here; its own synthesis settings give the rest.
// Thicknesses in nm, jitter as a fraction.
export const STRUCTURAL_DEFAULTS = {
    maxIter: 80, targetMF: 5e-4, T0: 0.08, jitterPct: 0.15, refineIter: 60,
    dMin: 1, addMaxNm: 500, maxLayers: 80,
};

export function loadKinds() {
    try {
        const raw = localStorage.getItem(STRUCT_KINDS_KEY);
        if (raw) {
            const kinds = JSON.parse(raw).filter(kind => MUTATION_KINDS.includes(kind));
            if (kinds.length) return new Set(kinds);
        }
    } catch (_) {}
    return new Set(MUTATION_KINDS);
}

export function saveKinds(kinds) {
    try { localStorage.setItem(STRUCT_KINDS_KEY, JSON.stringify([...kinds])); } catch (_) {}
}
