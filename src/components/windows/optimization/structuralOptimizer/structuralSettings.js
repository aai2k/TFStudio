import { MUTATION_KINDS } from '../../../../utils/synthesis/structuralOptimizer.js';

export const STRUCT_CATS_KEY = 'tfstudio_struct_selectedCats';
const STRUCT_KINDS_KEY = 'tfstudio_struct_kinds';

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
