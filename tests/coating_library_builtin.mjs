/**
 * The built-in coating library holds what it claims to hold.
 *
 * Every shipped entry is re-evaluated here: its materials resolve without any
 * local catalog, its band lies inside the data of every material it uses, and
 * each claim in its specification passes on the current material data and
 * solver. A change to either that spoils an entry fails this test instead of
 * shipping a starting design that no longer does what its description says.
 *
 * Run: node tests/coating_library_builtin.mjs
 */
import assert from 'node:assert/strict';
import { BUILTIN_COATINGS } from '../src/utils/coatingLibrary/builtin/index.js';
import {
    COATING_TAGS, COATING_TYPES, METRIC_KEYS, entryMaterialIds, entryMetrics, entrySpecResults, entrySpectrum,
} from '../src/utils/coatingLibrary/entryModel.js';
import { validateEntry } from '../src/utils/coatingLibrary/validateEntry.js';
import { isBuiltinId } from '../src/utils/materials/designMaterials.js';
import { initWasmForTest } from './_wasmInit.mjs';

await initWasmForTest();

assert.ok(BUILTIN_COATINGS.length > 0, 'the built-in library is empty');

const ids = new Set();
for (const entry of BUILTIN_COATINGS) {
    const where = `entry "${entry.id}"`;
    assert.ok(!ids.has(entry.id), `${where}: duplicate id`);
    ids.add(entry.id);

    assert.deepEqual(validateEntry(entry), [], `${where}: structural problems`);
    assert.ok(COATING_TYPES.includes(entry.type), `${where}: unknown type`);
    // Tags are what the filter runs on, and a tag outside the vocabulary is
    // either a misspelling or a meaning nobody wrote down.
    assert.ok(entry.tags.length > 0, `${where}: no tags`);
    for (const tag of entry.tags) assert.ok(COATING_TAGS[tag], `${where}: tag "${tag}" is not in COATING_TAGS`);
    assert.ok(entry.use.trim().length > 0, `${where}: no "use this when" text`);
    assert.ok(entry.source.trim().length > 0, `${where}: no source recorded`);
    assert.ok(entry.spec.length > 0, `${where}: no specification claims`);

    // Nothing an entry needs may live only on the author's machine.
    for (const id of entryMaterialIds(entry)) {
        assert.ok(isBuiltinId(id) || entry.materials?.[id],
            `${where}: material "${id}" is neither built in nor embedded`);
    }

    const metrics = entryMetrics(entry);
    assert.ok(!metrics.error, `${where}: metrics failed: ${metrics.error}`);
    assert.equal(metrics.bands.length, entry.bands.length, `${where}: one metric set per band`);
    for (const band of metrics.bands) {
        for (const key of METRIC_KEYS) {
            assert.ok(Number.isFinite(band[key]), `${where}: metric ${key} on ${band.range} is ${band[key]}`);
        }
    }

    const spectrum = entrySpectrum(entry, 101);
    assert.ok(!spectrum.error, `${where}: preview failed: ${spectrum.error}`);
    assert.ok(spectrum.R.every(Number.isFinite) && spectrum.T.every(Number.isFinite),
        `${where}: preview spectrum has non-finite values`);

    const { qualifiers, results, verdict } = entrySpecResults(entry);
    results.forEach((result, i) => {
        assert.ok(result.pass, `${where}: claim ${i + 1} (${qualifiers[i].kind}) fails: ${result.summary}`);
    });
    assert.ok(verdict.allPass, `${where}: specification does not pass`);
}

console.log(`PASS coating_library_builtin: ${BUILTIN_COATINGS.length} entries meet their specification`);
