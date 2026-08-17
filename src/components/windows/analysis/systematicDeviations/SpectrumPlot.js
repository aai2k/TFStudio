import { buildSpectrumLayout, buildSpectrumTraces } from './spectrumFigure.js';
import { drawPlot, usePlotTeardown } from '../../../ui/plotSurface.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h, useEffect, useMemo, useRef } = React;

export function SpectrumPlot({ baseline, deviated, channel, showBaseline, c }) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const curve = useAnalysisColors('systematicDeviations');
    const traces = useMemo(
        () => buildSpectrumTraces(baseline, deviated, channel, showBaseline, curve),
        [baseline, deviated, channel, showBaseline, curve]
    );
    // No dependency list, and the layout is rebuilt rather than memoized: see
    // plotSurface.js for why both matter.
    useEffect(() => {
        drawPlot(divRef.current, initRef, traces, buildSpectrumLayout(c),
            { responsive: true, displayModeBar: false });
    });

    usePlotTeardown(divRef, initRef);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
