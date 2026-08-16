import { csvFromRows, ResultsGrid } from './ResultsSection.js';

const { createElement: h, useState } = React;

/**
 * "Show the plotted numbers as text" panel for the Admittance, E-field,
 * Ellipsometry and n(z) windows: a collapsible header strip over a scrollable
 * table, with Copy CSV. The table body is the shared `ResultsGrid`, so these
 * windows and the Optical Evaluation / dispersion Results sections format their
 * numbers identically.
 *
 * Props:
 *   columns  [{ key, label, align?, color?, fmt? }]
 *              key   – property read from each row (also the CSV header unless `csv`)
 *              label – column header text (already localized by the caller)
 *              align – 'left' | 'right' (default 'right'; first column defaults 'left')
 *              fmt   – (value, row) => string for DISPLAY (CSV always uses the raw value)
 *              csv   – override CSV header name (defaults to key)
 *   rows     array of plain objects keyed by column.key
 *   c, t     theme colors + locale
 *   maxHeight table body height in px (default 200)
 *   defaultOpen start expanded (default false)
 */
export function DataTablePanel({ columns, rows, c, t, maxHeight = 200, defaultOpen = false }) {
    const [open, setOpen]     = useState(defaultOpen);
    const [copied, setCopied] = useState(false);
    const dt = (t && t.dataTable) || { data: 'Data', copyCsv: 'Copy CSV', copied: 'Copied', rows: 'rows' };

    const cols = columns || [];
    const data = rows || [];

    // This panel's CSV is headed by the column keys rather than their labels.
    const buildCSV = () => csvFromRows(
        cols.map(col => ({ ...col, csv: col.csv || col.key })), data);

    const copy = (e) => {
        e.stopPropagation();
        const csv = buildCSV();
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(csv).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
            }).catch(() => {});
        }
    };

    return h('div', { style: { flexShrink: 0, borderTop: `1px solid ${c.border}` } },
        // ── Header strip (toggle + Copy CSV) ──────────────────────────────────
        h('div', {
            onClick: () => setOpen(o => !o),
            style: {
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '3px 8px', cursor: 'pointer', userSelect: 'none',
                backgroundColor: c.bg, color: c.textDim, fontSize: 11,
                fontFamily: 'system-ui, -apple-system, sans-serif',
            }
        },
            h('span', null, `${open ? '▼' : '▶'} ${dt.data} (${data.length} ${dt.rows})`),
            open && h('button', {
                onClick: copy,
                title: dt.copyCsv,
                style: {
                    border: `1px solid ${c.border}`, borderRadius: 3,
                    background: copied ? (c.accent + '30') : c.panel,
                    color: c.text, cursor: 'pointer', fontSize: 11,
                    padding: '2px 8px', fontFamily: 'system-ui, -apple-system, sans-serif',
                }
            }, copied ? dt.copied : dt.copyCsv)
        ),

        open && h(ResultsGrid, { columns: cols, rows: data, c, height: maxHeight })
    );
}
