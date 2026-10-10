/**
 * Deleting a design, a catalog, a library coating, a merit preset or a spec
 * preset moves the file to the Recycle Bin, as deleting a project folder does,
 * so one confirmed by mistake can be restored. Where there is no bin, the
 * file is deleted as before.
 *
 * Run: node tests/deletes_to_recycle_bin.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const paths = require('../src/main/paths.js');
const projects = require('../src/main/ipc/projects.js');
const catalogs = require('../src/main/ipc/catalogs.js');
const meritPresets = require('../src/main/ipc/meritPresets.js');
const qualifiers = require('../src/main/ipc/qualifiers.js');
const coatings = require('../src/main/ipc/coatings.js');

const design = (id, name) => JSON.stringify({
    id, name, substrate: { material: 'BK7' }, frontLayers: [], backLayers: [],
});

// One data folder holding one of each kind of file, with every handler that
// deletes them registered on it. `shell` is what the Electron shell would be.
function makeData(root, shell) {
    const dir = (...parts) => path.join(root, ...parts);
    const files = {
        designA: dir('Projects', 'Customer', 'AR.tfs'),
        designB: dir('Projects', 'Customer', 'HR.tfs'),
        designC: dir('Projects', 'Customer', 'BP.tfs'),
        catalog: dir('Materials', 'user', 'user_lab.catalog.json'),
        merit: dir('MeritFunctions', 'AR MF.tfsm'),
        spec: dir('Qualifiers', 'AR spec.tfsq'),
        coating: dir('Coatings', 'BBAR vis.tfsc'),
    };
    const contents = {
        designA: design('design-a', 'AR'),
        designB: design('design-b', 'HR'),
        designC: design('design-c', 'BP'),
        catalog: JSON.stringify({ id: 'user_lab', name: 'Lab', source: 'user', materials: {} }),
        merit: JSON.stringify({ ver: 1, name: 'AR MF', operands: [] }),
        spec: JSON.stringify({ ver: 1, name: 'AR spec', qualifiers: [] }),
        coating: JSON.stringify({ ver: 1, name: 'BBAR vis', layers: [] }),
    };
    for (const [key, file] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, contents[key]);
    }
    for (const sub of ['agf', 'refractiveindex', 'library', 'optilayer']) {
        fs.mkdirSync(dir('Materials', sub), { recursive: true });
    }

    const unlinked = [];
    const logs = [];
    const trackedFs = { ...fs, unlinkSync: (file) => { unlinked.push(file); fs.unlinkSync(file); } };
    const handlers = new Map();
    const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };
    const ctx = {
        ...paths, fs: trackedFs, path, log: (message) => logs.push(message),
        projectsDir: dir('Projects'), materialsDir: dir('Materials'),
        meritFunctionsDir: dir('MeritFunctions'), qualifiersDir: dir('Qualifiers'), coatingsDir: dir('Coatings'),
        ...(shell ? { shell } : {}),
    };
    for (const module of [projects, catalogs, meritPresets, qualifiers, coatings]) module.register(ipcMain, ctx);
    const call = (channel, ...args) => handlers.get(channel)(null, ...args);

    // What the Design Editor's delete, the explorer's multi-select delete, the
    // Material Editor, the Coating Library, the Merit Function Editor and the
    // Specification window send.
    const deleteAll = async () => [
        await call('delete-item', 'Customer', 'AR', 'design-a'),
        await call('delete-item', 'Customer', 'HR', 'design-b'),
        await call('delete-item', 'Customer', 'BP', 'design-c'),
        await call('catalog:delete', 'user_lab', 'user'),
        await call('mf:delete', 'AR MF'),
        await call('qualifiers:delete', 'AR spec.tfsq'),
        await call('coatings:delete', 'BBAR vis'),
    ];
    return { files, contents, unlinked, logs, deleteAll };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-recycle-bin-'));
try {
    // ── Where there is a Recycle Bin, every one of them goes to it ────────────
    {
        const bin = path.join(root, 'bin');
        fs.mkdirSync(bin);
        const trashed = [];
        const shell = {
            trashItem: async (file) => {
                trashed.push(file);
                fs.renameSync(file, path.join(bin, `${trashed.length}-${path.basename(file)}`));
            },
        };
        const data = makeData(path.join(root, 'with-bin'), shell);
        const results = await data.deleteAll();

        assert.ok(results.every(result => result.success), 'every delete succeeds');
        assert.deepEqual(trashed, Object.values(data.files), 'each file is handed to the Recycle Bin');
        assert.deepEqual(data.unlinked, [], 'and none is deleted outright');
        for (const file of Object.values(data.files)) assert.ok(!fs.existsSync(file), `${path.basename(file)} is gone from its folder`);
        const restored = Object.keys(data.files).map((key, index) =>
            fs.readFileSync(path.join(bin, `${index + 1}-${path.basename(data.files[key])}`), 'utf8') === data.contents[key]);
        assert.ok(restored.every(Boolean), 'and is in the bin as it was');
    }

    // ── Where the bin refuses, or there is none, the file is deleted ──────────
    for (const [label, shell] of [
        ['a bin that refuses', { trashItem: async () => { throw new Error('no trash here'); } }],
        ['no shell at all', undefined],
    ]) {
        const data = makeData(path.join(root, label.replace(/ /g, '-')), shell);
        const results = await data.deleteAll();

        assert.ok(results.every(result => result.success), `${label}: every delete still succeeds`);
        assert.deepEqual(data.unlinked, Object.values(data.files), `${label}: each file is deleted outright`);
        for (const file of Object.values(data.files)) assert.ok(!fs.existsSync(file), `${label}: ${path.basename(file)} is gone`);
        if (shell) {
            assert.equal(data.logs.filter(line => line.includes('could not go to the Recycle Bin')).length, 7,
                `${label}: each refusal is logged`);
        }
    }
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

console.log('deletes_to_recycle_bin: passed');
