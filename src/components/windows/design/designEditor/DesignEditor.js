import { useDesign } from '../../../../state/DesignContext.js';
import { SurfaceModeControl } from '../../../SurfaceModeBar.js';
import { ReplaceMaterialsDialog } from '../../../dialogs/ReplaceMaterialsDialog.js';
import {
    insertLayerAt as insertLayerAtAction, removeLayerAt as removeLayerAtAction,
    duplicateLayerAt as duplicateLayerAtAction, setAllLocked as setAllLockedAction,
    copyToOther as copyToOtherAction, invertActiveSide as invertActiveSideAction,
} from './layerActions.js';
import { LayerList } from './LayerList.js';
import { StackGeometryPanel } from './StackGeometryPanel.js';

const { createElement: h, useState, useEffect } = React;

// One side tab ("Front coating" / "Back coating"). Disabled + annotated with a
// tooltip when the surface mode makes that side non-editable (mirrored in
// Symmetric mode, or excluded from evaluation by "Ignore other side").
function SideTabButton({ side, activeSide, disabledSide, disabledReason, design, c, t, onSelectSide }) {
    const de = t.designEditor;
    const isSymmetric = (design.surfaceMode === 'symmetric');
    const disabled = side === disabledSide;
    const mb = (t.modeBar) || {};
    const title = !disabled ? null
        : (disabledReason === 'symmetric'
            ? (mb.tabDisabledSymmetric || 'Back mirrors the front (Symmetric). Edit the front coating.')
            : (mb.tabDisabledIgnored || 'This side is ignored ("Ignore other side" is on). Uncheck it to edit this coating.'));
    return h('button', {
        key: side,
        onClick: () => !disabled && onSelectSide(side),
        disabled,
        title,
        style: {
            padding: '6px 16px', fontSize: 12, cursor: disabled ? 'default' : 'pointer', outline: 'none',
            border: 'none', borderBottom: `2px solid ${activeSide === side ? c.accent : 'transparent'}`,
            backgroundColor: 'transparent',
            color: disabled ? c.textDim : (activeSide === side ? c.accent : c.textDim),
            opacity: disabled ? 0.45 : 1,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: activeSide === side ? 600 : 400
        }
    }, side === 'front' ? de.frontCoating : (de.backCoating + (isSymmetric ? ' (= front)' : '')));
}

// ── Design Editor ─────────────────────────────────────────────────────────────

export function DesignEditor({ c, t }) {
    const { design, updateDesign, addLayer, removeLayer, updateLayer, moveLayer, duplicateLayer } = useDesign();
    const [activeSide, setActiveSide] = useState('front');

    // Which side's tab is disabled for editing, and why:
    //   • symmetric    → back is mirrored from front (edit front)
    //   • ignore other → the non-active surface is excluded from evaluation, so
    //                     its tab is dormant until "Ignore other side" is cleared.
    // both_independent / single-side+total leave both tabs editable.
    const _sm = design.surfaceMode || 'front_only';
    const _me = design.mfEvalMode  || 'side';
    const disabledSide =
        _sm === 'symmetric'                    ? 'back'
        : (_me === 'side' && _sm === 'front_only') ? 'back'
        : (_me === 'side' && _sm === 'back_only')  ? 'front'
        : null;
    const disabledReason = _sm === 'symmetric' ? 'symmetric' : 'ignored';

    // Never leave the active tab on a disabled side.
    useEffect(() => {
        if (disabledSide && activeSide === disabledSide) {
            setActiveSide(disabledSide === 'back' ? 'front' : 'back');
        }
    }, [disabledSide, activeSide]);

    const layers   = activeSide === 'front' ? (design.frontLayers || []) : (design.backLayers || []);
    const refLambda = design.referenceWavelength || 550;
    const [replaceOpen, setReplaceOpen] = useState(false);

    const insertLayerAt = (side, splicePos, source) => insertLayerAtAction(design, updateDesign, side, splicePos, source);
    const removeLayerAt = (side, splicePos) => removeLayerAtAction(design, updateDesign, side, splicePos);
    const duplicateLayerAt = (side, splicePos) => duplicateLayerAtAction(design, updateDesign, side, splicePos);
    const setAllLocked = (side, locked) => setAllLockedAction(design, updateDesign, side, locked);
    const copyToOther = () => copyToOtherAction(design, updateDesign, activeSide);
    const invertActiveSide = () => invertActiveSideAction(design, updateDesign, activeSide);

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            // Floor the width so the panel can't be dragged down to nothing;
            // the docking container scrolls if it's narrower than this.
            minWidth: 340,
            backgroundColor: c.bg, color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 13,
            overflow: 'hidden'
        }
    },
        // ── Side tabs ─────────────────────────────────────────────────────────
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', borderBottom: `1px solid ${c.border}`,
                backgroundColor: c.panel, flexShrink: 0
            }
        },
            ['front', 'back'].map(side => h(SideTabButton, {
                key: side, side, activeSide, disabledSide, disabledReason, design, c, t,
                onSelectSide: setActiveSide,
            })),
        ),
        // Consolidated Optimize + Evaluate bar — on its OWN full-width row so it
        // always stays on one line (it used to share the tab row and stack into
        // a column when the window was narrow). Scrolls horizontally instead of
        // wrapping if the window is extremely narrow. The Front/Back tab above is
        // for editing only; this bar is what the optimizer / MF / Specification
        // read. applySurfaceMode (inside the bar) handles the symmetric mirroring;
        // onModeChange does the DE-only editing-tab follow-up.
        h('div', {
            style: {
                display: 'flex', alignItems: 'center',
                padding: '4px 10px', borderBottom: `1px solid ${c.border}`,
                backgroundColor: c.panel, flexShrink: 0, overflowX: 'auto',
            }
        },
            h(SurfaceModeControl, {
                design, updateDesign, c, t,
                style: { flexWrap: 'nowrap' },
                // Follow the chosen primary side with the editing tab.
                onModeChange: (primarySide) => setActiveSide(primarySide === 'back' ? 'back' : 'front'),
            })
        ),

        // ── Layer list (for active side) ──────────────────────────────────────
        h('div', { style: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' } },
            h(LayerList, {
                layers, side: activeSide, design, c,
                addLayer, removeLayer, updateLayer, moveLayer, duplicateLayer,
                insertLayerAt, removeLayerAt, duplicateLayerAt,
                invertActiveSide, setAllLocked, copyToOther,
                onOpenReplaceMaterials: () => setReplaceOpen(true),
                refLambda, t
            })
        ),

        // ── Stack geometry / media ─────────────────────────────────────────────
        h(StackGeometryPanel, { design, updateDesign, refLambda, c, t }),

        replaceOpen && h(ReplaceMaterialsDialog, {
            design, updateDesign, c, t, onClose: () => setReplaceOpen(false),
        })
    );
}
