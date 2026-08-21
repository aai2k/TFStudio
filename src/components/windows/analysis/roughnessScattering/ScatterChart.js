import { buildScatterLayout, buildScatterTraces } from './figure.js';
import { drawPlot, usePlotTeardown } from '../../../ui/plotSurface.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { chartConfig } from '../chrome/plot.js';

const { createElement: h, useEffect, useMemo, useRef } = React;

export function ScatterChart(props) {
    const { c, t, units } = props;
    const rs = t.roughnessScattering;
    const divRef = useRef(null);
    const initRef = useRef(false);
    const curve = useAnalysisColors('roughnessScattering');
    const names = {
        rIdeal: rs.traceRIdeal, tIdeal: rs.traceTIdeal,
        rSpec: rs.traceRSpec, tSpec: rs.traceTSpec,
    };
    const traces = useMemo(() => buildScatterTraces({ ...props, names, colors: curve }), [
        props.lambda, props.R, props.T, props.R_spec, props.T_spec, props.TIS_inc, units, curve, t,
    ]);
    const config = chartConfig('scattering');
    // No dependency list, and the layout is rebuilt rather than memoized: see
    // plotSurface.js for why both matter.
    useEffect(() => {
        drawPlot(divRef.current, initRef,
            traces, buildScatterLayout(c, units, curve, rs.axisSpecular), config);
    });

    usePlotTeardown(divRef, initRef);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
