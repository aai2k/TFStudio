/**
 * Integral Values - weighted averages of T(lambda), R(lambda), and A(lambda).
 * Spectrum evaluation follows the active surface mode and cone configuration;
 * weighting and integration are implemented in the physics utility modules.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { useMaterialRangeNotice } from '../../../materials/MaterialRangeNotice.js';
import { ConeBadge, EvalModeBadge } from '../../../SurfaceModeBar.js';
import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { csvFromRows, ResultsSection } from '../../../ui/ResultsSection.js';
import { AnalysisWindow, CenteredMessage, PlotArea } from '../chrome/layout.js';
import { IntegralControls } from './Controls.js';
import { OverlayChart } from './OverlayChart.js';
import { ResultsTable } from './ResultsTable.js';
import { SpectrumTableEditor } from './SpectrumTableEditor.js';
import { hasLayersForMode } from './integralModel.js';
import { exportColumns, exportRows } from './exportModel.js';
import { useIntegralValues } from './useIntegralValues.js';

const { createElement: h } = React;

function editorTable(model) {
    if (!model.editor.open) return null;
    if (model.editor.target === 'source') return model.builder.source.table;
    if (model.editor.target === 'detector') return model.builder.detector.table;
    return null;
}

function editorLabel(model, iv) {
    if (model.editor.target === 'source') return iv.source;
    if (model.editor.target === 'detector') return iv.detector;
    return '';
}

// The weighting a value comes from is the caption the plot needs, and the title
// sits in margin the chart already reserves rather than costing another band.
function chartTitle(selected) {
    if (!selected) return '';
    return `${selected.label}: ${selected.char}(λ) × ${selected.weighting.label}`;
}

export function IntegralValues({ c, theme, t }) {
    const iv = t.integralValues;
    const dt = t.dataTable;
    const { design, evalMode } = useDesign();
    const model = useIntegralValues(design, evalMode);
    const columns = exportColumns(t);
    const rows = exportRows(model.integrals, model.results);
    const rangeNotice = useMaterialRangeNotice(
        design, model.params.lambdaStart, model.params.lambdaEnd, t);
    const csv = useCsvExport(
        () => csvFromRows(columns, rows),
        () => `${(design?.name || 'design').replace(/[^\w.-]+/g, '_')}_integrals.csv`,
    );

    if (!design) return h(CenteredMessage, { c, message: iv.noDesign });
    if (!hasLayersForMode(design, evalMode)) {
        return h(CenteredMessage, { c, message: iv.noLayers });
    }

    return h(AnalysisWindow, { c },
        h(IntegralControls, { c, t, model, notices: [
            model.evaluationError && { label: t.analysisEvaluation.failed, tone: 'error' },
            rangeNotice,
        ].filter(Boolean) }),
        h(PlotArea, null,
            model.spectrum && model.selected
                ? h(OverlayChart, {
                    spectrum: model.spectrum, char: model.selected.char,
                    weighting: model.selected.weighting, title: chartTitle(model.selected),
                    minMaxMarks: model.selectedResult, c, theme,
                })
                : h(CenteredMessage, { c, message: iv.computing }),
        ),
        h(ResultsSection, {
            c, label: dt.results, count: rows.length, countLabel: dt.rowCount,
            open: model.showTable, setOpen: model.setShowTable,
            actions: h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                h(EvalModeBadge, { design, c, t }),
                h(ConeBadge, { design, c, t }),
                h(ExportMenu, {
                    c, enabled: rows.length > 0, ...csv,
                    labels: {
                        export: dt.export, copyCsv: dt.copyCsv, saveCsv: dt.saveCsv,
                        copied: dt.csvCopied, saved: dt.csvSaved,
                    },
                }),
            ),
        }, h(ResultsTable, {
            integrals: model.integrals, results: model.results,
            selectedKey: model.selKey, setSelectedKey: model.setSelKey,
            onPatch: model.onPatchCustom, onRemove: model.onRemoveCustom, c, t,
        })),
        h(SpectrumTableEditor, {
            open: model.editor.open,
            initialTable: editorTable(model),
            label: editorLabel(model, iv),
            onApply: model.applyTable,
            onCancel: () => model.setEditor({ open: false, target: null }),
            c, t,
        }),
    );
}
