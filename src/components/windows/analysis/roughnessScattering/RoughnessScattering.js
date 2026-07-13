/**
 * Interface Roughness / Scattering window for uncorrelated interface roughness.
 *
 * TIS(λ) = R(λ) · (4π · σ_eff · cosθ / λ)² and σ_eff² = Σ σ_i².
 * Reference: Macleod, Thin-Film Optical Filters, 5th ed., Eq. 16.30.
 */

import { ScatterChart } from './ScatterChart.js';
import { buildControlStyles } from './controls.js';
import { RoughnessSidebar } from './RoughnessSidebar.js';
import { RoughnessToolbar } from './RoughnessToolbar.js';
import { useRoughnessScattering } from './useRoughnessScattering.js';

const { createElement: h } = React;

export function RoughnessScattering({ c, theme, t }) {
    const state = useRoughnessScattering();
    const { design, activeSides, hasBack, calc, error, units } = state;
    const rs = (t && t.roughnessScattering) || {};
    const placeholder = message => h('div', {
        style: {
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontStyle: 'italic',
            fontFamily: 'system-ui, -apple-system, sans-serif', padding: 16, textAlign: 'center',
        }
    }, message);
    if (!design) return placeholder(rs.noDesign || 'No design selected.');
    if (!design.frontLayers?.length) return placeholder(rs.noLayers || 'No layers in design.');

    const controlStyles = buildControlStyles(c);
    const props = { ...state, ...controlStyles, c, theme, t, rs };
    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text, overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
        }
    },
        h(RoughnessToolbar, props),
        (activeSides.includes('back') && !hasBack) && h('div', {
            style: {
                padding: '6px 12px', background: '#5a4a1a', color: '#ffe08a',
                borderBottom: `1px solid ${c.border}`, fontSize: 11, flexShrink: 0,
            }
        }, rs.noBackLayers || 'This evaluation includes the back coating, but the design has no back layers. Add a back coating in the Design Editor to model its roughness.'),
        h('div', {
            style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' }
        },
            h(RoughnessSidebar, props),
            h('div', { style: { flex: 1, minHeight: 0, position: 'relative' } },
                error && h('div', {
                    style: {
                        position: 'absolute', top: 8, left: 8, right: 8,
                        padding: '6px 10px', background: '#5a1a1a', color: '#fff',
                        border: '1px solid #a33', borderRadius: 4, fontSize: 11, zIndex: 5,
                    }
                }, error),
                calc
                    ? h(ScatterChart, {
                        lambda: calc.lambda, R: calc.R, T: calc.T,
                        R_spec: calc.R_spec, T_spec: calc.T_spec,
                        TIS_inc: calc.TIS_inc,
                        units, c,
                    })
                    : placeholder(rs.computing || 'Computing…')
            ),
        )
    );
}
