/**
 * The design-file picker in the main process.
 *
 * A pick can mix programs and folders. A file that cannot be read must come
 * back with its reason, not take the whole pick down; an OptiLayer design's
 * folder travels with it, read once per folder, and a folder file that
 * cannot be read is left out and logged.
 *
 * Run: node tests/design_import_ipc.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const projects = require('../src/main/ipc/projects.js');

let passed = 0;
function ok(condition, message) {
    if (!condition) throw new Error(message);
    passed++;
}

const texts = new Map([
    ['/tf/ar.tfd', 'VERSION*1*'],
    ['/ol/a.dsg', '{"layers": []}'],
    ['/ol/b.dsg', '{"layers": []}'],
    ['/ol/OptiLayer.olproj', '[LoadedData]\nExitMedium=Air\n'],
    ['/ol/SiO2.lm', '{"n": [1.45]}'],
]);
const dirs = new Map([['/ol', ['a.dsg', 'b.dsg', 'OptiLayer.olproj', 'SiO2.lm', 'Ag.lm', 'Glass.sub', 'notes.txt']]]);
const logs = [];
const reads = [];
const ctx = {
    path: path.posix,
    fs: { readdirSync(dir) { const names = dirs.get(dir); if (!names) throw new Error(`ENOENT: ${dir}`); return names; } },
    log(message) { logs.push(message); },
    readTextAuto(fp) {
        reads.push(fp);
        if (fp === '/ol/Ag.lm') throw new Error('EISDIR: illegal operation on a directory');
        if (fp === '/ol/Glass.sub') throw new Error('EACCES: permission denied');
        if (fp === '/tf/locked.tfd') throw new Error('EACCES: permission denied');
        if (!texts.has(fp)) throw new Error(`ENOENT: ${fp}`);
        return texts.get(fp);
    },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['/tf/ar.tfd', '/tf/locked.tfd', '/ol/a.dsg', '/ol/b.dsg'] }) },
    getMainWindow: () => null,
};
const handlers = new Map();
projects.register({ handle(channel, handler) { handlers.set(channel, handler); } }, ctx);

const result = await handlers.get('import-design-files')();
ok(result.success === true && result.files.length === 4, 'the pick succeeds with every file listed');
const [ar, locked, a, b] = result.files;
ok(ar.text === 'VERSION*1*' && ar.ext === 'tfd' && ar.name === 'ar' && !ar.error, 'a readable design carries its text');
ok(locked.text === null && /permission denied/.test(locked.error), 'an unreadable design carries its reason instead');
ok(a.projectText === '[LoadedData]\nExitMedium=Air\n' && a.siblings.length === 1 && a.siblings[0].name === 'SiO2' && a.siblings[0].ext === 'lm', 'an OptiLayer design carries its project file and the readable folder materials');
ok(a.siblings === b.siblings && a.projectText === b.projectText, 'two designs from one folder share the folder read once');
ok(reads.filter(p => p === '/ol/SiO2.lm').length === 1 && reads.filter(p => p === '/ol/Ag.lm').length === 1, 'each folder file is read once');
ok(logs.some(m => /Ag\.lm/.test(m) && /EISDIR/.test(m)) && logs.some(m => /Glass\.sub/.test(m)) && logs.some(m => /locked\.tfd/.test(m)), 'every failed read is logged');

// A folder that cannot be listed leaves the design without folder data.
dirs.delete('/ol');
const bare = await handlers.get('import-design-files')();
ok(bare.success && bare.files[2].siblings.length === 0 && bare.files[2].projectText === '' && logs.some(m => /ENOENT: \/ol/.test(m)), 'an unlistable folder is logged and the design still comes back');

console.log(`design_import_ipc: ${passed} passed`);
