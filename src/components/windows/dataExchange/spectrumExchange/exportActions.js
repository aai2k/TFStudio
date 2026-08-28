import { computeDesignSpectrum } from '../../../../utils/io/designSpectrum.js';
import {
    designExportBaseName,
    designExportDocument,
    designExportSelection,
    measuredExportDocument,
} from './model.js';

const { useCallback } = React;

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
            const spectrum = computeDesignSpectrum(design, params, evalMode);
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
