/**
 * Needle Manual insertion window.
 *
 * The companion to "Needle Automatic" (the scan→insert→DLS→repeat loop in
 * NeedleVariation.js). Here the designer drives the insertion by hand:
 *
 *   1. Compute the P-function profile ∂MF/∂d_needle along the stack depth z,
 *      one curve per candidate material (Tikhonravov 1996; Sullivan &
 *      Dobrowolski 1996). Curves below zero mark depths where a thin needle of
 *      that material lowers the merit function.
 *   2. Click a point on a curve to pick a position (z) + material.
 *   3. Preview the resulting split-layer geometry and the predicted ΔMF, and
 *      tune the inserted thickness d_new with a slider.
 *   4. Apply — a single insertion (optionally followed by one DLS refinement
 *      pass), recorded as a normal history entry.
 */

import { getCatalogs } from '../../../../utils/materials/catalogManager.js';
import { OptimizeBadge, EvalModeBadge } from '../../../SurfaceModeBar.js';
import { WARN_BADGE_STYLE } from '../synthesisShared/synthesisHelpers.js';
import { useNeedleManual } from './useNeedleManual.js';
import { PFunctionPlot } from './PFunctionPlot.js';
import { LeftSidebar } from './LeftSidebar.js';
import { PreviewPanel } from './PreviewPanel.js';

const { createElement: h } = React;

export function NeedleManual({ c, theme, t }) {
    const s = useNeedleManual(t);
    const tn = s.tn;

    if (!s.design) {
        return h('div', { style: { padding: 24, color: c.textDim, fontSize: 13 } }, tn.noDesign);
    }

    const catalogs = getCatalogs();

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden',
        }
    },
        // Top action bar
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                borderBottom: `1px solid ${c.border}`, background: c.panel, flexShrink: 0,
            }
        },
            h('button', {
                onClick: s.computeProfile, disabled: s.busy,
                style: {
                    padding: '3px 14px', fontSize: 12, border: 'none', borderRadius: 3,
                    background: s.busy ? c.border : '#0288d1', color: '#fff',
                    cursor: s.busy ? 'default' : 'pointer', fontWeight: 600, fontFamily: 'inherit', opacity: s.busy ? 0.6 : 1,
                }
            }, s.scanning ? tn.scanningBtn : tn.compute),
            h(OptimizeBadge, { design: s.design, c, t }),
            h(EvalModeBadge, { design: s.design, c, t }),
            h('div', { style: { flex: 1 } }),
            s.statusMsg && h('span', {
                style: (s.statusMsg === tn.noOperands || s.scanBlocked)
                    ? { ...WARN_BADGE_STYLE, whiteSpace: 'normal' }
                    : { fontSize: 11, color: s.busy ? (c.accent || '#ffa726') : c.textDim, fontStyle: 'italic' }
            }, s.statusMsg)
        ),

        h('div', { style: { flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 } },
            h(LeftSidebar, {
                catalogs, selectedCats: s.selectedCats, onToggleCat: s.handleToggleCat,
                onSelectAllCats: s.handleSelectAllCats, onClearCats: s.handleClearCats,
                excludedMats: s.excludedMats, onToggleMat: s.handleToggleMat,
                deltaNm: s.deltaNm, dMin: s.dMin, nIntra: s.nIntra, refineAfter: s.refineAfter, dlsIter: s.dlsIter,
                onDeltaNm: s.setDeltaNm, onDMin: s.setDMin, onNIntra: s.setNIntra,
                onRefineAfter: s.setRefineAfter, onDlsIter: s.setDlsIter,
                showSideRadio: s.showSideRadio, requestedSide: s.requestedSide, onRequestedSide: s.setRequestedSide,
                busy: s.busy, c, t,
            }),

            h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
                // P-function plot (upper)
                h('div', {
                    style: { flex: 1, borderBottom: `1px solid ${c.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }
                },
                    h('div', {
                        style: { padding: '3px 8px', fontSize: 10, fontWeight: 700, color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${c.border}`, flexShrink: 0 }
                    }, tn.profileTitle),
                    h('div', { style: { flex: 1, overflow: 'hidden' } },
                        !s.scan
                            ? h('div', {
                                style: { height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.textDim, fontSize: 12, fontStyle: 'italic', textAlign: 'center', padding: 20 }
                              }, tn.noProfile)
                            : h(PFunctionPlot, {
                                traces: s.plotData.traces, boundaries: s.plotData.boundaries,
                                bands: s.plotData.bands, totalZ: s.plotData.totalZ,
                                selected: s.selected, onPick: s.handlePick, c, theme,
                            })
                    )
                ),
                // Preview / apply panel (lower)
                h('div', { style: { flexShrink: 0, maxHeight: 220, overflow: 'auto' } },
                    h('div', {
                        style: { padding: '3px 8px', fontSize: 10, fontWeight: 700, color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${c.border}` }
                    }, tn.previewTitle),
                    h(PreviewPanel, {
                        selected: s.selected, hostInfo: s.hostInfo || {}, dNew: s.dNew, dRange: s.dRange,
                        predictedOMF: s.predictedOMF, omf0: s.omfNow,
                        onDNew: s.setDNew, onApply: s.handleApply, busy: s.busy, c, t,
                    })
                )
            )
        )
    );
}
