/**
 * Stress window: what a coating does to the part it is on.
 *
 * Per film, the stress it carries, the strain energy stored in it, the factor
 * by which that energy exceeds what delaminating the interface below it would
 * cost, and the shear that peaks at the coating's edge. For the part, the
 * bending force, the radius it leaves, the centre deflection, the total strain
 * energy and the cracking parameter.
 *
 * Model and sources: Klokholm (1987), Suhir (2000), Klein (2000, 2001), with
 * the temperature bookkeeping from the Essential Macleod manual. No stress
 * model is as good as the optical one; these numbers say which design is worse
 * than which, and roughly by how much.
 */

import { EvalModeBadge } from '../../../SurfaceModeBar.js';
import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { csvFromRows, ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { AnalysisWindow, CenteredMessage, PlotArea } from '../chrome/layout.js';
import { StressChart } from './StressChart.js';
import { StressControls, stressNotices } from './StressControls.js';
import { filmColumns, filmRows, wholeColumns, wholeRows } from './tableModel.js';
import { useStressAnalysis } from './useStressAnalysis.js';

const { createElement: h } = React;

export function StressAnalysis({ c, theme, t }) {
    const sa = t.stressAnalysis;
    const dt = t.dataTable;
    const state = useStressAnalysis();
    const { design, result } = state;
    const bothSides = !!result?.bothSides;
    const columns = filmColumns(sa, bothSides);
    const rows = result ? filmRows(result.rows, sa) : [];
    const csv = useCsvExport(
        () => csvFromRows(columns, rows),
        () => `${(design?.name || 'design').replace(/[^\w.-]+/g, '_')}_stress.csv`,
    );

    if (!design) return h(CenteredMessage, { c, message: sa.noDesign });
    if (!rows.length) return h(CenteredMessage, { c, message: sa.noLayers });

    const drawable = rows.some(row => row.stressMPa != null);
    return h(AnalysisWindow, { c },
        h(StressControls, { c, t, sa, state, notices: stressNotices(result, t) }),
        h(PlotArea, null,
            drawable
                ? h(StressChart, {
                    rows, matColorMap: result.matColorMap, bothSides, sa, c,
                })
                : h(CenteredMessage, { c, message: sa.noStress }),
        ),
        h(ResultsSection, {
            c, label: sa.wholePart, summary: sa.wholePartSummary,
            open: state.showWhole, setOpen: state.setShowWhole,
            actions: h(EvalModeBadge, { design, c, t }),
        }, h(ResultsGrid, { columns: wholeColumns(sa), rows: wholeRows(result.whole, sa), c, height: 130 })),
        h(ResultsSection, {
            c, label: sa.perFilm, count: rows.length, countLabel: dt.rowCount,
            open: state.showTable, setOpen: state.setShowTable,
            actions: h(ExportMenu, {
                c, enabled: rows.length > 0, ...csv,
                labels: {
                    export: dt.export, copyCsv: dt.copyCsv, saveCsv: dt.saveCsv,
                    copied: dt.csvCopied, saved: dt.csvSaved,
                },
            }),
        }, h(ResultsGrid, { columns, rows, c })),
    );
}
