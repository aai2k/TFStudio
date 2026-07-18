import { useOpticalEvaluation } from './useOpticalEvaluation.js';
import { EvaluationToolbar } from './EvaluationToolbar.js';
import { CurveToolbar } from './CurveToolbar.js';
import { TargetToolbar } from './TargetToolbar.js';
import { ChartPanel } from './ChartPanel.js';
import { AxisPanel } from './AxisPanel.js';
import { FooterPanel } from './FooterPanel.js';

const { createElement: h } = React;

export function OpticalEvaluation({ c, theme, t }) {
    const state = useOpticalEvaluation();
    const props = { ...state, c, theme, t, oe: t.opticalEval };
    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            backgroundColor: c.bg, color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
            overflow: 'hidden'
        }
    },
        h(EvaluationToolbar, props),
        h(CurveToolbar, props),
        h(TargetToolbar, props),
        h(ChartPanel, props),
        h(AxisPanel, props),
        h(FooterPanel, props)
    );
}
