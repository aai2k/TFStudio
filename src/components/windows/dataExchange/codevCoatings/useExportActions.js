import { CodevExportError, CODEV_LIMITS } from '../../../../utils/io/codevCoatingFile.js';
import { UnresolvedDesignMaterialError } from '../../../../utils/materials/designMaterials.js';
import { analysisWavelengths, buildDesignSeq, sideStack } from './exportModel.js';
import { exportErrorText } from './messages.js';
import { useAfterRefreshAll } from '../../../../state/refreshAll.js';

const { useCallback } = React;

// The text for a build that failed on the design's data, or null for an error
// that is a fault of the program and has to surface as one.
function buildFailure(z, err) {
    if (err instanceof UnresolvedDesignMaterialError) return z.exportUnresolved(err.materialId);
    if (err instanceof CodevExportError) return exportErrorText(z, err);
    return null;
}

function tryBuild({ z, design, side, title, saveName, anglesDeg, refNm }, wavelengthsNm, fail) {
    try {
        return buildDesignSeq(design, { side, title, saveName, wavelengthsNm, anglesDeg, refNm });
    } catch (err) {
        const message = buildFailure(z, err);
        if (message === null) throw err;
        fail(message);
        return null;
    }
}

function generatePreview(args) {
    const { z, flash, design, side, gStart, gEnd, gStep, setExport } = args;
    const fail = (message) => { flash('error', message); setExport('', []); };
    const layerCount = sideStack(design, side).layers.length;
    if (!layerCount) { fail(side === 'back' ? z.nothingToExportBack : z.nothingToExportFront); return; }
    const { count, wavelengthsNm } = analysisWavelengths(gStart, gEnd, gStep);
    if (!wavelengthsNm) { fail(z.errTooManyWavelengths(count, CODEV_LIMITS.wavelengths)); return; }
    const built = tryBuild(args, wavelengthsNm, fail);
    if (!built) return;
    setExport(built.text, built.warnings);
    flash('success', z.generated(layerCount, built.warnings.length));
}

// The name the SAV line gives the .mul, so the .seq is offered under the same one.
const savName = (text) => (/^SAV (\S+)/m.exec(text) || [])[1] || 'coating';

async function savePreview({ z, flash, preview }) {
    if (!preview) return;
    try {
        const result = await window.electronAPI.codevSaveCoatingFile(preview, `${savName(preview)}.seq`);
        if (result?.success) flash('success', z.savedFile(result.filePath));
        else if (!result?.canceled) flash('error', z.errSave(result?.error || ''));
    } catch (error) {
        flash('error', z.errSave(error.message));
    }
}

export function useGenerateAction(args) {
    const { design, side, title, saveName, gStart, gEnd, gStep, anglesDeg, refNm, z } = args;
    // A generated text on screen is generated again after Refresh all, from
    // the files just read.
    useAfterRefreshAll(() => {
        if (args.preview) generatePreview(args);
    });
    return useCallback(() => generatePreview(args),
        [design, side, title, saveName, gStart, gEnd, gStep, anglesDeg, refNm, z]);
}

export function useSaveAction(args) {
    const { preview, z } = args;
    return useCallback(() => savePreview(args), [preview, z]);
}
