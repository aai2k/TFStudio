/**
 * TFStudio's MCP server: the headless API (src/api/) as Model Context Protocol
 * tools over stdio, for AI agents and other MCP clients.
 *
 *   node src/mcp/server.js [--data <folder>] [--live <file>]
 *   TFStudio.exe --mcp [--data <folder>] [--live]  (src/main/serverEntry.js)
 *
 * --data names a TFStudio data folder (the one holding Materials), whose
 * catalogs the tools then use as the app does; TFStudio.exe takes the app's
 * own without it. Without either, the built-in catalog and the materials a
 * design carries resolve.
 *
 * --live names the live link file the open app writes (src/main/
 * liveProtocol.js), and adds the tools that read the app's designs and apply
 * changes to the open one (liveTools.js). Without it every tool works on files
 * and on the session's designs only, and nothing reaches the app.
 */
import fs from 'node:fs';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { format } from 'node:util';
import { pathToFileURL } from 'node:url';

const log = text => process.stderr.write(`[tfstudio-mcp] ${text}\n`);

// The name an MCP client gives itself in `initialize`, its title before its
// name, as the open app shows it while the agent works on the open design.
const clientName = info => [info?.title, info?.name].find(name => typeof name === 'string' && name.trim()) ?? null;

const INSTRUCTIONS = [
    'TFStudio designs and analyzes optical thin-film coatings. The tools work on designs held in this session by id ("d1").',
    'Start from a .tfs file (openDesign) or a new design (newDesign); change its media, substrate and sides (setDesignSetup); build or edit the stack (stackFromFormula, insertLayer, setLayer, deleteLayer, cleanDesign, scaleThicknesses, quantize, perturb, flipLayers, copySide), search and put in a non-polarizing edge filter (edgeFilter, applyEdgeFilter), find where a needle lowers the merit and put one in (needleProfile, insertNeedle) and compare two designs (designDifferences); set the merit function (setMerit) and the specification (setSpecification); compute (spectrum, color, integrals, merit, checkSpecification, layerSensitivity) and find a band\'s peak, edge and width and how an edge moves with angle (bandFeature, edgeShift); read a measured spectrum file and compare a design with a curve in one (readSpectrumFile, measuredDifference), read an ellipsometer file (readEllipsometryFile), add a file\'s measured curves to a design, add the merit rows that fit it to one and write them to a file (addMeasuredCurves, fitMeasured, exportMeasuredCurves); read the stack (indexProfile, layerThicknesses, designFacts) and a side\'s admittance locus, electric field and Psi and Delta (admittance, electricField, ellipsometry, ellipsometryVsAngle), and a side\'s phase, group delay and GDD (groupDelay); compute the spectrum a monitor reads after each layer of a deposition run and write the Process Exporter\'s files (processSteps, exportProcess); find materials and read their n, k and dispersion (findMaterials, materialNK, materialDispersion).',
    'refine, synthesize and monteCarlo run as jobs: they answer with the job\'s state, and jobStatus follows a job that is still running. A run that changed the design adds its answer as a new design. saveDesign writes a design to a .tfs file the app opens.',
    'Units: wavelengths and layer thicknesses in nm, angles in degrees in the incident medium, substrate thickness in mm, R, T and A as fractions of 1. A value a tool cannot use is refused with a message that says what it takes.',
].join('\n');

/**
 * Serves the tools on this process's stdin and stdout until stdin closes.
 * `dataDir` is the TFStudio data folder or null, `version` the version the
 * server reports, `wasmPath` the WASM kernel's file when it is not the tmmcore
 * package's, `live` { file } the live link file when the server is linked to
 * the open app.
 */
export async function serve({ dataDir = null, version, wasmPath, live = null } = {}) {
    // stdout carries the protocol alone; whatever the computation prints goes
    // to stderr, which MCP clients keep as the server's log.
    for (const level of ['log', 'info', 'warn', 'debug']) {
        console[level] = (...args) => process.stderr.write(`${format(...args)}\n`);
    }
    const api = await import('../api/index.js');
    const { createSession } = await import('./protocol.js');
    const { createDesignStore, sameLayers } = await import('./designStore.js');
    const { createJobs } = await import('./jobs.js');
    const { designTools } = await import('./designTools.js');
    const { analysisTools } = await import('./analysisTools.js');
    const { processTools } = await import('./processTools.js');
    const { measuredTools } = await import('./measuredTools.js');
    const { needleTools } = await import('./needleTools.js');
    const { runTools } = await import('./runTools.js');
    const { liveTools, LIVE_INSTRUCTIONS } = await import('./liveTools.js');
    const { createLiveLink } = await import('./liveLink.js');

    const started = await api.init({ dataDir, wasmPath });
    log(`started: WASM ${started.wasm}, data folder ${dataDir ?? 'none'}${live ? `, live link file ${live.file}` : ''}`);
    for (const file of started.unreadable) log(`catalog left out, could not be read: ${JSON.stringify(file)}`);

    const store = createDesignStore();
    let client = null;
    const link = live ? createLiveLink(live.file, () => clientName(client)) : null;
    const app = link ? liveTools({ store, link }) : null;
    const jobs = createJobs({
        environment: { dataDir, wasmPath },
        // A run that kept the layers of a design still as it started answers
        // with that design; any other answer is a design of its own, linked to
        // the app design its source was read from, as that link stood when
        // the run started.
        keepAnswer: (job, design) => (sameLayers(design, job.startDesign) && store.get(job.sourceId) === job.startDesign
            ? job.sourceId : store.add(design, job.link)),
        finish: app?.finishRun,
    });
    const tools = [
        ...designTools({ api, store }), ...analysisTools({ api, store }), ...measuredTools({ api, store }), ...processTools({ api, store }), ...needleTools({ api, store }),
        ...runTools({ store, jobs, live: !!app }),
        ...(app ? app.tools : []),
    ];
    const session = createSession({
        serverInfo: { name: 'tfstudio', title: 'TFStudio', version },
        instructions: app ? `${INSTRUCTIONS}\n${LIVE_INSTRUCTIONS}` : INSTRUCTIONS, tools, log,
        send: message => process.stdout.write(`${JSON.stringify(message)}\n`),
        onClient: info => { client = info; },
    });

    const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
    input.on('line', line => session.receive(line));
    input.on('close', () => {
        session.stopAll();
        jobs.stopAll();
        link?.close();
        // The process ends once its event loop drains. Writing the last replies
        // takes milliseconds; two seconds leaves room on a loaded machine, and a
        // job thread still computing after that does not keep a client waiting
        // on a server it has closed.
        setTimeout(() => process.exit(0), 2000).unref();
    });
}

function parseArgs(argv) {
    const args = { dataDir: null, live: null };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--data' && argv[i + 1]) args.dataDir = argv[++i];
        else if (argv[i] === '--live' && argv[i + 1]) args.live = { file: argv[++i] };
        else throw new Error(`unknown argument '${argv[i]}'. Usage: server.js [--data <folder>] [--live <file>]`);
    }
    return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const { version } = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    Promise.resolve()
        .then(() => serve({ ...parseArgs(process.argv.slice(2)), version }))
        .catch(err => {
            log(err?.message || String(err));
            process.exit(1);
        });
}
