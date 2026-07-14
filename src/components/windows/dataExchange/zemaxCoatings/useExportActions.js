import { getCatalogs, getMaterialById, getNKById } from '../../../../utils/materials/catalogManager.js';
import {
    buildGrid, generateZemaxCoating, tfLayersToCoat, tfMaterialToMate,
} from '../../../../utils/io/zemaxCoatingFile.js';
import { collectExportMaterialIds, makeZemaxNameResolver } from './model.js';

const { useCallback } = React;

function generatePreview(args) {
    const {
        z, flash, design, gStart, gEnd, gStep, scope, coatName, thMode,
        refNm, setPreview,
    } = args;
    const frontLayers = design.frontLayers || [];
    if (!frontLayers.length) {
        flash('error', z.nothingToExport);
        setPreview('');
        return;
    }

    const grid = buildGrid(gStart, gEnd, gStep);
    const catalogs = scope === 'all' ? getCatalogs() : undefined;
    const materialIds = collectExportMaterialIds(design, scope, catalogs);
    const zemaxName = makeZemaxNameResolver((id) => getMaterialById(id)?.name || id);
    const materials = materialIds.map((id) =>
        tfMaterialToMate(zemaxName(id), (wavelengthNm) => getNKById(id, wavelengthNm), grid));
    const coating = tfLayersToCoat(coatName, frontLayers, {
        zemaxName,
        mode: thMode,
        refWavelengthUm: refNm / 1000,
        realIndex: (id, wavelengthNm) => getNKById(id, wavelengthNm)[0],
    });
    const text = generateZemaxCoating({ materials, coatings: [coating] });
    setPreview(text);
    flash('success', `${materials.length} MATE · ${coating.layers.length} layers`);
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
    return useCallback(() => generatePreview(args), [design, gStart, gEnd, gStep, scope, coatName, thMode, refNm, z]);
}

export function useSaveAction(args) {
    const { preview, z } = args;
    return useCallback(() => savePreview(args), [preview, z]);
}
