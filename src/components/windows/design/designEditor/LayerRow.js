import { MaterialPicker } from '../../../ui/MaterialPicker.js';
import { LockIcon } from '../../../ui/LockIcon.js';
import { ThicknessCell } from './ThicknessCell.js';
import { IconBtn } from './ui.js';

const { createElement: h } = React;

// ── Layer row ─────────────────────────────────────────────────────────────────

// Fixed, uniform row height (px). Inner controls are 22px + 2px×2 padding = 26.
const LAYER_ROW_H = 26;

// Memoized so that any parent re-render (e.g. window resize, or editing one row
// in a 500-layer stack) only re-renders rows whose own props actually
// changed. Handlers are id-passing and stabilized with useCallback in LayerList,
// and `layer` keeps a stable object reference, so untouched rows are skipped
// entirely — and scrolling, which changes no props, never re-renders any row.
export const LayerRow = React.memo(function LayerRow({ layer, index, isSelected, onSelect, c,
    onMaterialChange, onThicknessChange, onLockToggle,
    onMoveUp, onMoveDown, onDuplicate, onRemove, canMoveUp, canMoveDown,
    refLambda, t }) {

    const de = t.designEditor;

    return h('div', {
        onClick: () => onSelect(layer.id),
        style: {
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '2px 4px',
            // Fixed height (border-box) so the virtualized list can compute row
            // positions exactly — see LAYER_ROW_H in LayerList.
            height: LAYER_ROW_H, boxSizing: 'border-box',
            backgroundColor: isSelected ? c.accent + '22' : 'transparent',
            borderRadius: 3, cursor: 'pointer', userSelect: 'none',
            borderLeft: `2px solid ${isSelected ? c.accent : 'transparent'}`
        }
    },
        h('div', { style: { width: 24, textAlign: 'right', fontSize: 11, color: c.textDim, flexShrink: 0 } }, index + 1),
        h('div', { style: { flex: 1, minWidth: 0, overflow: 'hidden' } },
            h(MaterialPicker, { value: layer.material, onChange: (mat) => onMaterialChange(layer.id, mat), c, t, compact: true })
        ),
        h('div', { style: { width: 70, flexShrink: 0 } },
            h(ThicknessCell, { value_nm: layer.thickness, onChange: (th) => onThicknessChange(layer.id, th), locked: layer.locked, c,
                materialId: layer.material, refLambda, unit: 'nm', primary: true })
        ),
        h('div', { style: { width: 58, flexShrink: 0 } },
            h(ThicknessCell, { value_nm: layer.thickness, onChange: (th) => onThicknessChange(layer.id, th), locked: layer.locked, c,
                materialId: layer.material, refLambda, unit: 'OT' })
        ),
        h('div', { style: { width: 50, flexShrink: 0 } },
            h(ThicknessCell, { value_nm: layer.thickness, onChange: (th) => onThicknessChange(layer.id, th), locked: layer.locked, c,
                materialId: layer.material, refLambda, unit: 'QWOT' })
        ),
        h('div', { style: { width: 50, flexShrink: 0 } },
            h(ThicknessCell, { value_nm: layer.thickness, onChange: (th) => onThicknessChange(layer.id, th), locked: layer.locked, c,
                materialId: layer.material, refLambda, unit: 'FWOT' })
        ),
        h('button', {
            title: layer.locked ? de.unlock : de.lock,
            onClick: (e) => { e.stopPropagation(); onLockToggle(layer.id, layer.locked); },
            style: {
                width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: 'none', borderRadius: 3, backgroundColor: 'transparent',
                color: layer.locked ? c.accent : c.textDim, cursor: 'pointer',
                fontSize: 13, outline: 'none', flexShrink: 0
            }
        }, h(LockIcon, { locked: layer.locked, size: 13 })),
        h('div', { style: { display: 'flex', gap: 1, marginLeft: 2 } },
            h(IconBtn, { onClick: (e) => { e.stopPropagation(); onMoveUp(layer.id); }, disabled: !canMoveUp, title: de.moveUpRow, c }, '↑'),
            h(IconBtn, { onClick: (e) => { e.stopPropagation(); onMoveDown(layer.id); }, disabled: !canMoveDown, title: de.moveDownRow, c }, '↓'),
            h(IconBtn, { onClick: (e) => { e.stopPropagation(); onDuplicate(layer.id); }, title: de.duplicate, c }, '⎘'),
            h(IconBtn, { onClick: (e) => { e.stopPropagation(); onRemove(layer.id); }, title: de.remove, c }, '×')
        )
    );
});
