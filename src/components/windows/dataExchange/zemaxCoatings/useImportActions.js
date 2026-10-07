import { parseZemaxCoating } from '../../../../utils/io/zemaxCoatingFile.js';
import { applyImportedLayers } from './model.js';
import { buildMaterialRegistration, registerMaterials } from './catalogImport.js';
import { convertSelectedCoating, libraryCoating } from './coatingLayers.js';

const { useCallback } = React;

// A new file replaces the old one, with its first layer stack selected on the
// Coatings tab and no row checked on the Materials tab.
async function loadCoatingFile({ z, flash, clear, setLoading, setFile }) {
    setLoading(true);
    clear();
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
        setFile({
            doc: parsed,
            fileName: result.fileName || 'COATING.DAT',
            filePath: result.filePath || '',
            selCoating: parsed.coatings.findIndex((coating) => coating.type === 'layers'),
            selRows: new Set(),
        });
        flash('success', z.loadedFile(result.fileName || ''));
    } catch (error) {
        flash('error', z.errLoad(error.message));
    }
    setLoading(false);
}

/** What the conversion noted, as a count to put after a report. */
export const warningsSuffix = (z, warnings) => (warnings.length ? ` (${z.warningsN(warnings.length)})` : '');

function importSelectedCoating(args) {
    const { z, flash, checkpoint, updateDesign } = args;
    const converted = convertSelectedCoating(args, { write: true });
    if (converted.error) {
        flash('error', converted.error);
        return;
    }
    const { coating, layers, warnings, registration } = converted;
    applyImportedLayers(layers, checkpoint, updateDesign);
    flash('success', z.importedCoating(coating.name, layers.length, registration.catName) + warningsSuffix(z, warnings));
}

// The dialog opens on the coating; what the conversion noted is reported once
// the coating is saved.
function openLibraryDialog(args) {
    const built = libraryCoating(args);
    if (built.error) {
        args.flash('error', built.error);
        return;
    }
    args.setLibraryCoating(built);
}

// A material the catalog holds in a form that differs from the file's, most
// often after an edit in the Material Editor, is replaced only when the user
// says so; Cancel imports nothing. The selection is a set of rows of the
// Materials tab, so each record of a repeated name is imported on its own.
function importSelectedMaterials({ z, flash, doc, selRows, fileName, filePath, setInputDialog }, all) {
    if (!doc?.materials?.length) return;
    const rows = all ? null : selRows;
    if (!all && (!rows || rows.size === 0)) {
        flash('error', z.noSelection);
        return;
    }
    const commit = () => {
        const { catName, count } = registerMaterials(doc.materials, fileName, rows, filePath, { replaceChanged: true });
        flash('success', z.importedMaterials(count, catName));
    };
    const { changed, catName } = buildMaterialRegistration(doc.materials, fileName, rows, filePath);
    if (changed.length === 0) { commit(); return; }
    setInputDialog({
        confirm: true, danger: true,
        title: z.replaceTitle,
        message: z.replaceChanged(catName, changed.join(', ')),
        confirmLabel: z.replaceButton,
        onConfirm: () => { setInputDialog(null); commit(); },
        onCancel: () => setInputDialog(null),
    });
}

export function useLoadAction(args) {
    return useCallback(() => loadCoatingFile(args), [args.z]);
}

export function useCoatingImportAction(args) {
    const { doc, selCoating, fileName, filePath, refNm, checkpoint, updateDesign, z } = args;
    return useCallback(() => importSelectedCoating(args), [doc, selCoating, fileName, filePath, refNm, checkpoint, updateDesign, z]);
}

/** Open the Save Coating dialog on the selected COAT, or report why it cannot be saved. */
export function useLibraryAction(args) {
    const { doc, selCoating, fileName, filePath, refNm, design, z } = args;
    return useCallback(() => openLibraryDialog(args), [doc, selCoating, fileName, filePath, refNm, design, z]);
}

export function useMaterialImportAction(args) {
    const { doc, selRows, fileName, filePath, setInputDialog, z } = args;
    return useCallback((all) => importSelectedMaterials(args, all), [doc, selRows, fileName, filePath, setInputDialog, z]);
}
