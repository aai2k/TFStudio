const { createElement: h } = React;

/**
 * Collapsible strip below the plot, so every analysis window opens its numbers
 * and its editors through the same header. The caller owns the open state and
 * supplies the body, which is mounted only while the section is open.
 *
 * A window can stack more than one: the tolerance windows put their per-layer
 * editor in a strip of its own above the results, because a table with one row
 * per interface needs the window's full width and cannot live in a popover.
 *
 *   label       section name, already localized
 *   count       number of rows behind the plot
 *   countLabel  count => string
 *   summary     text after the label, instead of count / countLabel
 *   actions     controls shown at the right-hand end of the header; they sit
 *               beside the toggle rather than inside it, since a button cannot
 *               be nested in a button
 */
export function ResultsSection({ label, count, countLabel, summary, open, setOpen, c, actions, children }) {
    const detail = summary != null ? summary : (countLabel ? countLabel(count) : null);
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
                detail != null && h('span', { style: { color: c.textDim } }, '·'),
                detail != null && h('span', { style: { color: c.textDim } }, detail),
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
export function ResultsGrid({ columns, rows, c, height = 185, fill = false }) {
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
    // `fill` is for a window whose table is the point rather than a footnote to
    // a plot: it takes the space left over instead of a fixed strip.
    return h('div', {
        style: fill
            ? { flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto', backgroundColor: c.bg }
            : { height, overflowY: 'auto', overflowX: 'auto', backgroundColor: c.bg, flexShrink: 0 },
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
