import { getNKById } from '../../../../utils/materials/catalogManager.js';
import { coatToTfLayers, parseZemaxCoating } from '../../../../utils/io/zemaxCoatingFile.js';
import { applyImportedLayers, registerMaterials } from './model.js';

const { useCallback } = React;

async function loadCoatingFile({ z, flash, setLoading, setStatus, setDoc, setFileName, setSelCoating, setSelMats }) {
    setLoading(true);
    setStatus(null);
    try {
        const result = await window.electronAPI.zemaxPickCoatingFile();
        if (!result?.success) {
            if (!result?.canceled) flash('error', z.errLoad(result?.error || ''));
            setLoading(false);
            return;
        }
        const parsed = parseZemaxCoating(result.text);
        if (!parsed.materials.length && !parsed.coatings.length) {
            flash('error', z.errParse);
            setLoading(false);
            return;
        }
        setDoc(parsed);
        setFileName(result.fileName || 'COATING.DAT');
        setSelCoating(parsed.coatings.findIndex((coating) => coating.type === 'layers'));
        setSelMats(new Set());
        flash('success', z.loadedFile(result.fileName || ''));
    } catch (error) {
        flash('error', z.errLoad(error.message));
    }
    setLoading(false);
}

function importSelectedCoating({ z, flash, doc, selCoating, fileName, refNm, checkpoint, updateDesign }) {
    const coating = doc?.coatings?.[selCoating];
    if (!coating || coating.type !== 'layers') {
        flash('error', z.importNotStack);
        return;
    }

    const neededNames = new Set(coating.layers.map((layer) => layer.material.toUpperCase()));
    const { catName, nameMap } = registerMaterials(doc.materials, fileName, neededNames);
    const resolveId = (zemaxName) => nameMap[zemaxName.toUpperCase()] || (/^AIR$/i.test(zemaxName) ? 'Air' : null);
    const { layers, warnings } = coatToTfLayers(coating, {
        refWavelengthUm: refNm / 1000,
        materialId: resolveId,
        realIndex: (zemaxName, wavelengthNm) => {
            const id = resolveId(zemaxName);
            return id ? getNKById(id, wavelengthNm)[0] : 0;
        },
    });
    if (!layers.length) {
        flash('error', warnings[0] || z.importNotStack);
        return;
    }

    applyImportedLayers(layers, checkpoint, updateDesign);
    flash('success', z.importedCoating(coating.name, layers.length) + (catName ? '' : '') + (warnings.length ? ` (${z.warningsN(warnings.length)})` : ''));
}

function importSelectedMaterials({ z, flash, doc, selMats, fileName }, all) {
    if (!doc?.materials?.length) return;
    const onlyNames = all ? null : selMats;
    if (!all && (!onlyNames || onlyNames.size === 0)) {
        flash('error', z.noSelection);
        return;
    }
    const { catName, count } = registerMaterials(doc.materials, fileName, all ? null : onlyNames);
    flash('success', z.importedMaterials(count, catName));
}

export function useLoadAction(args) {
    return useCallback(() => loadCoatingFile(args), [args.z]);
}

export function useCoatingImportAction(args) {
    const { doc, selCoating, fileName, refNm, checkpoint, updateDesign, z } = args;
    return useCallback(() => importSelectedCoating(args), [doc, selCoating, fileName, refNm, checkpoint, updateDesign, z]);
}

export function useMaterialImportAction(args) {
    const { doc, selMats, fileName, z } = args;
    return useCallback((all) => importSelectedMaterials(args, all), [doc, selMats, fileName, z]);
}
