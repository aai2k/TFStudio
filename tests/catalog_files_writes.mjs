/**
 * Two copies of TFStudio on one data folder, editing one catalog file.
 *
 * The installed app beside `npm start` or a portable copy keeps another
 * profile, so nothing stops both running on one data folder, and each saves a
 * catalog whole from its own registry. A save of an edit that finds the file
 * written by the other copy since this one read it applies its one edit to the
 * catalog on disk instead, and asks only when both changed the same material:
 *
 *   1. A adds a material, then B adds another: the file holds both.
 *   2. A deletes a material, then B adds one: the deleted one stays deleted
 *      and its id retired. Ids either copy retired stay retired.
 *   3. Both edit one material: B asks. Replace writes B's version; Cancel
 *      leaves A's.
 *   4. A rename in B keeps a material A added.
 *   5. A coating import in B into the catalog of a file imported before keeps
 *      a material A added, whether the import adds a material or not.
 *
 * After each, B's registry holds what is on disk. A copy on its own saves as
 * it did: the whole catalog from memory, once per edit, nothing asked.
 *
 * Copy B is this process's catalog registry on the real main-process
 * handlers. Copy A writes the file as its own registry would: the catalog it
 * loaded with its one edit, whole.
 *
 * Run: node tests/catalog_files_writes.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';

const require = createRequire(import.meta.url);
globalThis.React = require('react');
globalThis.window = globalThis;
const events = new EventTarget();
globalThis.addEventListener = events.addEventListener.bind(events);
globalThis.removeEventListener = events.removeEventListener.bind(events);
globalThis.dispatchEvent = events.dispatchEvent.bind(events);

const paths = require('../src/main/paths.js');
const catalogsIpc = require('../src/main/ipc/catalogs.js');
const cm = await import('../src/utils/materials/catalogManager.js');
const { loadCatalogsFromDisk } = await import('../src/utils/materials/catalogStartup.js');
const zemaxImport = await import('../src/components/windows/dataExchange/zemaxCoatings/catalogImport.js');
const { getLocale } = await import('../src/constants/locales/index.js');
const runtime = makeHookRuntime();
const { useCatalogSaveFailures } = await importWithHookRuntime('../src/utils/materials/useCatalogSaveFailures.js', runtime);
const t = getLocale('en');

const settle = () => new Promise(resolve => setTimeout(resolve, 20));

// What B shows: the confirm dialogs the app shell's catalog hook opens, the
// failures it reports, and the change notices the registry sends.
const dialogs = [];
const failures = [];
const changes = [];
runtime.render(() => useCatalogSaveFailures(
    t, note => failures.push(note.message), dialog => { if (dialog) dialogs.push(dialog); }));
runtime.pendingEffects().forEach(effect => effect());
addEventListener('catalogs-changed', event => changes.push(event.detail));

const material = (id, n) => ({ id, name: id, formulaNum: -1, interp: 'pchip', tabData: [[400, n, 0], [800, n - 0.02, 0]] });
const ids = cat => Object.keys(cat.materials).sort();
const lab = () => cm.getCatalog('user_lab');
// The registry's catalog as JSON reads it, functions left out.
const asJson = cat => JSON.parse(JSON.stringify(cat));

const roots = [];

// A data folder holding the user catalog "Lab", or the one `fields` describe,
// with these materials, and copy B started on it.
async function startOn(materials, fields = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-catalog-copies-'));
    roots.push(root);
    const materialsDir = path.join(root, 'Materials');
    fs.mkdirSync(path.join(materialsDir, 'user'), { recursive: true });
    const catalog = { id: 'user_lab', uid: '0123abcd', name: 'Lab', source: 'user', ...fields, materials: {} };
    const file = path.join(materialsDir, 'user', `${catalog.id}.catalog.json`);
    for (const m of materials) catalog.materials[m.id] = m;
    fs.writeFileSync(file, JSON.stringify(catalog, null, 2));

    const handlers = {};
    catalogsIpc.register({ handle: (channel, fn) => { handlers[channel] = fn; } },
        { fs, path, log: () => {}, materialsDir, ...paths });
    const call = (channel, ...args) => handlers[channel](null, ...args);
    const writes = [];
    globalThis.electronAPI = {
        loadCatalogs: () => call('catalog:load-all'),
        saveCatalog: (cat, mtime) => { writes.push(cat.id); return call('catalog:save', cat, mtime); },
        deleteCatalog: (id, source) => call('catalog:delete', id, source),
    };
    await loadCatalogsFromDisk();
    dialogs.length = 0;
    failures.length = 0;
    changes.length = 0;

    const onDisk = () => JSON.parse(fs.readFileSync(file, 'utf8'));
    // Copy A makes one edit to the catalog it loaded, the file as it is now,
    // and saves it whole. The file's time is set ahead, so a file system that
    // keeps times to the second still shows the write.
    const copyA = async (edit) => {
        const cat = onDisk();
        edit(cat);
        assert.equal((await call('catalog:save', cat)).success, true);
        const later = new Date(fs.statSync(file).mtimeMs + 5000);
        fs.utimesSync(file, later, later);
    };
    return { writes, onDisk, copyA };
}

try {
    // ── A copy on its own saves as it did ────────────────────────────────────
    {
        const folder = await startOn([material('SiO2_film', 1.46), material('Old', 1.5)]);
        cm.saveUserMaterial('user_lab', material('Ta2O5_run_3', 2.1));
        await settle();
        cm.saveUserMaterial('user_lab', material('Ta2O5_run_3', 2.12));
        await settle();
        cm.removeUserMaterial('user_lab', 'Old');
        await settle();
        assert.equal(folder.writes.length, 3, 'one write per edit');
        assert.deepEqual(dialogs, [], 'nothing is asked');
        assert.deepEqual(failures, []);
        const disk = folder.onDisk();
        assert.deepEqual(ids(disk), ['SiO2_film', 'Ta2O5_run_3']);
        assert.equal(disk.materials.Ta2O5_run_3.tabData[0][1], 2.12);
        assert.deepEqual(disk.retiredIds, ['Old']);
        assert.deepEqual(disk, asJson(lab()), 'the file is the whole catalog from memory');
    }

    // ── 1. A adds a material, then B adds another ────────────────────────────
    {
        const folder = await startOn([material('SiO2_film', 1.46), material('Old', 1.5)]);
        await folder.copyA(cat => { cat.materials.TiO2_run_17 = material('TiO2_run_17', 2.4); });
        cm.saveUserMaterial('user_lab', material('Ta2O5_run_3', 2.1));
        await settle();
        const disk = folder.onDisk();
        assert.deepEqual(ids(disk), ['Old', 'SiO2_film', 'Ta2O5_run_3', 'TiO2_run_17'], 'the material A added is kept');
        assert.deepEqual(dialogs, [], 'nothing is asked');
        assert.deepEqual(failures, []);
        assert.deepEqual(asJson(lab()), disk, 'B holds what is on disk');
        assert.equal(cm.getMaterialById('user_lab:TiO2_run_17')?.name, 'TiO2_run_17', 'so A\'s material can be picked in B');
    }

    // ── 2. A deletes a material, then B adds one ─────────────────────────────
    {
        const folder = await startOn([material('SiO2_film', 1.46), material('Old', 1.5)]);
        await folder.copyA(cat => { delete cat.materials.Old; cat.retiredIds = ['Old']; });
        cm.saveUserMaterial('user_lab', material('Ta2O5_run_3', 2.1));
        await settle();
        let disk = folder.onDisk();
        assert.deepEqual(ids(disk), ['SiO2_film', 'Ta2O5_run_3'], 'the material A deleted stays deleted');
        assert.deepEqual(disk.retiredIds, ['Old'], 'and its id retired');
        assert.deepEqual(dialogs, [], 'nothing is asked');
        assert.deepEqual(asJson(lab()), disk, 'B holds what is on disk');
        assert.ok(cm.materialIdTaken(lab(), 'Old'), 'so B never gives the id out again');
        assert.ok(changes.some(detail => detail.removed?.['user_lab:Old']),
            'and an open design in B that used it keeps its own copy');

        // Each copy deletes another material: both ids stay retired.
        await folder.copyA(cat => { delete cat.materials.SiO2_film; cat.retiredIds = [...cat.retiredIds, 'SiO2_film']; });
        cm.removeUserMaterial('user_lab', 'Ta2O5_run_3');
        await settle();
        disk = folder.onDisk();
        assert.deepEqual(ids(disk), []);
        assert.deepEqual([...disk.retiredIds].sort(), ['Old', 'SiO2_film', 'Ta2O5_run_3'], 'ids either copy retired are kept');
        assert.deepEqual(dialogs, []);
    }

    // ── 3. Both edit one material ────────────────────────────────────────────
    {
        const folder = await startOn([material('SiO2_film', 1.46), material('Old', 1.5)]);
        await folder.copyA(cat => { cat.materials.SiO2_film = material('SiO2_film', 1.47); });
        cm.saveUserMaterial('user_lab', material('SiO2_film', 1.45));
        await settle();
        assert.equal(dialogs.length, 1, 'B asks before replacing');
        assert.equal(dialogs[0].title, t.dialogs.changedOnDisk.title);
        assert.equal(dialogs[0].message,
            'SiO2_film was changed in another copy of TFStudio after this one loaded the catalog. Replace it with the version here?');
        assert.equal(dialogs[0].confirmLabel, 'Replace');
        assert.equal(folder.onDisk().materials.SiO2_film.tabData[0][1], 1.47, 'nothing is written while it asks');
        dialogs[0].onConfirm();
        await settle();
        let disk = folder.onDisk();
        assert.equal(disk.materials.SiO2_film.tabData[0][1], 1.45, 'Replace writes the version here');
        assert.deepEqual(ids(disk), ['Old', 'SiO2_film']);
        assert.deepEqual(asJson(lab()), disk, 'B holds what is on disk');

        await folder.copyA(cat => { cat.materials.SiO2_film = material('SiO2_film', 1.48); });
        cm.saveUserMaterial('user_lab', material('SiO2_film', 1.44));
        await settle();
        assert.equal(dialogs.length, 2, 'B asks again');
        dialogs[1].onCancel();
        await settle();
        disk = folder.onDisk();
        assert.equal(disk.materials.SiO2_film.tabData[0][1], 1.48, 'Cancel leaves the other copy\'s version');
        assert.deepEqual(asJson(lab()), disk, 'and B holds it');
        assert.deepEqual(failures, []);
    }

    // ── 4. A rename in B ─────────────────────────────────────────────────────
    {
        const folder = await startOn([material('SiO2_film', 1.46)]);
        await folder.copyA(cat => { cat.materials.TiO2_run_17 = material('TiO2_run_17', 2.4); });
        cm.renameUserCatalog('user_lab', 'Lab 2026');
        await settle();
        const disk = folder.onDisk();
        assert.equal(disk.name, 'Lab 2026');
        assert.deepEqual(ids(disk), ['SiO2_film', 'TiO2_run_17'], 'a rename keeps the material A added');
        assert.deepEqual(asJson(lab()), disk, 'B holds what is on disk');
    }

    // ── 5. A coating import in B from a file imported before ─────────────────
    {
        const FILE = 'C:\\Zemax\\COATING.DAT';
        const catId = 'zemax_coating_0123abcd';
        const folder = await startOn([material('SiO2_film', 1.46)], { id: catId, name: 'Zemax COATING', sourceFile: FILE });
        const ta2o5 = [{ name: 'TA2O5', points: [[0.4, 2.15, 0], [0.8, 2.08, 0]] }];
        await folder.copyA(cat => {
            cat.materials.TiO2_run_17 = material('TiO2_run_17', 2.4);
            cat.materials.SiO2_film = material('SiO2_film', 1.47);
        });
        zemaxImport.registerMaterials(ta2o5, 'COATING.DAT', null, FILE);
        await settle();
        let disk = folder.onDisk();
        assert.deepEqual(ids(disk), ['SiO2_film', 'TiO2_run_17', 'ta2o5'], 'an import that adds a material keeps the one A added');
        assert.equal(disk.materials.SiO2_film.tabData[0][1], 1.47, 'and the edit A made');
        assert.deepEqual(asJson(cm.getCatalog(catId)), disk, 'B holds what is on disk');

        // The same import again adds nothing.
        await folder.copyA(cat => { cat.materials.MgF2_run_2 = material('MgF2_run_2', 1.38); });
        zemaxImport.registerMaterials(ta2o5, 'COATING.DAT', null, FILE);
        await settle();
        disk = folder.onDisk();
        assert.deepEqual(ids(disk), ['MgF2_run_2', 'SiO2_film', 'TiO2_run_17', 'ta2o5'], 'so does an import that adds nothing');
        assert.deepEqual(asJson(cm.getCatalog(catId)), disk, 'B holds what is on disk');
        assert.deepEqual(dialogs, [], 'nothing is asked');
        assert.deepEqual(failures, []);
    }

    console.log('PASS: catalog_files_writes');
} finally {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}
