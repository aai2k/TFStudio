/**
 * Structural n(z) and k(z) step profiles sampled at one wavelength.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { DataTablePanel } from '../../../ui/DataTablePanel.js';
import { ProfilerControls } from './ProfilerControls.js';
import { RIChart } from './RIChart.js';
import { RITotalChart } from './RITotalChart.js';
import { buildProfileViewModel } from './profileViewModel.js';
import { useProfilerState } from './useProfilerState.js';

const { createElement: h } = React;

export function RefractiveIndexProfiler({ c, theme, t }) {
    const rp = t.riProfile;
    const { design } = useDesign();
    const state = useProfilerState(design, rp);
    const view = buildProfileViewModel(state.side, state.profile, state.regions);

    if (!design) {
        return h('div', {
            style: {
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: c.textDim, fontSize: 13, fontFamily: 'system-ui, -apple-system, sans-serif',
            },
        }, rp.noDesign);
    }

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column',
            width: '100%', height: '100%', overflow: 'hidden',
            backgroundColor: c.bg, color: c.text,
        },
    },
        h(ProfilerControls, { c, rp, state, summary: view }),
        h('div', { style: { flex: 1, minHeight: 0, overflow: 'hidden' } },
            view.hasProfile
                ? (view.isTotal
                    ? h(RITotalChart, { regions: state.regions, quantity: state.quantity, matColorMap: state.matColorMap, c })
                    : h(RIChart, { profile: state.profile, quantity: state.quantity, matColorMap: state.matColorMap, c }))
                : h('div', {
                    style: {
                        width: '100%', height: '100%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: c.textDim, fontSize: 13,
                        fontFamily: 'system-ui, -apple-system, sans-serif',
                    },
                }, rp.noLayers)
        ),
        view.hasProfile && h(DataTablePanel, { columns: view.tableColumns, rows: view.tableRows, c, t }),
    );
}
