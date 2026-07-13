/**
 * Simulates uniform thickness and refractive-index deviations, either as one
 * perturbed spectrum or as a parameter sweep corridor.
 */

import { GlobalDeviationPanel, PerMaterialPanel } from './DeviationPanels.js';
import { ResultPanel, SpecificationStatus } from './StatusPanels.js';
import { SweepPanel } from './SweepPanel.js';
import { SystematicToolbar } from './SystematicToolbar.js';
import { placeholder } from './ui.js';
import { useSystematicDeviations } from './useSystematicDeviations.js';

const { createElement: h } = React;

export function SystematicDeviations({ c, theme, t }) {
    const controller = useSystematicDeviations();
    const { design, mode } = controller;
    const sd = (t && t.systematicDeviations) || {};

    if (!design) return placeholder(c, sd.noDesign || 'No design selected.');
    if (!design.frontLayers?.length && !design.backLayers?.length) {
        return placeholder(c, sd.noLayers || 'No layers in design.');
    }

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text, overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
        }
    },
        h(SystematicToolbar, { controller, c, t, sd }),
        h(SpecificationStatus, { controller, c, t }),
        h('div', {
            style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' }
        },
            h('div', {
                style: {
                    width: 260, flexShrink: 0, borderRight: `1px solid ${c.border}`,
                    background: c.panel, overflow: 'hidden',
                    display: 'flex', flexDirection: 'column',
                }
            },
                mode === 'sweep' && h(SweepPanel, { controller, c, sd }),
                mode === 'single' && h(GlobalDeviationPanel, { controller, c, sd }),
                mode === 'single' && h(PerMaterialPanel, { controller, c, sd }),
            ),
            h(ResultPanel, { controller, c, sd }),
        )
    );
}
