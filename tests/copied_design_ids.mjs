/**
 * A design copied into a second project folder outside the app.
 *
 * Copying a .tfs or a whole project folder in the file manager keeps the
 * design's id. Before the loader gave such a copy an id of its own, the two
 * files were one design behind two rows: the copy's row showed the other
 * file, and a save through one row wrote into the other folder and deleted
 * the file there. Runs the real load, save and delete handlers against a
 * Projects tree under os.tmpdir().
 *
 * Run: node tests/copied_design_ids.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFoldersResult } from '../src/utils/io/projectPersistence.js';
import { mergeSessionOverDisk, sessionEntryFor } from '../src/utils/io/sessionMerge.js';

const require = createRequire(import.meta.url);
const projects = require('../src/main/ipc/projects.js');
const { safeName, safeSegments, safeFilePath, readJsonSafe, writeFileAtomic } = require('../src/main/paths.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-copied-ids-'));
const projectsDir = path.join(root, 'Projects');
const logLines = [];
const handlers = new Map();
projects.register({ handle(channel, handler) { handlers.set(channel, handler); } }, {
    fs, path, log: line => logLines.push(line), projectsDir,
    safeName, safeSegments, safeFilePath, readJsonSafe, writeFileAtomic,
});
const call = async (channel, ...args) => handlers.get(channel)(null, ...args);

const design = (id, name, material, thickness) => ({
    tfs_version: '1.2', id, name,
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    frontLayers: [{ id: `${name}-1`, material, thickness, locked: false }], backLayers: [],
});
const writeDesign = (folder, d) => {
    fs.mkdirSync(path.join(projectsDir, folder), { recursive: true });
    fs.writeFileSync(path.join(projectsDir, folder, `${d.name}.tfs`), JSON.stringify(d, null, 2));
};
const readDesign = (folder, name) => JSON.parse(fs.readFileSync(path.join(projectsDir, folder, `${name}.tfs`), 'utf8'));
const rows = result => result.folders.flatMap(f => f.items.map(item => ({ folder: f.id, ...item })));

try {
    // The original, a whole folder copied beside it, and a backup folder inside it.
    writeDesign('My Designs', design('design-B', 'Filter B', 'TiO2', 100));
    writeDesign('My Designs - Copy', design('design-B', 'Filter B', 'SiO2', 50));
    writeDesign('My Designs/backup', design('design-B', 'Filter B old', 'Ta2O5', 70));

    const first = await call('load-folders');
    assert.equal(first.success, true);
    const loaded = rows(first);
    assert.equal(loaded.length, 3);
    assert.equal(new Set(loaded.map(r => r.id)).size, 3, 'every copy is a design of its own');
    const original = loaded.find(r => r.folder === 'My Designs');
    const copy = loaded.find(r => r.folder === 'My Designs - Copy');
    const backup = loaded.find(r => r.folder === 'My Designs/backup');
    assert.equal(original.id, 'design-B', 'the first file in tree order keeps the id');
    assert.match(copy.id, /^design-\d+-[a-z0-9]+$/, 'a copy gets an id shaped like a new design\'s');

    const { diskDesigns } = parseFoldersResult(first);
    assert.equal(diskDesigns[original.id].frontLayers[0].material, 'TiO2', 'the original row shows the original');
    assert.equal(diskDesigns[copy.id].frontLayers[0].material, 'SiO2', 'the copy row shows the copy');
    assert.equal(diskDesigns[backup.id].frontLayers[0].material, 'Ta2O5', 'the backup row shows the backup');

    // The new id is written into the copy and nothing else in it changes.
    const copyOnDisk = readDesign('My Designs - Copy', 'Filter B');
    assert.equal(copyOnDisk.id, copy.id, 'the copy\'s file carries its new id');
    assert.deepEqual({ ...copyOnDisk, id: 'design-B' }, design('design-B', 'Filter B', 'SiO2', 50),
        'only the id of the copy\'s file changes');
    assert.equal(readDesign('My Designs', 'Filter B').id, 'design-B', 'the original\'s file is not touched');
    assert.ok(logLines.some(line => line.includes('Filter B.tfs holds design id design-B')), 'the log names the file');

    // A second start finds every id taken once and writes nothing.
    const before = fs.readFileSync(path.join(projectsDir, 'My Designs - Copy', 'Filter B.tfs'), 'utf8');
    const second = rows(await call('load-folders'));
    assert.deepEqual(second.map(r => r.id).sort(), loaded.map(r => r.id).sort(), 'the ids hold from one start to the next');
    assert.equal(fs.readFileSync(path.join(projectsDir, 'My Designs - Copy', 'Filter B.tfs'), 'utf8'), before);

    // Saving the original and deleting the copy each touch only their own folder.
    const edited = { ...diskDesigns[original.id], frontLayers: [{ id: 'e1', material: 'TiO2', thickness: 120, locked: false }] };
    assert.equal((await call('save-design', 'My Designs', edited)).success, true);
    assert.equal(readDesign('My Designs - Copy', 'Filter B').frontLayers[0].material, 'SiO2',
        'saving the original leaves the copy\'s file as it was');
    assert.ok(fs.existsSync(path.join(projectsDir, 'My Designs/backup', 'Filter B old.tfs')),
        'and does not delete the backup, whose name differs');
    assert.equal((await call('delete-item', 'My Designs - Copy', 'Filter B')).success, true);
    assert.equal(readDesign('My Designs', 'Filter B').frontLayers[0].thickness, 120, 'deleting the copy leaves the original');

    // A saved edit is still what the original shows at the next start.
    const third = parseFoldersResult(await call('load-folders')).diskDesigns;
    const entry = sessionEntryFor(edited, { past: [diskDesigns[original.id]], future: [] }, third[original.id]);
    const merged = mergeSessionOverDisk(third, { [original.id]: entry });
    assert.equal(merged.initialDesigns[original.id].frontLayers[0].thickness, 120);
    assert.deepEqual(merged.replaced, [], 'no other copy displaces the saved edit');

    // Links: two links to one file are one design; a link to a different file
    // gets an id in memory, and the link stays a link. Each sits in a folder of
    // its own, since two files of one id in one folder are set aside instead.
    const target = path.join(root, 'shared', 'Shared AR.tfs');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(design('design-S', 'Shared AR', 'MgF2', 98), null, 2));
    const other = path.join(root, 'shared', 'Other AR.tfs');
    fs.writeFileSync(other, JSON.stringify(design('design-S', 'Other AR', 'SiO2', 98), null, 2));
    let linked = false;
    try {
        fs.mkdirSync(path.join(projectsDir, 'Linked A'), { recursive: true });
        fs.mkdirSync(path.join(projectsDir, 'Linked B'), { recursive: true });
        fs.mkdirSync(path.join(projectsDir, 'Linked C'), { recursive: true });
        fs.symlinkSync(target, path.join(projectsDir, 'Linked A', 'Shared AR.tfs'), 'file');
        fs.symlinkSync(target, path.join(projectsDir, 'Linked B', 'Shared AR.tfs'), 'file');
        fs.symlinkSync(other, path.join(projectsDir, 'Linked C', 'Other AR.tfs'), 'file');
        linked = true;
    } catch (err) {
        console.log(`copied design ids: links not tested here (${err.code})`);
    }
    if (linked) {
        const withLinks = rows(await call('load-folders'));
        const shared = withLinks.filter(r => r.name === 'Shared AR');
        assert.equal(shared.length, 2);
        assert.ok(shared.every(r => r.id === 'design-S'), 'two links to one file stay one design');
        const otherRow = withLinks.find(r => r.name === 'Other AR');
        assert.notEqual(otherRow.id, 'design-S', 'a link to a different file with that id is a design of its own');
        assert.ok(fs.lstatSync(path.join(projectsDir, 'Linked C', 'Other AR.tfs')).isSymbolicLink(), 'the link stays a link');
        assert.equal(JSON.parse(fs.readFileSync(other, 'utf8')).id, 'design-S', 'the file behind it is not rewritten');
    }
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

// The same rules for links, run on a stand-in file system so they hold where
// the machine refuses to make a link.
{
    const { giveCopiesTheirOwnIds } = require('../src/main/copiedDesignIds.js');
    const files = {
        '/P/A/Shared.tfs': { real: '/shared/Shared.tfs', link: true },
        '/P/B/Shared.tfs': { real: '/shared/Shared.tfs', link: true },
        '/P/B/Other.tfs': { real: '/shared/Other.tfs', link: true },
        '/P/C/Copy.tfs': { real: '/P/C/Copy.tfs', link: false },
    };
    const written = [];
    const ctx = {
        path,
        log: () => {},
        treeIds: new Map(),
        fs: {
            realpathSync: file => files[file].real,
            lstatSync: file => ({ isSymbolicLink: () => files[file].link }),
            readFileSync: () => JSON.stringify({ id: 'design-S', name: 'x' }),
        },
        writeFileAtomic: (file, text) => written.push({ file, id: JSON.parse(text).id }),
    };
    const folder = (file, name) => {
        const items = [{ id: 'design-S', name, design: { id: 'design-S', name } }];
        giveCopiesTheirOwnIds(ctx, items, new Map([['design-S', { file }]]));
        return items[0].id;
    };
    assert.equal(folder('/P/A/Shared.tfs', 'Shared'), 'design-S', 'the first holder keeps the id');
    assert.equal(folder('/P/B/Shared.tfs', 'Shared'), 'design-S', 'a second link to the same file stays the same design');
    const linkedCopy = folder('/P/B/Other.tfs', 'Other');
    assert.notEqual(linkedCopy, 'design-S', 'a link to a different file gets an id of its own');
    const plainCopy = folder('/P/C/Copy.tfs', 'Copy');
    assert.notEqual(plainCopy, 'design-S');
    assert.deepEqual(written, [{ file: '/P/C/Copy.tfs', id: plainCopy }],
        'only the plain file is rewritten; a link would be replaced by the write');
}

console.log('Copied design ids passed.');
