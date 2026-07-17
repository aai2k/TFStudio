/**
 * Variator — slider-driven parameter exploration.
 *
 * Lets the user nudge layer thicknesses, substrate thickness, and material
 * n/k offsets and see the spectrum respond instantly.
 *
 * Scope (v1):
 *   - Layer thickness sliders (front + back): propagate to the design via
 *     updateDesign(patch, { transient: true }) so every other open window
 *     (Optical Evaluation, Admittance, E-field, …) re-renders live.
 *   - Substrate thickness slider: same transient propagation.
 *   - Material n/k offset sliders: one row per UNIQUE material in the stack.
 *     These stay LOCAL to the Variator — applied as offsets when this window
 *     computes its preview spectrum. Other windows see the unperturbed
 *     materials. (Full propagation needs a design-level material-override
 *     resolver chain.)
 *
 * Baseline handling:
 *   - On first slider move we push ONE undo checkpoint so a single Ctrl+Z
 *     reverts the entire Variator session.
 *   - Baseline thicknesses are captured in a module-scoped cache keyed by
 *     design.id, so docking switches preserve the reference for Revert.
 *   - The Revert button zeros every slider and restores the baseline
 *     (transient update — no extra checkpoint pushed).
 */

import { useVariator } from './useVariator.js';
import { Sidebar } from './Sidebar.js';
import { PreviewToolbar } from './PreviewToolbar.js';
import { SpectrumPlot } from './SpectrumPlot.js';
import { Footer } from './Footer.js';

const { createElement: h } = React;

export function Variator({ c, theme, t }) {
    const state = useVariator();
    const v = t.variator || {};   // tolerate missing locale: fall through to defaults

    if (!state.design) {
        return h('div', {
            style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                     color: c.textDim, fontSize: 13, fontFamily: 'system-ui, -apple-system, sans-serif' }
        }, v.noDesign || 'No design selected. Open or create a design first.');
    }

    const props = { ...state, c, theme, t, v };

    return h('div', {
        style: {
            display: 'flex', width: '100%', height: '100%',
            backgroundColor: c.bg, color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
            overflow: 'hidden'
        }
    },
        h(Sidebar, props),

        // ── Main area: spectrum plot + controls ─────────────────────────
        h('div', {
            style: {
                flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column'
            }
        },
            h(PreviewToolbar, props),

            // Chart
            h('div', { style: { flex: 1, minHeight: 0, position: 'relative' } },
                state.error
                    ? h('div', {
                        style: { display: 'flex', alignItems: 'center', justifyContent: 'center',
                                 height: '100%', color: '#ef5350', fontSize: 12, padding: 16, textAlign: 'center' }
                    }, `Error: ${state.error}`)
                    : h(SpectrumPlot, {
                        data: state.showBaseline ? state.data : (state.data ? { lambda: state.data.lambda, T: state.data.T, R: state.data.R } : null),
                        c, theme,
                        targets: state.design.meritOperands,
                        showTargets: state.showTargets,
                    })
            ),

            h(Footer, props)
        )
    );
}
