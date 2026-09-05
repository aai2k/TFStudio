/**
 * The design-file picker in the main process.
 *
 * A pick can mix programs and folders. A file that cannot be read must come
 * back with its reason, not take the whole pick down; an OptiLayer design's
 * folder travels with it, read once per folder, and a folder file that
 * cannot be read is left out and logged. An Essential Macleod design carries
 * the program's material database, found through the registry or at the
 * installer's default and read once per pick, and a folder picker stands in
 * when neither exists.
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

const MACLEOD_DEFAULT = `${process.env.PUBLIC || 'C:\\Users\\Public'}\\Documents\\Thin Film Center\\Materials\\Standard`;
const texts = new Map([
    ['/tf/ar.tfd', 'VERSION*1*'],
    ['/ol/a.dsg', '{"layers": []}'],
    ['/ol/b.dsg', '{"layers": []}'],
    ['/ol/OptiLayer.olproj', '[LoadedData]\nExitMedium=Air\n'],
    ['/ol/SiO2.lm', '{"n": [1.45]}'],
    ['/ml/ar.dds', '<EssentialMacleodDesign/>'],
    ['/ml/b.dds', '<EssentialMacleodDesign/>'],
    ['/mac/M1.tfx', '<EssentialMacleodMaterial Name="Glass"/>'],
    ['/mac/M2.tfx', '<EssentialMacleodMaterial Name="MgF2"/>'],
    ['/mac/units.tfp', '"Wavelength",1E-09,"nm"'],
    [`${MACLEOD_DEFAULT}/M9.tfx`, '<EssentialMacleodMaterial Name="Default"/>'],
]);
const dirs = new Map([
    ['/ol', ['a.dsg', 'b.dsg', 'OptiLayer.olproj', 'SiO2.lm', 'Ag.lm', 'Glass.sub', 'notes.txt']],
    ['/mac', ['M1.tfx', 'M2.tfx', 'Broken.tfx', 'units.tfp', 'mtl.tfp', 'MaterialsLibrary']],
    ['/empty', ['notes.txt']],
]);
const logs = [];
const reads = [];
const registryCalls = [];
let registry = '/mac';
let picked = ['/tf/ar.tfd', '/tf/locked.tfd', '/ol/a.dsg', '/ol/b.dsg', '/ml/ar.dds', '/ml/b.dds'];
const ctx = {
    path: path.posix,
    fs: {
        readdirSync(dir) { const names = dirs.get(dir); if (!names) throw new Error(`ENOENT: ${dir}`); return names; },
        existsSync(dir) { return dirs.has(dir); },
    },
    log(message) { logs.push(message); },
    readTextAuto(fp) {
        reads.push(fp);
        if (fp === '/ol/Ag.lm') throw new Error('EISDIR: illegal operation on a directory');
        if (fp === '/ol/Glass.sub') throw new Error('EACCES: permission denied');
        if (fp === '/tf/locked.tfd') throw new Error('EACCES: permission denied');
        if (fp === '/mac/Broken.tfx') throw new Error('EACCES: permission denied');
        if (!texts.has(fp)) throw new Error(`ENOENT: ${fp}`);
        return texts.get(fp);
    },
    registryValue(key, name) { registryCalls.push(`${key}\\${name}`); return registry; },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: picked }) },
    getMainWindow: () => null,
};
const handlers = new Map();
projects.register({ handle(channel, handler) { handlers.set(channel, handler); } }, ctx);

const result = await handlers.get('import-design-files')();
ok(result.success === true && result.files.length === 6, 'the pick succeeds with every file listed');
const [ar, locked, a, b, ml, ml2] = result.files;
ok(ar.text === 'VERSION*1*' && ar.ext === 'tfd' && ar.name === 'ar' && !ar.error, 'a readable design carries its text');
ok(locked.text === null && /permission denied/.test(locked.error), 'an unreadable design carries its reason instead');
ok(a.projectText === '[LoadedData]\nExitMedium=Air\n' && a.siblings.length === 1 && a.siblings[0].name === 'SiO2' && a.siblings[0].ext === 'lm', 'an OptiLayer design carries its project file and the readable folder materials');
ok(a.siblings === b.siblings && a.projectText === b.projectText, 'two designs from one folder share the folder read once');
ok(reads.filter(p => p === '/ol/SiO2.lm').length === 1 && reads.filter(p => p === '/ol/Ag.lm').length === 1, 'each folder file is read once');
ok(logs.some(m => /Ag\.lm/.test(m) && /EISDIR/.test(m)) && logs.some(m => /Glass\.sub/.test(m)) && logs.some(m => /locked\.tfd/.test(m)), 'every failed read is logged');

// An Essential Macleod design carries the program's database.
ok(registryCalls.length === 1 && /Thin Film Center Inc\./.test(registryCalls[0]) && /MaterialsDirectory$/.test(registryCalls[0]), 'the database folder is asked of the registry once per pick');
ok(ml.databaseDir === '/mac' && ml.unitsText === '"Wavelength",1E-09,"nm"', 'a Macleod design carries the database folder and its unit file');
ok(ml.siblings.length === 2 && ml.siblings.every(f => f.ext === 'tfx') && ml.siblings.map(f => f.name).join() === 'M1,M2', 'the readable material files, and nothing else in the folder');
ok(ml.siblings === ml2.siblings, 'two Macleod designs share the database read once');
ok(reads.filter(p => p === '/mac/M1.tfx').length === 1 && logs.some(m => /Broken\.tfx/.test(m)), 'each database file is read once and a failed read is logged');
ok(!('databaseDir' in ar) && !('databaseDir' in a), 'other programs\' designs carry no database');

// Without a registry value the installer's default folder stands in, and so
// it does when the recorded folder exists but holds no material file.
registry = null;
dirs.set(MACLEOD_DEFAULT, ['M9.tfx']);
const byDefault = await handlers.get('import-design-files')();
ok(byDefault.files[4].databaseDir === MACLEOD_DEFAULT && byDefault.files[4].siblings.length === 1 && byDefault.files[4].unitsText === '', 'the default folder is used when the registry has no value, with no unit file');
registry = '/empty';
const pastEmpty = await handlers.get('import-design-files')();
ok(pastEmpty.files[4].databaseDir === MACLEOD_DEFAULT, 'a recorded folder with no material files falls through to the default');
dirs.delete(MACLEOD_DEFAULT);
const none = await handlers.get('import-design-files')();
ok(!('siblings' in none.files[4]) && !('databaseDir' in none.files[4]), 'with neither folder the design comes back without a database');
registry = '/mac';

// The folder picker reads whatever folder the user names.
picked = ['/mac'];
const pick = await handlers.get('pick-macleod-database')();
ok(pick.success && pick.database.dir === '/mac' && pick.database.siblings.length === 2 && pick.database.unitsText.length > 0, 'a picked folder is read like the recorded one');
picked = ['/empty'];
const emptyPick = await handlers.get('pick-macleod-database')();
ok(emptyPick.success === false && emptyPick.error === 'no-materials' && emptyPick.dir === '/empty', 'a folder with no material files is refused with a code and the folder');
picked = ['/tf/ar.tfd', '/tf/locked.tfd', '/ol/a.dsg', '/ol/b.dsg', '/ml/ar.dds', '/ml/b.dds'];

// A folder that cannot be listed leaves the design without folder data.
dirs.delete('/ol');
const bare = await handlers.get('import-design-files')();
ok(bare.success && bare.files[2].siblings.length === 0 && bare.files[2].projectText === '' && logs.some(m => /ENOENT: \/ol/.test(m)), 'an unlistable folder is logged and the design still comes back');

console.log(`design_import_ipc: ${passed} passed`);
