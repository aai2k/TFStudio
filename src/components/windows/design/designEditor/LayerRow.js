import { MaterialPicker } from '../../../ui/MaterialPicker.js';
import { LockIcon } from '../../../ui/LockIcon.js';
import { ThicknessCell } from './ThicknessCell.js';
import { IconBtn } from './ui.js';
import {
    fixedLayerTrack, LAYER_TABLE, LAYER_TABLE_MIN_WIDTH, LAYER_THICKNESS_COLUMNS,
    materialLayerTrack,
} from './layerTableLayout.js';

const { createElement: h } = React;

// ── Layer row ─────────────────────────────────────────────────────────────────

// Fixed, uniform row height (px). Inner controls are 22px + 2px×2 padding = 26.
const LAYER_ROW_H = 26;

// Memoized so that any parent re-render (e.g. window resize, or editing one row
// in a 500-layer stack) only re-renders rows whose own props actually
// changed. Handlers are id-passing and stabilized with useCallback in LayerList,
// and `layer` keeps a stable object reference, so untouched rows are skipped
// entirely — and scrolling, which changes no props, never re-renders any row.
// `designMaterials` is the design's `materials` block rather than the design
// itself for the same reason: it changes only when a definition does.
export const LayerRow = React.memo(function LayerRow({ layer, index, isSelected, onSelect, c,
    onMaterialChange, onThicknessChange, onLockToggle, onRemove,
    isMaterialMissing, activeUnit, editRequestToken, editRequestUnit, editRequestSeed,
    onActivateCell, onNavigateCell, onFinishEditing, onContextMenu,
    onPointerDownDrag, dropPosition,
    refLambda, designMaterials, t }) {

    const de = t.designEditor;
    const missingTitle = isMaterialMissing ? t.materialResolution.rowMissing(layer.material) : undefined;

    return h('div', {
        onClick: event => onSelect(layer.id, event),
        onContextMenu: event => onContextMenu(event, layer.id),
        'data-layer-id': layer.id,
        title: missingTitle,
        'data-material-missing': isMaterialMissing ? 'true' : undefined,
        style: {
            display: 'flex', alignItems: 'center', gap: LAYER_TABLE.gap,
            padding: '2px 4px',
            // Fixed height (border-box) so the virtualized list can compute row
            // positions exactly — see LAYER_ROW_H in LayerList.
            height: LAYER_ROW_H, minWidth: LAYER_TABLE_MIN_WIDTH, boxSizing: 'border-box',
            backgroundColor: isMaterialMissing ? c.error + '18'
                : (isSelected ? c.accent + '22' : 'transparent'),
            borderRadius: 3, cursor: 'pointer', userSelect: 'none',
            borderLeft: `2px solid ${isMaterialMissing ? c.error : (isSelected ? c.accent : 'transparent')}`,
            boxShadow: dropPosition === 'before' ? `inset 0 2px 0 ${c.accent}`
                : dropPosition === 'after' ? `inset 0 -2px 0 ${c.accent}` : 'none',
        }
    },
        h('div', {
            style: fixedLayerTrack(LAYER_TABLE.numberWidth, {
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                textAlign: 'right', fontSize: 11,
                color: isMaterialMissing ? c.error : c.textDim,
            }),
        },
            h('span', {
                title: de.dragLayer || 'Drag to reorder',
                'aria-label': de.dragLayer || 'Drag to reorder',
                onClick: event => event.stopPropagation(),
                onPointerDown: event => onPointerDownDrag(layer.id, event),
                style: {
                    width: 8, overflow: 'hidden', cursor: 'grab',
                    color: c.textDim, fontSize: 10, letterSpacing: -2,
                    touchAction: 'none',
                },
            }, '⠿'),
            h('span', null, isMaterialMissing ? `${index + 1}!` : index + 1),
        ),
        h('div', { style: materialLayerTrack() },
            h(MaterialPicker, { value: layer.material, onChange: (mat) => onMaterialChange(layer.id, mat), c, t, compact: true })
        ),
        ...LAYER_THICKNESS_COLUMNS.map(column => h('div', {
            key: column.unit,
            style: fixedLayerTrack(LAYER_TABLE.thicknessWidth),
        },
            h(ThicknessCell, {
                value_nm: layer.thickness,
                onChange: thickness => onThicknessChange(layer.id, thickness),
                locked: layer.locked, c, materialId: layer.material, refLambda, designMaterials,
                unit: column.unit, primary: column.primary,
                active: activeUnit === column.unit,
                editRequest: editRequestUnit === column.unit ? editRequestToken : 0,
                editSeed: editRequestUnit === column.unit ? editRequestSeed : null,
                onActivate: event => {
                    if (!event?.ctrlKey && !event?.metaKey && !event?.shiftKey) {
                        onActivateCell(layer.id, column.unit);
                    }
                },
                onNavigate: direction => onNavigateCell(layer.id, column.unit, direction),
                onExit: onFinishEditing,
            }),
        )),
        h('button', {
            title: layer.locked ? de.unlock : de.lock,
            onClick: (e) => { e.stopPropagation(); onLockToggle(layer.id, layer.locked); },
            style: {
                ...fixedLayerTrack(LAYER_TABLE.lockWidth),
                height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: 'none', borderRadius: 3, backgroundColor: 'transparent',
                color: layer.locked ? c.accent : c.textDim, cursor: 'pointer',
                fontSize: 13, outline: 'none', flexShrink: 0
            }
        }, h(LockIcon, { locked: layer.locked, size: 13 })),
        h('div', { style: fixedLayerTrack(LAYER_TABLE.actionsWidth) },
            h(IconBtn, {
                onClick: event => { event.stopPropagation(); onRemove(layer.id); },
                title: de.remove, c,
            }, '×'),
        )
    );
});
