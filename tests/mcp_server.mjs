/**
 * The MCP server (src/mcp/server.js) driven over stdio as an MCP client drives
 * it, against the 2025-11-25 revision of the protocol.
 *
 *   1. The session: initialize and version negotiation, the tool list (the 59
 *      tools, none that reaches the open app, without --live), ping,
 *      and the errors for a line that is not JSON, an unknown method (which is
 *      how a client probing for the 2026-07-28 revision learns to fall back),
 *      method names every object has, ids that are not a string or an integer,
 *      and an unknown tool. The server answers on after each.
 *   2. Designs: a quarter-wave stack built through the tools has the spectrum,
 *      a band's width, an edge against angle (in short with counts and
 *      extremes, in full with every angle), a spectrum file read and the
 *      design compared with a curve of it (in short with counts, spans and
 *      extremes, in full with every point), a relative file path refused, a
 *      needle profile (in short with counts and each material's steepest
 *      candidate, in full with every one) and a needle put in, an
 *      ellipsometer file read (in short and in full), its curves and a scan
 *      added to a copy, a fit added and the curves written, a file that is
 *      there refused, an edge filter search (in short with the count and the best period, in full with every one), a deposition run on chips (in short with each step's mean, min and max, in full with its values) and its files written, a relative folder refused, a copy perturbed with its seed
 *      and the differences from it (in short with counts and the largest
 *      change, in full with every layer), merit and specification verdict the API computes for it in this
 *      process, a refused specification leaves the design as it was, showDesign
 *      lists the checks with their ids, which setSpecification takes back as
 *      they are, and an empty one clears it, answered with the mode; a design
 *      saved and
 *      opened again has the same layers; the setup changes; a material's
 *      dispersion gives the API's, in short with the extremes of each curve
 *      and in full with its values, and a slab of 0 mm is refused; a stack cleaned
 *      gives the API's operations and layer counts, keeps the cleaned design
 *      under its id and refuses a value it cannot use, and the tool gives the
 *      MNT row and the refine that do the window's Re-optimize; a two-sided
 *      stack's index profile, layer thicknesses and facts give the API's,
 *      in short and with their values, a layer is set by its QWOT, and a side
 *      with no layers is refused; its admittance locus and electric field give
 *      the API's, in short with the end of each locus and the peak of each
 *      field, and in full with their values, and side total is refused; its
 *      colour and integral values give the API's, in short and with their
 *      values, a row with no value as null, and an observer or a custom
 *      source it does not have is refused; its Psi and Delta against
 *      wavelength and against angle give the API's, in short with their
 *      extremes and in full with their values, and side total and a sweep
 *      past 89.5 degrees are refused; its group delay gives the API's, in
 *      short with the extremes of each curve, past wavelengths with no value,
 *      and in full with its values, through the whole part in transmission on the window's grid, and side
 *      total in reflection and a step that is not one are refused; a pulse off
 *      its front gives the API's, in short with its curves counted and in full
 *      with them, a spectrum set from rows and from a file gives the pulse the
 *      API computes from it, and a relative path, or a path with rows, is
 *      refused; misspelt
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
// What pulseAnalysis answers without values: the curves counted, not given.
const withoutCurves = ({ time, spectrum: { band, ...spectra }, ...settled }) => ({
    ...settled, band, samples: {
        time: Object.fromEntries(Object.entries(time).map(([name, curve]) => [name, curve.t.length])),
        spectrum: Object.fromEntries(Object.entries(spectra).map(([name, curve]) => [name, curve.wavelength.length])),
    },
});

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
ok('without --live no tool reaches the open app', names.length === 59 && !names.some(name => /App/.test(name))
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
const { measuredDocument } = await import('../src/components/windows/dataExchange/measuredEllipsometry/model.js');
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
    const width = { feature: 'fwhm', from: 450, to: 750, quantity: 'R', angle: 30, level: 0.5 };
    ok('bandFeature is the API\'s', JSON.stringify(await server.call('bandFeature', { designId: id, ...width })) === JSON.stringify({ designId: id, ...api.bandFeature(local, width) }));
    const moved = api.edgeShift(local, { from: 450, to: 750, angles: [0, 15, 30], quantity: 'R' });
    const shortMoved = await server.call('edgeShift', { designId: id, from: 450, to: 750, angles: [0, 15, 30], quantity: 'R' });
    const fullMoved = await server.call('edgeShift', { designId: id, from: 450, to: 750, angles: [0, 15, 30], quantity: 'R', values: true });
    ok('edgeShift answers with counts and the extremes of the edge and shift, and every angle\'s values for values true',
        JSON.stringify([shortMoved.angleCount, shortMoved.notCrossedCount, shortMoved.edge?.max, shortMoved.edge?.maxAt, shortMoved.shift?.min, shortMoved.shift?.minAt, shortMoved.angles, fullMoved.edge, fullMoved.reason])
        === JSON.stringify([3, 0, moved.edge[0], 0, moved.shift[2], 30, undefined, moved.edge, moved.reason]) && moved.shift[2] < 0, JSON.stringify(shortMoved));
    const scan = path.join(TEMP, 'scan.csv');
    fs.writeFileSync(scan, '# AOI 8 deg\nWavelength (nm),R,Ts\n500,0.9,0.05\n550,0.96,0.02\n600,0.93,0.04\n650,0.7,0.25\n');
    const read = api.readSpectrumFile(scan);
    const shortRead = await server.call('readSpectrumFile', { path: scan });
    const fullRead = await server.call('readSpectrumFile', { path: scan, values: true });
    ok('readSpectrumFile answers with each curve\'s conditions, points and span, and its values for values true',
        JSON.stringify(shortRead.curves) === JSON.stringify(read.curves.map(({ wavelength, values: _v, ...c }) => ({ ...c, points: 4, from: 500, to: 650 })))
        && JSON.stringify(fullRead) === JSON.stringify(read) && shortRead.curves[1].pol === 's', JSON.stringify(shortRead));
    const compared = api.measuredDifference(local, scan, { curve: 0, levelFree: true });
    const shortCompared = await server.call('measuredDifference', { designId: id, path: scan, curve: 0, levelFree: true });
    const fullCompared = await server.call('measuredDifference', { designId: id, path: scan, curve: 0, levelFree: true, values: true });
    ok('measuredDifference answers with the RMS, the PPEF, the count and the extremes of the deviation, and every point for values true',
        JSON.stringify([shortCompared.rms, shortCompared.ppef, shortCompared.points, shortCompared.deviation?.max, shortCompared.wavelength, fullCompared.deviation, fullCompared.design])
        === JSON.stringify([compared.rms, compared.ppef, 4, Math.max(...compared.deviation), undefined, compared.deviation, compared.design]), JSON.stringify(shortCompared));
    ok('a relative spectrum path is refused', /absolute path/.test((await server.call('readSpectrumFile', { path: 'scan.csv' })).error));
    const witness = path.join(TEMP, 'witness.csv');
    fs.writeFileSync(witness, '# AOI 70 deg, front side\nWavelength (nm),Psi (deg),Delta (deg)\n500,30.1,120.5\n550,28.4,110.2\n600,27.9,100.8\n650,27.1,95.3\n');
    const witnessRead = api.readEllipsometryFile(witness);
    const shortWitness = await server.call('readEllipsometryFile', { path: witness });
    const fullWitness = await server.call('readEllipsometryFile', { path: witness, values: true });
    ok('readEllipsometryFile answers with each curve\'s conditions, points and span, and its values for values true',
        JSON.stringify(shortWitness.curves) === JSON.stringify(witnessRead.curves.map(({ wavelength, values: _v, ...c }) => ({ ...c, points: 4, from: 500, to: 650 })))
        && JSON.stringify(fullWitness) === JSON.stringify(witnessRead), JSON.stringify(shortWitness));
    const fitId = (await server.call('copyDesign', { designId: id })).designId;
    const addedScan = await server.call('addMeasuredCurves', { designId: fitId, path: scan, curves: ['scan: R'] });
    const addedWitness = await server.call('addMeasuredCurves', { designId: fitId, path: witness, ellipsometry: true, deltaConvention: 'reversed' });
    ok('addMeasuredCurves adds a file\'s curves and names the curves the design holds', JSON.stringify([addedScan.added, addedWitness.measuredCurves, addedWitness.ellipsometryCurves])
        === JSON.stringify([['scan: R'], ['scan: R'], witnessRead.curves.map(c => c.name)]), JSON.stringify(addedWitness));
    const fitted = await server.call('fitMeasured', { designId: fitId, curve: 'scan: R', grid: 'uniform', step: 25, constraints: { min: 20 } });
    ok('fitMeasured adds the block and its MNT and MXT rows, and answers with the block\'s points and span',
        fitted.meritRowCount === addedWitness.meritRowCount + 3 && JSON.stringify([fitted.points, fitted.from, fitted.to]) === JSON.stringify([7, 500, 650]), JSON.stringify(fitted));
    const heldHere = api.addMeasuredCurves(local, api.readEllipsometryFile(witness, { deltaConvention: 'reversed' }).curves);
    const curvesFile = path.join(TEMP, 'witness out.csv');
    const wroteCurves = await server.call('exportMeasuredCurves', { designId: fitId, path: curvesFile, curves: witnessRead.curves.map(c => c.name) });
    ok('exportMeasuredCurves writes the curves as the Export tab writes them', wroteCurves.curves === 2
        && fs.readFileSync(curvesFile, 'utf8') === measuredDocument(heldHere, { curves: heldHere.measuredEllipsometry }).text, JSON.stringify(wroteCurves));
    ok('and refuses a file that is there', /exists; pass \{ overwrite: true \}/.test((await server.call('exportMeasuredCurves', { designId: fitId, path: curvesFile })).error));
    const found = api.edgeFilter(local, { angle: 45 });
    const shortEdge = await server.call('edgeFilter', { designId: id, angle: 45 });
    const fullEdge = await server.call('edgeFilter', { designId: id, angle: 45, values: true });
    const { solutions, ...search } = found;
    const asJson = value => JSON.parse(JSON.stringify(value));
    ok('edgeFilter answers with the count and the best period, and every period for values true',
        JSON.stringify(shortEdge) === JSON.stringify(asJson({ designId: id, ...search, count: solutions.length, best: solutions[0] }))
        && JSON.stringify(fullEdge.solutions) === JSON.stringify(asJson(solutions)) && solutions.length > 2, JSON.stringify(shortEdge).slice(0, 300));
    const run = api.processSteps(local, { otherSide: 'coated', step: 10, chips: { layersPerChip: 3 } });
    const shortRun = await server.call('processSteps', { designId: id, otherSide: 'coated', step: 10, chips: { layersPerChip: 3 } });
    const fullRun = await server.call('processSteps', { designId: id, otherSide: 'coated', step: 10, chips: { layersPerChip: 3 }, values: true });
    const last = run.steps.at(-1);
    const shortLast = shortRun.steps?.at(-1) ?? {};
    const summarized = [shortRun.steps?.length === 7, shortLast.max === Math.max(...last.values), shortLast.chip === 3, shortRun.pointCount === run.wavelength.length].every(Boolean);
    ok('processSteps answers with each step\'s mean, min and max, and every value for values true',
        summarized && !('values' in shortLast) && JSON.stringify(fullRun.steps) === JSON.stringify(run.steps), JSON.stringify(shortLast));
    const processFolder = path.join(TEMP, 'process');
    fs.mkdirSync(processFolder);
    const written = await server.call('exportProcess', { designId: id, folder: processFolder, step: 10 });
    ok('exportProcess writes the files and answers with their paths, and a relative folder is refused', written.paths?.length === 7
        && written.paths.every(file => fs.existsSync(file)) && /absolute path/.test((await server.call('exportProcess', { designId: id, folder: 'process' })).error), JSON.stringify(written));
    const copyId = (await server.call('copyDesign', { designId: id })).designId;
    const kicked = await server.call('perturb', { designId: copyId, percent: 4, seed: 12 });
    const kickedHere = api.perturb(local, { percent: 4, seed: 12 }).design;
    ok('perturb changes the design as the API does and answers with its seed', kicked.seed === 12
        && JSON.stringify(kicked.front.map(l => l.thickness)) === JSON.stringify(kickedHere.frontLayers.map(l => l.thickness)), JSON.stringify(kicked.front?.[0]));
    const differs = api.designDifferences(local, kickedHere);
    const shortDiff = await server.call('designDifferences', { designId: id, otherId: copyId });
    const fullDiff = await server.call('designDifferences', { designId: id, otherId: copyId, values: true });
    const largest = differs.layers.reduce((a, b) => (Math.abs(a.change) >= Math.abs(b.change) ? a : b));
    ok('designDifferences answers with counts and the largest change, and every layer for values true',
        JSON.stringify([shortDiff.same, shortDiff.layersDiffering, shortDiff.largestChange, shortDiff.layers, fullDiff.layers])
        === JSON.stringify([false, { front: 7, back: 0 }, { side: largest.side, number: largest.number, change: largest.change }, undefined, differs.layers]), JSON.stringify(shortDiff));
    const rows = [{ type: 'RAV', lambdaStart: 580, lambdaEnd: 620, target: 1, weight: 1 }];
    const rated = await server.call('setMerit', { designId: id, rows });
    ok('the merit is the API\'s', rated.total === api.merit(api.setMerit(local, rows)).total && rated.rows.length === 1, JSON.stringify(rated));
    const scored = api.setMerit(local, rows);
    const needleArgs = { pool: ['TiO2', 'SiO2'], intraSamples: 4 };
    const profile = api.needleProfile(scored, needleArgs);
    const shortNeedle = await server.call('needleProfile', { designId: id, ...needleArgs });
    const fullNeedle = await server.call('needleProfile', { designId: id, ...needleArgs, values: true });
    const steepTiO2 = profile.candidates.filter(c => c.material === 'TiO2').reduce((a, b) => (b.gradient < a.gradient ? b : a));
    const needleSummary = [
        shortNeedle.count === profile.candidates.length, shortNeedle.improving === profile.candidates.filter(c => c.gradient < 0).length,
        shortNeedle.steepest?.length === 2, JSON.stringify(shortNeedle.steepest?.find(c => c.material === 'TiO2')) === JSON.stringify(steepTiO2),
        !('candidates' in shortNeedle), JSON.stringify(fullNeedle.candidates) === JSON.stringify(profile.candidates),
    ];
    ok('needleProfile answers with the counts and each material\'s steepest candidate, and every candidate for values true',
        needleSummary.every(Boolean), JSON.stringify(shortNeedle).slice(0, 300));
    const needleId = (await server.call('copyDesign', { designId: id })).designId;
    const needled = await server.call('insertNeedle', { designId: needleId, candidate: steepTiO2 });
    ok('insertNeedle puts the candidate in at the window\'s starting thickness', JSON.stringify(needled.front?.map(l => l.thickness))
        === JSON.stringify(api.insertNeedle(scored, steepTiO2).frontLayers.map(l => l.thickness)), JSON.stringify(needled.front));
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
    const dispersion = api.materialDispersion('Si', { from: 400, to: 1100, thickness: 0.5 });
    const shortDispersion = await server.call('materialDispersion', { material: 'Si', from: 400, to: 1100, thickness: 0.5 });
    const fullDispersion = await server.call('materialDispersion', { material: 'Si', from: 400, to: 1100, thickness: 0.5, values: true });
    const finiteGdd = dispersion.gdd.filter(Number.isFinite);
    const lowestGdd = Math.min(...finiteGdd);
    ok('materialDispersion answers with the extremes of each curve past masked wavelengths, and every value for values true',
        JSON.stringify([shortDispersion.model, shortDispersion.pointCount, shortDispersion.knotCount, shortDispersion.outsideCount, shortDispersion.maskedCount,
            shortDispersion.maskedReasons, shortDispersion.maskedThicknessLimit, shortDispersion.masked,
            shortDispersion.gdd?.min, shortDispersion.gdd?.minAt, shortDispersion.wavelength, fullDispersion.wavelength, fullDispersion.groupIndex, fullDispersion.knots, fullDispersion.masked])
        === JSON.stringify([dispersion.model, dispersion.wavelength.length, dispersion.knots.length, dispersion.outside.filter(Boolean).length, dispersion.masked.length,
            [...new Set(dispersion.masked.map(m => m.reason))], Math.min(...dispersion.masked.map(m => m.maximumThickness)), undefined,
            lowestGdd, dispersion.wavelength[dispersion.gdd.indexOf(lowestGdd)], undefined, dispersion.wavelength, dispersion.groupIndex, dispersion.knots, dispersion.masked])
        && dispersion.masked.length > 0, JSON.stringify(shortDispersion).slice(0, 300));
    const thin = await server.call('materialDispersion', { material: 'BK7', thickness: 0 });
    ok('a slab of 0 mm is refused', /thickness/.test(thin.error ?? ''), thin.error);
    const wide = await server.call('spectrum', { designId: id, from: 350, to: 900, step: 10 });
    ok('a spectrum names the materials whose data stop inside it', Array.isArray(wide.outOfRange), JSON.stringify(wide.outOfRange));
    const copy = await server.call('copyDesign', { designId: id });
    const listedDesigns = (await server.call('listDesigns', {})).designs;
    ok('a copy is a design of its own', copy.designId !== id && listedDesigns.length === 7);
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

    // The same two-sided stack after the QWOT edit, its admittance and field.
    const edited = api.setLayer(local, { index: 0, qwot: 2 });
    const loci = api.admittance(edited, { wavelength: 633, angle: 45 });
    const end = locus => {
        const { Y, gamma } = locus.boundaries.at(-1);
        return { eta0: locus.eta0, etaSubstrate: locus.etaSubstrate, Y, gamma, R: gamma.re ** 2 + gamma.im ** 2 };
    };
    const { s, p, ...lociFacts } = loci;
    // Rs of the front alone, which is what the locus ends on.
    const frontRs = api.spectrum(api.setDesignSetup(edited, { surfaceMode: 'front_only' }), { from: 633, to: 634, angles: [45] }).angles[45].Rs[0];
    const shortLoci = await server.call('admittance', { designId: two, wavelength: 633, angle: 45 });
    const fullLoci = await server.call('admittance', { designId: two, wavelength: 633, angle: 45, values: true });
    ok('admittance answers with where each locus ends, its reflectance, and every boundary and arc for values true',
        JSON.stringify(shortLoci) === JSON.stringify({ designId: two, ...lociFacts, layerCount: s.arcs.length, s: end(s), p: end(p) })
        && JSON.stringify([fullLoci.s, fullLoci.p]) === JSON.stringify([s, p]) && shortLoci.mode === 'front' && Math.abs(shortLoci.s.R - frontRs) < 1e-12,
        JSON.stringify(shortLoci).slice(0, 300));
    const field = api.electricField(edited, { wavelength: 1064, side: 'back', angle: 30 });
    const shortField = await server.call('electricField', { designId: two, wavelength: 1064, side: 'back', angle: 30 });
    const fullField = await server.call('electricField', { designId: two, wavelength: 1064, side: 'back', angle: 30, values: true });
    const top = Math.max(...field.s.e2);
    const at = field.s.e2.indexOf(top);
    const shortSaid = [shortField.peak?.s.e2, shortField.peak?.s.z, shortField.peak?.s.layer, shortField.mode, shortField.sampleCount, shortField.layerCount, shortField.incidentAmplitude, 'z' in shortField];
    ok('electricField answers with the peak of each field and where it sits, and every sample for values true',
        JSON.stringify(shortSaid) === JSON.stringify([top, field.z[at], 1, 'back', field.z.length, 1, field.incidentAmplitude, false])
        && JSON.stringify([fullField.z, fullField.s, fullField.avg, fullField.layers]) === JSON.stringify([field.z, field.s, field.avg, field.layers]),
        JSON.stringify(shortSaid));
    const total = await server.call('electricField', { designId: two, side: 'total' });
    ok('a stack view of the whole part is refused', /side/.test(total.error ?? ''), total.error);

    // Its colour and integral values, on the whole part it is scored on.
    const { white, whiteXy, luv, uv1976, uv1960, hunterLab, ...colour } = api.color(edited, { quantity: 'T', illuminant: 'D50' });
    const shortColour = await server.call('color', { designId: two, quantity: 'T', illuminant: 'D50' });
    const fullColour = await server.call('color', { designId: two, quantity: 'T', illuminant: 'D50', values: true });
    ok('color answers with the API\'s colour, and the white and the other colour spaces for values true',
        JSON.stringify(shortColour) === JSON.stringify({ designId: two, ...colour }) && shortColour.mode === 'total'
        && JSON.stringify([fullColour.white, fullColour.whiteXy, fullColour.luv, fullColour.uv1976, fullColour.uv1960, fullColour.hunterLab])
            === JSON.stringify([white, whiteXy, luv, uv1976, uv1960, hunterLab]), JSON.stringify(shortColour).slice(0, 300));
    const custom = [{ key: 'bb', source: { id: 'blackbody', T: 3000 }, band: [400, 700] }];
    const table = api.integrals(edited, { start: 350, end: 1000, step: 2, custom });
    const shortTable = await server.call('integrals', { designId: two, start: 350, end: 1000, step: 2, custom });
    const fullTable = await server.call('integrals', { designId: two, start: 350, end: 1000, step: 2, custom, values: true });
    const tsol = shortTable.rows?.find(r => r.key === 'Tsol');
    const said = [shortTable.rows, fullTable.rows, tsol, shortTable.rows?.length];
    const meant = [table.rows.map(({ key, quantity, value, covered }) => ({ key, quantity, value, covered })), table.rows, { key: 'Tsol', quantity: 'T', value: null, covered: false }, 11];
    ok('integrals answers with each row\'s value, null where it has none, and every field for values true',
        JSON.stringify(said) === JSON.stringify(meant), JSON.stringify(shortTable).slice(0, 300));
    const observer = await server.call('color', { designId: two, observer: 4 });
    const source = await server.call('integrals', { designId: two, custom: [{ key: 'x', source: { id: 'F11' } }] });
    ok('an observer or a custom source it does not have is refused', /observer/.test(observer.error ?? '') && /integrals: custom\[0\]\.source is/.test(source.error ?? ''),
        `${observer.error} / ${source.error}`);

    // Its Psi and Delta on the front, the side the PSI and DEL rows score.
    const sweep = api.ellipsometry(edited, { step: 2, angles: [55, 70], deltaConvention: 'reversed' });
    const shortSweep = await server.call('ellipsometry', { designId: two, step: 2, angles: [55, 70], deltaConvention: 'reversed' });
    const fullSweep = await server.call('ellipsometry', { designId: two, step: 2, angles: [55, 70], deltaConvention: 'reversed', values: true });
    const second = sweep.angles[1];
    const lowest = Math.min(...second.psi);
    const saidSweep = [shortSweep.mode, shortSweep.pointCount, shortSweep.angles?.[1].psi.min, shortSweep.angles?.[1].psi.minAt, shortSweep.angles?.[1].delta.max, fullSweep.wavelength, fullSweep.angles];
    ok('ellipsometry answers with the extremes of Psi and Delta at each angle, and every value for values true',
        JSON.stringify(saidSweep) === JSON.stringify(['front', 201, lowest, sweep.wavelength[second.psi.indexOf(lowest)], Math.max(...second.delta), sweep.wavelength, sweep.angles]),
        JSON.stringify(shortSweep).slice(0, 300));
    const turned = api.ellipsometryVsAngle(edited, { wavelength: 633, angleStep: 1 });
    const shortTurn = await server.call('ellipsometryVsAngle', { designId: two, wavelength: 633, angleStep: 1 });
    const fullTurn = await server.call('ellipsometryVsAngle', { designId: two, wavelength: 633, angleStep: 1, values: true });
    const least = Math.min(...turned.psi);
    const saidTurn = [shortTurn.wavelength, shortTurn.pointCount, shortTurn.psi?.min, shortTurn.psi?.minAt, fullTurn.angle, fullTurn.psi, fullTurn.delta];
    ok('ellipsometryVsAngle answers with the extremes of Psi and Delta over angle, and every value for values true',
        JSON.stringify(saidTurn) === JSON.stringify([633, 36, least, turned.angle[turned.psi.indexOf(least)], turned.angle, turned.psi, turned.delta]), JSON.stringify(shortTurn).slice(0, 300));
    const whole = await server.call('ellipsometry', { designId: two, side: 'total' });
    const past = await server.call('ellipsometryVsAngle', { designId: two, angleEnd: 90 });
    ok('side total and an angular sweep past 89.5 degrees are refused', /side/.test(whole.error ?? '') && /<= 89\.5/.test(past.error ?? ''),
        `${whole.error} / ${past.error}`);

    // Its group delay on the front, and through the whole part.
    const curves = api.groupDelay(edited, { from: 500, to: 700, step: 2, pol: 's', reference: 600 });
    const shortGd = await server.call('groupDelay', { designId: two, from: 500, to: 700, step: 2, pol: 's', reference: 600 });
    const fullGd = await server.call('groupDelay', { designId: two, from: 500, to: 700, step: 2, pol: 's', reference: 600, values: true });
    const lowestGdd = Math.min(...curves.gdd);
    const saidGd = [shortGd.mode, shortGd.reference, shortGd.pointCount, shortGd.knotCount, shortGd.gdd?.min, shortGd.gdd?.minAt, shortGd.phase?.max, shortGd.wavelength,
        fullGd.wavelength, fullGd.phase, fullGd.gd, fullGd.cdc, fullGd.outside, fullGd.knots];
    ok('groupDelay answers with the extremes of each curve, and every value for values true',
        JSON.stringify(saidGd) === JSON.stringify(['front', 600, 101, curves.knots.length, lowestGdd, curves.wavelength[curves.gdd.indexOf(lowestGdd)], Math.max(...curves.phase), undefined,
            curves.wavelength, curves.phase, curves.gd, curves.cdc, curves.outside, curves.knots]), JSON.stringify(shortGd).slice(0, 300));
    const through = await server.call('groupDelay', { designId: two, response: 'T', side: 'total', step: 'auto' });
    ok('groupDelay takes side total with response T and step auto', through.mode === 'total' && through.step === 'auto'
        && through.pointCount === api.groupDelay(edited, { response: 'T', side: 'total', step: 'auto' }).wavelength.length, JSON.stringify(through).slice(0, 300));
    const reflected = await server.call('groupDelay', { designId: two, side: 'total' });
    const badStep = await server.call('groupDelay', { designId: two, step: 'fine' });
    ok('side total with response R and a step that is neither a number nor auto are refused', /side/.test(reflected.error ?? '') && /step/.test(badStep.error ?? ''),
        `${reflected.error} / ${badStep.error}`);

    // One 100 nm SiO2 layer on BK7 has no value from 52 to 77 nm, so a range
    // from 52 nm starts on wavelengths with none.
    const silica = (await server.call('newDesign', { name: 'Silica' })).designId;
    await server.call('insertLayer', { designId: silica, material: 'SiO2', thickness: 100 });
    const known = api.groupDelay(api.insertLayer(api.newDesign({ name: 'Silica' }), { material: 'SiO2', thickness: 100 }), { from: 52, to: 200, step: 1 });
    const partial = await server.call('groupDelay', { designId: silica, from: 52, to: 200, step: 1 });
    const offKeys = ['phase', 'gd', 'gdd', 'tod', 'cdc'].filter(key => {
        const series = known[key];
        const finite = series.filter(Number.isFinite);
        const [lo, hi] = [Math.min(...finite), Math.max(...finite)];
        return JSON.stringify(partial[key]) !== JSON.stringify({ min: lo, minAt: known.wavelength[series.indexOf(lo)], max: hi, maxAt: known.wavelength[series.indexOf(hi)] });
    });
    ok('groupDelay\'s extremes pass over the wavelengths with no value, the first among them',
        Number.isNaN(known.gd[0]) && offKeys.length === 0, `${offKeys.join(', ')}: ${JSON.stringify(partial).slice(0, 300)}`);
    const partialValues = await server.call('groupDelay', { designId: silica, from: 52, to: 200, step: 1, values: true });
    ok('and it counts them and says why once each, listing them only for values true',
        JSON.stringify([partial.invalidCount, partial.invalidReasons, partial.invalid, partialValues.invalid])
        === JSON.stringify([known.invalid.length, [...new Set(known.invalid.map(point => point.reason))], undefined, known.invalid]) && known.invalid.length > 0,
        JSON.stringify([partial.invalidCount, partial.invalidReasons, partial.invalid?.length]));

    // A pulse off its front, and through it from a spectrum the design holds.
    const asJson = value => JSON.parse(JSON.stringify(value));
    const pulse = api.pulseAnalysis(edited, { centre: 600, duration: 20 });
    const shortPulse = await server.call('pulseAnalysis', { designId: two, centre: 600, duration: 20 });
    const fullPulse = await server.call('pulseAnalysis', { designId: two, centre: 600, duration: 20, values: true });
    const { time, spectrum: { band, ...spectra }, ...settled } = pulse;
    ok('pulseAnalysis answers with the settings, the metrics and how many samples each curve holds, and every curve for values true',
        JSON.stringify(shortPulse) === JSON.stringify(asJson({ designId: two, ...withoutCurves(pulse) }))
        && JSON.stringify(fullPulse) === JSON.stringify(asJson({ designId: two, ...settled, band, time, spectrum: spectra })), JSON.stringify(shortPulse).slice(0, 300));
    const spectrumRows = [];
    for (let w = 560; w <= 640; w += 2) spectrumRows.push([w, Math.exp(-(((w - 600) / 15) ** 2))]);
    const spectrumFile = path.join(TEMP, 'pulse.csv');
    fs.writeFileSync(spectrumFile, `Wavelength (nm),Intensity\n${spectrumRows.map(row => row.join(',')).join('\n')}\n`);
    const fromRows = await server.call('setPulseSpectrum', { designId: two, rows: spectrumRows });
    const throughRows = await server.call('pulseAnalysis', { designId: two, source: 'design' });
    const held = api.setPulseSpectrum(edited, spectrumRows);
    ok('setPulseSpectrum sets the rows, which pulseAnalysis with source design reads',
        fromRows.rows === spectrumRows.length && JSON.stringify(throughRows) === JSON.stringify(asJson({ designId: two, ...withoutCurves(api.pulseAnalysis(held, { source: 'design' })) })),
        JSON.stringify(fromRows).slice(0, 200));
    const fromFile = await server.call('setPulseSpectrum', { designId: two, path: spectrumFile });
    const centred = (await server.call('pulseAnalysis', { designId: two, source: 'design' })).centre;
    const relative = await server.call('setPulseSpectrum', { designId: two, path: 'pulse.csv' });
    const both = await server.call('setPulseSpectrum', { designId: two, path: spectrumFile, rows: spectrumRows });
    ok('it reads a table file, and a relative path and a path with rows are refused',
        fromFile.rows === spectrumRows.length && centred === api.pulseAnalysis(api.setPulseSpectrum(edited, spectrumFile), { source: 'design' }).centre
        && /absolute path/.test(relative.error ?? '') && /path or rows/.test(both.error ?? ''), `${centred} / ${relative.error} / ${both.error}`);
    const neither = await server.call('setPulseSpectrum', { designId: two });
    const oneNumber = await server.call('setPulseSpectrum', { designId: two, rows: [[800, 1], [810]] });
    ok('without path or rows, or with a row of one number, it is refused in the words of its own arguments',
        /give either path or rows/.test(neither.error ?? '') && /rows\[1\] is \[wavelength nm, intensity\]/.test(oneNumber.error ?? ''), `${neither.error} / ${oneNumber.error}`);
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
