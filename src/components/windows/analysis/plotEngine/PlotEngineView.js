import { CurveRow } from './CurveRow.js';
import { SurfacePanel } from './SurfacePanel.js';
import { MultiCurveChart, SurfaceChart } from './charts.js';

const { createElement: h } = React;

function ModeToggle({ plotMode, setPlotMode, c, pe }) {
    return h('div', {
        style: {
            padding: '6px 10px', borderBottom: `1px solid ${c.border}`,
            background: c.panel, display: 'flex', alignItems: 'center', gap: 6,
        },
    }, ['2d', '3d'].map(mode => h('button', {
        key: mode,
        onClick: () => setPlotMode(mode),
        style: {
            flex: 1, padding: '3px 8px', fontSize: 11, cursor: 'pointer',
            borderRadius: 3, fontFamily: 'system-ui, -apple-system, sans-serif',
            border: `1px solid ${plotMode === mode ? c.accent : c.border}`,
            background: plotMode === mode ? c.accent : 'transparent',
            color: plotMode === mode ? '#fff' : c.text, fontWeight: plotMode === mode ? 600 : 400,
        },
    }, mode === '2d' ? (pe.mode2D || '2D Curves') : (pe.mode3D || '3D Surface'))));
}

function CurveList({ curvePlot, c, t, pe }) {
    const { curves, addCurve, updateCurve, deleteCurve } = curvePlot;
    return h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
        h('div', {
            style: {
                padding: '6px 10px', borderBottom: `1px solid ${c.border}`,
                background: c.panel, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            },
        },
        h('span', { style: { fontSize: 11, fontWeight: 600, color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.4 } },
            pe.curves || `Curves (${curves.length})`),
        h('button', {
            onClick: addCurve,
            style: {
                padding: '2px 10px', background: c.accent, color: '#fff',
                border: 'none', borderRadius: 3, fontSize: 11, cursor: 'pointer',
                fontFamily: 'system-ui, -apple-system, sans-serif',
            },
        }, pe.addCurve || '+ Add curve')),
        h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto' } },
            curves.map(curve => h(CurveRow, {
                key: curve.id,
                curve,
                onUpdate: (patch) => updateCurve(curve.id, patch),
                onDelete: () => deleteCurve(curve.id),
                c, t,
            }))),
    );
}

function Sidebar({ curvePlot, surfacePlot, design, c, t, pe }) {
    const { plotMode, setPlotMode } = surfacePlot;
    return h('div', {
        style: {
            width: 320, flexShrink: 0, borderRight: `1px solid ${c.border}`,
            background: c.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        },
    },
    h(ModeToggle, { plotMode, setPlotMode, c, pe }),
    plotMode === '2d'
        ? h(CurveList, { curvePlot, c, t, pe })
        : h(SurfacePanel, {
            spec: surfacePlot.surfaceSpec,
            onUpdate: surfacePlot.updateSurface,
            onCompute: surfacePlot.computeSurfaceNow,
            computing: surfacePlot.computing,
            progress: surfacePlot.progress,
            design,
            result: surfacePlot.surfaceResult,
            c, t,
        }));
}

function ChartArea({ curvePlot, surfacePlot, design, c, t }) {
    return h('div', {
        style: { flex: 1, minWidth: 0, minHeight: 0, position: 'relative', overflow: 'hidden' },
    }, surfacePlot.plotMode === '2d'
        ? h(MultiCurveChart, { curves: curvePlot.curves, results: curvePlot.results, c })
        : h(SurfaceChart, {
            result: surfacePlot.surfaceResult,
            spec: surfacePlot.surfaceSpec,
            design, c, t,
        }));
}

export function PlotEngineView({ curvePlot, surfacePlot, design, c, t, pe }) {
    return h('div', {
        style: {
            display: 'flex', flexDirection: 'row', height: '100%',
            background: c.bg, color: c.text, overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
        },
    },
    h(Sidebar, { curvePlot, surfacePlot, design, c, t, pe }),
    h(ChartArea, { curvePlot, surfacePlot, design, c, t }));
}
