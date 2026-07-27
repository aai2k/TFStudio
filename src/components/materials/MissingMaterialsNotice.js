const { createElement: h } = React;

function MaterialIds({ ids, c, label }) {
    return h('div', {
        style: {
            color: c.textDim, fontSize: 11, lineHeight: 1.4,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        },
        title: ids.join(', '),
    }, `${label} ${ids.join(', ')}`);
}

function RepairButton({ c, label, onRepair }) {
    return h('button', {
        onClick: onRepair,
        style: {
            flexShrink: 0, padding: '5px 11px', borderRadius: 4,
            border: `1px solid ${c.error}`, backgroundColor: c.error + '18',
            color: c.error, cursor: 'pointer', fontSize: 11, fontWeight: 600,
        },
    }, label);
}

/** Persistent workspace warning shown whenever the active design has missing materials. */
export function MissingMaterialsBanner({ ids, c, t, onRepair }) {
    if (!ids?.length) return null;
    const mr = t.materialResolution;
    return h('div', {
        role: 'alert',
        'data-material-resolution': 'warning',
        style: {
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '7px 10px', flexShrink: 0,
            borderBottom: `1px solid ${c.error}`,
            backgroundColor: c.error + '14', color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif',
        },
    },
        h('span', { style: { color: c.error, fontSize: 16, flexShrink: 0 } }, '⚠'),
        h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { style: { fontSize: 12, fontWeight: 600 } }, mr.banner(ids.length)),
            h(MaterialIds, { ids, c, label: mr.missingList })),
        h(RepairButton, { c, label: mr.replace, onRepair }),
    );
}

/** Replaces a calculation window so none of its render/effect paths can run. */
export function MaterialCalculationBlocked({ ids, c, t, onRepair }) {
    const mr = t.materialResolution;
    return h('div', {
        role: 'alert',
        'data-material-resolution': 'blocked',
        style: {
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 10, height: '100%', padding: 24,
            boxSizing: 'border-box', textAlign: 'center', color: c.text,
            backgroundColor: c.bg, fontFamily: 'system-ui, -apple-system, sans-serif',
        },
    },
        h('div', { style: { color: c.error, fontSize: 28 } }, '⚠'),
        h('strong', { style: { fontSize: 14 } }, mr.blockedTitle),
        h('div', { style: { maxWidth: 480, color: c.textDim, fontSize: 12, lineHeight: 1.5 } },
            mr.blockedBody),
        h(MaterialIds, { ids, c, label: mr.missingList }),
        h(RepairButton, { c, label: mr.replace, onRepair }),
    );
}
