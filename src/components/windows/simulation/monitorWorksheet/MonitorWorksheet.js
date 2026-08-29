/**
 * Optical monitoring worksheet: whether the design can be terminated on a
 * monitor at all, layer by layer, on the witness chips it would be run on.
 *
 * The table is the decision surface: chip assignment and monitoring wavelength
 * are edited in it. The chart under it shows the same run as the monitor sees
 * it, and the two share the window across a divider the user places, because a
 * long run needs the chart given room and a short one needs it given back.
 * See utils/monitoring/monoSim/worksheet.js for what the columns mean.
 */

import { SplitPane } from '../../../docking/SplitPane.js';
import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { csvFromRows, ResultsGrid } from '../../../ui/ResultsSection.js';
import { NoticeBadge } from '../../analysis/chrome/popover.js';
import { AnalysisWindow, CenteredMessage, PlotArea } from '../../analysis/chrome/layout.js';
import { WorksheetChart } from './WorksheetChart.js';
import { WorksheetControls } from './WorksheetControls.js';
import { worksheetColumns, worksheetRows } from './tableModel.js';
import { useMonitorWorksheet } from './useMonitorWorksheet.js';

const { createElement: h } = React;

const SPLIT_CHILDREN = [{ id: 'worksheet-table' }, { id: 'worksheet-chart' }];

export function MonitorWorksheet({ c, t }) {
    const state = useMonitorWorksheet();
    const { design, rows, error, poorCount } = state;
    const mw = t.monitorWorksheet;
    const dt = t.dataTable;
    const columns = worksheetColumns({
        t, c, matColorMap: state.matColorMap,
        onChip: state.setChipForStep, onLambda: state.setLambdaForStep,
    });
    const tableRows = worksheetRows(rows, state.matNames);
    const csv = useCsvExport(
        () => csvFromRows(columns, tableRows),
        () => `${(design?.name || 'design').replace(/[^\w.-]+/g, '_')}_monitor_worksheet.csv`,
    );

    if (!design) return h(CenteredMessage, { c, message: mw.noDesign });
    if (!state.stepCount) return h(CenteredMessage, { c, message: mw.noLayers });

    return h(AnalysisWindow, { c },
        h(WorksheetControls, {
            c, t, state,
            trailing: [
                poorCount > 0 && h(NoticeBadge, {
                    key: 'poor', c, label: mw.poorLabel,
                    notices: [{ label: mw.poorCount(poorCount), detail: mw.poorDetail }],
                }),
                h(ExportMenu, {
                    key: 'export',
                    c, enabled: tableRows.length > 0, ...csv,
                    labels: {
                        export: dt.export, copyCsv: dt.copyCsv, saveCsv: dt.saveCsv,
                        copied: dt.csvCopied, saved: dt.csvSaved,
                    },
                }),
            ],
        }),
        h(PlotArea, null,
            h(SplitPane, {
                c,
                node: { direction: 'v', sizes: state.session.splitSizes, children: SPLIT_CHILDREN },
                onSizesChange: sizes => state.setField('splitSizes', sizes),
            },
                error
                    ? h(CenteredMessage, { c, message: error })
                    : h(ResultsGrid, { columns, rows: tableRows, c, fill: true }),
                error
                    ? null
                    : h(WorksheetChart, {
                        rows, c, t, layersInView: state.session.layersInView,
                    }),
            ),
        ),
    );
}
