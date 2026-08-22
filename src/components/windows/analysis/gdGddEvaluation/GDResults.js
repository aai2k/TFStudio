import { ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { CenteredMessage, PlotArea } from '../chrome/layout.js';
import { GDChart } from './GDChart.js';

const { createElement: h, useMemo } = React;

// Stable identity for "no targets", so hiding them does not re-plot every frame.
const EMPTY_TARGETS = [];

export function GDResults({ c, t, text, state, view, exportMenu }) {
    const dt = t.dataTable;
    // A fresh bounds array on every render counts as a changed chart input and
    // re-plots the trace, so it is held stable across renders that do not move
    // the axis.
    const yRange = useMemo(
        () => state.yAuto ? view.autoRange?.range : [state.yMin, state.yMax],
        [state.yAuto, state.yMin, state.yMax, view.autoRange],
    );
    const targets = state.showTargets ? state.targets : EMPTY_TARGETS;
    return h(PlotArea, null,
        h('div', { style: { flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' } },
            view.plotData && view.plotData.lambda.length
                ? h(GDChart, {
                    data: view.plotData, meta: view.meta,
                    refLambda: state.refLam, showRef: state.showRef, c,
                    targets, yRange,
                    yInterval: state.yAuto ? view.autoRange?.interval : undefined,
                })
                : h(CenteredMessage, { c, message: text.noLayers }),
        ),
        h(ResultsSection, {
            c, label: dt.results, count: view.tableRows.length, countLabel: dt.rowCount,
            open: state.showTable, setOpen: state.setShowTable, actions: exportMenu,
        }, h(ResultsGrid, { columns: view.tableColumns, rows: view.tableRows, c })),
    );
}

export { CenteredMessage };
