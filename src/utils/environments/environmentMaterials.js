/**
 * Replacing materials in a design's other environments (environments.js
 * describes them), as Replace Materials replaces them in the design's own
 * fields.
 */
import { hasEnvironments, sameMaterial, valueFor } from './environments.js';

// `map`, keyed by material, with each key `replace` changes moved to its new
// material. A moved key gives way to a key the map already holds for that
// material, which keeps its own value.
function movedKeys(map, replace) {
    const entries = Object.entries(map);
    const moved = entries.filter(([key]) => replace(key) === key);
    for (const [key, value] of entries) {
        const next = replace(key);
        if (next !== key && !moved.some(([held]) => sameMaterial(held, next))) moved.push([next, value]);
    }
    return Object.fromEntries(moved);
}

// The swaps of `swaps` with `replace` applied to both sides. A swap left
// naming the material it replaces is dropped; null when none is left.
function replacedSwaps(swaps, replace) {
    const kept = Object.entries(movedKeys(swaps, replace))
        .map(([from, to]) => [from, replace(to)])
        .filter(([from, to]) => !sameMaterial(from, to));
    return kept.length > 0 ? Object.fromEntries(kept) : null;
}

// Environment `env` with the materials `replace` changes replaced.
function replacedIn(env, replace) {
    const next = { ...env };
    for (const key of ['incidentMedium', 'exitMedium']) if (next[key]) next[key] = replace(next[key]);
    if (next.substrate?.material) next.substrate = { ...next.substrate, material: replace(next.substrate.material) };
    if (next.thicknessFactors) next.thicknessFactors = movedKeys(next.thicknessFactors, replace);
    if (next.materialSwaps) {
        const swaps = replacedSwaps(next.materialSwaps, replace);
        if (swaps) next.materialSwaps = swaps;
        else delete next.materialSwaps;
    }
    return next;
}

/**
 * `design` with the materials of `replacements` (old id to new id) replaced in
 * environments 2 and later: their media, their substrates and their swaps,
 * and the materials their factors and swaps are keyed by, which follow the
 * layers they name. The design's own fields are left to the caller.
 */
export function replaceEnvironmentMaterials(design, replacements) {
    if (!hasEnvironments(design)) return design;
    const replace = id => valueFor(replacements, id) || id;
    return { ...design, environments: design.environments.map((env, i) => (i === 0 ? env : replacedIn(env, replace))) };
}
