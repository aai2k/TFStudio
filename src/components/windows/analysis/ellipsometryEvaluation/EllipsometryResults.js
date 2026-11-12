import { ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { BadgeRow } from '../chrome/badgeRow.js';
import { CenteredMessage, PlotArea } from '../chrome/layout.js';
import { EllipsometryChart } from './EllipsometryChart.js';

const { createElement: h } = React;

/**
 * The table of one sweep, or under All, when `sets` holds each environment's
 * sweep as `{ env, data }`, Ψ and Δ of each environment in columns named after
 * it, every environment computed on the one grid.
 */
export function buildEllipsometryTable(mode, data, xLabels, sets = null) {
    const xColumn = mode === 'spectral'
        ? { key: 'x', label: xLabels.lambda, align: 'left', fmt: value => value.toFixed(2) }
        : { key: 'x', label: xLabels.aoi, align: 'left', fmt: value => value.toFixed(2) };
    // The first sweep's columns are psi and delta; under All each later
    // environment's carry its place in the list, psi1 and delta1 for the second.
    const parts = sets || [{ env: null, data }];
    const key = (name, k) => (k ? `${name}${k}` : name);
    const suffix = env => (env ? ` (${env.label})` : '');
    const columns = [
        xColumn,
        ...parts.flatMap(({ env }, k) => [
            { key: key('psi', k), label: `Ψ (°)${suffix(env)}`, fmt: value => value.toFixed(4) },
            { key: key('delta', k), label: `Δ (°)${suffix(env)}`, fmt: value => value.toFixed(4) },
        ]),
    ];
    const rows = (data && data.x)
        ? data.x.map((x, index) => {
            const row = { x };
            parts.forEach((part, k) => {
                row[key('psi', k)] = part.data.psi[index];
                row[key('delta', k)] = part.data.delta[index];
            });
            return row;
        })
        : [];
    return { columns, rows };
}

/**
 * The plot, the row under it with the Environment droplist on a design with
 * environments, and the Results strip.
 */
export function EllipsometryResults({ c, t, text, state, table, hasData, overlays, xLabel, exportMenu }) {
    const dt = t.dataTable;
    return h(PlotArea, null,
        h('div', { style: { flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' } },
            hasData
                ? h(EllipsometryChart, {
                    data: state.data, sets: state.sets, c, overlays, xLabel, spectral: state.mode === 'spectral', names: t.legendNames,
                    show: { psi: state.showPsi, delta: state.showDelta },
                })
                : h(CenteredMessage, { c, message: text.noLayers }),
        ),
        h(BadgeRow, { c, t, environment: state.environment, evalBadge: false }),
        h(ResultsSection, {
            c, label: dt.results, count: table.rows.length, countLabel: dt.rowCount,
            open: state.showTable, setOpen: state.setShowTable, actions: exportMenu,
        }, h(ResultsGrid, { columns: table.columns, rows: table.rows, c })),
    );
}

export { CenteredMessage };
