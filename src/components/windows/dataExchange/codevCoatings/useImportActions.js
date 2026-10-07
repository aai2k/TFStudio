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

// The stack goes onto the front of the active design with the incident medium
// and the substrate it was entered with, as one undo step. Its materials are
// registered first, in the catalog named after the file. The status line adds
// what the conversion noted; what the reader noted is on the tab already.
function importStack({ z, flash, stack, fileName, filePath, design, checkpoint, updateDesign }) {
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
    const { catName, idOf } = registerCodevMaterials(converted.materials, fileName, filePath);
    checkpoint();
    updateDesign({
        incidentMedium: idOf[converted.incidentKey],
        substrate: { ...(design.substrate || {}), material: idOf[converted.substrateKey] },
        frontLayers: converted.layers.map(layer => ({
            material: idOf[layer.materialKey], thickness: layer.thickness, locked: layer.locked,
        })),
    });
    const notes = converted.warnings
        .filter(warning => !stack.warnings.includes(warning))
        .map(warning => warningText(z, warning));
    flash('success', [z.importedCoating(converted.layers.length, catName), ...notes].join(' '));
}

export function useLoadAction(args) {
    return useCallback(() => loadCodevFile(args), [args.z]);
}

export function useImportAction(args) {
    const { stack, fileName, filePath, design, checkpoint, updateDesign, z } = args;
    return useCallback(() => importStack(args), [stack, fileName, filePath, design, checkpoint, updateDesign, z]);
}
