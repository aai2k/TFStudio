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
import { provisionalMark } from '../../optimization/provisionalMark.js';
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
    const columns = sensitivityColumns({
        t, c, matColorMap: state.matColorMap,
        provisional: state.provisional, tip: t.meritFunctionEditor.provisionalTip,
    });
    const rows = sensitivityRows(orderedRows, state.frontCount, design);
    const csv = useCsvExport(
        () => csvFromRows(columns, rows),
        () => `${(design?.name || 'design').replace(/[^\w.-]+/g, '_')}_sensitivity.csv`,
    );

    if (!sensHasLayers) return h(CenteredMessage, { c, message: ls.noLayers });
    if (!operands.length) return h(CenteredMessage, { c, message: ls.noOperands });
    // Under a cone the ranking comes from the analysis worker alone.
    let note = error;
    if (state.busy) note = t.analysisEvaluation.computing;
    else if (state.failed) note = t.analysisEvaluation.failed;
    const chartMark = provisionalMark(state.provisional, t.meritFunctionEditor.provisionalTip);

    // The ranking is what the window is for, so the table gets the height and
    // the badges and export ride on the control row rather than on a strip
    // header. The bar chart shows the shape of the same numbers and opens below.
    return h(AnalysisWindow, { c },
        h(SensitivityControls, {
            c, t, state,
            trailing: [
                h(EvalModeBadge, { key: 'mode', design, c, t }),
                design?.qualifiers?.length > 0 && h(SpecVerdict, {
                    key: 'spec',
                    designs: state.specDesigns, c, t,
                    label: ls.specLabel,
                }),
                h(ExportMenu, {
                    key: 'export',
                    c, enabled: rows.length > 0 && !note, ...csv,
                    labels: {
                        export: dt.export, copyCsv: dt.copyCsv, saveCsv: dt.saveCsv,
                        copied: dt.csvCopied, saved: dt.csvSaved,
                    },
                }),
            ],
        }),
        h(PlotArea, null,
            note
                ? h(CenteredMessage, { c, message: note })
                : h(ResultsGrid, { columns, rows, c, fill: true }),
        ),
        h(ResultsSection, {
            c, label: ls.chartTitle, summary: `${rows.length} ${ls.layers}`,
            open: state.showChart, setOpen: state.setShowChart,
        }, h('div', { title: chartMark.title, style: { height: 220, backgroundColor: c.bg, opacity: chartMark.opacity } },
            note
                ? null
                : h(SensitivityBars, {
                    rows: orderedRows, matColorMap: state.matColorMap,
                    scale: state.scale, frontCount: state.frontCount, c,
                    xTitle: ls.axisLayer, yTitle: ls.axisSensitivity,
                }),
        )),
    );
}
