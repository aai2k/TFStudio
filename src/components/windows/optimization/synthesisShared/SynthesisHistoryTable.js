import { matFriendlyName } from './materialNames.js';
import { matColorAlpha } from './materialColors.js';
import { runSeparatorIds } from './runBlocks.js';

const { createElement: h } = React;   // React is a window global (never imported)

// ── Shared synthesis history table ──────────────────────────────────────────────
// Needle's GenerationsTable and GE's CyclesTable ~identical: same th/td/
// sideBadge helpers and the same genNum/side/layers/mf/tot/time/dMF/material/
// restore columns. GE additionally shows a Needle/GE "type" badge column — passed
// in via the optional `typeColumn = { header, render(row) }` (inserted after the
// side column). Rows are reversed for display (newest first), matching both
// windows. `labels` carries the per-window locale strings.

const td = (content, style = {}) =>
    h('td', { style: { padding: '2px 5px', fontSize: 11, whiteSpace: 'nowrap', ...style } }, content);

const th = (label, w, c) => h('th', {
    style: {
        padding: '2px 5px', fontSize: 10, fontWeight: 700, color: c.textDim,
        textTransform: 'uppercase', letterSpacing: '0.04em',
        position: 'sticky', top: 0, background: c.panel,
        borderBottom: `1px solid ${c.border}`,
        width: w, textAlign: 'left', whiteSpace: 'nowrap',
    }
}, label);

function sideBadge(side, labels) {
    if (!side) return '—';
    const isBack = side === 'back';
    return h('span', {
        style: {
            padding: '1px 6px', borderRadius: 3, fontSize: 10,
            background: isBack ? '#42a5f51a' : '#ffa72622',
            color: isBack ? '#42a5f5' : '#ffa726',
            fontWeight: 600,
        }
    }, isBack ? labels.sideBack : labels.sideFront);
}

function dMFContent(dMF, c) {
    if (dMF == null) return '—';
    return dMF < 0
        ? h('span', { style: { color: c.success } }, dMF.toFixed(5))
        : h('span', { style: { color: '#ef5350' } }, `+${dMF.toFixed(5)}`);
}

function materialContent(mat, c) {
    if (!mat) return '—';
    return h('span', {
        title: matFriendlyName(mat),
        style: {
            display: 'inline-block', maxWidth: 92, verticalAlign: 'middle',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            padding: '1px 5px', borderRadius: 3, fontSize: 10,
            background: matColorAlpha(mat), color: c.text
        }
    }, matFriendlyName(mat));
}

function headerRow({ labels, showSide, typeColumn, c }) {
    return h('tr', null,
        th(labels.genCol,    36, c),
        showSide && th(labels.sideCol, 36, c),
        typeColumn && th(typeColumn.header, 52, c),
        th(labels.layersCol, 48, c),
        th(labels.mfCol,     80, c),
        th(labels.totCol,    64, c),
        th(labels.timeCol,   56, c),
        th(labels.dMFCol,    72, c),
        th(labels.matCol,   100, c),
        th('',               60, c),
    );
}

// The separator above a row that opens a Run block or follows a thin-start
// rescue, or none.
function separatorRows(row, { separatorIds, labels, colCount, c }) {
    const marks = [
        separatorIds.has(row.id) && labels.runSeparator(row.runNum),
        row.rescued && labels.rescueRow,
    ].filter(Boolean);
    if (!marks.length) return [];
    return [h('tr', { key: `${row.id}-run` },
        h('td', {
            colSpan: colCount,
            style: {
                padding: '3px 5px', fontSize: 10, fontWeight: 700,
                color: c.textDim, textTransform: 'uppercase',
                letterSpacing: '0.04em', whiteSpace: 'nowrap',
                borderTop: `1px solid ${c.border}`, background: c.panel,
            }
        }, marks.join(' · ')))];
}

function historyRow(row, { bestMF, showSide, typeColumn, labels, onRestore, c }) {
    const isBest = Math.abs(row.mf - bestMF) < 1e-12;
    return h('tr', {
        key: row.id,
        style: { background: isBest ? `${c.accent || '#ffa726'}1a` : 'transparent' }
    },
        td(row.genNum, { color: c.textDim }),
        showSide && td(sideBadge(row.side, labels)),
        typeColumn && td(typeColumn.render(row)),
        td(row.layerCount, { color: c.text }),
        td(row.mf.toFixed(6), {
            color: isBest ? c.success : c.text,
            fontWeight: isBest ? 700 : 400,
        }),
        td(row.tot != null ? row.tot.toFixed(0) : '—', { color: c.textDim }),
        td(row.tMs != null ? `${(row.tMs / 1000).toFixed(1)}s` : '—', { color: c.textDim }),
        td(dMFContent(row.dMF, c)),
        td(materialContent(row.insertMat, c)),
        h('td', { style: { padding: '2px 5px' } },
            h('button', {
                onClick: () => onRestore(row),
                style: {
                    padding: '1px 7px', fontSize: 10, cursor: 'pointer',
                    background: c.panel, color: c.text,
                    border: `1px solid ${c.border}`, borderRadius: 2,
                    fontFamily: 'inherit',
                }
            }, labels.restore)
        )
    );
}

export function SynthesisHistoryTable({ rows, bestMF, onRestore, showSide, c, labels, typeColumn = null }) {
    // Both the empty state and the table sit inside the flex:1 scroll container
    // (matches Needle's original; GE's bare empty-div is normalized to the same —
    // visually identical italic message).
    if (!rows.length) {
        return h('div', { style: { flex: 1, overflow: 'auto' } },
            h('div', { style: { padding: '12px 10px', color: c.textDim, fontSize: 11, fontStyle: 'italic' } },
                labels.noGens));
    }
    // Rows read newest first, and each Run press gets a separator above its
    // newest row, so rows from an earlier run are not read as part of the one on
    // screen (runBlocks.js).
    const display = [...rows].reverse();
    const separatorIds = runSeparatorIds(display);
    const colCount = 8 + (showSide ? 1 : 0) + (typeColumn ? 1 : 0);
    const rowOpts = { bestMF, showSide, typeColumn, labels, onRestore, c };

    return h('div', { style: { flex: 1, overflow: 'auto' } },
        h('table', { style: { borderCollapse: 'collapse', width: '100%' } },
            h('thead', null, headerRow({ labels, showSide, typeColumn, c })),
            h('tbody', null,
                display.flatMap(row => [
                    ...separatorRows(row, { separatorIds, labels, colCount, c }),
                    historyRow(row, rowOpts),
                ])
            )
        )
    );
}
