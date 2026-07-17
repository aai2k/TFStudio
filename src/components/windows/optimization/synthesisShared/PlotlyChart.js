const { createElement: h } = React;   // React is a window global (never imported)

// ── Plotly chart lifecycle primitive ────────────────────────────────────────────
// Owns the Plotly lifecycle for the synthesis trend charts: newPlot-then-react, a
// ResizeObserver that re-fits the chart to its box on panel/docking resizes, and a
// purge on unmount. Callers supply `build()` (returns { traces, layout }, invoked
// inside the effect so it sees fresh closures) and a `deps` gate.
//
// The plot div stays mounted at all times and the "no data" message is an overlay,
// rather than swapping the div out when data clears. Swapping it out orphaned the
// initialized-flag, so the next run react()'d onto a div that was never newPlot'd
// and rendered blank until the tab was toggled. When `hasData` goes false the graph
// is purged and the flag reset so a fresh run always newPlot's cleanly.
function drawPlotlyChart(div, hasData, build, cfg, initRef) {
    if (!div || typeof Plotly === 'undefined') return;
    if (!hasData) {
        if (initRef.current) {
            try { Plotly.purge(div); } catch (_) {}
            initRef.current = false;
        }
        return;
    }
    const { traces, layout } = build();
    if (!initRef.current) {
        Plotly.newPlot(div, traces, layout, cfg);
        initRef.current = true;
    } else {
        Plotly.react(div, traces, layout, cfg);
    }
}

export function PlotlyChart({ build, hasData, empty, deps = [], config, c }) {
    const { useRef, useEffect } = React;
    const divRef  = useRef(null);
    const initRef = useRef(false);
    const cfg = config || { responsive: true, displayModeBar: false };

    useEffect(() => {
        drawPlotlyChart(divRef.current, hasData, build, cfg, initRef);
    }, [hasData, ...deps]);   // eslint-disable-line react-hooks/exhaustive-deps

    // Re-fit on PANEL resize (responsive:true only listens to WINDOW resizes).
    useEffect(() => {
        const el = divRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(() => {
            if (divRef.current && typeof Plotly !== 'undefined') {
                try { Plotly.Plots.resize(divRef.current); } catch (_) {}
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Purge the graph on unmount so it doesn't leak per docking-tab switch.
    useEffect(() => () => {
        if (divRef.current && typeof Plotly !== 'undefined') {
            try { Plotly.purge(divRef.current); } catch (_) {}
        }
        initRef.current = false;
    }, []);

    return h('div', { style: { position: 'relative', width: '100%', height: '100%' } },
        h('div', { ref: divRef, style: { width: '100%', height: '100%' } }),
        !hasData && empty && h('div', {
            style: {
                position: 'absolute', inset: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                color: (c && c.textDim) || '#888', fontSize: 11, fontStyle: 'italic',
                pointerEvents: 'none',
            }
        }, empty)
    );
}
