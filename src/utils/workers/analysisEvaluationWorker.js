/**
 * Off-renderer evaluation for cone-aware live display consumers, merit
 * readouts at the rows' own Steps and pulse analysis, and Monte Carlo runs
 * with their progress.
 */
import { computeOpticalSpectrum } from '../../components/windows/analysis/opticalEvaluation/spectrum.js';
import { computeSpectrumForMode } from '../../components/windows/analysis/integralValues/spectrum.js';
import { computeColorReports } from '../../components/windows/analysis/colorEvaluation/colorModel.js';
import { computePulseAnalysis } from '../../components/windows/analysis/pulseAnalysis/pulseModel.js';
import { designMaterialLookup, unresolvedMaterials } from '../materials/designMaterials.js';
import { computeMonitors } from '../physics/statusMonitorEvaluation.js';
import { evaluateSpecification } from '../environments/environmentSpecification.js';
import { runErrorAnalysisMC, computeLayerSensitivity } from '../physics/errorAnalysis.js';
import { toleranceSpecInputs } from '../../components/windows/analysis/toleranceSpecInputs.js';
import { computeCurveResults } from '../../components/windows/analysis/plotEngine/curveResults.js';
import { computeVariatorSpectrum } from '../../components/windows/optimization/variator/model.js';
import { inhomogeneitySpectraState } from '../../components/windows/analysis/inhomogeneities/model.js';
import { calculateRoughness } from '../../components/windows/analysis/roughnessScattering/model.js';
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
// judged in each of its environments on the design `recipe` makes of it there
// (environmentSpecification.js, toleranceSpecInputs.js), or null when a
// material it uses resolves nowhere.
function specificationResults(design, options, recipe) {
    try {
        return evaluateSpecification(design.qualifiers || [], design, options, id => toleranceSpecInputs(design, recipe, id));
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

function colorReports(design, options) {
    let reportedError = null;
    const reports = computeColorReports({
        ...options,
        design,
        setError: value => { reportedError = value; },
    });
    if (reportedError) throw new Error(reportedError);
    return reports;
}

const EVALUATIONS = {
    opticalSpectrum: ({ design, params, evalMode }) => computeOpticalSpectrum(design, params, evalMode),
    // Optical Evaluation's spectrum of each environment it shows, each design
    // the one that environment computes.
    opticalSpectra: ({ designs, params, evalMode }) => (designs || []).map(design => computeOpticalSpectrum(design, params, evalMode)),
    integralSpectrum: ({ design, params, evalMode }) => computeSpectrumForMode(design, params, evalMode),
    // integralSpectrum of each design on each grid, in `evalMode` when given:
    // Integral Values' spectrum of each environment it shows, on its one grid;
    // the Report's integrals blocks, each design read in the mode it is
    // evaluated in.
    integralSpectra: ({ designs, grids, evalMode }) => (designs || []).map(design =>
        grids.map(params => computeSpectrumForMode(design, params, evalMode ?? resolveEvalMode(design)))),
    // Color Evaluation's colour at each angle in each environment it shows,
    // each design the one that environment computes.
    colorReports: ({ designs, options }) => (designs || []).map(design => colorReports(design, options)),
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
    inhomogeneitySpectra: request => inhomogeneitySpectraState(request),
    roughnessSpectra: ({ design, params, rough, evalMode }) => calculateRoughness({ design, params, rough, evalMode }),
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
