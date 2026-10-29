import { provisionalMark } from '../provisionalMark.js';

const { createElement: h } = React;

// One MF of the summary, marked while it is read at the default steps
// (provisionalMark.js).
function meritItem(key, label, value, provisional, { c, tip, color }) {
    const mark = provisionalMark(provisional, tip);
    return h('div', { key, title: mark.title, style: { opacity: mark.opacity } },
        h('span', { style: { color: c.textDim, marginRight: 4 } }, label + ':'),
        h('span', { style: color ? { color } : null }, mark.prefix + value.toFixed(6)));
}

function afterColor(mfAfter, mfBefore, c) {
    if (mfAfter > mfBefore + 1e-9) return c.error;
    return mfAfter < mfBefore - 1e-9 ? c.success : c.text;
}

// The MF before and after the cleanup, or the cone evaluation at work.
function meritItems({ c, dc, mfBefore, mfAfter, beforeProvisional, afterProvisional, mfBusy, tip, computingLabel }) {
    if (mfBusy) return [h('div', { key: 'busy', style: { color: c.textDim } }, computingLabel)];
    return [
        mfBefore != null && meritItem('before', dc.mfBefore, mfBefore, beforeProvisional, { c, tip }),
        mfAfter != null && meritItem('after', dc.mfAfter, mfAfter, afterProvisional,
            { c, tip, color: afterColor(mfAfter, mfBefore, c) }),
    ];
}

export function CleanerPlaceholder({ message, c }) {
    return h('div', {
        style: {
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontStyle: 'italic',
            fontFamily: 'system-ui, -apple-system, sans-serif', padding: 16, textAlign: 'center',
        }
    }, message);
}

export function CleanerSummary({
    c, dc, preview, ops, removedOps, mergedOps, resultMsg,
    mfBefore, mfAfter, beforeProvisional, afterProvisional, mfBusy, tip, computingLabel,
}) {
    const merit = { mfBefore, mfAfter, beforeProvisional, afterProvisional, mfBusy, tip, computingLabel };
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
        ...meritItems({ c, dc, ...merit }),
        resultMsg && h('div', { style: { color: c.accent, marginLeft: 'auto' } }, resultMsg),
    );
}
