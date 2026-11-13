import { useDesign } from '../../../../state/DesignContext.js';
import { useUnresolvedMaterials } from '../../../../utils/materials/useUnresolvedMaterials.js';
import { SurfaceModeControl } from '../../../SurfaceModeBar.js';
import { ReplaceMaterialsDialog } from '../../../dialogs/ReplaceMaterialsDialog.js';
import {
    addLayerAtDisplayIndex as addLayerAtDisplayIndexAction, removeLayerAt as removeLayerAtAction,
    duplicateLayerAt as duplicateLayerAtAction, setAllLocked as setAllLockedAction,
    copyToOther as copyToOtherAction, invertActiveSide as invertActiveSideAction,
    pasteLayersAtDisplayIndex as pasteLayersAtDisplayIndexAction,
    removeLayers as removeLayersAction, reorderLayers as reorderLayersAction,
    moveLayersByStep as moveLayersByStepAction,
} from './layerActions.js';
import { LayerList } from './LayerList.js';
import { StackGeometryPanel, settingsField } from './StackGeometryPanel.js';
import { designEditorSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';
import { useCurrentEnvironment } from '../environments/currentEnvironment.js';
import { environmentMedia, environmentsOf } from '../../../../utils/environments/environments.js';

const { createElement: h, useState, useEffect, useMemo } = React;

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

// Which side's tab is disabled for editing, `{ side, reason }`, side null when
// both are editable:
//   • symmetric    → back is mirrored from front (edit front)
//   • ignore other → the non-active surface is excluded from evaluation in
//                     every environment, so its tab is dormant until
//                     "Ignore other side" is cleared in one of them: the
//                     layer list is the recipe every environment reads.
// both_independent / single-side+total leave both tabs editable.
function dormantSide(design) {
    const surfaceMode = design.surfaceMode || 'front_only';
    if (surfaceMode === 'symmetric') return { side: 'back', reason: 'symmetric' };
    const whole = environmentsOf(design).some(env => environmentMedia(design, env.id).mfEvalMode === 'total');
    const ignored = { front_only: 'back', back_only: 'front' }[surfaceMode];
    return { side: whole ? null : (ignored ?? null), reason: 'ignored' };
}

// ── Design Editor ─────────────────────────────────────────────────────────────

export function DesignEditor({ c, t }) {
    const { design, updateDesign, removeLayer, updateLayer, isOptimizing } = useDesign();
    const missingMaterialIds = useUnresolvedMaterials(design);
    const [session, setSessionField] = useWindowSession(designEditorSession, design);
    const activeSide = session.activeSide;
    const setActiveSide = value => setSessionField('activeSide', value);
    // The layer list is the recipe in every environment; the media and the
    // substrate around it are the current environment's.
    const current = useCurrentEnvironment(design);
    const media = useMemo(() => environmentMedia(design, current.id), [design, current.id]);

    const { side: disabledSide, reason: disabledReason } = dormantSide(design);

    // Never leave the active tab on a disabled side.
    useEffect(() => {
        if (disabledSide && activeSide === disabledSide) {
            setActiveSide(disabledSide === 'back' ? 'front' : 'back');
        }
    }, [disabledSide, activeSide]);

    const layers   = activeSide === 'front' ? (design.frontLayers || []) : (design.backLayers || []);
    const refLambda = design.referenceWavelength || 550;
    const [replaceOpen, setReplaceOpen] = useState(false);
    const missingMaterialSet = useMemo(() => new Set(missingMaterialIds), [missingMaterialIds]);

    const addLayerAtDisplayIndex = (side, displayIndex, options) =>
        addLayerAtDisplayIndexAction(design, updateDesign, side, displayIndex, options);
    const removeLayerAt = (side, splicePos) => removeLayerAtAction(design, updateDesign, side, splicePos);
    const duplicateLayerAt = (side, splicePos) => duplicateLayerAtAction(design, updateDesign, side, splicePos);
    const setAllLocked = (side, locked) => setAllLockedAction(design, updateDesign, side, locked);
    const copyToOther = () => copyToOtherAction(design, updateDesign, activeSide);
    const invertActiveSide = () => invertActiveSideAction(design, updateDesign, activeSide);
    const pasteLayersAtDisplayIndex = (side, displayIndex, sources, reversed) =>
        pasteLayersAtDisplayIndexAction(design, updateDesign, side, displayIndex, sources, reversed);
    const removeLayers = (side, ids) => removeLayersAction(design, updateDesign, side, ids);
    const reorderLayers = (side, ids, targetId, position, reversed) =>
        reorderLayersAction(design, updateDesign, side, ids, targetId, position, reversed);
    const moveLayersByStep = (side, ids, delta, reversed) =>
        moveLayersByStepAction(design, updateDesign, side, ids, { delta, reversed });

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
                // In environment 2 or later Ignore other side is that environment's.
                backSide: current.index > 0 ? settingsField({ design, current, updateDesign, c, t }, 'mfEvalMode') : null,
                // Follow the chosen primary side with the editing tab.
                onModeChange: (primarySide) => setActiveSide(primarySide === 'back' ? 'back' : 'front'),
            })
        ),

        // ── Layer list (for active side) ──────────────────────────────────────
        h('div', { style: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' } },
            h(LayerList, {
                layers, side: activeSide, design, media, updateDesign, missingMaterialIds: missingMaterialSet, c,
                removeLayer, updateLayer,
                addLayerAtDisplayIndex, removeLayerAt, duplicateLayerAt,
                pasteLayersAtDisplayIndex, removeLayers, reorderLayers, moveLayersByStep,
                invertActiveSide, setAllLocked, copyToOther,
                onOpenReplaceMaterials: () => setReplaceOpen(true),
                refLambda, isOptimizing, t
            })
        ),

        // ── Stack geometry / media ─────────────────────────────────────────────
        h(StackGeometryPanel, { design, media, current, updateDesign, refLambda, c, t }),

        replaceOpen && h(ReplaceMaterialsDialog, {
            design, updateDesign, c, t, onClose: () => setReplaceOpen(false),
        })
    );
}
