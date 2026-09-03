import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const meritPresets = require('../src/main/ipc/meritPresets.js');
const qualifiers = require('../src/main/ipc/qualifiers.js');
const coatings = require('../src/main/ipc/coatings.js');

let passed = 0;
function ok(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

function makeHarness() {
  const files = new Map();
  const logs = [];
  const handlers = new Map();
  const directories = new Set(['/merit', '/qualifiers', '/coatings', '/elsewhere']);
  const fs = {
    existsSync(file) { return directories.has(file) || files.has(file); },
    readdirSync(directory) {
      return [...files.keys()]
        .filter(file => path.posix.dirname(file) === directory)
        .map(file => path.posix.basename(file));
    },
    readFileSync(file) { return files.get(file); },
    unlinkSync(file) { files.delete(file); },
    writeFileSync(file, data) { files.set(file, data); },
  };
  const ctx = {
    fs,
    path: path.posix,
    log(message) { logs.push(message); },
    meritFunctionsDir: '/merit',
    qualifiersDir: '/qualifiers',
    coatingsDir: '/coatings',
    safeName(value) { return String(value).replace(/[^a-z0-9_-]/gi, '_'); },
    writeFileAtomic(file, data) { files.set(file, data); },
    dialog: { async showSaveDialog(_window, options) { return { filePath: '/sent/' + path.posix.basename(options.defaultPath) }; } },
    getMainWindow() { return null; },
  };
  const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
  meritPresets.register(ipcMain, ctx);
  qualifiers.register(ipcMain, ctx);
  coatings.register(ipcMain, ctx);
  return { files, handlers, logs, ctx };
}

const { files, handlers, logs, ctx } = makeHarness();
ok(handlers.size === 13, 'the three preset domains register four handlers each, coatings one more to pack a file');

// A coating is saved and listed whole: the fields beyond name and layers are
// what make it a coating rather than a layer list.
const coating = {
  name: 'BBAR vis', type: 'ar', substrate: 'builtin:BK7', band: [420, 680],
  layers: [{ material: 'builtin:TiO2', thickness: 12.5 }], materials: { 'lab:X': { formulaNum: -1 } },
};
ok((await handlers.get('coatings:save')(null, coating)).success, 'coating saves');
ok(files.has('/coatings/BBAR_vis.tfsc'), 'coating uses the .tfsc path');
const savedCoating = JSON.parse(files.get('/coatings/BBAR_vis.tfsc'));
ok(savedCoating.ver === 1 && savedCoating.type === 'ar' && savedCoating.band[1] === 680
  && savedCoating.materials['lab:X'].formulaNum === -1, 'the whole coating record is written');
const coatingList = await handlers.get('coatings:list')();
ok(coatingList.presets.length === 1 && coatingList.presets[0].record.substrate === 'builtin:BK7',
  'listing coatings returns each whole record');
ok((await handlers.get('coatings:save')(null, { name: 'No layers' })).error === 'preset.layers required',
  'a coating without layers is refused');

// Packing writes the text it is given where the save dialog points.
const packed = await handlers.get('coatings:pack')(null, '{"name":"BBAR vis"}', 'bbar-vis.tfsc.json');
ok(packed.success && packed.filePath === '/sent/bbar-vis.tfsc.json' && files.get('/sent/bbar-vis.tfsc.json') === '{"name":"BBAR vis"}',
  'a packed coating lands at the chosen path');
ok((await handlers.get('coatings:pack')(null, '', 'x.json')).error === 'Nothing to write', 'an empty pack is refused');

const mfPreset = { name: 'BBAR VIS', description: 'Visible BBAR', operands: [{ type: 'R' }] };
ok((await handlers.get('mf:save')(null, mfPreset)).success, 'merit preset saves');
ok(files.has('/merit/BBAR_VIS.tfsm'), 'merit preset uses sanitized .tfsm path');
ok(JSON.parse(files.get('/merit/BBAR_VIS.tfsm')).ver === 1, 'saved merit preset has version');

const qualifierPreset = { name: 'Laser', qualifiers: [{ kind: 'BAND_MAX' }] };
ok((await handlers.get('qualifiers:save')(null, qualifierPreset)).success, 'qualifier preset saves');
ok(files.has('/qualifiers/Laser.tfsq'), 'qualifier preset uses .tfsq path');

files.set('/merit/fallback.tfsm', JSON.stringify({ operands: [1, 2] }));
files.set('/merit/ignored.txt', '{}');
files.set('/merit/broken.tfsm', '{');
const listed = await handlers.get('mf:list-presets')();
ok(listed.success && listed.presets.length === 2, 'list includes only valid merit presets');
ok(listed.presets.some(item => item.name === 'fallback' && item.count === 2), 'list derives fallback name and count');
ok(logs.some(message => message.startsWith('mf preset read error broken.tfsm:')), 'invalid preset is logged');

const loaded = await handlers.get('qualifiers:load')(null, 'Laser.TFSQ');
ok(loaded.success && loaded.preset.qualifiers.length === 1, 'load strips extension case-insensitively');
ok((await handlers.get('mf:load')(null, 'missing')).error === 'not found', 'missing preset reports not found');
ok((await handlers.get('mf:save')(null, { name: 'Invalid' })).error === 'preset.operands required', 'merit payload validation is preserved');
ok((await handlers.get('qualifiers:save')(null, { name: 'Invalid' })).error === 'preset.qualifiers required', 'qualifier payload validation is preserved');

ok((await handlers.get('qualifiers:delete')(null, 'Laser.tfsq')).success, 'qualifier preset deletes');
ok(!files.has('/qualifiers/Laser.tfsq'), 'delete removes the preset file');

// The directory is resolved per call, not captured when the handler was
// registered, so repointing the folder from Settings takes effect immediately.
// A captured path would keep writing to the old location and report success.
ctx.meritFunctionsDir = '/elsewhere';
ok((await handlers.get('mf:save')(null, { name: 'Moved', operands: [] })).success, 'merit preset saves after the folder changes');
ok(files.has('/elsewhere/Moved.tfsm'), 'the preset lands in the new folder');
ok(!files.has('/merit/Moved.tfsm'), 'nothing is written to the previous folder');
const afterMove = await handlers.get('mf:list-presets')();
ok(afterMove.presets.length === 1 && afterMove.presets[0].name === 'Moved', 'list reads the new folder');
ok((await handlers.get('mf:load')(null, 'Moved')).success, 'load reads the new folder');
ok((await handlers.get('mf:delete')(null, 'Moved')).success && !files.has('/elsewhere/Moved.tfsm'), 'delete acts on the new folder');

console.log(`ipc_json_preset_store: ${passed} passed`);
