/**
 * A fresh Variator mount must use the current design as its zero-delta
 * baseline, even if a cache entry remains from an earlier mount.
 *
 * Run: node tests/variator_cache_refresh.mjs
 */

import {
    getVariatorCache, captureVariatorBaseline, buildThicknessPatch,
} from '../src/components/windows/optimization/variator/model.js';

const initial = {
    id: 'variator-cache-refresh',
    frontLayers: [{ id: 'front-1', thickness: 100 }],
    backLayers: [{ id: 'back-1', thickness: 80 }],
    substrate: { material: 'BK7', thickness: 1 },
};
const edited = {
    ...initial,
    frontLayers: [{ id: 'front-1', thickness: 200 }],
    backLayers: [{ id: 'back-1', thickness: 160 }],
    substrate: { ...initial.substrate, thickness: 2 },
};

const cache = getVariatorCache(initial.id);
captureVariatorBaseline(cache, initial);
captureVariatorBaseline(cache, edited);

const patch = buildThicknessPatch(edited, cache, {}, {}, 0);
const actual = {
    front: patch.frontLayers[0].thickness,
    back: patch.backLayers[0].thickness,
    substrate: patch.substrate?.thickness ?? edited.substrate.thickness,
};
const expected = { front: 200, back: 160, substrate: 2 };

if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAILED - zero deltas produced ${JSON.stringify(actual)}`);
    process.exit(1);
}

console.log('OK - Variator refreshes cached baselines from the current design.');
