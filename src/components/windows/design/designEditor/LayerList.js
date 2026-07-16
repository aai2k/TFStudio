import { LockIcon } from '../../../ui/LockIcon.js';
import { Btn } from './ui.js';
import { LayerRow } from './LayerRow.js';
import { useLayerKeyboard } from './useLayerKeyboard.js';

const { createElement: h, useState, useRef, useCallback, useMemo } = React;

// ── Layer list panel (for one side) ──────────────────────────────────────────

export function LayerList({ layers, side, design, c,
    addLayer, removeLayer, updateLayer, moveLayer, duplicateLayer,
    insertLayerAt, removeLayerAt, duplicateLayerAt,
    invertActiveSide, setAllLocked, copyToOther, onOpenReplaceMaterials,
    refLambda, t }) {

    const [selectedId, setSelectedId] = useState(null);
    const selectedIndex = layers.findIndex(l => l.id === selectedId);
    const de = t.designEditor;
    const containerRef = useRef(null);

    // Front coating is displayed substrate-first (reversed) so layer 1 is the one
    // touching the substrate, matching the back coating convention.
    const reversed = side === 'front';
    const displayedLayers = reversed ? [...layers].reverse() : layers;

    const handleAdd = () => addLayer(side, selectedIndex >= 0 ? selectedIndex : undefined);

    // Keyboard row shortcuts (Ins / Shift+Ins / Del / Ctrl+D).
    const { onKeyDown: tableKeyDown } = useLayerKeyboard({
        layers, side, reversed, displayedLayers, selectedId, setSelectedId, containerRef,
        insertLayerAt, removeLayerAt, duplicateLayerAt,
    });

    // Stable, id-passing row callbacks. Keeping these referentially stable (and
    // the `layer` object refs stable — DesignContext.updateLayer replaces only the
    // changed layer) is what lets React.memo skip every unchanged row.
    const selectAndFocus = useCallback((id) => {
        setSelectedId(id);
        containerRef.current?.focus();
    }, []);
    const onMaterialChangeRow  = useCallback((id, mat) => updateLayer(side, id, { material: mat }), [updateLayer, side]);
    const onThicknessChangeRow = useCallback((id, th)  => updateLayer(side, id, { thickness: th }), [updateLayer, side]);
    const onLockToggleRow      = useCallback((id, locked) => updateLayer(side, id, { locked: !locked }), [updateLayer, side]);
    const onMoveUpRow          = useCallback((id) => moveLayer(side, id, reversed ? 'down' : 'up'), [moveLayer, side, reversed]);
    const onMoveDownRow        = useCallback((id) => moveLayer(side, id, reversed ? 'up' : 'down'), [moveLayer, side, reversed]);
    const onDuplicateRow       = useCallback((id) => duplicateLayer(side, id), [duplicateLayer, side]);
    const onRemoveRow          = useCallback((id) => { removeLayer(side, id); setSelectedId(null); }, [removeLayer, side]);

    // The whole row list, built once and memoized. Scrolling never re-runs this
    // (it changes no state) — the browser scrolls the DOM natively with zero React
    // work. It rebuilds only when the layers, selection, λ₀, theme or locale
    // actually change; even then React.memo on LayerRow skips every row whose own
    // props are unchanged (e.g. selection only re-renders the 2 affected rows).
    // No virtualization: a coating is a static list while you scroll, so we mount
    // it once rather than churning rows in/out of a viewport window.
    const rowEls = useMemo(() => {
        const dl = reversed ? [...layers].reverse() : layers;
        const lastIdx = dl.length - 1;
        return dl.map((layer, di) => h(LayerRow, {
            key: layer.id,
            layer, index: di,
            isSelected: layer.id === selectedId,
            onSelect: selectAndFocus,
            c,
            onMaterialChange: onMaterialChangeRow,
            onThicknessChange: onThicknessChangeRow,
            onLockToggle: onLockToggleRow,
            onMoveUp: onMoveUpRow,
            onMoveDown: onMoveDownRow,
            onDuplicate: onDuplicateRow,
            onRemove: onRemoveRow,
            canMoveUp: di > 0,
            canMoveDown: di < lastIdx,
            refLambda, t,
        }));
    }, [layers, reversed, selectedId, refLambda, c, t,
        selectAndFocus, onMaterialChangeRow, onThicknessChangeRow, onLockToggleRow,
        onMoveUpRow, onMoveDownRow, onDuplicateRow, onRemoveRow]);

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
            h(Btn, { onClick: handleAdd, c }, de.addLayer),
            h(Btn, {
                onClick: () => { if (selectedId) removeLayer(side, selectedId); setSelectedId(null); },
                disabled: !selectedId, c
            }, de.removeLayer),
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
            // Editing-tools menu (design-wide operations). Acts as a menu: it
            // fires the chosen tool and snaps back to its placeholder label.
            h('select', {
                value: '',
                title: de.tools.tip,
                onChange: (e) => {
                    if (e.target.value === 'replaceMaterial') onOpenReplaceMaterials && onOpenReplaceMaterials();
                    e.target.value = '';
                },
                style: {
                    height: 24, padding: '0 6px', fontSize: 12, cursor: 'pointer',
                    backgroundColor: c.panel, color: c.text,
                    border: `1px solid ${c.border}`, borderRadius: 4, outline: 'none',
                },
            },
                h('option', { value: '', disabled: true }, de.tools.label),
                h('option', { value: 'replaceMaterial' }, de.tools.replaceMaterial))
        ),

        // Column headers — the box model must match LayerRow EXACTLY or the
        // numeric columns drift:
        //  • borderLeft:2px transparent mirrors the row's selection border so
        //    the flex track starts at the same x (rows have a 2px left border).
        //  • numeric headers are CENTER-aligned in the same fixed-width box as
        //    the (also center-aligned) ThicknessCell, so 'd (nm)'/'OT'/'QW'/'FW'
        //    align with their values by construction — independent of the cell's
        //    1px symmetric border or any padding (matching right edges is
        //    fragile; equal-width + centered is exact).
        //  • actions placeholder = 4 IconBtns (24px) + 3 flex gaps (1px) = 99,
        //    with marginLeft:2 matching the row's actions <div>.
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '2px 4px', marginBottom: 1,
                borderLeft: '2px solid transparent',
                color: c.textDim, fontSize: 11, userSelect: 'none',
                borderBottom: `1px solid ${c.border}`, flexShrink: 0
            }
        },
            h('div', { style: { width: 24, textAlign: 'right', flexShrink: 0 } }, de.colNum),
            h('div', { style: { flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } }, de.colMaterial),
            h('div', { style: { width: 70, textAlign: 'center', flexShrink: 0 }, title: 'Physical thickness (nm) — editable' }, 'd (nm)'),
            h('div', { style: { width: 58, textAlign: 'center', flexShrink: 0 }, title: 'Optical thickness n·d (nm)' }, 'OT'),
            h('div', { style: { width: 50, textAlign: 'center', flexShrink: 0 }, title: 'Quarter-wave optical thickness 4·n·d/λ₀' }, 'QW'),
            h('div', { style: { width: 50, textAlign: 'center', flexShrink: 0 }, title: 'Full-wave optical thickness n·d/λ₀' }, 'FW'),
            h('div', { style: { width: 22, flexShrink: 0 } }),                              // mirrors lock button
            h('div', { style: { width: 99, marginLeft: 2, flexShrink: 0 } })                // mirrors actions group (4×24 + 3×1 gap)
        ),

        // Substrate top label (both front reversed and back show substrate at top)
        h('div', { style: { padding: '2px 4px', fontSize: 10, color: c.textDim, fontStyle: 'italic', flexShrink: 0 } },
            de.substrateTopLabel(design.substrate.material)
        ),

        // Layers — full list mounted once; scrolling is pure native scroll.
        h('div', {
            style: { flex: 1, overflowY: 'auto', padding: '2px 4px' }
        },
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
        h('div', { style: { padding: '2px 4px', fontSize: 10, color: c.textDim, fontStyle: 'italic', flexShrink: 0, borderTop: `1px solid ${c.border}` } },
            side === 'front'
                ? de.incidentBottomLabel(design.incidentMedium)
                : de.exitLabel(design.exitMedium)
        )
    );
}
