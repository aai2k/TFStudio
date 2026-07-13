import { DataTablePanel } from '../../../ui/DataTablePanel.js';
import { EllipsometryChart } from './EllipsometryChart.js';

const { createElement: h } = React;

export function CenteredMessage({ c, message }) {
    return h('div', {
        style: {
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontFamily: 'system-ui, -apple-system, sans-serif',
        },
    }, message);
}

export function buildEllipsometryTable(mode, data) {
    const xColumn = mode === 'spectral'
        ? { key: 'x', label: 'λ (nm)', align: 'left', fmt: value => value.toFixed(2) }
        : { key: 'x', label: 'AOI (°)', align: 'left', fmt: value => value.toFixed(2) };
    const columns = [
        xColumn,
        { key: 'psi', label: 'Ψ (°)', fmt: value => value.toFixed(4) },
        { key: 'delta', label: 'Δ (°)', fmt: value => value.toFixed(4) },
    ];
    const rows = (data && data.x)
        ? data.x.map((x, index) => ({ x, psi: data.psi[index], delta: data.delta[index] }))
        : [];
    return { columns, rows };
}

export function EllipsometryResults({ c, t, text, mode, data, validLayerCount }) {
    const table = buildEllipsometryTable(mode, data);
    const hasData = validLayerCount && data && data.x.length;
    return h('div', {
        style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    },
        h('div', { style: { flex: 1, minHeight: 0, overflow: 'hidden' } },
            hasData
                ? h(EllipsometryChart, { data, c })
                : h(CenteredMessage, { c, message: text.noLayers }),
        ),
        hasData
            ? h(DataTablePanel, { columns: table.columns, rows: table.rows, c, t })
            : null,
    );
}
