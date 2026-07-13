/**
 * Electric-field intensity profile computed by the left-partial transfer matrix method.
 * Reference: Macleod, Thin-Film Optical Filters, section 3, Eqs. 3.5-3.6.
 * Intensity is normalized to unit incident-field intensity (100%).
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { EFieldChart } from './EFieldChart.js';
import { EFieldControls } from './EFieldControls.js';
import { EFieldTable } from './EFieldTable.js';
import { buildProfileViewModel } from './profileViewModel.js';
import { useEFieldState } from './useEFieldState.js';

const { createElement: h } = React;

export function EFieldEvaluation({ c, theme, t }) {
    const ef = t.eField;
    const { design } = useDesign();
    const state = useEFieldState(design);
    const summary = buildProfileViewModel(state.profile, state.pol);

    if (!design) {
        return h('div', { style: {
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontFamily: 'system-ui, -apple-system, sans-serif',
        } }, ef.noDesign);
    }

    return h('div', { style: {
        display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
        overflow: 'hidden', backgroundColor: c.bg, color: c.text,
    } },
        h(EFieldControls, { c, ef, state, summary }),
        h('div', { style: {
            flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        } },
            h('div', { style: { flex: 1, minHeight: 0, overflow: 'hidden' } },
                state.profile
                    ? h(EFieldChart, {
                        profileData: state.profile, pol: state.pol,
                        matColorMap: state.matColorMap, c,
                    })
                    : h('div', { style: {
                        width: '100%', height: '100%', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', color: c.textDim, fontSize: 13,
                        fontFamily: 'system-ui, -apple-system, sans-serif',
                    } }, ef.noLayers)
            ),
            state.profile && h(EFieldTable, { profile: state.profile, pol: state.pol, c, t })
        )
    );
}
