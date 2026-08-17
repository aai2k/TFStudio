import { PlotlyChart } from './PlotlyChart.js';

const { createElement: h } = React;

export function ChartPanel(props) {
    const {
        data, showCurves, design, showTargets, c, theme,
        editMode, editTool, editCurve, editPol, editKind, lamRange, yRange,
        spectralUnit, onCreateTarget, onEditTarget, onDeleteTarget,
        error, showEmpty, oe,
    } = props;
    return h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
        h('div', { style: { flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' } },
            h(PlotlyChart, {
                data, showCurves, targets: design.meritOperands, showTargets, c, theme,
                editMode, editTool, editCurve, editPol, editKind, lamRange, yRange,
                spectralUnit, overlays: design.measuredCurves,
                onCreateTarget, onEditTarget, onDeleteTarget,
            }),
            error && h('div', {
                style: {
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#ef5350', fontSize: 12, padding: 16, textAlign: 'center',
                    background: c.bg
                }
            }, `Error: ${error}`),
            (!error && showEmpty) && h('div', {
                style: {
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: c.textDim, fontSize: 12, fontStyle: 'italic',
                    background: c.bg
                }
            }, oe.noFrontLayers)
        )
    );
}
