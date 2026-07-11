/**
 * Design Cleaner — structural cleanup window.
 *
 * Combines two cleanup modes: Design Cleaner (merge similar adjacent
 * layers + remove sub-threshold layers + re-optimize) and Thin
 * Layer Removal (list sub-N nm layers and drop them with optional
 * post-refinement). Both use the same underlying `cleanupDesign()` from
 * `src/utils/designCleaner.js`.
 *
 * Flow:
 *   1. User picks threshold + toggles (merge / re-optimize / clean back)
 *   2. Window previews the operations (remove/merge) and shows MF before
 *   3. User clicks Apply — one undo-checkpoint is created, the cleaned
 *      design is committed, and (if enabled) a short DLS pass refines it.
 *
 * The previous design is reachable via Ctrl+Z (single checkpoint covers
 * both the cleanup and the optional refinement).
 */

import { useDesign }            from '../../../state/DesignContext.js';
import { getMaterialById }      from '../../../utils/materials/catalogManager.js';
import { getMaterial }          from '../../../utils/materials/materialDatabase.js';
import { cleanupDesign, listThinLayers } from '../../../utils/synthesis/designCleaner.js';
import { Checkbox }            from '../../ui/Checkbox.js';
import {
    DLSOptimizer,
    evaluateOperands,
    calcMF,
    buildEvalContext,
} from '../../../utils/physics/optimizer.js';

const { createElement: h, useState, useMemo, useCallback, useRef } = React;

