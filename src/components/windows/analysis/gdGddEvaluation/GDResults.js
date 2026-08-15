import { DataTablePanel } from '../../../ui/DataTablePanel.js';
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
                })
                : h(CenteredMessage, { c, message: text.noLayers }),
        ),
        h(GDAxisPanel, { c, text, state }),
        h(DataTablePanel, { columns: view.tableColumns, rows: view.tableRows, c, t }),
    );
}

export { CenteredMessage };
