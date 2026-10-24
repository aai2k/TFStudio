/**
 * The API server (src/apiServer/server.js) driven over stdio as a client
 * drives it.
 *
 *   1. The hello comes first, with the version in package.json, the WASM
 *      kernel loaded and the calls the API exports, init aside; the runs the
 *      server streams hooks for are the calls whose doc comment takes hooks,
 *      as their third argument. A data folder without Materials gets a hello
 *      with init's error, and the server exits with 1.
 *   2. Every call answers what the API answers in this process, the ids a
 *      design draws and the time a synthesis step took aside:
 *      a design built, edited, cleaned, saved (the same file) and opened
 *      again, and cleaning one with no layers refused with its code and
 *      fields; a side scaled, rounded, perturbed with its seed and copied,
 *      a flip of a closed side refused with its code and fields, and two
 *      designs compared; an edge filter searched, with a pass region that
 *      does not end crossing as Infinity, and put in; a deposition run on the
 *      part and on witness chips, and its files written; the spectrum at two angles, summarized from what came over
 *      the wire; a band's width and an edge against angle; a spectrum file
 *      read and a design compared with a curve of it, and a file of several
 *      curves compared without naming one refused, naming them;
 *      an index profile, layer thicknesses and the design's facts,
 *      a layer set by its QWOT, a side with no layers refused with its code
 *      and fields, and a QWOT the Design Editor has none of crossing as null;
 *      a side's admittance locus and electric field, and a side with no layer
 *      thicker than 0 nm refused with its code and fields; a colour and an
 *      integral table, an integral with no value crossing as NaN, and an
 *      observer refused with its code and fields; a side's Psi and Delta
 *      against wavelength and against angle, and an angular sweep past
 *      89.5 degrees refused with its code and fields; a side's group delay,
 *      the whole part's in transmission on the window's grid, and the whole
 *      part in reflection refused with its code and fields;
 *      materials, a material's dispersion with masked wavelengths crossing
 *      as NaN, and a slab of 0 mm refused with its code and fields; merit; a specification set and checked, and
 *      checking a design without one refused with its code and fields; layer
 *      sensitivity; and the runs, a refinement, a Needle and a Structural run
 *      with a seed, a seeded Monte Carlo and a seeded yield.
 *   3. The wire: a summary of NaN values crosses as the bare tokens NaN,
 *      Infinity and -Infinity; a typed array is written as a list; a NaN
 *      sent in gets the API's refusal, with the code and fields a client's
 *      objects word it from. A line that is not JSON, a request
 *      without a usable id, an unknown call (init and names every object has
 *      among them), args that are not a list (null among them, on a run too),
 *      hooks on a call that is not a run, a run given a third argument with
 *      or without hooks, and a hook the run does not take are each refused,
 *      the last in the API's own words, and the server answers on. Any other
 *      error of the API's carries no code, a file system error's own included.
 *   4. Runs: only the hooks named are streamed, the same number of times as
 *      in this process, with the same arguments; onProgress comes at most
 *      about four times a second, its reports merged on the wire still hold
 *      every value the run reported, no other hook overtakes a report held
 *      back, and its last report comes before the answer; a yield run streams
 *      its trials and stops when asked; a stop ends a run
 *      stopped with the design as it was given, a run asked for stopped ends
 *      so at once, stopped is refused on a call that is not a run and as
 *      anything but true, and a stop of another id, sent while a run goes,
 *      is passed over; a second run is refused while
 *      a spectrum is answered during the first; closing stdin mid-run ends
 *      the server with 0 within 10 s.
 *   5. stdout carries only messages, though the server's own code prints.
 *
 * The app.* calls are in api_server_live.mjs.
 *
 * Run: node tests/api_server.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApiClient, onlyMessages } from './_apiClient.mjs';
import { encode } from '../src/apiServer/wire.js';
import { RUNS } from '../src/apiServer/calls.js';
import { apiCalls } from '../tools/api-reference/docComments.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SERVER = path.join(ROOT, 'src', 'apiServer', 'server.js');
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-api-server-'));

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ended = client => Promise.race([client.exited, sleep(10000).then(() => 'still running')]);
// The engine prints as it runs; the runs made here keep it off the test's output.
const quietly = async run => {
    const log = console.log, warn = console.warn;
    console.log = () => {}; console.warn = () => {};
    try { return await run(); } finally { console.log = log; console.warn = warn; }
};
// A value as the wire writes it, without what differs from one computation
// of it to the next: the ids a design draws at random, and the time a
// synthesis step took (tMs).
const DRAWN = new Set(['id', 'tMs']);
const undrawn = v => {
    if (Array.isArray(v)) return v.map(undrawn);
    if (!v || typeof v !== 'object' || ArrayBuffer.isView(v)) return v;
    return Object.fromEntries(Object.entries(v).filter(([key]) => !DRAWN.has(key)).map(([key, x]) => [key, undrawn(x)]));
};
const canon = v => encode(undrawn(v));

const api = await import('../src/api/index.js');
await api.init();
// What the API answers in this process, as the server answers: { result } or
// { error }, a refusal's code and fields with it.
async function local(call, args) {
    try {
        return { result: (await quietly(() => api[call](...args))) ?? null };
    } catch (err) {
        return { error: { message: err.message, ...(err.fields ? { code: err.code, fields: err.fields } : {}) } };
    }
}

// A server whose own code prints to the console after it starts, as library
// code may: the line must reach stderr, never the messages.
const PRINTS = path.join(TEMP, 'prints.cjs');
fs.writeFileSync(PRINTS, "setTimeout(() => { console.log('printed by the server'); console.info('printed again'); }, 300);\n");
const server = startApiClient(process.execPath, ['--no-warnings', '--require', PRINTS, SERVER]);

const AR_ROWS = [{ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 }];
const POOL = ['TiO2', 'SiO2'];
const twoLayers = api.insertLayer(api.insertLayer(api.newDesign({ name: 'AR' }), { material: 'TiO2', thickness: 30 }), { material: 'SiO2', thickness: 50 });
const start = api.setMerit(twoLayers, AR_ROWS);
const stack = api.stackFromFormula(api.newDesign({ name: 'Stack' }), { formula: '(HL)^3 H' });
const NEEDLE = { method: 'needle', pool: POOL, settings: { maxLayers: 6, refineIter: 10, threads: 1 } };
const STRUCTURAL = { method: 'structural', pool: POOL, settings: { maxIter: 3, refineIter: 5, threads: 1, seed: 7 } };
const CHECKS = [{ kind: 'R_AVG', lambdaStart: 450, lambdaEnd: 650, cmp: 'le', target: 0.02 }, { kind: 'LAYER_COUNT', cmp: 'le', target: 2 }];
const specified = api.setSpecification(start, CHECKS);

// ── 1. The hello ───────────────────────────────────────────────────────────
{
    const hello = await server.hello;
    const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    ok('the hello is the first line', JSON.parse(server.lines[0] ?? '{}').hello === 'tfstudio-api', server.lines[0]);
    ok('it names the protocol and the version, with the kernel loaded and no data folder',
        JSON.stringify([hello.protocol, hello.version, hello.wasm, hello.dataDir, hello.unreadable, hello.live]) === JSON.stringify([1, version, true, null, [], false]),
        JSON.stringify(hello));
    const exported = Object.keys(api).filter(name => name !== 'init').sort();
    ok('the calls are the API\'s exports but init', JSON.stringify([...hello.calls].sort()) === JSON.stringify(exported), hello.calls.join(','));
    const documented = apiCalls(path.join(ROOT, 'src', 'api')).filter(call => call.params.some(p => p.name === 'hooks'));
    ok('the runs are the calls whose doc comment takes hooks', JSON.stringify([...RUNS].sort()) === JSON.stringify(documented.map(c => c.name).sort()));
    ok('each as its third argument', documented.every(call => call.params.filter(p => !p.name.includes('.')).findIndex(p => p.name === 'hooks') === 2));

    const empty = path.join(TEMP, 'no-materials');
    fs.mkdirSync(empty);
    const failed = startApiClient(process.execPath, ['--no-warnings', SERVER, '--data', empty]);
    const refused = await failed.hello;
    ok('a data folder without Materials gets a hello with init\'s error', refused.hello === 'tfstudio-api' && /holds no Materials folder/.test(refused.error?.message ?? ''), JSON.stringify(refused));
    ok('and the server exits with 1', await ended(failed) === 1);
}

// ── 2. The calls answer as the API does ────────────────────────────────────
{
    const differ = [];
    const same = async (call, args) => {
        const there = await server.call(call, args);
        const here = await local(call, args);
        const [a, b] = [canon({ result: there.result, error: there.error }), canon(here)];
        if (a !== b) differ.push(`${call}: ${a.slice(0, 160)} / ${b.slice(0, 160)}`);
        return there;
    };
    await same('newDesign', [{ name: 'AR', substrate: 'SiO2', referenceWavelength: 600 }]);
    await same('setDesignSetup', [stack, { referenceWavelength: 600, surfaceMode: 'symmetric' }]);
    await same('insertLayer', [stack, { material: 'Ta2O5', thickness: 80, index: 2 }]);
    await same('deleteLayer', [stack, { index: 0 }]);
    await same('setLayer', [stack, { index: 1, thickness: 99, locked: true }]);
    await same('stackFromFormula', [twoLayers, { formula: '(HL)^2', symbols: { H: 'Ta2O5' } }]);
    const cleaned = await same('cleanDesign', [api.insertLayer(stack, { material: 'Ta2O5', thickness: 3, index: 2 }), { minThickness: 4 }]);
    ok('a design is cleaned over the wire', cleaned.result?.removed === 1 && cleaned.result.operations.length === 1, JSON.stringify(cleaned.result?.operations));
    const bare = await same('cleanDesign', [api.newDesign()]);
    ok('cleaning a design with no layers is refused with its code and fields', bare.error?.code === 'noLayers'
        && canon(bare.error.fields) === canon({ call: 'cleanDesign' }), JSON.stringify(bare.error));
    await same('scaleThicknesses', [stack, { factor: 0.97 }]);
    await same('quantize', [stack, { mode: 'step', value: 0.5 }]);
    const kicked = await same('perturb', [stack, { percent: 5, seed: 8 }]);
    const closed = await same('flipLayers', [stack, { side: 'back' }]);
    ok('a perturbed design crosses with its seed, and a closed side is refused with its code and fields', kicked.result?.seed === 8
        && closed.error?.code === 'closedSide' && canon(closed.error.fields) === canon({ call: 'flipLayers', side: 'back', surfaceMode: 'front_only' }), JSON.stringify(closed.error));
    await same('copySide', [api.setDesignSetup(stack, { surfaceMode: 'both_independent' }), { from: 'front' }]);
    await same('designDifferences', [stack, kicked.result?.design]);
    await same('edgeFilter', [stack, { angle: 45, edge: 650 }]);
    const edge = await same('edgeFilter', [stack, { pass: 'long', edge: 650 }]);
    await same('applyEdgeFilter', [stack, { angle: 45, edge: 650, solution: 1, mode: 'append', periods: 3 }]);
    ok('an edge filter search crosses with a pass region that does not end as Infinity', edge.result?.solutions.length === 2
        && edge.result.solutions.every(s => s.passWidth === Infinity), JSON.stringify(edge.result?.solutions?.map(s => s.passWidth)));
    await same('processSteps', [stack, { otherSide: 'coated', step: 5, chips: null }]);
    await same('processSteps', [stack, { chips: { layersPerChip: 2, witnessRatio: 1.2 }, step: 10 }]);
    const processFolder = path.join(TEMP, 'process');
    fs.mkdirSync(processFolder);
    const exported = await same('exportProcess', [stack, processFolder, { format: 'csv', files: 'table', step: 5 }]);
    ok('process files are written over the wire, and the paths come back', exported.result?.length === 1 && fs.existsSync(exported.result[0]), JSON.stringify(exported));
    await same('findMaterials', ['SiO2']);
    await same('findMaterials', []);
    await same('materialNK', ['TiO2', [400, 550, 700]]);
    await same('materialDispersion', ['TiO2', { from: 300, to: 900, thickness: 2 }]);
    const thick = await same('materialDispersion', ['Si', { from: 400, to: 1100 }]);
    ok('a material\'s dispersion crosses with its masked wavelengths as NaN', thick.result?.masked.length > 0 && Number.isNaN(thick.result.gd[0]), JSON.stringify(thick.result?.masked?.[0]));
    const slab = await same('materialDispersion', ['BK7', { thickness: 0 }]);
    ok('a slab thickness of 0 is refused with its code and fields', slab.error?.code === 'badValue'
        && canon(slab.error.fields) === canon({ call: 'materialDispersion', option: 'thickness', takes: 'a thickness in mm from 1e-9 to 100000', value: 0 }), JSON.stringify(slab.error));
    const spectrum = await same('spectrum', [stack, { from: 400, to: 700, step: 10, angles: [0, 45] }]);
    ok('a spectrum\'s angles are keyed by their values', Object.keys(spectrum.result?.angles ?? {}).join() === '0,45');
    await same('summarize', [spectrum.result, { bands: [{ from: 450, to: 650 }] }]);
    await same('bandFeature', [stack, { feature: 'fwhm', from: 400, to: 700, quantity: 'R', angle: 30, level: 0.3 }]);
    await same('edgeShift', [stack, { from: 400, to: 700, angles: [0, 30], quantity: 'R' }]);
    const scan = path.join(TEMP, 'scan.csv');
    fs.writeFileSync(scan, '# AOI 8 deg\nWavelength (nm),R,Ts\n450,0.1,0.85\n500,0.06,0.9\n550,0.04,0.93\n600,0.05,0.91\n650,0.08,0.88\n');
    await same('readSpectrumFile', [scan, { pol: 'p' }]);
    await same('measuredDifference', [stack, scan, { curve: 1, grid: 'uniform', step: 5, levelFree: true }]);
    const several = await same('measuredDifference', [stack, scan]);
    ok('a file of several curves compared without curve is refused, naming them', /holds 2 curves \(scan: R, scan: Ts\); curve names/.test(several.error?.message), JSON.stringify(several.error));
    const twoSided = api.insertLayer(api.setDesignSetup(stack, { surfaceMode: 'both_independent' }), { side: 'back', material: 'MgF2', thickness: 90 });
    await same('indexProfile', [twoSided, { wavelength: 633 }]);
    await same('indexProfile', [stack, { side: 'front' }]);
    await same('layerThicknesses', [twoSided]);
    await same('designFacts', [twoSided, { side: 'front' }]);
    await same('setLayer', [stack, { index: 2, qwot: 1.5 }]);
    const noBack = await same('layerThicknesses', [stack, { side: 'back' }]);
    ok('a side with no layers is refused with its code and fields', noBack.error?.code === 'emptySide'
        && canon(noBack.error.fields) === canon({ call: 'layerThicknesses', side: 'back' }), JSON.stringify(noBack.error));
    const lost = { ...stack, frontLayers: stack.frontLayers.map((layer, i) => (i === 0 ? { ...layer, material: 'NoSuchFilm' } : layer)) };
    const facts = await same('designFacts', [lost]);
    ok('a layer with no quarter wave crosses with its QWOT null, and so does the optical thickness', facts.result?.qwot.front.at(-1) === null
        && facts.result.opticalThickness === null && facts.result.qwot.front.slice(0, -1).every(q => q > 0), JSON.stringify(facts.result?.qwot));
    await same('admittance', [twoSided, { wavelength: 633, angle: 45 }]);
    await same('admittance', [twoSided, { side: 'back', plane: 'reflection' }]);
    await same('electricField', [twoSided, { wavelength: 1064, depthUnit: 'QWOT' }]);
    await same('electricField', [twoSided, { side: 'back', angle: 30, pointsPerLayer: 8 }]);
    const flat = await same('electricField', [{ ...stack, frontLayers: stack.frontLayers.map(layer => ({ ...layer, thickness: 0 })) }]);
    ok('a side with no layer thicker than 0 nm is refused with its code and fields', flat.error?.code === 'emptySide'
        && canon(flat.error.fields) === canon({ call: 'electricField', side: 'front' }), JSON.stringify(flat.error));
    await same('color', [twoSided]);
    await same('color', [twoSided, { quantity: 'T', observer: 10, illuminant: 'A', side: 'back', step: 2 }]);
    // A narrow grid leaves the solar, UV and NIR rows without a value: NaN crosses as NaN.
    const table = await same('integrals', [twoSided, { start: 350, end: 1000, step: 2, custom: [{ key: 'bb', source: { id: 'blackbody', T: 3000 } }] }]);
    ok('an integral with no value crosses as NaN', Number.isNaN(table.result?.rows.find(r => r.key === 'Tsol').value) && table.result.rows.find(r => r.key === 'bb').covered,
        JSON.stringify(table.result?.rows[3]));
    const observer = await same('color', [twoSided, { observer: 3 }]);
    ok('an observer it does not have is refused with its code and fields', observer.error?.code === 'badValue'
        && canon(observer.error.fields) === canon({ call: 'color', option: 'observer', takes: '2 or 10', value: 3 }), JSON.stringify(observer.error));
    await same('ellipsometry', [twoSided, { step: 5, angles: [55, 70], side: 'back', deltaConvention: 'reversed' }]);
    await same('ellipsometryVsAngle', [twoSided, { wavelength: 633, angleStart: 30, angleEnd: 75, angleStep: 1.5 }]);
    const clamped = await same('ellipsometryVsAngle', [twoSided, { angleEnd: 90 }]);
    ok('an angular sweep past 89.5 degrees is refused with its code and fields', clamped.error?.code === 'angleRange'
        && canon(clamped.error.fields) === canon({ call: 'ellipsometryVsAngle', start: 45, end: 90, max: 89.5 }), JSON.stringify(clamped.error));
    await same('groupDelay', [twoSided, { from: 450, to: 650, step: 2, pol: 's', side: 'back', reference: 550 }]);
    await same('groupDelay', [twoSided, { response: 'T', side: 'total', step: 'auto', angle: 30 }]);
    const reflected = await same('groupDelay', [twoSided, { side: 'total' }]);
    ok('the whole part in reflection is refused with its code and fields', reflected.error?.code === 'badValue'
        && canon(reflected.error.fields) === canon({ call: 'groupDelay', option: 'side', takes: "'front' or 'back' with response 'R'", value: 'total' }), JSON.stringify(reflected.error));
    await same('setMerit', [stack, AR_ROWS]);
    await same('merit', [start]);
    await same('setSpecification', [start, CHECKS]);
    await same('checkSpecification', [specified]);
    const unspecified = await same('checkSpecification', [start]);
    ok('checking a design without a specification is refused with its code and fields', unspecified.error?.code === 'noSpecification'
        && canon(unspecified.error.fields) === canon({ call: 'checkSpecification' }), JSON.stringify(unspecified.error));
    await same('layerSensitivity', [start, { deltaNm: 2 }]);
    await same('runHooks', ['needle']);
    await same('runHooks', ['nothing']);
    await same('refine', [start, { method: 'dls', maxIter: 20 }]);
    await same('synthesize', [start, NEEDLE]);
    await same('synthesize', [start, STRUCTURAL]);
    await same('monteCarlo', [start, { from: 450, to: 650, step: 10, runs: 5, seed: 3 }]);
    await same('estimateYield', [specified, { runs: 5, thicknessRelPct: 3, seed: 3 }]);
    const taken = path.join(TEMP, 'taken.tfs');
    fs.writeFileSync(taken, '');
    await same('saveDesign', [start, taken]);
    ok('each call answers what the API answers in this process', differ.length === 0, differ.join('\n'));

    const there = path.join(TEMP, 'there.tfs');
    const here = path.join(TEMP, 'here.tfs');
    const saved = await server.call('saveDesign', [start, there]);
    api.saveDesign(start, here);
    ok('saveDesign answers null and writes the file the API writes', saved.result === null && fs.readFileSync(there, 'utf8') === fs.readFileSync(here, 'utf8'));
    const opened = await server.call('openDesign', [there]);
    ok('openDesign reads it back as the API does', canon(opened.result) === canon(api.openDesign(here)));
}

// ── 3. The wire ────────────────────────────────────────────────────────────
{
    const QUANTITIES = ['R', 'T', 'A', 'Rs', 'Rp', 'Ts', 'Tp', 'As', 'Ap'];
    const unread = { lambda: [500, 510], angles: { 0: Object.fromEntries(QUANTITIES.map(q => [q, [NaN, NaN]])) } };
    const summary = await server.call('summarize', [unread]);
    const line = server.lines.find(l => l.startsWith(`{"id":${server.seq},`)) ?? '';
    const R = summary.result?.[0]?.[0]?.R;
    ok('NaN goes in, and NaN, Infinity and -Infinity come back as bare tokens', /"mean":NaN/.test(line) && /"min":Infinity/.test(line) && /"max":-Infinity/.test(line), line.slice(0, 200));
    ok('which read as those numbers', Number.isNaN(R?.mean) && R?.min === Infinity && R?.max === -Infinity, JSON.stringify(R));

    ok('a typed array is written as a list', encode({ x: new Float64Array([0.5, NaN]) }) === '{"x":[0.5,NaN]}');
    const nan = await server.call('insertLayer', [start, { material: 'TiO2', thickness: NaN }]);
    ok('a NaN sent in gets the API\'s refusal', nan.error?.message === (await local('insertLayer', [start, { material: 'TiO2', thickness: NaN }])).error.message
        && /not NaN/.test(nan.error.message), nan.error?.message);
    ok('with the code and fields a client\'s objects word it from in their own names', nan.error?.code === 'badValue'
        && canon(nan.error.fields) === canon({ call: 'insertLayer', option: 'thickness', takes: 'a physical thickness in nm above 0', value: NaN }), JSON.stringify(nan.error));

    const refusedNull = async (line) => {
        const answer = server.answerTo(null);
        server.write(line);
        return (await answer).error?.message ?? '';
    };
    ok('a line that is not JSON is refused with id null', /one JSON message/.test(await refusedNull('{"id": 99, "call": ')));
    ok('so is a request without a usable id', /its id a string or a whole number/.test(await refusedNull({ id: { a: 1 }, call: 'newDesign' }))
        && /its id/.test(await refusedNull([1, 2])));
    const unknown = [];
    for (const call of ['evaporate', 'init', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) unknown.push((await server.call(call, [])).error?.message);
    ok('an unknown call is refused, init and names every object has among them', unknown.every(message => /^unknown call/.test(message ?? '')), unknown.join(' | '));
    const notList = server.answerTo(7);
    server.write({ id: 7, call: 'newDesign', args: { name: 'x' } });
    ok('args that are not a list are refused', /args is the list/.test((await notList).error?.message ?? ''));
    const nullArgs = [await server.call('refine', null), await server.call('refine', null, { hooks: ['onProgress'] }), await server.call('newDesign', null)];
    ok('so is args null, on a run with hooks or without and on any other call', nullArgs.every(answer => /args is the list/.test(answer.error?.message ?? '')),
        JSON.stringify(nullArgs.map(answer => answer.error)));
    ok('hooks on a call that is not a run are refused', /takes no hooks/.test((await server.call('spectrum', [stack, { from: 400, to: 500 }], { hooks: ['onProgress'] })).error?.message ?? ''));
    ok('hooks that are not names are refused', /hooks is a list of hook names/.test((await server.call('refine', [start], { hooks: [1] })).error?.message ?? ''));
    ok('a run given its hooks in args is refused', /go by name in hooks/.test((await server.call('refine', [start, {}, {}], { hooks: [] })).error?.message ?? ''));
    ok('and so is one given a third argument with no hooks field', /go by name in hooks/.test((await server.call('refine', [start, { method: 'dls' }, { bogus: 1 }])).error?.message ?? ''));
    const unsaved = await server.call('saveDesign', [start, path.join(TEMP, 'no-folder', 'x.tfs')]);
    ok('any other error of the API\'s carries no code, a file system error\'s own included', !!unsaved.error?.message && !('code' in unsaved.error) && !('fields' in unsaved.error),
        JSON.stringify(unsaved.error));
    const wrongHook = await server.call('refine', [start, { method: 'dls' }], { hooks: ['onGeneration'] });
    const apiSays = (await local('refine', [start, { method: 'dls' }, { onGeneration: () => {}, signal: new AbortController().signal }])).error?.message;
    ok('a hook the run does not take gets the API\'s own refusal', !!apiSays && wrongHook.error?.message === apiSays, wrongHook.error?.message);
    ok('the server answers on', !!(await server.call('runHooks', ['refine'])).result?.length);
}

// ── 4. Runs ────────────────────────────────────────────────────────────────
{
    // Each call's arguments as they stood when the hook was called.
    const generations = [];
    await quietly(() => api.synthesize(start, NEEDLE, { onGeneration: (...args) => generations.push(canon(args)) }));
    const needle = await server.call('synthesize', [start, NEEDLE], { hooks: ['onGeneration'] });
    ok('only the hooks named are streamed', needle.progress.length > 0 && needle.progress.every(p => p.hook === 'onGeneration'), needle.progress.map(p => p.hook).join());
    ok('Needle\'s generations come as they do in this process', needle.progress.map(p => canon(p.args)).join('\n') === generations.join('\n'),
        `${needle.progress.length} / ${generations.length}`);
    const rows = [];
    await quietly(() => api.synthesize(start, STRUCTURAL, { onRow: (...args) => rows.push(canon(args)) }));
    const structural = await server.call('synthesize', [start, STRUCTURAL], { hooks: ['onRow'] });
    ok('so do Structural\'s rows, with a seed', rows.length > 0 && structural.progress.map(p => canon(p.args)).join('\n') === rows.join('\n'),
        `${structural.progress.length} / ${rows.length}`);

    // onProgress reports only the values that changed, and the wire merges
    // the reports it holds back: together they still hold every value the run
    // reported, each at its last.
    const fold = patches => Object.assign({}, ...patches);
    const patches = [];
    await quietly(() => api.refine(start, { method: 'dls', maxIter: 20 }, { onProgress: patch => patches.push(structuredClone(patch)) }));
    const refined = await server.call('refine', [start, { method: 'dls', maxIter: 20 }], { hooks: ['onProgress'] });
    ok('onProgress merged on the wire holds every value the run reported', patches.length > 1 && canon(fold(refined.progress.map(p => p.args[0]))) === canon(fold(patches)),
        `${refined.progress.length} reports / ${patches.length}`);
    // What onProgress had reported by each generation, with that generation:
    // a report held back goes out before the generation after it. A worker
    // reports its live design at most every 80 ms of the clock, so how many
    // live reports a run makes, and which came last, depends on the machine's
    // load: the comparison leaves `live` out.
    const byGeneration = reports => {
        let seen = {};
        return reports.flatMap(([hook, args]) => {
            if (hook === 'onProgress') { seen = { ...seen, ...args[0] }; delete seen.live; return []; }
            return [canon([seen, args])];
        }).join('\n');
    };
    const both = [];
    await quietly(() => api.synthesize(start, NEEDLE, {
        onProgress: patch => both.push(['onProgress', [structuredClone(patch)]]),
        onGeneration: (...args) => both.push(['onGeneration', structuredClone(args)]),
    }));
    const streamed = await server.call('synthesize', [start, NEEDLE], { hooks: ['onProgress', 'onGeneration'] });
    ok('no generation overtakes the progress reported before it', streamed.progress.some(p => p.hook === 'onProgress') && streamed.progress.some(p => p.hook === 'onGeneration')
        && byGeneration(streamed.progress.map(p => [p.hook, p.args])) === byGeneration(both));

    // Monte Carlo reports after every trial, thousands of times a second; this
    // many trials take about a second.
    const TRIALS = 8000;
    const asked = Date.now();
    const mc = await server.call('monteCarlo', [start, { from: 450, to: 650, step: 1, runs: TRIALS, seed: 5 }], { hooks: ['onProgress'] });
    const took = Date.now() - asked;
    const last = mc.progress.at(-1)?.args[0];
    ok('onProgress comes at most about four times a second', mc.progress.length >= 2 && mc.progress.length <= took / 250 + 2, `${mc.progress.length} reports in ${took} ms`);
    ok('its last report comes before the answer, the run\'s last', last?.trial === TRIALS && last.total === TRIALS && mc.result?.nTrials === TRIALS, JSON.stringify(last));
    const judged = await server.call('estimateYield', [specified, { runs: 100000, seed: 5 }], { hooks: ['onProgress'], onProgress: (_, id) => server.stop(id) });
    ok('a yield run streams its trials and stops when asked, with the trials it ran', judged.progress[0]?.args[0]?.total === 100000
        && judged.result?.nTrials >= 1 && judged.result.nTrials < 100000, JSON.stringify(judged.error ?? judged.result?.nTrials));

    const LONG = { method: 'needle', pool: POOL, settings: { maxLayers: 20, refineIter: 10, threads: 1, targetMF: 0 } };
    const stopped = await server.call('synthesize', [start, LONG], { hooks: ['onProgress'], onProgress: (_, id) => server.stop(id) });
    ok('a stop ends a run stopped, with the design as it was given', stopped.result?.result?.stopReason === 'stopped'
        && encode(stopped.result.design) === encode(start), stopped.result?.result?.stopReason ?? JSON.stringify(stopped.error));

    // A one-job refinement runs to its end once it has started; asked for
    // stopped, it ends before it starts.
    const startedStopped = await server.call('refine', [start, { method: 'dls', maxIter: 20 }], { stopped: true });
    ok('a run asked for stopped ends stopped at once, with the design as it was given', startedStopped.result?.result?.stopReason === 'stopped'
        && encode(startedStopped.result.design) === encode(start), JSON.stringify(startedStopped.result?.result ?? startedStopped.error));
    const stoppedRefusals = [await server.call('spectrum', [stack, { from: 400, to: 500 }], { stopped: true }),
        await server.call('refine', [start, { method: 'dls' }], { stopped: false })];
    ok('stopped is refused on a call that is not a run, and as anything but true', stoppedRefusals.every(answer => /stopped is true on a run, or left out/.test(answer.error?.message ?? '')),
        JSON.stringify(stoppedRefusals.map(answer => answer.error)));

    const longRun = { from: 450, to: 650, step: 1, runs: 100000, seed: 5 };
    let firstDone = false;
    const first = server.call('monteCarlo', [start, longRun]).then(answer => { firstDone = true; return answer; });
    const firstId = server.seq;
    const second = await server.call('refine', [start, { method: 'dls' }]);
    ok('a second run is refused while one runs', /monteCarlo is running on this server/.test(second.error?.message ?? ''), second.error?.message);
    // The spectrum's answer shows the server has read the stop before it; a
    // stopped run answers within milliseconds, so half a second shows this
    // one was not stopped.
    server.stop(4242);
    const between = await server.call('spectrum', [stack, { from: 400, to: 700, step: 10 }]);
    ok('a spectrum is answered while it runs', !!between.result?.lambda && !firstDone);
    await sleep(500);
    ok('a stop of another id is passed over', !firstDone);
    server.stop(firstId);
    const cut = await first;
    ok('and the run stops when asked', cut.result?.nTrials >= 1 && cut.result.nTrials < longRun.runs, JSON.stringify(cut.error ?? cut.result?.nTrials));

    const closing = startApiClient(process.execPath, ['--no-warnings', SERVER]);
    await closing.hello;
    let going;
    const running = new Promise(resolve => { going = resolve; });
    closing.call('monteCarlo', [start, longRun], { hooks: ['onProgress'], onProgress: () => going() });
    await running;
    closing.child.stdin.end();
    ok('closing stdin mid-run ends the server with 0 within 10 s', await ended(closing) === 0);
}

// ── 5. stdout ──────────────────────────────────────────────────────────────
ok('every line on stdout is a message', onlyMessages(server.lines), server.lines.find(line => !line.startsWith('{')));
ok('what the server\'s code prints goes to stderr', server.stderr.includes('printed by the server') && server.stderr.includes('printed again'));
server.child.stdin.end();
ok('closing stdin ends the server', await ended(server) === 0);
fs.rmSync(TEMP, { recursive: true, force: true });

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
