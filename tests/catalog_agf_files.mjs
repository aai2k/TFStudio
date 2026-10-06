/**
 * AGF glass catalogs and the files they come from.
 *
 * Runs the real main-process catalog handlers and seed on temp Materials trees,
 * with the renderer's startup scan and the Material Editor's AGF import on top.
 *
 *   - every AGF file gets a catalog of its own, with a readable name, whatever
 *     characters its name holds; an id clash never replaces another catalog,
 *     and the ids `builtin` and `design` are never given to a file;
 *   - a catalog made by an earlier build keeps its id;
 *   - an .agf that changed rebuilds its catalog, keeping the materials the file
 *     does not define, and so does an import of the same file;
 *   - a catalog deleted in the Material Editor stays deleted: neither the scan
 *     nor the seed brings it back, until the user imports the file again.
 *
 * Run: node tests/catalog_agf_files.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const paths = require('../src/main/paths.js');
const catalogsIpc = require('../src/main/ipc/catalogs.js');
const seed = require('../src/main/seed.js');

globalThis.window = globalThis;
const events = new EventTarget();
globalThis.addEventListener = events.addEventListener.bind(events);
globalThis.removeEventListener = events.removeEventListener.bind(events);
globalThis.dispatchEvent = events.dispatchEvent.bind(events);
const cm = await import('../src/utils/materials/catalogManager.js');
const { loadCatalogsFromDisk } = await import('../src/utils/materials/catalogStartup.js');
const { importAgfCatalog } = await import('../src/components/windows/design/materialEditor/materialEditorActions.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-agf-files-'));
const CD = 'CD 1.03961212 0.00600069867 0.231792344 0.0200179144 1.01046945 103.560653 0 0 0 0';
const agfText = (...glasses) => glasses.map(([name, nd]) => `NM ${name} 2 0 ${nd} 60 0 0 0\n${CD}\nLD 0.3 2.5\n`).join('');
const glass = (id, nd) => ({ id, name: id, formulaNum: 2, coefficients: [1.03961212, 0.00600069867, 0.231792344, 0.0200179144, 1.01046945, 103.560653, 0, 0, 0, 0], nd, kTable: [] });

function makeTree(name) {
    const materialsDir = path.join(root, name, 'Materials');
    for (const sub of ['agf', 'user']) fs.mkdirSync(path.join(materialsDir, sub), { recursive: true });
    const handlers = {};
    const tree = {
        materialsDir, saves: [], pick: null,
        agfPath: file => path.join(materialsDir, 'agf', file),
        call: (channel, ...args) => handlers[channel](null, ...args),
    };
    catalogsIpc.register({ handle: (channel, fn) => { handlers[channel] = fn; } }, {
        fs, path, log: () => {}, materialsDir, getMainWindow: () => null,
        dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [tree.pick] }) },
        ...paths,
    });
    tree.api = {
        loadCatalogs: () => handlers['catalog:load-all'](),
        scanAgfDir: () => handlers['catalog:scan-agf-dir'](),
        saveCatalog: cat => { tree.saves.push(cat.id); return handlers['catalog:save'](null, cat); },
        deleteCatalog: (id, source) => handlers['catalog:delete'](null, id, source),
        importCatalogAgf: () => handlers['catalog:import-agf'](),
    };
    tree.start = async () => {
        globalThis.electronAPI = tree.api;
        tree.saves.length = 0;
        await loadCatalogsFromDisk();
    };
    tree.put = (file, text, mtime) => {
        fs.writeFileSync(tree.agfPath(file), text);
        if (mtime) fs.utimesSync(tree.agfPath(file), mtime, mtime);
    };
    return tree;
}

const agfCatalogs = () => cm.getCatalogs().filter(cat => cat.source === 'agf');
const holding = glassName => agfCatalogs().filter(cat => cat.materials[glassName]);
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

try {
    // ── File names that slug alike, or that name a reserved id ───────────────
    {
        const tree = makeTree('names');
        tree.put('builtin.agf', agfText(['BIN', 1.5]));
        tree.put('design.agf', agfText(['DES', 1.51]));
        tree.put('ЛЗОС.agf', agfText(['K8', 1.516]));
        tree.put('Шотт.agf', agfText(['N-BK7', 1.5168]));
        tree.put('ohara-2019.agf', agfText(['S-BSL7', 1.5163]));
        tree.put('ohara_2019.agf', agfText(['S-BAL2', 1.5709]));
        await tree.start();

        for (const name of ['BIN', 'DES', 'K8', 'N-BK7', 'S-BSL7', 'S-BAL2']) {
            assert.equal(holding(name).length, 1, `${name} is in exactly one catalog`);
        }
        const ids = agfCatalogs().map(cat => cat.id);
        assert.equal(new Set(ids).size, 6, `six files, six catalogs: ${ids}`);
        assert.ok(!ids.includes('builtin') && !ids.includes('design'), 'no file takes a reserved id');
        assert.equal(holding('K8')[0].name, 'ЛЗОС', 'the name is the file name, readable');
        assert.equal(holding('N-BK7')[0].name, 'Шотт');
        assert.equal(holding('S-BAL2')[0].id, 'ohara_2019', 'a name that slugs to itself keeps the plain id');
        assert.match(holding('S-BSL7')[0].id, /^ohara_2019_[0-9a-f]{8}$/, 'one that lost characters gets a short hash');
        const k8 = holding('K8')[0];
        assert.equal(k8.sourceFile, 'ЛЗОС.agf', 'the catalog records its file');
        assert.equal(k8.sourceSize, fs.statSync(tree.agfPath('ЛЗОС.agf')).size);
        assert.ok(k8.uid, 'and is stamped');

        // The next start finds every catalog by its file and rewrites nothing.
        const before = Object.fromEntries(agfCatalogs().map(cat => [cat.sourceFile, cat.id]));
        await tree.start();
        assert.deepEqual(Object.fromEntries(agfCatalogs().map(cat => [cat.sourceFile, cat.id])), before);
        assert.deepEqual(tree.saves, [], 'an unchanged folder writes no catalog');
    }

    // ── Catalogs an earlier build made, and a file that changes ──────────────
    {
        const tree = makeTree('legacy');
        const old = new Date('2026-01-01T00:00:00Z');
        tree.put('schott2025.AGF', agfText(['N-BK7', 1.5168], ['N-SF6', 1.8052]), old);
        fs.writeFileSync(path.join(tree.materialsDir, 'agf', 'schott2025.catalog.json'), JSON.stringify({
            id: 'schott2025', name: 'schott2025', source: 'agf',
            materials: { 'N-BK7': glass('N-BK7', 1.5168), OWN: { id: 'OWN', name: 'Own', formulaNum: -1, tabData: [[400, 1.6, 0], [800, 1.58, 0]] } },
        }));
        // Two files whose names both slugged to '____'; the catalog holds the second's glass.
        tree.put('ЛЗОС.agf', agfText(['K8', 1.516]));
        tree.put('Шотт.agf', agfText(['N-BK7-SH', 1.5168]));
        fs.writeFileSync(path.join(tree.materialsDir, 'agf', '____.catalog.json'), JSON.stringify({
            id: '____', name: '____', source: 'agf', materials: { 'N-BK7-SH': glass('N-BK7-SH', 1.5168) },
        }));
        await tree.start();

        const schott = cm.getCatalog('schott2025');
        assert.deepEqual(Object.keys(schott.materials).sort(), ['N-BK7', 'OWN'], 'a catalog with no recorded file size counts as current');
        assert.equal(schott.sourceFile, 'schott2025.AGF', 'and is matched to its file');
        assert.equal(schott.sourceMtime, old.getTime());
        const uid = schott.uid;
        assert.ok(uid);
        assert.equal(holding('N-BK7-SH')[0].id, '____', 'the old catalog stays with the file whose glasses it holds');
        assert.equal(holding('N-BK7-SH')[0].sourceFile, 'Шотт.agf');
        assert.equal(holding('K8').length, 1, 'the other file gets a catalog of its own');
        assert.notEqual(holding('K8')[0].id, '____');

        // A newer schott2025.AGF (a seed bump, or the user's copy) rebuilds it.
        tree.put('schott2025.AGF', agfText(['N-BK7', 1.517], ['N-SF6', 1.8052], ['N-SF11', 1.7847]), new Date('2026-06-01T00:00:00Z'));
        await tree.start();
        const rebuilt = cm.getCatalog('schott2025');
        assert.deepEqual(Object.keys(rebuilt.materials).sort(), ['N-BK7', 'N-SF11', 'N-SF6', 'OWN'], 'new glasses in, the own material kept');
        assert.equal(rebuilt.materials['N-BK7'].nd, 1.517, 'a glass the file defines takes the file data');
        assert.equal(rebuilt.uid, uid, 'the rebuilt catalog keeps its stamp');
        assert.equal(rebuilt.name, 'schott2025');

        // An import of the same file through the Material Editor keeps it too.
        cm.addCatalog({ ...rebuilt, materials: { ...rebuilt.materials, OWN2: { id: 'OWN2', name: 'Own 2', formulaNum: -1, tabData: [[400, 1.7, 0], [800, 1.68, 0]] } } });
        tree.pick = tree.agfPath('schott2025.AGF');
        const notes = [];
        const me = { importSuccess: n => `imported ${n}`, importError: e => `error ${e}`, agfRejected: l => l };
        await importAgfCatalog({ me, notify: (type, msg) => notes.push([type, msg]), loadCatalogs: () => {}, setCatFilter: () => {} });
        assert.equal(notes.at(-1)[0], 'ok', String(notes.at(-1)));
        assert.deepEqual(Object.keys(cm.getCatalog('schott2025').materials).sort(), ['N-BK7', 'N-SF11', 'N-SF6', 'OWN', 'OWN2'],
            'a re-import keeps the materials the AGF does not define');
        assert.equal(agfCatalogs().filter(cat => cat.sourceFile === 'schott2025.AGF').length, 1, 'and adds no second catalog');

        // Delete the catalog: it stays deleted at the next start.
        cm.removeCatalog('schott2025');
        await settle();
        assert.ok(!fs.existsSync(path.join(tree.materialsDir, 'agf', 'schott2025.catalog.json')));
        await tree.start();
        assert.equal(cm.getCatalog('schott2025'), null, 'the scan does not bring a deleted catalog back');
        assert.equal(holding('N-SF11').length, 0);

        // Nor does the seed, on a normal start or on a version bump.
        const srcDir = path.join(root, 'app', 'src');
        const seedAgf = path.join(root, 'app', 'build', 'seed', 'agf');
        fs.mkdirSync(srcDir, { recursive: true });
        fs.mkdirSync(seedAgf, { recursive: true });
        fs.writeFileSync(path.join(seedAgf, 'schott2025.AGF'), agfText(['N-BK7', 1.5168]));
        fs.writeFileSync(path.join(seedAgf, 'hoya.AGF'), agfText(['E-C3', 1.5182]));
        fs.unlinkSync(tree.agfPath('schott2025.AGF'));
        seed.seedBundledMaterials(tree.materialsDir, { isPackaged: false, srcDir });
        assert.ok(!fs.existsSync(tree.agfPath('schott2025.AGF')), 'the seed does not copy a removed file back');
        assert.ok(fs.existsSync(tree.agfPath('hoya.AGF')), 'other seed files are copied as before');
        fs.unlinkSync(path.join(tree.materialsDir, '.seed-version'));
        seed.seedBundledMaterials(tree.materialsDir, { isPackaged: false, srcDir });
        assert.ok(!fs.existsSync(tree.agfPath('schott2025.AGF')), 'nor on a version bump');
        await tree.start();
        assert.equal(cm.getCatalog('schott2025'), null);

        // Importing the file from the agf folder brings it back for good.
        tree.put('schott2025.AGF', agfText(['N-BK7', 1.5168]));
        tree.pick = tree.agfPath('schott2025.AGF');
        await importAgfCatalog({ me, notify: (type, msg) => notes.push([type, msg]), loadCatalogs: () => {}, setCatFilter: () => {} });
        assert.equal(holding('N-BK7').filter(cat => cat.sourceFile === 'schott2025.AGF').length, 1, 'imported again');
        await tree.start();
        assert.equal(agfCatalogs().filter(cat => cat.sourceFile === 'schott2025.AGF').length, 1, 'and kept at the next start');
    }

    // ── A catalog deleted before any start of this build stamped it ──────────
    {
        const tree = makeTree('unstamped');
        tree.put('hoya.agf', agfText(['E-C3', 1.5182]));
        fs.writeFileSync(path.join(tree.materialsDir, 'agf', 'hoya.catalog.json'), JSON.stringify({
            id: 'hoya', name: 'hoya', source: 'agf', materials: { 'E-C3': glass('E-C3', 1.5182) },
        }));
        const result = await tree.call('catalog:delete', 'hoya', 'agf');
        assert.equal(result.success, true);
        await tree.start();
        assert.equal(agfCatalogs().length, 0, 'the file the old catalog was made from is left out');
    }

    console.log('PASS: catalog_agf_files');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
