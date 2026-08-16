import { ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { GDAxisPanel } from './GDControls.js';
import { GDChart } from './GDChart.js';

const { createElement: h } = React;

function CenteredMessage({ c, message }) {
    return h('div', {
        style: {
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontFamily: 'system-ui, -apple-system, sans-serif',
        },
    }, message);
}

export function GDResults({ c, t, text, state, view }) {
    const dt = t.dataTable;
    return h('div', {
        style: {
            flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
        },
    },
        h('div', { style: { flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' } },
            view.plotData && view.plotData.lambda.length
                ? h(GDChart, {
                    data: view.plotData, meta: view.meta,
                    refLambda: state.refLam, showRef: state.showRef, c,
                    targets: state.showTargets ? state.targets : [],
                    yRange: state.yAuto
                        ? view.autoRange?.range
                        : [state.yMin, state.yMax],
                })
                : h(CenteredMessage, { c, message: text.noLayers }),
        ),
        h(GDAxisPanel, { c, text, state, autoRange: view.autoRange }),
        h(ResultsSection, {
            c, label: dt.results, count: view.tableRows.length, countLabel: dt.rowCount,
            open: state.showTable, setOpen: state.setShowTable,
        }, h(ResultsGrid, { columns: view.tableColumns, rows: view.tableRows, c })),
    );
}

export { CenteredMessage };
