import { UnresolvedDesignMaterialError } from '../../../../utils/materials/designMaterials.js';
import { buildCoatingText } from './model.js';
import { useAfterRefreshAll } from '../../../../state/refreshAll.js';

const { useCallback } = React;

// The window writes the front coating.
function generatePreview(args) {
    const { z, flash, design, setPreview } = args;
    if (!(design.frontLayers || []).length) {
        flash('error', z.nothingToExport);
        setPreview('');
        return;
    }
    let built;
    try {
        built = buildCoatingText({ ...args, side: 'front' });
    } catch (err) {
        if (!(err instanceof UnresolvedDesignMaterialError)) throw err;
        flash('error', z.exportUnresolved(err.materialId));
        setPreview('');
        return;
    }
    setPreview(built.text);
    flash('success', z.generated(built.materials.length, built.coating.layers.length));
}

async function savePreview({ z, flash, preview }) {
    if (!preview) return;
    try {
        const result = await window.electronAPI.zemaxSaveCoatingFile(preview, 'COATING.DAT');
        if (result?.success) flash('success', z.savedFile(result.filePath));
        else if (!result?.canceled) flash('error', z.errSave(result?.error || ''));
    } catch (error) {
        flash('error', z.errSave(error.message));
    }
}

export function useGenerateAction(args) {
    const { design, gStart, gEnd, gStep, scope, coatName, thMode, refNm, z } = args;
    // A generated text on screen is generated again after Refresh all, from
    // the files just read.
    useAfterRefreshAll(() => {
        if (args.preview) generatePreview(args);
    });
    return useCallback(() => generatePreview(args), [design, gStart, gEnd, gStep, scope, coatName, thMode, refNm, z]);
}

export function useSaveAction(args) {
    const { preview, z } = args;
    return useCallback(() => savePreview(args), [preview, z]);
}
