import {
    SPECTRA_CONFIG, spectraColors, spectraLayout, spectraTraces,
} from './figure.js';

const { createElement: h, useEffect, useRef } = React;

export function SpectraChart({ c, data, t }) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const sp = t.processSim;

    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        const colors = spectraColors(c);
        const traces = spectraTraces(data, colors, sp);
        const layout = spectraLayout(data.quantity, colors);
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, traces, layout, SPECTRA_CONFIG);
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, traces, layout, SPECTRA_CONFIG);
        }
    }, [c, data.lambdas, data.baseline, data.stepCurves, data.liveCurve,
        data.currentStep, data.showSteps, data.quantity, sp]);

    useEffect(() => {
        const element = divRef.current;
        if (!element) return;
        const observer = new ResizeObserver(() => {
            if (initRef.current) Plotly.Plots.resize(element);
        });
        observer.observe(element);
        return () => {
            observer.disconnect();
            if (element && initRef.current) {
                try { Plotly.purge(element); } catch (_) {}
                initRef.current = false;
            }
        };
    }, []);

    let chart = h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: 200 } });
    if (typeof Plotly === 'undefined') {
        chart = h('div', {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textDim },
        }, 'Plotly not loaded');
    }
    return chart;
}
