const { createElement: h } = React;

/**
 * Collapsible results strip for the analysis windows, so every plot window
 * exposes its numbers through the same header. The caller owns the open state
 * and supplies the body, which is mounted only while the section is open.
 *
 * It is also the window's one strip of chrome below the plot, so the export
 * control rides in its header rather than costing a band of its own.
 *
 *   label       section name, already localized
 *   count       number of rows behind the plot
 *   countLabel  count => string
 *   actions     controls shown at the right-hand end of the header; they sit
 *               beside the toggle rather than inside it, since a button cannot
 *               be nested in a button
 */
export function ResultsSection({ label, count, countLabel, open, setOpen, c, actions, children }) {
    return h('section', {
        style: { flexShrink: 0, borderTop: `1px solid ${c.border}`, backgroundColor: c.bg },
    },
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', backgroundColor: c.field,
                paddingRight: actions ? 8 : 0,
            },
        },
            h('button', {
                onClick: () => setOpen(current => !current),
                'aria-expanded': open,
                style: {
                    flex: 1, minWidth: 0, height: 30,
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '0 12px', border: 'none', backgroundColor: 'transparent',
                    color: c.text, cursor: 'pointer', outline: 'none', textAlign: 'left',
                    fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 11,
                },
            },
                h('svg', { width: 10, height: 10, viewBox: '0 0 10 10', fill: 'none' },
                    h('path', {
                        d: open ? 'M2 3.5l3 3 3-3' : 'M3.5 2l3 3-3 3',
                        stroke: 'currentColor', strokeWidth: 1.3,
                        strokeLinecap: 'round', strokeLinejoin: 'round',
                    })),
                h('span', { style: { fontWeight: 400 } }, label),
                h('span', { style: { color: c.textDim } }, '·'),
                h('span', { style: { color: c.textDim } }, countLabel(count)),
            ),
            actions,
        ),
        open && children,
    );
}

/**
 * Scrolling table for a `ResultsSection` body.
 *
 *   columns  [{ key, label, align?, color?, fmt? }] - `fmt` formats for display
 *            only; `csvFromRows` always writes the raw value
 *   rows     plain objects keyed by column.key
 */
export function ResultsGrid({ columns, rows, c, height = 185 }) {
    const cols = (columns || []).map((col, index) => ({
        align: index === 0 ? 'left' : 'right',
        ...col,
    }));
    const data = rows || [];
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
    const cell = (col, row) => {
        const value = row[col.key];
        if (col.fmt) return col.fmt(value, row);
        return value == null ? '' : String(value);
    };
    return h('div', {
        style: {
            height, overflowY: 'auto', overflowX: 'auto',
            backgroundColor: c.bg, flexShrink: 0,
        },
    },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' } },
            h('thead', null,
                h('tr', null, cols.map((col, index) => h('th', {
                    key: index,
                    style: { ...thBase, textAlign: col.align, color: col.color || c.textDim },
                }, col.label))),
            ),
            h('tbody', null, data.map((row, index) => h('tr', {
                key: index,
                style: { backgroundColor: index % 2 === 0 ? 'transparent' : c.panel + '55' },
            }, cols.map((col, columnIndex) => h('td', {
                key: columnIndex,
                style: { ...tdBase, textAlign: col.align, color: c.text },
            }, cell(col, row)))))),
        ),
    );
}

/** Raw values, one row per sample. Commas inside text become semicolons. */
export function csvFromRows(columns, rows) {
    const cols = columns || [];
    if (!cols.length) return '';
    const header = cols.map(col => col.csv || col.label || col.key).join(',');
    const lines = (rows || []).map(row => cols.map(col => {
        const value = row[col.key];
        if (value == null) return '';
        return typeof value === 'number' ? value : String(value).replace(/,/g, ';');
    }).join(','));
    return [header, ...lines].join('\n');
}
