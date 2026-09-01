/**
 * Structural n(z) and k(z) step profiles sampled at one wavelength.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { useMaterialLambdaNotice } from '../../../materials/MaterialRangeNotice.js';
import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { csvFromRows, ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { AnalysisWindow, CenteredMessage, PlotArea } from '../chrome/layout.js';
import { ProfilerControls } from './ProfilerControls.js';
import { RIChart } from './RIChart.js';
import { RITotalChart } from './RITotalChart.js';
import { buildProfileViewModel } from './profileViewModel.js';
import { useProfilerState } from './useProfilerState.js';

const { createElement: h } = React;

export function RefractiveIndexProfiler({ c, theme, t }) {
    const rp = t.riProfile;
    const dt = t.dataTable;
    const { design } = useDesign();
    const state = useProfilerState(design, rp);
    const view = buildProfileViewModel(state.side, state.profile, state.regions);
    const rangeNotice = useMaterialLambdaNotice(design, state.lambda, t, state.setLambda);
    const csv = useCsvExport(
        () => csvFromRows(view.tableColumns, view.tableRows),
        () => `${(design?.name || 'design').replace(/[^\w.-]+/g, '_')}_index_profile.csv`,
    );

    if (!design) return h(CenteredMessage, { c, message: rp.noDesign });

    return h(AnalysisWindow, { c },
        h(ProfilerControls, { c, t, rp, state, notices: [rangeNotice].filter(Boolean) }),
        h(PlotArea, null,
            view.hasProfile
                ? (view.isTotal
                    ? h(RITotalChart, {
                        regions: state.regions, quantity: state.quantity,
                        matColorMap: state.matColorMap, c,
                    })
                    : h(RIChart, {
                        profile: state.profile, quantity: state.quantity,
                        matColorMap: state.matColorMap, c,
                    }))
                : h(CenteredMessage, { c, message: rp.noLayers }),
        ),
        h(ResultsSection, {
            c, label: dt.results, count: view.tableRows.length, countLabel: dt.rowCount,
            open: state.showTable, setOpen: state.setShowTable,
            actions: h(ExportMenu, {
                c, enabled: view.tableRows.length > 0, ...csv,
                labels: {
                    export: dt.export, copyCsv: dt.copyCsv, saveCsv: dt.saveCsv,
                    copied: dt.csvCopied, saved: dt.csvSaved,
                },
            }),
        }, h(ResultsGrid, { columns: view.tableColumns, rows: view.tableRows, c })),
    );
}
