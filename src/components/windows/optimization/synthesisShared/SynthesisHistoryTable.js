import { matFriendlyName } from './materialNames.js';
import { matColorAlpha } from './materialColors.js';

const { createElement: h } = React;   // React is a window global (never imported)

// ── Shared synthesis history table ──────────────────────────────────────────────
// Needle's GenerationsTable and GE's CyclesTable ~identical: same th/td/
// sideBadge helpers and the same genNum/side/layers/mf/tot/time/dMF/material/
// restore columns. GE additionally shows a Needle/GE "type" badge column — passed
// in via the optional `typeColumn = { header, render(row) }` (inserted after the
// side column). Rows are reversed for display (newest first), matching both
// windows. `labels` carries the per-window locale strings.
export function SynthesisHistoryTable({ rows, bestMF, onRestore, showSide, c, labels, typeColumn = null }) {
    const th = (label, w) => h('th', {
        style: {
            padding: '2px 5px', fontSize: 10, fontWeight: 700, color: c.textDim,
            textTransform: 'uppercase', letterSpacing: '0.04em',
            position: 'sticky', top: 0, background: c.panel,
            borderBottom: `1px solid ${c.border}`,
            width: w, textAlign: 'left', whiteSpace: 'nowrap',
        }
    }, label);

    const td = (content, style = {}) =>
        h('td', { style: { padding: '2px 5px', fontSize: 11, whiteSpace: 'nowrap', ...style } }, content);

    const sideBadge = (side) => {
        if (!side) return '—';
        const isBack = side === 'back';
        return h('span', {
            style: {
                padding: '1px 6px', borderRadius: 3, fontSize: 10,
                background: isBack ? '#42a5f51a' : '#ffa72622',
                color: isBack ? '#42a5f5' : '#ffa726',
                fontWeight: 600,
            }
        }, isBack ? 'B' : 'F');
    };

    // Both the empty state and the table sit inside the flex:1 scroll container
    // (matches Needle's original; GE's bare empty-div is normalized to the same —
    // visually identical italic message).
    if (!rows.length) {
        return h('div', { style: { flex: 1, overflow: 'auto' } },
            h('div', { style: { padding: '12px 10px', color: c.textDim, fontSize: 11, fontStyle: 'italic' } },
                labels.noGens));
    }

    return h('div', { style: { flex: 1, overflow: 'auto' } },
        h('table', { style: { borderCollapse: 'collapse', width: '100%' } },
            h('thead', null,
                h('tr', null,
                    th(labels.genCol,    36),
                    showSide && th('Side', 36),
                    typeColumn && th(typeColumn.header, 52),
                    th(labels.layersCol, 48),
                    th(labels.mfCol,     80),
                    th(labels.totCol,    64),
                    th(labels.timeCol,   56),
                    th(labels.dMFCol,    72),
                    th(labels.matCol,   100),
                    th('',               60),
                )
            ),
            h('tbody', null,
                [...rows].reverse().map(row => {
                    const isBest = Math.abs(row.mf - bestMF) < 1e-12;
                    return h('tr', {
                        key: row.id,
                        style: { background: isBest ? `${c.accent || '#ffa726'}1a` : 'transparent' }
                    },
                        td(row.genNum, { color: c.textDim }),
                        showSide && td(sideBadge(row.side)),
                        typeColumn && td(typeColumn.render(row)),
                        td(row.layerCount, { color: c.text }),
                        td(row.mf.toFixed(6), {
                            color: isBest ? c.success : c.text,
                            fontWeight: isBest ? 700 : 400,
                        }),
                        td(row.tot != null ? row.tot.toFixed(0) : '—', { color: c.textDim }),
                        td(row.tMs != null ? `${(row.tMs / 1000).toFixed(1)}s` : '—', { color: c.textDim }),
                        td(row.dMF == null ? '—'
                            : row.dMF < 0
                                ? h('span', { style: { color: c.success } }, row.dMF.toFixed(5))
                                : h('span', { style: { color: '#ef5350' } }, `+${row.dMF.toFixed(5)}`)),
                        td(row.insertMat
                            ? h('span', {
                                title: matFriendlyName(row.insertMat),
                                style: {
                                    display: 'inline-block', maxWidth: 92, verticalAlign: 'middle',
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    padding: '1px 5px', borderRadius: 3, fontSize: 10,
                                    background: matColorAlpha(row.insertMat), color: c.text
                                }
                              }, matFriendlyName(row.insertMat))
                            : '—'
                        ),
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
                })
            )
        )
    );
}
