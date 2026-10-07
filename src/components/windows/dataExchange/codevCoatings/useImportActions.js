import {
    codevStackToDesign, CodevParseError, parseCodevMul, parseCodevSeq,
} from '../../../../utils/io/codevCoatingFile.js';
import { registerCodevMaterials } from './catalogImport.js';
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

async function loadCodevFile({ z, flash, setLoading, setStatus, setFile }) {
    setLoading(true);
    setStatus(null);
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
// The status line adds what the conversion noted; what the reader noted is on
// the tab already.
function importStack({ z, flash, stack, fileName, filePath, checkpoint, updateDesign }, side) {
    if (!stack) return;
    let converted;
    try {
        converted = codevStackToDesign(stack, { sourceName: fileName });
    } catch (err) {
        const message = readFailure(z, err);
        if (message === null) throw err;
        flash('error', message);
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
    flash('success', [imported(layers.length, catName), ...notes].join(' '));
}

export function useLoadAction(args) {
    return useCallback(() => loadCodevFile(args), [args.z]);
}

/** The import as a function of the side, 'front' or 'back'. */
export function useImportAction(args) {
    const { stack, fileName, filePath, checkpoint, updateDesign, z } = args;
    return useCallback((side) => importStack(args, side), [stack, fileName, filePath, checkpoint, updateDesign, z]);
}
