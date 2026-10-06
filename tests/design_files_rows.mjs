/**
 * Every explorer row acts on the file it was loaded from.
 *
 * A row is addressed on disk by its name, so the loader names each row after
 * its file whenever the name inside the design would point somewhere else: a
 * colleague's AR.tfs kept beside yours as 'AR (2).tfs', a file renamed in the
 * file manager, a name that is a number or missing. Delete, rename and move
 * take the row's design id as well and leave alone a file that holds another
 * design.
 *
 * Copies made in the file manager are designs of their own: one in the same
 * folder gets a fresh id written into it, as a copy in another folder already
 * did, and the original keeps its id. Where the app last saw a design decides
 * which file is the original; failing that, the file named after the design;
 * failing that, tree order. Nothing is set aside as .bak and a save deletes no
 * other file.
 *
 * A .tfs written with a byte order mark or as UTF-16 loads, a design with no
 * id gets one, a file the loader cannot read is named in the result and is
 * never written over.
 *
 * Runs the real handlers against a Projects tree under os.tmpdir().
 *
 * Run: node tests/design_files_rows.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const projects = require('../src/main/ipc/projects.js');
const { safeName, safeSegments, safeFilePath, readJsonSafe, writeFileAtomic, readTextAuto } = require('../src/main/paths.js');

const roots = [];
function makeTree(extraCtx = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-design-rows-'));
    roots.push(root);
    const projectsDir = path.join(root, 'Projects');
    fs.mkdirSync(projectsDir, { recursive: true });
    const logLines = [];
    const handlers = new Map();
    projects.register({ handle(channel, handler) { handlers.set(channel, handler); } }, {
        fs, path, log: line => logLines.push(line), projectsDir,
        safeName, safeSegments, safeFilePath, readJsonSafe, writeFileAtomic, readTextAuto,
        ...extraCtx,
    });
    const call = async (channel, ...args) => handlers.get(channel)(null, ...args);
    const dir = folder => path.join(projectsDir, folder);
    const write = (folder, file, content) => {
        fs.mkdirSync(dir(folder), { recursive: true });
        fs.writeFileSync(path.join(dir(folder), file),
            typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content, null, 2));
    };
    const text = (folder, file) => fs.readFileSync(path.join(dir(folder), file), 'utf8');
    const read = (folder, file) => JSON.parse(text(folder, file));
    const ls = folder => fs.readdirSync(dir(folder)).sort();
    const rows = result => result.folders.flatMap(f => f.items.map(item => ({ folder: f.id, ...item })));
    return { root, projectsDir, logLines, call, dir, write, text, read, ls, rows };
}

const design = (id, name, extra = {}) => ({
    tfs_version: '1.2', id, name,
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    frontLayers: [{ id: 'l1', material: 'TiO2', thickness: 100, locked: false }], backLayers: [],
    ...extra,
});
const F = 'My Designs';

try {
    // ── 1a. Two designs whose inner names are the same ───────────────────────
    for (const op of ['delete', 'rename', 'move', 'save']) {
        const tree = makeTree();
        tree.write(F, 'AR.tfs', design('design-mine', 'AR', { notes: 'MINE' }));
        tree.write(F, 'AR (2).tfs', design('design-colleague', 'AR', { notes: 'COLLEAGUE' }));
        tree.write('Archive', 'x.tfs', design('design-x', 'x'));
        const mineBefore = tree.text(F, 'AR.tfs');
        const loaded = await tree.call('load-folders');
        const names = tree.rows(loaded).filter(r => r.folder === F).map(r => r.name).sort();
        assert.deepEqual(names, ['AR', 'AR (2)'], 'two rows in one folder never carry the same name');
        const colleague = tree.rows(loaded).find(r => r.id === 'design-colleague');
        assert.equal(colleague.design.name, 'AR (2)', 'the design itself carries the file name, so its next save writes there');
        assert.equal(tree.text(F, 'AR.tfs'), mineBefore, 'loading rewrites no file to rename it');

        if (op === 'delete') {
            assert.equal((await tree.call('delete-item', F, colleague.name, colleague.id)).success, true);
            assert.deepEqual(tree.ls(F), ['AR.tfs'], 'deleting the colleague row deletes the colleague file only');
        } else if (op === 'rename') {
            assert.equal((await tree.call('rename-item', F, colleague.name, 'AR colleague', colleague.id)).success, true);
            assert.deepEqual(tree.ls(F), ['AR colleague.tfs', 'AR.tfs']);
            assert.equal(tree.read(F, 'AR colleague.tfs').notes, 'COLLEAGUE', 'the renamed file is the colleague design');
            assert.equal(tree.text(F, 'AR.tfs'), mineBefore, 'and your design is untouched');
        } else if (op === 'move') {
            assert.equal((await tree.call('move-item', F, 'Archive', colleague.name, colleague.id)).success, true);
            assert.deepEqual(tree.ls('Archive'), ['AR (2).tfs', 'x.tfs']);
            assert.equal(tree.read('Archive', 'AR (2).tfs').id, 'design-colleague', 'the colleague design moves');
            assert.equal(tree.text(F, 'AR.tfs'), mineBefore, 'and yours stays');
        } else {
            const saved = await tree.call('save-design', F, { ...colleague.design, notes: 'COLLEAGUE EDITED' });
            assert.equal(saved.success, true, 'Ctrl+S on the colleague row is not refused');
            assert.equal(tree.read(F, 'AR (2).tfs').notes, 'COLLEAGUE EDITED');
            assert.equal(tree.text(F, 'AR.tfs'), mineBefore);
        }
    }

    // ── 1b. A file renamed in the file manager; the id guard ─────────────────
    {
        const tree = makeTree();
        tree.write(F, 'Old AR.tfs', design('design-d1', 'D1'));
        tree.write(F, 'Mine.tfs', design('design-m', 'Mine'));
        const row = tree.rows(await tree.call('load-folders')).find(r => r.id === 'design-d1');
        assert.equal(row.name, 'Old AR', 'the row shows the name the file manager shows');

        const wrongDelete = await tree.call('delete-item', F, 'Mine', 'design-d1');
        assert.equal(wrongDelete.success, false, 'a delete that reaches another design\'s file is refused');
        assert.equal(wrongDelete.error, 'not-this-design');
        const wrongRename = await tree.call('rename-item', F, 'Mine', 'Other', 'design-d1');
        assert.equal(wrongRename.error, 'not-this-design', 'so is a rename');
        const wrongMove = await tree.call('move-item', F, 'Archive', 'Mine', 'design-d1');
        assert.equal(wrongMove.error, 'not-this-design', 'and a move');
        assert.deepEqual(tree.ls(F), ['Mine.tfs', 'Old AR.tfs'], 'and nothing on disk changed');

        assert.equal((await tree.call('rename-item', F, row.name, 'AR', row.id)).success, true, 'the row renames its own file');
        assert.deepEqual(tree.ls(F), ['AR.tfs', 'Mine.tfs']);
        assert.equal((await tree.call('delete-item', F, 'AR', row.id)).success, true);
        assert.deepEqual(tree.ls(F), ['Mine.tfs'], 'and deletes it');
        assert.equal((await tree.call('delete-item', F, 'Mine')).success, true, 'a call without an id behaves as it did');
    }

    // ── 1c. Names the app wrote keep their own spelling ──────────────────────
    {
        const tree = makeTree();
        await tree.call('create-folder', F);
        assert.equal((await tree.call('save-design', F, design('design-s', 'A/B: test?'))).success, true);
        const row = tree.rows(await tree.call('load-folders')).find(r => r.id === 'design-s');
        assert.equal(row.name, 'A/B: test?', 'a name with characters a file cannot hold is kept');
    }

    // ── 11. A name that is a number, or missing ──────────────────────────────
    {
        const tree = makeTree();
        tree.write(F, '2024 run.tfs', design('design-n', 2024));
        const nameless = design('design-u', 'x');
        delete nameless.name;
        tree.write(F, 'No name.tfs', nameless);
        tree.write(F, 'Blank.tfs', design('design-b', ''));
        const loaded = tree.rows(await tree.call('load-folders'));
        const byId = Object.fromEntries(loaded.map(r => [r.id, r]));
        assert.equal(byId['design-n'].name, '2024 run', 'a numeric name opens under the file name');
        assert.equal(byId['design-u'].name, 'No name', 'a missing name opens under the file name');
        assert.equal(byId['design-b'].name, 'Blank', 'an empty name opens under the file name');
        assert.equal((await tree.call('save-design', F, byId['design-n'].design)).success, true, 'and saves');
        assert.equal((await tree.call('rename-item', F, 'No name', 'Named', 'design-u')).success, true, 'renames');
        assert.equal((await tree.call('delete-item', F, 'Blank', 'design-b')).success, true, 'and deletes');
        assert.deepEqual(tree.ls(F), ['2024 run.tfs', 'Named.tfs']);
        assert.equal(tree.read(F, '2024 run.tfs').name, '2024 run', 'the save writes the file name into the design');
    }

    // ── 2. A copy made in the same folder ────────────────────────────────────
    {
        const tree = makeTree();
        tree.write(F, 'D1.tfs', design('design-d1', 'D1', { notes: 'original' }));
        fs.copyFileSync(path.join(tree.dir(F), 'D1.tfs'), path.join(tree.dir(F), 'D1 - Copy.tfs'));
        const stamp = new Date(Date.now() - 60000);
        for (const f of ['D1.tfs', 'D1 - Copy.tfs']) fs.utimesSync(path.join(tree.dir(F), f), stamp, stamp);
        fs.writeFileSync(path.join(tree.dir(F), 'D1.tfs.bak'), 'an older set-aside copy');

        const loaded = tree.rows(await tree.call('load-folders'));
        assert.deepEqual(tree.ls(F), ['D1 - Copy.tfs', 'D1.tfs', 'D1.tfs.bak'], 'nothing is set aside and an old .bak stays');
        assert.equal(loaded.length, 2, 'both files are in the tree');
        const original = loaded.find(r => r.name === 'D1');
        const copy = loaded.find(r => r.name === 'D1 - Copy');
        assert.equal(original.id, 'design-d1', 'the file named after the design keeps the id');
        assert.notEqual(copy.id, 'design-d1', 'the copy is a design of its own');
        assert.equal(tree.read(F, 'D1 - Copy.tfs').id, copy.id, 'its new id is written into it');
        assert.equal(tree.read(F, 'D1.tfs').id, 'design-d1');
        const again = tree.rows(await tree.call('load-folders'));
        assert.equal(again.find(r => r.name === 'D1 - Copy').id, copy.id, 'and holds at the next start');

        assert.equal((await tree.call('delete-item', F, copy.name, copy.id)).success, true);
        assert.deepEqual(tree.ls(F), ['D1.tfs', 'D1.tfs.bak'], 'deleting the copy leaves the original');

        // A copy made while the app runs still shares the id until the next
        // start; a save of the original must not delete it.
        fs.copyFileSync(path.join(tree.dir(F), 'D1.tfs'), path.join(tree.dir(F), 'D1 backup before run.tfs'));
        assert.equal((await tree.call('save-design', F, { ...original.design, notes: 'edited' })).success, true);
        assert.deepEqual(tree.ls(F), ['D1 backup before run.tfs', 'D1.tfs', 'D1.tfs.bak'], 'a save deletes no other file');
        assert.equal(tree.read(F, 'D1 backup before run.tfs').notes, 'original');
    }

    // ── 3. Files with a byte order mark, as UTF-16, or without an id ────────
    {
        const tree = makeTree();
        const bomText = JSON.stringify(design('design-bom', 'Bom'), null, 2);
        tree.write(F, 'Bom.tfs', Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(bomText, 'utf8')]));
        const utf16 = JSON.stringify(design('design-u16', 'Wide'), null, 2);
        tree.write(F, 'Wide.tfs', Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(utf16, 'utf16le')]));
        const idless = design('x', 'From script');
        delete idless.id;
        tree.write(F, 'From script.tfs', idless);
        tree.write('Other', 'Design 2.tfs', '{ "id": "design-hand", "name": "Design 2", "notes": "HAND EDITED, ONLY COPY" ');
        const brokenBefore = tree.text('Other', 'Design 2.tfs');

        const result = await tree.call('load-folders');
        const loaded = tree.rows(result);
        const names = loaded.map(r => r.name).sort();
        assert.deepEqual(names, ['Bom', 'From script', 'Wide'], 'BOM, UTF-16 and id-less files load');
        const scripted = loaded.find(r => r.name === 'From script');
        assert.match(scripted.id, /^design-\d+-[a-z0-9]+$/, 'an id-less design gets an id shaped like a new design\'s');
        assert.equal(tree.read(F, 'From script.tfs').id, scripted.id, 'written into its file once');
        const second = tree.rows(await tree.call('load-folders'));
        assert.equal(second.find(r => r.name === 'From script').id, scripted.id, 'so it holds at the next start');
        assert.equal(result.unreadable, 1, 'only the broken file is counted unread');
        assert.deepEqual(result.unreadFiles, ['Other/Design 2.tfs'], 'and it is named by its place under Projects');

        const blank = design('design-new', 'Design 2', { notes: 'brand new blank design' });
        const refused = await tree.call('save-design', 'Other', blank);
        assert.equal(refused.success, false, 'a new design is not written over a file the app could not read');
        assert.equal(tree.text('Other', 'Design 2.tfs'), brokenBefore, 'the hand-edited file is unchanged');

        const opened = await tree.call('open-tfs-path', path.join(tree.dir(F), 'Bom.tfs'));
        assert.equal(opened.success, true, `a BOM file opens by path, got: ${opened.error}`);
        assert.equal((await tree.call('rename-item', F, 'Wide', 'Wide 2', 'design-u16')).success, true, 'a UTF-16 file renames');
        assert.equal(tree.read(F, 'Wide 2.tfs').id, 'design-u16');
    }

    // ── 5. A session read from the fallback folder ───────────────────────────
    {
        const plain = makeTree();
        assert.equal((await plain.call('load-folders')).fallback, false, 'the configured folder is no fallback');
        const fallback = makeTree({ userPaths: { rejected: { configured: 'W:\\TFStudio', reason: 'ENOENT' } } });
        fallback.write(F, 'Design 1.tfs', design('design-1', 'Design 1'));
        assert.equal((await fallback.call('load-folders')).fallback, true, 'a rejected data folder is reported');
    }

    // ── 6. A copy in a folder that sorts earlier ─────────────────────────────
    {
        const tree = makeTree();
        tree.write('Zeta project', 'AR.tfs', design('design-orig', 'AR', { notes: 'original' }));
        tree.write('Archive', 'AR.tfs', design('design-orig', 'AR', { notes: 'copy' }));
        const zetaBefore = tree.text('Zeta project', 'AR.tfs');
        const loaded = tree.rows(await tree.call('load-folders', { 'design-orig': 'Zeta project/AR.tfs' }));
        assert.equal(loaded.find(r => r.folder === 'Zeta project').id, 'design-orig', 'the file where the app last saw the design keeps the id');
        const archived = loaded.find(r => r.folder === 'Archive');
        assert.notEqual(archived.id, 'design-orig', 'the copy is the one renumbered');
        assert.equal(tree.read('Archive', 'AR.tfs').id, archived.id);
        assert.equal(tree.text('Zeta project', 'AR.tfs'), zetaBefore, 'and the original file is not touched');
    }
    {
        // With no record, the file named after the design is the original, then tree order.
        const tree = makeTree();
        tree.write('Archive', 'AR old.tfs', design('design-orig', 'AR'));
        tree.write('Zeta project', 'AR.tfs', design('design-orig', 'AR'));
        tree.write('Alpha', 'B.tfs', design('design-b', 'B'));
        tree.write('Beta', 'B.tfs', design('design-b', 'B'));
        const loaded = tree.rows(await tree.call('load-folders'));
        assert.equal(loaded.find(r => r.folder === 'Zeta project').id, 'design-orig', 'the file named after the design keeps it');
        assert.equal(loaded.find(r => r.folder === 'Alpha').id, 'design-b', 'and with both named so, the first in tree order');
        assert.notEqual(loaded.find(r => r.folder === 'Beta').id, 'design-b');
        const empty = makeTree();
        empty.write('Archive', 'AR.tfs', design('design-orig', 'AR'));
        empty.write('Zeta project', 'AR.tfs', design('design-orig', 'AR'));
        const noMap = empty.rows(await empty.call('load-folders', {}));
        assert.equal(noMap.find(r => r.folder === 'Archive').id, 'design-orig', 'an empty map gives tree order, as before');
    }
} finally {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}

console.log('design_files_rows: passed');
