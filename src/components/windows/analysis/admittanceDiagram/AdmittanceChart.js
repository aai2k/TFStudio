import { admittanceLayout, admittanceTraces } from './chartFigure.js';

const { createElement: h, useEffect, useRef } = React;

function usePlotInitialization({ divRef, initializedRef, series, matColorMap, colors, config }) {
    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        Plotly.newPlot(divRef.current, admittanceTraces(series, matColorMap, colors), admittanceLayout(series, colors), config);
        initializedRef.current = true;
        const ro = new ResizeObserver(() => {
            if (divRef.current && initializedRef.current) Plotly.Plots.resize(divRef.current);
        });
        ro.observe(divRef.current);
        return () => {
            ro.disconnect();
            if (divRef.current) { Plotly.purge(divRef.current); }
            initializedRef.current = false;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

function usePlotData({ divRef, initializedRef, series, matColorMap, colors, config, c }) {
    useEffect(() => {
        if (!divRef.current || !initializedRef.current || typeof Plotly === 'undefined') return;
        Plotly.react(divRef.current, admittanceTraces(series, matColorMap, colors), admittanceLayout(series, colors), config);
    }, [series, matColorMap, c]); // eslint-disable-line react-hooks/exhaustive-deps
}

function usePlotTheme({ divRef, initializedRef, colors, c }) {
    useEffect(() => {
        if (!divRef.current || !initializedRef.current || typeof Plotly === 'undefined') return;
        Plotly.relayout(divRef.current, {
            paper_bgcolor: colors.panel, plot_bgcolor: colors.bg,
            'font.color': colors.text,
            'xaxis.gridcolor': colors.border, 'yaxis.gridcolor': colors.border,
            'legend.bgcolor': colors.panel + 'cc', 'legend.bordercolor': colors.border,
        });
    }, [c]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function AdmittanceChart({ series, matColorMap, c, theme, t }) {
    const divRef = useRef(null);
    const initializedRef = useRef(false);
    const colors = {
        bg: c.bg || '#1e1e1e',
        panel: c.panel || '#252526',
        border: c.border || '#3a3a3a',
        text: c.text || '#cccccc',
    };
    const config = {
        displaylogo: false, responsive: true, displayModeBar: true,
        modeBarButtonsToRemove: ['select2d', 'lasso2d'],
        toImageButtonOptions: { format: 'png', filename: 'TFStudio_admittance', scale: 2 },
    };

    usePlotInitialization({ divRef, initializedRef, series, matColorMap, colors, config });
    usePlotData({ divRef, initializedRef, series, matColorMap, colors, config, c });
    usePlotTheme({ divRef, initializedRef, colors, c });

    if (typeof Plotly === 'undefined') {
        return h('div', {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textDim },
        }, 'Plotly not loaded — check index.html');
    }
    return h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: 200 } });
}
