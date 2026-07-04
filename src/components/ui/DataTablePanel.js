const { createElement: h, useState } = React;

/**
 * Shared "show the plotted numbers as text" panel for analysis windows
 * (Admittance, E-field, Ellipsometry, GD/GDD, n(z), …). Mirrors the Optical
 * Evaluation data-table UX so every plot window exposes its underlying data
 * consistently: a collapsible header strip + a scrollable table + Copy CSV.
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

    const cols = (columns || []).map((col, i) => ({
        align: i === 0 ? 'left' : 'right',
        ...col,
    }));
    const data = rows || [];

    const fmtCell = (col, row) => {
        const v = row[col.key];
        if (col.fmt) return col.fmt(v, row);
        if (v == null) return '';
        return (typeof v === 'number') ? String(v) : String(v);
    };

    const buildCSV = () => {
        const header = cols.map(col => col.csv || col.key).join(',');
        const lines = data.map(row =>
            cols.map(col => {
                const v = row[col.key];
                return (v == null) ? '' : (typeof v === 'number' ? v : String(v).replace(/,/g, ';'));
            }).join(',')
        );
        return [header, ...lines].join('\n');
    };

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

    const thBase = {
        padding: '3px 8px', fontWeight: 600, fontSize: 11,
        borderBottom: `1px solid ${c.border}`,
        position: 'sticky', top: 0, backgroundColor: c.panel,
        userSelect: 'none', whiteSpace: 'nowrap',
    };
    const tdBase = {
        padding: '2px 8px', fontSize: 11,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
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

        // ── Table body ────────────────────────────────────────────────────────
        open && h('div', {
            style: { height: maxHeight, overflowY: 'auto', overflowX: 'auto', backgroundColor: c.bg }
        },
            h('table', { style: { width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' } },
                h('thead', null,
                    h('tr', null,
                        cols.map((col, i) =>
                            h('th', { key: i, style: { ...thBase, textAlign: col.align, color: col.color || c.textDim } }, col.label)
                        )
                    )
                ),
                h('tbody', null,
                    data.map((row, i) =>
                        h('tr', { key: i, style: { backgroundColor: i % 2 === 0 ? 'transparent' : c.panel + '55' } },
                            cols.map((col, j) =>
                                h('td', { key: j, style: { ...tdBase, textAlign: col.align, color: c.text } }, fmtCell(col, row))
                            )
                        )
                    )
                )
            )
        )
    );
}
