/**
 * Writing measured Ψ/Δ, or the design's own, to a file.
 */
import { calculatedDocument, measuredDocument } from './model.js';

const { useCallback } = React;

export function useExportActions({ design, curves, session, missingMaterialIds, flash, mx }) {
    const { expSelected = {}, expXUnit, expStart, expEnd, expStep, expAoi, side, deltaConvention } = session;

    const save = useCallback(async (document) => {
        if (!document.text) {
            flash('info', mx.nothingToExport);
            return;
        }
        try {
            const result = await window.electronAPI.spectrumSaveFile(document.text, document.fileName);
            if (result?.success) flash('success', mx.exported(result.filePath));
            else if (!result?.canceled) flash('error', mx.errExport(result?.error || ''));
        } catch (err) {
            flash('error', mx.errExport(err.message));
        }
    }, [flash, mx]);

    const onExportMeasured = useCallback(() => {
        const chosen = curves.filter(curve => expSelected[curve.id] !== false);
        return save(measuredDocument(design, { curves: chosen, xUnit: expXUnit }));
    }, [curves, expSelected, design, expXUnit, save]);

    const onExportCalculated = useCallback(() => {
        if (missingMaterialIds.length) {
            flash('error', mx.errMaterials(missingMaterialIds.join(', ')));
            return Promise.resolve();
        }
        return save(calculatedDocument(design, {
            lambdaStart: Number(expStart), lambdaEnd: Number(expEnd), lambdaStep: Number(expStep),
            thetaDeg: Number(expAoi), side, deltaConvention, xUnit: expXUnit,
        }));
    }, [design, expStart, expEnd, expStep, expAoi, side, deltaConvention, expXUnit,
        missingMaterialIds, flash, mx, save]);

    return { onExportMeasured, onExportCalculated };
}
