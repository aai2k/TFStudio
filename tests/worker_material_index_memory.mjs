/**
 * The compute workers' material index (workers/resolveMat.js) takes less
 * memory than the tables it indexes, and reads them unchanged.
 *
 * A worker gets each material as a table sampled on the run's grid and indexes
 * it for exact lookups. An index that holds an object per sample costs about
 * 255 bytes per sample per material: 29 MB for the four materials of a
 * 30-layer TiO2/SiO2 design at 30001 samples, where the tables take 4 MB, and
 * 312 MB at 300001 samples. The tables of one run share one wavelength grid,
 * so one map of it serves every material.
 *
 *   1. At every wavelength of the table, each material reads the n, k and
 *      frequency response stored there, bit for bit.
 *   2. The index the worker builds for those four materials, at 30001 samples,
 *      takes less heap than its copy of the tables, and the materials after
 *      the first add less than half of what the first one takes: a map of
 *      their own would each add as much.
 *
 * Run: node tests/worker_material_index_memory.mjs
 */
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';

v8.setFlagsFromString('--expose-gc');
const collect = vm.runInNewContext('gc');
globalThis.postMessage = () => {};

const { makeOperand, requiredLambdas, buildPresampledTable, collectDesignMaterialIds } = await import('../src/utils/physics/optimizer.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { makeResolveMat } = await import('../src/utils/workers/resolveMat.js');

const frontLayers = Array.from({ length: 30 }, (_, i) => ({ id: `L${i}`, material: i % 2 ? 'SiO2' : 'TiO2', thickness: 80 + i, locked: false }));
const design = { incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 }, frontLayers, backLayers: [], surfaceMode: 'front_only' };
const lookup = designMaterialLookup(design);
const ids = collectDesignMaterialIds(design);
const pairs = ids.map(id => ({ id, mat: lookup(id) }));
const rowAt = flag => [makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 1, weight: 1, flag })];

// ── 1. Every table wavelength reads its own sample ─────────────────────────────
{
    const lambdas = requiredLambdas(rowAt(2));
    const table = structuredClone(buildPresampledTable(lambdas, pairs, { includeOmegaResponses: true }));
    const resolve = makeResolveMat(table, 'test');
    let read = 0;
    for (const id of ids) {
        const { n, k, omegaResponses } = table[id];
        lambdas.forEach((lam, i) => {
            const nk = resolve(id).getNK(lam);
            assert.ok(Object.is(nk[0], n[i]) && Object.is(nk[1], k[i]), `${id} at ${lam} nm reads its sample`);
            assert.equal(resolve(id).getOmegaResponse(lam), omegaResponses[i] || null, `${id} at ${lam} nm reads its frequency response`);
            read++;
        });
    }
    assert.equal(read, ids.length * 3001, 'four materials at 3001 samples each');
}

// ── 2. The index takes less than the tables it indexes ─────────────────────────
{
    const heap = () => { collect(); collect(); return process.memoryUsage().heapUsed; };
    const lambdas = requiredLambdas(rowAt(3));
    assert.equal(lambdas.length, 30001, 'the row at Flag 3 samples its band 30001 times');
    const sent = buildPresampledTable(lambdas, pairs, { includeOmegaResponses: false });
    const before = heap();
    const table = structuredClone(sent);
    const copied = heap();
    const resolve = makeResolveMat(table, 'test');
    const first = resolve(ids[0]);
    const one = heap();
    const stubs = [first, ...ids.slice(1).map(id => resolve(id))];
    const indexed = heap();
    const MB = bytes => bytes / 2 ** 20;
    const copy = MB(copied - before), index = MB(indexed - copied), firstIndex = MB(one - copied), rest = MB(indexed - one);
    assert.ok(stubs.every(s => s.getNK(lambdas[1])[0] > 0), 'each material reads a sample');
    assert.ok(index < copy, `the index takes ${index.toFixed(1)} MB for a ${copy.toFixed(1)} MB copy of the tables`);
    assert.ok(rest < firstIndex / 2, `the other materials add ${rest.toFixed(2)} MB to the first one's ${firstIndex.toFixed(2)} MB`);
    console.log(`index ${index.toFixed(1)} MB (first material ${firstIndex.toFixed(2)} MB), tables ${copy.toFixed(1)} MB`);
}

console.log('PASS: worker_material_index_memory');
