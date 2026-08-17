import {
    SPECTRA_CONFIG, spectraColors, spectraLayout, spectraTraces,
} from './figure.js';
import { drawPlot, usePlotTeardown } from '../../../ui/plotSurface.js';

const { createElement: h, useEffect, useRef } = React;

export function SpectraChart({ c, data, t }) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const sp = t.processSim;

    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        const colors = spectraColors(c);
        drawPlot(divRef.current, initRef,
            spectraTraces(data, colors, sp),
            spectraLayout(data.quantity, colors),
            SPECTRA_CONFIG);
    });

    usePlotTeardown(divRef, initRef);

    let chart = h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: 200 } });
    if (typeof Plotly === 'undefined') {
        chart = h('div', {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textDim },
        }, 'Plotly not loaded');
    }
    return chart;
}
