import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { buildSensitivityFigure } from './figure.js';

const { createElement: h, useEffect, useMemo, useRef } = React;

export function SensitivityBars(props) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const colors = useAnalysisColors('layerSensitivity');
    const figure = useMemo(() => buildSensitivityFigure({ ...props, colors }), [
        props.rows, props.matColorMap, props.scale, props.frontCount,
        props.c.bg, props.c.panel, props.c.border, props.c.text, colors,
    ]);

    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, figure.data, figure.layout, {
                responsive: true,
                displayModeBar: false,
            });
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, figure.data, figure.layout);
        }
    }, [figure]);

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
