/** Off-renderer evaluation for cone-aware live display consumers and pulse analysis. */
import { computeOpticalSpectrum } from '../../components/windows/analysis/opticalEvaluation/spectrum.js';
import { computeSpectrumForMode } from '../../components/windows/analysis/integralValues/spectrum.js';
import { computeColorReport } from '../../components/windows/analysis/colorEvaluation/colorModel.js';
import { computePulseAnalysis } from '../../components/windows/analysis/pulseAnalysis/pulseModel.js';
import { designMaterialLookup, unresolvedMaterials } from '../materials/designMaterials.js';
import { computeMonitors } from '../physics/statusMonitorEvaluation.js';
import { evaluateQualifiers } from '../synthesis/qualifiers.js';
import { meritDisplay } from '../physics/meritDisplay.js';
import { noteTmmWasmBytes, awaitTmmWasmReady } from '../../tmmcore.js';

function meritScore(design, operands) {
    if (!design || !operands?.length) return { mf: null, omf: null };
    const { mf, omf } = meritDisplay(design, operands);
    return { mf, omf };
}

// A design's Specification results as `options` asks (qualifiers/evaluate.js),
// or null when a material it uses resolves nowhere.
function specificationResults(design, options) {
    try {
        return evaluateQualifiers(design.qualifiers || [], design, designMaterialLookup(design), options);
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
    colorReport: ({ design, options }) => colorReport(design, options),
    statusMonitors: ({ design, monitors }) => computeMonitors(monitors || [], design, designMaterialLookup(design)),
    specification: ({ designs, coarse }) => (designs || []).map(d => specificationResults(d, { coarse })),
    meritDisplay: ({ design, operands }) => meritDisplay(design, operands || []),
    meritPair: ({ design, candidateDesign, operands }) => ({
        before: meritScore(design, operands || []),
        after: meritScore(candidateDesign, operands || []),
    }),
    pulseAnalysis: ({ design, request }) => computePulseAnalysis(design, request),
    meritTimeline: ({ designs }) => (designs || []).map(timelineMerit),
};

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
    if (job.type !== 'evaluate') return;
    try {
        await awaitTmmWasmReady();
        postMessage({ type: 'result', operation: job.operation, data: dispatchAnalysisEvaluation(job.operation, job.payload) });
    } catch (error) {
        postMessage({ type: 'error', message: error?.stack || String(error) });
    }
};
