/**
 * Test helper for design_file_corpus.mjs: today's build started over a data
 * folder the way the app starts, and the numbers a loaded design shows.
 *
 * Importing this module installs the browser globals the renderer modules read
 * (window, localStorage, React) before it imports them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

{
    const store = new Map();
    const events = new EventTarget();
    globalThis.window = globalThis;
    globalThis.addEventListener = events.addEventListener.bind(events);
    globalThis.removeEventListener = events.removeEventListener.bind(events);
    globalThis.dispatchEvent = events.dispatchEvent.bind(events);
    globalThis.localStorage = {
        getItem: key => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: key => store.delete(key),
        key: index => [...store.keys()][index] ?? null,
        get length() { return store.size; },
    };
    globalThis.React = require('react');
}

const paths = require('../src/main/paths.js');
const projectsIpc = require('../src/main/ipc/projects.js');
const catalogsIpc = require('../src/main/ipc/catalogs.js');
const { parseFoldersResult } = await import('../src/utils/io/projectPersistence.js');
const { mergeSessionOverDisk } = await import('../src/utils/io/sessionMerge.js');
const { followedDesigns } = await import('../src/utils/materials/catalogStamps.js');
const { loadCatalogsFromDisk } = await import('../src/utils/materials/catalogStartup.js');
const {
    designMaterialIds, designMaterialLookup, designMaterialName, embedDesignMaterials,
    resolveDesignMaterial, unresolvedMaterials, withHerpinRecords,
} = await import('../src/utils/materials/designMaterials.js');
const { resolveEvalMode, makeConeSpec, coneIsActive, withDesignSampleCounts } = await import('../src/utils/physics/optimizer.js');
const { dispatchAnalysisEvaluation } = await import('../src/utils/workers/analysisEvaluationWorker.js');
const { evaluateForDisplay } = await import('../src/utils/physics/meritDisplay.js');

export { paths, embedDesignMaterials };

/** A number as the golden file stores it: 12 significant digits, or text when JSON cannot hold it. */
export function num(x) {
    if (typeof x !== 'number') return x ?? null;
    if (!Number.isFinite(x)) return String(x);
    return Number(x.toPrecision(12));
}

/**
 * Today's main-process design and catalog handlers over `dataDir`, with the
 * folders main.js makes at startup. `start()` is an app start: the catalogs,
 * then the Projects folder, then the renderer's merge of the stored session
 * (none here) over the files, and the catalog following of the copies.
 */
export function installation(dataDir) {
    const projectsDir = path.join(dataDir, 'Projects');
    const materialsDir = path.join(dataDir, 'Materials');
    fs.mkdirSync(projectsDir, { recursive: true });
    for (const sub of ['agf', 'user', 'refractiveindex', 'library', 'optilayer']) {
        fs.mkdirSync(path.join(materialsDir, sub), { recursive: true });
    }
    const handlers = new Map();
    const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };
    const ctx = { fs, path, log: () => {}, projectsDir, materialsDir, ...paths };
    projectsIpc.register(ipcMain, ctx);
    catalogsIpc.register(ipcMain, ctx);
    const call = (channel, ...args) => handlers.get(channel)(null, ...args);
    async function start() {
        globalThis.electronAPI = {
            loadCatalogs: () => call('catalog:load-all'),
            scanAgfDir: () => call('catalog:scan-agf-dir'),
            saveCatalog: catalog => call('catalog:save', catalog),
            deleteCatalog: (id, source) => call('catalog:delete', id, source),
        };
        await loadCatalogsFromDisk();
        const tree = await call('load-folders');
        if (!tree.success) return { tree, store: {} };
        const { diskDesigns } = parseFoldersResult(tree);
        const merged = mergeSessionOverDisk(diskDesigns, null);
        return { tree, store: followedDesigns(merged.initialDesigns).designs };
    }
    return { projectsDir, materialsDir, call, start };
}

// Each material the design names or carries: status, conflict flag, name,
// and [wavelength nm, n, k] at each of `nkAt`.
function materialValues(design, nkAt) {
    const ids = [...new Set([...designMaterialIds(design), ...Object.keys(design.materials || {})])].sort();
    const out = {};
    for (const id of ids) {
        const { material, status, conflict } = resolveDesignMaterial(design, id);
        const entry = { status, name: designMaterialName(design, id) };
        if (conflict) entry.conflict = true;
        if (status !== 'missing') {
            entry.nk = nkAt.map(lambda => {
                const [n, k] = material.getNK(lambda);
                return [lambda, num(n), num(k)];
            });
        }
        out[id] = entry;
    }
    return out;
}

const coneOn = design => coneIsActive(makeConeSpec(design.cone || {}));

// R, T and A for unpolarized light, then for s and p.
const SPECTRUM_KEYS = ['R', 'T', 'A', 'Rs', 'Rp', 'Ts', 'Tp', 'As', 'Ap'];

// The Optical Evaluation's spectrum; a design under a cone goes to the
// analysis worker, which gets the design with its materials embedded.
function spectrumValues(design, evalMode, fixture) {
    const unresolved = unresolvedMaterials(design);
    if (unresolved.length) return { blocked: unresolved };
    const [lambdaStart, lambdaEnd, lambdaStep] = fixture.spectrum;
    let data;
    try {
        data = dispatchAnalysisEvaluation('opticalSpectrum', {
            design: coneOn(design) ? embedDesignMaterials(design) : design,
            params: { lambdaStart, lambdaEnd, lambdaStep, thetas: fixture.angles },
            evalMode,
        });
    } catch (err) {
        return { error: err.message };
    }
    const angles = {};
    for (const series of data.series) {
        angles[series.theta] = Object.fromEntries(SPECTRUM_KEYS.map(key => [key, Array.from(series[key], num)]));
    }
    return { lambda: Array.from(data.lambda, num), angles };
}

// The Merit Function Editor's numbers: its own display evaluation, or under a
// cone the analysis worker's, with the band sample counts the editor sends.
function meritValues(design) {
    const operands = design.meritOperands || [];
    if (operands.length === 0) return null;
    let result;
    try {
        result = coneOn(design)
            ? dispatchAnalysisEvaluation('meritDisplay', {
                design: embedDesignMaterials(design),
                operands: withDesignSampleCounts(operands, design, designMaterialLookup(design)),
            })
            : evaluateForDisplay(design, operands);
    } catch (err) {
        return { error: err.message };
    }
    const values = Array.from(result.computed);
    return {
        rows: operands.map((op, i) => ({
            type: op.type,
            value: num(values[i]),
            ...(result.errors[i] ? { error: String(result.errors[i]) } : {}),
        })),
        mf: num(result.mf),
        omf: num(result.omf),
    };
}

/**
 * What the windows show for `design`, the design as the store holds it: the
 * load result, the materials, the spectrum and the merit. `fileId` is the id
 * the file held, or null when the loader gave the design one.
 */
export function designValues(design, fileId, fixture) {
    const shown = withHerpinRecords(design);
    const evalMode = resolveEvalMode(shown);
    return {
        design: {
            name: shown.name,
            id: fileId ? shown.id : (shown.id ? 'given on load' : null),
            evalMode,
            surfaceMode: shown.surfaceMode ?? null,
            frontLayers: shown.frontLayers.length,
            backLayers: shown.backLayers.length,
            operands: (shown.meritOperands || []).length,
        },
        materials: materialValues(shown, fixture.nk),
        spectrum: spectrumValues(shown, evalMode, fixture),
        merit: meritValues(shown),
    };
}