function resolveMat(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// ── Component ────────────────────────────────────────────────────────────────

export function DesignCleaner({ c, theme, t }) {
    const dc = t.designCleaner;
    const { design, updateDesign, checkpoint } = useDesign();

    const [dMin,           setDMin]           = useState(5.0);
    const [mergeAdjacent,  setMergeAdjacent]  = useState(true);
    const [cleanBack,      setCleanBack]      = useState(true);
    const [reoptimize,     setReoptimize]     = useState(true);
    const [reoptIters,     setReoptIters]     = useState(80);

    const [applying,  setApplying]  = useState(false);
    const [resultMsg, setResultMsg] = useState(null);

    // ── Preview ───────────────────────────────────────────────────────────────
    const preview = useMemo(() => {
        if (!design?.frontLayers) return null;
        return cleanupDesign(design, { dMin, mergeAdjacent, cleanBack });
    }, [design, dMin, mergeAdjacent, cleanBack]);

    // MF (before vs after) — uses live design operands if any
    const mfBefore = useMemo(() => {
        if (!design?.meritOperands?.length) return null;
        try {
            const ctx = buildEvalContext(design, resolveMat);
            return calcMF(design.meritOperands, evaluateOperands(design.meritOperands, ctx));
        } catch { return null; }
    }, [design]);

    const mfAfter = useMemo(() => {
        if (!preview?.design || !design?.meritOperands?.length) return null;
        try {
            const ctx = buildEvalContext(preview.design, resolveMat);
            return calcMF(design.meritOperands, evaluateOperands(design.meritOperands, ctx));
        } catch { return null; }
    }, [preview, design]);

    // ── Apply ─────────────────────────────────────────────────────────────────
    const apply = useCallback(() => {
        if (!preview || preview.ops.length === 0) {
            setResultMsg(dc.nothingToDo);
            return;
        }
        setApplying(true);
        setResultMsg(null);

        // Single undo checkpoint covers both the cleanup and any refinement
        if (typeof checkpoint === 'function') checkpoint();

        try {
            let nextDesign = preview.design;

            // Post-clean refinement (optional, synchronous so the final design
            // lands atomically — for a freshly-cleaned design with O(10) free
            // layers a 50–100-iter DLS pass typically takes < 100 ms)
            let refineMfBefore = null, refineMfAfter = null;
            if (reoptimize && design.meritOperands?.length) {
                try {
                    const opt = new DLSOptimizer(
                        design.meritOperands, nextDesign, resolveMat,
                        { dMin: Math.max(dMin, 1.0) }
                    );
                    refineMfBefore = opt.mf;
                    const iters = Math.max(1, Math.min(500, reoptIters));
                    for (let i = 0; i < iters && !opt.isConverged(); i++) opt.step();
                    opt.restoreBest();
                    nextDesign = opt.applyToDesign(nextDesign);
                    refineMfAfter = opt.mfBest;
                } catch (e) {
                    console.error('[Cleaner] post-clean DLS failed', e);
                }
            }

            updateDesign({
                frontLayers: nextDesign.frontLayers,
                backLayers:  nextDesign.backLayers,
            });

            let msg = dc.appliedMsg(preview.removedCount, preview.mergedCount);
            if (refineMfAfter != null && refineMfBefore != null) {
                msg += `  •  ${dc.mfRefineMsg(refineMfBefore, refineMfAfter)}`;
            }
            setResultMsg(msg);
        } catch (e) {
            setResultMsg(`Error: ${e.message || e}`);
        }
        setApplying(false);
    }, [preview, dc, design, updateDesign, checkpoint, reoptimize, reoptIters, dMin]);

    // ── Render guards ─────────────────────────────────────────────────────────
    const placeholder = (msg) => h('div', {
        style: {
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontStyle: 'italic',
            fontFamily: 'system-ui, -apple-system, sans-serif', padding: 16, textAlign: 'center',
        }
    }, msg);

    if (!design) return placeholder(dc.noDesign);
    if (!design.frontLayers?.length && !design.backLayers?.length) return placeholder(dc.noLayers);

    // ── Styles ────────────────────────────────────────────────────────────────
    const labelStyle = {
        color: c.textDim, fontSize: 11,
        fontFamily: 'system-ui, -apple-system, sans-serif', whiteSpace: 'nowrap',
    };
    const inputStyle = {
        background: c.inputBg || c.hover, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3,
        padding: '1px 4px', fontSize: 12, width: 64,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    const checkboxLabel = {
        display: 'flex', alignItems: 'center', gap: 4,
        cursor: 'pointer', color: c.text, fontSize: 11,
    };

    const ops = preview?.ops || [];
    const removedOps = ops.filter(o => o.kind === 'remove');
    const mergedOps  = ops.filter(o => o.kind === 'merge');

    // Thin-layer-only list (for the "what's currently sub-threshold" view —
    // the Thin Layer Removal mode)
    const thinList = listThinLayers(design, dMin);

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text, overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
        }
    },
        // ── Controls ─────────────────────────────────────────────────────────
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                padding: '6px 10px', borderBottom: `1px solid ${c.border}`,
                background: c.panel, flexShrink: 0,
            }
        },
            h('label', { style: labelStyle }, dc.minThickness,
                h('input', {
                    type: 'number', min: 0, max: 200, step: 0.5, value: dMin,
                    onChange: e => setDMin(parseFloat(e.target.value) || 0),
                    style: { ...inputStyle, marginLeft: 6, width: 60 }
                }),
                h('span', { style: { color: c.textDim, marginLeft: 2 } }, 'nm')
            ),
            h('label', { style: checkboxLabel },
                h(Checkbox, {
                    c, checked: mergeAdjacent,
                    onChange: e => setMergeAdjacent(e.target.checked),
                }),
                dc.mergeAdjacent
            ),
            h('label', { style: checkboxLabel },
                h(Checkbox, {
                    c, checked: cleanBack,
                    onChange: e => setCleanBack(e.target.checked),
                }),
                dc.cleanBack
            ),
            h('label', { style: checkboxLabel,
                title: design.meritOperands?.length ? '' : dc.reoptimizeNoOperands,
            },
                h(Checkbox, {
                    c, checked: reoptimize && design.meritOperands?.length > 0,
                    disabled: !design.meritOperands?.length,
                    onChange: e => setReoptimize(e.target.checked),
                }),
                dc.reoptimize
            ),
            reoptimize && design.meritOperands?.length > 0 && h('label', { style: labelStyle }, dc.reoptIters,
                h('input', {
                    type: 'number', min: 1, max: 500, step: 10, value: reoptIters,
                    onChange: e => setReoptIters(parseInt(e.target.value) || 80),
                    style: { ...inputStyle, marginLeft: 6, width: 55 }
                })
            ),
            h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' } },
                h('button', {
                    onClick: apply, disabled: applying || ops.length === 0,
                    style: {
                        padding: '3px 14px', fontSize: 12, cursor: ops.length ? 'pointer' : 'not-allowed',
                        border: `1px solid ${ops.length ? c.accent : c.border}`, borderRadius: 3,
                        background: ops.length ? c.accent + '33' : 'transparent',
                        color: ops.length ? c.accent : c.textDim,
                        outline: 'none', fontWeight: 600,
                        opacity: applying ? 0.5 : 1,
                    }
                }, applying ? dc.applying : `${dc.apply} (${ops.length})`)
            )
        ),

        // ── Status / summary ──────────────────────────────────────────────────
        h('div', {
            style: {
                display: 'flex', gap: 18, flexWrap: 'wrap',
                padding: '6px 10px', borderBottom: `1px solid ${c.border}`,
                background: c.panel + 'aa', flexShrink: 0,
                fontSize: 11,
            }
        },
            h('div', null,
                h('span', { style: { color: c.textDim, marginRight: 4 } }, dc.layersBefore + ':'),
                h('span', null,
                    `${preview?.layersBefore.front ?? 0}F + ${preview?.layersBefore.back ?? 0}B`)
            ),
            h('div', null,
                h('span', { style: { color: c.textDim, marginRight: 4 } }, dc.layersAfter + ':'),
                h('span', { style: { color: ops.length ? c.accent : c.text, fontWeight: ops.length ? 600 : 400 } },
                    `${preview?.layersAfter.front ?? 0}F + ${preview?.layersAfter.back ?? 0}B`)
            ),
            h('div', null,
                h('span', { style: { color: c.textDim, marginRight: 4 } }, dc.toRemove + ':'),
                h('span', { style: { color: removedOps.length ? '#ef5350' : c.text } }, removedOps.length)
            ),
            h('div', null,
                h('span', { style: { color: c.textDim, marginRight: 4 } }, dc.toMerge + ':'),
                h('span', { style: { color: mergedOps.length ? '#ffd54f' : c.text } }, mergedOps.length)
            ),
            mfBefore != null && h('div', null,
                h('span', { style: { color: c.textDim, marginRight: 4 } }, dc.mfBefore + ':'),
                h('span', null, mfBefore.toFixed(6))
            ),
            mfAfter != null && h('div', null,
                h('span', { style: { color: c.textDim, marginRight: 4 } }, dc.mfAfter + ':'),
                h('span', {
                    style: { color: mfAfter > mfBefore + 1e-9 ? c.error
                                  : mfAfter < mfBefore - 1e-9 ? c.success
                                  : c.text }
                }, mfAfter.toFixed(6))
            ),
            resultMsg && h('div', { style: { color: c.accent, marginLeft: 'auto' } }, resultMsg),
        ),

        // ── Operations list + thin-layer list ────────────────────────────────
        h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' } },
            // Pending operations
            h('div', {
                style: {
                    flex: 1, minHeight: 0, overflowY: 'auto',
                    borderRight: `1px solid ${c.border}`,
                }
            },
                h('div', {
                    style: {
                        padding: '4px 10px', fontSize: 11, fontWeight: 600,
                        color: c.textDim, background: c.panel + '55',
                        borderBottom: `1px solid ${c.border}`, position: 'sticky', top: 0,
                    }
                }, dc.pendingOps + ` (${ops.length})`),
                ops.length === 0
                    ? h('div', {
                        style: { padding: 16, color: c.textDim, fontStyle: 'italic', textAlign: 'center' }
                    }, dc.noOps)
                    : h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
                        h('thead', null,
                            h('tr', null,
                                ['#', dc.colSide, dc.colLayer, dc.colKind, dc.colMaterial, dc.colThickness, dc.colDetail]
                                    .map((label, i) => h('th', {
                                        key: i,
                                        style: {
                                            padding: '3px 8px', fontWeight: 600, fontSize: 10,
                                            borderBottom: `1px solid ${c.border}`,
                                            background: c.panel + '55',
                                            textAlign: i >= 5 ? 'right' : 'left',
                                            color: c.textDim, whiteSpace: 'nowrap',
                                            position: 'sticky', top: 22,
                                        }
                                    }, label))
                            )
                        ),
                        h('tbody', null, ops.map((op, i) => h('tr', {
                            key: i,
                            style: { background: i % 2 === 0 ? 'transparent' : c.panel + '33' }
                        },
                            h('td', { style: { padding: '2px 8px', color: c.textDim, fontSize: 11 } }, i + 1),
                            h('td', { style: { padding: '2px 8px', color: c.text, fontSize: 11 } },
                                op.side === 'front' ? 'F' : 'B'),
                            h('td', { style: { padding: '2px 8px', color: c.text, fontSize: 11 } },
                                `${op.side === 'front' ? 'F' : 'B'}${op.srcIdx + 1}`),
                            h('td', { style: { padding: '2px 8px', fontSize: 11,
                                color: op.kind === 'remove' ? '#ef5350' : '#ffd54f', fontWeight: 600 } },
                                op.kind === 'remove' ? dc.opRemove : dc.opMerge),
                            h('td', { style: { padding: '2px 8px', color: c.text, fontSize: 11 } }, op.materialId),
                            h('td', {
                                style: { padding: '2px 8px', color: c.text, fontSize: 11,
                                    textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
                            }, op.thickness.toFixed(3) + ' nm'),
                            h('td', { style: { padding: '2px 8px', color: c.textDim, fontSize: 11, textAlign: 'right' } },
                                op.kind === 'merge'
                                    ? `→ ${op.side === 'front' ? 'F' : 'B'}${op.mergedInto + 1}`
                                    : `< ${dMin.toFixed(1)} nm`)
                        )))
                    )
            ),

            // Thin layer list (read-only diagnostic — what's currently sub-threshold)
            h('div', {
                style: { flex: '0 0 280px', minHeight: 0, overflowY: 'auto' }
            },
                h('div', {
                    style: {
                        padding: '4px 10px', fontSize: 11, fontWeight: 600,
                        color: c.textDim, background: c.panel + '55',
                        borderBottom: `1px solid ${c.border}`, position: 'sticky', top: 0,
                    },
                    title: dc.thinListTip,
                }, dc.thinList + ` (${thinList.length})`),
                thinList.length === 0
                    ? h('div', { style: { padding: 16, color: c.textDim, fontStyle: 'italic', textAlign: 'center' } },
                        dc.noThin)
                    : h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
                        h('tbody', null, thinList.map((l, i) => h('tr', {
                            key: i,
                            style: { background: i % 2 === 0 ? 'transparent' : c.panel + '33' }
                        },
                            h('td', { style: { padding: '2px 8px', color: c.text, fontSize: 11 } },
                                `${l.side === 'front' ? 'F' : 'B'}${l.layerIndex + 1}`),
                            h('td', { style: { padding: '2px 8px', color: c.text, fontSize: 11 } }, l.materialId),
                            h('td', {
                                style: { padding: '2px 8px', color: c.textDim, fontSize: 11,
                                    textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
                            }, l.thickness.toFixed(3) + ' nm'),
                        )))
                    )
            )
        )
    );
}
