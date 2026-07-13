/**
 * Reflection ellipsometry, rho = r_p / r_s = tan(Psi) exp(i Delta).
 * Macleod, Thin-Film Optical Filters, 5th ed., p. 553 and Eq. (16.2).
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { EllipsometryControls } from './EllipsometryControls.js';
import { CenteredMessage, EllipsometryResults } from './EllipsometryResults.js';
import { sideSummary } from './model.js';
import { useEllipsometryEvaluation } from './useEllipsometryEvaluation.js';

const { createElement: h } = React;

export function EllipsometryEvaluation({ c, theme, t }) {
    const text = t.ellipsometry;
    const { design } = useDesign();
    const state = useEllipsometryEvaluation(design);

    if (!design) return h(CenteredMessage, { c, message: text.noDesign });

    const summary = sideSummary(design, state.side);
    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column',
            width: '100%', height: '100%', overflow: 'hidden',
            backgroundColor: c.bg, color: c.text,
        },
    },
        h(EllipsometryControls, { c, text, state, summary }),
        h(EllipsometryResults, {
            c, t, text, mode: state.mode, data: state.data,
            validLayerCount: summary.validLayers.length,
        }),
    );
}
