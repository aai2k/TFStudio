const { createElement: h, useMemo, useState } = React;

export function MeritEliminationTable({ c, dc, analysis, busy, progress, resultMsg, applyCandidate }) {
    const [sort, setSort] = useState({ key: 'deltaMF', direction: 1 });
    const rows = useMemo(() => {
        const next = [...(analysis?.candidates || [])];
        next.sort((a, b) => {
            const av = sort.key === 'layer' ? `${a.side}:${String(a.layerIndex).padStart(6, '0')}` : a[sort.key];
            const bv = sort.key === 'layer' ? `${b.side}:${String(b.layerIndex).padStart(6, '0')}` : b[sort.key];
            return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * sort.direction;
        });
        return next;
    }, [analysis, sort]);
    const chooseSort = key => setSort(current => ({
        key, direction: current.key === key ? -current.direction : 1,
    }));
    const th = (label, key) => h('th', {
        onClick: () => chooseSort(key),
        style: {
            position: 'sticky', top: 0, padding: '5px 8px', textAlign: key === 'materialId' ? 'left' : 'right',
            background: c.panel, color: c.textDim, borderBottom: `1px solid ${c.border}`,
            cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 10,
        },
    }, `${label}${sort.key === key ? (sort.direction > 0 ? ' ▲' : ' ▼') : ''}`);

    if (busy) return h('div', {
        style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.textDim },
    }, progress?.total
        ? dc.analyzingProgress(progress.done, progress.total, progress.removed)
        : progress?.removed ? dc.analyzingAccepted(progress.removed) : dc.analyzingHint);

    return h('div', { style: { flex: 1, minHeight: 0, overflow: 'auto' } },
        resultMsg && h('div', {
            style: { padding: '7px 10px', color: c.accent, borderBottom: `1px solid ${c.border}` },
        }, resultMsg),
        !analysis
            ? h('div', { style: { padding: 24, textAlign: 'center', color: c.textDim } },
                dc.meritPrompt)
            : rows.length === 0
            ? h('div', { style: { padding: 24, textAlign: 'center', color: c.textDim } },
                dc.meritNoCandidates)
            : h('table', { style: { width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' } },
                h('thead', null, h('tr', null,
                    th(dc.colLayer, 'layer'),
                    th(dc.colMaterial, 'materialId'),
                    th(dc.colThickness, 'thickness'),
                    th(dc.mfAfter, 'mfAfter'),
                    th(dc.deltaMF, 'deltaMF'),
                    h('th', { style: { background: c.panel, borderBottom: `1px solid ${c.border}`, width: 90 } }),
                )),
                h('tbody', null, rows.map((candidate, index) => h('tr', {
                    key: `${candidate.side}:${candidate.layerId}`,
                    style: { background: index % 2 ? c.panel + '33' : 'transparent' },
                },
                    h('td', { style: { padding: '4px 8px', textAlign: 'right' } },
                        `${candidate.side === 'front' ? dc.sideFrontShort : dc.sideBackShort}${candidate.layerIndex + 1}`),
                    h('td', { style: { padding: '4px 8px' } }, candidate.materialId),
                    h('td', { style: { padding: '4px 8px', textAlign: 'right' } }, `${candidate.thickness.toFixed(4)} ${dc.unitNm}`),
                    h('td', { style: { padding: '4px 8px', textAlign: 'right' } }, candidate.mfAfter.toFixed(7)),
                    h('td', {
                        style: { padding: '4px 8px', textAlign: 'right', color: candidate.deltaMF > 0 ? c.error : c.success },
                    }, `${candidate.deltaMF >= 0 ? '+' : ''}${candidate.deltaMF.toExponential(4)}`),
                    h('td', { style: { padding: '3px 8px', textAlign: 'right' } }, h('button', {
                        onClick: () => applyCandidate(candidate),
                        style: {
                            padding: '2px 9px', border: `1px solid ${c.accent}`, borderRadius: 3,
                            color: c.accent, background: c.accent + '22', cursor: 'pointer', fontSize: 11,
                        },
                    }, dc.removeThis)),
                )))
            ),
    );
}
