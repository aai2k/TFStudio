import { matFriendlyName } from './materialNames.js';

const { createElement: h } = React;   // React is a window global (never imported)

// ── Shared Top-Designs (Pareto front) panel ─────────────────────────────────────
// Lists the Pareto-optimal generations (best MF at each layer count). `genPrefix`
// labels the generation number ("Gen N" for needle/GE, "#N" for structural). The
// insert-material column renders per row only for generations that carry one.
export function TopDesignsPanel({ topDesigns, bestMF, onRestore, c, labels, genPrefix = 'Gen ' }) {
    if (!topDesigns.length) return null;
    return h('div', { style: {
        borderTop: `1px solid ${c.border}`, background: c.panel,
        flexShrink: 0, maxHeight: 140, display: 'flex', flexDirection: 'column',
    } },
        h('div', { style: {
            padding: '3px 8px', fontSize: 10, fontWeight: 700, color: c.textDim,
            textTransform: 'uppercase', letterSpacing: '0.05em',
            borderBottom: `1px solid ${c.border}`, flexShrink: 0,
        } }, labels.topDesigns),
        h('div', { style: { flex: 1, overflow: 'auto' } },
            h('table', { style: { borderCollapse: 'collapse', width: '100%' } },
                h('tbody', null,
                    topDesigns.map(gen => {
                        const isBest = Math.abs(gen.mf - bestMF) < 1e-12;
                        return h('tr', { key: gen.id },
                            h('td', { style: { padding: '2px 8px', fontSize: 11, color: c.textDim, width: 56 } },
                                `${genPrefix}${gen.genNum}`),
                            h('td', { style: { padding: '2px 8px', fontSize: 11, color: c.text, width: 60 } },
                                `${gen.layerCount} lyr`),
                            h('td', { style: { padding: '2px 8px', fontSize: 11, fontWeight: isBest ? 700 : 400, color: isBest ? c.success : c.text } },
                                gen.mf.toFixed(6)),
                            gen.insertMat && h('td', {
                                style: {
                                    padding: '2px 8px', fontSize: 10, color: c.textDim,
                                    maxWidth: 92, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                },
                                title: matFriendlyName(gen.insertMat),
                            }, matFriendlyName(gen.insertMat)),
                            h('td', { style: { padding: '2px 8px' } },
                                h('button', {
                                    onClick: () => onRestore(gen),
                                    style: {
                                        padding: '1px 7px', fontSize: 10, cursor: 'pointer',
                                        background: c.panel, color: c.text,
                                        border: `1px solid ${c.border}`, borderRadius: 2,
                                    }
                                }, labels.restore))
                        );
                    })
                )
            )
        )
    );
}
