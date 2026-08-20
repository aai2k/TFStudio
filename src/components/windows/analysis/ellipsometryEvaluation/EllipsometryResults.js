import { ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { CenteredMessage, PlotArea } from '../chrome/layout.js';
import { EllipsometryChart } from './EllipsometryChart.js';

const { createElement: h } = React;

export function buildEllipsometryTable(mode, data) {
    const xColumn = mode === 'spectral'
        ? { key: 'x', label: 'λ (nm)', align: 'left', fmt: value => value.toFixed(2) }
        : { key: 'x', label: 'AOI (°)', align: 'left', fmt: value => value.toFixed(2) };
    const columns = [
        xColumn,
        { key: 'psi', label: 'Ψ (°)', fmt: value => value.toFixed(4) },
        { key: 'delta', label: 'Δ (°)', fmt: value => value.toFixed(4) },
    ];
    const rows = (data && data.x)
        ? data.x.map((x, index) => ({ x, psi: data.psi[index], delta: data.delta[index] }))
        : [];
    return { columns, rows };
}

export function EllipsometryResults({ c, t, text, state, table, hasData, exportMenu }) {
    const dt = t.dataTable;
    return h(PlotArea, null,
        h('div', { style: { flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' } },
            hasData
                ? h(EllipsometryChart, {
                    data: state.data, c,
                    show: { psi: state.showPsi, delta: state.showDelta },
                })
                : h(CenteredMessage, { c, message: text.noLayers }),
        ),
        h(ResultsSection, {
            c, label: dt.results, count: table.rows.length, countLabel: dt.rowCount,
            open: state.showTable, setOpen: state.setShowTable, actions: exportMenu,
        }, h(ResultsGrid, { columns: table.columns, rows: table.rows, c })),
    );
}

export { CenteredMessage };
