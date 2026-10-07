import { CodevParseError, parseCodevMul, parseCodevSeq } from '../../../../utils/io/codevCoatingFile.js';
import { registerCodevMaterials } from './catalogImport.js';
import { convertStack, libraryCoating } from './fileStack.js';
import { parseErrorText, warningText } from './messages.js';

const { useCallback } = React;

// A .mul is the file CODE V saves with SAV; anything else is read as commands.
const parserFor = (fileName) => (/\.mul$/i.test(fileName || '') ? parseCodevMul : parseCodevSeq);

// The text for a reader error about the file, or null for any other error.
const readFailure = (z, err) => (err instanceof CodevParseError ? parseErrorText(z, err) : null);

function readPicked(result, { z, flash, setFile }) {
    const fileName = result.fileName || '';
    const stack = parserFor(fileName)(result.text);
    setFile({ stack, fileName, filePath: result.filePath || '' });
    flash('success', z.loadedFile(fileName, stack.layers.length));
}

async function loadCodevFile({ z, flash, clear, setLoading, setFile }) {
    setLoading(true);
    clear();
    try {
        const result = await window.electronAPI.codevPickCoatingFile();
        if (result?.success) readPicked(result, { z, flash, setFile });
        else if (!result?.canceled) flash('error', z.errLoad(result?.error || ''));
    } catch (error) {
        flash('error', readFailure(z, error) || z.errLoad(error.message));
    }
    setLoading(false);
}

// The layers of the stack replace one coating of the active design, as one undo
// step; the design keeps its incident medium, exit medium and substrate. The
// file lists the layers incident side first, the order frontLayers are kept in.
// backLayers are kept substrate side first, so a back import is reversed: the
// file's incident medium faces the exit side. The materials the layers use are
// registered first, in the catalog named after the file, and Undo leaves them
// there; the file's INC and SUB are not registered unless a layer uses them too.
// The report adds what the conversion noted, and is then a warning, which stays
// until the next action rather than clearing itself; what the reader noted is
// in the window's notices already.
function importStack({ z, flash, stack, fileName, filePath, checkpoint, updateDesign }, side) {
    if (!stack) return;
    const converted = convertStack(z, stack, fileName);
    if (converted.error) {
        flash('error', converted.error);
        return;
    }
    const used = new Set(converted.layers.map(layer => layer.materialKey));
    const { catName, idOf } = registerCodevMaterials(
        converted.materials.filter(({ key }) => used.has(key)), fileName, filePath);
    const layers = converted.layers.map(layer => ({
        material: idOf[layer.materialKey], thickness: layer.thickness, locked: layer.locked,
    }));
    const back = side === 'back';
    checkpoint();
    updateDesign(back ? { backLayers: layers.reverse() } : { frontLayers: layers });
    const notes = converted.warnings
        .filter(warning => !stack.warnings.includes(warning))
        .map(warning => warningText(z, warning));
    const imported = back ? z.importedBack : z.importedFront;
    flash(notes.length ? 'warning' : 'success', [imported(layers.length, catName), ...notes].join(' '));
}

// The Save Coating dialog opens on the stack, or the report says why it cannot.
function openLibraryDialog({ stack, flash, setLibrary, ...args }) {
    if (!stack) return;
    const built = libraryCoating({ stack, ...args });
    if (built.error) {
        flash('error', built.error);
        return;
    }
    setLibrary(built.coating);
}

export function useLoadAction(args) {
    return useCallback(() => loadCodevFile(args), [args.z]);
}

/** The import as a function of the side, 'front' or 'back'. */
export function useImportAction(args) {
    const { stack, fileName, filePath, checkpoint, updateDesign, z } = args;
    return useCallback((side) => importStack(args, side), [stack, fileName, filePath, checkpoint, updateDesign, z]);
}

/** Open the Save Coating dialog on the stack read, or report why it cannot be saved. */
export function useLibraryAction(args) {
    const { stack, fileName, filePath, z } = args;
    return useCallback(() => openLibraryDialog(args), [stack, fileName, filePath, z]);
}
