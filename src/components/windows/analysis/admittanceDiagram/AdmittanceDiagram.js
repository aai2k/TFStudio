/**
 * Admittance diagram: the locus of the stack's equivalent admittance as the
 * coating is built up layer by layer, drawn in the Y plane or in the reflection
 * coefficient plane.
 * Reference: Macleod, Thin-Film Optical Filters, chapter 3.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { useMaterialRangeNotice } from '../../../materials/MaterialRangeNotice.js';
import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { csvFromRows, ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { AnalysisWindow, CenteredMessage, PlotArea } from '../chrome/layout.js';
import { AdmittanceChart } from './AdmittanceChart.js';
import { AdmittanceControls } from './AdmittanceControls.js';
import { tableColumns } from './tableModel.js';
import { useAdmittanceDiagram } from './useAdmittanceDiagram.js';

const { createElement: h } = React;

function plotBody({ state, ad, c, theme, t }) {
    if (state.error) return h(CenteredMessage, { c, message: ad.calcError(state.error) });
    if (!state.hasData) {
        return h(CenteredMessage, {
            c, message: state.side === 'back' ? ad.noBackLayers : ad.noLayers,
        });
    }
    return h(AdmittanceChart, {
        series: state.series, matColorMap: state.matColorMap,
        matName: state.matName, c, theme, t,
    });
}

export function AdmittanceDiagram({ c, theme, t }) {
    const ad = t.admittance;
    const dt = t.dataTable;
    const { design } = useDesign();
    const state = useAdmittanceDiagram(design);
    const columns = tableColumns(t);
    const rangeNotice = useMaterialRangeNotice(design, state.lambda, state.lambda, t);
    const csv = useCsvExport(
        () => csvFromRows(columns, state.tableRows),
        () => `${(design?.name || 'design').replace(/[^\w.-]+/g, '_')}_admittance.csv`,
    );

    if (!design) return h(CenteredMessage, { c, message: ad.noDesign });

    return h(AnalysisWindow, { c },
        h(AdmittanceControls, { c, t, state, notices: [rangeNotice].filter(Boolean) }),
        h(PlotArea, null, plotBody({ state, ad, c, theme, t })),
        h(ResultsSection, {
            c, label: dt.results, count: state.tableRows.length, countLabel: dt.rowCount,
            open: state.showTable, setOpen: state.setShowTable,
            actions: h(ExportMenu, {
                c, enabled: state.tableRows.length > 0, ...csv,
                labels: {
                    export: dt.export, copyCsv: dt.copyCsv, saveCsv: dt.saveCsv,
                    copied: dt.csvCopied, saved: dt.csvSaved,
                },
            }),
        }, h(ResultsGrid, { columns, rows: state.tableRows, c })),
    );
}
