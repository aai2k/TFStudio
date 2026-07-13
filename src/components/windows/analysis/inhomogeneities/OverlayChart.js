import { buildOverlayLayout, buildOverlayTraces } from './figure.js';

const { createElement: h, useEffect, useMemo, useRef } = React;

export function OverlayChart({ baseline, perturbed, channel, c }) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const traces = useMemo(
        () => buildOverlayTraces(baseline, perturbed, channel),
        [baseline, perturbed, channel],
    );
    const layout = useMemo(() => buildOverlayLayout(c), [c]);

    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, traces, layout, { responsive: true, displayModeBar: false });
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, traces, layout);
        }
    }, [traces, layout]);

    useEffect(() => {
        const el = divRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el);
        return () => { ro.disconnect(); if (el) Plotly.purge(el); };
    }, []);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
