/** Off-renderer evaluation for cone-aware live display consumers. */
import { computeOpticalSpectrum } from '../../components/windows/analysis/opticalEvaluation/spectrum.js';
import { computeSpectrumForMode } from '../../components/windows/analysis/integralValues/spectrum.js';
import { computeColorReport } from '../../components/windows/analysis/colorEvaluation/colorModel.js';
import { designMaterialLookup, unresolvedMaterials } from '../materials/designMaterials.js';
import { computeMonitors } from '../physics/statusMonitorEvaluation.js';
import {
    buildEvalContext, evaluateOperands, operandEvaluationErrors, operandBandLevels,
    calcMF, calcOMF,
} from '../physics/optimizer.js';
import { noteTmmWasmBytes, awaitTmmWasmReady } from '../../tmmcore.js';

function meritDisplay(design, operands) {
    const computed = evaluateOperands(operands, buildEvalContext(design, designMaterialLookup(design)));
    const errors = operandEvaluationErrors(computed);
    const invalid = errors.some(Boolean);
    return {
        computed: Array.from(computed),
        errors,
        bandLevels: operandBandLevels(computed),
        mf: invalid ? null : calcMF(operands, computed),
        omf: invalid ? null : calcOMF(operands, computed),
    };
}

function meritScore(design, operands) {
    if (!design || !operands?.length) return { mf: null, omf: null };
    const { mf, omf } = meritDisplay(design, operands);
    return { mf, omf };
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

export function dispatchAnalysisEvaluation(operation, payload) {
    const { design } = payload;
    switch (operation) {
        case 'opticalSpectrum':
            return computeOpticalSpectrum(design, payload.params, payload.evalMode);
        case 'integralSpectrum':
            return computeSpectrumForMode(design, payload.params, payload.evalMode);
        case 'colorReport': {
            let reportedError = null;
            const report = computeColorReport({
                ...payload.options,
                design,
                setError: value => { reportedError = value; },
            });
            if (reportedError) throw new Error(reportedError);
            return report;
        }
        case 'statusMonitors':
            return computeMonitors(payload.monitors || [], design, designMaterialLookup(design));
        case 'meritDisplay':
            return meritDisplay(design, payload.operands || []);
        case 'meritPair':
            return {
                before: meritScore(design, payload.operands || []),
                after: meritScore(payload.candidateDesign, payload.operands || []),
            };
        case 'meritTimeline':
            return (payload.designs || []).map(timelineMerit);
        default:
            throw new Error(`Unknown analysis evaluation: ${operation}`);
    }
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
