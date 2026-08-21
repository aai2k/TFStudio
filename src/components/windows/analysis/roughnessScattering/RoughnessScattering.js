/**
 * Interface Roughness / Scattering window for uncorrelated interface roughness.
 *
 * TIS(λ) = R(λ) · (4π · σ_eff · cosθ / λ)² and σ_eff² = Σ σ_i².
 * Reference: Macleod, Thin-Film Optical Filters, 5th ed., Eq. 16.30.
 */

import { EvalModeBadge } from '../../../SurfaceModeBar.js';
import { useMaterialRangeNotice } from '../../../materials/MaterialRangeNotice.js';
import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { csvFromRows, ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { AnalysisWindow, CenteredMessage, PlotArea } from '../chrome/layout.js';
import { RoughnessControls, RoughnessEditor, RoughnessEditorActions } from './RoughnessControls.js';
import { ScatterChart } from './ScatterChart.js';
import { scatterColumns, scatterRows } from './tableModel.js';
import { useRoughnessScattering } from './useRoughnessScattering.js';

const { createElement: h } = React;

function buildNotices({ state, rs, rangeNotice }) {
    const notices = [];
    if (state.error) notices.push({ label: state.error, tone: 'error' });
    if (state.activeSides.includes('back') && !state.hasBack) {
        notices.push({ label: rs.noBackLayers });
    }
    if (rangeNotice) notices.push(rangeNotice);
    return notices;
}

export function RoughnessScattering({ c, theme, t }) {
    const state = useRoughnessScattering();
    const { design, calc, units } = state;
    const rs = t.roughnessScattering;
    const dt = t.dataTable;
    const columns = scatterColumns(t, units, state.showCurves, calc);
    const rows = scatterRows(calc, state.showCurves);
    const rangeNotice = useMaterialRangeNotice(design, state.lambdaStart, state.lambdaEnd, t);
    const csv = useCsvExport(
        () => csvFromRows(columns, rows),
        () => `${(design?.name || 'design').replace(/[^\w.-]+/g, '_')}_scattering.csv`,
    );

    if (!design) return h(CenteredMessage, { c, message: rs.noDesign });
    if (!design.frontLayers?.length) return h(CenteredMessage, { c, message: rs.noLayers });

    return h(AnalysisWindow, { c },
        h(RoughnessControls, {
            c, t, rs, state, notices: buildNotices({ state, rs, rangeNotice }),
        }),
        h(PlotArea, null,
            calc
                ? h(ScatterChart, { calc, showCurves: state.showCurves, units, c, t })
                : h(CenteredMessage, { c, message: rs.computing }),
        ),
        h(ResultsSection, {
            c, label: rs.editorTitle, summary: `${state.nIfaces} ${rs.interfaces}`,
            open: state.showEditor, setOpen: state.setShowEditor,
            actions: h(RoughnessEditorActions, { c, rs, state }),
        }, h(RoughnessEditor, { c, rs, state })),
        h(ResultsSection, {
            c, label: dt.results, count: rows.length, countLabel: dt.rowCount,
            open: state.showTable, setOpen: state.setShowTable,
            actions: h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                calc && h('span', { style: { color: c.textDim, fontSize: 11, whiteSpace: 'nowrap' } },
                    `σ_eff = ${calc.sigmaEff.toFixed(2)} nm · ${state.nIfaces} ${rs.interfaces}`),
                h(EvalModeBadge, { design, c, t }),
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
