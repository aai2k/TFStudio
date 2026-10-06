/**
 * What the main process does when it writes a design file or a project folder.
 *
 *   7. save-design and rename-item answer with the file's new modification
 *      time, and a save given the time the file had when it was read refuses
 *      with 'changed-on-disk' when another program has written it since. A
 *      rename in between does not lift that.
 *   8. Deleting a project folder moves it to the Recycle Bin. Where there is
 *      no bin, only the designs are deleted and a folder still holding other
 *      files is left with them.
 *   9. A save or a rename through a linked .tfs writes the file the link
 *      points at and leaves the link a link.
 *  10. A case-only rename of a design or a folder renames it on a
 *      case-sensitive file system too, and never lands on another file.
 *  12. A folder name Windows cannot open (a trailing dot or space, a device
 *      name) and a new design file under a device name are refused.
 *  17. A save or a move into a project folder that is gone from disk writes
 *      the folder path again.
 *
 * Run: node tests/design_files_writes.mjs
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-design-writes-'));
    roots.push(root);
    const projectsDir = path.join(root, 'Projects');
    fs.mkdirSync(projectsDir, { recursive: true });
    const handlers = new Map();
    projects.register({ handle(channel, handler) { handlers.set(channel, handler); } }, {
        fs, path, log: () => {}, projectsDir,
        safeName, safeSegments, safeFilePath, readJsonSafe, writeFileAtomic, readTextAuto,
        ...extraCtx,
    });
    const call = async (channel, ...args) => handlers.get(channel)(null, ...args);
    const dir = (...parts) => path.join(projectsDir, ...parts);
    const write = (folder, file, content) => {
        fs.mkdirSync(dir(folder), { recursive: true });
        fs.writeFileSync(dir(folder, file), typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    };
    const read = (folder, file) => JSON.parse(fs.readFileSync(dir(folder, file), 'utf8'));
    const ls = folder => fs.readdirSync(dir(folder)).sort();
    return { root, projectsDir, call, dir, write, read, ls };
}

const design = (id, name, extra = {}) => ({
    id, name, substrate: { material: 'BK7', thickness: 1 },
    frontLayers: [{ id: 'l1', material: 'TiO2', thickness: 100 }], backLayers: [], ...extra,
});
const F = 'My Designs';

try {
    // ── 7. The file's time travels with every save ───────────────────────────
    {
        const tree = makeTree();
        await tree.call('create-folder', F);
        const first = await tree.call('save-design', F, design('design-d', 'D'));
        assert.equal(first.success, true);
        assert.equal(first.mtime, fs.statSync(tree.dir(F, 'D.tfs')).mtimeMs, 'a save answers with the file\'s new time');

        const second = await tree.call('save-design', F, design('design-d', 'D', { notes: 'A' }), first.mtime);
        assert.equal(second.success, true, 'a save given the time it read passes');

        // Another instance, another PC or an editor writes the file.
        tree.write(F, 'D.tfs', design('design-d', 'D', { notes: 'B: 3 hours of work' }));
        const later = new Date(second.mtime + 5000);
        fs.utimesSync(tree.dir(F, 'D.tfs'), later, later);
        const stale = await tree.call('save-design', F, design('design-d', 'D', { notes: 'A again' }), second.mtime);
        assert.equal(stale.success, false, 'a save over a file changed since is refused');
        assert.equal(stale.error, 'changed-on-disk');
        assert.equal(stale.mtime, fs.statSync(tree.dir(F, 'D.tfs')).mtimeMs, 'with the time the file has now');
        assert.equal(tree.read(F, 'D.tfs').notes, 'B: 3 hours of work', 'and the other work is kept');

        const forced = await tree.call('save-design', F, design('design-d', 'D', { notes: 'A wins' }));
        assert.equal(forced.success, true, 'a save with no time given writes, as it did');
        const renamed = await tree.call('rename-item', F, 'D', 'D final', 'design-d', forced.mtime);
        assert.equal(renamed.success, true);
        assert.equal(renamed.mtime, fs.statSync(tree.dir(F, 'D final.tfs')).mtimeMs, 'a rename answers with the time too');

        // A rename of a file another program wrote since does not hand back a
        // time the next save would pass with: that save still asks.
        tree.write(F, 'D final.tfs', design('design-d', 'D final', { notes: 'B again' }));
        const laterStill = new Date(renamed.mtime + 5000);
        fs.utimesSync(tree.dir(F, 'D final.tfs'), laterStill, laterStill);
        const renamedOver = await tree.call('rename-item', F, 'D final', 'D v2', 'design-d', renamed.mtime);
        assert.equal(renamedOver.success, true, 'the rename itself goes through');
        assert.equal(renamedOver.mtime, renamed.mtime, 'it answers with the time the renderer knew');
        const afterRename = await tree.call('save-design', F, design('design-d', 'D v2', { notes: 'stale copy' }), renamedOver.mtime);
        assert.equal(afterRename.error, 'changed-on-disk', 'so the next save is refused');
        assert.equal(tree.read(F, 'D v2.tfs').notes, 'B again', 'and the other work is kept');

        // A name the file system refuses (too long) leaves the file as it was,
        // so the next save with the row's time is not taken for a change on disk.
        const fresh = await tree.call('save-design', F, design('design-d', 'D v2', { notes: 'C' }));
        const tooLong = await tree.call('rename-item', F, 'D v2', 'x'.repeat(300), 'design-d', fresh.mtime);
        assert.equal(tooLong.success, false, 'the rename fails');
        assert.equal(tree.read(F, 'D v2.tfs').name, 'D v2', 'and the file keeps its name inside');
        const next = await tree.call('save-design', F, design('design-d', 'D v2', { notes: 'D' }), fresh.mtime);
        assert.equal(next.success, true, 'the next save goes through');
    }

    // ── 8. Deleting a project folder ─────────────────────────────────────────
    const fillFolder = (tree) => {
        tree.write('Customer', 'AR.tfs', design('design-ar', 'AR'));
        tree.write('Customer', 'Broken.tfs', '{ not json');
        tree.write('Customer', 'measured 2026-09-30.csv', '400,0.1\n');
        tree.write('Customer/old', 'notes.txt', 'keep me');
        tree.write('Customer/old', 'Deep.tfs', design('design-deep', 'Deep'));
        tree.write('Customer/empty', 'Only.tfs', design('design-only', 'Only'));
    };
    {
        const trashed = [];
        const tree = makeTree({ shell: { trashItem: async (p) => { trashed.push(p); fs.rmSync(p, { recursive: true }); } } });
        fillFolder(tree);
        const result = await tree.call('delete-folder', 'Customer');
        assert.equal(result.success, true);
        assert.deepEqual(trashed, [tree.dir('Customer')], 'the folder goes to the Recycle Bin whole');
    }
    for (const shell of [undefined, { trashItem: async () => { throw new Error('no trash here'); } }]) {
        const tree = makeTree(shell ? { shell } : {});
        fillFolder(tree);
        const result = await tree.call('delete-folder', 'Customer');
        assert.equal(result.success, true, 'without a bin the designs are still deleted');
        assert.equal(result.filesLeft, 3, 'and the files that are not designs are counted');
        assert.deepEqual(tree.ls('Customer'), ['Broken.tfs', 'measured 2026-09-30.csv', 'old']);
        assert.deepEqual(tree.ls('Customer/old'), ['notes.txt'], 'a design below is deleted, a note beside it is kept');
        assert.ok(!fs.existsSync(tree.dir('Customer/empty')), 'a folder left empty goes');
    }
    {
        const tree = makeTree();
        tree.write('Plain', 'A.tfs', design('design-a', 'A'));
        const result = await tree.call('delete-folder', 'Plain');
        assert.equal(result.success, true);
        assert.equal(result.filesLeft, 0);
        assert.ok(!fs.existsSync(tree.dir('Plain')), 'a folder holding only designs is removed');
    }

    // ── 9. A linked design ───────────────────────────────────────────────────
    // A link needs a privilege on Windows that a plain user lacks, so where
    // one cannot be made a plain file stands in for it and the link answers
    // are given by the file system calls themselves.
    {
        const tree = makeTree();
        const shared = path.join(tree.root, 'repo', 'Shared AR.tfs');
        fs.mkdirSync(path.dirname(shared), { recursive: true });
        fs.writeFileSync(shared, JSON.stringify(design('design-s', 'Shared AR', { notes: 'v1' }), null, 2));
        fs.mkdirSync(tree.dir('Linked'), { recursive: true });
        const link = tree.dir('Linked', 'Shared AR.tfs');
        let real = true;
        try { fs.symlinkSync(shared, link, 'file'); } catch (_) { real = false; }
        const restore = [];
        const readStandIn = fs.readFileSync.bind(fs, link, 'utf8');
        if (!real) {
            // Reads and stats follow a link to its target; lstat and realpath
            // report it as a link to the shared file. A renamed link is still
            // the link, under its new name.
            fs.writeFileSync(link, 'the link itself');
            const own = { lstatSync: fs.lstatSync, realpathSync: fs.realpathSync, readFileSync: fs.readFileSync, statSync: fs.statSync, renameSync: fs.renameSync };
            let linkPath = link;
            const isLink = p => typeof p === 'string' && path.resolve(p) === linkPath;
            fs.lstatSync = (p, ...rest) => (isLink(p) ? { isSymbolicLink: () => true } : own.lstatSync(p, ...rest));
            fs.realpathSync = (p, ...rest) => (isLink(p) ? shared : own.realpathSync(p, ...rest));
            fs.readFileSync = (p, ...rest) => own.readFileSync(isLink(p) ? shared : p, ...rest);
            fs.statSync = (p, ...rest) => own.statSync(isLink(p) ? shared : p, ...rest);
            fs.renameSync = (from, to) => {
                own.renameSync(from, to);
                if (isLink(from)) linkPath = path.resolve(to);
            };
            restore.push(() => Object.assign(fs, own));
        }
        try {
            const saved = await tree.call('save-design', 'Linked', design('design-s', 'Shared AR', { notes: 'v2 saved in app' }));
            assert.equal(saved.success, true, `a save through a link succeeds, got: ${saved.error}`);
            assert.equal(JSON.parse(fs.readFileSync(shared, 'utf8')).notes, 'v2 saved in app', 'the linked original gets the save');
            if (real) assert.ok(fs.lstatSync(link).isSymbolicLink(), 'and the link stays a link');
            else assert.equal(readStandIn(), 'the link itself', 'and the link is not replaced');

            const renamed = await tree.call('rename-item', 'Linked', 'Shared AR', 'Shared AR v2', 'design-s');
            assert.equal(renamed.success, true, `a linked design renames, got: ${renamed.error}`);
            assert.equal(JSON.parse(fs.readFileSync(shared, 'utf8')).name, 'Shared AR v2', 'the new name is written at the link\'s target');
            assert.deepEqual(tree.ls('Linked'), ['Shared AR v2.tfs'], 'and the link itself is renamed');
            if (real) assert.ok(fs.lstatSync(tree.dir('Linked', 'Shared AR v2.tfs')).isSymbolicLink());
        } finally {
            restore.forEach(fn => fn());
        }
    }

    // ── 10. Case-only renames ────────────────────────────────────────────────
    {
        // This file system, whatever its case rules.
        const tree = makeTree();
        await tree.call('create-folder', F);
        await tree.call('save-design', F, design('design-f', 'Filter'));
        assert.equal((await tree.call('rename-item', F, 'Filter', 'filter', 'design-f')).success, true);
        assert.deepEqual(tree.ls(F), ['filter.tfs'], 'a case-only design rename leaves one file');
        assert.equal(tree.read(F, 'filter.tfs').name, 'filter');
        assert.equal((await tree.call('rename-folder', F, 'MY DESIGNS')).success, true);
        assert.deepEqual(fs.readdirSync(tree.projectsDir), ['MY DESIGNS'], 'a case-only folder rename leaves one folder');
    }
    {
        // A case-sensitive file system, held in memory.
        const files = new Map();
        const dirs = new Set(['/P', '/P/My Designs']);
        const renames = [];
        const memFs = {
            existsSync: p => files.has(p) || dirs.has(p),
            readFileSync: p => { if (!files.has(p)) throw new Error(`ENOENT ${p}`); return files.get(p); },
            readdirSync: d => [...files.keys(), ...dirs].filter(p => path.posix.dirname(p) === d && p !== d).map(p => path.posix.basename(p)),
            statSync: p => ({ mtimeMs: files.has(p) ? 1 : 0 }),
            renameSync: (from, to) => {
                renames.push([from, to]);
                if (dirs.has(from)) { dirs.delete(from); dirs.add(to); return; }
                files.set(to, files.get(from));
                files.delete(from);
            },
            writeFileSync: (p, data) => files.set(p, data),
            unlinkSync: p => files.delete(p),
            mkdirSync: p => dirs.add(p),
        };
        const handlers = new Map();
        projects.register({ handle(channel, handler) { handlers.set(channel, handler); } }, {
            fs: memFs, path: path.posix, log: () => {}, projectsDir: '/P',
            safeName, safeSegments,
            safeFilePath: (base, ...parts) => path.posix.join(base, ...parts),
            writeFileAtomic: (p, data) => files.set(p, data),
        });
        const call = (channel, ...args) => handlers.get(channel)(null, ...args);
        files.set('/P/My Designs/Filter.tfs', JSON.stringify(design('design-f', 'Filter')));
        assert.equal((await call('rename-item', 'My Designs', 'Filter', 'filter', 'design-f')).success, true);
        assert.deepEqual([...files.keys()], ['/P/My Designs/filter.tfs'], 'the old spelling is gone on a case-sensitive file system');

        files.set('/P/My Designs/AR.tfs', JSON.stringify(design('design-a', 'AR')));
        files.set('/P/My Designs/ar.tfs', JSON.stringify(design('design-b', 'ar')));
        const clash = await call('rename-item', 'My Designs', 'AR', 'ar', 'design-a');
        assert.equal(clash.success, false, 'a case-only rename onto another design\'s file is refused');
        assert.equal(JSON.parse(files.get('/P/My Designs/ar.tfs')).id, 'design-b', 'and that design is intact');

        renames.length = 0;
        assert.equal((await call('rename-folder', 'My Designs', 'MY DESIGNS')).success, true);
        assert.deepEqual(renames, [['/P/My Designs', '/P/MY DESIGNS']], 'a case-only folder rename is one plain rename');
        dirs.add('/P/Archive');
        dirs.add('/P/archive');
        const folderClash = await call('rename-folder', 'Archive', 'archive');
        assert.equal(folderClash.success, false, 'a case-only folder rename onto another folder is refused');
    }

    // ── 12. Names Windows cannot open ────────────────────────────────────────
    {
        const tree = makeTree();
        for (const name of ['Thorlabs Inc.', 'Rev 2 ', 'CON', 'aux', 'Nul.txt', 'COM1', 'lpt9']) {
            const result = await tree.call('create-folder', name);
            assert.equal(result.success, false, `a folder named "${name}" is refused`);
            assert.equal(result.error, 'name-not-allowed');
        }
        assert.deepEqual(fs.readdirSync(tree.projectsDir), [], 'and none of them is created');
        for (const name of ['Thorlabs Inc', 'CONSOLE', 'COM10', 'Rev 2.1']) {
            assert.equal((await tree.call('create-folder', name)).success, true, `"${name}" is an ordinary name`);
        }
        const renamed = await tree.call('rename-folder', 'Thorlabs Inc', 'Thorlabs Inc.');
        assert.equal(renamed.error, 'name-not-allowed', 'a rename to such a name is refused');
        assert.equal((await tree.call('create-folder', 'Thorlabs Inc/2026.')).error, 'name-not-allowed', 'at any depth');

        // A folder an older build made under such a name still moves.
        fs.mkdirSync(tree.dir('Q3.'));
        assert.equal((await tree.call('rename-folder', 'Q3.', 'CONSOLE/Q3.')).success, true, 'an existing odd folder still moves');

        await tree.call('create-folder', F);
        const device = await tree.call('save-design', F, design('design-n', 'NUL'));
        assert.equal(device.success, false, 'a new design file under a device name is refused');
        assert.equal(device.error, 'name-not-allowed');
        assert.equal((await tree.call('save-design', F, design('design-c', 'CON.v2'))).error, 'name-not-allowed');
        assert.deepEqual(tree.ls(F), [], 'and nothing is written');
        tree.write(F, 'NUL.tfs', design('design-old', 'NUL'));
        assert.equal((await tree.call('save-design', F, design('design-old', 'NUL'))).success, true,
            'a design an older build saved under a device name still saves');
        await tree.call('save-design', F, design('design-r', 'Rev'));
        assert.equal((await tree.call('rename-item', F, 'Rev', 'aux', 'design-r')).error, 'name-not-allowed',
            'and a rename to a device name is refused');
    }

    // ── 17. A folder renamed or deleted in the file manager ──────────────────
    {
        const tree = makeTree();
        await tree.call('create-folder', 'Customer/2026');
        await tree.call('create-folder', 'Other');
        await tree.call('save-design', 'Customer/2026', design('design-e', 'Edge', { notes: 'saved' }));
        fs.renameSync(tree.dir('Customer'), tree.dir('Customer ACME'));

        const saved = await tree.call('save-design', 'Customer/2026', design('design-e', 'Edge', { notes: 'unsaved edits' }));
        assert.equal(saved.success, true, `the work is written, got: ${saved.error}`);
        assert.equal(tree.read('Customer/2026', 'Edge.tfs').notes, 'unsaved edits', 'into the folder path the tree shows');
        assert.equal(tree.read('Customer ACME/2026', 'Edge.tfs').notes, 'saved', 'and the renamed folder keeps what it had');

        await tree.call('save-design', 'Other', design('design-o', 'Other design'));
        fs.rmSync(tree.dir('Customer'), { recursive: true });
        const moved = await tree.call('move-item', 'Other', 'Customer/2026', 'Other design', 'design-o');
        assert.equal(moved.success, true, `a move into a folder gone from disk lands, got: ${moved.error}`);
        assert.equal(tree.read('Customer/2026', 'Other design.tfs').id, 'design-o');
    }
} finally {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}

console.log('design_files_writes: passed');
