import { applyLayers } from './layerActions.js';
import { parseLayers, readClipboardText, writeClipboardText } from './layerClipboard.js';
import { copiedCellText, isCellColumn, pastedEdits, withEdits } from './layerCells.js';
import { pastedMaterialId } from './pastedMaterial.js';

/**
 * Ctrl+C and Ctrl+V on the layer table.
 *
 * With the focus on the row number they copy and paste whole layers
 * (`copyLayers`, `pasteLayers`), as they do with no row focused. With the focus
 * on a cell (layerCells.js) Ctrl+C copies the selected cells as text, and
 * Ctrl+V lays pasted text over them as material names and thicknesses in one
 * design update, so one Ctrl+Z takes a paste back. Layers copied as layers and
 * pasted on cells go in as layers below the focused row, rectangle or not:
 * laid over cells, their lock column would land in a thickness column as a
 * thickness of 0 or 1.
 *
 *   selection     { selectedId, activeColumn, range }
 *   clipboardRef  the in-app copy of layers, and `cellTextRef` that of cells:
 *                 a browser can refuse a page the clipboard, and the table's
 *                 own last copy is pasted then. A copy of either empties the
 *                 other, so the one pasted is the one copied last.
 *   pasteAt(displayIndex, layers)  inserts copied layers at a table row
 */
export function useCellClipboard({ layers, displayedLayers, design, updateDesign, side, refLambda, materialName,
    selection, clipboardRef, cellTextRef, copyLayers, pasteLayers, pasteAt }) {
    const { selectedId, activeColumn, range } = selection;
    const onCells = !!selectedId && isCellColumn(activeColumn);
    const focus = { id: selectedId, column: activeColumn };
    const view = {
        refLambda, designMaterials: design.materials, materialName,
        materialFor: text => pastedMaterialId(design, text),
    };

    const copy = () => {
        if (!onCells) { copyLayers(); return; }
        const text = copiedCellText(displayedLayers, { range, focus }, view);
        if (!text) return;
        clipboardRef.current = [];
        cellTextRef.current = text;
        writeClipboardText(text);
    };

    const paste = async () => {
        if (!onCells) { pasteLayers(); return; }
        const text = (await readClipboardText()) ?? cellTextRef.current;
        const copied = parseLayers(text);
        if (copied.length || !text) {
            const index = displayedLayers.findIndex(layer => layer.id === selectedId);
            pasteAt(index + 1, copied.length ? copied : clipboardRef.current);
            return;
        }
        const next = withEdits(layers, pastedEdits(displayedLayers, text, { ...view, range, focus }));
        if (next) applyLayers(design, updateDesign, side, next);
    };

    return { copy, paste };
}
