/**
 * The MCP server (src/mcp/server.js) driven over stdio as an MCP client drives
 * it, against the 2025-11-25 revision of the protocol.
 *
 *   1. The session: initialize and version negotiation, the tool list (the 29
 *      tools, none that reaches the open app, without --live), ping,
 *      and the errors for a line that is not JSON, an unknown method (which is
 *      how a client probing for the 2026-07-28 revision learns to fall back),
 *      method names every object has, ids that are not a string or an integer,
 *      and an unknown tool. The server answers on after each.
 *   2. Designs: a quarter-wave stack built through the tools has the spectrum,
 *      merit and specification verdict the API computes for it in this
 *      process, a refused specification leaves the design as it was, showDesign
 *      lists the checks with their ids, which setSpecification takes back as
 *      they are, and an empty one clears it, answered with the mode; a design
 *      saved and
 *      opened again has the same layers; the setup changes; a stack cleaned
 *      gives the API's operations and layer counts, keeps the cleaned design
 *      under its id and refuses a value it cannot use, and the tool gives the
 *      MNT row and the refine that do the window's Re-optimize; a two-sided
 *      stack's index profile, layer thicknesses and facts give the API's,
 *      in short and with their values, a layer is set by its QWOT, and a side
 *      with no layers is refused; misspelt
 *      arguments, inherited names, values of the wrong type and unknown ids are
 *      refused with a message, and a refused merit leaves the design as it was.
 *   3. stdout carries only messages, also when the server's own code prints;
 *      closing stdin ends the server.
 *
 * Jobs are in mcp_jobs.mjs.
 *
 * Run: node tests/mcp_server.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startClient, onlyMessages, INIT } from './_mcpClient.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'src', 'mcp', 'server.js');
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-mcp-'));

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = async client => (await client.request('ping')).result !== undefined;

// A server whose own code prints to the console after it starts, as library
// code may: the line must reach stderr, never the protocol.
const PRINTS = path.join(TEMP, 'prints.cjs');
fs.writeFileSync(PRINTS, "setTimeout(() => { console.log('printed by the server'); console.info('printed again'); }, 300);\n");
const server = startClient(process.execPath, ['--no-warnings', '--require', PRINTS, SERVER]);

// ── 1. The session ─────────────────────────────────────────────────────────
const init = await server.request('initialize', INIT);
server.write({ jsonrpc: '2.0', method: 'notifications/initialized' });
ok('initialize agrees on 2025-11-25 and offers tools', init.result?.protocolVersion === '2025-11-25'
    && init.result.serverInfo?.name === 'tfstudio' && 'tools' in init.result.capabilities && typeof init.result.instructions === 'string');
const listed = (await server.request('tools/list')).result.tools;
const names = listed.map(t => t.name);
const wellFormed = t => /^[A-Za-z0-9_.-]{1,128}$/.test(t.name) && t.description && t.title && t.inputSchema?.type === 'object';
ok('every tool has a usable name, a title, a description and an object schema', listed.length >= 20 && listed.every(wellFormed), names.join(','));
ok('no two tools share a name', new Set(names).size === names.length);
ok('without --live no tool reaches the open app', names.length === 29 && !names.some(name => /App/.test(name))
    && !listed.some(t => 'applyToApp' in t.inputSchema.properties) && !/applyToApp/.test(init.result.instructions), names.join(','));
ok('ping answers', await alive(server));
ok('a probe for the stateless revision is told the method is not there', (await server.request('server/discover', {})).error?.code === -32601);
{
    const unknownTool = (await server.request('tools/call', { name: 'evaporate', arguments: {} })).error;
    ok('an unknown tool is a protocol error that lists the tools', unknownTool?.code === -32602 && /Tools: openDesign/.test(unknownTool.message), unknownTool?.message);
    const inherited = [];
    for (const method of ['__proto__', 'hasOwnProperty', 'constructor', 'toString']) inherited.push((await server.request(method, {})).error?.code);
    ok('a method name every object has is not found', inherited.every(code => code === -32601) && await alive(server), inherited.join(','));
    server.write({ jsonrpc: '2.0', id: null, method: 'ping' });
    server.write({ jsonrpc: '2.0', id: { a: 1 }, method: 'ping' });
    server.write('{"jsonrpc": "2.0", "id": 99, "method": ');
    await sleep(300);
    const nullAnswers = server.lines.filter(line => line.includes('"id":null')).map(line => JSON.parse(line).error?.code);
    ok('an id that is not a string or an integer is an invalid request', nullAnswers.filter(code => code === -32600).length === 2, nullAnswers.join(','));
    ok('a line that is not JSON gets a parse error', nullAnswers.includes(-32700) && await alive(server));
}
for (const [asked, answered] of [['2025-06-18', '2025-06-18'], ['2025-03-26', '2025-11-25'], ['1999-01-01', '2025-11-25']]) {
    const other = startClient(process.execPath, ['--no-warnings', SERVER]);
    const version = (await other.request('initialize', { ...INIT, protocolVersion: asked })).result?.protocolVersion;
    ok(`a client asking for ${asked} is answered with ${answered}`, version === answered, version);
    other.child.stdin.end();
    await other.exited;
}

// ── 2. Designs ─────────────────────────────────────────────────────────────
const api = await import('../src/api/index.js');
const { DESIGN_CLEANER_DEFAULTS } = await import('../src/components/windows/optimization/designCleaner/sessionState.js');
const { DEFAULT_REFINE_METHOD } = await import('../src/utils/optimizers/index.js');
await api.init();
const id = (await server.call('newDesign', { name: 'QW mirror' })).designId;
const built = await server.call('stackFromFormula', { designId: id, formula: '(HL)^3 H', symbols: { H: 'Ta2O5', L: 'SiO2' }, referenceWavelength: 600 });
ok('a stack formula builds the stack', built.front?.length === 7 && built.front[0].material.endsWith('Ta2O5'), JSON.stringify(built.front?.[0]));
{
    const local = api.stackFromFormula(api.newDesign({ name: 'QW mirror' }), { formula: '(HL)^3 H', symbols: { H: 'Ta2O5', L: 'SiO2' }, referenceWavelength: 600 });
    const range = { from: 500, to: 700, step: 5, angles: [0, 30] };
    const there = await server.call('spectrum', { designId: id, ...range, bands: [{ from: 580, to: 620 }], values: true });
    const here = api.spectrum(local, range);
    ok('the spectrum is the API\'s', JSON.stringify(there.angles) === JSON.stringify(here.angles)
        && JSON.stringify(there.summary) === JSON.stringify(api.summarize(here, { bands: [{ from: 580, to: 620 }] })));
    const rows = [{ type: 'RAV', lambdaStart: 580, lambdaEnd: 620, target: 1, weight: 1 }];
    const rated = await server.call('setMerit', { designId: id, rows });
    ok('the merit is the API\'s', rated.total === api.merit(api.setMerit(local, rows)).total && rated.rows.length === 1, JSON.stringify(rated));
    const checks = [{ kind: 'R_AVG', lambdaStart: 580, lambdaEnd: 620, cmp: 'ge', target: 0.9 }, { kind: 'LAYER_COUNT', cmp: 'le', target: 5 }];
    const verdict = JSON.stringify({ designId: id, ...api.checkSpecification(api.setSpecification(local, checks)) });
    const specified = await server.call('setSpecification', { designId: id, checks });
    ok('setSpecification answers with the verdict the API gives', JSON.stringify(specified) === verdict && specified.rows.length === 2, JSON.stringify(specified));
    ok('and so does checkSpecification', JSON.stringify(await server.call('checkSpecification', { designId: id })) === verdict);
    const misspelt = await server.call('setSpecification', { designId: id, checks: [{ kind: 'T_AVG', lamStart: 400 }] });
    ok('a refused specification leaves the design as it was', /'lamStart' is not a field of a check/.test(misspelt.error ?? '')
        && JSON.stringify(await server.call('checkSpecification', { designId: id })) === verdict, misspelt.error);
    const shown = (await server.call('showDesign', { designId: id })).specification ?? [];
    ok('showDesign lists the checks the design holds, each with its id', shown.length === 2 && shown.every(check => typeof check.id === 'string')
        && JSON.stringify(shown.map(({ id: _omit, ...check }) => check)) === JSON.stringify(api.setSpecification(local, checks).qualifiers.map(({ id: _omit, ...check }) => check)),
        JSON.stringify(shown[0]));
    await server.call('setSpecification', { designId: id, checks: [...shown, { kind: 'T_AT' }] });
    const extended = (await server.call('showDesign', { designId: id })).specification ?? [];
    ok('and setSpecification takes them back as they are beside a new one', JSON.stringify(extended.slice(0, 2)) === JSON.stringify(shown) && extended[2]?.kind === 'T_AT',
        JSON.stringify(extended));
    const cleared = await server.call('setSpecification', { designId: id, checks: [] });
    ok('an empty specification clears it, answering as a verdict on no check with the mode, and checking one is then refused',
        JSON.stringify(cleared) === JSON.stringify({ designId: id, passed: false, passing: 0, total: 0, mode: specified.mode, rows: [] }) && specified.mode === 'front'
        && /no specification; set one with setSpecification/.test((await server.call('checkSpecification', { designId: id })).error ?? ''), JSON.stringify(cleared));
}
{
    const file = path.join(TEMP, 'mirror.tfs');
    const saved = await server.call('saveDesign', { designId: id, path: file });
    const opened = await server.call('openDesign', { path: file });
    ok('a design saved and opened again has the same layers', saved.saved === file && JSON.stringify(opened.front) === JSON.stringify(built.front)
        && opened.designId !== id);
    ok('a save over a file needs overwrite', /overwrite/.test((await server.call('saveDesign', { designId: id, path: file })).error));
    ok('only .tfs files are written', /\.tfs file/.test((await server.call('saveDesign', { designId: id, path: path.join(TEMP, 'x.txt') })).error));
    ok('a relative path is refused', /absolute path/.test((await server.call('saveDesign', { designId: id, path: 'mirror.tfs' })).error)
        && /absolute path/.test((await server.call('openDesign', { path: 'mirror.tfs' })).error));
}
{
    const changed = await server.call('setDesignSetup', { designId: id, substrate: 'SiO2', substrateThicknessMm: 2 });
    ok('the setup changes', changed.substrate?.material === 'SiO2' && changed.substrate.thicknessMm === 2, JSON.stringify(changed.substrate));
    const misspelt = await server.call('spectrum', { designId: id, from: 500, to: 700, stepNm: 5 });
    ok('a misspelt argument is refused, naming the arguments', /stepNm is not an argument here; the arguments are .*step/.test(misspelt.error), misspelt.error);
    const inherited = await server.call('listDesigns', { constructor: 1 });
    ok('a name every object has is not an argument', /constructor is not an argument here/.test(inherited.error), inherited.error);
    const typed = await server.call('spectrum', { designId: id, from: '500', to: 700 });
    ok('a number given as text is refused', /from is number/.test(typed.error), typed.error);
    const unknown = await server.call('merit', { designId: 'd99' });
    ok('an unknown design id is refused, naming the designs', /Unknown design 'd99'\. Designs: d1/.test(unknown.error), unknown.error);
    const material = await server.call('insertLayer', { designId: id, material: 'TiO3', thickness: 10 });
    ok('an API refusal comes back as the tool\'s error', /Unknown material 'TiO3'/.test(material.error), material.error);
    // A design whose material this server has no catalog for: setMerit takes
    // the rows, the merit cannot be computed, and the design stays as it was.
    const lab = (await server.call('openDesign', { path: path.join(HERE, 'fixtures', 'designs', 'user-catalog-no-copy', 'Lab Ta2O5 mirror.tfs') })).designId;
    const before = (await server.call('showDesign', { designId: lab })).meritRows;
    const badMerit = await server.call('setMerit', { designId: lab, rows: [{ type: 'RAV', lambdaStart: 500, lambdaEnd: 600, target: 1 }] });
    ok('a merit that cannot be computed leaves the design as it was', /resolve to nothing/.test(badMerit.error ?? '')
        && JSON.stringify((await server.call('showDesign', { designId: lab })).meritRows) === JSON.stringify(before), badMerit.error);
    const badSpecification = await server.call('setSpecification', { designId: lab, checks: [{ kind: 'T_AT' }] });
    ok('so does a specification that cannot be checked', /resolve to nothing/.test(badSpecification.error ?? '')
        && /no specification/.test((await server.call('checkSpecification', { designId: lab })).error ?? ''), badSpecification.error);
    ok('a design shows how it is scored', changed.mfEvalMode === 'side');
    const nk = await server.call('materialNK', { material: 'SiO2', wavelengths: [10, 550] });
    ok('n,k comes with the range the data cover', nk.nk?.length === 2 && nk.nk[0].outside === true && Array.isArray(nk.rangeNm), JSON.stringify(nk));
    const wide = await server.call('spectrum', { designId: id, from: 350, to: 900, step: 10 });
    ok('a spectrum names the materials whose data stop inside it', Array.isArray(wide.outOfRange), JSON.stringify(wide.outOfRange));
    const copy = await server.call('copyDesign', { designId: id });
    const listedDesigns = (await server.call('listDesigns', {})).designs;
    ok('a copy is a design of its own', copy.designId !== id && listedDesigns.length === 4);
}
{
    // A stack with a thin layer between two of one material, cleaned through the tools.
    const formula = '(HL)^2 0.03H L';
    const messy = (await server.call('newDesign', { name: 'To clean' })).designId;
    await server.call('stackFromFormula', { designId: messy, formula });
    const local = api.cleanDesign(api.stackFromFormula(api.newDesign({ name: 'To clean' }), { formula }));
    const { design: localDesign, ...report } = local;
    const refusedClean = await server.call('cleanDesign', { designId: messy, minThickness: -1 });
    const unchanged = (await server.call('showDesign', { designId: messy })).front.length === 6;
    const cleaned = await server.call('cleanDesign', { designId: messy });
    ok('cleanDesign answers with the operations and the layer counts the API gives', JSON.stringify(cleaned) === JSON.stringify({ designId: messy, ...report })
        && cleaned.removed === 1 && cleaned.merged === 1 && cleaned.layersAfter?.front === 4, JSON.stringify(cleaned));
    const shown = (await server.call('showDesign', { designId: messy })).front ?? [];
    ok('and leaves the cleaned design under its id', JSON.stringify(shown.map(l => [l.material, l.thickness])) === JSON.stringify(localDesign.frontLayers.map(l => [l.material, l.thickness])),
        JSON.stringify(shown));
    ok('a value it cannot use is refused, the design staying as it was', /minThickness is a thickness in nm of 0 or more, not -1/.test(refusedClean.error ?? '') && unchanged,
        refusedClean.error);
    const description = listed.find(t => t.name === 'cleanDesign')?.description ?? '';
    ok('its description gives the MNT row and the refine, with the window\'s method and step budget, that do the window\'s Re-optimize, and the floor refine keeps without the row',
        description.includes(`add an MNT row with target minThickness to the design's rows through setMerit and refine with method ${DEFAULT_REFINE_METHOD} and maxIter ${DESIGN_CLEANER_DEFAULTS.reoptIters}`)
        && description.includes('without that row refine keeps layers at 1 nm or more'), description);
}
{
    // A mirror coated on both sides, read through the stack tools.
    const formula = '(HL)^2 H';
    const setup = { name: 'Two sides', surfaceMode: 'both_independent' };
    const two = (await server.call('newDesign', setup)).designId;
    await server.call('stackFromFormula', { designId: two, formula });
    await server.call('insertLayer', { designId: two, side: 'back', material: 'MgF2', thickness: 95 });
    const local = api.insertLayer(api.stackFromFormula(api.newDesign(setup), { formula }), { side: 'back', material: 'MgF2', thickness: 95 });
    const { layers, ...profile } = api.indexProfile(local, { wavelength: 633 });
    const shortProfile = await server.call('indexProfile', { designId: two, wavelength: 633 });
    const fullProfile = await server.call('indexProfile', { designId: two, wavelength: 633, values: true });
    ok('indexProfile answers with the API\'s profile, its layers counted, and with them for values true', JSON.stringify(shortProfile) === JSON.stringify({ designId: two, ...profile, layerCount: layers.length })
        && JSON.stringify(fullProfile.layers) === JSON.stringify(layers) && shortProfile.mode === 'total' && layers.length === 6, JSON.stringify(shortProfile));
    const { rows, ...thicknesses } = api.layerThicknesses(local, { side: 'back' });
    const shortRows = await server.call('layerThicknesses', { designId: two, side: 'back' });
    const fullRows = await server.call('layerThicknesses', { designId: two, side: 'back', values: true });
    ok('layerThicknesses answers with the API\'s, its rows counted, and with them for values true', JSON.stringify(shortRows) === JSON.stringify({ designId: two, ...thicknesses, rowCount: rows.length })
        && JSON.stringify(fullRows.rows) === JSON.stringify(rows) && rows.length === 1, JSON.stringify(shortRows));
    const { qwot, ...facts } = api.designFacts(local);
    const shortFacts = await server.call('designFacts', { designId: two });
    const fullFacts = await server.call('designFacts', { designId: two, values: true });
    ok('designFacts answers with the API\'s facts, and each layer\'s QWOT for values true', JSON.stringify(shortFacts) === JSON.stringify({ designId: two, ...facts })
        && JSON.stringify(fullFacts.qwot) === JSON.stringify(qwot) && facts.mode === 'total', JSON.stringify(shortFacts));
    await server.call('setLayer', { designId: two, index: 0, qwot: 2 });
    const set = (await server.call('showDesign', { designId: two })).front?.[0]?.thickness;
    ok('setLayer takes a thickness as a QWOT', set === api.setLayer(local, { index: 0, qwot: 2 }).frontLayers[0].thickness, String(set));
    const bare = (await server.call('newDesign', { name: 'Bare' })).designId;
    const empty = await server.call('layerThicknesses', { designId: bare, side: 'back' });
    ok('a side with no layers is refused', /layerThicknesses: the back has no layers/.test(empty.error ?? ''), empty.error);
}

// ── 3. stdout and shutdown ─────────────────────────────────────────────────
await sleep(400);
ok('every line on stdout is a JSON-RPC message', onlyMessages(server), server.lines.find(line => !line.startsWith('{')));
ok('what the server prints goes to stderr', /\[tfstudio-mcp\] started/.test(server.stderr) && /printed by the server/.test(server.stderr)
    && /printed again/.test(server.stderr));
server.child.stdin.end();
ok('closing stdin ends the server', await Promise.race([server.exited, sleep(10000).then(() => 'still running')]) === 0);

fs.rmSync(TEMP, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
