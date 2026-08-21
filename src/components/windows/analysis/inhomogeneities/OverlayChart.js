import { buildOverlayLayout, buildOverlayTraces } from './figure.js';
import { drawPlot, usePlotTeardown } from '../../../ui/plotSurface.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { chartConfig } from '../chrome/plot.js';

const { createElement: h, useEffect, useMemo, useRef } = React;

export function OverlayChart({ baseline, perturbed, showCurves, c, t }) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const curve = useAnalysisColors('inhomogeneities');
    const names = {
        homogeneous: t.inhomogeneities.traceHomogeneous,
        graded: t.inhomogeneities.traceWithInterlayers,
    };
    const traces = useMemo(
        () => buildOverlayTraces(baseline, perturbed, showCurves, curve, names),
        [baseline, perturbed, showCurves, curve, t],
    );
    const config = chartConfig('interlayers');
    // No dependency list, and the layout is rebuilt rather than memoized: see
    // plotSurface.js for why both matter.
    useEffect(() => {
        drawPlot(divRef.current, initRef, traces, buildOverlayLayout(c), config);
    });

    usePlotTeardown(divRef, initRef);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
