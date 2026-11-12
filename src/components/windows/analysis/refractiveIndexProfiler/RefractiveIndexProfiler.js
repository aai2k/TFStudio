/**
 * Structural n(z) and k(z) step profiles sampled at one wavelength.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { useMaterialsLambdaNotice } from '../../../materials/MaterialRangeNotice.js';
import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { csvFromRows, ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { BadgeRow } from '../chrome/badgeRow.js';
import { environmentTable } from '../chrome/environmentTable.js';
import { AnalysisWindow, CenteredMessage, PlotArea } from '../chrome/layout.js';
import { ProfilerControls } from './ProfilerControls.js';
import { RIChart } from './RIChart.js';
import { RITotalChart } from './RITotalChart.js';
import { buildProfileTable, buildProfileViewModel } from './profileViewModel.js';
import { useProfilerState } from './useProfilerState.js';

const { createElement: h } = React;

// The table: the profile shown, or under All every environment's in turn.
function shownTable(state, view, t) {
    const own = { columns: view.tableColumns, rows: view.tableRows };
    if (!state.sets) return own;
    return environmentTable(state.sets.map(set => ({
        env: set.env, table: buildProfileTable(view.isTotal, set.profile, set.regions || [], t.units),
    })), t.environments.environment) || { ...own, rows: [] };
}

export function RefractiveIndexProfiler({ c, theme, t }) {
    const rp = t.riProfile;
    const dt = t.dataTable;
    const { design } = useDesign();
    const state = useProfilerState(design, rp);
    const view = buildProfileViewModel(state.side, state.profile, state.regions, t.units);
    const table = shownTable(state, view, t);
    const rangeNotice = useMaterialsLambdaNotice(state.materials, state.lambda, t, state.setLambda);
    const csv = useCsvExport(
        () => csvFromRows(table.columns, table.rows),
        () => `${(design?.name || 'design').replace(/[^\w.-]+/g, '_')}_index_profile.csv`,
    );

    return h(AnalysisWindow, { c },
        h(ProfilerControls, { c, t, rp, state, notices: [rangeNotice].filter(Boolean) }),
        h(PlotArea, null,
            view.hasProfile
                ? (view.isTotal
                    ? h(RITotalChart, {
                        regions: state.regions, sets: state.sets, quantity: state.quantity,
                        matColorMap: state.matColorMap, c, units: t.units,
                    })
                    : h(RIChart, {
                        profile: state.profile, sets: state.sets, quantity: state.quantity,
                        matColorMap: state.matColorMap, c, depthAxis: t.eField.xAxisTitle,
                    }))
                : h(CenteredMessage, { c, message: rp.noLayers }),
        ),
        h(BadgeRow, { c, t, design, environment: state.environment, evalBadge: false }),
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
