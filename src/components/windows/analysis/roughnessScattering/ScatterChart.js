import { buildScatterLayout, buildScatterTraces } from './figure.js';
import { drawPlot, usePlotTeardown } from '../../../ui/plotSurface.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h, useEffect, useMemo, useRef } = React;

export function ScatterChart(props) {
    const { c, units } = props;
    const divRef = useRef(null);
    const initRef = useRef(false);
    const curve = useAnalysisColors('roughnessScattering');
    const traces = useMemo(() => buildScatterTraces({ ...props, colors: curve }), [
        props.lambda, props.R, props.T, props.R_spec, props.T_spec, props.TIS_inc, units, curve,
    ]);
    // No dependency list, and the layout is rebuilt rather than memoized: see
    // plotSurface.js for why both matter.
    useEffect(() => {
        drawPlot(divRef.current, initRef, traces, buildScatterLayout(c, units, curve),
            { responsive: true, displayModeBar: false });
    });

    usePlotTeardown(divRef, initRef);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
