import { ResultsSection } from '../../../ui/ResultsSection.js';
import { DataTable } from './DataTable.js';

const { createElement: h } = React;

export function ResultsPanel({ data, showCurves, showTable, setShowTable, c, oe }) {
    return h(ResultsSection, {
        c, label: oe.results, count: data?.lambda?.length || 0, countLabel: oe.rowCount,
        open: showTable, setOpen: setShowTable,
    }, data && h(DataTable, { data, showCurves, c, oe }));
}
