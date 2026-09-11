import { ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { CenteredMessage, PlotArea } from '../chrome/layout.js';
import { GDChart } from './GDChart.js';
import { gdGddTargetColor } from './gdTargets.js';

const { createElement: h, useMemo } = React;

// Stable identity for "no targets", so hiding them does not re-plot every frame.
const EMPTY_TARGETS = [];

export function GDResults({ c, t, text, state, view, exportMenu, yRange, editor }) {
    const dt = t.dataTable;
    // The editor sizes a point target's handle against the plotted span. A
    // fresh range object on every render would rebuild the handles each frame.
    const lamRange = useMemo(() => ({
        min: Math.min(state.lamStart, state.lamEnd), max: Math.max(state.lamStart, state.lamEnd),
    }), [state.lamStart, state.lamEnd]);
    // Editing shows the targets whatever the switch says: what can be picked
    // up has to be on the plot.
    const targets = state.showTargets || editor.editMode ? state.targets : EMPTY_TARGETS;
    return h(PlotArea, null,
        h('div', { style: { flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' } },
            view.plotData && view.plotData.lambda.length
                ? h(GDChart, {
                    data: view.plotData, meta: view.meta,
                    refLambda: state.refLam, showRef: state.showRef, c,
                    targets, yRange,
                    yInterval: state.yAuto ? view.autoRange?.interval : undefined,
                    xLabel: t.spectralAxis.nm,
                    editMode: editor.editMode, editTool: editor.editTool, lamRange,
                    drawColor: gdGddTargetColor(state.target),
                    onCreate: editor.onCreate, onEdit: editor.onEdit, onDelete: editor.onDelete,
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
