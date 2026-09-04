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
import { EMBEDDED_MATERIALS } from '../src/utils/coatingLibrary/builtin/materials.js';
import {
    COATING_TAGS, COATING_TYPES, entryMaterialIds, entrySpecResults, entrySpectrum,
} from '../src/utils/coatingLibrary/entryModel.js';
import { entryMetrics } from '../src/utils/coatingLibrary/entryProperties.js';
import { validateEntry } from '../src/utils/coatingLibrary/validateEntry.js';
import { isBuiltinId } from '../src/utils/materials/designMaterials.js';
import { initWasmForTest } from './_wasmInit.mjs';

await initWasmForTest();

assert.ok(BUILTIN_COATINGS.length > 0, 'the built-in library is empty');

const ids = new Set();
const usedMaterialIds = new Set();
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
    // A material an entry carries is the library's one record of that id. A
    // design keeps the first meaning it is given for an id, so two coatings
    // that carried different data under one id would make the second one
    // compute with the first one's data.
    for (const [id, record] of Object.entries(entry.materials || {})) {
        assert.equal(record, EMBEDDED_MATERIALS[id], `${where}: embedded "${id}" is not the shared record`);
        usedMaterialIds.add(id);
    }

    // The family's property set must come out as numbers for every band, and
    // the whole-coating figures (edge, centre, width, extinction) must exist
    // where the family asks for them: an edge filter with no 50% crossing is
    // not an edge filter.
    const metrics = entryMetrics(entry);
    assert.ok(!metrics.error, `${where}: metrics failed: ${metrics.error}`);
    assert.ok(metrics.rows.length > 0, `${where}: no properties for type ${entry.type}`);
    for (const row of metrics.rows) {
        assert.equal(row.values.length, entry.bands.length, `${where}: ${row.channel} ${row.stat} has a value per band`);
        row.values.forEach((value, i) => assert.ok(Number.isFinite(value),
            `${where}: ${row.channel}${row.pol} ${row.stat} on band ${i} is ${value}`));
    }
    for (const row of metrics.shape) {
        assert.ok(Number.isFinite(row.value) && row.value > 0, `${where}: ${row.channel} ${row.stat} is ${row.value}`);
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

// The shared records themselves: sound tables, and none that no entry uses,
// so the generated data cannot drift away from the coatings.
for (const [id, record] of Object.entries(EMBEDDED_MATERIALS)) {
    const where = `embedded material "${id}"`;
    assert.equal(record.id, id, `${where}: id field differs from its key`);
    assert.ok(usedMaterialIds.has(id), `${where}: no built-in entry uses it`);
    assert.equal(record.formulaNum, -1, `${where}: not tabulated`);
    assert.ok(Array.isArray(record.tabData) && record.tabData.length >= 2, `${where}: no table`);
    record.tabData.forEach((row, i) => {
        assert.ok(row.length === 3 && row.every(Number.isFinite), `${where}: row ${i} is not [nm, n, k]`);
        assert.ok(row[1] > 0 && row[2] >= 0, `${where}: row ${i} has n ${row[1]}, k ${row[2]}`);
        if (i > 0) assert.ok(row[0] > record.tabData[i - 1][0], `${where}: wavelengths not increasing at row ${i}`);
    });
    const first = record.tabData[0][0] / 1000;
    const last = record.tabData[record.tabData.length - 1][0] / 1000;
    assert.ok(Math.abs(record.lambdaMin - first) < 1e-9, `${where}: lambdaMin ${record.lambdaMin} is not the first point ${first}`);
    assert.ok(Math.abs(record.lambdaMax - last) < 1e-9, `${where}: lambdaMax ${record.lambdaMax} is not the last point ${last}`);
}

console.log(`PASS coating_library_builtin: ${BUILTIN_COATINGS.length} entries meet their specification`);
