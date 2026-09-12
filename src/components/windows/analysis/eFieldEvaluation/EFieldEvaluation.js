/**
 * Electric-field profile computed by the left-partial transfer matrix method.
 * Reference: Macleod, Thin-Film Optical Filters, section 3, Eqs. 3.5-3.6.
 *
 * The settings menu chooses what the vertical axis reads and which component
 * of the field it reads; see yScale.js for the quantities and the conversion
 * between them.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { useMaterialLambdaNotice } from '../../../materials/MaterialRangeNotice.js';
import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { csvFromRows, ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { AnalysisWindow, CenteredMessage, PlotArea } from '../chrome/layout.js';
import { EFieldChart } from './EFieldChart.js';
import { EFieldControls } from './EFieldControls.js';
import { buildProfileTable } from './profileViewModel.js';
import { useEFieldState } from './useEFieldState.js';

const { createElement: h } = React;

const EMPTY_TABLE = { columns: [], rows: [] };

export function EFieldEvaluation({ c, theme, t }) {
    const ef = t.eField;
    const dt = t.dataTable;
    const { design } = useDesign();
    const state = useEFieldState(design);
    const table = buildProfileTable(state.profile, state.pol, ef, state.display) || EMPTY_TABLE;
    const rangeNotice = useMaterialLambdaNotice(design, state.lambda, t, state.setLambda);
    const csv = useCsvExport(
        () => csvFromRows(table.columns, table.rows),
        () => `${(design?.name || 'design').replace(/[^\w.-]+/g, '_')}_efield.csv`,
    );

    if (!design) return h(CenteredMessage, { c, message: ef.noDesign });

    return h(AnalysisWindow, { c },
        h(EFieldControls, { c, t, ef, state, notices: [rangeNotice].filter(Boolean) }),
        h(PlotArea, null,
            state.profile
                ? h(EFieldChart, {
                    profileData: state.profile, pol: state.pol,
                    matColorMap: state.matColorMap, c, ef, display: state.display,
                })
                : h(CenteredMessage, { c, message: ef.noLayers }),
        ),
        h(ResultsSection, {
            c, label: dt.results, count: table.rows.length, countLabel: dt.rowCount,
            open: state.showTable, setOpen: state.setShowTable,
            actions: h(ExportMenu, {
                c, enabled: table.rows.length > 0, ...csv,
                labels: {
                    export: dt.export, copyCsv: dt.copyCsv, saveCsv: dt.saveCsv,
                    copied: dt.csvCopied, saved: dt.csvSaved,
                },
            }),
        }, h(ResultsGrid, { columns: table.columns, rows: table.rows, c })),
    );
}
