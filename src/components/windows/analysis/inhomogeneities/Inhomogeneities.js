/**
 * Configures graded transition layers at coating interfaces and compares their
 * spectrum with the homogeneous design. Macleod, Thin-Film Optical Filters,
 * 5th ed., "Inhomogeneous Layers" describes the homogeneous-sublayer model.
 */

import { OverlayChart } from './OverlayChart.js';
import { InhomogeneityControls } from './InhomogeneityControls.js';
import { InterfaceTable } from './InterfaceTable.js';
import { BackLayerStatus, ErrorStatus, HelpStatus } from './InhomogeneityStatus.js';
import { hasLayersForMode } from './model.js';
import { useInhomogeneities } from './useInhomogeneities.js';
import { placeholder } from './ui.js';

const { createElement: h } = React;

export function Inhomogeneities({ c, theme, t }) {
    const state = useInhomogeneities();
    const { design, evalMode, activeSides, hasBack, interfaces, error } = state;
    const ih = (t && t.inhomogeneities) || {};

    if (!design) return placeholder(c, ih.noDesign || 'No design selected.');
    if (!hasLayersForMode(design, evalMode)) {
        return placeholder(c, ih.noLayers || 'No layers in design.');
    }

    const sharedProps = { ...state, c, theme, t, ih };
    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text, overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
        }
    },
        h(InhomogeneityControls, sharedProps),
        h(BackLayerStatus, { show: activeSides.includes('back') && !hasBack, c, ih }),
        h('div', {
            style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' }
        },
            h('div', {
                style: {
                    width: 380, flexShrink: 0, borderRight: `1px solid ${c.border}`,
                    background: c.panel, overflowY: 'auto',
                }
            },
                ...activeSides
                    .filter(side => side === 'front' || hasBack)
                    .map(side => h(InterfaceTable, {
                        ...sharedProps, key: side, side, ifaces: interfaces[side],
                    })),
                h(HelpStatus, { c, ih }),
            ),
            h('div', { style: { flex: 1, minHeight: 0, position: 'relative' } },
                h(ErrorStatus, { error }),
                h(OverlayChart, {
                    baseline: state.baseline, perturbed: state.perturbed,
                    channel: state.channel, c,
                }),
            ),
        ),
    );
}
