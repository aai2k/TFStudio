/**
 * Layer sensitivity: how far the merit function moves when each layer alone is
 * perturbed, ranked so the layers the deposition has to hold tightest are the
 * ones at the top.
 */

import { EvalModeBadge } from '../../../SurfaceModeBar.js';
import { SpecVerdict } from '../../../SpecVerdict.js';
import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { csvFromRows, ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { AnalysisWindow, CenteredMessage, PlotArea } from '../chrome/layout.js';
import { SensitivityBars } from './SensitivityBars.js';
import { SensitivityControls } from './SensitivityControls.js';
import { sensitivityColumns, sensitivityRows } from './tableModel.js';
import { useLayerSensitivity } from './useLayerSensitivity.js';

const { createElement: h } = React;

export function LayerSensitivity({ c, theme, t }) {
    const state = useLayerSensitivity();
    const { design, operands, sensHasLayers, error, orderedRows } = state;
    const ls = t.layerSensitivity;
    const dt = t.dataTable;
    const columns = sensitivityColumns({ t, c, matColorMap: state.matColorMap });
    const rows = sensitivityRows(orderedRows, state.frontCount);
    const csv = useCsvExport(
        () => csvFromRows(columns, rows),
        () => `${(design?.name || 'design').replace(/[^\w.-]+/g, '_')}_sensitivity.csv`,
    );

    if (!design) return h(CenteredMessage, { c, message: ls.noDesign });
    if (!sensHasLayers) return h(CenteredMessage, { c, message: ls.noLayers });
    if (!operands.length) return h(CenteredMessage, { c, message: ls.noOperands });

    return h(AnalysisWindow, { c },
        h(SensitivityControls, { c, t, state }),
        h(PlotArea, null,
            error
                ? h(CenteredMessage, { c, message: error })
                : h(SensitivityBars, {
                    rows: orderedRows, matColorMap: state.matColorMap,
                    scale: state.scale, frontCount: state.frontCount, c,
                    xTitle: ls.axisLayer, yTitle: ls.axisSensitivity,
                }),
        ),
        h(ResultsSection, {
            c, label: dt.results, count: rows.length, countLabel: dt.rowCount,
            open: state.showTable, setOpen: state.setShowTable,
            actions: h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                h(EvalModeBadge, { design, c, t }),
                design?.qualifiers?.length > 0 && h(SpecVerdict, {
                    designs: state.specDesigns, resolveMat: state.resolveMat, c, t,
                    label: ls.specLabel,
                }),
                h(ExportMenu, {
                    c, enabled: rows.length > 0, ...csv,
                    labels: {
                        export: dt.export, copyCsv: dt.copyCsv, saveCsv: dt.saveCsv,
                        copied: dt.csvCopied, saved: dt.csvSaved,
                    },
                }),
            ),
        }, h(ResultsGrid, { columns, rows, c })),
    );
}
