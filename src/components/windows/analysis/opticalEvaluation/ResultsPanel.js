import { EvalModeBadge, ConeBadge } from '../../../SurfaceModeBar.js';
import { ResultsSection } from '../../../ui/ResultsSection.js';
import { DataTable } from './DataTable.js';

const { createElement: h } = React;

/**
 * The strip under the plot: the row count, the export control, and the badges
 * saying which surface the spectrum describes. The badges live here rather than
 * on the control row because they report a Design Editor setting rather than
 * offering one, and this strip is the only chrome that is always on screen.
 */
export function ResultsPanel({ data, showCurves, yScale, showTable, setShowTable, c, t, oe, design, exportMenu }) {
    return h(ResultsSection, {
        c, label: oe.results, count: data?.lambda?.length || 0, countLabel: oe.rowCount,
        open: showTable, setOpen: setShowTable,
        actions: h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h(EvalModeBadge, { design, c, t }),
            h(ConeBadge, { design, c, t }),
            exportMenu,
        ),
    }, data && h(DataTable, { data, showCurves, yScale, c, oe }));
}
