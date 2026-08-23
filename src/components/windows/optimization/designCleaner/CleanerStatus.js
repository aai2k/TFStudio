const { createElement: h } = React;

export function CleanerPlaceholder({ message, c }) {
    return h('div', {
        style: {
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontStyle: 'italic',
            fontFamily: 'system-ui, -apple-system, sans-serif', padding: 16, textAlign: 'center',
        }
    }, message);
}

export function CleanerSummary({ c, dc, preview, ops, removedOps, mergedOps, mfBefore, mfAfter, resultMsg }) {
    return h('div', {
        style: {
            display: 'flex', gap: 18, flexWrap: 'wrap',
            padding: '6px 10px', borderBottom: `1px solid ${c.border}`,
            background: c.panel + 'aa', flexShrink: 0,
            fontSize: 11,
        }
    },
        h('div', null,
            h('span', { style: { color: c.textDim, marginRight: 4 } }, dc.layersBefore + ':'),
            h('span', null,
                `${preview?.layersBefore.front ?? 0}F + ${preview?.layersBefore.back ?? 0}B`)
        ),
        h('div', null,
            h('span', { style: { color: c.textDim, marginRight: 4 } }, dc.layersAfter + ':'),
            h('span', { style: { color: ops.length ? c.accent : c.text, fontWeight: ops.length ? 600 : 400 } },
                `${preview?.layersAfter.front ?? 0}F + ${preview?.layersAfter.back ?? 0}B`)
        ),
        h('div', null,
            h('span', { style: { color: c.textDim, marginRight: 4 } }, dc.toRemove + ':'),
            h('span', { style: { color: removedOps.length ? '#ef5350' : c.text } }, removedOps.length)
        ),
        h('div', null,
            h('span', { style: { color: c.textDim, marginRight: 4 } }, dc.toMerge + ':'),
            h('span', { style: { color: mergedOps.length ? '#ffd54f' : c.text } }, mergedOps.length)
        ),
        mfBefore != null && h('div', null,
            h('span', { style: { color: c.textDim, marginRight: 4 } }, dc.mfBefore + ':'),
            h('span', null, mfBefore.toFixed(6))
        ),
        mfAfter != null && h('div', null,
            h('span', { style: { color: c.textDim, marginRight: 4 } }, dc.mfAfter + ':'),
            h('span', {
                style: { color: mfAfter > mfBefore + 1e-9 ? c.error
                              : mfAfter < mfBefore - 1e-9 ? c.success
                              : c.text }
            }, mfAfter.toFixed(6))
        ),
        resultMsg && h('div', { style: { color: c.accent, marginLeft: 'auto' } }, resultMsg),
    );
}
