import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const meritPresets = require('../src/main/ipc/meritPresets.js');
const qualifiers = require('../src/main/ipc/qualifiers.js');

let passed = 0;
function ok(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

function makeHarness() {
  const files = new Map();
  const logs = [];
  const handlers = new Map();
  const directories = new Set(['/merit', '/qualifiers']);
  const fs = {
    existsSync(file) { return directories.has(file) || files.has(file); },
    readdirSync(directory) {
      return [...files.keys()]
        .filter(file => path.posix.dirname(file) === directory)
        .map(file => path.posix.basename(file));
    },
    readFileSync(file) { return files.get(file); },
    unlinkSync(file) { files.delete(file); },
  };
  const ctx = {
    fs,
    path: path.posix,
    log(message) { logs.push(message); },
    meritFunctionsDir: '/merit',
    qualifiersDir: '/qualifiers',
    safeName(value) { return String(value).replace(/[^a-z0-9_-]/gi, '_'); },
    writeFileAtomic(file, data) { files.set(file, data); },
  };
  const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
  meritPresets.register(ipcMain, ctx);
  qualifiers.register(ipcMain, ctx);
  return { files, handlers, logs };
}

const { files, handlers, logs } = makeHarness();
ok(handlers.size === 8, 'both preset domains register four handlers');

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

console.log(`ipc_json_preset_store: ${passed} passed`);
