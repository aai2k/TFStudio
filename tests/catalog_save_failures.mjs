/**
 * Catalog files that cannot be written, deleted or read are reported.
 *
 * A catalog write that fails in the main process is told to the user; the edit
 * would otherwise live in memory only and be gone after a restart. A failed
 * delete is reported as a failure. A catalog file without a name or a
 * materials object loads with defaults instead of taking the material picker
 * and the Material Editor down, and one that cannot be parsed is named.
 *
 * Run: node tests/catalog_save_failures.mjs
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
const { CATALOG_SAVE_FAILED } = await import('../src/utils/materials/catalogManager/persistence.js');
const { loadCatalogsFromDisk } = await import('../src/utils/materials/catalogStartup.js');
const { getLocale } = await import('../src/constants/locales/index.js');
const runtime = makeHookRuntime();
const { useCatalogSaveFailures } = await importWithHookRuntime('../src/utils/materials/useCatalogSaveFailures.js', runtime);
const t = getLocale('en');
const me = t.materialEditor;

const settle = () => new Promise(resolve => setTimeout(resolve, 10));
const failures = [];
const changes = [];
addEventListener(CATALOG_SAVE_FAILED, event => failures.push(event.detail));
addEventListener('catalogs-changed', () => changes.push(true));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-catalog-failures-'));
try {
    // ── The renderer hears about a failed write ──────────────────────────────
    {
        globalThis.electronAPI = {
            saveCatalog: async () => ({ success: false, error: 'EPERM: operation not permitted' }),
            deleteCatalog: async () => ({ success: false, error: 'EBUSY: resource busy' }),
        };
        cm.initCatalogs({ user_lab: { id: 'user_lab', name: 'Lab', source: 'user', materials: {} } });
        cm.saveUserMaterial('user_lab', { id: 'H', name: 'H', formulaNum: -1, tabData: [[400, 2.1, 0], [800, 2.05, 0]] });
        assert.equal(changes.length, 1, 'the change notice goes out at once, as before');
        await settle();
        assert.deepEqual(failures, [{ id: 'user_lab', name: 'Lab', action: 'save', error: 'EPERM: operation not permitted' }]);

        globalThis.electronAPI.saveCatalog = async () => { throw new Error('IPC gone'); };
        cm.saveUserMaterial('user_lab', { id: 'L', name: 'L', formulaNum: -1, tabData: [[400, 1.46, 0], [800, 1.45, 0]] });
        await settle();
        assert.equal(failures.at(-1).error, 'IPC gone', 'a rejected call is a failure too');

        globalThis.electronAPI.saveCatalog = async () => ({ success: true });
        cm.saveUserMaterial('user_lab', { id: 'M', name: 'M', formulaNum: -1, tabData: [[400, 1.6, 0], [800, 1.58, 0]] });
        await settle();
        assert.equal(failures.length, 2, 'a write that worked reports nothing');

        cm.removeCatalog('user_lab');
        await settle();
        assert.deepEqual(failures.at(-1), { id: 'user_lab', name: 'Lab', action: 'delete', error: 'EBUSY: resource busy' });
    }

    // ── The hook turns each failure into one notification ────────────────────
    {
        const shown = [];
        runtime.render(() => useCatalogSaveFailures(t, note => shown.push(note)));
        const cleanups = runtime.pendingEffects().map(effect => effect());
        dispatchEvent(new CustomEvent(CATALOG_SAVE_FAILED, { detail: { id: 'x', name: 'Lab', action: 'save', error: 'EPERM' } }));
        dispatchEvent(new CustomEvent(CATALOG_SAVE_FAILED, { detail: { id: 'x', name: 'Lab', action: 'delete', error: 'EBUSY' } }));
        dispatchEvent(new CustomEvent('catalogs-loaded', { detail: { unreadable: ['user/bad.catalog.json'] } }));
        dispatchEvent(new CustomEvent('catalogs-loaded'));
        dispatchEvent(new CustomEvent('catalogs-loaded', { detail: { unreadable: [] } }));
        assert.deepEqual(shown, [
            { type: 'error', message: me.catalogSaveFailed('Lab', 'EPERM') },
            { type: 'error', message: me.catalogDeleteFailed('Lab', 'EBUSY') },
            { type: 'error', message: me.catalogFilesUnreadable('user/bad.catalog.json') },
        ]);
        for (const cleanup of cleanups) cleanup?.();
        dispatchEvent(new CustomEvent(CATALOG_SAVE_FAILED, { detail: { id: 'x', name: 'Lab', action: 'save', error: 'EPERM' } }));
        assert.equal(shown.length, 3, 'unmounted, it shows nothing');
    }

    // ── The main process reports a failed write and a failed delete ──────────
    const materialsDir = path.join(root, 'Materials');
    for (const sub of ['agf', 'user']) fs.mkdirSync(path.join(materialsDir, sub), { recursive: true });
    const handlers = {};
    catalogsIpc.register({ handle: (channel, fn) => { handlers[channel] = fn; } },
        { fs, path, log: () => {}, materialsDir, ...paths });
    const call = (channel, ...args) => handlers[channel](null, ...args);
    {
        // A directory where the catalog file should be: neither a write nor an
        // unlink can replace it, on any platform.
        fs.mkdirSync(path.join(materialsDir, 'user', 'user_stuck.catalog.json'));
        const saved = await call('catalog:save', { id: 'user_stuck', name: 'Stuck', source: 'user', materials: {} });
        assert.equal(saved.success, false);
        const deleted = await call('catalog:delete', 'user_stuck', 'user');
        assert.equal(deleted.success, false, 'a delete that failed says so');
        assert.ok(deleted.error);
        fs.rmdirSync(path.join(materialsDir, 'user', 'user_stuck.catalog.json'));
        assert.equal((await call('catalog:delete', 'user_gone', 'user')).success, true, 'nothing to delete is fine');
    }

    // ── Malformed catalog files ──────────────────────────────────────────────
    {
        const user = file => path.join(materialsDir, 'user', file);
        const good = { id: 'user_a', name: 'Alpha', source: 'user', materials: { A: { id: 'A', name: 'A', formulaNum: -1, tabData: [[400, 1.5, 0], [800, 1.45, 0]] } } };
        fs.writeFileSync(user('user_a.catalog.json'), JSON.stringify(good));
        fs.writeFileSync(user('user_bom.catalog.json'), '﻿' + JSON.stringify({ ...good, id: 'user_bom', name: 'Bom' }));
        fs.writeFileSync(user('user_x.catalog.json'), JSON.stringify({ id: 'user_x', source: 'user', materials: {} }));
        fs.writeFileSync(user('user_y.catalog.json'), JSON.stringify({ id: 'user_y', name: 'Y', source: 'user' }));
        fs.writeFileSync(user('user_z.catalog.json'), JSON.stringify({ id: 'user_z', name: 'Z', source: 'user', materials: null }));
        fs.writeFileSync(user('bad.catalog.json'), '{ "id": "user_bad", ');
        fs.writeFileSync(user('noid.catalog.json'), JSON.stringify({ name: 'No id', source: 'user', materials: {} }));

        const loaded = await call('catalog:load-all');
        assert.deepEqual(Object.keys(loaded.catalogs).sort(), ['user_a', 'user_bom', 'user_x', 'user_y', 'user_z'], 'a file with a byte-order mark loads');
        assert.deepEqual([...loaded.unreadable].sort(), ['user/bad.catalog.json', 'user/noid.catalog.json'], 'the files left out are named');

        cm.initCatalogs(loaded.catalogs);
        assert.doesNotThrow(() => cm.getCatalogs(), 'a catalog with no name does not break the list');
        assert.equal(cm.getCatalog('user_x').name, 'user_x', 'it is listed under its id');
        assert.deepEqual(cm.getCatalog('user_y').materials, {});
        assert.deepEqual(cm.getCatalog('user_z').materials, {});
        assert.doesNotThrow(() => cm.searchMaterials(''), 'nor does one with no materials');
        assert.equal(cm.getMaterialById('user_a:A').getNK(400)[0], 1.5);
        assert.equal(cm.getMaterialById('user_y:A'), null);

        const loadedEvents = [];
        const onLoaded = event => loadedEvents.push(event.detail);
        addEventListener('catalogs-loaded', onLoaded);
        globalThis.electronAPI = {
            loadCatalogs: () => call('catalog:load-all'),
            saveCatalog: cat => call('catalog:save', cat),
            deleteCatalog: (id, source) => call('catalog:delete', id, source),
        };
        await loadCatalogsFromDisk();
        removeEventListener('catalogs-loaded', onLoaded);
        assert.deepEqual([...loadedEvents[0].unreadable].sort(), ['user/bad.catalog.json', 'user/noid.catalog.json'],
            'startup passes the unread files on to be shown');
        await settle();
        assert.ok(fs.existsSync(user('bad.catalog.json')), 'an unread file is left as it is');
    }

    console.log('PASS: catalog_save_failures');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
