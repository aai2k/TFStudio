import { makeConeSpec, coneIsActive } from '../../../../utils/physics/optimizer.js';
import { computeOpticalSpectrum } from '../../analysis/opticalEvaluation/spectrum.js';
import { evaluateOnAnalysisWorker } from '../../analysis/useAnalysisEvaluation.js';
import {
    designExportBaseName,
    designExportDocument,
    designExportSelection,
    measuredExportDocument,
} from './model.js';

const { useCallback } = React;

// The design's spectrum as Optical Evaluation computes it, averaged over the
// design's cone of incidence; under a cone it is computed on the analysis
// worker, where every point costs one evaluation per ray.
function designSpectrum(design, params, evalMode) {
    if (!coneIsActive(makeConeSpec(design.cone || {}))) return Promise.resolve(computeOpticalSpectrum(design, params, evalMode));
    return evaluateOnAnalysisWorker('opticalSpectrum', { design, params, evalMode });
}

export function useMeasuredExport({ design, expFormat, curves, xUnit, asPercent, flash, sx }) {
    return useCallback(async () => {
        const list = curves || [];
        if (!list.length) {
            flash('info', sx.nothingToExport);
            return;
        }
        const output = measuredExportDocument(design, expFormat, {
            curves: list, xUnit, asPercent,
        });
        try {
            const result = await window.electronAPI.spectrumSaveFile(output.text, output.fileName);
            if (result?.success) flash('success', sx.exported(result.filePath));
            else if (!result?.canceled) flash('error', sx.errExport(result?.error || ''));
        } catch (err) {
            flash('error', sx.errExport(err.message));
        }
    }, [design, expFormat, curves, xUnit, asPercent, sx]);
}

export function useDesignExport(options) {
    const { design, evalMode, dStart, dEnd, dStep, dAoi, dQ, dSP, expFormat, flash, sx } = options;
    return useCallback(async () => {
        const { thetas, quantities } = designExportSelection(dAoi, dQ);
        if (!quantities.length) {
            flash('info', sx.pickQuantity);
            return;
        }
        const params = { lambdaStart: dStart, lambdaEnd: dEnd, lambdaStep: dStep, thetas };
        const base = designExportBaseName(design);
        try {
            const spectrum = await designSpectrum(design, params, evalMode);
            if (!spectrum.lambda.length) {
                flash('error', sx.errParse);
                return;
            }
            const output = designExportDocument({
                spec: spectrum,
                design,
                quantities,
                includeSP: dSP,
                expFormat,
                base,
            });
            const result = await window.electronAPI.spectrumSaveFile(output.text, output.fileName);
            if (result?.success) flash('success', sx.exported(result.filePath));
            else if (!result?.canceled) flash('error', sx.errExport(result?.error || ''));
        } catch (err) {
            flash('error', sx.errExport(err.message));
        }
    }, [design, evalMode, dStart, dEnd, dStep, dAoi, dQ, dSP, expFormat, sx]);
}
