/**
 * Measured Spectra's design spectrum export (spectrumExchange/exportActions.js
 * useDesignExport), driven as the Export tab drives it: the file it writes
 * holds the spectrum Optical Evaluation computes, averaged over the design's
 * cone of incidence, which is computed on the analysis worker.
 *
 *   1. cone-user-distribution, R and T at 45 deg: the CSV and JCAMP-DX files
 *      hold the cone-averaged spectrum the API's spectrum computes, not the
 *      collimated one, and the evaluation ran on a worker.
 *   2. A design with no cone is computed on the window's thread, with the
 *      numbers Optical Evaluation computes.
 *
 * Run: node tests/spectrum_exchange_design_export.mjs
 */
import { fixtureFile } from './_apiCorpus.mjs';
import { loadApp, makeLocale, shimBrowserGlobals } from './_uiShim.mjs';

const api = await import('../src/api/index.js');
const { dispatchAnalysisEvaluation } = await import('../src/utils/workers/analysisEvaluationWorker.js');
const { parseSpectrumTable } = await import('../src/utils/io/spectrumTable.js');
const { parseJcampDx } = await import('../src/utils/io/jcampDx.js');
const { withHerpinRecords } = await import('../src/utils/materials/designMaterials.js');

shimBrowserGlobals();
await loadApp();
const { renderToStaticMarkup } = await import('react-dom/server');
const { useDesignExport } = await import('../src/components/windows/dataExchange/spectrumExchange/exportActions.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const t = makeLocale();

// A worker that runs the analysis evaluation on this thread, as the analysis
// worker runs it, and counts the evaluations it was given.
const posted = [];
globalThis.Worker = class {
    postMessage(message) {
        if (message.type !== 'evaluate') return;
        posted.push(message.operation);
        const data = dispatchAnalysisEvaluation(message.operation, message.payload);
        queueMicrotask(() => this.onmessage({ data: { type: 'result', data } }));
    }
    terminate() {}
};

// The text the Export tab's design export writes for `design` in `format`.
async function exported(design, format) {
    let actions;
    const said = {};
    const Probe = () => {
        actions = useDesignExport({
            design, evalMode: api.spectrum(design, { from: 500, to: 501 }).evalMode, dStart: 500, dEnd: 600, dStep: 5, dAoi: '45',
            dQ: { T: true, R: true, A: false }, dSP: false, expFormat: format, flash: (type, text) => { said.flash = [type, text]; }, sx: t.spectrumExchange,
        });
        return null;
    };
    renderToStaticMarkup(React.createElement(Probe));
    window.electronAPI = { spectrumSaveFile: async (text) => { said.text = text; return { success: true, filePath: 'x' }; } };
    await actions();
    return said.text;
}

// The files write 12 significant digits.
const close = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 1e-11);

// ── 1. A design under a cone ─────────────────────────────────────────────
{
    const design = withHerpinRecords(api.openDesign(fixtureFile('cone-user-distribution')));
    const coned = api.spectrum(design, { from: 500, to: 600, step: 5, angles: [45] }).angles[45];
    const collimated = api.spectrum({ ...design, cone: null }, { from: 500, to: 600, step: 5, angles: [45] }).angles[45];
    const csv = parseSpectrumTable(await exported(design, 'csv'));
    const [T, R] = csv.columns.map(column => column.values.map(v => v / 100));
    ok('the CSV holds the cone-averaged T and R', close(T, coned.T) && close(R, coned.R), JSON.stringify([R.slice(0, 2), coned.R.slice(0, 2)]));
    ok('which differ from the collimated ones', !close(R, collimated.R));
    const jcamp = parseJcampDx(await exported(design, 'jcamp'));
    ok('the JCAMP-DX file too', jcamp.ok && close(jcamp.spectra[1].y, coned.R), JSON.stringify(jcamp.spectra[1]?.y.slice(0, 2)));
    ok('computed on the analysis worker', posted.join() === 'opticalSpectrum,opticalSpectrum', posted.join());
}

// ── 2. A design with no cone ─────────────────────────────────────────────
{
    posted.length = 0;
    const design = api.stackFromFormula(api.newDesign({ name: 'Mirror' }), { formula: '(HL)^3 H' });
    const csv = parseSpectrumTable(await exported(design, 'csv'));
    const own = api.spectrum(design, { from: 500, to: 600, step: 5, angles: [45] }).angles[45];
    ok('a design with no cone is written with Optical Evaluation\'s numbers', close(csv.columns[1].values.map(v => v / 100), own.R));
    ok('on the window\'s thread', posted.length === 0, posted.join());
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
