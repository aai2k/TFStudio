import { getCatalogs } from '../../../../utils/materials/catalogManager.js';
import {
    designMaterialLookup, isBuiltinId, resolveDesignMaterial, UnresolvedDesignMaterialError,
} from '../../../../utils/materials/designMaterials.js';
import {
    buildGrid, generateZemaxCoating, tfLayersToCoat, tfMaterialToMate,
} from '../../../../utils/io/zemaxCoatingFile.js';
import { collectExportMaterialIds, makeZemaxNameResolver } from './model.js';
import { useAfterRefreshAll } from '../../../../state/refreshAll.js';

const { useCallback } = React;

// A built-in material stored bare ('TiO2', as synthesis inserts it and old
// files have it) is the one the catalogs list as 'builtin:TiO2'. Both spellings
// get one MATE record and one name.
const canonicalId = (id) => (!id.includes(':') && isBuiltinId(id) ? `builtin:${id}` : id);

// The ids to write a MATE record for. Scope "all" adds the materials the design
// carries itself (from another computer, a deleted catalog, a Herpin layer) to
// the catalogs' ones, since its layers are written too. A catalog entry with no
// n,k here (an empty table) is left out unless the design uses it: it cannot be
// written, and the design does not need it.
function exportMaterialIds(design, scope) {
    const used = [...new Set(collectExportMaterialIds(design, 'used').map(canonicalId))];
    if (scope !== 'all') return used;
    const own = used.filter(id => resolveDesignMaterial(design, id).status !== 'catalog');
    const catalogs = collectExportMaterialIds(design, 'all', getCatalogs())
        .filter(id => used.includes(id) || resolveDesignMaterial(design, id).status !== 'missing');
    return [...new Set([...catalogs, ...own])];
}

// Every material is resolved through the design, the way the design computes
// it: the catalog here first, then the definition the design carries. An id
// that resolves nowhere throws UnresolvedDesignMaterialError rather than being
// written as n = 1, k = 0.
function buildCoatingText({ design, gStart, gEnd, gStep, scope, coatName, thMode, refNm }) {
    const lookup = designMaterialLookup(design);
    const grid = buildGrid(gStart, gEnd, gStep);
    const nameOf = makeZemaxNameResolver((id) => lookup(id).name || id);
    const zemaxName = (id) => nameOf(canonicalId(id));
    const materials = exportMaterialIds(design, scope).map((id) =>
        tfMaterialToMate(zemaxName(id), (wavelengthNm) => lookup(id).getNK(wavelengthNm), grid));
    const coating = tfLayersToCoat(coatName, design.frontLayers, {
        zemaxName,
        mode: thMode,
        refWavelengthUm: refNm / 1000,
        realIndex: (id, wavelengthNm) => lookup(id).getNK(wavelengthNm)[0],
    });
    return { text: generateZemaxCoating({ materials, coatings: [coating] }), materials, coating };
}

function generatePreview(args) {
    const { z, flash, design, setPreview } = args;
    if (!(design.frontLayers || []).length) {
        flash('error', z.nothingToExport);
        setPreview('');
        return;
    }
    let built;
    try {
        built = buildCoatingText(args);
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
