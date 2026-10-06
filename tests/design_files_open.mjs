/**
 * Opening a .tfs by path, from the file manager or File > Open, shows the
 * design in that file.
 *
 * A file inside the Projects tree is matched to its row by where it is, not
 * by the id it holds: a copy made in the file manager while the app runs
 * holds the original's id, and showing the original for it had the user edit
 * the wrong design. The main process gives such a copy an id of its own,
 * written into it, and names it after its file, so the renderer adds it as a
 * row of its own; the row's own file is selected. File > Open goes the same
 * way rather than importing a duplicate of a design already in the tree.
 *
 * A path given relative to a terminal's folder resolves against that folder.
 *
 * Runs the real main-process handlers on a temp tree and the real
 * useDesignImport hook wired to them.
 *
 * Run: node tests/design_files_open.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadApp, makeLocale, shimBrowserGlobals } from './_uiShim.mjs';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';
import { designFileLocations, joinFolderId } from '../src/components/panels/projectExplorerModel.js';

const require = createRequire(import.meta.url);
const projects = require('../src/main/ipc/projects.js');
const { designFileFromArgv } = require('../src/main/openFileArg.js');
const { safeName, safeSegments, safeFilePath, readJsonSafe, writeFileAtomic, readTextAuto } = require('../src/main/paths.js');

shimBrowserGlobals();
await loadApp();
const t = makeLocale();

// ── 16. A relative path from a second launch ─────────────────────────────────
{
    const exe = path.resolve('TFStudio.exe');
    const work = path.resolve(os.tmpdir(), 'terminal folder');
    assert.equal(designFileFromArgv([exe, 'design.tfs'], work), path.join(work, 'design.tfs'),
        'a relative path resolves against the folder the second launch ran in');
    assert.equal(designFileFromArgv([exe, 'design.tfs']), path.resolve('design.tfs'),
        'and against this process\'s own folder when none is given');
    const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    assert.match(main, /app\.on\('second-instance',\s*\(event, argv, workingDirectory\)\s*=>\s*\{\s*deliverOpenFile\(designFileFromArgv\(argv, workingDirectory\)\)/,
        'the second-instance handler passes Electron\'s working directory on');
}

// ── 13. The main process ─────────────────────────────────────────────────────
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-design-open-'));
const projectsDir = path.join(root, 'Projects');
const F = 'My Designs';
const design = (id, name, extra = {}) => ({
    id, name, substrate: { material: 'BK7', thickness: 1 }, frontLayers: [], backLayers: [], ...extra,
});
const put = (dir, file, d) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), JSON.stringify(d, null, 2));
    return path.join(dir, file);
};
let picked = null;
const handlers = new Map();
projects.register({ handle(channel, handler) { handlers.set(channel, handler); } }, {
    fs, path, log: () => {}, projectsDir,
    safeName, safeSegments, safeFilePath, readJsonSafe, writeFileAtomic, readTextAuto,
    dialog: { showOpenDialog: async () => (picked ? { canceled: false, filePaths: [picked] } : { canceled: true, filePaths: [] }) },
    getMainWindow: () => null,
});
const call = (channel, ...args) => handlers.get(channel)(null, ...args);

try {
    const folderDir = path.join(projectsDir, F);
    const d1 = put(folderDir, 'D1.tfs', design('design-d1', 'D1', { notes: 'original' }));
    const rows = { 'design-d1': `${F}/D1.tfs` };

    {
        const own = await call('open-tfs-path', d1, rows);
        assert.equal(own.success, true);
        assert.equal(own.folderId, F);
        assert.equal(own.design.id, 'design-d1', 'the row\'s own file keeps its id');

        const copyPath = path.join(folderDir, 'D1 - Copy.tfs');
        fs.copyFileSync(d1, copyPath);
        const copy = await call('open-tfs-path', copyPath, rows);
        assert.equal(copy.success, true);
        assert.notEqual(copy.design.id, 'design-d1', 'a copy of a design the tree shows elsewhere gets an id of its own');
        assert.equal(copy.design.name, 'D1 - Copy', 'and is named after its file');
        assert.equal(JSON.parse(fs.readFileSync(copyPath, 'utf8')).id, copy.design.id, 'the id is written into the copy');
        assert.equal(JSON.parse(fs.readFileSync(d1, 'utf8')).id, 'design-d1', 'and the original is untouched');
        fs.unlinkSync(copyPath);

        if (process.platform === 'win32') {
            const typed = await call('open-tfs-path', path.join(projectsDir, F.toUpperCase(), 'd1.tfs'), rows);
            assert.equal(typed.design.id, 'design-d1', 'a path typed in another case still names the row\'s own file');
            assert.equal(typed.folderId, F, 'and the folder as it is spelled on disk');
            assert.equal(typed.fileName, 'D1', 'and the file too');
        }

        // A folder made in the app under a name a filename cannot hold sits on
        // disk under the main process's spelling, and so does its id.
        const q3 = joinFolderId(null, 'Q3: tests');
        const q3File = put(path.join(projectsDir, 'Q3_ tests'), 'D.tfs', design('design-q3', 'D'));
        const q3Rows = designFileLocations([{ id: q3, items: [{ id: 'design-q3', name: 'D' }] }]);
        const q3Own = await call('open-tfs-path', q3File, q3Rows);
        assert.equal(q3Own.folderId, q3, 'the folder comes back under the id the tree has');
        assert.equal(q3Own.design.id, 'design-q3', 'and its design keeps its id');
        assert.equal(JSON.parse(fs.readFileSync(q3File, 'utf8')).id, 'design-q3', 'nothing is written into it');

        const idless = design('x', 'From script');
        delete idless.id;
        const scripted = put(folderDir, 'From script.tfs', idless);
        const opened = await call('open-tfs-path', scripted, rows);
        assert.match(opened.design.id, /^design-\d+-[a-z0-9]+$/, 'a design with no id gets one');
        assert.equal(JSON.parse(fs.readFileSync(scripted, 'utf8')).id, opened.design.id);
        fs.unlinkSync(scripted);

        const outside = put(path.join(root, 'Desktop'), 'shared.tfs', design('design-d1', 'Shared AR'));
        const before = fs.readFileSync(outside, 'utf8');
        const read = await call('open-tfs-path', outside, rows);
        assert.equal(read.folderId, null);
        assert.equal(read.design.name, 'Shared AR', 'a file outside the tree keeps its own name for the import');
        assert.equal(fs.readFileSync(outside, 'utf8'), before, 'and is never written');

        picked = d1;
        const chosen = await call('import-tfs', rows);
        assert.equal(chosen.success, true);
        assert.equal(chosen.folderId, F, 'File > Open names the folder of a file in the tree');
        assert.equal(chosen.filePath, d1);
        picked = null;
    }

    // ── 13. The renderer ─────────────────────────────────────────────────────
    {
        const runtime = makeHookRuntime();
        const { useDesignImport } = await importWithHookRuntime('../src/hooks/useDesignImport.js', runtime);
        let openFileListener = null;
        globalThis.window.electronAPI = {
            openTfsPath: (filePath, locations) => call('open-tfs-path', filePath, locations),
            importTfs: (locations) => call('import-tfs', locations),
            onOpenFile: (cb) => { openFileListener = cb; return () => {}; },
            takePendingOpenFile: async () => null,
        };
        const log = [];
        const folders = [{ id: F, name: F, expanded: true, items: [{ id: 'design-d1', name: 'D1', mtime: 1 }, { id: 'design-mine', name: 'AR', mtime: 1 }] }];
        put(folderDir, 'AR.tfs', design('design-mine', 'AR'));
        const tree = {
            foldersRef: { current: folders },
            foldersLoaded: true,
            selectedFolder: folders[0],
            existingDesignNames: (folderId) => folders.find(f => f.id === folderId).items.map(i => i.name),
            commitNewDesign: (d, folder) => {
                log.push(`commit ${d.name} ${d.id === 'design-d1' ? 'with the original id' : 'with an id of its own'} in ${folder.id}`);
                folder.items.push({ id: d.id, name: d.name });
            },
            selectDesignInTree: (id) => {
                const held = folders.some(f => f.items.some(i => i.id === id));
                if (held) log.push(`select ${id}`);
                return held;
            },
        };
        const hookArgs = {
            tree, openTool: () => {}, t,
            addItemFromDesign: async (d) => { log.push(`import ${d.name}`); return true; },
            setMessageNotification: (n) => log.push(`notice ${n.message}`),
        };
        const real = globalThis.React;
        globalThis.React = runtime.React;
        let api;
        try {
            api = runtime.render(() => useDesignImport(hookArgs));
            runtime.pendingEffects().forEach(fn => fn());
        } finally {
            globalThis.React = real;
        }
        assert.ok(openFileListener, 'the hook listens for files handed over by the file manager');

        await openFileListener(d1);
        assert.deepEqual(log, ['select design-d1'], 'the row\'s own file is selected');

        log.length = 0;
        const copyPath = path.join(folderDir, 'D1 - Copy.tfs');
        fs.copyFileSync(d1, copyPath);
        await openFileListener(copyPath);
        assert.deepEqual(log, [`commit D1 - Copy with an id of its own in ${F}`], 'a copy put there while the app runs is shown as its own design');

        log.length = 0;
        put(folderDir, 'AR (2).tfs', design('design-colleague', 'AR'));
        await openFileListener(path.join(folderDir, 'AR (2).tfs'));
        assert.deepEqual(log, [`commit AR (2) with an id of its own in ${F}`], 'a colleague\'s AR beside yours gets a row of its own name');

        log.length = 0;
        picked = d1;
        await api.openDesignFromFile();
        assert.deepEqual(log, ['select design-d1'], 'File > Open of a design in the tree selects it instead of importing a copy');

        if (process.platform === 'win32') {
            log.length = 0;
            await openFileListener(path.join(projectsDir, F.toLowerCase(), 'd1.tfs'));
            assert.deepEqual(log, ['select design-d1'], 'a path typed in another case selects the row instead of importing a copy');

            // A file put into the folder while the app runs, opened by a path
            // typed in another case, is shown in its folder under its own name.
            log.length = 0;
            put(folderDir, 'Colleague.tfs', design('design-colleague-2', 'Colleague'));
            await openFileListener(path.join(projectsDir, F.toLowerCase(), 'colleague.tfs'));
            assert.deepEqual(log, [`commit Colleague with an id of its own in ${F}`],
                'a new file opened by a path in another case gets its row, not an imported copy');

            // The folder renamed in case in Windows Explorer while the app runs:
            // the tree still has the old spelling, and the row's file is shown.
            log.length = 0;
            const respelled = path.join(projectsDir, F.toUpperCase());
            fs.renameSync(folderDir, respelled);
            try {
                await openFileListener(path.join(respelled, 'D1.tfs'));
                assert.deepEqual(log, ['select design-d1'], 'a folder renamed in case outside the app still shows the row');
            } finally {
                fs.renameSync(respelled, folderDir);
            }
        }

        log.length = 0;
        picked = put(path.join(root, 'Desktop'), 'other.tfs', design('design-other', 'Other'));
        await api.openDesignFromFile();
        assert.deepEqual(log, ['import Other'], 'a file from outside the tree is imported as before');
        picked = null;
    }
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

console.log('design_files_open: passed');
