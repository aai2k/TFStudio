import { ResultsSection } from '../../../ui/ResultsSection.js';
import { DataTable } from './DataTable.js';

const { createElement: h } = React;

/**
 * The strip under the plot: the row count and the export control. The badges
 * saying what the spectrum is computed for are in the badge row above it
 * (chrome/badgeRow.js).
 */
export function ResultsPanel({
    data, showCurves, yScale, spectralUnit, showTable, setShowTable, c, t, oe, exportMenu,
}) {
    return h(ResultsSection, {
        c, label: oe.results, count: data?.lambda?.length || 0, countLabel: oe.rowCount,
        open: showTable, setOpen: setShowTable,
        actions: exportMenu,
    }, data && h(DataTable, { data, showCurves, yScale, spectralUnit, units: t.units, c, oe }));
}
