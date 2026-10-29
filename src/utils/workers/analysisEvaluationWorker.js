/**
 * Off-renderer evaluation for cone-aware live display consumers, merit
 * readouts at the rows' own Steps and pulse analysis, and Monte Carlo runs
 * with their progress.
 */
import { computeOpticalSpectrum } from '../../components/windows/analysis/opticalEvaluation/spectrum.js';
import { computeSpectrumForMode } from '../../components/windows/analysis/integralValues/spectrum.js';
import { computeColorReport } from '../../components/windows/analysis/colorEvaluation/colorModel.js';
import { computePulseAnalysis } from '../../components/windows/analysis/pulseAnalysis/pulseModel.js';
import { designMaterialLookup, unresolvedMaterials } from '../materials/designMaterials.js';
import { computeMonitors } from '../physics/statusMonitorEvaluation.js';
import { evaluateQualifiers } from '../synthesis/qualifiers.js';
import { runErrorAnalysisMC, computeLayerSensitivity } from '../physics/errorAnalysis.js';
import { toleranceSpecInputs } from '../../components/windows/analysis/toleranceSpecInputs.js';
import { computeCurveResults } from '../../components/windows/analysis/plotEngine/curveResults.js';
import { computeVariatorSpectrum } from '../../components/windows/optimization/variator/model.js';
import { designPreview } from '../../components/windows/dataExchange/spectrumExchange/designPreview.js';
import { designBackdrop } from '../../components/windows/dataExchange/curveEditor/designBackdrop.js';
import { meritDisplay, meritTable } from '../physics/meritDisplay.js';
import { resolveEvalMode } from '../physics/optimizer.js';
import { noteTmmWasmBytes, awaitTmmWasmReady } from '../../tmmcore.js';

function meritScore(design, operands) {
    if (!design || !operands?.length) return { mf: null, omf: null };
    const { mf, omf } = meritTable(design, operands);
    return { mf, omf };
}

// A design's Specification results as `options` asks (qualifiers/evaluate.js),
// judged on the design `recipe` makes of it (toleranceSpecInputs.js), or null
// when a material it uses resolves nowhere.
function specificationResults(design, options, recipe) {
    try {
        const { design: judged, resolve } = toleranceSpecInputs(design, recipe);
        return evaluateQualifiers(design.qualifiers || [], judged, resolve, options);
    } catch {
        return null;
    }
}

function timelineMerit(design) {
    if (!design) return { mf: null, materialMissing: false };
    const materialMissing = unresolvedMaterials(design).length > 0;
    const operands = (design.meritOperands || []).filter(op => op.enabled);
    if (materialMissing || operands.length === 0) return { mf: null, materialMissing };
    try {
        return { mf: meritScore(design, operands).mf, materialMissing: false };
    } catch {
        return { mf: null, materialMissing: true };
    }
}

function colorReport(design, options) {
    let reportedError = null;
    const report = computeColorReport({
        ...options,
        design,
        setError: value => { reportedError = value; },
    });
    if (reportedError) throw new Error(reportedError);
    return report;
}

const EVALUATIONS = {
    opticalSpectrum: ({ design, params, evalMode }) => computeOpticalSpectrum(design, params, evalMode),
    integralSpectrum: ({ design, params, evalMode }) => computeSpectrumForMode(design, params, evalMode),
    // The Report's integrals blocks: integralSpectrum of each design on each
    // grid, the design read in the mode it is evaluated in.
    integralSpectra: ({ designs, grids }) => (designs || []).map(design =>
        grids.map(params => computeSpectrumForMode(design, params, resolveEvalMode(design)))),
    colorReport: ({ design, options }) => colorReport(design, options),
    statusMonitors: ({ design, monitors }) => computeMonitors(monitors || [], design, designMaterialLookup(design)),
    specification: ({ designs, coarse, deviation, interlayers }) => (designs || [])
        .map(d => specificationResults(d, { coarse }, { deviation, interlayers })),
    meritDisplay: ({ design, operands }) => meritDisplay(design, operands || []),
    meritPair: ({ design, candidateDesign, operands }) => ({
        before: meritScore(design, operands || []),
        after: meritScore(candidateDesign, operands || []),
    }),
    pulseAnalysis: ({ design, request }) => computePulseAnalysis(design, request),
    meritTimeline: ({ designs }) => (designs || []).map(timelineMerit),
    layerSensitivity: ({ design, operands, options }) =>
        computeLayerSensitivity(design, operands || [], designMaterialLookup(design), options),
    plotCurves: ({ design, curves }) => computeCurveResults(curves, design),
    variatorSpectrum: request => computeVariatorSpectrum(request),
    designPreview: ({ design, curve, missing }) => designPreview(design, curve, missing),
    designBackdrop: ({ design, table, conditions, missing }) => designBackdrop(design, table, conditions, missing),
};

// Progress of a Monte Carlo run is posted at most this often, ms. Each post
// carries the result so far and the trial records made since the last post,
// so a window that ends the worker keeps every trial reported.
const MC_PROGRESS_MS = 100;

// One Monte Carlo run (components/windows/analysis/errorAnalysis/monteCarloRun.js):
// progress posts as the trials run, then the result. A result is sent without
// its trial records, which travel in the posts and are handed over rather than
// kept: result.trials is the run's own list, emptied by each post.
async function runMonteCarlo({ design, params, options }) {
    let posted = -Infinity;
    const split = result => ({
        result: { ...result, trials: null },
        trials: result.trials ? result.trials.splice(0) : null,
    });
    const result = await runErrorAnalysisMC(design, params, designMaterialLookup(design), {
        ...options,
        onTrial: ({ i, total, result: soFar }) => {
            const now = performance.now();
            if (i === total || now - posted < MC_PROGRESS_MS) return;
            posted = now;
            postMessage({ type: 'progress', i, total, ...split(soFar()) });
        },
    });
    postMessage({ type: 'monteCarloDone', ...split(result) });
}

export function dispatchAnalysisEvaluation(operation, payload) {
    const evaluate = Object.hasOwn(EVALUATIONS, operation) ? EVALUATIONS[operation] : null;
    if (!evaluate) throw new Error(`Unknown analysis evaluation: ${operation}`);
    return evaluate(payload);
}

globalThis.onmessage = async event => {
    const job = event.data;
    if (!job?.type) return;
    if (job.type === 'wasmInit') {
        noteTmmWasmBytes(job.wasmBytes);
        return;
    }
    if (job.type === 'monteCarlo') {
        try {
            await awaitTmmWasmReady();
            await runMonteCarlo(job);
        } catch (error) {
            postMessage({ type: 'error', message: error?.message || String(error) });
        }
        return;
    }
    if (job.type !== 'evaluate') return;
    try {
        await awaitTmmWasmReady();
        postMessage({ type: 'result', operation: job.operation, data: dispatchAnalysisEvaluation(job.operation, job.payload) });
    } catch (error) {
        postMessage({ type: 'error', message: error?.stack || String(error) });
    }
};
