import { LockIcon } from '../../../ui/LockIcon.js';
import { ContextMenu } from '../../../ui/ContextMenu.js';
import { tablerIcon } from '../../../ui/tablerIcons.js';
import { Btn } from './ui.js';
import { MenuButton } from '../../analysis/chrome/controls.js';
import { LayerRow } from './LayerRow.js';
import { useLayerKeyboard } from './useLayerKeyboard.js';
import { useLayerSelection } from './useLayerSelection.js';
import { useCellClipboard } from './useCellClipboard.js';
import { rangeColumnsForRow } from '../../../ui/grid/gridModel.js';
import {
    fixedLayerTrack, LAYER_TABLE, LAYER_TABLE_MIN_WIDTH, LAYER_THICKNESS_COLUMNS, thicknessColumnText,
    materialLayerTrack, nextThicknessCell,
} from './layerTableLayout.js';
import {
    readLayerClipboard, writeLayerClipboard, writeStackTableClipboard,
} from './layerClipboard.js';
import { useLayerDrag } from './useLayerDrag.js';
import { useLayerStep } from './useLayerStep.js';
import { useLayerRowEdits } from './useLayerRowEdits.js';
import { useThicknessStep } from './useThicknessStep.js';
import { designMaterialName } from '../../../../utils/materials/designMaterials.js';
import { useCatalogRevision } from '../../../../utils/materials/useCatalogRevision.js';
import { expandHerpinLayer, isHerpinLayer } from './layerTools.js';
import {
    HerpinDialog, PerturbDialog, QuantizeDialog, localizedHerpinError,
} from './LayerToolDialogs.js';
import { SaveCoatingDialog } from '../coatingLibrary/SaveCoatingDialog.js';

const { createElement: h, useRef, useCallback, useEffect, useMemo, useState } = React;

// ── Layer list panel (for one side) ──────────────────────────────────────────

// The Tools menu: every command is offered whatever is selected. Expand on a
// selection that is not a Herpin layer says what to select instead of doing
// nothing.
const LAYER_TOOLS = ['replaceMaterial', 'quantize', 'perturb', 'copyTable', 'saveToLibrary', 'herpinCollapse', 'herpinExpand'];
export function layerToolItems(de, run) {
    return LAYER_TOOLS.map(id => ({ id, label: de.tools[id], onSelect: () => run(id) }));
}

function missingReferenceStyle(id, missingMaterialIds, c, t) {
    if (!missingMaterialIds.has(id)) return { title: undefined, color: c.textDim };
    return { title: t.materialResolution.rowMissing(id), color: c.error };
}

function scrollLayerIntoView(container, id) {
    if (!container || !id) return;
    const row = [...container.querySelectorAll('[data-layer-id]')]
        .find(element => element.dataset.layerId === id);
    row?.scrollIntoView({ block: 'nearest' });
}

