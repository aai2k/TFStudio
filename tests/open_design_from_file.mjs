/**
 * Opening a .tfs from the file manager.
 *
 * The path arrives as a plain command-line argument at no fixed position, so
 * it has to be found by extension. A design already inside the Projects tree
 * must come back with the folder holding it, because that design is the file
 * and copying it would leave the user editing a duplicate; anything outside
 * the tree comes back with no folder, to be imported as a copy. The build
 * config has to register the extension, the Linux desktop entry has to carry
 * %f without costing the AppImage its --no-sandbox, and the document icon has
 * to hold every size Explorer asks for.
 *
 * Run: node tests/open_design_from_file.mjs
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { designFileFromArgv } = require('../src/main/openFileArg.js');
const projects = require('../src/main/ipc/projects.js');

let passed = 0;
function ok(condition, message) {
    if (!condition) throw new Error(message);
    passed++;
}

// -- The path in argv ---------------------------------------------------------
const cwd = process.cwd();
const abs = (p) => path.resolve(p);

ok(designFileFromArgv([abs('TFStudio.exe'), abs('C:/designs/ar.tfs')]) === abs('C:/designs/ar.tfs'),
    'a packaged run finds the design after the executable');
ok(designFileFromArgv([abs('electron.exe'), '.', abs('C:/designs/ar.tfs')]) === abs('C:/designs/ar.tfs'),
    'electron . finds the design one place further along');
ok(designFileFromArgv([abs('TFStudio.exe'), '--dev', abs('C:/d/ar.TFS'), '--debug']) === abs('C:/d/ar.TFS'),
    'switches on either side are skipped and the extension is matched whatever its case');
ok(designFileFromArgv([abs('TFStudio.exe'), '--log-file=old.tfs']) === null,
    'a switch value ending in .tfs is not a design');
ok(designFileFromArgv([abs('TFStudio.exe')]) === null, 'a plain launch names no design');
ok(designFileFromArgv([]) === null && designFileFromArgv(null) === null,
    'an empty or absent command line names no design');
ok(designFileFromArgv([abs('TFStudio.exe'), 'ar.tfs']) === path.join(cwd, 'ar.tfs'),
    'a relative path is resolved against the working directory');

// -- Classifying the file against the Projects tree ---------------------------
const projectsDir = '/docs/TFStudio/Projects';
const files = new Map([
    [`${projectsDir}/My Designs/ar.tfs`, '{"tfs_version":"1.1","id":"design-1","name":"AR"}'],
    [`${projectsDir}/Archive/2026/bp.tfs`, '{"tfs_version":"1.1","id":"design-2","name":"Bandpass"}'],
    [`${projectsDir}/loose.tfs`, '{"id":"design-3","name":"Loose"}'],
    ['/docs/TFStudio/Projects-old/ar.tfs', '{"id":"design-5","name":"AR"}'],
    ['/desktop/shared.tfs', '{"tfs_version":"1.0","id":"design-4","name":"Shared"}'],
    ['/desktop/notes.tfs', 'not json at all'],
    ['/desktop/list.tfs', '[1,2,3]'],
]);
const logs = [];
const ctx = {
    path: path.posix,
    projectsDir,
    fs: {
        readFileSync(filePath) {
            if (!files.has(filePath)) throw new Error(`ENOENT: ${filePath}`);
            return files.get(filePath);
        },
    },
    log(message) { logs.push(message); },
};
const handlers = new Map();
projects.register({ handle(channel, handler) { handlers.set(channel, handler); } }, ctx);
const openPath = (filePath) => handlers.get('open-tfs-path')(null, filePath);

{
    const res = await openPath(`${projectsDir}/My Designs/ar.tfs`);
    ok(res.success && res.folderId === 'My Designs' && res.design.id === 'design-1',
        'a design in a project folder reports that folder');
    ok(!('tfs_version' in res.design), 'the on-disk version wrapper key is dropped');
}
{
    const res = await openPath(`${projectsDir}/Archive/2026/bp.tfs`);
    ok(res.folderId === 'Archive/2026',
        'a nested folder is named by its path under Projects, the way every folder call names it');
}
{
    const res = await openPath(`${projectsDir}/loose.tfs`);
    ok(res.success && res.folderId === null,
        'a design lying in the Projects root belongs to no folder, since the tree is built from the directories under it');
}
{
    const res = await openPath('/desktop/shared.tfs');
    ok(res.success && res.folderId === null && res.fileName === 'shared',
        'a design from outside the tree comes back with no folder and the file name to fall back on');
}
{
    // A traversal out of Projects and back in still resolves inside it; a
    // sibling directory whose name merely starts with "Projects" does not.
    const res = await openPath(`${projectsDir}/Archive/../My Designs/ar.tfs`);
    ok(res.folderId === 'My Designs', 'the path is resolved before it is measured against Projects');
    const outside = await openPath('/docs/TFStudio/Projects-old/ar.tfs');
    ok(outside.folderId === null, 'a directory whose name only starts with the Projects path is outside the tree');
}
{
    const missing = await openPath('/desktop/gone.tfs');
    ok(missing.success === false && /ENOENT/.test(missing.error),
        'a file that cannot be read comes back with its reason, for the renderer to show');
    const unparseable = await openPath('/desktop/notes.tfs');
    ok(unparseable.success === false && /Could not read design/.test(unparseable.error),
        'a file that is not JSON is refused');
    const list = await openPath('/desktop/list.tfs');
    ok(list.success === false && /not a valid TFStudio design/.test(list.error),
        'JSON that is not a design object is refused');
    const none = await openPath('');
    ok(none.success === false, 'an empty path is refused');
    ok(logs.length === 3, 'every unreadable file is logged once');
}

// -- The launch path is handed to the renderer once ---------------------------
{
    let queued = '/desktop/shared.tfs';
    const taking = { openFile: { take: () => { const f = queued; queued = null; return f; } } };
    const takeHandlers = new Map();
    projects.register({ handle(channel, handler) { takeHandlers.set(channel, handler); } }, taking);
    ok(await takeHandlers.get('open-file:take')() === '/desktop/shared.tfs',
        'the renderer collects the path the launch carried');
    ok(await takeHandlers.get('open-file:take')() === null,
        'it is handed over once, so a reload does not reopen it');
}

// -- Build configuration ------------------------------------------------------
{
    const pkg = require('../package.json');
    const association = (pkg.build.fileAssociations || []).find(a => a.ext === 'tfs');
    ok(association, 'the build registers the .tfs extension');
    // `name` becomes the Windows registry class key (the ProgID) verbatim, and a
    // ProgID takes letters, digits and periods but no spaces. What the user sees
    // in Explorer's Type column comes from `description`, not from here.
    ok(association.name === 'TFStudio.Design',
        'the ProgID is dotted and space-free');
    ok(association.description && association.description !== association.name,
        'the Type column text is carried separately from the ProgID');
    ok(association.mimeType === 'application/x-tfstudio-design',
        'the association carries a MIME type, which is what the Linux packages register');
    ok(association.icon === 'icons/tfs-file.ico',
        'the document icon is named, so a missing one fails the build instead of falling back to the app icon');
    // The deb desktop entry needs %f so the file manager passes a local path.
    // Setting it on `linux` instead would reach the AppImage too, where it
    // replaces the default --no-sandbox argument that entry depends on.
    ok(JSON.stringify(pkg.build.deb.executableArgs) === JSON.stringify(['%f']),
        'the Debian desktop entry is passed the file it was opened with');
    ok(pkg.build.linux.executableArgs === undefined,
        'the AppImage keeps its own launcher arguments');
}

// -- The document icon Explorer draws for every .tfs ---------------------------
// Explorer picks the size it wants out of the .ico and rescales a neighbour when
// that size is absent, so a single-size icon reads as blurry at every other
// size. An .ico that is merely truncated still installs, so its structure is
// checked here rather than left to the build.
{
    const icon = readFileSync(new URL('../icons/tfs-file.ico', import.meta.url));
    ok(icon.readUInt16LE(0) === 0 && icon.readUInt16LE(2) === 1,
        'the file is an icon rather than a cursor');

    const count = icon.readUInt16LE(4);
    const sizes = [];
    for (let i = 0; i < count; i++) {
        const at = 6 + i * 16;
        const width = icon.readUInt8(at) || 256;       // 256 does not fit a byte, stored as 0
        const height = icon.readUInt8(at + 1) || 256;
        const length = icon.readUInt32LE(at + 8);
        const offset = icon.readUInt32LE(at + 12);
        ok(width === height, `image ${i} is square`);
        ok(offset >= 6 + count * 16 && offset + length <= icon.length,
            `image ${i} lies inside the file`);

        const png = icon[offset] === 0x89 && icon.toString('latin1', offset + 1, offset + 4) === 'PNG';
        if (!png) {
            ok(icon.readUInt32LE(offset) === 40, `image ${i} has a BITMAPINFOHEADER`);
            ok(icon.readUInt16LE(offset + 14) === 32, `image ${i} is 32-bit, so it carries its own alpha`);
            ok(icon.readInt32LE(offset + 8) === height * 2,
                `image ${i} declares the colour rows and the mask rows`);
        }
        sizes.push(width);
    }
    ok(sizes.join() === '16,20,24,32,40,48,64,128,256',
        'every size Windows asks for is present, smallest first');
}

console.log(`open_design_from_file: ${passed} passed`);
