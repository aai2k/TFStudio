/**
 * Group delay and dispersion evaluation. Macleod, Thin-Film Optical Filters,
 * 5th ed., Eq. (11.17): GD = -dφ/dω and GDD = -d²φ/dω².
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { GDControls } from './GDControls.js';
import { GDResults, CenteredMessage } from './GDResults.js';
import { buildGdGddView, buildLayerSummary } from './viewModel.js';
import { useGDGDDState } from './useGDGDDState.js';

const { createElement: h } = React;

export function GDGDDEvaluation({ c, theme, t }) {
    const text = t.gdgdd;
    const { design } = useDesign();
    const state = useGDGDDState(design);

    if (!design) return h(CenteredMessage, { c, message: text.noDesign });

    const view = buildGdGddView(state.raw, {
        quantity: state.quantity,
        referenceLambda: state.refLam,
        showReference: state.showRef,
    }, text);
    const summary = buildLayerSummary(design, state.side);

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column',
            width: '100%', height: '100%', overflow: 'hidden',
            backgroundColor: c.bg, color: c.text,
        },
    },
        h(GDControls, { c, text, state, summary }),
        h(GDResults, { c, t, text, state, view }),
    );
}