export function LayerList({ layers, side, design, updateDesign, missingMaterialIds, c,
    removeLayer, updateLayer,
    addLayerAtDisplayIndex, removeLayerAt, duplicateLayerAt,
    pasteLayersAtDisplayIndex, removeLayers, reorderLayers, moveLayersByStep,
    invertActiveSide, setAllLocked, copyToOther, onOpenReplaceMaterials,
    refLambda, isOptimizing, t }) {

    const de = t.designEditor;
    const layerToolText = de.layerTools;
    const containerRef = useRef(null);
    // The scrolling viewport inside the container, which drag auto-scroll moves.
    const scrollRef = useRef(null);
    const clipboardRef = useRef([]);
    const cellTextRef = useRef('');
    const [editRequest, setEditRequest] = useState({ rowId: null, unit: null, seed: null, token: 0 });
    const [contextMenu, setContextMenu] = useState(null);
    const [toolDialog, setToolDialog] = useState(null);
    const [toolNotice, setToolNotice] = useState('');
    const substrateWarning = missingReferenceStyle(
        design.substrate.material, missingMaterialIds, c, t);
    const boundaryMaterial = side === 'front' ? design.incidentMedium : design.exitMedium;
    const boundaryWarning = missingReferenceStyle(boundaryMaterial, missingMaterialIds, c, t);

    // Front coating is displayed substrate-first (reversed) so layer 1 is the one
    // touching the substrate, matching the back coating convention.
    const reversed = side === 'front';
    const displayedLayers = reversed ? [...layers].reverse() : layers;
    const selection = useLayerSelection({
        layers, displayedLayers, reversed, design, containerRef, reveal: scrollLayerIntoView,
    });
    const {
        selectedId, setSelectedId, selectedIds, selectOnly, selectRows,
        activeColumn, range, actionIds, rowsSelected, focusCell, selectAndFocus,
    } = selection;
    const selectedIdArray = useMemo(() => [...selectedIds], [selectedIds]);

    useEffect(() => {
        if (!toolNotice) return undefined;
        const timeoutId = setTimeout(() => setToolNotice(''), 4000);
        return () => clearTimeout(timeoutId);
    }, [toolNotice]);

    const { addLayerAt, addBelowSelection, deleteRows, deleteSelection } = useLayerRowEdits({
        side, reversed, displayedLayers, selectedId, selectedIds: actionIds, selectOnly,
        addLayerAtDisplayIndex, removeLayers, containerRef, reveal: scrollLayerIntoView,
    });

    // `seed`, when given, is the character that started the edit; the cell opens
    // holding it instead of the current value.
    const requestCellEdit = useCallback((rowId, unit, seed = null) => {
        setEditRequest(current => ({ rowId, unit, seed, token: current.token + 1 }));
    }, []);

    const navigateCell = useCallback((rowId, unit, direction) => {
        const destination = nextThicknessCell(displayedLayers, rowId, unit, direction);
        if (!destination) {
            containerRef.current?.focus();
            return;
        }
        focusCell(destination.rowId, destination.unit);
        requestCellEdit(destination.rowId, destination.unit);
        requestAnimationFrame(() => scrollLayerIntoView(containerRef.current, destination.rowId));
    }, [displayedLayers, focusCell, requestCellEdit]);
    const finishCellEditing = useCallback(() => containerRef.current?.focus(), []);

    const selectedLayers = useCallback(() => {
        const ids = selectedIds.size ? selectedIds : new Set(selectedId ? [selectedId] : []);
        return displayedLayers.filter(layer => ids.has(layer.id));
    }, [displayedLayers, selectedId, selectedIds]);

    const copyLayers = useCallback(copied => {
        if (!copied.length) return;
        clipboardRef.current = writeLayerClipboard(copied);
        cellTextRef.current = '';
    }, []);

    const copySelectedLayers = useCallback(() => copyLayers(selectedLayers()), [copyLayers, selectedLayers]);

    const materialName = useCallback(id => designMaterialName(design, id), [design]);

    const copyStackAsTable = useCallback(async () => {
        const copied = await writeStackTableClipboard(displayedLayers, materialName, {
            material: layerToolText.tableMaterial,
            thickness: layerToolText.tableThickness,
        });
        setToolNotice(copied
            ? layerToolText.copiedTable(displayedLayers.length)
            : layerToolText.clipboardBlocked);
    }, [displayedLayers, layerToolText, materialName]);

    const applyToolDesign = useCallback(nextDesign => {
        updateDesign(nextDesign);
        setToolDialog(null);
        setToolNotice(layerToolText.appliedUndo);
    }, [layerToolText, updateDesign]);

    const expandSelectedHerpin = useCallback(() => {
        const selected = displayedLayers.filter(layer => selectedIds.has(layer.id));
        if (selected.length !== 1 || !isHerpinLayer(selected[0])) {
            setToolNotice(layerToolText.selectHerpin);
            return;
        }
        try {
            applyToolDesign(expandHerpinLayer(design, side, selected[0].id));
        } catch (error) {
            setToolNotice(localizedHerpinError(error, t));
        }
    }, [applyToolDesign, design, displayedLayers, layerToolText, selectedIds, side, t]);

    const pasteAt = useCallback((displayIndex, sources) => {
        if (!sources?.length) return;
        const ids = pasteLayersAtDisplayIndex(side, displayIndex, sources, reversed);
        if (!ids?.length) return;
        selectRows(ids, ids[ids.length - 1]);
        requestAnimationFrame(() => scrollLayerIntoView(containerRef.current, ids[ids.length - 1]));
    }, [pasteLayersAtDisplayIndex, reversed, selectRows, side]);

    const pasteAfterSelection = useCallback(async () => {
        const sources = await readLayerClipboard(clipboardRef.current);
        const index = selectedId
            ? displayedLayers.findIndex(layer => layer.id === selectedId) + 1
            : displayedLayers.length;
        pasteAt(Math.max(0, index), sources);
    }, [displayedLayers, pasteAt, selectedId]);

    const cellClipboard = useCellClipboard({
        layers, displayedLayers, design, updateDesign, side, refLambda, materialName, selection, clipboardRef, cellTextRef,
        copyLayers: copySelectedLayers, pasteLayers: pasteAfterSelection, pasteAt,
    });

    const { dropIndicator, onPointerDownDrag } = useLayerDrag({
        displayedLayers, selectedIds, reorderLayers, reversed, side, selectRows, scrollRef, c,
    });

    const onMoveStepRow = useLayerStep({
        displayedLayers, selectedIds, selectOnly, moveLayersByStep,
        reversed, side, containerRef, reveal: scrollLayerIntoView,
    });

    const onThicknessStepRow = useThicknessStep({
        layers, side, design, updateDesign, selectedIds: actionIds, refLambda,
    });

    const closeContextMenu = useCallback(() => setContextMenu(null), []);
    const openContextMenu = useCallback((event, targetId = null) => {
        event.preventDefault();
        event.stopPropagation();
        const x = event.clientX;
        const y = event.clientY;
        const targets = targetId && selectedIds.has(targetId) && selectedIds.size > 1
            ? displayedLayers.filter(layer => selectedIds.has(layer.id)).map(layer => layer.id)
            : (targetId ? [targetId] : []);
        if (targetId && !selectedIds.has(targetId)) selectOnly(targetId);
        const requestId = Date.now() + Math.random();
        setContextMenu({ x, y, targetId, targetIds: targets, pasteLayers: clipboardRef.current, requestId });
        readLayerClipboard(clipboardRef.current).then(pasteLayers => {
            setContextMenu(current => current?.requestId === requestId
                ? { ...current, pasteLayers } : current);
        });
    }, [displayedLayers, selectOnly, selectedIds]);

    const insertFromContext = useCallback((below) => {
        const targetIndex = contextMenu?.targetId
            ? displayedLayers.findIndex(layer => layer.id === contextMenu.targetId)
            : displayedLayers.length;
        const displayIndex = contextMenu?.targetId
            ? Math.max(0, targetIndex + (below ? 1 : 0))
            : displayedLayers.length;
        addLayerAt(displayIndex, below ? 'above' : 'below');
    }, [addLayerAt, contextMenu, displayedLayers]);

    const deleteFromContext = useCallback(
        () => deleteRows(contextMenu?.targetIds || [], contextMenu?.targetId),
        [contextMenu, deleteRows]);

    const copyFromContext = useCallback(() => {
        const ids = new Set(contextMenu?.targetIds || []);
        copyLayers(displayedLayers.filter(layer => ids.has(layer.id)));
    }, [contextMenu, copyLayers, displayedLayers]);

    const pasteFromContext = useCallback((above = false) => {
        const index = contextMenu?.targetId
            ? displayedLayers.findIndex(layer => layer.id === contextMenu.targetId) + (above ? 0 : 1)
            : displayedLayers.length;
        pasteAt(Math.max(0, index), contextMenu?.pasteLayers || []);
    }, [contextMenu, displayedLayers, pasteAt]);

    // Keyboard row shortcuts (Ins / Shift+Ins / Del / Ctrl+D), cell moves and clipboard.
    const { onKeyDown: tableKeyDown } = useLayerKeyboard({
        layers, side, reversed, displayedLayers, selectedId, setSelectedId, containerRef,
        addLayerAt, removeLayerAt, deleteSelection, duplicateLayerAt,
        activeColumn, moveColumn: selection.moveColumn, collapseCells: selection.collapseCells,
        focusDisplayIndex: selection.focusDisplayIndex, requestCellEdit,
        onCopy: cellClipboard.copy, onPaste: cellClipboard.paste,
    });

    // Stable, id-passing row callbacks. Keeping these referentially stable (and
    // the `layer` object refs stable — DesignContext.updateLayer replaces only the
    // changed layer) is what lets React.memo skip every unchanged row.
    const onMaterialChangeRow  = useCallback((id, mat) => updateLayer(side, id, { material: mat }), [updateLayer, side]);
    const onThicknessChangeRow = useCallback((id, th)  => updateLayer(side, id, { thickness: th }), [updateLayer, side]);
    const onLockToggleRow      = useCallback((id, locked) => updateLayer(side, id, { locked: !locked }), [updateLayer, side]);
    const onRemoveRow          = useCallback(id => {
        removeLayer(side, id);
        selectOnly(null);
    }, [removeLayer, selectOnly, side]);

    // The whole row list, built once and memoized. Scrolling never re-runs this
    // (it changes no state) — the browser scrolls the DOM natively with zero React
    // work. It rebuilds only when the layers, selection, λ₀, theme or locale
    // actually change; even then React.memo on LayerRow skips every row whose own
    // props are unchanged (e.g. selection only re-renders the 2 affected rows).
    // No virtualization: a coating is a static list while you scroll, so we mount
    // it once rather than churning rows in/out of a viewport window.
    const catalogRevision = useCatalogRevision();
    const rowEls = useMemo(() => {
        const dl = reversed ? [...layers].reverse() : layers;
        return dl.map((layer, di) => h(LayerRow, {
            key: layer.id,
            layer, index: di,
            isSelected: rowsSelected && selectedIds.has(layer.id),
            onSelect: selectAndFocus,
            c,
            onMaterialChange: onMaterialChangeRow,
            onThicknessChange: onThicknessChangeRow,
            onThicknessStep: onThicknessStepRow,
            onLockToggle: onLockToggleRow,
            onRemove: onRemoveRow,
            onMoveStep: onMoveStepRow,
            canMoveUp: di > 0,
            canMoveDown: di < dl.length - 1,
            isMaterialMissing: missingMaterialIds.has(layer.material),
            activeColumn: layer.id === selectedId ? activeColumn : null,
            rangeColumns: rangeColumnsForRow(range, di),
            editRequestToken: editRequest.rowId === layer.id ? editRequest.token : 0,
            editRequestUnit: editRequest.rowId === layer.id ? editRequest.unit : null,
            editRequestSeed: editRequest.rowId === layer.id ? editRequest.seed : null,
            onActivateCell: focusCell,
            onNavigateCell: navigateCell,
            onFinishEditing: finishCellEditing,
            onContextMenu: openContextMenu,
            onPointerDownDrag,
            onPressCell: selection.pressCell,
            onDragOver: selection.dragOver,
            dropPosition: dropIndicator?.id === layer.id ? dropIndicator.position : null,
            refLambda, designMaterials: design.materials, catalogRevision, t,
        }));
    }, [layers, reversed, selectedId, selectedIds, rowsSelected, activeColumn, range, editRequest,
        dropIndicator, missingMaterialIds, refLambda, design.materials, catalogRevision, c, t,
        selectAndFocus, onMaterialChangeRow, onThicknessChangeRow, onThicknessStepRow,
        onLockToggleRow, onRemoveRow, onMoveStepRow,
        focusCell, navigateCell, finishCellEditing, openContextMenu, onPointerDownDrag]);

    const menuText = de.layerContextMenu;
    const pasteCount = contextMenu?.pasteLayers?.length || 0;
    const menuItems = contextMenu && (contextMenu.targetId
        ? [
            { id: 'insert-above', label: menuText.insertAbove, icon: 'row-insert-top', shortcut: 'Insert', onClick: () => insertFromContext(false) },
            { id: 'insert-below', label: menuText.insertBelow, icon: 'row-insert-bottom', shortcut: 'Shift+Insert', onClick: () => insertFromContext(true) },
            { separator: true },
            {
                id: 'copy', icon: 'copy', shortcut: 'Ctrl+C', onClick: copyFromContext,
                label: contextMenu.targetIds.length > 1
                    ? menuText.copySelected(contextMenu.targetIds.length) : menuText.copy,
            },
            {
                id: 'paste-above', label: menuText.pasteAbove(pasteCount), icon: 'clipboard',
                disabled: !pasteCount, onClick: () => pasteFromContext(true),
            },
            {
                id: 'paste-below', label: menuText.pasteBelow(pasteCount), icon: 'clipboard', shortcut: 'Ctrl+V',
                disabled: !pasteCount, onClick: () => pasteFromContext(false),
            },
            { separator: true },
            {
                id: 'delete', icon: 'trash', danger: true, shortcut: 'Delete', onClick: deleteFromContext,
                label: contextMenu.targetIds.length > 1
                    ? menuText.deleteSelected(contextMenu.targetIds.length) : menuText.delete,
            },
        ]
        : [
            { id: 'insert', label: menuText.insert, icon: 'row-insert-bottom', shortcut: 'Insert', onClick: () => insertFromContext(true) },
            {
                id: 'paste', label: menuText.pasteCount(pasteCount), icon: 'clipboard', shortcut: 'Ctrl+V',
                disabled: !pasteCount, onClick: () => pasteFromContext(false),
            },
        ]);

    return h('div', {
        ref: containerRef,
        tabIndex: 0,
        onKeyDown: tableKeyDown,
        style: { display: 'flex', flexDirection: 'column', height: '100%', outline: 'none' }
    },
        // Toolbar
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 6px', borderBottom: `1px solid ${c.border}`,
                backgroundColor: c.panel, flexShrink: 0, flexWrap: 'wrap'
            }
        },
            h(Btn, { onClick: addBelowSelection, c }, tablerIcon('plus', 13), de.addLayer),
            h('div', { style: { width: 1, height: 20, background: c.border, margin: '0 2px' } }),
            h(Btn, {
                onClick: () => invertActiveSide && invertActiveSide(),
                disabled: layers.length < 2, c,
                title: de.invertOrderTip
            }, de.invertOrder),
            h('div', { style: { width: 1, height: 20, background: c.border, margin: '0 2px' } }),
            (() => {
                const allLocked = layers.length > 0 && layers.every(l => l.locked);
                return h(Btn, {
                    onClick: () => setAllLocked && setAllLocked(side, !allLocked),
                    disabled: layers.length === 0, c,
                    title: allLocked ? de.unlockAllTip : de.lockAllTip
                }, h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
                    h(LockIcon, { locked: !allLocked, size: 12 }),
                    allLocked ? de.unlockAll : de.lockAll));
            })(),
            // Copy this side's stack to the other surface — moved here from the
            // top tab bar so that bar stays uncluttered when the window is narrow.
            h(Btn, {
                onClick: () => copyToOther && copyToOther(),
                title: side === 'front' ? de.copyToBack : de.copyToFront,
                c, style: { marginLeft: 4 }
            }, side === 'front' ? de.copyToBack : de.copyToFront),
            h('div', { style: { width: 1, height: 20, background: c.border, margin: '0 2px' } }),
            // Design-wide operations, each run when picked.
            h(MenuButton, {
                c, label: de.tools.label, title: de.tools.tip,
                items: layerToolItems(de, (action) => {
                    if (action === 'replaceMaterial') onOpenReplaceMaterials && onOpenReplaceMaterials();
                    else if (action === 'quantize') setToolDialog('quantize');
                    else if (action === 'perturb') setToolDialog('perturb');
                    else if (action === 'copyTable') copyStackAsTable();
                    else if (action === 'saveToLibrary') setToolDialog('saveToLibrary');
                    else if (action === 'herpinCollapse') {
                        if (selectedIds.size < 2) {
                            setToolNotice(layerToolText.errors.HERPIN_MIN_SELECTION);
                        } else {
                            setToolDialog('herpin');
                        }
                    }
                    else if (action === 'herpinExpand') expandSelectedHerpin();
                }),
            })
        ),

        toolNotice && h('div', {
            role: 'status', 'aria-live': 'polite', title: toolNotice,
            style: {
                flexShrink: 0, padding: '6px 10px',
                color: c.text, backgroundColor: c.accent + '24',
                borderBottom: `1px solid ${c.accent}88`,
                fontSize: 12, fontWeight: 600, lineHeight: 1.35,
            },
        }, toolNotice),

        // Header, boundary label and rows deliberately live in one scrolling
        // viewport. That gives every flex track the exact same available width,
        // including when a native vertical scrollbar appears on a long stack.
        h('div', {
            ref: scrollRef,
            onContextMenu: event => openContextMenu(event, null),
            style: {
                flex: 1, overflow: 'auto',
                padding: `0 ${LAYER_TABLE.scrollInset}px 2px`,
            }
        },
            h('div', {
                style: {
                    position: 'sticky', top: 0, zIndex: 2,
                    display: 'flex', alignItems: 'center', gap: LAYER_TABLE.gap,
                    padding: '2px 4px', marginBottom: 1,
                    minWidth: LAYER_TABLE_MIN_WIDTH, boxSizing: 'border-box',
                    borderLeft: '2px solid transparent',
                    color: c.textDim, fontSize: 11, userSelect: 'none',
                    borderBottom: `1px solid ${c.border}`, backgroundColor: c.panel,
                }
            },
                h('div', { style: fixedLayerTrack(LAYER_TABLE.numberWidth, { textAlign: 'right' }) }, de.colNum),
                h('div', { style: materialLayerTrack({
                    boxSizing: 'border-box', paddingLeft: LAYER_TABLE.materialTextInset,
                    whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                }) }, de.colMaterial),
                ...LAYER_THICKNESS_COLUMNS.map((column) => {
                    const text = thicknessColumnText(column, t.layerThicknesses);
                    return h('div', {
                        key: column.unit,
                        style: fixedLayerTrack(LAYER_TABLE.thicknessWidth, {
                            boxSizing: 'border-box', textAlign: 'right',
                            paddingRight: LAYER_TABLE.numericTextInset,
                        }),
                        title: text.title,
                    }, text.label);
                }),
                h('div', { style: fixedLayerTrack(LAYER_TABLE.lockWidth) }),
                h('div', { style: fixedLayerTrack(LAYER_TABLE.moveWidth) }),
                h('div', { style: fixedLayerTrack(LAYER_TABLE.actionsWidth) })
            ),

            // Substrate top label (both front reversed and back show substrate at top)
            h('div', {
                title: substrateWarning.title,
                style: { padding: '2px 4px', fontSize: 10,
                    color: substrateWarning.color, fontStyle: 'italic' },
            }, de.substrateTopLabel(materialName(design.substrate.material))),

            // Full list mounted once; scrolling is pure native scroll.
            displayedLayers.length === 0
                ? h('div', {
                    style: {
                        textAlign: 'center', color: c.textDim, fontSize: 12,
                        padding: '20px 0', fontStyle: 'italic'
                    }
                }, de.noLayers)
                : rowEls
        ),

        // Incident / exit bottom label
        h('div', {
            title: boundaryWarning.title,
            style: { padding: '2px 4px', fontSize: 10,
                color: boundaryWarning.color,
                fontStyle: 'italic', flexShrink: 0, borderTop: `1px solid ${c.border}` },
        },
            side === 'front'
                ? de.incidentBottomLabel(materialName(design.incidentMedium))
                : de.exitLabel(materialName(design.exitMedium))
        ),

        contextMenu && h(ContextMenu, {
            x: contextMenu.x, y: contextMenu.y, items: menuItems,
            c, onClose: closeContextMenu, ariaLabel: menuText.label,
        }),
        toolDialog === 'quantize' && h(QuantizeDialog, {
            design, side, c, t, hold: isOptimizing, onApply: applyToolDesign, onClose: () => setToolDialog(null),
        }),
        toolDialog === 'perturb' && h(PerturbDialog, {
            design, side, c, t, hold: isOptimizing, onApply: applyToolDesign, onClose: () => setToolDialog(null),
        }),
        toolDialog === 'herpin' && h(HerpinDialog, {
            design, side, selectedIds: selectedIdArray, c, t,
            onApply: applyToolDesign, onClose: () => setToolDialog(null),
        }),
        toolDialog === 'saveToLibrary' && h(SaveCoatingDialog, {
            design, side, c, t,
            onClose: () => setToolDialog(null),
            onSaved: name => setToolNotice(t.coatingLibrary.saveDialog.saved(name)),
        })
    );
}
