import { buildOverlayLayout, buildOverlayTraces } from './figure.js';
import { drawPlot, usePlotTeardown } from '../../../ui/plotSurface.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h, useEffect, useMemo, useRef } = React;

export function OverlayChart({ baseline, perturbed, channel, c }) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const curve = useAnalysisColors('inhomogeneities');
    const traces = useMemo(
        () => buildOverlayTraces(baseline, perturbed, channel, curve),
        [baseline, perturbed, channel, curve],
    );
    // No dependency list, and the layout is rebuilt rather than memoized: see
    // plotSurface.js for why both matter.
    useEffect(() => {
        drawPlot(divRef.current, initRef, traces, buildOverlayLayout(c),
            { responsive: true, displayModeBar: false });
    });

    usePlotTeardown(divRef, initRef);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
