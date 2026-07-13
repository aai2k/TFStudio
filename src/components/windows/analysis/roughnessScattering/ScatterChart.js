import { buildScatterLayout, buildScatterTraces } from './figure.js';

const { createElement: h, useEffect, useMemo, useRef } = React;

export function ScatterChart(props) {
    const { c, units } = props;
    const divRef = useRef(null);
    const initRef = useRef(false);
    const traces = useMemo(() => buildScatterTraces(props), [
        props.lambda, props.R, props.T, props.R_spec, props.T_spec, props.TIS_inc, units,
    ]);
    const layout = useMemo(() => buildScatterLayout(c, units), [c, units]);

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
        const element = divRef.current;
        if (!element) return;
        const observer = new ResizeObserver(() => {
            if (initRef.current) Plotly.Plots.resize(element);
        });
        observer.observe(element);
        return () => {
            observer.disconnect();
            if (element) Plotly.purge(element);
        };
    }, []);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
